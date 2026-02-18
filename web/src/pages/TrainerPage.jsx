import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getLessonById } from '../lib/lessons';
import { loadPitchSettings } from '../lib/pitchSettings';
import { usePitchDetector } from '../lib/usePitchDetector';

export function TrainerPage() {
  const { lessonId } = useParams();
  const lesson = useMemo(() => getLessonById(lessonId), [lessonId]);
  const [mode, setMode] = useState('piano');
  const [playbackOctave, setPlaybackOctave] = useState(lesson?.defaultOctave ?? 4);
  const [index, setIndex] = useState(0);
  const [correctIndices, setCorrectIndices] = useState([]);

  const pitchSettings = useMemo(() => loadPitchSettings(), []);
  const singEnabled = mode === 'sing';
  const { current } = usePitchDetector(pitchSettings, singEnabled);

  if (!lesson) {
    return (
      <div className="card controls">
        <p>Lesson not found.</p>
        <Link className="button" to="/lessons">Back</Link>
      </div>
    );
  }

  const expectedBaseMidi = lesson.notes[index]?.midi ?? null;
  const expectedMidi = expectedBaseMidi === null ? null : expectedBaseMidi + (playbackOctave - lesson.defaultOctave) * 12;
  const progress = `${Math.min(index + 1, lesson.notes.length)} / ${lesson.notes.length}`;

  function registerInput(midi) {
    if (expectedMidi === null) return;
    if (midi !== expectedMidi) return;

    setCorrectIndices((previous) => (previous.includes(index) ? previous : [...previous, index]));
    setIndex((previous) => Math.min(previous + 1, lesson.notes.length - 1));
  }

  useEffect(() => {
    if (mode !== 'sing' || !Number.isFinite(current.midi) || expectedMidi === null) {
      return;
    }

    const rounded = Math.round(current.midi);
    if (rounded === expectedMidi) {
      registerInput(rounded);
    }
  }, [current.midi, expectedMidi, mode]);

  return (
    <div className="trainer-grid">
      <div className="card controls">
        <h3>{lesson.name}</h3>
        <div className="row">
          <label>Input mode</label>
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="piano">Piano</option>
            <option value="solfege">Solfege</option>
            <option value="sing">Sing</option>
          </select>
        </div>

        <div className="row">
          <label>Playback octave</label>
          <select value={playbackOctave} onChange={(event) => setPlaybackOctave(Number(event.target.value))}>
            {lesson.allowedOctaves.map((octave) => (
              <option key={octave} value={octave}>Oct {octave}</option>
            ))}
          </select>
        </div>

        <div className="stat">
          <div className="k">Expected note</div>
          <div className="v">{midiToNoteLabel(expectedMidi)}</div>
        </div>

        {mode === 'sing' ? (
          <div className="stat">
            <div className="k">Detected note</div>
            <div className="v">{current.note}</div>
          </div>
        ) : null}

        <div className="stat">
          <div className="k">Progress</div>
          <div className="v">{progress}</div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="button secondary" onClick={() => { setIndex(0); setCorrectIndices([]); }}>Reset</button>
          <Link className="button secondary" to="/pitch-lab">Open Pitch Lab</Link>
          <Link className="button secondary" to="/lessons">Back</Link>
        </div>
      </div>

      <div className="card controls">
        <h3>Notes</h3>
        <div className="note-row">
          {lesson.notes.map((note, noteIndex) => {
            const shifted = note.midi + (playbackOctave - lesson.defaultOctave) * 12;
            const isCurrent = noteIndex === index;
            const isCorrect = correctIndices.includes(noteIndex);
            return (
              <button
                key={`${noteIndex}-${shifted}`}
                className={`badge ${isCurrent ? 'current' : ''} ${isCorrect ? 'correct' : ''}`}
                onClick={() => registerInput(shifted)}
                disabled={mode === 'sing'}
              >
                {mode === 'solfege' ? note.degree : midiToNoteLabel(shifted)}
              </button>
            );
          })}
        </div>
        {mode === 'sing' ? <small>Sing the expected note. Pitch settings come from Pitch Lab (local storage).</small> : null}
      </div>
    </div>
  );
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiToNoteLabel(midi) {
  if (!Number.isFinite(midi)) return '-';
  const roundedMidi = Math.round(midi);
  const name = NOTE_NAMES[roundedMidi % 12] ?? 'C';
  const octave = Math.floor(roundedMidi / 12) - 1;
  return `${name}${octave}`;
}
