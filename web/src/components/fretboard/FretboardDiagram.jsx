import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { GUITAR_STRINGS } from '../../lib/fretboardGame';

const STRING_TOP = 20;
const STRING_GAP = 11;
const NUT_X = 20;
const OPEN_NOTE_X = NUT_X - 8;
const SCALE_LENGTH_PX = 1060;

function fretDistanceFromNut(fret) {
  return SCALE_LENGTH_PX - (SCALE_LENGTH_PX / Math.pow(2, fret / 12));
}

export function FretboardDiagram({
  fretMin,
  fretMax,
  onSelectCell,
  wrongCellId,
  correctCellIds,
  highlightStringIndices,
  highlightFretRange,
  showFretLabels = true,
}) {
  const displayedStrings = useMemo(() => [...GUITAR_STRINGS].reverse(), []);

  const frets = useMemo(() => {
    const list = [];
    for (let fret = fretMin; fret <= fretMax; fret += 1) list.push(fret);
    return list;
  }, [fretMin, fretMax]);

  const correctSet = useMemo(() => new Set(correctCellIds ?? []), [correctCellIds]);
  const highlightedStrings = useMemo(() => new Set(highlightStringIndices ?? []), [highlightStringIndices]);

  const maxFret = frets.length ? frets[frets.length - 1] : fretMax;
  const width = NUT_X + fretDistanceFromNut(maxFret + 1) + 18;
  const height = STRING_TOP + (displayedStrings.length - 1) * STRING_GAP + 30;

  function fretLineX(fret) {
    return NUT_X + fretDistanceFromNut(fret);
  }

  function noteXForFret(fret) {
    if (fret <= 0) return OPEN_NOTE_X;
    return (fretLineX(fret - 1) + fretLineX(fret)) / 2;
  }

  const neckLeft = NUT_X;
  const neckRight = fretLineX(maxFret + 1);
  const neckTop = STRING_TOP - 6;
  const neckBottom = STRING_TOP + (displayedStrings.length - 1) * STRING_GAP + 6;

  const fretHighlightStart = highlightFretRange ? Math.max(fretMin, highlightFretRange.min) : null;
  const fretHighlightEnd = highlightFretRange ? Math.min(fretMax, highlightFretRange.max) : null;
  const hasFretHighlight = Number.isFinite(fretHighlightStart)
    && Number.isFinite(fretHighlightEnd)
    && fretHighlightEnd >= fretHighlightStart;

  return (
    <div className="card fretboard-board-panel">
      <div className="fretboard-panel-title">Guitar Fretboard</div>
      <svg className="fretboard-board-svg" viewBox={`0 0 ${width} ${height}`} aria-label="Interactive guitar fretboard">
        <title>Interactive guitar fretboard</title>
        <defs>
          <linearGradient id="fretboardWood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3a2f25" />
            <stop offset="40%" stopColor="#2f261e" />
            <stop offset="100%" stopColor="#241d17" />
          </linearGradient>
        </defs>

        <rect
          x={neckLeft}
          y={neckTop}
          width={neckRight - neckLeft}
          height={neckBottom - neckTop}
          fill="url(#fretboardWood)"
          stroke="#334155"
          strokeWidth="1"
          rx="3"
        />

        <rect
          x={neckLeft - 1.2}
          y={neckTop}
          width="4"
          height={neckBottom - neckTop}
          fill="#f8fafc"
          stroke="#e2e8f0"
          strokeWidth="0.8"
        />

        {hasFretHighlight ? (
          <rect
            x={fretHighlightStart === 0 ? neckLeft : fretLineX(fretHighlightStart - 1)}
            y={neckTop}
            width={(fretLineX(fretHighlightEnd) - (fretHighlightStart === 0 ? neckLeft : fretLineX(fretHighlightStart - 1))) + 1}
            height={neckBottom - neckTop}
            fill="#93c5fd22"
            stroke="#93c5fd55"
            strokeWidth="1"
          />
        ) : null}
        {frets.map((fret) => {
          const x = fretLineX(fret);
          return (
            <line
              key={`fret-${fret}`}
              x1={x}
              y1={neckTop}
              x2={x}
              y2={neckBottom}
              stroke={fret === 0 ? '#f8fafc' : '#93c5fd'}
              strokeOpacity={fret === 0 ? 1 : 0.95}
              strokeWidth={fret === 0 ? 3.2 : 1.35}
            />
          );
        })}

        {displayedStrings.map((stringInfo, displayIndex) => {
          const y = STRING_TOP + displayIndex * STRING_GAP;
          const isHighlighted = highlightedStrings.has(stringInfo.index);
          return (
            <g key={`string-${stringInfo.index}`}>
              <line
                x1={neckLeft}
                y1={y}
                x2={neckRight}
                y2={y}
                stroke={isHighlighted ? '#60a5fa' : '#f5deb3'}
                strokeOpacity={1}
                strokeWidth={isHighlighted ? 2.1 : 1 + (displayedStrings.length - displayIndex) * 0.12}
                strokeDasharray="none"
                strokeLinecap="round"
              />
            </g>
          );
        })}

        {frets.map((fret) => {
          if (fret === 0) return null;
          const x = noteXForFret(fret);
          return (
            <text key={`fret-label-${fret}`} x={x - 3} y={height - 6} fontSize="9" fill="#94a3b8">
              {showFretLabels ? fret : ''}
            </text>
          );
        })}

        {displayedStrings.flatMap((stringInfo, displayIndex) => {
          const y = STRING_TOP + displayIndex * STRING_GAP;
          const rowTop = displayIndex === 0 ? neckTop : y - STRING_GAP / 2;
          const rowBottom = displayIndex === displayedStrings.length - 1 ? neckBottom : y + STRING_GAP / 2;
          return frets.map((fret) => {
            const x = noteXForFret(fret);
            const left = fret === 0 ? OPEN_NOTE_X - 7 : fretLineX(fret - 1) + 1;
            const right = fret === 0 ? NUT_X - 1 : fretLineX(fret) - 1;
            const cellId = `s${stringInfo.index}-f${fret}`;
            const isCorrect = correctSet.has(cellId);
            const isWrong = wrongCellId === cellId;
            const markerX = fret === 0 ? NUT_X : x;
            return (
              <g key={cellId}>
                <rect
                  x={left}
                  y={rowTop}
                  width={Math.max(12, right - left)}
                  height={Math.max(10, rowBottom - rowTop)}
                  className="fretboard-hit"
                  onClick={() => onSelectCell({ id: cellId, stringIndex: stringInfo.index, fret, midi: stringInfo.openMidi + fret })}
                />
                {isCorrect ? (
                  <>
                    <circle cx={markerX} cy={y} r="5.3" fill="#16a34a33" />
                    <circle cx={markerX} cy={y} r="3.4" className="fretboard-marker fretboard-marker--correct" />
                  </>
                ) : null}
                {isWrong ? (
                  <>
                    <circle cx={markerX} cy={y} r="5.3" fill="#dc262633" />
                    <circle cx={markerX} cy={y} r="3.4" className="fretboard-marker fretboard-marker--wrong" />
                  </>
                ) : null}
              </g>
            );
          });
        })}

        {[3, 5, 7, 9].map((marker) => {
          if (marker < fretMin || marker > fretMax) return null;
          const x = noteXForFret(marker);
          const centerY = STRING_TOP + ((displayedStrings.length - 1) * STRING_GAP) / 2;
          return <circle key={`marker-${marker}`} cx={x} cy={centerY} r="2.8" fill="#d1d5db99" />;
        })}

        {12 >= fretMin && 12 <= fretMax ? (
          <>
            <circle
              cx={noteXForFret(12)}
              cy={STRING_TOP + STRING_GAP * 1.65}
              r="2.5"
              fill="#d1d5db99"
            />
            <circle
              cx={noteXForFret(12)}
              cy={STRING_TOP + STRING_GAP * 3.35}
              r="2.5"
              fill="#d1d5db99"
            />
          </>
        ) : null}
      </svg>
    </div>
  );
}

FretboardDiagram.propTypes = {
  fretMin: PropTypes.number.isRequired,
  fretMax: PropTypes.number.isRequired,
  onSelectCell: PropTypes.func.isRequired,
  wrongCellId: PropTypes.string,
  correctCellIds: PropTypes.arrayOf(PropTypes.string),
  highlightStringIndices: PropTypes.arrayOf(PropTypes.number),
  highlightFretRange: PropTypes.shape({
    min: PropTypes.number.isRequired,
    max: PropTypes.number.isRequired,
  }),
  showFretLabels: PropTypes.bool,
};
