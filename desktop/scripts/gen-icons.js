// gen-icons.js — regenerate the desktop app icons from icons/icon.svg.
//
// Produces icons/icon.png (1024x1024 master), icon.icns (macOS) and icon.ico
// (Windows). The generated files are COMMITTED so CI never needs an icon
// toolchain — run this only when the mark in icon.svg changes:
//
//   cd desktop && npm install && npm run icons
//
// Uses sharp (SVG -> PNG raster) + png2icons (PNG -> icns/ico). Both are
// devDependencies; neither is needed at runtime or in the release workflow.
'use strict';

const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.resolve(__dirname, '..', 'icons');
const SVG = path.join(ICONS_DIR, 'icon.svg');
const PNG = path.join(ICONS_DIR, 'icon.png');
const ICNS = path.join(ICONS_DIR, 'icon.icns');
const ICO = path.join(ICONS_DIR, 'icon.ico');

async function main() {
  let sharp, png2icons;
  try {
    sharp = require('sharp');
    png2icons = require('png2icons');
  } catch (e) {
    console.error('gen-icons: missing devDependencies. Run `npm install` in desktop/ first.');
    console.error(e.message);
    process.exit(1);
  }

  console.log('gen-icons: rasterizing icon.svg -> icon.png (1024x1024)');
  await sharp(SVG).resize(1024, 1024).png().toFile(PNG);

  const pngBuf = fs.readFileSync(PNG);

  console.log('gen-icons: icon.png -> icon.icns');
  const icns = png2icons.createICNS(pngBuf, png2icons.BILINEAR, 0);
  if (!icns) throw new Error('createICNS returned null');
  fs.writeFileSync(ICNS, icns);

  console.log('gen-icons: icon.png -> icon.ico');
  const ico = png2icons.createICO(pngBuf, png2icons.BILINEAR, 0, /* ico256 */ true);
  if (!ico) throw new Error('createICO returned null');
  fs.writeFileSync(ICO, ico);

  console.log('gen-icons: done (icon.png / icon.icns / icon.ico).');
}

main().catch(function (err) {
  console.error('gen-icons: failed: ' + err.stack);
  process.exit(1);
});
