// Downloads new versions of the app's code from the project's GitHub page.
// Only the small code file changes; the Electron runtime stays as installed.
const { app, net } = require('electron');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const BASE = process.env.CALL_CLIPS_UPDATE_URL
  || 'https://raw.githubusercontent.com/chilaa/call-assistant/main/updates/';
const dir = path.join(app.getPath('userData'), 'updates');

function newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

const readJson = async (file, fallback) => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
};

// Electron treats ".asar" paths as folders, so plain file work on them
// happens with that feature switched off for a moment.
async function plainFs(fn) {
  const was = process.noAsar;
  process.noAsar = true;
  try { return await fn(); } finally { process.noAsar = was; }
}

async function fetchJson(url) {
  const response = await net.fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchBytes(url) {
  const response = await net.fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// Returns { status, version, notes }. status is 'upToDate', 'ready' or 'skipped'.
async function check(runningVersion) {
  const info = await fetchJson(`${BASE}latest.json`);
  if (!info.version || !info.file || !info.sha256) throw new Error('Bad update file');
  if (!newer(info.version, runningVersion)) return { status: 'upToDate', version: runningVersion };

  const failed = await readJson(path.join(dir, 'failed.json'), []);
  if (failed.includes(info.version)) return { status: 'skipped', version: info.version };

  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, `app-${info.version}.asar`);
  const current = await readJson(path.join(dir, 'current.json'), null);
  const already = current && current.version === info.version
    && await plainFs(() => fs.access(target).then(() => true, () => false));
  if (!already) {
    const bytes = await fetchBytes(`${BASE}${info.file}`);
    if (sha256(bytes) !== info.sha256) throw new Error('The downloaded file is damaged');
    const temp = path.join(dir, `app-${info.version}.download`);
    await plainFs(async () => {
      await fs.writeFile(temp, bytes);
      await fs.rename(temp, target);
    });
    await fs.writeFile(path.join(dir, 'current.json'), JSON.stringify({ version: info.version, file: target }, null, 2));
  }
  return { status: 'ready', version: info.version, notes: info.notes || '' };
}

// Called once the app has started properly, so the loader trusts this version.
async function markStarted() {
  await fs.unlink(path.join(dir, 'starting.json')).catch(() => {});
}

module.exports = { check, markStarted, newer };
