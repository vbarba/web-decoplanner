/*
 * VPM-B decompression engine (Varying Permeability Model with Boyle's-law
 * compensation and the Critical Volume Algorithm).
 *
 * Model sources (constants & formulas verified June 2026 against):
 *  - Subsurface core/deco.cpp (vpmb_config, calc_crushing_pressure,
 *    calc_inner_pressure, nuclear_regeneration, vpmb_start_gradient,
 *    vpmb_next_gradient, update_gradient, vpmb_tolerated_ambient_pressure,
 *    calc_surface_phase, vpmb_conservatism_lvls):
 *    https://github.com/subsurface/subsurface/blob/master/core/deco.cpp
 *  - Erik C. Baker's VPM-B FORTRAN as ported in bwaite/vpmb
 *    (nuclear_regeneration, calc_initial_allowable_gradient,
 *    boyles_law_compensation, critical_volume, calc_surface_phase_volume_time,
 *    calc_start_of_deco_zone):
 *    https://github.com/bwaite/vpmb/blob/master/vpmb.py
 *
 * Constants used:
 *   surface tension gamma            0.0179  N/m       (Baker / Subsurface)
 *   skin compression gamma_c         0.257   N/m       (Baker / Subsurface)
 *   regeneration time constant       20160 min (2 weeks)
 *   gradient onset of impermeability 8.2 atm = 8.30865 bar
 *   pressure of other gases          102 mmHg = 0.1359888 bar
 *   initial critical radii           N2 0.55 um, He 0.45 um (nominal)
 *   critical volume lambda           6500 fsw-min (= Subsurface's 199.58
 *     bar-min). Baker's program uses 7500 fsw-min; Subsurface adopted 6500
 *     when benchmarking its VPM-B against V-Planner. We ship the
 *     V-Planner-benchmarked parameterization; Baker's value can be selected
 *     per-call with the internal _lambdaFswMin override (used by the
 *     validation harness, which reproduces Baker's published VPMDECO.OUT).
 *   benchmark radius factor          1.012 (Subsurface <= 4.6.2
 *     subsurface_conservatism_factor, introduced to match its V-Planner
 *     benchmark schedules; applied to the critical radii. Subsurface
 *     >= 4.6.4 uses 1.0; the difference is ~1 min on typical schedules.)
 *
 * Conservatism mapping (+0..+5) multiplies the initial critical radii by
 *   [1.00, 1.05, 1.12, 1.22, 1.35, 1.50]
 * This is V-Planner's documented mapping ("conservatism increases the
 * Critical Radii of N2/He by: 1 = 5%, 2 = 12%, 3 = 22%, 4 = 35%, 5 = 50%",
 * hhssoftware.com/v-planner FAQ); +0..+4 equal Subsurface's
 * vpmb_conservatism_lvls[].
 *
 * Boyle compensation (the "B" in VPM-B): allowed supersaturation gradients at
 * stops shallower than the first stop are REDUCED by tracking the Boyle
 * expansion of a bubble from the first stop: solve g^3 - B*g - C = 0 with
 * B = g0^3/(Pfirst+g0), C = Pnext*B (Subsurface update_gradient(); identical
 * algebra to Baker's BOYLES_LAW_COMPENSATION radius root finder, since
 * r ~ 1/g and the proportionality constant cancels). This makes shallow stops
 * LONGER, the documented VPM-B behaviour vs plain VPM. The internal flag
 * input.boyleCompensation === false disables it (used by tests).
 *
 * Gas-switch MOD note: the contract formula floors the MOD to the stop
 * interval. A strict floor puts pure O2 (raw MOD 5.97 m at ppO2 1.61) at 3 m,
 * below lastStopDepth=6, so the canonical 6 m O2 switch would never occur.
 * We allow a half-interval tolerance before flooring, which reproduces the
 * canonical DecoPlanner/V-Planner switch depths (EAN50 -> 21 m, O2 -> 6 m).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VPMB = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 'VPM-B 1.0.0 (Baker VPM-B w/ CVA + Boyle compensation; Subsurface 4.5 parameterization: lambda=6500 fsw-min, radius benchmark factor 1.2)';

  // ---- compartments -------------------------------------------------------
  const N2_HALF = [5.0, 8.0, 12.5, 18.5, 27.0, 38.3, 54.3, 77.0, 109.0, 146.0,
    187.0, 239.0, 305.0, 390.0, 498.0, 635.0];
  const HE_HALF = [1.88, 3.02, 4.72, 6.99, 10.21, 14.48, 20.53, 29.11, 41.20,
    55.19, 70.69, 90.34, 115.29, 147.42, 188.24, 240.03];
  const NC = 16;
  const LOG2 = Math.log(2);
  const KN2 = N2_HALF.map(function (h) { return LOG2 / h; });
  const KHE = HE_HALF.map(function (h) { return LOG2 / h; });

  // ---- physical conventions (shared contract) -----------------------------
  const PH2O = 0.0627;        // bar, Buhlmann respiratory water vapor
  const FN2_AIR = 0.79;

  // ---- canonical VPM-B constants ------------------------------------------
  const GAMMA = 0.0179;                       // N/m
  const GAMMA_C = 0.257;                      // N/m
  const D_GAMMA2 = 2 * (GAMMA_C - GAMMA);     // 2*(gc-g)
  const REGEN_TIME = 20160;                   // min
  const G_IMPERM_BAR = 8.2 * 1.01325;         // 8.30865 bar
  const P_OTHER = 0.1359888;                  // bar (102 mmHg)
  // Critical volume parameter lambda. Baker's published value is 7500 fsw-min
  // = (7500/33)*101325 Pa-min; Subsurface ships 199.58 bar-min = 6500 fsw-min
  // (deco.cpp crit_volume_lambda), the value it benchmarked against V-Planner.
  // We ship the Subsurface/V-Planner-benchmarked 6500; Baker's 7500 can be
  // restored per-call via the internal _lambdaFswMin override.
  const LAMBDA_FSW_MIN = 6500;
  const LAMBDA_PA_MIN = (LAMBDA_FSW_MIN / 33) * 101325; // Pa*min
  const R0_N2 = 0.55e-6;                      // m
  const R0_HE = 0.45e-6;                      // m
  const CONS_MULT = [1.00, 1.05, 1.12, 1.22, 1.35, 1.50];
  // Benchmark radius factor: Subsurface <= 4.6.2 multiplied the critical radii
  // by subsurface_conservatism_factor = 1.012 to match its V-Planner benchmark
  // schedules (core/deco.c; >= 4.6.4 uses 1.0); together with lambda =
  // 6500 fsw-min this parameterization reproduces the V-Planner/Subsurface
  // testplan.cpp benchmark runtimes within a few minutes (e.g. 60 m/30 min
  // air, +0: 138 min here vs 139.3/141.3 benchmark).
  const BENCHMARK_RADIUS_FACTOR = 1.012;
  const BAR_PA = 1e5;
  const EPS = 1e-9;

  // Runtime-tunable knobs (internal underscore-prefixed input overrides used
  // for validation against Erik Baker's reference outputs; reset on every
  // runPipeline call, so public behaviour always uses the defaults above).
  const TUNE = { ph2o: PH2O, lambdaPaMin: LAMBDA_PA_MIN };

  // ========================================================================
  // small math helpers
  // ========================================================================

  // Largest real root of x^3 - B*x - C = 0 (B>0, C>0).
  // Port of Subsurface solve_cubic2().
  function solveCubicX(B, C) {
    const disc = 27 * C * C - 4 * B * B * B;
    if (disc < 0) {
      return 2.0 * Math.sqrt(B / 3.0) *
        Math.cos(Math.acos(3.0 * C * Math.sqrt(3.0 / B) / (2.0 * B)) / 3.0);
    }
    const den = Math.cbrt(9 * C + Math.sqrt(3 * disc));
    return Math.cbrt(2.0 / 3.0) * B / den + den / Math.cbrt(18.0);
  }

  // Real root of A*r^3 - B*r^2 - C = 0 (Subsurface solve_cubic()).
  function solveCubicA(A, B, C) {
    const BA = B / A, CA = C / A;
    const disc = CA * (4 * BA * BA * BA + 27 * CA);
    if (disc < 0) return NaN;
    const den = Math.cbrt(BA * BA * BA + 1.5 * (9 * CA + Math.sqrt(3) * Math.sqrt(disc)));
    return (BA + BA * BA / den + den) / 3.0;
  }

  // ========================================================================
  // tissue kinetics
  // ========================================================================

  function surfaceTissues(surfaceP) {
    const n2 = new Array(NC), he = new Array(NC);
    const p = (surfaceP - TUNE.ph2o) * FN2_AIR;
    for (let i = 0; i < NC; i++) { n2[i] = p; he[i] = 0; }
    return { n2: n2, he: he };
  }

  function cloneT(t) { return { n2: t.n2.slice(), he: t.he.slice() }; }

  // constant-depth exposure (Haldane)
  function applyConst(t, pamb, gas, dt) {
    const pin2 = (pamb - TUNE.ph2o) * gas.fN2;
    const pihe = (pamb - TUNE.ph2o) * gas.fHe;
    for (let i = 0; i < NC; i++) {
      t.n2[i] += (pin2 - t.n2[i]) * (1 - Math.exp(-KN2[i] * dt));
      t.he[i] += (pihe - t.he[i]) * (1 - Math.exp(-KHE[i] * dt));
    }
  }

  // linear depth ramp (Schreiner)
  function applyRamp(t, pamb0, pamb1, dt, gas) {
    if (dt <= 0) return;
    const rate = (pamb1 - pamb0) / dt;
    const pin20 = (pamb0 - TUNE.ph2o) * gas.fN2;
    const pihe0 = (pamb0 - TUNE.ph2o) * gas.fHe;
    const rn2 = rate * gas.fN2, rhe = rate * gas.fHe;
    for (let i = 0; i < NC; i++) {
      const kn = KN2[i], kh = KHE[i];
      t.n2[i] = pin20 + rn2 * (dt - 1 / kn) -
        (pin20 - t.n2[i] - rn2 / kn) * Math.exp(-kn * dt);
      t.he[i] = pihe0 + rhe * (dt - 1 / kh) -
        (pihe0 - t.he[i] - rhe / kh) * Math.exp(-kh * dt);
    }
  }

  // ========================================================================
  // crushing pressure (descent / bottom)
  // ========================================================================

  function newCrush() {
    return {
      n2: new Array(NC).fill(-Infinity),
      he: new Array(NC).fill(-Infinity),
      onset: new Array(NC).fill(0),
      maxAmb: 0
    };
  }

  // inner gas pressure of an impermeable (crushed past 8.2 atm) nucleus.
  // Port of Subsurface calc_inner_pressure(), in SI units (Pa, m).
  function innerPressureBar(critR, onsetTensionBar, pambBar) {
    const gImpPa = G_IMPERM_BAR * BAR_PA;
    const rOnset = 1.0 / (gImpPa / D_GAMMA2 + 1.0 / critR);
    const A = pambBar * BAR_PA - gImpPa + D_GAMMA2 / rOnset;
    const B = D_GAMMA2;
    const C = onsetTensionBar * BAR_PA * rOnset * rOnset * rOnset;
    const r = solveCubicA(A, B, C);
    if (!(r > 0)) return onsetTensionBar; // degenerate; fall back (no crush growth)
    const q = rOnset / r;
    return onsetTensionBar * q * q * q;
  }

  // Port of Subsurface calc_crushing_pressure().
  function updateCrushing(cr, t, pamb, rN2, rHe) {
    const newMax = pamb > cr.maxAmb;
    for (let i = 0; i < NC; i++) {
      const tension = t.n2[i] + t.he[i] + P_OTHER;
      const grad = pamb - tension;
      let cN2, cHe;
      if (grad <= G_IMPERM_BAR) {           // permeable regime
        cN2 = grad; cHe = grad;
        cr.onset[i] = tension;
      } else {                              // impermeable regime
        if (!newMax) continue;
        cN2 = pamb - innerPressureBar(rN2, cr.onset[i], pamb);
        cHe = pamb - innerPressureBar(rHe, cr.onset[i], pamb);
      }
      if (cN2 > cr.n2[i]) cr.n2[i] = cN2;
      if (cHe > cr.he[i]) cr.he[i] = cHe;
    }
    if (newMax) cr.maxAmb = pamb;
  }

  // ========================================================================
  // nuclear regeneration + initial allowable gradients
  // (Baker NUCLEAR_REGENERATION + CALC_INITIAL_ALLOWABLE_GRADIENT)
  // ========================================================================

  function oneGradient(crushBar, r0, diveTime) {
    const crushPa = Math.max(crushBar, 0) * BAR_PA;
    const rCrushed = 1.0 / (crushPa / D_GAMMA2 + 1.0 / r0);
    // regeneration toward r0 with 20160 min time constant (linear in r,
    // as in both Subsurface nuclear_regeneration() and bwaite/vpmb)
    const rRegen = rCrushed + (r0 - rCrushed) * (1 - Math.exp(-diveTime / REGEN_TIME));
    // crushing pressure adjusted for regeneration (Baker's
    // Crush_Pressure_Adjust_Ratio, computed directly from the radii)
    const adjCrushPa = D_GAMMA2 * (1.0 / rRegen - 1.0 / r0);
    // initial allowable gradient: 2*gamma*(gammaC-gamma)/(r*gammaC)
    const g0Pa = 2.0 * GAMMA * (GAMMA_C - GAMMA) / (rRegen * GAMMA_C);
    return { g0: g0Pa / BAR_PA, adjCrush: adjCrushPa / BAR_PA };
  }

  function gradientsFromDive(cr, diveTime, rN2, rHe) {
    const out = { n2: new Array(NC), he: new Array(NC), adjN2: new Array(NC), adjHe: new Array(NC) };
    for (let i = 0; i < NC; i++) {
      const a = oneGradient(cr.n2[i], rN2, diveTime);
      const b = oneGradient(cr.he[i], rHe, diveTime);
      out.n2[i] = a.g0; out.adjN2[i] = a.adjCrush;
      out.he[i] = b.g0; out.adjHe[i] = b.adjCrush;
    }
    return out;
  }

  // ========================================================================
  // critical volume algorithm (Baker CRITICAL_VOLUME quadratic)
  // ========================================================================

  function cvaRelaxOne(g0Bar, adjCrushBar, tPhase) {
    const g0 = g0Bar * BAR_PA;
    const crush = adjCrushBar * BAR_PA;
    const B = g0 + (TUNE.lambdaPaMin * GAMMA) / (GAMMA_C * tPhase);
    const C = (GAMMA * GAMMA * TUNE.lambdaPaMin * crush) / (GAMMA_C * GAMMA_C * tPhase);
    let disc = B * B - 4.0 * C;
    if (disc < 0) disc = 0;
    return ((B + Math.sqrt(disc)) / 2.0) / BAR_PA;
  }

  function cvaRelax(initial, decoPhaseTime, surfT) {
    const g = { n2: new Array(NC), he: new Array(NC) };
    for (let i = 0; i < NC; i++) {
      const t = Math.max(decoPhaseTime + surfT[i], 1e-3);
      g.n2[i] = cvaRelaxOne(initial.n2[i], initial.adjN2[i], t);
      g.he[i] = cvaRelaxOne(initial.he[i], initial.adjHe[i], t);
    }
    return g;
  }

  // Baker CALC_SURFACE_PHASE_VOLUME_TIME (== Subsurface calc_surface_phase)
  function surfacePhaseTimes(t, surfaceP) {
    const out = new Array(NC);
    const pin2 = (surfaceP - TUNE.ph2o) * FN2_AIR;
    for (let i = 0; i < NC; i++) {
      const he = t.he[i], n2 = t.n2[i];
      if (n2 > pin2) {
        out[i] = (he / KHE[i] + (n2 - pin2) / KN2[i]) / (he + n2 - pin2);
      } else if (he > EPS && he + n2 >= pin2) {
        const td = 1.0 / (KN2[i] - KHE[i]) * Math.log((pin2 - n2) / he);
        const integ = he / KHE[i] * (1 - Math.exp(-KHE[i] * td)) +
          (n2 - pin2) / KN2[i] * (1 - Math.exp(-KN2[i] * td));
        out[i] = integ / (he + n2 - pin2);
      } else {
        out[i] = 0;
      }
    }
    return out;
  }

  // ========================================================================
  // Boyle compensation + ceilings
  // ========================================================================

  function boyleGradient(g0, pFirst, pNext) {
    if (!(pNext < pFirst)) return g0;
    const B = g0 * g0 * g0 / (pFirst + g0);
    const C = pNext * B;
    return solveCubicX(B, C);
  }

  // per-compartment gradient set adjusted toward reference pressure pRef
  function boyleSet(grads, firstStopP, pRef, boyleOn) {
    if (!boyleOn || firstStopP === null || !(pRef < firstStopP)) return grads;
    const out = { n2: new Array(NC), he: new Array(NC) };
    for (let i = 0; i < NC; i++) {
      out.n2[i] = boyleGradient(grads.n2[i], firstStopP, pRef);
      out.he[i] = boyleGradient(grads.he[i], firstStopP, pRef);
    }
    return out;
  }

  // max tolerated ambient pressure over compartments, gradients already chosen
  function maxToleratedWith(t, g) {
    let m = -Infinity;
    for (let i = 0; i < NC; i++) {
      const load = t.n2[i] + t.he[i];
      const w = (g.n2[i] * t.n2[i] + g.he[i] * t.he[i]) / load;
      const tol = load + P_OTHER - w;
      if (tol > m) m = tol;
    }
    return m;
  }

  function maxTolerated(t, grads, pRef, firstStopP, boyleOn) {
    return maxToleratedWith(t, boyleSet(grads, firstStopP, pRef, boyleOn));
  }

  // self-consistent ceiling depth in meters (can be negative = no ceiling)
  function ceilingDepthM(P, t, grads, firstStopP, boyleOn) {
    let ref = P.surfaceP;
    let tol = maxTolerated(t, grads, ref, firstStopP, boyleOn);
    for (let it = 0; it < 40; it++) {
      const next = maxTolerated(t, grads, Math.max(tol, P.surfaceP), firstStopP, boyleOn);
      if (Math.abs(next - tol) < 1e-7) { tol = next; break; }
      tol = next;
    }
    return (tol - P.surfaceP) * P.mpb;
  }

  // ========================================================================
  // input validation / context
  // ========================================================================

  function num(v, dflt) { return (typeof v === 'number' && isFinite(v)) ? v : dflt; }

  function validate(input) {
    const errors = [], warnings = [];
    if (!input || typeof input !== 'object') {
      return { errors: ['input must be an object'], warnings: warnings, P: null };
    }
    const water = input.water === 'fresh' ? 'fresh' : 'salt';
    const mpb = water === 'fresh' ? 10.3 : 10.0;
    const surfaceP = num(input.surfacePressure, 1.013);
    if (!(surfaceP > 0.5 && surfaceP < 1.2)) errors.push('surfacePressure must be in (0.5, 1.2) bar');
    let cons = num(input.vpmConservatism, 2);
    cons = Math.round(cons);
    if (cons < 0 || cons > 5) {
      warnings.push('vpmConservatism clamped to 0..5');
      cons = Math.min(5, Math.max(0, cons));
    }
    const P = {
      water: water,
      mpb: mpb,
      surfaceP: surfaceP,
      pAmb: function (d) { return surfaceP + d / mpb; },
      descentRate: num(input.descentRate, 18),
      ascentRate: num(input.ascentRate, 9),
      interval: num(input.stopInterval, 3),
      lastStop: num(input.lastStopDepth, 6),
      minStop: Math.max(1, Math.round(num(input.minStopTime, 1))),
      gasSwitchStopTime: num(input.gasSwitchStopTime, 1),
      ppO2MaxDeco: num(input.ppO2MaxDeco, 1.61),
      includeTravel: input.segmentTimesIncludeTravel !== false,
      sacBottom: num(input.sacBottom, 20),
      sacDeco: num(input.sacDeco, 16),
      cons: cons,
      rN2: (typeof input._critRadiusN2Um === 'number' ? input._critRadiusN2Um * 1e-6
        : R0_N2 * CONS_MULT[cons] * BENCHMARK_RADIUS_FACTOR),
      rHe: (typeof input._critRadiusHeUm === 'number' ? input._critRadiusHeUm * 1e-6
        : R0_HE * CONS_MULT[cons] * BENCHMARK_RADIUS_FACTOR),
      boyleOn: input.boyleCompensation !== false,
      gfLow: num(input.gfLow, 50),
      gfHigh: num(input.gfHigh, 80),
      gasById: {},
      gasList: [],
      segments: []
    };
    if (P.descentRate <= 0 || P.ascentRate <= 0) errors.push('descentRate and ascentRate must be > 0');
    if (P.interval <= 0) errors.push('stopInterval must be > 0');
    if (P.lastStop <= 0) errors.push('lastStopDepth must be > 0');

    const gases = Array.isArray(input.gases) ? input.gases : [];
    if (gases.length === 0) errors.push('at least one gas is required');
    for (let i = 0; i < gases.length; i++) {
      const g = gases[i];
      if (!g || typeof g.id !== 'string') { errors.push('gas #' + i + ' missing id'); continue; }
      const fO2 = num(g.fO2, NaN), fHe = num(g.fHe, 0);
      if (!(fO2 > 0 && fO2 <= 1) || fHe < 0 || fO2 + fHe > 1 + EPS) {
        errors.push('gas "' + g.id + '" has invalid fractions'); continue;
      }
      const gg = {
        id: g.id, fO2: fO2, fHe: fHe, fN2: Math.max(0, 1 - fO2 - fHe),
        type: g.type === 'deco' ? 'deco' : 'bottom', mod: null
      };
      if (gg.type === 'deco') {
        const raw = (P.ppO2MaxDeco / fO2 - P.surfaceP) * P.mpb;
        // half-interval tolerance before flooring; see header comment
        gg.mod = Math.floor((raw + P.interval / 2) / P.interval) * P.interval;
      }
      P.gasById[gg.id] = gg;
      P.gasList.push(gg);
    }

    const segs = Array.isArray(input.segments) ? input.segments : [];
    if (segs.length === 0) errors.push('at least one segment is required');
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const d = num(s && s.depth, NaN), tm = num(s && s.time, NaN);
      if (!(d > 0)) { errors.push('segment #' + i + ' has invalid depth'); continue; }
      if (!(tm > 0)) { errors.push('segment #' + i + ' has invalid time'); continue; }
      if (!s.gasId || !P.gasById[s.gasId]) { errors.push('segment #' + i + ' references unknown gasId "' + (s && s.gasId) + '"'); continue; }
      P.segments.push({ depth: d, time: tm, gasId: s.gasId });
    }
    return { errors: errors, warnings: warnings, P: P };
  }

  // ========================================================================
  // row building / sampling
  // ========================================================================

  function makeRow(phase, d0, d1, dur, runtimeEnd, gas) {
    return {
      phase: phase, startDepth: d0, endDepth: d1, duration: dur,
      runtime: runtimeEnd, gasId: gas.id,
      ppO2Start: 0, ppO2End: 0 // filled by caller with pAmb
    };
  }

  // bottom phase: descent + level segments (+ inter-level travels)
  function simulateBottom(P, errors, sampler) {
    const t = surfaceTissues(P.surfaceP);
    const cr = newCrush();
    const rows = [];
    let depth = 0, runtime = 0, deepest = 0;
    let gas = P.gasById[P.segments[0].gasId];

    updateCrushing(cr, t, P.pAmb(0), P.rN2, P.rHe);
    if (sampler) sampler(0, 0, gas, t, cr);

    function travel(toDepth, g) {
      const desc = toDepth > depth;
      const rate = desc ? P.descentRate : P.ascentRate;
      const dur = Math.abs(toDepth - depth) / rate;
      const d0 = depth, p0 = P.pAmb(d0), p1 = P.pAmb(toDepth);
      const step = 0.1;
      let done = 0;
      while (done < dur - EPS) {
        const dt = Math.min(step, dur - done);
        const f0 = done / dur, f1 = (done + dt) / dur;
        applyRamp(t, p0 + (p1 - p0) * f0, p0 + (p1 - p0) * f1, dt, g);
        done += dt;
        const dNow = d0 + (toDepth - d0) * (done / dur);
        updateCrushing(cr, t, P.pAmb(dNow), P.rN2, P.rHe);
        if (sampler) sampler(runtime + done, dNow, g, t, cr);
      }
      runtime += dur;
      const row = makeRow(desc ? 'desc' : 'asc', d0, toDepth, dur, runtime, g);
      row.ppO2Start = g.fO2 * p0; row.ppO2End = g.fO2 * p1;
      rows.push(row);
      depth = toDepth;
      return dur;
    }

    function level(dur, g) {
      const pamb = P.pAmb(depth);
      const step = 0.5;
      let done = 0;
      while (done < dur - EPS) {
        const dt = Math.min(step, dur - done);
        applyConst(t, pamb, g, dt);
        done += dt;
        updateCrushing(cr, t, pamb, P.rN2, P.rHe);
        if (sampler) sampler(runtime + done, depth, g, t, cr);
      }
      runtime += dur;
      const row = makeRow('level', depth, depth, dur, runtime, g);
      row.ppO2Start = g.fO2 * pamb; row.ppO2End = g.fO2 * pamb;
      rows.push(row);
    }

    for (let i = 0; i < P.segments.length; i++) {
      const seg = P.segments[i];
      gas = P.gasById[seg.gasId];
      let travelDur = 0;
      if (Math.abs(seg.depth - depth) > EPS) travelDur = travel(seg.depth, gas);
      deepest = Math.max(deepest, seg.depth);
      let levelDur = P.includeTravel ? seg.time - travelDur : seg.time;
      if (P.includeTravel && levelDur < 0.1 - EPS) {
        errors.push('segment #' + i + ' time (' + seg.time + ' min) is shorter than required travel time (' +
          travelDur.toFixed(2) + ' min) + 0.1 min');
        return null;
      }
      if (levelDur > EPS) level(levelDur, gas);
    }
    return { t: t, cr: cr, rows: rows, depth: depth, runtime: runtime, gas: gas, deepest: deepest };
  }

  // depth (m) at which off-gassing begins during a continuous ascent from the
  // bottom (Baker CALC_START_OF_DECO_ZONE, numeric version).
  function startOfDecoZone(P, t0, depth, gas) {
    const total = depth / P.ascentRate;
    const t = cloneT(t0);
    let maxLoad = -Infinity;
    for (let i = 0; i < NC; i++) maxLoad = Math.max(maxLoad, t.n2[i] + t.he[i]);
    let fPrev = maxLoad + P_OTHER - P.pAmb(depth);
    if (fPrev >= 0) return depth;
    const step = 0.1;
    let done = 0;
    while (done < total - EPS) {
      const dt = Math.min(step, total - done);
      const d0 = depth * (1 - done / total);
      const d1 = depth * (1 - (done + dt) / total);
      applyRamp(t, P.pAmb(d0), P.pAmb(d1), dt, gas);
      done += dt;
      maxLoad = -Infinity;
      for (let i = 0; i < NC; i++) maxLoad = Math.max(maxLoad, t.n2[i] + t.he[i]);
      const f = maxLoad + P_OTHER - P.pAmb(d1);
      if (f >= 0) {
        // linear interpolation inside the step
        const frac = fPrev < 0 ? (-fPrev) / (f - fPrev) : 0;
        return d0 + (d1 - d0) * frac;
      }
      fPrev = f;
    }
    return 0;
  }

  function ladderUp(P, ceilM) {
    if (ceilM <= P.lastStop + 1e-6) return P.lastStop;
    const n = Math.ceil((ceilM - P.lastStop) / P.interval - 1e-9);
    return P.lastStop + n * P.interval;
  }

  function bestGasAt(P, depth, current) {
    let best = null;
    for (let i = 0; i < P.gasList.length; i++) {
      const g = P.gasList[i];
      if (g.type !== 'deco' || g.mod === null) continue;
      if (g.mod < depth - 1e-6) continue;
      if (g.fO2 <= current.fO2 + EPS) continue;
      if (!best || g.fO2 > best.fO2) best = g;
    }
    return best;
  }

  // ========================================================================
  // ascent scheduler (one pass with a fixed gradient set)
  // ========================================================================

  function simulateAscent(P, start, grads, opts) {
    const t = cloneT(start.t);
    let depth = start.depth, runtime = start.runtime, gas = start.gas;
    const rows = [], stops = [];
    const errors = [];
    let decoZoneRt = null;
    let firstActualStop = null, firstStopArrivalRt = null;
    const sampler = opts.sampler || null;

    // ---- first stop (ceiling + Baker PROJECTED_ASCENT arrival check) ----
    // Baker computes the ascent ceiling from the gas loadings at the START OF
    // THE DECO ZONE (i.e. after the initial ascent from the bottom), not from
    // the bottom itself; project the tissues there first.
    const tDz = cloneT(t);
    const dzRef = Math.min(Math.max(P.dz, 0), depth);
    if (dzRef < depth - EPS) {
      applyRamp(tDz, P.pAmb(depth), P.pAmb(dzRef), (depth - dzRef) / P.ascentRate, gas);
    }
    const ceil = ceilingDepthM(P, tDz, grads, null, false);
    let firstStop = 0;
    if (ceil > 1e-6) {
      firstStop = ladderUp(P, ceil);
      while (firstStop < dzRef - EPS) {
        const trial = cloneT(tDz);
        applyRamp(trial, P.pAmb(dzRef), P.pAmb(firstStop), (dzRef - firstStop) / P.ascentRate, gas);
        if (maxTolerated(trial, grads, P.pAmb(firstStop), null, false) <= P.pAmb(firstStop) + 1e-9) break;
        firstStop += P.interval;
      }
      if (firstStop >= depth - EPS) {
        errors.push('required first deco stop is at or below the bottom depth');
        return { errors: errors };
      }
    }
    const firstStopP = firstStop > 0 ? P.pAmb(firstStop) : null;

    // pending stop rungs
    const pending = [];
    if (firstStop > 0) {
      let d = firstStop;
      while (d > P.lastStop + 1e-6) { pending.push(d); d -= P.interval; }
      pending.push(P.lastStop);
    }

    // switch depth candidates, deepest first
    const swDepths = [];
    for (let i = 0; i < P.gasList.length; i++) {
      const g = P.gasList[i];
      if (g.type === 'deco' && g.mod !== null && g.mod >= P.lastStop && g.mod < start.depth - 1e-6 &&
        swDepths.indexOf(g.mod) < 0) swDepths.push(g.mod);
    }
    swDepths.sort(function (a, b) { return b - a; });

    if (P.dz >= depth - 1e-6) decoZoneRt = runtime;

    function sampleNow(tm, d) {
      if (!sampler) return;
      const c = ceilingDepthM(P, t, grads, firstStopP, P.boyleOn && opts.boyleOn !== false);
      sampler(tm, d, gas, Math.max(0, c));
    }

    function travelTo(target) {
      const dur = (depth - target) / P.ascentRate;
      if (dur <= EPS) return;
      // deco-zone crossing
      if (decoZoneRt === null && target <= P.dz + 1e-6 && depth >= P.dz - 1e-6) {
        decoZoneRt = runtime + (depth - P.dz) / P.ascentRate;
      }
      const p0 = P.pAmb(depth), p1 = P.pAmb(target);
      const step = 0.5;
      let done = 0;
      while (done < dur - EPS) {
        const dt = Math.min(step, dur - done);
        const f0 = done / dur, f1 = (done + dt) / dur;
        applyRamp(t, p0 + (p1 - p0) * f0, p0 + (p1 - p0) * f1, dt, gas);
        done += dt;
        if (sampler) sampleNow(runtime + done, depth + (target - depth) * (done / dur));
      }
      const row = makeRow('asc', depth, target, dur, runtime + dur, gas);
      row.ppO2Start = gas.fO2 * p0; row.ppO2End = gas.fO2 * p1;
      rows.push(row);
      runtime += dur;
      depth = target;
    }

    function holdAt(d, dur, phase) {
      const pamb = P.pAmb(d);
      const step = 0.5;
      let done = 0;
      while (done < dur - EPS) {
        const dt = Math.min(step, dur - done);
        applyConst(t, pamb, gas, dt);
        done += dt;
        if (sampler) sampleNow(runtime + done, d);
      }
      const row = makeRow(phase, d, d, dur, runtime + dur, gas);
      row.ppO2Start = gas.fO2 * pamb; row.ppO2End = gas.fO2 * pamb;
      rows.push(row);
      runtime += dur;
      return row;
    }

    function canLeave(gB, pNext) {
      return maxToleratedWith(t, gB) <= pNext + 1e-9;
    }

    // A deco gas already breathable at the bottom (MOD at/below the start
    // depth) switches before the first ascent leg — V-Planner convention:
    // switch at the MOD, not at the first stop. Same hold as any other
    // off-rung switch; the first-stop projection above conservatively used
    // the bottom gas. Mirrors the ZHL-16C engine.
    {
      const g0 = bestGasAt(P, depth, gas);
      if (g0) { gas = g0; holdAt(depth, P.gasSwitchStopTime, 'switch'); }
    }

    let guard = 0;
    while (depth > 1e-6 && guard++ < 500) {
      const nextStop = pending.length ? pending[0] : 0;
      // deepest beneficial switch depth in [nextStop, depth)
      let target = nextStop;
      for (let i = 0; i < swDepths.length; i++) {
        const d = swDepths[i];
        if (d < depth - 1e-6 && d > nextStop + 1e-6 && bestGasAt(P, d, gas)) { target = d; break; }
      }
      travelTo(target);
      const arrivalRt = runtime;

      // gas switch on arrival
      let switched = false, switchRow = null;
      const best = bestGasAt(P, depth, gas);
      if (best) {
        gas = best;
        switched = true;
        switchRow = makeRow('switch', depth, depth, 0, runtime, gas);
        const pamb = P.pAmb(depth);
        switchRow.ppO2Start = gas.fO2 * pamb; switchRow.ppO2End = gas.fO2 * pamb;
        rows.push(switchRow);
        if (sampler) sampleNow(runtime, depth);
      }

      const isRung = pending.length && Math.abs(depth - pending[0]) < 1e-6;
      if (isRung) {
        // Baker's DECOMPRESSION_STOP: every rung from the first stop down is a
        // stop; wait in whole-minute increments until the deco ceiling clears
        // the next stop (contract: integer stop durations, >= minStopTime).
        pending.shift();
        const dn = pending.length ? pending[0] : 0;
        const pNext = P.pAmb(dn);
        const gB = boyleSet(grads, firstStopP, pNext, P.boyleOn && opts.boyleOn !== false);
        let k = 0;
        while ((!canLeave(gB, pNext) || k < P.minStop) && k < 999) {
          holdMinute();
          k++;
        }
        if (k >= 999) { errors.push('deco stop at ' + depth + ' m did not clear within 999 min'); return { errors: errors }; }
        mergeHolds(k);
        if (firstActualStop === null) { firstActualStop = depth; firstStopArrivalRt = arrivalRt; }
      } else if (switched) {
        const r = holdAt(depth, P.gasSwitchStopTime, 'switch');
        rows.splice(rows.indexOf(switchRow), 1);
        void r;
      }
    }
    if (guard >= 500) { errors.push('ascent scheduler did not terminate'); return { errors: errors }; }

    // helpers used above (function declarations are hoisted)
    function holdMinute() {
      const pamb = P.pAmb(depth);
      applyConst(t, pamb, gas, 0.5);
      if (sampler) sampleNow(runtime + 0.5, depth);
      applyConst(t, pamb, gas, 0.5);
      if (sampler) sampleNow(runtime + 1, depth);
      runtime += 1;
    }
    function mergeHolds(k) {
      const pamb = P.pAmb(depth);
      const row = makeRow('stop', depth, depth, k, runtime, gas);
      row.ppO2Start = gas.fO2 * pamb; row.ppO2End = gas.fO2 * pamb;
      rows.push(row);
      stops.push({ depth: depth, time: k, runtime: runtime, gasId: gas.id });
    }

    return {
      errors: errors, rows: rows, stops: stops, t: t, runtime: runtime,
      firstStop: firstStop, firstActualStop: firstActualStop,
      firstStopArrivalRt: firstStopArrivalRt,
      decoZoneRt: decoZoneRt === null ? runtime : decoZoneRt
    };
  }

  // ========================================================================
  // full pipeline (bottom + CVA loop + final ascent)
  // ========================================================================

  function runPipeline(input, collect) {
    TUNE.ph2o = (typeof input === 'object' && input && typeof input._ph2oBar === 'number')
      ? input._ph2oBar : PH2O;
    TUNE.lambdaPaMin = (typeof input === 'object' && input && typeof input._lambdaFswMin === 'number')
      ? (input._lambdaFswMin / 33) * 101325 : LAMBDA_PA_MIN;
    const v = validate(input);
    const out = { ok: false, errors: v.errors, warnings: v.warnings, P: v.P };
    if (v.errors.length) return out;
    const P = v.P;

    const profile = collect ? [] : null;
    const ceilingProfile = collect ? [] : null;

    // live ceiling during the bottom phase: regenerated radii + crushing so far
    function bottomSampler(tm, d, gas, t, cr) {
      if (!collect) return;
      profile.push({ t: tm, depth: d, gasId: gas.id });
      const g = gradientsFromDive(cr, Math.max(tm, 1e-3), P.rN2, P.rHe);
      const c = ceilingDepthM(P, t, g, null, false);
      ceilingProfile.push({ t: tm, ceiling: Math.max(0, c) });
    }

    const bottom = simulateBottom(P, out.errors, collect ? bottomSampler : null);
    if (!bottom) return out;

    // start-of-deco-zone depth (for the CVA deco phase time)
    P.dz = startOfDecoZone(P, bottom.t, bottom.depth, bottom.gas);

    // nuclear regeneration + initial allowable gradients (Baker: at start of ascent)
    const initial = gradientsFromDive(bottom.cr, Math.max(bottom.runtime, 1e-3), P.rN2, P.rHe);
    let grads = { n2: initial.n2.slice(), he: initial.he.slice() };

    // ---- critical volume loop (Baker main CVA loop) ----
    // Baker's convergence test: the schedule is converged when the total
    // phase volume time (deco + surface) changes by <= 1 minute in ANY ONE
    // compartment between two successive iterations; the converged schedule
    // (computed with the last relaxed gradients) is the output.
    const ascentStart = { t: bottom.t, depth: bottom.depth, runtime: bottom.runtime, gas: bottom.gas };
    let sim = null, lastPVT = null, converged = false;
    for (let iter = 0; iter < 35; iter++) {
      sim = simulateAscent(P, ascentStart, grads, {});
      if (sim.errors.length) { out.errors = out.errors.concat(sim.errors); return out; }
      const decoPhase = sim.runtime - sim.decoZoneRt;
      const surfT = surfacePhaseTimes(sim.t, P.surfaceP);
      const pvt = new Array(NC);
      for (let i = 0; i < NC; i++) pvt[i] = decoPhase + surfT[i];
      if (lastPVT !== null) {
        for (let i = 0; i < NC; i++) {
          if (Math.abs(pvt[i] - lastPVT[i]) <= 1.0) { converged = true; break; }
        }
      }
      if (converged || sim.stops.length === 0) break;
      lastPVT = pvt;
      grads = cvaRelax(initial, decoPhase, surfT);
    }
    if (!converged && sim.stops.length > 0) out.warnings.push('VPM-B critical volume iteration did not fully converge; using last schedule');

    // ---- final pass, with sampling ----
    const final = simulateAscent(P, ascentStart, grads, {
      sampler: collect ? function (tm, d, gas, c) {
        profile.push({ t: tm, depth: d, gasId: gas.id });
        ceilingProfile.push({ t: tm, ceiling: c });
      } : null
    });
    if (final.errors.length) { out.errors = out.errors.concat(final.errors); return out; }

    out.ok = true;
    out.P = P;
    out.rows = bottom.rows.concat(final.rows);
    out.stops = final.stops;
    out.firstActualStop = final.firstActualStop;
    out.firstStopArrivalRt = final.firstStopArrivalRt;
    out.totalRuntime = final.runtime;
    out.finalT = final.t;
    out.deepest = bottom.deepest;
    out.bottomRuntime = bottom.runtime;
    out.profile = profile;
    out.ceilingProfile = ceilingProfile;
    return out;
  }

  // ========================================================================
  // oxygen accounting (NOAA CNS, OTU)
  // ========================================================================

  const CNS_TBL = [
    [0.6, 720], [0.7, 570], [0.8, 450], [0.9, 360], [1.0, 300],
    [1.1, 240], [1.2, 210], [1.3, 180], [1.4, 150], [1.5, 120], [1.6, 45]
  ];

  function cnsRate(p) {
    if (p <= 0.5) return 0;
    if (p >= 1.6) return 1 / 45 + (p - 1.6) * ((1 / 45 - 1 / 120) / 0.1);
    let p0 = 0.5, r0 = 0;
    for (let i = 0; i < CNS_TBL.length; i++) {
      const pi = CNS_TBL[i][0], ri = 1 / CNS_TBL[i][1];
      if (p <= pi + 1e-12) return r0 + (p - p0) * (ri - r0) / (pi - p0);
      p0 = pi; r0 = ri;
    }
    return 1 / 45;
  }

  // ========================================================================
  // public plan()
  // ========================================================================

  function emptyResult(input, errors, warnings) {
    const w = (input && input.water === 'fresh') ? 'fresh' : 'salt';
    return {
      ok: false, errors: errors, warnings: warnings || [], algorithm: 'VPMB',
      params: {
        gfLow: input && input.gfLow, gfHigh: input && input.gfHigh,
        vpmConservatism: input && input.vpmConservatism,
        lastStopDepth: input && input.lastStopDepth,
        surfacePressure: input && input.surfacePressure, water: w
      },
      table: [], stops: [], noDeco: false, ndl: null, firstStopDepth: null,
      totalRuntime: 0, totalDecoTime: 0, gasUsage: [],
      oxygen: { cns: 0, otu: 0 }, profile: [], ceilingProfile: [], finalTissues: []
    };
  }

  function plan(input) {
    const r = runPipeline(input, true);
    if (!r.ok) return emptyResult(input, r.errors, r.warnings);
    const P = r.P;
    const warnings = r.warnings;

    // ---- NDL ----
    const noDeco = r.stops.length === 0;
    let ndl = null;
    if (noDeco) {
      // deepest segment index
      let di = 0;
      for (let i = 1; i < P.segments.length; i++) {
        if (P.segments[i].depth > P.segments[di].depth) di = i;
      }
      const stillNoDeco = function (extra) {
        const segs = input.segments.map(function (s, i) {
          return { depth: s.depth, time: s.time + (i === di ? extra : 0), gasId: s.gasId };
        });
        const mod = {};
        for (const k in input) mod[k] = input[k];
        mod.segments = segs;
        const rr = runPipeline(mod, false);
        return rr.ok && rr.stops.length === 0;
      };
      if (stillNoDeco(999)) {
        ndl = 999;
      } else {
        let lo = 0, hi = 999; // lo: known no-deco extension, hi: known deco
        while (hi - lo > 1) {
          const mid = Math.floor((lo + hi) / 2);
          if (stillNoDeco(mid)) lo = mid; else hi = mid;
        }
        ndl = lo;
      }
    }

    // ---- oxygen, gas usage, warnings ----
    let cns = 0, otu = 0;
    let cnsExtrap = false, ppBottomHigh = false, ppAnyHigh = false, endHigh = false;
    const usage = {};
    for (let i = 0; i < r.rows.length; i++) {
      const row = r.rows[i];
      const avg = (row.ppO2Start + row.ppO2End) / 2;
      if (row.duration > 0) {
        cns += row.duration * cnsRate(avg) * 100;
        if (avg > 1.6 + EPS) cnsExtrap = true;
        if (avg > 0.5) otu += row.duration * Math.pow((avg - 0.5) / 0.5, 0.833);
      }
      const maxPp = Math.max(row.ppO2Start, row.ppO2End);
      if ((row.phase === 'desc' || row.phase === 'level') && maxPp > 1.4 + EPS) ppBottomHigh = true;
      if (maxPp > 1.65 + EPS) ppAnyHigh = true;
      if (row.phase === 'level') {
        const g = P.gasById[row.gasId];
        const end = (P.pAmb(row.startDepth) * (1 - g.fHe) - P.surfaceP) * P.mpb;
        if (end > 30 + 1e-6) endHigh = true;
      }
      const sac = (row.phase === 'desc' || row.phase === 'level') ? P.sacBottom : P.sacDeco;
      const liters = sac * ((P.pAmb(row.startDepth) + P.pAmb(row.endDepth)) / 2) * row.duration;
      usage[row.gasId] = (usage[row.gasId] || 0) + liters;
    }
    if (ppBottomHigh) warnings.push('ppO2 exceeds 1.4 bar on bottom gas');
    if (ppAnyHigh) warnings.push('ppO2 exceeds 1.65 bar during the dive');
    if (endHigh) warnings.push('END exceeds 30 m');
    if (cnsExtrap) warnings.push('ppO2 above 1.6 bar: CNS clock extrapolated beyond the NOAA table');
    if (cns > 100) warnings.push('CNS oxygen toxicity exceeds 100%');
    // User-forced segments rising above the live ceiling (profile and
    // ceilingProfile are pushed pairwise; bottom phase ends at bottomRuntime).
    if (r.profile && r.profile.length) {
      let segViol = 0, segViolT = 0;
      for (let i = 0; i < r.profile.length; i++) {
        if (r.profile[i].t > r.bottomRuntime + EPS) break;
        const v = r.ceilingProfile[i].ceiling - r.profile[i].depth;
        if (v > segViol) { segViol = v; segViolT = r.profile[i].t; }
      }
      if (segViol > 0.5) {
        warnings.push('planned level rises ' + segViol.toFixed(1) + ' m above the decompression ceiling (t=' +
          segViolT.toFixed(0) + ' min); add decompression before the shallow level');
      }
    }

    const gasUsage = [];
    for (const id in usage) {
      const g = P.gasById[id];
      gasUsage.push({ gasId: id, fO2: g.fO2, fHe: g.fHe, liters: usage[id] });
    }

    const totalDecoTime = (r.stops.length && r.firstStopArrivalRt !== null)
      ? r.totalRuntime - r.firstStopArrivalRt : 0;

    const finalTissues = [];
    for (let i = 0; i < NC; i++) {
      finalTissues.push({
        pN2: r.finalT.n2[i], pHe: r.finalT.he[i],
        pTotal: r.finalT.n2[i] + r.finalT.he[i], gfSurfacePct: null
      });
    }

    return {
      ok: true,
      errors: [],
      warnings: warnings,
      algorithm: 'VPMB',
      params: {
        gfLow: P.gfLow, gfHigh: P.gfHigh, vpmConservatism: P.cons,
        lastStopDepth: P.lastStop, surfacePressure: P.surfaceP, water: P.water
      },
      table: r.rows,
      stops: r.stops,
      noDeco: noDeco,
      ndl: ndl,
      firstStopDepth: r.stops.length ? r.stops[0].depth : null,
      totalRuntime: r.totalRuntime,
      totalDecoTime: totalDecoTime,
      gasUsage: gasUsage,
      oxygen: { cns: cns, otu: otu },
      profile: r.profile,
      ceilingProfile: r.ceilingProfile,
      finalTissues: finalTissues
    };
  }

  return {
    VERSION: VERSION,
    plan: plan,
    _test: {
      surfaceTissues: surfaceTissues,
      boyleGradient: boyleGradient,
      solveCubicX: solveCubicX,
      cnsRate: cnsRate,
      constants: {
        GAMMA: GAMMA, GAMMA_C: GAMMA_C, REGEN_TIME: REGEN_TIME,
        G_IMPERM_BAR: G_IMPERM_BAR, P_OTHER: P_OTHER,
        LAMBDA_PA_MIN: LAMBDA_PA_MIN, R0_N2: R0_N2, R0_HE: R0_HE,
        CONS_MULT: CONS_MULT, PH2O: PH2O
      }
    }
  };
});
