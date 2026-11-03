# Setting up your own computer to work on Call Clips

You need this once. Afterwards you can change the app and publish updates
from your terminal, with or without Claude Code.

## 1. Install the tools

- **Git**: https://git-scm.com/downloads
- **Node.js 20 or newer**: https://nodejs.org (LTS version)
- **Claude Code** (optional): follow https://docs.claude.com/en/docs/claude-code
  and sign in with your Claude account.

Check in a terminal: `git --version`, `node --version`.

## 2. Put the code on GitHub (first time only)

If the repository on GitHub is still empty:

```
# unzip call-assistant-source.zip, then in that folder:
git init -b main
git add -A
git commit -m "Call Clips 1.6.0"
git remote add origin https://github.com/chilaa/call-assistant.git
git push -u origin main
```

When Git asks for a login, use your GitHub username and a **personal access
token** as the password (GitHub → Settings → Developer settings →
Personal access tokens → Fine-grained → only this repository →
Contents: Read and write). On Windows, Git may instead open a browser window
to sign in; that works too.

If the repository already has the code, just clone it:

```
git clone https://github.com/chilaa/call-assistant.git
cd call-assistant
```

## 3. Install the project's packages

```
npm install
```

## 4. Make a change

Open the folder in your terminal. With Claude Code: run `claude`, then
describe the change. Claude Code reads CLAUDE.md and DOCS.md and knows the
project. Without Claude Code: edit the files in `src/`.

Try it: `npm start` opens the app on your computer.

## 5. Publish the change

```
# 1. raise "version" in package.json, for example 1.6.0 -> 1.6.1
npm run release -- "What changed"
git add -A
git commit -m "Release 1.6.1"
git push
```

Within a few minutes the app on the laptop shows a green bar
"Version 1.6.1 is ready" and restarts into it when clicked.

## Everyday

```
git pull            # get the latest code first
...make changes...
npm test            # must pass
npm run release -- "What changed"
git add -A && git commit -m "Release x.y.z" && git push
```

## If something goes wrong

- The laptop keeps working: a bad update is skipped automatically and the
  built-in version runs. Fix the code, raise the version again, publish.
- Fresh install on a laptop: `dist/Call-Clips-Windows.zip` after
  `npm run release`, unzip, run `Call Clips.exe`.
- The app reads `updates/latest.json` from the `main` branch; keep publishing
  to `main`.
