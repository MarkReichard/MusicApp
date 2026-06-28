/**
 * EarTrainingPage — functional ear training with spaced repetition and pattern drills.
 *
 * Each round:
 *  1. App plays I–IV–V–IV cadence, then the target pitch once as a guide.
 *  2. User sings the target note ("DAAAH"), then the stepwise route back to Do.
 *     – Fa or lower → descend stepwise to Do.
 *     – Sol or higher → ascend stepwise to Do′.
 *  3. Only the first sung note is scored.
 *  4. App plays back the full daaah–da–da–da sequence as reinforcement.
 *     If "hide note name" is on, the name and graph are revealed here.
 *  5. After reinforcement, user clicks Next or Replay.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { loadPitchSettings } from '../lib/pitchSettings';
import { loadPitchRangeSettings } from '../lib/pitchRangeSettings';
import { useStablePitchTracker } from '../lib/useStablePitchTracker';
import { SingInputGraphV2 } from '../components/trainer/SingInputGraphV2';
import { DetectorLogDebugControls } from '../components/trainer/DetectorLogDebugControls';
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
  METRONOME_BASE_CLICK_GAIN,
  METRONOME_VOLUME_REFERENCE_PERCENT,
  solfegeForMajorScaleSemitone,
  tonicMidiFromKeyOctave,
  TRIAD_INTERVALS,
} from '../lib/musicTheory';
import { schedulePianoNote, scheduleMetronomeClick, getPianoAudioContext, stopAllNotes } from '../lib/pianoSynth';
import { evaluateBarMatch } from '../lib/lessonUtils';
import {
  EAR_DEGREES,
  loadEarTrainingHistory,
  saveEarTrainingHistory,
  recordAttempt,
  pickWeightedDegree,
} from '../lib/earTrainingSettings';
import {
  EAR_EXERCISE_MODES,
  EAR_EXERCISE_MODE_OPTIONS,
  EAR_PATTERN_TYPES,
  EAR_PATTERN_TYPE_OPTIONS,
  isFixedIntervalPatternType,
  getAvailablePatternMidis,
  buildPatternRound,
  buildSingleTonicRound,
  buildAscendingScaleRound,
  buildDescendingScaleRound,
} from '../lib/earTrainingExercise';

// ── Constants ──────────────────────────────────────────────────────────────────

const PATTERN_NOTE_COUNT_OPTIONS = Array.from({ length: 11 }, (_, i) => i + 2);
const TEMPO_BPM_MIN = 40;
const TEMPO_BPM_MAX = 120;
const TEMPO_BPM_DEFAULT = 72;
const TOLERANCE_CENTS_MIN = 0;
const TOLERANCE_CENTS_MAX = 50;
const TOLERANCE_CENTS_STEP = 5;
const EAR_TRAINING_OPTIONS_STORAGE_KEY = 'musicapp.web.earTraining.options.v1';

/** First (scored) note is "DAAAH" — 2 beats. */
const DAAAH_BEATS = 1;
/** Stepwise (display-only) notes are "da" — 1 beat each. */
const DA_BEATS = 1;

const REINFORCEMENT_GAIN = TARGET_NOTE_GAIN * 0.85;
const TOLERANCE_CENTS_DEFAULT = 50;
const METRONOME_CLICK_GAIN = METRONOME_BASE_CLICK_GAIN;
const METRONOME_VOLUME_MIN = 20;
const METRONOME_VOLUME_MAX = 300;
const EAR_TRAINING_METRONOME_VOLUME_STORAGE_KEY = 'musicapp.web.earTraining.metronomeVolume.v1';

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Builds timeline arrays (playedBars, expectedBars) and timing anchors.
 * All times are in seconds, relative to startMs.
 * Cursor starts at AUDIO_START_OFFSET_SECONDS so the first events align with
 * the audio context schedule (same convention as buildSingTimeline).
 */
function buildTimeline({ tonicMidi, midiSeq, promptMidiSeq, beatSeconds, playCadenceChords, guideBeatsPerNote = 1, useSolfegeLabels = true }) {
  const daahDur = Math.max(MIN_NOTE_DURATION_SECONDS, beatSeconds * DAAAH_BEATS * NOTE_DURATION_SCALE);
  const daDur   = Math.max(MIN_NOTE_DURATION_SECONDS, beatSeconds * DA_BEATS   * NOTE_DURATION_SCALE);

  let cursor = AUDIO_START_OFFSET_SECONDS;
  const playedBars  = [];
  const expectedBars = [];

  // I–IV–V–IV cadence
  if (playCadenceChords) {
    CADENCE_CHORD_OFFSETS.forEach((offset, ci) => {
      const chordRoot = tonicMidi + offset;
      TRIAD_INTERVALS.forEach((ti, tii) => {
        playedBars.push({ id: `cad-${ci}-${tii}`, startSec: cursor, endSec: cursor + beatSeconds, midi: chordRoot + ti });
      });
      cursor += beatSeconds;
    });
    cursor += NOTE_GAP_SECONDS * 2;
  }

  // Guide: app plays either a single target note or a full note pattern.
  const guideDur = beatSeconds * Math.max(1, guideBeatsPerNote);
  promptMidiSeq.forEach((midi, i) => {
    playedBars.push({ id: `guide-${i}`, startSec: cursor, endSec: cursor + guideDur, midi });
    cursor += guideDur + NOTE_GAP_SECONDS;
  });

  // 1-beat countdown silence before user sings
  cursor += beatSeconds;
  const singStartSec = cursor;

  // Expected singing bars
  midiSeq.forEach((midi, i) => {
    const dur     = i === 0 ? daahDur : daDur;
    const semOff  = midi - tonicMidi;
    const lyric   = useSolfegeLabels ? solfegeForMajorScaleSemitone(semOff) : '';
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

function clampMetronomeVolume(value) {
  return Math.max(METRONOME_VOLUME_MIN, Math.min(METRONOME_VOLUME_MAX, value));
}

function loadMetronomeVolumeSetting() {
  try {
    const raw = globalThis.localStorage.getItem(EAR_TRAINING_METRONOME_VOLUME_STORAGE_KEY);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return METRONOME_VOLUME_REFERENCE_PERCENT;
    return clampMetronomeVolume(parsed);
  } catch {
    return METRONOME_VOLUME_REFERENCE_PERCENT;
  }
}

function loadEarTrainingOptions() {
  const defaultOptions = {
    selectedKey: 'C',
    singOctave: null,
    exerciseMode: EAR_EXERCISE_MODES.SINGLE_TONIC_RESOLVE,
    patternType: EAR_PATTERN_TYPES.RANDOM_ARPEGGIO,
    patternNoteCount: 4,
    limitPatternToStartingOctave: false,
    tempoBpm: TEMPO_BPM_DEFAULT,
    toleranceCents: TOLERANCE_CENTS_DEFAULT,
    playCadenceChords: true,
    hideNoteName: false,
    metronomeEnabled: false,
  };

  try {
    const raw = globalThis.localStorage.getItem(EAR_TRAINING_OPTIONS_STORAGE_KEY);
    if (!raw) {
      return defaultOptions;
    }
    const parsed = JSON.parse(raw);
    const parsedOctave = Number(parsed?.singOctave);
    const parsedTempo = Number(parsed?.tempoBpm ?? TEMPO_BPM_DEFAULT);
    const parsedTolerance = Number(parsed?.toleranceCents ?? TOLERANCE_CENTS_DEFAULT);
    const parsedPatternNoteCount = Number(parsed?.patternNoteCount ?? defaultOptions.patternNoteCount);

    return {
      selectedKey: KEY_OPTIONS.includes(parsed?.selectedKey) ? parsed.selectedKey : defaultOptions.selectedKey,
      singOctave: Number.isInteger(parsedOctave) ? Math.max(1, Math.min(7, parsedOctave)) : defaultOptions.singOctave,
      exerciseMode: Object.values(EAR_EXERCISE_MODES).includes(parsed?.exerciseMode)
        ? parsed.exerciseMode
        : defaultOptions.exerciseMode,
      patternType: Object.values(EAR_PATTERN_TYPES).includes(parsed?.patternType)
        ? parsed.patternType
        : defaultOptions.patternType,
      patternNoteCount: PATTERN_NOTE_COUNT_OPTIONS.includes(parsedPatternNoteCount)
        ? parsedPatternNoteCount
        : defaultOptions.patternNoteCount,
      limitPatternToStartingOctave: Boolean(parsed?.limitPatternToStartingOctave ?? defaultOptions.limitPatternToStartingOctave),
      tempoBpm: Math.max(TEMPO_BPM_MIN, Math.min(TEMPO_BPM_MAX, Number.isFinite(parsedTempo) ? parsedTempo : TEMPO_BPM_DEFAULT)),
      toleranceCents: Math.max(
        TOLERANCE_CENTS_MIN,
        Math.min(TOLERANCE_CENTS_MAX, Number.isFinite(parsedTolerance) ? parsedTolerance : TOLERANCE_CENTS_DEFAULT),
      ),
      playCadenceChords: Boolean(parsed?.playCadenceChords ?? defaultOptions.playCadenceChords),
      hideNoteName: Boolean(parsed?.hideNoteName ?? defaultOptions.hideNoteName),
      metronomeEnabled: Boolean(parsed?.metronomeEnabled ?? defaultOptions.metronomeEnabled),
    };
  } catch {
    return defaultOptions;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function EarTrainingPage() {
  const [searchParams] = useSearchParams();
  const isDebug = searchParams.get('debug') === 'true';
  const pitchSettings = useMemo(() => loadPitchSettings(), []);
  const pitchRange    = useMemo(() => loadPitchRangeSettings(), []);

  const defaultOctave = useMemo(() => {
    if (Number.isFinite(pitchRange.minMidi) && Number.isFinite(pitchRange.maxMidi)) {
      const midMidi = (pitchRange.minMidi + pitchRange.maxMidi) / 2;
      return Math.max(3, Math.min(5, Math.floor(midMidi / 12) - 1));
    }
    return 4;
  }, [pitchRange]);

  const savedEarOptions = useMemo(() => loadEarTrainingOptions(), []);

  // ── Options ───────────────────────────────────────────────────────────────
  const [selectedKey,  setSelectedKey]  = useState(savedEarOptions.selectedKey);
  const [singOctave,   setSingOctave]   = useState(savedEarOptions.singOctave ?? defaultOctave);
  const [exerciseMode, setExerciseMode] = useState(savedEarOptions.exerciseMode);
  const [patternType, setPatternType] = useState(savedEarOptions.patternType);
  const [patternNoteCount, setPatternNoteCount] = useState(savedEarOptions.patternNoteCount);
  const [limitPatternToStartingOctave, setLimitPatternToStartingOctave] = useState(savedEarOptions.limitPatternToStartingOctave);
  const [tempoBpm,     setTempoBpm]     = useState(savedEarOptions.tempoBpm);
  const [toleranceCents, setToleranceCents] = useState(savedEarOptions.toleranceCents);
  const [playCadenceChords, setPlayCadenceChords] = useState(savedEarOptions.playCadenceChords);
  const [hideNoteName, setHideNoteName] = useState(savedEarOptions.hideNoteName);
  const [metronomeEnabled, setMetronomeEnabled] = useState(savedEarOptions.metronomeEnabled);
  const [metronomeVolume, setMetronomeVolume] = useState(() => loadMetronomeVolumeSetting());

  // ── Session state ──────────────────────────────────────────────────────────
  // roundPhase: 'idle' | 'playing' | 'done'
  const [roundPhase,         setRoundPhase]         = useState('idle');
  const [currentDegreeIndex, setCurrentDegreeIndex] = useState(null);
  const [session,            setSession]            = useState(null);
  const [activeRound,        setActiveRound]        = useState(null);
  const [barResults,         setBarResults]         = useState({});
  const [barMissReasons,     setBarMissReasons]     = useState({});
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
  useEffect(() => {
    try {
      globalThis.localStorage.setItem(EAR_TRAINING_OPTIONS_STORAGE_KEY, JSON.stringify({
        selectedKey,
        singOctave,
        exerciseMode,
        patternType,
        patternNoteCount,
        limitPatternToStartingOctave,
        tempoBpm,
        toleranceCents,
        playCadenceChords,
        hideNoteName,
        metronomeEnabled,
      }));
    } catch {
      // ignore storage failures
    }
  }, [
    selectedKey,
    singOctave,
    exerciseMode,
    patternType,
    patternNoteCount,
    limitPatternToStartingOctave,
    tempoBpm,
    toleranceCents,
    playCadenceChords,
    hideNoteName,
    metronomeEnabled,
  ]);
  useEffect(() => {
    try {
      globalThis.localStorage.setItem(EAR_TRAINING_METRONOME_VOLUME_STORAGE_KEY, String(metronomeVolume));
    } catch {
      // ignore storage failures
    }
  }, [metronomeVolume]);

  const {
    current: detectedPitch,
    history: pitchHistory,
    clearTrackingData,
    detectorLogSummary,
    clearDetectorLog,
    getDetectorLogRows,
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
        const evaluation = evaluateBarMatch({
          bar,
          history:        historyRef.current,
          sessionStartMs: session.startMs,
          toleranceCents,
        });
        const { matched, reason } = evaluation;

        barResultsRef.current = { ...barResultsRef.current, [bar.id]: matched };
        setBarResults((prev) => (prev[bar.id] === matched ? prev : { ...prev, [bar.id]: matched }));
        setBarMissReasons((prev) => {
          const nextReason = matched ? null : reason;
          if (prev[bar.id] === nextReason) return prev;
          return { ...prev, [bar.id]: nextReason };
        });

        // First bar result drives the visible indicator (set after reveal)
        if (bar.index === 0 && session.scoreMode === 'first-note') {
          const nextResult = matched ? 'correct' : 'wrong';
          setLastResult((prev) => (prev === null ? null : nextResult));
        }
      }
    }, 60);

    return () => { globalThis.clearInterval(timerId); };
  }, [session]);

  function buildRoundConfig() {
    const tonicMidi = tonicMidiFromKeyOctave(selectedKey, singOctave);
    const minMidi = Number.isFinite(pitchRange.minMidi) ? pitchRange.minMidi : null;
    const maxMidi = Number.isFinite(pitchRange.maxMidi) ? pitchRange.maxMidi : null;

    if (exerciseMode === EAR_EXERCISE_MODES.NOTE_PATTERN) {
      return buildPatternRound({
        tonicMidi,
        patternType,
        noteCount: patternNoteCount,
        minMidi,
        maxMidi,
        limitToStartingOctave: limitPatternToStartingOctave,
      });
    }

    if (exerciseMode === EAR_EXERCISE_MODES.ASCENDING_SCALE) {
      return buildAscendingScaleRound({ tonicMidi, minMidi, maxMidi });
    }

    if (exerciseMode === EAR_EXERCISE_MODES.DESCENDING_SCALE) {
      return buildDescendingScaleRound({ tonicMidi, minMidi, maxMidi });
    }

    const validDegreeIndices = EAR_DEGREES
      .map((degree, degreeIndex) => {
        const round = buildSingleTonicRound({
          tonicMidi,
          degree: { ...degree, index: degreeIndex },
          minMidi,
          maxMidi,
        });
        return round ? degreeIndex : null;
      })
      .filter((degreeIndex) => Number.isInteger(degreeIndex));

    if (validDegreeIndices.length === 0) {
      return null;
    }

    const degreeIndex = pickWeightedDegree(earHistoryRef.current, validDegreeIndices);

    return buildSingleTonicRound({
      tonicMidi,
      degree: { ...EAR_DEGREES[degreeIndex], index: degreeIndex },
      minMidi,
      maxMidi,
    });
  }

  // ── Playback control ─────────────────────────────────────────────────────────

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

  // ── Single round ─────────────────────────────────────────────────────────────

  async function playRound(roundConfig) {
    playbackRef.current.runId += 1;
    const runId = playbackRef.current.runId;

    // Capture state that must survive across awaits
    const snapHideNoteName = hideNoteName;

    const beatSeconds = beatSecondsFromTempo(tempoBpm);
    const tonicMidi   = tonicMidiFromKeyOctave(selectedKey, singOctave);
    const midiSeq     = roundConfig.singMidiSeq;

    const { playedBars, expectedBars, singStartSec, stopScrollSec, reinforceStartSec, daahDur, daDur } =
      buildTimeline({
        tonicMidi,
        midiSeq,
        promptMidiSeq: roundConfig.promptMidiSeq,
        beatSeconds,
        playCadenceChords,
        guideBeatsPerNote: roundConfig.guideBeatsPerNote,
        useSolfegeLabels: roundConfig.useSolfegeLabels ?? (roundConfig.mode === EAR_EXERCISE_MODES.SINGLE_TONIC_RESOLVE),
      });

    clearTrackingData();
    setActiveRound(roundConfig);
    setCurrentDegreeIndex(roundConfig.degreeIndex);
    setBarResults({});
    setBarMissReasons({});
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
    const cadenceStartAt = ctxNow + AUDIO_START_OFFSET_SECONDS;
    const metronomeClickGain = METRONOME_CLICK_GAIN * (metronomeVolume / 100);

    // ── Schedule audio ──────────────────────────────────────────────────────

    let ac = cadenceStartAt;

    if (playCadenceChords) {
      CADENCE_CHORD_OFFSETS.forEach((offset) => {
        if (metronomeEnabled) {
          scheduleMetronomeClick(ctx, ac, metronomeClickGain);
        }
        const chordRoot = tonicMidi + offset;
        TRIAD_INTERVALS.forEach((ti) => {
          schedulePianoNote(ctx, midiToFrequencyHz(chordRoot + ti), ac, beatSeconds, CADENCE_CHORD_GAIN);
        });
        ac += beatSeconds;
      });
      ac += NOTE_GAP_SECONDS * 2;
    }

    const guideStartAt = ac;

    const guideDur = beatSeconds * Math.max(1, roundConfig.guideBeatsPerNote);
    roundConfig.promptMidiSeq.forEach((midi) => {
      if (metronomeEnabled) {
        const guideBeatsPerNote = Math.max(1, roundConfig.guideBeatsPerNote);
        for (let beatIndex = 0; beatIndex < guideBeatsPerNote; beatIndex += 1) {
          scheduleMetronomeClick(ctx, ac + beatIndex * beatSeconds, metronomeClickGain);
        }
      }
      schedulePianoNote(ctx, midiToFrequencyHz(midi), ac, guideDur, TARGET_NOTE_GAIN);
      ac += guideDur + NOTE_GAP_SECONDS;
    });

    const countdownStartAt = ac;
    if (metronomeEnabled) {
      scheduleMetronomeClick(ctx, countdownStartAt, metronomeClickGain);
    }
    ac += beatSeconds; // countdown silence — ac is now at audio ctx equivalent of singStartSec

    if (metronomeEnabled) {
      expectedBars.forEach((bar) => {
        scheduleMetronomeClick(ctx, ctxNow + bar.startSec, metronomeClickGain);
      });
    }

    // ── Fixed expected bars and reinforcement ───────────────────────────────

    let rc = ctxNow + reinforceStartSec;
    midiSeq.forEach((midi, i) => {
      const dur = i === 0 ? daahDur : daDur;
      schedulePianoNote(ctx, midiToFrequencyHz(midi), rc, dur, REINFORCEMENT_GAIN);
      rc += dur + NOTE_GAP_SECONDS;
    });
    const totalAudioEndMs = (rc - ctxNow) * 1000 + PLAYBACK_BUFFER_MS;

    setSession({ startMs, singStartSec, stopScrollSec, playedBars, expectedBars, scoreMode: roundConfig.scoreMode });

    // ── Wait for singing bars to elapse ─────────────────────────────────────

    const lastLiveBar    = expectedBars.at(-1);
    if (!lastLiveBar) {
      setRoundPhase('done');
      return;
    }
    const scoreDeadline  = startMs + lastLiveBar.scoreEndSec * 1000 + 200;
    await waitMs(scoreDeadline - performance.now());
    if (playbackRef.current.runId !== runId) return;

    const matched = roundConfig.scoreMode === 'all-notes'
      ? expectedBars.every((bar) => barResultsRef.current[bar.id] ?? false)
      : (barResultsRef.current[expectedBars[0]?.id] ?? false);
    setLastResult(matched ? 'correct' : 'wrong');

    if (Number.isInteger(roundConfig.degreeIndex)) {
      const newHistory = recordAttempt(earHistoryRef.current, roundConfig.degreeIndex, matched);
      setEarHistory(newHistory);
      earHistoryRef.current = newHistory;
      saveEarTrainingHistory(newHistory);
    }

    // Reveal note name just before reinforcement plays
    setRevealed(true);

    // Wait for reinforcement to finish
    const remainingMs = totalAudioEndMs - (performance.now() - perfNow);
    if (remainingMs > 50) await waitMs(remainingMs);
    if (playbackRef.current.runId !== runId) return;

    await waitMs(400);
    if (playbackRef.current.runId !== runId) return;

    setRoundPhase('done');
  }

  function handleStart() {
    const round = buildRoundConfig();
    if (!round) return;
    void playRound(round);
  }

  async function handleNext() {
    const round = buildRoundConfig();
    if (!round) return;
    await playRound(round);
  }

  async function handleReplay() {
    if (!activeRound) return;
    cancelPlayback();
    await playRound(activeRound);
  }

  function handleStop() {
    cancelPlayback();
    setSession(null);
    setActiveRound(null);
    setRoundPhase('idle');
    setBarResults({});
    setBarMissReasons({});
    setLastResult(null);
  }

  function resetHistory() {
    const empty = {};
    setEarHistory(empty);
    saveEarTrainingHistory(empty);
  }

  // ── Derived display ──────────────────────────────────────────────────────────

  const isPatternMode = exerciseMode === EAR_EXERCISE_MODES.NOTE_PATTERN;
  const isFixedPatternType = isFixedIntervalPatternType(patternType);
  const isRandomPatternType = isPatternMode && !isFixedPatternType;
  const isSingleTonicMode = exerciseMode === EAR_EXERCISE_MODES.SINGLE_TONIC_RESOLVE;
  const isPlaying     = roundPhase === 'playing';
  const isDone        = roundPhase === 'done';
  const isIdle        = roundPhase === 'idle';

  const directionLabel = activeRound?.detailLabel ?? null;

  let resultColor = '#f8fafc';
  if (lastResult === 'correct') resultColor = '#22c55e';
  else if (lastResult === 'wrong') resultColor = '#ef4444';

  // Color for the large degree display: grey ? while hidden, normal result color otherwise
  let degreeDisplayColor = resultColor;
  if (hideNoteName && !revealed) {
    degreeDisplayColor = '#94a3b8';
  }

  // When hideNoteName is on, graph is kept mounted but invisible until revealed,
  // so it's already populated with data the moment it becomes visible.
  const graphHidden = hideNoteName && !revealed;
  const tonicMidi = tonicMidiFromKeyOctave(selectedKey, singOctave);
  const minMidi = Number.isFinite(pitchRange.minMidi) ? pitchRange.minMidi : null;
  const maxMidi = Number.isFinite(pitchRange.maxMidi) ? pitchRange.maxMidi : null;
  const hasRangeLimits = Number.isFinite(minMidi) && Number.isFinite(maxMidi);
  const hasValidSingleDegrees = EAR_DEGREES.some((degree, degreeIndex) => {
    const round = buildSingleTonicRound({ tonicMidi, degree: { ...degree, index: degreeIndex }, minMidi, maxMidi });
    return Boolean(round);
  });
  const hasValidPatternNotes = isFixedPatternType
    ? Boolean(buildPatternRound({
      tonicMidi,
      patternType,
      noteCount: patternNoteCount,
      minMidi,
      maxMidi,
      limitToStartingOctave: limitPatternToStartingOctave,
    }))
    : getAvailablePatternMidis({
      tonicMidi,
      patternType,
      minMidi,
      maxMidi,
      limitToStartingOctave: limitPatternToStartingOctave,
    }).length > 1;
  const hasValidAscendingScale = Boolean(buildAscendingScaleRound({ tonicMidi, minMidi, maxMidi }));
  const hasValidDescendingScale = Boolean(buildDescendingScaleRound({ tonicMidi, minMidi, maxMidi }));
  const hasValidRoundForSettings =
    exerciseMode === EAR_EXERCISE_MODES.NOTE_PATTERN ? hasValidPatternNotes
      : exerciseMode === EAR_EXERCISE_MODES.ASCENDING_SCALE ? hasValidAscendingScale
        : exerciseMode === EAR_EXERCISE_MODES.DESCENDING_SCALE ? hasValidDescendingScale
          : hasValidSingleDegrees;
  const rangeHint = hasRangeLimits && !hasValidRoundForSettings
    ? 'No exercise notes fit your saved range for this key/octave. Change key, octave, or pattern type.'
    : null;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="trainer-grid">

      {/* ── Controls ── */}
      <div className="card controls ear-main-card">
        <div className="lesson-title-row sing-title-row">
          <h3>Functional Ear Training</h3>
          <div className="trainer-detected-note sing-title-detected">
            <span>Detected: </span>
            <strong>{detectedPitch.note}</strong>
          </div>
        </div>
        {isDebug ? (
          <DetectorLogDebugControls
            detectorLogSummary={detectorLogSummary}
            clearDetectorLog={clearDetectorLog}
            getDetectorLogRows={getDetectorLogRows}
            filePrefix="ear-trainer"
          />
        ) : null}
        <p className="ear-page-subtitle">Choose an exercise, then sing what you hear and match each target note.</p>

        <div className="ear-controls-layout">
          <section className="ear-controls-section">
            <h4 className="ear-controls-title">Exercise Setup</h4>

            <label className="ear-inline-field">
            <span>Key</span>
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              disabled={isPlaying}
            >
              {KEY_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>

            <label className="ear-inline-field">
            <span>{isPatternMode ? 'Start octave' : 'Octave'}</span>
            <select
              value={singOctave}
              onChange={(e) => setSingOctave(Number(e.target.value))}
              disabled={isPlaying}
            >
              {[2, 3, 4, 5].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>

            <label className="ear-inline-field">
            <span>Exercise</span>
            <select
              value={exerciseMode}
              onChange={(e) => setExerciseMode(e.target.value)}
              disabled={isPlaying}
            >
              {EAR_EXERCISE_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

            {isPatternMode && (
              <>
                <label className="ear-inline-field">
                <span>Pattern type</span>
                <select
                  value={patternType}
                  onChange={(e) => setPatternType(e.target.value)}
                  disabled={isPlaying}
                >
                  {EAR_PATTERN_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

                {isRandomPatternType && (
                  <>
                    <label className="ear-inline-field">
                    <span>Pattern notes</span>
                    <select
                      value={patternNoteCount}
                      onChange={(e) => setPatternNoteCount(Number(e.target.value))}
                      disabled={isPlaying}
                    >
                      {PATTERN_NOTE_COUNT_OPTIONS.map((count) => (
                        <option key={count} value={count}>{count}</option>
                      ))}
                    </select>
                  </label>

                    <label className="ear-checkbox-field">
                      <input
                        type="checkbox"
                        checked={limitPatternToStartingOctave}
                        onChange={(e) => setLimitPatternToStartingOctave(e.target.checked)}
                        disabled={isPlaying}
                      />
                      {' '}Within starting octave
                    </label>
                  </>
                )}
              </>
            )}
          </section>

          <section className="ear-controls-section">
            <h4 className="ear-controls-title">Session Options</h4>

            <label className="ear-tempo-field">
            Tempo&nbsp;{tempoBpm}&nbsp;bpm
            <input
              type="range"
              min={TEMPO_BPM_MIN}
              max={TEMPO_BPM_MAX}
              value={tempoBpm}
              onChange={(e) => setTempoBpm(Number(e.target.value))}
              disabled={isPlaying}
              style={{ verticalAlign: 'middle' }}
            />
          </label>

            <label className="ear-tempo-field">
            Tolerance&nbsp;{toleranceCents}¢
            <input
              type="range"
              min={TOLERANCE_CENTS_MIN}
              max={TOLERANCE_CENTS_MAX}
              step={TOLERANCE_CENTS_STEP}
              value={toleranceCents}
              onChange={(e) => setToleranceCents(Number(e.target.value))}
              disabled={isPlaying}
              style={{ verticalAlign: 'middle' }}
            />
          </label>

            <label className="ear-checkbox-field">
            <input
              type="checkbox"
              checked={playCadenceChords}
              onChange={(e) => setPlayCadenceChords(e.target.checked)}
              disabled={isPlaying}
            />
            {' '}Play chords
          </label>

            <label className="ear-checkbox-field">
            <input
              type="checkbox"
              checked={hideNoteName}
              onChange={(e) => setHideNoteName(e.target.checked)}
              disabled={isPlaying}
            />
            {' '}Hide note name
          </label>

            <label className="ear-checkbox-field">
            <input
              type="checkbox"
              checked={metronomeEnabled}
              onChange={(e) => setMetronomeEnabled(e.target.checked)}
              disabled={isPlaying}
            />
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
          {isIdle && (
            <button type="button" className="button" onClick={handleStart} disabled={!hasValidRoundForSettings}>▶ Start</button>
          )}
          {isDone && (
            <>
            </>
          )}
          <button type="button" className="button" onClick={handleNext} disabled={!isDone || !hasValidRoundForSettings}>Next ▶</button>
          <button type="button" className="button secondary" onClick={handleReplay} disabled={!activeRound}>↺ Replay</button>
          <button type="button" className="button secondary" onClick={handleStop} disabled={!activeRound}>■ Stop</button>
          <Link className="button secondary home-icon-button" to="/" title="Home" aria-label="Home">⌂</Link>
        </div>

        {rangeHint && (
          <div className="ear-range-hint">
            {rangeHint}
          </div>
        )}

        {/* Current round display */}
        {activeRound && (
          <div className="ear-round-display">
            <div className="ear-round-name" style={{ color: degreeDisplayColor }}>
              {hideNoteName && !revealed ? '?' : activeRound.displayName}
            </div>
            <div className="ear-round-detail">
              {hideNoteName && !revealed ? '' : directionLabel}
            </div>
            {lastResult && (
              <div className="ear-round-result" style={{ color: resultColor }}>
                {lastResult === 'correct' ? '✓ Matched' : '✗ Missed'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Pitch graph ── */}
      <div
        className="card controls trainer-input-panel ear-graph-card"
        style={graphHidden ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}
      >
        <div className="input-header">
          <h3>Pitch</h3>
        </div>
        <SingInputGraphV2
          minFrequencyHz={55}
          maxFrequencyHz={1200}
          toleranceCents={toleranceCents}
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

      {/* ── Spaced-rep stats ── */}
      {isSingleTonicMode && <div className="card controls ear-progress-panel">
        <div className="ear-progress-head">
          <h3>Progress</h3>
          <button
            type="button"
            className="button secondary ear-reset-button"
            onClick={resetHistory}
            disabled={isPlaying}
            title="Reset all history"
          >
            Reset
          </button>
        </div>
        <div className="ear-progress-grid">
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
                className={`ear-progress-card${isActive ? ' ear-progress-card-active' : ''}`}
              >
                <div className="ear-progress-name">{deg.name}</div>
                <div className="ear-progress-label">{deg.label}</div>
                {attempts > 0 ? (
                  <>
                    <div className="ear-progress-rate" style={{ color: getScoreColor(rate) }}>
                      {Math.round(rate * 100)}%
                    </div>
                    <div className="ear-progress-ratio">{successes}/{attempts}</div>
                    {/* Mini progress bar */}
                    <div className="ear-progress-bar-track">
                      <div className="ear-progress-bar-fill" style={{ width: `${Math.round(rate * 100)}%`, background: barColor }} />
                    </div>
                  </>
                ) : (
                  <div className="ear-progress-untried">untried</div>
                )}
              </div>
            );
          })}
        </div>
      </div>}

    </div>
  );
}

