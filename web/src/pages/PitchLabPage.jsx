import React, { useEffect, useMemo, useRef, useState } from 'react';
import { drawChart } from '../lib/drawChart';
import { defaultPitchSettings, loadPitchSettings, savePitchSettings } from '../lib/pitchSettings';
import { usePitchDetector } from '../lib/usePitchDetector';

export function PitchLabPage() {
  const [draft, setDraft] = useState(loadPitchSettings());
  const [applied, setApplied] = useState(loadPitchSettings());
  const [running, setRunning] = useState(false);

  const { current, history, clearHistory } = usePitchDetector(applied, running);
  const canvasRef = useRef(null);

  const points = useMemo(() => {
    const total = history.length || 1;
    return history.map((entry, index) => ({ ...entry, x: total === 1 ? 0 : index / (total - 1) }));
  }, [history]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const context = canvas.getContext('2d');
    context?.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawChart(canvas, points, applied.minFrequencyHz, applied.maxFrequencyHz, -70, 0);
  }, [applied.maxFrequencyHz, applied.minFrequencyHz, points]);

  function update(key, value) {
    setDraft((previous) => ({ ...previous, [key]: Number(value) }));
  }

  function apply() {
    setApplied(draft);
    savePitchSettings(draft);
    clearHistory();
  }

  function reset() {
    setDraft(defaultPitchSettings);
    setApplied(defaultPitchSettings);
    savePitchSettings(defaultPitchSettings);
    clearHistory();
  }

  return (
    <div className="grid">
      <div className="card controls">
        <h3>Mic Settings Controls</h3>
        <Field label="Sample rate" value={draft.sampleRate} onChange={(v) => update('sampleRate', v)} />
        <Field label="Samples (fftSize)" value={draft.fftSize} onChange={(v) => update('fftSize', v)} />
        <Field label="Poll ms" value={draft.pollMs} onChange={(v) => update('pollMs', v)} />
        <Field label="Average readings" value={draft.averageReadings} onChange={(v) => update('averageReadings', v)} />
        <Field label="Min Hz" value={draft.minFrequencyHz} onChange={(v) => update('minFrequencyHz', v)} />
        <Field label="Max Hz" value={draft.maxFrequencyHz} onChange={(v) => update('maxFrequencyHz', v)} />
        <Field label="Min clarity" value={draft.minClarity} step="0.01" onChange={(v) => update('minClarity', v)} />
        <Field label="Min dB" value={draft.minDbThreshold} onChange={(v) => update('minDbThreshold', v)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="button" onClick={() => setRunning((r) => !r)}>{running ? 'Stop' : 'Start'}</button>
          <button className="button secondary" onClick={apply}>Apply + Save</button>
          <button className="button secondary" onClick={reset}>Reset</button>
        </div>
      </div>

      <div>
        <div className="card readouts">
          <Stat k="Pitch Hz" v={current.pitchHz ? current.pitchHz.toFixed(2) : '-'} />
          <Stat k="MIDI" v={current.midi ? current.midi.toFixed(2) : '-'} />
          <Stat k="Note" v={current.note} />
          <Stat k="dB" v={Number.isFinite(current.db) ? current.db.toFixed(1) : '-'} />
          <Stat k="Clarity" v={Number.isFinite(current.clarity) ? current.clarity.toFixed(3) : '-'} />
        </div>
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <canvas ref={canvasRef} />
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, step = '1' }) {
  return (
    <div className="row">
      <label>{label}</label>
      <input type="number" value={value} step={step} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function Stat({ k, v }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}
