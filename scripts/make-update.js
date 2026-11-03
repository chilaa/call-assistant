// Builds the app, prepares an update for the updates/ folder, pushes it to
// GitHub (the installed apps then update themselves) and uploads the full
// Windows zip as a GitHub Release for new laptops.
// Works on Windows, macOS and Linux. Usage: npm run release -- "What changed"
// Add --no-push to only build, without committing, pushing or uploading.
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
process.chdir(root);
const args = process.argv.slice(2);
const push = !args.includes('--no-push');
const notes = args.filter((a) => a !== '--no-push').join(' ').trim() || 'Update';
const version = require('../package.json').version;
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const quiet = (cmd) => { try { return execSync(cmd, { stdio: 'pipe' }).toString().trim(); } catch { return null; } };
const REPO = 'chilaa/call-assistant';

function stop(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

// The laptops only install a higher number, so a release with the same
// number would reach nobody.
const published = fs.existsSync('updates/latest.json') ? JSON.parse(fs.readFileSync('updates/latest.json', 'utf8')).version : '0.0.0';
const higher = (a, b) => {
  const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};
if (!higher(version, published)) {
  stop(`Version ${version} is not higher than the last release (${published}).\nRaise "version" in package.json first.`);
}
if (push && quiet('git rev-parse --abbrev-ref HEAD') !== 'main') {
  stop('Releases go out from the main branch. Switch to main first (or use --no-push).');
}

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

const zip = path.join('dist', 'Call-Clips-Windows.zip');
console.log(`\nUpdate ${version} is built (sha256 ${sha256.slice(0, 12)}...).`);
if (!push) {
  console.log('Nothing was pushed (--no-push). To publish later: git add -A && git commit && git push');
  process.exit(0);
}

// Pushing to main is what makes every installed app update.
run('git add -A');
run(`git commit -m ${JSON.stringify(`Release ${version}: ${notes}`)}`);
run('git push origin main');
console.log(`\nPushed. Installed apps will update within a few hours (or when restarted).`);

// The full zip goes to a GitHub Release, not into git (it is too big).
const link = `https://github.com/${REPO}/releases/latest/download/Call-Clips-Windows.zip`;
const manual = `Upload it by hand: https://github.com/${REPO}/releases/new  (tag v${version}, file ${zip})`;
if (!fs.existsSync(zip)) {
  console.log(`\nThe zip was not made, so new laptops still get the old one.\n${manual}`);
} else if (quiet('gh auth status') === null) {
  console.log(`\nThe GitHub tool (gh) is not logged in, so the zip was not uploaded.\nRun "gh auth login" once, then:\n  gh release create v${version} "${zip}" --repo ${REPO} --title "${version}" --notes ${JSON.stringify(notes)}\nOr ${manual}`);
} else {
  try {
    run(`gh release create v${version} "${zip}" --repo ${REPO} --target main --title "${version}" --notes ${JSON.stringify(notes)}`);
    console.log(`\nNew laptops can download the app here (always the newest):\n  ${link}`);
  } catch {
    console.log(`\nThe zip could not be uploaded. ${manual}`);
  }
}
