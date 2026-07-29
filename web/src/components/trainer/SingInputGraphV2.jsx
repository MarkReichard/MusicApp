import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useLocation } from 'react-router-dom';
import { frequencyToMidi } from '../../lib/musicTheory';
import { drawTimeline } from '../../lib/graphDrawing/timeline';
import { drawGrid, getNowSec } from '../../lib/graphDrawing/canvas-helpers';
import { getMissReasonAtPosition } from '../../lib/graphDrawing/hover-tips';
import {
  PIXELS_PER_SECOND,
  FOLLOW_CURSOR_RATIO,
  TARGET_FRAME_MS,
  SCROLL_SMOOTHING_FACTOR,
  MIN_TIMELINE_SECONDS,
  TIMELINE_RIGHT_PAD_SECONDS,
} from '../../lib/graphDrawing/constants';

const FOLLOW_SCROLL_INTERVAL_MS = 120;

export function SingInputGraphV2({
  minFrequencyHz = 55,
  maxFrequencyHz = 1200,
  toleranceCents = 50,
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
  const location = useLocation();
  const canvasRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const frozenStateRef = useRef(null);
  const desiredScrollLeftRef = useRef(0);
  const [timelineEndSec, setTimelineEndSec] = useState(MIN_TIMELINE_SECONDS);
  const [contentWidthPx, setContentWidthPx] = useState(1200);
  const [hoverTip, setHoverTip] = useState(null);
  const isDebug = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('debug') === 'true';
  }, [location.search]);
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
    }, FOLLOW_SCROLL_INTERVAL_MS);

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

  const debugSnapshot = useMemo(() => {
    const nowSec = getNowSec(sessionStartMs, stopScrollSec);
    const voicedSamples = history.filter((entry) => Number.isFinite(entry?.midi)).length;
    const evaluatedBars = expectedBars.filter((bar) => barResults[bar.id] !== undefined).length;
    const missedBars = expectedBars.filter((bar) => barResults[bar.id] === false).length;

    return {
      nowSec,
      voicedSamples,
      expectedBars: expectedBars.length,
      evaluatedBars,
      missedBars,
      timelineEndSec,
      singStartSec,
    };
  }, [barResults, expectedBars, history, sessionStartMs, singStartSec, stopScrollSec, timelineEndSec]);

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

    // Extracted helpers to reduce cognitive complexity of renderFrame
    function handleCanvasResize(rectWidth, rectHeight, dpr) {
      if (rectWidth === lastWidth && rectHeight === lastHeight && dpr === lastDpr) {
        return null;
      }
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
      return offscreen;
    }

    function computeRenderState(latest) {
      const liveNowSec = getNowSec(latest.sessionStartMs, latest.stopScrollSec);

      // Freeze state when session ends
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
      return { nowSec, renderHistory, renderBarResults };
    }

    function applyAutoScroll(latest, liveNowSec, rectWidth) {
      const scroller = scrollContainerRef.current;
      if (!scroller || !Number.isFinite(latest.sessionStartMs)) {
        return;
      }

      const sessionDone = Number.isFinite(latest.stopScrollSec) && liveNowSec >= latest.stopScrollSec;
      if (sessionDone) {
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

    function isSessionActive(latest) {
      return Number.isFinite(latest.sessionStartMs);
    }

    const renderFrame = (timestamp) => {
      if (timestamp - lastRenderTime < TARGET_FRAME_MS) {
        frameId = requestAnimationFrame(renderFrame);
        return;
      }
      lastRenderTime = timestamp;

      const dpr = globalThis.devicePixelRatio || 1;
      const rectWidth = canvas.clientWidth;
      const rectHeight = canvas.clientHeight;

      const newGridCanvas = handleCanvasResize(rectWidth, rectHeight, dpr);
      if (newGridCanvas) {
        gridCanvas = newGridCanvas;
      }

      const latest = latestRef.current;
      const { nowSec, renderHistory, renderBarResults } = computeRenderState(latest);

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

      applyAutoScroll(latest, nowSec, rectWidth);

      if (!isSessionActive(latest)) {
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
      toleranceCents,
      expectedBars,
      barResults,
      barMissReasons,
      history,
      sessionStartMs,
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
          overflowX: 'scroll',
          overflowY: 'hidden',
          scrollbarGutter: 'stable both-edges',
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
      {isDebug ? (
        <div
          style={{
            position: 'absolute',
            right: 12,
            bottom: 12,
            pointerEvents: 'none',
            zIndex: 2,
            background: 'rgba(2, 6, 23, 0.9)',
            border: '1px solid #334155',
            color: '#cbd5e1',
            borderRadius: 8,
            padding: '6px 8px',
            fontSize: 11,
            lineHeight: 1.4,
          }}
        >
          <div>Graph Debug</div>
          <div>now: {debugSnapshot.nowSec.toFixed(2)}s</div>
          <div>timeline: {debugSnapshot.timelineEndSec.toFixed(2)}s</div>
          <div>sing start: {Number.isFinite(debugSnapshot.singStartSec) ? `${debugSnapshot.singStartSec.toFixed(2)}s` : '-'}</div>
          <div>voiced samples: {debugSnapshot.voicedSamples}</div>
          <div>bars: {debugSnapshot.evaluatedBars}/{debugSnapshot.expectedBars}</div>
          <div>missed bars: {debugSnapshot.missedBars}</div>
        </div>
      ) : null}
    </div>
  );
}

SingInputGraphV2.propTypes = {
  minFrequencyHz: PropTypes.number,
  maxFrequencyHz: PropTypes.number,
  toleranceCents: PropTypes.number,
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
  toleranceCents: 50,
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