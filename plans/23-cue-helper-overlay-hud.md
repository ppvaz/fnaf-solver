# Companion overlay HUD

**Status: proposed 2026-09-01, Pedro's directive.** Extend the Companion from
an observation surface into a spatially aligned, read-only HUD over the stock
FNaF 2 APK. This plan does not authorize game input and does not promote any
detector or recommendation beyond its existing evidence level.

## Goal

Render sensor and decision state over the same logical game geometry that the
visual pipeline observes:

```text
Android video -----> visual adapter -----\
                                         timestamped facts ---> belief / arbiter
Audio source/adapter (bridge or processor)-/                         |
                                                                  v
                                                        overlay projection
                                                                  |
                                                                  v
                                                               player
```

The overlay has two deliberately different products:

| Mode | Audience | Output |
|---|---|---|
| sensor/debug | engineering and calibration | ROI outlines, detector state, confidence or margin, sample age and processing latency |
| decision/run | player | only a small, spatially relevant action cue such as `MASK`, `WIND`, `CHECK VENT`, `FLASH`, or `SAFE` |

The run HUD must consume the fused belief/decision output. It must not map a
raw pixel directly to imperative text. An `UNKNOWN`, stale, unqualified, or
conflicting fact clears or degrades the cue rather than becoming a confident
recommendation.

## Platform boundary

The proposed Android window is one transparent, full-display custom `View`
owned by the existing foreground capture service:

```text
TYPE_APPLICATION_OVERLAY
FLAG_NOT_FOCUSABLE | FLAG_NOT_TOUCHABLE | FLAG_LAYOUT_IN_SCREEN
PixelFormat.TRANSLUCENT
```

`TYPE_APPLICATION_OVERLAY` is available from API 26 and requires the special
`SYSTEM_ALERT_WINDOW` app-op. Because the Companion targets API 36, the user
must grant it through `Settings.ACTION_MANAGE_OVERLAY_PERMISSION`; the app must
check `Settings.canDrawOverlays()` before adding the window. Permission denial
is a normal `overlay=DISABLED(permission)` state and must not affect capture.

There are three non-negotiable platform gates:

1. **Touch passthrough on Android 12+.** Application overlays are untrusted.
   `FLAG_NOT_TOUCHABLE` expresses the intent to pass touches downward, but the
   system only delivers those touches through a same-UID overlay when its
   obscuring opacity is at or below the system maximum (currently 0.8 for one
   overlay window). Keep exactly one overlay window, query
   `InputManager.getMaximumObscuringOpacityForTouch()` where available, cap the
   window alpha below it with margin, and prove every relevant FNaF control by
   an input passthrough test. Transparent paint alone is not accepted as proof.
2. **Target-app suppression.** Since Android 12, an app can request that
   `TYPE_APPLICATION_OVERLAY` windows be hidden while its window is visible.
   The FNaF 2 APK must be tested on the target build/device. Hidden or detached
   is `overlay=UNAVAILABLE(target-hidden)`, not a supported configuration.
3. **Foreground-service ordering on Android 15+.** Holding the overlay
   permission is no longer, by itself, enough to use that permission's
   background foreground-service-start exemption. If that exemption is ever
   needed, a visible overlay must exist before the service start. The normal
   user-visible Activity -> media-projection consent -> foreground-service path
   remains preferred; the HUD must not introduce a background auto-start.

Official platform references:

- [Window types, flags, and touch-through restrictions](https://developer.android.com/reference/android/view/WindowManager.LayoutParams)
- [`SYSTEM_ALERT_WINDOW` grant contract](https://developer.android.com/reference/android/Manifest.permission#SYSTEM_ALERT_WINDOW)
- [Android 12 overlay hiding](https://developer.android.com/about/versions/12/features#hide-overlay-windows)
- [Android 15 foreground-service restriction](https://developer.android.com/about/versions/15/behavior-changes-15#fgs-saaw-restrictions)

## One geometry authority

Sensor sampling and overlay placement must resolve from the same immutable ROI
definition. Do not maintain parallel CV and UI coordinate tables.

```text
RoiSpec
  id
  normalizedRect        # game-content coordinates, not physical-display pixels
  overlayRect           # optional larger display footprint for a point watch
  detectorId
  overlayAnchor
  debugStyle
  calibrationBinding
```

Conceptually:

```java
record RoiSpec(
    String id,
    RectF normalizedRect,
    RectF overlayRect,
    String detectorId,
    OverlayAnchor overlayAnchor,
    OverlayStyle debugStyle,
    String calibrationBinding,
    ScreenScope screenScope
) {}
```

One resolved rectangle then drives both branches:

```text
content geometry
      |
      +--> crop/sample ROI --> detector --> fact
      |
      +--> display transform --> Canvas ROI/text
```

The canonical rectangle lives in normalized game-content coordinates. A
versioned transform resolves it separately into capture-buffer and physical
display coordinates, accounting for content bounds, rotation, letterboxing,
system-bar insets and display cutouts. A detector calibration remains bound to
its device/game/layout profile; sharing geometry does not make pixel thresholds
portable.

The existing `PixelWatch` specification and the profile-bound visual rules are
the starting authority. This plan should generalize their point/ROI entries
instead of introducing a second `Roi` registry inside the Activity.

## Data boundary

Rendering is a leaf consumer. It may read an immutable snapshot but must never
write detector, belief, policy, or actuator state:

```text
OverlaySnapshot {
  sequence, t_rendered, screen, mode,
  monitorState, monitorReason, selectedCamera, cameraReason,
  regions: [{roiId, factState, value, confidenceOrMargin, ageMs, latencyMs}],
  cue: {action, severity, expiresAt, rationaleFactIds}
}
```

The snapshot carries an expiry. The view clears an expired action cue even if
the producer stalls. Confidence is displayed only when it is defined by the
detector contract; a separation margin, heuristic score, and calibrated
probability must not all be labelled "confidence".

Sensor/debug state is screen-aware: menu, helper, unknown, and other
non-authorizing frames show no game-element annotations; a recognized night
shows only regions established for the current surface. `MONITOR DOWN` shows
office regions; `MONITOR UP` shows camera feed/map areas and the uniquely
selected camera, while camera information is absent for down/unknown states.
Normal monitored regions use a quiet thicker keyline and no verbose per-box
telemetry, while detected/unknown/stale states may receive a short label.
Profile-bound `game-hud-map-v1` zones are collision exclusions for frames and
labels, and the renderer uses short state transitions plus restrained active-
camera emphasis. Detailed age, latency, and typed score data remains in the
signal feed/control socket.
Decision/run state suppresses detector detail and shows only critical cues.
`SAFE` is allowed only when the decision contract has a positively qualified
safe state; silence is not rendered as safe.

## Self-observation and capture feedback gate

A display overlay may become visible in the `MediaProjection` stream. Drawing
the ROI border or label over pixels used by a detector could therefore create
a feedback loop: the HUD changes the evidence that produces the HUD.

Before the overlay can run beside sensing, retain paired frames with HUD off
and on and determine whether the Companion window appears in the captured
buffer on every supported OS/device configuration. Promotion requires one of
these measured designs:

- the platform capture demonstrably excludes the overlay;
- overlay paint is outside every sampled point/ROI, with a proved guard band;
- capture and render are explicitly phase-separated and the detector accepts
  only frames known to have no overlay content; or
- the HUD is automatically disabled while authoritative sensing is active.

Merely using transparent fills is insufficient: borders, antialiasing, text,
and compositor timing can still contaminate samples. The full-screen helper
identity gate must also prove that the overlay cannot make a non-game screen
look like `FNAF2_NIGHT`.

## Packages

### P1 — shared ROI and overlay snapshot contracts (host-testable)

- Extract a versioned geometry contract from `PixelWatch` without changing its
  current wire grammar.
- Add pure transforms for content -> capture and content -> display space.
- Add immutable `OverlaySnapshot` validation, cue expiry, and `UNKNOWN` rules.
- Add calibrated monitor-up/down and exactly-one-selected-camera facts to the
  snapshot; gate office/camera regions on those facts.
- Add a shared read-only flashlight-meter battery fact from the four visible
  game-UI bar compartments; retain the last usable night snapshot through
  short projection gaps without retaining decision cues.
- Add profile-bound HUD exclusion zones and collision-safe annotation placement.
- Test native g56 landscape, rotation, letterbox/insets, invalid rectangles,
  stale snapshots, and calibration/profile mismatch.

### P2 — overlay permission and lifecycle shell

- Declare `SYSTEM_ALERT_WINDOW` and add an explicit **Enable overlay** flow.
- Report `DISABLED`, `READY`, `VISIBLE`, `HIDDEN`, and `ERROR` independently
  from MediaProjection state.
- Attach one fullscreen `OverlayView` to `WindowManager`; detach it on capture
  stop, service destruction, permission revocation, or display change.
- Never create an interactive overlay or silently open the settings screen.

### P3 — sensor/debug renderer

- Draw all regions in one custom `Canvas` pass.
- Provide monitored, detected, `UNKNOWN`, stale, and unqualified styles.
- Render the live monitor state and selected camera only on the recognized
  night surface, with bounded transitions that do not change sensor geometry.
- Keep camera annotations hidden while the monitor is down and hide any
  frame/label that intersects a calibrated game-HUD exclusion zone.
- Keep the last usable sensor/debug geometry through short UNKNOWN detector
  gaps, clearing immediately on confirmed non-night identity or expiry.
- Show typed score/margin, state, frame age, and measured detector latency.
- Rate-limit redraws and coalesce snapshots so rendering cannot back-pressure
  acquisition or belief updates.

### P4 — decision/run renderer

- Map approved decision states to a small fixed cue vocabulary and spatial
  anchors; no arbitrary detector-generated text.
- Add severity, expiry, cooldown, priority, and conflict behavior.
- Default to no cue. Clear immediately on screen identity loss, stale belief,
  capture loss, target-app loss, or session stop.

### P5 — device feasibility and interference qualification

- Verify the overlay is visible over the exact FNaF 2 APK/build on the g56.
- Exercise every game control with the overlay present and retain acceptance
  evidence; test at the chosen alpha and with any other active overlay removed.
- Compare MediaProjection frames HUD off/on and close the feedback gate above.
- Measure render cadence, detector latency delta, dropped frames, CPU, memory,
  thermal state, and p50/p95/p99 update-to-photon latency.
- Verify rotation, interruptions, permission revocation, service restart, app
  switch, lock/unlock, capture end, and target-hidden behavior.

### P6 — observe-only night, then player-facing qualification

- First run sensor/debug mode as telemetry only; it cannot affect the decision
  or actuator.
- Then run decision mode as read-only coaching, grade cue correctness and late,
  stale, conflicting, and missing cues against retained video/state traces.
- Any future use of overlay-derived human response in a 10/20 claim belongs to
  Plan 12's promotion ladder; this plan alone creates no gameplay claim.

## Acceptance criteria

The plan is complete only when:

1. one geometry definition reproduces capture and display rectangles on the
   target profile;
2. FNaF receives every tested touch with the overlay visible;
3. the target APK does not suppress the overlay, or the configuration is
   explicitly marked unsupported;
4. the HUD cannot contaminate authoritative detector input;
5. stale/unknown/unqualified state never renders an imperative action or
   `SAFE`;
6. overlay teardown is deterministic on every session-ending path; and
7. a retained observe-only run quantifies latency and resource impact before
   run mode is presented as usable.

## Dependencies

- Plan 19 owns visual acquisition, watchlists, detector calibration, and
  observe-only reaction.
- Plan 20 owns belief/fusion and the decision that the run HUD visualizes.
- Plan 14 owns device/content/display geometry profiles.
- Plan 12 owns any promotion from engineering display to a 10/20 claim.
- Plan 24 owns optional contextual prediction/microtraining after this plan's
  non-interactive overlay and safety gates are qualified; it cannot weaken
  critical-cue priority or turn this window into a response surface.
- [`REAL-TIME-CLOSED-LOOP-ARCHITECTURE.md`](../docs/device/REAL-TIME-CLOSED-LOOP-ARCHITECTURE.md)
  remains authoritative for the contract boundary. An ESP32 is only one
  possible deployment node and may be a bridge, processor, reflex node, or
  absent; the overlay consumes qualified facts/belief independently of where
  samples were transported or processed.
