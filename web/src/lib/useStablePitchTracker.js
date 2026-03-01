import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PitchDetector } from 'pitchy';
import { midiToNoteLabel } from './musicTheory';
import { defaultPitchSettings } from './pitchSettings';

const DEFAULT_DETECTOR_POLL_MS = 33;
const DEFAULT_MIN_DB_THRESHOLD = -60;
const DEFAULT_DISPLAY_MIN_CLARITY = 0.62;
const DEFAULT_MIN_FREQ_HZ = 55;
const DEFAULT_MAX_FREQ_HZ = 1200;
const DEFAULT_FFT_SIZE = 4096;
const TRACK_LOCK_TOLERANCE_SEMITONES = 5;
const TRACK_RELOCK_CONFIRM_FRAMES = 3;
const TRACK_PENDING_MIDI_EPSILON = 1.2;
const TRACK_HOLD_SEC = 0.2;
const DETECTOR_LOG_MAX_ROWS = 30000;
const MEDIAN_SMOOTH_WINDOW = 3;

export function useStablePitchTracker({ enabled = true, maxHistoryPoints = 300, pitchSettings = null } = {}) {
  const [current, setCurrent] = useState(createCurrentSnapshot(null, null, null));
  const [history, setHistory] = useState([]);
  const [detectorLogSummary, setDetectorLogSummary] = useState({ count: 0, lastGate: '-', lastRawHz: null });
  const resourcesRef = useRef(createEmptyResources());
  const trackerStateRef = useRef(createPitchTrackerState());
  const detectorLogRef = useRef([]);
  const smoothingRef = useRef({ voicedMidis: [], unvoicedCount: 0 });

  const historyLimit = useMemo(() => Math.max(50, Number(maxHistoryPoints) || 300), [maxHistoryPoints]);
  const detectorConfig = useMemo(() => normalizeDetectorConfig(pitchSettings), [pitchSettings]);

  useEffect(() => {
    if (!enabled) {
      void stopDetector(resourcesRef.current);
      resourcesRef.current = createEmptyResources();
      setCurrent(createCurrentSnapshot(null, null, null));
      setHistory([]);
      detectorLogRef.current = [];
      setDetectorLogSummary({ count: 0, lastGate: '-', lastRawHz: null });
      trackerStateRef.current = createPitchTrackerState();
      smoothingRef.current = { voicedMidis: [], unvoicedCount: 0 };
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
        analyser.fftSize = detectorConfig.fftSize;
        analyser.smoothingTimeConstant = 0;
        source.connect(analyser);

        const detector = PitchDetector.forFloat32Array(detectorConfig.fftSize);
        const sampleBuffer = new Float32Array(detectorConfig.fftSize);

        resourcesRef.current = {
          context,
          stream,
          source,
          analyser,
          timer: globalThis.setInterval(() => {
            if (context.state === 'suspended') {
              void context.resume().catch(() => undefined);
            }
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

            if (db >= detectorConfig.minDbThreshold) {
              const [detectedHz, detectedClarity] = detector.findPitch(sampleBuffer, context.sampleRate);
              rawHz = Number.isFinite(detectedHz) ? detectedHz : null;
              rawClarity = Number.isFinite(detectedClarity) ? detectedClarity : null;
              const tracked = trackPitchSample({
                rawHz: detectedHz,
                rawClarity: detectedClarity,
                nowSec: nowMs / 1000,
                trackerState: trackerStateRef.current,
                config: detectorConfig,
              });
              trackedMidi = tracked.midi;
              trackedHz = tracked.acceptedHz;
              clarity = tracked.clarity;
              voiced = tracked.voiced;
              gateReason = tracked.gateReason;
            } else {
              const tracked = emitHeldOrUnvoiced(trackerStateRef.current, nowMs / 1000, 'db-below-threshold', detectorConfig);
              trackedMidi = tracked.midi;
              trackedHz = tracked.acceptedHz;
              clarity = tracked.clarity;
              voiced = tracked.voiced;
              gateReason = tracked.gateReason;
            }

            if (voiced && Number.isFinite(trackedMidi)) {
              const smoothedMidi = smoothMidi(trackedMidi, smoothingRef.current);
              trackedMidi = smoothedMidi;
              trackedHz = midiToHz(smoothedMidi);
            } else {
              trackUnvoiced(smoothingRef.current);
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
              minDbThreshold: detectorConfig.minDbThreshold,
              minClarityThreshold: detectorConfig.minClarity,
              minFreqHz: detectorConfig.minFrequencyHz,
              maxFreqHz: detectorConfig.maxFrequencyHz,
            });

            if (detectorLogRef.current.length > DETECTOR_LOG_MAX_ROWS) {
              detectorLogRef.current.splice(0, detectorLogRef.current.length - DETECTOR_LOG_MAX_ROWS);
            }

            setDetectorLogSummary({
              count: detectorLogRef.current.length,
              lastGate: gateReason,
              lastRawHz: Number.isFinite(rawHz) ? rawHz : null,
            });
          }, detectorConfig.pollMs),
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
  }, [enabled, historyLimit, detectorConfig]);

  const clearTrackingData = useCallback(() => {
    trackerStateRef.current = createPitchTrackerState();
    detectorLogRef.current = [];
    smoothingRef.current = { voicedMidis: [], unvoicedCount: 0 };
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
  if (resources.analyser) {
    resources.analyser.disconnect();
    resources.analyser = null;
  }
  if (resources.stream) {
    resources.stream.getTracks().forEach((track) => track.stop());
    resources.stream = null;
  }
  if (resources.context) {
    await resources.context.close().catch(() => undefined);
    resources.context = null;
  }
}

function createPitchTrackerState() {
  return {
    lockedMidi: null,
    pendingMidi: null,
    pendingCount: 0,
    holdMidi: null,
    holdUntilSec: Number.NEGATIVE_INFINITY,
  };
}

function trackPitchSample({ rawHz, rawClarity, nowSec, trackerState, config }) {
  if (!Number.isFinite(rawHz) || !Number.isFinite(rawClarity)) {
    return emitHeldOrUnvoiced(trackerState, nowSec, 'invalid-pitch', config);
  }
  if (rawHz < config.minFrequencyHz || rawHz > config.maxFrequencyHz) {
    return emitHeldOrUnvoiced(trackerState, nowSec, 'frequency-out-of-range', config);
  }
  if (rawClarity < config.minClarity) {
    return emitHeldOrUnvoiced(trackerState, nowSec, 'clarity-below-threshold', config);
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

  const candidate = selectCandidateFromRaw(rawHz);
  if (!isMidiInAllowedRange(candidate.midi, config)) {
    return emitHeldOrUnvoiced(trackerState, nowSec, 'tracking-mapped-out-of-range', config);
  }
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
    if (!isMidiInAllowedRange(trackerState.pendingMidi)) {
      trackerState.pendingMidi = null;
      trackerState.pendingCount = 0;
      return emitHeldOrUnvoiced(trackerState, nowSec, 'tracking-pending-out-of-range', config);
    }
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

  return emitHeldOrUnvoiced(trackerState, nowSec, 'tracking-pending-relock', config);
}

function emitHeldOrUnvoiced(trackerState, nowSec, gateReason, config) {
  if (
    Number.isFinite(trackerState.holdMidi)
    && isMidiInAllowedRange(trackerState.holdMidi, config)
    && nowSec <= trackerState.holdUntilSec
  ) {
    return {
      voiced: true,
      midi: trackerState.holdMidi,
      clarity: config.minClarity,
      acceptedHz: midiToHz(trackerState.holdMidi),
      gateReason: 'tracking-hold',
    };
  }

  // Hold expired — clear the lock so the next valid detection re-locks
  // immediately via accepted-lock rather than requiring pending-relock confirmation.
  trackerState.lockedMidi = null;
  trackerState.pendingMidi = null;
  trackerState.pendingCount = 0;

  return {
    voiced: false,
    midi: null,
    clarity: null,
    acceptedHz: null,
    gateReason,
  };
}

function selectCandidateFromRaw(rawHz) {
  return {
    hz: rawHz,
    midi: hzToMidi(rawHz),
    multiplier: 1,
  };
}

function hzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function isMidiInAllowedRange(midi, config) {
  if (!Number.isFinite(midi)) {
    return false;
  }
  const hz = midiToHz(midi);
  return Number.isFinite(hz) && hz >= config.minFrequencyHz && hz <= config.maxFrequencyHz;
}

function normalizeDetectorConfig(settings) {
  const source = { ...defaultPitchSettings, ...(settings ?? {}) };
  const minFrequencyHz = clampNumber(source.minFrequencyHz, 20, 2000, DEFAULT_MIN_FREQ_HZ);
  const maxFrequencyHz = clampNumber(source.maxFrequencyHz, minFrequencyHz + 1, 5000, DEFAULT_MAX_FREQ_HZ);
  const minClarity = clampNumber(source.minClarity, 0.1, 0.99, DEFAULT_DISPLAY_MIN_CLARITY);
  const minDbThreshold = clampNumber(source.minDbThreshold, -120, -5, DEFAULT_MIN_DB_THRESHOLD);
  const pollMs = Math.round(clampNumber(source.pollMs, 15, 250, DEFAULT_DETECTOR_POLL_MS));
  const fftSize = normalizeFftSize(source.fftSize);

  return {
    minFrequencyHz,
    maxFrequencyHz,
    minClarity,
    minDbThreshold,
    pollMs,
    fftSize,
  };
}

function normalizeFftSize(value) {
  const num = Math.round(clampNumber(value, 1024, 32768, DEFAULT_FFT_SIZE));
  return nearestPowerOfTwo(num);
}

function nearestPowerOfTwo(value) {
  let power = 1;
  while (power < value) {
    power *= 2;
  }
  const lower = power / 2;
  if (!Number.isFinite(lower) || lower < 1) {
    return power;
  }
  return Math.abs(power - value) < Math.abs(value - lower) ? power : lower;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function smoothMidi(midi, state) {
  if (!state) {
    return midi;
  }

  state.unvoicedCount = 0;
  state.voicedMidis.push(midi);
  if (state.voicedMidis.length > MEDIAN_SMOOTH_WINDOW) {
    state.voicedMidis.shift();
  }

  if (state.voicedMidis.length < MEDIAN_SMOOTH_WINDOW) {
    return midi;
  }

  const sorted = [...state.voicedMidis].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted[mid];
}

function trackUnvoiced(state) {
  if (!state) {
    return;
  }

  state.unvoicedCount += 1;
  if (state.unvoicedCount >= 3) {
    state.voicedMidis = [];
    state.unvoicedCount = 0;
  }
}