import React, { useState } from 'react';
import { MicPitchGraphPanel } from '../components/MicPitchGraphPanel';
import { defaultPitchSettings, loadPitchSettings, savePitchSettings } from '../lib/pitchSettings';

export function PitchLabPage() {
  const [draft, setDraft] = useState(loadPitchSettings());
  const [running, setRunning] = useState(false);

  function update(key, value) {
    setDraft((previous) => ({ ...previous, [key]: Number(value) }));
  }

  function apply() {
    savePitchSettings(draft);
  }

  function reset() {
    setDraft(defaultPitchSettings);
    savePitchSettings(defaultPitchSettings);
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
        <MicPitchGraphPanel
          title="Mic Pitch Graph"
          settings={draft}
          running={running}
          onRunningChange={setRunning}
          showControls={false}
          maxHistoryPoints={220}
        />
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

