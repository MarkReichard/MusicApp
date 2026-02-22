import React, { useEffect, useMemo, useRef, useState } from 'react';
import { drawChart } from '../lib/drawChart';
import { loadPitchSettings } from '../lib/pitchSettings';
import { usePitchDetector } from '../lib/usePitchDetector';
import { PitchReadouts } from './PitchReadouts';

export function MicPitchGraphPanel({
  title = 'Mic Pitch Graph',
  settings,
  running,
  onRunningChange,
  externalCurrent,
  externalHistory,
  autoStart = true,
  showHeader = true,
  showControls = true,
  showReadouts = true,
  maxHistoryPoints = 660,
}) {
  const [internalSettings, setInternalSettings] = useState(() => loadPitchSettings());
  const [internalRunning, setInternalRunning] = useState(autoStart);
  const effectiveSettings = settings ?? internalSettings;
  const effectiveRunning = typeof running === 'boolean' ? running : internalRunning;
  const setRunningState = onRunningChange ?? setInternalRunning;
  const usesExternalData = Boolean(externalCurrent || externalHistory);
  const effectiveShowReadouts = showReadouts && !usesExternalData;

  const { current, history, clearHistory } = usePitchDetector(
    effectiveSettings,
    effectiveRunning && !usesExternalData,
    { maxHistoryPoints },
  );
  const effectiveCurrent = externalCurrent ?? current;
  const effectiveHistory = externalHistory ?? history;
  const canvasRef = useRef(null);

  const points = useMemo(() => {
    const total = effectiveHistory.length || 1;
    return effectiveHistory.map((entry, index) => ({ ...entry, x: total === 1 ? 0 : index / (total - 1) }));
  }, [effectiveHistory]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);

    const context = canvas.getContext('2d');
    context?.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawChart(canvas, points, effectiveSettings.minFrequencyHz, effectiveSettings.maxFrequencyHz, -70, 0);
  }, [effectiveSettings.maxFrequencyHz, effectiveSettings.minFrequencyHz, points]);

  useEffect(() => {
    if (usesExternalData) {
      return undefined;
    }

    function handleStorage() {
      if (!settings) {
        setInternalSettings(loadPitchSettings());
      }
      clearHistory();
    }

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, [clearHistory, settings, usesExternalData]);

  function refreshFromSavedSettings() {
    if (!settings) {
      setInternalSettings(loadPitchSettings());
    }
    clearHistory();
  }

  return (
    <div>
      {showHeader ? (
        <div className="card controls">
          <h3>{title}</h3>
          {showControls ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="button" onClick={() => setRunningState((value) => !value)}>
                {effectiveRunning ? 'Stop' : 'Start'}
              </button>
              {!usesExternalData ? (
                <button className="button secondary" onClick={refreshFromSavedSettings}>
                  Reload Saved Settings
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {effectiveShowReadouts ? <PitchReadouts current={effectiveCurrent} style={{ marginTop: 12 }} /> : null}

      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <canvas ref={canvasRef} className="mic-settings-canvas" />
      </div>
    </div>
  );
}
