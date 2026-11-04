/* global CCAudio, CCBoard, CCWords */
const api = window.callClips;
const {
  encodeWav, leadIn, playRange, setupChecks, clipShortcuts, chooseDevices, formatTime, keyFromEvent, showKey, peakOf,
} = CCAudio;
const { readingOrder, placeMissing, settle, nextChoices, arrowPath } = CCBoard;
const $ = (id) => document.getElementById(id);

let t = CCWords.make('en');

const state = {
  settings: null,
  alwaysId: '',
  topics: [],
  topic: null,
  always: null,
  cursor: -1,             // Index of the last clip played from the topic.
  played: new Set(),
  lastItem: null,
  current: null,          // The clip playing right now.
  recording: false,
  checking: false,
  buffers: new Map(),
  shortcuts: new Map(),
  sentKeys: '',
  dragging: null,
  skipClick: false,
  leadIns: new WeakMap(),
  padOpen: false,
  devices: null,
  lastPressAt: 0,
  version: '',
  update: null,
};

const audio = {
  ctx: null,
  callBus: null,          // Everything the person on the phone hears.
  clipBus: null,
  headCtx: null,          // A second, direct sound path to her headset.
  headsetBus: null,       // Everything she hears in her headset.
  outputsKey: '',
  micGate: null,
  analyser: null,
  micStream: null,
  micSource: null,
  micOk: false,
  callOk: false,
  headsetOk: false,
};

const usesCable = () => state.settings.mode !== 'speaker';
// True when the app itself carries her voice into the call.
const mixesMic = () => usesCable() && Boolean(state.settings.mixMic);
const listFor = (topicId) => (topicId === state.alwaysId ? state.always.clips : state.topic.clips);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- Sound ---------- */

function setUpSound() {
  const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
  audio.ctx = ctx;
  audio.callBus = ctx.createGain();
  audio.callBus.gain.value = 0;     // Stays silent until the output is confirmed.
  audio.callBus.connect(ctx.destination);

  audio.clipBus = ctx.createGain();
  audio.clipBus.gain.value = state.settings.volume;
  audio.clipBus.connect(audio.callBus);

  // The headset gets its own sound path, which starts faster than a
  // stream player would.
  audio.headCtx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
  audio.headsetBus = audio.headCtx.createGain();
  audio.headsetBus.gain.value = state.settings.volume;
  audio.headsetBus.connect(audio.headCtx.destination);

  audio.micGate = ctx.createGain();
  audio.micGate.gain.value = 0;     // Her voice must never reach a speaker.
  audio.micGate.connect(audio.callBus);
  audio.analyser = ctx.createAnalyser();
  audio.analyser.fftSize = 1024;

  ctx.resume();
  audio.headCtx.resume();
}

const micOptions = (deviceId) => ({
  audio: {
    deviceId: { exact: deviceId },
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
});

async function connectMic(deviceId) {
  if (audio.micStream) audio.micStream.getTracks().forEach((track) => track.stop());
  if (audio.micSource) audio.micSource.disconnect();
  audio.micStream = null;
  audio.micSource = null;
  audio.micOk = false;
  if (!deviceId) return;
  try {
    audio.micStream = await navigator.mediaDevices.getUserMedia(micOptions(deviceId));
    audio.micSource = audio.ctx.createMediaStreamSource(audio.micStream);
    audio.micSource.connect(audio.micGate);
    audio.micSource.connect(audio.analyser);
    audio.micOk = true;
  } catch (error) {
    console.error('Microphone', error);
  }
}

async function connectOutputs({ callId, speakerId, headsetId }) {
  const outputId = usesCable() ? callId : speakerId;
  audio.callOk = false;
  audio.headsetOk = false;
  audio.micGate.gain.value = 0;
  audio.callBus.gain.value = 0;
  // Without the cable, a shared device would otherwise play each clip twice.
  audio.headsetBus.gain.value = !usesCable() && outputId === headsetId ? 0 : state.settings.volume;
  if (outputId) {
    try {
      await audio.ctx.setSinkId(outputId);
      audio.callBus.gain.value = 1;
      audio.callOk = true;
    } catch (error) {
      console.error('Call sound', error);
    }
  }
  if (headsetId) {
    try {
      await audio.headCtx.setSinkId(headsetId);
      audio.headsetOk = true;
      audio.headCtx.resume();
    } catch (error) {
      console.error('Headset', error);
    }
  }
  setMicGate();
}

// First asks for the mic, because Windows hides device names until then.
async function refreshDevices() {
  try {
    const first = await navigator.mediaDevices.getUserMedia({ audio: true });
    first.getTracks().forEach((track) => track.stop());
  } catch (error) {
    console.error('Mic permission', error);
  }
  const list = await navigator.mediaDevices.enumerateDevices();
  const picked = chooseDevices(list, state.settings);
  const oldMicId = state.devices && state.devices.micId;
  state.devices = picked;

  if (oldMicId !== picked.micId || !audio.micOk) await connectMic(picked.micId);
  const outputsKey = [state.settings.mode, picked.callId, picked.speakerId, picked.headsetId].join('|');
  if (outputsKey !== audio.outputsKey || !audio.callOk || !audio.headsetOk) {
    audio.outputsKey = outputsKey;
    await connectOutputs(picked);
  }
  fillDeviceLists();
  renderHealth();
}

const setupKey = () => `${audio.outputsKey}|${state.devices ? state.devices.micId : ''}`;

function renderHealth() {
  const banner = $('banner');
  let text = '';
  banner.dataset.action = 'settings';
  if (usesCable() && (!state.devices || !state.devices.callId)) {
    text = t('bannerNoCable');
    banner.dataset.action = 'check';
  } else if (!audio.callOk) {
    text = usesCable() ? t('bannerCall') : t('bannerSpeaker');
  } else if (!audio.micOk) {
    text = mixesMic() ? t('bannerMic') : t('bannerMicPlain');
  } else if (!audio.headsetOk) {
    text = t('bannerHeadset');
  }
  banner.textContent = text;
  banner.hidden = !text;

  const ready = state.settings.checkedKey && state.settings.checkedKey === setupKey();
  $('checkBtn').textContent = ready ? `✓ ${t('setupReady')}` : t('checkSetup');
  $('checkBtn').classList.toggle('good', Boolean(ready));
}

function setMicGate() {
  const off = !mixesMic() || state.recording || state.checking
    || (state.current && state.settings.muteMicDuringClip);
  audio.micGate.gain.setTargetAtTime(off ? 0 : 1, audio.ctx.currentTime, 0.01);
}

async function bufferFor(topicId, clip) {
  const key = `${topicId}/${clip.id}/${clip.file}`;
  if (state.buffers.has(key)) return state.buffers.get(key);
  const bytes = await api.readClip(topicId, clip.id);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const buffer = await audio.ctx.decodeAudioData(copy);
  state.buffers.set(key, buffer);
  return buffer;
}

async function stopClip() {
  const current = state.current;
  if (!current) return;
  state.current = null;
  current.source.onended = null;
  for (const voice of current.voices) {
    const now = voice.ctx.currentTime;
    voice.fade.gain.cancelScheduledValues(now);
    voice.fade.gain.setTargetAtTime(0, now, 0.008);
    voice.source.stop(now + 0.04);
  }
  setMicGate();
  renderAll();
}

// Where a clip starts and stops when played. A manual trim wins; otherwise
// the quiet start can be skipped. The file is never changed either way.
function effectiveRange(clip, buffer) {
  const range = playRange(clip, buffer.duration);
  if (clip.trimStart === undefined && state.settings.skipQuietStart) {
    if (!state.leadIns.has(buffer)) state.leadIns.set(buffer, leadIn(buffer.getChannelData(0), buffer.sampleRate));
    const skip = state.leadIns.get(buffer);
    if (skip < range.end - 0.3) range.start = Math.max(range.start, skip);
    range.length = range.end - range.start;
  }
  return range;
}

// Starts one copy of the clip on one sound path, with tiny fades at the ends.
function startVoice(ctx, destination, buffer, range) {
  const source = ctx.createBufferSource();
  const fade = ctx.createGain();
  source.buffer = buffer;
  source.connect(fade);
  fade.connect(destination);
  const now = ctx.currentTime;
  const edge = Math.min(0.005, range.length / 4);
  fade.gain.setValueAtTime(0, now);
  fade.gain.linearRampToValueAtTime(1, now + edge);
  fade.gain.setValueAtTime(1, now + range.length - edge);
  fade.gain.linearRampToValueAtTime(0, now + range.length);
  source.start(now, range.start, range.length);
  return { ctx, source, fade, startedAt: now };
}

async function playItem(item) {
  if (state.recording || state.checking) return;
  const { topicId, clip, index } = item;
  let buffer;
  try {
    buffer = await bufferFor(topicId, clip);
  } catch (error) {
    console.error(error);
    showStatus(t('cannotPlayClip', { name: clip.name }), 'problem');
    return;
  }
  if (audio.ctx.state !== 'running') await audio.ctx.resume();
  if (audio.headCtx.state !== 'running') audio.headCtx.resume();

  // Sound starts first. Redrawing the screen can wait a few milliseconds.
  const previous = state.current;
  if (previous) {
    state.current = null;
    previous.source.onended = null;
    for (const voice of previous.voices) {
      const now = voice.ctx.currentTime;
      voice.fade.gain.cancelScheduledValues(now);
      voice.fade.gain.setTargetAtTime(0, now, 0.008);
      voice.source.stop(now + 0.04);
    }
  }
  const range = effectiveRange(clip, buffer);
  const call = startVoice(audio.ctx, audio.clipBus, buffer, range);
  const head = startVoice(audio.headCtx, audio.headsetBus, buffer, range);
  const playing = { ...item, source: call.source, voices: [call, head], startedAt: call.startedAt, duration: range.length };
  call.source.onended = () => {
    if (state.current !== playing) return;
    state.current = null;
    setMicGate();
    renderAll();
  };
  state.current = playing;
  state.lastItem = item;
  state.played.add(clip.id);
  if (index !== null) state.cursor = index;
  setMicGate();
  renderAll();
}

function pressAllowed() {
  const now = performance.now();
  if (now - state.lastPressAt < 350) return false;   // Ignores a held or double-pressed key.
  state.lastPressAt = now;
  return true;
}

const topicItem = (index) => {
  const clip = state.topic && state.topic.clips[index];
  return clip ? { topicId: state.topic.id, clip, index } : null;
};
const choices = () => (state.topic ? nextChoices(state.topic.clips, state.cursor) : []);

function playNext() {
  const options = choices();
  if (options.length > 1) {
    showStatus(t('statusChoose'), 'live');
    return;
  }
  const item = topicItem(options[0]);
  if (item && pressAllowed()) playItem(item);
}
function playById(clipId) {
  const inTopic = state.topic.clips.findIndex((clip) => clip.id === clipId);
  let item = inTopic >= 0 ? topicItem(inTopic) : null;
  const always = state.always.clips.find((clip) => clip.id === clipId);
  if (!item && always) item = { topicId: state.alwaysId, clip: always, index: null };
  if (item && pressAllowed()) playItem(item);
}
function repeat() {
  if (state.lastItem && pressAllowed()) playItem(state.lastItem);
}
function newCall() {
  stopClip();
  state.cursor = -1;
  state.played.clear();
  state.lastItem = null;
  renderAll();
}
function clearDone() {
  state.played.clear();
  renderAll();
}

/* ---------- Showing things ---------- */

let statusTimer = null;
function showStatus(text, kind) {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${kind || ''}`;
  clearTimeout(statusTimer);
  if (kind === 'problem') statusTimer = setTimeout(renderStatus, 5000);
}

function renderStatus() {
  if (state.recording) return showStatus(t(mixesMic() ? 'statusRecording' : 'statusRecordingPlain'), 'live');
  if (state.current) {
    const name = t('statusPlaying', { name: state.current.clip.name });
    if (!mixesMic()) return showStatus(name, 'live');
    return showStatus(`${name} ${t(state.settings.muteMicDuringClip ? 'micOff' : 'micOn')}`, 'live');
  }
  const total = state.topic ? state.topic.clips.length : 0;
  const options = choices();
  if (options.length > 1) return showStatus(t('statusChoose'), 'live');
  if (total && !options.length) return showStatus(t('statusLast'));
  return showStatus(t(mixesMic() ? 'statusReady' : 'statusReadyPlain'));
}

const CLIP_COLORS = [
  ['', 'White'], ['#1F3FCE', 'Blue'], ['#0B7285', 'Teal'], ['#16794F', 'Green'], ['#6B3FC9', 'Purple'],
  ['#B0247A', 'Pink'], ['#B3202C', 'Red'], ['#B85300', 'Orange'], ['#4A5468', 'Gray'],
];

function clipTile(item, position, nextSet) {
  const { clip, topicId } = item;
  const li = document.createElement(item.index === null ? 'li' : 'div');
  li.className = 'clip';
  li.dataset.id = clip.id;
  const isPlaying = state.current && state.current.clip.id === clip.id;
  if (clip.color) {
    li.classList.add('colored');
    li.style.setProperty('--tile', clip.color);
    li.style.setProperty('--clip-color', clip.color);
  }
  if (isPlaying) li.classList.add('playing');
  if (item.index !== null && !state.current && nextSet.has(item.index)) li.classList.add('is-next');
  if (state.played.has(clip.id)) li.classList.add('played');

  const fill = document.createElement('div');
  fill.className = 'fill';
  li.append(fill);

  const play = document.createElement('button');
  play.className = 'play';
  play.addEventListener('click', () => {
    if (state.skipClick) return;
    if (pressAllowed()) playItem(item);
  });

  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = state.played.has(clip.id) ? '✓' : position;

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = clip.name;

  const meta = document.createElement('span');
  meta.className = 'meta';
  const time = document.createElement('span');
  meta.append(time);
  const shortcut = state.shortcuts.get(clip.id);
  if (shortcut) {
    const key = document.createElement('kbd');
    key.textContent = showKey(shortcut);
    meta.append(key);
  }
  play.append(num, name);
  if (clip.note) {
    li.classList.add('has-note');
    const note = document.createElement('span');
    note.className = 'note';
    note.textContent = clip.note;
    play.append(note);
    play.title = `${clip.name}\n${clip.note}`;
  }
  play.append(meta);

  const more = document.createElement('button');
  more.className = 'more';
  more.textContent = '⋯';
  const label = t('optionsFor', { name: clip.name });
  more.title = label;
  more.setAttribute('aria-label', label);
  more.addEventListener('click', () => openClipDialog(item));

  li.append(play, more);
  bufferFor(topicId, clip)
    .then((buffer) => { time.textContent = formatTime(effectiveRange(clip, buffer).length); })
    .catch(() => { time.textContent = t('cannotPlay'); });
  return li;
}

function renderArrows() {
  const group = $('arrowLines');
  group.replaceChildren();
  const clips = state.topic.clips;
  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  const svgPath = (className, d) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', className);
    path.setAttribute('d', d);
    return path;
  };
  for (const from of clips) {
    for (const toId of from.links || []) {
      const to = byId.get(toId);
      if (!to) continue;
      const d = arrowPath(from, to);
      const hit = svgPath('arrow-hit', d);
      hit.addEventListener('click', () => removeArrow(from, to));
      const line = svgPath('arrow', d);
      line.setAttribute('marker-end', 'url(#head)');
      group.append(hit, line);
    }
  }
}

function sizeBoard() {
  const clips = state.topic.clips;
  const board = $('board');
  board.style.width = `${Math.max(0, ...clips.map((clip) => clip.x)) + CCBoard.W + 80}px`;
  board.style.height = `${Math.max(0, ...clips.map((clip) => clip.y)) + CCBoard.H + 80}px`;
}

function renderBoard() {
  const board = $('board');
  board.querySelectorAll('.clip').forEach((el) => el.remove());
  const clips = state.topic ? state.topic.clips : [];
  const nextSet = new Set(choices());
  clips.forEach((clip, index) => {
    const item = { topicId: state.topic.id, clip, index };
    const tile = clipTile(item, index + 1, nextSet);
    tile.style.left = `${clip.x}px`;
    tile.style.top = `${clip.y}px`;

    const handle = document.createElement('button');
    handle.className = 'link-handle';
    handle.title = t('boardHint');
    handle.setAttribute('aria-hidden', 'true');
    handle.tabIndex = -1;
    handle.addEventListener('pointerdown', (e) => startArrowDrag(e, item));
    tile.append(handle);

    tile.addEventListener('pointerdown', (e) => startTileDrag(e, tile, item));
    board.append(tile);
  });
  $('emptyTopic').hidden = clips.length > 0;
  sizeBoard();
  renderArrows();
}

function renderLists() {
  if (state.dragging) return;   // Redrawing now would cancel the drag.
  renderBoard();
  const side = $('alwaysClips');
  side.replaceChildren();
  (state.always ? state.always.clips : []).forEach((clip, position) => {
    const item = { topicId: state.alwaysId, clip, index: null };
    const tile = clipTile(item, position + 1, new Set());
    makeSideDraggable(tile, item);
    side.append(tile);
  });
}

function renderControls() {
  const options = choices();
  const next = options.length === 1 ? topicItem(options[0]) : null;
  $('nextLabel').textContent = options.length > 1
    ? t('chooseNext')
    : next ? t('playNext', { name: next.clip.name }) : t('noNext');
  $('nextBtn').disabled = !next;
  $('stopBtn').disabled = !state.current;
  $('repeatBtn').disabled = !state.lastItem;
  $('clearDoneBtn').disabled = !state.played.size;
  const { keys } = state.settings;
  $('nextKey').textContent = showKey(keys.next);
  $('stopKey').textContent = showKey(keys.stop);
  $('repeatKey').textContent = showKey(keys.repeat);
  $('newCallKey').textContent = showKey(keys.newCall);
  $('cableSwitch').checked = usesCable();
  $('shortcutsSwitch').checked = Boolean(state.settings.shortcutsOn);
  $('padSwitch').checked = state.padOpen;
}

// What the small pad shows. Sent whenever the screen is redrawn.
function padClip(clip, number, index, nextSet) {
  const playing = Boolean(state.current && state.current.clip.id === clip.id);
  return {
    id: clip.id,
    number,
    name: clip.name,
    color: clip.color || '',
    playing,
    next: index !== null && !state.current && nextSet.has(index),
    played: state.played.has(clip.id),
    shortcut: showKey(state.shortcuts.get(clip.id) || ''),
    progress: playing ? Math.min(100, ((audio.ctx.currentTime - state.current.startedAt) / state.current.duration) * 100) : 0,
  };
}

function padState(progressOnly = false) {
  const options = choices();
  const next = options.length === 1 ? topicItem(options[0]) : null;
  const nextSet = new Set(options);
  return {
    progressOnly,
    theme: state.settings.theme,
    lang: state.settings.lang,
    onTop: Boolean(state.settings.pad.onTop),
    playing: Boolean(state.current),
    nextEnabled: Boolean(next),
    nextLabel: options.length > 1 ? t('chooseNext') : next ? t('playNext', { name: next.clip.name }) : t('noNext'),
    words: { title: t('padTitle'), onTop: t('padOnTop'), stop: t('stop'), always: t('always'), empty: t('padEmpty') },
    clips: (state.topic ? state.topic.clips : []).map((clip, i) => padClip(clip, i + 1, i, nextSet)),
    always: (state.always ? state.always.clips : []).map((clip, i) => padClip(clip, i + 1, null, nextSet)),
  };
}

function sendPad(progressOnly) {
  if (!state.padOpen) return;
  api.padState(padState(progressOnly));
}

function renderTopics() {
  const select = $('topicSelect');
  select.replaceChildren();
  for (const topic of state.topics) {
    const option = document.createElement('option');
    option.value = topic.id;
    option.textContent = topic.name;
    select.append(option);
  }
  if (state.topic) select.value = state.topic.id;
}

function renderAll() {
  renderLists();
  renderControls();
  renderStatus();
  sendPad(false);
  fitTexts();
}

function applyWords() {
  t = CCWords.make(state.settings.lang);
  document.documentElement.lang = state.settings.lang;
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('[data-t-title]').forEach((el) => { el.title = t(el.dataset.tTitle); });
  document.querySelectorAll('[data-t-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.tLabel)); });
  $('checkRun').textContent = t('runCheck');
  if (state.settings) renderSide();
  fitTexts();
}

// Shrinks one-line text until it fits its button, instead of wrapping.
function fitTexts() {
  $('banner').style.fontSize = '';
  document.querySelector('.top').classList.remove('wrapped');
  const targets = document.querySelectorAll(
    '.top > button, .top .switch, .toolbar > button, .small-buttons > button, .side .record, .next, .stop, .dialog-buttons > button',
  );
  for (const el of targets) {
    if (el.offsetParent === null) continue;
    const text = el.classList.contains('switch') ? el.querySelector('span:last-child') : el;
    const inner = el.classList.contains('next') || el.classList.contains('stop') ? el.querySelector('.big') : text;
    inner.style.fontSize = '';
    el.style.paddingLeft = '';
    el.style.paddingRight = '';
    let size = parseFloat(getComputedStyle(inner).fontSize);
    const fits = () => (inner === el ? el.scrollWidth <= el.clientWidth : inner.scrollWidth <= inner.clientWidth);
    while (!fits() && size > 10) {
      size -= 1;
      inner.style.fontSize = `${size}px`;
      if (size <= 13 && el.tagName === 'BUTTON') {
        el.style.paddingLeft = '6px';
        el.style.paddingRight = '6px';
      }
    }
  }
  // Only when even the smallest text cannot fit does the top bar wrap.
  const top = document.querySelector('.top');
  const crowded = [...top.children].some((el) => el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth);
  if (crowded) {
    top.classList.add('wrapped');
    for (const el of top.querySelectorAll('button, .switch span:last-child')) el.style.fontSize = '';
    for (const el of top.querySelectorAll('button')) { el.style.paddingLeft = ''; el.style.paddingRight = ''; }
  }
}
let fitTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(fitTexts, 80);
});

// The "Always use" panel is folded away unless she opens it with the tab.
function renderSide() {
  const open = Boolean(state.settings.sideOpen);
  $('sidePanel').hidden = !open;
  $('sideToggle').setAttribute('aria-expanded', String(open));
  $('sideToggle').title = t(open ? 'hideAlways' : 'showAlways');
}

function showUpdate(info) {
  state.update = info;
  const banner = $('updateBanner');
  banner.hidden = !info;
  if (info) banner.textContent = t('updateBanner', { version: info.version });
  $('restartBtn').hidden = !info;
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme === 'dark' ? 'dark' : 'light';
}

setInterval(() => {
  const { current } = state;
  if (!current) return;
  const done = (audio.ctx.currentTime - current.startedAt) / current.duration;
  const row = document.querySelector('.clip.playing');
  if (row) row.style.setProperty('--progress', `${Math.min(100, done * 100)}%`);
  sendPad(true);
}, 60);

function micPeak() {
  const data = new Float32Array(audio.analyser.fftSize);
  audio.analyser.getFloatTimeDomainData(data);
  return peakOf(data);
}

setInterval(() => {
  const open = $('settingsDialog').open || $('recordDialog').open || state.checking;
  if (!open || !audio.analyser) return;
  const width = `${Math.min(100, Math.sqrt(micPeak()) * 100)}%`;
  $('micLevel').style.width = width;
  $('recordLevel').style.width = width;
  $('checkLevel').style.width = width;
}, 80);

/* ---------- Board dragging ---------- */

function columnsNow() {
  return Math.max(1, Math.floor(($('boardScroll').clientWidth - 20) / CCBoard.CELL_X));
}

async function saveBoard() {
  const clips = readingOrder(state.topic.clips);
  await api.saveLayout(state.topic.id, clips.map(({ id, x, y }) => ({ id, x, y })));
}

// Gives new clips a place, and keeps the order the same as what she sees.
async function tidyTopic() {
  if (placeMissing(state.topic.clips, columnsNow())) await saveBoard();
  state.topic.clips = readingOrder(state.topic.clips);
}

function pointerOnBoard(e) {
  const box = $('board').getBoundingClientRect();
  return { x: e.clientX - box.left, y: e.clientY - box.top };
}

function scrollNearEdges(e) {
  const scroller = $('boardScroll');
  const box = scroller.getBoundingClientRect();
  const push = (distance) => (distance < 40 ? 14 : 0);
  scroller.scrollLeft += push(box.right - e.clientX) - push(e.clientX - box.left);
  scroller.scrollTop += push(box.bottom - e.clientY) - push(e.clientY - box.top);
}

function startTileDrag(e, tile, item) {
  if (e.button !== 0 || e.target.closest('.more, .link-handle')) return;
  const { clip } = item;
  const start = pointerOnBoard(e);
  const origin = { x: clip.x, y: clip.y };
  let moving = false;

  const onMove = (move) => {
    const at = pointerOnBoard(move);
    const dx = at.x - start.x;
    const dy = at.y - start.y;
    if (!moving && Math.hypot(dx, dy) < 6) return;
    if (!moving) {
      moving = true;
      state.dragging = item;
      tile.classList.add('lifted');
    }
    clip.x = Math.max(0, origin.x + dx);
    clip.y = Math.max(0, origin.y + dy);
    tile.style.left = `${clip.x}px`;
    tile.style.top = `${clip.y}px`;
    renderArrows();
    sizeBoard();
    scrollNearEdges(move);
  };
  const onUp = async () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (!moving) return;
    state.skipClick = true;
    setTimeout(() => { state.skipClick = false; }, 60);
    Object.assign(clip, settle(clip, clip.x, clip.y, state.topic.clips));
    state.dragging = null;
    await saveBoard();
    await reloadTopics();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function startArrowDrag(e, item) {
  e.preventDefault();
  e.stopPropagation();
  const { clip } = item;
  const draft = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  draft.setAttribute('class', 'arrow draft');
  $('arrowLines').append(draft);
  state.dragging = item;

  const tileAt = (event) => {
    const el = document.elementFromPoint(event.clientX, event.clientY);
    const tile = el && el.closest('.board .clip');
    return tile && tile.dataset.id !== clip.id ? tile : null;
  };
  const onMove = (move) => {
    const at = pointerOnBoard(move);
    draft.setAttribute('d', `M${clip.x + CCBoard.W / 2} ${clip.y + CCBoard.H} L${at.x} ${at.y}`);
    document.querySelectorAll('.link-target').forEach((el) => el.classList.remove('link-target'));
    const target = tileAt(move);
    if (target) target.classList.add('link-target');
    scrollNearEdges(move);
  };
  const onUp = async (up) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const target = tileAt(up);
    state.dragging = null;
    state.skipClick = true;
    setTimeout(() => { state.skipClick = false; }, 60);
    if (target) {
      await api.updateClip(state.topic.id, clip.id, { links: [...(clip.links || []), target.dataset.id] });
    }
    await reloadTopics();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

async function removeArrow(from, to) {
  const yes = await ask({
    title: t('removeArrowQ'),
    text: t('removeArrowText', { from: from.name, to: to.name }),
    okText: t('removeArrow'),
  });
  if (!yes) return;
  await api.updateClip(state.topic.id, from.id, { links: from.links.filter((id) => id !== to.id) });
  await reloadTopics();
}

function clearDropMarks() {
  document.querySelectorAll('.drop-before, .drop-after').forEach((el) => {
    el.classList.remove('drop-before', 'drop-after');
  });
}

function makeSideDraggable(li, item) {
  li.draggable = true;
  li.addEventListener('dragstart', (e) => {
    state.dragging = item;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.clip.id);
    requestAnimationFrame(() => li.classList.add('dragging'));
  });
  li.addEventListener('dragend', () => {
    state.dragging = null;
    clearDropMarks();
    renderAll();
  });
  const dropsAfter = (e) => {
    const box = li.getBoundingClientRect();
    return e.clientY > box.top + box.height / 2;
  };
  const canDrop = () => state.dragging && state.dragging.clip.id !== item.clip.id;
  li.addEventListener('dragover', (e) => {
    if (!canDrop()) return;
    e.preventDefault();
    clearDropMarks();
    li.classList.add(dropsAfter(e) ? 'drop-after' : 'drop-before');
  });
  li.addEventListener('drop', async (e) => {
    if (!canDrop()) return;
    e.preventDefault();
    const moved = state.dragging.clip.id;
    const list = state.always.clips.map((clip) => clip.id).filter((id) => id !== moved);
    list.splice(list.indexOf(item.clip.id) + (dropsAfter(e) ? 1 : 0), 0, moved);
    state.dragging = null;
    await api.setOrder(state.alwaysId, list);
    await reloadTopics();
  });
}

/* ---------- Topics ---------- */

function ask({ title, text = '', value = null, okText }) {
  const dialog = $('askDialog');
  $('askTitle').textContent = title;
  $('askText').textContent = text;
  $('askText').hidden = !text;
  const input = $('askInput');
  input.hidden = value === null;
  input.value = value || '';
  $('askOk').textContent = okText;
  dialog.showModal();
  if (value !== null) input.select();
  return new Promise((resolve) => {
    const finish = (answer) => {
      $('askOk').onclick = null;
      $('askCancel').onclick = null;
      input.onkeydown = null;
      dialog.oncancel = null;
      dialog.close();
      resolve(answer);
    };
    const ok = () => finish(value === null ? true : input.value.trim() || null);
    $('askOk').onclick = ok;
    $('askCancel').onclick = () => finish(null);
    dialog.oncancel = (e) => { e.preventDefault(); finish(null); };
    input.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
  });
}

async function syncShortcuts() {
  const { keys, clipModifier } = state.settings;
  state.shortcuts = clipShortcuts(state.topic.clips, state.always.clips, clipModifier, keys);
  const list = [...state.shortcuts].map(([clipId, key]) => ({ clipId, key }));
  const sent = JSON.stringify(list);
  if (sent === state.sentKeys) return [];
  state.sentKeys = sent;
  return api.setClipKeys(list);
}

async function openTopic(id) {
  stopClip();
  state.topic = await api.getTopic(id);
  await tidyTopic();
  await syncShortcuts();
  state.cursor = -1;
  state.played.clear();
  state.lastItem = null;
  await api.saveSettings({ lastTopic: id });
  state.settings.lastTopic = id;
  renderTopics();
  renderAll();
}

async function reloadTopics() {
  const atId = state.topic.clips[state.cursor] && state.topic.clips[state.cursor].id;
  const oldCursor = state.cursor;
  state.topic = await api.getTopic(state.topic.id);
  await tidyTopic();
  state.always = await api.getTopic(state.alwaysId);
  if (atId) {
    const at = state.topic.clips.findIndex((clip) => clip.id === atId);
    state.cursor = at >= 0 ? at : oldCursor - 1;   // A deleted clip's place goes to the one after it.
  }
  if (state.lastItem) {
    const list = listFor(state.lastItem.topicId);
    const at = list.findIndex((clip) => clip.id === state.lastItem.clip.id);
    state.lastItem = at < 0 ? null : {
      ...state.lastItem,
      clip: list[at],
      index: state.lastItem.index === null ? null : at,
    };
  }
  await syncShortcuts();
  renderAll();
}

async function newTopic() {
  const name = await ask({
    title: t('newTopic'),
    value: t('topic', { n: state.topics.length + 1 }),
    okText: t('createTopic'),
  });
  if (!name) return;
  const topic = await api.createTopic(name);
  state.topics.push({ id: topic.id, name: topic.name });
  await openTopic(topic.id);
}

async function renameTopic() {
  const name = await ask({ title: t('renameTopicTitle'), value: state.topic.name, okText: t('rename') });
  if (!name) return;
  await api.renameTopic(state.topic.id, name);
  state.topics.find((topic) => topic.id === state.topic.id).name = name;
  state.topic.name = name;
  renderTopics();
}

async function deleteTopic() {
  const yes = await ask({
    title: t('deleteTopicQ', { name: state.topic.name }),
    text: t('topicBin'),
    okText: t('deleteTopic'),
  });
  if (!yes) return;
  await api.deleteTopic(state.topic.id);
  state.topics = state.topics.filter((topic) => topic.id !== state.topic.id);
  if (!state.topics.length) state.topics.push(await api.createTopic(t('topic', { n: 1 })));
  await openTopic(state.topics[0].id);
}

/* ---------- Clips ---------- */

function renderSwatches(item) {
  const box = $('swatches');
  box.replaceChildren();
  for (const [color, label] of CLIP_COLORS) {
    const swatch = document.createElement('button');
    swatch.className = 'swatch';
    swatch.title = label;
    swatch.setAttribute('aria-label', label);
    swatch.setAttribute('aria-pressed', String((item.clip.color || '') === color));
    swatch.style.setProperty('--swatch', color || '#FFFFFF');
    swatch.addEventListener('click', async () => {
      await api.updateClip(item.topicId, item.clip.id, { color });
      item.clip.color = color;
      await reloadTopics();
      renderSwatches(item);
    });
    box.append(swatch);
  }
}

function openClipDialog(item) {
  const dialog = $('clipDialog');
  players.clip.hide();
  noteTarget = { topicId: item.topicId, clip: item.clip };
  $('clipNote').value = item.clip.note || '';
  $('clipNote').placeholder = t('clipNoteHint');
  const { topicId, clip } = item;
  const onSide = topicId === state.alwaysId;
  const list = listFor(topicId);
  const at = list.findIndex((other) => other.id === clip.id);
  $('clipTitle').textContent = clip.name;
  $('clipUp').hidden = !onSide;
  $('clipDown').hidden = !onSide;
  $('clipUp').disabled = at <= 0;
  $('clipDown').disabled = at >= list.length - 1;
  renderSwatches(item);
  $('clipListen').onclick = () => listen(topicId, clip);
  $('clipTrim').onclick = async () => {
    dialog.close();
    await trimSavedClip(topicId, clip);
  };
  const current = state.shortcuts.get(clip.id);
  $('clipKey').textContent = current ? t('changeShortcut', { key: showKey(current) }) : t('setShortcut');
  $('clipKey').onclick = async () => {
    dialog.close();
    const answer = await askKey({ title: t('shortcutFor', { name: clip.name }), canClear: Boolean(clip.key) });
    if (!answer) return;
    await api.updateClip(topicId, clip.id, { key: answer.key });
    await reloadTopics();
  };
  $('clipRename').onclick = async () => {
    dialog.close();
    const name = await ask({ title: t('renameClip'), value: clip.name, okText: t('rename') });
    if (!name) return;
    await api.updateClip(topicId, clip.id, { name });
    await reloadTopics();
  };
  $('clipRerecord').onclick = () => {
    dialog.close();
    openRecorder({ topicId, replace: clip });
  };
  const move = async (step) => {
    dialog.close();
    await api.moveClip(topicId, clip.id, step);
    await reloadTopics();
  };
  $('clipUp').onclick = () => move(-1);
  $('clipDown').onclick = () => move(1);
  $('clipDelete').onclick = async () => {
    dialog.close();
    const yes = await ask({
      title: t('deleteClipQ', { name: clip.name }),
      text: t('clipBin'),
      okText: t('deleteClip'),
    });
    if (!yes) return;
    if (state.current && state.current.clip.id === clip.id) await stopClip();
    await api.deleteClip(topicId, clip.id);
    state.played.delete(clip.id);
    await reloadTopics();
  };
  dialog.showModal();
}

// The description is saved when the options window closes, whichever way.
let noteTarget = null;
async function saveNote() {
  if (!noteTarget) return;
  const { topicId, clip } = noteTarget;
  noteTarget = null;
  const note = $('clipNote').value.trim();
  if (note === (clip.note || '')) return;
  clip.note = note;
  await api.updateClip(topicId, clip.id, { note });
  await reloadTopics();
}

// Plays in the headset only, so the call never hears this.
// A player is a progress bar (like a music player) that shows one part of a
// buffer: how long it is and how much has played. Clicking the bar jumps there.
let preview = null; // { source, player, from, startedAt }
let previewFrame = 0;

function makePlayer(id, { button, idleText, onTick } = {}) {
  const el = $(id);
  const part = (name) => el.querySelector(`[data-part="${name}"]`);
  const player = { el, button, idleText, onTick, buffer: null, start: 0, length: 0 };

  // Where playback is, in seconds from the start of the shown part, or null.
  player.position = () => {
    if (!preview || preview.player !== player) return null;
    // outputLatency: the sound reaches the ears a little after it is sent.
    const played = audio.headCtx.currentTime - preview.startedAt - (audio.headCtx.outputLatency || 0);
    const at = preview.from + played - player.start;
    return Math.min(player.length, Math.max(0, at));
  };
  player.show = () => {
    const at = player.position();
    const playing = at !== null;
    part('fill').style.width = `${player.length ? ((at || 0) / player.length) * 100 : 0}%`;
    part('now').textContent = formatTime(at || 0);
    part('total').textContent = formatTime(player.length);
    part('bar').setAttribute('aria-valuenow', String(Math.round(at || 0)));
    part('bar').setAttribute('aria-valuemax', String(Math.round(player.length)));
    const btn = typeof player.button === 'function' ? player.button() : player.button;
    if (btn && player.idleText) btn.textContent = playing ? t('stop') : t(player.idleText);
    if (player.onTick) player.onTick();
  };
  player.set = (buffer, start, length) => {
    if (preview && preview.player === player) stopPreview();
    Object.assign(player, { buffer, start, length });
    el.hidden = false;
    player.show();
  };
  player.hide = () => {
    if (preview && preview.player === player) stopPreview();
    el.hidden = true;
  };
  player.play = (offset = 0) => {
    if (!player.buffer) return;
    const from = Math.min(Math.max(0, offset), Math.max(0, player.length - 0.05));
    playPreview(player.buffer, player.start + from, player.length - from, player);
  };
  player.toggle = () => {
    if (player.position() !== null) stopPreview();
    else player.play(0);
  };

  const bar = part('bar');
  const seek = (e) => {
    const box = bar.getBoundingClientRect();
    player.play(((e.clientX - box.left) / box.width) * player.length);
  };
  let seeking = false;
  bar.addEventListener('pointerdown', (e) => {
    seeking = true;
    bar.setPointerCapture(e.pointerId);
    seek(e);
  });
  bar.addEventListener('pointermove', (e) => { if (seeking) seek(e); });
  bar.addEventListener('pointerup', () => { seeking = false; });
  bar.addEventListener('keydown', (e) => {
    const at = player.position() || 0;
    if (e.key === 'ArrowRight') player.play(at + 2);
    else if (e.key === 'ArrowLeft') player.play(at - 2);
    else if (e.key === ' ' || e.key === 'Enter') player.toggle();
    else return;
    e.preventDefault();
  });
  return player;
}

function tickPreview() {
  previewFrame = 0;
  if (!preview) return;
  preview.player.show();
  previewFrame = requestAnimationFrame(tickPreview);
}

function stopPreview() {
  if (!preview) return;
  const { source, player } = preview;
  preview = null;
  source.onended = null;
  try { source.stop(); } catch { /* already stopped */ }
  if (player) player.show();
}

function playPreview(buffer, from = 0, seconds = buffer.duration, player = null) {
  stopPreview();
  const source = audio.headCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.headsetBus);
  source.onended = () => {
    if (!preview || preview.source !== source) return;
    preview = null;
    if (player) player.show();
  };
  audio.headCtx.resume();
  preview = { source, player, from, startedAt: audio.headCtx.currentTime };
  source.start(0, from, seconds);
  if (player && !previewFrame) previewFrame = requestAnimationFrame(tickPreview);
}

const players = {};
function connectPlayers() {
  players.clip = makePlayer('clipPlayer', { button: $('clipListen'), idleText: 'listenHeadset' });
  players.record = makePlayer('recordPlayer', {
    button: () => $('recordButtons').querySelector('[data-role="listen"]'),
    idleText: 'listen',
  });
  players.trim = makePlayer('trimPlayer', { button: $('trimListen'), idleText: 'listen', onTick: () => drawTrim() });
}

async function listen(topicId, clip) {
  if (players.clip.position() !== null) {
    stopPreview();
    return;
  }
  try {
    const buffer = await bufferFor(topicId, clip);
    const range = effectiveRange(clip, buffer);
    players.clip.set(buffer, range.start, range.length);
    players.clip.play(0);
  } catch {
    showStatus(t('cannotPlayClip', { name: clip.name }), 'problem');
  }
}

/* ---------- Trimming ---------- */

// A trim only stores two times. The recording itself is never changed,
// so reopening shows the saved points and Reset brings the full clip back.
const trim = { buffer: null, start: 0, end: 0, finish: null, peaks: null, dragging: '' };
const MIN_KEEP = 0.2;

function readPeaks(buffer, count) {
  const channel = buffer.getChannelData(0);
  const size = Math.max(1, Math.floor(channel.length / count));
  const peaks = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let peak = 0;
    const end = Math.min(channel.length, (i + 1) * size);
    for (let j = i * size; j < end; j++) peak = Math.max(peak, Math.abs(channel[j]));
    peaks[i] = peak;
  }
  const loudest = Math.max(...peaks, 0.001);
  return peaks.map((peak) => peak / loudest);
}

function drawTrim() {
  const canvas = $('trimWave');
  const g = canvas.getContext('2d');
  const { width, height } = canvas;
  const { duration } = trim.buffer;
  const startX = (trim.start / duration) * width;
  const endX = (trim.end / duration) * width;
  g.clearRect(0, 0, width, height);
  g.fillStyle = '#17213A';
  g.fillRect(0, 0, width, height);
  // Where playback is now, so the yellow line follows the sound.
  const at = players.trim ? players.trim.position() : null;
  const playX = at === null ? null : ((players.trim.start + at) / duration) * width;
  trim.peaks.forEach((peak, x) => {
    const bar = Math.max(2, peak * height * 0.86);
    const kept = x >= startX && x <= endX;
    g.fillStyle = !kept ? '#3A4560' : playX !== null && x <= playX ? '#C9D5FF' : '#7F9BFF';
    g.fillRect(x, (height - bar) / 2, 1, bar);
  });
  g.fillStyle = '#FFFFFF';
  g.fillRect(startX - 3, 0, 6, height);
  g.fillRect(endX - 3, 0, 6, height);
  if (playX !== null) {
    g.fillStyle = '#FFD24A';
    g.fillRect(playX - 1.5, 0, 3, height);
  }
  $('trimStart').value = trim.start;
  $('trimEnd').value = trim.end;
  $('trimInfo').textContent = t('keeps', { part: formatTime(trim.end - trim.start), all: formatTime(duration) });
}

// The progress bar under the wave covers only the part that will play.
function trimRangeChanged() {
  players.trim.set(trim.buffer, trim.start, trim.end - trim.start);
  drawTrim();
}

function moveTrim(which, seconds) {
  const { duration } = trim.buffer;
  if (which === 'start') trim.start = Math.min(Math.max(0, seconds), trim.end - MIN_KEEP);
  else trim.end = Math.max(Math.min(duration, seconds), trim.start + MIN_KEEP);
  trimRangeChanged();
}

// Resolves with { start, end }, or null if cancelled.
function openTrim(buffer, range) {
  trim.buffer = buffer;
  trim.start = range.start;
  trim.end = range.end;
  trim.peaks = readPeaks(buffer, $('trimWave').width);
  for (const id of ['trimStart', 'trimEnd']) $(id).max = buffer.duration;
  $('trimSave').disabled = buffer.duration <= MIN_KEEP;
  $('trimDialog').showModal();
  trimRangeChanged();
  return new Promise((resolve) => { trim.finish = resolve; });
}

function closeTrim(answer) {
  stopPreview();
  $('trimDialog').close();
  const { finish } = trim;
  trim.finish = null;
  if (finish) finish(answer);
}

async function trimSavedClip(topicId, clip) {
  let buffer;
  try {
    buffer = await bufferFor(topicId, clip);
  } catch {
    showStatus(t('cannotPlayClip', { name: clip.name }), 'problem');
    return;
  }
  const result = await openTrim(buffer, playRange(clip, buffer.duration));
  if (!result) return;
  if (state.current && state.current.clip.id === clip.id) await stopClip();
  await api.updateClip(topicId, clip.id, { trimStart: result.start, trimEnd: result.end });
  await reloadTopics();
}

function connectTrimEvents() {
  const canvas = $('trimWave');
  const seconds = (e) => {
    const box = canvas.getBoundingClientRect();
    return ((e.clientX - box.left) / box.width) * trim.buffer.duration;
  };
  canvas.addEventListener('pointerdown', (e) => {
    const at = seconds(e);
    trim.dragging = Math.abs(at - trim.start) <= Math.abs(at - trim.end) ? 'start' : 'end';
    canvas.setPointerCapture(e.pointerId);
    moveTrim(trim.dragging, at);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (trim.dragging) moveTrim(trim.dragging, seconds(e));
  });
  canvas.addEventListener('pointerup', () => { trim.dragging = ''; });
  $('trimStart').addEventListener('input', (e) => moveTrim('start', Number(e.target.value)));
  $('trimEnd').addEventListener('input', (e) => moveTrim('end', Number(e.target.value)));
  $('trimReset').addEventListener('click', () => {
    trim.start = 0;
    trim.end = trim.buffer.duration;
    trimRangeChanged();
  });
  $('trimListen').addEventListener('click', () => players.trim.toggle());
  $('trimCancel').addEventListener('click', () => closeTrim(null));
  $('trimDialog').addEventListener('cancel', (e) => { e.preventDefault(); closeTrim(null); });
  $('trimSave').addEventListener('click', () => closeTrim({ start: trim.start, end: trim.end }));
}

/* ---------- Recording ---------- */

const recorder = { target: null, media: null, chunks: [], timer: null, samples: null, buffer: null, range: null };

function recordButtons(buttons) {
  const box = $('recordButtons');
  box.replaceChildren();
  for (const button of buttons) {
    const el = document.createElement('button');
    el.className = button.className || 'quiet';
    el.textContent = button.text;
    if (button.role) el.dataset.role = button.role;
    el.addEventListener('click', button.action);
    box.append(el);
  }
}

function showRecorderStart(hint) {
  players.record.hide();
  $('recordMeter').hidden = false;
  $('recordTime').hidden = true;
  $('recordHint').textContent = hint || t('recordHint');
  recordButtons([
    { text: t('cancel'), action: closeRecorder },
    { text: t('startRecording'), className: 'primary rec', action: startRecording },
  ]);
}

function openRecorder(target) {
  stopClip();
  recorder.target = target;
  const list = listFor(target.topicId);
  $('recordTitle').textContent = target.replace ? t('recordTitleAgain', { name: target.replace.name }) : t('recordNew');
  $('recordName').value = target.replace ? target.replace.name : t('question', { n: list.length + 1 });
  $('recordName').disabled = Boolean(target.replace);
  $('recordDialog').showModal();
  showRecorderStart();
}

function closeRecorder() {
  stopPreview();
  if (recorder.media && recorder.media.state !== 'inactive') {
    recorder.media.onstop = null;
    recorder.media.stop();
  }
  clearInterval(recorder.timer);
  state.recording = false;
  setMicGate();
  $('recordDialog').close();
  renderStatus();
}

function startRecording() {
  if (!audio.micStream) {
    $('recordHint').textContent = t('noMic');
    return;
  }
  stopPreview();
  recorder.chunks = [];
  recorder.media = new MediaRecorder(audio.micStream, {
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 160000,
  });
  recorder.media.ondataavailable = (e) => { if (e.data.size) recorder.chunks.push(e.data); };
  recorder.media.onstop = finishRecording;
  recorder.media.start(250);

  state.recording = true;
  setMicGate();
  renderStatus();

  const started = performance.now();
  $('recordTime').hidden = false;
  $('recordTime').textContent = '0:00';
  $('recordHint').textContent = t('recordingNow');
  recorder.timer = setInterval(() => {
    $('recordTime').textContent = formatTime((performance.now() - started) / 1000);
  }, 250);
  recordButtons([{ text: t('stopRecording'), className: 'primary rec', action: () => recorder.media.stop() }]);
}

async function finishRecording() {
  clearInterval(recorder.timer);
  state.recording = false;
  setMicGate();
  renderStatus();
  recordButtons([]);
  $('recordHint').textContent = t('preparing');
  try {
    const bytes = await new Blob(recorder.chunks).arrayBuffer();
    const decoded = await audio.ctx.decodeAudioData(bytes);
    // Saved exactly as recorded, with no trimming and no volume change.
    recorder.samples = decoded.getChannelData(0).slice();
    recorder.buffer = decoded;
    recorder.range = { start: 0, end: decoded.duration };
    showRecorderReview();
  } catch (error) {
    console.error(error);
    showRecorderStart(t('readFailed'));
  }
}

function showRecorderReview() {
  const { start, end } = recorder.range;
  $('recordTime').textContent = formatTime(end - start);
  $('recordHint').textContent = peakOf(recorder.samples) < 0.005 ? t('quietWarning') : t('reviewHint');
  recordButtons([
    { text: t('listen'), role: 'listen', action: () => players.record.toggle() },
    { text: t('trim'), action: trimRecording },
    { text: t('recordAgain'), action: () => { stopPreview(); showRecorderStart(); } },
    { text: t('saveClip'), className: 'primary', action: saveRecording },
  ]);
  players.record.set(recorder.buffer, start, end - start);
}

async function trimRecording() {
  stopPreview();
  const result = await openTrim(recorder.buffer, recorder.range);
  if (!result) return;
  recorder.range = result;
  showRecorderReview();
}

async function saveRecording() {
  const { topicId, replace } = recorder.target;
  const name = $('recordName').value.trim() || t('clip');
  const wav = new Uint8Array(encodeWav(recorder.samples, recorder.buffer.sampleRate));
  const { start, end } = recorder.range;
  const trimmed = start > 0 || end < recorder.buffer.duration;
  try {
    const clip = replace
      ? await api.replaceClip(topicId, replace.id, wav)
      : await api.saveClip(topicId, name, wav);
    if (trimmed) await api.updateClip(topicId, clip.id, { trimStart: start, trimEnd: end });
  } catch (error) {
    console.error(error);
    $('recordHint').textContent = t('saveFailed');
    return;
  }
  closeRecorder();
  await reloadTopics();
}

/* ---------- Setup check ---------- */

function renderCheckList(results) {
  const list = $('checkList');
  list.replaceChildren();
  for (const { id, ok } of results) {
    const row = document.createElement('li');
    const failed = ok === false;
    row.className = `check-item ${ok === null ? 'skip' : failed ? 'bad' : 'ok'}`;
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = ok === null ? '–' : failed ? '✗' : '✓';
    const name = document.createElement('span');
    name.textContent = t(`check.${id}`) + (ok === null ? ` (${t('skipped')})` : '');
    row.append(mark, name);
    if (failed) {
      const fix = document.createElement('span');
      fix.className = 'fix';
      fix.textContent = t(`fix.${id}`);
      row.append(fix);
    }
    list.append(row);
  }
}

// Measures the loudest sound on a stream while something else happens.
async function loudest(streams, ms) {
  const tools = streams.map((stream) => {
    const source = audio.ctx.createMediaStreamSource(stream);
    const analyser = audio.ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    return { source, analyser, peak: 0 };
  });
  const data = new Float32Array(2048);
  const end = performance.now() + ms;
  while (performance.now() < end) {
    for (const tool of tools) {
      tool.analyser.getFloatTimeDomainData(data);
      tool.peak = Math.max(tool.peak, peakOf(data));
    }
    await wait(40);
  }
  tools.forEach((tool) => tool.source.disconnect());
  return tools.map((tool) => tool.peak);
}

async function runCheck() {
  if (state.checking) return;
  await stopClip();
  await refreshDevices();
  state.checking = true;
  setMicGate();
  $('checkRun').disabled = true;
  $('checkSummary').hidden = true;
  const prompt = (text, talking) => {
    $('checkPrompt').textContent = text;
    $('checkPrompt').hidden = false;
    $('checkMeter').hidden = !talking;
  };
  prompt(t('checking'), false);
  await audio.ctx.resume();

  const list = await navigator.mediaDevices.enumerateDevices();
  const labelOf = (kind, id) => {
    const device = list.find((d) => d.kind === kind && d.deviceId === id);
    return device ? device.label : undefined;
  };
  const { devices } = state;
  const data = {
    mode: state.settings.mode,
    mixMic: Boolean(state.settings.mixMic),
    hasCable: Boolean(devices.callId) && devices.cableMics.length > 0,
    hasSpeaker: Boolean(devices.speakerId) && audio.callOk,
    defaultMic: labelOf('audioinput', 'default'),
    commsMic: labelOf('audioinput', 'communications'),
    defaultSpeaker: labelOf('audiooutput', 'default'),
  };

  let cableStream = null;
  try {
    if (usesCable() && data.hasCable) {
      cableStream = await navigator.mediaDevices.getUserMedia(micOptions(devices.cableMics[0].deviceId));
      // A short tone goes in one end of the cable, and must come out the other.
      const [before] = await loudest([cableStream], 300);
      const tone = audio.ctx.createOscillator();
      const toneGain = audio.ctx.createGain();
      toneGain.gain.value = 0.3;
      tone.frequency.value = 880;
      tone.connect(toneGain);
      toneGain.connect(audio.callBus);
      tone.start();
      const [during] = await loudest([cableStream], 700);
      tone.stop();
      toneGain.disconnect();
      data.toneArrived = audio.callOk && during > 0.02 && during > before * 3;
      await wait(200);
    }

    prompt(t('speakNow'), true);
    if (cableStream && audio.micStream) {
      // With the app's mic off, nothing should come out of the cable.
      // The app's own mic path is off here, so anything in the cable
      // came from Windows (Listen to this device).
      const [micLevel, cableLevel] = await loudest([audio.micStream, cableStream], 3000);
      data.micHeard = micLevel > 0.02;
      data.listenOn = data.micHeard && cableLevel > 0.01;
      if (data.mixMic) {
        state.checking = false;
        setMicGate();
        state.checking = true;
        const [, sent] = await loudest([audio.micStream, cableStream], 2500);
        data.voiceArrived = sent > 0.01;
      }
    } else if (audio.micStream) {
      const [micLevel] = await loudest([audio.micStream], 3000);
      data.micHeard = micLevel > 0.02;
    }
  } catch (error) {
    console.error('Setup check', error);
  }
  if (cableStream) cableStream.getTracks().forEach((track) => track.stop());
  state.checking = false;
  setMicGate();

  const results = setupChecks(data);
  const allGood = results.every((item) => item.ok === true);
  renderCheckList(results);
  $('checkPrompt').hidden = true;
  $('checkMeter').hidden = true;
  $('checkRun').disabled = false;
  $('checkRun').textContent = t('runAgain');
  $('checkCable').hidden = !(usesCable() && !data.hasCable);
  const summary = $('checkSummary');
  summary.textContent = allGood ? `${t('checkAllGood')} ${t('checkFinal')}` : t('checkProblems');
  summary.className = `check-summary ${allGood ? 'good' : ''}`;
  summary.hidden = false;

  const checkedKey = allGood ? setupKey() : '';
  state.settings.checkedKey = checkedKey;
  await api.saveSettings({ checkedKey });
  renderHealth();
}

function openCheck() {
  $('checkList').replaceChildren();
  $('checkSummary').hidden = true;
  $('checkPrompt').hidden = true;
  $('checkMeter').hidden = true;
  $('checkRun').textContent = t('runCheck');
  $('checkCable').hidden = !(usesCable() && !(state.devices && state.devices.callId));
  $('checkDialog').showModal();
}

/* ---------- Settings ---------- */

function fillSelect(select, devices, value, empty) {
  select.replaceChildren();
  if (!devices.length) {
    const option = document.createElement('option');
    option.textContent = empty;
    option.value = '';
    select.append(option);
    return;
  }
  devices.forEach((device, n) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || t('device', { n: n + 1 });
    select.append(option);
  });
  select.value = value;
}

function fillDeviceLists() {
  const d = state.devices;
  fillSelect($('micSelect'), d.mics, d.micId, t('noMicFound'));
  fillSelect($('headsetSelect'), d.headsets, d.headsetId, t('noHeadsetFound'));
  fillSelect($('callSelect'), d.cables, d.callId, t('cableNotFound'));
  fillSelect($('speakerSelect'), d.headsets, d.speakerId, t('noSpeakerFound'));
  renderMode();
}

function renderMode() {
  const cable = usesCable();
  const d = state.devices;
  $('cableSwitch').checked = cable;
  $('speakerNote').hidden = cable;
  $('callRow').hidden = !cable;
  $('speakerRow').hidden = cable;
  $('sameDevice').hidden = cable || !d || !d.speakerId || d.speakerId !== d.headsetId;
  $('mixRow').hidden = !cable;
  $('mixHelp').hidden = !cable;
  $('muteRow').hidden = !mixesMic();
}

async function changeSetting(change) {
  Object.assign(state.settings, change);
  await api.saveSettings(change);
}

async function changeDevice(change) {
  await changeSetting(change);
  await refreshDevices();
  renderAll();
}

const KEY_NAMES = { next: 'nextKey', repeat: 'repeat', stop: 'stop', newCall: 'newCall' };
const keyName = (action) => t(KEY_NAMES[action]);

function renderKeyRows() {
  const box = $('keyRows');
  box.replaceChildren();
  for (const action of Object.keys(KEY_NAMES)) {
    const row = document.createElement('div');
    row.className = 'key-row';
    const label = document.createElement('span');
    label.textContent = keyName(action);
    const button = document.createElement('button');
    button.className = 'quiet';
    button.textContent = showKey(state.settings.keys[action]);
    button.addEventListener('click', () => changeActionKey(action));
    row.append(label, button);
    box.append(row);
  }
  const mod = state.settings.clipModifier;
  $('clipModifier').value = mod;
  $('modifierHint').textContent = t('mainKeyHint', { key: showKey(mod) });
}

// Tells what already uses a key, so two jobs can never share one.
function keyOwner(key) {
  for (const [action, value] of Object.entries(state.settings.keys)) {
    if (value === key) return keyName(action);
  }
  for (const clip of [...state.topic.clips, ...state.always.clips]) {
    if (state.shortcuts.get(clip.id) === key) return clip.name;
  }
  return '';
}

// Waits for keys. Resolves with { key } ('' removes it), or null if cancelled.
async function askKey({ title, canClear = false, current = '' }) {
  const dialog = $('keyDialog');
  const error = $('keyDialogError');
  $('keyTitle').textContent = title;
  $('keyClear').hidden = !canClear;
  error.hidden = true;
  await api.pauseKeys(true);
  dialog.showModal();
  return new Promise((resolve) => {
    const finish = async (answer) => {
      window.removeEventListener('keydown', onKey, true);
      $('keyClear').onclick = null;
      $('keyCancel').onclick = null;
      dialog.oncancel = null;
      dialog.close();
      await api.pauseKeys(false);
      resolve(answer);
    };
    const onKey = (e) => {
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return finish(null);
      const key = keyFromEvent(e);
      const owner = key && key !== current ? keyOwner(key) : '';
      if (!key) {
        error.textContent = t('keyBad');
      } else if (owner) {
        error.textContent = t('keyTaken', { key: showKey(key), owner });
      } else {
        return finish({ key });
      }
      error.hidden = false;
    };
    window.addEventListener('keydown', onKey, true);
    $('keyClear').onclick = () => finish({ key: '' });
    $('keyCancel').onclick = () => finish(null);
    dialog.oncancel = (e) => { e.preventDefault(); finish(null); };
  });
}

function reportFailedKeys(failed) {
  const error = $('keyError');
  error.hidden = !failed.length;
  if (failed.length) error.textContent = t('keysProgram', { keys: failed.map(showKey).join(', ') });
}

async function changeActionKey(action) {
  const current = state.settings.keys[action];
  const answer = await askKey({ title: t('shortcutFor', { name: keyName(action) }), current });
  if (!answer) return;
  state.settings.keys = { ...state.settings.keys, [action]: answer.key };
  reportFailedKeys(await api.setKeys(state.settings.keys));
  await syncShortcuts();
  renderKeyRows();
  renderAll();
}

async function changeModifier(clipModifier) {
  await changeSetting({ clipModifier });
  reportFailedKeys(await syncShortcuts());
  renderKeyRows();
  renderAll();
}

async function changeLanguage(lang) {
  await changeSetting({ lang });
  applyWords();
  fillDeviceLists();
  renderKeyRows();
  renderHealth();
  renderAll();
}

function showVolume() {
  const percent = Math.round(Number($('volume').value) * 100);
  $('volumeValue').textContent = percent === 100 ? `100% (${t('asRecorded')})` : `${percent}%`;
}

/* ---------- Connecting the page ---------- */

// Small windows close when you click outside them, the same as pressing Esc.
// Recording and trimming are left out so unsaved work is not lost by a stray click.
function closeOnOutsideClick(dialog) {
  const outside = (e) => {
    const box = dialog.getBoundingClientRect();
    return e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom;
  };
  // Both the press and the release must be outside, so dragging a slider
  // and letting go outside the window does not close it.
  let pressedOutside = false;
  dialog.addEventListener('pointerdown', (e) => { pressedOutside = e.target === dialog && outside(e); });
  dialog.addEventListener('click', (e) => {
    const wasOutside = pressedOutside;
    pressedOutside = false;
    if (!wasOutside || e.target !== dialog || !outside(e)) return;
    if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
  });
}

function connectEvents() {
  for (const id of ['clipDialog', 'topicDialog', 'askDialog', 'keyDialog', 'checkDialog', 'settingsDialog']) {
    closeOnOutsideClick($(id));
  }
  $('clipDialog').addEventListener('close', () => { stopPreview(); saveNote(); });
  $('clipNote').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('clipDialog').close(); }
  });

  $('nextBtn').addEventListener('click', playNext);
  $('stopBtn').addEventListener('click', stopClip);
  $('repeatBtn').addEventListener('click', repeat);
  $('newCallBtn').addEventListener('click', newCall);
  $('clearDoneBtn').addEventListener('click', clearDone);

  $('recordBtn').addEventListener('click', () => openRecorder({ topicId: state.topic.id }));
  $('sideToggle').addEventListener('click', async () => {
    await changeSetting({ sideOpen: !state.settings.sideOpen });
    renderSide();
    sizeBoard();
    fitTexts();
  });
  $('recordAlwaysBtn').addEventListener('click', () => openRecorder({ topicId: state.alwaysId }));
  $('importBtn').addEventListener('click', async () => {
    await api.importClips(state.topic.id, t('addFilesTitle'));
    await reloadTopics();
  });

  $('recordDialog').addEventListener('cancel', (e) => { e.preventDefault(); closeRecorder(); });
  $('clipClose').addEventListener('click', () => { stopPreview(); $('clipDialog').close(); });

  $('topicSelect').addEventListener('change', (e) => openTopic(e.target.value));
  $('topicMenuBtn').addEventListener('click', () => $('topicDialog').showModal());
  $('topicClose').addEventListener('click', () => $('topicDialog').close());
  const fromTopicMenu = (id, fn) => $(id).addEventListener('click', () => { $('topicDialog').close(); fn(); });
  fromTopicMenu('topicNew', newTopic);
  fromTopicMenu('topicRename', renameTopic);
  fromTopicMenu('topicDelete', deleteTopic);
  fromTopicMenu('topicFolder', () => api.openFolder(state.topic.id));

  $('cableSwitch').addEventListener('change', (e) => changeDevice({ mode: e.target.checked ? 'cable' : 'speaker' }));

  $('checkBtn').addEventListener('click', openCheck);
  $('checkRun').addEventListener('click', runCheck);
  $('checkClose').addEventListener('click', () => { if (!state.checking) $('checkDialog').close(); });
  $('checkDialog').addEventListener('cancel', (e) => { if (state.checking) e.preventDefault(); });
  $('checkCable').addEventListener('click', () => api.openCableSite());
  $('checkSound').addEventListener('click', () => api.openSoundSettings());

  $('settingsBtn').addEventListener('click', () => {
    $('volume').value = state.settings.volume;
    showVolume();
    $('muteMic').checked = state.settings.muteMicDuringClip;
    $('mixMic').checked = Boolean(state.settings.mixMic);
    $('onTop').checked = state.settings.onTop;
    $('skipQuiet').checked = Boolean(state.settings.skipQuietStart);
    $('shortcutNote').hidden = true;
    $('updateNote').hidden = true;
    $('autoUpdate').checked = state.settings.autoUpdate !== false;
    $('versionLine').textContent = t('version', { version: state.version });
    $('langSelect').value = state.settings.lang;
    $('themeSelect').value = state.settings.theme;
    $('keyError').hidden = true;
    renderMode();
    renderKeyRows();
    $('settingsDialog').showModal();
  });
  $('settingsClose').addEventListener('click', () => $('settingsDialog').close());
  $('langSelect').addEventListener('change', (e) => changeLanguage(e.target.value));
  $('themeSelect').addEventListener('change', async (e) => {
    await changeSetting({ theme: e.target.value });
    applyTheme();
    sendPad(false);
  });
  $('clipModifier').addEventListener('change', (e) => changeModifier(e.target.value));
  $('openDataFolder').addEventListener('click', () => api.openFolder());
  $('micSelect').addEventListener('change', (e) => changeDevice({ micId: e.target.value }));
  $('headsetSelect').addEventListener('change', (e) => changeDevice({ headsetId: e.target.value }));
  $('callSelect').addEventListener('change', (e) => changeDevice({ callId: e.target.value }));
  $('speakerSelect').addEventListener('change', (e) => changeDevice({ speakerId: e.target.value }));
  $('volume').addEventListener('input', (e) => {
    showVolume();
    audio.clipBus.gain.value = Number(e.target.value);
    if (audio.headsetBus.gain.value > 0) audio.headsetBus.gain.value = Number(e.target.value);
    changeSetting({ volume: Number(e.target.value) });
  });
  $('skipQuiet').addEventListener('change', (e) => changeSetting({ skipQuietStart: e.target.checked }).then(renderAll));
  $('addShortcutsBtn').addEventListener('click', async () => {
    const result = await api.addShortcuts();
    const note = $('shortcutNote');
    note.textContent = result.ok ? t('shortcutsAdded') : result.places.length === 0 && !navigator.userAgent.includes('Windows') ? t('shortcutsWindows') : t('shortcutsFailed');
    note.hidden = false;
  });
  $('shortcutsSwitch').addEventListener('change', async (e) => {
    state.settings.shortcutsOn = e.target.checked;
    reportFailedKeys(await api.setShortcutsOn(e.target.checked));
  });
  $('padSwitch').addEventListener('change', async (e) => {
    state.padOpen = e.target.checked;
    await api.setPad(e.target.checked);
    sendPad(false);
  });
  api.onPadClosed(() => {
    state.padOpen = false;
    $('padSwitch').checked = false;
  });
  $('muteMic').addEventListener('change', (e) => changeSetting({ muteMicDuringClip: e.target.checked }).then(renderStatus));
  $('mixMic').addEventListener('change', async (e) => {
    await changeSetting({ mixMic: e.target.checked, checkedKey: '' });
    setMicGate();
    renderMode();
    renderHealth();
    renderStatus();
  });
  $('onTop').addEventListener('change', (e) => {
    state.settings.onTop = e.target.checked;
    api.setOnTop(e.target.checked);
  });

  $('updateBanner').addEventListener('click', () => api.restartApp());
  $('restartBtn').addEventListener('click', () => api.restartApp());
  api.onUpdateReady((info) => showUpdate(info));
  $('autoUpdate').addEventListener('change', (e) => changeSetting({ autoUpdate: e.target.checked }));
  $('checkUpdatesBtn').addEventListener('click', async () => {
    const note = $('updateNote');
    note.hidden = false;
    note.textContent = t('updChecking');
    const result = await api.checkUpdates();
    const words = { upToDate: 'updUpToDate', ready: 'updReady', skipped: 'updSkipped', error: 'updError' };
    note.textContent = t(words[result.status] || 'updError', { version: result.version || '' });
    if (result.status === 'ready') showUpdate(result);
  });
  $('banner').addEventListener('click', () => {
    if ($('banner').dataset.action === 'check') openCheck();
    else $('settingsBtn').click();
  });

  navigator.mediaDevices.addEventListener('devicechange', () => refreshDevices());

  api.onHotkey((action) => {
    if (action === 'stop') stopClip();
    else if (action === 'next') playNext();
    else if (action === 'repeat') repeat();
    else if (action === 'newCall') newCall();
    else if (action.startsWith('clip:')) playById(action.slice(5));
  });
}

async function start() {
  const loaded = await api.load();
  state.settings = loaded.settings;
  state.topics = loaded.topics;
  state.alwaysId = loaded.alwaysId;
  state.padOpen = Boolean(state.settings.pad && state.settings.pad.open);
  state.version = loaded.version;
  applyTheme();
  applyWords();
  if (loaded.updateReady) showUpdate(loaded.updateReady);
  setUpSound();
  connectPlayers();
  connectEvents();
  connectTrimEvents();

  const known = state.topics.find((topic) => topic.id === state.settings.lastTopic) || state.topics[0];
  state.always = await api.getTopic(state.alwaysId);
  await openTopic(known.id);
  await refreshDevices();

  // The first check covers Play next and the others; openTopic adds the clips.
  const failed = [...loaded.failedKeys, ...(await api.setClipKeys([...state.shortcuts].map(([clipId, key]) => ({ clipId, key }))))];
  if (failed.length) {
    showStatus(t('keysBusy', { keys: [...new Set(failed)].map(showKey).join(', ') }), 'problem');
  }
}

window.callClipsDebug = { state, audio, playNext, stopClip, newCall };
start();
