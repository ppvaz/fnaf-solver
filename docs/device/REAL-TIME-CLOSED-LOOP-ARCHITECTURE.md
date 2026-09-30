# Real-time closed-loop controller architecture

**Status: proposed architecture, 2026-08-31; hardware-role correction
2026-09-01.** This is the control boundary for the stock-device controller
work. Hardware identities do not own architectural roles; profiles compose
capabilities and contracts.

## Decision

An ESP32 is one possible internal node, not a mandatory topology or a fixed
role. Depending on the selected profile, it may be a transport-only bridge, a
sensor processor, a reflex coprocessor, an actuator peer, or absent. The same
roles may be implemented by the phone, a host, another MCU, or several nodes.
Composition is valid when every selected component satisfies its declared
capability, timing, health, and data contracts.

**Deployment direction, 2026-09-06.** The role contract stays hardware-neutral,
but the preferred eventual placement is now phone-first: Companion should
become the full device authority for capture, top-level lifecycle/game-state
estimation, belief/fusion, safety arbitration, campaign supervision, and the
selected input backend. The PC remains an offline build/calibration/replay/
telemetry tool, and may host the controller during qualification, but it is not
the intended authority during a finished run.

This is not yet a live-runtime claim. The APK currently exposes a read-only
helper boundary and the host composition remains the qualification lane. The
lifecycle object must move into Companion before host removal is complete.
AccessibilityService remains an unqualified framework candidate: its first
stock-game acceptance gate completed at the framework but was ignored by
FNaF2, while the same UHID tap was accepted. `/system/bin/hid` UHID remains
the current in-night and menu-control baseline; see the dedicated comparison
benchmark in [`ACCESSIBILITY-VS-HID-BENCHMARK.md`](ACCESSIBILITY-VS-HID-BENCHMARK.md).

The 2026-08-30 phone -> ESP32 A2DP -> Wi-Fi/UDP PCM -> same-phone-helper
experiment had severe loss problems. No loss rate or latency percentile has yet
been retained, so this is a **[CALIBRATED, qualitative]** rejection of that
specific topology/profile, not a quantitative rejection of bridges as an
architectural mode. It remains ineligible for live control. A different bridge
or processor placement may qualify independently by satisfying the contracts
and measurement gate below.

The distinction is contractual rather than hardware-branded:

```text
rejected profile: phone audio -> ESP32 -> lossy Wi-Fi PCM -> same-phone detector
possible profile: source -> sample bridge -> detector -> semantic facts
possible profile: source -> local detector -> semantic facts
```

Raw sample transport is not intrinsically diagnostic-only. It may close a live
loop only when its `SampleChunk` stream has measured loss, jitter, freshness,
clock, and end-to-end deadline bounds for that exact profile. Otherwise it is
non-authoritative evidence or an offline diagnostic artifact.

## Controller shape

The system is multi-rate and asynchronous. Sensing, state estimation,
planning, and input execution overlap; a slow computation never blocks the
fast path.

```text
Android video ------> visual adapter --------\
                                            timestamped facts
Audio source/adapter -> optional processor ---> shared belief state
                                                    |          |
                                                    v          v
                                             L1 reflex     L3 planner
                                                    \          /
                                                     action arbiter
                                                           |
                                                     HID / touch
                                                           |
                                                         game
```

Each event carries a monotonic acquisition timestamp, source identity,
confidence, calibration profile, sequence number, and health/age information.
The receiver must treat sequence gaps, stale events, and unknown calibration as
loss of evidence—not as a negative game observation.

The belief is the only shared representation of hidden game state. It predicts
forward from the last accepted action and elapsed monotonic time, then applies
new facts at their observation time. It records uncertainty instead of turning
missing audio/video into a confident boolean.

## Latency classes and pre-emption

| Layer | Target cadence / budget | Owner | Responsibility |
|---|---:|---|---|
| L0: I/O | sub-ms where hardware permits | acquisition / actuator MCU | timestamping, input delivery, watchdogs |
| L1: reflex | ~1–5 ms after a local fact | qualified reflex and actuator capabilities | deadline actions, cancellation, safe hold |
| L2: belief | ~10–30 ms | The Companion preferred; host during qualification | event fusion, prediction, uncertainty, health |
| L3: tactical | ~100–500 ms | The Companion preferred; host during qualification | select and revise a short safe action prefix |
| L4: strategic | 100 ms to seconds | optional planner/model | policy parameters, diagnostics, candidate plans |

The budgets are design targets, **not measured device performance**. Promotion
requires end-to-end p50/p95/p99/p99.9 traces for each path.

Lower layers pre-empt higher layers. The arbiter has one ordering:

```text
verified emergency reflex > verification/recovery > approved tactical prefix > strategy proposal
```

An L1 action cancels any conflicting uncommitted actions. Actions already at
the actuator require an explicit cancellation/commit state; the controller
must never claim that an interrupt withdrew an input which has already been
delivered. On link or sensor-health failure, it enters a named conservative
hold/recovery behavior rather than continuing a stale plan.

## Roles and deployable nodes

- **Audio source adapter:** acquires or receives the audible mix and publishes
  either qualified sample chunks or semantic facts. It may be implemented by
  an ESP32, phone, host, other hardware, or a composition of them.
- **Sample bridge:** transports bounded, sequenced audio chunks with format,
  acquisition/receipt timestamps, clock identity, loss and health metadata. It
  is permitted when its profile passes the measurement gate; it owns no
  semantic truth merely because bytes arrived.
- **Sensor processor:** turns samples into calibrated semantic facts. It may be
  co-located with the source, bridge, belief host, reflex node, or actuator.
- **Reflex node:** consumes qualified facts, owns deadline/cancellation state,
  and can issue only the bounded actions declared by its capability profile.
- **Android Companion:** is the preferred eventual visual authority and
  belief/planner host. It currently produces visual events and control-state
  confirmations only; its capture rate and compositor delay are measured inputs
  to the model, not assumed to be real-time. Its lifecycle reducer and belief
  object must become the single device-local state authority during migration.
- **Hostless input backend:** AccessibilityService is the ordinary-APK
  framework candidate, but its first stock-game acceptance gate failed and it
  is not promoted for menu/campaign or in-night actions. UHID remains the
  existing in-night and menu-control baseline. The backends are interchangeable
  at the action-port boundary, not interchangeable in evidence or timing until
  measured and accepted by FNaF2.
- **Actuator:** owns monotonic input timing and reports command acceptance. A
  wired link is preferred between a deadline-critical reflex source and the
  actuator. The original ESP32-WROOM-32 has no native USB-device controller,
  so it cannot itself be the wired USB-HID endpoint; that requires a separate
  HID-capable MCU (for example an ESP32-S3) or the currently validated
  on-device input path.

An ESP32-WROOM-32 local-DSP + HID-capable MCU deployment is one possible
profile: the nodes communicate by a bounded wired protocol (UART/SPI), and the
message is an idempotent event or reflex command with sequence number and
deadline—not a wall-clock macro. A bridge profile may instead carry sample
chunks to a detector elsewhere. Wireless transport is eligible for a lethal
deadline only when the exact link/profile has retained tail-latency, loss and
recovery evidence within that deadline.

## Fact and action contracts

Facts preserve the difference between observing an event and receiving a
message:

```text
Fact { type, value, confidence, source, calibrationProfile,
       sequence, t_observed, t_received, latencyMin, latencyMax, health }
```

Bridge mode additionally uses an explicit stream contract:

```text
SampleChunk { format, payload, source, transportProfile, sequence,
              t_acquired, t_received, clockId, loss, health }
```

Audio PCM arrival is not `t_observed`. It is only a transport receipt time
unless the acquisition source supplies a timestamp whose clock relation and
latency bounds are calibrated. A downstream detector derives a new `Fact` and
preserves the relevant provenance; it does not relabel receipt time as event
time.

Actions use an explicit lifetime:

```text
proposed -> approved -> committed-at-actuator -> observed / expired / cancelled
```

The planner can approve a bounded prefix (for example a camera-down/flash/up
cycle) while it computes the next one. The L1 reflex controller can interrupt
the remaining prefix immediately when a proven threat fact arrives.

## Measurement gate

Do not call this architecture real-time merely because each component runs.
For each live configuration, record and retain:

1. sensor acquisition to semantic-fact timestamp;
2. fact delivery to belief update;
3. reflex decision to actuator receipt;
4. actuator receipt to visible game result;
5. event/fact/command loss, reordering, stale age, and cancellation outcomes;
6. behavior during A2DP silence/resume, Wi-Fi degradation, and upstream loss.

The relevant proof is the full `event -> action -> observed result` path at
p99/p99.9, not an average loop time. A configuration that lacks a trace must
remain shadow-only.

## Consequences for existing plans

- Plan 08's measured phone/ESP32/Wi-Fi PCM loopback profile is retracted as a
  runtime candidate. Bridge mode remains available to a different qualified
  profile; ESP32-local DSP is one alternative placement, not the architecture.
- Plan 20 owns the belief, tactical planner, and arbiter semantics; its P6
  hardware work must use the fact/sample/action contracts above.
- `ANDROID-AUDIO-CAPTURE.md` retains the A2DP-mix evidence, but no longer
  presents the rejected Wi-Fi PCM-return profile as a runtime target.

The engineering rule is simple: **keep sensing and acting while slower
inference is running, and qualify the exact placement and transport rather than
assigning architectural truth to a hardware name.**

## Host choice: macOS is not an A2DP-sink target

**Research note, 2026-08-31.** A phone + PC/Mac controller is a credible
replacement for the ESP32 experiment, but the Mac must not be specified as the
phone's native Bluetooth A2DP receiver.

Apple's macOS documentation describes Bluetooth audio devices as the Mac's
output (headphones/speakers) or, for audio input, a headset. Its public A2DP
documentation likewise describes A2DP as routing audio *from* an app to a
paired Bluetooth device. No Apple-supported setting or public API was found
that turns a current Mac into an A2DP audio sink for an Android phone.

The one located macOS sink library, `airander/A2DP-SINK`, is a community
proof-of-concept: it publishes an A2DP “Audio Sink” SDP record, accepts the
AVDTP/L2CAP negotiation itself, and hands **raw RTP packets** to its caller. It
is not a CoreAudio input device, not a complete PCM receiver, and was archived
in 2021. It is useful historical evidence that an app can implement the role,
not a runtime dependency or evidence of compatibility with a current macOS
release.

Sources: [Apple: connect Bluetooth audio devices](https://support.apple.com/en-euro/guide/mac-help/blth1004/mac),
[Apple: A2DP output route](https://developer.apple.com/documentation/avfaudio/avaudiosession/port/bluetootha2dp),
[archived A2DP-SINK project](https://github.com/airander/A2DP-SINK).

The practical choices are therefore:

| Topology | Verdict | Boundary |
|---|---|---|
| Android -> native macOS Bluetooth -> Mac PCM | **Reject** | macOS does not offer the required supported A2DP-sink role. |
| Android -> community A2DP app -> local Mac detector | Shadow-mode experiment only | Requires a maintained fork that owns codec negotiation, RTP loss/reordering, decode, clocking, and telemetry. |
| Android -> Linux/BlueZ receiver -> Mac semantic facts | **Preferred Mac pattern** | The Linux node owns A2DP decode/local cue extraction; it sends sequenced facts, not PCM, to the Mac. |
| Android -> hardware A2DP receiver -> USB line-in on Mac | Bench-only fallback | Analog capture avoids the PCM-return bridge but needs a new full-path latency/loss calibration. |
| Android -> Windows A2DP receiver -> local controller | Bench-only alternative | Treat the receiver and audio graph as an untrusted sensor until measured. |

Linux has supported receiver primitives: PipeWire exposes an `a2dp_sink` role
and a capture-node path, while BlueALSA's `bluealsa-aplay` captures streams
from connected Bluetooth devices. They make a small Linux host (or spare PC)
the cleanest external-audio endpoint. Neither is a promise of low latency;
A2DP buffering, silence/resume behavior, and end-to-end jitter still require
the measurement gate above. Sources: [PipeWire Bluetooth roles](https://docs.pipewire.org/1.2/page_man_pipewire-props_7.html),
[BlueALSA player documentation](https://github.com/arkq/bluez-alsa/blob/master/doc/bluealsa-aplay.1.rst).

### macOS community-sink probe — rejected 2026-08-31

`airander/A2DP-SINK` was built successfully as an ad-hoc signed arm64 app on
the project Mac (Apple silicon, macOS 26.6.2). It published the original
service record, whose `0x0001` service-class list is `0x110B` (Audio Sink),
and the phone paired with the Mac.

The media-profile gate failed:

- Android rendered the peer as a **computer**, not a speaker/headphone;
- the active connection reported only generic ACL/GATT services;
- Android exposed no Media audio toggle; and
- the probe received **zero** incoming A2DP/RTP packets.

`[INFERRED]` The blocking omission is the local Bluetooth **Class of Device**:
the old app can add an SDP service but does not change macOS's host-level
computer class. A reference A2DP sink sets an Audio/Rendering/Audio class
(`0x240400`), and A2DP guidance recommends the Audio service bit plus the
Audio/Video major device class. macOS's public `IOBluetoothDevice` API exposes
the class only as a property of *remote* devices; no supported local-class
setter was found. Therefore a normal application service record is insufficient
on this release. Sources: [Bluetooth SIG A2DP UUIDs](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Assigned_Numbers/out/en/index-en.html),
[BTstack reference sink](https://github.com/bluekitchen/btstack/blob/master/example/a2dp_sink_demo.c),
[Silicon Labs A2DP guidance](https://www.silabs.com/documents/public/application-notes/AN986.pdf).

Do not pursue a private `bluetoothd`/raw-HCI class override for the controller.
It would turn the sensor into a macOS-version-specific system hack with no
reliable recovery or timing story. This closes the native-macOS A2DP-sink
route for the project; the Linux/BlueZ receiver remains the supported external
audio direction.
