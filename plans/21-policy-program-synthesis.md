# Policy-program synthesis and search-to-device equivalence

**Status: proposed 2026-08-29, Pedro's directive.** Build an invention engine
that searches complete, auditable night programs—not timing knobs inside one
hand-authored loop—and guarantees the device executes the same program that the
exact engine evaluated.

## Goal

Given sourced mechanics, calibrated actuator constraints, and an explicit
observation budget, synthesize structurally distinct candidate policies; replay
them in the exact engine; prune dominated candidates; and compile a promoted
candidate into the phone runner without changing its meaning.

The initial target shape is exemplified by Night 1 Minimal Minus Toys:

```text
idle until 115 s
arm the split camera state
repeat every 5 s from 140 s to 360 s:
  refresh CAM 09 light
  wind the box
finish at 360 s:
  lower the monitor
observe without input through 420 s
```

That is a program with phases, a setup action, a periodic body, a terminal
action, and an observation tail. It is not recoverable from the old search
space, which represented a fixed cycle plus timing knobs.

## Non-goals

- Do not use unrestricted natural-language generation as the controller.
- Do not treat unsourced mechanics, invisible state, or unmeasured device
  actions as searchable facts.
- Do not promote a simulator winner directly to a live-night claim.
- Do not keep separate hand-maintained definitions for simulator policy,
  emitted plan, and phone execution.

## Policy IR

Use a versioned plain-data policy program. A program contains:

- metadata: strategy family, game/night scope, source dependencies, calibration
  profile, and policy hash;
- phases: `idle`, `setup`, `repeat`, `finish`, and `observe` with absolute or
  derived time bounds;
- typed actions: monitor/mask/camera/light/wind plus their expected visible
  result, resource cost, and action-lock constraints;
- observations: allowed sensor fact, latest acceptable age, confidence floor,
  and whether it may alter control or only record evidence;
- proof obligations: model gate seed sets, device-contact limits, end-state
  requirements, and a trace equivalence check.

The IR is deliberately finite and auditable. It can express a policy as data,
but not arbitrary shell commands or unbounded branching.

## Work packages

### P1 — versioned policy-program schema

Define the JSON/plain-data schema, canonical serialization, program hash,
source-dependency record, and replay fixtures for idle/setup/repeat/finish/
observe. Port the current device-plan headers into this schema rather than
adding another format.

**Done when:** the Night 1 minimal policy serializes and round-trips with the
same phases, action timestamps, and terminal observation window.

### P2 — one semantic interpreter — DONE (initial target, worktree)

Implement the IR evaluator on top of `Sim`. It must derive action events,
resource accounting, and expected control state from the program; no strategy
may carry a second inline timeline.

**Done when:** existing Minus 7, standard Minus Toys, and Night 1 minimal
replay identically to their current gated behavior or have a documented,
source-backed semantic difference.

The finite interpreter and exact-engine adapter are now in
`tools/device/policy-interpreter.mjs`. The initial Night 1 Minimal target is
equivalence-gated against `schedule()` frame-for-frame, including release/press
seams, and reaches the same `Sim` terminal state. Standard Minus Toys and the
separate Minus 7 policy family remain explicit follow-on ports rather than
being silently claimed by this initial target.

### P3 — structural policy grammar — DONE (worktree)

Define a small grammar for legal synthesis moves: choose sourced setup target,
idle/loop/finish boundaries, cycle period, action primitives, bounded proof
visits, and safe observation tails. Encode known-family fingerprints so the
search labels a rediscovery rather than calling it novel.

**Done when:** the grammar generates the existing families, rejects impossible
action orderings, and identifies each known family from its canonical IR.

**2026-09-02 — the grammar gains its first conditional construct.** Until this
date the grammar could not express a branch on an observable fact at all: the
five phases are unconditional, and `observations` were recorded and never read.
`policy-grammar.mjs` now accepts `branches` on a `repeat` body, validated
through `packages/propose/src/policy/observation-language.js`
(`observation-language-v1`): a branch names one admissible fact, one predicate
from a finite UNKNOWN-total vocabulary, and two reviewed arms that must leave
the same control state as each other and restore the monitor/mask mode they
started from. A fact is admissible only when its read cost is measured — which
excludes all four audio facts as `UNKNOWN` — and a branch may not demand a fact
fresher than one sample interval plus one read, nor act sooner after its
observation than one read costs. `tools/observationlanguagetest.mjs` pins the
budget, the two rules, the grammar constraints, and the duplicate control.

The Minus 7 family is still unported, and the branch construct has no evaluator:
see P2 below.

`tools/device/policy-grammar.mjs` builds the finite five-phase program shape,
requires a named sourced setup target, checks action timing/overlap and
engine-shaped monitor/mask/camera ordering, and fingerprints the current
Minus Toys Minimal family. `tools/policygrammartest.mjs` includes duplicate and
illegal-order controls; the standard Minus Toys and separate Minus 7 families
remain explicit follow-on ports as documented under P2.

### P4 — constrained structural search — DONE (initial target, worktree)

Enumerate or beam-search grammar candidates with exact-engine replay, worst
controls where meaningful, actuator/contact constraints, resource margins,
and Pareto/dominance pruning. Persist every candidate, rejection reason, and
dependency set.

**Done when:** one reproducible campaign returns a frontier with both positive
controls and known negatives, and no candidate is admitted solely because an
unmodelled device behavior was assumed.

`tools/device/policy-search.mjs` enumerates caller-declared period/action
mutations, validates the structural grammar, checks device-plan equivalence and
contact floors, replays the exact engine, and Pareto-prunes accepted results.
`tools/policysearchtest.mjs` persists a reproducible Minimal positive plus
dropped-wind/period negative campaign with source and calibration provenance.
This closes the initial policy target's infrastructure; the broader
1200-seed invention campaign, additional policy families, and device promotion
remain P6/P7 work.

### P5 — compiler equivalence gate — DONE (initial target, worktree)

Compile the same IR to (a) simulator events, (b) the device plan, and (c) a
mocked phone-interpreter trace. Compare timestamped actions, phase boundaries,
touch releases, terminal actions, and observation windows byte-for-byte within
declared clock rounding.

**Done when:** a test would have rejected all three Night 1 defects found on
2026-08-29: early arm, hard-coded 10 s cadence, and missing terminal/observe
tail.

`tools/device/policy-equivalence.mjs` compiles the policy to the device-plan
text, parses that text through a finite mocked phone interpreter, and compares
its semantic events with the IR compiler. `tools/policyequivalencetest.mjs`
also runs the shipped emitter and rejects each of the three named Night 1
defects. This closes the initial Minimal target; broader policy-family ports
remain open.

### P6 — safe device execution contract — DONE (initial target, worktree)

Make the runner consume only a compiled IR artifact, record its hash in the
session manifest, and separate low-cost capture from opt-in bounded grading.
The runner must finish all terminal actions, remain hands-off during declared
observation phases, and never launch unbounded host analysis automatically.

**Done when:** a device session can prove it ran the compiled program while the
host remains responsive; post-run analysis is an explicit, resource-capped
operation.

`tools/device/policy-artifact.mjs` now binds canonical `policy-v1` bytes to the
compiled device plan, carries both hashes in the plan, and refuses altered
artifacts or projections. The Night 1 Minimal branch of `trial.sh` consumes
that artifact, records the policy and plan hashes plus the retained artifact in
the session manifest, verifies the remote plan hash after `adb push`, and keeps
`GRADE_RUN=0` as the low-cost default; grading remains an explicit opt-in.
`tools/policyartifacttest.mjs` covers the mutations and runner wiring without a
phone. A physical run is still required before any live-device claim, and the
standard Minus Toys/Minus 7 routes remain on their pre-IR paths until their
family ports are complete.

**2026-09-02 — P2 must be reopened for branches before P7 can run.**
`compilePolicy` compiles one unconditional event stream. Flattening a branch
into either arm would replay a different program under the branched program's
name, so `compilePolicy` and `compileDevicePlan` now **refuse** a branched
program instead. A branched interpreter — one that reads facts through
`packages/core/src/sensing/observer.js` as the night runs, at the measured
cadence, and honours `maxAgeMs`/`confidenceFloor`/UNKNOWN — does not exist. It
is the prerequisite for P7 and for ROADMAP B2.

### P7 — invention campaign and promotion

Run the new grammar against a scoped target (story Nights 1–5 first), inspect
survivors, source every novel mechanic, and promote only candidates that pass
P5 then shadow/device evidence under Plan 12's claim ladder.

**Done when:** the campaign publishes either one structurally distinct,
evidence-backed candidate or a complete negative frontier explaining why every
legal family was rejected.

## Dependencies

P1–P2 are the foundation. P3–P4 depend on exact semantic replay; P5 binds
search to execution and must precede live promotion. P6 depends on P5 and
Plan 09's manifest contract. P7 depends on all earlier packages plus Plans 11
and 12 for fair baselines and claims.

Plans 19 and 20 remain complementary: they provide facts, uncertainty, and
short-horizon decisions. This plan provides the policy-program language and
the invention/equivalence discipline beneath them.

## The A2DP phase-clock estimator — specification (Pedro, 2026-08-30)

Placing the phase estimator after the Bluetooth receiver is the most practical
non-root architecture available:

```text
game 2 Hz winding ticks -> phone A2DP encoder -> BT transport + jitter buffer
-> BlueALSA PCM receiver -> matched-filter tick detector
-> latency-compensated phase estimator -> planner/actuator clock correction
```

The tick already survives Bluetooth (matched NC 0.44–0.56 through aptX HD →
BlueALSA, `ANDROID-AUDIO-CAPTURE.md` §"The A2DP mix DOES carry the
fast-mixer SFX"). **The corrector does not eliminate Bluetooth latency — it
estimates the game clock through it.** A stable 210 ms delay is a shifted
clock with period and drift intact; a delay wandering 170–260 ms is phase
uncertainty, which is what the estimator must report.

- **Estimator output:** `phase`, `period`, `uncertainty`, `locked` — fit as
  `received_tick[k] = phase + k·period + noise`. A PLL-like estimator folds
  **6–12 consistent ticks** before declaring lock (single ticks jittered
  ~66 ms in the hand-wound take — the same order as the policy's 66 ms phase
  basin), rejects low-confidence and off-grid peaks, and keeps updating while
  winding.
- **Lock states:** `UNLOCKED → ACQUIRING → LOCKED → STALE`. A discontinuity,
  long silence, or large residual forces reacquisition — A2DP suspends on true
  silence and may resume with a new buffer delay, so a pre-suspend latency
  calibration is not automatically valid. Until relocked, consumers use a
  widened phase range and behave conservatively.
- **The 500 ms parity ambiguity:** the audio grid identifies phase mod
  500 ms; BB's counter ticks at 1 s and movement checks at 5 s, so which
  alternating tick is the one-second boundary needs a slower anchor
  (start-of-night calibration, an AM-hour transition, a simultaneous visual
  event with known grid semantics, or a controlled calibration run). Once
  parity is fixed, the 2 Hz audio holds the fine phase.
- **Correction protocol:** never move committed actions. Emit
  `{ phaseOffsetMs, phaseUncertaintyMs, driftPpm, gridParity, validFrom: next
  cycle boundary }` and let the scheduler re-anchor the next safe cycle (the
  ESP32 applies it to its monotonic clock; a PC planner applies it directly).
- **Suitable for:** deciding whether a scheduled mask covered four or five BB
  ticks; correcting persistent misalignment; preventing unnecessary
  interventions on every BB visit; tracking gradual drift. **Not suitable
  for:** sub-50 ms emergency reactions; firing off a single received tick;
  trusting a stale latency calibration after an A2DP resume.

**Proof ladder for the phase-clock work** (pairs with the coverage-gate
results above): (1) perfect-phase oracle as upper bound; (2) fixed
wrong-phase control reproducing repeated interventions; (3) estimated clock
with offset+drift uncertainty; (4) safe-boundary re-anchoring; (5) measure
survival, interventions per visit, and false-intervention rate.

### Host integration landed — 2026-08-30

`WindTickFactAdapter` now binds the fact-link envelope to this estimator. It
advances the clock only for an `OBSERVED`, boolean-true `wind-tick` and uses
the host receiver timestamp, not the event timestamp, as its monotonic input.
UNKNOWN facts and unrelated fact types are visible non-samples; non-increasing
receipt times and invalid confidence are refused before estimator mutation.
This is still a phone-free host contract: it does not detect audio, calibrate
the A2DP delay, assign one-second parity, or authorize a live action.

`capture-bt-audio.sh --check` is the matching physical-route preflight. It
reports `READY` only when the expected BlueALSA source PCM answers `info`, and
reports `UNKNOWN(a2dp-source-not-connected)` with exit status 3 otherwise.
The preflight creates no output and does not stop `bluealsa-aplay`; a real
capture remains gated on that check.

## First seed facts: the Night 2 vent-threat conflict (2026-08-30)

The reactive BB-only build (`VentThreatReactive`, `src/controller.js`;
`tools/ventreacttest.mjs`) measured the constraint system a Night 2 program
must satisfy — four demands on one monitor-down/up boundary, which is why
hand-tuned cycles keep failing and why this plan's structural search is the
right instrument for the resolution:

1. **BB eviction budget:** 5 *consecutive* fully-on mask seconds (g907 →
   v12 ≥ 5; g293 zeroes the counter on every re-entry). The nominal 10 s
   cycle window is only ~4.8 s after the ON animation, and exact coverage must
   use the actual independently shifted ON/OFF rows. Mangle now has an
   audio-only static fact in the engine/controller gate; there is still no
   calibrated visual occupancy fact, and the device audio context separation
   remains an evidence task.
2. **Foxy D deadline:** D climbs ~1/s whenever Foxy is not dormant
   (`engine.js:669`), is zeroed only by the hall pulse (`:679`), and the hall
   cannot fire while masked or cams-up. Measured: one 5.7 s mask extension
   past the hall slot took D 0→10 → gotYou → death 10 s later (foxy:294/300
   in the first controller cut, vs 300/300 base). The hall slot sits ~300 ms
   after the scheduled mask-off (`hallOffsetMs 9500` vs `maskOffMs 9200`) —
   the eviction's 5th tick and the hall deadline land on top of each other.
3. **Wind duty:** the mask blocks every non-mask action (`engine.js:270`), so
   mask time is unwound time, against Puppet AI 5 and a 50 s box. The first
   cut also suppressed the schedule through verify/restore, dropping a wind
   cycle per rescue: 8/300. Suppression must end at the drop.
4. **BB walk-in edge:** one cams-up while he is at the opening walks him in
   permanently (`engine.js` `onCamsUp`) — the flashlight dies for the night
   and Foxy finishes. Cams-up continuous time is bounded whenever his route
   is live (AI 3 from 1 AM, g676).

### The eviction decision is a priced choice, not a reflex (Pedro, 2026-08-30)

"We never do a calculation to decide when it's worth to evict" — correct, and
it is the missing planner input. The three options price out as:

| option | cost | outcome |
|---|---|---|
| ignore (raise) | none now | BB inside, permanent; flashlight dead → hall unusable → Foxy unresettable → P(death) ≈ 1 |
| delay (hold cams down) | 40 units/s, no wind | Puppet inside 50 s — dominated |
| evict (pulse + 5-tick hold) | ~6.3 s mask ≈ 250 units + 1 pulse; D bill prepaid (0→~6 vs lock ~20) | BB gone, night unchanged |

On Night 2 evict dominates, so a reflex happens to be correct — but only
because Night 2's constants make it so. The calculation becomes load-bearing
on Nights 4–5 (Foxy 7 shrinks the D budget to a couple of seconds of hold;
Mangle 5/10 multiplies rescue frequency; Toy Chica shares the counter), and it
is exactly Plan 20 P5's worst-case selection over the belief (box fraction,
Foxy loc/D, threat set) choosing among cycle primitives. This plan's IR
expresses the same choice as typed actions with resource costs and proof
obligations. One sourced multiplier the calculation must carry: **v12 is a
single shared counter** (g907/g294) — one hold evicts BB, Mangle and Toy
Chica simultaneously, so a second concurrent vent threat has marginal cost
≈ 0.

Consequence for the grammar (P3): Night 2 feasibility requires per-cycle
monitor-down time ≥ max(5 mask ticks when a vent threat is present, one hall
pulse) with the pulse placed after any mask release, and monitor-up time
bounded below by the box arithmetic and above by the walk-in edge. The
reactive extension is an observation-gated branch with a hard deadline, not an
unbounded hold.

**Iteration record (same day, three cuts, each measured at the story Night 2
table — `tools/ventreacttest.mjs`):**

1. *Blunt pre-emption* (mask ~6.8 s, schedule frozen through verify): 8/300 —
   dropped a wind cycle per rescue; the Puppet collected.
2. *+ pre-mask hall pulse (Pedro's play) + schedule frozen only while the mask
   is up:* Foxy fixed (294 → 16-18 deaths), still 6-9/300 — the box tax
   remained.
3. *+ coverage gate (historical pre-audit cut):* the scheduled mask window CONTAINS five tick boundaries
   when phase holds (fully-on :X4.7 → :X5..:X9, eviction just before
   mask-off) — so count the boundaries; ≥5 means stand down and spend
   nothing. Zero-jitter **276/300**, refuting the apparent geometry wall.
   Two policy negatives remain documented in the tool (box margin under
   repeated rescue and the mixed ensemble not improving). The noisy-anchor
   check is now an ordinary passing robustness assertion at its declared
   five-point threshold; it is not evidence that the ensemble is phase-only.
   The later endpoint/transaction/UNKNOWN fixes intentionally invalidate this as
   a current release number; rerun the full corrected gate before quoting it.

**The diagnosis after cut 3 is a phase-estimation candidate, not a settled
causal result:** the ensemble's collapse is consistent with sustained phase
error, but it also mixes rescue cost, independent action jitter, endpoint
semantics, stale cue retriggers, and UNKNOWN polarity. The estimator remains
strongly motivated; its clean proof ladder must separate those controls before
the survival loss is attributed to phase alone. The corrected coverage gate is
uncertainty-aware (lo/hi boundary range: stand by / full rescue / bounded
extension), latches per visit, and requires a safe re-anchor for any timing
change that stays long on the monitor.
