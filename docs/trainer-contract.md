# Trainer Contracts (Implementation Guide)

## SolfegeGrid Component Contract

```ts
export type SolfegeSyllable = 'Do' | 'Re' | 'Mi' | 'Fa' | 'Sol' | 'La' | 'Ti';

export interface SolfegeButton {
  syllable: SolfegeSyllable;
  octave: number;
  midi: number;
  label: string; // e.g. Do4
  disabled?: boolean;
}

export interface SolfegeGridProps {
  visibleOctaves: number[]; // e.g. [3,4,5]
  buttons: SolfegeButton[];
  expectedMidi?: number;
  pressedMidi?: number;
  status: 'idle' | 'correct' | 'wrong';
  onPressNote: (note: { syllable: SolfegeSyllable; octave: number; midi: number }) => void;
  onAddOctave?: () => void;
  onRemoveOctave?: () => void;
}
```

## Trainer State Model

```ts
export type InputMode = 'solfege' | 'piano' | 'sing';
export type TrainerStatus = 'waiting' | 'correct' | 'wrong' | 'completed';

export interface TrainerOptions {
  key: string; // C, D, F#, etc.
  tempoBpm: number;
  chunkSize: number;
  inputMode: InputMode;
  visibleOctaves: number[];
  singToleranceCents: number; // default 15
}

export interface TrainerProgress {
  noteIndexInLesson: number;
  noteIndexInChunk: number;
  chunkIndex: number;
  totalChunks: number;
  totalNotes: number;
}

export interface TrainerState {
  lessonId: string;
  status: TrainerStatus;
  options: TrainerOptions;
  progress: TrainerProgress;
  currentChunkNoteMidis: number[];
  expectedMidi: number | null;
  lastInputMidi: number | null;
  wrongCount: number;
  correctCount: number;
}
```

## Trainer Events

```ts
export type TrainerEvent =
  | { type: 'START_SESSION'; lessonId: string }
  | { type: 'SET_OPTIONS'; patch: Partial<TrainerOptions> }
  | { type: 'REPLAY_CHUNK' }
  | { type: 'INPUT_NOTE'; midi: number; source: InputMode }
  | { type: 'ADVANCE_IF_CORRECT' }
  | { type: 'MOVE_TO_NEXT_CHUNK' }
  | { type: 'RESTORE_PROGRESS'; state: Partial<TrainerState> }
  | { type: 'COMPLETE_SESSION' };
```

## Evaluation Rule

- Tempo is ignored for correctness.
- Input is correct when `inputMidi` matches `expectedMidi`.
- For singing:
  - Convert detected frequency to nearest MIDI.
  - Accept if cents offset to expected note is within tolerance (`±singToleranceCents`).

## Replay Behavior

- Replay icon in header dispatches `REPLAY_CHUNK`.
- Replay starts audio from first note of current chunk.
- Replay does not modify `noteIndexInLesson`, `noteIndexInChunk`, or score counters.

## Chunking Behavior

- Session computes chunks from `chunkSize` over lesson note sequence.
- On chunk completion, move to next chunk until lesson complete.
- User may change chunk size from accordion; recompute chunk boundaries from current lesson position.
