const STORAGE_KEY = 'musicapp.web.pitchStability.v1';

const DEFAULTS = {
  selectedKey: 'C',
  selectedInstrument: 'acoustic_grand_piano',
  noteCount: 5,
  toleranceCents: 50,
  selectedOctave: 4,
  matchTimeS: 2.5,
};

const VALID_INSTRUMENTS = new Set([
  'acoustic_grand_piano',
  'flute',
  'violin',
  'electric_guitar_clean',
  'choir_aahs',
]);

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function loadPitchStabilitySettings() {
  const stored = load();

  const noteCount = Number(stored.noteCount);
  const toleranceCents = Number(stored.toleranceCents);
  const selectedOctave = Number(stored.selectedOctave);
  const matchTimeS = Number(stored.matchTimeS);

  return {
    selectedKey: typeof stored.selectedKey === 'string' && stored.selectedKey
      ? stored.selectedKey
      : DEFAULTS.selectedKey,
    selectedInstrument: typeof stored.selectedInstrument === 'string' && VALID_INSTRUMENTS.has(stored.selectedInstrument)
      ? stored.selectedInstrument
      : DEFAULTS.selectedInstrument,
    noteCount: Number.isFinite(noteCount) && noteCount >= 1
      ? Math.round(noteCount)
      : DEFAULTS.noteCount,
    toleranceCents: Number.isFinite(toleranceCents)
      ? Math.max(0, Math.min(50, Math.round(toleranceCents)))
      : DEFAULTS.toleranceCents,
    selectedOctave: Number.isFinite(selectedOctave)
      ? Math.max(2, Math.min(6, Math.round(selectedOctave)))
      : DEFAULTS.selectedOctave,
    matchTimeS: Number.isFinite(matchTimeS)
      ? Math.max(0.5, Math.min(6, Math.round(matchTimeS * 10) / 10))
      : DEFAULTS.matchTimeS,
  };
}

export function savePitchStabilitySettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore quota/private-mode errors
  }
}
