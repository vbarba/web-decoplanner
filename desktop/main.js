// main.js — Electron main process for HALDANE desktop.
//
// Loads the OFFLINE-READY copy of the web app produced by scripts/prepare.js
// (build/app/), which has its fonts bundled locally. The repo-root web app is
// never modified; prepare.js copies it here at build/start time.
'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const INDEX = path.join(__dirname, 'build', 'app', 'index.html');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#04070d', // matches theme-color; avoids white flash on load
    title: 'HALDANE — Decompression Planner',
    // mac/win use the icon baked in by electron-builder; Linux honors this at runtime.
    icon: path.join(__dirname, 'icons', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.removeMenu(); // single-window utility; no menu bar needed

  // localStorage (haldane-plan-v1 / haldane-dives-v1) persists in Electron's
  // per-app userData across launches — no extra wiring required.
  win.loadFile(INDEX);

  // The app has no external links today, but if any are ever added, open them
  // in the OS browser rather than inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
