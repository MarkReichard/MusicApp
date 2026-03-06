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
 * Weight formula:  1 / (successRate + 0.1)
 * Untried degrees get a high initial weight of 4.0 so they are explored first.
 */
export function pickWeightedDegree(history) {
  const weights = EAR_DEGREES.map((_, i) => {
    const entry = history[i];
    if (!entry || entry.attempts === 0) return 4;
    const rate = entry.successes / entry.attempts;
    return 1 / (rate + 0.1);
  });

  const total = weights.reduce((sum, w) => sum + w, 0);
  let rand = Math.random() * total;

  for (let i = 0; i < weights.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return i;
  }
  return weights.length - 1;
}
