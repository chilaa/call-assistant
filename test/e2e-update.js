// Serves a fake newer version from a local web server, and checks that the
// app downloads it, offers a restart, and starts the new version next time.
const { _electron } = require('/opt/npm-tools/node_modules/playwright');
const asar = require('@electron/asar');
const http = require('http');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { execSync } = require('child_process');
(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-upd-'));
  const data = path.join(work, 'data'); fs.mkdirSync(data);
  const userData = path.join(work, 'userData'); fs.mkdirSync(userData);
  // Build a copy of the app that claims to be version 9.9.9 and shows it in the title.
  const copy = path.join(work, 'copy'); fs.mkdirSync(copy);
  execSync(`cp -r src assets package.json "${copy}/"`);
  const pkg = JSON.parse(fs.readFileSync(path.join(copy, 'package.json'))); pkg.version = '9.9.9';
  fs.writeFileSync(path.join(copy, 'package.json'), JSON.stringify(pkg));
  const main = fs.readFileSync(path.join(copy, 'src/main.js'), 'utf8').replace("title: 'Call Clips',", "title: 'Call Clips 9.9.9',");
  fs.writeFileSync(path.join(copy, 'src/main.js'), main);
  const served = path.join(work, 'served'); fs.mkdirSync(served);
  await asar.createPackage(copy, path.join(served, 'app-9.9.9.asar'));
  const bytes = fs.readFileSync(path.join(served, 'app-9.9.9.asar'));
  fs.writeFileSync(path.join(served, 'latest.json'), JSON.stringify({ version: '9.9.9', file: 'app-9.9.9.asar', sha256: crypto.createHash('sha256').update(bytes).digest('hex'), notes: 'test' }));
  const server = http.createServer((req, res) => {
    const file = path.join(served, req.url.split('?')[0]);
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;

  const launch = () => _electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron'),
    args: ['.', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--user-data-dir=${userData}`],
    env: { ...process.env, CALL_CLIPS_DATA: data, CALL_CLIPS_UPDATE_URL: base } });

  let app = await launch();
  let page = await app.firstWindow();
  await page.waitForSelector('#nextLabel'); await page.waitForTimeout(800);
  console.log('first title', await page.title(), 'version shown:', await page.evaluate(() => window.callClipsDebug.state.version));
  await page.click('#settingsBtn');
  await page.click('#checkUpdatesBtn');
  await page.waitForFunction(() => !document.getElementById('updateNote').textContent.startsWith('Checking'), null, { timeout: 15000 });
  console.log('note:', await page.textContent('#updateNote'));
  console.log('restart button visible:', await page.isVisible('#restartBtn'));
  await page.screenshot({ path: 'shots/v6-settings-update.png' });
  await page.click('#settingsClose');
  console.log('banner:', await page.textContent('#updateBanner'));
  await page.screenshot({ path: 'shots/v6-update-banner.png' });
  console.log('files:', fs.readdirSync(path.join(userData, 'updates')));
  await app.close();

  app = await launch();
  page = await app.firstWindow();
  await page.waitForSelector('#nextLabel'); await page.waitForTimeout(800);
  console.log('second title', await page.title(), 'version shown:', await page.evaluate(() => window.callClipsDebug.state.version));
  console.log('starting.json cleared:', !fs.existsSync(path.join(userData, 'updates', 'starting.json')));
  await app.close();

  // A broken update must not trap the app: simulate a crash before a clean start.
  fs.writeFileSync(path.join(userData, 'updates', 'starting.json'), JSON.stringify({ version: '9.9.9' }));
  app = await launch();
  page = await app.firstWindow();
  await page.waitForSelector('#nextLabel'); await page.waitForTimeout(500);
  console.log('after fake crash:', await page.title(), 'failed list:', fs.readFileSync(path.join(userData, 'updates', 'failed.json'), 'utf8'));
  await page.click('#settingsBtn'); await page.click('#checkUpdatesBtn');
  await page.waitForFunction(() => !document.getElementById('updateNote').textContent.startsWith('Checking'), null, { timeout: 15000 });
  console.log('note after crash:', await page.textContent('#updateNote'));
  await app.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
