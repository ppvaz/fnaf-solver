# On-device validation (bot over adb)

> Historical record. Nights now run through `packages/play/bin/phone/night-run.sh` and the
> campaign executor (`npm run device:campaign`). The shell procedure below ran
> under `tools/device/legacy-trial.sh`, archived on 2026-09-25 with the fixture
> service path (`docs/ARCHIVED-ROUTES.md`); it is kept as
> characterization, not as a source of new architecture or claim promotion.

Started 2026-08-20 with the Moto g56 5G plugged in over USB. Goal: test the
decoded Android model's load-bearing rules against the real
`com.scottgames.fnaf2` build instead of only the event-sheet reading.
Target build confirmed on device: **v2.0.7** (versionCode 26, updated
2026-08-14) — matches the ledger's "release 7" target.

## Service-owned seam calibration (2026-09-05)

Retired 2026-09-25 with the fixture service path. `npm run device:calibrate
-- --json` exercised the bounded runner through the fixture service, with the explicit
`apps/device/fixtures/seam-calibration.json` protocol and synthetic state.
The CLI opens no phone; `--live` refuses, and physical profiles cannot silently
select this fixture. `--spec FILE` accepts only the versioned, bounded semantic
protocol, not coordinates, shell text or an inferred game phase.

The sequence is: two fresh positive NIGHT/monitor/mask observations → restore
the observed state if needed → one mask-on/mask-off/probe timed block → two
fresh state observations → measured-state restoration → next trial. Probes
and restores use the same completion-aware actuator under one service writer
lease. No host screenshot wait is inserted inside the mask-off→probe seam.
A restore that does not change the observed state stops the campaign; it does
not cause a blind repeated toggle. UNKNOWN states consume a bounded read/time
budget. Late I/O, stale/repeated frames, terminal states, excessive uncertainty,
unknown completion and overlapping writes cannot authorize a dependent trial.
Emergency abort cancels the pending operation; failed cleanup quarantines that
service composition. A transport must honor cancellation and release contacts.

The service retains spec/profile hashes, capture and receipt timestamps,
mapped uncertainty intervals, requested blocks, completion acknowledgements,
restoration observations and a generated evidence ID. `calibration.execute`
is the MCP counterpart and requires a lease, matching profile hash and an
idempotency key. Both clients use the same runner. Completion remains
`calibration: UNVERIFIED` and `gameAcceptance: UNKNOWN`, including when the
fixture workflow is PASS. This is not a no-input-loss measurement.

Capture timebases have a session identity; equal `*-monotonic-ms` labels are
not enough. A different timebase requires an explicit `clock-map-v1` with
source/target clock and session, evidence ID, anchor pair (`sourceAtMs`,
`targetAtMs`), rate, offset error (`errorMs`), rate error (`rateErrorPpm`) and a
valid source interval. The complete capture uncertainty interval must lie
inside that interval; error grows with distance from the anchor. A sensor
restart, invalid mapping, future capture or expired bound refuses the run.
`startDelaysMs` deliberately names requested start delays, **not measured game
phase**. Fixture millisecond values are test inputs, not recommended handset
calibrations.

Physical calibration remains OPEN: neither handset profile binds the required
positive `calibration-state` rule, and neither has a qualified `seam-block-v1`
actuator or measured clock mapping. Live qualification must explicitly bind
that protocol and the resolved profile hash; FIFO-write success is insufficient.
The historical watcher stays read-only and its live probe path stays held.
App dispatch IDs and positive game effects still need independent measurement
before injection, dispatch and effective-latency tails can be claimed.
Regression gate: `npm run test:device:calibration` (also in CI's contracts lane).

### Measured clock maps and live-gate scaffolding (2026-09-05, follow-on)

`fitClockMap` (`packages/play/src/phone/clocks.js`) produces `clock-map-v1`
artifacts from bracketed anchor samples by interval arithmetic, not
statistics: every pairwise slope interval must contain the true rate, so the
intersection bounds it and one sample whose bounds are violated refuses the
fit instead of averaging away. The validity window is exactly the measured
span — extrapolation is refused by `mapClockInterval` by construction.
`npm run device:clockmap` is the read-only producer (no game input): it
brackets each device clock read in host-monotonic time and refuses reboots,
short spans, inconsistent anchors, and blown `errorMs`/`rateErrorPpm` budgets.

**The device has two monotonic domains and they are not interchangeable.**
The Companion stamps `snapshotNs` with `System.nanoTime()` (suspend-
excluding), while `/proc/uptime` is boottime (suspend-including); the two
drift apart by the cumulative suspend time. The map's `sourceSession`
carries the measured domain — `<bootId>#monotonic` for `--source helper`
(GET round trips, ns-exact, the capture domain) and `<bootId>#boottime` for
`--source uptime`. A live capture composition must stamp sensor sessions
with the matching convention or the mapping refuses. Retained evidence from
the Moto g56 (boot `711c3232-…`, phone awake throughout):
`docs/evidence/clock-map-20260905-moto-g56.json` (boottime, rate 0.999891,
errorMs 35, 1952ppm over 30.7s) and
`docs/evidence/clock-map-20260905-moto-g56-helper.json` (System.nanoTime,
rate 0.999896, errorMs 24, 1551ppm over 31.3s). These are 30-second,
per-boot measurements: re-measure per live session and never reuse across a
reboot.

Two live-gate contracts are now formal. A `calibration-state-v1` artifact
(`packages/play/src/sensors/fnaf2/calibration-state-rule.js`) binds a fitted
`monitor-rule-v1` plus a fitted `mask-rule-v1` under one sha256 digest;
`composeModernDevice` enforces the digest when the profile binds
`calibrations.calibration-state`, and `measureCalibrationState` resolves
OBSERVED only when BOTH sub-rules read the same frame positively — any
UNKNOWN refuses. Neither handset profile binds it yet: the monitor rule is
measured, the mask rule is not, and until a fitted mask artifact exists the
runner keeps refusing live calibration. A `seam-actuator-qualification-v1`
record (`parseSeamActuatorQualification`, `apps/device/src/seam-calibration.js`)
replaces the live gate's ad-hoc field reads: it demands a QUALIFIED verdict,
the `seam-block-v1` protocol, a resolved `fnv1a` profile hash, and named
completion/cancellation mechanisms with evidence IDs, bound to the actuator's
`seamQualification` beside the transport-level `qualification-v1`. Both are
exercised end-to-end over synthetic live ports by
`packages/play/test/calibration-state-rule.test.ts`
(`live-seam-composition.js` is gate-conformance scaffolding, not a CLI path).
Still OPEN: a fitted mask rule, a physically qualified seam-block transport
(device-local executor with positive completion and cancellation), and the
ID-matched injection/dispatch/effect evidence — the runner's UNVERIFIED
reason is unchanged.

## Validation targets, ranked

1. **Consecutive-tick mask clears** (g292-294): a masked vent visitor should
   need ~5 s of *continuous* mask to be forced out (10%/s early roll), not the
   PC-style sub-second repel. This single rule refuted the whole Minus 3
   family in `packages/propose/bin/minus2test.ts`; if the device disagrees, that family
   reopens.
2. ~~Double-camera glitch absence (one `viewing` counter, atomic per touch).~~
   **Reversed 2026-08-26:** the glitch transfers — `viewing` (counter 55) and
   the `your view` marker (126) are separate fields and the monitor-raise
   restore (g1 → g2) moves only the first, from a `last viewed` that g263
   samples every 200 ms. A retained frame from the cleared Night 1 caught it
   by accident (`ANDROID-SOURCE-STATUS.md` §"the double-camera glitch *does*
   transfer"). The target is now the opposite question: **can it be armed
   deliberately, and how often does the 200 ms window land through this
   phone's actuator?** Nothing here has attempted it.
3. Right-vent-light Toy Bonnie stall (g428).
4. Vent lights not draining the battery (g284).
5. Office-defense fuse by night (`time allowed` 100..45 frames) and the
   300-frame office sequence.

## Harness (tools/device/)

- `coords.sh` — touch calibration for this device (2400x1080 landscape),
  derived from labeled 100-px grid overlays on screenshots. Regenerate the
  grids per device/resolution.
- `trial-maskcamp.sh <name> <seconds> [continue|6th]
  [wind|nowind|nowind-flash]` — one
  scripted mask-camp trial. `wind` mutes the call, fills the box on CAM 11,
  drops, and masks; `nowind` makes a quick monitor flip and masks around 4 s
  into the recording for a longer window over early vent arrivals;
  `nowind-flash` adds one hall flash before the mask to reset W. Foxy while
  preserving continuous mask from that point onward.
  `screenrecord` captures the run (downscaled 1280x576 @3 Mbps).
- `run-batch.sh <n> [night] [prefix] [wind|nowind|nowind-flash]` —
  back-to-back trials plus event detection per capture.
- `screenstate.py` — classifies live screenshots as `night`, `gameover`, or
  `other`. The game-over signature was checked against all three retained
  W. Foxy captures; jumpscare/static frames remain `other`.
- `find-events.ts <mp4>` — frame-diff event locator: prints
  timestamp ranges with sharp visual change (overlays, flips, jumpscares) so
  clears can be timed without scrubbing video.
- `camtrace.py [--expected N] <mp4>` — post-run selected-camera trace from
  the map's lime highlight. It verifies that printed ADB commands became real
  `10 -> 04 -> 07 -> 11` sweeps and can fail a trial when any expected sweep
  is absent.
- `windpct.py [--samples] <mp4>` — post-run CAM 11 pie-gauge meter. It uses
  the presence of the lime winding button to reject other feeds, then measures
  the solid white gauge interior. It does not participate in the timed loop.
- `grade-minus7.py <mp4>` — stable office/mask/camera state report plus visible
  hall-beam pulses. Its hall rule runs before the broad camera/static rule and
  rejects beam-like frames that begin inside an existing camera interval, so
  camera-light flashes do not become false visible-hall intervals. The count
  is explicitly a rendering lower bound: sourced hall-movement darkness can
  hide a logically accepted Foxy flash.
- `trial.sh <name> [cycles]` — the sole current device controller: the
  emitted, model-gated Night 6 HID plan. It requires the runtime left-opening
  model, gates the start, then executes one absolute-time device-side schedule. Independent
  safety guards cancel the exact remote driver immediately if the game loses
  focus or after three consecutive non-night screenshots. The fast screenshot
  path captures raw on-device and transfers only HUD scanlines. Neither guard
  chooses or retimes an action. The runner enables ADB touch/pointer overlays
  and grades the pulled recording by default (`DEBUG_OVERLAYS=0` is now the
  only accepted input setting; `GRADE_RUN=0` is the grading opt-out).
  `POST_CAPTURE_TOUCHES=1` turns only the touch dot on after each raw capture
  and off before the next, so later hall presses remain
  visible in the recording without contaminating the model input.
- `hid-multitouch-smoke.json` — guarded only by the operator, not a shell
  wrapper: a direct `hid FILE` regression fixture that selects 6th Night and
  verifies hold-light-while-switching-camera reports. Read
  [`HID-MULTITOUCH.md`](HID-MULTITOUCH.md) before using it.
- `screencheck.c` plus `build-screencheck.sh` — static device-local raw-frame
  feature/template classifier. `capture-screen-sample.sh`,
  `build-screen-model.py`, `replay-screen-model.py`, and
  `bench-screencheck.sh` cover labeled capture, model calibration, independent
  holdout replay, and real device latency. See `ON-DEVICE-SCREEN-CHECKS.md` for
  the invocation and safety contract.

## Hard-won harness rules

- **UHID readiness and hybrid contact release are separate gates.** On this
  phone InputReader attaches about 5.1 s after kernel registration; reports
  sent earlier vanish. In a two-contact report, an inactive ID 1 record still
  requires `contact_count=2`, or Linux stops after ID 0 and leaves ID 1 stuck.
  The resulting camera inputs become moves rather than fresh taps. The
  diagnosis, correct packets, kernel trace, and verified two-finger camera
  sweep are preserved in [`HID-MULTITOUCH.md`](HID-MULTITOUCH.md).

- **The Fusion runtime polls touch by frame: zero-duration `input tap` is
  dropped roughly half the time.** Every touch must be a duration press —
  `input swipe x y x y 120`. This explained all the "did nothing" ghost runs.
- Concurrent `input swipe` processes are not independent fingers. Holding the
  camera light while launching camera-button swipes corrupted the input stream:
  a three-cycle trial produced two multi-second mask latches and entered the
  cameras only twice. Keep injected gestures non-overlapping.
- **Host-round-trip interactive driving is impossible**: transferring a frame,
  classifying it on the host, and starting a second ADB command exceeds the
  reaction/cadence budget. The stock-device exception is a branch computed
  entirely inside the runner's existing device shell with `screencheck`; its
  measured cost and remaining calibration gates are below. Trials enable
  `show_touches` and `pointer_location` by default for a visible touch dot and
  crosshair; run with `DEBUG_OVERLAYS=0` to disable both.
- **Never tap blind.** The script force-foregrounds the game and checks
  `mCurrentFocus` before any input: one unguarded run landed 150 s of taps
  in the Clock app and opened a real alarm's edit dialog (cancelled,
  nothing changed).
- A completed timed input list is not evidence that the game is still alive.
  The 12-cycle endurance attempt died around 38 s, after which its uncancelled
  inputs reached the title and selected New Game. `Continue` was reset to
  Night 1, although the star and 6th Night unlock remained. The Minus 7 runner
  now records the remote shell PID, kills its input children after three
  consecutive non-night screenshots (or one lost-focus sample), force-stops
  the game on every exit, refuses to overwrite captures, and saves a partial
  `-aborted.mp4` when possible.
- The device owner subsequently authorized 6th Night as the available quick
  testing ground. Mask-camp, batch, and Minus 7 interaction tests therefore
  default to `6th`; set `NIGHT=continue` explicitly to use the campaign cursor.
- The bottom ~40 px belong to Android gesture navigation — keep game taps at
  y <= 1020.
- The light input is view-dependent. `(350,615)` activates the camera light
  while the monitor is up, but activates the **left vent light** in the office;
  it does not flash Foxy. The office hall light is `(1200,540)` on this device,
  well inside the hallway hit region; the initially tested `(1400,330)` sat
  near its upper edge and intermittently placed the pointer without a beam.
  A five-coordinate recording (`hall-coordinate-cal`) visibly distinguished
  the green/blue vent light from the circular hall beam. Keep separate
  `TAP_CAM_LIGHT` and `TAP_HALL` coordinates. The hall actuator also needs a
  real hold: a 60 ms swipe placed the debug pointer correctly but was too short
  to establish a useful visible beam. Later dark windows were initially
  misread as intermittent input lockout. The owned Android event sheet instead
  shows a sourced visual blackout: g875-880 set `hall movement` to 300 frames,
  g202 renders the held hall light dark while it drains, and g489/g745/g855
  still assert Foxy's logical light, reset D, and pin B without consulting that
  counter. The runner therefore waits out the mask-off animation and makes one
  200 ms hall hold. With three 60 ms camera flashes, that is about 76 ms/s
  against the 119 ms/s light budget.
- A locked phone presents `NotificationShade` as the focused window even
  when the game activity is underneath it. The harness wakes the display and
  asks Android to dismiss an unsecured keyguard, but a secure keyguard must
  be unlocked by the device owner; the focus guard aborts before any tap.
- Title menu: the first press shows the `>>` cursor, the press must land on
  the item's hitbox (`Continue` at (400,730); `6th Night` at (400,880));
  hitboxes sit slightly above the painted text.
- The port swallows inputs briefly around the monitor flip; the mask press
  goes in ~0.3 s after the drop press (still inside the 50-frame night-5
  defense fuse).
- Nights start ~15 s after the press (intro + load varies): scripts must not
  time anything from the press itself; the recording's visible events are
  the clock.

## Findings so far

- **W. Foxy behaves as modeled (qualitative #2).** Three closed-loop 6th
  Night mask-camp trials died at 29/31/31 s to the W. Foxy office lunge
  (killer identified from the jumpscare frame) with the mask continuously on
  from ~11 s — the mask does not deter him, his D grows unflashed, and the
  10 s GOT-YOU cadence lands exactly in the predicted window. This also sets
  the protocol's observation ceiling: ~15-20 s of masked window per trial
  unless the hall is flashed (which breaks mask continuity).
- The closed loop works: `screenstate.py` gates every phase (wait-for-night
  before any tap fixed the too-early MUTE press; death detection ends the
  recording within ~6 s), and a 5 s wind hold fills the box to ~95% (pie
  gauge center ≈ (740, 840), radius ≈ 95 at 2400x1080 — a fill-percent
  meter is a planned upgrade).

- **Office-defense fuse behaves as modeled (qualitative).** Trial 4's mask
  landed ~3 s after the monitor drop — far past the sourced 50-frame night-5
  fuse — and the run died ~6 s after the drop, matching fuse expiry plus the
  300-frame office sequence. A timely mask (trial 5, ~0.45 s) survived the
  same phase.
- Mask-camp segments recorded cleanly (trial 5: ~26 s continuously masked,
  box-empty death at ~48 s). No vent visitor entered the masked window yet,
  so target #1 remains unmeasured — it needs more trials (6th Night has the
  higher AIs and more vent traffic).
- Follow-up no-wind trials masked at ~4 s but still produced no vent overlay
  before W. Foxy attacked (earliest lunge began around recording second 18).
  A single pre-mask hall flash moved the observed Foxy onset to ~24-28 s but
  likewise yielded no vent visitor. A long CAM 11 hold intended to force BB's
  cameras-up-only fourth hop is not viable as one blocking ADB press: office
  danger forced the run down around second 25-29 while the press was still in
  progress, so the mask command arrived after death. Do not restore that
  protocol; a later attempt needs short scripted slices or a real survival bot.
- Custom Night is not yet unlocked on this save (Night 5 + 6th Night only);
  the in-app "Unlocks" menu is paid cheats, not night selection. Character
  isolation therefore waits until 6th Night is beaten (a bot playing Minus 7
  on-device is the fun route to that).
- **Minus 7 timing calibration is post-hoc.** Plain taps removed command drift
  but dropped critical transitions. A held-light shortcut caused overlapping-
  touch failures. The first 40 ms asynchronous trial missed a later CAM 10;
  at 60 ms, a late light helper made the next absolute slot catch up only 79 ms
  later and overlap, dropping CAM 04. Direct `/dev/input/event8` injection is
  denied by SELinux despite the shell user's `input` group, and separate
  `motionevent DOWN`/`UP` helpers were slower than one swipe.
- **The default is now a synchronous 60 ms swipe.** On this Moto g56 the helper
  takes about 170 ms, so 190 ms action slots cannot overlap. CAM 10 to CAM 11
  takes 1.14 s instead of the old reliable cadence's 1.38 s. The monitor-down
  animation still gets a dedicated delay before the mask. CAM 10 also waits
  500 ms after monitor-up: shorter gaps were visibly swallowed by the flip and
  left the feed on CAM 11. Shortening either gap trades away input acceptance,
  not camera overhead.
- **The fast default passed a four-cycle 6th Night validation.** The 26.75 s
  `fast-sync60-6th-4c` recording contains all five expected
  `10 -> 04 -> 07 -> 11` sweeps (opening plus four cycles), five camera
  intervals, four momentary mask sequences, and no latched mask. An earlier
  two-cycle run also passed 3/3 sweeps and both mask sequences.
- **The first six-cycle extension exposed a pre-existing hall-coordinate bug.**
  Its first five camera sweeps and box holds were clean, but the supposed hall
  flashes were actually left-vent flashes. W. Foxy attacked at about 28.3 s,
  matching the repeated short-run failure the device owner observed. This was
  an actuator-mapping failure, not evidence against the sweep cadence; the
  runner now sends office flashes to the separately calibrated hall control.
- **The corrected six-cycle default crossed the old failure window.** The
  37.75 s `validated-default-6th-6c` run completed 7/7 selected-camera sweeps
  and all six scheduled monitor/mask cycles, with no Foxy attack or safety
  abort. Five hall beams were visible. The other scheduled holds can have been
  hidden by the sourced 300-frame hall-movement rendering blackout, so beam
  count is a lower bound and cannot diagnose input acceptance or Foxy
  protection. The post-run gauge stayed in a 52-78% band. This is a bounded
  validation, not yet a full-night clear.
- **Winding is now rate-balanced instead of capacity-seeking.** Nights 6-7
  drain 120 box units/s when not winding and add 300/s while held, so net-zero
  over a five-second cycle is `120*5/(300+120) = 1.429 s`. The fast runner uses
  1400 ms, within one 30 Hz Fusion update of that balance point. Offline gauge
  measurements in the final six-cycle validation stayed around 52-78% and
  never reached 100%.
  By contrast, the old 1700 ms holds reached 100% partway through later holds.
- **The hardened runner passed its 6th Night safety validation.** An exact-PID
  test killed a harmless remote process and its host ADB session. Controlled
  game force-stops then established both failure paths: the raw-scanline guard
  cancels on persistent non-night state, while the independent 70-100 ms focus
  poll prevents queued input from reaching another app if the game process
  disappears outright. A normal two-cycle run completed without false abort,
  pulled its capture, graded it, and left the launcher focused after cleanup.
  That same run reconfirmed that `PRESS_MODE=tap` is observably unreliable: the
  command log was complete, but the recording contained only the opening camera
  interval and one later mask. Keep synchronous `fast-swipe` as the default.
- **Shooter25's bot establishes the in-game alternative for reactive work.** A
  Debian-patched CTFAK extraction of the official PC practice executable shows
  a direct-state Clickteam controller, not a vision bot. See
  [`SHOOTER25-PRACTICE-MOD.md`](../in-engine/SHOOTER25-PRACTICE-MOD.md) for the comparison
  and [`SHOOTER25-BOT-STATE-MACHINE.md`](../in-engine/SHOOTER25-BOT-STATE-MACHINE.md) for
  its controller, office-pan, and actuator reconstruction.
- **A minimal stock-device visual path now exists.**
  `packages/screencheck/src/screencheck.c` (archived 2026-09-25) built to a
  12,680-byte static ARM64 helper and reduces raw `screencap` to color features,
  `match`/`clear`, or a compact nearest-template class entirely inside one
  device shell. No frame crosses USB and no APK/root/runtime dependency is
  added. On this Moto in the 2400x1080 landscape game, 30 interleaved samples
  measured **225 ms combined p95** (206 ms capture, 42 ms classification p95).
  With the existing roughly 170 ms duration press, the estimated visual-plus-
  action path is 395 ms, leaving about 305 ms against the shortest 700 ms BB
  window.
- **The projection path measures 59 ms for the same observation (2026-08-24).**
  The Companion holds one consented `MediaProjection` producing a 20x9 virtual
  display and answers a device-local socket with the already-classified pixel,
  so a reader pays neither the full-display compose nor the classification. 60
  samples inside one device shell: p50 48.8 ms, **p95 59.5 ms**, p99 60.8 ms,
  max 66.9 ms; the same loop with the socket call removed costs 22.5 ms at p50,
  so the exchange itself is about 26 ms and the rest is the shell forking `date`
  and `nc`. Reproduce with `packages/play/bin/companion/query-companion.sh latency`.

  The consequences are arithmetic on measured parts, not an end-to-end result.
  The visual-plus-action path becomes 59 + 170 = **229 ms**, leaving about
  **471 ms** against the shortest 700 ms BB window instead of 305 ms. On the
  shipped night-6 cycle, whose four observations cost 900 ms of the 5000 ms
  budget, they would cost 236 ms -- about **664 ms/cycle recovered**, which is
  the same magnitude as the entire three-cut schedule optimisation but obtained
  by changing the sensor rather than by removing checks. A `--sync` monitor
  intent that disagrees falls from 415 ms to about 249 ms.

  Two things this does not buy. The read returns the freshest projected frame
  rather than one captured on demand, so its age is reported and a stale frame
  is `UNKNOWN` rather than an observation; and the classifier threshold on this
  path is **not calibrated** -- the luma separation in
  [`ONE-PIXEL-VISION.md`](ONE-PIXEL-VISION.md) comes from `screencap` frames and
  an offline bilinear simulation, not from Android's own VirtualDisplay scaler.
  It also adds a dependency the screencheck path does not have: a consented
  helper that can die mid-night. BB now has independent holdout and live-branch evidence; Golden
  Freddy still lacks an independent positive holdout. Toy Bonnie vision is
  deliberately excluded from the Minus 7 path because its CAM 04 stall already
  controls it. Full build, model, replay, benchmark, invocation, and
  conservative-branch rules are in
  [`ON-DEVICE-SCREEN-CHECKS.md`](ON-DEVICE-SCREEN-CHECKS.md).

## 2026-08-24: a device run where the stalls did not hold

One `PRESS_MODE=hid-multi` pilot run on 6th Night failed on every axis at once:
Withered Bonnie reached the office, Balloon Boy reached the office, and Foxy
ended it. It is recorded because the failure is informative even though the run
was badly configured -- it carried no BB check, and `hid-multi` had not been
validated for this loop.

**The wind was the one thing that worked.** `windpct.py` on that run's capture
shows the box climbing past 80% by 20 s and sitting at 80-100% for the rest of
it. So the failure was not a starved box, and the first reading of this run --
which blamed the box -- was wrong.

**The run failed exactly as this repository already predicted.**
[`HID-MULTITOUCH.md`](HID-MULTITOUCH.md) records that the HID schedule *with no
BB read or response* survives **0/3000** Night 6 runs, "predominantly through
the BB-to-Foxy failure chain". That is the configuration this run used: the BB
check had been dropped to save budget. Balloon Boy reached the office, took the
lights, and Foxy ended it -- the documented chain, start to finish.

Two intermediate diagnoses were recorded here and both were wrong: a starved
box (its box was at 80-100%) and a short-press actuator failure (`hid-multi` is
smoke-tested for two-finger tap sequences). Neither was needed. The same page
also says CAM 05 is *not* the Night 6 checkpoint -- the device-validated
classifier is the lit left opening, which does not consume flashlight battery --
so the run chose the wrong check as well as removing it.

A *different* run the same evening -- `PRESS_MODE=fast-swipe` with
`BB_CAM05_CAPTURE_EVERY=4` -- did starve, and its trace is the clean measurement
of the overhead cost. Full 1.5 s winds held 52-75% for seven cycles, then
truncated to 0.67 s on a roughly 20-second cadence, exactly the capture period,
after which the baseline fell 52, 42, 29, 25, 18, 14, 10 percent and never
recovered. A 206 ms screencap against a cycle with about 680 ms free starves the
wind, and the loss compounds because a short wind leaves less box for the next
cycle to protect.

Two consequences worth carrying. Adding an observation to this loop is not free
and must be priced before it is scheduled; and the Companion's device-local
read at 59 ms exists precisely so an observation need not cost a screencap. The
helper now also reports the CAM 05 feed region as a block of the same 20x9
frame it already captures, so that path no longer requires one.

## Simulating the pilot (2026-08-20)

`packages/propose/parked/minus7/stock-device-pilot.ts` replays `trial.sh`'s millisecond table in the
sourced engine with no state reads, so schedule changes can be judged without
spending a night on the phone. The shipped blind schedule dies **200/200 to
Foxy**, with Balloon Boy as the cause rather than the recorded killer.

> **Corrected 2026-08-20.** BB has no direct office death. At marker 123, g96
> forces `lit?` to zero every frame and g301/303 stop the vent lights answering.
> He permanently removes every flashlight; Foxy's unreset D then ends the run.
> An 80-cycle phone trial reproduced the chain at ~138 s: BB was visible in the
> office, the scheduled mask flick and hall presses still landed, no beam
> appeared, and W. Foxy attacked. The older “BB walking in kills” wording
> confused cause with death event.

Adding the one observation the phone can actually make — flash the left vent
light with the cams down and classify one screenshot (g289 draws BB at the
opening, g287 draws it empty) — plus a mask hold long enough for g294's five
consecutive masked ticks:

| Schedule | Result |
| --- | --- |
| blind, as shipped | 0/200 — 200 Foxy deaths after BB removes the lights; min box 59%, min power 2460 |
| + vent check | 0/200 — BB/Foxy chain removed, but 87 desynced-raise Golden Freddy deaths and 113 deaths to the seven; min box 0% |
| + vent check + monitor sync | 0/200 — BB/Foxy chain remains removed; remaining deaths are the seven during the response window |
| + Markiplier eviction | 0/200 — worse: 177 Foxy deaths and 200 unnecessary evictions; min power 2252 |

The vent observation is mechanically useful but not a complete strategy. It
removes BB and the Foxy chain; the long response then exposes another failure
mode. The monitor-sync row also depends on an observation that the current
phone runner does not yet make.

### Teaching the pilot Balloon Boy (2026-08-20)

Two input gates were missing from the engine, both about *reachability* rather
than effect, and both flattering the pilot: the mask could go on with the
monitor up (a state the game has no way to reach), and while masked every
other control still answered, when g75/g84 leave a masked player nothing but
taking the mask off. `press()` now drops both, and the human control is
unaffected — `bbtest` never used either, which is the point.

With those in place the vent check's 87 Golden Freddy deaths turned out not to
be a Golden Freddy problem at all. Every one of them landed on the *first*
press of a cycle, the one the table means as "cams down". A sourced forcedown
(g141, executed on the monitor by g262) had already dropped the monitor
underneath the schedule, so that press — a bare toggle — **raised** the cams
instead, into an office where Golden Freddy was waiting, and g777 killed. The
schedule was desynced from the game and had no way to notice.

`--sync` makes the two monitor actions *intents* rather than presses: the
pilot spends one screenshot on the monitor state and presses only if the state
disagrees. The look can be taken early and the decision is a skip, not a timed
reaction. `screencheck` makes its cost feasible, but no device runner currently
implements or validates this state-sync branch.

The Balloon Boy -> Foxy chain is the thing being broken here, and it is worth
stating exactly: BB reaches the office (marker 123), g96 and g301/303 take
every light away, the hall can no longer be flashed, Foxy's D runs past 3 and
he collects. Foxy is the killer; BB is the cause. Over 1000 nights per row:

| Schedule | Foxy deaths | BB reached the office | BB->Foxy chain | Median depth |
| --- | ---: | ---: | ---: | ---: |
| blind, as shipped | 1000/1000 | 1000 | **1000** | 48 s |
| + vent check | 2/1000 | 1 | 0 | 54 s |
| + vent check + `--sync` | **0/1000** | **0** | **0** | 58 s |
| + vent + `--sync`, worst-luck | **0/1000** | **0** | **0** | 48 s |

The chain is gone, under pinned worst-luck RNG as well as normal seeds: Balloon
Boy never reaches the office, so Foxy never collects a run because of him. The
blind schedule's Foxy deaths were never really Foxy's.

`node packages/propose/parked/minus7/stock-device-pilot.ts 200 --vent --sync --assert` guards exactly that
claim and nothing more — it asserts BB never gets in and no Foxy death follows
him, and deliberately does **not** assert survival. It runs in
`tools/test.ts --engine`, normal and `--worst`. The blind schedule fails it
200/200 by construction, which is the check working.

What is left is one mode. Every remaining death is the seven walking in during
the response's 6.4 s cams-down window, where their entry timers run to
completion. Best single night rose 92 s -> 98 s of 420. Real progress, and
nowhere near a win: the response buys Balloon Boy at a price the seven collect.

**The device script is deliberately untouched.** The phone can now classify a
frame within the timing budget, but the exact monitor-state model, holdouts,
and capture-to-skip/press integration have not been validated. A simulator
result is not authority to edit the proven open-loop runner.

**The eviction does not transfer to an open-loop pilot.** Spending the sourced
700 frames of hall light only evicts Foxy if he is actually in the hall while
it runs, and it only pays for itself if BB's forced mask window lands inside
the 500-999 frame nap. Markiplier can arrange both because he hears BB's
laughs and reads the hall; a pilot holding one vent screenshot per cycle knows
neither, so it burns the power and takes the exposure anyway.

The old “clearing BB costs about 8 s” argument is withdrawn. It priced five
mask ticks as a flat five seconds, but g907 increments on one-second event
boundaries: five ticks span 4.017-5.000 s depending on phase. The response's
monitor-down portion is 6.4 s against a 6.67 s stall, so the previous claim
that one interval *must* be uncovered does not follow. The current table pays
the worst phase and has not been aligned to recover that possible second.

What *is* measured is narrower: the vent check removes BB and the Foxy chain,
yet all 200 modeled runs still die to the seven during the long cams-down
response. A CAM 05 check one move earlier may give the policy time to prepare,
but it is a separate visual model and still needs real positive/negative frames.

### The night the phone actually plays (2026-08-23)

Every table above was measured on 10/20, because that was the only night the
engine had: it read one 15-AI cap for the seven and a 17 for Foxy. The AI table
is now sourced per night *and* per hour — g673 zeroes the counters, g674-684
write the table, g787 copies the Custom Night dials, g804 zeroes Golden Freddy
below night 6, g815-821 set the Puppet, and g829/g830/g856-863 cap the result.
Rebuild it from the dump with `packages/source/decompile/aimap.py`; `pilottest --night=6`
replays the same schedule against the night the runner actually selects.

6th Night is two rows, and only the second is 10/20-like:

| | 12 AM | 2 AM |
| --- | ---: | ---: |
| W. Freddy / W. Bonnie / W. Chica | 5 | 10 |
| W. Foxy | 10 | 15 |
| Toy Freddy / Toy Bonnie / Toy Chica | **0** | 5 |
| Mangle | 3 | 10 |
| Balloon Boy | 5 | 9 |
| Puppet | 15 | 15 |
| Golden Freddy | 1 in 10 | 3 |

400 nights per row; 2 AM lands 140 s into a 420 s night:

| Schedule | Cleared | Median | p95 | Best |
| --- | ---: | ---: | ---: | ---: |
| night 6, blind (what the phone runs) | 0/400 | 118 s | 180 s | 228 s |
| night 6, + vent check | 0/400 | 149 s | 194 s | 254 s |
| night 6, + vent + `--sync` | 0/400 | 158 s | 220 s | 265 s |
| 10/20, + vent + `--sync`, for comparison | 0/400 | 58 s | 78 s | 98 s |

**The model and the phone now agree on a number.** 388 of the blind schedule's
400 night-6 deaths are the Balloon Boy -> Foxy chain, and the retained 80-cycle
device trial died to exactly that chain at about 138 s — inside this
distribution, one second under its p75. That is the first quantitative
agreement between the simulator and a recorded night on the device, and it was
not available while the engine could only play 10/20, where the same schedule
dies at a 48 s median.

**6th Night is deeper, not winnable.** The lower early AI roughly triples how
far the schedule gets, and it moves the failure across the 2 AM cliff: blind,
286/400 nights end before 2 AM; with the vent check and `--sync`, 248/400 end
after it. What kills those runs is the seven at marker 123 (358 of 400) and the
Puppet (42) — and the Puppet is new. He is the price of a 6.4 s cams-down
response that does not wind, which 10/20 never charged because nothing survived
long enough to run out of box.

So the answer to "does the night the device selects rescue the shipped
schedule" is no. It buys about two extra minutes and hands the remaining
problem to the 2 AM step-up, where the three Toys switch on at once.

## Superseded visual prototype and retained negative searches

The remote research branch first tried to average a few screenshot rows with
device shell processes. It established the correct architecture but not a live
solution: host `screenstate --adb-fast` took 692-785 ms, pulling/averaging a
rectangle took ~3.3 s, file-based on-device shell averaging took 404 ms, and a
streamed `dd | od | awk` form reached 230 ms with a ~245 ms screencap floor.
In a live trial all fourteen probes returned unavailable and the unpinned form
pushed the schedule about 500 ms late. Those region scripts are intentionally
not merged; the single-process native `screencheck` supersedes them while
retaining their useful “capture and branch locally” boundary.

Three pure simulator reports are retained so the unsuccessful policy ideas are
not repeated:

- `phasesweep.ts`: cams-down phase can defer BB's latched final hop but no
  200 ms alignment eliminates office arrivals (best was 61/200 overall and
  66/200 among phases where the interval lands cams-down).
- `periodicsweep.ts`: a blind full response every third/fourth cycle keeps BB
  out, but the mask blocks the hall and the policy dies sooner (about 30 s
  median versus 48 s).
- `flicksweep.ts`: blindly dropping the Golden Freddy flick loses 199/200 at
  a 13 s median, so a blind schedule cannot buy time that way. A visual policy
  may skip it only on a proven-empty office frame.

### Device-local BB branch checkpoint (2026-08-23)

The native left-opening model has now passed two untouched live holdouts,
including simultaneous translucent Golden Freddy interference. In run K the
device captured one safely lit left-vent frame per cycle before the hall,
classified BB and a provisional GF model from that same raw frame, and masked
42 ms after the second classifier reported the cycle-7 BB positive. The saved
frame visibly contains BB; offline native replay reproduced seven empty results
and the positive at the original `score=0 margin=18`. Cleanup force-stopped the
game before the hall or any large transfer.

The run also prices the unfinished response: eight complete selected-camera
sweeps and 11 rendered hall-beam intervals accompanied a run in which Foxy
remained controlled, but the decomp proves that count under-reports logically
accepted flashes during hall movement. Meanwhile, 1.3 s winds in the 6.5 s
visual cycles drove the music box from full to 9.5% by cycle 7. The branch
therefore remains a safe detection/collection path, not a full BB clear and
resynchronization policy. An earlier run that waited until cycle 8 to sample
died to Foxy around 42 s and captured only post-kill static (`unknown`), which
is why threat sampling now begins at cycle 0 during validation runs.

## Availability of calibration targets

`packages/source/decompile/aimap.py` on the owned canonical Office sheet makes a prior null
Golden Freddy recording unsurprising, but does not prove he was unavailable.
At the start of Night 6, one run in ten assigns him AI 1 and the other nine
assign 0; 2 AM overwrites either result with AI 3. Even on the enabled early
run, each office-spawn check is only AI/20. Custom Night applies the dial and
g830 caps him at 10, making 10/20's office roll 1/2, but Custom Night remains
locked on this save. Night 6 also raises BB from 5 to 9 at 2 AM. Golden Freddy
can supply positives, but sparsely. Toy Bonnie needs no capture for this Minus
7 branch because the selected CAM 04 stall already controls him.

## The classifier has to be trained on the loop that will run it (2026-08-24)

Four Night 6 attempts read `bbinside` or `unknown` on cycles where Balloon Boy
provably could not be present -- he needs five five-second rolls, so nothing
before 25 s is him. None of those reads were the game. Measuring the ROI of the
frames the classifier actually saw separates the two populations cleanly:

| frames | LIGHT button mean luma | vent-opening mean luma |
| --- | ---: | ---: |
| the model's templates, and every `empty` read | ~103 | ~30 |
| every `unknown` read | 33-60 | 37-63 |

`candidate-runs-gh.scm` was built from `capture_lit_at`, which issues
`screencap` a fixed 350 ms after light-down. The live loop instead starts the
capture at a chosen offset and latches on the first output byte, 163-348 ms
later, so the capture start is the only control over where in the vent-light
ramp the frame lands. Moving it to avoid one failure moved the frame out the
other side of the distribution and produced the other:

- start +100 ms -> latch 263-448 ms; mostly `empty score=0`, but the early tail
  catches an unlit opening, and an unlit opening is what BB *in the office*
  looks like, so it reads as a confident `bbinside`;
- start +300 ms -> latch 550-650 ms; past the ramp, and reads go `unknown`.

The fix is not a third offset. `runtime-gh.scm` adds seven frames captured
through the live loop itself, at both latch windows, to the `empty` class.
Leave-one-out separation holds at `--max-score 16` (empty same-class 0..15,
margin 6..19), and both models classify **all 32 independent holdout frames
correctly, including all three BB positives**, so the widened class costs
nothing measurable. Only frames from before 25 s were used, so the label is
certain rather than assumed.

`--max-score` moved from 12 to 16, which makes the model more permissive in
absolute distance. `--min-margin` is unchanged at 6, and the margin is what
separates the classes; the score bound only decides what is far enough from
everything to be `unknown`.

Rebuild it with:

```sh
tools/device/build-screen-model.py --roi 80,600,500,1060 --grid 10x10 --step 2 \
  --max-score 16 --min-margin 6 \
  --output captures/screencheck/bb-left/models/runtime-gh.scm \
  empty=captures/screencheck/bb-left/calibration/run-gh/empty \
  empty=captures/screencheck/bb-left/runtime-empty \
  bb=captures/screencheck/bb-left/calibration/run-gh/bb \
  inside=captures/screencheck/bb-left/calibration/run-gh/inside
```

## 2026-08-24, second session: what was found, and one retraction

Forty device runs. The honest result is **no night 6 clear and no new record**:
the longest graded survival was **120.5 s** (night 6-34) against the 138 s already
on file. Read that first, because two numbers from this session were published
before they were graded and they were wrong.

### Retraction: the 163 s and 153 s "records"

Nights 6-36 and 6-37 were reported at **163 s** and **153 s**, both "past 2 AM", the
first past the standing 138 s record. Graded with `grade-night.py` they are
**26.0 s** and **72.2 s** alive. The remainder was the pilot pressing into a
dead game. The retained classifier frames show it directly: the death static,
the "Take cake to the children" minigame, and a "12:00 AM 6th Night" restart
card, all inside the interval that was quoted as survival.

Two independent failures let that through, and neither was subtle:

- **The watchdog's fast path could only recognise one way of being dead.** A cue
  helper snapshot with `rms=0`, `luma>=200`, `cam5>=200` is the static screen,
  measured across night 6-34's death. Wired as `if (static) gameover else night`
  it answered "night" to the minigame, the restart card and the title menu. A
  detector that knows one way to be dead must never be the thing that says you
  are alive; it may only *add* a detection. `screenstate.py`'s HUD predicate --
  flashlight meter or mask bar -- correctly rejects all three, and is the
  authority again. `test-runner-plan.mjs` now fails if the helper branch of
  `state_once` can print "night".
- **The grading step had been running against a file that does not exist.**
  `GRADE_RUN=1` graded `"$OUT.mp4"`; every run that ends in an abort saves
  `"$OUT-aborted.mp4"`. So for the whole session it printed nothing and looked,
  in the log, exactly like grading. `screenstate.py` could have refuted the
  163 s claim from any single frame of that recording. Nobody ran it.

`packages/review/bin/grade/grade-run.sh` exists because of this: one pipeline that finds
whichever capture exists and runs every instrument -- survival, the HID trace
auditor, camtrace at 60 fps, sweepcheck, windpct, grade-minus7 -- and prints one
verdict. The runner calls it. See CLAUDE.md, "Instruments are not a pipeline".

### Defects found and fixed, each with its evidence

- **`hid` rejects a zero-length delay outright.**
  `IllegalStateException: Delay has missing or invalid duration`, the process
  exits, mksh loses the co-process, the night ends at the next write.
  `plan_emit`'s `hallraise` emitted the light lead unguarded and that lead is 0
  in the shipped geometry, so the hall light was pressed for 0 ms and released.
  The device owner saw it before any log did: "fails to press hall light and
  moves the vision instead". Written up as Trap 3 in `HID-MULTITOUCH.md`, gated
  four ways.
- **The watchdog was blind by construction.** Its capture budget was 0.8 s
  against a measured idle cost of 0.72-0.85 s, so it timed out on essentially
  every poll and printed `unavailable (ignored)` for a whole night. Raised to
  2.5 s and validated under recording load (6/6, where the old budget failed
  even then). Sustained blindness now aborts rather than being ignored forever.
- **The watchdog was starving the classifier.** Polling every 0.25 s while each
  poll costs ~1 s meant it captured almost continuously, competing with the
  classifier's own `screencap`. Night 6-23 read `unknown` on 7 of 8 cycles under
  that contention; the same schedule with the watchdog quieted read
  `empty score=0 margin=19` on 4 of 4.
- **The plan overran its own cycle boundary.** Both steady cycles ended on a
  sweep finishing 5007 ms into a 5000 ms cycle, so the next anchor's monitor
  press landed on the sweep's final camera release. Anchoring the sweep's *end*
  in the emitter removed the overrun entirely.
- **Camera selects were arriving inside `MONITOR_ANIM_UP`.** `engine.js` drops a
  select unless the monitor has finished raising, and the attack cycle asked for
  one exactly 200 ms after the raise -- zero margin against a 204 ms sourced
  animation, deterministic in the engine and a coin flip on a phone whose
  wall-timed anchors land 49-93 ms late. `test-device-input-gaps.ts` gates it
  against the sourced constant, derived rather than restated.

### Measurements worth keeping

- **`wait_until` overshoots by 49-93 ms**, median 77, because `sleep` and `date`
  are fork+exec here (`sleep 0.02` costs 75 ms wall; one `date` fork ~25 ms).
- **`hid_delay` holds +/-2 ms**, stdev 0.76, measured from the kernel's own
  `getevent` timestamps over 60 contacts. That 25x gap is why the macro exists.
- **The Companion answers in 42 ms p50 / 57 ms p95**, against ~225 ms for
  `screencap` + `fnaf-screencheck`. The runner had *no* helper integration at
  all until this session; every read was the expensive path, which is why it can
  only afford one read per five-second cycle -- and why Balloon Boy is only ever
  seen once he is already inside.
- **Sweeps are landing.** `sweepcheck.py` reports 11/11 sweeps flashing all of
  CAM 10/04/07 in a real night. camtrace disagreed with "4 complete, 4
  incomplete", but at a *finer* dwell floor it reported more incomplete starts,
  not fewer -- it grades the ordered sequence, not whether the stun was applied.
  A 140 ms spacing was built on the strength of camtrace's reading and then
  withdrawn when the control refuted it; the emitter can still widen (the route
  tolerates 140 with the sweep's end anchored, 400/400, and collapses at 160)
  but 120 remains what ships.

### Golden Freddy is ignored on night 6 — withdrawn 2026-08-25

**Correction:** this temporary plan was withdrawn before another device run.
Sourcing Fusion's RNG invalidated its timing premise: in the same 1000-seed
census, ignoring Golden Freddy clears 465/1000 and the first loss can arrive at
8.55 s, not 149 s. More importantly, the HID/video census below found that the
stuck-mask nights lost the *monitor press after mask-off*, not the mask toggle.
The flick is restored; `recipe.mjs` emits mask-off + raise as one `maskraise`
macro with a 180 ms internal gap, where the retained device census is 0/17
losses. The route before the first post-read Foxy reset was restored was
100/100 exact but only 449/1200 under the model gate's ±60 ms slack (its
46/100 result was a favourable seed block). Carrying an eight-frame hall contact on
that same compound row leaves the measured 180 ms mask→monitor seam unchanged
and raises the broad result to 673/1200.

The original reasoning is retained below because it motivated the census that
found the real seam. Its figures used the simulator's old invented xorshift
stream and are not current results.

The always-taken mask flick is not a Balloon Boy precaution -- it is the Golden
Freddy clear that the strategy's order rule demands before the hall flash. But
it is a *guess*: two blind mask toggles every cycle in a runner that cannot see
the mask's state, and a dropped toggle latches the mask on and makes every later
left read dark, which the model scores a confident `bbinside`. Priced over 1000
night-6 runs: **1000/1000 with the flick, 478/1000 without**, and every one of
those 522 losses is "raised the monitor with Golden Freddy in the office" with
the earliest at **149 s** -- after the 2 AM step-up. Ignoring him is free for
1000/1000 runs up to 2 AM and the device has never survived past 121 s.

This must be revisited before any attempt that expects to pass 2 AM. Golden
Freddy should be identified, not guessed. The provisional model classifies 22/22
correctly but at a margin of **3** where Balloon Boy's is 18-21, and both its
positives come from a single appearance. Runs now retain every non-empty
classifier frame under `captures/screencheck-keep/<run>/` plus a continuous
~14 Hz cue trace, because he is one run in ten before 2 AM and cannot be
requested, only caught.

### What actually killed the forty runs, and a corrected cause

`packages/review/bin/report/death-census.py` pulls the death frame out of every recording on
disk and tiles them. Across 33 nights with an identifiable ending:

| killer | count |
| --- | ---: |
| Withered Foxy | 19 |
| Puppet | 3 |
| Golden Freddy | 2 |
| no jumpscare (aborted on cams, or masked) | 9 |

**The obvious reading of that is wrong, and the clock is what refutes it.** Foxy
at 79% invites the documented BB->Foxy chain -- BB reaches the office, g96 takes
every light, the hall cannot be flashed, Foxy's D runs out. But the alive times
cluster hard: median 30 s, and **12 of 33 die between 28 and 32 s**. Balloon Boy
cannot reach the left opening before 25 s and needs at least another five-second
roll to be inside, so he has not taken anything yet.

29-31 s is a constant this page already recorded, long before the pilot existed:
"Three closed-loop 6th Night mask-camp trials died at 29/31/31 s to the W. Foxy
office lunge ... the mask does not deter him, his D grows unflashed." A death
there is Foxy killing **unflashed, from the start** -- the hall flash never
reached him.

Which is what a monitor desync does. With the cams up, the hall press at
(1200,540) lands on the camera map, not the office. The device owner reported
that directly before any log showed it -- "haven't seen any hall light",
"started panning view instead of flashing" -- and the desync detector added this
session confirmed it in-run: cams=down, cams=down, then cams=UP-DESYNCED and
never down again.

So the ordering of causes is: **desync -> no hall flash -> Foxy at ~30 s**, and
the BB->Foxy chain is the *later* failure that only the runs which outlive the
Foxy window ever reach. Night 6-34 is the one that reached it: 120 s, and its
death frame has Foxy's face and Balloon Boy's balloon in the same shot.

The 3 Puppet deaths are box starvation. The 2 Golden Freddy deaths are the risk
being knowingly carried while he is ignored.

### Which press desyncs, and why (2026-08-25)

The paragraph above says a desync is what happens; it does not say which press
is lost or how often, because until now nothing measured that. The artifacts
already on disk do: the HID trace is what the phone was sent, and the recording
is what the game then did. `tools/device/desync-scan.py RUN` lines the two up
and grades the intervals between presses. It is in `grade-run.sh`, so it runs
on every graded run from now on.

Across the 28 nights that have both a trace and a readable capture, **14
desynced and 14 held**. Every one of the 14 is a single monitor press the game
did not act on, and they are not spread evenly over the schedule:

| the monitor press followed | landed | lost | not readable |
| --- | ---: | ---: | ---: |
| **a mask press** | 23 | **9** | 0 |
| a wind hold | 29 | 3 | 56 |
| a hall hold | 67 | 1 | 2 |
| the vent light | 97 | 0 | 3 |
| the mute press | 28 | 0 | 0 |
| **another monitor press** (the in-cycle correction) | 0 | **1** | 0 |

The mask seam has a threshold, and the runner was scheduling under it:

| monitor press, after the mask press | landed | lost |
| --- | ---: | ---: |
| under 140 ms | 2 | 5 |
| 140-180 ms | 4 | 4 |
| 180-220 ms | 11 | 0 |
| over 220 ms | 6 | 0 |

Nine of fourteen desyncs are that one instruction pair, at 100-178 ms. Nothing
at or past 180 ms was lost in 17 tries. The reason is visible in any retained
mask frame: **while the mask is up the monitor bar is not drawn.** Only the
pink mask bar occupies the bottom strip, so a monitor press during the mask-off
animation has no control under it. `MASK_ANIM_OFF` is 15 frames (244 ms), and
the engine's `setMask(false)` clears `maskOn` on the press and leaves the
animation running as decoration, so `press()` accepts a monitor press the phone
throws away. The simulator cannot fail this way; only the phone can.

**The emitter's contract passed every one of these presses.** That is the
control, and it is the part worth keeping: `test-hid-trace.ts` audits nights 6-10, 6-12 and 6-14 and reports no defect at 8.41 s, 8.41 s and 8.47 s -- 35, 76 and
78 ms released, all above `MIN_RELEASED_MS` -- and the game ignored all three.
It does flag nights 6-22 and 6-28 at exactly the blamed press ("only 0 ms released
between 144,270 and 144,801"), which is the auditor working. A legal stream is
not an accepted one, and the two floors are answering different questions.

At the time of this census, two thirds of the exposure was gone by accident
rather than by decision: dropping the Golden Freddy flick removed the clear
cycle's mask instruction. The then-shipped plan still had attack's
`5917 tap mask` followed by `6127 hallraise` -- **210 ms**, inside the band
that had not lost a press yet but only 30 ms above one that had. The correction
above supersedes that layout: both branches now use one 180 ms compound.

The other two live seams are smaller and both real:

- **34 ms is the plan's spacing before the hall-flash pair** (`2717 tap monitor`
  after a wind hold ending at 2683, `3267 tap monitor` after a hall hold ending
  at 3233), which is one Fusion poll and the floor `test-recipe.ts` asserts.
  Three of the fourteen desyncs are there -- nights 6-33, 6-35 and 6-37. Most of
  those windows cannot be graded -- 550 ms is shorter than the flip animation
  inside it -- so the rate is not measurable from these runs; what *is*
  measurable is that the office rendered in 109 of 113 scheduled hall-flash
  windows, so the pair usually lands. Designing to the floor is what makes the
  failures cluster there. (Night 6's loss is the same disease in a geometry the
  runner no longer uses: its monitor press went down while the wind contact was
  still held.)
- **The in-cycle correction can cause the desync it looks for.** Night 6-38:
  the anchor's monitor press at 12.132 s, the Companion's read 247 ms later
  reporting the cams still up -- which they visibly were, because
  `MONITOR_ANIM_DOWN` is 367 ms and the flip was still running -- and a
  "corrective" press at 12.379 s that the port dropped for the same reason.
  One press, one desync, and the run spent its remaining 58 s inverted. A
  monitor observation taken inside `MONITOR_ANIM_DOWN` of a monitor press is
  not an observation of anything.

  **Fixed 2026-08-25**, and the gate is measured rather than assumed. The
  retained cue traces already contained the answer: across nights 6-36 to 6-38, after
  a lowering press the helper still reported `luma >= CUE_CAMS_UP_LUMA` up to
  **+202 ms** and never later, so `light_down_at` now waits
  `LAST_MONITOR_PRESS_MS + MONITOR_ANIM_DOWN_MS` before it samples -- about
  165 ms of margin over the worst observed case. It was never going to be free:
  the read slips by the anchor press's own lateness, 110-180 ms, which the
  plan's 416 ms of slack before the next instruction absorbs.

  Two things had to move with it. `READ_CAPTURE_DELAY_MS` is a position in the
  vent-light ramp -- the only control over where the classifier's frame lands,
  and moving it is what produced the `bbinside` and `unknown` misreads -- so the
  capture is now placed from when the light actually went down rather than from
  the plan's offset. It was not: with the correction pushing the light 467 ms
  late, the capture had been firing *before the light was down*. And
  `light_down_at`'s own `offset`/`label` came back clobbered from `press_at`,
  because the runner's functions share one scope, so the vent light's log line
  read `monitor-verify (contact 0 down)`. `test-plan-interpreter.sh` covers all
  three: the gate, a genuine desync still being corrected, and the first read of
  a run not waiting for a flip that never happened.

Survival does not separate the two groups in this sample and should not be
claimed to: among runs alive 20 s or longer the median is 30.5 s desynced and
30.2 s held. What separates them is what the run was still capable of -- an
inverted pilot flashes the camera map instead of the hall, reads the feed
instead of the vent, and stops winding -- and the longest run on disk
(night 6-34, 120.5 s) is one whose model held.

### Night 6-40: the gate on the phone, and what is left (2026-08-25)

The flip gate's first device run. **110.5 s alive, and `desync-scan.py` reports
the pilot's model of the monitor held for the whole graded interval** -- the
second-longest run on disk and the first long one with no divergence at any
readable interval. Nineteen consecutive reads came back `empty score=0
margin=19` with `cue[luma=0..102]`, the office, and no `cams still up at the
read` line fired for 97 s. The gate costs more than predicted: the read's light
now goes down about 700-810 ms into the cycle against the plan's 367, because
the anchor press lands ~300 ms in rather than the 130-180 the older traces
suggested. It still clears the next instruction by ~380 ms, and the box never
starved -- `windpct` has it between 80% and 100% the whole way, 71.9% at 115 s.

The one correction that did fire is the fix working rather than the bug: at
97.57 s the post-gate sample read `luma 255`, the classifier agreed
(`cams=UP-DESYNCED`), and the recovery put the cams back down. Compare night 6-38, where the same code sampled 214 ms into a flip and invented the desync.

What caused it is the seam this session did not touch. `test-hid-trace.ts`
flags **three 0 ms released cam7 -> monitor presses** in this run, at 22.16 s,
37.20 s and 97.14 s: the sweep's final camera release and the next anchor's
monitor press in the same instant. Two landed, the third did not. That is the
same overrun as nights 6-22 to 6-24 in a different place, and it is now the largest
remaining source: the mask seam that cost nine nights is no longer scheduled,
and the flip gate has taken the corrector out.

The run then died the way the census says these runs die. At 105 s the
classifier read `bbinside`, and the game left the night state at 113 s.

### `bbinside` is not a threat to respond to

The class was called `inside` until 2026-08-25, which is what every run log and
retained frame before night 6-40 says. It was renamed because the name has to
survive the next occupant: a dark left opening is the only thing the sensor
sees, and any future blackout will land in the same class. The label is ours,
not sourced -- the event sheet speaks in markers (122 at the opening, 123 in the
office) and never says "inside" -- so it lives in the `.scm` models, which are
untracked. The three bb-left models were relabelled in place and the holdout
replay is byte-identical: 32/32 correct at the same scores and margins.

Until night 6-40 a `bbinside` read fell through to the catch-all, failed closed,
and spent the five-tick mask on it. That is wrong, and the sourced engine says
so plainly: the mask returns Balloon Boy from the *opening* (marker 122), but
once he is at 123 "g96 forces `lit?` to zero every frame ... and **no group ever
moves him back out**. Foxy finishes the job." `bb.inside` is set once and never
cleared, so the flashlight is gone for the rest of the night, the hall can never
be flashed again, and the run is already lost when the read comes back.

So the runner now stops on `bbinside` (exit 49) instead of masking. Masking there
spends wind and exposure on a state the mask does not address, and the only
thing the extra cycles produce is a longer recording of a dead night -- which is
exactly what made nights 6-36 and 6-37 read as records.

### The second mechanism, and the validation night (2026-08-25)

The forcedown explained night 6-43 and could not explain night 6-45, whose
inversion began at the **first steady-cycle anchor, 7 s in** -- nothing can be
at marker 122 that early -- and whose correction then fired **every cycle**,
faster than the 10 s cadence. The mark-true trace exonerated the emitter at the
onset (102 ms after the wind, 354 ms after the sweep tail), so the loss was in
neither the spacing nor the engine.

It was in the launch. The capture pipeline finishes 30-900 ms past the plan's
resume cut-off -- worse when the flip gate corrected first -- and the
clear/attack branches launched `run_macro` with no floor. An unfloored macro
replays uniformly late with `rm_shift=0`, so the shell's seam wait
(`base + cursor + rm_shift + one poll`) undershoots the still-running sweep and
the next cycle's anchor is written into the hid coprocess while the sweep's
tail is still executing. The queue serializes them back to back: **a real
zero-gap at the seam that no trace clock can see**, because marks record the
host's intent and the queue depth is invisible. Fusion reads the pair as one
finger moving off the camera; the anchor never fires; the cycle enters
inverted. (The auditor's retracted "0 ms released" flags were artifacts -- but
they pointed at a seam that a different clock really was collapsing. The
retraction stands; the seam was real for a reason the trace could not show.)

`run_macro` already had the fix -- `rm_floor` shifts the whole macro,
preserving every plan gap, and `rm_shift` feeds the seam wait -- and the
recovery path already used it. The branches now floor too: clear at now + one
poll, attack past its own mask press.

**Night 6-46 is the validation.** Same route, both fixes live:

| | 6-43 | 6-45 | **6-46** |
| --- | ---: | ---: | ---: |
| in-cycle corrections | 1 | 4 | **0** |
| desync recoveries | 4 | 1 | **0** |
| `desync-scan.py` verdict | inverted from 26.02 s | inverted from 13.75 s | **"the pilot's model of the monitor held for the whole graded interval"** |

The run ended at ~41 s to a real attack (the death static is on film; the last
read was an `unknown` the mask answered too late), which is the game, not the
pilot. And its 26 s `nolight` read was followed by a lit `empty` read -- the
encounter-vs-marker-123 discriminator behaving exactly as specified.

What remains true: the forcedown will still invert parity whenever it fires --
it is the engine -- and the correction plus the verified recovery are the
mitigation that now bounds it to one cycle. One anchor drop (6-45's at 7.37 s,
102 ms clean gap) stays unexplained; it was recovered in-cycle, which is the
design working.

### Diagnosis: the desync is the engine's forcedown (2026-08-25)

Night 6-43 closes the question the last three sessions kept reopening. The
monitor desync is **not an input defect**. It is the sourced `drop everything`
forcedown doing exactly what the engine dump says it does:

> set every 10 s while a streak-four attacker waits at marker 122 with the cams
> up (g718-721), on any attack start (g624), by the Puppet's arrival at 123
> (g574) ... g262 executes it on the monitor: lowers it and zeroes `viewing`.
> (`ANDROID-SOURCE-STATUS.md`, sourced 2026-08-20)

The pilot models the monitor as a toggle of its own presses. The engine revokes
it unilaterally. Any press-counting model must invert on every forcedown, and
every candidate that blamed the input side is now closed:

- the **cycle seam** "0 ms released" flags were the trace auditor's clock
  (retracted below; the real gaps were 112-282 ms);
- the **corrector** firing on flashes is real but secondary -- it worsens an
  inversion, it does not start one;
- the "**dropped**" monitor press that begins night 6-43's inversion at
  26.02 s had **352 ms of clean released time**. Nothing was dropped: the raise
  landed and the forcedown spent it one frame later.

What the run's own instruments recorded, against the mechanism's predictions:

| prediction | night 6-43 |
| --- | --- |
| ~10 s forcedown cadence while a 122 camper waits under raised cams | recoveries at **15.8, 25.9, 36.7, 43.1 s** |
| inversion persists through open-loop recoveries (the camper persists) | `desync-scan.py`: DIVERGED 26.02 s -> 47.5 s across four recoveries |
| agreement returns when the monitor stays down (mask held) | re-agrees at 50.17 s and 58.13 s, during the mask holds |
| the encounter itself: occupant enters, `in danger` blocks all lights | Mangle's overlay on film at ~56 s; three `nolight` reads; lamp dark |
| the mask resolves the encounter | office empty again on the following frames, night still running |

Two consequences were fixed with it:

- **The recovery now closes its loop.** After the resync press it reads the
  cams back through the Companion (59 ms) and presses once more if they are
  still up, bounded at one retry. An unverified resync is the same open-loop
  mistake at one remove, and it is why 6-43 stayed inverted through four of
  them.
- **Exit 49 needed a longer memory.** Night 6-43's three dark reads spanned one
  masked encounter, were concluded to be "BB inside", and aborted a night whose
  final frames show a live Party Room 4 feed. An encounter darkens the lamp for
  two to three attack cycles at most; only marker 123 never relights. The
  streak is now 5.

What "solved" means here, precisely: the forcedown cannot be prevented -- it is
the game -- so the permanent fix is a model that expects revocation. The
checkpoint read at each cycle plus a verified recovery bounds any inversion to
one cycle's remainder, instead of the run's remainder. The residual cost is the
cycles an attack eats, which is the game being played, not a defect.

### The in-cycle correction fires on a flash (2026-08-25)

With the seam refuted, the desync's live evidence points at the corrector again
-- and this time the number is in the traces rather than in the auditor.

The gate added earlier fixed *when* the correction samples. It did not fix that
**one sample decides**. Steady cams-up is a tight band and saturation is a
separate, short-lived population:

| | nights 6-40, 6-41, 6-42 |
| --- | --- |
| steady cams-up band | **225-250**, median 227 |
| saturated `luma 255` | runs of 1-2 samples; 24-36% are already below 180 by the next sample |

Both clear `CUE_CAMS_UP_LUMA` (180), so the correction cannot tell them apart.
**Every correction on file triggered on 255**, and 255 never appears beside a
classifier read -- the reads carry 0, 102, 226, 227. That is the shape of a
camera light pulse or a hall flash washing the sensor pixel, not a monitor that
is up.

Night 6-42 is the sequence: correction at 17.876 s on a `luma 255`, resync at
20.098 s, resync at 29.875 s, and `desync-scan.py` calls it permanently inverted
at 30.38 s. Night 6-38 died the same way and the fix then was the timing gate.

So the correction now takes a second reading and only spends a press if that one
is high too. It costs 59 ms against the ~416 ms of slack the plan leaves before
the next instruction, and a transient does not survive it; a rejected transient
is logged rather than silently dropped. `test-plan-interpreter.sh` covers it --
a one-sample flash must not be corrected, a genuine desync still must be.

This is a hypothesis with a mechanism and a control, not a confirmed cause: it
has not yet run on the phone. The next night is the test.

### Retraction: the "0 ms released" cycle seam was the auditor's clock (2026-08-25)

**`test-hid-trace.ts` cannot time a boundary the runner waits through, and its
zero-gap flags at the cycle seam are artifacts.** Everything above that blames
"the sweep's final camera release and the next anchor's monitor press in the
same instant" -- including calling it *the largest remaining source* -- rests on
those flags.

The auditor advances its clock on emitted `delay` records and takes
`now = max(now, mark)` on a mark, so the clock can never be pulled back. It does
run ahead, because the runner spends host-side `wait_until` time between actions
and that emits no delay record while every emitted delay still advances the
clock. Once it is ahead, every corrective mark is discarded:

| run | marks discarded | worst drift |
| --- | ---: | ---: |
| night 6-40 | 68 of 252 | 1637 ms |
| night 6-41 | 10 of 36 | 178 ms |
| night 6-42 | 56 of 130 | 2742 ms |

Measured from the marks instead -- the runner's real clock -- the flagged seams
are not close calls:

| flagged as | real released time |
| --- | ---: |
| night 6-40 @ 22164 ms | **157 ms** |
| night 6-40 @ 37205 ms | **187 ms** |
| night 6-40 @ 97142 ms | **112 ms** |
| night 6-42 @ 12499 ms | **282 ms** |
| night 6-42 @ 52353 ms | **218 ms** |

All are far above the 33 ms Fusion poll the plan is designed to. `run_macro`'s
`FUSION_POLL_MS` seam delay works exactly as `test-runner-plan.mjs` asserts; the
auditor simply cannot see it. The same defect produced the `contact 0 at
1033,157 held 0 ms` vent-light flags, which were briefly taken as the cause of
night 6-41's dark lamp.

Why it survived: **every fixture in the auditor's self-test was delays-only**,
so `max(now, mark)` was never exercised against a mark arriving behind an
over-advanced clock. There is now a case for it, and a trace with a discarded
mark reports its timeline as untrustworthy before any of its numbers.

What this does *not* retract: night 6-41's lamp really was dark, measured from
the recording rather than the trace -- lit exactly once for 531 ms across 20 s.
And night 6-42 really did desync; `desync-scan.py` reads the screen, not the
trace, and it stands. **The desync's mechanism is open again**, and the live
evidence points elsewhere: the runner's own Companion read saw the cams up at
17.876 s (`luma 255`) and corrected in-cycle, then resynced twice more before
`desync-scan.py` calls it permanently inverted at 30.38 s. The auditor's timing
numbers cannot be used to choose between candidates until the timeline is
re-based.

### Retraction: `bbinside` was the vent light being off (2026-08-25)

**The class was never Balloon Boy.** Everything above this line about him
reaching the office rests on frames where the vent lamp was dark, and the lamp
is *inside the model's own ROI*, so it could have been read at any point.
Measured across every labelled frame:

| class | frames | lamp green-excess |
| --- | ---: | ---: |
| `empty` + `bb`, calibration and holdout | 49 | **104.0**, every frame |
| `bbinside` (the whole training set) | 2 | **0.2** |
| the frame that ended night 6-41 | 1 | **0.2** |
| the frame that ended night 6-40 | 1 | **-0.9** |

Both exemplars the class was ever built from are unlit openings. There is no
photograph of Balloon Boy in the office anywhere in this repository, so the
class had no positive training data at all -- it was trained on the absence of
the light and then given the authority to end a run.

Night 6-41 is the proof. It died at **13.7 s** on a `bbinside` read, and he
needs five five-second rolls, so nothing before 25 s can be him. Its recording
settles the mechanism independently: across the whole 20 s run **the lamp lit
exactly once, for 531 ms** -- the first read, which returned `empty` -- and the
second vent-light press never lit it at all. Same coordinate, same held contact,
same phase after the monitor animation. The press was simply not accepted, which
is the seam this document already names: a legal input stream is not an accepted
one.

The fix is not a better threshold, because one frame genuinely cannot separate
the three things that darken the lamp -- a dropped press; `in danger` latched so
no light answers (g75/g76/g77); or him really at 123, where g96/g301/g303 stop
the vent lights answering. **Being inside makes the lamp dark, so darkness can
never be the evidence for it.** What separates them is the retry: a dropped
press recovers on the next cycle and marker 123 never does. So the class is now
`nolight`, it fails closed to the mask like any other unreadable frame, and only
a streak of them past `BB_EARLIEST_INSIDE_MS` concludes he is inside. The
rebuilt model keeps the validated boundary exactly: **32/32 holdout, same scores
and margins** (bb 0/18, empty 0/19).

`rejected-dark/` had been a `nolight` bucket all along -- 15 of its 17 frames
have a dark lamp -- and supplied the class its training data.

### The one problem that is still open

~~Balloon Boy reaches the office.~~ **Withdrawn 2026-08-25** -- see the
retraction above. The reads that said so were unlit openings, so the premise is
gone and the "read more often" question it motivated is not yet earned. What is
open is the thing underneath it: **the vent-light press is dropped often enough
to matter**, and until a read is known to be an observation, nothing about
Balloon Boy can be concluded from it either way.

The original reasoning is kept because it was right about everything except the
cause: the pilot does look only once per five-second cycle, and the Companion
at 42 ms is still the reason a cheaper read is worth asking about. One claim in
it was wrong on its own terms and is corrected here -- the vent light is **not**
gated on the flashlight budget. Only `lit?` drains `battery life` (g284); vent
lights are free, corrected in `ANDROID-SOURCE-STATUS.md` on 2026-08-20 and
missed here.

## 2026-08-26: the runner's own loop, modelled -- and what it turns out not to buy

The flip gate and the classifier checkpoint above are the two places
`trial.sh` stops being open-loop, and until now no simulator here
contained them. Every actuator figure for Nights 2+ was therefore a statement
about a controller the phone does not run, and plans/12 said so and left the
number unmeasured. `packages/play/bin/phone/actuator.ts` now carries `MonitorSupervisor`,
and `packages/propose/parked/minus7/closed-loop-reclaim.ts` prices it. **Everything below is in the
simulator.** No phone was involved.

### What was modelled, from the shell rather than from an ideal

- `light_down_at`: block, `wait_until LAST_MONITOR_PRESS_MS + MONITOR_ANIM_DOWN_MS`,
  one cue read (59 ms), and on a cams-up answer a **second** read (59 ms) before
  correcting -- "one sample cannot tell a flash from the cams". A confirmed
  correction presses the monitor at +33 ms and pushes the vent light out to
  `LAST_PRESS_MS + TAP_CONTACT_MS + MONITOR_ANIM_DOWN_MS`.
- The classifier's `cams=UP-DESYNCED` question, asked of the frame the BB model
  already captured and only when it can change the decision, then the verified
  recovery: lower, wait the flip out, read the cams back (59 ms), lower once more
  if they are still up, resume from a floor with the branch's mask-off press
  skipped (`MASK_ALREADY_OFF`).
- The shell is single-threaded, so a wait blocks the whole schedule; a contact
  whose down was pushed late still gets its planned `hid_delay` length; and the
  capture latch moves with the light that actually went down.
- `desyncs -le 12`, then `exit 48`. An abort is not a survival.

And what was deliberately left out, because the runner cannot do it: the loop is
**one-directional** (it only ever asks whether the cams are up when they should
be down -- nothing in the shell detects a forcedown that left them down), it
looks **twice a cycle and nowhere else**, and it reads a **screen state, not a
toggle parity**. One optimism is stated in the model's own header: when the gate
corrects, the vent light lands ~500 ms late and the phone's classifier frame
comes out of position, which is what produced the `bbinside` and `unknown`
misreads; the wrapped pilot's BB answer is ground truth regardless, so the model
charges the correction its time but not its blindness. The reclaim below is an
upper bound on this loop.

### The result: zero, on all seven nights

| Night | exact | actuator, open loop | actuator + modelled loop | reclaim |
|---|---|---|---|---|
| 1 | 200/200 | 23/200 | **23/200** | **0** |
| 2-7 | 200/200 | 0/200 | **0/200** | **0** |

The loop is not idle while producing that. Over 200 Night 6 seeds it takes 2306
cue reads, finds and repairs 86 genuine inversions, and never corrects a monitor
that was not up. With only the corrective press removed -- every read still
taken and paid for -- those same 86 inversions reach the classifier as
`cams=UP-DESYNCED`, and survival is identical. Mean time alive: 61.9 s -> 61.7 s.

**The control that settles it.** A free, instantaneous, always-correct,
*bidirectional* repair of the pilot's monitor belief -- strictly better than
anything the shell can do, and not a model of this runner -- also changes
nothing, on any night. So the answer is not "this loop is too weak". It is that
**no monitor loop recovers the actuator cliff, because the cliff is not a
desync.**

What it is: under the actuator the camera stalls lapse and marker-122 occupants
reach the office opening at all, which the exact route never permits. Office
cues over 200 nights go **0 -> 134** (Night 1) and **0 -> 217** (Night 6), and
177/180 of those nights end in an `inside-office` death when the 45-frame
office-defense fuse expires. The loop leaves that count unchanged to the unit
(134 -> 134, 217 -> 217). The mechanism is the one the route's emitter already
documents -- the sweep must land exactly on its anchor because the stun it
refreshes bridges the five-tick mask with nothing to spare -- and 110-300 ms of
launch lateness is 7-18 frames of exactly that.

### Correction to plans/12: `--sync` was never what made the other route survive

plans/12 inferred "it is the open loop, not the phone" from
`pilottest --vent --sync` being nearly free under the same actuator. That
comparison changed the **route** as well as the loop. The same route with the
resync removed (`pilottest --vent`, unconditional monitor toggling) is equally
tolerant: 200/27/72/6/0/0/0 against `--vent --sync`'s 200/29/79/10/0/0/0 on
Nights 1-7. The tolerance belongs to that route's schedule, not to its loop. The
original bullet is kept in plans/12 with a dated retraction, because it is what
prompted the measurement that refuted it.

### The controls, and one uncomfortable one

| Control | Expected | Result (Night 6 / Night 1, 200 seeds) |
|---|---|---|
| the monitor read is always wrong | must not help | 0/200 and 2/200 -- it **hurts** (61.9 s -> 52.8 s alive), and 200/200 of its corrections are taken on a monitor that was down |
| correction removed, reads retained | must gain nothing | 0/200 and 23/200, identical to open loop; the 86/24 desyncs it declined to fix reappear at the classifier |
| the cams read as up for 600 ms after the press, so the gate samples inside the flip | must be able to **cause** desyncs | 199/200 nights desync; alive 61.7 s -> 22.6 s. Night 6-38, reproduced |
| the flip window anchored to the press's *landing* rather than its log | sensitivity of the measured 202 ms | 85/200 false corrections; alive 61.7 s -> 54.5 s |
| gate wait cut to 100 ms | -- | unchanged, and worth knowing why: `wait_until` on a past offset returns at once, so nothing can move the read earlier than the plan's own 360 ms read position. The 6-38 hazard needs the *cue* to still read up there, not a shorter wait |
| flip gate only / checkpoint only | separate the two sensors | the gate does all the work: with it on, the classifier checkpoint sees **0** desyncs; with only the checkpoint, 91 |

The uncomfortable one, recorded because it is the strongest evidence for the
mechanism: on Night 1 the two *deliberately broken* loops **improve** survival
(23/200 -> 36/200 and -> 57/200), trading `inside-office` deaths for `puppet`
deaths. A loop whose false corrections invert the monitor stops the pilot
executing the geometry that was killing it. That is not a defence of a broken
loop. It is another measurement saying the deaths are geometric.

The zero and its vacuity guard are pinned in `packages/propose/test/test-actuator.ts`:
if a future change leaves the loop with nothing to correct, the zero stops being
a result and the check fails.

## 2026-08-25: pricing the stream as the classifier's capture, and the parasite it flushed out

The question was whether a "capture stream" method can replace the last
screencap consumer -- the BB left-opening read at 225 ms. Host-side streamers
(scrcpy, minicap, adbnativeblitz) are the wrong endpoint: their advertised
latency is to the *host's* memory, and the host round trip is already measured
as disqualifying above (692-785 ms per classification, ~500 ms schedule slip).
The device-local stream already exists -- the Companion's 60 fps projection --
and the `GRID` verb already carries the whole 20x9 frame. What it did not have
was a price. `query-companion.sh latency` now times GET, GRID, and the
forked-shell baseline in one device loop:

| read, device-local, n=120 | p50 | p95 | max |
|---|---:|---:|---:|
| GET (pixel + cam5 block) | 52.9 ms | 70.2 ms | 83.8 ms |
| GRID (all 180 cells) | 52.7 ms | 68.3 ms | 73.6 ms |
| shell baseline (no socket) | 24.3 ms | 29.1 ms | 37.9 ms |

**The full sensor frame costs the same as the single pixel.** The socket
exchange and the shell's forks dominate; the 1080-character payload is noise.
So if the BB classes separate at 20x9 -- unknown, and `screencap`-frame models
cannot answer it because the VirtualDisplay scaler is a different sensor --
the BB read drops from 225 ms to the ~59 ms path with zero helper changes.
The rung ladder in `ONE-PIXEL-VISION.md` §8 applies from rung D upward;
calibration frames must come through `GRID` on the live loop.

### The 1 s read stall, and the orphaned loops that caused it

The first pricing runs showed something the repository had never measured:
**1-3% of Companion reads stalled ~1060 ms**, in both GET and GRID, and
spacing the reads 100 ms apart did not remove it (3 of 120 spaced reads
stalled). The signature -- a normal read plus almost exactly 1000 ms -- is a
TCP SYN retransmission, and `/proc/net/netstat` confirmed it: one measurement
run moved `ListenOverflows`/`ListenDrops` by +33 and `TCPSynRetrans` by +7.

The load overflowing the helper's backlog-1 accept queue was ours. `ss` caught
live `SYN-SENT` sockets and unread requests while nothing legitimate was
running, and `ps` found **seven orphaned cue-trace loops from previous runs**
still polling `GET` with stale tokens at ~14 Hz each -- roughly 100 stale
requests/second, answered `ERROR unauthorized` into `/data/local/tmp` files up
to 13.8 MB. The runner's cleanup does `rm -f` the trace file, but the loop
used **the same file as kill switch and output**, so the rm was resurrected by
the loop's own appends unless it landed in the sliver between the last append
and the next `-e` test. Nine sentinel files had accumulated; every night since
the trace feature landed ran under some number of these parasites, so any
in-run cue read -- the flip gate, the desync correction -- carried a 1-3%
chance of a ~1 s stall, and part of the documented 30-900 ms capture-pipeline
lateness may be exactly this.

The control closes it: with the loops killed and the files removed, 240 reads
moved the netstat counters by **zero** and the worst read was 83.8 ms. The
loop now gates on a `.run` sentinel it never writes, cleanup removes the
sentinel before pulling the output, the runner sweeps stale
`fnaf2-cue-*.{run,txt}` at spawn, and `test-cue-trace-loop.sh` (in
`test.ts --engine`) extracts the shipped loop and asserts the rm sticks.

Two lessons worth their space. A background loop's kill switch must be a file
the loop never writes. And a read that is scheduled against a slack budget has
a *distribution*, not a cost -- the 59 ms p95 was true and useless the moment
a 1% tail was thirty times the slack; price the tail, not the median.

## Next steps

1. Preserve the validated **BB left-opening** model boundary while recovering
   enough wind for a five-tick mask clear and timed resynchronization. The
   current 1.3 s/6.5 s wind reaches 9.5% by cycle 7 and is not extendable.
2. For **Golden Freddy** positives, either repeat Night-6 starts knowing only
   one in ten enables AI 1 before 2 AM, survive beyond 2 AM for the stable AI 3,
   or beat 6th Night and use 10/20. One translucent source frame now supports a
   provisional stop-only model, and eight independent negatives pass, but it
   still lacks an independent positive animation frame. Keep the normal
   prophylactic office mask flick; a hallway `unknown` must release the light.
3. For each target, build an `SCM1` model, require leave-one-out separation and
   zero holdout false negatives, then benchmark that exact model. Measure the
   complete `screencap | classify -> input/skip` branch inside one device shell.
4. Add visual branches only to an experimental runner. Preserve the open-loop
   runner until screenrecord grading, selected-camera trace, focus/night aborts,
   and actual capture-to-action p95 all pass.
5. Independently, phase the BB response's mask hold to the one-second tick
   boundary and re-measure; it may recover up to roughly one second but does
   not replace the missing visual evidence.

## Bookkeeping

- Captures live in `captures/` (gitignored); delete failed runs immediately —
  raw screenrecords are large.
- Developer overlays (`show_touches`, `pointer_location`) are enabled by
  default whenever `trial-maskcamp.sh` starts and remain in that state after
  the trial. Use `DEBUG_OVERLAYS=0 tools/device/trial-maskcamp.sh ...` to run
  without them.

## What an observation costs elsewhere (2026-08-26)

Literature only. **Nothing in this section was run on this handset.** The
integral report behind it is
[`docs/research/ANDROID-INPUT-AND-OBSERVATION.md`](../research/ANDROID-INPUT-AND-OBSERVATION.md)
§4, "Screen observation cost". Every
number below is someone else's device, mostly an emulator, and none of it
revises or confirms a measurement already in this file. It is here because the
question this document exists to answer — *is an observation cheap enough to
schedule?* — has a published answer in the wider Android-automation field that
this project had never looked up. The architecture survey lives in
`HID-MULTITOUCH.md` §"Prior art"; this is only about the cost of a **read**, and
deliberately does not repeat that section's comparison table.

### There is no fast, portable, lossless capture on Android

MaaFramework — the generalised successor to MaaAssistantArknights — ships its
cost model as a comment on the enum that selects a capture method, which makes
it the closest thing the field has to a published ranking. Reproduced verbatim
from
[`MaaDef.h`](https://github.com/MaaXYZ/MaaFramework/blob/main/include/MaaFramework/MaaDef.h)
[VERIFIED — read the header]:

| Method | Speed | Compatibility | Encoding | Notes |
|---|---|---|---|---|
| `EncodeToFileAndPull` | Slow | High | Lossless | |
| `Encode` | Slow | High | Lossless | |
| `RawWithGzip` | Medium | High | Lossless | |
| `RawByNetcat` | Fast | Low | Lossless | |
| `MinicapDirect` | Fast | Low | **Lossy** | |
| `MinicapStream` | Very Fast | Low | **Lossy** | |
| `EmulatorExtras` | Very Fast | Low | Lossless | Emulators only: MuMu 12, LDPlayer 9 |

Read down the Speed column against the other three and the structural fact is
plain: **every method rated better than "Medium" is either low-compatibility,
lossy, or emulator-only.** Nothing is simultaneously fast, portable and
lossless. That is not a gap in one framework's implementation — it is what the
platform offers, which is why the two genuinely fast paths in the field
(`nemu_ipc`, `ldopengl`) read a *guest* framebuffer out of shared memory and
therefore cannot exist on a physical phone at all.

The useful consequence is about our own read, and it is a reframing rather than
a new number. The Companion's 59 ms is not a better position on this ladder;
**it is not on this ladder.** Every row above captures a frame. The helper
captures a 20x9 region and answers a question. The saving is the resolution and
the round trip, not a cleverer codec, and no amount of tuning a `screencap`
would have reached it. INFERENCE, but the ladder is the evidence for it: the
field spent a decade optimising frame transport and the best portable result is
still "Medium".

### The lossy rows are a trap this project would fall into

MaaFramework excludes `MinicapDirect` and `MinicapStream` from its default set,
with the reason stated in the same comment [VERIFIED, same file]:

> Note: MinicapDirect and MinicapStream use lossy JPEG encoding, which may
> significantly reduce template matching accuracy. Not recommended.

The fastest capture in the table is disqualified because it corrupts the thing
the capture is *for*. That is this document's own rule — §"The classifier has to
be trained on the loop that will run it" — arrived at independently by a
different project. It should be read as a standing constraint on any future
attempt to make our read cheaper by streaming it: a JPEG-compressed or
resolution-scaled read is not the same observation, and swapping one in without
retraining and re-benchmarking the classifier would degrade it silently, which
is the failure mode this file has already been burned by twice.

### The OpenSTF fast paths died at Android 9, and that is why the field looks the way it does

Both of the classic "go around adb" tools have a hard ceiling, and both READMEs
say so:

- **minicap**: *"Minicap works without root if started via ADB on SDK 28
  (Android 9.0) and lower."* Also, and amusingly for a field that runs on
  emulators: *"Emulators are not supported."*
  [VERIFIED — [DeviceFarmer/minicap](https://github.com/DeviceFarmer/minicap)]
- **minitouch**: *"Minitouch can't handle Android 10 by default, due to a new
  security policy"*, needing an STFService bridge
  [VERIFIED — [DeviceFarmer/minitouch](https://github.com/DeviceFarmer/minitouch)].
  MAA's manual puts it without the hedge: *"Starting from Android 10, Minitouch
  is no longer available when SELinux is in Enforcing mode"*
  [VERIFIED — [docs.maa.plus](https://docs.maa.plus/en-us/manual/device/android.html)].

So the whole direct-`/dev/input`, direct-framebuffer era ended at Android 9, and
the field converged on `app_process` + reflection into `InputManager` (MaaTouch,
Airtest's maxtouch, scrcpy's `sdk` mode) — which is exactly the family that
`HID-MULTITOUCH.md` §"Prior art" shows is stamped `deviceId = -1`. Airtest
encodes the ceiling in code, silently rewriting `MINITOUCH` to `MAXTOUCH` at
SDK >= 29 [VERIFIED — `airtest/core/android/constant.py`]. Worth knowing before
anyone proposes minicap or minitouch here as an obvious speed-up: they are not
options on a modern handset, and our uhid route is not a variant of them.

### Actuation, for comparison, is cheap everywhere and still not free

One published measurement, and it is a weak one — a single archived repository,
benchmarked against BlueStacks, no methodology beyond a timing loop
[VERIFIED that the numbers are stated; the measurement itself is
CLAIMED and uncorroborated —
[hansalemaos/sendevent_touch](https://github.com/hansalemaos/sendevent_touch)]:

| path | cost per tap |
|---|---|
| `sendevent` | 109 ms +/- 4.6 |
| `adb shell input tap` | 197 ms +/- 1.5 |

Take the ratio, not the absolute values. It corroborates the reason this project
stopped shelling out to `input` — roughly 200 ms for a tap, dominated by process
startup rather than by the touch — and it says the best a *shell-mediated*
actuator does is about half that. Neither number is a target for `hid-multi`,
which does not pay a shell at all.

`UNKNOWN(no published figure found)` for the cost of a single uhid report on any
Android device. The field does not use uhid for touch, so nobody has measured
it, and the only per-report reasoning located anywhere is phisap's arithmetic
for a *different* transport: 50-byte HID reports at 1 kHz is 50 KB/s, "far below
USB 1.0", so it expected no transport-level delay — an expectation its author
explicitly never confirmed
([`hid.md`](https://github.com/kvarenzn/phisap/blob/dev/hid.md), VERIFIED).

### One technique worth stealing: discard the stale frame

FGA captures on-device through MediaProjection and, per its architecture notes,
does two things this project does not: it wraps the `ImageReader` buffer in an
OpenCV `Mat` **without copying**, and it runs a two-buffer queue calling
`acquireLatestImage()` **to discard stale frames**
[CLAIMED — [DeepWiki summary of FGA](https://deepwiki.com/Fate-Grand-Automata/FGA/4-android-services);
I did not read FGA's source, so treat the mechanism as reported, not verified].

The second half is the interesting one, and it names a control this project is
missing. Our helper returns whatever the capture pipeline last produced; it has
no notion of a frame being too old to answer with. The 30-900 ms
capture-pipeline lateness recorded above, and the 1 s stalls traced to the
orphaned trace loops, are both cases where **a read returned a truthful answer
about the wrong moment** — and a staleness bound is the standard defence against
exactly that. This is a design note, not a finding: no measurement here says the
Companion is currently returning stale frames, and adding a staleness check
would itself need pricing against the 680 ms budget before it went near the
loop. It belongs on the list in §"Next steps", not in the loop.

### Reads that break without erroring, on someone else's handset

Two portability failures reported by projects large enough to have hit them
across many devices. Both are the same shape as this file's recurring lesson —
an instrument that answers confidently while being wrong:

- **Dark mode.** Alas's wiki advises turning the phone's dark mode off, because
  on some handsets it shifts in-game colours enough to break screenshot
  matching [VERIFIED —
  [Emulator_cn](https://github.com/LmeSzinc/AzurLaneAutoScript/wiki/Emulator_cn)].
  A vendor theme silently recolouring the frame under a colour-threshold
  classifier is a failure this project's 20x9 regions would be fully exposed to
  and would have no way to notice.
- **Resolution as a hard precondition.** Alas requires exactly 1280x720 and
  errors on anything else; MAA supports 16:9 only and warns that force-changing
  a device's resolution *"may cause the device to malfunction"* [VERIFIED — same
  wiki, and [docs.maa.plus](https://docs.maa.plus/en-us/manual/device/android.html)].
  Both chose to fail loudly rather than scale, which is the right call and the
  one this project already makes elsewhere.

Neither is an argument for doing anything today — this project runs one handset
and pins its geometry. They are the two things that would break first if a
second handset ever entered, and they are cheap to write down now and expensive
to rediscover.

### What this section does not say

It does not say our reads are fast, because nothing here measured them. It says
the ladder the field climbed tops out at "Medium" for a portable lossless frame,
that the two historical shortcuts are unavailable on a modern handset, and that
the one borrowable idea is a staleness bound we do not have. Every figure above
is another project's device; the only numbers in this file that describe *this*
phone are the ones measured on it.

## Which anchor survives a point-sampling sensor (2026-08-26)

The Companion's `20x9` grid **point-samples ~180 source pixels**; it is not a
small image of the screen. `ONE-PIXEL-VISION.md` §3 carries the measurement and
the correction it forced. This section is the consequence for classifiers: it
prices every anchor this project has considered for "is the office visible?"
against that sensor, on the sensor itself.

Measured on the phone. Every camera was selected in turn and the helper's own
grid read; `screenstate.py` confirmed the game was alive before each reading,
and a sweep that found anything else was discarded rather than reported. An
earlier pass of this same sweep was run without that check, died to a music-box
kill partway through, and produced twelve readings off a dead game at the menu.
Those numbers were void and are not in this table. **A sweep that does not
check it is alive between steps is not a sweep, it is a transcript.**

| anchor | monitor up (12 cameras) | office (4 variants) | verdict |
|---|---|---|---|
| **near-grey cell count / 180** | **173 - 180** | **142 - 145** | **SEPARABLE, margin 28** |
| mean saturation | 0.5 - 13.4 | 13.5 - 14.9 | separable by 0.1 -- unusable |
| max yellowness `min(r,g)-b` | 0 - 194 | 47 | **OVERLAP** |
| mean luma | 3.8 - 63.1 | 28.6 - 35.6 | **OVERLAP** |

Office variants: plain (night 1), plain (night 2), hall light held, left vent
light held. A cell counts as near-grey when `max(r,g,b) - min(r,g,b) < 25`.

Two of those rows are anchors this project actively wanted to be true.

- **The yellow selected-camera button does not work**, and not because the
  threshold is wrong. At full resolution the button is present on 12/12
  cameras; the helper sees it on 7/12, at yellowness 194 or 0-10 with nothing
  in between. On the five it misses, the office scores *higher* (47) than the
  camera -- the classifier is not merely blind there, it is **inverted**.
- **Mean luma cannot separate the two states at all.** The ranges overlap: the
  darkest camera (CAM 10, 3.8) and the brightest (CAM 07, 63.1) straddle every
  office reading. This is the sensor-level reason the existing luma fast path
  had to be backstopped rather than trusted.

The grey-cell count works because it is a **whole-frame statistic**. It
aggregates all 180 samples, so no individual sample's position can defeat it --
which is exactly the property a point-sampling sensor demands. Physically: a
camera feed is a desaturated greyscale static image filling the screen, while
the office is coloured (the purple `CELEBRATE!` poster, the orange hall light,
warm wood). It held across both nights tested and every light state.

### What it actually answers, and the seam it still closes

The anchor answers **"is the office visible?"**, not "is the monitor up?". The
mask reads **175 grey cells**, inside the monitor-up band -- mask and monitor
both mean *not office*. Do not read this field as a monitor-state oracle.

It still closes the desync seam that costs the most, because of *when* it is
read. The catalogued failure is a monitor press within 180 ms of a mask press
being dropped, since the monitor bar is not drawn while the mask is up (9 of 14
desyncs; see §"Which press desyncs, and why"). Evaluated after the mask comes
down, there is no ambiguity left: office means the press was lost, not-office
means it landed. Combined with the standing rule never to observe the monitor
inside `MONITOR_ANIM_DOWN` (367 ms) of a monitor press, that is a usable
verified-recovery check.

It costs nothing. The helper already builds `snapshotGrid` every frame in the
same `ImageReader` callback; counting near-grey cells is one comparison per
cell inside a loop that already runs.

### Confirmed live, and two traps in measuring it (2026-08-26)

The rebuilt helper was installed and read on the phone: `grey=178` appears in
the snapshot line between `cam5=` and `ageUs=`, as designed.

**Trap 1 -- `grey=` is high on the title screen too.** That live reading of 178
was taken at the FNaF title, which is inside the monitor-up band (173-180). The
title is a desaturated static image, so this is the anchor working as specified
rather than a defect: the field answers *"is the office visible?"* and the title
is not the office. It means `grey=` must never be read as "the monitor is up"
without the game state already being known to be a night. `screenstate.py`
remains the authority on that.

**Trap 2 -- do not price the helper with `query-companion.sh`.** Timed from
the host it takes **~429 ms** per call, which looks catastrophic next to a
225 ms `screencap` and is the wrong comparison. That script is a host-side
one-off tool: transport detection, forward setup, and several USB round-trips,
where a bare `adb shell echo hi` alone measures **76 ms** on this handset.
The runner never uses it in the loop. `trial.sh` is pushed to
`/data/local/tmp` and executes **on the phone** -- which is why `cue_snapshot()`
is `toybox nc 127.0.0.1 $CUE_PORT` with no `adb` in front, and why its presses
are bare `input tap`. The in-loop read is the documented **59 ms device-local**
cost, and `screencap`'s 225 ms is device-local too, so those two are
comparable and the 429 ms is not.

This was measured wrongly twice in one session before it was measured right --
first against the script's usage-error path (43 ms, no query performed at all),
then against the host wrapper (429 ms). **A capture cost is only meaningful with
the transport named**, which is what `sensor.py` exists to declare.

### What is not yet controlled

Honest limits on the numbers above, so the next session does not over-trust
them:

- The office samples cover four variants on two nights, all with **no
  animatronic in the office**. An animatronic present is the state that most
  plausibly moves the grey count, and it is untested. The repository has no
  frame of one: every `-inside` label in `captures/screencheck-keep/` is a
  pan-induced false positive on an empty office.
- The **blackout** state (office lights out with an animatronic inside during a
  masking response) is untested and is exactly where a grey count could rise
  into the monitor-up band.
- The threshold is not calibrated. The measured gap is 145 -> 173; the midpoint
  is ~159, but two clusters of five samples do not fix a boundary. Treat 159 as
  a starting point to be replayed against labelled holdouts, per
  `ONE-PIXEL-VISION.md` §7.

## An animatronic in the office, measured at last (2026-08-26)

The control this repository never had. Every prior `inside` label in
`captures/screencheck-keep/` is a false positive on an empty office, so every
claim about how the classifiers behave with an occupant was untested. Pedro
found her by eye in the cleared `n1-grey-2202` recording at 06:23-06:24 --
**Toy Chica, right hallway, flashlight on, 5 AM.**

| frame | grey/180 | saturated-yellow px | max yellowness |
|---|---:|---:|---:|
| **Toy Chica in the office** (383.5 s) | **150** | **7** | 67 |
| empty hallway (188.0 s) | 156 | 0 | 30 |
| a lit camera button, for scale | - | 1064-2165 | 163-194 |

Two questions that had been open all day, both answered no:

- **A yellow animatronic does not trip the selected-camera yellow anchor.**
  Seven pixels against a button's thousand. Her plumage is muted and shaded
  under the flashlight, so blue never falls far enough below red and green.
  The same reasoning covers Golden Freddy, who is duller still -- untested.
- **An occupant does not push the grey-cell count into the monitor-up band.**
  150 against a 173-180 band; she *lowers* it slightly, by adding saturated
  colour to an otherwise desaturated scene.

Read these as relative, not absolute: they come from 1280x576 `screenrecord`
frames whose chroma is crushed, not from the helper's own grid. The ordering
is what transfers.

**How she got there, and it is the same defect Toy Bonnie's cage was.**
`sweepcheck.py` reports 68/75 sweeps flashing all of 10,4,7. The seven misses
are not random: **five of them missed CAM 07** (sweeps 7, 49, 53, 59, 65), two
missed CAM 10, and CAM 04 was never missed. The sweep order is 10 -> 4 -> 7, so
the failure sits on the **last flash**.

CAM 07 is Toy Chica's sourced repel destination ("TC CAM 07",
`ANDROID-SOURCE-STATUS.md:173`). CAM 04 is where Toy Bonnie sat, and it never
lost a flash in 75 sweeps -- which is why he was pinned all night at
STUN_FRAMES = 400 (6.67 s) against a ~5 s cycle, and why she was not. One
unreliable actuator step explains both observations.

**So the sweep's last flash is a real defect, not a rounding error**, and it is
worth more than any elegance saving on this night: the sweep is what suppresses
the Toys, and its least reliable step is aimed at the camera one of them lives
on.

### The last flash: a mechanism, and the control that is missing

Why CAM 07 and not the others. `SWEEP_LIGHT_LEAD_MS` is 0 in the shipped
geometry, so a camera's select and its light are the **same contact**, held
`PLAN_CONTACT_MS` = 100 ms at `PLAN_SPACING_MS` = 120 ms spacing. That leaves
**20 ms of released time** between cameras, and Fusion polls touch per frame
(~16.7 ms at 60 fps) -- barely over one frame. The hypothesis is a **dropped
selection**, not a mistimed light: if CAM 07's select is swallowed, CAM 04
stays selected and absorbs the pulse.

Consistent with the data, and NOT established by it:

| | n | CAM 04 lit frames (median / mean) |
|---|---:|---|
| sweeps where CAM 07 lit | 70 | 7.0 / 8.3 |
| sweeps where CAM 07 missed | **5** | 10.0 / 9.2 |

The direction is the predicted one. Five samples cannot carry it, and a
favourable number with n=5 is precisely what this repository's rules say to
distrust.

**The control that would settle it was not recorded.** `n1-grey-2202` reports
`hid trace: MISSING (run with HID_TRACE_RUN=1)`. `test-hid-trace.ts` audits
what the phone was *sent*; `sweepcheck.py` reports what the game *did*. Only
both together separate "the press never went out" from "it went out and Fusion
swallowed it" -- and those have opposite fixes. **Any further Night 1 run must
set `HID_TRACE_RUN=1`.**

If the trace shows all three sent, the released gap is the suspect and the
repair is geometric: 100 ms of contact plus a 33 ms released gap is 133 ms of
spacing, not 120. That moves the cycle and must be re-gated at 1200 seeds
rather than assumed -- and note the 120 ms figure was proven 4/4 by
`hid-sweep-probe.sh`, which audits the *stream*, not the game's acceptance.

### The traced control, and the 133 ms repair (2026-08-27)

`n1-elegant-0055` supplied the missing control. Its HID trace contains 42
contacts apiece for CAM 10, CAM 04 and CAM 07. Every contact is 100 ms, every
one overlaps the camera-light contact for the full 100 ms, and the trace auditor
finds no short, latched or malformed report. The host therefore sent the final
CAM 07 contact on every attempted sweep.

At the recording's native frame cadence, the selected-button trace has one
plausible missing CAM 07 transition around video time 238 s. That is consistent
with Fusion swallowing a selection after only 20 ms released, but it remains a
hypothesis: a rendered highlight does not expose the internal `lit?` value or
the character/marker overlap that actually applies a stun. Feed brightness is
still inadmissible for this question.

The avoidable timing risk is closed independently of that attribution. The
device emitter now uses **133 ms selection spacing**: the proven 100 ms shared
select/light contact, followed by one complete 33 ms released Fusion poll. The
policy remains modelled at 120 ms. Widening is applied only by `devicePlan()`,
which starts a three-camera sweep 26 ms earlier and leaves its end fixed. The
elastic wind before it pays 16 ms so the sweep also retains a full-poll approach
gap. Generated story-night plans replay exactly 100/100, and their +/-60 ms
human gates are respectively **1200, 796, 951, 886, 744 and 648 of 1200** for
Nights 1-6, all above the unchanged 480/1200 contract.

### The LIGHT_AFTER geometry's CAM 07, traced (2026-08-27, `n2-la-212912`)

Same question for the decoupled 66/33 slot-50 LIGHT_AFTER sweep, from the
first graded Night 2. The HID trace holds **38 CAM 07 bursts, every one
structurally identical**: a 17 ms select contact, a 17 ms released settle gap,
then a 33 ms light contact — no short, latched, malformed or missing report.
The host sent a correctly decoupled lit CAM 07 on every sweep of the run.
camtrace corroborates the select half: the `viewing`-driven button highlight
(g46-57) registered on all 38. So **there was no host-side lit-miss** — not a
dropped selection, not a dropped light, not a compressed gap.

What remains unobservable is the same gap as the 100 ms case: whether CAM 07
rendered `lit? == 1` for those frames and whether the per-frame stun poll
(g450-455) caught it. `sweepcheck.py` is the only frame instrument and it is
**inadmissible for CAM 07** — Main Hall is near-black, the camera-switch tear
puts white bands at 180-213 where a clean lit feed reads ~108, and the 2-4
torn flash frames overlap both verdicts. A hand zoom of the feed-centre crop
at five sweeps (t ≈ 34, 40, 65, 96, 130 s; the 96 s strip clearly shows Toy
Chica's face on the feed, so she was present and on the swept camera) shows
only tear — no eyeball-distinguishable flash frame either way. Its "26/36
sweeps lit … FAILED" line in `grade-run.sh` is measuring tear, not the flash,
and should not be read as a lit-miss count.

The lit-miss was the wrong question. The sim (`modelGate`, night 2, 1200
seeds) says at zero jitter every geometry stuns every toy and Toy Chica never
escapes; under ±30-60 ms the sweep's **last slot** leaks ~12-30% whatever
camera sits there, because the ~200 ms sweep lands up to 150 ms late (this
run's drift) and a 33 ms light on the last, most-delayed slot often arrives
after its target took the 5 s move. A 67 ms light closes it. See
`plans/PROGRESS.md` "The stun needs no minimum lit time". So the Night 2
escape is consistent with **zero lit-misses and a timing-window miss on one
late sweep** — after which nothing covers her (CAM 01, CAM 05 unswept).

### Why no instrument found her, and what to change

Two scans failed before Pedro pointed at the timestamp, and both failures are
worth keeping:

- A hallway scan filtered for a **dark** hall (`mean < 60`). She is only ever
  visible when the hall is **lit** -- the flashlight is what reveals her -- so
  the filter excluded every frame that could contain her.
- A variance scan rejected frames carrying white bands as "torn". Those bands
  are not decode damage, and rejecting them discarded the frame where Toy
  Bonnie was visible. Three explanations for them were measured and refuted:
  not the Companion (the run without it bands *more*, 34.7% vs 27.7%), not the
  "lost signal" cue (that is a dark camera carrying text), and not the
  camera-switch animation (they are uniform across cycle phase at a ~0.2-0.3 s
  period, not twice per 5 s cycle). **Do not filter on them, and do not use
  per-frame variance on this footage.**

### The localized last-slot 67 ms light, gated (2026-08-27, `853f8bc`)

The repair the section above names -- "A 67 ms light closes it" -- is now
expressible without widening the whole sweep. `devicePlan` takes
`sweepLastContactMs`; the plan's sweep line carries the override as a `:N`
suffix on the last camera (`10,4,7:67`), and `replay` plus the device runner
hold only that slot's light the longer time. Geometry stays LIGHT_AFTER --
decided by the base contact (33), not this slot's -- so the 67 ms last flash is
still select + settle + hold, not the legacy same-report press.
`recipe.mjs --device-plan --sweep-last-contact-ms=67`.

**Gated 1200 seeds, and scrutinised** (Pedro: "surprising results fall under
scrutiny"). Config `66/33 slot50 last67` -- the `n2-la-212912` device geometry
plus the localized fix -- against the shipped `133/100`:

| | shipped rl550 | last67 rl550 | shipped **rl480** | last67 **rl480** |
|---|---|---|---|---|
| n2 | 67 | 79 | 66 | 78 |
| n5 | 61 | 74 | 62 | 72 |
| n6 | 59 | 72 | 42 | 46 |
| n7 | 32 | 18 | 15 | 4 |

*(correlated slack, `modelGate` via `recipe.mjs` `replay`.)*

- **n2 and n5: a robust +10-12.** It holds at the pinned rl480 actuator, holds
  under `iid` as well as `correlated`, and is a **basin, not a phase-lock
  spike** -- +-6 ms device-spacing perturbation keeps n6 71-76, and the model
  slot is a smooth gradient (best 33-50 ms, gentle decline to 83) with no
  cliff. It is mechanism-grounded: 67 ms is 4 lit frames against 33 ms's 2, so
  the last, most-drift-delayed flash covers a wider window before its target
  takes the 5 s move. This is the first geometry lever here that is not a
  +-few-ms spike.
- **n6's +13 at rl550 is mostly a gate artifact** -- only +4 at rl480, the
  actuator `hidpilot n6 target` is pinned to. n6 -> 70 % is not delivered.
- **n7 is broken deterministically, and the last-slot 67 ms does not touch
  it.** *Any* LIGHT_AFTER base-33 sweep -- with or without the longer last
  slot, at the shipped model layout or the narrow one -- fails the n7 schedule
  at **zero jitter** (27/400 at slot 50, 0/400 at slot 120; Toy Bonnie and Foxy
  flood the office). n7 stays a device-time problem, exactly as plan 16
  concluded. The `n7 18` gate figure is a broken schedule, not the jitter
  fragility the rest of the sub-70 ladder is.

So the localized 67 ms is a real **n2/n5** simulator lever worth a device
probe -- does the last-slot leak, and its 67 ms repair, behave on the phone as
in the model -- but it is **not** "the sub-70 nights solved" and must not ship
as n7's geometry.

**Parked, flagged for a later session.** A neighbouring config,
`--device-spacing-ms=100 --sweep-contact-ms=67`, reads correlated **n7 ≈ 50-63**
-- flat across model slot 42-83, holding at rl480 (n7 50). Taken at face value
that breaks plan 16's "n5/n6/n7 need new device time" conclusion and
contradicts `devicetimesearch`'s "emit spacing ~103 -> n7 32 phase break". But
`sweepContactMs = 67` is `>= 50`, so it is the **legacy** geometry: `replay`
holds the light `f(100)` regardless of the emitted 67, while the emitter
anchors the sweep end on `sweepCamMs(67)`. That 33 ms emit/replay mismatch is
the likely source of the n7 number -- a model inconsistency, not a lever. It
was found in passing while measuring the localized fix and is not chased here;
untangle the legacy-path contact semantics before trusting it.

## The Companion runs concurrently with the sweep without degrading it (2026-08-27)

The old worry, from the `screencap` era: a second capture pipeline contends
with the game's rendering. Per-frame `screencap` from the night watchdog
"more than doubled" its own capture time and read `unknown` on 7 of 8 cycles
(night 6-23). The Companion uses a *continuous* MediaProjection
VirtualDisplay instead, and it had never been measured against a live sweep.

Measured on the Moto g56 (`<serial>`), with the helper capturing
(`control=READY`, consent granted) through three 25-sweep c33 LIGHT_AFTER
probe runs -- `c33cc-dark` / `c33cc-stable` / `c33cc-alt` -- while
`screenrecord` also ran:

| signal | solo | with the helper capturing |
|---|---|---|
| sweepcheck flash rate (all-lit) | 23-24 / 25 | **23-24 / 25** -- unchanged |
| ALT_LIGHT discrimination | 25 / 25 self-calibrated | **25 / 25** self-calibrated |
| camtrace complete sweeps | 11-13 / 25 | 10-13 / 25 (one dark run 5 incomplete vs 2) |
| helper `readAgeUs` during the run | -- | n=364, p50 **1.7 ms**, p95 **3.4 ms**, max 4.6 ms |

The helper's own reads stay sub-frame throughout; the sweep's flash rate does
not move. The only visible cost is a marginally higher camtrace
incomplete-sweep count on one run, which is at the resolution floor for a
67 ms/camera sweep and does not change any verdict.

One consequence for grading. sweepcheck's per-camera signature **shifts**
when the helper is running -- `c33cc-alt` recalibrates CAM 07 to
`bf>=0.6, pve>=3.25, rv<=43` where the solo `c33-alt` gave
`bf>=0.28, pve>=4.25, rv<=55`. Each is per-camera perfect on its own run and
each leaks ~3/25 on the other. So a real night (helper always running) must
be graded against a signature recalibrated from an `ALT_LIGHT` run recorded
**in the same session, with the helper up** -- not the bundled solo one.

## A second device policy: Minus Toys, wired into the same runner (2026-08-28)

Until now `trial.sh` emitted only Minus 7 (`recipe.mjs --device-plan`). The
Minus Toys engine result (plan 02 pkg 2a; `packages/propose/bin/minustoystest.ts`, 200/200
normal + 100/100 worst per night, 0/200 no-split control) existed only as an
engine schedule. `packages/propose/bin/plans/minus-toys-plan.ts` ports it into the on-phone
interpreter's plan format and `DEVICE_POLICY=minus-toys tools/device/trial.sh`
runs it through the **same** title-safe, epoch-latched, watchdog-guarded runner
-- not a second execution path.

What the port is:

- **An opening cycle** (`#cycle opening`) that arms the split before 0:05 --
  establish CAM 11 as `viewing`, tap CAM 09, leave one released Fusion poll,
  drop and re-raise the monitor. This is the geometry
  `captures/n2-doublecam-hid-0003` hit once by hand, now scheduled: CAM 09 and
  the monitor land 50 ms apart.
- **A repeating 10 s cycle** (`#cycle toys`): mask through the fifth global
  one-second tick, a 33 ms hall flash to reset Foxy, raise, a 100 ms `ventl`
  pulse to refresh the glitched CAM 09 stun, ~3.25 s of wind, then `camdrop`
  (hold the feed light, tap the monitor down through it, keep the light on) to
  exit while the stun is still refreshing.

New runner pieces, all mock-gated (no phone):

- `NIGHT6_LEFT=2` driver branch in `trial/12-night-loop.sh` -- no BB read, no
  branch: the opening stepped (its wind absorbs the epoch slip), then
  `run_macro toys` every 10 s.
- A `camdrop` instruction in the plan interpreter (`plan_step` / `plan_span` /
  `plan_emit`), spanning light-lead + monitor-contact + light-tail.
- The CAM 09 coordinate threaded through the driver's positional argument
  header (`trial/01-arguments.sh`, `plan_control_xy`).
- The gate: `minus-toys-plan.mjs --night=N --gate` replaces `human-gate.ts`
  for this policy and runs before the first adb command.
- `04-session.sh`'s epoch centring stays Minus-7-only: the published route's
  phase window is one-sided (tolerates a late T0, almost no early one), so the
  conservative first-positive edge is correct for it.

**Two bugs in the first draft were caught by the new tests, not the phone:**

1. A `hold light` loop row. `plan_control_xy` has no `light` control -- the
   camera-feed light is `ventl` -- so the run would have aborted at exit 47.
   Fixed to `hold ventl`, with `replay()` mapping `ventl` -> the engine's
   `light` action.
2. The 350 ms scalar human-floor (`trial/05-press.sh`) only stood down for
   `NIGHT6_LEFT=1`. On the model-gated Minus Toys route it aborts at exit 44 on
   the deliberate 50 ms CAM 09 -> monitor arming gap. Fixed: the floor stands
   down for every model-gated plan path (`1|2`); only the dormant unpriced
   route (`0`) still gets the scalar.

`test-minus-toys-plan.ts` gates the ported schedule (survival + split armed +
control + emitted-plan shape + every kind/control implemented);
`test-plan-interpreter.sh` runs the emitted plan through the shipped interpreter
functions (camdrop span, the opening resolving every control, the toys macro's
contact starts matching the plan) and pins the `NIGHT6_LEFT=2` floor arm.

**~~Not yet run on the phone.~~** *(Superseded the same day -- it was run, and it
died. See "The Minus Toys open-loop policy is refuted on the phone" immediately
below. Kept per the retractions rule.)* The remaining claims are all device:
does the scheduled 50 ms geometry reproduce the split, does a held glitched
CAM 09 light actually hold the Toys across a full night, and does the geometry
survive real actuator jitter. First run is a graded Night 2 via the Continue
cursor with `HID_TRACE_RUN=1`.

## The Minus Toys open-loop policy is refuted on the phone (2026-08-28, `n2-minustoys-0117`)

First graded device run of `DEVICE_POLICY=minus-toys`: Moto g56, Night 2 via
the Continue cursor, `HID_TRACE_RUN=1`, graded through `grade-run.sh`. **It
died at ~188 s -- between 2 AM and 3 AM -- to Balloon Boy walking into the
office, then a Foxy jumpscare.** Pedro's eyewitness: *"bb walked in while the
bot was on the monitor."* The retained keyframes show Balloon Boy standing in
the office at 177 s and the withered-Foxy jumpscare at ~198 s; the run aborted
on focus loss at ~203 s (`captures/n2-minustoys-0117-aborted.mp4`).

### What worked

- **The monitor/mask model held with zero desync for the whole graded
  interval** (`desync-scan.py`: every monitor and mask toggle agreed with the
  game). The phone delivered the monitor/mask schedule at the toggle level.
- **The Toys stayed on the Show Stage.** `camtrace.py` shows CAM 11 as the
  viewed feed ~3.6 s in every 10 s cycle, and no instrument -- and no retained
  frame -- caught a Toy in the office. The split appears to have held them.
- `screenstate.py`: ALIVE for at least 180 s.

### What broke -- the arming geometry, in the HID trace

The opening's `833 cam9` -> `883 monitor` pair carries **17 ms of planned
released time**: that is the split-arming geometry (tap CAM 09, leave one
released poll, drop the monitor before g263's 200 ms sample). The trace reports
that pair delivered with **0 ms released time** (`only 0 ms released between
[cam9] and [monitor] at 1400 ms`) -- Fusion saw one finger dragging from the
CAM 09 button to the monitor button, not two taps. The 17 ms margin collapsed
under actuator jitter. **Whether the split actually armed is unmeasurable
here:** `camtrace` reads the `viewing`-driven button highlight; nothing in this
repository reads the `your view` marker, which is the other half of the split.

### Two instrument problems this run exposed, both open

- **`test-hid-trace.ts` FAILED with "98 problems"** because its contact-length
  floor is 100 ms -- a Minus 7 assumption. The Minus Toys plan deliberately
  uses 33 ms contacts (the g56 "33 ms registers for every touch control"
  finding, CLAUDE.md). Every 33 ms contact reads as a violation. This is a
  stale-auditor false alarm for this policy, not a defect in the run. The
  auditor's floor needs to become policy-aware, or drop to the ~33 ms the phone
  actually registers.
- **The recording captured at 59 fps, not 60.** `grade-run.sh` warns the
  graders must be re-run at 59 -- decoding a 59 fps recording at 60 reports
  short events as dropped, which is exactly how the withdrawn 240 ms spacing
  figure was once produced. The verdicts above survive that caveat but any
  frame-count figure off this recording does not.

### Why the model said 200/200 -- and what it was hiding

The gate (`minus-toys-plan.mjs --gate`) checks `sim.won && splitAt >= 0` --
survival and split-armed, **not margin**. Night 2 is 200/200 in the
deterministic engine. Measured this session, with the engine:

- **The mask window has a ~300-500 ms cliff.** Shrinking the mask-ON window by
  +-200 ms: still 300/300. By **+-500 ms: 35/300**, of which ~190 are
  `BB-inside -> foxy`.
- **The mechanism, from a single-seed trace.** Balloon Boy hops into the left
  vent right after a monitor raise (his hop latches to the next cams-up,
  `camsUpCount = K`). The fixed cadence gives him ~10 s before the next raise;
  it masks him for ~5 of those and he leaves at **~9 s -- a ~1 second margin**.
  Lose a second of effective mask time and the next scheduled raise catches
  him: `onCamsUp` (`engine.js:739`) sets `bb.inside`; `hallLightOn` then
  requires `!bb.inside`, so the 33 ms hall pulse stops resetting Foxy; Foxy
  locks on. The cadence never reaches more than **4** `maskTicks` against a
  `VENT_MASK_TICKS = 5` repel threshold -- it never *cleanly* evicts Balloon
  Boy, it relies entirely on the 10 %/tick `VENT_EARLY_LEAVE_CHANCE` roll.
- **The per-instruction margin map** (`packages/propose/bin/plans/minus-toys-margin.ts`,
  Night 2, 120 seeds, model only, no jitter -- it shifts one press in isolation
  and reports how far it can move before some seed dies):

  | instruction | early | late |
  |---|---|---|
  | **whole-schedule phase** (epoch/T0 error) | **33 ms** | **99 ms** |
  | opening CAM 09 tap / the monitor tap after it (the arming pair) | 33 ms | 33 ms |
  | loop mask toggle | 198 ms | 66-165 ms |
  | loop monitor raise | >528 ms | 198 ms |
  | loop `ventl` stun refresh | 198 ms | 231 ms |
  | loop `camdrop` exit | 231 ms | 363 ms |
  | everything else | >528 ms | >528 ms |

  The whole-schedule phase tolerance is **33 ms early / 99 ms late** against an
  epoch-latch bracket the run measured at **302 ms** -- the alignment error is
  three to nine times the margin before a single press has jittered. The
  arming pair's 33 ms each way is one Fusion poll, and it is exactly the gap
  that collapsed to 0 ms in the HID trace. Night 4 has the same shape. The
  tool's own printed verdict: *"A fixed cadence anchored to T0 cannot hold it
  on a device whose epoch latch alone is uncertain by ~300 ms."*
- **Under a full clock-error model it collapses.** Model: epoch phase error
  +-150 ms (the run reported a **302 ms** epoch bracket), game-vs-wall drift
  -184 ms/min (the run's own drift trace), per-press jitter sigma 29 ms (p95
  57 ms, measured). Night 2 goes **600/600 (perfect clock) -> 127/600
  (phone-like)**; Nights 3-5 -> **0/600**. The dominant death shifts to the
  **Puppet** -- the drift walks the *wind* phase, the box empties (343/600 on
  Night 2) -- then Toys-in-office, then Foxy. **Re-anchoring the loop phase to
  the AM digit every 70 s** recovers it to N2 178, N3 211, N4 159, N5 101 of
  600 -- necessary, not sufficient.

  **2026-09-05 provenance correction:** the 29 ms parameter is sourced by
  `minus-toys-jitter.ts` to a *per-anchor drift residual*. `drifttrace.mjs`
  pairs driver marks preceding reports, not input event IDs with app receipt;
  it does not measure command-to-game-effect latency. Treat this Gaussian
  per-row ensemble as a sensitivity assumption, not a measured per-press
  dispatch distribution or proof that actuator jitter alone blocks the route.
  The current calibration clock audit and qualification hold are recorded in
  [Plan progress](../../plans/PROGRESS.md).

### This is the margin the strategy write-up already predicted

`docs/strategy/MINUS-3-STRATEGY.md` sec.3 states Minus Toys' error budget is
**~0.66 s per cycle**, and sec.5 that the family is *"timer-anchored on the 5 s
intervals."* The device port is anchored to `T0` (the first office-HUD frame),
not to the game's :X0/:X5 Golden-Freddy-interval phase, and it makes one camera
visit per 10 s where the published routine makes two (exits at :X4 *and* :X9).
The 302 ms epoch bracket alone spends nearly half the strategy's entire margin
before the night starts. On Night 2 specifically the GF-interval rule is moot
(Golden Freddy office AI is 0 below Night 6, `g804`); the phase that bites early
is mask-vs-Balloon-Boy and wind-vs-Puppet.

### What the mapped bots say about the way out

A research pass this session over `docs/research/FNAF-BOT-CENSUS.md`,
`docs/research/FNAF-BOT-IMPLEMENTATION-COMPARISON.md`,
`docs/in-engine/SHOOTER25-*.md` and `docs/research/ANDROID-BOT-LANDSCAPE.md`:

- **No external screen-reading FNaF 2 bot solves live game-clock sync.**
  `jasonclone/fnaf2bot` -- the only external bot documented to react to the
  blackout, and it does so by fixed-coordinate pixels -- caps at *"around 1 in
  3"* on 10/20, and its documented weakness is this run verbatim: *"timers
  substitute for a mechanics model, so late detections can perturb later phases
  without a principled recovery state."*
- **phisap** (external, physical Android touchscreen, real-time -- the direct
  precedent) never solved live sync: its timer is *"started by a human pressing
  space,"* and the class conclusion is *"the only real-time bots that work read
  the chart file and replay a pre-computed schedule. They never sample the
  screen."*
- **The only demonstrated-reliable approach is in-process internal-state
  reading.** Shooter25's practice-mod bot went 104 wins / 1 death reading
  `in danger` / `blackout` / the music-box counter directly, frame-locked
  because it *is* the game process.
- The repo's own bottom line (`docs/research/README.md`): *"no measured
  closed-loop latency for any reactive bot on any physical handset, published
  anywhere."*

### Conclusion

**The pure open-loop Minus Toys device policy is refuted -- at exactly the
margin its own write-up predicts.** It is not viable as shipped. The
engine-model result (200/200) is not wrong; it is a model result that does not
transfer, and the gate needs a margin check so a 300 ms cliff cannot hide
behind "200/200" again.

Two forward paths, neither built:

1. **External hybrid.** Keep the timed skeleton but add: an AM-digit clock
   re-anchor every 70 s, a reactive left-vent Balloon-Boy read (the Minus 7
   runner already has this), and mask verify-and-retry (jasonclone has this,
   this runner does not). Ceiling ~1/3, per jasonclone and the AM-anchor sim.
2. **In-APK read-internal-state** (`plans/17`). The only approach with
   demonstrated reliability; the clock-sync problem disappears because the bot
   runs on the game's own tick.

The `n2-minustoys-0117` artifacts (aborted mp4, hid jsonl, run log, session
manifest) are in the gitignored `captures/` corpus.

### Qualification: Night 1 calibration did not reproduce drift or desync (2026-08-29)

`n1-minustoys-calib-01` held the split for about five minutes on the same g56:
CAM 09 was co-lit in 99.5% of monitor-up windows, `desync-scan.py` found 0/31
monitor-up failures, and the AM-digit / map-cycle clocks showed no measurable
drift. This does **not** overturn the graded Night 2 failure: Night 1 has no
forcedowns, mask churn, or reactive corrections, and the calibration never
directly viewed the Show Stage to prove a glitched Toy stun. It removes the
claim that drift is established for every run and sets the next gate: run the
same instrumentation observe-only on Night 5 or 7 before promoting any
open-loop or reactive policy. The current strategy record is
[`MINUS-3-STRATEGY.md`](../strategy/MINUS-3-STRATEGY.md) §9.

### The `--minimal` split arm is non-deterministic, and a missed arm kills (2026-08-29)

Two full runs of `minus-toys-plan.mjs --night=1 --minimal` on the g56 /
2.0.7+26, back to back, from a **byte-identical** emitted opening
(`115000 monitor` / `115300 cam11` / `115833 cam9` / `115883 monitor` /
`116616 monitor`; the arm taps are 33 ms contacts), same env
(`PILOT_OFFSET_MS=175`):

- `n1-minustoys-minimal-20260829-r2` — **armed.** `grade-run.sh`: feed = CAM 11
  *Prize Corner* from 124.9 s to end, music box **100.0 % the entire run**
  (`windpct`, 148→367 s), monitor never desynced, ALIVE ≥ 360.8 s (recording
  ends before 6 AM, terminal unknown).
- `n1-minustoys-minimal-20260829-r3` — **not armed.** Frame walk: only CAM 09
  lit, monitor caption *Show Stage*, no "Wind Up Music Box" button, feed never
  *Prize Corner*. The box drained on schedule (pie gauge full at 1 AM → empty by
  4 AM) because **winding is impossible from CAM 09**. Died to the **Puppet at
  ~4 AM** (~303 s of a 420 s night): monitor-up jumpscare → death static (frames
  305–309 s) → Game Over → main menu. The CAM 09 light held the Toys off the
  player mask-less for 2+ hours (the minimal loop uses no mask, and an unstunned
  Night 1 Toy Bonnie/Chica would reach the office long before 4 AM), but whether
  all three stayed on the Show Stage is not legible — the Night 1 flashlight
  overlay and VHS noise obscure the feed and Toy Bonnie is not clearly on stage
  in any frame. Evidence the light works, not proof it pins all three.

Same plan, opposite arm outcome. Across all four 2026-08-29 Night 1 runs the
split armed on the 10/20-shaped calib-01 and on `-r2`, missed on `-r1`
(SIGINT'd early) and `-r3` — the 33 ms opening taps make the arm probabilistic,
and the model's `replay()` (split ≡ `viewing === 11 && cam === 9`) assumes it
always lands, so the 200/200 gate never sees the miss branch. `--minimal`
carries no defensive churn, so nothing catches it.

Two open items:

1. **Verify the arm, don't assume it.** After the opening raise the monitor
   caption reads *Prize Corner* (armed) or *Show Stage* (not armed) and the wind
   button is present iff armed — a one-frame read. A `--minimal` device run must
   check it and re-arm or abort on *Show Stage*. First fix to try: hold the arm
   taps to ≥100 ms (the `hid-multi` contact floor the loop cycle already uses).

   > **Corrected later the same day: the arm miss is sampler phase, not tap
   > length, and the verify is now built.** 33 ms contacts register on this
   > phone; what varies run to run is the schedule's phase against g263's
   > 200 ms `lastViewed` sampler (engine.js). The touch→drop gap is 3 frames;
   > a tick inside it samples `viewing=9` and the raise restores CAM 09 —
   > exactly r3. `minus-toys-plan.mjs --phasegate` measures 3-of-12 epochs
   > missing (bimodal, P(miss) = 3/12 per attempt). Runner-side fix landed:
   > `#arm-verify 1` in the emitted minimal plan, a post-raise arm-verify
   > window in the driver, `cam11lit.py` classifying the CAM 11 map button
   > (the g46-57 highlight: lit ⇔ `viewing===11`; 58-point margins on the
   > r2/r3 frames with office/menu as never-lit controls), host-touch `rearm`
   > re-runs the opening camera rows (skip=1), and `armfail` ends the run
   > named (driver exit 50) after 3 misses.
2. **The abort path is a save-wipe hazard.** After the r3 death the runner kept
   firing the blind `toys[0..999]` macro into the menu for ~7 s before the focus
   watchdog stopped input; the retained tail shows the cursor reached *"Start a
   new game?  »Yes"*. The Night 1 save survived by one contact (menu still
   shows *Continue / Night 1*). On a story-night run `trial.sh` must stop
   pressing, or press a known-neutral coordinate, the moment `screenstate`
   leaves the night — not keep running the schedule.
   **Closed 2026-08-29 (late):** `stop_remote_driver` touches a per-run `halt`
   file (one adb round trip) before the slow force-stop/kill path, and the
   driver checks it at every macro boundary in both loops; residual exposure is
   at most the in-flight macro.

Artifacts: `captures/n1-minustoys-minimal-20260829-r{2,3}-*` (gitignored;
`-r2-grade-debian-r2.log` has the r2 grade).

## The frontier is phase, not actuation — and what the 2026 field says (2026-08-28)

A session-level review of the actuator and sensor questions ("can we build an
S-tier actuator? a god-tier sensor?"), cross-checked against current published
work. **Nothing in this section was measured on this handset.** It is a
reframing plus a literature survey, and every external figure is someone else's
device. It is written down because the reframing contradicts the intuition that
sent three sessions at actuator geometry, and because two of the surveyed
results change a route ranking in `plans/17`.

### The actuator is not what is killing runs, and a perfect one would not help

Stated plainly so it stops being re-derived:

- `desync-scan.py` on `n2-minustoys-0117` reports **zero desync across the whole
  graded interval** — every monitor and mask toggle agreed with the game.
- `/system/bin/hid` schedules one on-device timeline; intra-macro error is about
  **±2 ms**, and the g56 registers **33 ms** contacts on every touch control
  (`HID-MULTITOUCH.md` §"The 100 ms contact floor is margin").
- Against that, `minus-toys-margin.ts` puts whole-schedule phase tolerance at
  **33 ms early / 99 ms late**, versus an epoch-latch bracket the same run
  measured at **302 ms** and a **−184 ms/min** drift.

So a hypothetically perfect actuator — zero jitter, unlimited precision — placed
at a phase that is 300 ms wrong still dies, and dies to the Puppet, which is
exactly what the 600-seed clock-error ensemble showed (n2 600/600 → 127/600,
n3–5 → 0/600). **The phone can hit any millisecond named. Nothing here can
currently name the right one.** The wish is not a better hand; it is a watch.

### The read is already at the portable ceiling; there is nothing faster to buy

Corroborates §"There is no fast, portable, lossless capture on Android" from the
other direction. Current published practice for low-latency Android capture is
what the Companion already does — MediaProjection `VirtualDisplay`, buffer
wrapped without a copy, no GPU→CPU readback (readback is reported at
**12–18 ms/frame** on Mali) — and the best-in-class end-to-end
capture→encode→save figure quoted for a mid-tier handset is **~214 ms median**,
for a whole 1080p frame crossing an encoder [CLAIMED — vendor/press benchmark,
not a peer-reviewed or reproducible measurement].

The helper answers a 20×9 question at **p50 1.7 ms read age** (measured here,
2026-08-27). That is not a better rung on the transport ladder; as this file
already argued, it is off the ladder, because it never moves a frame. **Do not
spend a session looking for a faster capture path.** The remaining borrowable
idea is unchanged and still unbuilt: an `acquireLatestImage()`-style staleness
bound, so a read can refuse to answer about the wrong moment.

### The technique that is actually missing: audio-locked clock recovery

This is the one genuinely new idea from the survey, and it is mature published
work rather than speculation.

The problem is textbook **clock recovery**: recover the phase and rate of a
periodic source from noisy observations. The standard construction is a
second-order digital PLL whose loop filter is a Kalman estimator with state
`(phase, rate)`; this is what UWB location and GNSS tracking systems use, and
the direct comparison of DPLL against Kalman filtering for clock tracking is
published [VERIFIED that the technique and comparison exist —
Gao et al., *J. Electrical and Computer Engineering* 2018,
https://onlinelibrary.wiley.com/doi/10.1155/2018/5873239]. Our drift is a
**linear skew** (−184 ms/min), which is precisely the parameter such a filter
estimates. The "AM-digit re-anchor every 70 s" already modelled is the crude
zeroth-order version of this: a periodic reset with no rate term.

What is missing is a good **phase discriminator**, and the field's answer is
audio. Robust audio fingerprinting generates sub-fingerprints every **11.6 ms**
over a 370 ms window, deliberately overlapped so they vary slowly and align
sub-frame [VERIFIED — Haitsma & Kalker, ISMIR 2002,
https://ismir2002.ismir.net/proceedings/02-FP04-2.pdf]; second-screen TV
synchronisation combines exactly that with generalized cross-correlation to
recover playback offset [VERIFIED that the method is published —
https://www.researchgate.net/publication/263925127_Fast_second_screen_TV_synchronization_combining_audio_fingerprint_technique_and_generalized_cross_correlation].

Applied here, two consequences worth testing:

- **The music-box track is a metronome.** It plays while the box is wound. Its
  playback offset, recovered by cross-correlation against a stored reference,
  *is* the music-box counter — the value `plans/17` lists as "must read" and
  which the in-APK route exists partly to hook. Video gives 60 phase samples a
  second; audio gives a time base three orders finer, timestamped by the audio
  path rather than the render pipeline. `CaptureService.java` already imports
  `AudioPlaybackCaptureConfiguration` and `AudioTimestamp`, and the project has
  already captured night audio, so the capture half is not speculative.
- **Balloon Boy's laugh is audible when no pixel can help.** `n2-minustoys-0117`
  died because BB walked in *while the bot was on the monitor* — the camera feed
  was on screen, so no frame could have shown him. That is the measured death,
  and it is on a channel already wired up.

**Correction, same day: the audio channel is contaminated and sometimes empty —
read [`ANDROID-AUDIO-CAPTURE.md`](ANDROID-AUDIO-CAPTURE.md) before believing
either bullet above.** Both were written without it. Two documented defects cut
against them:

1. **`AudioPlaybackCapture` does not receive the audible mix.** On this build the
   music-box winding and Mangle's static are present in the capture
   *continuously*, even when the player hears nothing — the `[INFERRED]` cause is
   the Clickteam runtime leaving those loops on internal channels and gating only
   the player's mix. So the metronome bullet may be backwards: if the loop
   free-runs decoupled from wind state, its phase is **not** the box counter, and
   cross-correlating it recovers the loop's own phase, not the game-state value.
   It might still be a clean reference for *clock drift* (game-frame vs wall
   clock, which is the phase-estimation goal, not a counter read) — but **only if
   that loop is driven by the game tick**, which is unmeasured. And the permanent
   Mangle/static layer is exactly the contaminating background a laugh template
   could learn instead of the cue.
2. **Bluetooth silently zero-fills the capture** (A2DP offload bypasses the tap);
   night 6-42 recorded 71 s of all-zero PCM over a live BB night while the helper
   reported healthy. Any audio path is dead the moment Bluetooth is connected.

The acceptance test the audio page already wrote governs: collect labeled
positive/negative windows from the target build — negatives *with* Mangle and
*with* the box winding — and prove separability against raw PCM before audio
controls anything. The metronome claim needs one thing that page does not yet
answer: whether the captured loop's phase tracks the counter or free-runs.

**The mandatory control, because this repository has already been burned by
exactly this.** A thud detector reported 22 hits across 285 s of night audio and
all 22 were false positives (CLAUDE.md §"Numbers need their control"). So no
audio result is a result until (a) it has been run against a recording that
*cannot* contain the cue, and (b) a second signature that fails differently
agrees. For a laugh detector, cross-correlation against a reference clip is the
natural second signature, and vice versa.

**What this does not say.** No phase estimator has been built, nothing has been
measured, and the ~1/3 ceiling that `jasonclone` and the AM-anchor sim put on
*external* play is not lifted by having a better clock — a better clock is
necessary for that ceiling, not proof of exceeding it. The unrendered state
(`your view` marker, the permanent `bb.inside` latch, Foxy `D`) stays unreadable
by any sensor, however good, which is why `plans/17` remains the higher ceiling.

### A proposal, not a finding: score candidate policies on observability

Minus Toys passed its gate at 200/200 while hiding a ~300 ms mask cliff and a
33 ms arming margin, and its load-bearing guard (`viewing != your view`) is not
observable by any external instrument this project owns. A survival-only search
cannot see either problem.

So a search criterion worth adding alongside survival: **how much of a policy's
load-bearing state is rendered, and how wide is its per-instruction margin map**
(`minus-toys-margin.ts` is the template for the second half). A policy whose
guards are invisible is a policy whose failures are undiagnosable on the phone,
which is the position this session ended in. Unbuilt, and offered as a design
note rather than a result.

## Death prediction and death targeting: measuring the model's error, not just the night (2026-09-12)

Every device run until this evening aimed at one outcome, 6 AM, and read one
bit: reached or not. A night that fails says that *something* did not hold; it
does not say which mechanism, or by how much. Pedro's proposal on 2026-09-12
was to aim runs at **specific deaths** instead, and the first such run paid
for the idea within its first 30 seconds of game time.

Two instruments, two names, deliberately distinct:

- **`death-prediction`** is a property of a *run*: before the campaign
  starts, the model writes down what should kill and when — killer shares and
  death-time quantiles over every epoch phase a drawn release can land on, at
  the 3000-replay standard — and the grader reads killer and time off the
  frames afterwards. The residual is the measurement.
  `packages/propose/bin/plans/death-prediction.ts` writes the `death-prediction-v1` record;
  `night-run.sh` retains it as `prediction.json` beside the run *before* the
  campaign, so it cannot be fitted to the outcome, and prints it. A 6 AM
  attempt carries the trivial prediction "no death".
- **`death-targeting`** is a property of a *bundle*: a plan whose model gate
  is honestly not PASS because the model expects a death, built to test that
  expectation on the phone. `bundle.ts` accepts `gate.status =
  DEATH_TARGETED` only with the prediction attached, carries it in the
  manifest, and nothing downstream may read such a run as a route claim. The
  deliberate variants — skip the hall flash and time Foxy, wind nothing and
  time the Puppet, hold four mask ticks and watch Balloon Boy — each measure
  one constant that the 6 AM attempts had been guessing.

**The first record: `night6-foxytest-20260912T223944Z`.** Bundle
`artifacts/night6-mask5plus/bundle` (winner `fnv1a-05d2f9a6`, the exact knobs
of the second Night 5 win), released at a drawn epoch. Prediction, stated
before the run from the model's phase census: Foxy in 75 % of phases at
80/150/170 s (p10/p50/p90), the Puppet in 25 % at 27/33/50 s, no wins.
Observed: **Withered Foxy at ~26 s** — the killer the model named, at a time
below its p10 by a factor of three. The frames
(`captures/night6-foxytest-20260912T223944Z.mp4`, HUD at ~29.5 s, release at
~31.6 s): mask 46.5–51.0 s, office 51.5 s, monitor up on CAM 11 winding
52.5–55.5 s, monitor lowering 55.8 s, Foxy in the office 55.9 s, static
56.0 s.

The residual has a cause, and it was measurable on the same run. The contact
audit reads the post-mask hall flash at +19 940 ms **DARK** (the one at
+9 940 lit), and the latency table it measured from `getevent` explains why:
mask-off press→visible effect is 312–315 ms on this handset (286–374 on the
run before), and for the 244 ms of the mask-off animation that follows the
game refuses every office light (g75). The flash is scheduled 380 ms after the
mask-off press with a 33 ms contact: it lands inside the refusal window and
lights only when the latency comes in early. Without that reset Foxy's D
climbs ~15 per cycle; at Night 6's AI 10 he locks at D ≥ 11 within two
cycles, and the camdrop's held light on the monitor drop is then a hall flash
on a locked Foxy — the model's own instant-kill path. Night 5 tolerated the
same swallowed flashes (its earlier runs graded 13/34 and 22/41 dark) because
Foxy at AI 5–7 needs D ≥ 14 on one roll in five.

What the model was missing is therefore an *input* (the mask-off latency),
not a mechanism: with the flash credited, its Night 6 Foxy is at 60–170 s. The
follow-up bundle `artifacts/night6-hallfix` moves the flash to mask-off +
600 ms (the only free knob: the raise, the CAM 09 stun refresh and the camdrop
are each rigid in the model to within ~120 ms, each through Toy Bonnie's
6.66 s stun) and trims the mask window to 5.211 s to make the 10 s cycle fit.
It gates Night 5 at 3000/3000 normal and worst; on Night 6 the model still
predicts Foxy at 80/150/170 s in 75 % of phases and the Puppet in the rest,
and that is the prediction its `DEATH_TARGETED` gate carries. If the phone
then delivers Foxy inside that band, the model's Foxy is right and Night 6
needs a different cycle; if Foxy does not come, the model's D growth under the
mask is wrong on this build, and Night 6 is more open than it says. Either
answer is a measurement.

**Retracted later the same evening.** The mechanism named above — the
post-mask flash swallowed by the mask-off refusal window — was tested by the
`hallfix` runs it motivated and refuted: with the flash at mask-off + 600 ms
the Night 5 audit still read 19 of 41 flashes dark, DARK is uncorrelated with
the cycle's mask-off latency (both p50 314 ms), and the dark flashes cluster in
consecutive cycles — the sourced g202 rendering: the held hall light is drawn
dark while the g875–880 `hall movement` counter drains, and g489/g745/g855
reset Foxy regardless (see the hall-calibration entry above). The flashes land
and reset Foxy, dark or lit; the model's latch occupancy (96 %) against the
phone's dark fraction (46 %) is itself a model-error measurement of hall
occupancy. The 26 s Foxy death
is unexplained; the third Night 5 6 AM on that binding owes nothing to the
change. The second death-targeting run (`night6-foxyfix-20260912T231146Z`)
died to Foxy at ~238 s against 80/150/170 s: killer right, time in the upper
tail. Details and the next experiment in
[`night6-foxy-prediction-20260912.md`](../evidence/night6-foxy-prediction-20260912.md).

## Night 6 is a phase problem on the five-second grid, not a route problem (2026-09-13)

The 26 s Night 6 death (`night6-foxytest`, mask5plus knobs, epoch 139 ms) is
explained, sourced and measured. The post-mask hall contact is 33 ms
(`hallMs`), pressed at mask-off + 380 ms; the phone's mask-off press-to-effect
is 307 ms median, 352 max, and g75 lights the hall only at `mask` = 0, after
the lowering animation. The 33 ms tap fell inside the animation on both cycles:
the doorway trace at 60 fps shows no beam at either flash (6 -> 11 -> raise,
never the +55 of a lit beam). With no post-mask reset, D ran from the camdrop
at 15.5 s through the 5.2 s mask window to 13.7 at the 25.0 s roll; at AI 10
that locks with Random(5) <= 3, and g573 kills the instant the held camdrop
light meets a locked Foxy at the 25.6 s drop. The model gives that bundle a
Foxy floor of 40 s in 60 000 replays because its `MASK_ANIM_OFF` is 244 ms
with zero actuation latency, so its flash lands. The retraction of 2026-09-12
stands for DARK flashes (sourced rendering); the swallowed flash is the FLAT
one, and the hallfix move to +600 ms is what removed it.

The larger finding came from tracing the model's own Foxy on the hallfix
knobs. Withered Foxy rolls on a global five-second timer (g337, `Every 5000
ms`), and the route's cycle is 10 s: which cycle phase the roll ticks land on is
fixed for the whole night by the epoch. At epoch 0 the ticks land at phases
0.0 and 5.0, and phase 10.0 is the instant before the flash at 10.06, where
D = 6.35 s + 5.21 s masked = 11 -- exactly the AI-10 threshold, and far past
the AI-15 one after 2 AM. Every epoch in [0, 1000) dies (`night6-hallfix`
prediction: 0 wins, Foxy 75 %). Shifting the whole schedule by 2.9-4.95 s
against the same grid wins 3000/3000 at 3000, 3500, 4000, 4500 (18 Golden
Freddy), 4900, and the same knobs lose 3000/3000 again at 5100: the period is
5 s, and the one-second scans (`death-prediction` phases 0..950, the Night 5
anchor bands) never see it. `night6-noflash` never wins at any epoch: the
post-mask flash is required at AI 15.

The band is perforated. Every 200 ms a 50 ms hole loses 100 % to the Puppet at
36-50 s: g263 samples `last viewed` on a 200 ms timer, and when a tick falls
between the opening's CAM 09 tap and the monitor drop 50 ms later, the raise
restores CAM 09, the box is never wound, and the Puppet walks. The Night 5
anchor evidence carries the same holes ([116.67, 166.67), [316.67, 366.67),
[916.67, 966.67)) under the Balloon Boy label. The phone's arm check sees a
failed split and aborts.

What this changes:

- A bundle can now be qualified at the epoch its anchor delivers
  (`winner.anchorEpochMs`, `packages/propose/bin/plans/bundle.ts`): the gate replays there,
  the manifest carries it, and `night-run.sh` refuses to run such a bundle
  unanchored. `artifacts/night6-anchored` (fnv1a-bc5e044c) is the hallfix
  knobs at anchorEpochMs 3850 with an honest PASS.
- The anchor aim carries its timer period: `--night-anchor-period-ms` from
  the CLI to `night-anchor.js`, `--anchor-period-ms` in the fact register, and
  the run script passes it. Night 5 stays on 1000; Night 6 aims at 3600 on
  5000 with maxK 0 (aim + 5 s loses to a Withered inside the office).
- The five-second grid origin is assumed to be the first held FNAF2_NIGHT
  frame, as the one-second origin was for Night 5. No phone run has delivered
  an epoch in [2900, 4950): the six graded runs sat at 59-2569 ms, and the
  238 s death (`night6-foxyfix`, 2569 ms) sits where the model gives 3.5-70 %.
  The first anchored Night 6 run tests the origin as much as the route.

Evidence: [`night6-anchor-aim-20260913.json`](../evidence/night6-anchor-aim-20260913.json).

### Golden Freddy through the camdrop: the anchored binding refuted twice, the model corrected (2026-09-13)

`night6-anchored` (fnv1a-bc5e044c) released anchored twice at k=0 (0.16 ms
late) and died at 199 s and 219 s -- both to Golden Freddy, both the second
after a camdrop, both after 2 AM. The dump has it: g336 creates `yellowbear`
on a five-second tick with the cameras up; g778 kills the instant a lit hall
light finds him with alt0 = 0, and the camdrop holds the camera light through
the drop. The model read g778 only on a light press and cleared him at the
mask press instead of at `mask` = 2 (g776). Corrected in `plant-model.js`;
the refuted binding then scores 8/600 at its epoch (592 Golden Freddy). At
that phase a five-second tick lands at cycle phase 1.15 s with the cameras
up: 15 % per cycle after 2 AM. Details and frames:
[`night6-anchored-golden-freddy-20260913.md`](../evidence/night6-anchored-golden-freddy-20260913.md).

The corrected model's Night 6 search (ten knob variants, 0-10 s at 100 ms):
the only survivors move the mask off earlier so the flash precedes the second
tick, with both ticks falling after the drop and before the raise -- where he
cannot be created. `night6-anchored-b` (fnv1a-94baf687: mask off 8960, flash
9560, anchorEpochMs 5253; aim 0 on 5000 with k=1) is banded at effective
5033-5417 and confirmed 3000/3000 at 5200/5250/5285 and 200/250/285
([`night6-anchor-aim-b-20260913.json`](../evidence/night6-anchor-aim-b-20260913.json)).
A no-light camdrop (`camdropLight: false`, new plan knob) wins nowhere: the
drop's Foxy reset is required at AI 15.
