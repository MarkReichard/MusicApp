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

const OCTAVE_OFFSETS = [-1, 0, 1];

export function SolfegeInputMode({ singOctave, onInputPress, onInputRelease }) {
  const noteButtons = OCTAVE_OFFSETS.flatMap((octaveOffset) => {
    const octave = singOctave + octaveOffset;
    return SOLFEGE_BUTTONS.map((button) => ({
      ...button,
      octave,
      midi: 12 * (octave + 1) + button.semitone,
    }));
  });

  return (
    <div className="solfege-scroll">
      <div className="solfege-grid">
        {noteButtons.map((button) => {
          const noteLabel = `${button.label}${button.octave}`;
        return (
          <button
            key={`${button.label}-${button.octave}`}
            className="solfege-btn"
            title={noteLabel}
            aria-label={noteLabel}
            onPointerDown={() => onInputPress(button.midi)}
            onPointerUp={() => onInputRelease(button.midi)}
            onPointerLeave={() => onInputRelease(button.midi)}
            onPointerCancel={() => onInputRelease(button.midi)}
          >
            {noteLabel}
          </button>
        );
      })}
      </div>
    </div>
  );
}
