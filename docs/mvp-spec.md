# Music Ear Training App — MVP Spec (React Native)

## Product Scope

Build a mobile ear-training app with data-driven lesson types and pitch-only validation.

### Required lesson types
- `3_note_pattern`
- `christmas_songs`

### Core behavior
- App plays notes using synthesized piano audio.
- User reproduces notes via:
  - Solfege grid (multi-octave)
  - Piano (2 octaves)
  - Singing (pitch detection)
- Correctness is based on pitch only.
- Wrong note shows visual error and does not advance.
- Correct note advances immediately.
- User can always replay the current note set/chunk using an icon button (circular-arrow refresh style).

## Primary Screens

### 1) Lesson Library
- Group by `category` (lesson type) from lesson JSON.
- Secondary grouping/filter by `difficulty`.
- Show `name` as display title.

### 2) Trainer Screen
Single screen for practice and lesson customization.

#### Header
- Left: lesson name
- Right: replay icon button (refresh-circle style)
- Replay action: replay current chunk from start; keep progress state unchanged.

#### Progress
- `Set X / Y`
- `Note A / B`
- Linear lesson progress bar

#### Status Feedback
- States: `waiting`, `correct`, `wrong`
- Wrong = visible error state
- Correct = visible success state + auto-advance

#### Input Mode Switcher
- Modes: `solfege`, `piano`, `sing`

#### Solfege UI (TonicSense-style behavior)
- Multiple octaves visible simultaneously.
- Grid structure:
  - Columns: `Do Re Mi Fa Sol La Ti`
  - Rows/Lanes: octaves (e.g., 3, 4, 5)
- Each button maps to a concrete pitch (`Do4`, `Re5`, etc.).
- Must support expanding visible octaves.
- Keep expected note visible via auto-expand/auto-scroll when needed.

#### Piano UI
- 2-octave keyboard visible.

#### Singing UI
- Mic toggle
- Detected pitch + cents offset display
- Tolerance default ±15 cents, configurable by user.

#### Lesson Options (Accordion on Trainer Screen)
- Key
- Tempo BPM
- Notes per set/chunk
- Input mode default (for this lesson)
- Octave preferences/visibility
- Singing tolerance (cents)
- Save per-lesson override
- Reset to global defaults

## Persistence
- Local-only for MVP.
- Persist:
  - Global defaults (`tempo`, `chunkSize`, `inputMode`, `toleranceCents`, octave visibility)
  - Per-lesson overrides
  - Progress snapshot

## Content Loading
- Preload lessons from bundled JSON.
- Support refresh from web service:
  - Download updated lesson JSON files
  - Cache locally
  - Keep preloaded data as fallback

## Testing & Debug on PC (Windows)
- Preferred stack: Expo + Android emulator.
- For singing tests, use a physical Android device for reliable mic behavior.
