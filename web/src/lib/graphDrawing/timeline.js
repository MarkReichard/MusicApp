import { drawBars, drawExpectedBars } from './bars';
import { drawPitchLine } from './pitch-line';
import { drawChordStrip } from './chords';
import { MIN_TIMELINE_SECONDS } from './constants';

const SING_START_LINE_COLOR = '#a78bfa';
const NOW_LINE_COLOR = '#f8fafc';

export function drawTimeline({
  context,
  width,
  height,
  minMidi,
  maxMidi,
  gridCanvas,
  nowSec,
  timelineEndSec,
  singStartSec,
  playedBars,
  expectedBars,
  barResults,
  history,
  sessionStartMs,
  chordMeasures,
  chordStartSec,
  chordBeatSec,
}) {
  context.clearRect(0, 0, width, height);

  if (gridCanvas) {
    context.drawImage(gridCanvas, 0, 0, width, height);
  } else {
    context.fillStyle = '#020617';
    context.fillRect(0, 0, width, height);
  }

  const xStartSec = 0;
  const xEndSec = Math.max(MIN_TIMELINE_SECONDS, timelineEndSec);

  const toX = (seconds) => ((seconds - xStartSec) / Math.max(0.001, (xEndSec - xStartSec))) * width;
  const toY = (midi) => {
    const ratio = (midi - minMidi) / Math.max(1, maxMidi - minMidi);
    return height - ratio * height;
  };

  drawBars(context, playedBars, {
    toX,
    toY,
    xStartSec,
    xEndSec,
    fillStyle: '#2563eb',
    strokeStyle: '#60a5fa',
  });

  drawExpectedBars(context, expectedBars, {
    toX,
    toY,
    xStartSec,
    xEndSec,
    nowSec,
    barResults,
    history,
    sessionStartMs,
  });

  drawPitchLine(context, history, {
    toX,
    toY,
    xStartSec,
    xEndSec,
    singStartSec,
    sessionStartMs,
  });

  if (Number.isFinite(singStartSec)) {
    const countdownX = toX(singStartSec);
    context.strokeStyle = SING_START_LINE_COLOR;
    context.lineWidth = 2;
    context.setLineDash([6, 6]);
    context.beginPath();
    context.moveTo(countdownX, 0);
    context.lineTo(countdownX, height);
    context.stroke();
    context.setLineDash([]);
  }

  if (chordMeasures?.length && chordBeatSec > 0) {
    drawChordStrip(context, chordMeasures, { toX, chordStartSec, chordBeatSec, nowSec, height });
  }

  const nowX = toX(nowSec);
  context.strokeStyle = NOW_LINE_COLOR;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(nowX, 0);
  context.lineTo(nowX, height);
  context.stroke();
}