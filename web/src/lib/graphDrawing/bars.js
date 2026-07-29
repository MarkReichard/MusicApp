import { colorForCentsOffset, toRgba, drawRoundedRect } from './canvas-helpers';
import { getBarCentsOffset } from './bars-logic';

// ── Bar coordinate mappers ─────────────────────────────────────────────────────

export function buildBarCoordinateMappers(width, height, minMidi, maxMidi, xStartSec, xEndSec) {
  const toX = (seconds) => ((seconds - xStartSec) / Math.max(0.001, (xEndSec - xStartSec))) * width;
  const toY = (midi) => {
    const ratio = (midi - minMidi) / Math.max(1, maxMidi - minMidi);
    return height - ratio * height;
  };
  return { toX, toY };
}

// ── Played bars drawing ────────────────────────────────────────────────────────

const PLAYED_BAR_HEIGHT = 10;

export function drawBars(context, bars, { toX, toY, xStartSec, xEndSec, fillStyle, strokeStyle }) {
  bars.forEach((bar) => {
    if (bar.endSec < xStartSec || bar.startSec > xEndSec) {
      return;
    }

    const x1 = toX(bar.startSec);
    const x2 = toX(bar.endSec);
    const y = toY(bar.midi);
    const h = PLAYED_BAR_HEIGHT;
    const y1 = y - h / 2;
    const w = Math.max(2, x2 - x1);

    context.fillStyle = fillStyle;
    context.strokeStyle = strokeStyle;
    drawRoundedRect(context, x1, y1, w, h, 5);
    context.fill();
    context.stroke();
  });
}

// ── Expected bars drawing ──────────────────────────────────────────────────────

const EXPECTED_BAR_HEIGHT = 14;

export function drawExpectedBars(context, bars, {
  toX,
  toY,
  xStartSec,
  xEndSec,
  nowSec,
  barResults,
  history,
  sessionStartMs,
}) {
  bars.forEach((bar) => {
    if (bar.endSec < xStartSec || bar.startSec > xEndSec) {
      return;
    }

    const x1 = toX(bar.startSec);
    const x2 = toX(bar.endSec);
    const y = toY(bar.midi);
    const h = EXPECTED_BAR_HEIGHT;
    const y1 = y - h / 2;
    const w = Math.max(2, x2 - x1);
    const result = barResults[bar.id];

    if (nowSec < bar.endSec || result === undefined) {
      context.fillStyle = 'rgba(148, 163, 184, 0.38)';
      context.strokeStyle = 'rgba(148, 163, 184, 0.70)';
    } else {
      const centsOffset = getBarCentsOffset({ bar, history, sessionStartMs });
      if (Number.isFinite(centsOffset)) {
        const rgb = colorForCentsOffset(centsOffset);
        context.fillStyle = toRgba(rgb, 0.8);
        context.strokeStyle = toRgba(rgb, 1);
      } else if (result) {
        context.fillStyle = 'rgba(22, 163, 74, 0.62)';
        context.strokeStyle = '#86efac';
      } else {
        context.fillStyle = 'rgba(220, 38, 38, 0.62)';
        context.strokeStyle = '#fca5a5';
      }

      if (result === false) {
        context.strokeStyle = '#ef4444';
      }
    }

    drawRoundedRect(context, x1, y1, w, h, 6);
    context.fill();
    context.stroke();
  });
}