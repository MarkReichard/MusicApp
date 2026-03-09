import { keyToSemitone } from './musicTheory.js';

export function recommendKeyAndOctaveForRange({ lesson, userMinMidi, userMaxMidi, marginSemitones = 1 }) {
  if (!lesson) {
    return null;
  }

  if (!Number.isFinite(userMinMidi) || !Number.isFinite(userMaxMidi) || userMinMidi >= userMaxMidi) {
    return null;
  }

  const baseMidis = collectLessonMidis(lesson);
  if (!baseMidis.length) {
    return null;
  }

  const allowedKeys = lesson.allowedKeys?.length ? lesson.allowedKeys : [lesson.defaultKey ?? 'C'];
  const allowedOctaves = lesson.allowedOctaves?.length ? lesson.allowedOctaves : [lesson.defaultOctave ?? 4];
  const defaultKey = lesson.defaultKey ?? allowedKeys[0] ?? 'C';
  const defaultOctave = Number.isFinite(lesson.defaultOctave) ? lesson.defaultOctave : (allowedOctaves[0] ?? 4);

  const baseMin = Math.min(...baseMidis);
  const baseMax = Math.max(...baseMidis);
  const baseCenter = (baseMin + baseMax) / 2;
  const userCenter = (userMinMidi + userMaxMidi) / 2;

  let best = null;

  for (const key of allowedKeys) {
    for (const octave of allowedOctaves) {
      const semitoneShift = keyToSemitone(key) - keyToSemitone(defaultKey) + (octave - defaultOctave) * 12;
      const shiftedMin = baseMin + semitoneShift;
      const shiftedMax = baseMax + semitoneShift;
      const shiftedCenter = baseCenter + semitoneShift;

      const lowerOverflow = Math.max(0, (userMinMidi + marginSemitones) - shiftedMin);
      const upperOverflow = Math.max(0, shiftedMax - (userMaxMidi - marginSemitones));
      const overflow = lowerOverflow + upperOverflow;
      const fitsCompletely = overflow === 0;

      const defaultDistance = Math.abs(keyToSemitone(key) - keyToSemitone(defaultKey)) + Math.abs(octave - defaultOctave) * 12;
      const centerDistance = Math.abs(shiftedCenter - userCenter);

      const score = overflow * 1000 + centerDistance * 10 + defaultDistance;

      if (!best || score < best.score) {
        best = {
          key,
          octave,
          fitsCompletely,
          score,
        };
      }
    }
  }

  return best;
}

function collectLessonMidis(lesson) {
  const fromNotes = Array.isArray(lesson.notes) ? lesson.notes : [];
  const fromExercises = Array.isArray(lesson.exercises)
    ? lesson.exercises.flatMap((exercise) => (Array.isArray(exercise?.notes) ? exercise.notes : []))
    : [];
  const fromMeasures = Array.isArray(lesson.measures)
    ? lesson.measures.flatMap((measure) => (Array.isArray(measure?.notes) ? measure.notes : []))
    : [];

  return [...fromNotes, ...fromExercises, ...fromMeasures]
    .map((note) => Number(note?.midi))
    .filter((midi) => Number.isFinite(midi));
}


