import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getLessonById } from '../lib/lessons';
import { loadPitchSettings } from '../lib/pitchSettings';
import { usePitchDetector } from '../lib/usePitchDetector';
import { MicPitchGraphPanel } from '../components/MicPitchGraphPanel';
import { TrainerOptionsSection } from '../components/trainer/TrainerOptionsSection';
import { SolfegeInputMode } from '../components/trainer/SolfegeInputMode';
import { PianoInputMode } from '../components/trainer/PianoInputMode';

const TRAINER_SING_OCTAVE_KEY = 'musicapp.web.trainer.singOctave.v1';

export function TrainerPage() {
  const { lessonId } = useParams();
  const lesson = useMemo(() => getLessonById(lessonId), [lessonId]);
  const lessonExercises = useMemo(() => normalizeLessonExercises(lesson), [lesson]);
  const [mode, setMode] = useState('piano');
  const [selectedKey, setSelectedKey] = useState(lesson?.defaultKey ?? 'C');
  const [tempoBpm, setTempoBpm] = useState(lesson?.defaultTempoBpm ?? 90);
  const [playTonicCadence, setPlayTonicCadence] = useState(true);
  const [singOctave, setSingOctave] = useState(loadStoredSingOctave(lesson?.defaultOctave ?? 4));
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [index, setIndex] = useState(0);
  const [correctIndices, setCorrectIndices] = useState([]);
  const [isPlayingTarget, setIsPlayingTarget] = useState(false);
  const inputAudioContextRef = useRef(null);
  const activeInputTonesRef = useRef({});

  const pitchSettings = useMemo(() => loadPitchSettings(), []);
  const singEnabled = mode === 'sing';
  const { current, history } = usePitchDetector(pitchSettings, singEnabled);

  if (!lesson) {
    return (
      <div className="card controls">
        <p>Lesson not found.</p>
        <Link className="button" to="/lessons">Back</Link>
      </div>
    );
  }

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
      await new Promise((resolve) => window.setTimeout(resolve, totalDurationMs));
    } finally {
      await context.close().catch(() => undefined);
      setIsPlayingTarget(false);
    }
  }

  useEffect(() => {
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
  }, [lesson.id]);

  useEffect(() => {
    saveStoredSingOctave(singOctave);
  }, [singOctave]);

  useEffect(() => {
    if (mode !== 'sing' || !Number.isFinite(current.midi) || expectedMidi === null) {
      return;
    }

    const rounded = Math.round(current.midi);
    if (rounded === expectedMidi) {
      registerInput(rounded);
    }
  }, [current.midi, expectedMidi, mode]);

  const pianoKeys = useMemo(() => {
    const startMidi = 12 * (singOctave + 1);
    return Array.from({ length: 24 }, (_, offset) => {
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
        void inputAudioContextRef.current.close().catch(() => undefined);
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

  return (
    <div className="trainer-grid">
      <div className="card controls">
        <div className="lesson-title-row">
          <h3>{lesson.name}</h3>
          {lessonExercises.length > 1 ? <small>Exercise {exerciseIndex + 1} / {lessonExercises.length} · Key {selectedKey}</small> : null}
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
          mode={mode}
          onModeChange={setMode}
          currentNote={current.note}
        />

        <div style={{ display: 'flex', gap: 8 }}>
          {lessonExercises.length > 1 ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => setExercise(exerciseIndex - 1)}
              disabled={exerciseIndex <= 0}
            >
              ⏮
            </button>
          ) : null}
          <button className="button" disabled={isPlayingTarget} onClick={() => void playMidiSequence(shiftedLessonNotes)}>
            {isPlayingTarget ? 'Playing…' : '▶'}
          </button>
          {lessonExercises.length > 1 ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => setExercise(exerciseIndex + 1)}
              disabled={exerciseIndex >= lessonExercises.length - 1}
            >
              ⏭
            </button>
          ) : null}
          <Link className="button secondary" to="/lessons">⌂</Link>
        </div>
      </div>

      <div className="card controls trainer-input-panel">
        <div className="input-header">
          <h3>Input</h3>
          <div className="input-progress">
            <span className="progress-text">{progress}</span>
            <div className="progress-dots" aria-label="Sequence progress">
              {activeNotes.map((_, noteIndex) => {
                const isCurrent = noteIndex === index;
                const isCorrect = correctIndices.includes(noteIndex);
                return (
                  <span
                    key={`progress-${noteIndex}`}
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

        {mode === 'sing' ? (
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

function loadStoredSingOctave(fallback) {
  try {
    const raw = window.localStorage.getItem(TRAINER_SING_OCTAVE_KEY);
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
    window.localStorage.setItem(TRAINER_SING_OCTAVE_KEY, String(value));
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
