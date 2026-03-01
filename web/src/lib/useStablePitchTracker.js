import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { midiToNoteLabel } from './musicTheory';
import { defaultPitchSettings } from './pitchSettings';

// ---------------------------------------------------------------------------
// YIN pitch detection (de Cheveigné & Kawahara, 2002)
//
// Key advantage over McLeod (pitchy): the Cumulative Mean Normalised
// Difference Function (CMNDF) makes sub-harmonic periods score *worse* than
// the true fundamental, so octave/harmonic errors are suppressed by the
// algorithm itself rather than by post-hoc heuristics.
// ---------------------------------------------------------------------------

const DEFAULT_DETECTOR_POLL_MS = 33;
const DEFAULT_MIN_DB_THRESHOLD = -60;
const DEFAULT_DISPLAY_MIN_CLARITY = 0.62;
const DEFAULT_MIN_FREQ_HZ = 55;
const DEFAULT_MAX_FREQ_HZ = 600;   // above here is overtone territory for most voices
const DEFAULT_FFT_SIZE = 4096;     // time-domain window; YIN uses half = 2048 samples
const YIN_THRESHOLD = 0.15;        // CMNDF must dip below this to accept a pitch
const TRACK_HOLD_SEC = 0.15;
const TRACK_LOCK_TOLERANCE_SEMITONES = 7;  // allow up to a 5th without relock confirmation
const TRACK_RELOCK_CONFIRM_FRAMES = 2;     // frames of agreement needed for a large jump
const TRACK_PENDING_MIDI_EPSILON = 1.2;
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
        // Disable all browser VoIP processing. AGC changes signal amplitude
        // mid-note (confusing the dB gate), and noise suppression distorts the
        // waveform's harmonic structure — both cause spurious pitch jumps.
        const audioConstraints = {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        };
        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const context = new AudioContext({ sampleRate: detectorConfig.sampleRate, latencyHint: 'interactive' });
        await context.resume().catch(() => undefined);
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = detectorConfig.fftSize;
        analyser.smoothingTimeConstant = 0;
        source.connect(analyser);

        // Time-domain buffer — YIN reads directly from this, no FFT needed.
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
            for (const v of sampleBuffer) rms += v * v;
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
              const yin = yinFindPitch(
                sampleBuffer,
                context.sampleRate,
                detectorConfig.minFrequencyHz,
                detectorConfig.maxFrequencyHz,
              );
              rawHz = yin.hz;
              rawClarity = yin.clarity;
              const tracked = trackPitchSample({
                rawHz: yin.hz,
                rawClarity: yin.clarity,
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

// ---------------------------------------------------------------------------
// YIN algorithm
//
// 1. Difference function:
//      d(τ) = Σ_{j=0}^{W-1} (x[j] − x[j+τ])²
//    where W = floor(bufferLength / 2)
//
// 2. Cumulative Mean Normalised Difference Function (CMNDF):
//      d'(0)   = 1
//      d'(τ)   = d(τ) · τ / Σ_{j=1}^{τ} d(j)
//    The normalisation makes sub-harmonic periods (e.g. 2τ, 4τ) score
//    significantly *higher* than the true fundamental period.
//
// 3. Absolute threshold: pick the first τ ∈ [minLag, maxLag] where
//    d'(τ) < YIN_THRESHOLD and d'(τ) is a local minimum.
//    Fallback: global minimum if no threshold crossing found.
//
// 4. Parabolic interpolation for sub-sample refinement.
//
// Returns { hz, clarity } where clarity = clamp(1 − d'(τ_best), 0, 1).
// ---------------------------------------------------------------------------

function yinFindPitch(buffer, sampleRate, minFreqHz, maxFreqHz) {
  const w = buffer.length >> 1;
  const maxLag = Math.floor(sampleRate / Math.max(minFreqHz, 1));
  const minLag = Math.max(2, Math.ceil(sampleRate / Math.min(maxFreqHz, sampleRate / 2)));

  if (maxLag >= w || minLag >= maxLag) {
    return { hz: null, clarity: 0 };
  }

  const d = new Float32Array(maxLag + 1);
  d[0] = 1;
  let runningSum = 0;

  for (let tau = 1; tau <= maxLag; tau++) {
    let diff = 0;
    for (let j = 0; j < w; j++) {
      const delta = buffer[j] - buffer[j + tau];
      diff += delta * delta;
    }
    runningSum += diff;
    d[tau] = runningSum === 0 ? 0 : (diff * tau) / runningSum;
  }

  // Step 3: first local minimum below threshold.
  let bestTau = -1;
  for (let tau = minLag + 1; tau < maxLag; tau++) {
    if (d[tau] < YIN_THRESHOLD && d[tau] <= d[tau - 1] && d[tau] <= d[tau + 1]) {
      bestTau = tau;
      break;
    }
  }

  // Fallback: global minimum.
  if (bestTau === -1) {
    let minVal = Infinity;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (d[tau] < minVal) { minVal = d[tau]; bestTau = tau; }
    }
    if (minVal > 0.5) return { hz: null, clarity: 0 };
  }

  // Step 4: parabolic interpolation.
  let refinedTau = bestTau;
  if (bestTau > minLag && bestTau < maxLag) {
    const prev = d[bestTau - 1];
    const curr = d[bestTau];
    const next = d[bestTau + 1];
    const denom = 2 * (2 * curr - prev - next);
    if (denom !== 0) refinedTau = bestTau + (next - prev) / denom;
  }

  return {
    hz: sampleRate / refinedTau,
    clarity: Math.max(0, Math.min(1, 1 - d[bestTau])),
  };
}

// ---------------------------------------------------------------------------
// Tracker state machine
// ---------------------------------------------------------------------------

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
      voiced: true, midi: rawMidi, clarity: rawClarity,
      acceptedHz: midiToHz(rawMidi), gateReason: 'accepted-lock',
    };
  }

  const jumpSemitones = Math.abs(rawMidi - lockMidi);

  if (jumpSemitones <= TRACK_LOCK_TOLERANCE_SEMITONES) {
    trackerState.lockedMidi = rawMidi;
    trackerState.pendingMidi = null;
    trackerState.pendingCount = 0;
    trackerState.holdMidi = rawMidi;
    trackerState.holdUntilSec = nowSec + TRACK_HOLD_SEC;
    return {
      voiced: true, midi: rawMidi, clarity: rawClarity,
      acceptedHz: midiToHz(rawMidi), gateReason: 'accepted-tracked',
    };
  }

  if (Number.isFinite(trackerState.pendingMidi) && Math.abs(rawMidi - trackerState.pendingMidi) <= TRACK_PENDING_MIDI_EPSILON) {
    trackerState.pendingCount += 1;
  } else {
    trackerState.pendingMidi = rawMidi;
    trackerState.pendingCount = 1;
  }

  if (trackerState.pendingCount >= TRACK_RELOCK_CONFIRM_FRAMES) {
    trackerState.lockedMidi = trackerState.pendingMidi;
    trackerState.pendingMidi = null;
    trackerState.pendingCount = 0;
    trackerState.holdMidi = trackerState.lockedMidi;
    trackerState.holdUntilSec = nowSec + TRACK_HOLD_SEC;
    return {
      voiced: true, midi: trackerState.lockedMidi, clarity: rawClarity,
      acceptedHz: midiToHz(trackerState.lockedMidi), gateReason: 'accepted-relock',
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
  const sampleRate = clampNumber(source.sampleRate, 8000, 96000, 44100);

  return { minFrequencyHz, maxFrequencyHz, minClarity, minDbThreshold, pollMs, fftSize, sampleRate };
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