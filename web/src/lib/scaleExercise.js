import {
  DIATONIC_SCALE_SEMITONES,
  tonicMidiFromKeyOctave,
  midiToFrequencyHz,
  midiToNoteLabel,
} from './musicTheory';

// ── Scale types ────────────────────────────────────────────────────────────────

export const SCALE_TYPES = {
  MAJOR:             'major',
  NATURAL_MINOR:     'natural-minor',
  MAJOR_PENTATONIC:  'major-pentatonic',
  MINOR_PENTATONIC:  'minor-pentatonic',
};

export const SCALE_TYPE_OPTIONS = [
  { value: SCALE_TYPES.MAJOR,             label: 'Major' },
  { value: SCALE_TYPES.NATURAL_MINOR,     label: 'Natural Minor' },
  { value: SCALE_TYPES.MAJOR_PENTATONIC,  label: 'Major Pentatonic' },
  { value: SCALE_TYPES.MINOR_PENTATONIC,  label: 'Minor Pentatonic' },
];

export const SCALE_DIRECTIONS = {
  ASCENDING:  'ascending',
  DESCENDING: 'descending',
};

export const SCALE_DIRECTION_OPTIONS = [
  { value: SCALE_DIRECTIONS.ASCENDING,  label: 'Ascending' },
  { value: SCALE_DIRECTIONS.DESCENDING, label: 'Descending' },
];

export const PROMPT_MODES = {
  FULL_SCALE: 'full-scale',
  ROOT_ONLY:  'root-only',
};

export const PROMPT_MODE_OPTIONS = [
  { value: PROMPT_MODES.FULL_SCALE, label: 'Play full scale' },
  { value: PROMPT_MODES.ROOT_ONLY,  label: 'Play root note only' },
];

// ── Semitone interval maps ─────────────────────────────────────────────────────

const SCALE_SEMITONES = {
  [SCALE_TYPES.MAJOR]:             [0, 2, 4, 5, 7, 9, 11, 12],
  [SCALE_TYPES.NATURAL_MINOR]:     [0, 2, 3, 5, 7, 8, 10, 12],
  [SCALE_TYPES.MAJOR_PENTATONIC]:  [0, 2, 4, 7, 9, 12],
  [SCALE_TYPES.MINOR_PENTATONIC]:  [0, 3, 5, 7, 10, 12],
};

// Solfege labels for each scale type, indexed to match SCALE_SEMITONES entries
const SCALE_SOLFEGE = {
  [SCALE_TYPES.MAJOR]:             ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti', "Do'"],
  [SCALE_TYPES.NATURAL_MINOR]:     ['La', 'Ti', 'Do', 'Re', 'Mi', 'Fa', 'Sol', "La'"],
  [SCALE_TYPES.MAJOR_PENTATONIC]:  ['Do', 'Re', 'Mi', 'Sol', 'La', "Do'"],
  [SCALE_TYPES.MINOR_PENTATONIC]:  ['La', 'Do', 'Re', 'Mi', 'Sol', "La'"],
};

// ── Build scale MIDI sequence ──────────────────────────────────────────────────

export function getScaleSemitones(scaleType) {
  return SCALE_SEMITONES[scaleType] ?? SCALE_SEMITONES[SCALE_TYPES.MAJOR];
}

export function getScaleSolfege(scaleType) {
  return SCALE_SOLFEGE[scaleType] ?? SCALE_SOLFEGE[SCALE_TYPES.MAJOR];
}

/**
 * Returns an array of MIDI note numbers for the given scale configuration.
 */
export function buildScaleMidiSequence({ key, octave, scaleType, direction }) {
  const tonicMidi = tonicMidiFromKeyOctave(key, octave);
  const semitones = getScaleSemitones(scaleType);
  if (direction === SCALE_DIRECTIONS.DESCENDING) {
    const upperTonicMidi = tonicMidi + 12;
    const interiorDescendingOffsets = semitones.slice(1, -1).reverse();
    return [
      upperTonicMidi,
      ...interiorDescendingOffsets.map((offset) => tonicMidi + offset),
      tonicMidi,
    ];
  }

  return semitones.map((s) => tonicMidi + s);
}

/**
 * Returns solfege labels ordered to match the MIDI sequence direction.
 */
export function buildScaleSolfegeLabels({ scaleType, direction }) {
  const labels = [...getScaleSolfege(scaleType)];
  if (direction !== SCALE_DIRECTIONS.DESCENDING) {
    return labels;
  }

  const upperTonicLabel = labels[labels.length - 1] ?? "Do'";
  const rootLabel = labels[0] ?? 'Do';
  const interiorDescending = labels.slice(1, -1).reverse();
  return [upperTonicLabel, ...interiorDescending, rootLabel];
}

/**
 * Returns note labels (e.g. "C4", "D4") for the scale.
 */
export function buildScaleNoteLabels({ key, octave, scaleType, direction }) {
  const midis = buildScaleMidiSequence({ key, octave, scaleType, direction });
  return midis.map((m) => midiToNoteLabel(m));
}

/**
 * Returns the prompt MIDI sequence — either the full scale or just the root.
 */
export function buildPromptMidiSequence({ key, octave, scaleType, direction, promptMode }) {
  const fullSeq = buildScaleMidiSequence({ key, octave, scaleType, direction });
  if (promptMode === PROMPT_MODES.ROOT_ONLY) {
    return [fullSeq[0]];
  }
  return fullSeq;
}
