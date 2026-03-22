import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { INSTRUMENT_OPTIONS, getPianoAudioContext, loadInstrument, scheduleMicrotonalPianoNote, stopAllNotes } from '../lib/pianoSynth';
import { midiToFrequencyHz, midiToNoteLabel } from '../lib/musicTheory';

const STORAGE_KEY = 'musicapp.web.adaptiveDirection.v1';
const TONE_DURATION_S = 0.52;
const TONE_GAP_S = 0.28;
const TONE_GAIN = 0.16;
const START_CENTS = 200;
const MIN_CENTS = 5;
const MAX_CENTS = 350;
const START_INSTRUMENT = 'choir_aahs';

const REGISTER_CONFIG = {
  low: { label: 'Low register', anchorMidis: [48, 52, 55, 57] },
  high: { label: 'High register', anchorMidis: [64, 67, 71, 74] },
};

function defaultRegisterState() {
  return {
    stepCents: START_CENTS,
    streakCorrect: 0,
    lastMove: null,
    reversals: 0,
    bestCents: START_CENTS,
    correct: 0,
    total: 0,
  };
}

function createDefaultState() {
  return {
    selectedInstrument: START_INSTRUMENT,
    low: defaultRegisterState(),
    high: defaultRegisterState(),
    history: [],
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function loadState() {
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    const parsed = JSON.parse(raw);
    const merged = {
      ...createDefaultState(),
      ...parsed,
      low: { ...defaultRegisterState(), ...(parsed?.low) },
      high: { ...defaultRegisterState(), ...(parsed?.high) },
    };
    merged.low.stepCents = clamp(Number(merged.low.stepCents) || START_CENTS, MIN_CENTS, MAX_CENTS);
    merged.high.stepCents = clamp(Number(merged.high.stepCents) || START_CENTS, MIN_CENTS, MAX_CENTS);
    merged.low.bestCents = clamp(Number(merged.low.bestCents) || merged.low.stepCents, MIN_CENTS, MAX_CENTS);
    merged.high.bestCents = clamp(Number(merged.high.bestCents) || merged.high.stepCents, MIN_CENTS, MAX_CENTS);
    merged.history = Array.isArray(merged.history) ? merged.history.slice(-300) : [];
    return merged;
  } catch {
    return createDefaultState();
  }
}

function pickRandom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function chooseRegister(lowState, highState) {
  if (lowState.total < highState.total) return 'low';
  if (highState.total < lowState.total) return 'high';
  return Math.random() < 0.5 ? 'low' : 'high';
}

function buildTrial(lowState, highState) {
  const register = chooseRegister(lowState, highState);
  const direction = Math.random() < 0.5 ? 'higher' : 'lower';
  const stepCents = register === 'low' ? lowState.stepCents : highState.stepCents;
  const anchorMidi = pickRandom(REGISTER_CONFIG[register].anchorMidis);
  const firstFreq = midiToFrequencyHz(anchorMidi);
  const secondFreq = firstFreq * Math.pow(2, (direction === 'higher' ? stepCents : -stepCents) / 1200);

  return {
    register,
    direction,
    stepCents,
    anchorMidi,
    firstFreq,
    secondFreq,
  };
}

function updateRegisterAfterTrial(previous, wasCorrect) {
  const next = { ...previous };
  next.total += 1;
  if (wasCorrect) {
    next.correct += 1;
    next.streakCorrect += 1;
    if (next.streakCorrect >= 2) {
      const oldStep = next.stepCents;
      next.stepCents = clamp(next.stepCents * 0.84, MIN_CENTS, MAX_CENTS);
      const move = 'down';
      if (next.lastMove && next.lastMove !== move) next.reversals += 1;
      next.lastMove = move;
      next.streakCorrect = 0;
      if (next.stepCents < next.bestCents) next.bestCents = next.stepCents;
      if (oldStep === next.stepCents) next.streakCorrect = 0;
    }
  } else {
    next.streakCorrect = 0;
    const oldStep = next.stepCents;
    next.stepCents = clamp(next.stepCents * 1.22, MIN_CENTS, MAX_CENTS);
    const move = 'up';
    if (next.lastMove && next.lastMove !== move) next.reversals += 1;
    next.lastMove = move;
    if (oldStep === next.stepCents) next.lastMove = move;
  }
  return next;
}

function accuracy(registerState) {
  if (!registerState.total) return null;
  return registerState.correct / registerState.total;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

export function AdaptiveDirectionPage() {
  const [state, setState] = useState(() => loadState());
  const [trial, setTrial] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | playing | answer | confidence | feedback
  const [guessDirection, setGuessDirection] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [lastOutcome, setLastOutcome] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const playbackTimeoutRef = useRef(null);

  const lowAccuracy = useMemo(() => accuracy(state.low), [state.low]);
  const highAccuracy = useMemo(() => accuracy(state.high), [state.high]);

  useEffect(() => {
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore storage failures
    }
  }, [state]);

  useEffect(() => {
    void loadInstrument(state.selectedInstrument);
  }, [state.selectedInstrument]);

  useEffect(() => () => {
    if (playbackTimeoutRef.current) {
      globalThis.clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
    stopAllNotes();
  }, []);

  function playTrial(nextTrial) {
    if (playbackTimeoutRef.current) {
      globalThis.clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
    stopAllNotes();
    const ctx = getPianoAudioContext();
    const startAt = ctx.currentTime + 0.08;
    scheduleMicrotonalPianoNote(ctx, nextTrial.firstFreq, startAt, TONE_DURATION_S, TONE_GAIN);
    scheduleMicrotonalPianoNote(ctx, nextTrial.secondFreq, startAt + TONE_DURATION_S + TONE_GAP_S, TONE_DURATION_S, TONE_GAIN);

    const totalMs = (TONE_DURATION_S * 2 + TONE_GAP_S + 0.2) * 1000;
    setPhase('playing');
    playbackTimeoutRef.current = globalThis.setTimeout(() => {
      setPhase('answer');
      playbackTimeoutRef.current = null;
    }, totalMs);
  }

  function startNextTrial() {
    const nextTrial = buildTrial(state.low, state.high);
    setTrial(nextTrial);
    setGuessDirection(null);
    setConfidence(null);
    setLastOutcome(null);
    playTrial(nextTrial);
  }

  function submitDirection(direction) {
    setGuessDirection(direction);
    setPhase('confidence');
  }

  function replayCurrentTrial() {
    if (!trial || phase === 'playing') return;
    setGuessDirection(null);
    setConfidence(null);
    setLastOutcome(null);
    playTrial(trial);
  }

  function runEvaluation() {
    const grouped = new Map();

    for (const item of state.history) {
      if (!item || !Number.isFinite(item.anchorMidi) || !item.register) continue;
      const key = `${item.register}:${item.anchorMidi}`;
      const current = grouped.get(key) ?? {
        register: item.register,
        anchorMidi: item.anchorMidi,
        total: 0,
        correct: 0,
      };
      current.total += 1;
      if (item.wasCorrect) current.correct += 1;
      grouped.set(key, current);
    }

    const leastAccuratePitches = [...grouped.values()]
      .map((entry) => ({
        ...entry,
        accuracy: entry.total > 0 ? entry.correct / entry.total : 0,
      }))
      .sort((left, right) => {
        if (left.accuracy !== right.accuracy) return left.accuracy - right.accuracy;
        return right.total - left.total;
      })
      .slice(0, 5);

    setEvaluation({
      leastAccuratePitches,
      lowStepCents: state.low.stepCents,
      highStepCents: state.high.stepCents,
      lowAccuracy,
      highAccuracy,
    });
  }

  function submitConfidence(level) {
    if (!trial || !guessDirection) return;
    const wasCorrect = guessDirection === trial.direction;
    const register = trial.register;

    const nextRegisterState = updateRegisterAfterTrial(state[register], wasCorrect);
    const nextState = {
      ...state,
      [register]: nextRegisterState,
      history: [
        ...state.history,
        {
          ts: Date.now(),
          register,
          anchorMidi: trial.anchorMidi,
          stepCents: trial.stepCents,
          answer: guessDirection,
          correctDirection: trial.direction,
          wasCorrect,
          confidence: level,
        },
      ].slice(-300),
    };

    setState(nextState);
    setConfidence(level);
    setLastOutcome({
      wasCorrect,
      correctDirection: trial.direction,
      register,
      nextStepCents: nextRegisterState.stepCents,
    });
    setPhase('feedback');
  }

  function resetProgress() {
    const fresh = createDefaultState();
    setState(fresh);
    setTrial(null);
    setGuessDirection(null);
    setConfidence(null);
    setLastOutcome(null);
    setPhase('idle');
  }

  return (
    <div className="list" style={{ gap: 12 }}>
      <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Adaptive Higher/Lower Training</h2>
          <Link className="button secondary" to="/ear-training">Back to Ear Training</Link>
        </div>
        <p style={{ margin: 0, color: '#94a3b8', fontSize: 13 }}>
          Two-tone discrimination with direction labeling. Separate low/high staircases adapt independently and are saved in browser storage.
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '360px 1fr' }}>
        <div className="card controls" style={{ gap: 10 }}>
          <div className="row">
            <label htmlFor="adaptive-direction-instrument">Instrument</label>
            <select
              id="adaptive-direction-instrument"
              value={state.selectedInstrument}
              onChange={(event) => setState((previous) => ({ ...previous, selectedInstrument: event.target.value }))}
              disabled={phase === 'playing'}
            >
              {INSTRUMENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="stat">
            <div className="k">Low register step</div>
            <div className="v">{state.low.stepCents.toFixed(1)}¢</div>
            <small>Best {state.low.bestCents.toFixed(1)}¢ • Accuracy {formatPercent(lowAccuracy)}</small>
          </div>

          <div className="stat">
            <div className="k">High register step</div>
            <div className="v">{state.high.stepCents.toFixed(1)}¢</div>
            <small>Best {state.high.bestCents.toFixed(1)}¢ • Accuracy {formatPercent(highAccuracy)}</small>
          </div>

          <div className="stat">
            <div className="k">Trials saved</div>
            <div className="v">{state.history.length}</div>
            <small>Low trials {state.low.total} • High trials {state.high.total}</small>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="button" type="button" onClick={startNextTrial} disabled={phase === 'playing'}>
              {trial ? 'Play next trial' : 'Start'}
            </button>
            <button className="button secondary" type="button" onClick={runEvaluation}>
              Evaluate
            </button>
            <button className="button secondary" type="button" onClick={resetProgress} disabled={phase === 'playing'}>
              Reset progress
            </button>
          </div>

          {evaluation && (
            <div className="stat" style={{ display: 'grid', gap: 6 }}>
              <div className="k">Evaluation</div>
              <small>
                Current threshold: low {evaluation.lowStepCents.toFixed(1)}¢ ({formatPercent(evaluation.lowAccuracy)}), high {evaluation.highStepCents.toFixed(1)}¢ ({formatPercent(evaluation.highAccuracy)}).
              </small>
              {evaluation.leastAccuratePitches.length > 0 ? (
                <div style={{ display: 'grid', gap: 4 }}>
                  {evaluation.leastAccuratePitches.map((item) => (
                    <small key={`${item.register}:${item.anchorMidi}`}>
                      {REGISTER_CONFIG[item.register]?.label ?? item.register}: {midiToNoteLabel(item.anchorMidi)} ({item.anchorMidi}) — {Math.round(item.accuracy * 100)}% ({item.correct}/{item.total})
                    </small>
                  ))}
                </div>
              ) : (
                <small>No completed trials yet.</small>
              )}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 14, display: 'grid', gap: 12 }}>
          <div>
            <strong>Trial state:</strong>{' '}
            {phase === 'idle' && 'Ready'}
            {phase === 'playing' && 'Playing two tones…'}
            {phase === 'answer' && 'Answer: was the second tone higher or lower?'}
            {phase === 'confidence' && 'How confident are you?'}
            {phase === 'feedback' && 'Review result'}
          </div>

          <div className="stat">
            <div className="k">Current trial</div>
            <div className="v" style={{ fontSize: 24 }}>
              {trial ? `${REGISTER_CONFIG[trial.register].label} • ${trial.stepCents.toFixed(1)}¢` : '—'}
            </div>
            <small>{trial ? `Anchor ${trial.anchorMidi} MIDI` : 'Start a trial to begin.'}</small>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="button secondary" type="button" onClick={replayCurrentTrial} disabled={!trial || phase === 'playing'}>
              Replay tones
            </button>
            <button className="button" type="button" onClick={() => submitDirection('higher')} disabled={phase !== 'answer'}>Second is higher</button>
            <button className="button" type="button" onClick={() => submitDirection('lower')} disabled={phase !== 'answer'}>Second is lower</button>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="button secondary" type="button" onClick={() => submitConfidence(1)} disabled={phase !== 'confidence'}>Confidence 1</button>
            <button className="button secondary" type="button" onClick={() => submitConfidence(2)} disabled={phase !== 'confidence'}>Confidence 2</button>
            <button className="button secondary" type="button" onClick={() => submitConfidence(3)} disabled={phase !== 'confidence'}>Confidence 3</button>
            <button className="button secondary" type="button" onClick={() => submitConfidence(4)} disabled={phase !== 'confidence'}>Confidence 4</button>
          </div>

          {lastOutcome && (
            <div className="stat">
              <div className="k">Feedback</div>
              <div className="v" style={{ fontSize: 22, color: lastOutcome.wasCorrect ? '#22c55e' : '#ef4444' }}>
                {lastOutcome.wasCorrect ? 'Correct' : 'Incorrect'}
              </div>
              <small>
                Correct answer: second was {lastOutcome.correctDirection}. Next {REGISTER_CONFIG[lastOutcome.register].label.toLowerCase()} step: {lastOutcome.nextStepCents.toFixed(1)}¢.
                {Number.isFinite(confidence) ? ` Confidence: ${confidence}/4.` : ''}
              </small>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
