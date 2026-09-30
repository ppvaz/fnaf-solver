# What it would mean to completely solve FNaF 2

This page states the end state this project is aimed at, in the strongest form worth stating, and
marks where the work actually stands against each rung. It is a research charter, not a plan: the
plan is [`plans/PROGRESS.md`](../../plans/PROGRESS.md) and the promotion ladder is Plan 12. Nothing
here promotes a claim, and nothing here is evidence. Where a rung has been reached, the evidence
record that reached it is named.

The framing below came from Pedro on 2026-09-17, in the middle of the seed-locking work. It is
kept close to his words because the shape of the argument is the point. On 2026-09-25 it became
the project's path: [`plans/ROADMAP.md`](../../plans/ROADMAP.md) turns these rungs into steps
S1-S7, each with the artifact that closes it.

## The game as a control problem

FNaF 2 is a partially observable stochastic real-time control problem. The player does not observe
every animatronic's internal state, AI roll, movement timer, or pending transition. So the
strongest practical definition of solved is:

> Given everything the player can observe, and the entire history of observations and actions,
> determine the action policy that maximises the probability of surviving until 6 AM.

That definition has levels.

**Mechanically solved.** Every relevant mechanic is known precisely: movement opportunities and
intervals, RNG distributions, camera-stalling behaviour, blackout mechanics, mask windows, Foxy's
flashlight requirements, Puppet and music-box decay, interaction rules, frame and tick timing, and
every edge case. At this point there are no mysterious deaths.

**State-estimation solved.** From observations you can maintain the best possible belief about the
hidden state: `P(S_t | O_0..t, A_0..t-1)`, where `S_t` is the true internal state. The runtime's
belief-gated controller is a coarse move in this direction.

**Control solved.** Given that belief, you know the optimal action:
`π*(b_t) = argmax_a P(survive to 6 AM | b_t, a)`. This answers questions of the form: is another
80 ms of winding worth more than another Foxy flash; is CAM 08 or CAM 09 better in this
configuration; exactly when does a Minus-7-style sweep stop paying for itself.

**Globally optimised.** Not merely a very good strategy, but a search of the whole meaningful
strategy space, establishing that no alternative policy survives more often under the stated
constraints.

That last distinction matters. A bot winning 10,000 of 10,000 attempts is spectacular evidence and
still not a proof of optimality. Conversely the true optimum may be 99.97% rather than 100%,
because some RNG states admit no survival. Complete solving does not require eliminating RNG. It
requires proving what the maximum achievable survival probability is.

Borrowing the vocabulary of solved games: **empirically solved** when the remaining failures can be
attributed to identified RNG rather than strategic mistakes; **computationally solved** when an
exact enough simulator can compute the optimal policy; **formally solved** when the model can be
shown complete and the policy optimal.

## Constraint-relative solving

There is not one solution but a family, one per constraint set: unrestricted perfect-machine play;
Android touchscreen play with real input latency; human reaction-time limits; human-friendly
policies with a bounded action rate; camera-only strategies; named families such as Minus 7;
policies that minimise cognitive workload rather than maximise survival.

The objective then stops being `max P(win)` and becomes something like

```
max [ P(win) − λ1 (input rate) − λ2 (timing precision) − λ3 (cognitive load) ]
```

which is a more interesting problem than an inhumanly perfect bot. This project already lives on
that surface: the device lane carries a measured input latency, a contact floor, and an anchor
band, and every binding is a point in that trade-off.

## With a perfect model and 65,536 enumerable seeds

If the model is exact and a run is determined by one of 65,536 seeds, the game becomes a finite
deterministic planning problem conditional on the seed. For each seed `s` compute
`π*_s = argmax_π Outcome(s, π)`, and — more importantly — whether the seed is survivable at all.

Classify all 65,536: **winnable** (some legal play survives), **unwinnable** (none does),
**conditionally winnable** (survival needs particular timing or input assumptions),
**multiple-optimum** (several distinct strategies tie). Then the exact ceiling is
`P_max = #winnable / 65536`, and no controller, human or clairvoyant, can exceed it.

Three different solutions hide inside that.

1. **Clairvoyant.** The seed is known before the run, so the plan can be seed-specific and almost
   entirely open loop. This is the theoretical upper bound.
2. **Observable-game.** The seed exists but is unknown, so the policy is a function of the
   observation history, and the run itself becomes a seed-identification process:
   65,536 → 12,000 → 1,800 → 74 → 3 → 1. This is the one that corresponds to legitimate
   closed-loop play, and it raises its own question: which observations should be provoked
   deliberately, to identify the seed fastest? Optimal play becomes partly an information-gathering
   problem.
3. **Human-constrained.** Compute the machine optimum per seed, then impose reaction time, tap
   rate and timing precision, and measure exactly how many seeds each constraint costs. The result
   is a table of controllers against winnable seeds, which is a quantification of the whole
   strategy landscape rather than a league table of win rates.

Beyond one optimal trajectory per seed, compute the set of states from which survival is still
possible, `W(s, t)`. Every action then classifies as safe, suboptimal but recoverable, eventually
fatal, or immediately fatal — a complete viability kernel. A controller built on it can say things
like: you have 420 ms of slack here; winding past 610 ms makes 17 seeds unwinnable; skipping this
flash cuts the viable seed set from 31,204 to 28,991.

## The wilder programme

The rungs above still treat FNaF 2 as a game. The following treat it as a finite artificial
universe whose causal structure is fully accessible.

- **Every reachable state, not merely every run.** A retrograde table giving `V(x)`, the maximum
  survival probability from state `x`, over the whole reachable graph.
- **Every uncertainty state.** The real object is the player's knowledge, so solve the belief-state
  game over subsets `B_t ⊆ S`. That solves the game *as experienced*.
- **The minimal sufficient state.** Find the smallest representation preserving optimal decisions,
  and prove the rest strategically irrelevant. The whole relevant universe may collapse to
  something like (box debt, Foxy pressure, office hazard, camera lock, phase).
- **The game's strategic laws.** Let the analysis discover invariants rather than hand-writing
  them: some `R = aM + bF + cB + dC` whose sub-critical region is survival. That is a conserved
  quantity, or a Lyapunov function, for FNaF 2, and the strategy becomes "stay inside it".
- **A tablebase.** Not the move but the outcome, with the geometry attached: distance to forced
  death, to an unavoidable mask, to music-box collapse; minimum flashes; maximum recoverable
  timing mistake; minimum cognitive complexity.
- **The survivability manifold.** Plot the strategic resources as dimensions, take the viability
  kernel `V`, and measure `d(x, ∂V)`, the survival margin. A strategy is then characterised by how
  deep inside the safe region it keeps the player, which is probably why some strategies feel safer
  at equal win rate.
- **Robustness itself.** For bounded input error `|ε| ≤ δ`, compute the largest `δ*(x)` that still
  guarantees survival — a robustness field over the whole game — and then
  `max_π min_t δ*(x_t)`, the strategy that maximises the worst-case timing margin. That may be a
  completely different strategy from the machine optimum, and it is the mathematically optimal
  *human* strategy.
- **An exact difficulty function.** Model reaction time, motor jitter, attention switching, memory,
  actions per minute and visual processing, then compute `P(win | H)` for hypothetical players.
  The game becomes a psychometric instrument: is 30 ms less jitter worth more than 50 ms less
  decision latency?
- **Automatic discovery of strategy families.** Cluster all optimal trajectories: 65,536 plans →
  motifs → macro-strategies → a few fundamental regimes. Minus 7 and Minus 3 may turn out to be
  human-discovered projections of deeper families, and there may be families no human would invent.
- **A strategy lattice.** `A` dominates `B` when `W_B ⊆ W_A`. "Is Minus 7 better than Minus 3"
  becomes exact, decided by which seed sets each covers rather than by observed rates.
- **Strategy compression.** Minimise description length subject to a survival floor, and map the
  frontier: 20 GB at 100%, 400 KB at 99.999%, 3 KB at 99.97%, 280 bytes at 99.2%, six human rules
  at 97.8%. Minus 7 is one point on that frontier. The limit of this is the irreducible strategic
  complexity of the game: how many bits are fundamentally necessary to play it optimally.
- **A theorem prover.** Every action carries a certificate: flash here, because otherwise these
  states enter a region where music-box recovery and blackout safety become incompatible 1.34 s
  later. Every impossible seed carries a machine-checkable proof of incompatible deadlines, so
  "10/20 has an unavoidable RNG death rate of X" becomes a theorem rather than folklore.
- **Forced moves and puzzles.** Classify decision points by branching factor and extract the game's
  tactics: you have 380 ms, what is the only winning action?
- **Critical events.** With `N(x)` the number of winning continuations, `log N(x_t) − log N(x_t+1)`
  measures an event's damage in information terms. "Toy Bonnie accounts for 41% of strategic
  entropy loss in 10/20" is then a measurement.
- **Counterfactual surgery.** Vary the constants and compute `P_max(θ)` — the complete difficulty
  phase diagram, including sharp thresholds where survivability collapses. Then optimise the game
  itself: the hardest version that remains beatable, and the exact point where `P_max = 0`. The
  solver becomes a game-design compiler.
- **Information acquisition and seed reconstruction.** Actions have survival value and information
  value; optimal play may deliberately provoke observations. Ask for the minimum observation
  sequence that identifies the seed, watch `H(S | O_0..t)` fall to zero, and the controller becomes
  effectively clairvoyant partway through the night: infer, then execute.
- **An adversarial FNaF 2.** Replace RNG with an opponent choosing the worst legal outcome, and
  solve `max_π min_RNG`. A policy that wins there cannot lose to any legal RNG sequence; if none
  exists, find the least adversarial power that forces death. That separates bad luck from
  unavoidable failure exactly.
- **Glitch classification.** Treat glitches as transitions in the same machine and decide,
  mathematically, which are useful, which merely save inputs, which enlarge the viability region,
  which enable otherwise impossible seeds, and which are dominated.
- **Program synthesis.** Give a synthesiser the primitives (flash, wind, mask, camera, wait,
  branch, repeat) and ask for the smallest program meeting a target win rate. Then study what it
  invented.
- **A state quotient.** Collapse strategically equivalent states by bisimulation. Billions of
  concrete states may become thousands of distinct classes, and that quotient graph is the true
  game hiding under the implementation.
- **One master strategy.** Perhaps Minus 2, Minus 3, Minus Toys and Minus 7 are parameterisations
  of a single controller `π_α`, where `α` allocates risk between the Puppet, Foxy and the office.
  Then a decade of community strategy collapses into one equation, and the last question is how
  much of the exact solution compresses into something a human can memorise and execute: seven
  rules, two timers, one invariant.

## Phase

The sections from here to the frontier table came from Pedro's questions on 2026-09-29, after the
Night 7 phase census had shown that phase, not the seed, decides the committed bindings. Their
numbers are dated; trust the named records over them.

**Phase** is where a schedule's contacts land on the game's update grid (one update per 16.67 ms at
60 fps), counted from the office's first update. It has four parts, which the
[observatory](FNAF2-OBSERVATORY.md) keeps apart: the whole-schedule epoch, each contact's timing,
each hold's duration, and the observation delay. Three clocks meet in it: the host's wall clock,
the phone's, and the game's update count.

It is not only a delivery tolerance. The random stream reads it: "some draws are per frame and many
are tied to the frame an input lands on, so run-to-run frame jitter moves the random sequence even
at an identical seed and schedule" ([proven twins](../evidence/night6-twin-nights-proven-20260918.json)).
The two nights at seed 24850 differed in input phase by about 86 ms and did not replay, and in the
model, with seed and presses fixed, changing only the frame clock changes the mask-window occupants
from about cycle 7-8. Phase is a second seed.

On Night 7 it is the first. Over 1000 held-out seeds at 121 phases (±1000 ms) per binding, 481 of
484 (binding, phase) cells are won by every seed or lost by every seed, and a seed oracle choosing
among the four committed bindings beats the best single binding at 0 of 121 phases
([phase census](../evidence/fnaf2-night7-phase-census-20260925.json), MODEL_ONLY). With its epoch
drawn uniformly over one game second, k3 won 791 of 3000 in the reconstruction each 2026-09-18
cohort pack carries; at its declared phase it wins 65,536 of 65,536
([winner census](../evidence/fnaf2-winner-census-20260925.json)). Controlling phase is most of
what the controller does.

The won set is a comb. Across all four bindings it is three teeth, [2216, 2300], [2366, 2500] and
[2566, 2650] ms, separated by two three-frame gaps 200 ms apart that every binding shares; no other
cell in the scan is won by every seed. The aim register names Puppet at the early edge (2350 ms)
and Foxy at the late edge (2517 ms) of the middle tooth, at 60 seeds
([`fact-register.mjs`](../../tools/device/fact-register.mjs)). k3's effective interval,
[2410, 2445] ms, sits in the middle tooth with about 44 ms to spare early and 55 ms late, to within
a frame; binding i's, [2487, 2522], runs into the late gap.

### Where the technology stands (2026-09-29)

| | Measured | Missing |
|---|---|---|
| Reading | Host-phone skew per run, -6.0 to +6.1 ms across the ten k3 cohort runs, anchor uncertainty 2.4-5.2 ms. The office seed moment, from the game's own log, to 1-2 ms. After the fact: full-06's hour-grid zero at first frame +3836.7 ms, 0.7 ms from the anchor firing ([hour grid](../evidence/phone-hour-grid-20260928.json)); 27 of the 29 relevant contacts in its window 6 placed on one update and two on two ([input bracket](../evidence/phone-input-bracket-20260928.json)); monitor raises within -2..+1 updates of the replayed rule and mask presses within 0..-1 ([registration](../evidence/full06-input-registration-20260928.json)). | Nothing is read live, and the cohort carries none of it: all ten k3 cohort `phase.json` records have `deliveredOffsetMs: null` and `errorVersusFirstNightFrameMs: "UNKNOWN"`, with the origin bracketed by 1.3-4.2 s. The 47-82 ms latency is one register range (the hall-lit press-to-effect median and maximum, n = 31, 2026-09-12), not a per-run measurement. The app's input dispatch has no trace source on this handset (no `android.input.inputevent`). Clock-pinned seed brackets fail closed as UNKNOWN since 2026-09-27. |
| Writing | The anchor released 0.06-1.05 ms after its aim on all ten cohort runs. `seedpin` forces a seven-value seed window on every attempt and the exact value about one time in five, at ~6.5 ms per clock set. | The frame phase has never been written. The contact floor equals its poll (`MIN_CONTACT_MS` = `FUSION_POLL_MS` = 33 ms), so a contact's landing update has no slack. The 2026-09-27 pin protocol at 24850 did not establish the seed in five interrupted attempts. |
| Manipulation | Aiming at a tooth, the only manipulation in use. The comb is mapped for four bindings along the epoch axis. | What places the teeth. Whether a mid-night shift equals an epoch shift (the census moves only whole schedules). Any deliberate use of the draw stream's dependence on landing frames. All of it is MODEL_ONLY while the model matches 2 of 11 mask windows. |
| Handling | In the model k3 survives ±20 ms of per-press jitter and 50 ms of lateness; its weakest single contact, `open#2:cam9`, has a 66.67 ms early and 50 ms late window ([robustness field](../evidence/night7-robustness-field-20260927.json), 500-seed lanes). `test-seam-slack.mjs` refuses a plan that clears any floor by less than 33 ms. The belief-gated supervisor compares believed and observed mask state every cycle and aborts on disagreement. On the phone 8 of the 10 cohort slots are WIN, and the other two are RESULT_LOST in their packs ([k3 computed](../evidence/night7-cohort-k3-computed-20260925.json)). | Correction. The supervisor detects a phase error and cannot move the next contact. |

### A perfect reading of phase during a run

A run's phase is fully described by four sequences on one clock:

1. **The game's updates:** when each ran, and so each one's duration. Per-frame draws make their
   count matter; timers that accumulate milliseconds make their durations matter.
2. **The origin:** the office's first update, which fixes the seed.
3. **Each contact's press and release:** the update that consumed it, and its margin, the distance
   between its arrival and the boundary that would have moved it to the neighbouring update.
4. **Each captured frame's update:** which update the helper actually saw.

A microdeviation is a contact's landed update minus its planned one, an integer, together with its
margin, a duration. The integer decides the night; the margin says how close it came. A near miss
that still landed on the right update costs nothing and is the most informative event of the night.

Four channels exist or nearly exist:

- **Kernel input edges.** `night-run.sh` already streams `getevent -lt` beside the frame trace, and
  `tap-stall-audit.mjs` reads the virtual touch device's press and release edges in that clock
  without assuming it. The k3 cohort packs carry no copy.
- **Response frames.** The Companion's `REGION` reads see a contact's effect — a button stroke, the
  flashlight, the mask's first frame. The limit is yield: about 75 distinct frames per 150 reads,
  halved by a screenrecord.
- **The game's own log,** which already brackets the first office frame to 1-2 ms.
- **The phone's audio,** an independent witness of order. A2DP is late and variable, so it orders
  events; it does not time them.

A perfect reading is their fusion on the phone's monotonic clock. The one segment no channel sees,
from the kernel edge to the game's input queue, is interval-censored at every contact: the kernel
edge bounds it on one side and the landed update on the other. A night has hundreds of contacts
(k3 has 301 actions), enough to estimate that segment's distribution within the night, and with it
every contact's margin.

Two questions for the dump come first, because either could make the reading exact rather than
fused:

- Does any on-screen element change on every update as a known function of the update count or of
  the draw stream? If one does, every captured frame names its own update, and perhaps its position
  in the random stream: the helper would read the stream itself.
- Which responses are drawn on the update that consumes the input, and which one or more updates
  later? That fixes the delay the fusion subtracts for each response.

A reading is perfect when it closes replay: fed into a trace-equivalent rebuild at the night's
seed, the read update clock and landing updates reproduce the phone's night encounter for
encounter. Until S2 closes, the same-phase twin is the check that needs no rebuild: two phone
nights with identical readings must be the same night. If they are not, the reading is missing a
variable.

### First measurements: the rebuilt runtime on the phone (2026-09-29)

The practice rebuild became the instrument that reads its own phase
([`apply-calib-mod.py`](../../packages/source/recompile/android/apply-calib-mod.py)): every update's
pump, events and swap on `CLOCK_MONOTONIC`, its exact `dt` and `timer_units`, its RNG state and
each frame's seed, every touch as Android and SDL saw it, and a beacon that puts the update
index on screen. These are `rebuilt-runtime` measurements of this phone, not retail evidence.

- **The reading closes replay.** Given only the phone's frame-3 seed, per-update `dt` and polled
  input updates, the host harness reproduced two phone nights draw for draw: 18,814 of 18,814
  and 16,113 of 16,113 office updates, each leaving the office on the phone's own update. Each
  variable is necessary: the next reachable seed diverges at update 1, a constant 60 Hz clock at
  update 7, and moving the monitor presses one update later at update 962
  ([summary](../../tools/recompile/results/calib-replay-20260929.json),
  `calib-replay-summary-492e9e289e5285e1`, MODEL_ONLY host side).
- **Where the actuation chain loses a contact.** 126 contacts sent through the campaign's
  `/system/bin/hid` transport: every hold of 17 ms or more was taken (105 of 105), and 7 of 15
  holds of 8 ms were invisible because one pump drained both edges. getevent stamps equal the
  MotionEvent's own time (`CLOCK_MONOTONIC`); kernel to `onTouch` is 2.2 ms at the median, to the
  SDL queue 0.06 ms more, then 6.6 ms waiting for the pump, the contact's phase against the
  update grid ([audit](../../tools/recompile/results/practice-actuation-audit-20260929.json),
  `practice-actuation-audit-9c83886c7491fa45`). The phone's input path is not what loses a
  33 ms contact; only a game loop that skips a poll longer than the hold can.
- **The Companion's capture latency.** The Companion's MediaProjection image of an update is
  stamped 26.4 ms after that update's swap (22.4-30.7), is already one update stale when stamped
  on every frame, reaches the helper's reply 12.9 ms later, and shows 47.5% of updates
  ([capture](../../tools/recompile/results/capture-latency-20260929.json),
  `capture-latency-79e85709947685c1`).
- **Frame phase is a second seed, measured.** The rebuild seeds each frame from the wall clock in
  whole seconds (`(s × 1000) & 0xFFFF`), where the retail runtime takes milliseconds, and the
  phone's frame times reach the random stream within seven updates.

- **k3 on the rebuild dies to one landing.** Played on the calibration build (Night 7 10/20,
  seed 27656), k3 died at office update 5,934, 98.9 s in. Every edge due by then landed: 144 one
  update after the harness row, 19 on it, one two after. The host rebuild reproduces the death
  on the same update from the phone's own landings (5,928 of 5,934 updates agree; a two-draw
  event lands one update early at 4,814 and realigns). At the phone's seed and clock, k3 as
  planned, one update late throughout, and with the phone's one-pixel coordinates all reach
  6 AM; the phone's landing ticks alone die at 5,934. Of the 20 edges that did not land one late,
  one reproduces the death by itself: the monitor raise planned at tick 5402 landed on its tick
  while its release landed one late, so a 12-tick hold became 13
  ([k3](../../tools/recompile/results/k3-rebuild-phone-20260929.json),
  `calib-replay-summary-629da4eddc1f2ee0`). The same slot 30 s earlier kills alone as well. The
  night is decided by a seam between two contacts of one control, not by the schedule's phase.

Open: what the thirteenth tick of that hold does (the draws first differ at update 5,415); the
two-draw event at 4,814; the same reading of a retail night, whose last input hop and seed are
the Clickteam runtime's own.

### Solving phase, completely and robustly

**Completely** means the phase response is derived, not scanned: which mechanism places each tooth
edge (Puppet early and Foxy late on the middle tooth, at 60 seeds), in the joint space of
per-contact landing updates rather than along the one epoch axis the census moves. The robustness
field moves one event at a time; the phone moves all of them at once, correlated through the anchor
and independent per contact. The won set in that joint space, and its depth around the delivered
point, is the object. It is complete when the reading above closes replay.

**Robustly** has an arithmetic. If n contacts can each kill the night and each lands outside its
window with probability ε, phase loses about nε of nights. Were k3's two non-wins phase losses,
they would fit one fragile contact at ε ≈ 0.2 as well as ε ≈ 7 × 10⁻⁴ spread over 301 contacts, and
nothing in the packs separates the two. A robust solution names its critical contacts, measures
each one's landing spread on the phone over a predeclared cohort, and shows nε below its target
with the windows the model derived. For 99% of nights over ten critical contacts, each must miss
less than once in a thousand. The windows must also hold on the phone, not only in the simulator,
which is where the next property enters.

### Antifragility

A fragile controller loses to disorder, a robust one survives it, an antifragile one gains from it.
Against a fixed ceiling a single night cannot gain: once `P_max = 1`, variability can at best leave
the win rate alone. The gain is in knowledge, and it accrues to the lab rather than to the night.

Without a reader, the exposure to phase is concave: a tooth absorbs small errors and a gap kills.
With one, three mechanisms make it convex:

- **Every deviation is a free experiment.** A contact that lands one update off and survives is a
  point inside the phone's own won set; one that kills is a point outside it. Over a cohort the
  phone maps its own kernel, which is exactly the fidelity evidence S2 lacks, gathered as a
  by-product of play.
- **Deliberate dither inside a tooth.** Moving non-critical contacts within their margins costs
  nothing and identifies the latency and the update clock faster: the persistent excitation of
  adaptive control, and the "provoke observations" question above applied to time rather than the
  seed.
- **Optionality.** A controller that reads its landing and holds several continuations can take the
  one whose tooth contains the phase it got, and a choice made after the draw gains value as the
  draw varies. The census marks the limit of today's family: all four bindings share the same two
  gaps, so choosing among them fills neither. A continuation designed for a gap is the test of
  whether the gaps belong to the mechanics or to the family.

The antifragile lab is S7: each loss packed, placed on the comb, attributed to delivery, model or
seed, and turned into a gate or a model correction without a human in the loop — the mistake
register, automated.

## The ultimate achievement

**The predicted night.** A seed is pinned, the landing updates are planned, and the rebuild emits
the night's whole encounter ledger — who is where on which update — whose hash is published before
the run. The phone then plays that night, and its frames and audio match the ledger update for
update.

Everything else follows from it. S3's `P_max` becomes a fact about the phone rather than the model;
the controller's gap to it measures delivery alone; every loss has one cause; the tablebase, the
robustness field and the human route are computed on the real game. It needs the two halves this
page has kept apart: Truth, a rebuild trace-equivalent to the phone (S2), and phase solved, a
reading and a writing of every landing update (S4). It stands at outcomes predicted and encounters
not: the model matches 2 of 11 mask windows, the rebuild first disagrees with the phone at windows
9, 10, 3 and 6 on four clock-seeded nights, the twins did not replay, and every cohort run has
`deliveredOffsetMs: null`.

## Each layer at its frontier

Each layer beside the nearest outside field, and what a breakthrough would be here. The outside
frontier is named from general knowledge, not from a literature review; check it before claiming
novelty.

| Layer | Nearest known frontier | Frontier here | Breakthrough |
|---|---|---|---|
| Truth | Matching decompilations (Super Mario 64, Ocarina of Time) rebuilt byte for byte; emulators accurate enough that tool-assisted runs verify on real consoles | S2: the rebuild trace-equivalent to the phone at the level of encounters | Trace equivalence against an unmodified phone running a closed runtime, with no emulator in the loop |
| Decision | Solved games (checkers, 2007), endgame tablebases, POMDP solvers | `P_max` per night over all 65,536 seeds, bounded below by a policy and above by the clairvoyant relaxation | A certified ceiling for a real-time commercial game: both bounds, on a trace-equivalent game, over policies rather than schedules |
| Embodiment | Console verification by replay devices; system identification for sim-to-real control | A tick-exact closed loop on the phone, at the ceiling | The predicted night |
| Understanding | Concepts extracted from game engines and taught back to experts; policies distilled into small programs | S5: a route a human holds | The strategy-compression frontier measured, bits of rule against win rate, with a human cohort on it |
| Proof | Pre-registration, provenance graphs, signed build attestations | Every claim labelled, packed and attested; negatives queryable | A lab that runs itself (S7) and cannot overclaim: every promotion re-derived by a checker, every loss attributed without a human |
| Method | General game-playing benchmarks, built for learning rather than solving | S6: the method on four games through one runtime | A solver for the runtime: an event dump in, `P_max` and a controller out |

The nearest breakthrough is the predicted night, and within it the reading: every other layer's
breakthrough waits on it, and the phone already offers most of its channels.

## What could be a discovery

The questions reach past the game in four places. Each is a candidate, stated so that it can be
false, and none has been checked against the literature.

- **The phase-space structure of a real program.** The comb is a slice of the outcome basins of a
  deterministic program over input timing, measured in a model and checkable on hardware. Dynamical
  systems has a measure for such boundaries, the uncertainty exponent: the fraction of timings
  within ε of a basin boundary scales as ε^α. The finding would be α for FNaF 2 over the joint
  per-contact landing space, and whether its boundaries are smooth, like the teeth, or riddled at a
  finer grain. Today there is one axis, four bindings and update resolution, all MODEL_ONLY.
- **How much randomness a phone injects into a deterministic game.** The 16-bit seed is the game's
  designed randomness; frame timing is the platform's. The twins at 24850 diverged by about cycle
  7-8 from the frame clock alone. With the perfect reading, twin cohorts measure how fast identical
  plans at an identical seed branch into distinct nights: the platform's entropy, as the game
  amplifies it, in bits per minute. It needs the reading and the same-phase twin.
- **An exactly solved real-time task as a human instrument.** Real-time, partially observable
  tasks whose optimal policy and ceiling are known exactly are rare. A certified `P_max`, the
  robustness field and the strategy-compression frontier would make FNaF 2 one, measuring human
  play in bits of rule held and milliseconds of margin against an exact optimum. It needs S3 on a
  trace-equivalent game and S5's human cohort.
- **The reliability of science an agent conducts.** This repository is a lab run largely by agents
  under gates, with retained negatives, retractions, a mistake register and machine-checked
  attestations. Which gate caught which error, how often a diagnosis was retracted, and how long a
  false claim lived before a check refuted it can be measured from its history.

The first two share their instrument with the predicted night and could be reached before it; the
third needs the whole path; the fourth needs only the history already committed.

## Where this project actually is

Marked honestly, rung by rung, as of 2026-09-18. On 09-17 the model gap this page first called the
sharpest open defect turned out to be an instrument error rather than a rule
([`night6-model-gap-two-clocks`](../evidence/night6-model-gap-two-clocks-20260917.json)); on 09-18
the frame clock it left open was measured on the phone, and the seed became writable
([`night6-model-traced-clock`](../evidence/night6-model-traced-clock-20260918.json),
[`night6-twin-nights-proven`](../evidence/night6-twin-nights-proven-20260918.json)).

| Rung | Where we are |
|---|---|
| Mechanically solved | Partly. The event dump is the ground truth and a large part of the Office sheet is sourced group by group — the 5 s rolls, Foxy's A/B chain, the hall-movement latch, the hour table, the blackout clock and its flicker draws, the random image, the monitor raise gate. Every group that could produce the disputed death was read out of the dump line by line and found faithful. The **frame period is now measured rather than assumed** for binding h: on two frame-traced nights the model, driven by the phone's own frame intervals, predicts survival at each night's seed and phase, one of them a 6 AM; the survival band runs from 175 ms early to 50 ms late and the game's phase sits about 30 ms inside its late edge. That is outcomes, not encounters: at a traced Night 6 6 AM's own seed and phase the model matches 2 of the phone's 11 occupied mask windows, no seed offset does better than chance, and its nights run about half again as busy, the excess being Withered Chica and Withered Freddy ([encounter fidelity](../evidence/model-encounter-fidelity-20260918.json)). On Night 7 it kills nights the phone wins. |
| No mysterious deaths | Closer than this page first said. The deaths that looked mysterious — every clock-named seed for the 2026-09-16 Night 6 dying to Foxy at 260-285 s on a night the phone won — were a **two-wall-clock reconstruction error**, not a rule: host and phone stamps stood 1374.8 ms apart, placing the schedule 1.37 s late against the game's own clock, near the worst phase available. On one clock the same route reaches 6 AM on all 65,536 seeds. That record does **not** claim the model now predicts the phone; it claims the wipeout was an instrument error and the remaining uncertainty is named. One more is explained end to end: the 2026-09-17 twin's schedule landed 86 ms late, Balloon Boy got into the office and disabled the flashlight, and Foxy killed — the model's prediction at that phase. |
| State estimation | The hidden state's *root* is readable and now **writable**. The office seed is bracketed to one or two milliseconds from the game's own log, and a device-side clock pin forces it into a seven-value window on every attempt, hitting one chosen value about one time in five — the floor is the phone's ~6.5 ms per clock set, a `settimeofday()` plus a hardware RTC write. Proven twins exist at 24850. They did not replay the same night: frame timing and input phase enter the random sequence, so state estimation must track the frame clock as well as the seed. Belief over the rest of the state is still coarse. |
| Control | Hand-built open-loop bindings with a belief-gated supervisor, not a policy. The best, k3, reached 6 AM on 8 of 10 predeclared Night 7 10/20 runs, and both losses were Foxy at mask-off ([k3 cohort](../evidence/night7-cohort-k3-result-20260918.json)). |
| Globally optimised | Not attempted. Exhaustive 65,536-seed censuses are routine, but over fixed schedules, not over policies. |
| Constraint-relative | This is where the project lives: measured input latency, a contact floor, anchor bands, and a device lane that refuses claims the transport cannot support. |
| Viability kernel, robustness field, tablebase | Not started. The robustness field is the nearest: the harness already measures per-cycle timing slack. |

The practical consequence is unchanged even though its cause moved: the ladder's first two rungs
are the bottleneck, and they are where the current work sits. A model that cannot reproduce one
observed winning night at its own named seed cannot be used to compute a policy, let alone prove
one optimal. Everything above mechanical fidelity waits on mechanical fidelity. The frame-traced
re-run it asked for is done; the next physical test is a same-phase twin — the pinned 24850 night
replayed at today's anchor phase, both traced, read with an instrument that sees both eyeholes —
which is the first check of fidelity at the level of individual encounters rather than outcomes.

Related: [the model gap resolved as two wall clocks](../evidence/night6-model-gap-two-clocks-20260917.json),
[all ten Custom Night presets at 3000 seeds](../evidence/night7-preset-sweep-20260917.json),
[seed-lock census and the first-frame timing rule](../evidence/night6-h-seedlock-census-20260916.json),
[twin nights predeclaration](../evidence/night6-twin-nights-predeclaration-20260916.json),
[the charter](../../PROJECT-CHARTER.md), [evidence policy](../evidence/README.md).
