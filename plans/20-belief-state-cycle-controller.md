# Belief-state cycle controller

**Status: proposed 2026-08-29, deployment direction amended 2026-09-06 by
Pedro's architectural directive.** Build the controller as a small,
explainable estimator and planner whose preferred eventual home is the Cue
Helper APK. The current composition may still run beside the phone while the
device-local contracts and actuator are qualified. It constructs each next
control cycle from what audio, video, elapsed time, and action verification say
about the night; it does not replay a fixed macro and call that a closed loop.

## The idea in one sentence

The selected controller host maintains a **belief state**: a compact,
continuously corrected model of the parts of the night that matter to the next
decision. It evaluates a few safe candidate cycles against that belief,
executes one through a qualified actuator, verifies the result, and repeats.
The host may be the phone, an ESP32-class coprocessor, a PC, or another node;
the contract does not assign the role to a hardware name.

```
phone audio/video + elapsed time + action acknowledgements
                         |
                         v
                 calibrated fact adapters
                         |
                         v
              belief-state estimator / digital twin
                         |
                         v
           constrained short-horizon cycle planner
                         |
                         v
                 safety supervisor + USB-HID
                         |
                         +-------------------------+
                                                   |
                                      next observations
```

This is a practical partially-observable controller, not a claim that an
external device can recover Fusion's hidden RNG state. When a route or an
observation is uncertain, the belief records that uncertainty and the planner
chooses only a cycle safe across the remaining plausible states.

## Deployment direction

The contract remains hardware-agnostic, but the project's preferred end state
is now explicit: **Cue Helper is the full device authority**. Its device-local
runtime should own capture, top-level lifecycle/game-state estimation,
belief/fusion, safety arbitration, campaign supervision, and the selected
actuator backend. The PC remains useful for build, replay, calibration,
evidence, and telemetry; it is not the intended authority during a run.

This is a migration target, not a claim that the APK already controls a night.
The current APK is a read-only visual/audio helper, the modern host composition
is still the qualification lane, and the lifecycle observer is still partly
host-side. The lifecycle object must move into the APK before host removal is
complete; visual detectors feed it but do not independently own campaign truth.

The hostless input question is tracked separately in
[`ACCESSIBILITY-VS-HID-BENCHMARK.md`](../docs/device/ACCESSIBILITY-VS-HID-BENCHMARK.md).
Online research found no credible AccessibilityService-versus-UHID
head-to-head measurement. The first stock-game acceptance gate then showed
that AccessibilityService framework completion did not make FNaF2 accept the
same title-screen tap that UHID accepted. It is not promoted as a game
backend; the already-qualified `/system/bin/hid` path remains the in-night
and menu-control baseline until a new acceptance path is proven.

## Why this is a separate plan

The existing plans build important pieces, but none owns their composition:

- [Plan 19](19-video-reactive-controller.md) supplies calibrated video facts,
  a blackout fast path, and the stock-device observation loop.
- [Plan 08](08-audio-cue-controller.md) maps audible cues. Its live stock-phone
  capture is blocked; Plan 19 P6 makes an external A2DP sink a slower, valid
  input to this controller.
- [Plan 10](10-stock-device-controller.md) supplies the action/verification
  boundary, and Plan 11 supplies comparable simulator policies.
- [Plan 12](12-end-to-end-evidence-campaign.md) owns promotion from simulation
  to shadow mode and live action.

This plan defines the layer above those components: how observations become a
decision-relevant world model, and how that model chooses the next cycle.

## Non-goals and safety boundary

- Do **not** model all internal game state or claim exact RNG recovery. The
  external controller cannot observe it; fake precision is worse than an
  explicit unknown.
- Do **not** put delayed A2DP classification in the blackout-to-mask critical
  path. Video remains the fast defensive path.
- Do **not** emit unconstrained arbitrary sequences. The planner selects from
  reviewed, model-gated cycle primitives and obeys monitor/mask animation and
  device input-acceptance constraints.
- Do **not** allow live action until the same estimator has completed a clean
  observe-only campaign under load.

## State model

The state is deliberately small and auditable. Each field holds a value,
confidence, provenance, and age rather than a naked boolean.

| State group | Examples | How it is maintained |
|---|---|---|
| Control truth | monitor position, mask position, viewed camera, current action lockout | HID command plus video confirmation; disagreement enters recovery |
| Clock and resources | game-phase interval, AM-hour bracket, box fraction/range, flashlight budget | monotonic time prediction corrected by AM digits and calibrated box reads |
| Immediate hazards | blackout, visible opening threat, hall threat, forced monitor-down | fast video facts; an observed hazard overrides the planner |
| Route hypotheses | BB/Mangle/Withered/Toy/Foxy risk buckets and possible route stage | sourced transition model, elapsed time, camera/light effects, and cue/video evidence |
| Sensor health | frame age, audio latency/jitter band, calibration profile, dropped-read count | every adapter; stale or mismatched readings reduce confidence instead of changing game state |

The first version uses named discrete buckets and ranges, not a neural model:
`Foxy={low, rising, hall-risk, locked}`, `BB={absent, possible, opening,
inside}`, and a bounded set of route stages per character. That makes each
decision replayable and explainable.

## Controller shape

### 1. Fast safety supervisor

Runs on every fresh visual read and may pre-empt the planner only for a small
set of proven actions:

- observed blackout or committed visible office threat -> mask immediately;
- unknown monitor/mask polarity after an action -> stop scheduled transitions
  and run a verification/recovery sequence;
- action requested inside a monitor/mask animation window -> refuse it.

The supervisor is intentionally boring. It protects deadlines; it does not
invent strategy.

### 2. Belief update

At each observation boundary, predict the state forward from elapsed time and
the last accepted action, then apply facts as evidence:

- a high-confidence visual fact narrows or sets a state bucket;
- an audio cue narrows route hypotheses after its measured transport-latency
  band, never at its local receipt timestamp;
- absent, stale, ambiguous, or sensor-mismatched facts make no positive claim;
- a contradiction between predicted and observed control state creates a
  desync incident and moves to a conservative recovery belief.

This can begin as a small weighted set of hypotheses (a particle set) and
collapse equivalent hypotheses into named risk buckets after each update.

### 3. Receding-horizon cycle planner

Every cycle boundary, score a small finite library over the next 5--15 seconds:

- wind-and-anchor;
- short verify-and-resume;
- defensive mask-hold;
- Foxy reset / hall-check where sourced and model-gated;
- recovery after an unverified monitor or mask transition;
- strategy-specific post-wind branch (for example RVC).

Candidates are rejected before scoring if they violate a hard constraint for
any sufficiently plausible hypothesis: mask deadline, box floor, animation
window, input gap, or known route hazard. Among the survivors, select the
lowest worst-case risk, then the best resource margin. Commit only the short
prefix; new evidence replans the next cycle.

### 4. Act, verify, learn

Every command carries an expected visible result and deadline. The controller
records `sent -> device delivered -> visual confirmation`; a missed
confirmation does not silently advance the model. It either retries the
bounded action or enters a defined recovery primitive.

## Work packages

### P1 -- versioned belief-state contract

Define a plain-data schema for facts, state fields, hypotheses, confidence,
age, source calibration profile, planned primitive, action, and verification.
Add replay fixtures for: clear cycle, blackout pre-emption, delayed audio cue,
dropped video read, and monitor-desync.

**Done when:** a recorded observation/action stream deterministically rebuilds
the same belief transitions and explains every confidence change.

### P2 -- reduced transition model — DONE (worktree)

Extract the decision-relevant transition rules from `Sim` into a controller
model: clock/box prediction, action locks, visible hazard deadlines, and route
risk bucket transitions. Keep hidden RNG as branching probability/risk, not a
fabricated observed value.

**Done when:** the model can predict one cycle forward from a documented state,
and its deliberately coarse outputs agree with the full engine within declared
bounds over seeded replay.

`src/reduced-model.js` is the deliberately narrow model: it predicts the
monitor/mask animation and input locks, camera sampling anchor, winding/box and
power resources, plus explicit hazard/risk buckets. `packages/propose/test/reducedmodeltest.mjs`
compares those controller-visible fields against seeded Night 1 `Sim` traces;
unknown route state is not copied from the simulator.

### P3 -- estimator and uncertainty tests — DONE (worktree)

Implement predict/update/reconcile with no device dependency. Test that delayed
audio is time-shifted, unknown facts never reduce risk, stale control-state
facts trigger verification, and two contradictory sensors produce a visible
incident rather than last-write-wins behaviour.

**Done when:** fault-injected observation traces degrade margin gradually or
enter safe recovery; they never produce an unlogged confidence jump.

`src/estimator.js` wraps the versioned belief reducer with monotonic prediction,
observation/receipt timestamps, stale-control verification lockouts,
calibration refusal, contradiction incidents, and transactional action
reconciliation. `packages/play/test/estimator.test.ts` covers delayed A2DP-style facts,
UNKNOWN preservation, stale controls, missing profiles, contradictory sensors,
and failed/successful verification.

### P4 -- finite cycle library and constraint gate — DONE (worktree)

Express every permissible cycle as data with prerequisites, temporal actions,
expected results, resource cost, and hazard coverage. Reuse the exact model
gate and phone acceptance constraints; the planner cannot emit a primitive that
has not passed them.

**Done when:** an attempted unsafe cycle is rejected with its violated
constraint, and every selected cycle has a readable decision record.

`src/cycle-library.js` provides reviewed wind, mask, hall-reset, and
monitor-verification primitives. Its gate checks reduced-model prerequisites,
animation collisions, contact/released gaps, and a required exact-engine proof
callback; `packages/propose/test/cycle-library.test.js` pins both accepted records and fail-closed
controls.

### P5 -- robust short-horizon selector — DONE (worktree)

Evaluate candidates across the belief hypotheses, using worst-case /
risk-bounded selection rather than an average that gambles on one hidden route.
Add controls: fixed open-loop schedule, truth-state oracle (upper bound), and
an estimator with video/audio disabled.

**Done when:** simulation shows the estimator controller beats the disabled
observation control without approaching the oracle through privileged state.

`src/cycle-controller.js` composes the estimator, reduced state, finite cycle
library, and worst-case selector. It accepts only fact envelopes and commits
the selected cycle's immediate prefix; delayed actions remain deferred until a
new boundary and control actions stay locked until a matching observation
reconciles them. `packages/propose/test/cycle-controller.test.js` runs the exact engine over a
bounded, sourced five-second-blackout scenario: the fixed and observation-
disabled controls score 0/80, the normal delayed/dropped estimator scores
80/80, the deliberately harsh stress control scores 46/80, and the explicit
truth-state upper bound scores 80/80. (The stress control read 13/80 until
2026-09-03; hazard preemption is what moved it, by letting a 70-frame-delayed,
80%-dropped observer still act on the blackout it eventually sees instead of
holding through the primitive it was already committed to.) The production controller has no exact
engine import; the exact replay is confined to the test's proof callback.

**Full-night survival landed 2026-09-03.** P5's recorded gate is a nine-second
horizon against one synthetic blackout; driven over whole nights the same
controller was 0/3 on Night 1 with a scorer its own harness called a baseline
control. `packages/propose/src/games/fnaf2/night-policy.js` supplies the sourced route
model P5 leaves to the caller, and on a held-out 200-seed cohort per night
(`--gate=static`, the device-realistic gate) the closed loop is 184/200,
101/200, 167/200, 165/200, 75/200, 0/200 and 0/200 on Nights 1-7 against
observation-disabled and open-loop controls that are 0/200 on every night.
Nights 6 and 7 are a measured resource wall, not a tuning gap: see
`plans/PROGRESS.md`, 2026-09-03. Simulation only -- no device has run it.

### P6 -- transport capabilities and real-time placement

**Architecture correction, 2026-08-31.** The phone -> ESP32 A2DP -> Wi-Fi/UDP
PCM -> same-phone helper bridge was experimentally rejected for severe loss.
That rejects the measured profile, not bridge mode or any fixed hardware role.
An ESP32 may bridge samples, process them locally, host a reflex, participate
in actuation, combine those capabilities, or be absent. Sample chunks,
semantic facts, actions, health, and timing cross explicit contracts; the full
controller boundary, action-arbiter ordering, and measurement gate are defined
in
[`REAL-TIME-CLOSED-LOOP-ARCHITECTURE.md`](../docs/device/REAL-TIME-CLOSED-LOOP-ARCHITECTURE.md).

Define the hardware protocol and choose the topology only after a bench trace.
One candidate topology is Linux A2DP sink -> fact link -> ESP32-S3
wired USB-HID. A two-MCU alternative is Classic-Bluetooth ESP32 A2DP sink ->
UART/SPI -> ESP32-S3 USB-HID. The split reflects the hardware boundary:
original ESP32 supports Classic A2DP; ESP32-S3 supports native USB HID but not
Bluetooth Classic. A one-MCU Classic-ESP32 Bluetooth-HID route is an unmeasured
alternative, not the architecture's assumption.

**Candidate v1 after the 2026-08-29 findings.** The PC stays in the loop for
this profile — it is the
only proven A2DP sink (BlueALSA; PipeWire's BT receive is broken here) and it
already runs the detector and estimator. So v1 is: **phone** (WiFi: adb + the
on-device cue-helper video socket; BT: A2DP audio; USB: HID) -> **PC** (BlueALSA
sink + video read + belief state + planner) -> **ESP32-S3** over USB-CDC serial,
presenting an absolute-multitouch USB-HID device to the phone. The ESP32-S3
owns its monotonic cycle clock and one cached pre-empt ("MASK NOW", fired by
the PC's video blackout detector, executed without waiting for the planner) and
completes an already-approved safe cycle if the serial link drops. Audio never
enters the mask critical path — its ~150-250 ms A2DP latency (plus a
silence-suspend resume gap) confines it to route-hypothesis narrowing. Open and
bench-gated: whether the phone accepts an external USB-HID touch device with the
same ~33 ms contact-landing behaviour the on-device `/system/bin/hid` path has,
and the p99/p99.9 of every leg.

**Hardware note (2026-08-29):** the ESP32 on hand is a **WROOM-32** (original
ESP32) — BT Classic A2DP sink + BLE/BT-Classic HID, but **no USB device
controller**, so it cannot be the wired USB-HID actuator. Near-term this plan
therefore keeps actuation on the validated on-device `/system/bin/hid`/adb path
and treats the ESP32 as, at most, an alternative SBC A2DP audio tap (gated on
the s0033 SFX-survives-SBC check). A wired USB-HID actuator MCU is a later
purchase, not a blocker for P1–P5.

In this candidate, the HID node owns monotonic timestamps, local actuation,
cycle scheduling, and the fast mask path. Another profile can allocate those
roles differently while satisfying the same contracts. Upstream sends bounded
fact messages, never a sequence of wall-timed commands:

```
{ type, value, confidence, source, calibrationProfile,
  t_observed?, t_received, latencyMin, latencyMax }
```

`t_observed` is included only when the sensor can directly timestamp its
observation. In particular, A2DP PCM receipt is **not** game-event time; it
updates the estimator over the interval implied by its measured transport
latency, then predicts that historical state forward to `t_received`.

**Hostless target profile, added 2026-09-06.** Once the APK owns the lifecycle
and belief objects, the preferred stock-device topology is:

```text
Cue Helper capture -> lifecycle/state estimator -> belief/arbiter
                   -> AccessibilityService or UHID actuator -> FNaF2
```

AccessibilityService is attractive because an ordinary, user-enabled APK can
dispatch timed multi-stroke gestures without ADB. Android's current framework
uses display-refresh gesture sampling for services targeting newer SDKs, but
that does not establish FNaF2 contact fidelity, pointer-addition semantics,
or end-to-end acceptance. The first real-game gate failed even for a
windowless receiver dispatch: the framework callback completed, but FNaF2 did
not change screens while the same UHID tap did. A new dispatch also cancels a
gesture already in progress, so this is especially important for overlapping
pan/light/flash contacts. The exact benchmark and promotion gate are in the
linked document; no AccessibilityService backend is promoted by this plan.

**Phone-free foundation landed 2026-08-30.** `src/fact-link.js` now owns a
bounded `fact-message-v1` newline contract: primitive observed values or
explicit UNKNOWN reasons, source/calibration identity, separate observation,
sender-receipt, and local-link-receipt times, finite latency bounds, and an
ordered sequence with visible gaps and stale state. `SafeCycleHandoff` accepts
at most 16 actions over at most 15 seconds and can drain only the actions the
host already approved; a stale link cannot create a replacement action and an
expired approval emits nothing. `packages/kernel/test/factlinktest.ts` covers the contract
and is in the normal suite. These are deliberate protocol bounds, not a
measurement of USB timing or proof that an MCU/external HID accepts the wire.

**Bench-trace contract foundation landed 2026-09-02.** Core telemetry now
owns `bench-transport-trace-v1` and its derived summary. Each retained sample
must connect a screen or audio event to a fact, executor receipt, actuator
command, and observed result on one declared monotonic millisecond clock.
Summaries report nearest-rank p50/p95/p99/p99.9 for every leg and path and
retain UNKNOWN-result counts. The continuation record requires all actions in
one bounded approval to drain after an upstream drop, while rejecting any
replacement action. `packages/review/test/bench-trace.test.ts` is the deterministic fixture
gate. This advances the contract and reporting layer only; a physical bench
trace, measured external-HID timing, and P7 shadow campaign are still open.

The visual fast path must also be measured, not assumed. A detector wired to a
display/compositor can see a new frame quickly; the current phone helper is a
~59 ms read at ~14 Hz plus fact delivery. Its p99
`visible-blackout → fact → HID command → mask-confirmed` is the relevant
number. Design toward <150 ms, but do not quote that target as achieved before
the trace exists. The selected real-time executor must complete an
already-approved safe cycle if the upstream observer disappears.

**Done when:** a bench trace measures every leg (`screen/audio event -> fact ->
executor receipt -> actuator command -> observed result`), reports
p50/p95/p99/p99.9 per path, and the executor can complete an already-approved
safe cycle if its upstream link drops.

### P7 -- shadow campaign and bounded promotion

Run the complete controller with `act=false` first. Compare intended actions,
belief state, actual game state where video can establish it, timing margin,
and recovery count against the timer route on a monitor-stressing Night 5 or 7.
Only then enable the fast safety actions, then one cycle primitive at a time.

**Done when:** Plan 12's promotion gate accepts a named configuration and the
session corpus contains its raw facts, beliefs, plans, actions, and outcomes.

## Suggested order

1. Complete Plan 19 P1--P4 so video facts and their refusal semantics are
   real, then land P1/P3 of this plan against synthetic fixtures.
2. Build P2 and P4 together: the estimator's prediction must use the same
   definitions as cycle safety checks.
3. Add P5 and prove the disabled-observation and oracle controls before buying
   or wiring ESP32 hardware. **Done in the worktree:** the bounded exact-engine
   comparison now exists; full-night survival and device evidence remain
   separate gates.
4. Build P6 as a bench instrument, not a live bot.
5. Run P7 under Plan 12's evidence ladder.

## Success criterion

Success is not "a particular board pressed buttons." It is an auditable trace
showing:

1. what the controller believed before a cycle;
2. which observations and latency bounds justified that belief;
3. which alternatives were rejected and why;
4. which bounded cycle it selected;
5. whether every action visibly happened; and
6. how the next observation corrected the model.

That is the architecture that can adapt its cycles to the game while remaining
testable enough to trust on a real night.
