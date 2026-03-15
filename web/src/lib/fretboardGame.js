import { KEY_TO_SEMITONE, MAJOR_SCALE_SEMITONES, NOTE_NAMES } from './musicTheory';

export const FRETBOARD_GAME_PROGRESS_STORAGE_KEY = 'musicapp.web.fretboardGame.progress.v1';

export const LESSON_GROUPS = [
  { id: 'group1', label: 'Lesson 1: Open Strings' },
  { id: 'group2', label: 'Lesson 2: Single String Mapping' },
  { id: 'group3', label: 'Lesson 3: First Position' },
];

export const GUITAR_STRINGS = [
  { index: 0, label: '6 (E2)', openMidi: 40 },
  { index: 1, label: '5 (A2)', openMidi: 45 },
  { index: 2, label: '4 (D3)', openMidi: 50 },
  { index: 3, label: '3 (G3)', openMidi: 55 },
  { index: 4, label: '2 (B3)', openMidi: 59 },
  { index: 5, label: '1 (E4)', openMidi: 64 },
];

export const SHARP_MAJOR_KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToPitchSharp(midi) {
  if (!Number.isFinite(midi)) return '-';
  const roundedMidi = Math.round(midi);
  const octave = Math.floor(roundedMidi / 12) - 1;
  const noteName = NOTE_NAMES[((roundedMidi % 12) + 12) % 12] ?? 'C';
  return `${noteName}${octave}`;
}

function isDiatonicInKey(midi, key) {
  const tonic = KEY_TO_SEMITONE[key] ?? 0;
  const semitone = ((midi - tonic) % 12 + 12) % 12;
  return MAJOR_SCALE_SEMITONES.slice(0, 7).includes(semitone);
}

function buildAllCells(fretMin, fretMax) {
  const cells = [];
  for (const stringInfo of GUITAR_STRINGS) {
    for (let fret = fretMin; fret <= fretMax; fret += 1) {
      const midi = stringInfo.openMidi + fret;
      cells.push({
        id: `s${stringInfo.index}-f${fret}`,
        stringIndex: stringInfo.index,
        stringLabel: stringInfo.label,
        fret,
        midi,
        pitch: midiToPitchSharp(midi),
      });
    }
  }
  return cells;
}

function groupCellsIntoPrompts(cells, groupId, selectedKey, selectedStringIndex) {
  const byMidi = new Map();
  for (const cell of cells) {
    const existing = byMidi.get(cell.midi);
    if (!existing) {
      const scopeToken = groupId === 'group2' ? `s${selectedStringIndex}` : 'all';
      byMidi.set(cell.midi, {
        id: `${groupId}:${selectedKey}:${scopeToken}:${cell.midi}`,
        midi: cell.midi,
        pitch: cell.pitch,
        validCellIds: [cell.id],
        validStringIndices: [cell.stringIndex],
      });
      continue;
    }
    existing.validCellIds.push(cell.id);
    if (!existing.validStringIndices.includes(cell.stringIndex)) {
      existing.validStringIndices.push(cell.stringIndex);
    }
  }
  return [...byMidi.values()].sort((a, b) => a.midi - b.midi);
}

export function buildPromptPool({ groupId, selectedKey, selectedStringIndex }) {
  let fretMin = 0;
  let fretMax = 12;

  if (groupId === 'group1') {
    fretMax = 0;
  } else if (groupId === 'group3') {
    fretMax = 3;
  }

  let cells = buildAllCells(fretMin, fretMax);

  if (groupId === 'group2') {
    cells = cells.filter((cell) => cell.stringIndex === selectedStringIndex);
  }

  if (groupId === 'group2' || groupId === 'group3') {
    cells = cells.filter((cell) => isDiatonicInKey(cell.midi, selectedKey));
  }

  return {
    groupId,
    fretMin,
    fretMax,
    allCells: buildAllCells(fretMin, fretMax),
    prompts: groupCellsIntoPrompts(cells, groupId, selectedKey, selectedStringIndex),
  };
}

function defaultProgressEntry(nowMs) {
  return {
    attempts: 0,
    correct: 0,
    incorrect: 0,
    interval: 1,
    difficulty: 1,
    lastSeen: 0,
    dueAt: nowMs,
  };
}

export function selectNextPrompt(prompts, progressByPromptId, lastPromptId) {
  if (!prompts.length) return null;
  const now = Date.now();
  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const prompt of prompts) {
    const state = progressByPromptId[prompt.id] ?? defaultProgressEntry(now);
    const dueBoost = state.dueAt <= now ? 1000 + (now - state.dueAt) / 1000 : -((state.dueAt - now) / 1000);
    const difficultyBoost = state.difficulty * 6;
    const intervalPenalty = state.interval * 0.8;
    const repeatPenalty = prompt.id === lastPromptId ? 24 : 0;
    const randomJitter = Math.random() * 3;
    const score = dueBoost + difficultyBoost - intervalPenalty - repeatPenalty + randomJitter;

    if (score > bestScore) {
      bestScore = score;
      best = prompt;
    }
  }

  return best;
}

export function recordPromptAttempt(progressByPromptId, promptId, wasCorrect) {
  const now = Date.now();
  const prev = progressByPromptId[promptId] ?? defaultProgressEntry(now);

  const nextInterval = wasCorrect
    ? Math.min(64, Math.max(1, prev.interval * 2))
    : 1;

  const nextDifficulty = wasCorrect
    ? Math.max(0.5, prev.difficulty - 0.2)
    : Math.min(12, prev.difficulty + 1);

  const nextDueAt = wasCorrect
    ? now + nextInterval * 15000
    : now + 2000;

  return {
    ...progressByPromptId,
    [promptId]: {
      attempts: prev.attempts + 1,
      correct: prev.correct + (wasCorrect ? 1 : 0),
      incorrect: prev.incorrect + (wasCorrect ? 0 : 1),
      interval: nextInterval,
      difficulty: nextDifficulty,
      lastSeen: now,
      dueAt: nextDueAt,
    },
  };
}

export function loadFretboardProgress() {
  try {
    const raw = globalThis.localStorage?.getItem(FRETBOARD_GAME_PROGRESS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function saveFretboardProgress(progressByPromptId) {
  try {
    globalThis.localStorage?.setItem(FRETBOARD_GAME_PROGRESS_STORAGE_KEY, JSON.stringify(progressByPromptId));
  } catch {
    // ignore storage failures
  }
}

export function countMasteredPrompts(prompts, progressByPromptId) {
  let mastered = 0;
  for (const prompt of prompts) {
    const state = progressByPromptId[prompt.id];
    if (!state) continue;
    if (state.correct >= 3 && state.interval >= 8) mastered += 1;
  }
  return mastered;
}
