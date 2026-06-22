// fetch-fonts.js — download the web fonts for OFFLINE use.
//
// The repo-root index.html loads Oxanium + Sometype Mono from Google's CDN. For
// the desktop build we fetch the woff2 files once and emit a local @font-face
// stylesheet so the app renders its real typography with no network.
//
// Best-effort: if the network is unavailable, this returns false and the caller
// leaves the CDN <link> in place. The CSS already declares system-font fallbacks
// (styles.css), so the app still renders either way.
//
// Uses Node 18+ global fetch — no dependencies.
'use strict';

const fs = require('fs');
const path = require('path');

// Same families/weights as index.html. Two requests keep each family's CSS tidy.
const FONT_CSS_URLS = [
  'https://fonts.googleapis.com/css2?family=Oxanium:wght@400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Sometype+Mono:ital,wght@0,400;0,500;0,700;1,400&display=swap',
];

// Google serves woff2 only to browser-like User-Agents; a bare Node UA gets ttf.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function fileNameFromUrl(url) {
  // e.g. https://fonts.gstatic.com/s/oxanium/v19/Rr...woff2 -> oxanium-v19-Rr....woff2
  const clean = url.split('?')[0];
  const parts = clean.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  const family = parts.length >= 3 ? parts[parts.length - 3] : 'font';
  return (family + '-' + last).replace(/[^A-Za-z0-9._-]/g, '_');
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error('empty body for ' + url);
  fs.writeFileSync(dest, buf);
  return buf.length;
}

// Fetches fonts into <fontsDir>/ and writes <fontsDir>/fonts.css.
// Returns true on success, false on any failure (caller falls back to the CDN).
async function fetchFonts(fontsDir) {
  if (typeof fetch !== 'function') {
    console.warn('[fetch-fonts] global fetch unavailable (need Node 18+); skipping — desktop will use CDN/fallback fonts.');
    return false;
  }
  try {
    fs.mkdirSync(fontsDir, { recursive: true });
    let combinedCss = '/* Local copy of Oxanium + Sometype Mono for offline use. */\n';

    for (const cssUrl of FONT_CSS_URLS) {
      const res = await fetch(cssUrl, { headers: { 'User-Agent': BROWSER_UA } });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + cssUrl);
      let css = await res.text();

      // Find every remote woff2 URL, download it, rewrite to a relative path.
      const urlRe = /url\((https:\/\/[^)]+\.woff2)\)/g;
      const seen = {};
      let m;
      while ((m = urlRe.exec(css)) !== null) {
        seen[m[1]] = true;
      }
      const remoteUrls = Object.keys(seen);
      if (remoteUrls.length === 0) {
        throw new Error('no woff2 URLs in CSS for ' + cssUrl + ' (UA gating?)');
      }
      for (const remote of remoteUrls) {
        const local = fileNameFromUrl(remote);
        const bytes = await download(remote, path.join(fontsDir, local));
        console.log('[fetch-fonts] ' + local + ' (' + bytes + ' bytes)');
        css = css.split(remote).join(local); // rewrite url(...) -> relative
      }
      combinedCss += '\n' + css;
    }

    fs.writeFileSync(path.join(fontsDir, 'fonts.css'), combinedCss);
    console.log('[fetch-fonts] wrote ' + path.join(fontsDir, 'fonts.css'));
    return true;
  } catch (err) {
    console.warn('[fetch-fonts] could not bundle fonts: ' + err.message);
    console.warn('[fetch-fonts] desktop build will fall back to CDN (if online) or system fonts.');
    return false;
  }
}

module.exports = { fetchFonts };
