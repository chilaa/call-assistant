// Draws the icon at several sizes and packs them into one .ico file.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
(async () => {
  const svg = fs.readFileSync('assets/icon.svg', 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
  const pngs = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    pngs.push({ size, png });
    if (size === 256) fs.writeFileSync('assets/icon.png', png);
  }
  await browser.close();
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const entries = []; const blobs = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, png } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0); e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    entries.push(e); blobs.push(png); offset += png.length;
  }
  fs.writeFileSync('assets/icon.ico', Buffer.concat([header, ...entries, ...blobs]));
  console.log('icon.ico', fs.statSync('assets/icon.ico').size, 'bytes');
})();
