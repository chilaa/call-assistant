// Plain audio helpers. Used by the app and by the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CCAudio = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function peakOf(samples) {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = Math.abs(samples[i]);
      if (v > peak) peak = v;
    }
    return peak;
  }

  function encodeWav(samples, rate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const text = (at, value) => {
      for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
    }
    return buffer;
  }

  // Works out which shortcut each clip uses. Clip shortcuts win over numbers,
  // and neither may take a key that Play next, Stop and the others already use.
  function clipShortcuts(topicClips, alwaysClips, modifier, actionKeys) {
    const used = new Set(Object.values(actionKeys));
    const result = new Map();
    for (const clip of [...topicClips, ...alwaysClips]) {
      if (clip.key && !used.has(clip.key)) {
        used.add(clip.key);
        result.set(clip.id, clip.key);
      }
    }
    topicClips.slice(0, 9).forEach((clip, index) => {
      const key = `${modifier}+${index + 1}`;
      if (!clip.key && !used.has(key)) {
        used.add(key);
        result.set(clip.id, key);
      }
    });
    return result;
  }

  const isCable = (d) => /cable|vb-audio/i.test(d.label || '');
  const isReal = (d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications';
  const likelyHeadset = (d) => /head(set|phone)|hands-?free|earphone|usb/i.test(d.label || '');

  // Picks the three devices. Windows "default" entries are skipped on purpose:
  // the default mic is CABLE Output, and using it would loop the sound.
  function chooseDevices(devices, saved) {
    saved = saved || {};
    const real = devices.filter(isReal);
    const mics = real.filter((d) => d.kind === 'audioinput' && !isCable(d));
    const outputs = real.filter((d) => d.kind === 'audiooutput');
    const headsets = outputs.filter((d) => !isCable(d));
    const cables = outputs.filter((d) => /cable input/i.test(d.label || '') || isCable(d));
    const cableMics = real.filter((d) => d.kind === 'audioinput' && isCable(d));
    const pick = (list, id) =>
      (list.find((d) => d.deviceId === id) || list.find(likelyHeadset) || list[0] || {}).deviceId || '';
    const headsetId = pick(headsets, saved.headsetId);
    const speaker =
      headsets.find((d) => d.deviceId === saved.speakerId) ||
      headsets.find((d) => d.deviceId !== headsetId && /speaker/i.test(d.label || '')) ||
      headsets.find((d) => d.deviceId !== headsetId) ||
      headsets[0] || {};
    return {
      mics,
      headsets,
      cables,
      cableMics,
      speakerId: speaker.deviceId || '',
      micId: pick(mics, saved.micId),
      headsetId,
      callId: (cables.find((d) => d.deviceId === saved.callId) || cables[0] || {}).deviceId || '',
    };
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.round(seconds || 0));
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }

  // Where the voice starts, in seconds. Lets playback skip a quiet start
  // without touching the file. Returns 0 when the clip starts right away.
  function leadIn(samples, rate) {
    const size = Math.max(1, Math.round(rate * 0.01));
    const peaks = [];
    for (let i = 0; i < samples.length; i += size) {
      let peak = 0;
      const end = Math.min(i + size, samples.length);
      for (let j = i; j < end; j++) {
        const v = Math.abs(samples[j]);
        if (v > peak) peak = v;
      }
      peaks.push(peak);
    }
    const loudest = Math.max(...peaks, 0);
    const limit = Math.max(0.01, loudest * 0.08);
    const first = peaks.findIndex((p) => p >= limit);
    if (first <= 0) return 0;
    return Math.max(0, (first * size) / rate - 0.06);
  }

  // The part of a clip that plays. The saved file is never changed.
  function playRange(clip, duration) {
    const start = Math.min(Math.max(0, clip.trimStart || 0), duration);
    const end = clip.trimEnd > start ? Math.min(clip.trimEnd, duration) : duration;
    return { start, end, length: end - start };
  }

  // Turns the setup test's measurements into a list of results.
  // ok is null when an earlier failure makes a check meaningless.
  function setupChecks(d) {
    const isCableMic = (label) => /cable output/i.test(label || '');
    if (d.mode === 'speaker') {
      return [
        { id: 'speaker', ok: Boolean(d.hasSpeaker) },
        { id: 'micHeard', ok: Boolean(d.micHeard) },
      ];
    }
    const cable = Boolean(d.hasCable);
    const heard = Boolean(d.micHeard);
    const flows = cable ? Boolean(d.toneArrived) : null;
    const listed = d.defaultMic !== undefined || d.commsMic !== undefined;
    const checks = [
      { id: 'cable', ok: cable },
      { id: 'defaultMic', ok: cable ? listed && isCableMic(d.defaultMic) && (d.commsMic === undefined || isCableMic(d.commsMic)) : null },
      { id: 'defaultSpeaker', ok: cable ? !/cable/i.test(d.defaultSpeaker || '') : null },
      { id: 'tone', ok: flows },
      { id: 'micHeard', ok: heard },
    ];
    if (d.mixMic) {
      // The app carries her voice, so Windows must not copy it as well.
      checks.push({ id: 'listenOff', ok: flows && heard ? !d.listenOn : null });
      checks.push({ id: 'voice', ok: flows && heard && !d.listenOn ? Boolean(d.voiceArrived) : null });
    } else {
      // Windows carries her voice, so it must reach the cable on its own.
      checks.push({ id: 'listenOn', ok: flows && heard ? Boolean(d.listenOn) : null });
    }
    return checks;
  }

  // Turns a key press into the form Electron uses. Null means "not usable".
  function keyFromEvent(e) {
    let key = null;
    if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
    else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (/^F([1-9]|1\d|2[0-4])$/.test(e.code)) key = e.code;
    else if (e.code === 'Space') key = 'Space';
    else if (e.code === 'Insert' || e.code === 'Home' || e.code === 'End' || e.code === 'PageUp' || e.code === 'PageDown') key = e.code;
    if (!key) return null;
    const mods = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (!mods.length && !/^F\d/.test(key)) return null;
    return [...mods, key].join('+');
  }

  const showKey = (key) => (key || '').replace('Control', 'Ctrl').replace(/\+/g, ' + ');

  return { encodeWav, leadIn, playRange, setupChecks, clipShortcuts, chooseDevices, formatTime, keyFromEvent, showKey, peakOf };
});
