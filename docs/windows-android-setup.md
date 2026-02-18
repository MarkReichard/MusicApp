# Windows Setup Guide (Beginner + VS Code First)

This guide assumes:

- You are on Windows.
- You do **not** have a physical Android phone.
- You will run and debug mainly from **VS Code**.

---

## 0) What is Expo Go vs Dev Build? (Important)

You will see two common ways to run Expo apps:

- **Expo Go** = a generic app from the Play Store. Good for simple apps.
- **Dev Build** = your own app binary built for your project.

For this project, use a **Dev Build** because singing pitch detection uses native modules that Expo Go does not include.

So in this repo, the correct flow is:

1. Build/install app once on emulator (`npm run android`)
2. Start dev server (`npm run start:dev`)
3. Debug from VS Code

---

## 1) Install required software

Install these first:

- [ ] **Node.js LTS** (includes npm)
- [ ] **Android Studio**
- [ ] **VS Code**

In VS Code, install these extensions:

- [ ] `expo.vscode-expo-tools` (primary)
- [ ] `msjsdiag.vscode-react-native` (helpful debugging)

---

## 2) Set up Android tools (inside Android Studio)

Open Android Studio → **More Actions** → **SDK Manager**.

### SDK Platforms tab

- [ ] Install one recent Android platform (recommended: Android 14 / API 34)

### SDK Tools tab

- [ ] Android SDK Build-Tools
- [ ] Android SDK Platform-Tools
- [ ] Android Emulator
- [ ] Android SDK Command-line Tools (latest)

Click **Apply** and let installation complete.

---

## 3) Create an Android emulator

Android Studio → **More Actions** → **Virtual Device Manager**:

- [ ] Create Virtual Device
- [ ] Pick a phone model (e.g., Pixel 7)
- [ ] Pick a system image (x86_64, API 34+)
- [ ] Finish and start the emulator

Leave emulator running for later steps.

---

## 4) Configure Windows environment variables

Set `ANDROID_HOME` to your SDK location (usually):

- `C:\Users\<your-user>\AppData\Local\Android\Sdk`

Add to your `Path`:

- `%ANDROID_HOME%\platform-tools`
- `%ANDROID_HOME%\emulator`
- `%ANDROID_HOME%\cmdline-tools\latest\bin`

Then restart VS Code and terminals.

Verify in terminal:

- [ ] `adb --version`
- [ ] `emulator -version`

---

## 5) Project install (in VS Code terminal)

Open this project folder in VS Code, then run:

- [ ] `npm install`
- [ ] `npm run typecheck`

If typecheck passes, continue.

---

## 6) First run (Dev Build) — exact commands

Use **two terminals** in VS Code.

### Terminal A (build/install app to emulator)

- [ ] Ensure emulator is already running.
- [ ] Run: `npm run android`

What this does:

- Builds Android app for this project
- Installs it on emulator

This may take several minutes the first time.

### Terminal B (start development server)

- [ ] Run: `npm run start:dev`

Keep this terminal running while debugging.

---

## 7) Debugging in VS Code (primary workflow)

Important clarification:

- Steps **5–6** and Step **7** are two ways to do the same startup actions.
- For day-to-day use, choose **one** of these paths:
	- **Path A (manual):** run commands in terminals (Steps 5–6)
	- **Path B (VS Code UI):** use Run and Debug configs (Step 7)

In other words, for actual debugging startup this is **either/or**, not both.

This repo includes `.vscode/launch.json`.

Open **Run and Debug** panel in VS Code and use:

- `Expo: Start Dev Server`
- `Expo: Build/Run Android Dev Client`
- or `Expo: Android Full Start` (runs both)

Recommended beginner flow:

1. Start emulator
2. Run `Expo: Android Full Start` (instead of manually running `npm run android` + `npm run start:dev`)
3. Set breakpoints in `.tsx` files
4. Interact with app in emulator
5. Watch output in VS Code terminal + Debug Console

---

## 8) Quick test checklist

- [ ] Open a lesson from library
- [ ] Tap replay icon (should replay current chunk)
- [ ] Change tempo/chunk in options accordion
- [ ] Try solfege mode and piano mode
- [ ] Try sing mode (start mic, verify detected Hz/MIDI/cents)
- [ ] Exit lesson and confirm attempts/best score shown in library

---

## 9) Common problems (simple fixes)

### `adb` not found

- Check `%ANDROID_HOME%\platform-tools` is in `Path`
- Restart VS Code after editing env vars

### Emulator not detected

- Start emulator manually from Android Studio
- Run `adb devices` and confirm a device is listed

### Build fails with SDK/Gradle errors

- Open Android Studio once and let it install missing components
- Confirm Command-line Tools are installed in SDK Manager

### App opens but does not load JS

- Make sure `npm run start:dev` is still running
- Reload app from Android dev menu (`Ctrl+M` in emulator)

### Why not Expo Go?

- This app needs native audio/pitch modules for singing detection
- Use dev build (`npm run android`) instead of Expo Go
