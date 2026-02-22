import React, { useEffect, useMemo, useRef, useState } from 'react';
import { drawChart } from '../lib/drawChart';
import { loadPitchSettings } from '../lib/pitchSettings';
import { usePitchDetector } from '../lib/usePitchDetector';

export function MicPitchGraphPanel({
  title = 'Mic Pitch Graph',
  autoStart = true,
}) {
  const [settings, setSettings] = useState(loadPitchSettings());
  const [running, setRunning] = useState(autoStart);
  const { current, history, clearHistory } = usePitchDetector(settings, running, { maxHistoryPoints: 660 });
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

    drawChart(canvas, points, settings.minFrequencyHz, settings.maxFrequencyHz, -70, 0);
  }, [points, settings.maxFrequencyHz, settings.minFrequencyHz]);

  useEffect(() => {
    function handleStorage() {
      setSettings(loadPitchSettings());
      clearHistory();
    }

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, [clearHistory]);

  function refreshFromSavedSettings() {
    setSettings(loadPitchSettings());
    clearHistory();
  }

  return (
    <div>
      <div className="card controls">
        <h3>{title}</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="button" onClick={() => setRunning((value) => !value)}>
            {running ? 'Stop' : 'Start'}
          </button>
          <button className="button secondary" onClick={refreshFromSavedSettings}>
            Reload Saved Settings
          </button>
        </div>
      </div>

      <div className="card readouts" style={{ marginTop: 12 }}>
        <Stat k="Pitch Hz" v={current.pitchHz ? current.pitchHz.toFixed(2) : '-'} />
        <Stat k="MIDI" v={current.midi ? current.midi.toFixed(2) : '-'} />
        <Stat k="Note" v={current.note} />
        <Stat k="dB" v={Number.isFinite(current.db) ? current.db.toFixed(1) : '-'} />
        <Stat k="Clarity" v={Number.isFinite(current.clarity) ? current.clarity.toFixed(3) : '-'} />
      </div>

      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <canvas ref={canvasRef} className="mic-settings-canvas" />
      </div>
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
