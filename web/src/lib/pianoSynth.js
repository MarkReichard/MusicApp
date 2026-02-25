/**
 * Piano synthesis via the Salamander Grand Piano samples (smplr / SplendidGrandPiano).
 *
 * Manages a single shared AudioContext + SplendidGrandPiano instance for the
 * whole app. All functions degrade gracefully to additive synthesis when samples
 * haven't loaded yet (e.g. on the first render before network fetch completes).
 *
 * Call `loadPiano()` once during app initialisation so samples are ready by the
 * time the user first interacts.
 */

import { SplendidGrandPiano, Soundfont } from 'smplr';
import { CONCERT_A_HZ, CONCERT_A_MIDI, SEMITONES_PER_OCTAVE, midiToFrequencyHz } from './musicTheory';

export const INSTRUMENT_OPTIONS = [
  { value: 'acoustic_grand_piano', label: 'Grand Piano' },
  { value: 'flute',                label: 'Flute' },
  { value: 'violin',               label: 'Violin' },
  { value: 'electric_guitar_clean',label: 'Electric Guitar' },
  { value: 'choir_aahs',           label: 'Choir' },
];

// ── Singleton state ────────────────────────────────────────────────────────────
let _ctx = null;
let _piano = null;
let _loadPromise = null;

// ── Constants ──────────────────────────────────────────────────────────────────
const NEAR_ZERO           = 0.0001;
const NOTE_START_OFFSET_S = 0.01;   // tiny lookahead to avoid AudioContext click

// Feedback tones (always synthesised — no need for samples)
const BING_FREQ_HZ    = 1047;       // C6
const BING_DURATION_S = 0.9;
const BUZZ_FREQ_HZ    = 160;
const BUZZ_DURATION_S = 0.45;

// Additive-synth fallback
const HARMONICS = [
  { multiplier: 1, weight: 1    },
  { multiplier: 2, weight: 0.5  },
  { multiplier: 3, weight: 0.25 },
  { multiplier: 4, weight: 0.1  },
  { multiplier: 5, weight: 0.05 },
];
const HARMONIC_TOTAL              = HARMONICS.reduce((s, h) => s + h.weight, 0);
const SYNTH_ATTACK_S              = 0.006;
const SYNTH_HELD_SUSTAIN_RATIO    = 0.22;
const SYNTH_HELD_DECAY_S          = 0.28;
const SYNTH_RELEASE_TIME_CONSTANT = 0.02;
const SYNTH_RELEASE_S             = 0.09;

// ── Context management ─────────────────────────────────────────────────────────

function getOrCreateContext() {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new AudioContext();
  }
  if (_ctx.state === 'suspended') {
    _ctx.resume().catch(() => undefined);
  }
  return _ctx;
}

/** Returns the shared AudioContext, creating it if necessary. */
export function getAudioContext() {
  return getOrCreateContext();
}

// ── Piano loading ──────────────────────────────────────────────────────────────

/**
 * Begins loading the Salamander Grand Piano samples.
 * Safe to call multiple times — subsequent calls return the same Promise.
 * Call once in App on mount so samples are ready before the user plays anything.
 *
 * @returns {Promise<SplendidGrandPiano | null>}
 */
export function loadPiano() {
  if (_loadPromise) return _loadPromise;
  const ctx = getOrCreateContext();
  const piano = new SplendidGrandPiano(ctx);
  _loadPromise = piano.load
    .then(() => {
      _piano = piano;
      return piano;
    })
    .catch((err) => {
      console.warn('[pianoSynth] Sample load failed — falling back to additive synth:', err);
      _loadPromise = null; // allow retry on next call
      return null;
    });
  return _loadPromise;
}

/**
 * Switches the playback instrument to any Soundfont instrument name.
 * Falls back to additive synth while loading.
 *
 * @param {string} instrumentName  e.g. 'flute', 'violin', 'acoustic_grand_piano'
 * @returns {Promise<void>}
 */
export async function loadInstrument(instrumentName) {
  _piano = null; // use additive synth fallback while loading
  _loadPromise = null;
  const ctx = getOrCreateContext();
  try {
    const sf = new Soundfont(ctx, { instrument: instrumentName });
    await sf.load;
    _piano = sf;
    _loadPromise = Promise.resolve(sf);
  } catch (err) {
    console.warn('[pianoSynth] Soundfont load failed:', err);
  }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function freqToMidi(freq) {
  return Math.round(CONCERT_A_MIDI + SEMITONES_PER_OCTAVE * Math.log2(freq / CONCERT_A_HZ));
}

/**
 * Maps our typical gain range (0.08–0.18 → velocity 56–126).
 * Formula: gain × 700, clamped to [1, 127].
 */
function gainToVelocity(peakGain) {
  return Math.max(1, Math.min(127, Math.round(peakGain * 700)));
}

/**
 * Translates a future AudioContext time expressed relative to `externalCtx`
 * into the equivalent absolute time in the shared `_ctx`.
 */
function translateTime(startAt, externalCtx) {
  const offset = startAt - externalCtx.currentTime;
  return _ctx.currentTime + Math.max(0, offset);
}

// ── Additive-synth fallback helpers ───────────────────────────────────────────

function createSynthPartials(ctx, freq, masterGain, startAt) {
  return HARMONICS.map(({ multiplier, weight }) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * multiplier;
    const hg = ctx.createGain();
    hg.gain.value = weight / HARMONIC_TOTAL;
    osc.connect(hg);
    hg.connect(masterGain);
    osc.start(startAt);
    return osc;
  });
}

function scheduleSynthNote(ctx, freq, startAt, durationS, peakGain) {
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(NEAR_ZERO, startAt);
  masterGain.gain.linearRampToValueAtTime(peakGain, startAt + SYNTH_ATTACK_S);
  masterGain.gain.exponentialRampToValueAtTime(NEAR_ZERO, startAt + durationS);
  masterGain.connect(ctx.destination);
  const stopAt = startAt + durationS + 0.05;
  createSynthPartials(ctx, freq, masterGain, startAt).forEach((osc) => osc.stop(stopAt));
}

function startSynthHeld(ctx, freq, peakGain) {
  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(NEAR_ZERO, now);
  masterGain.gain.linearRampToValueAtTime(peakGain, now + SYNTH_ATTACK_S);
  masterGain.gain.exponentialRampToValueAtTime(
    peakGain * SYNTH_HELD_SUSTAIN_RATIO,
    now + SYNTH_HELD_DECAY_S,
  );
  masterGain.connect(ctx.destination);
  const oscillators = createSynthPartials(ctx, freq, masterGain, now);
  return {
    stop() {
      const stopAt = ctx.currentTime;
      try {
        masterGain.gain.cancelScheduledValues(stopAt);
        masterGain.gain.setTargetAtTime(NEAR_ZERO, stopAt, SYNTH_RELEASE_TIME_CONSTANT);
      } catch { /* ignore */ }
      oscillators.forEach((osc) => {
        try { osc.stop(stopAt + SYNTH_RELEASE_S); } catch { /* ignore */ }
      });
    },
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Schedules a piano note at a future time expressed relative to `externalCtx`.
 * Falls back to additive synth when samples have not loaded yet.
 *
 * @param {AudioContext} externalCtx  Caller's reference context (used only for time translation)
 * @param {number}       freq         Frequency in Hz
 * @param {number}       startAt      Absolute time in `externalCtx` to start
 * @param {number}       durationS    Duration in seconds
 * @param {number}       peakGain     Peak amplitude (0–1)
 */
export function schedulePianoNote(externalCtx, freq, startAt, durationS, peakGain) {
  if (_piano && _ctx) {
    const midi = freqToMidi(freq);
    const time = translateTime(startAt, externalCtx);
    _piano.start({ note: midi, velocity: gainToVelocity(peakGain), time, duration: durationS });
  } else {
    scheduleSynthNote(externalCtx, freq, startAt, durationS, peakGain);
  }
}

/**
 * Plays a piano note immediately using the shared context.
 * Returns milliseconds until the note finishes (for setTimeout chaining).
 *
 * @param {number} midi       MIDI note number
 * @param {number} durationS  Duration in seconds (default 1.2)
 * @param {number} peakGain   Peak amplitude (default 0.18)
 * @returns {number} Delay in ms
 */
export function playPianoNoteNow(midi, durationS = 1.2, peakGain = 0.18) {
  const ctx = getOrCreateContext();
  if (_piano) {
    const time = ctx.currentTime + NOTE_START_OFFSET_S;
    _piano.start({ note: midi, velocity: gainToVelocity(peakGain), time, duration: durationS });
  } else {
    const freq = midiToFrequencyHz(midi);
    scheduleSynthNote(ctx, freq, ctx.currentTime + NOTE_START_OFFSET_S, durationS, peakGain);
  }
  return durationS * 1000 + 200;
}

/**
 * Starts a sustained held note (attack → decay → sustain until released).
 * Returns an object with a `stop()` method; pass it to `stopHeldTone()`.
 *
 * @param {number} freq      Frequency in Hz
 * @param {number} peakGain  Peak amplitude
 * @returns {{ stop: Function }}
 */
export function startHeldPianoTone(freq, peakGain) {
  const ctx = getOrCreateContext();
  if (_piano) {
    const midi = freqToMidi(freq);
    const stopNote = _piano.start({ note: midi, velocity: gainToVelocity(peakGain) });
    return { stop: stopNote };
  }
  return startSynthHeld(ctx, freq, peakGain);
}

/**
 * Releases a held tone returned by `startHeldPianoTone()`.
 * @param {{ stop: Function } | null} held
 */
export function stopHeldTone(held) {
  if (!held) return;
  try { held.stop(); } catch { /* ignore */ }
}

/** Plays a short "bing" success sound. */
export function playBing() {
  const ctx = getOrCreateContext();
  const now = ctx.currentTime + NOTE_START_OFFSET_S;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(NEAR_ZERO, now);
  masterGain.gain.linearRampToValueAtTime(0.22, now + 0.015);
  masterGain.gain.exponentialRampToValueAtTime(NEAR_ZERO, now + BING_DURATION_S);
  masterGain.connect(ctx.destination);
  [1, 2].forEach((mult) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(BING_FREQ_HZ * mult, now);
    osc.frequency.exponentialRampToValueAtTime(BING_FREQ_HZ * mult * 1.004, now + 0.04);
    const hg = ctx.createGain();
    hg.gain.value = mult === 1 ? 0.7 : 0.3;
    osc.connect(hg);
    hg.connect(masterGain);
    osc.start(now);
    osc.stop(now + BING_DURATION_S + 0.05);
  });
}

/** Plays a short "buzz" failure sound. */
export function playBuzz() {
  const ctx = getOrCreateContext();
  const now = ctx.currentTime + NOTE_START_OFFSET_S;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.18, now);
  masterGain.gain.exponentialRampToValueAtTime(NEAR_ZERO, now + BUZZ_DURATION_S);
  masterGain.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = BUZZ_FREQ_HZ;
  osc.connect(masterGain);
  osc.start(now);
  osc.stop(now + BUZZ_DURATION_S + 0.05);
}