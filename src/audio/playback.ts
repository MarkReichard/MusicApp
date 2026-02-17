import { Audio } from 'expo-av';
import { synthesizeNoteWavDataUri } from './synth';

const activeSounds = new Set<Audio.Sound>();

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

let audioConfigured = false;
async function ensureAudioMode() {
  if (audioConfigured) {
    return;
  }

  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    allowsRecordingIOS: false,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });

  audioConfigured = true;
}

export async function playMidiNote(midi: number, durationMs: number): Promise<void> {
  await ensureAudioMode();

  const uri = synthesizeNoteWavDataUri(midi, durationMs);
  const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true, volume: 1 });
  activeSounds.add(sound);

  await wait(durationMs);
  await sound.stopAsync();
  await sound.unloadAsync();
  activeSounds.delete(sound);
}

export async function playMidiSequence(midis: number[], tempoBpm: number, onEachNote?: (midi: number) => void) {
  const beatMs = Math.max(120, Math.floor((60_000 / Math.max(30, tempoBpm)) * 0.9));
  const noteMs = Math.min(520, beatMs);

  for (const midi of midis) {
    onEachNote?.(midi);
    await playMidiNote(midi, noteMs);
    await wait(Math.max(0, beatMs - noteMs));
  }
}

export async function stopAllPlayback() {
  const sounds = [...activeSounds];
  activeSounds.clear();

  for (const sound of sounds) {
    try {
      await sound.stopAsync();
      await sound.unloadAsync();
    } catch {
      // ignore cleanup errors
    }
  }
}
