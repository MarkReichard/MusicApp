import React from 'react';

export function SingInputMode({
  currentNote,
  expectedMidi,
  currentSungMidi,
  graphNoteMidis,
  historyMidiPoints,
  midiToNoteLabel,
}) {
  return (
    <>
      <div className="sing-graph card">
        <div className="sing-graph-head">
          <strong>Sung Pitch</strong>
          <span>{currentNote}</span>
        </div>

        <div className="sing-graph-grid">
          {graphNoteMidis.map((midi) => {
            const isExpected = Math.round(expectedMidi ?? -999) === midi;
            const isCurrent = Math.round(currentSungMidi ?? -999) === midi;
            return (
              <div key={`guide-${midi}`} className="sing-guide-row">
                <span className={`sing-note-label ${isExpected ? 'expected' : ''} ${isCurrent ? 'current' : ''}`}>
                  {midiToNoteLabel(midi)}
                </span>
                <div className="sing-guide-line" />
              </div>
            );
          })}

          <div className="sing-history-overlay">
            {historyMidiPoints.map((midi, pointIdx) => {
              const left = historyMidiPoints.length <= 1 ? 0 : (pointIdx / (historyMidiPoints.length - 1)) * 100;
              const top = ((graphNoteMidis[0] + 0.5 - midi) / 9) * 100;
              return (
                <span
                  key={`pt-${pointIdx}`}
                  className="sing-history-point"
                  style={{ left: `${left}%`, top: `${Math.max(0, Math.min(100, top))}%` }}
                />
              );
            })}
          </div>
        </div>
      </div>
      <small>Sing the expected note. Pitch settings come from Mic Settings (local storage).</small>
    </>
  );
}
