import AsyncStorage from '@react-native-async-storage/async-storage';

const LESSON_PROGRESS_KEY = 'musicapp.lessonProgress.v1';

export interface LessonProgressSummary {
  lessonId: string;
  attempts: number;
  completedAttempts: number;
  totalCorrect: number;
  totalWrong: number;
  bestAccuracy: number;
  lastAccuracy: number;
  lastPracticedAt: string;
}

export type LessonProgressMap = Record<string, LessonProgressSummary>;

function clampAccuracy(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function computeAccuracy(correct: number, wrong: number): number {
  const total = correct + wrong;
  if (total <= 0) {
    return 0;
  }
  return (correct / total) * 100;
}

export async function loadLessonProgressMap(): Promise<LessonProgressMap> {
  const raw = await AsyncStorage.getItem(LESSON_PROGRESS_KEY);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as LessonProgressMap;
  } catch {
    return {};
  }
}

export async function saveLessonAttempt(params: {
  lessonId: string;
  correctCount: number;
  wrongCount: number;
  completed: boolean;
  practicedAt?: string;
}): Promise<void> {
  const { lessonId, completed } = params;
  const correctCount = Math.max(0, params.correctCount);
  const wrongCount = Math.max(0, params.wrongCount);
  const practicedAt = params.practicedAt ?? new Date().toISOString();
  const accuracy = clampAccuracy(computeAccuracy(correctCount, wrongCount));

  const map = await loadLessonProgressMap();
  const existing = map[lessonId];

  const next: LessonProgressSummary = {
    lessonId,
    attempts: (existing?.attempts ?? 0) + 1,
    completedAttempts: (existing?.completedAttempts ?? 0) + (completed ? 1 : 0),
    totalCorrect: (existing?.totalCorrect ?? 0) + correctCount,
    totalWrong: (existing?.totalWrong ?? 0) + wrongCount,
    bestAccuracy: Math.max(existing?.bestAccuracy ?? 0, accuracy),
    lastAccuracy: accuracy,
    lastPracticedAt: practicedAt,
  };

  map[lessonId] = next;
  await AsyncStorage.setItem(LESSON_PROGRESS_KEY, JSON.stringify(map));
}
