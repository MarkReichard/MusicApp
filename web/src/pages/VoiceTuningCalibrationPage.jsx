import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPianoAudioContext, loadInstrument, scheduleMicrotonalPianoNote, stopAllNotes } from '../lib/pianoSynth';
import { loadPitchRangeSettings } from '../lib/pitchRangeSettings';
import { midiToFrequencyHz, midiToNoteLabel } from '../lib/musicTheory';

const STORAGE_KEY = 'musicapp.web.voiceTuningCalibration.v1';
const VOICE_INSTRUMENT = 'choir_aahs';
const TONE_DURATION_S = 0.56;
const TONE_GAP_S = 0.28;
const TONE_GAIN = 0.16;
const TRIAL_OFFSETS_CENTS = [0, -10, 10, -20, 20, -30, 30, -40, 40, -50, 50, -70, 70, -100, 100];

function pickRandom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function defaultState() {
  return {
    attempts: [],
  };
}

function loadState() {
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return {
      attempts: Array.isArray(parsed?.attempts) ? parsed.attempts.slice(-800) : [],
    };
  } catch {
    return defaultState();
  }
}

function createSummaryTotals() {
  return {
    all: 0,
    labelCorrect: 0,
    nearBandDirectionTotal: 0,
    nearBandDirectionCorrect: 0,
  };
}

function createSummaryBins() {
  const bins = new Map();
  [0, 10, 20, 30, 40, 50, 70, 100].forEach((cents) => {
    bins.set(cents, { total: 0, inTuneChosen: 0, labelCorrect: 0 });
  });
  return bins;
}

function updateTotalsForAttempt(totals, attempt, absCents) {
  totals.all += 1;
  if (attempt.isCorrect) totals.labelCorrect += 1;
  if (absCents >= 25 && absCents <= 50 && attempt.correctLabel !== 'in-tune') {
    totals.nearBandDirectionTotal += 1;
    if (attempt.isCorrect) totals.nearBandDirectionCorrect += 1;
  }
}

function updateBinForAttempt(bin, attempt) {
  bin.total += 1;
  if (attempt.answerLabel === 'in-tune') bin.inTuneChosen += 1;
  if (attempt.isCorrect) bin.labelCorrect += 1;
}

function calculatePsychometricPoints(bins) {
  return [...bins.entries()]
    .map(([absCents, value]) => ({
      absCents,
      inTuneRate: value.total > 0 ? value.inTuneChosen / value.total : null,
      count: value.total,
    }))
    .filter((point) => point.count > 0)
    .sort((left, right) => left.absCents - right.absCents);
}

function calculatePsychometricSlope(psychometricPoints) {
  const point0 = psychometricPoints.find((point) => point.absCents === 0 && point.inTuneRate !== null);
  const point50 = psychometricPoints.find((point) => point.absCents === 50 && point.inTuneRate !== null);
  if (!point0 || !point50 || point0.inTuneRate === null || point50.inTuneRate === null) return null;
  return (point50.inTuneRate - point0.inTuneRate) / 50;
}

function summarizeAttempts(attempts) {
  const totals = {
    ...createSummaryTotals(),
  };
  const bins = createSummaryBins();

  for (const attempt of attempts) {
    if (!attempt || !Number.isFinite(attempt.offsetCents)) continue;
    const absCents = Math.abs(attempt.offsetCents);
    if (!bins.has(absCents)) continue;

    updateTotalsForAttempt(totals, attempt, absCents);
    const entry = bins.get(absCents);
    updateBinForAttempt(entry, attempt);
  }

  const psychometricPoints = calculatePsychometricPoints(bins);
  const psychometricSlope = calculatePsychometricSlope(psychometricPoints);

  return {
    totals,
    bins,
    psychometricPoints,
    psychometricSlope,
  };
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function feedbackColor(isCorrect) {
  return isCorrect ? '#22c55e' : '#ef4444';
}

export function VoiceTuningCalibrationPage() {
  const pitchRange = useMemo(() => loadPitchRangeSettings(), []);
  const [state, setState] = useState(() => loadState());
  const [phase, setPhase] = useState('idle'); // idle | playing | answer | feedback
  const [trial, setTrial] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const playbackTimerRef = useRef(null);

  const anchors = useMemo(() => {
    const minMidi = Number.isFinite(pitchRange.minMidi) ? Math.max(48, Math.round(pitchRange.minMidi)) : 52;
    const maxMidi = Number.isFinite(pitchRange.maxMidi) ? Math.min(79, Math.round(pitchRange.maxMidi)) : 72;
    const result = [];
    for (let midi = minMidi; midi <= maxMidi; midi += 2) result.push(midi);
    return result.length ? result : [52, 55, 59, 64, 67, 71];
  }, [pitchRange]);

  const summary = useMemo(() => summarizeAttempts(state.attempts), [state.attempts]);

  useEffect(() => {
    void loadInstrument(VOICE_INSTRUMENT);
  }, []);

  useEffect(() => {
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore storage failures
    }
  }, [state]);

  useEffect(() => () => {
    if (playbackTimerRef.current) {
      globalThis.clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    stopAllNotes();
  }, []);

  function playTrial(nextTrial) {
    if (playbackTimerRef.current) {
      globalThis.clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    stopAllNotes();

    const ctx = getPianoAudioContext();
    const startAt = ctx.currentTime + 0.08;

    scheduleMicrotonalPianoNote(ctx, nextTrial.targetFreq, startAt, TONE_DURATION_S, TONE_GAIN);
    scheduleMicrotonalPianoNote(ctx, nextTrial.probeFreq, startAt + TONE_DURATION_S + TONE_GAP_S, TONE_DURATION_S, TONE_GAIN);

    setPhase('playing');
    playbackTimerRef.current = globalThis.setTimeout(() => {
      setPhase('answer');
      playbackTimerRef.current = null;
    }, (TONE_DURATION_S * 2 + TONE_GAP_S + 0.2) * 1000);
  }

  function startNextTrial() {
    const anchorMidi = pickRandom(anchors);
    const offsetCents = pickRandom(TRIAL_OFFSETS_CENTS);
    const targetFreq = midiToFrequencyHz(anchorMidi);
    const probeFreq = targetFreq * Math.pow(2, offsetCents / 1200);

    const nextTrial = {
      anchorMidi,
      offsetCents,
      targetFreq,
      probeFreq,
    };

    setTrial(nextTrial);
    setFeedback(null);
    playTrial(nextTrial);
  }

  function replayCurrentTrial() {
    if (!trial || phase === 'playing') return;
    setFeedback(null);
    playTrial(trial);
  }

  function submitAnswer(answerLabel) {
    if (!trial || phase !== 'answer') return;

    let correctDirection = 'in-tune';
    if (trial.offsetCents > 0) correctDirection = 'sharp';
    else if (trial.offsetCents < 0) correctDirection = 'flat';
    const isCorrect = answerLabel === correctDirection;

    const attempt = {
      ts: Date.now(),
      anchorMidi: trial.anchorMidi,
      offsetCents: trial.offsetCents,
      answerLabel,
      correctLabel: correctDirection,
      isCorrect,
    };

    setState((previous) => ({
      ...previous,
      attempts: [...previous.attempts, attempt].slice(-800),
    }));

    setFeedback({
      isCorrect,
      answerLabel,
      correctLabel: correctDirection,
      offsetCents: trial.offsetCents,
    });
    setPhase('feedback');
  }

  function resetProgress() {
    setState(defaultState());
    setTrial(null);
    setFeedback(null);
    setPhase('idle');
  }

  const labelAccuracy = summary.totals.all > 0 ? summary.totals.labelCorrect / summary.totals.all : null;
  const nearBandDirectionAccuracy = summary.totals.nearBandDirectionTotal > 0
    ? summary.totals.nearBandDirectionCorrect / summary.totals.nearBandDirectionTotal
    : null;

  return (
    <div className="list" style={{ gap: 12 }}>
      <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Voice-Timbre Tuning Calibration</h2>
          <Link className="button secondary" to="/ear-training">Back to Ear Training</Link>
        </div>
        <p style={{ margin: 0, color: '#94a3b8', fontSize: 13 }}>
          Hear a sung-style target and a shifted version (0 or ±10…±100 cents). Label the second note as flat, in tune, or sharp.
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '360px 1fr' }}>
        <div className="card controls" style={{ gap: 10 }}>
          <div className="stat">
            <div className="k">Trials</div>
            <div className="v">{summary.totals.all}</div>
            <small>Stored in browser local storage</small>
          </div>

          <div className="stat">
            <div className="k">Label accuracy</div>
            <div className="v">{formatPercent(labelAccuracy)}</div>
            <small>Correct flat / in-tune / sharp labels</small>
          </div>

          <div className="stat">
            <div className="k">Direction (±25–±50¢ proxy)</div>
            <div className="v">{formatPercent(nearBandDirectionAccuracy)}</div>
            <small>Sharp/flat accuracy from ±30/±40/±50¢ trials</small>
          </div>

          <div className="stat">
            <div className="k">Psychometric slope (0→50¢)</div>
            <div className="v" style={{ fontSize: 22 }}>
              {Number.isFinite(summary.psychometricSlope) ? summary.psychometricSlope.toFixed(4) : '—'}
            </div>
            <small>Change in “in-tune” response rate per cent</small>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="button" type="button" onClick={startNextTrial} disabled={phase === 'playing'}>
              {trial ? 'Next trial' : 'Start'}
            </button>
            <button className="button secondary" type="button" onClick={replayCurrentTrial} disabled={!trial || phase === 'playing'}>
              Replay pair
            </button>
            <button className="button secondary" type="button" onClick={resetProgress} disabled={phase === 'playing'}>
              Reset progress
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 14, display: 'grid', gap: 12 }}>
          <div>
            <strong>Trial state:</strong>{' '}
            {phase === 'idle' && 'Ready'}
            {phase === 'playing' && 'Playing target then comparison…'}
            {phase === 'answer' && 'Label the second note: flat, in tune, or sharp.'}
            {phase === 'feedback' && 'Review result'}
          </div>

          <div className="stat">
            <div className="k">Current anchor note</div>
            <div className="v" style={{ fontSize: 24 }}>
              {trial ? `${midiToNoteLabel(trial.anchorMidi)} (${trial.anchorMidi})` : '—'}
            </div>
            <small>Voice model: choir</small>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="button secondary" type="button" onClick={() => submitAnswer('flat')} disabled={phase !== 'answer'}>
              Flat
            </button>
            <button className="button" type="button" onClick={() => submitAnswer('in-tune')} disabled={phase !== 'answer'}>
              In tune
            </button>
            <button className="button secondary" type="button" onClick={() => submitAnswer('sharp')} disabled={phase !== 'answer'}>
              Sharp
            </button>
          </div>

          {feedback && (
            <div
              className="stat"
              style={{
                display: 'grid',
                gap: 6,
                borderColor: feedback.isCorrect ? '#166534' : '#7f1d1d',
                background: feedback.isCorrect ? '#052e16' : '#3b0a0a',
              }}
            >
              <div className="k">Feedback</div>
              <div
                className="v"
                style={{
                  fontSize: 24,
                  lineHeight: 1.1,
                  color: feedback.isCorrect ? '#86efac' : '#fca5a5',
                }}
              >
                {feedback.isCorrect ? '✓ Correct label' : '✗ Incorrect label'}
              </div>
              <small>
                Your label:{' '}
                <strong style={{ color: feedbackColor(feedback.isCorrect) }}>
                  {feedback.answerLabel}
                </strong>{' '}
                (correct: {feedback.correctLabel}).
              </small>
              <small style={{ color: '#f8fafc', fontWeight: 700 }}>
                Actual shift: {feedback.offsetCents > 0 ? '+' : ''}{feedback.offsetCents}¢.
              </small>
            </div>
          )}

          <div className="card" style={{ padding: 10, display: 'grid', gap: 6 }}>
            <strong style={{ fontSize: 13 }}>In-tune response by |cents|</strong>
            {[0, 10, 20, 30, 40, 50, 70, 100].map((absCents) => {
              const bin = summary.bins.get(absCents);
              const rate = bin && bin.total > 0 ? bin.inTuneYes / bin.total : null;
              return (
                <small key={absCents}>
                  {absCents === 0 ? '0¢' : `±${absCents}¢`}: {formatPercent(rate)} ({bin?.total ?? 0} trials)
                </small>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
