const { contextBridge, ipcRenderer } = require('electron');

const call = (name) => (...args) => ipcRenderer.invoke(name, ...args);
const names = [
  'load', 'saveSettings', 'setKeys', 'setClipKeys', 'setShortcutsOn', 'pauseKeys', 'addShortcuts', 'checkUpdates', 'restartApp',
  'setPad', 'padState', 'padReady', 'padPlay', 'padAction', 'padOnTop', 'setOnTop',
  'getTopic', 'createTopic', 'renameTopic', 'deleteTopic', 'openFolder', 'openCableSite', 'openSoundSettings',
  'saveClip', 'replaceClip', 'importClips', 'readClip', 'updateClip', 'setOrder', 'saveLayout', 'deleteClip', 'moveClip',
];

const api = {};
for (const name of names) api[name] = call(name);
api.onHotkey = (handler) => ipcRenderer.on('hotkey', (_event, action) => handler(action));
api.onUpdateReady = (handler) => ipcRenderer.on('updateReady', (_event, info) => handler(info));
api.onPadClosed = (handler) => ipcRenderer.on('padClosed', () => handler());
api.onPadState = (handler) => ipcRenderer.on('padState', (_event, state) => handler(state));

contextBridge.exposeInMainWorld('callClips', api);
