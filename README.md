# Music Trainer (Web)

Web-only React app for lesson practice and pitch tuning.

## App structure

- `web/src/pages/LessonsPage.jsx` — lesson library page
- `web/src/pages/TrainerPage.jsx` — practice/training page
- `web/src/pages/PitchLabPage.jsx` — live pitch detection tuning page
- `web/src/lib/usePitchDetector.js` — shared Pitchy detection hook used by trainer + lab
- `web/src/lib/pitchSettings.js` — localStorage-backed pitch settings

## Pitch settings persistence

- Pitch Lab settings are saved in localStorage key `musicapp.web.pitchSettings.v1`.
- Trainer sing mode reads the same saved settings.
- Default pitch range is:
  - `minFrequencyHz = 20`
  - `maxFrequencyHz = 800`

## Run

From repository root:

- Install root deps: `npm install`
- Install web deps (first time): `npm install --prefix web`
- Start dev server: `npm run web:dev`
- Build: `npm run web:build`
- Preview build: `npm run web:preview`

## VS Code launch

Use Run and Debug profile:

- `Web App: Full Launch`

This starts Vite and opens the browser debugger.
