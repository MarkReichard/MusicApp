import React from 'react';

const SOLFEGE_BUTTONS = [
  { label: 'Do', semitone: 0 },
  { label: 'Re', semitone: 2 },
  { label: 'Mi', semitone: 4 },
  { label: 'Fa', semitone: 5 },
  { label: 'Sol', semitone: 7 },
  { label: 'La', semitone: 9 },
  { label: 'Ti', semitone: 11 },
];

export function SolfegeInputMode({ singOctave, onInputPress, onInputRelease }) {
  return (
    <div className="solfege-grid">
      {SOLFEGE_BUTTONS.map((button) => {
        const midi = 12 * (singOctave + 1) + button.semitone;
        return (
          <button
            key={button.label}
            className="solfege-btn"
            onPointerDown={() => onInputPress(midi)}
            onPointerUp={() => onInputRelease(midi)}
            onPointerLeave={() => onInputRelease(midi)}
            onPointerCancel={() => onInputRelease(midi)}
          >
            {button.label}
          </button>
        );
      })}
    </div>
  );
}
