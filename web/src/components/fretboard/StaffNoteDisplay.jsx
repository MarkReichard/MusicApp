import React from 'react';
import PropTypes from 'prop-types';
import { midiToPitchSharp } from '../../lib/fretboardGame';

const LINE_GAP = 12;
const STEP_GAP = LINE_GAP / 2;
const TREBLE_TOP = 28;
const BASS_TOP = 98;
const STAFF_START_X = 28;
const STAFF_END_X = 874;
const C4_Y = TREBLE_TOP + LINE_GAP * 4 + STEP_GAP * 2;
const CHROM_TO_DIA = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

function midiToDiatonicStepFromC4(midi) {
  const chromatic = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const diaInOct = CHROM_TO_DIA[chromatic];
  return (octave - 4) * 7 + diaInOct;
}

function stepToY(step) {
  return C4_Y - step * STEP_GAP;
}

function ledgerLineYs(step, useTrebleStaff) {
  const lowLineStep = useTrebleStaff ? 2 : -10;
  const highLineStep = useTrebleStaff ? 10 : -2;
  const ys = [];

  if (step < lowLineStep) {
    const endStep = step % 2 === 0 ? step : step - 1;
    for (let s = lowLineStep - 2; s >= endStep; s -= 2) {
      ys.push(stepToY(s));
    }
  }

  if (step > highLineStep) {
    const endStep = step % 2 === 0 ? step : step + 1;
    for (let s = highLineStep + 2; s <= endStep; s += 2) {
      ys.push(stepToY(s));
    }
  }

  return ys;
}

function accidentalFromPitch(pitch) {
  return pitch.includes('#') ? '#' : '';
}

function stepToLetter(step) {
  const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const idx = ((step % 7) + 7) % 7;
  return letters[idx];
}

function getStaffReferenceSteps() {
  return [9, 7, 5, 3, -3, -5, -7, -9];
}

export function StaffNoteDisplay({ midi, showLabel = true, keyName = 'C', showNoteNames = false }) {
  if (!Number.isFinite(midi)) {
    return <div className="card fretboard-staff-panel">No note selected.</div>;
  }

  const pitch = midiToPitchSharp(midi);
  const step = midiToDiatonicStepFromC4(midi);
  const y = stepToY(step);
  const useTrebleStaff = midi >= 60;
  const ledgers = ledgerLineYs(step, useTrebleStaff);
  const accidental = accidentalFromPitch(pitch);
  const staffReferenceSteps = getStaffReferenceSteps();
  return (
    <div className="card fretboard-staff-panel">
      <div className="fretboard-staff-header">
        <span className="fretboard-panel-title">Staff notation</span>
        <span className="fretboard-panel-title fretboard-staff-key">Key: {keyName}</span>
      </div>
      <svg className="fretboard-staff-svg" viewBox="0 0 900 170" aria-label={`Staff note ${pitch}`}>
        <title>{`Staff note ${pitch}`}</title>

        {showNoteNames
          ? staffReferenceSteps.map((referenceStep) => (
            <text
              key={`ref-${referenceStep}`}
              x="872"
              y={stepToY(referenceStep) + (referenceStep < 0 ? 2 : 5)}
              textAnchor="end"
              fontSize="10"
              fill="#cbd5e1"
              fontWeight="400"
            >
              {stepToLetter(referenceStep)}
            </text>
          ))
          : null}

        {[0, 1, 2, 3, 4].map((line) => (
          <line
            key={`treble-${line}`}
            x1={STAFF_START_X}
            y1={TREBLE_TOP + line * LINE_GAP}
            x2={STAFF_END_X}
            y2={TREBLE_TOP + line * LINE_GAP}
            stroke="#64748b"
            strokeWidth="1.4"
          />
        ))}

        {[0, 1, 2, 3, 4].map((line) => (
          <line
            key={`bass-${line}`}
            x1={STAFF_START_X}
            y1={BASS_TOP + line * LINE_GAP}
            x2={STAFF_END_X}
            y2={BASS_TOP + line * LINE_GAP}
            stroke="#64748b"
            strokeWidth="1.4"
          />
        ))}

        <line x1={STAFF_START_X} y1={TREBLE_TOP} x2={STAFF_START_X} y2={TREBLE_TOP + LINE_GAP * 4} stroke="#64748b" strokeWidth="1.4" />
        <line x1={STAFF_END_X} y1={TREBLE_TOP} x2={STAFF_END_X} y2={TREBLE_TOP + LINE_GAP * 4} stroke="#64748b" strokeWidth="1.4" />
        <line x1={STAFF_START_X} y1={BASS_TOP} x2={STAFF_START_X} y2={BASS_TOP + LINE_GAP * 4} stroke="#64748b" strokeWidth="1.4" />
        <line x1={STAFF_END_X} y1={BASS_TOP} x2={STAFF_END_X} y2={BASS_TOP + LINE_GAP * 4} stroke="#64748b" strokeWidth="1.4" />

        <text x="64" y="66" fontSize="42" fill="#e2e8f0">𝄞</text>
        <text x="60" y="147" fontSize="48" fill="#e2e8f0">𝄢</text>

        {ledgers.map((ledgerY) => (
          <line key={`ledger-${ledgerY}`} x1="498" y1={ledgerY} x2="548" y2={ledgerY} stroke="#cbd5e1" strokeWidth="1.4" />
        ))}

        {accidental ? (
          <text x="490" y={y + 5} fontSize="17" fill="#e2e8f0">{accidental}</text>
        ) : null}

        <ellipse cx="522" cy={y} rx="8.4" ry="5.8" fill="#e2e8f0" transform={`rotate(-20 522 ${y})`} />
        <line x1="529" y1={y} x2="529" y2={y - 30} stroke="#e2e8f0" strokeWidth="1.2" />
      </svg>
      {showLabel ? <div className="fretboard-note-label">{pitch}</div> : null}
    </div>
  );
}

StaffNoteDisplay.propTypes = {
  midi: PropTypes.number,
  showLabel: PropTypes.bool,
  keyName: PropTypes.string,
  showNoteNames: PropTypes.bool,
};
