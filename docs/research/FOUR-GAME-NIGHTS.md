# The four games' nights, modelled from the dumps

*2026-09-21. Every number here was read out of this project's own event-sheet
dumps with `tools/dump/nightmap.py`, which parsed all four sheets — 4,450
groups — with **zero unclassified lines**. Nothing was taken from a wiki.
Census results are **model** results: they say what a simulator built from
these rules does, and are not device measurements.*

## What was built

| Layer | Where | Covers |
|---|---|---|
| Reader | `tools/dump/nightmap.py` | all four sheets: clock, difficulty table, rolls, movement graphs, draw census |
| Night models | `packages/core/src/mechanics/games/` | all four: clock, per-night table, roll schedule |
| Simulator | `packages/core/src/mechanics/games/sim-fnaf1.js`, `sim-fnaf3.js`, `sim-fnaf4.js` | FNaF 1, 3 and 4; FNaF 4 remains **MODEL_ONLY** |
| Policies | `policy-fnaf1.js`, `policy-fnaf3.js`, `policy-fnaf4.js` | FNaF 1, 3 and 4 published lines and controls |
| Census | `tools/census.mjs` | FNaF 1, 3 and 4; held-out seed blocks via `--start` |

FNaF 2's night already has a simulator (`plant-model.js`) and a route; its
entry here contributes the clock groups its constants lacked. FNaF 3 and FNaF 4
now have model-only simulators and policy censuses. FNaF 4's walk cadence,
listen destination and device timing remain explicitly unknown, so none of its
rates is device evidence.

## The four clocks, and they are not one mechanism

| Game | Hour | Night | Mechanism | Win | Source |
|---|---|---|---|---|---|
| FNaF 1 | 90 s then 89 s | **535 s** | accumulator: `minute counter` to 90 | hour 6 | g397–g400, g435 |
| FNaF 2 | 70 s | **420 s** | accumulator: `AM` alterable to 70 | hour 6 | g627–g631, g672 |
| FNaF 3 | **40 s** N1, 60 s N2+ | **240 / 360 s** | wall clock, gated on night | `time of night` 6 | g642–g648 |
| FNaF 4 | 60 s | **360 s** | wall clock | hour 6 | g568–g573 |

Three things that only show up by asking all four the same question:

- **FNaF 1's first hour is a second longer than the rest.** g399 resets the
  minute counter to **1**, not 0, so hour 0 runs 0→90 and every later hour
  1→90. The night is 90 + 5×89 = **535 s**, which is the 8:55 the community
  publishes — derived here rather than copied. FNaF 2 zeroes its accumulator
  instead (g630), so it has no such seam.
- **FNaF 3 is the only game whose hour length depends on the night**, and the
  240 s Night 1 that follows is corroborated by the handset run of 2026-09-20
  that held the office ~240 s and banked the night.
- **Every game halves its hour under a fast-nights flag**, under four
  different names. FNaF 1's power drain (g315) is *not* on that flag, so fast
  nights spend half as much power per in-game hour — an asymmetry in the
  source, not a modelling choice.

`UNKNOWN(frame-handle-map)`: the value a `JumpToFrame` carries is a frame
**handle**, not the dumped frame index. FNaF 3's own timer names settle it —
`JumpToGFreddy` → 21 against index 22, `JumpToMangle` → 17 against index 20 —
so no constant offset reconciles them. A night's end is therefore identified
by the hour it fires at, never by where it lands.

## The four difficulty tables

- **FNaF 1** (g437–g443): one counter per character, set at night start, plus
  hourly `+1` bumps at 2, 3 and 4 AM (g470–g472) that carry **no night
  comparison** and therefore fire on every night including Custom Night.
  Night 4's Freddy is `1 + Random(2)` — the table's only draw.
- **FNaF 2** (g673–g684, g787, g804, g815–g821): the per-hour table already in
  `config.js`. This work did not restate it; `games/fnaf2.js` re-exports it and
  a test round-trips the two.
- **FNaF 3** (g649–g654): **one counter**, `AI`, driving Springtrap *and* every
  phantom. Night 1 → 0, Nights 2–5 → the night number, Night 6+ → 7. Two
  further per-night knobs that no public account of the game states:
  - **Which phantoms are armed** (g694–g696): Night 2+ BB and Mangle, Night 3+
    adds Golden Freddy and Chica, Night 4+ adds the Puppet.
  - **`time limit`** (g777–g782), the phantom *exposure fuse* — how long a
    phantom may be looked at before it fires, tested by g702, g709, g719, g720
    and g746. It falls **100 → 50** across the six nights, so the same glance
    is twice as dangerous on Night 6 as on Night 1.
- **FNaF 4** (g228, g581–g588, g598–g600): Nights 1–4 *escalate* mid-night by
  `add`ing at 3 AM; **Night 6 switches antagonist** at 4 AM with a `set` to 0
  for all four and Fredbear to 15; **Night 5 names only Fredbear**, so the
  other four cannot act on it at all.

**FNaF 2 is the only game in the series that clamps its AI counters**
(g829, g830, g856–g863). The same detector was run against FNaF 2 first and
read the positive, so its silence on FNaF 1, 3 and 4 is evidence rather than a
blind query.

## Draw accounting, and a column that means two things

`nightmap.py --draws` reproduces Plan 26's total-draw column exactly. Its
"timer-driven" column reproduces only under the looser of two readings:

| Game | total draws | in a timer-gated group | **timer-forced** |
|---|---|---|---|
| FNaF 3 | 115 | 21 | **5** |
| FNaF 4 | 107 | 34 | **8** |
| FNaF 1 | 49 | 30 | **15** |
| FNaF 2 | 123 | 53 | **17** |

The middle column is Plan 26's. The right-hand column is the one a seed model
owes: draws with **nothing that can fail in front of them**, consumed on every
tick whatever happens. The distinction matters because a `Random` inside a
*condition* is evaluated while the conditions are being tested, and Clickteam
stops at the first that fails — so position in the condition list decides
whether a draw is forced.

FNaF 3 is lightest under both readings, so Plan 26's conclusion stands. But
**FNaF 1 and FNaF 4 swap places**: FNaF 1 has the *most* forced draws of the
three expansion targets, not the fewest. Its own three background draws
(g58/g59/g192 in FNaF 2's case) are joined by a full grid of eleven movement
rolls.

The reader agrees with this repository's own independent account of FNaF 2's
unconditional draws (`packages/core/test/unconditional-draws.test.js`, which
names g58, g59, g192 and g822): it finds exactly those three timer-driven
sites, and correctly does not call g822 timer-forced because it is a
`StartOfFrame`, not a timer.

## FNaF 1: a seed census

> **Read this section as the idealised lane (2026-09-25).** Both policies below
> write simulator state directly: a light lit for one frame, a camera up with no
> 383 ms flip, two doors 2780 px apart moved in the same frame. The phone does
> none of that. The device lane in [the FNaF 1 device section](#fnaf-1-on-the-phones-clock-and-4-20-won-on-device)
> prices every touch at its measured cost, and it is what cleared 4/20 on the
> handset.

The simulator runs at 60 Hz in ascending group order — which is the order the
runtime evaluates in, and therefore the order the RNG is consumed in. Both
policies are **observation-limited**: they may read a door light, a camera and
the HUD's hour and power, and never a position the player is not looking at.

### Results, 3000 seeds per night

Both policies were run **exhaustively** — all 65,536 seeds, which is every
night the 16-bit RNG can deal, so these are populations and not samples.

| Night | `community-loop` | `roll-grid` |
|---|---|---|
| 1 | **65,536/65,536** | **65,536/65,536** |
| 2 | 65,530/65,536 (99.99%) | **65,536/65,536** |
| 3 | 65,535/65,536 | **65,536/65,536** |
| 4 | 65,519/65,536 (99.97%) | **65,536/65,536** |
| **5** | 65,503/65,536 (**99.950%**) | **65,536/65,536** |
| 6 | **65,536/65,536** | **65,536/65,536** |
| **7 (4/20)** | **65,536/65,536** | **65,536/65,536** |

Two things in that table are worth reading twice.

**Night 6 is perfect and Night 5 is not.** The same inversion the 4/20 result
showed: at higher AI a blocked character leaves on its *next* roll because
nearly every roll succeeds, while at Night 5's mid AI it camps the door through
failed rolls and the door stays shut. Night 5 is the worst night in the game
for this policy, not Night 6.

**The three-block estimate was right.** Before the exhaustive run, three
independent 3000-seed blocks gave Night 5 as 3000 / 2999 / 2998, implying about
99.95%. The population value is 99.950%. That is the held-out method working:
the estimate from disjoint blocks landed on the true rate, where the single
fitted block had claimed 100%.

**The published loop stops about one seed in 3000 short, and it is a real
ceiling rather than a tuning miss.** Two sweeps — 54 and then 24 configurations
over camera period, check period, held-door check period, the governor's slack
and a both-lights variant — found no perfect setting at 3000 seeds.

The cause is arithmetic: 713 of the 999-unit reserve is spent before the player
touches anything, and what is left has to cover a **stochastic** cost. A
blocked character leaves only on its next *successful* roll, so an unlucky camp
draw exceeds the budget however the knobs are set.

**The held-out check is what makes that a finding rather than a guess, and it
caught a false positive.** A third sweep did find a configuration that scored
3000/3000 on every night — `camEvery 44, checkEvery 60, heldCheckEvery 16,
budgetSlack 0.55`. Re-run on seeds 3000–5999 it scored **2998/3000** on Night
5, and on 20000–22999 **2995/3000**. It had been fitted to the block it was
selected on.

That is worth stating plainly because the fitted config is what this work
would have reported if the sweep had been trusted: a clean sweep of the goal,
on a policy whose real Night 5 rate is about 99.95%. A configuration chosen by
sweeping against seeds 0–2999 and then reported on those same seeds is a
selection effect, and at a ~1-in-3000 failure rate a grid of a few dozen
settings will contain one that clears any given block by luck.

The stable configuration reported above loses 0, 1 and 2 seeds across the
three blocks. That is the policy's rate.

`roll-grid` clears it because it removes the camp cost rather than paying it —
each door is shut only across its own roll instants, 20/298 of holding — and it
was run **exhaustively**: **65,536 / 65,536 on all seven nights**. The RNG
keeps 16 bits, so that is every night the game can deal, not a sample.

### `roll-grid` is MODEL ONLY and is not a device route

It scores perfectly and it cannot be actuated, which is worth stating loudly
next to the number rather than in a footnote.

The simulator sets `leftDoor` and `rightDoor` independently every frame with no
pan state. The handset says that is impossible: **the two doors are 2779 px
apart on a 2400 px screen and are never both on screen**, so every door press
is pan-then-press at the measured 270 ms floor — a 540 ms round trip.

And the two grids start aligned. Both `Every` timers load at t = 0 and the
periods differ by only 10 ms, so the instants separate by 10 ms per cycle:

> For the first **53 cycles — 263 s of a 535 s night** — the two door instants
> are closer together than one pan round trip, inside a 333 ms window.

For half of every night one actuator cannot serve both doors. The exhaustive
score is a true statement about the model and a false one about the phone —
this project's oldest failure mode, that the simulator prices nothing.

**So the published loop is the actuatable one**, despite scoring lower. Its
door shuts are belief-driven and last a whole camp (12–20 s), so a 270 ms pan
fits inside its 1 s check cadence with room to spare, and its detectors are
cheap: door-light occupancy is a luma read at a known coordinate, which
`packages/screencheck` and the `*-rule-v1` models already do on this handset.
`census.mjs` prints `[MODEL ONLY]` beside every `roll-grid` row.

That is the one place in this work where the community line and the machine
line genuinely differ in outcome, and it is reported as a difference rather
than folded together.

`community-loop` is the published 4/20 line — left light, camera, right light,
camera — with a power governor. `roll-grid` is not a community strategy and is
not offered as one; see below.

### Controls, which are the part worth trusting

- `sealed` (both doors shut all night) loses **every** seed, and always to
  power — never to a character.
- `do-nothing` loses, and loses mostly to **Foxy**: with no camera ever raised
  his hold never loads, so he advances on every roll.
- Parking the camera anywhere but CAM 4B loses **1000/1000** at 4/20, to
  Freddy.

### Three things the census found that the strategies do not say

**1. CAM 4B is a unique safe park, and CAM 4A is not.** g556 (Freddy's entry)
and g557 (his retreat) do **not** carry the same view exclusions. Both need
the monitor up and `viewing <> 42`, so watching CAM 4B shuts him out
completely. Only the *retreat* additionally excludes `viewing <> 4`: watching
CAM 4A does not stop him getting in, it stops him being turned back. Reading
the two as one rule made CAM 4A look like a second safe park — it kills
1000/1000 at 4/20. This was caught only because the control was run.

**2. 4/20 is cheaper than Night 5.** Under the published loop, Night 7 at all
dials 20 clears more often than Night 5 does. At maximum AI a blocked
character leaves on its **next** roll, because every roll succeeds; at mid AI
it camps the door through failed rolls and the door stays shut. The published
accounts describe camping as an annoyance. It is the binding cost.

**3. Foxy is held by camera *flicks*, not camera *dwell*.** g460 re-sets his
hold to a fresh `50 + Random(1000)` every 100 ms while any camera is up. It is
a set, not a maximum, so dwelling re-rolls protection rather than accumulating
it. A flick buys nearly the same expected hold at a fraction of the power.

### Why `roll-grid` exists, and what it is

The published loop cannot afford Night 5. Base drain plus the per-night drain
(g477–g480) already spends **713 of the 999-unit reserve**, and holding a door
through a camp costs more than the 286 that remain.

`roll-grid` uses what the source makes available and the published accounts do
not: **a movement roll is on a fixed global timer**, not on anything the player
does. `Every 4970 ms` and `Every 4980 ms` load on first reach and fire at
multiples of their period from frame 0, so the instants a door has to be shut
are known in advance for the whole night. Shutting each door for 20 frames
around its own roll instants costs 20/298 of what holding it costs.

That is a machine strategy, not a human one — it needs frame-accurate timing
from night start — and it is exactly the shape this project already wins with
on FNaF 2. It is reported separately from the community line rather than
blended into it.

## The censuses

Every figure is a **model** result at the project's 3000-seed floor. Controls
are reported beside each, because a sweep with no failing control cannot tell
a working route from a dead code path.

### FNaF 3 — 65,536/65,536 on all six nights, community line

Run **exhaustively**: 65,536 seeds is every night the 16-bit RNG can deal, so
this is the population, not a sample, and there is no held-out block to worry
about.

| Night | `community-line` | night length |
|---|---|---|
| 1 | **65,536/65,536** | 240 s |
| 2–6 | **65,536/65,536** each | 360 s |

It is also the only one of the four where a **published community strategy**
takes every seed. FNaF 1's clean sweep belongs to `roll-grid`, which is not a
community line and not actuatable; its published loop stops at 99.950% on
Night 5.

The night lengths are the clock groups' own (6 x 40 s and 6 x 60 s) and the
240 s matches what the handset measured on 2026-09-20.

The policy is the published line — let him roam, seal the vent adjacent to
where he was last seen, stay on the monitor, reboot ventilation when the meter
drops — and it is **belief-limited**: it learns his position only by looking at
the camera he is on, and sweeps to find him.

Controls: **office camping** loses every night after the first (the office
drains ventilation and raises aggression off one counter, g908/g909), and
**doing nothing** loses Night 2 onward but is only a coin flip on Night 1.

**Corrected 2026-09-25: the graph was wrong, and the line wins by speed.** The
simulator's table had cam 10's exit to cam 09 (g227) on action 1, which is the
stay, and dropped three `> 2` edges (g239, g249, g251) and two attack-chain
edges (g253, g258), so under aggression one seal on vent 14 held him in a
10 <-> 14 bounce all night. On the corrected graph the line still clears every
normal night 3000/3000 in two blocks, because it shows a camera every 0.2 s. At
the phone's pace (a look ~0.75 s, a seal ~2 s) the device loop holds Nightmare
on 2977 and 2974 of 3000, and Aggressive Nightmare on 2606 and 2611
([record](../evidence/fnaf3-graph-correction-tracking-census-20260925.json)).

Two source facts do the work, and neither is in any public account:

- **The attack chain advances on the ventilation blackout**, not on a move
  (g486, g487, g256, g262). Springtrap's rule alone cannot end a night. A
  simulator built from his movement graph and nothing else reports a night
  that never ends — which is exactly what the `test-fnaf3-census.mjs` negative
  control demonstrates: disabling the blackout ramp makes the *failing*
  controls start passing.
- **The blackout needs twice the error dwell the hallucination does**
  (`2000 − AI×200` against `1000 − AI×100`), so clearing an error late still
  avoids the chain entirely.

### FNaF 3's hardest mode: Aggressive Nightmare

The six-night census above is the story mode. It is not the hardest thing the
game offers, and the hardest thing is the one configuration the published line
does **not** take.

**The Extras cheat row, read from the sheet.** Four flags toggle in
`25-26-extra.txt` (a `(x + 1) mod 2` flip, persisted to the INI and read back
at the title screen): `fast nights on?`, `hyper on?`, `no cams on?` and
`ventproof on?`.

`hyper on?` is the public **Aggressive** cheat, identified by *function* rather
than by name: g222 advances `move counter` by **2 a second** where g221
advances it by 1, halving the time to every move test. `AI` itself caps at 7
(g654 has no setter above it), so this is the only knob above Nightmare — which
matches the FNaF Wiki calling Aggressive *"the only cheat that makes the game
more difficult"* and Aggressive + Nightmare *"theoretically simulating the
highest Custom Night difficulty in FNaF 3"*.

`UNKNOWN(port-difference)`: the published cheat list is Fast Nights, **Radar**,
Aggressive. This Android build has **`no cams on?` and `ventproof on?`** and no
radar flag. A port difference, consistent with the mobile porter's other
additions here (FNaF 3's whole `olivier_*Hitbox` family). Neither mobile-only
flag is traced.

**The census, run exhaustively** — all 65,536 seeds, so these are populations:

| | Night 5 | Night 6 |
|---|---|---|
| normal | **65,536/65,536** | **65,536/65,536** |
| **Aggressive** | **65,536/65,536** | **65,511/65,536** |

So Aggressive Nightmare is the **only** configuration in this entire study
where a published community strategy fails, and it fails on **25 seeds in
65,536 — 1 in 2,621**.

**All 25 are `springtrap-vent`.** Not a mixture: every single loss is him
reaching vent 14 or 15 unsealed. A single-mechanism failure at exhaustive
scale is about as sharp as a diagnosis gets, and it fits the mechanism
directly — at double rate he takes more turns per hour, and every vent
entrance is on branch 4, which aggression itself unlocks
(`Random(3) + aggresive? + 1` shifts the branch set from {1,2,3} to {2,3,4}).

It also sharpens the open seal question below: with every failure a vent, the
choice of which vent to seal is not a detail of this result, it *is* the
result.

**Why it fails, and it is not the seal.** The published Aggressive Nightmare
strategy is built on **audio lures**, and this policy never lures:

| | published line | `community-line` |
|---|---|---|
| lures | central — keep him looping cam 9↔10, "play audio in Cam 9 if Springtrap is in Cam 8" | **never** |
| seal | **vent 11**, while camping 9/10 | the vent reachable from the last sighting |
| reboots | "Audio (always reboot first before anything), Camera, Ventilation" | ventilation only |

The lure is worth more than the public accounts say, and worth *most* here. A
lure **resets `move counter` to 0**, not merely repositioning him — and under
`hyper` the counter advances at 2/s, so a reset buys **twice** what it does at
normal rate. That is why this policy clears every other configuration without
lures and loses only on the one where they matter most.

**One open disagreement, recorded rather than resolved.** The published line
seals **vent 11**. The topology says **14 and 15 bypass the attack chain and
kill outright** while 11 enters it two steps from the end, so on danger order
14 should come first. Either the published line is suboptimal there, or camping
9/10 makes 11 the live threat in a way the topology alone does not show. It
would be settled by censusing the two seal choices against each other under
`hyper`, which needs no device time.

### FNaF 4 — two 3000-seed blocks, model-only

The FNaF 4 simulator now includes the Freddy meter and black flash, idle
accelerants, bedroom and closet chains, Fredbear's room and shadow-night rows,
and the forced-turn paths. Its published default is `community-loop`: listen
at each door, resolve a breathing hall, flash an empty hall, then service the
closet and bed.

The result is a **model** result bounded by `UNKNOWN(walk-cadence)` and
`UNKNOWN(listen-pair)`. The first block is seeds 0–2999; the second is the
held-out block 3000–5999. The two blocks agree on the conclusion:

| Night | seeds 0–2999 | seeds 3000–5999 | dominant losses |
|---|---:|---:|---|
| 1 | **3000/3000** | **3000/3000** | — |
| 2 | **3000/3000** | **3000/3000** | — |
| 3 | **3000/3000** | **3000/3000** | — |
| 4 | **3000/3000** | **3000/3000** | — |
| 5 | 53/3000 | 56/3000 | black flash: 2947 / 2944 |
| 6 | 1309/3000 | 1361/3000 | black flash: 1484 / 1483; Freddy: 207 / 156 |
| 7 | 0/3000 | 0/3000 | Freddy: 2995 / 2992; black flash: 5 / 8 |
| 8 | 0/3000 | 0/3000 | Freddy: 3000 / 3000 |

The controls fail as required by this model. `do-nothing` scores 0/3000 on
every night in both blocks, with all 3000 deaths attributed to the black
flash. The no-audio rotation scores 2868 and 2846 on Night 1, 872 and 763 on
Night 2, one seed on each Night 5 block, and zero on the other nights. It is a
useful model control, not a winning line.

The Night 5 and 6 losses are dominated by the meter reaching the 80-point
black-flash threshold, with direct Freddy deaths making up the remainder.
Nights 7 and 8 switch to the shadow schedules' Fredbear phase at 4 AM; the
published loop has no 3000-seed winner there. These are ceilings of the current
model, not a device result or a promotion candidate.

### FNaF 1 on the phone's clock, and 4/20 won on device

**2026-09-25.** The idealised census above was withdrawn as a device figure: a
one-frame light and a free pan do not exist. `Fnaf1Sim.press` now applies the
event sheet's own input rules -- the 10-frame click cooldown on every light and
door press [g166, g168-g228], the 23-frame monitor flip that locks the tab and
keeps `viewing` 0 until it completes [g5/g6, g270/g271, g846], doors that take 32
frames to close or open and during which nobody dies or leaves [g160/g161,
g343/g344], lights put out by the put-down [g357], and door power charged while
shut and opening but not while closing [g305-g308]. `tools/fnaf1-device-lane.mjs`
drives it through the handset's measured costs: a 160 ms contact, a 310 ms pan
hold, controls reachable only at their own pan, and reads that return a frame
that is already old.

Two of those costs were measured by the device itself on a 0/0/0/0 calibration
night, and both changed the route: **lights and doors act on touch-UP** (166-247
ms after the touch starts) while the monitor acts on touch-down (8-52 ms), and
**a still office renders pixel-identical frames**, so a doorway is read against
the empty template of the state the panel names. The hour is 90 s on the phone
too (1 AM read 89.92 s after the first office frame).

The route, `grid420`, is the 2026 community 4/20 line placed on the roll grids
([`bl8E4wZySWY`, "How FNAF 1's AI actually works"] plus Pedro's own play):
CAM 4B is selected once and one flick lands inside the 733 ms before each of
Foxy's 5010 ms rolls, which holds Foxy and Freddy with certainty; the left light
is read once after each of Bonnie's 4970 ms rolls he could have arrived on, the
right after each of Chica's; a door is shut just ahead of the roll that will
turn its occupant back and opened after it, once the light through the shut
door shows him gone. Device lane, measured timings: **1000/1000 typical** (seeds
0-999), 947/1000 in the all-maxima worst lane.

On the phone it **reached 6 AM on the first 4/20 attempt** and the title gained
its third star ([`fnaf1-420-first-6am-20260925`](../evidence/fnaf1-420-first-6am-20260925.json);
binding [`fnaf1-custom-night7-420-grid420-winner.json`](../../tools/device/fnaf1-custom-night7-420-grid420-winner.json)).
One night, not a cohort.

### FNaF 1 — the idealised 3000/3000 (superseded as a device claim)

See the table below. What made it reachable was measuring where the 999 units
go rather than sweeping knobs: on Night 5, **713 of the reserve is spent before
the player touches anything** (base 535 plus the per-night drain 178), leaving
286 for every control.

Two source-derived levers closed the gap:

- **Foxy's hold is re-set to `50 + Random(1000)` every 100 ms of viewing**, so
  the worst draw is 50 frames. Flick the camera more often than that and he can
  never act; the loop uses 42.
- **A light flash costs 1/60 of a unit against a shut door's 1 per second**, so
  checking a shut door often is ~60x cheaper than holding it a moment too long.

### FNaF 2 — not re-censused, and deliberately

It already has a simulator, a route and device evidence, so a new one here
would add nothing. Run through the existing machinery, `minus7` clears nights
1–4 at **3000/3000** and Night 5 at 2998/3000, and scores **0/3000 on nights 6
and 7**.

Nights 6 and 7 are not bad luck; they are **two sequential blockers**, and the
published families handle neither.

**First, Golden Freddy** — ~96% of all night-6/7 losses across every family.
He does not kill on his own. He kills when the player flashes the hall or
raises the monitor while he is in the office (g690, g701, g727, g1292), and
**a fully-on mask is his only dismissal** (g776). The families keep to a fixed
cycle and never check, so they walk into him on a timer.

That is fixable and observation-legal: `gfPresent` in belief mode is
`!camsUp && !maskOn && gf.present`, which is what a player can see because he
is rendered in the office. `goldenGuard` in `policybaselines.mjs` masks on
sight, and the reaction window is comfortable — measured at **42–46 frames**
between first sighting and death, against ~37 for a monitor-drop plus a
fully-on mask.

**Then Foxy.** With the guard on, Night 7's Golden Freddy deaths go **291 → 1**
in 300 runs, and Foxy's go **4 → 299**. Night 6 moves the same way (GF 137 → 8,
Foxy 84 → 248). Removing the first blocker simply reveals the second, which is
the useful shape of the finding: a family that handles both is what the
routes that actually win those nights do, and those are artifact plans
(`campaign-night6-h2`, `campaign-night7-k3`) scored by other machinery.

So FNaF 2 meets the target on nights 1–4 and is short on 5, 6 and 7, with the
remaining gap named rather than guessed at.

## What is not done

**FNaF 4 has a simulator and a census, but no device census or promotion.** The
black-flash and idle controls close the earlier fatal gap: a player who faces
the centre and never acts now dies in the model on every night. The current
published line still has no 3000-seed winner on Nights 5–8, so the next work is
route and model resolution, followed by device timing and a dry-run campaign.

The remaining model assumptions are explicit:

- `UNKNOWN(walk-cadence)`: the rendered walk-flag groups do not expose how
  many zones a passed roll traverses. The simulator uses one leg per roll.
- `UNKNOWN(listen-pair)`: the rendered Fredbear listening groups have the same
  conditions but different destinations, bed and closet, so the simulator uses
  a seeded coin.
- `UNKNOWN(bed-turn-anim)`: the forced-turn length is approximated with the
  measured bed-return animation.
- `UNKNOWN(not-measured)`: animation lengths are lower bounds until the handset
  supplies control-readiness timings; the door approach still depends on an X
  test that the dump does not fully expose.

The model results are therefore reported as a bounded research result. They do
not move Plan 12 above FIXTURE and do not authorize a device route.

### The walk durations, caught from the animation bank (2026-09-20)

`dump_animations.py` over the owned CCN, at build 296 and the app's own 60 fps,
under the Fusion model the tool documents: the counter advances by `speed` each
tick and the frame flips at 100, so a sequence lasts `frames × 100 / (speed × rate)`.
Each `follow` leg was joined to the animation its `AnimationFinished` condition
names.

| leg | animation time |
|---|---|
| hub → left door | 2.366 s |
| left door → hub | 1.533 s |
| hub → right door | 2.366 s |
| right door → hub | 1.566 s |
| hub → closet / back | 1.733 / 1.366 s |
| hub → bed / back | 0.633 / 0.667 s |
| close a door (L / R) | 0.733 / 0.600 s |
| seal the closet | 0.334 s |
| flash a light | 0.300 s |

**Left door → right door is 3.899 s against a 5000 ms roll grid — 78% of one
roll period spent walking.** A tour of both doors and back is 7.831 s, *longer
than a whole roll cycle*, so a rotation cannot cover both doors within one grid
period and a schedule has to choose which door a given roll protects. That is
the quantity the unmapped state machine was hiding.

The approach is longer than the return at every station, so a rotation is not
symmetric. `carpet run` (1.033 s) is the shared walk in all four directions.
The bed is the cheap station at 1.300 s round trip, which matters against a
meter that drains 20/s while it is viewed and fills at `Freddy AI / 4` per
second.

**This is an established method here, not a new one** — and it comes with its
own warning. `config.js:528-535` derived FNaF 2's mask and monitor flips from
the same bank, and a fresh dump reproduces all four to the millisecond
(`mmaskOn` 9fr@75 = 0.200 s, `mmaskOff` 11fr@75 = 0.244 s, `mmonitorUp`
11fr@90 = 0.204 s, `mmonitorDown` 11fr@50 = 0.367 s).

But **an animation length is not control readiness**. FNaF 2 is the worked
example: `mmonitorDown` runs 367 ms, while the native frame trace has the mask
button absent through 322 ms, faint at ~337 ms and fully visible only at
**382.5 ms** — about one frame later. `tools/device/artifact-commands.mjs`
uses the measured figure, because the derived one sat 66.5 ms above the real
visibility point and chasing it took the Minus Toys loop from 120/120 to
0/120. So every figure above is a **lower bound**, to be replaced per leg by a
device measurement before a FNaF 4 schedule is bound to it.

`UNKNOWN(not-measured)`: four legs on the two door approaches advance on a test
of `follow`'s X position (g30 `CompareX = 512`, g32 `> 530`) rather than on an
animation, and are not in the totals. Nothing in the event sheet moves `follow`
in X, which would make those tests constant — but the movement-block reader
used to check that found **no movement block on any of the 485 objects**, so it
cannot tell a real absence from its own blindness, and the question stays open.

Neither blocker needed device time; both were readable from the dumps already
in hand.

## Reproducing

```sh
tools/dump/nightmap.py --game fnaf3 --table --clock --rolls
tools/dump/nightmap.py --game fnaf1 --graph charBonnie
node tools/census.mjs --game fnaf1 --seeds 3000 --policy roll-grid
node tools/census.mjs --game fnaf1 --policy roll-grid --custom 20 --seeds 3000
node tools/census.mjs --game fnaf4 --night 5 --policy community-loop --seeds 3000
node tools/census.mjs --game fnaf4 --night 5 --policy community-loop --seeds 3000 --start 3000
node tools/test-fnaf4-census.mjs
```

Gated by `tools/dump/test-nightmap.py`, `tools/test-night-models.mjs` and
`tools/test-fnaf1-census.mjs`, `tools/test-fnaf3-census.mjs` and
`tools/test-fnaf4-census.mjs`, all in `npm run test:unit`. The model censuses
need no game content; `--start` selects a disjoint seed block for the three
simulator-backed games.
