import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PitchDetector } from 'pitchy';
import { midiToNoteLabel } from './musicTheory';

const DETECTOR_POLL_MS = 33;
const MIN_DB_THRESHOLD = -60;
const DISPLAY_MIN_CLARITY = 0.62;
const MIN_FREQ_HZ = 55;
const MAX_FREQ_HZ = 1200;
const FFT_SIZE = 4096;
const TRACK_LOCK_TOLERANCE_SEMITONES = 5;
const TRACK_RELOCK_CONFIRM_FRAMES = 3;
const TRACK_PENDING_MIDI_EPSILON = 1.2;
const TRACK_HOLD_SEC = 0.2;
const OCTAVE_SWITCH_CONFIRM_FRAMES = 4;
const OCTAVE_SWITCH_MIDI_EPSILON = 0.8;
const OCTAVE_SWITCH_MIN_ADVANTAGE_SEMITONES = 1.5;
const DETECTOR_LOG_MAX_ROWS = 30000;

export function useStablePitchTracker({ enabled = true, maxHistoryPoints = 300 } = {}) {
  const [current, setCurrent] = useState(createCurrentSnapshot(null, null, null));
  const [history, setHistory] = useState([]);
  const [detectorLogSummary, setDetectorLogSummary] = useState({ count: 0, lastGate: '-', lastRawHz: null });
  const resourcesRef = useRef(createEmptyResources());
  const trackerStateRef = useRef(createPitchTrackerState());
  const detectorLogRef = useRef([]);

  const historyLimit = useMemo(() => Math.max(50, Number(maxHistoryPoints) || 300), [maxHistoryPoints]);

  useEffect(() => {
    if (!enabled) {
      void stopDetector(resourcesRef.current);
      resourcesRef.current = createEmptyResources();
      setCurrent(createCurrentSnapshot(null, null, null));
      setHistory([]);
      detectorLogRef.current = [];
      setDetectorLogSummary({ count: 0, lastGate: '-', lastRawHz: null });
      trackerStateRef.current = createPitchTrackerState();
      return undefined;
    }

    let cancelled = false;

    async function start() {
      await stopDetector(resourcesRef.current);
      trackerStateRef.current = createPitchTrackerState();

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const context = new AudioContext();
        await context.resume().catch(() => undefined);
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = 0;
        source.connect(analyser);

        const detector = PitchDetector.forFloat32Array(FFT_SIZE);
        const sampleBuffer = new Float32Array(FFT_SIZE);

        resourcesRef.current = {
          context,
          stream,
          source,
          analyser,
          timer: globalThis.setInterval(() => {
            analyser.getFloatTimeDomainData(sampleBuffer);

            let rms = 0;
            for (let index = 0; index < sampleBuffer.length; index += 1) {
              const value = sampleBuffer[index];
              rms += value * value;
            }
            rms = Math.sqrt(rms / sampleBuffer.length);
            const db = 20 * Math.log10(Math.max(1e-8, rms));

            const nowMs = performance.now();
            let trackedMidi = null;
            let trackedHz = null;
            let clarity = null;
            let voiced = false;
            let gateReason = 'db-below-threshold';
            let rawHz = null;
            let rawClarity = null;

            if (db >= MIN_DB_THRESHOLD) {
              const [detectedHz, detectedClarity] = detector.findPitch(sampleBuffer, context.sampleRate);
              rawHz = Number.isFinite(detectedHz) ? detectedHz : null;
              rawClarity = Number.isFinite(detectedClarity) ? detectedClarity : null;
              const tracked = trackPitchSample({
                rawHz: detectedHz,
                rawClarity: detectedClarity,
                nowSec: nowMs / 1000,
                trackerState: trackerStateRef.current,
              });
              trackedMidi = tracked.midi;
              trackedHz = tracked.acceptedHz;
              clarity = tracked.clarity;
              voiced = tracked.voiced;
              gateReason = tracked.gateReason;
            } else {
              const tracked = emitHeldOrUnvoiced(trackerStateRef.current, nowMs / 1000, 'db-below-threshold');
              trackedMidi = tracked.midi;
              trackedHz = tracked.acceptedHz;
              clarity = tracked.clarity;
              voiced = tracked.voiced;
              gateReason = tracked.gateReason;
            }

            const entry = {
              timeMs: nowMs,
              midi: Number.isFinite(trackedMidi) ? trackedMidi : null,
              pitchHz: Number.isFinite(trackedHz) ? trackedHz : null,
              db,
              clarity: Number.isFinite(clarity) ? clarity : null,
              voiced,
            };

            setCurrent(createCurrentSnapshot(entry.midi, entry.pitchHz, entry.db));
            setHistory((previous) => {
              const next = [...previous, entry];
              if (next.length > historyLimit) {
                next.splice(0, next.length - historyLimit);
              }
              return next;
            });

            const tick = detectorLogRef.current.length + 1;
            detectorLogRef.current.push({
              tick,
              timeSec: nowMs / 1000,
              db,
              rawHz,
              rawClarity,
              acceptedHz: Number.isFinite(trackedHz) ? trackedHz : null,
              midi: Number.isFinite(trackedMidi) ? trackedMidi : null,
              clarity: Number.isFinite(clarity) ? clarity : null,
              voiced,
              gateReason,
              minDbThreshold: MIN_DB_THRESHOLD,
              minClarityThreshold: DISPLAY_MIN_CLARITY,
              minFreqHz: MIN_FREQ_HZ,
              maxFreqHz: MAX_FREQ_HZ,
            });

            if (detectorLogRef.current.length > DETECTOR_LOG_MAX_ROWS) {
              detectorLogRef.current.splice(0, detectorLogRef.current.length - DETECTOR_LOG_MAX_ROWS);
            }

            setDetectorLogSummary({
              count: detectorLogRef.current.length,
              lastGate: gateReason,
              lastRawHz: Number.isFinite(rawHz) ? rawHz : null,
            });
          }, DETECTOR_POLL_MS),
        };
      } catch {
        resourcesRef.current = createEmptyResources();
      }
    }

    void start();

    return () => {
      cancelled = true;
      void stopDetector(resourcesRef.current);
      resourcesRef.current = createEmptyResources();
    };
  }, [enabled, historyLimit]);

  const clearTrackingData = useCallback(() => {
    trackerStateRef.current = createPitchTrackerState();
    detectorLogRef.current = [];
    setCurrent(createCurrentSnapshot(null, null, null));
    setHistory([]);
    setDetectorLogSummary({ count: 0, lastGate: '-', lastRawHz: null });
  }, []);

  const clearDetectorLog = useCallback(() => {
    detectorLogRef.current = [];
    setDetectorLogSummary({ count: 0, lastGate: '-', lastRawHz: null });
  }, []);

  const getDetectorLogRows = useCallback(() => detectorLogRef.current.slice(), []);

  return {
    current,
    history,
    clearTrackingData,
    detectorLogSummary,
    clearDetectorLog,
    getDetectorLogRows,
  };
}

function createCurrentSnapshot(midi, pitchHz, db) {
  return {
    midi: Number.isFinite(midi) ? midi : null,
    pitchHz: Number.isFinite(pitchHz) ? pitchHz : null,
    db: Number.isFinite(db) ? db : null,
    note: Number.isFinite(midi) ? midiToNoteLabel(Math.round(midi)) : '--',
  };
}

function createEmptyResources() {
  return {
    context: null,
    stream: null,
    source: null,
    analyser: null,
    timer: null,
  };
}

async function stopDetector(resources) {
  if (!resources) {
    return;
  }

  if (resources.timer) {
    globalThis.clearInterval(resources.timer);
    resources.timer = null;
  }
  if (resources.source) {
    resources.source.disconnect();
    resources.source = null;
  }
  if (resources.stream) {
    resources.stream.getTracks().forEach((track) => track.stop());
    resources.stream = null;
  }
  if (resources.context) {
    await resources.context.close().catch(() => undefined);
    resources.context = null;
  }
  resources.analyser = null;
}

function createPitchTrackerState() {
  return {
    lockedMidi: null,
    pendingMidi: null,
    pendingCount: 0,
    pendingOctaveMultiplier: null,
    pendingOctaveMidi: null,
    pendingOctaveCount: 0,
    holdMidi: null,
    holdUntilSec: Number.NEGATIVE_INFINITY,
  };
}

function trackPitchSample({ rawHz, rawClarity, nowSec, trackerState }) {
  if (!Number.isFinite(rawHz) || !Number.isFinite(rawClarity)) {
    return emitHeldOrUnvoiced(trackerState, nowSec, 'invalid-pitch');
  }
  if (rawHz < MIN_FREQ_HZ || rawHz > MAX_FREQ_HZ) {
    return emitHeldOrUnvoiced(trackerState, nowSec, 'frequency-out-of-range');
  }
  if (rawClarity < DISPLAY_MIN_CLARITY) {
    return emitHeldOrUnvoiced(trackerState, nowSec, 'clarity-below-threshold');
  }

  const rawMidi = hzToMidi(rawHz);
  const lockMidi = trackerState.lockedMidi;

  if (!Number.isFinite(lockMidi)) {
    trackerState.lockedMidi = rawMidi;
    trackerState.pendingMidi = null;
    trackerState.pendingCount = 0;
    trackerState.holdMidi = rawMidi;
    trackerState.holdUntilSec = nowSec + TRACK_HOLD_SEC;
    return {
      voiced: true,
      midi: rawMidi,
      clarity: rawClarity,
      acceptedHz: midiToHz(rawMidi),
      gateReason: 'accepted-lock',
    };
  }

  const candidate = selectNearestOctaveCandidate(rawHz, lockMidi, trackerState);
  const jumpSemitones = Math.abs(candidate.midi - lockMidi);

  if (jumpSemitones <= TRACK_LOCK_TOLERANCE_SEMITONES) {
    trackerState.lockedMidi = candidate.midi;
    trackerState.pendingMidi = null;
    trackerState.pendingCount = 0;
    trackerState.holdMidi = candidate.midi;
    trackerState.holdUntilSec = nowSec + TRACK_HOLD_SEC;
    return {
      voiced: true,
      midi: candidate.midi,
      clarity: rawClarity,
      acceptedHz: midiToHz(candidate.midi),
      gateReason: 'accepted-tracked',
    };
  }

  if (Number.isFinite(trackerState.pendingMidi) && Math.abs(candidate.midi - trackerState.pendingMidi) <= TRACK_PENDING_MIDI_EPSILON) {
    trackerState.pendingCount += 1;
  } else {
    trackerState.pendingMidi = candidate.midi;
    trackerState.pendingCount = 1;
  }

  if (trackerState.pendingCount >= TRACK_RELOCK_CONFIRM_FRAMES) {
    trackerState.lockedMidi = trackerState.pendingMidi;
    trackerState.pendingMidi = null;
    trackerState.pendingCount = 0;
    trackerState.holdMidi = trackerState.lockedMidi;
    trackerState.holdUntilSec = nowSec + TRACK_HOLD_SEC;
    return {
      voiced: true,
      midi: trackerState.lockedMidi,
      clarity: rawClarity,
      acceptedHz: midiToHz(trackerState.lockedMidi),
      gateReason: 'accepted-relock',
    };
  }

  return emitHeldOrUnvoiced(trackerState, nowSec, 'tracking-pending-relock');
}

function emitHeldOrUnvoiced(trackerState, nowSec, gateReason) {
  if (Number.isFinite(trackerState.holdMidi) && nowSec <= trackerState.holdUntilSec) {
    return {
      voiced: true,
      midi: trackerState.holdMidi,
      clarity: DISPLAY_MIN_CLARITY,
      acceptedHz: midiToHz(trackerState.holdMidi),
      gateReason: 'tracking-hold',
    };
  }

  return {
    voiced: false,
    midi: null,
    clarity: null,
    acceptedHz: null,
    gateReason,
  };
}

function selectNearestOctaveCandidate(rawHz, lockMidi, trackerState) {
  const multipliers = [1, 0.5, 2];
  const candidates = [];

  for (const multiplier of multipliers) {
    const hz = rawHz * multiplier;
    if (!Number.isFinite(hz) || hz < MIN_FREQ_HZ || hz > MAX_FREQ_HZ) {
      continue;
    }
    const midi = nearestMidiByOctave(hzToMidi(hz), lockMidi);
    const distance = Math.abs(midi - lockMidi);
    const octavePenalty = Math.abs(Math.log2(multiplier));
    candidates.push({ hz, midi, multiplier, distance, octavePenalty });
  }

  if (!candidates.length) {
    return { hz: rawHz, midi: nearestMidiByOctave(hzToMidi(rawHz), lockMidi), multiplier: 1 };
  }

  const sorted = [...candidates].sort((left, right) => {
    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }
    return left.octavePenalty - right.octavePenalty;
  });

  const best = sorted[0];
  const rawCandidate = candidates.find((candidate) => candidate.multiplier === 1) ?? null;

  if (best.multiplier === 1 || !rawCandidate) {
    trackerState.pendingOctaveMultiplier = null;
    trackerState.pendingOctaveMidi = null;
    trackerState.pendingOctaveCount = 0;
    return best;
  }

  const rawDistance = Math.abs(rawCandidate.midi - lockMidi);
  const bestDistance = Math.abs(best.midi - lockMidi);
  const advantage = rawDistance - bestDistance;

  if (advantage < OCTAVE_SWITCH_MIN_ADVANTAGE_SEMITONES) {
    if (
      trackerState.pendingOctaveMultiplier === best.multiplier
      && Number.isFinite(trackerState.pendingOctaveMidi)
      && Math.abs(best.midi - trackerState.pendingOctaveMidi) <= OCTAVE_SWITCH_MIDI_EPSILON
    ) {
      trackerState.pendingOctaveCount += 1;
    } else {
      trackerState.pendingOctaveMultiplier = best.multiplier;
      trackerState.pendingOctaveMidi = best.midi;
      trackerState.pendingOctaveCount = 1;
    }

    if (trackerState.pendingOctaveCount < OCTAVE_SWITCH_CONFIRM_FRAMES) {
      return rawCandidate;
    }
  }

  trackerState.pendingOctaveMultiplier = null;
  trackerState.pendingOctaveMidi = null;
  trackerState.pendingOctaveCount = 0;
  return best;
}

function nearestMidiByOctave(candidateMidi, referenceMidi) {
  if (!Number.isFinite(candidateMidi) || !Number.isFinite(referenceMidi)) {
    return candidateMidi;
  }

  let best = candidateMidi;
  while (best - referenceMidi > 6) {
    best -= 12;
  }
  while (referenceMidi - best > 6) {
    best += 12;
  }
  return best;
}

function hzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}