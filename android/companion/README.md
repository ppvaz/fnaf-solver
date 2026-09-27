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
and decoded on the host (`tools/cue/bt-audio-link.sh`, `tools/cue/capture-bt-audio.sh`,
`tools/cue/fnaf4-cues.py`). The ESP32 receiver path (UDP health facts and PCM on
49709/49710, the managed Wi-Fi request, the phone-side analyzer, monitor and
recorder) and the authenticated audio-fact port 49708 were removed on 2026-09-27;
see `docs/ARCHIVED-ROUTES.md`.

The visual path reports `OBSERVED` values rather than making an empty/threat
claim. Its pixel rule must be recalibrated against frames from the exact target
device before it may control an action. The APK is measurement plumbing, not a
promoted controller.

The APK now contains a permission-gated, read-only overlay shell. **Enable
overlay** opens the explicit `SYSTEM_ALERT_WINDOW` settings flow; the service
owns exactly one `TYPE_APPLICATION_OVERLAY` window with
`FLAG_NOT_FOCUSABLE | FLAG_NOT_TOUCHABLE`, a conservative alpha below
`InputManager.getMaximumObscuringOpacityForTouch()`, and independent
`DISABLED`, `READY`, `VISIBLE`, `HIDDEN`, and `ERROR` status. The sensor/debug
and decision/run renderers consume immutable snapshots derived from the same
normalized regions as `PixelWatch`; run mode has no cue until a qualified
belief/arbiter producer supplies one.

The self-observation gate is deliberately **unqualified by default**. No
overlay is attached beside authoritative sensing until retained HUD-off/HUD-on
evidence proves that capture excludes the overlay, the protected regions have a
guard band, or capture is phase-separated. A raw transparent paint choice is
not evidence. The gate and host regressions are in
[`OverlayCaptureGate.java`](src/com/ppvaz/fnafcompanion/OverlayCaptureGate.java),
and the complete platform/self-capture qualification remains specified in
[`plans/23-cue-helper-overlay-hud.md`](../../plans/23-cue-helper-overlay-hud.md).
The device execution matrix and retained evidence schema are in
[`OVERLAY-QUALIFICATION.md`](../../docs/device/OVERLAY-QUALIFICATION.md).

Debug builds also expose an explicit **Start qualification probe** button. It
temporarily permits only the sensor/debug renderer so the observer can measure
HUD-on capture feedback; it reports `overlay=PROBE`, never accepts decision
cues, never changes the qualification sidecar, and is not a supported run HUD.

The debug HUD is screen-aware and intentionally quiet. Its status badge says
`MENU`, `INTRO`, or `GAME OVER` on those positively identified lifecycle
screens; those screens render no game-element boxes. On a recognized night the
compact badge reports `MONITOR UP`, `MONITOR DOWN`, or `MONITOR ?`. Office
regions are shown only while the monitor is down; the camera feed/map areas are
shown only while it is up, and the one calibrated yellow map button is marked
`CAM NN ACTIVE`. Camera selection is never retained or displayed while the
monitor is down. Normal regions use thicker double-keyline frames without
per-box age/latency text; state changes ease in over a short transition and the
active camera has a restrained pulse. Labels use the bundled CC0 `HUD FONT`
asset from `assets/fonts/hud-font.otf`.

The same native watchlist reads the four bright interior compartments of the
stock top-left `flashlight` meter. The debug badge and authenticated snapshot
report this as `battery=OBSERVED percent=... bars=.../4`; missing, foreign, or
non-night reads are `battery=UNKNOWN`. Short UNKNOWN projection gaps retain the
last usable night snapshot for 350 ms, so ROI frames and the battery badge do
not blink, while a confirmed menu/helper identity clears them immediately.

The renderer also accepts a profile-bound `game-hud-map-v1` collision map. Each
calibrated game HUD zone is an exclusion for overlay frames and labels, and
labels additionally avoid one another. The default map is empty until a zone
has retained calibration evidence, so this does not invent coverage for HUD
areas that have not been measured yet.

The visual status also carries a fail-closed screen identity gate. It reports
`screen=CUE_HELPER` only when the 20x9 sensor matches the stable helper layout
calibrated from the retained portrait and landscape frames. A native full-frame
check adds the generic intro-card and Game Over labels; it does not read the
night ordinal. A valid frame that does not match the helper or a supported
FNaF 2 lifecycle screen is `screen=UNKNOWN`; it is not promoted to Android
settings or any other semantic screen. This prevents a capture of the helper
UI itself from being interpreted as game content. While the HUD is enabled, the
controller attaches only for a positively identified FNaF 2 screen and keeps
game-element annotations/cues restricted to `FNAF2_NIGHT`; an app switch
therefore fails closed as `UNAVAILABLE(target-not-game) state=HIDDEN`, and a
later valid game frame may reattach it.

## Build and install

The build is intentionally Gradle-free. It uses the installed Android 36 SDK
and a JDK directly:

```sh
android/companion/build.sh
adb install -r android/companion/build/fnaf2-companion.apk
adb shell am start -n com.ppvaz.fnafcompanion/com.ppvaz.fnafcompanion.MainActivity
```

The image-free setup/menu protocol can be run after the APK is built:

```sh
tools/device/cue-helper-setup.sh --install       # install, start capture, check FNaF menu
tools/device/cue-helper-setup.sh                 # reuse an active capture and check menu
tools/device/cue-helper-setup.sh --overlay-mode debug # persist SENSOR / DEBUG mode
tools/device/cue-helper-setup.sh --overlay-mode run   # persist DECISION / RUN mode
tools/device/cue-helper-setup.sh --probe         # optional debug-only sensor probe
tools/device/cue-helper-setup.sh --screen night --probe  # wait for a manually entered night
tools/device/cue-helper-setup.sh --stop          # force-stop helper capture for cleanup
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
teach lessons, the FNaF 2 legacy readers) against host unit tests.

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
| `GET <token>` | `OK <snapshot>` | Current monotonic visual snapshot; never an image. The visual line carries the whole-grid statistics `grey` (near-grey cell count) and `gridLuma` (grid mean luma) — verdict-free features a calibrated consumer may fit rules against. |
| `GRID <token>` | `OK grid=20x9 ...` | Full visual sensor grid (180 point samples, row-major). |
| `FRAME <token>` | `OK ...snapshot... grid=20x9 cells=<180x6 hex>` | The snapshot fields AND the sensor from ONE locked read, so both describe the same frame and share one `seq`. GET followed by GRID cannot: they are two round trips against a 60 fps capture, and on the moto g56 their sequences agreed 0 times in 12, always 1-2 frames apart, so any detector needing freshness AND cells refused every observation. Use this verb for live detection. |
| `WATCH <token> status\|<hash>` | `OK watch=...` | Inspect or activate the native visual watchlist (25 entries: 4 existing anchors + 4 flashlight-meter bars + 12 measured monitor-map camera buttons + 3 provisional Foxy hall channels + 2 paired bottom-control ROIs). |
| `READ <token>` | `OK read=...` | Read the active visual watchlist: every entry's value (or UNKNOWN) with its own sequence and age stamp. The response also carries the observation-only bulb anchor (`pan_anchor_x`, `pan_anchor_y`, sampled component area/margin, confidence, and refusal reason). |
| `OVERLAY <token>` | `OK overlay=...` | Read-only HUD lifecycle, qualification gate, and bounded update/draw/drop/latency counters for retained device evidence. The line ends with `teach=<state>` for the teach panel. |
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
tools/device/query-cue-helper.sh                    # loopback snapshot
tools/device/query-cue-helper.sh forward            # forwarded snapshot
tools/device/query-cue-helper.sh grid               # render the visual grid
tools/device/query-cue-helper.sh watchlist status
tools/device/query-cue-helper.sh overlay             # HUD status and timing counters
tools/device/validate-overlay-qualification.py RECORD.json
tools/device/provision-overlay-qualification.sh RECORD.json --replace
tools/device/overlay-qualification-observe.sh 60 1 captures/cue-helper/overlay-on.tsv
```

The Java namespace, APK id, and source tree use `com.ppvaz.fnafcompanion`.
The abstract-socket and `com.fnaf2.cuehelper.action.*` wire identifiers remain
stable for `cue-helper-control-v1` host compatibility; they are protocol names,
not the public app name.

Provisioning accepts only a structurally valid, reviewed record and writes an
atomic private sidecar; it does not grant overlay permission or make the HUD
qualified. Restart the capture session after provisioning so the service reloads
the sidecar. Run the observer separately with
`CUE_HELPER_OVERLAY_PHASE=off` for the paired baseline, or `probe` while the
debug-only qualification probe is active. The sampler retains native watchlist
values on every row; these are evidence inputs, not an automatic qualification.

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

`night-run.sh --teach-overlay` drives it. At the attempt's menu the host sends
the compiled artifact's semantic actions (`apps/device/src/cycle-lesson.js`),
which `CycleLesson.java` re-expands with the executor's own repeat rule and
refuses unless the rows hash to the id the host sent. After the anchored
release the host sends `origin <onsetNs> <afterOnsetUs>`, and the helper
narrates from its own latched onset plus that interval, so no host clock enters
the panel. The words are a fixed vocabulary in the APK, keyed by verb.

The panel is one window of exactly `tools/device/models/teach-panel-v1.json`'s
rectangle (its buffer is opaque; the platform composites it at the 0.8 cap for
untrusted overlays, so a fifth of the game shows through), shown only over a night (or a dark frame whose bottom controls are
still read) and removed at once on any other positive screen. It never paints a
pixel a reader samples: `TeachPanelTest.java` drives every native reader over a
recording frame and `tools/device/test-teach-panel-clearance.py` checks the host
night authority, the lifecycle boxes, the video grader's bands, and the control
points. Two helper readers cannot avoid any panel -- the `screen_grey_cells`
lattice and the native lifecycle labels -- and are withheld (UNKNOWN, grid-only
identity) for every frame captured while the panel may be on screen. A teach
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
tools/device/soak-cue-helper.sh
```

The soak checks helper lifetime, focus, visual sequence progress, content
geometry/visibility, status freshness, PSS/RSS, thread count, and thermal
status. Preserve the existing screencheck/HID path until the
independent visual holdout and full-night gates pass.
