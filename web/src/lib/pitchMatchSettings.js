const STORAGE_KEY = 'musicapp.web.pitchMatch.v1';

const DEFAULTS = {
  selectedKey:    'C',
  noteCount:      5,
  toleranceCents: 50,
  toneDurationS:  1.2,
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function loadPitchMatchSettings() {
  const stored = load();

  const noteCount = Number(stored.noteCount);
  const toleranceCents = Number(stored.toleranceCents);
  const toneDurationS = Number(stored.toneDurationS);

  return {
    selectedKey: typeof stored.selectedKey === 'string' && stored.selectedKey
      ? stored.selectedKey
      : DEFAULTS.selectedKey,
    noteCount: Number.isFinite(noteCount) && noteCount >= 1
      ? Math.round(noteCount)
      : DEFAULTS.noteCount,
    toleranceCents: Number.isFinite(toleranceCents)
      ? Math.max(1, Math.min(100, Math.round(toleranceCents)))
      : DEFAULTS.toleranceCents,
    toneDurationS: Number.isFinite(toneDurationS) && toneDurationS > 0
      ? toneDurationS
      : DEFAULTS.toneDurationS,
  };
}

export function savePitchMatchSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore quota/private-mode errors
  }
}
