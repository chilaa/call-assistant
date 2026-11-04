const { app, BrowserWindow, Menu, dialog, globalShortcut, ipcMain, session, shell } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { createStore } = require('./store');
const updater = require('./updater');

const VERSION = require('../package.json').version;

// The app sits behind the dialing program, so sound and keys must keep working there.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

const DEFAULT_SETTINGS = {
  mode: 'cable', micId: '', headsetId: '', callId: '', speakerId: '',
  lang: 'en', theme: 'light', checkedKey: '', shortcutsOn: true, skipQuietStart: true, mixMic: false, autoUpdate: true, sideOpen: false,
  pad: { open: false, onTop: true, width: 260, height: 420, x: undefined, y: undefined }, clipModifier: 'Control', volume: 1, muteMicDuringClip: true, onTop: false, lastTopic: '',
  keys: {
    next: 'Control+Space',
    repeat: 'Control+Shift+Space',
    stop: 'Control+0',
    newCall: 'Control+Shift+N',
  },
};

let win = null;
let updateReady = null;
let pad = null;
let padState = null;
let padSaveTimer = null;
let store = null;
let settingsFile = '';
let settings = DEFAULT_SETTINGS;
let lastKeys = DEFAULT_SETTINGS.keys;
let lastClipKeys = [];

async function loadSettings() {
  try {
    const saved = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
    return { ...DEFAULT_SETTINGS, ...saved, keys: { ...DEFAULT_SETTINGS.keys, ...saved.keys }, pad: { ...DEFAULT_SETTINGS.pad, ...saved.pad } };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(change) {
  settings = { ...settings, ...change };
  const temp = settingsFile + '.tmp';
  await fs.writeFile(temp, JSON.stringify(settings, null, 2));
  await fs.rename(temp, settingsFile);
  return settings;
}

// Returns the keys Windows refused, usually because another program uses them.
function registerKeys(keys) {
  lastKeys = keys;
  globalShortcut.unregisterAll();
  const failed = [];
  if (!settings.shortcutsOn) return failed;
  const add = (accelerator, action) => {
    let ok = false;
    try {
      ok = globalShortcut.register(accelerator, () => sendAction(action));
    } catch { /* Reported below. */ }
    if (!ok) failed.push(accelerator);
  };
  for (const [action, accelerator] of Object.entries(keys)) add(accelerator, action);
  for (const { key, clipId } of lastClipKeys) add(key, `clip:${clipId}`);
  return failed;
}

const iconPath = () => (app.isPackaged
  ? path.join(process.resourcesPath, 'icon.ico')
  : path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'));

function sendAction(action) {
  if (win) win.webContents.send('hotkey', action);
}

function savePadBounds() {
  if (!pad) return;
  const { x, y, width, height } = pad.getBounds();
  clearTimeout(padSaveTimer);
  padSaveTimer = setTimeout(() => saveSettings({ pad: { ...settings.pad, x, y, width, height } }), 300);
}

function createPad() {
  if (pad) {
    pad.show();
    return;
  }
  const { pad: saved } = settings;
  pad = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    minWidth: 160,
    minHeight: 140,
    title: 'Call Clips pad',
    icon: iconPath(),
    autoHideMenuBar: true,
    alwaysOnTop: Boolean(saved.onTop),
    skipTaskbar: false,
    backgroundColor: settings.theme === 'dark' ? '#10151F' : '#EDF0F7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  pad.loadFile(path.join(__dirname, 'pad.html'));
  pad.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  pad.on('resize', savePadBounds);
  pad.on('move', savePadBounds);
  pad.on('closed', () => {
    pad = null;
    saveSettings({ pad: { ...settings.pad, open: false } });
    if (win) win.webContents.send('padClosed');
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 860,
    minWidth: 640,
    minHeight: 560,
    title: 'Call Clips',
    icon: iconPath(),
    autoHideMenuBar: true,
    backgroundColor: '#EDF0F7',
    alwaysOnTop: Boolean(settings.onTop),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => {
    win = null;
    if (pad) pad.close();
  });
}

async function checkForUpdates(byUser) {
  if (!byUser && !settings.autoUpdate) return null;
  let result;
  try {
    result = await updater.check(VERSION);
  } catch (error) {
    console.error('Update check', error);
    result = { status: 'error', message: error.message };
  }
  if (result.status === 'ready') {
    updateReady = result;
    if (win) win.webContents.send('updateReady', result);
  }
  return byUser ? result : null;
}

// Adds shortcuts to the Desktop and the Start menu. Windows only.
function addShortcuts() {
  if (process.platform !== 'win32') return { ok: false, places: [] };
  const places = [
    app.getPath('desktop'),
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];
  const done = [];
  for (const place of places) {
    const ok = shell.writeShortcutLink(path.join(place, 'Call Clips.lnk'), 'create', {
      target: process.execPath,
      cwd: path.dirname(process.execPath),
      icon: iconPath(),
      iconIndex: 0,
      description: 'Call Clips',
    });
    if (ok) done.push(place);
  }
  return { ok: done.length === places.length, places: done };
}

function setUpIpc() {
  const handle = (name, fn) => ipcMain.handle(name, (_event, ...args) => fn(...args));
  // Changes to a topic read topic.json, change it and write it back. Doing them
  // one at a time means two quick changes can never overwrite each other.
  let writes = Promise.resolve();
  const inOrder = (fn) => (...args) => {
    const next = writes.then(() => fn(...args));
    writes = next.catch(() => {});
    return next;
  };

  handle('load', async () => {
    const topics = await store.listTopics();
    if (!topics.length) topics.push(await store.createTopic(settings.lang === 'ka' ? 'თემა 1' : 'Topic 1'));
    return {
      settings,
      topics,
      version: VERSION,
      updateReady,
      alwaysId: store.ALWAYS_ID,
      folder: store.root,
      failedKeys: registerKeys(settings.keys),
    };
  });

  handle('saveSettings', saveSettings);
  handle('setKeys', async (keys) => {
    await saveSettings({ keys });
    return registerKeys(keys);
  });
  handle('setClipKeys', (list) => {
    lastClipKeys = list;
    return registerKeys(lastKeys);
  });
  handle('setShortcutsOn', async (on) => {
    await saveSettings({ shortcutsOn: Boolean(on) });
    return registerKeys(lastKeys);
  });
  handle('addShortcuts', addShortcuts);
  handle('checkUpdates', () => checkForUpdates(true));
  handle('restartApp', () => {
    app.relaunch();
    app.exit(0);
  });
  handle('setPad', async (open) => {
    await saveSettings({ pad: { ...settings.pad, open: Boolean(open) } });
    if (open) createPad();
    else if (pad) pad.close();
  });
  handle('padState', (state) => {
    padState = state;
    if (pad) pad.webContents.send('padState', state);
  });
  handle('padReady', () => padState);
  handle('padPlay', (clipId) => sendAction(`clip:${clipId}`));
  handle('padAction', (action) => sendAction(action));
  handle('padOnTop', async (on) => {
    if (pad) pad.setAlwaysOnTop(Boolean(on));
    await saveSettings({ pad: { ...settings.pad, onTop: Boolean(on) } });
  });
  handle('pauseKeys', (paused) => {
    if (paused) globalShortcut.unregisterAll();
    else registerKeys(lastKeys);
  });
  handle('setOnTop', async (on) => {
    if (win) win.setAlwaysOnTop(Boolean(on));
    await saveSettings({ onTop: Boolean(on) });
  });

  handle('getTopic', (id) => store.getTopic(id));
  handle('createTopic', (name) => store.createTopic(name));
  handle('renameTopic', (id, name) => store.renameTopic(id, name));
  handle('deleteTopic', async (id) => {
    if (id === store.ALWAYS_ID) throw new Error('This folder cannot be deleted');
    await shell.trashItem(store.folder(id));
  });
  handle('openFolder', (id) => shell.openPath(id ? store.folder(id) : store.root));
  handle('openCableSite', () => shell.openExternal('https://vb-audio.com/Cable/'));
  handle('openSoundSettings', () => {
    if (process.platform === 'win32') execFile('control', ['mmsys.cpl,,1']);
  });

  handle('saveClip', (topicId, name, bytes) => store.addClipFile(topicId, name, Buffer.from(bytes), '.wav'));
  handle('replaceClip', async (topicId, clipId, bytes) => {
    const { clip, oldPath } = await store.replaceClip(topicId, clipId, Buffer.from(bytes));
    await shell.trashItem(oldPath).catch(() => {});
    return clip;
  });
  handle('importClips', async (topicId, title) => {
    const result = await dialog.showOpenDialog(win, {
      title,
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'webm', 'flac'] }],
    });
    if (result.canceled) return [];
    const clips = [];
    for (const filePath of result.filePaths) {
      const ext = path.extname(filePath).toLowerCase();
      const name = path.basename(filePath, path.extname(filePath));
      clips.push(await store.addClipFile(topicId, name, await fs.readFile(filePath), ext));
    }
    return clips;
  });
  handle('readClip', async (topicId, clipId) => new Uint8Array(await store.readClip(topicId, clipId)));
  handle('updateClip', inOrder((topicId, clipId, change) => store.updateClip(topicId, clipId, change)));
  handle('setOrder', inOrder((topicId, ids) => store.setOrder(topicId, ids)));
  handle('saveLayout', inOrder((topicId, items) => store.saveLayout(topicId, items)));
  handle('deleteClip', async (topicId, clipId) => {
    await shell.trashItem(await store.removeClip(topicId, clipId)).catch(() => {});
  });
  handle('moveClip', inOrder((topicId, clipId, step) => store.moveClip(topicId, clipId, step)));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const root = process.env.CALL_CLIPS_DATA || path.join(app.getPath('documents'), 'Call Clips');
    await fs.mkdir(root, { recursive: true });
    store = createStore(root);
    settingsFile = path.join(root, 'settings.json');
    settings = await loadSettings();

    const allowMedia = (permission) => ['media', 'audioCapture', 'speaker-selection'].includes(permission);
    session.defaultSession.setPermissionRequestHandler((_c, permission, done) => done(allowMedia(permission)));
    session.defaultSession.setPermissionCheckHandler((_c, permission) => allowMedia(permission));

    setUpIpc();
    createWindow();
    if (settings.pad.open) createPad();
    await updater.markStarted();
    setTimeout(() => checkForUpdates(false), 8000);
    setInterval(() => checkForUpdates(false), 4 * 60 * 60 * 1000);
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
