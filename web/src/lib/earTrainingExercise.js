import { buildMajorScaleRouteMidi } from './musicTheory';

export const EAR_EXERCISE_MODES = {
  SINGLE_TONIC_RESOLVE: 'single-tonic-resolve',
  NOTE_PATTERN: 'note-pattern',
};

export const EAR_PATTERN_TYPES = {
  RANDOM_ARPEGGIO: 'random-arpeggio',
  RANDOM_PENTATONIC: 'random-pentatonic',
  RANDOM_CHROMATIC: 'random-chromatic',
};

export const EAR_EXERCISE_MODE_OPTIONS = [
  { value: EAR_EXERCISE_MODES.SINGLE_TONIC_RESOLVE, label: 'Single note with tonic resolution' },
  { value: EAR_EXERCISE_MODES.NOTE_PATTERN, label: 'Random note pattern' },
];

export const EAR_PATTERN_TYPE_OPTIONS = [
  { value: EAR_PATTERN_TYPES.RANDOM_ARPEGGIO, label: 'Random arpeggio notes' },
  { value: EAR_PATTERN_TYPES.RANDOM_PENTATONIC, label: 'Random pentatonic' },
  { value: EAR_PATTERN_TYPES.RANDOM_CHROMATIC, label: 'Random chromatic' },
];

export const MIN_PATTERN_NOTE_COUNT = 2;
export const MAX_PATTERN_NOTE_COUNT = 12;
export const STARTING_CHORD_MAX_INTERVAL = 7;

const PATTERN_INTERVALS = {
  [EAR_PATTERN_TYPES.RANDOM_ARPEGGIO]: [0, 4, 7, 12, 16, 19],
  [EAR_PATTERN_TYPES.RANDOM_PENTATONIC]: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21],
  [EAR_PATTERN_TYPES.RANDOM_CHROMATIC]: [
    0, 1, 2, 3, 4, 5, 6,
    7, 8, 9, 10, 11, 12,
  ],
};

// Movable-do chromatic solfege (sharp direction) used for pattern labels.
const CHROMATIC_SOLFEGE = ['Do', 'Di', 'Re', 'Ri', 'Mi', 'Fa', 'Fi', 'Sol', 'Si', 'La', 'Li', 'Ti'];

function pickRandomFrom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function clampPatternNoteCount(noteCount) {
  const parsed = Number(noteCount);
  if (!Number.isFinite(parsed)) {
    return MIN_PATTERN_NOTE_COUNT;
  }
  const rounded = Math.round(parsed);
  return Math.max(MIN_PATTERN_NOTE_COUNT, Math.min(MAX_PATTERN_NOTE_COUNT, rounded));
}

function solfegeForPatternInterval(interval) {
  if (!Number.isFinite(interval)) return '';
  const normalized = ((Math.round(interval) % 12) + 12) % 12;
  const octaveShift = Math.floor(Math.round(interval) / 12);
  const base = CHROMATIC_SOLFEGE[normalized] ?? '';
  if (!base) return '';
  if (octaveShift <= 0) return base;
  return `${base}${"'".repeat(octaveShift)}`;
}

export function isMidiInRange(midi, minMidi = null, maxMidi = null) {
  if (!Number.isFinite(midi)) return false;
  if (Number.isFinite(minMidi) && midi < minMidi) return false;
  if (Number.isFinite(maxMidi) && midi > maxMidi) return false;
  return true;
}

export function isSequenceInRange(sequence, minMidi = null, maxMidi = null) {
  return Array.isArray(sequence) && sequence.length > 0
    ? sequence.every((midi) => isMidiInRange(midi, minMidi, maxMidi))
    : false;
}

export function getAvailablePatternMidis({
  tonicMidi,
  patternType,
  minMidi = null,
  maxMidi = null,
  limitToStartingChord = false,
}) {
  const intervals = PATTERN_INTERVALS[patternType] ?? PATTERN_INTERVALS[EAR_PATTERN_TYPES.RANDOM_ARPEGGIO];
  const limitedIntervals = limitToStartingChord
    ? intervals.filter((interval) => interval >= 0 && interval <= STARTING_CHORD_MAX_INTERVAL)
    : intervals;
  return limitedIntervals
    .map((interval) => tonicMidi + interval)
    .filter((midi) => isMidiInRange(midi, minMidi, maxMidi));
}

export function buildSingleTonicRound({ tonicMidi, degree, minMidi = null, maxMidi = null }) {
  const singMidiSeq = buildMajorScaleRouteMidi(tonicMidi, degree.semitones);
  if (!isSequenceInRange(singMidiSeq, minMidi, maxMidi)) {
    return null;
  }

  return {
    mode: EAR_EXERCISE_MODES.SINGLE_TONIC_RESOLVE,
    degreeIndex: degree.index,
    displayName: degree.name,
    detailLabel: degree.semitones <= 5 ? 'descend to Do' : 'ascend to Do\'',
    promptMidiSeq: [singMidiSeq[0]],
    singMidiSeq,
    guideBeatsPerNote: 2,
    scoreMode: 'first-note',
  };
}

export function buildPatternRound({
  tonicMidi,
  patternType,
  noteCount,
  minMidi = null,
  maxMidi = null,
  limitToStartingChord = false,
}) {
  const boundedNoteCount = clampPatternNoteCount(noteCount);
  const availableMidis = getAvailablePatternMidis({
    tonicMidi,
    patternType,
    minMidi,
    maxMidi,
    limitToStartingChord,
  });
  if (availableMidis.length === 0) {
    return null;
  }

  const singMidiSeq = Array.from({ length: boundedNoteCount }, () => pickRandomFrom(availableMidis));
  const detailLabel = singMidiSeq
    .map((midi) => solfegeForPatternInterval(midi - tonicMidi))
    .filter(Boolean)
    .join(' ');

  return {
    mode: EAR_EXERCISE_MODES.NOTE_PATTERN,
    degreeIndex: null,
    displayName: `${boundedNoteCount}-note pattern`,
    detailLabel,
    promptMidiSeq: [...singMidiSeq],
    singMidiSeq,
    guideBeatsPerNote: 1,
    scoreMode: 'all-notes',
  };
}
