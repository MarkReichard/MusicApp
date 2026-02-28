import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PitchDetector } from 'pitchy';
import { clearPitchRingBuffer, createPitchRingBuffer, forEachSampleInTimeRange, pushPitchSample } from '../lib/pitchRingBuffer';

const VIEWPORT_SECONDS = 12;
const TARGET_CURSOR_RATIO = 0.35;
const METRICS_UPDATE_MS = 250;
const DETECTOR_POLL_MS = 33;
const MIN_DB_THRESHOLD = -60;
const DISPLAY_MIN_CLARITY = 0.62;
const SCORING_MIN_CLARITY = 0.8;
const MIN_FREQ_HZ = 55;
const MAX_FREQ_HZ = 1200;
const FFT_SIZE = 4096;
const SCORING_TOLERANCE_CENTS = 50;
const SCORING_MIN_COVERAGE = 0.35;
const SESSION_POST_ROLL_SEC = 1.5;
const DETECTOR_LOG_MAX_ROWS = 30000;
const MAX_DRAW_JUMP_SEMITONES = 5;
const MAX_DRAW_GAP_SEC = 0.14;
const MAX_DRAW_GAP_HIGH_ENERGY_SEC = 0.8;
const FIRST_NOTE_DELAY_SEC = 2.0;
const TRACK_LOCK_TOLERANCE_SEMITONES = 5;
const TRACK_RELOCK_CONFIRM_FRAMES = 3;
const TRACK_PENDING_MIDI_EPSILON = 1.2;
const TRACK_HOLD_SEC = 0.2;
const OCTAVE_SWITCH_CONFIRM_FRAMES = 4;
const OCTAVE_SWITCH_MIDI_EPSILON = 0.8;
const OCTAVE_SWITCH_MIN_ADVANTAGE_SEMITONES = 1.5;

const BASE_EXPECTED_WINDOWS = [
  { id: 'note-1', startSec: 0.5, endSec: 1.7, midi: 50 },
  { id: 'note-2', startSec: 1.9, endSec: 3.1, midi: 52 },
  { id: 'note-3', startSec: 3.3, endSec: 4.5, midi: 54 },
  { id: 'note-4', startSec: 4.7, endSec: 5.9, midi: 55 },
  { id: 'note-5', startSec: 6.1, endSec: 7.3, midi: 57 },
];

const EXPECTED_WINDOWS = BASE_EXPECTED_WINDOWS.map((window) => ({
  ...window,
  startSec: window.startSec + FIRST_NOTE_DELAY_SEC,
  endSec: window.endSec + FIRST_NOTE_DELAY_SEC,
}));

export function SingGraphV2LabPage() {
  const canvasRef = useRef(null);
  const frameHandleRef = useRef(0);
  const resizeObserverRef = useRef(null);
  const sessionStartMsRef = useRef(null);
  const metricsRef = useRef(createEmptyMetrics());
  const ringBufferRef = useRef(createPitchRingBuffer(8192));
  const audioResourcesRef = useRef(createEmptyAudioResources());
  const windowResultsRef = useRef(createInitialWindowResults());
  const detectorLogRef = useRef([]);
  const latestElapsedSecRef = useRef(0);
  const frozenElapsedSecRef = useRef(0);
  const hasCompletedRef = useRef(false);

  const [sessionState, setSessionState] = useState('idle');
  const [sessionKey, setSessionKey] = useState(0);
  const [metrics, setMetrics] = useState(() => createEmptyMetrics());
  const [windowResults, setWindowResults] = useState(() => createInitialWindowResults());
  const [detectorLogSummary, setDetectorLogSummary] = useState({ count: 0, lastGate: '-', lastRawHz: null });

  const isRunning = sessionState === 'running';

  const expectedRange = useMemo(() => {
    const values = EXPECTED_WINDOWS.map((window) => window.midi);
    const minMidi = Math.min(...values) - 6;
    const maxMidi = Math.max(...values) + 6;
    return { minMidi, maxMidi };
  }, []);
  const sessionEndSec = useMemo(() => {
    const maxEnd = EXPECTED_WINDOWS.reduce((maxValue, window) => Math.max(maxValue, window.endSec), 0);
    return maxEnd + SESSION_POST_ROLL_SEC;
  }, []);

  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      setMetrics({ ...metricsRef.current });
      setWindowResults({ ...windowResultsRef.current });
      const last = detectorLogRef.current[detectorLogRef.current.length - 1] ?? null;
      setDetectorLogSummary({
        count: detectorLogRef.current.length,
        lastGate: last?.gateReason ?? '-',
        lastRawHz: Number.isFinite(last?.rawHz) ? last.rawHz : null,
      });
    }, METRICS_UPDATE_MS);

    return () => globalThis.clearInterval(timer);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }

    const sizeCanvas = () => {
      const dpr = globalThis.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(canvas.clientWidth));
      const height = Math.max(1, Math.floor(canvas.clientHeight));
      const targetWidth = Math.floor(width * dpr);
      const targetHeight = Math.floor(height * dpr);

      if (canvas.width === targetWidth && canvas.height === targetHeight) {
        return;
      }

      canvas.width = targetWidth;
      canvas.height = targetHeight;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      metricsRef.current.canvasResizeCount += 1;
    };

    sizeCanvas();

    resizeObserverRef.current?.disconnect();
    const resizeObserver = new ResizeObserver(() => {
      sizeCanvas();
    });
    resizeObserver.observe(canvas);
    resizeObserverRef.current = resizeObserver;

    if (!isRunning) {
      void stopDetectorIngest(audioResourcesRef.current);
      if (sessionState === 'complete' || sessionState === 'stopped') {
        drawLabFrame({
          context,
          width: canvas.clientWidth,
          height: canvas.clientHeight,
          elapsedSec: frozenElapsedSecRef.current,
          minMidi: expectedRange.minMidi,
          maxMidi: expectedRange.maxMidi,
          ringBuffer: ringBufferRef.current,
          windowResults: windowResultsRef.current,
        });
      } else {
        drawIdleFrame(context, canvas.clientWidth, canvas.clientHeight);
      }
      return () => {
        resizeObserver.disconnect();
      };
    }

    sessionStartMsRef.current = performance.now();
    latestElapsedSecRef.current = 0;
    frozenElapsedSecRef.current = 0;
    hasCompletedRef.current = false;
    metricsRef.current.lastFrameTimestampMs = 0;
    windowResultsRef.current = createInitialWindowResults();
    clearPitchRingBuffer(ringBufferRef.current);
    void startDetectorIngest({
      sessionStartMsRef,
      ringBufferRef,
      metricsRef,
      audioResourcesRef,
      detectorLogRef,
    });

    const render = (frameTimestampMs) => {
      const drawStartMs = performance.now();
      const elapsedSec = Math.max(0, (drawStartMs - sessionStartMsRef.current) / 1000);
      latestElapsedSecRef.current = elapsedSec;
      const width = Math.max(0, canvas.clientWidth);
      const height = Math.max(0, canvas.clientHeight);
      if (width <= 1 || height <= 1) {
        metricsRef.current.zeroSizeFrameCount += 1;
      } else {
        try {
          drawLabFrame({
            context,
            width,
            height,
            elapsedSec,
            minMidi: expectedRange.minMidi,
            maxMidi: expectedRange.maxMidi,
            ringBuffer: ringBufferRef.current,
            windowResults: windowResultsRef.current,
          });
        } catch {
          metricsRef.current.drawErrorCount += 1;
        }
      }
      evaluateExpectedWindows({
        elapsedSec,
        ringBuffer: ringBufferRef.current,
        windowResults: windowResultsRef.current,
        metrics: metricsRef.current,
      });

      if (!hasCompletedRef.current && elapsedSec >= sessionEndSec) {
        hasCompletedRef.current = true;
        frozenElapsedSecRef.current = elapsedSec;
        setSessionState('complete');
        return;
      }

      const drawDurationMs = performance.now() - drawStartMs;
      trackFrameMetrics(metricsRef.current, frameTimestampMs, drawDurationMs);

      frameHandleRef.current = requestAnimationFrame(render);
    };

    frameHandleRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frameHandleRef.current);
      frameHandleRef.current = 0;
      resizeObserver.disconnect();
      void stopDetectorIngest(audioResourcesRef.current);
    };
  }, [expectedRange.maxMidi, expectedRange.minMidi, isRunning, sessionEndSec, sessionKey, sessionState]);

  function handleStart() {
    metricsRef.current = createEmptyMetrics();
    windowResultsRef.current = createInitialWindowResults();
    setMetrics(createEmptyMetrics());
    setWindowResults(createInitialWindowResults());
    detectorLogRef.current = [];
    setDetectorLogSummary({ count: 0, lastGate: '-', lastRawHz: null });
    setSessionState('running');
    setSessionKey((value) => value + 1);
  }

  function handleStop() {
    frozenElapsedSecRef.current = latestElapsedSecRef.current;
    setSessionState('stopped');
  }

  function handleRetry() {
    metricsRef.current = createEmptyMetrics();
    windowResultsRef.current = createInitialWindowResults();
    setMetrics(createEmptyMetrics());
    setWindowResults(createInitialWindowResults());
    detectorLogRef.current = [];
    setDetectorLogSummary({ count: 0, lastGate: '-', lastRawHz: null });
    setSessionState('running');
    setSessionKey((value) => value + 1);
  }

  function handleClearDetectorLog() {
    detectorLogRef.current = [];
    setDetectorLogSummary({ count: 0, lastGate: '-', lastRawHz: null });
  }

  function handleExportDetectorLog() {
    const rows = detectorLogRef.current;
    if (!rows.length) {
      return;
    }

    const header = [
      'tick',
      'timeSec',
      'db',
      'rawHz',
      'rawClarity',
      'acceptedHz',
      'midi',
      'clarity',
      'voiced',
      'gateReason',
      'minDbThreshold',
      'minClarityThreshold',
      'minFreqHz',
      'maxFreqHz',
    ];
    const csvLines = [header.join(',')];
    rows.forEach((row) => {
      csvLines.push([
        row.tick,
        formatCsvNumber(row.timeSec),
        formatCsvNumber(row.db),
        formatCsvNumber(row.rawHz),
        formatCsvNumber(row.rawClarity),
        formatCsvNumber(row.acceptedHz),
        formatCsvNumber(row.midi),
        formatCsvNumber(row.clarity),
        row.voiced ? '1' : '0',
        row.gateReason,
        formatCsvNumber(row.minDbThreshold),
        formatCsvNumber(row.minClarityThreshold),
        formatCsvNumber(row.minFreqHz),
        formatCsvNumber(row.maxFreqHz),
      ].join(','));
    });

    const blob = new Blob([`${csvLines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    anchor.href = url;
    anchor.download = `sing-graph-v2-detector-log-${stamp}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="list">
      <section className="card controls">
        <h3>Singing Graph V2 Lab</h3>
        <p style={{ margin: 0 }}>
          Isolated performance-first workspace. Current scope: session lifecycle, render loop, timeline viewport,
          and diagnostics scaffolding.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="button" onClick={handleStart} disabled={isRunning}>
            Start
          </button>
          <button type="button" className="button secondary" onClick={handleStop} disabled={!isRunning}>
            Stop
          </button>
          <button type="button" className="button secondary" onClick={handleRetry}>
            Retry
          </button>
          <button type="button" className="button secondary" onClick={handleExportDetectorLog}>
            Export Detector Log CSV
          </button>
          <button type="button" className="button secondary" onClick={handleClearDetectorLog}>
            Clear Log
          </button>
          <span className="badge">State: {sessionState}</span>
          <span className="badge">Log Rows: {detectorLogSummary.count}</span>
          <span className="badge">Last Gate: {detectorLogSummary.lastGate}</span>
          <span className="badge">Last Raw Hz: {Number.isFinite(detectorLogSummary.lastRawHz) ? detectorLogSummary.lastRawHz.toFixed(2) : '-'}</span>
        </div>
      </section>

      <section className="card" style={{ padding: 12 }}>
        <canvas ref={canvasRef} className="mic-settings-canvas" />
      </section>

      <section className="readouts">
        <MetricCard label="Avg Draw (ms)" value={metrics.avgDrawMs.toFixed(2)} />
        <MetricCard label="P95 Draw (ms)" value={metrics.p95DrawMs.toFixed(2)} />
        <MetricCard label="FPS" value={metrics.fps.toFixed(1)} />
        <MetricCard label="Avg Detect (ms)" value={metrics.avgDetectorMs.toFixed(2)} />
        <MetricCard label="P95 Detect (ms)" value={metrics.p95DetectorMs.toFixed(2)} />
        <MetricCard label="Samples" value={String(metrics.sampleCount)} />
        <MetricCard label="Voiced %" value={`${(metrics.voicedRatio * 100).toFixed(0)}%`} />
        <MetricCard label="Latest MIDI" value={Number.isFinite(metrics.latestMidi) ? metrics.latestMidi.toFixed(2) : '-'} />
        <MetricCard label="Passed Notes" value={String(metrics.passedWindows)} />
        <MetricCard label="Failed Notes" value={String(metrics.failedWindows)} />
        <MetricCard label="Scored Notes" value={String(metrics.scoredWindows)} />
        <MetricCard label="Frames" value={String(metrics.frameCount)} />
        <MetricCard label="Zero-Size Frames" value={String(metrics.zeroSizeFrameCount)} />
        <MetricCard label="Draw Errors" value={String(metrics.drawErrorCount)} />
        <MetricCard label="Canvas Resizes" value={String(metrics.canvasResizeCount)} />
      </section>

      <section className="card controls">
        <h3 style={{ margin: 0 }}>Window Results</h3>
        <div style={{ display: 'grid', gap: 6 }}>
          {EXPECTED_WINDOWS.map((window) => {
            const result = windowResults[window.id];
            const status = result?.status ?? 'pending';
            return (
              <div key={window.id} className="row" style={{ gridTemplateColumns: 'auto auto 1fr', gap: 10 }}>
                <strong>{window.id}</strong>
                <span className="badge">{status}</span>
                <span style={{ color: '#94a3b8', fontSize: 12 }}>
                  {result?.reason ?? `target midi ${window.midi}`}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
    </div>
  );
}

function createEmptyMetrics() {
  return {
    frameCount: 0,
    fps: 0,
    avgDrawMs: 0,
    p95DrawMs: 0,
    avgDetectorMs: 0,
    p95DetectorMs: 0,
    sampleCount: 0,
    voicedCount: 0,
    voicedRatio: 0,
    latestMidi: null,
    scoredWindows: 0,
    passedWindows: 0,
    failedWindows: 0,
    zeroSizeFrameCount: 0,
    drawErrorCount: 0,
    canvasResizeCount: 0,
    lastFrameTimestampMs: 0,
    drawSamples: [],
    detectorSamples: [],
    elapsedSec: 0,
  };
}

function createInitialWindowResults() {
  return EXPECTED_WINDOWS.reduce((result, window) => {
    result[window.id] = {
      status: 'pending',
      evaluated: false,
      reason: null,
      medianMidi: null,
      centsError: null,
      coverage: 0,
    };
    return result;
  }, {});
}

function createEmptyAudioResources() {
  return {
    context: null,
    stream: null,
    source: null,
    analyser: null,
    timer: null,
  };
}

function trackFrameMetrics(metrics, frameTimestampMs, drawDurationMs) {
  metrics.frameCount += 1;

  if (metrics.lastFrameTimestampMs > 0) {
    const delta = frameTimestampMs - metrics.lastFrameTimestampMs;
    if (delta > 0) {
      const instantaneousFps = 1000 / delta;
      metrics.fps = metrics.fps === 0 ? instantaneousFps : metrics.fps * 0.85 + instantaneousFps * 0.15;
    }
  }
  metrics.lastFrameTimestampMs = frameTimestampMs;

  metrics.drawSamples.push(drawDurationMs);
  if (metrics.drawSamples.length > 240) {
    metrics.drawSamples.shift();
  }

  const total = metrics.drawSamples.reduce((sum, value) => sum + value, 0);
  metrics.avgDrawMs = total / Math.max(1, metrics.drawSamples.length);

  const sorted = [...metrics.drawSamples].sort((left, right) => left - right);
  const p95Index = Math.max(0, Math.floor(sorted.length * 0.95) - 1);
  metrics.p95DrawMs = sorted[p95Index] ?? 0;
}

function trackDetectorMetrics(metrics, durationMs, midi, voiced) {
  metrics.detectorSamples.push(durationMs);
  if (metrics.detectorSamples.length > 240) {
    metrics.detectorSamples.shift();
  }

  const total = metrics.detectorSamples.reduce((sum, value) => sum + value, 0);
  metrics.avgDetectorMs = total / Math.max(1, metrics.detectorSamples.length);
  const sorted = [...metrics.detectorSamples].sort((left, right) => left - right);
  const p95Index = Math.max(0, Math.floor(sorted.length * 0.95) - 1);
  metrics.p95DetectorMs = sorted[p95Index] ?? 0;

  metrics.sampleCount += 1;
  if (voiced) {
    metrics.voicedCount += 1;
  }
  metrics.voicedRatio = metrics.voicedCount / Math.max(1, metrics.sampleCount);
  metrics.latestMidi = Number.isFinite(midi) ? midi : null;
}

async function startDetectorIngest({ sessionStartMsRef, ringBufferRef, metricsRef, audioResourcesRef, detectorLogRef }) {
  await stopDetectorIngest(audioResourcesRef.current);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const context = new AudioContext();
    await context.resume().catch(() => undefined);

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);

    const detector = PitchDetector.forFloat32Array(FFT_SIZE);
    const sampleBuffer = new Float32Array(FFT_SIZE);
    const trackerState = createPitchTrackerState();

    audioResourcesRef.current = {
      context,
      stream,
      source,
      analyser,
      timer: globalThis.setInterval(() => {
        if (!sessionStartMsRef.current) {
          return;
        }

        const tickStartMs = performance.now();
        const nowSec = (tickStartMs - sessionStartMsRef.current) / 1000;

        analyser.getFloatTimeDomainData(sampleBuffer);

        let rms = 0;
        for (let index = 0; index < sampleBuffer.length; index += 1) {
          const value = sampleBuffer[index];
          rms += value * value;
        }
        rms = Math.sqrt(rms / sampleBuffer.length);
        const db = 20 * Math.log10(Math.max(1e-8, rms));

        let midi = null;
        let clarity = null;
        let voiced = false;
        let rawHz = null;
        let rawClarity = null;
        let acceptedHz = null;
        let gateReason = 'db-below-threshold';

        if (db >= MIN_DB_THRESHOLD) {
          const [detectedHz, detectedClarity] = detector.findPitch(sampleBuffer, context.sampleRate);
          rawHz = Number.isFinite(detectedHz) ? detectedHz : null;
          rawClarity = Number.isFinite(detectedClarity) ? detectedClarity : null;
          const tracked = trackPitchSample({
            rawHz: detectedHz,
            rawClarity: detectedClarity,
            nowSec,
            trackerState,
          });
          midi = tracked.midi;
          clarity = tracked.clarity;
          voiced = tracked.voiced;
          acceptedHz = tracked.acceptedHz;
          gateReason = tracked.gateReason;
        }

        pushPitchSample(ringBufferRef.current, {
          timeSec: nowSec,
          midi,
          clarity,
          db,
          voiced,
        });

        const detectorDurationMs = performance.now() - tickStartMs;
        trackDetectorMetrics(metricsRef.current, detectorDurationMs, midi, voiced);

        const tick = detectorLogRef.current.length + 1;
        detectorLogRef.current.push({
          tick,
          timeSec: nowSec,
          db,
          rawHz,
          rawClarity,
          acceptedHz,
          midi,
          clarity,
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
      }, DETECTOR_POLL_MS),
    };
  } catch {
    audioResourcesRef.current = createEmptyAudioResources();
  }
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

function formatCsvNumber(value) {
  return Number.isFinite(value) ? String(value) : '';
}

async function stopDetectorIngest(resources) {
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

function evaluateExpectedWindows({ elapsedSec, ringBuffer, windowResults, metrics }) {
  metrics.elapsedSec = elapsedSec;
  for (const window of EXPECTED_WINDOWS) {
    const existing = windowResults[window.id];
    if (!existing || existing.evaluated || elapsedSec < window.endSec) {
      continue;
    }

    const evaluation = evaluateWindow(window, ringBuffer);
    windowResults[window.id] = {
      ...evaluation,
      evaluated: true,
    };

    metrics.scoredWindows += 1;
    if (evaluation.status === 'pass') {
      metrics.passedWindows += 1;
    } else {
      metrics.failedWindows += 1;
    }
  }
}

function evaluateWindow(window, ringBuffer) {
  let sampleCount = 0;
  const voicedMidis = [];

  forEachSampleInTimeRange(ringBuffer, window.startSec, window.endSec, (sample) => {
    sampleCount += 1;
    if (sample.voiced && Number.isFinite(sample.midi) && Number.isFinite(sample.clarity) && sample.clarity >= SCORING_MIN_CLARITY) {
      voicedMidis.push(sample.midi);
    }
  });

  if (sampleCount <= 0) {
    return {
      status: 'fail',
      reason: 'no samples in window',
      medianMidi: null,
      centsError: null,
      coverage: 0,
    };
  }

  const coverage = voicedMidis.length / sampleCount;
  if (coverage < SCORING_MIN_COVERAGE || voicedMidis.length === 0) {
    return {
      status: 'fail',
      reason: `insufficient voiced coverage (${Math.round(coverage * 100)}%)`,
      medianMidi: null,
      centsError: null,
      coverage,
    };
  }

  const medianMidi = median(voicedMidis);
  const centsError = Math.abs((medianMidi - window.midi) * 100);
  const passed = centsError <= SCORING_TOLERANCE_CENTS;
  return {
    status: passed ? 'pass' : 'fail',
    reason: `${passed ? 'matched' : 'out of tune'} (${centsError.toFixed(0)} cents)` ,
    medianMidi,
    centsError,
    coverage,
  };
}

function median(values) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function drawIdleFrame(context, width, height) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#020617';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#cbd5e1';
  context.font = '14px Inter, Segoe UI, sans-serif';
  context.textAlign = 'center';
  context.fillText('Press Start to run V2 graph lab rendering loop', width / 2, height / 2);
}

function drawLabFrame({ context, width, height, elapsedSec, minMidi, maxMidi, ringBuffer, windowResults }) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#020617';
  context.fillRect(0, 0, width, height);

  drawGrid(context, width, height, minMidi, maxMidi);

  const xStartSec = Math.max(0, elapsedSec - VIEWPORT_SECONDS * TARGET_CURSOR_RATIO);
  const xEndSec = xStartSec + VIEWPORT_SECONDS;
  const toX = (seconds) => ((seconds - xStartSec) / Math.max(0.001, xEndSec - xStartSec)) * width;
  const toY = (midi) => {
    const normalized = (midi - minMidi) / Math.max(1, maxMidi - minMidi);
    return height - normalized * height;
  };

  EXPECTED_WINDOWS.forEach((window) => {
    if (window.endSec < xStartSec || window.startSec > xEndSec) {
      return;
    }

    const x = toX(window.startSec);
    const windowWidth = Math.max(2, toX(window.endSec) - x);
    const y = toY(window.midi) - 6;

    const result = windowResults[window.id];
    const status = result?.status ?? 'pending';
    if (status === 'pass') {
      context.fillStyle = 'rgba(22, 163, 74, 0.55)';
      context.strokeStyle = '#86efac';
    } else if (status === 'fail') {
      context.fillStyle = 'rgba(220, 38, 38, 0.55)';
      context.strokeStyle = '#fca5a5';
    } else {
      context.fillStyle = 'rgba(148, 163, 184, 0.32)';
      context.strokeStyle = 'rgba(148, 163, 184, 0.70)';
    }
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(x, y, windowWidth, 12, 5);
    context.fill();
    context.stroke();
  });

  drawLiveTrace(context, {
    ringBuffer,
    xStartSec,
    xEndSec,
    toX,
    toY,
  });

  const nowX = toX(elapsedSec);
  context.strokeStyle = '#f8fafc';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(nowX, 0);
  context.lineTo(nowX, height);
  context.stroke();

  context.fillStyle = '#cbd5e1';
  context.font = '12px Inter, Segoe UI, sans-serif';
  context.textAlign = 'left';
  context.fillText(`t=${elapsedSec.toFixed(2)}s`, 8, 16);
}

function drawLiveTrace(context, { ringBuffer, xStartSec, xEndSec, toX, toY }) {
  context.strokeStyle = '#22d3ee';
  context.lineWidth = 3;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.beginPath();

  let hasPoint = false;
  let needsMove = true;
  let previousMidi = null;
  let lastVoicedTimeSec = null;

  forEachSampleInTimeRange(ringBuffer, xStartSec, xEndSec, (sample) => {
    if (!sample.voiced || !Number.isFinite(sample.midi)) {
      const gapLimit = Number.isFinite(sample.db) && sample.db >= MIN_DB_THRESHOLD
        ? MAX_DRAW_GAP_HIGH_ENERGY_SEC
        : MAX_DRAW_GAP_SEC;
      if (!Number.isFinite(lastVoicedTimeSec) || (sample.timeSec - lastVoicedTimeSec) > gapLimit) {
        needsMove = true;
        previousMidi = null;
      }
      return;
    }

    if (Number.isFinite(previousMidi) && Math.abs(sample.midi - previousMidi) > MAX_DRAW_JUMP_SEMITONES) {
      needsMove = true;
    }

    const x = toX(sample.timeSec);
    const y = toY(sample.midi);

    if (needsMove) {
      context.moveTo(x, y);
      needsMove = false;
    } else {
      context.lineTo(x, y);
    }

    hasPoint = true;
    previousMidi = sample.midi;
    lastVoicedTimeSec = sample.timeSec;
  });

  if (hasPoint) {
    context.stroke();
  }
}

function drawGrid(context, width, height, minMidi, maxMidi) {
  const midiRange = Math.max(1, maxMidi - minMidi);
  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    const y = height - ((midi - minMidi) / midiRange) * height;
    context.strokeStyle = midi % 12 === 0 ? '#334155' : '#1e293b';
    context.lineWidth = midi % 12 === 0 ? 1.2 : 0.7;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}
