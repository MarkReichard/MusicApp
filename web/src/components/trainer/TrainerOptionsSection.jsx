import React from 'react';
import { Link } from 'react-router-dom';

export function TrainerOptionsSection({
  optionsOpen,
  onToggleOptions,
  allowedKeys,
  selectedKey,
  onSelectedKeyChange,
  tempoRange,
  tempoBpm,
  onTempoBpmChange,
  allowedOctaves,
  singOctave,
  onSingOctaveChange,
  playTonicCadence,
  onPlayTonicCadenceChange,
  mode,
  onModeChange,
  currentNote,
}) {
  return (
    <>
      <div className="trainer-controls-row">
        <button
          className="accordion-toggle trainer-options-toggle"
          onClick={onToggleOptions}
          type="button"
          title={optionsOpen ? 'Hide training options' : 'Show training options'}
          aria-label={optionsOpen ? 'Hide training options' : 'Show training options'}
        >
          <span>Training Options</span>
          <span>{optionsOpen ? '▾' : '▸'}</span>
        </button>

        <div className="trainer-inline-field">
          <label>Input mode</label>
          <select value={mode} onChange={(event) => onModeChange(event.target.value)}>
            <option value="piano">Piano</option>
            <option value="solfege">Solfege</option>
            <option value="sing">Sing</option>
          </select>
        </div>

        {mode === 'sing' ? (
          <div className="trainer-detected-note">
            <span>Detected note: </span>
            <strong>{currentNote}</strong>
          </div>
        ) : null}

      </div>

      {optionsOpen ? (
        <div className="options-accordion card">
          <div className="accordion-content">
            <div className="row">
              <label>Key</label>
              <select value={selectedKey} onChange={(event) => onSelectedKeyChange(event.target.value)}>
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
                  onTempoBpmChange(clamped);
                }}
              />
            </div>

            <div className="row">
              <label>Singing octave</label>
              <select value={singOctave} onChange={(event) => onSingOctaveChange(Number(event.target.value))}>
                {allowedOctaves.map((octave) => (
                  <option key={octave} value={octave}>Oct {octave}</option>
                ))}
              </select>
            </div>

            <div className="row">
              <label>Play I-IV-V-IV first</label>
              <select
                value={playTonicCadence ? 'yes' : 'no'}
                onChange={(event) => onPlayTonicCadenceChange(event.target.value === 'yes')}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>

            <div className="row">
              <label>Mic settings</label>
              <Link
                className="button secondary"
                to="/pitch-lab"
                title="Open mic settings"
                aria-label="Open mic settings"
              >
                Open Mic Settings
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
