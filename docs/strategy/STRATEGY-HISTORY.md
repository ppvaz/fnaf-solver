# FNaF 2 — 10/20 Mode: A History of the Strategies
### Consolidated from `MINUS-7-STRATEGY.md`, `MINUS-3-STRATEGY.md` and `VENT-CAMP-STRATEGY.md`, plus the 2026 Markiplier material. Researched 2026-08-19.

One night, 7 minutes, ten animatronics at maximum AI. Every strategy below is an
answer to the same question: how much of 10/20 mode's chaos can be converted into
schedule? The history runs from pure reaction play to two independent proofs that
the answer is *all of it*.

## The eras

**Reaction era (2014–~2020).** Camera-heavy play (DJ Sterf's "T Path" and kin):
watch, react, hope. Wins existed but were luck-shaped. This era also produced the
period's most famous win — Markiplier's December 2014 10/20 completion — which
turned out to matter to this history twice (see the saga below).

**Right Vent Camp (~2020–2023).** The "Tactical Crew" (Random FNaF Player, Ambience,
Tru3P1ay3r, Chezzball34, ZombieGabriel, Toy Bonnie 360 — credited by DJ Sterf)
found the load-bearing mask fact: 5 consecutive masked seconds clears everyone, so
the left side never needs checking. DJ Sterf systematised it (2021, in-phase /
out-of-phase); Shooter25 made it clock-driven (2021) by timing blackouts across
Foxy's kill checks. RVC turned 10/20 from a reflex test into a routine with a few
RNG leaks — Toy Bonnie chief among them.

**Stall era (2023–2025).** Two simultaneous discoveries converted "handle the
animatronics" into "never let them move at all":

- *Cam-stall* (Minus 3, insstaa + Yunivers, July 2023): the double camera glitch
  keeps Parts/Service selected all night, so the three stallable Withereds never
  leave. Easy, but glitch-based and not RNG-proof.
- *Flash-loop* (**Minus 7**, Niko Frost, December 2023): the three-camera flash
  sweep holds all seven stallable animatronics forever — the **first zero-RNG
  strategy**, glitchless, and the hardest to execute. The strategy this repo's
  trainer teaches.

**Synthesis era (2024–2026).** The threads merged and specialised:

- *brayden's timer strategy* (June 2024, with Shooter25): RVC + Foxy blackout
  manipulation + Golden Freddy interval avoidance + the right-vent-light Toy Bonnie
  stall. Not zero-RNG (~99%, bot-measured) but the best consistency-per-unit-skill —
  the pragmatist's strategy.
- *Minus Toys* (Zach_Scream, May 2025): the glitch aimed at CAM 09 instead, freezing
  the three Toys; the **second zero-RNG strategy**, far easier than Minus 7.
  *Minus Two* (a day later): the same plan glitchless via CAM 03 — zero-RNG,
  legitimate, but slack-starved.
- *Markiplier's rediscovery* (July 2026): see the saga.

## The Markiplier saga

- **2014-12-14** — Markiplier's original *10/20 Mode COMPLETE!!*, the era-defining
  win.
- **2025-11-14** — TheBones5 publishes a 41-minute technical analysis alleging the
  run was cheated; community debate follows.
- **2026-07-15** — Markiplier confesses on stream (*Markiplier's Redemption*, 4h23):
  the 2014 run was not legitimate.
- **2026-07-31** — *Five Nights at Freddy's 2: 10/20 COMPLETE (no cheats)*: he beats
  it for real, having deliberately avoided existing strategies and derived his own
  from mechanics — then discovers on finishing that he had **independently
  reinvented Minus 7** ("I realised this is a strategy called minus seven, or a
  modified version of it" — community verdict the same: "he really reinvented the
  minus 7 strat", TheBon).

His variant differs from Niko Frost's in three ways worth recording:

1. **No external timer.** Every prior clock-anchored strategy requires one; Mark
   counts 5-second cycles using the music box itself as the metronome (each wind
   tick is 0.5 s — "five, wind four, three winds…").
2. **Foxy is retired, not managed.** Instead of per-cycle hall flashes, he fills
   Foxy's exposure meter (700 units on night 7) in three flash rounds
   (≈5 s + 3.5 s + 3.5 s ≈ 11 s of light), deliberately *aligning Foxy's retreat
   with Balloon Boy's arrival* so both are dealt with in one window.
3. **Freeze-in-place at night start** — flashing CAM 7 / CAM 4 / CAM 10 from the
   opening (he notes CAM 4 beats CAM 2 because no phone ring masks Foxy's audio
   cues).

He is candid that his run had luck in it (it is not played as zero-RNG) and that the
method has optimisation headroom. Two details matter to this repo: he verified
Foxy's internals against **Shooter25's FNaF 2 practice mod** (the same bot lineage
in plan 05's prior-art note), and his on-camera measurements — the 6.66 s freeze,
the 700-unit meter, exposure accruing ~50–60 units per second with proportional
partial-second credit — are fresh independent confirmations of constants in
`src/config.js`, plus one refinement (sub-second exposure granularity) the engine
doesn't model.

## The scoreboard

| Strategy | Year | RNG-proof | Glitchless | Timer needed | Difficulty (community verdict) |
|---|---|---|---|---|---|
| Reaction / T Path | 2014– | no | yes | no | luck-shaped |
| Right Vent Camp | ~2020 | no | yes | no (yes once timed) | moderate |
| Minus 3 | 2023 | no | **no** | yes | easy |
| **Minus 7** | 2023 | **yes** | yes | yes | hardest |
| brayden's timer strat | 2024 | no (~99%) | yes | yes | moderate-easy |
| **Minus Toys** | 2025 | **yes** | **no** | yes | much easier than Minus 7 |
| Minus Two | 2025 | **yes** | yes | yes | moderate, slack-starved |
| Markiplier's Minus 7 | 2026 | no (as played) | yes | **no** | hard |

## A meta-thread: removing the human

The community keeps independently inventing the same validation idea this repo's
simulator embodies: Shooter25's practice mod / bot played brayden's strategy
perfectly for 105 nights to measure its true consistency (104–1), and Markiplier
used the same mod to read Foxy's internals. Nobody had used a simulator to
*search* for a strategy — that gap was plan 05, and it has now been walked
end-to-end once: the search derived the CAM 06/07 "Six-Seven Strat" from the
modeled route graph (2026-08-19), and the same day's decompile of the Android
build refuted it — the sourced route graph admits no two-camera cover, and the
only robust minimal cover is 4-7-10, Minus 7's own loop, independently
re-derived from source (`CAM-6-7-STRATEGY.md` carries the full post-mortem).
The lesson is the method: sim-derived candidates are hypotheses, and the
decompile is now the first validation gate they must clear.

A second search pass tested the obvious escape hatch after Six-Seven: stop asking
cameras to cover every route and exploit the decompiled monitor-entry gates instead.
Reactive monitor denial twice appeared to score 150/150 and was twice retracted.
The second false positive came from swapping two misleading exported UI states and
then reading groups 538-555 as live mask polling. The Android audit now anchors
`Multiple Touch` as the camera state and `monitorFrame` as the mask state; those
groups resolve a previously latched 45-frame defense decision only after the
300-frame office sequence. With that corrected, every tested observable gate-aware
family is 0/150 (`GATE-SEARCH.md`, `ANDROID-OFFICE-ENDGAME.md`). The methodological
lesson got sharper: source validation is iterative, and neither exciting nor
negative simulator results get promoted while a depended-on state machine is still
approximate.

The next Android pass closed most of that endgame uncertainty rather than
reopening the strategy. Mangle's supposed right-light parking behavior was a
misidentified monitor-raise animation: at marker 122 she must be cleared by five
continuous fully-masked scheduler ticks or the next completed monitor raise
advances her to marker 123. The source also exposes the marker-123 family attacks and the
four-attacker `chicalookatyou` entry mutex. Re-running the same search still leaves
every family at 0/150; the surviving source gaps are narrow ordering and
auxiliary-object questions, not a missing broad defensive branch.

Then the decompile itself got audited. A one-night crisis — the Android event
sheets appeared to prove the camera-light stall *disabled* (its source counter
read as zero), which would have made every mobile Minus 7 completion
inexplicable — ended with the discovery that the APK's runtime XORs every
object handle with a per-build constant (28 here) and both decompilers were
naming objects by the pre-XOR handle. Every object name in every prior dump
was a bijective mislabel: Toys and Withereds swapped, `stun time` (400,
never rewritten — the community's exact 6.66 s figure) masquerading as the
zero-valued `time allowed`. The corrected decode confirms Minus 7's whole
mechanical basis on Android — the 400-frame flash stall, the Withered
look-hold (which even persists monitor-down via the parked camera marker) —
and reopened a project-wide identity re-audit of route and endgame claims.
Methodological lesson, again sharper: a decompile is only as truthful as the
loader you validate it against; the runtime that ships in the APK is the
ground truth for how its own data is addressed.

## Minus 7 Left-Read: the first deliberate deviation (2026-08-24)

Everything above is about *which* strategy. This is the first entry about a
strategy the project changed on purpose, and it is recorded here because it was
briefly changed by accident instead — the device pilot drifted several steps
away from Minus 7's cycle with no note anywhere saying so.

**Minus 7 Left-Read** is a Night 6 derivative of Minus 7 for a bot on a stock
Android phone. It keeps Minus 7's entire premise: the 4-7-10 flash loop, the
five-tick mask, the box, and the hall pulse for W. Foxy. It differs in five
places, each forced by something the phone measurably cannot do:

| | canonical Minus 7 | Minus 7 Left-Read | forced by |
|---|---|---|---|
| Balloon Boy | heard and reacted to | a lit left-opening read every cycle | a bot has no ears; the vocal is 6-16 dB too quiet (plan 08) |
| camera sweep | early, 0.80-1.20 s | **late, 4.67-4.90 s** | its stun has to bridge the five-tick mask, and the phone's sweep is longer |
| camera light | held across the sweep | **pulsed per camera** | a held 790 ms sweep alone outspends night 6's 3000 flashlight frames |
| hall flash | 0.42 s, one beat | **1.38 s raise + 3.10 s second beat** | the read owns the first beat; the raise carries its reset |
| wind | one 3.5 s hold | **two holds, 0.95 s + 1.08 s** | the two beats split it |

**Night 6 gate repair, 2026-08-26.** The table originally omitted the first
beat's Foxy reset: its +1.28 s hall slot fell inside the mask-off animation at
the measured 550 ms read latency, so `hallLightOn` could never become true.
The post-read raise now carries the existing eight-frame (~133 ms) hall pulse in the same
180 ms `maskraise` HID macro already used by attack recovery. It does not move
the observation or either stun sweep. On the gate's fixed 1200 seeds it changes
Night 6 from **449/1200 (37.4%, refused)** to **673/1200 (56.1%, accepted)**;
exact replay remains 100/100 and the all-clear flashlight budget is
2808/3000 frames.

It is not a claimed clear. Its gate is `hidpilot n6 target` in
`tools/test.ts --engine` (3000/3000 ordinary, 3000/3000 pinned-worst, no
missed BB state), and its recipe, budgets and input-shape invariants are
gated by `packages/propose/test/test-recipe.ts`. `node packages/propose/bin/plans/recipe.mjs --track`
renders it in the trainer's `CYCLE_SCRIPT` shape so the differences above can
be read side by side rather than inferred from two unrelated files.

The methodological lesson is a new one for this page, and it is about the
*harness* rather than the strategy: a duration that is correct as simulator
frames can be wrong as an Android contact. Minus 7's hall flash is five frames,
83 ms; transcribed literally it is under the length Fusion's per-frame touch
poll reliably sees, and a graded device run that scheduled ten of them produced
**zero visible beams** while dying to the Foxy those flashes were meant to
reset. Three device nights were spent before the recording was graded. The
recipe now carries device contact lengths, and the gate refuses anything under
100 ms.

## Sources

Primary docs in this repo: `MINUS-7-STRATEGY.md`, `MINUS-3-STRATEGY.md`,
`VENT-CAMP-STRATEGY.md` (each with full per-claim citations). Additional to those:

1. Markiplier — *10/20 Mode COMPLETE!!*, 2014-12-14:
   <https://www.youtube.com/watch?v=A9qPj-YJcN8>
2. TheBones5 — *Did Markiplier CHEAT his FNAF 2 10/20 Win? | Full Technical
   Analysis*, 2025-11-14: <https://www.youtube.com/watch?v=SjK7M0LRbqw>
3. Markiplier — *Five Nights at Freddy's 2: Markiplier's Redemption* (stream),
   2026-07-15: <https://www.youtube.com/watch?v=AH5jwKkCS7M>
4. Markiplier — *Five Nights at Freddy's 2: 10/20 COMPLETE (no cheats)*,
   2026-07-31: <https://www.youtube.com/watch?v=M3H8u3Y0S-s> (transcript is the
   source for the variant details above)
5. TheBon — "He really reinvented the minus 7 strat for it lmao":
   <https://x.com/the_bonbon/status/2083344947386662925>
