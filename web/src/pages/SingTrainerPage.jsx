import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getLessonById } from '../lib/lessons';
import { loadPitchSettings } from '../lib/pitchSettings';
import { loadPitchRangeSettings } from '../lib/pitchRangeSettings';
import { recommendKeyAndOctaveForRange } from '../lib/pitchRangeRecommendation';
import { getTrainerOptionsForLesson, saveTrainerOptionsSettings } from '../lib/trainerOptionsSettings';
import { usePitchDetector } from '../lib/usePitchDetector';
import { SingInputGraph } from '../components/trainer/SingInputGraph';
import { SingTrainingOptionsSection } from '../components/trainer/SingTrainingOptionsSection';
import {
  keyToSemitone,
  tonicMidiFromKeyOctave,
  midiToFrequencyHz,
  midiToNoteLabel,
  SEMITONES_PER_OCTAVE,
  CADENCE_CHORD_OFFSETS,
  TRIAD_INTERVALS,
  beatSecondsFromTempo,
  NOTE_DURATION_SCALE,
  MIN_NOTE_DURATION_SECONDS,
  AUDIO_START_OFFSET_SECONDS,
  NOTE_GAP_SECONDS,
  PLAYBACK_BUFFER_MS,
  CADENCE_CHORD_GAIN,
  TARGET_NOTE_GAIN,
  SING_COUNTDOWN_BEATS,
} from '../lib/musicTheory';
import { normalizeLessonExercises, buildSingTimeline, isBarMatched, applyBarEvaluation } from '../lib/lessonUtils';
import { schedulePianoNote, loadInstrument } from '../lib/pianoSynth';

export function SingTrainerPage() {
  const { lessonId } = useParams();
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
  const [selectedKey, setSelectedKey] = useState(initialOptions.selectedKey);
  const [tempoBpm, setTempoBpm] = useState(initialOptions.tempoBpm);
  const [playTonicCadence, setPlayTonicCadence] = useState(initialOptions.playTonicCadence);
  const [hearExerciseFirst, setHearExerciseFirst] = useState(initialOptions.hearExerciseFirst);
  const [singOctave, setSingOctave] = useState(initialOptions.singOctave);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [index, setIndex] = useState(0);
  const [correctIndices, setCorrectIndices] = useState([]);
  const [isPlayingTarget, setIsPlayingTarget] = useState(false);
  const [toleranceCents, setToleranceCents] = useState(initialOptions.toleranceCents);
  const [gracePeriodPercent, setGracePeriodPercent] = useState(initialOptions.gracePeriodPercent);
  const [instrument, setInstrument] = useState(initialOptions.instrument);
  const [session, setSession] = useState(null);
  const [barResults, setBarResults] = useState({});
  const evaluatedBarsRef = useRef(new Set());
  const historyRef = useRef([]);

  const pitchSettings = useMemo(() => loadPitchSettings(), []);
  const { current, history } = usePitchDetector(pitchSettings, true, { maxHistoryPoints: 300 });

  const allowedKeys = lesson.allowedKeys?.length ? lesson.allowedKeys : [lesson.defaultKey ?? 'C'];
  const tempoRange = lesson.tempoRange ?? { min: 30, max: 180 };
  const allowedOctaves = lesson.allowedOctaves?.length ? lesson.allowedOctaves : [lesson.defaultOctave ?? 4];
  const keySemitoneShift = keyToSemitone(selectedKey) - keyToSemitone(lesson.defaultKey ?? selectedKey);
  const octaveShift = (singOctave - lesson.defaultOctave) * 12;
  const totalMidiShift = keySemitoneShift + octaveShift;
  const activeExercise = lessonExercises[exerciseIndex] ?? lessonExercises[0];
  const activeEvents = activeExercise?.notes ?? [];
  const activeNotes = activeEvents.filter((note) => note?.type !== 'rest' && Number.isFinite(note?.midi));

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
  if (hasSavedPitchRange) {
    if (rangeRecommendation) {
      const fitNote = rangeRecommendation.fitsCompletely ? '' : ' (closest fit)';
      rangeSuggestionText = `Suggestion: Key ${rangeRecommendation.key}, Oct ${rangeRecommendation.octave}${fitNote}.`;
    } else {
      rangeSuggestionText = 'No key/octave recommendation available for this lesson.';
    }
  } else {
    rangeSuggestionText = 'No saved pitch range yet. Use the Vocal Range page first.';
  }
  const disableApplyRangeDefaults = !rangeRecommendation
    || (rangeRecommendation.key === selectedKey && rangeRecommendation.octave === singOctave);

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

    const timeline = buildSingTimeline({
      notes,
      tempoBpm,
      singOctave,
      selectedKey,
      playTonicCadence,
      hearExerciseFirst,
      gracePeriodPercent,
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
    await context.resume().catch(() => undefined);

    try {
      const beatSeconds = beatSecondsFromTempo(tempoBpm);
      let startAt = context.currentTime + AUDIO_START_OFFSET_SECONDS;

      if (playTonicCadence) {
        const tonicMidi = tonicMidiFromKeyOctave(selectedKey, singOctave);
        CADENCE_CHORD_OFFSETS.forEach((offset) => {
          const chordRoot = tonicMidi + offset;
          TRIAD_INTERVALS.forEach((triadOffset) => {
            schedulePianoNote(context, midiToFrequencyHz(chordRoot + triadOffset), startAt, beatSeconds, CADENCE_CHORD_GAIN);
          });
          startAt += beatSeconds;
        });
        startAt += NOTE_GAP_SECONDS * 2;
      }

      if (hearExerciseFirst) {
        for (const note of notes) {
          const beats = Number.isFinite(note.durationBeats) ? note.durationBeats : 1;
          const noteDurationSeconds = Math.max(MIN_NOTE_DURATION_SECONDS, beatSeconds * beats * NOTE_DURATION_SCALE);
          if (note?.type === 'rest' || !Number.isFinite(note?.midi)) {
            startAt += noteDurationSeconds + NOTE_GAP_SECONDS;
            continue;
          }
          schedulePianoNote(context, midiToFrequencyHz(note.midi), startAt, noteDurationSeconds, TARGET_NOTE_GAIN);
          startAt += noteDurationSeconds + NOTE_GAP_SECONDS;
        }
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
    setHearExerciseFirst(persistedOptions.hearExerciseFirst);
    setSingOctave(persistedOptions.singOctave);
    setToleranceCents(persistedOptions.toleranceCents);
    setGracePeriodPercent(persistedOptions.gracePeriodPercent);
    setInstrument(persistedOptions.instrument);

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
      hearExerciseFirst,
      singOctave,
      toleranceCents,
      gracePeriodPercent,
      instrument,
    });
  }, [lesson, playTonicCadence, hearExerciseFirst, selectedKey, singOctave, tempoBpm, toleranceCents, gracePeriodPercent, instrument]);

  useEffect(() => {
    void loadInstrument(instrument);
  }, [instrument]);

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
        if (elapsedSec < bar.scoreEndSec || evaluatedBarsRef.current.has(bar.id)) {
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

        <SingTrainingOptionsSection
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
          hearExerciseFirst={hearExerciseFirst}
          onHearExerciseFirstChange={setHearExerciseFirst}
          rangeSuggestionText={rangeSuggestionText}
          onApplyRangeDefaults={applyRangeDefaults}
          disableApplyRangeDefaults={disableApplyRangeDefaults}
          instrument={instrument}
          onInstrumentChange={setInstrument}
          toleranceCents={toleranceCents}
          onToleranceCentsChange={setToleranceCents}
          gracePeriodPercent={gracePeriodPercent}
          onGracePeriodPercentChange={setGracePeriodPercent}
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
            className="button secondary"
            to={`/trainer/${lessonId}/sing-v2`}
            title="Open V2 sing trainer"
            aria-label="Open V2 sing trainer"
          >
            V2
          </Link>
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
                const label = note.degree ? `${note.degree}${noteOctave}` : midiToNoteLabel(shiftedMidi);
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


