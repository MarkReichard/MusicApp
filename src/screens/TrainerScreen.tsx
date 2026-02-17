import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { getLessonById } from '../content/repository';
import { RootStackParamList } from '../navigation/types';
import { initialTrainerState, trainerReducer } from '../trainer/reducer';
import { InputMode, TrainerOptions } from '../trainer/types';
import { LessonOptionsAccordion } from '../components/LessonOptionsAccordion';
import { SolfegeGrid } from '../components/SolfegeGrid';
import { PianoTwoOctave } from '../components/PianoTwoOctave';
import {
  getDefaultGlobalSettings,
  loadGlobalSettings,
  loadLessonOverrides,
  saveGlobalSettings,
  saveLessonOverride,
} from '../storage/settings';
import { playMidiSequence, stopAllPlayback } from '../audio/playback';
import { useMicInput } from '../pitch/micInput';
import { saveLessonAttempt } from '../storage/progress';
import { normalizeTrainerOptions } from '../trainer/options';

type Props = NativeStackScreenProps<RootStackParamList, 'Trainer'>;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function modeLabel(mode: InputMode) {
  switch (mode) {
    case 'sing':
      return 'Sing';
    case 'piano':
      return 'Piano';
    default:
      return 'Solfege';
  }
}

function statusText(status: 'waiting' | 'correct' | 'wrong' | 'completed') {
  if (status === 'correct') return 'Correct';
  if (status === 'wrong') return 'Wrong';
  if (status === 'completed') return 'Completed';
  return 'Waiting';
}

function midiToNoteLabel(midi: number | null) {
  if (midi === null || midi < 0 || midi > 127) {
    return '-';
  }

  const name = NOTE_NAMES[midi % 12] ?? 'C';
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

function getIntonation(centsOffset: number | null, toleranceCents: number) {
  if (centsOffset === null || Number.isNaN(centsOffset)) {
    return { label: 'No pitch', style: 'neutral' as const };
  }

  if (Math.abs(centsOffset) <= toleranceCents) {
    return { label: 'In tune', style: 'inTune' as const };
  }

  if (centsOffset > 0) {
    return { label: 'Sharp', style: 'sharp' as const };
  }

  return { label: 'Flat', style: 'flat' as const };
}

export function TrainerScreen({ route, navigation }: Readonly<Props>) {
  const lesson = useMemo(() => getLessonById(route.params.lessonId), [route.params.lessonId]);
  const [state, dispatch] = useReducer(trainerReducer, initialTrainerState);
  const lastAutoSubmissionRef = useRef<{ signature: string; at: number } | null>(null);
  const attemptSavedRef = useRef(false);
  const [centsHistory, setCentsHistory] = useState<number[]>([]);
  const mic = useMicInput();

  const currentChunk = useMemo(() => {
    if (!state.lesson) {
      return [];
    }
    return state.lesson.notes.slice(state.chunkStart, state.chunkEndExclusive).map((note) => note.midi);
  }, [state.lesson, state.chunkStart, state.chunkEndExclusive]);

  useEffect(() => {
    if (!lesson) {
      return;
    }

    attemptSavedRef.current = false;
    dispatch({ type: 'START_SESSION', lesson });
  }, [lesson]);

  useEffect(() => {
    return () => {
      void stopAllPlayback();
      mic.stop().catch(() => undefined);
    };
  }, [mic.stop]);

  useEffect(() => {
    if (!lesson || state.status !== 'completed' || attemptSavedRef.current) {
      return;
    }

    attemptSavedRef.current = true;
    void saveLessonAttempt({
      lessonId: lesson.id,
      correctCount: state.correctCount,
      wrongCount: state.wrongCount,
      completed: true,
    });
  }, [lesson, state.correctCount, state.status, state.wrongCount]);

  useEffect(() => {
    return () => {
      if (!lesson || attemptSavedRef.current) {
        return;
      }

      if (state.correctCount + state.wrongCount <= 0) {
        return;
      }

      attemptSavedRef.current = true;
      void saveLessonAttempt({
        lessonId: lesson.id,
        correctCount: state.correctCount,
        wrongCount: state.wrongCount,
        completed: false,
      });
    };
  }, [lesson, state.correctCount, state.wrongCount]);

  useEffect(() => {
    if (state.options.inputMode !== 'sing' || !mic.isRecording) {
      return;
    }

    if (state.expectedMidi === null || state.status === 'completed') {
      return;
    }

    if (mic.detectedMidi === null || mic.centsOffset === null) {
      return;
    }

    if (mic.levelPercent < 12) {
      return;
    }

    const signature = `${mic.detectedMidi}:${Math.round(mic.centsOffset / 5)}`;
    const now = Date.now();
    const previous = lastAutoSubmissionRef.current;
    if (previous && previous.signature === signature && now - previous.at < 500) {
      return;
    }

    lastAutoSubmissionRef.current = { signature, at: now };
    dispatch({ type: 'INPUT_NOTE', midi: mic.detectedMidi, source: 'sing', centsOffset: mic.centsOffset });
  }, [
    mic.centsOffset,
    mic.detectedMidi,
    mic.isRecording,
    mic.levelPercent,
    state.expectedMidi,
    state.options.inputMode,
    state.status,
  ]);

  useEffect(() => {
    if (state.options.inputMode !== 'sing' || !mic.isRecording || typeof mic.centsOffset !== 'number') {
      return;
    }

    setCentsHistory((previous) => {
      const next = [...previous, mic.centsOffset as number];
      return next.length > 36 ? next.slice(next.length - 36) : next;
    });
  }, [mic.centsOffset, mic.isRecording, state.options.inputMode]);

  useEffect(() => {
    if (state.options.inputMode !== 'sing') {
      setCentsHistory([]);
    }
  }, [state.options.inputMode]);

  useEffect(() => {
    if (!lesson) {
      return;
    }

    const currentLesson = lesson;

    let isMounted = true;

    async function applySavedOptions() {
      const global = await loadGlobalSettings();
      const overrides = await loadLessonOverrides();
      const patch = overrides[currentLesson.id] ?? {};

      if (!isMounted) {
        return;
      }

      dispatch({
        type: 'SET_OPTIONS',
        patch: {
          tempoBpm: patch.tempoBpm ?? global.tempoBpm,
          chunkSize: patch.chunkSize ?? global.chunkSize,
          inputMode: patch.inputMode ?? global.inputMode,
          singToleranceCents: patch.singToleranceCents ?? global.singToleranceCents,
          visibleOctaves: patch.visibleOctaves ?? global.visibleOctaves,
        },
      });
    }

    void applySavedOptions();

    return () => {
      isMounted = false;
    };
  }, [lesson]);

  if (!lesson || !state.lesson) {
    return (
      <View style={styles.centered}>
        <Text style={styles.missingText}>Lesson not found.</Text>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const lessonProgress = state.progress.totalNotes
    ? state.progress.noteIndexInLesson / state.progress.totalNotes
    : 0;
  const intonation = getIntonation(mic.centsOffset, state.options.singToleranceCents);

  const handleOptionChange = async (patch: Partial<TrainerOptions>) => {
    const normalized = normalizeTrainerOptions(lesson, patch, state.options);
    dispatch({ type: 'SET_OPTIONS', patch: normalized });
    await saveLessonOverride(lesson.id, normalized);

    const global = await loadGlobalSettings();
    await saveGlobalSettings({
      ...global,
      tempoBpm: normalized.tempoBpm,
      chunkSize: normalized.chunkSize,
      inputMode: normalized.inputMode,
      singToleranceCents: normalized.singToleranceCents,
      visibleOctaves: normalized.visibleOctaves,
    });
  };

  const replayCurrentChunk = async () => {
    dispatch({ type: 'REPLAY_CHUNK' });
    await playMidiSequence(currentChunk, state.options.tempoBpm);
  };

  const onInputMidi = (midi: number, source: InputMode, centsOffset?: number) => {
    dispatch({ type: 'INPUT_NOTE', midi, source, centsOffset });
  };

  const onResetDefaults = async () => {
    const global = getDefaultGlobalSettings();
    await handleOptionChange({
      tempoBpm: global.tempoBpm,
      chunkSize: global.chunkSize,
      inputMode: global.inputMode,
      singToleranceCents: global.singToleranceCents,
      visibleOctaves: global.visibleOctaves,
    });
  };

  const addOctave = () => {
    const all = lesson.allowedOctaves;
    const missing = all.find((oct) => !state.options.visibleOctaves.includes(oct));
    if (missing !== undefined) {
      void handleOptionChange({
        visibleOctaves: [...state.options.visibleOctaves, missing].sort((a, b) => a - b),
      });
    }
  };

  const removeOctave = () => {
    if (state.options.visibleOctaves.length <= 1) {
      return;
    }
    void handleOptionChange({
      visibleOctaves: state.options.visibleOctaves.slice(0, -1),
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <MaterialIcons name="arrow-back" size={20} color="#111827" />
        </Pressable>
        <Text style={styles.lessonTitle} numberOfLines={1}>
          {lesson.name}
        </Text>
        <Pressable
          onPress={replayCurrentChunk}
          style={styles.iconBtn}
          accessibilityLabel="Replay current notes"
        >
          <MaterialIcons name="refresh" size={20} color="#111827" />
        </Pressable>
      </View>

      <View style={styles.progressCard}>
        <Text style={styles.progressText}>
          Set {state.progress.chunkIndex + 1}/{Math.max(state.progress.totalChunks, 1)}
        </Text>
        <Text style={styles.progressText}>
          Note {state.progress.noteIndexInChunk + 1}/{Math.max(state.chunkEndExclusive - state.chunkStart, 1)}
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(3, lessonProgress * 100)}%` }]} />
        </View>
      </View>

      <View style={styles.feedbackCard}>
        <Text style={styles.feedbackLabel}>Status</Text>
        <Text
          style={[
            styles.feedbackValue,
            state.status === 'wrong' && styles.statusWrong,
            state.status === 'correct' && styles.statusCorrect,
          ]}
        >
          {statusText(state.status)}
        </Text>
      </View>

      <LessonOptionsAccordion
        options={state.options}
        allowedKeys={lesson.allowedKeys}
        allowedOctaves={lesson.allowedOctaves}
        tempoRange={lesson.tempoRange}
        chunkSizeRange={lesson.chunkSizeRange}
        toleranceRange={{ min: 1, max: 100 }}
        onChange={handleOptionChange}
        onReset={onResetDefaults}
      />

      <View style={styles.modeRow}>
        {(['solfege', 'piano', 'sing'] as InputMode[]).map((mode) => (
          <Pressable
            key={mode}
            style={[styles.modeBtn, state.options.inputMode === mode && styles.modeBtnActive]}
            onPress={() => void handleOptionChange({ inputMode: mode })}
          >
            <Text style={styles.modeBtnText}>{modeLabel(mode)}</Text>
          </Pressable>
        ))}
      </View>

      {state.options.inputMode === 'solfege' && (
        <SolfegeGrid
          visibleOctaves={state.options.visibleOctaves}
          expectedMidi={state.expectedMidi}
          onPressNote={(midi) => onInputMidi(midi, 'solfege')}
          onAddOctave={addOctave}
          onRemoveOctave={removeOctave}
        />
      )}

      {state.options.inputMode === 'piano' && (
        <PianoTwoOctave
          baseOctave={state.options.visibleOctaves[0] ?? lesson.defaultOctave}
          expectedMidi={state.expectedMidi}
          onPressNote={(midi) => onInputMidi(midi, 'piano')}
        />
      )}

      {state.options.inputMode === 'sing' && (
        <View style={styles.singCard}>
          <Text style={styles.singTitle}>Singing Input</Text>
          <Text style={styles.singHint}>Live pitch detection is active while mic is on.</Text>
          <View style={styles.singControlsRow}>
            <Pressable
              style={[styles.micBtn, mic.isRecording && styles.micBtnActive]}
              onPress={() => (mic.isRecording ? mic.stop() : mic.start())}
            >
              <Text style={styles.micBtnText}>{mic.isRecording ? 'Stop Mic' : 'Start Mic'}</Text>
            </Pressable>
            <Text style={styles.micLevel}>Level: {mic.levelPercent}%</Text>
          </View>
          {mic.error ? <Text style={styles.micError}>{mic.error}</Text> : null}
          <View style={styles.detectedCard}>
            <Text style={styles.detectedText}>Detected Hz: {mic.frequencyHz ? mic.frequencyHz.toFixed(2) : '-'}</Text>
            <Text style={styles.detectedText}>Detected MIDI: {mic.detectedMidi ?? '-'}</Text>
            <Text style={styles.detectedText}>Detected note: {midiToNoteLabel(mic.detectedMidi)}</Text>
            <Text style={styles.detectedText}>Expected note: {midiToNoteLabel(state.expectedMidi)}</Text>
            <Text style={styles.detectedText}>
              Cents offset: {typeof mic.centsOffset === 'number' ? mic.centsOffset.toFixed(1) : '-'}
            </Text>
            <View
              style={[
                styles.intonationBadge,
                intonation.style === 'inTune' && styles.inTuneBadge,
                intonation.style === 'sharp' && styles.sharpBadge,
                intonation.style === 'flat' && styles.flatBadge,
              ]}
            >
              <Text style={styles.intonationText}>{intonation.label}</Text>
            </View>
            <Text style={styles.sparklineLabel}>Pitch stability (last ~2s)</Text>
            <View style={styles.sparklineTrack}>
              <Text style={[styles.sparklineEdgeLabel, styles.sparklinePlusLabel]}>+</Text>
              <Text style={[styles.sparklineEdgeLabel, styles.sparklineMinusLabel]}>-</Text>
              <View style={styles.sparklineZeroLine} />
              {centsHistory.map((cents, index) => {
                const normalizedSigned = Math.max(-1, Math.min(1, cents / 60));
                const yOffset = normalizedSigned * 16;
                const withinTolerance = Math.abs(cents) <= state.options.singToleranceCents;
                return (
                  <View
                    key={`${index}-${Math.round(cents)}`}
                    style={styles.sparklinePointColumn}
                  >
                    <View
                      style={[
                        styles.sparklinePoint,
                        { transform: [{ translateY: -yOffset }] },
                        withinTolerance ? styles.sparklineGood : styles.sparklineOff,
                      ]}
                    />
                  </View>
                );
              })}
            </View>
          </View>
          <View style={styles.singRow}>
            <Pressable
              style={styles.submitBtn}
              onPress={() => {
                if (mic.detectedMidi !== null) {
                  onInputMidi(mic.detectedMidi, 'sing', mic.centsOffset ?? 0);
                }
              }}
            >
              <Text style={styles.submitText}>Check Detected Now</Text>
            </Pressable>
          </View>
          <Text style={styles.singTolerance}>Tolerance: ±{state.options.singToleranceCents} cents</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 14,
    paddingBottom: 28,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 16,
  },
  missingText: {
    fontSize: 17,
    fontWeight: '600',
  },
  backBtn: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtnText: {
    fontWeight: '700',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  lessonTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
  },
  iconBtn: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 999,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressCard: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  progressText: {
    fontSize: 13,
    fontWeight: '600',
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#2563eb',
  },
  feedbackCard: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  feedbackLabel: {
    fontSize: 13,
    color: '#6b7280',
  },
  feedbackValue: {
    fontSize: 15,
    fontWeight: '700',
  },
  statusWrong: {
    color: '#b91c1c',
  },
  statusCorrect: {
    color: '#166534',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 10,
  },
  modeBtnActive: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  modeBtnText: {
    fontWeight: '700',
  },
  singCard: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  singTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  singHint: {
    color: '#6b7280',
    fontSize: 12,
  },
  singRow: {
    flexDirection: 'row',
    gap: 8,
  },
  detectedCard: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 8,
    padding: 10,
    gap: 4,
    backgroundColor: '#f8fafc',
  },
  detectedText: {
    fontSize: 12,
    color: '#111827',
  },
  sparklineLabel: {
    marginTop: 6,
    fontSize: 11,
    color: '#4b5563',
  },
  sparklineTrack: {
    marginTop: 4,
    height: 44,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 3,
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 2,
    backgroundColor: '#ffffff',
  },
  sparklineZeroLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    marginTop: -0.5,
    height: 1,
    backgroundColor: '#cbd5e1',
  },
  sparklineEdgeLabel: {
    position: 'absolute',
    right: 4,
    fontSize: 10,
    color: '#64748b',
    fontWeight: '700',
  },
  sparklinePlusLabel: {
    top: 2,
  },
  sparklineMinusLabel: {
    bottom: 2,
  },
  sparklinePointColumn: {
    width: 4,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sparklinePoint: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  sparklineGood: {
    backgroundColor: '#16a34a',
  },
  sparklineOff: {
    backgroundColor: '#f59e0b',
  },
  intonationBadge: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 999,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#f9fafb',
  },
  inTuneBadge: {
    borderColor: '#16a34a',
    backgroundColor: '#f0fdf4',
  },
  sharpBadge: {
    borderColor: '#d97706',
    backgroundColor: '#fffbeb',
  },
  flatBadge: {
    borderColor: '#0369a1',
    backgroundColor: '#f0f9ff',
  },
  intonationText: {
    fontSize: 12,
    fontWeight: '700',
  },
  singControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  micBtn: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  micBtnActive: {
    borderColor: '#16a34a',
    backgroundColor: '#f0fdf4',
  },
  micBtnText: {
    fontWeight: '700',
  },
  micLevel: {
    fontSize: 12,
    color: '#4b5563',
  },
  micError: {
    color: '#b91c1c',
    fontSize: 12,
  },
  submitBtn: {
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
  },
  submitText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  singTolerance: {
    fontSize: 12,
    color: '#6b7280',
  },
});
