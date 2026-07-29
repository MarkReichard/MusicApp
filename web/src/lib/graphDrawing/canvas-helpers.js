import { LOW_BLEND_CENTS, HIGH_BLEND_CENTS } from './constants';

// ── Time utilities ─────────────────────────────────────────────────────────────

export function getNowSec(sessionStartMs, stopScrollSec) {
  if (!Number.isFinite(sessionStartMs)) {
    return 0;
  }

  const elapsedSec = Math.max(0, (performance.now() - sessionStartMs) / 1000);
  if (!Number.isFinite(stopScrollSec)) {
    return elapsedSec;
  }

  return Math.min(elapsedSec, stopScrollSec);
}

// ── Grid drawing ───────────────────────────────────────────────────────────────

export function drawGrid(context, width, height, minMidi, maxMidi) {
  context.fillStyle = '#020617';
  context.fillRect(0, 0, width, height);
  const midiRange = Math.max(1, maxMidi - minMidi);
  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    const y = height - ((midi - minMidi) / midiRange) * height;
    context.strokeStyle = midi % 12 === 0 ? '#334155' : '#1e293b';
    context.lineWidth = midi % 12 === 0 ? 1.2 : 0.7;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}

// ── Rounded rectangle ──────────────────────────────────────────────────────────

export function drawRoundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

// ── Color utilities ────────────────────────────────────────────────────────────

export function colorForCentsOffset(centsOffset) {
  const lowClamped = Math.max(-LOW_BLEND_CENTS, Math.min(0, centsOffset));
  const highClamped = Math.max(0, Math.min(HIGH_BLEND_CENTS, centsOffset));
  const lowColor = { r: 239, g: 68, b: 68 };   // red
  const onColor = { r: 22, g: 163, b: 74 };    // deeper green
  const highColor = { r: 29, g: 78, b: 216 };  // stronger blue

  if (centsOffset <= 0) {
    const tLinear = (lowClamped + LOW_BLEND_CENTS) / LOW_BLEND_CENTS;
    const t = Math.pow(tLinear, 0.85);
    return mixRgb(lowColor, onColor, t);
  }

  const tLinear = highClamped / HIGH_BLEND_CENTS;
  const t = Math.pow(tLinear, 0.55);
  return mixRgb(onColor, highColor, t);
}

export function toRgba(rgb, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

function mixRgb(from, to, t) {
  const clampedT = Math.max(0, Math.min(1, t));
  const r = Math.round(from.r + (to.r - from.r) * clampedT);
  const g = Math.round(from.g + (to.g - from.g) * clampedT);
  const b = Math.round(from.b + (to.b - from.b) * clampedT);
  return { r, g, b };
}