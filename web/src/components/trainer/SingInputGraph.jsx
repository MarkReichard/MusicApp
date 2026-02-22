import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';

const VIEWPORT_SECONDS = 12;
const TARGET_CURSOR_RATIO = 0.75;

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
  const [nowMs, setNowMs] = useState(() => performance.now());

  useEffect(() => {
    let frameId = 0;
    const tick = () => {
      setNowMs(performance.now());
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const nowSec = useMemo(() => {
    if (!Number.isFinite(sessionStartMs)) {
      return 0;
    }
    const elapsedSec = Math.max(0, (nowMs - sessionStartMs) / 1000);
    if (!Number.isFinite(stopScrollSec)) {
      return elapsedSec;
    }
    return Math.min(elapsedSec, stopScrollSec);
  }, [nowMs, sessionStartMs, stopScrollSec]);

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
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTimeline({
      context,
      width: rect.width,
      height: rect.height,
      minMidi,
      maxMidi,
      nowSec,
      singStartSec,
      playedBars,
      expectedBars,
      barResults,
      history,
      sessionStartMs,
    });
  }, [barResults, expectedBars, history, maxMidi, minMidi, nowSec, playedBars, sessionStartMs, singStartSec]);

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

  const samples = history
    .map((entry) => {
      if (!Number.isFinite(entry.timeMs)) {
        return null;
      }
      return {
        timeSec: (entry.timeMs - sessionStartMs) / 1000,
        midi: Number.isFinite(entry.midi) ? entry.midi : null,
      };
    })
    .filter((entry) => entry && entry.timeSec >= singStartSec && entry.timeSec >= xStartSec && entry.timeSec <= xEndSec);

  if (!samples.length) {
    return;
  }

  const interpolated = interpolateMissingMidi(samples);
  if (interpolated.length < 2) {
    return;
  }

  context.strokeStyle = '#22d3ee';
  context.lineWidth = 4;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.beginPath();

  interpolated.forEach((point, index) => {
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

function interpolateMissingMidi(samples) {
  return samples.map((sample, index) => {
    if (Number.isFinite(sample.midi)) {
      return sample;
    }

    let prevIndex = index - 1;
    while (prevIndex >= 0 && !Number.isFinite(samples[prevIndex].midi)) {
      prevIndex -= 1;
    }

    let nextIndex = index + 1;
    while (nextIndex < samples.length && !Number.isFinite(samples[nextIndex].midi)) {
      nextIndex += 1;
    }

    if (prevIndex < 0 || nextIndex >= samples.length) {
      return sample;
    }

    const prev = samples[prevIndex];
    const next = samples[nextIndex];
    const ratio = (sample.timeSec - prev.timeSec) / Math.max(1e-6, next.timeSec - prev.timeSec);
    return {
      ...sample,
      midi: prev.midi + (next.midi - prev.midi) * ratio,
    };
  });
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
