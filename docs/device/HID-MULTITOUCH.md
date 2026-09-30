# Android HID multitouch: the two traps

This note records the stock-device input work from 2026-08-24 so a later
session does not have to rediscover it. The target was a Moto g56 5G running
the official FNaF 2 Android v2.0.7 build, but both failures are general Android
HID concerns.

## Outcome

`/system/bin/hid` can drive reliable two-finger input without root. A verified
report stream held contact 0 on the camera-light control while contact 1 tapped
CAM 10, CAM 04, and CAM 07. The recording contained the complete
`10 -> 04 -> 07 -> 11` selected-camera trace while the light stayed down.

The working device fixture is
[`tools/device/hid-multitouch-smoke.json`](../../tools/device/hid-multitouch-smoke.json).
It is a **device action**: it selects 6th Night and injects touches. Do not run
it unless the game is focused and it is safe to start that night.

## AccessibilityService comparison disposition (2026-09-06)

The project searched for an online AccessibilityService-versus-UHID latency or
reliability benchmark and found none that measures the same endpoint. Android's
current framework can generate accessibility gesture steps at display-refresh
timing for newer target SDKs, so the old 100 ms warning does not apply directly
to Cue Helper's SDK-36 build. That improves the theoretical case for a
hostless AccessibilityService backend; it does not establish lower end-to-end
latency, contact continuation, or FNaF2 acceptance than this already-tested
UHID path.

Keep UHID as the in-night and menu-control baseline. The first real-game
AccessibilityService gate was run on the title screen: the framework callback
completed, but FNaF2 ignored the tap that UHID accepted. Do not promote the
AccessibilityService path until a new acceptance mechanism is demonstrated;
the evidence and test matrix are centralized in
[`ACCESSIBILITY-VS-HID-BENCHMARK.md`](ACCESSIBILITY-VS-HID-BENCHMARK.md).

## Night 6 strategy consequence

HID buys enough cycle time to change **where** Balloon Boy is detected; it does
not make Balloon Boy safe to ignore. The exact simulator's HID schedule with no
BB read or response survived **0/3000** Night 6 runs, predominantly through the
BB-to-Foxy failure chain.

CAM 05 is therefore not the selected Night 6 checkpoint. The project already
has a device-validated classifier for BB in the lit left opening, including two
independent positives and an untouched simultaneous BB/Golden-Freddy frame.
That check uses the left vent light, which does not consume flashlight battery.
The HID time saving belongs there: shorten the camera sweep, keep the
once-per-cycle left-opening read, and start the five-tick mask response only
when that read is non-empty. CAM 05 remains useful for calibration or strategy
comparison, not as a required step in the intended Night 6 controller.

This is a route decision, not a claimed clear. The phase-independent simulator
policy now survives **10000/10000** ordinary and **3000/3000** pinned-worst
Night 6 runs, with no missed BB state, a minimum 56% box, and a compact 267 ms
three-camera sweep. Its all-threat negative control fails, so the classifier
cannot safely fail closed on every cycle.

The 267 ms sweep in that result is an **idealized simulator actuator**, not a
phone result. Device trials below now prove that this distinction is
load-bearing. The former `HID_LEFT_SURVIVAL=1` pre-read probe was capped at four
cycles and is now retired from the device runner; it remains below only as a
historical measurement, not a selectable route.

## Night 7 sparse CAM 05 probe

Phase-aligning CAM 05 checks removes many unnecessary reads, but does not make
the measured lit-capture path affordable on 10/20 by itself. BB starts at CAM
10 and needs four successful five-second rolls to reach CAM 05, so 20.0 s is
the absolute arrival bound. A check immediately *before* that boundary is too
early: the first useful pre-boundary read completes just before 25 s (or it can
run immediately after 20 s). After a negative, every following five-second
boundary still needs coverage until BB is found.

A CAM 05 positive also does not guarantee that one raise will put BB in the
opening. His final hop retains the Night 7 75% movement roll. The controller
must lower across the opportunity, raise and read again, and repeat when he is
still on CAM 05; otherwise the nominal one-raise response silently fails one
time in four.

`tools/model/hid-device-pilot.mjs --night=7 --sparse-cam5` preserves those constraints.
With the current 520 ms lit-read model it survived **0/5000** ordinary and
**0/1000** pinned-worst nights: the battery reached zero and the resulting
failures were overwhelmingly Foxy. The same schedule with hypothetical unlit,
free reads survived **3000/3000** ordinary and **1000/1000** worst-luck nights,
with no missed BB states, proving that timing rather than route logic is the
barrier. It averaged 48.8 reads per ordinary night and 41 in worst luck.

A diagnostic 370 ms light hold survived **3000/3000 + 1000/1000**, but its
minimum remaining power was only 9 frames in the ordinary set. The phone needs
about 350 ms merely to draw a visibly lit vent, before screencap readiness, so
370 ms is an unvalidated and operationally fragile threshold—not a Night 7
controller claim. Sparse CAM 05 becomes viable only if an on-device immutable-
buffer test proves that acquisition bound with margin, or the base flashlight
cycle is made cheaper. Music-box time is not the limiting resource here.

### Cheaper phase-windowed left-opening candidate

CAM 05 is not the architecture floor. A sparse left-opening controller can use
the battery-free vent light, provided it controls the scheduler phase tightly:

1. Wait until BB can first have reached the opening.
2. Lower, clear a possible office Golden Freddy, and reset Foxy.
3. Acquire the free lit-left frame, then put on the prophylactic mask while the
   classifier finishes.
4. On an empty result, wind and land the normal late three-camera sweep. On BB,
   retain that mask through the aligned five ticks and recover before the prior
   camera stuns expire.

`tools/model/hid-device-pilot.mjs --night=7 --sparse-left` makes the dependency explicit.
At zero pilot offset it survived **10000/10000 ordinary and 3000/3000 pinned-
worst** nights with no missed BB state, a minimum 57% box, and **1257/3000**
flashlight frames remaining. A 340 ms offset survived another **1000/1000**;
345 ms survived only **1/1000**, overwhelmingly failing to Foxy. The useful
epoch window is therefore bounded between those measurements, not described as
generic timing tolerance.

That is a useful architecture upper bound, but it is **rejected for the stock
HID phone pilot**. Two independent device gates were measured rather than
inferred.

#### Scheduler phase: acquired

`DEVICE_EPOCH_LATCH=1` now detects the first immutable frame containing both
the top-right clock and full top-left flashlight meter entirely on-device. It
requires the signature on two consecutive frames but preserves the first
matching timestamp as T0. The two-part predicate matters: the first clock-only
version falsely triggered once on the bright title animation after four
captures, and the night watchdog correctly aborted it.

The confirmed detector produced last-clear → first-HUD brackets of **252, 312,
331, and 305 ms**. The asymmetric simulator phase sweep tolerates delayed T0
through about 340 ms but almost no early T0, so the conservative first-positive
edge is correct; midpoint interpolation is not. A 94-second recorded trial put
1 AM **69,950 ms** after the first office HUD, within the analyzer's 50 ms
resolution of the sourced 70,000 ms hour edge. `tools/device/clocktrace.mjs`
turns that relationship into an assertion.

MediaProjection can tighten this observation and replace the screencap loop,
but scheduler phase is no longer the unresolved blocker. Any replacement must
retain the originating image timestamp and the two-part false-positive gate.

#### Camera actuator: rejected

The ideal table needs CAM 10, CAM 04, and CAM 07 inside a 267 ms lit sweep.
Phone recordings rejected batched 267, 357, 477, and 597 ms gestures: early
forms rendered only CAM 07, wider forms accepted inconsistent subsets, and a
burst of `hid delay` commands did not behave as a cumulative macro. The
shortest repeatedly proven primitive remains wall-timed: 70 ms light settle,
100 ms contacts starting 240 ms apart, and **790 ms total**. A corrected staging
recording showed **2/2 complete 10 → 04 → 07 → 11 traces**.

`tools/model/hid-device-pilot.mjs --night=7 --sparse-left --device-sweep` models that
exact 70/240/240/240 ms device profile, shifts the late sweeps earlier, prevents
wind/contact overlap, and prices the later BB recovery. It survived **0/3,000
ordinary and 0/1,000 pinned-worst** nights; Golden Freddy, inside-office, and
Foxy failures show that the longer sweep destroys the stun bridge rather than
merely costing box time. `--assert-rejected` preserves this negative contract.

Therefore MediaProjection alone does not promote sparse-left: it improves the
observer, while the disproven component is now the actuator/policy combination.
The branch reopens only with a separately verified faster camera actuator or a
new exact-simulator policy built around the 790 ms sweep.

The perfect-vocal comparison is useful but not a fallback by itself. Counting
three source events before enabling the 520 ms CAM-05 path survived 3000
ordinary and 1000 worst-luck simulations, leaving at least 218 and 373 power
frames respectively. Forcing any single counted vocal to be missed made the
same policy survive 0/1000. Plan 08 therefore retains vocals as an occasional
visual-check arm or measured research signal, not as the now-unneeded primary
phase source and not as an audio-only route counter.

### Screencap readiness is observable

Starting `screencap` and masking after a fixed delay does not identify which
frame SurfaceFlinger captured. On this phone, a fixed 80 ms overlap returned
both a literal mask frame and an unlit-office frame. The useful boundary is the
first output byte: start `screencap` into a file while the left vent light is
held, poll until the file becomes non-empty, then release the light and put on
the mask while capture and classification finish. At that point the captured
buffer is immutable.

A three-cycle Night 6 staging run started capture in parallel with the vent
draw. The first byte arrived at +690 ms, +764 ms, and +761 ms from each cycle
anchor; all three retained frames classified as confident `empty` results.
The runner also locks its strategy capture against the safety watchdog and no
longer treats a transient unavailable watchdog capture as evidence that the
night ended. This validates the empty capture path only—not BB response timing
or a complete night.

## The Night 6 route, priced against the phone's actuator (2026-08-24)

Everything above prices the *Night 7* sparse-left candidate against the
790 ms device sweep. The **selected Night 6 route was never priced against it
at all**: `--device-sweep` refused to run outside `--sparse-left`, so the
10000/10000 Night 6 figure was always an idealized 267 ms actuator. It now
runs on the left route, and the route does not survive its own phone:

| Night 6 left-opening route | Result |
| --- | ---: |
| ideal 267 ms sweep (the published figure) | 1000/1000 |
| phone-proven 790 ms held-light sweep | **0/1000** |

Two independent things break, and the second is arithmetic rather than policy.

**The wind collapses.** The sweep has to land on the anchor, so a 47-frame
hold eats the clear's second wind window down to nothing; 838 of the first
1000 deaths were the Puppet at a 0% box.

**The flashlight cannot pay for the sweep at all.** A 790 ms lit sweep is 47
frames of light, 84 times in a night. That is 3948 frames against night 6's
sourced **3000**, before a single hall flash. No schedule containing it can
finish a night, whatever else it does.

### Pulsing the light instead of holding it

`stunCam` refreshes on *every frame* the camera light is on while that camera
is selected, so contact 0 does not have to stay down across the sweep. Select
the camera with contact 1, then pulse contact 0 for one 100 ms contact. Two
things follow: the sweep costs 18 frames of battery instead of 47, and the
70 ms leading light settle leaves the span, because the light no longer has to
be up before the first selection. The span becomes `2 * spacing + 100 ms`.

`--pulse-light` models this, with `--sweep-slot-ms=` for the spacing and
`--mask-margin-ms=` for the BB mask's phase margin. The device route briefly
dropped the Golden Freddy flick to recover wind, then restored it after the
input/video census identified the actual fault: the following monitor press,
not the mask toggle. `maskraise` now holds that seam at the measured-safe
180 ms inside one HID macro.

> **2026-08-25, corrected 2026-08-26: every route on this page is grounded by
> the model gate.**
> Nothing reaches the phone unless locally proven: before its first adb
> command, the runner replays the plan through the exact engine under ±60 ms
> of human slack (the measured plans/04 bracket floor) and refuses below the
> 40% replay contract. **46/100 was a favourable seed block:** the then-shipped
> route scored **449/1200 = 37.4%** and was correctly refused once the sample
> widened. The smallest supported repair was already latent in the policy: its
> first post-read hall pulse was omitted because the old +1.28 s slot landed
> inside mask-off and could not light. Carrying that same eight-frame pulse on the
> measured-safe `maskraise` compound resets Foxy without moving the read or the
> stun sweep, and scores **673/1200 = 56.1%** on the same seeds. Nights 1–5
> remain above contract at 99.1, 68.9, 78.8, 73.2, and 63.9 per cent
> (`tools/device/human-gate.mjs`; absolute, no override). A gap floor was the
> first form of this rule and was
> retired the same day: gap width never separated human from machine —
> precision does, which is exactly what error-injected replay measures. The
> pricing below remains correct and worth keeping: it establishes what the
> *machine* route costs, and that even the machine cannot land the ideal
> figures. `test-human-gate.mjs` pins the 1200-seed pass.
>
> Priced the obvious follow-up the same day: the route at the floor's own
> 350 ms slots is **0/200 in the exact simulator at every offset tried**
> (0/83/167/250/300), dying to stun-lapse office attacks — the sweep-span
> inequality below, not a tuning miss. The left-opening architecture cannot be
> slowed into human compliance; a human-executable night 6 needs a different
> route shape. `hidpilot n6 human reject` preserves the rejection.

### It still fails at the spacing the phone has proven

With the pulsed light the route survives night 6 at 240 ms spacing, but only at
**one scheduler frame**. The ideal route's window is 18 frames (about 300 ms);
`DEVICE_EPOCH_LATCH` brackets T0 to about 80 ms. A one-frame island is not a
schedule anyone can land.

The mechanism is a single inequality. Across the five-tick BB mask no camera
can be refreshed, so the same camera's stun must bridge from the pre-mask sweep
to the recovery sweep. That gap is `mask window + 27 frames + sweep span`, the
27 being mask-off plus monitor-raise. The stun is 400 frames and the movement
grid grants a few more. A five-tick mask that is robust to *any* tick phase
needs about 300 frames on its own, which leaves the sweep span about 18 frames
— **300 ms, for all three cameras**. The phone's proven 240 ms spacing spans
580 ms even with the settle removed.

Nothing else in the cycle can pay for the span, because the rest of it is
already at the sourced animation lengths (`MONITOR_ANIM_DOWN` 22, `MASK_ANIM_ON`
12, `MASK_ANIM_OFF` 15, `MONITOR_ANIM_UP` 12):

- the read cannot start before **a+22** — that is the monitor-down flip;
- the phone needs about 350 ms to draw a lit vent, so the frame is not there
  before **a+43**, and the prophylactic mask cannot precede it;
- the recovery's 27 frames are exactly mask-off plus monitor-up.

Nor can the mask be split across a sweep. g293 zeroes the counter on every
entry into the fully-on state, so the five ticks are a continuous hold, not
cumulative storage (`src/engine.js:380`, `tickMask`). The sparse Night 7 shape
is worse here, not better: it masks at a+88 instead of a+47, so its bridge only
fits the ideal 267 ms sweep — on night 6 it survives 21 phase frames ideal and
**no phase at all** at any device spacing.

Measured windows, 1000 ordinary and 300 pinned-worst nights per offset, min box
56%, min power 726:

| Camera spacing | Span | Mask margin | Perfect-phase window |
| ---: | ---: | ---: | --- |
| 240 ms (proven on this phone) | 580 ms | 600 ms | 2 frames — not landable |
| 160 ms | 420 ms | 800 ms | **6 frames (100 ms)**, offsets 11-16 |
| 120 ms | 340 ms | 900 ms | **12 frames (200 ms)**, offsets 5-16 |

So the blocker for a Night 6 device clear is now named and singular: **the
camera actuator's inter-selection spacing**. `tools/test.mjs --engine` keeps
both rejections (`hidpilot n6 device reject`, `hidpilot n6 pulse reject`) and
both 160 ms survivals so neither half can drift.

The open device gate is narrow enough to test directly, and
`tools/device/hid-sweep-probe.sh` (archived 2026-09-24, see
[`ARCHIVED-ROUTES.md`](../ARCHIVED-ROUTES.md)) was
that test: it drives CAM 10, CAM 04 and CAM 07 at each requested spacing with
the light pulsed *after* each selection, and grades the recording with
`camtrace.py`. The existing evidence does not answer the question — the
rejected forms were *batched* `hid delay` macros, and the accepted 240 ms
figure was the first wall-timed spacing tried, not a measured floor.

### Answered: the phone accepts 120 ms spacing (2026-08-24)

Three probe runs on the Moto g56, graded at the recording's native rate:

| Run | Spacings | Complete `10-04-07-11` sweeps |
| --- | --- | ---: |
| `hid-sweep-probe-1` | 240 / 200 / 160 / 120 ms | **4/4** |
| `hid-sweep-probe-160x4` | 160 ms x4, 100 ms contacts | **4/4** |
| `hid-sweep-160x4-c120` | 160 ms x4, 120 ms contacts | **4/4** |

So 120 ms spacing works, which is better than the 160 ms the policy needs and
gives the wider 200 ms phase window rather than the 100 ms one.

**The 240 ms figure was a measurement artifact, and so were the first readings
here.** `camtrace.py` decoded at 30 fps and required a 100 ms stable run, but
`screenrecord` captures at the panel's 60 fps. At 160 ms spacing every dwell
therefore reported as exactly 0.10 s — the floor — and any dwell that straddled
frame edges fell under it and read as a dropped selection. The same three
recordings scored 3/4, 1/4 and 2/4 at the default resolution and 4/4 at
`--fps 60 --min-ms 50`. Nothing about the input changed.

Treat "the shortest repeatedly proven primitive is 240 ms" as withdrawn: it was
established with the same 30 fps grader and never separated the actuator from
the detector. `tools/device/test-camtrace.py` now guards the gate that hid it.

### The shell's clock is 25x looser than the actuator's (2026-08-24)

Measured with a separate HID touchscreen aimed at empty wallpaper, no game
running, reading the kernel's own `getevent -lt` timestamps across 60 contacts
at an intended 120 ms period:

| | want | median | min | max | stdev |
| --- | ---: | ---: | ---: | ---: | ---: |
| DOWN->DOWN period | 120 ms | 120.1 | 116.4 | 121.9 | 0.76 |
| contact length | 100 ms | 99.9 | 97.0 | 101.5 | 0.80 |
| released gap | 20 ms | 19.6 | 18.5 | 22.1 | 0.66 |

`hid_delay` holds to about +/-2 ms. `wait_until` overshoots **49-93 ms** every
time, because `sleep` and `date` are fork+exec here: `sleep 0.02` costs 75 ms
wall and one `date` fork about 25 ms, so it sleeps to target-20 and then
busy-polls past it. (This measured the `date`-based loop. It was replaced with
a fork-free `/proc/uptime` read on 2026-08-26 — see "The fix is the fork"
below; the figures here are what that fix was measured against, not what the
runner does now.)

This matters more than the raw numbers suggest. Shifting the whole route late
is nearly free -- it survives 300/300 up to 100 ms and then falls off a cliff
to 0/300 at 110 -- but **jitter is what costs nights**: +/-10 ms around any mean
drops it to 204/300, and the phone's measured spread scores 152/300 against
282-300/300 for the hid clock. The mean can be dialled out with
`PILOT_OFFSET_MS`; the spread cannot.

So the steady cycles' post-read windows now run as a **single hid macro**: the
shell wall-times only the window's start and waits it out, and every boundary
inside is a `hid_delay`. That is one wall-timed boundary per 5 s cycle instead
of one per action. The window is capped at one cycle deliberately -- a macro
cannot be interrupted, so a longer one means input keeps landing on whatever is
in front for longer if the game dies mid-macro, and no simulator can price
that.

Two windows stay stepped, for reasons that are not performance: the shared
prefix contains the vent read, whose classifier lives in the shell, and the
opening has to absorb the epoch latch's slip out of a wind hold whose end must
not move. `run_macro` refuses both rather than running them wrong.

Note the released gap's own minimum was 18.5 ms against a 20 ms floor. The
sweep geometry below sits on its constraints with zero slack, and that is the
first place to look if a select goes missing.

### The shipped burst no longer matches the probed one (2026-08-24)

The probes above ran a burst that led the light pulse by 10 ms inside a 100 ms
select, leaving the pulse itself 90 ms. That is under the 100-120 ms this
document's own verified report sequence requires, and the contact floor in
`tools/device/test-hid-trace.mjs` was briefly lowered to 90 to accommodate it —
the wrong direction to move a device threshold.

Four constraints cannot all hold at once:

| Constraint | Source |
| --- | --- |
| selects 120 ms apart | the probe table above |
| 20 ms released between selects | Fusion polls touch per frame |
| select contact >= 100 ms | "Verified report sequence", above |
| light pulse >= 100 ms | same |

The first two fix the select at exactly 100 ms, so **any** positive light lead
puts the pulse under the floor. The runner therefore ships `SWEEP_LIGHT_LEAD_MS=0`:
the select and its light land in one report and both contacts get the full
100 ms. This is arithmetic, not a measurement — **the 4/4 result above does not
cover it.** Re-run `hid-sweep-probe.sh` before trusting a device run, and if a
zero lead turns out to miss selections, the conflict is real and one of the four
constraints has to be retracted with evidence rather than quietly shaved.

**Probed, and it holds (2026-08-24, same day).** `LIGHT_LEAD_MS=0 CONTACT_MS=100
hid-sweep-probe.sh 120 120 120 120`, graded on both signals:

| Grader | Answers | Result |
| --- | --- | --- |
| `camtrace.py` | was the select missing? | 4 complete `10-04-07-11` sweeps, 0 incomplete starts |
| `sweepcheck.py` | was the select present but unlit? | 4/4 flashed all of 10, 04, 07 |

Neither fired, and the lit-frame counts (5-6 / 5 / 4-6) are healthier than the
10 ms lead runs, which is what a 100 ms pulse instead of a 90 ms one should look
like. The two failure modes are graded separately on purpose: a dropped select
and a dark select point at different fixes.

The paragraph above stands as written rather than being deleted, because the
reasoning that produced it is still the reason the geometry has zero slack.
**Twelve selects is not eighty.** A night runs roughly 80 sweeps, and the
released gap's measured minimum is 18.5 ms against a 20 ms floor, so this
probe fails to reproduce the concern at its sample size rather than retiring
it. The night recording is the larger sample and grades the same two ways.

### The full-night trace buys one released poll (2026-08-27)

The larger control is now recorded. `n1-elegant-0055` sent 42 contacts apiece
to CAM 10, CAM 04 and CAM 07. Its HID trace measures every contact at 100 ms,
with the light down for the same whole interval, and finds no malformed or
latched report. A native-frame selected-button walk still contains one
plausible missing CAM 07 transition around 238 s. That observation cannot prove
the game's internal stun failed, but it rules out a missing or shortened host
contact and leaves the 20 ms released interval as needless exposure to Fusion's
30 Hz touch poll.

The shipped actuator therefore uses **133 ms slots**: 100 ms down, then 33 ms
fully released. This is only 13 ms slower per selection and is deliberately the
smallest geometry that contains a whole released poll. It is not a new model
policy: `MODEL_SLOT_MS` remains 120, while `devicePlan()` moves the three-camera
sweep's start 26 ms earlier and preserves its end. The full 1200-seed gates
remain above contract on Nights 1-6, including 648/1200 on Night 6 against the
unchanged 480/1200 bar.

### What the shell's clock actually costs, and the two-frame budget (2026-08-26)

The section above measures `wait_until`; this one prices it. The answer is that
the shell's clock is not *a* contributor to the actuator cliff — on this route
it is the whole of it, and the budget it has to fit into is a **frame count,
not a millisecond figure**.

`tools/latenesssweep.mjs` sweeps `tools/device/actuator.mjs`'s lateness band
across Nights 1–7 at the `hidpilot n6 target` settings, 200 seeds a cell.
**Every number here is a simulator number** — the actuator models launch
lateness and the mask seam and nothing else. Two controls make the table
readable rather than merely favourable, and `--assert` fails on either: the
zero row must reproduce the exact figure (200/200 every night), and the
110–300 ms row must reproduce plans/12's published table.

| band, per wall-timed anchor | frames | n1 | n2 | n3 | n4 | n5 | n6 | n7 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 ms (the control) | 0 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| **0–10 ms, fork-free `/proc/uptime` loop** | 0–1 | 200 | 200 | 200 | 197 | 200 | **171** | **25** |
| 0–40 ms | 0–2 | 200 | 199 | 199 | 196 | 198 | 179 | 26 |
| 0–42 ms | 0–3 | 190 | 177 | 167 | 168 | 147 | 124 | 16 |
| 0–50 ms | 0–3 | 138 | 58 | 35 | 41 | 14 | 8 | 0 |
| **49–106 ms, the shipped `date` loop** | 3–6 | 72 | 0 | 0 | 0 | 0 | 0 | 0 |
| 110–300 ms, `actuator.mjs`'s default | 7–18 | 23 | 0 | 0 | 0 | 0 | 0 | 0 |

**The knee is at the 2-to-3 frame boundary and it is a cliff.** Uniform
lateness is free to 41 ms (2 frames, 200/200 on every night) and collapses at
42 ms (3 frames: n6 10/200, n7 0/200). A per-anchor re-roll behaves the same
way: anything inside 0–40 ms holds, and 0–50 ms is already gone. The
millisecond thresholds are only meaningful to ±8 ms, because the model
quantises every draw to a 60 fps frame — quote the frame count.

**Halving the mean buys nothing, and that is not the interesting failure.**
205 → 110 ms leaves Nights 2–7 at 0/200; so does 205 → 83 ms. Nor does the
spread help while the mean is high: at a 205 ms mean, ±0 and ±95 ms are both
0/200 on every night but the first. That retires `actuator.mjs`'s header claim
("the mean is nearly free … the SPREAD costs nights") for this route, as
plans/12 already began to. **Both are the same statement**: what matters is
total displacement in frames, and 205 ms is 12 frames before any spread is
added.

#### The fix is the fork, and it has been measured on the phone

`wait_until` sleeps to 20 ms before target and then busy-polls `date +%s%3N`.
A device probe on 2026-08-26 timed the pieces:

| | cost | note |
| --- | ---: | --- |
| `date +%s%3N` | **21 ms** | fork+exec; 100 calls in 2126 ms, consecutive-gap max 35 ms |
| `sleep 0` | ~20.8 ms | fork+exec, same class |
| `read u _ < /proc/uptime` | **0.36 ms** | builtin + redirect, no fork; 100 reads in 36 ms |

So `wait_until`'s granularity *is* one `date` fork, and its landing error is
that plus the final `sleep`'s own fork. Re-probed against 20 targets 200 ms
apart it lands **49–106 ms** late, reproducing the 49–93 ms above — this time
**with the game running a live Night 1**, which is the control the original
bench measurement (empty wallpaper, no game) did not have. Widening the
busy-wait window does not fix it, because the fork cost is per iteration:
thresholds of 40/100/150/250 ms give mean errors of ~67/37/32/36 ms.

The same loop against `/proc/uptime` landed **0 ms late on 15 of 15 targets**,
also with the game running. "0" means within one 10 ms centisecond tick, not
sub-millisecond. That is 0–1 frames, inside the two-frame budget with margin.

Three things this does **not** yet establish, and none should be assumed:

- **It changes a clock domain.** `/proc/uptime` is monotonic while `T0`, every
  log line and the HID trace alignment are epoch ms from `date`. plans/09
  tracks those domains explicitly; the swap needs the crossing measured, not
  inferred.
- **A bare shell loop is not the runner.** The real cycle also runs `hid_mark`,
  the HID writes and the classifier. The per-boundary cost with those in the
  loop is unmeasured.
- **`read -t 0.02 < /dev/null` is not a fork-free sleep.** It returns instantly
  on EOF — 20 nominal 20 ms sleeps took 12 ms in total.

**Landed 2026-08-26.** `wait_until` and every press timestamp in
`trial.sh` now read `/proc/uptime` instead of forking `date`; `T0`
itself stays a `date +%s%3N` epoch value, because that is what joins to
`screenrecord` PTS and to host-side artifacts. The two are latched one builtin
apart at the epoch confirmation.

Of the three caveats above, only the first is answered. The clock crossing is
no longer inferred: the run's manifest declares `runner_monotonic_ms` and
carries a `runner_monotonic_ms → device_shell_wall_ms` alignment edge whose
offset is `T0` and whose residual is `/proc/uptime`'s own 10 ms tick, so the
axis every log line and HID `mark` is measured on is named rather than assumed
(plans/09 package 2). The second and third stand: **the per-boundary cost with
`hid_mark`, the HID writes and the classifier in the loop is still unmeasured**,
and the landing error above was measured with a bare shell loop, not with the
runner. The phone was in use by another stream when this landed, so nothing
here is confirmed against the shipped runner on hardware. Until it is, the
0–10 ms row in the table above is what the change is *aimed* at, not what it
has been shown to achieve.

#### What it would be worth, stated honestly

Inside the budget the route recovers **Nights 1–5 outright** (197–200/200) and
Night 6 to **171/200**. Night 7 goes 0 → **25/200** and stays a one-frame phase
island, which is the same thing plans/12 found from the other direction: moving
the cycle-opening `tap monitor` by +16 ms takes exact Night 7 replay from 20/20
to 0/20. **The clock fix is not a Night 7 clear and must not be sold as one.**
It unblocks the ladder up to Night 6; Night 7 still needs a route whose sweep
tolerates a frame.

#### Why the macro architecture is load-bearing to the frame

`--ablate` delays one class of press and leaves the rest exactly on time. It is
a diagnostic, not a phone model — the phone is late on every boundary it
wall-times — but it says something the aggregate cannot:

| | n1 | n2 | n3 | n4 | n5 | n6 | n7 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **everything** +1 frame | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| only the monitor press +1 frame | 200 | 112 | 200 | 200 | 53 | **0** | **0** |
| only the sweep +1 frame | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| only the sweep +2 frames | 200 | 54 | 61 | 21 | 0 | 0 | 0 |

Delaying *everything* by a frame is free; delaying the **monitor press alone**
by one frame kills Nights 6 and 7 outright. The mechanism is visible in the
counts: 280 camera selects land while the monitor is still `raising` and the
engine throws them away — the zero-margin `MONITOR_ANIM_UP` collision this
document's sibling already found in the plan and gated with
`test-device-input-gaps.mjs`.

So the cliff is **relative displacement, not lateness**. That is precisely the
error mode the single-macro-per-cycle architecture exists to prevent: inside a
macro every boundary is a `hid_delay` at ±2 ms, so the monitor press and the
sweep that follows it share one draw and cannot slide against each other. This
table is what a regression to per-press wall-timing would cost — the same
regression that once drifted a cycle anchor 434 ms — priced to the frame. Two
frames of *uniform* budget is what the shell has to hit; zero frames of
*differential* is what the macro already guarantees.

## Trap 1: UHID open is earlier than Android input readiness

The `hid` command returns from registration after the kernel sends
`UHID_START` and `UHID_OPEN`. That does not mean `InputReader` has attached the
new touchscreen. On this phone the measured gap was about **5.1 seconds**:

```text
01:20:41.483  hid process opens/registers the UHID device
01:20:46.585  InputReader: Device added ... sources=TOUCHSCREEN
```

Reports sent in that gap are silently lost. A two-second sleep therefore
registered a touchscreen that Android could list later, while every early game
input appeared to do nothing.

Do not pay this delay inside a live night. Start the persistent HID process on
the title screen, then gate on the device name appearing in `dumpsys input`.
Only start the night after that framework-level readiness signal. A fixed
seven-second delay is acceptable for an isolated fixture; the real runner
polls readiness with a timeout.

This is the same distinction called out by AOSP's
[`hid` documentation](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/cmds/hid/README.md):
kernel readiness does not account for inputflinger, and a controller must wait
for the input-device-added notification before issuing reports.

## Trap 2: Contact Count describes records in the packet

The report descriptor carries two finger collections. Each finger occupies
five bytes:

```text
flags/contact-id, X low, X high, Y low, Y high
```

The low two flag bits are Tip Switch and In Range. The upper six bits are the
Contact Identifier. Therefore these are the important first bytes:

```text
0x03  contact ID 0 active
0x07  contact ID 1 active
0x00  contact ID 0 inactive
0x04  contact ID 1 inactive
```

The failed stream changed from two active fingers to one like this:

```text
contact_count = 1
ID 0 active
ID 1 inactive
```

Linux stopped after consuming the one record promised by `contact_count`, so
it never read ID 1's inactive record. Contact 1 remained down. Later camera
"taps" became `ABS_MT_POSITION` moves in the same slot, and even the nominal
all-up packet released only contact 0.

The working transition includes both records even though only one remains
active:

```text
contact_count = 2
ID 0 active at the held light coordinate
ID 1 inactive at its last camera coordinate
```

That produces `ABS_MT_TRACKING_ID = -1` for slot 1. The next camera packet can
activate ID 1 again and receives a fresh tracking ID. Releasing everything uses
two inactive records for the same reason.

This matches Linux's hybrid multitouch implementation: the contact-count field
sets how many contact collections the driver expects to consume from the
report. It also matches mature automation interfaces such as
[`minitouch`](https://github.com/DeviceFarmer/minitouch), which model every
contact's down/up lifecycle explicitly and warn that a lost touch-end corrupts
the stream.

## Trap 3: a zero-length delay is a fatal command, not a no-op

`hid` does not treat `{"command":"delay","duration":0}` as "wait for nothing".
It rejects the duration outright, and the rejection kills the whole process:

```text
E HID: HID injection failed.
E HID: java.lang.IllegalStateException: Delay has missing or invalid duration
E HID:   at com.android.commands.hid.Event$Builder.build(Event.java:220)
E HID:   at com.android.commands.hid.Event$Reader.getNextEvent(Event.java:298)
E HID:   at com.android.commands.hid.Hid.run(Hid.java:76)
```

Because the runner drives `hid` as an mksh co-process, the death is silent
until the *next* write, which fails with `print: -p: no coprocess`. Everything
the current action still had to send -- the rest of its hold, its release --
is never written.

This cost night 6-22 at 18 s, and its signature on the phone was not a timing
error but a dead control. `plan_emit`'s `hallraise` branch emitted the light
lead with `hid_delay "$SWEEP_LIGHT_LEAD_MS"`, and that lead is **0** in the
shipped zero-lead sweep geometry. So the hall light went down, the delay killed
`hid`, and the hall's own 133 ms hold and release never arrived. The device
owner watching the phone reported it before any log was read: *"fails to press
hall light and moves the vision instead"* -- a two-contact touch that changes
coordinates and vanishes in the same frame is a drag, so the office view panned
instead of the light coming on. The trace auditor found both halves:

```text
contact 0 at 1200,540 held 0 ms (floor 100)     <- the hall light
contact 1 at 144,801 held 0 ms (floor 100)      <- the monitor raise
```

Note what made this reachable: `pulsed_cam_burst` already guarded the same
variable with `if [ "$SWEEP_LIGHT_LEAD_MS" -gt 0 ]` and `hallraise` did not.
One guarded call site and one unguarded, on the same value. It also needed both
of two independent changes to appear at all -- the macro emitter, which turns
scheduler gaps into `hid_delay` commands, and the zero light lead. Neither
alone emits a zero delay, which is why two green test suites missed it.

### Four gates, because one is not enough

- **The call site** refuses to write it: `[ "$SWEEP_LIGHT_LEAD_MS" -le 0 ] || hid_delay ...`.
  The emitter is the only place that knows a zero is *legitimate* (a zero lead)
  rather than a *defect* (a zero gap between two different buttons, which is
  the 0 ms released failure this document spends its length on).
- **`hid_delay` itself** returns early on a non-positive duration. A fatal,
  silent, co-process-killing failure deserves a backstop even so.
- **`tools/device/test-plan-interpreter.sh`** fails on any emitted
  `hid_delay <= 0`, and was verified to fail on the pre-fix code before it was
  fixed, so the assertion is not passing vacuously.
- **`tools/device/test-hid-trace.mjs`** reports a zero-length delay as a
  problem, and its self-test requires that it be caught alongside the short
  contact, the zero-gap button change and the latched contact.

The last one is the one that matters most, and the reason is general: a
stubbed interpreter advances a *virtual* clock by 0 quite happily, so no model
of the phone can see this class. Only the artifact can. A delay is a command
that can be rejected, not merely an interval.

## Verified report sequence

For a held-light camera tap:

1. Send one active record for ID 0 at the light coordinate.
2. Send two active records: ID 0 unchanged, ID 1 on the camera button.
3. Hold for at least 100-120 ms so the 30 Hz Fusion runtime sees it.
4. Send a two-record packet: ID 0 active, ID 1 inactive.
5. Repeat steps 2-4 for the next camera.
6. Send a two-record packet with both IDs inactive to release the light.

The kernel trace must show a new `ABS_MT_TRACKING_ID` for slot 1 followed by
`ffffffff` before the next camera. Merely seeing two Android pointer dots is
not sufficient evidence.

## Coordinate mapping on this phone

The virtual descriptor uses 2400x1080 axes, but InputReader exposes it through
the phone's portrait-natural display before rotating the landscape game. The
measured inverse transform from game coordinates is:

```text
rawX = (1080 - screenY) * 20 / 9
rawY = screenX * 9 / 20
```

Keep this device-specific mapping in the controller. Recalibrate it for a
different resolution or orientation.

## Evidence and limits

- The corrected kernel trace emitted independent slot-1 down/up pairs for all
  three camera buttons.
- `camtrace.py` found CAM 10 for 0.30 s, CAM 04 for 0.30 s, CAM 07 for 0.63 s,
  then CAM 11: one complete sweep and no incomplete starts.
- This proves the multitouch primitive, not a complete Night 6 strategy.
- A subsequent 130-second run collected 25 clean unlit CAM 05 frames. They
  were visually unusable for BB detection, confirming the device owner's
  observation. The earlier unlit idea came only from ambiguous video/action
  timing and is rejected; `BB_CAM05_UNLIT` remains a negative-control capture
  switch, not a survival path.
- Omitting every BB read/response is also rejected (0/3000 exact Night 6
  simulations). The intended replacement for CAM 05 is the validated lit
  left-opening read, not a blind cycle.
- The phase-safe left-opening policy passes 10000 ordinary and 3000 worst-luck
  exact Night 6 simulations. Device evidence currently covers only three empty
  classifier cycles; the older staged response table is not a clear claim.
- It does not imply the same flashlight-power budget is affordable on 10/20
  Night 7. The current scope is Night 6.

### Open: the tick rate is asserted twice and measured never (2026-08-26)

**This is an open item, recorded here because it kept falling out of the places
that track open items.** `ARCHITECTURE-AUDIT.md` filed it as a note that
deferred to `plans/PROGRESS.md`'s next step; PROGRESS then moved on to a
different thread and stopped mentioning it. It now lives on the page that owns
device timing, where the constants it governs are.

Two rates are stated as fact and neither is sourced to a measurement:

- **60 FPS**, `src/config.js:23`. Every sourced duration, camera stall, fuse
  and animation frame count in the engine is in 60ths.
  `SOURCE-DUMP-GUIDE.md:316` calls it "the 60 fps assumption" and
  `ANDROID-SOURCE-STATUS.md:554` labels a derived figure `[INFERRED — sourced
  constants, assumed 60 fps]`.
- **30 Hz**, as "one 30 Hz Fusion poll is 33 ms", asserted in `recipe.mjs`,
  `actuator.mjs`, `trial.sh` and six tests, and at line 688 above — as
  though sourced. Nowhere in the repository is it measured or derived.

They may both be right: render rate and touch-poll rate are different things,
and Fusion's own "poll touch per frame" would make them the same number rather
than two. But nothing here says which, and the difference is load-bearing in
**both** directions. At 60 Hz the emitter's enforced 33 ms gaps spend twice the
cycle budget they need, and the route is short of exactly that budget — Nights
5-6 have 192 frames of flashlight headroom. At 30 Hz a "one-frame phase island"
is not something a phone can land on, and the Night 7 route depends on landing
one.

Price nothing new against either number until one of them is measured. The
cheap experiment is `hid-raise-probe.mjs`'s shape: sweep the inter-selection
gap and find the quantum the accept/reject boundary snaps to.

**Half-closed 2026-08-26:** the *recording* rate is no longer assumed.
`grade-run.sh` now probes the capture with `ffprobe` and refuses when it is not
the 60 fps every grader below it is run at. There had been no `ffprobe`
anywhere in the repository, while the graders disagreed among themselves —
`grade-run.sh` passes `--fps 60`, `camtrace.py` defaults to 30,
`desync-scan.py` decodes at 30/20/4. That disagreement is not hypothetical: a
30 fps decode of a 60 fps capture is what produced the **withdrawn 240 ms
inter-selection figure**, since every dwell reported as the 0.10 s floor and
read as a dropped selection. The fix applied at the time was to pass `--fps 60`
at the call site, which left the defaults in place and the assumption
unchecked. It is checked now. The *input* poll rate above remains open.

---

## Prior art: is any of this a solved problem elsewhere? (2026-08-26)

A literature survey, not a measurement. Nothing here was run on the phone.
**The integral report this section distils is retained at
[`docs/research/ANDROID-BOT-LANDSCAPE.md`](../research/ANDROID-BOT-LANDSCAPE.md)**
— 24 named projects with their see-with/act-with/alive-dead, the per-family
analysis, and the closest analogues. Read that before re-asking any of this.

It exists because this project had never checked whether its central
architectural bet — a **physical, stock, unrooted handset driven by raw HID touch injection,
reacting in real time** — is a normal thing to do or an unusual one. It is
unusual. Sources are cited so the claims can be re-checked; where the evidence is
a forum post rather than code it says so, and where nothing was found it says
that instead of guessing.

### The short answer

**The combination has one public precedent, and it is archived — but be precise
about how much of a precedent it is.**
[`kvarenzn/phisap`](https://github.com/kvarenzn/phisap) drove Phigros and Arcaea
on an unrooted physical handset in hard real time. Its **default** transport was
scrcpy's control protocol, and that is what its setup instructions require. The
HID path was **opt-in and late**: added in v0.18 (2023-08-12) as backend
`otg/hid`, a 10-contact **AOAv2** touchscreen it wrote itself with the report
descriptor documented in its `hid.md`. Its stated reason was not speed but
avoiding USB debugging — 可以一定程度上避免某些游戏的作弊检测, "to some degree
avoid some games' cheat detection".

Its author pointedly did **not** claim a latency win from it: 或许可以一定程度上
提升触控事件发送效率（？待确认） — *"may somewhat improve touch-event send
efficiency (? to be confirmed)."* **The only person who has built this never
confirmed HID was faster.** That is the single most useful sentence in the
survey, and it is a caution against assuming the actuator is where our wins are.

The HID backend broke on Android 13 — AOAv2 multitouch registration simply fails
— roughly 13 months after it was added, was never fixed, and the repository was
archived on 2024-03-07. The project's real-time results predate the HID backend
entirely.

Everything else in the field is one of: emulator + adb; physical device + adb
for a *turn-based* game; an on-device accessibility service (also turn-based); a
hardware actuator against the glass; or an in-process memory hook. The two other
real-time cases found — phisap and Autodori — are rhythm games that **read the
chart file and replay a precomputed schedule**. They never sample the screen.
The only screen-reading real-time bot located is a 2016 Piano Tiles robot that
used *four stepper motors and an external 120 fps camera*, because reading the
tablet's own framebuffer fast enough was not on the table.

### The one result that changes how we should think about `hid-multi`

Android **deliberately** stamps injected input with `deviceId = -1`. The claim
carries weight, so here is the source rather than a paraphrase:
`InputDispatcher.cpp:4847` — *"For all injected events, set device id =
VIRTUAL_KEYBOARD_ID. The only exception is events that have gone through the
InputFilter"* — with `DeviceId resolvedDeviceId = VIRTUAL_KEYBOARD_ID;` on
:4853, overridden only under `POLICY_FLAG_FILTERED`. `VIRTUAL_KEYBOARD_ID = -1`
is at [`include/input/InputDevice.h:426`](https://android.googlesource.com/platform/frameworks/native/+/main/include/input/InputDevice.h),
and the same convention shows twice more: `InputDevice.isVirtual()` is
`return mId < 0`, and `KeyCharacterMap.VIRTUAL_KEYBOARD = -1`.
`InputEvent.getDeviceId()` is public API. Accessibility-injected gestures
additionally carry `FLAG_IS_ACCESSIBILITY_EVENT = 0x800`; `getFlags()` is public,
so `(ev.getFlags() & 0x800) != 0` is a one-line, permissionless bot check.

Per a scrcpy contributor in
[PR #3758](https://github.com/Genymobile/scrcpy/pull/3758): *"Android set device
id of all injected events to -1, unless the event is from InputFilter... The
only method to get real device id is using AOA HID or uinput."*

So every mainstream alternative — `adb shell input`, MaaTouch, scrcpy's `sdk`
mode, Airtest's maxtouch, minitouch — is on the detectable side of the only
detection line anyone has documented, and **`hid-multi` is not.** That property
was not why this route was chosen (it was chosen because short taps get dropped
and `input` costs a fork), but it is a real second reason to keep it.

**And the portability warning does not transfer — checked, not assumed.** phisap
died of **AOAv2**, a USB-accessory gadget negotiated over the cable from a host;
its author never diagnosed that Android 13 failure — the sticky notice says he
was still investigating and there are no later entries. A *separate* and
well-documented class of AOA-HID failure does trace to vendor kernels omitting
`raw_request()` in `f_accessory.c`, which scrcpy's author maintains a whole
repository about ([rom1v/aoa-hid-bug](https://github.com/rom1v/aoa-hid-bug)).
Two independent ways for the same transport to fail; joining them into one
diagnosis would assert something nobody established. This project does
not use AOAv2. `trial.sh:1351` runs **`/system/bin/hid`**, which creates a
**uhid** virtual device *on the device itself* — the same mechanism behind Trap 1
above, where `UHID_OPEN` returns before `InputReader` enumerates the touchscreen
five seconds later. uhid gets the same real-`deviceId` property without the
USB-gadget dependency that killed phisap's backend.

One difference worth knowing, since it is not the identity property: phisap's
descriptor declared **ten** contacts; ours at `trial.sh:1351` declares
**two** Finger collections. Two is what the route needs — every compound row in
the plan is at most a two-finger chord — but if a future route ever wants a
third simultaneous contact, the descriptor is where that is decided, not the
schedule. That is a better position
than the one public precedent had, and it is worth knowing we are not standing
where it fell.

### phisap's actual lesson, which is uncomfortably close to today's

Its author shipped a working 1 kHz HID touchscreen and then could not tell what
time it was inside the game. The timer is started **by a human pressing space**
as the first note approaches, with a manual offset, and the README's standing
request to strangers was for a way to read song progress without root.

Its diagnostic rule is this repository's graded-interval rule in miniature:
*Full Combo but not All-Perfect **always** means the timer sync is off, never the
plan.* Read that against `RUN-TELEMETRY.md` §10, where today's run put T0 exactly
2^32 ms low and nothing but the driver log noticed. **The nearest thing this
project has to a solved version of phisap's open problem is the cue helper and
the epoch latch** — the parts that answer "where am I", not the parts that press.
Actuation was never the bottleneck for the one person who tried this before.

### Where our measured numbers sit against the field

Corroboration, not validation — these are other people's devices:

| Ours | Field | Source |
|---|---|---|
| `screencap` **225 ms** | `adb screencap` **~350 ms** on an accelerated emulator with "pretty beefy hardware"; an MJPEG server ~150 ms | [appiumpro](https://appiumpro.com/editions/83-speeding-up-android-screenshots-with-mjpeg-servers) [V] |
| cue helper **59 ms** device-local | nothing published for a physical handset beats it; minicap self-reports 10–40 fps and "one to a few frames behind" | [DeviceFarmer/minicap](https://github.com/DeviceFarmer/minicap) [V] |
| ≥**100 ms** bare contact | Unity's own manual: *"If you read out touch state from `Touchscreen` directly inside of `Update`... your app will miss changes in touch state."* | [Unity Input System 1.7, "Touch support"](https://docs.unity3d.com/Packages/com.unity.inputsystem@1.7/manual/Touch.html) [V] |
| ~680 ms free per cycle | Alas grades a click <100 ms and a screenshot <300 ms as "Fast"; its scale only reaches "Insane Fast" below 25 ms | [Alas benchmark.py](https://github.com/LmeSzinc/AzurLaneAutoScript/blob/master/module/daemon/benchmark.py) [V] |

The 225 ms figure landing where the literature says it should is a small
independent check that this project's measurement rig is honest.

### The negative analogue, in its own words

**Alas — one of the most engineered bots in the field — abandoned physical
handsets in writing.** Its wiki: 在安卓真机运行 Alas 的方案已经被放弃 ("the scheme
for running Alas on a real Android device has been abandoned"), and of the
split-device variant: 真机截图也是非常慢 ("screenshotting a real device is also
very slow"), the screen cannot be off, and thermal wear costs more than a cloud
phone. MAA says physical ADB *"has lower stability... Not recommended"* and that
device-specific bugs will not be fixed. The fastest capture paths in the field
(`nemu_ipc`, `ldopengl`) are **emulator-exclusive by construction**, reading the
guest framebuffer out of shared memory.

The one large-scale physical-handset success is
[FGA](https://github.com/Fate-Grand-Automata/FGA) (Fate/Grand Order):
MediaProjection + OpenCV + AccessibilityService, entirely on-device, no adb
round trip at all. **It works because FGO is turn-based** — and every gesture it
sends carries `FLAG_IS_ACCESSIBILITY_EVENT`.

### Two honest negatives, stated rather than filled in

- **No documented case was found of an Android game detecting a bot by input
  *timing*.** Detection in every source located is by input *identity*
  (`deviceId`, accessibility flag, Play Integrity's `KNOWN_CAPTURING` /
  `KNOWN_CONTROLLING` verdicts), which is cheaper and exact. This is
  `UNKNOWN(not found in the searches run)`, not "does not happen" — and it does
  **not** license relaxing the human gate, which exists because a run this
  project cannot defend as human-executable is not evidence about a human
  strategy. It only means the gate's justification is that argument and not a
  ban-avoidance one.
- **The widely circulated per-method latency table for Alas has no primary
  source.** The confident version on DeepWiki is LLM-generated and contradicts
  the repository's own config. Do not cite it.

### What this survey does not say

It does not say the architecture is right — it says it is rare, that the one
person who tried it stopped for a reason that does not apply to us, and that the
part of the problem he could not solve is the part this project has spent most
of its effort on. The survey read public code and docs; it ran nothing on a
phone, and no number above is a measurement of this handset.

---

## Input injection and sequential budgets, against the platform source (2026-08-26)

A second literature pass, companion to the prior-art section above. Nothing here
was run on this phone. **The integral report is retained at
[`docs/research/ANDROID-INPUT-AND-OBSERVATION.md`](../research/ANDROID-INPUT-AND-OBSERVATION.md)**
— the full injection ladder, the sequential-budget analysis against kernel and
AOSP source, the observation-cost decomposition, and the ranked verdict. Where a claim is read out of AOSP or kernel source it is
labelled **SOURCE** — a fact about the implementation, not a timing measurement;
**MEASURED** carries a method; **COMMUNITY** is a forum or vendor assertion;
`UNKNOWN(reason)` means the number does not exist in public.

Its purpose was to test whether this project's actuator numbers are physics or
local artifacts. Three are corroborated, three are corrections, and one is a
number the platform does not impose at all.

### Corroborated — do not spend effort re-litigating these

- **The ≥100 ms contact is an *engine* constraint, and this repository already
  states it correctly.** Unity, first-party: *"If a touch is shorter-lived than a
  single input update, `Touchscreen` may overwrite it"* and *"If you read out
  touch state from `Touchscreen` directly inside of `Update` or `FixedUpdate`,
  your app will miss changes in touch state."* libGDX: *"If you rely on polling,
  you might miss events, e.g. a fast paced key down/key up."* Godot has the same
  issue filed twice. CLAUDE.md's "Fusion polls touch per frame" is the right
  justification. **[SOURCE/first-party docs]**
- **The mask-seam diagnosis is right, and the framework rules out the
  alternative.** Only `ACTION_MOVE` and `ACTION_HOVER_MOVE` are batched —
  `InputTransport.cpp` starts a batch on those actions alone and `canAddSample()`
  refuses a differing action. **`ACTION_DOWN` and `ACTION_UP` are never coalesced
  or dropped by Android.** Two events 10 ms apart both arrive. So the 9-of-14
  desyncs from "a monitor press within 180 ms of a mask press" cannot be
  framework coalescing; it is the hit-testing/visibility problem this repository
  already concluded it was — the monitor bar is not drawn, so the press is
  delivered to whatever window *is* there. **[SOURCE]**
- **Observation costs far more than action, structurally.** Mobile-Env
  ([arXiv:2305.08144](https://arxiv.org/abs/2305.08144), rig fully specified)
  measured `TOUCH` at **410 µs**, `LIFT` at **412 µs**, a screenshot at **19.9
  ms**, a view-hierarchy read at **2.53 s** — a screenshot is ~48× a touch and a
  hierarchy read ~6,200×, over the *same* transport, which isolates the
  asymmetry cleanly. scrcpy's author: *"The time to forward the event is
  insignificant"* — its entire advertised latency budget is observation.
  **The corollary is a correction to folklore worth carrying: "acting is
  expensive on Android" is an artifact of `adb shell input`'s process startup,
  not of injection.** Against a resident actuator, acting collapses to
  sub-millisecond; observation does not collapse the same way. The asymmetry
  this project is built around is *wider* than assumed, which argues for the
  design. **[MEASURED, emulator]**

### Correction 1 — the 240 ms spacing has no platform basis either

Independent of this repository's own 2026-08-24 retraction (§"Answered: the
phone accepts 120 ms spacing"), the survey found **nothing in Android, evdev,
uinput, InputReader or InputDispatcher that imposes any inter-press floor.**

`drivers/input/evdev.c`: a userspace write lands in `input_inject_event()` in a
tight loop with `cond_resched()`; there is no rate limit and no per-event delay,
only a 4096-byte cap per write. AOSP's *own* synthesised swipe runs at
`SWIPE_EVENT_HZ_DEFAULT = 120` — 8.33 ms between MOVE events. RERAN
([ICSE 2013](https://ieeexplore.ieee.org/document/6606553/)) replays raw event
streams on real phones at **3.87 ms median, microsecond-accurate**.

Two independent lines therefore agree the 240 ms was never a device limit. The
repository's engine used `DEVICE_SPACING_MS = 120` at the time; **CLAUDE.md was
the last place asserting 240 as proven and was corrected.** The later 133 ms
actuator is a one-poll safety margin, not a platform floor. **[SOURCE + MEASURED]**

### Correction 2 — the `input tap` rationale is true only up to Android 11

`SOURCE`, verified per release branch. Up to Android 11, `cmds/input/input` is
`exec app_process ... com.android.commands.input.Input` — a full ART start per
invocation, which is rom1v's *"the main delay is step 6 (starting the Java
process)"*. From Android 12 it is `input.sh` → `cmd input` → binder into
`InputShellCommand`, **already running in system_server**. The JVM cost is gone.

`input` is still unusable here, for reasons that do not depend on the version:
it injects with `INJECT_INPUT_EVENT_MODE_WAIT_FOR_FINISH` (synchronous, coupling
the injector to the target's frame loop) and **has no multitouch verb at all**.
But if any page justifies the HID route by JVM startup, it is citing a fact
about Android ≤11. The post-rewrite cost is `UNKNOWN(never re-measured)`.

Related myth, also false and worth never repeating: **"Android 12/13 blocked
shell injection."** It was scrcpy v1.23 falling back to a 3-arg
`injectInputEvent` overload and passing `0` as `targetUid`, making every event a
targeted injection at a uid owning no window → `TARGET_MISMATCH`. Fixed in
[PR #3190](https://github.com/Genymobile/scrcpy/pull/3190). `INJECT_EVENTS` for
shell has never been removed on any Android version.

### Correction 3 — the 59 ms sampler is paying overhead, not pixels

Two source findings that bear directly on the cue helper's design:

- **On `screencap`'s path, `sourceCrop` is ignored.**
  `SurfaceFlinger::captureDisplay(DisplayId, ...)` — the overload
  `ScreenshotClient::captureDisplay` reaches — hard-codes `Rect()` as the crop
  and sizes from `getLayerStackSpaceRect()`; only `frameScaleX/Y` is honoured.
  It also passes `snapshotFilterFn = nullptr`, so **every layer is composited
  regardless of region.** A 20×9 read on that path is free only in *transfer*;
  the composite and readback are full-frame. The crop-honouring path is
  `captureLayers`, reachable from shell via `UiAutomation.takeScreenshot(Rect)`.
- **AOSP does this exact job in a 3 ms budget.**
  `RegionSamplingThread.cpp` — SurfaceFlinger's own small-region luma sampler —
  sets `defaultRegionSamplingWorkDuration = 3ms` at a 100 ms period. It allocates
  the GraphicBuffer at exactly `sampledBounds` and **caches it across samples**,
  passes a layer filter so composition shrinks too, and runs *inside*
  SurfaceFlinger: no process spawn, no binder round trip, no encode, no adb.

**59 ms for 180 pixels is ~20× that budget**, which points at fixed per-read
entry cost rather than pixels. `INFERENCE` from source, not a measurement of
this phone — but `RegionSamplingThread.cpp` is the worked example of removing
it, and "go resident, stop re-entering SurfaceFlinger per read" is a concrete
lever. Frames are produced **only on change** since Android 4.2, so a resident
consumer can be *woken* rather than polled — which would retire the "price every
observation before scheduling it" rule rather than optimise it.

For scale on the other end: scrcpy reaches **33–67 ms for a whole 1080p frame**
on a Nexus 5 (rom1v, photographed counter method, [PR #646](https://github.com/Genymobile/scrcpy/pull/646))
and 8–12 ms on a modern phone, via VirtualDisplay → MediaCodec **input surface**
with no readback anywhere.

### Two failure modes this project has not guarded, both cheap to test

- **The evdev ring buffer is the real sequential ceiling, and overflow is
  silent.** Each `open()` gets a buffer sized `roundup_pow_of_two(events_per_packet * 8)`,
  derived from **how the device declares its MT slots and axes**; overflow
  queues `SYN_DROPPED`, and Android's `EventHub` responds by **dropping the whole
  frame and re-querying device state**. AOSP's uinput README says it outright:
  *"This will likely fill the kernel's event buffers, causing events to be
  dropped."* Testable with the control this repository's own rule demands:
  declare the virtual device two ways, few vs many MT slots, and confirm the drop
  threshold moves — checking `getevent` for `SYN_DROPPED`, **never the writer's
  own success count**. **[SOURCE]**
- **The kernel silently drops unchanged `EV_ABS` after fuzz.**
  `input_get_disposition()` returns `INPUT_IGNORE_EVENT` when a defuzzed axis
  value equals the previous one. Two presses at an *identical* coordinate lose
  the second `ABS_MT_POSITION_X/Y`; the tap still registers because
  `ABS_MT_TRACKING_ID` and `BTN_TOUCH` change, but re-asserting position does not
  work. **Declare `fuzz = 0` on the virtual device** — worth checking ours does.
  **[SOURCE]**

Also worth one control experiment: `ViewConfiguration.DOUBLE_TAP_TIMEOUT = 300`
with `DOUBLE_TAP_MIN_TIME = 40`. Two taps at the same location 240 ms apart sit
squarely inside the double-tap window. Most game runtimes do not consume
double-tap, but this is exactly the class of silent reclassification that
produces a log that "reads like a schedule".

### Where the human gate stands, honestly

**There is no external corroboration available for the ±60 ms iid slack, because
the bot-detection literature reports *means* and never variance.** The papers
that would give real human tap-interval distributions are paywalled or
non-extractable, and one frequently-cited one is **retracted** (Tsaur et al.
2022, Wiley 10.1155/2022/9429475 — do not cite it). Vendor claims of the
"humans >100 ms variance, bots SD <5 ms" shape are marketing with no method.

The one public route to first-hand numbers is
**[HuMIdb](https://arxiv.org/abs/2005.13655)** — 600 users, 179 device models,
freely available. That is the dataset `tools/tracereport.mjs`'s correlated-band
census could be fitted against if the trainer traces prove too thin.

### What is genuinely absent

Recorded so nobody searches for it twice: no measured closed-loop latency for a
*reactive* bot on a *physical* Android handset exists in public — **this project
is past the published record.** Nor does any latency figure in minitouch,
minicap, STF, Airtest/Poco or scrcpy-OTG documentation; any published
`screencap` vs minicap vs scrcpy vs MediaProjection comparison in milliseconds;
any controlled `input tap` vs `sendevent` vs uinput comparison; any crop-vs-full-frame
capture measurement; `dispatchGesture` measured throughput; or Android/ARM64
Frida hook overhead.

One consequence for our own numbers: **the 225 ms `screencap` is faster than
every published physical-device figure** (2.60 s on a Samsung A41 over USB;
782 ms on BlueStacks; ~350 ms on an accelerated emulator). That is not
implausible — a small display, raw rather than `-p`, `exec-out` — but it sits
outside the public record, so **the methodology is the finding**. Per this
repository's own "say which clock, which sensor" rule, that bracket should be
written down: resolution, `-p` vs raw, `exec-out` vs `shell`, USB generation,
and exactly what the stopwatch enclosed.

## Addendum: what the platform survey adds beyond the section above (2026-08-26)

Landed by a second agent working the same brief concurrently. The section above
("Input injection and sequential budgets, against the platform source") reached
the same conclusions from the same sources and is the canonical version —
**this addendum carries only what it does not, and does not restate it.** Same
labelling: **[SOURCE]** = read out of AOSP or kernel code, a fact about the
implementation rather than a timing; **[MEASURED]** = someone else's device with
a stated method; **[COMMUNITY]** = forum or vendor assertion; **[INFERENCE]** =
mine. Nothing here was run on this phone, and **no number below is a measurement
of this handset.**

### The stale pair, and the half of it nobody has corrected yet

I was briefed with "~240 ms proven spacing" **and** "a 267 ms three-camera sweep
the phone has never produced" as a matched pair of current facts. The section
above corrects the first. The second half is the one still circulating
uncorrected, and this file already contains its answer:

- The ideal **267 ms** actuator is indeed still unproduced, and this addendum
  does not claim otherwise.
- But per the spacing table in "It still fails at the spacing the phone has
  proven", the route **no longer needs it**. At the withdrawn 240 ms the span
  was 580 ms against a 600 ms mask margin — a two-frame island. At the proven
  120 ms it is **340 ms with a 12-frame (200 ms) window**. What was unlandable
  at the stale figure is landable at the measured one.

Quoting "the phone has never produced 267 ms" without the spacing table attached
reads as *the route is blocked*, when what the table says is *the route needs
120 ms spacing and the phone does 120 ms spacing*. **[INFERENCE]** — the
arithmetic is this document's, not mine; only the observation that the pair is
still quoted together is new.

### A doubt of mine that the on-device measurement already answers

I flagged `date +%s%3N` at 21 ms as high for a bare `fork+exec` against the
1–4 ms that is typical on desktop Linux. **Withdraw the doubt, not the number.**
"The fix is the fork" above records 100 calls in 2126 ms with a consecutive-gap
max of 35 ms, and a `/proc/uptime` control at 0.36 ms — a better-controlled
figure than anything published. AOSP ships the benchmark that would price this
(`bionic-spawn-benchmarks`, which measures Toybox `true` and `sh -c true`) and
**publishes no results at all**: `UNKNOWN(AOSP publishes the harness, not the
numbers)`. Recorded so the doubt is not re-raised.

### Which device node is writable is version-gated — and `hid-multi` picked the best one

Not covered above, and operationally the most useful thing in this addendum.
**[SOURCE]**, per-tag `ueventd.rc` plus sepolicy:

| Android | `/dev/uhid` | `/dev/uinput` | shell can open |
|---|---|---|---|
| ≤ 8.0 | `0660 system bluetooth` | `0660 system bluetooth` | neither |
| **8.1 – 9** | `0660 uhid uhid` | `0660 system bluetooth` | **uhid only** |
| **10+** | `0660 uhid uhid` | `0660 uhid uhid` | **both** |

(commits [`0729dd1edb1e`](https://android.googlesource.com/platform/system/core/+/0729dd1edb1e392f60f9a2ad5cc06a84df2ab1f6) → 8.1,
[`e615b2aa76af`](https://android.googlesource.com/platform/system/core/+/e615b2aa76afd80291c189c292b0118c8f6664d9) → 10)

Meanwhile **shell's write access to `/dev/input` was deliberately removed** by
sepolicy commit `51156264b4b9` (2018-08-28, Bug 30861057): *"Shell access to
existing input devices is an abuse vector… Remove the write ability for shell
users, and add a neverallow assertion (which is also a CTS test) to prevent
regressions."* **[MEASURED]** corroboration from minitouch's own author on a
Pixel/Android Q preview — the AVC denial fires while `id` still shows shell in
group `1004(input)`, proving DAC was untouched and SELinux alone is the blocker
([openstf/minitouch#41](https://github.com/openstf/minitouch/issues/41)).

**So the three candidate nodes are not interchangeable, and `/system/bin/hid`
took the one that has been open longest.** `trial.sh:1351` creates a
**uhid** device — writable by shell since **8.1**, versus 10 for `/dev/uinput`
and, for `/dev/input`, closed since 2018 behind a neverallow assertion that a
CTS test enforces. That is a second portability argument for
the route, independent of the `deviceId` one in "Prior art" above.

**Keeping the distinction sharp, because these two get conflated constantly:**
**uhid** is a kernel HID device created locally *on the phone*; **AOAv2** is a
USB-accessory gadget negotiated over the cable *from a host*. phisap died of the
latter. Nothing in this addendum transfers AOA's `f_accessory.c` /
`raw_request()` portability problems to this project's route — they do not apply.

Worth knowing as a fallback rather than a recommendation: `adb shell uinput -`
is a **first-party AOSP command** that registers arbitrary `ABS_*` axes with a
full `input_absinfo` and replays evemu recordings, with a shipped multitouch
example (`cmds/uinput/examples/test-touchpad.evemu`). `EventHub` classifies any
node declaring `ABS_MT_POSITION_X/Y` + `BTN_TOUCH` as `TOUCH|TOUCH_MT`. That is
a non-root multitouch actuator with no report descriptor to hand-roll, on
Android 10+. **[SOURCE]**

### Do not justify the 100 ms contact with digitizer physics

The section above establishes that ≥100 ms is an **engine** constraint and that
the repository states it correctly. The complementary point: the numbers people
usually reach for to justify it — the widely repeated *"20 to 50 milliseconds to
reliably register the touch"*, and the touch-latency literature generally —
describe the **physical capacitive digitizer**, and an injected event never
touches it. `evdev_write()` calls `input_inject_event()` *below* the driver.
**[INFERENCE]**, from the call path already cited above.

What that bypasses, for the record:

| Source | Device | physical → kernel (ACTION_DOWN) |
|---|---|---:|
| [google/walt TapLatency.md](https://github.com/google/walt/blob/master/docs/TapLatency.md) **[MEASURED]** | across devices | **9.6 – 29.6 ms** (UP 14.4–31.0) |
| [WALT_usage.md](https://github.com/google/walt/blob/master/docs/usage/WALT_usage.md) **[MEASURED]** | Nexus 9 | 26.3 ms median; kernel→Java 1.2 ms |
| [Kämäräinen, arXiv:1611.08520](https://arxiv.org/abs/1611.08520) Tbl 1 **[MEASURED]** | Galaxy S4 / S7 | **40.5 / 24.1 ms** |
| same paper — **gamepad over USB** | S4 / S7 | **0.6 / 0.2 ms** |

Verbatim: *"The USB connection conveys user commands to the operating system
considerably faster than the capacitive touch screen. Our measurements show a
negligible delay of under 1 ms on both tested devices."* The 24–40 ms versus
0.2–0.6 ms contrast is the cleanest published evidence that the sensing layer is
what costs and that an injector does not pay it.

**The consequence, stated as an open item rather than a claim.** If the hold is
bounded by the engine and not the sensor, the model is ⌈2 frame periods⌉ plus
jitter — about 33 ms at 60 fps, i.e. roughly 65 ms per contact currently spent
on margin. That is **not claimable without measuring the game's own cadence**,
and the measurement is bounded rather than decisive: Fusion's "machine
independent speed" *skips display frames* when behind, so present rate need not
equal event-loop rate. `dumpsys SurfaceFlinger --latency <layer>` prints
`desiredPresentTime / actualPresentTime / frameReadyTime` over
`NUM_FRAME_RECORDS = 128`, costs no pixels, and tracks the **layer** — so it
works for a game drawing its own surface, where `gfxinfo framestats` (a
`libs/hwui` facility) may be empty. **[SOURCE]**. Not run; left open.

### The rest of the ViewConfiguration table

The section above flags `DOUBLE_TAP_TIMEOUT = 300` / `DOUBLE_TAP_MIN_TIME = 40`.
The neighbours, since they are the other silent-reclassification surface and are
cheaper to read here than to re-derive **[SOURCE]**
([ViewConfiguration.java](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/java/android/view/ViewConfiguration.java)):
`TAP_TIMEOUT` 100 ("wait to see if a touch event is a tap or a scroll"),
`DEFAULT_LONG_PRESS_TIMEOUT` **400**, `JUMP_TAP_TIMEOUT` 500,
`HOVER_TAP_TIMEOUT` 150, `PRESSED_STATE_DURATION` 64, `TOUCH_SLOP` 8 dp,
`SEND_RECURRING_ACCESSIBILITY_EVENTS_INTERVAL_MILLIS` 100. The 400 ms long-press
ceiling is the headroom a 100 ms contact is sitting inside — a 300 ms contact
would not be.

### Calibration: what "past the published record" is past

The section above records, correctly, that no measured closed-loop latency for a
reactive bot on a physical Android handset exists in public. What it does not
give is a comparator, and one exists — the nearest published thing to what this
project is doing, on different hardware:

- **Physical Atari** (Javed, Modayil, Kennickell, Sutton, Carmack): a full
  physical closed loop — real console, camera, servos — at *"roughly 165 ms,
  which is comparable to typical human reaction times"*, agent at 30 Hz.
  **[MEASURED]** ([arXiv:2606.19357](https://arxiv.org/html/2606.19357)). A
  5000 ms cycle with ~680 ms of observation slack is a far easier regime.
- For how far the LLM-agent literature is from this regime, both **[MEASURED]**
  but on emulators: V-Droid, self-described *"first mobile agent capable of
  near-real-time response"*, at **3.8 s per step**
  ([arXiv:2503.15937](https://arxiv.org/html/2503.15937v2)); MobileAgentBench at
  **4.85–26.09 s per action** across five agents
  ([arXiv:2406.08184](https://arxiv.org/html/2406.08184v1)).
- DeepMind's AndroidEnv states the structural problem in this project's own
  terms — *"the OS does not pause when providing observations or when accepting
  actions"*, and the risk that *"an unexpectedly long agent deliberation time
  could turn an intended tap gesture into a long press"* — and then **reports no
  fps or ms/step figure at all**, because the rate "depends on the resolution of
  the device, the performance of the machine, and whether the rendering is done
  through software or hardware"
  ([arXiv:2105.13231](https://arxiv.org/abs/2105.13231)). Its mitigation is a
  throttle. That is the same instinct as pricing a policy against the actuator.

### Two more absences, recorded so nobody searches twice

- `UNKNOWN(no published or reliably community-measured figure exists)` for a
  maximum sustainable distinct-touch rate on Android. Fourteen Play Store
  autoclicker listings were read in full, including one with 824k ratings and
  one named "Super Fast": **none publishes a maximum CPS or a minimum interval.**
  The circulating "500–700 clicks/sec" number is a **Windows** figure and must
  not be transplanted.
- The one rhythm-game autoplayer that publishes per-event timing
  (`wlt233/ArcaeaAutoJSAutoplay`) publishes **authored constants, not
  measurements** — 12 ms judgement refresh, 20 ms hold — and had abandoned the
  accessibility route for root `/dev/input`. That choice, rather than its
  constants, is the informative part. **[COMMUNITY]**

## The 100 ms contact floor is margin: every touch control registers at 33 ms (2026-08-27)

Measured on the Moto g56 (`<serial>`), the LIGHT_AFTER breakthrough plus
`hid-raise-probe.mjs PROBE_GEN=raise`:

| control | mechanism | 33 ms contact |
|---|---|---|
| camera-map select | Fusion Click, `viewing` on RELEASE (g22) | **works** -- via LIGHT_AFTER (select and light decoupled) |
| monitor toggle (`flip panel button`) | Click | **works** |
| mask on / mask off | Click | **works** |
| hall beam (`Key-17`, g75-79: `lit? = 1` while held) | HELD | **works at a 33 ms hold** -- lights the hallway, does not pan |

So the `MIN_CONTACT_MS = 100` / `TAP_CONTACT_MS = 100` floor this document has
defended since the swipe era is **margin**, not a Fusion requirement. The
camera select needed the LIGHT_AFTER decoupling (its own section / `plans/17`)
because select-then-light is a Click-then-hold, not because 100 ms was needed;
the monitor, mask and hall took the short contact directly.

**What this does NOT change, and why the shipped constants stay 100 for now.**

1. **The simulator does not model contact length.** `src/engine.js` fires every
   toggle on the press frame -- monitor, mask, camera select are instant. So a
   plan with 33 ms contacts replays *identically* to one with 100 ms contacts:
   there is no survival number to move by lowering the floor. Verified against
   the gate ladder -- config B (LIGHT_AFTER sweep, everything else shipped) and
   the shipped config score the same on n1-n6 at machine precision.

2. **Full-night reliability is unmeasured.** The CAM-07 last-flash saga was
   about *intermittent* drops at 100 ms contact / 20 ms released over ~80
   sweeps a night. A shorter contact has more, not less, exposure to that. The
   probe runs here are seconds long.

3. **The freed schedule room (~600-800 ms/cycle if every contact drops to
   33 ms) is real but has no home.** The attack-cycle Foxy reset is wedged
   between `MASK_ANIM_OFF` and the 400-frame Withered stun budget -- both game
   constants, both still there. Moving the reset into the freed room
   (`SEARCH_KNOBS.attackHallDeltaMs > 0`) errors the plan emitter or does not
   help the human-jitter ladder (item 12 already found this at the old
   geometry, and the tight geometry does not reopen it).

**The one change that IS shipped** is the LIGHT_AFTER *sweep* -- because that
is an actuator correctness fix (it lights CAM 07, which the 100 ms geometry
did only intermittently), not a contact-length optimisation. See
`plans/17` and `trial/09-constants.sh`. On the model it holds n5/n6 at machine
precision and *breaks* n7 (90 -> ~11: the sparse-mask stun bridge had no phase
to give up); on the device it locks Toy Bonnie and Toy Chica where the 100 ms
geometry did not.

**The synthesis for the sub-70 nights:** the actuator was never the binding
constraint. n1-n6 clear at machine precision with the *shipped* geometry; the
sub-70 ladder is `human-gate.mjs`'s iid model on a geometrically-wedged Foxy
reset. A faster or lighter actuator does not touch that. The open levers stay
item 12's correlated jitter shape and item 10's bang-anchored reset.

### The input path is not the limiter: a Perfetto trace of a 100 ms-spacing sweep (2026-08-28)

Every timing claim on this page above was reconstructed from *rendered feed
brightness* or a 60 fps button-highlight walk. This is the first measurement of
the input path **at the source** — the phone's own `InputDispatcher`. It is
[`plans/18`](../../plans/18-modern-tooling.md) Package 5's first run.

Method: `adb shell perfetto --background -t 160s -b 256mb input view gfx wm
sched` running while `NO_LIGHT=1 SELECT_MS=33 PROBE_NIGHT=continue
tools/device/hid-sweep-probe.sh 240 160 133 120 100` drove a select-only
CAM 10→04→07 sweep at five inter-selection spacings on Night 2, monitor up.
Trace parsed with Perfetto `trace_processor`. Moto g56 5G (`<serial>`),
Android 16 / SDK 36, `user` build. Artifacts:
`captures/n2-inputtrace-0001.{mp4,hid,pftrace}` (ignored capture corpus).

Result — the input pipeline delivered **every** contact:

| stream contact | delivered to `com.scottgames.fnaf2` channel |
|---|---|
| 15 camera selects (3 per sweep × 5 spacings, 33 ms each) | 15 `MotionEvent` DOWN + 15 UP, one pair each |
| 5 CAM 11 parks + monitor raise + the `continue` press | 8 further DOWN/UP pairs |
| **total 23 taps** | **23 DOWN, 23 UP — zero dropped, zero merged, zero reordered** |

- The 33 ms selects produced **no spurious `MOVE`** (the only 5 MOVE events in
  the whole run belong to the one deliberate long-press, the monitor raise).
- App-side consume latency (`sendMessage(MOTION)` → `receiveMessage(FINISHED)`)
  was **0.8–8 ms for 13 of 15 selects**, 15.8 and 18.7 ms for two selects in
  the 120 ms sweep — i.e. every selection is consumed within about one 16.7 ms
  frame of dispatch.
- The **100 ms** sweep (the tightest, well below the shipped 133 ms
  `DEVICE_SPACING_MS`) was the cleanest of the five: consume latencies 5.9,
  0.8, 2.6, 2.4, 1.6, 2.1, 2.5, 1.9 ms.
- `camtrace.py --fps 60 --expected 5` on the same recording independently
  reports **5/5 complete 10-04-07-11 sweeps, 0 incomplete** — so each of the
  15 selections also moved the viewed feed (the g46–57 button highlight, hence
  `viewing` was written every time).

Two instruments that fail differently agree: at 33 ms contact and 100–240 ms
spacing, **the phone accepts and the game reads every camera selection.** This
corroborates the "33 ms contacts register" table above from the other side, and
removes the input path — dropped or swallowed selections — as a candidate
explanation for anything. It does **not** speak to the LIGHT_AFTER geometry
(this was `NO_LIGHT`), to `lit?` coinciding with `viewing`, or to full-night
intermittency over ~80 sweeps; those stay open. One run.

**Capture-method note for Package 5.** A `perfetto -t` background session
writes a 0-byte file until it stops; `kill -TERM <pid>` flushes it. Use
`--background-wait`, or signal explicitly — do not pull on a timer. `sched` at
this buffer size is a ring that wraps well inside 160 s; drop it (or shrink the
window) when only the input path matters. Per-app `Choreographer#doFrame` is
**not** a usable frame signal here — Clickteam Fusion renders through its own GL
loop, not the View system, so frame-landing needs the SurfaceFlinger
`actual_frame_timeline_slice` (only 12 frames present in this trace; its data
source needs to be requested explicitly next run).

### Package 5 host instrument follow-up (2026-08-30)

The repository now has `tools/device/atrace-input.sh`, which brackets a
command with a phone-side Perfetto trace and flushes the trace before pulling
it, plus `tools/device/inputtrace.py`, which queries dispatch, delivery,
identity, and candidate frame rows without adding a trace-processor dependency
to the checkout. `grade-run.sh` consumes the artifact when it exists, and the
parser has phone-free regression coverage. The wrapper refuses to overwrite a
capture and can also retain a `SurfaceFlinger --latency` dump for the frame
cross-check.

Three direct `/system/bin/hid` Continue/Night 2 select-only probes on
2026-08-30 produced valid Perfetto files. The video saw light attempts, but
the camera-sweep gate accepted only 4/5 sweeps in the first probe and 0/1 in
each shorter probe. The traces contained no app `MotionEvent`
dispatch/delivery rows, including the all-app ATrace retry, so the parser
returned `NO APP EVENTS`; these runs do not prove that the contacts reached
Fusion. The earlier positive 2026-08-28 trace remains the evidence to
reproduce. Direct-HID dispatch and actual frame-timeline landing are still
open, and Package 5 is not closed.

## The arming pair merged into a drag: topology, not time (2026-08-28)

`n2-minustoys-0117` planned **17 ms of released time** between the opening's
`cam9` and `monitor` contacts — the split-arming geometry. The HID trace reports
that pair delivered with **0 ms released** ("only 0 ms released between [cam9]
and [monitor] at 1400 ms"): Fusion saw one finger dragging from the CAM 09
button to the monitor button rather than two taps. Full run record in
[`ON-DEVICE-VALIDATION.md`](ON-DEVICE-VALIDATION.md) §"The Minus Toys open-loop
policy is refuted on the phone".

This is worth naming separately from jitter, because the obvious repair — make
the gap bigger — is the expensive one, and the schedule has only 33 ms of slack
either way at that point.

**The gap is a timing quantity; "two taps" is a topological one.** Nothing
requires the separation to be expressed in time at all:

- Emit the two contacts on **distinct multitouch slots / tracking IDs**. Two
  concurrent-capable contacts at different tracking IDs cannot be interpolated
  into one finger's motion path, whatever the released interval is.
- Or interpose one report at a coordinate far from both, so any interpolation
  that did occur is not a straight line between two buttons.

Both are host-side changes to `hid-multi`, both are mock-gatable without a
phone, and neither costs schedule margin. **Untested — this is a proposed
repair, not a measured one**, and the control that would confirm it is the same
HID trace plus `camtrace.py` on the button highlight.

**Do not read this as "the actuator is the problem".** It is the only actuator
defect in the run record, and closing it does not move the phase margin that
actually killed the night (`ON-DEVICE-VALIDATION.md` §"The frontier is phase,
not actuation").

### Landscape note: the platform keeps closing doors uhid does not use (2026-08-28)

Adds one row to §"Prior art" without revising any measurement. The trend the
prior-art survey found — direct `/dev/input` and direct-framebuffer paths dying
at Android 9/10 under SELinux, the field converging on `app_process` +
`InputManager` reflection — continues: **Android 16's Advanced Protection Mode
is reported to restrict `AccessibilityService`-based automation**, the other
family of general-purpose Android input automation
[CLAIMED — APK teardown reporting, not shipped-behaviour documentation:
https://www.androidauthority.com/android-advanced-protection-mode-accessibility-apk-teardown-3640742/].

The consequence for this project is only reassurance, and should not be
overstated: the `hid-multi` route is a kernel uhid device, not an input-injection
API and not an accessibility service, so none of these restrictions apply to it.
That is a reason not to migrate toward the mainstream paths, not evidence that
anything here needs to change.
