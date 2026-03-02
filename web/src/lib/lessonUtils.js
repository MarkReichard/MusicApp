import {
  beatSecondsFromTempo,
  keyToSemitone,
  tonicMidiFromKeyOctave,
  SEMITONES_PER_OCTAVE,
  CADENCE_CHORD_OFFSETS,
  TRIAD_INTERVALS,
  NOTE_GAP_SECONDS,
  MIN_NOTE_DURATION_SECONDS,
  NOTE_DURATION_SCALE,
  AUDIO_START_OFFSET_SECONDS,
} from './musicTheory.js';

const DEFAULT_TEMPO_RANGE = { min: 30, max: 180 };
const DEFAULT_OCTAVE = 4;

/**
 * Returns true for song lessons that use the flat measures[] schema.
 */
export function isSongLesson(lesson) {
  return lesson?.type === 'song' && Array.isArray(lesson.measures) && lesson.measures.length > 0;
}

/**
 * Slices a lesson's measures[] into sections of `windowSize` measures each.
 * Each section: { id, notes: flattenedNotes, measures: rawMeasures[] }
 * @param {object|null} lesson
 * @param {number} windowSize  Measures per section (default 4)
 * @returns {{ id: string, notes: object[], measures: object[] }[]}
 */
export function buildSections(lesson, windowSize = 4) {
  if (!lesson?.measures?.length) return [];
  const { measures } = lesson;
  const result = [];
  for (let i = 0; i < measures.length; i += windowSize) {
    const windowMeasures = measures.slice(i, i + windowSize);
    const notes = windowMeasures.flatMap((m) => m.notes ?? []);
    if (notes.length === 0) continue;
    const startIdx = windowMeasures[0].index;
    const endIdx = windowMeasures.at(-1).index;
    result.push({
      id: `m${startIdx}-${endIdx}`,
      notes,
      measures: windowMeasures,
    });
  }
  return result;
}

/**
 * Builds the full audio/visual timeline for a sing-along exercise.
 * Used by SingTrainerV2Page.
 */
export function buildSingTimeline({ notes, tempoBpm, singOctave, selectedKey, playTonicCadence, hearExerciseFirst, gracePeriodPercent, countdownBeats }) {
  const beatSeconds = beatSecondsFromTempo(tempoBpm);
  let cursor = AUDIO_START_OFFSET_SECONDS;
  const playedBars = [];
  const expectedBars = [];

  if (playTonicCadence) {
    const tonicMidi = tonicMidiFromKeyOctave(selectedKey, singOctave);
    CADENCE_CHORD_OFFSETS.forEach((offset, cadenceIndex) => {
      const chordRoot = tonicMidi + offset;
      TRIAD_INTERVALS.forEach((triadOffset, triadIndex) => {
        playedBars.push({
          id: `cadence-${cadenceIndex}-${triadIndex}`,
          startSec: cursor,
          endSec: cursor + beatSeconds,
          midi: chordRoot + triadOffset,
        });
      });
      cursor += beatSeconds;
    });
    cursor += NOTE_GAP_SECONDS * 2;
  }

  if (hearExerciseFirst) {
    notes.forEach((note, noteIndex) => {
      const beats = Number.isFinite(note.durationBeats) ? note.durationBeats : 1;
      const noteDurationSeconds = Math.max(MIN_NOTE_DURATION_SECONDS, beatSeconds * beats * NOTE_DURATION_SCALE);
      if (note.type !== 'rest') {
        playedBars.push({
          id: `played-${noteIndex}`,
          startSec: cursor,
          endSec: cursor + noteDurationSeconds,
          midi: note.midi,
        });
      }
      cursor += noteDurationSeconds + NOTE_GAP_SECONDS;
    });
  }

  const singStartSec = cursor;
  const expectedStartSec = singStartSec + beatSeconds * countdownBeats;
  let singCursor = expectedStartSec;

  notes.forEach((note, noteIndex) => {
    const beats = Number.isFinite(note.durationBeats) ? note.durationBeats : 1;
    const noteDurationSeconds = Math.max(MIN_NOTE_DURATION_SECONDS, beatSeconds * beats * NOTE_DURATION_SCALE);
    const graceRatio = Math.max(0.5, Math.min(1, Number(gracePeriodPercent) / 100));
    const scoreDurationSeconds = noteDurationSeconds * graceRatio;
    if (note.type !== 'rest') {
      expectedBars.push({
        id: `expected-${noteIndex}`,
        index: noteIndex,
        startSec: singCursor,
        endSec: singCursor + scoreDurationSeconds,
        scoreEndSec: singCursor + scoreDurationSeconds,
        midi: note.midi,
      });
    }
    singCursor += noteDurationSeconds + NOTE_GAP_SECONDS;
  });

  const lastExpectedEndSec = expectedBars.length
    ? expectedBars.at(-1).endSec
    : singStartSec;
  const stopScrollSec = lastExpectedEndSec + beatSeconds * 2;

  return { playedBars, expectedBars, singStartSec, stopScrollSec };
}

/**
 * Determines whether a user's pitch history satisfies a given bar's expected MIDI.
 * Used by SingTrainerV2Page.
 */
export function isBarMatched({ bar, history, sessionStartMs, toleranceCents }) {
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

  const centsDiffs = midiValues.map((midi) => Math.abs((midi - bar.midi) * 100));
  const inTolerance = centsDiffs.filter((diff) => diff <= toleranceCents).length;
  const inToleranceRatio = inTolerance / centsDiffs.length;
  const averageDiff = centsDiffs.reduce((sum, diff) => sum + diff, 0) / centsDiffs.length;

  return inToleranceRatio >= 0.35 || averageDiff <= toleranceCents;
}

/**
 * Applies bar evaluation results to the progress/correct-indices state.
 * Used by SingTrainerV2Page.
 */
export function applyBarEvaluation({ bar, matched, activeNotesLength, setCorrectIndices, setIndex }) {
  if (matched) {
    setCorrectIndices((previous) => (previous.includes(bar.index) ? previous : [...previous, bar.index]));
  }

  setIndex((previous) => {
    const nextIndex = Math.min(bar.index + 1, Math.max(0, activeNotesLength - 1));
    return previous === nextIndex ? previous : nextIndex;
  });
}

/**
 * Returns the lesson's allowed keys, tempo range, and allowed octaves, falling back to defaults.
 */
export function getLessonDefaults(lesson) {
  return {
    allowedKeys: lesson.allowedKeys?.length ? lesson.allowedKeys : [lesson.defaultKey ?? 'C'],
    tempoRange: lesson.tempoRange ?? DEFAULT_TEMPO_RANGE,
    allowedOctaves: lesson.allowedOctaves?.length ? lesson.allowedOctaves : [lesson.defaultOctave ?? DEFAULT_OCTAVE],
  };
}

/**
 * Computes the key/octave semitone shifts needed to transpose a lesson to a chosen key and octave.
 */
export function computeTransposition(lesson, selectedKey, singOctave) {
  const keySemitoneShift = keyToSemitone(selectedKey) - keyToSemitone(lesson.defaultKey ?? selectedKey);
  const octaveShift = (singOctave - lesson.defaultOctave) * SEMITONES_PER_OCTAVE;
  const totalMidiShift = keySemitoneShift + octaveShift;
  return { keySemitoneShift, octaveShift, totalMidiShift };
}

/**
 * Applies a MIDI shift to all pitched events in a notes array, leaving rests unchanged.
 */
export function shiftNotes(activeEvents, totalMidiShift) {
  return activeEvents.map((note) => {
    if (note?.type === 'rest' || !Number.isFinite(note?.midi)) {
      return { ...note };
    }
    return { ...note, midi: note.midi + totalMidiShift };
  });
}

/**
 * Builds the range suggestion text shown to users in trainer options.
 */
export function getRangeSuggestionText(hasSavedPitchRange, rangeRecommendation) {
  if (!hasSavedPitchRange) {
    return 'No saved pitch range yet. Use the Pitch Range page first.';
  }
  if (rangeRecommendation) {
    const fitNote = rangeRecommendation.fitsCompletely ? '' : ' (closest fit)';
    return `Suggestion: Key ${rangeRecommendation.key}, Oct ${rangeRecommendation.octave}${fitNote}.`;
  }
  return 'No key/octave recommendation available for this lesson.';
}
