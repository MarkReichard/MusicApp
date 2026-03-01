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
import { CONCERT_A_HZ, CONCERT_A_MIDI, SEMITONES_PER_OCTAVE, midiToFrequencyHz, CADENCE_CHORD_OFFSETS, TRIAD_INTERVALS } from './musicTheory';

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
let _loadedInstrument = null;

// ── Constants ──────────────────────────────────────────────────────────────────
const NEAR_ZERO           = 0.0001;
const NOTE_START_OFFSET_S = 0.01;   // tiny lookahead to avoid AudioContext click

// Feedback tones (always synthesised — no need for samples)
const BING_FREQ_HZ    = 1047;       // C6
const BING_DURATION_S = 0.9;
const BUZZ_FREQ_HZ    = 160;
const BUZZ_DURATION_S = 0.45;

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

// ── Piano loading ──────────────────────────────────────────────────────────────

/**
 * Begins loading the Salamander Grand Piano samples.
 * Safe to call multiple times — subsequent calls return the same Promise.
 * Call once in App on mount so samples are ready before the user plays anything.
 *
 * @returns {Promise<SplendidGrandPiano>}
 */
export function loadPiano() {
  if (_loadPromise) return _loadPromise;
  const ctx = getOrCreateContext();
  const piano = new SplendidGrandPiano(ctx);
  _loadPromise = piano.load
    .then(() => {
      _piano = piano;
      _loadedInstrument = 'acoustic_grand_piano';
      return piano;
    });
  return _loadPromise;
}

/**
 * Switches the playback instrument to any Soundfont instrument name.
 *
 * @param {string} instrumentName  e.g. 'flute', 'violin', 'acoustic_grand_piano'
 * @returns {Promise<void>}
 */
export async function loadInstrument(instrumentName) {
  if (_loadedInstrument === instrumentName && _piano) {
    return; // already loaded, nothing to do
  }
  _piano = null; // use fallback while loading
  _loadPromise = null;
  _loadedInstrument = null;
  const ctx = getOrCreateContext();
  const sf = new Soundfont(ctx, { instrument: instrumentName });
  await sf.load;
  _piano = sf;
  _loadedInstrument = instrumentName;
  _loadPromise = Promise.resolve(sf);
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

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Schedules a piano note at a future time expressed relative to `externalCtx`.
 *
 * @param {AudioContext} externalCtx  Caller's reference context (used only for time translation)
 * @param {number}       freq         Frequency in Hz
 * @param {number}       startAt      Absolute time in `externalCtx` to start
 * @param {number}       durationS    Duration in seconds
 * @param {number}       peakGain     Peak amplitude (0–1)
 */
export function schedulePianoNote(externalCtx, freq, startAt, durationS, peakGain) {
  const midi = freqToMidi(freq);
  const time = translateTime(startAt, externalCtx);
  return _piano.start({ note: midi, velocity: gainToVelocity(peakGain), time, duration: durationS });
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
  const time = ctx.currentTime + NOTE_START_OFFSET_S;
  _piano.start({ note: midi, velocity: gainToVelocity(peakGain), time, duration: durationS });
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
  const midi = freqToMidi(freq);
  const stopNote = _piano.start({ note: midi, velocity: gainToVelocity(peakGain) });
  return { stop: stopNote };
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

/**
 * Schedules a tonic cadence (I–IV–V–IV) using the provided AudioContext.
 * Returns the time after the cadence ends.
 */
export function scheduleCadence(externalCtx, startAt, beatSeconds, tonicMidi, chordGain) {
  let at = startAt;
  CADENCE_CHORD_OFFSETS.forEach((offset) => {
    const chordRoot = tonicMidi + offset;
    TRIAD_INTERVALS.forEach((triadOffset) => {
      const frequency = midiToFrequencyHz(chordRoot + triadOffset);
      schedulePianoNote(externalCtx, frequency, at, beatSeconds, chordGain);
    });
    at += beatSeconds;
  });
  return at;
}