import { CHORD_STRIP_H } from './constants';

// ── Chord label helpers ────────────────────────────────────────────────────────

const CHORD_KIND_SUFFIX = {
  major: '', 'major-seventh': 'M7', 'major-sixth': '6',
  minor: 'm', 'minor-seventh': 'm7', 'minor-sixth': 'm6',
  dominant: '7', 'dominant-seventh': '7', 'dominant-ninth': '9',
  diminished: '°', 'diminished-seventh': '°7', 'half-diminished': 'ø7',
  augmented: '+', 'suspended-fourth': 'sus4', 'suspended-second': 'sus2', power: '5',
};

export function chordLabelFor(chord) {
  if (!chord) return '';
  const suffix = CHORD_KIND_SUFFIX[chord.kind] ?? (chord.kind ? `(${chord.kind})` : '');
  return `${chord.root}${suffix}`;
}

// ── Chord strip drawing ────────────────────────────────────────────────────────

const ACTIVE_BG = 'rgba(30, 58, 95, 0.90)';
const INACTIVE_BG = 'rgba(15, 23, 42, 0.82)';
const ACTIVE_BORDER = '#3b82f6';
const INACTIVE_BORDER = '#1e293b';
const ACTIVE_TEXT = '#93c5fd';
const INACTIVE_TEXT = '#94a3b8';

export function drawChordStrip(context, measures, { toX, chordStartSec, chordBeatSec, nowSec, height }) {
  const stripY = height - CHORD_STRIP_H;
  let t = chordStartSec;

  for (const measure of measures) {
    const beats = measure.beats ?? 4;
    const dur = beats * chordBeatSec;
    const x1 = toX(t);
    const x2 = toX(t + dur);
    const w = x2 - x1;
    const isActive = nowSec >= t && nowSec < t + dur;

    // Background
    context.fillStyle = isActive ? ACTIVE_BG : INACTIVE_BG;
    context.fillRect(x1, stripY, w, CHORD_STRIP_H);

    // Border
    context.strokeStyle = isActive ? ACTIVE_BORDER : INACTIVE_BORDER;
    context.lineWidth = 1;
    context.strokeRect(x1 + 0.5, stripY + 0.5, w - 1, CHORD_STRIP_H - 1);

    // Chord label — build from chord changes in this measure
    const chords = measure.chords ?? [];
    const labels = [];
    for (let b = 1; b <= beats; b++) {
      const c = chords.find((ch) => ch.beat === b);
      if (c) labels.push(chordLabelFor(c));
    }
    const label = labels.join(' / ') || '—';

    context.fillStyle = isActive ? ACTIVE_TEXT : INACTIVE_TEXT;
    context.font = `${Math.min(12, Math.max(9, w / 5))}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    // Clip to cell so long labels don't overflow
    context.save();
    context.beginPath();
    context.rect(x1 + 2, stripY, w - 4, CHORD_STRIP_H);
    context.clip();
    context.fillText(label, x1 + w / 2, stripY + CHORD_STRIP_H / 2);
    context.restore();

    t += dur;
  }
}