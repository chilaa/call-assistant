const { _electron } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), os = require('os'), path = require('path');
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-mode-'));
  const app = await _electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron'),
    args: ['.', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: { ...process.env, CALL_CLIPS_DATA: data } });
  const page = await app.firstWindow();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', m => m.type()==='error' && errs.push(m.text()));
  await page.waitForTimeout(1500);
  const read = () => page.evaluate(() => { const {audio,state}=window.callClipsDebug; return {mode:state.settings.mode, callBus:audio.callBus.gain.value, mic:+audio.micGate.gain.value.toFixed(3), callOk:audio.callOk, speakerId:!!state.devices.speakerId, status:document.getElementById('status').textContent, banner:document.getElementById('banner').textContent}; });
  console.log('cable, no device', await read());
  await page.click('#settingsBtn');
  await page.check('input[name=mode][value=speaker]');
  await page.waitForTimeout(500);
  console.log('speaker', await read());
  await page.screenshot({ path: 'shots/7-no-cable.png' });
  await page.click('#settingsClose');
  console.log('saved mode', JSON.parse(fs.readFileSync(path.join(data,'settings.json'))).mode);
  console.log('errors', errs);
  await app.close();
  // Restart keeps the mode.
  const app2 = await _electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron'),
    args: ['.', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: { ...process.env, CALL_CLIPS_DATA: data } });
  const p2 = await app2.firstWindow(); await p2.waitForTimeout(1200);
  console.log('after restart', await p2.evaluate(() => ({mode:window.callClipsDebug.state.settings.mode, mic:window.callClipsDebug.audio.micGate.gain.value})));
  await app2.close();
})().catch((e) => { console.error(e); process.exit(1); });
