import { Lesson } from '../types/lesson';
import { InputMode, TrainerOptions } from './types';

const INPUT_MODES: InputMode[] = ['solfege', 'piano', 'sing'];
const FALLBACK_CHUNK_RANGE = { min: 1, max: 32 };
const FALLBACK_TEMPO_RANGE = { min: 30, max: 240 };
const FALLBACK_TOLERANCE_RANGE = { min: 1, max: 100 };

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}

export function normalizeTrainerOptions(
  lesson: Lesson,
  candidate: Partial<TrainerOptions>,
  current: TrainerOptions,
): TrainerOptions {
  const key = candidate.key && lesson.allowedKeys.includes(candidate.key) ? candidate.key : current.key;
  const safeKey = lesson.allowedKeys.includes(key) ? key : lesson.defaultKey;

  const tempoMin = lesson.tempoRange?.min ?? FALLBACK_TEMPO_RANGE.min;
  const tempoMax = lesson.tempoRange?.max ?? FALLBACK_TEMPO_RANGE.max;
  const tempoSource = candidate.tempoBpm ?? current.tempoBpm;
  const tempoBpm = clampInt(tempoSource, tempoMin, tempoMax);

  const chunkMin = lesson.chunkSizeRange?.min ?? FALLBACK_CHUNK_RANGE.min;
  const chunkMax = lesson.chunkSizeRange?.max ?? FALLBACK_CHUNK_RANGE.max;
  const chunkSource = candidate.chunkSize ?? current.chunkSize;
  const chunkSize = clampInt(chunkSource, chunkMin, chunkMax);

  const toleranceSource = candidate.singToleranceCents ?? current.singToleranceCents;
  const singToleranceCents = clampInt(
    toleranceSource,
    FALLBACK_TOLERANCE_RANGE.min,
    FALLBACK_TOLERANCE_RANGE.max,
  );

  const inputModeCandidate = candidate.inputMode ?? current.inputMode;
  const inputMode = INPUT_MODES.includes(inputModeCandidate) ? inputModeCandidate : current.inputMode;

  const visibleOctavesSource = candidate.visibleOctaves ?? current.visibleOctaves;
  const visibleOctaves = visibleOctavesSource
    .filter((octave) => lesson.allowedOctaves.includes(octave))
    .sort((a, b) => a - b);

  const safeVisibleOctaves =
    visibleOctaves.length > 0
      ? Array.from(new Set(visibleOctaves))
      : lesson.allowedOctaves.includes(lesson.defaultOctave)
        ? [lesson.defaultOctave]
        : lesson.allowedOctaves.slice(0, 1);

  return {
    key: safeKey,
    tempoBpm,
    chunkSize,
    inputMode,
    visibleOctaves: safeVisibleOctaves,
    singToleranceCents,
  };
}
