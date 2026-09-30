# One-pixel vision: building the cheapest useful on-device sensor

*Case study recorded 2026-08-24. This is an educational design note, not yet a
production classifier or an authorization to use the experimental BB branch for
a full night.*

## Result

Computer vision does not have to mean recognizing objects or reconstructing a
scene. A controller only needs enough information to choose its next safe
action. For one tightly controlled FNaF 2 view, the useful question is not
"where is Balloon Boy?" but:

```text
Is the lit left opening exactly the known-safe empty state?
```

On the retained target-device frames, one source pixel at `(451,730)` answers
that narrow question:

| Retained, de-duplicated class | Frames | RGB at `(451,730)` | Integer luma |
|---|---:|---:|---:|
| labeled empty opening | 39 | `(144,209,255)` | 194 |
| Balloon Boy in opening | 4 | `(0,0,0)` | 0 |
| Balloon Boy inside office | 2 | `(0,0,0)` | 0 |

The difficult frame in which translucent Golden Freddy overlays Balloon Boy
also leaves this pixel black. Across all 161 retained `bb-left` frames, including
unlabeled and model-labeled material, the pixel rule agreed with the existing
template model's binary empty/threat decision 161/161. That larger comparison is
useful regression evidence, but it is **not** 161 independent ground-truth
labels and must not be reported as classifier accuracy.

This suggests a very small production observation: ask Android for a `20x9`
aspect-correct image and read logical pixel `(3,6)`. That image contains only 180
logical pixels, or 720 bytes of RGBA before row padding. An offline bilinear
simulation retained a large separation at that cell: empty luma about 102,
versus 0–1 for the retained threat frames.

The conclusion is deliberately provisional:

- `[CALIBRATED]` one pixel separates the retained frames in this exact view;
- `[INFERRED]` a tiny `MediaProjection` surface may remove most buffer and CPU
  work;
- `[UNPROVEN]` the target phone's real compositor will produce the same small
  image, latency, and separation all night.

The next experiment is therefore a quality/latency ladder on the real helper
APK, not immediate deletion of the existing ROI classifier.

## 1. Vision is a question, not an image

Humans look at the frame and see an office, a vent, lighting, characters, and
motion. A bot should begin one level earlier: **which hidden game state changes
the action?** It can then search for the cheapest observable feature that
separates the relevant states.

```text
rich screen image
      |
      v
stable view and timing window
      |
      v
small region -> tiny grid -> one discriminating cell
      |
      v
SAFE_EMPTY / THREAT_OR_UNKNOWN
      |
      v
controller action
```

This is still computer vision. The "model" is simply a manually discovered
feature, a threshold, and a rejection rule. A neural network is useful when the
invariance cannot be expressed cheaply; it is not the definition of vision.

The progression in this project illustrates increasing compression:

1. Transfer and inspect a full screenshot on the host.
2. Capture the full screen but classify it on the phone.
3. Compare a small ROI or normalized RGB template.
4. Ask the compositor for a tiny full-screen surface.
5. Read one logical cell from that surface.

Every step discards information. The engineering task is to prove that it
discards only information the controller does not need.

## 2. Follow the cost upstream

The current stock-device path is:

```text
SurfaceFlinger -> `screencap` full display -> native streaming classifier
```

On the connected Moto g56 in 2400x1080 landscape, 30 interleaved samples
measured:

| Work | p95 |
|---|---:|
| full-display `screencap` | 206 ms |
| classify one saved 10.4 MB RGBA frame | 42 ms |
| capture and classify together | 225 ms |

The combined value is not the sum of the two independent p95s, but the result is
clear: capture dominates. Replacing the integer template distance with a still
smaller classifier cannot recover most of the 225 ms while `screencap` continues
to compose a 2.59-million-pixel display.

### The projection path, measured (2026-08-24)

The prediction above has now been tested. The Companion keeps one consented
`MediaProjection` producing a 20x9 virtual display and answers a device-local
socket with the already-classified pixel, so a reader pays neither the
full-display compose nor the classification. On the same handset, 60
interleaved samples taken entirely inside one device shell:

| Work | p50 | p95 | p99 | max |
|---|---:|---:|---:|---:|
| snapshot read, shell client | 48.8 ms | **59.5 ms** | 60.8 ms | 66.9 ms |
| the same loop with the socket call removed | 22.5 ms | 31.6 ms | 32.2 ms | 32.6 ms |

So the observation costs **59 ms at p95 against 225 ms**, a 3.8x reduction, and
less than half of what remains is the socket: the exchange itself is about
26 ms at p50, and the other 22 ms is the shell forking `date` and `nc`. A
device-local C client on the same socket would pay close to the 26 ms, because
the expensive part of the old path -- composing 2.59 million pixels -- is no
longer performed at read time at all. The projection does that work
continuously at 60 fps in another process, and the reader collects a value.

Two caveats. The read returns the *freshest* frame rather than a frame captured
on demand, so its age is reported in the snapshot (`ageUs`) and a stale frame
is `UNKNOWN`; and this measures the read, not a decision, because the classifier
threshold on this path is not yet calibrated -- the luma figures in this
document come from `screencap` frames and an offline bilinear simulation, not
from Android's own VirtualDisplay scaler.

This is a general profiling lesson: optimize the earliest expensive stage that
cannot be skipped. A one-pixel decision downstream of a full-resolution
screenshot still pays for a full-resolution screenshot.

### Where a hash fits

A virtual display and a hash solve different stages:

```text
VirtualDisplay -> pixel buffer -> feature or hash -> decision
     capture                         classification
```

A hash cannot avoid capture. Hashing a 2400x1080 screenshot still pays the
measured full-display capture cost and must read pixels before producing the
digest. A cryptographic hash is also the wrong visual feature: harmless static,
animation, or one changed pixel gives an unrelated digest. A perceptual hash is
more tolerant, but first downsamples and normalizes a region and then compares
many values—the work our one-cell rule is trying to eliminate.

For this narrow question, the expected cost order is:

```text
tiny VirtualDisplay + one pixel threshold
    < tiny VirtualDisplay + small ROI/template or perceptual hash
    << full-resolution `screencap` + any hash
```

That ordering is an architectural expectation, not a measured Android result.
The compositor may dominate both tiny-buffer variants, so benchmark them on the
target device. Hashes remain useful off the control path for exact frame
deduplication, dataset integrity, and detecting whether a supposedly frozen
calibration asset changed.

## 3. One source pixel is not a `1x1` capture

There are two different ideas that sound like "capture one pixel":

1. **Source crop:** ask the graphics system for source coordinate `(451,730)`.
2. **Whole-frame downscale:** shrink the entire display to a tiny image, then
   read the cell that covers the source coordinate.

Android's public `MediaProjection.createVirtualDisplay()` takes an output width,
height, density, and `Surface`; it does not expose a source rectangle. Since
Android 12L, captured content is uniformly scaled and centered while preserving
aspect ratio. A `1x1` output would therefore collapse the entire screen into one
value rather than select `(451,730)`. See Android's
[`MediaProjection` guide](https://developer.android.com/media/grow/media-projection).

The smallest exact integer form of this 20:9 landscape view that retains a
spatial grid is `20x9`. The original source coordinate maps approximately to
logical cell `(3,6)`. ~~The cell is an aggregate of nearby source pixels, so its
value is not the source pixel's original RGB; that is why the downscaled result
must be recalibrated separately.~~

> **Corrected 2026-08-26 — the cell is not an aggregate. It is a point sample.**
> Measured on the phone, not assumed. With a selected camera button on screen,
> the helper's own grid returns a cell of exactly `rgb(194,221,0)`, yellowness
> `min(r,g)-b = 194` -- the button's own unblended colour. A box-average of the
> *same* screen, computed from a `screencap` taken at the same moment, gives
> yellowness **46**. An averaging scaler cannot return 194; only a scaler that
> reproduces one source pixel can. Across six different cameras with the button
> in six different map positions the value came back byte-identical at 194,
> which averaging also cannot produce -- coverage fraction would vary and so
> would the mean.
>
> The mechanism is ordinary: minifying 2400x1080 to 20x9 is a 120x reduction
> with no mipmap chain, so bilinear filtering degenerates to aliasing. The
> helper is therefore **not looking at a small image of the screen. It is
> looking at ~180 individual source pixels**, spaced roughly 120x120 apart.
>
> This inverts the recalibration advice above. The values do not need
> re-deriving because they are blended; they need re-deriving because they are
> a *lottery*. The consequence is the one that matters for classifier design:

**Any feature smaller than the ~120x120 sample pitch is detected only if a
sample point happens to land on it.** Measured 2026-08-26 by selecting each of
the twelve cameras in turn and reading the helper's grid, with `screenstate.py`
confirming the game was alive at every step:

| | cameras detected |
|---|---|
| lit camera button present (`screencap`, full resolution) | **12 / 12** (1064-2165 px) |
| same button seen by the helper's grid | **7 / 12** (yellowness 194 or 0-10, nothing between) |

There is no middle value in that second row, which is the point-sampling
signature: the sample lands on the button or it does not. So a point-feature
anchor on this sensor is not "noisy", it is a coin flip with fixed odds set by
geometry -- and no threshold change can repair it. `luma` at `VISUAL_X=3,
VISUAL_Y=6` is one such point feature: it is literally one source pixel out of
2,592,000.

The anchors that survive this sensor are **whole-frame statistics**, which
aggregate all 180 samples and so cannot be defeated by where any one of them
falls. See `ON-DEVICE-VALIDATION.md` §"Which anchor survives a point-sampling
sensor".

| Resolution | Logical pixels | RGBA payload* | Reduction from 2400x1080 |
|---|---:|---:|---:|
| 2400x1080 | 2,592,000 | 9.89 MiB | 1x |
| 160x72 | 11,520 | 45 KiB | 225x |
| 80x36 | 2,880 | 11.25 KiB | 900x |
| 40x18 | 720 | 2.81 KiB | 3,600x |
| 20x9 | 180 | 720 B | 14,400x |

\*Logical pixel payload only. `ImageReader` buffers can have row/pixel stride,
alignment, and graphics-allocation overhead.

At `160x72`, a human can still recognize the game layout. At `80x36` it is very
blurry, at `40x18` it is blocky, and at `20x9` it is nearly abstract. That loss
of human readability is acceptable if the tested decision boundary remains
wide. The machine is not trying to see Balloon Boy as a person; it is measuring
whether a stable patch was occluded.

The paragraph that stood here linked to three files under
`captures/previews/` — a quality ladder, an empty-vs-BB pair and a moving
preview, enlarged with nearest-neighbor scaling so each logical pixel was
visible. **Corrected 2026-08-26: those links pointed at nothing.** `captures/`
is gitignored, so they could never resolve for a reader; they did not exist
locally either, and no script in the repository regenerates them. They were
one-off renders from a session that ended.

Kept as a note rather than deleted, because the failure is the reusable part:
a document may not rest on evidence a reader cannot obtain. The claim above
does not — the resolution ladder is arithmetic, and the decision boundary it
turns on is measured by `test-screencheck.py` and by the `grey=` separation in
[`ON-DEVICE-VALIDATION.md`](ON-DEVICE-VALIDATION.md). Game imagery stays
outside git regardless; if the renders are wanted again, they need a script in
`tools/device` that builds them from a named capture, not a link.

## 4. The appropriate public Android path

The production candidate is one helper APK with one user-approved projection:

```text
MediaProjection
├── AudioPlaybackCaptureConfiguration -> AudioRecord -> audio features
└── one VirtualDisplay -> tiny ImageReader -> pixel/ROI features
```

This boundary has several advantages:

- the compositor writes directly into the helper's small `Surface`;
- frames and PCM never cross adb;
- visual and audio observations share one consent/session lifecycle;
- the helper can timestamp both streams with a monotonic clock;
- projection loss can atomically make both sensors unavailable.

Android 14 treats one `createVirtualDisplay()` invocation as one capture session
and rejects calling it multiple times on the same `MediaProjection`. Create the
visual display once, keep it for the night, and use `VirtualDisplay.resize()` or
`setSurface()` only if measurement proves that reconfiguration is needed. A new
projection session, the user stopping capture, screen lock, or process death can
stop the current session, so register `MediaProjection.Callback.onStop()` and
fail closed. These constraints are documented in Android's
[`MediaProjection` guide](https://developer.android.com/media/grow/media-projection)
and
[`Android 14 behavior changes`](https://developer.android.com/about/versions/14/behavior-changes-14#media-projection).

For the visual sink, start with:

- one `20x9` `ImageReader` in a CPU-readable RGBA format;
- `maxImages` no larger than required by the callback design;
- `acquireLatestImage()` so stale frames do not queue behind live state;
- immediate `Image.close()` in every branch;
- classification only in armed controller windows;
- one or a few neighboring cells, not a bitmap conversion or ML runtime.

Small output does **not** guarantee proportionally small latency. The compositor
may still do substantial work before scaling, frame delivery is synchronized to
display production, and an always-attached virtual display can consume graphics
resources even if the classifier ignores most frames. Measure capture-to-pixel
and capture-to-action p50/p95/max on the target phone, together with thermal and
game-frame behavior over a full night.

### Why the other APIs are not the default

| Path | What it offers | Why it is not the production default |
|---|---|---|
| stock shell `screencap` | simple, already validated prototype | composes the full display; measured capture p95 is 206 ms |
| `MediaProjection` virtual display | one consent session, 20x9 output, no per-read compose; measured read p95 is 59 ms | this *is* the intended production path as of 2026-08-24; it needs a consented session and a running helper, and its classifier threshold is not yet calibrated |
| `PixelCopy` | can crop a `Window` or `Surface` the caller can access | it does not grant access to an arbitrary other app's window; see [`PixelCopy`](https://developer.android.com/reference/android/view/PixelCopy) |
| `AccessibilityService.takeScreenshot()` | public full-display/window hardware-buffer screenshot | full screenshot, rate-limit failure mode, and an accessibility service should exist for an accessibility purpose; see [`AccessibilityService`](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService) |
| private SurfaceFlinger/`ScreenCapture` helper | AOSP has hidden layer-capture arguments with a `sourceCrop` | `@hide`, privileged/version-sensitive, and OEM-fragile; useful only as a benchmark unless the deployment environment deliberately accepts that boundary |

AOSP's hidden capture implementation demonstrates that direct cropped capture is
technically possible—the builder has `setSourceCrop()` and frame scaling—but it
is not a normal third-party Android API. See AOSP
[`ScreenCapture.java`](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/window/ScreenCapture.java).

The private route could make a literal one-pixel crop cheaper than a `20x9`
projection, but only a device benchmark can establish that. It also cannot share
the public projection lifecycle as cleanly as the proposed audio path.

## 5. Audio is the same problem in another dimension

The corresponding bad audio question is "what sound is playing?" The useful
controller question is narrower: "during this known window, is the distinctive
part of cue X present with a safe score margin?"

A single audio sample is usually meaningless because waveform value depends on
phase. Reduction happens across time and frequency instead:

```text
native playback PCM
      |
      v
short armed time window
      |
      v
mono + measured sample-rate reduction
      |
      v
small band-energy / template feature vector
      |
      v
HIT / MISS / UNKNOWN
```

At PCM16, 48 kHz stereo is 192,000 bytes/s. Six seconds is about 1.15 MB. A
16 kHz mono analysis stream is 32,000 bytes/s, or 192 KB for the same window;
8 kHz mono would halve that again. Those rates are examples, not selected
production settings. The lowest safe sample rate is determined by the highest
frequency feature that actually separates the cue, plus anti-alias filtering
and target-device holdouts.

Use `AudioRecord` at a stable format the device supports, then downmix and
resample in memory. Android's `AudioPlaybackCaptureConfiguration` can filter by
eligible usage and UID, but the source app's usage, policy, target SDK, and user
profile still determine whether playback is capturable. See Android's
[`playback-capture guide`](https://developer.android.com/media/platform/av-capture).

This game adds an instructive trap: internal capture contains persistent
Mangle/music-box layers that do not match the audible mix. Lower bitrate does
not remove a biased sensor. Those layers must appear in negative calibration and
holdout windows, as described in
[`ANDROID-AUDIO-CAPTURE.md`](ANDROID-AUDIO-CAPTURE.md).

## 6. A pixel rule still needs a classifier contract

The safest one-pixel rule is asymmetric. Do not try to prove every possible
threat from one color; prove only the narrow safe state:

```text
if pixel is inside calibrated empty range
   and view/rotation/light/timing invariants hold:
       SAFE_EMPTY
else:
       THREAT_OR_UNKNOWN
```

That contract is stronger than `black == Balloon Boy`. Black can also mean a
transition, light failure, overlay, mask, monitor, screen lock, capture loss, or
another occupant. Treating every non-empty value as a conservative branch keeps
those cases safe for this particular decision. It does not eliminate the cost
of false positives, so the controller simulator must still show that extra mask
time is survivable.

Useful invariants include:

- exact landscape orientation and captured-content bounds;
- expected game package/window in front;
- left light held and rendered before sampling;
- no touch/debug overlays at capture time;
- correct pan position and controller phase;
- fresh monotonic timestamp inside the action deadline;
- no projection stop, empty buffer, row-stride error, or stale frame.

If any invariant is missing, the sensor returns `UNKNOWN`. A cheap classifier is
not allowed to be cheaply overconfident.

## 7. How to discover a minimal sensor without fooling yourself

### Split first

Divide complete runs into calibration and holdout sessions before searching
coordinates, thresholds, resolution, or time offsets. Adjacent animation frames
from one run are highly correlated and do not count as independent trials.

### Search only calibration data

For each candidate pixel or small box, measure:

- within-class range over animation/static phases;
- between-class margin;
- sensitivity to one- and two-pixel spatial shifts;
- overlays, blackouts, transitions, and other occupants;
- stability after compositor downscaling.

Prefer a small box statistic—median, minimum, maximum, or count over threshold—if
it costs almost nothing and materially improves shift tolerance. "One pixel" is
an optimization target, not a virtue worth a brittle controller.

### Freeze, then replay holdouts

Freeze the coordinate, scale, filter, threshold, timing window, and failure
semantics before opening holdout data. Report a confusion matrix and run/session
counts, not only an aggregate accuracy. Zero observed false negatives is not a
zero false-negative rate; include a confidence bound and collect the rare,
dangerous states deliberately.

### Challenge the shortcut

Include at least:

- BB entering, fully present, and leaving;
- BB inside the office;
- Golden Freddy alone and overlaid with BB;
- empty opening across different static/noise phases;
- exact edge timing while the light turns on/off;
- mask, monitor, hall light, blackout, death/static, pause, and Android overlay;
- small shifts in crop, aspect, density, and rotation;
- projection revocation and stale/duplicate frames.

### Shadow before control

Run the tiny sensor beside the existing ROI/template classifier and log only
timestamps, decisions, and compact feature values. It earns control only after
independent whole-night holdouts, capture-to-action timing, and injected-error
simulation pass. Keep the old classifier available as a calibration oracle and
rollback path until then.

## 8. The experiment ladder

The cheapest design is an empirical result, not the smallest number that an API
accepts. Implement one reusable capture path and test these rungs without
retuning on the final holdout:

| Rung | Visual decision | Purpose |
|---|---|---|
| A | current full-resolution ROI/template | correctness and timing baseline |
| B | `160x72`, tiny ROI | prove the new `MediaProjection` path |
| C | `80x36`, then `40x18` | find where latency/resource savings flatten |
| D | `20x9`, pixel `(3,6)` plus neighbors | test the minimum aspect-correct frame |
| E | one-cell decision only | remove unnecessary feature work |
| F | private cropped capture benchmark | quantify whether hidden SurfaceFlinger access is worth its deployment cost |

For every rung, record:

- sensor-to-ground-truth confusion matrix by complete run;
- first-frame and steady-state p50/p95/max latency;
- capture-to-action p95/max, not classification time alone;
- frame age and duplicate-frame rate;
- CPU time, graphics load, memory bandwidth proxy, temperature, and throttling;
- effect on game frame pacing and audio-cue latency;
- projection-stop and buffer-overrun behavior.

Select the **lowest rung that passes every safety and soak gate**, not necessarily
the `20x9` rung. If `40x18` costs the same but provides a much wider margin, it is
the cheaper system once debugging, drift, and false-positive cost are included.

## 9. General lessons for bot construction

1. **Model actions before perception.** State distinctions that never change an
   action do not need sensors.
2. **Exploit controlled interaction.** The bot chooses when to hold a light and
   where to pan, turning an unconstrained recognition problem into a stable
   measurement.
3. **Search for invariants, not characters.** Occlusion of a known patch can be
   more reliable and vastly cheaper than object recognition.
4. **Optimize the whole pipeline.** A one-pixel classifier after a full-screen
   screenshot is not one-pixel capture.
5. **Make uncertainty explicit.** `UNKNOWN` is a first-class sensor result and
   needs a simulator-proven controller response.
6. **Treat latency as part of accuracy.** A correct observation after its action
   deadline is an incorrect control input.
7. **Separate calibration from evidence.** Feature discovery, threshold tuning,
   and holdout evaluation cannot use the same correlated frames.
8. **Keep richer sensors during development.** They explain failures and provide
   a shadow oracle while the minimal feature earns trust.
9. **Minimize information, not rigor.** The smaller the sensor, the more its
   environmental assumptions matter.

The current implementation and measured baseline are in
[`ON-DEVICE-SCREEN-CHECKS.md`](ON-DEVICE-SCREEN-CHECKS.md). The combined helper's
audio design and promotion gates are in
[`plans/08-audio-cue-controller.md`](../../plans/08-audio-cue-controller.md).
