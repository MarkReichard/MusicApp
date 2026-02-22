import React from 'react';

export function PianoInputMode({ whiteKeys, blackKeys, onInputPress, onInputRelease, midiToNoteLabel }) {
  return (
    <div className="piano-wrap">
      <div className="piano-white-row">
        {whiteKeys.map((key) => (
          <button
            key={key.midi}
            className="piano-key white"
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
