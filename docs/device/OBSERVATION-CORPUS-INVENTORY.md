# Stock-device observation corpus inventory

**Inventory date:** 2026-08-26

**Scope:** Plan 09 work package 1 — read-only inventory of existing capture
producers, artifacts, clocks, labels, consumers, retention, and provenance gaps.

## Result

The repository has the pieces of a useful multimodal corpus, but not a corpus
contract yet. Video, raw screencaps, projected grids, PCM, HID reports, epoch
records, cue snapshots, trainer traces, models, and derived reports are produced
independently. A basename sometimes joins them, while other joins depend on a
timestamp printed only to a terminal.

The present local `captures/` tree contains only three files:

| Artifact | Size | What can be established | Corpus verdict |
|---|---:|---|---|
| `gate-test-aborted.mp4` | 1,456,756 bytes | Valid MP4 container, basename suggests an aborted trial; exact producer/configuration cannot be established from the file | Retain as an unmanifested legacy video. It can support manual/post-run inspection but not a reproducible controller replay. |
| `gate-test-epoch.txt` | 158 bytes | Epoch-latch report with the same basename as the video | Pairable by naming convention only. No manifest proves the files came from one invocation or records their commit/configuration. |
| `screencheck/bb-left/models/runtime-gh.scm` | 8,326 bytes | SCM1 classifier used by the current Night 6 route | Operational model artifact, but the source calibration and holdout frames are absent from the current capture tree. It cannot now be rebuilt or independently replayed from local evidence. |

No retained trainer traces, raw calibration/holdout frames, cue WAVs, visual
watch TSVs, HID JSONL traces, cue traces, projection-grid samples, soak reports,
or model reports are present in this checkout. That is not evidence they never
existed; `captures/` is ignored and prior documentation describes data that was
later removed or lives on another machine/session.

[`index-observations.ts`](../../packages/review/bin/legacy/index-observations.ts) reproduces
the filesystem side of this inventory without modifying captures. Its default
report reads paths and sizes only; `--hash` opts into file reads, `--json` emits
structured output, and `--strict` rejects empty or unclassified artifacts. It
classifies an old artifact—it does not invent missing provenance or promote it
to a replayable session.

## Authority classes

| Class | Meaning |
|---|---|
| **Primary observation** | Direct output from the stock device or trainer input stream: video, PCM, raw screen, projected grid, helper snapshot. |
| **Emitted-action record** | What the controller sent or intended, not proof that Fusion accepted it. |
| **Derived evidence** | Classifications, timings, contact sheets, confusion matrices, or reports computed from a primary artifact. Rebuildable only while its input and tool version survive. |
| **Model artifact** | A compiled classifier/signature. It is executable state, not its own calibration or validation evidence. |
| **Operational metadata** | Configuration, clocks, lifecycle, provenance, and joins needed to interpret the other classes. |

The word “authoritative” is always scoped. A screenrecord is authoritative for
what it visibly contains at its encoded resolution, not for raw 2400×1080
classifier pixels. An HID trace is authoritative for reports emitted to
`/system/bin/hid`, not for whether the game acted on them.

## Clock domains

| Clock/domain | Producers | What it can align | Gap |
|---|---|---|---|
| Trainer simulation seconds | Browser trainer trace `t` | Coach grades, holds, simulated events | Not stock-device time. |
| Browser `performance.now()` | Trainer trace event `now` | Raw browser inputs within one page lifetime | Origin is not persisted independently; cannot align to a phone run. |
| Device shell wall/realtime milliseconds | `date +%s%3N` in the runner and cue trace | Runner-relative marks after subtracting `T0`; outer cue samples | Subject to wall-clock semantics and mixed with HID delay time. It is not identified as monotonic in artifacts. |
| HID scheduled milliseconds | `mark`, `delay`, and report records | Intended/emitted contact timeline | `mark` rebases host waits while `delay` advances HID-internal time; contested boundaries have two candidates. |
| Helper `System.nanoTime()` | `snapshotNs`, audio `startNs` | Projection visual snapshots and PCM sample offsets in one consent/process session | `startNs` is printed by `log stop` but is not saved beside the pulled WAV. A helper restart changes the origin relationship. |
| Screenrecord media PTS | MP4 stream | Visual events within one video | No durable mapping to runner/helper clocks is written. HUD/epoch analysis estimates relationships after the fact. |
| Host wall seconds | Cue collection session TSV, filenames, soak `epoch_s` | Coarse collection boundaries and ordering | Insufficient for sub-second cross-modal decisions. |
| Raw screencap | None embedded beyond Android width/height/format header | Pixel coordinates within the frame | No timestamp, game build, device, state, actuator, or label provenance is embedded. |

The v1 schema therefore needs named clock domains and explicit alignment edges;
one field named `timestamp` would incorrectly imply interchangeability.

## Capture-family inventory

### 1. Trainer timing traces

| Property | Inventory |
|---|---|
| Producer | `src/main.js` posts a coached run to `apps/trainer/test/serve.py` `/save-trace`; failed posts queue up to eight bodies in browser `localStorage` |
| Default root/format | `captures/traces/YYYYMMDD-HHMMSS-LESSON[-N].json`; override through `FNAF_TRACE_DIR` |
| Primary content | Coach step rows, holds, raw press/release events, simulation time, `performance.now()`, settings, browser environment, outcome |
| Provenance | Server stamps UTC `savedAt` and short commit plus `+` for dirty; client records lesson, speed, viewport, user agent, webdriver, touch |
| Labels | Simulator/coach truth, not stock-game observation labels |
| Split discipline | `tracereport.ts` excludes webdriver and off-speed runs; no participant/session identifier beyond each file |
| Consumers | `apps/trainer/test/tracereport.ts`, `apps/trainer/test/trace.test.ts`, Plan 04 human-profile work |
| Gaps | No schema file outside validator code; queued traces can be saved in a later browser/server session; no stable human/session/device identity; no link to a stock run |
| Retention | Ignored local JSON; contains user agent and timing behavior, so treat as personal telemetry |

### 2. Full device-run video

| Property | Inventory |
|---|---|
| Producers | `trial.sh`, `trial-maskcamp.sh`, `hid-sweep-probe.sh`; Android `screenrecord` |
| Default root/format | `captures/RUN.mp4`; aborted Minus 7 runs use `captures/RUN-aborted.mp4` |
| Primary content | 1280×576 H.264 visual record; current night recording does not contain helper playback PCM |
| Clock | Media PTS relative to recording start |
| Labels | Night configuration and run status are inferred from invocation/name; post-run tools derive HUD, camera, mask, wind, death, and other state |
| Consumers | `grade-run.sh`, `grade-night.py`, `clocktrace.mjs`, `camtrace.py`, `sweepcheck.py`, `keyframes.py`, `windpct.py`, `grade-minus7.py`, `desync-scan.py`, `find-events.ts`, `death-census.py` |
| Gaps | No manifest records package/build, device/viewport, exact command/environment, commit/dirty state, model hashes, helper session, start clock, or terminal verdict; success and forced-stop completion can both yield a normal filename |
| Retention | Copyrighted game imagery, ignored/local; existing docs advise deleting failed large runs, while promoted evidence will need an explicit selected-run retention policy |

Video is the strongest current post-run authority for “was a night visibly
alive,” but `grade-night.py` only distinguishes HUD-presence intervals and a
coarse end description. It is not yet a positive 6 AM/win classifier.

### 3. Epoch-latch reports

| Property | Inventory |
|---|---|
| Producer | `trial.sh` when `DEVICE_EPOCH_LATCH=1` |
| Path/format | `captures/RUN-epoch.txt`, one key/value line |
| Content | `epoch_ms`, prior clear edge, bracket, confirmation time/delay, attempts, detector name |
| Clock | Device shell millisecond clock used by the runner |
| Consumer | Human inspection; the runner consumes the remote value before pull; `clocktrace.mjs` independently checks the video hour edge |
| Gaps | Joined to video only by basename; no model hash, device/build, confidence contract, or mapping to video/helper time |
| Authority | Derived operational metadata, not a frame or terminal result |

### 4. HID input traces and probe streams

| Property | Inventory |
|---|---|
| Producers | `HID_TRACE_RUN=1 trial.sh`; `hid-sweep-probe.ts`/`.sh` |
| Paths/formats | `captures/RUN-hid.jsonl` for emitted marks/delays/reports; `captures/OUT.hid` for a generated probe stream |
| Content | Exact HID reports and delay commands; runner marks at action boundaries |
| Clock | Mixed/rebased scheduled milliseconds described in the clock table |
| Consumers | `test-hid-trace.ts`, `desync-scan.py`, probe/device HID executable |
| Labels | Action intent and geometry; no acceptance label |
| Gaps | Optional and therefore absent from many run bundles; no plan/config hash; JSONL has no header/session metadata; a probe `.hid` is an input artifact, not observed output |
| Authority | Authoritative emitted-action record. Video or a state sensor must establish acceptance. |

### 5. Continuous Companion scalar trace

| Property | Inventory |
|---|---|
| Producer | `CUE_HELPER=1 trial.sh`, device-side loopback `GET` at roughly 14 Hz |
| Path/format | `captures/RUN-cue.txt`, lines containing outer `date +%s%3N` and the helper response |
| Content | Helper `snapshotNs`, visual sequence/age/luma/`cam05_mean_luma` aggregate, external-audio authority state, observed/unknown state |
| Consumers | Manual/device diagnosis; not currently parsed by `grade-run.sh` beyond presence |
| Labels | Sensor observations only. Scalar RMS/peak cannot label transient audio. |
| Gaps | No schema/header, helper PID/session/model/build, dropped-read count, or durable mapping to video/HID; first timestamp and inner monotonic timestamp use different domains |
| Retention | Ignored text. It should never contain the helper token; producer output currently records responses, not requests. |

### 6. Companion PCM windows and night logs

| Property | Inventory |
|---|---|
| Producers | `collect-cue-audio.sh`, `watch-vent-cue.sh`, and external receiver captures/facts; the APK no longer produces PCM |
| Root/format | `captures/cue-helper/calibration/LABEL-cue-WALLTIME-pPRE-qPOST.wav`; mono 16-bit WAV at the helper's capture rate |
| Primary content | External receiver's rendered mix. The current BlueALSA/A2DP path includes the full output mix; an ESP32 adapter must use its own transport calibration. Legacy Android playback-capture artifacts are historical and not interchangeable. |
| Clock | PCM sample offset plus helper monotonic `startNs` for continuous logs; filename uses wall time |
| Consumers | `packages/propose/parked/minus7/cue/detect.py`, `evaluate.py`, `scan-night.sh`, `label-misses.py`, `grade-run.sh` |
| Labels | Filename label is operator/collection intent; true bang labels require an independent visual arrival stream |
| Split discipline | `collect-cue-audio.sh` writes a sessions TSV to preserve round boundaries; detector plan requires complete-session splits |
| Critical gap | External authority fact streams carry sender timestamps and sequence numbers, but a trial does not yet persist a joined audio-fact/visual timeline. A future bridge must preserve the authority clock domain and reject stale or missing facts rather than infer audio state from the visual APK snapshot. |
| Retention | Copyrighted game audio, ignored/local; raw PCM must not be committed or uploaded |

### 7. Visual watch, collection-boundary, and soak TSVs

| Artifact | Producer | Content/clock | Consumer and gap |
|---|---|---|---|
| `LABEL-visual.tsv` | `watch-vent-cue.sh` via `query-companion.sh watch` | `snapshot_ns`, visual seq, luma, observed state; helper monotonic | `label-misses.py`; independently labels bright→dark transitions, but only if the matching audio `startNs` survived |
| `LABEL-sessions.tsv` | `collect-cue-audio.sh` | round/start/night/end/state in host seconds relative to collection start | Intended session split; too coarse for event alignment and not cryptographically joined to its WAV |
| `captures/cue-helper/soak-*.tsv` | `soak-companion.sh` | host elapsed/epoch, helper PID, memory, thermal, status age, visual/audio counters | Health/latency evidence; not gameplay labels, no session manifest/model hash |

These are operational metadata and label channels, not interchangeable TSV
schemas.

### 8. Raw `screencap` visual frames

| Family | Producer/path | Label source | Consumers | Gaps |
|---|---|---|---|---|
| Deliberate labeled sample | `capture-screen-sample.sh` → `captures/screencheck/VIEW/LABEL/NAME.raw` | Operator chooses view/label and optional held control | SCM1 builder/replay | No timestamp, session, device/build, coordinate/calibration, hold timing, or independent label evidence sidecar |
| In-run calibration sample | `trial.sh` → `captures/screencheck/VIEW/BUCKET/RUN/cycle-NNN.raw` | Bucket and run configuration; may be `unlabeled` | SCM1 builder/replay, manual inspection | Capture time appears in runner stdout/HID mark, not beside frame; filename has cycle only |
| Rare/non-empty classifier frame | `trial.sh` → `captures/screencheck-keep/RUN/ELAPSED-CLASS.raw` | Existing classifier result in filename | Manual labeling, SCM1/grid-signature research | This is selection-biased and classifier-derived, not ground truth; elapsed value lacks explicit clock domain |
| Temporary live read | On-device PID paths | None retained unless non-empty/debug/calibration mode | Live `screencheck` | Normal confident-empty frames are deleted, preventing an unbiased live-distribution replay |

Raw Android files contain a 16-byte dimensions/format header followed by RGBA
pixels. A frame extracted from 1280×576 H.264 video is not equivalent to these
2400×1080 raw inputs.

### 9. Projection `GRID` observations and signatures

| Property | Inventory |
|---|---|
| Producer | `query-companion.sh grid [OUT.png]` for one 20×9 projected frame; direct `GRID` response lines may be redirected manually |
| Format | Control response with sequence plus 180 RGB cells; optional nearest-neighbor PNG visualization |
| Clock | Response includes sequence in the grid line, but the current `GRID` response/parser does not persist `snapshotNs` in the saved representation |
| Consumers | Manual inspection; `grid-signature.py` can build/test/match signatures from captured GRID lines |
| Labels | Supplied through `LABEL=PATH`; a screencap-derived grid signature is explicitly provisional because Android's VirtualDisplay scaler differs |
| Gaps | No canonical capture command/layout for labeled multi-frame GRID sessions, session/clock/model provenance, calibration/holdout root, or committed signature schema |
| Retention | GRID/PNG contains downsampled copyrighted game imagery and remains ignored/local |

### 10. Visual models and signatures

| Artifact | Producer | Evidence encoded | Missing evidence |
|---|---|---|---|
| SCM1 binary | `build-screen-model.py` | Geometry, ROI/grid/step, thresholds, class templates/labels | Source paths/hashes, build commit/device/game build, calibration report, holdout report, model creation time |
| Grid-signature JSON | `grid-signature.py build` | Grid, source kind, provisional flag, thresholds, class means/counts | Source artifact hashes/session split and independent holdout unless separately retained |

`replay-screen-model.py` prints a confusion matrix and fails on any holdout
misclassification, but its report is terminal output only. The model file is
therefore not proof that replay occurred. The current `runtime-gh.scm` is the
only retained model and has no retained local source corpus.

### 11. Derived video and detector evidence

| Output | Producer | Default retention | Rebuild boundary |
|---|---|---|---|
| `RUN-keyframes.png` | `keyframes.py`, invoked by `grade-run.sh` | Alongside video | Rebuildable from video plus tool version/options |
| `deaths-N.png` | `death-census.py OUT_DIR` | Caller-chosen directory | Rebuildable only while the selected source videos remain |
| Survival/clock/camera/sweep/wind/office/desync/event reports | Recorded-trial analyzers | Console only unless caller redirects | Not durable; exact options and tool commit disappear |
| Screen-model confusion/calibration reports | Builder/replay | Console only | Not durable; model alone does not carry them |
| Cue detection/evaluation/miss reports | Cue tools | Console and temporary denoised WAV | Not durable; reference hashes/options/session selection must be reconstructed manually |

Derived media remains copyrighted when it contains game frames. Aggregate text
reports can be committed when they record input hashes, command/options, and
tool commit.

## Producer-to-consumer join map

```text
trainer input → trace JSON → tracereport → inferred human profile replacement

device run ─┬→ MP4 ───────→ survival/clock/camera/light/wind/state graders
            ├→ HID JSONL ─→ HID audit ─┐
            │                          ├→ desync comparison (video + HID)
            ├→ epoch TXT ──────────────┘  [basename join only today]
            ├→ cue TXT ───→ scalar diagnosis
            ├→ PCM WAV ───→ cue detector/evaluator
            └→ raw frames ─→ SCM1/grid model build and replay

helper watch TSV + PCM startNs + WAV → visually labeled cue miss report
                                      [startNs sidecar missing today]

raw calibration frames → SCM1 binary → live screencheck
raw holdout frames + SCM1 → confusion report [report not retained today]
```

## Label provenance and split status

| Label source | Strength | Current risk |
|---|---|---|
| Simulator/coach state | Exact for the trainer model | Must not be presented as stock-game truth |
| Visible stock frame/video | Direct visual evidence at that sensor's resolution | Manual interpretation or heuristic classifier may still be wrong; frame needs time/session provenance |
| Independent visual cue for audio | Best current bang-label design | Requires same-helper monotonic alignment, whose audio anchor is not durably saved |
| Directory/filename chosen by operator | Collection intent | Not independent truth; can be mislabeled or copied between sessions |
| Existing classifier output in filename | Useful discovery queue | Circular if reused as calibration/holdout truth without manual or independent relabeling |
| Game-source timing/mechanism | Strong expectation/constraint | Does not prove a particular stochastic event occurred in a recorded run |

SCM1 tools support separate input paths and the docs require calibration versus
holdout, but no session ID prevents frames from one run entering both. Cue
collection has explicit round boundaries, yet the current local corpus is absent
and the WAV-to-session/visual joins are not self-describing. Trainer traces
exclude bots/off-speed runs but have no participant/session grouping.

## Retention and safety boundary

- `captures/` is ignored by [`.gitignore`](../../.gitignore); raw commercial-game
  video, screenshots, audio, and derived contact sheets stay local.
- SCM1/grid models also stay ignored because they embed features derived from
  game frames and currently lack reproducible provenance.
- Commit only schemas, synthetic fixtures, collection/replay code, hashes,
  aggregate reports, and non-copyright diagnostics.
- Never store Companion session tokens, webhook/account credentials, device
  serials, or absolute private paths in a manifest intended for commit.
- Event dumps, APK/CCN files, and extracted reference samples belong to the
  source-dump boundary outside the repository. They are detector references,
  not stock-device observation sessions, and are excluded from this corpus.
- Browser smoke screenshots under `/tmp`, generated `dist/`, and simulator-only
  console reports are scratch/build outputs unless a later plan explicitly
  promotes a non-copyright aggregate artifact.

## Fields demanded of the v1 schemas

This inventory does not design the schema, but it establishes the minimum facts
the next work package must represent:

1. session/run ID and parent collection/cohort ID;
2. artifact role and authority class;
3. producer command/tool version, repository commit, and dirty status;
4. game package/version/build, night/configuration, device/viewport/sensor path;
5. artifact path, media/record format, size, hash, completeness, and retention;
6. named clock domain, origin, units, validity interval, and explicit alignment
   edges to other clocks;
7. label/value, who or what supplied it, confidence/unknown reason, and whether
   it is calibration, holdout, shadow, or live-decision data;
8. model/signature hash and the calibration/holdout reports authorizing it;
9. controller/policy/plan/actuator configuration and emitted-action trace;
10. lifecycle/terminal outcome and the independent evidence supporting it;
11. helper/projection process identity and restart/revocation/focus faults;
12. redaction/sensitivity flags and raw-media git prohibition.

## Package-1 conclusion

Every current producer and retained capture family is accounted for above. The
three files actually present are either an unmanifested legacy run pair or an
operational model without its local evidence corpus. None is silently treated
as a replayable session. The tested read-only index gives future inventories the
same classification and explicitly marks anything new it cannot explain.

The next step is Plan 09 package 2: introduce versioned session-manifest and
event schemas, a standard-library validator, and synthetic valid/invalid
fixtures covering the clock and provenance failures identified here. Producer
integration comes after that contract passes.
