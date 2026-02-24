/**
 * Piano-like additive synthesis using the Web Audio API.
 *
 * A note is built from 5 sine-wave partials at the fundamental and its first
 * four harmonics, each at decreasing amplitudes. This gives the characteristic
 * "struck string" timbre instead of a plain oscillator wave.
 *
 * All scheduling functions take an AudioContext as their first argument.
 */

import { midiToFrequencyHz } from './musicTheory';

// ── Harmonic spectrum ──────────────────────────────────────────────────────────
const HARMONICS = [
  { multiplier: 1, weight: 1    },
  { multiplier: 2, weight: 0.5  },
  { multiplier: 3, weight: 0.25 },
  { multiplier: 4, weight: 0.1  },
  { multiplier: 5, weight: 0.05 },
];
const HARMONIC_TOTAL = HARMONICS.reduce((sum, h) => sum + h.weight, 0);

// ── Timing ────────────────────────────────────────────────────────────────────
const PIANO_ATTACK_S        = 0.006;  // ~6 ms — snappy key-strike attack
const HELD_DECAY_S          = 0.28;   // fast drop into sustain level
const HELD_SUSTAIN_RATIO    = 0.22;   // sustain at 22 % of peak after decay
const RELEASE_TIME_CONSTANT = 0.02;   // setTargetAtTime τ for key release
const RELEASE_S             = 0.09;   // oscillator stop delay after release
const NOTE_START_OFFSET_S   = 0.01;   // tiny lookahead to avoid AudioContext click

// ── Internal constants ────────────────────────────────────────────────────────
const NEAR_ZERO = 0.0001;

// ── Feedback tone parameters ──────────────────────────────────────────────────
const BING_FREQ_HZ    = 1047;   // C6
const BING_DURATION_S = 0.9;
const BUZZ_FREQ_HZ    = 160;
const BUZZ_DURATION_S = 0.45;

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Creates one sine oscillator per harmonic, all routed into `masterGain`.
 * Returns the array of oscillators so the caller can schedule `.stop()`.
 */
function createPartials(ctx, freq, masterGain, startAt) {
  return HARMONICS.map(({ multiplier, weight }) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * multiplier;

    const harmGain = ctx.createGain();
    harmGain.gain.value = weight / HARMONIC_TOTAL;

    osc.connect(harmGain);
    harmGain.connect(masterGain);
    osc.start(startAt);
    return osc;
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Schedules a piano note at absolute AudioContext time `startAt`.
 * The envelope is: fast attack → exponential decay over `durationS`.
 *
 * @param {AudioContext} ctx
 * @param {number} freq        Frequency in Hz
 * @param {number} startAt     Absolute AudioContext time to start
 * @param {number} durationS   Total note duration in seconds
 * @param {number} peakGain    Peak amplitude (0–1 range)
 */
export function schedulePianoNote(ctx, freq, startAt, durationS, peakGain) {
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(NEAR_ZERO, startAt);
  masterGain.gain.linearRampToValueAtTime(peakGain, startAt + PIANO_ATTACK_S);
  masterGain.gain.exponentialRampToValueAtTime(NEAR_ZERO, startAt + durationS);
  masterGain.connect(ctx.destination);

  const stopAt = startAt + durationS + 0.05;
  const partials = createPartials(ctx, freq, masterGain, startAt);
  partials.forEach((osc) => osc.stop(stopAt));
}

/**
 * Plays a piano note immediately (offset by a tiny lookahead).
 * Returns the number of milliseconds until the note finishes (for setTimeout chaining).
 *
 * @param {AudioContext} ctx
 * @param {number} midi        MIDI note number
 * @param {number} [durationS=1.2]  Duration in seconds
 * @param {number} [peakGain=0.18]  Peak amplitude
 * @returns {number} Delay in ms until tone ends
 */
export function playPianoNoteNow(ctx, midi, durationS = 1.2, peakGain = 0.18) {
  const freq    = midiToFrequencyHz(midi);
  const startAt = ctx.currentTime + NOTE_START_OFFSET_S;
  schedulePianoNote(ctx, freq, startAt, durationS, peakGain);
  return durationS * 1000 + 200;
}

/**
 * Starts a sustained "held" piano note (attack → quick decay → sustain).
 * Returns a HeldTone object to pass to `stopHeldTone()` when the key is released.
 *
 * @param {AudioContext} ctx
 * @param {number} freq    Frequency in Hz
 * @param {number} peakGain Peak amplitude
 * @returns {{ oscillators: OscillatorNode[], masterGain: GainNode, context: AudioContext }}
 */
export function startHeldPianoTone(ctx, freq, peakGain) {
  const now = ctx.currentTime;

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(NEAR_ZERO, now);
  masterGain.gain.linearRampToValueAtTime(peakGain, now + PIANO_ATTACK_S);
  masterGain.gain.exponentialRampToValueAtTime(peakGain * HELD_SUSTAIN_RATIO, now + HELD_DECAY_S);
  masterGain.connect(ctx.destination);

  const oscillators = createPartials(ctx, freq, masterGain, now);
  return { oscillators, masterGain, context: ctx };
}

/**
 * Releases a HeldTone object returned by `startHeldPianoTone()`.
 * Applies a short release envelope and stops all oscillators.
 *
 * @param {{ oscillators: OscillatorNode[], masterGain: GainNode, context: AudioContext }} held
 */
export function stopHeldTone(held) {
  if (!held) return;
  const { oscillators, masterGain, context } = held;
  const stopAt = context.currentTime;
  try {
    masterGain.gain.cancelScheduledValues(stopAt);
    masterGain.gain.setTargetAtTime(NEAR_ZERO, stopAt, RELEASE_TIME_CONSTANT);
  } catch {
    // ignore if already disconnected
  }
  oscillators.forEach((osc) => {
    try { osc.stop(stopAt + RELEASE_S); } catch { /* ignore */ }
  });
}

/**
 * Plays a short "bing" success sound (rising triangle + harmonic partials).
 * @param {AudioContext} ctx
 */
export function playBing(ctx) {
  const now  = ctx.currentTime + NOTE_START_OFFSET_S;
  const freq = BING_FREQ_HZ;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(NEAR_ZERO, now);
  masterGain.gain.linearRampToValueAtTime(0.22, now + 0.015);
  masterGain.gain.exponentialRampToValueAtTime(NEAR_ZERO, now + BING_DURATION_S);
  masterGain.connect(ctx.destination);

  // Use two partials at fundamental and 2× for a bell-like tone
  [1, 2].forEach((mult) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * mult, now);
    // slight pitch rise on attack for a struck-bell feel
    osc.frequency.exponentialRampToValueAtTime(freq * mult * 1.004, now + 0.04);

    const harmGain = ctx.createGain();
    harmGain.gain.value = mult === 1 ? 0.7 : 0.3;

    osc.connect(harmGain);
    harmGain.connect(masterGain);
    osc.start(now);
    osc.stop(now + BING_DURATION_S + 0.05);
  });
}

/**
 * Plays a short "buzz" failure sound.
 * @param {AudioContext} ctx
 */
export function playBuzz(ctx) {
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
