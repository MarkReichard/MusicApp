import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getLessonById } from '../lib/lessons';
import { loadPitchSettings } from '../lib/pitchSettings';
import { loadPitchRangeSettings } from '../lib/pitchRangeSettings';
import { recommendKeyAndOctaveForRange } from '../lib/pitchRangeRecommendation';
import { getTrainerOptionsForLesson, saveTrainerOptionsSettings } from '../lib/trainerOptionsSettings';
import { useStablePitchTracker } from '../lib/useStablePitchTracker';
import { SingInputGraphV2 } from '../components/trainer/SingInputGraphV2';
import { SingTrainingOptionsSection } from '../components/trainer/SingTrainingOptionsSection';
import { ChordBar } from '../components/trainer/ChordBar';
import { useChordPlayer } from '../lib/useChordPlayer';
import {
  tonicMidiFromKeyOctave,
  midiToFrequencyHz,
  midiToNoteLabel,
  SEMITONES_PER_OCTAVE,
  CADENCE_CHORD_OFFSETS,
  TRIAD_INTERVALS,
  beatSecondsFromTempo,
  NOTE_DURATION_SCALE,
  MIN_NOTE_DURATION_SECONDS,
  AUDIO_START_OFFSET_SECONDS,
  NOTE_GAP_SECONDS,
  PLAYBACK_BUFFER_MS,
  CADENCE_CHORD_GAIN,
  TARGET_NOTE_GAIN,
  SING_COUNTDOWN_BEATS,
} from '../lib/musicTheory';
import { buildSections, buildSingTimeline, isBarMatched, applyBarEvaluation, getLessonDefaults, computeTransposition, shiftNotes, getRangeSuggestionText, isSongLesson } from '../lib/lessonUtils';
import { schedulePianoNote, loadInstrument, getPianoAudioContext } from '../lib/pianoSynth';

const SING_GUIDE_NOTE_GAIN = 0.08;

export function SingTrainerV2Page() {
  const { lessonId } = useParams();
  const [searchParams] = useSearchParams();
  const lesson = useMemo(() => getLessonById(lessonId), [lessonId]);
  const isSong = isSongLesson(lesson);
  const pitchSettings = useMemo(() => loadPitchSettings(), []);
  const savedPitchRange = useMemo(() => loadPitchRangeSettings(), []);
  const hasSavedPitchRange = Number.isFinite(savedPitchRange.minMidi) && Number.isFinite(savedPitchRange.maxMidi);
  const rangeRecommendation = useMemo(
    () => recommendKeyAndOctaveForRange({
      lesson,
      userMinMidi: savedPitchRange.minMidi,
      userMaxMidi: savedPitchRange.maxMidi,
    }),
    [lesson, savedPitchRange.maxMidi, savedPitchRange.minMidi],
  );
  const initialOptions = useMemo(() => getTrainerOptionsForLesson(lesson), [lesson]);
  const [selectedKey, setSelectedKey] = useState(initialOptions.selectedKey);
  const [tempoBpm, setTempoBpm] = useState(initialOptions.tempoBpm);
  const [playTonicCadence, setPlayTonicCadence] = useState(initialOptions.playTonicCadence);
  const [hearExerciseFirst, setHearExerciseFirst] = useState(initialOptions.hearExerciseFirst);
  const [singOctave, setSingOctave] = useState(initialOptions.singOctave);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [index, setIndex] = useState(0);
  const [correctIndices, setCorrectIndices] = useState([]);
  const [isPlayingTarget, setIsPlayingTarget] = useState(false);
  const [toleranceCents, setToleranceCents] = useState(initialOptions.toleranceCents);
  const [gracePeriodPercent, setGracePeriodPercent] = useState(initialOptions.gracePeriodPercent);
  const [instrument, setInstrument] = useState(initialOptions.instrument);
  const [measureWindowSize, setMeasureWindowSize] = useState(4);
  const sections = useMemo(() => buildSections(lesson, measureWindowSize), [lesson, measureWindowSize]);
  const sectionMeasures = sections[sectionIndex]?.measures ?? null;
  const [chordModeEnabled, setChordModeEnabled] = useState(true);
  const [session, setSession] = useState(null);
  const { start: startChords, stop: stopChords } = useChordPlayer();
  const [barResults, setBarResults] = useState({});
  const evaluatedBarsRef = useRef(new Set());
  const historyRef = useRef([]);
  const playbackRef = useRef({
    runId: 0,
    timeoutId: null,
    resolveWait: null,
    noteStops: [],
  });

  const {
    current,
    history,
    clearTrackingData,
    detectorLogSummary,
    clearDetectorLog,
    getDetectorLogRows,
  } = useStablePitchTracker({ enabled: true, maxHistoryPoints: 12000, pitchSettings });
  const isDebug = searchParams.get('debug') === 'true';

  const { allowedKeys, tempoRange, allowedOctaves } = getLessonDefaults(lesson);
  const { totalMidiShift } = computeTransposition(lesson, selectedKey, singOctave);
  const activeSection = sections[sectionIndex] ?? sections[0];
  const activeEvents = activeSection?.notes ?? [];
  const activeNotes = activeEvents.filter((note) => note?.type !== 'rest' && Number.isFinite(note?.midi));
  const scoringHistory = useMemo(() => {
    if (!session?.expectedBars?.length || !Number.isFinite(session.startMs)) {
      return history;
    }

    return history.map((entry) => {
      if (!Number.isFinite(entry?.timeMs) || !Number.isFinite(entry?.midi)) {
        return entry;
      }

      const relativeSec = (entry.timeMs - session.startMs) / 1000;
      const referenceMidi = getReferenceMidiForTime(relativeSec, session.expectedBars);
      if (!Number.isFinite(referenceMidi)) {
        // Outside any note window (rest) — suppress the point so mis-detected
        // harmonics or noise between notes don't pollute the graph.
        return { ...entry, midi: null, pitchHz: null, voiced: false };
      }

      const normalizedMidi = nearestMidiByOctave(entry.midi, referenceMidi);
      if (!Number.isFinite(normalizedMidi) || normalizedMidi === entry.midi) {
        return entry;
      }

      return {
        ...entry,
        midi: normalizedMidi,
        pitchHz: midiToFrequencyHz(normalizedMidi),
      };
    });
  }, [history, session]);

  const progress = `${Math.min(index + 1, activeNotes.length)} / ${activeNotes.length}`;
  const shiftedLessonNotes = shiftNotes(activeEvents, totalMidiShift);

  const rangeSuggestionText = getRangeSuggestionText(hasSavedPitchRange, rangeRecommendation);

  const disableApplyRangeDefaults = !rangeRecommendation
    || (rangeRecommendation.key === selectedKey && rangeRecommendation.octave === singOctave);

  function setSection(nextIndex) {
    const clamped = Math.max(0, Math.min(sections.length - 1, nextIndex));
    if (clamped === sectionIndex) {
      return;
    }

    setSectionIndex(clamped);
    setIndex(0);
    setCorrectIndices([]);
    setSession(null);
    setBarResults({});
    evaluatedBarsRef.current = new Set();
    clearTrackingData();
  }

  function prepareSectionForAutoplay(nextIndex) {
    const clamped = Math.max(0, Math.min(sections.length - 1, nextIndex));
    if (clamped === sectionIndex) {
      return;
    }

    setSectionIndex(clamped);
    setIndex(0);
    setCorrectIndices([]);
    setBarResults({});
    evaluatedBarsRef.current = new Set();
    clearTrackingData();
  }

  function getShiftedNotesForSection(targetSectionIndex) {
    const clamped = Math.max(0, Math.min(sections.length - 1, targetSectionIndex));
    const targetSection = sections[clamped] ?? sections[0];
    const targetEvents = targetSection?.notes ?? [];

    return targetEvents.map((note) => {
      if (note?.type === 'rest' || !Number.isFinite(note?.midi)) {
        return { ...note };
      }

      return {
        ...note,
        midi: note.midi + totalMidiShift,
      };
    });
  }

  function handleAdvanceToNextSection() {
    const nextIndex = Math.min(sectionIndex + 1, sections.length - 1);
    if (nextIndex === sectionIndex) {
      return;
    }

    const nextShiftedNotes = getShiftedNotesForSection(nextIndex);
    prepareSectionForAutoplay(nextIndex);
    void playMidiSequence(nextShiftedNotes);
  }

  function resetCurrentExerciseState() {
    setIndex(0);
    setCorrectIndices([]);
    setSession(null);
    setBarResults({});
    evaluatedBarsRef.current = new Set();
    clearTrackingData();
  }

  async function stopTargetPlayback() {
    const playback = playbackRef.current;
    playback.runId += 1;

    if (Array.isArray(playback.noteStops) && playback.noteStops.length) {
      playback.noteStops.forEach((stopNote) => {
        if (typeof stopNote === 'function') {
          try { stopNote(); } catch { }
        }
      });
      playback.noteStops = [];
    }

    if (playback.timeoutId) {
      globalThis.clearTimeout(playback.timeoutId);
      playback.timeoutId = null;
    }
    if (typeof playback.resolveWait === 'function') {
      playback.resolveWait();
      playback.resolveWait = null;
    }

    setIsPlayingTarget(false);
    stopChords();
  }

  function handleToggleOptions() {
    setOptionsOpen((open) => {
      const next = !open;
      if (next) {
        void stopTargetPlayback();
        resetCurrentExerciseState();
      }
      return next;
    });
  }

  function applyRangeDefaults() {
    if (!rangeRecommendation) {
      return;
    }

    setSelectedKey(rangeRecommendation.key);
    setSingOctave(rangeRecommendation.octave);
  }

  function handleExportDetectorLog() {
    const rows = getDetectorLogRows();
    if (!rows.length) {
      return;
    }

    const header = [
      'tick',
      'timeSec',
      'db',
      'rawHz',
      'rawClarity',
      'acceptedHz',
      'midi',
      'clarity',
      'voiced',
      'gateReason',
      'minDbThreshold',
      'minClarityThreshold',
      'minFreqHz',
      'maxFreqHz',
    ];
    const csvLines = [header.join(',')];
    rows.forEach((row) => {
      csvLines.push([
        row.tick,
        formatCsvNumber(row.timeSec),
        formatCsvNumber(row.db),
        formatCsvNumber(row.rawHz),
        formatCsvNumber(row.rawClarity),
        formatCsvNumber(row.acceptedHz),
        formatCsvNumber(row.midi),
        formatCsvNumber(row.clarity),
        row.voiced ? '1' : '0',
        row.gateReason,
        formatCsvNumber(row.minDbThreshold),
        formatCsvNumber(row.minClarityThreshold),
        formatCsvNumber(row.minFreqHz),
        formatCsvNumber(row.maxFreqHz),
      ].join(','));
    });

    const blob = new Blob([`${csvLines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    anchor.href = url;
    anchor.download = `sing-trainer-v2-detector-log-${stamp}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  async function playMidiSequence(notes) {
    if (!notes.length) {
      return;
    }

    await stopTargetPlayback();
    clearTrackingData();
    const runId = playbackRef.current.runId + 1;
    playbackRef.current.runId = runId;
    playbackRef.current.noteStops = [];

    const timeline = buildSingTimeline({
      notes,
      tempoBpm,
      singOctave,
      selectedKey,
      playTonicCadence,
      hearExerciseFirst,
      gracePeriodPercent,
      countdownBeats: SING_COUNTDOWN_BEATS,
    });

    const startMs = performance.now() + 30;
    evaluatedBarsRef.current = new Set();
    setIndex(0);
    setCorrectIndices([]);
    setBarResults({});
    setSession({
      startMs,
      singStartSec: timeline.singStartSec,
      stopScrollSec: timeline.stopScrollSec,
      playedBars: timeline.playedBars,
      expectedBars: timeline.expectedBars,
    });

    if (chordModeEnabled && isSong && sectionMeasures?.length) {
      startChords(sectionMeasures, tempoBpm, totalMidiShift, false);
    }

    setIsPlayingTarget(true);
    const context = getPianoAudioContext();
    await context.resume().catch(() => undefined);

    try {
      const beatSeconds = beatSecondsFromTempo(tempoBpm);
      let startAt = context.currentTime + AUDIO_START_OFFSET_SECONDS;

      if (playTonicCadence) {
        const tonicMidi = tonicMidiFromKeyOctave(selectedKey, singOctave);
        CADENCE_CHORD_OFFSETS.forEach((offset) => {
          const chordRoot = tonicMidi + offset;
          TRIAD_INTERVALS.forEach((triadOffset) => {
            const stopNote = schedulePianoNote(context, midiToFrequencyHz(chordRoot + triadOffset), startAt, beatSeconds, CADENCE_CHORD_GAIN);
            if (typeof stopNote === 'function') {
              playbackRef.current.noteStops.push(stopNote);
            }
          });
          startAt += beatSeconds;
        });
        startAt += NOTE_GAP_SECONDS * 2;
      }

      if (hearExerciseFirst) {
        for (const note of notes) {
          const beats = Number.isFinite(note.durationBeats) ? note.durationBeats : 1;
          const noteDurationSeconds = Math.max(MIN_NOTE_DURATION_SECONDS, beatSeconds * beats * NOTE_DURATION_SCALE);
          if (note?.type === 'rest' || !Number.isFinite(note?.midi)) {
            startAt += noteDurationSeconds + NOTE_GAP_SECONDS;
            continue;
          }
          const stopNote = schedulePianoNote(context, midiToFrequencyHz(note.midi), startAt, noteDurationSeconds, TARGET_NOTE_GAIN);
          if (typeof stopNote === 'function') {
            playbackRef.current.noteStops.push(stopNote);
          }
          startAt += noteDurationSeconds + NOTE_GAP_SECONDS;
        }
      }

      let guideAt = startAt + beatSeconds * SING_COUNTDOWN_BEATS;
      for (const note of notes) {
        const beats = Number.isFinite(note.durationBeats) ? note.durationBeats : 1;
        const noteDurationSeconds = Math.max(MIN_NOTE_DURATION_SECONDS, beatSeconds * beats * NOTE_DURATION_SCALE);
        if (note?.type === 'rest' || !Number.isFinite(note?.midi)) {
          guideAt += noteDurationSeconds + NOTE_GAP_SECONDS;
          continue;
        }
        const stopGuideNote = schedulePianoNote(context, midiToFrequencyHz(note.midi), guideAt, noteDurationSeconds, SING_GUIDE_NOTE_GAIN);
        if (typeof stopGuideNote === 'function') {
          playbackRef.current.noteStops.push(stopGuideNote);
        }
        guideAt += noteDurationSeconds + NOTE_GAP_SECONDS;
      }

      const totalDurationMs = Math.ceil((guideAt - context.currentTime) * 1000) + PLAYBACK_BUFFER_MS;
      await new Promise((resolve) => {
        playbackRef.current.resolveWait = resolve;
        playbackRef.current.timeoutId = globalThis.setTimeout(() => {
          playbackRef.current.timeoutId = null;
          playbackRef.current.resolveWait = null;
          resolve();
        }, totalDurationMs);
      });
    } finally {
      if (playbackRef.current.timeoutId) {
        globalThis.clearTimeout(playbackRef.current.timeoutId);
        playbackRef.current.timeoutId = null;
      }
      playbackRef.current.resolveWait = null;
      playbackRef.current.noteStops = [];
      if (playbackRef.current.runId === runId) {
        setIsPlayingTarget(false);
      }
    }
  }

  useEffect(() => {
    if (!lesson) {
      return;
    }

    const persistedOptions = getTrainerOptionsForLesson(lesson);

    setSelectedKey(persistedOptions.selectedKey);
    setTempoBpm(persistedOptions.tempoBpm);
    setPlayTonicCadence(persistedOptions.playTonicCadence);
    setHearExerciseFirst(persistedOptions.hearExerciseFirst);
    setSingOctave(persistedOptions.singOctave);
    setToleranceCents(persistedOptions.toleranceCents);
    setGracePeriodPercent(persistedOptions.gracePeriodPercent);
    setInstrument(persistedOptions.instrument);

    setIndex(0);
    setCorrectIndices([]);
    setSectionIndex(0);
    setSession(null);
    setBarResults({});
    evaluatedBarsRef.current = new Set();
  }, [lesson]);

  useEffect(() => {
    if (!lesson) {
      return;
    }

    saveTrainerOptionsSettings({
      selectedKey,
      tempoBpm,
      playTonicCadence,
      hearExerciseFirst,
      singOctave,
      toleranceCents,
      gracePeriodPercent,
      instrument,
    });
  }, [lesson, playTonicCadence, hearExerciseFirst, selectedKey, singOctave, tempoBpm, toleranceCents, gracePeriodPercent, instrument]);

  useEffect(() => {
    void loadInstrument(instrument);
  }, [instrument]);

  useEffect(() => () => {
    void stopTargetPlayback();
  }, []);

  useEffect(() => {
    historyRef.current = scoringHistory;
  }, [scoringHistory]);

  useEffect(() => {
    if (!session?.expectedBars?.length) {
      return;
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
          history: historyRef.current,
          sessionStartMs: session.startMs,
          toleranceCents,
        });

        setBarResults((previous) => {
          if (previous[bar.id] === matched) {
            return previous;
          }
          return { ...previous, [bar.id]: matched };
        });

        applyBarEvaluation({
          bar,
          matched,
          activeNotesLength: activeNotes.length,
          setCorrectIndices,
          setIndex,
        });
      }
    }, 60);

    return () => {
      globalThis.clearInterval(timerId);
    };
  }, [activeNotes.length, session, toleranceCents]);

  if (!lesson) {
    return (
      <div className="card controls">
        <p>Lesson not found.</p>
        <Link className="button secondary home-icon-button" to="/lessons" title="Back to lessons" aria-label="Back to lessons">⌂</Link>
      </div>
    );
  }

  return (
    <div className="trainer-grid">
      <div className="card controls">
        <div className="lesson-title-row sing-title-row">
          <h3>{lesson.name} · Sing V2</h3>
          <div className="trainer-detected-note sing-title-detected">
            <span>Detected note: </span>
            <strong>{current.note}</strong>
          </div>
          {sections.length > 1 ? (
            <small>{`Measures ${sectionIndex * measureWindowSize + 1}–${Math.min((sectionIndex + 1) * measureWindowSize, lesson.measures.length)} of ${lesson.measures.length} · Key ${selectedKey}`}</small>
          ) : <span className="sing-title-spacer" />}
        </div>

        {isDebug ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <button type="button" className="button secondary" onClick={handleExportDetectorLog}>
              Export Detector Log CSV
            </button>
            <button type="button" className="button secondary" onClick={clearDetectorLog}>
              Clear Log
            </button>
            <span className="badge">Log Rows: {detectorLogSummary.count}</span>
            <span className="badge">Last Gate: {detectorLogSummary.lastGate}</span>
            <span className="badge">Last Raw Hz: {Number.isFinite(detectorLogSummary.lastRawHz) ? detectorLogSummary.lastRawHz.toFixed(2) : '-'}</span>
          </div>
        ) : null}

        <SingTrainingOptionsSection
          optionsOpen={optionsOpen}
          onToggleOptions={handleToggleOptions}
          allowedKeys={allowedKeys}
          selectedKey={selectedKey}
          onSelectedKeyChange={setSelectedKey}
          tempoRange={tempoRange}
          tempoBpm={tempoBpm}
          onTempoBpmChange={setTempoBpm}
          allowedOctaves={allowedOctaves}
          singOctave={singOctave}
          onSingOctaveChange={setSingOctave}
          playTonicCadence={playTonicCadence}
          onPlayTonicCadenceChange={setPlayTonicCadence}
          hearExerciseFirst={hearExerciseFirst}
          onHearExerciseFirstChange={setHearExerciseFirst}
          rangeSuggestionText={rangeSuggestionText}
          onApplyRangeDefaults={applyRangeDefaults}
          disableApplyRangeDefaults={disableApplyRangeDefaults}
          instrument={instrument}
          onInstrumentChange={setInstrument}
          toleranceCents={toleranceCents}
          onToleranceCentsChange={setToleranceCents}
          gracePeriodPercent={gracePeriodPercent}
          onGracePeriodPercentChange={setGracePeriodPercent}
        />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {isSong && (
            <button
              type="button"
              className={`button secondary${chordModeEnabled ? ' chord-mode-active' : ''}`}
              style={{ fontSize: 12, padding: '3px 10px' }}
              onClick={() => setChordModeEnabled((v) => !v)}
              title={chordModeEnabled ? 'Chord accompaniment on — click to mute' : 'Chord accompaniment off — click to enable'}
            >
              ♩ Chords {chordModeEnabled ? 'On' : 'Off'}
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#1e293b', borderRadius: 8, padding: '2px 8px' }}>
            <span style={{ fontSize: 11, color: '#64748b', marginRight: 2 }}>Measures</span>
            <button type="button" className="button secondary" style={{ padding: '2px 8px', fontSize: 13 }}
              onClick={() => { setMeasureWindowSize((w) => Math.max(1, w - 1)); setSectionIndex(0); }}
              disabled={measureWindowSize <= 1} title="Fewer measures per section">−</button>
            <span style={{ minWidth: 18, textAlign: 'center', fontSize: 13 }}>{measureWindowSize}</span>
            <button type="button" className="button secondary" style={{ padding: '2px 8px', fontSize: 13 }}
              onClick={() => { setMeasureWindowSize((w) => Math.min(8, w + 1)); setSectionIndex(0); }}
              disabled={measureWindowSize >= 8} title="More measures per section">+</button>
          </div>
          {sections.length > 1 ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => setSection(sectionIndex - 1)}
              disabled={sectionIndex <= 0}
              title="Previous section"
              aria-label="Previous section"
            >
              ⏮
            </button>
          ) : null}
          <button
            type="button"
            className="button"
            onClick={() => void playMidiSequence(shiftedLessonNotes)}
            title="Play target notes"
            aria-label="Play target notes"
          >
            ▶
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => void playMidiSequence(shiftedLessonNotes)}
            title="Replay section"
            aria-label="Replay section"
          >
            ↺
          </button>
          {sections.length > 1 ? (
            <button
              type="button"
              className="button secondary"
              onClick={handleAdvanceToNextSection}
              disabled={sectionIndex >= sections.length - 1}
              title="Next section"
              aria-label="Next section"
            >
              ⏭
            </button>
          ) : null}
          <Link
            className="button secondary home-icon-button"
            to="/lessons"
            title="Back to lessons"
            aria-label="Back to lessons"
          >
            ⌂
          </Link>
        </div>
      </div>

      <div className="card controls trainer-input-panel">
        <div className="input-header">
          <h3>Input</h3>
          <div className="input-progress">
            <span className="progress-text">{progress}</span>
            <div className="progress-dots" aria-label="Sequence progress">
              {activeNotes.map((note, noteIndex) => {
                const isCurrent = noteIndex === index;
                const isCorrect = correctIndices.includes(noteIndex);
                const shiftedMidi = note.midi + totalMidiShift;
                const noteOctave = Math.floor(shiftedMidi / SEMITONES_PER_OCTAVE) - 1;
                const label = note.degree ? `${note.degree}${noteOctave}` : midiToNoteLabel(shiftedMidi);
                return (
                  <span
                    key={note.id ?? `${note.midi}-${noteIndex}`}
                    className={`note-chip ${isCurrent ? 'current' : ''} ${isCorrect ? 'correct' : 'pending'}`}
                  >
                    {isCorrect ? label : '_'}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {isSong && sectionMeasures?.length ? (
          <ChordBar measures={sectionMeasures} className="trainer-chord-bar" />
        ) : null}

        <SingInputGraphV2
          minFrequencyHz={55}
          maxFrequencyHz={1200}
          history={history}
          sessionStartMs={session?.startMs}
          singStartSec={session?.singStartSec}
          stopScrollSec={session?.stopScrollSec}
          playedBars={session?.playedBars ?? []}
          expectedBars={session?.expectedBars ?? []}
          barResults={barResults}
        />
      </div>
    </div>
  );
}

function formatCsvNumber(value) {
  return Number.isFinite(value) ? String(value) : '';
}

function getReferenceMidiForTime(relativeSec, expectedBars) {
  if (!Number.isFinite(relativeSec) || !Array.isArray(expectedBars) || !expectedBars.length) {
    return null;
  }

  for (const bar of expectedBars) {
    if (!Number.isFinite(bar?.midi) || !Number.isFinite(bar?.startSec) || !Number.isFinite(bar?.endSec)) {
      continue;
    }
    if (relativeSec >= (bar.startSec - 0.25) && relativeSec <= (bar.endSec + 0.25)) {
      return bar.midi;
    }
  }

  return null;
}

function nearestMidiByOctave(candidateMidi, referenceMidi) {
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
