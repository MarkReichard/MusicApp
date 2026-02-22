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
      </div>

      {optionsOpen ? (
        <div className="options-accordion card">
          <div className="accordion-content">
            <div className="row">
              <span>Key</span>
              <select value={selectedKey} onChange={(event) => onSelectedKeyChange(event.target.value)}>
                {allowedKeys.map((key) => (
                  <option key={key} value={key}>{key}</option>
                ))}
              </select>
            </div>

            <div className="row">
              <span>Tempo (BPM)</span>
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
              <span>Singing octave</span>
              <select value={singOctave} onChange={(event) => onSingOctaveChange(Number(event.target.value))}>
                {allowedOctaves.map((octave) => (
                  <option key={octave} value={octave}>Oct {octave}</option>
                ))}
              </select>
            </div>

            <div className="row">
              <span>Play I-IV-V-IV first</span>
              <select
                value={playTonicCadence ? 'yes' : 'no'}
                onChange={(event) => onPlayTonicCadenceChange(event.target.value === 'yes')}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>

            <div className="row">
              <span>Mic settings</span>
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
