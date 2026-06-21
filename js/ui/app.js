/* =============================================================
   HALDANE — UI shell (js/ui/app.js)
   Talks to the engines ONLY through the shared API contract:
     window.DecoEngine.plan(input) / window.VPMB.plan(input)
     window.Charts.renderProfile(el, result, {units})
     window.Charts.renderTissues(el, result, {units})
   All internal state is METRIC; units conversion is display-only.
   ============================================================= */
(function () {
  'use strict';

  /* ----------------------------------------------------------
     Constants
  ---------------------------------------------------------- */
  var LS_KEY = 'haldane-plan-v1';
  var DIVES_KEY = 'haldane-dives-v1';
  // Settings captured in a saved-dive snapshot — everything in defaults() except
  // units (a display preference, not part of the dive) and the profile arrays
  // (segments/gases, stored alongside as their own fields).
  var SETTINGS_FIELDS = ['algorithm', 'gfLow', 'gfHigh', 'vpmConservatism', 'surfacePressure',
    'water', 'descentRate', 'ascentRate', 'lastStopDepth', 'ppO2MaxDeco',
    'segmentTimesIncludeTravel', 'sacBottom', 'sacDeco', 'gasReserve', 'extraReserveBar', 'showTravel'];
  var M2FT = 3.28084;
  var L_PER_CUFT = 28.3168;
  var STOP_INTERVAL = 3;       // m — fixed per contract
  var MIN_STOP_TIME = 1;       // min
  var GAS_SWITCH_STOP_TIME = 1;// min
  var PPO2_BOTTOM_DISPLAY = 1.4; // MOD readout for bottom gases
  var DEBOUNCE_MS = 300;
  var OFFLINE_MSG = 'DECO ENGINE OFFLINE — displaying demonstration data only. Do not dive this plan.';

  var PRESETS = [
    { key: 'air',    label: 'Air',    fO2: 0.21, fHe: 0.00, type: 'bottom' },
    { key: 'ean32',  label: 'EAN32',  fO2: 0.32, fHe: 0.00, type: 'bottom' },
    { key: 'ean50',  label: 'EAN50',  fO2: 0.50, fHe: 0.00, type: 'deco'   },
    { key: 'o2',     label: 'Oxygen', fO2: 1.00, fHe: 0.00, type: 'deco'   },
    { key: 'tx2135', label: '21/35',  fO2: 0.21, fHe: 0.35, type: 'bottom' },
    { key: 'tx1845', label: '18/45',  fO2: 0.18, fHe: 0.45, type: 'bottom' },
    { key: 'tx1555', label: '15/55',  fO2: 0.15, fHe: 0.55, type: 'bottom' },
    { key: 'tx1265', label: '12/65',  fO2: 0.12, fHe: 0.65, type: 'bottom' },
    { key: 'tx1070', label: '10/70',  fO2: 0.10, fHe: 0.70, type: 'bottom' }
  ];

  /* Cylinder presets. `liters` = total internal water volume in L (twinsets
     are summed). `ratedBar` is the nominal working pressure, used only as the
     default fill when a cylinder is first chosen. Surface-equivalent gas
     volume held = liters × pressure(bar) (ideal-gas; deep deco reserves are
     comfortably covered by the rule-of-thirds margin). */
  var CYL_PRESETS = [
    { key: 's80',     label: 'AL80 / S80',   liters: 11.1, ratedBar: 207, twin: false },
    { key: 'al40',    label: 'AL40 (deco)',  liters: 5.7,  ratedBar: 207, twin: false },
    { key: 'al30',    label: 'AL30 (deco)',  liters: 4.3,  ratedBar: 207, twin: false },
    { key: 'al13',    label: 'AL13 (pony)',  liters: 1.9,  ratedBar: 207, twin: false },
    { key: 's10',     label: '10 L',         liters: 10,   ratedBar: 232, twin: false },
    { key: 's12',     label: '12 L',         liters: 12,   ratedBar: 232, twin: false },
    { key: 's15',     label: '15 L',         liters: 15,   ratedBar: 232, twin: false },
    { key: 's18',     label: '18 L',         liters: 18,   ratedBar: 232, twin: false },
    { key: 'd2x10',   label: 'Twins 2×10 L', liters: 20,   ratedBar: 232, twin: true  },
    { key: 'd2x11',   label: 'Twins 2×11 L', liters: 22,   ratedBar: 232, twin: true  },
    { key: 'd2x12',   label: 'Twins 2×12 L', liters: 24,   ratedBar: 232, twin: true  },
    { key: 'd2x15',   label: 'Twins 2×15 L', liters: 30,   ratedBar: 232, twin: true  },
    { key: 'd2x18',   label: 'Twins 2×18 L', liters: 36,   ratedBar: 232, twin: true  }
  ];
  function cylPreset(key) {
    for (var i = 0; i < CYL_PRESETS.length; i++) if (CYL_PRESETS[i].key === key) return CYL_PRESETS[i];
    return null;
  }

  /* Reserve rules.
     - Fraction rules (kind 'frac'): usable = the fraction of the START gas you
       may consume; need ≤ start × usable must hold. Thirds keeps 1/3 (consume
       2/3); half keeps 50%; none allows all.
     - Min-gas rule (kind 'mingas', "rock bottom"): reserve a FIXED volume — the
       gas two divers breathe ascending from the deepest point to the first gas
       switch (×2 for an out-of-air donation), at the configured bottom SAC.
       Applies to the bottom gas; deco gases fall back to thirds. */
  var RESERVE_RULES = {
    none:   { kind: 'frac', usable: 1.00, label: 'No reserve',      short: 'all usable' },
    thirds: { kind: 'frac', usable: 2 / 3, label: 'Rule of thirds',  short: '⅓ reserve' },
    half:   { kind: 'frac', usable: 0.50, label: 'Half + half',     short: '½ reserve' },
    mingas: { kind: 'mingas', label: 'Min gas (bottom→switch ×2)', short: 'min gas ×2' }
  };
  var BAR2PSI = 14.5037744;
  function pressOut(bar) { return imperial() ? Math.round(bar * BAR2PSI) : Math.round(bar); }
  function pressUnit() { return imperial() ? 'psi' : 'bar'; }

  function defaults() {
    return {
      units: 'metric',
      lang: null,            // null = follow the browser; else a forced 2-letter code
      algorithm: 'ZHL16B',
      gfLow: 20, gfHigh: 85,
      vpmConservatism: 2,
      surfacePressure: 1.013,
      water: 'salt',
      descentRate: 18,
      ascentRate: 9,
      lastStopDepth: 6,
      ppO2MaxDeco: 1.61,
      segmentTimesIncludeTravel: true,
      sacBottom: 20,
      sacDeco: 16,
      gasReserve: 'mingas',
      extraReserveBar: 0,    // fixed reserve added on top of every rule (bar)
      showTravel: false,     // view-only: show ascent/descent travel legs in the table
      segments: [{ depth: 45, time: 30, gasId: 'tx2135' }],
      gases: [
        { id: 'tx2135', fO2: 0.21, fHe: 0.35, type: 'bottom', cyl: 'd2x12', startBar: 232 },
        { id: 'ean50',  fO2: 0.50, fHe: 0.00, type: 'deco',   cyl: 's80',  startBar: 207 }
      ]
    };
  }

  /* ----------------------------------------------------------
     State
  ---------------------------------------------------------- */
  var state = defaults();
  var hasI18n = typeof window !== 'undefined' && window.I18N && typeof window.I18N.t === 'function';
  var lastResult = null;       // last result from engine/mock (any ok)
  var lastGoodResult = null;   // last result with ok=true
  var hasPlanned = false;      // live recompute only after 1st success
  var gasSeq = 0;              // unique id counter for added gases
  var planTimer = null;
  var copyTimer = null;
  var summaryCopyTimer = null;
  var saveTimer = null;
  var summaryOpen = false;     // view-only: the summarized/contingency table is shown
  var lastSummary = null;      // last built summary (for COPY)
  var hasEngine = false, hasVPM = false, hasCharts = false;

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* ignore */ }

  /* ----------------------------------------------------------
     Tiny DOM + format helpers
  ---------------------------------------------------------- */
  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function fmt(x, d) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    return Number(x).toFixed(d === undefined ? 1 : d);
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : NaN; }
  function clampInt(v, lo, hi) {
    var n = Math.round(num(v));
    if (!isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, n));
  }

  /* ----------------------------------------------------------
     Units (display only — state & engine calls stay metric)
  ---------------------------------------------------------- */
  function imperial() { return state.units === 'imperial'; }
  function depthOut(m, d) { return imperial() ? fmt(m * M2FT, d === undefined ? 0 : d) : fmt(m, d === undefined ? 0 : d); }
  function depthIn(v) { var n = num(v); return imperial() ? n / M2FT : n; }
  function depthUnit() { return imperial() ? 'ft' : 'm'; }
  function rateOut(mpm) { return imperial() ? fmt(mpm * M2FT, 0) : fmt(mpm, 0); }
  function rateIn(v) { var n = num(v); return imperial() ? n / M2FT : n; }
  function rateUnit() { return imperial() ? 'ft/min' : 'm/min'; }
  function sacOut(l) { return imperial() ? fmt(l / L_PER_CUFT, 2) : fmt(l, 0); }
  function sacIn(v) { var n = num(v); return imperial() ? n * L_PER_CUFT : n; }
  function sacUnit() { return imperial() ? 'ft³/min' : 'L/min'; }
  function volOut(l) { return imperial() ? fmt(l / L_PER_CUFT, 1) : fmt(l, 0); }
  function volUnit() { return imperial() ? 'ft³' : 'L'; }

  /* ----------------------------------------------------------
     Physics helpers for readouts (contract conventions)
  ---------------------------------------------------------- */
  function metersPerBar() { return state.water === 'fresh' ? 10.3 : 10.0; }
  function pAmb(d) { return state.surfacePressure + d / metersPerBar(); }

  function gasNameLocal(g) {
    var o2 = Math.round(g.fO2 * 100);
    var he = Math.round(g.fHe * 100);
    if (he > 0) return o2 + '/' + he;
    if (o2 >= 100) return 'OXYGEN';
    if (o2 === 21) return 'AIR';
    return 'EAN' + o2;
  }
  function gasName(g) {
    if (!g) return '?';
    if (hasEngine && typeof window.DecoEngine.gasName === 'function') {
      try {
        var n = window.DecoEngine.gasName(g);
        if (typeof n === 'string' && n) return n;
      } catch (e) { /* fall through */ }
    }
    return gasNameLocal(g);
  }
  function modLocal(g, ppO2) {
    if (!g || !(g.fO2 > 0)) return null;
    var raw = (ppO2 / g.fO2 - state.surfacePressure) * metersPerBar();
    if (!isFinite(raw)) return null;
    if (raw < 0) return 0;
    return Math.floor(raw / STOP_INTERVAL) * STOP_INTERVAL;
  }
  function gasMod(g, ppO2) {
    if (hasEngine && typeof window.DecoEngine.mod === 'function') {
      try {
        var m = window.DecoEngine.mod(g, ppO2,
          { surfacePressure: state.surfacePressure, water: state.water });
        if (typeof m === 'number' && isFinite(m) && m >= 0 && m <= 330) return m;
      } catch (e) { /* fall through */ }
    }
    return modLocal(g, ppO2);
  }
  /* END counting O2 as narcotic (DecoPlanner convention) */
  function endAt(d, g) {
    var fHe = g ? g.fHe : 0;
    var v = (pAmb(d) * (1 - fHe) - state.surfacePressure) * metersPerBar();
    return Math.max(0, v);
  }
  function gasById(id) {
    for (var i = 0; i < state.gases.length; i++) {
      if (state.gases[i].id === id) return state.gases[i];
    }
    return null;
  }

  /* ----------------------------------------------------------
     Persistence
  ---------------------------------------------------------- */
  function saveState() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
  }
  function loadState() {
    var raw = null;
    try { raw = localStorage.getItem(LS_KEY); } catch (e) { /* ignore */ }
    if (!raw) return;
    var s;
    try { s = JSON.parse(raw); } catch (e) { return; }
    if (!s || typeof s !== 'object') return;
    var d = defaults();
    ['units', 'algorithm', 'water', 'gasReserve'].forEach(function (k) {
      if (typeof s[k] === 'string') d[k] = s[k];
    });
    if (typeof s.lang === 'string' || s.lang === null) d.lang = s.lang;
    ['gfLow', 'gfHigh', 'vpmConservatism', 'surfacePressure', 'descentRate',
     'ascentRate', 'lastStopDepth', 'ppO2MaxDeco', 'sacBottom', 'sacDeco', 'extraReserveBar']
      .forEach(function (k) { if (typeof s[k] === 'number' && isFinite(s[k])) d[k] = s[k]; });
    if (typeof s.segmentTimesIncludeTravel === 'boolean') d.segmentTimesIncludeTravel = s.segmentTimesIncludeTravel;
    if (typeof s.showTravel === 'boolean') d.showTravel = s.showTravel;
    if (Array.isArray(s.gases) && s.gases.length) {
      var gs = s.gases.filter(function (g) {
        return g && typeof g.id === 'string' &&
               typeof g.fO2 === 'number' && typeof g.fHe === 'number' &&
               (g.type === 'bottom' || g.type === 'deco');
      }).map(function (g) {
        // Migrate gases stored before cylinder planning existed.
        if (typeof g.cyl !== 'string' || !cylPreset(g.cyl)) {
          g.cyl = (g.type === 'deco') ? 's80' : 'd2x12';
        }
        if (typeof g.startBar !== 'number' || !isFinite(g.startBar) || g.startBar <= 0) {
          g.startBar = cylPreset(g.cyl).ratedBar;
        }
        return g;
      });
      if (gs.length) d.gases = gs;
    }
    if (!RESERVE_RULES[d.gasReserve]) d.gasReserve = 'thirds';
    if (Array.isArray(s.segments) && s.segments.length) {
      var segs = s.segments.filter(function (sg) {
        return sg && typeof sg.depth === 'number' && typeof sg.time === 'number' &&
               typeof sg.gasId === 'string';
      });
      if (segs.length) d.segments = segs;
    }
    if (d.units !== 'metric' && d.units !== 'imperial') d.units = 'metric';
    coerceState(d);
    state = d;
  }

  // Shared post-load coercion: clamp model/water/last-stop, normalise the reserve
  // rule, and re-run the gas cylinder/start-pressure migration. Used by both
  // loadState (restore) and applyDive (load a saved dive). Mutates `s` in place.
  function coerceState(s) {
    if (s.algorithm !== 'ZHL16C' && s.algorithm !== 'ZHL16B' && s.algorithm !== 'VPMB') s.algorithm = 'ZHL16C';
    if (s.water !== 'salt' && s.water !== 'fresh') s.water = 'salt';
    if (s.lastStopDepth !== 3 && s.lastStopDepth !== 6) s.lastStopDepth = 6;
    if (!RESERVE_RULES[s.gasReserve]) s.gasReserve = 'thirds';
    if (Array.isArray(s.gases)) {
      s.gases.forEach(function (g) {
        if (typeof g.cyl !== 'string' || !cylPreset(g.cyl)) {
          g.cyl = (g.type === 'deco') ? 's80' : 'd2x12';
        }
        if (typeof g.startBar !== 'number' || !isFinite(g.startBar) || g.startBar <= 0) {
          g.startBar = cylPreset(g.cyl).ratedBar;
        }
      });
    }
  }

  /* ----------------------------------------------------------
     Saved dives — named full-snapshot plans, stored separately
     from the auto-saved current plan. UI-only; engines untouched.
  ---------------------------------------------------------- */
  function loadDives() {
    var raw = null;
    try { raw = localStorage.getItem(DIVES_KEY); } catch (e) { /* ignore */ }
    if (!raw) return [];
    var list;
    try { list = JSON.parse(raw); } catch (e) { return []; }
    if (!Array.isArray(list)) return [];
    return list.filter(function (r) {
      return r && typeof r.name === 'string' && r.dive && typeof r.dive === 'object';
    });
  }
  function persistDives(list) {
    try { localStorage.setItem(DIVES_KEY, JSON.stringify(list)); } catch (e) { /* private mode */ }
  }

  // Deep-copy the current plan into a portable snapshot record.
  function snapshotCurrentDive() {
    var settings = {};
    SETTINGS_FIELDS.forEach(function (k) { settings[k] = state[k]; });
    return {
      settings: settings,
      segments: state.segments.map(function (s) { return { depth: s.depth, time: s.time, gasId: s.gasId }; }),
      gases: state.gases.map(function (g) {
        return { id: g.id, fO2: g.fO2, fHe: g.fHe, type: g.type, cyl: g.cyl, startBar: g.startBar };
      })
    };
  }

  // Restore a saved dive onto `state`, defensively (mirrors loadState validation).
  // Leaves state.units untouched — units are a display preference, not part of the dive.
  function applyDive(dive) {
    if (!dive || typeof dive !== 'object') return;
    var d = defaults();
    d.units = state.units;
    var src = dive.settings || {};
    ['algorithm', 'water', 'gasReserve'].forEach(function (k) {
      if (typeof src[k] === 'string') d[k] = src[k];
    });
    ['gfLow', 'gfHigh', 'vpmConservatism', 'surfacePressure', 'descentRate',
     'ascentRate', 'lastStopDepth', 'ppO2MaxDeco', 'sacBottom', 'sacDeco', 'extraReserveBar']
      .forEach(function (k) { if (typeof src[k] === 'number' && isFinite(src[k])) d[k] = src[k]; });
    if (typeof src.segmentTimesIncludeTravel === 'boolean') d.segmentTimesIncludeTravel = src.segmentTimesIncludeTravel;
    if (typeof src.showTravel === 'boolean') d.showTravel = src.showTravel;

    if (Array.isArray(dive.gases) && dive.gases.length) {
      var gs = dive.gases.filter(function (g) {
        return g && typeof g.id === 'string' &&
               typeof g.fO2 === 'number' && typeof g.fHe === 'number' &&
               (g.type === 'bottom' || g.type === 'deco');
      }).map(function (g) {
        return { id: g.id, fO2: g.fO2, fHe: g.fHe, type: g.type, cyl: g.cyl, startBar: g.startBar };
      });
      if (gs.length) d.gases = gs;
    }
    if (Array.isArray(dive.segments) && dive.segments.length) {
      var segs = dive.segments.filter(function (sg) {
        return sg && typeof sg.depth === 'number' && typeof sg.time === 'number' &&
               typeof sg.gasId === 'string';
      });
      if (segs.length) d.segments = segs;
    }
    coerceState(d);
    if (!hasVPM && d.algorithm === 'VPMB') d.algorithm = 'ZHL16C';
    state = d;
  }

  // Upsert by name (newest wins), persist, refresh the list UI.
  function saveDive(name) {
    name = (name || '').trim();
    if (!name) return false;
    var list = loadDives();
    var rec = { name: name, ts: Date.now(), dive: snapshotCurrentDive() };
    var idx = -1;
    for (var i = 0; i < list.length; i++) { if (list[i].name === name) { idx = i; break; } }
    if (idx >= 0) list[idx] = rec; else list.push(rec);
    persistDives(list);
    renderDives();
    return true;
  }
  function deleteDive(name) {
    var list = loadDives().filter(function (r) { return r.name !== name; });
    persistDives(list);
    renderDives();
  }

  function exportDives() {
    var text = JSON.stringify(loadDives(), null, 2);
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'haldane-dives.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    } catch (e) {
      showBanner('EXPORT FAILED — ' + (e && e.message ? e.message : 'cannot write file'), true);
    }
  }
  function importDives(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var incoming;
      try { incoming = JSON.parse(reader.result); } catch (e) {
        showBanner('IMPORT FAILED — not valid JSON', true);
        return;
      }
      if (!Array.isArray(incoming)) {
        showBanner('IMPORT FAILED — expected a list of saved dives', true);
        return;
      }
      var valid = incoming.filter(function (r) {
        return r && typeof r.name === 'string' && r.dive && typeof r.dive === 'object';
      });
      if (!valid.length) {
        showBanner('IMPORT FAILED — no saved dives found in file', true);
        return;
      }
      var list = loadDives();
      valid.forEach(function (rec) {
        var name = rec.name.trim();
        if (!name) return;
        var merged = { name: name, ts: (typeof rec.ts === 'number') ? rec.ts : Date.now(), dive: rec.dive };
        var idx = -1;
        for (var i = 0; i < list.length; i++) { if (list[i].name === name) { idx = i; break; } }
        if (idx >= 0) list[idx] = merged; else list.push(merged);
      });
      persistDives(list);
      renderDives();
    };
    reader.onerror = function () { showBanner('IMPORT FAILED — could not read file', true); };
    reader.readAsText(file);
  }

  /* ----------------------------------------------------------
     Build the exact contract input object
  ---------------------------------------------------------- */
  function buildInput() {
    return {
      algorithm: state.algorithm,
      gfLow: Math.round(state.gfLow),
      gfHigh: Math.round(state.gfHigh),
      vpmConservatism: Math.round(state.vpmConservatism),
      surfacePressure: state.surfacePressure,
      water: state.water,
      descentRate: state.descentRate,
      ascentRate: state.ascentRate,
      stopInterval: STOP_INTERVAL,
      lastStopDepth: state.lastStopDepth,
      minStopTime: MIN_STOP_TIME,
      gasSwitchStopTime: GAS_SWITCH_STOP_TIME,
      ppO2MaxDeco: state.ppO2MaxDeco,
      segmentTimesIncludeTravel: state.segmentTimesIncludeTravel,
      segments: state.segments.map(function (s) {
        return { depth: s.depth, time: s.time, gasId: s.gasId };
      }),
      gases: state.gases.map(function (g) {
        return { id: g.id, fO2: g.fO2, fHe: g.fHe, type: g.type };
      }),
      sacBottom: state.sacBottom,
      sacDeco: state.sacDeco
    };
  }

  /* ==========================================================
     MOCK RESULT — used ONLY when window.DecoEngine is undefined
     (engine-load failure fallback; integration needs no changes:
       result = window.DecoEngine ? DecoEngine.plan(input) : MOCK)
     Realistic 45 m / 25 min 21/35 dive with 6 stops, EAN50 deco.
     Matches the shared result contract field-for-field.
  ========================================================== */
  function buildMock(input) {
    var sp = input.surfacePressure;
    var mb = input.water === 'fresh' ? 10.3 : 10.0;
    var GAS = {
      tx2135: { fO2: 0.21, fHe: 0.35 },
      ean50:  { fO2: 0.50, fHe: 0.00 },
      o2:     { fO2: 1.00, fHe: 0.00 }
    };
    function pa(d) { return sp + d / mb; }
    function po2(gid, d) { return GAS[gid].fO2 * pa(d); }

    var rows = [];
    var ceilV = [{ t: 0, c: 0 }]; // fabricated, plausible ceiling vertices
    var t = 0;
    function row(phase, d0, d1, dur, gid, ceil) {
      t += dur;
      rows.push({
        phase: phase, startDepth: d0, endDepth: d1, duration: dur,
        runtime: t, gasId: gid,
        ppO2Start: po2(gid, d0), ppO2End: po2(gid, d1)
      });
      ceilV.push({ t: t, c: ceil });
    }

    var ar = input.ascentRate || 9;
    row('desc', 0, 45, 45 / (input.descentRate || 18), 'tx2135', 0);
    row('level', 45, 45, 25 - 45 / (input.descentRate || 18), 'tx2135', 18.5);
    row('asc', 45, 21, 24 / ar, 'tx2135', 18.5);
    row('switch', 21, 21, 0, 'ean50', 18.5);
    var stopsDef = [[21, 1, 'ean50'], [18, 1, 'ean50'], [15, 2, 'ean50'],
                    [12, 3, 'ean50'], [9, 5, 'ean50'], [6, 12, 'o2']];
    for (var i = 0; i < stopsDef.length; i++) {
      var d = stopsDef[i][0], st = stopsDef[i][1], gid = stopsDef[i][2];
      if (gid !== rows[rows.length - 1].gasId) row('switch', d, d, 0, gid, d);
      var next = (i + 1 < stopsDef.length) ? stopsDef[i + 1][0] : 0;
      row('stop', d, d, st, gid, next === 0 ? 0 : next);
      row('asc', d, next, (d - next) / ar, gid, next === 0 ? 0 : next);
    }

    var stops = [];
    rows.forEach(function (r) {
      if (r.phase === 'stop') {
        stops.push({ depth: r.startDepth, time: r.time === undefined ? Math.round(r.duration) : r.time, runtime: r.runtime, gasId: r.gasId });
      }
    });

    // gas usage per contract: sac(phase) * avg(Pamb) * duration
    var usage = { tx2135: 0, ean50: 0, o2: 0 };
    rows.forEach(function (r) {
      var sac = (r.phase === 'desc' || r.phase === 'level') ? input.sacBottom : input.sacDeco;
      usage[r.gasId] += sac * (pa(r.startDepth) + pa(r.endDepth)) / 2 * r.duration;
    });
    var gasUsage = Object.keys(GAS).map(function (gid) {
      return { gasId: gid, fO2: GAS[gid].fO2, fHe: GAS[gid].fHe, liters: usage[gid] };
    });

    // oxygen toxicity, NOAA CNS table + OTU formula from the contract
    var CNS_T = [[0.5, Infinity], [0.6, 720], [0.7, 570], [0.8, 450], [0.9, 360],
                 [1.0, 300], [1.1, 240], [1.2, 210], [1.3, 180], [1.4, 150],
                 [1.5, 120], [1.6, 45]];
    function cnsMax(p) {
      if (p <= 0.5) return Infinity;
      if (p >= 1.6) return Math.max(1, 45 - 750 * (p - 1.6));
      for (var k = 1; k < CNS_T.length; k++) {
        if (p <= CNS_T[k][0]) {
          var p0 = CNS_T[k - 1][0], p1 = CNS_T[k][0];
          var m0 = CNS_T[k - 1][1], m1 = CNS_T[k][1];
          if (!isFinite(m0)) m0 = 900;
          return m0 + (m1 - m0) * (p - p0) / (p1 - p0);
        }
      }
      return 45;
    }
    var cns = 0, otu = 0;
    rows.forEach(function (r) {
      var p = (r.ppO2Start + r.ppO2End) / 2;
      if (r.duration <= 0) return;
      cns += r.duration / cnsMax(p) * 100;
      if (p > 0.5) otu += r.duration * Math.pow((p - 0.5) / 0.5, 0.833);
    });

    // fine-grained profile + ceiling samples (step <= 0.5 min, all vertices)
    var profile = [], ceilingProfile = [];
    function ceilAt(tt) {
      for (var k = 1; k < ceilV.length; k++) {
        if (tt <= ceilV[k].t + 1e-9) {
          var a = ceilV[k - 1], b = ceilV[k];
          if (b.t - a.t < 1e-9) return b.c;
          return a.c + (b.c - a.c) * (tt - a.t) / (b.t - a.t);
        }
      }
      return 0;
    }
    var t0 = 0, d0 = 0;
    profile.push({ t: 0, depth: 0, gasId: rows[0].gasId });
    ceilingProfile.push({ t: 0, ceiling: 0 });
    rows.forEach(function (r) {
      var t1 = r.runtime;
      var steps = Math.max(1, Math.ceil((t1 - t0) / 0.5));
      for (var k = 1; k <= steps; k++) {
        var tt = Math.min(t1, t0 + (t1 - t0) * k / steps);
        var dd = r.startDepth + (r.endDepth - r.startDepth) * ((tt - t0) / Math.max(t1 - t0, 1e-9));
        profile.push({ t: tt, depth: dd, gasId: r.gasId });
        ceilingProfile.push({ t: tt, ceiling: Math.max(0, ceilAt(tt)) });
      }
      t0 = t1; d0 = r.endDepth;
    });

    var finalTissues = [];
    for (var c = 0; c < 16; c++) {
      var pN2 = 1.35 - c * 0.034;
      var pHe = 0.05 + 0.13 * Math.exp(-c / 3.2);
      finalTissues.push({
        pN2: pN2, pHe: pHe, pTotal: pN2 + pHe,
        gfSurfacePct: input.algorithm === 'VPMB' ? null : Math.round(76 - c * 3.4)
      });
    }

    var stopTime = 0;
    stops.forEach(function (s) { stopTime += s.time; });
    var ascAbove = 0;
    rows.forEach(function (r) {
      if (r.phase === 'asc' && r.startDepth <= 21) ascAbove += r.duration;
    });

    return {
      ok: true,
      errors: [],
      warnings: ['Demonstration data — deco engine module not loaded'],
      algorithm: input.algorithm,
      params: {
        gfLow: input.gfLow, gfHigh: input.gfHigh,
        vpmConservatism: input.vpmConservatism,
        lastStopDepth: input.lastStopDepth,
        surfacePressure: sp, water: input.water
      },
      table: rows,
      stops: stops.map(function (s, i2) {
        return { depth: s.depth, time: stopsDef[i2][1], runtime: s.runtime, gasId: s.gasId };
      }),
      noDeco: false,
      ndl: null,
      firstStopDepth: 21,
      totalRuntime: t,
      totalDecoTime: stopTime + ascAbove,
      gasUsage: gasUsage,
      oxygen: { cns: cns, otu: otu },
      profile: profile,
      ceilingProfile: ceilingProfile,
      finalTissues: finalTissues
    };
  }
  /* ================== end MOCK ================== */

  /* ----------------------------------------------------------
     Validation (metric internally; messages in display units)
  ---------------------------------------------------------- */
  function validate() {
    var errors = [];
    var fields = {};
    function bad(key, msg) { fields[key] = true; if (msg) errors.push(msg); }

    if (!state.segments.length) errors.push('At least one dive segment is required');
    state.segments.forEach(function (s, i) {
      var n = i + 1;
      if (!(s.depth >= 1 && s.depth <= 200)) {
        bad('seg-' + i + '-depth', 'Segment ' + n + ': depth must be ' +
          depthOut(1) + '–' + depthOut(200) + ' ' + depthUnit());
      }
      if (!(s.time >= 1 && s.time <= 999)) {
        bad('seg-' + i + '-time', 'Segment ' + n + ': time must be 1–999 min');
      }
      if (!gasById(s.gasId)) {
        bad('seg-' + i + '-gas', 'Segment ' + n + ': gas no longer exists');
      }
    });

    if (!state.gases.length) errors.push('At least one gas is required');
    var hasBottom = false;
    state.gases.forEach(function (g, i) {
      var n = i + 1;
      if (g.type === 'bottom') hasBottom = true;
      if (!(g.fO2 > 0 && g.fO2 <= 1)) bad('gas-' + i + '-o2', 'Gas ' + n + ': O₂ must be 1–100%');
      if (!(g.fHe >= 0 && g.fHe < 1)) bad('gas-' + i + '-he', 'Gas ' + n + ': He must be 0–99%');
      if (g.fO2 + g.fHe > 1.0001) {
        bad('gas-' + i + '-o2');
        bad('gas-' + i + '-he', 'Gas ' + n + ' (' + gasName(g) + '): O₂ + He exceeds 100%');
      }
    });
    if (state.gases.length && !hasBottom) errors.push('At least one BOTTOM gas is required');

    if (state.algorithm !== 'VPMB') {   // GF applies to both ZHL16C and ZHL16B
      if (!(state.gfLow >= 5 && state.gfLow <= 100)) bad('gfLow', 'GF low must be 5–100');
      if (!(state.gfHigh >= 5 && state.gfHigh <= 100)) bad('gfHigh', 'GF high must be 5–100');
      if (state.gfLow > state.gfHigh) { bad('gfLow'); bad('gfHigh', 'GF low cannot exceed GF high'); }
    }
    if (!(state.descentRate >= 1 && state.descentRate <= 30)) bad('descentRate', 'Descent rate must be ' + rateOut(1) + '–' + rateOut(30) + ' ' + rateUnit());
    if (!(state.ascentRate >= 1 && state.ascentRate <= 30)) bad('ascentRate', 'Ascent rate must be ' + rateOut(1) + '–' + rateOut(30) + ' ' + rateUnit());
    if (!(state.surfacePressure >= 0.5 && state.surfacePressure <= 1.2)) bad('surfacePressure', 'Surface pressure must be 0.5–1.2 bar');
    if (!(state.ppO2MaxDeco >= 0.4 && state.ppO2MaxDeco <= 2)) bad('ppO2MaxDeco', 'Deco ppO₂ limit must be 0.4–2.0 bar');
    if (!(state.sacBottom >= 1 && state.sacBottom <= 100)) bad('sacBottom', 'Bottom SAC out of range');
    if (!(state.sacDeco >= 1 && state.sacDeco <= 100)) bad('sacDeco', 'Deco SAC out of range');
    if (!(state.extraReserveBar >= 0 && state.extraReserveBar <= 300)) bad('extraReserveBar', 'Extra reserve must be 0–300 bar');

    return { errors: errors, fields: fields };
  }

  function applyValidation() {
    var v = validate();
    var nodes = document.querySelectorAll('.rail [data-vkey]');
    for (var i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute('data-vkey');
      nodes[i].classList.toggle('invalid', !!v.fields[k]);
    }
    // gas over-100% tint
    var gasRows = document.querySelectorAll('#gases-list .gas-row');
    for (var j = 0; j < gasRows.length; j++) {
      var g = state.gases[j];
      gasRows[j].classList.toggle('gas-overfull', !!g && (g.fO2 + g.fHe > 1.0001));
    }
    var btn = $('plan-btn'), wrap = $('plan-wrap'), reason = $('plan-reason');
    var blocked = v.errors.length > 0;
    btn.disabled = blocked;
    wrap.title = blocked ? v.errors.join('\n') : '';
    reason.hidden = !blocked;
    reason.textContent = blocked ? v.errors[0] : '';
    return v;
  }

  /* ----------------------------------------------------------
     LEFT RAIL rendering
  ---------------------------------------------------------- */
  function gasOption(g, selectedId) {
    var o = mk('option', null, gasName(g) + (g.type === 'deco' ? ' · deco' : ''));
    o.value = g.id;
    if (g.id === selectedId) o.selected = true;
    return o;
  }

  function renderSegments() {
    var body = $('segments-body');
    clear(body);
    state.segments.forEach(function (s, i) {
      var tr = mk('tr');

      var tdD = mk('td', 'col-depth');
      var inD = mk('input');
      inD.type = 'number'; inD.min = '1'; inD.step = '1'; inD.inputMode = 'decimal';
      inD.value = depthOut(s.depth);
      inD.setAttribute('data-seg', i); inD.setAttribute('data-field', 'depth');
      inD.setAttribute('data-vkey', 'seg-' + i + '-depth');
      inD.setAttribute('aria-label', 'Segment ' + (i + 1) + ' depth (' + depthUnit() + ')');
      tdD.appendChild(inD);

      var tdT = mk('td', 'col-time');
      var inT = mk('input');
      inT.type = 'number'; inT.min = '1'; inT.max = '999'; inT.step = '1'; inT.inputMode = 'numeric';
      inT.value = fmt(s.time, 0);
      inT.setAttribute('data-seg', i); inT.setAttribute('data-field', 'time');
      inT.setAttribute('data-vkey', 'seg-' + i + '-time');
      inT.setAttribute('aria-label', 'Segment ' + (i + 1) + ' time (minutes)');
      tdT.appendChild(inT);

      var tdG = mk('td');
      var sel = mk('select');
      sel.setAttribute('data-seg', i); sel.setAttribute('data-field', 'gasId');
      sel.setAttribute('data-vkey', 'seg-' + i + '-gas');
      sel.setAttribute('aria-label', 'Segment ' + (i + 1) + ' gas');
      state.gases.forEach(function (g) { sel.appendChild(gasOption(g, s.gasId)); });
      tdG.appendChild(sel);

      var tdX = mk('td');
      var rm = mk('button', 'icon-btn', '✕');
      rm.type = 'button';
      rm.setAttribute('data-remove-seg', i);
      rm.setAttribute('aria-label', 'Remove segment ' + (i + 1));
      rm.title = 'Remove level';
      tdX.appendChild(rm);

      tr.appendChild(tdD); tr.appendChild(tdT); tr.appendChild(tdG); tr.appendChild(tdX);
      body.appendChild(tr);
    });
  }

  function gasReadoutText(g) {
    var isDeco = g.type === 'deco';
    var pp = isDeco ? state.ppO2MaxDeco : PPO2_BOTTOM_DISPLAY;
    var m = gasMod(g, pp);
    var modTxt = (m === null) ? '—' : depthOut(m) + ' ' + depthUnit();
    var endTxt = (m === null) ? '—' : depthOut(endAt(m, g)) + ' ' + depthUnit();
    return { mod: modTxt, end: endTxt, pp: pp };
  }

  /* ----------------------------------------------------------
     Cylinder gas-supply math (pure presentation: the engine
     already gives surface-equivalent liters consumed per gas).
     A cylinder of V liters at P bar holds ~V·P surface liters.
  ---------------------------------------------------------- */
  function gasCylinder(g) {
    var c = cylPreset(g && g.cyl) || cylPreset('s80');
    var startBar = (g && isFinite(g.startBar) && g.startBar > 0) ? g.startBar : c.ratedBar;
    return { preset: c, startBar: startBar, capacityL: c.liters * startBar };
  }

  /* "Rock bottom" minimum gas: the surface-equivalent liters two divers breathe
     ascending from the deepest point of the dive to the first gas-switch depth
     (or the surface if there is no switch), at the configured bottom SAC.
       liters = 2 × sacBottom × ascentMinutes × avgAmbientPressure(deep→switch)
     Returns { liters, fromDepth, toDepth } or null when it can't be computed.
     Derived from the plan profile so it tracks the actual dive. */
  function minGasReserve(result) {
    if (!result || !result.table) return null;
    var deepest = 0;
    result.table.forEach(function (r) {
      deepest = Math.max(deepest, r.startDepth || 0, r.endDepth || 0);
    });
    if (deepest <= 0) return null;
    // First gas switch on ascent = shallowest depth at which a 'switch' row sits
    // at or below the deepest depth; if none, ascend all the way to the surface.
    var switchDepth = 0;
    var switchRows = result.table.filter(function (r) { return r.phase === 'switch'; });
    if (switchRows.length) {
      // the deepest switch is the first one reached on the way up
      switchDepth = switchRows.reduce(function (m, r) { return Math.max(m, r.startDepth); }, 0);
    }
    if (switchDepth >= deepest) switchDepth = 0;   // pathological; reserve to surface
    var ascentMin = (deepest - switchDepth) / (state.ascentRate > 0 ? state.ascentRate : 9);
    var avgP = (pAmb(deepest) + pAmb(switchDepth)) / 2;
    var liters = 2 * state.sacBottom * ascentMin * avgP;
    return { liters: liters, fromDepth: deepest, toDepth: switchDepth, ascentMin: ascentMin };
  }

  /* Returns null if the gas was never breathed, else a full supply report.
     `ctx` (optional) carries cross-gas context: { minGas, bottomGasId } so the
     min-gas rule can apply its fixed reserve to the bottom gas. */
  function gasSupply(g, litersUsed, ctx) {
    if (!g) return null;
    var rule = RESERVE_RULES[state.gasReserve] || RESERVE_RULES.thirds;
    var cyl = gasCylinder(g);
    var needBar = cyl.preset.liters > 0 ? litersUsed / cyl.preset.liters : Infinity;

    var ruleBar, reserveLiters = null, isMinGas = false;
    if (rule.kind === 'mingas' && ctx && ctx.minGas && ctx.bottomGasId === g.id) {
      // Fixed-volume reserve on the bottom gas: convert liters → bar of THIS tank.
      isMinGas = true;
      reserveLiters = ctx.minGas.liters;
      ruleBar = cyl.preset.liters > 0 ? reserveLiters / cyl.preset.liters : Infinity;
    } else if (rule.kind === 'mingas') {
      // Deco gas (or no bottom-gas match): min-gas doesn't model donate-gas on a
      // stage; fall back to thirds so the card still gives sensible guidance.
      ruleBar = cyl.startBar * (1 / 3);
    } else {
      ruleBar = cyl.startBar * (1 - rule.usable);
    }
    // A fixed extra reserve (default 40 bar) is added on top of EVERY rule,
    // on every gas — a blunt safety floor the diver always keeps in the tank.
    var extraBar = (isFinite(state.extraReserveBar) && state.extraReserveBar > 0) ? state.extraReserveBar : 0;
    var reserveBar = ruleBar + extraBar;
    var usableBar = Math.max(0, cyl.startBar - reserveBar);
    var usedFrac = cyl.startBar > 0 ? needBar / cyl.startBar : 1;   // of full tank
    var ok = needBar <= usableBar + 1e-6;
    var marginBar = usableBar - needBar;          // bar of usable gas left over
    return {
      cyl: cyl, rule: rule,
      litersUsed: litersUsed,
      capacityL: cyl.capacityL,
      needBar: needBar, usableBar: usableBar, reserveBar: reserveBar,
      ruleBar: ruleBar, extraBar: extraBar,    // reserve breakdown for the card
      reserveLiters: reserveLiters, isMinGas: isMinGas,
      startBar: cyl.startBar, usedFrac: usedFrac, ok: ok, marginBar: marginBar,
      // smallest whole-bar fill that satisfies the reserve rule, for advice
      minStartBar: Math.ceil(needBar + reserveBar)
    };
  }

  function renderGases() {
    var list = $('gases-list');
    clear(list);
    state.gases.forEach(function (g, i) {
      var row = mk('div', 'gas-row');

      var fo = mk('div', 'gas-frac');
      var inO = mk('input');
      inO.type = 'number'; inO.min = '1'; inO.max = '100'; inO.step = '1'; inO.inputMode = 'numeric';
      inO.value = Math.round(g.fO2 * 100);
      inO.setAttribute('data-gas', i); inO.setAttribute('data-field', 'fO2');
      inO.setAttribute('data-vkey', 'gas-' + i + '-o2');
      inO.setAttribute('aria-label', 'Gas ' + (i + 1) + ' oxygen percent');
      fo.appendChild(inO);
      fo.appendChild(mk('span', 'frac-tag', 'O₂'));

      var fh = mk('div', 'gas-frac');
      var inH = mk('input');
      inH.type = 'number'; inH.min = '0'; inH.max = '99'; inH.step = '1'; inH.inputMode = 'numeric';
      inH.value = Math.round(g.fHe * 100);
      inH.setAttribute('data-gas', i); inH.setAttribute('data-field', 'fHe');
      inH.setAttribute('data-vkey', 'gas-' + i + '-he');
      inH.setAttribute('aria-label', 'Gas ' + (i + 1) + ' helium percent');
      fh.appendChild(inH);
      fh.appendChild(mk('span', 'frac-tag', 'He'));

      var name = mk('span', 'gas-name', gasName(g));
      name.setAttribute('data-gasname', i);

      var rm = mk('button', 'icon-btn', '✕');
      rm.type = 'button';
      rm.setAttribute('data-remove-gas', i);
      rm.setAttribute('aria-label', 'Remove gas ' + gasName(g));
      rm.title = 'Remove gas';

      var meta = mk('div', 'gas-meta');
      var sel = mk('select', 'gas-type');
      sel.setAttribute('data-gas', i); sel.setAttribute('data-field', 'type');
      sel.setAttribute('aria-label', 'Gas ' + (i + 1) + ' role');
      var ob = mk('option', null, 'BOTTOM'); ob.value = 'bottom';
      var od = mk('option', null, 'DECO'); od.value = 'deco';
      if (g.type === 'bottom') ob.selected = true; else od.selected = true;
      sel.appendChild(ob); sel.appendChild(od);

      var ro = gasReadoutText(g);
      var modSpan = mk('span', 'gas-readout');
      modSpan.setAttribute('data-gasmod', i);
      modSpan.innerHTML = 'MOD <b>' + ro.mod + '</b> @' + fmt(ro.pp, 2);
      var endSpan = mk('span', 'gas-readout');
      endSpan.setAttribute('data-gasend', i);
      endSpan.innerHTML = 'END <b>' + ro.end + '</b>';

      meta.appendChild(sel); meta.appendChild(modSpan); meta.appendChild(endSpan);

      // --- cylinder row: tank preset + start pressure ---
      var tank = mk('div', 'gas-tank');
      var cylSel = mk('select', 'gas-cyl');
      cylSel.setAttribute('data-gas', i); cylSel.setAttribute('data-field', 'cyl');
      cylSel.setAttribute('aria-label', 'Gas ' + (i + 1) + ' cylinder');
      CYL_PRESETS.forEach(function (c) {
        var o = mk('option', null, c.label); o.value = c.key;
        if (g.cyl === c.key) o.selected = true;
        cylSel.appendChild(o);
      });

      var pWrap = mk('div', 'gas-fill');
      var inP = mk('input');
      inP.type = 'number'; inP.step = imperial() ? '50' : '5';
      inP.min = imperial() ? '300' : '20'; inP.max = imperial() ? '4500' : '300';
      inP.inputMode = 'numeric';
      inP.value = pressOut(gasCylinder(g).startBar);
      inP.setAttribute('data-gas', i); inP.setAttribute('data-field', 'startBar');
      inP.setAttribute('aria-label', 'Gas ' + (i + 1) + ' start pressure');
      pWrap.appendChild(inP);
      pWrap.appendChild(mk('span', 'frac-tag', pressUnit()));

      tank.appendChild(cylSel); tank.appendChild(pWrap);

      row.appendChild(fo); row.appendChild(fh); row.appendChild(name); row.appendChild(rm);
      row.appendChild(meta); row.appendChild(tank);
      list.appendChild(row);
    });
  }

  /* refresh computed gas labels/MOD/END without rebuilding inputs */
  function refreshGasReadouts() {
    state.gases.forEach(function (g, i) {
      var name = document.querySelector('[data-gasname="' + i + '"]');
      if (name) name.textContent = gasName(g);
      var ro = gasReadoutText(g);
      var modSpan = document.querySelector('[data-gasmod="' + i + '"]');
      if (modSpan) modSpan.innerHTML = 'MOD <b>' + ro.mod + '</b> @' + fmt(ro.pp, 2);
      var endSpan = document.querySelector('[data-gasend="' + i + '"]');
      if (endSpan) endSpan.innerHTML = 'END <b>' + ro.end + '</b>';
    });
  }

  function renderAlgo() {
    var isVpm = state.algorithm === 'VPMB';
    var zhl = !isVpm;                       // ZHL16C or ZHL16B -> Buhlmann controls
    $('algo-zhl').classList.toggle('active', zhl);
    $('algo-zhl').setAttribute('aria-pressed', String(zhl));
    $('algo-vpm').classList.toggle('active', isVpm);
    $('algo-vpm').setAttribute('aria-pressed', String(isVpm));
    $('zhl-controls').hidden = isVpm;
    $('vpm-controls').hidden = !isVpm;
    setSeg('zhlvariant', state.algorithm === 'ZHL16B' ? 'zhl-b' : 'zhl-c');
    $('gf-low-num').value = state.gfLow;
    $('gf-low-range').value = state.gfLow;
    $('gf-high-num').value = state.gfHigh;
    $('gf-high-range').value = state.gfHigh;
    $('vpm-value').textContent = '+' + state.vpmConservatism;
  }

  function renderSettings() {
    $('set-descent').value = rateOut(state.descentRate);
    $('set-ascent').value = rateOut(state.ascentRate);
    $('set-sp').value = state.surfacePressure;
    $('set-ppo2').value = state.ppO2MaxDeco;
    $('set-sac-bottom').value = sacOut(state.sacBottom);
    $('set-sac-deco').value = sacOut(state.sacDeco);
    $('set-extra-reserve').value = pressOut(state.extraReserveBar);
    $('set-extra-reserve').step = imperial() ? '50' : '5';
    $('set-incl-travel').checked = state.segmentTimesIncludeTravel;
    syncTravelBtn();
    setSeg('laststop', state.lastStopDepth === 3 ? 'laststop-3' : 'laststop-6');
    setSeg('water', state.water === 'salt' ? 'water-salt' : 'water-fresh');
    $('laststop-3').textContent = imperial() ? '10 ft' : '3 m';
    $('laststop-6').textContent = imperial() ? '20 ft' : '6 m';
  }

  function syncTravelBtn() {
    var b = $('travel-btn');
    if (!b) return;
    b.classList.toggle('active', !!state.showTravel);
    b.setAttribute('aria-pressed', state.showTravel ? 'true' : 'false');
  }

  function setSeg(group, activeId) {
    var ids = group === 'laststop' ? ['laststop-3', 'laststop-6']
            : group === 'water' ? ['water-salt', 'water-fresh']
            : group === 'zhlvariant' ? ['zhl-c', 'zhl-b']
            : ['units-metric', 'units-imperial'];
    ids.forEach(function (id) {
      var on = id === activeId;
      $(id).classList.toggle('active', on);
      $(id).setAttribute('aria-pressed', String(on));
    });
  }

  function renderUnitLabels() {
    var d = depthUnit(), r = rateUnit(), s = sacUnit();
    var i, ns;
    ns = document.querySelectorAll('.u-depth'); for (i = 0; i < ns.length; i++) ns[i].textContent = d;
    ns = document.querySelectorAll('.u-depth-tile'); for (i = 0; i < ns.length; i++) ns[i].textContent = d;
    ns = document.querySelectorAll('.u-rate'); for (i = 0; i < ns.length; i++) ns[i].textContent = r;
    ns = document.querySelectorAll('.u-sac'); for (i = 0; i < ns.length; i++) ns[i].textContent = s;
    var pu = pressUnit();
    ns = document.querySelectorAll('.u-press'); for (i = 0; i < ns.length; i++) ns[i].textContent = pu;
    setSeg('units', imperial() ? 'units-imperial' : 'units-metric');
  }

  function renderBadge() {
    var b = $('algo-badge');
    if (state.algorithm === 'VPMB') {
      b.textContent = 'VPM-B · +' + state.vpmConservatism;
    } else {
      var label = state.algorithm === 'ZHL16B' ? 'ZHL-16B' : 'ZHL-16C';
      b.textContent = label + ' · GF ' + Math.round(state.gfLow) + '/' + Math.round(state.gfHigh);
    }
  }

  function renderPresets() {
    var sel = $('gas-preset');
    clear(sel);
    PRESETS.forEach(function (p, i) {
      var o = mk('option', null, p.label);
      o.value = String(i);
      sel.appendChild(o);
    });
  }

  function renderRail() {
    renderSegments();
    renderGases();
    renderAlgo();
    renderSettings();
    renderUnitLabels();
    renderBadge();
    var rsv = $('gas-reserve');
    if (rsv) rsv.value = state.gasReserve;
  }

  /* ----------------------------------------------------------
     Internationalization (UI chrome + tooltips)
  ---------------------------------------------------------- */
  // Resolve the active language: an explicit saved choice, else the browser's.
  function activeLang() {
    if (!hasI18n) return 'en';
    if (state.lang && window.I18N.has(state.lang)) return state.lang;
    return window.I18N.detect();
  }

  // Translate every element carrying data-i18n / -title / -ph in place.
  function applyI18n() {
    if (!hasI18n) return;
    window.I18N.setLang(activeLang());
    var t = window.I18N.t;
    var i, els;
    els = document.querySelectorAll('[data-i18n]');
    for (i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute('data-i18n'));
    els = document.querySelectorAll('[data-i18n-title]');
    for (i = 0; i < els.length; i++) els[i].setAttribute('title', t(els[i].getAttribute('data-i18n-title')));
    els = document.querySelectorAll('[data-i18n-ph]');
    for (i = 0; i < els.length; i++) els[i].setAttribute('placeholder', t(els[i].getAttribute('data-i18n-ph')));
    document.documentElement.setAttribute('lang', window.I18N.getLang());
  }

  // Build the language <select> from the available dictionaries.
  function renderLangSelect() {
    var sel = $('lang-select');
    if (!sel || !hasI18n) return;
    clear(sel);
    window.I18N.LANGS.forEach(function (code) {
      var o = mk('option', null, window.I18N.LANG_LABELS[code] || code);
      o.value = code;
      sel.appendChild(o);
    });
    sel.value = activeLang();
  }

  function fmtSavedTs(ts) {
    if (typeof ts !== 'number' || !isFinite(ts)) return '';
    try {
      var dt = new Date(ts);
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()) +
        ' ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
    } catch (e) { return ''; }
  }

  function renderDives() {
    var list = $('dives-list');
    if (!list) return;
    clear(list);
    var dives = loadDives().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    if (!dives.length) {
      list.appendChild(mk('p', 'dives-empty', 'No saved dives yet.'));
      return;
    }
    dives.forEach(function (rec) {
      var row = mk('div', 'dive-item');
      row.setAttribute('data-dive-name', rec.name);
      var info = mk('div', 'dive-info');
      info.appendChild(mk('span', 'dive-name', rec.name));
      var ts = fmtSavedTs(rec.ts);
      if (ts) info.appendChild(mk('span', 'dive-ts num', ts));
      row.appendChild(info);
      var load = mk('button', 'ghost-btn', 'LOAD');
      load.type = 'button';
      load.setAttribute('data-action', 'load');
      row.appendChild(load);
      var del = mk('button', 'icon-btn', '✕');
      del.type = 'button';
      del.title = 'Delete saved dive';
      del.setAttribute('aria-label', 'Delete ' + rec.name);
      del.setAttribute('data-action', 'delete');
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  /* ----------------------------------------------------------
     Plan execution
  ---------------------------------------------------------- */
  function runPlan(animate) {
    var v = applyValidation();
    if (v.errors.length) return;
    var input = buildInput();
    var result;
    var usedMock = false;
    try {
      if (state.algorithm === 'VPMB' && hasVPM) {
        result = window.VPMB.plan(input);
      } else if (hasEngine) {
        result = window.DecoEngine.plan(input);
      } else {
        result = buildMock(input); // MOCK: only when DecoEngine is undefined
        usedMock = true;
      }
    } catch (err) {
      showBanner('ENGINE FAULT — ' + (err && err.message ? err.message : 'unknown error'), true);
      result = { ok: false, errors: ['Engine exception: ' + (err && err.message ? err.message : err)], warnings: [] };
    }
    lastResult = result;
    if (result && result.ok) {
      lastGoodResult = result;
      hasPlanned = true;
      if (usedMock) showBanner(OFFLINE_MSG, false);
      else hideBanner(); // also clears a previous fault banner
    }
    renderResults(result, animate);
  }

  function schedulePlan() {
    if (!hasPlanned) return;
    if (planTimer) clearTimeout(planTimer);
    planTimer = setTimeout(function () {
      planTimer = null;
      runPlan(false);
    }, DEBOUNCE_MS);
  }

  /* called after any state mutation from the form */
  function onStateChanged(opts) {
    opts = opts || {};
    saveState();
    renderBadge();
    if (opts.refreshGas) refreshGasReadouts();
    applyValidation();
    schedulePlan();
  }

  /* ----------------------------------------------------------
     RESULTS rendering
  ---------------------------------------------------------- */
  function resultGasMeta(result) {
    var map = {};
    (result.gasUsage || []).forEach(function (u) {
      map[u.gasId] = { fO2: u.fO2, fHe: u.fHe, name: gasName(u) };
    });
    state.gases.forEach(function (g) {
      if (!map[g.id]) map[g.id] = { fO2: g.fO2, fHe: g.fHe, name: gasName(g) };
    });
    return map;
  }

  function renderResults(result, animate) {
    if (!result) return;
    var resultsEl = $('results');
    var chartsEl = document.querySelector('.charts-col');
    var errPanel = $('panel-errors');

    if (!result.ok) {
      var list = $('errors-list');
      clear(list);
      (result.errors || ['Plan failed']).forEach(function (e) {
        var li = mk('li');
        li.appendChild(mk('span', 'warn-glyph', '✕'));
        li.appendChild(mk('span', 'warn-tag', 'ERROR'));
        li.appendChild(mk('span', null, e));
        list.appendChild(li);
      });
      errPanel.hidden = false;
      errPanel.classList.add('revealed');
      resultsEl.classList.add('stale');
      if (chartsEl) chartsEl.classList.add('stale');
      return;
    }

    errPanel.hidden = true;
    resultsEl.classList.remove('stale');
    if (chartsEl) chartsEl.classList.remove('stale');

    renderTiles(result, animate);
    renderTable(result, animate);
    refreshSummary();   // re-plan the contingency table if it is open
    renderGasUsage(result);
    renderWarnings(result, gasSupplyWarnings(result));
    renderCharts(result);
    if (animate) revealPanels();
  }

  function maxima(result) {
    var meta = resultGasMeta(result);
    var maxPp = 0, maxEnd = 0;
    (result.table || []).forEach(function (r) {
      maxPp = Math.max(maxPp, r.ppO2Start || 0, r.ppO2End || 0);
      var g = meta[r.gasId];
      if (g) maxEnd = Math.max(maxEnd, endAt(Math.max(r.startDepth, r.endDepth), g));
    });
    return { ppO2: maxPp, end: maxEnd };
  }

  function renderTiles(result, animate) {
    var mx = maxima(result);
    countUp($('tile-runtime'), result.totalRuntime, 1, animate);
    countUp($('tile-deco'), result.totalDecoTime, 1, animate);

    var fs = $('tile-firststop');
    if (result.noDeco) {
      fs.textContent = 'NDL ' + fmt(result.ndl, 0);
      fs.parentNode.querySelector('.tile-unit').textContent = 'MIN LEFT';
    } else {
      fs.textContent = result.firstStopDepth === null ? '—' : depthOut(result.firstStopDepth);
      fs.parentNode.querySelector('.tile-unit').textContent = depthUnit();
    }

    var cns = result.oxygen ? result.oxygen.cns : null;
    var otu = result.oxygen ? result.oxygen.otu : null;
    var cnsEl = $('tile-cns');
    cnsEl.textContent = fmt(cns, 0);
    cnsEl.classList.toggle('caution', cns !== null && cns > 80 && cns <= 100);
    cnsEl.classList.toggle('danger', cns !== null && cns > 100);
    $('tile-otu').textContent = fmt(otu, 0);

    var endEl = $('tile-end');
    endEl.textContent = depthOut(mx.end);
    endEl.classList.toggle('caution', mx.end > 30);

    var ppEl = $('tile-ppo2');
    ppEl.textContent = fmt(mx.ppO2, 2);
    ppEl.classList.toggle('caution', mx.ppO2 > 1.4 && mx.ppO2 <= 1.65);
    ppEl.classList.toggle('danger', mx.ppO2 > 1.65);
  }

  var GLYPH = { desc: '▼', level: '▶', asc: '▲', stop: '◉', switch: '⇄' };

  function rowDepthText(r) {
    if (r.startDepth !== r.endDepth) {
      return depthOut(r.startDepth) + ' → ' + depthOut(r.endDepth);
    }
    return depthOut(r.endDepth);
  }

  function readOnlyRow(r, meta, idx) {
    var tr = mk('tr', 'row-' + r.phase);
    tr.style.setProperty('--i', Math.min(idx, 26));
    var tdDepth = mk('td');
    var glyph = mk('span', 'phase-glyph', GLYPH[r.phase] || '');
    glyph.setAttribute('aria-hidden', 'true');
    tdDepth.appendChild(glyph);
    tdDepth.appendChild(document.createTextNode(rowDepthText(r)));
    tr.appendChild(tdDepth);
    var durTxt = r.phase === 'stop' ? fmt(r.duration, 0)
               : (r.duration > 0 ? fmt(r.duration, 1) : '—');
    tr.appendChild(mk('td', null, durTxt));
    tr.appendChild(mk('td', null, fmt(r.runtime, 1)));
    var g = meta[r.gasId];
    var gname = g ? g.name : (r.gasId || '?');
    tr.appendChild(mk('td', null, r.phase === 'switch' ? 'GAS → ' + gname : gname));
    tr.appendChild(mk('td', null, fmt(r.ppO2End, 2)));
    return tr;
  }

  // The runtime table is always the engine's freshly-computed schedule; it
  // regenerates on every settings change (read-only rows).
  function renderTable(result, animate) {
    var body = $('runtime-body');
    var meta = resultGasMeta(result);
    clear(body);
    body.classList.remove('cascade');
    var rows = (result.table || []);
    if (!state.showTravel) {
      rows = rows.filter(function (r) { return r.phase !== 'asc' && r.phase !== 'desc'; });
    }
    rows.forEach(function (r, i) {
      body.appendChild(readOnlyRow(r, meta, i));
    });
    if (animate && !reduceMotion) body.classList.add('cascade');
  }

  /* Cross-gas context for the supply rules: the rock-bottom volume and which
     gas it applies to (the deepest segment's gas = what you breathe at depth). */
  function supplyContext(result) {
    var bottomGasId = null;
    if (result && result.table) {
      var deepest = -1;
      result.table.forEach(function (r) {
        if ((r.phase === 'level' || r.phase === 'desc') && r.endDepth > deepest) {
          deepest = r.endDepth; bottomGasId = r.gasId;
        }
      });
    }
    return { minGas: minGasReserve(result), bottomGasId: bottomGasId };
  }

  function renderGasUsage(result) {
    var host = $('gas-usage');
    clear(host);
    var usage = result.gasUsage || [];
    var ctx = supplyContext(result);

    usage.forEach(function (u) {
      var g = gasById(u.gasId) || { type: 'bottom', cyl: 's80', startBar: 207, fO2: u.fO2, fHe: u.fHe };
      var sup = gasSupply(g, u.liters, ctx);
      var card = mk('div', 'gas-card' + (sup && !sup.ok ? ' gas-short' : ''));

      // header: gas name + cylinder label, and the required pressure (the
      // number a diver actually reads off a gauge).
      var head = mk('div', 'gas-card-head');
      var nm = mk('span', 'gas-card-name', gasName(u));
      head.appendChild(nm);
      head.appendChild(mk('span', 'gas-card-amt num',
        pressOut(sup.needBar) + ' ' + pressUnit()));
      card.appendChild(head);

      // tank-fill bar: usable zone (phosphor/amber/alert) over the reserve
      // zone (dim), with a tick at the consumed level.
      var startBar = sup.startBar;
      var usedPct = startBar > 0 ? Math.min(100, sup.needBar / startBar * 100) : 100;
      var usablePct = startBar > 0 ? sup.usableBar / startBar * 100 : 100;
      var bar = mk('div', 'tank-bar');
      var reserve = mk('span', 'tank-reserve');     // full-width dim base
      var fill = mk('span', 'tank-fill' + (sup.ok ? '' : ' over'));
      fill.style.width = usedPct + '%';
      var limit = mk('span', 'tank-limit');         // usable/reserve boundary
      limit.style.left = usablePct + '%';
      bar.appendChild(reserve); bar.appendChild(fill); bar.appendChild(limit);
      card.appendChild(bar);

      // verdict line
      var verdict = mk('div', 'tank-verdict' + (sup.ok ? ' ok' : ' bad'));
      verdict.appendChild(mk('span', 'tank-glyph', sup.ok ? '✓' : '✕'));
      if (sup.ok) {
        verdict.appendChild(mk('span', null,
          'OK · ' + pressOut(sup.marginBar) + ' ' + pressUnit() + ' spare'));
      } else {
        var shortBar = sup.needBar - sup.usableBar;
        verdict.appendChild(mk('span', null,
          'SHORT by ' + pressOut(shortBar) + ' ' + pressUnit() +
          ' · need ≥ ' + pressOut(sup.minStartBar) + ' ' + pressUnit() + ' fill'));
      }
      card.appendChild(verdict);

      // detail line: cylinder, start fill, reserve rule (+ extra), surface volume
      var ruleShort = sup.rule.short + (sup.extraBar > 0 ? ' +' + pressOut(sup.extraBar) + pressUnit() : '');
      var detail = sup.cyl.preset.label + ' @ ' + pressOut(startBar) + ' ' + pressUnit() +
        ' · ' + ruleShort +
        ' · ' + volOut(u.liters) + ' ' + volUnit() + ' used';
      card.appendChild(mk('div', 'gas-card-sub', detail));
      // Reserve breakdown line: total reserve, and for min-gas the ascent it covers.
      var resLine = 'reserve ' + pressOut(sup.reserveBar) + ' ' + pressUnit();
      if (sup.isMinGas && ctx.minGas) {
        resLine += ' = ' + pressOut(sup.ruleBar) + ' min-gas (' +
          volOut(sup.reserveLiters) + ' ' + volUnit() + ', 2 divers ' +
          depthOut(ctx.minGas.fromDepth) + '→' + depthOut(ctx.minGas.toDepth) + ' ' + depthUnit() + ')' +
          (sup.extraBar > 0 ? ' + ' + pressOut(sup.extraBar) + ' extra' : '');
        card.appendChild(mk('div', 'gas-card-sub', resLine));
      } else if (sup.extraBar > 0) {
        card.appendChild(mk('div', 'gas-card-sub',
          resLine + ' = ' + pressOut(sup.ruleBar) + ' ' + sup.rule.short + ' + ' +
          pressOut(sup.extraBar) + ' extra'));
      }
      host.appendChild(card);
    });

    if (!usage.length) {
      host.appendChild(mk('p', 'gas-empty', 'No gas consumed.'));
    }
  }

  var SEVERE_RX = /(1\.6[5-9]|1\.[7-9]\d?|exceed|>\s*100|CNS\s*>\s*100|hypoxic|insufficient gas|not enough gas)/i;

  /* UI-side advisories: any gas whose required pressure breaks the reserve
     rule. Returned separately so they render with the engine warnings. */
  function gasSupplyWarnings(result) {
    var out = [];
    var ctx = supplyContext(result);
    (result.gasUsage || []).forEach(function (u) {
      var g = gasById(u.gasId);
      if (!g) return;
      var sup = gasSupply(g, u.liters, ctx);
      if (sup && !sup.ok) {
        var pu = pressUnit();
        out.push('Insufficient gas: ' + gasName(u) + ' (' + sup.cyl.preset.label +
          ' @ ' + pressOut(sup.startBar) + ' ' + pu + ') needs ' + pressOut(sup.needBar) +
          ' ' + pu + ' but only ' + pressOut(sup.usableBar) + ' ' + pu + ' is usable under ' +
          sup.rule.label.toLowerCase() + ' — fill to ≥ ' + pressOut(sup.minStartBar) +
          ' ' + pu + ' or use a larger cylinder');
      }
    });
    return out;
  }

  function renderWarnings(result, extra) {
    var panel = $('panel-warnings');
    var list = $('warnings-list');
    clear(list);
    var warnings = (result.warnings || []).concat(extra || []);
    panel.hidden = warnings.length === 0;
    warnings.forEach(function (w) {
      var severe = SEVERE_RX.test(w);
      var li = mk('li', severe ? 'severe' : null);
      li.appendChild(mk('span', 'warn-glyph', severe ? '✕' : '⚠'));
      li.appendChild(mk('span', 'warn-tag', severe ? 'ALERT' : 'CAUTION'));
      li.appendChild(mk('span', null, w));
      list.appendChild(li);
    });
  }

  function renderCharts(result) {
    if (!hasCharts) return;
    var opts = { units: state.units };
    try { window.Charts.renderProfile($('profile-chart'), result, opts); }
    catch (e) { if (window.console) console.warn('Charts.renderProfile failed:', e); }
    try { window.Charts.renderTissues($('tissue-chart'), result, opts); }
    catch (e) { if (window.console) console.warn('Charts.renderTissues failed:', e); }
  }

  /* ----------------------------------------------------------
     Motion: count-up + stagger reveal
  ---------------------------------------------------------- */
  function countUp(el, target, decimals, animate) {
    if (target === null || target === undefined || !isFinite(target)) {
      el.textContent = '—';
      el.removeAttribute('data-v');
      return;
    }
    var from = num(el.getAttribute('data-v'));
    if (!isFinite(from)) from = 0;
    el.setAttribute('data-v', target);
    if (!animate || reduceMotion || Math.abs(target - from) < 0.05) {
      el.textContent = fmt(target, decimals);
      return;
    }
    var t0 = null, dur = 650;
    function tick(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (target - from) * eased, decimals);
      if (p < 1) window.requestAnimationFrame(tick);
    }
    window.requestAnimationFrame(tick);
  }

  function revealPanels() {
    var panels = document.querySelectorAll('.results .reveal, .charts-col .reveal');
    var visible = [];
    var i;
    for (i = 0; i < panels.length; i++) {
      if (!panels[i].hidden) visible.push(panels[i]);
      panels[i].classList.remove('revealed');
    }
    if (reduceMotion) {
      for (i = 0; i < panels.length; i++) panels[i].classList.add('revealed');
      return;
    }
    // force reflow so the transition restarts
    void document.body.offsetWidth;
    visible.forEach(function (p, idx) {
      p.style.setProperty('--reveal-delay', (idx * 60) + 'ms');
      p.classList.add('revealed');
    });
  }

  /* ----------------------------------------------------------
     COPY plan as monospace text
  ---------------------------------------------------------- */
  function pad(s, w, right) {
    s = String(s);
    while (s.length < w) s = right ? s + ' ' : ' ' + s;
    return s;
  }
  function planText(result) {
    var meta = resultGasMeta(result);
    var lines = [];
    var algoLine = result.algorithm === 'VPMB'
      ? 'VPM-B +' + (result.params ? result.params.vpmConservatism : state.vpmConservatism)
      : (result.algorithm === 'ZHL16B' ? 'ZHL-16B+GF ' : 'ZHL-16C+GF ') + (result.params ? result.params.gfLow + '/' + result.params.gfHigh : '');
    lines.push('HALDANE DECOMPRESSION PLAN');
    lines.push('MODEL ' + algoLine + '  WATER ' + state.water.toUpperCase() +
               '  SP ' + fmt(state.surfacePressure, 3) + ' bar  UNITS ' + state.units.toUpperCase());
    lines.push('GASES ' + state.gases.map(function (g) {
      return gasName(g) + ' (' + g.type + ')';
    }).join(' / '));
    lines.push('');
    var du = depthUnit();
    lines.push(pad('PH', 3, true) + pad('DEPTH ' + du, 13) + pad('DUR', 7) + pad('RUN', 8) + '  ' + pad('GAS', 8, true) + pad('ppO2', 6));
    lines.push('-------------------------------------------------');
    var PH = { desc: 'v', level: '-', asc: '^', stop: '*', switch: '>' };
    (result.table || []).forEach(function (r) {
      var depth = r.startDepth !== r.endDepth
        ? depthOut(r.startDepth) + '>' + depthOut(r.endDepth)
        : depthOut(r.endDepth);
      var g = meta[r.gasId];
      lines.push(
        pad(PH[r.phase] || ' ', 3, true) +
        pad(depth, 13) +
        pad(r.phase === 'stop' ? fmt(r.duration, 0) : fmt(r.duration, 1), 7) +
        pad(fmt(r.runtime, 1), 8) + '  ' +
        pad(g ? g.name : r.gasId, 8, true) +
        pad(fmt(r.ppO2End, 2), 6)
      );
    });
    lines.push('-------------------------------------------------');
    lines.push('RUNTIME ' + fmt(result.totalRuntime, 1) + ' min   DECO ' + fmt(result.totalDecoTime, 1) + ' min');
    var mx = maxima(result);
    lines.push('CNS ' + fmt(result.oxygen ? result.oxygen.cns : null, 0) + '%   OTU ' +
               fmt(result.oxygen ? result.oxygen.otu : null, 0) +
               '   MAX ppO2 ' + fmt(mx.ppO2, 2) + ' bar   MAX END ' + depthOut(mx.end) + ' ' + du);
    var pu = pressUnit();
    var rule = RESERVE_RULES[state.gasReserve] || RESERVE_RULES.thirds;
    var supCtx = supplyContext(result);
    lines.push('');
    lines.push('GAS SUPPLY  (' + rule.label +
      (state.extraReserveBar > 0 ? ' + ' + pressOut(state.extraReserveBar) + pu + ' extra' : '') + ')');
    (result.gasUsage || []).forEach(function (u) {
      var g = gasById(u.gasId);
      var sup = gasSupply(g || { type: 'bottom', cyl: 's80', startBar: 207 }, u.liters, supCtx);
      var verdict = sup.ok
        ? 'OK +' + pressOut(sup.marginBar) + pu
        : 'SHORT -' + pressOut(sup.needBar - sup.usableBar) + pu + ' (need ' + pressOut(sup.minStartBar) + pu + ')';
      lines.push('  ' + pad(gasName(u), 8, true) +
        pad(sup.cyl.preset.label, 14, true) +
        pad('@' + pressOut(sup.startBar) + pu, 9, true) +
        pad('need ' + pressOut(sup.needBar) + pu, 12, true) +
        verdict);
    });
    (result.warnings || []).forEach(function (w) { lines.push('! ' + w); });
    return lines.join('\n');
  }

  function copyPlan() {
    if (!lastGoodResult) return;
    var text = planText(lastGoodResult);
    function done(okFlag) {
      var btn = $('copy-btn');
      btn.textContent = okFlag ? 'COPIED ✓' : 'COPY FAILED';
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(function () { btn.textContent = 'COPY'; }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var okFlag = document.execCommand('copy');
      document.body.removeChild(ta);
      done(okFlag);
    } catch (e) { done(false); }
  }

  /* ----------------------------------------------------------
     SUMMARIZED / contingency table
     ----------------------------------------------------------
     Collapses the active engine's minute-by-minute runtime into just the
     stop ladder, and re-plans four contingency variants around the planned
     dive: ±3 m deeper/shallower and ±1 min longer/shorter (the depth delta
     applies to the deepest segment, the time delta to the bottom time). The
     single longest stop is the "long stop"; the rest are "short stops".
     Engine-only: it calls the same plan() the runtime table uses. */

  function tr(key) {
    return hasI18n ? window.I18N.t(key) : key;
  }

  // Index of the deepest segment in an input (the bottom phase).
  function deepestSegIndex(input) {
    var idx = 0, deep = -Infinity;
    (input.segments || []).forEach(function (s, i) {
      if (s.depth > deep) { deep = s.depth; idx = i; }
    });
    return idx;
  }

  // Plan a contingency variant: a deep copy of the current input with the
  // deepest segment's depth and/or time nudged by the given deltas (metric;
  // clamped to >= 1 m / >= 1 min). Returns the engine result, or null on fault.
  function planVariant(input, dDepth, dTime) {
    var v = JSON.parse(JSON.stringify(input));
    var i = deepestSegIndex(v);
    var seg = v.segments[i];
    if (!seg) return null;
    if (dDepth) seg.depth = Math.max(1, seg.depth + dDepth);
    if (dTime) seg.time = Math.max(1, seg.time + dTime);
    try {
      if (v.algorithm === 'VPMB' && hasVPM) return window.VPMB.plan(v);
      if (hasEngine) return window.DecoEngine.plan(v);
      return buildMock(v);
    } catch (e) {
      return { ok: false, errors: ['Engine exception: ' + (e && e.message ? e.message : e)], warnings: [] };
    }
  }

  // Collapse result.stops into { short:[{depth,time}], long:{depth,time}|null }.
  // The single longest stop (ties broken by greater depth) is the long stop.
  function summarizeStops(result) {
    var stops = (result && result.stops ? result.stops : []).map(function (s) {
      return { depth: s.depth, time: s.time };
    });
    if (!stops.length) return { short: [], long: null };
    var li = 0;
    for (var i = 1; i < stops.length; i++) {
      if (stops[i].time > stops[li].time ||
         (stops[i].time === stops[li].time && stops[i].depth > stops[li].depth)) li = i;
    }
    var long = stops[li];
    var short = stops.filter(function (s, i2) { return i2 !== li; });
    return { short: short, long: long };
  }

  // The five variants shown, in order: planned, then the four contingencies.
  function summaryVariants() {
    return [
      { key: 'plan',  labelKey: 'sum.planned', dDepth: 0,  dTime: 0,  badge: '' },
      { key: 'deep',  label: '+3 ' + depthUnit(), dDepth: 3,  dTime: 0 },
      { key: 'shal',  label: '−3 ' + depthUnit(), dDepth: -3, dTime: 0 },
      { key: 'long',  label: '+1 min',            dDepth: 0,  dTime: 1 },
      { key: 'short', label: '−1 min',            dDepth: 0,  dTime: -1 }
    ];
  }

  // Build every variant's result + stop summary. Returns rows for render/copy.
  function buildSummaryRows() {
    var base = buildInput();
    var baseDeepIdx = deepestSegIndex(base);
    return summaryVariants().map(function (vr) {
      var res = (vr.dDepth || vr.dTime) ? planVariant(base, vr.dDepth, vr.dTime)
                                        : runActive(base);
      var seg = base.segments[baseDeepIdx] || { depth: 0, time: 0 };
      var depthM = Math.max(1, seg.depth + (vr.dDepth || 0));
      var timeM = Math.max(1, seg.time + (vr.dTime || 0));
      return {
        key: vr.key,
        labelKey: vr.labelKey,
        label: vr.label,
        depthM: depthM,
        timeM: timeM,
        result: res,
        summary: res && res.ok ? summarizeStops(res) : null
      };
    });
  }

  // Run the active engine on a freshly-built input (used for the planned row).
  function runActive(input) {
    try {
      if (input.algorithm === 'VPMB' && hasVPM) return window.VPMB.plan(input);
      if (hasEngine) return window.DecoEngine.plan(input);
      return buildMock(input);
    } catch (e) {
      return { ok: false, errors: ['Engine exception: ' + (e && e.message ? e.message : e)], warnings: [] };
    }
  }

  // "21·1  18·2  15·3" — grouped short-stop string (depth·minutes, display units).
  function shortStopsText(short) {
    if (!short || !short.length) return tr('sum.none');
    return short.map(function (s) {
      return depthOut(s.depth) + '·' + fmt(s.time, 0);
    }).join('  ');
  }
  function longStopText(long) {
    if (!long) return '—';
    return depthOut(long.depth) + ' ' + depthUnit() + ' / ' + fmt(long.time, 0) + ' min';
  }

  function summaryVariantLabel(row) {
    var name = row.labelKey ? tr(row.labelKey) : (row.label || row.key);
    var prof = depthOut(row.depthM) + ' ' + depthUnit() + ' · ' + fmt(row.timeM, 0) + ' min';
    return { name: name, prof: prof };
  }

  function renderSummaryTable(rows) {
    var host = $('summary-body');
    clear(host);

    var table = mk('table', 'summary-table');
    var thead = mk('thead');
    var htr = mk('tr');
    [tr('sum.variant'), tr('sum.shortStops'), tr('sum.longStop'), tr('sum.deco'), tr('sum.runtime')]
      .forEach(function (h, i) {
        var th = mk('th', null, h);
        th.setAttribute('scope', 'col');
        if (i === 0) th.className = 'sum-col-variant';
        htr.appendChild(th);
      });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = mk('tbody');
    rows.forEach(function (row) {
      var tr2 = mk('tr', 'sum-row' + (row.key === 'plan' ? ' sum-row-plan' : ''));
      var lab = summaryVariantLabel(row);

      var tdV = mk('td', 'sum-variant');
      tdV.appendChild(mk('span', 'sum-variant-name', lab.name));
      tdV.appendChild(mk('span', 'sum-variant-prof', lab.prof));
      tr2.appendChild(tdV);

      if (!row.result || !row.result.ok) {
        var tdErr = mk('td', 'sum-err');
        tdErr.setAttribute('colspan', '4');
        tdErr.textContent = row.result && row.result.errors && row.result.errors.length
          ? row.result.errors[0] : 'Plan rejected';
        tr2.appendChild(tdErr);
        tbody.appendChild(tr2);
        return;
      }

      var s = row.summary;
      tr2.appendChild(mk('td', 'sum-short', shortStopsText(s.short)));
      tr2.appendChild(mk('td', 'sum-long', longStopText(s.long)));
      tr2.appendChild(mk('td', 'num', fmt(row.result.totalDecoTime, 0) + ' min'));
      tr2.appendChild(mk('td', 'num', fmt(row.result.totalRuntime, 0) + ' min'));
      tbody.appendChild(tr2);
    });
    table.appendChild(tbody);
    host.appendChild(table);

    host.appendChild(mk('p', 'summary-legend', tr('sum.legend')));
  }

  // (Re)build and render the summarized table from current settings.
  function refreshSummary() {
    if (!summaryOpen) return;
    lastSummary = buildSummaryRows();
    renderSummaryTable(lastSummary);
  }

  function syncSummaryBtn() {
    var b = $('summary-btn');
    if (!b) return;
    b.classList.toggle('active', summaryOpen);
    b.setAttribute('aria-pressed', summaryOpen ? 'true' : 'false');
  }

  function toggleSummary() {
    summaryOpen = !summaryOpen;
    var panel = $('panel-summary');
    if (panel) {
      panel.hidden = !summaryOpen;
      // The panel starts hidden, so revealPanels() skips it; reveal it here
      // when first shown (it carries .reveal → opacity:0 until .revealed).
      if (summaryOpen) panel.classList.add('revealed');
    }
    syncSummaryBtn();
    if (summaryOpen) refreshSummary();
  }

  // Monospace text version of the summarized table (for COPY).
  function summaryText(rows) {
    var du = depthUnit();
    var lines = [];
    lines.push('HALDANE — SUMMARIZED STOP TABLE');
    var algoLine = state.algorithm === 'VPMB'
      ? 'VPM-B +' + state.vpmConservatism
      : (state.algorithm === 'ZHL16B' ? 'ZHL-16B+GF ' : 'ZHL-16C+GF ') + state.gfLow + '/' + state.gfHigh;
    lines.push('MODEL ' + algoLine + '  UNITS ' + state.units.toUpperCase());
    lines.push('');
    lines.push(pad(tr('sum.variant'), 12, true) + pad('DEPTH/TIME', 18, true) +
      pad(tr('sum.longStop'), 16, true) + pad(tr('sum.deco'), 9, true) + tr('sum.runtime'));
    lines.push('---------------------------------------------------------------------');
    rows.forEach(function (row) {
      var lab = summaryVariantLabel(row);
      if (!row.result || !row.result.ok) {
        lines.push(pad(lab.name, 12, true) + pad(lab.prof, 18, true) + 'PLAN REJECTED');
        return;
      }
      var s = row.summary;
      lines.push(
        pad(lab.name, 12, true) +
        pad(lab.prof, 18, true) +
        pad(longStopText(s.long), 16, true) +
        pad(fmt(row.result.totalDecoTime, 0) + ' min', 9, true) +
        fmt(row.result.totalRuntime, 0) + ' min');
      lines.push('   ' + tr('sum.shortStops') + ': ' + shortStopsText(s.short));
    });
    lines.push('---------------------------------------------------------------------');
    lines.push(tr('sum.legend'));
    return lines.join('\n');
  }

  function copySummary() {
    if (!lastSummary) return;
    var text = summaryText(lastSummary);
    function done(okFlag) {
      var btn = $('summary-copy-btn');
      if (!btn) return;
      btn.textContent = okFlag ? 'COPIED ✓' : 'COPY FAILED';
      if (summaryCopyTimer) clearTimeout(summaryCopyTimer);
      summaryCopyTimer = setTimeout(function () {
        btn.textContent = tr('btn.copy');
      }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  /* ----------------------------------------------------------
     Banner / external-module guards
  ---------------------------------------------------------- */
  function showBanner(msg, isAlert) {
    var b = $('banner');
    b.textContent = msg;
    b.classList.toggle('alert', !!isAlert);
    b.hidden = false;
  }
  function hideBanner() { $('banner').hidden = true; }

  function detectModules() {
    hasEngine = !!(window.DecoEngine && typeof window.DecoEngine.plan === 'function');
    hasVPM = !!(window.VPMB && typeof window.VPMB.plan === 'function');
    hasCharts = !!(window.Charts &&
      typeof window.Charts.renderProfile === 'function' &&
      typeof window.Charts.renderTissues === 'function');

    if (!hasEngine) {
      showBanner(OFFLINE_MSG, false);
    }
    if (!hasVPM) {
      var vb = $('algo-vpm');
      vb.disabled = true;
      vb.title = 'VPM-B engine module not loaded';
      vb.setAttribute('aria-disabled', 'true');
      if (state.algorithm === 'VPMB') state.algorithm = 'ZHL16B';
    }
    if (!hasCharts) {
      $('panel-profile').hidden = true;
      $('panel-tissue').hidden = true;
    }
    var parts = [];
    parts.push(hasEngine ? '<span class="ok">ZHL ●</span>' : '<span class="off">ZHL ○</span>');
    parts.push(hasVPM ? '<span class="ok">VPM ●</span>' : '<span class="off">VPM ○</span>');
    parts.push(hasCharts ? '<span class="ok">CHARTS ●</span>' : '<span class="off">CHARTS ○</span>');
    var ver = (hasEngine && window.DecoEngine.VERSION) ? (' · ENGINE v' + window.DecoEngine.VERSION) : '';
    $('status-line').innerHTML = 'MODULES&nbsp;&nbsp;' + parts.join('&nbsp;&nbsp;') + ver;
  }

  /* ----------------------------------------------------------
     Decorative depth-ruler labels
  ---------------------------------------------------------- */
  function buildRuler() {
    var ruler = $('depth-ruler');
    if (!ruler) return;
    for (var i = 0; i <= 30; i++) {
      var lbl = mk('span', 'ruler-label', i * 10);
      lbl.style.top = (i * 70) + 'px';
      ruler.appendChild(lbl);
    }
  }

  /* ----------------------------------------------------------
     Events
  ---------------------------------------------------------- */
  function uniqueGasId(base) {
    var id = base, n = 2;
    while (gasById(id)) { id = base + '-' + n; n++; }
    return id;
  }

  function bindEvents() {
    // --- segments (delegated)
    $('segments-body').addEventListener('input', function (ev) {
      var t = ev.target;
      if (t.getAttribute('data-seg') === null) return;
      var i = parseInt(t.getAttribute('data-seg'), 10);
      var f = t.getAttribute('data-field');
      var s = state.segments[i];
      if (!s) return;
      if (f === 'depth') s.depth = depthIn(t.value);
      else if (f === 'time') s.time = num(t.value);
      else if (f === 'gasId') s.gasId = t.value;
      onStateChanged();
    });
    $('segments-body').addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.tagName === 'SELECT' && t.getAttribute('data-seg') !== null) {
        var i = parseInt(t.getAttribute('data-seg'), 10);
        if (state.segments[i]) { state.segments[i].gasId = t.value; onStateChanged(); }
      }
    });
    $('segments-body').addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-remove-seg]') : null;
      if (!btn) return;
      var i = parseInt(btn.getAttribute('data-remove-seg'), 10);
      state.segments.splice(i, 1);
      renderSegments();
      onStateChanged();
    });
    $('add-level-btn').addEventListener('click', function () {
      var prev = state.segments[state.segments.length - 1];
      state.segments.push({
        depth: prev ? prev.depth : 30,
        time: 10,
        gasId: prev ? prev.gasId : (state.gases[0] ? state.gases[0].id : '')
      });
      renderSegments();
      onStateChanged();
    });

    // TRAVEL toggles ascent/descent legs in the table (view-only, no recompute).
    $('travel-btn').addEventListener('click', function () {
      state.showTravel = !state.showTravel;
      syncTravelBtn();
      saveState();
      if (lastGoodResult) renderTable(lastGoodResult, false);
    });

    // --- gases (delegated)
    $('gases-list').addEventListener('input', function (ev) {
      var t = ev.target;
      if (t.getAttribute('data-gas') === null) return;
      var i = parseInt(t.getAttribute('data-gas'), 10);
      var g = state.gases[i];
      if (!g) return;
      var f = t.getAttribute('data-field');
      if (f === 'startBar') {
        // Cylinder fill does not affect the engine plan — only the supply
        // readout. Update state and re-render the gas cards/warnings directly,
        // without a debounced replan or rebuilding the gas inputs (keeps focus).
        g.startBar = imperial() ? num(t.value) / BAR2PSI : num(t.value);
        saveState();
        if (lastGoodResult) {
          renderGasUsage(lastGoodResult);
          renderWarnings(lastGoodResult, gasSupplyWarnings(lastGoodResult));
        }
        return;
      }
      if (f === 'fO2') g.fO2 = num(t.value) / 100;
      else if (f === 'fHe') g.fHe = num(t.value) / 100;
      else if (f === 'type') g.type = t.value;
      renderSegments(); // gas labels inside segment selects may change
      onStateChanged({ refreshGas: true });
    });
    $('gases-list').addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.tagName !== 'SELECT' || t.getAttribute('data-gas') === null) return;
      var i = parseInt(t.getAttribute('data-gas'), 10);
      var g = state.gases[i];
      if (!g) return;
      var f = t.getAttribute('data-field');
      if (f === 'cyl') {
        // Adopt the new tank's rated fill when switching cylinder type.
        var c = cylPreset(t.value);
        if (c) { g.cyl = c.key; g.startBar = c.ratedBar; }
        renderGases();          // refresh the start-pressure field
      } else if (f === 'type') {
        g.type = t.value;
      }
      renderSegments();
      onStateChanged({ refreshGas: true });
    });
    $('gases-list').addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-remove-gas]') : null;
      if (!btn) return;
      var i = parseInt(btn.getAttribute('data-remove-gas'), 10);
      state.gases.splice(i, 1);
      renderGases();
      renderSegments();
      onStateChanged();
    });
    $('add-gas-btn').addEventListener('click', function () {
      var p = PRESETS[parseInt($('gas-preset').value, 10)] || PRESETS[0];
      var defCyl = (p.type === 'deco') ? 's80' : 'd2x12';
      state.gases.push({
        id: uniqueGasId(p.key),
        fO2: p.fO2, fHe: p.fHe, type: p.type,
        cyl: defCyl, startBar: cylPreset(defCyl).ratedBar
      });
      renderGases();
      renderSegments();
      onStateChanged();
    });

    // --- algorithm
    $('algo-zhl').addEventListener('click', function () {
      // Switch to Buhlmann; preserve the chosen B/C variant if already on it.
      if (state.algorithm === 'VPMB') state.algorithm = 'ZHL16B';
      renderAlgo(); onStateChanged();
    });
    $('algo-vpm').addEventListener('click', function () {
      if (this.disabled) return;
      state.algorithm = 'VPMB'; renderAlgo(); onStateChanged();
    });
    // ZHL-16 coefficient variant sub-toggle (visible only under Buhlmann).
    [['zhl-c', 'ZHL16C'], ['zhl-b', 'ZHL16B']].forEach(function (p) {
      $(p[0]).addEventListener('click', function () {
        state.algorithm = p[1]; renderAlgo(); onStateChanged();
      });
    });
    function bindGf(numId, rangeId, key) {
      $(numId).addEventListener('input', function () {
        state[key] = clampInt(this.value, 5, 100);
        $(rangeId).value = state[key];
        onStateChanged();
      });
      $(rangeId).addEventListener('input', function () {
        state[key] = clampInt(this.value, 5, 100);
        $(numId).value = state[key];
        onStateChanged();
      });
    }
    bindGf('gf-low-num', 'gf-low-range', 'gfLow');
    bindGf('gf-high-num', 'gf-high-range', 'gfHigh');
    $('vpm-minus').addEventListener('click', function () {
      state.vpmConservatism = Math.max(0, state.vpmConservatism - 1);
      $('vpm-value').textContent = '+' + state.vpmConservatism;
      onStateChanged();
    });
    $('vpm-plus').addEventListener('click', function () {
      state.vpmConservatism = Math.min(5, state.vpmConservatism + 1);
      $('vpm-value').textContent = '+' + state.vpmConservatism;
      onStateChanged();
    });

    // --- settings
    $('set-descent').addEventListener('input', function () { state.descentRate = rateIn(this.value); onStateChanged(); });
    $('set-ascent').addEventListener('input', function () { state.ascentRate = rateIn(this.value); onStateChanged(); });
    $('set-sp').addEventListener('input', function () { state.surfacePressure = num(this.value); onStateChanged({ refreshGas: true }); });
    $('set-ppo2').addEventListener('input', function () { state.ppO2MaxDeco = num(this.value); onStateChanged({ refreshGas: true }); });
    $('set-sac-bottom').addEventListener('input', function () { state.sacBottom = sacIn(this.value); onStateChanged(); });
    $('set-sac-deco').addEventListener('input', function () { state.sacDeco = sacIn(this.value); onStateChanged(); });
    // Extra reserve is presentation-only (doesn't change the deco plan): update
    // state and re-render gas cards/warnings without a replan.
    $('set-extra-reserve').addEventListener('input', function () {
      var bar = imperial() ? num(this.value) / BAR2PSI : num(this.value);
      state.extraReserveBar = isFinite(bar) && bar >= 0 ? bar : 0;
      saveState();
      applyValidation();
      if (lastGoodResult) {
        renderGasUsage(lastGoodResult);
        renderWarnings(lastGoodResult, gasSupplyWarnings(lastGoodResult));
      }
    });
    $('set-incl-travel').addEventListener('change', function () { state.segmentTimesIncludeTravel = this.checked; onStateChanged(); });
    [['laststop-3', 3], ['laststop-6', 6]].forEach(function (pair) {
      $(pair[0]).addEventListener('click', function () {
        state.lastStopDepth = pair[1];
        setSeg('laststop', pair[0]);
        onStateChanged();
      });
    });
    [['water-salt', 'salt'], ['water-fresh', 'fresh']].forEach(function (pair) {
      $(pair[0]).addEventListener('click', function () {
        state.water = pair[1];
        setSeg('water', pair[0]);
        onStateChanged({ refreshGas: true });
      });
    });

    // --- gas reserve rule (presentation-only: re-render cards from last plan)
    $('gas-reserve').addEventListener('change', function () {
      if (!RESERVE_RULES[this.value]) return;
      state.gasReserve = this.value;
      saveState();
      if (lastGoodResult) {
        renderGasUsage(lastGoodResult);
        renderWarnings(lastGoodResult, gasSupplyWarnings(lastGoodResult));
      }
    });

    // --- units toggle
    [['units-metric', 'metric'], ['units-imperial', 'imperial']].forEach(function (pair) {
      $(pair[0]).addEventListener('click', function () {
        if (state.units === pair[1]) return;
        state.units = pair[1];
        saveState();
        renderRail();        // re-display all inputs in new units
        applyValidation();
        if (lastGoodResult) {
          renderResults(lastGoodResult, false); // redraw results + charts in new units
        }
      });
    });

    // --- language
    var langSel = $('lang-select');
    if (langSel) {
      langSel.addEventListener('change', function () {
        state.lang = langSel.value;     // explicit choice overrides browser default
        saveState();
        // Re-render dynamic UI first, then translate so static chrome + any
        // freshly-built labels both carry the new language.
        renderRail();
        renderDives();
        if (lastGoodResult) renderResults(lastGoodResult, false);
        applyI18n();
        refreshSummary();   // rebuild the summarized table in the new language
      });
    }

    // --- header / primary actions
    $('reset-btn').addEventListener('click', function () {
      try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
      var units = state.units; // resetting the plan shouldn't flip display units
      var lang = state.lang;   // …nor the chosen language
      state = defaults();
      state.units = units;
      state.lang = lang;
      if (!hasVPM && state.algorithm === 'VPMB') state.algorithm = 'ZHL16C';
      renderRail();
      saveState();
      applyValidation();
      runPlan(true);
    });
    $('plan-btn').addEventListener('click', function () { runPlan(true); });
    $('copy-btn').addEventListener('click', copyPlan);

    // SUMMARY toggles the summarized/contingency table (re-plans 5 variants).
    $('summary-btn').addEventListener('click', toggleSummary);
    $('summary-copy-btn').addEventListener('click', copySummary);

    // --- saved dives
    var saveBtn = $('dive-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var nameInput = $('dive-name');
        var name = nameInput ? nameInput.value : '';
        if (saveDive(name)) {
          if (nameInput) nameInput.value = '';
          var orig = saveBtn.textContent;
          saveBtn.textContent = 'SAVED ✓';
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(function () { saveBtn.textContent = orig; }, 1600);
        }
      });
    }
    var nameField = $('dive-name');
    if (nameField) {
      nameField.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); saveBtn && saveBtn.click(); }
      });
    }
    var exportBtn = $('dives-export-btn');
    if (exportBtn) exportBtn.addEventListener('click', exportDives);
    var importBtn = $('dives-import-btn');
    var importFile = $('dives-import-file');
    if (importBtn && importFile) {
      importBtn.addEventListener('click', function () { importFile.click(); });
      importFile.addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        importDives(f);
        importFile.value = ''; // allow re-importing the same file
      });
    }
    var divesList = $('dives-list');
    if (divesList) {
      divesList.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('[data-action]') : null;
        if (!btn) return;
        var row = btn.closest('[data-dive-name]');
        if (!row) return;
        var name = row.getAttribute('data-dive-name');
        var action = btn.getAttribute('data-action');
        if (action === 'delete') {
          deleteDive(name);
        } else if (action === 'load') {
          var rec = null, all = loadDives();
          for (var i = 0; i < all.length; i++) { if (all[i].name === name) { rec = all[i]; break; } }
          if (!rec) return;
          applyDive(rec.dive);
          renderRail();
          saveState();
          applyValidation();
          runPlan(true);
        }
      });
    }

    // re-render charts on resize (debounced) so they can refit
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (!hasCharts || !lastGoodResult) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { renderCharts(lastGoodResult); }, 250);
    });
  }

  /* ----------------------------------------------------------
     Init — must never throw
  ---------------------------------------------------------- */
  function init() {
    buildRuler();
    loadState();
    detectModules(); // may coerce algorithm if VPM missing
    renderLangSelect();
    renderPresets();
    renderRail();
    renderDives();
    applyI18n();      // translate static chrome after the rail is built
    bindEvents();
    var v = applyValidation();
    if (!v.errors.length) {
      runPlan(true); // first plan on load (mock if engines absent)
    } else {
      // invalid restored state: leave results empty, panels stay unrevealed
      revealPanels();
    }
  }

  try {
    init();
  } catch (err) {
    try {
      showBanner('UI FAULT — ' + (err && err.message ? err.message : 'initialization failed'), true);
    } catch (e2) { /* nothing more we can do */ }
    if (window.console) console.error('HALDANE init failed:', err);
  }
})();
