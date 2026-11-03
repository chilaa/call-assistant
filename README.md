# Call Clips

A small Windows app for phone interviewers. Record each question once, then play it into the call with a button or a keyboard shortcut. Works with the free VB-Cable driver.

## Install

1. Download `Call-Clips-Windows.zip` from the latest message in the chat, or build it with `npm run build:win`.
2. Unzip it and open `Call Clips.exe`.
3. If Windows shows a blue warning, click **More info**, then **Run anyway**.

The app updates its own code automatically from the `updates/` folder of this repository. The Electron runtime only changes with a new zip.

## Documents

- `DOCS.md`: what the app is and how everything works.
- `SETUP.md`: setting up a computer to change and publish the app.
- `CLAUDE.md`: notes for Claude Code.

## Develop

```
npm install
npm start          # run the app
npm test           # run the checks
scripts/publish.sh "What changed"   # build, update updates/, push
```

Clips are saved in `Documents\Call Clips`.
