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
const ABS_OFFSET_LEVELS = [0, 10, 15, 20, 25, 30, 40, 50];

function pickRandom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function pickWeighted(valuesWithWeights) {
  const totalWeight = valuesWithWeights.reduce((sum, item) => sum + item.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return pickRandom(valuesWithWeights).value;
  }
  let threshold = Math.random() * totalWeight;
  for (const item of valuesWithWeights) {
    threshold -= item.weight;
    if (threshold <= 0) return item.value;
  }
  return valuesWithWeights[valuesWithWeights.length - 1].value;
}

function pickAdaptiveOffsetCents(bins) {
  const weightedLevels = ABS_OFFSET_LEVELS.map((absCents) => {
    const bin = bins.get(absCents);
    const total = bin?.total ?? 0;
    const accuracy = total > 0 ? (bin.labelCorrect / total) : null;

    // Keep a random baseline and only partially bias toward weaker ranges.
    const randomBaseline = 1;
    const confidence = Math.min(total / 8, 1);
    const weaknessBoost = accuracy === null ? 0.35 : (1 - accuracy) * (0.6 + 1.8 * confidence);
    const weight = randomBaseline + weaknessBoost;

    return { value: absCents, weight };
  });

  const absOffset = pickWeighted(weightedLevels);
  if (absOffset === 0) return 0;
  return Math.random() < 0.5 ? -absOffset : absOffset;
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
  ABS_OFFSET_LEVELS.forEach((cents) => {
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

function describeAnswerLabel(label) {
  if (label === 'flat') return 'Flat';
  if (label === 'sharp') return 'Sharp';
  return 'In tune';
}

function describeOffset(offsetCents) {
  if (!Number.isFinite(offsetCents) || offsetCents === 0) return 'In tune';
  return `${Math.abs(offsetCents)}¢ ${offsetCents < 0 ? 'flat' : 'sharp'}`;
}

function describeBucket(absCents) {
  if (absCents === 0) return 'Perfect match';
  return `${absCents}¢ away from in tune`;
}

function calculateInTuneDrop(psychometricPoints) {
  const point0 = psychometricPoints.find((point) => point.absCents === 0 && point.inTuneRate !== null);
  const point50 = psychometricPoints.find((point) => point.absCents === 50 && point.inTuneRate !== null);
  if (!point0 || !point50 || point0.inTuneRate === null || point50.inTuneRate === null) return null;
  return point0.inTuneRate - point50.inTuneRate;
}

export function VoiceTuningCalibrationPage() {
  const pitchRange = useMemo(() => loadPitchRangeSettings(), []);
  const [state, setState] = useState(() => loadState());
  const [phase, setPhase] = useState('idle'); // idle | playing | answer | feedback
  const [trial, setTrial] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const playbackTimerRef = useRef(null);
  const autoAdvanceTimerRef = useRef(null);

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
    if (autoAdvanceTimerRef.current) {
      globalThis.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
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
    if (autoAdvanceTimerRef.current) {
      globalThis.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }

    const anchorMidi = pickRandom(anchors);
    const offsetCents = pickAdaptiveOffsetCents(summary.bins);
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

    if (isCorrect) {
      autoAdvanceTimerRef.current = globalThis.setTimeout(() => {
        autoAdvanceTimerRef.current = null;
        startNextTrial();
      }, 450);
    }
  }

  function resetProgress() {
    if (autoAdvanceTimerRef.current) {
      globalThis.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    setState(defaultState());
    setTrial(null);
    setFeedback(null);
    setPhase('idle');
  }

  const labelAccuracy = summary.totals.all > 0 ? summary.totals.labelCorrect / summary.totals.all : null;
  const nearBandDirectionAccuracy = summary.totals.nearBandDirectionTotal > 0
    ? summary.totals.nearBandDirectionCorrect / summary.totals.nearBandDirectionTotal
    : null;
  const inTuneDrop = calculateInTuneDrop(summary.psychometricPoints);

  return (
    <div className="list" style={{ gap: 12 }}>
      <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Voice-Timbre Tuning Calibration</h2>
          <Link className="button secondary" to="/ear-training">Back to Ear Training</Link>
        </div>
        <p style={{ margin: 0, color: '#94a3b8', fontSize: 13 }}>
          You will hear two sung-style notes. The first is the reference. Decide whether the second note sounds flat, in tune, or sharp compared with the first.
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '360px 1fr' }}>
        <div className="card controls" style={{ gap: 10 }}>
          <div className="stat">
            <div className="k">Practice rounds completed</div>
            <div className="v">{summary.totals.all}</div>
            <small>Saved in this browser on this device</small>
          </div>

          <div className="stat">
            <div className="k">Overall answer accuracy</div>
            <div className="v">{formatPercent(labelAccuracy)}</div>
            <small>How often you chose the correct answer across all rounds</small>
          </div>

          <div className="stat">
            <div className="k">Close-call high / low accuracy</div>
            <div className="v">{formatPercent(nearBandDirectionAccuracy)}</div>
            <small>How often you correctly heard whether the second note was flat or sharp on medium-difficulty rounds</small>
          </div>

          <div className="stat">
            <div className="k">How clearly you stop hearing “in tune”</div>
            <div className="v" style={{ fontSize: 22 }}>
              {formatPercent(inTuneDrop)}
            </div>
            <small>Bigger drop means you are less likely to call a note “in tune” once it is 50¢ off</small>
          </div>

        </div>

        <div className="card" style={{ padding: 14, display: 'grid', gap: 12 }}>
          <div>
            <strong>What to do:</strong>{' '}
            {phase === 'idle' && 'Start when you are ready.'}
            {phase === 'playing' && 'Listen to the first note, then the second note.'}
            {phase === 'answer' && 'Decide whether the second note was flat, in tune, or sharp.'}
            {phase === 'feedback' && 'Check the result below.'}
          </div>

          <div className="stat">
            <div className="k">Starting note for this round</div>
            <div className="v" style={{ fontSize: 24 }}>
              {trial ? `${midiToNoteLabel(trial.anchorMidi)} (${trial.anchorMidi})` : '—'}
            </div>
            <small>Both notes in this round are based on this pitch</small>
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
              <div className="k">Last result</div>
              <div
                className="v"
                style={{
                  fontSize: 24,
                  lineHeight: 1.1,
                  color: feedback.isCorrect ? '#86efac' : '#fca5a5',
                }}
              >
                {feedback.isCorrect ? 'Correct' : 'Not quite'}
              </div>
              <small>
                You answered:{' '}
                <strong style={{ color: feedbackColor(feedback.isCorrect) }}>
                  {describeAnswerLabel(feedback.answerLabel)}
                </strong>{' '}
                and the correct answer was <strong>{describeAnswerLabel(feedback.correctLabel)}</strong>.
              </small>
              <small style={{ color: '#f8fafc', fontWeight: 700 }}>
                The second note was: {describeOffset(feedback.offsetCents)} compared with the first note.
              </small>
            </div>
          )}

          <div className="card" style={{ padding: 10, display: 'grid', gap: 6 }}>
            <strong style={{ fontSize: 13 }}>Percent correct by pitch difference</strong>
            <small style={{ color: '#94a3b8' }}>
              This shows your accuracy at each cent level (how often your label matched the correct answer).
            </small>
            {ABS_OFFSET_LEVELS.map((absCents) => {
              const bin = summary.bins.get(absCents);
              const rate = bin && bin.total > 0 ? bin.labelCorrect / bin.total : null;
              return (
                <small key={absCents}>
                  {describeBucket(absCents)}: {formatPercent(rate)} ({bin?.total ?? 0} rounds)
                </small>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
