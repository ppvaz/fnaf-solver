# On-device audio-cue controller

> **BLOCKED on the target device (2026-08-29).** The discrete `Play sample`
> cues this plan depends on — the vent bang (17), the footsteps (25–29), BB's
> vocals (21/23/24) — are SoundPool tracks on the g56's
> `AUDIO_OUTPUT_FLAG_FAST` mixer, a separate HAL output stream that
> `AudioPlaybackCapture` does not tap. Confirmed by ear, matched filter, and
> `dumpsys media.audio_flinger` (WinD as a 0.284 s fast track flipping
> active/standby every 500 ms). Only the always-on ambient loops
> (`AUDIO_OUTPUT_FLAG_DEEP_BUFFER`, `USAGE_MEDIA`) reach the capture — that is
> the "capture bug" bed, not the cues. Not fixable without root
> (`setprop af.fast_track_multiplier 0` is denied on the user build). See
> [`ANDROID-AUDIO-CAPTURE.md`](../docs/device/ANDROID-AUDIO-CAPTURE.md)
> §"Discrete SFX are on the fast mixer".
>
> This plan is not wrong — the cue map below still holds. What is blocked is the
> *on-device `AudioPlaybackCapture`* path specifically. Two ways around it:
>
> - **External A2DP sink** (`plans/19` P6). The fast-mixer block is capture-side:
>   the A2DP encoder sits *after* the HAL combines DEEP_BUFFER + FAST, so a
>   Bluetooth sink (Linux box / ESP32 / BT receiver) gets the full mix including
>   the SoundPool cues. Cost: ~150–250 ms A2DP latency + its p99 jitter. That
>   permanently closes the Minus 7 early-unmask (§3 needs < 67 ms) but fits a
>   mask-deadline reaction and a pre-positioning use of an auditory early warning.
>   **Confirmed 2026-08-29:** the winding tick (`s0033`) matched-filters at
>   NC 0.56 in a `phone → aptX HD → BlueALSA` capture vs 0.045 on-device — the
>   fast-mixer cues really are in the A2DP mix. Working path is BlueALSA, not
>   PipeWire (broken BT receive on the host). Caveat: A2DP suspends on silence,
>   so there is a resume gap after every quiet stretch.
>   `ANDROID-AUDIO-CAPTURE.md` §"The A2DP mix DOES carry the fast-mixer SFX".
> - **Recompile hook** (`plans/17`) — openal-soft `Play sample` callback: cue
>   sensing becomes an event read, not a waveform problem, at zero latency.
>
> A rooted g56 would also work (`setprop af.fast_track_multiplier 0`), but is not
> available.
>
> **Runtime-target correction (2026-08-31):** the phone -> ESP32 A2DP ->
> Wi-Fi/UDP PCM -> same-phone Cue Helper experiment had severe loss problems.
> The return-PCM bridge is retracted for live control. The ESP32 now owns local
> bounded DSP/cue classification and emits timestamped semantic cue/health
> facts; it must not stream PCM back to the phone's online controller. BlueALSA
> remains a validated proof and optional calibration/offline path. Models remain
> receiver-specific; a BlueALSA calibration cannot silently promote the ESP32
> path. The controlling architecture and measurement gate are in
> `docs/device/REAL-TIME-CLOSED-LOOP-ARCHITECTURE.md`.

**Status: gate 1 passes for the cue set this strategy needs (2026-08-24,
after a correction).**

An earlier reading of this plan stopped it at gate 1. That reading was wrong,
and the way it was wrong is worth more than the conclusion was: it reasoned from
the event sheet in isolation and never crossed it against
[`MINUS-7-STRATEGY.md`](../docs/strategy/MINUS-7-STRATEGY.md). The source says
sample 17 is shared by seven characters, so it declared the cue ambiguous and
withdrew early unmasking. But this strategy keeps **seven of the ten permanently
stun-locked**, and those seven are exactly the other writers of that sample. The
sharing is a fact about the game, not about the run.

Cross the two and the cue map is clean rather than ambiguous. The strategy
leaves three animatronics live:

| Threat | Cue | Channel / volume | Detected in real night audio |
| --- | --- | --- | --- |
| Balloon Boy | sample 17, the vent bang | 15 / 50 | **2.9-4.6 per minute**, best 0.85 |
| W. Foxy | samples 25-29, the footsteps | 15 / 50 | **8.4-11.1 per minute**, best 0.83 |
| Golden Freddy | none — he has no sound-producing group at all | — | — |

Both live cues are on channel 15 at volume 50, the loud channel. W. Foxy's only
sound-producing group is g698, which writes the footstep register; and no group
anywhere moves Balloon Boy to marker 149, so his branch into that bank is dead
code and the steps are Foxy's alone. That is why a player hears "bang = BB,
steps = Foxy" and is right to.

The earlier failure tested BB's *vocals* — channel 14 at volume 25, half the
default — and correctly found them 6-16 dB below detectability. That result
stands and is still recorded below. It is simply about cues the policy does not
need: the vocals distinguish which hop, and the controller only needs to know a
hop happened, which the bang already says.

**The dependency this creates, and it is load-bearing.** The bang is Balloon Boy
only while the stalls are current and the music box is wound, because a lapsed
stall or an empty box puts another writer back in play. The controller is the
thing maintaining both, so it can assert that state rather than assume it -- but
it must assert it per decision, not once per night. A lapsed stall costs the cue
as well as the flash.

| Package | State |
| --- | --- |
| 0. Source-map candidate cues | **Closed.** Every Office sample mapped to its state edge, and crossed against the stall roster |
| 1. Prove playback capture | **Passes for the needed cues.** Bang and steps both found repeatedly in target-device PCM; the vocals do not clear and are not needed |
| 2. Offline detector | Open. Front end built; needs a session-split holdout and confusion matrix against the *bang*, with the false-positive rate the real unknown |
| 3. Window and action latency | Observation leg measured (225 ms to 59 ms). The audio legs need the `ARM`/`HIT`/`MISS` protocol |
| 4. Simulator cue injection | **Advanced.** The bang-armed policy survives 300/300 clean, 200/200 worst, and 300/300 with false cues; misses stay fatal. The error budget is one-sided, so the detector wants its most sensitive threshold |
| 5. Shadow on the real device | Open |
| 6. Enable one bounded action | Open. Early unmasking is back in scope, conditional on asserted stall state |

**What is genuinely unverified.** The detection counts above have no held-out
labels, so the false-positive rate is unknown -- 11 footstep detections a minute
is high enough to suspect some are background. Nothing yet confirms that a
detected bang coincides with a real BB hop rather than a stall lapse. And the
projection classifier threshold is still uncalibrated.

#### How the miss rate gets collected

§4 showed the error budget is one-sided: false positives are absorbed, misses
are fatal. So the miss rate is the number that decides this, and it cannot be
measured with the detector under test. Two sources, and the cheap one does most
of the work:

1. **Injection, no gameplay.** Real night background plus the true reference at
   a known level and time, swept across levels. Arbitrary N, no device time.
   Gives miss rate as a function of level. `tools/cue/evaluate.py --anchor`.
2. **Visually labeled arrivals, to pin where real bangs sit on that curve.** BB
   entering the lit left opening *is* g417, and it is exactly what the one-pixel
   classifier reads: bright when empty, black when he is in it. So a
   bright->dark transition is a real bang, labeled by the other modality.

The second needs the two streams on one clock, which they now are: `log stop`
reports `startNs` for the first audio frame, `watch` logs `snapshotNs` with each
luma at ~11 Hz, and both come from the same `System.nanoTime()` inside the
helper. `tools/cue/label-misses.py` joins them.

Two things that protect the number from being nonsense. The luma split is
derived from each recording rather than assumed, because the projection scaler
has never been calibrated against the offline simulation the published values
came from -- so this run also produces that calibration. And a dwell filter
requires both states to hold for seconds either side of a transition: run the
tool against a menu and the screen's own flicker crosses any threshold several
times a second, which it will otherwise report as arrivals and score
confidently.

Cost: a night yields roughly 5-8 arrivals if he is masked out and allowed to
re-route. With zero misses observed the 95% upper bound is 3/N, so bounding the
rate under 5% needs about 60 events -- roughly ten nights, near 70 minutes of
device time.

## Decision

Build this only as a measured, fail-safe experiment. Android can expose eligible
game playback to an `AudioRecord`, and the data and detection work can remain on
the phone. A small helper APK should own capture and classification while the
existing device-local shell/HID controller sends only short arm requests and
receives cue results over a local control channel. PCM must never make a live
adb round trip.

The default is **windowed capture**, not constant reading:

- obtain one user-approved `MediaProjection` session before the night;
- keep its foreground service ready so consent is not repeated;
- start `AudioRecord` just before a known cue window and stop it at the window's
  deadline;
- classify in memory and discard the PCM after the result;
- do no recording or analysis between armed windows.

Keeping projection authorization alive is not the same as continually reading
audio. If repeated `AudioRecord.startRecording()` calls cannot deliver the first
frame before the measured deadline, the windowed design fails its timing gate.
A continuously drained stream with window-gated analysis is a possible later
fallback, but it changes the operator's “just on windows” constraint and must
not be adopted silently.

This is runtime-affordable in principle. Even an uncompressed 48 kHz, stereo,
16-bit input is 192,000 bytes/s; a six-second in-memory window is about 1.15 MB.
After downmixing to 16 kHz mono, it is 32,000 bytes/s. The real risks are capture
eligibility, the target build's contaminated internal mix, capture-start latency,
and whether detector errors leave any viable Night 7 policy—not storage or host
bandwidth.

## Why it is needed

The phase-safe visual/HID prototype in
[`HID-MULTITOUCH.md`](../docs/device/HID-MULTITOUCH.md) is a Night 6 result, not a
Night 7 controller. Night 7 makes BB's masked interval compete with Foxy's hall
coverage. The useful audio questions are therefore narrower than “recognize all
game sounds”:

1. Can an approach cue provide BB state early enough to schedule Foxy and the
   three camera flashes safely?
2. Is there a distinct, source-proven BB departure cue that can end a mask
   interval before the five-second worst case?
3. If either answer is yes, does a policy using that result survive measured
   latency and realistic false positives, false negatives, and missing windows?

The second question has the highest potential payoff and the highest safety
burden. An incorrect early unmask is not an acceptable classifier error.

The 2026-08-24 device run removes scheduler phase as the reason to build audio.
Two consecutive device-local frames containing both the clock and flashlight
meter acquired the HUD epoch, and the first `1 AM` transition landed 69,950 ms
later against the source-derived 70,000 ms interval. A MediaProjection image
stream can replace that screencap classifier if it preserves monotonic frame
timestamps, but audio is no longer needed to establish the epoch.

More importantly, phase acquisition did not promote the phase-windowed
sparse-left route. The idealized 267 ms sweep survives only inside its narrow
epoch window; the repeatable stock-HID primitive takes 790 ms, and modeling
that measured actuator produced zero survivors in both ordinary and pinned
worst-case Night 7 cohorts. A vocal onset may still corroborate the visual
clock or arm an occasional visual CAM-05 check, but it cannot rescue that
policy by itself. Reopen the phase use only after proving a faster actuator or
a new exact-simulator policy built around the measured one.

## Facts the controller must not blur together

The current Android source mapping says:

- BB moves every five seconds on a successful roll and takes five hops from
  CAM 10 to the left opening;
- the first hop is silent;
- samples 21, 24, and 23 are randomly selected BB vocals on the second, third,
  and fourth hops;
- the fifth, monitor-gated hop uses sample 17, a movement thud shared with other
  characters;
- after BB reaches marker 122, a fully-on mask gives a 10% leave roll each
  second and forces departure after five consecutive masked ticks.

That mapping is now resolved, and the answer is negative. Sounds are dispatched
through registers on the `cam 01` object rather than played inline, which is why
an earlier pass over the play actions alone read BB's departure as silent. It is
not silent: g292 and g294 write `cam 01` v21, and g691-694 turn any value 1-4
into **sample 17** — the same handle written by 18 edges across seven
characters, including Toy Chica's, Toy Foxy's, and W. Bonnie/W. Chica's own
mask-clears under the identical `mask fully on` condition.

So **no waveform uniquely announces the early-leave branch**, and the trainer's
`vent-bang` label is confirmed to be a teaching abstraction. The full map,
including the correction that BB's hop 4 plays a vocal *and* a thud and that
arrival at 122 is a thud/sample-21 pair, is in
[`ANDROID-SOURCE-STATUS.md`](../docs/android/ANDROID-SOURCE-STATUS.md); the
constants and their assertions are `THUD_SAMPLE`, `BB_VOCAL_SAMPLES`, and
`BB_ARRIVAL_SAMPLE`.

The target phone adds a separate complication: internal recordings contain the
music-box winding loop and Mangle's static even when the operator cannot hear
them. The evidence and implications are recorded in
[`ANDROID-AUDIO-CAPTURE.md`](../docs/device/ANDROID-AUDIO-CAPTURE.md). A detector
must be calibrated on raw PCM from this exact phone/build and challenged with
those loops as negative background.

## Proposed boundary

### Helper APK

Use a small, purpose-built APK rather than stock adb `screenrecord`, which has no
playback-audio output. On Android 10/API 29 or newer, the helper should:

- request `RECORD_AUDIO` and user consent for `MediaProjection`;
- run the projection in a foreground service; on Android 14+, declare the
  `mediaProjection` service type and its corresponding foreground-service
  permission;
- create an `AudioPlaybackCaptureConfiguration` filtered to the FNaF 2 package
  UID and eligible game/media usages;
- create one `AudioRecord` at a supported native format, then downmix/downsample
  in the helper;
- register projection-stop handling and turn every outstanding window into
  `UNKNOWN` if consent is revoked or capture dies.

The official Android constraints are summarized in the
[`AudioPlaybackCapture` guide](https://developer.android.com/media/platform/av-capture)
and
[`MediaProjection` guide](https://developer.android.com/media/grow/media-projection).
Capture requires the helper and source app to be in the same user profile, and
the game must permit playback capture through its target SDK, manifest, usage,
and capture policy. Inspecting the package is useful, but only receiving the
expected target samples proves feasibility.

Do not recreate a projection for each window. Android 14+ requires fresh user
consent for each new `MediaProjection` capture session. Start one deliberate
session before gameplay and reuse its audio-capture path until the night ends
or the user revokes it.

### Device-local control plane

The capture and detector remain in one process. The existing controller remains
device-local and exchanges bounded messages, not audio. Prefer a loopback socket
if the target device's shell client is reliable; otherwise prove another local
IPC route before implementation. A minimal protocol is enough:

```text
ARM <window-id> <cue-set> <open-ns> <close-ns>
HIT <window-id> <cue-id> <cue-ns> <score>
MISS <window-id>
UNKNOWN <window-id> <reason>
```

Authenticate the session with a per-run random token, bind only to loopback,
bound every field, and close the service when the trial harness exits. The
controller must use monotonic timestamps and must never block its HID schedule
waiting for a reply. A result arriving after its action deadline is `UNKNOWN`,
not a late command.

The first protocol slice now exists in `android/companion`: a per-run 128-bit
token protects a length-bounded `GET` request, and the response contains a
fresh monotonic visual/audio snapshot without PCM or image payloads. It is
served on two channels — a `127.0.0.1:49707` loopback port for the on-device
controller, and an abstract unix socket reachable over `adb forward` for host
tooling. `tools/device/query-companion.sh` proves both boundaries against the
real device. This does not implement `ARM`/`HIT`/`MISS`, detector windows, or
live HID decisions; those remain behind the measurement gates below.

### Window schedule

Windows come from known game/controller state, not from a permanently running
voice-activity detector:

| Window | Arm condition | Candidate use | Maximum span |
| --- | --- | --- | --- |
| BB movement | Around the sourced five-second opportunity | Update an uncertainty set for vocal hops 2–4 | Pre-roll plus the measured sample tail |
| BB final approach | A prior cue/state makes hop 5 possible and the monitor will rise | Prepare the BB/Foxy response; shared thud alone cannot identify BB | Until the monitor-gated edge is resolved |
| ~~BB masked~~ | *Removed 2026-08-24 by gate 0* | No source-proven departure cue exists: the branch plays the shared thud | — |
| Music-box tick | Controller is already winding | Optional clock/phase cross-check | A short expected-tick window |

Do not begin with Mangle static or general hall ambience. The captured static is
known to be polluted, and neither cue directly closes the BB/Foxy scheduling
problem.

## Detector shape

Start with deterministic signal processing, not an ML runtime:

1. preallocate a PCM ring buffer and all feature storage;
2. downmix and resample to a documented mono rate;
3. remove DC and normalize against a per-run background profile;
4. compare log-band or compact spectrogram features against the three BB vocal
   templates and any separately proven departure template;
5. require duration, score margin, and cue-specific thresholds;
6. return `UNKNOWN` for clipping, silence, discontinuity, buffer overrun, or an
   ambiguous top score.

The three random BB vocals need separate measurements. Sample 17's shared thud
may corroborate a state already established by phase and monitor state, but it
must never be the sole positive BB identifier. Persistent Mangle/music-box
energy belongs in negative training and holdout windows; subtracting a baseline
is an experiment, not proof that the artifact is gone.

Keep raw game audio and learned templates outside git. Store them in a local,
ignored calibration directory and commit only collection scripts, schemas,
threshold metadata, hashes, and aggregate reports. Controller mode must neither
write PCM to disk nor upload it.

## Controller semantics

Audio is an observation, not permission to bypass defenses.

- Track an uncertainty set for BB's possible route position using the known
  initial state, five-second opportunities, monitor state, and accepted cues.
- Track scheduler phase separately from route position. The visual HUD latch
  owns the current epoch estimate; a vocal may corroborate it only when its
  measured onset/IPC latency leaves the entire confidence interval inside a
  simulator-derived safe epoch window.
- Let a strong vocal cue narrow that set or arm a visual check; do not invent
  the silent first hop.
- Use a shared thud only as corroboration of a transition that controller state
  already makes possible.
- ~~Unmask before the fifth tick only after a unique departure cue is tied to
  the source transition~~ — **withdrawn 2026-08-24.** The departure cue exists
  but is sample 17, shared with four other characters' mask-clears that fire
  under the same condition. A rule keyed on it unmasks on someone else's
  departure while BB is still at 122. Hold the mask to the fifth tick.
- On `MISS`, `UNKNOWN`, projection loss, control-channel loss, or deadline
  expiry, use the existing visual/full-duration behavior. Disable audio for the
  rest of the night after a capture-path failure rather than repeatedly
  restarting it mid-run.
- Do not promote the phase-windowed sparse-left table on the stock-HID
  actuator: it is simulator-rejected even with a known epoch. Any future table
  still needs an unambiguous fresh epoch; an old/stale one is not a
  conservative observation.
- Never translate an unknown cue into “threat present” blindly. On Night 7,
  unnecessary mask time can itself be lethal through Foxy, so fallback must be
  the simulator-proven non-audio policy or a bounded visual check.

The first useful version may therefore be shadow-only or advisory. If the
simulator shows that one realistic missed/false cue can kill a run, audio must
not drive that branch until an independent observation removes the single-point
failure.

## Work packages and promotion gates

### 0. Source-map candidate cues

- Locate the Android sound-play events for BB vocals, sample 17, vent sounds,
  and the marker-122 early and forced departure branches.
- Record a table of sample ID, state transition, event ordering, expected game
  tick, and whether the sound is unique or shared.
- Correct any trainer wording that treats a synthesized label as source fact.

**Gate:** no cue can control an action until its state edge and uniqueness are
documented. If the early-leave branch has no unique playback event, remove early
unmasking from scope.

**Closed 2026-08-24.** `readdump.py sounds 3` indexes all 40 sample handles in
the Office frame; the register-bank indirection is documented in the ledger.
Verdict by cue:

| Cue | Uniqueness | Consequence |
| --- | --- | --- |
| Departure (g292/294) | Sample 17, shared by 18 edges / 7 characters | **Early unmasking removed from scope** |
| BB vocals (g414-416) | 23 is sole-trigger; 21 and 24 have non-BB triggers that all require someone at 122/123 | Usable as corroboration given controller state, not as identification |
| Hop 5 into the office (g417) | Sample 17 | Not identifying on its own |
| Arrival at 122 (g607) | Adds sample 21 to the thud | The one edge with a two-sound signature |
| BB footsteps (g702) | `Random(5)+1` from a bank 8 characters share | No unique vent cue |

Every vocal hop sets channel 14 to the same volume, so amplitude carries no
range information — a detector cannot infer distance from loudness.

### 1. Prove playback capture on the target build

- Build the smallest consent/capture probe using the production API path.
- Filter by the game's UID and enumerate the actual audio format returned.
- Collect labeled positive windows for all three BB vocals and negative windows
  covering ordinary ambience, winding, persistent Mangle/static, monitor
  transitions, hall flashes, other characters' movement thuds, and silence.
- Compare the internal PCM with the sound the operator heard; label the capture
  stream, not memory of the audible mix.

**Gate:** every candidate cue needed by the policy must be visible and repeatable
in target-device PCM. Otherwise stop; microphone capture is suitable for
post-run research, not this controller's timing loop.

#### First collection run (2026-08-24): the cue is quiet by design

`tools/device/collect-cue-audio.sh` and `query-companion.sh log` now capture a
whole night in one pass, and 285 seconds of real night audio were collected
across mask-camp and pilot runs. The result is a clean negative with a source
explanation.

Best score over the whole recording, background-subtracted, against each
reference:

| Sample | Best | Background p99 | |
| --- | ---: | ---: | --- |
| 17 shared thud | **0.606** | 0.476 | positive control: every character's hop plays it |
| 21 BB vocal | 0.486 | 0.367 | |
| 23 BB vocal | 0.437 | 0.335 | |
| 24 BB vocal | 0.347 | 0.249 | |

The thud is found repeatedly during nights at 5-8 second spacings, which is the
movement roll, so the capture and the detector both work. No BB vocal cleared
threshold.

The event sheet says why, and it is not bad luck. Channel 14's start-of-frame
default is 50; g414-416 play every route hop at **25**; g906 plays at **60**
when BB is on the camera you are currently watching. The cue the controller
needs is deliberately the quiet one, at half the channel default, which is
exactly where the injection sweep showed margins collapsing (0.033 at -6 dB).

Two consequences.

The gate is **not closed**, and a second collection run sharpened why.

The first pass could not tell "the cue is undetectable" from "the cue never
happened", because the detector was missing almost everything. The positive
control gave it away: the shared thud is played by every character's hop and
hops come every five seconds, yet whole-sample matching found it **0.4 times a
minute**. Matching the reference's most energetic 0.40 s instead of its whole
length found it **7.6 times a minute** at a higher peak score. Averaging a
one-to-three-second template over a mix where other sounds dominate most of its
span scores like background even when the cue is plainly there, so the template
is now its transient core by default.

With that corrected detector, over 559 s of night audio in two independent
runs:

| Sample | Best | p99 | Detections |
| --- | ---: | ---: | ---: |
| 17 shared thud | 0.850 / 0.819 | 0.751 / 0.728 | **4.6 and 2.9 per minute** |
| 21 BB vocal | 0.581 / 0.597 | 0.426 / 0.444 | 0 |
| 23 BB vocal | 0.527 / 0.567 | 0.430 / 0.427 | 0 |
| 24 BB vocal | 0.586 / 0.631 | 0.431 / 0.477 | 0 |

The same detector, on the same recordings, finds the thud several times a
minute and never finds a Balloon Boy vocal. That is a much stronger negative
than the first pass, and combined with the source fact that his vocals play at
half the channel default it points at gate 1's "otherwise stop" branch.

It is not yet that verdict, and the reason is specific: nothing in these runs
independently confirms that BB moved. Absence of the cue and absence of the
event remain confounded, and the thud cannot separate them because BB's own
hops 4 and 5 play the same shared sample. Settling it needs a run where his
movement is established by another modality -- the pilot's own CAM-05 read, or
labeling the recorded video -- or Custom Night's AI 20, which night 6 cannot
reach because it starts him at 5 and only reaches 9 at 2 AM.

One audio-internal shortcut was tried and came back negative. g814 replays
sample 24 every 2000 ms while BB sits at marker 123, and that periodicity is
detectable even where a single quiet vocal is not, so finding it would prove he
had completed the whole route. Scanning all three recordings for a 2 s-spaced
sample-24 pair, the only strong hit (0.747) falls at 54.9 s in the mask-camp
recording -- roughly twenty seconds *after* that run's game over at 36 s. It is
menu audio. No run so far has evidence that BB reached the office at all, which
is consistent with him barely moving at AI 5 and leaves the confound intact.

The detector's own design is implicated. `tools/cue/features.py` removes each
frame's mean to be level-invariant, which is right for robustness to capture
gain and which discards the one quantity that separates a route hop from
`your view`. A detector wanting both needs a separately calibrated level
feature beside the shape score; that is now the first change to make, ahead of
any more collection.

### 2. Build and evaluate the offline detector

- Split calibration and holdout by complete run/session, never by adjacent
  windows from one recording.
- Tune only on calibration data and report a cue-by-cue confusion matrix on the
  untouched holdout.
- Report 95% binomial upper bounds for false-negative and false-positive rates,
  not just “zero errors observed.”
- Replay clipping, truncated pre-roll, missing frames, ambiguous overlaps, and
  the loudest contaminated negatives.

**Gate:** measured error bounds must fit the maximum error rates later derived
by the controller simulator. A good aggregate accuracy cannot hide a dangerous
departure false positive.

#### Front end built and characterised (2026-08-24); the gate is still open

`tools/cue/` implements the detector shape above in stdlib Python: 32 ms
frames, 16 log-spaced bands from 120 Hz to 7 kHz, each frame's own mean
removed so a score is a *shape* agreement rather than a level, and `UNKNOWN`
for empty, silent, clipped, or too-short windows. `packages/source/decompile/extract-samples.sh`
pulls the reference waveforms out of the APK by handle — outside the repository,
always — so cues are matched against ground truth instead of memory of the
audible mix.

**Reference separability, before any device noise.** This is the ceiling:

| | 21 | 23 | 24 | 17 | 25-29 |
|---|---|---|---|---|---|
| 21 | 1.00 | 0.92 | 0.61 | -0.20 | 0.17-0.26 |
| 23 | 0.92 | 1.00 | 0.60 | -0.31 | -0.01-0.08 |
| 24 | 0.61 | 0.60 | 1.00 | **-0.61** | -0.09-0.02 |
| 17 | -0.20 | -0.31 | -0.61 | 1.00 | **0.76-0.83** |

The three vocals cluster and are anti-correlated with the thud, so
vocal-versus-thud is the easy discrimination. The footstep bank is effectively
one sound (pairwise ~1.00) sitting in the thud's spectral region, so it adds
nothing separable.

**Against the real contaminated background.** `tools/cue/evaluate.py` injects a
reference into a captured device window at a swept ratio.
[`ANDROID-AUDIO-CAPTURE.md`](../docs/device/ANDROID-AUDIO-CAPTURE.md) records
that internal capture always carries the music-box loop and Mangle's static;
this measures what that costs. Scored at the *class* level, because gate 0 left
the controller needing "a BB vocal happened" rather than which one:

| Condition | Raw features | Per-run background subtracted |
|---|---|---|
| background only, no cue | **thud 0.835** — a confident false positive | bb-vocal 0.421, margin 0.084 — no confident call |
| vocal at +12 dB | thud wins, vocal 0.13 | **hit**, margin 0.312 |
| vocal at +6 dB | thud wins | **hit**, margin 0.256 |
| vocal at 0 dB | thud wins | **hit**, margin 0.168 |
| vocal at -6 dB | thud wins | hit, margin 0.033 — below the no-cue margin |
| thud injected | hit 0.945-0.967 | not detected |

Raw, the detector is a noise detector: sample 17 is a 3.2 s broadband template
and the contamination alone scores 0.835 on a window that cannot contain it.
The contamination does not merely add noise, it manufactures thud detections.

So the operating rule is fixed by measurement, not preference:

1. subtract a per-run background profile (per-band median across the window)
   before scoring — the contamination is stationary and the cues are transient,
   which is the only property that separates them;
2. decide on the class margin, not the raw score, and return `UNKNOWN` below
   it — at -6 dB the margin falls under the no-cue margin, so that is the floor;
3. never attempt to detect the thud. Gate 0 rejected it from the source side;
   the signal evidence rejects it independently.

**What is still missing, and it is the gate itself.** This is an injection
study against one 5-second background, not held-out evidence. It has no
calibration/holdout split by session, no cue-by-cue confusion matrix, and no
95% binomial bounds, because those need labeled positive windows from real
gameplay where BB actually moves — which needs nights on the phone with
`query-companion.sh record`. The injected ratio is also a proxy: the true mix
contains the game's own concurrent voices, not a scaled reference over ambience.
Do not read the table above as a detector result. It says only that the cue set
is separable in principle and that background subtraction is required.

The projection classifier threshold is unvalidated for the same reason. Pairing
a raw `screencap` with a projection snapshot cannot settle whether Android's
VirtualDisplay scaler matches the offline bilinear simulation that
[`ONE-PIXEL-VISION.md`](../docs/device/ONE-PIXEL-VISION.md) derived its luma
separation from, because the two captures are not simultaneous and the title
screen animates: three attempts gave projection values of 0, 1 and 47 against
box averages of 67, 40 and 37. It needs a static, labeled view -- which means
the calibrated lit left opening during a night, captured with
`capture-screen-sample.sh` alongside a snapshot. Until then the 59 ms read is a
cheap *observation*, not a validated *decision*.

One bug worth keeping: the first front end floored band energies at an absolute
epsilon, so dropping a signal 20 dB pinned its quiet bands while its loud bands
moved, and the "level-invariant" features changed shape purely because the sound
got quieter. The floor is now relative to each frame's loudest band.
`tools/cue/test-cue.py` asserts the invariance that mistake broke.

### 3. Measure window and action latency

Timestamp, with `elapsedRealtimeNanos()` or the native monotonic clock:

- arm request to first PCM frame;
- cue onset to classification;
- window close to `MISS`/`UNKNOWN`;
- result emission to controller receipt;
- result receipt to the first required HID report.

Measure cold service start separately from warm per-window starts. Run enough
windows to report p50, p95, p99, maximum, overruns, and late-result count, then
repeat through a full seven-minute thermal/GC soak with the game active. Disable
disk writes and verbose logging for the production measurement.

#### First leg measured (2026-08-24): result receipt

`tools/device/query-companion.sh latency` times snapshot reads entirely inside
one device shell, against the device's own clock, so no adb round trip is
included. 60 samples on the target:

| | p50 | p95 | p99 | max |
|---|---:|---:|---:|---:|
| snapshot read | 48.8 ms | 59.5 ms | 60.8 ms | 66.9 ms |
| same loop, socket call removed | 22.5 ms | 31.6 ms | 32.2 ms | 32.6 ms |

The observation the controller pays drops from the harness's measured **225 ms**
combined screencap p95 ([`ONE-PIXEL-VISION.md`](../docs/device/ONE-PIXEL-VISION.md))
to **59 ms**, and roughly 22 ms of what remains is the shell forking `date` and
`nc` rather than the socket. That is the strongest argument yet for the
projection path, and it is a measurement of the *observer*, not of a decision.

What that buys the controller is arithmetic on measured parts, recorded in
[`ON-DEVICE-VALIDATION.md`](../docs/device/ON-DEVICE-VALIDATION.md): the
visual-plus-action path falls from 395 ms to 229 ms, slack against the shortest
700 ms BB window rises from 305 ms to 471 ms, and the night-6 cycle recovers
about 664 ms -- the same magnitude as the entire three-cut schedule
optimisation, but by changing the sensor instead of removing checks. This is
the observer plumbing the §4 note anticipated, now priced.

The other legs of this package are not measured. Arm-to-first-PCM-frame,
cue-onset-to-classification, and window-close-to-`MISS` all need the `ARM`/`HIT`/
`MISS` window protocol, which does not exist yet -- only `GET`, `CAL`, and `REC`
do. One number is worth recording in advance as a warning: the offline detector
in `tools/cue/` scores a five-second window against ten templates in about two
seconds of host Python. That is fine for calibration and hopeless for a live
window, so the on-device classifier is a reimplementation, not a port, and its
cost has to be measured on the phone before any deadline arithmetic means
anything.

#### The latency budget an early-unmask would need — and it is out of reach (2026-08-27)

Plan 16 item 10 is "fire the attack cycle's mask-off/reset/raise the instant a
BB departure bang is heard" — the one policy the `bang` cue could still enable.
`tools/minus7/i10latency.mjs` sweeps the whole audio path as one number
(`replay()`'s `bangLatencyMs` = PCM buffering + onset classification + IPC +
reaction) against the blind baseline, 800 seeds correlated:

| bang latency | n2 | n5 | n6 | n7 |
|---|---|---|---|---|
| blind (no early unmask) | 68.5 | 62.4 | 61.1 | 33.6 |
| 0 ms (perfect oracle) | 93.9 | 91.6 | 90.5 | 47.0 |
| 33 ms | 79.9 | 72.6 | 70.9 | 39.8 |
| 50 ms | 74.9 | 64.3 | 62.9 | 36.1 |
| 67 ms | 69.5 | 55.6 | 53.3 | 30.9 |
| 100 ms | 52.4 | 30.5 | 26.5 | 15.9 |

The whole gain is reacting to BB leaving *early* — the 900 ms phase pad is a
worst case, the bang says when he actually went — so detection latency eats it
directly. **The budget is end-to-end < ~33 ms for a useful gain, < ~50 ms to
break even; above ~67 ms it is a net loss on n5/n6/n7.**

Against that budget:

- Android's CDD recommends **continuous input latency ≤ 30 ms** — and that is
  the PCM-delivery leg *alone*, before onset classification or IPC. Cold input
  latency (this package's windowed-capture default) is recommended ≤ 100 ms,
  allowed ≤ 500 ms. A *continuously-capturing* detector armed at mask-on avoids
  cold start but still pays ~30 ms delivery + classification + the 5–22 ms IPC
  leg measured above ≈ 50–90 ms — already break-even to net loss.
- The g56's audio path is unmeasured, and the `ARM`/`HIT`/`MISS` protocol to
  measure it does not exist.
- This model assumes a **perfect** detector. Real false-negatives (a missed
  departure bang → the recovery fires on the 400 ms fallback → collapse) and
  false-positives (an early non-BB thud during the hold → raise before BB left
  → the `onCamsUp` walk-in) both make it strictly worse, and the thud
  detector's FP rate is package 2's named open unknown.

**So item 10 is closed on latency, not merely blocked on this plan.** The
`bang` cue cannot enable an early unmask that helps, and the last remaining
argument for finishing this package's timing legs *for a Minus 7 survival gain*
is gone. The cue helper's value is now entirely the fast **visual** read
(plan 15 package 5) and shadow-mode research, not an audio-driven Night 7
action.

**Gate:** p99 completion plus the existing mask/monitor/input sequence and an
explicit margin must land before the simulator-derived action deadline. Also
show that the helper does not add unacceptable frame, input, audio, or thermal
jitter. Android's API says capture does not add latency to the *playing app*;
that does not excuse measuring the helper's CPU and scheduling cost.

### 4. Add audio observations to the simulator

- Model each cue's onset, measured latency distribution, confusion matrix,
  missing-window probability, and control-channel timeout.
- Test cue-assisted policy changes independently: CAM-05 check arming first,
  scheduler-phase corroboration second, early departure last.
- Include persistent/background false triggers and shared-thud ambiguity.
- Run at least the repository's current 10,000 ordinary and 3,000 worst-case
  seed classes, plus targeted boundary sweeps around five-second movement,
  mask, monitor, Foxy, and camera-stun deadlines.
- Force each single failure mode in isolation, then sample compound failures
  from the measured distributions.

**Gate:** the cue-assisted Night 7 policy must improve the relevant conflict and
remain safe on timeout/unknown. The simulator sets the detector error budget;
do not choose a convenient accuracy target first and rationalize the policy
around it.

#### Perfect-vocal upper bound (2026-08-24)

`packages/propose/parked/minus7/hid-device-pilot.mjs --night=7 --vocal-cam5` now counts the three sourced
vocal events and arms the existing lit CAM-05 confirmation only after the third.
It is an upper bound with zero capture latency and perfect cue delivery, not a
detector claim:

| Cohort | Survival | BB reads/night | Minimum power |
|---|---:|---:|---:|
| 3,000 ordinary | **3,000/3,000** | 25.0 | 218/3000 |
| 1,000 pinned worst | **1,000/1,000** | 28.0 | 373/3000 |

This halves the ordinary sparse-CAM-05 read count and makes the current 520 ms
lit-read model fit, but its direct error budget is unacceptable. Forcing any
one of vocals 1, 2, or 3 to be missed produced **0/1000** survival: the counted
third cue never arrives, BB reaches the office, and Foxy collects. Prefixing one
to three false vocal counts remained mechanically safe behind CAM-05 visual
confirmation, but reduced the minimum power to 187, 125, and 94 frames. That is
only a bounded false-positive diagnostic, not a false-positive-rate model.

Therefore the pure counted-vocal controller is rejected for promotion. The
useful architectures left are:

- use a strongly accepted vocal to arm an occasional lit CAM-05 visual check,
  while a timeout or ambiguity falls back to the explicitly modeled scan; or
- maintain a route uncertainty set and fall back to visual scanning on any cue
  ambiguity, with the resulting power cost tested from measured detector
  errors; or
- independently search for a unique, source-proven departure cue, whose early
  unmask action remains behind the stricter gates above.

Scheduler-phase audio is now diagnostic only. A working MediaProjection path
is still valuable because the same approved session can provide lower-overhead
visual observations and eligible playback PCM, but it supersedes the observer
plumbing—not the actuator measurement or the simulator rejection.

The next simulator iteration must ingest actual cue latency/error distributions;
the perfect-event mode and forced single miss now provide the upper and lower
regression anchors.

#### Bang-armed CAM 05 (2026-08-24): a one-sided error budget

With the cue map corrected, the policy worth testing is not the counted vocal.
It is the **bang**: loud, and Balloon Boy's alone while the stalls hold.
`packages/propose/parked/minus7/hid-device-pilot.mjs --night=7 --bang-cam5` reads only that a bang happened —
never `who`, `cam` or `leaving`, none of which audio can recover — and the run
is a three-bang cycle (reaches CAM 05, enters the opening, leaves) because his
first three hops are silent.

Two things had to be got right before it beat the vocal policy.

**Counting alone is no better.** A bare three-bang counter survives 300/300
clean and dies 0/300 on a single miss *or* a single false positive, exactly as
the vocal count did: one error shifts the phase for the rest of the night.

**There is no cheaper fallback to degrade to.** The obvious fix — let a bang
only pull the read earlier than a scheduled scan — fails because the scan is
itself fatal: `--cam5` is **0/300** and `--sparse-cam5` is **0/300** on night 7.
Reading on a schedule loses on power, which is why the vocal policy's rarity was
doing more work than it looked.

So the read re-syncs the count instead. The CAM 05 read is ground truth about
where he is; the bang only decides when to spend one. Confirmed on CAM 05 sets
the count to one whatever it was; a read that finds nothing drops the count and
waits for a fresh first bang rather than carrying a corrupted phase.

| | survival | min power |
|---|---|---:|
| clean | **300/300** | 280 |
| pinned worst | **200/200** | — |
| one false bang | **300/300** | 249 |
| two false bangs | **300/300** | 249 |
| any one dropped bang | 0/300 | — |

False positives are absorbed and their cost **saturates** — the second one is
free — where the counted-vocal policy fell to 187, 125 and 94 on one, two and
three. Misses stay fatal, and that is structural rather than fixable in policy:
a missed first bang means no read is ever armed, so the visual cannot rescue
what it never looks at.

That inverts the detector's operating point. The usual instinct is to raise the
threshold until false positives vanish; here false positives are nearly free and
misses are lethal, so the correct setting is the **most sensitive threshold the
power budget tolerates**.

**Its premise is unverified on device, and one run went against it (2026-08-24.)**
The bang is Balloon Boy's alone only while the seven are stun-locked. In a
device run that evening, Withered Bonnie *and* Balloon Boy both reached the
office and Foxy took the night: the stall discipline the uniqueness rests on
did not hold. That run cannot settle it -- it used `PRESS_MODE=hid-multi`, the
newest and least-proven actuator, chosen mid-session without checking it was
validated for this loop, and it carried no BB check at all because the CAM 05
captures had been dropped to save budget. So the failure has two live
explanations, the strategy's stalls or the actuator, and this run separates
neither.

It is not evidence against the stalls at all, which a later pass established:
`HID-MULTITOUCH.md` already records that this exact configuration -- an HID
schedule with no BB read or response -- survives **0/3000** in the exact
simulator, "predominantly through the BB-to-Foxy failure chain". The run
reproduced that chain rather than discovering anything. Its box sat at 80-100%
throughout, so the wind was never the problem either.

The simulator's 300/300 still is not a device result -- it prices no press and
no observation -- but the bang policy's premise remains **untested** on device
rather than contradicted. That is a design conclusion the device work can act on
directly, and it is only reachable because the bang is the loud cue — the one
measured at 2.9-4.6 detections per minute on the phone, where the vocals were
6-16 dB short.

**Correction (2026-08-24, from gate 0).** That upper bound is further out of
reach than recorded above. `--vocal-cam5` resets its count on
`vent-bang who === 'bb' && leaving`, and `tools/minus6test.mjs` counts threats
with `who !== 'bb'`. Both read an identity the source does not put in the
audio: every one of those events is sample 17. The 3,000/3,000 figure therefore
assumes a perfectly attributed departure cue that no detector can produce, on
top of the perfect vocal delivery already noted. It does not change the
rejection — that policy was already rejected — but any successor must derive
identity from controller state. The events now carry a `sample` field so a
policy can be held to what the phone can hear.

### 5. Shadow on the real device

- Run the helper and controller together, but log suggested observations while
  the current controller ignores them.
- Label outcomes against synchronized video/source-derived state where possible.
- Exercise projection revocation, app background/foreground, focus loss, helper
  death, audio silence, IPC loss, and harness interruption.
- Publish per-cue counts, late results, unknowns, and confidence bounds; do not
  summarize a night as merely passed/failed.

**Gate:** the shadow distribution must match or improve on offline/soak evidence,
and every lifecycle fault must degrade to the documented non-audio behavior.

### 6. Enable one bounded action at a time

Promote approach-state updates before early unmasking. Keep a run-time kill
switch, an audio-disabled control mode, and structured decision logs without
PCM. The first action-enabled trial must use a branch that a timeout can still
recover from. Early unmasking is last and requires all prior gates plus an
independent guard that makes a false departure classification non-lethal.

## What landed on 2026-08-26, and what it does not close

A live, fail-closed, **shadow-only** detector now exists on the device side.
Recording it here because a capability that no page describes gets rebuilt.

**What is real.** `CueDetector.java` scores 4 kHz templates against captured
PCM and refuses in every direction it can: no model → `detector=UNAVAILABLE
reason=model-missing`; a malformed model → a *named* reason per field
(`model-header`, `model-margin`, `model-pcm-alignment`, `model-silent-template`,
and six more); and every runtime degradation becomes `UNKNOWN`, never a value —
`no-audio`, `clipped`, `silent`, `unsupported-rate`, `audio-discontinuity`,
`capture-stopped` on projection revocation. `ARM`/`RESULT`/`MODEL` verbs exist
end to end, `provision-cue-model.sh` installs a model atomically into app-private
storage and verifies the staged bytes' SHA-256 back over adb before the rename,
and control mode is refused unless the model claims `evidence=heldout`.

**It cannot influence a run, and that was checked rather than assumed.**
`trial.sh` sends the helper exactly one verb, `GET`, and every consumer
of that reply parses only `luma=`/`cam05_mean_luma=`/`ageUs=` — the *visual*
classifier. `ARM` and `RESULT` appear nowhere in the runner. The detector's
verdict reaches it only as an inert trailing `detector=…` string that no parser
reads.

**It closes no package.** Packages 2, 3, 5 and 6 remain open; this is the
prerequisite plumbing they were waiting on, not their evidence. Specifically:

- Package 2 has an *exporter*, not an evaluator. `evaluate.py` still takes no
  session split and produces no confusion matrix.
- Package 3 is unmeasured, and one of its quantities is **unmeasurable as
  built**: close→MISS latency cannot be observed, because `completeIfExpired`
  is only reached from `accept()` or a `RESULT` poll — nothing emits at window
  close.
- Package 5 has protocol but no evidence: no shadow run exists, and no artifact
  anywhere records an `ARM`/`HIT`/`MISS`.

### Three defects in it, found by audit the same day

1. **The provisioned model's `threshold=0.25` and `margin=0.05` are guessed.**
   Neither is derivable from anything in this repository. `export-model.py`
   states in its own source that no threshold is guessed — and a guessed one was
   then provisioned onto the phone. The nearest measured anchors (`correlate.py`:
   thud 0.505 at equal level, background alone 0.049, menu 0.183) were taken at
   **16 kHz**, while the device scores at **4 kHz** through a bare 4-tap box
   average with no anti-alias filter, and nothing measures what that decimation
   costs separability. The plan's own measured margins are a different quantity
   again — background-subtracted log-band class margins, not the between-cue NCC
   margin the Java computes. Derive both or retract them; a favourable number
   with no derivation is the defect this repository exists to avoid.
2. ~~**`heldout` promotion is honour-system.**~~ **CLOSED 2026-08-27.**
   `Model.read` still cannot verify this on-device (it never receives the
   report), so the gate lives host-side in `provision-cue-model.sh`, which now
   refuses a heldout model unless a report is supplied whose hash matches the
   model's `reportSha256=`, whose own JSON is a passing whole-session-split
   holdout, and whose `model_sha256` matches a reconstruction of the exact
   shadow-form bytes it claims to have scored -- not merely *a* passing report
   attached to the wrong model. That last check was the actual gap: the first
   two alone let a genuinely-passing report from one promotion be hand-copied
   onto an unrelated model's header, since nothing compared the report's own
   claim against these templates. `test-provision-cue-model.sh` proves it: the
   same fixture with only that check removed installs a passing-but-wrong
   model clean.
3. **Background subtraction is silently absent on device.** Package 2 fixed it
   *by measurement* as an operating rule — contamination manufactures thud
   detections, with a raw 0.835 scored on a window that cannot contain one.
   `CueDetector` does no background estimation at all.

Also: the detector is fail-closed against *missing* and *malformed* models but
not against *stale* ones. There is no expiry and no binding to the game build,
the APK, or the capture config; `calibration=` is a free-form string. "Stale" is
not a state this design can report.

## Deliverables

- `tools/android/audio-cue/` helper source, reproducible build instructions, and
  exact Android permissions/API contract;
- an ignored local calibration layout plus a versioned manifest/report schema;
- capture probe, offline replay evaluator, and timing/soak command;
- simulator cue/error injection with a Night 7 policy report;
- shadow-mode integration in the device harness;
- updated source-status, device-validation, and tool-index documentation with
  dated evidence.

## Done when

The task is complete only when the source mapping, target-device capture,
held-out detector results, latency soak, simulator policy, lifecycle fallback,
and shadow evidence all agree. Until then, “Android can capture audio” is a
feasibility fact—not evidence that an audio cue can safely control Night 7.

**Withdrawn 2026-08-26. Kept because the retraction is the lesson.** The
paragraph below is the earlier reading this plan's status block already calls
wrong — the one that reasoned from the event sheet without crossing it against
`MINUS-7-STRATEGY.md`'s stall roster. It was left standing in this section after
the correction was written into the header, so the file said two incompatible
things at once: the package table records packages 2, 3, 5 and 6 as open and 4
as advanced, while this said there was nothing left for them to measure. A
2026-08-26 audit of `PROGRESS.md` against every plan caught it, and read
literally it would have credited five phantom closures.

> **Resolved 2026-08-24, by refutation.** The source mapping and the
> target-device capture disagree, which is a complete answer and not a partial
> one: the sourced cue exists, is identified well enough for the surviving
> architecture, and is played too quietly to recover from this phone's internal
> mix. The held-out detector, latency soak, simulator policy and shadow evidence
> are not pending work — there is nothing left for them to measure. “Android can
> capture audio” turned out to be exactly the feasibility fact this section
> warned it was.

What survives of it: the *vocals* are too quiet to recover from this phone's
internal mix, and that leg is closed. The **bang** is not — it is found
repeatedly in target-device PCM, which is why package 1 passes for the cues this
strategy needs and packages 2 through 6 still have something to measure.
