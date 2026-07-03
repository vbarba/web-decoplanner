# HALDANE — decisions log

Notable choices and the reasoning behind them, so they aren't relitigated or
accidentally undone. Newest first.

## Surface-interval desaturation factor (Bühlmann pulmonary shunt / DecoPlanner parity)

Default repetitive-dive off-gassing is **plain symmetric ZH-L16** (same half-time
for uptake and elimination). This matches Subsurface, whose `core/deco.c` ships
`buehlmann_config.desatmult = 1.0` — the pulmonary-shunt hook exists but is
disabled. DecoPlanner instead **slows desaturation** during the surface interval
(Bühlmann's pulmonary-shunt model, confirmed in GUE/DecoPlanner material), so it
retains more residual load and gives longer repetitive-dive deco.

`surfaceInterval(tissues, minutes, {desatMult})` gained `desatMult` (default 1):
it divides the elimination half-time **only for off-gassing compartments** (tissue
above the surface inspired pressure), mirroring Subsurface's `desatmult`. Exposed
as `state.surfaceDesatMult` (SI DESAT × field). **Calibrated value:
`desatMult = 0.75` reproduces DecoPlanner exactly** on the reference dive
(48 m/25 min 18/45 + EAN50, GF 20/85, ZH-L16B, SI 120 min → last stop 6/29,
total ~69). The exact DP constant is not published; 0.75 is an empirical fit to
DP output AND coincides with the classic ~25%-shunt physiological interpretation.
The **UI defaults to 0.75** (maintainer choice — DecoPlanner is the reference
tool, so repetitive plans match it out of the box); users can set 1.00 for plain
Subsurface-style symmetric decay. The **engine** helper `surfaceInterval` keeps
`desatMult` defaulting to 1.0, so the contract-level default and every engine
test stay plain ZH-L16 — only the app opts into 0.75. Sources: Subsurface
`core/deco.c` (`desatmult`), GUE DecoPlanner repetitive-dive (pulmonary shunt)
material.

## Repetitive dives: UI-orchestrated tissue carry-over, engines gain `initialTissues`

Multi-dive plans (DecoPlanner's "Next dive") were added. The engine contract
gained one optional input — `initialTissues` (16 × `{pN2,pHe}` bar, the
`finalTissues` shape) — plus a `DecoEngine.surfaceInterval(tissues, minutes,
opts)` helper that off-gasses on air at the surface. Everything else lives in
`app.js`: a Dive-panel tab strip, per-dive snapshots in `state.dives[i] =
{si, dive}` (reusing the saved-dive snapshot/apply machinery), and
`carriedTissues()` which re-plans dives 1..k−1 in order and feeds each result's
decayed `finalTissues` into the next dive. Per-dive EVERYTHING (settings, gases,
segments) is snapshotted — dives in a sequence may use different engines.
Trade-off recorded: VPM-B carries only tissue loadings between dives; the bubble
state (crushing, regenerated nuclei) starts fresh each dive — the standard
simplification for VPM repetitive planning. Saved dives store the whole sequence
(`dive.dives`) when the plan is repetitive; old single-dive records still load.

## Stop times use Baker's runtime rounding (exact DecoPlanner stop parity)

`computeStopMinutes` (whole minutes held *from arrival*, fractional runtimes)
was replaced by `computeStopHold`: the stop ends on a whole multiple of
`minStopTime` of RUNTIME (fractional lead-in absorbs the inbound ascent leg,
then whole increments until the next rung clears), mirrored in VPM-B. This is
Baker's actual `DECOMPRESSION_STOP` behavior AND what DecoPlanner does — with
the dynamic first stop (below) it makes HALDANE reproduce DecoPlanner's table
exactly on the comparison dive (24/1 21/1 18/1 15/2 12/2 9/3 6/20, runtimes
33…62, pinned in `tests/zhl16.test.js`). `stops[].time` is the DP-style
integer; `table` stop rows keep the true fractional hold so gas/CNS/OTU math
stays exact. Full detail in
[BAKER-GF-COMPLIANCE.md](./BAKER-GF-COMPLIANCE.md) ("Stop times: runtime
rounding").

## ZHL-16 first stop now uses a dynamic ceiling (DecoPlanner/Subsurface parity)

The ZHL first-stop **depth** rule was changed from Baker's **static round-up** to a
**dynamic / continuous ceiling** (the Subsurface `core/deco.cpp` family that GUE
DecoPlanner shares). **This reverses a prior decision** — round-up was previously
kept for strict Baker compliance and a request to match DecoPlanner was rejected.

Why reversed: the user's reference tool is DecoPlanner, and on the canonical
comparison dive (45 m / 30 min, 21/35, EAN50, GF 20/85, ZH-L16B) HALDANE put the
first stop at **27 m** while DecoPlanner put it at **24 m**. The gap is purely the
first-stop convention: Baker rounds the *static* bottom ceiling (24.81 m) **up** to
27 m; the dynamic rule walks the ascent and finds the diver off-gasses enough to
reach **24 m** before the ceiling blocks the next rung. `firstStopCandidate`
(`js/engine/zhl16.js`) now seeds at the round-up, then walks **down** rung by rung,
re-simulating the ascent leg on cloned tissues and recomputing `ceilingDepth(gfLo)`,
stopping at the last rung still clear. This subsumes the old projected-ascent
deepening loop (the live-ceiling re-eval *is* the projected ascent).

Trade-offs accepted, recorded so they aren't re-litigated:
- The dynamic first stop is **one rung shallower = slightly less conservative** than
  Baker round-up. Stated plainly; chosen deliberately for DecoPlanner parity.
- The in-house **45/25 reference golden** moved first stop 18 m → 15 m (and its
  derived ladder/deco-time goldens re-pinned in `tests/zhl16.test.js`).
- The **decotengu published Baker golden is unaffected** (dynamic and round-up both
  give 18 m there), so the one external reference schedule stays green.
- Hold-every-rung (below) is **unchanged** — only the first-stop depth moved.

Full rationale, the rung-walk evidence, and sources in
[BAKER-GF-COMPLIANCE.md](./BAKER-GF-COMPLIANCE.md) ("First-stop placement").

## Desktop packaging isolated in `desktop/`; releases via git-cliff + plain Node

HALDANE is now also shippable as an offline desktop app (mac/linux/windows),
with automated GitHub Releases on push to `main`. This sits on top of a web app
whose hard rule is **zero dependencies, no build step, no npm** (see below). The
two are reconciled by **isolation**, not by relaxing the constraint:

- **All desktop tooling lives in `desktop/`** — Electron + electron-builder, and
  the repo's *only* `package.json`. The web app at the repo root is untouched and
  still runs by opening `index.html`. `desktop/` is excluded from the GitHub
  Pages artifact (`deploy-pages.yml` stages the web app into `_site/` and drops
  `desktop/`, `scripts/`, `tests/`, `docs/`), so none of it reaches the public
  site.
- **The web app is copied, never duplicated or modified.** `desktop/scripts/prepare.js`
  copies `index.html` + `css/` + `js/` into a gitignored `desktop/build/app/` at
  build time — repo root stays the single source of truth. The only file that is
  ever rewritten is the *copy*: its Google-Fonts `<link>` is swapped for a local
  `fonts/fonts.css` (fonts fetched at build time by `fetch-fonts.js`) so the
  desktop app is fully offline, while the online Pages version keeps using the
  CDN. CSS already has system-font fallbacks, so a failed fetch degrades cleanly.
- **Electron over Tauri:** pure Node/JS tooling matches the project's Node-based
  tests and needs no Rust/native toolchain in CI; the cost is larger (~100 MB)
  unsigned installers, accepted because Pages remains the primary distribution.
- **git-cliff + a plain-Node bump script over semantic-release:** semantic-release
  is heavy and wants an npm package at the repo root — exactly what this project
  avoids. `git-cliff` (one binary, one `cliff.toml`) computes the next version
  from Conventional Commits *and* generates `CHANGELOG.md`; `scripts/bump-version.js`
  (zero-dep) writes that version into the three in-repo `VERSION` strings +
  `desktop/package.json`. This matches the "plain Node scripts" ethos of the test
  suite. The vpmb.js `VERSION` descriptor carries parameterization numbers
  (`4.5`/`6500`/`1.2`); the bump regex anchors on `'VPM-B <semver> (` so only the
  leading semver changes — see the CLAUDE.md note that this string can drift.
- **Loop avoidance:** the release job pushes a `chore(release)` bump commit with
  the default `GITHUB_TOKEN`, which GitHub does not let re-trigger workflows — so
  it loops neither `release.yml` nor `deploy-pages.yml`. A `[skip release]` marker
  + an `if:` guard are defense-in-depth. Do **not** switch that push to a PAT.

## ZHL-16 now holds every rung (strict Erik-Baker GF compliance)

The ZHL-16 ascent loop previously **skipped** a deco rung whose next-stop ceiling
was already clear on arrival (a V-Planner / Subsurface optimization — gas-efficient,
fewer rows). This was the engine's one deviation from Erik Baker's canonical GF
algorithm and has been **reversed**: the loop now **holds ≥ `minStopTime` at every
3 m rung** from the first stop down to `lastStopDepth`, mirroring Baker's reference
`DECOMPRESSION_STOP` loop (which steps up one `Step_Size` at a time and computes a
hold at each rung, emitting even a 1-min rung). See
[implementation note](./BAKER-GF-COMPLIANCE.md).

Rationale: the user's reference is the canonical Baker GF method, not the V-Planner
family. The skip path also *dropped the first stop entirely* on some profiles — e.g.
the decotengu reference (35 m / 40 min air, GF 30/85, ZH-L16B) starts at 18 m under
Baker, but the skip loop began at 15 m, losing the 18 m rung. Holding every rung is
never less safe than skipping (hold ⊇ skip), and recovers the correct first stop.

What did **not** change *in that round* (the first-stop placement was later changed
— see "dynamic ceiling" above): the GF tolerance formula
`Ptol = (P_comp − a·gf)/(gf/b + 1 − gf)` (algebraically identical to Baker's FORTRAN);
stop-time round-up to whole `minStopTime`; per-stop time = hold excluding the ascent
leg; and the GF slope anchored at the **first actual stop depth** (Baker's anchor,
not Subsurface's ratcheting deepest-ceiling anchor).

Concretely (`js/engine/zhl16.js`, ascent loop in `plan()`): the
`if (ceilingDepth(...gfNext) > next) { … }` gate around the hold was removed so the
hold is unconditional; `computeStopMinutes` already enforces `mins >= minStop`.
Golden schedules in `tests/zhl16.test.js` were re-pinned (at the time, the reference
45/25 dive stopped at 18/15/12/9/6 instead of 12/9/6; the first stop has since moved
to 15 m under the dynamic-ceiling rule — see "dynamic ceiling" above), and a Baker-GF
compliance suite was added (tolerance-formula boundaries at GF=1 and GF=0,
GF-high-dominates-NDL, hold-every-rung no-gap invariant, and the decotengu
18/15/12/9/6/3 reference). The first-stop placement (`firstStopCandidate`) was Baker
round-up at this point but **was subsequently changed** to a dynamic ceiling.

## Removed Edit Deco (verify mode); runtime table always regenerates

The editable runtime table and its engine "verify mode" were **removed** from
both engines and the UI to simplify the model and the surface area. The runtime
table is now always the active engine's freshly-generated schedule and re-plans
on every settings change (read-only rows); there is no replay-my-exact-schedule
capability and no `FIX DECO` button.

Concretely this stripped, from the engines: `input.customStops`, the
`replayCustomStops` / `replayCustomStopsVPM` paths, and the `result.verify`
field; from the UI (`app.js`): the EDIT DECO / RESET TO COMPUTED / FIX DECO
buttons, the verify-verdict chip, the editable runtime-table cells,
`state.customStops`, `seedCustomStopsFromResult`, `computeSafeStops`, `fixDeco`,
and `showFixNote`; plus the verify-mode unit tests, the verify-mode CSS, and the
`editDeco`/`fixDeco` i18n keys. Saved-dive snapshots no longer carry
`customStops` (shape is now `{name, ts, dive:{segments, gases, settings}}`).

Rationale: "is MY exact schedule safe?" added a second, parallel code path
(replay alongside generate) in both engines plus a stateful editable table in the
UI, for a feature that overlaps with simply re-planning. Always showing the
engine's computed schedule is simpler to reason about, keeps the two engines
generate-only, and removes a whole class of seed/replay/anchor bugs. See
[ARCHITECTURE.md](./ARCHITECTURE.md).

## One intentional engine difference kept (NDL semantics)

A correctness audit surfaced two places where ZHL-16 and VPM-B diverged. The
intermediate-rung one was later **resolved** (see "ZHL-16 now holds every rung"
above — ZHL now holds every rung like VPM-B and Baker). The remaining one was
reviewed, judged **not unsafe**, and **deliberately kept** rather than forced to
match — matching it would change the displayed NDL for no real safety gain.

1. **NDL semantics.** ZHL's `computeNdl` reports remaining no-deco minutes at the
   *final (shallowest)* bottom-phase depth; VPM-B binary-searches added time on the
   *deepest* segment until deco appears (the conventional controlling-depth NDL).
   They agree closely on single-segment dives but diverge on multilevel no-deco
   dives — e.g. `[30 m/8 min, 12 m/5 min]` air gives ZHL `ndl=81`, VPM `ndl=9`.

**(Resolved) Already-clear intermediate rung.** Both engines now **hold** ≥
`minStopTime` at every 3 m rung from the first stop down to `lastStopDepth`
(Baker-strict `DECOMPRESSION_STOP`); ZHL's former "skip already-clear rung" path was
removed for strict Baker compliance. The engines still produce different first-stop
*depths* on the same dive — they are different models (Bühlmann-GF round-up ceiling
vs VPM-B critical-volume) — which is expected, not a bug.

Separately, **three smaller cross-engine differences WERE fixed** to align the
engines (in `js/engine/vpmb.js`, with a parity test added to
`tests/vpmb.test.js`): VPM-B `minStopTime` now **ceils** (was round) to match ZHL;
VPM-B `ladderUp` rounds the ceiling up to an **absolute stop-interval multiple**
then clamps to `lastStop` (matching ZHL); and VPM-B now **accepts a 0 m segment /
0-min time** like ZHL.

## i18n covers UI chrome + tooltips only — engine output stays English

Translations (en/es/fr/de/zh) live in a separate `js/ui/i18n.js`
(`window.I18N`), applied by walking `data-i18n` / `data-i18n-title` /
`data-i18n-ph` attributes. We deliberately **do not** translate engine
warnings/errors: those are dynamic, composed strings (gas names, numbers, units)
and translating them would mean threading a locale through both engines and
risking the safety-critical message wording drifting per language. Scope is the
~60 static UI strings plus the new box tooltips. Default language follows the
browser (`I18N.detect()`); the manual choice persists in `state.lang` and, like
`units`, is **excluded** from saved-dive snapshots (a display preference, not part
of a dive). A parity test (`tests/i18n.test.js`) fails the build if any language
is missing a key — so adding a UI string means adding it to all five dicts.

## ZHL-16B offered as a coefficient sub-variant of Bühlmann

ZHL-16B is selectable alongside the default ZHL-16C via a small sub-toggle that
appears only when Bühlmann is the active model (hidden under VPM-B). The choice
is **folded into `state.algorithm`** (`'ZHL16C' | 'ZHL16B' | 'VPMB'`) rather than
a separate state field, so engine dispatch, `buildInput`, persistence, and
old-plan migration all need no new plumbing — pre-existing saved plans only ever
stored `'ZHL16C'`/`'VPMB'`, both still valid. The engine selects the `a`/`b`
tables per call (threaded as `ctx.aN2/bN2/aHe/bHe`); the C default path is
byte-for-byte unchanged, so all golden tests stayed green.

A/B/C are the **same model** — identical half-times and GF math, differing only
in the nitrogen `a` M-value coefficients. ZHL-16B (the "table" parameterization)
is stiffer than C at compartments 5–15; N₂ `b` and all helium coefficients are
identical to C. Coefficients taken from the published Bühlmann B table (Baker,
"Understanding M-values"), with the C set verified verbatim against Subsurface
`core/deco.cpp`. **Pitfall, recorded so it isn't reintroduced:** the well-known
`1.2599 / 0.5050` compartment-1 figure is ZHL-16*A*, **not** B — ZHL-16B's
compartment 1 equals C's `1.1696 / 0.5578`. A regression test pins this.

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
both files — accepted on purpose. Two conventions are intentionally *not* mirrored
(NDL semantics and already-clear intermediate-rung handling) — see "Two
intentional engine differences kept" above.

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
