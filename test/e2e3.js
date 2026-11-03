const { _electron } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), os = require('os'), path = require('path');
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-v3-'));
  const app = await _electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron'),
    args: ['.', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: { ...process.env, CALL_CLIPS_DATA: data } });
  const page = await app.firstWindow();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGE ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  // Makes two fake devices look like VB-Cable.
  await page.addInitScript(() => {
    const real = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => (await real()).map((d) => {
      let label = d.label;
      if (d.kind === 'audiooutput' && /2$/.test(label)) label = 'CABLE Input (VB-Audio Virtual Cable)';
      if (d.kind === 'audioinput' && /2$/.test(label)) label = 'CABLE Output (VB-Audio Virtual Cable)';
      if (d.deviceId === 'default' && d.kind === 'audioinput') label = 'Default - CABLE Output (VB-Audio Virtual Cable)';
      return { kind: d.kind, deviceId: d.deviceId, groupId: d.groupId, label };
    });
  });
  await page.reload();
  await page.waitForSelector('#nextLabel'); await page.waitForTimeout(1500);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1080, 860));
  await page.waitForTimeout(300);

  const record = async (name, ms, btn = '#recordBtn') => {
    await page.click(btn); await page.fill('#recordName', name);
    await page.click('#recordButtons >> text=Start recording'); await page.waitForTimeout(ms);
    await page.click('#recordButtons >> text=Stop recording');
    await page.waitForSelector('#recordButtons >> text=Save clip');
  };
  const save = async (name) => {
    await page.click('#recordButtons >> text=Save clip');
    await page.waitForFunction((x) => [...document.querySelectorAll('.clip .name')].some(e => e.textContent === x), name);
    await page.waitForTimeout(200);
  };
  const clip = (n) => page.evaluate((n) => { const s = window.callClipsDebug.state; const c = [...s.topic.clips, ...s.always.clips].find((x) => x.name === n); const b = [...s.buffers].find(([k]) => k.includes(c.file)); return { ...c, seconds: b && b[1].duration }; }, n);

  // The bug: a 12 second recording must stay 12 seconds.
  await record('Intro', 12000); await save('Intro');
  await page.waitForTimeout(300);
  const intro = await clip('Intro');
  console.log('12s recording saved as', intro.seconds?.toFixed(2), 's');
  const wav = fs.statSync(path.join(data, 'Topic 1', intro.file)).size;
  console.log('wav seconds on disk', ((wav - 44) / 2 / 48000).toFixed(2));

  await record('Age', 900); await save('Age');
  await record('Works yes', 900); await save('Works yes');
  await record('Works no', 900); await save('Works no');
  await record('Goodbye', 900, '#recordAlwaysBtn'); await save('Goodbye');
  await record('Thank you', 900, '#recordAlwaysBtn'); await save('Thank you');

  const names = () => page.$$eval('.board .name', (e) => e.map((x) => x.textContent));
  console.log('start', await names());
  const tile = (n) => page.locator('.board .clip', { hasText: n });

  // Drag freely, downward to a new row.
  const dragTo = async (n, x, y) => {
    const b = await tile(n).boundingBox();
    const area = await page.locator('#board').boundingBox();
    await page.mouse.move(b.x + 100, b.y + 70); await page.mouse.down();
    await page.mouse.move(area.x + x + 100, area.y + y + 70, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(300);
  };
  await dragTo('Age', 280, 20);
  await dragTo('Works yes', 40, 240);
  await dragTo('Works no', 520, 240);
  console.log('after drags', await names(), await page.evaluate(() => window.callClipsDebug.state.topic.clips.map(c => [c.name, c.x, c.y])));

  // Draw arrows with real mouse moves.
  const arrow = async (from, to) => {
    const h = await tile(from).locator('.link-handle').boundingBox();
    const b = await tile(to).boundingBox();
    await page.mouse.move(h.x + 11, h.y + 11); await page.mouse.down();
    await page.mouse.move(b.x + 115, b.y + 60, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(300);
  };
  await arrow('Intro', 'Age');
  await arrow('Age', 'Works yes');
  await arrow('Age', 'Works no');
  console.log('arrows', await page.locator('path.arrow').count());
  await page.screenshot({ path: 'shots/v3-board.png' });

  // A click still plays, and a branch asks her to choose.
  await tile('Intro').locator('.play').click(); await page.waitForTimeout(200);
  console.log('click plays', await page.evaluate(() => window.callClipsDebug.state.current?.clip.name));
  await page.evaluate(() => window.callClipsDebug.stopClip()); await page.waitForTimeout(400);
  await page.click('#nextBtn'); await page.waitForTimeout(300);
  await page.evaluate(() => window.callClipsDebug.stopClip()); await page.waitForTimeout(400);
  console.log('branch', await page.textContent('#nextLabel'), await page.locator('.clip.is-next').count());
  await page.screenshot({ path: 'shots/v3-branch.png' });
  console.log('done before', await page.locator('.clip.played').count());
  await page.click('#clearDoneBtn'); await page.waitForTimeout(150);
  console.log('done after', await page.locator('.clip.played').count());

  // Trim is undoable.
  await tile('Intro').locator('.more').click(); await page.click('#clipTrim'); await page.waitForTimeout(250);
  const w = await page.locator('#trimWave').boundingBox();
  await page.mouse.move(w.x + 2, w.y + 40); await page.mouse.down(); await page.mouse.move(w.x + w.width * 0.25, w.y + 40, { steps: 5 }); await page.mouse.up();
  await page.mouse.move(w.x + w.width - 2, w.y + 40); await page.mouse.down(); await page.mouse.move(w.x + w.width * 0.5, w.y + 40, { steps: 5 }); await page.mouse.up();
  await page.click('#trimSave'); await page.waitForTimeout(400);
  let c = await clip('Intro');
  console.log('trimmed', c.trimStart?.toFixed(2), c.trimEnd?.toFixed(2), 'file kept', ((fs.statSync(path.join(data, 'Topic 1', c.file)).size - 44) / 96000).toFixed(2));
  await tile('Intro').locator('.more').click(); await page.click('#clipTrim'); await page.waitForTimeout(250);
  console.log('reopen', await page.textContent('#trimInfo'), await page.inputValue('#trimStart'));
  await page.screenshot({ path: 'shots/v3-trim-reopen.png' });
  await page.click('#trimReset'); await page.click('#trimSave'); await page.waitForTimeout(400);
  c = await clip('Intro');
  console.log('after reset plays', c.trimStart, c.trimEnd?.toFixed(2));

  // Setup check.
  await page.click('#checkBtn'); await page.waitForTimeout(200);
  await page.click('#checkRun');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'shots/v3-check-talking.png' });
  await page.waitForFunction(() => !window.callClipsDebug.state.checking, null, { timeout: 15000 });
  console.log('mic gate idle', await page.evaluate(() => window.callClipsDebug.audio.micGate.gain.value));
  await page.waitForTimeout(200);
  console.log('check', await page.$$eval('.check-item', (e) => e.map((x) => x.className.replace('check-item ', '') + ': ' + x.children[1].textContent)));
  await page.screenshot({ path: 'shots/v3-check.png' });
  await page.click('#checkClose');

  // Switch on the main page.
  await page.click('.switch'); await page.waitForTimeout(500);
  console.log('switch', await page.evaluate(() => { const { state, audio } = window.callClipsDebug; return [state.settings.mode, audio.micGate.gain.value, document.getElementById('status').textContent]; }));
  await page.click('.switch'); await page.waitForTimeout(500);

  // Dark, Georgian.
  await page.click('#settingsBtn');
  await page.selectOption('#themeSelect', 'dark');
  await page.selectOption('#langSelect', 'ka');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/v3-settings-dark-ka.png' });
  await page.click('#settingsClose'); await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/v3-dark-ka.png' });

  // Older clips without positions are placed automatically after a restart.
  const left = await page.evaluate(() => [...document.querySelectorAll('[data-t]')].filter(e => /[A-Za-z]{4}/.test(e.textContent) && !/VB-Cable/.test(e.textContent)).map(e => e.dataset.t));
  console.log('still English', left);
  console.log('errors', errs);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
