import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getLessonById } from '../lib/lessons';
import { loadPitchSettings } from '../lib/pitchSettings';
import { usePitchDetector } from '../lib/usePitchDetector';
import { MicPitchGraphPanel } from '../components/MicPitchGraphPanel';
import { TrainerOptionsSection } from '../components/trainer/TrainerOptionsSection';

const TRAINER_SING_OCTAVE_KEY = 'musicapp.web.trainer.singOctave.v1';

export function SingTrainerPage() {
  const { lessonId } = useParams();
  const lesson = useMemo(() => getLessonById(lessonId), [lessonId]);
  const lessonExercises = useMemo(() => normalizeLessonExercises(lesson), [lesson]);
  const [selectedKey, setSelectedKey] = useState(lesson?.defaultKey ?? 'C');
  const [tempoBpm, setTempoBpm] = useState(lesson?.defaultTempoBpm ?? 90);
  const [playTonicCadence, setPlayTonicCadence] = useState(true);
  const [singOctave, setSingOctave] = useState(loadStoredSingOctave(lesson?.defaultOctave ?? 4));
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [index, setIndex] = useState(0);
  const [correctIndices, setCorrectIndices] = useState([]);
  const [isPlayingTarget, setIsPlayingTarget] = useState(false);

  const pitchSettings = useMemo(() => loadPitchSettings(), []);
  const { current, history } = usePitchDetector(pitchSettings, true);

  const allowedKeys = lesson.allowedKeys?.length ? lesson.allowedKeys : [lesson.defaultKey ?? 'C'];
  const tempoRange = lesson.tempoRange ?? { min: 50, max: 180 };
  const allowedOctaves = lesson.allowedOctaves?.length ? lesson.allowedOctaves : [lesson.defaultOctave ?? 4];
  const keySemitoneShift = keyToSemitone(selectedKey) - keyToSemitone(lesson.defaultKey ?? selectedKey);
  const octaveShift = (singOctave - lesson.defaultOctave) * 12;
  const totalMidiShift = keySemitoneShift + octaveShift;
  const activeExercise = lessonExercises[exerciseIndex] ?? lessonExercises[0];
  const activeNotes = activeExercise?.notes ?? [];

  const expectedBaseMidi = activeNotes[index]?.midi ?? null;
  const expectedMidi = expectedBaseMidi === null ? null : expectedBaseMidi + totalMidiShift;
  const progress = `${Math.min(index + 1, activeNotes.length)} / ${activeNotes.length}`;
  const shiftedLessonNotes = activeNotes.map(
    (note) => ({
      ...note,
      midi: note.midi + totalMidiShift,
    }),
  );

  function registerInput(midi) {
    if (expectedMidi === null) return;
    if (midi !== expectedMidi) return;

    setCorrectIndices((previous) => (previous.includes(index) ? previous : [...previous, index]));
    setIndex((previous) => Math.min(previous + 1, activeNotes.length - 1));
  }

  function setExercise(nextIndex) {
    const clamped = Math.max(0, Math.min(lessonExercises.length - 1, nextIndex));
    if (clamped === exerciseIndex) {
      return;
    }

    setExerciseIndex(clamped);
    setIndex(0);
    setCorrectIndices([]);
  }

  function resetInputProgress() {
    setIndex(0);
    setCorrectIndices([]);
  }

  async function playMidiSequence(notes) {
    if (!notes.length || isPlayingTarget) {
      return;
    }

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

    setSelectedKey(lesson.defaultKey ?? 'C');
    setTempoBpm(lesson.defaultTempoBpm ?? 90);

    const storedOctave = loadStoredSingOctave(lesson.defaultOctave ?? 4);
    const nextOctave = (lesson.allowedOctaves ?? []).includes(storedOctave)
      ? storedOctave
      : lesson.defaultOctave ?? 4;
    setSingOctave(nextOctave);

    setIndex(0);
    setCorrectIndices([]);
    setExerciseIndex(0);
  }, [lesson]);

  useEffect(() => {
    saveStoredSingOctave(singOctave);
  }, [singOctave]);

  useEffect(() => {
    if (!Number.isFinite(current.midi) || expectedMidi === null) {
      return;
    }

    const rounded = Math.round(current.midi);
    if (rounded === expectedMidi) {
      registerInput(rounded);
    }
  }, [current.midi, expectedMidi]);

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
        <div className="lesson-title-row">
          <h3>{lesson.name} · Sing</h3>
          {lessonExercises.length > 1 ? <small>Exercise {exerciseIndex + 1} / {lessonExercises.length} · Key {selectedKey}</small> : null}
        </div>

        <div className="trainer-detected-note">
          <span>Detected note: </span>
          <strong>{current.note}</strong>
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

        <MicPitchGraphPanel
          title="Sung Pitch"
          settings={pitchSettings}
          externalCurrent={current}
          externalHistory={history}
          showHeader={false}
          showControls={false}
          showReadouts={false}
          maxHistoryPoints={220}
        />
      </div>
    </div>
  );
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

function loadStoredSingOctave(fallback) {
  try {
    const raw = globalThis.localStorage.getItem(TRAINER_SING_OCTAVE_KEY);
    if (!raw) {
      return fallback;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function saveStoredSingOctave(value) {
  try {
    globalThis.localStorage.setItem(TRAINER_SING_OCTAVE_KEY, String(value));
  } catch {
    // ignore storage failures in private/incognito modes
  }
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
