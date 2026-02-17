import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

interface PianoTwoOctaveProps {
  baseOctave: number;
  expectedMidi?: number | null;
  onPressNote: (midi: number) => void;
}

export function PianoTwoOctave({ baseOctave, expectedMidi, onPressNote }: PianoTwoOctaveProps) {
  const firstMidi = 12 * (baseOctave + 1);
  const notes = Array.from({ length: 24 }, (_, index) => {
    const midi = firstMidi + index;
    const noteName = noteNames[midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    return {
      midi,
      label: `${noteName}${octave}`,
      isSharp: noteName.includes('#'),
    };
  });

  return (
    <View style={styles.wrapper}>
      <Text style={styles.heading}>Piano (2 octaves)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          {notes.map((note) => {
            const isExpected = expectedMidi === note.midi;
            return (
              <Pressable
                key={note.midi}
                style={[
                  styles.key,
                  note.isSharp ? styles.blackLike : styles.whiteLike,
                  isExpected && styles.expected,
                ]}
                onPress={() => onPressNote(note.midi)}
              >
                <Text style={styles.keyLabel}>{note.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 8,
  },
  heading: {
    fontSize: 16,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 4,
  },
  key: {
    width: 52,
    height: 110,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 8,
    borderWidth: 1,
  },
  whiteLike: {
    backgroundColor: '#ffffff',
    borderColor: '#d0d7de',
  },
  blackLike: {
    backgroundColor: '#e2e8f0',
    borderColor: '#cbd5e1',
  },
  expected: {
    borderColor: '#2563eb',
  },
  keyLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
});
