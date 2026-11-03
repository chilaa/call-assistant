# Call Clips — notes for Claude Code

Small Electron app (Windows) for phone interviewers: record each question
once, play it into the call with a button or shortcut. Read DOCS.md for the
full picture. Keep the language in the app and in replies simple.

## Commands

- `npm install` — once after cloning.
- `npm start` — run the app (on Windows you get real sound devices).
- `npm test` — logic tests (`test/logic.test.js`). Always run before a release.
- `node test/e2e3.js` etc. — run the real app with a fake mic
  (on Linux prefix with `xvfb-run -a`). Needs Playwright; optional.
- `npm run release -- "What changed"` — builds, writes
  `updates/app-<version>.asar` + `updates/latest.json` and
  `dist/Call-Clips-Windows.zip`, then commits, pushes to `main` and uploads
  the zip as a GitHub Release (`gh`). `--no-push` only builds.

## Releasing an update

1. Raise `"version"` in `package.json` (the app only installs higher numbers).
2. `npm run release -- "What changed"` (commits and pushes for you).
3. The laptops read `updates/latest.json` from the `main` branch on
   raw.githubusercontent.com and update themselves within minutes.
   New laptops download the zip from
   `https://github.com/chilaa/call-assistant/releases/latest/download/Call-Clips-Windows.zip`.
4. Never edit `updates/latest.json` by hand; the sha256 must match the file.

## Rules that matter

- Recordings are saved exactly as recorded. Never change or re-encode a WAV
  file; trimming only stores start/end times on the clip (`trimStart`,
  `trimEnd` in `topic.json`).
- Every word shown to the user lives in `src/i18n.js`, in both `en` and `ka`.
  The test "every word exists in both languages" fails otherwise.
- `src/loader.js` must stay tiny and must never throw: it is what keeps a
  broken update from trapping the app.
- Sound routing lives in `src/app.js` (`setUpSound`, `connectOutputs`,
  `setMicGate`). Default mode: the app sends only clips into CABLE Input;
  Windows carries the voice via "Listen to this device". The advanced
  `mixMic` setting lets the app carry the voice instead.
- Global shortcuts are registered in `src/main.js` (`registerKeys`); clip
  shortcuts come from `clipShortcuts()` in `src/audio-utils.js`.
- The renderer is sandboxed; everything it needs goes through
  `src/preload.js` (add the name to the `names` list) and an
  `ipcMain.handle` in `src/main.js`.

## Layout

```
src/loader.js   src/main.js   src/updater.js   src/preload.js
src/app.js      src/index.html   src/style.css
src/pad.js      src/pad.html     src/pad.css
src/store.js    src/audio-utils.js   src/board.js   src/i18n.js
assets/icon.svg → test/make-icon.js → assets/icon.ico, icon.png
updates/        scripts/make-update.js   test/
```
