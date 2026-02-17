import AsyncStorage from '@react-native-async-storage/async-storage';
import { InputMode, TrainerOptions } from '../trainer/types';

const GLOBAL_SETTINGS_KEY = 'musicapp.globalSettings.v1';
const LESSON_OVERRIDES_KEY = 'musicapp.lessonOverrides.v1';

export interface GlobalSettings {
  tempoBpm: number;
  chunkSize: number;
  inputMode: InputMode;
  singToleranceCents: number;
  visibleOctaves: number[];
}

export type LessonOverrideMap = Record<string, Partial<TrainerOptions>>;

const defaultGlobalSettings: GlobalSettings = {
  tempoBpm: 90,
  chunkSize: 5,
  inputMode: 'solfege',
  singToleranceCents: 15,
  visibleOctaves: [3, 4],
};

export async function loadGlobalSettings(): Promise<GlobalSettings> {
  const raw = await AsyncStorage.getItem(GLOBAL_SETTINGS_KEY);
  if (!raw) {
    return defaultGlobalSettings;
  }

  try {
    return { ...defaultGlobalSettings, ...(JSON.parse(raw) as Partial<GlobalSettings>) };
  } catch {
    return defaultGlobalSettings;
  }
}

export async function saveGlobalSettings(settings: GlobalSettings): Promise<void> {
  await AsyncStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadLessonOverrides(): Promise<LessonOverrideMap> {
  const raw = await AsyncStorage.getItem(LESSON_OVERRIDES_KEY);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as LessonOverrideMap;
  } catch {
    return {};
  }
}

export async function saveLessonOverride(lessonId: string, patch: Partial<TrainerOptions>): Promise<void> {
  const all = await loadLessonOverrides();
  all[lessonId] = {
    ...all[lessonId],
    ...patch,
  };

  await AsyncStorage.setItem(LESSON_OVERRIDES_KEY, JSON.stringify(all));
}

export function getDefaultGlobalSettings() {
  return defaultGlobalSettings;
}
