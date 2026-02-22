import React, { useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';

const VIEWPORT_SECONDS = 12;
const TARGET_CURSOR_RATIO = 0.35;
const TARGET_FRAME_MS = 16;

export function SingInputGraph({
  settings,
  history = [],
  sessionStartMs,
  singStartSec,
  stopScrollSec,
  playedBars = [],
  expectedBars = [],
  barResults = {},
}) {
  const canvasRef = useRef(null);
  const frozenStateRef = useRef(null);
  const latestRef = useRef({
    history,
    sessionStartMs,
    singStartSec,
    stopScrollSec,
    playedBars,
    expectedBars,
    barResults,
  });

  latestRef.current = {
    history,
    sessionStartMs,
    singStartSec,
    stopScrollSec,
    playedBars,
    expectedBars,
    barResults,
  };

  useEffect(() => {
    frozenStateRef.current = null;
  }, [sessionStartMs]);

  const { minMidi, maxMidi } = useMemo(() => {
    const minFrequencyHz = Number(settings?.minFrequencyHz) || 80;
    const maxFrequencyHz = Number(settings?.maxFrequencyHz) || 1200;
    const minFromSettings = frequencyToMidi(minFrequencyHz);
    const maxFromSettings = frequencyToMidi(maxFrequencyHz);
    return {
      minMidi: Math.floor(minFromSettings) - 1,
      maxMidi: Math.ceil(maxFromSettings) + 1,
    };
  }, [settings]);

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
        nowSec,
        singStartSec: latest.singStartSec,
        playedBars: latest.playedBars,
        expectedBars: latest.expectedBars,
        barResults: renderBarResults,
        history: renderHistory,
        sessionStartMs: latest.sessionStartMs,
      });

      const hasActiveSession = Number.isFinite(latest.sessionStartMs);
      const isFrozen = Boolean(frozenStateRef.current);
      if (!hasActiveSession || isFrozen) {
        frameId = 0;
        return;
      }

      frameId = requestAnimationFrame(renderFrame);
    };

    frameId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(frameId);
  }, [maxMidi, minMidi, sessionStartMs]);

  return (
    <div className="card" style={{ padding: 12, marginTop: 12 }}>
      <canvas ref={canvasRef} className="mic-settings-canvas" />
    </div>
  );
}

function drawTimeline({
  context,
  width,
  height,
  minMidi,
  maxMidi,
  nowSec,
  singStartSec,
  playedBars,
  expectedBars,
  barResults,
  history,
  sessionStartMs,
}) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#020617';
  context.fillRect(0, 0, width, height);

  const xStartSec = Math.max(0, nowSec - VIEWPORT_SECONDS * TARGET_CURSOR_RATIO);
  const xEndSec = xStartSec + VIEWPORT_SECONDS;

  const toX = (seconds) => ((seconds - xStartSec) / (xEndSec - xStartSec)) * width;
  const toY = (midi) => {
    const ratio = (midi - minMidi) / Math.max(1, maxMidi - minMidi);
    return height - ratio * height;
  };

  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    const y = toY(midi);
    context.strokeStyle = midi % 12 === 0 ? '#334155' : '#1e293b';
    context.lineWidth = midi % 12 === 0 ? 1.2 : 0.7;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

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

  const nowX = toX(nowSec);
  context.strokeStyle = '#f8fafc';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(nowX, 0);
  context.lineTo(nowX, height);
  context.stroke();
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

function drawExpectedBars(context, bars, { toX, toY, xStartSec, xEndSec, nowSec, barResults }) {
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
    } else if (result) {
      context.fillStyle = 'rgba(22, 163, 74, 0.62)';
      context.strokeStyle = '#86efac';
    } else {
      context.fillStyle = 'rgba(220, 38, 38, 0.62)';
      context.strokeStyle = '#fca5a5';
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

  const samples = [];
  for (const entry of history) {
    if (!Number.isFinite(entry.timeMs)) {
      continue;
    }

    const timeSec = (entry.timeMs - sessionStartMs) / 1000;
    if (timeSec < singStartSec || timeSec < xStartSec || timeSec > xEndSec) {
      continue;
    }

    samples.push({
      timeSec,
      midi: Number.isFinite(entry.midi) ? entry.midi : null,
    });
  }

  if (!samples.length) {
    return;
  }

  const interpolated = interpolateMissingMidi(samples);
  if (interpolated.length < 2) {
    return;
  }

  const decimated = decimatePoints(interpolated, 110);

  context.strokeStyle = '#22d3ee';
  context.lineWidth = 4;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.beginPath();

  decimated.forEach((point, index) => {
    if (!Number.isFinite(point.midi)) {
      return;
    }
    const x = toX(point.timeSec);
    const y = toY(point.midi);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  context.stroke();
}

function decimatePoints(points, maxPoints) {
  if (points.length <= maxPoints) {
    return points;
  }

  const step = Math.ceil(points.length / maxPoints);
  const result = [];
  for (let index = 0; index < points.length; index += step) {
    result.push(points[index]);
  }

  const lastPoint = points[points.length - 1];
  if (result.at(-1) !== lastPoint) {
    result.push(lastPoint);
  }

  return result;
}

function interpolateMissingMidi(samples) {
  if (samples.length < 2) return samples;

  const result = [...samples];
  let lastValidIndex = -1;

  for (let i = 0; i < result.length; i++) {
    if (Number.isFinite(result[i].midi)) {
      if (lastValidIndex >= 0 && i > lastValidIndex + 1) {
        // interpolate from lastValidIndex to i
        const start = result[lastValidIndex];
        const end = result[i];
        const timeDiff = end.timeSec - start.timeSec;
        for (let j = lastValidIndex + 1; j < i; j++) {
          const ratio = (result[j].timeSec - start.timeSec) / timeDiff;
          result[j].midi = start.midi + (end.midi - start.midi) * ratio;
        }
      }
      lastValidIndex = i;
    }
  }

  return result;
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

function frequencyToMidi(frequency) {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return 0;
  }
  return 69 + (12 * Math.log(frequency / 440)) / Math.log(2);
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

SingInputGraph.propTypes = {
  settings: PropTypes.shape({
    minFrequencyHz: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    maxFrequencyHz: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  }),
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
};

SingInputGraph.defaultProps = {
  settings: undefined,
  history: [],
  sessionStartMs: undefined,
  singStartSec: undefined,
  stopScrollSec: undefined,
  playedBars: [],
  expectedBars: [],
  barResults: {},
};
