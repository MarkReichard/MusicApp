import { useEffect, useRef, useState } from 'react';
import { PitchDetector } from 'pitchy';

export function usePitchDetector(settings, enabled) {
  const [current, setCurrent] = useState({
    pitchHz: null,
    midi: null,
    note: '-',
    db: null,
    clarity: null,
  });

  const [history, setHistory] = useState([]);
  const resourcesRef = useRef({
    context: null,
    stream: null,
    source: null,
    analyser: null,
    detector: null,
    timer: null,
    averageWindow: [],
  });

  useEffect(() => {
    if (!enabled) {
      void stop();
      return;
    }

    void start();
    return () => {
      void stop();
    };
  }, [enabled, settings]);

  async function stop() {
    const resources = resourcesRef.current;
    if (resources.timer) {
      window.clearInterval(resources.timer);
      resources.timer = null;
    }
    if (resources.source) {
      resources.source.disconnect();
      resources.source = null;
    }
    if (resources.stream) {
      resources.stream.getTracks().forEach((track) => track.stop());
      resources.stream = null;
    }
    if (resources.context) {
      await resources.context.close().catch(() => undefined);
      resources.context = null;
    }
    resources.analyser = null;
    resources.detector = null;
    resources.averageWindow = [];
  }

  async function start() {
    await stop();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const context = new AudioContext({ sampleRate: Number(settings.sampleRate) });
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = Number(settings.fftSize);
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);

    const detector = PitchDetector.forFloat32Array(analyser.fftSize);
    const sampleBuffer = new Float32Array(analyser.fftSize);

    resourcesRef.current = {
      context,
      stream,
      source,
      analyser,
      detector,
      timer: null,
      averageWindow: [],
    };

    resourcesRef.current.timer = window.setInterval(() => {
      const resources = resourcesRef.current;
      if (!resources.analyser || !resources.detector) return;

      resources.analyser.getFloatTimeDomainData(sampleBuffer);

      let rms = 0;
      for (let index = 0; index < sampleBuffer.length; index += 1) {
        const value = sampleBuffer[index];
        rms += value * value;
      }
      rms = Math.sqrt(rms / sampleBuffer.length);
      const db = 20 * Math.log10(Math.max(1e-8, rms));

      let pitchHz = null;
      let clarity = null;

      if (db >= Number(settings.minDbThreshold)) {
        const result = resources.detector.findPitch(sampleBuffer, context.sampleRate);
        const detectedHz = result[0];
        const detectedClarity = result[1];
        const valid =
          Number.isFinite(detectedHz) &&
          Number.isFinite(detectedClarity) &&
          detectedClarity >= Number(settings.minClarity) &&
          detectedHz >= Number(settings.minFrequencyHz) &&
          detectedHz <= Number(settings.maxFrequencyHz);

        if (valid) {
          resources.averageWindow = [...resources.averageWindow, detectedHz].slice(-Number(settings.averageReadings));
          pitchHz = resources.averageWindow.reduce((sum, value) => sum + value, 0) / resources.averageWindow.length;
          clarity = detectedClarity;
        }
      }

      const midi = Number.isFinite(pitchHz) ? 69 + 12 * Math.log2(pitchHz / 440) : null;
      const note = Number.isFinite(midi) ? midiToNoteLabel(midi) : '-';

      setCurrent({ pitchHz, midi, note, db, clarity });
      setHistory((previous) => {
        const next = [...previous, { pitchHz, db }];
        return next.length > 220 ? next.slice(next.length - 220) : next;
      });
    }, Number(settings.pollMs));
  }

  return {
    current,
    history,
    clearHistory: () => setHistory([]),
  };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNoteLabel(midi) {
  const roundedMidi = Math.round(midi);
  const name = NOTE_NAMES[roundedMidi % 12] ?? 'C';
  const octave = Math.floor(roundedMidi / 12) - 1;
  return `${name}${octave}`;
}
