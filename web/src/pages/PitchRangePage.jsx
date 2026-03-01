import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadPitchSettings } from '../lib/pitchSettings';
import { usePitchDetector } from '../lib/usePitchDetector';
import { loadPitchRangeSettings, savePitchRangeSettings } from '../lib/pitchRangeSettings';

const CAPTURE_DURATION_MS = 2600;
const MIN_SAMPLE_COUNT = 10;

export function PitchRangePage() {
  const pitchSettings = useMemo(() => loadPitchSettings(), []);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState('intro'); // intro | low | high | done
  const [capturing, setCapturing] = useState(false);
  const [captureProgress, setCaptureProgress] = useState(0); // 0–100
  const [lowMidi, setLowMidi] = useState(null);
  const [highMidi, setHighMidi] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [saved, setSaved] = useState(false);

  const captureBufferRef = useRef([]);
  const captureTimeoutRef = useRef(null);
  const progressIntervalRef = useRef(null);
  const lowMidiRef = useRef(null);

  const { current } = usePitchDetector(pitchSettings, running, { maxHistoryPoints: 260 });

  useEffect(() => {
    const savedRange = loadPitchRangeSettings();
    if (Number.isFinite(savedRange.minMidi) && Number.isFinite(savedRange.maxMidi)) {
      setLowMidi(savedRange.minMidi);
      lowMidiRef.current = savedRange.minMidi;
      setHighMidi(savedRange.maxMidi);
      setStep('done');
      setSaved(true);
    }
  }, []);

  useEffect(() => {
    if (!capturing || !Number.isFinite(current.midi)) return;
    captureBufferRef.current.push(current.midi);
  }, [capturing, current.midi]);

  useEffect(() => {
    return () => {
      globalThis.clearTimeout(captureTimeoutRef.current);
      globalThis.clearInterval(progressIntervalRef.current);
    };
  }, []);

  function begin() {
    setRunning(true);
    setStep('low');
    setLowMidi(null);
    lowMidiRef.current = null;
    setHighMidi(null);
    setErrorMessage('');
    setSaved(false);
  }

  function startCapture(target) {
    setErrorMessage('');
    setCapturing(true);
    setCaptureProgress(0);
    captureBufferRef.current = [];

    const startTime = Date.now();
    progressIntervalRef.current = globalThis.setInterval(() => {
      const pct = Math.min(100, ((Date.now() - startTime) / CAPTURE_DURATION_MS) * 100);
      setCaptureProgress(pct);
    }, 50);

    captureTimeoutRef.current = globalThis.setTimeout(() => {
      globalThis.clearInterval(progressIntervalRef.current);
      setCapturing(false);
      setCaptureProgress(0);

      const captured = captureBufferRef.current.slice();
      captureBufferRef.current = [];

      if (captured.length < MIN_SAMPLE_COUNT) {
        setErrorMessage("We didn't detect a steady note. Make sure your microphone is working, sing a clear held note, and try again.");
        return;
      }

      const representative = summarizeMidi(captured, target === 'low' ? 0.2 : 0.8);
      if (!Number.isFinite(representative)) {
        setErrorMessage('Capture failed – please try again.');
        return;
      }

      const rounded = Math.round(representative);

      if (target === 'low') {
        setLowMidi(rounded);
        lowMidiRef.current = rounded;
        setStep('high');
      } else {
        const savedLow = lowMidiRef.current;
        if (Number.isFinite(savedLow) && rounded <= savedLow) {
          setErrorMessage(`That note (${midiToNoteLabel(rounded)}) isn't higher than your low note (${midiToNoteLabel(savedLow)}). Sing higher and try again.`);
          return;
        }
        setHighMidi(rounded);
        setStep('done');
      }
    }, CAPTURE_DURATION_MS);
  }

  function saveRange() {
    if (!Number.isFinite(lowMidi) || !Number.isFinite(highMidi) || lowMidi >= highMidi) return;
    const ok = savePitchRangeSettings({ minMidi: lowMidi, maxMidi: highMidi });
    if (ok) setSaved(true);
    else setErrorMessage('Could not save. Please try again.');
  }

  function restart() {
    globalThis.clearTimeout(captureTimeoutRef.current);
    globalThis.clearInterval(progressIntervalRef.current);
    setCapturing(false);
    setCaptureProgress(0);
    setStep('low');
    setLowMidi(null);
    lowMidiRef.current = null;
    setHighMidi(null);
    setErrorMessage('');
    setSaved(false);
    setRunning(true);
  }

  const liveNote = current.note ?? '–';
  const liveHz   = Number.isFinite(current.pitchHz) ? `${Math.round(current.pitchHz)} Hz` : '';

  // ── Intro ────────────────────────────────────────────────────────────────────
  if (step === 'intro') {
    return (
      <div className="grid">
        <div className="card controls" style={{ maxWidth: 520 }}>
          <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎤</div>
            <h2 style={{ margin: '0 0 12px' }}>Find Your Vocal Range</h2>
            <p style={{ color: '#94a3b8', marginBottom: 20, lineHeight: 1.6 }}>
              We'll record your lowest and highest comfortable singing notes.
              This takes about 30 seconds and helps choose the right
              keys and octaves for every exercise.
            </p>
            <ol style={{ textAlign: 'left', color: '#94a3b8', lineHeight: 2.2, marginBottom: 28, paddingLeft: 24 }}>
              <li>Allow microphone access when prompted</li>
              <li>Sing your <strong style={{ color: '#e2e8f0' }}>lowest</strong> comfortable note and hold it</li>
              <li>Sing your <strong style={{ color: '#e2e8f0' }}>highest</strong> comfortable note and hold it</li>
              <li>Save your range — done!</li>
            </ol>
            <button className="button" style={{ fontSize: 17, padding: '13px 36px' }} onClick={begin}>
              Get Started →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Low note ─────────────────────────────────────────────────────────────────
  if (step === 'low') {
    return (
      <WizardStep
        stepNum={1} totalSteps={2}
        icon="⬇️"
        title="Sing Your Lowest Note"
        instruction={<>Sing the <strong>lowest comfortable note</strong> you can hold clearly — not strained, just comfortably low. Hold it steady, then tap <em>Capture</em>.</>}
        liveNote={liveNote} liveHz={liveHz}
        capturing={capturing} captureProgress={captureProgress}
        errorMessage={errorMessage}
        onCapture={() => startCapture('low')}
        onRestart={restart}
      />
    );
  }

  // ── High note ─────────────────────────────────────────────────────────────────
  if (step === 'high') {
    return (
      <WizardStep
        stepNum={2} totalSteps={2}
        icon="⬆️"
        title="Now Sing Your Highest Note"
        instruction={<>Great! Now sing the <strong>highest comfortable note</strong> you can hold clearly — not strained, just comfortably high. Hold it steady, then tap <em>Capture</em>.</>}
        liveNote={liveNote} liveHz={liveHz}
        capturing={capturing} captureProgress={captureProgress}
        errorMessage={errorMessage}
        onCapture={() => startCapture('high')}
        onRestart={restart}
        previousLabel="Low note"
        previousValue={lowMidi !== null ? midiToNoteLabel(lowMidi) : null}
      />
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────────
  return (
    <div className="grid">
      <div className="card controls" style={{ maxWidth: 520 }}>
        <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>{saved ? '✅' : '🎉'}</div>
          <h2 style={{ margin: '0 0 8px' }}>{saved ? 'Vocal Range Saved!' : 'Range Captured!'}</h2>
          {saved
            ? <p style={{ color: '#86efac', marginBottom: 20 }}>Your range is saved and will personalize your lessons and exercises.</p>
            : <p style={{ color: '#94a3b8', marginBottom: 20 }}>Looking good! Save your range so lessons and exercises can use it.</p>
          }

          <div style={{ display: 'flex', justifyContent: 'center', gap: 40, margin: '20px 0 28px', flexWrap: 'wrap' }}>
            <RangeResult label="Lowest note" note={lowMidi !== null ? midiToNoteLabel(lowMidi) : '–'} color="#7dd3fc" />
            <RangeResult label="Highest note" note={highMidi !== null ? midiToNoteLabel(highMidi) : '–'} color="#f9a8d4" />
            {lowMidi !== null && highMidi !== null && (
              <RangeResult label="Span" note={`${highMidi - lowMidi} semitones`} color="#fde68a" />
            )}
          </div>

          {!saved && (
            <button
              className="button"
              style={{ fontSize: 17, padding: '13px 36px', marginBottom: 8 }}
              onClick={saveRange}
            >
              Save My Range
            </button>
          )}

          {errorMessage && (
            <p style={{ color: '#f87171', fontSize: 14, marginTop: 8 }}>{errorMessage}</p>
          )}

          <div style={{ marginTop: 16 }}>
            <button className="button secondary" onClick={restart}>Redo Calibration</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Wizard step layout ────────────────────────────────────────────────────────

function WizardStep({
  stepNum, totalSteps, icon, title, instruction,
  liveNote, liveHz, capturing, captureProgress,
  errorMessage, onCapture, onRestart,
  previousLabel, previousValue,
}) {
  return (
    <div className="grid">
      <div className="card controls" style={{ maxWidth: 520 }}>
        {/* Step progress bar */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              style={{
                flex: 1, height: 4, borderRadius: 2,
                background: i < stepNum ? '#3b82f6' : '#334155',
                transition: 'background 0.3s',
              }}
            />
          ))}
        </div>
        <p style={{ color: '#64748b', fontSize: 12, margin: '0 0 20px', textTransform: 'uppercase', letterSpacing: 1 }}>
          Step {stepNum} of {totalSteps}
        </p>

        <div style={{ textAlign: 'center', paddingBottom: 8 }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>{icon}</div>
          <h2 style={{ margin: '0 0 12px' }}>{title}</h2>
          <p style={{ color: '#94a3b8', lineHeight: 1.6, marginBottom: 24, maxWidth: 380, margin: '0 auto 24px' }}>
            {instruction}
          </p>

          {/* Previous capture chip */}
          {previousLabel && previousValue && (
            <div style={{ marginBottom: 20 }}>
              <span style={{ background: '#1e3a5f', color: '#7dd3fc', fontSize: 13, padding: '4px 14px', borderRadius: 20 }}>
                {previousLabel}: <strong>{previousValue}</strong>
              </span>
            </div>
          )}

          {/* Live pitch display */}
          <div style={{
            background: '#1e293b', borderRadius: 12, padding: '16px 28px',
            marginBottom: 24, display: 'inline-block', minWidth: 160,
          }}>
            <div style={{
              fontSize: 40, fontWeight: 700, letterSpacing: 2,
              color: capturing ? '#86efac' : '#e2e8f0',
              transition: 'color 0.3s',
            }}>
              {liveNote}
            </div>
            <div style={{ color: '#64748b', fontSize: 13, marginTop: 4, minHeight: 18 }}>{liveHz}</div>
          </div>

          {/* Capture button or progress bar */}
          {capturing ? (
            <div style={{ marginBottom: 16 }}>
              <p style={{ color: '#86efac', marginBottom: 10, fontWeight: 500 }}>🎙 Capturing… keep holding that note!</p>
              <div style={{ background: '#1e293b', borderRadius: 8, height: 10, overflow: 'hidden', maxWidth: 300, margin: '0 auto' }}>
                <div style={{
                  height: '100%', background: '#3b82f6', borderRadius: 8,
                  width: `${captureProgress}%`, transition: 'width 0.05s linear',
                }} />
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 8 }}>
              <button
                className="button"
                style={{ fontSize: 18, padding: '14px 40px' }}
                onClick={onCapture}
              >
                🎤 Capture
              </button>
            </div>
          )}

          {errorMessage && (
            <p style={{ color: '#f87171', fontSize: 14, marginTop: 12, lineHeight: 1.5, maxWidth: 360, margin: '12px auto 0' }}>
              {errorMessage}
            </p>
          )}

          <div style={{ marginTop: 24 }}>
            <button className="button secondary" style={{ fontSize: 13, padding: '6px 16px' }} onClick={onRestart}>
              Start Over
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RangeResult({ label, note, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color: '#64748b', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color }}>{note}</div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function summarizeMidi(values, percentile) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
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
