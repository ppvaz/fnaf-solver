# FNaF 2 — 10/20 Mode: The "Minus 3" Family
### State-of-the-art research notes (plan 01), researched 2026-08-19

> **What it is:** a lineage of 10/20 strategies built on **cam-stalling** — animatronics
> in certain rooms cannot leave while that room's camera is *selected* — usually held
> open all night via the **double camera glitch**. The name comes from the original
> version removing the 3 stallable Withereds from the night entirely.
>
> **State of the art (2025):** Zach_Scream's **"Minus Toys"** — the *second ever*
> zero-RNG 10/20 strategy after Minus 7, and by community consensus far easier to
> execute. A glitchless zero-RNG variant ("Minus Two") also exists.
>
> **Legitimacy caveat:** everything glitch-based in this family is considered a
> questionable win by part of the community. Minus 7 and Minus Two are glitchless;
> Minus 3 and Minus Toys are not.

---

## 1. Timeline of the lineage

| Date | Strategy | Author | What it added |
|---|---|---|---|
| pre-2023 | Right Vent Camp (RVC) | community | the baseline: mask-camping with an extra ~0.5 s of mask time to clear vent animatronics. Loses to RNG. |
| 2023-07-27 | **Minus 3** | insstaa (+ Yunivers) | double camera glitch keeps CAM 08 (Parts/Service) selected all night → Withered Bonnie, Chica and Freddy never leave. Not RNG-proof, but far easier. |
| 2023-12-13 | Minus 7 | Niko Frost | glitchless flash-loop; first zero-RNG strategy (see `MINUS-7-STRATEGY.md`). |
| 2024-06-09 | brayden's timer strategy | brayden (8brayden8) + Shooter25 | timer-anchored RVC descendant: Golden Freddy 5 s-interval avoidance + Shooter25's discovery that the **right vent light stalls Toy Bonnie**. Not zero-RNG (~99% — measured by a bot, see §4). |
| 2025-05-13 | **Minus Toys** | Zach_Scream | double camera glitch onto CAM 09 (Show Stage) makes it *flashable*; flashing it stuns all 3 Toys in place all night. Combines GF-interval play and RVC mask timing. **Zero RNG.** |
| 2025-05-14 | Minus Two (glitchless) | Zach_Scream | same plan without the glitch: flash CAM 03 to stall Toy Bonnie + Withered Freddy. **Zero RNG, glitchless**, but much less music-box slack. |
| 2025-10-18 | Minus 3 Toys run | Tru3P1ay3r | independent completion of Minus Toys; verdict: "100% beatable every single time … way, way easier" than Minus 7. |

## 2. The two exploited mechanics

**Cam-stall.** Animatronics in Parts/Service cannot be light-stunned there, but they
cannot *leave* while their camera is selected (Withered Foxy excepted). The Toys on
the Show Stage similarly never move while CAM 09 is both selected and flash-stunned.

**Double camera glitch.** Clicking a different camera button and dropping the monitor
on the same frame leaves the game with *two* cameras selected (both buttons highlight).
The player watches and winds on CAM 11 while the glitched second camera (08 or 09)
stays "selected" — and, crucially, the flashlight input registers on the glitched
camera, which bypasses the custom-night rule that CAM 08/09 cannot be flashed.
The glitch is re-armed once before 0:05 and persists.

**On Android (2026-08-26):** the same state exists and is reachable — it is
`viewing` (the counter driving the picture, the label and the flash-immunity
gate) disagreeing with the `your view` marker (driving the stun target and the
cam-stall). The arming input is the same one, with a window of up to 200 ms
instead of a single frame. See §5 item 2 and §8.

## 3. The state of the art: Minus Toys (Zach_Scream, May 2025)

From the author's own write-up (source 5) — the full routine, condensed:

- Before 0:05, glitch the cameras so CAM 09 is selected while viewing CAM 11.
- Never enter the cameras during a Golden Freddy 5 s interval; enter just *after*
  each interval, exit at the next :X4/:X9.
- While exiting, hold the flashlight: the held flash stuns CAM 09 (all three Toys,
  6.66 s stun vs ~5 s cycle) *and* flashes Foxy during the mask/monitor animation —
  safe only because GF was never allowed to spawn.
- Blackout after monitor-down: wait it out with the mask on until just before the
  next 5 s interval (the RVC extra-half-second clears whoever entered).
- No blackout: assume someone is in a vent; mask until right before the next
  interval, flash Foxy on exit, re-enter after the interval. **Vent lights are never
  used** — Toy Bonnie never moves off the stage, so the right vent stays empty.
- Slack budget: leaving cams at :X4/:X9 against a 6.66 s stun and a
  just-after-interval re-entry leaves **~0.66 s of error margin** per cycle.

Claimed and independently replicated as zero-RNG: "This along with Minus 7 are 100%
beatable every single time, although this strat is way, way easier" (Tru3P1ay3r).
Foxy is nullified, Toy Bonnie never vent-camps, the music box "never went below half."

**Device-transfer result (2026-08-28, `n2-minustoys-0117`).** The engine port
(`packages/propose/bin/minustoystest.mjs` / `packages/propose/bin/plans/minus-toys-plan.mjs`, 200/200 in the
deterministic model) was run open-loop on the Moto g56, Night 2. **It died at
~2 AM to Balloon Boy walking into the office, then Foxy** -- and the model
explains why: shrinking the mask window by ±500 ms in the sim drops Night 2 to
35/300, ~190 of those `BB-inside → foxy`; the cadence never reaches more than 4
of the 5 mask ticks it needs to *cleanly* evict Balloon Boy. That is the
**~0.66 s margin above, measured** -- and the device port cannot hold it. It is
anchored to `T0` (first HUD frame), not to the game's :X0/:X5 phase; the
per-instruction margin map (`packages/propose/bin/plans/minus-toys-margin.mjs`) puts the
whole-schedule phase tolerance at **33 ms early / 99 ms late**, against an epoch
bracket the run measured at **302 ms** -- three to nine times the margin before
any per-cycle jitter or the −184 ms/min game-vs-wall drift the run also
measured. Under the
full clock-error model, Nights 3-5 open-loop are 0/600; an AM-digit re-anchor
every 70 s recovers only to ~17-35 %. The Toys themselves *did* appear held on
the phone (no Toy reached the office in any frame). Full record:
`docs/device/ON-DEVICE-VALIDATION.md` §"The Minus Toys open-loop policy is
refuted on the phone". **Open-loop Minus Toys is not a viable device policy;**
the paths that remain are an external hybrid (AM re-anchor + reactive vent read
+ mask verify/retry, ceiling ~1/3 per the mapped `jasonclone` bot) or the
in-APK read-internal-state route (`plans/17`).

**Story-Night-2 pricing, decomposed (2026-08-30).** Every number above is the
*story* Night 2 table — the jitter tool's `night 2` is `AI_BY_NIGHT[2]`
(g816/g676: BB 3, Mangle 3, Foxy 1, Puppet 5); the plan is 10/20-*shaped*, not
10/20-AI. Same 600 seeds, decomposed: deterministic gate **200/200 + 100/100
worst** with the **no-split control at 177/200** — the weak story AI lets the
defensive churn hold without the stun, so the split buys margin, not
survival-in-model. Ensemble census: **puppet:232, BBin/foxy:73,
inside-office:54** — under clock error the binding failure is the
*box/Puppet*, not the BB chain, and the AM-digit re-anchor barely moves it
(**263/600**, puppet:252): one fix per 70 s cannot hold a 50 s box. Phase
basin at the measured device jitter (σ29 ms): **66 ms** (early 0 / late +66;
85% at perfect phase, 18–32% at ±132 ms). Consequences: Night 2's open-loop
lever is dense *wind-phase* re-anchoring — the winding-tick phase clock
(`ANDROID-AUDIO-CAPTURE.md` §"The A2DP mix DOES carry the fast-mixer SFX") —
not deeper BB sensing; and the arm is still a 3-of-12 phase coin flip whose
miss is fatal (`--phasegate` night 2: 0/24 on miss epochs — viewing CAM 09
leaves the wind inert, exactly r3), so `#arm-verify` is mandatory here too.
Caveat on the whole ensemble: it is calibrated to `n2-minustoys-0117`'s
302 ms + drift, and calib-01 measured no drift on this build — Night 2's mask
churn makes the device run the under-load test of that discrepancy.

**Minus Two (glitchless variant):** identical plan, but with no glitch CAM 09 cannot
be flashed, so instead CAM 03 is flashed before every monitor-down, stalling Toy
Bonnie and Withered Freddy; the player then swaps back to CAM 11 to wind. Zero RNG,
legitimate, but the extra camera swap costs most of the wind slack — the author calls
it "pretty damn annoying."

## 4. Prior art note: the Shooter25 bot

brayden's 2024 guide was validated by an in-game bot mod written by Shooter25
("FNaF 2 Practice Mod" on Gamejolt) that plays the strategy perfectly: 104 wins /
1 death at recording time, including 100 wins in a row. Hand-coded, not ML — but it
is the community doing exactly what this repo's simulator does: measuring a
strategy's consistency by removing the human. (Cross-referenced in plan 05.)

## 5. What the trainer's engine does and doesn't model

Fit: every strategy in this family is **timer-anchored on the 5 s intervals**, like
Minus 7, so the rhythm-lane coaching model fits — Minus Toys especially, since it is
a fixed cycle with two branches (blackout / no blackout).

*The anchor is the whole difference between a trainer and a phone bot.* A human
in the rhythm lane reads the on-screen clock and never loses the :X0/:X5 phase.
The 2026-08-28 device port lost it — it anchored to `T0` and drifted (§3
device-transfer result). "Timer-anchored" is only a strength when the timer is
the game's, not the pilot's wall clock.

Gaps in `src/engine.js` (all load-bearing for this family, none exercised by Minus 7):

1. **Cam-stall** — ~~does not exist in the engine~~ **sourced & implemented
   2026-08-20**: the marker look-hold (groups 344-360) pins the Withereds
   (persisting monitor-down via the parked marker) and monitor-up Mangle.
   Note it does NOT cover the Toys — Minus Toys' cam-stall claims need
   re-checking against that set.
2. **Double camera glitch** — ~~**checked against source 2026-08-20**: no
   two-camera state exists in the Android data model (one `viewing` counter,
   one marker, set atomically per touch; the light input is blocked while
   masked). The PC glitch is an input-layer artifact that does not visibly
   transfer to this build; glitch-dependent Minus Toys steps need on-device
   confirmation before being assumed possible on Android.~~
   **Retracted and reversed 2026-08-26 — it transfers.** A retained on-device
   frame (Night 1, 1 AM, run `n1-full-1640`, moto g56 5G, build 2.0.7+26) shows
   **CAM 04 and CAM 07 highlighted at once** while the picture and label read
   Party Room 4. Re-read against the dump, the selection is **two** fields:
   `viewing` (counter 55) and the `your view` marker (126). A touch writes both
   plus a clear latch (g16-27 / g39+40); the **monitor-raise restore (g1 → g2)
   writes only `viewing`**, from a `last viewed` that g263 samples on a **200 ms**
   timer. Select a camera and drop the monitor inside that window and the raise
   leaves `viewing` on the previous camera with the marker parked on the new
   one — both buttons lit, because g45 is the only clearer and fires on the
   touch latch alone. It persists until the next camera touch. Full sourcing,
   controls and the open items are in
   [`ANDROID-SOURCE-STATUS.md`](../android/ANDROID-SOURCE-STATUS.md)
   §"the double-camera glitch *does* transfer".
3. **CAM 08/09 custom-night flash immunity** — **sourced 2026-08-20**: the
   flash groups carry unconditional `viewing <> 8` (Withereds), `<> 9`
   (Toys), `<> 11` (Mangle) exclusions; whether night 7 changes anything
   remains to confirm (the groups look night-independent).
   **Qualified 2026-08-26:** those gates read `viewing`, but *who* gets stunned
   in the same groups (450-457) is `your view` overlapping the character. With
   item 2's desync armed the two disagree, so the exclusions are bypassable
   exactly as on PC — park the marker on CAM 09 with `viewing` elsewhere and a
   held light stuns all three Toys (g453-455). The exclusions are unconditional;
   they are simply not immune to a split selection.
4. **Golden Freddy interval avoidance** — the engine has `GF_UNFAIR_WINDOW`, but not
   the full "never enter cams during an interval" spawn model, the first-frame hall
   flash on monitor-down, or the 1-frame blackout flash window.
5. **RVC mask timing** — the extra ~0.5 s mask hold clearing vent animatronics needs
   checking against `MASK_LEAVE_FRAMES` / cumulative-mask-time modelling.
6. **Right vent light stalls Toy Bonnie** (Shooter25) — ~~vent lights are widgets
   only~~ **sourced & implemented 2026-08-20 (second pass)**: group 428 requires
   `right light` = 0 on his vent hop; `canAdvance` now enforces it.
7. **CAM 03 stalling Toy Bonnie + Withered Freddy** — confirmed by the
   Technical-FNaF wiki's flashlight page (source 8), whose strategy table lists
   Minus 2 as "Camera Light, Cam 3, Toy Bonnie and Withered Freddy, glitchless".
   ~~What remains open is only *our route table*~~ **Resolved 2026-08-20**: the
   post-XOR re-derived routes put CAM 03 on both — Toy Bonnie's first hop and
   Withered Freddy's second — exactly matching this claim. (The old table was
   built on scrambled identities.) The same page also confirms the stun-immunity exceptions (Withereds in
   Parts/Service, Toys on the stage sans glitch, Mangle in the prize corner) and
   endorses the zero-RNG claim: the camera-light strats are "the only ones to have
   a hypothetical 100% consistency", all by stalling Toy Bonnie, "the source of
   all RNG".

## 6. Implications for plan 02

- "Minus 3 mode" should mean **Minus Toys** — it is the family's state of the art,
  zero-RNG like Minus 7, and the thing worth drilling. The 2023 original is of
  historical interest only.
- It is *not* the pure-data drop-in plan 02 hoped for: items 1–6 above are new engine
  mechanics. Still far smaller than plan 03's reactive coach — the routine remains a
  fixed clock-anchored cycle with a two-branch decision (blackout or not), which the
  lane can represent.
- The trainer should surface the legitimacy caveat, and Minus Two is the natural
  "legit rules" sibling mode if the CAM 03 stall (item 7) can be sourced.

## 7. 2026-08-20 Android probe verdict (plan 02 step 2)

`packages/propose/bin/minus2test.mjs` encodes the family's only Android-viable member —
glitchless Minus Two, adapted with every available trick (sourced right-vent
Toy Bonnie stall, boundary-aligned Foxy flashes during holds, reactive
mask-hold branches, observable-only controller) — against the corrected
Android model:

- ~~**Minus Toys cannot transfer**: the double-camera glitch has no Android
  data-model state (§5 item 2) and CAM 09 is unconditionally flash-excluded
  (§5 item 3).~~ **Withdrawn 2026-08-26 — both halves of that sentence were
  wrong.** The glitch state exists (`viewing` vs. the `your view` marker, §5
  item 2), and the CAM 09 exclusion gates on `viewing` while the stun targets
  the marker, so a split selection bypasses it (§5 item 3). **This does not itself
  make a device policy viable.** The engine now models the split and its
  glitched CAM 09 stun path; `packages/propose/bin/minustoystest.mjs` clears 200/200 normal
  and 100/100 pinned-worst seeds, and its no-split control clears 0/200. The
  2026-08-28 graded open-loop phone attempt nevertheless failed through the
  BB→Foxy chain. The 2026-08-29 Night 1 calibration found no measurable drift
  or desync, but did not stress monitor transitions, so it qualifies rather
  than reverses that result. The consecutive-tick mask-clear semantics below
  break the probed **Minus Two** policy; they are not a Minus Toys verdict.
  See §8–9 for the retained device evidence and next gate.
- **Minus Two: 16/200 normal seeds** (deaths inside-office via Toy Chica);
  the pin-all-six `--cams=3,5,6` extension scores 0/200. The pinned
  worst-luck 100/100 is a diagnostic artifact (pinning freezes the escape
  RNG too), not a proof.
- **Why it fails structurally on Android**: Foxy's lock rolls land on the
  5 s boundaries and demand a hall flash roughly every cycle; each flash
  resets the sourced *consecutive* mask counters (group 293), so Toy Chica's
  five-tick guaranteed clear cannot complete before her five-second opening
  timer arms, and any later monitor raise admits her to marker 123. On PC
  the mask repels vent animatronics near-instantly, which is why the
  published family works there; the Android consecutive-tick semantics are
  the transfer-breaker. Adding flash depth to protect Toy Chica re-derives
  Minus 7's {4,7,10} cut set.
- **Caveat**: this closes the probed policy shape on the *current model*.
  The consecutive-tick mask-clear semantics are the single highest-value
  target for on-device validation — if the real device clears vent
  animatronics faster, the family reopens.

For plan 02 this means a "Minus 3 family" trainer mode on Android is either
a best-odds practice mode (~8% even played perfectly, per the probe) or PC
history — not a zero-RNG drill like Minus 7.

## 8. 2026-08-26: the glitch transfers, so §7's first bullet is withdrawn

Sourced from the event sheet and forced by a retained on-device frame — the
mechanism, the device provenance, the pixel control and the group citations are
all in [`ANDROID-SOURCE-STATUS.md`](../android/ANDROID-SOURCE-STATUS.md)
§"2026-08-26: the double-camera glitch *does* transfer". The strategy-side
consequences:

- **Minus Toys is positive in the Android model, not yet proved on-device.**
  `packages/propose/bin/minustoystest.mjs` arms the split through the real 200 ms sampler and
  runs the published 10 s cadence: **200/200 normal + 100/100 pinned
  worst-luck**, against a **0/200 no-split control**. Deliberate device arming
  is proved below; actual Toy stun transfer and repeatability remain open.
- **The glitched hold does stack, in source.** With the marker parked on CAM 09
  and `viewing == 11`, one held flashlight both stuns all three Toys (g453-455,
  gate `viewing <> 9`) and blocks the Puppet's escape roll (g494, `viewing == 11`
  + `lit?`). That is the routine's central trick, and it reads as intact.
- **Do not import Minus Two's transfer-breaker into Minus Toys.** §7's
  structural failure was Toy Chica reaching the opening in the glitchless
  CAM-03 policy and failing to clear before the next raise. Minus Toys' whole
  premise is that the glitched CAM 09 light pins Toy Chica, Toy Bonnie and Toy
  Freddy on the Show Stage. The glitch therefore targets the exact character
  that killed Minus Two. Android's five-consecutive-tick rule is still
  load-bearing for Mangle and BB, so a glitch-aware probe can still fail, but
  not by simply citing the old Toy Chica trace.
- **Device arming is now proved once (2026-08-28).** On the target Moto g56,
  one scheduled HID attempt used 33 ms contacts plus a 17 ms released gap from
  CAM 09 to monitor-down. The next raise showed the CAM 11 Prize Corner feed
  and wind control with both CAM 09 and CAM 11 lit. Artifacts:
  `captures/n2-doublecam-hid-0003.{png,hid}`. This proves the split state and a
  working 50 ms actuator geometry, not the glitched stun or an all-night policy.
- **What it would take to settle the strategy:** the engine state and policy
  probe are complete. What remains is a repeatability sweep around the proved
  HID geometry and an on-device observation that the glitched CAM 09 light
  actually holds the Toys. Until those exist, quote this as "model-positive and
  deliberately armed on Android; device stun unmeasured", never as "works".
- **Weak device evidence for the glitched Toy stun (2026-08-29, §9).** Pedro
  hand-played Night 1 Minus Toys on the g56 (build 2.0.7+26) repeatedly, holding
  the CAM 09 split all night and re-flashing the feed on a rough beat; no Toy
  ever appeared, even with sloppy flash timing. Uncaptured, not graded, cadence
  unlogged — but it is a human doing on-device exactly what "device stun
  unmeasured" is waiting on, on the easiest night. See §9.
- **Device evidence the CAM 09 light works enough to survive Night 1 mask-less,
  and that the arm is a coin flip (2026-08-29, §9).**
  `n1-minustoys-minimal-20260829-r3` armed only CAM 09 (no split) and still
  reached ~4 AM with no mask ever used — so the light held the Toys off the
  player for 2+ hours — then died to the **Puppet** (box unwindable from CAM 09).
  Whether all three Toys stayed on the Show Stage is not legible (Night 1
  flashlight overlay + VHS noise; Toy Bonnie is not clearly on stage in any
  frame). Its sister run `-r2`, identical emitted plan, armed the full split and
  held the box at 100 %. Same opening, opposite arm outcome: the 33 ms opening
  taps make the split non-deterministic, and `--minimal` has no margin for a
  missed arm.
- **Legitimacy caveat unchanged**: this is the glitch-based half of the family.

## 9. 2026-08-29: the split-camera family on the *story* nights, not 10/20

Everything above treats this family as 10/20 tooling. It is also story-campaign
tooling, and a much softer target there — CAM 09 (Minus Toys) on Nights 1–2,
CAM 08 (Minus 3) from Night 3 on, per the crossover in `PROGRESS.md`'s frontier
notes. Pedro hand-played it on the Moto g56 and reported **Nights 1, 3 and 4 as
trivial**; Nights 2 and 5 not yet attempted this way.

**Not documented anywhere.** The community discusses this family only for 10/20,
because the story nights are winnable without it. Pointing the split-camera
glitch at a story night is an obvious corollary nobody bothers to write down —
not a new technique, just an unrecorded one.

### What Minus 3 removes, and what each story night has left

Minus 3 deletes exactly the three Parts/Service Withereds (`WITHEREDS` minus
Withered Foxy, who is cam-stall-immune). Reading `AI_BY_NIGHT`
(`src/config.js`, g677–682) for what stays armed after that:

| Night | Removed (peak AI) | Still live after Minus 3 (peak AI) | Box full→empty |
|---|---|---|---|
| 3 | WBonnie 3, WChica 2, WFreddy 2 | Foxy 3, BB 2, ToyBonnie 1, ToyChica 1, Puppet 8 | 33 s |
| 4 | WBonnie 4, WChica 4, WFreddy 3 | Foxy 7, Mangle 5, BB 3, ToyBonnie 1, Puppet 9 | 25 s |
| 5 | WFreddy 5, WBonnie 5, WChica 5 | Foxy 7, Mangle 10, ToyFreddy 5, ToyBonnie 2, ToyChica 2, BB 5, Puppet 10 | 20 s |

Golden Freddy does not act below Night 6 (g804), so the 10/20 interval-avoidance
play is never needed here. Story-night Minus 3 is just: arm the glitch, wind the
box on CAM 11 (the glitch leaves you viewing it), and handle a much thinner
office. On Night 3 the office is almost empty; Night 4 keeps Foxy and Mangle;
Night 5 stays a real night (Mangle 10, Foxy 7, Toy Freddy 5) even three
characters lighter.

### The play observation

Pedro, hand-played on the Moto g56, `com.scottgames.fnaf2` build **2.0.7+26** —
the same build as the rest of the device work (`n1-full-1640`,
`n2-doublecam-hid-0003`). **Not recorded** — no video, no `grade-run.sh`
manifest. n=1 per night, a play report, not a rate.

- **The glitch held from the very start to the very end of the night, no
  re-arm.** The practical confirmation is that no Withered ever appeared. This
  is the first reported instance of the double-camera split holding a full ~7 min
  night in play — `ANDROID-SOURCE-STATUS.md` §"does transfer" sources the
  persistence and `n2-doublecam-hid-0003` proved one arming, but neither watched
  it hold a night. Still uncaptured.
- **Why Night 4 played easy despite Foxy 7 + Mangle 5** (this resolves the
  "either not scary or lucky" question the earlier draft left open): the
  remaining threats are cheap *individually* once the three Withereds are not
  also in the mix. Mangle announces herself by sound. Foxy is a cheap flash and
  the flashlight battery is plentiful because you are not sweeping cameras. That
  leaves two things actually needing attention: **Balloon Boy** (watch / listen /
  count his cues) and **Toy Bonnie**, who can still surprise you. The load is low
  enough that the box warning is the main clock you keep.
- **Still open:** Night 5 not attempted this way; nothing graded; Toy Bonnie's
  exact stall/handling on Nights 3–5 not written down.

### Nights 1–2 use Minus Toys (CAM 09), not Minus 3

On Nights 1–2 the Withereds, Foxy, Mangle and BB are all at 0 or near it — the
**Toys are the whole roster** (`AI_BY_NIGHT`, g674/g676):

| Night | Active (peak AI) | After Minus Toys (CAM 09 flash-stun) | Box full→empty |
|---|---|---|---|
| 1 | ToyBonnie 3, ToyChica 2, ToyFreddy 2, Puppet 1 | Puppet only | 50 s, **and it does not drain until 2 AM** (g653) |
| 2 | ToyBonnie 3, ToyChica 3, ToyFreddy 2, Mangle 3, BB 3, Foxy 1, Puppet 5 | Mangle 3, BB 3, Foxy 1, Puppet 5 — all low | 50 s |

So CAM 08 is pointless here (nothing lives in Parts/Service); CAM 09 is the
target. Unlike CAM 08, CAM 09 selection alone does **not** hold the Toys — you
re-flash the glitched feed every cycle against the 400-frame (6.67 s) stun
(`STUN_FRAMES`).

**Night 1 collapses to a pure schedule.** Nothing can move until 2 AM (all Toys
AI 0, box static), so: zero inputs until ~1:55 AM, arm the CAM 09 glitch, then
from 2 AM hold wind on CAM 11 and re-flash CAM 09 on a ~5 s beat until 6 AM.
Puppet is the only real threat and the box warning is the only clock.

**Play observation (Pedro, g56, build 2.0.7+26, uncaptured).** Night 1 hand-played
this way, repeatedly, winning every time *with deliberately sloppy flash timing*
— lost the count, flashed every 2 ticks, freestyled out of boredom; battery is
effectively unlimited on Night 1 so over-flashing costs nothing. The Toys never
appeared. That is weak-but-real evidence for the §8 open item ("glitched CAM 09
Toy stun — device stun unmeasured"): a human re-flashing the split feed on
Night 1 keeps all three Toys off, even played carelessly. Not graded, not a
rate, flash cadence not logged.

### Cadence math (the ~5 s beat)

The stun is 400 frames = 6.667 s. Against a 0.5 s audible metronome tick:

| Re-flash every | gap | stun margin |
|---|---|---|
| 10 ticks (5.0 s) | 300 fr | 100 fr / 1.67 s |
| 12 ticks (6.0 s) | 360 fr | 40 fr / 0.67 s |
| 13 ticks (6.5 s) | 390 fr | **10 fr / 167 ms** (not 16 ms) |
| 14 ticks (7.0 s) | 420 fr | −20 fr — Toys roll |

Flush the stun-arithmetic margin and the binding limit is **human count drift**,
±1 tick easily (as the Night 1 play above shows). Use 10 ticks / 5 s: it holds a
lost-count tick, and it is the same beat Minus 7 and the later Minus Toys nights
run on, so it builds the right muscle memory.

### The coast point — when you can stop everything (Night 1)

The monitor being **down** disarms all three Toys. Every kill path for "the
seven" needs the monitor up: `streakKill` requires `camsUpSince >= 0` (reset to
−1 on every lower, `engine.js:353`) and `armedKill` has an explicit `this.camsUp`
(`engine.js:900-905`). Foxy, BB, Mangle and Golden Freddy are all AI 0 on Night 1.
**So with the monitor down, the only thing on Night 1 that can kill you is the
Puppet** — his attack (`tickPuppet`, `engine.js:1050-1058`) has no cams-up
condition.

So "drop everything" = "stop winding", and the deadline is pure box arithmetic.
Worst case, from a **full** box (2000) with the monitor down and no more inputs:

| Stage | Mechanism | Worst-case time |
|---|---|---|
| Box full → empty | 40 units/s (`BOX_DRAIN_PER_TICK[1]=2` × 20) | 50.0 s |
| Puppet escape | 3 × 1 s rolls at `(1+1)/20 = 0.1`, all hit | 3 s |
| Route CAM 11→10→7→3→1→opening | 5 × 1 s hop rolls (g496), all hit | 5 s |
| Opening → inside (marker 123) | 1-in-10 per 1 s roll (g623), hits | 1 s |
| Inside → kill | `INSIDE_ATTACK_FRAMES` = 40 fr | 0.67 s |
| **Total** | | **≈ 60 s** |

Night is 420 s; 6 AM = 420 s; 70 s per in-game hour. Stop no later than
**t ≈ 360 s ≈ 5:08 AM with the box topped full**, lower the monitor, and put the
phone down — no sequence of rolls reaches the office before 6 AM. Expected-case
the Puppet takes ~140 s, so ~4:00 AM is the "probably fine" line, but 5:08 AM is
the one where luck cannot beat you.

### Night 1 pilot recipe (human, not a gated device plan)

Times are wall-clock into the 420 s night.

| t (s) | in-game | action | contact |
|---|---|---|---|
| 0–110 | 12:00–1:34 | nothing — all Toys AI 0, box static until 2 AM | — |
| ~115 | ~1:38 | **arm the split:** tap CAM 09, drop monitor within ~150 ms, raise. Left viewing CAM 11, marker on CAM 09. | ~67 ms tap |
| 140 → 355 | 2:00–5:04 | every 5.0 s: ~67 ms flash on the CAM 09 feed (re-applies the 6.67 s Toy stun); ~1 s wind hold to top the box | flash 67 ms / wind ~1 s |
| ~356 | ~5:05 | last wind — hold to **full** | ~5 s |
| ~360 | ~5:08 | lower the monitor. Stop. | — |
| 420 | 6:00 | night clears | — |

Total distinct inputs ≈ 1 arm + ~43 flash/wind cycles + 1 final wind. No mask,
no lights, no hall, no vent reads — every one of those answers a threat that is
AI 0 on Night 1 (`elegance.py`'s test).

**Status (corrected 2026-08-29):** an earlier draft here said "no gated device
plan exists — the engine models no split-camera state". **Both halves were
stale.** Plan 02 pkg 2a shipped 2026-08-28 (`c038938`): the engine separates
`viewing`, sampled `lastViewed` and the parked marker; `packages/propose/bin/minustoystest.mjs`
gates the split 200/200; and **`packages/propose/bin/plans/minus-toys-plan.mjs --night=1`
emits a gated device plan that scores 200/200 normal + 100/100 worst-luck**.
`trial.sh DEVICE_POLICY=minus-toys NIGHT=continue CALIBRATION_STORY_NIGHT=1`
runs it.

**`--minimal` now emits this recipe (2026-08-29).** `minus-toys-plan.mjs
--night=1 --minimal` drops the 10/20 shape for exactly the table above: arm the
split (5 taps), then a **5 s** cycle of `hold ventl` (re-flash CAM 09) +
`hold wind`. No mask, no hall, no per-cycle camdrop re-arm. `#period 5000` in
the header. Gate: **200/200 normal**; worst-mode is 0/100 but every loss is
Golden Freddy, and `canAct(1,'golden')` is false — the gate recognises that as
a pinned-RNG artifact (§7) and passes on the normal-seed proof. `--minimal` is
**Night 1 only** and the CLI refuses any other night; nights 2–5 need their own
shapes (Night 2 adds a mask for Mangle/BB, Nights 3–5 switch to CAM 08 and are
Minus 3, not Minus Toys — no flash, mask + hall instead).

#### Night 2 detection scoping (Pedro, 2026-08-30)

On Night 2 the mask threats after the CAM 09 stun are exactly BB and Mangle —
and they are the two characters the blackout grace does **not** cover.
Engine-checked: the office-encounter blackout (`startOfficeEncounter`,
`engine.js:376`) fires only for `openingRule: 'streak'` units — the Withereds
and Toy Freddy (`engine.js:873`, `:928`), plus Toy Bonnie's mask case
(`engine.js:878`) — while Mangle is `openingRule: 'raise'` (`config.js:635`,
armed on cams-up, committed at monitor lowering, `engine.js:357-363`) and BB is
not in `STALLED` at all (his own five-tick eviction; inside → flashlight dead →
the Foxy chain). **Once either is inside the office it is already too late**, so
the pilot must track the vents, not the office:

- **Audio first.** BB's laughs (samples 21/23/24) are fast-mixer SoundPool cues
  — A2DP external capture only. Mangle's static (s0020, channel 16, g732/733)
  is a volume-gated loop: the internal capture has it *permanently* (the leak),
  so only the A2DP path hears the real fade-in. The vent→inside window is
  seconds wide, so A2DP's ~150–250 ms latency does not hit item 10's <~33 ms
  closure — that bound the bang-anchored Foxy reset, not vent tracking. The
  BlueALSA A2DP capture is the **flagship audio path** (2026-08-30 directive;
  `ANDROID-AUDIO-CAPTURE.md` §"The A2DP mix DOES carry the fast-mixer SFX").
- **A vent video cue is possible but priced.** Mangle is `ventR`
  (`config.js:635`) — her office read needs the view panned right, and pan is
  the documented press-coordinate desync hazard and classifier confound
  (`ON-DEVICE-SCREEN-CHECKS.md` §"the left-opening classifier measures camera
  pan"). The left opening stays readable for BB's side at ~0 pan.
- **GF is the odd one:** countered by phase (never enter cams during an
  interval), not by a sensor; at one-in-1000 arming it is a gate-census check,
  not a design driver.
- **Foxy is scheduled, not sensed, on Night 2 (agreed 2026-08-30).** At AI 1
  (~1-in-20 per 5 s roll) a per-cycle 33 ms hall pulse resets whatever state
  exists, and the flash is also the only read — he is visible only when lit,
  so a sensor would duplicate the one contact that both observes and clears
  him. The engine gates light actions on mask-off (`engine.js:203-233`), so
  the pulse must sit in the cams-up phase: `n2-la-212912` died to a ~40 s
  un-reset window inside a mask camp. The one audio candidate, s0060 hall
  ambience, has an untraced volume gate — trace it for Night 4+ (Foxy 7),
  where reactivity starts earning its keep; on Night 2 it buys nothing.

**Route-audio detail (Pedro, 2026-08-30, same day).** Both carry characteristic
movement cues along their routes, and both change voice in the final stretch:

- **BB's vent stretch moves on the shared thud, not his laugh.** The sourced
  route is CAM 10 → 07 → 03 → 01 → 05 → opening; only the middle three hops
  play a laugh (`BB_VOCAL_SAMPLES` 21/24/23, random bank, identical channel-14
  volume — no range information), hop 1 is silent, and the vent-stage movement
  edges are `THUD_SAMPLE` 17 — the sample **seven characters share**
  (g292/294, g400/401, g439/440, g748/749), indistinguishable in audio. One
  sourced exception cuts through: arrival at the opening is the
  **thud + 21 pair** (`BB_ARRIVAL_SAMPLE`, g607), so his final stretch reads
  as generic thuds ending in a distinctive pair. Controls stay mandatory per
  the 22/22-false-thud lesson — matched filter against the A2DP bed plus a
  cue-free control recording before any thud number counts.
- **Mangle's right-vent occupancy is a sustained state cue, monitor-state
  independent.** While she sits visible in the right vent, her characteristic
  loop (s0020, channel 16, g732/733 proximity gating) plays with the monitor
  up or down. That lifts her occupancy detection off video entirely — no
  office pan needed to know she is at ventR; the panned right-vent read
  becomes optional confirmation, not the detector.

**The elegance↔robustness trade, on record.** The minimal plan carries no
defensive mask/monitor churn, so it is exactly as safe as the sourced Night 1
AI table is correct: worst-mode killing it instantly via an impossible GF spawn
is that fragility made visible. The 10/20 plan's mask-every-cycle is the safety
net being traded away. Per Pedro's rule (machine → elegance) that is the right
call for a device plan, but a Night 1 AI-table error would not be caught by
this plan the way it would by the heavy one.

The remaining gap is device-side: the glitched Toy stun is unobserved on
hardware (§8). `trial.sh` still hardcodes `POLICY_CYCLE_MS=10000` for
minus-toys — it must read the plan's `#period` before `--minimal` can run
on the phone at its 5 s cadence. And a story-night run needs the save reset to
Night 1 first (`trial.sh` verifies the real Continue cursor).

### A second axis: teachability, not just elegance

`elegance.py` scores the *run* — per input, does it answer a threat that can act
tonight? A routine can be elegant (few, short inputs) and still be hard to hand
to another person. That is a separate axis, scored on the *description*:

| Term | What it counts |
|---|---|
| `R` | distinct action-rules ("wind CAM 11", "flash CAM 09 every ~5 s") |
| `C` | game concepts the player must *understand*, not just perform — the double-camera glitch, tick counting, the streak/GF timers, box arithmetic |
| `B` | conditional branches ("if blackout … else …") |
| `M` | running counters held in working memory (tick count, box level, consecutive mask ticks) |
| `T` | timing-tightness: 0 "roughly", +1 "within ~1 s", +3 "within a frame / the 200 ms glitch-arm window" |

Teachability cost ≈ `R + 2C + 2B + M + T` — concepts and branches weighted up,
because they are what makes a routine hard to *explain*. A routine is dominated
if another beats it on both elegance and teachability.

**The selection rule (Pedro, 2026-08-29):**

- **Machine / device-plan runs → optimise elegance alone.** The emitter and the
  gate carry the complexity; a human never reads the schedule, so `C`/`B`/`M`/`T`
  cost nothing. Minimum contact time, minimum input count.
- **Transferable human runs → optimise elegance + teachability.** The routine
  has to survive being explained to another person and executed from memory, so
  a lower teachability cost is worth spending extra inputs on ("wind and flash
  forever" over "elegant coast").

Night 1, three shapes:

- **Elegant coast** (the recipe above): fewest inputs, but `C` = glitch + tick
  count + box arithmetic, `T` = +3 (the arm), `M` = clock. Cheap to run, dear to
  explain.
- **"Wind and flash forever":** arm the glitch once, then *"hold wind on CAM 11,
  tap the CAM 09 light every time you count to about five, until 6 AM."* More
  total inputs (~56 flashes, no coast), but `R` = 2, `B` = 0, `M` = 1 loose
  count, no coast concept. The glitch arm is still one irreducible `C`/`T`.
- **Glitchless (Minus Two shape):** removes the glitch concept entirely, but
  needs a CAM 03 flash *plus* an RVC mask camp for Toy Chica/Freddy — more `R`,
  a `B`, and it does not fully cover the Night 1 Toys. Simpler vocabulary, more
  moving parts.

The glitch arm is the irreducible teaching cost of any CAM 09 routine. The
elegance-vs-teachability trade on Night 1 is real and unforced: pick "wind and
flash forever" to teach, "elegant coast" to minimise wear.

### Night 1 as a calibration run

Night 1 Minus Toys is the cleanest possible device trace: a full 420 s with no
threat events to confound anything (only the Puppet can even kill, and only if
the box empties). That makes it the right place to attack the problem that
actually sank device Minus Toys — §3's refutation is *entirely* a clock problem:
"every beat phase-locked to a clock the device holds only to ~302 ms + drift",
with a measured −184 ms/min game-vs-wall drift.

Two things to measure on a Night 1 run:

1. **The drift, cleanly.** `camtrace.py` reads the CAM 09 button highlight
   (driven from `viewing`/marker by g46-57), so each flash gives a frame-stamped
   fix of the game clock against the pilot's wall clock over a whole night with
   nothing else moving.
2. **An audio phase clock — the winding tick, now sourced (2026-08-29).**
   `readdump.py sounds 3 33` → **groups 637 and 644 only**, both playing
   `Sample 'WinD'` (handle 33, `res/raw/s0033.wav`, a **0.284 s** mono ratchet)
   on a `Time: 500 loops: 0` — a **global "Every 500 ms" timer** — while the
   wind button is held and `viewing == 11`. g637 is the mouse-hold twin
   (`Key` + `music button` overlap), g644 the touch-hold twin (reached through
   g642/g643's `Multiple Touch` over `musicButtonHitbox`). **No variation:** one
   handle, one channel (12), no random bank, no pitch expression — it is always
   sample 33. This is the 0.5 s beat a human counts.

   Modelled as `WIND_TICK_SAMPLE = 33` / `WIND_TICK_FRAMES = s(0.5)` (30 frames
   at 60 fps), emitted as a `wind-tick` event in `tickBox` and pinned by
   `sourcetest.mjs` ("g637/g644"). Consistent with how every other Fusion
   `Time:` condition here is modelled frame-locked (g263's 200 ms, the 5 s
   interval). Because the timer is **global and free-running** (`loops: 0`,
   attached to Backdrop, not restarted on wind press/release), the tick *edges*
   sit on a fixed frame grid — each tick heard tells you `frame mod 30`. That is
   what makes it a phase reference and not just a rhythm.

   **Why this generalises past Night 1 Minus Toys.** The Puppet is armed on
   *every* night (`AI_BY_NIGHT`: 1/5/8/9/10/15/15) and the box mechanic never
   changes, so **every strategy on every night must wind** — Minus 7, RVC, Minus
   Toys, all of them. The winding tick is therefore a phase reference available
   to the whole device-pilot program, not a one-strategy trick. It re-acquires
   on every wind visit: the only stretches without it are mask-camp windows with
   the monitor down and no winding, and those are bounded by box drain — i.e.
   they end exactly when you must wind again. The AM digit gives phase once per
   70 s; the camera-button highlight (`camtrace`) only while you touch cameras;
   the winding tick gives 2 Hz phase across every wind phase of every cycle. It
   is the best candidate yet for the desync/phase-lock problem that has sunk
   more than one timer-anchored route.

   **Open — the frame-vs-wall question.** A Fusion "Every N ms" timer accumulates
   real elapsed time per frame. At a locked 60 fps it fires every 30 frames; if
   the framerate dips it follows wall time. Which the g56 does is unmeasured, and
   it is the whole question: if frame-locked, the tick *is* the game's phase and
   tracks the −184 ms/min drift; if wall-locked, it tracks the pilot's clock and
   is useless as a game reference. A Night 1 run resolves it — sample-33 onsets
   vs `camtrace.py` frame stamps.

   **Capture-bug interaction (`ANDROID-AUDIO-CAPTURE.md`).** Internal
   `AudioPlaybackCapture` on this build is documented to carry the music box and
   Mangle's static *continuously*, even when inaudible. Whether sample 33 —
   a discrete per-tick `Play Sample`, not a suppressed loop — also leaks is
   unmeasured.

   **Detectability study, 2026-08-29 (synthetic, subagent).** s0033 is a 0.284 s
   front-loaded ratchet (16 kHz ref sha256 `52938c8c…`, peak 0.118, rms 0.028).
   Findings:

   - The coarse **band-energy / recall stage is useless here** — s0033's
     band-profile similarity to a tonal contaminant candidate is **0.97**. Do
     not try to detect this with `features`-domain matching.
   - A **per-tick waveform matched filter** (`correlate.best_match` against the
     s0033 template, probed at the known grid position) is clean: median
     normalised xcorr ≈ 0.8 at 0 dB SBR, ≈ 0.3 at −12 dB, against a ~0.09
     off-grid floor with **no periodicity artifact in the matched-filter
     domain**. A single tick is reliable to about **−10 to −12 dB SBR**.
   - **Folding the matched-filter score across the 2 Hz grid** (≈60 ticks/night)
     buys ≈√N ≈ +9 dB, so phase recovery should hold to roughly **−20 dB SBR**.
     Folded onset estimate is **sub-millisecond**, far inside the ±33 ms
     `DEVICE_EPOCH_LATCH` bracket.
   - **Naive epoch-folding on an energy envelope is NOT a usable detector** —
     the always-on ambient loops carry their own sub-0.5 s periodicity, and a
     crude onset envelope mislocates the ratchet by 25–140 ms. It needs the
     matched filter + bed-background subtraction (`detect.subtract`), not
     demonstrated yet.
   - **The realistic-regime test is decisive.** Rebuilt as specified — leaked
     music-box loop + Mangle/static loop both at full volume, 30 s of WinD at
     2 Hz over them, matched filter at each grid position:

     | Scene | grid-corr median | off-grid control | ticks ≥ 0.30 |
     |---|---|---|---|
     | leaked bed, **no WinD** | 0.080 | 0.081 | **0 / 57** |
     | leaked bed + WinD (~equal RMS) | **0.685** | 0.086 | **57 / 57** |

     Every tick recovered, zero misses, zero false ticks from the bed. The
     −12/−24 dB sweep above was pessimistic: while you are *actually winding*,
     WinD is a foreground sound at roughly the bed's level or louder, and the
     stationary loops correlate ~0.08 against a sharp broadband transient.

   So: **recoverable as a phase clock via a per-tick matched filter — 57/57 in
   the leaked-bed regime, ~−20 dB SBR floor when buried.** The residual risk is
   unchanged — it is the
   wind-*gate*, not the phase: a continuous leak still folds to a 2 Hz phase
   (fold-z 6.6–8.1 in the leaked-continuous synthetic) but "tick present" stops
   meaning "winding". **Controls required** per "numbers need their control": a
   not-winding window where sample 33 must be absent, and the CAM 11 wind-pie
   via `camtrace` as a second signature.

   **The contaminants are now sourced (2026-08-29, `ANDROID-AUDIO-CAPTURE.md`
   sound-handle map).** The capture bug's persistent bed is **s0015** (the music
   box, channel 13) + **s0020** (Mangle, channel 16) — both kept looping by g65,
   volume-gated by g596–600 / g732. The subagent's synthetic study mislabelled
   these (it used s0020 as "music box" and s0010, the blackout sound, as
   "Mangle") but mixed WinD against two real stationary loops all the same, so
   its matched-filter result stands; re-run any SBR figure with s0015 + s0020 as
   the bed. Other confirmed handles: s0009 = mask breathing, s0010 = blackout,
   s0035 = the Night-1 phone call.

   **No other audio is a phase-clock candidate.** The mask SFX (g254 sample 5,
   g267/g270 sample 7, g274 sample 8) are one-shot transition sounds on the
   button press — no `Time:` condition, not periodic. A masked-breathing loop, if
   one exists, would anchor to the *press*, giving elapsed-time-masked, not
   absolute game phase. WinD is unique because g637/g644 fire on a **global,
   free-running** 500 ms timer whose edges sit on a fixed frame grid regardless
   of when winding began.

**Device measurements that settle it, in order:**

1. **Frame-lock vs wall-lock** — a ~5 min Night 1 winding capture, sample-33
   onset spacing vs `camtrace.py` frame stamps on one clock. Tracks the
   −184 ms/min game drift → frame-locked → a real game-phase clock. Stays at
   500.0 ms wall → useless. **This is the gate.**
2. **Does sample 33 leak?** — record a deliberate not-winding stretch; it must
   be absent. If present, phase-only use or external-mic capture.
3. **Real SBR floor** — extend `packages/propose/parked/minus7/cue/evaluate.py` to handle 33 and run
   `--anchor` against a real Night 1 internal capture.

Open item, not yet built. If it works it reopens open-loop Minus Toys as a
device policy — and gives every timer-anchored route a phase corrector; if the
tick is wall-timed it is a dead end, cheaply.

### The calibration run happened — `n1-minustoys-calib-01`, 2026-08-29

First device run of `minus-toys-plan.mjs --night=1` (the 10/20-shaped plan, not
`--minimal`) on the g56 / 2.0.7+26, with the Companion capturing internal
audio + `HID_TRACE_RUN=1`. Aborted by hand at ~305 s (the plan can't lock the
Toys any better than the model and the audio was the point), but graded fully.
Artifacts: `captures/n1-minustoys-calib-01-*` and
`captures/cue-helper/calibration/n1-minustoys-calib-01-cue-…-q318.wav`.

**Positive results:**

- **The split-camera glitch armed in a full pilot run and held the entire
  night.** `camtrace` on the CAM 09 / CAM 11 button highlights: co-lit in
  **99.5 %** of the 3277 map-visible frames, **0 of 31** monitor-up windows
  failed, no collapse, no re-arm. Stronger than the one-shot
  `n2-doublecam-hid-0003` (§8) — this is deliberate arming *persisting through a
  ~5 min pilot*.
- **Zero desync.** `desync-scan.py`: the pilot's open-loop model of the monitor
  agreed with game state across every press over ~30 cycles.
- **No measurable game-vs-wall drift.** AM-digit transitions gave three
  consecutive game hours of **69.99 / 70.04 / 70.00 s** (mean 70.01 ± 0.03) vs
  the nominal 70.000 s; the map-cycle falling edge repeats every
  **9.99949 ± 0.00086 s** against a scheduled 10.000 s (−51 ± 86 ppm, consistent
  with zero). **The −184 ms/min drift from `n2-minustoys-0117` did NOT
  reproduce.**
- ALIVE ≥ 302 s, reached 4 AM, no death; box wound continuously (pie ≥ 0.62);
  all four run clocks aligned to ~50 ppm, and a new video-PTS↔wall edge landed
  (video-PTS 0 ≈ device-wall 1787989030800).

**What it did not show:** the Toy stun — the feed was CAM 11 the whole run, so
the Show Stage never appeared. Consistent with the stun working, not proof; a
run that periodically views CAM 09, or a Night 3+ run, is needed.

**The audio phase clock is dead via internal capture (`ANDROID-AUDIO-CAPTURE.md`
§"Discrete SFX are on the fast mixer").** Confirmed three ways: no winding tick
in 318 s of capture by ear, matched-filter at the noise floor, and
`dumpsys media.audio_flinger` showing WinD as a track on the `FAST` output
thread — a separate HAL stream `AudioPlaybackCapture` never taps. Not fixable
without root. External-mic capture, or the recompile's `Play sample` hook, are
the only paths left for the winding tick specifically.

### The `--minimal` plan run twice — the split arm is non-deterministic on device (2026-08-29)

Two full runs of `minus-toys-plan.mjs --night=1 --minimal` on the g56 / 2.0.7+26,
back to back, from a **byte-identical emitted opening** (`115000 monitor`,
`115300 cam11`, `115833 cam9`, `115883 monitor`, `116616 monitor`; the arm taps
are 33 ms contacts). Same env, same `PILOT_OFFSET_MS=175`. Opposite outcomes:

| Run | Split armed? | Feed | Music box | Outcome |
|---|---|---|---|---|
| `n1-minustoys-minimal-20260829-r2` | **yes** — CAM 09 **and** CAM 11 both lit, monitor shows *Prize Corner*, "Wind Up Music Box" button present | CAM 11 from 124.9 s to end | **100.0 % the entire run** (`windpct`, 148→367 s) | ALIVE ≥ 360.8 s, recording ends before 6 AM, terminal unknown |
| `n1-minustoys-minimal-20260829-r3` | **no** — only CAM 09 lit, monitor shows *Show Stage*, no wind button, never *Prize Corner* | CAM 09 the whole run | drains steadily 1 AM → empty by 4 AM (frame walk of the pie gauge) | **DEAD to the Puppet at ~4 AM** (~303 s): monitor-up jumpscare, death static, Game Over, back to the menu |

The model (`minus-toys-plan.mjs` `replay()`, split ≡ `sim.viewing === 11 &&
sim.cam === 9`) assumes the arm always lands, so its 200/200 gate never sees the
r3 branch. On device the arm is a **coin flip on the 33 ms opening taps** —
across all four 2026-08-29 runs the split armed on the 10/20-shaped calib-01 and
on r2, and did **not** arm on r1 (interrupted early) or r3. When it misses, the
plan plainly views CAM 09, and **you cannot wind the music box from CAM 09**, so
the per-cycle 4400 ms `hold wind` at the CAM 11 button coordinate is inert and
the Puppet is guaranteed.

What the CAM 09 light did for the Toys on r3 is only **partly** legible: the run
reached ~4 AM with **no mask used at all** (the minimal loop is `ventl` + `wind`
only), and on Night 1 an unstunned Toy Bonnie or Toy Chica reaching the mask-less
office would kill well before then — so the light held them off the player for
2+ hours. But the Show Stage feed is heavily obscured by the persistent Night 1
"tap here to use your flashlight" overlay plus VHS noise: Toy Chica's beak is
identifiable on stage, **Toy Bonnie is not clearly on the Show Stage in any
frame** (Pedro's read, 2026-08-29), and the office is never visible with the
monitor up. So: evidence the light *works* enough to survive Night 1 mask-less,
not proof it pins all three Toys on stage. The §8 open item stands.

This is the elegance↔robustness trade (§9 "The elegance↔robustness trade, on
record") realised on hardware: `--minimal` carries no defensive churn, so a
failed arm has nothing to catch it. Two consequences:

1. **The arm needs to be verified, not assumed.** The cheapest check is the one
   the frames make obvious: after the raise, the monitor caption reads
   *Prize Corner* (armed) or *Show Stage* (not armed), and the "Wind Up Music
   Box" button is present iff armed. A device run must read that and re-arm (or
   abort) on *Show Stage*, exactly as a live loop's split-armed tile watchlist
   would (§9 "What a video-only live loop can and can't do"). Holding the arm
   taps to ≥100 ms (the `hid-multi` contact floor the loop cycle already uses —
   CLAUDE.md "Short taps get dropped") is the first thing to try.

   > **Corrected later the same day: contact length was the wrong suspect, and
   > the check above is now built.** The ≥100 ms idea was stale-era reasoning —
   > the g56 registers 33 ms contacts on every touch control. The modelled
   > mechanism is **g263's sampler phase**: the arm's CAM 09 touch → monitor
   > drop gap is 3 frames, g263 samples `lastViewed` only on
   > `f % LAST_VIEW_SAMPLE_FRAMES === 0`, and at 3 of 12 schedule/game phase
   > alignments a tick lands inside the gap, samples `viewing=9`, and the raise
   > writes `viewing=9` — exactly r3. Measured by the new
   > `minus-toys-plan.mjs --phasegate` (epochs +7f/+8f/+9f miss; bimodal 24/24
   > or 0/24; P(miss) = 3/12 per attempt; pinned in
   > `test-minus-toys-plan.mjs`). No static same-slot arm reaches 12/12 — a
   > 1-frame gap needs overlapping contacts, i.e. the measured drag defect —
   > so the fix is runner-side: the emitted `#arm-verify 1` header opens an
   > arm-verify window after the raise; `trial.sh` photographs the monitor and
   > `cam11lit.py` reads the **CAM 11 map button** (lit ⇔ `viewing===11` via
   > g46-57; lit 228.0–229.7 vs unlit 110.2–111.8 green on the r2/r3 frames,
   > office 34 / menu 16 as never-lit controls), touches `rearm` on a miss
   > (the driver re-runs the opening camera rows, skip=1) and aborts the run
   > named (driver exit 50) after 3 misses.
2. **The post-abort input is a save-wipe hazard.** After the r3 death the runner
   kept firing the blind `toys[0..999]` macro into the menu for ~7 s before the
   focus watchdog stopped it; the retained tail shows the cursor walked to
   *"Start a new game?  »Yes"*. Input halted one contact short — the Night 1
   save survived (the menu still offers *Continue / Night 1*) — but on a story
   run the abort path must press nothing, or press a known-neutral coordinate,
   once `screenstate` leaves the night. Open item for `trial.sh`.
   **Closed 2026-08-29 (late):** `stop_remote_driver` now touches a per-run
   `halt` file — one adb round trip — before its slow force-stop/kill path, and
   the driver checks it at every macro boundary in both loops (Minus Toys and
   the gated Night 6 route). The residual exposure is at most the in-flight
   macro, bounded by construction, instead of ~7 s of pressing into the menu.

Artifacts: `captures/n1-minustoys-minimal-20260829-r{2,3}-*`
(`-r2-grade-debian-r2.log` has the r2 grade; r3 graded by frame walk here).

### Night 1 passed on the device (2026-08-30)

`n1-minustoys-armverify-20260830` — the first run of the armed `--minimal`
pilot (sampler-phase model, `#arm-verify`, halt guard all in place) — **passed
the night**: 44/44 cycles, terminal CAM 09 proof, monitor down at 5:08, hands-off
observe to 6 AM, and **the save advanced to Night 2** (operator-observed; the
instruments still cannot see a 6 AM card, so the manifest reads
`TERMINAL: unknown` — the cursor is the game's own statement). Graded:
CAM 11 feed continuous 124.67→367.92 s, no death static in 427.9 s of
recording, 51 contacts all scheduled, 0 desync, 0 wasted inputs. The arm
landed first-try, so (a) re-arm and exit-50 remain unproven live, and (b) the
run exposed that the live verify could be *silent*: no verify event exists for
it, indistinguishable from the check not existing. Fixed the same day — the
driver logs the window opening and `watch_arm_verify` records
`watcher-started`, every attempt verdict, and an `arm-window-never-opened`
fault on timeout. **The verify chain's first live firing therefore waits for
the next natural Night 1 run** — the save sits on Night 2 and Pedro parked
Night 1 (2026-08-30). `--minimal` is Night-1-only; nothing further to do here
until then.

### So: does the timer-anchored route even need a phase clock?

`n2-minustoys-0117` was refuted on "302 ms + −184 ms/min drift". This run, on
the same phone, shows **no drift and zero desync over 5 minutes on Night 1.**
Two readings, and which one is true decides the frontier:

- **The drift was a `n2-minustoys-0117` artifact** (BT audio, thermal, a
  measurement bug, a different device state) → open-loop Minus Toys is back on
  the table, and §3's refutation needs a caveat.
- **The drift is real under load** (Night 1 has no forcedowns, no mask churn, no
  reactive corrections — the easy case) → it only shows on the hard nights.

The cheap experiment: a **Night 5 or Night 7 run with the same instrumentation,
observing only** — grade the drift and desync under a schedule that actually
stresses the monitor. Do this before acting on the no-drift result.

### What a video-only live loop can and can't do

With audio out, the live sensor is the Companion's `VirtualDisplay`
(~59 ms device-local read, ~14 Hz, its own MediaProjection surface — does not
touch SurfaceFlinger, so it does not contend with rendering or presses).

**The 20×9 is a config choice, not a limit (2026-08-29).** The helper currently
box-filters the whole screen to 20×9 and samples cell (3,6). Set the
`VirtualDisplay` to native 2400×1080 instead and sample a **device-side
watchlist of individual pixels / tiny regions** — the reply stays tiny and the
round-trip stays ~59 ms, you just get precise pixels instead of 120×120
averages. A native ImageReader is ~10 MB/frame of memory bandwidth (what screen
mirroring does; the 40 min soak held at 38 °C).

**Affordable in one ~59 ms snapshot** — left-opening lit/dark (BB→Foxy — already
load-bearing, 0/3000 without it), blackout (`luma` collapse), monitor up/down,
mask up, CAM 05 region, split-armed (CAM 09/CAM 11 tiles), right-vent light,
music-box pie *angle*, the **AM digit** (sample the strokes → the hour, a phase
anchor), and an **office-pan reference edge** (a 1-px shift is visible on a
known edge — no full-frame correlation needed). Reaction budget ≈ 300 ms
(59 ms read + 33 ms press + ~200 ms mask animation) against a mask-grace window
of 1.67 s (Night 1) → **0.75 s (Night 7)** — fits, if the threat is caught on
the frame it appears.

**Still off the table:** whole-frame ops — a full `screencap` is 225 ms and
*"a screencap every four cycles truncated the wind and collapsed the box from
52 % to 10 %"*. The watchlist approach avoids them; a full-frame correlation
does not, so keep pan to the edge-pixel trick.

**Consequences per strategy:**

- **Minus 7 — BB vent detection is dead.** Most cycles the pilot is mid-sweep or
  mid-mask when BB would appear in the opening, so it misses him. Minus 7's own
  stun-loop is what handles BB; a reactive read cannot be the backstop.
- **Blackout-reactive strategies (RVC / brayden / the published Minus Toys
  blackout branch) — the video loop is enough for the reaction it needs.**
  Blackout is a free whole-screen read; mask → wait → check the opening → resume
  is inside budget on every night.
- **Any timer route — the loop's real job is verification, not reaction.** With
  no drift to correct, it is a passive monitor that resyncs only on a detected
  desync — and conservatively, because a mis-timed correction *causes* the
  desync it hunts (§"Device runs", night 6-38).

### Why this is worth a deliberate run

The whole Minus 3 / Minus Toys line has been chased as a **10/20** device policy
and repeatedly stalled (§3, §7). If the goal is instead "clear the story
campaign on the g56 with the least fragile input", story-night Minus 3 is a far
easier target: no Golden Freddy, no zero-RNG bar, and the one sourced device
risk is arming the glitch — proved once already (`captures/n2-doublecam-hid-0003`,
§8). A recorded Night 3–5 sweep through `tools/device/grade-run.sh` would turn
this play report into a graded result.

## Sources

1. insstaa — *Completing Golden Freddy With a Brand New Strategy (Minus 3 strat)*,
   2023-07-27: <https://www.youtube.com/watch?v=f4xoDEAfpMQ> (discovery account in the
   description; note it mislabels CAM 08 as "the right vent camera" — CAM 08 is
   Parts/Service)
2. FNAF Gameplayer — *BRAND NEW WAY to BEAT 10/20 MODE (Minus 3)*, 2023-08-10:
   <https://www.youtube.com/watch?v=oeG7ymLNyJM> (console how-to linked there:
   <https://youtu.be/BJHUcIV5pC8>)
3. arso0628Stuff — *How to do the Minus 3 Strategy*, 2024-06-15:
   <https://www.youtube.com/watch?v=dbUYWgAdcjQ> (the glitch input, step by step)
4. brayden — *A Brand New FNaF 2 Strategy (Guide + FNaF 2 Bot)*, 2024-06-09:
   <https://www.youtube.com/watch?v=EYtIOKRuQqE> (timer strategy; Shooter25 bot;
   right-vent-light Toy Bonnie stall)
5. Zach_Scream — *My New Strategy: "Minus Toys" 10/20 Mode (World's First, No Vent
   Lights, Zero RNG)*, 2025-05-13: <https://www.youtube.com/watch?v=pO9nkzXmAWs>
   (the authoritative routine write-up, quoted in §3)
6. Zach_Scream — *"Minus Two" Glitchless 10/20 Mode, Zero RNG*, 2025-05-14:
   <https://www.youtube.com/watch?v=Pbiqv6MJNkM>
7. Tru3P1ay3r — *FNaF 2 - 10/20 Mode (Minus 3 Strategy)*, 2024-07-12:
   <https://www.youtube.com/watch?v=dXvSt6_lqwI>; *… (Minus 3 Toys Strategy)*,
   2025-10-18: <https://www.youtube.com/watch?v=yk-umol18Rs> (independent
   replication and comparison against Minus 7)
8. Technical-FNaF wiki, flashlight mechanics (cam-stall and P/S light immunity):
   <https://technicalfnaf.fandom.com/wiki/(Fnaf_2)_Flashlight_Mechanics.>
