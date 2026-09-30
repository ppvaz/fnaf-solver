# FNaF 2 — 10/20 Mode: The "Minus 7" Strategy
### Exact input sequence reference

> **What it is:** a 10/20 (Golden Freddy Mode) strategy that keeps **7 of the 10 animatronics
> permanently stun-locked** with the camera flashlight, leaving only Withered Foxy, Golden Freddy
> and Balloon Boy to be handled manually. It is the only human-executable strategy with
> **zero unwinnable RNG** — every loss is a mechanical mistake, not bad luck.
>
> **Android provenance (2026-08-20, corrected same day):** the strategy's core
> number is now **decompile-confirmed on the owned release-7 Android build**: a
> camera flash loads a 400-frame (6.67 s) stall from the never-rewritten
> `stun time` counter (Office groups 450-457). An earlier same-week audit
> declared that path inert; it was reading the wrong counter through the
> runtime's XOR-scrambled handle table. Bonuses from the corrected decode: the
> look-hold pins Withereds (and monitor-up Mangle) while their camera is
> selected — and the marker stays parked when the monitor drops, so ending a
> sweep on a Withered's room keeps holding them monitor-down. No stun works
> while viewing a group's home camera (8 for Withereds, 9 for Toys, 11 for
> Mangle) — irrelevant to the 4-7-10 loop, which never flashes those. Details:
> [`ANDROID-CAMERA-STALL.md`](../android/ANDROID-CAMERA-STALL.md).
>
> **Created by:** Niko Frost, 13 December 2023 (~220 attempts to land the first completion).
>
> **Not for a first 10/20 win.** Niko Frost himself: *"this strat requires a lot of skill and
> time invested, Right Vent Camp is much easier and more consistent; if you do wanna try this
> strat, I'd recommend doing it after you've already beaten 10/20."*

---

## 1. Prerequisites

### Controls (PC)
*(Mobile and console players: controls, timer setup and platform gotchas are in **§10**. Everything else in this document applies unchanged.)*
| Action | Input |
|---|---|
| Raise / lower camera monitor | Move mouse onto / off the **grey Monitor tab** at the bottom of the screen |
| Freddy mask on / off | Move mouse onto / off the **red tab** at the bottom of the screen (next to the Monitor tab) |
| Flashlight (office hall) | Hold **CTRL** |
| Camera light (flash a room) | Hold **CTRL** while the monitor is up |
| Switch camera | **Left-click** the CAM button on the monitor map |
| Wind Music Box | **Hold left-click** on the wind button in CAM 11 |

### A timer is mandatory
The whole strategy is built on 5-second intervals. You cannot do this by ear.

- **LiveSplit** — <https://livesplit.org/downloads/> (recommended; an autosplitter exists)
- **FNaF Timer** (by Shooter25) — <https://gamejolt.com/games/FNaFTimer/936202>
- **Android:** any stopwatch works; a floating/overlay one is best — see §10.2
- **iOS:** the port is overclocked, so you need a *sped-up* timer — <https://youtu.be/IWkCMSa1n9Y> (by brayden). See §10.2

Night length is **7:00**; each in-game hour is **1:10**. Start the timer the instant the night begins.

### Interval notation used below
- `:X2` = any time whose seconds end in **2** → 0:02, 0:12, 1:22, 4:52 …
- `:X7` = any time ending in **7**
- **"5s interval"** = any time ending in **0** or **5** (0:05, 0:10, 0:15 …). This is when *every*
  animatronic gets a movement opportunity, and when Foxy's kill equation is checked.

---

## 2. The three cameras and who they hold

Flashing a camera stuns **everyone in that room for 6.66 seconds**. Every one of the 7 stalled
animatronics has to pass through one of these three rooms, so holding all three with a flash every
~5 seconds means none of them ever advance.

| Camera | Room | Animatronics held there |
|---|---|---|
| **CAM 10** | Game Area | Toy Freddy, The Mangle |
| **CAM 04** | Party Room 4 | Toy Bonnie, Withered Chica |
| **CAM 07** | Main Hall | Withered Freddy, Withered Bonnie, Toy Chica |
| *CAM 11* | *Prize Corner* | *(Music Box — your "home" camera)* |

> **Rendering quirk:** only one animatronic is drawn per camera (CAM 07 usually shows only
> Withered Bonnie). The others are still there and are still being stunned. Don't panic when you
> can't see them.
>
> **CAM 02 is a valid substitute for CAM 04** — both rooms sit on the same route. Toy Bonnie runs
> Show Stage → Party Room 3/4 → **Party Room 2** → Right Air Vent, and Withered Chica takes the
> equivalent Parts/Service → … → Party Room 2 → Right Air Vent path, so either room catches the
> pair. Markiplier ran the whole strategy on `10 / 02 / 07` before switching. **Use
> CAM 04 anyway:** Party Room 2 has an ambient "bring bring" noise that drowns out the hall
> ambience, and the hall ambience is how you know whether Foxy is present — which is how you know
> whether a hall flash is worth the power. Markiplier lost ~100 attempts before working this out:
> *"camera four is a better alternative for trapping Chica and Toy Bonnie, because you don't hear
> the bring bring, so you can know when Foxy is not there, which is very useful information."*

**Do not read an empty hall as a safe hall.** When the flashlight goes blank down the hallway that
means *someone* is in it, and Foxy is invisible whenever another animatronic renders in front of
him. The hall ambience is the reliable cue for whether Foxy is present; the picture is not.

**Also worth knowing:** Balloon Boy *starts* in the Game Area — CAM 10, one of your three
flash targets. You will watch him sitting there, immune, and then leave. That is normal.

**Who is *not* stalled:**
- **Withered Foxy** — immune to camera stun. Handled with the office flashlight.
- **Golden Freddy** — immune. Handled with a mask flick.
- **Balloon Boy** — immune. **This is the entire difficulty of the strategy.**

Because Toy Bonnie is stunned all night, the one source of unwinnable RNG in 10/20 is gone.

---

## 3. Numbers you must know

| Fact | Value |
|---|---|
| Camera-light stun duration | **6.66 s** (400 frames) — so flashes must be **< 6.66 s apart** |
| Movement opportunity tick | every **5s interval** |
| Foxy: safe flash window | within **3 s** after a 5s interval (1.0 s – 4.9 s is safe; **:X2 / :X7 is standard**) |
| Foxy: leaves the hall after | **700 frames** (11.67 s) of cumulative light exposure |
| Golden Freddy (office) | 1/2 chance to appear on **every 5s interval the cams are up**; mask instantly removes him; **flashing the hall while he's in the office kills you** |
| Golden Freddy (hallway) | every 1 s **with the hall light off** the game rolls 0–9; on a **1** he is there. The roll repeats every second, so holding the light freezes whatever is in the hall. Light on him accumulates 1 per frame **only if nobody else is in the hall** — past **100 frames (1.67 s) he kills you** [SOURCED: g781/g779/g780] |
| Blackout mask grace (Night 7) | **0.75 s** (45 frames) — the tightest of any night |
| Mangle, if she reaches the office | **5% chance to kill per second the cams are up** |
| Balloon Boy, if he reaches the office | cannot kill you himself — he **disables your flashlight**, and Foxy does the rest |
| Movement opportunity roll | `random(1..20) ≤ AI level`. At the 15 AI cap that is **75%**, for every regular animatronic — exactly BB's documented 3/4 |
| Pathing | animatronics never roam: each walks a **direct path to your office**. Only Mangle and Withered Freddy branch (one 50/50 each). This is *why* three chokepoint rooms are enough to hold seven of them |
| Office animatronic queue | several can wait in your office at once, but **only one blackout can fire per 10 s** |
| BB: movements needed to reach your vent | **5** (3/4 chance each, on 5s intervals) — CAM 10 → 07 → 03 → 01 → 05 → opening. His first move is **silent** [SOURCED: g413-417], which is why it is counted as four |
| BB: 3rd laugh | he is in the **left vent camera** (CAM 05) — first vent-bang cue; source-wise this is his 4th move |
| BB: 4th laugh | enters the **vent opening / blind spot** — second vent-bang cue. **Only possible while the cams are up** — and a roll passed with the cams down is banked, not lost, so it lands on your next raise |
| BB: leaves the vent | guaranteed after **5 s cumulative mask time**; ~1/10 chance per cumulative second to leave early (~34% chance of an early leave) |
| Your reaction window on a full-length BB attack | **~0.7 s** to un-mask, raise cams and re-flash |
| Total flashlight budget on Night 7 | **3000 frames = exactly 50 seconds of light** (each power bar = 600 frames; at 0 bars you still have 600). The indicator starts blinking rapidly at **500 left** |
| Light budget per second of night | **119 ms** — 420 s of night ÷ 50 s of light = 1 second of light per 8.4 seconds survived |
| Foxy: light needed to dismiss him | **~11 s** total exposure, typically split as a 5 s round + two 3.5 s rounds |
| Music Box: full → empty | **16.67 s** — internally a value of 2000 losing **6 every 50 ms** on Nights 6–7 |
| Music Box: empty → full while winding | **~5.66 s** |
| Music Box: winding tick | one tick every **0.5 s** — usable as a metronome |

### 3.1 Why `:X2` and not `:X0` — Foxy's D arithmetic, and the device route's one-frame phase island

*(Measured 2026-08-26 **in the simulator**, against `AI_BY_NIGHT`. No device.)*

The kill roll is `21 + Random(0..4) - D <= foxy AI`, so the largest D that is
**always** safe is `20 - AI`:

| Foxy AI dialled | 0 (N1) | 1 (N2) | 2–3 (N3) | 5–7 (N4/N5) | 10 (N6 12–2 AM) | 15 (N6 2 AM+) | **17 (10/20, dial 20 capped at g829)** |
|---|---|---|---|---|---|---|---|
| largest always-safe D | 20 | 19 | 17 | 13 | 10 | 5 | **3** |

D is zeroed on any frame the hall light is on with Foxy in the hall, then
climbs +1 per second (+1 more per masked second when no vent opening is
occupied). So D at a 5 s check is just *the whole seconds since the last lit
frame*, plus one for the cycle's prophylactic mask. Flashing at `:X2` — two
seconds after the interval, three before the next — lands D = 3. That is why
the table above says `:X2 / :X7` and not "as soon as the interval passes":
**at the 10/20 cap there is no margin at all, D = 3 is the last safe value.**

The emitted device route (`packages/propose/bin/plans/recipe.mjs`) flashes at cycle **+3100
ms**, which is 0.28 s *after* its 5 s check, not 2 s after — so 4.7 s of D
accrues before the next check and the designed cadence is **D = 5**. D = 5 is
safe on every night up to Foxy AI 15, and fatal at 17. On Night 7 the route
nevertheless replays 100/100 exactly, because of an accident nobody wrote down:
the sweep's last camera-light hold is still down on the single frame the next
cycle's opening monitor tap drops the cams, `hallLightOn` is true for exactly
that one frame, and D is zeroed a second time. Removing it takes D from 3 to 5.

That is a **one-frame phase island**, and it is bounded on both sides:

| shift applied to one plan row | exact Night 7 replay |
|---|---|
| cycle-opening `tap monitor`, −40 … +8 ms | 20/20 |
| cycle-opening `tap monitor`, **+16 ms** (one frame later) | **0/20** |
| trailing `sweep`, 0 … +40 ms | 20/20 |
| trailing `sweep`, **−8 ms** (one frame earlier) | **0/20** |

Night 6 only halves (20/20 → 10/20) under the same shift, because AI 10/15
tolerates D = 5 and only the post-2 AM hours do not. This is exactly what
`packages/propose/bin/plans/human-gate.mjs` exists to refuse: precision, not speed, is what
separates a human from a machine, and no hand holds a one-frame phase.

**Follow-up, 2026-08-27 (simulator; see `plans/PROGRESS.md` item 11).** The
emitted device plan replays **400/400 with no jitter on every night 1-7**,
Night 7 included — the schedule is correct and the sub-70 human-gate ladder is
entirely an iid-±60 ms robustness result. The fragile row is the attack
cycle's post-mask Foxy reset at `off + s(0.25)`, which is **exactly
`MASK_ANIM_OFF`** (15 frames): under independent per-row draws it lands inside
the mask-off animation about half the time and `hallLightOn` never asserts.
It cannot simply be delayed — the sweep at `off + s(0.45)` is pinned by the
400-frame Withered stun budget (pushing it 7 frames collapses nights 5-7 to
inside-office). A hall pulse fired *during* the read is a valid reset
(`lightHeld` ⊥ `ventLightL`) but is blocked by Golden Freddy spawning at the
attack cycle's monitor-up recovery check. The live levers are the
bang-anchored `off` (PROGRESS item 10) and new device budget (item 8).

---

## 4. Start of the night — exact inputs

```
0:00.0   Night starts → START TIMER
0:00.1   Mouse to Monitor tab            → cams up
0:00.2   Click CAM 11                    → Prize Corner
0:00.3   Hold LMB on wind button         → wind the box
  ...    keep winding
0:07.0   Release, click CAM 10 + tap CTRL
         click CAM 04 + tap CTRL
         click CAM 07 + tap CTRL         → first stun of all three rooms
0:07.5   Click CAM 11, hold LMB, drag onto the wind button, keep winding
  ...    wind until 0:12 → enter the MAIN CYCLE
```

> Do **not** flash the office hallway until you hear the Foxy ambience (the hall "presence" hum).
> Flashing an empty hall early can trigger a hallway Golden Freddy death and wastes power.

---

## 5. The main cycle (repeat every 5 seconds, forever)

You are on cameras across the 5s intervals, so Golden Freddy gets a coin-flip every cycle —
**the mask flick is not optional.**

**One cycle, at `:X2` (and again identically at `:X7`):**

| Step | Timer | Input |
|---|---|---|
| 1 | `:X2.0` | Move mouse **off** the Monitor tab → cams drop |
| 2 | `:X2.2` | Move mouse **onto the red mask tab**, then straight off → mask flick (kills Golden Freddy) |
| 3 | `:X2.4` | **Tap CTRL** → flash the hall (resets Foxy's variable D to 0) |
| 4 | `:X2.6` | Mouse **onto the Monitor tab** → cams up |
| 5 | `:X2.8` | **Click CAM 10 → tap CTRL** |
| 6 | `:X3.0` | **Click CAM 04 → tap CTRL** |
| 7 | `:X3.2` | **Click CAM 07 → tap CTRL** |
| 8 | `:X3.4` | **Click CAM 11**, hold LMB, drag the cursor onto the wind button |
| 9 | `:X3.5 → :X7.0` | **Wind the Music Box** |
| 10 | `:X7.0` | Repeat from step 1 |

**Order rules that matter:**
- **Mask before flashlight.** Golden Freddy must be cleared *before* you press CTRL, or the flash kills you.
- The three cams can be flashed **in any order** — pick one order and never change it. `10 → 4 → 7`
  is the common choice and leaves you on CAM 07, which matters during a BB attack (see §6).
- **Hold left-click** while dragging from the CAM 11 button to the wind button. Releasing and
  re-clicking is how people accidentally click CAM 12 and break the whole run.
- Flashes at `:X2` and `:X7` are **5.0 s apart** — comfortably inside the 6.66 s stun. All of your
  safety margin lives in that 1.66 s.

---

## 6. Balloon Boy attack — the part that kills runs

BB laughs on every successful movement. Laughs 1 and 2: **do nothing, keep the main cycle running.**

### Phase A — after the 3rd laugh (first vent bang: BB is in the left vent camera)

Goal: **have the cams DOWN across every 5s interval**, because BB's 4th movement can only execute
while the cams are up.

> **What the source actually does** [SOURCED — g342/g359/g417, see
> `ANDROID-SOURCE-STATUS.md`]: the 5 s movement roll is never blocked, and a passed roll is
> *latched* (`A = 2`) until it can be spent. Only the hop into the vent opening checks the
> monitor. So cams-down across the interval **defers** BB's move rather than preventing it — he
> takes it the moment your next monitor raise completes. Counting is also off by one: his first
> move (CAM 10 → 07) is silent, so "three laughs" is his *fourth* move landing on CAM 05 and the
> monitor-gated one is his fifth. The procedure below is still right,
> because the deferral hands you the *timing*: he arrives when you choose to come up, prepared,
> instead of mid-cycle. What does not work is the tempting extrapolation — "stay down across
> every interval forever and he can never move." You have to raise to wind the box, and he is
> waiting when you do.

```
:X2 or :X7   Drop cams → mask flick → tap CTRL (Foxy) → cams up
             → flash 10, 4, 7 → CAM 11 → wind
:X4 or :X9   DROP THE CAMS (before the 5s interval) — a short wind is fine
             (no mask needed on this drop: cams were not up on the 5s interval)
:X5 / :X0    the interval passes with cams down → BB cannot move
just after   Cams up, resume winding
```

- If **no 4th laugh** when you raise the cams: wind, flash `10, 4, 7` at ~`:X2`/`:X7`, keep winding,
  flash the hall and drop the cams again **before the next 5s interval**. Repeat this holding
  pattern until the 4th laugh comes.
- Niko Frost's original wording for this phase: *"once he gets into your vent, you will have to get
  off at the 6 second or the 1 second, then flash Foxy and the 3 cameras, wind the box, and making
  sure to put down the camera before Balloon Boy gets to move."*

### Phase B — the 4th laugh (second vent bang: BB is in the vent opening)

He will enter your office the next time the cams go up unless you mask him out. From here you are
on a stopwatch: the 3 cams must be re-flashed before their 6.66 s stun expires, and BB can hold you
in the mask for a full 5 s.

```
:X2 or :X7   HOLD CTRL DOWN and keep it held for this entire sequence
             Click CAM 10  (flashed)
             Click CAM 04  (flashed)
             Click CAM 07  (flashed) ← leave the monitor here
             Move mouse off the Monitor tab → cams drop
             (holding CTRL means the hall is flashed as the cams fall — Foxy is handled)
             Move mouse onto the red mask tab → MASK ON
             Keep CTRL held: the flashlight costs no power while the mask is on
```

Then, **react to the vent-bang cue that means BB left**:

> **Source note, 2026-08-24 (revised same day).** BB's departure plays sample
> 17, the movement thud that 18 state edges across seven characters share. A
> first pass concluded from that alone that the cue is ambiguous — which is true
> of the game in general and **false of this strategy**. Every other writer of
> that sample is one of the seven this line keeps stun-locked, or the Puppet,
> whom a wound box keeps in Prize Corner; W. Foxy and Golden Freddy never write
> it at all. So while the stalls are current and the box is wound, the bang is
> Balloon Boy, exactly as practised. The dependency is worth stating explicitly:
> it is the *stall discipline* that makes the cue readable, so a lapsed stall
> costs you the cue as well as the flash. See
> [`ANDROID-SOURCE-STATUS.md`](../android/ANDROID-SOURCE-STATUS.md).

```
On the bang  Mouse off the mask tab            → mask off
             Mouse onto the Monitor tab        → cams up
             Click CAM 10   (already lit — CTRL still held)
             Click CAM 04
             (CAM 07 needs no flash: you left the monitor on it and CTRL is held)
             Click CAM 11 → hold LMB → wind
             → return to the MAIN CYCLE at the next :X2 / :X7
```

- **If BB leaves early** (before the full 5 s): un-mask, then **wait** for the next `:X2`/`:X7`,
  flash Foxy, flash the 3 cams, wind, resume the main cycle. Don't rush an off-cycle flash.
- **If BB takes the full 5 s** (~60–66% of attacks): you have roughly **0.7 seconds** between his
  leaving cue and the stun expiring, and that budget has to absorb the mask-off animation (~0.25 s)
  and the monitor-raise animation (~0.25 s). Leaving the monitor parked on CAM 07 with CTRL held is
  what buys you the third flash for free.

> **Android caveat [SOURCED — g75/g84/g302/g304]:** the held-CTRL trick above is PC-only. On the
> modern Android build every office light — hall and both vents — is gated on `mask = 0`, so the
> mask turns the flashlight off outright and a masked player can do nothing but unmask. Budget the
> whole mask window as time Foxy is uncovered.

> TheBones5's description of this moment: *"think of Balloon Boy's attacks like one of those
> western cowboy duels where they have to wait until someone says fire — it's a battle of pure
> reaction time and speed under insane pressure."*

---

## 7. Power management (this WILL end runs)

Minus 7 flashes constantly and 10/20 gives you 3000 frames of light. Greenrunning matters.

- **Budget: 119 ms of light per second of night.** 50 seconds of flashlight has to cover 420
  seconds of night. If you are averaging more than about an eighth of a second of light per second
  survived, you will black out before 6 AM. This is the single most useful number to keep in your
  head, and the trainer displays it live.
- **Tap, never hold** (except during a BB attack, where the mask makes the light free).
- Once you press CTRL, the game counts the light as "on" until the end of that second-interval for
  Foxy's exposure counter — but power only drains while the button is physically held. So
  **flash early within a second** (e.g. at `:X2.1` rather than `:X2.9`): you get up to a full
  second of Foxy exposure for a single frame of power. Markiplier measured this directly:
  a tap at the top of a second banks **~50–60 units** of Foxy exposure, and a tap later in the
  second banks proportionally less. Holding the button longer buys you *nothing* extra that second
  — it only costs power.
- **Input hardware matters more than you'd think.** A key's travel time counts as "held". On PC,
  Markiplier's conclusion was that binding the flashlight to a mouse button would make 10/20
  "pretty trivial"; on mobile the equivalent is keeping a thumb resting on the light button so a
  tap is a tap and not a press-and-drag.
- **If the hall ambience is gone, Foxy is in Parts & Service — do not flash the hall.** That is
  pure wasted power, and it happens 3–5 times a night once he's been driven out (700 frames of
  exposure sends him back). Trust the *ambience*, never the picture — a blank hallway means someone
  is standing in it, and others render in front of Foxy while he is still there.
- When Foxy is away, you can also stay on the cams longer without dropping to flash.

---

### Emergency: the box is about to run out

If the box empties, the Puppet starts rolling to advance every 1 s. **Holding the camera light on
CAM 11 across a 1 s interval makes that roll fail.** So the moment you see the red warning triangle,
flash the Prize Corner light as you raise the cams — it can stall the Puppet just long enough to get
a wind in. Once the Puppet actually leaves CAM 11 the box is unrecoverable, and worst case he
reaches you 20–25 s after a full box runs dry.

---

## 8. Advanced variant — the "Mask Storage" cycle

> **Android caveat [SOURCED — g293/g907]:** on the modern Android build the vent-occupant mask
> counter is zeroed every time you re-enter the fully-on mask state, so nothing is banked between
> flicks — Balloon Boy, Toy Chica and Mangle each need their five ticks inside **one continuous
> hold**. Five ticks span four boundaries, so a well-phased hold clears in a little over 4.0 s
> rather than 5.0 s. Treat the storage cycle below as PC-only.


Discovered by chudbud / Regi (2025), used for Worst-Luck Minus 7. Full BB attacks actually last
**4.017 – 5.000 s**, because up to 59 frames of mask time can be *stored* from earlier mask use.
The classic cycle can't track that, which is why some attacks feel impossible. This variant keeps
0.5–0.6 s of stored mask time banked before every attack, and dodges Golden Freddy entirely by
never having the cams up on a 5s interval.

**Start of night:** mask on for ~0.6 s → cams up → wind → drop cams before `0:05` → cams up after
the interval → begin the main cycle.

**Main cycle:** flash the 3 cams → wind → drop cams and flash the hall at `:X4` or `:X9` → cams up
after the 5s interval → repeat.

**1st vent bang:** continue as normal.

**2nd vent bang:** after raising the cams and hearing the cue, flash the 3 cams fast and mask up,
flashing the hall while masking. Flashing at `:X1` or `:X6` is 100% safe. React to BB's leaving
cue (see the 2026-08-24 note above: the bang is his *while the stalls hold*) →
un-mask, flash the cams → wind over the 5s interval → drop cams at `:X5.5` → mask flick for
Golden Freddy (**only 0.1–0.2 s**) → flash the hall at `:X1`/`:X6` → cams up → flash the 3 cams →
wind → drop before the 5s interval → restart the main cycle.

The 0.1–0.2 s Golden Freddy flick is what tops the stored mask time up to 0.5–0.6 s. Never let it
exceed ~0.7 s: past 1.0 s it resets and you're back to unpredictable attack lengths.

---

## 9. Markiplier's timer-free variant (July 2026)

In November 2025 TheBones5 published a technical analysis concluding that Markiplier's famous
December 2014 10/20 completion was not legitimate. Markiplier accepted it — *"I cheated. For 12
years I have been living a lie"* — and rather than copy an existing strategy, re-derived one from
scratch, streaming ~4.5 hours of attempts before winning on 31 July 2026. What he arrived at is,
in his own words, *"a strategy called Minus 7, or a modified version of it."*

The modifications are worth knowing, because they attack the two things that make canonical Minus 7
painful: needing an external stopwatch, and Foxy competing with Balloon Boy for the same window.

**1. No external timer — the music box is the metronome.** The box winds in audible ticks at
**0.5 s intervals**, so it is a free in-game clock. Markiplier: *"if you start counting as soon as
you start winding, you can go five, wind four, that's three winds, and then by the time you put the
camera down you'll have 3.5 seconds to flash Foxy."* NaiveStorm's analysis puts it plainly: the
changes are *"what will actually make it work without using an external timer."*

**2. Evict Foxy instead of suppressing him.** Canonical Minus 7 flashes the hall at `:X2`/`:X7`
all night purely to keep D at 0. Markiplier instead spends **~11 s of cumulative light in a
5 s + 3.5 s + 3.5 s pattern** to push Foxy past the 700-frame exposure threshold and send him back
to Parts & Service. Once he is gone the hall flash requirement disappears entirely — and with it
the rule that you must drop the cams every 5 seconds.

**3. Align Foxy's nap with Balloon Boy's arrival.** This is the actual insight. The eviction is
timed so Foxy is asleep exactly when BB reaches the vent, which means **you can sit on the cameras
for well over 5 seconds** during the attack: flash the three cams, mask, un-mask, re-flash, and
refill the box, without a hall flash competing for the same 0.7 s. NaiveStorm: *"That's the entire
change of his strategy — this moment in the cameras where he just spends more than 5 seconds in
there."* Markiplier: *"You are trying to align Foxy's dismissal with Balloon Boy's arrival."*

**4. Pick cameras by sound, not just coverage.** He ran `10 / 02 / 07` for ~100 failed attempts
before realising CAM 04 covers the same pair as CAM 02 without Party Room 2's "bring bring"
ambience masking the hall cue that tells you whether Foxy is even there. See §2.

### Is it better?

**No — it is more accessible, not more consistent.** Canonical Minus 7 with a timer is the version
with provably zero unwinnable RNG. The timer-free variant trades that guarantee for not needing a
stopwatch, and it is unforgiving about power: Markiplier's winning run ran the flashlight dry near
the end, D climbed unchecked, Foxy's `GOT YOU` flag set, and Foxy jumpscared him on the 10-second
interval at exactly 7:00 — he won and got killed in the same frame. NaiveStorm reconstructed the
whole thing: *"his flashlight running out between 46 and before 50 essentially meant that he had a
guaranteed Foxy jumpscare at 6 AM."*

Take from it the eviction pattern and the metronome trick; keep the timer.

---

## 10. Playing Minus 7 on mobile

Minus 7 is confirmed on mobile. First mobile victor: **S Fnaf Fan** (23 Jan 2025); second:
**ahmedfouad** (7 Oct 2025, ~2 hours of attempts); a **no-sound** mobile completion followed in
Feb 2026. It has also been done on **Old Mobile** (Bogdan141F, Jul 2025) and on console
(PS4/Xbox/Switch) — S Fnaf Fan: *"Yes you can do it on PS4. There are some console victors for
this strategy. You have to be fast with it so they don't break loose."*

### 10.1 Controls

| Action | Input |
|---|---|
| Raise / lower monitor | Tap or swipe the **grey/white arrow** at the bottom of the screen |
| Freddy mask on / off | Tap or swipe the **red arrow** next to it |
| Flashlight (office hall) | Hold the on-screen **flashlight button** |
| Camera light | Hold the **light button** while the monitor is up |
| Switch camera | Tap the CAM button on the map |
| Wind Music Box | Hold on the wind button in CAM 11 |

The whole input sequence in §4–§6 is otherwise identical — the same `:X2` / `:X7` cycle, the same
`10 → 4 → 7` order, the same BB phases.

### 10.2 Timer setup — this is the one thing you must get right

**The game speed is not the same on both platforms.**

- **Android:** runs at normal speed. Use **any ordinary stopwatch**. A floating/overlay stopwatch
  is strongly recommended so you can see it without leaving the game — the mobile victors use
  **Floating Stopwatch** (`de.jentsch.floatingstopwatch`) on the Play Store, or a second device.
- **iPhone / iOS:** the port is **overclocked** — it runs faster than real time, so a normal
  stopwatch drifts off cycle within a minute and you will die to Foxy for no visible reason. Use
  **brayden's sped-up iOS interval timer**: <https://youtu.be/IWkCMSa1n9Y>. (brayden, confirming:
  *"android does not [overclock], only iphone. Just use a normal stopwatch on like Google or
  something for android."*)
- Start the timer the frame the office fades in. A commonly recommended tweak with the iOS timer is
  to start it at **0:01** rather than 0:00 to line the cycle up.

### 10.3 What is harder on mobile

- **The flashlight is the killer, not the cameras.** ahmedfouad: *"The main thing here is that the
  flashlight is so tedious on mobile and I can't tell you how much I lost due to misclicks."*
  Tapping the CAM buttons is actually **easier** than mouse-flicking on PC — it's hitting the light
  button repeatedly under pressure that fails.
- **Power.** Multiple mobile players report burning the whole flashlight by 3 AM. Every rule in §7
  matters twice as much here: taps only, never flash an empty hall, flash early within the second.
- **No hotkeys.** Every action is a screen tap, so overlapping inputs (holding the light while
  dropping the cams) is more awkward than on PC. During a BB attack, keep one thumb parked on the
  light button.
- S Fnaf Fan's speed tip: *"You could also try to flash the very first frame you take the mask off
  to save a bit more time — but be careful of your flashlight."*

### 10.4 Version-specific gotchas

- **Android — the "unfair" Golden Freddy jumpscare.** Bogdan141F: *"He does that if the monitor is
  being pulled up right before a 5-second interval, so you just shouldn't do it, and you will get
  fair gameplay."* Never begin the monitor-raise animation in the last fraction of a second before
  `:X0` / `:X5`.
- **Old Mobile (original 2014 port) is much easier for this strat** — BB is guaranteed to leave
  after **2 seconds** instead of 5, which removes the entire reaction-time bottleneck. Night length
  is also inconsistent between runs on that version.
- **Old versions had mask delay and roughly doubled aggression.** Current mobile versions have no
  mask delay (S Fnaf Fan: *"There is no more mask delay in the newer versions, so that wasn't a
  problem"*), and the strategy still works on the newest release.
- **No-sound runs:** without audio cues you must watch **CAM 05 (Left Air Vent)** to see BB, and
  treat every attack as worst-luck (assume the full 5 seconds).

---

## 11. Community feedback — what actually goes wrong

- **Niko Frost:** ~220 attempts for the first completion. *"Being off for even a few milliseconds
  will cause the animatronics to be free from their stun, and the run is over. This is where most
  of my runs failed, because being fast can lead to you making lots of mistakes."*
- **Shooter25:** *"This strat is 100% skill based and a perfect player would never lose, but it is
  EXTREMELY difficult, so I wouldn't recommend it for beating the mode the first time."*
- **brayden:** *"Battery life is actually a really big problem — coming from someone whose last 40ish
  10/20 wins have all been 4 bars, then going to this hardly being able to save enough to win."*
  His rebeat took 12 minutes after a ~2 hour first learn.
- **TheBones5** (5th recorded completion): *"significantly harder than Sister Location's 10/20."*
- **Misclicking a camera** during the 3-cam flash is the single most cited death cause. Fixed cursor
  path + fixed order + click-drag from CAM 11 to the wind button are the standard fixes.
- **Mobile:** several players report running out of flashlight by 3 AM, and older versions have a
  buggier Golden Freddy. It is still very much doable — see §10.
- **Why not "Minus 8"?** BB cannot be stunned by any means, so 8/20-maskless is impossible.
  (Niko Frost: *"If you could stall Balloon Boy somehow, then you could do 10/20 without using the
  mask."*)

---

## 12. Suggested practice ladder

1. **Custom Night 6-9/20 with BB off** — pure main-cycle drilling. This is how Niko Frost first
   validated the strategy; a clean run should have **zero blackouts**.
2. Add BB back at low AI to practise Phase A (cams down across the 5s interval) in isolation.
3. **FNaF 2 Practice Mod** (Shooter25) — <https://gamejolt.com/games/Shooter25Mods/826595> —
   for repeatable BB-attack scenarios.
4. Drill Phase B on its own: the un-mask → cams up → CAM 10 → CAM 04 motion needs to be under
   0.5 s from muscle memory before full 10/20 attempts are worth it.
5. Only then run 10/20 with a live timer.

---

## Sources

- [Niko Frost — *FNaF 2 - 10/20 mode, but 7 animatronics are completely disabled (Minus 7 Strat)*](https://www.youtube.com/watch?v=Qy_0rQzg_pg) — original strategy, full written breakdown in the description
- [TheBones5 — *How Players REMOVED Randomness From FNAF's LUCKIEST CHALLENGE*](https://www.youtube.com/watch?v=T_ALUj7WOCw) — strategy history + AI mechanics (transcript extracted)
- [Sabotaged Blake — *FNAF 2 10/20 Advanced Guide (Deep AI Breakdown)*](https://docs.google.com/document/d/1BmiXHb57TpG50CJGtpnelXQjFavuMQ5GE3G-UjWbE68/edit) — Minus 7 main cycle, BB attack, power, Foxy's variable D
- [Shooter25 — *FNaF 2 - 10/20 Mode w/ MINUS 7 STRAT*](https://www.youtube.com/watch?v=K9IriMm7mgI)
- [brayden 2 — *FNaF 2 - 10/20 Mode No Vent Lights (Minus 7 Strat)*](https://www.youtube.com/watch?v=kUSxAdquuJ4)
- [Phantom1600 — *Provando que FNAF 2 não precisa de sorte | Estratégia Minus 7*](https://www.youtube.com/watch?v=nP2Sdhq-6K4) — camera/animatronic mapping (transcript extracted)
- [sabotagedgamerz — *Worst Luck 10/20 Minus 7 (Mask Storage Strat)*](https://www.youtube.com/watch?v=OXToTwvUtWQ) — the Mask Storage variant
- [TheBones5 — *How FNAF 2 Works: Complete Guide/AI Breakdown*](https://www.youtube.com/watch?v=FizTzjyGP3U) — hall-cue caution, Puppet stall, office queue (transcript extracted)
- [jerakaigamez — *Dissecting The AI Of FNAF 2*](https://www.youtube.com/watch?v=h8LfVNGWqn8) — flashlight and music-box internals, hallway Golden Freddy, per-animatronic paths and leave chances (transcript extracted)
- [brayden — *A Brand New FNaF 2 Strategy (Guide + FNaF 2 Bot)*](https://www.youtube.com/watch?v=EYtIOKRuQqE) — the Brayden strat and the practice mod (transcript extracted)
- [FNaF Wiki — Camera Monitor](https://freddy-fazbears-pizza.fandom.com/wiki/Camera_Monitor/Gallery) and [Freddy Mask](https://fivenightsatfreddys.fandom.com/wiki/Freddy_Mask) — camera numbering and controls
- [Steam Community — *Ultimate FNaF 2 Guide*](https://steamcommunity.com/sharedfiles/filedetails/?id=2401252577) — control reference

**Markiplier's variant:**
- [Markiplier — *Five Nights at Freddy's 2: 10/20 COMPLETE (no cheats)*](https://www.youtube.com/watch?v=M3H8u3Y0S-s) (31 Jul 2026) — the win, with his full mechanics breakdown (transcript extracted)
- [Markiplier — *Five Nights at Freddy's 2: Markiplier's Redemption*](https://www.youtube.com/watch?v=AH5jwKkCS7M) (15 Jul 2026) — the 4.5-hour attempt stream
- [TheBones5 — *Did Markiplier CHEAT his FNAF 2 10/20 Win?*](https://www.youtube.com/watch?v=SjK7M0LRbqw) (14 Nov 2025) — the analysis that prompted the rerun
- [NaiveStorm — *I Analyzed Markiplier's New 10/20 Completion After 12 Years*](https://www.youtube.com/watch?v=6PUK3swijjU) (4 Aug 2026) — diff against canonical Minus 7, and the 6 AM Foxy reconstruction (transcript extracted)
- [Markiplier — *10/20 Mode COMPLETE!!*](https://www.youtube.com/watch?v=A9qPj-YJcN8) (14 Dec 2014) — the original, disowned run

**Mobile / console:**
- [S Fnaf Fan — *FNaF 2 Mobile 10/20 Minus 7 COMPLETED*](https://www.youtube.com/watch?v=9dryWgOlYGY) — first mobile victor, plus Q&A in the comments
- [S Fnaf Fan — *FNaF 2 Mobile 10/20 Minus 7 NO SOUND VERIFIED*](https://www.youtube.com/watch?v=Ku0mFze03IA) — CAM 05 tracking for BB
- [ahmedfouad — *FNaF 2 - 10/20 Minus 7 Mobile (2nd Victor)*](https://www.youtube.com/watch?v=L3CfrdkJPt0) — flashlight misclick problem, Android timer app
- [Bogdan141F — *FNaF 2 Old Mobile - Beating 10/20 using MINUS 7*](https://www.youtube.com/watch?v=hpZ8b_th1h4) — Old Mobile 2-second BB, Android Golden Freddy fix
- [brayden — *FNaF 2 iPhone Interval Timer*](https://www.youtube.com/watch?v=IWkCMSa1n9Y) — iOS overclock timer
- [dixie — *FNAF 2 10/20 With Minus 7 Strat Completed (4th console victor)*](https://www.youtube.com/watch?v=bSvWhh8Er4k)
