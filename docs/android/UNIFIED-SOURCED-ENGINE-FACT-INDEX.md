# Unified sourced engine-fact index

Every `[SOURCED]` fact about the **game engine** this project has extracted, in
one place, with its group citation and the document that owns it. This file is a
**digest and a router**, not a new authority: when a fact here and its owning
document disagree, the owning document wins and this file is stale — fix it in
the same commit.

- **Scope:** rules of the *game*. Device-actuator numbers, detector calibration,
  human-slack models, and policy survival figures are **not** here — they are
  models of the phone or of the simulator, not the event sheet. See
  [`HID-MULTITOUCH.md`](../device/HID-MULTITOUCH.md),
  [`ON-DEVICE-VALIDATION.md`](../device/ON-DEVICE-VALIDATION.md), and
  `docs/android/ANDROID-SOURCE-STATUS.md` §"The simulator prices nothing".
- **Canonical authority:** [`ANDROID-SOURCE-STATUS.md`](ANDROID-SOURCE-STATUS.md)
  is the enforced ledger (`packages/source/test/sourcetest.ts`, one case per group citation).
  Everything below traces to it, to [`ANDROID-CAMERA-STALL.md`](ANDROID-CAMERA-STALL.md),
  [`ANDROID-OFFICE-ENDGAME.md`](ANDROID-OFFICE-ENDGAME.md),
  [`ANDROID-GROUP-MAP.md`](ANDROID-GROUP-MAP.md),
  [`SOURCE-DUMP-GUIDE.md`](SOURCE-DUMP-GUIDE.md), or `src/config.js` / `src/engine.js`.
- **Retractions stay.** Reversed findings are listed in §14 with what replaced
  them, because the wrong turn is usually the useful part.

---

## 1. What the source is, and how to cite it

| | |
|---|---|
| Package | `com.scottgames.fnaf2` **v2.0.7** (owned, pulled from the device; on-device build string seen as `2.0.7+26`) |
| Asset | `base.apk` → `res/raw/application.ccn` — 89 MB, Fusion CCN, magic `PAMU` |
| Fusion build | **296** |
| Project revision | modern Android **release 7**, August 2025 |
| Event sheet | frame **3**, `04-Office` — **1332 groups**; dump ≈ 20,500 lines. Frame is **1600 × 768**, 9 layers, 205 placed instances |
| Logic rate | **60 fps** — every frame constant in this file is a count of these ticks |
| Toolchain | CTFAK (.NET 6, run in `mcr.microsoft.com/dotnet/sdk:6.0`) + `packages/source/decompile/EventTextDumper.cs` → `events-android.txt` |
| Regenerate | `packages/source/decompile/regen-dump.sh /path/to/application.ccn`; AI table via `packages/source/decompile/aimap.py` |
| Never committed | the APK, the CCN, the dump — game content. Only derived rules live in the repo. |

**The one rule that makes any of this readable — the XOR‑28 handle scramble.**
The bundled runtime XORs every stored object handle with a per-build constant
(**28** here) at load (`OI/COI.loadHeader`); event bytecode, expression tokens,
and frame instances all address objects in *post*-XOR space. CTFAK/mmfparser do
not apply it, so **every dump before 2026‑08‑20 had bijectively swapped object
names — every Toy↔Withered pair included.** Numeric constants live in event
*parameters*, not the item table, so they were never affected — which is why
pre‑XOR *timings* survived the correction while every character *identity* had
to be redone. FNaF 1's runtime uses **no** XOR; PC builds (e.g. the Shooter25
mod, Fusion 295) use XOR 0. Full method: [`SOURCE-DUMP-GUIDE.md`](SOURCE-DUMP-GUIDE.md) §4.

**Frame instances share the event space** (corrected 2026‑09‑15): the `OI` on
an ` I` line names `item_table[OI ^ 28]`, like an event handle, and its dumped
image is the XOR partner's too. The 2026‑08‑26 "not scrambled" rule is
retracted (§14): the recompiled Office init matches 186/189 positions by raw
handle and 2/189 through the XOR.

**Name glosses the scramble hid** (every one is now a resolved true name, not an
inference): `Multiple Touch` → **`viewing`** · `white button` → **`lit?`** ·
`old freddy` marker → **`your view`** · `monitorFrame` → **`mask`** ·
`danger 2` → **`being attacked by`** · `new bonnie` light latch →
**`viewing hall light`** · `old chica` office latch → **`in danger`** ·
`chicalookatyou` gloss → **`office occupied`** (but `chicalookatyou` is *also* a
real second object — Toy Chica's office overlay, g438) · `cam 9` →
**`battery life`** · `star 3` → **`cam 8`** · `time allowed` ↔ `stun time`
(swapped) · `got you stage` ↔ `Golden Freddy AI` (swapped) · markers
120/121/122/123 → `hall stage 1` / `hall stage 2` / `in office` / `got you box`
· `Active 21` → **`decide path`** (route-fork 1/2 selector: W. Freddy g376‑377,
Mangle g396‑397, Puppet v2 g406/407) · `cam 6` → **`DEMO?`** (demo-build flag —
the faster night‑3 box drain is demo-only).

**Group citations.** A Fusion game is a flat list of event groups run top‑to‑
bottom once per frame. **Group order is execution order**; **group index is the
citation unit** and is stable only for a given CCN + dumper — re‑cite after any
regeneration. Timers (`Every 5000 ms`) are conditions true on one tick in N, not
schedulers. State lives in object alterable values (`A`/`B`/`C` = slots 0/1/2)
and globals; a character's *location* is its object positioned on a marker
object (`cam 01`…`cam 12`; `hall stage 1/2` = markers 120/121; `in office` =
122; `got you box` = 123).

**Evidence labels** (from `src/config.js:1‑21`): `[SOURCED]` event sheet or an
Android experiment · `[CALIBRATED]` tuned to match documented behaviour, no
published number · `[INFERRED]` derived from sourced parts under a stated
assumption · `[MODEL]` retained community behaviour Android has not confirmed
(or contradicts).

---

## 2. Master constant table

Every sourced numeric value, with its groups, label, and `src/` binding. Prose
and edge cases are in the sections that follow.

| Constant | Value | Groups | Label | Binding |
|---|---|---|---|---|
| Logic frame rate | 60 fps | — | load-bearing | `config.js:23` |
| Night length | 420 s (25 200 fr); 70 s / 4200 fr per in-game hour; 70 AM-ticks/hr, 1 tick/1000 ms | g627, g629/g630 | `[SOURCED]` | `config.js:26‑27` |
| Movement-opportunity cadence | every 5000 ms (1 tick in 300) | g333‑343 (g342 = BB) | `[SOURCED]` | `MO_FRAMES` `config.js:44` |
| Movement roll | `Random(1..20) ≤ AI` → `AI/20` (75 % at the 15 cap) | g333‑342 | `[SOURCED]` | `MO_CHANCE` `config.js:243` |
| Puppet movement roll | bare `Random(20) ≤ AI` → `(AI+1)/20` (16/20 at AI 15) | g494‑497 | `[SOURCED]` | `PUPPET_MO_CHANCE` `config.js:247` |
| `C` token on accepted move | set to **10**, drained ~1/frame (~10-frame window) | g359 (BB); g468‑477 read it | `[SOURCED]` | `config.js` |
| Camera-flash stun | **400 frames = 6.67 s** — B loaded from `stun time` (initial 400, never written) | read only in g450‑457; drained by g361‑373 at ~1/frame (dt scalar g1236) | `[SOURCED]` Android, post-XOR | `STUN_FRAMES` `config.js:43` |
| Flash camera exclusions | no stun while `viewing` = **8** (Withereds), **9** (Toys), **11** (Mangle) — unconditional, no night term | g450‑452 (`<>8`), g453‑455 (`<>9`), g456 (`<>11`) | `[SOURCED]` | `engine.js:512‑541` |
| Paper Pals flash variant | `stun time − night·50` (= 50 at night 7) | g457 | `[SOURCED]` | `config.js:37` |
| Frame-delta drain scalar (`dt`) | `min(4, frameDelta / 16.666)` | g1236 / global `ot=-1 num=24 value=5` | `[SOURCED]` | — |
| Office defense fuse (`time allowed` → `time left`) | **100 / 80 / 60 / 55 / 50 / 50 / 45** frames, nights 1‑7 (1.67 s → 0.75 s) | g523‑529 set; g530 copies + `got you stage`=1; g531 drains; g532 →stage 2; g533 →stage 0 on `mask`=2 | `[SOURCED]` | `MASK_GRACE_BY_NIGHT` / `TIME_ALLOWED_BY_NIGHT` `config.js:66,170` |
| Office visible sequence (`blackout` v0) | **300 frames** (~5 s), `+dt` while `in danger`=1 | g514/g516/g535/g537 | `[SOURCED]` | `config.js:46‑48` |
| Blackout fade-out (`blackout` v2) | **250 frames** after the sequence — a **249-frame (~4.15 s) post-encounter lockout** on Toy Bonnie / Toy Chica starting the *next* one | g534/g535/g536; g845 shortcuts it | `[SOURCED]` — **engine gap** | — |
| Jumpscare countdown (`being attacked by` / `danger 2`) | **40 frames**, every night | g556‑569, g587‑588 | `[SOURCED]` | `INSIDE_ATTACK_FRAMES` `config.js:138` |
| Entry-streak threshold (mutex four) | continuous cams-up seconds ≥ **20 − 2·night** (6 s on night 7); resets when the monitor starts lowering | g785/g786 track; final-hop gate | `[SOURCED]` | `entryStreakFrames` `config.js:106` |
| Toy Bonnie opening timer | B = **1000 − 100·night** frames (300 on night 7), drained ~1/frame | g428 writes, g367 drains, g546 (B=0 + raise → 123) | `[SOURCED]` | `toyBonnieOpeningFrames` `config.js:117` |
| Toy Bonnie office-overlay roll | `Random(2)=1` every **500 ms** while mask fully on (needs `blackout` v0 = 0) | g436 gate, g443 sets `in danger` | `[SOURCED]` | `TOY_BONNIE_CUE_FRAMES/CHANCE` `config.js:132‑133` |
| Toy Bonnie masked+engaged repel | 1‑in‑3 per second → CAM 03; overlay slide finishing also repels | g437, g441 | `[SOURCED]` | — |
| Toy Chica leave-122 arm | **6** phase-aligned scheduler ticks (v8 > 5) | g903 zero, g904 +1/s at 122, g905 advance | `[SOURCED]` | `TOY_CHICA_OPENING_TICKS` `config.js:118` |
| Vent occupant guaranteed leave (Toy Chica / Mangle / BB) | **5 continuous fully-masked ticks**; **10 %/s** early roll; counter zeroed on every entry to mask state 2 | g907 count, g293 reset, g294/g292 (BB), g400/g401 (Mangle) | `[SOURCED]` | `VENT_MASK_TICKS=5`, `VENT_EARLY_LEAVE_CHANCE=0.1` `config.js:95,97` |
| Mutex-four attack at 123 | **50 %** each fully-masked second; **10 %/s** return with B = 500 (attack groups run first) | g556‑559, g747‑750 | `[SOURCED]` | `INSIDE_MASK_ATTACK_CHANCE/LEAVE_CHANCE` `config.js:175‑176` |
| Mangle arm at 123 | **5 %** cameras-up second, then attacks on a cams-down edge | g729‑731 | `[SOURCED]` | `MANGLE_INSIDE_ARM_CHANCE=0.05` `config.js:177` |
| W. Foxy attack at 123 | every **10 s** in either monitor state, or instantly on a monitor-down hall flash | g571‑573 | `[SOURCED]` | `FOXY_ENTER_MIN/MAX` `config.js:86‑87` |
| Toy Bonnie danger at 123 | monitor starts lowering, or every **10 cams-up seconds** | g568, g722 | `[SOURCED]` | `engine.js:789‑794` |
| Defended repel cooldown | B = `Random(500) / night` (worst luck pins the roll to 0) | g538‑555 | `[SOURCED]` | `REPEL_COOLDOWN_ROLL=500` `config.js:125` |
| Marker-123 leave cooldown | B = **500** flat | g747‑750 | `[SOURCED]` | `INSIDE_LEAVE_COOLDOWN=500` `config.js:126` |
| Forcedown (`drop everything`) triggers | every **10 s** while a mutex-four attacker waits at 122 cams-up; any attack start; Puppet reaching 123; player drop button | g718‑721, g624, g574 | `[SOURCED]` | `engine.js:96‑98,435‑440` |
| Forcedown execution | monitor lowered + `viewing`=0 at g262; mask taken off at g274; flag cleared at g612, re-set g614‑624/g718‑721 one frame later | g262, g274, g612 | `[SOURCED]` | `engine.js:382‑403` |
| Vent-light re-clear | both cleared every **200 ms**; re-asserted only by g313 (left) / g320 (right) while the touch is over the hitbox; **no battery cost** | g299, g301/g303/g313/g320, g308/g315 | `[SOURCED]` | `engine.js:186‑195` |
| `last viewed` sample cadence | every **200 ms** while `viewing > 0` (the only writer) | g263 | `[SOURCED]` | — |
| Flashlight battery drain | **1 / frame** while `lit?` on (office or camera); vent + hall lights free | g284 | `[SOURCED]` | `engine.js:496‑506` |
| Battery capacity by night | **7000 / 6000 / 5000 / 4000 / 3000 / 3000 / 3000** frames (night 5+ = 50 s of light); blink indicator at 500 | night-start set; g916 = `unlimitedPower` cheat | `[SOURCED]` | `POWER_BY_NIGHT` `config.js:351` |
| Hall-light movement pin | office-light latch rewrites B to **40** every frame for WF/WB/TF/TC/Mangle; still drains after g488 clears the latch. **W. Chica & Toy Bonnie exempt** | g848‑854 | `[SOURCED]` | `HALL_LIGHT_PIN_FRAMES=40` `config.js:236` |
| `hall movement` latch | any hall-routed character overlapping it sets **300 frames**; g779 needs it at 0, so GF gets no hall exposure for 5 s after anyone transits | g875‑881 | `[SOURCED]` — implemented | `HALL_MOVEMENT_FRAMES=300` `config.js:231` |
| Foxy AI cap | **17** (others cap at 15) | g829 | `[SOURCED]` | `FOXY_AI=17` `config.js:81` |
| Foxy roll | `21 + Random(0..4) − D ≤ Foxy AI` (operator `≤`) | g337 (5 s) | `[SOURCED]` | `engine.js:874‑889` |
| Foxy `D` | +1/s unengaged; **+1/s more** while masked with the vent/office threshold clear; blackout pauses it; **0 all of night 1 and until 2 AM night 2**; drained 1 per 500 ms of Parts/Service hall light | g824/g825, g864, g872‑874 | `[SOURCED]` | `engine.js:594‑637` |
| Foxy hall exposure | per-frame `v9` vs **100·night**; B pinned to **50** while the hall light is on him | g745, g855 | `[SOURCED]` | `foxyExposureFrames`, `FOXY_HALL_PIN_FRAMES=50` `config.js:82‑83` |
| Foxy retreat cooldown | B = **500 + Random(500)**; `hall movement` set to 300 | g846 | `[SOURCED]` | `FOXY_RETURN_MIN/MAX` 500/999 `config.js:84‑85` |
| Balloon Boy roll | `Random(20) < BB AI` every 5000 ms — **never blocked** (no monitor/camera/light condition); passed roll latches `A=2` | g342, g359 | `[SOURCED]` | `BB_MOVE_CHANCE=0.75` `config.js:185` |
| Balloon Boy route | CAM **10 → 07 → 03 → 01 → 05 → opening** — **5 hops**, only the last is monitor-gated | g413‑417 (g417 gated) | `[SOURCED]` | `BB_STAGES=5` `config.js:186` |
| Balloon Boy silent hops | hop 1 (CAM 10→07) writes nothing; hops 2‑4 play a vocal; hop 4 (CAM 01→05) also plays the thud | g413 silent; g414‑416 | `[SOURCED]` | `BB_SILENT_HOPS=1` `config.js:188` |
| Balloon Boy inside 123 | force-clears `lit?` every frame, blocks light/camera touches; **no departure group — permanent**; never attacks (Foxy finishes) | g96, g75‑88, g301‑320 | `[SOURCED]` | `engine.js:682‑692` |
| Golden Freddy — office | `Random(20) < GF AI` every 5 s, monitor raise **finished**, no `yellowbear` present; AI capped at **10** (→ 10/20 = exactly ½), zero below night 6 | g336, g830, g804 | `[SOURCED]` | `GF_SPAWN_CHANCE=0.5` `config.js:218` |
| Golden Freddy — office kill / clear | monitor raise (g777) or hall flash (g778) with him present = lethal; mask fully on clears him (g776) then he fades (g1040/g1041) and blocks his own respawn until gone | g336, g776‑778, g1040/g1041 | `[SOURCED]` (fade *rate* UNKNOWN) | `engine.js:272‑300,918‑927` |
| Golden Freddy — hallway | `golden` v1 = `Random(10)` re-rolled **every second while the hall light is OFF** (v1=1 draws him); exposure +1/frame on a lit **empty** hall; kill above **100** (101 frames); counter zeroed when absent | g781, g779, g780, g865 | `[SOURCED]` | `GF_HALL_ROLL=10`, `GF_HALL_KILL_FRAMES=100` `config.js:223,226` |
| Music box counter | **2000** units at frame start; wind snaps anything **< 300 up to 300**, then **+5/frame (+300/s)**; empty→full ≈ **5.66 s** = (2000−300)/300; wind tick 500 ms | g652, g638/g643, g639/g645 | `[SOURCED]` | `BOX_UNITS=2000`, `BOX_SNAP=300/2000`, `BOX_WIND_FRAMES=s(5.66)` `config.js:432,451,461` |
| Music box drain, per night | −2/−2/−3/−4/−5/−6/−6 units per **50 ms** → 40/40/60/80/100/120/120 u/s → full→empty **50 / 50 / 33.3 / 25 / 20 / 16.67 / 16.67 s**; night 3 demo arm is −4 (`DEMO?` object 33) | g653‑660 (g655/g656 split) | `[SOURCED]` (2026‑08‑26) | `BOX_DRAIN_PER_TICK` `config.js:433` |
| Music box drain gate | **night 1 only**: box does not drain at 12 AM or 1 AM (`time of the night ≠ 12, ≠ 1`) — starts at 2 AM. No other night gated | g653 | `[SOURCED]` | `boxDrainsAtHour` `config.js:443` |
| Puppet escape | **3** successful one-second rolls free him from CAM 11 (box must be empty); blocked while `viewing`=11 with the light held | g494‑497, g774 | `[SOURCED]` | `PUPPET_ESCAPE_STAGES=3` `config.js:467` |
| Puppet route | CAM 11 → 10 → 07, then `decide path`: 1 → 03 → 01, 2 → 04 → 02, both to marker 122; five hops on the one-second roll; then a **1‑in‑10 per second** 122 → 123 edge; arrival forces the monitor down | g404‑411, g496, g623, g574 | `[SOURCED]` | `PUPPET_ROUTE`, `PUPPET_OFFICE_ROLL=10` `config.js:469,475` |
| Puppet camera pin | lighting his current camera outside CAM 11 rewrites B to **10** every frame | g774, g372 | `[SOURCED]` | `PUPPET_CAMERA_PIN_FRAMES=10` `config.js:468` |
| Puppet AI by night | 1 / 5 / 8 / 9 / 10 / 15 / 15 — **no dial, no cap group** | g815‑821 | `[SOURCED]` | `AI_BY_NIGHT` `config.js:285` |
| Look-hold set | pending roll (`A=1`) cannot resolve while `your view` overlaps: the **three Withereds** (g344‑348) and **monitor-up Mangle** (g357); monitor-down Mangle blocked instead by `viewing hall light`=0 (g358). Toys have **no** look gate — ordered by Show Stage co-occupancy (g350‑356) | g344‑360 | `[SOURCED]`, post-XOR (was inverted) | `SELECTED_CAMERA_GATED` `config.js:625` |
| Marker parking | lowering the monitor (g262) / masking (g911) zeroes `viewing` **without moving the marker**; Withered look-hold carries **no monitor condition** → a Withered under the last-selected camera stays held monitor-down | g262, g911, g344‑348 | `[SOURCED]` (needs on-device check before doctrine) | — |
| Monitor animation | up **12** frames (0.204 s), down **22** frames (0.367 s) — asymmetric, down ~1.8× slower | g1 (≥12), g6 (≥22) | `[SOURCED]` build-296 bank | `MONITOR_ANIM_UP/DOWN` `config.js:484‑485` |
| Mask animation | on **12** frames (0.200 s); off — animation bank says 15 (`config.js` `MASK_ANIM_OFF=15`), **event threshold that flips the state is 14** (g10/g11). Mask returns to state 0 only when the off-animation ends → *that animation is the post-mask flash lockout* | g9 (≥12), g10 (≥14), g11 | `[SOURCED]` — engine off by one | `MASK_ANIM_ON=12`, `MASK_ANIM_OFF=15` `config.js:486‑487` |
| Parked / opening camera | hidden `your view` marker parked on CAM **09** (nights 1‑6) / CAM **10** (Custom); first completed raise opens CAM **09** (nights 1‑6) / CAM **07** (night 7) from a null `last viewed` | g2‑4, g486‑487 | `[SOURCED]` | `parkedCamera`, `initialCamera` `config.js:511‑512` |
| Home positions (start of frame) | Withereds + W. Foxy CAM 08; Toys CAM 09; BB CAM 10; Puppet CAM 11; Mangle CAM 12; Paper Pals CAM 04 | g329 | `[SOURCED]` | `STALLED` paths `config.js:597` |
| Office pan clamp | integrator `v23` clamped **[512, 1088]** — 576 units; office **opens at 512** (the minimum). Frame width 1600, virtual screen 1024 (`1600 − 1024 = 576 = 1088 − 512`) | g228, g247, g252 | `[SOURCED]` | not modelled — see §12 |
| Office pan drive | hold-at-edge, **no inertia, no snap**: velocity zeroed every frame (g229), re-derived from touch X; ±8 / ±17 / ±25 units per 16.666 ms at screen X < 290/240/180 or > 734/784/844, × `dt` | g235‑246, g229 | `[SOURCED]` | — |
| **Nothing in the game reads pan position** | no light / vent / attack / animatronic / battery / timer rule tests the view X | exhaustive scan of handles 80 & 73 in frame 3 | `[SOURCED]` | — |

---

## 3. Time, RNG, and the AI table

- **Night clock.** 70 one-second `AM` ticks per in-game hour (g627, 1 tick/1000 ms);
  g629/g630 turn 70 ticks into one hour. Hour 0 = 12 AM. Night = 420 s. The
  `fastNights` cheat (global 3) halves both (g628: 500 ms tick). `src/config.js`
  is the cheat-off branch. `[SOURCED]`
- **RNG generator (2026‑08‑25, from the APK runtime).** `RunLoop/CRun.random`:
  `graine = (graine * 31415 + 1) & 0xffff`, returns `(graine * N) >>> 16`. Absent
  a frame-seed chunk, `CRun` seeds `graine` from the low 16 bits of
  `System.currentTimeMillis()`. `src/rng.js` is the bit-exact port; `sourcetest`
  pins its vectors, scaling, seed truncation, and four disjoint 16,384-state
  cycles. `[SOURCED]`
- **AI table.** g673 zeroes every counter at the start of any night but Custom.
  g674‑684 are the per-night rows, each naming only the characters it changes;
  a row with no hour fires at night start, a later row overwrites only what it
  names. g787 copies the ten Custom Night dials on night 7. Caps run **every
  frame**: g829 (Foxy 17), g830 (Golden Freddy 10), g856‑863 (everyone else 15);
  the Puppet (g815‑821) has no dial and **no cap**. Table application sits below
  every group that reads an AI counter, so a new hour's levels reach the rolls
  on the frame *after* the hour ticks over. `[SOURCED]` — full table in
  `src/config.js:285‑316` (`AI_BY_NIGHT`), rebuild with `packages/source/decompile/aimap.py`.
- **`{oneIn: N}` (Golden Freddy only).** Source's `(Random(N)+1)/N` under integer
  division: 1 with probability 1/N. g804 zeroes GF below night 6 but runs once,
  at night start — so nights 3/4/5 write him at 12 AM and lose it, while **night
  2 writes him at 1 AM and keeps it**. Night 2 is the only sub‑6 night GF can
  appear, at 1‑in‑1000. `[SOURCED]`
- **`peakAi` / `canAct`.** The highest AI a character can hold on a night, read
  off the same rows the engine applies (a `{oneIn}` row peaks at 1 — rare ≠
  impossible; an unnamed character stays 0). This is how a *policy* asks the
  source whether a threat is reachable — Night 1 cannot arm Balloon Boy at all,
  Night 3 sets him to 1 then 2 and merely makes him rare. **A `throw` used to
  conflate "unreachable" with "not seen in this seed".** `[SOURCED]`

Night-6 "2 AM cliff" (g684): WF/WB/WC 5→10, Foxy 10→15, the three Toys switch
on at 5, BB 5→9, Golden Freddy stops being `{oneIn:10}` and becomes a flat 3.

---

## 4. Camera-flash stun — groups 450‑457

**SOLVED (2026‑08‑20, second pass). 400 frames (6.67 s) per flash.** Full audit:
[`ANDROID-CAMERA-STALL.md`](ANDROID-CAMERA-STALL.md).

With the monitor up (`viewing > 0`), the camera light on (`lit? = 1`), and the
`your view` marker overlapping a character, that character's B is set from
`stun time` (**stored handle 132, post-XOR handle 152**), which has `initial =
400` and is **never written anywhere in the program** — all eight occurrences
are reads in g450‑457. B drains by `min(4, frameDelta/16.666)` per frame
(g361‑373, ≈1/frame at 60 fps) and the movement pipeline requires `B = 0`.

| Group | Character | Excluded camera | B ← |
|---|---|---|---|
| 450 | Withered Freddy | `viewing <> 8` (Parts/Service) | `stun time` (400) |
| 451 | Withered Bonnie | `viewing <> 8` | `stun time` |
| 452 | Withered Chica | `viewing <> 8` | `stun time` |
| 453 | Toy Freddy | `viewing <> 9` (Show Stage) | `stun time` |
| 454 | Toy Bonnie | `viewing <> 9` | `stun time` |
| 455 | Toy Chica | `viewing <> 9` | `stun time` |
| 456 | Mangle | `viewing <> 11` (Prize Corner) | `stun time` |
| 457 | Paper Pals | — | `stun time − night·50` (= 50 at night 7) |

- **No rendering / animation / transition term.** g450‑457 require only: marker
  overlap, `viewing > 0`, `lit? = 1`, camera not excluded. g40 writes `viewing`
  and moves the marker atomically on the touch (hitbox-overlap only). The stun
  lands the instant the press registers.
- **`your view` picks *who*; `viewing` supplies the *immunity*.** These are two
  different fields read in different roles in the same group — see §5.
- The exclusions carry **no night condition** — the 8/9/11 gates are absolute.
- `{4, 7, 10}` is a route cut set: every `STALLED` path crosses it within two
  hops, which is why the Minus 7 three-camera loop covers seven characters.
- Model controls (`packages/propose/test/androidstalltest.mjs`, shipped Minus 7 schedule):
  sourced model 200/200 + 100/100 worst-luck; **stall removed 0/200**; marker
  hold alone 0/200. The flash is the strategy's load-bearing mechanism.

---

## 5. Camera selection — two fields, and the double-camera glitch

**`viewing` (counter, handle 55)** = which camera the *UI* thinks is up (0 =
down). Read by: the camera picture and room label (g46‑57, g98‑198), the button
highlight (g46‑57), the flash **immunity** gates (`<> 8/9/11`, g450‑457), the
Puppet's held-light block (`viewing == 11`, g494/g495).

**`your view` (Active marker, handle 126)** = which camera *marker* the player is
parked on. Read by: the flash **target** overlap (g450‑457), the look-hold
cam-stall (g344‑348, g357), the Puppet's camera interference (g498).

Writers:

| Group(s) | Writes |
|---|---|
| g16‑27 (mouse), g39+g40 (touch release on `cameraHitbox`) | `viewing = N`, `your view` → that marker, **and** `cam 01`.v0 = 1 — the three together, only here |
| g45 | `cam 01`.v0 == 1 → clear the latch and set **all twelve** button tiles unlit |
| g46‑57 | `viewing == N` → that one tile lit + room label |
| g262 (monitor down), g911 (mask fully on) | `viewing = 0`. **Marker not moved, latch not set** |
| g263 | `viewing > 0` + every 200 ms → `last viewed = viewing` (the only writer) |
| g1 → child g2 | on raise completion → `viewing = last viewed`. **Marker not moved, latch not set** |
| g3, g4, g486, g487 | frame-start / first-raise defaults — these *do* move the marker (CAM 09, or 07/10 on night 7) |

**The double-camera glitch transfers to Android** (reversed 2026‑08‑26 — was
"no such state exists"). Select camera X, drop the monitor before g263's next
200 ms tick; `last viewed` still holds previous camera Y. Next raise:
`viewing = Y` (picture, label, immunity gate all say Y) while `your view` is
still parked on **X**. Both buttons stay lit because g45 (the only clearer)
fires on the touch latch alone. **Two lit buttons ⇒ `viewing ≠ your view`**,
freshly-lit tile = `viewing`, stale tile = the marker. It **persists** (g263
resamples after the raise); only the next camera *touch* re-syncs.

Payoff (sourced and now exercised in the engine, **not yet observed on-device**): park `your view` on
`cam 9` with `viewing ≠ 9` and a held flash stuns all three Toys through the
CAM 09 immunity (g453‑455); same for `cam 8`/Withereds and `cam 11`/Mangle.
With `viewing == 11` the held light still blocks the Puppet (g494).
`minustoystest.mjs` now gates the consequence: 200/200 normal and 100/100
pinned worst-luck with the split, 0/200 without it. Deliberate device arming is
proved once. **Still open:** repeatability, the empirical window width, and a
Toy stun observed through a glitched marker on the phone.

Forced by a retained classifier frame — `n1-full-1640` (moto g56 5G,
`2.0.7+26`), CAM 04 + CAM 07 both lit, Party Room 4 on screen. Nothing in frame
3 reads the button highlight back. `[SOURCED]` for the mechanism.

---

## 6. Look-hold and marker parking — groups 344‑360

A passed roll sets `A = 1`; g344‑360 resolve `A = 1 → A = 2` (accepted, `C = 10`)
and demand `B = 0` plus:

| Character | Groups | Extra gate |
|---|---|---|
| Withered Freddy | 344/345 | marker not overlapping him (night ≠ 7 drops co-occurrence) |
| Withered Bonnie | 346 | marker not overlapping him |
| Withered Chica | 347/348 | marker not overlapping her |
| Withered Foxy | 349 | none |
| Toy Freddy | 350‑352 | Toy Chica not on `cam 9`; **no marker gate** |
| Toy Bonnie | 353 | none |
| Toy Chica | 354‑356 | Toy Bonnie not on `cam 9`; **no marker gate** |
| Mangle, monitor up | 357 | marker not overlapping her |
| Mangle, monitor down | 358 | `viewing hall light` = 0 |
| Balloon Boy | 359 | none |
| Paper Pals | 360 | marker not overlapping them |

→ Look-hold protects against the **Withereds** and monitor-up Mangle (the
pre-XOR audit had this inverted). Toys are ordered by Show Stage co-occupancy
(Bonnie → Chica → Freddy = their known departure order). Withered gates carry
**no monitor condition**, so a Withered under the last-selected camera stays
held while the monitor is down — FNaF 1 CAM‑4B parking, alive on Android
(needs an on-device sanity check before it becomes trainer doctrine).

---

## 7. Routes, start rooms, and the STALLED table

Re-extracted 2026‑08‑20 from the true-name dump (`route-graph.txt`). Internal
camera ids **equal display CAM labels 1:1**, anchored by five independent
identities (Withereds CAM 08, Toys CAM 09, Mangle CAM 12, BB CAM 10, Puppet
CAM 11) and every vent assignment (TB/WC/Mangle right vent via CAM 06,
TC/WB/BB left vent via CAM 05). The old fitted 8↔9 / 4↔7 / 2↔1 bijection is
retired. `blindA`/`blindB` = `hall stage 1`/`hall stage 2` (markers 120/121),
**off-camera** — no flash can reach a unit standing there.

| Unit | Path | Choke | Kind | Entry gate | Opening rule | lightStallAt | Mutex | Repel → |
|---|---|---|---|---|---|---|---|---|
| Withered Freddy | 8 · 7 · 3 · blindB · office | 1 | blackout | cams up | streak | [2,3] | yes | route start |
| Withered Bonnie | 8 · 7 · blindA · 1 · 5 · ventL | 1 | vent | cams up | streak | [1,2] | yes | CAM 07 |
| Withered Chica | 8 · 4 · 2 · 6 · ventR | 1 | vent | cams up | streak | — | yes | CAM 04 |
| Toy Freddy | 9 · 10 · blindA · blindB · office | 1 | blackout | cams up | streak | [1,2] | yes | route start |
| Toy Bonnie | 9 · 3 · 4 · 2 · 6 · ventR | 2 | vent | **cams DOWN + right light off** (g428) | mask | — | no | CAM 03 |
| Toy Chica | 9 · 7 · blindA · 1 · 5 · ventL | 1 | vent | **none** (g435) | mask | [1,2] | no | CAM 07 |
| The Mangle | 12 · 11 · 10 · 7 · blindA · 2 · 6 · ventR | 2 | vent | cams up | raise (g402/g403) | [3,4] | no | route start |

- **Movement groups** g374‑435, g389‑418; per-hop conditions in the regenerated
  route-graph export. `[SOURCED]`, post-XOR.
- The **mutex** (`office occupied`, ex‑`chicalookatyou`) serializes the final hop
  for W. Freddy, W. Bonnie, W. Chica, Toy Freddy only (final edges require it at
  0: g379/g384/g388/g423; g713‑717 reassert). The other three plus BB bypass it.
- **`lightStallAt`** indices: the outgoing hop needs `viewing hall light` = 0.
  The latch clears on the global one-second tick, *not* on light release. **W.
  Chica and Toy Bonnie have no such gated edge.** `viewing hall light` is
  written by g489 (monitor down + battery + `lit?`).
- Mangle transits CAM 11, where the flash is source-excluded (g456); her pin
  room is CAM 10.
- W. Foxy is **not** in this table — hall stage 1 → straight to marker 123
  (g390), skipping 122. Puppet and Paper Pals roam separately.
- W. Freddy and Mangle each have one 50/50 branch (`decide path`, g376‑377 /
  g396‑397). Paper Pals has a single office hop (g412).

---

## 8. The office encounter, end to end

Full prose: [`ANDROID-OFFICE-ENDGAME.md`](ANDROID-OFFICE-ENDGAME.md). Five
counters and one strict priority list.

| Group | Rule |
|---|---|
| 528/529 | `time allowed` = 50 frames on night 6, 45 on night 7+ (full table §2) |
| 530 | `in danger` 0→1 → `time left = time allowed`, `got you stage = 1` |
| 531 | `time left` counts down per frame (no timer condition) |
| 533 | mask reaches **fully-on** (`mask == 2`, g9, after the 12-frame put-on) while stage 1 → **stage 0, defended** |
| 532 | `time left` hits 0 while stage 1 → **stage 2, failed** |
| 534‑536 | the `blackout` object plays the ~300-frame visible sequence either way |
| 537 | that sequence ending raises `check and move` |
| 538‑555 | the resolution table: **first match wins** and zeroes `check and move` |

- **Endpoint resolution, not live polling.** g538‑555 resolve the *latched*
  defense state at the end of the sequence; they do not poll the mask. **Exactly
  one occupant of marker 122 resolves per encounter**, chosen by group index:
  - defended (stage 0): WF → WB → WC → TF → TB → TC
  - failed (stage 2): WF → WB → WC → TB → TC → **TF** (Toy Freddy swaps ends)
- Defended occupants go to their repel room (table §7) with `B = Random(500)/night`
  (worst luck pins to 0). Failed → marker 123 (`got you box`).
- **Mangle is absent from the table** — her 122 edge is the private raise pair
  g402/g403.
- **`blackout` object (handle 131), four slots:** v0 = the 300-frame counter
  (stays *pinned at 300* after g537 until g536); v1 = overlay flicker duty cycle
  (presentation, g517‑521); v2 = the 250-frame fade-out after the sequence
  (g534‑536; **g845** jumps it to 250 on the first `viewing > 0` after
  resolution); v3 = **dead code** (nothing ever sets it positive).
- **The 249-frame post-encounter lockout (engine gap).** g436 (Toy Bonnie
  overlay roll) and g438 (Toy Chica overlay) both require `blackout` v0 == 0.
  So after a resolved encounter, Toy Bonnie and Toy Chica cannot *start* the
  next one for a further ~4.15 s while the blackout fades — a source
  encounter-to-encounter floor of ~549 frames (~9.2 s) for those two, not 300.
  g845 lets a player throw the grace away by raising the monitor the instant a
  blackout clears (it forces the harsher branch). **Not modelled** — engine
  gives them no lockout. Not a Night 6 headline (the mutex four and W. Foxy are
  unaffected), but the first sourced rule that *rewards* leaving the monitor
  down after a blackout.

### Marker 123 (`got you box`) — a real inside-office state, not the jumpscare

- Mutex four: **50 %** `being attacked by` roll each fully-masked second
  (g556‑559); a later **10 %/s** roll returns them to route with B = 500
  (g747‑750) — attack groups run first, so a same-tick return does not cancel a
  raised danger. Unmasking or lowering the monitor raises danger immediately
  (g560‑567).
- Toy Bonnie: danger on the monitor starting to lower (g568), or every 10
  cams-up seconds (g722).
- Mangle: arms on a **5 %** cams-up second (g729/g730); cams-down then raises
  danger (g731).
- W. Foxy: every 10 s in either monitor state, or instantly on a monitor-down
  hall flash (g571‑573).
- Balloon Boy: **never attacks** — force-clears `lit?` every frame, blocks
  light/camera touches (g96, g75‑88, g301‑320); **no departure group — permanent.**
- `being attacked by` runs the shared **40-frame** countdown to the jumpscare
  (g587‑588). g7/g11 freeze the monitor/mask animation state while it runs —
  which is why a death frame can photograph a half-raised mask.

---

## 9. Same-frame input order, and the forcedown

**Group order is the input order.** Every group that reads a touch and writes
player state, in sequence:

| Groups | What |
|---|---|
| 16‑27 | camera selection (`viewing`) |
| 75‑89 | the flashlight (`lit?`) — hall needs `mask = 0`, `in danger = 0`, no BB at 123 |
| 254‑258 | the monitor button (`flip panel button` → `mmonitorUp`) |
| **262** | **forcedown executes on the monitor**: lowers it, zeroes `viewing` |
| 267‑270 | the mask (`mask` → `mmaskOn`) — needs `being attacked by = 0` |
| **274** | **forcedown executes on the mask**: takes it off |
| 301‑320 | the vent lights (each needs `mask = 0`, `viewing = 0`) |
| 612 | the forcedown flag is cleared |
| 614‑619 / 624 / 718‑721 | …and re-set, so it is always spent one frame later |

Consequence: a monitor press and a mask press made in the same frame as a
forcedown are **both undone** — the monitor before the mask press is even read,
the mask immediately after.

**`drop everything`** is set every 10 s while a mutex-four attacker waits at
marker 122 with cameras up (g718‑721), on any attack start (g624), by the
Puppet reaching 123 (g574), and by the player's own drop button (g614‑619,
touch path only — see below). g612 clears it. Minus 7 never sees it (the four
are stun-locked and never reach 122), which is why its absence went unnoticed;
it is live for every other line and for recovery after a lapse.

- The drop button **cannot take the mask off during an office encounter**
  (`in danger == 0` on the mask arm); the monitor arm has no such condition.
- **The `Multiple Touch` folders are the live Android path; the mouse folders
  are the dead PC path.** g258 (release for `flip panel button` v1) lives only
  in the touch folder; the mouse monitor press (g254) has no equivalent. **When
  citing an input group, cite the touch one.**

---

## 10. Mask, lights, and battery

- **The mask is a 4-state animation counter, not a flag.** 0 off · 1 raising
  (g267/g270) · 2 fully on (g9, at `mmaskOn` frame 12) · 3 lowering (g274). It
  returns to 0 only at g11, behind g10's threshold (**14** frames in the event;
  `config.js` has 15 from the animation-bank rounding). *The post-mask flash
  lockout is the mask-off animation itself.* `[SOURCED]`
- **The mask kills every office light.** `lit?` (g75 hall / g84 touch twin) and
  the vent-light clicks (g302/g304) all require `mask = 0`; camera light
  (g76/g77/g85/g86) has no mask condition because a raised monitor and the mask
  are mutually exclusive anyway. **A masked player can do nothing but take the
  mask off** — the PC "hold CTRL through the mask" trick does not transfer.
- **`in danger = 0` gates every light** — g75 (hall), g76/g77 (camera); g83/g88
  mean the flashlight hitbox does not even register the touch during an
  encounter.
- **Held vent lights do not survive a pan or a mask.** g299 clears both on a
  200 ms timer; only g313 (left) / g320 (right) re-assert them, each requiring
  the tracked touch still *over* the hitbox; g308/g315 drop the tracked id the
  moment it is not. **g313 is the Android left vent light and was not previously
  cited** (the ledger had g301/g303/g320 and skipped it).
- **`mask` press needs `being attacked by = 0`** (g267/g270): once a marker-123
  occupant starts its 40-frame attack, the mask no longer goes on. g560‑562 set
  that counter per unit. (Corrected 2026‑08‑26: the engine had gated on
  `got you stage == 1`, forbidding for the whole reaction window the one action
  g533 says ends it.)
- **No mask storage.** g907 increments `v12` once per one-second event while
  `mask = 2` for Toy Chica, Mangle **and** Balloon Boy; g293 zeroes it on every
  entry into the fully-on state. The five ticks must land in one continuous hold
  — and five ticks span four boundaries, so a hold that goes on just before a
  whole second clears in a little over **4.0 s** (worst phase just under 5.0 s).
  The BB `MASK_STORAGE_CAP` / `MASK_LEAVE_FRAMES` abstraction is retired.
- **Battery:** only `lit?` drains `battery life` (g284, 1/frame). Vent lights
  and the hall light are free. Capacity is set at night start (table §2); the
  `unlimitedPower` cheat (g916, global 2, `GetIni("freddy2","cheats",...)`)
  removes the budget entirely — **nothing in `tools/device` checks the phone's
  `freddy2` INI before a run.**
- **Hall-light movement pin (g848‑854):** the office-light latch rewrites B to
  40 every frame for WF/WB/TF/TC/Mangle; after g488 clears the latch on the next
  one-second event, that 40-frame countdown still drains. **W. Chica and Toy
  Bonnie are the explicit exceptions.**
- A held hall light is rendered **dark** while `hall movement` (300 frames)
  drains, but Foxy's logical light still asserts, D still resets, B still
  pinned — the blackout is visual only.

---

## 11. Per-character subsystems

### Withered Foxy — groups 337, 389‑390, 745, 824‑825, 846, 855, 864, 872‑874, 829

- Roll every 5 s: `21 + Random(0..4) − D ≤ Foxy AI`, operator `≤`. Foxy AI caps
  at **17** (g829), not the shared 15.
- `D` (his aggression accumulator): +1/s unengaged (g824), **+1/s more** while
  masked with the vent/office threshold clear (g825); a blackout pauses it.
  **Zeroed all of night 1 and until 2 AM night 2** (g872‑874). Each 500 ms of
  Parts/Service hall light drains D by 1 (g864). Largest always-safe D = 20 − AI.
- Route: CAM 08 → hall stage 1 (hall light off) → straight to marker 123
  (g389‑390). At hall stage 1 with the light held: `D = 0`, exposure `v9 += 1`
  per frame (g745), B pinned to 50 (g855). `v9 > 100·night` with both lights off
  and B = 0 → retreat to CAM 08 with `B = 500 + Random(500)` and `hall movement
  = 300` (g846). Exposure is **per-frame proportional** — no 1 s quantisation.
- GOT-YOU: at 123, every 10 s regardless of monitor state (g571‑572), or
  instantly on a monitor-down hall flash (g573); gated on no other engagement.
- Once BB is inside (marker 123), `hallLightOn` is a no-op every cycle
  (`!bb.inside` gate), so Foxy's D is never reset again.
- **A hall flash inside the mask-off lockout resets nothing** — g489 →
  `viewing hall light` feeds g745, and the light input is dead until the
  mask-off animation ends.
- A Foxy attack also fires a forcedown (g624).

### Balloon Boy — groups 342, 359, 413‑418, 290‑294, 96

- g342 rolls `Random(20) < BB AI` every 5000 ms with **no monitor / camera /
  light condition** — never blocked. g359 latches `A = 2`, `C = 10`.
- Route **CAM 10 → 07 → 03 → 01 → 05 → in office (122) → got you box (123)**.
  g413 (CAM 10→07) is **silent**; g414‑416 write the vocal register; g416 also
  writes the thud; g417 (CAM 05 → 122) is the **only monitor-gated edge** and
  plays the thud; g607 adds sample 21 on arrival. **`A = 2` is a latch, not a
  moment** — a cameras-down 5 s boundary *defers* the hop to the next completed
  raise (which the music box forces).
- At 122: raise seen → `v6 = 1` (g290); raise completes → marker 123 (g291).
  Five continuous masked ticks (g294) or a masked 10 %/s roll (g292) send him
  back to CAM 10.
- At 123: `lit?` forced to 0 every frame (g96), vent-light clicks stop
  answering (g301/g303), g75/g85 exclude him but g77/g86 do not — **so CAM 10
  keeps its light** — and **no group moves him out.** He never attacks; Foxy's
  unreset D ends the run.
- `onCamsUp()` (g417) sets `bb.inside` the instant the monitor is raised while
  he is still `inOpening`.
- Night-6 raises BB 5 → 9 at 2 AM; Custom-Night AI 20 is unreachable on Night 6.

### The Puppet / music box — groups 494‑497, 404‑411, 623, 574, 652, 638‑660, 645

- **Wind (sourced):** g652 sets `music button` v0 = 2000 at frame start;
  g638/g643 add +5 per held tick (500 ms); g639/g645 snap anything **below 300
  up to 300** before the climb. Empty→full = (2000 − 300)/300 ≈ **5.66 s**. The
  engine did not implement the snap-up until it was flagged — it matters at the
  bottom, where the Puppet rolls every second.
- **Drain (sourced 2026‑08‑26, g653‑660):** `v0` minus a per-night constant
  every 50 ms, gated on `v1 == 0` (not winding) and `v0 > 0`: 2/2/3/4/5/6/6 →
  40/40/60/80/100/120/120 u/s → full→empty 50/50/33.3/25/20/16.67/16.67 s.
  g655/g656 split on `DEMO?` (object 33): night 3 is 60 u/s shipped, 80 in the
  demo. **g653 also carries `time of the night ≠ 12` and `≠ 1`** — night 1's
  box does not drain at 12 AM or 1 AM; it starts at 2 AM. No other night is
  gated. (This corrects the file's long-standing "16.67 s every night from
  t = 0", which priced nights 1‑5 against a box draining 2‑3× too fast.)
- **Escape:** box empty → g494‑497 roll every 1 s (`Random(20) ≤ Sockpuppet AI`,
  stage < 3). Blocked while `viewing == 11` with the light **on** (g494); off
  CAM 11 it rolls freely (g495). **3** successful rolls free him.
- **Route:** CAM 11 → 10 → 07, then `decide path` — 1 → 03 → 01, 2 → 04 → 02,
  both to marker 122 (g404‑411). Five hops on the one-second roll (g496). Then a
  **1‑in‑10 per second** 122 → 123 edge (g623); arrival sets danger and forces
  the monitor down (g574); g587‑588 run the shared 40-frame attack.
- Outside CAM 11, lighting his current camera rewrites B to 10 every frame
  (g774). The Puppet has **no flash-stun group** — the old "CAM 11 flash-stall"
  belief was g457 targeting Paper Pals.
- Puppet AI by night 1/5/8/9/10/15/15 (g815‑821); no dial, no cap.

### The Mangle — groups 357, 391, 456, 400‑403, 729‑731

- CAM 11 is her cam-stall (g357, monitor-up look-hold) and her flash target
  (g456). Route CAM 12 → 11 → 10 → 7 → blindA → 2 → 6 → right vent.
- At marker 122: a monitor raise seen flags her (g402); the raise completing
  sends her to 123 (g403). Five continuous masked ticks return her to route with
  a 10 %/s early roll (g400/g401).
- At 123: arms on a 5 % cams-up second (g729/g730); cameras-down then raises
  danger (g731).

### Golden Freddy — office (g336, 776‑778, 804, 830, 1040/1041) and hallway (779‑781, 865, 875‑881)

- **Office:** g336 rolls `Random(20) < GF AI` on a 5 s interval with the monitor
  raise **finished** and no `yellowbear` present. g830 caps the AI at 10 →
  10/20 is exactly ½. g804 zeroes it below night 6 (see §3 for the night-2
  exception). Mask fully on clears him (g776); he then fades toward alpha 255
  (g1040) and is destroyed (g1041), and g336's roll needs the instance count at
  0 — **so a mask-cleared GF blocks his own respawn until the fade completes**
  (fade *rate* is `UNKNOWN(DoubleExp not rendered)`). Raising the monitor (g777)
  or flashing the hall (g778) with him present is lethal — the sourced form of
  "clear Golden Freddy *before* you press CTRL".
- The old `[CALIBRATED]` 0.3 s "unfair raise" window is **deleted** — g336
  requires the raise to have finished; no group backs the bug.
- **Hallway:** g781 re-rolls `golden` v1 = `Random(10)` **every one-second event
  while the hall light is OFF**; v1 = 1 is the frame that draws him. So his
  presence is re-decided each second — holding the light *freezes* whatever is
  there (this is why he seems to "stay" while you look). g779 adds +1/frame
  exposure while the light is on him and no one is at hall stage 1/2; g780 kills
  above 100 (101 frames); g865 zeroes it when he is absent.
- **`hall movement` (g875‑881):** any hall-routed character overlapping it sets
  300 frames; g881 drains it; g779 needs it at 0 — so for 5 s after anyone
  transits the hallway, GF cannot accumulate hall exposure at all. Implemented.
- GF has **no sound-producing group** — no audio cue exists for him.

### Paper Pals

`Paperpals AI` seeded at 1 with P = 1/100 per night (g822); rolls on the shared
5 s clock; one office hop (g412); flash variant `stun time − night·50` (g457).
The 1/1000-style fractional seeds are Golden Freddy's, not Paper Pals'.

### Which control answers which threat (the `elegance.py` audit, 2026‑08‑26)

`[SOURCED]`, grading-model only — no `sourcetest` case. Every row had been wrong
at least once by naming *one* animatronic for a control that answers several.

| Control | Answers | Groups |
|---|---|---|
| Wind the box | the Puppet, and **only** the Puppet | `music button` v0 written by g638/g639 (both `viewing == 11`), read as a rule only by g494/g495 |
| Select CAM 11 | the Puppet **and Mangle** (parked `your view` stalls Mangle via g357; route CAM 12 → 11 → 10 → 7) | g16‑27, g39+g40; g633/g634, g638/g639; g357, g391 |
| Mask | **eight** characters, not the three Toys: TB g436/g437, TC g439/g440, TF g213, Mangle g400/g401, WF g378, WB g748, WC g749, BB g292/g294, GF g776 | — |
| Mask on **Withered Foxy** | makes him **worse** — g824 ticks D every 1000 ms, g825 ticks it a *second* time per second while masked with nobody at the vent opening | g824, g825 |
| Hall flash | Withered Foxy **and Withered Freddy** — g745 resets W. Foxy's D at hall stage 1, g864 decrements it on CAM 08; **g848/g849 set W. Freddy's B to 40** at hall stage 1/2 (a stun that is not Foxy's) | g489, g745, g864, g848/g849 |
| Hall flash, as a hazard | Golden Freddy (g778 spawns him into `got you box` if visible) and W. Foxy (g573 kills through one already inside) | g778, g573 |

---

## 12. Office pan / display scroll — sourced, and read by nothing

Package 0 of [`plans/10-stock-device-controller.md`](../../plans/10-stock-device-controller.md);
full derivation in `ANDROID-SOURCE-STATUS.md` (2026‑08‑26 sections).

- **Mechanism.** The office view X lives on `camera follow 2` (handle 80) and is
  the *display scroll*, not a camera selection. g252: `viewing = 0` → set display
  X to `camera follow 2`'s X, every frame. g228: start of frame, `v23 = 512`.
  g247: every frame `v23 = Max(512, Min(1088, v23 + v18))`, then X := v23. So it
  is an integrator clamped to **[512, 1088]** — 576 units — and **the office
  opens at 512, the minimum.** `[SOURCED]`
- **Drive.** Hold-at-edge, no drag, no fling, no inertia, no snap target: g229
  zeroes `v18` every frame; g241‑246 re-derive it from the touch's screen X
  (±8 / ±17 / ±25 units per 16.666 ms in three bands, × the `dt` scalar). g235‑238:
  a new touch is the pan touch only if it is over none of the flashlight, mute,
  honk, or light hitboxes. `[SOURCED]`
- **Geometry.** Frame 3 is **1600 × 768** (frame header). Virtual screen 1024
  (g241‑246 thresholds symmetric about 512). `1600 − 1024 = 576 = 1088 − 512` —
  the clamp is exactly "do not scroll past the frame edges", from two
  independent chunks. The 1024×768 virtual screen is **stretched to fill**
  2400×1080 (`physX = sceneX·2400/1024`), not letterboxed — confirmed by two
  phone measurements. `[SOURCED]` width; `[CALIBRATED]` mapping.
- **Nothing reads it.** Exhaustive scan of handles 80 and 73 across frame 3:
  only the groups above, plus g220‑225 (PC mouse edge-pan), g624 (attack stops
  the pan), g1231. **No light / vent / attack / animatronic / battery / timer
  rule tests the view position** — the vent lights (g313/g320) and hall light
  (g83‑86) have no pan condition. **The exact simulator needs no pan state.**
  `[SOURCED]`
- **But the vent-light hitboxes are scene-anchored.** g1223 pins
  `lightLeftHitbox`/`lightRightHitbox` onto the `left light`/`right light` scene
  objects; g1226‑1231 register `honk` / the two vent hitboxes as Perspective
  zones and **re-register them whenever the view is panning** (g1231). The
  flashlight hitbox is at an absolute HUD position and is never re-registered.
  So the vent lights are pan-dependent **in screen space** while the hall light
  is not; a held vent light dies within 200 ms of a pan carrying its hitbox off
  screen. `[SOURCED]` for the groups; `[INFERRED]` for the reachability.
- **A pan does not block other input.** The pan touch (v4), the two vent-light
  touches (v0/v1) and the flashlight touch are four independent slots; g237
  refuses to claim a touch that landed on a light hitbox. The two nights "lost
  to panning" were the **finger missing the hitbox** and landing in the edge
  band, not the game preferring pan over press. `[SOURCED]`
- **The dump's own placement contradicts the phone.** The instance list puts
  `left light`/`right light` at scene X = −274 (an authoring park stack; the pre‑2026‑09‑15 reader said −276) and
  nothing in any of the 33 frames moves them. The phone measures the left LIGHT
  actuable at rest (~149) and Shooter25 independently says ~168. **A placed
  position in this dump is not evidence of a runtime position for a mobile HUD
  object.** The vent anchors' scene X stays `[UNKNOWN]` from source; the
  reachability answers rest on the phone + Shooter25, and the 1600 width (which
  the scene art *does* corroborate) is what made them derivable. Estimated cost
  of a right-vent read: ~427 of 576 pan units, ~285 ms each way `[INFERRED]`.

---

## 13. Sounds — a register bank, and no unique cue

Full audit: `ANDROID-SOURCE-STATUS.md` §"every sound in the Office frame"
(2026‑08‑24). Gate 0 of [`plans/08-audio-cue-controller.md`](../../plans/08-audio-cue-controller.md).

Almost no group plays a sample directly — they write a value onto `cam 01`, and
a small dispatch bank turns it into sound:

| Register | Dispatch | Samples | Written by |
|---|---|---|---|
| `cam 01` v6 | g608‑611 | 21, 24, 23 | BB hops 2‑4 (g414‑416) |
| `cam 01` v21 | g691‑694 | **17** (the movement thud) on any value 1‑4 | 18 groups, 7 characters |
| `cam 01` v5 | g704‑708 | 25‑29 (`Random(5)+1`) | 8 characters at marker 149 |
| `cam 01` v12 | g709‑711 | **30‑32** | Mangle / `new foxy` only, private movement bank from g703 |

- **Sample 17 is shared by 18 state edges across 7 characters** — including BB's
  two mask-clears (g292/g294) and every other vent occupant's (g400/g401,
  g439/g440, g748/g749). Nothing in the audio distinguishes them. This is why
  plan 08 removed the early-unmask action from scope.
- **Loudness is state.** g60 defaults channel 14 to volume **50**; BB's approach
  hops (g414‑416) play at **25**; g906 plays at **60** when he is on the camera
  you are watching (5 %/s roll). So the same three samples carry two meanings
  and level is what separates them — quiet = a route hop, loud = on your feed.
  `packages/propose/parked/minus7/cue/features.py` removes each frame's mean (level-invariant by design)
  and therefore throws that away. g814 replays sample 24 every 2000 ms while BB
  is at marker 123.
- **Mangle's private movement bank:** when `new foxy` (Mangle) overlaps
  `hear footsteps`, g703 writes `cam 01` v12 = `Random(3)+1`; g709‑711 then
  dispatch samples **30‑32** on channel 19. This is a route-movement cue,
  distinct from the shared thud 17 and proximity static 20.
- **Uniqueness:** sample **23** (g610) is the only sole-trigger BB vocal;
 21 (g607/g608) is BB-only but two triggers; 24 also fires for Toy Foxy and BB
  at 123. Mangle is the only character with this private movement bank (30‑32). BB's
  footsteps at marker 149 are `Random(5)+1` from the shared bank.
- **BB's in-office taunt is a *different* sample — 16** — played on every input
  he blocks while at marker 123: flashlight key (g78), flashlight hitbox (g88),
  the vent-light clicks (g302/g304), and g311.
- `mute call` v0 arms **29 s into the night** (g758) — the phone-call mute
  button; closes the 29000 ms timer thread.
- **Under Minus 7 the thud *is* Balloon Boy** — while the stalls hold and the
  box is wound, every other thud writer is one of the seven stun-locked units or
  the Puppet, and W. Foxy / Golden Freddy never write the register. It is the
  loud cue (channel 15, volume 50, vs vocals on channel 14 at 25). This is
  "corroboration of a transition controller state already makes possible", and
  it breaks the moment a stall lapses — assert it per-decision, not per-night.
- **The simulator has been reading a field the phone cannot hear.** `engine.js`
  emits `vent-bang` with a `who`; the source says every such event is sample 17.
  Events now also carry a `sample` field so a controller can be held to what a
  microphone could recover.

---

## 14. Retractions — reversed or corrected findings

| Finding, as first written | Corrected to | When |
|---|---|---|
| Camera-light stall is **dormant** ("counter 152 `time allowed` = 0, dead code") | Pre-XOR handle scramble: handle 152 is the counter stored as 132 = `stun time` = **400**. The stall is live; `STUN_FRAMES = 400` **is** Android-backed. | 2026‑08‑20 |
| The selection gate covers **Toys / Mangle / Puppet** | Inverted — it covers the **Withereds** and monitor-up Mangle; the g360 entity is **Paper Pals**, not the Puppet. | 2026‑08‑20 |
| Every dump's object names | XOR‑28 scrambled — every Toy↔Withered pair swapped. All identity-derived rules re-audited. | 2026‑08‑20 |
| Double-camera glitch **does not transfer** ("one `viewing` counter, one marker, set atomically") | It **transfers** — the selection is two fields and the raise-restore path (g1→g2) writes only `viewing` from a 200 ms-stale `last viewed`. | 2026‑08‑26 |
| `time allowed` by-night values 100..45 are the **camera stun** | They are the **office defense fuse** (`time allowed` → `time left`, g530). The stun is a flat 400. | 2026‑08‑20 |
| Office reaction window = flat **40 frames** every night (cited to g556‑569) | Per-night **100/80/60/55/50/50/45** (g523‑529); g556‑569 is a *different* mechanic (the got-you-box roll while already masked). Night 6 (50) ≠ night 7 (45). | 2026‑08‑26 |
| Golden Freddy **0.3 s "unfair raise"** window (`[CALIBRATED]`) | Deleted — g336 requires the raise to have *finished*; no group backs it. | 2026‑08‑20 |
| Music box drains at **16.67 s every night from t = 0** | Per-night g653‑660 (50 s on nights 1‑2, etc.); night 1 does not drain before 2 AM (g653). | 2026‑08‑26 |
| Balloon Boy is **4 moves** from the office | **5** — CAM 10 → 07 → 03 → 01 → 05 → opening; the first hop is silent. | 2026‑08‑20 |
| BB **mask storage** (banks sub-second mask time across flicks) | No storage — g293 zeroes the tick counter on every entry to mask state 2. Five ticks in one continuous hold. | 2026‑08‑20 |
| The CAM 11 flash-stall is **the Puppet's** | It is **Paper Pals'** (g457); the Puppet has no flash group. | 2026‑08‑20 |
| Vent lights **share the flashlight battery drain** | Only `lit?` drains `battery life` (g284); vent + hall lights are free. | 2026‑08‑20 (2nd pass) |
| Withered Bonnie / Chica repel to their **home rooms** | Mid-route: WB → CAM 07, WC → CAM 04, TB → CAM 03 (g538‑555). | 2026‑08‑20 |
| The engine resolves **whichever unit started the encounter** | Sourced priority list by group index; exactly one occupant resolves per encounter. | 2026‑08‑20 |
| 150/150 monitor-denial reopening | Retracted — g538‑555 resolve a *latched* state at the 300-frame endpoint, not continuous mask polling. Corrected controller: 0/150. | (ledger) |
| `mmaskOff` state flip at **15** frames | Event threshold is **14** (g10/g11); `config.js` `MASK_ANIM_OFF = 15` is the animation-bank rounding — off by one. | 2026‑08‑26 (unfixed) |
| `sweepcheck.py` "every flash lands 68/75" via feed brightness | Withdrawn — the stun has no rendering term; feed brightness measures nothing. Use `camtrace.py` (button highlight driven from `viewing` by g46‑57). | 2026‑08‑26 |
| The simulator's `vent-bang` event carried a `who` field | Every such event is sample 17; no audio detector can recover `who`. `minus6test.mjs` and `hid-device-pilot.mjs --vocal-cam5` used a sensor that does not exist. A `sample` field was added. | 2026‑08‑24 |
| "Minus Toys cannot transfer (no double-camera state, CAM 09 flash-excluded)" | **Withdrawn and corrected.** The sourced split is implemented in the engine; the deterministic split policy clears 200/200 normal and 100/100 pinned-worst seeds, with a 0/200 no-split control. The 2026-08-28 open-loop device attempt failed, while a 2026-08-29 Night 1 calibration removed the previously measured drift/desync explanation only for an unstressed run. The current question is full-policy device transfer under load. | 2026‑08‑29 |
| Frame instances are **not** XOR-scrambled (TYPE vs image, 914/914) | They share the event space: an instance `OI` names `item_table[OI ^ 28]` and its dumped image is the partner's. The 914/914 check compared a row with its own image. Recompiled Office positions match 186/189 by raw handle, 2/189 through the XOR. Every `readdump.py instances` name and box before the fix was the partner's; the vent anchors stay off-frame (X −274), and `lightLeftHitbox`/`lightRightHitbox` have no frame-3 instance. | 2026‑09‑15 |
| Frame instances "share the event space" (`OI` names `item_table[OI ^ 28]`; 186/189 recompile join) | **Corrected again.** The runtime's layout loader reads a placed instance's handle as `readAShort() ^ 48` (`Frame/CLO.load`), then resolves it through the `^ 28` item table: event handle = `OI ^ 48`, row = `OI ^ 44`. The 186/189 join compared the instance chunk with mmfparser's reading of the same chunk. Under the runtime rule all twelve camera markers are placed, the vent anchors are on-frame at (147, 429) and (1444, 427) matching the phone, and the light hitboxes have instances. `readdump.py --lo-xor`. | 2026‑09‑15 |

---

## 15. Open items and UNKNOWNs

- **249-frame post-encounter blackout lockout** for Toy Bonnie / Toy Chica
  (g436/g438 need `blackout` v0 = 0) — real, unmodelled; `src/` is another
  session's.
- **`MASK_ANIM_OFF`** — engine 15, event threshold 14. Unfixed.
- **Same-frame ordering** among non-mutex marker-122/123 occupants beyond the
  group-order anchors — open (only matters for frame-perfect coaching claims).
- **Toy Chica's overlay `chicalookatyou`** created by a still-unexplained
  mask-state-99 branch (g438).
- **Double-camera glitch:** deliberate arming on the device, the real window
  width, any stun observed through a glitched marker, an engine model — all open.
- **Marker parking persists monitor-down** — unambiguous in source, wants an
  on-device sanity check before it becomes trainer doctrine.
- **`freddy2` INI cheats** (`unlimitedPower` g916 / `fastNights` g627 /
  `radarMap` g1104) — nothing in `tools/device` checks the phone's INI before a
  run; the cheapest possible control, not done.
- **`UNKNOWN` from this dumper:** `yellowbear` fade rate (g1040, `DoubleExp`);
  the `radarMap` folder targets and g0's 11 folder switches (`GroupPointer`
  rendered as class name); the identity of global value 8 (g0's gate, nothing
  writes it); `FLAGS 0x8000` / `0x8000` event-flag meaning. All blocked on a
  `packages/source/decompile/EventTextDumper.cs` change.
- **What `night` (object 108) holds during Custom Night** — the 45-frame fuse
  applies to anything the game calls night ≥ 7, but that variable has not been
  read on a Custom Night run. Do not price a 10/20 route against 0.75 s until it
  has been.
- **PC 1.033 cross-platform boundary** — deferred, non-blocking
  ([`PC-DECOMP-CHECKLIST.md`](PC-DECOMP-CHECKLIST.md)).

---

## 16. Coverage and provenance

`packages/source/decompile/coverage.py` classifies all 1332 frame-3 groups and diffs them
against every group number cited in the repo (it **excludes**
`ANDROID-GROUP-MAP.md` itself, so a cluster written up only there stays on the
unread list until its numbers land in `ANDROID-SOURCE-STATUS.md`).

State-writing coverage as of 2026‑08‑26 (2nd pass): **89 %** of state groups,
**86 %** of input groups cited; **37 unread groups** that could in principle
move something, in 15 blocks (g1‑9, g329, g482‑485, g493, g514‑519, g614‑619,
g723‑726, g782‑786, g812, g827‑828, g845, g901‑902, g910, g916, g1040). None is
inside an editor-disabled folder. The nine second-pass clusters resolved to:
one real gap (the blackout lockout, §8), one wrong constant (`MASK_ANIM_OFF`),
five inert/implemented, two dead code.

`sourcetest.ts` runs first in `node tools/test.ts --engine`, one case per
group citation (currently ≈130 cases), and names the failing group rather than
the symptom. **When a row in this file changes, its owning document and its
`sourcetest` case change in the same commit** — otherwise the row is
documentation, not a constraint.

### Where each fact lives

| Subject | Owning document |
|---|---|
| The enforced ledger, every mechanic, retractions | [`ANDROID-SOURCE-STATUS.md`](ANDROID-SOURCE-STATUS.md) |
| Camera-flash stun, look-hold, marker parking | [`ANDROID-CAMERA-STALL.md`](ANDROID-CAMERA-STALL.md) |
| Office encounter, fuse, resolution chain, marker 123 | [`ANDROID-OFFICE-ENDGAME.md`](ANDROID-OFFICE-ENDGAME.md) |
| Coverage map, unread clusters, the blackout gap | [`ANDROID-GROUP-MAP.md`](ANDROID-GROUP-MAP.md) |
| Build identity, the XOR‑28 rule, file format, dump gotchas | [`SOURCE-DUMP-GUIDE.md`](SOURCE-DUMP-GUIDE.md) |
| Every constant, with its comment and label | `src/config.js` |
| The state machines that consume them | `src/engine.js` |
| The stall roster (who Minus 7 stun-locks) | [`../strategy/MINUS-7-STRATEGY.md`](../strategy/MINUS-7-STRATEGY.md) §"Who is *not* stalled" |
| Office pan cost against a policy | [`../../plans/10-stock-device-controller.md`](../../plans/10-stock-device-controller.md), [`../../plans/03-right-vent-camp-mode.md`](../../plans/03-right-vent-camp-mode.md) |
