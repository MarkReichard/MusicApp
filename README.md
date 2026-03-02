# Music Trainer (Web)

Web-only React app for lesson practice and pitch tuning.

## App structure

- `web/src/pages/HomePage.jsx` — landing page with quick-start cards
- `web/src/pages/LessonsPage.jsx` — lesson library with category accordion
- `web/src/pages/TrainerPage.jsx` — piano/solfège practice page
- `web/src/pages/SingTrainerV2Page.jsx` — singing trainer with live pitch graph
- `web/src/pages/SongBuilderPage.jsx` — JSON authoring tool: enter song details + measures (notes & chords) and copy the generated JSON to a lesson file
- `web/src/pages/PitchMatchPage.jsx` — listen-and-sing pitch matching exercise
- `web/src/pages/PitchRangePage.jsx` — guided vocal range measurement wizard
- `web/src/pages/PitchLabPage.jsx` — mic settings / pitch detection tuning (hidden)
- `web/src/pages/SingGraphV2LabPage.jsx` — standalone pitch graph lab (hidden, for debugging)
- `web/src/lib/useStablePitchTracker.js` — YIN pitch detection hook (used by sing trainer)
- `web/src/lib/pitchSettings.js` — localStorage-backed pitch settings

## Routes

| Route | Page | In nav | Description |
|---|---|---|---|
| `/` | Home | ✓ | Landing page with quick-start cards |
| `/lessons` | Lessons | ✓ | Browse all lesson exercises and launch a trainer |
| `/song-builder` | Song Builder | ✓ | Build song lesson JSON (enter song details, measures, notes, chords; copy output to a file) |
| `/pitch-match` | Pitch Match | ✓ | Listen to a diatonic note and sing it back |
| `/pitch-range` | Vocal Range | ✓ | Measure and save your vocal range |
| `/trainer/:lessonId` | Trainer | — | Piano / solfège practice for a lesson (`?mode=piano` or `?mode=solfege`) |
| `/trainer/:lessonId/sing` | Sing Trainer V2 | — | Live pitch-graph singing trainer for a lesson |
| `/trainer/:lessonId/sing-v2` | Sing Trainer V2 | — | Alias for `/trainer/:lessonId/sing` |
| `/pitch-lab` | Pitch Lab | hidden | Mic settings / pitch detection tuning |
| `/sing-graph-v2` | Sing Graph V2 Lab | hidden | Standalone pitch graph, no lesson (for debugging) |

## Pitch settings persistence

Pitch Lab settings are saved in localStorage under `musicapp.web.pitchSettings.v1`.
The singing trainer reads those same saved settings.

Default pitch settings:
- `minFrequencyHz = 55`
- `maxFrequencyHz = 600`
- `minClarity = 0.85`
- `minDbThreshold = -55`

## Hidden debug pages

The **Pitch Lab** (`/pitch-lab`) lets you tune `minFrequencyHz`, `maxFrequencyHz`, `minClarity`,
`minDbThreshold`, and `fftSize` live and saves them to localStorage.

The **Sing Graph V2 Lab** (`/sing-graph-v2`) runs the pitch graph in isolation — no lesson
playback, no scoring. Useful for testing the detector in real time without starting a lesson.

## Debugging pitch detection

1. Navigate to `/pitch-lab` and click **Start** to activate the mic.
2. Sing a sustained note and watch `rawHz`, `midi`, and `clarity` in the readout.
3. Adjust settings:
   - If the graph jumps to a high note while singing low: lower `maxFrequencyHz` to just above
     your highest note (e.g. `350` for a bass/baritone). This blocks harmonic overtones at the
     frequency gate before YIN even runs.
   - If the graph is noisy or choppy: raise `minClarity` (try `0.88`–`0.92`).
   - If the detector misses quiet notes or drops out mid-note: lower `minDbThreshold`
     (e.g. `-65`).
   - If the detector triggers on background noise: raise `minDbThreshold` (e.g. `-50`).
4. Settings are saved automatically. The singing trainer picks them up immediately.

To capture a raw detector log for offline analysis:

1. Open the **Sing Trainer** for any lesson.
2. Start and complete a run (or just sing for a few seconds and stop).
3. Click **Download CSV** — the log contains one row per poll frame with columns:
   `tick, timeSec, db, rawHz, rawClarity, acceptedHz, midi, clarity, voiced, gateReason`.

Make sure your OS audio settings have **echo cancellation**, **noise suppression**, and
**auto gain control** disabled at the system level or use headphones — the app already
disables them in the `getUserMedia` constraints, but some OS drivers override this.

## Run

From repository root:

- Install root deps: `npm install`
- Install web deps (first time): `npm install --prefix web`
- Start dev server: `npm run web:dev`
- Build: `npm run web:build`
- Preview build: `npm run web:preview`

## Convert MusicXML to lessons

Use the root CLI to convert `.musicxml` / `.xml` / `.mxl` score files into lesson JSON.

- Install root deps: `npm install`
- Convert one file:
  - `npm run convert:mxml -- --input path/to/score.musicxml`
- Convert all score files in a folder:
  - `npm run convert:mxml -- --input path/to/folder --output content/lessons`

Optional flags:

- `--category imported_scores`
- `--difficulty intermediate`
- `--default-key C`
- `--tags imported,musicxml`

## VS Code launch

Use Run and Debug profile:

- `Web App: Full Launch`

This starts Vite and opens the browser debugger.
