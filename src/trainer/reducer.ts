import { Lesson } from '../types/lesson';
import { TrainerEvent, TrainerOptions, TrainerProgress, TrainerState } from './types';
import { normalizeTrainerOptions } from './options';

const DEFAULT_OPTIONS: TrainerOptions = {
  key: 'C',
  tempoBpm: 90,
  chunkSize: 5,
  inputMode: 'solfege',
  visibleOctaves: [3, 4],
  singToleranceCents: 15,
};

function buildProgress(lesson: Lesson, chunkSize: number, noteIndexInLesson = 0): TrainerProgress {
  const totalNotes = lesson.notes.length;
  const totalChunks = Math.max(1, Math.ceil(totalNotes / chunkSize));
  const chunkIndex = Math.floor(noteIndexInLesson / chunkSize);
  const noteIndexInChunk = noteIndexInLesson % chunkSize;

  return {
    noteIndexInLesson,
    noteIndexInChunk,
    chunkIndex,
    totalChunks,
    totalNotes,
  };
}

function chunkBounds(totalNotes: number, chunkSize: number, chunkIndex: number) {
  const chunkStart = chunkIndex * chunkSize;
  const chunkEndExclusive = Math.min(totalNotes, chunkStart + chunkSize);
  return { chunkStart, chunkEndExclusive };
}

export const initialTrainerState: TrainerState = {
  lesson: null,
  status: 'waiting',
  options: DEFAULT_OPTIONS,
  progress: {
    noteIndexInLesson: 0,
    noteIndexInChunk: 0,
    chunkIndex: 0,
    totalChunks: 0,
    totalNotes: 0,
  },
  chunkStart: 0,
  chunkEndExclusive: 0,
  expectedMidi: null,
  lastInputMidi: null,
  wrongCount: 0,
  correctCount: 0,
};

export function trainerReducer(state: TrainerState, event: TrainerEvent): TrainerState {
  switch (event.type) {
    case 'START_SESSION': {
      const lesson = event.lesson;
      const rawOptions: TrainerOptions = {
        ...DEFAULT_OPTIONS,
        key: lesson.defaultKey,
        tempoBpm: lesson.defaultTempoBpm,
        chunkSize: lesson.defaultChunkSize,
        visibleOctaves: lesson.allowedOctaves.slice(0, Math.min(2, lesson.allowedOctaves.length)),
      };
      const options = normalizeTrainerOptions(lesson, rawOptions, rawOptions);
      const progress = buildProgress(lesson, options.chunkSize, 0);
      const bounds = chunkBounds(progress.totalNotes, options.chunkSize, progress.chunkIndex);

      return {
        ...state,
        lesson,
        status: 'waiting',
        options,
        progress,
        ...bounds,
        expectedMidi: lesson.notes[0]?.midi ?? null,
        lastInputMidi: null,
        wrongCount: 0,
        correctCount: 0,
      };
    }

    case 'SET_OPTIONS': {
      if (!state.lesson) {
        return state;
      }

      const nextOptions = normalizeTrainerOptions(state.lesson, event.patch, state.options);
      const progress = buildProgress(state.lesson, nextOptions.chunkSize, state.progress.noteIndexInLesson);
      const bounds = chunkBounds(progress.totalNotes, nextOptions.chunkSize, progress.chunkIndex);

      return {
        ...state,
        options: nextOptions,
        progress,
        ...bounds,
      };
    }

    case 'REPLAY_CHUNK': {
      return {
        ...state,
        status: 'waiting',
      };
    }

    case 'INPUT_NOTE': {
      if (!state.lesson || state.expectedMidi === null) {
        return state;
      }

      const isSingWithinTolerance =
        event.source !== 'sing'
          ? true
          : Math.abs(event.centsOffset ?? 0) <= state.options.singToleranceCents;

      const isCorrect = event.midi === state.expectedMidi && isSingWithinTolerance;
      if (!isCorrect) {
        return {
          ...state,
          status: 'wrong',
          lastInputMidi: event.midi,
          wrongCount: state.wrongCount + 1,
        };
      }

      const nextIndex = state.progress.noteIndexInLesson + 1;
      if (nextIndex >= state.progress.totalNotes) {
        return {
          ...state,
          status: 'completed',
          lastInputMidi: event.midi,
          correctCount: state.correctCount + 1,
          expectedMidi: null,
        };
      }

      const progress = buildProgress(state.lesson, state.options.chunkSize, nextIndex);
      const bounds = chunkBounds(progress.totalNotes, state.options.chunkSize, progress.chunkIndex);
      const expectedMidi = state.lesson.notes[nextIndex]?.midi ?? null;

      return {
        ...state,
        status: 'correct',
        lastInputMidi: event.midi,
        correctCount: state.correctCount + 1,
        progress,
        ...bounds,
        expectedMidi,
      };
    }

    case 'MOVE_TO_NEXT_CHUNK': {
      if (!state.lesson) {
        return state;
      }

      const nextChunkIndex = state.progress.chunkIndex + 1;
      if (nextChunkIndex >= state.progress.totalChunks) {
        return {
          ...state,
          status: 'completed',
          expectedMidi: null,
        };
      }

      const noteIndex = nextChunkIndex * state.options.chunkSize;
      const progress = buildProgress(state.lesson, state.options.chunkSize, noteIndex);
      const bounds = chunkBounds(progress.totalNotes, state.options.chunkSize, progress.chunkIndex);

      return {
        ...state,
        status: 'waiting',
        progress,
        ...bounds,
        expectedMidi: state.lesson.notes[noteIndex]?.midi ?? null,
      };
    }

    case 'COMPLETE_SESSION': {
      return {
        ...state,
        status: 'completed',
        expectedMidi: null,
      };
    }

    default:
      return state;
  }
}
