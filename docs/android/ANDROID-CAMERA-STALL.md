# Android camera-stall audit

**Status (2026-08-20, second pass): SOLVED. The camera-light stall is alive in
the owned 2.0.7 Android build — 400 frames (6.67 s) per flash, loaded from the
`stun time` counter. The 2026-08-19 "dormant subsystem" conclusion was an
artifact of a decompiler blind spot: the Android runtime XOR-scrambles object
handles, and every event dump before the fix carried systematically swapped
object names.**

## The blind spot: the mobile handle scramble

The shipped APK bundles its own Clickteam runtime. Its object-info loader
(`OI/COI.loadHeader`, decompiled from the APK's dex) reads FRAMEITEMS handles
like this:

```java
this.oiHandle = ((short) (p3.readAShort() ^ 28));
```

Every stored object handle is XORed with a per-build constant (28 for this
build) before use. `COIList.preLoad` indexes objects by the post-XOR handle,
`CObjInfo.oilOi` copies it, and event bytecode, expression tokens, and frame
instances all address objects in the post-XOR space. Neither CTFAK nor
mmfparser applies this XOR, so both tools attached every event reference to
the object stored *at* that handle instead of the object *remapped to* it.

Because XOR-with-a-constant is a bijection, the mislabeling is self-consistent:
the dump looks coherent, semantics get force-fitted onto the wrong names, and
nothing obviously breaks. The tell, in hindsight, was type mismatches —
counter-typed events targeting objects the item table called Actives
(`white button`, `Multiple Touch`, `mute call`).

Verification chain:

- `COI.loadHeader` XORs the stored handle (runtime source, above).
- `COIList.preLoad`/`getOIFromHandle` resolve events and instances by the
  post-XOR handle; `CObjInfo.oilOi` is the post-XOR value.
- The XOR-28 pair table is a perfect Rosetta stone: `Multiple Touch`↔`viewing`,
  `white button`↔`lit?`, `old freddy`↔`your view`, `star 3`↔`cam 8`,
  `battery life`↔`cam 9`, `got you stage`↔`Golden Freddy AI`,
  `time allowed`↔`stun time`, every Toy↔Withered pair, and the night counter.
- The only unresolvable references in the old dump (`obj#449-451`) are exactly
  the four straggler items (476-479) whose XOR partners don't exist.
- Every type mismatch disappears under the remap.
- The FNaF 1 APK's runtime reads handles with **no** XOR (`oiHandle =
  readAShort()`), which is why the FNaF 1 dump always read coherently. The
  constant is per-build: extract it from `OI/COI.loadHeader` in each APK.

`~/fnaf-apks/dump_events.py` now takes the XOR as an argument (28 for this
build) and the FNaF 2 dump has been regenerated with true names. The pre-fix
dump is preserved at `~/fnaf-apks/fnaf2/events-prexor-scrambled/`.

## The live mechanism (post-XOR, sourced)

All group numbers below are unchanged; only names were wrong.

### 1. Camera-light flash stun — groups 450-457

With the monitor up (`viewing` > 0), the camera light on (`lit?` = 1), and the
selected-camera marker (`your view`) overlapping a character:

| Group | Character | Excluded camera | B is set to |
| --- | --- | --- | --- |
| 450 | Withered Freddy (`old freddy`) | `viewing <> 8` (Parts/Service) | `stun time` |
| 451 | Withered Bonnie (`old bonnie`) | `viewing <> 8` | `stun time` |
| 452 | Withered Chica (`old chica`) | `viewing <> 8` | `stun time` |
| 453 | Toy Freddy (`new freddy`) | `viewing <> 9` (Show Stage) | `stun time` |
| 454 | Toy Bonnie (`new bonnie`) | `viewing <> 9` | `stun time` |
| 455 | Toy Chica (`new chica`) | `viewing <> 9` | `stun time` |
| 456 | Mangle (`new foxy`) | `viewing <> 11` (Prize Corner) | `stun time` |
| 457 | Paper Pals (`paper pals`) | — | `stun time - night*50` |

`stun time` (stored handle 132, runtime handle 152) is defined with
`initial = 400` and is **never written anywhere in the event program** — its
eight occurrences are all reads in these groups. Groups 361-373 drain B by
`min(4, frameDelta/16.666)` per rendered frame (≈1/frame at 60 FPS, group
1236), and the movement pipeline requires `B = 0`, so:

**One flash = 400 frames = 6.67 seconds.** The community's 6.66 s / 400-frame
figure is exact on this Android build. The `- night*50` variant sanity-checks
the design: 400 keeps it positive through night 7 (50); the previously claimed
source value 0 would have made it negative and permanently frozen the target,
which no one has ever observed.

The by-night values 100/80/60/55/50/50/45 that the first audit attributed to
`stun time` actually target `time allowed` (runtime 132), which group 530
copies into `time left` — that pair is the office-mask defence fuse and has
nothing to do with camera stalls.

### 2. Look-hold — groups 344-360

A successful movement roll (groups 333-343, every 5000 ms) sets the character's
A to 1. Groups 344-360 resolve A=1 to A=2 (accepted movement, C=10) and demand
`B = 0` plus per-character conditions:

| Character | Resolution gate besides `B = 0` |
| --- | --- |
| Withered Freddy (344/345) | marker NOT overlapping him; night<>7 variant drops co-occupancy checks |
| Withered Bonnie (346) | marker NOT overlapping him |
| Withered Chica (347/348) | marker NOT overlapping her |
| Withered Foxy (349) | none |
| Toy Freddy (350-352) | Toy Chica not on `cam 9` (Show Stage leave order); **no marker gate** |
| Toy Bonnie (353) | none |
| Toy Chica (354-356) | Toy Bonnie not on `cam 9`; **no marker gate** |
| Mangle, monitor up (357) | marker NOT overlapping her |
| Mangle, monitor down (358) | office hall light off (`viewing hall light` = 0) |
| Balloon Boy (359) | none |
| Paper Pals (360) | marker NOT overlapping them |

So the look-hold protects against the **Withereds** (and monitor-up Mangle),
exactly as the community always said — the first audit had the set inverted.
Toys are instead ordered by Show Stage co-occupancy (Bonnie before Chica
before Freddy), which matches their known departure order.

### 3. Marker parking — the hold persists monitor-down

Camera selection (groups 16-27, 40) sets `viewing` to 1-12 and snaps
`your view` onto that camera's hotspot. Lowering the monitor (group 262) sets
`viewing = 0` **but never moves the marker**; masking with the monitor up does
the same (group 911). The Withered resolution gates carry **no monitor
condition**, so:

**A Withered under the last-selected camera stays held even while the monitor
is down.** This is FNaF 1's CAM-4B-style parking, alive in FNaF 2 Android.
Ending a camera sweep on a Withered's room keeps holding that Withered for
free during the monitor-down stretch. (Needs an on-device sanity check before
it becomes trainer doctrine, but it is unambiguous in source.)

## Controlled model verification

`packages/propose/test/androidstalltest.ts`, shipped Minus 7 schedule:

| Model | Normal seeds | Pinned worst luck |
| --- | ---: | ---: |
| Sourced (400-frame flash + Withered/Mangle hold) | 200/200 | 100/100 |
| Legacy trainer (400 flash + 400 look timers) | 200/200 | 100/100 |
| All camera stalls removed | 0/200 | 0/100 |
| Marker hold alone | 0/200 | 0/100 |

The corrected sourced model keeps the shipped strategy alive, resolving the
contradiction with real Android Minus 7 completions. No build-identity fork,
runtime patch, or hidden second mechanism was needed — the stall was in the
data all along, one XOR away.

## What the first audit got right and wrong

Right, and still standing:

- The raw bytes: the counter stored at handle 152 really does hold initial 0,
  and the one at 132 holds 400. (They belong to the opposite names.)
- The runtime reads `ctInit` directly; no asset swap; expression handle 152 is
  matched against `oilOi` — the audit simply didn't notice `oilOi` was born
  from an XORed load.
- The structural decode of the stall pipeline (B countdown, `B = 0` gate,
  delta scale, group topology) was accurate throughout.

Wrong, now corrected:

- "`time allowed` = 0 disables the stall" — the flash reads `stun time` = 400.
- "The selection gate covers Toys/Mangle/Puppet, not the Withereds" — inverted;
  it covers the Withereds and monitor-up Mangle; the group-360 entity is Paper
  Pals, not the Puppet.
- "Do not cite STUN_FRAMES = 400 as Android-backed" — it is Android-backed.

## Blast radius

Numeric constants extracted from event parameters were never at risk (they
live in the events themselves, not in the item table). Every claim of the form
"object *name* does X" from before 2026-08-20 was remapped by the XOR pair
table. The same-day re-audit re-derived the route graph and rebuilt the
simulator's unit table from the true-name dump (all regressions green, and the
corrected routes independently match the Technical-FNaF wiki's Minus 2
CAM 03 claim); the remaining re-reads (Foxy/BB/GF/Puppet subsystems, endgame
branch narratives) and the full extraction backlog are tracked in
`ANDROID-SOURCE-STATUS.md`.
