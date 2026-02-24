// ── Pitch / interval constants ─────────────────────────────────────────────────
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const SEMITONES_PER_OCTAVE = 12;
export const CONCERT_A_MIDI = 69;   // A4
export const CONCERT_A_HZ = 440;

// ── Cadence intervals ──────────────────────────────────────────────────────────
export const CADENCE_CHORD_OFFSETS = [0, 5, 7, 5];  // I – IV – V – IV
export const TRIAD_INTERVALS = [0, 4, 7];            // root, major 3rd, perfect 5th

// ── Tempo ──────────────────────────────────────────────────────────────────────
export const MIN_TEMPO_BPM = 40;              // clamp floor for beat calculation
export const DEFAULT_FALLBACK_TEMPO_BPM = 90; // used when tempoBpm is missing/invalid

// ── Key → semitone map ─────────────────────────────────────────────────────────
export const KEY_TO_SEMITONE = {
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

/** Returns the semitone offset (0–11) for a key name string, defaulting to 0. */
export function keyToSemitone(key) {
  return KEY_TO_SEMITONE[key] ?? 0;
}

/** Converts a tempo in BPM to the duration of one beat in seconds. */
export function beatSecondsFromTempo(tempoBpm) {
  return 60 / Math.max(MIN_TEMPO_BPM, Number(tempoBpm) || DEFAULT_FALLBACK_TEMPO_BPM);
}

/** Converts a MIDI note number to its frequency in Hz (A4 = 440 Hz). */
export function midiToFrequencyHz(midi) {
  return CONCERT_A_HZ * Math.pow(2, (midi - CONCERT_A_MIDI) / SEMITONES_PER_OCTAVE);
}

/** Returns a human-readable note label (e.g. "C#4") for a MIDI number. */
export function midiToNoteLabel(midi) {
  if (!Number.isFinite(midi)) return '-';
  const roundedMidi = Math.round(midi);
  const name = NOTE_NAMES[roundedMidi % SEMITONES_PER_OCTAVE] ?? 'C';
  const octave = Math.floor(roundedMidi / SEMITONES_PER_OCTAVE) - 1;
  return `${name}${octave}`;
}
