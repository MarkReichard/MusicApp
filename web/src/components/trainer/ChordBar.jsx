/**
 * ChordBar — displays chord symbols for a window of measures.
 *
 * Props:
 *   measures          Array of measure objects { index, beats, chords[] }
 *   timeSig           { beats, beatType } from the lesson (used for bar width hints)
 *   activeMeasureIdx  Optional 0-based index within `measures` to highlight
 *   className         Optional extra CSS class
 */

import PropTypes from 'prop-types';
import { GRAPH_PIXELS_PER_SECOND } from './SingInputGraphV2';

// ── Chord label helpers ────────────────────────────────────────────────────────

const KIND_SUFFIX = {
  major: '',
  'major-seventh': 'M7',
  'major-sixth': '6',
  minor: 'm',
  'minor-seventh': 'm7',
  'minor-sixth': 'm6',
  dominant: '7',
  'dominant-seventh': '7',
  'dominant-ninth': '9',
  diminished: '°',
  'diminished-seventh': '°7',
  'half-diminished': 'ø7',
  augmented: '+',
  'suspended-fourth': 'sus4',
  'suspended-second': 'sus2',
  power: '5',
};

function chordLabel(chord) {
  if (!chord) return '';
  const suffix = KIND_SUFFIX[chord.kind] ?? (chord.kind ? `(${chord.kind})` : '');
  return `${chord.root}${suffix}`;
}

/** Returns the chord that is active at a given beat (1-indexed) within a measure. */
function chordAtBeat(chords, beat) {
  if (!chords?.length) return null;
  let current = chords[0];
  for (const c of chords) {
    if (c.beat <= beat) current = c;
  }
  return current;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

/**
 * Renders a single beat cell. Shows chord label on beat 1 and on any
 * mid-measure chord changes; other beats show a rhythm dash.
 */
function BeatCell({ beats, beat1Chord, chords, isFirst, isActive, beatsInMeasure, pxPerBeat }) {
  // Collect unique chord changes for this measure
  const changes = [];
  for (let b = 1; b <= beatsInMeasure; b++) {
    const c = chords.find((ch) => ch.beat === b);
    if (c) changes.push(c);
  }

  const hasChord = !!beat1Chord;
  const multipleChords = changes.length > 1;

  return (
    <div
      className={`chord-bar-measure${isActive ? ' chord-bar-measure--active' : ''}${!hasChord ? ' chord-bar-measure--empty' : ''}`}
      style={{ width: pxPerBeat ? `${beatsInMeasure * pxPerBeat}px` : undefined, flexShrink: 0 }}
      aria-label={hasChord ? `Measure chord: ${changes.map(chordLabel).join(', ')}` : 'No chord'}
    >
      {/* Measure number */}
      <span className="chord-bar-measure-num">{beats}</span>

      {/* Chord label(s) */}
      <div className="chord-bar-chord-area">
        {hasChord ? (
          multipleChords ? (
            changes.map((c, i) => (
              <span key={i} className="chord-bar-label">
                <span className="chord-bar-beat-pos">b{c.beat}</span>
                {chordLabel(c)}
              </span>
            ))
          ) : (
            <span className="chord-bar-label">{chordLabel(beat1Chord)}</span>
          )
        ) : (
          <span className="chord-bar-label chord-bar-label--empty">—</span>
        )}
      </div>
    </div>
  );
}

BeatCell.propTypes = {
  beats: PropTypes.number.isRequired,         // measure's 1-based number within window
  beat1Chord: PropTypes.object,
  chords: PropTypes.array.isRequired,
  isFirst: PropTypes.bool,
  isActive: PropTypes.bool,
  beatsInMeasure: PropTypes.number.isRequired,
  pxPerBeat: PropTypes.number,
};

// ── Main component ─────────────────────────────────────────────────────────────

export function ChordBar({ measures, activeMeasureIdx, tempoBpm, className }) {
  if (!measures?.length) return null;

  // Fixed pixel width per beat so each cell matches 4 beats on the pitch graph.
  const pxPerBeat = tempoBpm ? (60 / tempoBpm) * GRAPH_PIXELS_PER_SECOND : null;

  return (
    <div className={`chord-bar${className ? ` ${className}` : ''}`} aria-label="Chord progression">
      {measures.map((measure, i) => {
        const { beats, chords = [] } = measure;
        const beat1Chord = chordAtBeat(chords, 1);

        return (
          <BeatCell
            key={measure.index ?? i}
            beats={i + 1}               // display measure number within window
            beat1Chord={beat1Chord}
            chords={chords}
            isFirst={i === 0}
            isActive={activeMeasureIdx === i}
            beatsInMeasure={beats ?? 4}
            pxPerBeat={pxPerBeat}
          />
        );
      })}
    </div>
  );
}

ChordBar.propTypes = {
  measures: PropTypes.arrayOf(
    PropTypes.shape({
      index: PropTypes.number,
      beats: PropTypes.number,
      chords: PropTypes.arrayOf(
        PropTypes.shape({
          beat: PropTypes.number.isRequired,
          root: PropTypes.string.isRequired,
          kind: PropTypes.string,
        }),
      ),
    }),
  ),
  activeMeasureIdx: PropTypes.number,
  tempoBpm: PropTypes.number,
  className: PropTypes.string,
};
