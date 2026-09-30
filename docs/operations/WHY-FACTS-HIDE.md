# Why facts hide, and where to look next

*Written 2026-09-19, after a session that found six things which had been
sitting in plain sight since August.*

CLAUDE.md's mistake register records **wrong conclusions we reached**. This
records the other failure: **right answers we never looked for.** Those are
harder to notice, because nothing breaks — the work simply proceeds on a
thinner base than it needed to.

Every pattern below is named from something actually found on 2026-09-19, and
each ends with what it predicts is still hidden.

## The measured instance: we have read one chunk

A Clickteam CCN frame is a stream of typed chunks. Counting them across FNaF 2's
33 frames, against what this project has ever opened:

| chunk | per-frame | bytes | status |
|---|---|---|---|
| 13117 Frame Events | 29 | **607,928** | the dump — everything we know |
| 13112 Item Instances | 28 | 18,584 | first opened 2026-09-19 |
| 13121 Layers + scroll coefficients | 29 | 3,002 | first opened 2026-09-19 |
| 13108 Frame Header (w/h) | 33 | 528 | first opened 2026-09-19 |
| 13109 Frame Name | 33 | 822 | read (frame titles) |
| 13111 Frame Palette | 29 | 29,812 | never opened |
| 13122 Frame Virtual Rect | 33 | 528 | never opened until 2026-09-19 |
| 13125 Layer Effects | 29 | 1,580 | **never opened** |
| 13127 Mvt Timer Base | 29 | 116 | never opened until 2026-09-19 |
| 13129 Frame Effects | 29 | 464 | **never opened** |
| 13130 Frame iPhone Options | 29 | 116 | never opened until 2026-09-19 |
| 13132 (CTFAK has no reader) | 33 | 132 | **never opened** |

For thirteen months of project time the entire model rested on **one** chunk.
The two opened last are four bytes each:

- **`Mvt Timer Base` = 60**, in both FNaF 2 and FNaF 3. A direct source
  statement of the 60 Hz movement basis, under a project whose hardest open
  problem is the frame clock.
- **`Frame iPhone Options` = 0x04000000**, identical in both. Mobile-specific
  frame flags, in a project that runs only on mobile.

`Frame Virtual Rect` turned out to **confirm** the same width and height the
frame header gives, so the 2026-09-19 scrolling result is corroborated by two
independent chunks rather than resting on one reading.

## The patterns

### 1. The abstraction forecloses the question

`device-profile-v1` carries a flat `controlMap` of **screen** coordinates. A
schema that cannot express "this control moves" makes "does this control move?"
an unaskable question. Nobody suppressed it; there was no slot for the answer.

The night frames are wider than their windows in all four games (FNaF 2 by
576 px, FNaF 3 by 976 px), the layers carry scroll coefficients, and the light
hitboxes ride a layer at coefficient 1.00. All of that was readable from day
one. It stayed invisible because the coordinate system we worked in had already
thrown the information away.

**Predicts:** every other flat field in a schema is hiding a dimension. Does any
evidence record store the **pan state at press time**? If not, the press
coordinates in every historical run bundle are uninterpretable after the fact —
not wrong, just unreadable. Check what else the profile and the evidence schema
flatten: does a timing schedule express that a press depends on view state?

### 2. Success suppresses search

FNaF 2's control map was built by probing pixels on the handset, and it worked.
Because it worked, the dump route to control geometry was never tried — and the
dump turns out to name the mobile tap targets outright (`lightLeftHitbox`,
`cameraHitbox`, `musicButtonHitbox`, and in FNaF 3 a whole `olivier_*Hitbox`
family added by the mobile porter).

Working code is the strongest argument against looking for better ground truth,
and it is not a good argument.

**Predicts:** the grade pipeline works, so nobody has asked whether the frame
clock could come from source instead of measurement — and `Mvt Timer Base` was
sitting there. The BT audio chain works around the FAST-mixer problem, so nobody
has asked whether cue detection could key on sample handles from the dump rather
than on acoustics.

### 3. Facts get recorded, methods do not

Three things were already written down and still failed to generalise:

- `rng.js` recorded that no frame carries the seed chunk. Written as a fact
  about FNaF 2. Nobody asked whether it was a property of the **game** or of the
  **runtime** until a second game existed — it is the runtime, and the entire
  seed apparatus transfers to all four.
- `plant-model.js`'s `passEvery` recorded that a Clickteam `Every N` condition
  loads on its first reach and returns false. Written as a FNaF 2 timing note.
  It is actually **a general method for identifying any game's first RNG draw**,
  and it settled that question for FNaF 3 in one reading.
- The object-handle XOR was recorded as "28 on this build". It is really "every
  build has one, here is how to find it" — which, once framed that way, took one
  estimator to recover for two more games.

The repository has a mistake register but no **method register**. A fact says
what is true here; a method says what to do next time.

**Predicts:** grep the codebase for `[SOURCED]` constants and ask of each one,
*is this the game or the runtime?* Every one that is the runtime is four facts,
not one. `FPS = 60` is the obvious first candidate now that `Mvt Timer Base`
says 60 from source.

### 4. We search for what sets a flag, never for what clears it

FNaF 3's `aggresive?` term is described by every public account as a latch. It
is reset to 0 on a 15-second timer, which changes it from a ratchet into a
rhythm a route can wait out. The reset was one group away from the six setters.

Finding what writes X is the natural query. Finding what *clears* X requires
deciding to ask. This is the same shape as mistake register #12, where an absent
observation was read as evidence without checking the detector could see the
positive.

**Predicts:** enumerate the reset path of every counter the model reads — the
fuses, stuns, cooldowns and grace windows. Each one where we modelled the set
and inferred the clear is a candidate defect.

### 5. A tidy wrong answer does not feel wrong

Twice in one session a parse error produced **suspiciously uniform** output:
every instance OI reading `0`, then every layer coefficient reading `0.000`
across 15 layers in two games. Both looked clean. Both were field-offset errors.
The layer values were 16.16 fixed point, and `65536` only became legible after
dumping raw record bytes and finding a UTF-16 `"Layer 1"` where a float should
have been.

A wrong parse tends to produce *more* regular output than a right one, because
it is reading structure that is not there. Uniformity should raise suspicion,
not lower it.

**Predicts:** audit any calibration whose measured values are implausibly round
or identical across cases that should differ. The same smell caught both errors
tonight, and it is cheaper than re-deriving the parse.

### 6. Community framing is inherited as ontology

Every public FNaF 3 guide treats "seal the vent" as one uniform action. The
source says the five vents have **different exits**: two go straight to the
kill, two enter the attack chain two steps from the end, one enters it with the
full chain left. A sealing priority falls straight out, and no public account
states it.

We enumerate the categories the community handed us. Where their vocabulary is
coarse, our model inherits the coarseness.

**Predicts:** every place the community names one action and the source
implements several. Is "flip the camera" one action? Is "mask on" one? The
FNaF 2 mask-ON defect was exactly this — one name covering two windows, only
one of which was gated.

### 7. One instance cannot distinguish general from specific

With a single game there is no way to tell a game-fact from a runtime-fact, so
everything gets filed as game-fact by default. The second game is not only a
target; it is **the instrument that separates the two**.

This is Plan 25 horizon 5's stated measurement, and it turned out to pay
immediately and in the unexpected direction: the FNaF 3 work fed straight back
into FNaF 2, where the pan finding explained a live Night 3 failure.

**Predicts:** the expansion will keep paying backwards. Every FNaF 2 constant is
now testable against three other builds, and disagreement is as informative as
agreement.

### 8. The query encodes a guess about naming

Searching FNaF 2's office for its night clock with the patterns `time of night`,
`hour`, `night time` and `clock` returned **nothing**, which nearly became the
finding "FNaF 2 has no wall-clock hour timer, unlike FNaF 3 and 4". The object
is called **`time of the night`**. One word — "the" — stood between a correct
result and a confident wrong one.

A grep is not a neutral instrument. It encodes a hypothesis about what the thing
is called, and a miss looks exactly like an absence. This is mistake register
#12 wearing different clothes: an absent observation is only evidence once the
detector has read the positive.

**Predicts:** any conclusion of the form "X does not appear in this game" is
suspect unless the same query found X somewhere it was known to exist. Before
believing an absence, run the query against a game or frame where the answer is
already known.

## Worked example: applying habit 2 to `config.js`

Run on 2026-09-19, immediately after writing this page, as the first test of
whether these habits pay.

`packages/source/src/games/fnaf2/config.ts` exports 110 constants, 39 carrying a
`[SOURCED]` label. Asking of each "is this the game, or the runtime?" and then
**testing the answer against the other three dumps**:

**Runtime — one fact, not four:**

- **The 60 Hz basis.** `Mvt Timer Base` reads **60 in all 94 frames of all four
  games**. `FPS = 60` is a property of the Clickteam build, not of FNaF 2.
- The RNG's LCG and its wall-clock seeding (established earlier the same day).
- `Every N` loading on its first reach and returning false, which is what makes
  a `StartOfFrame` draw genuinely first.
- `Frame iPhone Options` = `0x04000000`, identical in all 94 frames.
  `UNKNOWN(meaning)` — uniform, but nobody has decoded what the flag selects.

**Game — confirmed different, not assumed different:**

| | hour mechanism | hour length |
|---|---|---|
| FNaF 2 | accumulator `AM` reaches 70 | 70 s |
| FNaF 3 | wall-clock timer, **gated on night number** | **40 s on Night 1, 60 s on Nights 2+** |
| FNaF 4 | wall-clock timer | 60 s |

So `NIGHT_FRAMES` and `HOUR_FRAMES` are game facts — and in FNaF 3 not even a
single game fact, since the hour is shorter on Night 1 than on every later
night. More interesting than the numbers is the **mechanism difference**:
FNaF 2 counts an accumulator to a threshold while FNaF 3 and 4 advance on
wall-clock timers. In a project whose hardest open problem is the frame clock,
that is not a detail — a wall-clock night is a different prediction problem from
an accumulated one.

**Every game also ships a "fast nights" mode that halves the hour**, and finding
it is pattern 8 all over again. A sweep for `btnCheat[0-9]+_` returned hits in
FNaF 4 only, which nearly became "only FNaF 4 has cheats". Searching for the
*concept* instead of the *naming convention* found it in all four, under four
different names: `fastNights` / `fastNightsSwitch` in FNaF 1 and 2,
`fast nights on?` in FNaF 3, `FastNights` in FNaF 4. One sweep, one convention,
three false negatives.

The scope then matters and had to be checked rather than assumed: FNaF 2's
`fastNights` appears **zero** times in the Office frame — it lives only in
Initialize and the Unlocks screen — so the FNaF 2 night clock is not exposed to
it. FNaF 3 and FNaF 4 gate their office-frame hour advance on it directly.

FNaF 4 carries a second clock confound with no counterpart elsewhere: winning
the Plushtrap minigame sets the starting **hour to 2 instead of 12**, gated on
`Night < 6`. A route timed from the start of the night is simply wrong by two
in-game hours when that reward is set, and nothing on the night screen says so.

**The habit paid on its first run** — and it produced three corrections to its
own first draft within the hour, which is the more useful half. Each correction
came from checking a claim rather than from new information being available.

## The cheap habits that would have caught most of this

1. **Inventory before you parse.** List every chunk, field or section in a
   format and mark which have been opened. The table above took one command and
   found two unread chunks bearing on the project's hardest problem.
2. **When a value is recorded, ask what class it belongs to** — this build, this
   game, this runtime, or this engine. Write the class down next to it.
3. **When output is uniform, suspect the parse before believing the result.**
4. **For every counter modelled, find its clear, not just its set.**
5. **When something works, write down the route you did not take.** That note is
   what makes the alternative findable later.

## What this is not

It is not an argument that the earlier work was careless. Every item here was
invisible for a structural reason, and most were invisible *because* something
else was working. The point is that "it works" and "we have looked" are
different statements, and only one of them is ever tested.
