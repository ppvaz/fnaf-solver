# Expansion: FNaF 1, 3 and 4 as second targets

**Status: proposed 2026-09-19, Pedro's directive.** Plan 25's horizon 5 ("the
method, not the game") named a second Clickteam title and sequenced it last,
behind the self-running lab. This plan supersedes that ordering, because the
expensive half of a second target — ground truth — was measured on 2026-09-19
and is already in hand for all three remaining night games.

**This is optionality, not a programme.** A second game was never part of this
project's thought architecture; scope here grows on a whim, and this document
grew out of one. Nothing in it is owed. What it records is that a later whim is
now cheap, because the measurements behind it were taken — and *those* are the
durable part. The dumps, the handle constants, the RNG transfer, the layer
coefficients and the movement rules stay true whether or not anyone ever runs
FNaF 3. The ordering, the milestones and the recommended sequence are the
perishable part, and should be discarded without ceremony if the whim goes
elsewhere.

It is also worth being honest about why the port looks cheap: **the architecture
did not anticipate this.** What transferred was the discipline — evidence
labels, semantic contracts, dump-before-model — which happened to be general
even where the code was not. The 113-site `CONTROL_VOCABULARY` coupling below is
what the architecture actually assumed, and it assumed one game.

Nothing here is a claim or a Plan 12 rung. Every number below was measured this
session and says how; every gap says `UNKNOWN` and what would close it.

## Gate: lifted 2026-09-25

**Lifted by Pedro's 2026-09-25 directive** ([`ROADMAP.md`](ROADMAP.md), step
S6 and the gate table). The gate had already been overtaken by the work it
held back: FNaF 1 4/20 reached 6 AM on the phone on 2026-09-25, FNaF 3 was
censused over every seed and cleared Night 1 on the handset, and FNaF 4 has a
model and a held-out census. Custody still comes first in the path (S1), but
as the step to take first, not as a lock on this plan. The original text is
kept below.

> The standing directive (Pedro, 2026-09-06, retargeted 2026-09-17) is Night 7
> reliability and the promotion of what is already won, and promotion is blocked
> on custody: `npm run evidence -- list` sees 79 runs here and zero
> `DEVICE_MEASURED`, because every winning bundle lives under gitignored
> `artifacts/` on the peer machine. `UNTRACKED_WINNER_DEBT` stands at 13 of 13.
>
> **No work in this plan begins before that debt is cleared or Pedro explicitly
> re-targets.** A second game with the first game's evidence uncustodied would
> multiply the custody problem, not the result.

## What was measured on 2026-09-19

### All four games are the same runtime

| Game | Package | Installed version | CCN | Runtime | Build | Frames |
|---|---|---|---|---|---|---|
| FNaF 1 | `com.scottgames.fivenightsatfreddys` | 2.0.7+40 | PAMU | 770.0 | 296 | 25 |
| FNaF 2 | `com.scottgames.fnaf2` | 2.0.7+26 | PAMU | 770.0 | 296 | 33 |
| FNaF 3 | `com.scottgames.fnaf3` | 2.0.4+18 | PAMU | 770.0 | 296 | 31 |
| FNaF 4 | `com.scottgames.fnaf4` | 2.0.4+11 | PAMU | 770.0 | 296 | 23 |

All four are installed on the campaign handset (moto g56 5G, `<serial>`).
The differing `versionName` (2.0.7 vs 2.0.4) does **not** imply a different
Clickteam runtime: the CCN headers are identical at runtime 770.0, product
build 296. `menu.sh`'s existing warning stands and widens — all four report
plausible-looking versions, so **the package name is the only thing that
identifies the game**, and now there are four of them on one phone.

### The RNG model transfers to all four

`packages/source/src/games/fnaf2/rng.js` grounds the entire seed apparatus on one
per-game fact: no frame carries the seed chunk (13124), so `m_wRandomSeed`
stays −1 and each frame load takes 16 bits of wall clock.

A direct walk of the chunk tree — top-level and frame-level, not parser
warnings — finds **chunk 13124 absent in all four games**, with identical
structure (27 top-level chunk ids, 13 frame-level chunk ids each). Combined
with the identical runtime build, the LCG (`state = state*31415+1 mod 2^16`),
the wall-clock seeding, and the 65,536 possible streams are **properties of
build 296, not of FNaF 2**.

Everything built on that is therefore game-independent: the seed census, the
3000-seed rule, `seed-recovery.js`, twins, and `tools/device/seedpin`.

> This also retires the caveat raised earlier in the session, when the same
> question was asked with the vanilla mmfparser and could only be answered by
> comparing "unknown chunk" warnings.

### The handle-scramble constant, for two builds that had none

`dump_events.py` warns that the per-build object-handle XOR `K` must be found by
decompiling `OI/COI.loadHeader`, because a wrong `K` "mislabels every object
reference with the name of an unrelated object (the map is a bijection, so the
result still looks internally consistent!)". That is the defect that produced
the Toy↔Withered swap across every pre-2026-08-20 FNaF 2 dump. Known values were
FNaF 1 `K=0` and FNaF 2 `K=28`; FNaF 3 and 4 had none, and no jadx is installed
on this machine.

`K` was instead determined empirically, by **object-type agreement**: every ACE
carries an `objectType`, and the correct `K` is the one under which every
referenced handle resolves to an item of the matching type. Handle *coverage*
alone is degenerate (many `K` score 1.0, including the true ones); type
agreement is sharp.

| Game | Known `K` | Estimator's `K` | Agreement | Next best |
|---|---|---|---|---|
| FNaF 1 | 0 | **0** ✓ | 1.0000 (n=4056) | 0.5978 |
| FNaF 2 | 28 | **28** ✓ | 1.0000 (n=7708) | 0.6091 |
| FNaF 3 | — | **29** | 1.0000 (n=8187) | 0.6115 |
| FNaF 4 | — | **29** | 1.0000 (n=6122) | 0.5693 |

The estimator reproduces both known answers exactly, with a ~0.39 margin over
its runner-up in every case.

`UNKNOWN(not-decompiled)`: `K=29` is an empirical determination validated
against two ground truths, **not** the authoritative read of `COI.loadHeader`.
Install jadx and confirm before any identity-derived rule is encoded on these
names. Type agreement cannot distinguish a `K` that permutes objects *within* a
type class, which is exactly how the FNaF 2 Toy↔Withered swap survived review.

### Dumps produced

- `~/fnaf-apks/fnaf3/events/` — 31 frames, 0 failed, 636 objects, `K=29`
- `~/fnaf-apks/fnaf4/events/` — 23 frames, 0 failed, 485 objects, `K=29`

APKs and the `res/raw/application.ccn` were pulled from the handset. Derived
data only; nothing leaves this machine, per Plan 17's boundary.

### Capability preflight

`node tools/device/capabilities.mjs` ran green on 2026-09-19 and is entirely
handset-level — geometry, HID, screenrecord, and 26 Perfetto data sources.
**Exactly one field is game-bound** (`targetInstalled`, `capabilities.mjs:56`).
Horizon 5's first milestone item is therefore already satisfied for every game
on this phone.

## Per-game reading, from the dumps

### FNaF 1 — the simplest mechanics, the most contested prior art

Movement is one rule per animatronic, on its own timer
(`05-06-Main_Room.txt:1913–1934`):

```
Every 4970 ms:  Random(20)+1 <= bonnie activity  -> move who? = 1
Every 4980 ms:  Random(20)+1 <= chica  activity  -> move who? = 2
Every 3020 ms:  Random(20)+1 <= freddy activity  AND viewing = 0
Every 5010 ms:  Random(20)+1 <= fox    activity  AND viewing <> 99
                                                 AND fox progress < 3
```

Power is `power left = 999` draining `usage meter` per second, where
`usage = 1 + Σ(control room follow 0..4)` (groups 313–315). The 4/20 dials are
`freddy AI`, `bonie AI` *(sic)*, `chica AI`, `foxy AI`, compared against 0 and
20 in `14-15-customize.txt:288–299`.

These timers match the community's published values (4.97 / 4.98 / 3.02 /
5.01 s) exactly — independent corroboration that `K=0` and the decode are sound.

**A discrepancy worth a test, not a claim.** Community guides say Foxy is held
by checking *any* camera. The dump gates his progress on `viewing <> 99`
(a specific view), and group 60 shows `viewing = 3` at `fox progress = 3`
*advancing* him to 4. Group 455 shows the left door repelling him at stage 5,
resetting to `Random(2)`. Whether `viewing = 99` is Pirate Cove, a blackout
state, or something else is `UNKNOWN(unmapped-view-ids)` — the view-id map has
not been built for FNaF 1. This is precisely the class of question this project
exists to settle, and it is the natural first model-vs-phone disagreement.

**The door light is not load-bearing (2026-09-19).** See
[`docs/research/FNAF-SENSOR-ABLATION-RUNS.md`](../docs/research/FNAF-SENSOR-ABLATION-RUNS.md).
A public clear exists with the door lights never used: the light observation is
replaced by continuous camera tracking, paid for in power. That removes a
detector we would otherwise have to calibrate, and moves FNaF 1's difficulty
from *sensing* to *power budgeting* — a scheduling problem, and therefore this
project's strongest ground. The power model is confirmed arithmetically:
`usage` 2/3/4 over an ~89 s in-game hour spends 17.8/26.7/35.6% of the 999-unit
reserve, matching the community's 18/27/36-per-hour figures exactly.

### FNaF 3 — one antagonist, one formula, thin prior art

Springtrap's movement is a single line (`03-04-Office.txt:1585`):

```
move counter > ((10 - AI - aggresive?) + Random(15) - total turns)
```

with `move counter` incrementing every 1000 ms. The community's published
Springtrap formula is "move counter above (10 − AI level) + r − total turns"
with `r` unspecified; **the dump gives `r = Random(15)` and an explicit
`aggresive?` term**, which is a real refinement of the public record.

The failure economy is systems, not power:
`ventilation text` errors when `> 1000 − (AI × 100)` (`:3059`), audio drain
subtracts `AI` per use (`:2093`, `:2136`), and the object table carries
`seal vent button`, `vent 11`–`vent 15`, `what vent is closed`,
`audio error`, `camera error`, `ventilation error`, `ventproof on?`.

This is the most tractable target in the series: one adversary, a closed-form
move rule, no power budget, and a control surface (seal vent, audio lure,
camera, reboot) that maps cleanly onto the existing artifact/plan vocabulary.

**Two corrections and one simplification (2026-09-19).** See
[`docs/research/FNAF-SENSOR-ABLATION-RUNS.md`](../docs/research/FNAF-SENSOR-ABLATION-RUNS.md).

- **`aggresive?` decays.** Group 220 resets it to 0 `Every 15000 ms`. The public
  description treats it as a latch; it is a flag that must be continuously
  re-triggered. A route can therefore *wait out* aggression rather than only
  avoid provoking it.
- **The phantom path is AI-gated.** A phantom jumpscare only raises aggression
  when `Random(5) < AI` (group 662), so on low-AI nights phantoms are often
  free. `Random(15)` is also 0–14, not the 1–15 the public description assumes.
- **One error model, three systems.** Audio, camera and ventilation each decay a
  `* text` AV0 and raise their error at the same `<= -10` threshold, so a single
  scalar-threshold detector covers all three instead of three bespoke rules.

Public clears exist with the cameras dropped *and* with the maintenance panel
never opened, so neither is load-bearing — the minimum control surface is
smaller than the UI implies.

**The movement graph is now extracted (2026-09-19), including the vent map.**
Springtrap's movement is 73 edges, each shaped as "if he is at X and
`action selected` is N, move to Y" — so `action selected` is the branch selector
that the move formula's `total turns` term feeds. Locations 1–10 are cameras and
11–15 are the vents. Each vent has exactly one entrance, always on branch 4:

| Vent | Entered from | Returns to | Or advances to | Steps from death |
|---|---|---|---|---|
| 13 | cam 05 | cam 05 | attack stage 1 | 4 |
| 11 | cam 09 | cam 09 | attack stage 3 | 2 |
| 12 | cam 07 | cam 07 | attack stage 3 | 2 |
| **14** | cam 10 | cam 10 | **GOT YOU 2** | **0** |
| **15** | cam 02 | cam 02 | **GOT YOU 2** | **0** |

The attack chain is stage 1 → 2 → 3 → 4 → GOT YOU, so **vents 14 and 15 bypass
it and kill outright**. That gives a sealing priority the public strategies do
not state: **14 and 15 first, then 11 and 12, then 13.** It also means the two
lethal vents are entered from cam 10 and cam 02 — the two cameras worth watching
hardest, and a cheap belief-gate signal.

**The remaining 19 edges are traced too (2026-09-19), and they are four
mechanisms, not the single audio-lure family an earlier draft guessed:**

- **Spawn.** At frame start Springtrap draws `Random(5)+1` and lands on cam 10,
  09, 08, 07 or 06. Uniform over five cameras, and it is the **first RNG draw of
  the night** — so with the RNG model transferring and only 65,536 streams, his
  starting camera is *predictable per seed* by the same machinery `seedpin`
  already uses. That is the cheapest possible foothold for a seeded FNaF 3 route.

  *Substantiated 2026-09-19, after an earlier draft asserted it without
  checking.* Three draws sit in earlier groups (a cosmetic static effect on
  500 / 360 / 1000 ms timers), so "first" is not free. But `passEvery` in
  `plant-model.js` records, from the runtime decompile of `CND_EVERY2.eva2`,
  that an `Every N` condition **loads its delay on the first reach and returns
  false**. It does not fire, its actions never run, and the `Random` inside them
  is never evaluated. The `StartOfFrame` spawn fires on that same loop, so it
  really is draw #1. Because all four games share runtime 770.0 / build 296,
  this semantics — and therefore this way of identifying a game's first draw —
  transfers to all of them.
- **Audio lure.** The lure is consumed when he is adjacent to it, the target
  camera is stored on him, a per-lure delay is drawn as `Random(100)`, and on
  relocation his **`move counter` resets to 0**. A lure therefore buys a full
  movement-timer reset, not just a reposition — which is why the public
  "let him roam, lures are expensive" advice understates what a well-timed lure
  is worth.

**The movement core, completed 2026-09-19.** Per second: `move counter += 1`,
or **`+= 2` while `hyper on?` is set**. When
`move counter > ((10 − AI − aggresive?) + Random(15) − total turns)`, the
counter resets to 0 and `turn` is raised; `turn` then draws
**`action selected = Random(3) + aggresive? + 1`** and clears itself.
`action selected` 1 means stay, and 2, 3 and 4 select destination branches.

Two consequences that change the model rather than decorate it:

- **Aggression unlocks the vents.** `Random(3)` yields 0–2, so at
  `aggresive? = 0` the branch is {1,2,3} and at `aggresive? = 1` it is {2,3,4}.
  **Every vent entrance is on branch 4.** So aggression does not merely make
  Springtrap arrive sooner — it is the switch that makes the vent routes
  reachable at all, including vents 14 and 15 which bypass the attack chain to
  the kill. A route that keeps aggression at 0 cannot be vented on; one that
  lets it latch can be killed by a path that does not exist otherwise. That
  makes the 15 s decay a first-class control, not a detail.
- **`hyper on?` is not `aggresive?`.** The public accounts describe an
  "aggressive cheat" that doubles the move counter; that is `hyper on?`, a
  separate modifier from the `aggresive?` term inside the threshold. Conflating
  them gives a route twice the movement rate it expects. Distinct names,
  distinct effects, similar words.

**Draw accounting:** `Random(15)` sits *inside* the threshold comparison, so it
is drawn **every tick** whether or not he moves — one guaranteed draw per
second — with `Random(3)` drawn only on a move. That is the per-second cost to
model against the seed.
- **Scripted forced move** on a `force move` / `force to` pair, to three fixed
  cameras.
- **Attack escalation** to attack stage 2 while a screen is being viewed.

With this the FNaF 3 movement model is closed: spawn, per-step rule, branch
selector, full location graph, vent topology and danger ordering, lure effect,
and the aggression term with its six triggers and 15 s decay.

### FNaF 3 on the handset: first night, first actuation (2026-09-20)

Horizon 5's first milestone — capability preflight, a title observer, and a
graded night on the same handset — is **done for FNaF 3**. Frames and provenance
are untracked under `captures/`.

**Night 1 reached 6 AM with zero input.** One tap on LOAD GAME, gated on the
validated title model (refuse unless `rc=0` and `continue` present), and nothing
after it. The office held ~240 s, matching the dump-measured 40 s/hour x 6 for
Night 1 *specifically*; no jumpscare or game-over frame appeared in 34 captures;
a post-night minigame played, which in FNaF 3 follows a completed night. The
decisive evidence is independent of any frame reading: **the title afterwards
reads LOAD GAME 2.** The game banked the night itself.

This milestone needed **no control map**, which is exactly why it was reachable
while the control map is still blocked on schema. Night 1 has no Springtrap, no
phantoms and no system errors, so it is the cheapest possible proof that the
launch, gate, entry, observation and restore path works end to end on a second
game.

**First control actuation, and a correction.** One tap at screen (880,1020) —
measured from the night's own office frames — opened the **maintenance panel**,
sustained across three frames and verified visually. It is *not* the monitor
flip, which is what the bottom-centre tab with a downward chevron and "TAP" was
predicted to be. The monitor flip is a different control and remains unmeasured.

The panel pays for the mistake: it lists exactly four reboot options — audio
devices, camera system, ventilation, reboot all — which independently confirms
the dump extraction where `rebooting` is set to 1/2/3/4 by four separate click
handlers each gated on `rebooting = 0`. Source and screen agree without anyone
having arranged it.

Two things worth carrying:

- **The title model gated two real actions and passed both.** That is the first
  time it authorised rather than merely reported, which is what a gate is for.
- **The office HUD renders the night number and the in-game hour** at the top
  right, so a future 6 AM can be *read* rather than inferred from elapsed time.
  Every claim above about Night 1's outcome would have been cheaper with it.

`UNKNOWN(design-flaw)`: the capture loop force-stopped FNaF 3 *during* the
post-night minigame. Had the game banked the night after that sequence rather
than before, the run would have destroyed the evidence it was creating. Let the
sequence finish next time.

#### The camera button is only reachable in a panned view

**Pedro, 2026-09-20.** The camera control is not on screen at rest: the office
view must be **panned right** before it exists to tap. That is the pan finding
arriving as an operational constraint rather than a hazard — the office is
2000x768 in a 1024 window, the extracted cam objects sit at world x 1640-1940
(the right quarter), and the control simply is not in the default viewport.

So **the camera monitor has no fixed screen coordinate at all**, and no
calibration taken at rest can ever produce one. A FNaF 3 control map must carry
the view offset as a first-class field, exactly as the layer work concluded from
the other direction. `device-profile-v1`'s flat `controlMap` cannot express this
control even in principle.

Two things were ruled out along the way and are worth not re-testing:

- The bottom-centre tab with a downward chevron and "TAP" is the **maintenance
  panel**, and its two chevrons are two ends of one bar: tapping at (880,1020)
  and at (1219,1021) both open maintenance. It is not the monitor.
- A slim white vertical bar at the right edge (x ~2368-2378, y ~390-680) is a
  **glitched Android system marker, not a game control**. Tapping near it risks
  an edge gesture rather than anything in the game.

#### The control surface, reached and measured (2026-09-20)

**Short synthetic taps are dropped by this engine.** `adb shell input tap` is a
near-instantaneous contact and whether it registers is phase-dependent: the
LOAD GAME tap worked three times, then failed three consecutive runs with the
menu rows provably unmoved. A **160 ms held contact** has landed on every
attempt since. This is `MIN_CONTACT_MS` — the project's own Night 5 finding —
transferring intact to FNaF 3, and it should be assumed for every game here.

**Panning is a hold, not a swipe, and one hold is the whole range.** Holding
near the right edge pans the office; swipes barely move it (two swipes gave
208 px). A single ~2.5 s hold at (2200, 540) moves the view **968 px** and
saturates against the world edge — three further holds changed nothing,
measured as byte-identical frames. That 968 px independently confirms the frame
header's 2000 − 1024 = **976 px** predicted range, from live device behaviour,
to within 8 px. `UNKNOWN(not-measured)`: the minimum hold below 2.5 s.

**The access path, end to end:**

| step | control | how |
|---|---|---|
| enter night | LOAD GAME (480, 641) | 160 ms held contact |
| pan right | (2200, 540) | one ~2.5 s hold, saturates |
| camera monitor | **(2212, 327)**, panel x 2106-2318 y 131-522 | 160 ms held contact |
| audio lure | Play Audio, centre **(1248, 812)** | camera-map mode only |
| vent map | Map Toggle, centre **(1250, 927)** | toggles, confirmed both ways |

**Map Toggle swaps the camera map for the vent map**, showing CAM 11-15 joined
by link lines — the same five vents, in the same numbering, that the event sheet
gave. Two findings from it that a route must respect:

- **Sealing a vent is a double-tap** on its vent cam button, stated by the
  game's own on-screen instruction. Not a single contact.
- **Play Audio is absent in vent-map mode.** The lure and the seal live in
  mutually exclusive view states, so a route cannot do both without paying a
  toggle between them. That is a scheduling constraint, not a UI detail, and it
  interacts directly with the lure's move-counter reset.

So the camera monitor, the lure and the vent seal are all now reachable, and
every one of them sits behind the pan. None has a fixed screen coordinate at
rest.

### FNaF 4 — no cameras, audio-dominant, and the mobile port helps

FNaF 4 has no camera system. Its control surface is named explicitly in the
mobile build's object table, which is unusually friendly:
`HUDDoorLeftHitzone`, `HUDDoorRightHitzone`, `HUDDoorClosetHitzone`,
`HUDFlashlight`, `HUDCloseDoor` and their hitzones, plus state objects
`left door shut`, `right door shut`, `bed view`, `viewing closet`, `in closet`,
`on bed`, `closetcreak`.

**Named touch targets in the dump** mean the control map can be derived rather
than probed pixel-by-pixel — a genuine saving over FNaF 2's calibration history.

The apparent cost is sensing: FNaF 4 is decided by *listening*, and audio is
this stack's weakest observation channel. It is not absent — `bt-audio-link.sh`,
`collect-cue-audio.sh` and the BT audio capture chain exist and are wired into
`night-run.sh --bt-audio` — but nothing has ever graded a night on audio alone.

**That objection is retired (2026-09-19).** See
[`docs/research/FNAF4-AUDIO-INDEPENDENCE.md`](../docs/research/FNAF4-AUDIO-INDEPENDENCE.md).
A public no-audio clear exists, and its central trick checks out in our own
dump: **group 341** shows that closing a door while Bonnie is elsewhere
*teleports* him to `left hall near` — an anti-cheat that converts an
unobservable state into a forced, known one. **Group 342** pushes him back on a
**3000 ms** hold (the public strategy recommends ~5 s, so it over-holds by ~2 s
per visit). Movement is further gated on `left door shut = 0` and
`listening mode <> 1` (**groups 284–285, 288–290**), so *both* holding a door
and listening at one suspend that side's movement outright, with no observation
required. Freddy's meter is exact: `+Freddy AI` every 4000 ms, draining 1 per
50 ms while the bed is viewed (**groups 397, 401**).

FNaF 4 is therefore a good fit for exactly what already wins here — an open-loop
schedule against a 5000 ms roll grid and a 4000 ms meter tick. Its real costs
are the unmapped `follow` player-state machine and the still-unverified
wait-to-kill timers, both cheap to close from the dump we now hold.

### Input lockouts: check the emitter before trusting any model score

**Raised by the peer session 2026-09-19, then traced in our dumps.** On FNaF 2
the engine drops input during the mask-ON animation (`MASK_ANIM_ON`, 200 ms) and
nothing in `artifact-commands.mjs` gated it — only the mask-*off* window was
enforced. A `minus7` plan authored a mask-off 133 ms after its own mask-on press
and **the phone dropped it on 48 of 55 cycles**. This is mistake register #10
exactly: a window measured in one direction does not transfer to the other.

Each expansion target has its own version of this, and they are not the same
mechanism:

- **FNaF 1 — a confirmed ~167 ms door lockout.** `click cooldown` is set to
  **10** by *every* door toggle (groups 168, 178, 179), decremented once per
  frame by the delta scale (`Max(0, click cooldown - 1 * GlobalValue[10])`,
  group 166), and **every** door toggle carries `click cooldown = 0` as a
  condition. A press inside that window fails its condition silently — no
  feedback, no animation, nothing to observe. At 60 fps that is ~167 ms on
  FNaF 1's *primary* control. The community 4/20 loop
  (`Left Door Light -> Camera -> Right Door Light -> Camera`) hammers exactly
  this control, so an emitter that ignores the lockout will drop presses the
  same way `minus7` did.
- **FNaF 4 — no time cooldown; a state guard instead.** Input arrives through
  `Multiple Touch` hitzone conditions carrying **mutual-exclusion** clauses
  (e.g. flashlight-hitzone touched AND NOT close-door-hitzone touched), and what
  is actionable at all depends on the `follow` player-position value. The risk
  is not a timer but acting while `follow` is in transition or while a second
  hitzone is live. This is another reason the `follow` map is a blocker.
- **FNaF 3 — traced 2026-09-19: no time-based input lockout on the night
  controls.** The `cooldown` object that prompted the question is used only in
  the Extras frame, never in the Office frame, so it has nothing to do with a
  route. `scare cooldown` *is* in the Office frame and is set to 10, but group
  797 decrements it once per **1000 ms** and the states it guards are phantom
  events (Phantom Freddy's walk, the Balloon Boy peek that spawns a scare) — it
  is a **10-second rate limiter on phantom scares, not on player input**. Since
  a phantom scare is one of the six ways to raise `aggresive?` (and only when
  `Random(5) < AI`), this also bounds how often phantoms can drive aggression.

  FNaF 3's controls are gated by **state, not time**, which is the FNaF 4 shape
  rather than the FNaF 1 one: the audio lure needs `play counter = 7` with the
  vent-map toggle off, and the seal button requires `viewing >= 2`, the toggle
  on, and `going to seal = 0`. Two counters that look like timers are not:
  `going to seal` has no decrement anywhere — it holds 11-15, is copied into
  `what vent is closed` on commit and reset, so it is a **vent selector
  register**; and `you in` / `mon in` hold 1-15 and are compared to each other,
  so they are **location registers** over the ten cameras plus five vents.

  Consequence for the emitter: there is no hidden drop window to respect here,
  but a press is silently ignored when its *state* precondition is unmet, which
  needs the same care for a different reason.

**Rule for Plan 26: no model score for a new game is trustworthy until the
emitter is shown to respect that game's lockout in both directions.** The FNaF 2
defect survived because only one direction was gated and the gate looked
complete.

### Every night frame scrolls, and by different amounts

**Measured from the frame headers of all four CCNs, 2026-09-19.** The peer
session's Minus 3 diagnosis — a held contact pans the office, the vent buttons
move with the view, and the profile taps a fixed coordinate with no pan state
modelled anywhere — is not specific to FNaF 2. Every night frame in the series
is wider than its window:

| Game | night frame | virtual | window | horizontal pan |
|---|---|---|---|---|
| FNaF 1 | `06-Main Room` | 1600x720 | **1280x720** | +320 px |
| FNaF 2 | `04-Office` | 1600x768 | 1024x768 | +576 px |
| FNaF 3 | `04-Office` | 2000x768 | 1024x768 | **+976 px** |
| FNaF 4 | `04-level` | 1300x768 | 1024x768 | +276 px |

Pan is horizontal only on every night frame; vertical scrolling appears just in
minigames and cutscenes.

Three consequences:

- **It quantifies the FNaF 2 hazard.** 576 px of 1600 — 36% of the world width
  — can slide under a fixed screen coordinate, which is more than enough to
  move a vent button off a tap point.
- **FNaF 3 is the worst case**, at 976 px of 2000. Its office controls sit at
  x 1640-1940 in world space (the monitor map, extracted from the frame's
  placed instances), so they are the objects *most* exposed to pan. A FNaF 3
  control map that ignores pan state will be wrong much of the time.
- **FNaF 1 does not share the others' window.** It is 1280x720 and 16:9, where
  FNaF 2, 3 and 4 are all 1024x768 and 4:3. So FNaF 1 needs its own
  virtual-to-screen mapping; the existing geometry calibration does not carry
  over to it even on the same handset.

**Therefore pan state is part of a control map by construction, not something
to discover on hardware.** A control point is a world coordinate plus the view
offset it assumes, or it is not a control point.

#### The intersection coordinate has a precondition, and it may not hold

FNaF 2 already solved a version of this. `tools/device/coords.sh` carries
`TAP_CAM_LIGHT="900 540"` labelled as the cam-flash/hall-flash **intersection
position**, against `TAP_HALL="1200 540"` for the standalone beam, with
`hid-intersection-probe.mjs` and `intersection-state-gate.mjs` built around it.
One engine action, two semantic names, and a coordinate picked to work in both
states at once — which `vocabulary.js` anticipates by refusing to name `light`
at all, "because its meaning depends on monitor state".

That works because of a precondition nobody had to write down: **an intersection
coordinate exists only while the control's hit area still overlaps across every
state it must cover.** The flashlight displaces about 300 px between FNaF 2's two
states, inside a 576 px pan range, and an intersection was findable.

FNaF 3's pan range is **976 px in a 1024 px window** — nearly the whole viewport.
If any FNaF 3 control displaces by more than its own hit width, no intersection
coordinate exists for it at all, and the FNaF 2 coping strategy does not
transfer. It fails by *silently having no solution*, not by being hard to
calibrate.

`UNKNOWN(not-measured)`: this is a statement about the pan **range**, not about
any specific control's state-to-state displacement, which needs the view offset
in each state. **Measure per control before designing a control map around
intersections.** The relevant quantity is displacement against hit width, and on
FNaF 3 and FNaF 4 — where no layer is pinned at all — every control is a
candidate.

#### And the view chases an object, per camera

`CenterDisplayX` in each night frame centres the display on a **marker object
selected by `viewing`** (the camera id), not on a player-dragged offset. FNaF 1
follows `screen follow 1` on a camera and `control room follow` in the office;
FNaF 2 follows `camera follow` on some cameras, `camera follow 2` at
`viewing = 0`, and hard-zeroes on cams 1-4, 5 and 6; FNaF 3 follows `scroll` and
`scroll 2`. So the office and every camera view share one wide frame, and a
fixed screen coordinate maps to a **different world position per camera**. If a
route needs pan state, that marker's x *is* the state variable.

#### Which controls actually move: layer scroll coefficients

Read from each night frame's Layers chunk as **16.16 fixed point** — a float
read returns 0.000 for every layer of every game, which is a parse artifact and
not a measurement. FNaF 2's Office:

| layer | xCoef | holds |
|---|---|---|
| 0 | **1.00** | `lightLeftHitbox`, `lightRightHitbox`, `left/right light`, both `camera follow` markers |
| 3 | **1.00** | every `hud*` object, and `monitorFrame` |
| 4 | **0.00** | `flip mask button` |
| 5, 6 | 0.00 | — |

**The light hitboxes scroll 1:1 with the view; the mask button does not move at
all.** That predicts the exact asymmetry the peer session is seeing on Night 3 —
mask presses landing while light presses fail — without another device run. The
`hud` prefix is a red herring: those objects are on layer 3, which also scrolls.

Across the series: FNaF 1 has two pinned layers, FNaF 2 has three, and
**FNaF 3 and FNaF 4 have none — every layer in both night frames is 1.00.** So
for the two most attractive expansion targets, *no* control can be tapped at a
fixed screen coordinate without knowing the view offset. A flat `controlMap` of
screen coordinates, which is what `device-profile-v1` carries today, cannot
express that; it needs world x plus layer.

### What a second game buys the seed machinery

**Pedro's observation, 2026-09-19, measured the same day.** The expansion is not
only a test of whether the architecture transfers — a second target is a better
*laboratory* for seed reading and writing than FNaF 2 is.

The burden on seed prediction is not the total number of `Random` calls. It is
the **timer-driven** ones: draws consumed on wall-clock schedules that a model
must reproduce exactly whether or not anything happens. Conditional draws fire
only on events the simulator already tracks. Counted over each game's night
frame:

| Game | total draws | **timer-driven** | distinct timers |
|---|---|---|---|
| **FNaF 3** | 115 | **21** | 8 |
| FNaF 1 | 49 | 30 | **11** |
| FNaF 4 | 107 | 34 | 8 |
| FNaF 2 | 123 | **53** | 6 |

FNaF 3 carries the lightest continuous load of the four — **21 against FNaF 2's
53**. Its seed-to-outcome mapping is the least polluted by background
consumption, which is exactly the property that makes prediction tractable.

Note that FNaF 1 inverts on this metric: fewest total draws, but the **most
distinct timers** to keep a ledger synchronised against. Fewest draws is not the
same as the easiest seed problem, and the 2026-09-15 note that skipped draws
scramble seed predictions is about precisely this.

Three concrete gains, in order of value:

1. **A seconds-long falsification loop.** Validating a seed prediction today
   costs a full night plus grading. FNaF 3's spawn is readable from one camera
   within seconds of a night starting, turning a ten-minute experiment into a
   near-instant one. That is the largest throughput change available to this
   machinery.
2. **An oracle near the seeding instant.** Spawn is the first draw and is
   directly observed, so it probes *when the seed is taken* far more directly
   than inferring backwards from a death 200 s in — the open question that is
   currently pinned only to a 12 ms logcat bracket.
3. **Cheap twin verification.** Proven twins at 24850 did not replay the night.
   Two FNaF 3 runs on one seed must show the same spawn camera, checkable
   immediately rather than by comparing whole nights.

**The honest limit:** one-in-five is about 2.3 bits. Spawn narrows the seed
space quickly; it does not pin a seed on its own.

## Community strategies, by game

Named so that a machine-found route can be compared against what people
actually do. These are `CLAIMED` (community guides), not measured here.

**FNaF 1, 4/20.** The canonical loop is
`Left Door Light → Camera → Right Door Light → Camera → repeat`. The run is
dominated by the **right door**, because Freddy at AI 20 parks at CAM 4B nearly
permanently. Foxy is held by camera attention (community: *any* camera, East
Hall Corner recommended; and "never check Pirate Cove with the right door
open"). Power discipline is the binding constraint. See
[the 4/20 guide](https://steamcommunity.com/sharedfiles/filedetails/?id=3087295888)
and [the 20/20/20/20 guide](https://steamcommunity.com/sharedfiles/filedetails/?id=322029011).

**FNaF 2, 10/20.** This repository's own families: **Minus 7**, **Minus Toys**
(the route that actually wins on hardware), **Minus 3**, **right vent camp**.
Community equivalents are the mask-flash-wind cycle with Music Box priority.

**FNaF 3, Nightmare / Aggressive.** The dominant published line is
**"let Springtrap roam" rather than lure**, because every audio lure costs
reboots. Seal the vent adjacent to the room he just entered; if he reaches
CAM 05, lure back toward CAM 06 (or 08); keep flipping the monitor to stagger
error onset; reboot ventilation **preemptively** when safe. Tru3P1ay3r's
strategy is the named reference —
[guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2553506510).

**FNaF 4, 20/20/20/20.** Rotation is `Left Door → check Freddles → Right Door`,
driven by an audio rule: **breathing → hold the door until footsteps, then
flash; no breathing → flash immediately**. The night has a phase change when
Nightmare Foxy enters the closet (signalled by the creak), after which the
closet is held ~6 s per visit and the rotation adds a Foxy check. The strongest
published line ignores Bonnie and Chica and plays **Foxy plus the bed**. See
[the Night 8 strategy](https://steamcommunity.com/sharedfiles/filedetails/?id=493684444).

## Prior art, updated 2026-09-19

The standing survey is [`docs/research/FNAF-BOT-CENSUS.md`](../docs/research/FNAF-BOT-CENSUS.md)
(snapshot 2026-08-26); this is a delta, not a replacement.

- **FNaF 1 is the crowded target.** Many external scripted 4/20 bots
  (`The2AndOnly/fnaf-python-bot`, `kevvit/fnafbot`, `Sebastian1320`, `Screw13`,
  `GROTTAKE/FNAFBot` in C++/OpenCV) plus `LucMazarJR/no-more-jumpscares`, a PPO
  agent trained against the real executable. A clear here is a *method*
  validation, not a novel result.
- **FNaF 3 remains thin.** Re-checked: `Maraba23/Fnaf-playbot`'s FNaF 3 branch
  resolves templates once at import (stale detections), `ChristianLW/fnaf3bot`
  is a Twitch voting controller, REKA is video-only. No source-available
  autonomous stock-game player.
- **FNaF 4 is thinnest.** `Doonguin/fnaf4-sim` was re-fetched today: it
  documents Bonnie, Chica, Foxy, Freddy, Fredbear and Nightmare mechanics but
  **still has no trained agent, policy, or training loop** — a simulator
  scaffold, as the census recorded. REKA is video-only.
- **Still nobody publishes measured closed-loop latency for a reactive bot on a
  physical handset** (this project's own Android survey).

**The strategic reading:** FNaF 1 is where the method is cheapest to *validate*
and the result least novel. **FNaF 3 and FNaF 4 are where a graded,
source-derived, physical-handset clear would have no public precedent at all.**

## What it costs in this repository

Measured 2026-09-19.

**Decoupling — small and localized.**

- `CONTROL_VOCABULARY` (`packages/source/src/clockwork/vocabulary.js`) is a frozen
  FNaF 2 enum bound to `CONTRACT:semantic-control-v1`: **113 reference sites
  across 11 files**. FNaF 1/3/4 share only `monitor`. This is the one real job.
- Game rules that leaked out of core and must come back in:
  `apps/device/src/service.js:32-33` hardcodes which controls need the monitor
  up vs down; `apps/device/src/artifact-executor.js:107-121` pins `camdrop` and
  `observe-left` to specific FNaF 2 controls.
- Already parameterized, needing no structural change: `menu.sh:39,46` reads
  `MENU_PACKAGE`/`MENU_TARGET_VERSION` from the environment;
  `device-profile-v1` already carries `targetBuild` and a named `controlMap`,
  so a per-game profile is **data**; `capabilities.mjs:56` is a one-line fix.
- The semantic contract layer is already method: **61 contracts, 2 game-bound**.

**Rebranding — wide, shallow, and deliberately deferred.**

- **463 of 1026 tracked files (45%)** mention FNaF 2; 1951 occurrences.
- The `@fnaf2-1020/*` scope: **718 imports across 204 files**, plus the repo
  directory, root package name, and the `fnaf2-cue-helper` MCP server. The
  Android companion (`com.ppvaz.fnafcompanion`) is already game-neutral.

**Do not rebrand first.** It is 45% of the tree for zero evidence value, it is
pure bookkeeping under the consequence lock, and a tree-wide rename will collide
with peer sessions that stage broadly. Rename once a second game has earned it,
in one mechanical commit, to a neutral scope.

## Recommended order

1. **FNaF 1 as a one-session method calibration.** Cheapest mechanics, and a
   community baseline to check the port against. Explicitly a method test, not
   a novelty claim. Its deliverable is the change log horizon 5 asks for: which
   modules moved, tagged general or game-specific *before* starting.
2. **FNaF 3 as the first novel target.** One adversary, a closed-form move rule
   already extracted, no power economy, and no public precedent.
3. **FNaF 4 third — but no longer for the original reason.** It was sequenced
   last because it looked audio-bound; that objection was retired on 2026-09-19
   and the ordering now rests only on prior-art novelty and control-surface
   cost. Its open blockers are the `follow` state map and the wait-to-kill
   timers, both readable from the dump without touching the phone. If either
   FNaF 1 or FNaF 3 stalls on hardware, FNaF 4 is a legitimate substitute
   rather than a fallback.

### The FNaF 3 vent seal, actuated — and it is a timed, cancellable commit

**Measured on the handset 2026-09-20**, closing the three items the previous
commit left open.

**Camera selection** is a single 130 ms held press on a CAM label in the vent
map, and it is self-reporting: the label turns from grey (102,102,102) to green
(153,173,61). **Sealing** is a second press on the same target. The bar beside
the selected vent goes from green (66,106,82) to red (112,65,80). So the map is
a **two-stage button** — select, then commit — not a double-tap gesture.

This corrects, by extension, the claim above that `going to seal` "has no
decrement anywhere". That is true of `going to seal` itself, and it made the
seal look instantaneous. The decrementing counter is a *different* one:

- Group 572 arms the seal and sets `seal vent button` AV19 to
  **`50 + Random(50)`**.
- Group 582 decrements AV19 by `1 * GlobalValue[0]` each tick.
- Group 583 commits only at AV19 = 0, copying `going to seal` into
  `what vent is closed`.
- Group 578/586 show and hide a `sealing progress` object across exactly that
  window, and group 583's neighbour sets its animation speed to
  `2 + Random(10)`.

So the seal takes **50-100 frames (~0.83-1.67 s at 60 Hz)**, it is visible on
screen throughout, and the operator independently reported seeing "sealing"
frames before the bar changed — an observation that matches the window and was
made without reference to the source.

**It cancels.** Group 584 (vent-map toggle off) and group 585 (`viewing <= 1`,
monitor down) each zero *both* `going to seal` and AV19. A route must hold the
vent map open for the whole charge; a press followed by an early flip is not a
slow seal, it is no seal. And `what vent is closed` is a **single counter**, so
**only one vent is sealed at a time** and a second seal replaces the first —
which every public account flattens into an accumulating defence.

This is the accumulate-vs-set question from the FNaF 2 mask defect, asked of a
different mechanic and answered the other way: the seal **sets**, so it cannot
be short by a tick, but it **can be interrupted**, which is a failure mode the
mask never had.

### Reboot timings, and FNaF 3 as an RNG instrument

`cursor` AV1 is the reboot progress counter, zeroed when `rebooting = 0`.
Group 425 (`rebooting > 0 AND < 4`, `Every 1000 ms`) adds `1 + Random(2)`;
group 426 (`rebooting = 4`, the reboot-all case, `Every 2000 ms`) adds the same.
All complete at `cursor AV1 >= 10`. Therefore:

| reboot | ticks | duration | mean |
|---|---|---|---|
| single system (audio, camera, ventilation) | 5-10 x 1000 ms | **5-10 s** | ~6.7 s |
| reboot all | 5-10 x 2000 ms | **10-20 s** | ~13.3 s |

Durations are **stochastic, not fixed** — a schedule that budgets a constant
reboot time is wrong for half the draws.

More useful than the timing: FNaF 3's draws are **accountable**, which is what
makes it a better seed laboratory than FNaF 2 rather than merely a noisier one.

| draw | when | observable | player-triggered |
|---|---|---|---|
| `Random(5)+1` spawn | once, frame start | yes — which camera | no |
| `Random(15)` move test | every 1000 ms, unconditional | indirectly | no |
| `Random(3)` action | on each move | yes — where he went | no |
| `1 + Random(2)` reboot tick | per tick while rebooting | yes — the duration | **yes** |
| `50 + Random(50)` seal charge | per seal | yes — the charge length | **yes** |
| `2 + Random(10)` sealing anim | per seal | yes — the animation rate | **yes** |
| `Random(100)` lure delay | per lure | indirectly | **yes** |
| `Random(5) < AI` phantom | per phantom scare | partly | no |

Two properties follow. First, the reboot and the seal are **pollable oracles**:
the player chooses when to draw, and the result is legible on screen. A seal
alone exposes a value in [50,100] plus one in [2,12]. Second — and this is the
harder-won property — **stream position is knowable**. Each second consumes one
move-test draw unconditionally, plus one per active reboot tick, plus one
`Random(3)` if the attacker moved; and whether he moved is visible on the camera
map. That is exactly what fails in FNaF 2, where skipped Foxy draws scramble
seed predictions (`handoff_20260915_foxy_chain`).

UNKNOWN(not-measured): whether a reboot's observed duration actually narrows the
seed set in practice. The arithmetic above says it should; no census has been
run. That is the next cheap experiment, and it needs no device time.

### FNaF 1 on the handset, and the honk in all four games

**Measured 2026-09-20.** FNaF 1 v2.0.7 (`com.scottgames.fivenightsatfreddys`),
same handset. Night 1 entered, abandoned deliberately without a death.

**The title is laid out unlike the other three.** The menu is left-aligned and
`Options` / `Unlocks` are right-aligned, where FNaF 2/3/4 centre everything.
`Continue` carries a *"Night 1"* subtitle rather than a trailing digit, so a
save-slot reader written against the FNaF 3 model will not transfer.

| item | screen centre |
|---|---|
| New Game | (519, 606) |
| Continue | (520, 725) |
| Options | (2113, 852) |
| Unlocks | (2114, 965) |

`Unlocks` remains the vocabulary problem already flagged in the FNaF 3 title
model: it is a real menu target with **no honest alias** in this project's
semantic `MenuTarget` set, unlike LOAD GAME which maps cleanly to `continue`.

**Options carries a different subset again.** Display Mode (Full), Perspective
Effect (On), Vibrations (On), and the three subtitle settings — but **no
Controller Size and no Show Tips**. Across the three games now read on device,
only **Display Mode** is universal. A "render settings" preflight cannot assume
a fixed list.

#### The scale was wrong, and a null pan result is why

FNaF 1's window is **1280x720**, not the 1024x768 the other three use. The first
reading assumed the 20:9 screen would reveal the full 1600 px frame at 1080/720
= 1.5x, implying no pan at all — and a 2500 ms hold at the **left** edge moved
the view **0 px**, which appeared to confirm it.

It confirmed nothing. The view was already at the left limit, so the null result
measured saturation, not absence. A hold at the **right** edge then moved the
view **601 px**, and 320 design px x (2400/1280) = **600**. So:

```
screen_x = (design_x - pan) * 1.875      pan in design px, range 0..320
screen_y = design_y * 1.5                the frame is stretched, not cropped
```

~~Display Mode FULL **fills the width and crops the height** here (720 x 1.875 =
1350 against 1080), which is the opposite of the assumed letterbox.~~
**Retracted 2026-09-24:** FULL *stretches* the 1280x720 frame to 2400x1080
(x 1.875, y 1.5). The dump's flip panel at design (554,668) lands on the
measured monitor point (1040,1002) only under the stretch -- a centred crop puts
it off-screen at y=1117 -- and the title rows and every Custom Night control
land within 4 px of their placed instances under it
(`tools/device/models/title-fnaf1-moto-g56-v207.json`,
`tools/device/models/custom-night-fnaf1-moto-g56-v207.json`). This is
mistake register #12 in a new costume — an absent observation became evidence
before the detector had ever read the positive — and the operator caught it
before it was written down.

**Every game starts the night panned fully left.** Stated by the operator and
consistent with every measurement here: FNaF 1's left hold moved nothing,
FNaF 3's single right hold saturates at 968 px, and FNaF 4's room view opens
facing the left door. It makes pan state at t=0 a known constant rather than
something to observe, which is worth more to a route than any single coordinate
below.

#### Office controls, and a constraint the flat schema cannot express

| control | screen centre | pan required | scrolls? |
|---|---|---|---|
| left DOOR | (106, 495) | 0 | yes |
| left LIGHT | (106, 687) | 0 | yes |
| right DOOR | (2286, 520) | +600 (full right) | yes |
| right LIGHT | (2286, 707) | +600 (full right) | yes |
| camera tab | (1040, 1002) | any | **no — pinned** |

The left door sits at world x 106 and the right door at world x 2885
(2285 + 600). They are **2779 px apart on a 2400 px screen, so the two doors can
never be visible at the same time.** Every door press in FNaF 1 is therefore
*pan, then press* — a two-step actuation with a hold of its own, on a game whose
public strategies describe door control as instantaneous. A `controlMap` of flat
screen coordinates cannot express this at all; it is the same hole
[WHY-FACTS-HIDE.md](../docs/operations/WHY-FACTS-HIDE.md) pattern 1 names.

**The control surface is mixed, and the split is a port convention.** The
camera tab's bar occupies x 475-1605 **identically at both pan extremes**, while
every wall button moves with the view. That is the same division FNaF 2 shows --
scrolling light hitboxes, pinned mask button -- so it is not a per-game quirk:
diegetic wall controls are world-anchored, HUD overlays are screen-pinned. A
profile that stores one flat coordinate per control is right for exactly half of
them.

#### The pan floor: 270 ms, and how the first two answers were wrong

A full pan was being driven with a **2500 ms** hold, ported from the FNaF 3 work
without re-derivation -- mistake register #4. Measuring it:

| hold | outcome |
|---|---|
| 150 ms | ~390 px of 601 |
| 215-235 ms | 507-586 px, never saturating |
| 240 ms | **saturated 2 of 5** |
| 250 ms | 4 of 5 |
| 260 ms | 4 of 5 |
| **270 ms** | **5 of 5** |
| 280 / 300 / 340 / 400 ms | 5 of 5 |

The first answer was "240 ms", taken from a single run that happened to reach
601. Repeating it five times saturated twice. That is mistake register #7 in its
purest form -- a floor anchored to one measurement rather than to a measurement
plus a margin -- and it would have shipped a pan that silently fails about
three times in five.

**The floor is 270 ms** (5/5, with 260 ms at 4/5 immediately beneath it). With
the project's 33 ms seam-slack requirement a route should hold **~310 ms**, which
is still an 8x saving on the 2500 ms it replaces.

Run-to-run scatter below the floor is about +/-30 px, consistent with 60 Hz
quantisation over the ~14 frames a full pan takes, plus jitter in `input swipe`
duration. Any single-shot timing measurement on this device needs repeats.

#### The FNaF 3 pan floor: 1025 ms, and why it took four attempts

The first attempt produced six duration sweeps of pure noise. The night had
ended and every frame was the post-night **minigame**, not the office; nothing
had been looked at. Discarded entirely. Three instrument faults had to be fixed
before a number appeared, and each is reusable:

1. **Look at a frame before trusting numbers computed from it**, and put the
   state guard *inside* the measurement loop rather than after it.
2. **A dim frame is a retry, not an abort.** Night 2+ dims the office
   periodically; the first guard treated that as "night over" and quit on the
   opening frame. Distinguish transient (retry) from persistent (stop).
3. **Do the thinking before the clock starts.** FNaF 3's Night 1 runs ~4 minutes
   (40 s/hour against 60 s on later nights). Composing commands during the night
   burned three nights on its own. The working method is a pre-written script
   that enters the night itself and measures without pause.

Cross-correlation also had to be abandoned: the office's **tiled green walls**
alias, and it reported 1144 px of travel against a known range of 968. The
instrument that works is exact frame equality against a saturated reference,
with the reference proven stable (`|SAT-SAT2| = 0.00`) and the left reset proven
complete (`reset drift 0.00`).

| hold | saturated |
|---|---|
| 800 ms | 0 of 1 (\|f-SAT\| 16.3) |
| 975 ms | **0 of 5** |
| 1000 ms | **2 of 5** |
| **1025 ms** | **5 of 5** |
| 1050 / 1100 / 1150 / 1200 ms | 5 of 5 |
| 1300 - 2500 ms | 5 of 5 |

**The floor is 1025 ms**, bracketed by 1000 ms at 2/5 and 975 ms at 0/5 -- a
clean transition inside 50 ms. With the 33 ms seam-slack requirement a route
should hold **~1060 ms**, against the 2500 ms previously used.

Note that 1000 ms saturating 2 of 5 is the **same failure mode** as FNaF 1's
240 ms saturating 2 of 5. Both were single lucky samples that would have shipped
as floors. Any timing floor on this device needs five repeats on *both* sides of
the boundary, not one measurement at the value that worked.

#### Pan rate is a per-game constant, and port reuse is invalid

| game | travel | floor | rate |
|---|---|---|---|
| FNaF 1 | 601 px | 270 ms | **2.23 px/ms** |
| FNaF 3 | 968 px | 1025 ms | **0.94 px/ms** |

FNaF 3 is not merely panning further -- it pans **2.4x slower per pixel**, and
3.8x longer in wall time. The 2500 ms hold in use was a single number applied to
both games. It is wasteful on FNaF 1 by 9x and on FNaF 3 by 2.4x, and had either
game been faster instead it would have been silently short. This is mistake
register #4 with two data points instead of an argument: **a deadline measured
on one game is not a deadline on another.**

#### The nose honk exists in all four games

Worth mapping because it is the one control that is pure output — it changes no
game state, so it is free to actuate and it is the cheapest possible proof that
an emitter reached the right pixel.

| game | object | placed position | layer |
|---|---|---|---|
| FNaF 1 | `honk.Active` | two instances: (0,0) and (60, 288) | 0 / 3, moved to 2 |
| FNaF 2 | `honk` | (153, 167), runtime `SetPosition (142, 203)` | 8 |
| FNaF 3 | `nose honk` | (939, 476) | 1 |
| FNaF 4 | `honk` | **(-52, 242)** | 5 |

FNaF 4's negative x is independent corroboration that its FULL display mode
reveals a margin outside the 1024-wide design area — a second route to the same
conclusion the control positions gave.

**FNaF 1's is verified on the phone**: it is Freddy's nose on the CELEBRATE!
poster, at screen **(1267, 361)** at pan 0, and three 160 ms taps produced three
audible honks. The dump agrees on the shape — group 483 fires on a click with
`viewing = 0` (monitor down) and does nothing but `PlayChannelSample`, so there
is no game consequence and no cooldown in the event path.

Note that the placed instance at design (60, 288) does **not** map to the
measured nose position under the 1.875 scale, and FNaF 1 declares two `honk`
instances. Whichever is live is repositioned or differently scrolled at runtime.
The measured coordinate is the trustworthy one; the placed pair is not yet
resolved. UNKNOWN(not-measured): the honk position on device for FNaF 2, 3 and
4 — only FNaF 1's has been pressed.

### The pan question has three different shapes, not one

Asked across all four games, "what is the pan floor?" turns out to be the wrong
question for half of them. Measured 2026-09-20:

| game | pan is... | the measurement that matters |
|---|---|---|
| FNaF 1 | a deliberate edge hold, 601 px | **minimum** hold to complete it -- 270 ms |
| FNaF 3 | a deliberate edge hold, 968 px | **minimum** hold to complete it -- 1025 ms |
| FNaF 2 | an **unwanted side effect** of holding a control | **maximum** hold that does NOT pan |
| FNaF 4 | absent -- discrete rotation only | hold durations, and the double-tap gap |

FNaF 2 is the inverted case and the highest-stakes one, because it is the only
game with a live route. Holding `rightVentLight` pans the office and carries the
hall and vent buttons with it, while the profile taps fixed coordinates with no
pan state modelled anywhere. A route there does not *want* to pan; the pan is
damage. So the useful number is not "how long to pan" but **"how long can the
vent light be held before the view starts to move"** -- a safety ceiling, not a
floor, and it bounds every hold in the FNaF 2 plan rather than enabling one.

That measurement is not taken. It belongs to whoever owns the FNaF 2 route and
should be coordinated rather than duplicated, since both sessions share this
handset.

FNaF 4 needs no pan number at all: its frame (1300 design px) is narrower than
the window that Display Mode FULL reveals (~1706 design px), so nothing can be
off-screen. Its facings are also **pixel-exact on return**, which means facing
state is verifiable by frame equality with no feature detection.

## What actually blocks actuation on a second game

**Written 2026-09-20.** By this point the control surfaces of FNaF 1, 3 and 4
are measured on the handset. None of them can be actuated, and the reason is
not missing mechanics knowledge. It is that the device stack is FNaF 2-shaped
in three specific ways. Each was previously recorded only as a scattered
observation; this section states them as blockers so they can be closed.

### Blocker 1 — the profile cannot say *where* a control lives (SCHEMA CLOSED 2026-09-20)

`device-profile-v1` carries a flat `controlMap` of screen coordinates. Every
game measured has **two kinds of control** and the schema cannot distinguish
them:

| kind | behaviour | examples |
|---|---|---|
| world-anchored | moves with the pan | FNaF 1 door/light buttons, FNaF 2 light hitboxes, FNaF 3 office controls |
| screen-pinned | fixed regardless of pan | FNaF 1 camera tab (x 475-1605 at both extremes), FNaF 2 mask button |

A single coordinate is correct for the pinned half and silently wrong for the
rest. FNaF 1 makes the consequence unavoidable rather than subtle: its two door
buttons sit 2779 px apart on a 2400 px screen, so **they can never both be on
screen**, and every door press is *pan, then press*.

Two things must change together: the profile needs an anchor kind and a view
offset per control, and **the evidence record needs the pan state at press
time**. Without the latter, the press coordinates in every historical bundle
are uninterpretable after the fact -- not wrong, unreadable.

**Both changed, 2026-09-20.** `packages/adapters/src/control-anchor.js` gives a
`controlMap` entry an `anchor` (`screen` pinned, `world` scrolls 1:1) and, for a
world control, the `measuredAtPan` its coordinate was read at -- which is how
the measurement was actually taken, so the profile keeps the reading and a check
does the arithmetic. `resolveControlPoint` returns the screen point for a stated
view, or refuses naming the cause: an **unstated** anchor is not a synonym for
either kind, so it resolves at rest (where every existing route presses) and
refuses anywhere else rather than returning a coordinate nobody measured. An
unknown pan refuses everything that is not pinned. A control that resolves off
the screen is reported as unreachable-from-this-view, which is the FNaF 3 camera
monitor's "does not exist at pan 0" arriving as geometry instead of prose. Both
actuators now resolve through it and **every accepted press records the view
offset it resolved at**; one that cannot be resolved is `REJECTED` with the
reason before anything reaches the transport.

`tools/device/models/controls-fnaf1-moto-g56-v207.json` is the first map to use
it, and `test-control-anchor.mjs` (in `npm run test:unit`) derives the door
separation from those coordinates rather than trusting this document's 2779 --
it computes 2780, because the measured table reads x 2286 where the derivation
above reads 2285. Nothing depends on which: both exceed the 2400 px screen, and
the file carries the 1 px as `UNKNOWN`. FNaF 1 also had no registered control
vocabulary until now; it has five roles and **no camera range**, because its
view ids are alphanumeric and unmapped. That is recorded as
`UNKNOWN(unmapped-view-ids)`, deliberately not FNaF 4's `null`, which means the
opposite thing -- and `MAX_GAME_CAMERA_INDEX` had to stop testing that field for
truthiness, since a string would have indexed to `NaN` for every game.

**What is still open, and it is the interesting half.** Nothing reads the live
pan: `view-scroll-v1`'s own `panObservation` is `UNKNOWN(not-implemented)` (the
Cue Helper's `pan_anchor_state` read `bulb-not-found` throughout 2026-09-19), so
the offset is a value a caller states, not one the phone reports. And the four
FNaF 2 controls the profile marks pan-dependent still carry unanchored
coordinates. They are deliberately unmigrated: a profile's bytes are hashed into
the bundles and qualifications bound to it, so rewriting one would orphan those
bindings exactly as the `ANCHOR_AIMS` drift did. `test-control-anchor.mjs` pins
that set of four, so migrating it is a deliberate edit rather than a silent one.

### Blocker 2 — the schedule cannot express a hold

The plan format carries toggles, because FNaF 2's controls are toggles. They
are not elsewhere:

- **FNaF 4's doors and flashlight are dead-man holds** with no latched state.
  There is no "door closed" to schedule, only a contact duration. Source agrees:
  group 342 pushes an attacker back on a **3000 ms** hold.
- **FNaF 3's vent seal needs a *sustained state*, not a press.** Arming it
  starts a `50 + Random(50)` frame charge, and groups 584/585 cancel it if the
  vent map closes or the monitor drops. A plan must express "hold this view
  until committed", which no current primitive does.
- **Panning is itself a timed hold**, now measured for FNaF 1 at a **270 ms**
  floor (5/5, with 260 ms at 4/5 beneath it) against the 2500 ms that was being
  used. Every pan is a scheduled contact with its own duration.

### Blocker 3 — the contract vocabulary was FNaF 2's (CLOSED 2026-09-20)

`validateControl` accepted seven control names and `cam:0-12`, both FNaF 2
facts, and refused `cam:13` with a message about coordinates and transport that
named the wrong cause entirely. Now data-driven via a per-game registry in
`packages/source/src/clockwork/vocabulary.js`, with FNaF 3 and FNaF 4 registered.
FNaF 4 proved the generalisation was still too narrow: it has **no cameras at
all**, so `cameraRange` is not universal and is now explicitly `null`.

### Order of attack, and why

1. **FNaF 1 as the port vehicle.** Not the interesting target -- the cheapest
   complete loop. Four controls plus a camera tab, two pan positions that
   matter, a measured pan floor, and a fully deterministic power model in the
   dump. It is the smallest thing that *forces* blocker 1 to be closed, and
   FNaF 3 and 4 then inherit the fix.
2. **FNaF 3 as the real target.** Most groundwork done: control surface reached,
   title model validated against both negatives. No public precedent.
3. **FNaF 4 last.** Best-understood mechanics, but it needs blocker 2 closed
   first, and its HUD layout depends on globals that nothing in the dump sets.

The first milestone for each is unchanged and is **not** a win: one graded
death, under a resolved hashed profile, with the controls actually actuated.
Nothing between here and there requires new mechanics knowledge.

## First milestones and what would refute them

| Step | First physical milestone | Refuted by |
|---|---|---|
| Confirm `K` | jadx reads `COI.loadHeader` for FNaF 3/4 and prints 29 | any other constant; every name-derived rule is then void |
| FNaF 1 port | a title observation and one **graded death** on the handset | the title observer cannot resolve a state the flow depends on |
| FNaF 1 model | 3000-seed census agrees with 10 phone runs on death cause | the Foxy/`viewing` discrepancy above turns out to be a model error |
| FNaF 3 port | one graded death, with vent/audio/camera controls actuated | the control map cannot be derived and needs full pixel calibration |
| FNaF 4 mechanics | `follow` state map and the wait-to-kill timers read out of the dump | the timers are not in the event sheet and need a device measurement |
| FNaF 4 port | one graded death under an **open-loop** schedule, no audio sensing | the forced-door trick does not reproduce on the mobile build |

## Success

A first graded 6 AM on a second game, `DEVICE_MEASURED` under a resolved hashed
profile, with a change log showing which layers moved and which did not — and,
if the target is FNaF 3 or 4, a result with no public precedent.

## Dependencies

Blocked on the custody gate above. Independent of Plan 25 horizons 1–4; horizon
3 (the self-running lab) would make steps 2 and 3 much cheaper but is not a
prerequisite, because the measurements in this plan removed the reason horizon 5
was sequenced last.
