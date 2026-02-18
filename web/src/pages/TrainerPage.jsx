import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getLessonById } from '../lib/lessons';
import { loadPitchSettings } from '../lib/pitchSettings';
import { usePitchDetector } from '../lib/usePitchDetector';

const TRAINER_SING_OCTAVE_KEY = 'musicapp.web.trainer.singOctave.v1';

const SOLFEGE_BUTTONS = [
  { label: 'Do', semitone: 0 },
  { label: 'Re', semitone: 2 },
  { label: 'Mi', semitone: 4 },
  { label: 'Fa', semitone: 5 },
  { label: 'Sol', semitone: 7 },
  { label: 'La', semitone: 9 },
  { label: 'Ti', semitone: 11 },
];

export function TrainerPage() {
  const { lessonId } = useParams();
  const lesson = useMemo(() => getLessonById(lessonId), [lessonId]);
  const [mode, setMode] = useState('piano');
  const [selectedKey, setSelectedKey] = useState(lesson?.defaultKey ?? 'C');
  const [tempoBpm, setTempoBpm] = useState(lesson?.defaultTempoBpm ?? 90);
  const [singOctave, setSingOctave] = useState(loadStoredSingOctave(lesson?.defaultOctave ?? 4));
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [correctIndices, setCorrectIndices] = useState([]);
  const [isPlayingTarget, setIsPlayingTarget] = useState(false);
  const [autoplayKey, setAutoplayKey] = useState(null);
  const inputAudioContextRef = useRef(null);
  const activeInputTonesRef = useRef({});

  const pitchSettings = useMemo(() => loadPitchSettings(), []);
  const singEnabled = mode === 'sing';
  const { current, history } = usePitchDetector(pitchSettings, singEnabled);

  if (!lesson) {
    return (
      <div className="card controls">
        <p>Lesson not found.</p>
        <Link className="button" to="/lessons">Back</Link>
      </div>
    );
  }

  const allowedKeys = lesson.allowedKeys?.length ? lesson.allowedKeys : [lesson.defaultKey ?? 'C'];
  const tempoRange = lesson.tempoRange ?? { min: 50, max: 180 };
  const allowedOctaves = lesson.allowedOctaves?.length ? lesson.allowedOctaves : [lesson.defaultOctave ?? 4];
  const keySemitoneShift = keyToSemitone(selectedKey) - keyToSemitone(lesson.defaultKey ?? selectedKey);
  const octaveShift = (singOctave - lesson.defaultOctave) * 12;
  const totalMidiShift = keySemitoneShift + octaveShift;

  const expectedBaseMidi = lesson.notes[index]?.midi ?? null;
  const expectedMidi = expectedBaseMidi === null ? null : expectedBaseMidi + totalMidiShift;
  const progress = `${Math.min(index + 1, lesson.notes.length)} / ${lesson.notes.length}`;
  const shiftedLessonNotes = lesson.notes.map(
    (note) => ({
      ...note,
      midi: note.midi + totalMidiShift,
    }),
  );

  function registerInput(midi) {
    if (expectedMidi === null) return;
    if (midi !== expectedMidi) return;

    setCorrectIndices((previous) => (previous.includes(index) ? previous : [...previous, index]));
    setIndex((previous) => Math.min(previous + 1, lesson.notes.length - 1));
  }

  async function playMidiSequence(notes) {
    if (!notes.length || isPlayingTarget) {
      return;
    }

    setIsPlayingTarget(true);
    const context = new AudioContext();

    try {
      const beatSeconds = 60 / Math.max(40, Number(tempoBpm) || 90);
      const gapSeconds = 0.03;
      let startAt = context.currentTime + 0.03;

      for (const note of notes) {
        const frequency = midiToFrequencyHz(note.midi);
        const beats = Number.isFinite(note.durationBeats) ? note.durationBeats : 1;
        const noteDurationSeconds = Math.max(0.12, beatSeconds * beats * 0.92);
        const oscillator = context.createOscillator();
        oscillator.type = 'triangle';
        oscillator.frequency.value = frequency;

        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.16, startAt + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + noteDurationSeconds);

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start(startAt);
        oscillator.stop(startAt + noteDurationSeconds);

        startAt += noteDurationSeconds + gapSeconds;
      }

      const totalDurationMs = Math.ceil((startAt - context.currentTime) * 1000) + 40;
      await new Promise((resolve) => window.setTimeout(resolve, totalDurationMs));
    } finally {
      await context.close().catch(() => undefined);
      setIsPlayingTarget(false);
    }
  }

  useEffect(() => {
    setSelectedKey(lesson.defaultKey ?? 'C');
    setTempoBpm(lesson.defaultTempoBpm ?? 90);

    const storedOctave = loadStoredSingOctave(lesson.defaultOctave ?? 4);
    const nextOctave = (lesson.allowedOctaves ?? []).includes(storedOctave)
      ? storedOctave
      : lesson.defaultOctave ?? 4;
    setSingOctave(nextOctave);

    setIndex(0);
    setCorrectIndices([]);
    setAutoplayKey(null);
  }, [lesson.id]);

  useEffect(() => {
    saveStoredSingOctave(singOctave);
  }, [singOctave]);

  useEffect(() => {
    if (mode !== 'sing' || !Number.isFinite(current.midi) || expectedMidi === null) {
      return;
    }

    const rounded = Math.round(current.midi);
    if (rounded === expectedMidi) {
      registerInput(rounded);
    }
  }, [current.midi, expectedMidi, mode]);

  useEffect(() => {
    const nextAutoplayKey = `${lesson.id}:${selectedKey}:${tempoBpm}:${singOctave}`;
    if (autoplayKey === nextAutoplayKey) {
      return;
    }

    setAutoplayKey(nextAutoplayKey);
    void playMidiSequence(shiftedLessonNotes);
  }, [autoplayKey, lesson.id, selectedKey, singOctave, tempoBpm]);

  const pianoKeys = useMemo(() => {
    const startMidi = 12 * (singOctave + 1);
    return Array.from({ length: 24 }, (_, offset) => {
      const midi = startMidi + offset;
      const pitchClass = midi % 12;
      const noteName = NOTE_NAMES[pitchClass];
      return {
        midi,
        noteName,
        isBlack: noteName.includes('#'),
      };
    });
  }, [singOctave]);

  const whiteKeys = pianoKeys.filter((key) => !key.isBlack);
  const blackKeys = pianoKeys
    .map((key, keyIndex) => ({ ...key, keyIndex }))
    .filter((key) => key.isBlack)
    .map((key) => {
      const whiteBefore = pianoKeys.slice(0, key.keyIndex).filter((candidate) => !candidate.isBlack).length;
      return {
        ...key,
        left: whiteBefore * 44 - 13,
      };
    });

  useEffect(() => {
    return () => {
      Object.values(activeInputTonesRef.current).forEach((tone) => {
        try {
          tone.gain.gain.cancelScheduledValues(tone.context.currentTime);
          tone.gain.gain.setTargetAtTime(0.0001, tone.context.currentTime, 0.02);
          tone.oscillator.stop(tone.context.currentTime + 0.08);
        } catch {
          // ignore
        }
      });
      activeInputTonesRef.current = {};

      if (inputAudioContextRef.current) {
        void inputAudioContextRef.current.close().catch(() => undefined);
        inputAudioContextRef.current = null;
      }
    };
  }, []);

  async function startInputTone(midi) {
    if (activeInputTonesRef.current[midi]) {
      return;
    }

    const frequency = midiToFrequencyHz(midi);
    if (!Number.isFinite(frequency)) {
      return;
    }

    const context = inputAudioContextRef.current ?? new AudioContext();
    if (!inputAudioContextRef.current) {
      inputAudioContextRef.current = context;
    }

    if (context.state === 'suspended') {
      await context.resume();
    }

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, now);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.015);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);

    activeInputTonesRef.current[midi] = { oscillator, gain, context };
  }

  function stopInputTone(midi) {
    const tone = activeInputTonesRef.current[midi];
    if (!tone) {
      return;
    }

    const stopAt = tone.context.currentTime;
    tone.gain.gain.cancelScheduledValues(stopAt);
    tone.gain.gain.setTargetAtTime(0.0001, stopAt, 0.02);
    tone.oscillator.stop(stopAt + 0.08);

    delete activeInputTonesRef.current[midi];
  }

  const currentSungMidi = Number.isFinite(current.midi) ? current.midi : null;
  const graphCenterMidi = Math.round(
    Number.isFinite(currentSungMidi)
      ? currentSungMidi
      : Number.isFinite(expectedMidi)
        ? expectedMidi
        : 60,
  );
  const visibleHalf = 4;
  const graphNoteMidis = Array.from({ length: 9 }, (_, idx) => graphCenterMidi + (visibleHalf - idx));
  const historyMidiPoints = history
    .map((entry) => {
      if (!Number.isFinite(entry.pitchHz)) {
        return null;
      }
      const midi = 69 + 12 * Math.log2(entry.pitchHz / 440);
      return Number.isFinite(midi) ? midi : null;
    })
    .filter((value) => value !== null)
    .slice(-60);

  return (
    <div className="trainer-grid">
      <div className="card controls">
        <h3>{lesson.name}</h3>

        <div className="options-accordion card">
          <button
            className="accordion-toggle"
            onClick={() => setOptionsOpen((open) => !open)}
            type="button"
          >
            <span>Training Options</span>
            <span>{optionsOpen ? '▾' : '▸'}</span>
          </button>

          {optionsOpen ? (
            <div className="accordion-content">
              <div className="row">
                <label>Key</label>
                <select value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}>
                  {allowedKeys.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </div>

              <div className="row">
                <label>Tempo (BPM)</label>
                <input
                  type="number"
                  min={tempoRange.min}
                  max={tempoRange.max}
                  value={tempoBpm}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next)) {
                      return;
                    }
                    const clamped = Math.max(tempoRange.min, Math.min(tempoRange.max, Math.round(next)));
                    setTempoBpm(clamped);
                  }}
                />
              </div>

              <div className="row">
                <label>Singing octave</label>
                <select value={singOctave} onChange={(event) => setSingOctave(Number(event.target.value))}>
                  {allowedOctaves.map((octave) => (
                    <option key={octave} value={octave}>Oct {octave}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
        </div>

        <div className="row">
          <label>Input mode</label>
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="piano">Piano</option>
            <option value="solfege">Solfege</option>
            <option value="sing">Sing</option>
          </select>
        </div>

        {mode === 'sing' ? (
          <div className="stat">
            <div className="k">Detected note</div>
            <div className="v">{current.note}</div>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="button" disabled={isPlayingTarget} onClick={() => void playMidiSequence(shiftedLessonNotes)}>
            {isPlayingTarget ? 'Playing…' : 'Replay Target Tones'}
          </button>
          <button className="button secondary" onClick={() => { setIndex(0); setCorrectIndices([]); }}>Reset</button>
          <Link className="button secondary" to="/pitch-lab">Open Pitch Lab</Link>
          <Link className="button secondary" to="/lessons">Back</Link>
        </div>
      </div>

      <div className="card controls">
        <div className="input-header">
          <h3>Input</h3>
          <div className="input-progress">
            <span className="progress-text">{progress}</span>
            <div className="progress-dots" aria-label="Sequence progress">
              {lesson.notes.map((_, noteIndex) => {
                const isCurrent = noteIndex === index;
                const isCorrect = correctIndices.includes(noteIndex);
                return (
                  <span
                    key={`progress-${noteIndex}`}
                    className={`dot ${isCurrent ? 'current' : ''} ${isCorrect ? 'correct' : ''}`}
                  />
                );
              })}
            </div>
          </div>
        </div>
        {mode === 'solfege' ? (
          <div className="solfege-grid">
            {SOLFEGE_BUTTONS.map((button) => {
              const midi = 12 * (singOctave + 1) + button.semitone;
              return (
                <button
                  key={button.label}
                  className="solfege-btn"
                  onPointerDown={() => {
                    void startInputTone(midi);
                    registerInput(midi);
                  }}
                  onPointerUp={() => stopInputTone(midi)}
                  onPointerLeave={() => stopInputTone(midi)}
                  onPointerCancel={() => stopInputTone(midi)}
                >
                  {button.label}
                </button>
              );
            })}
          </div>
        ) : null}

        {mode === 'piano' ? (
          <div className="piano-wrap">
            <div className="piano-white-row">
              {whiteKeys.map((key) => (
                <button
                  key={key.midi}
                  className="piano-key white"
                  onPointerDown={() => {
                    void startInputTone(key.midi);
                    registerInput(key.midi);
                  }}
                  onPointerUp={() => stopInputTone(key.midi)}
                  onPointerLeave={() => stopInputTone(key.midi)}
                  onPointerCancel={() => stopInputTone(key.midi)}
                >
                  {midiToNoteLabel(key.midi)}
                </button>
              ))}
            </div>
            {blackKeys.map((key) => (
              <button
                key={key.midi}
                className="piano-key black"
                style={{ left: `${key.left}px` }}
                onPointerDown={() => {
                  void startInputTone(key.midi);
                  registerInput(key.midi);
                }}
                onPointerUp={() => stopInputTone(key.midi)}
                onPointerLeave={() => stopInputTone(key.midi)}
                onPointerCancel={() => stopInputTone(key.midi)}
              >
                {midiToNoteLabel(key.midi)}
              </button>
            ))}
          </div>
        ) : null}

        {mode === 'sing' ? (
          <div className="sing-graph card">
            <div className="sing-graph-head">
              <strong>Sung Pitch</strong>
              <span>{current.note}</span>
            </div>

            <div className="sing-graph-grid">
              {graphNoteMidis.map((midi) => {
                const isExpected = Math.round(expectedMidi ?? -999) === midi;
                const isCurrent = Math.round(currentSungMidi ?? -999) === midi;
                return (
                  <div key={`guide-${midi}`} className="sing-guide-row">
                    <span className={`sing-note-label ${isExpected ? 'expected' : ''} ${isCurrent ? 'current' : ''}`}>
                      {midiToNoteLabel(midi)}
                    </span>
                    <div className="sing-guide-line" />
                  </div>
                );
              })}

              <div className="sing-history-overlay">
                {historyMidiPoints.map((midi, pointIdx) => {
                  const left = historyMidiPoints.length <= 1 ? 0 : (pointIdx / (historyMidiPoints.length - 1)) * 100;
                  const top = ((graphNoteMidis[0] + 0.5 - midi) / 9) * 100;
                  return (
                    <span
                      key={`pt-${pointIdx}`}
                      className="sing-history-point"
                      style={{ left: `${left}%`, top: `${Math.max(0, Math.min(100, top))}%` }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {mode === 'sing' ? <small>Sing the expected note. Pitch settings come from Pitch Lab (local storage).</small> : null}
      </div>
    </div>
  );
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KEY_TO_SEMITONE = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
};

function keyToSemitone(key) {
  return KEY_TO_SEMITONE[key] ?? 0;
}

function midiToFrequencyHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
function midiToNoteLabel(midi) {
  if (!Number.isFinite(midi)) return '-';
  const roundedMidi = Math.round(midi);
  const name = NOTE_NAMES[roundedMidi % 12] ?? 'C';
  const octave = Math.floor(roundedMidi / 12) - 1;
  return `${name}${octave}`;
}

function loadStoredSingOctave(fallback) {
  try {
    const raw = window.localStorage.getItem(TRAINER_SING_OCTAVE_KEY);
    if (!raw) {
      return fallback;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function saveStoredSingOctave(value) {
  try {
    window.localStorage.setItem(TRAINER_SING_OCTAVE_KEY, String(value));
  } catch {
    // ignore storage failures in private/incognito modes
  }
}
