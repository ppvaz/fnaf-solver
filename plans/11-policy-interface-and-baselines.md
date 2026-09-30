# Exact-simulator policy interface and public-bot baselines

**Status: proposed 2026-08-26; packages 1-4 partially landed the same day.**
The repository has several focused policy and search tools, but no single
observation/action contract for comparing scripted, belief-state, and learned
policies. Public FNaF RL projects show the value of that interface and the
danger of silently changing the environment to suit it.

The adapter, the three reimplemented baselines and their measurement live in
[`packages/propose/parked/minus7/policy.mjs`](../packages/propose/parked/minus7/policy.mjs),
[`packages/propose/parked/minus7/policybaselines.mjs`](../packages/propose/parked/minus7/policybaselines.mjs) and
[`packages/propose/parked/minus7/policytest.mjs`](../packages/propose/parked/minus7/policytest.mjs). Package results are recorded
under each work package below. **Packages 5 and 6 are untouched, and packages
1-3 close only in part, so the plan is not done.**

**Suite entry still to be added** (this stream did not edit `tools/test.mjs`):

```js
['policytest', ['policytest.mjs', '--assert']],
```

It runs in about 1.4 s and needs no browser or phone.

## Goal

Expose the existing exact engine through a stable, replayable policy interface
without creating a second simplified simulator. Use it to compare this project's
policies with independently reimplemented public-bot strategy families and to
price real sensor/actuator errors.

## Design rules

- [`packages/source/src/games/fnaf2/plant-model.js`](../packages/source/src/games/fnaf2/plant-model.js) remains the sole mechanics authority.
- Observation modes may hide truth; they must never mutate underlying mechanics.
- RNG, sensor noise, and actuator noise use independent seeded streams.
- Every result states whether it used truth, belief, detector-like observations,
  or recorded device inputs.
- A Gymnasium adapter is optional compatibility, not the canonical API.
- Baselines are reimplemented from documented behavior. Do not copy code from
  repositories without a compatible license.

## Core interface

The minimal contract should support:

```text
reset(configuration, gameSeed, noiseSeed)
observe(mode)
decide(policy, observation, deadline)
step(action, duration)
snapshot() / restore(snapshot)
inject(fault)
explainTerminal()
metrics()
```

Support at least four observation modes:

1. `truth` — full engine state, for debugging and upper bounds;
2. `stock-belief` — only information the planned controller can maintain;
3. `sensor-model` — delayed/noisy/unknown observations drawn from measured plan
   09 reports;
4. `recorded` — observation and actuator events from one device session.

## Baselines

### Local baselines

- shipped Minus 7 schedule;
- current Night 6 device recipe with measured actuator layer;
- `gatebot` and closed gate-aware families, preserving their 0/150 result;
- BB visual/audio experimental policies with their existing clean, worst-case,
  false-cue, and missed-cue anchors;
- a truth-state upper bound used only to quantify the cost of perception.

### Public-bot-inspired baselines

- **Jason-style FNaF 2 phase loop:** coarse timed wind/vent/office/Foxy phases,
  cheap pixel-like observations, menu lifecycle outside the night policy;
- **Shooter25-style priority machine:** explicit Wind/Stalling/Checking/Blackout/
  vent states, run once with truth and once through stock-belief observations;
- **Couraeel-style emergency priority policy:** direct-state upper bound followed
  by an observation-constrained adaptation;
- **small external-bot lifecycle baseline:** relative setup, retry, and terminal
  stop inspired by the better FNaF 1 bots.

These are architectural experiments, not ports. Cite the research census and
record every behavioral assumption that cannot be derived from public source.

## Work packages

### 1. Freeze the policy protocol — gate met 2026-08-26; package partial

- Wrap current simulator construction, tick advancement, actions, RNG, and
  terminal reports.
- Add snapshot/restore with bit-identical continuation tests.
- Define action duration and overlapping-contact semantics once.
- Add a policy version and observation-mode stamp to every report.

**Gate:** existing tests and Minus 7 seed/worst-case results are bit-identical
through the adapter.

**Result (partial — the gate closes, the package does not).**
[`packages/propose/parked/minus7/policy.mjs`](../packages/propose/parked/minus7/policy.mjs) is the adapter. It creates no second
simulator: it wraps `Sim` construction, a frame-sorted action queue,
observation privilege, the error models and the terminal report, and the run
loop is `hid-device-pilot.mjs`'s (`schedule -> drain -> actuator.deliver() ->
tick()`). Action duration is defined once — `api.hold(frame, frames, act)` is
ONE scheduled row and therefore ONE error draw, so a hold keeps its length
under every error model, which is `human-gate.mjs`'s and
`packages/play/bin/phone/actuator.mjs`'s existing rule (plans/04: independent draws price
nothing). Every report carries the policy name and version, the adapter
version, the observation mode, the slack magnitude and shape, and whether the
device actuator was in the path.

The bit-identity gate is asserted, not asserted-by-eye:
`node packages/propose/parked/minus7/policytest.mjs --assert` replays 25 seeds of `bbtest.mjs`'s `run()`
against the same seeds driven through the adapter and requires the same
`won`/`frame`/`reason`/`detail`. It also requires that zero slack is an
identity in all three error shapes and that a zero-lateness `DeviceActuator` is
an identity for the Minus 7 schedule with no seam drops (the same claim
`packages/propose/test/test-actuator.mjs` makes for `pilottest`).

**Not done:** `snapshot()`/`restore()` and their continuation tests, and the
`sensor-model` and `recorded` observation modes. Only `truth` and
`stock-belief` (`belief`) exist.

### 2. Port local policies as equivalence fixtures — partial 2026-08-26

- Run existing policy tools through both their legacy path and the adapter.
- Compare survival, death reason/time, box/power minima, stalls, and actions.
- Keep specialized search tools; use the adapter as their shared execution
  contract, not as a forced general search framework.

**Gate:** any difference is explained and deliberately accepted or fixed before
adding new baselines.

**Result (partial).** One local policy is ported, and it is not a
reimplementation: the Minus 7 control in
[`packages/propose/parked/minus7/policybaselines.mjs`](../packages/propose/parked/minus7/policybaselines.mjs) **is**
`bbtest.mjs`'s `Bot`, handed a proxy `sim` that forwards its presses into the
adapter. There is therefore no equivalence to argue for at zero error — it is
the same object graph — and the 25-seed identity above proves the wrapper does
not perturb it. Human slack is applied by wrapping `Bot`'s four plan builders,
which is `human-gate.mjs`'s semantics (the SCHEDULED offsets move, then the
queue re-sorts) and `bbtest.mjs`'s own hook.

**Not done:** `gatebot`, `pilottest`, `hidpilottest` and the BB visual/audio
policies are not ported, so their published anchors are not yet reproduced
through the adapter. The Minus 7 device recipe is compared as a black box
through `human-gate.mjs`'s `modelGate()` instead of through the adapter,
because `recipe.replay()` builds its own `Sim` and has no actuator hook; that
is why the device plan has no actuator column below.

### 3. Add measured observation and actuator faults — partial 2026-08-26

Inject independently controllable:

- observation latency distribution and deadline expiry;
- false positive, false negative, unknown, and stale result;
- dropped or late contact;
- monitor forcedown and belief inversion;
- projection/helper/focus loss;
- controller pause, queue tail, and clock-offset uncertainty.

Support forced single faults before sampled compound distributions. A policy
that survives only average latency is rejected.

**Result (partial).** The adapter takes `deviceActuator`, which is
`packages/play/bin/phone/actuator.mjs` unchanged: measured launch lateness (110-300 ms)
and the measured mask-seam monitor drop, through one order-preserving queue.
One wall-timed launch is charged per DELIVERY frame, uniformly for every
policy, so the actuator column compares like with like rather than rewarding a
policy for batching its rows.

Belief inversion is modelled and is the point of the `belief` mode: the
controller's self-state is updated when a row is DISPATCHED, not when the
engine accepts it, so a monitor press the phone drops still flips the
controller's belief — CLAUDE.md's "one lost monitor press inverts the rest of
the night, and nothing in the run notices".

Execution error itself now has three explicit SHAPES rather than one, because
CLAUDE.md already says the shape decides the answer ("iid is the wrong shape —
humans clear at per-step error the iid model calls fatal"): `iid` (one draw per
row, `human-gate.mjs`'s model), `correlated` (one draw per decision plus a
third of the magnitude per row, `bbtest.mjs`'s model), and `common` (the shared
draw alone). Each has its own seeded stream and never touches `sim.rng`.

**Not done:** observation latency and deadline expiry, false positive/negative/
unknown/stale sensor results, forced single faults, projection/helper/focus
loss, controller pause and clock-offset uncertainty. Nothing here yet consumes
a plan 09 distribution, and there is no p99/tail rejection rule.

### 4. Implement and explain public-bot baselines — landed 2026-08-26

For each baseline, publish:

- source artifact and research summary;
- observation privileges;
- timing/coordinate assumptions translated into engine actions;
- unsupported mechanics or ambiguous branches;
- ordinary, pinned-worst, and fault-injected results;
- minimized representative death traces.

The Jason-like baseline is first because it is the nearest source-available
stock FNaF 2 comparator and its reported roughly one-in-three success provides
an external sanity target, not an expected exact match across PC and Android.

**Result (2026-08-26).** Three families are reimplemented in
[`packages/propose/parked/minus7/policybaselines.mjs`](../packages/propose/parked/minus7/policybaselines.mjs) from this
repository's own reconstructions — the census, the implementation comparison,
and `docs/in-engine/SHOOTER25-BOT-STATE-MACHINE.md` — with no source read from
any of those projects. Every value the public description does not determine is
marked `[GUESS]` at its site.

**EVERY NUMBER BELOW IS IN THE SIMULATOR.** `policytest.mjs` counts frames the
way `pilottest`/`hidpilottest` do: a press and a sensor read both look free.
None of this is a device clear or a claim about one.

#### Survival by night, exact replay, no execution error (100 seeds a cell)

| policy | privilege | n1 | n2 | n3 | n4 | n5 | n6 | n7 |
|---|---|---|---|---|---|---|---|---|
| Minus 7 (`bbtest` `Bot`) | truth | 100 | 93 | 74 | 73 | 86 | 93 | **100** |
| Minus 7 device plan (`recipe.mjs`) | open loop | — | — | — | 100 | 100 | 100 | **100** |
| Jason-style, 10 s phase | belief | 55 | 4 | 0 | 0 | 0 | 0 | 0 |
| Jason-style, 5 s phase | belief | 85 | 55 | 11 | 15 | 0 | 0 | 0 |
| Shooter25-style (literal) | truth | 96 | 81 | 85 | 83 | 63 | 18 | 0 |
| Shooter25-style | belief | 96 | 81 | 85 | 83 | 63 | 15 | 0 |
| Couraeel-style | truth | 100 | 77 | 86 | 93 | 88 | 0 | 0 |
| Couraeel-style, 2x hall rate | truth | 100 | 95 | 94 | 97 | 76 | 0 | 0 |
| Couraeel-style | belief | 48 | 0 | 3 | 0 | 0 | 0 | 0 |
| **C1** no inputs at all | — | 17 | 0 | 0 | 0 | 0 | 0 | 0 |
| **C2** a perfect box, nothing else | — | 69 | 0 | 0 | 0 | 0 | 0 | 0 |
| **C3** the same ladder, inverted | — | 69 | 0 | 0 | 0 | 0 | 0 | 0 |
| **C4** Minus 7, camera flashes deleted | — | 5 | 0 | 0 | 0 | 0 | 0 | 0 |
| **C5** Shooter25 with the danger test hoisted | — | 92 | 78 | 71 | 69 | 45 | 0 | 0 |

The Minus 7 row is not monotone in the night, and that is the cycle table
talking, not the engine: `DEFAULT_CYCLE` was searched against Night 7, and
nights 3-4 move `entryStreakFrames`, `toyBonnieOpeningFrames` and the mask
grace out from under it.

#### Degradation under execution error (100 seeds a cell, `iid` shape)

`iid` is `human-gate.mjs`'s model: one independent draw per scheduled row.

| policy | night | ±0 | ±20 | ±40 | ±60 | ±100 |
|---|---|---|---|---|---|---|
| Minus 7 (reactive) | 4 | 73 | **0** | 0 | 0 | 0 |
| Minus 7 device plan | 4 | 100 | 99 | 86 | 85 | 40 |
| Shooter25-style | 4 | 83 | 84 | 85 | **77** | 62 |
| Couraeel-style | 4 | 93 | 89 | 79 | **80** | 81 |
| Couraeel-style 2x | 4 | 97 | 90 | 94 | **85** | 82 |
| Jason-style 5 s | 4 | 15 | 12 | 13 | 16 | 9 |
| Minus 7 (reactive) | 5 | 86 | **0** | 0 | 0 | 0 |
| Minus 7 device plan | 5 | 100 | 97 | 84 | 78 | 35 |
| Shooter25-style | 5 | 63 | 66 | 60 | 54 | 36 |
| Couraeel-style | 5 | 88 | 69 | 75 | 72 | 60 |
| Minus 7 (reactive) | 6 | 93 | **0** | 0 | 0 | 0 |
| Minus 7 device plan | 6 | 100 | 58 | 46 | 46 | 15 |
| Shooter25-style | 6 | 18 | 31 | 12 | 1 | 0 |
| Couraeel-style | 6 | 0 | 3 | 2 | 2 | 2 |
| Minus 7 (reactive) | 7 | 100 | **0** | 0 | 0 | 0 |
| Minus 7 device plan | 7 | 100 | 18 | 12 | 12 | 5 |
| every reimplemented baseline | 7 | 0 | 0 | 0 | 0 | 0 |

Under the `common` shape (the whole pass translated, no differential error at
all) the reactive Minus 7 row is flat instead: 100/100/100/100/92 at Night 7
across the same magnitudes. The entire cliff is DIFFERENTIAL error, and it is
one seam: `DEFAULT_CYCLE` taps mask-off at frame 24 and puts the hall flash at
frame 40, while `MASK_ANIM_OFF` is 15 frames — one frame of margin, and on
Android every office light is gated on `mask = 0` (g75/g84). `C.STEP_WINDOWS`
already prices that pair at ±0.050 s each, the tightest in the table. So
`bbtest.mjs`'s published jitter curve (200/200 at "±60 ms") and the ±20 ms
collapse here are not in conflict: `bbtest`'s draw is a single per-pass offset
whose integer spread term rounds to zero at that magnitude, i.e. it is the
`common` shape.

#### Through the measured device actuator (100 seeds a cell)

`packages/play/bin/phone/actuator.mjs`: launch lateness 110-300 ms, one wall-timed launch
per delivery frame, the measured mask-seam monitor drop, one order-preserving
queue.

| policy | n4 | n5 | n6 | n7 | seam drops (all nights) |
|---|---|---|---|---|---|
| Minus 7 (reactive) | 0 | 0 | 0 | 0 | 4 |
| Jason-style 10 s | 0 | 0 | 0 | 0 | 0 |
| Jason-style 5 s | 10 | 1 | 0 | 0 | 0 |
| Shooter25-style | 0 | 0 | 0 | 0 | 0 |
| Shooter25-style (belief) | 0 | 0 | 0 | 0 | 0 |
| Couraeel-style | **25** | **5** | 0 | 0 | 0 |
| Couraeel-style 2x | 17 | 0 | 0 | 0 | 0 |
| Couraeel-style (belief) | 0 | 0 | 0 | 0 | 0 |

The Minus 7 zero is the result CLAUDE.md already records for the open-loop
pilots ("under it the shipped n6 target goes 500/500 -> 0/200"), and it means
the same thing here: none of these policies models the live runner's
checkpoint read and verified recovery, so this column prices OPEN-LOOP
execution, not the runner. What it does compare fairly is the families against
each other under the same phone, and there the ordering is the threshold
policies' — Couraeel-style is the only family with any survival left, and
Shooter25-style loses everything despite tolerating ±100 ms of iid slack at
62/100 on the same night. The difference is that the actuator's error is
one-sided lateness with a 205 ms mean, which is a PHASE SHIFT against the 5 s
grid, and Shooter25-style's gates (`phase < 2000`, `phase >= 4800`) are
absolute-time. Symmetric slack averages out against a phase gate; a mean
lateness does not.

#### The finding

**Threshold policies are far flatter under execution error than the scripted
cycle — and it does not matter at Night 7, because they cannot clear it at
all.** Both halves are load-bearing:

1. Where the reimplemented baselines are alive (nights 4-5) they are nearly
   error-insensitive: Shooter25-style loses 6 points of survival going from
   ±0 to ±60 ms iid, Couraeel-style 13, Couraeel-2x 12. The reactive Minus 7
   cycle loses **all** of it between ±0 and ±20. That is the shape the mission
   was looking for, and it reproduces at three nights.
2. The shipped **device plan** is already most of the way there without
   changing shape: it is the same Minus 7 route with the Golden Freddy flick
   compiled into a `maskraise` compound row, so the fatal seam takes one draw
   instead of two, and it holds 85/100 at Night 4 and 46/100 at Night 6 under
   ±60 ms where the reactive cycle holds none. The route's slack tolerance is
   a property of how the rows are GROUPED, not of whether the policy is
   scripted.
3. At Night 7 the binding constraint is not precision at all. Foxy takes
   71-100% of every reimplemented baseline's Night 7 deaths (Jason 10 s
   100/100; Jason 5 s 95; Shooter25 71, with 15 office entries and 14 Puppet;
   Couraeel 80, with 20 Puppet). His equation
   (`21 + Random(5) - D <= 17`, `D` climbing one per second, checked at every
   5 s movement tick) needs a hall reset placed at least ~1 s after each tick
   and no more than 5 s from the last — a PHASE constraint, not a rate. Minus 7
   satisfies it structurally by anchoring everything to `:X2`/`:X7`; a
   threshold policy's hall flash drifts against that grid and eventually lands
   in the forbidden first second. Doubling the rate (`couraeel-2x`) does
   convert Foxy deaths into Puppet deaths (Night 7: 80 Foxy/20 Puppet becomes
   26 Foxy/74 Puppet) — the box cannot pay for the extra office time. That
   trade is the Night 7 wall, and no reconstructed policy shape crosses it.

So the answer to "is the route shape the problem?" is **no, not at Night 7**.
The shape question is real and the measurement is real, but it is answered at
nights 4-6; at Night 7 the Foxy/box budget rejects every shape we can build
from published behaviour, including the ones that tolerate error best.

#### Observation privilege, and what perception costs

Shooter25-style scores identically on `truth` and on stock-belief at nights 1-5
(96/81/85/83/63 both ways) and within 3 points at Night 6. Its decisions are
phase-driven, so it is almost an open-loop policy wearing a state machine —
which makes it the cheapest of the three to put on a phone. Couraeel-style is
the opposite: 93 -> 0 at Night 4 when the same ladder is denied truth. The
single dominant cost is the mask: with truth it unmasks the moment the opening
clears, and without a mask-duration sensor it must budget the worst case
(five continuous ticks can span 5.98 s), and those seconds are seconds Foxy's
`D` is uncovered. That is the concrete perception requirement a reactive stock
controller would have to buy — and plan 08's vent-bang cue is exactly the
sensor that would buy it.

#### Controls

A favourable number is not a result until something that should not produce it
has been checked (CLAUDE.md). Five negative controls and one positive, all
asserted by `node packages/propose/parked/minus7/policytest.mjs --assert`:

- **C1 null policy** — no inputs at all. 0/100 from Night 2 on. If this scored,
  the engine, not the policy, would be doing the work.
- **C2 wind-only** — a perfect music box and nothing else. 0/100 from Night 2
  on, so no policy's score is coming from the box.
- **C3 inverted ladder** — the *same* Couraeel action vocabulary with the
  urgency order reversed. 100 -> 69 at Night 1 and 0 everywhere else, against
  the upright ladder's 100/77/86/93/88. The ordering is what earns the score,
  not the actions.
- **C4 Minus 7 with the three camera flashes deleted** — 5/100 at Night 1,
  0 elsewhere, against 100/93/74/73/86/93/100. The stun-lock is doing the work
  the strategy claims it does.
- **C5 Shooter25 with the danger test hoisted** — see the deviations below.
- **Positive control: Night 1.** Night 1's AI table cannot arm Balloon Boy at
  all and holds Foxy's `D` at zero, so a baseline that cannot clear it is
  failing of its own defects. All three families clear ≥ 92/100 there; the
  suite fails below 22/25.

Two more controls are structural rather than statistical: the adapter must
reproduce `bbtest.mjs` night-for-night at zero error, and `belief` mode must
never hand a policy Foxy's `D` or Balloon Boy's route stage (both are asserted).

#### Where the reimplementations had to guess

A guessed detail that flatters the local route is the failure mode of this
exercise, so every one is listed. None of them favours Minus 7; two of them
were tried the other way and made the baseline WORSE, which is recorded rather
than quietly dropped.

| Guess | Family | Why it was needed |
|---|---|---|
| Office-block offsets (drop, flick, strobe, two vent reads, raise) | Jason | The description gives "time gates near the beginning, middle and end" of a ~10 s phase, not offsets. The order is forced by Android's `mask = 0` light gate, not chosen. |
| A 5 s phase variant | Jason | Foxy's equation makes one hall reset per 10 s insufficient on this model whatever else the loop does. Both 10 s and 5 s are reported; neither clears past Night 4. |
| Monitor and mask as guarded toggles | Jason | On PC they are hover positions and idempotent. On Android they are toggles, so each polarity change is guarded by believed state. This is the one place the reimplementation cannot be literal. |
| Wind re-enters Checking on the camera-down edge | Shooter25 | The extraction only proves the 21 s startup gate into Checking. A Wind loop that never masks hands Golden Freddy the night. |
| Vent Character entered on a vent read | Shooter25 | The extracted entries into that state are practice/debug key codes, not observations. |
| "music button value" read as box charge scaled to 0..2000 | Shooter25 | The mod's two counters are not distinguished by the extraction. |
| The response latch (flag 4) and value 6 are NOT implemented | Shooter25 | The extraction does not establish value 6's role. In the mod they shortcut out of Checking substates 1 and 3; here the machine always completes its vent scan. Recorded rather than approximated. |
| Emergency thresholds (6.0 s patrol, 4.6 s hall, 0.45/0.92 box) | Couraeel | The recreation's own numbers are properties of that recreation. These come from this repository's mechanics instead: the 400-frame stun, Foxy's equation, and the box drain/wind rates. Stated once, not searched. |
| The mask recovery owns a hall reset | Couraeel | Minus 7 §6 spends the mask-off animation on a held hall light for exactly this reason. Without it the emergency response leaves Foxy uncovered and the policy dies to its own rescue. |
| True preemption of the blackout rung | Couraeel | A commitment window measured in seconds swallows a 45-frame fuse. An "emergency priority" policy that cannot interrupt itself is not one. |

Two deviations were tried and **measured worse**, and are kept as controls
rather than adopted:

- **C5, hoisting Shooter25's `in danger` test out of `Checking`.** The
  extraction lists it only inside `Checking`, which means the literal machine
  cannot answer a g718-721 forcedown blackout raised while it is winding.
  Repairing that looks obvious and costs it Night 5 (63 -> 45) and Night 6
  (18 -> 0). `shooter25` runs the literal reading.
- **`couraeel-2x`, doubling the hall-flash rate.** It is better at nights 2-4
  (95/94/97 against 77/86/93) and worse at Night 5 (76 against 88), and at
  Night 7 it only exchanges Foxy deaths for Puppet deaths. Both are reported.

#### Not done in this package

Minimized representative death traces, and pinned-worst (`worst: true`) sweeps.
The adapter takes `worst`; nothing in the report exercises it yet.

### 5. Add policy differential and counterfactual reports

- Replay the same seed and noise trace across policies.
- Snapshot immediately before a death and try bounded alternative decisions.
- Minimize a failing observation/action trace.
- Attribute failures to mechanics, policy, observation, actuator, or lifecycle.
- Report resource and reaction costs, not survival alone.

### 6. Optional Gymnasium compatibility

Only after the canonical interface and baselines pass:

- provide discrete or parameterized action spaces;
- expose truth and partial observations as explicitly different environments;
- support deterministic reset/seeding and episode recording;
- add heuristic/random baselines before any learned result;
- never describe simulator reward as stock-game performance.

RL promotion requires a policy to beat a scripted baseline on held-out noise/
session distributions and pass the same exact-model safety suite. Model-free RL
is not required for this plan to finish.

## Metrics

- survival and terminal reason/time;
- box and flashlight minima;
- camera-stall lapses and uncovered threat transitions;
- action count, contact time, and deadline slack;
- observation count, unknowns, stale/late results, and verification retries;
- belief-versus-truth divergence duration;
- recovery success/cost;
- results by game seed, noise seed, policy version, and observation mode.

## Deliverables

- canonical policy adapter and schema;
- snapshot/restore and deterministic replay tests;
- local-policy equivalence report;
- measured fault-injection layer consuming plan 09 distributions;
- Jason-, Shooter25-, and Couraeel-inspired reports;
- optional Gymnasium wrapper only if the core contract stays exact;
- documentation that keeps simulation, stock-device, and modified-game results
  visibly separate.

## Done when

- ~~every compared policy runs on the same exact engine and seeded fault
  trace~~ — met for the policies in `policybaselines.mjs`; the Minus 7 device
  plan is still compared through `human-gate.mjs` rather than the adapter;
- ~~truth and stock-observable privileges cannot be confused in output~~ — met:
  every report stamps its mode, and `--assert` fails if `belief` leaks a
  truth-only field;
- ~~current policy results remain reproducible~~ — met for `bbtest.mjs`
  (25-seed bit-identity); not yet checked for `gatebot`, `pilottest` or
  `hidpilottest`;
- ~~at least one public-bot-inspired baseline has an explained ordinary,
  worst-case, and fault-injected result~~ — **partly**: three baselines have
  explained ordinary and fault-injected results; none has a pinned-worst
  (`worst: true`) sweep;
- a real run from plan 09 can be replayed through the interface — **not done**;
- the interface can reject a policy because of p99/tail faults rather than
  average behavior alone — **not done**.

## Non-goals

- proving PC and Android implementations are identical;
- matching another author's reported success percentage exactly;
- replacing source provenance with empirical tuning;
- calling direct-state or simulator success a stock-game clear;
- requiring neural RL where deterministic search is stronger.
