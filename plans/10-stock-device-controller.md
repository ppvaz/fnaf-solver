# Stock-device controller core and act-then-verify loop

**Status: active, incomplete — package 0 advanced (2026-09-02).** `trial.sh` is
the retained legacy/comparison route, not the architecture boundary for new
device work. The current path is split across canonical core contracts and
estimation, adapter capabilities/calibration, and the `apps/device` composition
root. It now has a versioned profile/preflight boundary, fixture and ADB/HID
ports, a device-local artifact executor, and an ordered campaign runner. The
candidate g56 profile remains `dryRunOnly`, so no live controller qualification
has been claimed.

**Correction, 2026-09-17.** The sentence above is a 2026-09-02 state and is no
longer true of the path that runs. The g56 is qualified as
`hid-mediaprojection` (`qualification-hid-mediaprojection-20260907`) and has
executed live nights through it, up to and including a 10/20 clear on
2026-09-14. What is still accurate is the *narrower* reading: no **closed-loop
controller** has been qualified. Every one of those wins is an open-loop binding
with an anchored release and a belief-gated supervisor, which is this plan's
package 0 boundary and not its act-then-verify loop. See
[`PROGRESS.md`](PROGRESS.md) and the
[device record](../README.md).

This plan carries the stock-device observation → belief → policy → action →
verification contract and the measured migration from the legacy shell route to
the modern composition. Plan 22 owns the surrounding architecture; Plans 19
and 20 provide the visual-reactive and belief-cycle foundations.

## Goal

Close the loop against the stock Android game with an auditable
**observation → belief → policy → action → verification** state machine.

The controller must know when it is synchronized, when the game revoked its
assumed state, how much deadline remains for recovery, and when the run ended.
It must preserve the existing exact-model and safety gates.

## Dependencies

- Plan 09 supplies replayable observations and model provenance; its real-phone
  manifest validation is still open.
- Plan 08 owns audio-specific observation gates; audio remains optional.
- Plan 22 owns the package boundaries, capability registry, profile resolution,
  and composition seams used by the modern path.
- The legacy shell lifecycle remains a comparison lane while the modern
  controller is characterized; it is not a reason to duplicate production
  policy or device constants.
- The exact simulator remains authoritative for policy deadlines and recovery
  safety.

## Architectural contract

Use explicit records at the runtime boundary. The legacy generated shell may
continue to emit comparison traces, but production composition must keep device
I/O behind the declared sensor and actuator ports:

```text
Observation { at, validUntil, kind, value|UNKNOWN, modelHash, margin, reason }
Belief      { lifecycle, epoch, monitor, mask, camera, threats, stalls, boxBudget }
Decision    { at, deadline, action, verify, fallback, evidence, policyVersion }
Action      { start, reports, finish, actuatorMode }
Result      { accepted|rejected|unknown, observedAt, recoveryBudget }
```

`Belief.lifecycle` is the device-owned top-level game-state object, not a raw
classifier string. Its minimum vocabulary is `MENU`, `INTRO`, `NIGHT`,
`GAME_OVER`, `WIN`, and `UNKNOWN`, with confidence, provenance, observation
time, validity/age, and refusal reason. Cue Helper's visual/audio detectors
may contribute facts, but the lifecycle reducer decides the current state and
the campaign/controller consumes that one state. The host may mirror it for
diagnostics while the migration is incomplete; it must not become a second
authority.

The policy transition should be pure and deterministic for a given belief,
observation sequence, and clock. Device I/O belongs behind observation and
actuator adapters. Do not let a classifier call directly press the game.

## Required controller states

```text
PREFLIGHT → LAUNCH → NIGHT_SYNC → ACTIVE
ACTIVE → DEFENSE → VERIFY → ACTIVE
ACTIVE/VERIFY → RECOVERY → VERIFY
any nonterminal state → ABORT
ACTIVE → WIN | DEATH
```

`ACTIVE` may retain Minus 7's scheduled subphases—office check, hall guard,
camera sweep, wind—but they should be state values, not inferred from which
line of a long shell routine is executing.

## Invariants

- One monotonic clock owns deadlines; wall clock is reporting only.
- The game can lower the monitor independently through sourced forcedown.
  Press parity is never accepted as observed state.
- `UNKNOWN` never means empty, safe, or accepted.
- A late observation cannot authorize an action after its `validUntil`.
- Recovery is bounded by the model's remaining fuse and resource budgets.
- Monitor/mask actions are idempotent at the controller interface even if the
  game exposes them as toggles.
- A classifier or helper failure cannot restart itself repeatedly during a
  night or block the HID schedule.
- Win, death, focus loss, helper loss, and policy abort are distinct terminals.

## Work packages

### 0. Establish a verified interaction vocabulary

**Added 2026-08-26.** The project built a timed full-night schedule before it
built a tested vocabulary of the interactions that schedule is made of, and the
gap shows up in three places at once:

- **Panning exists in this repository only as an accident.** The office view
  pans, and the only records of it are two failures the device owner reported
  from watching the phone before any log showed them — *"started panning view
  instead of flashing"* and *"fails to press hall light and moves the vision
  instead"* (`ON-DEVICE-VALIDATION.md`, `HID-MULTITOUCH.md`). Both cost nights.
  There is no pan action, no pan-position observation, and no test.
- **The engine does not model pan at all.** `hallView` is `monitor !== MON_UP`,
  and `ventLightL`, `ventLightR` and the hall light are all reachable
  unconditionally. If reaching the right vent light on a phone requires panning,
  the simulator is pricing a night the device cannot play.
- **`coords.sh` has one vent-light coordinate**, commented "in office this is
  left vent", and none for the right vent — while plan 03 is an entire right-vent
  camp mode. Every office coordinate is implicitly "valid at whatever pan
  position the office opens at", and nothing states or checks that.

So the vocabulary has to be established before, not after, another schedule is
priced against it.

- Enumerate the basic interactions as a closed set: pan left / pan right / pan
  to centre, left vent light, right vent light, hall flash, mask on / off,
  monitor raise / lower, select each camera, wind the box, mute the call.
- For each one, three things and not fewer: the **actuation** (contact geometry
  the phone accepts), a **positive observation** that it happened, and a
  **precondition** naming the state it is valid in — pan position, monitor
  state, mask state.
- Establish whether office coordinates are pan-dependent, and if they are, make
  pan position an observed part of the controller's state rather than an
  assumption.
- Decide, with evidence, whether the exact engine needs a pan state. If reaching
  a vent light costs a pan and a pan costs time, that is a resource the
  simulator currently gives away free.
- Keep every measurement here separate from any policy that uses it.

**Gate:** each interaction in the vocabulary has a device-verified actuation, a
positive verification that distinguishes "it happened" from "it was dropped" and
from "it panned instead", and a stated precondition. A deliberate pan is
demonstrated and observed. The simulator either models pan cost or records a
sourced reason it does not need to.

This package is a prerequisite for act-then-verify (package 3) and for plan 03's
right-vent mode, and it is the layer plans 12 and 13 have been assuming.

#### Source answer, 2026-08-26: the pan is real, sourced, and gates nothing

The offline half of this package is done. The full derivation, with every group,
is in [`ANDROID-SOURCE-STATUS.md`](../docs/android/ANDROID-SOURCE-STATUS.md)
§"the office pan is sourced, and no game rule reads it". The verdict:

- **The engine needs no pan *gate*.** An exhaustive scan of frame 3 for every
  reference to `camera follow 2` (80) and `camera follow` (73) finds the scroll
  (g252), the integrator (g228/g247), the touch drive (g235-246), an attack stop
  (g624) and a hitbox re-registration (g1231) — and nothing else. The left vent
  light (**g313**, previously uncited), the right vent light (g320) and the hall
  light (g83-86) have **no view-position condition**. Adding one to
  `src/engine.js` would be inventing a rule. `[SOURCED]`
- **The engine does need a pan *cost*, and it does not belong in the engine.**
  A pan changes no game state and spends no game resource — only `lit?` drains
  the battery (g284). What it spends is actuator occupancy and wall clock, which
  is exactly what `tools/device/actuator.mjs` already models. Put the duration
  and the reachability window there and the *decision* to pay it in the policy
  schedule; leave `src/engine.js` alone.
- **The vents are not symmetric.** The office opens at v23 = 512, the **minimum**
  of a 512-1088 clamp (g228/g247) — one end of a 576-unit, one-directional
  travel. The vent-light hitboxes are scene-anchored (g1223 pins them onto
  `left light`/`right light`) while the hall-light hitbox is created at an
  absolute HUD position (g1072/g1077) and is the one control g1231 never has to
  re-register while panning. So the hall light is pan-free and the right vent is
  at the far end of the whole travel. `[SOURCED]` for the rest position and the
  anchoring; `[INFERRED]` for which light is reachable at rest.
- **Plan 03's right-vent camp is the mode that pays for this**, and it should be
  re-priced before it is scheduled, not after.

What the source settles, so the phone probe need not re-derive it:

| Question | Sourced answer |
| --- | --- |
| drag, fling, or hold? | **Hold-at-edge.** g229 zeroes the velocity every frame before g241-246 re-derive it from the current touch X. No inertia |
| continuous or snapping? | **Continuous**, an integer accumulator clamped to 512-1088 (g247). No snap targets |
| speed | ±8 / ±17 / ±25 units per 16.666 ms at screen X 290/240/180 and 734/784/844 of a 1024-wide virtual screen, × `Min(4, frameDelta/16.666)` (g1236). Frame-rate compensated |
| full traverse | 576 units → **384 ms** fastest band, 565 ms middle, 1200 ms outer, at 60 fps `[INFERRED]` |
| is input dropped mid-pan? | **No.** The pan touch (`Multiple Touch` v4), the two vent lights (v0/v1) and the flashlight (`hudFlashlight` v0) are four independent slots, and g237 refuses to claim a touch that landed on a light hitbox at all |
| does a held light survive a pan? | **No.** g299 clears the vent lights every 200 ms and only g313/g320 re-assert them while the touch is still over the hitbox; g308/g315 drop the tracked id the moment it is not. A stationary finger loses a sliding hitbox |
| why did two nights pan instead of pressing? | Not a priority inversion — g237 gives buttons priority. The finger **missed the hitbox** and landed in the edge band, which is what an unclaimed touch there does |

What only the device (or a richer dump) can answer:

1. **Scene X of `left light` and `right light`**, and their hitbox sizes. A
   logic-only dump has no frame instance list; `packages/source/decompile/EventTextDumper.cs`
   would have to be extended to emit X/Y/layer. Until then the travel a
   right-vent read costs is `[UNKNOWN]` and everything above is a rate without a
   distance.
2. **The virtual→physical mapping.** The bands are at virtual X 180/240/290 and
   734/784/844 with Y < 688; the phone's letterboxing turns those into HID
   coordinates, and into the *safe* coordinates that reach a light without
   claiming a pan.
3. **Sustained frame rate during a pan.** The velocity clamp is `Min(4, …)`, so
   a tick longer than 66 ms under-scrolls and the wall-clock figures above
   stretch.
4. **Whether an HID hold in an edge band reads as one continuous touch.** This
   repository already knows short taps are dropped; a pan is the longest hold in
   the vocabulary and has never been actuated deliberately.

The nearest external baseline is in-engine, not Android:
[`SHOOTER25-BOT-STATE-MACHINE.md`](../docs/in-engine/SHOOTER25-BOT-STATE-MACHINE.md)
records the Shooter25 practice mod driving the **same `camera follow 2`** object,
with its bot gating the left light on `X <= 680` and the right on `X >= 910`.
680 < 910, so **no single pan position actuates both vent lights.** That is a
modified PC build with its own numbering, so those thresholds are `[CALIBRATED]`
for Android at best — but they are the right shape to check the measurement
against.


**Device measurements, 2026-08-26 (Moto g56 5G, v2.0.7, Night 1).** The source
half of this package is recorded in `docs/android/ANDROID-SOURCE-STATUS.md`; this
is what only the phone could say.

- **The night opens at an extreme, and it is the left one.** Holding further
  left from the resting view moves nothing (displacement 0, residual 0.40),
  while holding right moves the view. That is the device confirming
  `camera follow 2`'s sourced clamp: the scroll starts at 512, the minimum. The
  left vent's `LIGHT` button is in view at rest, at the documented (350,615).
- **The right pan band begins between x=1700 and x=1800** at y=400. At x<=1700 a
  held contact produces no movement at all; at x=1800 and beyond it pans.
- **A pan is duration-gated, which is why a tap near the band is safe and a hold
  is not.** Displacement grows with contact length from ~40 ms up to the clamp.
  This is the mechanism behind both nights lost to "it panned instead": the hall
  light needs a *hold*, and a hold that misses the hitbox is exactly the input a
  pan wants.
- **Both lights verified with a positive signature.** A held (1200,540)
  brightens the hall region by **+19.75** luma for the duration and returns to
  baseline exactly (post-minus-pre 0.00). A held (350,615) brightens the left
  vent region by **+8.87** with no hall change. So "it happened" is separable
  from "it was dropped", which is the gate's requirement.
- **A first-run tutorial overlay exists** on a fresh save's Night 1 ("Tap here
  to use your flashlight!"), covering the hall region until the first tap
  dismisses it. No lifecycle classifier knew about it.
- **`Continue` is inert with no save.** It is drawn, with a "Night 1"
  sub-label, on a fresh install where it does nothing; it works once a save
  exists. So the presence of Continue is not evidence that a save exists, and
  `SaveState` cannot be read from it alone.

**Instrument lessons, both paid for.** A displacement matcher must be able to
refuse: the first version returned its own search bound when the night ended
mid-measurement, and the second returned a confident `+16 px` three times when
the tracked content had left the strip. `pan-shift.py` now refuses on a flat
strip, on a bound match, and when two independent templates disagree. And the
pan *detector* compared region means until a synthetic fixture caught it — a pan
that preserves average brightness reads as nothing, so it must be compared per
pixel. Displacement itself is better read from the dump, where the scroll is an
integer clamped to [512, 1088]; the phone is needed for the coordinate-to-outcome
mapping, which is a classification rather than a distance.

**Still open.** The scene X and hitbox extents of `left light` / `right light`
cannot come from a logic-only dump — `packages/source/decompile/EventTextDumper.cs` would have
to emit instance X/Y/layer. That is the cheaper path to the rest of this map
than sweeping the phone, and it is what would let plans/14 derive coordinates on
a new device instead of hand-calibrating them. The right vent still has no
measured coordinate, and reaching it requires a pan the schedule must budget.

**Dump extension, 2026-08-26.** The dumper now emits the frame instance list.
It answered the pan question and refused the one it was built for — full
derivation and evidence labels in
[`ANDROID-SOURCE-STATUS.md`](../docs/android/ANDROID-SOURCE-STATUS.md)
§"the office is 1600x768".

- **The office frame is 1600 x 768.** `[SOURCED]` The width was `[INFERRED]`
  before. `1600 - 1024 = 576 = 1088 - 512`, so the pan clamp is exactly "do not
  scroll past the frame edges" — the width comes from the frame header and the
  clamp from event parameters, so the two confirm each other. The viewport at
  display centre `c` is scene X `[c - 512, c + 512]`: `[0, 1024]` at rest,
  `[576, 1600]` at maximum.
- **The virtual screen is stretched to fill the panel, not letterboxed.**
  `physX = sceneX * 2400/1024`. `[CALIBRATED]` Checked twice against
  measurements it was not built from: g244's virtual-734 band predicts phys
  **1720** and the phone found the band between 1700 and 1800; the hall light at
  phys (1200, 540) is virtual (512, 384), dead centre. A letterboxed mapping
  predicts 1182 and is refuted.
- **This resolves question 2 of "what only the device can answer"** — the
  virtual→physical mapping — and gives plans/14 a derivation rather than a
  calibration: any handset's coordinates follow from its landscape width.
- **Vent reachability, at last with a distance.** Left light scene X ~**149**
  from the phone's own (350,615), ~168 from Shooter25's `X <= 680` — agreeing
  within 19 units. Right light ~**1451** by symmetry, ~1422 from Shooter25's
  `X >= 910` — agreeing within 29. `[CALIBRATED]` The right vent enters the
  viewport at centre ~939, a travel of **~427 of the 576 units (74%)**, and at
  maximum pan the left light is at screen X ~ -427, off screen. So no single pan
  position reaches both, exactly as `680 < 910` implied.
- **Priced: the right vent costs ~285 ms of pan each way, ~570 ms round trip**
  at the fastest band, before the light is held, against the ~680 ms the cycle
  has free. `[INFERRED — sourced rates, assumed 60 fps]` **Plan 03's right-vent
  camp should be re-priced against this before it is scheduled.**

> **Corrected 2026-09-15 (second pass).** The paragraph below read the layout
> list with the wrong handle rule. Under the runtime's rule (`OI ^ 48`,
> `SOURCE-DUMP-GUIDE.md` §4) the dump places `left light` at scene (147, 429)
> and `right light` at (1444, 427): the phone's ~149 and Shooter25's ~168 /
> ~1422 were right, the reachability numbers above are now [SOURCED], and the
> right light is centred on screen after a travel of 420 units (~280 ms in the
> fast band). See `ANDROID-SOURCE-STATUS.md`, 2026-09-15 second pass.

**What the dump refused, which is the more useful half.** The instance list
places `left light` and `right light` at scene X = **-276** — off the frame,
both at the same X, 28 units apart: an authoring park stack. Nothing in any of
the 33 frames repositions or creates them (every `Position` and `Create`
parameter was scanned for handles 94/95; the only hit is g1223 moving the
hitboxes *onto* them). Read literally the vent hitboxes would sit where no
viewport reaches, yet the phone actuates the left one at rest and Shooter25
agrees. **Two independent controls agree with each other and both contradict the
dump by ~425 units**, so the contradiction is reported rather than reconciled.

The explanation the evidence supports: the instance list is the *editor's*
placement, and the Android port builds part of its HUD from code — every mobile
HUD object is parked on layer 8 at negative Y in a row, and
`hudFlashlightHitbox.Active` has no frame-3 instance at all while g1072-1081
position objects relative to it. `[SOURCED]` for the placements and the absence
of any repositioning event; `[INFERRED]` for the runtime-layout explanation.
**So a placed position in this dump is not evidence of a runtime position for
any HUD or interaction object** — the scene X of the vent anchors stays
`[UNKNOWN]` from source, and the reachability numbers above stand on the phone
and Shooter25, made derivable by the 1600 width.

### 1. Extract a shadow state transition log

- Define the records above and emit them from the existing runner without
  changing actions.
- Reconstruct expected monitor, mask, camera, and phase from current traces.
- Compare that shadow state with `desync-scan.py`, video grading, and cue-helper
  observations.
- Record every state correction and why it happened.

**Gate:** current retained runs replay to the same actions and known desync
diagnoses. The shadow layer must not change device timing.

### 2. Make the policy transition pure

- Move decision rules into a host-testable module or declarative transition
  table that consumes observations and produces deadline-bearing decisions.
- Keep exact timings generated from the simulator/recipe rather than copied
  into a second hand-maintained table.
- Add table tests for normal cycles, forcedown, attack, `nolight`, stale reads,
  projection loss, focus loss, death, and 6 AM.
- Replay real observation logs through it.

The existing modern path already prices startup, IPC, scheduling, packaging, and
cleanup through injected ports and the device-local executor. Any remaining
legacy-shell migration must be characterized against that boundary; rewrite
only when semantic traces and timing justify it.

### 3. Close act-then-verify in priority order

1. monitor raise/lower and forcedown recovery;
2. mask on/off around lethal office transitions;
3. vent-light acceptance versus `nolight`;
4. camera selection when a wrong feed changes the policy;
5. terminal screen.

Every verification specifies:

- earliest stable read time after the action;
- deadline and p99 observation cost;
- accepted, rejected, transition, and unknown outcomes;
- bounded retry/recovery;
- simulator proof that the recovery remains safe.

The existing verified monitor recovery is the first behavior to migrate, not a
feature to discard.

### 4. Add belief and uncertainty explicitly

- Represent monitor/mask transition as states, not booleans.
- Track BB as a set of possible route positions when observations are missing.
- Track whether camera-stall uniqueness assumptions still hold; a lapse removes
  permissions that depend on them, including cue attribution.
- Record resource floors for music box and flashlight before optional reads.
- Prefer conservative bounded actions only when the simulator proves they are
  conservative; unnecessary mask time is not automatically safe on Night 7.

### 5. Complete lifecycle ownership

- Identify launch/menu/night/live/death/win screens through plan 09 models.
- Move the lifecycle reducer and its state object into Cue Helper; the host
  lifecycle observer becomes a compatibility/readback adapter during the
  migration.
- Preserve the distinction between `INTRO` (pre-night sequence) and `NIGHT`,
  and between `GAME_OVER` and generic loss/UNKNOWN evidence, so the device HUD,
  campaign runner, and safety arbiter consume the same state.
- Start only from a verified configuration.
- Latch epoch with provenance and a confidence interval.
- End input immediately on terminal or focus loss.
- Preserve the complete artifact and return a machine-readable outcome.
- Never automatically call an abort, short capture, or title screen a loss or
  retryable death.

### 6. Promote behind control modes

Run modes, in order:

1. replay only;
2. shadow decisions beside the legacy runner and modern composition;
3. verification active, decisions unchanged;
4. one bounded recovery branch active;
5. full controller on Night 6;
6. Night 7 only after plan 12's promotion gate.

Keep the legacy open-loop/generated route available as a comparison until the
new controller matches its clean timing and improves its measured failure modes.

## Tests

- deterministic transition-table and deadline tests;
- property tests that no `UNKNOWN` authorizes a positive observation;
- forcedown and monitor-parity regression fixtures;
- stale/late observation rejection;
- one-action-drop and one-observation-drop injection;
- replay of retained nights with decision diffs;
- current `human-gate`, engine, plan-interpreter, focus, cleanup, and grader
  suites;
- long soak demonstrating no orphan loops, unbounded logs, queue overflow, or
  helper restart storm.

## Deliverables

- versioned state, observation, decision, and outcome schemas;
- a pure policy transition with replay tests;
- device observation and actuator adapters;
- act-then-verify paths with measured latency and bounded recovery;
- explicit lifecycle/terminal handling;
- structured per-run controller trace consumed by plan 09 and `grade-run.sh`;
- updated tool and device documentation.

## Done when

- the same recorded observations deterministically reproduce the same decisions;
- a sourced forcedown cannot leave the controller inverted for the rest of the
  night;
- monitor and mask state are observed/verified rather than inferred solely from
  press count;
- every late, missing, or ambiguous observation has a tested fallback;
- the controller recognizes and stops on win, death, focus loss, and abort;
- one full Night 6 attempt is controlled and graded end-to-end under plan 12,
  without weakening the exact-model or human-safety gates.

## Non-goals

- importing another bot's timing table or unlicensed code;
- replacing the exact engine with live heuristics;
- enabling Night 7 merely because the controller compiles;
- making audio mandatory for a path whose non-audio fallback is simulator-rejected;
- a big-bang rewrite of `trial.sh` before shadow equivalence exists.
