/*
 * Tests for the ZHL-16C/ZHL-16B + gradient factors engine. Plain Node script,
 * no framework:
 *   node tests/zhl16.test.js
 * Prints "PASS name" / "FAIL name" lines and exits 1 on any failure.
 */
'use strict';

const path = require('path');
const DecoEngine = require(path.join(__dirname, '..', 'js', 'engine', 'zhl16.js'));

let failures = 0;
function check(name, cond, info) {
  if (cond) {
    console.log('PASS ' + name);
  } else {
    failures++;
    console.log('FAIL ' + name + (info !== undefined ? '  [' + info + ']' : ''));
  }
}

function baseInput(extra) {
  const input = {
    algorithm: 'ZHL16C',
    gfLow: 50, gfHigh: 80,
    vpmConservatism: 2,
    surfacePressure: 1.013,
    water: 'salt',
    descentRate: 18,
    ascentRate: 9,
    stopInterval: 3,
    lastStopDepth: 6,
    minStopTime: 1,
    gasSwitchStopTime: 1,
    ppO2MaxDeco: 1.61,
    segmentTimesIncludeTravel: true,
    segments: [{ depth: 45, time: 25, gasId: 'tx2135' }],
    gases: [
      { id: 'tx2135', fO2: 0.21, fHe: 0.35, type: 'bottom' },
      { id: 'ean50', fO2: 0.50, fHe: 0.00, type: 'deco' },
      { id: 'o2', fO2: 1.00, fHe: 0.00, type: 'deco' }
    ],
    sacBottom: 20,
    sacDeco: 16
  };
  if (extra) for (const k in extra) input[k] = extra[k];
  return input;
}

// ---------------------------------------------------------------------------
// 1. Module surface + contract initial tissue state
// ---------------------------------------------------------------------------
(function () {
  check('exports plan() and VERSION',
    typeof DecoEngine.plan === 'function' && typeof DecoEngine.VERSION === 'string' &&
    DecoEngine.VERSION.length > 0);

  const t = DecoEngine._internal.initTissues(1.013);
  const expected = (1.013 - 0.0627) * 0.79;
  let okN2 = true, okHe = true;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(t.pn[i] - expected) > 1e-12) okN2 = false;
    if (t.ph[i] !== 0) okHe = false;
  }
  check('surface saturation pN2 = (P - 0.0627)*0.79 in all 16 compartments', okN2,
    'expected ' + expected + ' got ' + t.pn[0]);
  check('surface saturation pHe = 0 in all 16 compartments', okHe);
})();

// ---------------------------------------------------------------------------
// 2. Tissue kinetics primitives: Haldane half-time + Schreiner consistency
// ---------------------------------------------------------------------------
(function () {
  const I = DecoEngine._internal;
  const ctx = I.makeCtxLite(1.013, 'salt');
  const gasAir = { fN2: 0.79, fHe: 0 };

  // hold air-saturated tissues at 30 m for exactly one N2 half-time each:
  // each compartment must close exactly half the gap to the inspired pressure
  const t = I.initTissues(1.013);
  const pin = (1.013 + 3.0 - 0.0627) * 0.79;
  const start = t.pn[0];
  let haldaneOk = true;
  for (let i = 0; i < 16; i++) {
    const pn = t.pn.slice(), ph = t.ph.slice();
    I.loadConstant(pn, ph, ctx, 30, I.HT_N2[i], gasAir);
    const expected = pin + (start - pin) * 0.5;
    if (Math.abs(pn[i] - expected) > 1e-9) haldaneOk = false;
  }
  check('Haldane: one half-time at depth closes exactly half the gap', haldaneOk);

  // Schreiner travel must agree with many small constant-depth steps
  const a = I.initTissues(1.013);
  I.loadTravel(a.pn, a.ph, ctx, 0, 45, 2.5, gasAir);
  const b = I.initTissues(1.013);
  const N = 5000;
  for (let j = 0; j < N; j++) {
    const d = 45 * (j + 0.5) / N;
    I.loadConstant(b.pn, b.ph, ctx, d, 2.5 / N, gasAir);
  }
  let schreinerOk = true;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(a.pn[i] - b.pn[i]) > 1e-4) schreinerOk = false;
  }
  check('Schreiner travel matches finely-stepped Haldane integration', schreinerOk);
})();

// ---------------------------------------------------------------------------
// 3. NDL sanity vs published ZHL-16C no-deco limits (GF 100/100)
//    Buhlmann ZHL-16C air NDLs are roughly 18m~59, 30m~14-17, 40m~6-9 min.
// ---------------------------------------------------------------------------
(function () {
  function ndlAt(depth) {
    const r = DecoEngine.plan(baseInput({
      gfLow: 100, gfHigh: 100, segmentTimesIncludeTravel: false, lastStopDepth: 3,
      segments: [{ depth: depth, time: 1, gasId: 'air' }],
      gases: [{ id: 'air', fO2: 0.21, fHe: 0, type: 'bottom' }]
    }));
    return r.ok && r.noDeco ? r.ndl : null;
  }
  const n18 = ndlAt(18), n30 = ndlAt(30), n40 = ndlAt(40);
  check('air 18 m NDL in [50,70] (published ~59)', n18 !== null && n18 >= 50 && n18 <= 70, 'ndl=' + n18);
  check('air 30 m NDL in [11,20] (published ~14-17)', n30 !== null && n30 >= 11 && n30 <= 20, 'ndl=' + n30);
  check('air 40 m NDL in [5,11] (published ~6-9)', n40 !== null && n40 >= 5 && n40 <= 11, 'ndl=' + n40);
  check('NDL strictly decreases with depth', n18 > n30 && n30 > n40);
})();

// ---------------------------------------------------------------------------
// 4. No-deco dive shape
// ---------------------------------------------------------------------------
(function () {
  const r = DecoEngine.plan(baseInput({
    segments: [{ depth: 15, time: 20, gasId: 'air' }],
    gases: [{ id: 'air', fO2: 0.21, fHe: 0, type: 'bottom' }]
  }));
  check('air 15 m / 20 min returns ok', r.ok, JSON.stringify(r.errors));
  check('air 15 m / 20 min is noDeco with ndl >= 1',
    r.ok && r.noDeco === true && typeof r.ndl === 'number' && r.ndl >= 1, 'ndl=' + r.ndl);
  check('noDeco: no stops, null firstStopDepth, zero totalDecoTime',
    r.ok && r.stops.length === 0 && r.firstStopDepth === null && r.totalDecoTime === 0);
  check('noDeco dive still ends at the surface',
    r.ok && r.table[r.table.length - 1].endDepth === 0);
})();

// ---------------------------------------------------------------------------
// 5. Reference trimix dive: 45 m / 25 min, 21/35, EAN50 + O2, GF 50/80,
//    last stop 6 m
// ---------------------------------------------------------------------------
const ref = DecoEngine.plan(baseInput());
(function () {
  const r = ref;
  check('45/25 tx21/35 ok=true', r.ok, JSON.stringify(r.errors));
  if (!r.ok) return;
  check('45/25 has deco (noDeco=false, ndl=null)', r.noDeco === false && r.ndl === null);
  check('45/25 firstStopDepth in [9,24]',
    r.firstStopDepth >= 9 && r.firstStopDepth <= 24, 'firstStop=' + r.firstStopDepth);
  check('45/25 totalRuntime in [45,95]',
    r.totalRuntime >= 45 && r.totalRuntime <= 95, 'runtime=' + r.totalRuntime);
  check('45/25 totalDecoTime in [12,60]',
    r.totalDecoTime >= 12 && r.totalDecoTime <= 60, 'deco=' + r.totalDecoTime);
  let monotonic = r.stops.length >= 2, intOk = true;
  for (let i = 1; i < r.stops.length; i++) {
    if (!(r.stops[i].depth < r.stops[i - 1].depth)) monotonic = false;
  }
  for (const s of r.stops) if (!Number.isInteger(s.time) || s.time < 1) intOk = false;
  check('45/25 stop depths strictly decreasing', monotonic, JSON.stringify(r.stops.map(s => s.depth)));
  check('45/25 all stop times integers >= 1', intOk, JSON.stringify(r.stops.map(s => s.time)));
  check('45/25 no 3 m stop with lastStopDepth=6',
    !r.stops.some(s => s.depth < 6 - 1e-9), JSON.stringify(r.stops.map(s => s.depth)));
  let rtInc = true;
  for (let i = 1; i < r.table.length; i++) {
    if (r.table[i].runtime < r.table[i - 1].runtime - 1e-9) rtInc = false;
  }
  check('45/25 table runtime non-decreasing', rtInc);
  const last = r.table[r.table.length - 1];
  check('45/25 last row runtime equals totalRuntime', Math.abs(last.runtime - r.totalRuntime) < 1e-6);
  check('45/25 dive ends at the surface', last.endDepth === 0);

  const sw = r.table.filter(row => row.phase === 'switch');
  check('45/25 gas switch at 21 m to ean50',
    sw.some(row => row.startDepth === 21 && row.gasId === 'ean50'),
    JSON.stringify(sw.map(row => row.startDepth + ':' + row.gasId)));
  check('45/25 gas switch at 6 m to o2',
    sw.some(row => row.startDepth === 6 && row.gasId === 'o2'),
    JSON.stringify(sw.map(row => row.startDepth + ':' + row.gasId)));
})();

// ---------------------------------------------------------------------------
// 6. Gradient factor behavior
// ---------------------------------------------------------------------------
(function () {
  if (!ref.ok) { check('GF behavior (needs ref dive ok)', false); return; }
  const tight = DecoEngine.plan(baseInput({ gfLow: 30, gfHigh: 70 }));
  const loose = DecoEngine.plan(baseInput({ gfLow: 90, gfHigh: 90 }));
  check('GF runs ok', tight.ok && loose.ok);
  check('lower GFs -> more deco (30/70 > 50/80 > 90/90)',
    tight.totalDecoTime > ref.totalDecoTime && ref.totalDecoTime > loose.totalDecoTime,
    '30/70=' + tight.totalDecoTime + ' 50/80=' + ref.totalDecoTime + ' 90/90=' + loose.totalDecoTime);
  check('lower gfLow -> first stop at least as deep',
    tight.firstStopDepth >= ref.firstStopDepth,
    '30/70=' + tight.firstStopDepth + ' 50/80=' + ref.firstStopDepth);

  // gfAt: anchored slope, gfLow at anchor, gfHigh at surface, clamped
  const gfAt = DecoEngine._internal.gfAt;
  const ctx = { gfLo: 0.5, gfHi: 0.8 };
  check('gfAt(anchor)=gfLow, gfAt(0)=gfHigh, midpoint interpolates',
    Math.abs(gfAt(18, 18, ctx) - 0.5) < 1e-12 &&
    Math.abs(gfAt(0, 18, ctx) - 0.8) < 1e-12 &&
    Math.abs(gfAt(9, 18, ctx) - 0.65) < 1e-12);
  check('gfAt clamps below the anchor', Math.abs(gfAt(30, 18, ctx) - 0.5) < 1e-12);
})();

// ---------------------------------------------------------------------------
// 7. Stop ladder conventions: lastStopDepth 3 vs 6
// ---------------------------------------------------------------------------
(function () {
  const r3 = DecoEngine.plan(baseInput({ lastStopDepth: 3 }));
  check('lastStop=3 runs ok', r3.ok, JSON.stringify(r3.errors));
  if (!r3.ok || !ref.ok) return;
  check('lastStop=3 ladder has a 3 m stop', r3.stops.some(s => s.depth === 3),
    JSON.stringify(r3.stops.map(s => s.depth)));
  check('lastStop=6 ladder has none shallower than 6 m', !ref.stops.some(s => s.depth < 6));
  const onInterval = r3.stops.every(s => s.depth % 3 === 0);
  check('all stops at multiples of stopInterval', onInterval);
})();

// ---------------------------------------------------------------------------
// 8. Gas switch MOD rule (must match the VPM-B engine: floor to the stop
//    interval with a half-interval tolerance)
// ---------------------------------------------------------------------------
(function () {
  // EAN36 at ppO2Max 1.5, surface 1.0 bar: raw MOD 31.67 m -> canonical 33 m
  const r = DecoEngine.plan(baseInput({
    ppO2MaxDeco: 1.5, surfacePressure: 1.0, lastStopDepth: 3,
    segments: [{ depth: 60, time: 20, gasId: 'tx1845' }],
    gases: [
      { id: 'tx1845', fO2: 0.18, fHe: 0.45, type: 'bottom' },
      { id: 'ean36', fO2: 0.36, fHe: 0.00, type: 'deco' },
      { id: 'o2', fO2: 1.00, fHe: 0.00, type: 'deco' }
    ]
  }));
  check('EAN36 reference run ok', r.ok, JSON.stringify(r.errors));
  if (!r.ok) return;
  const sw = r.table.filter(row => row.phase === 'switch').map(row => row.startDepth + ':' + row.gasId);
  check('EAN36 switch at 33 m (V-Planner/Baker convention, same as VPM-B engine)',
    sw.indexOf('33:ean36') >= 0, JSON.stringify(sw));
  check('O2 switch at 6 m', sw.indexOf('6:o2') >= 0, JSON.stringify(sw));
  let dropOk = true; // never switch DOWN in fO2 on ascent
  let cur = 0.18;
  for (const row of r.table) {
    if (row.phase === 'switch') {
      const g = r.gasUsage.filter(u => u.gasId === row.gasId)[0];
      if (g && g.fO2 < cur - 1e-9) dropOk = false;
      if (g) cur = g.fO2;
    }
  }
  check('never switches to a leaner gas during ascent', dropOk);
})();

// ---------------------------------------------------------------------------
// 9. Oxygen accounting: NOAA CNS rate table + OTU formula
// ---------------------------------------------------------------------------
(function () {
  const rate = DecoEngine._internal.cnsRate;
  check('cnsRate 0 at/below 0.5 bar', rate(0.5) === 0 && rate(0.3) === 0);
  check('cnsRate at table points: 1.0 -> 1/300, 1.6 -> 1/45',
    Math.abs(rate(1.0) - 1 / 300) < 1e-12 && Math.abs(rate(1.6) - 1 / 45) < 1e-12);
  const mid = 1 / 120 + 0.5 * (1 / 45 - 1 / 120);
  check('cnsRate linear between 1.5 and 1.6', Math.abs(rate(1.55) - mid) < 1e-12);
  const extrap = 1 / 45 + ((1 / 45 - 1 / 120) / 0.1) * 0.1;
  check('cnsRate extrapolates the 1.5->1.6 slope above 1.6',
    Math.abs(rate(1.7) - extrap) < 1e-12);

  if (!ref.ok) return;
  check('reference dive CNS and OTU positive and sane',
    ref.oxygen.cns > 0 && ref.oxygen.cns < 100 && ref.oxygen.otu > 0 && ref.oxygen.otu < 200,
    'cns=' + ref.oxygen.cns + ' otu=' + ref.oxygen.otu);
  // O2 at 6 m (1.013 bar surface) gives ppO2 1.613 > 1.6: the extrapolation
  // warning required by the contract must be present.
  check('warning issued for ppO2 above 1.6 bar (O2 at 6 m)',
    ref.warnings.some(w => /1\.6/.test(w)), JSON.stringify(ref.warnings));
})();

// ---------------------------------------------------------------------------
// 10. Gas usage: contract formula sac(phase) * avg(Pamb) * duration per row
// ---------------------------------------------------------------------------
(function () {
  if (!ref.ok) { check('gas usage (needs ref dive ok)', false); return; }
  const sp = 1.013, mpb = 10.0;
  function pa(d) { return sp + d / mpb; }
  const expect = {};
  for (const row of ref.table) {
    const sac = (row.phase === 'desc' || row.phase === 'level') ? 20 : 16;
    expect[row.gasId] = (expect[row.gasId] || 0) +
      sac * (pa(row.startDepth) + pa(row.endDepth)) / 2 * row.duration;
  }
  let usageOk = ref.gasUsage.length === 3;
  for (const u of ref.gasUsage) {
    if (Math.abs(u.liters - (expect[u.gasId] || 0)) > 1e-6) usageOk = false;
    if (!(u.liters > 0)) usageOk = false;
  }
  check('gasUsage matches the contract formula row-for-row', usageOk,
    JSON.stringify(ref.gasUsage.map(u => u.gasId + ':' + u.liters.toFixed(1))));
})();

// ---------------------------------------------------------------------------
// 11. Input validation errors
// ---------------------------------------------------------------------------
(function () {
  const tooShort = DecoEngine.plan(baseInput({
    segments: [{ depth: 45, time: 2, gasId: 'tx2135' }] // travel alone is 2.5 min
  }));
  check('segment time < travel time -> ok=false with an error',
    tooShort.ok === false && tooShort.errors.length > 0, JSON.stringify(tooShort.errors));

  const badGas = DecoEngine.plan(baseInput({
    segments: [{ depth: 45, time: 25, gasId: 'nope' }]
  }));
  check('unknown segment gasId -> ok=false', badGas.ok === false && badGas.errors.length > 0);

  const noGases = DecoEngine.plan(baseInput({ gases: [], segments: [] }));
  check('no gases / no segments -> ok=false', noGases.ok === false && noGases.errors.length >= 2);

  const badFrac = DecoEngine.plan(baseInput({
    gases: [{ id: 'x', fO2: 0.5, fHe: 0.6, type: 'bottom' }],
    segments: [{ depth: 30, time: 20, gasId: 'x' }]
  }));
  check('fO2 + fHe > 1 -> ok=false', badFrac.ok === false);

  check('failed plan still returns the full result shape',
    Array.isArray(tooShort.table) && Array.isArray(tooShort.stops) &&
    Array.isArray(tooShort.profile) && tooShort.totalRuntime === 0);
})();

// ---------------------------------------------------------------------------
// 12. Result-shape conformance with the shared contract
// ---------------------------------------------------------------------------
(function () {
  const r = ref;
  if (!r.ok) { check('shape conformance (needs ref dive ok)', false); return; }
  const fin = (x) => typeof x === 'number' && isFinite(x);

  check('shape: top-level fields present',
    r.ok === true && Array.isArray(r.errors) && Array.isArray(r.warnings) &&
    r.algorithm === 'ZHL16C' && typeof r.params === 'object' &&
    Array.isArray(r.table) && Array.isArray(r.stops) &&
    typeof r.noDeco === 'boolean' && (r.ndl === null || fin(r.ndl)) &&
    (r.firstStopDepth === null || fin(r.firstStopDepth)) &&
    fin(r.totalRuntime) && fin(r.totalDecoTime) &&
    Array.isArray(r.gasUsage) && typeof r.oxygen === 'object' &&
    Array.isArray(r.profile) && Array.isArray(r.ceilingProfile) &&
    Array.isArray(r.finalTissues));

  check('shape: params echo',
    r.params.gfLow === 50 && r.params.gfHigh === 80 &&
    r.params.lastStopDepth === 6 && fin(r.params.surfacePressure) && r.params.water === 'salt');

  const phases = ['desc', 'level', 'asc', 'stop', 'switch'];
  let tableOk = r.table.length > 0;
  for (const row of r.table) {
    if (phases.indexOf(row.phase) < 0 || !fin(row.startDepth) || !fin(row.endDepth) ||
      !fin(row.duration) || !fin(row.runtime) || typeof row.gasId !== 'string' ||
      !fin(row.ppO2Start) || !fin(row.ppO2End)) tableOk = false;
  }
  check('shape: every table row well-formed and finite', tableOk);

  let profOk = r.profile.length > 1 && r.profile[0].t === 0;
  for (let i = 1; i < r.profile.length; i++) {
    const a = r.profile[i - 1], b = r.profile[i];
    if (!(b.t - a.t <= 0.5 + 1e-9) || b.t < a.t - 1e-9 || !fin(b.depth) ||
      typeof b.gasId !== 'string') profOk = false;
  }
  check('shape: profile sampled at <= 0.5 min steps, t monotonic, starts at 0', profOk);
  check('shape: profile ends at totalRuntime',
    Math.abs(r.profile[r.profile.length - 1].t - r.totalRuntime) < 1e-6);

  let ceilOk = r.ceilingProfile.length === r.profile.length;
  for (const c of r.ceilingProfile) if (!fin(c.t) || !fin(c.ceiling) || c.ceiling < 0) ceilOk = false;
  check('shape: ceilingProfile finite, non-negative, same sampling as profile', ceilOk,
    'len ceiling=' + r.ceilingProfile.length + ' profile=' + r.profile.length);

  let ftOk = r.finalTissues.length === 16;
  for (const ft of r.finalTissues) {
    if (!fin(ft.pN2) || !fin(ft.pHe) || !fin(ft.pTotal) ||
      Math.abs(ft.pTotal - (ft.pN2 + ft.pHe)) > 1e-9 || !fin(ft.gfSurfacePct)) ftOk = false;
  }
  check('shape: finalTissues 16 entries, pTotal consistent, numeric gfSurfacePct', ftOk);
  check('shape: surfacing GF stays at/below gfHigh (+2pct tolerance)',
    r.finalTissues.every(ft => ft.gfSurfacePct <= 82),
    JSON.stringify(r.finalTissues.map(ft => Math.round(ft.gfSurfacePct))));
})();

// ---------------------------------------------------------------------------
// 13. Environment conventions: fresh vs salt water, surface pressure
// ---------------------------------------------------------------------------
(function () {
  if (!ref.ok) return;
  const fresh = DecoEngine.plan(baseInput({ water: 'fresh' }));
  check('fresh-water run ok', fresh.ok, JSON.stringify(fresh.errors));
  check('45 m fresh (10.3 m/bar) needs <= deco of 45 m salt (10.0 m/bar)',
    fresh.ok && fresh.totalDecoTime <= ref.totalDecoTime + 1e-9,
    'fresh=' + fresh.totalDecoTime + ' salt=' + ref.totalDecoTime);

  const altitude = DecoEngine.plan(baseInput({ surfacePressure: 0.85 }));
  check('altitude (0.85 bar) run ok with more deco than sea level',
    altitude.ok && altitude.totalDecoTime > ref.totalDecoTime,
    'alt=' + (altitude.ok && altitude.totalDecoTime) + ' sea=' + ref.totalDecoTime);
})();

// ---------------------------------------------------------------------------
// 14. Multilevel dive and segmentTimesIncludeTravel
// ---------------------------------------------------------------------------
(function () {
  const multi = DecoEngine.plan(baseInput({
    segments: [
      { depth: 45, time: 20, gasId: 'tx2135' },
      { depth: 30, time: 10, gasId: 'tx2135' }
    ]
  }));
  check('multilevel 45->30 plan ok', multi.ok, JSON.stringify(multi.errors));
  if (multi.ok) {
    const lv = multi.table.filter(row => row.phase === 'level');
    check('multilevel has two level rows (45 m and 30 m)',
      lv.length === 2 && lv[0].startDepth === 45 && lv[1].startDepth === 30,
      JSON.stringify(lv.map(l => l.startDepth)));
    // includeTravel: level time = stated time - travel into it
    const travelIn = 45 / 18;
    check('level time deducts travel when segmentTimesIncludeTravel',
      Math.abs(lv[0].duration - (20 - travelIn)) < 1e-9, 'got ' + lv[0].duration);
  }
  const noTravel = DecoEngine.plan(baseInput({ segmentTimesIncludeTravel: false }));
  check('segmentTimesIncludeTravel=false keeps the full stated level time',
    noTravel.ok &&
    Math.abs(noTravel.table.filter(r => r.phase === 'level')[0].duration - 25) < 1e-9);
})();

// ---------------------------------------------------------------------------
// Golden values for the deterministic reference dive (45 m / 25 min, 21/35,
// EAN50 + O2, GF 50/80, last stop 6 m). Independently re-derived from the
// engine's verified primitives during review; loose range checks alone would
// let GF-ladder convention regressions (slope anchor, leave criterion) slip
// through as a few extra minutes.
// ---------------------------------------------------------------------------
(function () {
  const r = DecoEngine.plan(baseInput());
  check('golden: reference stops exactly [12/2, 9/3, 6/12]',
    r.ok && JSON.stringify(r.stops.map(s => [s.depth, s.time])) === '[[12,2],[9,3],[6,12]]',
    JSON.stringify(r.stops.map(s => [s.depth, s.time])));
  check('golden: reference runtime 49.0', r.ok && Math.abs(r.totalRuntime - 49.0) < 0.05,
    'runtime=' + r.totalRuntime);
  check('golden: reference deco time 19.33', r.ok && Math.abs(r.totalDecoTime - 19.333) < 0.05,
    'deco=' + r.totalDecoTime);
  check('golden: reference first stop 12 m', r.ok && r.firstStopDepth === 12,
    'firstStop=' + r.firstStopDepth);
})();

// ---------------------------------------------------------------------------
// Deco gas breathable at the bottom switches at the start of the ascent
// (V-Planner convention: switch at MOD), not at the first stop.
// ---------------------------------------------------------------------------
(function () {
  const r = DecoEngine.plan(baseInput({
    segments: [{ depth: 20, time: 80, gasId: 'air' }],
    gases: [
      { id: 'air', fO2: 0.21, fHe: 0, type: 'bottom' },
      { id: 'ean50', fO2: 0.50, fHe: 0, type: 'deco' }   // MOD 21 m >= bottom 20 m
    ]
  }));
  check('bottom-switch dive ok', r.ok, JSON.stringify(r.errors));
  if (r.ok) {
    const sw = r.table.filter(row => row.phase === 'switch');
    check('switch row at the 20 m bottom before the ascent',
      sw.length > 0 && Math.abs(sw[0].startDepth - 20) < 1e-6 && sw[0].gasId === 'ean50',
      JSON.stringify(sw.map(row => row.startDepth + ':' + row.gasId)));
    check('no ascent leg breathes the bottom gas',
      !r.table.some(row => row.phase === 'asc' && row.gasId === 'air'));
  }
})();

// ---------------------------------------------------------------------------
// Displayed ceiling semantics: a no-deco dive must never show a ceiling above
// a surfaced diver (the surfacing criterion is gfHigh, and it is satisfied).
// ---------------------------------------------------------------------------
(function () {
  const r = DecoEngine.plan(baseInput({
    segments: [{ depth: 21, time: 45, gasId: 'ean32' }],
    gases: [{ id: 'ean32', fO2: 0.32, fHe: 0, type: 'bottom' }]
  }));
  check('NDL ceiling-display dive ok and noDeco', r.ok && r.noDeco === true,
    JSON.stringify({ ok: r.ok, noDeco: r.noDeco, errors: r.errors }));
  if (r.ok && r.noDeco) {
    const last = r.ceilingProfile[r.ceilingProfile.length - 1];
    check('NDL dive shows zero ceiling at the surface', last.ceiling <= 1e-6,
      'surfaced ceiling=' + last.ceiling);
    let viol = 0;
    for (let i = 0; i < r.profile.length; i++) {
      viol = Math.max(viol, r.ceilingProfile[i].ceiling - r.profile[i].depth);
    }
    check('NDL dive never shows the diver above the displayed ceiling', viol <= 1e-6,
      'max violation=' + viol);
  }
})();

// ---------------------------------------------------------------------------
// A user-forced shallow level above the live ceiling earns a warning
// (the schedule stays consistent; the planner must still flag the profile).
// ---------------------------------------------------------------------------
(function () {
  const r = DecoEngine.plan(baseInput({
    segments: [
      { depth: 45, time: 20, gasId: 'air' },
      { depth: 12, time: 10, gasId: 'air' },
      { depth: 40, time: 10, gasId: 'air' }
    ],
    gases: [{ id: 'air', fO2: 0.21, fHe: 0, type: 'bottom' }]
  }));
  check('ceiling-violating multilevel still plans (ok=true)', r.ok, JSON.stringify(r.errors));
  check('ceiling-violating multilevel carries a ceiling warning',
    r.ok && r.warnings.some(w => w.indexOf('above the decompression ceiling') >= 0),
    JSON.stringify(r.warnings));
  const clean = DecoEngine.plan(baseInput());
  check('reference dive carries no ceiling warning',
    clean.ok && !clean.warnings.some(w => w.indexOf('above the decompression ceiling') >= 0),
    JSON.stringify(clean.warnings));
})();

// ---------------------------------------------------------------------------
// VERIFY MODE (custom-stop replay)
// ---------------------------------------------------------------------------

// Seed custom stops from a computed plan exactly as the UI does
// (seedCustomStopsFromResult in js/ui/app.js): one editable row per held depth,
// deepest-first. A gas SWITCH pins its (new) gas to the switch depth; a STOP
// contributes hold time. Keeping the gas attached to the switch depth — not the
// next stop down — is the fix for the "EAN50 shows in the wrong place" bug.
function seedCustomStops(result) {
  const byDepth = [];
  function rowFor(depth, gasId) {
    let e = byDepth.find(function (d) { return Math.abs(d.depth - depth) < 1e-6; });
    if (!e) { e = { depth: depth, time: 0, gasId: gasId }; byDepth.push(e); }
    return e;
  }
  (result.table || []).forEach(function (x) {
    if (x.phase === 'switch') {
      const sw = rowFor(x.startDepth, x.gasId);
      sw.gasId = x.gasId;
      sw.time += x.duration;
    } else if (x.phase === 'stop') {
      const e = rowFor(x.startDepth, x.gasId);
      e.time += x.duration;
      if (!e.gasId) e.gasId = x.gasId;
    }
  });
  byDepth.sort(function (a, b) { return b.depth - a.depth; });
  return byDepth;
}

(function () {
  const gen = DecoEngine.plan(baseInput());
  check('generate path has verify === null', gen.verify === null, JSON.stringify(gen.verify));

  // 1. Round-trip identity: feed the computed schedule back as customStops.
  const cs = seedCustomStops(gen);
  const rt = DecoEngine.plan(baseInput({ customStops: cs }));
  check('verify round-trip ok', rt.ok, JSON.stringify(rt.errors));
  check('verify round-trip is safe', rt.verify && rt.verify.safe === true,
    JSON.stringify(rt.verify));
  check('verify round-trip exceedance ~0', rt.verify && rt.verify.maxCeilingExceedance <= 0.5,
    'exceed=' + (rt.verify && rt.verify.maxCeilingExceedance));
  check('verify round-trip runtime matches generate', Math.abs(rt.totalRuntime - gen.totalRuntime) < 0.6,
    'verify=' + rt.totalRuntime.toFixed(2) + ' generate=' + gen.totalRuntime.toFixed(2));

  // 1b. Gas-placement regression ("EAN50 in the wrong place"): the seeded stops
  //     must attach each switch gas to the depth where the computed plan switches
  //     to it — EAN50 at its ~21 m switch, O2 at its ~6 m switch — not to the
  //     next stop down. Derive the expected switch depths from the table itself.
  const switchRows = gen.table.filter(function (r) { return r.phase === 'switch'; });
  check('reference plan has at least one gas switch', switchRows.length >= 1, JSON.stringify(switchRows.map(function (r) { return [r.startDepth, r.gasId]; })));
  const placementOk = switchRows.every(function (sw) {
    const row = cs.find(function (s) { return Math.abs(s.depth - sw.startDepth) < 1e-6; });
    return row && row.gasId === sw.gasId;
  });
  check('seeded stops pin each switch gas to its switch depth', placementOk,
    JSON.stringify(cs.map(function (s) { return [s.depth, s.gasId]; })));
  // Seed order is strictly deepest-first (engine + UI convention).
  let seedDesc = true;
  for (let k = 1; k < cs.length; k++) if (cs[k].depth > cs[k - 1].depth) seedDesc = false;
  check('seeded stops ordered deepest-first', seedDesc, JSON.stringify(cs.map(function (s) { return s.depth; })));

  // 2. Unsafe: drop the shallowest (longest) stop's time to 1 min — well short
  //    of the obligation, so the ceiling is clearly violated near the surface.
  const cut = cs.map(function (s) {
    return Math.abs(s.depth - cs[cs.length - 1].depth) < 1e-6 ? { depth: s.depth, time: 1, gasId: s.gasId } : s;
  });
  const un = DecoEngine.plan(baseInput({ customStops: cut }));
  check('verify shortened is unsafe', un.ok && un.verify && un.verify.safe === false,
    JSON.stringify(un.verify));
  check('verify shortened exceedance > 0.5', un.verify && un.verify.maxCeilingExceedance > 0.5,
    'exceed=' + (un.verify && un.verify.maxCeilingExceedance));
  check('verify shortened has finite firstViolationDepth',
    un.verify && isFinite(un.verify.firstViolationDepth));
  check('verify shortened pushes a ceiling warning',
    un.warnings.some(function (w) { return /ceiling/i.test(w); }), JSON.stringify(un.warnings));

  // 3. Gas change recompute: breathe the 6 m stop on ean50 instead of o2.
  const swapGas = cs.map(function (s) {
    return Math.abs(s.depth - 6) < 1e-6 ? { depth: s.depth, time: s.time, gasId: 'ean50' } : s;
  });
  const gc = DecoEngine.plan(baseInput({ customStops: swapGas }));
  const stop6 = gc.table.filter(function (r) { return r.phase === 'stop' && Math.abs(r.startDepth - 6) < 1e-6; })[0];
  check('verify gas change: 6 m stop breathes ean50', stop6 && stop6.gasId === 'ean50',
    stop6 && stop6.gasId);
  check('verify gas change: ppO2 at 6 m reflects ean50 (~0.8 bar)',
    stop6 && Math.abs(stop6.ppO2End - 0.50 * (1.013 + 6 / 10)) < 1e-6, stop6 && stop6.ppO2End);
  check('verify gas change: CNS differs from o2 round-trip', Math.abs(gc.oxygen.cns - rt.oxygen.cns) > 1e-6);

  // 4. Off-grid / out-of-order depths are accepted and replayed.
  const odd = DecoEngine.plan(baseInput({
    customStops: [{ depth: 13, time: 2, gasId: 'ean50' }, { depth: 9, time: 4, gasId: 'ean50' },
                  { depth: 6, time: 12, gasId: 'o2' }]
  }));
  check('verify off-grid (13 m) stop accepted, ok', odd.ok, JSON.stringify(odd.errors));
  check('verify off-grid: a stop row exists at 13 m',
    odd.table.some(function (r) { return r.phase === 'stop' && Math.abs(r.startDepth - 13) < 1e-6; }));
  check('verify off-grid: verify verdict populated', odd.verify && typeof odd.verify.safe === 'boolean');

  // 5. Structurally invalid custom stops are rejected.
  const bad = DecoEngine.plan(baseInput({ customStops: [{ depth: 6, time: 5, gasId: 'nope' }] }));
  check('verify rejects unknown gas', !bad.ok && bad.errors.some(function (e) { return /unknown gas/.test(e); }),
    JSON.stringify(bad.errors));
})();

// ---------------------------------------------------------------------------
// 17. ZHL-16B coefficient variant
// ---------------------------------------------------------------------------
(function () {
  const I = DecoEngine._internal;
  check('exposes ZHL-16B coefficient arrays (length 16)',
    Array.isArray(I.A_N2_B) && I.A_N2_B.length === 16 &&
    Array.isArray(I.B_N2_B) && Array.isArray(I.A_HE_B) && Array.isArray(I.B_HE_B));

  // Compartment 1 N2 is identical to C (the 1.2599/0.5050 figure is ZHL-16A,
  // NOT B); compartment 5 is B's first divergence from C.
  check('ZHL-16B a_N2[0] equals C (1.1696, not the ZHL-16A 1.2599)',
    Math.abs(I.A_N2_B[0] - 1.1696) < 1e-9, I.A_N2_B[0]);
  check('ZHL-16B a_N2[4] = 0.6667 (stiffer than C 0.62)',
    Math.abs(I.A_N2_B[4] - 0.6667) < 1e-9 && I.A_N2_B[4] > I.A_N2[4], I.A_N2_B[4]);

  // N2 b and ALL He coefficients are identical between B and C.
  let heSame = true, bSame = true;
  for (let i = 0; i < 16; i++) {
    if (I.A_HE_B[i] !== I.A_HE[i] || I.B_HE_B[i] !== I.B_HE[i]) heSame = false;
    if (I.B_N2_B[i] !== I.B_N2[i]) bSame = false;
  }
  check('ZHL-16B helium coefficients identical to ZHL-16C', heSame);
  check('ZHL-16B nitrogen b coefficients identical to ZHL-16C', bSame);

  // a_N2 differs only at compartments 5..15 (1-based).
  const diff = [];
  for (let i = 0; i < 16; i++) if (I.A_N2_B[i] !== I.A_N2[i]) diff.push(i + 1);
  check('ZHL-16B a_N2 differs from C only at compartments 5..15',
    diff.join(',') === '5,6,7,8,9,10,11,12,13,14,15', diff.join(','));

  // Plan-level: B and C produce distinct, deterministic schedules on the
  // reference 45 m / 25 min trimix dive. Direction read from an actual run
  // (B yields slightly LESS deco here — the binding compartment's effective
  // M-value shifts; do not assume B is always more conservative).
  const c = DecoEngine.plan(baseInput({ algorithm: 'ZHL16C' }));
  const b = DecoEngine.plan(baseInput({ algorithm: 'ZHL16B' }));
  const stops = function (r) { return JSON.stringify(r.stops.map(function (s) { return [s.depth, s.time]; })); };
  check('ZHL16B run ok', b.ok, JSON.stringify(b.errors));
  check('ZHL16B result.algorithm === ZHL16B', b.algorithm === 'ZHL16B', b.algorithm);
  check('ZHL16C result.algorithm still ZHL16C', c.algorithm === 'ZHL16C', c.algorithm);
  check('ZHL16B schedule differs from ZHL16C on the reference dive',
    stops(b) !== stops(c) || b.totalDecoTime !== c.totalDecoTime);
  // Golden values (deterministic; read off a real run).
  check('ZHL16C golden stops on reference dive', stops(c) === '[[12,2],[9,3],[6,12]]', stops(c));
  check('ZHL16B golden stops on reference dive', stops(b) === '[[12,2],[9,3],[6,11]]', stops(b));

  // Default path: an input WITHOUT an algorithm field behaves exactly like
  // ZHL-16C (regression lock — the C default must stay byte-for-byte).
  const noAlgo = baseInput();
  delete noAlgo.algorithm;
  const r = DecoEngine.plan(noAlgo);
  check('absent algorithm defaults to ZHL16C behavior',
    r.ok && r.algorithm === 'ZHL16C' && stops(r) === '[[12,2],[9,3],[6,12]]',
    r.algorithm + ' ' + stops(r));
})();

// ---------------------------------------------------------------------------
console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
