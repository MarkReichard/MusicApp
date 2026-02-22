import React, { useState } from 'react';
import { MicPitchGraphPanel } from '../components/MicPitchGraphPanel';
import { loadPitchSettings } from '../lib/pitchSettings';

export function PitchGraphTestPage() {
  const [savedSettings, setSavedSettings] = useState(loadPitchSettings());

  return (
    <div>
      <div className="card controls" style={{ marginBottom: 12 }}>
        <h3>Graph Test Controls</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="button secondary" onClick={() => setSavedSettings(loadPitchSettings())}>
            Reload Saved Config
          </button>
        </div>
      </div>
      <MicPitchGraphPanel title="Mic Graph Test" settings={savedSettings} autoStart />
    </div>
  );
}
