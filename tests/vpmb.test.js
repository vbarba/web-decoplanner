/*
 * Tests for the VPM-B engine. Plain Node script, no framework:
 *   node tests/vpmb.test.js
 * Prints "PASS name" / "FAIL name" lines and exits 1 on any failure.
 */
'use strict';

const path = require('path');
const VPMB = require(path.join(__dirname, '..', 'js', 'engine', 'vpmb.js'));

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
    algorithm: 'VPMB',
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
// 1. Surface saturation matches the contract initial values
// ---------------------------------------------------------------------------
(function () {
  const t = VPMB._test.surfaceTissues(1.013);
  const expected = (1.013 - 0.0627) * 0.79;
  let okN2 = true, okHe = true;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(t.n2[i] - expected) > 1e-12) okN2 = false;
    if (t.he[i] !== 0) okHe = false;
  }
  check('surface saturation pN2 = (P - 0.0627)*0.79 in all 16 compartments', okN2,
    'expected ' + expected + ' got ' + t.n2[0]);
  check('surface saturation pHe = 0 in all 16 compartments', okHe);
})();

// ---------------------------------------------------------------------------
// 2. NDL behavior: shallow short dive is no-deco
// ---------------------------------------------------------------------------
(function () {
  const r = VPMB.plan(baseInput({
    segments: [{ depth: 15, time: 20, gasId: 'air' }],
    gases: [{ id: 'air', fO2: 0.21, fHe: 0, type: 'bottom' }]
  }));
  check('air 15 m / 20 min @ +2 returns ok', r.ok, JSON.stringify(r.errors));
  check('air 15 m / 20 min @ +2 is noDeco', r.ok && r.noDeco === true,
    'stops=' + JSON.stringify(r.stops));
  check('air 15 m / 20 min ndl is a number >= 1', r.ok && typeof r.ndl === 'number' && r.ndl >= 1,
    'ndl=' + r.ndl);
  check('noDeco dive has no stops and null firstStopDepth',
    r.ok && r.stops.length === 0 && r.firstStopDepth === null);
})();

// ---------------------------------------------------------------------------
// 3. Reference trimix dive: 45 m / 25 min, tx21/35, EAN50 + O2, +2, lastStop 6
// ---------------------------------------------------------------------------
const ref = VPMB.plan(baseInput());
(function () {
  const r = ref;
  check('45/25 tx21/35 ok=true', r.ok, JSON.stringify(r.errors));
  if (!r.ok) return;
  check('45/25 has deco (noDeco=false, ndl=null)', r.noDeco === false && r.ndl === null);
  check('45/25 firstStopDepth in [18,33] (VPM starts deep)',
    r.firstStopDepth >= 18 && r.firstStopDepth <= 33, 'firstStop=' + r.firstStopDepth);
  // Range recalibrated when BENCHMARK_RADIUS_FACTOR was corrected from a
  // misread 1.2 to Subsurface <= 4.6.2's actual 1.012 (deco shortened ~4 min).
  check('45/25 totalDecoTime in [14,70]',
    r.totalDecoTime >= 14 && r.totalDecoTime <= 70, 'totalDecoTime=' + r.totalDecoTime);
  let monotonic = true;
  for (let i = 1; i < r.stops.length; i++) {
    if (!(r.stops[i].depth < r.stops[i - 1].depth)) monotonic = false;
  }
  check('45/25 stop depths strictly decreasing', monotonic, JSON.stringify(r.stops.map(s => s.depth)));
  let rtInc = true;
  for (let i = 1; i < r.table.length; i++) {
    if (r.table[i].runtime < r.table[i - 1].runtime - 1e-9) rtInc = false;
  }
  check('45/25 table runtime non-decreasing', rtInc);
  const last = r.table[r.table.length - 1];
  check('45/25 last row runtime equals totalRuntime',
    Math.abs(last.runtime - r.totalRuntime) < 1e-6);
  check('45/25 dive ends at the surface', last.endDepth === 0);
})();

// ---------------------------------------------------------------------------
// 4. Conservatism monotonicity: +0 < +2 < +4 in totalDecoTime
// ---------------------------------------------------------------------------
(function () {
  const r0 = VPMB.plan(baseInput({ vpmConservatism: 0 }));
  const r2 = ref;
  const r4 = VPMB.plan(baseInput({ vpmConservatism: 4 }));
  check('conservatism runs ok', r0.ok && r2.ok && r4.ok);
  check('totalDecoTime(+0) < totalDecoTime(+2) < totalDecoTime(+4)',
    r0.ok && r2.ok && r4.ok &&
    r0.totalDecoTime < r2.totalDecoTime && r2.totalDecoTime < r4.totalDecoTime,
    '+0=' + r0.totalDecoTime + ' +2=' + r2.totalDecoTime + ' +4=' + r4.totalDecoTime);
})();

// ---------------------------------------------------------------------------
// 5. More bottom time -> more deco
// ---------------------------------------------------------------------------
(function () {
  const r35 = VPMB.plan(baseInput({ segments: [{ depth: 45, time: 35, gasId: 'tx2135' }] }));
  check('45/35 runs ok', r35.ok, JSON.stringify(r35.errors));
  check('more bottom time -> strictly more totalDecoTime',
    ref.ok && r35.ok && r35.totalDecoTime > ref.totalDecoTime,
    '25min=' + ref.totalDecoTime + ' 35min=' + r35.totalDecoTime);
})();

// ---------------------------------------------------------------------------
// 6. Boyle compensation direction.
//
// NOTE on direction: per Baker's BOYLES_LAW_COMPENSATION and Subsurface's
// update_gradient(), the bubble formed at the first stop EXPANDS on further
// ascent, so the allowed gradient 2*gamma/r SHRINKS at shallower stops; the
// VPM-B Boyle compensation therefore LENGTHENS shallow stops compared to
// plain VPM. Disabling it must give shorter-or-equal shallow stops and
// shorter-or-equal total deco. (The task brief stated the opposite direction;
// the physics and both reference implementations agree with the assertion
// used here.)
// ---------------------------------------------------------------------------
(function () {
  const rOff = VPMB.plan(baseInput({ boyleCompensation: false }));
  check('boyle-disabled run ok', rOff.ok, JSON.stringify(rOff.errors));
  if (!rOff.ok || !ref.ok) return;
  function shallowSum(r) {
    let s = 0;
    for (const st of r.stops) if (st.depth <= 9) s += st.time;
    return s;
  }
  const son = shallowSum(ref), soff = shallowSum(rOff);
  check('disabling Boyle compensation shortens shallow stops (<=9 m)',
    soff < son, 'with=' + son + ' without=' + soff);
  check('disabling Boyle compensation gives shorter-or-equal totalDecoTime',
    rOff.totalDecoTime <= ref.totalDecoTime + 1e-9,
    'with=' + ref.totalDecoTime + ' without=' + rOff.totalDecoTime);
  check('Boyle flag actually changes the schedule',
    JSON.stringify(ref.stops) !== JSON.stringify(rOff.stops));
})();

// ---------------------------------------------------------------------------
// 7. Schedule shape: stop bounds, integer stop minutes, switches at 21 m & 6 m
// ---------------------------------------------------------------------------
(function () {
  const r = ref;
  if (!r.ok) { check('schedule shape (needs ref dive ok)', false); return; }
  let depthsOk = true, timesOk = true;
  for (const s of r.stops) {
    if (s.depth > 45) depthsOk = false;
    if (!Number.isInteger(s.time) || s.time < 1) timesOk = false;
  }
  check('no stop deeper than max dive depth', depthsOk, JSON.stringify(r.stops.map(s => s.depth)));
  check('all stop times are integers >= 1', timesOk, JSON.stringify(r.stops.map(s => s.time)));
  const sw = r.table.filter(row => row.phase === 'switch');
  check('gas switch row at 21 m to ean50',
    sw.some(row => row.startDepth === 21 && row.gasId === 'ean50'),
    JSON.stringify(sw.map(row => row.startDepth + ':' + row.gasId)));
  check('gas switch row at 6 m to o2',
    sw.some(row => row.startDepth === 6 && row.gasId === 'o2'),
    JSON.stringify(sw.map(row => row.startDepth + ':' + row.gasId)));
})();

// ---------------------------------------------------------------------------
// 8. Result-shape conformance with the shared contract
// ---------------------------------------------------------------------------
(function () {
  const r = ref;
  if (!r.ok) { check('shape conformance (needs ref dive ok)', false); return; }
  const fin = (x) => typeof x === 'number' && isFinite(x);

  check('shape: top-level fields present',
    r.ok === true && Array.isArray(r.errors) && Array.isArray(r.warnings) &&
    r.algorithm === 'VPMB' && typeof r.params === 'object' &&
    Array.isArray(r.table) && Array.isArray(r.stops) &&
    typeof r.noDeco === 'boolean' && (r.ndl === null || fin(r.ndl)) &&
    (r.firstStopDepth === null || fin(r.firstStopDepth)) &&
    fin(r.totalRuntime) && fin(r.totalDecoTime) &&
    Array.isArray(r.gasUsage) && typeof r.oxygen === 'object' &&
    Array.isArray(r.profile) && Array.isArray(r.ceilingProfile) &&
    Array.isArray(r.finalTissues));

  check('shape: params echo',
    r.params.gfLow === 50 && r.params.gfHigh === 80 && r.params.vpmConservatism === 2 &&
    r.params.lastStopDepth === 6 && fin(r.params.surfacePressure) && r.params.water === 'salt');

  const phases = ['desc', 'level', 'asc', 'stop', 'switch'];
  let tableOk = r.table.length > 0;
  for (const row of r.table) {
    if (phases.indexOf(row.phase) < 0 || !fin(row.startDepth) || !fin(row.endDepth) ||
      !fin(row.duration) || !fin(row.runtime) || typeof row.gasId !== 'string' ||
      !fin(row.ppO2Start) || !fin(row.ppO2End)) tableOk = false;
  }
  check('shape: every table row well-formed and finite', tableOk);

  let stopsOk = r.stops.length > 0;
  for (const s of r.stops) {
    if (!fin(s.depth) || !fin(s.time) || !fin(s.runtime) || typeof s.gasId !== 'string') stopsOk = false;
  }
  check('shape: stops well-formed', stopsOk);

  let usageOk = r.gasUsage.length > 0;
  for (const u of r.gasUsage) {
    if (typeof u.gasId !== 'string' || !fin(u.fO2) || !fin(u.fHe) || !fin(u.liters) || u.liters <= 0) usageOk = false;
  }
  check('shape: gasUsage entries finite and positive', usageOk);

  check('shape: oxygen cns/otu finite and positive',
    fin(r.oxygen.cns) && fin(r.oxygen.otu) && r.oxygen.cns > 0 && r.oxygen.otu > 0);

  let profOk = r.profile.length > 1 && r.profile[0].t === 0;
  for (let i = 1; i < r.profile.length; i++) {
    const a = r.profile[i - 1], b = r.profile[i];
    if (!(b.t - a.t <= 0.5 + 1e-9) || b.t < a.t - 1e-9 || !fin(b.depth) || typeof b.gasId !== 'string') profOk = false;
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
      Math.abs(ft.pTotal - (ft.pN2 + ft.pHe)) > 1e-9 || ft.gfSurfacePct !== null) ftOk = false;
  }
  check('shape: finalTissues 16 entries, pTotal consistent, gfSurfacePct null', ftOk);

  check('shape: VERSION string present', typeof VPMB.VERSION === 'string' && VPMB.VERSION.length > 0);
})();

// ---------------------------------------------------------------------------
// 9. Validation against Erik Baker's published reference output
//    (bwaite/vpmb tests/msw_test/VPMDECO.OUT, "TRIMIX DIVE TO 80 MSW"):
//    radii 0.6/0.5 um, lambda 7500 fsw-min, CVA ON, msw units (surface =
//    10 msw = 1.0 bar), PH2O = 0.493 msw, descent 23 m/min, ascent 10 m/min,
//    EAN36 @ 33 m, O2 @ 6 m, 3 m steps to a 3 m last stop.
//    Baker: first stop 54 m; stops 54:1 51:1 48:1 45:2 42:2 39:2 36:3 33:2
//    30:1 27:2 24:3 21:4 18:4 15:7 12:8 9:13 6:13 3:23; surfacing at 125 min.
//    (Baker's two shallowest legs use a 3 m/min final ascent rate and his stop
//    times are rounded to whole-minute RUN times rather than whole-minute
//    durations, so each stop may differ by up to 1 minute.)
// ---------------------------------------------------------------------------
(function () {
  const r = VPMB.plan({
    algorithm: 'VPMB', vpmConservatism: 0, surfacePressure: 1.0, water: 'salt',
    descentRate: 23, ascentRate: 10, stopInterval: 3, lastStopDepth: 3,
    minStopTime: 1, gasSwitchStopTime: 1, ppO2MaxDeco: 1.5,
    segmentTimesIncludeTravel: true,
    segments: [{ depth: 80, time: 30, gasId: 'tx1545' }],
    gases: [
      { id: 'tx1545', fO2: 0.15, fHe: 0.45, type: 'bottom' },
      { id: 'ean36', fO2: 0.36, fHe: 0.00, type: 'deco' },
      { id: 'o2', fO2: 1.00, fHe: 0.00, type: 'deco' }
    ],
    sacBottom: 20, sacDeco: 16,
    _critRadiusN2Um: 0.6, _critRadiusHeUm: 0.5, _ph2oBar: 0.0493, _lambdaFswMin: 7500
  });
  check('Baker reference run ok', r.ok, JSON.stringify(r.errors));
  if (!r.ok) return;
  check('Baker reference: first stop 54 m', r.firstStopDepth === 54, 'got ' + r.firstStopDepth);
  const baker = {
    54: 1, 51: 1, 48: 1, 45: 2, 42: 2, 39: 2, 36: 3, 33: 2, 30: 1,
    27: 2, 24: 3, 21: 4, 18: 4, 15: 7, 12: 8, 9: 13, 6: 13, 3: 23
  };
  const mine = {};
  for (const s of r.stops) mine[s.depth] = s.time;
  let ladderOk = r.stops.length === 18, maxDiff = 0;
  for (const d in baker) {
    if (!(d in mine)) { ladderOk = false; continue; }
    maxDiff = Math.max(maxDiff, Math.abs(mine[d] - baker[d]));
  }
  check('Baker reference: same 18-stop ladder (54..3 m, 3 m steps)', ladderOk,
    r.stops.map(s => s.depth + ':' + s.time).join(' '));
  check('Baker reference: every stop within 1 min of VPMDECO.OUT', maxDiff <= 1, 'maxDiff=' + maxDiff);
  check('Baker reference: surfacing run time within 3 min of 125',
    Math.abs(r.totalRuntime - 125) <= 3, 'runtime=' + r.totalRuntime.toFixed(1));
  const sw = r.table.filter(row => row.phase === 'switch').map(row => row.startDepth + ':' + row.gasId);
  check('Baker reference: switches at 33 m (EAN36) and 6 m (O2)',
    sw.indexOf('33:ean36') >= 0 && sw.indexOf('6:o2') >= 0, JSON.stringify(sw));
})();

// ---------------------------------------------------------------------------
// 10. Default-path benchmark pins (Subsurface tests/testplan.cpp VPM-B values).
// These run WITHOUT _critRadius overrides, so they pin the shipped
// parameterization (lambda 6500 fsw-min, benchmark radius factor 1.012):
// a regression here means the default constants drifted, not the model.
// Benchmarks: 60 m/30 min air +0 -> 141.3 (V-Planner) / 139.3 (Subsurface);
// with EAN50 -> 95.3 / 96.3. We land within a few minutes of both.
// ---------------------------------------------------------------------------
(function () {
  const bench = {
    vpmConservatism: 0, descentRate: 99, ascentRate: 10,
    lastStopDepth: 3, surfacePressure: 1.01325, ppO2MaxDeco: 1.6,
    segments: [{ depth: 60, time: 30, gasId: 'air' }],
    gases: [{ id: 'air', fO2: 0.21, fHe: 0, type: 'bottom' }]
  };
  const r1 = VPMB.plan(baseInput(bench));
  check('benchmark 60m/30min air +0 ok', r1.ok, JSON.stringify(r1.errors));
  check('benchmark 60m/30min air +0 runtime within [134,146] (Subsurface 139.3 / V-Planner 141.3)',
    r1.ok && r1.totalRuntime >= 134 && r1.totalRuntime <= 146, 'runtime=' + r1.totalRuntime.toFixed(1));
  const r2 = VPMB.plan(baseInput(Object.assign({}, bench, {
    gases: [
      { id: 'air', fO2: 0.21, fHe: 0, type: 'bottom' },
      { id: 'ean50', fO2: 0.50, fHe: 0, type: 'deco' }
    ]
  })));
  check('benchmark 60m/30min air+EAN50 +0 ok', r2.ok, JSON.stringify(r2.errors));
  check('benchmark 60m/30min air+EAN50 +0 runtime within [90,101] (Subsurface 96.3 / V-Planner 95.3)',
    r2.ok && r2.totalRuntime >= 90 && r2.totalRuntime <= 101, 'runtime=' + r2.totalRuntime.toFixed(1));
})();

// ---------------------------------------------------------------------------
// 11. Deco gas breathable at the bottom switches at the start of the ascent
// (V-Planner convention: switch at MOD), not at the first stop.
// ---------------------------------------------------------------------------
(function () {
  const r = VPMB.plan(baseInput({
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
    const ascOnAir = r.table.some(row => row.phase === 'asc' && row.gasId === 'air');
    check('no ascent leg breathes the bottom gas', !ascOnAir);
  }
})();

// ---------------------------------------------------------------------------
// 12. Input validation parity with the ZHL-16C engine: out-of-range surface
// pressure is rejected with a clear error, not a confusing scheduler failure.
// ---------------------------------------------------------------------------
(function () {
  const r = VPMB.plan(baseInput({ surfacePressure: 0.4 }));
  check('surfacePressure 0.4 bar rejected with a validation error',
    !r.ok && r.errors.some(e => e.indexOf('surfacePressure') >= 0), JSON.stringify(r.errors));
  const r2 = VPMB.plan(baseInput({ surfacePressure: 3.0 }));
  check('surfacePressure 3.0 bar rejected with a validation error',
    !r2.ok && r2.errors.some(e => e.indexOf('surfacePressure') >= 0), JSON.stringify(r2.errors));
})();

// ---------------------------------------------------------------------------
// 13. A user-forced shallow level above the live ceiling earns a warning.
// ---------------------------------------------------------------------------
(function () {
  const r = VPMB.plan(baseInput({
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
  const clean = VPMB.plan(baseInput());
  check('reference dive carries no ceiling warning',
    clean.ok && !clean.warnings.some(w => w.indexOf('above the decompression ceiling') >= 0),
    JSON.stringify(clean.warnings));
})();

// ---------------------------------------------------------------------------
console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
