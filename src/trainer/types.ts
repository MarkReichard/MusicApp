import { Lesson } from '../types/lesson';

export type InputMode = 'solfege' | 'piano' | 'sing';
export type TrainerStatus = 'waiting' | 'correct' | 'wrong' | 'completed';

export interface TrainerOptions {
  key: string;
  tempoBpm: number;
  chunkSize: number;
  inputMode: InputMode;
  visibleOctaves: number[];
  singToleranceCents: number;
}

export interface TrainerProgress {
  noteIndexInLesson: number;
  noteIndexInChunk: number;
  chunkIndex: number;
  totalChunks: number;
  totalNotes: number;
}

export interface TrainerState {
  lesson: Lesson | null;
  status: TrainerStatus;
  options: TrainerOptions;
  progress: TrainerProgress;
  chunkStart: number;
  chunkEndExclusive: number;
  expectedMidi: number | null;
  lastInputMidi: number | null;
  wrongCount: number;
  correctCount: number;
}

export type TrainerEvent =
  | { type: 'START_SESSION'; lesson: Lesson }
  | { type: 'SET_OPTIONS'; patch: Partial<TrainerOptions> }
  | { type: 'REPLAY_CHUNK' }
  | { type: 'INPUT_NOTE'; midi: number; source: InputMode; centsOffset?: number }
  | { type: 'MOVE_TO_NEXT_CHUNK' }
  | { type: 'COMPLETE_SESSION' };
