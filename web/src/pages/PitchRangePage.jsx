import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadPitchSettings } from '../lib/pitchSettings';
import { usePitchDetector } from '../lib/usePitchDetector';
import { loadPitchRangeSettings, savePitchRangeSettings } from '../lib/pitchRangeSettings';

const CAPTURE_DURATION_MS = 2600;
const MIN_SAMPLE_COUNT = 10;

export function PitchRangePage() {
  const pitchSettings = useMemo(() => loadPitchSettings(), []);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState('intro');
  const [lowMidi, setLowMidi] = useState(null);
  const [highMidi, setHighMidi] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [captureTarget, setCaptureTarget] = useState(null);

  const captureBufferRef = useRef([]);
  const captureTimeoutRef = useRef(null);

  const savedRange = useMemo(() => loadPitchRangeSettings(), []);
  const { current } = usePitchDetector(pitchSettings, running, { maxHistoryPoints: 260 });

  useEffect(() => {
    if (Number.isFinite(savedRange.minMidi) && Number.isFinite(savedRange.maxMidi)) {
      setLowMidi(savedRange.minMidi);
      setHighMidi(savedRange.maxMidi);
      setStatusMessage('Loaded previously saved pitch range.');
      setStep('done');
    }
  }, [savedRange.maxMidi, savedRange.minMidi]);

  useEffect(() => {
    if (!captureTarget || !Number.isFinite(current.midi)) {
      return;
    }

    captureBufferRef.current.push(current.midi);
  }, [captureTarget, current.midi]);

  useEffect(() => {
    return () => {
      if (captureTimeoutRef.current) {
        globalThis.clearTimeout(captureTimeoutRef.current);
      }
    };
  }, []);

  function startCalibration() {
    setStep('low');
    setLowMidi(null);
    setHighMidi(null);
    setStatusMessage('Sing your lowest comfortable note, then press Capture Low.');
    setRunning(true);
  }

  function beginCapture(target) {
    if (!running) {
      setRunning(true);
    }

    setStatusMessage(`Capturing ${target} note… hold a steady tone.`);
    setCaptureTarget(target);
    captureBufferRef.current = [];

    if (captureTimeoutRef.current) {
      globalThis.clearTimeout(captureTimeoutRef.current);
    }

    captureTimeoutRef.current = globalThis.setTimeout(() => {
      finishCapture(target);
    }, CAPTURE_DURATION_MS);
  }

  function finishCapture(target) {
    setCaptureTarget(null);
    const captured = captureBufferRef.current.slice();
    captureBufferRef.current = [];

    if (captured.length < MIN_SAMPLE_COUNT) {
      setStatusMessage('Not enough stable pitch detected. Try again in a quieter room and hold the note longer.');
      return;
    }

    const representative = summarizeMidi(captured, target === 'low' ? 0.2 : 0.8);

    if (!Number.isFinite(representative)) {
      setStatusMessage('Capture failed. Please try again.');
      return;
    }

    const rounded = Math.round(representative);

    if (target === 'low') {
      setLowMidi(rounded);
      setStep('high');
      setStatusMessage(`Low note captured: ${midiToNoteLabel(rounded)}. Now sing your highest comfortable note and press Capture High.`);
      return;
    }

    setHighMidi(rounded);

    if (Number.isFinite(lowMidi) && rounded <= lowMidi) {
      setStatusMessage('High note must be above low note. Please retake the high note.');
      setStep('high');
      return;
    }

    setStep('done');
    setStatusMessage(`High note captured: ${midiToNoteLabel(rounded)}. Save your range to use later.`);
  }

  function saveRange() {
    if (!Number.isFinite(lowMidi) || !Number.isFinite(highMidi) || lowMidi >= highMidi) {
      setStatusMessage('Please capture both low and high notes before saving.');
      return;
    }

    setIsSaving(true);

    const ok = savePitchRangeSettings({ minMidi: lowMidi, maxMidi: highMidi });
    setIsSaving(false);

    if (ok) {
      setStatusMessage('Pitch range saved successfully.');
    } else {
      setStatusMessage('Could not save pitch range.');
    }
  }

  const canSave = Number.isFinite(lowMidi) && Number.isFinite(highMidi) && lowMidi < highMidi;

  return (
    <div className="grid">
      <div className="card controls">
        <h3>Pitch Range Calibration</h3>
        <p>We will capture your lowest and highest comfortable notes. This will be used later to personalize exercise keys and octaves.</p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="button" onClick={() => setRunning((value) => !value)}>
            {running ? 'Stop Mic' : 'Start Mic'}
          </button>
          <button className="button secondary" onClick={startCalibration}>Start Calibration</button>
        </div>

        <div className="readouts" style={{ gridTemplateColumns: 'repeat(2, minmax(140px, 1fr))' }}>
          <div className="stat">
            <div className="k">Detected</div>
            <div className="v">{current.note}</div>
          </div>
          <div className="stat">
            <div className="k">Pitch</div>
            <div className="v">{Number.isFinite(current.pitchHz) ? `${Math.round(current.pitchHz)} Hz` : '-'}</div>
          </div>
          <div className="stat">
            <div className="k">Low</div>
            <div className="v">{Number.isFinite(lowMidi) ? midiToNoteLabel(lowMidi) : '-'}</div>
          </div>
          <div className="stat">
            <div className="k">High</div>
            <div className="v">{Number.isFinite(highMidi) ? midiToNoteLabel(highMidi) : '-'}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="button"
            onClick={() => beginCapture('low')}
            disabled={!running || captureTarget !== null}
          >
            Capture Low
          </button>
          <button
            className="button"
            onClick={() => beginCapture('high')}
            disabled={!running || captureTarget !== null || step === 'intro'}
          >
            Capture High
          </button>
          <button className="button secondary" onClick={saveRange} disabled={!canSave || isSaving}>
            {isSaving ? 'Saving…' : 'Save Range'}
          </button>
        </div>

        <small>{statusMessage}</small>
      </div>
    </div>
  );
}

function summarizeMidi(values, percentile) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) {
    return null;
  }

  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * percentile)));
  return sorted[index];
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNoteLabel(midi) {
  const roundedMidi = Math.round(midi);
  const name = NOTE_NAMES[roundedMidi % 12] ?? 'C';
  const octave = Math.floor(roundedMidi / 12) - 1;
  return `${name}${octave}`;
}
