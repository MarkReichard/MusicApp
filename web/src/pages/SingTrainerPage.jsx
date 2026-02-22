import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getLessonById } from '../lib/lessons';
import { loadPitchSettings } from '../lib/pitchSettings';
import { getTrainerOptionsForLesson, saveTrainerOptionsSettings } from '../lib/trainerOptionsSettings';
import { usePitchDetector } from '../lib/usePitchDetector';
import { SingInputGraph } from '../components/trainer/SingInputGraph';
import { TrainerOptionsSection } from '../components/trainer/TrainerOptionsSection';

const SING_COUNTDOWN_BEATS = 2;

export function SingTrainerPage() {
  const { lessonId } = useParams();
  const lesson = useMemo(() => getLessonById(lessonId), [lessonId]);
  const lessonExercises = useMemo(() => normalizeLessonExercises(lesson), [lesson]);
  const initialOptions = useMemo(() => getTrainerOptionsForLesson(lesson), [lesson]);
  const [selectedKey, setSelectedKey] = useState(initialOptions.selectedKey);
  const [tempoBpm, setTempoBpm] = useState(initialOptions.tempoBpm);
  const [playTonicCadence, setPlayTonicCadence] = useState(initialOptions.playTonicCadence);
  const [singOctave, setSingOctave] = useState(initialOptions.singOctave);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [index, setIndex] = useState(0);
  const [correctIndices, setCorrectIndices] = useState([]);
  const [isPlayingTarget, setIsPlayingTarget] = useState(false);
  const [toleranceCents, setToleranceCents] = useState(initialOptions.toleranceCents);
  const [session, setSession] = useState(null);
  const [barResults, setBarResults] = useState({});
  const evaluatedBarsRef = useRef(new Set());
  const historyRef = useRef([]);

  const pitchSettings = useMemo(() => loadPitchSettings(), []);
  const { current, history } = usePitchDetector(pitchSettings, true);

  const allowedKeys = lesson.allowedKeys?.length ? lesson.allowedKeys : [lesson.defaultKey ?? 'C'];
  const tempoRange = lesson.tempoRange ?? { min: 30, max: 180 };
  const allowedOctaves = lesson.allowedOctaves?.length ? lesson.allowedOctaves : [lesson.defaultOctave ?? 4];
  const keySemitoneShift = keyToSemitone(selectedKey) - keyToSemitone(lesson.defaultKey ?? selectedKey);
  const octaveShift = (singOctave - lesson.defaultOctave) * 12;
  const totalMidiShift = keySemitoneShift + octaveShift;
  const activeExercise = lessonExercises[exerciseIndex] ?? lessonExercises[0];
  const activeNotes = activeExercise?.notes ?? [];

  const progress = `${Math.min(index + 1, activeNotes.length)} / ${activeNotes.length}`;
  const shiftedLessonNotes = activeNotes.map(
    (note) => ({
      ...note,
      midi: note.midi + totalMidiShift,
    }),
  );

  function setExercise(nextIndex) {
    const clamped = Math.max(0, Math.min(lessonExercises.length - 1, nextIndex));
    if (clamped === exerciseIndex) {
      return;
    }

    setExerciseIndex(clamped);
    setIndex(0);
    setCorrectIndices([]);
    setSession(null);
    setBarResults({});
    evaluatedBarsRef.current = new Set();
  }

  function resetInputProgress() {
    setIndex(0);
    setCorrectIndices([]);
    setSession(null);
    setBarResults({});
    evaluatedBarsRef.current = new Set();
  }

  async function playMidiSequence(notes) {
    if (!notes.length || isPlayingTarget) {
      return;
    }

    const timeline = buildSingTimeline({
      notes,
      tempoBpm,
      singOctave,
      selectedKey,
      playTonicCadence,
      countdownBeats: SING_COUNTDOWN_BEATS,
    });

    const startMs = performance.now() + 30;
    evaluatedBarsRef.current = new Set();
    setIndex(0);
    setCorrectIndices([]);
    setBarResults({});
    setSession({
      startMs,
      singStartSec: timeline.singStartSec,
      stopScrollSec: timeline.stopScrollSec,
      playedBars: timeline.playedBars,
      expectedBars: timeline.expectedBars,
    });

    setIsPlayingTarget(true);
    const context = new AudioContext();

    try {
      const beatSeconds = 60 / Math.max(40, Number(tempoBpm) || 90);
      const gapSeconds = 0.03;
      let startAt = context.currentTime + 0.03;

      if (playTonicCadence) {
        const tonicMidi = 12 * (singOctave + 1) + keyToSemitone(selectedKey);
        const cadenceOffsets = [0, 5, 7, 5];
        const triadOffsets = [0, 4, 7];
        const chordBeats = 1;
        const chordDurationSeconds = beatSeconds * chordBeats;
        const fadeOutSeconds = beatSeconds * 0.05;

        cadenceOffsets.forEach((offset) => {
          const chordRoot = tonicMidi + offset;
          triadOffsets.forEach((triadOffset) => {
            const frequency = midiToFrequencyHz(chordRoot + triadOffset);
            const oscillator = context.createOscillator();
            oscillator.type = 'triangle';
            oscillator.frequency.value = frequency;

            const gain = context.createGain();
            gain.gain.setValueAtTime(0.0001, startAt);
            gain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.02);
            gain.gain.setValueAtTime(0.08, startAt + Math.max(0.02, chordDurationSeconds - fadeOutSeconds));
            gain.gain.exponentialRampToValueAtTime(0.0001, startAt + chordDurationSeconds);

            oscillator.connect(gain);
            gain.connect(context.destination);

            oscillator.start(startAt);
            oscillator.stop(startAt + chordDurationSeconds);
          });

          startAt += chordDurationSeconds;
        });

        startAt += gapSeconds * 2;
      }

      for (const note of notes) {
        const frequency = midiToFrequencyHz(note.midi);
        const beats = Number.isFinite(note.durationBeats) ? note.durationBeats : 1;
        const noteDurationSeconds = Math.max(0.12, beatSeconds * beats * 0.92);
        const oscillator = context.createOscillator();
        oscillator.type = 'triangle';
        oscillator.frequency.value = frequency;

        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.16, startAt + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + noteDurationSeconds);

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start(startAt);
        oscillator.stop(startAt + noteDurationSeconds);

        startAt += noteDurationSeconds + gapSeconds;
      }

      const totalDurationMs = Math.ceil((startAt - context.currentTime) * 1000) + 40;
      await new Promise((resolve) => globalThis.setTimeout(resolve, totalDurationMs));
    } finally {
      await context.close().catch(() => undefined);
      setIsPlayingTarget(false);
    }
  }

  useEffect(() => {
    if (!lesson) {
      return;
    }

    const persistedOptions = getTrainerOptionsForLesson(lesson);

    setSelectedKey(persistedOptions.selectedKey);
    setTempoBpm(persistedOptions.tempoBpm);
    setPlayTonicCadence(persistedOptions.playTonicCadence);
    setSingOctave(persistedOptions.singOctave);
    setToleranceCents(persistedOptions.toleranceCents);

    setIndex(0);
    setCorrectIndices([]);
    setExerciseIndex(0);
    setSession(null);
    setBarResults({});
    evaluatedBarsRef.current = new Set();
  }, [lesson]);

  useEffect(() => {
    if (!lesson) {
      return;
    }

    saveTrainerOptionsSettings({
      selectedKey,
      tempoBpm,
      playTonicCadence,
      singOctave,
      toleranceCents,
    });
  }, [lesson, playTonicCadence, selectedKey, singOctave, tempoBpm, toleranceCents]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    if (!session?.expectedBars?.length) {
      return;
    }

    const timerId = globalThis.setInterval(() => {
      const elapsedSec = (performance.now() - session.startMs) / 1000;
      if (!Number.isFinite(elapsedSec) || elapsedSec < 0) {
        return;
      }

      for (const bar of session.expectedBars) {
        if (elapsedSec < bar.endSec || evaluatedBarsRef.current.has(bar.id)) {
          continue;
        }

        evaluatedBarsRef.current.add(bar.id);
        const matched = isBarMatched({
          bar,
          history: historyRef.current,
          sessionStartMs: session.startMs,
          toleranceCents,
        });

        setBarResults((previous) => {
          if (previous[bar.id] === matched) {
            return previous;
          }
          return { ...previous, [bar.id]: matched };
        });

        applyBarEvaluation({
          bar,
          matched,
          activeNotesLength: activeNotes.length,
          setCorrectIndices,
          setIndex,
        });
      }
    }, 60);

    return () => {
      globalThis.clearInterval(timerId);
    };
  }, [activeNotes.length, session, toleranceCents]);

  if (!lesson) {
    return (
      <div className="card controls">
        <p>Lesson not found.</p>
        <Link className="button secondary home-icon-button" to="/lessons" title="Back to lessons" aria-label="Back to lessons">⌂</Link>
      </div>
    );
  }

  return (
    <div className="trainer-grid">
      <div className="card controls">
        <div className="lesson-title-row sing-title-row">
          <h3>{lesson.name} · Sing</h3>
          <div className="trainer-detected-note sing-title-detected">
            <span>Detected note: </span>
            <strong>{current.note}</strong>
          </div>
          {lessonExercises.length > 1 ? <small>Exercise {exerciseIndex + 1} / {lessonExercises.length} · Key {selectedKey}</small> : <span className="sing-title-spacer" />}
        </div>

        <TrainerOptionsSection
          optionsOpen={optionsOpen}
          onToggleOptions={() => setOptionsOpen((open) => !open)}
          allowedKeys={allowedKeys}
          selectedKey={selectedKey}
          onSelectedKeyChange={setSelectedKey}
          tempoRange={tempoRange}
          tempoBpm={tempoBpm}
          onTempoBpmChange={setTempoBpm}
          allowedOctaves={allowedOctaves}
          singOctave={singOctave}
          onSingOctaveChange={setSingOctave}
          playTonicCadence={playTonicCadence}
          onPlayTonicCadenceChange={setPlayTonicCadence}
          toleranceCents={toleranceCents}
          onToleranceCentsChange={setToleranceCents}
        />

        <div style={{ display: 'flex', gap: 8 }}>
          {lessonExercises.length > 1 ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => setExercise(exerciseIndex - 1)}
              disabled={exerciseIndex <= 0}
              title="Previous exercise"
              aria-label="Previous exercise"
            >
              ⏮
            </button>
          ) : null}
          <button
            className="button"
            disabled={isPlayingTarget}
            onClick={() => void playMidiSequence(shiftedLessonNotes)}
            title="Play target notes"
            aria-label="Play target notes"
          >
            {isPlayingTarget ? 'Playing…' : '▶'}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={resetInputProgress}
            title="Reset input progress"
            aria-label="Reset input progress"
          >
            ↺
          </button>
          {lessonExercises.length > 1 ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => setExercise(exerciseIndex + 1)}
              disabled={exerciseIndex >= lessonExercises.length - 1}
              title="Next exercise"
              aria-label="Next exercise"
            >
              ⏭
            </button>
          ) : null}
          <Link
            className="button secondary home-icon-button"
            to="/lessons"
            title="Back to lessons"
            aria-label="Back to lessons"
          >
            ⌂
          </Link>
        </div>
      </div>

      <div className="card controls trainer-input-panel">
        <div className="input-header">
          <h3>Input</h3>
          <div className="input-progress">
            <span className="progress-text">{progress}</span>
            <div className="progress-dots" aria-label="Sequence progress">
              {activeNotes.map((note, noteIndex) => {
                const isCurrent = noteIndex === index;
                const isCorrect = correctIndices.includes(noteIndex);
                return (
                  <span
                    key={note.id ?? `${note.midi}-${noteIndex}`}
                    className={`dot ${isCurrent ? 'current' : ''} ${isCorrect ? 'correct' : ''}`}
                  />
                );
              })}
            </div>
          </div>
        </div>

        <SingInputGraph
          settings={pitchSettings}
          history={history}
          sessionStartMs={session?.startMs}
          singStartSec={session?.singStartSec}
          stopScrollSec={session?.stopScrollSec}
          playedBars={session?.playedBars ?? []}
          expectedBars={session?.expectedBars ?? []}
          barResults={barResults}
        />
      </div>
    </div>
  );
}

function buildSingTimeline({ notes, tempoBpm, singOctave, selectedKey, playTonicCadence, countdownBeats }) {
  const beatSeconds = 60 / Math.max(40, Number(tempoBpm) || 90);
  const gapSeconds = 0.03;
  let cursor = 0.03;
  const playedBars = [];
  const expectedBars = [];

  if (playTonicCadence) {
    const tonicMidi = 12 * (singOctave + 1) + keyToSemitone(selectedKey);
    const cadenceOffsets = [0, 5, 7, 5];
    const triadOffsets = [0, 4, 7];
    const chordDurationSeconds = beatSeconds;

    cadenceOffsets.forEach((offset, cadenceIndex) => {
      const chordRoot = tonicMidi + offset;
      triadOffsets.forEach((triadOffset, triadIndex) => {
        playedBars.push({
          id: `cadence-${cadenceIndex}-${triadIndex}`,
          startSec: cursor,
          endSec: cursor + chordDurationSeconds,
          midi: chordRoot + triadOffset,
        });
      });
      cursor += chordDurationSeconds;
    });

    cursor += gapSeconds * 2;
  }

  notes.forEach((note, noteIndex) => {
    const beats = Number.isFinite(note.durationBeats) ? note.durationBeats : 1;
    const noteDurationSeconds = Math.max(0.12, beatSeconds * beats * 0.92);
    playedBars.push({
      id: `played-${noteIndex}`,
      startSec: cursor,
      endSec: cursor + noteDurationSeconds,
      midi: note.midi,
    });
    cursor += noteDurationSeconds + gapSeconds;
  });

  const singStartSec = cursor;
  const expectedStartSec = singStartSec + beatSeconds * countdownBeats;
  let singCursor = expectedStartSec;

  notes.forEach((note, noteIndex) => {
    const beats = Number.isFinite(note.durationBeats) ? note.durationBeats : 1;
    const noteDurationSeconds = Math.max(0.12, beatSeconds * beats * 0.92);
    expectedBars.push({
      id: `expected-${noteIndex}`,
      index: noteIndex,
      startSec: singCursor,
      endSec: singCursor + noteDurationSeconds,
      midi: note.midi,
    });
    singCursor += noteDurationSeconds + gapSeconds;
  });

  const lastExpectedEndSec = expectedBars.length
    ? expectedBars.at(-1).endSec
    : singStartSec;
  const stopScrollSec = lastExpectedEndSec + beatSeconds * 2;

  return { playedBars, expectedBars, singStartSec, stopScrollSec };
}

function isBarMatched({ bar, history, sessionStartMs, toleranceCents }) {
  if (!Number.isFinite(sessionStartMs) || !history.length) {
    return false;
  }

  const midiValues = history
    .filter((entry) => Number.isFinite(entry.timeMs) && Number.isFinite(entry.midi))
    .filter((entry) => {
      const relativeSec = (entry.timeMs - sessionStartMs) / 1000;
      return relativeSec >= bar.startSec && relativeSec <= bar.endSec;
    })
    .map((entry) => entry.midi);

  if (!midiValues.length) {
    return false;
  }

  const averageMidi = midiValues.reduce((sum, midi) => sum + midi, 0) / midiValues.length;
  const centsDiff = Math.abs((averageMidi - bar.midi) * 100);
  return centsDiff <= toleranceCents;
}

function applyBarEvaluation({ bar, matched, activeNotesLength, setCorrectIndices, setIndex }) {
  if (matched) {
    setCorrectIndices((previous) => (previous.includes(bar.index) ? previous : [...previous, bar.index]));
  }

  setIndex((previous) => {
    const nextIndex = Math.min(bar.index + 1, Math.max(0, activeNotesLength - 1));
    return previous === nextIndex ? previous : nextIndex;
  });
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KEY_TO_SEMITONE = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
};

function keyToSemitone(key) {
  return KEY_TO_SEMITONE[key] ?? 0;
}

function midiToFrequencyHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function normalizeLessonExercises(lesson) {
  if (!lesson) {
    return [];
  }

  if (Array.isArray(lesson.exercises) && lesson.exercises.length) {
    return lesson.exercises
      .filter((exercise) => exercise && Array.isArray(exercise.notes) && exercise.notes.length)
      .map((exercise, index) => ({
        id: exercise.id ?? `${lesson.id}-exercise-${index + 1}`,
        notes: exercise.notes,
      }));
  }

  if (Array.isArray(lesson.notes) && lesson.notes.length) {
    return [{ id: `${lesson.id}-exercise-1`, notes: lesson.notes }];
  }

  return [];
}
