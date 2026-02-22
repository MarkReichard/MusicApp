const STORAGE_KEY = 'musicapp.web.pitchRange.v1';

export function loadPitchRangeSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultPitchRangeSettings();
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return defaultPitchRangeSettings();
    }

    const minMidi = Number(parsed.minMidi);
    const maxMidi = Number(parsed.maxMidi);

    if (!Number.isFinite(minMidi) || !Number.isFinite(maxMidi) || minMidi >= maxMidi) {
      return defaultPitchRangeSettings();
    }

    return {
      minMidi,
      maxMidi,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    };
  } catch {
    return defaultPitchRangeSettings();
  }
}

export function savePitchRangeSettings({ minMidi, maxMidi }) {
  const min = Number(minMidi);
  const max = Number(maxMidi);

  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    return false;
  }

  const payload = {
    minMidi: min,
    maxMidi: max,
    updatedAt: new Date().toISOString(),
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  return true;
}

function defaultPitchRangeSettings() {
  return {
    minMidi: null,
    maxMidi: null,
    updatedAt: null,
  };
}
