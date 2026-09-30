# AccessibilityService versus on-device HID

**Status: research conclusion plus device pilot, 2026-09-06.** This note
records the online search prompted by the hostless Cue Helper discussion and
the first safe phone-side comparison. It separates framework facts, public
claims, and the measurements this project still needs to make on the Moto g56
target.

## Short conclusion

No credible public, apples-to-apples benchmark was found that compares
Android `AccessibilityService.dispatchGesture()` with a local UHID/HID
touchscreen path for end-to-end latency, jitter, contact fidelity, or game
acceptance.

The public record supports a narrower conclusion:

- AccessibilityService is the lowest-friction way for an ordinary APK to act
  without ADB, root, or a privileged input permission.
- Modern Android can sample an accessibility gesture at display-refresh timing.
- Accessibility gestures can express multiple strokes, but the framework
  serializes them as one active gesture and cancels an earlier gesture when a
  new one is dispatched.
- UHID gives this project explicit contact reports and has already passed our
  two-contact FNaF2 fixture. It is therefore the current in-night baseline,
  not merely a theoretical alternative.
- Nothing found online proves that either path is faster or more reliable for
  this game's actual touch geometry.

## What Android actually specifies

Android documents `dispatchGesture()` as supporting taps, swipes, and
multi-touch. The service must declare `canPerformGestures`, and the user must
enable the service in system settings. A dispatched gesture also cancels any
gesture already in progress. See the [Android accessibility-service guide](https://developer.android.com/guide/topics/ui/accessibility/service)
and the [`AccessibilityService` API reference](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService).

The relevant framework implementation is more precise than the common “100 ms
accessibility lag” claim. AOSP's `AccessibilityService` source says that
services targeting Android Q or earlier use a fixed 100 ms gesture sample
period; newer targets calculate the period from the display refresh rate. The
Cue Helper manifest targets SDK 36, so the old 100 ms rule is not the expected
path for this APK. This is a framework scheduling fact, not a measurement of
the Moto g56's delivery or the game's response. See [AOSP's gesture sample-time
code](https://android.googlesource.com/platform/frameworks/base/+/c917c0a9e4ab2dd19b52c0acbacdccc055f4372e/core/java/android/accessibilityservice/AccessibilityService.java)
and [our target SDK](../../android/companion/AndroidManifest.xml#L4).

The API still has a structural limitation relevant to FNaF2: a later gesture
cannot freely add a new pointer to an already-running gesture. The documented
stroke/continuation API requires the continued gesture to preserve the earlier
stroke set, and an independent dispatch cancels the current gesture. This
needs to be tested with our pan/light/flash contact pattern rather than
assumed from the existence of multi-touch support. See the [TouchInjector
analysis](https://github.com/emanuelef/TouchInjector/blob/master/docs/inject_touch_events.md)
for the source-level continuation constraint.

## What the online search found

### Measurements that are useful but not comparable

- [Google WALT](https://github.com/google/walt) measures physical probe-to-
  kernel `ACTION_DOWN`/`ACTION_UP` latency and display latency. It is a good
  measurement method, but it does not compare injected AccessibilityService
  events with UHID reports.
- [Orange's Latens](https://github.com/Orange-OpenSource/latens) estimates
  touch-to-render latency for physical touch interfaces. It likewise does not
  isolate either injection path.
- A recent [NeuralBridge report](https://hackernoon.com/i-built-a-100x-faster-android-automation-tool-because-ai-agents-deserve-better)
  claims roughly 2 ms per tap on a Pixel 7 and under 10 ms for its local
  accessibility path over 100 runs. Its number is command/tool completion,
  not a synchronized target-app input timestamp or visible game response, and
  its comparison set does not include UHID. Treat it as an anecdotal lower
  bound on local command overhead, not an input-latency result.
- A [recent AOA-HID implementation report](https://dev.to/luminia210/i-built-a-c-library-to-inject-multitouch-into-android-over-usb-no-root-no-adb-no-app-3fd1d1)
  says raw HID bypasses ADB and supports up to 16 contacts, but publishes no
  latency distribution and describes AOA from a host, not this project's local
  `/system/bin/hid` UHID process.

FGA remains useful deployment precedent: it runs MediaProjection plus
AccessibilityService on-device for a physical handset, but it is a
turn-based game and is not a timing comparison with HID. The project survey
continues in [ANDROID-BOT-LANDSCAPE.md](../research/ANDROID-BOT-LANDSCAPE.md).

## First Moto g56 pilot — 120 Hz, synthetic target only

On 2026-09-06 the connected Moto g56 5G (`<serial>`, Android 16/API 36,
Cue Helper target SDK 36, landscape `2400x1080`) ran both paths against the
same foreground synthetic probe view. The display was temporarily requested
at 120 Hz and the probe reported `refreshHz=120.00001`. The original refresh
settings and disabled accessibility state were restored afterward; FNaF2 was
never targeted and no gameplay input was sent.

The probe received the same single, simultaneous-two-contact, and staggered
contact sequences from both paths. AccessibilityService also demonstrated the
framework cancellation rule: dispatching a second gesture produced
`ACTION_CANCEL` for the first before the replacement `ACTION_DOWN`. The event
provenance was distinct and stable: AccessibilityService used `deviceId=-1`
and `flags=0x800` (`FLAG_IS_ACCESSIBILITY_EVENT`), while UHID used a virtual
device ID and `flags=0x0`.

The following is a receipt-delay pilot, not end-to-end game latency. It uses
the probe's device-monotonic `receiveUptimeMs - eventTimeMs` for 100
single-contact events per cell (50 down/up pairs):

| contact | AccessibilityService | UHID via `/system/bin/hid` |
|---|---:|---:|
| 100 ms | p50 1 ms, max 6 ms; 100/100 events | p50 5 ms, max 9 ms; 100/100 events |
| 17 ms | p50 4 ms, max 7 ms; 100/100 events | p50 4 ms, max 13 ms; 100/100 events |

The 100 ms cell favors AccessibilityService on this target, while the 17 ms
cell ties at the median and has a worse UHID tail in this small pilot. That was
enough to justify a real-game acceptance gate, but not to promote the backend.
The probe does not model FNaF2's 30 Hz polling, app acceptance, contact
continuation across real controls, or game survival.

The retained summary is [`accessibility-hid-pilot-20260906.json`](accessibility-hid-pilot-20260906.json).

## First stock-game acceptance gate — FAIL, 2026-09-06

The Moto g56 was returned to the FNaF2 title screen and the calibrated Custom
Night point `(400,985)` was tested. The debug command was sent through a
windowless broadcast receiver, so the command itself did not replace or focus
the game window. With the service temporarily enabled through an adb secure
setting override (not through a user grant in Android Settings),
`dispatchGesture()` returned `accepted=true` and its callback returned
`completed`; the title screen did not transition. The same 33 ms UHID control
at the same point opened Custom Night.

Earlier activity-based 33 ms, 100 ms, and delayed 100 ms AccessibilityService
attempts produced the same non-transition. The windowless receiver removes
the activity/window race as the explanation, but this test cannot distinguish
whether the stock game filters accessibility-provenance events or Android
routes them differently. It does establish the project-level result:
framework completion was a false positive for FNaF2 acceptance.

This is also not a permission/onboarding qualification. The service was
enabled only for the controlled phone experiment and was disabled afterward;
the user-facing Settings grant, persistence, revocation, and recovery flow
remain untested. The retained gate result is
[`accessibility-game-acceptance-20260906.json`](accessibility-game-acceptance-20260906.json).

## Required project benchmark

Add an actuator qualification fixture before selecting a production backend.
Run both backends on the same phone, build, display mode, CPU/thermal state,
and coordinate profile:

1. single tap, 100 ms hold, and explicit release;
2. two contacts starting together;
3. staggered contact addition while one contact is held;
4. pan plus vent light, flashlight plus camera selection, and every other
   FNaF2 contact combination used by the policy;
5. cancellation, interruption, service restart, and focus loss;
6. 120/133 ms action slots and the current 30 Hz observation boundary.

For each trial retain dispatch acceptance, completion/cancellation, kernel or
framework event timestamps where available, pointer count/action sequence,
device ID/flags, visible target response, and failure cause. Report p50/p95/
p99/p99.9, event gaps, contact-order errors, and game-acceptance rate over at
least 1,000 repetitions per primitive. A successful API callback is not proof
that FNaF2 accepted the contact.

Until a new acceptance path is demonstrated, keep AccessibilityService
debug-only and do not use it as the stock-game controller. UHID remains the
qualified in-night and menu-control baseline. The benchmark result, not an
online latency anecdote or a successful framework callback, decides whether
the backend changes.
