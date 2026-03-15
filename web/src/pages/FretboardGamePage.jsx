import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FretboardDiagram } from '../components/fretboard/FretboardDiagram';
import { StaffNoteDisplay } from '../components/fretboard/StaffNoteDisplay';
import {
  SHARP_MAJOR_KEYS,
  GUITAR_STRINGS,
  buildPromptPool,
  selectNextPrompt,
  recordPromptAttempt,
  loadFretboardProgress,
  saveFretboardProgress,
  countMasteredPrompts,
} from '../lib/fretboardGame';
import { loadInstrument, loadPiano, playPianoNoteNow, stopAllNotes } from '../lib/pianoSynth';

const TARGET_NOTE_GAIN = 0.16;

const LESSON_ROUTE_TO_GROUP = {
  'lesson-1': 'group1',
  'lesson-2': 'group2',
  'lesson-3': 'group3',
};

const LESSON_GROUP_TITLES = {
  group1: 'Lesson One - Open Strings',
  group2: 'Lesson Two - Single String Mapping',
  group3: 'Lesson Three - First Position',
};

export function FretboardGamePage() {
  const { lessonId = 'lesson-1' } = useParams();
  const lessonGroupId = LESSON_ROUTE_TO_GROUP[lessonId] ?? 'group1';
  const lessonTitle = LESSON_GROUP_TITLES[lessonGroupId] ?? LESSON_GROUP_TITLES.group1;

  const [selectedKey, setSelectedKey] = useState('C');
  const [selectedStringIndex, setSelectedStringIndex] = useState(0);
  const [audioMode, setAudioMode] = useState('instrument');
  const [stringHighlightEnabled, setStringHighlightEnabled] = useState(true);
  const [showNoteNames, setShowNoteNames] = useState(false);

  const [progressByPromptId, setProgressByPromptId] = useState(() => loadFretboardProgress());
  const [currentPrompt, setCurrentPrompt] = useState(null);
  const [lastPromptId, setLastPromptId] = useState('');
  const [correctCellIds, setCorrectCellIds] = useState([]);
  const [wrongCellId, setWrongCellId] = useState('');

  const [score, setScore] = useState({ correct: 0, attempts: 0, streak: 0, bestStreak: 0 });
  const [audioReady, setAudioReady] = useState(false);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isResolvingAnswer, setIsResolvingAnswer] = useState(false);
  const resolveTimeoutRef = useRef(null);
  const suppressNextPromptAutoPlayRef = useRef(false);
  const clickLockRef = useRef(false);
  const lastClickAtRef = useRef(0);

  const pool = useMemo(() => buildPromptPool({
    groupId: lessonGroupId,
    selectedKey,
    selectedStringIndex,
  }), [lessonGroupId, selectedKey, selectedStringIndex]);

  const masteredCount = useMemo(
    () => countMasteredPrompts(pool.prompts, progressByPromptId),
    [pool.prompts, progressByPromptId],
  );

  function playMidi(midi, durationSeconds = 1.1, gain = TARGET_NOTE_GAIN) {
    if (!Number.isFinite(midi) || !audioReady) return;
    stopAllNotes();
    playPianoNoteNow(midi, durationSeconds, gain);
  }

  function playPrompt(prompt = currentPrompt) {
    if (!prompt) return;
    playMidi(prompt.midi, 1.1, TARGET_NOTE_GAIN);
  }

  function pickDifferentPrompt(currentId, progressSource = progressByPromptId) {
    if (!pool.prompts.length) return null;
    if (pool.prompts.length === 1) return pool.prompts[0];

    let candidate = selectNextPrompt(pool.prompts, progressSource, currentId);
    if (candidate && candidate.id !== currentId) return candidate;

    const alternatives = pool.prompts.filter((prompt) => prompt.id !== currentId);
    return alternatives[Math.floor(Math.random() * alternatives.length)] ?? candidate;
  }

  function advancePrompt() {
    if (resolveTimeoutRef.current) {
      globalThis.clearTimeout(resolveTimeoutRef.current);
      resolveTimeoutRef.current = null;
    }
    suppressNextPromptAutoPlayRef.current = false;
    clickLockRef.current = false;
    setIsResolvingAnswer(false);
    const next = pickDifferentPrompt(currentPrompt?.id ?? lastPromptId);
    setCurrentPrompt(next);
    setLastPromptId(next?.id ?? '');
    setCorrectCellIds([]);
    setWrongCellId('');
  }

  useEffect(() => {
    let active = true;
    setAudioReady(false);
    if (audioMode === 'instrument') {
      loadInstrument('acoustic_guitar_steel')
        .then(() => {
          if (active) setAudioReady(true);
        })
        .catch(() => {
          if (active) setAudioReady(false);
        });
    } else {
      loadPiano()
        .then(() => {
          if (active) setAudioReady(true);
        })
        .catch(() => {
          if (active) setAudioReady(false);
        });
    }

    return () => {
      active = false;
    };
  }, [audioMode]);

  useEffect(() => {
    saveFretboardProgress(progressByPromptId);
  }, [progressByPromptId]);

  useEffect(() => {
    const next = selectNextPrompt(pool.prompts, progressByPromptId, '');
    setCurrentPrompt(next);
    setLastPromptId(next?.id ?? '');
    setCorrectCellIds([]);
    setWrongCellId('');
    clickLockRef.current = false;
    setIsResolvingAnswer(false);
  }, [pool]);

  useEffect(() => {
    return () => {
      if (resolveTimeoutRef.current) globalThis.clearTimeout(resolveTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!currentPrompt) return;
    if (suppressNextPromptAutoPlayRef.current) {
      suppressNextPromptAutoPlayRef.current = false;
      return;
    }
    playPrompt(currentPrompt);
  }, [currentPrompt, audioReady]);

  function handleAnswerSelection(cell) {
    if (!currentPrompt) return;
    if (clickLockRef.current) return;

    const now = Date.now();
    if (now - lastClickAtRef.current < 120) return;
    lastClickAtRef.current = now;

    playMidi(cell.midi, 0.75, TARGET_NOTE_GAIN * 0.95);

    const isCorrect = currentPrompt.validCellIds.includes(cell.id);
    const nextProgress = recordPromptAttempt(progressByPromptId, currentPrompt.id, isCorrect);
    setProgressByPromptId(nextProgress);

    if (isCorrect) {
      clickLockRef.current = true;
      setIsResolvingAnswer(true);
      setCorrectCellIds(currentPrompt.validCellIds);
      setWrongCellId('');
      setScore((prev) => {
        const nextStreak = prev.streak + 1;
        return {
          correct: prev.correct + 1,
          attempts: prev.attempts + 1,
          streak: nextStreak,
          bestStreak: Math.max(prev.bestStreak, nextStreak),
        };
      });

      resolveTimeoutRef.current = globalThis.setTimeout(() => {
        const next = pickDifferentPrompt(currentPrompt.id, nextProgress);
        suppressNextPromptAutoPlayRef.current = true;
        setCurrentPrompt(next);
        setLastPromptId(next?.id ?? '');
        setCorrectCellIds([]);
        setWrongCellId('');
        clickLockRef.current = false;
        setIsResolvingAnswer(false);
      }, 420);
      return;
    }

    setWrongCellId(cell.id);
    setCorrectCellIds(currentPrompt.validCellIds);
    setScore((prev) => ({
      ...prev,
      attempts: prev.attempts + 1,
      streak: 0,
    }));
  }

  const accuracyPercent = score.attempts > 0
    ? Math.round((score.correct / score.attempts) * 100)
    : 0;

  let highlightStringIndices = [];
  if (stringHighlightEnabled) {
    if (lessonGroupId === 'group1') {
      highlightStringIndices = currentPrompt?.validStringIndices ?? [];
    } else if (lessonGroupId === 'group2') {
      highlightStringIndices = [selectedStringIndex];
    }
  }

  return (
    <div className="fretboard-game-page">
      <div className="fretboard-game-header card">
        <h2>{lessonTitle}</h2>
      </div>

      <div className="card fretboard-game-controls">
        <div className="fretboard-control-actions">
          <button className="button secondary" type="button" onClick={() => playPrompt()} disabled={!currentPrompt}>Replay note</button>
          <button className="button" type="button" onClick={() => advancePrompt()} disabled={pool.prompts.length === 0 || isResolvingAnswer}>Next note</button>
          <button className="button secondary" type="button" onClick={() => setIsOptionsOpen(true)}>Options</button>
          <button className="button secondary" type="button" onClick={() => setIsStatsOpen(true)}>Stats</button>
          <Link className="button secondary" to="/fretboard-game">Lesson Menu</Link>
        </div>
        {audioReady ? null : <p className="fretboard-hint-text">Loading instrument audio…</p>}
      </div>

      <div className="fretboard-game-main">
        <StaffNoteDisplay
          midi={currentPrompt?.midi}
          showLabel={false}
          keyName={selectedKey}
          showNoteNames={showNoteNames}
        />

        <FretboardDiagram
          fretMin={0}
          fretMax={12}
          onSelectCell={handleAnswerSelection}
          wrongCellId={wrongCellId}
          correctCellIds={correctCellIds}
          highlightStringIndices={highlightStringIndices}
          highlightFretRange={lessonGroupId === 'group3' ? { min: 0, max: 3 } : null}
          showFretLabels
        />
      </div>

      {currentPrompt ? (
        <p className="fretboard-hint-text">
          Click any valid guitar position for {currentPrompt.pitch}. Beginner hints keep the correct string highlighted where applicable.
        </p>
      ) : (
        <p className="fretboard-hint-text">No valid notes for this setting. Try a different lesson or key.</p>
      )}

      {isStatsOpen ? (
        <div className="fretboard-modal-backdrop">
          <dialog className="card fretboard-modal" open aria-label="Fretboard lesson stats">
            <h3>Lesson Stats</h3>
            <div className="fretboard-modal-stats">
              <div className="stat">
                <div className="muted">Accuracy</div>
                <strong>{accuracyPercent}%</strong>
              </div>
              <div className="stat">
                <div className="muted">Streak</div>
                <strong>{score.streak} (best {score.bestStreak})</strong>
              </div>
              <div className="stat">
                <div className="muted">Mastered</div>
                <strong>{masteredCount} / {pool.prompts.length}</strong>
              </div>
              <div className="stat">
                <div className="muted">Range</div>
                <strong>Frets 0–12</strong>
              </div>
            </div>
            <div className="fretboard-modal-actions">
              <button className="button" type="button" onClick={() => setIsStatsOpen(false)}>Close</button>
            </div>
          </dialog>
        </div>
      ) : null}

      {isOptionsOpen ? (
        <div className="fretboard-modal-backdrop">
          <dialog className="card fretboard-modal" open aria-label="Fretboard lesson options">
            <h3>Options</h3>
            <div className="fretboard-modal-fields">
              {lessonGroupId === 'group1' ? null : (
                <div className="row">
                  <span>Key</span>
                  <select
                    value={selectedKey}
                    onChange={(event) => setSelectedKey(event.target.value)}
                  >
                    {SHARP_MAJOR_KEYS.map((keyName) => (
                      <option key={keyName} value={keyName}>{keyName}</option>
                    ))}
                  </select>
                </div>
              )}

              {lessonGroupId === 'group2' ? (
                <div className="row">
                  <span>String</span>
                  <select
                    value={selectedStringIndex}
                    onChange={(event) => setSelectedStringIndex(Number(event.target.value))}
                  >
                    {GUITAR_STRINGS.map((stringInfo) => (
                      <option key={stringInfo.index} value={stringInfo.index}>{stringInfo.label}</option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="row fretboard-audio-row">
                <span>Audio</span>
                <div className="fretboard-audio-controls">
                  <select value={audioMode} onChange={(event) => setAudioMode(event.target.value)}>
                    <option value="instrument">Acoustic guitar mode</option>
                    <option value="pure">Pure tone mode (piano)</option>
                  </select>
                  <select
                    value={stringHighlightEnabled ? 'on' : 'off'}
                    onChange={(event) => setStringHighlightEnabled(event.target.value === 'on')}
                  >
                    <option value="on">String highlight: On</option>
                    <option value="off">String highlight: Off</option>
                  </select>
                </div>
              </div>

              <div className="row">
                <span>Note names</span>
                <select
                  value={showNoteNames ? 'on' : 'off'}
                  onChange={(event) => setShowNoteNames(event.target.value === 'on')}
                >
                  <option value="off">Off</option>
                  <option value="on">On (non-line notes)</option>
                </select>
              </div>
            </div>
            <div className="fretboard-modal-actions">
              <button className="button" type="button" onClick={() => setIsOptionsOpen(false)}>Close</button>
            </div>
          </dialog>
        </div>
      ) : null}
    </div>
  );
}
