const { _electron } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), os = require('os'), path = require('path');
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-v2-'));
  const app = await _electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron'),
    args: ['.', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: { ...process.env, CALL_CLIPS_DATA: data } });
  const page = await app.firstWindow();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGE ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.waitForSelector('#nextLabel'); await page.waitForTimeout(1200);

  const record = async (name) => {
    await page.click('#recordBtn'); await page.fill('#recordName', name);
    await page.click('text=Start recording'); await page.waitForTimeout(2200);
    await page.click('text=Stop recording'); await page.waitForSelector('#recordButtons >> text=Save clip');
  };
  for (const n of ['Introduction', 'Question 1', 'Question 2', 'Question 3']) {
    await record(n);
    await page.click('#recordButtons >> text=Save clip');
    await page.waitForFunction((x) => [...document.querySelectorAll('.clip .name')].some(e => e.textContent === x), n);
  }
  const names = () => page.$$eval('#topicClips .name', (e) => e.map((x) => x.textContent));
  const keys = () => page.$$eval('#topicClips kbd', (e) => e.map((x) => x.textContent));
  console.log('start', await names(), await keys());

  // Colors
  const more = (n) => page.click(`[aria-label="Options for ${n}"]`);
  for (const [n, c] of [['Introduction', 'Blue'], ['Question 1', 'Green'], ['Question 2', 'Orange']]) {
    await more(n); await page.click(`.swatch[aria-label="${c}"]`); await page.waitForTimeout(150);
    if (n === 'Question 1') await page.screenshot({ path: 'shots/v2-clip-menu.png' });
    await page.click('#clipClose');
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/v2-tiles.png' });

  // Drag Question 2 before Introduction, using real mouse moves.
  const box = async (n) => page.locator('.clip', { hasText: n }).first().boundingBox();
  await page.locator('.clip', { hasText: 'Question 2' }).dragTo(page.locator('.clip', { hasText: 'Introduction' }), { targetPosition: { x: 10, y: 60 } });
  await page.waitForTimeout(500);
  console.log('after drag', await names(), await keys());

  // Next follows the new order.
  console.log('next label', await page.textContent('#nextLabel'));

  // Main key
  await page.click('#settingsBtn');
  await page.selectOption('#clipModifier', 'Alt');
  await page.waitForTimeout(300);
  console.log('hint', await page.textContent('#modifierHint'));
  await page.screenshot({ path: 'shots/v2-settings.png' });
  await page.click('#settingsClose');
  console.log('alt keys', await keys());

  // Clip shortcut with a real key press, then a clash.
  await more('Question 3'); await page.click('#clipKey');
  await page.waitForTimeout(150);
  await page.keyboard.press('F7');
  await page.waitForTimeout(300);
  console.log('custom key', await keys());
  await more('Question 2'); await page.click('#clipKey');
  await page.waitForTimeout(150);
  await page.keyboard.press('F7');
  await page.waitForTimeout(200);
  console.log('clash', await page.textContent('#keyDialogError'));
  await page.screenshot({ path: 'shots/v2-keydialog.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);

  // Shortcut plays by id.
  const id = await page.evaluate(() => window.callClipsDebug.state.topic.clips.find((c) => c.name === 'Question 3').id);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0].webContents.send('hotkey', 'clip:' + id), id);
  await page.waitForTimeout(200);
  console.log('hotkey plays', await page.evaluate(() => window.callClipsDebug.state.current?.clip.name));
  await page.evaluate(() => window.callClipsDebug.stopClip());

  // Trim a saved clip by dragging on the waveform.
  const duration = () => page.evaluate(() => { const s = window.callClipsDebug.state; const c = s.topic.clips.find((x) => x.name === 'Introduction'); return [...s.buffers].filter(([k]) => k.includes(c.file)).map(([, b]) => b.duration)[0]; });
  await page.waitForTimeout(300);
  const before = await duration();
  await more('Introduction'); await page.click('#clipTrim'); await page.waitForTimeout(250);
  const w = await page.locator('#trimWave').boundingBox();
  await page.mouse.move(w.x + 2, w.y + 40); await page.mouse.down(); await page.mouse.move(w.x + w.width * 0.25, w.y + 40, { steps: 5 }); await page.mouse.up();
  await page.mouse.move(w.x + w.width - 2, w.y + 40); await page.mouse.down(); await page.mouse.move(w.x + w.width * 0.75, w.y + 40, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(150);
  console.log(await page.textContent('#trimInfo'));
  await page.screenshot({ path: 'shots/v2-trim.png' });
  await page.click('#trimListen'); await page.waitForTimeout(200);
  await page.click('#trimSave'); await page.waitForTimeout(600);
  const c = await page.evaluate(() => window.callClipsDebug.state.topic.clips.find((x) => x.name === 'Introduction'));
  console.log('trim', before, '->', await duration(), 'color kept', c.color);

  // Trim during recording review.
  await record('Question 4');
  await page.click('#recordButtons >> text=Trim'); await page.waitForTimeout(200);
  await page.evaluate(() => { const e = document.getElementById('trimEnd'); e.value = Number(e.max) * 0.5; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#trimSave'); await page.waitForTimeout(200);
  await page.click('#recordButtons >> text=Save clip'); await page.waitForTimeout(500);
  console.log('final', await names());
  await page.screenshot({ path: 'shots/v2-final.png' });
  console.log('errors', errs);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
