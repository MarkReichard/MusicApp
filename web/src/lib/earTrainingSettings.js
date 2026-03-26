/**
 * Ear training spaced-repetition storage.
 *
 * Tracks per-degree attempt/success history and uses a weighted-random
 * algorithm to surface the degrees the user struggles with most.
 *
 * Storage key: musicapp.web.earTraining.v1
 * Shape: { [degreeIndex: number]: { attempts: number, successes: number } }
 */

const STORAGE_KEY = 'musicapp.web.earTraining.v1';

/** All 8 scale degrees tracked by the ear trainer. */
export const EAR_DEGREES = [
  { name: 'Do',  label: 'Do (low)',  semitones: 0  },
  { name: 'Re',  label: 'Re',        semitones: 2  },
  { name: 'Mi',  label: 'Mi',        semitones: 4  },
  { name: 'Fa',  label: 'Fa',        semitones: 5  },
  { name: 'Sol', label: 'Sol',       semitones: 7  },
  { name: 'La',  label: 'La',        semitones: 9  },
  { name: 'Ti',  label: 'Ti',        semitones: 11 },
  { name: "Do'", label: 'Do (high)', semitones: 12 },
];

/** Load history object from localStorage. Returns {} on failure. */
export function loadEarTrainingHistory() {
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

/** Persist updated history to localStorage. */
export function saveEarTrainingHistory(history) {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // ignore storage failures
  }
}

/**
 * Returns a new history object with the attempt recorded for the given degree.
 * Does not mutate the original.
 */
export function recordAttempt(history, degreeIndex, succeeded) {
  const current = history[degreeIndex] ?? { attempts: 0, successes: 0 };
  return {
    ...history,
    [degreeIndex]: {
      attempts: current.attempts + 1,
      successes: current.successes + (succeeded ? 1 : 0),
    },
  };
}

/**
 * Weighted-random degree selection.
 *
 * - Selection is restricted to candidate degree indices when provided.
 * - Lower success rates get much higher weight so weak items repeat more.
 * - Untried items keep a high exploration weight.
 */
export function pickWeightedDegree(history, candidateDegreeIndices = null) {
  const candidateIndices = Array.isArray(candidateDegreeIndices) && candidateDegreeIndices.length
    ? candidateDegreeIndices.filter((index) => Number.isInteger(index) && index >= 0 && index < EAR_DEGREES.length)
    : EAR_DEGREES.map((_, index) => index);

  if (!candidateIndices.length) {
    return 0;
  }

  const weightedCandidates = candidateIndices.map((index) => {
    const entry = history[index];
    if (!entry || entry.attempts <= 0) {
      return { index, weight: 5 };
    }

    const successRate = entry.successes / entry.attempts;
    const failureRate = 1 - successRate;
    const weight = 0.2 + Math.pow(failureRate + 0.15, 2) * 6;
    return { index, weight };
  });

  const total = weightedCandidates.reduce((sum, item) => sum + item.weight, 0);
  let rand = Math.random() * total;

  for (const item of weightedCandidates) {
    rand -= item.weight;
    if (rand <= 0) return item.index;
  }
  return weightedCandidates.at(-1).index;
}
