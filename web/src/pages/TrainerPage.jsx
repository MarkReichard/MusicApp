import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getLessonById } from '../lib/lessons';
import { getTrainerOptionsForLesson, saveTrainerOptionsSettings } from '../lib/trainerOptionsSettings';
import { loadPitchRangeSettings } from '../lib/pitchRangeSettings';
import { recommendKeyAndOctaveForRange } from '../lib/pitchRangeRecommendation';
import { TrainerOptionsSection } from '../components/trainer/TrainerOptionsSection';
import { SolfegeInputMode } from '../components/trainer/SolfegeInputMode';
import { PianoInputMode } from '../components/trainer/PianoInputMode';
import {
  NOTE_NAMES,
  SEMITONES_PER_OCTAVE,
  CADENCE_CHORD_OFFSETS,
  TRIAD_INTERVALS,
  keyToSemitone,
  beatSecondsFromTempo,
  midiToFrequencyHz,
  midiToNoteLabel,
} from '../lib/musicTheory';
import { normalizeLessonExercises } from '../lib/lessonUtils';
import { schedulePianoNote, startHeldPianoTone, stopHeldTone, loadInstrument } from '../lib/pianoSynth';

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
  const isDebug = searchParams.get('debug') === 'true';
  const [mode, setMode] = useState(requestedMode);
  const [selectedKey, setSelectedKey] = useState(initialOptions.selectedKey);
  const [tempoBpm, setTempoBpm] = useState(initialOptions.tempoBpm);
  const [playTonicCadence, setPlayTonicCadence] = useState(initialOptions.playTonicCadence);
  const [singOctave, setSingOctave] = useState(initialOptions.singOctave);
  const [instrument, setInstrument] = useState(initialOptions.instrument);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [index, setIndex] = useState(0);
  const [correctIndices, setCorrectIndices] = useState([]);
  const [isPlayingTarget, setIsPlayingTarget] = useState(false);
  const [isPlayingCadence, setIsPlayingCadence] = useState(false);
  const [lastNoteMidi, setLastNoteMidi] = useState(null);
  const activeInputTonesRef = useRef({});

  const allowedKeys = lesson.allowedKeys?.length ? lesson.allowedKeys : [lesson.defaultKey ?? 'C'];
  const tempoRange = lesson.tempoRange ?? DEFAULT_TEMPO_RANGE;
  const allowedOctaves = lesson.allowedOctaves?.length ? lesson.allowedOctaves : [lesson.defaultOctave ?? DEFAULT_OCTAVE];
  const keySemitoneShift = keyToSemitone(selectedKey) - keyToSemitone(lesson.defaultKey ?? selectedKey);
  const octaveShift = (singOctave - lesson.defaultOctave) * SEMITONES_PER_OCTAVE;
  const totalMidiShift = keySemitoneShift + octaveShift;
  const activeExercise = lessonExercises[exerciseIndex] ?? lessonExercises[0];
  const activeEvents = activeExercise?.notes ?? [];
  const activeNotes = activeEvents.filter((note) => note?.type !== 'rest' && Number.isFinite(note?.midi));

  const firstNoteShiftedMidi = Number.isFinite(activeNotes[0]?.midi) ? activeNotes[0].midi + totalMidiShift : null;
  const firstNoteOctave = firstNoteShiftedMidi !== null ? Math.floor(firstNoteShiftedMidi / SEMITONES_PER_OCTAVE) - 1 : null;

  const expectedBaseMidi = activeNotes[index]?.midi ?? null;
  const expectedMidi = expectedBaseMidi === null ? null : expectedBaseMidi + totalMidiShift;
  const progress = `${Math.min(index + 1, activeNotes.length)} / ${activeNotes.length}`;
  const shiftedLessonNotes = activeEvents.map((note) => {
    if (note?.type === 'rest' || !Number.isFinite(note?.midi)) {
      return { ...note };
    }

    return {
      ...note,
      midi: note.midi + totalMidiShift,
    };
  });
  let rangeSuggestionText;
  if (!hasSavedPitchRange) {
    rangeSuggestionText = 'No saved pitch range yet. Use the Pitch Range page first.';
  } else if (rangeRecommendation) {
    const fitNote = rangeRecommendation.fitsCompletely ? '' : ' (closest fit)';
    rangeSuggestionText = `Suggestion: Key ${rangeRecommendation.key}, Oct ${rangeRecommendation.octave}${fitNote}.`;
  } else {
    rangeSuggestionText = 'No key/octave recommendation available for this lesson.';
  }
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

  function scheduleCadence(context, startAt, beatSeconds) {
    const tonicMidi = SEMITONES_PER_OCTAVE * (singOctave + 1) + keyToSemitone(selectedKey);
    const chordDurationSeconds = beatSeconds;
    let at = startAt;
    CADENCE_CHORD_OFFSETS.forEach((offset) => {
      const chordRoot = tonicMidi + offset;
      TRIAD_INTERVALS.forEach((triadOffset) => {
        const frequency = midiToFrequencyHz(chordRoot + triadOffset);
        schedulePianoNote(context, frequency, at, chordDurationSeconds, CADENCE_CHORD_GAIN);
      });
      at += chordDurationSeconds;
    });
    return at;
  }

  async function playTonicOnly() {
    if (isPlayingCadence || isPlayingTarget) return;
    setIsPlayingCadence(true);
    const context = new AudioContext();
    await context.resume().catch(() => undefined);
    try {
      const beatSeconds = beatSecondsFromTempo(tempoBpm);
      const endAt = scheduleCadence(context, context.currentTime + AUDIO_START_OFFSET_SECONDS, beatSeconds);
      const totalMs = Math.ceil((endAt - context.currentTime) * 1000) + PLAYBACK_BUFFER_MS;
      await new Promise((resolve) => globalThis.setTimeout(resolve, totalMs));
    } finally {
      await context.close().catch(() => undefined);
      setIsPlayingCadence(false);
    }
  }

  async function playMidiSequence(notes) {
    if (!notes.length || isPlayingTarget) {
      return;
    }

    setIsPlayingTarget(true);
    const context = new AudioContext();
    await context.resume().catch(() => undefined);

    try {
      const beatSeconds = beatSecondsFromTempo(tempoBpm);
      let startAt = context.currentTime + AUDIO_START_OFFSET_SECONDS;

      if (playTonicCadence) {
        startAt = scheduleCadence(context, startAt, beatSeconds);
        startAt += NOTE_GAP_SECONDS * 2;
      }

      for (const note of notes) {
        const beats = Number.isFinite(note.durationBeats) ? note.durationBeats : 1;
        const noteDurationSeconds = Math.max(MIN_NOTE_DURATION_SECONDS, beatSeconds * beats * NOTE_DURATION_SCALE);
        if (note?.type === 'rest' || !Number.isFinite(note?.midi)) {
          startAt += noteDurationSeconds + NOTE_GAP_SECONDS;
          continue;
        }

        const frequency = midiToFrequencyHz(note.midi);
        schedulePianoNote(context, frequency, startAt, noteDurationSeconds, TARGET_NOTE_GAIN);

        startAt += noteDurationSeconds + NOTE_GAP_SECONDS;
      }

      const totalDurationMs = Math.ceil((startAt - context.currentTime) * 1000) + PLAYBACK_BUFFER_MS;
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
    setInstrument(persistedOptions.instrument);

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
      instrument,
    });
  }, [lesson, playTonicCadence, selectedKey, singOctave, tempoBpm, instrument]);

  useEffect(() => {
    void loadInstrument(instrument);
  }, [instrument]);

  const pianoKeys = useMemo(() => {
    const startMidi = SEMITONES_PER_OCTAVE * singOctave;
    return Array.from({ length: PIANO_KEYS_COUNT }, (_, offset) => {
      const midi = startMidi + offset;
      const pitchClass = midi % SEMITONES_PER_OCTAVE;
      const noteName = NOTE_NAMES[pitchClass];
      return {
        midi,
        noteName,
        octave: Math.floor(midi / SEMITONES_PER_OCTAVE) - 1,
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
        left: whiteBefore * WHITE_KEY_WIDTH_PX - BLACK_KEY_OFFSET_PX,
      };
    });

  useEffect(() => {
    return () => {
      Object.values(activeInputTonesRef.current).forEach((tone) => {
        stopHeldTone(tone);
      });
      activeInputTonesRef.current = {};
    };
  }, []);

  function startInputTone(midi) {
    if (activeInputTonesRef.current[midi]) {
      return;
    }

    const frequency = midiToFrequencyHz(midi);
    if (!Number.isFinite(frequency)) {
      return;
    }

    activeInputTonesRef.current[midi] = startHeldPianoTone(frequency, INPUT_TONE_GAIN);
  }

  function stopInputTone(midi) {
    const tone = activeInputTonesRef.current[midi];
    if (!tone) {
      return;
    }

    stopHeldTone(tone);
    delete activeInputTonesRef.current[midi];
  }

  function handleInputPress(midi) {
    setLastNoteMidi(midi);
    startInputTone(midi);
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
          instrument={instrument}
          onInstrumentChange={setInstrument}
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
            type="button"
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
            disabled={isPlayingCadence || isPlayingTarget}
            onClick={() => void playTonicOnly()}
            title="Play tonic cadence (I–IV–V–IV)"
            aria-label="Play tonic cadence"
          >
            {isPlayingCadence ? '…' : '♩'}
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
                const shiftedMidi = note.midi + totalMidiShift;
                const noteOctave = Math.floor(shiftedMidi / SEMITONES_PER_OCTAVE) - 1;
                const label = mode === 'piano'
                  ? midiToNoteLabel(shiftedMidi)
                  : (note.degree ? `${note.degree}${noteOctave}` : midiToNoteLabel(shiftedMidi));
                return (
                  <span
                    key={note.id ?? `${note.midi}-${noteIndex}`}
                    className={`note-chip ${isCurrent ? 'current' : ''} ${isCorrect ? 'correct' : 'pending'}`}
                  >
                    {isCorrect ? label : '_'}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {mode === 'solfege' ? (
          <SolfegeInputMode
            singOctave={singOctave}
            firstNoteOctave={firstNoteOctave}
            keySemitoneShift={keySemitoneShift}
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
            activeMidi={firstNoteShiftedMidi}
          />
        ) : null}

        {isDebug ? (() => {
          const lastNoteActiveMatch = lastNoteMidi === null ? null : activeNotes.find((n) => n.midi + totalMidiShift === lastNoteMidi);
          const lastNoteSolfege = lastNoteActiveMatch?.degree ?? null;
          const shiftedActive = shiftedLessonNotes.filter((n) => n.type !== 'rest' && Number.isFinite(n.midi));
          return (
            <div style={{ marginTop: 12, padding: '8px 10px', background: '#1a1a2e', border: '1px solid #444', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', color: '#ccc' }}>
              <div><strong style={{ color: '#f90' }}>DEBUG</strong></div>
              <div style={{ marginTop: 4 }}>
                <strong>Last note played:</strong>{' '}
                {lastNoteMidi === null
                  ? <em>none</em>
                  : <>{midiToNoteLabel(lastNoteMidi)} · MIDI {lastNoteMidi} · solfege: {lastNoteSolfege ?? '—'}{lastNoteMidi === expectedMidi ? ' ✓' : ` ✗ expected ${expectedMidi === null ? 'none' : `${midiToNoteLabel(expectedMidi)} (MIDI ${expectedMidi})`}`}</>}
              </div>
              <div style={{ marginTop: 4 }}>
                <strong>Lesson notes (shifted):</strong>
                <table style={{ marginTop: 4, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: '#888' }}>
                      <td style={{ paddingRight: 12 }}>#</td>
                      <td style={{ paddingRight: 12 }}>Note</td>
                      <td style={{ paddingRight: 12 }}>MIDI</td>
                      <td>Solfege</td>
                    </tr>
                  </thead>
                  <tbody>
                    {shiftedActive.map((n, i) => {
                      const isCur = i === index;
                      return (
                        <tr key={i} style={{ color: isCur ? '#7ef' : '#aaa', fontWeight: isCur ? 'bold' : 'normal' }}>
                          <td style={{ paddingRight: 12 }}>{isCur ? '▶' : i + 1}</td>
                          <td style={{ paddingRight: 12 }}>{midiToNoteLabel(n.midi)}</td>
                          <td style={{ paddingRight: 12 }}>{n.midi}</td>
                          <td>{n.degree ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })() : null}
      </div>
    </div>
  );
}

// ── Piano layout ──────────────────────────────────────────────────────────────
const PIANO_KEYS_COUNT = 36;      // 3 octaves displayed
const WHITE_KEY_WIDTH_PX = 44;
const BLACK_KEY_OFFSET_PX = 13;

// ── Audio – gain levels ───────────────────────────────────────────────────────
const CADENCE_CHORD_GAIN = 0.08;
const TARGET_NOTE_GAIN = 0.16;
const INPUT_TONE_GAIN = 0.14;

// ── Audio – timing ────────────────────────────────────────────────────────────
const NOTE_DURATION_SCALE = 0.92;           // fraction of beat used for note sound
const MIN_NOTE_DURATION_SECONDS = 0.12;     // floor on note playback duration
const AUDIO_START_OFFSET_SECONDS = 0.03;    // initial delay before first scheduled event
const NOTE_GAP_SECONDS = 0.03;              // silence between consecutive notes
const PLAYBACK_BUFFER_MS = 40;              // extra setTimeout padding after last note

// ── Lesson / UI defaults ──────────────────────────────────────────────────────
const DEFAULT_TEMPO_RANGE = { min: 30, max: 180 };
const DEFAULT_OCTAVE = 4;
