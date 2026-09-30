# Trainer mode: Minus 3

**Status:** engine-first Minus Toys probe complete 2026-08-28; first device run
the same day (`n2-minustoys-0117`) **refutes the open-loop policy on the phone**
— it clears the deterministic model but not the ~0.66 s/cycle margin the
strategy needs, dying to a BB→Foxy chain (pkg 2a). *Correction, 2026-09-17: that
refutation was of an unanchored open-loop release. The same family, released
against the game's own 5000 ms movement-roll grid, has since cleared Nights 5, 6
and 7 on the phone; the defect `n2-minustoys-0117` found was phase, not the
policy class. See [`PROGRESS.md`](PROGRESS.md).* Step 2's original
pass established that the *glitchless*
member is NOT zero-RNG on the canonical Android model — the adapted Minus Two
probe (`tools/minus2test.mjs`) scores 16/200 with a structural Toy Chica failure
against the sourced consecutive-mask semantics, see `MINUS-3-STRATEGY.md` §7.
Engine gaps from §5 that were load-bearing are now closed, including the
`viewing` / marker split added in the 2026-08-28 pass.

~~Minus Toys cannot transfer (no glitch state, CAM 09 flash-excluded)~~ —
**withdrawn 2026-08-26.** The double-camera state *does* exist on Android:
`viewing` (counter 55) and the `your view` marker (126) are separate fields, a
monitor raise restores only `viewing` from a 200 ms-stale `last viewed`, and the
flash groups read the marker for the target and `viewing` for the CAM 08/09/11
immunity — so the exclusion is bypassable. A retained device frame from the
cleared Night 1 caught both camera buttons lit. See
`docs/android/ANDROID-SOURCE-STATUS.md` §"2026-08-26: the double-camera glitch
*does* transfer".

**2026-08-28: the device half moved from accidental evidence to a deliberate
proof.** A scheduled HID stream armed the split on its first HID attempt on the
target Moto g56: after establishing CAM 11 as `last viewed`, it clicked CAM 09,
left one 17 ms released poll, dropped the monitor, and raised it again. The
result shows the Prize Corner/CAM 11 feed and wind control while **both CAM 09
and CAM 11 are highlighted**. Artifacts are
`captures/n2-doublecam-hid-0003.{png,hid}`. This answers “can the phone's
actuator hit the stale-sample window?” with **yes for one bounded attempt**. It
does not yet prove repeatability or that a held glitched light actually stuns
the Toys.

**The engine half is now answered positively.** `tools/minustoystest.mjs` arms
`viewing == 11` with the marker on CAM 09, runs the published 10 s wind/mask
cadence, and scores **200/200 normal plus 100/100 pinned worst-luck**. The same
cadence without the split is **0/200**, all inside-office deaths. The continuous
office half gives Mangle and BB the five sourced mask ticks while the glitched
flash pins all three Toys. This is a model result, not yet a device stun proof or
a human timing claim.

**Research verdict:** the mode should teach **Minus Toys** (Zach_Scream, 2025), the
family's state of the art and the second-ever zero-RNG strategy; the 2023 original is
historical. It is still a fixed clock-anchored cycle (good lane fit, two-branch
blackout decision), but it is *not* pure data: cam-stall, the double camera glitch
(sourced on Android 2026-08-26 and modelled 2026-08-28),
CAM 08/09 flash immunity, GF interval avoidance, RVC mask timing and the right-vent
light stall are all engine mechanics Minus 7 never needed — see the doc's §5 gap list.
The glitch also carries a legitimacy caveat the mode must surface; glitchless
"Minus Two" is the natural sibling mode if its CAM 03 stall can be sourced.

## Goal

Minus 3 as a selectable strategy mode alongside Minus 7: its own cycle script, its own
lesson ladder, same trainer machinery.

## Why it's a good fit

Minus 3 is the same family as Minus 7 — a fixed, metronomic flash loop, just a different
camera set/cadence. The trainer's Minus 7-specific surface is mostly data:

- `CYCLE_SCRIPT` in `src/config.js` is a declarative timeline.
- The lesson ladder in `src/curriculum.js` is built from it.
- The rhythm lane, coach, and millisecond grading are script-agnostic.
- `tools/simtest.mjs` can prove any scripted routine against seeds.

So this is "new script + new lesson ladder + strategy selection UI," not a new engine.

## Work

1. Encode the sourced routine as a second cycle script; parameterise `TARGET_CAMS`,
   anchor times, and tolerances per strategy.
2. **Sim-verify before teaching:** seed sweep + worst-luck sweep. Establish whether
   Minus 3 is RNG-proof like Minus 7 or has losable rolls — the answer changes how the
   mode is framed (drill machine vs. best-odds practice).
2a. **Probe Minus Toys properly (engine half + device plan done 2026-08-28).**
   The engine now separates `viewing`, sampled `lastViewed`, and the parked
   marker; sourced tests pin their separate g450-457 roles. `minustoystest.mjs`
   gates 200/200 normal, 100/100 pinned worst-luck, and the 0/200 no-split
   control. One 50 ms HID geometry has armed the state once on the phone
   (`captures/n2-doublecam-hid-0003`).

   **Device half, 2026-08-28:** `packages/propose/bin/plans/minus-toys-plan.mjs` ports that
   loop into the on-phone interpreter's plan format — an opening that arms the
   split before 0:05, then a repeating 10 s wind/mask cycle — and
   `trial.sh DEVICE_POLICY=minus-toys` runs it through the same title-safe,
   epoch-latched, watchdog-guarded runner as Minus 7, gating on
   `minus-toys-plan.mjs --gate` before its first adb command
   (`NIGHT6_LEFT=2` driver branch, new `camdrop` interpreter instruction, CAM 09
   coordinate threaded through). `test-minus-toys-plan.mjs` and the extended
   `test-plan-interpreter.sh` pin it. Two bugs in the first draft were caught by
   those tests, not the phone: a `hold light` row the interpreter has no `light`
   control for, and the 350 ms scalar human-floor not standing down for the
   model-gated route (it aborts on the deliberate 50 ms CAM 09 -> monitor
   arming gap).

   **Device Night 2 run 2026-08-28 (`n2-minustoys-0117`) — the open-loop policy
   is refuted.** Graded Night 2, Moto g56. Died at ~2 AM to Balloon Boy walking
   into the office → Foxy. The Toys *did* appear held (no Toy in any office
   frame; CAM 11 the viewed feed every cycle) and the monitor/mask model held
   with zero desync all night — but the fixed cadence has a ~300–500 ms mask-
   window cliff the deterministic gate (`sim.won && splitAt >= 0`) cannot see,
   and the arming geometry's 17 ms released gap collapsed to 0 ms in the HID
   trace. The per-instruction margin map (`tools/device/minus-toys-margin.mjs`)
   puts the whole-schedule phase tolerance at **33 ms early / 99 ms late** —
   against the 302 ms epoch bracket the run reported. Under a full clock-error
   model (302 ms epoch bracket, −184 ms/min drift, σ 29 ms jitter) Night 2 goes
   600/600 → 127/600 and Nights 3–5 → 0/600; an AM-digit re-anchor every 70 s
   recovers only to ~17–35 %. This is exactly the ~0.66 s/cycle margin
   `MINUS-3-STRATEGY.md` §3 predicts, and the port anchors to `T0` not the
   game's :X0/:X5 phase. Full record:
   `docs/device/ON-DEVICE-VALIDATION.md` §"The Minus Toys open-loop policy is
   refuted on the phone".

   **Remaining paths (neither built):** (a) an external hybrid — AM clock
   re-anchor + reactive left-vent BB read + mask verify/retry (jasonclone-style,
   ceiling ~1/3 per the mapped-bot research); (b) the in-APK read-internal-state
   route (`plans/17`), the only approach with demonstrated reliability (Shooter25
   practice mod, 104–1). Also open: the deterministic gate needs a margin check,
   and `test-hid-trace.mjs`'s 100 ms contact floor is a false-fail for this
   policy's 33 ms contacts.
3. Fill any engine gaps the strategy doc flagged (mechanics Minus 7 never exercised).
4. Build the lesson ladder (mirroring the 10-step structure where it maps).
5. Strategy picker in the UI; per-strategy progress/records kept separate.
6. Extend `simtest`/`lessontest` to cover the new script; jitter sweep to publish its
   lateness tolerance like the README does for Minus 7.

## Open questions

- Does mode selection live in Settings or as a top-level entry screen?
- Shared vs. per-strategy layout calibration (probably shared — same physical controls).

## Done when

Minus 3 is playable end-to-end through its lesson ladder, the sim sweeps for it are in
the test suite, and the README documents it with the same honesty as Minus 7
(including its RNG verdict).
