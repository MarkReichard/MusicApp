import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getLessonById } from '../lib/lessons';
import { getTrainerOptionsForLesson, saveTrainerOptionsSettings } from '../lib/trainerOptionsSettings';
import { loadPitchRangeSettings } from '../lib/pitchRangeSettings';
import { recommendKeyAndOctaveForRange } from '../lib/pitchRangeRecommendation';
import { TrainerOptionsSection } from '../components/trainer/TrainerOptionsSection';
import { SolfegeInputMode } from '../components/trainer/SolfegeInputMode';
import { PianoInputMode } from '../components/trainer/PianoInputMode';

export function TrainerPage() {
  const { lessonId } = useParams();
  const [searchParams] = useSearchParams();
  const requestedMode = searchParams.get('mode') === 'solfege' ? 'solfege' : 'piano';
  const lesson = useMemo(() => getLessonById(lessonId), [lessonId]);
  const lessonExercises = useMemo(() => normalizeLessonExercises(lesson), [lesson]);
  const savedPitchRange = useMemo(() => loadPitchRangeSettings(), []);
  const hasSavedPitchRange = Number.isFinite(savedPitchRange.minMidi) && Number.isFinite(savedPitchRange.maxMidi);
  const rangeRecommendation = useMemo(
    () => recommendKeyAndOctaveForRange({
      lesson,
      userMinMidi: savedPitchRange.minMidi,
      userMaxMidi: savedPitchRange.maxMidi,
    }),
    [lesson, savedPitchRange.maxMidi, savedPitchRange.minMidi],
  );
  const initialOptions = useMemo(() => getTrainerOptionsForLesson(lesson), [lesson]);
  const [mode, setMode] = useState(requestedMode);
  const [selectedKey, setSelectedKey] = useState(initialOptions.selectedKey);
  const [tempoBpm, setTempoBpm] = useState(initialOptions.tempoBpm);
  const [playTonicCadence, setPlayTonicCadence] = useState(initialOptions.playTonicCadence);
  const [singOctave, setSingOctave] = useState(initialOptions.singOctave);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [index, setIndex] = useState(0);
  const [correctIndices, setCorrectIndices] = useState([]);
  const [isPlayingTarget, setIsPlayingTarget] = useState(false);
  const inputAudioContextRef = useRef(null);
  const activeInputTonesRef = useRef({});

  const allowedKeys = lesson.allowedKeys?.length ? lesson.allowedKeys : [lesson.defaultKey ?? 'C'];
  const tempoRange = lesson.tempoRange ?? { min: 30, max: 180 };
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
  const rangeSuggestionText = !hasSavedPitchRange
    ? 'No saved pitch range yet. Use the Pitch Range page first.'
    : rangeRecommendation
      ? `Suggestion: Key ${rangeRecommendation.key}, Oct ${rangeRecommendation.octave}${rangeRecommendation.fitsCompletely ? '' : ' (closest fit)'}.`
      : 'No key/octave recommendation available for this lesson.';
  const disableApplyRangeDefaults = !rangeRecommendation
    || (rangeRecommendation.key === selectedKey && rangeRecommendation.octave === singOctave);

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

  function applyRangeDefaults() {
    if (!rangeRecommendation) {
      return;
    }

    setSelectedKey(rangeRecommendation.key);
    setSingOctave(rangeRecommendation.octave);
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

    const persistedOptions = getTrainerOptionsForLesson(lesson);

    setSelectedKey(persistedOptions.selectedKey);
    setTempoBpm(persistedOptions.tempoBpm);
    setPlayTonicCadence(persistedOptions.playTonicCadence);
    setSingOctave(persistedOptions.singOctave);

    setMode(requestedMode);
    setIndex(0);
    setCorrectIndices([]);
    setExerciseIndex(0);
  }, [lesson, requestedMode]);

  useEffect(() => {
    setMode((currentMode) => (currentMode === requestedMode ? currentMode : requestedMode));
  }, [requestedMode]);

  useEffect(() => {
    if (!lesson) {
      return;
    }

    saveTrainerOptionsSettings({
      selectedKey,
      tempoBpm,
      playTonicCadence,
      singOctave,
    });
  }, [lesson, playTonicCadence, selectedKey, singOctave, tempoBpm]);

  const pianoKeys = useMemo(() => {
    const startMidi = 12 * singOctave;
    return Array.from({ length: 36 }, (_, offset) => {
      const midi = startMidi + offset;
      const pitchClass = midi % 12;
      const noteName = NOTE_NAMES[pitchClass];
      return {
        midi,
        noteName,
        isBlack: noteName.includes('#'),
      };
    });
  }, [singOctave]);

  const whiteKeys = pianoKeys.filter((key) => !key.isBlack);
  const blackKeys = pianoKeys
    .map((key, keyIndex) => ({ ...key, keyIndex }))
    .filter((key) => key.isBlack)
    .map((key) => {
      const whiteBefore = pianoKeys.slice(0, key.keyIndex).filter((candidate) => !candidate.isBlack).length;
      return {
        ...key,
        left: whiteBefore * 44 - 13,
      };
    });

  useEffect(() => {
    return () => {
      Object.values(activeInputTonesRef.current).forEach((tone) => {
        try {
          tone.gain.gain.cancelScheduledValues(tone.context.currentTime);
          tone.gain.gain.setTargetAtTime(0.0001, tone.context.currentTime, 0.02);
          tone.oscillator.stop(tone.context.currentTime + 0.08);
        } catch {
          // ignore
        }
      });
      activeInputTonesRef.current = {};

      if (inputAudioContextRef.current) {
        inputAudioContextRef.current.close().catch(() => undefined);
        inputAudioContextRef.current = null;
      }
    };
  }, []);

  async function startInputTone(midi) {
    if (activeInputTonesRef.current[midi]) {
      return;
    }

    const frequency = midiToFrequencyHz(midi);
    if (!Number.isFinite(frequency)) {
      return;
    }

    const context = inputAudioContextRef.current ?? new AudioContext();
    if (!inputAudioContextRef.current) {
      inputAudioContextRef.current = context;
    }

    if (context.state === 'suspended') {
      await context.resume();
    }

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, now);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.015);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);

    activeInputTonesRef.current[midi] = { oscillator, gain, context };
  }

  function stopInputTone(midi) {
    const tone = activeInputTonesRef.current[midi];
    if (!tone) {
      return;
    }

    const stopAt = tone.context.currentTime;
    tone.gain.gain.cancelScheduledValues(stopAt);
    tone.gain.gain.setTargetAtTime(0.0001, stopAt, 0.02);
    tone.oscillator.stop(stopAt + 0.08);

    delete activeInputTonesRef.current[midi];
  }

  function handleInputPress(midi) {
    void startInputTone(midi);
    registerInput(midi);
  }

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
          <h3>{lesson.name}</h3>
          <div className="lesson-title-right">
            {lessonExercises.length > 1 ? <small>Exercise {exerciseIndex + 1} / {lessonExercises.length} · Key {selectedKey}</small> : null}
            <div className="trainer-mode-radios" role="radiogroup" aria-label="Input mode">
              <label>
                <input
                  type="radio"
                  name="trainer-mode"
                  value="piano"
                  checked={mode === 'piano'}
                  onChange={() => setMode('piano')}
                />
                {' '}
                <span>Piano</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="trainer-mode"
                  value="solfege"
                  checked={mode === 'solfege'}
                  onChange={() => setMode('solfege')}
                />
                {' '}
                <span>Solfege</span>
              </label>
            </div>
          </div>
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
          rangeSuggestionText={rangeSuggestionText}
          onApplyRangeDefaults={applyRangeDefaults}
          disableApplyRangeDefaults={disableApplyRangeDefaults}
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

        {mode === 'solfege' ? (
          <SolfegeInputMode
            singOctave={singOctave}
            onInputPress={handleInputPress}
            onInputRelease={stopInputTone}
          />
        ) : null}

        {mode === 'piano' ? (
          <PianoInputMode
            whiteKeys={whiteKeys}
            blackKeys={blackKeys}
            onInputPress={handleInputPress}
            onInputRelease={stopInputTone}
            midiToNoteLabel={midiToNoteLabel}
          />
        ) : null}
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

function midiToNoteLabel(midi) {
  if (!Number.isFinite(midi)) return '-';
  const roundedMidi = Math.round(midi);
  const name = NOTE_NAMES[roundedMidi % 12] ?? 'C';
  const octave = Math.floor(roundedMidi / 12) - 1;
  return `${name}${octave}`;
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
