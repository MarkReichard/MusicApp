export type LessonCategory = '3_note_pattern' | 'christmas_songs' | string;
export type LessonType = 'pattern' | 'song';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export type SolfegeDegree = 'Do' | 'Re' | 'Mi' | 'Fa' | 'Sol' | 'La' | 'Ti';

export interface LessonNote {
  pitch: string;
  midi: number;
  degree: SolfegeDegree;
  durationBeats: number;
}

export interface LessonPhrase {
  startNoteIndex: number;
  endNoteIndex: number;
  label: string;
}

export interface PatternDefinition {
  relativeSemitones: number[];
  length: number;
}

export interface RangeInt {
  min: number;
  max: number;
}

export interface LessonSource {
  kind: 'preloaded' | 'remote';
  version?: string;
}

export interface Lesson {
  id: string;
  name: string;
  category: LessonCategory;
  type: LessonType;
  difficulty: Difficulty;
  tags?: string[];
  defaultKey: string;
  allowedKeys: string[];
  defaultTempoBpm: number;
  tempoRange: RangeInt;
  defaultChunkSize: number;
  chunkSizeRange: RangeInt;
  defaultOctave: number;
  allowedOctaves: number[];
  notes: LessonNote[];
  phrases?: LessonPhrase[];
  patternDefinition?: PatternDefinition;
  source?: LessonSource;
  updatedAt?: string;
}
