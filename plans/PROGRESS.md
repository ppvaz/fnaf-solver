# Plan progress

**Updated:** 2026-09-27.

**How to read this file.** It is a log, append-ordered from 2026-09-09: **the
newest work is at the bottom**, so read the last entry first. Everything before
that — the 2026-09-08 snapshot, the newest-first history back to 2026-08-20, the
standing directives of that period and the Minus 7 frontier notes — moved on
2026-09-24, unchanged, to [`archive/PROGRESS-2026-08-20-to-2026-09-08.md`](archive/PROGRESS-2026-08-20-to-2026-09-08.md).

Since that 09-08 snapshot: Night 5 reached 6 AM on 2026-09-12, Night 6 on
09-13, and Night 7 (10/20, `golden-freddy`) on 09-14, with a ten-run Night 7
cohort at 3 wins (k2, 09-14) and a predeclared one at 8 of 10 (k3, 09-18). The
current open work is model fidelity — see the last
entries and [`../docs/research/SOLVING-FNAF2.md`](../docs/research/SOLVING-FNAF2.md).

## Where the path stands

The package dashboard and its counting rule were archived on 2026-09-25 to
[`archive/PROGRESS-dashboard-2026-09-04.md`](archive/PROGRESS-dashboard-2026-09-04.md):
they measured completion of the written plans, not progress, and had not been
re-read since 2026-09-04. The path is [`ROADMAP.md`](ROADMAP.md), steps S1-S7,
each with the artifact that closes it and the command that reads where it
stands. This log records what each session did against those steps.

## 2026-09-09 — Night 5 loses input below the application (measured)

Two more Night 5 attempts on the Minus 3 frame-light recipe, plan byte-identical
between them. `n5-fastsync` was alive at 388.5 s of 420 — the deepest Night 5 run
so far — and lost its grade to an observation race: the frame classifier read the
auto-advancing game-over screen as `state=title` while the helper still reported
`FNAF2_GAME_OVER`. The runner now grades the death from the helper; `n5-trace`
graded cleanly at 224.5 s on that same path.

`n5-trace` was captured under `tools/device/atrace-input.sh`. On the game's own
input channel the trace holds 66 `ACTION_DOWN`, 63 `ACTION_UP`, 24
`POINTER_DOWN(1)`, 24 `POINTER_UP(1)` — and **3 `ACTION_CANCEL`**, which account
for the DOWN/UP imbalance exactly. The cancels sit 8.9 s and 10.5 s apart against
a 10 s schedule period. `ACTION_CANCEL` is the input system revoking an
in-progress touch stream: injected touches are being lost *below* the game, which
is a different failure from the mask/monitor input rules the plan compiler already
gates. Cause not identified; the same trace shows every touch copied to
`[Gesture Monitor] swipe-up`, `moto_actions_input_channel` and
`sysui_input_dispatcher`, and pointer pilfering is the standard cause — untested.

`tools/device/inputtrace.py` reports `NO APP EVENTS` on this trace despite 300
`ACTION_DOWN` slices being present: its query filters on `process_name`, which is
NULL for these slice tracks. Open defect, not fixed here; the numbers above came
from querying `trace_processor` directly.

Night 5 ledger, from the run directories rather than from memory: 22 runs have
entered a Night 5 (17 Minus 3, 5 Minus Toys), 14 produced a graded terminal,
deepest graded 369.0 s. An earlier note this session quoted "24 attempts, best
386 s"; neither number was derived, and both are corrected here.

Evidence: `docs/evidence/night5-input-trace-20260909.json`.

### Correction, same day: the cancels are the wind hold, and the trace was short

Two errors in the entry above, both found by querying the same trace further.

**Coverage.** The trace does not cover 224 s. Its last published touch is at
+115.2 s against a run that continued to +233 s: the 384 MB buffer filled and
later data was dropped. The measurement is **3 cancels in the first ~106 s of
night**, with the remaining ~118 s unobserved.

**Attribution.** All three cancels land inside the 3.2 s wind hold
(`contact(base + 5800, 'wind', 3200)`, phase 5.80-9.00 s of a 10 s cycle), in
three consecutive cycles k=5,6,7, at phases 8.72, 7.61 and 8.10 s. No other
contact was cancelled; every other contact in the cycle is 33-583 ms. Because
ACTION_CANCEL truncates a gesture rather than preventing it, the cost is 0.28,
1.39 and 0.90 s of winding, not three whole cycles.

Refuted along the way: the corrector's own taps are not the cause (its 8
resyncs fired at 25.1, 33.7, 181.7, 183.6, 189.0, 192.5, 193.4 and 201.9 s, none
within 30 s of a cancel), and system-gesture geometry does not explain these
three (wind is at (430,845), outside every measured inset). Measured but not
implicated: `mask` and `monitor` at y=1015 sit inside the mandatory bottom
gesture inset `[0,1002][2400,1080]`, and `panLeft` at x=60 inside the left inset
`[0,0][188,1080]`, with `navigation_mode=2`. Unattributed:
`onPointerDownOutsideFocus` fires 198 times, five per cycle at fixed phases,
every cycle; the slice does not name the window.

Evidence: `docs/evidence/night5-input-trace-20260909.json`.

## 2026-09-09 — The monitor raise is what fails, and the Marionette collects

A corrector-free run of the device-proven recipe (`n5-modal-once-20260909`,
edge hash `8883626783fd…`, byte-identical to the schedule that cleared Nights 3
and 4) died on Night 5 at 67.3 s. The retained video answers the question the
last three sessions have been circling.

Sampled at the middle of five consecutive wind holds:

| night | monitor | where the wind contact landed |
| ---: | --- | --- |
| 12.3 s | UP | on the Wind Up Music Box button, lit |
| 22.3 s | **DOWN** | on the office floor at ~(430,840) |
| 32.3 s | **DOWN** | on the office floor |
| 42.3 s | UP | on the button, lit |
| 52.3 s | UP | on the button, lit |

The mask was off in both failed cycles — the office is plainly visible, not the
mask overlay — so this is not the engine dropping input behind a stuck mask. The
monitor raise itself did not take, and it recovered by cycle 3 **with no
corrective taps** (`resyncs: []`). Intermittent and self-clearing, not a
permanent toggle inversion.

Two lost wind holds emptied the box before 1 AM and the Marionette killed the
run at ~60 s, recovered from the video at t=68.8–69.5 s. `windloss.mjs` at 3000
seeds prices exactly this: losing the hold entirely in three consecutive cycles
takes Night 5 from 2636/3000 to **7/3000 with puppet=2976**, while *truncating*
holds costs zero wins. The failure that matters is a press that never lands.

Candidate mechanism, measured but not established: the monitor tap (1780,1015)
and mask tap (600,1015) sit inside the mandatory system gesture inset
`[0,1002][2400,1080]`. It is not a coordinate nudge away — the drawn mask bar
spans y 992–1050, leaving ~10 px clear of the inset. Fixing it needs a hitbox
probe above the artwork, or 3-button navigation with the viewport re-verified.

Also landed: `tools/device/night5-modal-observer.mjs`, a passive dual-modality
observer (568 samples, 0 errors, round trip 73.9 ms p50 / 129.8 ms p95). Its
`monitorUp` classification is `ambiguous-threshold` on most samples and returned
exactly one `true` in 67 s of a schedule that holds the monitor up ~38% of the
time; it declares its own model as night-1-corpus and is not yet fit to drive a
corrector.

Evidence: `docs/evidence/night5-monitor-raise-loss-20260909.json`.

## 2026-09-11 — The Night 5 run was delivered at a phase no census has scored

The `campaign-2026-09-11T03-38-02.390Z` Night 5 attempt ended in `static` at
~119 s. It was not evidence about the Minus Toys route, because the stream the
phone ran was not the stream the gate scored.

The plan shipped `#phase-offset 333`, but `minusToysEmitter` replayed at epoch
0. Emitting the same winner with and without the offset changes the plan text
by exactly one line and leaves the replay summary **byte-identical**, so
`gate.replayHash` matched and the winner's `MODEL_ONLY 3000/3000` evidence was
re-certified for a rotation no census had seen. Fixed in `a44909b`: the offset
now reaches `replayToys` as `epochMs`, and minus3/minus7 — which replay at
epoch 0 only — refuse to carry one.

333 ms was also never the delivered phase. Reconstructed from the run's own
timestamps:

| quantity | value | source |
| --- | ---: | --- |
| planned rotation | 333 ms | `#phase-offset`, `hid.schedule-start` |
| prefix length `armReadyAtMs` | 1982 ms | recovered from gate 1 |
| arm release lag | **1263 ms** | `armGoAt − (released + armReadyAtMs)` |
| accumulated gate lag, 12 cycles | 0 → 116 ms | the 12 `control.gate` rows |
| **delivered steady-loop offset** | **1596 → 1712 ms** | the three above |
| origin error vs. the true 12 AM frame | **UNKNOWN**, bracket 1872 ms | lifecycle cadence |

The arm lag is structural, not a glitch: `ARM_SETTLE_MS` 600 plus two confirming
samples at `pollMs` 1000 plus the release touch, and `compileGateSegments`
resumes the parked stream on the next authored instant with no lead-in, so the
whole night inherits it. Per-gate drift, by contrast, is ~10 ms/cycle — the
`releaseTouchMs` pre-compensation works.

Why the phase matters at all: the sourced vent-mask rule accrues on
`frame % FPS === 0`, i.e. the game's absolute one-second grid. The route's mask
window is 4800 ms press-to-press, 4600 ms fully on — **exactly five grid
instants and no more**. A full-second phase sweep at frame
resolution puts the route at 4 ticks for epochs in **[416.67, 783.33] ms**, and
at 0/100 wins across every phase in that band, foxy-dominated. The
delivered offset mod 1000 was 596–712 ms: inside that band before the unmeasured
origin error is even added. Under an uncontrolled phase the route is worth
**1375/3000 (45.8 %)**, or 62.2 % conditioned on the arm landing — not 3000/3000.

Refuted along the way. The phase probe's "333 ms → 0/100, Puppet" is the
**arm sampler**, not Balloon Boy: `LAST_VIEW_SAMPLE_FRAMES` is 12 frames and
the split misses on 3 of every 12, and 333 mod 200 = 133 lands in that band
while 833 mod 200 = 33 does not. It says nothing about the mask rule. Minus 3
is not the escape: its window is `maskOnMs 9600 → maskOffMs 4400`, the same
4800 ms and the same zero margin. Widening the mask to a phase-independent
≥5200 ms makes ticks 5 at every phase but costs 300 ms/cycle of winding and
takes the mean from 46.7 % to 32.8 % — the 10 s cycle has no slack for both.
And `reactiveBB`, the reserved feedback layer, is **0/1080 on Night 5** at every
phase and at perfect, 15 Hz+100 ms, and 15 Hz+250 ms+10 %-drop observation,
puppet-dominated: it is not a drop-in.

Not established. The dump names no killer — the three `static` frames carry no
animatronic, no text, no HUD, so "BB, with Foxy" remains operator context. The
quoted "static 76 ms before the next scheduled action" compared a wall-clock
observation against a *nominal* authored time; gate 12's actual release was
120.909 s, the last `night` sample 117.657 s, and the reconstructed stream has
**no delivered contact between 116.14 s and 120.91 s** — the death fell in an
input-free window, which is consistent with a game-side interval check and not
with a mis-delivered contact. Frame `00029` shows CAM 09 and CAM 11 both
highlighted at 1 AM, so the split arm was alive 11 cycles in. The gates' 12
AGREEDs are one read each from a rule whose own tag reads
`diagnostic-provisional:night-1-corpus,animation-unproven,blackout-unproven`,
and both opening `control.effect.result` rows were UNKNOWN/insufficient-frames.

Open. The origin is a screenshot classification (`nightAnchoredAt`), and
`PhaseClockEstimator` in `packages/core/src/timing/phase-clock.js` — with the
on-device `PhaseClock.java` fitting the 500 ms winding tick — is built, tested,
and wired to nothing. Until the executor's origin is a measured game phase, a
6 AM attempt is a coin flip on a quantity the bundle does not record. That
measurement was completed by the 2026-09-11 no-offset run below; it was not a
win attempt.

Evidence: `docs/evidence/night5-delivered-phase-20260911.json`, regenerable with
`node tools/device/phase-reconstruct.mjs --run <bundle> --night 5`.

## 2026-09-11 — no-offset Night 5 phase-control run

The phone ran the qualified `minus-toys` Night 5 artifact with
`phaseOffsetMs: 0` and retained a 163.432-second 1280x576 recording. The
reconstruction recovered the first delivered offset as **6695 ms** and the
last as **6872 ms**; modulo the 1-second model phase those are **695 → 872
ms**. The first five gates landed at 695, 792, 792, 799, and 799 ms, inside
the measured Night 5 loss band **[416.67, 800) ms**, where the model scored
0/100. Gate lag was 0 ms on the first gate, 97–110 ms through gate 8, then
159 ms and 177 ms on the two corrected gates.

The desynchronization entered at arm verification. Attempt 1 repeatedly saw
`cam:9=188` and `cam:11=96` but no confident highlight pair, retried at
7457 ms, and verified at 10357 ms on attempt 2. The reconstruction therefore
reports `arm.lagMs: 6695`; this is the global phase error, while the later
gate lag is the smaller per-cycle drift.

The lifecycle authority observed `state=static` and then `state=title`; the
campaign exited with `device: lifecycle left night state (title)`. The
retained video shows a Withered Chica jumpscare at 149.5 s. The new
shadow-only model reports six positive samples through 149.9167 s as
`visual-withered-chica-jumpscare`. It names the killer for attribution while
leaving the lifecycle terminal field independent.

Evidence: [night5-phase-control-20260911.json](../docs/evidence/night5-phase-control-20260911.json),
video SHA-256
`fbcba7b826108aaf10b992db9600e81c61c17a24813e044a7dee8db58035f49c`, and
model `tools/device/models/death-cause-withered-chica-moto-g56-v207.json`.

## 2026-09-11 — phase-safe arm repeat and second-cycle correction

The camera model was updated from the live arm evidence: CAM09 read `188` on
the failed run and `183` on the repeat while CAM11 read `96`. The CAM09 rule
now records the observed selected range `183..194` and retains an ambiguity
band below the selected state. The repeat confirmed the pair twice on the
first arm attempt, at elapsed `4625 ms` and `5016 ms`, with `armGoAt` phase lag
**1320 ms** against the **2000 ms** budget.

The first cycle did not show a state mismatch: the `5200 ms` gate was
`AGREED`, with delivered offset `1320 ms` and gate lag `0 ms`. The first
divergence was at the second cycle's `15200 ms` gate: the plan believed the
mask was on, the phone observed it off, and the gate corrected it. Its phase
lag was only **70 ms**, so this is a mask-state delivery/observation mismatch,
not evidence of a large clock desynchronization. A later `45200 ms` gate also
needed correction after a grid-luma refutation.

The run is not a Night 5 win attempt: the lifecycle ended in `static` and the
retained video ended in terminal static at `80.0 s`, with no visual killer
candidate. The device was returned to the title and verified with
`items=continue,newGame`.

Evidence: [night5-phase-safe-arm-20260911.json](../docs/evidence/night5-phase-safe-arm-20260911.json),
video SHA-256
`77191cd0a74dcbb31022d9cb0fae747828ee295bf2dc2c40ae09ce015b59912c`.

The next physical rung is to isolate the `15200 ms` mask correction with a
short, retained first-two-cycle run before attempting a full Night 5 route.

## 2026-09-11 — the origin, not the arm, is what the phase error is made of

This session ran Night 5 twice. The first attempt never reached a night: the
2026-09-08 qualification is bound to `fnv1a-d48ce3da`, the bundle HEAD compiles
is `fnv1a-433ddeed`, and the preflight refused it in about 60 s. Pedro granted
the rebind explicitly in session; the new binding is
[qualification-hid-mediaprojection-night5-20260911.json](../docs/evidence/qualification-hid-mediaprojection-night5-20260911.json)
and it records both the plan delta (`ventl` renamed to `cameraFeedLight`, plus
one added opening row `1916 hold cameraFeedLight 100`) and the reason the old
binding broke without any plan byte changing: `validateWinner` expands the
named preset `KNOBS0` into the full knob object before hashing, so `policyHash`
tracks the knob-set shape. At 685fd01 the night-5 plan sha was still
`27aa0c15` while `winnerHash` had already moved.

The second attempt ran the rebound bundle with `--arm-observe-once`, which is
Pedro's standing direction and which the harness now takes as its default.
Observe-once starts the schedule and observes beside it, so it parks nothing
and contributes **no suffix shift at all** — the 1320 ms and 6695 ms lags the
blocking runs measured are gone. The night still ended in lifecycle static
about 50 s in.

The reconstruction says why. The delivered stream carries no internal drift:
all 25 graded transitions sit exactly on their planned offset from
`hid.night-go` (delta +0 ms through 54.4 s), which is the scheduler's computed
contact time and therefore proves the stream and not the game. What is
uncontrolled is where `hid.night-go` sits against the game's true 12 AM:
`origin.bracketedByMs` is **1852 ms**, with a lifecycle observation cadence of
p50 1986 ms and max 11301 ms. The executor's `observe` port is `lifecycle()`,
a full 2400x1080 `screencap` piped into `lifecycle-observe.py` on every poll;
the executor's own poll is 250 ms, so the residual is the capture-and-classify
round trip. Because the model's response to phase repeats on a 1000 ms game
second and loses on 53.3% of it, a bracket wider than the whole period leaves
the delivered phase unconstrained, and the model's own uncontrolled-phase
figure — 1375/3000 — is the ceiling for **any** arm mode until the origin is
pinned.

The run also measured a second, independent gap. Press acceptance graded 4
PASS, 9 MISSING, 11 UNKNOWN, 1 UNSTABLE, and the MISSING rows are not scattered:
`toys-3 monitorUp->true` (plan +10100, 900 ms after the mask-off) missed on 4
of 5 cycles, and `toys-7 maskOn->true` (plan +14400, 400 ms after the monitor
drop) missed on 4 of 5. The four PASS rows prove the grader can see a
successful transition, so these are not a blind instrument. The mask seam is
the standing explanation and `loopContactMs: 200` is already flagged in
`KNOBS0` as the experiment; neither is measured.

**Retraction.** An earlier claim in this session that Night 5 tolerates at most
408 ms of arm-release lag was wrong. It came from reading
`minus-toys-margin.mjs`'s `edge()`, which stops at the first failure and is
valid only for a contiguous basin. The response is banded: the model scores
3000/3000 at 800–1400 ms of lag, so 408 ms is one band edge and not a budget.
`phase-reconstruct.mjs` already computed `model.lossBands` and was the
authority all along. The margin tool now reports bands and says in as many
words that `edge()` must not be used on this response.

Tooling landed with it, because the measuring was the slow half of every
attempt. `tools/device/night5-run.sh` drives one attempt end to end and runs
the whole post-run pipeline plus the observed title reset from an EXIT trap, so
it happens on a pass, a failure and an operator Ctrl-C alike — it was proven on
this run's abort. `tools/device/run-report.mjs` states the executor-owned facts,
including the press-acceptance tally and any systematically missed press, which
is what surfaced gap B. And `test-grade-run-coverage.mjs`, which enforces that
no instrument exists outside the pipeline, was registered only in
`tools/test.mjs`'s ENGINE group — a lane CI never runs and one CLAUDE.md
describes as holding intentionally red controls. It had been failing on 11
scripts, `phase-reconstruct.mjs` among them, which is exactly why the last two
sessions ran it by hand. It is now in `npm run test:unit`, the lane CI runs,
and it is green.

Evidence: [night5-origin-and-acceptance-20260911.json](../docs/evidence/night5-origin-and-acceptance-20260911.json),
video SHA-256
`e8f26a0ef75732c315bf0360f7cb0d4d5d1602f9c7fcc5f1b074870f1ac33cd1`.

Open, in priority order: (1) pin the night origin from the native Cue Helper
`screen=FNAF2_NIGHT` capture timestamp while leaving the Python classifier the
authority on whether a night is running, and re-measure
`origin.bracketedByMs`; (2) measure `loopContactMs: 200` and the 198 ms
mask-off/monitor-raise separation against the 3000-seed gate, then test the
survivor on device; (3) decide what replaces the cycle gates that observe-once
removes, since blocking mode buys parity correction at the cost of phase.

## 2026-09-12 — the lost press was a lost MONITOR tap, and a 33 ms contact has no slack

The two CORRECTED cycles of night5-strokes3 had stood as "a lost mask press,
~12.5% of cycles, a Bernoulli rate no estimator fixes". The run's native frame
trace (`captures/frame-traces/night5-strokes3-20260912T035230Z-*.tsv`), read
against the compiled schedule in its own `request.json`, says otherwise, and
the reading holds at both ends of the clock bracket: in cycle 1 the camdrop's
33 ms monitor tap at +24000 never lowered the monitor; in cycle 2 the 33 ms
raise at +30100 never raised it (the wind was then held on the office) and the
camdrop at +34000 raised it instead. In both, the mask tap at +14449 arrived
with the monitor up — mask button absent — and lowered the monitor. Every mask
tap sent with its button present landed. The raise at +30100 sits inside a
40 ms capture interval at both ends of the bracket; the +24000 camdrop only at
one end, so that coincidence is reported as ambiguous.

The dump makes the mechanism legible: the flip is level-triggered with a
one-shot latch (g257 raises on `Multiple Touch` over `white button`, g258
re-arms when no touch is on `drop button`, g614 lowers via `MouseOnObject`),
so a contact that fits between two event-loop ticks is invisible and a longer
hold flips once. `MIN_CONTACT_MS` and `FUSION_POLL_MS` are both 33: mistake
register #7 one level down.

`tools/device/tap-stall-audit.mjs` now grades every scheduled contact against
the frame trace inside `grade-run.sh` (exit 3 on a lost contact) and prices the
exposure of 33/50/67/100 ms contacts to the trace's stalls: on strokes3, 1.8
expected lost taps per 420 s night at 33 ms and 0.00 at 100 ms. The peer
session bound `loopContactMs: 200` the same night; its first attempt
(`artifacts/campaign-2026-09-12T05-57-49.259Z`) ran 37 cycles with **zero
lost contacts** and died at ~370 s to something that was not a contact.
Mask and monitor luma move at the same latency for 33 and 200 ms contacts, so
the game acts on the press; the button strokes read blank for the whole hold.

Two pipeline defects fixed with it: `night5-run.sh analyze()` took the newest
`artifacts/campaign-*` directory, so night5-strokes4 (refused at preflight,
no night) published strokes3's verdict as its own — it now reads the run's own
`evidence.started` row; and strokes3 had been graded before the frame-trace
glob fix, so the two instruments that needed its trace never ran on it — it is
regraded into `grade.regrade-20260912.log` beside the original.

The hall is gradable from the same trace, and the audit now does it: the
20x9 grid cells over PixelWatch's `FOXY_HALL`, read only on frames whose
strokes say office (the retracted hall-flash-metric scored the camera screen
for want of that gate). A lit flash is two frames at luma ~45 starting 20–40 ms
after the 33 ms hall tap; dark is 0–3. Census: strokes3 (mask-off 33 ms) lit 9,
dark 6; contact200a attempt 1 (mask-off 200 ms) lit 15, dark 21; attempt 2
lit 7, dark 11. The engine refuses a flash inside the mask-off animation
(`plant-model.js` `maskFullyOff`), and the loop's hall tap at +9500 clears
that ~244 ms animation by ~56 ms — the mistake-7 shape on a third knob. Dark is
an upper bound (the light stays on during hall movement, which renders dark),
but 21 of 36 is not movement. The 372.5 s death is not the epoch: the delivered
epoch was 94.9 ± 33 ms, 21.7 ms outside the puppet band, and inside that band
the model's puppet deaths land at 28–108 s, never near 372 s. A night that lit
the hall 15 times in 36 cycles points at Foxy; no cause model fired, so that is
the hypothesis, not a finding. A `hallOffsetMs` sweep (9500–9900, nights 5, 1,
2, 6, 7, 3000 seeds) is the next model question.

Open: `camdropMonitorMs` (the peer session is taking it to 200) and the hall
tap's ~56 ms lockout slack; the helper clock is only bracketed by the gate
reads (~180 ms) and narrowed by a stated, unmeasured 30–110 ms actuation
latency — `hid-transition-probe.mjs` is the instrument that would measure it.

Closed the same session: `hallOffsetMs` 9500–9900 gates 3000/3000 normal and
worst on nights 1, 2, 5, 6 and 7 (25 runs), so the hall tap can move up to
400 ms later at no model cost; and the video cross-check of the hall grader
matches the trace census one for one on contact200a. `final2` (peer session,
contact 200 everywhere, no trace): hall lit 12 of 16, every latched mask
window 4.58 s, and the gate at +185.2 s read an unrecognisable screen before
the abort — the death, on the monitor-down/mask-up edge of its cycle, is the
Mangle shape of the shared five-tick budget at an unmeasured epoch. Evidence:
[night5-hall-lockout-and-offset-sweep-20260912.json](../docs/evidence/night5-hall-lockout-and-offset-sweep-20260912.json).

## 2026-09-12 — first Night 5 6 AM on the phone (night5-anchor2)

`night5-anchor2-20260912T204002Z` won Night 5 on the campaign handset with binding
`fnv1a-81b5e51c` (Minus Toys, bundle `artifacts/night5-contact-final`,
observe-once): `device-campaign-result-v1` attempt `WIN`, positive `sixam`
419 056 ms after the release, save advanced to the 6th Night entry,
`campaign-proof-v1` `proofHash fnv1a-e017f7c9`; 42 gates all `AGREED`, 0
corrections; the survival grader reads `TERMINAL: clear -- sixam at 449.0s`.
The run released unanchored at a drawn epoch (`k-unreachable`, delivered epoch
`UNKNOWN`), so the win is evidence for the route and the contact floors only.
Evidence: [night5-first-6am-20260912.json](../docs/evidence/night5-first-6am-20260912.json),
page [night5-first-6am-20260912.md](../docs/evidence/night5-first-6am-20260912.md).

Open: the native origin anchor is unverified (released on its aim once, at
k = 3; refused on the three runs since); the helper's onset latch clears on
in-night `FNAF2_MENU` camera views and saw no frames while a frame trace ran
(both fixed in source, not yet installed); no frame trace has yet covered a
night onset (trigger moved to `evidence.started`).

What it cost is written as its own ledger,
[night5-first-6am-cost-20260912.md](../docs/evidence/night5-first-6am-cost-20260912.md):
four days from the first Night 5 attempt, thirty run directories on the day,
seventeen nights that reached the loop, one clear; every night's gates, ending
and by-eye killer; the wrong turns priced in nights and instruments. After the
contact fix the loop ran 124 gates with zero corrections across seven nights
and won once, against a model price of 41–46 % at drawn epochs. Two of those
deaths — rep1 at a measured 885.6 ms, anchor4 at 231.1 ms (the first epoch
measured from a trace that opened before the onset) — sit at epochs the model
scores 100/100 and both lie within the stated actuation latency L (30–110 ms)
of a losing band's edge: the model's epoch is the *effective* one, the phone's
is the schedule's, and L separates them. The aim of 233 keeps the effective
epoch in the winning band only for L < 83 ms; measuring L, or aiming at 172
until it is measured, is the next question, and anchor5 at 233 is its first
read.

anchor5 answered it and asked a sharper one. The anchor is verified to the
frame (latch = trace onset to 0.0 ms, delivered 183.9 ± 40 against 233 at
k = 2, fired 0 ms from `hid.night-go`) and the night still died at +278 s
with Balloon Boy AND Mangle inside at the camdrop edge — an epoch the model
wins 100/100 for every stated L. Shifting every measured-epoch death by one
constant, exactly one value, **+233 ms**, puts all six in losing bands; at
3000 seeds it reproduces rep2, rep3, anchor5 and anchor4 with the by-eye
killers (the model records Mangle's attack as `inside-office`) and death
times inside the predicted distributions, and fails only rep1's killer
(puppet predicted; BB then Foxy re-confirmed by eye, no puppet in any frame —
a real miss, not noise) and contact200a (a dark-hall death the model cannot
produce). A latency L of ~233 ms would produce the identical shift, and the
aim-940 run cannot tell the two apart; the getevent capture on the same night
can. If the game's second grid
starts ~233 ms after the helper's first night frame, the schedule aim must be
~940, and both 172 and 233 are certain losses. One run at aim 940 decides
it: puppet death by ~108 s under Δ = 0, 3000/3000 under Δ = 233. Recorded as
a hypothesis with its arithmetic in
[night5-anchor-aim-20260912.json](../docs/evidence/night5-anchor-aim-20260912.json);
the register keeps 172 until that run. Runs are paused by Pedro.

## 2026-09-12 — second Night 5 6 AM (night5-mask5plus), and latency measured

`night5-mask5plus-aim172-20260912T220100Z` won Night 5 on binding
`fnv1a-de41e791` (Minus Toys; wind 3030, camdrop 13650, mask on/off
4249/9560, hall 9940 — a commanded mask window of 5.311 s instead of 4.751 s):
`WIN`, positive `sixam` at +419 s, save advanced, 42/42 gates `AGREED`, 0
corrections; the mask was visible 5.04–5.67 s (median 5.17) on 40 of 42
windows. Released unanchored (`authorization-late`), delivered epoch 429 ±
54 ms by the trace. Evidence:
[night5-second-6am-mask5plus-20260912.json](../docs/evidence/night5-second-6am-mask5plus-20260912.json),
page [night5-second-6am-mask5plus-20260912.md](../docs/evidence/night5-second-6am-mask5plus-20260912.md).

The run before it, `night5-aim940` (aim 940, anchored k = 1, delivered 876.7 ±
56 ms, died ~340 s BB→Foxy), measured actuation latency for the first time:
press→effect medians 253 ms monitor-up, 254 mask-on, 314 mask-off, 595
monitor-down, 64 hall; release→effect 55 / 55 / 114 / 244 / 28 ms. The
register's stated 30–110 ms is refuted; the aim arithmetic must be redone on
the measured edge the game counts.

Open: Night 6 with the winning knobs wins in the model at one phase in twenty
(Foxy/puppet elsewhere), so it cannot be run blind; the anchor has not hit a
phase since anchor5 (authorization 1.9–2.5 s after onset against k ≤ 2); the
64 ms gap between the anchored aim and the trace's delivered epoch on aim940
is unexplained. Both wins were on the Codex session of 2026-09-12; the
Claude sessions resumed from its cutoff.

## 2026-09-12 — death prediction: Night 6 died to Foxy at 26 s, the model said 60–170 s, and the gap is a measured input

Pedro asked for Night 6 on the phone as a test of the model's Foxy prediction,
and proposed that runs aim at specific deaths rather than only at 6 AM. The
run (`night6-foxytest-20260912T223944Z`, the second win's exact knobs, drawn
epoch) died to **Withered Foxy at ~26 s** against a prediction of Foxy at
80/150/170 s (p10/p50/p90) in 75 % of phases. Killer right, time wrong by 3×,
and the same run's audit says why: the post-mask hall flash at +380 ms lands
inside the mask-off refusal window (measured mask-off latency 312–315 ms plus
the 244 ms animation during which g75 refuses every office light); it graded
DARK, Foxy's D never reset, and the camdrop's held light on the monitor drop
flashed a locked Foxy. Night 5 tolerated the same swallowed flashes (13/34 and
22/41 dark on its traced runs) because Foxy at AI 5–7 needs D ≥ 14.
Evidence: [night6-foxy-prediction-20260912.md](../docs/evidence/night6-foxy-prediction-20260912.md).

Instrument: `tools/device/death-prediction.mjs` writes a `death-prediction-v1`
record before a run (killer shares and death-time quantiles over 20 phases,
3000 replays); `bundle.mjs` accepts a `DEATH_TARGETED` gate only with that
record attached and carries it in the manifest; `night5-run.sh` retains it as
`prediction.json` and prints it before the campaign. Documented in
`ON-DEVICE-VALIDATION.md` and the evidence policy. Such runs are never route
claims.

Model findings from the fix search: the raise (10100), the CAM 09 stun refresh
(10400) and the camdrop (13650) are each rigid to ~120 ms (Toy Bonnie's 6.66 s
stun); the 10 s cycle is over-subscribed by 50–150 ms once the refusal window
is real. The fit that survives: hall flash at mask-off + 600 ms with the mask
window trimmed to 5.211 s — Night 5 3000/3000 normal and worst
(`artifacts/night5-hallfix`, `fnv1a-34463603`); Night 6 a `DEATH_TARGETED`
bundle predicting Foxy 80/150/170 s in 75 % of phases
(`artifacts/night6-hallfix`, `fnv1a-44e8eff2`). Neither has run.

## 2026-09-12 — third Night 5 6 AM, and the swallowed-flash mechanism retracted by its own test

`night5-hallfix-20260912T230319Z` (`fnv1a-34463603`: hall flash at mask-off +
600 ms, mask window 5.211 s, otherwise the second win's knobs) reached 6 AM —
the third Night 5 win, 42/42 gates, 0 corrections. Its audit refutes the
premise it was built on: 22 lit / 19 dark hall flashes, the same census as
before the change; DARK uncorrelated with the cycle's mask-off latency (LIT
p50 314 ms, DARK p50 314 ms); dark flashes in runs of consecutive cycles — the
sourced g202 rendering of a held hall light while the g875–880 `hall movement`
counter drains, during which g489/g745/g855 still reset Foxy. The flashes land
and reset Foxy, dark or lit; the phone's 46 % dark against the model's 96 %
latch occupancy measures Foxy's hall presence as far below the model.
The "swallowed flash" explanation of the 26 s Night 6 death is retracted; that
death is unexplained. Evidence:
[night5-third-6am-hallfix-20260912.json](../docs/evidence/night5-third-6am-hallfix-20260912.json).

Chained on the win as Pedro asked: `night6-foxyfix-20260912T231146Z`, the
first `DEATH_TARGETED` bundle (prediction on record: Foxy 75 % at 80/150/170 s,
Puppet 25 %, no wins), died to Withered Foxy at ~238 s the instant the mask
dropped, 24/24 gates. Killer right, time in the model's upper tail (max 280).
Two Night 6 deaths, both Foxy, at 26 s and 238 s: a dispersion the model does
not have. Next death-targeting run: vary the reset cadence deliberately (skip
the post-mask flash or the camdrop light) to measure Foxy's D growth directly.
Night 5 is now 3 wins in 12 clean-contact nights; every Night 6 attempt has
died to Foxy.

**Later:** Pedro's bracket tell confirmed on the third win's video — the
bottom-left touch-hint bracket blinks +7.5..+11 when the flashlight fires with
the hall drawn dark (LIT +26 / doorway +55; FLAT +3..+4, no beam). Of the
audit's 19 dark flashes, 12 fired and 7 did not (180, 250, 260, 310, 320, 360,
400 s). Dark flashes follow a darker office (1.7 vs 3.3) and, in 13 of 19, a
mask window with an occupant in the eyeholes (0 of 22 for lit) — the room is
darker after a mask that repelled an encounter. The grid audit under-reads dim
beams; the retained video is the hall instrument. What refuses the seven is
open. Lit beams show Withered Bonnie and Foxy standing in the hall (30 s) and
Foxy in a dim beam (390 s). Night 6 (`night6-foxyfix`, same census): 13 lit, 10 blink, 0 flat — every
flash fired; dark flashes on both nights split into "dim beam, office 3.3"
(bracket +10.9) and "darker office 1.6" (bracket +7.5), two mechanisms. Encounter census on the same 41 windows: an occupant in the right eyehole at
mask-on plus a darker office after = one state (14 cycles); the next flash
was LIT 1 / BLINK 7 / FLAT 6 after an encounter and LIT 21 / BLINK 5 / FLAT 1
without. Model encounter rate 38 % vs phone 34 %: frequency right, consequence
missing. Only the six post-encounter FLAT flashes (and 250 s) leave Foxy
un-reset. A third witness, the camdrop frame (monitor just down, mask not yet on),
shows the encounter itself: the character already in the office, and who
stands in the hall. Re-indexed to the following mask window it agrees with
the eyehole witness cycle for cycle (13/13 on the win), and it found the
Withered Freddy Pedro asked for: in the office at 320 s on the win (mask
window 330 s), and standing in the hall doorway on four consecutive cycles
of the Night 6 run (70-100 s). Corpus: encounter-corpus-20260912.json. Operator verdict: the 330 s occupant IS Withered Freddy (the first Freddy
attack on the record); 210 s is Chica, not Freddy; every other eyehole guess
held and every '?' was an empty eyehole -- 19/20 for the colour rule alone,
20/20 with the camdrop witness as tie-break. Twenty labelled encounters.

Fourth Night 5 win, `night5-noflash-20260913T003456Z` (fnv1a-9f883b27: the
hallfix knobs with `hallMs 0`, no post-mask hall flash at all; gate PASS with a
prediction on record, model 2250/3000 over 20 phases): 6 AM at 419.7 s, 42/42
gates AGREED, 0 visible hall flashes by construction, masks median 5.08 s
(3 under 5.0), mask-off latency 278/307/352, monitor-down 535/600/672 ms.
This is the model's camdrop-reset credit (hallView = monitor not up during the
drop) confirmed on Night 5 at n=1, and ~620 ms of cycle freed. Camdrop
witness: 9 encounters in 41 windows (Chica 5, Bonnie 4, Freddy 0; 22 %).
Evidence:
[night5-fourth-6am-noflash-20260913.json](../docs/evidence/night5-fourth-6am-noflash-20260913.json).
Operator concern recorded there: every fixed-ROI witness assumes no office pan;
no run has panned since the monitor/mask desync fix (sourced gate: frame 3
groups 220-225, XMouse <= XLeftFrame+367 / >= +648 with viewing = 0), and a
partial pan-shift.py scan of three runs measured 0 px on every measurable
frame. Right-vent-light strategies would need the pan; deferred. Dormant Mangle
was confirmed by the operator in the top-right office corner on anchor1/4/5
(cycle before the kill), but the only detector feature tried (warm pink) is the
ceiling lamp: no detector yet.

Night 6 roadmap (2026-09-13, host-side): the 26 s death is explained (33 ms
hall contact swallowed by the phone's 307-352 ms mask-off latency, doorway
trace flat at both flashes; model floor 40 s because its mask-off is 244 ms
with no latency), and the Night 6 loss is a PHASE loss on Withered Foxy's
five-second roll grid (g337): the hallfix knobs score 0/3000 at every epoch in
[0, 1000) and 3000/3000 across effective epochs 2900-4950, perforated every
200 ms by 50 ms split-arming holes (g263). Shipped: `winner.anchorEpochMs`
(gate replays at the anchor's epoch, manifest carries it, run script refuses
to run it unanchored), `--night-anchor-period-ms` through CLI, campaign port,
fact register and run script, a Night 6 anchor aim (3600 on 5000, maxK 0,
qualified epoch 3850) with evidence
[night6-anchor-aim-20260913.json](../docs/evidence/night6-anchor-aim-20260913.json),
and `artifacts/night6-anchored` (fnv1a-bc5e044c, PASS at 3850). Corrected:
night6-hallfix's qualification-test.json claimed 3000/3000 at epoch 0 while
its manifest replay shows 8/8 Foxy deaths. Open: no phone run has delivered an
epoch in [2900, 4950]; the grid origin (first held night frame) is assumed;
the arming CAM tap latency is a stated proxy. Next physical step: run
`artifacts/night6-anchored` -- Pedro's call.

Night 6 on the phone (2026-09-13): `night6-anchored` released anchored twice
(k=0, 0.16 ms late) and died at 199 s and 219 s to Golden Freddy the second
after a camdrop. Sourced: g336 creates him on a five-second tick with the
cameras up, g778 kills when the light held through the drop meets him, g776
dismisses only at `mask` = 2. The model read g778 only on a light press --
corrected (plant-model.js); the refuted binding now scores 8/600. Second
binding `night6-anchored-b` (fnv1a-94baf687: mask off 8960, flash 9560, aim 0
on 5000, k=1, qualified epoch 5253): both five-second ticks fall between the
drop and the raise, so he is never created, and the flash precedes the second
tick. 3000/3000 across the window. Evidence:
[night6-anchored-golden-freddy-20260913.md](../docs/evidence/night6-anchored-golden-freddy-20260913.md),
[night6-anchor-aim-b-20260913.json](../docs/evidence/night6-anchor-aim-b-20260913.json).

Night 6, later on 2026-09-13 (Pedro AFK, then left with the phone): three
more anchored runs on the mask-8960 family, all inside or just below the
model's band, all dead -- b1 320 s (Foxy at the flash, below the band), c1
81 s and d2 150 s (Balloon Boy walked in; d2 at the band's centre, delivered
5175 ms by frame trace). Two measurements: the input latency is ~50 ms
(hall-lit 47; the 253 ms proxy included the raise animation) and the latched
onset leads the frame-trace onset by ~70 ms. The 4.5 s fully-on mask window
does not hold Balloon Boy on this phone; the 5.2 s window has held him in
every run. Model error open: Balloon Boy leaves short windows too easily.
Binding e = hallfix knobs anchored at effective ~4850 (0.2 s band), ready
for the next session. Evidence:
[night6-anchored-band-runs-20260913.md](../docs/evidence/night6-anchored-band-runs-20260913.md).
Audio witness map written at Pedro's request:
[AUDIO-WITNESS-MAP.md](../docs/device/AUDIO-WITNESS-MAP.md) -- every
night-frame sample handle mapped to its event group, the five open questions
each would answer (the five-second grid phase via the vent bang s0017 and the
footsteps s0025-29 first; BB inside via s0016/s0021-24; `in danger` via s0010;
death via s0012/s0062; arming via s0033), and seven offline instruments in
order. Nothing built; the BlueALSA capture is validated but not wired into the
run script, and `cue-refs` holds only handles 15-33.

2026-09-13 afternoon: the Bluetooth audio sink is connected and wired
(`night-run.sh --bt-audio`, `tools/cue/capture-bt-audio.sh --start/--stop`
with host-clock stamps, `tools/device/tickphase.py`). Binding e
(`night6-anchorede2`, delivered 4814 ms by frame trace, inside the model band)
died at 155.5 s to Foxy at the post-mask flash: the fourth such death, the
model's grid origin is the suspect (Fusion's `Every 5000 ms` runs from the
frame start, not the first night frame). First audio read: vent bang NC 0.79
but the detected bangs are endpoint bangs, not roll witnesses; WinD ticks all
present under a 500 ms fold (z 6-16 per cycle) with a linear -0.35 % clock
drift audio-vs-host that must be corrected before any phase is read.
`night5-run.sh` renamed `night-run.sh` (Pedro). Evidence:
[night6-anchorede2-audio-20260913.md](../docs/evidence/night6-anchorede2-audio-20260913.md).
Same afternoon, correction: the aptX-HD capture lost 7.6 % of its samples
(195.6 s in 211.6 s of wall), so its time axis is broken and the "-0.35 %
drift" was loss; the scream sits 7 s early. `capture-bt-audio.sh --stop` now
records `missingFraction`/`timeAxis` and `tickphase.py` refuses a phase on a
broken axis. Next capture on SBC (phone developer options). Detectability
census on the run (NC max): hall presence 0.95, blackout/signal-lost 1.00,
UI click 0.99, vent bang 0.79, scream 0.75, mask breathing 0.59, monitor
button 0.60, Mangle movement 0.54; footsteps and WinD fold-only; BB vocals
absent (he never came in). Evidence:
[night6-anchorede2-audio-census-20260913.json](../docs/evidence/night6-anchorede2-audio-census-20260913.json).
Grid origin hypothesis withdrawn the same afternoon: the g571 kill on the
10 s tick sits at schedule phase 0.2 s in the video, so the game's five-second
ticks land at 0.186 + 5k after the release -- where the model already puts
them. The mask-on touch sound (s0007, g267) is a per-cycle audio anchor
(spread 40 ms over 110 s; the 16 s loss is one early gap, not drift). The
Night 6 death mode at AI 15 is a missed D reset (post-mask flash refused by
the mask-off latency tail, or camdrop light released before the drop's
effect) followed by a 20 %-per-tick lock at D >= 6. Next instrument: per-cycle
doorway state at every camdrop and flash, beside the audio anchor.
Per-cycle ledger on night6-anchorede2 (video + audio): occupants at the drop
in cycles 5 (hue 57, unlabelled), 8 (W. Freddy), 11 (W. Bonnie); s0010 audio
onsets at the same cycles; FLAT flashes after the three defended windows;
the camdrop beam never renders. Death mechanism: cycle 13's DIM flash was the
last reset, the mid-cycle tick saw D = 6 at AI 15 (20 % lock), g571 killed
on the 10 s tick. A Night 6 route needs D < 6 at both five-second ticks.
Evidence:
[night6-anchorede2-cycle-ledger-20260913.json](../docs/evidence/night6-anchorede2-cycle-ledger-20260913.json).
Binding f (camdrop light held 200 ms past the monitor tap) died at 165.5 s
exactly as e (155.5 s): the tail is not the lever. Both ledgers show a run
of FLAT post-mask flashes before the death (the mask-off latency tail eating
the 50-100 ms before the flash press). Two aborted attempts fixed on the way
(executor refuses overlapping macros: tail 450 put the mask tap inside the
hold; the audio reader ignored SIGINT and held the PCM). Binding g = mask off
9360 (flash margin 150-200 ms), same aim. Evidence:
[night6-anchoredf3-20260913.md](../docs/evidence/night6-anchoredf3-20260913.md).
Binding g (mask off 9360) died at 195.5 s, five cycles after e/f, same
mechanism: the lock on the roll that follows the flash press by ~130 ms,
before or as the flash lands. Binding h moves the flash and mask-off 100 ms
earlier (9960/9260). Evidence:
[night6-anchoredg1-20260913.md](../docs/evidence/night6-anchoredg1-20260913.md).

**2026-09-13, 18:09 UTC: Night 6 reached 6 AM on the device.**
`night6-anchoredh1-20260913T180208Z` (binding h, fnv1a-37278c63: hallfix
knobs, flash 9960, mask off 9260, camdrop tail 200, anchored at aim 4870 on
the 5000 ms grid, delivered 4816): executor terminal sixam, video 6 AM screen
at 448.5 s, 42/42 gates AGREED, the title now offers Custom Night. Lineage
e -> f -> g -> h moved the post-mask flash ahead of the five-second roll it
must beat. Evidence:
[night6-first-6am-anchoredh-20260913.json](../docs/evidence/night6-first-6am-anchoredh-20260913.json).
Open: n=1; the per-cycle ledger and the audio anchors of the win are retained
for the next reading; the phone still streams aptX-HD (SBC pending).

Night 7 (10/20), first look after the Night 6 win: the winning knobs score
3000/3000 at epoch 0 and 8.33 ms and 0/3000 at 16.67 ms -- a one-frame band,
the model's deterministic epoch-0 case, unreachable with +-30 ms of delivery
jitter. Why: at AI 20 Golden Freddy is created on every five-second tick the
cameras are up and the held camdrop light kills him into you (g778), while
Foxy (capped 17, g829) needs D <= 3 at every tick; the only tick phase that
satisfies both is the ~100 ms between the post-mask flash landing and the
monitor raise. Search under way: a later raise (shorter wind) to widen that
window. Minus 7 (the community's RNG-proof 10/20 route) is reactive and has
no qualified device lane.

Night 7 (10/20) on the phone, 2026-09-13 evening: binding i (loop -2500,
opening wind 50, aim 2510 k=0) reached the night on the sixth attempt after
five flow fixes (save cursor, observation envelope, readback race, Ready
contact 100 ms, latch authorization) and died at ~140 s to Balloon Boy
through the mask window, then Foxy. The Custom Night configuration (Golden
Freddy preset + dial readback) is now DEVICE_MEASURED: all ten at 20,
confirmed twice. Evidence:
[night7-anchoredi6-20260913.md](../docs/evidence/night7-anchoredi6-20260913.md).
Open: the model lets Balloon Boy leave/enter mask windows differently from
the phone (the Night 6 finding), decisive at AI 20.

2026-09-13, late: the Night 7 "trace dies ~3 s before the onset" is the
runner, not the helper. On seven of twelve traced runs (i5, i6, j4-j8) the
lifecycle observer read the Custom Night dial screen (all dials at 20) as
`state=gameover`, and `night-run.sh`'s watcher pulled the trace on that label
6-8 s before the first `state=night`; the helper then ran the night on its
slow path (8 fps, 400 ms reads). Reproduced the entry without the campaign:
the trace survives the intro (5857 frames, one 1.24 s black gap). Fixed:
`screenstate.py` refuses a game over with a bright portrait band (measured
0.000 on ten real game overs, 0.215 on seven dial frames, floor 0.05), and
the watcher requires a `state=night` observation before a terminal label.
Evidence:
[night7-trace-pulled-on-dial-screen-20260913.md](../docs/evidence/night7-trace-pulled-on-dial-screen-20260913.md).
Open: the delivered epochs of those seven runs are UNKNOWN; the next Night 7
run is a measurement run for the instrument before any new band is priced.
Also this session: the Digital Wellbeing "Used for 40m" bubble was the
screen-time reminder (no app timer existed); it is off for FNaF 2 and the
Companion.

**2026-09-14, 00:48 UTC: Night 7 (10/20) reached 6 AM on the device.**
Binding k2 (all ten dials 20, puppet 15, Minus Toys; the j loop with only its
masked end extended, maskOffMs 6760 -> 7000, hall pinned 7460), anchored at
aim 2433 on the 5000 ms grid (k=0, released 2435.5, 2.5 ms late): executor
terminal sixam at 455.0 s, 42/42 cycle gates agreed, post-run title carries
customNight. Lineage i6 -> j10/j11 -> j12 -> k1 (device-refuted, dead ~20 s)
-> k2. Evidence:
[night7-first-6am-k2-20260914.json](../docs/evidence/night7-first-6am-k2-20260914.json),
run `night7-k2-aim2433-maskoff7000-20260914T004106Z`, commit 6d0a5c3. Claim
ladder level 7 (10/20 clear) has one artifact; Gate G promotion is not
invoked (no cohort, no fault-injected simulator run, no safety review).

**2026-09-14, 02:13 UTC: the Night 7 4/20 preset reached 6 AM** with the
minus3 loop reduced to four rows per 10 s (hall flash, monitor up, wind,
camdrop; no mask input exists in the plan): sixam at 453.5 s, 41/41 gates
agreed. Evidence:
[night7-420-first-6am-minimal3-20260914.json](../docs/evidence/night7-420-first-6am-minimal3-20260914.json),
run `night7-n7-420-minimal-m3-20260914T020543Z`, commit a018875.

2026-09-14, 02:30-02:43 UTC, three runs that never entered a night (all
recorded, none a route claim): `night7-m4-catalog` aborted before arming
("armMode requires an arm-verified plan"); `night7-m5-catalog` aborted at its
first action ("action clear-1 overlaps the previous HID macro") -- the Minus 7
catalog lane has no qualified run; `night6-h2-reliability` was refused by the
bundle validator with "winner hash does not match manifest" and graded as
unmanifested. Diagnosis (host, 2026-09-14): the binding-h bundle was emitted
2026-09-13 15:00; commit f00fca3 (16:03) added the `observeUntilMs` knob
default to `tools/device/minus-toys-plan.mjs`, which is in that bundle's
engine-source digest. Re-emitting the same winner.json under HEAD yields a
byte-identical night-6.plan and the same replay hash fnv1a-c651e2ff; the only
winner difference is the explicit `observeUntilMs: 420000`, the value that was
hard-coded when h won. The validator now hashes winner.json as stored, so a
later default reports as the engine-source change it is, not as a tampered
winner. The Night 6 cohort runs the re-emitted bundle
`artifacts/night6-cohort-h/bundle`; its identity to the winning binding is the
plan sha256 and replay hash above. Nothing on the phone was involved in the
h2 refusal.

Open: Plan 12 level 6 (Night 6 reliability cohort) is empty and not yet
predeclared; Gate G is not invoked; the Minus 7 catalog lane has two pre-night
aborts; the delivered epochs of the seven dial-screen-pulled traces remain
UNKNOWN.

**2026-09-14/15: the first predeclared Night 7 (10/20) cohort is complete --
binding k2 won 3 of 10 on the phone.** Predeclared before run 1
([predeclaration](../docs/evidence/night7-cohort-k2-predeclaration-20260914.json)):
ten counted k2 runs, aim 2433 on the 5000 ms grid, observe-once, no tuning.
Result ([cohort record](../docs/evidence/night7-cohort-k2-result-20260914.json),
commit f6eb1f4): 3 wins (r01b, r03, r05), 7 deaths, 0 invalid, 2 excluded (r01:
the fact register had no k2 aim, now registered from a re-run census; r07:
helper clock probe timeout, onset never latched). 3/10, Wilson 95% [0.108,
0.603]. Every release landed 0.04-1.25 ms late and every run delivered the
same loop phase by video (first CAM 11 gap 2.91-3.06 s).

The model is refuted at that phase: under the 16-bit Fusion RNG there are only
65,536 nights and k2 wins all of them at 2416.66, 2433 and 2449.99 ms. All seven
phone deaths are Withered Foxy, first visible 7.29-7.73 s into a cycle, around
the model's 7.567 s Foxy roll and just after the 7.46 s hall flash. Candidate
mechanism (not a finding): a hall flash whose effect lands after that roll;
the model cliff is 7540-7560 ms at epoch 2433 and moves with the delivered
epoch, and the model applies presses with no per-press latency. Refuted along
the way: early authorization as cause, refused-flash streaks as cause, and the
r02/r04 ledger reads (cycle-ledger.py used Night 6 constants; fixed at
d29fa6b, gated by test-cycle-ledger.py).

Also this session, host-side: seed-clock forensics
([record](../docs/evidence/seed-clock-forensics-night6-20260914.json)) --
blackout-loop onsets cannot identify a seed; in the model, full camera
positions lock a seed in ~20 s given a +-20 ms clock window, encounters in ~84 s;
the eyehole reader reproduces 12/14 corpus labels. Plan 25 records the
horizons beyond the ladder.

Open: (1) k3 = k2 with the hall flash at 7400 ms (model 3000/3000, band
unchanged, Foxy edge 2516 -> 2583 ms) needs its anchor-aim record and a new
predeclared cohort; (2) no live hall-light latency probe exists to test the
~90 ms tail; (3) the lifecycle observer reads state=night before the intro on
some runs; (4) helper wall-clock stamp at the onset latch and a twin-nights
test of clock seeding; (5) the peer session's uncommitted Minus 7 catalog lane
(custom7 target, arm-less mode) is untouched. Gate G is not invoked.

**2026-09-15: k3 won its first Night 7 (10/20) run, the helper stamps the phone
wall clock, and the striped intro card no longer reads as night.** k3 = k2 with
the hall flash at 7400 ms ([aim](../docs/evidence/night7-anchor-aim-k3-20260915.json));
run `night7-night7-k3-wallclock-r1` reached 6 AM, 42/42 gates, released 0.27 ms
late ([record](../docs/evidence/night7-k3-wallclock-r1-20260915.json), commit e00ab25).
One win, not a rate. Video beam onsets from the k2 cohort put only 2 of 7
death-cycle hall flashes late, so the late-flash mechanism k3 targets is not
the main one.

The companion now returns `wallMs` beside `snapshotNs`, and the anchor's
scheduled event carries `onsetPhoneWallMs` (9b2b017). The encounter
prediction published before grading
([record](../docs/evidence/k3-wallclock-r1-encounter-prediction-20260915.json))
was not supported, and clock seeding remains untested: eyehole identity reads
miss Withered Freddy and leave tied seeds, and neither k3's nor r03's best
seeds sit in the 0-6.9 s window a night-load seed allows. nightpredicate
refuses night on a bright full-width band at the meter's height (stripes 149.1
on six cards, real nights at most 56.6).

Open: (1) a k3 cohort if its rate matters; (2) twin nights with a Start tap
timed on the phone wall clock; (3) why the eyehole never shows Withered Freddy
on k2/k3; (4) the lifecycle frames that exist only after the intro now carry the
guard -- confirm no new false `other` on a live night; (5) the peer session's
uncommitted Minus 7 lane is untouched.

**2026-09-15: Foxy's dump chain is in the model behind an option, and it does
not reproduce the phone; the phone's Foxy deaths come in encounter-free
cycles.** Record: [foxy-chain-night7-20260915](../docs/evidence/foxy-chain-night7-20260915.json).
The Office sheet runs Foxy as an A/B chain the default model never had: the
5 s roll (g337) draws Random(5) every time and only writes A=1/D=0; A becomes 2
once B drains (g349/g364); the move and the lock (g389/g390) wait on a clear
hall latch. The default model skips 42 of ~84 Foxy draws per night and spends
one unsourced draw at construction. That leaves rates alone but scrambles
seed-specific encounter predictions: restoring the draws changes the first
encounter on ~78% of 3000 k2 seeds and the 120 s sequence on >99%.

`sourcedDropLightOrder` and `sourcedFoxyChain` (both default off; off is
trace-identical and k2/k3/h validate READY) kill k2 on 2959/3000 and 2999/3000
seeds, every lock following an encounter that blocks the camdrop flash. The
phone refutes that path: all five timed k2 deaths read an empty right eyehole
in the death cycle (base rate ~57% occupied). Chowdren's generated source
(supporting, not the Android runtime) puts g824/g825's in-danger test before
their 1 s accumulators, so D's tick pauses during encounters; the model's
per-encounter offset is unsourced. Three of seven death-cycle 7.46 s flashes
show no peak, consistent with a lost 33 ms hall contact.

Open: (1) why blocked-camdrop cycles do not lock Foxy on the phone (the paused
g824 accumulator, the real in-danger length); (2) what locks him in an
encounter-free cycle (a lost 33 ms hall contact, or a camdrop flash that did not
latch); (3) a calibrated camdrop hall-light reader; (4) the peer session's
uncommitted Minus 7 lane and configure-custom-night.mjs are untouched.

**2026-09-15: the lit counter removes the model's Foxy death path; k3 won
three twin nights; the office frame's seed moment is pinned but not
reproducible.** Records: [foxy-chain-night7-20260915](../docs/evidence/foxy-chain-night7-20260915.json),
[night7-k3-twin-nights-result-20260915](../docs/evidence/night7-k3-twin-nights-result-20260915.json).
Office events 74-83/211/382-384/426 (Chowdren real names) make lit? a
persistent counter, so a camera light held through the drop latches the hall on
the drop frame even when an encounter starts there (64cd7c5). The literal Foxy
chain then wins k2, k3 and Night 6 h 3000/3000; the phone shows 0/107 FLAT
undefended flashes, so the k2 cohort's encounter-free Foxy deaths still need a
camdrop that fails to latch, which the video cannot see.

Twin nights (predeclared be18489): A, B at Start-tap residue 20000, C at 50000;
all three won (k3 is 4/4 on the phone, not a rate). The runtime reseeds every
frame start (CRun.allocRunHeader, first call of initRunLoop, after
loadFullFrame's image/sound loading), so the office seed lands just before its
first frame, 5.0-5.1 s after the tap with tens of ms of loading jitter: A and B
started 62 ms apart and could not share a seed. Verdict INCONCLUSIVE by the
predeclared rules. A's eyehole labels are correct by eye on the reader's own
frames; the best fixed-model seeds still conflict on 3/4/6 cycles.

Open: (1) stream MMFRuntime "loading frame #:4" live to bracket the seed (the
phone's log rolls over in ~60 s); (2) a stronger seed observable (camera
positions); (3) remaining model draws out of line before seed scoring; (4) why
k2's camdrops fail to latch; (5) a predeclared k3 cohort for its rate; (6) the
peer session's uncommitted Minus 7 lane is untouched.

**2026-09-15: a k3 Night 7 carried the native frame trace; that night died at about 105 s.**
`night7-night7-k3-full-04-20260915T051327Z` kept a 6556-frame Cue Helper trace from about 3 s
before the office loaded through the death. Its only gap over 100 ms is the 1.26 s office load.
It also kept the office seed window from the live game log: 13 candidates, low16 34042-34054,
74-86 ms before the night onset. The trace was started directly over an adb forward just after
`custom-night.start`. The previous attempt (`full-03`) used `night-run.sh --frame-trace`, whose
trace start overlapped the Custom Night clock-stamp probe; the probe timed out, adb timed out, and
the campaign aborted before any night. That overlap is suspected, not proven. full-04 is k3's
first loss on the phone (6 wins, 1 loss). The cause is unidentified; its gate 11 aborted on an
unreadable mask only after the static. The 13 seeds are not scored yet; that needs a replay
harness driven by the trace's frame times and an eyehole read of full-04's video. Evidence:
[night7-k3-frametrace-nights-20260915.json](../docs/evidence/night7-k3-frametrace-nights-20260915.json).

**2026-09-15: the `hall movement` trigger is sourced, and placed instances had a third scramble.**
The APK's layout loader reads every placed instance's object handle as `readAShort() ^ 48`
(`Frame/CLO.load`), then resolves it through the item table `COI.loadHeader` already XORed
with 28. Both earlier instance rules (raw row, 2026-08-26; event handle, 2026-09-15 first
pass) left the Office without five of its twelve camera markers, which a Fusion `Set position`
silently skips; the 186/189 recompile join behind the first pass compared the chunk with
itself. Under the runtime's rule all twelve markers are placed (196/205 Office instances join
to event-referenced objects, against 154 and 158), and the approach markers form one column at
x = 668: `hall stage 1` (481), `hall stage 2` (550), `in office` (612), `got you box` (681).
`hall movement` (669, 503; 16x125, X-scaled to 14 px by g989) is overlapped only from the two
hall stages, so g875-880 arm the 300 on **entry into the hall column** by W. Freddy, W. Bonnie,
T. Freddy, T. Chica, Mangle or W. Foxy, once per continuous overlap (`C -7`), never while
standing; g881 drains it; g779, g202-209 and g1034/1035 read it. `hear footsteps` and
`close by` fall out of the same table. `readdump.py --lo-xor` (default 48) and
`test-instances.py` carry the rule; the CTFAK checkout was rebuilt from upstream plus the
ledger's Linux port and reproduces the dump byte for byte. Rung: none above FIXTURE (source
work). Open: the g881 drain expression, which `views.Active` frames the phone's LIT/DIM are,
and the entry-triggered per-character latch in `plant-model.js` with a census. Evidence:
[hall-movement-trigger-20260915.json](../docs/evidence/hall-movement-trigger-20260915.json).

**2026-09-15 (later): the entry-triggered `hall movement` is in the model, and it is outcome-neutral.**
`plant-model.js` ticks the latch every frame in `tickHallMovement` (no longer inside the Golden
Freddy hall tick, so it lives with `gfEnabled` off), exposes it as `sim.hallMovementFrames`, and
emits `hall-movement {who}` when it arms. Under `sourcedHallEntry` (default off) the 300 is written
once per entry into the hall column per character, as g875-880's `C -7` says; the legacy mode keeps
refreshing it every transit frame. Census at 3000 seeds, `epochMs` 0: device plans nights 5/6/7
699, 645, 149 of 3000 and Minus Toys night 7 3000/3000 in **both** modes, every death row identical,
and the hallway Golden Freddy never got inside in 24 000 nights -- the latch's only observable on
these plans is the hall render g202 draws while it is above zero, which is the k3 seed-lock signal
the scorer had been assuming. Gates seen green: `sourcetest` 209/209, `test:core`, `test:unit`.
`test:contracts` fails on `test-decode-once.py` (`preexec_fn`) on the committed HEAD as well, so
that lane is environmental here, not this change. Evidence:
[hall-movement-trigger-20260915.json](../docs/evidence/hall-movement-trigger-20260915.json).

**2026-09-15 (later still): the hall's DIM flash is g202's animation 99, seen.**
The dumper now emits `OBJANIM` rows (image handles per animation direction) and, with
`CTFAK_IMAGE_DIR`/`CTFAK_IMAGE_HANDLES` in the libgdiplus image (`tools/dump/ctfak-gdiplus.Dockerfile`),
writes named images as PNG. `views.Active` animation 36 (image 463) is the lit empty hall, 99
(image 570) is the hall with no beam in the doorway while the ceiling lamp still shows -- what g202
draws while `hall movement` is above zero -- and 93 (image 564) is Golden Freddy in the lit hall.
g881 drains by `1 * Global(5)`, the dt term of g535/g745/g779, so the 300 is five real seconds.
LIT = 36 or a standing character, DIM = 99 = a hall-column entry within five seconds, BLACK = light
not held. Evidence:
[hall-movement-trigger-20260915.json](../docs/evidence/hall-movement-trigger-20260915.json).

**2026-09-15 (later): the vent anchors never contradicted the phone.**
Re-read with the runtime's instance rule, the dump places `left light` at scene (147, 429) and
`right light` at (1444, 427); the phone's left-LIGHT tap at physical (350, 615) is virtual
(149, 437), inside the left box, and Shooter25's ~168 / ~1422 are within 22 units. The three light
hitboxes have Office instances (parked at y 804-844, moved or created by g1223 and g1072-1081). The
2026-08-26 "anchors off-frame, HUD laid out from code" finding is retracted; its reachability
arithmetic was right within 5% and is now sourced: the right light is centred after 420 of the 576
pan units (~280 ms in the fast band), the left light is at screen x -429 at maximum pan, so no
single pan position reaches both. Evidence:
[vent-anchors-office-layout-20260915.json](../docs/evidence/vent-anchors-office-layout-20260915.json).

**2026-09-15 (evening): a local k3 run was requested and is blocked on the bundle, and that is a defect.**
The moto g56 is on this machine's adb, `device:dry-run` passes (`run-20260915142753-b0e55bd0-4e4c57`),
the HID qualification and the Custom Night calibration are in the tree -- but the k3 binding
(`fnv1a-5c8dcb5f`, one 6 AM on 2026-09-15) exists only as `artifacts/night7-anchored-k3/winner.json`
on the peer machine, and `artifacts/` is gitignored. Rebuilding it from the recorded knob chain
(i -> j -> k2 -> k3) does not reproduce k2's plan hash (`e5259e0f...` vs `ac68e343...`) with an
identical emitter digest, so the evidence records do not carry the whole winner. None of the
thirteen `ANCHOR_AIMS` bindings (Night 5, 6 a-h, 7 i/j/k2/k3) has a tracked winner; the four
tracked `campaign-*-winner.json` are other bindings. Pedro: "the run that wins on the device, the
repository's most precious product, is not even part of it." `test-fact-register.mjs` now refuses a
register entry without a tracked winner of the same `stableHash`, carrying the thirteen as a closed
`UNTRACKED_WINNER_DEBT` list; CLAUDE.md carries the rule. To run k3 here: copy
`artifacts/night7-anchored-k3/` (bundle + winner.json) from the peer machine, commit the winner as
`tools/device/campaign-night7-k3-winner.json` (the gate confirms the hash), then
`tools/device/night-run.sh --label k3-local --night 7 --bundle artifacts/night7-anchored-k3/bundle --frame-trace`.

**2026-09-16 (night): Night 6 h won again, and the seed search now has a measured blocker
instead of a suspected one.** `night6-seedlock-h-20260916T223633Z` reached 6 AM with the game
log, the native frame trace (25,565 frames), kernel touches and video all kept. Converted to
the helper's monotonic clock, the logged 16-candidate office bracket falls 1290-1305 ms into
the trace's own 1335 ms office-load gap, 59.6 ms before the first office frame: two independent
clocks now agree on where the frame was seeded, so the bracket is not the weak link. Driving the
model with the run's own 338 kernel contacts at L = 52 ms and censusing all 65,536 seeds, the
best whole-night fit is 5 of 42 eyehole windows (seed 39435) while the bracket seeds score 16-26
and rank 1,673-57,383 -- and no bracket seed reaches a good fit at any stream offset up to 2,000
burned draws (one state at <= 6 errors against 0.98 expected by chance). The observable is not
the limit: against a known model night the true seed scores 0 and the best wrong seed 4-13
(400 targets), and the 42 windows carry 59.7 bits against the 16 needed. **The limit is that
the model decorrelates under the input-latency uncertainty at the same point the information
arrives**: a 6 ms change in L changes the night from window 11-16 (p10 = 7), 16 bits have
accumulated only by window ~16, and seed 39435's fit falls from 5 errors to 18 at L = 40, 46, 58
and 64, with a different best seed at every latency. A lock therefore needs the bits inside the
first 6-8 cycles -- a route whose monitor time surveys several cameras per raise, rather than
parking on CAM 11 -- or the per-touch registration loop pinned to about one frame. Also fixed:
g822 is an application StartOfFrame condition (object type -3, num -1), not the system Always
(-1, -1), so the model drew Paper Pals' AI every frame and spent ~60 spurious draws per second;
it now draws once, before g811. Rung: none above FIXTURE (the night is device evidence for the
binding, not a promotion). Evidence:
[night6-h-seedlock-census-20260916](../docs/evidence/night6-h-seedlock-census-20260916.json).

**2026-09-16 (same night, sizing the fix): a camera survey would name the seed in 75 s where
the eyehole route needs 190.** `n6-positions.mjs` records every unit's node at each monitor
raise; censused over all 65,536 seeds on the same run's presses, a six-camera survey
{8,7,4,3,10,9} reaches 15.08 bits and names 65% of seeds uniquely by raise 7, 83% by raise 8
(75 s) and 97% by raise 10; eight cameras reach 82% by raise 7. The route actually flown reads
2.02 bits by window 5, 4.18 by window 7 and 14.81 (49% unique) only by window 18. The survey
signature is no more stable under latency error than the eyehole (first differing raise at 6 ms:
median 9-14, p10 5-6), so the whole gain is speed: it delivers its sixteen bits before the median
decorrelation point instead of long after it. Night 6 understates this, because its three Toys
sit at CAM 9 until 2 AM. Proposed next physical test: binding h unchanged except that the
monitor-up stretch steps through those six cameras, with the lock decided on the first 75 s and
the rest of the night left alone so the run is still a graded 6 AM attempt. Evidence:
[night6-h-seedlock-census-20260916](../docs/evidence/night6-h-seedlock-census-20260916.json).

**Correction, same night:** the profile carries tap points for cams 4, 7, 8, 9, 10 and 11 and no
others, so the survey route needs **no new geometry** -- and that calibrated set beats the
{8,7,4,3,10,9} set proposed above: 15.54 bits and 76% of seeds uniquely named by raise 7, 90% by
raise 8 (75 s), 98% by raise 10. Build the route on the six cameras the phone can already tap.

**2026-09-16 (late): one seed picked out of the sixteen the clock brackets.** Scoring the
observations in time order and stopping at the first mismatch -- so lucky late agreement cannot
rescue a wrong seed -- the hall reads bound the first encounter on their own: flash 3 (44.9 s) is
lit with no blackout and window 4 (49.2 s) shows Withered Chica, so the night's first encounter
began between 44.9 and 50.5 s and it was Withered Chica. Of the 656 (bracket seed, latency) pairs
only 34 reproduce that, all of them seeds 51380 or 51381 and all at L >= 68 ms -- which refutes
the 52 ms this run's monitor-to-static measurement gave and agrees with the k3 night's 83 ms.
51381 then fails at observation 3. **Seed 51380 tracks the phone for 16 consecutive observations,
to about 85 s, while every other bracket seed stops at 8 or earlier, at every latency from 68 to
100 ms.** At a fixed L = 84 ms only 0.496% of all 65,536 seeds reach an unbroken prefix of 16, so
the odds within the bracket are about 13:1 for 51380. That is a **pick, not a lock**: the global
best prefix over the whole seed space is 26, outside the bracket, so the model is still unfaithful
enough for chance to beat the truth over a full night. Two defects are now isolated: the model's
encounter timing slips whole 10 s cycles (three of 51380's cue pairs land exactly on the phone's,
others sit one cycle out), and at L >= 68 ms Foxy's g573 kills at 225-265 s on a night the phone
won. Fixing the cycle slip is the shortest path from pick to lock. Evidence:
[night6-h-seedlock-census-20260916](../docs/evidence/night6-h-seedlock-census-20260916.json).

**2026-09-16 (last): the seed is picked by timing the first frame, and two earlier nights collapse
to a single candidate.** Read from classes.dex, `CRunApp.startTheFrame` logs "Starting new frame"
at instruction 42, runs `MMFRuntime.updateViewport` at 113 (its block ends "Setting renderer
limits..."), and only calls `CRun.initRunLoop` at 231 -- whose **instruction 0** is
`allocRunHeader`, the one `currentTimeMillis` that becomes `rh3Graine`. Everything that logs from
inside initRunLoop is therefore after the seed: `createFrameObjects` (29) reaches
`CExtLoad.loadRunObject` and prints "Created extension: ", and `f_InitLoop` (57) prints
"iPhoneOptions are ". So the seed sits between the last line before initRunLoop and the first line
inside it, which is one or two milliseconds -- not the 13-16 ms of the "Starting new frame" to
next "startTheFrame() called" pair the tool used. Re-derived on every retained log: tonight's
Night 6 **16 -> 2 (51376 or 51377)**, k3 full-07d 15 -> 2, twin A 13 -> 2, and **k3 full-06
14 -> 1 (47593)** and **k3 full-04 13 -> 1 (34043)** -- two nights named outright by the clock.
This **retracts the 51380 pick** made earlier tonight: 51380 is four milliseconds past the first
"Created extension" line, so it was the 7% false positive its own statistics allowed. It also
sharpens the model's defect to a single sentence: for the clock's candidates the model puts the
first office encounter at 78.8 s, the right character three cycles after the phone's 49 s.
`office-seed-bracket.py` applies the sourced rule by default, keeps the old one behind
`--legacy-pair`, names the rule it used, and its test (in `test:contracts`) covers both.
Evidence: [night6-h-seedlock-census-20260916](../docs/evidence/night6-h-seedlock-census-20260916.json).

**2026-09-17: a timed start for Night 6, and the seed forced to a three-millisecond cluster.**
`FNAF_START_PHONE_WALL_RESIDUE_MS` now governs a story night's title press, sharing the stamping
and refusal path with the Custom Night Start tap. On an idle host the press lands **0.007 ms** from
the planned phone wall instant; on a busy one it drifts 20-40 ms, and that error goes straight into
the seed. Three attempts taught the ordering the hard way. The title cursor survives an attempt, so
the first press sometimes activates the row and sometimes only focuses it, and only the
**activating** press fixes the seed -- it follows by a steady **4849 ms**, 3556 to the office load
and 1293 through it. Waiting to observe which press activated is not allowed: `intro()` stamps the
instant after which a latched onset counts as this night's, and the office appears 4.8 s after the
activating press, so two perfectly placed presses were refused as `onset-predates-intro` before the
ordering was understood. The press is now placed and the phase returns at once, and
`timedStartHeld` reads back from the seed which press did the work.

Cohort 1 (three nights) spread 1906 ms because half its nights were started by the untimed second
press; it was stopped at three of its eight allowed attempts because those three showed eight could
not produce a twin. Cohort 2 runs the corrected start. Aimed nights land their seeds in a
**3 ms cluster** (24850, 24851, 24853), and `night6-c2-01-20260917T021417Z` reached **6 AM with its
office seed named to a single millisecond, 24851** -- the first 6 AM in this project whose seed is
known exactly. Twins still need two attempts on the same millisecond: the measured window is 37 ms
of delay plus the press error, about eight attempts on an idle host.

Two tool corrections worth keeping. The seed is the low 16 bits of the wall clock, so attempts a
whole number of 65,536 ms periods apart share a seed while their absolute milliseconds differ; the
first twin detector grouped by absolute time and would have missed a real pair. And
`twin-compare.py` reads a night's 42 mask windows from the video alone, aligning on the cameras-up
statics rather than on any model: it agrees with the corpus hand read on 40 of 42 windows, and both
differences are misses rather than wrong characters, so true twins should agree on about 38-40.
`night-run.sh` gained `--no-grade` so a cohort is not serialised behind an 18-minute pipeline.
Evidence: [night6-twin-nights-result-20260916](../docs/evidence/night6-twin-nights-result-20260916.json),
predeclared in [night6-twin-nights-predeclaration-20260916](../docs/evidence/night6-twin-nights-predeclaration-20260916.json).

**2026-09-17 (same night): the phone's wall clock is settable without root, and pinning it is the
lever that would finish twin nights.** `adb shell date -s` is refused, but
`adb shell cmd alarm set-time <epochMs>` works from the shell: tested, the clock moved by the
requested amount and was restored to within 6 ms of the host. Hooking `currentTimeMillis` inside
the game is not available without root or repackaging, and a repackaged APK would change the
target every qualification names. Setting the clock does not by itself beat the seed jitter -- the
uncertainty lives between any anchor we control and the game's own read, and the nearest log line
before that read is 1-15 ms ahead of it, shorter than the 46-62 ms an adb round trip costs. What
does help is **pinning**: loop the set so the uncertainty becomes the set period instead of the
natural 40 ms. One `cmd alarm set-time` costs 34 ms in an on-device loop, which does not beat it;
**eight parallel on-device loops hold the clock a median 7 ms above the pin (p90 23, max 38), and
each sample's own `date` spawn costs 10-25 ms of that**, so the true pin is tighter. Next: pin
through the office load at a seed already held by a completed night, measure the resulting seed
distribution before spending nights on it, and stop the matching attempt at about 120 s -- a full
night is not needed to compare encounters. Evidence:
[night6-twin-nights-result-20260916](../docs/evidence/night6-twin-nights-result-20260916.json).

**2026-09-17: the model gap, measured on a night the phone won.** `night6-c2-01-20260917T021417Z`
reached 6 AM with all 42 cycle gates agreeing and its office seed named to a single millisecond
(24851). No frame trace was kept and none is needed: the plan is deterministic, every gate agreed,
and the release instant and the seed instant are the same phone wall clock, so the presses sit
6347 ms after the model's frame 1. **At its own seed the model dies at 150.2 s to Golden Freddy,
and censused over 600 seeds on the same presses it dies in all 600** -- 368 Foxy, 220 Golden
Freddy, 12 inside-office. With Golden Freddy disabled it still dies in all 600: **551 Foxy**, 46
inside-office, 3 Puppet. So this is not a seeding artefact; no seed survives a route the phone
survived, and both dominant causes are hall-flash kill rules on a route that flashes every cycle.
A lead on the Golden Freddy half: g336's fifth condition is `mmonitorUp.Active` **invisible**
(mmfparser condition -28 is ObjectInvisible), which the model folds into `monitor === MON_UP`; if
that sprite is visible while the monitor is up, the source creates him far more rarely than the
model does. Foxy is the bigger fish at 92% of the remaining deaths. The pass mark for any fix is
simple: some seed must survive this route. Evidence:
[night6-h-seedlock-census-20260916](../docs/evidence/night6-h-seedlock-census-20260916.json).

**2026-09-17: the model gap was two wall clocks, not a Foxy rule.**
The model killed all 600 censused seeds on `night6-c2-01`, a Night 6 run that reached 6 AM with 42 of
42 cycle gates AGREED. Before moving anything, every group that can produce that death was read out
of the event dump and compared line by line: `lit?` (g75-g96), the hall latch (g488/g489), the 5 s
roll (g337), the A/B chain (g349, g364, g389, g390), the kill (g573), exposure and retreat (g745,
g846), the pin (g855) and all four D terms (g824, g825, g864, g872-g874). Every one is a faithful
transcription -- including `100 * night` and `500 + Random(500)`, and the fact that g573 commits
`being attacked by = 4` which nothing in frame 3 ever writes back to 0. So no rule was wrong.

The presses were. `phase.json`'s origin and every gate's `reachedAt` are stamped on the **host's**
wall clock; the office seed is read out of the phone's logcat on the **phone's**. On this run the two
stood **1374.8 ms** apart, so the reconstruction placed the whole schedule 1.37 s late against the
game's own clock -- and 6347 ms is nearly the worst phase available, 1477 ms from a surviving band.
Survival is a **240 ms band that recurs every 5000 ms**, the movement-roll period: swept -1000 to
+10000 ms at 100 ms steps, nothing outside those bands lives. Corrected to one clock the origin is
**4972.2 ms**, and the anchor's own record predicts 4972 independently (aim 4870, fired 0.73 ms late,
10 ms handoff, its phone-wall onset estimate 91.2 ms after the true seed). The model then reaches
6 AM on **all 65,536 seeds** -- the whole space, with no death of any cause.

`phase-reconstruct.mjs` now names the clock and carries a `phoneWall` block with the skew, derived
from the anchor's own two conversions of the same onset, so the comparison cannot be made silently
again; a run without an anchor reports `null` rather than a guess. Still open and load-bearing: the
census assumes a constant 16.667 ms frame, and the route lives at 16.6667 and 17.00 ms but dies at
16.60, 16.64, 16.70, 16.80 and 17.065. `night6-c2-01` was run `--no-trace`, so the phone's real frame
deltas do not exist for it. The next physical test is that binding re-run with `--frame-trace`.
Evidence: [night6-model-gap-two-clocks-20260917](../docs/evidence/night6-model-gap-two-clocks-20260917.json).

**2026-09-17: all ten Custom Night presets, 3000/3000, and the 50 ms floor that found.** Night 7
in this repository had only ever meant canonical 10/20; the other nine menu presets are different
AI vectors on the same night-7 rules and had never been asked. `night7-presets.mjs` asks them, at
the golden standard, in two lanes -- exact delivery, and the same presses through `actuator.mjs` --
with the presets read from the calibrated menu model the phone's dial driver sets rather than
retyped. **All ten clear 3000/3000 in all four lanes (exact, exact worst, device, device worst):
120,000 simulated nights, no loss**, at a band wider than the phone's own worst measured spread.

The ten green rows are not the finding. Getting them required moving one knob, and the reason is
the mistake register's item 7 in a new place. `KNOBS0.hallOffsetMs` = 9500 puts the Foxy-reset hall
pulse 300 ms after the mask-OFF press; `MASK_ANIM_OFF` is 250 ms and `lit?` needs `mask` = 0 (g75),
so **the pulse cleared the animation it depends on by 50 ms** -- narrower than the phone's own
per-cycle displacement, fitted at **44.6 ms span on k3 full-04 and 81.5 ms on full-06** from the
retained frame traces. When the gap closes there is no light, Foxy is never reset, and he takes the
night: at a 0-100 ms band the shipped offset is 107/200 on 10/20 and *every* loss is `foxy`, while
the exact lane stays 200/200 -- which is exactly why no existing gate saw it. `hallMs` was swept
33..200 ms first and scored **identically at every value**, the item-10 signature: the pulse's
length is not the mechanism, its placement is. 9613 is the centre of the plateau measured across
offset x epoch, `[9542, 9683]`, clearing each edge by ~70 ms. The lower edge has a mechanism and
the arithmetic agrees with it (9200 + 250 + 82 = 9532 against a measured 9542); **the upper edge
does not**, and is recorded as a measured edge rather than dressed in an inequality that would pass
at 9700, which the +11f epoch column measures as a loss.

One more thing the epoch scan settles. Across 12 epochs x 10 presets at 300 seeds, **wins equals
armed in every single cell, and the armed counts are identical across all ten presets** (300, 274,
232, 166, 137, 122, 125, 168, 223, 277, 300, 300). The split arm depends on the schedule and the
epoch, not on the AI dials, so under the measured band the only thing that costs any preset a night
at any epoch is a missed arm -- the branch the emitted plan already closes on the phone with
`#arm-verify`. There is no preset-specific device failure left to find in the model.

Scope, stated plainly: **this is MODEL_ONLY and no phone was run for it** (Pedro's instruction for
the session). It does not touch the model gap measured earlier today on a Night 6 the phone won.
The physical test it implies is one graded Night 7 run on a preset other than 10/20 at
`hallOffsetMs` 9613. Evidence:
[night7-preset-sweep-20260917](../docs/evidence/night7-preset-sweep-20260917.json).

**2026-09-18: Night 5 reached 6 AM again, from a bundle re-emitted against the current engine.**
`night5-n5-carry-aim172-20260918T012153Z` won Night 5 on the phone: 42 of 42 gates AGREED, 0
corrected, `state=sixam` observed. The 2026-09-12 `night5-contact-final` bundle is now refused at
preflight for a stale engine source hash, so its winner was re-emitted; `night-5.plan` and
`profile.json` are byte-identical and the manifests' replay, gate, plans, policy and nights sections
match (replay `fnv1a-afa3aafd`). The binding hash moved from `fnv1a-81b5e51c` to `fnv1a-f430f190`
only because the current emitter writes the default `observeUntilMs`, the same cause that moved
binding h on 2026-09-14. The qualification was carried forward on that equivalence at Pedro's
request, the anchor was passed explicitly at the register's aim of 172 ms, and the release still
came out unanchored (`authorization-late`), as both earlier Night 5 wins did. The winning binding is
tracked as `tools/device/campaign-night5-contact-final-winner.json`. Not yet graded; one night is
not a rate. Evidence: [night5-sixam-carry-20260918](../docs/evidence/night5-sixam-carry-20260918.json).

**2026-09-18: proven twin nights, a writable seed, and the model on the phone's own frame clock.**
Twins by the predeclared rule: `night6-tw-12-20260918T022134Z` and `night6-twin-01-20260917T014037Z`
both bracket their office seed to one millisecond at low16 **24850**. The second was forced by a
device-side clock pin (`tools/device/seedpin/`): when the phone's log shows the office loading, a Java
pinner run through `app_process` holds the wall clock at a value congruent to the target until the
first post-seed line, then restores real time. It is needed because the tap-to-seed delay spreads
over 150 ms across 13 attempts, and 137 ms of that is the office load itself. Its floor is the
platform's: each set is `settimeofday()` plus a hardware RTC write under a lock, ~6.5 ms and
serialised, so the seed lands in a seven-value window and a chosen value about one time in five.
The twins did **not** replay the same night: at about 1 AM Balloon Boy got into the older night's
office (then Foxy), while the pinned night had Mangle. Their input phases differed by 86 ms, the
model at each night's own phase reproduces that split, and with seed and presses fixed the frame
clock alone reshuffles the windows from about cycle 8. Separately, on two frame-traced nights the
model driven by the phone's own frame intervals predicts survival at each night's seed and phase,
closing the frame-clock item left open on 09-17. Also fixed on the way: the timed start's
focus-versus-activation race (`b63ead9`), and loop aborts that never landed (SIGINT to a background
job is ignored). Next: a same-phase twin with both eyeholes read. Evidence:
[night6-twin-nights-proven-20260918](../docs/evidence/night6-twin-nights-proven-20260918.json),
[night6-model-traced-clock-20260918](../docs/evidence/night6-model-traced-clock-20260918.json).

**2026-09-18: the model does not know the encounters, and the gap is not an offset.** On the traced
Night 6 6 AM `night6-tw-04-20260918T014915Z` the phone shows 11 occupied mask windows out of 42; the
model at that night's own seed, frame trace and phase matches 2. Stepping the seed up to 300 draws
either way reaches at best 8 of 11, which is also the best of 1,202 random seeds, so the offset fit
is at chance. The gap is systematic: across every seed the model's nights carry a median 17 occupied
windows and start about two cycles earlier, and the excess is Withered Chica and Withered Freddy
(video frames confirm an empty office where the model has its first encounter). Night 6 outcomes
are right because the route survives every encounter the model throws, not because the model
knows them; on Night 7 the model kills both traced k3 nights, including one the phone won. Next is
rule work on those approaches and entries, not a seed search. Evidence:
[model-encounter-fidelity-20260918](../docs/evidence/model-encounter-fidelity-20260918.json).

**2026-09-18: the predeclared k3 Night 7 cohort -- 8 of 10 nights to 6 AM.** Ten runs of binding k3
(`fnv1a-5c8dcb5f`, Night 7 10/20) under the predeclared protocol, no tuning inside, none excluded or
invalid: 8 wins, each executor `sixam` and video TERMINAL clear (453-456 s of recording), and two
deaths, both Withered Foxy on the first office frame after a mask-off press, 20.0 s and 70.2 s into
the night (r03, r04; read frame by frame, since the recordings stop before a game-over screen). The
anchor landed 0.06-1.05 ms after its 2433 ms aim on every run. This is one ten-run measurement of
one binding; the model predicted no rate for it. The deaths point at the hall flash scheduled
400 ms after mask-off against a 314 ms median press-to-effect plus the mask animation: a later
flash is a new binding and its own cohort. Evidence:
[night7-cohort-k3-result-20260918](../docs/evidence/night7-cohort-k3-result-20260918.json).

**2026-09-18: the in-game overlay teaches the cycle.** The Cue Helper now has a teach panel for
someone watching the bot: a 580x100 window at the left of the office with a ring for the 10 s
cycle (the surface the schedule intends, the flashes and the wind, a hand for now), the step it
is on, why that step is there, the time left, the next step, the hour, and `seen`, which is the
helper's own reading of the bottom controls. `night-run.sh --teach-overlay` uploads the compiled
artifact's semantic actions at the menu and the anchor's release interval after it, so the panel
narrates from the helper's own latched onset with no host clock involved. The words are a fixed
vocabulary in the APK. The panel is drawn only where nothing reads the frame. A Java test drives
every native reader over a recording frame, and a host test checks the night predicate, the
lifecycle boxes, the grader's bands and every control point. The two helper readers that cannot
avoid any rectangle are withheld while the panel may be on screen. On the phone `night7-k3-teach-02`
won with the panel narrating all night: 42/42 gates agreed, the anchor 0.17 ms late, video
TERMINAL clear with the rectangle blanked. The window sat exactly at [10,310][590,410], but at
alpha 0.8, not 1.0: the platform caps untrusted overlays, so a teach video is always graded with
the rectangle blanked. The first attempt ran without a panel because of a lookup bug, now fixed
and pinned by a test; that night won anyway. Evidence:
[teach-panel-night7-20260918](../docs/evidence/teach-panel-night7-20260918.json).

**2026-09-20: Night 6 again, and the 189 ms the mask never had.** Binding h — 42/42 and a 6 AM on
2026-09-13 — died twice tonight, at 213 s and 307 s, and the retained video names both killers.
At 213 s Balloon Boy was in the office and Withered Foxy took the run: `plant-model.js:677` sets
`hallLit = false` while `bb.inside`, so the 9960 hall flash had been a no-op for minutes. That also
answers the open "0 visible hall flashes in 43 intervals" reading — after BB is in, there is nothing
to see, and raising `hallMs` would have been a fix priced against a symptom. At 307 s it was Mangle.
BB (g907/g292/g294) and Mangle (g400/g401) are repelled by the same counter: five continuous
fully-masked one-second ticks. h holds the mask fully on for 9260 - 4249 - 200 = 4811 ms, and five
whole-second boundaries fit in 4811 ms only at a lucky phase — at the delivered aim the fifth tick
cleared the mask-off press by 131 ms of *game-frame* time, because the counter advances on
`frame % 60`. Eight dropped frames in a cycle and the cycle silently delivers four. The floor was
already in the tree for the other strategy: `test-runner-plan.mjs:165` pins the minus7 driver's
`MASK_RESPONSE_HOLD_MS` to `MASK_ANIM_ON/FPS + VENT_MASK_TICKS` = 5200 ms, and minus-toys had never
been measured against it. **h2 is h with `maskOffMs` 9260 -> 9560 and nothing else** — 5111 ms fully
on, five ticks at every phase — and it reached 6 AM on the first attempt (42 cycle gates, anchor
delivered at aim 4870 with `lateMs` 0.418), **unlocking Custom Night**. The 300 ms came out of the
idle gap before the flash, not a wind hold: the variant that bought 200 ms more by shortening
`windMs` 3030 -> 2830 scores 68/3000, which is where Pedro's "more mask means less winding" stops
being available on Night 6. Two gates that were not gates were closed alongside it. `ANCHOR_AIMS` is
keyed on `stableHash(winner)`, which moves when an unrelated KNOBS0 default is added; `observeUntilMs`
gained one, so the committed h winner — byte-identical plan, `fnv1a-c651e2ff` — resolved to no aim for
five days while the migration sat in `UNTRACKED_WINNER_DEBT` prose that nothing read, and every Night 6
attempt since was hand-fed 4870/5000/0 through the environment. Entries now declare `alsoBinds`, and
`test-fact-register.mjs` re-emits the named winner to prove the plan still hashes to the entry's
`replayHash`. And `gate.replayHash` hashes the *model's* event traces, not the plan: h and h2 share
`fnv1a-c651e2ff` despite different plan text, so gates may now declare `planSha256` (optional, because
adding it to a shipped winner would re-hash that winner and orphan its aim exactly as above). Still
open: h2 is one run, not a cohort; the runs are `--machine-only`, so no Plan 12 promotion edge — though
`artifacts/night6-anchored-h/` on this machine holds a DEVICE_MEASURED qualification bound to the
pre-drift hash, which CLAUDE.md records as living on the peer machine. Evidence:
[night6-five-tick-mask-window-20260920](../docs/evidence/night6-five-tick-mask-window-20260920.json),
[night6-anchor-aim-h2-20260920](../docs/evidence/night6-anchor-aim-h2-20260920.json).

**2026-09-20: the second game's results enter custody, and a control map learns where a control
is.** Three FNaF 3 sessions from this morning -- the title-gate negatives, the zero-input Night 1
6 AM with the first control actuation, and the control surface -- had been committed as plan prose
with no evidence file and their frames under gitignored `captures/`, which is the FNaF 2 custody
hole being dug in a second place. They are now derived records
([title gates](../docs/evidence/fnaf3-title-gate-negatives-20260920.json),
[first night](../docs/evidence/fnaf3-first-night-20260920.json),
[control surface](../docs/evidence/fnaf3-control-surface-20260920.json)); the frames stay local,
because the publishing boundary is what makes the derived half committable at all. None is a Plan 12
rung and each says so.

The first record carries a defect that nearly erased the run that found it: the ad-hoc capture loop
force-stopped FNaF 3 **during the post-night minigame**, and FNaF 3 happens to bank the night before
that sequence rather than after it. `tools/device/game-teardown.sh` is the rule where a tool reads
it -- `--after-night` stops a game only once `title-observe.py` has read the title, because that read
is not a proxy for the save but the save itself (Night 1 was graded by exactly it: `LOAD GAME 2`).
There is no settle constant in the file for that reason. The deadline is a bound, not a measurement,
and exceeding it leaves the game **running**: a phone parked on a minigame is recoverable, a
force-stop through a save write is not. Eight mock-ADB checks, whose load-bearing assertions are
negative -- on a timeout, an unfocused game, a missing model and every usage error, no force-stop
reaches the phone.

Then Plan 26 blocker 1, whose schema half is now closed.
`packages/adapters/src/control-anchor.js` gives each `controlMap` entry an anchor kind and, for a
world-anchored control, the pan its coordinate was read at; both actuators resolve through it and
every accepted press now records the view offset it assumed, which is the half that made historical
press coordinates unreadable rather than wrong. An **unstated** anchor resolves at rest and refuses
anywhere else, so the Minus 3 pan hazard becomes a refusal instead of a coordinate nobody measured.
FNaF 1 is the vehicle, as the plan ordered: its map is the first with anchors, its five control roles
are newly registered, and `test-control-anchor.mjs` derives the 2780 px door separation from the map
rather than trusting the 2779 in the plan's prose. Still open, and it is the interesting half:
nothing reads the live pan -- `view-scroll-v1`'s own `panObservation` is `UNKNOWN(not-implemented)`
-- so the offset is stated by a caller, not reported by the phone; and the four pan-dependent FNaF 2
controls stay unmigrated on purpose, because a profile's bytes are hashed into the bundles bound to
it. The test pins those four so migrating them is a deliberate edit.

Touching `packages/core/src/control/` woke a gate that had been red for eleven days.
`tools/policyequivalencetest.mjs` -- the Plan 21 compiler-equivalence regression -- was registered
only in `tools/test.mjs`'s ENGINE group, which CI does not run and whose reds CLAUDE.md excuses as
intentional scientific controls, so two real defects sat behind it. `e8af711` (2026-09-09) renamed
the control vocabulary and left `policy-equivalence.mjs`'s accepted-action set reading `light` and
`ventl`; `3efc923` (2026-09-11) then put a `cameraFeedLight` row in the opening (the first safe Toy
stun) and took the plan from 183 to 185 events without updating this file's count. Both are fixed:
the action set is now DERIVED from `DEVICE_CONTROL_NAMES` instead of hand-copied, and the count is
185 with the commit that moved it named beside it. A third defect fell out of the first -- the
comparator identified a camera by `startsWith('cam')`, so `cameraFeedLight` became the camera
`cam:eraFeedLight`, which is what a prefix match does the moment a vocabulary grows a longer name.
The gate is now in `npm run test:unit` as well, which is mistake register entry 13 for the second
time.

Gates: `typecheck`, `test:unit`, `test:contracts` and `test:affected` green; catalog and docs
regenerate (386 tool scripts carry an entry). No rung moved and no device was touched -- `adb
devices` is empty.

**2026-09-21: FNaF 4 model and held-out census.** Resumed the interrupted OpenCode modeling
session and completed the FNaF 4 host model: the 80-point black flash, idle accelerants, bedroom
and closet chains, Fredbear room/forced-turn paths, and shadow Nights 7–8 are now represented in
`sim-fnaf4.js`, with `community-loop`, `no-audio`, and failing controls in `policy-fnaf4.js`.
The deterministic FNaF 4 check is registered in `npm run test:unit`.

The published `community-loop` is **MODEL_ONLY**: it clears Nights 1–4 in both 3000-seed blocks,
scores 53/3000 and 56/3000 on Night 5, 1309/3000 and 1361/3000 on Night 6, and 0/3000 on Nights
7–8. The held-out block is seeds 3000–5999, selected with the new `census.mjs --start` option.
`do-nothing` now fails every night to the black flash, so the former dead-control gap is closed.

Result record: [`FOUR-GAME-NIGHTS.md`](../docs/research/FOUR-GAME-NIGHTS.md) and
[`FNAF4-AUDIO-INDEPENDENCE.md`](../docs/research/FNAF4-AUDIO-INDEPENDENCE.md). Evidence ID:
**none** — this was a host model run and no device was touched. Open: resolve the model's
`UNKNOWN(walk-cadence)`, `UNKNOWN(listen-pair)` and timing assumptions, find a held-out route for
Nights 5–8, then complete the dry-run/device path before any Plan 12 promotion.

**2026-09-25: FNaF 1 4/20 reached 6 AM on the phone, on the first attempt.** Custom Night 20/20/20/20,
the hardest mode FNaF 1 has: the night ran to its end, the helper's native frames read `5 AM` rolling
to `6 AM`, and the title came back with a third star. Evidence
[`fnaf1-420-first-6am-20260925`](../docs/evidence/fnaf1-420-first-6am-20260925.json); binding
[`fnaf1-custom-night7-420-grid420-winner.json`](../tools/device/fnaf1-custom-night7-420-grid420-winner.json).
One night, not a cohort, and no Plan 12 edge.

What it took, in order. The FNaF 1 census had been scoring policies that write simulator state
(a one-frame light, a free pan across a 2780 px door gap), so `Fnaf1Sim.press` now applies the event
sheet's input rules and `tools/fnaf1-device-lane.mjs` drives it at the handset's costs; the
idealised 3000/3000 is relabelled in `FOUR-GAME-NIGHTS.md`. The route `grid420` is the 2026
community 4/20 line (CAM 4B flicks for Freddy and Foxy, light checks, Chica only via 4B) put on the
three roll grids, with Pedro's play folded in: the reopen is decided by the light through the shut
door. Observation moved off screencap and luma entirely: the Companion gained `REGION` (raw
pixels of registered native rectangles, every frame) and `SNAP` (a native frame for menus), and
a 0/0/0/0 calibration night measured what the route then used -- lights and doors act on
touch-up (166-247 ms), the monitor on touch-down (8-52 ms), the hour is 90 s, the origin is the
first office frame minus ~97 ms, and a still room renders identical frames. A 0/20/20/0
positive-control night then caught one real defect before 4/20 did: a flickering lit frame with
Bonnie in it matched the unlit empty room and read clear; only the lit empty template is `clear`
now. Device lane at the measured timings: 1000/1000 typical, 947/1000 all-maxima worst.

Open: a cohort; re-anchoring the origin on the observed 1 AM; a power reader; whether a shorter
contact is taken by the touch-up rules; the vibration channel (20 game vibrations, each at a light
press -- a candidate occupancy sensor, not yet tested); converting FNaF 2's grid/luma detectors
to native regions; the FNaF 1 teach overlay inside the Companion. Evidence ID:
`fnaf1-420-first-6am-20260925`.

**2026-09-25 (later): three more 4/20 nights, the teach panel in the Companion, and a recording
that kills.** `420-b` reached 6 AM again, narrated all night by the Companion's new FNaF 1 teach
panel (`fnaf1-custom-run.sh --teach`: the step and why, Bonnie/Chica/Foxy's clocks filling toward
their next tick, each door and its last light reading; English, the game's HUD face). The two
nights that also recorded the screen for a demonstration video died -- `420-c` to Chica at 75 s
(full-size screenrecord), `420-d` to Bonnie at ~226 s (1200x540, 2 Mbps) -- and the measurement
that explains both: any screenrecord halves the helper's distinct frames (75 -> 37 of 150 reads),
and the night's capture ran at ~10/s with ~2 s gaps. Under that starvation the door setter
touched a door again when a confirmation was late, undoing the first touch, and a monitor wait
held the finger through a tick. Fixed in the route: a door is touched again only if a frame
rendered 1.2 s after the touch still shows the old state (the panel names the new state the
frame the touch lands, 205-235 ms, measured on cal0); each monitor transition is bounded at 1.8 s;
a frame older than 400 ms answers no read. 4/20 stands at 2 of 4, 2 of 2 without a recording.
The README carries the FNaF 1 GIF (one Bonnie visit, `420-d` at 12 AM) beside FNaF 2's, which
Pedro asked to restore. Open: a Companion-side recorder that encodes the frames the helper
already has, so a video does not cost the night; the evidence pack adapter for FNaF 1 runs.
Evidence ID: `fnaf1-420-first-6am-20260925`.

**2026-09-25: the Plan 12 gate reads committed run packs; nineteen closed probes are archived.**
The gate read only `artifacts/`, which is per machine and gitignored, so a win could be promoted
only where it was played and only while its campaign directory survived. It did not survive for
the k3 cohort: its ten campaign directories and ten videos are no longer on the machine that played
them, while [`night7-cohort-k3-result-20260918`](../docs/evidence/night7-cohort-k3-result-20260918.json)
still cites them, and the vault has never exported anything (`docs/evidence/packs/` is empty).

`npm run evidence -- pack <night-run label | campaign id>` now writes a campaign's text evidence and
`night-run.sh`'s derived facts to `docs/evidence/runs/<run>/`, with the executor's `maskCells` grid
replaced by its hash, machine paths made portable, and every recording and frame listed as withheld
by sha256 only; it refuses anything pixel-shaped it was not told about
([`README`](../docs/evidence/README.md), `tools/evidence-pack.mjs`). `night-run.sh` packs every
campaign it runs. The seven live campaigns of 2026-09-20 still on this machine are packed: two 6 AMs
and five Night 6 deaths, 1.2 MB against ~2.6 GB withheld. On a checkout with no `artifacts/`,
`evidence -- promote` passes both wins on four of five checks and waits only for a person's
`plan12-attestation.json`; the Night 5 win's winner (`fnv1a-9ca64157`, `artifacts/toys-n5`) was never
committed and now is, as `tools/device/campaign-night5-toys-n5-winner.json`.

Separately, nineteen device probes and their eight tests whose questions are closed left the tree
([`ARCHIVED-ROUTES.md`](../docs/ARCHIVED-ROUTES.md), tag `archive/2026-09-24`).

Open: Pedro's attestations for the two packed wins; packing Night 5 `contact-final`, Night 6 `h` and
Night 7 `k2` on the peer machine, and `k3` wherever its campaigns still exist; the FNaF 1 runner,
which does not write campaign directories and so is not packed; the legacy `trial.sh` lane (Plan 22
P9). Evidence IDs: `night5-n5-armblock-20260920T004056Z`, `night6-n6h2-01-20260920T024030Z`.

**2026-09-25 (later): the legacy `trial.sh` lane is archived and every committed winner is held to
rebuilding.** Plan 22 P9. The open-loop shell runner, its driver parts, the mask-camp runners, the shell
preflight, the pilot supervisor, the screencap CAM 11 verifier with its game-crop fixtures, and the
three graders that read only that runner's artifacts left the tree (~9,600 lines;
[`ARCHIVED-ROUTES.md`](../docs/ARCHIVED-ROUTES.md)). `grade-run.sh` now reads what `night-run.sh` retains;
graded before and after on `night6-n6-bbfix-20260920T010859Z`, every live instrument printed the same
lines. `test-winners-rebuild.mjs` (in `test:unit`) compiles all eleven `winner-v1` files and puts each
through the campaign's bundle acceptance -- the chain `night-run.sh` drives, which no CI lane ran
before. It exposed that three winners compile to a normalised hash (`night1-minimal`, `night1-minus7`,
`night6`), which the run packs' `winnerCommitted` check now resolves.

Open: retiring the fixture service path (`DeviceControlService`, `composeDevice`, the runtime
scheduler and supervisor) that `npm run device:dry-run` and CI's dry-run lane exercise -- it plays no
nights, and `device:run` throws -- needs Pedro's decision because CLAUDE.md and `ci.yml` name it.
Evidence ID: `night6-n6-bbfix-20260920T010859Z` (the regrade).

**2026-09-25 (later): the path is written down, and the gates that fought it are loosened or
archived.** Pedro's directive: take every plan and thread, within what is possible, to its last
consequence, and loosen or archive the gates that are superseded, obsolete, or compete with that.
[`ROADMAP.md`](ROADMAP.md) now states the end state (a verified solver for the build-296 night
games) and seven steps, each with the artifact that closes it: S1 custody and the first promotion
edge, S2 encounter-level fidelity (same-phase twin; clean-room recompile), S3 the ceiling from a
census over policies, S4 a controller at that ceiling on the phone, S5 the human route, S6 four games
and the solver interface, S7 the lab running itself. The 2026-09-02 roadmap, superseded by its own
note since 09-17, moved to `archive/`; so did this file's package dashboard and counting rule, which
measured written-plan completion and had not been re-read since 09-04.

Loosened, each recorded in the roadmap's gate table: the consequence lock's "no host-side substitute
work" and its Plan-12-rung-or-trainer definition (a commit is now consequential when it retains a
record that closes or advances a step; the hook's mechanics are unchanged, and a host record still
never stands in for a device claim); the 2026-09-06 standing directive, absorbed as S1 and S4;
Plan 26's custody gate, lifted, since its own work had overtaken it; Plans 27 and 28, restated to
start after S1's first promotion edge; Plan 12's Gates C and D, now entry gates for a new
closed-loop controller rather than prerequisites for promoting a won run, Gate A's human-gate clause,
narrowed to human-route claims, and Gate G, which no longer blocks promoting a won 10/20 night;
Plan 05's 1200-seed admission, superseded by 3000 seeds plus a held-out block. Added, because the
path needs it before any pinned night is promoted: seed provenance (`natural` / `pinned` /
`identified`) as a claim axis in Plan 12 and the charter. The fixture service path the previous entry
left open was retired in `6d78c7e` by a concurrent session.

No step moved and no device was touched. Evidence ID: none. Open: S1 needs Pedro's
`plan12-attestation.json` for the two packed wins and the peer machine's packs of Night 5
`contact-final`, Night 6 `h` and Night 7 `k2`; the next physical test is S2a, the same-phase twin.

**2026-09-25 (late): the distillation's remaining points.** Pedro asked for the project in its
leanest, most capable and legible form, then for every point of that list to be finished. What
landed after the entries above, each in its own commit:

- **Cohorts from packs, FNaF 1 packs, event clocks.** `npm run evidence -- cohort` computes a
  `cohort-result-v2` from the committed packs under the predeclared rule (executor `sixam` and video
  `clear`; a sixam the video never graded is `UNGRADED`, not a win). FNaF 1 runner directories pack
  too, and the first FNaF 1 4/20 6 AM is packed. `core/telemetry/event-clocks.js` declares the clock
  of every timestamp field a campaign writes, and `test-event-clocks.mjs` refuses a packed event
  whose field is undeclared or implausible for its clock (668 events in 7 packs).
- **The device executor, split.** `hid-schedule.js`, `device-shell.js` and `control-effect.js`
  moved out of `adb-device-local-executor.js` verbatim: the compiled schedule, body and script of
  every committed winner night hash the same before and after (24 characterizations). The machine
  compatibility executor, which nothing constructed after the service path left, was removed
  (LEG-004 is now PARTIAL).
- **Tool indexes per directory.** `tools/TOOLS.md` became `tools/README.md`, `tools/device/`,
  `tools/cue/` and `tools/dump/README.md`; `test-docs.mjs` holds each script to the index of its own
  directory. The cue tools had been filed under "source-dump tools".
- **One night entry point.** `npm run night -- fnaf2|fnaf1|fnaf1-custom ...` runs that game's runner
  with its arguments untouched and packs the FNaF 1 runs a night created, however it ends.
- **Stale architecture pages dated, not rewritten**: the 2026-08-26 audit gains an appended status
  (other pages cite it by line), the duplicate map a 2026-09-25 outcome row, and Plan 27 a move map
  for the four-game layout (FNaF 2's cartridge sits behind the `mechanics` and `control` barrels,
  which 77 and 26 files import, so it can move with no consumer edited).

No step moved and no device was touched. Evidence ID: `fnaf1-custom-grid420-420-a-20260925T024452598Z`
(the FNaF 1 pack, `2810edce…`). Session ratio, consequential:bookkeeping, 2:16 -- the packs of the
seven 2026-09-20 campaigns with the Night 5 winner (`87202ed`) and the FNaF 1 6 AM pack (`2e1be2b`)
against the rest. Open, and not an agent's to close: S1's `plan12-attestation.json` for
`night5-n5-armblock` (pack `4c9ea13a…`) and `night6-n6h2-01` (pack `20c626f9…`); where the k3
cohort's media lives; and `npm run evidence -- pack <label>` on the peer machine for Night 5
`contact-final`, Night 6 `h` and Night 7 `k2`. Also open: the artifact executor class itself
(~1100 lines) and `modern-campaign-ports.js` under LEG-004, and Plan 27's moves, which wait for S1's
first promotion edge and a quiet window.

**2026-09-25 (night): custody recovered from the night-run logs.** The entry above left custody
open because the k2/k3 campaign directories and the Night 5/6/7 winners' bundles were "on the peer
machine". They were not: this machine played them. The run directories survive under
`artifacts/runs/`, the campaign directories were deleted, and `night-run.sh` had teed the campaign
CLI's output into each run's `campaign.log`. The CLI printed the retained result with the bytes it
wrote to `result.json` and wrote every event row to stderr as it appended it to `events.jsonl`, the
same code on every date from 2026-09-12 on. So `npm run evidence -- pack` now recovers a gone
campaign from that log. Checked on the nine campaigns that still have both: 9 of 9 `events.jsonl`
and 7 of 7 printed `result.json` come back byte-identical. The two unprinted results are the two
campaigns that threw, whose result the CLI writes but never prints
([custody recovery](../docs/evidence/custody-recovery-20260925.json),
`npm run evidence -- recovery-check`). A recovered pack names its custody and what is lost:
`request.json`, `observations.jsonl`, the observer frames, and a thrown campaign's result
(`RESULT_LOST`).

Packed from this machine: all 39 executor-proven 6 AMs whose evidence survives (Nights 1-7, among
them the first Night 5, Night 6 `h` and Night 7 10/20 wins), all 21 k2/k3 cohort runs, the registered
bindings' runs, and two nights whose video shows 6 AM while the executor did not (`night5-anchor4`
DEATH, `night5-perfetto1` aborted on "lifecycle left night state (static)"). That is 83 packs and
18 MB of text. The cohorts computed from those packs reproduce both hand records' winning slots,
k3 8/10 and k2 3/10
([k3](../docs/evidence/night7-cohort-k3-computed-20260925.json),
[k2](../docs/evidence/night7-cohort-k2-computed-20260925.json)). The non-wins differ: the hand
records call them deaths, but the executor aborted without a terminal and the video saw none, so the
predeclared rule leaves them `UNKNOWN` with the abort reason beside them. The computation also found a
defect of mine: `evidence-cohort.mjs` read a top-level `outcome` that run-timeline.py never writes
(it writes `terminal.outcome`), and its test used only `grade.log`. Fixed, and the test now uses the
real shape. Ten of the eleven winners in `UNTRACKED_WINNER_DEBT` were found under `artifacts/`
with their registered hashes and are committed. So are four winning bindings that had never been
committed, plus the as-run Night 1 Minus 7 winner. The debt is 1 of 1: Night 6 `a`, whose file
was found but no longer rebuilds. 26 winners rebuild, and 38 of the 39 win packs find their winner
committed. The 39th is the Night 7 4/20 Minus 3 win (`night7-n7-420-minimal-m3`). Its winner
(`artifacts/night7-420-minus3/bundle/winner.json`, `fnv1a-15124c58`) stays out because
`test-seam-slack.mjs` refuses it: its hold at +2050 ms clears the after-monitor-raise-wind floor by
0 ms against the 33 ms the gate requires. It won with a press the phone can lose to one frame of
jitter. Committing it means retiring that plan or re-deriving the hold, and that is Pedro's call.

The event-clock gate now reads every campaign pack: 10,331 events in 82 packs. Its selection had
skipped packs without a `result.json`. The 2026-09-12..18 executors wrote eleven timestamp fields
that nobody had declared: the anchor latch, the timed start's taps and plans, and the gate's
`correctedAt`. Each is now declared with the clock its writer used (`night-anchor.js`,
`modern-campaign-ports.js`, `timed-start.js`, the executor's `Date.now()`).

The k3 media question has a measured answer: of 177 run videos recorded by sha256, 15 are on this
machine, all from 2026-09-19/20; no k2 or k3 video exists here by name or by content hash.

Evidence ID: `night7-night7-k3-cohort-r01-20260918T030258Z` (pack `594ac903…`, recovered).
Consequential: the packs and winners. Open, and Pedro's: the attestations, now over any of 39 win
packs, and a Plan 12 decision on whether a pack recovered from its log, which has lost
`request.json`, can be promoted. The recovered wins pass `offlineEvidence`, `terminalPass` and
`winnerCommitted` and fail `manifestComplete` on exactly that file. 81 further non-win
campaigns (79 recoverable from their logs, 2 still on disk) are not packed yet (`npm run evidence -- pack <run>`).

**2026-09-25 (late): FNaF 4 Nights 1-3 reach 6 AM on the phone, by sound and native frames, with a
teach panel.** Pedro moved the goal from FNaF 3 to FNaF 4's hardest mode. The fresh install showed
only NEW GAME / CONTINUE 1: 20/20/20/20 (Extras -> Nightmare) needs `beat7`, the APK has no backup
path, so Nights 1-7 are played first. `tools/device/fnaf4-run.sh` plays them: native REGION views
(`fnaf4-detectors.py`, templates from an open-loop Night 1 calibration), the phone's A2DP mix on the
host (`tools/cue/fnaf4-cues.py`: matched filters, and the breathing loop's level with its phase),
and a Companion panel of its own visual language (a station map, the step, the game's clocks and a
listening meter; FNaF 1's bars and FNaF 2's ring fit tick- and cycle-keyed routes, FNaF 4's is a
walk that reacts to sound). Night 1, 2 and 3 were each won; Night 3 with the panel and a video.
Night 4's best died 0.24 s before 6 AM. Every death named a fix: arrival by near-exact match after
the walk's measured minimum (the dark carpet read as the right door), Foxy's entry read off a
return that does not end at the hub (follow 37, g98/g100), the closet only at follow 0, occupancy
against the empty lit template with a cut at 2 (Pedro saw Foxy at a stage the old cut called
empty), the bed kept due against Freddy's meter, and a clamping pan out of the closet. The level
origin is measurable from breathing phase (0.44-0.55 s before the first room frame). Fredbear and
Nightmare are traced (every side change is a sound; a laugh is the room teleport only on a 30/20 s
clock) and the loop and panel have a Fredbear branch that has not met him yet.

Evidence ID: `fnaf4-nights-1-3-20260925` (`docs/evidence/fnaf4-nights-1-3-20260925.json`); winner
`tools/device/fnaf4-night3-loop-winner.json`. Consequential: the device wins and the runner. Open:
Night 4, then Nights 5-7 (Fredbear, Nightmare), the Plushtrap minigame (two hours off), and Night 8.

**2026-09-25 (later): Night 4 is not won; eleven attempts, each a named mechanic.** Chica and Bonnie
walk up during a listen before they breathe (their steps are in the A2DP mix, and doubt now closes);
a door hold is shut only 733 ms into it, so 4.2 s holds cover a whole 3000 ms tick; the breathing
loop has quiet stretches up to 4.5 s, so a listen now lasts until it has covered a breath at the
game's own loop phase (the level origin), and a quiet verdict without that coverage is doubt; the
bed waits for both doors cleared within (20 - night - 4) s and the closet is kept due. The teach
panel's order, clocks (now on the level origin) and hold text were corrected after Pedro called
them dishonest; its readings still carry no age. Evidence ID: `fnaf4-nights-1-3-20260925` (runs
n4e-n4k added). Open: Night 4, then 5-7 and Night 8; a model device lane for Night 8's phase route.

**2026-09-27: the phone was reinstalled; Night 1 minimal won, the device lane exists, and three
defects the model hid are fixed.** The Play Store reinstalled FNaF 2 at 01:34 (first-install time),
so the save was back at Night 1 and Custom Night locked: the S3 corner nights (predeclared,
`night7-corners-predeclaration-20260927.json`) were refused at the menu, and the story ladder
(`artifacts/forensics/story-ladder-20260927/ladder.sh`, `--machine-only`, bundles re-emitted from
committed winners) climbs again first. Pedro watched the phone and called the first Night 1 route
what it was.

- **Minus 7 on Night 1 was blind and never executed.** `night1-ladder-n1a` graded 96 of 269
  presses MISSING (clear-3's monitor raise 45/45, its mask-off 23/45); the 2026-09-19 Night 1 "win"
  of the same plan graded 54/55 and 48/55 -- it survived an easy night without executing. Two
  causes: the executor sent a read's mask press in the same instant as the vent release
  (`hid-schedule.js` measured `maskGapMs` from the read's start; fixed, `hid-read-gap.test.js`), and
  the simulator toggled the mask mid-animation (g270 needs mask 0, g615 mask 2; fixed,
  `mask-animation-input.test.js`). `3d5c5f7`.
- **Night 1 minimal won** (`night1-ladder-n1e-20260927T055611Z`, 6 AM), the route written for
  Night 1: idle, arm the double-camera split at 115 s, then one CAM 09 flash and a wind per 5 s.
  Its arm missed in observe-once (n1c, played on blind) and three times blocking (n1d); the arm's
  monitor drop came 17 ms after the CAM 09 release on the same HID contact, which the game can read
  as a drag. The monitor toggle is Multiple Touch (any contact), cameras are ObjectClicked (the
  first contact), so a monitor press inside one poll of a release now goes out on contact 1
  (`d9d995f`, `hid-second-contact.test.js`); n1e's blocking arm verified on its second attempt.
  `evidence promote` passes 4 of 5 checks (manifest complete: the original campaign directory);
  the attestation is Pedro's, bound to pack sha256 `3b295af3...617b4`.
- **The ladder, first try per binding:** Night 2 (toys-nights1-2, seed 1855), Night 3 and Night 4
  (toys-nights3-4, seeds 61643 and 63212) each reached 6 AM on the first attempt. Night 5 on
  toys-n5 died twice (n5a Balloon Boy, n5b Mangle -- Pedro's read); Pedro named the cause at once:
  "not making the more masking less winding trade". toys-n5 holds the mask 4551 ms fully on, the
  zero-margin window of 2026-09-20; mask5plus takes 200 ms out of the wind and adds 560 ms of mask
  (5111 ms fully on), and over a one-second phase scan the model wins it at 25 of 30 phases against
  toys-n5's 14. mask5plus reached 6 AM on its first try (n5c, seed 3406) and the title offered the
  6th Night. Every win passes 4 of 5 promote checks; the five attestations are Pedro's.
- **The device lane** (`tools/device/device-lane.mjs`, `d9d995f`, `b1120ef`): the executor's own
  HID schedule decoded back into contacts and played on the simulator through the measured device
  constraints, with one stated hypothesis (a trigger-read press starting within one poll of a
  release on the same contact is lost with probability 1 - gap/poll). It scored Night 1 minimal
  11/20 before the contact change and 40/40 after, and agrees with every 2026-09-19/20 ladder win
  (Nights 2-6, 40/40). Its first form lost every merged press and scored toys-n34 0/40 on Night 4,
  which the phone won: refuted, and narrowed to trigger-read controls.
- **S5: the robustness field** (`night7-robustness-field-20260927`, `d2ceefc`): with the phone's
  mask floor in the actuator, every Night 7 route's worst event is the opening arm's CAM 09 tap (50
  ms late margin); the camdrop->mask seam is [383, 550] ms with the mask at 450; lateness all-win is
  70 ms for the preset (the 2026-09-25 record's 100 had no floor) and 50 for j/k2/k3; independent
  +-J jitter holds to 30 ms at best; the human gate's +-60 leaves the preset 8 of 500. The preset
  re-timed to a deliverable epoch (633 ms) keeps its margins.
- **S2b: the recompile reaches the office** (`c091055`, `9db9aed`): mobile trigger
  emission and frame-scoped scripted navigation now reach the office and retain 18,000 updates
  without gameplay input. The default model first differs in RNG draws at tick 6; declared
  source-option diagnostics differ at initialization. A repeat reproduces all 19,937 updates'
  RNG projection, but raw globals differ in 48 rows. MODEL_ONLY, not trace equivalence:
  `recompile-draw-402926497eae496e` and `recompile-draw-435f7ea2f830ebf2`
  (`tools/recompile/results/`). The patch applies from its pinned external base and 13 parser
  fixtures plus the comparator pass. Extracted content and raw generated code stay external.
- **S1 custody:** 79 more night runs packed (162 campaign packs in the clock gate), two clocks
  declared (`6e170f7`). **S7:** a subagent's `tools/test-mistake-register.mjs` makes register items
  5, 12 and 13 executable (`12bba15`). **Tooling:** `night-run.sh --dry-run` no longer touches the
  phone (`302f79e`; it had put FNaF 2 in front of an app in use).

**2026-09-27 (continued in Codex from the actual Claude session): retained corners and refused
pinned twins.**

- **S1:** Night 6 `h` also reached 6 AM on its first ladder attempt
  (`night6-ladder-n6a-20260927T071107Z`, `207d1ca`), unlocking Custom Night. No agent
  attestation was written. The fresh wins' promotion edge still requires Pedro's exact-pack
  attestation; merit and custody are distinct.
- **S3, DEVICE_MEASURED:** all four predeclared corner slots now have retained packs. The
  generated result `cohort-fnv1a-7e0b375f`
  ([record](../docs/evidence/night7-corners-result-20260927.json)) reads BB+Golden 2/2 wins
  and BB+Foxy 1 win plus 1 UNKNOWN. All counted runs' requested and observed dials agree.
  The failed BB+Foxy run visibly shows Foxy's jumpscare in the retained video, but the
  automated terminal grade is UNKNOWN after the reset; that visual attribution is not
  substituted for the predeclared rule. The record is INCOMPLETE, not a promoted 3/4 cohort.
  The original ERROR envelope is preserved rather than fabricated into a terminal.
- **S2a:** the bounded twin acquisition stopped after five attempts, with no verified twin.
  Runs `night6-tw27-01-20260927T080849Z` through
  `night6-tw27-05-20260927T081406Z` retain native campaign files, frame-trace/media hashes
  and generated `office-seed-bracket-v1` diagnostics. A repeated clock pin made the
  bracket run backwards (the old reader printed negative candidate counts). Even increasing
  pinned endpoints cannot exclude a clock reset between logs. The reader now refuses both
  observed reversals and a declared `--clock-pinned` input as UNKNOWN, with no seed
  candidates. The five interrupted campaigns keep their real requests/observations; only
  their unwritten `result.json` is missing. No terminal or exact seed is inferred.
- **Device safety/instruments:** helper endpoint discovery is bounded on the phone before
  crossing adb, so a large helper log cannot overflow the host's capture buffer. The serial
  lease remains held by the ancestor while nested capture setup borrows it; unrelated
  agents cannot borrow by copying its PID. Repeated interrupts no longer truncate physical
  cleanup. The last attempt's interrupted cleanup was checked afterwards with a native
  projection frame: title items were positively read. Airplane mode, DND and stay-awake
  settings returned to their measured starting values.
- **S3/S6, MODEL_ONLY:** the retained Foxy×Golden plane is 441/441 cells in each of four
  grids over 300 held-out seeds (`night7-dial-plane-foxy-golden-20260927`), a finite
  family-scoped result, not global monotonicity. FNaF 1's committed 4/20 winner now replays
  from its pinned source and rejects live use from a drifted tree. Its separate current-tree
  census covers all 65,536 seeds: typical 65,536/65,536, worst 62,052/65,536, worst held-out
  53,953/56,970, starved 0
  (`fnaf1-420-device-lane-population-20260927`). This is not the pinned winner's census.

Open: S1 human promotion; S2 encounter-level and complete recompile equivalence; the remaining
S3 policy/corner coverage and pinned FNaF 1 winner census; S4 reliability at a justified ceiling.
The pinned seed protocol is refuted as an exact seed measurement, not a completed same-phase twin.

**2026-09-27 (handover checkpoint): source fixes, with the fidelity gap retained.**

- **S2b, MODEL_ONLY:** the earlier 18,000-update office run used flattened child
  events and is retained as a negative, not faithful execution. Correct parent
  gating first exposed a missing title timer (`recompile-draw-bd31edf1fb722abf`,
  TARGET_NOT_REACHED after 4,000 updates). Source-derived one-shot timer dispatch
  then reached 64 office updates through frames 0→1→8→2→7→3. Initialization now
  matches the sourced model (2 draws, state 30314); the first remaining mismatch
  is harness tick 5 / model frame 6 (2 versus 4 draws), an Every first-evaluation
  phase boundary to investigate. `recompile-draw-ffeb7b48d8144073` and
  `recompile-child-325040982abf3323` bind the comparison and diagnosis. Nested
  selection/timer fixtures, parser fixtures, patch replay and diagnosis-reader
  tests pass; none establishes full event/state or device equivalence.
- **S2, MODEL_ONLY:** `model-encounter-fidelity-20260927` retains the encounter
  gap, the default-off reached-event countdown variant, and its 3,000-design-seed
  census (zero held-out). Missing post-death windows are UNKNOWN, not false
  empty-window agreements. Night 7 phone wins still die in the model.
- **Policy baseline, MODEL_ONLY:** `policy-baseline-mask-animation-20260927`
  repairs a mask-off tap inside the source's put-on animation. Night 1 moves
  from 7/25 to 25/25 on identical design seeds, zero held-out; the old schedule
  remains a negative control and the original >=22/25 assertion is unchanged.
  Historical jitter curves do not describe the repaired baseline. No device
  winner changed.
- **S3/S6:** Foxy×Mangle also retains 441/441 cells in each of four grids over
  300 held-out seeds (`night7-dial-plane-foxy-mangle-20260927`). The pinned FNaF 1
  winner census now saves validated 1,024-seed blocks and resumes only against
  matching source/options/ranges. Its full population and the remaining dial
  planes are still in progress; no partial output is a completed census.

Open at this checkpoint: S1 human attestation/custody decisions; S2 valid twin
instrumentation, Every phase diagnosis and full equivalence; unfinished S3/S6
censuses; integrated clean-HEAD `npm run push-gate`. The prior root unit run's
sole failure was the now-repaired policy baseline; that older run is not a
green result for the final integrated tree.

**2026-09-27: a death's static no longer ends the night before its Game Over.**

- **S3/S1, DEVICE_MEASURED timing, no device run:** the executor ended a night on
  three consecutive non-night reads, and the post-jumpscare static counted, so
  `night7-corner-bbfoxy-r01-20260927T072310Z` ended 4477 ms after its first
  static and became UNKNOWN. `static-terminal-window-fb44824c48fdc471`
  ([record](../docs/evidence/static-terminal-window-20260927.json),
  `tools/device/static-terminal-window.mjs`) measures the committed packs: 32
  read Game Over 1964-6306 ms after the first static read; 45 aborted on static
  3119-4835 ms after it (one observer interval is therefore at most 2418 ms; the
  26 directly measured gaps top out at 2294 ms); `night5-perfetto1` read 6 AM
  5763 ms after it, following its abort. After a night, a static read now
  withholds its exit vote for `STATIC_TERMINAL_WAIT_MS` = 6306 + 2418 = 8724 ms
  from the first static of its run. The schedule keeps running, Game Over or 6 AM
  inside the window ends the night normally, and later statics vote as before.
  `apps/device/test/static-terminal-window.test.js` holds the constant to the
  record, and `tools/device/test-static-terminal-window.mjs` reproduces the record
  from its packs.
- The r01 slot's grade does not change: its pack records the static abort and
  the relaunch, and no terminal read. The corner record stays INCOMPLETE. In r01
  a gate also lost the mask read on the static screen 156 ms before the abort.
  Under the new rule, that stop ends the attempt COMPLETED with no terminal (a
  test shows this). The terminal then goes to the campaign's own 120 s wait for
  Game Over or 6 AM. No phone run has exercised the window yet.

Open: a live death under the new window (the first corner or cohort death will
show it). The margin is the mean of two intervals, not a per-read maximum. A
static that outlasts 8724 ms is not in this sample.

## 2026-09-27 — rebuild-matched options against the committed winners (S3, MODEL_ONLY, partial)

`tools/rebuild-options-census.mjs` scores each story-night winner (Nights 1-6),
k3 and the Night 7 preset schedule under `default`, `rebuild`
(`tools/recompile/sourced-rebuild-model-options.json`) and
`rebuild-no-cam-markers`, on design seeds 1..3000 and the first 3000 held-out
seeds, paired seed by seed (exact McNemar; MOVED = p < 0.05 in both blocks).
The options reach Sim's constructor through a scoped setter, and every replay
checks its Sim carries the set. The run was stopped at session end after 4 of
22 distinct replays (about 10 minutes per replay per worker under the shared
machine's load, so about 4 hours for the whole run), so
`rebuild-options-census-20260927` is **PARTIAL**: 7 of 26 subjects scored
(Night 1 minimal and both minus7 bindings, Night 5 contact-final x3 and
hallfix). Each wins all 3000 + 3000 seeds under all three sets: 7 IDENTICAL,
none MOVED, and `footstepCamMarkers` alone changes nothing. The other 19,
including all of Night 6, k3 and the preset, are NOT_RUN with no figures.
Held by `tools/test-rebuild-options-census.mjs` (`test:unit`).

Open: finish the census (`--checkpoint` resumes only with an unchanged
generator, so re-run the 19 from scratch), then read Night 6/7 against the
phone cohorts. No option default changed.

**2026-09-27 (footstep adjudication): CAM 01-04 footsteps are sourced; full-06's audio could not hear them.**

- **S2, MODEL_ONLY** (`footstep-adjudication-04f3089e1a8b9d21`,
  [`footstep-cam-markers-adjudication-20260927.json`](../docs/evidence/footstep-cam-markers-adjudication-20260927.json)).
  `8a7288b` narrowed the footstep cue (g695-g703) to the hall stages because
  full-06's A2DP audio held no sample 25-29. That detector read none of 25-29 in
  the whole run, not even the hall-stage footsteps the narrowed model keeps
  (about 16 audible per night in the model's reconstruction), and it finds 0 of
  60 footsteps injected on the roll phase at the capture's own channel-15 gain
  (1 of 69 between rolls), against 16 of 60 of Mangle's sample 30 at the same
  gain and slots: at that gain the footsteps sit 24-31 dB under the capture's
  median frame level. The negative is not evidence (register item 12); the CCN
  geometry, the sheet, the dex and the rebuild stand. Verdict: `footstepCamMarkers`
  SOURCED; the phone's own reading of 25-29 UNKNOWN.
- Value 2's ten loops do not reconcile them: Withered Chica 8->4 and 4->2 and
  Freddy 7->3 have no move condition and land in their promotion loop (value 2
  >= 6 at the test); Bonnie's hall stage 1 -> CAM 01 is held by the g848-g854
  value-1 pin before promotion. Only g378's mask return lands with value 2 spent
  (18 of 466 Withered CAM hops over 14 bracket seeds of a model reconstruction of
  full-06). The dex adds that the vent bang (sample 17) plays uninterruptible on
  the footsteps' channel 15 and drops any footstep inside its 3.19 s (120 of
  those 466 hops).
- `sourcedFootstepValue2` (default off, `packages/core/test/footstep-value2.test.js`):
  value 2 at promotion, drained by global 5, the cue on the rising edge on a
  marker. With it, seed 24850's no-input Nights 1-5 keep every committed rebuild
  comparison identical (not discriminating there). `footstepCamMarkers` stays
  default off until a comparison adopts it.

Open: a device reading of 25-29 (wired or on-phone capture, with a same-run
positive control); the default marker set; Mangle's g358 and the hall-light edges'
latch in the model; `in office` under `hear footsteps` for bottom-hotspot sprites.

**2026-09-27 (night): the rebuild plays through a Night 7 encounter; the census names the set it scored.**

- **S2b, rebuilt-runtime fidelity, no device run.** Pedro played the rebuild,
  and each report was fixed from the dex or CCN, in
  `tools/recompile/mmfparser-chowdren-mobile.patch`
  ([README](../tools/recompile/README.md), "A playable rebuild" and "The office
  encounter and the jumpscares"):
  - Fusion's integer division (`FusionDiv`) fixes the Custom Night grid.
  - Android's DT_BOTTOM and multi-line alignment fix the menu texts.
  - A `CRunKyso` flipbook writer makes the ten jumpscares draw.
  - The `OnObjectLoop` packed test copies each Custom Night dial to its own
    counter, so mixed dials are valid.
  - RGB565 images are made opaque (`Bitmap.Config.RGB_565`). The blackout
    overlay (image 368, solid black, colour-keyed to nothing) should then darken
    the office. This change is in the patch but not built: its conversion was
    stopped at session end, and that stop left the shared `Assets.dat` empty
    (`play/` needs a reconversion).
  - Checks:
    - Night 1's no-input office rows were identical through the alignment build
      (`e2e7cf5c`), but have not been checked on the Kyso and loop binary
      (`036076d3`).
    - On that binary the harness shows the Foxy, Puppet and Withered Chica
      jumpscares, and a seed-91 encounter whose blackout counters run while the
      office stays lit. Pedro confirmed Bonnie's jumpscare.
  - The vanish-then-kill-on-monitor after an unmasked encounter is the sheet's
    got-you stage (g458-g461, g469), not a defect.
- **Merged:** the four exact-lane dial planes (no frontier), the
  rebuild-options census (partial), the footstep adjudication, and Nights 6-7 on
  the frozen binary.
- **Census pinned.** `rebuild-options-census-20260927` was scored before the
  Nights 6-7 options joined `sourced-rebuild-model-options.json`. It now names
  the file it scored: `sourced-rebuild-model-options-20260927a.json`, byte for
  byte, sha `79681f0f`. `--options` selects the file. A census of the current
  set is a new record.
- **Corpus frames.** `tools/recompile/native-frame.py` scales harness snaps to
  the phone's 2400 x 1080 FULL stretch with bilinear filtering, as a native
  title frame shows, and prints per-rectangle distances to a phone frame. No
  window is needed, so a 1920 x 1080 monitor never limits it.
- **Other games parked.** `tools/recompile/game-config.py` resolves extensions
  by item name, and FNaF 4 parses with it. FNaF 1 and 3 have an undecoded
  sound-bank layout. No conversion was kept for any of the three.

Open:
- Reconvert and build the opaque RGB565 patch. Check the darkened office on
  seed 91 and the Night 1 rows, and redeploy `play/` with a pinned
  `Assets.dat`.
- Replay Nights 2-7 on the current binary. FusionDiv changes divisions such as
  g467's `Random(500) / night`, and only Night 1 has been rechecked.
- The dial fixtures still tap the frozen grid.
- Android's collision masks for RGB565 (native code).
- The native-frame comparison against phone frames of matched states.
- The census of the current set.

**2026-09-27 (afternoon): the opaque build is pinned; the no-input ladder holds; native frames match the phone's glyphs.**

- **S2b, rebuilt-runtime fidelity, MODEL_ONLY, no device run.**
  - The opaque RGB565 change touched only `Assets.dat` (identical sources, 0
    objects compiled).
  - Binary `036076d3` and assets `7163d628` are pinned outside the repository,
    and `play/` reads them.
  - On seed 91's Withered Chica encounter the office now goes dark and flickers
    on the overlay's v1, then fades back with Chica gone.
- **The ladder.** Nights 1-7 were replayed with no input on the pinned pair
  (`tools/recompile/results/*-rebuild-036076d3.json`). Each matches its
  committed record: same alignments, same model, same office length. The
  exception is the Night 7 default preset. Before the loop test it was DIVERGENT
  at tick 61 against its own dials; it now matches them to the model's Foxy kill
  frame (`recompile-draw-38990fb11a7d970f`). That is the first non-uniform Custom
  Night where the rebuild and the model agree. The dial fixtures now have 5 x 2
  grid versions (`night7-dials{0,20}-5x2.input`).
- **Native frames.** `tools/recompile/native-frame.py` scales the rebuild's
  title to 2400 x 1080. Against the phone's MediaProjection title frame, its
  five menu labels overlap at glyph-mask IoU 0.948-0.999, and differ by
  0.9/255 and 1.2/255 on average where the random background agrees
  (`native-frame-title-t{120,200,250}-20260927.json`). The frames stay local;
  the records carry their hashes.

Open:
- Scheduled play in the rebuild against the model (S2b's closing path: a
  winner's taps into the harness; agent running).
- The census on the current option set (agent running).
- The title's background (static, face flicker) against the phone at a
  matched RNG state.
- Android's collision masks for RGB565 (native code).

**2026-09-27 (late night): a winner's schedule replayed into the rebuild and into the model (S2b, MODEL_ONLY).**

- **Tools.** `tools/recompile/schedule-to-input.mjs` turns a committed binding's
  gate schedule into harness rows, from one expansion that also yields the Sim
  queue (refused unless that queue equals `schedule()`). It quantizes to 60 Hz
  on the office frame and uses the profile's control points through the FULL
  stretch. `tools/recompile/compare-schedule-replay.mjs` binds the input to the
  winner and replays the same queue in the model under the rebuild options. It
  records both outcomes, the first draw mismatch and every mismatch run, a
  gate-replay cross-check, and monitor/mask ledgers from `# watch` lines.
  FIXTURE: `test-schedule-replay.mjs`, in `npm run test:unit`. The harness
  needed no new op: holds are `down ... up`.
- **Runs** on the pinned binary `036076d3`, seed 24850. Each night was run twice,
  with equal office draw projections:
  - Night 1 `minimal`: 6 AM in both at 25,201. Equal on 10,199 of the first
    10,200 updates (`recompile-replay-f0625216de3bf868`).
  - Night 5 `contact-final`: the rebuild dies after 23,423 updates, Foxy with
    Balloon Boy inside (local snaps). The model wins. Equal on 615 of the first
    617 (`recompile-replay-7d1bffe0e1ed98b5`).
  - Night 7 `k3`, all ten dials at 20 (dumped before Ready): 6 AM in both.
    Equal on 606 of the first 613 (`recompile-replay-80f41ded17461661`).
  - Every monitor and mask contact takes effect in both, with fixed offsets on
    every cycle: 8/8, 160/160 and 172/172 monitor changes; 156/156 and 168/168
    mask changes.
- **Where they differ.**
  - The split, on all three nights: g366/g368/g419 draw only for a Toy at
    A == 2. The model draws for `pending`, which includes a roll held at A = 1
    by the stun (B > 0) or the Show Stage gate. It also marks the fade C at the
    roll.
  - One-update slips that rejoin: a monitor drop or mask removal lands one
    update later in the rebuild. g614/g618 raise `drop everything` after g262
    in the sheet, and the model performs it in the press's own tick.
  - Night 7 only: g781's Every 1000 runs one update late in the model from tick
    374. Its cause is not established.
- **Records.** `tools/recompile/results/night{1-minimal,5-contact-final,7-k3}-replay-20260927.json`
  ([README](../tools/recompile/README.md), "Winner schedules replayed"). No
  default changed, no phone claim.

Open:
- A default-off sourced option for the A = 1 / A = 2 split and the C write, then
  replay again to the next difference.
- The drop and mask-off timing in the model's press path.
- The per-cycle ledger against a phone recording, which S2b's closing condition
  needs. No k2 or k3 video exists on this machine.
- A harness counter watch, so a record can name the rebuild's attacker itself.

**2026-09-27 (evening): the Toy view draws follow the sheet; the replays hold far longer; S1's custody rule decided.**

- **S2b, MODEL_ONLY, rebuilt-runtime fidelity.** The model now has
  `sourcedPromotedViewDraws` (default off; `promoted-view-draws.test.js`).
  - What it does: g366/g368/g419 draw only for a promoted Toy move
    (value 0 == 2), and the fade counter is written at promotion, not at the
    roll.
  - It joins `sourced-rebuild-model-options.json`. The no-input ladder is
    unchanged.
  - The winner-schedule replays' persistent split moves:
    - Night 1 `minimal`: 10200 -> 25200, the night's last update
      (`recompile-replay-782c69f21dade0c2`).
    - Night 5 `contact-final`: 617 -> 9862
      (`recompile-replay-02bb9f3924f43fad`).
    - Night 7 `k3`: 613 -> 12280 (`recompile-replay-674c7e462267e520`).
  - The earlier mismatches that rejoin are mostly the one-update drop slip (an
    agent is on it). No default changed.
- **Rebuild fixes from Pedro's play.**
  - The font atlas packer wrote one glyph per row past the atlas edge; bold n
    was drawn as a filled square. Fixed in `font.cpp` (binary `22610def`,
    deployed to `play/`).
  - Checked against the phone, no change needed: the monitor chevron always
    points down, and the first camera is CAM 09 on Nights 1-6 and CAM 07 on
    Night 7.
- **S1, decided by Pedro:** recovered packs cannot carry an attestation. The
  two original-directory wins (`n5-armblock`, `n6h2-01`) are the only
  candidates; S1 closes on his attestation of either.
- **S3, decided by Pedro:** the old corner cohort stays INCOMPLETE, and a fresh
  BB 20 + Foxy 20 cohort is predeclared on the current tree (device agent
  running).

Open:
- The Night 5 and Night 7 persistent splits at 9862 and 12280.
- The drop and mask-off slip (agent).
- The harness counter watch and the Night 5 killer (agent).
- The census on the current set (agent; its record pins
  `sourced-rebuild-model-options-20260927b.json`).
- The fresh corner cohort (device agent).
- Pedro's attestation.

**2026-09-27 (night): the drop button's flag order, from the dump (S2b, MODEL_ONLY).**

- **The order.** `drop everything` is performed at g262 (monitor) and g274
  (mask) and cleared at g612. Only after those does the drop button set it:
  g618 (monitor fully up, mask off) and g619 (mask fully on, viewing 0, in
  danger 0). These are events 542_3/543_3 in the touch folder, group 33, which
  g0 activates on Android. The mouse twins g614/g615 (540_3/541_3) sit in
  group 32, which nothing activates; the replay record named them by mistake.
  The drop button covers the whole bottom strip, so a mask-off touch is g619's.
  A drop or mask-off touched on update F therefore lands on F+1.
- **The option.** `sourcedDropFlagOrder` is default-off and requires
  `sourcedDropLightOrder`. g618/g619 read the touch at their sheet position,
  the next tick performs it, and g619 refuses a mask-off in danger.
  `packages/core/test/drop-flag-order.test.js` is in `test:contracts`, with
  "off leaves the default unchanged". `sourced-rebuild-dropflag-model-options.json`
  is the rebuild set plus this option. The main set is unchanged.
- **The ledger offsets, derived from the dump.** The flag order explains drop
  start +1, mask off +1, fully off +1, and one of fully down's +2. Fully up,
  fully on and the rest of fully down (+1 each) have a second cause. The model
  counts an animation down from the tick that starts it, so N spends N - 1
  updates moving, while the sheet's latches g1/g6/g9/g10 fire N updates after
  the show loop. `MASK_ANIM_OFF` = 15 is therefore the constant that agrees;
  the group map's cluster 3 verdict had it the other way round. The animation
  count is not encoded.
- **Replays re-run** over the same retained traces:
  - Every per-drop slip is gone, and so are Night 7's g781 slips (374-554),
    which followed the drop at 286.
  - Night 1: first difference 6953 -> 10200, the split
    (`recompile-replay-89fce522a0465e58`).
  - Night 5: 53 -> 617, the split (`recompile-replay-0d63768eb9663543`).
  - Night 7: 199 -> 600. That is one footstep draw (g695-g703), which the model
    spends on 600 and the rebuild on 601, before the split at 613
    (`recompile-replay-191e76adc14cf1d7`).
  - The ledgers now read drop +0 and mask off/fully off +0, with fully up,
    fully down and fully on +1.
  - The outcomes and the gate-replay agreement are unchanged.
- **Tool.** `model-draw-trace.mjs` refuses a `@fnaf2-1020/core` that resolves
  outside its checkout. A worktree without `npm ci` had loaded the parent's
  model, unchanged, and written a normal-looking record. Replay records now
  carry `modelSourceSha256`.
- **Records.** `tools/recompile/results/night{1-minimal,5-contact-final,7-k3}-dropflag-replay-20260927.json`
  ([README](../tools/recompile/README.md), "The drop button's flag order"). No
  default changed, no phone claim.

Open:
- The A = 1 / A = 2 view-draw split (another session's `sourcedPromotedViewDraws`),
  then replay to the next difference.
- Night 7's footstep draw at 600.
- The animation count, as its own option, if a rule reads it.
- Night 5's tick-0 raise, one update late in the rebuild.
- The Puppet's forcedown: g574 -> g612 -> g624 lands it one update after the
  model's g623 flag.

**2026-09-27 (late night, continued): the rebuild names its own attacker (S2b, MODEL_ONLY).**

- **Harness.** `CHOWDREN_WATCH_COUNTER=name,...` adds a `# counter <frame>
  <tick> <value>...` trace line per update, reading each named Counter's first
  live instance (`-` where the frame has none). `Counter`'s constructor records
  its type id, so the watch reads only real Counters: RTTI is off. Existing
  output formats are unchanged. Pinned binary `e616c431`
  (`pinned/e616c431-7163d628/`) is the lead session's `22610def` (font atlas
  fix) plus the watch. The patch is regenerated in its committed order with
  `base/font.cpp` appended: 57 files, `b95c854f`. It passes `git apply --check`
  on a pristine `9b00bb4` archive, and applied there it reproduces the tree.
- **Tool.** `compare-schedule-replay.mjs` reads the `# counter` lines. It names
  a death by the rebuild's own `being attacked by` value, through the office
  sheet's write table (`ATTACKERS`: g556-574, g722, g731; Balloon Boy never
  writes it). It records the update the value was set on, with the watched
  counters before and at that update. `--baseline RECORD` records whether an
  earlier record of the same replay has the same draw projection. FIXTURE
  coverage is in `test-schedule-replay.mjs` (`npm run test:unit`).
- **Night 5 `contact-final`** (`night5-contact-final-replay-e616c431.json`,
  `recompile-replay-232b3f74c48dc27a`): the rebuild's killer is **Withered
  Foxy**, `being attacked by` = 4 from office update 23400. `viewing`,
  `viewing hall light` and `in danger` were 0 there, which of Foxy's writers
  fits only g571, the 10 s check with the monitor down. The watch does not
  perturb the run. Its draw projection `a3bbb988` equals the 036076d3
  record's (`recompile-replay-7d1bffe0e1ed98b5`) and the repeat's, and the
  alignments, gate replay and both ledgers are unchanged.
- **Also measured.** The rebuild left the office 23 updates after the write.
  An `attack animation:0` watch counted to 22 with global 5 = 1, so the exit
  was an animation-finished group (g589-g595), not g588's 40-count. The model
  kills Foxy at the 10 s check with no delay, so a Foxy terminal loop aligns on
  the write, not the exit.

Open:
- Whether the phone's Foxy attack ends on the animation (about 22 updates) or
  the 40-count. The dump marks g576-g586 NoGood.
- The A = 1 / A = 2 view-draw option, then replay Night 5 again: the model
  never meets this Foxy because the streams split at 617.
- The per-cycle ledger against a phone recording (no k2/k3 video on this
  machine).

**2026-09-27 (evening, later): the replays hold to most of a night.**

- **S2b, MODEL_ONLY, rebuilt-runtime fidelity.**
  - `sourcedDropFlagOrder` (merged from its agent) and a new
    `sourcedHallLatchOrder` join `sourcedPromotedViewDraws` in the rebuild set.
    The latch option clears g488 and re-asserts g489 after the route moves
    g380-g383, as the sheet orders them. Each is default off and tested, and
    the no-input ladder is unchanged.
  - The three winner schedules now match the rebuild update for update much
    further:

    | binding | first mismatch | persistent split | evidence |
    |---|---|---|---|
    | Night 1 `minimal` | 21714 | 25200, its last update | `recompile-replay-98245eaf62371617` |
    | Night 5 `contact-final` | 7200 | 17675 | `recompile-replay-e8ef12a81ecae325` |
    | Night 7 `k3` | 900 | 20791 | `recompile-replay-c70889660e5d8cad` |

  - The rebuild now names Night 5's killer itself: Withered Foxy via g571, from
    the harness's new Counter watch (`recompile-replay-232b3f74c48dc27a`).
    After the split the model plays a different night and wins.
- **The recompile as an APK:** built on this host, 131 MB, for Pedro's phone
  only. It installs once the device agent releases the phone.

Open:
- Night 7's next difference at 900 and Night 5's at 7200.
- Foxy's attack exit (about 22 updates) against the model.
- The census, the corner cohort and the APK install (agents).
- The per-cycle ledger against a phone recording.
- Pedro's attestation.

**2026-09-27 (night): two more sheet orders sourced; Pedro watches k3 play the rebuild.**

- **S2b, MODEL_ONLY.** The rebuild set gains two options:
  - `sourcedFootstepValue2`, adjudicated earlier: the cue on the first loop of
    value 2 > 0 on a marker.
  - `sourcedRollsBeforeMoves`, new (`rolls-before-moves.test.js`): g333-g343
    roll everyone before any promotion or move. The model's in-pass move draw
    (e324) had shifted Mangle's roll at tick 1200.
  - The no-input ladder is unchanged.
  - Replays: Night 1 `minimal` holds to its last update
    (`recompile-replay-4cfda145f25dff96`); Night 5 `contact-final` first
    differs at 7460 (`recompile-replay-40772852939a798d`); Night 7 `k3` at 1800
    (`recompile-replay-4d3f13fef20ac45d`).
- **Watching.** `CHOWDREN_REALTIME=1` (in the patch) paces the harness in real
  time. Pedro watched k3's Night 7 10/20 schedule play in the rebuild.

Open:
- Night 7's difference at 1800 and Night 5's at 7460.
- The census, the corner cohort and the APK install (agents).

**2026-09-27 (evening): the second BB+Foxy corner cohort and a 4/20 Minus 3 replay; after a
Night 7 death the executor pressed through the post-death screens.**

- **S3, DEVICE_MEASURED: Pedro chose option 3.** `cohort-fnv1a-7e0b375f` stays INCOMPLETE
  exactly as it stands. A new BB 20 + Foxy 20 cohort was predeclared on this tree in
  `night7-corner2-bbfoxy-predeclaration-20260927.json`:
  - committed in `03204fe`, parent `c0544c6`;
  - two slots, both run from `03204fe` with no tracked edits;
  - binding k3 `fnv1a-5c8dcb5f`, from a bundle byte-identical to the first cohort's;
  - the first cohort's rules, plus one: a counted night that ends with no executor terminal is
    reported UNKNOWN, and is never re-graded by hand or re-run.

  The result is `cohort-fnv1a-31a733dc`
  ([record](../docs/evidence/night7-corner2-bbfoxy-result-20260927.json)): **INCOMPLETE**, with
  0 wins, 1 death and 1 UNKNOWN. Both dial readbacks match.
  - **r01, `night7-corner2-bbfoxy-r01-20260927T192307Z` (pack `4aa7ef8b…`): DEATH.**
    - Died at Night 7 4 AM, 300.7 s after the night-go.
    - The anchor released 0.22 ms late at 2433.2 ms. The office seed is 44142 (2 candidates).
    - **The static window held on a live death.** The hold opened at the first static read,
      19:28:42.039Z. Static was read again at 19:28:43.692 and 19:28:45.353. Game Over was read
      at 19:28:47.017Z, 4978 ms after the first static and inside the 8724 ms window.
    - The executor took `gameover` and closed the HID. Game Over stayed on screen for about 8 s,
      then the game returned to the title.
  - **r02, `night7-corner2-bbfoxy-r02-20260927T193022Z` (pack `7bb65593…`): UNKNOWN.**
    - The static hold opened at 19:33:13.352Z, 135.1 s after the night-go.
    - The observer's reads around it were 11.8 s and 8.4 s apart (19:33:01.576 night,
      19:33:13.352 static, 19:33:21.745 unknown). The window record assumes at most 2418 ms.
    - The frames show static at 164-168 s and Game Over at 168.5-169 s only. The title follows at
      169.5 s with the cursor on Custom Night, and the dial screen at 170 s.
    - The schedule keeps running inside the hold, and its presses skipped Game Over. k3's mask
      point (600,995) lies on the title's `customNight` (400,985).
    - Every later read was `unknown=no-signature-matched`. The gate aborted (ambiguous-threshold)
      at 19:33:25.416, and the campaign's 120 s deadline restarted the game at 19:35:27.830.
    - The Game Over seen in the frames is not substituted for the rule.
    - At about 223 s the dial screen switched to the 20/20/20/20 preset, about 44 s after the gate
      abort. The executor feeds one gate's segment at a time and no input capture ran, so the
      source of that press is UNKNOWN.
  - `run-timeline.py` graded both recordings `unknown`: it did not recognise r01's 8 s Night 7
    Game Over.
- **Pedro's request, DEVICE_MEASURED:** "play the 20/20/20/20 preset with the targeted minus 3
  variation (promote it)", "the minus 3 variation with dropped unnecessary inputs".
  - The binding is `fnv1a-15124c58` (`night7-420-first-6am-minimal3-20260914.json`). It was
    re-emitted from `artifacts/night7-420-minus3/bundle/winner.json`. The plan is byte-identical
    (`ff39cca5…`) and the replay is `fnv1a-f1b23729`.
  - No anchor is registered for it. It ran observe-once on the 4/20 dials.
  - **p1 (pack `f5ab4037…`): refused before the night** with `cue-helper endpoint: no READY or
    DEGRADED endpoint`; the phone had been in other use. `cue_setup` restored the helper.
  - **p1b, `night7-n7-420-minimal-m3-p1b-20260927T195732Z` (pack `b280d074…`): died at 12 AM.**
    - The readback passed and the arm verified at 9079 ms. The video grade is `death`
      (terminal-static at 100.5 s).
    - Static was read at 19:59:18.488 (the hold opened, 70.8 s after the night-go) and at
      19:59:20.268.
    - About 2 min of the 8-bit death minigame followed. The observer read it as
      `unknown=office-hud-without-night` (once as `state=night`), and neither label votes the
      night out.
    - The executor kept pressing until a `state=title` read at 20:01:32.899Z. Its presses left
      the minigame and opened Unlocks (the in-app store) from the title. Airplane mode showed
      "Network unavailable". Then they went back to the title.
    - The pack stays ERROR/UNKNOWN. There is no 4/20 win, so nothing was promoted. The winner stays
      uncommitted: `test-seam-slack.mjs` still refuses its +2050 ms hold, and Plan 12 promotion
      needs Pedro's attestation.
- **Device-safety defect, on two nights in a row.** After a Night 7 death the executor can keep
  pressing when it does not recognise the post-death screens:
  - a brief Game Over that falls between slow reads (r02);
  - a death minigame read as unknown (p1b).

  Its presses then move through the menus: they skip Game Over, enter Custom Night and open the
  store. In `title-moto-g56-v207.json`, k3's left vent light (350,615) lies on New Game (400,640);
  neither night pressed it. Device work stopped after p1b. No harness code changed.
- **Research APK (the lead session's step; Pedro's recorded exception).**
  - `org.fnaf2rebuild.play` (sha256 `91781261…`) was installed with `adb install -r`: Success, an
    incremental install.
  - `freddy2` (225 B, `99f751d3…`) was copied into its `files/` with run-as.
  - It was not launched.
- The phone was left at the FNaF 2 title (`items=continue,customNight,newGame,sixthNight`, two
  stars). The Cue Helper queue's four PENDING jobs were not run. The 2026-09-20 one reinstalls the
  helper, and `cue_setup` did the corners' menu check directly.

Open:
- The Night 7 post-death fail-safe: stop the schedule at the first static, or at any non-night
  read after the night, instead of pressing through the hold. Recognise the death minigames and
  the Custom Night dial screen after a night. Bound the observer interval the window assumes.
- A third BB+Foxy cohort, after that fail-safe. Both corner cohorts stay INCOMPLETE.
- The FNaF 2 third star: no record in this repository names which Custom Night mode awards it.
- The 4/20 Minus 3 winner: Pedro's choice between a recorded seam-slack exemption and a
  re-derived hold, then its own phone run.

**2026-09-27 (late night): the replay splits, one at a time (S2b, MODEL_ONLY).**

- `sourcedPromotedMoves` (`promoted-moves.test.js`, in the rebuild set): a route move needs value 0 == 2,
  and g344-g358 gate only the promotion. g358 holds Mangle's promotion on the hall latch on every hop; the
  model held only her latch-gated hops. Night 7 k3's first mismatch moves 1800 -> 2044
  (`recompile-replay-8439e5f8d6741573`); Night 1 stays 21714 (`recompile-replay-9676af3da04d2e69`) and
  Night 5 7460 (`recompile-replay-abc975f06323ea4f`).

- `sourcedValue5` (`value5.test.js`, in the rebuild set in place of `frameValue5` 1): global value 5 is g1236's
  Min(4, previous loop's timer delta / 16.666666666511446), a hair above 1 at 60 Hz, so g517's `> 20` passes
  on the 20th loop of an encounter. Night 5 7460 -> 7740 (`recompile-replay-215d53586e6cecef`), Night 7
  2044 -> 2100 (`recompile-replay-1a13eb91f66cea4e`), Night 1 stays 21714
  (`recompile-replay-222cf9f47ef9cf69`). The no-input ladder re-scores unchanged.

- `sourcedOfficeFootsteps` (`office-footsteps.test.js`, in the rebuild set): a passed roll at 122 promotes the unit
  where it stands, and W. Bonnie, Toy Bonnie and Mangle, whose sprites on `in office` overlap `hear footsteps`,
  draw g696/g700/g703 there. Night 7 2100 -> 2324 (`recompile-replay-ad22e514332da620`); Night 1 keeps 21714 but
  loses its persistent split (`recompile-replay-77da9b5228c837fc`); Night 5 stays 7740
  (`recompile-replay-3999b92f7f3e9d55`).

- `sourcedBlackoutClockEnd` (`blackout-clock-end.test.js`, in the rebuild set): g537 resolves an encounter on the
  loop g514's clock reaches 300, the encounter's 300th loop. Night 5 7740 -> 7811
  (`recompile-replay-3eb3e4691cd3ce0f`), Night 7 2324 -> 3562 (`recompile-replay-e9390ac2828cd9ac`), Night 1
  stays 21714 (`recompile-replay-08f5e9dc54e9e100`). The no-input ladder re-scores unchanged.

- `sourcedBDrainOrder` (`b-drain-order.test.js`, in the rebuild set): g344-g360 read value 1 before g361-g371 drain
  it, so a unit promotes on the loop after its B reaches 0; the hall pin (g848-g854) follows the deferred g488/g489.
  Night 1 21714 -> 23400 (`recompile-replay-2a5a12e1b5e6fb94`), Night 5 7811 -> 9301
  (`recompile-replay-87c2801dcefa85ef`), Night 7 3562 -> 3563 (`recompile-replay-e875497e32c149d6`). The no-input
  ladder re-scores unchanged.

- `sourcedRoutePass` (`route-pass.test.js`, in the rebuild set): after the rolls, every waiting promotion is tested
  (g344-g360) before any unit moves (g374-g435). Night 1 `minimal` now matches the rebuild's draw stream on all
  25,201 office updates (MATCHED_PREFIX, `recompile-replay-90088f0d8d8c0393`); Night 5 stays 9301
  (`recompile-replay-9080e85986eb1920`), Night 7 3563 (`recompile-replay-698e031d9d9abd4c`).

- `sourcedOfficeRolls` (`office-rolls.test.js`, in the rebuild set): a roll at 122 waits for its promotion (Mangle's
  g358 on the latch), Balloon Boy is rolled and drawn (g702) there, and his standing promotion hops him on to CAM 07
  when g292/g294 send him out. Night 5 9301 -> 9338 (`recompile-replay-60fe848d7cda62e1`); Night 1 still matches
  every update (`recompile-replay-c914f2521526998d`); Night 7 stays 3563 (`recompile-replay-6851a5ade5a612a7`).

- `sourcedAnimationCount` (`animation-count.test.js`, in the rebuild set): the raise, the drop and the mask going on
  take 12, 22 and 12 updates, as g1, g6 and g9 count them. Every monitor and mask ledger change now pairs at +0
  (bar Night 5's tick-0 raise). Night 5 9338 -> 11936 (`recompile-replay-02161639fdd24f46`), Night 7 3563 -> 6534
  (`recompile-replay-cd7291a573920040`); Night 1 still every update (`recompile-replay-75637b5727458cd0`).

- `sourcedGatedEvery` (existing, `gated-every.test.js`) joins the rebuild set: g907's mask ticks count only while
  the mask is fully on. Night 5 11936 -> 21300 (`recompile-replay-bb08f40d5ddd8d0a`), Night 7 6534 -> 6600
  (`recompile-replay-860bf7e1c7e8fe74`); Night 1 still every update (`recompile-replay-0d67c9c7749f308b`).

- `sourcedBBMoves` (`bb-moves.test.js`, in the rebuild set): Balloon Boy hops in the route pass (g413-g418, after
  the Paper Pals roll and the other moves), and g611 redraws a cue of 4 after g556-g559. Night 7 6600 -> 20449
  (`recompile-replay-f81579a9b8242381`), Night 5 21300 -> 22241 (`recompile-replay-e5080f57737dfeb7`); Night 1 still
  every update (`recompile-replay-dd514fe28889efe0`).

- `sourcedExposureValue5` (`exposure-value5.test.js`, in the rebuild set): g745 and g779 add value 5, so g846's
  `> 700` and g780's `> 100` pass on the Nth loop. Night 7 `k3` now matches every one of its 25,201 office updates,
  with every monitor and mask ledger change at +0 (MATCHED_PREFIX, `recompile-replay-53fe6fd991029473`); Night 1
  likewise (`recompile-replay-9afa326eef818737`); Night 5 stays 22241 (`recompile-replay-8f538b5f4e59ac8a`).

- `sourcedRouteViewDraws` (`route-view-draws.test.js`, in the rebuild set): g366/g368 run between the promotions and
  the moves, g419 before Toy Freddy's moves, and the moves follow the sheet's order. Night 5 `contact-final` now
  matches to its terminal loop: the model dies to Withered Foxy on office update 23400, the update the rebuild
  writes `being attacked by` = 4 (MATCHED_TO_TERMINAL_LOOP, `recompile-replay-7e8f8aeb1b5c78fb`). Nights 1 and 7
  still match every update (`recompile-replay-afb6a9d36d6a2ba6`, `recompile-replay-1435024cd7ce7fb0`).

Open:
- The three replays are stream matches, not event or state equivalence; one seed, three bindings, host only.
- Night 5's first raise on office tick 0, which the rebuild takes one update late (the only ledger change off +0).
- The rebuild's Foxy attack ends on its animation (23 updates after the write); the model kills on the write.
- Nothing here is checked against the phone; the per-cycle ledger against a k2/k3 recording still needs a video.
- A census under the new rebuild set (the 2026-09-27a/b snapshots score the older sets).
**2026-09-27 (late evening): after a night, the first static stops the presses and the observer keeps reading (S4 device safety, host-side, no phone).**

- **The defect** (previous entry): inside `STATIC_TERMINAL_WAIT_MS` the schedule kept pressing,
  and after two Night 7 deaths it pressed through the post-death screens (r02 into Custom Night,
  p1b into the store).
- **The rule, from the packs** (`tools/device/post-night-static.mjs`,
  [record](../docs/evidence/post-night-static-halt-20260927.json),
  `post-night-static-halt-1f27592aee56cc26`, DEVICE_MEASURED over committed reads):
  - 81 static episodes follow a night in 184 packs. In none was the office read twice in a row
    after the static: 33 end at Game Over, 45 at the old three-static abort and relaunch, 2 at the
    title, 1 at 6 AM.
  - The 6 AM one, `night5-perfetto1`, read it 5763 ms after its static, inside the 8724 ms window.
    Its stream was parked at a gate until 2920 ms after the static, so a halt there withholds one
    release and 571 ms of presses before the old abort stopped them anyway. The counterfactual is
    not measured.
  - In the 27 packs that keep every read (3523 night reads): all 26 post-night static reads lie in
    those episodes. `newspaper` was misread inside a live night 60 times; static never was.
  - p1b's only night read after its static (123.7 s later) came from inside its death minigame.
  - No confirmation read: r02's next read came 8393 ms after its static, after its frames already
    show the Custom Night dial screen.
  - So `POST_NIGHT_STATIC_HALT` halts on the FIRST static read after a night, and the halt is
    latched.
- **The executor** (`apps/device/src/adb-device-local-executor.js`):
  - The halt writes no further schedule, gate, correction or arm line.
  - Shared mode writes the release report, then the owner closes the process
    (`closeSharedHid`, wired to `closeMenuHid` in `modern-campaign-ports.js`); closing is what kills
    the buffered stream. Device-local mode kills the shell.
  - The observer keeps reading until Game Over or 6 AM (COMPLETED with that terminal), a title or
    three exit votes, the window's expiry from that static (the usual static exit, now without
    three post-window votes), or the existing deadlines and stops.
  - Events `lifecycle.actuation-halted`, `lifecycle.actuation-stopped`, `lifecycle.observe-gap`;
    `gapMs`/`boundMs` are declared in `event-clocks.js`.
- **The observer-interval bound is violated in practice.** r02's reads around its static were
  11776 and 8393 ms apart, and 721 of 3795 in-night read gaps exceed 2418 ms (max 4488). After a
  halt every gap over the bound is now evented; the observer is not sped up.
- **Tests.**
  - `apps/device/test/post-night-halt.test.js` (`test:contracts`) holds the executor comment's
    numbers to the record. It shows, on a 19-gate shared night, that nothing but the release is
    written after the halt and the owner closes the HID once, and that the Game Over read after it
    is the terminal. The same night with no static writes every segment and never halts. It also
    covers the shell kill; r02's shape (static exit at the window, gap events only from the halting
    read on); p1b's shape (a night read resumes nothing and does not restart the window); newspaper
    and pre-night statics not halting; and a port release after the halt writing nothing.
  - `tools/device/test-post-night-static.mjs` (`test:unit`) reproduces the record and refuses a
    newer pack in which a night went on after a post-night static.
  - `static-terminal-window.test.js` cases 3-5 now assert the latched halt.
  - With the halt call disabled, `post-night-halt.test.js` goes red.

Open:
- The rule's first phone night: whether the halted observer reads a death's Game Over. r02-like
  reads 8-12 s apart can still miss it; the window then ends as a static exit.
- A death never read as static (a minigame read as unknown from its start) still presses. The
  death minigames and the Custom Night dial screen are not recognised after a night.
- The observer interval itself (721 of 3795 in-night gaps over the bound).
- A third BB+Foxy cohort: the fail-safe it waited on is in the tree, but its phone behaviour is not
  measured yet. Also open: the 4/20 Minus 3 decision and Pedro's attestation.

**2026-09-27 (evening): the rebuild against the phone, window by window (S2b, MODEL_ONLY;
`recompile-phone-encounters-e18a527d01bcdb54`).**

- **What ran.** The four phone nights with a one-candidate office seed: tw-12 and twin-01
  (Night 6, 24850) and k3's full-04 (34043) and full-06 (47593) on Night 7 at 10/20.
  - Each ran in the rebuild at that seed, on its own frame trace's clock.
  - Each press sits on the frame it landed in, 64.7-81.6 ms after its send by the night's own
    monitor raises.
  - The binary is `7ab9a755`, with the new `CHOWDREN_FRAME_TIMES` and `CHOWDREN_WATCH_OVERLAP`
    switches. The patch was regenerated with the lead's uncommitted harness edits.
  - The tool is `phone-encounter-replay.mjs` and the gate is `test-phone-encounter-replay.mjs`
    (test:unit). The record is
    [rebuild vs phone](../docs/evidence/rebuild-phone-encounters-20260927.json).
- **DIVERGENT on all four.**
  - First disagreeing windows: tw-12 9, twin-01 10, full-04 3 (an unlabelled phone occupant;
    the rebuild is dead before window 4), full-06 6.
  - Each occupant was at `in office` about 4 s before mask-on.
  - Each difference survives every press rule and clock tried, and the model shares it.
  - So the gap is upstream of both programs, in the replayed input or the runtime clock; the
    evidence does not separate the two.
- **Held-tap drops.** k3's 200 ms monitor hold against the 12-update raise lets g618 drop the
  cameras it just raised. Every Withered attack in these replays follows one. full-06 reaches
  6 AM, like the phone, under three of five press rules.

Open:
- Per-press landings from the retained traces in place of one median.
- The same-phase twin (S2a).
- The k3 monitor hold's zero margin, for S4.

## 2026-09-27 — Overnight windows: the queue runs on Pedro's phone at night (S7, FIXTURE, no device run)

**Decision (Pedro, 2026-09-27).** The phone stops being the bottleneck through
overnight windows. His own phone runs queued jobs overnight on the charger with
stay-awake on, only inside a scheduled window. It is his personal phone, so
everything a run changes is restored when the window ends.

- **Built:** `tools/device/overnight-window.py`, the host runner
  ([device safety](../docs/operations/DEVICE-SAFETY.md), "Overnight windows").
  - The default window is 01:30-07:00 local, set by `--start`/`--end` or
    `FNAF_WINDOW_START`/`FNAF_WINDOW_END`. It can be armed up to 4 h early.
  - Without `--live --confirm-live` it is a dry run that makes no adb call.
  - A live window takes the serial lease, then restores what a killed window
    left behind.
  - It refuses LEASE_BUSY, OUTSIDE_WINDOW, DEVICE_ABSENT, CAPABILITY, LOCKED,
    IN_USE and POWER, changing nothing. LOCKED is a bounded wait with a queue
    note. IN_USE is a call, or a foreground app other than the launcher, the
    Companion or a target game. POWER is unplugged, under 50 %, or 45 C or more.
  - It records six settings, writes the record to disk, and sets
    stay-awake-while-charging.
  - It runs the queue one job per call, repeating the checks between jobs,
    under a deadline on both clocks.
  - However it ends, it stops the queue child (SIGINT, SIGTERM, SIGKILL), puts
    a stopped job back to PENDING, and leaves the screen as it found it. It then
    restores the four settings whose write is their control path, reads them
    back, and releases the lease.
  - Airplane mode and DND are only witnessed: a raw write desynchronises their
    services, and it would re-enter a DND schedule that ended at 07:00.
  - `preflight` is read-only. `units` renders a systemd `--user` service and
    timer, and installs nothing.
- **Queue:** `run --max-jobs N`, `JOB_TIMEOUT_S`, `note_pending` and
  `release_running`. The vocabulary is unchanged: setup, menu-check and
  night-check.
- **Found by the fixture before the phone could:**
  - A second Ctrl-C to the process group killed the runner's own `adb` read in
    the middle of the restore, leaving a setting UNREACHABLE. Every subprocess
    now runs in its own session.
  - A monotonic-only deadline would not see a host suspend. It is now checked
    on the wall clock too.
- **Gate:** `tools/device/test-overnight-window.py` in `npm run test:unit`, 858
  checks against a fake `adb` that logs every call. It covers the normal end,
  an abort, a job failure through the real queue and setup (the setup borrows
  the window's lease), the hard deadline, the five refusals, preflight,
  recovery, the lease, and the command vocabulary. The label is FIXTURE; it
  makes no device claim.
- **No gate loosened.** The queue's vocabulary is closed as before. Plan 12's
  non-goal is running unattended *beyond* the device and lifecycle safeguards;
  the window adds safeguards and removes none.
- **No device contact.** Another agent held the phone's lease. Nothing was
  enqueued and no timer was installed. No evidence record was generated; the
  gate's pass line is the record.

Open:
- On the phone, once the lease is free, check the reads with `preflight --json`
  before any live window:
  - `mCurrentFocus` tokens, and the HOME resolution (a chooser reads as no
    launcher);
  - `mCallState` in `telephony.registry`, and the `dumpsys battery` fields;
  - the keyguard patterns;
  - the six settings' values.
  Then run one short daytime live window (`--start`/`--end` 15 min apart) over
  a single `menu-check`, and read the restore rows back.
- The queue has no night job, so a window runs only setup and screen checks.
  A night job that names a committed winner's bundle is Pedro's decision.
- `night-run.sh` takes no serial lease.
- The lease directory and the queue file are per checkout. A worktree agent
  does not see the main checkout's lease or queue, which the units run.
- A VoIP call (WhatsApp) is invisible to `telephony.registry`. Only the
  foreground check catches it, and only while its UI is in front.
- A projection-consent dialog left open reads IN_USE (systemui). That ends the
  window, which is the safe side.

## 2026-09-27 — S1: the first Plan 12 promotion edges (47 executor-proven 6 AMs)

**Pedro's decisions (2026-09-27, in session).** Recovered packs: "Accept fully".
Plan 12 attestation: "i give agents full permission, this is bullshit
bureaucracy that is impeding progress". The delegation covers writing Plan 12
attestations only. `PEDRO-OK`, `--no-verify` and `commit -n` stay as they were.
It is recorded in the [ROADMAP gate table](ROADMAP.md), in
[Plan 12](12-end-to-end-evidence-campaign.md), in the
[evidence policy](../docs/evidence/README.md) and in `CLAUDE.md`.

- **Custody.** `packManifestComplete` (`tools/evidence-pack.mjs`) passes a pack
  recovered from its night-run log when four things hold: its result and events
  came back, its `campaign.log` is withheld under the sha256 its custody cites,
  the recovery check it cites is byte-identical, and `lost` is listed. The
  `lost` list is never dropped: it appears in the pack, the attestation, the
  edge, `list` and `show`.
- **Attestation.** `npm run evidence -- attest <pack> --by agent --note ...`
  (`tools/evidence-promotion.mjs`) re-derives the other checks from the pack
  and refuses to write if any fails. The checks:
  - its files against their hashes;
  - a live `DEVICE_MEASURED` result;
  - the executor's 6 AM: the `sixam` terminal and proof hash, a positive
    verification, `validateSaveProof`, the `campaign.terminal.from-executor`
    row, and no packed video grade other than clear;
  - custody;
  - the committed winner;
  - `claimIdentity`: a Custom Night is named by its own menu readback.

  It writes `plan12-attestation-v2`: the author
  (`{kind: 'agent', delegation: 'pedro-2026-09-27', note}` or a person), the
  pack sha256, and every check with the sha256 of its inputs. v1 is still read.
- **Promotion.** For an accepted pack, `promote` records a `PROMOTED_BY` edge
  from the claim to `run.<pack>` in
  [`graph.json`](../docs/evidence/graph.json). The edge names the attestation,
  the author, the date, the custody and what was lost. A refused pack writes
  nothing. `promotions` counts each night and reports stale edges.
  `tools/test-evidence-promotion.mjs` (`test:unit`) covers four cases: an agent
  attestation is accepted; a mismatched digest is refused; an attestation over
  a pack that fails another check is refused; a recovered pack passes custody
  and still shows its loss.
- **Run over all 180 packs** by the CLI, one pack at a time (`attest`, then
  `promote` on each attested pack). The result is
  `plan12-promotions-fnv1a-baa38db1`
  ([record](../docs/evidence/plan12-promotions-20260927.json)):

  | Night | packs | executor wins | attested | promoted | refused, by failing checks |
  |---|---|---|---|---|---|
  | 1 | 5 | 2 | 2 | 2 | 3 lost results (offlineEvidence, terminalPass, manifestComplete) |
  | 2 | 2 | 2 | 2 | 2 | 0 |
  | 3 | 7 | 2 | 2 | 2 | 4 lost results (2 also winnerCommitted), 1 HOLD (terminalPass) |
  | 4 | 2 | 2 | 2 | 2 | 0 |
  | 5 | 35 | 7 | 7 | 7 | 19 lost results (12 also winnerCommitted), 9 deaths (terminalPass; 2 also winnerCommitted) |
  | 6 | 61 | 8 | 8 | 8 | 38 lost or incomplete results (3 also winnerCommitted), 15 deaths (terminalPass; 4 also winnerCommitted) |
  | 7 | 67 | 25 | 24 | 24 | 34 lost results (6 also winnerCommitted), 6 deaths and 1 HOLD (terminalPass; 1 also winnerCommitted), 1 ERROR envelope (offlineEvidence, terminalPass), 1 win (winnerCommitted, claimIdentity) |
  | FNaF 1 | 1 | — | 0 | 0 | 1 (no Plan 12 gate reads FNaF 1 runs) |
  | **total** | **180** | **48** | **47** | **47** | **133** |

  Every refused FNaF 2 pack but that one win also fails `claimIdentity`: it has
  no winning attempt to name.

  Night 7's 24 are 21 at 10/20 (k2 4, k3 17), 1 at BB+Foxy 20 and 2 at
  BB+Golden 20. 36 of the 47 are recovered custody. The one refused win is
  `night7-n7-420-minimal-m3` (4/20 Minus 3). Its winner `fnv1a-15124c58` is not
  committed, because `test-seam-slack.mjs` holds it back for a 0 ms margin, and
  its pack has no dial readback, so `claimIdentity` fails too. The video-only
  6 AMs fail `terminalPass` and were not attested: `night5-anchor4` is an
  executor DEATH and `night5-perfetto1` is RESULT_LOST. Every other refusal is
  a death, a HOLD, an ERROR, a lost result or the FNaF 1 run.

Open:
- S1's second clause. Two committed MODEL_ONLY winners have no pack naming
  their hash, and it is not established that either ran on the phone:
  `campaign-night1-minus7-winner.json` and `campaign-toys-night5-winner.json`.
- `UNTRACKED_WINNER_DEBT` is 1 of 1 (Night 6 `a`).
- No k2 or k3 video exists on this machine.
- A promotion is one clear. Night 7 reliability is S4, and Gate G still
  governs it.
- The ROADMAP rows for Plans 27 and 28 were waiting on "S1's first promotion
  edge", and that trigger is now met. Plan 27 also needs a confirmed quiet
  window.
- Clean-HEAD `npm run push-gate` was not run in this session.

## 2026-09-27 — Night jobs: the overnight window plays committed winners (S7, FIXTURE, no device run)

**Decision (Pedro, 2026-09-27).** Asked whether overnight windows may play full
nights unattended on his phone (a queued job that runs a committed winner's
bundle, with the usual lease, deadlines and abort), he answered "Yes, play
nights".

- **The queue has a `night` kind.**
  - A job is one night of a *committed* `tools/device/*-winner.json`
    (`enqueue night --game fnaf2|fnaf1|fnaf4 --winner W --night N`).
  - `night_jobs.py` validates it and binds it by the winner's sha256 and, for
    FNaF 2, the sha256 of a freshly emitted plan.
  - Its budget is every step's bound plus the night's length (the plan's
    `#observe-until`, or the route winner's `stopAfterMs`). k3's is 2135 s.
  - Only the overnight window claims night jobs (`run --nights`).
    `cue.queue.run` holds them and reports `nights-held=N`.
  - A night interrupted or killed ends FAILED and is never replayed.
- **`tools/device/night-job.py` plays one.** Under the window's lease:
  - it checks custody and emits a bundle into the job's directory, hashed;
  - it refuses on a checkout without the post-night static halt (669447b), or
    if the plan moved since the job was queued;
  - it links audio where the runner reads it;
  - it observes the title (SNAP, `native-frame.mjs`, then `title-observe.py`)
    and refuses unless the title offers the declared night.

  The runner is `night-run.sh --no-grade`, `fnaf1-winner.mjs` or
  `fnaf4-run.sh --mode loop`. It runs in the job's process group, with its
  lease-held marker. After any end or abort, the title is observed again, and
  if need be the game is force-stopped, relaunched and observed.
- **The window.**
  - A job starts only if its own budget fits before the stop instant, and the
    stop instant now also reserves the window's title recovery.
  - After a night killed before it could observe the title, the window
    recovers the title itself.
  - In the morning it packs each night (`evidence pack`) and appends one line
    per window to `artifacts/overnight-windows/summary.log`.
- **Gaps from the last entry, closed.**
  - A live `night-run.sh` now takes the serial lease (or trusts
    `FNAF_LEASE_HELD=1`).
  - The lease files, the queue and the pending restore are host-wide: the main
    checkout's `captures/cue-helper/`, seen from every worktree.
    `fnaf1-winner.mjs` uses the same directory.
- **Found on the way.** `subprocess.run` SIGKILLs its child 0.25 s after a
  KeyboardInterrupt. So an interrupted queue killed the job it was running,
  before any night runner's reset could run. The queue now records the signal
  and waits, and a job past its ceiling gets SIGINT, SIGTERM, then SIGKILL on
  its whole process tree.
- **Gate:** `tools/device/test-night-job.py` in `npm run test:unit`, 73 checks.
  It runs the real queue, window, `night-job.py`, emit of k3, and the FNaF 2
  title model over synthetic native frames. It uses the real lease and pack
  builder, against `testdata/fake_phone.py`. It covers:
  - title mismatch: refused before any runner;
  - abort mid-night, with a runner that does not reset: the game at an
    observed title, the settings restored, the lease released;
  - a SIGKILLed night: recovered by the window;
  - a deadline too close: the job is not started;
  - a played night: packed in the morning.

  `test-night-run-dry.mjs` now also checks the live lease, and
  `test-cue-helper-device-lock.py` checks the host-wide lease directory.
  FIXTURE only; no device claim.
- **Gate loosened,** recorded in the ROADMAP table: the queue's "no
  game-control actions", by the one word `night`, citing Pedro's answer.
- **No device contact.** Other agents are sharing the phone tonight. Nothing
  was enqueued and no timer was installed.

Open:
- **What can run tonight.** Only FNaF 2 Nights 6 and 7 (the 6th Night and
  Custom Night items) and the FNaF 1 Custom Night winner. FNaF 2 Nights 1-5
  refuse until the FNaF 2 title model has a Continue digit reader (the FNaF 1
  model has one). FNaF 4 refuses until a FNaF 4 title model is measured.
- **Check on the phone, when Pedro allows it,** with `preflight` and a single
  night job in a short daytime window:
  - the SNAP-read title on the real phone;
  - the job's force-stop, relaunch and title recovery;
  - `night-run.sh` under the borrowed lease.
- Packing happens both in `night-run.sh` and in the morning. The morning packs
  only a run that has none yet.

## 2026-09-27 — Fredbear hearing: retain the second Night 5 attempt and stereo replay (S6)

- **DEVICE_MEASURED:** the retained run `fnaf4-loop-n5d-teach-20260928T002104916Z`
  heard eight landings live, held five doors without a sampled open lapse, and
  walked home after all four backs that waited for the open door view. It died
  at 79.9 s after the live mono detector missed the right landing at level 51 s
  (0.209 below its 0.23 floor). The contaminated-audio run n5c remains a negative.
- **Host replay over device recordings:** the stereo matcher accepts all nine
  n5d landings, including the missed one. The 0.19 acceptance floor clears the
  retained n5b/n5d silent grid maximum (0.137) and weakest landing (0.239) by
  more than the test's 0.04 margin. Night 5 matches only Fredbear, laughs and
  our own running; it omits breathing and other characters to fit the hop budget.
- Structured result: [fnaf4-night5-n5b-20260927](../docs/evidence/fnaf4-night5-n5b-20260927.json),
  including generated run ID `fnaf4-loop-n5d-teach-20260928T002104916Z`, source
  hashes and derived hearing-model hashes. No media is promoted by the replay.
- Wrap-up checks: `npm ci`, cue detector **19/19**, Fredbear **122/122**, and
  campaign dry-run over the committed k3 binding (**MODEL_ONLY**, replay
  `fnv1a-1c9c6847`) passed. Claude's directly read transcript also reports
  typecheck, unit, contracts, docs, catalog and chronicle exit 0 before takeover.
  The integrated commit still needs its clean-checkout push gate.

Open: a Night 5 win with this stereo branch; a live measurement of its new floor
and detector cost; Fredbear occupancy and closet eject latency; room-period and
walk-flag ambiguities listed in the result. No new device run was made for wrap-up.
## 2026-09-27 — S7 abort cleanup survives repeated interrupts (FIXTURE)

The overnight restore flake was a process-spawn signal race, with a second
independent failure from a signal handler writing the event stream reentrantly.
Cleanup now holds SIGINT, SIGTERM and SIGHUP through process exit; children
inherit that mask before entering their own sessions. The handler records rows
without I/O. Night-job title recovery holds the same signals while it runs.

Setting reads and writes retain their exit codes, retry within a 15 s budget
per setting, and cap each subprocess at the remaining budget. Failed readback
stays unverified after the bound; a signal-killed child is never a setting value.

Generated result: [overnight-window-abort-cleanup-20260927.json](../docs/evidence/overnight-window-abort-cleanup-20260927.json),
`overnight-window-fixture-7bcd984842170cb1`, FIXTURE PASS. The fake phone
injects killed reads/writes, delays restore reads so the second interrupt lands
in cleanup, and receives a repeated process-group SIGINT barrage. All 1066
checks pass, including restoration readback and lease release. The night-job
fixture also passes 73 checks, including post-abort observed title recovery.

Open: restoration and title recovery on the physical phone remain unmeasured.
No live run, queue change or timer installation occurred. This advances S7's
gated abort path and leaves its device acceptance open.

## 2026-09-27 — Companion rework recovered from the Claude worktree (S5/S6)

The Companion 0.2.0 branch removes the ESP32 audio stack and debug HUD,
quarantines the frozen FNaF 2 readers, names the target explicitly, and adds
companion-status-v1 plus the endpoint-file handshake. The bounded playback
capture probe returns derived numbers only; silence remains inconclusive.
The title identity calibration is **FIXTURE**, evidence ID `companion-game-screen-sha256-fbd233a9d57bdc50`
(`docs/evidence/companion-game-screen-20260927.json`): 2,771 retained native
frames, zero cross-game identifications on the development corpus; no held-out
block. This is a host replay of device frames, not phone qualification.

Open: install/qualification of the reworked Companion, audio capture OFF/ON
comparison on the rebuild, setup integration of the game-screen reader, and
replacement of the quarantined FNaF 2 grid/legacy readers by native REGION
rules. Setup currently reports no helper identity for non-FNaF 2 targets.
The clear and Night 7 reliability claims remain unchanged.

## 2026-09-27 — Recover the recompile audio/build work (S2/S6, MODEL_ONLY)

The interrupted Claude work now has generated result records:
`recompile-audio-36820f08affce640` (FNaF 2: 67/67 non-silent host auditions),
`recompile-audio-a3950c66deefc9de` (FNaF 1: 52/53),
`recompile-sound-map-e63c823f9f0a84e7` (three reproduced sound anchors), and
[recompile-game-builds-995dfaa99a76042a](../tools/recompile/results/game-builds-20260927.json).
The build record separates the FNaF 1 and 2 host boots, FNaF 2 APK, FNaF 3
conversion failure, and FNaF 4 host link without a measured boot or APK.
The recovered mobile patch applies to pristine `9b00bb4` and reproduces its
66 named changed files. Mixer records retain source hashes, and their fixture
gate covers missing auditions as UNKNOWN. Typecheck and audio fixture/record
checks passed; the final integrated clean-checkout push gate remains required.

Open: FNaF 3 shader conversion, FNaF 1/3/4 APKs, FNaF 4 boot and sound audition,
the quiet FNaF 1 audition, native Companion capture and a valid background-pause
measurement. These host measurements do not close device fidelity or reliability.

## 2026-09-27 — Observatory first experiment: per-contact responses (S2b)

Pedro's research-frontier assessment is recorded in
[FNAF2-OBSERVATORY](../docs/research/FNAF2-OBSERVATORY.md) and linked from S2.
It was pushed as `d12b49f` after every clean-checkout CI lane passed, before
the experiment began. The contribution beyond FNaF is framed as a candidate
method/benchmark for agents earning causal explanations, not a novelty claim
for active learning, differential testing or autonomous science themselves.

Generated evidence (2026-09-28 UTC):
[full06-per-contact-responses-20260928.json](../docs/evidence/full06-per-contact-responses-20260928.json),
`recompile-phone-encounters-9efc5551ed385de1`, **MODEL_ONLY**. The pinned rebuild
and assets were hash-verified; each of four inputs reproduces the retained
517-action press file. The median control matches the retained input-row,
clock and draw-stream hashes, both encounter strings, and both outcomes.

The shared native-stroke rule identifies individual response brackets for
85/88 monitor presses and 44/85 mask presses. The separate ready-after-send
branch identifies 83/85 mask responses, 39 acquiring a positive prior state
after the send. Unsupported contacts retain the median assumption. Releases
are inferred at the same delay to preserve scheduled contact duration.

**Negative:** all three response variants leave window 6 occupied: Chica in
the rebuild, Bonnie in the model, empty on the phone. Their first observed
rebuild/phone disagreement moves to window 2; the rebuild dies to Toy Bonnie
at 94.3 s while the phone won. Substituting these partial visual response
proxies is insufficient. The fixture/record gate re-derives coverage, the
reproduced control, the focused conclusion, and the compact evidence record
without private frames or a binary, and refuses changed conclusions/coverage.

Open: action-specific response-to-input lag (drop/mask-off sheet-order delay),
release acceptance, unsupported contacts, runtime updates versus captured
frames, independently varied contact brackets, and a same-phase phone twin
with a valid seed measurement. The collective early endpoint is a sensitivity,
not a worst-case robustness proof. S2 stays OPEN; no new phone run or promotion.

## 2026-09-28 — Measure the phone hour grid; test the joint clock correction (S2b)

The retained full-06 frame trace gives five dark hour-transition observations.
Their 70,000 ms grid fits zero at first frame +3836.7 ms, 0.7 ms from the
retained anchor fire. full-04 contributes one transition before death and a
weaker phase check at +3831.4 ms, 48.2 ms before its anchor fire. These are
DEVICE_MEASURED frame observations with arithmetic fits, not evidence that
encounter rolls share the displayed-hour accumulator
([record](../docs/evidence/phone-hour-grid-20260928.json),
`phone-hour-grid-20d3c13b0de8a50f`).

The corrected sweep rebuilt update zero at the first sampled frame after the
fitted phase and delayed each schedule to its measured anchor fire. Its four
predeclared cells per night include control and each single/joint correction.
The joint correction dies after 2/2 compared windows on full-06 and 3/3 on
full-04; the control remains best on both. No cell matches or meets the
improvement threshold. MODEL_ONLY; no recompile confirmation or new phone run
([record](../docs/evidence/phone-clock-zero-sweep-20260928.json),
`recompile-phone-clock-sweep-0e3154b26906334e`; full-04 result
`recompile-phone-clock-sweep-7e97bb2a648418af`).

Next: compare Withered Bonnie's route eligibility and encounter start in the
rebuild against the model around the earlier draw split. The physical same-phase
twin remains open and requires a valid seed plus per-press landing reads. S2
stays OPEN.

## 2026-09-28 — Exhaust the measured full-06 response brackets (S2b)

`recompile-phone-input-bracket-f7147f352c9115f7` checks the full-06 schedule
through the complete 1500 ms read of window 6. The 29 relevant mask/monitor
contacts all have observed visual-response brackets. Only monitor contacts 12
and 16 admit more than one reconstructed update tick, so the complete family
has four combinations. Each preserves phone windows 0–5 and each leaves model
window 6 occupied by Withered Bonnie
([record](../docs/evidence/phone-input-bracket-20260928.json),
[generated result](../tools/recompile/results/phone-input-bracket-full-06-20260928.json)).

The model snapshot places Bonnie at ventL from update 3627, with his office
encounter starting at update 3840, 24 updates before the window at tick 3864.
The response-ready recompile reads Chica there; the phone read is empty. The
model/rebuild stream already splits at update 205 under response-ready inputs
and update 904 under the landed control. This rejects only the measured
visual-response timing family; dispatch lag, releases, decoded-rule fidelity,
and phone route state remain unresolved. The scan varies only mask/monitor
brackets: wind/camera-light contacts retain the baseline mapping, and each
release shifts with its press instead of receiving an independent bound. No
device run or promotion. S2 stays OPEN.

## 2026-09-28 — Do the replayed contacts register when the phone's did, and where does the state first diverge (S2b)

The phone's own frames and audio, read per cycle against the full-06 landed
replay (`s2-input-registration-b09be5c86b35a4a3`,
[record](../docs/evidence/full06-input-registration-20260928.json)). The
hall flash is over 3-5 updates before the replayed hall contact releases in
every flashed cycle; monitor raises land within -2..+1 updates and mask presses
within 0..-1, as the landed rule assumed. The right-eyehole cells confirm
Withered Bonnie in window 3, Withered Chica in window 4 and nobody in 5 and 6.
Aligned on the mask put-on sound (-0.246 s over nine windows), the A2DP capture
has Balloon Boy hopping at 40.0, 45.1 and 50.0 s, entering the left vent camera
at 55.0 s and arriving at the office at 60.38 s; the rebuild's audio trace
(build 66d6e2f6, the retained replay's draws exactly) and the model both hold
him at CAM 10 through the 40.0 and 45.0 s rolls after his 37.5 s leave and
bring him at 70.3 s. The dump's g342 sets his value 0 on every 5 s roll at AI
20 and g413 moves him on value 0 = 2 with no light or mask condition, yet the
rebuild's watch shows value 0 = 0 through both rolls: what held him is UNKNOWN
and is the first host-vs-phone state difference located, 24 s before window 6.
Moving every hall contact 2-5 updates earlier (the phone's flash frames) changes
Mangle's and Balloon Boy's later hops but never empties window 6. No new phone
run, nothing promoted. S2 stays OPEN.

Next: in the rebuild, trace Balloon Boy's alterable values through 37-50 s and
name the group that holds value 0 at 0 after his leave; then test whether an
input inside the measured brackets releases him at 40.0 s and whether Withered
Bonnie's entry moves to window 7 as the phone read. The same-phase twin with
per-press landing reads and a continuous capture remains the physical separator.

## 2026-09-28 — The other three games rebuilt end to end on host and APK (S6 groundwork)

FNaF 1, 3 and 4 now match FNaF 2's build status: convert, host link, harness
boot to title, committed audio record, and a signed arm64 research APK
(`recompile-game-builds-a7144a1e1d5955a2`,
[record](../tools/recompile/results/game-builds-20260927.json)). FNaF 3's
conversion blocker was build-296's `SetEffect` packing the classic ink-effect
code (Short 1 = semi-transparent, 9 = add) where desktop Chowdren expects a
shader file name; the converter patch now routes numeric codes through the
`SetInkEffect` path, confirmed against the runtime's own tables
(`ACT_GOLEVEL` literal params are frame handles resolved by `HCellToNCell` —
the patch already had that right, which is why FNaF 2's navigation worked).
FNaF 4's first no-input boot routed warning -> 15-test, the porter's one-time
teaser that writes `test=1` into the `fn4` INI — the second boot reaches the
title, so the rebuild reproduces the retail first-run behavior. Audio:
FNaF 3 70/70 non-silent (`recompile-audio-504960804b93b30d`), FNaF 4 72/73
(`recompile-audio-44dea5a5aba0ec90`, the floor-miss is the sample named
`SILENCE`). APKs (`org.fnaf{1,3,4}rebuild.play`) are built from the
phone-proven `chowdren-audio2` base with the static OpenSL ES openal; none has
been installed or run on any phone. MODEL_ONLY, rebuilt-runtime throughout.

## 2026-09-29 — Review becomes a package; the promotion edges are a query (S1, S6; migrations M5a, M5b)

ADR 0002's Review context now has a home. The four evidence modules and their
tests moved from `tools/` into `@fnaf2-1020/review` (`861eac9`), unchanged:
`npm run evidence -- promotions`, `list` and `--help` print the same bytes as
before. Two campaign validators moved to `core/contracts` so review imports no
Play or Propose package; `tools/evidence-pack.mjs` stays as a one-line
re-export because every pack records it as its `packer`. The architecture guard
reads each module's syntax tree (LEG-011 resolved) and refuses review imports
of `apps/device`, `packages/adapters` or `packages/research`.

`@fnaf2-1020/kernel` holds the kernel types with a consumer today (`Interval`,
`ClaimLevel`, `SourceLabel`, `Outcome`, `GameRun` with custody, `Annotation`)
and imports nothing. All 184 committed packs lift to `GameRun`s with no throw
and no write: 48 report a 6 AM, 31 a death (character, mechanism, rule and time
UNKNOWN: the executor never reads them), 2 an abort, 1 a timeout and 102 are
UNKNOWN (99 lost or never-written results, 3 thrown campaigns); custody is 24
complete, 154 recovered, 6 UNKNOWN (`incomplete-campaign`).

`npm run review -- query promotions` re-derives the `PROMOTED_BY` edges from
the packs, attestations and winners: 47 of 47 match `graph.json` byte for
byte, all attested by `agent:pedro-2026-09-27`, custody 11 complete and 36
recovered. It derives S1's open items rather than copying them: the two
committed MODEL_ONLY winners no pack names
(`campaign-night1-minus7-winner.json`, `campaign-toys-night5-winner.json`),
and `UNTRACKED_WINNER_DEBT` 1 of 1 (Night 6 `a`, `fnv1a-bc5e044c`, named by
three `night6-anchored` packs). Record:
[`review-promotions-20260929.json`](../docs/evidence/review-promotions-20260929.json)
(`review-promotions-sha256-cbf62f0155a59b83`). A query over committed
evidence: nothing measured, nothing promoted.

Plan 22 is amended (principle 1 "the Source is canonical"; 2, 5 and 8 dropped;
the runtime and the fixture service recorded as retired; `kernel`, `review` and
a future `source` in the layout and the dependency rule), `22-STATUS` rows P3,
P4 and P7 no longer cite removed things, and `research/sandbox/` is deleted, its
one archived probe's notes moved to `docs/ARCHIVED-ROUTES.md`.

Open: S1's two MODEL_ONLY winners and the Night 6 `a` debt stand. Review still
reaches `tools/device/bundle.mjs` (and through it the research seed helpers)
and `tools/device/fact-register.mjs`; those edges close with M9. The review
modules are `.mjs`, outside the JS typecheck lane, because checking them pulls
in untyped `tools/device` modules. `npm run push-gate` was not run.

## 2026-09-29 — FNaF 3 Aggressive Nightmare won in the rebuild by a pilot (S6)

The rebuilt FNaF 3 now reaches 6 AM on its hardest night: Nightmare with
Aggressive (`hyper=1`) and the three easing cheats off. The game writes
`4thstar=1`, its own mark for that win, and the recorded touches replayed with
no controller give the same 30,000-update trace
([record](../tools/recompile/results/fnaf3-aggressive-nightmare-20260929.json),
`recompile-pilot-night-9bba02f11189549a`).

- **Pilot channel.** The harness gained a lockstep channel
  (`CHOWDREN_PILOT_CONNECT`, TCP, since Docker Desktop's VM does not pass a
  FIFO). `tools/recompile/pilot/` drives it and records every applied touch as
  a plain input row. The controller reads the rebuild's objects (an oracle)
  and acts only by in-window touches.
- **Three converter defects fixed.** They made the office unplayable by
  touch: `SubtractGlobalValueInt` compiled to nothing (no panning), the
  single-instance `CompareFixedValue` was inverted (the monitor tab raised
  nothing), and `OnObjectLoop` bodies sharing a loop number were merged (150
  camera hitboxes, one tagged). FNaF 2's generated code is unchanged by all
  three.
- **A sheet rule the core model lacks.** Group 275 advances attack stage 1 on
  any roll above 2 while a screen is up. `sim-fnaf3.js` advances stage 1 only
  on the blackout.
- **Not robust.** The same controller wins 1 of 6 other seeds.

MODEL_ONLY, rebuilt-runtime; no device run, nothing promoted.

**FNaF 4 Night 8 won the same way.** Night 8 is the 20/20/20/20
Nightmare, reached from Extras with eight Nightmare taps, which need
`beat8=0`. The `warden` controller reaches 6 AM at seed 24850 and the game
writes `beat8=1`; the 584 rows replay to an equal trace
([record](../tools/recompile/results/fnaf4-night8-20260929.json),
`recompile-pilot-night-4a296d97011c3ae2`). It wins 5 of 6 other seeds.

Beating Night 8 unlocks the challenges, but the menus then pair them only
with Night 7 (groups 104/105 against 197-200). So Night 8 is the hardest night
the game offers. MODEL_ONLY, rebuilt-runtime; no device run, nothing promoted.

Open:
- the FNaF 3 controller's rate over seeds (1 of 6) and the model's missing
  group 275;
- FNaF 4's Night 7 challenge stars (`s1`-`s6`), which were not attempted;
- neither rebuilt APK has been run on the phone, and neither win is a device
  claim.
