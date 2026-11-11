// Leitner-box style spaced repetition memory for the Pitch Match trainer.
// Tracks per-(key, midi) performance so problematic notes resurface sooner.

const STORAGE_KEY = 'musicapp.web.pitchMatch.memory.v1';

// Box index -> delay before the note is "due" again after a correct answer.
const BOX_INTERVALS_MS = [
  0,                        // box 0: due immediately (new mistake)
  15 * 60 * 1000,           // box 1: 15 minutes
  60 * 60 * 1000,           // box 2: 1 hour
  6 * 60 * 60 * 1000,       // box 3: 6 hours
  24 * 60 * 60 * 1000,      // box 4: 1 day
  3 * 24 * 60 * 60 * 1000,  // box 5: 3 days (mastered)
];
const MAX_BOX = BOX_INTERVALS_MS.length - 1;

const NEW_NOTE_WEIGHT = 3;
const NOT_DUE_WEIGHT = 1;
const DUE_WEIGHT_BASE = 4;

export function getPitchMatchItemId(selectedKey, midi) {
  return `${selectedKey}:${midi}`;
}

export function loadPitchMatchMemory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function savePitchMatchMemory(memory) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory ?? {}));
  } catch {
    // ignore quota/private-mode errors
  }
}

export function resetPitchMatchMemory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore quota/private-mode errors
  }
  return {};
}

// Correct answers climb a box (longer until due again); any miss drops back to box 0.
export function recordPitchMatchResult(memory, itemId, wasCorrect, now = Date.now()) {
  const existing = memory[itemId];
  const box = wasCorrect ? Math.min((existing?.box ?? 0) + 1, MAX_BOX) : 0;
  return {
    ...memory,
    [itemId]: {
      box,
      due: now + BOX_INTERVALS_MS[box],
      correctCount: (existing?.correctCount ?? 0) + (wasCorrect ? 1 : 0),
      wrongCount: (existing?.wrongCount ?? 0) + (wasCorrect ? 0 : 1),
      updatedAt: now,
    },
  };
}

export function getPitchMatchMemoryStats(memory, now = Date.now()) {
  const entries = Object.values(memory ?? {});
  const dueCount = entries.filter((entry) => now >= entry.due).length;
  return { trackedCount: entries.length, dueCount };
}

function getNoteWeight(entry, now) {
  if (!entry) return NEW_NOTE_WEIGHT;
  if (now >= entry.due) {
    // Lower boxes (more recent mistakes) are weighted more heavily.
    return DUE_WEIGHT_BASE + (MAX_BOX - entry.box);
  }
  return NOT_DUE_WEIGHT;
}

function weightedPick(pool) {
  const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  let roll = Math.random() * totalWeight;
  for (const item of pool) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return pool[pool.length - 1];
}

// Weighted draw biased toward due/problematic notes; refills the pool to allow
// repeats when noteCount exceeds the number of candidates.
export function buildSpacedRepetitionExercise(selectedKey, candidates, noteCount, memory, now = Date.now()) {
  if (!candidates.length) return [];

  const basePool = candidates.map((note) => ({
    note,
    weight: getNoteWeight(memory[getPitchMatchItemId(selectedKey, note.midi)], now),
  }));

  const exercise = [];
  let pool = [...basePool];
  for (let i = 0; i < noteCount; i++) {
    if (pool.length === 0) pool = [...basePool];
    const picked = weightedPick(pool);
    exercise.push(picked.note);
    pool = pool.filter((item) => item !== picked);
  }
  return exercise;
}
