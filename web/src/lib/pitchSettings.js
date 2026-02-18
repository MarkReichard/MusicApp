const STORAGE_KEY = 'musicapp.web.pitchSettings.v1';

export const defaultPitchSettings = {
  sampleRate: 22050,
  fftSize: 4096,
  pollMs: 50,
  averageReadings: 3,
  minFrequencyHz: 20,
  maxFrequencyHz: 800,
  minClarity: 0.85,
  minDbThreshold: -55,
};

export function loadPitchSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPitchSettings;
    const parsed = JSON.parse(raw);
    return { ...defaultPitchSettings, ...parsed };
  } catch {
    return defaultPitchSettings;
  }
}

export function savePitchSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
