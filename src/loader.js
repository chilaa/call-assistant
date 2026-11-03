// Starts the newest downloaded version of the app, or the built-in one.
// If a downloaded version failed to start last time, it is skipped.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const bundled = require('../package.json').version;
const dir = path.join(app.getPath('userData'), 'updates');
const startingFile = path.join(dir, 'starting.json');
const currentFile = path.join(dir, 'current.json');
const failedFile = path.join(dir, 'failed.json');

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const writeJson = (file, data) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

function newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

function pickUpdate() {
  const starting = readJson(startingFile, null);
  if (starting) {
    // The app never reported a clean start, so that version is not used again.
    const failed = readJson(failedFile, []);
    if (!failed.includes(starting.version)) writeJson(failedFile, [...failed, starting.version]);
    try { fs.unlinkSync(startingFile); } catch { /* Nothing to remove. */ }
    try { fs.unlinkSync(currentFile); } catch { /* Nothing to remove. */ }
    return null;
  }
  const current = readJson(currentFile, null);
  if (!current || !newer(current.version, bundled)) return null;
  const failed = readJson(failedFile, []);
  if (failed.includes(current.version)) return null;
  const main = path.join(current.file, 'src', 'main.js');
  if (!fs.existsSync(main)) return null;
  return { ...current, main };
}

const update = pickUpdate();
if (update) {
  writeJson(startingFile, { version: update.version });
  require(update.main);
} else {
  require('./main.js');
}
