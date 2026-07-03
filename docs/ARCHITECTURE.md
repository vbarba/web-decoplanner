# HALDANE — architecture deep-dive

Plain HTML/CSS/JS, zero dependencies, no build step, no network. Five JS files
load in order (see `index.html`), each a UMD-style IIFE that attaches one global
in the browser and `module.exports` under Node. `js/ui/app.js` orchestrates.

```
index.html ──loads──▶ js/engine/zhl16.js  → window.DecoEngine
                      js/engine/vpmb.js   → window.VPMB
                      js/ui/charts.js     → window.Charts
                      js/ui/i18n.js       → window.I18N   (UI translations)
                      js/ui/app.js        (orchestrator; no global)
css/styles.css        all styling
tests/zhl16.test.js   node, no framework
tests/vpmb.test.js    node, no framework
tests/i18n.test.js    node, no framework
```

**Three-column layout.** The `.layout` grid is `rail | results | charts-col`:
inputs on the left, runtime table + tiles + gas requirements in the middle, and
the Dive-profile and Tissue-loading charts in a dedicated right column. Below
~1320 px the charts column drops under the results; below ~980 px everything
stacks. Both `.results` and `.charts-col` participate in the reveal/stale
animations (see `revealPanels()` / the `.stale` toggle in `renderResults`).

## The engine contract (the spine)

Both engines expose **`<NS>.plan(input) -> result`** with identical shapes, so
`app.js` and `charts.js` treat them interchangeably. The authoritative,
field-by-field description of `input` and `result` is the block comment at the
top of `js/engine/zhl16.js` — read it before touching either engine. Summary:

**`input`** (built by `buildInput()` in `app.js`):
`algorithm`, `gfLow`/`gfHigh` (ZHL) or `vpmConservatism` (VPM), `surfacePressure`
(bar), `water` (`salt`/`fresh`), `descentRate`/`ascentRate`, `stopInterval`,
`lastStopDepth` (3 or 6), `minStopTime`, `gasSwitchStopTime`, `ppO2MaxDeco`,
`segmentTimesIncludeTravel`, `segments:[{depth,time,gasId}]`,
`gases:[{id,fO2,fHe,type}]`, `sacBottom`/`sacDeco`, and optional
`initialTissues` (16 × `{pN2,pHe}` in bar — a repetitive-dive seed in the
`finalTissues` shape; absent → surface air saturation). Each engine always
*generates* its schedule from these inputs — there is no replay/verify path.

**`result`:** `ok`, `errors[]`, `warnings[]`, `algorithm`, `params` (echo),
`table[]` (every movement; `phase ∈ desc|level|asc|switch|stop`, with
`startDepth/endDepth/duration/runtime/gasId/ppO2Start/ppO2End`), `stops[]`,
`noDeco`, `ndl`, `firstStopDepth`, `totalRuntime`, `totalDecoTime`,
`gasUsage[]` (surface-equivalent liters per gas), `oxygen:{cns,otu}`,
`profile[]` (fine samples ≤0.5 min), `ceilingProfile[]`, and `finalTissues[]` (16
compartments; `gfSurfacePct` for ZHL, `null` for VPM).

**The runtime table always shows the engine's freshly-computed schedule.** There
is no edit/verify mode: the table is read-only and `app.js` re-plans (regenerates
the whole schedule) on every settings change, so what you see is always exactly
what the active engine generates from the current inputs. (An earlier "EDIT DECO"
verify flow — `input.customStops` replay + a `verify` verdict — was removed from
both engines and the UI; see DECISIONS.md.)

**Both engines share the same result shape and the same scheduling conventions
for the canonical cases — change one, mirror the other** (with one documented,
intentional exception: NDL semantics; see "Known engine differences" below and
DECISIONS.md): travel at
descent/ascent rates; `segmentTimesIncludeTravel` deducts
travel-in time from a level; stops at `stopInterval` multiples with the
shallowest = `lastStopDepth`; **stop ends on whole-minute runtime boundaries**
(Baker/DecoPlanner runtime rounding — a fractional lead-in absorbs the inbound
ascent leg, then whole `minStopTime` increments until the next rung clears;
`stops[].time` is the DecoPlanner-style integer, `table` rows carry the true
fractional hold); deco-gas
auto-switch at MOD on ascent (never to a leaner gas); CNS via the NOAA table
(linear rate interpolation, extrapolated + warned above ppO₂ 1.6); OTU =
`Σ duration·((avgPpO2−0.5)/0.5)^0.833`; gas usage = `Σ sac·avgPamb·duration`.

## ZHL-16C engine (`js/engine/zhl16.js`)

Bühlmann 16-compartment model with Erik Baker gradient factors. Ships both the
ZHL-16C (default) and ZHL-16B nitrogen `a` coefficient sets; `plan()` selects per
call via `input.algorithm === 'ZHL16B'` (resolved in `normalize`, threaded as
`ctx.aN2/bN2/aHe/bHe`). The two variants share half-times, helium coefficients,
N₂ `b`, and all kinetics — they differ only in the N₂ `a` values at compartments
5–15 (B is stiffer there). `result.algorithm` echoes `'ZHL16B'` or `'ZHL16C'`.

- Tissue primitives operate on plain arrays `pn[16]`, `ph[16]`: `loadConstant`
  (Haldane, constant depth) and a Schreiner solution for constant-rate depth
  changes. Track N₂ and He separately; combine per-compartment `a`/`b` weighted
  by partial pressures.
- **GF-adjusted ceiling** (Baker): tolerated ambient pressure
  `(pComp − a·gf)/(gf/b + 1 − gf)`; `gf=1` reduces to the raw Bühlmann M-value.
- **GF slope:** the first stop is found at `gfLow`, then `gf` interpolates
  linearly from `gfLow` at the first stop to `gfHigh` at the surface. Leaving a
  that depth. The first stop uses a **dynamic / continuous ceiling**
  (Subsurface/DecoPlanner): seeded at the static `gfLow` round-up, then walked
  **down** rung by rung on cloned tissues, recomputing the live ceiling at each
  rung, stopping at the last rung still clear — lands one rung shallower than
  Baker's static round-up where off-gassing during the ascent recedes the ceiling
  (see `docs/BAKER-GF-COMPLIANCE.md`).
- Public helpers (also used by the UI): `gasName`, `mod`, `end` (END, O₂
  narcotic), `ead`, `bestMix`, and `surfaceInterval(tissues, minutes, opts)` —
  off-gasses a `finalTissues`-shaped array on air at the surface, returning the
  seed for the next dive's `input.initialTissues`; plus `_internal` for tests.

## VPM-B engine (`js/engine/vpmb.js`)

Varying Permeability Model with Boyle's-law compensation and the Critical Volume
Algorithm. The file's header comment is the source of truth for constants and
their provenance (verified June 2026 against Subsurface `core/deco.cpp` and Erik
Baker's VPM-B FORTRAN as ported in `bwaite/vpmb`, with URLs). Key points:

- Same 16 half-times and Schreiner/Haldane kinetics as ZHL, but a bubble-
  nucleation model instead of M-values.
- **Pipeline** (`runPipeline`): simulate descent+bottom while tracking crushing
  pressure → nuclear regeneration + initial allowable gradients → **critical
  volume loop** (iterate the schedule until the per-compartment phase-volume
  time converges) → final ascent with sampling.
- **Boyle compensation** (the "B"): shallow-stop gradients are reduced by
  solving `g³ − B·g − C = 0`; makes shallow stops longer. Disabled via the
  internal `boyleCompensation:false` flag in tests.
- **Conservatism +0..+5** scales the initial critical radii by
  `[1.00,1.05,1.12,1.22,1.35,1.50]` (V-Planner mapping).
- `gfSurfacePct` is `null` in `finalTissues` (no GF concept); the tissue chart
  falls back to pressure-vs-ambient.

### Parameterization constants are pinned by tests

VPM-B benchmark constants (`BENCHMARK_RADIUS_FACTOR = 1.012`, `LAMBDA_FSW_MIN =
6500`, etc.) are validated against Subsurface `testplan.cpp` runtimes and Baker's
VPMDECO.OUT (via internal `_lambdaFswMin`/`_critRadius*` overrides). **If you
change a constant, update the citing comment AND the regression test.** Note the
`VPMB.VERSION` string can lag the actual constants — trust the code; fix the
string when you touch them.

## Known engine differences (intentional)

The two engines share the contract and agree on the canonical schedules, but one
behavior differs **on purpose** (reviewed in a correctness audit and kept by
maintainer decision — see DECISIONS.md for the full rationale):

- **NDL semantics.** ZHL's `computeNdl` returns the remaining no-deco minutes at
  the *final (shallowest)* bottom-phase depth; VPM-B binary-searches added time on
  the *deepest* segment until deco appears (the conventional controlling-depth
  NDL). They agree closely on single-segment dives but diverge on multilevel
  no-deco dives (e.g. `[30 m/8 min, 12 m/5 min]` air → ZHL `ndl=81`, VPM `ndl=9`).

A second former difference — **already-clear intermediate rung** — was **resolved**:
both engines now **hold** ≥ `minStopTime` at every 3 m rung from the first stop down
to `lastStopDepth` (Baker-strict `DECOMPRESSION_STOP`). ZHL's earlier V-Planner-style
"skip already-clear rung" path was removed for strict Erik-Baker GF compliance — see
[BAKER-GF-COMPLIANCE.md](./BAKER-GF-COMPLIANCE.md). The engines may still place the
*first stop* at different depths because they are different models (Bühlmann-GF
dynamic-ceiling vs VPM-B critical-volume), which is expected.

(Three smaller cross-engine conventions — `minStopTime` ceiling, ladder-up to an
absolute stop-interval grid, and accepting a 0 m / 0-min segment — *were* aligned
to ZHL and are covered by a parity test in `tests/vpmb.test.js`.)

## Charts (`js/ui/charts.js`)

Pure SVG via DOM APIs. `Charts.renderProfile(el, result, {units})` and
`Charts.renderTissues(el, result, {units})` mount into `#profile-chart` and
`#tissue-chart`. Read only contract fields; clear+rebuild on each call; never
throw on contract-valid-but-degenerate data. Includes a Node-only self-check
(run `node js/ui/charts.js`). Visual spec is in [DESIGN.md](./DESIGN.md).

## UI orchestrator (`js/ui/app.js`)

One large IIFE, organized into commented sections: Constants → State → DOM/format
helpers → Units (display-only) → State persistence → `buildInput()` → MOCK →
oxygen helpers → Validation → left-rail rendering → Plan execution →
result rendering → COPY → wiring/init. Flow:

1. **State** — a single `state` object holds the whole plan; persisted to
   `localStorage['haldane-plan-v1']`. `loadState()` migrates older saved plans
   field-by-field and **defaults missing fields** — never assume a stored plan
   has newer fields (`cyl`, `startBar`, `gasReserve`).
2. **Input** — `buildInput()` produces the exact contract `input`. It
   deliberately **omits** cylinder/start-pressure/reserve fields: those are UI-
   only (see below).
3. **Dispatch** (`runPlan`) — calls `window.VPMB.plan` or `window.DecoEngine.plan`
   per `state.algorithm`. Guards `hasEngine`/`hasVPM`; if `DecoEngine` is absent
   it renders a clearly-labeled **MOCK** result and an offline banner so the page
   never throws.
4. **Render** — `renderResults` → tiles, table, gas-usage cards, warnings,
   charts. After the first success, `onStateChanged` re-plans on a 300 ms
   debounce.
5. **Inputs** — delegated listeners on `#segments-body`/`#gases-list` keyed by
   `data-seg`/`data-gas` + `data-field`. Validation toggles `.invalid` on any
   `.rail [data-vkey]` element (`applyValidation`).

### Repetitive dives (multi-dive plans) are orchestrated in the UI

The Dive panel carries a tab strip (`#dive-tabs`): DIVE 1, DIVE 2, …, `+` to add
a dive (a deep copy of the last one, default 60 min surface interval), `✕` to
remove the active one. `state.dives[i] = {si, dive}` where `dive` is a saved-dive
snapshot and `si` is the surface interval in minutes **before** that dive; the
top-level `state` is always the ACTIVE dive's working copy, mirrored into its
record by `syncActiveDive()` on every save. Tab switches reuse `applyDive`.

Tissue carry-over (`carriedTissues()` in `app.js`): dives `1..k−1` are re-planned
in order — each with its **own** settings, gases, and engine — and each result's
`finalTissues` is decayed through the surface interval with
`DecoEngine.surfaceInterval()`, then fed to the next dive as
`input.initialTissues`. The chain result is cached and invalidated only on
dive/SI structure changes (editing the active dive never changes what was
carried into it). If a previous dive fails to plan, the active dive renders an
error naming it. Saved-dive records of a multi-dive plan carry the whole
sequence (`dive.dives` + `activeDive`) and restore it on load; single-dive
records are unchanged (backward compatible).

Note the VPM-B caveat: only tissue loadings are carried between dives — the
bubble state (crushing pressure, regenerated nuclei) starts fresh each dive,
the standard simplification for VPM repetitive planning.

**Surface-interval desaturation factor** (`state.surfaceDesatMult`, **UI default
0.75**, the SI DESAT × field in Deco Settings): passed to `surfaceInterval()` as
`opts.desatMult`. It divides the elimination half-time only for compartments
that are off-gassing at the surface (Bühlmann pulmonary shunt). 1.0 is standard
symmetric ZH-L16 — identical to Subsurface's `buehlmann_config.desatmult`
default; **0.75 reproduces DecoPlanner's repetitive-dive schedules** (slower
off-gassing → more residual load → longer next-dive deco) and is the app's
default so multi-dive plans match DecoPlanner out of the box. (The *engine*
helper `surfaceInterval` still defaults `desatMult` to 1.0 — the contract-level
default stays plain ZH-L16; only the UI opts into 0.75.) Plan-wide, applied to
every surface interval in the chain; it never affects dive 1 (no interval before
it). Persisted at top level, not in per-dive snapshots.

### Cylinder / gas-supply planning is UI-only

Tank size, start pressure, and reserve rule live entirely in `app.js`
(`CYL_PRESETS`, `RESERVE_RULES`, `gasSupply`, `renderGasUsage`). The engines only
ever receive `gases:[{id,fO2,fHe,type}]` and return surface-equivalent liters per
gas; `app.js` converts liters → required pressure (`need = litersUsed ÷ cylinder
liters`) and compares against the usable fraction of the start pressure. **This
means supply changes never touch the engines or invalidate engine tests**, and a
reserve/start-pressure change re-renders cards *without* re-planning.

The rail boxes are split by concern: **Dive** (profile), **Gases**, **Deco
Settings** (algorithm + GF/VPM, rates, last stop, water, surface, ppO₂, travel
toggle), **Gas Planning** (SAC, reserve rule, extra reserve), and **Saved
Dives**. All but Dive are collapsible `<details class="panel collapsible">`;
Gases starts collapsed, the rest open. Each box title carries a `title` /
`data-i18n-title` tooltip explaining the box.

### Saved dives are UI-only too

`localStorage['haldane-dives-v1']` holds named full-snapshot plans
(`{name, ts, dive:{segments, gases, settings}}`), separate from the
auto-saved current plan. `snapshotCurrentDive` / `applyDive` / `saveDive` /
`deleteDive` / `exportDives` / `importDives` in `app.js` manage it; `applyDive`
reuses the same defensive coercion as `loadState` (factored into `coerceState`).
Units and language are **excluded** from a snapshot — they are display
preferences, not part of a dive.

### Internationalization (`js/ui/i18n.js`)

UI chrome and tooltips (not engine output) are translated into 5 languages
(en/es/fr/de/zh). `window.I18N.t(key)` looks up the active language, falling back
to English then to the raw key. `app.js` translates in place by walking elements
carrying `data-i18n` (textContent), `data-i18n-title` (tooltip) and
`data-i18n-ph` (placeholder) in `applyI18n()`. The language defaults to the
browser (`I18N.detect()`), is overridable via the top-bar `#lang-select`, and the
explicit choice persists in `state.lang`. `tests/i18n.test.js` locks key parity
across all languages plus fallback/detection. Engine warnings/errors stay in
English by design.

## Units

All internal math is **metric** (msw, minutes, bar absolute, liters); imperial is
a display-layer conversion in `app.js` only. Physical conventions shared by both
engines: PH2O `0.0627` bar, `(Pamb − PH2O)` for inspired inert pressure,
`10 msw/bar` salt / `10.3` fresh, surface saturation `pN2=(Psurf−PH2O)·0.79`.

## Tests

`tests/*.test.js` are flat Node scripts: a `check(name, cond, info)` helper, a
sequence of assertions inside IIFEs, `ALL TESTS PASSED` + `process.exit(0/1)`.
No framework, no single-test runner (comment out checks or early-exit to isolate
one). They `require()` the engine modules and use the engines' `_internal`/`_test`
exports. VPM tests include a Baker VPMDECO reference dive and Subsurface
benchmark dives. `tests/i18n.test.js` requires `js/ui/i18n.js` and verifies key
parity across all 5 languages, the English fallback, and browser detection.

## Deploy

`.github/workflows/deploy-pages.yml` publishes the repo root to GitHub Pages on
push to `main` (and `workflow_dispatch`). Static; no build. `.nojekyll` keeps
Pages from touching `js/`. Live: <https://vbarba.github.io/web-decoplanner/>.
