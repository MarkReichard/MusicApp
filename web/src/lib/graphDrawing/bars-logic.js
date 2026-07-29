// ── Bar cents offset computation ───────────────────────────────────────────────

export function getBarCentsOffset({ bar, history, sessionStartMs }) {
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