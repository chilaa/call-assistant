#!/usr/bin/env bash
# Builds the app, places the new code file in updates/, and pushes to GitHub.
# Usage: scripts/publish.sh "What changed in this version"
set -euo pipefail
cd "$(dirname "$0")/.."
NOTES="${1:-}"
VERSION="$(node -p "require('./package.json').version")"
TOKEN_FILE="${GH_TOKEN_FILE:-/root/.ccr/gh-token}"

npm test >/dev/null
rm -rf dist
npx --no-install electron-packager . "Call Clips" --platform=win32 --arch=x64 --out=dist --overwrite \
  --electron-zip-dir=../ezip --icon=assets/icon.ico --extra-resource=assets/icon.ico \
  --ignore='^/dist' --ignore='^/test' --ignore='^/shots' --ignore='^/updates' --ignore='^/scripts' --ignore=README.txt >/dev/null

cp "dist/Call Clips-win32-x64/resources/app.asar" "updates/app-${VERSION}.asar"
SHA="$(sha256sum "updates/app-${VERSION}.asar" | cut -d' ' -f1)"
node -e "
const fs = require('fs');
fs.writeFileSync('updates/latest.json', JSON.stringify({ version: '$VERSION', file: 'app-$VERSION.asar', sha256: '$SHA', notes: process.argv[1], date: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
" "$NOTES"
# Keep only the newest few code files in the repository.
ls -1 updates/app-*.asar | sort -V | head -n -3 | xargs -r git rm -q --cached 2>/dev/null || true
ls -1 updates/app-*.asar | sort -V | head -n -3 | xargs -r rm -f

echo "- ${VERSION}: ${NOTES}" >> CHANGELOG.md
cp README.txt "dist/Call Clips-win32-x64/"
(cd dist && zip -qr9 Call-Clips-Windows.zip "Call Clips-win32-x64")

git add -A
git commit -q -m "Release ${VERSION}: ${NOTES}" || true
git push -q "https://x-access-token:$(cat "$TOKEN_FILE")@github.com/chilaa/call-assistant.git" HEAD:main
echo "Published ${VERSION} (${SHA:0:12})"
