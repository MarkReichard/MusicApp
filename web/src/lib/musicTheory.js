// ── Pitch / interval constants ─────────────────────────────────────────────────
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const SEMITONES_PER_OCTAVE = 12;
export const CONCERT_A_MIDI = 69;   // A4
export const CONCERT_A_HZ = 440;
export const KEY_OPTIONS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const NATURAL_KEY_OPTIONS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const DIATONIC_SCALE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
export const DIATONIC_SOLFEGE_NAMES = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti'];
export const MAJOR_SCALE_SEMITONES = [...DIATONIC_SCALE_SEMITONES, 12];
export const CHROMATIC_SOLFEGE = ['Do', 'Di', 'Re', 'Ri', 'Mi', 'Fa', 'Fi', 'Sol', 'Si', 'La', 'Li', 'Ti'];
export const MAJOR_SOLFEGE_BY_SEMITONE = {
  0: 'Do',
  2: 'Re',
  4: 'Mi',
  5: 'Fa',
  7: 'Sol',
  9: 'La',
  11: 'Ti',
  12: "Do'",
};

// ── Cadence intervals ──────────────────────────────────────────────────────────
export const CADENCE_CHORD_OFFSETS = [0, 5, 7, 5];  // I – IV – V – IV
export const TRIAD_INTERVALS = [0, 4, 7];            // root, major 3rd, perfect 5th

// ── Tempo ──────────────────────────────────────────────────────────────────────
export const MIN_TEMPO_BPM = 40;              // clamp floor for beat calculation
export const DEFAULT_FALLBACK_TEMPO_BPM = 90; // used when tempoBpm is missing/invalid

// ── Audio timing ───────────────────────────────────────────────────────────────
export const NOTE_DURATION_SCALE = 0.92;           // fraction of beat used for note sound
export const MIN_NOTE_DURATION_SECONDS = 0.12;     // floor on note playback duration
export const AUDIO_START_OFFSET_SECONDS = 0.03;    // initial delay before first scheduled event
export const NOTE_GAP_SECONDS = 0.03;              // silence between consecutive notes
export const PLAYBACK_BUFFER_MS = 40;              // extra setTimeout padding after last note
export const MASTER_VOLUME = 1.3;                  // master volume multiplier — adjust to scale all audio gain
export const CADENCE_CHORD_GAIN = 0.08 * MASTER_VOLUME;  // gain for cadence chords
export const TARGET_NOTE_GAIN = 0.16 * MASTER_VOLUME;    // gain for target notes
export const METRONOME_VOLUME_REFERENCE_PERCENT = 100;    // UI baseline/reference point for metronome slider
export const METRONOME_BASE_CLICK_GAIN = TARGET_NOTE_GAIN * 3.6; // 100% louder than previous baseline
export const SING_COUNTDOWN_BEATS = 1;             // beats for sing countdown

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

/** Converts a frequency in Hz to a MIDI note number, or null if invalid. */
export function frequencyToMidi(frequencyHz) {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return null;
  return CONCERT_A_MIDI + SEMITONES_PER_OCTAVE * Math.log2(frequencyHz / CONCERT_A_HZ);
}

/** Returns a human-readable note label (e.g. "C#4") for a MIDI number. */
export function midiToNoteLabel(midi) {
  if (!Number.isFinite(midi)) return '-';
  const roundedMidi = Math.round(midi);
  const name = NOTE_NAMES[roundedMidi % SEMITONES_PER_OCTAVE] ?? 'C';
  const octave = Math.floor(roundedMidi / SEMITONES_PER_OCTAVE) - 1;
  return `${name}${octave}`;
}

/**
 * Normalizes a detected MIDI value to the octave nearest the reference MIDI.
 * Useful when pitch detectors jump by octaves/harmonics.
 */
export function nearestMidiByOctave(candidateMidi, referenceMidi) {
  if (!Number.isFinite(candidateMidi) || !Number.isFinite(referenceMidi)) {
    return candidateMidi;
  }

  let best = candidateMidi;
  while (best - referenceMidi > 6) {
    best -= 12;
  }
  while (referenceMidi - best > 6) {
    best += 12;
  }
  return best;
}

/** Returns the tonic MIDI number for a given key name and sing octave. */
export function tonicMidiFromKeyOctave(key, octave) {
  return SEMITONES_PER_OCTAVE * (octave + 1) + keyToSemitone(key);
}

/** Returns the major-scale solfege syllable for a semitone offset above tonic. */
export function solfegeForMajorScaleSemitone(semitones) {
  return MAJOR_SOLFEGE_BY_SEMITONE[semitones] ?? '';
}

/**
 * Returns the chromatic solfege syllable for a semitone offset.
 * Uses movable-do with sharp direction (e.g., Do, Di, Re, Ri, Mi, Fa, ...).
 * Supports octave shifts above/below the current octave via apostrophes.
 */
export function solfegeForChromaticOffset(semitoneOffset) {
  if (!Number.isFinite(semitoneOffset)) {
    return '';
  }
  const rounded = Math.round(semitoneOffset);
  const normalized = ((rounded % 12) + 12) % 12;
  const octaveShift = Math.floor(rounded / 12);
  const base = CHROMATIC_SOLFEGE[normalized] ?? '';
  if (!base) {
    return '';
  }
  return octaveShift > 0 ? `${base}${"'".repeat(octaveShift)}` : base;
}

/** Returns the route through the major scale from a scale degree back to tonic. */
export function buildMajorScaleRouteSemitones(semitones) {
  const index = MAJOR_SCALE_SEMITONES.indexOf(semitones);
  if (index === -1) {
    return [];
  }
  return semitones <= 5
    ? MAJOR_SCALE_SEMITONES.slice(0, index + 1).reverse()
    : MAJOR_SCALE_SEMITONES.slice(index);
}

/** Returns the MIDI notes for the major-scale route from a target degree back to tonic. */
export function buildMajorScaleRouteMidi(tonicMidi, semitones) {
  return buildMajorScaleRouteSemitones(semitones).map((offset) => tonicMidi + offset);
}

/**
 * Normalizes detected pitch by testing harmonic subharmonics, then selects
 * the candidate closest to target MIDI in the appropriate octave.
 * Handles cases where low fundamentals are misread as harmonics.
 */
export function normalizeDetectedMidiForTarget(detectedMidi, detectedHz, targetMidi) {
  if (!Number.isFinite(targetMidi)) return detectedMidi;

  const candidates = [];
  if (Number.isFinite(detectedMidi)) {
    candidates.push(detectedMidi);
  }

  // Low fundamentals can be misread as harmonics. Try common subharmonics.
  if (Number.isFinite(detectedHz) && detectedHz > 0) {
    const harmonicDivisors = [2, 3, 4];
    harmonicDivisors.forEach((divisor) => {
      const correctedMidi = frequencyToMidi(detectedHz / divisor);
      if (Number.isFinite(correctedMidi)) {
        candidates.push(correctedMidi);
      }
    });
  }

  if (!candidates.length) return detectedMidi;

  let best = nearestMidiByOctave(candidates[0], targetMidi);
  let bestDiff = Math.abs(best - targetMidi);
  for (let index = 1; index < candidates.length; index += 1) {
    const normalized = nearestMidiByOctave(candidates[index], targetMidi);
    const diff = Math.abs(normalized - targetMidi);
    if (diff < bestDiff) {
      best = normalized;
      bestDiff = diff;
    }
  }
  return best;
}
