# FNaF 2 Companion

The APK owns only the user-approved `MediaProjection` visual stream:

- one persistent `20x9` `VirtualDisplay` backed by an `ImageReader`;
- direct RGBA sampling of logical pixel `(3,6)`; and
- the authenticated loopback/abstract control sockets used by the device
  harness.

## Current boundary and hostless target

The visual capture service remains a read-only measurement boundary, while the
APK now includes a bounded Night 6 `MODEL_ONLY` route. The route expands the
reviewed canonical plan and sends UHID reports through a user-started Termux
bridge; it stops when capture leaves the night screen. It is not a promoted
controller: the visual arm proof and the outcome still require separate device
grading. The architectural target is for FNaF 2 Companion to become the full
device authority — capture, lifecycle/game-state reducer, belief, safety
arbiter, campaign controller, and a qualified local actuator — while the PC is
retained only for build, calibration, replay, evidence, and telemetry.

AccessibilityService remains a framework candidate, not a qualified FNaF2
actuator. The 2026-09-06 real-game gate returned framework completion without
the title screen accepting the tap, while the same UHID tap opened Custom
Night; the service had also been enabled temporarily through adb rather than a
user-facing Settings grant. Because this APK targets
SDK 36 on the 120 Hz target phone, Android's modern gesture generator should
sample paths at roughly 8 ms rather than the pre-Android-11 100 ms interval.
That is not yet a FNaF2 timing or contact-fidelity result. A later dispatch can
cancel an active gesture, and the project must still measure staggered contact
addition, pan/light overlap, release behavior, and game acceptance against the
existing UHID path. The benchmark and online-research conclusion are recorded
in [`ACCESSIBILITY-VS-HID-BENCHMARK.md`](../../docs/device/ACCESSIBILITY-VS-HID-BENCHMARK.md).

The APK has no audio path. Rendered audio is the phone's A2DP mix, recorded
and decoded on the host (`packages/play/bin/audio/bt-audio-link.sh`, `packages/play/bin/audio/capture-bt-audio.sh`,
`packages/play/bin/audio/fnaf4-cues.py`). The ESP32 receiver path (UDP health facts and PCM on
49709/49710, the managed Wi-Fi request, the phone-side analyzer, monitor and
recorder) and the authenticated audio-fact port 49708 were removed on 2026-09-27;
see `docs/ARCHIVED-ROUTES.md`.

The visual path reports `OBSERVED` values rather than making an empty/threat
claim. Its pixel rule must be recalibrated against frames from the exact target
device before it may control an action. The APK is measurement plumbing, not a
promoted controller.

The only overlay windows are the per-game teach panels (below). The
full-screen sensor/debug HUD, its decision/run renderer and its self-capture
qualification gate -- which never qualified, so every status line read
`overlay=DISABLED(self-capture-unqualified) gate=UNQUALIFIED` -- left on
2026-09-27 together with the watchlist ROIs it drew. A panel's clearance from
what the helper reads is proved by geometry, never by opacity: Android
composites an untrusted overlay at no more than 0.8 alpha.

FNaF 2's remaining on-device readers -- the 20x9 lattice and its grid-fitted
screen identity, the night-onset latch, the two control strokes, the twelve
camera-button pixels and the frozen `fnaf2-frame-trace-v3` -- are quarantined in
[`Fnaf2Legacy.java`](src/com/ppvaz/fnafcompanion/Fnaf2Legacy.java), with the
list of live consumers that keep each one. Luma reducers, the single-pixel
sample, the CAM 05 block, grid statistics (`grey`, `gridLuma`), the pan anchor,
the flashlight-meter bars, the Balloon Boy and Foxy hall channels, and the
on-device camera-selection and battery facts had no live reader and were
removed. The remaining readers are to be converted to REGION rules on the host
after recalibration (CLAUDE.md), not extended.

## Build and install

The build is intentionally Gradle-free. It uses the installed Android 36 SDK
and a JDK directly:

```sh
android/companion/build.sh
adb install -r android/companion/build/fnaf-companion.apk
adb shell am start -n com.ppvaz.fnafcompanion/com.ppvaz.fnafcompanion.MainActivity
```

The image-free setup/menu protocol can be run after the APK is built:

```sh
packages/play/bin/companion/companion-setup.sh --install       # install, start capture, check FNaF menu
packages/play/bin/companion/companion-setup.sh                 # reuse an active capture and check menu
packages/play/bin/companion/companion-setup.sh --overlay-mode debug # persist SENSOR / DEBUG mode
packages/play/bin/companion/companion-setup.sh --overlay-mode run   # persist DECISION / RUN mode
packages/play/bin/companion/companion-setup.sh --probe         # optional debug-only sensor probe
packages/play/bin/companion/companion-setup.sh --screen night --probe  # wait for a manually entered night
packages/play/bin/companion/companion-setup.sh --stop          # force-stop helper capture for cleanup
```

It resolves the target launcher and build, discovers helper/system buttons by
UIAutomator text and bounds, handles projection consent, starts FNaF with
`am start`, and verifies the requested screen identity through the authenticated
socket (`FNAF2_MENU` by default, or `FNAF2_NIGHT`).
When `--overlay-mode` is supplied, setup converges the helper's persisted mode
through the named CONFIG button; without it, the existing mode is preserved.
`--probe` remains debug-only and cannot be combined with `--overlay-mode run`.
It never sends a game-control coordinate, takes a screenshot, or writes the
qualification sidecar. Use `--probe` only for debug sensor observation; the
production gate remains unqualified.

If the SDK or JDK is elsewhere, set `ANDROID_SDK_ROOT` or `JAVA_HOME`. Generated
build output and the local debug keystore are ignored.

`android/companion/test.sh` compiles the pure-Java helpers (native regions,
teach lessons, the FNaF 2 legacy readers, the route bundles' HID controls)
against host unit tests.

The route runner holds no device geometry. Each route bundle under
`assets/runners` carries `hid-controls.txt`, every control's raw HID point as
the host's transport derives it from the bundle's `profile.json`
(`packages/play/src/venues/phone/hid.js` `hidControlsText`), naming that
profile's sha256; `HidControls` reads it, refuses one bound to another profile,
and `NightRunner` refuses a plan that uses a control the file does not name.
Until 2026-09-30 `NightRunner` kept its own control map and 2400x1080 transform.
Regenerate the files with `node packages/play/bin/companion/hid-controls.mjs
DIR...`; `test-screen-map.mjs` holds them to the transport.

On the phone, tap **Start video capture** and grant screen-capture consent, then
open the game. No other permission is needed for capture.

## Snapshot boundary

The APK's authenticated control socket serves visual observations and
read-only overlay telemetry; it has no input or actuator operation. A fresh
128-bit token is created per consented run. Every request is one bounded ASCII
line; malformed, oversized, or unauthenticated requests receive an error and
no sensor data.

| Request | Response | Notes |
|---|---|---|
| `STATUS <token>` | `OK schema=companion-status-v1 ...` | The versioned status line, for any target (`CompanionStatus.java`; host parser `packages/play/src/venues/phone/companion-status.js`; both held to `packages/play/test/testdata/companion-status-v1.txt`). |
| `TARGET <token> [<package>\|<game>\|clear]` | `OK target=... game=... legacy=...` | Read or name the target (`Targets.java`, `packages/play/profiles/fnaf2/moto-g56/companion-targets-v1.json`). The FNaF 2 legacy readers run only while it is retail FNaF 2; refused while a FNaF 2 trace runs. |
| `LEASE <token> <label>\|clear` | `OK lease=...` | A label for the phone's screen naming who holds the host's serial lease; the lease itself stays the host's lock. |
| `GET <token>` | `OK <snapshot>` | FNaF 2 legacy snapshot (`Fnaf2Legacy.snapshotLine`): freshness, the grid-fitted `screen`, the stroke-derived `monitorUp`, both control stroke scores, the latched `nightOnsetImageNs` and the phone's `wallMs`; never an image. |
| `FRAME <token>` | `OK ...snapshot... grid=20x9 cells=<180x6 hex>` (FNaF 2 legacy) | The snapshot fields AND the sensor from ONE locked read, so both describe the same frame and share one `seq`. GET followed by GRID cannot: they are two round trips against a 60 fps capture, and on the moto g56 their sequences agreed 0 times in 12, always 1-2 frames apart, so any detector needing freshness AND cells refused every observation. Use this verb for live detection. |
| `WATCH <token> status\|<hash>` | `OK watch=...` | Inspect or activate the FNaF 2 camera watch: the twelve measured monitor-map camera-button pixels. |
| `READ <token>` | `OK read=...` | Read the camera watch: every button's yellowness (or UNKNOWN) with the frame's sequence and age stamp. |
| `OVERLAY <token>` | `OK overlay=...` | Overlay permission and each teach panel's state. |
| `LESSON <token> begin\|row\|commit\|origin\|clear\|status ...` | `OK ...` or `ERROR <reason>` | The teach panel's lesson (debug builds): the host uploads the schedule it is about to run, then names its origin against this service's own latched onset. It writes only the panel's lesson; see "Teach panel" below. |

The socket still has no input or actuator operation: `LESSON` changes what the
teach panel narrates and nothing that is sensed, latched, or sent to the game.

`CAL`, `LOG`, `ARM`, `RESULT`, `REC` and `MODEL` are not APK commands; the APK
has no audio operation at all.

The two visual channels are:

| Channel | Endpoint | For |
|---|---|---|
| loopback TCP | `127.0.0.1:49707` | the on-device visual controller |
| abstract unix | `@com.fnaf2.cuehelper.control.<session>` | host tooling over `adb forward` |

```sh
packages/play/bin/companion/query-companion.sh                    # loopback snapshot
packages/play/bin/companion/query-companion.sh forward            # forwarded snapshot
packages/play/bin/companion/query-companion.sh watchlist status
packages/play/bin/companion/query-companion.sh overlay             # teach-panel status
```

The Java namespace, APK id, and source tree use `com.ppvaz.fnafcompanion`.
The abstract-socket and `com.fnaf2.cuehelper.action.*` wire identifiers remain
stable for `cue-helper-control-v1` host compatibility; they are protocol names,
not the public app name.

Projection stop tears down the visual display and both control workers, so a
new consent session can start in the same app process. The service remains
`START_NOT_STICKY` and never tries to reuse consent after process death.

## Teach panel

A demonstration aid for someone watching the bot play: a 580x100 panel at the
left of the office that narrates the cycle the executor is running. Its ring is
the cycle (outer band: the surface the schedule intends, office, cams, or mask;
inner band: the hall and camera flashes and the wind; the hand is now). The text
names the current step, why it is in the schedule, the time left in it, the next
step, the game hour, and `seen`, the helper's own reading of the bottom
controls. `seen` is the only observation on the panel; everything else is the
schedule.

`night-run.sh --live --confirm-live --teach-overlay` drives it. At the attempt's menu the host sends
the compiled artifact's semantic actions (`packages/play/src/coach/cycle-lesson.js`),
which `CycleLesson.java` re-expands with the executor's own repeat rule and
refuses unless the rows hash to the id the host sent. After the anchored
release the host sends `origin <onsetNs> <afterOnsetUs>`, and the helper
narrates from its own latched onset plus that interval, so no host clock enters
the panel. The words are a fixed vocabulary in the APK, keyed by verb.

The panel is one window of exactly `packages/play/profiles/fnaf2/moto-g56/teach-panel-v1.json`'s
rectangle (its buffer is opaque; the platform composites it at the 0.8 cap for
untrusted overlays, so a fifth of the game shows through), shown only over a night (or a dark frame whose bottom controls are
still read) and removed at once on any other positive screen. It never paints a
pixel a reader samples: `TeachPanelTest.java` drives every native reader over a
recording frame and `packages/play/bin/companion/test-teach-panel-clearance.py` checks the host
night authority, the lifecycle boxes, the video grader's bands, and the control
points. One helper reader cannot avoid any panel -- the native lifecycle labels
-- and is withheld (grid-only identity) for every frame captured while the
panel may be on screen. A teach
run's video carries the panel, so it is graded with
`run-timeline.py --exclude-rect 10,310,590,410`, not `grade-run.sh`.

## Consent without a tap

On the development phone, this app-op can short-circuit the projection dialog:

```sh
adb shell appops set com.ppvaz.fnafcompanion PROJECT_MEDIA allow
adb shell appops set com.ppvaz.fnafcompanion PROJECT_MEDIA default   # undo
```

Leave it at `default` unless a harness run needs it. This affects screen
capture for this app only.

## Target-device visual result

The API-36 Moto g56 previously delivered the `20x9` stream at approximately
60 frames/s during animated content, with typical image-timestamp-to-callback
age around 1–3 ms. A 40-minute memory soak is still required before visual
stability is considered proven:

```sh
packages/play/bin/companion/soak-companion.sh
```

The soak checks helper lifetime, focus, visual sequence progress, content
geometry/visibility, status freshness, PSS/RSS, thread count, and thermal
status. Preserve the existing screencheck/HID path until the
independent visual holdout and full-night gates pass.
