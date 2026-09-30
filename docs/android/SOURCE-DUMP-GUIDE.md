# Reading the source dump — what we are actually working with

Every `[SOURCED]` claim in this project traces back to one artifact: a text dump
of the Android game's **event sheet**. This document explains what that dump is,
how it is organised, the one rule that makes it readable at all, and the
commands the project uses to pull a fact out of it.

If you only remember one thing: **object handles in events are XOR-28 scrambled**
(see §4). Every dump this project produced before 2026-08-20 was read without
that rule and had every Toy↔Withered pair silently swapped.

---

## 1. The chain of custody

```
com.scottgames.fnaf2 v2.0.7 (owned, pulled from the device)
  └─ base.apk
       └─ res/raw/application.ccn      89 MB, Fusion CCN, magic PAMU, build 296
            └─ CTFAK + packages/source/decompile/EventTextDumper.cs
                 └─ events-android.txt   ~20 500 lines — what we read
```

**None of this lives in the repo.** The APK, the CCN and the dump are game
content; the repo holds only *derived rules* and the tooling. Keep them in a
scratch directory (`/private/tmp/fnaf2-android-dump/` by convention) and point
`$FNAF2_DUMP` at the dump.

Regenerate with:

```sh
packages/source/decompile/regen-dump.sh /path/to/application.ccn
```

The separate `packages/source/decompile/aimap.py` report reconstructs the AI counter table by
night and hour from the same canonical dump; it also still reads CTFAK's older
rendered `03-04-Office.txt` form, chosen by content, for archived sheets. Set
`$FNAF2_OFFICE_DUMP` or pass a path to use one of those. `packages/source/decompile/test-aimap.py`
checks it against a synthetic sheet, so that path stays covered without game
content. General rule queries should use `readdump.py` below.

CTFAK is .NET 6 and this Mac has no `dotnet`, so the script runs it in the
`mcr.microsoft.com/dotnet/sdk:6.0` image. `packages/source/decompile/EventTextDumper.cs` is our
own CTFAK tool — drop it into a CTFAK checkout at
`Core/CTFAK.Core/Tools/`, `dotnet build -c Release`, and CTFAK offers it as
"Event Text Dumper" in its tool list. With `CTFAK_IMAGE_DIR` and
`CTFAK_IMAGE_HANDLES` (comma-separated image handles) set, the same run also
writes those images as PNG; that needs GDI+, so run it in the image built
from `packages/source/decompile/ctfak-gdiplus.Dockerfile` (`CTFAK_IMAGE=fnaf2-ctfak-gdiplus:local`).
The pictures are game content: keep them beside the dump, never in the repo.
The checkout is upstream
`github.com/CTFAK/CTFAK2.0` plus the Linux port described in
`UPSTREAM-LEDGER.md` §1 (retarget to `net6.0`, `System.Drawing.Common`
6.0.0 with `EnableUnixSupport`, platform-guarded `CTFAKCore.Init` using
`libz.so.1`, `EditBox.png` case, `Console.Title`/`DrawArt2` guards); it was
rebuilt from that description on 2026-09-15 and the dump it produced is
byte-identical across runs. It is 99 lines and writes the format
below; extend it there rather than post-processing.

---

## 2. What a Clickteam Fusion game *is*

There is no source code to read. A Fusion game is a flat list of **event
groups**, evaluated **top to bottom, once per frame**, forever:

```
GROUP n:  if <condition> and <condition> and ...   →   do <action>, <action>, ...
```

No functions, no call stack, no loops in the ordinary sense. All state lives in
object **alterable values** (numbered numeric slots on every object) and global counters.
"Balloon Boy is in the left vent" is not a variable — it is *the BB object being
positioned on top of the `cam 5` marker object*.

Consequences that shape everything downstream:

- **Group order is execution order.** Two groups that both fire in one tick
  resolve in index order — this is why "same-frame input ordering" is an open
  question in the ledger, and why `ANDROID-OFFICE-ENDGAME.md` can say "the
  attack groups run first, so a same-tick return does not cancel a raised
  danger."
- **Group indices are the citation unit.** Docs say "group 417", and that index
  is stable for a given CCN + dumper. Re-cite after any regeneration.
- **Timers are conditions, not schedulers.** `Every 5000 ms` is a condition that
  is true on one tick out of every 300.
- The game runs its logic at **60 fps**; the project's frame constants
  (`STUN_FRAMES = 400` = 6.67 s) are all frame counts from these groups.

---

## 3. The file format

Seven line types, all tab-separated:

| Line | Meaning |
| --- | --- |
| `GAME` | name, Fusion build (296), frame count (33) |
| `OBJECTS` | section marker |
| `OBJECT h TYPE t NAME n VALUES … STRINGS …` | one row of the **item table**: `h` is the *stored* handle |
| `OBJANIM OI h ANIM a DIR d FRAMES i,j,…` | the image handles behind one animation direction of that row (**added 2026-09-15**); `ForceAnimation a` on the object draws image `i` |
| `FRAME i name GROUPS k` | a frame (scene) and how many groups it has |
| `GROUP g FLAGS f RESTRICT r CONDS c ACTS a` | one event group |
| ` C OT … NUM … OI … NAME … OIL … CFLAGS … COTHER … PARAMS …` | a condition of the group above |
| ` A OT … NUM … OI … NAME … OIL … PARAMS …` | an action of the group above |
| ` F WIDTH … HEIGHT … LAYERS … INSTANCES …` | the frame's scene size (**added 2026-08-26**) |
| ` L IDX … NAME … XC … YC …` | one layer and its parallax coefficients |
| ` I INST … OI … NAME … X … Y … LAYER … PTYPE … PARENT … INSTNUM … W … H … HOTX … HOTY …` | one **placed scene object** |

The ` F` / ` L` / ` I` lines sit between a `FRAME` line and its first `GROUP`.
They are purely additive — stripping them reproduces the pre-2026-08-26 dump
byte for byte, which is how the change was checked.

On an ` I` line, `W`/`H`/`HOTX`/`HOTY` are the extents of **animation 0,
direction 0, frame 0** — the object's default appearance. They are empty for an
object with no image (every counter, string and extension). Fusion draws an
image with its **hotspot on the object's position**, so the scene box is
`X - HOTX … X - HOTX + W`, not `X … X + W`.

Field meanings:

- **`OT`** — object type. `2` = Active (every animatronic, every marker), `7` =
  counter/value, `-1`/`-2`/`-4`/`-5` = system (special, timer, create, …).
- **`NUM`** — the condition or action id *within* that type. Negative numbers
  are Fusion's built-ins. There is no name table for these; you identify them by
  cross-referencing groups whose meaning you already know. Ones this project has
  pinned down: `C -27` = compare alterable value, `C -4` = is object overlapping
  object, `C -81` = compare counter/value, `C -8` = every N ms, `C -3` =
  compare two general values (used for `Random(N) < AI` rolls), `C -28` /
  `C -29` = the monitor-up Active's *completed* / *started* states,
  `A 31` = set alterable value, `A 1` = set position (this is how movement happens).
- **`OI`** — the object handle the event addresses. **Scrambled — see §4.**
- **`NAME`** — the dumper's naive lookup of `OI` in the item table. **Wrong on
  Android.** `packages/source/decompile/readdump.py` ignores it and resolves properly.
- **`COTHER`** — condition flags; **bit 0 set = the condition is negated**
  ("NOT overlapping", "monitor is NOT up"). `readdump.py` prints `!` in front.
- **`PARAMS`** — ` || `-separated parameter list, each `code:type:rendering`.
  The ones that carry meaning:
  - `AlterableValue` + `ExpressionParameter` — which slot, and the comparison or
    assignment (`cmp=>=`, `value=5`).
  - `ParamObject:Object <oil> <handle> <type>` — a second object, e.g. *which*
    marker to test overlap against. `handle` is scrambled too.
  - `Position:Object Info: <handle>` — "put me on that object". This is how all
    movement happens. `handle` is scrambled too.

---

## 4. The handle scramble — the rule that makes the dump mean anything

The APK's runtime XORs every object handle with **28** while loading the item
table (`COI.loadHeader`). Events were compiled against the *post*-XOR numbering.
CTFAK stores the item table pre-XOR. So:

```
true object of an event handle h   =   item_table[h XOR 28]
```

Four checks that confirm it, all of which fail without the XOR and read as
plain-English glosses with it:

| Event handle | Naive (wrong) name | `h ^ 28` | True name |
| --- | --- | --- | --- |
| 55 | `Multiple Touch` | 43 | `viewing` |
| 75 | `white button` | 87 | `lit?` |
| 126 | `old freddy` | 98 | `your view` |
| 102 | `balloon boy` | 122 | `balloon boy` (self-consistent pair) |

The scramble applies to **every** handle: `OI`, `ParamObject`, `Position`, and
the `oi=` inside expression items. Numeric constants are unaffected (they live
in parameters, not the item table), which is why the pre-2026-08-20 timings
survived the correction while every *character identity* had to be redone.

PC builds (e.g. the Shooter25 practice mod, build 295) are **not** scrambled:
pass `--xor 0`.

### Frame instances carry their own scramble: XOR 48 (corrected 2026-09-15, second pass)

The `OI` on an ` I` line is in **neither** of the two spaces above. The
runtime's layout loader reads it with its own constant (`Frame/CLO.load`,
decompiled from the APK's dex):

```java
this.loOiHandle = (short) (cFile.readAShort() ^ 48);
```

and only then resolves it through the item table that `COI.loadHeader`
already XORed with 28 (`COIList.getOIFromHandle`). So for a placed instance:

```
event handle of instance OI s   =   s ^ 48
true object of instance OI s    =   item_table[s ^ 48 ^ 28]  =  item_table[s ^ 44]
```

`readdump.py` applies this (`--lo-xor`, default 48; `0` on PC builds), and
`packages/source/decompile/test-instances.py` pins it. The two earlier rules were both wrong,
and the way each one failed is the check to keep:

| Reading of instance OI | Office camera markers placed | frame-3 instances joined to an event-referenced object |
| --- | --- | ---: |
| raw row (2026-08-26) | 8, 9, 10, 11, 12 | 158 / 205 |
| event handle (2026-09-15, first pass) | 01, 2, 5, 9, 10, 11, 12 | 154 / 205 |
| **`^ 48` (runtime)** | **all twelve** | **196 / 205** |

Under either wrong reading five camera markers had no Office instance, and a
Fusion `Set position` onto a missing object does nothing -- Withered Foxy could
never have left CAM 08. Under the runtime's reading the twelve markers sit in
the camera-map area (x 602-950, y 390-651) and the four approach markers form
one column at x = 668: `hall stage 1` (668, 481), `hall stage 2` (668, 550),
`in office` (668, 612), `got you box` (670, 681), with the static hitboxes the
characters are tested against on the same column (`hall movement` (669, 503),
`hear footsteps` (670, 533), `close by` (669, 606)). The animatronic objects
themselves are parked in a row at y = 793-822, below the 768-high window.

**Retracted: the 186-of-189 recompile join (2026-09-15, first pass).** The
recompile's Office init was generated by mmfparser from the same instance
chunk with the same raw OI, so "raw OI = recompile handle" compared the chunk
with itself. The warning of 2026-08-26 stands and now reads: join an instance
to the *events* (which are certainly in handle space) or to the *runtime
source*, never to anything derived from the instance chunk or the item table.

## 5. The vocabulary you need to read a group

**Frames.** 33 of them; only one matters. **Frame 3, `04-Office`, 1332 groups**
is the whole night. Everything this project cites is frame 3 unless stated.

**Object naming.** Scott's names, not the community's:

| In the dump | Is really |
| --- | --- |
| `old freddy` / `old bonnie` / `old chica` / `old foxy` | the Withereds, W. Foxy included |
| `new freddy` / `new bonnie` / `new chica` / `new foxy` | Toy Freddy / Toy Bonnie / Toy Chica / **Mangle** |
| `balloon boy`, `sockpuppet` | BB, the Puppet |
| `cam 01` … `cam 12` | marker objects — a character's *position on one of them* is its location |
| `hall stage 1` (120), `hall stage 2` (121) | off-camera hall transit |
| `in office` (122) | at the vent opening / in the office doorway |
| `got you box` (123) | actually inside the office |
| `viewing` | which camera is being watched; `0` = monitor down |
| `lit?` | flashlight state |
| `mask` | mask state; `value0 == 2` = fully on |
| `battery life`, `time allowed` / `time left` | power counter, office-encounter fuse |

**Alterable values.** Movement uses three slots on every character, and the
project's docs call them A/B/C:

| Slot | Project name | Meaning |
| --- | --- | --- |
| `AlterableValue0` | **A** | movement state: `1` = roll passed, `2` = accepted and waiting to hop, `0` = idle |
| `AlterableValue1` | **B** | stun / cooldown countdown; the pipeline requires `B = 0` |
| `AlterableValue2` | **C** | set to 10 on acceptance |
| `AlterableValue12` | v12 | consecutive fully-masked ticks (Toy Chica, Mangle, BB) |
| `AlterableValue6` | v6 | per-character latch, e.g. BB's "monitor raise seen at 122" |

`cam 01` also gets `AlterableValue6` / `AlterableValue21` written on movement
events with a `Random(4)…` expression; it is a scratch bank shared by all
characters (most likely sound selection) and is **not** decoded — do not read
meaning into it.

---

## 6. Worked example — read one rule end to end

Balloon Boy's whole approach, in six groups. This is the shape *every*
character follows, so learn it once:

```
GROUP 342   Every 5000 ms  +  Random(20) < [Balloon Boy AI]     → BB.A = 1
GROUP 359   BB.A == 1  +  BB.B == 0                             → BB.A = 2, BB.C = 10
GROUP 413   BB.A == 2  +  BB on [cam 10]                        → BB.A = 0, BB → [cam 7]
GROUP 414   …[cam 7]  → [cam 3]      415  [cam 3] → [cam 01]     416  [cam 01] → [cam 5]
GROUP 417   BB.A == 2  +  BB on [cam 5]
            +  viewing > 0  +  monitor-up complete              → BB.A = 0, BB → [in office]
GROUP 290   BB on [in office]  +  monitor raise started         → BB.v6 = 1
GROUP 291   BB.v6 == 1  +  monitor-up complete                  → BB → [got you box], v6 = 2
GROUP 292   BB on [in office] + mask fully on + every 1000 ms + Random(10)==1 → BB → [cam 10]
GROUP 294   BB.v12 >= 5  + BB on [in office] + mask fully on     → BB → [cam 10], v12 = 0
```

Three things fall out of that, none of which are visible from playing:

1. **The roll is never blocked.** Group 342 has no monitor, camera or light
   condition. It fires every 5 s all night.
2. **`A = 2` is a latch, not a moment.** Only group 417 — the hop into the vent
   opening — adds `viewing > 0` and monitor-up. Cameras down at the 5 s boundary
   therefore **defers** BB's move; the latch persists and cashes in the instant
   the monitor comes up. It never denies it.
3. **The route is CAM 10 → 07 → 03 → 01 → 05 → opening**, and *that* is what
   the community's "laughs" count.

---

## 7. Extracting a fact: the workflow

```sh
export FNAF2_DUMP=/private/tmp/fnaf2-android-dump/events-android.txt

packages/source/decompile/readdump.py frames                    # confirm frame 3 is the office
packages/source/decompile/readdump.py objects balloon           # event-space handles by name
packages/source/decompile/readdump.py object 3 "balloon boy"    # every group touching him
packages/source/decompile/readdump.py writes 3 "balloon boy" 0  # who sets his movement state
packages/source/decompile/readdump.py group  3 413-418          # read the range
packages/source/decompile/readdump.py find   3 "in office"      # text search over rendered groups
packages/source/decompile/readdump.py instances 3 light         # placed scene objects: X, Y, layer, box
```

`packages/source/decompile/test-instances.py` and `packages/source/decompile/test-aimap.py` check the reader
against synthetic sheets, so both stay covered without game content.

The productive order is almost always: **find who writes the state → read the
group that consumes it → check its extra conditions.** `writes` answers "how
does this ever become true", and the answer's extra conditions are the actual
game rule. Conditions you cannot name yet get identified by finding another
group with the same `NUM` whose meaning is already known (that is how `C -28` =
"monitor up" was pinned, via the Golden Freddy spawn roll in group 336).

Then, before it enters the simulator:

- Record the group numbers in `ANDROID-SOURCE-STATUS.md` and label the constant
  `[SOURCED]` in `src/config.js`. A rule with no group number is `[MODEL]`.
- Add or update the engine test (`tools/model/reactive-pilot.mjs`, `tools/simtest.mjs`,
  `tools/androidstalltest.mjs`) in the same commit.

---

## 8. What the dump does *not* contain

- **No sounds, and no pixels in the text** — the dumper emits logic plus scene
  *geometry*, and since 2026-09-15 the `OBJANIM` rows that name each
  animation's image handles, with an opt-in PNG export of named handles
  (§1). Since
  2026-08-26 it does emit each frame's size, layers and placed-object list
  (§3), which is where the office's 1600×768 came from.
- **A placed position is the editor's position, and the sheet may move it.**
  Read through the runtime's instance rule (§4) the Office is coherent: the
  vent anchors sit at (147, 429) and (1444, 427), where the phone taps them,
  and the HUD's hitboxes are parked below the window until g1223 and
  g1072-1081 move or create them. Before trusting a position, scan the
  frame's `Position`, `SetX`/`SetY` and `Create` parameters for that handle
  (`readdump.py object 3 <name>`). The 2026-08-26 "the port lays out its HUD
  from code, so no placement is evidence" reading was an artifact of the wrong
  instance rule; see `ANDROID-SOURCE-STATUS.md` 2026-09-15 (second pass).
- **No group comments or names.** Fusion's event-sheet comments are not in the
  CCN, so intent is always inferred.
- **No expression tree.** `ExpressionParameter` items are flattened to a linear
  list; nested arithmetic has to be reassembled by eye.
- **No condition/action name table.** `NUM` is an opaque id (see §3).
- **Nothing about the shipped runtime's frame pacing** beyond what the groups
  say — the 60 fps assumption and the `min(4, frameDelta/16.666)` drain in
  group 1236 are the only handles on it.

---

---

## 9. `awk` silently truncates this file

The dump contains **NUL bytes** inside rendered parameter values (a Fusion
`GlobalValue` name renders as `GlobalValue\x00`). BSD `awk` ends a record at
the NUL, so `awk '{print}' events-android.txt` returns a file that is the right
*length* and quietly 58 lines shorter in content — which reads exactly like a
real difference. This cost a full bisect: an `awk`-stripped diff "proved" the
2026-08-26 dumper change had altered 77 event lines, and it had altered none.

Compare dumps with `python3` (or `cmp`), never `awk`. `grep`, `diff` and `sed`
are fine.

---

**Hard rule (unchanged):** personal study of an owned copy. No game assets, no
decompiled content, and no dump ever committed to this repo — only the rules we
derive from it.
