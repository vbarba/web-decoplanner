# HALDANE — Decompression Planner

**Live app: <https://vbarba.github.io/web-decoplanner/>**

> ## ⚠️ SAFETY DISCLAIMER — READ FIRST
>
> **HALDANE is educational software. It has NEVER been validated for real dive
> planning and must not be used to plan, conduct, or verify any actual dive.**
> Decompression diving carries a risk of serious injury and death. It requires
> formal training, and real dives must be planned with validated decompression
> tables or dive computers and conducted within the limits of your training and
> certification. The schedules this tool produces are unverified model output —
> trust nothing here with your life.

HALDANE is a multi-gas technical dive decompression planner that runs entirely
in the browser: plain HTML/CSS/JS, zero dependencies, no build step, no network
calls. It implements two decompression models side by side:

- **Bühlmann ZHL-16C with gradient factors** (GF low/high, 5–100)
- **VPM-B** (Varying Permeability Model with Boyle compensation and critical
  volume algorithm) with conservatism levels **+0 to +5**

## Features

- Multi-level dive profiles (multiple depth/time segments, per-segment gas)
- Multiple gases with bottom/deco roles, MOD @ ppO₂ and END readouts, and
  common presets (Air, EAN32, EAN50, O₂, 21/35, 18/45, 15/55, 12/65, 10/70)
- Full runtime table: descent, level, ascent, gas-switch, and stop rows with
  per-row ppO₂, plus one-click copy to clipboard
- **Live runtime table** — the minute-by-minute decompression schedule
  regenerates automatically whenever you change any input, always showing the
  schedule the active engine computes from your current profile, gases, and
  settings
- Dive profile chart (depth vs. runtime) with the live ceiling overlay and
  gas-switch markers; tissue-loading bar chart for all 16 compartments
  (N₂ + He stacked)
- CNS% and OTU oxygen-toxicity tracking with advisories (e.g. ppO₂ > 1.6 bar)
- Gas consumption planning from separate bottom/deco SAC rates
- **Cylinder / gas-supply planning** — assign each gas a tank configuration
  (AL80/S80, AL40, AL30, AL13 pony, 10/12/15/18 L singles, and twin sets
  2×10 / 2×11 / 2×12 / 2×15 / 2×18 L) and a start pressure, choose a reserve
  rule (rule of thirds, half + half, no reserve, or **min gas / rock bottom** —
  the gas two divers need to ascend from the deepest point to the first gas
  switch, ×2), plus a configurable fixed **extra reserve** (default 40 bar)
  added on top of every rule. The planner shows the pressure each cylinder
  needs, whether you have enough under the reserve, the spare/shortfall in bar
  (or psi), and the minimum fill to make the dive — raising an alert when any
  gas is short
- Metric / imperial display toggle (internal math is always metric)
- Settings: descent/ascent rates, last stop 3 m or 6 m, salt/fresh water,
  surface pressure, deco ppO₂ limit, SAC rates, and whether stated segment
  times include travel
- Plans recalculate live on every input change; state persists in
  `localStorage`; responsive single-column layout on phones

## Running

No install, no build:

```sh
# either open the file directly…
open index.html

# …or serve the directory with any static server:
python3 -m http.server 8741
# then visit http://localhost:8741
```

## Tests

Node only (no test framework, no packages):

```sh
node tests/zhl16.test.js     # Bühlmann engine suite
node tests/vpmb.test.js      # VPM-B engine suite (incl. Baker VPMDECO reference)
node js/ui/charts.js         # charts self-check (silent on success, exit 0)
```

## Architecture

> Deeper docs live in [`docs/`](./docs): [ARCHITECTURE.md](./docs/ARCHITECTURE.md)
> (module map, engine contract, internals), [DESIGN.md](./docs/DESIGN.md)
> (UI/UX direction and tokens), and [DECISIONS.md](./docs/DECISIONS.md)
> (why notable choices were made).

| File | Global | Role |
| --- | --- | --- |
| `index.html` | — | Page shell, form markup, script tags |
| `css/styles.css` | — | All styling, responsive layout |
| `js/engine/zhl16.js` | `window.DecoEngine` | Bühlmann ZHL-16C + gradient factors |
| `js/engine/vpmb.js` | `window.VPMB` | VPM-B with CVA + Boyle compensation |
| `js/ui/charts.js` | `window.Charts` | SVG charts: `renderProfile(el, result, {units})`, `renderTissues(el, result, {units})` |
| `js/ui/app.js` | — | Form state, input building, engine dispatch, result rendering |

Both engines expose the same contract: `<NS>.plan(input) -> result`, where
`result` carries `ok/errors/warnings`, `table` (row phases: `desc`, `level`,
`asc`, `switch`, `stop`), `stops`, `gasUsage`, `oxygen` (CNS/OTU), `profile`,
`ceilingProfile`, and `finalTissues`. The UI builds `input`, calls the selected
engine, and renders the result; charts mount into `#profile-chart` and
`#tissue-chart`. Engine files also work under Node via `module.exports` for
the test suites.

### Units conventions

- **All internal math is metric**: depth in msw, time in minutes, pressure in
  **bar absolute**, gas volumes in liters. Imperial is a display-layer
  conversion only.
- Respiratory water vapor pressure **PH2O = 0.0627 bar** (Bühlmann convention);
  alveolar inert-gas pressure uses `(Pamb − PH2O)`.
- Depth/pressure conversion: **10 msw per bar in salt water, 10.3 msw per bar
  in fresh water**.
- Surface tissue saturation: `pN2 = (Psurf − PH2O) × 0.79`, helium 0.
