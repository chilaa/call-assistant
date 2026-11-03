# Call Clips: documentation

## What it is

Call Clips is a small Windows program for people who make many similar phone
calls, such as survey interviewers. The interviewer records each part of the
call once (the introduction, each question, the goodbye). During a call she
presses a button or a keyboard shortcut, and the person on the phone hears the
recording as if she were saying it. Her own voice still works in between.

It costs nothing. It uses the free **VB-Cable** driver from vb-audio.com to
get sound into the call.

## What it does

- **Topics.** Each research topic has its own set of clips. Switch topics at
  the top of the window.
- **Record in the app.** Press *Record new clip*, read the text, listen, save.
  The recording is saved exactly as recorded, as a WAV file in
  `Documents\Call Clips\<topic>`.
- **Board.** Each clip is a big button. Drag buttons anywhere. Drag the round
  dot under a button onto another button to draw an arrow. Arrows decide what
  *Play next* plays. If a question has several arrows (different answers lead
  to different questions), the app asks you to click the right one.
- **Always use.** Clips in the right-hand list appear in every topic.
- **Trim.** *Trim the ends* in a clip's ⋯ menu marks where the clip starts
  and stops. The file is not changed, so *Reset to full clip* undoes it.
- **Skip quiet start.** Recordings usually begin with a short pause. The app
  skips it when playing. Turn this off in Settings if you prefer.
- **Shortcuts.** Ctrl+1 to Ctrl+9 play clips 1 to 9 (the main key can be
  changed). Each clip can also get its own shortcut in its ⋯ menu. Play next,
  Repeat, Stop and New call have shortcuts too. Shortcuts work in every
  program while the app is running. The *Shortcuts* switch turns them off.
- **Small pad.** A separate little window with the question buttons, which
  stays on top of other windows. Resize and move it as you like.
- **Setup check.** Tests the sound setup in about 10 seconds and says what to
  fix.
- **Two sound modes.** With VB-Cable (clean sound) or without it (clips play
  out loud from the speaker and the mic picks them up; weaker sound).
- **Languages and themes.** English and Georgian, light and dark.
- **Automatic updates.** The app downloads new code from this repository.

## How the sound works (VB-Cable mode)

```
headset mic ──(Windows "Listen to this device")──▶ CABLE Input ──▶ CABLE Output ──▶ dialing program
clips from the app ────────────────────────────────▶ CABLE Input
clips from the app ────────────────────────────────▶ headset (so she hears them too)
```

Windows settings needed once:

1. Install VB-Cable (run its installer as administrator, then restart).
2. Sound settings, *Recording* tab: set **CABLE Output** as *Default Device*
   and *Default Communication Device*.
3. *Playback* tab: keep the headset as the default.
4. Headset mic → *Properties* → *Listen* tab: tick **Listen to this device**,
   and choose **CABLE Input** under *Playback through this device*.
5. In the app, press **Check setup**.

Because Windows carries the voice, calls keep working when the app is closed.
(Settings has an advanced option to let the app carry the voice instead; then
*Listen to this device* must be off.)

## Install on a laptop

1. Unzip `Call-Clips-Windows.zip` and keep all files together.
2. Open `Call Clips.exe`. If Windows shows a blue warning, click *More info*,
   then *Run anyway*.
3. Settings → *Add to Desktop and Start menu* for a normal app icon.

## How updates work

The zip contains two parts:

- the **Electron runtime** (about 150 MB), which almost never changes;
- the **app code**, one file `resources\app.asar` (about 200 KB).

When the app starts, and every 4 hours, it reads
`updates/latest.json` from this repository (through
`https://raw.githubusercontent.com/chilaa/call-assistant/main/updates/`).
If the version there is newer than the running one, it downloads the listed
`app-<version>.asar`, checks its SHA-256, saves it under
`%APPDATA%\call-clips\updates\`, and shows a green bar: *Version X is ready,
click to restart*. The next start uses the new file.

Safety: if a downloaded version crashes before it fully starts, the app
writes it to `failed.json`, ignores it, and runs the built-in version. The
Settings page shows the running version and has *Check for updates*.

## Publishing an update (manual, no Claude needed)

You need Node.js 20 or newer on any computer, and Git or just a browser.

1. Get the code: `git clone https://github.com/chilaa/call-assistant.git`
   (or download the ZIP from GitHub and unzip it).
2. In that folder run `npm install` once.
3. Make your change in `src/`.
4. Open `package.json` and raise `"version"`, for example `1.6.0` → `1.6.1`.
   The app only installs versions that are higher than the one it runs.
5. Run `npm run release -- "What changed"`. This does everything:
   - runs the checks and builds the app,
   - writes `updates/app-<version>.asar` and `updates/latest.json`,
   - makes `dist/Call-Clips-Windows.zip` (the full app, for new laptops),
   - commits and pushes to `main` — this is the moment every laptop gets it,
   - uploads the zip to a GitHub Release (needs `gh auth login` once).
   It stops if the version was not raised, or if you are not on `main`.
   Use `npm run release -- --no-push "What changed"` to only build.
6. Within a few hours every running laptop downloads the update and offers a
   restart (it checks on start and every 4 hours).

New laptops download the full app here, always the newest version:
https://github.com/chilaa/call-assistant/releases/latest/download/Call-Clips-Windows.zip
The zip is never put in git itself; it is too big (GitHub refuses files over
100 MB, and every copy would stay in the history forever).

Without the `gh` tool you can push by hand and upload the zip on
github.com → Releases → *Draft a new release*.

Only put files there that were built from this code. `latest.json` must
contain the exact SHA-256 of the `.asar`, or the app will refuse it.

### If the Electron runtime must change

Rare (new Electron version, new icon in the .exe). Release as usual, then on
each laptop install the new zip from the download link above by hand. Clips and settings stay, because they live in `Documents\Call Clips`.

### Build details

- `npm start` runs the app for development (on Windows, with real sound).
- `npm test` runs the logic checks. `test/e2e*.js` run the real app with a
  fake microphone (Linux: `xvfb-run -a node test/e2e3.js`).
- `test/make-icon.js` regenerates `assets/icon.ico` from `assets/icon.svg`.
- The Windows build downloads Electron from GitHub the first time.

## Files

```
src/loader.js      picks the newest downloaded code, falls back to built-in
src/main.js        windows, shortcuts, files, the pad, update checks
src/updater.js     downloads and verifies updates
src/app.js         the main screen
src/pad.js/html    the small pad window
src/store.js       topics and clips on disk
src/audio-utils.js sound helpers and the setup-check rules
src/board.js       board layout and arrows
src/i18n.js        all words, English and Georgian
updates/           latest.json and the code files the app downloads
scripts/           release helpers
```

Data: `Documents\Call Clips\<topic>\topic.json` + WAV files,
`Documents\Call Clips\settings.json`, downloaded updates in
`%APPDATA%\call-clips\updates`.
