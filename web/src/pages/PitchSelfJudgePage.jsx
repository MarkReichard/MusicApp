import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { drawChart } from '../lib/drawChart';
import { loadPitchRangeSettings } from '../lib/pitchRangeSettings';
import { loadPitchSettings } from '../lib/pitchSettings';
import { usePitchDetector } from '../lib/usePitchDetector';
import { INSTRUMENT_OPTIONS, getPianoAudioContext, loadInstrument, scheduleMicrotonalPianoNote, stopAllNotes } from '../lib/pianoSynth';
import { midiToFrequencyHz, midiToNoteLabel } from '../lib/musicTheory';

const STORAGE_KEY = 'musicapp.web.pitchSelfJudge.v1';
const VOICE_INSTRUMENT = 'choir_aahs';
const TARGET_DURATION_S = 1.8;
const TARGET_GAIN = 0.18;
const DELAY_MIN_MS = 1000;
const DELAY_MAX_MS = 2000;
const RECORD_WINDOW_MS = 3000;
const DEFAULT_ON_TARGET_CENTS = 25;
const GRAPH_RANGE_SEMITONES = 6;
const DISCARD_LEADING_MS = 450;
const STABLE_WINDOW_SIZE = 8;
const STABLE_SPAN_CENTS = 35;

const MAGNITUDE_BINS = [
  { value: '0-25', label: '0–25 cents', maxInclusive: 25 },
  { value: '25-50', label: '25–50 cents', maxInclusive: 50 },
  { value: '50-100', label: '50–100 cents', maxInclusive: 100 },
  { value: '100+', label: '100+ cents', maxInclusive: Number.POSITIVE_INFINITY },
];

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function classifyDirection(signedCents, onTargetCents = DEFAULT_ON_TARGET_CENTS) {
  if (!Number.isFinite(signedCents)) return 'no-pitch';
  if (signedCents <= -onTargetCents) return 'flat';
  if (signedCents >= onTargetCents) return 'sharp';
  return 'on-target';
}

function classifyMagnitude(absCents) {
  if (!Number.isFinite(absCents)) return null;
  const bin = MAGNITUDE_BINS.find((item) => absCents <= item.maxInclusive);
  return bin?.value ?? '100+';
}

function loadAttempts() {
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      attempts: Array.isArray(parsed?.attempts) ? parsed.attempts.slice(-400) : [],
      selectedInstrument: typeof parsed?.selectedInstrument === 'string' && parsed.selectedInstrument
        ? parsed.selectedInstrument
        : VOICE_INSTRUMENT,
      onTargetCents: Number.isFinite(parsed?.onTargetCents)
        ? Math.max(5, Math.min(60, Math.round(parsed.onTargetCents)))
        : DEFAULT_ON_TARGET_CENTS,
    };
  } catch {
    return {
      attempts: [],
      selectedInstrument: VOICE_INSTRUMENT,
      onTargetCents: DEFAULT_ON_TARGET_CENTS,
    };
  }
}

function summarizeAttempts(attempts) {
  const total = attempts.length;
  if (!total) {
    return {
      total: 0,
      directionAccuracy: null,
      binAccuracy: null,
      medianAbsCents: null,
    };
  }

  const directionCorrect = attempts.filter((attempt) => attempt.directionCorrect).length;
  const withBin = attempts.filter((attempt) => Boolean(attempt.userMagnitudeBin));
  const binCorrect = withBin.filter((attempt) => attempt.magnitudeCorrect).length;
  const absValues = attempts
    .map((attempt) => Number.isFinite(attempt.absCents) ? attempt.absCents : null)
    .filter((value) => Number.isFinite(value));

  return {
    total,
    directionAccuracy: directionCorrect / total,
    binAccuracy: withBin.length ? binCorrect / withBin.length : null,
    medianAbsCents: median(absValues),
  };
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function signedCentsText(signedCents) {
  if (!Number.isFinite(signedCents)) return 'No pitch detected';
  const rounded = Math.round(signedCents);
  const prefix = rounded > 0 ? '+' : '';
  return `${prefix}${rounded}¢`;
}

function choiceButtonClass(selectedValue, value) {
  return selectedValue === value ? 'button' : 'button secondary';
}

function buildTargetPool(minMidi, maxMidi) {
  const pool = [];
  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    pool.push(midi);
  }
  return pool.length ? pool : [60, 62, 64, 65, 67, 69, 71];
}

function trimPitchFindingSegment(sampled) {
  if (!Array.isArray(sampled) || sampled.length <= STABLE_WINDOW_SIZE + 2) return sampled;

  const firstTimeMs = sampled[0]?.timeMs;
  const afterWarmup = Number.isFinite(firstTimeMs)
    ? sampled.filter((point) => point.timeMs >= firstTimeMs + DISCARD_LEADING_MS)
    : sampled;

  if (afterWarmup.length <= STABLE_WINDOW_SIZE + 2) return afterWarmup;

  for (let index = 0; index <= afterWarmup.length - STABLE_WINDOW_SIZE; index += 1) {
    const window = afterWarmup.slice(index, index + STABLE_WINDOW_SIZE);
    const midiValues = window.map((point) => point.midi).filter((value) => Number.isFinite(value));
    if (midiValues.length < STABLE_WINDOW_SIZE) continue;
    const minMidi = Math.min(...midiValues);
    const maxMidi = Math.max(...midiValues);
    const spanCents = (maxMidi - minMidi) * 100;
    if (spanCents <= STABLE_SPAN_CENTS) {
      return afterWarmup.slice(index);
    }
  }

  return afterWarmup;
}

export function PitchSelfJudgePage() {
  const pitchRange = useMemo(() => loadPitchRangeSettings(), []);
  const pitchSettings = useMemo(() => loadPitchSettings(), []);
  const [initialState] = useState(() => loadAttempts());
  const [attempts, setAttempts] = useState(initialState.attempts);
  const [selectedInstrument, setSelectedInstrument] = useState(initialState.selectedInstrument);
  const [onTargetCents, setOnTargetCents] = useState(initialState.onTargetCents);
  const [instrumentReady, setInstrumentReady] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | playing-target | delay | singing | self-judge | reveal
  const [targetMidi, setTargetMidi] = useState(null);
  const [capture, setCapture] = useState({ signedCents: null, absCents: null, direction: 'no-pitch', magnitudeBin: null, contour: [] });
  const [selfDirection, setSelfDirection] = useState(null);
  const [selfMagnitudeBin, setSelfMagnitudeBin] = useState('');
  const [reveal, setReveal] = useState(null);

  const { history, clearHistory } = usePitchDetector(pitchSettings, true, { maxHistoryPoints: 16000 });
  const historyRef = useRef(history);
  const captureStartMsRef = useRef(null);
  const timersRef = useRef([]);
  const canvasRef = useRef(null);

  const summary = useMemo(() => summarizeAttempts(attempts), [attempts]);

  const targetPool = useMemo(() => {
    const minMidi = Number.isFinite(pitchRange.minMidi) ? Math.max(48, Math.round(pitchRange.minMidi)) : 55;
    const maxMidi = Number.isFinite(pitchRange.maxMidi) ? Math.min(79, Math.round(pitchRange.maxMidi)) : 72;
    return buildTargetPool(minMidi, maxMidi);
  }, [pitchRange]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ attempts, selectedInstrument, onTargetCents }));
    } catch {
      // ignore storage failures
    }
  }, [attempts, selectedInstrument, onTargetCents]);

  useEffect(() => {
    let cancelled = false;
    setInstrumentReady(false);
    void loadInstrument(selectedInstrument)
      .then(() => {
        if (!cancelled) setInstrumentReady(true);
      })
      .catch(() => {
        if (!cancelled) setInstrumentReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedInstrument]);

  useEffect(() => () => {
    timersRef.current.forEach((timerId) => globalThis.clearTimeout(timerId));
    timersRef.current = [];
    stopAllNotes();
  }, []);

  useEffect(() => {
    if (phase !== 'reveal') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const context = canvas.getContext('2d');
    context?.setTransform(dpr, 0, 0, dpr, 0, 0);

    const targetMidiForGraph = Number.isFinite(reveal?.targetMidi) ? reveal.targetMidi : targetMidi;
    const minGraphHz = Number.isFinite(targetMidiForGraph)
      ? midiToFrequencyHz(targetMidiForGraph - GRAPH_RANGE_SEMITONES)
      : (Number(pitchSettings.minFrequencyHz) || 80);
    const maxGraphHz = Number.isFinite(targetMidiForGraph)
      ? midiToFrequencyHz(targetMidiForGraph + GRAPH_RANGE_SEMITONES)
      : (Number(pitchSettings.maxFrequencyHz) || 1000);

    drawChart(canvas, capture.contour, minGraphHz, maxGraphHz, -70, 0);

    if (Number.isFinite(targetMidiForGraph) && context) {
      const minMidi = 69 + 12 * Math.log2(minGraphHz / 440);
      const maxMidi = 69 + 12 * Math.log2(maxGraphHz / 440);
      const normalized = (targetMidiForGraph - minMidi) / Math.max(1e-6, maxMidi - minMidi);
      const y = canvas.height - Math.max(0, Math.min(1, normalized)) * canvas.height;

      context.save();
      context.strokeStyle = '#fbbf24';
      context.lineWidth = 2;
      context.setLineDash([7, 6]);
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = '#fbbf24';
      context.font = '12px Inter, Segoe UI, sans-serif';
      context.textAlign = 'right';
      context.textBaseline = 'bottom';
      context.fillText('Target', canvas.width - 8, Math.max(12, y - 4));
      context.restore();
    }
  }, [capture.contour, phase, pitchSettings.maxFrequencyHz, pitchSettings.minFrequencyHz, reveal?.targetMidi, targetMidi]);

  function clearScheduledTimers() {
    timersRef.current.forEach((timerId) => globalThis.clearTimeout(timerId));
    timersRef.current = [];
  }

  function finalizeCapture(targetMidiValue) {
    const captureStartMs = captureStartMsRef.current;
    if (!Number.isFinite(captureStartMs)) return;
    const captureEndMs = performance.now();

    const sampled = historyRef.current
      .filter((point) => point.timeMs >= captureStartMs && point.timeMs <= captureEndMs)
      .filter((point) => Number.isFinite(point.pitchHz) && Number.isFinite(point.midi));

    const stableSampled = trimPitchFindingSegment(sampled);
    const midiValues = stableSampled.map((point) => point.midi);
    const measuredMidi = midiValues.length ? median(midiValues) : null;
    const signedCents = Number.isFinite(measuredMidi) ? (measuredMidi - targetMidiValue) * 100 : null;
    const absCents = Number.isFinite(signedCents) ? Math.abs(signedCents) : null;
    const direction = classifyDirection(signedCents, onTargetCents);
    const magnitudeBin = classifyMagnitude(absCents);

    const contour = stableSampled.map((point, index) => ({
      pitchHz: point.pitchHz,
      db: point.db,
      x: stableSampled.length <= 1 ? 0 : index / (stableSampled.length - 1),
    }));

    setCapture({
      signedCents,
      absCents,
      direction,
      magnitudeBin,
      contour,
    });
    setPhase('self-judge');
  }

  async function startExerciseTrial(options = {}) {
    const { reuseTargetMidi = null } = options;
    if (!instrumentReady) {
      try {
        await loadInstrument(selectedInstrument);
        setInstrumentReady(true);
      } catch {
        setInstrumentReady(false);
        return;
      }
    }

    clearScheduledTimers();
    stopAllNotes();

    const nextTargetMidi = Number.isFinite(reuseTargetMidi) ? reuseTargetMidi : pickRandom(targetPool);
    setTargetMidi(nextTargetMidi);
    setCapture({ signedCents: null, absCents: null, direction: 'no-pitch', magnitudeBin: null, contour: [] });
    setSelfDirection(null);
    setSelfMagnitudeBin('');
    setReveal(null);

    const ctx = getPianoAudioContext();
    const startAt = ctx.currentTime + 0.08;
    scheduleMicrotonalPianoNote(ctx, midiToFrequencyHz(nextTargetMidi), startAt, TARGET_DURATION_S, TARGET_GAIN);

    setPhase('playing-target');

    const afterTargetMs = (TARGET_DURATION_S + 0.06) * 1000;
    timersRef.current.push(globalThis.setTimeout(() => {
      setPhase('delay');
    }, afterTargetMs));

    const delayMs = randomBetween(DELAY_MIN_MS, DELAY_MAX_MS);
    timersRef.current.push(globalThis.setTimeout(() => {
      clearHistory();
      captureStartMsRef.current = performance.now();
      setPhase('singing');

      timersRef.current.push(globalThis.setTimeout(() => {
        finalizeCapture(nextTargetMidi);
      }, RECORD_WINDOW_MS));
    }, afterTargetMs + delayMs));
  }

  function retryCurrentTarget() {
    if (!Number.isFinite(targetMidi)) return;
    void startExerciseTrial({ reuseTargetMidi: targetMidi });
  }

  function submitSelfJudgment() {
    if (phase !== 'self-judge') return;

    const directionCorrect = selfDirection === capture.direction;
    const magnitudeCorrect = selfMagnitudeBin
      ? selfMagnitudeBin === capture.magnitudeBin
      : null;

    const attempt = {
      ts: Date.now(),
      targetMidi,
      targetNote: Number.isFinite(targetMidi) ? midiToNoteLabel(targetMidi) : '—',
      signedCents: capture.signedCents,
      absCents: capture.absCents,
      measuredDirection: capture.direction,
      measuredMagnitudeBin: capture.magnitudeBin,
      userDirection: selfDirection,
      userMagnitudeBin: selfMagnitudeBin || null,
      directionCorrect,
      magnitudeCorrect,
      contour: capture.contour,
    };

    setAttempts((previous) => [...previous, attempt].slice(-400));
    setReveal(attempt);
    setPhase('reveal');
  }

  function resetProgress() {
    setAttempts([]);
    setTargetMidi(null);
    setCapture({ signedCents: null, absCents: null, direction: 'no-pitch', magnitudeBin: null, contour: [] });
    setSelfDirection(null);
    setSelfMagnitudeBin('');
    setReveal(null);
    setPhase('idle');
  }

  const canSubmitSelf = phase === 'self-judge' && Boolean(selfDirection);
  const revealSignedCentsText = signedCentsText(reveal?.signedCents);
  const userVsActualDirection = reveal
    ? `You said: ${reveal.userDirection} · Actual: ${reveal.measuredDirection}`
    : '';
  const userVsActualMagnitude = reveal?.userMagnitudeBin
    ? `You said: ${reveal.userMagnitudeBin} · Actual: ${reveal.measuredMagnitudeBin ?? '—'}`
    : null;

  return (
    <div className="list" style={{ gap: 12 }}>
      <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Pitch Match — Self Judgment</h2>
          <Link className="button secondary" to="/pitch-match">Back to Pitch Match</Link>
        </div>
        <p style={{ margin: 0, color: '#94a3b8', fontSize: 13 }}>
          Hear a sung target, hold it in memory through a short silent delay, sing it back on “ah,” then self-judge before reveal.
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '360px 1fr' }}>
        <div className="card controls" style={{ gap: 10 }}>
          <div className="stat">
            <div className="k">Playback instrument</div>
            <div className="v" style={{ fontSize: 20 }}>{instrumentReady ? 'Ready' : 'Loading...'}</div>
            <small>{selectedInstrument}</small>
          </div>

          <div className="row">
            <label htmlFor="pitch-self-judge-instrument">Instrument</label>
            <select
              id="pitch-self-judge-instrument"
              value={selectedInstrument}
              onChange={(event) => setSelectedInstrument(event.target.value)}
              disabled={phase === 'playing-target' || phase === 'delay' || phase === 'singing'}
            >
              {INSTRUMENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="row">
            <label htmlFor="pitch-self-judge-ontarget-window">In-tune window (± cents)</label>
            <input
              id="pitch-self-judge-ontarget-window"
              type="range"
              min={5}
              max={60}
              step={1}
              value={onTargetCents}
              onChange={(event) => setOnTargetCents(Number(event.target.value))}
            />
            <small style={{ textAlign: 'right' }}>±{onTargetCents}¢</small>
          </div>

          <div className="stat">
            <div className="k">Attempts</div>
            <div className="v">{summary.total}</div>
            <small>Saved in browser storage</small>
          </div>

          <div className="stat">
            <div className="k">Direction self-judgment accuracy</div>
            <div className="v">{formatPercent(summary.directionAccuracy)}</div>
            <small>sharp / flat / on target</small>
          </div>

          <div className="stat">
            <div className="k">Magnitude bin accuracy</div>
            <div className="v">{formatPercent(summary.binAccuracy)}</div>
            <small>Only when bin chosen</small>
          </div>

          <div className="stat">
            <div className="k">Median absolute cents error</div>
            <div className="v">{Number.isFinite(summary.medianAbsCents) ? `${Math.round(summary.medianAbsCents)}¢` : '—'}</div>
            <small>Lower is better</small>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="button" type="button" onClick={startExerciseTrial} disabled={!instrumentReady || phase === 'playing-target' || phase === 'delay' || phase === 'singing'}>
              {targetMidi ? 'Next trial' : 'Start'}
            </button>
            <button className="button secondary" type="button" onClick={retryCurrentTarget} disabled={!instrumentReady || !Number.isFinite(targetMidi) || phase === 'playing-target' || phase === 'delay' || phase === 'singing'}>
              Retry
            </button>
            <button className="button secondary" type="button" onClick={resetProgress}>
              Reset progress
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 14, display: 'grid', gap: 12 }}>
          <div>
            <strong>Phase:</strong>{' '}
            {phase === 'idle' && 'Ready'}
            {phase === 'playing-target' && 'Listening to target note'}
            {phase === 'delay' && 'Silent delay (no visual cue)'}
            {phase === 'singing' && 'Sing now on “ah”'}
            {phase === 'self-judge' && 'Self-judge before reveal'}
            {phase === 'reveal' && 'Reveal'}
          </div>

          <div className="stat">
            <div className="k">Target note</div>
            <div className="v" style={{ fontSize: 24 }}>{Number.isFinite(targetMidi) ? midiToNoteLabel(targetMidi) : '—'}</div>
            <small>{phase === 'delay' ? 'Hold this in memory.' : 'No live pitch cue shown during delay/singing.'}</small>
          </div>

          {phase === 'self-judge' && (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className={choiceButtonClass(selfDirection, 'flat')} type="button" onClick={() => setSelfDirection('flat')}>
                  I sang flat
                </button>
                <button className={choiceButtonClass(selfDirection, 'on-target')} type="button" onClick={() => setSelfDirection('on-target')}>
                  I was on target
                </button>
                <button className={choiceButtonClass(selfDirection, 'sharp')} type="button" onClick={() => setSelfDirection('sharp')}>
                  I sang sharp
                </button>

                <label htmlFor="self-judge-magnitude-bin" style={{ color: '#cbd5e1', fontSize: 13 }}>
                  How far off?
                </label>
                <select
                  id="self-judge-magnitude-bin"
                  value={selfMagnitudeBin}
                  onChange={(event) => setSelfMagnitudeBin(event.target.value)}
                  style={{ width: 170 }}
                >
                  <option value="">Skip</option>
                  {MAGNITUDE_BINS.map((bin) => (
                    <option key={bin.value} value={bin.value}>{bin.label}</option>
                  ))}
                </select>
              </div>

              <small style={{ color: '#cbd5e1' }}>
                Selected direction: {selfDirection ?? '—'}
              </small>

              <small style={{ color: '#cbd5e1' }}>
                Selected magnitude: {selfMagnitudeBin || 'Skip'}
              </small>

              <div>
                <button className="button" type="button" onClick={submitSelfJudgment} disabled={!canSubmitSelf}>
                  Reveal result
                </button>
              </div>
            </>
          )}

          {phase === 'reveal' && reveal && (
            <>
              <div
                className="stat"
                style={{
                  display: 'grid',
                  gap: 6,
                  borderColor: reveal.directionCorrect ? '#166534' : '#7f1d1d',
                  background: reveal.directionCorrect ? '#052e16' : '#3b0a0a',
                }}
              >
                <div className="k">Result</div>
                <div className="v" style={{ color: reveal.directionCorrect ? '#86efac' : '#fca5a5', fontSize: 24 }}>
                  {reveal.directionCorrect ? '✓ Direction self-judgment correct' : '✗ Direction self-judgment incorrect'}
                </div>
                <small>
                  Signed cents error: {revealSignedCentsText}.
                </small>
                <small>
                  In-tune window used: ±{onTargetCents}¢
                </small>
                <small>
                  {userVsActualDirection}
                </small>
                {reveal.userMagnitudeBin ? (
                  <small>
                    Magnitude bin {reveal.magnitudeCorrect ? 'correct' : 'incorrect'} · {userVsActualMagnitude}
                  </small>
                ) : null}
              </div>

              <div className="card" style={{ padding: 10, display: 'grid', gap: 8 }}>
                <strong style={{ fontSize: 13 }}>Pitch contour (singing window)</strong>
                <canvas ref={canvasRef} style={{ width: '100%', height: 260, border: '1px solid #334155', borderRadius: 10, background: '#020617' }} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
