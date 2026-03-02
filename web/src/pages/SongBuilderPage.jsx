/**
 * SongBuilderPage — browse song lessons measure-by-measure.
 *
 * Features:
 * - Lists all song lessons in a sidebar
 * - Shows measure grid with chord and note counts per measure
 * - Preview window selection to practice a custom range
 * - "Practice" button → /trainer/:id/sing
 */

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { lessons } from '../lib/lessons';
import { isSongLesson } from '../lib/lessonUtils';
import { ChordBar } from '../components/trainer/ChordBar';

const CHORD_KIND_SHORT = {
  major: '',
  'major-seventh': 'M7',
  minor: 'm',
  'minor-seventh': 'm7',
  dominant: '7',
  'dominant-seventh': '7',
  diminished: '°',
  augmented: '+',
  'suspended-fourth': 'sus4',
  'suspended-second': 'sus2',
};

function chordShort(chord) {
  if (!chord) return null;
  const suffix = CHORD_KIND_SHORT[chord.kind] ?? '';
  return `${chord.root}${suffix}`;
}

function dominantChord(chords) {
  if (!chords?.length) return null;
  return chords.find((c) => c.beat === 1) ?? chords[0];
}

// ── Measure grid ───────────────────────────────────────────────────────────────

function MeasureCell({ measure, index, isSelected, onToggle }) {
  const chord = dominantChord(measure.chords);
  const hasMulti = (measure.chords?.length ?? 0) > 1;

  return (
    <button
      type="button"
      onClick={() => onToggle(index)}
      className={`sb-measure-cell${isSelected ? ' sb-measure-cell--selected' : ''}${!chord ? ' sb-measure-cell--no-chord' : ''}`}
      title={`Measure ${measure.index + 1} · ${measure.notes?.length ?? 0} notes`}
      aria-pressed={isSelected}
    >
      <span className="sb-measure-num">{measure.index + 1}</span>
      <span className="sb-measure-chord">
        {chord ? chordShort(chord) : '—'}
        {hasMulti && <span className="sb-measure-multi" title="Multiple chord changes">*</span>}
      </span>
      <span className="sb-measure-notes">{measure.notes?.length ?? 0}♩</span>
    </button>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function SongBuilderPage() {
  const songLessons = useMemo(() => lessons.filter(isSongLesson), []);
  const [selectedLesson, setSelectedLesson] = useState(() => songLessons[0] ?? null);
  const [selStart, setSelStart] = useState(null);   // 0-based in measures[]
  const [selEnd, setSelEnd] = useState(null);

  const measures = selectedLesson?.measures ?? [];
  const timeSig = selectedLesson?.timeSig;

  function handleSelectLesson(lesson) {
    setSelectedLesson(lesson);
    setSelStart(null);
    setSelEnd(null);
  }

  function handleToggleCell(index) {
    if (selStart === null) {
      setSelStart(index);
      setSelEnd(index);
      return;
    }
    if (selStart === index && selEnd === index) {
      // Deselect
      setSelStart(null);
      setSelEnd(null);
      return;
    }
    // Extend range
    const lo = Math.min(selStart, index);
    const hi = Math.max(selEnd ?? selStart, index);
    setSelStart(lo);
    setSelEnd(hi);
  }

  const selectedMeasures = selStart !== null && selEnd !== null
    ? measures.slice(selStart, selEnd + 1)
    : [];

  const hasChordsInSong = measures.some((m) => m.chords?.length > 0);
  const hasChordsInSelection = selectedMeasures.some((m) => m.chords?.length > 0);

  return (
    <div className="page-content sb-page">
      <h1>Song Builder</h1>
      <p className="sb-subtitle">Browse song measures, inspect chords, and open a window in the sing trainer.</p>

      <div className="sb-layout">
        {/* ── Song list ── */}
        <aside className="sb-sidebar">
          <h3>Songs</h3>
          {songLessons.length === 0 ? (
            <p className="muted">No song lessons found.</p>
          ) : (
            <ul className="sb-song-list">
              {songLessons.map((lesson) => (
                <li key={lesson.id}>
                  <button
                    type="button"
                    className={`sb-song-btn${selectedLesson?.id === lesson.id ? ' sb-song-btn--active' : ''}`}
                    onClick={() => handleSelectLesson(lesson)}
                  >
                    {lesson.name}
                    <span className="sb-song-meta">
                      {lesson.measures.length} bars · {lesson.timeSig?.beats ?? 4}/{lesson.timeSig?.beatType ?? 4}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* ── Main panel ── */}
        <section className="sb-main">
          {!selectedLesson ? (
            <p className="muted">Select a song to see its measures.</p>
          ) : (
            <>
              <div className="sb-song-header">
                <div>
                  <h2>{selectedLesson.name}</h2>
                  <p className="muted">
                    {measures.length} measures ·{' '}
                    {timeSig ? `${timeSig.beats}/${timeSig.beatType}` : 'unknown time sig'} ·{' '}
                    {hasChordsInSong ? 'has chords' : 'no chord data'}
                  </p>
                </div>
                <Link
                  className="button"
                  to={`/trainer/${selectedLesson.id}/sing`}
                  title="Practice full song in sing trainer"
                >
                  ▶ Practice All
                </Link>
              </div>

              {/* Measure grid */}
              <div className="sb-measure-grid">
                {measures.map((m, i) => (
                  <MeasureCell
                    key={m.index ?? i}
                    measure={m}
                    index={i}
                    isSelected={selStart !== null && selEnd !== null && i >= selStart && i <= selEnd}
                    onToggle={handleToggleCell}
                  />
                ))}
              </div>

              {selStart !== null && (
                <p className="sb-range-hint">
                  Click measures to select a range · Selected: measures {measures[selStart]?.index + 1}–{measures[selEnd]?.index + 1}
                  {' '}({selectedMeasures.length} bars)
                  {' '}
                  <button
                    type="button"
                    className="button-link"
                    onClick={() => { setSelStart(null); setSelEnd(null); }}
                  >
                    Clear
                  </button>
                </p>
              )}

              {/* Chord bar for selection */}
              {selectedMeasures.length > 0 && hasChordsInSelection && (
                <div className="sb-chord-preview">
                  <h4>Chord Preview</h4>
                  <ChordBar measures={selectedMeasures} />
                </div>
              )}

              {/* Notes preview for selection */}
              {selectedMeasures.length > 0 && (
                <div className="sb-selection-actions">
                  <Link
                    className="button"
                    to={`/trainer/${selectedLesson.id}/sing`}
                    title="Open full song in sing trainer — navigate to your selection there"
                  >
                    ▶ Practice in Trainer
                  </Link>
                  <span className="muted" style={{ fontSize: 13 }}>
                    Tip: use the Window size control in the trainer to match your selection.
                  </span>
                </div>
              )}

              {/* Measure detail table */}
              {selectedMeasures.length > 0 && (
                <div className="sb-measure-detail">
                  <h4>Measure Detail</h4>
                  <table className="sb-detail-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Beats</th>
                        <th>Chords</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedMeasures.map((m) => (
                        <tr key={m.index}>
                          <td>{m.index + 1}</td>
                          <td>{m.beats}</td>
                          <td>
                            {m.chords?.length
                              ? m.chords.map((c) => `b${c.beat}:${chordShort(c)}`).join(', ')
                              : <span className="muted">—</span>
                            }
                          </td>
                          <td>{m.notes?.length ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
