# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

HALDANE is a multi-gas technical **dive decompression planner** that runs entirely in the browser: plain HTML/CSS/JS (ES5-style, `var` + function expressions), **zero dependencies, no build step, no network calls**. It implements two decompression models — Bühlmann ZHL-16C + gradient factors, and VPM-B — and a cylinder/gas-supply planner. Deployed to GitHub Pages: <https://vbarba.github.io/web-decoplanner/>.

This is educational software. The README opens with a safety disclaimer; keep it intact and do not weaken it.

## Further documentation

Read these before non-trivial work — they capture context that isn't obvious from the code:

- `docs/ARCHITECTURE.md` — module map, the engine `plan(input)->result` contract, ZHL/VPM-B internals, the UI orchestration flow, and the UI-only gas-supply layer.
- `docs/DESIGN.md` — the "abyssal instrument console" UI/UX direction, design tokens, typography, motion, charts, and accessibility baseline.
- `docs/DECISIONS.md` — log of notable decisions and *why* (native `<select>` over a custom listbox, the VPM-B radius-factor fix, engine corrections), so they aren't relitigated.

## Commands

```sh
# Run — no install, no build:
open index.html                 # open directly, or…
python3 -m http.server 8741     # serve, then visit http://localhost:8741

# Tests — plain Node scripts, no framework, no packages:
node tests/zhl16.test.js        # Bühlmann engine suite (incl. deco-edit seed/placement)
node tests/vpmb.test.js         # VPM-B suite (incl. Baker VPMDECO reference + Subsurface benchmarks)
node tests/i18n.test.js         # i18n key-parity + fallback + browser detection
node js/ui/charts.js            # charts self-check (silent on success, exit 0)
```

Each test file prints `PASS`/`FAIL` per check, `ALL TESTS PASSED` at the end, and exits non-zero on any failure. There is **no single-test runner** — to run one check, comment out the others or add an early `process.exit` (the file is a flat sequence of `check(name, cond, info)` calls inside IIFEs). Deploy is automatic via `.github/workflows/deploy-pages.yml` on push to `main`.

## Architecture

Five files load in order (see `index.html`), each attaching one global; `js/ui/app.js` orchestrates:

| File | Global | Role |
| --- | --- | --- |
| `js/engine/zhl16.js` | `window.DecoEngine` | Bühlmann ZHL-16C + gradient factors |
| `js/engine/vpmb.js` | `window.VPMB` | VPM-B (critical-volume algorithm + Boyle compensation) |
| `js/ui/charts.js` | `window.Charts` | SVG charts built via DOM (no canvas/libs) |
| `js/ui/i18n.js` | `window.I18N` | UI-chrome + tooltip translations (en/es/fr/de/zh) |
| `js/ui/app.js` | — | Form state, input building, engine dispatch, result rendering |

**The shared engine contract is the spine of the codebase.** Both engines expose `<NS>.plan(input) -> result` with identical shapes, so the UI treats them interchangeably. When changing one engine's behavior, the **other engine and the UI must stay consistent with the same contract** — the engines share the same `result` shape and the same schedule conventions for the canonical cases (stop ladder, gas auto-switch at MOD, `lastStopDepth` handling, CNS/OTU, gas-usage formula, profile sampling). There is **one documented, intentional difference** that is *not* mirrored: NDL semantics (ZHL reports at the final/shallowest depth, VPM-B at the controlling/deepest depth) — see `docs/DECISIONS.md` before "fixing" it. Both engines now **hold ≥ `minStopTime` at every 3 m rung** (strict Erik-Baker `DECOMPRESSION_STOP`; ZHL's former V-Planner-style "skip already-clear rung" path was removed — see `docs/BAKER-GF-COMPLIANCE.md`); they may still place the *first stop* at different depths because they are different models (Bühlmann-GF vs VPM-B critical-volume), which is expected. The canonical description of `input` and `result` is the block comment near the top of `js/engine/zhl16.js`; `result` carries `ok/errors/warnings`, `table` (row `phase`: `desc|level|asc|switch|stop`), `stops`, `gasUsage`, `oxygen` (cns/otu), `profile`, `ceilingProfile`, `finalTissues`.

**Module pattern:** every JS file is a UMD-style IIFE — attaches its global in the browser AND `module.exports` under Node (so engines are unit-testable). Engines also export `_internal`/`_test` objects for the suites. Keep this dual-mode pattern; do not introduce ES modules, npm, or a bundler.

**Charts mount into `#profile-chart` and `#tissue-chart`** via `Charts.renderProfile(el, result, {units})` and `Charts.renderTissues(el, result, {units})`, reading only contract fields.

**Graceful degradation:** `app.js` guards every external (`hasEngine`/`hasVPM`/`hasCharts`). If `DecoEngine` is missing it renders a clearly-labeled MOCK result and shows an offline banner; if `VPMB`/`Charts` are missing it disables/hides those features. The page must never throw on load.

## Conventions that span files

- **All internal math is metric**, regardless of the metric/imperial UI toggle: depth in **msw**, time in **minutes**, pressure in **bar absolute**, gas fractions 0..1, volumes in surface-equivalent **liters**. Imperial is a display-layer conversion only — state and engine calls stay metric; `app.js` converts on input/output.
- Respiratory water vapor **PH2O = 0.0627 bar** (Bühlmann); alveolar inert pressure uses `(Pamb − PH2O)`.
- Depth↔pressure: **10 msw per bar (salt), 10.3 msw per bar (fresh)**. Surface saturation: `pN2 = (Psurf − PH2O) × 0.79`, helium 0.
- **Cylinder / gas-supply planning is UI-only.** `buildInput()` in `app.js` strips cylinder, start-pressure, and reserve-rule fields — the engines only ever see `gases:[{id,fO2,fHe,type}]` and compute surface-equivalent liters per gas. Tank pressure math (need = litersUsed ÷ cylinder volume, vs. a reserve subtracted from start pressure) lives entirely in `app.js` (`gasSupply`, `CYL_PRESETS`, `RESERVE_RULES`). Reserve rules are either fraction-based (thirds/half/none) or the profile-derived **min-gas / rock-bottom** rule (`minGasReserve` + `supplyContext`: gas for two divers to ascend deepest→first-switch ×2, applied to the bottom gas); a configurable fixed `extraReserveBar` (default 40 bar) is added on top of every rule, on every gas. Changing supply behavior does not touch the engines or invalidate engine tests.
- **Decompression constants and parameterizations must be verifiable against published sources** (Erik Baker's papers/VPMDECO, Subsurface `deco.c`, NOAA O₂ tables). The VPM-B benchmark/parameterization constants (e.g. `BENCHMARK_RADIUS_FACTOR`, `LAMBDA_FSW_MIN`) are pinned by tests against Subsurface `testplan.cpp` values; if you change them, update both the comment citing the source and the regression test. Note the `VPMB.VERSION` string can drift from the actual constants — trust the code, and fix the string if you touch them.

## Form/UI specifics

- `app.js` is one large IIFE. State lives in a single `state` object, persisted to `localStorage` key `haldane-plan-v1`; `loadState()` migrates older saved plans field-by-field (tolerate and default missing fields — do not assume a stored plan has newer fields like `cyl`/`startBar`/`gasReserve`).
- Inputs use delegated listeners on `#segments-body` / `#gases-list` keyed by `data-seg`/`data-gas` + `data-field`; validation is driven by `data-vkey` (see `applyValidation`, which toggles `.invalid` on any `.rail [data-vkey]`).
- Dropdowns are **native `<select>`** by deliberate choice — a custom-listbox replacement was tried and reverted because the custom popup broke on real clicks; only the dark/phosphor `<option>` styling that browsers honor is applied. Prefer native form controls.
- **Saved dives** are UI-only, in `localStorage['haldane-dives-v1']` (separate from the auto-saved current plan). Each is a full snapshot `{name, ts, dive:{segments, gases, settings}}` minus units/language. See `snapshotCurrentDive`/`applyDive`/`saveDive`/`exportDives`/`importDives`; `applyDive` reuses the `coerceState` validation shared with `loadState`.
- **i18n is UI-chrome + tooltips only** (`js/ui/i18n.js`, `window.I18N`); engine warnings/errors stay English. `applyI18n()` in `app.js` walks `data-i18n` (text), `data-i18n-title` (tooltip), `data-i18n-ph` (placeholder). Default language = browser (`I18N.detect()`), overridable via `#lang-select`, persisted in `state.lang`. When adding a UI string, add the key to **all 5** language dicts (the `tests/i18n.test.js` parity check enforces this) and tag the element with `data-i18n`.
- **The runtime table always regenerates** — it is read-only and re-planned from the active engine on every settings change. There is no EDIT DECO / verify mode (it was removed from both engines and the UI; see `docs/DECISIONS.md`).
- **Per-field tooltips:** every rail input/label carries a `title` plus a `data-i18n-title="tipf.*"` key (15 `tipf.*` keys, translated in all 5 languages in `js/ui/i18n.js`). When adding a rail field, add its `tipf.*` tooltip to every language dict too.
