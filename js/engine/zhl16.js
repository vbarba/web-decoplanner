/*
 * zhl16.js — Buhlmann ZHL-16C decompression engine with Erik Baker
 * gradient factors and a multi-gas open-circuit scheduler.
 *
 * All math is metric: depth in msw, time in minutes, pressure in bar
 * (absolute), gas fractions 0..1, volumes in surface-equivalent liters.
 *
 * Exposed as DecoEngine in the browser and via module.exports in Node.
 *
 * plan() always GENERATES a schedule from the inputs (NDL or staged deco).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DecoEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.1.1';

  // ---------------------------------------------------------------------
  // Physical constants and ZHL-16C coefficient tables
  // ---------------------------------------------------------------------
  const PH2O = 0.0627;          // Buhlmann respiratory water vapor, bar
  const LN2 = Math.log(2);
  const EPS = 1e-6;
  const NC = 16;                // number of tissue compartments

  const HT_N2 = [5.0, 8.0, 12.5, 18.5, 27.0, 38.3, 54.3, 77.0, 109.0, 146.0, 187.0, 239.0, 305.0, 390.0, 498.0, 635.0];
  const A_N2 = [1.1696, 1.0000, 0.8618, 0.7562, 0.6200, 0.5043, 0.4410, 0.4000, 0.3750, 0.3500, 0.3295, 0.3065, 0.2835, 0.2610, 0.2480, 0.2327];
  const B_N2 = [0.5578, 0.6514, 0.7222, 0.7825, 0.8126, 0.8434, 0.8693, 0.8910, 0.9092, 0.9222, 0.9319, 0.9403, 0.9477, 0.9544, 0.9602, 0.9653];
  const HT_HE = [1.88, 3.02, 4.72, 6.99, 10.21, 14.48, 20.53, 29.11, 41.20, 55.19, 70.69, 90.34, 115.29, 147.42, 188.24, 240.03];
  const A_HE = [1.6189, 1.3830, 1.1919, 1.0458, 0.9220, 0.8205, 0.7305, 0.6502, 0.5950, 0.5545, 0.5333, 0.5189, 0.5181, 0.5176, 0.5172, 0.5119];
  const B_HE = [0.4770, 0.5747, 0.6527, 0.7223, 0.7582, 0.7957, 0.8279, 0.8553, 0.8757, 0.8903, 0.8997, 0.9073, 0.9122, 0.9171, 0.9217, 0.9267];

  // ZHL-16B nitrogen a-coefficients (Buhlmann "table" parameterization; Baker,
  // "Understanding M-values"). Differs from the ZHL-16C set above ONLY at
  // compartments 5..15 (B uses larger a-values there, i.e. stiffer M-values /
  // more conservative); compartments 1..4 and 16 are identical to C. The N2 b
  // coefficients and ALL helium a/b coefficients are identical to C, and the
  // half-times are shared. (NB: the well-known 1.2599/0.5050 compartment-1
  // figure is ZHL-16*A*, not B — B's compartment 1 equals C's 1.1696/0.5578.)
  // C set verified verbatim against Subsurface core/deco.cpp.
  const A_N2_B = [1.1696, 1.0000, 0.8618, 0.7562, 0.6667, 0.5600, 0.4947, 0.4500, 0.4187, 0.3798, 0.3497, 0.3223, 0.2850, 0.2737, 0.2523, 0.2327];
  const B_N2_B = B_N2;   // identical to ZHL-16C
  const A_HE_B = A_HE;   // identical to ZHL-16C
  const B_HE_B = B_HE;   // identical to ZHL-16C

  // NOAA single-exposure CNS limits: ppO2 (bar) -> max minutes.
  // The toxicity RATE (1/limit per minute) is interpolated linearly between
  // points; below 0.5 bar there is no CNS load; above 1.6 bar the 1.5->1.6
  // rate slope is extrapolated (and the planner adds a warning).
  const CNS_PP = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6];
  const CNS_LIMIT = [Infinity, 720, 570, 450, 360, 300, 240, 210, 180, 150, 120, 45];
  const CNS_RATE = CNS_LIMIT.map(function (lim) { return lim === Infinity ? 0 : 1 / lim; });

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------
  function def(v, d) { return v === undefined || v === null ? d : v; }
  function mpbFor(water) { return water === 'fresh' ? 10.3 : 10.0; }
  function pAmb(ctx, depth) { return ctx.sp + depth / ctx.mpb; }
  function roundUpMult(x, m) { return Math.ceil(x / m - EPS) * m; }
  function floorMult(x, m) { return Math.floor(x / m + EPS) * m; }

  // ---------------------------------------------------------------------
  // Tissue model primitives (operate on plain arrays pn[16], ph[16])
  // ---------------------------------------------------------------------
  function initTissues(sp) {
    // Air-saturated at the surface: pN2 = (Psurf - PH2O) * 0.79, no helium.
    const pn = new Array(NC).fill((sp - PH2O) * 0.79);
    const ph = new Array(NC).fill(0);
    return { pn: pn, ph: ph };
  }

  // Haldane equation at constant depth.
  function loadConstant(pn, ph, ctx, depth, minutes, gas) {
    if (minutes <= 0) return;
    const palv = Math.max(0, pAmb(ctx, depth) - PH2O);
    const pin = palv * gas.fN2;
    const pih = palv * gas.fHe;
    for (let i = 0; i < NC; i++) {
      pn[i] = pin + (pn[i] - pin) * Math.exp(-LN2 * minutes / HT_N2[i]);
      ph[i] = pih + (ph[i] - pih) * Math.exp(-LN2 * minutes / HT_HE[i]);
    }
  }

  // Schreiner equation: tissue response to a linear change of inspired
  // pressure (constant-rate depth change). pi0 = inspired pressure at the
  // start, r = its rate of change in bar/min, k = ln2/halfTime.
  function schreiner(pi0, r, p0, k, t) {
    return pi0 + r * (t - 1 / k) - (pi0 - p0 - r / k) * Math.exp(-k * t);
  }

  function loadTravel(pn, ph, ctx, d0, d1, minutes, gas) {
    if (minutes <= 0) return;
    const depthRate = (d1 - d0) / minutes;                 // m/min, signed
    const palv0 = Math.max(0, pAmb(ctx, d0) - PH2O);       // water-vapor-corrected
    const rN = (depthRate / ctx.mpb) * gas.fN2;            // bar/min inspired N2
    const rH = (depthRate / ctx.mpb) * gas.fHe;
    const piN = palv0 * gas.fN2;
    const piH = palv0 * gas.fHe;
    for (let i = 0; i < NC; i++) {
      pn[i] = schreiner(piN, rN, pn[i], LN2 / HT_N2[i], minutes);
      ph[i] = schreiner(piH, rH, ph[i], LN2 / HT_HE[i], minutes);
    }
  }

  // GF-adjusted tolerated ambient pressure (Erik Baker):
  //   Ptol = (Pcomp - a*gf) / (gf/b + 1 - gf)
  // with a/b weighted by the inert-gas mix in the compartment. Returns the
  // maximum (deepest requirement) over all 16 compartments.
  function maxTolAmb(pn, ph, gf, ctx) {
    let m = -Infinity;
    for (let i = 0; i < NC; i++) {
      const pt = pn[i] + ph[i];
      if (pt <= 0) continue;
      const a = (ctx.aN2[i] * pn[i] + ctx.aHe[i] * ph[i]) / pt;
      const b = (ctx.bN2[i] * pn[i] + ctx.bHe[i] * ph[i]) / pt;
      const ptol = (pt - a * gf) / (gf / b + 1 - gf);
      if (ptol > m) m = ptol;
    }
    return m;
  }

  function ceilingDepth(pn, ph, gf, ctx) {
    return Math.max(0, (maxTolAmb(pn, ph, gf, ctx) - ctx.sp) * ctx.mpb);
  }

  // Gradient factor at depth d for a slope anchored at the first stop:
  // gfLow at the anchor, gfHigh at the surface, clamped to [gfLow, gfHigh].
  function gfAt(depth, anchor, ctx) {
    if (!anchor || anchor <= 0) return ctx.gfHi;
    const gf = ctx.gfHi - (ctx.gfHi - ctx.gfLo) * depth / anchor;
    const lo = Math.min(ctx.gfLo, ctx.gfHi);
    const hi = Math.max(ctx.gfLo, ctx.gfHi);
    return Math.min(hi, Math.max(lo, gf));
  }

  // ---------------------------------------------------------------------
  // Input normalization / validation
  // ---------------------------------------------------------------------
  function normalize(input) {
    const errors = [];
    const sp = def(input.surfacePressure, 1.013);
    const water = def(input.water, 'salt');
    const ctx = {
      sp: sp,
      water: water,
      mpb: mpbFor(water),
      gfLo: def(input.gfLow, 50) / 100,
      gfHi: def(input.gfHigh, 80) / 100,
      descentRate: def(input.descentRate, 18),
      ascentRate: def(input.ascentRate, 9),
      stopInterval: def(input.stopInterval, 3),
      lastStop: def(input.lastStopDepth, 6),
      minStop: def(input.minStopTime, 1),
      switchHold: def(input.gasSwitchStopTime, 1),
      ppO2MaxDeco: def(input.ppO2MaxDeco, 1.61),
      includeTravel: def(input.segmentTimesIncludeTravel, true),
      sacBottom: def(input.sacBottom, 20),
      sacDeco: def(input.sacDeco, 16),
      gases: {},
      gasList: [],
      decoGases: [],
      segments: [],
    };

    // Coefficient variant: 'B' selects the ZHL-16B nitrogen a-table; anything
    // else (default, incl. 'ZHL16C'/'VPMB'/undefined) uses ZHL-16C unchanged.
    ctx.variant = (input.algorithm === 'ZHL16B') ? 'B' : 'C';
    ctx.aN2 = ctx.variant === 'B' ? A_N2_B : A_N2;
    ctx.bN2 = ctx.variant === 'B' ? B_N2_B : B_N2;
    ctx.aHe = ctx.variant === 'B' ? A_HE_B : A_HE;
    ctx.bHe = ctx.variant === 'B' ? B_HE_B : B_HE;

    if (!(sp > 0.5 && sp < 1.2)) errors.push('surfacePressure must be in (0.5, 1.2) bar');
    if (!(ctx.gfLo > 0 && ctx.gfHi > 0 && ctx.gfLo <= 1.5 && ctx.gfHi <= 1.5)) errors.push('gradient factors must be in 1..150');
    if (ctx.gfLo > ctx.gfHi + EPS) errors.push('gfLow must not exceed gfHigh');
    if (!(ctx.descentRate > 0) || !(ctx.ascentRate > 0)) errors.push('descentRate and ascentRate must be positive');
    if (!(ctx.stopInterval > 0)) errors.push('stopInterval must be positive');
    if (!(ctx.lastStop > 0)) errors.push('lastStopDepth must be positive');

    const gasesIn = Array.isArray(input.gases) ? input.gases : [];
    if (gasesIn.length === 0) errors.push('at least one gas is required');
    for (let i = 0; i < gasesIn.length; i++) {
      const g = gasesIn[i];
      const fO2 = Number(g.fO2);
      const fHe = Number(def(g.fHe, 0));
      if (!g.id || ctx.gases[g.id]) { errors.push('gas ' + (i + 1) + ' must have a unique id'); continue; }
      if (!(fO2 > 0 && fO2 <= 1) || !(fHe >= 0 && fHe <= 1) || fO2 + fHe > 1 + 1e-9) {
        errors.push('gas "' + g.id + '" has invalid fractions');
        continue;
      }
      const gas = {
        id: g.id,
        fO2: fO2,
        fHe: fHe,
        fN2: Math.max(0, 1 - fO2 - fHe),
        type: def(g.type, 'bottom'),
        switchDepth: null,
      };
      if (gas.type === 'deco') {
        // MOD rounded down to the stop interval, with a half-interval
        // tolerance before flooring (same rule as the VPM-B engine). A strict
        // floor would put pure O2 (raw MOD 5.97 m at ppO2Max 1.61) at 3 m,
        // below the conventional 6 m last stop; the tolerance reproduces the
        // canonical DecoPlanner/V-Planner switch depths (EAN50 -> 21 m,
        // O2 -> 6 m at 1.61; EAN36 -> 33 m at 1.5).
        const rawMod = Math.max(0, (ctx.ppO2MaxDeco / gas.fO2 - ctx.sp) * ctx.mpb);
        gas.switchDepth = floorMult(rawMod + ctx.stopInterval / 2, ctx.stopInterval);
        ctx.decoGases.push(gas);
      }
      ctx.gases[gas.id] = gas;
      ctx.gasList.push(gas);
    }

    // Optional repetitive-dive seed: 16 compartments of {pN2,pHe} in bar
    // (the finalTissues shape, optionally after a surfaceInterval() decay).
    // Absent -> surface air saturation as always.
    ctx.initialTissues = null;
    if (input.initialTissues !== undefined && input.initialTissues !== null) {
      const arr = input.initialTissues;
      if (!Array.isArray(arr) || arr.length !== NC) {
        errors.push('initialTissues must be an array of 16 compartments');
      } else {
        const pn = [], ph = [];
        let tOk = true;
        for (let i = 0; i < NC; i++) {
          const c = arr[i] || {};
          const n = Number(c.pN2);
          const h = Number(def(c.pHe, 0));
          if (!isFinite(n) || n < 0 || !isFinite(h) || h < 0) tOk = false;
          pn.push(n); ph.push(h);
        }
        if (tOk) ctx.initialTissues = { pn: pn, ph: ph };
        else errors.push('initialTissues has invalid compartment pressures');
      }
    }

    const segsIn = Array.isArray(input.segments) ? input.segments : [];
    if (segsIn.length === 0) errors.push('at least one dive segment is required');
    let cur = 0;
    for (let i = 0; i < segsIn.length; i++) {
      const s = segsIn[i];
      const depth = Number(s.depth);
      const time = Number(s.time);
      if (!isFinite(depth) || depth < 0) { errors.push('segment ' + (i + 1) + ' has an invalid depth'); continue; }
      if (!isFinite(time) || time < 0) { errors.push('segment ' + (i + 1) + ' has an invalid time'); continue; }
      if (!ctx.gases[s.gasId]) { errors.push('segment ' + (i + 1) + ' references unknown gas "' + s.gasId + '"'); continue; }
      const goingDown = depth > cur + EPS;
      const travelTime = Math.abs(depth - cur) / (goingDown ? ctx.descentRate : ctx.ascentRate);
      const levelTime = ctx.includeTravel ? time - travelTime : time;
      if (travelTime > EPS && levelTime < 0.1 - EPS) {
        errors.push(ctx.includeTravel
          ? 'segment ' + (i + 1) + ' (' + depth + ' m): segment time shorter than required travel time (' +
            travelTime.toFixed(1) + ' min travel)'
          : 'segment ' + (i + 1) + ' (' + depth + ' m): level time must be at least 0.1 min');
        continue;
      }
      ctx.segments.push({ depth: depth, gasId: s.gasId, travelTime: travelTime, levelTime: Math.max(0, levelTime) });
      cur = depth;
    }

    return { ctx: ctx, errors: errors };
  }

  // ---------------------------------------------------------------------
  // Simulation state with row + fine-grained profile recording
  // ---------------------------------------------------------------------
  function makeSim(ctx, firstGasId) {
    const t = ctx.initialTissues
      ? { pn: ctx.initialTissues.pn.slice(), ph: ctx.initialTissues.ph.slice() }
      : initTissues(ctx.sp);
    const sim = {
      ctx: ctx, pn: t.pn, ph: t.ph,
      depth: 0, runtime: 0, gasId: firstGasId,
      anchor: null,                  // first-stop depth anchoring the GF slope
      rows: [], stops: [], profile: [], ceilingProfile: [],
    };
    samplePoint(sim);
    return sim;
  }

  // GF used for the displayed ceiling: the anchored slope once the first
  // stop is fixed, otherwise gfLow ("where would my first stop be") — except
  // once the gfHigh obligation is already clear (NDL dives, end of their
  // ascent), where the binding surfacing criterion is gfHigh: displaying the
  // gfLow ceiling there would draw a phantom ceiling above a diver who is
  // free to surface.
  function displayGf(sim) {
    if (sim.anchor) return gfAt(sim.depth, sim.anchor, sim.ctx);
    if (ceilingDepth(sim.pn, sim.ph, sim.ctx.gfHi, sim.ctx) <= EPS) return sim.ctx.gfHi;
    return sim.ctx.gfLo;
  }

  function samplePoint(sim) {
    sim.profile.push({ t: sim.runtime, depth: sim.depth, gasId: sim.gasId });
    sim.ceilingProfile.push({ t: sim.runtime, ceiling: ceilingDepth(sim.pn, sim.ph, displayGf(sim), sim.ctx) });
  }

  function pushRow(sim, phase, startDepth, endDepth, duration) {
    const gas = sim.ctx.gases[sim.gasId];
    sim.rows.push({
      phase: phase, startDepth: startDepth, endDepth: endDepth,
      duration: duration, runtime: sim.runtime, gasId: sim.gasId,
      ppO2Start: gas.fO2 * pAmb(sim.ctx, startDepth),
      ppO2End: gas.fO2 * pAmb(sim.ctx, endDepth),
    });
  }

  // Constant-rate depth change, sampled in <= 0.5 min sub-steps.
  function travelTo(sim, phase, target, rate) {
    const d0 = sim.depth;
    if (Math.abs(target - d0) < EPS) return;
    const dur = Math.abs(target - d0) / rate;
    const t0 = sim.runtime;
    const n = Math.max(1, Math.ceil(dur / 0.5 - EPS));
    const gas = sim.ctx.gases[sim.gasId];
    for (let j = 1; j <= n; j++) {
      const dPrev = d0 + (target - d0) * (j - 1) / n;
      const dNext = d0 + (target - d0) * j / n;
      loadTravel(sim.pn, sim.ph, sim.ctx, dPrev, dNext, dur / n, gas);
      sim.depth = dNext;
      sim.runtime = t0 + dur * j / n;
      samplePoint(sim);
    }
    sim.depth = target;
    sim.runtime = t0 + dur;
    pushRow(sim, phase, d0, target, dur);
  }

  // Constant depth, sampled in <= 0.5 min sub-steps.
  function holdAt(sim, phase, minutes) {
    const t0 = sim.runtime;
    if (minutes > 0) {
      const n = Math.ceil(minutes / 0.5 - EPS);
      const gas = sim.ctx.gases[sim.gasId];
      for (let j = 1; j <= n; j++) {
        loadConstant(sim.pn, sim.ph, sim.ctx, sim.depth, minutes / n, gas);
        sim.runtime = t0 + minutes * j / n;
        samplePoint(sim);
      }
    }
    pushRow(sim, phase, sim.depth, sim.depth, minutes);
  }

  function switchTo(sim, gasId, holdMinutes) {
    sim.gasId = gasId;
    samplePoint(sim);                 // duplicate-t vertex marking the gas change
    holdAt(sim, 'switch', holdMinutes);
  }

  // ---------------------------------------------------------------------
  // Gas switching rules (ascent only)
  // ---------------------------------------------------------------------
  // Best deco gas usable at `depth`: highest fO2 among deco gases whose
  // (interval-rounded) MOD is at or below us, and richer than what we breathe.
  function bestSwitchGas(ctx, depth, currentGas) {
    let best = null;
    for (let i = 0; i < ctx.decoGases.length; i++) {
      const g = ctx.decoGases[i];
      if (g.switchDepth >= depth - EPS && g.fO2 > currentGas.fO2 + 1e-9 && (!best || g.fO2 > best.fO2)) best = g;
    }
    return best;
  }

  // Deepest switch depth strictly between the current depth and the ascent
  // target where a richer gas becomes available (never below lastStop, so
  // the final ascent from the last stop to the surface is direct).
  function nextSwitchBreak(ctx, fromDepth, toDepth, currentGas) {
    let best = null;
    for (let i = 0; i < ctx.decoGases.length; i++) {
      const g = ctx.decoGases[i];
      const d = g.switchDepth;
      if (d < fromDepth - EPS && d > toDepth + EPS && d >= ctx.lastStop - EPS &&
          g.fO2 > currentGas.fO2 + 1e-9 && (best === null || d > best)) best = d;
    }
    return best;
  }

  // Ascend to `target`, breaking the travel at intermediate gas-switch
  // depths. Every switch enforces a gasSwitchStopTime hold.
  function ascendWithSwitches(sim, target) {
    const ctx = sim.ctx;
    while (sim.depth > target + EPS) {
      // A richer gas already breathable HERE (e.g. a deco gas whose MOD is at
      // or below the bottom) switches before the leg — V-Planner convention:
      // switch at the MOD, not at the first stop.
      const g0 = bestSwitchGas(ctx, sim.depth, ctx.gases[sim.gasId]);
      if (g0) switchTo(sim, g0.id, ctx.switchHold);
      const cur = ctx.gases[sim.gasId];
      const brk = nextSwitchBreak(ctx, sim.depth, target, cur);
      travelTo(sim, 'asc', brk === null ? target : brk, ctx.ascentRate);
      if (brk !== null) {
        const g = bestSwitchGas(ctx, sim.depth, ctx.gases[sim.gasId]);
        if (g) switchTo(sim, g.id, ctx.switchHold);
      }
    }
  }

  // Hold time at the current stop, Erik Baker DECOMPRESSION_STOP convention
  // (shared with DecoPlanner/GFDECO): the stop ends on a whole multiple of
  // minStopTime of RUNTIME, not of time-at-depth. A fractional lead-in first
  // absorbs the ascent leg's fraction (always > 0, so every rung is held),
  // then whole minutes are added until the ceiling (with the GF of the NEXT
  // stop) clears that next depth. Computed on cloned tissues; the caller
  // applies the stay via holdAt(). null = never clears.
  function computeStopHold(sim, gfNext, nextDepth) {
    const ctx = sim.ctx;
    const pn = sim.pn.slice();
    const ph = sim.ph.slice();
    const gas = ctx.gases[sim.gasId];
    const minStop = Math.max(1, Math.ceil(ctx.minStop - EPS));
    let hold = roundUpMult(sim.runtime, minStop) - sim.runtime;
    if (hold < EPS) hold = minStop;        // already on a boundary: full increment
    loadConstant(pn, ph, ctx, sim.depth, hold, gas);
    let guard = 0;
    while (ceilingDepth(pn, ph, gfNext, ctx) > nextDepth + EPS) {
      if (++guard > 999) return null;
      loadConstant(pn, ph, ctx, sim.depth, minStop, gas);
      hold += minStop;
    }
    return hold;
  }

  // Remaining whole no-deco minutes at the current depth/gas (cap 999).
  function computeNdl(sim) {
    const ctx = sim.ctx;
    const pn = sim.pn.slice();
    const ph = sim.ph.slice();
    const gas = ctx.gases[sim.gasId];
    for (let m = 1; m <= 999; m++) {
      loadConstant(pn, ph, ctx, sim.depth, 1, gas);
      if (ceilingDepth(pn, ph, ctx.gfHi, ctx) > EPS) return m - 1;
    }
    return 999;
  }

  // First stop via a DYNAMIC (continuous-ascent) ceiling — the Subsurface /
  // DecoPlanner convention. The diver ascends rung by rung; the ceiling is
  // recomputed at each rung as tissues off-gas during the ascent leg, so the
  // first stop is the shallowest rung still reachable before the next rung is
  // blocked. This lands one rung shallower than Baker's static round-up on
  // profiles where off-gassing during the ascent recedes the ceiling faster
  // than the diver descends to it. Re-evaluating the live ceiling at each rung
  // also subsumes the old projected-ascent deepening: on a trimix dive where
  // on-gassing during ascent deepens the requirement, the walk simply stops
  // earlier (deeper). Seeded at the static round-up. See docs/DECISIONS.md.
  function firstStopCandidate(sim) {
    const ctx = sim.ctx;
    let candidate = Math.max(roundUpMult(ceilingDepth(sim.pn, sim.ph, ctx.gfLo, ctx), ctx.stopInterval), ctx.lastStop);
    if (candidate > sim.depth) return Math.min(candidate, sim.depth);  // obligation at/below bottom
    // Walk the ascent down on cloned tissues, mirroring ascendWithSwitches
    // (gas changes, no switch holds — holds only shallow the ceiling).
    const pn = sim.pn.slice();
    const ph = sim.ph.slice();
    let d = sim.depth;
    let gid = sim.gasId;
    while (candidate > ctx.lastStop + EPS) {
      const next = Math.max(candidate - ctx.stopInterval, ctx.lastStop);
      // ascend the cloned diver from d to `next`, breaking at gas switches
      while (d > next + EPS) {
        const g0 = bestSwitchGas(ctx, d, ctx.gases[gid]);
        if (g0) gid = g0.id;
        const brk = nextSwitchBreak(ctx, d, next, ctx.gases[gid]);
        const to = brk === null ? next : brk;
        loadTravel(pn, ph, ctx, d, to, (d - to) / ctx.ascentRate, ctx.gases[gid]);
        d = to;
        if (brk !== null) {
          const g = bestSwitchGas(ctx, d, ctx.gases[gid]);
          if (g) gid = g.id;
        }
      }
      // Blocked? the live GF-low ceiling now sits above `next` — stop at `candidate`.
      if (ceilingDepth(pn, ph, ctx.gfLo, ctx) > next + EPS) break;
      candidate = next;
    }
    return candidate;
  }

  // ---------------------------------------------------------------------
  // CNS / OTU
  // ---------------------------------------------------------------------
  function cnsRate(ppO2) {            // fraction of the clock per minute
    if (ppO2 <= CNS_PP[0]) return 0;
    const last = CNS_PP.length - 1;
    if (ppO2 >= CNS_PP[last]) {
      const slope = (CNS_RATE[last] - CNS_RATE[last - 1]) / (CNS_PP[last] - CNS_PP[last - 1]);
      return CNS_RATE[last] + slope * (ppO2 - CNS_PP[last]);
    }
    let i = 0;
    while (ppO2 > CNS_PP[i + 1]) i++;
    const f = (ppO2 - CNS_PP[i]) / (CNS_PP[i + 1] - CNS_PP[i]);
    return CNS_RATE[i] + f * (CNS_RATE[i + 1] - CNS_RATE[i]);
  }

  // ---------------------------------------------------------------------
  // Public helpers
  // ---------------------------------------------------------------------
  function gasName(gas) {
    const o2 = Math.round(gas.fO2 * 100);
    const he = Math.round((gas.fHe || 0) * 100);
    if (he > 0) return o2 + '/' + he;
    if (o2 >= 100) return 'Oxygen';
    if (o2 === 21) return 'Air';
    return 'EAN' + o2;
  }

  function optsCtx(opts) {
    return { sp: def(opts && opts.surfacePressure, 1.013), mpb: mpbFor(def(opts && opts.water, 'salt')) };
  }

  function mod(gas, ppO2max, opts) {
    const c = optsCtx(opts);
    return Math.max(0, (ppO2max / gas.fO2 - c.sp) * c.mpb);
  }

  // O2-narcotic END: only helium is considered non-narcotic.
  function end(depth, gas, opts) {
    const c = optsCtx(opts);
    return Math.max(0, (depth + c.mpb * c.sp) * (1 - (gas.fHe || 0)) - c.mpb * c.sp);
  }

  function ead(depth, gas, opts) {
    const c = optsCtx(opts);
    const fN2 = 1 - gas.fO2 - (gas.fHe || 0);
    return Math.max(0, ((c.sp + depth / c.mpb) * fN2 / 0.79 - c.sp) * c.mpb);
  }

  // Off-gas a finalTissues-shaped array breathing air at the surface for
  // `minutes` (a repetitive-dive surface interval). Returns the same shape,
  // ready to feed the next plan() call as input.initialTissues. Works for
  // tissue states from either engine (both report pN2/pHe in bar).
  //
  // `opts.desatMult` (default 1) is the Bühlmann pulmonary-shunt factor: the
  // elimination half-time is divided by it ONLY for compartments that are
  // off-gassing (tissue above the inspired pressure), so desatMult < 1 slows
  // desaturation and retains more residual load. This mirrors Subsurface's
  // `buehlmann_config.desatmult` (core/deco.c), which ships at 1.0. Standard
  // ZH-L16 (and Subsurface's default, and HALDANE's default) is symmetric
  // (desatMult = 1); DecoPlanner slows off-gassing via this shunt — desatMult
  // ~= 0.75 reproduces DecoPlanner's repetitive-dive schedules here.
  function surfaceInterval(tissues, minutes, opts) {
    const c = optsCtx(opts);
    const dm = (opts && Number(opts.desatMult) > 0) ? Number(opts.desatMult) : 1;
    const t = Math.max(0, Number(minutes) || 0);
    const palv = Math.max(0, c.sp - PH2O);   // air at the surface
    const pinN = palv * 0.79, pinH = 0;
    const out = [];
    for (let i = 0; i < NC; i++) {
      const src = (tissues && tissues[i]) || {};
      let pN = Math.max(0, Number(src.pN2) || 0);
      let pH = Math.max(0, Number(src.pHe) || 0);
      const kN = (LN2 / HT_N2[i]) * (pN > pinN ? dm : 1);   // slow only off-gassing
      const kH = (LN2 / HT_HE[i]) * (pH > pinH ? dm : 1);
      out.push({
        pN2: pinN + (pN - pinN) * Math.exp(-kN * t),
        pHe: pinH + (pH - pinH) * Math.exp(-kH * t),
      });
    }
    return out;
  }

  // Richest breathable mix at depth: max fO2 within ppO2max (floored to a
  // whole percent), minimum helium to honor endMax (ceiled to a whole percent).
  function bestMix(depth, ppO2max, endMax, opts) {
    const c = optsCtx(opts);
    const pamb = c.sp + depth / c.mpb;
    let fO2 = Math.min(1, Math.floor((ppO2max / pamb) * 100) / 100);
    let fHe = 0;
    if (depth > 0) {
      fHe = Math.max(0, 1 - (endMax + c.mpb * c.sp) / (depth + c.mpb * c.sp));
      fHe = Math.ceil(fHe * 100 - 1e-9) / 100;
    }
    if (fO2 + fHe > 1) fHe = Math.max(0, 1 - fO2);
    return { fO2: fO2, fHe: fHe };
  }

  // ---------------------------------------------------------------------
  // Planner
  // ---------------------------------------------------------------------
  function emptyResult(params, errors, warnings, algorithm) {
    return {
      ok: false, errors: errors, warnings: warnings, algorithm: algorithm || 'ZHL16C', params: params,
      table: [], stops: [], noDeco: false, ndl: null, firstStopDepth: null,
      totalRuntime: 0, totalDecoTime: 0, gasUsage: [], oxygen: { cns: 0, otu: 0 },
      profile: [], ceilingProfile: [], finalTissues: [],
    };
  }

  function plan(input) {
    input = input || {};
    const params = {
      gfLow: def(input.gfLow, 50),
      gfHigh: def(input.gfHigh, 80),
      vpmConservatism: def(input.vpmConservatism, 2),
      lastStopDepth: def(input.lastStopDepth, 6),
      surfacePressure: def(input.surfacePressure, 1.013),
      water: def(input.water, 'salt'),
    };
    const warnings = [];
    const algoOut = input.algorithm === 'ZHL16B' ? 'ZHL16B' : 'ZHL16C';
    const norm = normalize(input);
    if (norm.errors.length) return emptyResult(params, norm.errors, warnings, algoOut);
    const ctx = norm.ctx;

    // --- Descent and bottom/level segments ---
    const sim = makeSim(ctx, ctx.segments[0].gasId);
    for (let i = 0; i < ctx.segments.length; i++) {
      const seg = ctx.segments[i];
      sim.gasId = seg.gasId;          // travel into a level breathes that level's gas
      if (seg.depth > sim.depth + EPS) travelTo(sim, 'desc', seg.depth, ctx.descentRate);
      else if (seg.depth < sim.depth - EPS) travelTo(sim, 'asc', seg.depth, ctx.ascentRate);
      holdAt(sim, 'level', seg.levelTime);
    }
    // User-forced segments can rise above the live ceiling (e.g. a shallow
    // level planned between two deep ones). The schedule stays consistent —
    // tissues are tracked through the violation — but the plan deserves a
    // warning. Scan the bottom-phase samples (profile/ceilingProfile are
    // pushed pairwise) against the same ceiling the chart displays.
    let segViol = 0, segViolT = 0;
    const bottomSamples = sim.profile.length;
    for (let i = 0; i < bottomSamples; i++) {
      const v = sim.ceilingProfile[i].ceiling - sim.profile[i].depth;
      if (v > segViol) { segViol = v; segViolT = sim.profile[i].t; }
    }

    // --- Ascent: generate the schedule (NDL / staged deco) ---
    let noDeco = ceilingDepth(sim.pn, sim.ph, ctx.gfHi, ctx) <= EPS;
    let ndl = null;
    let decoStartRt = null;   // runtime on arrival at the first actual stop
    if (noDeco) {
      ndl = computeNdl(sim);
      ascendWithSwitches(sim, 0);
    } else {
      const candidate = firstStopCandidate(sim);
      sim.anchor = candidate;
      ascendWithSwitches(sim, candidate);
      let s = candidate;
      while (s > EPS) {
        // With lastStop=6 there is no 3 m stop: the 6 m stop clears the
        // obligation against the surface, then ascend directly.
        const next = s <= ctx.lastStop + EPS ? 0 : Math.max(s - ctx.stopInterval, ctx.lastStop);
        const arrivalRt = sim.runtime;
        const swg = bestSwitchGas(ctx, sim.depth, ctx.gases[sim.gasId]);
        if (swg) switchTo(sim, swg.id, ctx.switchHold);
        // Erik Baker's reference DECOMPRESSION_STOP loop HOLDS at every 3 m rung
        // from the first stop down to lastStop, computing the time needed to
        // clear the next rung. A rung whose next-depth ceiling is already clear
        // still gets the minimum stop time (computeStopMinutes enforces
        // mins >= minStop), not skipped. (The V-Planner/Subsurface optimization
        // of skipping already-clear rungs was the engine's one deviation from
        // strict Baker; removed for compliance. See docs/DECISIONS.md.)
        const gfNext = gfAt(next, sim.anchor, ctx);
        const hold = computeStopHold(sim, gfNext, next);
        if (hold === null) {
          return emptyResult(params, ['deco stop at ' + s + ' m does not clear within 999 minutes'], warnings, algoOut);
        }
        holdAt(sim, 'stop', hold);
        // stops[].time is the DecoPlanner-style whole-minute figure: stop-end
        // runtime minus the whole-minute boundary at/below arrival, so the
        // fractional inbound ascent leg is absorbed (24 m: arrive 32.33,
        // leave 33.00 -> 1 min). Always an integer >= minStopTime.
        const minStopEff = Math.max(1, Math.ceil(ctx.minStop - EPS));
        sim.stops.push({
          depth: s,
          time: Math.round(sim.runtime - floorMult(arrivalRt, minStopEff)),
          runtime: sim.runtime, gasId: sim.gasId,
        });
        if (decoStartRt === null) decoStartRt = arrivalRt;
        ascendWithSwitches(sim, next);
        s = next;
      }
    }

    // --- Aggregates: gas usage, oxygen toxicity, deco time ---
    const usage = new Map();
    ctx.gasList.forEach(function (g) { usage.set(g.id, 0); });
    let cns = 0, otu = 0;
    let maxPp = 0, maxBottomPp = 0, cnsExtrapolated = false;
    for (let i = 0; i < sim.rows.length; i++) {
      const r = sim.rows[i];
      const bottomPhase = r.phase === 'desc' || r.phase === 'level';
      const sac = bottomPhase ? ctx.sacBottom : ctx.sacDeco;
      const avgP = (pAmb(ctx, r.startDepth) + pAmb(ctx, r.endDepth)) / 2;
      usage.set(r.gasId, usage.get(r.gasId) + sac * avgP * r.duration);
      const avgPp = (r.ppO2Start + r.ppO2End) / 2;
      cns += r.duration * cnsRate(avgPp) * 100;
      if (avgPp > 0.5) otu += r.duration * Math.pow((avgPp - 0.5) / 0.5, 0.833);
      if (avgPp > 1.6 + 1e-9 && r.duration > 0) cnsExtrapolated = true;
      const rowMax = Math.max(r.ppO2Start, r.ppO2End);
      if (rowMax > maxPp) maxPp = rowMax;
      if (bottomPhase && rowMax > maxBottomPp) maxBottomPp = rowMax;
    }
    // Contract: totalDecoTime = stop time + ascent time above the first stop.
    // Computed as everything after arrival at the first actual stop (stops,
    // switch holds and ascent legs from there to the surface) — the same
    // convention as the VPM-B engine.
    const totalDecoTime = decoStartRt === null ? 0 : sim.runtime - decoStartRt;

    // --- Warnings ---
    if (maxBottomPp > 1.4 + 1e-9) warnings.push('ppO2 exceeds 1.4 bar on bottom gas (max ' + maxBottomPp.toFixed(2) + ' bar)');
    if (maxPp > 1.65 + 1e-9) warnings.push('ppO2 exceeds 1.65 bar (max ' + maxPp.toFixed(2) + ' bar)');
    let maxEnd = 0;
    ctx.segments.forEach(function (seg) {
      const e = end(seg.depth, ctx.gases[seg.gasId], { surfacePressure: ctx.sp, water: ctx.water });
      if (e > maxEnd) maxEnd = e;
    });
    if (maxEnd > 30 + EPS) warnings.push('END exceeds 30 m (max ' + maxEnd.toFixed(1) + ' m)');
    if (cnsExtrapolated) warnings.push('ppO2 above 1.6 bar; CNS clock extrapolated beyond the NOAA table');
    if (cns > 100) warnings.push('CNS oxygen toxicity exceeds 100% (' + cns.toFixed(0) + '%)');
    if (segViol > 0.5) {
      warnings.push('planned level rises ' + segViol.toFixed(1) + ' m above the decompression ceiling (t=' +
        segViolT.toFixed(0) + ' min); add decompression before the shallow level');
    }

    // --- Final tissue state ---
    const finalTissues = [];
    for (let i = 0; i < NC; i++) {
      const pt = sim.pn[i] + sim.ph[i];
      const a = pt > 0 ? (ctx.aN2[i] * sim.pn[i] + ctx.aHe[i] * sim.ph[i]) / pt : ctx.aN2[i];
      const b = pt > 0 ? (ctx.bN2[i] * sim.pn[i] + ctx.bHe[i] * sim.ph[i]) / pt : ctx.bN2[i];
      const m0 = ctx.sp / b + a;      // surfacing M-value
      finalTissues.push({
        pN2: sim.pn[i], pHe: sim.ph[i], pTotal: pt,
        gfSurfacePct: 100 * (pt - ctx.sp) / (m0 - ctx.sp),
      });
    }

    return {
      ok: true,
      errors: [],
      warnings: warnings,
      algorithm: ctx.variant === 'B' ? 'ZHL16B' : 'ZHL16C',
      params: params,
      table: sim.rows,
      stops: sim.stops,
      noDeco: noDeco,
      ndl: ndl,
      firstStopDepth: sim.stops.length ? sim.stops[0].depth : null,
      totalRuntime: sim.runtime,
      totalDecoTime: totalDecoTime,
      gasUsage: ctx.gasList.map(function (g) {
        return { gasId: g.id, fO2: g.fO2, fHe: g.fHe, liters: usage.get(g.id) };
      }),
      oxygen: { cns: cns, otu: otu },
      profile: sim.profile,
      ceilingProfile: sim.ceilingProfile,
      finalTissues: finalTissues,
    };
  }

  return {
    VERSION: VERSION,
    plan: plan,
    gasName: gasName,
    surfaceInterval: surfaceInterval,
    mod: mod,
    end: end,
    ead: ead,
    bestMix: bestMix,
    _internal: {
      PH2O: PH2O,
      HT_N2: HT_N2, A_N2: A_N2, B_N2: B_N2,
      HT_HE: HT_HE, A_HE: A_HE, B_HE: B_HE,
      A_N2_B: A_N2_B, B_N2_B: B_N2_B, A_HE_B: A_HE_B, B_HE_B: B_HE_B,
      initTissues: initTissues,
      loadConstant: loadConstant,
      loadTravel: loadTravel,
      maxTolAmb: maxTolAmb,
      ceilingDepth: ceilingDepth,
      gfAt: gfAt,
      cnsRate: cnsRate,
      makeCtxLite: function (sp, water) {
        return { sp: sp, mpb: mpbFor(water || 'salt'),
                 aN2: A_N2, bN2: B_N2, aHe: A_HE, bHe: B_HE };
      },
    },
  };
});
