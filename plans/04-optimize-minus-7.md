# Derivation, tier 1: slack-maximised Minus 7

**Status: clean guarantee current; 2026-08-19 slack ranking superseded on
2026-08-23.** The shipped cycle still clears 200/200 seeds and 100/100 pinned
luck, but the old uniform-jitter curve no longer reproduces after the sourced
route/endgame, Puppet-roll, and per-night AI corrections. On the current engine
the legacy row-by-row probe is 89/200 at 100-120 ms and 0/200 at 150 ms. Its old
“167 ms ceiling” and 4-10-7 ranking are historical results, not current claims.

The optional per-step instrumentation is now implemented:

- `cyclesearch --steps` shifts one motor step at a time, with no timing
  randomness, and finds these first-failure windows over 200 seeds:

  | Step | Earliest | Latest |
  |---|---:|---:|
  | monitor down | -450 ms | +300 ms |
  | mask on | -300 ms | +200 ms |
  | mask off | -450 ms | +50 ms |
  | hall flash | -50 ms | +267 ms |
  | monitor up | -150 ms | +117 ms |
  | CAM 10 | -117 ms | +150 ms |
  | CAM 04 | -150 ms | +150 ms |
  | CAM 07 | -150 ms | +133 ms |
  | CAM 11 | -133 ms | +517 ms |
  | WIND | at least -750 ms | +467 ms |

- `cyclesearch --curve --profile=human` keeps press/release rows together and
  applies explicitly `[INFERRED]` weights. Its baseline is 100% through 120 ms,
  13% at 150 ms, 1% at 200 ms, and 0% at 250 ms. This is a sensitivity analysis,
  not evidence about Pedro: replace the weights with per-step `Coach.results`
  timing before using it to rank a routine for a person.

### The searches were re-run on the current engine (2026-08-23)

**First, the error model itself was the confound.** The legacy `--jitter` path
draws a fresh offset for *every row*, so a light's press and its release move
independently and every flash comes out a random length. Flash duration drives
the stall and the power budget, so that is not a model of a late player. Holding
press and release together and changing nothing else (`--profile=flat`, all
weights 1) moves the **shipped** cycle from 0% at 150 ms to **100% at 200 ms**.
Most of the published difficulty curve was the model corrupting flash lengths,
not the strategy being tight. Treat every legacy jitter number, including the
one in the README, as an upper bound on difficulty.

**Both searches found real variants, and they disagree.** Neither changes the
camera order; all six orders still tie, as they did in 2026-08-19.

| | knob change from shipped | fitness |
|---|---|---|
| uniform-best | `hallDelay` 3->4, `hallHold` 2->5, `flashHold` 2->3 | maxJ 4 -> 7 frames (117 ms) |
| profile-best | `maskDelay` 18->20, `hallDelay` 3->10, `hallHold` 2->6 | maxJ 7 -> 13 frames (217 ms) |

**Cross-validated against all three error models**, 200 seeds each
(`cyclesearch --curve --knobs=... [--profile=...]`):

| cycle | legacy row jitter | flat, grouped | human, grouped | min power left | min box |
|---|---|---|---|---:|---:|
| shipped | 45% @120, 0% @150 | 100% @200, 10% @250 | 13% @150, 1% @200 | 57% | 21% |
| uniform-best | 100% @120, 66% @150 | 100% @250, 22% @300 | 100% @150, 14% @200 | 43% | 10% |
| profile-best | 56% @120, 0% @150 | 100% @300 | 100% @200, 86% @300 | 47% | **1%** |

**Recommendation: `uniform-best` is the only defensible candidate, and shipping
it is Pedro's call.** It is the one variant that beats the shipped cycle under
*every* error model, including the one with no inferred parameters. `profile-best`
scores higher wherever press and release are grouped, but it is worse than the
shipped cycle under the legacy model and it buys its slack with the music box:
1% margin on the worst clean seed, against 21% shipped. Box margin is measured
without any assumed human distribution, which makes it the one cost in this table
that is not a modelling choice.

What `uniform-best` actually asks of a player is teachable, which the 2026-08-19
winner was not: hold the hall flash **83 ms instead of 33 ms** and each camera
light **50 ms instead of 33 ms**. The old objection — that the deltas were single
frames, below the trainer's own `TOL_GOOD` grading resolution — does not apply to
a change in how long a control is held. The price is 14 points of the flashlight
budget (57% -> 43% left) and 11 points of box margin.

### The two 50 ms edges are one constraint, and it is structural

`mask-off` late and `flash-hall` early are not two findings. On Android every
office light is gated on `mask = 0` (g75/g84), so a mask still on when the hall
flash is due swallows the flash and Foxy is never reset. The shipped cycle
leaves three frames between the two steps, and that gap *is* both windows.

Re-measuring the per-step windows on `uniform-best`
(`--steps --knobs=hallDelay=4,hallHold=5,flashHold=3`) prices the lever exactly:

| step | shipped | uniform-best |
|---|---:|---:|
| mask-off, late | +50 ms | +67 ms |
| flash-hall, early | -50 ms | -67 ms |
| monitor-up, early | -150 ms | -217 ms |
| cam-11, late | +517 ms | +400 ms |
| wind, late | +467 ms | +350 ms |

`hallDelay` buys exactly one frame of cliff per frame spent, which is why the
profile search pushed it 3 -> 10. It is a real lever and a linear one, but it is
not free: `profile-best` spends it down to 1% box margin. Widening the gap is
the only way to make that moment humanly reliable, and how far to widen it is
the same open decision as shipping a variant at all.

### Follow-up this measurement opens — done 2026-08-23

The trainer graded all ten steps against one symmetric pair of tolerances
(`TOL_GOOD` 150 ms, `TOL_OK` 350 ms), so a 150 ms-late `mask-off`, a 100 ms-early
`flash-hall`, a 150 ms-late `monitor-up` and a 117 ms-early `cam-10` were all
graded **good** while dying in the model, and `TOL_OK` was wider than the entire
survivable window on six of the ten steps.

Now `C.STEP_WINDOWS` carries the measured edges, `C.stepTol` derives a lopsided
GOOD/OK band from them (half the window and four fifths of it), and `Coach.grade`
takes the step as well as the delta. A lesson's tolerance became a ceiling rather
than the rule: it can forgive less than the window, never more. The rhythm lane
draws the real asymmetric shape, and `simtest` fails if any of that regresses.

Two things this deliberately does not do. The bands are a fraction of a
*single-step* measurement, not a share of a combined budget — real play is wrong
on every step at once, which is why the whole-cycle ceiling (4 frames) sits far
below any individual step's slack, and why the fractions are conservative rather
than set at the edge. And a window belongs to a geometry, not to a name: only
`CYCLE_SCRIPT` and lesson 4's office half carry them, because Phase A reuses
`flash-hall` with no mask in front of it and the sweep drills sit elsewhere in
the 5 s interval.

The cost to the player is real and is the point: `mask-off` now passes only
within about 40 ms late, and `flash-hall` within about 40 ms early. If that
proves untrainable on a phone, the answer is to widen `hallDelay` in the shipped
script — not to loosen the grade back onto a lethal input.

**Android evidence (2026-08-20, corrected same day):** the 400-frame flash
stall is Android-sourced after all — groups 450-457 load it from the
never-rewritten `stun time` counter; the earlier "source Counter fixed at
zero" reading was the pre-XOR handle scramble (see
[`ANDROID-CAMERA-STALL.md`](../docs/android/ANDROID-CAMERA-STALL.md)). The corrected
sourced model (flash stun + Withered/Mangle look-hold) passes the shipped
schedule 200/200, so the clean guarantee stands on a sourced mechanism. Later
route/endgame corrections changed the jitter curve, so the old optimization
ranking does not.

## Goal

Search the neighbourhood of the existing `CYCLE_SCRIPT` for the variant with the most
timing slack: same stall guarantee, most forgiving offsets. Ship it either as the new
default script or as an alternative "forgiving" script, whichever the numbers justify.

## Why this is the model-local tier

It stays entirely inside the well-modelled region of the engine — the same mechanics
Minus 7 already exercises and the tests already validate — so comparisons between
cycle variants are controlled inside the simulator. The current legacy baseline is
100% at 50 ms, 45% at 100-120 ms, and 0% from 150 ms (`cyclesearch --curve`).
Because it jitters press/release rows independently, use the grouped per-step
profile for human sensitivity work.

## Search space

Treat the script as a point and vary:

- camera order within the sweep (10/04/07 permutations, CAM 11 position),
- per-step offsets inside the ~1.5 s active window,
- wind hold duration vs. cycle anchor,
- where the mask flick and hall flash sit in the down-phase.

Constraints: the stun chain must never lapse (zero lapses across seeds), BB and the
duel window must stay handleable, wind must keep the box off empty on worst luck.

## Work

1. ~~Build the search and per-step sensitivity harness~~ — done in
   `packages/propose/parked/minus7/cyclesearch.mjs`.
2. ~~Revalidate the shipped cycle and publish current per-step windows~~ — done;
   see the dated status above.
3. ~~Re-run candidate ranking on the current engine~~ — done 2026-08-23; see the
   cross-validation above. `uniform-best` is a live candidate awaiting Pedro's
   decision, `profile-best` is not. The old 4-10-7 result is superseded.
4. Replace the `[INFERRED]` profile weights with measured per-step `Coach.results`
   timing before any ranking is claimed to hold *for a person*.

## Markiplier's suspicion, tested against the model (2026-08-19)

Markiplier closes his July 2026 video suspecting his routine can be optimised: "a
better pattern with which to flash Foxy", and rebinding flash to a mouse button to
"use less flashlight". Checked against the Technical-FNaF wiki's flashlight page
(fetched via the API) and our engine:

- **Community/PC-derived rule:** flashlight power is tracked per *frame held* — hall flash and
  camera light share the 3000-frame (50 s) custom-night budget, vent lights are
  free. Foxy's eviction exposure is also per-frame. But the flash's *effects* (the
  6.66 s stall, resetting it, zeroing Foxy's D) trigger per event. The wiki states
  the consequence outright: "spamming the flashlight is more power efficient than
  holding it down." The engine models all of this faithfully (`engine.js:235`,
  `stunCam`, `tickFoxy`). Android behavior confirms the same stall duration; its
  static initializer provenance is still open.
- **His flash-pattern hope is a dead end in-model:** exposure is linear in lit
  frames, so evicting Foxy costs exactly 700 lit frames — 23% of the night's power —
  regardless of pattern, and he returns 13–27 s later. Minus 7's per-cycle handling
  (2 lit frames per cycle ≈ 170 frames/night keeping D at 0) strictly dominates
  eviction; there is no pattern to find, only alignment choices (which is what his
  BB-alignment trick already is).
- **His tap-over-hold point is real but already embodied:** per-event effects make
  minimal-length flashes optimal, and the trainer's cycle already uses 2-frame
  (33 ms) flashes; the `flashHold`/`hallHold` knobs in the search explore the floor.
- Residual unknown for the decompile: whether real-game exposure quantises to ~1 s
  ticks (his "goes up by 50, sometimes 60") with proportional partial credit — he
  says proportional, which changes nothing; only a rounding quirk would.

## Caveat to carry into the write-up

Human slack is not uniform jitter — real lateness correlates across steps and
clusters on specific inputs (the duel, the wind drag). The new profile mechanism
can express that, but its shipped `human` weights are deliberately `[INFERRED]`.
Do not claim a variant is better *for humans* until trainer traces replace them.

> **2026-08-25: collection now exists.** Every coached trainer run posts its
> per-step census (graded rows by cycle, wind holds, the raw press/release
> stream, and its conditions) to `serve.py`'s `/save-trace`;
> `apps/trainer/test/tracereport.mjs` bands whatever has accumulated. The weights above
> stay `[INFERRED]` until that report has enough runs to argue with —
> the measured profile this section asks for is now a matter of playing,
> not of building.
>
> **2026-08-25, the uniform-error bracket:** reactive Minus 7 (`bbtest`)
> survives 200/200 at ±60 ms iid per-input error, 89/200 at ±100, 0/200 at
> ±150 (`bbtest jitter 60` holds the floor of that bracket in the suite).
> Humans clear the strategy while the trainer grades ±150 as `good`, which is
> only consistent if real error correlates the way this section's caveat says
> — so the bracket is also indirect evidence that the census, when it exists,
> must be fit as correlated per-step bands, not one iid width.

## Done when

If reopened, the measured profile is in `tools/` and reproducible, current old-vs-
new curves are documented, and either the script changes with tests updated or
the plan records that the shipped script remains best under that evidence.
