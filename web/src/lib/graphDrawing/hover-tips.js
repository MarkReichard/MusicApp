import { getBarCentsOffset } from './bars-logic';
import { DIRECTION_TOOLTIP_EPSILON_CENTS } from './constants';

const FALLBACK_REASON = 'Pitch did not match the target note';
const EXPECTED_BAR_HEIGHT_PX = 14;

/** Checks if a canvas position falls within a bar's time window. */
function isWithinTimeWindow(x, barLeftPx, barRightPx) {
  return x >= barLeftPx && x <= barRightPx;
}

/** Checks if a canvas position falls within a bar's pitch window. */
function isWithinPitchWindow(y, barTopPx, barBottomPx) {
  return y >= barTopPx && y <= barBottomPx;
}

/** Formats a "too low" tooltip message. */
function formatTooLowTooltip(roundedOffset) {
  return `Too low (${roundedOffset} cents flat)`;
}

/** Formats a "too high" tooltip message. */
function formatTooHighTooltip(roundedOffset) {
  return `Too high (${roundedOffset} cents sharp)`;
}

/** Determines the tooltip for a cents offset value. Returns null if within tolerance. */
function tooltipForCentsOffset(centsOffset, toleranceCents) {
  const effectiveTolerance = Math.max(DIRECTION_TOOLTIP_EPSILON_CENTS, Number(toleranceCents) || 0);
  if (centsOffset <= -effectiveTolerance) {
    const roundedOffset = Math.abs(Math.round(centsOffset));
    return formatTooLowTooltip(roundedOffset);
  }
  if (centsOffset >= effectiveTolerance) {
    const roundedOffset = Math.abs(Math.round(centsOffset));
    return formatTooHighTooltip(roundedOffset);
  }
  return null;
}

/** Processes a single missed bar to check if the cursor is inside it and returns a reason. */
function checkMissedBar(expectedBar, x, y, minMidi, canvasWidth, canvasHeight, midiSpan, safeTimelineDurationSec, toleranceCents, history, sessionStartMs, barMissReasons) {
  // Convert expected bar timing to canvas x-bounds.
  const barLeftPx = (expectedBar.startSec / safeTimelineDurationSec) * canvasWidth;
  const barRightPx = (expectedBar.endSec / safeTimelineDurationSec) * canvasWidth;

  // Convert expected bar pitch to canvas y-bounds.
  const pitchRatio = (expectedBar.midi - minMidi) / midiSpan;
  const barCenterYPx = canvasHeight - pitchRatio * canvasHeight;
  const barTopPx = barCenterYPx - EXPECTED_BAR_HEIGHT_PX / 2;
  const barBottomPx = barCenterYPx + EXPECTED_BAR_HEIGHT_PX / 2;

  if (!isWithinTimeWindow(x, barLeftPx, barRightPx)) {
    return null;
  }
  if (!isWithinPitchWindow(y, barTopPx, barBottomPx)) {
    return null;
  }

  const centsOffset = getBarCentsOffset({
    bar: expectedBar,
    history,
    sessionStartMs,
  });

  if (Number.isFinite(centsOffset)) {
    const directionTooltip = tooltipForCentsOffset(centsOffset, toleranceCents);
    if (directionTooltip) {
      return directionTooltip;
    }
  }

  return barMissReasons[expectedBar.id] || FALLBACK_REASON;
}

export function getMissReasonAtPosition({
  x,
  y,
  canvasWidth,
  canvasHeight,
  toleranceCents,
  expectedBars,
  barResults,
  barMissReasons,
  history,
  sessionStartMs,
  minMidi,
  maxMidi,
  timelineEndSec,
}) {
  const timelineDurationSec = Math.max(12, timelineEndSec);
  const safeTimelineDurationSec = Math.max(0.001, timelineDurationSec);
  const midiSpan = Math.max(1, maxMidi - minMidi);

  for (const expectedBar of expectedBars) {
    if (barResults[expectedBar.id] !== false) {
      continue;
    }

    const reason = checkMissedBar(
      expectedBar,
      x,
      y,
      minMidi,
      canvasWidth,
      canvasHeight,
      midiSpan,
      safeTimelineDurationSec,
      toleranceCents,
      history,
      sessionStartMs,
      barMissReasons,
    );

    if (reason) {
      return reason;
    }
  }

  return null;
}