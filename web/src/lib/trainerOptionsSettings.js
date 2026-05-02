const STORAGE_KEY = 'musicapp.web.trainerOptions.v1';

/**
 * Returns a per-lesson, per-mode localStorage key.
 * Falls back to the global legacy key if lessonId or mode is missing.
 */
export function trainerOptionsStorageKey(lessonId, mode) {
  if (!lessonId || !mode) {
    return STORAGE_KEY;
  }
  return `${STORAGE_KEY}.${mode}.${lessonId}`;
}

/**
 * Returns true if options have previously been saved for this storage key.
 */
export function hasStoredTrainerOptions(storageKey = STORAGE_KEY) {
  try {
    return globalThis.localStorage.getItem(storageKey) !== null;
  } catch {
    return false;
  }
}

const defaultTrainerOptions = {
  playTonicCadence: true,
  hearExerciseFirst: true,
  karaokeLabelMode: 'lyrics',
  toleranceCents: 25,
  gracePeriodPercent: 95,
  instrument: 'acoustic_grand_piano',
  promptOctaveShift: 0,
};

export function getTrainerOptionsForLesson(lesson, storageKey = STORAGE_KEY, rangeRecommendation = null) {
  const stored = loadTrainerOptionsSettings(storageKey);
  const nothingStored = !hasStoredTrainerOptions(storageKey);

  if (!lesson) {
    return {
      selectedKey: 'C',
      tempoBpm: 60,
      singOctave: 4,
      playTonicCadence: defaultTrainerOptions.playTonicCadence,
      hearExerciseFirst: defaultTrainerOptions.hearExerciseFirst,
      karaokeLabelMode: defaultTrainerOptions.karaokeLabelMode,
      toleranceCents: defaultTrainerOptions.toleranceCents,
      gracePeriodPercent: defaultTrainerOptions.gracePeriodPercent,
    };
  }

  const allowedKeys = lesson.allowedKeys?.length ? lesson.allowedKeys : [lesson.defaultKey ?? 'C'];
  const defaultKey = lesson.defaultKey ?? allowedKeys[0] ?? 'C';
  const rangeKey = nothingStored && rangeRecommendation?.key && allowedKeys.includes(rangeRecommendation.key)
    ? rangeRecommendation.key : null;
  const selectedKey = allowedKeys.includes(stored.selectedKey) ? stored.selectedKey : (rangeKey ?? defaultKey);

  const tempoRange = lesson.tempoRange ?? { min: 30, max: 180 };
  const defaultTempoBpm = lesson.defaultTempoBpm ?? 60;
  const storedTempoBpm = Number(stored.tempoBpm);
  const tempoBase = Number.isFinite(storedTempoBpm) ? storedTempoBpm : defaultTempoBpm;
  const tempoBpm = Math.max(tempoRange.min, Math.min(tempoRange.max, Math.round(tempoBase)));

  const allowedOctaves = lesson.allowedOctaves?.length ? lesson.allowedOctaves : [lesson.defaultOctave ?? 4];
  const defaultOctave = lesson.defaultOctave ?? allowedOctaves[0] ?? 4;
  const storedOctave = Number(stored.singOctave);
  const rangeOctave = nothingStored && Number.isFinite(rangeRecommendation?.octave) && allowedOctaves.includes(rangeRecommendation.octave)
    ? rangeRecommendation.octave : null;
  const singOctave = allowedOctaves.includes(storedOctave) ? storedOctave : (rangeOctave ?? defaultOctave);

  const toleranceRaw = Number(stored.toleranceCents);
  const toleranceCents = Number.isFinite(toleranceRaw)
    ? Math.max(1, Math.min(100, Math.round(toleranceRaw)))
    : defaultTrainerOptions.toleranceCents;

  const graceRaw = Number(stored.gracePeriodPercent);
  const gracePeriodPercent = Number.isFinite(graceRaw)
    ? Math.max(50, Math.min(100, Math.round(graceRaw)))
    : defaultTrainerOptions.gracePeriodPercent;

  const instrument = typeof stored.instrument === 'string' && stored.instrument
    ? stored.instrument
    : defaultTrainerOptions.instrument;
  const karaokeLabelMode = stored.karaokeLabelMode === 'solfege' ? 'solfege' : 'lyrics';

  const storedPromptOctaveShift = Number(stored.promptOctaveShift);
  const promptOctaveShift = Number.isFinite(storedPromptOctaveShift) && [-2, -1, 0, 1, 2].includes(storedPromptOctaveShift)
    ? storedPromptOctaveShift
    : defaultTrainerOptions.promptOctaveShift;

  return {
    selectedKey,
    tempoBpm,
    singOctave,
    playTonicCadence: Boolean(stored.playTonicCadence),
    hearExerciseFirst: stored.hearExerciseFirst !== false,
    karaokeLabelMode,
    toleranceCents,
    gracePeriodPercent,
    instrument,
    promptOctaveShift,
  };
}

export function saveTrainerOptionsSettings(nextSettings, storageKey = STORAGE_KEY) {
  const current = loadTrainerOptionsSettings(storageKey);
  const merged = { ...current, ...nextSettings };

  try {
    globalThis.localStorage.setItem(storageKey, JSON.stringify(merged));
  } catch {
    // ignore storage failures
  }
}

function loadTrainerOptionsSettings(storageKey = STORAGE_KEY) {
  try {
    const raw = globalThis.localStorage.getItem(storageKey);
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
