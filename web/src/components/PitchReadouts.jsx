import React from 'react';

export function PitchReadouts({ current, style }) {
  return (
    <div className="card readouts" style={style}>
      <LabeledValue k="Pitch Hz" v={current.pitchHz ? current.pitchHz.toFixed(2) : '-'} />
      <LabeledValue k="MIDI" v={current.midi ? current.midi.toFixed(2) : '-'} />
      <LabeledValue k="Note" v={current.note} />
      <LabeledValue k="dB" v={Number.isFinite(current.db) ? current.db.toFixed(1) : '-'} />
      <LabeledValue k="Clarity" v={Number.isFinite(current.clarity) ? current.clarity.toFixed(3) : '-'} />
    </div>
  );
}

function LabeledValue({ k, v }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}
