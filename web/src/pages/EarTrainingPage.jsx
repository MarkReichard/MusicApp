/**
 * EarTrainingPage — functional ear training with spaced repetition.
 *
 * Each round:
 *  1. App plays I–IV–V–IV cadence, then the target pitch once as a guide.
 *  2. User sings the target note ("DAAAH"), then the stepwise route back to Do.
 *     – Fa or lower → descend stepwise to Do.
 *     – Sol or higher → ascend stepwise to Do′.
 *  3. Only the first sung note is scored.
 *  4. App plays back the full daaah–da–da–da sequence as reinforcement.
 *     If "hide note name" is on, the name and graph are revealed here.
 *  5. After reinforcement, user clicks Next or Replay. Auto-stops after noteLimit rounds.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadPitchSettings } from '../lib/pitchSettings';
import { loadPitchRangeSettings } from '../lib/pitchRangeSettings';
import { useStablePitchTracker } from '../lib/useStablePitchTracker';
import { SingInputGraphV2 } from '../components/trainer/SingInputGraphV2';
import {
  CADENCE_CHORD_OFFSETS,
  TRIAD_INTERVALS,
  tonicMidiFromKeyOctave,
  midiToFrequencyHz,
  beatSecondsFromTempo,
  AUDIO_START_OFFSET_SECONDS,
  NOTE_GAP_SECONDS,
  NOTE_DURATION_SCALE,
  MIN_NOTE_DURATION_SECONDS,
  CADENCE_CHORD_GAIN,
  TARGET_NOTE_GAIN,
  PLAYBACK_BUFFER_MS,
} from '../lib/musicTheory';
import { schedulePianoNote, getPianoAudioContext } from '../lib/pianoSynth';
import { isBarMatched } from '../lib/lessonUtils';
import {
  EAR_DEGREES,
  loadEarTrainingHistory,
  saveEarTrainingHistory,
  recordAttempt,
  pickWeightedDegree,
} from '../lib/earTrainingSettings';

// ── Constants ──────────────────────────────────────────────────────────────────

const KEY_OPTIONS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NOTE_LIMIT_OPTIONS = [5, 10, 15, 20, 30];
const DEFAULT_NOTE_LIMIT = 10;

/** Major scale semitone steps, including upper tonic. */
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11, 12];

/** Semitone offset → solfège label. */
const SEMITONE_TO_SOLFEGE = {
  0: 'Do', 2: 'Re', 4: 'Mi', 5: 'Fa', 7: 'Sol', 9: 'La', 11: 'Ti', 12: "Do'",
};

/** First (scored) note is "DAAAH" — 2 beats. */
const DAAAH_BEATS = 1;
/** Stepwise (display-only) notes are "da" — 1 beat each. */
const DA_BEATS = 1;

const REINFORCEMENT_GAIN = TARGET_NOTE_GAIN * 0.85;
const TOLERANCE_CENTS = 50;

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Returns the sequence of MIDI notes for the given tonic and target semitone:
 *   - target note first
 *   - then stepwise back to Do (descend) or up to Do′ (ascend)
 */
function buildNoteSequence(tonicMidi, semitones) {
  const idx = MAJOR_SCALE.indexOf(semitones);
  const semSeq = semitones <= 5
    ? MAJOR_SCALE.slice(0, idx + 1).reverse() // descend: [semitones, ..., 0]
    : MAJOR_SCALE.slice(idx);                  // ascend:  [semitones, ..., 12]
  return semSeq.map((s) => tonicMidi + s);
}

/**
 * Builds timeline arrays (playedBars, expectedBars) and timing anchors.
 * All times are in seconds, relative to startMs.
 * Cursor starts at AUDIO_START_OFFSET_SECONDS so the first events align with
 * the audio context schedule (same convention as buildSingTimeline).
 */
function buildTimeline({ tonicMidi, midiSeq, beatSeconds }) {
  const daahDur = Math.max(MIN_NOTE_DURATION_SECONDS, beatSeconds * DAAAH_BEATS * NOTE_DURATION_SCALE);
  const daDur   = Math.max(MIN_NOTE_DURATION_SECONDS, beatSeconds * DA_BEATS   * NOTE_DURATION_SCALE);

  let cursor = AUDIO_START_OFFSET_SECONDS;
  const playedBars  = [];
  const expectedBars = [];

  // I–IV–V–IV cadence
  CADENCE_CHORD_OFFSETS.forEach((offset, ci) => {
    const chordRoot = tonicMidi + offset;
    TRIAD_INTERVALS.forEach((ti, tii) => {
      playedBars.push({ id: `cad-${ci}-${tii}`, startSec: cursor, endSec: cursor + beatSeconds, midi: chordRoot + ti });
    });
    cursor += beatSeconds;
  });
  cursor += NOTE_GAP_SECONDS * 2;

  // Guide: app plays target note (2 beats)
  const guideDur = beatSeconds * 2;
  playedBars.push({ id: 'guide', startSec: cursor, endSec: cursor + guideDur, midi: midiSeq[0] });
  cursor += guideDur + NOTE_GAP_SECONDS;

  // 1-beat countdown silence before user sings
  cursor += beatSeconds;
  const singStartSec = cursor;

  // Expected singing bars
  midiSeq.forEach((midi, i) => {
    const dur     = i === 0 ? daahDur : daDur;
    const semOff  = midi - tonicMidi;
    const lyric   = SEMITONE_TO_SOLFEGE[semOff] ?? '';
    expectedBars.push({
      id: `note-${i}`,
      index: i,
      startSec: cursor,
      endSec: cursor + dur,
      scoreEndSec: cursor + dur,
      midi,
      lyric,
    });
    cursor += dur + NOTE_GAP_SECONDS;
  });

  const stopScrollSec     = cursor + beatSeconds * 0.5;
  const reinforceStartSec = stopScrollSec + beatSeconds * 0.25;

  return { playedBars, expectedBars, singStartSec, stopScrollSec, reinforceStartSec, daahDur, daDur };
}

function getScoreColor(rate) {
  if (rate === null) return '#64748b';
  if (rate >= 0.7) return '#22c55e';
  if (rate >= 0.4) return '#facc15';
  return '#ef4444';
}

function getBarchartColor(rate) {
  if (rate === null) return '#334155';
  if (rate >= 0.7) return '#166534';
  if (rate >= 0.4) return '#854d0e';
  return '#7f1d1d';
}

// ── Component ──────────────────────────────────────────────────────────────────

export function EarTrainingPage() {
  const pitchSettings = useMemo(() => loadPitchSettings(), []);
  const pitchRange    = useMemo(() => loadPitchRangeSettings(), []);

  const defaultOctave = useMemo(() => {
    if (Number.isFinite(pitchRange.minMidi) && Number.isFinite(pitchRange.maxMidi)) {
      const midMidi = (pitchRange.minMidi + pitchRange.maxMidi) / 2;
      return Math.max(3, Math.min(5, Math.floor(midMidi / 12) - 1));
    }
    return 4;
  }, [pitchRange]);

  // ── Options ───────────────────────────────────────────────────────────────
  const [selectedKey,  setSelectedKey]  = useState('C');
  const [singOctave,   setSingOctave]   = useState(defaultOctave);
  const [tempoBpm,     setTempoBpm]     = useState(72);
  const [noteLimit,    setNoteLimit]    = useState(DEFAULT_NOTE_LIMIT);
  const [hideNoteName, setHideNoteName] = useState(false);

  // ── Session state ──────────────────────────────────────────────────────────
  // roundPhase: 'idle' | 'playing' | 'done' | 'finished'
  const [roundPhase,         setRoundPhase]         = useState('idle');
  const [notesPlayed,        setNotesPlayed]        = useState(0);
  const [currentDegreeIndex, setCurrentDegreeIndex] = useState(null);
  const [session,            setSession]            = useState(null);
  const [barResults,         setBarResults]         = useState({});
  const [lastResult,         setLastResult]         = useState(null);
  const [revealed,           setRevealed]           = useState(true);
  const [earHistory,         setEarHistory]         = useState(() => loadEarTrainingHistory());

  const playbackRef      = useRef({ runId: 0, timeoutId: null, resolve: null });
  const historyRef       = useRef([]);
  const evaluatedBarsRef = useRef(new Set());
  const barResultsRef    = useRef({});
  // Stable ref so async playRound always reads latest earHistory
  const earHistoryRef    = useRef(earHistory);
  useEffect(() => { earHistoryRef.current = earHistory; }, [earHistory]);

  const {
    current: detectedPitch,
    history: pitchHistory,
    clearTrackingData,
  } = useStablePitchTracker({ enabled: true, maxHistoryPoints: 12000, pitchSettings });

  useEffect(() => { historyRef.current = pitchHistory; }, [pitchHistory]);
  useEffect(() => () => { cancelPlayback(); }, []);

  // ── Progressive bar scoring (runs every 60 ms while a session is active) ───
  useEffect(() => {
    if (!session?.expectedBars?.length) {
      return undefined;
    }

    const timerId = globalThis.setInterval(() => {
      const elapsedSec = (performance.now() - session.startMs) / 1000;
      if (!Number.isFinite(elapsedSec) || elapsedSec < 0) {
        return;
      }

      for (const bar of session.expectedBars) {
        if (elapsedSec < bar.scoreEndSec || evaluatedBarsRef.current.has(bar.id)) {
          continue;
        }

        evaluatedBarsRef.current.add(bar.id);
        const matched = isBarMatched({
          bar,
          history:        historyRef.current,
          sessionStartMs: session.startMs,
          toleranceCents: TOLERANCE_CENTS,
        });

        barResultsRef.current = { ...barResultsRef.current, [bar.id]: matched };
        setBarResults((prev) => (prev[bar.id] === matched ? prev : { ...prev, [bar.id]: matched }));

        // First bar result drives the visible indicator (set after reveal)
        if (bar.index === 0) {
          const nextResult = matched ? 'correct' : 'wrong';
          setLastResult((prev) => (prev === null ? null : nextResult));
        }
      }
    }, 60);

    return () => { globalThis.clearInterval(timerId); };
  }, [session]);

  // ── Playback control ─────────────────────────────────────────────────────────

  function cancelPlayback() {
    playbackRef.current.runId += 1;
    if (playbackRef.current.timeoutId) {
      clearTimeout(playbackRef.current.timeoutId);
      playbackRef.current.timeoutId = null;
    }
    if (playbackRef.current.resolve) {
      playbackRef.current.resolve();
      playbackRef.current.resolve = null;
    }
  }

  function waitMs(ms) {
    const { runId } = playbackRef.current;
    return new Promise((resolve) => {
      if (playbackRef.current.runId !== runId) { resolve(); return; }
      playbackRef.current.resolve = resolve;
      playbackRef.current.timeoutId = setTimeout(() => {
        playbackRef.current.timeoutId = null;
        playbackRef.current.resolve = null;
        resolve();
      }, Math.max(0, ms));
    });
  }

  /**
   * Polls pitch history for the first voiced entry whose timeMs >= afterTimeMs.
   * Returns that timeMs, or null if playback was cancelled first.
   */
  function waitForSingOnset(afterTimeMs, runId) {
    return new Promise((resolve) => {
      const check = () => {
        if (playbackRef.current.runId !== runId) { resolve(null); return; }
        const h = historyRef.current;
        for (let i = h.length - 1; i >= 0; i--) {
          if (h[i].timeMs < afterTimeMs) break;
          if (h[i].voiced && h[i].midi !== null) {
            resolve(h[i].timeMs);
            return;
          }
        }
        setTimeout(check, 40);
      };
      setTimeout(check, 40);
    });
  }

  // ── Single round ─────────────────────────────────────────────────────────────

  async function playRound(degreeIndex) {
    playbackRef.current.runId += 1;
    const runId = playbackRef.current.runId;

    // Capture state that must survive across awaits
    const snapHideNoteName = hideNoteName;

    const degree      = EAR_DEGREES[degreeIndex];
    const beatSeconds = beatSecondsFromTempo(tempoBpm);
    const tonicMidi   = tonicMidiFromKeyOctave(selectedKey, singOctave);
    const midiSeq     = buildNoteSequence(tonicMidi, degree.semitones);

    const { playedBars, expectedBars, singStartSec, stopScrollSec, reinforceStartSec, daahDur, daDur } =
      buildTimeline({ tonicMidi, midiSeq, beatSeconds });

    clearTrackingData();
    setCurrentDegreeIndex(degreeIndex);
    setBarResults({});
    barResultsRef.current = {};
    evaluatedBarsRef.current = new Set();
    setLastResult(null);
    setRevealed(!snapHideNoteName); // reveal immediately if not hiding
    setRoundPhase('playing');

    const ctx = getPianoAudioContext();
    await ctx.resume().catch(() => undefined);
    if (playbackRef.current.runId !== runId) return;

    const ctxNow  = ctx.currentTime;
    const perfNow = performance.now();
    const startMs = perfNow + AUDIO_START_OFFSET_SECONDS * 1000;

    // ── Schedule audio ──────────────────────────────────────────────────────

    let ac = ctxNow + AUDIO_START_OFFSET_SECONDS;

    CADENCE_CHORD_OFFSETS.forEach((offset) => {
      const chordRoot = tonicMidi + offset;
      TRIAD_INTERVALS.forEach((ti) => {
        schedulePianoNote(ctx, midiToFrequencyHz(chordRoot + ti), ac, beatSeconds, CADENCE_CHORD_GAIN);
      });
      ac += beatSeconds;
    });
    ac += NOTE_GAP_SECONDS * 2;

    schedulePianoNote(ctx, midiToFrequencyHz(midiSeq[0]), ac, beatSeconds * 2, TARGET_NOTE_GAIN);
    ac += beatSeconds * 2 + NOTE_GAP_SECONDS;
    ac += beatSeconds; // countdown silence — ac is now at audio ctx equivalent of singStartSec

    // ── Determine expectedBars and schedule reinforcement ───────────────────

    let liveExpectedBars;
    let liveTotalAudioEndMs;

    if (snapHideNoteName) {
      // Sing-triggered: wait for user to start singing, then anchor bars + schedule reinforcement
      // Show cadence bars in graph but no expected bars yet
      setSession({ startMs, singStartSec: 9999, stopScrollSec: 9999, playedBars, expectedBars: [] });

      // Wait for first voiced pitch after the cadence + guide note finish
      const cadenceEndMs = startMs + singStartSec * 1000;
      const singOnsetMs = await waitForSingOnset(cadenceEndMs, runId);
      if (!singOnsetMs || playbackRef.current.runId !== runId) return;

      // Anchor expected bars to the moment singing was detected
      const singOffsetSec = (singOnsetMs - startMs) / 1000;
      let c = singOffsetSec;
      liveExpectedBars = midiSeq.map((midi, i) => {
        const dur    = i === 0 ? daahDur : daDur;
        const semOff = midi - tonicMidi;
        const lyric  = SEMITONE_TO_SOLFEGE[semOff] ?? '';
        const bar    = { id: `note-${i}`, index: i, startSec: c, endSec: c + dur, scoreEndSec: c + dur, midi, lyric };
        c += dur + NOTE_GAP_SECONDS;
        return bar;
      });

      const liveStopScrollSec   = c + beatSeconds * 0.5;
      const liveReinforceOffset = liveStopScrollSec + beatSeconds * 0.25;

      // Schedule reinforcement at the now-known timing
      let rc = ctxNow + AUDIO_START_OFFSET_SECONDS + liveReinforceOffset;
      midiSeq.forEach((midi, i) => {
        const dur = i === 0 ? daahDur : daDur;
        schedulePianoNote(ctx, midiToFrequencyHz(midi), rc, dur, REINFORCEMENT_GAIN);
        rc += dur + NOTE_GAP_SECONDS;
      });
      liveTotalAudioEndMs = (rc - ctxNow) * 1000 + PLAYBACK_BUFFER_MS;

      setSession({ startMs, singStartSec: singOffsetSec, stopScrollSec: liveStopScrollSec, playedBars, expectedBars: liveExpectedBars });
    } else {
      // Fixed timeline: reinforcement already determined by buildTimeline
      liveExpectedBars = expectedBars;

      let rc = ctxNow + reinforceStartSec;
      midiSeq.forEach((midi, i) => {
        const dur = i === 0 ? daahDur : daDur;
        schedulePianoNote(ctx, midiToFrequencyHz(midi), rc, dur, REINFORCEMENT_GAIN);
        rc += dur + NOTE_GAP_SECONDS;
      });
      liveTotalAudioEndMs = (rc - ctxNow) * 1000 + PLAYBACK_BUFFER_MS;

      setSession({ startMs, singStartSec, stopScrollSec, playedBars, expectedBars });
    }

    // ── Wait for singing bars to elapse ─────────────────────────────────────

    const lastLiveBar    = liveExpectedBars.at(-1);
    const scoreDeadline  = startMs + lastLiveBar.scoreEndSec * 1000 + 200;
    await waitMs(scoreDeadline - performance.now());
    if (playbackRef.current.runId !== runId) return;

    const matched = barResultsRef.current[liveExpectedBars[0].id] ?? false;
    setLastResult(matched ? 'correct' : 'wrong');

    const newHistory = recordAttempt(earHistoryRef.current, degreeIndex, matched);
    setEarHistory(newHistory);
    earHistoryRef.current = newHistory;
    saveEarTrainingHistory(newHistory);

    // Reveal note name just before reinforcement plays
    setRevealed(true);

    // Wait for reinforcement to finish
    const remainingMs = liveTotalAudioEndMs - (performance.now() - perfNow);
    if (remainingMs > 50) await waitMs(remainingMs);
    if (playbackRef.current.runId !== runId) return;

    await waitMs(400);
    if (playbackRef.current.runId !== runId) return;

    setRoundPhase('done');
  }

  function handleStart() {
    setNotesPlayed(1);
    const degreeIndex = pickWeightedDegree(earHistoryRef.current);
    void playRound(degreeIndex);
  }

  async function handleNext() {
    const nextCount = notesPlayed + 1;
    if (nextCount > noteLimit) {
      setRoundPhase('finished');
      return;
    }
    setNotesPlayed(nextCount);
    const degreeIndex = pickWeightedDegree(earHistoryRef.current);
    await playRound(degreeIndex);
  }

  async function handleReplay() {
    if (currentDegreeIndex === null) return;
    await playRound(currentDegreeIndex);
  }

  function handleStop() {
    cancelPlayback();
    setSession(null);
    setRoundPhase('idle');
    setBarResults({});
    setLastResult(null);
  }

  function resetHistory() {
    const empty = {};
    setEarHistory(empty);
    saveEarTrainingHistory(empty);
  }

  // ── Derived display ──────────────────────────────────────────────────────────

  const currentDegree = currentDegreeIndex === null ? null : EAR_DEGREES[currentDegreeIndex];
  const isPlaying     = roundPhase === 'playing';
  const isDone        = roundPhase === 'done';
  const isFinished    = roundPhase === 'finished';
  const isIdle        = roundPhase === 'idle';

  let directionLabel = null;
  if (currentDegree) {
    directionLabel = currentDegree.semitones <= 5 ? '↓ descend to Do' : '↑ ascend to Do′';
  }

  let resultColor = '#f8fafc';
  if (lastResult === 'correct') resultColor = '#22c55e';
  else if (lastResult === 'wrong') resultColor = '#ef4444';

  // When hideNoteName is on, graph is kept mounted but invisible until revealed,
  // so it's already populated with data the moment it becomes visible.
  const graphHidden = hideNoteName && !revealed;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="trainer-grid">

      {/* ── Controls ── */}
      <div className="card controls">
        <div className="lesson-title-row sing-title-row">
          <h3>Functional Ear Training</h3>
          <div className="trainer-detected-note sing-title-detected">
            <span>Detected: </span>
            <strong>{detectedPitch.note}</strong>
          </div>
        </div>

        {/* Key / Octave / Tempo / NoteLimit / HideNoteName */}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>Key</span>
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              disabled={isPlaying}
            >
              {KEY_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>

          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>Octave</span>
            <select
              value={singOctave}
              onChange={(e) => setSingOctave(Number(e.target.value))}
              disabled={isPlaying}
            >
              {[3, 4, 5].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>

          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            Tempo&nbsp;{tempoBpm}&nbsp;bpm
            <input
              type="range"
              min={40}
              max={120}
              value={tempoBpm}
              onChange={(e) => setTempoBpm(Number(e.target.value))}
              disabled={isPlaying}
              style={{ verticalAlign: 'middle' }}
            />
          </label>

          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>Notes</span>
            <select
              value={noteLimit}
              onChange={(e) => setNoteLimit(Number(e.target.value))}
              disabled={isPlaying}
            >
              {NOTE_LIMIT_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>

          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={hideNoteName}
              onChange={(e) => setHideNoteName(e.target.checked)}
              disabled={isPlaying}
            />
            {' '}Hide note name
          </label>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {isIdle && (
            <button type="button" className="button" onClick={handleStart}>▶ Start</button>
          )}
          {isDone && (
            <>
              <button type="button" className="button" onClick={handleNext}>Next ▶</button>
              <button type="button" className="button secondary" onClick={handleReplay}>↺ Replay</button>
              <button type="button" className="button secondary" onClick={handleStop}>■ Stop</button>
            </>
          )}
          {isPlaying && (
            <button type="button" className="button secondary" onClick={handleStop}>■ Stop</button>
          )}
          {isFinished && (
            <button type="button" className="button" onClick={handleStart}>▶ Start Again</button>
          )}
          <Link className="button secondary home-icon-button" to="/" title="Home" aria-label="Home">⌂</Link>
        </div>

        {/* Current degree display */}
        {currentDegree && (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1, color: resultColor, transition: 'color 0.3s' }}>
              {hideNoteName && !revealed ? '?' : currentDegree.name}
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
              {hideNoteName && !revealed ? '' : directionLabel}
            </div>
            {lastResult && (
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6, color: resultColor }}>
                {lastResult === 'correct' ? '✓ Matched' : '✗ Missed'}
              </div>
            )}
            {isFinished && (
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 10, color: '#60a5fa' }}>
                Session complete — {noteLimit} notes played!
              </div>
            )}
          </div>
        )}
        {!currentDegree && isFinished && (
          <div style={{ marginTop: 16, textAlign: 'center', fontSize: 18, fontWeight: 700, color: '#60a5fa' }}>
            Session complete — {noteLimit} notes played!
          </div>
        )}
      </div>

      {/* ── Pitch graph ── */}
      <div
        className="card controls trainer-input-panel"
        style={graphHidden ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}
      >
        <div className="input-header">
          <h3>Pitch</h3>
        </div>
        <SingInputGraphV2
          minFrequencyHz={55}
          maxFrequencyHz={1200}
          history={pitchHistory}
          sessionStartMs={session?.startMs}
          singStartSec={session?.singStartSec}
          stopScrollSec={session?.stopScrollSec}
          playedBars={session?.playedBars ?? []}
          expectedBars={session?.expectedBars ?? []}
          barResults={barResults}
        />
      </div>

      {/* ── Spaced-rep stats ── */}
      <div className="card controls">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Progress</h3>
          <button
            type="button"
            className="button secondary"
            style={{ fontSize: 12, padding: '3px 10px' }}
            onClick={resetHistory}
            disabled={isPlaying}
            title="Reset all history"
          >
            Reset
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {EAR_DEGREES.map((deg, i) => {
            const entry    = earHistory[i];
            const attempts = entry?.attempts  ?? 0;
            const successes = entry?.successes ?? 0;
            const rate     = attempts > 0 ? successes / attempts : null;
            const isActive = currentDegreeIndex === i;
            const barColor = getBarchartColor(rate);

            return (
              <div
                key={deg.name}
                style={{
                  background: isActive ? '#1e3a5f' : '#1e293b',
                  borderRadius: 8,
                  padding: '8px 10px',
                  textAlign: 'center',
                  border: `1px solid ${isActive ? '#3b82f6' : 'transparent'}`,
                  transition: 'border-color 0.2s',
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 700 }}>{deg.name}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{deg.label}</div>
                {attempts > 0 ? (
                  <>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: getScoreColor(rate),
                      }}
                    >
                      {Math.round(rate * 100)}%
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{successes}/{attempts}</div>
                    {/* Mini progress bar */}
                    <div style={{ height: 4, borderRadius: 2, background: '#0f172a', marginTop: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.round(rate * 100)}%`, background: barColor, borderRadius: 2, transition: 'width 0.4s' }} />
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>untried</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
