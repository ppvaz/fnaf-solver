# Video reactive controller

**Status: proposed 2026-08-29, Pedro's directive.** Build the full stock-device
video sensing + reaction subsystem, package by package. Each package is
independently shippable and testable; the first two need no phone.

## Why this plan exists

Two device results on 2026-08-29 (`n1-minustoys-calib-01`,
[`MINUS-3-STRATEGY.md`](../docs/strategy/MINUS-3-STRATEGY.md) §9) reshaped the
device frontier:

1. **On-device audio is dead for cues.** Every discrete `Play sample`
   (BB's laughs, the vent bang, footsteps, the winding tick) is a SoundPool
   track on the g56's `AUDIO_OUTPUT_FLAG_FAST` mixer — a separate HAL stream
   `AudioPlaybackCapture` never taps
   ([`ANDROID-AUDIO-CAPTURE.md`](../docs/device/ANDROID-AUDIO-CAPTURE.md)
   §"Discrete SFX are on the fast mixer"). `plans/08` is blocked without root.
   **Video is the only stock-device reactive sensor left.**
2. **No measurable drift, zero desync.** Over a 5 min Night 1 pilot the game
   clock held nominal (hours 69.99/70.04/70.00 s) and every press agreed with
   game state. So a reactive loop's job on a timer route is **verification and
   rare, conservative resync — not continuous correction.**

The pieces already exist as scattered proposals: `plans/15` (a game fact taught
once, read through a calibrated per-sensor adapter), `plans/10`/`plans/11` (a
stock-device controller loop and a policy interface), `plans/03` (the RVC /
blackout-reactive strategy), and
[`ONE-PIXEL-VISION.md`](../docs/device/ONE-PIXEL-VISION.md) (one native pixel at
`(451,730)` separates the BB left-opening state 194 vs 0; the resolution ladder
is arithmetic; `VirtualDisplay.resize()` changes resolution without new
consent). This plan is the build order that turns them into one working loop.

## Incidents each package pays for

| Incident | Package |
|---|---|
| Night 6-38: a reactive `monitor-resync` fired mid-`MONITOR_ANIM_DOWN` and **caused** the desync it hunted | P1 — the controller model gates for exactly this: a decision inside an animation window is refused |
| BB with no left-opening read is **0/3000** (`HID-MULTITOUCH.md`) | P1, P3 — the one reactive read that is already load-bearing is the reference policy's spine |
| The cue helper's 42 ms read still cannot answer "is BB in the left opening" because its threshold is calibrated for `screencap`, a different sensor (`plans/15`) | P3 — calibration is a package, not an afterthought, and an uncalibrated watch **refuses** rather than guesses |
| "A screencap every four cycles truncated the wind and collapsed the box from 52 % to 10 %" | P2 — the watchlist read is a fixed device-side sample set; no full frame crosses the wire |
| `n2-minustoys-0117` refuted open-loop Minus Toys on a drift figure a later run did not reproduce | P4 — the loop ships in **observe-only** mode first, grading drift/desync under load before it is allowed to act |

## Goal

A stock (unrooted) g56 loop that, once per ~5 s cycle:

- reads a **fixed device-side watchlist** of native-resolution pixels and tiny
  ROIs (~59 ms, its own `MediaProjection` surface, no SurfaceFlinger contention);
- derives a small set of **sensor-independent game facts** (blackout, monitor
  up/down, mask on, left-opening empty/threat, split armed, AM hour, box-pie
  fraction, vent-light state);
- feeds them to a **reactive controller** that either confirms the open-loop
  schedule is on-phase or takes one bounded corrective/defensive action;
- never acts on an uncalibrated fact, and never acts inside an animation window.

It is enough for **blackout-reactive strategies** (RVC / brayden / the published
Minus Toys blackout branch). It is **not** enough to make BB-vent detection work
for Minus 7 — the pilot is mid-routine when he would appear, and Minus 7's own
stun-loop is his backstop.

## Packages

### P1 — engine observation model + reactive controller (no phone) — DONE (`6bfbc39`, 2026-08-29)

Shipped: `src/observer.js` (OBSERVED/UNKNOWN fact model, `OBSERVE_INTERVAL`
cadence, `readDelayFrames` round-trip latency, `dropRate` → `UNKNOWN(read-dropped)`,
mid-animation and off-screen refusal), `src/controller.js` (`guardIntents` for
the night 6-38 rule, `BlackoutReactive` lower→mask→hold→verify→raise with a Foxy
mask timeout and a press cooldown against stale-read reversal), and
`tools/reactivetest.mjs` in `tools/test.mjs --engine` + `tools/TOOLS.md`
(`e007463`). Integration result: the real minimal Night 1 Minus Toys base dies
200/200 to four synthetic blackouts, +reactive 0/200, +delayed-and-dropped
observer 0/200 — with a documented Toy-stun cost for leaving CAM 09, which the
blackout-specific metric excludes by design.

- `src/observer.js` — `Observer` derives, from a `Sim` snapshot, exactly the
  facts a native watchlist can see, **with the real sensor's coarseness and
  latency**: a fact is `OBSERVED value` / `UNKNOWN reason` (never a bare value),
  one read per `OBSERVE_INTERVAL` frames, and a fact whose pixels would be
  ambiguous this frame (panned office, mid-animation) resolves `UNKNOWN`.
- `src/controller.js` — `ReactiveController` interface: `decide(observations,
  cycle) -> [] | [{press, at}]`. A decision that lands inside
  `MONITOR_ANIM_DOWN` / `MASK_ANIM_*` of a scheduled press is dropped and
  logged (the night 6-38 rule).
- A reference **`blackoutReactive`** policy: open-loop wind + flash on the grid,
  plus `blackout -> mask; hold until just before the next interval; on the next
  clear, read the opening; resume`.
- `tools/reactivetest.mjs` — gates the reference policy Night 1–7 at 1200 seeds
  against the model; a control with the observer's reads **disabled** must do
  strictly worse; a control with reads **delayed/noised** must degrade
  gracefully, not cliff. Added to `tools/test.mjs --engine`.

### P2 — cue helper native-res watchlist protocol (no phone; compiles offline) — DONE (worktree)

- `PixelWatch.java` — a fixed list of `(x,y)` pixels and `(x,y,w,h)` ROIs with
  per-entry reducers (mean luma, yellowness, grey-cell count). Native
  coordinates; the service resolves them against the current
  `content=WxH`.
- `CaptureService.java` — `VirtualDisplay.resize()` to a configurable capture
  resolution (default native), `WATCH <token> <spec-hash>` to load a watchlist,
  `READ <token>` to return the current values as one bounded ASCII line. `GET`
  keeps working unchanged (the 20×9 scalars) so nothing downstream breaks.
- `android/companion/build.sh` still Gradle-free; `test-query-companion.sh`
  gains the two verbs' argument handling and reply shape (mock ADB, no phone).
- `CueDetector` is untouched — this is the visual path only.

### P3 — calibration harness (harness now; values need device frames) — DONE (worktree)

- `tools/device/watch-calibrate.py` — given a directory of device frames each
  labeled with the game state it shows, derive the watchlist: which native
  pixels/ROIs separate which facts, the threshold, and the **separation margin**.
  A fact with margin below a floor is emitted as `refuse` — the sensor reports
  `UNKNOWN` for it rather than guessing (`plans/15`).
- Output is a committed `watchlist-<device>-<mode>.json` (the spec, not frames);
  raw frames stay in `captures/`.
- Seeded with the one known result: `(451,730)` → left-opening empty/threat,
  194 vs 0 (`ONE-PIXEL-VISION.md`).
- `test-watch-calibrate.py` — mock frames in, expected spec + refusals out.

### P4 — trial.sh reactive branch, observe-only first (wiring landed; phone evidence open)

- `REACTIVE=observe` — the loop runs, logs every fact and every decision it
  *would* have made, and grades drift/desync against the schedule. Ships first.
- `REACTIVE=act` — the loop is allowed to take the bounded actions P1 gates.
  Gated behind an observe-only run that graded clean under a monitor-stressing
  schedule (Night 5 or 7), per the `n2-minustoys-0117` incident.
- The watchlist read replaces the current single left-opening `read` step; the
  driver's other steps are unchanged.

### P5 — attach to a blackout-reactive strategy and measure (phone; needs `plans/03`)

- Encode brayden/Shooter25 RVC's four-way post-wind decision as a
  `ReactiveController` (this is `plans/03`'s core deliverable; source its
  Android vent/endgame rules first).
- Run it observe-only, then act, then grade with `grade-run.sh`.
- Compare to the open-loop timer route on the same nights.

### P6 — external audio slow-path (hardware; partially un-blocks `plans/08`)

The fast-mixer block (`ANDROID-AUDIO-CAPTURE.md` §"Discrete SFX are on the fast
mixer") is **capture-side only**: `AudioPlaybackCapture` taps the normal mixer
*before* the HAL combines DEEP_BUFFER + FAST, but the **A2DP encoder sits after
that combine** and gets the fully-rendered mix — music, SoundPool SFX, volume
automation. An external A2DP sink hears WinD, BB's laughs, the footsteps, the
vent bang: the exact cues `plans/08` is blocked on.

- **Sink and actuator are separate hardware decisions.** The recommended first
  topology is a **Linux A2DP sink** (which also runs the trial harness and the
  detector) -> timestamped fact link -> an **ESP32-S3 that owns wired USB-HID**.
  An alternative is two MCUs: a Classic-Bluetooth ESP32 receives A2DP and sends
  facts over UART/SPI to the ESP32-S3. This split is not decorative: the
  original ESP32 supports the Bluetooth Classic A2DP sink API, while ESP32-S3
  has native USB HID but no Bluetooth Classic. A single original ESP32 using
  Bluetooth HID remains a bench-only option until Android acceptance and jitter
  are measured. [Espressif A2DP sink API](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/bluetooth/esp_a2dp.html),
  [ESP32-S3 Bluetooth support](https://docs.espressif.com/projects/esp-idf/en/v5.1.6/esp32s3/esp-idf-en-v5.1.6-esp32s3.pdf),
  [ESP32-S3 USB HID](https://docs.espressif.com/projects/esp-iot-solution/en/latest/esp-iot-solution-en-master.pdf).
  The phone pairs to the sink.

  **Hardware on hand (2026-08-29): an ESP32-WROOM-32 — the *original* ESP32.**
  It has BT Classic (A2DP sink, SBC only) and BLE/BT-Classic HID, but **no
  native USB device controller** (its USB port is a UART bridge for flashing).
  So it **cannot be the wired USB-HID actuator** — that needs an S3/S2/RP2040/
  Pro-Micro or an add-on USB-HID chip. Consequence: **do not build an external
  actuator yet.** The on-device `/system/bin/hid` path over adb is validated
  (33 ms contacts land, ±2 ms macro timing) and needs no hardware. The
  WROOM-32's only role here is the audio path, as an *alternative* to the PC
  BlueALSA sink (portability / PC-offload) — SBC-only, so gated on the SFX-
  survives-SBC check below. A BT-HID actuator from the same chip while it also
  runs A2DP is a radio-coexistence headache and external BT multitouch
  acceptance on Android is unproven; not worth it over the working adb path.

  **2026-08-29 correction from the working setup:** the Linux sink is
  **BlueALSA (`bluez-alsa`), not PipeWire** — PipeWire 1.4.2's
  `api.bluez5.a2dp.source` path produced only broadband static on this host and
  never a valid PCM, on aptX HD *and* on forced SBC. BlueALSA with
  `bluealsa-aplay` + WirePlumber's Bluetooth monitor disabled is the validated
  path (`ANDROID-AUDIO-CAPTURE.md` §"The A2DP mix DOES carry the fast-mixer
  SFX"). This matters for the two-MCU alternative: the ESP32 Classic-A2DP sink
  is SBC-only and low-rate, and **it is unproven that FNaF's SoundPool cues
  survive that decode** — the Linux path only worked with a full BlueALSA
  decoder. Keep the PC in the loop until an ESP32 A2DP sink is bench-proven
  against the same `s0033` matched-filter control (NC 0.56 is the bar).
- **Latency reality.** A2DP adds ~150–250 ms of roughly-constant transport +
  buffering. That **closes the Minus 7 BB early-unmask for good** (`plans/08` §3:
  end-to-end < 33 ms for a useful gain — already closed on latency; BT only
  makes it worse). It may fit the 0.75 s blackout deadline only if a bench
  measurement proves its p99 end-to-end tail, but the controller architecture
  does **not** put it in the blackout → mask critical path. Its promoted role
  is pre-positioning on an auditory early warning video cannot see (BB laugh,
  Mangle radio, footsteps), narrowing the controller's route-uncertainty set.
- **The number that decides feasible-vs-reliable:** p99 / p99.9 A2DP
  PCM-arrival jitter. Timestamp every PCM block at the sink as soon as BT
  delivers it, but do not call that the game-event time: receipt only bounds
  the cue's earlier occurrence through a calibrated latency interval. Record
  `cue reference → BT PCM arrival`, `arrival → detector`, and
  `detector → actuator` separately. A rare +170 ms buffering excursion is
  what eats the safety margin for 10/20.
- **Detection is causal, not windowed.** A distinctive transient is often
  confidently matched from its first ~10–30 ms (80–480 samples at 16 kHz), so
  the detector streams and decides early rather than waiting for the whole
  cue tail.
- **Actuation.** The HID executor owns its own monotonic schedule. Upstream
  audio sends one bounded fact, never a sequence of wall-timed button commands,
  and never blocks the pre-approved HID cycle. It may pre-empt only through the
  controller's explicitly permitted safety path.

This package is hardware-gated and lower priority than P1–P4 (the video
fast-path is what a mask deadline needs). It exists so the auditory cues are not
permanently written off — they are reachable, just not on the stock phone's own
capture API and not fast enough for the sub-67 ms actions.

## Constraints (from `CLAUDE.md`)

- No `node_modules`; `observer.js`/`controller.js` are bare-node modules with
  their own `sourcetest`-style assertions where they encode a game rule.
- Every instrument added here is added to `grade-run.sh` or
  `tools/test.mjs --engine` in the same commit (`test-grade-run-coverage.mjs`).
- The controller route "runs nothing the model gate has not passed — absolute":
  `reactivetest.mjs` is that gate, and `REACTIVE=act` refuses without it.
- Explainability over accuracy: the watchlist is a hand-auditable list of
  coordinates and thresholds, not a learned model.

## Dependencies and ordering

P1 and P2 are independent and both phone-free — do them first, in either order.
P3's harness is phone-free; its values wait for a labeled frame set (the
`n1-minustoys-calib-01` video is a start — it has 12/1/2/3/4 AM, monitor-up,
split-armed, mask-on). P4 needs the phone and P2+P3. P5 needs P4 and `plans/03`.
