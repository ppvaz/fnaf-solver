# End-to-end stock-device evidence campaign

**Status: proposed 2026-08-26; rungs reached but not promoted, 2026-09-17; first promotion edges, 2026-09-27.**
This is the promotion plan, not a strategy plan. It defines what must be
captured before the project can claim an operational controller, a full Night 6
clear, or a 10/20 attempt. It does not authorize a device run by itself.

**Where the ladder actually stands.** Levels 4 and 5 were reached for Night 6 on
2026-09-13 and level 7's clear on 2026-09-14 (10/20, `golden-freddy`), with a
predeclared ten-run Night 7 cohort at **3 wins, 7 deaths**. Level 6 was never
run for Night 6. Until 2026-09-27 no promotion edge had been recorded for any
of them. Since then, [`docs/evidence/graph.json`](../docs/evidence/graph.json)
holds 47 `PROMOTED_BY` edges: one for each executor-proven 6 AM on Nights 1-7
whose winner is committed, 24 of them Night 7 (21 at 10/20). Each is a promoted
single clear. None is a reliability or controller claim; Gate G's list below
still governs those. Reaching a rung and promoting it are separate acts, and
this plan owns the second one
([promotions](../docs/evidence/plan12-promotions-20260927.json)).

**The Night 7 table below is route-scoped.** Its 12/100 row measures
`recipe.devicePlan` (Minus 7) and nothing else. Minus Toys clears Night 7
3000/3000 exact, and all ten Custom Night presets clear 3000/3000 in four lanes
([`night7-preset-sweep`](../docs/evidence/night7-preset-sweep-20260917.json)).
Read "the route cannot run at all" as "that route cannot", not as a property of
Night 7.

**Gates loosened 2026-09-25 (Pedro's directive; [`ROADMAP.md`](ROADMAP.md)
step S1 and its gate table).** What won on the phone is an anchored open-loop
binding under a belief-gated supervisor, which reached levels 4, 5 and 7
without passing through the shadow and bounded-branch gates written for a
controller extracted from the now-archived legacy runner. So:

- **Promoting a run already won** needs what `npm run evidence -- promote`
  checks: a committed run pack, a passing terminal, its winner committed
  (`test-winners-rebuild.mjs` keeps every committed winner compiling), and a
  `plan12-attestation.json` bound to the pack's sha256. Gates C, D and G's "begin with shadow and bounded branches again"
  are not prerequisites for it.
- **Gates C and D** remain the entry gates for a *new* closed-loop controller
  (ROADMAP S4), which has to earn live control branch by branch.
- **Gate A's human-gate clause** applies to a claim that a *person* can hold
  the route (ROADMAP S5). A machine route is gated by the device lane at the
  handset's measured timings.
- **Gate G's remaining list** (holdouts per Night 7 observation, the safety
  review) applies to a Night 7 reliability or controller claim, not to
  promoting a single won night.
- **Seed provenance is a claim axis.** A night whose seed was pinned by
  `seedpin` is labelled `pinned` — a clairvoyant result — and is never merged
  into a cohort of natural-clock nights; one identified by the controller
  during the night is `identified`.

**Decisions, Pedro, 2026-09-27** ([`ROADMAP.md`](ROADMAP.md) gate table;
[evidence policy](../docs/evidence/README.md)):

- **Recovered packs: "Accept fully".** A pack recovered from its night-run log,
  which lost `request.json`, passes `manifestComplete` like one whose directory
  survived. What it lost stays named in the pack, the attestation, the edge and
  every reading.
- **Attestation: "i give agents full permission, this is bullshit bureaucracy
  that is impeding progress".** An agent may write `plan12-attestation.json`,
  under delegation `pedro-2026-09-27`, only through `npm run evidence -- attest`,
  which re-derives the other checks from the pack and refuses on any failure.
  The attestation (`plan12-attestation-v2`) names its author and lists what was
  verified, with the sha256 of each input. The delegation covers attestations
  only: `PEDRO-OK` stays human-only, and no agent bypasses a hook.
- **A promotion is never silent.** `promote` records a `PROMOTED_BY` edge in
  [`graph.json`](../docs/evidence/graph.json) that names who attested and the
  pack's custody; `list` and `show` print both.

## Goal

Produce one self-contained, independently gradable chain from repository commit
and simulator policy to stock-device observations, inputs, recovery decisions,
and terminal outcome—then repeat it enough to describe reliability honestly.

## Dependencies

- Plan 09: session manifest, replay, lifecycle and action-state evidence.
- Plan 10: explicit controller and terminal states.
- Plan 11: policy/fault results and replay contract. Its public-bot baselines are
  useful but not blocking for the first Night 6 artifact.
- Plan 08: required only for a policy branch that consumes audio.
- Existing human/model gate, focus/watchdog, plan interpreter, cue-helper cleanup,
  and grading tests remain mandatory.

## Claim ladder

Do not collapse these into “the bot works”:

| Level | Claim allowed |
|---|---|
| 0. Offline | Policy/model result only |
| 1. Replay | Recorded observations reproduce decisions; no live action claim |
| 2. Shadow | Controller observed a real night and would have decided correctly; existing runner acted |
| 3. Bounded live branch | One verified action/recovery branch controlled the game |
| 4. Full Night 6 attempt | Controller owned the complete run; terminal outcome graded |
| 5. Night 6 clear | One complete stock-device 6 AM artifact exists |
| 6. Night 6 reliability | A declared consecutive cohort reports all wins, deaths, aborts, and exclusions |
| 7. 10/20 attempt/clear | Same evidence contract on verified Night 7 configuration |

An abort, lost focus, helper failure, truncated capture, or invalid artifact is
reported separately. It is never silently removed from a reliability cohort.

## Offline blocker: the emitted route's per-night ladder (measured 2026-08-26)

Levels 4–7 are blocked offline, before any phone is involved. Everything below
is **in the simulator**; reproduce with

```sh
node packages/propose/bin/plans/test-night-matrix.mjs            # the human-gate column
node packages/propose/parked/minus7/hid-device-pilot.mjs 200 --night=N --device-sweep --pulse-light \
  --sweep-slot-ms=120 --mask-margin-ms=900 --read-latency-ms=480 \
  --pilot-offset-ms=167 [--device-actuator] [--press-late-ms=MIN,MAX]
```

### The human gate (`recipe.devicePlan` replayed at ±60 ms iid slack, 100 seeds)

| Night | Foxy AI (capped) | exact replay | gate ±60 ms | Foxy deaths | mechanism |
|---|---|---|---|---|---|
| 1 | 0 | 100/100 | **99** | 0 | — |
| 2 | 1 | 100/100 | **77** | 17 | missed BB read |
| 3 | 2→3 | 100/100 | **89** | 8 | missed BB read |
| 4 | 7 | 100/100 | **85** | 12 | missed BB read |
| 5 | 5→7 | 100/100 | **78** | 13 | missed BB read |
| 6 | 10→15 | 100/100 | **46** | 48 | both |
| 7 (10/20) | 17 | 100/100 | **12** | 88 | Foxy phase island |

`GATE_MIN_SURVIVAL` is 40/100, so **Night 7 is the first night the route cannot
run at all**, and Night 6 clears by six points. Two independent mechanisms
produce that curve, and separating them was the whole point — the death string
says "foxy" for both:

- **Nights 2–6 — the missed Balloon Boy read.** Slack on the `read` row makes
  the classifier miss BB in the opening; he reaches the office, *disables the
  flashlight* (`hallLightOn` requires `!bb.inside`), D climbs unchecked and Foxy
  executes. Control: at the fatal check the route had been dark for a median
  **1022–1322 frames (17–22 s)** with D = 17–27, and **every** such death
  (11/11, 6/6, 10/10, 11/11, 4/4 on Nights 2–6) had BB inside the office for
  >80% of that window. This is the sourced BB→Foxy chain, not a timing bug.
- **Night 7 only — a one-frame Foxy phase island.** The flash lands normally
  (median dark interval **293 frames = 4.9 s**, exactly one cycle) and D reaches
  5. `20 - 17 = 3` is the largest safe D at the 10/20 Foxy cap, so 5 is fatal —
  while the same D = 5 is safe on every night up to AI 15. The route only
  replays Night 7 exactly because the sweep's trailing camera light overlaps the
  next cycle's monitor drop by **one frame** and zeroes D a second time. Moving
  the cycle-opening `tap monitor` +16 ms, or the trailing `sweep` −8 ms, takes
  exact Night 7 replay from 20/20 to 0/20. Full derivation:
  [`MINUS-7-STRATEGY.md` §3.1](../docs/strategy/MINUS-7-STRATEGY.md).

**No knob setting rescues Night 7.** Searched, each against Night 7's own AI
table at ±60 ms: `hallPulseMs` ∈ {50,80,100,130,170,220,300}; `readLatencyMs` ∈
{200…900}; `maskMarginMs` ∈ {0…1000}; `pilotOffset` ∈ {0…60 frames}; and, as a
diagnostic outside the emitter's documented freedoms, sliding the whole
down/hall/up beat 300–800 ms earlier to restore the canonical `:X2` phase. The
best knob value is the shipped one (12/100). The beat slide is the only lever
that moves anything — Night 6 **46 → 80**, Night 7 **12 → 31** — and it still
misses the 40/100 bar, because the Balloon Boy branch holds the mask for 4.85 s
with no flash and its mid-cycle 5 s check is unreachable by any single flash the
plan's two-row shared prefix can schedule. `GATE_MIN_SURVIVAL` and
`HUMAN_SLACK_MS` were not touched, and must not be.

### The measured actuator (`packages/play/bin/phone/actuator.mjs`, HID pilot, 200 nights)

`recipe.replay()` has no actuator path, so this prices the *pilot* at the
`hidpilot n6 target` settings, not the emitted plan.

| Night | no actuator | lateness 0 ms | uniform 110 ms | full band 110–300 ms | dominant death under the band |
|---|---|---|---|---|---|
| 1 | 200/200 | 200/200 | 68/200 | **23/200** | `inside-office` (Toy Chica) |
| 2 | 200/200 | 200/200 | — | **0/200** | `inside-office` |
| 3 | 200/200 | 200/200 | — | **0/200** | `inside-office` |
| 4 | 200/200 | 200/200 | 0/200 | **0/200** | `foxy` / `inside-office` |
| 5 | 200/200 | 200/200 | — | **0/200** | `inside-office` |
| 6 | 200/200 | 200/200 | 0/200 | **0/200** | `inside-office` (W. Freddy) |
| 7 | 200/200 | 200/200 | 0/200 | **0/200** | `golden-freddy`, 168/200 |

So the actuator cliff is at **Night 2**, four nights earlier than the human
gate's, and it is not the Night 7 Foxy mechanism at all.

Which part is real actuator error and which is the pilot model's missing closed
loop, measured rather than asserted:

- **The mask seam costs nothing here.** 0 seam-dropped monitor presses in
  237,987 / 138,068 / 116,710 / 104,761 / 58,219 / 40,886 / 7,485 sent on
  Nights 1–7. `MASK_RAISE_GAP_MS` = 180 is doing exactly its job.
- **All of it is lateness, and it is not spread.** A *constant* 110 ms with zero
  spread already gives 68/200 on Night 1 and 0/200 on Nights 4/6/7. Contrary to
  `actuator.mjs`'s header ("the mean is nearly free… the epoch offset dials it
  out"), the epoch does **not** dial it out on this route: scanning
  `--pilot-offset-ms` over 0–300 ms in 17 ms steps leaves Night 1 flat at
  68/200 and Night 6 flat at 0/200. That header claim needs re-scoping to the
  route it was measured on.
- **It is the open loop, not the phone.** The same actuator over the
  monitor-resyncing pilot (`pilottest --vent --sync`) is nearly free:
  200→200, 15→29, 97→79, 8→10, 0→0, 0→0, 0→0 on Nights 1–7. The HID route's
  200/200 → 0/200 is therefore a statement about open-loop monitor toggling at
  measured lateness, and the live runner's checkpoint read and verified recovery
  are the untested variable. Nothing in this repository models that recovery, so
  **how much of the gap is recoverable is currently unmeasured** — that is the
  first thing the campaign should instrument, not a number to assume.

  **Retracted 2026-08-26 — the comparison was confounded, and the answer is
  zero.** See the section below. The recovery is now modelled and reclaims
  nothing; and `--sync` was never what made the `pilottest` route
  actuator-tolerant, because the same route with the resync *removed*
  (`pilottest --vent`, unconditional monitor toggling) is equally tolerant:
  200/27/72/6/0/0/0 against `--vent --sync`'s 200/29/79/10/0/0/0 on Nights 1–7,
  in the simulator. The bullet changed the *route* as well as the loop and
  credited the difference to the loop. The reasoning is kept because the
  measurement it prompted is the one that refuted it.

### The closed loop, modelled and priced (measured 2026-08-26)

`packages/play/bin/phone/actuator.mjs` now carries `MonitorSupervisor`, a model of
`trial.sh`'s actual monitor loop — the flip gate in `light_down_at`
(wait `MONITOR_ANIM_DOWN` from the *logged* press, read the cue helper, confirm
with a second read, correct only if both agree), the classifier checkpoint's
`cams=UP-DESYNCED` question and its verified two-press recovery with
`MASK_ALREADY_OFF`, the read costs, and the `desyncs -le 12` abort. It is
deliberately not an idealised controller: it is one-directional, it looks twice
a cycle and nowhere else, and it reads a screen state rather than a toggle
parity. Reproduce with `node packages/propose/parked/minus7/closed-loop-reclaim.mjs`. **In the simulator:**

| Night | exact | actuator, open loop | actuator + modelled loop | reclaim | free ideal bidirectional resync | `--vent --sync` route ref |
|---|---|---|---|---|---|---|
| 1 | 200/200 | 23/200 | **23/200** | **0** | 23/200 | 200/200 |
| 2 | 200/200 | 0/200 | **0/200** | **0** | 0/200 | 29/200 |
| 3 | 200/200 | 0/200 | **0/200** | **0** | 0/200 | 79/200 |
| 4 | 200/200 | 0/200 | **0/200** | **0** | 0/200 | 10/200 |
| 5 | 200/200 | 0/200 | **0/200** | **0** | 0/200 | 0/200 |
| 6 | 200/200 | 0/200 | **0/200** | **0** | 0/200 | 0/200 |
| 7 | 200/200 | 0/200 | **0/200** | **0** | 0/200 | 0/200 |

**The reclaim is zero on every night, and the loop is not idle while producing
it.** Over 200 Night 6 seeds it takes 2306 cue reads, finds and repairs 86
genuine inversions, and never once corrects a monitor that was not up. Removing
only the corrective press — keeping every read and paying for it — leaves those
86 inversions to reach the classifier as `cams=UP-DESYNCED`, and survival is
identical either way. Mean time alive moves 61.9 s → 61.7 s.

The control that settles it is the last column but one: a **free, instantaneous,
always-correct, bidirectional** repair of the pilot's monitor belief — strictly
better than anything the shell can do, and not a model of the runner — also
changes nothing, on any night. No monitor loop recovers the actuator cliff,
because the cliff is not a desync.

**What the cliff actually is.** Under the actuator the camera stalls lapse and
marker-122 occupants reach the office opening at all, which the exact route
never permits: office cues over 200 nights go **0 → 134** (Night 1) and
**0 → 217** (Night 6), and 177/180 of those nights end in an `inside-office`
death when the 45-frame office-defense fuse expires. The loop leaves the cue
count unchanged to the unit (134 → 134, 217 → 217). The mechanism is the one the
route's own emitter already documents: the sweep has to land *exactly* on its
anchor because the stun it refreshes bridges the five-tick mask with nothing to
spare, and 110–300 ms of launch lateness is 7–18 frames of exactly that. This is
consistent with the earlier finding that a *constant* 110 ms is already fatal
and no `--pilot-offset-ms` dials it out: the loss is the sweep's geometry, not a
phase.

Controls, and their results (Night 6 / Night 1, 200 seeds each, in the simulator):

| Control | Expected | Result |
|---|---|---|
| classifier's monitor read always wrong | must not help | 0/200 and 2/200 — **hurts** (61.9 s → 52.8 s alive; 200/200 corrections taken on a monitor that was down) |
| correction removed, reads retained | must gain nothing | 0/200 and 23/200 — identical to open loop, and the 86/24 desyncs it declined to fix reappear at the classifier |
| cue reads the cams as up for 600 ms after the press (samples inside the flip) | must be able to *cause* desyncs | 199/200 nights desync, alive 61.7 s → 22.6 s on Night 6 — the night 6-38 failure, reproduced |
| flip-animation window anchored to the press's *landing* instead of its log | sensitivity of the sourced 202 ms | 85/200 false corrections, alive 61.7 s → 54.5 s |
| gate wait cut to 100 ms | (no-op, and worth knowing) | unchanged: `wait_until` on a past offset returns at once, so nothing can move the read earlier than the plan's 360 ms read position |
| flip gate only / checkpoint only | separate the two sensors | the gate does all the work — with it on, the classifier checkpoint sees **0** desyncs; with only the checkpoint, 91 |

One honest wrinkle in the controls, recorded because it is the strongest
evidence for the mechanism above: on Night 1 the two *deliberately broken* loops
**improve** survival (23/200 → 36/200 and → 57/200), trading `inside-office`
deaths for `puppet` deaths. A loop whose false corrections invert the monitor
stops the pilot executing the geometry that was killing it. That is not a
defence of a broken loop; it is another measurement saying the deaths are
geometric.

Pinned in `packages/propose/test/test-actuator.mjs`, including the vacuity guard — if
there is nothing for the loop to correct, the zero is not a result.

### What this means for the ladder

Working Nights 1–6 in order is the right call and is not blocked: Nights 1–5
clear the human gate with 78–99/100 and Night 6 with 46/100. The two things that
must land before Night 7 is even attemptable are (a) a Foxy reset the Balloon Boy
attack cycle can reach — which the plan grammar's two-row shared prefix cannot
express today — and (b) a modelled closed-loop monitor recovery, without which
every night ≥ 2 is 0/200 through the measured actuator. Neither is a knob.

**(b) is answered, and it was the wrong question (2026-08-26).** The recovery is
modelled and reclaims 0/200 on every night, as does a free ideal one. The
actuator cliff is the sweep's stun geometry under 7–18 frames of launch
lateness, not a monitor desync, so the item that replaces (b) is *a route whose
camera sweep tolerates the phone's lateness* — and that is a route question, not
a controller question. Nights 2+ do not become viable through the phone model by
adding a loop.

### The lateness bands, decomposed and priced (2026-08-26)

PROGRESS.md's "very next step" asks for the sources of launch lateness to be
separated and each one reduced with device evidence or recorded as a floor.
This is the offline half. `packages/propose/parked/minus7/latenesssweep.mjs` prices it; the full table
and the device probe behind it live in
[`HID-MULTITOUCH.md`](../docs/device/HID-MULTITOUCH.md) §"What the shell's clock
actually costs".

**Provenance first, because the two headline bands are not the same quantity
and were never measured against the same clock.**

| band | where it comes from | anchored to | clock |
| --- | --- | --- | --- |
| **49–93 ms** | HID-MULTITOUCH.md §"The shell's clock is 25× looser", 2026-08-24. A separate HID touchscreen on empty wallpaper, **no game running**, 60 contacts at an intended 120 ms period | the *intended* offset of one wall-timed boundary | the kernel's `getevent -lt` |
| **49–106 ms** | device probe 2026-08-26, 20 targets 200 ms apart, **game running a live Night 1** | same | the shell's own `date` |
| **110–180 ms** | ON-DEVICE-VALIDATION.md / commit `7a2acfb`, from the run logs of the pre-flip-gate nights. Night 6-38's own line is the worked example: anchor press logged at 12.132 s against a 12.000 s cycle base | the **plan's cycle base**, not the boundary and not the landing | `date +%s%3N` minus `T0` |
| **~300 ms** | night 6-40, **inferred**: the read's light-down was seen 700–810 ms into the cycle against a plan position of 367, and ~300 was back-computed by subtracting the gate's wait and the cue read | same | same |

Three consequences, and the third is the one that matters:

1. **49–93 and 110–300 are nested, not independent.** The first is one
   boundary's landing error. The second is that error *plus* whatever slip the
   shell had already accumulated before it reached `wait_until` — the
   classifier's capture pipeline (documented as finishing 30–900 ms past the
   plan's cut-off), the cue reads, and a fork for every `date` and `sleep` in
   between. Reducing the boundary error cannot by itself reduce 110–300 to
   49–106; the arrival slip is a separate term with a separate fix.
2. **Neither is press-to-effect lateness.** Both stop at the shell. The
   device-side path (coprocess write → UHID → InputReader → Fusion's poll) is
   outside both, and `actuator.mjs` applies the band as though it were the
   whole path. That the kernel-anchored 49–93 and the shell-anchored 49–106
   agree bounds the write→kernel leg at roughly ≤13 ms, which is under a frame
   — but that is a bound from two measurements agreeing, not a measurement.
3. **The ~300 ms end should not be quoted until it is re-sourced.** It is one
   run, inferred from a derived quantity, taken while the orphaned cue-trace
   parasite was live (`actuator.mjs` already caveats this), on a night whose
   ending was later retracted as an unlit lamp rather than a Balloon Boy read.
   None of the night 6-xx artifacts survive in `captures/`, so it cannot be
   re-derived offline — only re-measured.

**The knee exists, it is sharp, and it is a frame count.** In the simulator, at
`hidpilot n6 target`, 200 seeds a cell: uniform lateness is free to 41 ms
(2 frames — 200/200 on *every* night) and gone at 42 ms (3 frames — n6 10/200,
n7 0/200). A per-anchor re-roll behaves the same: 0–40 ms holds (n6 179/200),
0–50 ms does not (n6 8/200). **Halving the mean buys nothing** — 205 → 110 ms
and 205 → 83 ms both leave Nights 2–7 at 0/200 — and at a 205 ms mean the
spread is irrelevant too (±0 and ±95 are both 0/200 past Night 1). Both facts
are the same statement: the model quantises to frames, and 205 ms is already
12 of them.

**The measured fork-free clock lands inside the budget.** `date +%s%3N` is a
fork+exec costing 21 ms on this handset, which is why `wait_until`'s
busy-poll granularity is what it is; `read u _ < /proc/uptime` is a builtin
costing 0.36 ms with 10 ms resolution, and the same wait loop written against
it landed 0 ms late on 15 of 15 targets *with the game running*. At a 0–10 ms
band the route recovers Nights 1–5 (197–200/200) and Night 6 to **171/200**.

**Night 7 is not rescued and this must not be sold as a 10/20 result.** It goes
0 → **25/200** and stays the one-frame phase island this plan already
documented from the other side (moving the cycle-opening `tap monitor` +16 ms
takes exact Night 7 replay 20/20 → 0/20). The clock fix unblocks the ladder to
Night 6. Night 7 still needs a route whose sweep tolerates a frame — which is
the item that replaced (b) above, unchanged.

**What the cliff is, restated precisely.** `--ablate` delays one class of press
and leaves the rest on time. Delaying *everything* by a frame is free on all
seven nights; delaying **only the monitor press** by one frame is 0/200 on
Nights 6 and 7, with 280 camera selects landing while the monitor is still
`raising` and being thrown away by the engine. So the cliff is **relative
displacement, not lateness** — which is exactly what the one-macro-per-cycle
architecture exists to prevent, and what a regression to per-press wall-timing
would cost. The shell has to hit two frames of *uniform* error; the macro
already guarantees zero frames of *differential*.

**Still open, and each needs the phone rather than another sweep.**

- The arrival-slip term. The runner logs only the composite (`actual`), which
  is why 49–106 and 110–300 cannot be reconciled from the record. Instrument
  `wait_until` with three numbers per boundary — clock at entry, clock at
  return, clock immediately before the first `hid_down` byte — and the terms
  separate. Control: the same instrumentation with the classifier disabled;
  arrival slip should collapse and boundary overshoot should not.
- `press_at` takes **another** `date` fork between `wait_until` returning and
  the report being written, so every logged press time in the run record
  understates the report's issue time by about one fork (~21 ms, ~1.3 frames).
  The fork-free loop already holds a usable `now`.
- **The touch poll rate is unmeasured and the ambiguity spans the budget.**
  `SOURCE-DUMP-GUIDE.md` sources the game logic at 60 fps; HID-MULTITOUCH.md's
  verified report sequence and the runner's `FUSION_POLL_MS=33` both say 30 Hz.
  At 60 fps the quantisation floor is 16.7 ms (1 frame of a 2-frame budget); at
  30 Hz it is 33 ms (2 frames — the entire budget). A contact-length ladder
  (100/66/50/33/25/17/8 ms) graded from a recording, against a control
  coordinate with no control under it, decides it and also either justifies or
  retires the 100–120 ms contact floor.
- The clock-domain crossing. `/proc/uptime` is monotonic; `T0`, every log line
  and the HID trace alignment are epoch. plans/09 tracks those domains, and
  `clocktrace.mjs`'s 1 AM assertion (69,950 ms against a sourced 70,000) is the
  control that would catch a bad epoch mapping after the swap.

## Canonical run artifact

Every promoted run must retain or derive:

- commit, dirty-tree status, build/configuration, device, viewport, and night;
- policy/model/schema hashes and simulator preflight result;
- exact emitted and observed input times;
- observations, scores/unknowns, validity windows, and decisions;
- monitor/mask/camera belief and verification transitions;
- focus, watchdog, helper, queue, and cleanup events;
- video and optional audio with common monotonic alignment;
- post-run grading outputs and machine-readable terminal verdict;
- simulator replay priced with the measured actuator/observation trace;
- hashes for retained artifacts and an explanation for anything missing.

Game media remains ignored/local. Commit the manifest, aggregate report, and
non-copyright diagnostic summaries only.

## Promotion gates

### Gate A: offline readiness

*Human-gate clause narrowed to human-route claims, 2026-09-25 (see top).*

- canonical engine/source/device suites pass;
- policy passes ordinary, pinned-worst, and required fault sweeps;
- plan 09 replay and terminal classifiers pass holdout contracts;
- controller has tested `UNKNOWN`, stale, focus-loss, forcedown, and terminal
  paths;
- the exact emitted plan passes the current human/model gate;
- no unreviewed environment switch weakens a guard.

**Stop if:** a required fallback is simulator-rejected or a detector lacks the
positive/negative evidence its branch assumes.

### Gate B: lifecycle dry run

- verify package/version, display geometry, focus, helper token, model hashes,
  storage, recording, and cleanup without starting a survival attempt;
- prove terminal detector behavior against retained non-live fixtures;
- interrupt deliberately and confirm no orphan loop, stuck contact, helper,
  recording, or stale sentinel remains.

### Gate C: shadow night

*Entry gate for a new closed-loop controller; not a prerequisite for promoting
a run already won, 2026-09-25 (see top).*

- run the new controller in shadow beside the current route;
- compare expected actions and beliefs against the recording;
- require no unexplained deadline misses or permanent belief inversion;
- replay the session offline and reproduce the shadow decisions.

### Gate D: one bounded live branch

*As Gate C, 2026-09-25.*

Promote one branch whose timeout/unknown fallback is already safe. Monitor
forcedown recovery or monitor/mask verification is preferable to a new threat
detector. Record the control mode and the exact branch authorized.

**Gate:** action, verification, and any recovery land inside measured p99 plus
explicit model margin. No unrelated policy change rides along.

### Gate E: complete Night 6 ownership

- controller owns launch/sync through terminal stop;
- recording and structured trace cover the full attempt;
- every forcedown/recovery is verified;
- terminal grader agrees with retained frames;
- offline replay explains the same decisions and outcome;
- artifact validator reports no missing mandatory component.

The first valid attempt may be a death. Operational closure means the evidence
chain is complete, not that failure is relabeled success.

### Gate F: Night 6 clear and cohort

After one full 6 AM artifact, predeclare a consecutive cohort size and retry
rules. Report:

- wins, deaths by cause, aborts, invalid artifacts, and operator interventions;
- survival-time distribution;
- observation unknown/late rates and verification recoveries;
- resource minima and model-versus-device disagreements;
- exact commit/model/configuration for every run.

Do not tune inside the cohort. A change starts a new versioned cohort.

### Gate G: 10/20 promotion

*Loosened 2026-09-25 (see top): promoting a won 10/20 night needs the pack,
terminal, committed winner and attestation; the list below governs a Night 7
reliability or controller claim.*

Require all of the following:

- verified Night 7 configuration and terminal lifecycle;
- exact simulator policy success under measured observation/actuator faults;
- no dependency on a rejected non-audio fallback;
- holdout evidence for every Night 7-only action-driving observation;
- resource margin after real p99 sensing/verification costs;
- one explicit safety/recovery review of BB, Foxy, Golden Freddy, forcedown,
  music box, and camera stalls.

Begin with shadow and bounded branches again. A Night 6 clear does not transfer
its AI table, resource budget, or observation assumptions automatically.

## Failure taxonomy

Every unsuccessful run receives exactly one primary layer and optional
contributing causes:

- mechanics/model mismatch;
- policy decision;
- observation false/unknown/stale/late;
- action rejected/dropped/late;
- belief synchronization/recovery;
- resource starvation;
- lifecycle/focus/helper/recording fault;
- operator or configuration error;
- game death with controller behaving as designed.

Use counterfactual replay from plan 11 to support attribution. Do not diagnose
from the jumpscare character alone when an earlier desync or missed flash can
be the root cause.

## Reporting

Publish a dated report for each promoted level containing:

- claim and explicit non-claims;
- configuration and provenance;
- pass/fail gates;
- cohort selection rules;
- aggregate outcome table;
- representative minimized failures;
- links to committed schemas/reports and local artifact hashes;
- open discrepancies and next permitted experiment.

Videos are demonstrations, not the sole evidence. A highlight clear without the
cohort and trace remains level 5, not a reliability claim.

## Done when

- one complete Night 6 attempt has a valid end-to-end artifact and replay;
- one stock-device Night 6 clear, if achieved, is reported at the correct claim
  level without implying 10/20;
- a versioned consecutive cohort quantifies reliability before policy tuning;
- every exclusion or invalid run is visible;
- 10/20 remains gated until its own observation, policy, resource, and recovery
  contracts pass.

## Non-goals

- promising that a clear will occur by a date or run count;
- running unattended beyond the device/lifecycle safeguards;
- optimizing for a publishable video at the expense of trace completeness;
- weakening fail-closed behavior to increase apparent survival;
- treating simulator, modified-game, Night 6, and 10/20 results as equivalent.
