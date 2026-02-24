import React from 'react';
import PropTypes from 'prop-types';

export function PianoInputMode({ whiteKeys, blackKeys, onInputPress, onInputRelease, midiToNoteLabel, activeOctave }) {
  return (
    <div className="piano-wrap">
      <div className="piano-white-row">
        {whiteKeys.map((key) => (
          <button
            key={key.midi}
            className={`piano-key white${Number.isFinite(activeOctave) && key.octave === activeOctave ? ' piano-key--octave-active' : ''}`}
            onPointerDown={() => onInputPress(key.midi)}
            onPointerUp={() => onInputRelease(key.midi)}
            onPointerLeave={() => onInputRelease(key.midi)}
            onPointerCancel={() => onInputRelease(key.midi)}
          >
            {midiToNoteLabel(key.midi)}
          </button>
        ))}
      </div>
      {blackKeys.map((key) => (
        <button
          key={key.midi}
          className="piano-key black"
          style={{ left: `${key.left}px` }}
          onPointerDown={() => onInputPress(key.midi)}
          onPointerUp={() => onInputRelease(key.midi)}
          onPointerLeave={() => onInputRelease(key.midi)}
          onPointerCancel={() => onInputRelease(key.midi)}
        >
          {midiToNoteLabel(key.midi)}
        </button>
      ))}
    </div>
  );
}

const keyShape = PropTypes.shape({
  midi: PropTypes.number.isRequired,
  octave: PropTypes.number,
  noteName: PropTypes.string,
  isBlack: PropTypes.bool,
  left: PropTypes.number,
});

PianoInputMode.propTypes = {
  whiteKeys: PropTypes.arrayOf(keyShape).isRequired,
  blackKeys: PropTypes.arrayOf(keyShape).isRequired,
  onInputPress: PropTypes.func.isRequired,
  onInputRelease: PropTypes.func.isRequired,
  midiToNoteLabel: PropTypes.func.isRequired,
  activeOctave: PropTypes.number,
};

PianoInputMode.defaultProps = {
  activeOctave: null,
};
