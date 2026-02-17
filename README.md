# Music Ear Training App (Expo + React Native)

## What is implemented

- Lesson library grouped by lesson `category` from JSON.
- Lesson library cards show local progress analytics (attempts and best accuracy).
- Trainer screen includes:
  - Progress indicators (`Set`, `Note`, progress bar).
  - Pitch-only correctness (advance on correct, stay on wrong).
  - Solfege (multi-octave), piano (2 octaves), and singing input modes.
  - Replay icon for current chunk.
  - Lesson options accordion on the same training screen.
- Support refresh from web service with:
  - Network timeout protection.
  - Clear error messages on failure.
- Local persistence for defaults and per-lesson overrides.
- Preloaded lessons for `3_note_pattern` and `christmas_songs`.
- Audible synthesized note playback (generated WAV piano-like tones).
- Automatic singing pitch detection (live Hz, MIDI, cents) and auto-check while mic is active.

## Local analytics

- Per-lesson attempts are stored locally.
- Completed/incomplete attempts and pitch accuracy are tracked.
- Library screen shows attempts count and best accuracy per lesson.

## Run on Windows PC

1. Install:
   - Node.js LTS
   - Android Studio (SDK + emulator)
2. Install dependencies:
   - `npm install`
3. Build native dev client (required for live pitch module):
   - `npm run android`
4. Start dev server for dev client:
   - `npm run start:dev`
5. In Expo terminal:
   - Press `a` to open Android emulator.

## Run on physical Android device

1. Enable USB debugging on Android phone.
2. Connect phone by USB.
3. Run `npm run android` to install the dev build on device.
4. Run `npm run start:dev`.

## Typecheck

- `npm run typecheck`

## Debugging

- Open Expo DevTools from terminal output.
- Use React Native logs in terminal.
- Use emulator for general UI testing.
- Use physical Android for singing/microphone-related testing.

## Audio notes

- `src/audio/playback.ts` plays generated WAV note synthesis through `expo-av`.
- `src/audio/synth.ts` includes URI caching to reduce repeated synthesis CPU cost.

## Singing pitch detection notes

- Mic permission, live PCM stream capture, and YIN pitch detection are implemented.
- Singing mode auto-submits detected notes while mic is on and voice level is sufficient.
- `Check Detected Now` remains available as manual fallback.
- This requires a native dev build (`expo run:android`), not Expo Go.
