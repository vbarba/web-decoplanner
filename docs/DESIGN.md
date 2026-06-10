# HALDANE — UI / UX design decisions

This document records the *why* behind the interface so future work stays
coherent with the established direction. For code structure see
[ARCHITECTURE.md](./ARCHITECTURE.md); for the running log of notable choices see
[DECISIONS.md](./DECISIONS.md).

## Concept: "abyssal instrument console"

The interface is a **precision instrument for technical divers**, not a generic
dashboard. The whole page *is* the water column: a vertical gradient from dim
surface light (`--surface-glow #0d2236`) down into abyssal black
(`--abyss #04070d`). Data glows like phosphor on a dark display. The aesthetic is
committed and specific — when adding UI, match this language rather than
defaulting to neutral/material patterns.

Signature details (keep these; they are the memorable parts):

- A faint **depth-ruler** runs down the left edge (CSS tick marks + small depth
  numbers injected by `app.js`). Decorative, fixed, hidden on narrow screens
  (`--ruler-w` collapses to `0`).
- A subtle **film-grain overlay** (SVG `feTurbulence` data-URI, ~3.5% opacity,
  `pointer-events:none`).
- An **animated sonar ping** next to the wordmark (CSS radar sweep, 4s loop).
- Blueprint-style hairline borders on every panel.

## Design tokens (`css/styles.css :root`)

All color/spacing/typography flows from CSS custom properties. Use the tokens;
do not hardcode hex values.

| Token | Value | Use |
| --- | --- | --- |
| `--abyss` | `#04070d` | deepest background |
| `--surface-glow` | `#0d2236` | top of the water-column gradient |
| `--panel` / `--panel-solid` | `rgba(13,28,44,.72)` / `#0b1826` | card bg (blurred) / opaque |
| `--ink` | `#d7e7f2` | primary text |
| `--dim` | `#6b8499` | labels, secondary text |
| `--phosphor` | `#35e0c2` | **primary data glow**, active state, selection |
| `--amber` | `#ffb454` | cautions, ceiling line, gas-switch markers |
| `--alert` | `#ff5d6c` | violations, invalid fields, gas-short |
| `--hairline` / `--hairline-soft` | `rgba(120,180,200,.18 / .10)` | borders, gridlines |
| `--glow` | `0 0 8px rgba(53,224,194,.35)` | phosphor halo on numerals/focus |

**Color is never the only signal.** Warnings/errors always pair color with a
glyph (`✓ ✕ ⚠ →`) and text label, for accessibility and at-a-glance scanning.

## Typography

Two Google Fonts with system fallbacks — **never** Inter/Roboto/Arial/Space
Grotesk:

- **Oxanium** (`--font-display`) — headers, buttons, badges, labels. Used
  uppercase with wide letter-spacing (`.08–.14em`) for the instrument feel.
- **Sometype Mono** (`--font-mono`) — **all numeric data, tables, and inputs**,
  with `font-variant-numeric: tabular-nums` so columns of numbers align. Dive
  data is the point of the app; it reads as instrument output.

## Layout

- Desktop: two columns — a fixed **400 px left input rail**, fluid **right
  results column**. Below ~980 px it stacks to a single column; the depth ruler
  hides; panels reflow.
- Panels are cards: 1px hairline border, soft inner top highlight, generous
  padding, 5–6px corners.
- **Left rail = inputs** (Dive segments, Gases, Algorithm, Settings, the sticky
  PLAN DIVE button). **Right column = results** (headline instrument tiles,
  profile chart, runtime table/dive-slate, tissue chart, gas-requirements,
  warnings).

## Interaction model

- **Live recalculation:** after the first successful plan, any input change
  re-plans on a **300 ms debounce** (`DEBOUNCE_MS`). The explicit PLAN DIVE
  button exists for the first plan and as an affordance.
- **Presentation-only vs. replan:** changing the reserve rule or a cylinder
  start pressure updates the gas-requirement cards **without re-running the
  engine** (these don't affect the decompression schedule — see ARCHITECTURE).
  Keep this distinction; needlessly re-planning on a cosmetic change is a
  regression.
- **Units toggle** (metric/imperial) is display-only: it re-renders all inputs
  and results in the new units while internal state stays metric. Round-trip
  must be stable (toggle and back → identical values).
- **Validation** highlights invalid fields inline (red `.invalid`), disables
  PLAN with a reason tooltip, and never blocks typing.
- **Copy plan** emits a clean monospace text version of the schedule (header +
  table + gas supply) to the clipboard.

## Motion

Motion is used for a few **high-impact moments**, not scattered micro-
interactions, and is always gated on `prefers-reduced-motion` (the `reduceMotion`
flag in `app.js` and a CSS media query):

- On a successful plan, result panels **stagger-reveal** (translateY + fade,
  ~60 ms cascade) and runtime-table rows cascade in.
- The big headline numbers (runtime, deco time) **tick up** via a rAF count
  animation (`countUp`).
- The profile line **draws on** via `stroke-dasharray`.

When `reduceMotion` is set, everything appears instantly — no animation,
no count-up, no cascade.

## Charts (`js/ui/charts.js`)

Pure SVG built with DOM APIs — no canvas, no libraries. Two charts, both reading
**only contract fields** and re-rendering cheaply on repeated calls; they must
never throw on weird-but-valid data (empty stops, no-deco dives, missing
`ceilingProfile` → just omit that layer).

- **Profile chart** — the centerpiece. X = runtime, Y = depth increasing
  *downward*. A phosphor profile line with a water-column gradient fill carved
  out of the dark; a dashed **amber ceiling line** from `ceilingProfile`; deco
  stop ticks + labels; **amber diamonds** at gas switches; a hover crosshair
  with a tooltip (decorative, keyboard-skippable).
- **Tissue chart** — 16 compartment bars at surfacing. For ZHL results the bar
  is `gfSurfacePct` with a color ramp (phosphor < 70 → amber 70–100 → alert >
  100) and an "M-VALUE" reference line at 100%. For VPM results (`gfSurfacePct`
  null) it falls back to tissue pressure vs. ambient. N₂/He show as stacked
  sub-segments when helium is present.

## Form controls

- Dropdowns are **native `<select>`** by deliberate choice. A custom-styled
  listbox was built and **reverted** — its popup broke on real mouse clicks
  (the document close-handler fired on `mousedown` before the popup opened).
  The only popup styling browsers reliably honor is `<option>` background/color,
  which is applied (dark + phosphor selected option). **Prefer native form
  controls**; revisit a custom listbox only with a robust, click-tested
  implementation. See [DECISIONS.md](./DECISIONS.md).
- Segmented controls (`.seg-control`) are the pattern for small mutually-
  exclusive choices (units, water, last-stop, algorithm) — phosphor fill on the
  active button, `aria-pressed` toggled.

## Accessibility baseline

- Real `<label>`s / `aria-label`s on every control; `role="group"` +
  `aria-pressed` on segmented controls; `aria-live="polite"` on the results
  region.
- Phosphor `:focus-visible` ring on all focusable elements.
- Color always paired with glyph/text (above).
- `prefers-reduced-motion` fully respected.

## Guardrails when extending the UI

- Keep zero dependencies and no build step. Everything is plain ES5-style JS,
  one CSS file, one HTML file.
- Reuse design tokens and existing component patterns (panels, tiles,
  `.seg-control`, gas cards) before inventing new ones.
- New results read from the engine `result` contract only — never from engine
  internals.
- Preserve graceful degradation: the page must not throw if an engine or the
  charts module fails to load (`app.js` guards `hasEngine`/`hasVPM`/`hasCharts`).
