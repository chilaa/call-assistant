const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('../src/audio-utils');
const { createStore, safeName, ALWAYS_ID } = require('../src/store');

const d = (kind, deviceId, label) => ({ kind, deviceId, label });
const windowsList = [
  d('audioinput', 'default', 'Default - CABLE Output (VB-Audio Virtual Cable)'),
  d('audioinput', 'communications', 'Communications - CABLE Output (VB-Audio Virtual Cable)'),
  d('audioinput', 'c1', 'CABLE Output (VB-Audio Virtual Cable)'),
  d('audioinput', 'm1', 'Microphone (High Definition Audio Device)'),
  d('audiooutput', 'default', 'Default - Speakers (3- High Definition Audio Device)'),
  d('audiooutput', 's1', 'Speakers (3- High Definition Audio Device)'),
  d('audiooutput', 'c2', 'CABLE Input (VB-Audio Virtual Cable)'),
];

test('never uses the cable or a Windows default as her mic', () => {
  const r = A.chooseDevices(windowsList, {});
  assert.equal(r.micId, 'm1');
  assert.equal(r.headsetId, 's1');
  assert.equal(r.callId, 'c2');
  assert.deepEqual(r.mics.map((x) => x.deviceId), ['m1']);
  assert.ok(!r.headsets.some((x) => x.deviceId === 'c2'));
});

test('keeps saved devices and copes with no cable', () => {
  const list = [...windowsList, d('audioinput', 'm2', 'USB Headset Mic')];
  assert.equal(A.chooseDevices(list, { micId: 'm1' }).micId, 'm1');
  assert.equal(A.chooseDevices(list, {}).micId, 'm2');
  assert.equal(A.chooseDevices(list.filter((x) => x.deviceId !== 'c2'), {}).callId, '');
});

test('writes a correct WAV file', () => {
  const wav = A.encodeWav(new Float32Array([0, 1, -1]), 48000);
  const v = new DataView(wav);
  assert.equal(wav.byteLength, 50);
  assert.equal(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)), 'RIFF');
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getInt16(46, true), 32767);
  assert.equal(v.getInt16(48, true), -32768);
});

test('reads keys by position, so the keyboard language does not matter', () => {
  const e = (code, m = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, ...m });
  assert.equal(A.keyFromEvent(e('KeyN', { ctrlKey: true, shiftKey: true })), 'Control+Shift+N');
  assert.equal(A.keyFromEvent(e('F8')), 'F8');
  assert.equal(A.keyFromEvent(e('KeyN')), null);
  assert.equal(A.showKey('Control+Shift+Space'), 'Ctrl + Shift + Space');
});

test('saves topics and clips, including Georgian names', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
  const s = createStore(root);
  const t = await s.createTopic('კვლევა 1: ბანკი?');
  assert.equal((await s.listTopics()).length, 1);
  const a = await s.addClipFile(t.id, 'კითხვა 1', Buffer.from('aaa'), '.wav');
  const b = await s.addClipFile(t.id, 'b/c', Buffer.from('bbb'), '.mp3');
  await s.moveClip(t.id, b.id, -1);
  assert.deepEqual((await s.getTopic(t.id)).clips.map((c) => c.id), [b.id, a.id]);
  assert.equal((await s.readClip(t.id, a.id)).toString(), 'aaa');
  const { clip, oldPath } = await s.replaceClip(t.id, a.id, Buffer.from('new'));
  assert.notEqual(path.join(root, t.id, clip.file), oldPath);
  assert.equal((await s.readClip(t.id, a.id)).toString(), 'new');
  await s.removeClip(t.id, b.id);
  assert.equal((await s.getTopic(t.id)).clips.length, 1);
  assert.equal((await s.getTopic(ALWAYS_ID)).name, 'Always use');
  await assert.rejects(() => s.getTopic('..'));
  await assert.rejects(() => s.getTopic('../x'));
  await assert.rejects(() => s.readClip(t.id, 'nope'));
});

test('makes safe folder names for Windows', () => {
  assert.equal(safeName('a:b*c?', 'x'), 'a b c');
  assert.equal(safeName('CON', 'x'), 'x');
  assert.equal(safeName('...', 'x'), 'x');
});

test('without the cable, picks a speaker apart from the headset', () => {
  const list = [
    d('audiooutput', 'h1', 'Headphones (USB Headset)'),
    d('audiooutput', 's1', 'Speakers (Realtek Audio)'),
    d('audiooutput', 'c2', 'CABLE Input (VB-Audio Virtual Cable)'),
  ];
  const r = A.chooseDevices(list, {});
  assert.equal(r.headsetId, 'h1');
  assert.equal(r.speakerId, 's1');
  assert.equal(A.chooseDevices(list, { speakerId: 'h1' }).speakerId, 'h1');
});

test('shortcuts follow the main key and never clash', () => {
  const actions = { next: 'Control+Space', stop: 'Control+0', custom: 'Alt+2' };
  const clips = [{ id: 'a' }, { id: 'b' }, { id: 'c', key: 'F2' }, { id: 'd', key: 'Control+Space' }];
  const r = A.clipShortcuts(clips, [{ id: 'z', key: 'F4' }], 'Alt', actions);
  assert.equal(r.get('a'), 'Alt+1');
  assert.equal(r.get('b'), undefined);       // Alt+2 is already used.
  assert.equal(r.get('c'), 'F2');
  assert.equal(r.get('d'), undefined);       // Its key belongs to Play next.
  assert.equal(r.get('z'), 'F4');
  const many = Array.from({ length: 12 }, (_, i) => ({ id: String(i) }));
  assert.equal(A.clipShortcuts(many, [], 'Control', {}).size, 9);
});

test('keeps a clip color and shortcut, and reorders without losing clips', async () => {
  const s = createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-')));
  const t = await s.createTopic('T');
  const a = await s.addClipFile(t.id, 'a', Buffer.from('a'), '.wav');
  const b = await s.addClipFile(t.id, 'b', Buffer.from('b'), '.wav');
  const c = await s.addClipFile(t.id, 'c', Buffer.from('c'), '.wav');
  await s.updateClip(t.id, a.id, { color: '#16794F', key: 'F2', file: '../evil' });
  await s.replaceClip(t.id, a.id, Buffer.from('new'));
  await s.setOrder(t.id, [c.id, 'nope', a.id]);
  const clips = (await s.getTopic(t.id)).clips;
  assert.deepEqual(clips.map((x) => x.id), [c.id, a.id, b.id]);
  assert.equal(clips[1].color, '#16794F');
  assert.equal(clips[1].key, 'F2');
  assert.ok(!clips[1].file.includes('evil'));
});

const B = require('../src/board');
const W = require('../src/i18n');

test('a trim is only a range, and a reset gives the whole clip', () => {
  assert.deepEqual(A.playRange({}, 12), { start: 0, end: 12, length: 12 });
  assert.deepEqual(A.playRange({ trimStart: 2, trimEnd: 8 }, 12), { start: 2, end: 8, length: 6 });
  assert.deepEqual(A.playRange({ trimStart: 2, trimEnd: 99 }, 12), { start: 2, end: 12, length: 10 });
  assert.equal(A.playRange({ trimStart: 0, trimEnd: 12 }, 12).length, 12);
});

test('trim points stay with a clip, and recording again clears them', async () => {
  const s = createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-')));
  const t = await s.createTopic('T');
  const a = await s.addClipFile(t.id, 'a', Buffer.from('original'), '.wav');
  await s.updateClip(t.id, a.id, { trimStart: 1.5, trimEnd: 4 });
  assert.equal((await s.readClip(t.id, a.id)).toString(), 'original');
  assert.equal((await s.getTopic(t.id)).clips[0].trimEnd, 4);
  await s.replaceClip(t.id, a.id, Buffer.from('new'));
  assert.equal((await s.getTopic(t.id)).clips[0].trimStart, undefined);
});

test('arrows are kept tidy when clips are deleted', async () => {
  const s = createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-')));
  const t = await s.createTopic('T');
  const a = await s.addClipFile(t.id, 'a', Buffer.from('a'), '.wav');
  const b = await s.addClipFile(t.id, 'b', Buffer.from('b'), '.wav');
  await s.updateClip(t.id, a.id, { links: [b.id, a.id, 'ghost', b.id] });
  assert.deepEqual((await s.getTopic(t.id)).clips[0].links, [b.id]);
  await s.removeClip(t.id, b.id);
  assert.deepEqual((await s.getTopic(t.id)).clips[0].links, []);
});

test('board reads top to bottom, and new clips find a free place', () => {
  const clips = [{ id: 'c', x: 20, y: 400 }, { id: 'b', x: 300, y: 25 }, { id: 'a', x: 20, y: 20 }];
  assert.deepEqual(B.readingOrder(clips).map((c) => c.id), ['a', 'b', 'c']);
  const list = [{ id: 'a', x: 20, y: 20 }, { id: 'n' }];
  assert.equal(B.placeMissing(list, 2), true);
  assert.equal(list[1].x, 280);
  assert.equal(B.placeMissing(list, 2), false);
});

test('a dropped button never lands on another one', () => {
  const others = [{ id: 'a', x: 20, y: 20 }, { id: 'b', x: 500, y: 20 }];
  const spot = B.settle({ id: 'b' }, 33, 28, others);
  assert.equal(spot.x, 40);
  assert.ok(spot.y >= 20 + B.H + 10);
});

test('arrows decide what comes next, and branches offer a choice', () => {
  const clips = [{ id: 'a', links: ['c', 'd'] }, { id: 'b' }, { id: 'c', links: ['b'] }, { id: 'd' }];
  assert.deepEqual(B.nextChoices(clips, -1), [0]);
  assert.deepEqual(B.nextChoices(clips, 0), [2, 3]);
  assert.deepEqual(B.nextChoices(clips, 2), [1]);
  assert.deepEqual(B.nextChoices(clips, 3), []);
  assert.deepEqual(B.nextChoices([], -1), []);
});

test('setup check reports each problem', () => {
  const good = {
    mode: 'cable', mixMic: true, hasCable: true, defaultMic: 'Default - CABLE Output (VB-Audio)', commsMic: 'Communications - CABLE Output (VB)',
    defaultSpeaker: 'Default - Speakers', toneArrived: true, micHeard: true, listenOn: false, voiceArrived: true,
  };
  assert.ok(A.setupChecks(good).every((c) => c.ok === true));
  const bad = (change) => A.setupChecks({ ...good, ...change }).filter((c) => c.ok === false).map((c) => c.id);
  assert.deepEqual(bad({ defaultMic: 'Default - Microphone' }), ['defaultMic']);
  assert.deepEqual(bad({ commsMic: 'Communications - Microphone' }), ['defaultMic']);
  assert.deepEqual(bad({ defaultSpeaker: 'Default - CABLE Input' }), ['defaultSpeaker']);
  assert.deepEqual(bad({ listenOn: true }), ['listenOff']);
  assert.deepEqual(bad({ voiceArrived: false }), ['voice']);
  assert.deepEqual(bad({ toneArrived: false }), ['tone']);
  assert.deepEqual(bad({ hasCable: false }), ['cable']);
  assert.deepEqual(A.setupChecks({ mode: 'speaker', hasSpeaker: true, micHeard: true }).map((c) => c.ok), [true, true]);
  // Default: Windows carries the voice, so Listen must be on.
  const plain = { ...good, mixMic: false, listenOn: true, voiceArrived: undefined };
  assert.ok(A.setupChecks(plain).every((c) => c.ok === true));
  assert.deepEqual(A.setupChecks(plain).map((c) => c.id), ['cable', 'defaultMic', 'defaultSpeaker', 'tone', 'micHeard', 'listenOn']);
  assert.deepEqual(A.setupChecks({ ...plain, listenOn: false }).filter((c) => c.ok === false).map((c) => c.id), ['listenOn']);
});

test('every word exists in both languages', () => {
  const en = Object.keys(W.words.en).sort();
  assert.deepEqual(Object.keys(W.words.ka).sort(), en);
  for (const key of en) {
    const vars = (x) => (x.match(/\{\w+\}/g) || []).sort();
    assert.deepEqual(vars(W.words.ka[key]), vars(W.words.en[key]), key);
  }
  assert.equal(W.make('ka')('question', { n: 3 }), 'კითხვა 3');
});

test('finds where the voice starts, without changing anything', () => {
  const rate = 48000;
  const s = new Float32Array(rate * 3);
  for (let i = rate; i < rate * 2; i++) s[i] = 0.3 * Math.sin(i / 7);
  const at = A.leadIn(s, rate);
  assert.ok(at > 0.9 && at < 1.0, String(at));
  assert.equal(A.leadIn(new Float32Array(rate), rate), 0);
  const loud = new Float32Array(rate).fill(0.2);
  assert.equal(A.leadIn(loud, rate), 0);
});

test('version numbers compare properly', () => {
  const loader = fs.readFileSync(path.join(__dirname, '../src/loader.js'), 'utf8');
  const newer = new Function(loader.slice(loader.indexOf('function newer'), loader.indexOf('function pickUpdate')) + ' return newer;')();
  assert.equal(newer('1.6.0', '1.5.9'), true);
  assert.equal(newer('1.10.0', '1.9.0'), true);
  assert.equal(newer('1.6.0', '1.6.0'), false);
  assert.equal(newer('1.5.0', '1.6.0'), false);
  assert.equal(newer('2', '1.9.9'), true);
});
