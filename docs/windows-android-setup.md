# Windows Android Setup Checklist (VS Code + Expo Dev Build)

Use this checklist to run and debug the app on an Android emulator when you do not have a physical Android device.

## 1) Install prerequisites

- [ ] Install **Node.js LTS** (includes npm).
- [ ] Install **Android Studio**.
- [ ] Install **VS Code**.
- [ ] In VS Code, install extensions:
  - [ ] `expo.vscode-expo-tools`
  - [ ] `msjsdiag.vscode-react-native`
  - [ ] `dbaeumer.vscode-eslint`
  - [ ] `esbenp.prettier-vscode`

## 2) Install Android SDK components (Android Studio)

Open Android Studio → **More Actions** → **SDK Manager**:

- [ ] **SDK Platforms** tab:
  - [ ] Install one recent platform (recommended: Android 14 / API 34)
- [ ] **SDK Tools** tab:
  - [ ] Android SDK Build-Tools
  - [ ] Android SDK Platform-Tools
  - [ ] Android Emulator
  - [ ] Android SDK Command-line Tools (latest)

Apply and finish installation.

## 3) Create emulator (AVD)

Open Android Studio → **More Actions** → **Virtual Device Manager**:

- [ ] Create device (e.g., Pixel 7)
- [ ] Select system image (x86_64 recommended, API 34+)
- [ ] Finish and verify emulator boots successfully

## 4) Set Windows environment variables

Set `ANDROID_HOME` to your SDK path, usually:

- `C:\Users\<your-user>\AppData\Local\Android\Sdk`

Add these to `Path`:

- `%ANDROID_HOME%\platform-tools`
- `%ANDROID_HOME%\emulator`
- `%ANDROID_HOME%\cmdline-tools\latest\bin`

After saving env vars:

- [ ] Restart terminal/VS Code
- [ ] Verify:
  - `adb --version`
  - `emulator -version`

## 5) Project setup

From project root (`MusicApp`):

- [ ] `npm install`
- [ ] `npm run typecheck`

## 6) Build and run Android dev client

Important: this app uses native modules for singing pitch detection, so use a **dev build** (not Expo Go).

- [ ] Start emulator first (from Android Studio Device Manager)
- [ ] Run: `npm run android`
  - Builds native app and installs it on emulator

## 7) Start Metro for dev client

In a separate terminal:

- [ ] `npm run start:dev`
- [ ] If needed, press `a` in Metro terminal to target Android

## 8) Debug from VS Code

Use launch configs in `.vscode/launch.json`:

- [ ] `Expo: Start Dev Server`
- [ ] `Expo: Build/Run Android Dev Client`
- [ ] `Expo: Android Full Start` (compound)

General debugging:

- [ ] Set breakpoints in TS/TSX files
- [ ] Use Debug Console + terminal logs
- [ ] Use React Native Dev Menu in emulator (`Ctrl+M`) for reload/dev options

## 9) Smoke-test checklist (this app)

- [ ] Open app and enter a lesson from library
- [ ] Verify replay icon replays current chunk
- [ ] Verify options accordion updates and persists values
- [ ] Verify solfege multi-octave input works
- [ ] Verify 2-octave piano input works
- [ ] Verify singing mode mic starts and shows detected Hz/MIDI/cents
- [ ] Verify progress stats appear in lesson library after attempts

## 10) Common issues and fixes

### `adb` not found
- Confirm `%ANDROID_HOME%\platform-tools` is in Path.
- Restart terminal and VS Code.

### No emulator detected
- Start AVD manually from Android Studio Device Manager.
- Run `adb devices` and confirm emulator appears.

### Build fails with SDK/Gradle errors
- Re-open Android Studio once; let it install missing SDK/build tools.
- Ensure Android SDK Command-line Tools are installed.

### App installs but can’t connect to Metro
- Keep `npm run start:dev` running.
- In emulator, ensure network is on.
- Try reloading from Dev Menu.

### Singing mode not working in Expo Go
- Expected. Use dev build with `npm run android` + `npm run start:dev`.
