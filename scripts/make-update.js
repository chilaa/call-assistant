// Builds the app and prepares an update for the updates/ folder.
// Works on Windows, macOS and Linux. Usage: npm run release -- "What changed"
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
process.chdir(root);
const notes = process.argv.slice(2).join(' ').trim() || 'Update';
const version = require('../package.json').version;
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

console.log(`Building version ${version}...`);
run('npm test');
fs.rmSync('dist', { recursive: true, force: true });
const zipDir = fs.existsSync('../ezip') ? ' --electron-zip-dir=../ezip' : '';
run(`npx --no-install electron-packager . "Call Clips" --platform=win32 --arch=x64 --out=dist --overwrite${zipDir}`
  + ' --icon=assets/icon.ico --extra-resource=assets/icon.ico'
  + ' --ignore=^/dist --ignore=^/test --ignore=^/shots --ignore=^/updates --ignore=^/scripts --ignore=README.txt');

const built = path.join('dist', 'Call Clips-win32-x64');
const asar = path.join('updates', `app-${version}.asar`);
fs.mkdirSync('updates', { recursive: true });
fs.copyFileSync(path.join(built, 'resources', 'app.asar'), asar);
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(asar)).digest('hex');
fs.writeFileSync(path.join('updates', 'latest.json'), JSON.stringify({
  version, file: `app-${version}.asar`, sha256, notes, date: new Date().toISOString().slice(0, 10),
}, null, 2) + '\n');

// Keep only the newest three code files.
const old = fs.readdirSync('updates').filter((f) => /^app-.*\.asar$/.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, -3);
for (const f of old) fs.unlinkSync(path.join('updates', f));

if (!fs.existsSync('CHANGELOG.md')) fs.writeFileSync('CHANGELOG.md', '# Changes\n\n');
fs.appendFileSync('CHANGELOG.md', `- ${version}: ${notes}\n`);
fs.copyFileSync('README.txt', path.join(built, 'README.txt'));
try {
  if (process.platform === 'win32') {
    run(`powershell -NoProfile -Command "Compress-Archive -Force -Path 'dist\\Call Clips-win32-x64' -DestinationPath 'dist\\Call-Clips-Windows.zip'"`);
  } else {
    run('cd dist && zip -qr9 Call-Clips-Windows.zip "Call Clips-win32-x64"');
  }
} catch { console.log('Could not make the zip, but the update files are ready.'); }

console.log(`
Update ${version} is ready.
  updates/app-${version}.asar
  updates/latest.json   (sha256 ${sha256.slice(0, 12)}...)

Next: put both files in the updates/ folder on GitHub (see DOCS.md),
or run: git add -A && git commit -m "Release ${version}" && git push
`);
