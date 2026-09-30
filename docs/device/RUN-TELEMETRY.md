# What an on-device night run should record, 2026-08-26

A design survey, not a change. Nothing here was run on a phone; every number is
cited to the page that measured it, and anything unmeasured says so.

**Who reads this record.** Not a human with a dashboard and not a rigid parser:
a session that picks up cold, reads what the last run left behind, and has to
work out what happened. That sets the format rule — a field that names its
clock, its sensor and its meaning beats three unlabelled numbers, and
`UNKNOWN(reason)` beats a plausible wrong number, because an agent can reason
about the first and cannot about the second. Every diagnostic failure below was
a surprise, so a record shaped only around the failures we already knew about
would have missed all of them.

It does **not** relax the two rules that matter. Latitude in shape, none in
honesty:

- **Telemetry that changes the run is not telemetry.** Everything below is
  priced in milliseconds against the ~680 ms the cycle has free
  (`plans/10:267`, `README.md:255`).
- **A record must never assert something it did not observe.** The v1 manifest
  already enforces this — `session_close` writes `lifecycle=unknown` on the
  *success* path, because completing six cycles is not surviving to 6 AM.

---

## 1. What a run leaves behind today

`trial.sh` writes its manifest on every exit path (`cleanup` →
`session_close`), so both cases below are described sessions.

### A completed run

| Artifact | Written when | Notes |
|---|---|---|
| `captures/RUN.mp4` | always (epoch-latch path) | 1280x576 H.264 @ 3 Mbps, **video only** — `screenrecord` carries no audio (`ANDROID-AUDIO-CAPTURE.md:61-64`) |
| `captures/RUN-epoch.txt` | `DEVICE_EPOCH_LATCH=1` (forced) | one line: `epoch_ms`, previous clear, bracket, confirmation, attempts, detector |
| `captures/RUN-session.json` | always | v1 manifest: build, device, display, clocks, alignment edges, artifact hashes, model hashes, controller, outcome |
| `captures/RUN-session.events.jsonl` | always | the event stream, hashed into the manifest as its own artifact |
| `captures/screencheck-keep/RUN/` | when a read was not confidently `empty` | 2400x1080 raw frames, ~10.4 MB each, named `ELAPSED-CLASS.raw` |
| `captures/RUN-hid.jsonl` | **only if `HID_TRACE_RUN=1`** | default is **0** |
| `captures/RUN-cue.txt` | **only if `CUE_HELPER=1`** | default is **0**; ~14 Hz `GET` responses |
| Android cue-helper PCM | never | The APK is visual-only; external rendered audio belongs to `tools/cue/audio-authority.py` |
| `captures/RUN-audio-facts.jsonl` | **only if `CUE_AUDIO=1 AUDIO_AUTHORITY_SOCKET=PATH`** | `fact-message-v1` JSONL sidecar from the receiver authority; transport/profile identify BlueALSA, ESP32, or another backend |

### An aborted run

The same list, with `RUN.mp4` replaced by `RUN-aborted.mp4` (pulled only if
`RECORDING_STARTED=1`), plus a `fault` event naming the watchdog text or the
driver's exit status. **`grade-run.sh` does not run** — grading is success-only
(`trial.sh:760`), deliberately, so a Ctrl-C stays a Ctrl-C. So the run
that failed is the one that is not graded unless somebody remembers to type
`grade-run.sh RUN`.

### What is *not* on disk, in either case

1. **The run's own log.** The remote driver's stdout and stderr — every
   `%6d ms  label` line, every `classify-bb-left <class> <score> cams=… cue[…]`
   line, every desync counter, every branch taken — go to the operator's
   terminal. Nothing tees them. There is no documented convention of
   redirecting them. **The per-cycle observation-and-decision timeline of every
   night this project has ever run exists only as scrollback**, and the quotes
   in `ON-DEVICE-VALIDATION.md` are what survived by hand.
2. **Any `observation`, `decision` or `action-result` event.** The v1 event
   schema defines all three, with `sensor`, `model_sha256`, `score`,
   `unknown_reason`, `valid_from`/`valid_until`, `label_provenance`,
   `controller_state`, and a `decision` carrying its own deadline. The runner
   emits **none of them**: `grep fnaf_session_event` finds two `lifecycle` calls
   and two `fault` calls, and that is all. `plans/09:209-211` says why — the
   stream "records lifecycle transitions and faults only. Per-press observation
   and decision records are device-side."
3. **The three defaults that are off.** A run launched with no environment
   produces no HID trace, no cue trace and no audio. Without the HID trace
   `grade-run.sh:132-143` silently skips **both** `test-hid-trace.mjs` and
   `desync-scan.py` — the two instruments `CLAUDE.md` names as the only ones
   that see the monitor desync — and still prints "every instrument passed"
   (`ARCHITECTURE-AUDIT.md:126-160`). The default configuration of the runner
   produces the least diagnosable run.

### And one hard ceiling nobody has hit yet

`MAXDUR` is capped at 180 s because "Android's `screenrecord` rejects limits
above 180 s" (`trial.sh:897-899`). A night runs to `base < 419000`, about
**426 s**. So a run that reaches 6 AM has video for its first three minutes and
nothing after — and `grade-night.py`, which `grade-run.sh:110` labels *"the only
number that is a run length"*, reads the video. **A winning run cannot currently
be graded as a win.** That is the mechanism behind `PROGRESS.md:64`'s "Capture a
6 AM and the minigames; both still report unknown". Re-check the cap on this
handset (AOSP relaxed it), and if it is real, either chain segments and record
the gap, or accept the cue-helper trace as the long record (§4, item 7).

---

## 2. The failure ledger

Each row is a real case where the run's own record was insufficient. The middle
column is a specific quantity at a specific point in the cycle.

| Failure | The signal that would have made it obvious | Price |
|---|---|---|
| **163 s / 153 s reported, 26.0 s / 72.2 s alive** (`V:597-627`) | Nothing new was needed. `screenstate.py` could have refuted it from any single frame; the grading step ran against `$OUT.mp4` while the file on disk was `$OUT-aborted.mp4`. What was missing was a step that **fails when it cannot find its input** — now `grade-run.sh` | 0 ms (fixed) |
| **One lost monitor press inverts the night and nothing notices** (`V:753-855`) | The HID trace plus the recording, cross-correlated. Both existed; the trace was **optional and usually absent**. 9 of 14 desyncs are one instruction pair at 100-178 ms after a mask press; nothing at or past 180 ms was lost in 17 tries | one `printf >>` per report, currently off by default |
| **"Started panning view instead of flashing"** (`V:713-751`) | The device owner reported it before any log did. The in-run `cams=UP-DESYNCED` check now exists — but it runs **only** when the classification is not confidently `empty`/`bb`, and its result is a `printf` | 0 ms (the same raw frame, asked a second question) — but the answer is not retained |
| **"Fails to press hall light and moves the vision instead"** (`V:631-637`) | `hid` rejects a zero-length delay, exits, and the co-process dies at the next write. The owner saw it first. What no record carried: the **hid process's own liveness and stderr**. `HID_PID` is polled once, at attach | one `kill -0` per cycle (~0 ms) plus capturing hid's stderr to a device file |
| **Grading a file that did not exist** (`V:617-620`) | A step that cannot find its input must say so and fail. `grade-run.sh` now finds whichever capture exists; `ARCHITECTURE-AUDIT.md:126-160` lists seven paths through it that still pass on zero measurements | 0 ms (already diagnosed, not fixed) |
| **22 audio "thuds", all false positives** (`plans/08:504`) | The control that caught it: a recording that **cannot** contain the cue — background only scored `thud 0.835`. Nothing about run telemetry would have caught this; it is a detector-validation failure | n/a — see §7 |
| **The ~300 ms lateness figure** (`plans/12:254, 272-276`) | The anchor press's **target offset printed beside its actual landing**. The value is already in a shell variable at the moment the line is printed; only `actual` is logged, so lateness had to be back-computed from where the vent light landed | **0 ms** — the widest value-per-millisecond gap in the whole survey |
| **Night 6-38's false correction at 247 ms into a 367 ms animation** (`V:820-836`) | The gate now waits `MONITOR_ANIM_DOWN`. What the record still cannot show: **the cue read's own latency**. Every correction on file triggered on a saturated `luma 255`, and a stalled read (1-3% of reads stall ~1060 ms, `V:1281-1285`) is indistinguishable in the log from a fresh one | two `/proc/uptime` reads around each cue read = **0.72 ms** |
| **The auditor's clock over-advanced** — 68/252, 10/36, 56/130 marks discarded, drift to **2742 ms** (`V:1041-1091`) | A runner-clock timestamp on **every** emitted hid report, not only at wall-timed boundaries. The code declines to do this because "that would put a clock read in the hot path" — written when a clock read was a 21 ms fork. It is now **0.36 ms** | ~30 reports/cycle × 0.36 ms ≈ **11 ms/cycle** |
| **Night 6-45's zero-gap "no trace clock can see"** (`V:909-935`) | Queue depth. The marks record the host's *intent*; when the shell writes into a backlogged hid stream, the write and the delivery diverge and nothing measures the difference. Write-time timestamps make the queue visible as the growing gap between the write series and the delay-accumulated series | same 11 ms/cycle as above |
| **Today: `screenstate.py` called the New Game cutscene a `night`** (`ARCHITECTURE-AUDIT.md:78-125`) | Four copies of the predicate; two got the fix. `grade-night.py` — the survival authority — did not, and the newspaper plays on **exactly the New Game route Nights 1-5 need** | 0 ms; a fixture test, not telemetry |
| **Today: box drain disagrees with `src/config.js` by 3.3x on Night 1** | A **time series** of the CAM 11 pie, not a mean. `windpct.py --samples` already produces one, from the video, offline, for free. It took a dedicated non-winding run to find, and the caveats — the pie is not known to be linear in counter units, activation bracketed only to 133-142 s — are the record doing its job | 0 ms; retain the series |
| **Today: the model gate passed on its seed block** | Not run telemetry. Night 6 was correctly refused at **449/1200 = 37.4%** after its apparent 46/100 pass. Restoring the first post-read Foxy reset raises the same sample to **673/1200 = 56.1%**; Nights 1–5 remain above contract at 99.1, 68.9, 78.8, 73.2, 63.9%. The lesson remains: if any telemetry proposal ever samples, use a broad named sample — the favourable sequential block produced the false pass | n/a |

---

## 3. Ranked by diagnostic value per millisecond

Prices are per five-second cycle unless stated. "0 ms" means no device-cycle
cost, not no work.

| # | Signal | Price | Catches |
|---|---|---|---|
| 1 | **Persist the driver's stdout+stderr** to `captures/RUN-run.log` and register it as an artifact | **0 ms**; ~8 lines/cycle × ~80 B ≈ **70 kB/night** | Everything above that was "reported by the owner before any log showed it" — because after the fact there is no log at all |
| 2 | **`HID_TRACE_RUN=1` by default** | one builtin `printf >>` per report; **unmeasured** — see §6 | Restores `test-hid-trace.mjs` and `desync-scan.py`, which are skipped silently today |
| 3 | **Print the target offset beside `actual`** at every `press_at` / `hold_at` / `wait_until` | **0 ms** — the value is already in scope | Per-boundary landing error, measured instead of back-computed. Closes `PROGRESS.md:34-37`'s stated criterion and retires the forbidden ~300 ms figure |
| 4 | **Timestamp every `hid_emit` with `now_rel`** | 0.36 ms × ~30 = **~11 ms** | The auditor's 2742 ms clock drift; queue depth at the seam |
| 5 | **Bracket every cue read** with `now_rel` and log the raw response verbatim | 0.72 ms × ~2 = **~1.5 ms** | The 1-3% / ~1060 ms stall tail that *every night since the trace feature landed* carried invisibly, and part of the documented 30-900 ms capture lateness |
| 6 | **Three clock reads per wall-timed boundary** — entry, return, immediately before the first `hid_down` byte (`plans/12:313-319` specifies exactly this) | ~1 ms × ~10 boundaries = **~10 ms** | Separates arrival slip into wait overshoot, shell launch, and write latency. Today only the composite is logged, which is why 49-106 and 110-300 cannot be reconciled |
| 7 | **Switch the continuous cue trace from `GET` to `GRID`** | **0 ms** — measured p95 68.3 ms (GRID) vs 70.2 ms (GET), n=120, `V:1267-1269`. Runs in its own device process. ~15 kB/s → **~6.3 MB/night** | Turns three scalars into a 20x9, ~14 Hz record of the whole night — the only artifact not capped at 180 s. `V:1270-1272`: *"The full sensor frame costs the same as the single pixel."* |
| 8 | **PCM `startNs` sidecar** beside the WAV | **0 ms** (cleanup), ~40 bytes | The inventory's only "**Critical gap**" (`OBSERVATION-CORPUS-INVENTORY.md:149`): `log stop` prints it and `query-companion.sh` throws it away, so every WAV on disk is unalignable |
| 9 | **Second `(date, /proc/uptime)` latch at run end** → drift | **21 ms once**, in cleanup | `PROGRESS.md:36`'s second criterion: whether the `/proc/uptime`↔epoch offset drifts across a night |
| 10 | **One `GRID` read paired with each classifier `screencap`** | **68.3 ms p95** | The labelled cross-sensor pair `plans/15` package 4 needs, as a by-product of every night. Today the 42/59 ms sensor cannot answer the BB question because its threshold was calibrated on the 225 ms one |
| 11 | **`soak-companion.sh`'s sampler alongside the night** — helper PID, RSS, thermal, status age, visual/audio counters | **0 ms** (separate `adb shell`) | "A consented helper that can die mid-night" (`V:270-277`), and the `Address already in use` restart failure (`ANDROID-AUDIO-CAPTURE.md:120-128`) |
| 12 | **`kill -0 $HID_PID` once per cycle**, and hid's stderr to a device file | ~0 ms | The zero-delay `IllegalStateException` that ends the night at the next write, which the owner saw before the log did |
| 13 | **`getevent -lt` on the HID node**, dedicated run | separate device process; unmeasured perturbation | The **only** measurement of the write→kernel leg, currently a bound (≤~13 ms, `plans/12:268-270`) inferred from two agreeing measurements |
| 14 | **`logcat -v threadtime` for the run** | separate `adb` channel; ~1 MB/night | App crashes and helper exceptions. Nothing else — the game is a Fusion export and logs no state |

**Total for items 3-6, the ones that go in the pilot's own path: ~23 ms per
5000 ms cycle, 4.6 ms/s.** For calibration: the observation that collapsed the
music box from 52% to 10% was a 206 ms `screencap` every ~20 s — 10.3 ms/s —
and it did that damage *because it landed on the wind*, truncating a 1.5 s hold
to 0.67 s (`V:313-319`). Cost placed in the plan's ~416 ms of post-read slack is
not the same object as cost placed in front of a hold. Place these in slack,
and re-measure the box either way: `windpct.py --samples` is free.

---

## 4. Free, priced, and dedicated-run

**(a) Free — no device-cycle cost.** Items 1, 3, 8, 9, 11, 12, 14 above, plus:

- Emitting the `observation`, `decision` and `action-result` events the v1
  schema already defines, for everything the **host** knows: menu selection,
  epoch latch, watchdog verdicts, terminal outcome. Host-side, and the host is
  blocked on `wait $DRIVER_PID` for the whole night. A `session-manifest.py`
  invocation measured **73.7 ms** here (20 samples, import and arg-parse, no
  spool write), which is why it can never be the device-side mechanism — but on
  the host, during the night, it costs the run nothing.
- Retaining the `windpct.py --samples` series rather than its mean.
- Registering the run log, the sidecar and the trace as manifest artifacts, so
  their absence becomes an `artifact-absent` fault instead of silence.

**(b) Priced — costs run time, budget it.** Items 4, 5, 6, 7, 10. Items 4-6 are
~23 ms/cycle and belong in slack. Item 7 is measured-free at the socket but
multiplies the trace's write volume ~7x in a separate process, so it needs one
control before it ships: re-run the 120-sample latency loop with the trace in
`GRID` mode and confirm the pilot's own worst read stays at 83.8 ms and
`/proc/net/netstat` stays flat — the same control that caught the seven
orphaned parasites (`V:1283-1307`). Item 10 at 68.3 ms is opt-in per run, not a
default.

**A second `screencap` is never affordable.** 225 ms p95 against 680 ms free,
and the run already spends one.

**(c) Dedicated instrumented runs — not promotion attempts.**

- `getevent -lt` for the whole night, to measure the write→kernel leg.
- Retaining **every** classifier frame, including confident `empty` — 10.4 MB ×
  ~84 cycles ≈ **870 MB/night**. The inventory names the bias directly:
  *"Normal confident-empty frames are deleted, preventing an unbiased
  live-distribution replay"* (`:170`). One run, then delete.
- The contact-length ladder (100/66/50/33/25/17/8 ms against a control
  coordinate) to settle 30 Hz vs 60 fps — `FUSION_POLL_MS=33` and
  `SOURCE-DUMP-GUIDE.md` disagree, and the answer is the difference between a
  16.7 ms and a 33 ms quantisation floor on a two-frame budget
  (`plans/12:323-331`).
- A non-winding night per night 2-5, repeating the Night 1 box measurement.
- `screenrecord --bugreport`, which overlays a per-frame timestamp and would
  give the video the alignment edge the manifest currently declares it does not
  have. **Check the collision first**: `clocktrace.mjs:45` crops at
  `1070,10` in the 1280x576 frame, which is where that overlay lands.

---

## 5. Off the critical path entirely

**Already in the repository and not used during a night:**

| Thing | Status |
|---|---|
| The helper's `GRID` verb | Exists, wired into `query-companion.sh`, **never used in a run**. Its cost has been *measured* (68.3 ms p95) but its cost *inside the trace loop* has not |
| `getevent -lt` | Used once, offline, on empty wallpaper, to measure `hid_delay`'s 0.76 ms stdev. Never during a night |
| `soak-companion.sh`'s process sampler | Exists; runs only in soak tests |
| The v1 `observation`/`decision`/`action-result` event kinds | Defined in `schema/session-events-v1.json`; nothing emits them |
| External audio facts | `CUE_AUDIO=1 AUDIO_AUTHORITY_SOCKET=PATH`, off by default. The trial subscribes to the live external authority and persists its JSONL facts; it never falls back to Android `AudioPlaybackCapture` |
| `windpct.py --samples` | The series is computed and discarded |
| `keyframes.py` | In `grade-run.sh`. Worth keeping: a tiled PNG is not a human-only artifact when the reader is multimodal |

**Would be new:** `logcat` capture, `/proc/net/netstat` sampling around cue
reads, a device-side JSONL appended by the remote shell (mechanism below).

**The mechanism gap.** The event stream is host-side Python; the observations
are device-side shell. There is no bridge, and 73.7 ms per host invocation says
there cannot be one per press. But the runner already solves this problem once:
`hid_emit` appends a line to a device file with a builtin `printf`, the file is
pulled in `cleanup`, and it becomes a manifest artifact. **Use that same shape
for observations** — one device-local JSONL, appended by the remote shell,
pulled and merged into the event stream at finalize. Do not invent a second
format; the v1 event schema's `value: any`, `note`, `unknown_reason` and
`controller_state` fields are deliberately open, and that openness is what lets
a record answer a question nobody thought to ask.

---

## 6. Numbers this survey could not source

Say these out loud rather than assuming them.

- **The cost of one `printf >> file` in the remote shell.** Item 2 and item 4
  both rest on it. It is a builtin plus one open/write/close, in the same class
  as `read < /proc/uptime` at 0.36 ms, and the runner already performs dozens
  per cycle when `HID_TRACE_RUN=1` — but nobody has timed it. The measurement
  is cheap and needs no game: extend the device-side loop in
  `query-companion.sh latency`, which already times a fork-free baseline.
- **`GRID` inside the ~14 Hz trace loop.** Measured as a standalone exchange,
  never as a sustained load.
- **Whether `screenrecord` on this handset really refuses `--time-limit` above
  180 s.** Asserted in a comment; never re-checked.
- **The cue read's own cost is quoted as both 42 ms and 59 ms** across the
  runner, the actuator and four documents. `actuator.mjs:108-111` states the
  conflict and picks the pessimistic one; nothing else does.
  `ARCHITECTURE-AUDIT.md:286-288` assigns it to `plans/14`. This survey uses
  the p95 figures measured at `V:1267-1269` (`GET` 70.2, `GRID` 68.3) where a
  budget depends on it.

---

## 7. What would let a failed run be replayed rather than re-run

`plans/09:22-25`: *"Make every observation that can change a live action
reproducible offline."* Two things bound what that can mean:

- **RNG and game state are out of scope by policy** (`plans/09:289`). So replay
  is re-running classifiers and the policy over a **recorded sensor tape**,
  never re-simulating the night. The animatronic draws that produced a
  particular death are unrecoverable, and no telemetry proposal changes that.
- **Acceptance is not observable from the emitted stream.** The HID trace is
  authoritative for reports sent to `/system/bin/hid` and carries no acceptance
  label; only the screen says what the game did
  (`OBSERVATION-CORPUS-INVENTORY.md:122-124`).

Given that, what is still missing, specifically:

1. **The per-read observation record.** `plans/09:79-89` enumerates it:
   timestamp and source clock, sensor and model version, requested label set,
   value/score/margin or `UNKNOWN` reason, valid-from/valid-until, controller
   state *before* the read, the decision and deadline it influenced, the action
   result, and a link to the source frame. None of it is written. Today the
   only trace of a classification is a `printf` to a terminal.
2. **The frame itself, for confident reads.** Deleted. Half the replay corpus
   is thrown away at the moment it is produced, and the half that is kept is
   selection-biased by the classifier's own output.
3. **The PCM `startNs` sidecar.** Without it a WAV cannot be placed against the
   video or the runner clock at all.
4. **An alignment edge for the video.** `session_close` declares
   `video_media_pts_s` with, verbatim, *"no mapping to the runner clock has been
   measured, so no alignment edge is claimed for it"*. Honest, and it means the
   recording — the highest-authority artifact — cannot be joined to the pilot's
   own timeline except by eye.
5. **A replay entry point.** `plans/09` package 3 is unstarted. Packages 4-6
   (splits, lifecycle labels, fault replay) likewise. Package 2 is open on one
   item: *"no manifest from a real phone run has been validated yet."*
6. **A holdout report for every model.** All three classifiers are recorded
   `authorized_for=fail-safe` with `calibration_report=null` and
   `holdout_report=null`, and `built_from_commit=unknown` because SCM1 binaries
   are gitignored and carry no provenance. The hash is the only identity they
   have.

Items 1-4 are the ones a night run can close by recording differently. Items
5-6 need work that is not telemetry.

---

## 8. What not to build

- **`dumpsys gfxinfo` / SurfaceFlinger framestats.** It measures the game's
  *render* frames, not the Fusion logic tick, so it does not settle the 30 Hz vs
  60 fps question — and `plans/12:326-331` already names a resolver that does.
  Costs a dump per sample. Drop it.
- **Full-resolution `screenrecord`.** It would make video frames the same sensor
  as the classifier input, which is genuinely tempting. It also puts a second
  heavy consumer on the SurfaceFlinger path, which is exactly what blinded the
  classifier for seven of eight cycles on night 6-23. Drop it.
- **A general telemetry framework.** The v1 manifest and event schema are the
  contract; the gap is that nothing emits into them from the device side. A
  second abstraction would fight `plans/09` for the same files.
- **Audio as a *decision* input for Nights 1-5.** The external bang detector's floor
  (~-12 dB, 52% recall on injected controls) is a bound, not a verdict, and
  `ARCHITECTURE-AUDIT.md:145-153` shows `scan-night.sh` can print a complete
  zero report from zero comparisons. Keep external audio facts observation-only;
  do not let a night's outcome depend on them yet.
- **Human-eye-only formats.** Nothing here needs a chart. `keyframes.py`'s tile
  survives that cut on a technicality — the reader is multimodal — and a
  dashboard does not.

---

## 9. Two defects found while reading

Reported, not fixed.

1. **`SWEEP_LIGHT_LEAD_MS` and `plan_control_xy` are each defined twice** in
   `trial.sh` — `SWEEP_LIGHT_LEAD_MS` at lines **1798 and 1869**,
   `plan_control_xy` at **1847 and 1872**. The second definition wins at
   runtime, and the first `plan_control_xy` lacks the `hall` and `ventl` arms
   the second has, so the live copy is the only one that can execute the
   shipped plan.
   `ARCHITECTURE-AUDIT.md:279-283` already records the constant half — that
   `test-plan-interpreter.sh` reads the *first* copy with `grep -m1` while the
   runtime uses the second. The duplicated function is the same shape and is not
   yet recorded anywhere.
2. **`hid_mark "$actual"` is called with a stale variable in the calibration
   branches.** In `classify_left_and_queue_mask_at`'s callers under
   `BB_LEFT_CAPTURE_EVERY`/`BB_CAM05_CAPTURE_EVERY`, the pattern is
   `now_rel; printf ... "$NOW_REL"; hid_mark "$actual"` — `NOW_REL` is fresh,
   `actual` is whatever a previous function left in the shared global scope. The
   printed line and the trace mark therefore disagree. This is the same
   shared-scope class as the clobber that made the vent light's log line read
   `monitor-verify (contact 0 down)` (`V:846-847`), and it stamps the HID trace
   the auditor reads. It affects the calibration paths only, not the shipped
   `night6-left` route.

---

## 10. The driver log paid for itself in five lines, 2026-08-26

This survey ranked *"persist the driver's stdout and stderr"* first of ten
signals, at 0 ms and ~70 kB a night, on the argument that three separate
failures had been reported by the device owner watching the phone rather than
by any log. It landed the same day. **Its first run produced five lines, and
two of them were previously unknown defects.**

The run is `n1-clock-cycle-20260826` — a bounded one-cycle Night 1 calibration,
the first attempt at verifying the fork-free clock inside a real cycle. Graded,
it is **alive for at least 1.5 s** against an 8.8 s recording; it never reached
a second cycle. The whole log:

```
epoch centred: first match 1787767128564, bracket 308, T0 1060733274
pilot epoch = latch + 175 ms
   429 ms  mute
HUMAN FLOOR: monitor lands 120 ms after the previous press (< 350 ms)
refusing: the pilot may not deliver inhumanly timed inputs (2026-08-25, no override)
```

**Line 1 is a 32-bit wrap, and the log is the only place it was ever visible.**
T0 should be `1787767128564 - 308/2 = 1787767128410`. It printed `1060733274`,
which is exactly that value mod 2^32 — an origin wrong by **20,679 days**.
Android's mksh does signed 32-bit arithmetic and epoch milliseconds are already
~1.8e12, so the centring subtraction wrapped. Nothing else in the run would have
reported this: the manifest records the value, not its plausibility, and no
instrument cross-checks T0 against the wall clock.

**Line 4 is the scalar human floor aborting the plan at its own deliberate
spacing.** 120 ms is not an inhuman press the pilot invented; it is the emitted
plan's compound boundary, the schedule the model gate had already priced and
accepted. The live floor and the gate disagreed, and the floor won.

**The two masked each other, which is the part worth keeping.** The floor abort
is why the wrapped origin never mattered — the run died four lines in, before a
single cycle was timed against a garbage T0. Fix the floor alone and the next
run would have executed a whole night against an origin off by 57 years, with
every `wait_until` computing from it and the log reading like a schedule. That
is the failure mode this repository already has a name for: *one lost input
inverts the rest of the night, and nothing in the run notices.*

Both are fixed (`epoch_sub_ms`/`epoch_diff_ms` keep the value as a string and
calculate on its parts; the gated route's presses are priced by the model gate
rather than the scalar floor, with both arms pinned in
`test-plan-interpreter.sh`). The interpreter test pins **this exact value** —
1787767128564 minus 154 — so the wrap cannot come back unnamed.

**The clock question this run was launched to answer is still open.** It died
before any cycle ran, so "does the fork-free `/proc/uptime` read hold inside a
real cycle, with `hid_mark`, HID writes and the classifier in it?" has been
attempted once and answered zero times. What changed is that both things that
stopped it are now fixed, and the next attempt will leave a log either way.
