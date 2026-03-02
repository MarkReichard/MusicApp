/**
 * useChordPlayer — boom-chuck chord accompaniment hook.
 *
 * Schedules Web Audio piano notes in a lookahead window (drum-machine style)
 * so timing stays tight even when the main thread is busy. Supports looping
 * and transposition.
 *
 * API:
 *   const { start, stop, isPlaying } = useChordPlayer();
 *
   *   start(measures, tempoBpm, transposeSemitones?, loop?, startDelaySeconds?)
   *     — measures: array of { beats, chords: [{ beat, root, kind }] }
   *     — tempoBpm: number (e.g. 90)
   *     — transposeSemitones: integer (default 0)
   *     — loop: boolean (default true)
   *     — startDelaySeconds: seconds from now to play beat 1 (default 0.05)
 *
 *   stop() — stops immediately (no more notes scheduled)
 *   isPlaying — reactive boolean state
 */

import { useRef, useCallback, useState } from 'react';
import { getPianoAudioContext, schedulePianoNote } from './pianoSynth';
import { midiToFrequencyHz, KEY_TO_SEMITONE, beatSecondsFromTempo } from './musicTheory';

// ── Constants ──────────────────────────────────────────────────────────────────
const LOOKAHEAD_MS = 100;    // scheduler fires every N ms
const SCHEDULE_WINDOW_S = 0.2; // schedule this many seconds ahead per tick
const BOOM_OCTAVE_BASE = 36;   // MIDI C2 — bass register for beat-1 chord
const CHUCK_OCTAVE_BASE = 48;  // MIDI C3 — mid register for chop (unused but kept for reference)
const BOOM_GAIN = 0.048;
const CHUCK_GAIN = 0.03;
const NOTE_DURATION_RATIO = 0.82; // fraction of a beat the note sounds
const CHOP_DURATION_S = 0.055;    // very short — gives off-beats a percussive "chop" feel

// ── Chord interval tables ──────────────────────────────────────────────────────
const CHORD_INTERVALS = {
  major:            [0, 4, 7],
  minor:            [0, 3, 7],
  dominant:         [0, 4, 7],
  'dominant-seventh': [0, 4, 7],
  diminished:       [0, 3, 6],
  augmented:        [0, 4, 8],
  'suspended-fourth': [0, 5, 7],
  'suspended-second': [0, 2, 7],
  'major-seventh':  [0, 4, 7],
  'minor-seventh':  [0, 3, 7],
};

function chordIntervals(kind) {
  return CHORD_INTERVALS[kind] ?? CHORD_INTERVALS.major;
}

// ── Beat event builder ─────────────────────────────────────────────────────────

/**
 * Converts an array of measures into a flat list of beat events for playback.
 *
 * @param {Array}  measures          Measure objects from lesson.measures
 * @param {number} transposeSemitones Semitone shift (positive = up, negative = down)
 * @returns {Array<{ beatIndex: number, midiNotes: number[], gain: number }>}
 */
function buildBeatEvents(measures, transposeSemitones = 0) {
  if (!measures?.length) return [];

  const events = [];
  let absoluteBeat = 0;

  for (const measure of measures) {
    const { beats = 4, chords = [] } = measure;

    // Build a beat→chord map for this measure (1-indexed within measure)
    const beatChordMap = {};
    for (const chord of chords) {
      beatChordMap[chord.beat] = chord;
    }

    // Start with the first defined chord (defaults to measure beat 1 or the first entry)
    let currentChord = beatChordMap[1] ?? chords[0] ?? null;

    for (let b = 1; b <= beats; b++) {
      if (beatChordMap[b]) currentChord = beatChordMap[b];

      if (currentChord) {
        const rootSemitone = KEY_TO_SEMITONE[currentChord.root] ?? 0;
        const shifted = rootSemitone + transposeSemitones;

        if (b % 2 === 1) {
          // Odd beats (1, 3, …) — full triad in bass register, sustained
          const rootMidi = BOOM_OCTAVE_BASE + ((shifted % 12) + 12) % 12;
          const intervals = chordIntervals(currentChord.kind);
          events.push({ beatIndex: absoluteBeat, midiNotes: intervals.map((i) => rootMidi + i), gain: BOOM_GAIN });
        } else {
          // Even beats (2, 4, …) — short chop: full triad in mid register
          const rootMidi = CHUCK_OCTAVE_BASE + ((shifted % 12) + 12) % 12;
          const intervals = chordIntervals(currentChord.kind);
          events.push({ beatIndex: absoluteBeat, midiNotes: intervals.map((i) => rootMidi + i), gain: CHUCK_GAIN, durationS: CHOP_DURATION_S });
        }
      }

      absoluteBeat++;
    }
  }

  return events;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useChordPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);

  // All mutable playback state lives in a ref so scheduler callbacks don't
  // capture stale closures.
  const s = useRef({
    active: false,
    beatEvents: [],
    beatDurationS: 0.5,
    startContextTime: 0,
    nextBeatIndex: 0,   // next beat event index to schedule
    totalBeats: 0,
    loop: true,
    loopOffset: 0,      // cumulative beat offset for looping
    timerId: null,
  });

  const scheduleChunk = useCallback(() => {
    const st = s.current;
    if (!st.active || !st.beatEvents.length) return;

    const ctx = getPianoAudioContext();
    const now = ctx.currentTime;
    const scheduleUntil = now + SCHEDULE_WINDOW_S;
    const noteDuration = st.beatDurationS * NOTE_DURATION_RATIO;

    while (st.nextBeatIndex < st.beatEvents.length) {
      const ev = st.beatEvents[st.nextBeatIndex];
      const eventTime =
        st.startContextTime +
        st.loopOffset * st.beatDurationS +
        ev.beatIndex * st.beatDurationS;

      if (eventTime > scheduleUntil) break;

      const evDuration = ev.durationS ?? noteDuration;
      for (const midi of ev.midiNotes) {
        schedulePianoNote(ctx, midiToFrequencyHz(midi), eventTime, evDuration, ev.gain);
      }
      st.nextBeatIndex++;
    }

    // Reached the end of events
    if (st.nextBeatIndex >= st.beatEvents.length) {
      if (st.loop) {
        st.loopOffset += st.totalBeats;
        st.nextBeatIndex = 0;
        // Recurse within this tick to schedule the start of the next loop
        scheduleChunk();
      } else {
        // Wait until actual audio finishes, then mark stopped
        const lastEventTime =
          st.startContextTime +
          st.loopOffset * st.beatDurationS +
          (st.beatEvents[st.beatEvents.length - 1]?.beatIndex ?? 0) * st.beatDurationS +
          noteDuration;
        const waitMs = Math.max(0, (lastEventTime - ctx.currentTime) * 1000 + 100);
        clearInterval(st.timerId);
        st.timerId = null;
        setTimeout(() => {
          st.active = false;
          setIsPlaying(false);
        }, waitMs);
      }
    }
  }, []);

  const stop = useCallback(() => {
    const st = s.current;
    if (st.timerId !== null) {
      clearInterval(st.timerId);
      st.timerId = null;
    }
    st.active = false;
    setIsPlaying(false);
  }, []);

  /**
   * Start chord playback.
   *
   * @param {object[]} measures          Lesson measure objects
   * @param {number}   tempoBpm          Tempo, beats per minute
   * @param {number}   [transposeSemitones=0]  Semitone shift
   * @param {boolean}  [loop=true]       Whether to loop
   */
  const start = useCallback(
    (measures, tempoBpm, transposeSemitones = 0, loop = true, startDelaySeconds = 0.05) => {
      stop();
      if (!measures?.length) return;

      const beatEvents = buildBeatEvents(measures, transposeSemitones);
      if (!beatEvents.length) return; // no chords in this window

      const ctx = getPianoAudioContext();
      const beatDuration = beatSecondsFromTempo(tempoBpm);
      const totalBeats = measures.reduce((acc, m) => acc + (m.beats ?? 4), 0);

      const st = s.current;
      st.active = true;
      st.beatEvents = beatEvents;
      st.beatDurationS = beatDuration;
      st.startContextTime = ctx.currentTime + startDelaySeconds;
      st.nextBeatIndex = 0;
      st.totalBeats = totalBeats;
      st.loop = loop;
      st.loopOffset = 0;

      setIsPlaying(true);
      scheduleChunk();
      st.timerId = setInterval(scheduleChunk, LOOKAHEAD_MS);
    },
    [stop, scheduleChunk],
  );

  /**
   * Returns the current fractional beat position within the loop cycle,
   * normalised to [0, totalBeats). Returns -1 when not playing.
   * Reading ctx.currentTime here is fine — it's just a getter.
   */
  const getCurrentBeatFloat = useCallback(() => {
    const st = s.current;
    if (!st.active || !st.beatDurationS) return -1;
    const ctx = getPianoAudioContext();
    const elapsed = ctx.currentTime - st.startContextTime;
    if (elapsed < 0) return 0; // before first beat; show measure 0
    const totalBeats = st.totalBeats || 1;
    return (elapsed / st.beatDurationS) % totalBeats;
  }, []);

  return { start, stop, isPlaying, getCurrentBeatFloat };
}
