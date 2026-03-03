/**
 * KaraokeOverlay — displays lyric syllables for the current section,
 * highlighting the active syllable in real-time using a rAF loop against
 * the Web Audio / performance clock.
 *
 * Props:
 *   sessionStartMs   performance.now() timestamp for t=0 of the session
 *   stopScrollSec    session end time in seconds (relative to startMs)
 *   expectedBars     array from buildSingTimeline, may contain .lyric fields
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';

export function KaraokeOverlay({ sessionStartMs, stopScrollSec, expectedBars }) {
  const [activeIdx, setActiveIdx] = useState(-1);
  const rafRef = useRef(null);

  // Only bars that carry lyric text
  const lyricBars = useMemo(
    () => (expectedBars ?? []).filter((b) => b.lyric),
    [expectedBars],
  );

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    if (!lyricBars.length || !Number.isFinite(sessionStartMs)) {
      setActiveIdx(-1);
      return undefined;
    }

    function tick() {
      const nowSec = (performance.now() - sessionStartMs) / 1000;

      let found = -1;
      for (let i = 0; i < lyricBars.length; i++) {
        if (nowSec >= lyricBars[i].startSec && nowSec < lyricBars[i].endSec) {
          found = i;
          break;
        }
      }
      setActiveIdx(found);

      if (!Number.isFinite(stopScrollSec) || nowSec < stopScrollSec) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [sessionStartMs, stopScrollSec, lyricBars]);

  if (!lyricBars.length) return null;

  return (
    <div className="karaoke-overlay" aria-live="off">
      {lyricBars.map((bar, i) => {
        const isPast = activeIdx >= 0 && i < activeIdx;
        const isActive = i === activeIdx;
        return (
          <span
            key={bar.id}
            className={[
              'karaoke-word',
              isActive ? 'karaoke-word--active' : '',
              isPast ? 'karaoke-word--past' : '',
            ].filter(Boolean).join(' ')}
          >
            {bar.lyric}
          </span>
        );
      })}
    </div>
  );
}

KaraokeOverlay.propTypes = {
  sessionStartMs: PropTypes.number,
  stopScrollSec: PropTypes.number,
  expectedBars: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      startSec: PropTypes.number.isRequired,
      endSec: PropTypes.number.isRequired,
      lyric: PropTypes.string,
    }),
  ),
};
