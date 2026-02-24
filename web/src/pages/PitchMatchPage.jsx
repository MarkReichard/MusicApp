import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadPitchSettings } from '../lib/pitchSettings';
import { loadPitchRangeSettings } from '../lib/pitchRangeSettings';
import { usePitchDetector } from '../lib/usePitchDetector';
import {
  SEMITONES_PER_OCTAVE,
  keyToSemitone,
  midiToNoteLabel,
} from '../lib/musicTheory';
import { playBing, playBuzz, playPianoNoteNow } from '../lib/pianoSynth';

// ── Constants ──────────────────────────────────────────────────────────────────
const DIATONIC_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const SOLFEGE_NAMES      = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti'];
const AVAILABLE_KEYS     = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

const DEFAULT_NOTE_COUNT      = 5;
const DEFAULT_TOLERANCE_CENTS = 50;
const DEFAULT_TONE_DURATION_S = 1.2; // how long the played note sounds
const HOLD_READINGS_NEEDED    = 8;   // ~400 ms at 50 ms poll
const NOTE_TIMEOUT_MS         = 7000;
const FEEDBACK_LINGER_MS      = 800;

const TARGET_TONE_GAIN = 0.18;

// ── Note generation ────────────────────────────────────────────────────────────
function generateDiatonicCandidates(selectedKey, minMidi, maxMidi) {
  const tonicSemitone = keyToSemitone(selectedKey);
  const candidates = [];
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    const semitone = ((midi - tonicSemitone) % SEMITONES_PER_OCTAVE + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;
    const degreeIdx = DIATONIC_SEMITONES.indexOf(semitone);
    if (degreeIdx !== -1) {
      candidates.push({ midi, solfege: SOLFEGE_NAMES[degreeIdx], noteLabel: midiToNoteLabel(midi) });
    }
  }
  return candidates;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildExercise(selectedKey, noteCount, minMidi, maxMidi) {
  const candidates = generateDiatonicCandidates(selectedKey, minMidi, maxMidi);
  if (candidates.length === 0) return [];
  const shuffled = shuffleArray(candidates);
  // Allow repeats if noteCount > candidates.length
  const exercise = [];
  for (let i = 0; i < noteCount; i++) {
    exercise.push(shuffled[i % shuffled.length]);
  }
  return exercise;
}

// ── Component ──────────────────────────────────────────────────────────────────
export function PitchMatchPage() {
  const pitchSettings   = useMemo(() => loadPitchSettings(), []);
  const pitchRange      = useMemo(() => loadPitchRangeSettings(), []);
  const hasPitchRange   = Number.isFinite(pitchRange.minMidi) && Number.isFinite(pitchRange.maxMidi);

  const [selectedKey, setSelectedKey]         = useState('C');
  const [noteCount, setNoteCount]             = useState(DEFAULT_NOTE_COUNT);
  const [toleranceCents, setToleranceCents]   = useState(DEFAULT_TOLERANCE_CENTS);
  const [toneDurationS, setToneDurationS]     = useState(DEFAULT_TONE_DURATION_S);
  const [exercise, setExercise]               = useState([]);
  const [noteIndex, setNoteIndex]             = useState(0);
  const [score, setScore]                     = useState({ correct: 0, total: 0 });
  const [results, setResults]                 = useState([]); // 'correct' | 'wrong' | null
  const [phase, setPhase]                     = useState('setup'); // setup | playing_tone | listening | feedback | done
  const [feedback, setFeedback]               = useState(null); // 'correct' | 'wrong'

  const holdCountRef = useRef(0);
  const timeoutRef   = useRef(null);

  const { current } = usePitchDetector(pitchSettings, true);

  // ── Derived ────────────────────────────────────────────────────────────────
  const minMidi    = hasPitchRange ? pitchRange.minMidi : 48; // C3 default
  const maxMidi    = hasPitchRange ? pitchRange.maxMidi : 72; // C5 default
  const targetNote = exercise[noteIndex] ?? null;

  // ── Advance to next note ───────────────────────────────────────────────────
  const advanceNote = useCallback((wasCorrect) => {
    clearTimeout(timeoutRef.current);
    holdCountRef.current = 0;

    const resultLabel = wasCorrect ? 'correct' : 'wrong';

    setScore((s) => ({
      correct: s.correct + (wasCorrect ? 1 : 0),
      total:   s.total + 1,
    }));
    setResults((r) => {
      const updated = [...r];
      updated[noteIndex] = resultLabel;
      return updated;
    });
    setFeedback(resultLabel);
    setPhase('feedback');

    // After linger, move on
    timeoutRef.current = setTimeout(() => {
      setFeedback(null);
      const next = noteIndex + 1;
      if (next >= exercise.length) {
        setPhase('done');
      } else {
        setNoteIndex(next);
        setPhase('playing_tone');
        const delayMs = playPianoNoteNow(exercise[next].midi, toneDurationS, TARGET_TONE_GAIN);
        timeoutRef.current = setTimeout(() => {
          setPhase('listening');
          startTimeout();
        }, delayMs);
      }
    }, FEEDBACK_LINGER_MS);
  }, [noteIndex, exercise, toneDurationS]); // eslint-disable-line react-hooks/exhaustive-deps

  function startTimeout() {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      playBuzz();
      advanceNote(false);
    }, NOTE_TIMEOUT_MS);
  }

  // ── Start / restart exercise ───────────────────────────────────────────────
  function startExercise() {
    clearTimeout(timeoutRef.current);
    holdCountRef.current = 0;
    const ex = buildExercise(selectedKey, noteCount, minMidi, maxMidi);
    setExercise(ex);
    setNoteIndex(0);
    setScore({ correct: 0, total: 0 });
    setResults(new Array(ex.length).fill(null));
    setFeedback(null);

    if (ex.length === 0) {
      setPhase('setup');
      return;
    }

    setPhase('playing_tone');
    const delayMs = playPianoNoteNow(ex[0].midi, toneDurationS, TARGET_TONE_GAIN);
    timeoutRef.current = setTimeout(() => {
      setPhase('listening');
      startTimeout();
    }, delayMs);
  }

  // ── Play current note again ────────────────────────────────────────────────
  function replayCurrentNote() {
    if (!targetNote) return;
    clearTimeout(timeoutRef.current);
    holdCountRef.current = 0;
    setPhase('playing_tone');
    const delayMs = playPianoNoteNow(targetNote.midi, toneDurationS, TARGET_TONE_GAIN);
    timeoutRef.current = setTimeout(() => {
      setPhase('listening');
      startTimeout();
    }, delayMs);
  }

  // ── Pitch matching tick ────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'listening' || !targetNote) {
      holdCountRef.current = 0;
      return;
    }
    if (!Number.isFinite(current?.midi)) {
      holdCountRef.current = 0;
      return;
    }

    const centsOff = Math.abs(current.midi - targetNote.midi) * 100;
    if (centsOff <= toleranceCents) {
      holdCountRef.current += 1;
      if (holdCountRef.current >= HOLD_READINGS_NEEDED) {
        holdCountRef.current = 0;
        clearTimeout(timeoutRef.current);
        playBing();
        advanceNote(true);
      }
    } else {
      holdCountRef.current = 0;
    }
  }, [current, phase, targetNote, toleranceCents, advanceNote]);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const holdProgress = Math.min(holdCountRef.current / HOLD_READINGS_NEEDED, 1);

  const detectedDisplay = Number.isFinite(current?.midi) ? current.note : '—';

  const phaseLabel = {
    setup:        'Configure and start',
    playing_tone: 'Listen...',
    listening:    'Sing the note ↑',
    feedback:     feedback === 'correct' ? '✓ Correct!' : '✗ Miss',
    done:         'Exercise complete',
  }[phase] ?? '';

  // ── JSX ────────────────────────────────────────────────────────────────────
  return (
    <div className="pitch-match-page">

      {/* ── Options card ── */}
      <div className="card controls pitch-match-options">
        <h3 style={{ margin: '0 0 8px' }}>Pitch Match</h3>

        {!hasPitchRange && (
          <p className="pitch-match-warning">
            No vocal range saved. Visit the <a href="/pitch-range">Pitch Range</a> page first for accurate note selection.
          </p>
        )}

        <div className="pitch-match-options-row">
          <label className="pitch-match-label">
            {'Key '}
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className="pitch-match-select"
              disabled={phase !== 'setup' && phase !== 'done'}
            >
              {AVAILABLE_KEYS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>

          <label className="pitch-match-label">
            Notes: {noteCount}
            <input
              type="range"
              min={1}
              max={10}
              value={noteCount}
              onChange={(e) => setNoteCount(Number(e.target.value))}
              disabled={phase !== 'setup' && phase !== 'done'}
              style={{ width: 100 }}
            />
          </label>

          <label className="pitch-match-label">
            Tolerance: {toleranceCents}¢
            <input
              type="range"
              min={20}
              max={100}
              step={5}
              value={toleranceCents}
              onChange={(e) => setToleranceCents(Number(e.target.value))}
              style={{ width: 100 }}
            />
          </label>

          <label className="pitch-match-label">
            Note length: {toneDurationS.toFixed(1)}s
            <input
              type="range"
              min={3}
              max={30}
              step={1}
              value={Math.round(toneDurationS * 10)}
              onChange={(e) => setToneDurationS(Number(e.target.value) / 10)}
              style={{ width: 100 }}
            />
          </label>

          <button type="button" className="button" onClick={startExercise}>
            {phase === 'setup' ? 'Start' : 'Restart'}
          </button>
        </div>
      </div>

      {/* ── Active exercise panel ── */}
      {phase !== 'setup' && (
        <div className="card pitch-match-panel">

          {/* Progress chips */}
          <div className="note-chips-row">
            {exercise.map((n, i) => {
              const res = results[i];
              const isCurrent = i === noteIndex;
              let chipClass = 'note-chip';
              if (res === 'correct') chipClass += ' correct';
              else if (res === 'wrong') chipClass += ' wrong';
              else if (isCurrent) chipClass += ' active';
              return (
                <span key={`${i}-${n.midi}`} className={chipClass}>
                  {n.solfege}
                </span>
              );
            })}
          </div>

          {/* Phase label */}
          <div
            className={`pitch-match-phase-label ${feedback === 'correct' ? 'phase-correct' : ''} ${feedback === 'wrong' ? 'phase-wrong' : ''}`}
          >
            {phaseLabel}
          </div>

          {/* Target note display */}
          {targetNote && phase !== 'done' && (
            <div className="pitch-match-target">
              <span className="target-solfege">{targetNote.solfege}</span>
              <span className="target-note-label">{targetNote.noteLabel}</span>
              <button type="button" className="button secondary" onClick={replayCurrentNote} disabled={phase === 'playing_tone'}>
                ♩ Replay
              </button>
            </div>
          )}

          {/* Detected pitch */}
          <div className="pitch-match-detected">
            <span className="detected-label">You:</span>
            <span className="detected-note">{detectedDisplay}</span>
          </div>

          {/* Hold progress bar */}
          {phase === 'listening' && (
            <div className="hold-progress-track">
              <div
                className="hold-progress-fill"
                style={{ width: `${holdProgress * 100}%` }}
              />
            </div>
          )}

          {/* Final score */}
          {phase === 'done' && (
            <div className="pitch-match-final-score">
              Score: {score.correct} / {exercise.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}