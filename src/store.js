// Saves topics and clips as normal files in a folder.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ALWAYS_ID = 'Always use';
const newId = () => crypto.randomBytes(4).toString('hex');

function safeName(name, fallback) {
  const clean = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 60);
  if (!clean || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean)) return fallback;
  return clean;
}

function createStore(root) {
  const folder = (id) => {
    if (typeof id !== 'string' || !id || id !== path.basename(id) || id === '.' || id === '..') {
      throw new Error('Unknown topic');
    }
    return path.join(root, id);
  };
  const metaPath = (id) => path.join(folder(id), 'topic.json');

  async function exists(p) {
    try { await fs.access(p); return true; } catch { return false; }
  }

  async function writeJson(file, data) {
    const temp = file + '.tmp';
    await fs.writeFile(temp, JSON.stringify(data, null, 2));
    await fs.rename(temp, file);
  }

  async function getTopic(id) {
    const meta = JSON.parse(await fs.readFile(metaPath(id), 'utf8'));
    return { id, name: meta.name, clips: meta.clips || [] };
  }

  const saveTopic = (topic) => writeJson(metaPath(topic.id), { name: topic.name, clips: topic.clips });

  async function ensureAlways() {
    if (await exists(metaPath(ALWAYS_ID))) return;
    await fs.mkdir(folder(ALWAYS_ID), { recursive: true });
    await writeJson(metaPath(ALWAYS_ID), { name: 'Always use', clips: [] });
  }

  async function listTopics() {
    await fs.mkdir(root, { recursive: true });
    await ensureAlways();
    const entries = await fs.readdir(root, { withFileTypes: true });
    const topics = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ALWAYS_ID) continue;
      if (!(await exists(metaPath(entry.name)))) continue;
      try {
        const topic = await getTopic(entry.name);
        topics.push({ id: topic.id, name: topic.name });
      } catch { /* Skip a damaged folder rather than stop the app. */ }
    }
    return topics.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function createTopic(name) {
    const base = safeName(name, 'Topic');
    let id = base;
    for (let n = 2; id === ALWAYS_ID || (await exists(folder(id))); n++) id = `${base} ${n}`;
    await fs.mkdir(folder(id), { recursive: true });
    const topic = { id, name: String(name).trim() || base, clips: [] };
    await saveTopic(topic);
    return topic;
  }

  async function renameTopic(id, name) {
    const topic = await getTopic(id);
    topic.name = String(name).trim() || topic.name;
    await saveTopic(topic);
    return topic;
  }

  async function addClipFile(topicId, name, bytes, ext) {
    const topic = await getTopic(topicId);
    const id = newId();
    const file = `${safeName(name, 'Clip')} ${id}${ext}`;
    await fs.writeFile(path.join(folder(topicId), file), bytes);
    const clip = { id, name: String(name).trim() || 'Clip', file };
    topic.clips.push(clip);
    await saveTopic(topic);
    return clip;
  }

  const findClip = (topic, clipId) => {
    const clip = topic.clips.find((c) => c.id === clipId);
    if (!clip) throw new Error('Unknown clip');
    return clip;
  };

  const clipPath = (topicId, clip) => path.join(folder(topicId), path.basename(clip.file));

  async function readClip(topicId, clipId) {
    const topic = await getTopic(topicId);
    return fs.readFile(clipPath(topicId, findClip(topic, clipId)));
  }

  async function replaceClip(topicId, clipId, bytes) {
    const topic = await getTopic(topicId);
    const clip = findClip(topic, clipId);
    const oldPath = clipPath(topicId, clip);
    const file = `${safeName(clip.name, 'Clip')} ${newId()}.wav`;
    await fs.writeFile(path.join(folder(topicId), file), bytes);
    clip.file = file;
    delete clip.trimStart;
    delete clip.trimEnd;
    await saveTopic(topic);
    return { clip, oldPath };
  }

  // Changes a clip's name, color or shortcut. Other fields stay protected.
  async function updateClip(topicId, clipId, change) {
    const topic = await getTopic(topicId);
    const clip = findClip(topic, clipId);
    if ('name' in change) clip.name = String(change.name).trim() || 'Clip';
    if ('color' in change) clip.color = change.color || '';
    if ('key' in change) clip.key = change.key || '';
    if ('links' in change) {
      const known = new Set(topic.clips.map((c) => c.id));
      clip.links = [...new Set(change.links)].filter((id) => known.has(id) && id !== clipId);
    }
    if ('trimStart' in change) {
      clip.trimStart = Math.max(0, Number(change.trimStart) || 0);
      clip.trimEnd = Math.max(0, Number(change.trimEnd) || 0);
    }
    await saveTopic(topic);
  }

  // Saves where each button sits on the board, and their reading order.
  async function saveLayout(topicId, items) {
    const topic = await getTopic(topicId);
    const byId = new Map(topic.clips.map((c) => [c.id, c]));
    const ordered = [];
    for (const { id, x, y } of items) {
      const clip = byId.get(id);
      if (!clip) continue;
      clip.x = Math.max(0, Number(x) || 0);
      clip.y = Math.max(0, Number(y) || 0);
      ordered.push(clip);
    }
    topic.clips = [...ordered, ...topic.clips.filter((c) => !ordered.includes(c))];
    await saveTopic(topic);
  }

  // Puts clips in the order given. Unknown ids are ignored, and no clip is lost.
  async function setOrder(topicId, ids) {
    const topic = await getTopic(topicId);
    const byId = new Map(topic.clips.map((c) => [c.id, c]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    const rest = topic.clips.filter((c) => !ordered.includes(c));
    topic.clips = [...new Set([...ordered, ...rest])];
    await saveTopic(topic);
  }

  async function removeClip(topicId, clipId) {
    const topic = await getTopic(topicId);
    const clip = findClip(topic, clipId);
    topic.clips = topic.clips.filter((c) => c.id !== clipId);
    for (const other of topic.clips) {
      if (other.links) other.links = other.links.filter((id) => id !== clipId);
    }
    await saveTopic(topic);
    return clipPath(topicId, clip);
  }

  async function moveClip(topicId, clipId, step) {
    const topic = await getTopic(topicId);
    const from = topic.clips.findIndex((c) => c.id === clipId);
    const to = from + step;
    if (from < 0 || to < 0 || to >= topic.clips.length) return;
    const [clip] = topic.clips.splice(from, 1);
    topic.clips.splice(to, 0, clip);
    await saveTopic(topic);
  }

  return {
    ALWAYS_ID, root, folder, listTopics, getTopic, createTopic, renameTopic,
    addClipFile, readClip, replaceClip, updateClip, saveLayout, setOrder, removeClip, moveClip,
  };
}

module.exports = { createStore, safeName, ALWAYS_ID };
