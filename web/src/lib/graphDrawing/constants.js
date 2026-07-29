// ── SingInputGraphV2 render constants ──────────────────────────────────────────

export const MIN_TIMELINE_SECONDS = 12;
export const TIMELINE_RIGHT_PAD_SECONDS = 1;
export const GRAPH_PIXELS_PER_SECOND = 90;
export const PIXELS_PER_SECOND = GRAPH_PIXELS_PER_SECOND;
export const CHORD_STRIP_H = 22; // canvas pixels reserved at bottom for chord labels
export const FOLLOW_CURSOR_RATIO = 0.35;
export const TARGET_FRAME_MS = 33;
export const SCROLL_SMOOTHING_FACTOR = 0.18;
export const MAX_DRAW_JUMP_SEMITONES = 5;
export const MAX_DRAW_GAP_SEC = 0.32;
export const MAX_DRAW_GAP_HIGH_ENERGY_SEC = 0.9;
export const HIGH_ENERGY_DB_THRESHOLD = -55;
export const LOW_BLEND_CENTS = 70;
export const HIGH_BLEND_CENTS = 40;
export const DIRECTION_TOOLTIP_EPSILON_CENTS = 5;

// ── Chord rendering ────────────────────────────────────────────────────────────

export const CHORD_KIND_SUFFIX = {
  major: '', 'major-seventh': 'M7', 'major-sixth': '6',
  minor: 'm', 'minor-seventh': 'm7', 'minor-sixth': 'm6',
  dominant: '7', 'dominant-seventh': '7', 'dominant-ninth': '9',
  diminished: '°', 'diminished-seventh': '°7', 'half-diminished': 'ø7',
  augmented: '+', 'suspended-fourth': 'sus4', 'suspended-second': 'sus2', power: '5',
};