// prepare.js — stage the web app for the Electron build.
//
// 1. Copy the repo-root web app (index.html + css/ + js/) into desktop/build/app/.
// 2. Fetch the web fonts locally (best-effort) into build/app/fonts/.
// 3. Rewrite ONLY the copied index.html so it loads the local fonts.css instead
//    of Google's CDN — making the desktop app work fully offline.
//
// The repo-root web app is never modified: build/app/ is a throwaway copy
// (gitignored), so the single source of truth stays at the repo root and the
// online GitHub Pages version keeps loading fonts from the CDN.
'use strict';

const fs = require('fs');
const path = require('path');
const { fetchFonts } = require('./fetch-fonts');

const DESKTOP_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(DESKTOP_DIR, '..');
const APP_DIR = path.join(DESKTOP_DIR, 'build', 'app');

// Web app runtime as referenced by index.html. docs/, tests/, .shots/ are not
// part of the running app and are intentionally excluded.
const ROOT_FILES = ['index.html'];
const ROOT_DIRS = ['css', 'js'];

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Swap the three Google-Fonts <link> lines in the copied index.html for a single
// local stylesheet link. Returns true if the rewrite was applied.
function rewriteFontLinks(indexPath) {
  let html = fs.readFileSync(indexPath, 'utf8');
  const original = html;

  // Drop the two preconnect hints (no longer needed offline).
  html = html.replace(/^[ \t]*<link rel="preconnect"[^>]*fonts\.googleapis\.com[^>]*>\s*\n/m, '');
  html = html.replace(/^[ \t]*<link rel="preconnect"[^>]*fonts\.gstatic\.com[^>]*>\s*\n/m, '');

  // Replace the Google stylesheet link with the local one (keep indentation).
  html = html.replace(
    /^([ \t]*)<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*" rel="stylesheet">/m,
    '$1<link rel="stylesheet" href="fonts/fonts.css">'
  );

  if (html === original) {
    console.warn('[prepare] font <link> not matched in index.html — leaving CDN links in place.');
    return false;
  }
  fs.writeFileSync(indexPath, html);
  return true;
}

async function main() {
  console.log('[prepare] staging web app into ' + APP_DIR);
  rmrf(path.join(DESKTOP_DIR, 'build'));
  fs.mkdirSync(APP_DIR, { recursive: true });

  for (const f of ROOT_FILES) {
    fs.copyFileSync(path.join(REPO_ROOT, f), path.join(APP_DIR, f));
  }
  for (const d of ROOT_DIRS) {
    copyDir(path.join(REPO_ROOT, d), path.join(APP_DIR, d));
  }

  const fontsOk = await fetchFonts(path.join(APP_DIR, 'fonts'));
  if (fontsOk) {
    const rewritten = rewriteFontLinks(path.join(APP_DIR, 'index.html'));
    if (rewritten) console.log('[prepare] index.html now loads local fonts (offline-ready).');
  } else {
    console.log('[prepare] keeping CDN font links (online fallback) + system-font fallbacks.');
  }

  console.log('[prepare] done.');
}

main().catch(function (err) {
  console.error('[prepare] failed: ' + err.stack);
  process.exit(1);
});
