# FNaF 4's control surface, learned from the game's own labels

*Measured 2026-09-20 on Moto g56 5G (2400x1080 landscape), FNaF 4 v2.0.4,
`com.scottgames.fnaf4`. Source references are `~/fnaf-apks/fnaf4/events/`
(frames `03-04-level`, `00-01-warning`, `14-15-test`).*

FNaF 3's control map had to be found by probing the screen, because its mobile
hitboxes (`olivier_*Hitbox`) carry no placed coordinates and the office view
pans. FNaF 4 needed none of that: **the game labels every control on screen,
by itself, on Night 1.** This page records the surface, the rule that governs
the labels, and the two configuration facts that decide whether any of it is
valid.

## The self-labelling screen

Two distinct object families exist, and conflating them is the trap:

| family | example | created | lifetime |
|---|---|---|---|
| **hitzone** — the touch target | `HUDDoorLeftHitzone` | groups 722/723, every night | permanent |
| **label** — the visible text | `HUDDoorLeft` | group 725, gated | destroyed mid-night |

Group 725 creates the labels when:

```
StartOfFrame AND GlobalValue[11] = 0 AND Night = 1 AND Blind-challenge unchecked
   OR  StartOfFrame AND GlobalValue[11] = 2 AND Blind-challenge unchecked
```

So the labels are drawn directly on top of permanent hitzones. **Night 1 is a
calibration screen the game renders for you.** Coordinates read there are valid
on every later night, because only the labels are night-gated.

### The labels are destroyed at 3 AM, mid-run

Group 738:

```
IF GlobalValue[11] = 0            (Show Tips = NIGHT 1)
IF hour >= 3   AND   hour <> 12
IF carpet run -> NumberOfObjects > 0      (a run is in progress)
IF Once
DO Destroy HUDTips, HUDDoorWarning, HUDDoorLeft, HUDDoorCloset,
           HUDDoorRight, HUDLookBack, HUDGoBack, HUDFlashlight
```

Observed exactly: labels present at 12, 1, 2 and 3 AM; absent from the moment
of the first run back at 3 AM onward. The conjunct that matters is
`carpet run > 0` — the hour alone does not fire it, which is why the labels
survived three captures at 3 AM and died on the fourth.

The destroy is gated on `GlobalValue[11] = 0`. Under `= 2` it is unreachable,
so the labels persist all night on every night. **UNKNOWN(not-measured):
whether the ALWAYS labels are positioned identically on nights 2+** — the
setting was cycled to ALWAYS, verified on the Options screen, and returned to
NIGHT 1 without a night being run under it, at the operator's instruction.

## Measured control surface

Screen coordinates, this handset, **Display Mode FULL and Controller Size 120%**
(see hazards below). Centres of the label text, which is what a press targets.

### Room view: a rotating facing, not three fixed zones

The first reading of groups 722/723 -- three door hitzones side by side --
suggests the room shows all three at once. It does not. The room view carries a
**facing**, and the visible door or closet is the only run target:

| gesture | effect |
|---|---|
| single tap, left or right region | **rotate the facing** |
| double-tap the door or closet in front | **run to it** |
| tap bottom centre | **look back to the bed** |

Measured by tapping: a double-tap at screen x 2000 while facing the left door
*turned* rather than ran, and a single tap at x 2200 turned again, reaching the
right door. Each facing renders its own run label over the door in front of it.
So the three door hitzones are one rotating target, and a route must track
facing as state -- the same lesson the FNaF 2 pan produced, in a different form.

A double-tap issued as two separate `adb shell` invocations is too slow; both
contacts must be in one shell (`adb shell "input swipe ...; input swipe ..."`).

### There is no pan in FNaF 4, and facings are pixel-exact

Tested 2026-09-20 by holding each screen edge for 2000 ms and capturing **during**
the contact, because a press-release at the edge rotates the facing and would
mask a slide.

- **Right edge**: the frame changed completely (`|mid-base| = 44.75`) and
  correlation failed to find any horizontal shift (error 2576 at the search
  limit). A complete change with no matching slide is a **rotation**, not a pan.
- **Left edge**: returned to the baseline facing at `|mid-base| = 0.00` -- byte
  identical.

That zero is the more useful result, and it was misread once as "the left hold
did nothing". It did rotate; it rotated *back*. **Returning to a facing
reproduces the frame exactly**, so facing state can be verified by frame
equality without any feature detection.

This matches the geometry. The frame is 1300 design px, and the measured side
controls invert to design x -123 and 1147, putting the visible window at roughly
[-341, 1365] ~ **1706 design px -- wider than the whole frame**. Nothing can be
off-screen, so there is nothing to pan.

**Consequence**: FNaF 4 needs no pan floor, unlike FNaF 1 (270 ms) and FNaF 3
(1025 ms). Its timed quantities are instead the **hold durations** for
`closeDoor` and `flashlight`, and the **double-tap gap** that separates a run
from a turn. Those are the FNaF 4 equivalents and are not yet measured.

### Bed view

Reached from the room view with the bottom-centre tap. Its HUD is
`{FLASH LIGHT, turn around}` -- **`CLOSE DOOR` is absent**, correctly, there
being no door. Coordinates are identical to the door view's.

`HUDLookBack` is parented to `HUDGoBack` at offset (0, 0) by group 729, so the
**same bottom-centre hitzone means "look back" in the room view and "go back"
at a door**. One target, two meanings selected by context -- the shape
[WHY-FACTS-HIDE.md](../operations/WHY-FACTS-HIDE.md) pattern 6 warns about, and
the reason this control was missed on the first night: the door-view label was
read, the room-view meaning was not looked for.

That omission was the cause of death on the first night. The Freddy meter
climbs by `+AI` every 4000 ms and drains only while the bed is being viewed
(1 per 50 ms). A night that never looks back never drains it, so the meter is
monotonic and death is scheduled rather than random. **The bed view is not an
optional check; it is the only sink for that counter.**

### Door view

| control | screen centre | actuation |
|---|---|---|
| FLASH LIGHT | (307, 818) | **hold** |
| CLOSE DOOR | (2093, 818) | **hold** |
| turn around / run back | (1200, 944) | tap |

Both side controls are **dead-man holds, not toggles** — the door is shut only
while contact is held, and opens on release. This differs from FNaF 1 and 2,
whose doors latch, and it is the single most important actuation fact for a
route: there is no "door closed" state to schedule, only a contact duration.
It agrees with the source, where group 342 pushes an attacker back on a
**3000 ms** hold (public strategy accounts say ~5 s).

The two holds are distinguishable on screen: during a **door** hold the HUD
hides; during a **flashlight** hold the HUD stays visible. That gives a free
state discriminator without reading the door art.

### The warning panel

`HUDDoorWarning` states the core mechanic in the game's own words: listen, and
if breathing is audible hold the door shut, otherwise use the flashlight. This
is the *intended* path, and it is worth recording next to
[FNAF4-AUDIO-INDEPENDENCE.md](FNAF4-AUDIO-INDEPENDENCE.md), which establishes
that a schedule can force the same state without hearing anything.

## Two configuration hazards, both measured

### 1. Two mutually exclusive HUD layouts

Groups 722 and 723 lay out the hitzones differently depending on which global
is set, and group 727 **creates `HUDFlashlight` and `HUDCloseDoor` only under
GlobalValue[3]**:

| | GlobalValue[2] = 1 | GlobalValue[3] = 1 |
|---|---|---|
| door zones | 262 x 538, placed position kept | 256 x 290 at x 32 / 572 / 1012, y 268 |
| go-back zone | 998 x 80 | 512 x 150 at (256, 601) |
| flashlight / close-door | **not created** | created, 232 x 338 |

The observed screen carries FLASH LIGHT and CLOSE DOOR, so **GV3 is the active
layout on this handset**. UNKNOWN(not-measured): what selects between them; no
`SetGlobalValue` for 2 or 3 appears in any other frame's dump.

### 2. Display Mode widens the frame, and Controller Size scales the zones

`HUDGoBack`'s design rect is (256, 601) + 512 x 150, so its design centre x is
512 — the exact middle of the 1024-wide design space. Its label measures at
screen x **1200**, the exact middle of 2400. With y scaling at
1080 / 768 = 1.40625, design y 676 predicts 951 against a measured 944 (the
label carries a -10 design offset from group 729). The vertical mapping holds.

Inverting the horizontal mapping for the side controls does **not** land inside
the design space: FLASH LIGHT at screen 307 inverts to design x **-123**, and
CLOSE DOOR at 2093 to **1147**. Both sit outside 0..1024. So **Display Mode
FULL reveals roughly a 1707 x 768 window of a wider frame** (2400 / 1.40625),
and the side controls live in the revealed margin. This is the same
wider-frame-than-window situation already measured for FNaF 2 (576 px) and
FNaF 3 (976 px), reached here from the control side rather than the layer side.

Consequences: **Display Mode changes which controls are on screen and where**,
and `Controller Size` (`joystickSize`, clamped 60..180 and snapped to multiples
of 20, default 120) scales the zones directly. A FNaF 4 control map is valid
only for a stated pair of these, and they belong in a resolved profile beside
the build and the handset — exactly the caveat already recorded in
`packages/play/profiles/fnaf3/moto-g56/title-fnaf3-moto-g56-v204.json`. That it recurs verbatim
on a second game makes it a property of the **mobile port**, not of a game.

## Entry path, and a label trap

A cold launch does **not** land on the title. The warning frame routes on an
INI key:

- `00-01-warning` group 59/60 fire on a 2000 ms timer, or on any touch inside
  the frame (group 73). With the `test` key unset it routes to frame **14**.
- `14-15-test` is the audio-check screen. It holds exactly two objects:
  `btnExit.Active` and one touchzone. Its **only** button is labelled `EXIT`.

`EXIT` there does not quit. The frame contains **zero `EndApplication` and
exactly one `JumpToFrame`** (group 38, to frame 4 — the title). It means "exit
the audio test", and it is the only way forward. Reading the label rather than
the frame would have stalled the session or, worse, produced a refusal to press
the one control that advances it. Verify a control's effect in the frame that
owns it before trusting its word.

The audio test is **once per install**: pressing EXIT writes the `test` key,
and a later cold launch routes straight to the title. Confirmed by relaunching
after the key was written -- the audio screen did not appear.

Measured entry, this handset:

| step | target | contact |
|---|---|---|
| audio-test EXIT | (1203, 981) | 160 ms |
| title CONTINUE | (1221, 644) | 160 ms |
| title OPTIONS | (1200, 981) | 160 ms |
| Options EXIT | (1202, 981) | 160 ms |

Options screen, two columns at cx 677 and cx 1726, label/value rows at
y 143/194, 366/419, 590/644; SOUND TEST at (1201, 869). **Show Tips value sits
at (676, 419)** and cycles **NIGHT 1 -> NEVER -> ALWAYS -> NIGHT 1** — measured
by tapping it three times and reading the screen, which pins
`GlobalValue[11]` to 0 / 1 / 2 respectively and confirms group 725's condition
from the other side.

## What this cost, and what it did not

One night, lost at roughly 4-5 AM while standing at the closet. The night was
not a route attempt and no clear was sought; `CONTINUE` still reads 1. Nothing
here is a Plan 12 rung — it is a control map and two configuration facts,
which are the preconditions for a FNaF 4 route rather than a step along one.
