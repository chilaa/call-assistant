const { _electron } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), os = require('os'), path = require('path');
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-v5-'));
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ lang: 'ka' }));
  const app = await _electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron'),
    args: ['.', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: { ...process.env, CALL_CLIPS_DATA: data } });
  const page = await app.firstWindow();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.waitForSelector('#nextLabel'); await page.waitForTimeout(1200);
  for (const [w, h, name] of [[1280, 680, 'wide'], [760, 600, 'narrow']]) {
    await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setContentSize(s[0], s[1]), [w, h]);
    await page.waitForTimeout(400);
    const top = await page.evaluate(() => { const b = document.querySelector('.top').getBoundingClientRect(); return [b.height, [...document.querySelectorAll('.top > *')].map(e => [e.textContent.trim().slice(0, 14), getComputedStyle(e.classList.contains('switch') ? e.querySelector('span:last-child') : e).fontSize, e.scrollWidth <= e.clientWidth])]; });
    console.log(name, 'top bar height', top[0], top[1]);
    await page.screenshot({ path: `shots/v5-${name}-ka.png` });
  }
  console.log('errors', errs);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
