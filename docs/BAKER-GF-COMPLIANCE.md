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
| **First-stop depth** | GF-low ceiling rounded **UP** to the next-deeper stop increment, then a **projected ascent** deepens it if gas loaded during the ascent would violate the ceiling | **No longer Baker — uses a dynamic/continuous ceiling** (Subsurface/DecoPlanner). See "First-stop placement" below. |
| **Stop-time rounding** | `DECOMPRESSION_STOP` rounds the **run time** up to a whole multiple of `minStopTime` (fractional lead-in absorbs the inbound ascent leg), then adds whole increments until the next rung clears | same — adopted July 2026; see "Stop times: runtime rounding" below. (The engine previously held whole minutes *from arrival*, leaving fractional runtimes — a deviation from Baker's FORTRAN that also broke DecoPlanner parity.) |
| **GF slope anchor** | linear from GF-low at the **first actual stop depth** to GF-high at the surface | `gfAt(depth, anchor, ctx)` with `anchor = firstStopCandidate`. (Baker's anchor, *not* Subsurface's ratcheting deepest-ceiling anchor.) |

## First-stop placement: dynamic ceiling (Subsurface/DecoPlanner), not Baker round-up

**This reverses an earlier decision.** HALDANE originally placed the first stop with
Baker's **static round-up**: the GF-low ceiling computed *at the bottom*, rounded
**UP** to the next-deeper 3 m rung, then deepened by a projected-ascent check. A
request to match DecoPlanner's shallower first stop was once rejected in favor of
Baker compliance. It has now been **adopted** — the user's reference tool is
DecoPlanner/Subsurface, and parity with it was chosen over strict Baker on this one
point.

`firstStopCandidate` (`js/engine/zhl16.js`) now uses a **dynamic / continuous
ceiling** (the Subsurface `core/deco.cpp` family, which GUE DecoPlanner shares): it
seeds at the static round-up, then walks the candidate **down** one rung at a time,
re-simulating the ascent leg on cloned tissues and recomputing the GF-low ceiling at
each rung. The first stop is the shallowest rung still reachable before the next rung
would sit above the live ceiling.

Why this lands shallower: tissues **off-gas during the ascent**, so the live ceiling
recedes as the diver rises. On the worked dive (45 m / 30 min, 21/35, EAN50,
GF 20/85, ZH-L16B) the static ceiling at the bottom is **24.81 m** (Baker round-up →
**27 m**), but walking the ascent the diver reaches **24 m** freely (live ceiling
~23 m all the way down) and is only blocked passing 21 m:

```
at 42 m ceiling 24.79   at 30 m ceiling 23.80   at 24 m ceiling 23.04  (reached freely)
at 39 m ceiling 24.68   at 27 m ceiling 23.37   at 21 m ceiling 22.65  (first BLOCK)
```

First stop **24 m**, matching DecoPlanner exactly.

The walk-down **subsumes** the old projected-ascent deepening: re-evaluating the live
ceiling at each rung *is* the projected ascent, so a trimix dive where on-gassing
during ascent deepens the requirement is still handled — the walk simply stops
earlier (deeper). No separate deepening pass.

**Safety note (stated plainly):** the dynamic first stop is **one rung shallower** =
slightly **less** conservative than Baker's round-up. Both schedules are
self-consistent against their own ceiling; HALDANE chose the DecoPlanner-matching,
marginally-less-conservative rule deliberately.

Holding every rung (above) is **unchanged** — only the first-stop *depth* moved.

## Stop times: runtime rounding (Baker's DECOMPRESSION_STOP, DecoPlanner parity)

The engine previously held **whole minutes measured from arrival** at each rung,
so stop-end runtimes accumulated the fractional ascent legs (33.3, 34.7, 36.0 …).
Baker's actual `DECOMPRESSION_STOP` (and DecoPlanner/GFDECO) instead rounds the
**run time** up to a whole multiple of `minStopTime`: a fractional lead-in first
absorbs the inbound ascent leg's fraction (always > 0, so every rung is still
held), then whole increments are added until the ceiling — at the **next** stop's
GF — clears the next rung. Both engines now do this (`computeStopHold` in
`zhl16.js`; the rung branch in `vpmb.js`), so this row moved from "deviation"
to "same". Unlike the first-stop change, this one is a move **toward** Baker.

Result on the DecoPlanner comparison dive (45 m / 30 min, 21/35 + EAN50,
GF 20/85, ZH-L16B, last stop 6 m, descent 10 / ascent 9 m/min, no switch hold):
HALDANE now reproduces DecoPlanner's table **exactly** — stops
24/1 21/1 18/1 15/2 12/2 9/3 6/20 with stop-end runtimes 33/34/35/37/39/42/62
(pinned in `tests/zhl16.test.js`). The exact surfacing time is 62.67 min; DP
displays it rounded up as 63.

Conventions attached to the change: `stops[].time` is the DecoPlanner-style
integer (stop-end runtime minus the whole-minute boundary at/below arrival, so
it absorbs the inbound leg and is always ≥ `minStopTime`); `table` stop rows
carry the **true fractional hold**, so gas usage and CNS/OTU stay physically
exact (the UI renders the duration column rounded to whole minutes).

## Effect on schedules

The reference dive in the test suite (45 m / 25 min, 21/35, EAN50 + O2, GF 50/80,
last stop 6 m) went through two changes. First, hold-every-rung turned a 3-rung
ladder into a full contiguous ladder. Then the dynamic-ceiling first stop moved the
top rung one step shallower (18 m → 15 m):

```
original (skip):       12/2  9/3  6/12               first stop 12 m
hold-every-rung:  18/1 15/1  12/1 9/2  6/12           first stop 18 m  (Baker round-up)
dynamic ceiling:       15/1  12/1 9/3  6/12           first stop 15 m  (ZHL-16C)
                       15/1  12/1 9/3  6/11                            (ZHL-16B)
runtime rounding:      15/1  12/2 9/3  6/13           (ZHL-16C, current)
                       15/1  12/2 9/3  6/12           (ZHL-16B, current)
```

Every 3 m rung from the (now dynamic) first stop to the last stop is present, and
stop ends land on whole-minute runtimes.

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
   the stop interval with **no gaps**. The first stop is the **dynamic-ceiling** rung
   (15 m on the reference dive — one rung shallower than the 18 m Baker round-up).
4. **decotengu reference.** 35 m / 40 min air, GF 30/85, ZH-L16B, last stop 3 m →
   depth ladder exactly `18/15/12/9/6/3`; per-stop minutes within ±2 of decotengu's
   `1/1/4/6/10/22` (the tolerance covers ZHL-16B-vs-C and rounding differences). Here
   the dynamic ceiling and Baker round-up agree (both 18 m), so the published Baker
   golden is unaffected by the first-stop change.

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
