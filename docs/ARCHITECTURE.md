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
`gases:[{id,fO2,fHe,type}]`, `sacBottom`/`sacDeco`, and optionally
`customStops:[{depth,time,gasId}]` (verify mode — see below).

**`result`:** `ok`, `errors[]`, `warnings[]`, `algorithm`, `params` (echo),
`table[]` (every movement; `phase ∈ desc|level|asc|switch|stop`, with
`startDepth/endDepth/duration/runtime/gasId/ppO2Start/ppO2End`), `stops[]`,
`noDeco`, `ndl`, `firstStopDepth`, `totalRuntime`, `totalDecoTime`,
`gasUsage[]` (surface-equivalent liters per gas), `oxygen:{cns,otu}`,
`profile[]` (fine samples ≤0.5 min), `ceilingProfile[]`, `finalTissues[]` (16
compartments; `gfSurfacePct` for ZHL, `null` for VPM), and `verify` (verify mode
only, else `null`).

**Verify mode (editable runtime table).** If `input.customStops` (ordered
deepest→shallowest `[{depth,time,gasId}]`) is present, `plan()` *replays that
exact deco schedule* instead of generating one — each row's gas is breathed
travelling up to and held at that depth; the final ascent uses the last row's
gas. No auto-switching, no re-optimization (verify-exact); off-grid/out-of-order
depths are accepted and replayed. The generate path is untouched (it runs
whenever `customStops` is absent). The result then carries
`verify = { safe, maxCeilingExceedance (m above ceiling, 0 if clear),
firstViolationDepth, firstViolationTime }` and a "ceiling" warning when unsafe.
Both engines implement this additively (ZHL: `replayCustomStops`; VPM-B:
`replayCustomStopsVPM`, which reuses the start-of-ascent gradients and skips the
CVA loop). The UI seeds editable rows from a computed plan with
`seedCustomStopsFromResult` in `app.js`: one row per held depth, deepest-first,
where a **gas SWITCH pins its (new) gas to the switch depth** (e.g. EAN50 at its
21 m switch, O₂ at its 6 m switch) and contributes its 1-min switch hold, and a
STOP adds hold time. Pinning the gas to the switch depth — not the next stop
down — is what keeps the deco gas in the right row when editing; the matching
test helpers in `tests/zhl16.test.js` / `tests/vpmb.test.js` mirror this exactly
and a regression test asserts the placement. The replay itself **travels on the
current gas and switches on arrival** at each stop (not before ascending), so a
deco gas is never breathed below its switch depth and the chart's gas-switch
marker sits at the real switch depth — see DECISIONS.md. A custom schedule is
**kept and re-verified** when dive inputs change (not auto-cleared), and RESET TO
COMPUTED clears `customStops` back to the generated plan.

**FIX DECO (auto-add stops).** When an edited schedule is unsafe, instead of
only flagging the offending row red the UI offers a `FIX DECO` action
(`fixDeco()` in `app.js`). It runs the engine in generate mode
(`computeSafeStops()`), then merges that safe schedule into the user's edits —
**adding** any missing stop depths and **extending** stops that are too short,
never shortening a stop the diver lengthened — and shows a "what changed" note
(`showFixNote`). The red `row-violation` styling and verdict chip remain so the
gap is still visible until fixed.

**Both engines implement these behaviors identically — change one, mirror the
other:** travel at descent/ascent rates; `segmentTimesIncludeTravel` deducts
travel-in time from a level; stops at `stopInterval` multiples with the
shallowest = `lastStopDepth`; integer (ceil'd) stop minutes; deco-gas
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
  stop is allowed when the ceiling evaluated at the *next* stop's `gf` clears
  that depth. The first stop is found by pre-simulating the ascent on cloned
  tissues and deepening if off/on-gassing during the ascent moves the ceiling.
- Public helpers (also used by the UI): `gasName`, `mod`, `end` (END, O₂
  narcotic), `ead`, `bestMix`; plus `_internal` for tests.

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
(`{name, ts, dive:{segments, gases, customStops, settings}}`), separate from the
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
