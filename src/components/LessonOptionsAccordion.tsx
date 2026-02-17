import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { InputMode, TrainerOptions } from '../trainer/types';

interface LessonOptionsAccordionProps {
  options: TrainerOptions;
  allowedKeys: string[];
  allowedOctaves: number[];
  tempoRange: { min: number; max: number };
  chunkSizeRange: { min: number; max: number };
  toleranceRange: { min: number; max: number };
  onChange: (patch: Partial<TrainerOptions>) => void;
  onReset: () => void;
}

const modeOptions: InputMode[] = ['solfege', 'piano', 'sing'];

export function LessonOptionsAccordion({
  options,
  allowedKeys,
  allowedOctaves,
  tempoRange,
  chunkSizeRange,
  toleranceRange,
  onChange,
  onReset,
}: LessonOptionsAccordionProps) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.wrapper}>
      <Pressable style={styles.header} onPress={() => setOpen((prev) => !prev)}>
        <Text style={styles.title}>Lesson Options</Text>
        <Text style={styles.expand}>{open ? '▾' : '▸'}</Text>
      </Pressable>

      {open ? (
        <View style={styles.panel}>
          <View style={styles.row}>
            <Text style={styles.label}>Key</Text>
            <View style={styles.chips}>
              {allowedKeys.map((key) => (
                <Pressable
                  key={key}
                  onPress={() => onChange({ key })}
                  style={[styles.chip, options.key === key && styles.chipActive]}
                >
                  <Text style={styles.chipText}>{key}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.inlineRow}>
            <Text style={styles.label}>Tempo BPM</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={String(options.tempoBpm)}
              placeholder={`${tempoRange.min}-${tempoRange.max}`}
              onChangeText={(value) => {
                const next = Number(value);
                if (!Number.isNaN(next)) {
                  onChange({ tempoBpm: next });
                }
              }}
            />
          </View>
          <Text style={styles.hint}>Allowed range: {tempoRange.min}–{tempoRange.max} BPM</Text>

          <View style={styles.inlineRow}>
            <Text style={styles.label}>Notes per set</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={String(options.chunkSize)}
              placeholder={`${chunkSizeRange.min}-${chunkSizeRange.max}`}
              onChangeText={(value) => {
                const next = Number(value);
                if (!Number.isNaN(next)) {
                  onChange({ chunkSize: next });
                }
              }}
            />
          </View>
          <Text style={styles.hint}>Allowed range: {chunkSizeRange.min}–{chunkSizeRange.max} notes</Text>

          <View style={styles.row}>
            <Text style={styles.label}>Input mode</Text>
            <View style={styles.chips}>
              {modeOptions.map((mode) => (
                <Pressable
                  key={mode}
                  onPress={() => onChange({ inputMode: mode })}
                  style={[styles.chip, options.inputMode === mode && styles.chipActive]}
                >
                  <Text style={styles.chipText}>{mode}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Visible octaves</Text>
            <View style={styles.chips}>
              {allowedOctaves.map((octave) => {
                const selected = options.visibleOctaves.includes(octave);
                return (
                  <Pressable
                    key={octave}
                    onPress={() => {
                      const next = selected
                        ? options.visibleOctaves.filter((v) => v !== octave)
                        : [...options.visibleOctaves, octave].sort((a, b) => a - b);
                      if (next.length > 0) {
                        onChange({ visibleOctaves: next });
                      }
                    }}
                    style={[styles.chip, selected && styles.chipActive]}
                  >
                    <Text style={styles.chipText}>{octave}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.inlineRow}>
            <Text style={styles.label}>Sing tolerance (cents)</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={String(options.singToleranceCents)}
              placeholder={`${toleranceRange.min}-${toleranceRange.max}`}
              onChangeText={(value) => {
                const next = Number(value);
                if (!Number.isNaN(next)) {
                  onChange({ singToleranceCents: next });
                }
              }}
            />
          </View>
          <Text style={styles.hint}>Allowed range: {toleranceRange.min}–{toleranceRange.max} cents</Text>

          <Pressable style={styles.resetBtn} onPress={onReset}>
            <Text style={styles.resetText}>Reset to global defaults</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 10,
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
  },
  expand: {
    fontSize: 14,
    color: '#6b7280',
  },
  panel: {
    padding: 12,
    gap: 10,
  },
  row: {
    gap: 6,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipActive: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  chipText: {
    fontSize: 12,
    textTransform: 'capitalize',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 8,
    minWidth: 80,
    paddingHorizontal: 10,
    paddingVertical: 6,
    textAlign: 'right',
  },
  hint: {
    marginTop: -4,
    fontSize: 11,
    color: '#6b7280',
  },
  resetBtn: {
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 10,
  },
  resetText: {
    color: '#b91c1c',
    fontWeight: '700',
  },
});
