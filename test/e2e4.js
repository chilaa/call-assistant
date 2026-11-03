const { _electron } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), os = require('os'), path = require('path');
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-v4-'));
  const app = await _electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron'),
    args: ['.', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: { ...process.env, CALL_CLIPS_DATA: data } });
  const page = await app.firstWindow();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGE ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.waitForSelector('#nextLabel'); await page.waitForTimeout(1200);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1080, 860));

  const record = async (name, ms, btn = '#recordBtn') => {
    await page.click(btn); await page.fill('#recordName', name);
    await page.click('#recordButtons >> text=Start recording'); await page.waitForTimeout(ms);
    await page.click('#recordButtons >> text=Stop recording');
    await page.waitForSelector('#recordButtons >> text=Save clip');
    await page.click('#recordButtons >> text=Save clip');
    await page.waitForFunction((x) => [...document.querySelectorAll('.clip .name')].some(e => e.textContent === x), name);
    await page.waitForTimeout(200);
  };
  await record('Intro', 1500); await record('Age', 900); await record('Job', 900);
  await record('Bye', 800, '#recordAlwaysBtn');

  // How long from the key press until sound reaches the call path and the headset path.
  const delay = await page.evaluate(async () => {
    const { audio, playNext, stopClip } = window.callClipsDebug;
    audio.callBus.gain.value = 1;
    const tap = (ctx, node) => { const a = ctx.createAnalyser(); a.fftSize = 512; node.connect(a); return a; };
    const callTap = tap(audio.ctx, audio.callBus), headTap = tap(audio.headCtx, audio.headsetBus);
    const peak = (a) => { const d = new Float32Array(a.fftSize); a.getFloatTimeDomainData(d); return Math.max(...d.map(Math.abs)); };
    const t0 = performance.now();
    playNext();
    let callAt = null, headAt = null;
    while (performance.now() - t0 < 1500 && (callAt === null || headAt === null)) {
      if (callAt === null && peak(callTap) > 0.003) callAt = performance.now() - t0;
      if (headAt === null && peak(headTap) > 0.003) headAt = performance.now() - t0;
      await new Promise((r) => setTimeout(r, 2));
    }
    await stopClip();
    return { callMs: callAt && callAt.toFixed(0), headsetMs: headAt && headAt.toFixed(0) };
  });
  console.log('start delay', delay);

  // Skip quiet start: a clip's played length is shorter than its file when it begins quietly.
  const lens = await page.evaluate(() => [...document.querySelectorAll('.board .clip .meta span:first-child')].map(e => e.textContent));
  console.log('shown lengths', lens);

  // Shortcuts switch.
  await page.click('label:has(#shortcutsSwitch)'); await page.waitForTimeout(300);
  console.log('shortcuts off, registered:', await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Space')));
  await page.click('label:has(#shortcutsSwitch)'); await page.waitForTimeout(300);
  console.log('shortcuts on, registered:', await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Space')));

  // Pad window.
  await page.click('label:has(#padSwitch)');
  const padWin = await app.waitForEvent('window');
  await padWin.waitForSelector('.pad-row'); await padWin.waitForTimeout(400);
  console.log('pad rows', await padWin.$$eval('.pad-row .name', (e) => e.map((x) => x.textContent)));
  console.log('pad on top', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => [w.getTitle(), w.isAlwaysOnTop()])));
  await padWin.screenshot({ path: 'shots/v4-pad.png' });
  await padWin.click('.pad-row:has-text("Age")'); await padWin.waitForTimeout(250);
  console.log('pad click plays', await page.evaluate(() => window.callClipsDebug.state.current?.clip.name));
  await padWin.waitForTimeout(150);
  await padWin.screenshot({ path: 'shots/v4-pad-playing.png' });
  await padWin.click('#stopBtn'); await padWin.waitForTimeout(250);
  console.log('pad stop', await page.evaluate(() => window.callClipsDebug.state.current));
  await padWin.click('#onTop'); await padWin.waitForTimeout(200);
  console.log('on top after untick', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('pad')).isAlwaysOnTop()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('pad')).setSize(190, 300));
  await padWin.waitForTimeout(400);
  await padWin.screenshot({ path: 'shots/v4-pad-narrow.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('pad')).close());
  await page.waitForTimeout(300);
  console.log('switch after close', await page.isChecked('#padSwitch'), JSON.parse(fs.readFileSync(path.join(data, 'settings.json'))).pad);
  await page.screenshot({ path: 'shots/v4-main.png' });
  await page.click('#settingsBtn'); await page.waitForTimeout(200);
  await page.click('#addShortcutsBtn'); await page.waitForTimeout(200);
  console.log('shortcut note on linux:', await page.textContent('#shortcutNote'));
  console.log('errors', errs);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
