# Strict Erik-Baker GF compliance in the ZHL-16 engine

This note explains a change made to `js/engine/zhl16.js` to bring the Bühlmann
ZHL-16 + gradient-factor engine into **strict compliance with Erik C. Baker's
canonical gradient-factor algorithm**, the reasoning behind it, and how it is
tested. It also records what was deliberately *not* changed, so the decision isn't
relitigated. The short version lives in [DECISIONS.md](./DECISIONS.md); this is the
detailed rationale and reference.

## What prompted it

A user compared the same dive (45 m / 30 min on trimix 21/35, deco on EAN50,
GF 20/85, ZH-L16B) in commercial **DecoPlanner** and in HALDANE and saw different
stops and a different total runtime.

Most of the headline gap was an artifact of *how the dive was entered*, not the
model: the user had typed the deco stops as forced dive segments, so HALDANE
**replayed** them (the result showed `DECO 0.0` / `NDL 999`) while DecoPlanner
**generated** the deco. Entering only the bottom segment and letting each tool
generate makes them comparable.

But the apples-to-apples comparison surfaced **one real algorithmic difference**
between HALDANE's ZHL engine and Baker's published method — described below.

## The single deviation: skipping vs holding deco rungs

### Baker's reference behavior

Erik Baker's reference decompression routine (his FORTRAN `DECOMPRESSION_STOP`
loop, the basis for V-Planner, MultiDeco, Subsurface, and GUE DecoPlanner) sets the
first stop, then **steps up one stop increment (3 m) at a time and computes a hold
at every rung** down to the last stop. A rung whose ceiling is already satisfied
still gets the **minimum stop time** (it is visited and emitted, not skipped). The
control variable is always the current rung depth; there is no "this rung is clear,
jump ahead" branch.

### What HALDANE did before

HALDANE's ZHL ascent loop **skipped** any rung whose next-stop ceiling was already
clear on arrival — a common V-Planner / Subsurface optimization (gas-efficient,
fewer table rows). HALDANE's *own* VPM-B engine already held every rung; only the
ZHL engine skipped. This was previously documented as an intentional cross-engine
divergence.

### Why skipping was wrong for strict Baker — and not just cosmetic

Skipping is not merely "fewer 1-minute rows." On some profiles it **drops the first
stop entirely**. On the decotengu reference dive (35 m / 40 min air, GF 30/85,
ZH-L16B, last stop 3 m), Baker / decotengu place the first stop at **18 m**; the
skip loop began at **15 m**, losing the 18 m rung. Holding every rung recovers the
correct 18 m first stop.

Holding is also never less safe than skipping: a held rung adds bottom-time at depth
(more conservative or neutral), so `hold ⊇ skip` in terms of obligation. The choice
here is about *matching the canonical algorithm*, and the safe direction agrees with
it.

### The code change

In `plan()`'s ascent loop (`js/engine/zhl16.js`), the conditional that gated the
hold was removed so the hold is **unconditional** at every rung:

```js
// before — skip a rung whose next-depth ceiling is already clear
const gfNext = gfAt(next, sim.anchor, ctx);
if (ceilingDepth(sim.pn, sim.ph, gfNext, ctx) > next + EPS) {
  const mins = computeStopMinutes(sim, gfNext, next);
  ...
  holdAt(sim, 'stop', mins);
  sim.stops.push(...);
}

// after — hold at every rung (Baker DECOMPRESSION_STOP)
const gfNext = gfAt(next, sim.anchor, ctx);
const mins = computeStopMinutes(sim, gfNext, next);
...
holdAt(sim, 'stop', mins);
sim.stops.push(...);
```

`computeStopMinutes` already enforces `mins >= minStop`
(`minStop = max(1, ceil(ctx.minStop))`), so an already-clear rung now yields exactly
the minimum stop time (1 min by default) rather than 0 — Baker-literal. No other
function changed.

## What was verified-correct and deliberately left alone

These were audited against Baker's papers and FORTRAN reference and found already
compliant. **Do not "fix" them.**

| Aspect | Baker's rule | HALDANE |
| --- | --- | --- |
| **GF tolerance formula** | `Ptol = (P_comp − a·gf)/(gf/b + 1 − gf)`, the rearrangement of `P = Ptol + gf·(M(Ptol) − Ptol)` | identical (`maxTolAmb` / `ceilingDepth`) |
| **First-stop depth** | GF-low ceiling rounded **UP** to the next-deeper stop increment, then a **projected ascent** deepens it if gas loaded during the ascent would violate the ceiling | `firstStopCandidate` — round-up + iterative projected-ascent deepening. **Must stay round-up, not floor.** |
| **Stop-time rounding** | round **UP** to whole `minStopTime`; per-stop time is the at-depth hold, excluding the ascent leg to the next rung | same |
| **GF slope anchor** | linear from GF-low at the **first actual stop depth** to GF-high at the surface | `gfAt(depth, anchor, ctx)` with `anchor = firstStopCandidate`. (Baker's anchor, *not* Subsurface's ratcheting deepest-ceiling anchor.) |

Note on the first stop: a user request to make the first stop **floor** to the next
*shallower* rung (to match DecoPlanner's deeper first stop, e.g. a 24 m stop where
Baker rounds up to ~18 m after projected ascent) was explicitly **rejected** in
favor of Baker compliance. DecoPlanner's floor is a deviation from Baker; HALDANE's
round-up is canonical.

## Effect on schedules

The reference dive in the test suite (45 m / 25 min, 21/35, EAN50 + O2, GF 50/80,
last stop 6 m) changed from a 3-rung ladder to the full Baker ladder:

```
before (skip):  12/2  9/3  6/12              first stop 12 m
after  (hold):  18/1  15/1  12/1  9/2  6/12   first stop 18 m   (ZHL-16C)
                18/1  15/1  12/1  9/2  6/11                       (ZHL-16B)
```

Every 3 m rung from the first stop to the last stop is now present.

## Tests

`tests/zhl16.test.js` gained a Baker-GF compliance suite (section 14) and re-pinned
the affected goldens. The compliance checks:

1. **Tolerance-formula boundaries.** `ceilingDepth` at **GF = 1** equals the plain
   Bühlmann ceiling `(P_comp − a)·b`; at **GF → 0** the ceiling forbids all
   overpressure (`= (P_comp − P_surf)·msw-per-bar`). These pin Baker's formula at its
   two limits.
2. **GF-high dominates the NDL.** Air at 20 m gives essentially the same NDL for
   GF 100/100 and GF 20/100 (lowering only GF-low barely moves a no-deco limit).
3. **Hold-every-rung invariant.** The reference deco ladder steps down by exactly
   the stop interval with **no gaps**, and the first stop is the round-up GF-low
   ceiling (18 m on the reference dive).
4. **decotengu reference.** 35 m / 40 min air, GF 30/85, ZH-L16B, last stop 3 m →
   depth ladder exactly `18/15/12/9/6/3`; per-stop minutes within ±2 of decotengu's
   `1/1/4/6/10/22` (the tolerance covers ZHL-16B-vs-C and rounding differences).

Run the full set (no framework, no install):

```sh
node tests/zhl16.test.js   # engine + Baker-GF compliance suite
node tests/vpmb.test.js    # VPM-B (unaffected)
node tests/i18n.test.js
node js/ui/charts.js
```

## Sources

- Erik C. Baker, *Understanding M-values* and *Clearing Up The Confusion About
  "Deep Stops"* (the GF concept, M-value forms, worked examples).
- Baker's FORTRAN reference programs (the `DECOMPRESSION_STOP` ascent loop,
  first-stop rounding via `ANINT((ceiling/step)+0.5)*step`, projected ascent, and
  the GF interpolation anchored at the first stop), and faithful ports
  (`bwaite/vpmb`, `nyxtom/dive`, decotengu).
- Subsurface `core/deco.cpp` / `core/planner.c` (the contrasting skip-clear-rung
  optimization and ratcheting GF anchor — the behaviors HALDANE deliberately does
  **not** follow).
