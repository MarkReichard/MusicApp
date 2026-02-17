import { fromByteArray } from 'base64-js';

const SAMPLE_RATE = 44100;
const URI_CACHE_LIMIT = 96;
const uriCache = new Map<string, string>();

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function pianoLikeSample(frequency: number, t: number, durationSec: number): number {
  const attack = 0.01;
  const decay = 0.22;
  const sustain = 0.35;
  const release = 0.12;

  let env = 0;
  if (t < attack) {
    env = t / attack;
  } else if (t < attack + decay) {
    const d = (t - attack) / decay;
    env = 1 - d * (1 - sustain);
  } else if (t < Math.max(attack + decay, durationSec - release)) {
    env = sustain;
  } else if (t <= durationSec) {
    const r = (t - (durationSec - release)) / release;
    env = sustain * (1 - Math.min(1, Math.max(0, r)));
  }

  const x = 2 * Math.PI * frequency * t;
  const harmonic1 = Math.sin(x);
  const harmonic2 = 0.55 * Math.sin(2 * x);
  const harmonic3 = 0.23 * Math.sin(3 * x);
  const harmonic4 = 0.1 * Math.sin(4 * x);
  const inharmonic = 0.06 * Math.sin(2 * Math.PI * frequency * 2.01 * t);

  const sample = (harmonic1 + harmonic2 + harmonic3 + harmonic4 + inharmonic) * env * 0.55;
  return Math.max(-1, Math.min(1, sample));
}

function writeString(bytes: Uint8Array, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    bytes[offset + i] = value.codePointAt(i) ?? 0;
  }
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
  bytes[offset + 3] = (value >> 24) & 0xff;
}

function writeUint16LE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}

export function synthesizeNoteWavDataUri(midi: number, durationMs: number): string {
  const roundedDurationMs = Math.max(80, Math.round(durationMs / 10) * 10);
  const cacheKey = `${midi}:${roundedDurationMs}`;
  const cached = uriCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const durationSec = roundedDurationMs / 1000;
  const frequency = midiToFrequency(midi);
  const numSamples = Math.floor(durationSec * SAMPLE_RATE);
  const byteRate = SAMPLE_RATE * 2;
  const blockAlign = 2;
  const dataSize = numSamples * 2;
  const fileSize = 44 + dataSize;

  const bytes = new Uint8Array(fileSize);

  writeString(bytes, 0, 'RIFF');
  writeUint32LE(bytes, 4, fileSize - 8);
  writeString(bytes, 8, 'WAVE');
  writeString(bytes, 12, 'fmt ');
  writeUint32LE(bytes, 16, 16);
  writeUint16LE(bytes, 20, 1);
  writeUint16LE(bytes, 22, 1);
  writeUint32LE(bytes, 24, SAMPLE_RATE);
  writeUint32LE(bytes, 28, byteRate);
  writeUint16LE(bytes, 32, blockAlign);
  writeUint16LE(bytes, 34, 16);
  writeString(bytes, 36, 'data');
  writeUint32LE(bytes, 40, dataSize);

  let offset = 44;
  for (let i = 0; i < numSamples; i += 1) {
    const t = i / SAMPLE_RATE;
    const sample = pianoLikeSample(frequency, t, durationSec);
    const int16 = Math.floor(sample * 32767);
    bytes[offset] = int16 & 0xff;
    bytes[offset + 1] = (int16 >> 8) & 0xff;
    offset += 2;
  }

  const base64 = fromByteArray(bytes);
  const uri = `data:audio/wav;base64,${base64}`;
  uriCache.set(cacheKey, uri);

  if (uriCache.size > URI_CACHE_LIMIT) {
    const firstKey = uriCache.keys().next().value;
    if (firstKey) {
      uriCache.delete(firstKey);
    }
  }

  return uri;
}
