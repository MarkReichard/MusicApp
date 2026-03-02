/**
 * SongBuilderPage — build song lesson JSON via the UI.
 *
 * Workflow:
 *  1. Fill in song details (metadata).
 *  2. Add measures; within each measure add notes and optional chords.
 *  3. Copy the generated JSON and save it to content/lessons/ as a .json file.
 *
 * Existing song lessons are listed in the sidebar so they can be loaded into
 * the editor for review or as a starting-point for a new song.
 *
 * NOTE: This page never writes files. It outputs a JSON string that an admin
 * copies manually.
 */

import React, { useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { lessons } from '../lib/lessons';
import { isSongLesson } from '../lib/lessonUtils';
import { KEY_TO_SEMITONE } from '../lib/musicTheory';

// ── Constants ──────────────────────────────────────────────────────────────────

const DEGREES = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti'];
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
const BEAT_TYPES = [2, 4, 8, 16];
const MEASURE_BEATS_OPTIONS = [2, 3, 4, 6, 8, 12];

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

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Parse a pitch string like "E4", "C#4", "Bb3" to a MIDI number. Returns null on failure. */
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

let _uidCounter = 0;
function uid() { return `_${++_uidCounter}`; }

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
  return { _id: uid(), beats: '4', notes: [emptyNote()], chords: [] };
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
      beats: parseIntOr(meta.timeSigBeats, 4),
      beatType: parseIntOr(meta.timeSigBeatType, 4),
    },
    measures: measures.map((m, i) => ({
      index: i,
      beats: parseIntOr(m.beats, 4),
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
  const measures = (lesson.measures ?? []).map((m) => ({
    _id: uid(),
    beats: String(m.beats ?? 4),
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
          <span className="sb-midi-hint" title="Computed MIDI number">
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
        title="Duration in beats"
      >
        {DURATION_OPTIONS.map((d) => (
          <option key={d.value} value={d.value}>{d.label}</option>
        ))}
      </select>

      <button type="button" className="sb-remove-btn" onClick={onRemove} title="Remove note">×</button>
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

// ── MeasureCard ────────────────────────────────────────────────────────────────

function MeasureCard({ measure, index, onChange, onRemove, onDuplicate }) {
  const [expanded, setExpanded] = useState(true);

  function updateNote(i, updated) { onChange({ ...measure, notes: measure.notes.map((n, ni) => (ni === i ? updated : n)) }); }
  function removeNote(i) { onChange({ ...measure, notes: measure.notes.filter((_, ni) => ni !== i) }); }
  function addNote() { onChange({ ...measure, notes: [...measure.notes, emptyNote()] }); }
  function addRest() { onChange({ ...measure, notes: [...measure.notes, emptyRest()] }); }

  function updateChord(i, updated) { onChange({ ...measure, chords: measure.chords.map((c, ci) => (ci === i ? updated : c)) }); }
  function removeChord(i) { onChange({ ...measure, chords: measure.chords.filter((_, ci) => ci !== i) }); }
  function addChord() { onChange({ ...measure, chords: [...measure.chords, emptyChord()] }); }

  const totalBeats = measure.notes.reduce((s, n) => s + parseFloatOr(n.durationBeats, 0), 0);
  const expectedBeats = parseIntOr(measure.beats, 4);
  const beatsMismatch = Math.abs(totalBeats - expectedBeats) > 0.001;

  return (
    <div className="sb-measure-card">
      <div className="sb-measure-header">
        <button
          type="button" className="sb-expand-btn"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <span className="sb-measure-label">Measure {index + 1}</span>

        <div className="sb-measure-header-fields">
          <span className="sb-inline-label">Beats</span>
          <select value={measure.beats} onChange={(e) => onChange({ ...measure, beats: e.target.value })} className="sb-small-select">
            {MEASURE_BEATS_OPTIONS.map((b) => <option key={b} value={String(b)}>{b}</option>)}
          </select>
        </div>

        <span className={`sb-beat-tally${beatsMismatch ? ' sb-beat-mismatch' : ''}`} title="Total note durations vs expected measure beats">
          {totalBeats}/{expectedBeats}
        </span>

        <div className="sb-measure-actions-right">
          <button type="button" className="button secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={onDuplicate} title="Duplicate measure">⧉</button>
          <button type="button" className="sb-remove-btn" onClick={onRemove} title="Remove measure">×</button>
        </div>
      </div>

      {expanded && (
        <div className="sb-measure-body">
          <div className="sb-subsection">
            <div className="sb-subsection-header">
              <span className="sb-subsection-title">Notes</span>
              <button type="button" className="button secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={addNote}>+ Note</button>
              <button type="button" className="button secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={addRest}>+ Rest</button>
            </div>
            {measure.notes.length === 0
              ? <p className="sb-empty-hint">No notes yet.</p>
              : measure.notes.map((n, ni) => (
                <NoteRow key={n._id} note={n} onChange={(u) => updateNote(ni, u)} onRemove={() => removeNote(ni)} />
              ))
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
      )}
    </div>
  );
}

MeasureCard.propTypes = {
  measure: PropTypes.shape({
    beats: PropTypes.string.isRequired,
    notes: PropTypes.array.isRequired,
    chords: PropTypes.array.isRequired,
  }).isRequired,
  index: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  onDuplicate: PropTypes.func.isRequired,
};

// ── Main Page ──────────────────────────────────────────────────────────────────

export function SongBuilderPage() {
  const songLessons = useMemo(() => lessons.filter(isSongLesson), []);
  const [meta, setMeta] = useState(emptyMeta);
  const [measures, setMeasures] = useState([emptyMeasure()]);
  const [copied, setCopied] = useState(false);
  const jsonAreaRef = useRef(null);

  function setMetaField(field) {
    return (e) => setMeta((prev) => ({ ...prev, [field]: e.target.value }));
  }

  function loadLesson(lesson) {
    const { meta: m, measures: ms } = lessonToState(lesson);
    setMeta(m);
    setMeasures(ms);
    setCopied(false);
  }

  function addMeasure() { setMeasures((prev) => [...prev, emptyMeasure()]); }

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
  }

  function updateMeasure(i, updated) {
    setMeasures((prev) => prev.map((m, mi) => (mi === i ? updated : m)));
  }

  function removeMeasure(i) {
    setMeasures((prev) => (prev.length > 1 ? prev.filter((_, mi) => mi !== i) : prev));
  }

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
        Enter song details and build measures note-by-note. Copy the JSON output and save it to{' '}
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

          {/* ─ Song Details ─ */}
          <div className="sb-section card">
            <h3 className="sb-section-title">Song Details</h3>
            <div className="sb-form-grid">

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
          </div>

          {/* ─ Measures ─ */}
          <div className="sb-section">
            <div className="sb-measures-header">
              <h3 className="sb-section-title" style={{ margin: 0 }}>
                Measures <span className="sb-measure-count">({measures.length})</span>
              </h3>
              <button type="button" className="button" onClick={addMeasure}>+ Add Measure</button>
            </div>

            {measures.map((m, i) => (
              <MeasureCard
                key={m._id}
                measure={m}
                index={i}
                onChange={(updated) => updateMeasure(i, updated)}
                onRemove={() => removeMeasure(i)}
                onDuplicate={() => duplicateMeasure(i)}
              />
            ))}
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
              Copy this JSON and save it as a file in <code>content/lessons/</code>, then re-run{' '}
              <code>npm run web:dev</code> to pick up the new lesson.
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
