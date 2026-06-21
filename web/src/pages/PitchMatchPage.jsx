import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadPitchSettings } from '../lib/pitchSettings';
import { loadPitchRangeSettings } from '../lib/pitchRangeSettings';
import { loadPitchMatchSettings, savePitchMatchSettings } from '../lib/pitchMatchSettings';
import { usePitchDetector } from '../lib/usePitchDetector';
import {
  SEMITONES_PER_OCTAVE,
  DIATONIC_SCALE_SEMITONES,
  DIATONIC_SOLFEGE_NAMES,
  NATURAL_KEY_OPTIONS,
  keyToSemitone,
  midiToFrequencyHz,
  midiToNoteLabel,
  nearestMidiByOctave,
  normalizeDetectedMidiForTarget,
} from '../lib/musicTheory';
import { INSTRUMENT_OPTIONS, getPianoAudioContext, loadInstrument, playBing, playBuzz, playPianoNoteNow, scheduleReferenceTone, stopAllNotes } from '../lib/pianoSynth';

// ── Constants ──────────────────────────────────────────────────────────────────
const DEFAULT_NOTE_COUNT      = 5;
const DEFAULT_TOLERANCE_CENTS = 50;
const DEFAULT_TONE_DURATION_S = 1.2; // how long the played note sounds
const HOLD_READINGS_NEEDED    = 8;   // ~400 ms at 50 ms poll
const WRONG_HOLD_READINGS     = 4;   // ~200 ms of sustained wrong pitch = 1 strike
const MAX_STRIKES             = 2;   // strikes before marking wrong
const NOTE_TIMEOUT_MS         = 7000;
const DELAY_MODE_EXTRA_TIMEOUT_MS = 3000;
const DELAY_MODE_CENTERING_GRACE_MS = 2000;
const FEEDBACK_LINGER_MS      = 800;
const DIRECTION_EPSILON_CENTS = 5;
const AB_COMPARE_NOTE_DURATION_S = 1.35;
const AB_COMPARE_GAP_S = 0.18;
const AB_COMPARE_TARGET_GAIN = 0.3;
const AB_COMPARE_SUNG_GAIN = 0.38;
const AB_COMPARE_RECORDED_GAIN = 1.35;
const AB_COMPARE_TARGET_BACKUP_GAIN = 0.08;
const RECORDING_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
const MIN_RECORDED_VOICED_MS = 1000;

const TARGET_TONE_GAIN = 0.18;

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function getListeningTimeoutMs(singDelayS) {
  const singDelayMs = Math.max(0, Math.round((Number(singDelayS) || 0) * 1000));
  if (singDelayMs <= 0) {
    return NOTE_TIMEOUT_MS;
  }
  return NOTE_TIMEOUT_MS + DELAY_MODE_EXTRA_TIMEOUT_MS + DELAY_MODE_CENTERING_GRACE_MS + singDelayMs;
}

function summarizeSungPitch(sungMidis, rawMidis, targetMidi, toleranceCents, wasCorrect) {
  if (!Array.isArray(sungMidis) || sungMidis.length === 0) {
    return {
      sungMidi: null,
      sungMidiRaw: null,
      sungNoteLabel: '—',
      sungNoteLabelRaw: '—',
      signedCents: null,
      direction: 'no-pitch',
    };
  }

  const normalizedMidis = sungMidis
    .map((midi) => nearestMidiByOctave(midi, targetMidi))
    .filter((midi) => Number.isFinite(midi));

  if (!normalizedMidis.length) {
    return {
      sungMidi: null,
      sungMidiRaw: null,
      sungNoteLabel: '—',
      sungNoteLabelRaw: '—',
      signedCents: null,
      direction: 'no-pitch',
    };
  }

  const rawMidiSamples = Array.isArray(rawMidis)
    ? rawMidis.filter((midi) => Number.isFinite(midi))
    : [];

  const offPitchMidis = normalizedMidis.filter((midi) => Math.abs(midi - targetMidi) * 100 > toleranceCents);
  let representativeMidis = normalizedMidis;
  if (!wasCorrect && offPitchMidis.length > 0) {
    const belowTargetMidis = offPitchMidis.filter((midi) => midi < targetMidi);
    const aboveTargetMidis = offPitchMidis.filter((midi) => midi > targetMidi);

    if (belowTargetMidis.length && aboveTargetMidis.length) {
      representativeMidis = belowTargetMidis.length >= aboveTargetMidis.length
        ? belowTargetMidis
        : aboveTargetMidis;
    } else {
      representativeMidis = offPitchMidis;
    }
  }
  const sungMidi = median(representativeMidis);
  const sungMidiRaw = median(rawMidiSamples);
  const signedCents = (sungMidi - targetMidi) * 100;
  const aboveCount = representativeMidis.filter((midi) => midi > targetMidi).length;
  const belowCount = representativeMidis.filter((midi) => midi < targetMidi).length;

  let direction = 'on-pitch';
  if (signedCents <= -DIRECTION_EPSILON_CENTS) direction = 'flat';
  else if (signedCents >= DIRECTION_EPSILON_CENTS) direction = 'sharp';
  else if (aboveCount !== belowCount) direction = aboveCount > belowCount ? 'sharp' : 'flat';

  return {
    sungMidi,
    sungMidiRaw,
    sungNoteLabel: midiToNoteLabel(sungMidiRaw ?? sungMidi),
    sungNoteLabelRaw: midiToNoteLabel(sungMidiRaw),
    signedCents,
    direction,
  };
}

function getSupportedRecordingMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  return RECORDING_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? '';
}

async function decodeRecordedBlob(audioCtx, blob) {
  if (!(blob instanceof Blob) || blob.size === 0) {
    return null;
  }

  const encoded = await blob.arrayBuffer();
  return audioCtx.decodeAudioData(encoded.slice(0));
}

function scheduleDecodedRecording(audioCtx, audioBuffer, startAt, peakGain = AB_COMPARE_RECORDED_GAIN) {
  if (!audioBuffer) {
    return null;
  }

  const source = audioCtx.createBufferSource();
  const gainNode = audioCtx.createGain();
  source.buffer = audioBuffer;
  gainNode.gain.setValueAtTime(Math.max(0.01, Number(peakGain) || AB_COMPARE_RECORDED_GAIN), startAt);
  source.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  let stopped = false;
  const cleanup = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    source.onended = null;
    try {
      source.disconnect();
      gainNode.disconnect();
    } catch {
      // ignore disconnect races
    }
  };

  source.onended = cleanup;
  source.start(startAt);

  return () => {
    if (stopped) {
      return;
    }
    try {
      source.stop();
    } catch {
      // ignore stop races
    }
    cleanup();
  };
}

// ── Note generation ────────────────────────────────────────────────────────────
function generateDiatonicCandidates(selectedKey, minMidi, maxMidi) {
  const tonicSemitone = keyToSemitone(selectedKey);
  const candidates = [];
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    const semitone = ((midi - tonicSemitone) % SEMITONES_PER_OCTAVE + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;
    const degreeIdx = DIATONIC_SCALE_SEMITONES.indexOf(semitone);
    if (degreeIdx !== -1) {
      candidates.push({ midi, solfege: DIATONIC_SOLFEGE_NAMES[degreeIdx], noteLabel: midiToNoteLabel(midi) });
    }
  }
  return candidates;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildExercise(selectedKey, noteCount, minMidi, maxMidi) {
  const candidates = generateDiatonicCandidates(selectedKey, minMidi, maxMidi);
  if (candidates.length === 0) return [];
  const shuffled = shuffleArray(candidates);
  // Allow repeats if noteCount > candidates.length
  const exercise = [];
  for (let i = 0; i < noteCount; i++) {
    exercise.push(shuffled[i % shuffled.length]);
  }
  return exercise;
}

// ── Component ──────────────────────────────────────────────────────────────────
export function PitchMatchPage() {
  const pitchSettings   = useMemo(() => loadPitchSettings(), []);
  const pitchRange      = useMemo(() => loadPitchRangeSettings(), []);
  const hasPitchRange   = Number.isFinite(pitchRange.minMidi) && Number.isFinite(pitchRange.maxMidi);

  const savedPitchMatch = useMemo(() => loadPitchMatchSettings(), []);

  const [selectedKey, setSelectedKey]         = useState(savedPitchMatch.selectedKey);
  const [selectedInstrument, setSelectedInstrument] = useState(savedPitchMatch.selectedInstrument);
  const [noteCount, setNoteCount]             = useState(savedPitchMatch.noteCount);
  const [toleranceCents, setToleranceCents]   = useState(savedPitchMatch.toleranceCents);
  const [toneDurationS, setToneDurationS]     = useState(savedPitchMatch.toneDurationS);
  const [singDelayS, setSingDelayS]           = useState(savedPitchMatch.singDelayS);
  const [exercise, setExercise]               = useState([]);
  const [noteIndex, setNoteIndex]             = useState(0);
  const [score, setScore]                     = useState({ correct: 0, total: 0 });
  const [results, setResults]                 = useState([]); // 'correct' | 'wrong' | null
  const [attempts, setAttempts]               = useState([]);
  const [phase, setPhase]                     = useState('setup'); // setup | playing_tone | delay | listening | feedback | done
  const [feedback, setFeedback]               = useState(null); // 'correct' | 'wrong'
  const [delayRemainingMs, setDelayRemainingMs] = useState(0);
  const [centeringRemainingMs, setCenteringRemainingMs] = useState(0);

  const holdCountRef  = useRef(0);
  const wrongHoldRef  = useRef(0);
  const strikeRef     = useRef(0);
  const resolvingNoteRef = useRef(false);
  const timeoutRef    = useRef(null);
  const sungMidisRef  = useRef([]);
  const sungRawMidisRef = useRef([]);
  const recordingRecorderRef = useRef(null);
  const recordingStartedAtRef = useRef(null);
  const recordingFirstVoicedAtRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const delayCountdownIntervalRef = useRef(null);
  const centeringCountdownIntervalRef = useRef(null);
  const comparePlaybackTimerRef = useRef(null);
  const compareRecordedStopRef = useRef(null);

  const [strikes, setStrikes] = useState(0);

  const { current, stream } = usePitchDetector(pitchSettings, true);

  // ── Derived ────────────────────────────────────────────────────────────────
  const minMidi    = hasPitchRange ? pitchRange.minMidi : 48; // C3 default
  const maxMidi    = hasPitchRange ? pitchRange.maxMidi : 72; // C5 default
  const targetNote = exercise[noteIndex] ?? null;

  const clearDelayCountdown = useCallback(() => {
    if (delayCountdownIntervalRef.current) {
      clearInterval(delayCountdownIntervalRef.current);
      delayCountdownIntervalRef.current = null;
    }
    setDelayRemainingMs(0);
  }, []);

  const clearCenteringCountdown = useCallback(() => {
    if (centeringCountdownIntervalRef.current) {
      clearInterval(centeringCountdownIntervalRef.current);
      centeringCountdownIntervalRef.current = null;
    }
    setCenteringRemainingMs(0);
  }, []);

  const stopRecordedComparePlayback = useCallback(() => {
    if (comparePlaybackTimerRef.current) {
      clearTimeout(comparePlaybackTimerRef.current);
      comparePlaybackTimerRef.current = null;
    }
    try {
      compareRecordedStopRef.current?.();
    } catch {
      // ignore stop races
    }
    compareRecordedStopRef.current = null;
  }, []);

  const beginListeningPhase = useCallback(() => {
    clearDelayCountdown();
    setPhase('listening');
    clearCenteringCountdown();
    if (singDelayS > 0) {
      const centeringEndsAtMs = Date.now() + DELAY_MODE_CENTERING_GRACE_MS;
      setCenteringRemainingMs(DELAY_MODE_CENTERING_GRACE_MS);
      centeringCountdownIntervalRef.current = setInterval(() => {
        setCenteringRemainingMs(Math.max(0, centeringEndsAtMs - Date.now()));
      }, 100);
    }
    startTimeout();
  }, [clearDelayCountdown, clearCenteringCountdown, singDelayS]);

  const scheduleListeningStart = useCallback((playbackDelayMs) => {
    clearTimeout(timeoutRef.current);
    clearDelayCountdown();
    clearCenteringCountdown();

    timeoutRef.current = setTimeout(() => {
      const singDelayMs = Math.max(0, Math.round((Number(singDelayS) || 0) * 1000));
      if (singDelayMs <= 0) {
        beginListeningPhase();
        return;
      }

      const delayEndsAtMs = Date.now() + singDelayMs;
      setPhase('delay');
      setDelayRemainingMs(singDelayMs);
      delayCountdownIntervalRef.current = setInterval(() => {
        setDelayRemainingMs(Math.max(0, delayEndsAtMs - Date.now()));
      }, 100);

      timeoutRef.current = setTimeout(() => {
        beginListeningPhase();
      }, singDelayMs);
    }, playbackDelayMs);
  }, [beginListeningPhase, clearCenteringCountdown, clearDelayCountdown, singDelayS]);

  // ── Advance to next note ───────────────────────────────────────────────────
  const stopCurrentRecording = useCallback(async ({ enforceMinDuration = false } = {}) => {
    const recorder = recordingRecorderRef.current;
    if (!recorder) {
      recordingChunksRef.current = [];
      recordingStartedAtRef.current = null;
      recordingFirstVoicedAtRef.current = null;
      return null;
    }

    const minDurationAnchorMs = Number.isFinite(recordingFirstVoicedAtRef.current)
      ? recordingFirstVoicedAtRef.current
      : recordingStartedAtRef.current;

    if (enforceMinDuration && Number.isFinite(minDurationAnchorMs)) {
      const elapsedMs = performance.now() - minDurationAnchorMs;
      const remainingMs = Math.max(0, MIN_RECORDED_VOICED_MS - elapsedMs);
      if (remainingMs > 0) {
        await new Promise((resolve) => {
          globalThis.setTimeout(resolve, remainingMs);
        });
      }
    }

    recordingRecorderRef.current = null;
    recordingStartedAtRef.current = null;
    recordingFirstVoicedAtRef.current = null;

    const recordingBlob = await new Promise((resolve) => {
      const handleStop = () => {
        recorder.removeEventListener('stop', handleStop);
        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];
        if (!chunks.length) {
          resolve(null);
          return;
        }
        const mimeType = recorder.mimeType || getSupportedRecordingMimeType() || 'audio/webm';
        resolve(new Blob(chunks, { type: mimeType }));
      };

      recorder.addEventListener('stop', handleStop, { once: true });
      if (recorder.state === 'inactive') {
        handleStop();
        return;
      }

      try {
        if (typeof recorder.requestData === 'function') {
          recorder.requestData();
        }
        recorder.stop();
      } catch {
        handleStop();
      }
    });

    return recordingBlob;
  }, []);

  const startCurrentRecording = useCallback(() => {
    if (!stream || typeof MediaRecorder === 'undefined') {
      return;
    }

    if (recordingRecorderRef.current?.state === 'recording') {
      return;
    }

    recordingChunksRef.current = [];
    const mimeType = getSupportedRecordingMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordingChunksRef.current.push(event.data);
      }
    };
    recorder.onerror = () => {
      recordingChunksRef.current = [];
      recordingRecorderRef.current = null;
      recordingStartedAtRef.current = null;
      recordingFirstVoicedAtRef.current = null;
    };
    recorder.start();
    recordingRecorderRef.current = recorder;
    recordingStartedAtRef.current = performance.now();
    recordingFirstVoicedAtRef.current = null;
  }, [stream]);

  const advanceNote = useCallback(async (wasCorrect) => {
    if (resolvingNoteRef.current) {
      return;
    }
    resolvingNoteRef.current = true;
    clearTimeout(timeoutRef.current);
    const currentTarget = exercise[noteIndex] ?? null;
    const sungRecording = await stopCurrentRecording({ enforceMinDuration: true });
    const sungSummary = currentTarget
      ? summarizeSungPitch(sungMidisRef.current, sungRawMidisRef.current, currentTarget.midi, toleranceCents, wasCorrect)
      : null;

    if (currentTarget && sungSummary) {
      setAttempts((previous) => {
        const updated = [...previous];
        updated[noteIndex] = {
          index: noteIndex,
          result: wasCorrect ? 'correct' : 'wrong',
          targetMidi: currentTarget.midi,
          targetNoteLabel: currentTarget.noteLabel,
          solfege: currentTarget.solfege,
          sungRecording,
          ...sungSummary,
        };
        return updated;
      });
    }

    sungMidisRef.current = [];
    sungRawMidisRef.current = [];
    holdCountRef.current  = 0;
    wrongHoldRef.current  = 0;
    strikeRef.current     = 0;
    setStrikes(0);

    const resultLabel = wasCorrect ? 'correct' : 'wrong';

    setScore((s) => ({
      correct: s.correct + (wasCorrect ? 1 : 0),
      total:   s.total + 1,
    }));
    setResults((r) => {
      const updated = [...r];
      updated[noteIndex] = resultLabel;
      return updated;
    });
    setFeedback(resultLabel);
    setPhase('feedback');

    // After linger, move on
    timeoutRef.current = setTimeout(() => {
      resolvingNoteRef.current = false;
      clearDelayCountdown();
      clearCenteringCountdown();
      setFeedback(null);
      const next = noteIndex + 1;
      if (next >= exercise.length) {
        setPhase('done');
      } else {
        setNoteIndex(next);
        setPhase('playing_tone');
        const delayMs = playPianoNoteNow(exercise[next].midi, toneDurationS, TARGET_TONE_GAIN);
        scheduleListeningStart(delayMs);
      }
    }, FEEDBACK_LINGER_MS);
  }, [noteIndex, exercise, toneDurationS, toleranceCents, stopCurrentRecording, clearCenteringCountdown, clearDelayCountdown, scheduleListeningStart]); // eslint-disable-line react-hooks/exhaustive-deps

  function startTimeout() {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      playBuzz();
      void advanceNote(false);
    }, getListeningTimeoutMs(singDelayS));
  }

  // ── Start / restart exercise ───────────────────────────────────────────────
  async function startExercise() {
    clearTimeout(timeoutRef.current);
    resolvingNoteRef.current = false;
    await stopCurrentRecording();
    clearDelayCountdown();
    clearCenteringCountdown();
    stopRecordedComparePlayback();
    holdCountRef.current  = 0;
    wrongHoldRef.current  = 0;
    strikeRef.current     = 0;
    setStrikes(0);
    const ex = buildExercise(selectedKey, noteCount, minMidi, maxMidi);
    setExercise(ex);
    setNoteIndex(0);
    setScore({ correct: 0, total: 0 });
    setResults(new Array(ex.length).fill(null));
    setAttempts(new Array(ex.length).fill(null));
    setFeedback(null);
    sungMidisRef.current = [];
    sungRawMidisRef.current = [];

    if (ex.length === 0) {
      setPhase('setup');
      return;
    }

    setPhase('playing_tone');
    const delayMs = playPianoNoteNow(ex[0].midi, toneDurationS, TARGET_TONE_GAIN);
    scheduleListeningStart(delayMs);
  }

  // ── Replay only wrong notes ────────────────────────────────────────────────
  async function replayWrongNotes() {
    const wrongNotes = exercise.filter((_, i) => results[i] === 'wrong');
    if (wrongNotes.length === 0) return;
    clearTimeout(timeoutRef.current);
    resolvingNoteRef.current = false;
    await stopCurrentRecording();
    clearDelayCountdown();
    clearCenteringCountdown();
    stopRecordedComparePlayback();
    holdCountRef.current = 0;
    wrongHoldRef.current = 0;
    strikeRef.current    = 0;
    setStrikes(0);
    setExercise(wrongNotes);
    setNoteIndex(0);
    setScore({ correct: 0, total: 0 });
    setResults(new Array(wrongNotes.length).fill(null));
    setAttempts(new Array(wrongNotes.length).fill(null));
    setFeedback(null);
    sungMidisRef.current = [];
    sungRawMidisRef.current = [];
    setPhase('playing_tone');
    const delayMs = playPianoNoteNow(wrongNotes[0].midi, toneDurationS, TARGET_TONE_GAIN);
    scheduleListeningStart(delayMs);
  }

  // ── Play current note again ────────────────────────────────────────────────
  async function replayCurrentNote() {
    if (!targetNote) return;
    clearTimeout(timeoutRef.current);
    resolvingNoteRef.current = false;
    await stopCurrentRecording();
    clearDelayCountdown();
    clearCenteringCountdown();
    stopRecordedComparePlayback();
    sungMidisRef.current = [];
    sungRawMidisRef.current = [];
    holdCountRef.current  = 0;
    wrongHoldRef.current  = 0;
    strikeRef.current     = 0;
    setStrikes(0);
    setPhase('playing_tone');
    const delayMs = playPianoNoteNow(targetNote.midi, toneDurationS, TARGET_TONE_GAIN);
    scheduleListeningStart(delayMs);
  }

  useEffect(() => {
    if (phase !== 'listening' || resolvingNoteRef.current) {
      return () => undefined;
    }

    startCurrentRecording();
    return () => {
      void stopCurrentRecording();
    };
  }, [phase, startCurrentRecording, stopCurrentRecording]);

  // ── Pitch matching tick ────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'listening' || !targetNote || resolvingNoteRef.current) {
      holdCountRef.current = 0;
      wrongHoldRef.current = 0;
      return;
    }
    if (!Number.isFinite(current?.midi)) {
      // Silence — reset both hold counters; strikes persist so user can't
      // just stay silent to avoid them.
      holdCountRef.current = 0;
      wrongHoldRef.current = 0;
      return;
    }

    const detectedMidiNearTarget = normalizeDetectedMidiForTarget(current.midi, current.pitchHz, targetNote.midi);
    if (!Number.isFinite(recordingFirstVoicedAtRef.current)) {
      recordingFirstVoicedAtRef.current = performance.now();
    }
    sungMidisRef.current = [...sungMidisRef.current, detectedMidiNearTarget].slice(-64);
    sungRawMidisRef.current = [...sungRawMidisRef.current, current.midi].slice(-64);

    const centsOff = Math.abs(detectedMidiNearTarget - targetNote.midi) * 100;
    if (centsOff <= toleranceCents) {
      // On-pitch: reset wrong hold, accumulate correct hold.
      wrongHoldRef.current = 0;
      holdCountRef.current += 1;
      if (holdCountRef.current >= HOLD_READINGS_NEEDED) {
        holdCountRef.current = 0;
        clearTimeout(timeoutRef.current);
        playBing();
        advanceNote(true);
      }
    } else {
      if (centeringRemainingMs > 0) {
        holdCountRef.current = 0;
        wrongHoldRef.current = 0;
        return;
      }
      // Off-pitch: reset correct hold, accumulate wrong hold.
      holdCountRef.current = 0;
      wrongHoldRef.current += 1;
      if (wrongHoldRef.current >= WRONG_HOLD_READINGS) {
        wrongHoldRef.current = 0;
        const newStrikes = strikeRef.current + 1;
        strikeRef.current = newStrikes;
        setStrikes(newStrikes);
        if (newStrikes >= MAX_STRIKES) {
          clearTimeout(timeoutRef.current);
          playBuzz();
          advanceNote(false);
        }
      }
    }
  }, [current, phase, targetNote, toleranceCents, centeringRemainingMs, advanceNote]);

  // ── Persist settings on change ──────────────────────────────────────────────
  useEffect(() => {
    savePitchMatchSettings({ selectedKey, selectedInstrument, noteCount, toleranceCents, toneDurationS, singDelayS });
  }, [selectedKey, selectedInstrument, noteCount, toleranceCents, toneDurationS, singDelayS]);

  useEffect(() => {
    void loadInstrument(selectedInstrument);
  }, [selectedInstrument]);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    clearTimeout(timeoutRef.current);
    clearDelayCountdown();
    clearCenteringCountdown();
    stopRecordedComparePlayback();
  }, [clearCenteringCountdown, clearDelayCountdown, stopRecordedComparePlayback]);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const holdProgress = Math.min(holdCountRef.current / HOLD_READINGS_NEEDED, 1);
  const delayRemainingSeconds = Math.max(0, delayRemainingMs / 1000);
  const centeringRemainingSeconds = Math.max(0, centeringRemainingMs / 1000);

  const detectedDisplay = Number.isFinite(current?.midi) ? current.note : '—';
  const wrongAttempts = attempts.filter((attempt) => attempt?.result === 'wrong');

  async function playAttemptComparison(attempt) {
    if (!attempt || !Number.isFinite(attempt.targetMidi)) return;
    stopAllNotes();
    stopRecordedComparePlayback();
    const targetCompareMidi = attempt.targetMidi;
    const secondDelayMs = Math.max(0, Math.round((AB_COMPARE_NOTE_DURATION_S + AB_COMPARE_GAP_S) * 1000));
    const audioCtx = getPianoAudioContext();
    playPianoNoteNow(targetCompareMidi, AB_COMPARE_NOTE_DURATION_S, AB_COMPARE_TARGET_GAIN);

    const startAt = audioCtx.currentTime + 0.02;
    scheduleReferenceTone(
      audioCtx,
      midiToFrequencyHz(targetCompareMidi),
      startAt,
      AB_COMPARE_NOTE_DURATION_S,
      AB_COMPARE_TARGET_BACKUP_GAIN,
    );

    const recordedBufferPromise = attempt.sungRecording instanceof Blob && attempt.sungRecording.size > 0
      ? decodeRecordedBlob(audioCtx, attempt.sungRecording).catch(() => null)
      : Promise.resolve(null);

    comparePlaybackTimerRef.current = globalThis.setTimeout(async () => {
      comparePlaybackTimerRef.current = null;

      const recordedBuffer = await recordedBufferPromise;
      if (recordedBuffer) {
        compareRecordedStopRef.current = scheduleDecodedRecording(audioCtx, recordedBuffer, audioCtx.currentTime + 0.01);
        return;
      }

      const sungMidi = Number.isFinite(attempt.sungMidiRaw) ? attempt.sungMidiRaw : attempt.sungMidi;
      if (!Number.isFinite(sungMidi)) return;
      const sungCompareMidi = sungMidi;
      scheduleReferenceTone(
        audioCtx,
        midiToFrequencyHz(sungCompareMidi),
        audioCtx.currentTime + 0.01,
        AB_COMPARE_NOTE_DURATION_S,
        AB_COMPARE_SUNG_GAIN,
      );
    }, secondDelayMs);
  }

  const phaseLabel = {
    setup:        'Configure and start',
    playing_tone: 'Listen...',
    delay:        `Wait... sing in ${delayRemainingSeconds.toFixed(1)}s`,
    listening:    centeringRemainingMs > 0 ? `Center on the note... ${centeringRemainingSeconds.toFixed(1)}s` : 'Sing the note ↑',
    feedback:     feedback === 'correct' ? '✓ Correct!' : '✗ Miss',
    done:         'Exercise complete',
  }[phase] ?? '';

  // ── JSX ────────────────────────────────────────────────────────────────────
  return (
    <div className="pitch-match-page">

      {/* ── Options card ── */}
      <div className="card controls pitch-match-options">
        <h3 style={{ margin: '0 0 8px' }}>Pitch Match</h3>

        {!hasPitchRange && (
          <p className="pitch-match-warning">
            No vocal range saved. Visit the <a href="/pitch-range">Vocal Range</a> page first for accurate note selection.
          </p>
        )}

        <div className="pitch-match-options-row">
          <label className="pitch-match-label">
            {'Key '}
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className="pitch-match-select"
              disabled={phase !== 'setup' && phase !== 'done'}
            >
              {NATURAL_KEY_OPTIONS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>

          <label className="pitch-match-label">
            {'Instrument '}
            <select
              value={selectedInstrument}
              onChange={(e) => setSelectedInstrument(e.target.value)}
              className="pitch-match-select"
              disabled={phase !== 'setup' && phase !== 'done'}
            >
              {INSTRUMENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="pitch-match-label">
            Notes: {noteCount}
            <input
              type="range"
              min={1}
              max={10}
              value={noteCount}
              onChange={(e) => setNoteCount(Number(e.target.value))}
              disabled={phase !== 'setup' && phase !== 'done'}
              style={{ width: 100 }}
            />
          </label>

          <label className="pitch-match-label">
            Tolerance: {toleranceCents}¢
            <input
              type="range"
              min={20}
              max={100}
              step={5}
              value={toleranceCents}
              onChange={(e) => setToleranceCents(Number(e.target.value))}
              style={{ width: 100 }}
            />
          </label>

          <label className="pitch-match-label">
            Note length: {toneDurationS.toFixed(1)}s
            <input
              type="range"
              min={3}
              max={30}
              step={1}
              value={Math.round(toneDurationS * 10)}
              onChange={(e) => setToneDurationS(Number(e.target.value) / 10)}
              style={{ width: 100 }}
            />
          </label>

          <label className="pitch-match-label">
            Sing delay: {singDelayS.toFixed(1)}s
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(singDelayS * 10)}
              onChange={(e) => setSingDelayS(Number(e.target.value) / 10)}
              disabled={phase !== 'setup' && phase !== 'done'}
              style={{ width: 100 }}
            />
          </label>

          <button type="button" className="button" onClick={startExercise}>
            {phase === 'setup' ? 'Start' : 'Restart'}
          </button>
        </div>
      </div>

      {/* ── Active exercise panel ── */}
      {phase !== 'setup' && (
        <div className="card pitch-match-panel">

          {/* Progress chips */}
          <div className="note-chips-row">
            {exercise.map((n, i) => {
              const res = results[i];
              const isCurrent = i === noteIndex;
              let chipClass = 'note-chip';
              if (res === 'correct') chipClass += ' correct';
              else if (res === 'wrong') chipClass += ' wrong';
              else if (isCurrent) chipClass += ' active';
              return (
                <span key={`${i}-${n.midi}`} className={chipClass}>
                  {n.solfege}
                </span>
              );
            })}
          </div>

          {/* Phase label */}
          <div
            className={`pitch-match-phase-label ${feedback === 'correct' ? 'phase-correct' : ''} ${feedback === 'wrong' ? 'phase-wrong' : ''}`}
          >
            {phaseLabel}
          </div>

          {/* Target note display */}
          {targetNote && phase !== 'done' && (
            <div className="pitch-match-target">
              <span className="target-solfege">{targetNote.solfege}</span>
              <span className="target-note-label">{targetNote.noteLabel}</span>
              <div className="strike-dots" aria-label={`${strikes} of ${MAX_STRIKES} strikes`}>
                {Array.from({ length: MAX_STRIKES }, (_, i) => (
                  <span key={i} className={`strike-dot ${i < strikes ? 'strike-dot--used' : ''}`}>●</span>
                ))}
              </div>
              <button type="button" className="button secondary" onClick={replayCurrentNote} disabled={phase === 'playing_tone' || phase === 'delay'}>
                ♩ Replay
              </button>
            </div>
          )}

          {/* Detected pitch */}
          <div className="pitch-match-detected">
            <span className="detected-label">You:</span>
            <span className="detected-note">{detectedDisplay}</span>
          </div>

          {/* Hold progress bar */}
          {phase === 'listening' && (
            <div className="hold-progress-track">
              <div
                className="hold-progress-fill"
                style={{ width: `${holdProgress * 100}%` }}
              />
            </div>
          )}

          {/* Final score */}
          {phase === 'done' && (
            <div className="pitch-match-final-score">
              <div>Score: {score.correct} / {exercise.length}</div>
              {results.includes('wrong') && (
                <button
                  type="button"
                  className="button secondary"
                  style={{ marginTop: 10 }}
                  onClick={replayWrongNotes}
                >
                  ↺ Replay wrong notes ({results.filter((r) => r === 'wrong').length})
                </button>
              )}

              {wrongAttempts.length > 0 && (
                <div className="pitch-match-results-table-wrap">
                  <table className="pitch-match-results-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Target</th>
                        <th>You sang</th>
                        <th>Offset</th>
                        <th>Result</th>
                        <th>Compare</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wrongAttempts.map((attempt) => {
                        const centsAbs = Number.isFinite(attempt.signedCents)
                          ? Math.abs(Math.round(attempt.signedCents))
                          : null;
                        let offsetText = '0¢';
                        if (attempt.direction === 'flat') {
                          offsetText = `${centsAbs ?? '—'}¢ flat`;
                        } else if (attempt.direction === 'sharp') {
                          offsetText = `${centsAbs ?? '—'}¢ sharp`;
                        } else if (attempt.direction === 'no-pitch') {
                          offsetText = 'No pitch';
                        }

                        return (
                          <tr key={`${attempt.index}-${attempt.targetMidi}`}>
                            <td>{attempt.index + 1}</td>
                            <td>{attempt.solfege} ({attempt.targetNoteLabel})</td>
                            <td>{attempt.sungRecording ? 'Voice clip' : (attempt.sungNoteLabelRaw ?? attempt.sungNoteLabel)}</td>
                            <td>{offsetText}</td>
                            <td className={`pitch-match-result-${attempt.result}`}>
                              {attempt.result === 'correct' ? '✓' : '✗'}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="button secondary pitch-match-compare-btn"
                                onClick={() => playAttemptComparison(attempt)}
                                disabled={!(attempt.sungRecording instanceof Blob && attempt.sungRecording.size > 0) && !Number.isFinite(attempt.sungMidi)}
                                title={attempt.sungRecording ? 'Plays target first, then your recorded voice' : 'Plays target first, then your sung pitch'}
                              >
                                ▶ A/B
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}