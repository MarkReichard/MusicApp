import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadPitchSettings } from '../lib/pitchSettings';
import { loadPitchStabilitySettings, savePitchStabilitySettings } from '../lib/pitchStabilitySettings';
import { usePitchDetector } from '../lib/usePitchDetector';
import {
  DIATONIC_SCALE_SEMITONES,
  DIATONIC_SOLFEGE_NAMES,
  NATURAL_KEY_OPTIONS,
  keyToSemitone,
  midiToFrequencyHz,
  midiToNoteLabel,
  nearestMidiByOctave,
  normalizeDetectedMidiForTarget,
} from '../lib/musicTheory';
import { INSTRUMENT_OPTIONS, loadInstrument, playPianoNoteNow } from '../lib/pianoSynth';
import { drawChart } from '../lib/drawChart';

const DEFAULT_PROMPT_DURATION_S = 1.2;
const BESTS_SESSION_KEY = 'musicapp.web.pitchStability.bestByNote.v1';
const ALL_TIME_NOTE_STATS_KEY = 'musicapp.web.pitchStability.noteStats.v1';
const GRAPH_WINDOW_MS = 4500;
const GRAPH_RANGE_SEMITONES = 2;
const GRAPH_HEIGHT_PX = 210;

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildOctaveDiatonicCandidates(selectedKey, selectedOctave) {
  const tonicSemitone = keyToSemitone(selectedKey);
  const octaveBaseMidi = (selectedOctave + 1) * 12;
  const out = [];

  for (let semitone = 0; semitone < 12; semitone += 1) {
    const midi = octaveBaseMidi + semitone;
    const rel = ((midi - tonicSemitone) % 12 + 12) % 12;
    const degreeIdx = DIATONIC_SCALE_SEMITONES.indexOf(rel);
    if (degreeIdx !== -1) {
      out.push({
        midi,
        solfege: DIATONIC_SOLFEGE_NAMES[degreeIdx],
        noteLabel: midiToNoteLabel(midi),
      });
    }
  }

  return out;
}

function buildExercise(selectedKey, selectedOctave, noteCount) {
  const candidates = buildOctaveDiatonicCandidates(selectedKey, selectedOctave);
  if (candidates.length === 0) return [];
  const shuffled = shuffleArray(candidates);
  const exercise = [];
  for (let i = 0; i < noteCount; i += 1) {
    exercise.push(shuffled[i % shuffled.length]);
  }
  return exercise;
}

function loadSessionBests() {
  try {
    const raw = sessionStorage.getItem(BESTS_SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveSessionBests(next) {
  try {
    sessionStorage.setItem(BESTS_SESSION_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function loadAllTimeNoteStats() {
  try {
    const raw = localStorage.getItem(ALL_TIME_NOTE_STATS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveAllTimeNoteStats(next) {
  try {
    localStorage.setItem(ALL_TIME_NOTE_STATS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function PitchStabilityPage() {
  const pitchSettings = useMemo(() => loadPitchSettings(), []);
  const saved = useMemo(() => loadPitchStabilitySettings(), []);

  const [selectedKey, setSelectedKey] = useState(saved.selectedKey);
  const [selectedInstrument, setSelectedInstrument] = useState(saved.selectedInstrument);
  const [noteCount, setNoteCount] = useState(saved.noteCount);
  const [toleranceCents, setToleranceCents] = useState(saved.toleranceCents);
  const [selectedOctave, setSelectedOctave] = useState(saved.selectedOctave);
  const [matchTimeS, setMatchTimeS] = useState(saved.matchTimeS);

  const [exercise, setExercise] = useState([]);
  const [noteIndex, setNoteIndex] = useState(0);
  const [phase, setPhase] = useState('setup'); // setup | playing_tone | matching | holding | feedback | between | done
  const [results, setResults] = useState([]);
  const [feedbackText, setFeedbackText] = useState('');
  const [lastNoteLengthS, setLastNoteLengthS] = useState(null);
  const [newBestNotice, setNewBestNotice] = useState('');

  const [bestsByNote, setBestsByNote] = useState(() => loadSessionBests());
  const [allTimeNoteStats, setAllTimeNoteStats] = useState(() => loadAllTimeNoteStats());

  const timeoutRef = useRef(null);
  const noticeTimeoutRef = useRef(null);
  const matchWindowTimeoutRef = useRef(null);
  const matchedInWindowRef = useRef(false);
  const holdStartMsRef = useRef(0);
  const offStreakRef = useRef(0);
  const lastGoodMsRef = useRef(0);

  const { current, history, clearHistory } = usePitchDetector(pitchSettings, true, { maxHistoryPoints: 12000 });
  const graphCanvasRef = useRef(null);

  const currentTarget = exercise[noteIndex] ?? null;
  const maxOffSamples = Math.max(1, Math.round(Number(pitchSettings.averageReadings) || 1));

  useEffect(() => {
    savePitchStabilitySettings({
      selectedKey,
      selectedInstrument,
      noteCount,
      toleranceCents,
      selectedOctave,
      matchTimeS,
    });
  }, [selectedKey, selectedInstrument, noteCount, toleranceCents, selectedOctave, matchTimeS]);

  useEffect(() => {
    void loadInstrument(selectedInstrument);
  }, [selectedInstrument]);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
    if (matchWindowTimeoutRef.current) clearTimeout(matchWindowTimeoutRef.current);
  }, []);

  function startRun() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
    if (matchWindowTimeoutRef.current) clearTimeout(matchWindowTimeoutRef.current);
    clearHistory();
    const ex = buildExercise(selectedKey, selectedOctave, noteCount);
    setExercise(ex);
    setNoteIndex(0);
    setResults(new Array(ex.length).fill(null));
    setFeedbackText('');
    setLastNoteLengthS(null);
    setNewBestNotice('');
    if (!ex.length) {
      setPhase('setup');
      return;
    }
    void playAndBegin(ex[0]);
  }

  async function playAndBegin(target) {
    setPhase('playing_tone');
    const delayMs = playPianoNoteNow(target.midi, DEFAULT_PROMPT_DURATION_S, 0.18);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (matchWindowTimeoutRef.current) clearTimeout(matchWindowTimeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      matchedInWindowRef.current = false;
      offStreakRef.current = 0;
      holdStartMsRef.current = 0;
      lastGoodMsRef.current = 0;
      setPhase('matching');

      matchWindowTimeoutRef.current = setTimeout(() => {
        matchWindowTimeoutRef.current = null;
        if (!matchedInWindowRef.current) {
          finishCurrent(target, false, 0);
          return;
        }
        holdStartMsRef.current = performance.now();
        lastGoodMsRef.current = 0;
        offStreakRef.current = 0;
        setPhase('holding');
      }, Math.round(matchTimeS * 1000));
    }, delayMs);
  }

  function finishCurrent(target, matched, holdSeconds) {
    const row = {
      noteIndex,
      solfege: target.solfege,
      noteLabel: target.noteLabel,
      targetMidi: target.midi,
      matched,
      holdSeconds,
      maxOffSamples,
    };

    setResults((prev) => {
      const next = [...prev];
      next[noteIndex] = row;
      return next;
    });

    const noteKey = `${target.noteLabel}`;
    const previousNoteStats = allTimeNoteStats[noteKey] ?? { totalHoldSeconds: 0, samples: 0, solfege: target.solfege };
    const nextAllTimeStats = {
      ...allTimeNoteStats,
      [noteKey]: {
        totalHoldSeconds: Number(previousNoteStats.totalHoldSeconds || 0) + holdSeconds,
        samples: Number(previousNoteStats.samples || 0) + 1,
        solfege: target.solfege,
      },
    };
    setAllTimeNoteStats(nextAllTimeStats);
    saveAllTimeNoteStats(nextAllTimeStats);

    const previousBest = Number(bestsByNote[noteKey] || 0);
    if (holdSeconds > previousBest) {
      const nextBests = { ...bestsByNote, [noteKey]: holdSeconds };
      setBestsByNote(nextBests);
      saveSessionBests(nextBests);
      setNewBestNotice(`New best for ${noteKey}: ${holdSeconds.toFixed(2)}s`);
      if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
      noticeTimeoutRef.current = setTimeout(() => {
        setNewBestNotice('');
        noticeTimeoutRef.current = null;
      }, 3000);
    }

    setLastNoteLengthS(holdSeconds);
    setFeedbackText(matched
      ? `Note length: ${holdSeconds.toFixed(2)}s`
      : `No match in ${matchTimeS.toFixed(1)}s (note length: ${holdSeconds.toFixed(2)}s)`);
    setPhase('feedback');

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (matchWindowTimeoutRef.current) {
      clearTimeout(matchWindowTimeoutRef.current);
      matchWindowTimeoutRef.current = null;
    }
    timeoutRef.current = setTimeout(() => {
      const nextIndex = noteIndex + 1;
      if (nextIndex >= exercise.length) {
        setPhase('done');
        return;
      }
      setNoteIndex(nextIndex);
      clearHistory();
      setPhase('between');
      timeoutRef.current = setTimeout(() => {
        void playAndBegin(exercise[nextIndex]);
      }, 1000);
    }, 900);
  }

  useEffect(() => {
    if (!currentTarget) return;
    if (phase !== 'matching' && phase !== 'holding') return;

    const detectedMidi = Number.isFinite(current?.midi)
      ? normalizeDetectedMidiForTarget(current.midi, current.pitchHz, currentTarget.midi)
      : null;

    const onTarget = Number.isFinite(detectedMidi)
      && Math.abs((detectedMidi - currentTarget.midi) * 100) <= toleranceCents;

    if (phase === 'matching') {
      if (onTarget) {
        matchedInWindowRef.current = true;
      }
      return;
    }

    if (phase === 'holding') {
      const now = performance.now();
      if (onTarget) {
        lastGoodMsRef.current = now;
        offStreakRef.current = 0;
      } else {
        offStreakRef.current += 1;
      }

      if (offStreakRef.current > maxOffSamples) {
        const effectiveEndMs = lastGoodMsRef.current || now;
        const holdSeconds = Math.max(0, (effectiveEndMs - holdStartMsRef.current) / 1000);
        finishCurrent(currentTarget, true, holdSeconds);
      }
    }
  }, [phase, current, currentTarget, toleranceCents, maxOffSamples]);

  const phaseLabel = {
    setup: 'Configure and start',
    playing_tone: 'Listen...',
    matching: `Match the pitch (${matchTimeS.toFixed(1)}s window)`,
    holding: 'Hold as long as stable',
    feedback: feedbackText,
    between: 'Next note in 1s...',
    done: 'Run complete',
  }[phase] ?? '';
  const showNoteLengthIndicator = (phase === 'feedback' || phase === 'between') && Number.isFinite(lastNoteLengthS);

  const detectedDisplay = Number.isFinite(current?.midi) ? current.note : '—';
  const completedResults = results.filter(Boolean);
  const allTimeAverages = Object.entries(allTimeNoteStats)
    .map(([noteLabel, stats]) => {
      const totalHoldSeconds = Number(stats?.totalHoldSeconds || 0);
      const samples = Number(stats?.samples || 0);
      const averageHoldSeconds = samples > 0 ? totalHoldSeconds / samples : 0;
      return {
        noteLabel,
        solfege: stats?.solfege || '',
        totalHoldSeconds,
        samples,
        averageHoldSeconds,
      };
    })
    .filter((row) => row.samples > 0);

  const bestAllTimeTop5 = [...allTimeAverages]
    .sort((a, b) => b.averageHoldSeconds - a.averageHoldSeconds)
    .slice(0, 5);
  const worstAllTimeTop5 = [...allTimeAverages]
    .sort((a, b) => a.averageHoldSeconds - b.averageHoldSeconds)
    .slice(0, 5);

  useEffect(() => {
    const canvas = graphCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;

    const dpr = globalThis.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(GRAPH_HEIGHT_PX * dpr));

    const activeTargetMidi = Number.isFinite(currentTarget?.midi)
      ? currentTarget.midi
      : (Number.isFinite(current?.midi) ? Math.round(current.midi) : 60);

    const minHz = midiToFrequencyHz(activeTargetMidi - GRAPH_RANGE_SEMITONES);
    const maxHz = midiToFrequencyHz(activeTargetMidi + GRAPH_RANGE_SEMITONES);

    const nowMs = performance.now();
    const windowStartMs = nowMs - GRAPH_WINDOW_MS;
    const windowed = history
      .filter((point) => Number.isFinite(point?.timeMs) && point.timeMs >= windowStartMs)
      .map((point) => ({
        isOutOfRange: Number.isFinite(currentTarget?.midi)
          && Number.isFinite(point?.midi)
          && Math.abs((normalizeDetectedMidiForTarget(point.midi, point.pitchHz, currentTarget.midi) - currentTarget.midi) * 100) > toleranceCents,
        pitchHz: point.pitchHz,
        db: point.db,
        x: Math.max(0, Math.min(1, (point.timeMs - windowStartMs) / GRAPH_WINDOW_MS)),
      }));

    drawChart(canvas, windowed, minHz, maxHz, -70, 0, {
      inRangeStrokeColor: '#22d3ee',
      outOfRangeStrokeColor: '#ef4444',
      isOutOfRange: (point) => Boolean(point?.isOutOfRange),
    });
  }, [history, currentTarget, current, toleranceCents]);

  return (
    <div className="pitch-match-page">
      <div className="card controls pitch-match-options">
        <h3 style={{ margin: '0 0 8px' }}>Pitch Stability</h3>
        <div className="pitch-match-options-row">
          <label className="pitch-match-label">
            {'Key '}
            <select value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)} className="pitch-match-select" disabled={phase !== 'setup' && phase !== 'done'}>
              {NATURAL_KEY_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>

          <label className="pitch-match-label">
            {'Instrument '}
            <select value={selectedInstrument} onChange={(e) => setSelectedInstrument(e.target.value)} className="pitch-match-select" disabled={phase !== 'setup' && phase !== 'done'}>
              {INSTRUMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          <label className="pitch-match-label">
            Notes: {noteCount}
            <input type="range" min={1} max={10} value={noteCount} onChange={(e) => setNoteCount(Number(e.target.value))} disabled={phase !== 'setup' && phase !== 'done'} style={{ width: 100 }} />
          </label>

          <label className="pitch-match-label">
            Tolerance: {toleranceCents}¢
            <input type="range" min={0} max={50} step={5} value={toleranceCents} onChange={(e) => setToleranceCents(Number(e.target.value))} style={{ width: 100 }} />
          </label>

          <label className="pitch-match-label">
            Octave
            <select value={selectedOctave} onChange={(e) => setSelectedOctave(Number(e.target.value))} className="pitch-match-select" disabled={phase !== 'setup' && phase !== 'done'}>
              {[2, 3, 4, 5, 6].map((oct) => <option key={oct} value={oct}>{`Oct ${oct}`}</option>)}
            </select>
          </label>

          <label className="pitch-match-label">
            Match time: {matchTimeS.toFixed(1)}s
            <input type="range" min={5} max={60} step={1} value={Math.round(matchTimeS * 10)} onChange={(e) => setMatchTimeS(Number(e.target.value) / 10)} style={{ width: 100 }} />
          </label>

          <button type="button" className="button" onClick={startRun}>
            {phase === 'setup' ? 'Start' : 'Restart'}
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>
          Stability fail threshold: {maxOffSamples} consecutive off-target samples (from mic config)
        </div>
      </div>

      {phase !== 'setup' && (
        <div className="card pitch-match-panel">
          <div className="note-chips-row">
            {exercise.map((n, i) => {
              const res = results[i];
              const isCurrent = i === noteIndex;
              let chipClass = 'note-chip';
              if (res?.matched) chipClass += ' correct';
              else if (res && !res.matched) chipClass += ' wrong';
              else if (isCurrent) chipClass += ' active';
              return <span key={`${i}-${n.midi}`} className={chipClass}>{n.solfege}</span>;
            })}
          </div>

          <div className="pitch-match-phase-label">{phaseLabel}</div>

          {showNoteLengthIndicator ? (
            <div
              style={{
                margin: '2px auto 0',
                maxWidth: 420,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #38bdf8',
                background: 'rgba(56, 189, 248, 0.14)',
                color: '#7dd3fc',
                fontWeight: 700,
                textAlign: 'center',
              }}
            >
              Note length: {lastNoteLengthS.toFixed(2)}s
            </div>
          ) : null}

          {newBestNotice ? (
            <div
              style={{
                margin: '8px auto 0',
                maxWidth: 420,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #16a34a',
                background: 'rgba(22, 163, 74, 0.16)',
                color: '#86efac',
                fontWeight: 600,
                textAlign: 'center',
              }}
            >
              {newBestNotice}
            </div>
          ) : null}

          {currentTarget && phase !== 'done' && (
            <div className="pitch-match-target">
              <span className="target-solfege">{currentTarget.solfege}</span>
              <span className="target-note-label">{currentTarget.noteLabel}</span>
            </div>
          )}

          <div className="pitch-match-detected">
            <span className="detected-label">You:</span>
            <span className="detected-note">{detectedDisplay}</span>
          </div>

          <div style={{ marginTop: 12, width: '100%', minHeight: GRAPH_HEIGHT_PX }}>
            <canvas
              ref={graphCanvasRef}
              className="mic-settings-canvas"
              style={{ width: '100%', maxWidth: '100%', height: GRAPH_HEIGHT_PX, minHeight: GRAPH_HEIGHT_PX, maxHeight: GRAPH_HEIGHT_PX, display: 'block' }}
            />
            <div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8' }}>
              Live pitch graph (target range: current note +/- 2 semitones)
            </div>
          </div>

          {(results.some(Boolean) || allTimeAverages.length > 0) && (
            <>
              {(bestAllTimeTop5.length > 0 || worstAllTimeTop5.length > 0) && (
                <div
                  style={{
                    marginTop: 14,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 10,
                  }}
                >
                  <div style={{ border: '1px solid #14532d', background: 'rgba(22, 163, 74, 0.12)', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 12, color: '#86efac', marginBottom: 4 }}>Best 5 notes all-time (avg duration)</div>
                    {bestAllTimeTop5.map((row, index) => (
                      <div key={`best-${row.noteLabel}`} style={{ color: '#dcfce7', fontWeight: 600, fontSize: 13 }}>
                        {index + 1}. {row.solfege || '-'} ({row.noteLabel}) - {row.averageHoldSeconds.toFixed(2)}s avg ({row.samples} samples)
                      </div>
                    ))}
                  </div>
                  <div style={{ border: '1px solid #7f1d1d', background: 'rgba(239, 68, 68, 0.12)', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 12, color: '#fca5a5', marginBottom: 4 }}>Worst 5 notes all-time (avg duration)</div>
                    {worstAllTimeTop5.map((row, index) => (
                      <div key={`worst-${row.noteLabel}`} style={{ color: '#fee2e2', fontWeight: 600, fontSize: 13 }}>
                        {index + 1}. {row.solfege || '-'} ({row.noteLabel}) - {row.averageHoldSeconds.toFixed(2)}s avg ({row.samples} samples)
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pitch-match-results-table-wrap" style={{ marginTop: 16 }}>
                <table className="pitch-match-results-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Target</th>
                      <th>Matched in time</th>
                      <th>Note length</th>
                      <th>Best (session)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completedResults.map((row) => {
                      const best = Number(bestsByNote[row.noteLabel] || 0);
                      return (
                        <tr key={`${row.noteIndex}-${row.noteLabel}`}>
                          <td>{row.noteIndex + 1}</td>
                          <td>{row.solfege} ({row.noteLabel})</td>
                          <td>{row.matched ? 'Yes' : 'No'}</td>
                          <td>{row.holdSeconds.toFixed(2)}s</td>
                          <td>{best.toFixed(2)}s</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
