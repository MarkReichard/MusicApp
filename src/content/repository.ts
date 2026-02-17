import { Lesson } from '../types/lesson';
import AsyncStorage from '@react-native-async-storage/async-storage';

const REMOTE_LESSONS_CACHE_KEY = 'musicapp.remoteLessons.v1';
const REFRESH_TIMEOUT_MS = 8000;

const preloadedLessons: Lesson[] = [
  require('../../content/lessons/pattern-desc-arpeggio-3.json'),
  require('../../content/lessons/christmas-jingle-bells.json'),
] as Lesson[];

let inMemoryLessons: Lesson[] = [...preloadedLessons];

function mergeLessons(local: Lesson[], remote: Lesson[]): Lesson[] {
  const map = new Map<string, Lesson>();

  for (const lesson of local) {
    map.set(lesson.id, lesson);
  }

  for (const lesson of remote) {
    map.set(lesson.id, lesson);
  }

  return [...map.values()];
}

export async function hydrateLessons(): Promise<Lesson[]> {
  const raw = await AsyncStorage.getItem(REMOTE_LESSONS_CACHE_KEY);
  if (!raw) {
    inMemoryLessons = [...preloadedLessons];
    return inMemoryLessons;
  }

  try {
    const remote = JSON.parse(raw) as Lesson[];
    inMemoryLessons = mergeLessons(preloadedLessons, remote);
    return [...inMemoryLessons];
  } catch {
    inMemoryLessons = [...preloadedLessons];
    return inMemoryLessons;
  }
}

export async function refreshLessonsFromWebService(url: string): Promise<Lesson[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
  const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
  if (!response.ok) {
    throw new Error(`Refresh failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { lessons?: Lesson[] } | Lesson[];
  const remote = Array.isArray(payload) ? payload : payload.lessons ?? [];
  if (!Array.isArray(remote)) {
    throw new Error('Refresh payload is invalid');
  }

  await AsyncStorage.setItem(REMOTE_LESSONS_CACHE_KEY, JSON.stringify(remote));
  inMemoryLessons = mergeLessons(preloadedLessons, remote);
  return [...inMemoryLessons];
}

export function getLessonsSnapshot(): Lesson[] {
  return [...inMemoryLessons];
}

export function getLessonById(lessonId: string): Lesson | undefined {
  return inMemoryLessons.find((lesson) => lesson.id === lessonId);
}

export function groupLessonsByCategory(lessons: Lesson[]): Record<string, Lesson[]> {
  return lessons.reduce<Record<string, Lesson[]>>((acc, lesson) => {
    if (!acc[lesson.category]) {
      acc[lesson.category] = [];
    }
    acc[lesson.category].push(lesson);
    return acc;
  }, {});
}
