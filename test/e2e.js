// Runs the real app with a fake mic. Pretends a VB-Cable device exists by
// adding it to the device list, then measures what reaches each output.
const { _electron } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-'));
  const app = await _electron.launch({
    executablePath: path.resolve('node_modules/electron/dist/electron'),
    args: ['.', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: { ...process.env, CALL_CLIPS_DATA: data },
  });
  const page = await app.firstWindow();
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await page.waitForSelector('#nextLabel');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shots/1-first-run.png' });
  console.log('devices', await page.evaluate(() => (navigator.mediaDevices.enumerateDevices()).then(l => l.map(d => d.kind + ':' + d.label))));
  console.log('banner', await page.textContent('#banner'));

  // Record three clips through the real interface with the fake mic.
  for (const name of ['Introduction to the research', 'Question 1', 'Question 2']) {
    await page.click('#recordBtn');
    await page.fill('#recordName', name);
    await page.click('text=Start recording');
    await page.waitForTimeout(1400);
    if (name === 'Question 1') await page.screenshot({ path: 'shots/2-recording.png' });
    await page.click('text=Stop recording');
    await page.waitForSelector('text=Save clip', { timeout: 5000 }).catch(async () => {
      console.log('hint:', await page.textContent('#recordHint'));
    });
    if (name === 'Question 1') await page.screenshot({ path: 'shots/3-review.png' });
    await page.click('text=Save clip');
    await page.waitForTimeout(300);
  }
  await page.click('#recordAlwaysBtn');
  await page.fill('#recordName', 'Thank you and goodbye');
  await page.click('text=Start recording');
  await page.waitForTimeout(800);
  await page.click('text=Stop recording');
  await page.click('text=Save clip');
  await page.waitForTimeout(600);

  const t = await page.evaluate(() => {
    const s = window.callClipsDebug.state;
    return { clips: s.topic.clips.map(c => c.name), always: s.always.clips.map(c => c.name) };
  });
  console.log(t);

  // Measure routing with analysers on the two buses.
  const routing = await page.evaluate(async () => {
    const { audio, playNext, stopClip, state } = window.callClipsDebug;
    audio.callBus.gain.value = 1;
    audio.ctx.resume();
    const tap = (node) => { const a = audio.ctx.createAnalyser(); a.fftSize = 2048; node.connect(a); return a; };
    const callTap = tap(audio.callBus), headTap = tap(audio.headsetBus);
    const peak = (a) => { const d = new Float32Array(a.fftSize); a.getFloatTimeDomainData(d); return Math.max(...d.map(Math.abs)); };
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const out = {};
    await wait(300);
    out.idleCall = peak(callTap); out.idleHeadset = peak(headTap); out.gateIdle = audio.micGate.gain.value;
    playNext();
    await wait(350);
    out.playingName = state.current && state.current.clip.name;
    out.gateDuringClip = audio.micGate.gain.value;
    const c=[],h=[]; for (let i=0;i<8;i++){ c.push(peak(callTap)); h.push(peak(headTap)); await wait(30);} 
    out.clipCall = Math.max(...c); out.clipHeadset = Math.max(...h);
    return out;
  });
  console.log(routing);
  await page.screenshot({ path: 'shots/4-playing.png' });

  const after = await page.evaluate(async () => {
    const { audio, stopClip, state } = window.callClipsDebug;
    await stopClip();
    await new Promise(r => setTimeout(r, 200));
    return { current: state.current, gate: audio.micGate.gain.value, cursor: state.cursor };
  });
  console.log(after);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/5-after-one.png' });

  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/6-settings.png', fullPage: false });
  await page.click('#settingsClose');

  // A key press sent the way the real shortcut does.
  await page.waitForTimeout(400);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('hotkey', 'next'));
  await page.waitForTimeout(250);
  console.log('after next key:', await page.evaluate(() => window.callClipsDebug.state.current?.clip.name));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('hotkey', 'stop'));
  await page.waitForTimeout(150);
  console.log('after stop key:', await page.evaluate(() => window.callClipsDebug.state.current));
  await page.setViewportSize?.({ width: 460, height: 620 });

  console.log('files', fs.readdirSync(path.join(data)), fs.readdirSync(path.join(data, 'Topic 1')));
  console.log('LOGS', logs);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
