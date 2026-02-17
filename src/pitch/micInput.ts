import { useCallback, useMemo, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import LiveAudioStream from 'react-native-live-audio-stream';
import { toByteArray } from 'base64-js';
import { YIN } from 'pitchfinder';

interface MicInputState {
  hasPermission: boolean;
  isRecording: boolean;
  levelDb: number | null;
  frequencyHz: number | null;
  detectedMidi: number | null;
  centsOffset: number | null;
  error: string | null;
}

const SAMPLE_RATE = 22050;
const BUFFER_SIZE = 4096;
const bitsPerSample = 16;

function frequencyToMidi(frequencyHz: number) {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

function toInt16Samples(base64Chunk: string): Int16Array {
  const bytes = toByteArray(base64Chunk);
  const sampleCount = Math.floor(bytes.length / 2);
  const samples = new Int16Array(sampleCount);

  for (let i = 0; i < sampleCount; i += 1) {
    const low = bytes[i * 2] ?? 0;
    const high = bytes[i * 2 + 1] ?? 0;
    let value = (high << 8) | low;
    if (value & 0x8000) {
      value = value - 0x10000;
    }
    samples[i] = value;
  }

  return samples;
}

function rmsDb(samples: Int16Array): number {
  if (samples.length === 0) {
    return -160;
  }

  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const normalized = samples[i] / 32768;
    sum += normalized * normalized;
  }

  const rms = Math.sqrt(sum / samples.length);
  return 20 * Math.log10(Math.max(1e-8, rms));
}

export function useMicInput() {
  const listeningRef = useRef(false);
  const listenerAttachedRef = useRef(false);
  const detectPitchRef = useRef(
    YIN({
      sampleRate: SAMPLE_RATE,
      threshold: 0.12,
      probabilityThreshold: 0.1,
    }),
  );
  const [state, setState] = useState<MicInputState>({
    hasPermission: false,
    isRecording: false,
    levelDb: null,
    frequencyHz: null,
    detectedMidi: null,
    centsOffset: null,
    error: null,
  });

  const requestPermission = useCallback(async (): Promise<boolean> => {
    const result = await Audio.requestPermissionsAsync();
    const granted = result.granted;
    setState((prev) => ({
      ...prev,
      hasPermission: granted,
      error: granted ? null : 'Microphone permission denied',
    }));
    return granted;
  }, []);

  const start = useCallback(async () => {
    if (listeningRef.current) {
      return;
    }

    const granted = await requestPermission();
    if (!granted) {
      return;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      staysActiveInBackground: false,
    });

    LiveAudioStream.init({
      sampleRate: SAMPLE_RATE,
      channels: 1,
      bitsPerSample,
      audioSource: 6,
      bufferSize: BUFFER_SIZE,
      wavFile: 'musicapp-live-input.wav',
    });

    if (!listenerAttachedRef.current) {
      LiveAudioStream.on('data', (chunk: string) => {
        if (!listeningRef.current) {
          return;
        }

        const samples = toInt16Samples(chunk);
        const db = rmsDb(samples);

        const signal = new Float32Array(samples.length);
        for (let i = 0; i < samples.length; i += 1) {
          signal[i] = samples[i] / 32768;
        }

        const frequency = detectPitchRef.current(signal);
        if (!frequency || Number.isNaN(frequency)) {
          setState((prev) => ({
            ...prev,
            levelDb: db,
            frequencyHz: null,
            detectedMidi: null,
            centsOffset: null,
          }));
          return;
        }

        const fractionalMidi = frequencyToMidi(frequency);
        const roundedMidi = Math.round(fractionalMidi);
        const cents = (fractionalMidi - roundedMidi) * 100;

        setState((prev) => ({
          ...prev,
          levelDb: db,
          frequencyHz: frequency,
          detectedMidi: roundedMidi,
          centsOffset: cents,
        }));
      });
      listenerAttachedRef.current = true;
    }

    LiveAudioStream.start();
    listeningRef.current = true;
    setState((prev) => ({ ...prev, isRecording: true, error: null }));
  }, [requestPermission]);

  const stop = useCallback(async () => {
    if (!listeningRef.current) {
      return;
    }

    try {
      await LiveAudioStream.stop();
      listeningRef.current = false;
    } finally {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: false,
      });
      setState((prev) => ({ ...prev, isRecording: false }));
    }
  }, []);

  const levelPercent = useMemo(() => {
    if (state.levelDb === null) {
      return 0;
    }
    const normalized = (state.levelDb + 60) / 60;
    return Math.max(0, Math.min(100, Math.round(normalized * 100)));
  }, [state.levelDb]);

  return {
    ...state,
    levelPercent,
    requestPermission,
    start,
    stop,
  };
}
