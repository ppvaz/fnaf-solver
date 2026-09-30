# FNaF bot implementation comparison

*Companion to the [franchise-wide census](FNAF-BOT-CENSUS.md), researched
2026-08-26.*

## Result

This repository is strongest at **mechanics reconstruction, reproducible
simulation, strategy proof, human training, and safety-gated Android tooling**.
It is not currently the strongest demonstrated gameplay bot: it has no recorded
full-night stock-device clear and no complete live reactive controller.

The closest source-available stock FNaF 2 competitor is
[`jasonclone/fnaf2bot`](https://github.com/jasonclone/fnaf2bot). It has much less
modeling and validation, but it closes the loop against the PC game and reports
roughly one win in three. The closest high-reliability controller is Shooter25's
Practice Mod, whose direct access to Clickteam state removes the hardest external
perception and synchronization problems.

Those systems answer different questions:

| Question | Best example found |
|---|---|
| Can a compact external program play the unmodified PC game? | `jasonclone/fnaf2bot` |
| Can an embedded controller run a reliable FNaF 2 strategy? | Shooter25 Practice Mod |
| Can FNaF mechanics support high-throughput RL? | `Dankiel23/fnafAI` for FNaF 1 |
| Can an agent learn through the real executable? | `LucMazarJR/no-more-jumpscares` attempts this for FNaF 1 |
| Can source-derived FNaF 2 strategy claims be reproduced and falsified? | This repository |
| Can the strategy be taught and its real-device path guarded? | This repository |

## The local repository's actual scopes

Treating the project only as “a FNaF 2 bot” hides most of what exists here.

| Scope | Local implementation | Current evidence boundary |
|---|---|---|
| Mechanics research | Android 2.0.7/Fusion build 296 source-event reconstruction; mechanism ledger; group-map and source-dump audits | Claims are labeled sourced, calibrated, inferred, or model-derived. The XOR-28 handle-scramble correction is retained as an explicit retraction. |
| Exact simulator | [`packages/source/src/games/fnaf2/plant-model.js`](../../packages/source/src/games/fnaf2/plant-model.js), deterministic RNG, event timing, office endgame, camera stalls, route graphs | Correct Minus 7 cycles pass 200/200 seeds and 100/100 worst-luck sweeps. These are model results, not device clears. |
| Strategy search | Fixed strategy enumeration, timing hill-climb, gate-aware search, actuator-aware replay | Search independently re-derived Minus 7. Corrected gate-aware families score 0/150; two earlier positives remain documented as retractions. |
| Human trainer | Self-contained browser trainer with ten lessons, timing windows, cues, layout calibration, run traces, and reports | Trains and grades a human. It does not itself control the commercial game. |
| Stock-device execution boundary | [`apps/desktop`](../../apps/desktop/README.md) and [`@sixam/play`](../../packages/play/README.md), registered profiles, and `packages/play/bin/phone/night-run.sh`, which drives the campaign executor (the legacy `legacy-trial.sh` runner was archived 2026-09-25, [`ARCHIVED-ROUTES.md`](../ARCHIVED-ROUTES.md)) | The package dry-run is fixture-backed; live transport composition and a full-night 10/20 clear remain unclaimed. |
| Reactive visual sensing | Static libc-free AArch64 `screencheck` (archived 2026-09-25), ROI/pixel/template classifiers, holdout/replay/benchmark pipeline | Cheap stock-device sensing exists and BB-left models are integrated. It is not yet a complete night-wide perception stack. |
| Audio sensing | MediaProjection helper, feature extraction, denoising, cascade scans for BB/other cues | Demonstrates measured cue-detection work. It is an optional grader/sensor, not a closed-loop policy by itself. |
| Policy prototypes | `tools/gatebot.mjs` (removed 2026-09-24, [archive](../ARCHIVED-ROUTES.md)), BB-aware tests, camera-stall and gate-policy experiments | Primarily simulator policies. The corrected office model rejects the searched reactive family; do not present `gatebot` as a live 10/20 bot. |
| Validation and safety | Source regressions, engine tests, worst-case sweeps, capture grading, actuator error model, [`human-gate.mjs`](../../tools/device/human-gate.mjs) | The live runner refuses plans below 40/100 under ±60 ms modeled schedule jitter. This is a deployment gate, not a success guarantee. |

## Architecture comparison

| System | State source | Policy | Actuation | Validation | Demonstrated boundary |
|---|---|---|---|---|---|
| **This repository** | Source-derived offline model; stock Android screen/audio cues where calibrated | Exact schedules, search, and small reactive branches | On-device monotonic HID multitouch/ADB harness | Unit/source tests, seed and worst-case sweeps, jitter gate, capture grading | Model-validated strategy and partial device path; no full-night stock-device clear |
| **Jason FNaF 2 bot** | Fixed screen pixels and timers | Handwritten ten-second phase/state routine | Win32 cursor, mouse, and keyboard events | Real runs; author reports about 1/3 success | Unmodified PC 10/20 attempt/clear loop |
| **Shooter25 Practice Mod** | Direct Clickteam flags/counters | Explicit six-state controller | Invokes in-game events | Large reported strategy sample, including 104–1 | Modified game only |
| **Couraeel FNaF 2 AI** | Direct recreation objects and counters | Emergency priority tree plus camera/office phases | Direct mutations and virtual holds | Playable recreation, no stock comparison | Recreation only |
| **The2AndOnly FNaF 1 bot** | Window-relative pixels and menu stars | Compact deterministic 4/20 lifecycle | PyAutoGUI | Public demo, automatic retries and completion stop | Unmodified PC FNaF 1 |
| **LucMazar FNaF 1 PPO** | Screenshots plus tracked/calibrated state | PPO/behavioral cloning | PyAutoGUI | Logs, replay, TensorBoard/Mongo, death/win templates | Live training; no verified clear rate |
| **Dankiel FNaF 1 RL** | Simulator full or CV-oriented observations | PPO and algorithm comparisons | Simulator actions | Gym tests, curricula, replays | Simulator only; explicitly no game bridge |
| **Mycoal FNaF RL** | Unity reconstruction state over socket | Dueling double DQN with noisy nets/PER | Reconstruction actions | Training infrastructure | Reconstruction only |
| **REKA series** | Direct state in modified/decompiled Clickteam games | Per-game handwritten internal logic | Replaced/inserted game events | Public clears across FNaF 1–4, SL, UCN | Strong demos; generally no source, stock sensing bypassed |
| **FNaFWorldTAS** | Hooks and internal events/RNG | Precomputed route with conditional waits | Injected Clickteam hooks | Speedrun/TAS result | Deterministic TAS, not adaptive autonomy |

## FNaF 2 implementation deep dive

### 1. Jason: the nearest black-box stock-game comparator

The C++ controller is organized around a human-like repeating phase. It winds
the music box, performs right- and left-vent checks, lowers the camera into the
office, reacts to blackout/mask pixels, handles Golden Freddy's hall appearance,
and strobes Foxy. Time gates near the beginning, middle, and end of the roughly
ten-second phase decide when each subroutine may run.

What it gets right:

- raw single-pixel tests are cheap enough for the reaction loop;
- ordinary Win32 input preserves the stock-game boundary;
- mask placement is verified and retried rather than assumed;
- the controller includes menu setup/retry, so it is an end-to-end runner;
- a published empirical success estimate is more honest than a one-off clear.

What limits it:

- screen coordinates, colors, and menu layout are hard-coded for one setup;
- timers substitute for a mechanics model, so late detections can perturb later
  phases without a principled recovery state;
- there is no recorded detector calibration set, holdout, replay harness, or
  actuator-error model;
- character state is scattered across procedural branches rather than expressed
  as an auditable belief/state machine;
- success/failure termination is incomplete; the program keeps looping after a
  result.

Relative to it, this repository has a much stronger model, test oracle,
calibration discipline, and Android-local actuator design. Jason has the one
piece this repository still lacks: evidence that a complete external loop can
survive the real night.

### 2. Shooter25: the nearest reliable policy comparator

The reconstructed Practice Mod controller has six meaningful states: Wind,
Stalling, Checking, Blackout, Toy Bonnie, and Vent Character. It branches on
internal music-box, mask, blackout, danger, and character values, then triggers
the same game events a player would cause.

This is excellent policy prior art. It cleanly separates state, transitions,
and action execution, and its reported runs support the chosen policy. It is not
perception prior art: reading an internal Toy Bonnie or blackout flag is not
equivalent to distinguishing frames on a stock Android surface. The local
[state-machine reconstruction](../in-engine/SHOOTER25-BOT-STATE-MACHINE.md)
documents the exact comparison.

### 3. Couraeel: the cleanest open controller decomposition

The recreation bot encodes explicit urgency thresholds, prioritizes emergencies,
alternates office checks and camera work, and keeps a camera patrol list. Its
executor isolates actions from the brain. This decomposition is more maintainable
than the deeply nested external scripts.

The policy receives truth values external bots must infer: exact animatronic
positions, music-box charge/drain, battery, and monitor/mask state. Its timings
and mechanics are also properties of the recreation, so the controller should
inform software architecture, not validate stock FNaF 2 strategy.

### 4. The remaining external FNaF 2 projects

Maraba and elyay demonstrate the common baseline: fixed sleeps plus image/pixel
checks and PyAutoGUI. TheLividDonut and Emikot show the maintenance risk of this
style more starkly: absolute developer paths, a reversed loop predicate,
undefined variables, and unfinished calls make the published versions unusable.

They offer no capability absent from Jason's controller or this project's
device work. Their main research value is negative: an automation loop needs
startup calibration, detector replay, explicit clock ownership, act-then-verify,
and end-to-end smoke tests before strategy tuning matters.

## Simulators and RL compared with the local simulator

### Different observation contracts

`Dankiel23/fnafAI`, `Gyrozaid/fnaf`, and `MycoalDough/FNAF-RL-Agent` expose
structured state generated by their own environments. This makes learning fast
and reproducible but moves the hard problem from the agent to the simulator.
`LucMazarJR/no-more-jumpscares` instead trains against the executable, paying in
slow transitions, deaths, window focus, and detector desynchronization.

This repository takes a third route:

1. reconstruct the mechanics from source-derived events;
2. use deterministic simulation and exhaustive/seeded search to reject unsafe
   policies cheaply;
3. emit normal stock-device inputs;
4. calibrate only the visual/audio branches that actually change an action;
5. preserve the real device as the final authority.

That approach fits FNaF 2's sparse failure feedback and tight deterministic
timing better than starting with model-free RL. RL could still help optimize a
partial-observation controller, but only after a stock-device observation and
replay contract exists.

### Fidelity and falsifiability

| Property | This repo | Dankiel FNaF 1 sim | Gyrozaid FNaF 1 MDP | Mycoal Unity | LucMazar live PPO |
|---|---|---|---|---|---|
| Mechanics tied to commercial source/events | Yes, with evidence labels | No | No | No | Uses real executable, not a mechanics model |
| Deterministic replay/search | Yes | Seeded Gym/replay support | Seeded Gym | Training/replay infrastructure | Limited by live game and screen state |
| Worst-case policy sweep | Yes | Curriculum/evaluation, not source worst-case proof | No | No | No |
| Perception required during training | Only for device-validation branches | No/full state; partial option approximates CV | No | No | Yes |
| Real-game bridge | Partial Android runner/sensors | Explicitly none | None | None | Yes |
| Published real-game clear | No | Not applicable | Not applicable | Not applicable | None verified |

The local simulator's unusual strength is that it can **retract** a strategy
claim when a source mechanism is corrected. Gate-aware policies first appeared
to score 150/150 and then fell to 0/150 when the 45-frame office fuse and
300-frame resolution chain were modeled. A simulator that only confirms its
agent and has no provenance ledger makes that error much harder to detect.

## Franchise-wide engineering lessons

### Adopt or preserve

1. **State/policy/actuator separation.** Shooter25 and Couraeel make the policy
   legible. Keep stock perception behind an interface rather than mixing pixel
   reads, sleeps, and input calls in every branch.
2. **End-to-end lifecycle automation.** The2AndOnly handles startup, night
   selection, retry, progression, and a definite completion stop. The local
   device route should eventually have equally explicit terminal states.
3. **Cheap hot-path detectors.** Jason's one-pixel checks show why full-screen
   template matching should be reserved for ambiguous states. The local
   `screencheck` design already moves this lesson on-device and adds calibration.
4. **Act, then verify.** Jason retries mask placement; pieberry's FNaF agent
   makes verification a design principle. Monitor, mask, selected camera, and
   app focus should be confirmed at the boundaries where a missed input is fatal.
5. **Use internal state as an oracle, not as production input.** Pieberry's
   runtime traversal and Shooter25's direct state can label captures and test a
   black-box controller, while production remains ordinary stock-game input.
6. **Report distributions, not highlight reels.** Jason's approximate 1/3 and
   Shooter25's large run records are more informative than a single successful
   video. Preserve seeds, detector versions, actuator bands, and failure causes.

### Avoid

- fixed desktop coordinates without window/viewport calibration;
- module-import or once-per-phase screenshots reused as current state;
- long blocking sleeps that prevent urgent reaction;
- global template searches in a sub-second reaction path;
- training only on simulator truth and calling the result a game-playing bot;
- treating a modified-game clear as evidence for external perception;
- copying source from a public repository that lacks a reuse license.

## Recommended next implementation milestones

These are ordered by evidence value, not novelty.

1. **Define the stock-device controller contract.** One monotonic owner for time;
   explicit observed/belief state; pure policy transition; idempotent actuator;
   terminal win/death/desync states.
2. **Create a replayable sensor corpus.** Version labeled frames/audio by game
   build, viewport, device, and session; split calibration from holdout by
   session. Every live branch should run offline against the corpus.
3. **Close act-then-verify for monitor and mask.** These dominate catastrophic
   desynchronization. Recovery must be bounded by the exact model's remaining
   fuse, not a blind retry sleep.
4. **Replay Jason-like phases through the exact simulator.** Encode the external
   bot's coarse phase policy without copying code, then quantify which mechanics
   and actuator bands explain its reported failure rate. This provides a useful
   baseline for the local controller.
5. **Run a complete Night 6 capture with terminal grading.** Require one artifact
   containing inputs, screen classifications, audio if enabled, focus/watchdog
   state, and win/death outcome. Do not promote to 10/20 before this loop is
   repeatable.
6. **Only then evaluate learned policy components.** A learned detector or
   partial-observation policy should beat a scripted baseline on held-out
   sessions and still pass the exact-model safety gate.

These recommendations are decomposed into cold-start implementation plans:

- [`09-observation-corpus.md`](../../plans/09-observation-corpus.md) — shared
  session, holdout, provenance, and replay contract;
- [`10-stock-device-controller.md`](../../plans/10-stock-device-controller.md) —
  explicit observation/belief/policy/action/verification loop;
- [`11-policy-interface-and-baselines.md`](../../plans/11-policy-interface-and-baselines.md)
  — exact-engine adapter, fault injection, and public-bot-inspired baselines;
- [`12-end-to-end-evidence-campaign.md`](../../plans/12-end-to-end-evidence-campaign.md)
  — promotion and claim ladder through Night 6 and eventually 10/20.

## Honest project position

The local project is already broader and more rigorous than any single public
FNaF bot inspected: it combines game-source research, an exact simulator,
strategy search, a human trainer, native mobile sensing, device actuation, and
explicit falsification records. Breadth and rigor do not substitute for a
clear. Until a stock-device full night is captured and graded, the correct claim
is **validated strategy research plus an incomplete external automation path**.

Conversely, a working external script with a clear is not automatically the
better research system. Jason and the best FNaF 1 scripts demonstrate operational
closure; this project demonstrates why a strategy should work, where it fails,
and how timing/sensing assumptions can be tested. The strongest future result is
the union of those properties.
