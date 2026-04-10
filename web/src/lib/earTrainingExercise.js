import { buildMajorScaleRouteMidi } from './musicTheory';

export const EAR_EXERCISE_MODES = {
  SINGLE_TONIC_RESOLVE: 'single-tonic-resolve',
  NOTE_PATTERN: 'note-pattern',
  ASCENDING_SCALE: 'ascending-scale',
  DESCENDING_SCALE: 'descending-scale',
};

export const EAR_PATTERN_TYPES = {
  RANDOM_ARPEGGIO: 'random-arpeggio',
  RANDOM_PENTATONIC: 'random-pentatonic',
  RANDOM_CHROMATIC: 'random-chromatic',
  INTERVAL_M2_UP_DOWN: 'interval-m2-up-down',
  INTERVAL_M3_UP_DOWN: 'interval-m3-up-down',
  INTERVAL_P4_UP_DOWN: 'interval-p4-up-down',
  INTERVAL_P5_UP_DOWN: 'interval-p5-up-down',
  INTERVAL_M6_UP_DOWN: 'interval-m6-up-down',
  INTERVAL_M7_UP_DOWN: 'interval-m7-up-down',
  INTERVAL_P8_UP_DOWN: 'interval-p8-up-down',
};

export const EAR_EXERCISE_MODE_OPTIONS = [
  { value: EAR_EXERCISE_MODES.SINGLE_TONIC_RESOLVE, label: 'Single note with tonic resolution' },
  { value: EAR_EXERCISE_MODES.NOTE_PATTERN, label: 'Note pattern' },
  { value: EAR_EXERCISE_MODES.ASCENDING_SCALE, label: 'Sing ascending scale' },
  { value: EAR_EXERCISE_MODES.DESCENDING_SCALE, label: 'Sing descending scale' },
];

export const EAR_PATTERN_TYPE_OPTIONS = [
  { value: EAR_PATTERN_TYPES.RANDOM_ARPEGGIO, label: 'Random arpeggio notes' },
  { value: EAR_PATTERN_TYPES.RANDOM_PENTATONIC, label: 'Random pentatonic' },
  { value: EAR_PATTERN_TYPES.RANDOM_CHROMATIC, label: 'Random chromatic' },
  { value: EAR_PATTERN_TYPES.INTERVAL_M2_UP_DOWN, label: 'Do-Re-Re-Do (2nd up/down)' },
  { value: EAR_PATTERN_TYPES.INTERVAL_M3_UP_DOWN, label: 'Do-Mi-Mi-Do (3rd up/down)' },
  { value: EAR_PATTERN_TYPES.INTERVAL_P4_UP_DOWN, label: 'Do-Fa-Fa-Do (4th up/down)' },
  { value: EAR_PATTERN_TYPES.INTERVAL_P5_UP_DOWN, label: 'Do-Sol-Sol-Do (5th up/down)' },
  { value: EAR_PATTERN_TYPES.INTERVAL_M6_UP_DOWN, label: 'Do-La-La-Do (6th up/down)' },
  { value: EAR_PATTERN_TYPES.INTERVAL_M7_UP_DOWN, label: 'Do-Ti-Ti-Do (7th up/down)' },
  { value: EAR_PATTERN_TYPES.INTERVAL_P8_UP_DOWN, label: "Do-Do'-Do'-Do (octave up/down)" },
];

export const MIN_PATTERN_NOTE_COUNT = 2;
export const MAX_PATTERN_NOTE_COUNT = 12;
export const STARTING_OCTAVE_MAX_INTERVAL = 12;

const PATTERN_INTERVALS = {
  [EAR_PATTERN_TYPES.RANDOM_ARPEGGIO]: [0, 4, 7, 12, 16, 19],
  [EAR_PATTERN_TYPES.RANDOM_PENTATONIC]: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21],
  [EAR_PATTERN_TYPES.RANDOM_CHROMATIC]: [
    0, 1, 2, 3, 4, 5, 6,
    7, 8, 9, 10, 11, 12,
  ],
};

const FIXED_INTERVAL_PATTERNS = {
  [EAR_PATTERN_TYPES.INTERVAL_M2_UP_DOWN]: {
    intervalSemitones: 2,
    displayName: '2nd up/down',
    detailLabel: 'Do Re Re Do',
  },
  [EAR_PATTERN_TYPES.INTERVAL_M3_UP_DOWN]: {
    intervalSemitones: 4,
    displayName: '3rd up/down',
    detailLabel: 'Do Mi Mi Do',
  },
  [EAR_PATTERN_TYPES.INTERVAL_P4_UP_DOWN]: {
    intervalSemitones: 5,
    displayName: '4th up/down',
    detailLabel: 'Do Fa Fa Do',
  },
  [EAR_PATTERN_TYPES.INTERVAL_P5_UP_DOWN]: {
    intervalSemitones: 7,
    displayName: '5th up/down',
    detailLabel: 'Do Sol Sol Do',
  },
  [EAR_PATTERN_TYPES.INTERVAL_M6_UP_DOWN]: {
    intervalSemitones: 9,
    displayName: '6th up/down',
    detailLabel: 'Do La La Do',
  },
  [EAR_PATTERN_TYPES.INTERVAL_M7_UP_DOWN]: {
    intervalSemitones: 11,
    displayName: '7th up/down',
    detailLabel: 'Do Ti Ti Do',
  },
  [EAR_PATTERN_TYPES.INTERVAL_P8_UP_DOWN]: {
    intervalSemitones: 12,
    displayName: 'Octave up/down',
    detailLabel: "Do Do' Do' Do",
  },
};

// Movable-do chromatic solfege (sharp direction) used for pattern labels.
const CHROMATIC_SOLFEGE = ['Do', 'Di', 'Re', 'Ri', 'Mi', 'Fa', 'Fi', 'Sol', 'Si', 'La', 'Li', 'Ti'];
const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11, 12];

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
  limitToStartingOctave = false,
}) {
  if (isFixedIntervalPatternType(patternType)) {
    const cfg = FIXED_INTERVAL_PATTERNS[patternType];
    const singMidiSeq = [tonicMidi, tonicMidi + cfg.intervalSemitones, tonicMidi + cfg.intervalSemitones, tonicMidi];
    return isSequenceInRange(singMidiSeq, minMidi, maxMidi) ? [tonicMidi, tonicMidi + cfg.intervalSemitones] : [];
  }

  const intervals = PATTERN_INTERVALS[patternType] ?? PATTERN_INTERVALS[EAR_PATTERN_TYPES.RANDOM_ARPEGGIO];
  const limitedIntervals = limitToStartingOctave
    ? intervals.filter((interval) => interval >= 0 && interval <= STARTING_OCTAVE_MAX_INTERVAL)
    : intervals;
  return limitedIntervals
    .map((interval) => tonicMidi + interval)
    .filter((midi) => isMidiInRange(midi, minMidi, maxMidi));
}

export function isFixedIntervalPatternType(patternType) {
  return Boolean(FIXED_INTERVAL_PATTERNS[patternType]);
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
  limitToStartingOctave = false,
}) {
  if (isFixedIntervalPatternType(patternType)) {
    const cfg = FIXED_INTERVAL_PATTERNS[patternType];
    const singMidiSeq = [tonicMidi, tonicMidi + cfg.intervalSemitones, tonicMidi + cfg.intervalSemitones, tonicMidi];
    if (!isSequenceInRange(singMidiSeq, minMidi, maxMidi)) {
      return null;
    }

    return {
      mode: EAR_EXERCISE_MODES.NOTE_PATTERN,
      degreeIndex: null,
      displayName: cfg.displayName,
      detailLabel: cfg.detailLabel,
      promptMidiSeq: [...singMidiSeq],
      singMidiSeq,
      guideBeatsPerNote: 1,
      scoreMode: 'all-notes',
      useSolfegeLabels: true,
    };
  }

  const boundedNoteCount = clampPatternNoteCount(noteCount);
  const availableMidis = getAvailablePatternMidis({
    tonicMidi,
    patternType,
    minMidi,
    maxMidi,
    limitToStartingOctave,
  });
  if (availableMidis.length === 0) {
    return null;
  }

  // For random patterns, allow repeated notes but avoid the degenerate
  // case where every note in the pattern is identical.
  if (boundedNoteCount > 1 && availableMidis.length < 2) {
    return null;
  }

  let singMidiSeq = Array.from({ length: boundedNoteCount }, () => pickRandomFrom(availableMidis));
  if (boundedNoteCount > 1 && availableMidis.length > 1) {
    let attempts = 0;
    while (new Set(singMidiSeq).size === 1 && attempts < 8) {
      singMidiSeq = Array.from({ length: boundedNoteCount }, () => pickRandomFrom(availableMidis));
      attempts += 1;
    }
    if (new Set(singMidiSeq).size === 1) {
      return null;
    }
  }

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

function buildScaleRound({ tonicMidi, minMidi = null, maxMidi = null, descending = false }) {
  const ascendingMidis = MAJOR_SCALE_INTERVALS.map((interval) => tonicMidi + interval);
  const singMidiSeq = descending ? [...ascendingMidis].reverse() : ascendingMidis;

  if (!isSequenceInRange(singMidiSeq, minMidi, maxMidi)) {
    return null;
  }

  return {
    mode: descending ? EAR_EXERCISE_MODES.DESCENDING_SCALE : EAR_EXERCISE_MODES.ASCENDING_SCALE,
    degreeIndex: null,
    displayName: descending ? 'Descending major scale' : 'Ascending major scale',
    detailLabel: descending ? 'Do\' Ti La Sol Fa Mi Re Do' : 'Do Re Mi Fa Sol La Ti Do\'',
    promptMidiSeq: [...singMidiSeq],
    singMidiSeq,
    guideBeatsPerNote: 1,
    scoreMode: 'all-notes',
    useSolfegeLabels: true,
  };
}

export function buildAscendingScaleRound({ tonicMidi, minMidi = null, maxMidi = null }) {
  return buildScaleRound({ tonicMidi, minMidi, maxMidi, descending: false });
}

export function buildDescendingScaleRound({ tonicMidi, minMidi = null, maxMidi = null }) {
  return buildScaleRound({ tonicMidi, minMidi, maxMidi, descending: true });
}
