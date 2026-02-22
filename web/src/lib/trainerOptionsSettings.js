const STORAGE_KEY = 'musicapp.web.trainerOptions.v1';

const defaultTrainerOptions = {
  playTonicCadence: true,
  toleranceCents: 25,
  gracePeriodPercent: 95,
};

export function getTrainerOptionsForLesson(lesson) {
  const stored = loadTrainerOptionsSettings();

  if (!lesson) {
    return {
      selectedKey: 'C',
      tempoBpm: 60,
      singOctave: 4,
      playTonicCadence: defaultTrainerOptions.playTonicCadence,
      toleranceCents: defaultTrainerOptions.toleranceCents,
      gracePeriodPercent: defaultTrainerOptions.gracePeriodPercent,
    };
  }

  const allowedKeys = lesson.allowedKeys?.length ? lesson.allowedKeys : [lesson.defaultKey ?? 'C'];
  const defaultKey = lesson.defaultKey ?? allowedKeys[0] ?? 'C';
  const selectedKey = allowedKeys.includes(stored.selectedKey) ? stored.selectedKey : defaultKey;

  const tempoRange = lesson.tempoRange ?? { min: 30, max: 180 };
  const defaultTempoBpm = lesson.defaultTempoBpm ?? 60;
  const storedTempoBpm = Number(stored.tempoBpm);
  const tempoBase = Number.isFinite(storedTempoBpm) ? storedTempoBpm : defaultTempoBpm;
  const tempoBpm = Math.max(tempoRange.min, Math.min(tempoRange.max, Math.round(tempoBase)));

  const allowedOctaves = lesson.allowedOctaves?.length ? lesson.allowedOctaves : [lesson.defaultOctave ?? 4];
  const defaultOctave = lesson.defaultOctave ?? allowedOctaves[0] ?? 4;
  const storedOctave = Number(stored.singOctave);
  const singOctave = allowedOctaves.includes(storedOctave) ? storedOctave : defaultOctave;

  const toleranceRaw = Number(stored.toleranceCents);
  const toleranceCents = Number.isFinite(toleranceRaw)
    ? Math.max(1, Math.min(100, Math.round(toleranceRaw)))
    : defaultTrainerOptions.toleranceCents;

  const graceRaw = Number(stored.gracePeriodPercent);
  const gracePeriodPercent = Number.isFinite(graceRaw)
    ? Math.max(50, Math.min(100, Math.round(graceRaw)))
    : defaultTrainerOptions.gracePeriodPercent;

  return {
    selectedKey,
    tempoBpm,
    singOctave,
    playTonicCadence: Boolean(stored.playTonicCadence),
    toleranceCents,
    gracePeriodPercent,
  };
}

export function saveTrainerOptionsSettings(nextSettings) {
  const current = loadTrainerOptionsSettings();
  const merged = { ...current, ...nextSettings };

  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // ignore storage failures
  }
}

function loadTrainerOptionsSettings() {
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...defaultTrainerOptions };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { ...defaultTrainerOptions };
    }
    return { ...defaultTrainerOptions, ...parsed };
  } catch {
    return { ...defaultTrainerOptions };
  }
}
