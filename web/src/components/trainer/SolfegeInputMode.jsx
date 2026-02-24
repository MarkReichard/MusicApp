import React from 'react';
import PropTypes from 'prop-types';

const SOLFEGE_BUTTONS = [
  { label: 'Do',  semitone: 0,  bg: '#b91c1c', color: '#fff' },
  { label: 'Re',  semitone: 2,  bg: '#c2410c', color: '#fff' },
  { label: 'Mi',  semitone: 4,  bg: '#a16207', color: '#fff' },
  { label: 'Fa',  semitone: 5,  bg: '#15803d', color: '#fff' },
  { label: 'Sol', semitone: 7,  bg: '#0369a1', color: '#fff' },
  { label: 'La',  semitone: 9,  bg: '#1e3a8a', color: '#fff' },
  { label: 'Ti',  semitone: 11, bg: '#7e22ce', color: '#fff' },
];

const OCTAVE_OFFSETS = [-1, 0, 1];

export function SolfegeInputMode({ singOctave, firstNoteOctave, onInputPress, onInputRelease }) {
  const octaveGroups = OCTAVE_OFFSETS.map((octaveOffset) => {
    const octave = singOctave + octaveOffset;
    const buttons = SOLFEGE_BUTTONS.map((button) => ({
      ...button,
      octave,
      midi: 12 * (octave + 1) + button.semitone,
    }));
    return { octave, buttons };
  });

  // Highlight the group whose octave matches the first note's displayed octave
  const activeOctave = Number.isFinite(firstNoteOctave) ? firstNoteOctave : null;

  return (
    <div className="solfege-scroll">
      <div className="solfege-grid">
        {octaveGroups.map(({ octave, buttons }) => (
          <div
            key={octave}
            className={`solfege-octave-group${octave === activeOctave ? ' solfege-octave-group--active' : ''}`}
          >
            <div className="solfege-octave-label">Oct {octave}</div>
            <div className="solfege-oct-row">
              {buttons.map((button) => {
                const noteLabel = `${button.label}${button.octave}`;
                return (
                  <button
                    key={`${button.label}-${button.octave}`}
                    className="solfege-btn"
                    style={{ background: button.bg, color: button.color, borderColor: button.bg }}
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
        ))}
      </div>
    </div>
  );
}

SolfegeInputMode.propTypes = {
  singOctave: PropTypes.number.isRequired,
  firstNoteOctave: PropTypes.number,
  onInputPress: PropTypes.func.isRequired,
  onInputRelease: PropTypes.func.isRequired,
};

SolfegeInputMode.defaultProps = {
  firstNoteOctave: null,
};
