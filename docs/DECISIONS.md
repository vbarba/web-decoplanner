# HALDANE — decisions log

Notable choices and the reasoning behind them, so they aren't relitigated or
accidentally undone. Newest first.

## Editable runtime table = engine "verify mode", not UI re-optimization

The editable runtime table is backed by a **verify-exact** capability added to
both engines (`input.customStops` → replay the schedule literally, report a
`verify` verdict), *not* by the UI re-running the generator with constraints.
Rationale: the user wants "is MY exact schedule safe?", like replaying a profile
on a dive computer — edits must never be silently corrected. Verify mode is
additive (gated on `customStops`; the generate path is byte-for-byte unchanged,
so all golden tests stay green) and reuses each engine's bottom simulation +
aggregation verbatim, swapping only the ascent. The UI seeds editable rows from
the computed plan by merging switch + stop holds per depth (so a faithful
round-trip reproduces the computed runtime exactly), and a custom schedule is
**kept and re-verified** when the dive changes rather than cleared — the
more useful "does my plan still hold up?" behavior. See
[ARCHITECTURE.md](./ARCHITECTURE.md).

## Native `<select>` over a custom listbox

A fully custom, theme-matched listbox (`makeListbox`) was built to replace the
native dropdowns, whose OS-drawn popup can't be styled to match the dark theme.
It was **reverted** because the popup didn't open on real mouse clicks: the
document-level close handler fired on `mousedown` before the popup finished
opening (synthetic `.click()` in tests masked the bug — no `mousedown`).

**Decision:** keep native `<select>`. Apply the only popup styling browsers
honor — `<option>` background + a phosphor, bold selected `<option>`. The user's
request was a "small cosmetic change"; native controls are reliable across
Safari/macOS and mobile (where they give the OS picker).

**If revisited:** any custom dropdown must be click-tested with real pointer
events (mousedown→mouseup→click), not just synthetic clicks, and must handle the
open/close-ordering race. Lower priority than correctness work.

## VPM-B `BENCHMARK_RADIUS_FACTOR`: 1.2 → 1.012

The factor was a misread of Subsurface's `subsurface_conservatism_factor`. No
Subsurface release ever used `1.2`; ≤4.6.2 use **`1.012`**, ≥4.6.4 use `1.0`.
The wrong value made every default VPM-B schedule ~9–19% longer than the
V-Planner/Subsurface benchmarks the engine claims to reproduce (conservative, so
not unsafe, but wrong). Fixed to `1.012` and **pinned** with a regression test
against Subsurface `testplan.cpp` runtimes on the default path (the prior tests
only exercised the `_critRadius` override path, bypassing the constant).

**Lesson:** decompression constants must be verified against a cited published
source and pinned by a test on the *shipped* code path, not just an override.

## Other engine corrections (from review)

- **NDL ceiling display:** on no-deco dives the displayed ceiling used `gfLow`
  all the way to the surface, drawing a phantom ceiling above a diver free to
  surface. Now displays with `gfHigh` once the obligation is clear.
- **Ceiling-violation warning:** a user-forced shallow level that rises above the
  live decompression ceiling now raises a warning (the schedule was already
  computed correctly from the violated tissue state; it just wasn't flagged).
- **VPM surfacePressure validation:** added the same `(0.5, 1.2)` bar range check
  the ZHL engine had, so out-of-range input fails cleanly instead of producing a
  confusing scheduler error.
- **Gas switch at MOD:** a deco gas already breathable at the bottom now switches
  at the start of the ascent (V-Planner convention), not deferred to the first
  stop.

## Cylinder / gas-supply planning kept out of the engines

Tank size, start pressure, and reserve rule are **UI-only** (`app.js`). The
engines already return surface-equivalent liters per gas; turning that into
"do I have enough pressure?" is pure presentation. Keeping it out of the engines
means it can't affect the decompression schedule and doesn't touch engine tests,
and a reserve/start-pressure tweak re-renders cards without re-planning. See
[ARCHITECTURE.md](./ARCHITECTURE.md).

## Two engines behind one contract

ZHL-16C+GF and VPM-B implement an identical `plan(input) -> result` contract so
the UI and charts are engine-agnostic. The schedule-shaping conventions (stop
ladder, gas switching, CNS/OTU, gas usage, sampling) are deliberately duplicated
in both engines rather than shared, to keep each engine self-contained and
independently testable. The cost is that a convention change must be mirrored in
both files — accepted on purpose.

## Zero dependencies, no build step

Plain ES5-style JS (UMD IIFEs), one CSS file, one HTML file. Runs by opening
`index.html` or serving the folder; deploys as static files to GitHub Pages.
This is a hard constraint, not an accident — do not introduce npm, a bundler,
TypeScript, or a framework.

## Distinctive instrument aesthetic

A committed "abyssal instrument console" direction (dark water-column gradient,
phosphor data glow, Oxanium + Sometype Mono) rather than a neutral dashboard.
Rationale and tokens in [DESIGN.md](./DESIGN.md). New UI should extend this
language, not dilute it.
