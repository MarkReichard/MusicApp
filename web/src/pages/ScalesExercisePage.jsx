/**
 * ScalesExercisePage — practice singing scales with real-time pitch feedback.
 *
 * Flow:
 *  1. User chooses key, octave, scale type, direction, and prompt mode.
 *  2. App plays the prompt (full scale or root only).
 *  3. Graph displays ALL expected scale notes regardless of prompt mode.
 *  4. User sings the scale; each note is scored in real time.
 *  5. After all notes elapse, app plays reinforcement of the full scale.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadPitchSettings } from '../lib/pitchSettings';
import { loadPitchRangeSettings } from '../lib/pitchRangeSettings';
import { useStablePitchTracker } from '../lib/useStablePitchTracker';
import { SingInputGraphV2 } from '../components/trainer/SingInputGraphV2';
import {
  AUDIO_START_OFFSET_SECONDS,
  CADENCE_CHORD_GAIN,
  CADENCE_CHORD_OFFSETS,
  beatSecondsFromTempo,
  KEY_OPTIONS,
  midiToFrequencyHz,
  MIN_NOTE_DURATION_SECONDS,
  NOTE_DURATION_SCALE,
  NOTE_GAP_SECONDS,
  TARGET_NOTE_GAIN,
  PLAYBACK_BUFFER_MS,
  tonicMidiFromKeyOctave,
  TRIAD_INTERVALS,
} from '../lib/musicTheory';
import { schedulePianoNote, scheduleMetronomeClick, getPianoAudioContext, stopAllNotes } from '../lib/pianoSynth';
import { evaluateBarMatch } from '../lib/lessonUtils';
import {
  SCALE_TYPES,
  SCALE_TYPE_OPTIONS,
  SCALE_DIRECTIONS,
  SCALE_DIRECTION_OPTIONS,
  PROMPT_MODES,
  PROMPT_MODE_OPTIONS,
  buildScaleMidiSequence,
  buildScaleSolfegeLabels,
  buildPromptMidiSequence,
  getScaleSolfege,
} from '../lib/scaleExercise';

// ── Constants ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'musicapp.web.scaleExercise.options.v1';
const TEMPO_BPM_MIN = 40;
const TEMPO_BPM_MAX = 120;
const TEMPO_BPM_DEFAULT = 72;
const TOLERANCE_CENTS_MIN = 20;
const TOLERANCE_CENTS_MAX = 100;
const TOLERANCE_CENTS_STEP = 5;
const TOLERANCE_CENTS_DEFAULT = 50;
const NOTE_BEATS = 1;
const REINFORCEMENT_GAIN = TARGET_NOTE_GAIN * 0.85;
const PLAY_ALONG_GAIN = TARGET_NOTE_GAIN * 0.55;
const METRONOME_CLICK_GAIN = TARGET_NOTE_GAIN * 1.8;
const METRONOME_VOLUME_MIN = 20;
const METRONOME_VOLUME_MAX = 300;
const METRONOME_VOLUME_DEFAULT = 100;
const METRONOME_VOLUME_STORAGE_KEY = 'musicapp.web.scaleExercise.metronomeVolume.v1';

// ── Settings persistence ───────────────────────────────────────────────────────

function loadOptions() {
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveOptions(opts) {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
  } catch {
    // ignore
  }
}

// ── Metronome helpers ───────────────────────────────────────────────────────────

function scheduleMetronomeBeats(ctx, startAt, beatCount, beatSeconds, clickGain) {
  for (let index = 0; index < beatCount; index += 1) {
    scheduleMetronomeClick(ctx, startAt + index * beatSeconds, clickGain);
  }
}

function clampMetronomeVolume(value) {
  return Math.max(METRONOME_VOLUME_MIN, Math.min(METRONOME_VOLUME_MAX, value));
}

function loadMetronomeVolumeSetting() {
  try {
    const raw = globalThis.localStorage.getItem(METRONOME_VOLUME_STORAGE_KEY);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return METRONOME_VOLUME_DEFAULT;
    return clampMetronomeVolume(parsed);
  } catch {
    return METRONOME_VOLUME_DEFAULT;
  }
}

// ── Timeline builder ───────────────────────────────────────────────────────────

function buildScaleTimeline({ tonicMidi, scaleMidis, promptMidis, solfegeLabels, beatSeconds, playCadence }) {
  const noteDur = Math.max(MIN_NOTE_DURATION_SECONDS, beatSeconds * NOTE_BEATS * NOTE_DURATION_SCALE);

  let cursor = AUDIO_START_OFFSET_SECONDS;
  const playedBars = [];
  const expectedBars = [];

  // Optional I–IV–V–IV cadence
  if (playCadence) {
    CADENCE_CHORD_OFFSETS.forEach((offset, ci) => {
      const chordRoot = tonicMidi + offset;
      TRIAD_INTERVALS.forEach((ti, tii) => {
        playedBars.push({ id: `cad-${ci}-${tii}`, startSec: cursor, endSec: cursor + beatSeconds, midi: chordRoot + ti });
      });
      cursor += beatSeconds;
    });
    cursor += NOTE_GAP_SECONDS * 2;
  }

  // Prompt: app-played notes (full scale or root only)
  promptMidis.forEach((midi, i) => {
    playedBars.push({ id: `prompt-${i}`, startSec: cursor, endSec: cursor + noteDur, midi });
    cursor += noteDur + NOTE_GAP_SECONDS;
  });

  // 1 beat countdown silence
  cursor += beatSeconds;
  const singStartSec = cursor;

  // Expected singing bars — always the full scale
  scaleMidis.forEach((midi, i) => {
    expectedBars.push({
      id: `note-${i}`,
      index: i,
      startSec: cursor,
      endSec: cursor + noteDur,
      scoreEndSec: cursor + noteDur,
      midi,
      lyric: solfegeLabels[i] ?? '',
    });
    cursor += noteDur + NOTE_GAP_SECONDS;
  });

  const stopScrollSec = cursor + beatSeconds * 0.5;
  const reinforceStartSec = stopScrollSec + beatSeconds * 0.25;

  return { playedBars, expectedBars, singStartSec, stopScrollSec, reinforceStartSec, noteDur };
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ScalesExercisePage() {
  const pitchSettings = useMemo(() => loadPitchSettings(), []);
  const pitchRange = useMemo(() => loadPitchRangeSettings(), []);

  const defaultOctave = useMemo(() => {
    if (Number.isFinite(pitchRange.minMidi) && Number.isFinite(pitchRange.maxMidi)) {
      const midMidi = (pitchRange.minMidi + pitchRange.maxMidi) / 2;
      return Math.max(3, Math.min(5, Math.floor(midMidi / 12) - 1));
    }
    return 4;
  }, [pitchRange]);

  const saved = useMemo(() => loadOptions(), []);

  // ── Options ───────────────────────────────────────────────────────────────
  const [selectedKey, setSelectedKey] = useState(saved?.key ?? 'C');
  const [singOctave, setSingOctave] = useState(saved?.octave ?? defaultOctave);
  const [scaleType, setScaleType] = useState(saved?.scaleType ?? SCALE_TYPES.MAJOR);
  const [direction, setDirection] = useState(saved?.direction ?? SCALE_DIRECTIONS.ASCENDING);
  const [promptMode, setPromptMode] = useState(saved?.promptMode ?? PROMPT_MODES.FULL_SCALE);
  const [tempoBpm, setTempoBpm] = useState(saved?.tempoBpm ?? TEMPO_BPM_DEFAULT);
  const [toleranceCents, setToleranceCents] = useState(saved?.toleranceCents ?? TOLERANCE_CENTS_DEFAULT);
  const [playCadence, setPlayCadence] = useState(saved?.playCadence ?? true);
  const [startNoteIndex, setStartNoteIndex] = useState(saved?.startNoteIndex ?? 0);
  const [endNoteIndex, setEndNoteIndex] = useState(saved?.endNoteIndex ?? -1); // -1 = last
  const [playAlong, setPlayAlong] = useState(saved?.playAlong ?? false);
  const [metronomeEnabled, setMetronomeEnabled] = useState(saved?.metronomeEnabled ?? false);
  const [metronomeVolume, setMetronomeVolume] = useState(() => loadMetronomeVolumeSetting());

  // ── Session state ─────────────────────────────────────────────────────────
  const [roundPhase, setRoundPhase] = useState('idle'); // 'idle' | 'playing' | 'done'
  const [session, setSession] = useState(null);
  const [barResults, setBarResults] = useState({});
  const [barMissReasons, setBarMissReasons] = useState({});

  const playbackRef = useRef({ runId: 0, timeoutId: null, resolve: null });
  const historyRef = useRef([]);
  const evaluatedBarsRef = useRef(new Set());
  const barResultsRef = useRef({});

  // Persist options
  useEffect(() => {
    saveOptions({ key: selectedKey, octave: singOctave, scaleType, direction, promptMode, tempoBpm, toleranceCents, playCadence, startNoteIndex, endNoteIndex, playAlong, metronomeEnabled });
  }, [selectedKey, singOctave, scaleType, direction, promptMode, tempoBpm, toleranceCents, playCadence, startNoteIndex, endNoteIndex, playAlong, metronomeEnabled]);

  useEffect(() => {
    try {
      globalThis.localStorage.setItem(METRONOME_VOLUME_STORAGE_KEY, String(metronomeVolume));
    } catch {
      // ignore storage failures
    }
  }, [metronomeVolume]);

  const {
    current: detectedPitch,
    history: pitchHistory,
    clearTrackingData,
  } = useStablePitchTracker({ enabled: true, maxHistoryPoints: 12000, pitchSettings });

  useEffect(() => { historyRef.current = pitchHistory; }, [pitchHistory]);
  useEffect(() => () => { cancelPlayback(); }, []);

  // ── Progressive bar scoring ───────────────────────────────────────────────
  useEffect(() => {
    if (!session?.expectedBars?.length) return undefined;

    const timerId = globalThis.setInterval(() => {
      const elapsedSec = (performance.now() - session.startMs) / 1000;
      if (!Number.isFinite(elapsedSec) || elapsedSec < 0) return;

      for (const bar of session.expectedBars) {
        if (elapsedSec < bar.scoreEndSec || evaluatedBarsRef.current.has(bar.id)) continue;

        evaluatedBarsRef.current.add(bar.id);
        const { matched, reason } = evaluateBarMatch({
          bar,
          history: historyRef.current,
          sessionStartMs: session.startMs,
          toleranceCents,
        });

        barResultsRef.current = { ...barResultsRef.current, [bar.id]: matched };
        setBarResults((prev) => (prev[bar.id] === matched ? prev : { ...prev, [bar.id]: matched }));
        setBarMissReasons((prev) => {
          const nextReason = matched ? null : reason;
          if (prev[bar.id] === nextReason) return prev;
          return { ...prev, [bar.id]: nextReason };
        });
      }
    }, 60);

    return () => { globalThis.clearInterval(timerId); };
  }, [session, toleranceCents]);

  // ── Playback helpers ──────────────────────────────────────────────────────

  function cancelPlayback() {
    playbackRef.current.runId += 1;
    stopAllNotes();
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

  // ── Play round ────────────────────────────────────────────────────────────

  async function playRound() {
    playbackRef.current.runId += 1;
    const runId = playbackRef.current.runId;

    const beatSeconds = beatSecondsFromTempo(tempoBpm);
    const tonicMidi = tonicMidiFromKeyOctave(selectedKey, singOctave);
    const fullScaleMidis = buildScaleMidiSequence({ key: selectedKey, octave: singOctave, scaleType, direction });
    const fullSolfegeLabels = buildScaleSolfegeLabels({ scaleType, direction });

    // Slice to start/end note range
    const resolvedEnd = endNoteIndex < 0 || endNoteIndex >= fullScaleMidis.length
      ? fullScaleMidis.length - 1
      : endNoteIndex;
    const resolvedStart = Math.min(startNoteIndex, resolvedEnd);
    const scaleMidis = fullScaleMidis.slice(resolvedStart, resolvedEnd + 1);
    const solfegeLabels = fullSolfegeLabels.slice(resolvedStart, resolvedEnd + 1);

    const promptMidis = promptMode === PROMPT_MODES.ROOT_ONLY
      ? [scaleMidis[0]]
      : scaleMidis;

    const { playedBars, expectedBars, singStartSec, stopScrollSec, reinforceStartSec, noteDur } =
      buildScaleTimeline({ tonicMidi, scaleMidis, promptMidis, solfegeLabels, beatSeconds, playCadence });

    clearTrackingData();
    setBarResults({});
    setBarMissReasons({});
    barResultsRef.current = {};
    evaluatedBarsRef.current = new Set();
    setRoundPhase('playing');

    const ctx = getPianoAudioContext();
    await ctx.resume().catch(() => undefined);
    if (playbackRef.current.runId !== runId) return;

    const ctxNow = ctx.currentTime;
    const perfNow = performance.now();
    const startMs = perfNow + AUDIO_START_OFFSET_SECONDS * 1000;

    // ── Schedule prompt audio ───────────────────────────────────────────
    const cadenceStartAt = ctxNow + AUDIO_START_OFFSET_SECONDS;
    const cadenceBeatCount = playCadence ? CADENCE_CHORD_OFFSETS.length : 0;
    const promptGuideBeats = promptMidis.length;
    const countdownBeats = 1;
    const sungPhraseBeats = scaleMidis.length;
    const metronomeClickGain = METRONOME_CLICK_GAIN * (metronomeVolume / 100);

    let ac = cadenceStartAt;

    if (playCadence) {
      CADENCE_CHORD_OFFSETS.forEach((offset) => {
        const chordRoot = tonicMidi + offset;
        TRIAD_INTERVALS.forEach((ti) => {
          schedulePianoNote(ctx, midiToFrequencyHz(chordRoot + ti), ac, beatSeconds, CADENCE_CHORD_GAIN);
        });
        ac += beatSeconds;
      });
      ac += NOTE_GAP_SECONDS * 2;
    }

    const guideStartAt = ac;

    promptMidis.forEach((midi) => {
      schedulePianoNote(ctx, midiToFrequencyHz(midi), ac, noteDur, TARGET_NOTE_GAIN);
      ac += noteDur + NOTE_GAP_SECONDS;
    });

    const countdownStartAt = ac;

    if (metronomeEnabled) {
      if (cadenceBeatCount > 0) {
        scheduleMetronomeBeats(ctx, cadenceStartAt, cadenceBeatCount, beatSeconds, metronomeClickGain);
      }
      scheduleMetronomeBeats(ctx, guideStartAt, promptGuideBeats, beatSeconds, metronomeClickGain);
      scheduleMetronomeBeats(ctx, countdownStartAt, countdownBeats, beatSeconds, metronomeClickGain);
      scheduleMetronomeBeats(ctx, ctxNow + singStartSec, sungPhraseBeats, beatSeconds, metronomeClickGain);
    }

    // ── Schedule play-along notes during singing ────────────────────────
    if (playAlong) {
      expectedBars.forEach((bar) => {
        schedulePianoNote(ctx, midiToFrequencyHz(bar.midi), ctxNow + bar.startSec, noteDur, PLAY_ALONG_GAIN);
      });
    }

    // ── Schedule reinforcement (full scale after singing) ───────────────
    let rc = ctxNow + reinforceStartSec;
    scaleMidis.forEach((midi) => {
      schedulePianoNote(ctx, midiToFrequencyHz(midi), rc, noteDur, REINFORCEMENT_GAIN);
      rc += noteDur + NOTE_GAP_SECONDS;
    });
    const totalAudioEndMs = (rc - ctxNow) * 1000 + PLAYBACK_BUFFER_MS;

    setSession({ startMs, singStartSec, stopScrollSec, playedBars, expectedBars });

    // ── Wait for singing to finish ──────────────────────────────────────
    const lastBar = expectedBars.at(-1);
    if (!lastBar) { setRoundPhase('done'); return; }

    const scoreDeadline = startMs + lastBar.scoreEndSec * 1000 + 200;
    await waitMs(scoreDeadline - performance.now());
    if (playbackRef.current.runId !== runId) return;

    // Wait for reinforcement
    const remainingMs = totalAudioEndMs - (performance.now() - perfNow);
    if (remainingMs > 50) await waitMs(remainingMs);
    if (playbackRef.current.runId !== runId) return;

    await waitMs(400);
    if (playbackRef.current.runId !== runId) return;

    setRoundPhase('done');
  }

  function handlePlay() { cancelPlayback(); void playRound(); }

  function handleStop() {
    cancelPlayback();
    setSession(null);
    setRoundPhase('idle');
    setBarResults({});
    setBarMissReasons({});
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const isPlaying = roundPhase === 'playing';
  const isDone = roundPhase === 'done';
  const isIdle = roundPhase === 'idle';

  // Build solfege options for start/end note dropdowns
  const solfegeOptions = useMemo(() => {
    const labels = getScaleSolfege(scaleType);
    return labels.map((label, i) => ({ value: i, label }));
  }, [scaleType]);

  // Clamp start/end when scale type changes (different note counts)
  useEffect(() => {
    const maxIdx = solfegeOptions.length - 1;
    if (startNoteIndex > maxIdx) setStartNoteIndex(0);
    if (endNoteIndex !== -1 && endNoteIndex > maxIdx) setEndNoteIndex(-1);
  }, [solfegeOptions]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="trainer-grid">

      {/* ── Controls card ── */}
      <div className="card controls ear-main-card">
        <div className="lesson-title-row sing-title-row">
          <h3>Scale Exercise</h3>
          <div className="trainer-detected-note sing-title-detected">
            <span>Detected: </span>
            <strong>{detectedPitch.note}</strong>
          </div>
        </div>
        <p className="ear-page-subtitle">Choose a scale, listen to the prompt, then sing it back. All scale notes are shown on the graph.</p>

        <div className="ear-controls-layout">
          <section className="ear-controls-section">
            <h4 className="ear-controls-title">Scale Setup</h4>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
              <label className="ear-inline-field">
                <span>Key</span>
                <select value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)} disabled={isPlaying}>
                  {KEY_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>

              <label className="ear-inline-field">
                <span>Octave</span>
                <select value={singOctave} onChange={(e) => setSingOctave(Number(e.target.value))} disabled={isPlaying}>
                  {[2, 3, 4, 5].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>

              <label className="ear-inline-field">
                <span>Scale</span>
                <select value={scaleType} onChange={(e) => setScaleType(e.target.value)} disabled={isPlaying}>
                  {SCALE_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </label>

              <label className="ear-inline-field">
                <span>Direction</span>
                <select value={direction} onChange={(e) => setDirection(e.target.value)} disabled={isPlaying}>
                  {SCALE_DIRECTION_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </label>

              <label className="ear-inline-field">
                <span>Prompt</span>
                <select value={promptMode} onChange={(e) => setPromptMode(e.target.value)} disabled={isPlaying}>
                  {PROMPT_MODE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </label>

              <label className="ear-inline-field">
                <span>Start note</span>
                <select value={startNoteIndex} onChange={(e) => setStartNoteIndex(Number(e.target.value))} disabled={isPlaying}>
                  {solfegeOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </label>

              <label className="ear-inline-field">
                <span>End note</span>
                <select value={endNoteIndex} onChange={(e) => setEndNoteIndex(Number(e.target.value))} disabled={isPlaying}>
                  <option value={-1}>{solfegeOptions[solfegeOptions.length - 1]?.label ?? 'Last'}</option>
                  {solfegeOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </label>
            </div>
          </section>

          <section className="ear-controls-section">
            <h4 className="ear-controls-title">Options</h4>

            <label className="ear-tempo-field">
              Tempo&nbsp;{tempoBpm}&nbsp;bpm
              <input
                type="range" min={TEMPO_BPM_MIN} max={TEMPO_BPM_MAX}
                value={tempoBpm} onChange={(e) => setTempoBpm(Number(e.target.value))}
                disabled={isPlaying} style={{ verticalAlign: 'middle' }}
              />
            </label>

            <label className="ear-tempo-field">
              Tolerance&nbsp;{toleranceCents}¢
              <input
                type="range" min={TOLERANCE_CENTS_MIN} max={TOLERANCE_CENTS_MAX} step={TOLERANCE_CENTS_STEP}
                value={toleranceCents} onChange={(e) => setToleranceCents(Number(e.target.value))}
                disabled={isPlaying} style={{ verticalAlign: 'middle' }}
              />
            </label>

            <label className="ear-checkbox-field">
              <input type="checkbox" checked={playCadence} onChange={(e) => setPlayCadence(e.target.checked)} disabled={isPlaying} />
              {' '}Play cadence chords
            </label>

            <label className="ear-checkbox-field">
              <input type="checkbox" checked={playAlong} onChange={(e) => setPlayAlong(e.target.checked)} disabled={isPlaying} />
              {' '}Play along while singing
            </label>

            <label className="ear-checkbox-field">
              <input type="checkbox" checked={metronomeEnabled} onChange={(e) => setMetronomeEnabled(e.target.checked)} disabled={isPlaying} />
              {' '}Metronome
            </label>

            {metronomeEnabled && (
              <label className="ear-tempo-field">
                Metronome volume&nbsp;{metronomeVolume}%
                <input
                  type="range"
                  min={METRONOME_VOLUME_MIN}
                  max={METRONOME_VOLUME_MAX}
                  value={metronomeVolume}
                  onChange={(e) => setMetronomeVolume(clampMetronomeVolume(Number(e.target.value)))}
                  disabled={isPlaying}
                  style={{ verticalAlign: 'middle' }}
                />
              </label>
            )}
          </section>
        </div>

        {/* Buttons */}
        <div className="ear-action-row">
          <button type="button" className="button" onClick={handlePlay}>▶ Play</button>
          <button type="button" className="button secondary" onClick={handleStop} disabled={isIdle}>■ Stop</button>
          <Link className="button secondary home-icon-button" to="/" title="Home" aria-label="Home">⌂</Link>
        </div>
      </div>

      {/* ── Pitch graph ── */}
      <div className="card controls trainer-input-panel ear-graph-card">
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
          barMissReasons={barMissReasons}
        />
      </div>
    </div>
  );
}
