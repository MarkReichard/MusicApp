import {
  MAX_DRAW_JUMP_SEMITONES,
  MAX_DRAW_GAP_SEC,
  MAX_DRAW_GAP_HIGH_ENERGY_SEC,
  HIGH_ENERGY_DB_THRESHOLD,
} from './constants';

const PITCH_LINE_COLOR = '#22d3ee';
const PITCH_LINE_WIDTH = 4;

/** Returns the gap limit threshold for a history entry based on energy level. */
function getGapLimit(isHighEnergy) {
  return isHighEnergy ? MAX_DRAW_GAP_HIGH_ENERGY_SEC : MAX_DRAW_GAP_SEC;
}

/** Checks if a silent entry should break the pitch line. */
function shouldBreakGap(timeSec, lastVoicedSec, entryDb) {
  if (lastVoicedSec === null) {
    return false;
  }
  const isHighEnergy = Number.isFinite(entryDb) && entryDb >= HIGH_ENERGY_DB_THRESHOLD;
  const gapLimit = getGapLimit(isHighEnergy);
  return (timeSec - lastVoicedSec) > gapLimit;
}

/** Checks if a MIDI jump is too large to continue the line smoothly. */
function isJumpTooLarge(previousMidi, currentMidi) {
  return Number.isFinite(previousMidi) && Math.abs(currentMidi - previousMidi) > MAX_DRAW_JUMP_SEMITONES;
}

export function drawPitchLine(context, history, {
  toX,
  toY,
  xStartSec,
  xEndSec,
  singStartSec,
  sessionStartMs,
}) {
  if (!Number.isFinite(sessionStartMs) || !Number.isFinite(singStartSec)) {
    return;
  }

  context.strokeStyle = PITCH_LINE_COLOR;
  context.lineWidth = PITCH_LINE_WIDTH;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.beginPath();

  let needsMove = true;
  let previousMidi = null;
  let lastVoicedSec = null;
  let hasPoint = false;

  for (const entry of history) {
    if (!Number.isFinite(entry.timeMs)) {
      continue;
    }

    const timeSec = (entry.timeMs - sessionStartMs) / 1000;
    if (timeSec < singStartSec || timeSec < xStartSec || timeSec > xEndSec) {
      continue;
    }

    if (!Number.isFinite(entry.midi)) {
      if (shouldBreakGap(timeSec, lastVoicedSec, entry.db)) {
        needsMove = true;
        previousMidi = null;
      }
      continue;
    }

    if (isJumpTooLarge(previousMidi, entry.midi)) {
      needsMove = true;
    }

    const x = toX(timeSec);
    const y = toY(entry.midi);

    if (needsMove) {
      context.moveTo(x, y);
      needsMove = false;
    } else {
      context.lineTo(x, y);
    }

    hasPoint = true;
    previousMidi = entry.midi;
    lastVoicedSec = timeSec;
  }

  if (hasPoint) {
    context.stroke();
  }
}