import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type SolfegeSyllable = 'Do' | 'Re' | 'Mi' | 'Fa' | 'Sol' | 'La' | 'Ti';

const syllables: SolfegeSyllable[] = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti'];
const semitoneBySyllable: Record<SolfegeSyllable, number> = {
  Do: 0,
  Re: 2,
  Mi: 4,
  Fa: 5,
  Sol: 7,
  La: 9,
  Ti: 11,
};

function toMidi(syllable: SolfegeSyllable, octave: number) {
  return 12 * (octave + 1) + semitoneBySyllable[syllable];
}

interface SolfegeGridProps {
  visibleOctaves: number[];
  expectedMidi?: number | null;
  onPressNote: (midi: number) => void;
  onAddOctave: () => void;
  onRemoveOctave: () => void;
}

export function SolfegeGrid({
  visibleOctaves,
  expectedMidi,
  onPressNote,
  onAddOctave,
  onRemoveOctave,
}: SolfegeGridProps) {
  const rows = useMemo(() => {
    return [...visibleOctaves]
      .sort((a, b) => b - a)
      .map((octave) => ({
        octave,
        buttons: syllables.map((syllable) => {
          const midi = toMidi(syllable, octave);
          return { syllable, octave, midi, label: `${syllable}${octave}` };
        }),
      }));
  }, [visibleOctaves]);

  return (
    <View style={styles.wrapper}>
      <View style={styles.topRow}>
        <Text style={styles.heading}>Solfege</Text>
        <View style={styles.octaveActions}>
          <Pressable onPress={onRemoveOctave} style={styles.actionBtn}>
            <Text style={styles.actionText}>- Octave</Text>
          </Pressable>
          <Pressable onPress={onAddOctave} style={styles.actionBtn}>
            <Text style={styles.actionText}>+ Octave</Text>
          </Pressable>
        </View>
      </View>

      {rows.map((row) => (
        <View key={row.octave} style={styles.row}>
          <Text style={styles.octaveLabel}>Oct {row.octave}</Text>
          <View style={styles.buttonRow}>
            {row.buttons.map((button) => {
              const isExpected = expectedMidi === button.midi;
              return (
                <Pressable
                  key={button.label}
                  style={[styles.noteBtn, isExpected && styles.expectedBtn]}
                  onPress={() => onPressNote(button.midi)}
                >
                  <Text style={[styles.noteText, isExpected && styles.expectedText]}>{button.syllable}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 10,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heading: {
    fontSize: 16,
    fontWeight: '700',
  },
  octaveActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    borderWidth: 1,
    borderColor: '#cfd8e3',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionText: {
    fontWeight: '600',
    fontSize: 12,
  },
  row: {
    gap: 6,
  },
  octaveLabel: {
    fontSize: 12,
    color: '#5f6368',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 6,
  },
  noteBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d0d7de',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  expectedBtn: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  noteText: {
    fontSize: 13,
    fontWeight: '700',
  },
  expectedText: {
    color: '#1d4ed8',
  },
});
