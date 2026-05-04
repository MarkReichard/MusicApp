import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { frequencyToMidi } from '../../lib/musicTheory';

const MIN_TIMELINE_SECONDS = 12;
const TIMELINE_RIGHT_PAD_SECONDS = 1;
export const GRAPH_PIXELS_PER_SECOND = 90;
const PIXELS_PER_SECOND = GRAPH_PIXELS_PER_SECOND;
const CHORD_STRIP_H = 22; // canvas pixels reserved at bottom for chord labels
const FOLLOW_CURSOR_RATIO = 0.35;
const TARGET_FRAME_MS = 33;
const SCROLL_SMOOTHING_FACTOR = 0.18;
const MAX_DRAW_JUMP_SEMITONES = 5;
const MAX_DRAW_GAP_SEC = 0.32;
const MAX_DRAW_GAP_HIGH_ENERGY_SEC = 0.9;
const HIGH_ENERGY_DB_THRESHOLD = -55;
const LOW_BLEND_CENTS = 70;
const HIGH_BLEND_CENTS = 40;

export function SingInputGraphV2({
  minFrequencyHz = 55,
  maxFrequencyHz = 1200,
  history = [],
  sessionStartMs,
  singStartSec,
  stopScrollSec,
  playedBars = [],
  expectedBars = [],
  barResults = {},
  barMissReasons = {},
  chordMeasures = null,
  chordStartSec = 0,
  chordBeatSec = 0,
}) {
  const canvasRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const frozenStateRef = useRef(null);
  const desiredScrollLeftRef = useRef(0);
  const [timelineEndSec, setTimelineEndSec] = useState(MIN_TIMELINE_SECONDS);
  const [contentWidthPx, setContentWidthPx] = useState(1200);
  const [hoverTip, setHoverTip] = useState(null);
  const latestRef = useRef({
    history,
    sessionStartMs,
    singStartSec,
    stopScrollSec,
    playedBars,
    expectedBars,
    barResults,
    chordMeasures,
    chordStartSec,
    chordBeatSec,
  });

  latestRef.current = {
    history,
    sessionStartMs,
    singStartSec,
    stopScrollSec,
    playedBars,
    expectedBars,
    barResults,
    chordMeasures,
    chordStartSec,
    chordBeatSec,
  };

  useEffect(() => {
    frozenStateRef.current = null;
    desiredScrollLeftRef.current = 0;
    setTimelineEndSec(MIN_TIMELINE_SECONDS);
    setHoverTip(null);
  }, [sessionStartMs]);

  useEffect(() => {
    const timerId = globalThis.setInterval(() => {
      const latest = latestRef.current;
      const nowSec = getNowSec(latest.sessionStartMs, latest.stopScrollSec);
      const barMax = Math.max(
        0,
        ...latest.playedBars.map((bar) => bar.endSec ?? 0),
        ...latest.expectedBars.map((bar) => bar.endSec ?? 0),
      );
      const nextTimelineEnd = Math.max(MIN_TIMELINE_SECONDS, nowSec + TIMELINE_RIGHT_PAD_SECONDS, barMax + TIMELINE_RIGHT_PAD_SECONDS);
      setTimelineEndSec((previous) => (Math.abs(previous - nextTimelineEnd) < 0.001 ? previous : nextTimelineEnd));

      const scroller = scrollContainerRef.current;
      const lessonDone = Number.isFinite(latest.stopScrollSec) && nowSec >= latest.stopScrollSec;
      if (scroller && Number.isFinite(latest.sessionStartMs) && !lessonDone) {
        const timelineWidthPx = Math.max(1200, Math.ceil(nextTimelineEnd * PIXELS_PER_SECOND));
        const nowX = (nowSec / Math.max(0.001, nextTimelineEnd)) * timelineWidthPx;
        const targetScrollLeft = nowX - scroller.clientWidth * FOLLOW_CURSOR_RATIO;
        const clampedScrollLeft = Math.max(0, Math.min(targetScrollLeft, Math.max(0, timelineWidthPx - scroller.clientWidth)));
        desiredScrollLeftRef.current = clampedScrollLeft;
      }
    }, 120);

    return () => globalThis.clearInterval(timerId);
  }, []);

  useEffect(() => {
    const targetWidth = Math.max(1200, Math.ceil(timelineEndSec * PIXELS_PER_SECOND));
    setContentWidthPx((previous) => (previous === targetWidth ? previous : targetWidth));
  }, [timelineEndSec]);

  const { minMidi, maxMidi } = useMemo(() => {
    const minFromSettings = frequencyToMidi(minFrequencyHz);
    const maxFromSettings = frequencyToMidi(maxFrequencyHz);
    const minFallback = 48; // C3
    const maxFallback = 84; // C6
    return {
      minMidi: Math.floor((minFromSettings ?? minFallback) - 1),
      maxMidi: Math.ceil((maxFromSettings ?? maxFallback) + 1),
    };
  }, [maxFrequencyHz, minFrequencyHz]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }

    let frameId = 0;
    let lastWidth = 0;
    let lastHeight = 0;
    let lastDpr = 0;
    let lastRenderTime = 0;
    let gridCanvas = null;

    const renderFrame = (timestamp) => {
      if (timestamp - lastRenderTime < TARGET_FRAME_MS) {
        frameId = requestAnimationFrame(renderFrame);
        return;
      }
      lastRenderTime = timestamp;

      const dpr = globalThis.devicePixelRatio || 1;
      const rectWidth = canvas.clientWidth;
      const rectHeight = canvas.clientHeight;

      if (rectWidth !== lastWidth || rectHeight !== lastHeight || dpr !== lastDpr) {
        lastWidth = rectWidth;
        lastHeight = rectHeight;
        lastDpr = dpr;
        canvas.width = Math.max(1, Math.floor(rectWidth * dpr));
        canvas.height = Math.max(1, Math.floor(rectHeight * dpr));
        context.setTransform(dpr, 0, 0, dpr, 0, 0);

        const offscreen = document.createElement('canvas');
        offscreen.width = canvas.width;
        offscreen.height = canvas.height;
        const gc = offscreen.getContext('2d');
        gc.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawGrid(gc, rectWidth, rectHeight, minMidi, maxMidi);
        gridCanvas = offscreen;
      }

      const latest = latestRef.current;
      const liveNowSec = getNowSec(latest.sessionStartMs, latest.stopScrollSec);

      if (!frozenStateRef.current && Number.isFinite(latest.stopScrollSec) && liveNowSec >= latest.stopScrollSec) {
        frozenStateRef.current = {
          nowSec: latest.stopScrollSec,
          history: latest.history.slice(),
          barResults: { ...latest.barResults },
        };
      }

      const frozen = frozenStateRef.current;
      const nowSec = frozen ? frozen.nowSec : liveNowSec;
      const renderHistory = frozen ? frozen.history : latest.history;
      const renderBarResults = frozen ? frozen.barResults : latest.barResults;

      drawTimeline({
        context,
        width: rectWidth,
        height: rectHeight,
        minMidi,
        maxMidi,
        gridCanvas,
        nowSec,
        timelineEndSec,
        singStartSec: latest.singStartSec,
        playedBars: latest.playedBars,
        expectedBars: latest.expectedBars,
        barResults: renderBarResults,
        history: renderHistory,
        sessionStartMs: latest.sessionStartMs,
        chordMeasures: latest.chordMeasures,
        chordStartSec: latest.chordStartSec,
        chordBeatSec: latest.chordBeatSec,
      });

      const scroller = scrollContainerRef.current;
      if (scroller && Number.isFinite(latest.sessionStartMs)) {
        const sessionDone = Number.isFinite(latest.stopScrollSec) && liveNowSec >= latest.stopScrollSec;
        if (sessionDone) {
          // Lesson is over — release auto-scroll so the user can freely scroll.
          // Keep the ref in sync with actual position so no jump if they resume.
          desiredScrollLeftRef.current = scroller.scrollLeft;
        } else {
          const currentScrollLeft = scroller.scrollLeft;
          const targetScrollLeft = desiredScrollLeftRef.current;
          const delta = targetScrollLeft - currentScrollLeft;
          if (Math.abs(delta) > 0.1) {
            scroller.scrollLeft = currentScrollLeft + delta * SCROLL_SMOOTHING_FACTOR;
          } else {
            scroller.scrollLeft = targetScrollLeft;
          }
        }
      }

      const hasActiveSession = Number.isFinite(latest.sessionStartMs);
      if (!hasActiveSession) {
        frameId = 0;
        return;
      }

      frameId = requestAnimationFrame(renderFrame);
    };

    frameId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(frameId);
  }, [maxMidi, minMidi, sessionStartMs, timelineEndSec]);

  function handleCanvasMouseMove(event) {
    const canvas = canvasRef.current;
    const scroller = scrollContainerRef.current;
    if (!canvas || !scroller) {
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    const x = event.clientX - canvasRect.left;
    const y = event.clientY - canvasRect.top;
    const reason = getMissReasonAtPosition({
      x,
      y,
      canvasWidth: canvas.clientWidth,
      canvasHeight: canvas.clientHeight,
      expectedBars,
      barResults,
      barMissReasons,
      minMidi,
      maxMidi,
      timelineEndSec,
    });

    if (!reason) {
      setHoverTip(null);
      return;
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const nextX = Math.max(12, Math.min(scroller.clientWidth - 12, event.clientX - scrollerRect.left + 12));
    const nextY = Math.max(12, Math.min(scroller.clientHeight - 12, event.clientY - scrollerRect.top - 12));

    setHoverTip((previous) => {
      if (previous && previous.text === reason && Math.abs(previous.x - nextX) < 1 && Math.abs(previous.y - nextY) < 1) {
        return previous;
      }
      return { text: reason, x: nextX, y: nextY };
    });
  }

  return (
    <div className="card" style={{ padding: 12, marginTop: 12, maxWidth: '100%', overflow: 'hidden', position: 'relative' }}>
      <div
        ref={scrollContainerRef}
        style={{
          width: '100%',
          maxWidth: '100%',
          overflowX: 'auto',
          overflowY: 'hidden',
        }}
      >
        <canvas
          ref={canvasRef}
          className="mic-settings-canvas"
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={() => setHoverTip(null)}
          style={{
            display: 'block',
            width: `${contentWidthPx}px`,
            minWidth: `${contentWidthPx}px`,
            maxWidth: 'none',
          }}
        />
      </div>
      {hoverTip ? (
        <div
          style={{
            position: 'absolute',
            left: `${hoverTip.x}px`,
            top: `${hoverTip.y}px`,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'none',
            zIndex: 3,
            background: 'rgba(2, 6, 23, 0.95)',
            border: '1px solid #ef4444',
            color: '#fecaca',
            borderRadius: 8,
            padding: '6px 8px',
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            boxShadow: '0 6px 16px rgba(0, 0, 0, 0.45)',
          }}
        >
          {hoverTip.text}
        </div>
      ) : null}
    </div>
  );
}

function getMissReasonAtPosition({
  x,
  y,
  canvasWidth,
  canvasHeight,
  expectedBars,
  barResults,
  barMissReasons,
  minMidi,
  maxMidi,
  timelineEndSec,
}) {
  const timelineDurationSec = Math.max(MIN_TIMELINE_SECONDS, timelineEndSec);
  const safeTimelineDurationSec = Math.max(0.001, timelineDurationSec);
  const midiSpan = Math.max(1, maxMidi - minMidi);
  const expectedBarHeightPx = 14;
  const fallbackReason = 'Pitch did not match the target note';

  for (const expectedBar of expectedBars) {
    const isMissedBar = barResults[expectedBar.id] === false;
    if (!isMissedBar) {
      continue;
    }

    // Convert expected bar timing to canvas x-bounds.
    const barLeftPx = (expectedBar.startSec / safeTimelineDurationSec) * canvasWidth;
    const barRightPx = (expectedBar.endSec / safeTimelineDurationSec) * canvasWidth;

    // Convert expected bar pitch to canvas y-bounds.
    const pitchRatio = (expectedBar.midi - minMidi) / midiSpan;
    const barCenterYPx = canvasHeight - pitchRatio * canvasHeight;
    const barTopPx = barCenterYPx - expectedBarHeightPx / 2;
    const barBottomPx = barCenterYPx + expectedBarHeightPx / 2;

    const isWithinBarTimeWindow = x >= barLeftPx && x <= barRightPx;
    const isWithinBarPitchWindow = y >= barTopPx && y <= barBottomPx;
    if (isWithinBarTimeWindow && isWithinBarPitchWindow) {
      return barMissReasons[expectedBar.id] || fallbackReason;
    }
  }

  return null;
}

function drawTimeline({
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
    context.strokeStyle = '#a78bfa';
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
  context.strokeStyle = '#f8fafc';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(nowX, 0);
  context.lineTo(nowX, height);
  context.stroke();
}

const CHORD_KIND_SUFFIX = {
  major: '', 'major-seventh': 'M7', 'major-sixth': '6',
  minor: 'm', 'minor-seventh': 'm7', 'minor-sixth': 'm6',
  dominant: '7', 'dominant-seventh': '7', 'dominant-ninth': '9',
  diminished: '°', 'diminished-seventh': '°7', 'half-diminished': 'ø7',
  augmented: '+', 'suspended-fourth': 'sus4', 'suspended-second': 'sus2', power: '5',
};

function chordLabelFor(chord) {
  if (!chord) return '';
  const suffix = CHORD_KIND_SUFFIX[chord.kind] ?? (chord.kind ? `(${chord.kind})` : '');
  return `${chord.root}${suffix}`;
}

function drawChordStrip(context, measures, { toX, chordStartSec, chordBeatSec, nowSec, height }) {
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
    context.fillStyle = isActive ? 'rgba(30, 58, 95, 0.90)' : 'rgba(15, 23, 42, 0.82)';
    context.fillRect(x1, stripY, w, CHORD_STRIP_H);

    // Border
    context.strokeStyle = isActive ? '#3b82f6' : '#1e293b';
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

    context.fillStyle = isActive ? '#93c5fd' : '#94a3b8';
    context.font = `bold ${Math.min(12, Math.max(9, w / 5))}px sans-serif`;
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

function drawGrid(context, width, height, minMidi, maxMidi) {
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

function drawBars(context, bars, { toX, toY, xStartSec, xEndSec, fillStyle, strokeStyle }) {
  bars.forEach((bar) => {
    if (bar.endSec < xStartSec || bar.startSec > xEndSec) {
      return;
    }

    const x1 = toX(bar.startSec);
    const x2 = toX(bar.endSec);
    const y = toY(bar.midi);
    const h = 10;
    const y1 = y - h / 2;
    const w = Math.max(2, x2 - x1);

    context.fillStyle = fillStyle;
    context.strokeStyle = strokeStyle;
    drawRoundedRect(context, x1, y1, w, h, 5);
    context.fill();
    context.stroke();
  });
}

function drawExpectedBars(context, bars, {
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
    const h = 14;
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
    }

    drawRoundedRect(context, x1, y1, w, h, 6);
    context.fill();
    context.stroke();
  });
}

function drawPitchLine(context, history, { toX, toY, xStartSec, xEndSec, singStartSec, sessionStartMs }) {
  if (!Number.isFinite(sessionStartMs) || !Number.isFinite(singStartSec)) {
    return;
  }

  context.strokeStyle = '#22d3ee';
  context.lineWidth = 4;
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
      const gapLimit = Number.isFinite(entry.db) && entry.db >= HIGH_ENERGY_DB_THRESHOLD
        ? MAX_DRAW_GAP_HIGH_ENERGY_SEC
        : MAX_DRAW_GAP_SEC;
      if (!Number.isFinite(lastVoicedSec) || (timeSec - lastVoicedSec) > gapLimit) {
        needsMove = true;
        previousMidi = null;
      }
      continue;
    }

    if (Number.isFinite(previousMidi) && Math.abs(entry.midi - previousMidi) > MAX_DRAW_JUMP_SEMITONES) {
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

function getBarCentsOffset({ bar, history, sessionStartMs }) {
  if (!Number.isFinite(sessionStartMs) || !Array.isArray(history) || !bar) {
    return null;
  }

  if (!Number.isFinite(bar.midi) || !Number.isFinite(bar.startSec) || !Number.isFinite(bar.endSec)) {
    return null;
  }

  const offsets = [];
  for (const entry of history) {
    if (!Number.isFinite(entry?.timeMs) || !Number.isFinite(entry?.midi)) {
      continue;
    }

    const timeSec = (entry.timeMs - sessionStartMs) / 1000;
    if (timeSec < bar.startSec || timeSec > bar.endSec) {
      continue;
    }
    offsets.push((entry.midi - bar.midi) * 100);
  }

  if (!offsets.length) {
    return null;
  }

  // Median is robust to brief pitch spikes.
  offsets.sort((a, b) => a - b);
  return offsets[Math.floor(offsets.length / 2)];
}

function colorForCentsOffset(centsOffset) {
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

function toRgba(rgb, alpha) {
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

function drawRoundedRect(context, x, y, width, height, radius) {
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

function getNowSec(sessionStartMs, stopScrollSec) {
  if (!Number.isFinite(sessionStartMs)) {
    return 0;
  }

  const elapsedSec = Math.max(0, (performance.now() - sessionStartMs) / 1000);
  if (!Number.isFinite(stopScrollSec)) {
    return elapsedSec;
  }

  return Math.min(elapsedSec, stopScrollSec);
}

SingInputGraphV2.propTypes = {
  minFrequencyHz: PropTypes.number,
  maxFrequencyHz: PropTypes.number,
  history: PropTypes.arrayOf(
    PropTypes.shape({
      timeMs: PropTypes.number,
      midi: PropTypes.number,
      pitchHz: PropTypes.number,
      db: PropTypes.number,
    }),
  ),
  sessionStartMs: PropTypes.number,
  singStartSec: PropTypes.number,
  stopScrollSec: PropTypes.number,
  playedBars: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      startSec: PropTypes.number.isRequired,
      endSec: PropTypes.number.isRequired,
      midi: PropTypes.number.isRequired,
    }),
  ),
  expectedBars: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      index: PropTypes.number,
      startSec: PropTypes.number.isRequired,
      endSec: PropTypes.number.isRequired,
      midi: PropTypes.number.isRequired,
    }),
  ),
  barResults: PropTypes.objectOf(PropTypes.bool),
  barMissReasons: PropTypes.objectOf(PropTypes.string),
  chordMeasures: PropTypes.array,
  chordStartSec: PropTypes.number,
  chordBeatSec: PropTypes.number,
};

SingInputGraphV2.defaultProps = {
  minFrequencyHz: 55,
  maxFrequencyHz: 1200,
  history: [],
  sessionStartMs: undefined,
  singStartSec: undefined,
  stopScrollSec: undefined,
  playedBars: [],
  expectedBars: [],
  barResults: {},
  barMissReasons: {},
  chordMeasures: null,
  chordStartSec: 0,
  chordBeatSec: 0,
};