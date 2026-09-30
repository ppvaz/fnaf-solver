# Ablation runs: which observations and controls are actually load-bearing

*Research note: 2026-09-19. Public challenge runs, checked against our own
source dumps. Nothing here was run on this project's handset.*

Companion to [`FNAF4-AUDIO-INDEPENDENCE.md`](FNAF4-AUDIO-INDEPENDENCE.md),
which covers the same author's FNaF 4 no-audio clear.

## Why this matters here

Every expansion target in [Plan 26](../../plans/26-second-target-fnaf-1-3-4.md)
carries a device-layer cost proportional to **how many observation channels the
route needs**. A route that must read a door light, a camera feed and an audio
cue needs three calibrated detectors; a route that needs one needs one.

These runs are natural ablation experiments: a competent player removes one
designed channel and reports whether the game is still winnable. Each success
is evidence that a channel is *not* load-bearing, and therefore that our
control map and belief gate for that game can be smaller than its UI suggests.

## The runs

All by Chickeninja42, the same author as the FNaF 4 no-audio clear.

| Run | Removed | Video | Date | Length |
|---|---|---|---|---|
| FNaF 1, no lights | the door-light observation | [link](https://www.youtube.com/watch?v=ewEFDl1jpfI) | 2023-03-05 | 27 min |
| FNaF 3, no maintenance | *all* error recovery (audio, camera, ventilation) | [link](https://www.youtube.com/watch?v=iQjzXft6L0k) | 2023-04-09 | 28 min |
| FNaF 3, no cameras | the camera system | [link](https://www.youtube.com/watch?v=W6qGaxY_p9s) | 2024-11-10 | 63 min |

**All three succeed.** Together with the FNaF 4 result, every FNaF night game
this project might target has been cleared with one of its designed channels
removed.

## FNaF 1 — the door light is not required

`[C]` The lights are the only way to see an animatronic at your door: the two
office-adjacent cameras have a blind spot. The no-lights run substitutes
**continuous camera tracking** — knowing where everyone is at all times — and
pays for it in power.

### Verified against our dump

`SOURCE` The power model checks out arithmetically, which is a strong
independent confirmation of the reading in Plan 26. `power left` starts at 999
and drains `usage meter` per second, where `usage = 1 + Σ(control room follow
0..4)` (groups 313–315). A FNaF 1 night is 8:55 = 535 s over 6 hours, i.e.
~89 s per in-game hour. So:

| Controls active | `usage` | Units/hour | % of 999 | Author's figure |
|---|---|---|---|---|
| camera only | 2 | 178 | 17.8% | 18/hour |
| camera + 1 door | 3 | 267 | 26.7% | 27/hour |
| camera + 2 doors | 4 | 356 | 35.6% | 36/hour |

The community's per-hour percentages fall directly out of the dumped constants.

`SOURCE` The power-outage sequence is confirmed. **Group 406** — `Every 5000 ms`
+ `Random(5)+1 = 1` (a 20% roll) while `power down = 1` — matches the described
"every five seconds, 20% chance" first stage exactly.

`SOURCE` A door-camper really does drain power indefinitely: the door position
is an ordinary position in the movement pipeline, so repeated failed rolls
simply leave the animatronic there. The author reports a 3-minute camp
(~36 consecutive failed rolls), which is consistent with the 4970/4980 ms roll
cadence already extracted.

### Claimed, then traced — all four now located (2026-09-20)

Every item in this section was `[C]` or `UNKNOWN(not-located)` when this note
was written. `packages/source/decompile/nightmap.py` found them all in one pass over the same
sheet, and three of the four needed a correction.

- `SOURCE` **The Foxy cooldown is located.** **Group 460** sets `charChica`
  AV12 to `50 + Random(1000)` **every 100 ms while any camera is up**
  (`viewing > 0`); **group 445** drains it 1 per frame under a `Max(0, …)`
  floor; and **group 321** requires it at 0 before Foxy may advance. So the
  range is 50–1049 frames = **0.83–17.48 s**, against the video's 0.83–16.67 s
  and this note's guessed `Random(950)+50`. The bound is **1000, not 950**.

  Two things follow that the video does not state. The refresh is a **set, not
  a maximum**, so each 100 ms tick *replaces* the hold with a fresh draw —
  dwelling on a camera does not accumulate protection, it re-rolls it. And
  because the refresh is keyed on `viewing > 0` rather than on Pirate Cove,
  **any** camera buys the hold. Watching Pirate Cove specifically is a
  *separate* gate: group 321 also requires `viewing <> 99`.

- `SOURCE` **The attack timings are at different stages than described, and
  the power costs are the same numbers in different units.** At **stage 3**,
  `charChica` AV6 accumulates per frame and **group 451** sends him to stage 5
  at `> 1500` frames = **25 s** — so the 25 s is a stage-3 timeout, not a
  stage-4 one. The West Hall check is also at stage 3: **group 60** advances
  `fox progress` 3 → 4 when `viewing = 3`, and **group 448** then runs him
  from stage 4 after only `> 100` frames = **1.67 s**.

  A blocked run costs `10 + (bangs × 50)` raw units — **10, 60, 110**
  [group 455] — against the video's 1, 6, 11. These agree: group 313 renders
  `power left 2 = power left / 10`, so the video is quoting the **displayed**
  meter and the dump the raw counter. He also resets to `Random(2)`, i.e.
  stage **0 or 1**, not to a fixed stage.

- `SOURCE` **Bonnie's Supply Closet jump and both blocked returns are
  confirmed, and the returns are deterministic.** Bonnie's 14 edges give
  `cam3 → ready to attack left` on branch 1 [group 341], so the Supply Closet
  really does reach the door without the corner. A blocked Bonnie returns to
  `cam1B`, the Dining Area, on **every** branch [group 344]; a blocked Chica
  returns to `cam4A`, the East Hall, likewise [group 376]. The video's "may
  return to the hallway instead" is a certainty, not a tendency.

### The power table above is a Night 1 table

`SOURCE` **Groups 477–480 subtract a further unit on a per-night timer**, on
top of the `usage meter` drain: one unit every **6000 ms** on Night 2, **5000**
on Night 3, **4000** on Night 4 and **3000** on Night 5 and after. Night 1 has
no such group and therefore no extra drain.

So the arithmetic above — 18/27/36 units per hour — is exactly right for
Night 1 and low for every later night, by roughly 15, 18, 22 and 30 units an
hour respectively. Over a 535 s night that is up to **178 units of the 999**,
which is why a policy tuned on Night 1 blacks out on Night 5.

This was not found by looking for it. A hand search for `power left` reads
group 314 (`= 999`) and group 315 (`− usage`), finds a complete-looking model
and stops; the per-night groups are three hundred groups away and mention
power only in their action. The table reader found them because it enumerates
every group gated on the night counter rather than every group that mentions
power — which is [WHY-FACTS-HIDE](../operations/WHY-FACTS-HIDE.md) pattern 8,
the query encoding a guess about naming, caught by not writing the query.

## FNaF 3 — both the cameras and the whole repair panel are droppable

`[C]` The no-maintenance run never opens the maintenance panel, so any audio,
camera or ventilation error persists for the rest of the night. The no-cameras
run drops the camera system entirely. Both clear the game.

### The aggression term, explained and then corrected

Plan 26 extracted Springtrap's rule from the dump but could not interpret one
term:

```
move counter > ((10 - AI - aggresive?) + Random(15) - total turns)
```

`[C]` The author explains `aggresive?` as an "aggressive factor" that flips
from 0 to 1 on a phantom jumpscare, a ventilation error, sitting inactive in
the office for 10 s, or the clock passing 4 AM.

`SOURCE` Our dump confirms all four **and adds two more**:

| Group | Condition | Sets `aggresive?` |
|---|---|---|
| 391 | `ventilation text AV0 <= -10` (ventilation error) | 1 |
| 662 | phantom jumpscare **and** `Random(5) < AI` | 1 |
| 753 | `frozen = 1` | 1 |
| 754 | `scroll AV15 > 0` | 1 |
| 904 | `time of night >= 4` (4 AM) | 1 |
| 909 | `ventilation text AV6 > 10` (office inactivity) | 1 |
| **220** | **`Every 15000 ms`** | **0** |

Two corrections follow, and both matter for a route:

1. **The aggression flag decays.** Group 220 resets it to 0 on a 15 s timer.
   The public description treats it as a latch. It is not one — it is a flag
   that must be *continuously* re-triggered to stay set.
2. **The phantom path is AI-gated.** A phantom jumpscare only raises aggression
   when `Random(5) < AI`, so on low-AI nights phantoms often cost nothing.

`SOURCE` Also note `Random(15)` in Clickteam yields **0–14**, not the 1–15 the
video assumes. The dump is authoritative.

### One error model, three systems

`SOURCE` Audio, camera and ventilation are not three mechanics but one, three
times over: each has a `* text` object whose AV0 decays, and each raises its
error at the **same `<= -10` threshold** (groups ~2592–2619). Ventilation
additionally drives `ventilation error 2` and the aggression flag.

That is convenient for us: a single scalar-threshold detector generalises
across all three systems rather than needing three bespoke rules.

`[C]` Phantom effects map to specific errors — Mangle causes the *audio* error
while Balloon Boy, Chica, Foxy and Freddy cause *ventilation* errors. Not yet
traced.

`[C]` A FNaF 3 night is 348 s.

`SOURCE` **The vent and camera namespace is one numbering, traced 2026-09-19.**
Locations 1–10 are the cameras and 11–15 are `vent 11`–`vent 15`. `you in` holds
1–15 and is set by the camera-selection handlers, so it is **the camera the
player is viewing**, not Springtrap's position — an earlier draft of this note
had that backwards. Springtrap's own location is the `dhfgh` object's position.
Sealing writes the chosen vent through `going to seal` (which holds 11–15 and
has **no decrement anywhere** — a selector register, not a timer) into
`what vent is closed`.

`SOURCE` **`mon in` is Springtrap's location**, mirrored into a counter by one
group per camera ("if he overlaps cam N, set it to N"). So `you in = mon in` is
the test for *the player is watching the camera he is in*, and `you in <> mon in`
its negation. An earlier draft of this note had the right test with the wrong
entity on one side; both are now measured.

`SOURCE` **The vent topology, traced from Springtrap's 73 movement edges.**
Each vent is entered from exactly one camera, on branch `action selected = 4`,
and exits either back to that camera or onward:

| Vent | Entered from | Returns to | Or advances to |
|---|---|---|---|
| 11 | cam 09 | cam 09 | attack stage 3 |
| 12 | cam 07 | cam 07 | attack stage 3 |
| 13 | cam 05 | cam 05 | attack stage 1 |
| 14 | cam 10 | cam 10 | **GOT YOU 2** |
| 15 | cam 02 | cam 02 | **GOT YOU 2** |

The attack chain runs stage 1 → 2 → 3 → 4 → GOT YOU, so **the vents are not
equally dangerous**: 14 and 15 bypass the chain entirely and kill outright,
11 and 12 enter two steps from the end, and 13 enters with the full chain left.
A sealing priority follows directly — 14 and 15 first, then 11 and 12, then 13.
No public account of this game states that asymmetry.

`SOURCE` **The 19 edges left unattributed above are now traced, and they are
four mechanisms rather than one** — an earlier draft guessed "most likely the
audio-lure teleports", which was too hasty:

- **Night-start spawn.** At frame start Springtrap draws `Random(5)+1`, which
  places him at cam 10, 09, 08, 07 or 06 respectively, then marks himself
  placed. Uniform over five starting cameras, and it is the **first RNG draw of
  the night**. Because the RNG model transfers (see Plan 26), his starting
  camera is therefore predictable per seed.

  `SOURCE` *"First" was asserted before it was checked, so it was checked.*
  Three draws do sit in earlier groups, feeding a cosmetic static effect on
  500 / 360 / 1000 ms timers. But `passEvery` in `plant-model.js` records, from
  the runtime decompile of `CND_EVERY2.eva2`, that an `Every N` condition loads
  its delay on its **first reach and returns false** — it does not fire, so its
  actions never run and the draw inside them is never taken. The `StartOfFrame`
  spawn fires on that same loop and is genuinely draw #1. All four games share
  runtime 770.0 / build 296, so this rule — and this way of identifying any
  game's first draw — applies to all of them.
- **Audio lure.** A lure object is placed at a camera; when Springtrap is in an
  adjacent room it is consumed, the target camera is stored on him, and a
  per-lure delay is drawn as `Random(100)`. On relocation his **`move counter`
  is reset to 0**. So a lure does not merely reposition him — it buys a full
  movement-timer reset. No public account of this game states that; they
  describe lures purely as repositioning.
- **Scripted forced move**, keyed on a `force move` / `force to` pair, to three
  fixed cameras.
- **Attack escalation** to attack stage 2 while a screen is being viewed.

## What this changes for Plan 26

1. **The per-game sensing requirement is smaller than each game's UI implies.**
   FNaF 1 without door lights, FNaF 3 without cameras *or* repairs, FNaF 4
   without audio. No target needs its full designed observation set.
2. **FNaF 1's cost moves from sensing to power.** Dropping the light
   observation is free for us — we would rather read cameras anyway — but it
   raises `usage` to 2 continuously. A FNaF 1 route is a power-budget problem,
   which is a *scheduling* problem, and scheduling is this project's strength.
3. **FNaF 3 gets cheaper again.** If the maintenance panel is droppable, the
   control surface shrinks to audio lure, vent seal and camera flip — and the
   aggression decay at 15 s gives a route an exploitable rhythm rather than a
   one-way ratchet.
4. **Ablation is a cheap experiment design we should borrow.** Removing one
   channel and re-running is exactly how to find the minimal observation set
   for a machine route, and it costs nothing but device time.

## Provenance

Transcripts were retrieved with `yt-dlp` auto-captions and read for claims
only; nothing from them is reproduced here. Every `SOURCE` line was read out of
our own event dumps (`~/fnaf-apks/fnaf1/events/`, `~/fnaf-apks/fnaf3/events/`,
dumped 2026-09-19 at the handle constants recorded in Plan 26). Where the two
disagree — the aggression latch, the `Random(15)` range — the dump wins.
