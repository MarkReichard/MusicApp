/**
 * SongBuilderPage — build song lesson JSON via the UI.
 *
 * Workflow:
 *  1. Fill in song details (metadata, including time signature).
 *  2. Build measures in the score view; click a measure to edit it.
 *  3. The single-measure editor shows notes/chords for the selected measure.
 *  4. Copy the generated JSON and save it to content/lessons/.
 *
 * All measures share the time signature's beat count.
 * Measures whose notes don't sum to that beat count are flagged with a red border.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { lessons } from '../lib/lessons';
import { isSongLesson } from '../lib/lessonUtils';
import { KEY_TO_SEMITONE } from '../lib/musicTheory';

// ── Constants ──────────────────────────────────────────────────────────────────

const DEGREES = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti'];
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
const BEAT_TYPES = [2, 4, 8, 16];

const DURATION_OPTIONS = [
  { label: '♩♩♩♩ Whole (4)', value: '4' },
  { label: '♩♩♩. Dotted Half (3)', value: '3' },
  { label: '♩♩ Half (2)', value: '2' },
  { label: '♩. Dotted Qtr (1.5)', value: '1.5' },
  { label: '♩ Quarter (1)', value: '1' },
  { label: '♪ Eighth (0.5)', value: '0.5' },
  { label: '𝅘𝅥𝅯 16th (0.25)', value: '0.25' },
];

const CHORD_KINDS = [
  'major', 'minor', 'dominant', 'dominant-seventh', 'major-seventh',
  'minor-seventh', 'diminished', 'augmented', 'suspended-fourth', 'suspended-second',
];

const NOTE_ROOTS = [
  'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E',
  'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B',
];

const KEY_OPTIONS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const CHORD_KIND_SUFFIX = {
  major: '', minor: 'm', dominant: '7', 'dominant-seventh': '7',
  'major-seventh': 'M7', 'minor-seventh': 'm7',
  diminished: '°', augmented: '+', 'suspended-fourth': 'sus4', 'suspended-second': 'sus2',
};

// ── Notation SVG constants (treble clef) ───────────────────────────────────────

const STAFF_TOP     = 22;                              // y of top staff line (F5)
const LINE_GAP      = 10;                              // px between staff lines
const BOTTOM_LINE_Y = STAFF_TOP + LINE_GAP * 4;       // 62  – bottom line E4
const MIDDLE_LINE_Y = STAFF_TOP + LINE_GAP * 2;       // 42  – middle line B4
const CELL_H        = 96;                              // SVG cell total height
const NOTE_RX       = 5;                               // note head half-width
const NOTE_RY       = 3.5;                             // note head half-height
const STEM_LEN      = 28;                              // stem length in px
const BEAT_PX       = 24;                              // px per beat (quarter note)
const CELL_LEFT     = 18;                              // left content pad
const CELL_RIGHT    = 12;                              // right pad
const CHORD_TY      = 92;                              // y for chord label text

// Chromatic position (0=C) → diatonic index within octave (0=C)
const CHROM_TO_DIA = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

const DOTTED_DURS = new Set([0.375, 0.75, 1.5, 3]);

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Parse pitch string like "E4", "C#4", "Bb3" → MIDI number, or null on failure. */
function pitchToMidi(pitch) {
  const m = /^([A-Ga-g][b#]?)(\d+)$/.exec(String(pitch).trim());
  if (!m) return null;
  const noteName = m[1][0].toUpperCase() + m[1].slice(1);
  const oct = Number.parseInt(m[2], 10);
  const semi = KEY_TO_SEMITONE[noteName];
  if (semi === undefined) return null;
  return (oct + 1) * 12 + semi;
}

function parseIntOr(str, fallback) {
  const n = Number.parseInt(str, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseFloatOr(str, fallback) {
  const n = Number.parseFloat(str);
  return Number.isFinite(n) ? n : fallback;
}

function parseCommaSeparated(str) {
  return String(str ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

let _uid = 0;
function uid() { return `_${++_uid}`; }

// ── Notation helpers ───────────────────────────────────────────────────────────

/**
 * Returns the SVG y-coordinate for a MIDI note number in treble-clef orientation.
 * E4 (MIDI 64) sits on the bottom staff line (BOTTOM_LINE_Y).
 * Each diatonic step upward moves y by -(LINE_GAP/2).
 */
function noteY(midi) {
  const chromatic  = ((midi % 12) + 12) % 12;
  const octave     = Math.floor(midi / 12) - 1; // MIDI 60 = C4
  const diaInOct   = CHROM_TO_DIA[chromatic];
  const stepsFromE4 = (octave - 4) * 7 + diaInOct - 2; // E4 is diatonic step 2 from C4
  return BOTTOM_LINE_Y - stepsFromE4 * (LINE_GAP / 2);
}

/**
 * Returns an array of y positions at which ledger lines must be drawn for this note.
 * Every even diatonic step outside [0, 8] needs a ledger line.
 */
function ledgerLineYs(midi) {
  const chromatic   = ((midi % 12) + 12) % 12;
  const octave      = Math.floor(midi / 12) - 1;
  const diaInOct    = CHROM_TO_DIA[chromatic];
  const step        = (octave - 4) * 7 + diaInOct - 2;
  const halfGap     = LINE_GAP / 2;
  const ys = [];
  if (step <= -2) {
    const endStep = step % 2 === 0 ? step : step + 1;
    for (let s = -2; s >= endStep; s -= 2) ys.push(BOTTOM_LINE_Y - s * halfGap);
  }
  if (step >= 10) {
    const endStep = step % 2 === 0 ? step : step - 1;
    for (let s = 10; s <= endStep; s += 2) ys.push(BOTTOM_LINE_Y - s * halfGap);
  }
  return ys;
}

/** Extract '#' or 'b' accidental from a pitch string, or '' if natural. */
function getAccidental(pitch) {
  const m = /^[A-Ga-g]([#b])/.exec(String(pitch));
  return m ? m[1] : '';
}

/** Short chord label like "Am7" from a chord state object. */
function chordShortLabel(chord) {
  return `${chord.root}${CHORD_KIND_SUFFIX[chord.kind] ?? ''}`;
}

function measureTotalBeats(measure) {
  return measure.notes.reduce((s, n) => s + parseFloatOr(n.durationBeats, 0), 0);
}

// ── State factories ────────────────────────────────────────────────────────────

function emptyNote() {
  return { _id: uid(), type: 'note', pitch: 'C4', durationBeats: '1', degree: 'Do' };
}
function emptyRest() {
  return { _id: uid(), type: 'rest', pitch: '', durationBeats: '1', degree: '' };
}
function emptyChord() {
  return { _id: uid(), beat: '1', root: 'C', kind: 'major' };
}
function emptyMeasure() {
  // beats are driven by timeSig — no per-measure beats field
  return { _id: uid(), notes: [emptyNote()], chords: [] };
}
function emptyMeta() {
  return {
    id: '', name: '', category: '', difficulty: 'beginner', tags: '',
    defaultKey: 'C', allowedKeys: 'C',
    defaultTempoBpm: '90', tempoMin: '30', tempoMax: '240',
    defaultChunkSize: '', chunkSizeMin: '', chunkSizeMax: '',
    defaultOctave: '4', allowedOctaves: '2, 3, 4, 5',
    timeSigBeats: '4', timeSigBeatType: '4',
  };
}

// ── Build final JSON object ────────────────────────────────────────────────────

function buildLesson(meta, measures) {
  const timeSigBeats = parseIntOr(meta.timeSigBeats, 4);
  const obj = {
    id: meta.id.trim() || 'song_untitled',
    name: meta.name.trim() || 'Untitled Song',
    category: meta.category.trim() || 'folk_songs',
    type: 'song',
    difficulty: meta.difficulty,
    tags: parseCommaSeparated(meta.tags),
    defaultKey: meta.defaultKey,
    allowedKeys: parseCommaSeparated(meta.allowedKeys),
    defaultTempoBpm: parseIntOr(meta.defaultTempoBpm, 90),
    tempoRange: { min: parseIntOr(meta.tempoMin, 30), max: parseIntOr(meta.tempoMax, 240) },
    defaultOctave: parseIntOr(meta.defaultOctave, 4),
    allowedOctaves: parseCommaSeparated(meta.allowedOctaves).map(Number).filter(Number.isFinite),
    timeSig: {
      beats: timeSigBeats,
      beatType: parseIntOr(meta.timeSigBeatType, 4),
    },
    measures: measures.map((m, i) => ({
      index: i,
      beats: timeSigBeats, // all measures share the time signature beat count
      notes: m.notes.map((n) => {
        if (n.type === 'rest') {
          return { type: 'rest', durationBeats: parseFloatOr(n.durationBeats, 1) };
        }
        return {
          type: 'note',
          pitch: n.pitch.trim(),
          midi: pitchToMidi(n.pitch) ?? 60,
          degree: n.degree,
          durationBeats: parseFloatOr(n.durationBeats, 1),
        };
      }),
      chords: m.chords.map((c) => ({
        beat: parseIntOr(c.beat, 1),
        root: c.root,
        kind: c.kind,
      })),
    })),
    source: { kind: 'preloaded', version: '1.0.0' },
    updatedAt: new Date().toISOString(),
  };
  if (meta.defaultChunkSize.trim()) obj.defaultChunkSize = parseIntOr(meta.defaultChunkSize, 5);
  if (meta.chunkSizeMin.trim() && meta.chunkSizeMax.trim()) {
    obj.chunkSizeRange = { min: parseIntOr(meta.chunkSizeMin, 3), max: parseIntOr(meta.chunkSizeMax, 8) };
  }
  return obj;
}

// ── Load existing lesson into editor state ─────────────────────────────────────

function lessonToState(lesson) {
  const meta = {
    id: lesson.id ?? '',
    name: lesson.name ?? '',
    category: lesson.category ?? '',
    difficulty: lesson.difficulty ?? 'beginner',
    tags: (lesson.tags ?? []).join(', '),
    defaultKey: lesson.defaultKey ?? 'C',
    allowedKeys: (lesson.allowedKeys ?? ['C']).join(', '),
    defaultTempoBpm: String(lesson.defaultTempoBpm ?? 90),
    tempoMin: String(lesson.tempoRange?.min ?? 30),
    tempoMax: String(lesson.tempoRange?.max ?? 240),
    defaultChunkSize: lesson.defaultChunkSize == null ? '' : String(lesson.defaultChunkSize),
    chunkSizeMin: lesson.chunkSizeRange?.min == null ? '' : String(lesson.chunkSizeRange.min),
    chunkSizeMax: lesson.chunkSizeRange?.max == null ? '' : String(lesson.chunkSizeRange.max),
    defaultOctave: String(lesson.defaultOctave ?? 4),
    allowedOctaves: (lesson.allowedOctaves ?? [2, 3, 4, 5]).join(', '),
    timeSigBeats: String(lesson.timeSig?.beats ?? 4),
    timeSigBeatType: String(lesson.timeSig?.beatType ?? 4),
  };
  // Drop per-measure beats; all measures use timeSig.beats
  const measures = (lesson.measures ?? []).map((m) => ({
    _id: uid(),
    notes: (m.notes ?? []).map((n) => ({
      _id: uid(),
      type: n.type ?? 'note',
      pitch: n.pitch ?? 'C4',
      durationBeats: String(n.durationBeats ?? 1),
      degree: n.degree ?? 'Do',
    })),
    chords: (m.chords ?? []).map((c) => ({
      _id: uid(),
      beat: String(c.beat ?? 1),
      root: c.root ?? 'C',
      kind: c.kind ?? 'major',
    })),
  }));
  return { meta, measures: measures.length > 0 ? measures : [emptyMeasure()] };
}


// ── NoteRow ────────────────────────────────────────────────────────────────────

// ── RestSymbol ─────────────────────────────────────────────────────────────────

function RestSymbol({ x, dur, color }) {
  // Whole rest: block hanging below 4th line
  if (dur >= 4) {
    return <rect x={x - 6} y={MIDDLE_LINE_Y - LINE_GAP - 5} width={12} height={5} fill={color} />;
  }
  // Half rest: block sitting on middle line
  if (dur >= 2) {
    return <rect x={x - 6} y={MIDDLE_LINE_Y - 5} width={12} height={5} fill={color} />;
  }
  // Quarter rest: squiggle
  if (dur >= 1) {
    return (
      <g stroke={color} strokeWidth={1.5} fill="none">
        <path d={`M${x},${MIDDLE_LINE_Y - 8} l3,4 l-5,4 l4,4 l-2,4`} />
      </g>
    );
  }
  // Eighth rest: vertical line with dot
  return (
    <g>
      <line x1={x} y1={MIDDLE_LINE_Y - 8} x2={x} y2={MIDDLE_LINE_Y + 5} stroke={color} strokeWidth={1.5} />
      <circle cx={x + 3} cy={MIDDLE_LINE_Y - 5} r={2} fill={color} />
    </g>
  );
}

RestSymbol.propTypes = {
  x: PropTypes.number.isRequired,
  dur: PropTypes.number.isRequired,
  color: PropTypes.string.isRequired,
};

// ── MeasureNotation ────────────────────────────────────────────────────────────

function MeasureNotation({ measure, index, timeSigBeats, isSelected, onClick }) {
  const totalBeats = measureTotalBeats(measure);
  const beatsMismatch = Math.abs(totalBeats - timeSigBeats) > 0.001;
  const cellBeats = Math.max(totalBeats, timeSigBeats, 1);
  const cellW = CELL_LEFT + cellBeats * BEAT_PX + CELL_RIGHT;
  const noteColor = '#e2e8f0';
  const errorColor = '#f87171';

  // Assign x positions based on cumulative beat position
  let beatPos = 0;
  const noteItems = measure.notes.map((n) => {
    const x = CELL_LEFT + beatPos * BEAT_PX + BEAT_PX / 2;
    const dur = parseFloatOr(n.durationBeats, 1);
    beatPos += dur;
    return { n, x, dur };
  });

  // Chord labels keyed by beat number
  const chordsByBeat = {};
  for (const c of measure.chords) {
    const beat = parseIntOr(c.beat, 1);
    chordsByBeat[beat] = chordShortLabel(c);
  }

  let cls = 'sb-notation-cell';
  if (isSelected) cls += ' sb-notation-cell--sel';
  if (beatsMismatch) cls += ' sb-notation-cell--err';

  return (
    <button type="button" className={cls} onClick={onClick} title={`Measure ${index + 1}`}>
      <svg width={cellW} height={CELL_H} style={{ display: 'block' }}>
        {/* Measure index label */}
        <text x={2} y={11} fontSize={9} fill="#64748b">{index + 1}</text>

        {/* Staff lines */}
        {[0, 1, 2, 3, 4].map((li) => (
          <line
            key={li}
            x1={CELL_LEFT - 4} y1={STAFF_TOP + li * LINE_GAP}
            x2={cellW - CELL_RIGHT + 4} y2={STAFF_TOP + li * LINE_GAP}
            stroke="#475569" strokeWidth={0.8}
          />
        ))}

        {/* Notes / rests */}
        {noteItems.map(({ n, x, dur }, ni) => {
          if (n.type === 'rest') {
            return <RestSymbol key={n._id ?? ni} x={x} dur={dur} color={noteColor} />;
          }
          const midi = pitchToMidi(n.pitch);
          if (midi === null) {
            return (
              <text key={n._id ?? ni} x={x - 4} y={MIDDLE_LINE_Y + 4} fontSize={8} fill={errorColor}>?</text>
            );
          }
          const y = noteY(midi);
          const isWhole = dur >= 4;
          const isHalf = dur >= 2 && dur < 4;
          const filled = !isWhole && !isHalf;
          const stemUp = y >= MIDDLE_LINE_Y;
          const acc = getAccidental(n.pitch);
          const ledYs = ledgerLineYs(midi);
          const dotted = DOTTED_DURS.has(dur);
          const stemX = stemUp ? x + NOTE_RX : x - NOTE_RX;
          const stemY2 = stemUp ? y - STEM_LEN : y + STEM_LEN;

          return (
            <g key={n._id ?? ni}>
              {/* Ledger lines */}
              {ledYs.map((ly) => (
                <line key={ly} x1={x - NOTE_RX - 3} y1={ly} x2={x + NOTE_RX + 3} y2={ly}
                  stroke={noteColor} strokeWidth={0.8} />
              ))}

              {/* Accidental symbol */}
              {acc && (
                <text x={x - NOTE_RX - 2} y={y + 3} fontSize={8} fill={noteColor} textAnchor="end">
                  {acc === '#' ? '♯' : '♭'}
                </text>
              )}

              {/* Note head */}
              <ellipse cx={x} cy={y} rx={NOTE_RX} ry={NOTE_RY}
                fill={filled ? noteColor : 'none'}
                stroke={noteColor} strokeWidth={1}
              />

              {/* Dot for dotted durations */}
              {dotted && <circle cx={x + NOTE_RX + 3} cy={y - 1} r={1.5} fill={noteColor} />}

              {/* Stem */}
              {!isWhole && (
                <line x1={stemX} y1={y} x2={stemX} y2={stemY2}
                  stroke={noteColor} strokeWidth={1.2} />
              )}

              {/* Eighth flag */}
              {dur > 0.25 && dur <= 0.5 && (
                <path
                  d={stemUp
                    ? `M${stemX},${stemY2} q8,6 6,14`
                    : `M${stemX},${stemY2} q8,-6 6,-14`}
                  stroke={noteColor} strokeWidth={1.2} fill="none"
                />
              )}

              {/* Sixteenth: two flags */}
              {dur <= 0.25 && (
                <>
                  <path
                    d={stemUp
                      ? `M${stemX},${stemY2} q8,6 6,14`
                      : `M${stemX},${stemY2} q8,-6 6,-14`}
                    stroke={noteColor} strokeWidth={1.2} fill="none"
                  />
                  <path
                    d={stemUp
                      ? `M${stemX},${stemY2 + 6} q8,6 6,12`
                      : `M${stemX},${stemY2 - 6} q8,-6 6,-12`}
                    stroke={noteColor} strokeWidth={1.2} fill="none"
                  />
                </>
              )}
            </g>
          );
        })}

        {/* Chord labels */}
        {Object.entries(chordsByBeat).map(([beat, label]) => {
          const bx = CELL_LEFT + (parseIntOr(beat, 1) - 1) * BEAT_PX + BEAT_PX / 2;
          return (
            <text key={beat} x={bx} y={CHORD_TY} fontSize={8} fill="#94a3b8" textAnchor="middle">
              {label}
            </text>
          );
        })}

        {/* Beat mismatch indicator */}
        {beatsMismatch && (
          <text x={cellW - CELL_RIGHT} y={CELL_H - 4} fontSize={8} fill={errorColor} textAnchor="end">
            {totalBeats}/{timeSigBeats}
          </text>
        )}

        {/* Right barline */}
        <line
          x1={cellW - CELL_RIGHT + 4} y1={STAFF_TOP}
          x2={cellW - CELL_RIGHT + 4} y2={STAFF_TOP + LINE_GAP * 4}
          stroke="#475569" strokeWidth={1}
        />
      </svg>
    </button>
  );
}

MeasureNotation.propTypes = {
  measure: PropTypes.shape({
    notes: PropTypes.array.isRequired,
    chords: PropTypes.array.isRequired,
  }).isRequired,
  index: PropTypes.number.isRequired,
  timeSigBeats: PropTypes.number.isRequired,
  isSelected: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
};

// ── NoteRow ────────────────────────────────────────────────────────────────────

function NoteRow({ note, onChange, onRemove }) {
  function set(field, val) { onChange({ ...note, [field]: val }); }
  const midi = note.type === 'note' ? pitchToMidi(note.pitch) : null;
  const pitchValid = midi !== null;

  return (
    <div className="sb-note-row">
      <select value={note.type} onChange={(e) => set('type', e.target.value)} className="sb-small-select" title="Note or rest">
        <option value="note">note</option>
        <option value="rest">rest</option>
      </select>

      {note.type === 'note' && (
        <>
          <input
            value={note.pitch}
            onChange={(e) => set('pitch', e.target.value)}
            placeholder="C4"
            className={`sb-pitch-input sb-note-input${pitchValid ? '' : ' sb-input-error'}`}
            title="Pitch (e.g. C4, F#4, Bb3)"
          />
          <span className="sb-midi-hint" title="MIDI number">
            {pitchValid ? `m${midi}` : '—'}
          </span>
          <select value={note.degree} onChange={(e) => set('degree', e.target.value)} className="sb-small-select" title="Solfège degree">
            {DEGREES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </>
      )}

      <select
        value={note.durationBeats}
        onChange={(e) => set('durationBeats', e.target.value)}
        className="sb-small-select sb-dur-select"
        title="Duration"
      >
        {DURATION_OPTIONS.map((d) => (
          <option key={d.value} value={d.value}>{d.label}</option>
        ))}
      </select>

      <button type="button" className="sb-remove-btn" onClick={onRemove} title="Remove">×</button>
    </div>
  );
}

NoteRow.propTypes = {
  note: PropTypes.shape({
    type: PropTypes.string.isRequired,
    pitch: PropTypes.string,
    durationBeats: PropTypes.string.isRequired,
    degree: PropTypes.string,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};

// ── ChordRow ───────────────────────────────────────────────────────────────────

function ChordRow({ chord, onChange, onRemove }) {
  function set(field, val) { onChange({ ...chord, [field]: val }); }
  return (
    <div className="sb-chord-row">
      <span className="sb-inline-label">Beat</span>
      <input
        type="number" min="1" max="32"
        value={chord.beat}
        onChange={(e) => set('beat', e.target.value)}
        className="sb-beat-input sb-note-input"
        title="Beat number (1-indexed)"
      />
      <select value={chord.root} onChange={(e) => set('root', e.target.value)} className="sb-small-select" title="Root note">
        {NOTE_ROOTS.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <select value={chord.kind} onChange={(e) => set('kind', e.target.value)} className="sb-small-select" title="Chord quality">
        {CHORD_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
      <button type="button" className="sb-remove-btn" onClick={onRemove} title="Remove chord">×</button>
    </div>
  );
}

ChordRow.propTypes = {
  chord: PropTypes.shape({
    beat: PropTypes.string.isRequired,
    root: PropTypes.string.isRequired,
    kind: PropTypes.string.isRequired,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};

// ── MeasureEditor ─────────────────────────────────────────────────────────────

function MeasureEditor({ measure, index, total, timeSigBeats, onChange, onNavigate, onDuplicate, onRemove }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [dropIdx, setDropIdx] = useState(null);

  function updateNote(i, updated) { onChange({ ...measure, notes: measure.notes.map((n, ni) => ni === i ? updated : n) }); }
  function removeNote(i) { onChange({ ...measure, notes: measure.notes.filter((_, ni) => ni !== i) }); }
  function addNote() { onChange({ ...measure, notes: [...measure.notes, emptyNote()] }); }
  function addRest() { onChange({ ...measure, notes: [...measure.notes, emptyRest()] }); }

  function reorderNotes(from, to) {
    if (from === to) return;
    const notes = [...measure.notes];
    const [moved] = notes.splice(from, 1);
    notes.splice(to, 0, moved);
    onChange({ ...measure, notes });
  }

  function updateChord(i, updated) { onChange({ ...measure, chords: measure.chords.map((c, ci) => ci === i ? updated : c) }); }
  function removeChord(i) { onChange({ ...measure, chords: measure.chords.filter((_, ci) => ci !== i) }); }
  function addChord() { onChange({ ...measure, chords: [...measure.chords, emptyChord()] }); }

  const totalBeats = measureTotalBeats(measure);
  const beatsMismatch = Math.abs(totalBeats - timeSigBeats) > 0.001;

  return (
    <div className="sb-editor-panel card">
      <div className="sb-editor-header">
        <div className="sb-editor-title-group">
          <span className="sb-editor-title">Measure {index + 1}</span>
          <span className="sb-editor-of">of {total}</span>
          {beatsMismatch && (
            <span className="sb-beat-err-badge" title="Note durations don't sum to measure beats">
              {totalBeats} / {timeSigBeats} beats
            </span>
          )}
        </div>
        <div className="sb-editor-actions">
          <button
            type="button" className="button secondary sb-nav-btn"
            disabled={index === 0} onClick={() => onNavigate(-1)} title="Previous measure"
          >‹</button>
          <button
            type="button" className="button secondary sb-nav-btn"
            disabled={index === total - 1} onClick={() => onNavigate(1)} title="Next measure"
          >›</button>
          <button type="button" className="button secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={onDuplicate} title="Duplicate measure">⧉</button>
          <button type="button" className="sb-remove-btn" onClick={onRemove} disabled={total <= 1} title="Remove measure">×</button>
        </div>
      </div>

      <div className="sb-subsection">
        <div className="sb-subsection-header">
          <span className="sb-subsection-title">Notes</span>
          <button type="button" className="button secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={addNote}>+ Note</button>
          <button type="button" className="button secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={addRest}>+ Rest</button>
        </div>
        {measure.notes.length === 0
          ? <p className="sb-empty-hint">No notes yet.</p>
          : (
            <ul className="sb-notes-list">
              {measure.notes.map((n, ni) => (
                <li
                  key={n._id}
                  draggable
                  onDragStart={() => setDragIdx(ni)}
                  onDragOver={(e) => { e.preventDefault(); if (dropIdx !== ni) setDropIdx(ni); }}
                  onDrop={() => { reorderNotes(dragIdx, ni); setDragIdx(null); setDropIdx(null); }}
                  onDragEnd={() => { setDragIdx(null); setDropIdx(null); }}
                  className={[
                    'sb-note-drag-row',
                    dragIdx === ni ? 'sb-note-dragging' : '',
                    dropIdx === ni && dragIdx !== ni ? 'sb-note-drop-target' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <span className="sb-drag-handle" title="Drag to reorder">⠿</span>
                  <NoteRow note={n} onChange={(u) => updateNote(ni, u)} onRemove={() => removeNote(ni)} />
                </li>
              ))}
            </ul>
          )
        }
      </div>

      <div className="sb-subsection">
        <div className="sb-subsection-header">
          <span className="sb-subsection-title">Chords</span>
          <button type="button" className="button secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={addChord}>+ Chord</button>
        </div>
        {measure.chords.length === 0
          ? <p className="sb-empty-hint muted">No chords (optional).</p>
          : measure.chords.map((c, ci) => (
            <ChordRow key={c._id} chord={c} onChange={(u) => updateChord(ci, u)} onRemove={() => removeChord(ci)} />
          ))
        }
      </div>
    </div>
  );
}

MeasureEditor.propTypes = {
  measure: PropTypes.shape({
    notes: PropTypes.array.isRequired,
    chords: PropTypes.array.isRequired,
  }).isRequired,
  index: PropTypes.number.isRequired,
  total: PropTypes.number.isRequired,
  timeSigBeats: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
  onNavigate: PropTypes.func.isRequired,
  onDuplicate: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};

// ── Main Page ──────────────────────────────────────────────────────────────────

export function SongBuilderPage() {
  const songLessons = useMemo(() => lessons.filter(isSongLesson), []);
  const [meta, setMeta] = useState(emptyMeta);
  const [measures, setMeasures] = useState([emptyMeasure()]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const editorRef = useRef(null);
  const jsonAreaRef = useRef(null);

  // Clamp selectedIdx when measures array shrinks
  useEffect(() => {
    if (selectedIdx >= measures.length) {
      setSelectedIdx(Math.max(0, measures.length - 1));
    }
  }, [measures.length, selectedIdx]);

  function setMetaField(field) {
    return (e) => setMeta((prev) => ({ ...prev, [field]: e.target.value }));
  }

  function loadLesson(lesson) {
    const { meta: m, measures: ms } = lessonToState(lesson);
    setMeta(m);
    setMeasures(ms);
    setSelectedIdx(0);
    setCopied(false);
  }

  function addMeasure() {
    setMeasures((prev) => {
      setSelectedIdx(prev.length); // select the new measure (index = current length)
      return [...prev, emptyMeasure()];
    });
    setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }

  function duplicateMeasure(i) {
    setMeasures((prev) => {
      const src = prev[i];
      const copy = {
        ...src, _id: uid(),
        notes: src.notes.map((n) => ({ ...n, _id: uid() })),
        chords: src.chords.map((c) => ({ ...c, _id: uid() })),
      };
      const next = [...prev];
      next.splice(i + 1, 0, copy);
      return next;
    });
    setSelectedIdx(i + 1);
  }

  function selectMeasure(idx) {
    setSelectedIdx(idx);
    setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }

  function navigateMeasure(delta) {
    setSelectedIdx((prev) => Math.max(0, Math.min(measures.length - 1, prev + delta)));
  }

  function updateMeasure(i, updated) {
    setMeasures((prev) => prev.map((m, mi) => mi === i ? updated : m));
  }

  function removeMeasure(i) {
    if (measures.length <= 1) return;
    setMeasures((prev) => prev.filter((_, mi) => mi !== i));
  }

  const timeSigBeats = parseIntOr(meta.timeSigBeats, 4);
  const safeIdx = Math.min(selectedIdx, measures.length - 1);
  const selectedMeasure = measures[safeIdx];
  const jsonText = JSON.stringify(buildLesson(meta, measures), null, 2);

  function handleCopy() {
    navigator.clipboard.writeText(jsonText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  return (
    <div className="page-content sb-page">
      <h1>Song Builder</h1>
      <p className="sb-subtitle">
        Build measures in the score view, click one to edit it, then copy the JSON to{' '}
        <code>content/lessons/</code>.
      </p>

      <div className="sb-layout">
        {/* ── Sidebar: existing songs ── */}
        <aside className="sb-sidebar">
          <h3>Load Existing</h3>
          {songLessons.length === 0 ? (
            <p className="muted" style={{ fontSize: 12 }}>No song lessons found.</p>
          ) : (
            <ul className="sb-song-list">
              {songLessons.map((sl) => (
                <li key={sl.id}>
                  <button
                    type="button"
                    className={`sb-song-btn${meta.id === sl.id ? ' sb-song-btn--active' : ''}`}
                    onClick={() => loadLesson(sl)}
                    title={`Load "${sl.name}" into editor`}
                  >
                    {sl.name}
                    <span className="sb-song-meta">
                      {sl.measures?.length ?? '?'} bars · {sl.timeSig?.beats ?? 4}/{sl.timeSig?.beatType ?? 4}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* ── Main editor ── */}
        <section className="sb-main">

          {/* ─ Song Details (collapsible) ─ */}
          <div className="sb-section card">
            <button type="button" className="sb-collapsible-header" onClick={() => setDetailsOpen((v) => !v)}>
              <h3 className="sb-section-title" style={{ margin: 0 }}>Song Details</h3>
              <span className="sb-expand-chevron">{detailsOpen ? '▾' : '▸'}</span>
            </button>
            {detailsOpen && (
              <div className="sb-form-grid" style={{ marginTop: 12 }}>

                <label className="sb-field">
                  <span>ID</span>
                  <input value={meta.id} onChange={setMetaField('id')} placeholder="song_my_song" />
                </label>

                <label className="sb-field">
                  <span>Name</span>
                  <input value={meta.name} onChange={setMetaField('name')} placeholder="My Song" />
                </label>

                <label className="sb-field">
                  <span>Category</span>
                  <input value={meta.category} onChange={setMetaField('category')} placeholder="folk_songs" />
                </label>

                <label className="sb-field">
                  <span>Difficulty</span>
                  <select value={meta.difficulty} onChange={setMetaField('difficulty')}>
                    {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>

                <label className="sb-field">
                  <span>Tags (comma-separated)</span>
                  <input value={meta.tags} onChange={setMetaField('tags')} placeholder="folk, public_domain" />
                </label>

                <label className="sb-field">
                  <span>Default Key</span>
                  <select value={meta.defaultKey} onChange={setMetaField('defaultKey')}>
                    {KEY_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </label>

                <label className="sb-field">
                  <span>Allowed Keys (comma-separated)</span>
                  <input value={meta.allowedKeys} onChange={setMetaField('allowedKeys')} placeholder="C, D, F, G" />
                </label>

                <label className="sb-field">
                  <span>Default Tempo (BPM)</span>
                  <input type="number" min="30" max="240" value={meta.defaultTempoBpm} onChange={setMetaField('defaultTempoBpm')} />
                </label>

                <label className="sb-field">
                  <span>Tempo Range (min – max BPM)</span>
                  <div className="sb-range-pair">
                    <input type="number" min="30" max="240" value={meta.tempoMin} onChange={setMetaField('tempoMin')} placeholder="30" />
                    <span className="sb-range-dash">–</span>
                    <input type="number" min="30" max="240" value={meta.tempoMax} onChange={setMetaField('tempoMax')} placeholder="240" />
                  </div>
                </label>

                <label className="sb-field">
                  <span>Default Octave</span>
                  <select value={meta.defaultOctave} onChange={setMetaField('defaultOctave')}>
                    {[1, 2, 3, 4, 5, 6].map((o) => <option key={o} value={String(o)}>{o}</option>)}
                  </select>
                </label>

                <label className="sb-field">
                  <span>Allowed Octaves (comma-separated)</span>
                  <input value={meta.allowedOctaves} onChange={setMetaField('allowedOctaves')} placeholder="2, 3, 4, 5" />
                </label>

                <label className="sb-field">
                  <span>Time Signature</span>
                  <div className="sb-time-sig">
                    <select value={meta.timeSigBeats} onChange={setMetaField('timeSigBeats')}>
                      {[2, 3, 4, 6, 8, 12].map((b) => <option key={b} value={String(b)}>{b}</option>)}
                    </select>
                    <span className="sb-range-dash">/</span>
                    <select value={meta.timeSigBeatType} onChange={setMetaField('timeSigBeatType')}>
                      {BEAT_TYPES.map((b) => <option key={b} value={String(b)}>{b}</option>)}
                    </select>
                  </div>
                </label>

                <label className="sb-field">
                  <span>Default Chunk Size (optional)</span>
                  <input type="number" min="1" max="32" value={meta.defaultChunkSize} onChange={setMetaField('defaultChunkSize')} placeholder="e.g. 5" />
                </label>

                <label className="sb-field">
                  <span>Chunk Size Range (optional, min – max)</span>
                  <div className="sb-range-pair">
                    <input type="number" min="1" max="32" value={meta.chunkSizeMin} onChange={setMetaField('chunkSizeMin')} placeholder="3" />
                    <span className="sb-range-dash">–</span>
                    <input type="number" min="1" max="32" value={meta.chunkSizeMax} onChange={setMetaField('chunkSizeMax')} placeholder="8" />
                  </div>
                </label>

              </div>
            )}
          </div>

          {/* ─ Score view ─ */}
          <div className="sb-section card">
            <div className="sb-measures-header">
              <h3 className="sb-section-title" style={{ margin: 0 }}>
                Score <span className="sb-measure-count">({measures.length} measures)</span>
              </h3>
              <button type="button" className="button" onClick={addMeasure}>+ Add Measure</button>
            </div>
            <p className="sb-score-hint">Click a measure to select and edit it below.</p>
            <div className="sb-score-grid">
              {measures.map((m, i) => (
                <MeasureNotation
                  key={m._id}
                  measure={m}
                  index={i}
                  timeSigBeats={timeSigBeats}
                  isSelected={i === safeIdx}
                  onClick={() => selectMeasure(i)}
                />
              ))}
            </div>
          </div>

          {/* ─ Single-measure editor ─ */}
          <div ref={editorRef}>
            {selectedMeasure && (
              <MeasureEditor
                measure={selectedMeasure}
                index={safeIdx}
                total={measures.length}
                timeSigBeats={timeSigBeats}
                onChange={(updated) => updateMeasure(safeIdx, updated)}
                onNavigate={navigateMeasure}
                onDuplicate={() => duplicateMeasure(safeIdx)}
                onRemove={() => removeMeasure(safeIdx)}
              />
            )}
          </div>

          {/* ─ JSON Output ─ */}
          <div className="sb-section card">
            <div className="sb-json-header">
              <h3 className="sb-section-title" style={{ margin: 0 }}>JSON Output</h3>
              <button type="button" className="button" onClick={handleCopy}>
                {copied ? '✓ Copied!' : 'Copy JSON'}
              </button>
            </div>
            <p className="sb-json-hint">
              Copy this JSON and save it as a file in <code>content/lessons/</code>.
            </p>
            <textarea
              ref={jsonAreaRef}
              readOnly
              className="sb-json-output"
              value={jsonText}
              rows={22}
              onFocus={(e) => e.target.select()}
              spellCheck={false}
            />
          </div>

        </section>
      </div>
    </div>
  );
}
