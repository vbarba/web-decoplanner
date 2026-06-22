// preload.js — intentionally minimal.
//
// The HALDANE web app is fully self-contained browser JS and needs no bridge to
// the main process. This file exists so contextIsolation has a defined preload
// (and so a context bridge can be added later if ever needed) without granting
// the renderer any Node access.
'use strict';
