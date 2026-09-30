# Horizons beyond the ladder

**Status: proposed 2026-09-14, Pedro's directive.** Written the day the first
Night 7 (10/20) cohort started, after the question "what comes after a bot that
clears every night". Nothing here is a claim or a Plan 12 rung. Each horizon
names what already exists, its first physical milestone, and the condition
that would count as success, so a later session can pick one up cold.

Recommended order, because of the dependencies below: **2**, then **3**, then
**1** and **4** in parallel, then **5**.

## 1. Solve the game

**What it is.** Classify every Custom Night dial vector as winnable or not,
with the best route found, its timing band, and the killer at each band edge.

**Already here.** The simulator replays a night in about 4 ms (the k2 frame
sweep, 2026-09-14). `docs/evidence/invent/frontier-*.json` already map
single-animatronic frontiers for Balloon Boy, Foxy and Golden Freddy. The game's
RNG is a 16-bit LCG seeded per night from the wall clock
(`packages/source/src/games/fnaf2/rng.js`), so there are only 65,536 possible
nights: a per-vector verdict can be exhaustive over seeds, not sampled.

**Why brute force fails.** 21^10 vectors (about 1.7 x 10^13) at 65,536 seeds
and 4 ms per night is far beyond reach.

**The approach.** If raising a dial never makes a night easier, winnability is
monotone and only the frontier needs evaluating. Monotonicity is itself a claim
to test: Balloon Boy disables the flashlight and Golden Freddy's spawn depends
on the cameras, so dials interact.

**The honest limit.** "Unwinnable" means no route in the searched family wins.
Every negative in the table names its family, as Plan 16's recorded negatives do.

**First milestone.** The Balloon Boy x Foxy frontier, with corner vectors
checked on the phone.

**Success.** A published table whose hardest winnable vector is cleared on the
handset, with its frontier probed on the phone just inside and just outside.

## 2. A verified clean-room game

**What it is.** The game's decoded event logic compiled to a native binary, run
beside the phone on identical inputs, with traces required to match.

**Already here.** `tools/recompile/` forward-ports mmfparser and Chowdren to the
build-296 mobile CCN; `docs/in-engine/IN-ENGINE-PILOT-RECOMPILE.md` records C++
generation running deep and names the next boundary. The dump pipeline and seed
recovery (`docs/device/RNG-SEED-RECOVERY.md`) exist.

**Why it beats the hand model.** `plant-model.js` is a hand translation of the
dump; the Balloon Boy mask error at AI 20 is the kind of slip a translation
makes. A compiled binary runs the events as decoded, so a disagreement points at
the decoder or at timing.

**The hard part.** Randomness and time: the rebuilt game must be seeded like the
phone and stepped at the phone's delivered frame cadence. Seed recovery returns
surviving candidates, so equivalence is checked across that set.

**Boundary.** Pedro ruled out defeating PAIRIP on 2026-08-28 (Plan 17). The
recompile never touches the retail APK at runtime; generated code and assets
stay outside the repository; the binary is a personal research artifact. What is
published is the method and the equivalence evidence, never the game.

**First milestone.** The rebuilt binary boots to the office and its event trace
matches the simulator for the first ten seconds of a scripted night.

**Success.** The winning k2 input schedule replayed into the rebuilt game
produces the same 6 AM and the same per-cycle ledger as the phone recording.

## 3. The lab runs itself

**What it is.** An overnight loop that finds model-versus-phone disagreements,
designs the cheapest run that separates the explanations, runs it, and writes a
morning report.

**Already here.** Death-targeted bundles record a prediction before a run
(`packages/propose/bin/plans/death-prediction.mjs`); `cycle-ledger.py` and
`phase-reconstruct.mjs` read what happened; the Cue Helper queue holds jobs
until the phone is awake; the lease, deadlines and title recovery make
unattended runs safe.

**What is missing.** A planner that ranks open disagreements, turns the top one
into two competing predictions, and picks the run whose outcome refutes one. It
emits bundles and queued jobs only; the operating contract exposes no arbitrary
shell.

**Throughput.** A Night 7 attempt is about ten minutes end to end, so one night
of phone time is roughly fifty experiments.

**The hard part.** The mistake register in `CLAUDE.md` is thirteen entries of
agents drawing confident wrong conclusions. The loop needs those rules as
executable gates, and it never promotes: humans approve promotion edges.

**First milestone.** A blind re-derivation: started from the state before k2,
the loop discovers unprompted that extending mask-off closes the Balloon Boy gap.

**Success.** A morning report that refutes a mechanism nobody had queued, with
the run bundles that did it.

## 4. From the best bot to the best teacher

**What it is.** Search for 10/20 routes a person can hold, certify each on the
phone, then coach a human to execute it.

**Already here.** Plan 12's human gate (60 ms timing noise; the old route scored
12/100 on Night 7 under it), Plan 24's coach, the browser trainer, and the Cue
Helper overlay.

**The shift.** Bot routes win inside one-frame islands like the k2 band. A human
route needs a band wider than human noise, or observation branches a person can
react to: the reactive Minus 7 family, which has no qualified device lane yet.

**Why the phone still matters.** The bot executes the candidate with injected
jitter at the human gate's level; surviving on hardware certifies the route
before anyone spends hours learning it.

**The hard part.** People: volunteers, consent, a predeclared protocol, and
feedback only between attempts, never inside a live night.

**First milestone.** One route clearing the 40/100 human-gate floor on Night 7
in simulation, then surviving injected jitter on the phone.

**Success.** A person clears 10/20 on video on a machine-found route, with the
learning curve recorded.

## 5. The method, not the game

**What it is.** Move the stack to a second closed mobile game and measure how
much of this repository was method and how much was FNaF 2.

**Target.** FNaF 1, 3, 4 and Sister Location are also Clickteam Fusion games, so
the dump and recompile routes transfer. FNaF 1's 4/20 mode mirrors this target.

**The measurement.** Tag every module general or game-specific before starting,
then log what had to change. The architecture predicts adapters and the evidence
ladder transfer while mechanics and calibrations do not.

**The hard part.** The second game goes faster partly because the operator
learned. Counting commits that touched general modules separates the two.

**First milestone.** On the same handset: capability preflight, a title
observer, and one graded death.

**Success.** A first graded win in a fraction of this project's calendar time,
with a change log showing which layers moved.

## Dependencies

Horizons 1 and 4 need a model that can be trusted, which horizon 2 provides.
Horizon 3 makes horizon 1 affordable, since a frontier needs hundreds of phone
probes. Horizon 5 is a fair test only once horizon 3 exists.
