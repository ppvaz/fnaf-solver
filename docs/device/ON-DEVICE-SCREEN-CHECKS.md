# Low-cost visual checks inside the stock device

> **Archived 2026-09-25.** The `screencheck` classifier (`packages/screencheck`) and its build,
> model, replay and benchmark tools left the tree with the fixture service path that used them;
> full-display screencap is a discontinued sensor (CLAUDE.md). Restore with
> `git checkout 6d78c7e -- packages/screencheck`. The record below is kept as history.

*Prototype added 2026-08-23. This is the inexpensive stock-game path between
the blind adb schedule and a rebuilt/instrumented game.*

## Result

Run the screenshot **and** the classifier in one device-side shell. Only the
classification (`match`, `clear`, or a few integer features) crosses adb:

```text
stock SurfaceFlinger -> screencap -> 12.4 KiB native helper -> local branch
                                               |
                                       no image leaves phone
```

The helper was `packages/screencheck/src/screencheck.c`. The package path is the only native source. It is
a static, libc-free ARM64/Linux executable, so it does not need an APK, root,
an Android permission prompt, Python, an NDK runtime, or a writable game
package. It consumes Android's native 16-byte raw-screencap header and RGBA
rows from stdin. It also exits after the final row in the requested region,
instead of copying the rest of the image through the pipeline.

This removes the part that made reactive host driving untenable: a screenshot
is no longer transferred to the Mac, decoded there, and followed by another
adb command. `screencap` itself still has an unavoidable full-display capture
cost. On the connected Moto g56, the real 2400x1080 landscape pipeline measured
225 ms p95 over 30 interleaved samples. That leaves useful room inside the
shortest relevant visual response, but a target-specific classifier and its
following action still need an end-to-end holdout trial before live use.

## Build and install

The build uses Apple's clang for the ELF object and Rust's bundled `ld.lld` as
the cross-linker. No Android SDK/NDK is installed on this Mac.

```sh
tools/device/build-screencheck.sh /tmp/fnaf-screencheck
adb push /tmp/fnaf-screencheck /data/local/tmp/fnaf-screencheck
adb shell chmod 755 /data/local/tmp/fnaf-screencheck
```

The current binary is 12,680 bytes, AArch64, static, and has no dynamic interpreter.
The exact ARM binary executed successfully under an ARM64 Linux container; the
same algorithm's native host build passes synthetic header, raw-RGBA, ROI,
colour-count, threshold, model classification/rejection, replay, truncation,
and bounds checks:

```sh
python3 tools/device/test-screencheck.py
```

## Correct invocation boundary

Keep the pipe inside the quotes passed to `adb shell`:

```sh
adb shell 'screencap 2>/dev/null | /data/local/tmp/fnaf-screencheck stats 0 0 2400 1080 4'
```

Do **not** use this form for a timed check:

```sh
adb exec-out screencap | /tmp/fnaf-screencheck ...
```

That second pipe is a host pipe, so the full screenshot still crosses USB.
The real driver already executes as one long device-side `sh`; it should call
the helper directly within that remote program and branch before scheduling
its next press:

```sh
state=$(screencap 2>/dev/null |
  /data/local/tmp/fnaf-screencheck match \
    1950 675 2140 770 4  100 255 100 255 0 99  1000)
case "$state" in
  match) echo "CAM 10 lime highlight is selected" ;;
  clear) echo "CAM 10 is not selected" ;;
esac
```

The sample rule is only a smoke check for the known lime camera-selection UI,
not a Balloon Boy classifier. On a retained 1280x576 recording, the equivalent
CAM 10 region scored 1,952 basis points while CAM 10 was selected and zero while
CAM 04 was selected. This proves that the streaming primitive can make a real
visual decision, but threat frames still need their own calibration.

## Operations

All rectangles use half-open device pixels (`X0 Y0 X1 Y1`). `STEP=1` samples
every pixel; 2 or 4 is normally enough for a large UI/sprite and reduces the
classifier work.

```sh
# Means, dark/bright fractions (basis points), and horizontal edge strength.
screencheck stats X0 Y0 X1 Y1 STEP

# Fraction of sampled pixels inside inclusive R/G/B ranges, as 0..10000.
screencheck count X0 Y0 X1 Y1 STEP R0 R1 G0 G1 B0 B1

# The same colour fraction reduced locally to match/clear.
screencheck match X0 Y0 X1 Y1 STEP R0 R1 G0 G1 B0 B1 MIN_BPS

# Nearest-template classification. Output is LABEL score=N margin=N; uncertain
# frames are `unknown` according to the model's maximum score/minimum margin.
screencheck classify MODEL
```

`--rgba W H` after the operation skips the Android header. It exists for host
calibration against `ffmpeg -pix_fmt rgba -f rawvideo`; the in-device path
should use the default auto-sized screencap input.

The output is deliberately integer-only. A threshold rule can therefore live
inside Android's stock shell without `awk`, floating point, or another host
round trip.

## Building and replaying a model

`SCM1` models contain the ROI, sampling stride, a small normalized RGB grid,
and at most 64 labeled templates. The native process uses integer L1 distance;
there is no ML runtime or dynamic allocation. Capture raw samples at the exact
live resolution and view:

```sh
tools/device/capture-screen-sample.sh gf-office empty empty-01
tools/device/capture-screen-sample.sh gf-hall empty empty-01 1200 540 900
```

The optional coordinates hold a light/control on-device and capture after
`CAPTURE_DELAY` (default 350 ms), without inserting a host round trip between
the press and screenshot. For a clean calibration frame, the capture tool
temporarily disables Android's `show_touches` and `pointer_location` overlays
and restores their prior values on every exit; set
`SUPPRESS_TOUCH_INDICATORS=0` only when deliberately recording those overlays.
Keep a hall hold below Golden Freddy's 1.67 s exposure fuse. The capture tool
checks game focus and refuses overwrite, but the operator is still responsible
for proving the label.

Build from calibration frames, requiring leave-one-out separation:

```sh
tools/device/build-screen-model.py \
  --roi X0,Y0,X1,Y1 --grid 12x8 --step 2 \
  --max-score 30 --min-margin 8 \
  --output captures/screencheck/gf-hall.scm \
  empty=captures/screencheck/gf-hall/empty/calibration \
  golden=captures/screencheck/gf-hall/golden/calibration \
  other=captures/screencheck/gf-hall/other/calibration
```

Do not use `--allow-errors` for a live model. It exists only to inspect a
non-separable calibration set. Replay independent holdouts through the same C
classifier before installing the model:

```sh
tools/device/replay-screen-model.py captures/screencheck/gf-hall.scm \
  empty=captures/screencheck/gf-hall/empty/holdout \
  golden=captures/screencheck/gf-hall/golden/holdout \
  other=captures/screencheck/gf-hall/other/holdout
```

Raw/PNG frames and models stay under ignored `captures/`; no game imagery is
committed. PNG input needs Pillow, while Android raw screencaps do not.

## Cost measurement

With the phone connected and in the intended orientation/view, run:

```sh
tools/device/bench-screencheck.sh 30 [model.scm]
```

It interleaves and reports min/p50/p95/max/mean for:

- `capture`: `screencap` with its output discarded;
- `classify`: one helper process reading a saved 10.4 MB RGBA frame at stride 4;
- `combined`: the intended device-local pipe.

The benchmark leaves the 12,680-byte helper installed and deletes only its explicit
`/data/local/tmp/fnaf-screencheck-benchmark-<pid>.raw` temporary frame. The
optional model is also removed from its explicit benchmark path.

Measured 2026-08-23 on the connected Moto g56 5G:

| View/workload | Samples | Capture p95 | Classify p95 | Combined p95 |
|---|---:|---:|---:|---:|
| FNaF 2 landscape, 2400x1080, full-frame stride-4 stats | 30 | 206 ms | 42 ms | 225 ms |
| Android portrait, 1080x2400, synthetic 16-template timing model | 30 | 227 ms | 53 ms | 246 ms |

The portrait model duplicated a settings screenshot across labels and was built
with `--allow-errors`; it validates classifier cost only, not accuracy. The
landscape combined median was 204 ms. A lower-value host sanity check classified
100 full 2400x1080 frames in 0.64 s total (6.4 ms each), confirming that Android
capture—not the feature distance—is the dominant cost.

For the Minus 7 response window, judge **p95 combined**, not the average. It
must leave room for the following `input swipe` (about 170 ms on the Moto) and
the game's roughly 0.7 s worst-case response window. The practical gate is:

```text
p95(combined visual check) + p95(input swipe) + safety margin < 700 ms
```

Using the measured 225 ms landscape visual p95 and the existing roughly 170 ms
duration-press measurement gives about 395 ms before game/render scheduling,
leaving about 305 ms against a 700 ms BB leaving window. This proves timing
feasibility, not classifier correctness. The final gate must measure the
specific model followed by the actual action in one device-side driver.

## Threat models and conservative branches

The execution path and cost are solved. BB now has independent holdout and live
branch evidence, while Golden Freddy remains a provisional tripwire. Toy Bonnie
does **not** need a visual model in the Minus 7 branch: the CAM 04 selection
already stalls him all night, so classifying the right vent would add latency
without changing the response. The `tb-right` row remains relevant only to
non-Minus-7 strategies. Build separate models where vision changes an action:

| Model/view | Required labels | Conservative live handling |
|---|---|---|
| `bb-cam05` | `empty`, `bb`, other occupants/static | Treat `bb` or `unknown` as a threat; schedule the left-opening defense check. A miss lets him permanently remove every light and causes the BB→Foxy chain. |
| `bb-left` | `empty`, `bb`, other vent views | Treat `bb` or `unknown` as present: monitor stays down and mask remains on for the sourced five continuous scheduler ticks. |
| `gf-office` | `empty`, `golden`, blackout/other | `golden` or `unknown` must mask; never raise the monitor or flash the hall. A prophylactic mask flick is cheaper and safer than vision in the normal Minus 7 cycle. |
| `gf-hall` | `empty`, `foxy`, `golden`/other | `golden` or `unknown` releases/avoids the hall light immediately; never spend the full 1.67 s exposure fuse. |
| `tb-right` | `empty`, `toy-bonnie`, other vent occupants | `toy-bonnie` or `unknown` keeps the right light/defense branch active. If a fixed light stall is acceptable, holding the right light is cheaper than classifying. |

The owned Night-6 AI table constrains collection. Golden Freddy is rare but not
impossible before 2 AM:
one night start in ten assigns him AI 1 (the other nine assign 0), and 2 AM
overwrites that result with AI 3. BB is active from 12 AM and rises from AI 5
to 9 at the 2 AM cliff, so his two views remain the easiest first calibration
targets. Custom Night/10/20 remains locked on the current save.

For each view:

1. Disable pointer/touch overlays. Collect multiple raw frames per class across
   static/noise phases, exact pan positions, and early/late-night lighting.
2. Split captures into calibration and untouched holdout sets before tuning the
   ROI, grid, maximum score, or margin.
3. Prefer a tight stable sprite/vent ROI. A color `match` is sufficient if it
   cleanly separates every retained frame; otherwise use the existing compact
   template model rather than adding a second inference stack.
4. Require zero observed false negatives on holdouts and exercise `unknown`
   with transitions, blackouts, other occupants, and deliberately shifted views.
5. Benchmark that exact model, then measure capture-to-action inside one remote
   shell. Preserve the working open-loop runner until the experimental branch
   passes screenrecord grading and selected-camera tracing.

The retained camera-button experiment produced a separated four-template model
on a tight 1280x576 CAM 10 button ROI and classified a later CAM 10 frame as
`cam10 score=7 margin=25`. That is a real visual/model-path proof, but it is UI
evidence—not evidence for any threat class.

## Live BB checkpoint (2026-08-23)

> **Unlit CAM 05 rejected (2026-08-24).** A HID-multitouch calibration stayed
> alive for 130 seconds and collected 25 clean CAM 05 frames without the
> flashlight. The room/BB state is not visually distinguishable in that feed.
> The hypothesis came from ambiguous timing in an earlier lit-positive video,
> not from the source, and must not be used by a survival controller. If CAM 05
> is sampled it needs a lit frame, but it is not the selected Night 6 checkpoint:
> spend HID's recovered cycle time on the validated, battery-free lit-left-opening
> read instead. Omitting BB handling altogether is also invalid (0/3000 in the
> exact Night 6 simulator). Do not generalize the Night 6 HID budget to 10/20
> Night 7.

The `bb-left` candidate was built from runs G/H with 19 templates (15 empty,
two independent BB-opening frames, and two BB-inside negatives). Its untouched
run-I holdout contained 17 empty frames plus the difficult simultaneous frame:
BB in the lit left opening while a translucent Golden Freddy covered the
office. All 18 classified correctly; the BB frame was `score=0 margin=18`.

Run K then exercised the complete device-local branch on new live frames. One
raw screencap was reused for the BB-left and GF-office classifiers before any
hall input. Cycles 0–6 were BB `empty score=0 margin=19`; cycle 7 visibly showed
BB and returned `bb score=0 margin=18`. The provisional GF classifier returned
`empty score=0 margin=3` on all eight. The mask began 42 ms after the second
classification, and the dedicated status made host cleanup stop the game before
any hall input or capture pull. Offline replay of the untouched run-K split
reproduced all eight BB results.

An HID staging run on 2026-08-24 resolved the remaining capture/action overlap.
A fixed delay from starting `screencap` was unreliable: an 80 ms release/mask
sometimes yielded the mask itself and sometimes an unlit office. The runner
now writes capture to a device-local file while holding the vent light, waits
for the first output byte (the observed immutable-buffer boundary), and only
then releases the light and masks. Starting capture at about +380 ms in parallel
with vent drawing produced first bytes at +690, +764, and +761 ms across three
cycles; all retained frames were confident `empty` classifications. A capture
lock prevents the safety watchdog from competing for SurfaceFlinger, and a
single unavailable watchdog read no longer counts as a lost-night frame.

That run validates only capture readiness and the empty branch. The former
`HID_LEFT_SURVIVAL=1` device table was explicitly experimental and is now
retired from the runner: its sweep and positive response lagged the compact
phase-safe schedule. It remains documented here as evidence, not as a
full-night controller.

This is a **detection-and-safe-stop checkpoint**, not yet a survivable response
loop. The seven completed cycles produced eight complete camera sweeps and 11
rendered hall-beam intervals, but that visual count is only a lower bound on
logical Foxy flashes: g202 hides the beam during the sourced 300-frame hall
movement latch while g489/g745/g855 still apply it. The box fell from full to
9.5% before cycle 7's wind. The added clean capture, prophylactic GF mask,
post-mask hall gate, and
two classifications leave only a 1.3 s wind in each 6.5 s cycle. A preceding
run that delayed sampling until cycle 8 died to Foxy around 42 s; its first raw
sample was already full static and correctly rejected as `unknown`. Do not
extend the current branch or implement the five-tick BB clear/resynchronization
until the per-cycle wind deficit is recovered without weakening the hall gate.

The GF model used in run K is intentionally provisional: it has one real Golden
Freddy source frame duplicated only to exercise leave-one-out mechanics, plus
eight independent run-K negative frames. It may stop on `golden` or `unknown`,
but it is not evidence for skipping the prophylactic mask. A distinct positive
animation frame must pass as an untouched holdout first.

`GF_SKIP_MASK_ON_EXACT_EMPTY=1` exists only to collect that missing evidence
without repeating run K's box deficit. It accepts the narrower literal result
`empty score=0`, moves the fail-closed hall branch ahead of the omitted mask,
and expands the wind from 1.3 s to 2.0 s. It is off by default and must not be
described as validated GF defense until it stops on a new positive frame.

Clean classifier frames require `DEBUG_OVERLAYS=0`. The runner's default
`POST_CAPTURE_TOUCHES=1` enables only Android's touch dot after each raw frame
has been saved and disables it before the next one. The recording therefore
shows the later hall/control coordinates while the BB/GF inputs remain clean.

---

## The left-opening classifier measures camera pan, not Balloon Boy (2026-08-26)

Found on the first cleared Night 1 (`n1-full-1640`), and it invalidates every
`inside` verdict that run produced.

**Balloon Boy's AI is 0 on Night 1.** The sourced table cannot arm him; the
recipe marks his branch `reachable: false` and emits it only as a fail-safe for
an unexpected classifier read. So every BB detection on that night is false by
construction, and the run reported **9**.

### The mechanism, with its control

The classifier reads a fixed 20×9 screen region. **The office view pans
horizontally, and nothing in the runner tracks that.** When the view is panned,
the region covers different scenery and scores differently.

Measured by cross-correlating a horizontal band of each classified frame against
an unpanned office frame, at the *same point in every cycle* — the lit vent read,
so this is apples to apples:

| verdict | count | pan vs. unpanned |
|---|---:|---|
| `empty` | **16 of 16 sampled**, spread across the whole night | **0 to 6 px** |
| `inside score=0 margin=18` | 6 of 7 | **−64, −74, −122, −126, −128, −178 px** |
| `inside score=0 margin=18` | 1 (327969 ms) | −4 px — the one exception |

And the margin tracks the pan monotonically, which is the part that settles it:

| pan | margin | verdict |
|---:|---:|---|
| 0 px | 19 | `empty` |
| 6 px | 20 | `empty` |
| −64 … −178 px | 18 | `inside` |

A six-pixel pan already moves the margin by one unit. The `inside`/`empty`
boundary is one unit wide — `score=0 margin=18` against `score=0 margin=19`,
*identical scores* — so the classifier crosses it on camera position alone. It
is not detecting an animatronic. It is detecting where the office is pointing.

### The other two are a different fault: the read photographed the monitor

Two reads did not look at the office at all. Retained at
`captures/n1-full-1640-bb-frames/`:

- `INSIDE score=10 margin=13` (98059 ms) — the frame is the **Main Hall camera
  feed**, and the runner believed `cams=down`. The desync guard did not fire.
- `UNKNOWN score=30 margin=6` (93029 ms) — the **Party Room 4 feed**, and here
  the guard *did* fire (`cams=UP-DESYNCED`).

Same fault, caught one time in two. This is the failure CLAUDE.md already
names — *"the vent read photographs the camera feed"* — now with frames.

Cross-correlation is meaningless on those two (they return the search bound,
±250/±300), which is its own small lesson: an alignment that lands on its
boundary is a refusal, not a measurement. `desync-scan.py` was taught that this
morning; this measurement should be too before it is automated.

### The pan is a SYMPTOM, and of the thing this project already tracks

Corrected the same day, on the device owner's prior experience with this
project: **unexpected office panning during a run means desync.** That reframes
everything above, and it is the more useful reading.

The chain runs the other way from how this section first told it:

1. the pilot and the game disagree about whether the monitor is up — a desync;
2. presses aimed at the monitor or the camera buttons land on the **office**
   instead, and dragging the office is what pans it;
3. the classifier's fixed region is then off-target, so it scores a different
   patch of scenery — or, when the disagreement is total, it photographs the
   camera feed outright.

So the false `inside` verdicts are not a classifier defect with an unknown
trigger. They are **desync, made visible**.

**Corroboration, and it is only partial — say so.** Exactly one read in the run
carries the runner's own desync label, `cams=UP-DESYNCED` at 93029 ms, and that
read is also one of the frames measured as displaced. The other seven are
inferred from the pan measurement plus the owner's experience, not from an
independent desync signal. `UNKNOWN(6 of 7 not independently confirmed)`.

**What it implies is worse than the false positives.** If pan means desync, this
run desynced roughly **eight times and the runner noticed once.** And the one
correction it did make did not work: the resync fired at 93089 ms, and the very
next read — 98059 ms, five seconds later — still photographed the **Main Hall**
camera feed. `monitor-resync` restored the pilot's belief, not the game's state.

**The opportunity: pan is a cheap desync detector, and a better one than what is
there.** The current check reads the Companion's luma to ask whether the cams
are up, and it caught one of about eight. A horizontal cross-correlation of the
office against an unpanned reference separated 16 of 16 good reads from 6 of 7
bad ones in this run, offline. Whether it can be afforded *inside* the cycle is
unpriced — it is a full-frame operation, and this repository's rule is to price
an observation before scheduling it.

### One method note, so nobody repeats a dead end

A whole-video pan time series was attempted and **discarded as uninformative**:
it cannot separate office frames from camera feeds, so most of its samples were
the correlation saturating at its search bound. The controlled comparison above
— same phase of every cycle, `empty` against `inside` — is what carries the
finding. An alignment that lands on its search boundary is a refusal, not a
measurement; `desync-scan.py` was taught that this morning and any automated
version of this must be too.

### What this costs, beyond the false branch

Each false `inside` runs `attack[2..999]` and holds a prophylactic mask through
five ticks — a different, more expensive branch, on a night that needed none of
it. And if the office really is panned at those moments, then **every press in
that cycle is landing on coordinates calibrated for an unpanned office**, which
is a candidate cause for the monitor desyncs the same run recorded.

The immediate honest fix is to make a panned office a refusal rather than a
verdict: measure pan alongside the read and return `UNKNOWN(panned)`, which the
existing fail-closed rule already handles. Making the classifier pan-*aware*, or
stopping the pan, are both larger and need the cause first.

### The pan-anchor geometry: curved office travel (2026-09-02)

The long-term answer is not a second hand-maintained ROI table for the right
vent. Keep office observations in a canonical, unpanned scene coordinate
system and transform them through a calibrated camera parameter for each native
frame:

```text
camera_parameter = inverse_calibration(bulb_screen_x)
screen_x(target) = target_curve(camera_parameter)
screen_y(target) = target_curve_y(camera_parameter)
```

The bulb is a promising reference because it remains visible across the
captured office-pan positions, but its screen position follows the camera with
a curved/parabolic relationship rather than a constant pixel translation. The
captured groups place its detected bright core at approximately x=1162 in the
approximate-centre view, x=1898 at the extreme-left view, and x=547--549 at the
extreme-right views. Those are anchor measurements, not yet a fitted curve.

The emitted fact must not be `reference_x + bulb_delta`. It should be a
calibrated camera parameter: detect the bulb's screen position, invert a
monotonic lookup/polynomial calibration to obtain pan position, then apply a
separately calibrated target curve to each scene-anchored ROI. A single bulb
also cannot prove that every scene layer shares one transform, so intermediate
pan positions and at least one additional static anchor are required before
using the mapping live. If the inverse is ambiguous, the match residual is
high, or the anchors disagree, return `UNKNOWN(pan-ambiguous)`.

The first device-side sensor is now present in `CaptureService`: it scans the
native frame's top 220 rows for the dominant warm bulb component and emits its
sampled centroid, component area, component margin, confidence, and refusal
reason alongside `READ`/`GET`. It returns UNKNOWN for non-native frames, a
missing bulb, or a competing component. This is the measurement layer only;
it does not yet transform live ROIs or authorize office-coordinate input.

The existing `pan-shift.py` is an offline proof of displacement; its full-frame
correlation is not the live implementation because a screencap-sized operation
spends too much of the cycle budget. The helper already owns the native frame,
so the device-side bulb scan is the measurement primitive. Calibration still
needs to add the camera parameter, fit residual, and target-specific curves.

Only scene-anchored office ROIs are transformed. HUD, monitor-map, and other
fixed-screen ROIs remain in screen coordinates. While the view is moving, or
the offset is not confidently measured, all office facts are `UNKNOWN` and
office-coordinate inputs are suppressed. An unexpected measurable pan still
means desync and must enter recovery; measuring it does not make the already
mislanded input safe. An intentional, stable pan may instead allow the same
canonical Foxy/vent ROI to follow the scene into the right-vent view.


---

## The cams-up detector is scene-dependent, and that is why it misses (2026-08-26)

Path 2 of the desync work, and the answer is not the one it looked like.

`CUE_CAMS_UP_LUMA = 180` is **well measured on its own sensor**: night 6-34's
poller trace has cams-up at 225-229 and the office window at 0-107, with the two
populations not overlapping anywhere in 1818 samples. Nothing about that
calibration is loose, and a first attempt here to re-derive it from screenrecord
frames scaled to 20x9 produced a completely different distribution (up 30-197,
median 52) -- **the wrong sensor**, which is exactly the substitution plans/15
exists to prevent. Those numbers are discarded.

The defect is not the threshold. It is that **whole-frame luma is a property of
the scene, not of the monitor**, and the 225-229 band was measured on the
cameras the shipped route actually visits. A desync puts you on a camera the
route never opens.

Measured on the retained frames from the cleared Night 1, at the helper's own
20x9 geometry:

| frame | whole-frame luma | vs the 180 line |
|---|---:|---|
| CAMERA, Main Hall -- **the missed desync** at 98059 ms | **158** | **below: reads as office** |
| CAMERA, Party Room 4 at 93029 ms | 76 | below |
| OFFICE (a good read) | 31 | below |
| 6 AM | 2 | below |

The Main Hall feed is dark enough to sit under a threshold calibrated on the
Prize Corner. So the read said "monitor is down", the pilot spent its vent light,
and photographed the camera feed. That is the 1-of-2 catch rate in the record,
and by extension a candidate for the run's roughly eight desyncs against one
detection.

**What follows, and what does not.** It does not follow that the threshold
should move: lowering it toward 158 walks into the office population and starts
refusing good reads. What follows is that the signal must stop depending on
scene brightness. The selected-camera map button is yellow -- measured (200,200,0),
and `camtrace.py`'s `lime_score` already tests exactly `red > 100 and green >
100 and blue < 100` for it -- so it is present at the same intensity whichever
camera is open, including the dark ones.

**Unpriced, and the reason this is a note and not a change.** The helper's frame
is a 20x9 VirtualDisplay (`CaptureService.java:71-72`), and the map button is a
few pixels of a 1280x576 screen: whether it survives that downscale is an open
question this session could not answer, because the only way to answer it is to
read the helper's own sensor, not a recording. `query-companion.sh watch`
during a night, against known monitor state, is the measurement that settles it.
Until then the yellow anchor is a hypothesis with a good mechanism and no
device evidence.
