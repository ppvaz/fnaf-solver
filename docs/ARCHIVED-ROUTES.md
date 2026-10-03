# Archived routes and removed tools

Code that left the tree because nothing ran it, and the one place that says
where it went. Everything below is still in git: the tag
**`archive/2026-09-24`** points at `069495f`, the last commit that carries all
of it. Restore any path with

```sh
git checkout archive/2026-09-24 -- <path>
```

The findings these routes produced stay where they were written — the linked
pages are evidence and understanding, and archiving the code does not retract
them. A route listed here is **parked, not refuted**, unless its row says so.

## Archived routes (2026-09-24)

| Route | Paths | Last commit before archive | Where its results live |
|---|---|---|---|
| In-engine recompile (Plan 17, route 5): owned CCN → Chowdren → arm64 research APK. **Restored 2026-09-27** for ROADMAP S2b (desktop, deterministic harness): see [`../packages/source/recompile/README.md`](../packages/source/recompile/README.md) | `tools/recompile/` (build-296 `mmfparser` patch, Chowdren config, two probes, Android CMake draft) | 2026-08-28 | [`in-engine/IN-ENGINE-PILOT-RECOMPILE.md`](in-engine/IN-ENGINE-PILOT-RECOMPILE.md), Plan 17 |
| ESP32 audio bridge: A2DP sink on an ESP32-WROOM-32 forwarding PCM to the APK over Wi-Fi | `firmware/esp32-audio-consumer/`, `tools/cue/esp32-audio-authority.py`, `tools/cue/test-esp32-audio-authority.py`, `tools/cue/pack-esp32-cues.py` | 2026-08-31 | [`device/ANDROID-AUDIO-CAPTURE.md`](device/ANDROID-AUDIO-CAPTURE.md), [`device/AUDIO-WITNESS-MAP.md`](device/AUDIO-WITNESS-MAP.md), Plan 08 |
| Custom Night invention engine (Plans 05 and 21): rule-list policy language, genetic search, ablation and anatomy reports | `tools/invent/` | 2026-09-02 | Plan 05, Plan 21, [`../plans/PROGRESS.md`](../plans/PROGRESS.md) |
| HUD-signature down/mask/up probe (parked 2026-09-01) | `research/sandbox/hud-signature-probe.py`, `research/sandbox/hud-signature-n1-minustoys-calib-01.json` | 2026-09-01 | [The research sandbox](#the-research-sandbox-2026-09-29-adr-0002), below (its notes left `research/sandbox/README.md` when the directory retired) |

The ESP32 route superseded: rendered audio now reaches the host over A2DP
directly (`packages/play/bin/audio/bt-audio-link.sh`, `packages/play/bin/audio/bt-audio-collector.py`).
The Companion APK kept its ESP32 receiver path and the `pcm-udp-v1` wire
contract until **2026-09-27** (Companion 0.2.0), when both left with the rest
of the APK's audio stack: the UDP health/PCM listeners and Wi-Fi request, the
authenticated audio-fact port 49708, the phone-side `AudioAnalyzer`,
`CueDetector` and `PhaseClock`, the PCM monitor/recorder and the Bluetooth
receiver card. The host tools that only fed that stack went with it:
`tools/cue/bridge-audio-authority.py` (facts into port 49708) and
`tools/device/provision-cue-model.sh` (a model into the APK's storage), with
their tests. Nothing else read them: the working audio path is the phone's
A2DP mix recorded on the host (`packages/play/bin/audio/bt-audio-link.sh`,
`packages/play/bin/audio/capture-bt-audio.sh`, `packages/play/bin/audio/fnaf4-cues.py`), which never
enters the APK.

## Removed tools (2026-09-24)

Search and report scripts with no caller, no test and no npm script. Their
searches were already closed.

| Tool | What it did | Closed by |
|---|---|---|
| `tools/gatesearch.mjs`, `tools/gatebot.mjs` | Gate-aware visible-state policy search | Plan 06, no survivor — [`strategy/GATE-SEARCH.md`](strategy/GATE-SEARCH.md) |
| `tools/strategysearch.mjs` | Fixed camera-cover strategy enumeration | [`strategy/CAM-6-7-STRATEGY.md`](strategy/CAM-6-7-STRATEGY.md) |
| `tools/knobsweep.mjs` | `NightPolicy` knob factorial over a held-out cohort | Plan 20; `packages/propose/bin/nightloop.ts` remains |

## Closed device probes (2026-09-24, second pass)

Nineteen tools and their eight no-device tests, chosen by a reference graph
over every tracked file plus three weeks of agent command history: nothing
that runs calls them, none ran after 2026-09-15, and each one's question is
closed, with the answer already held by a constant, a gate or a page. The same
tag carries them unchanged (`git checkout archive/2026-09-24 -- <path>`).

| Tools | What they measured | Where the answer lives now |
|---|---|---|
| `hid-maskraise-probe.mjs`, `hid-monitorraise-probe.mjs`, `hid-raise-probe.mjs`, `hid-transition-probe.mjs`, `hid-sweep-probe.sh`, `maskraise-grade.py`, `monitorraise-watch.py`, `calibration-stability.py`, `frame-clock.py` | Mask/monitor seam windows, camera sweep spacing, animation transitions | [`device/HID-MULTITOUCH.md`](device/HID-MULTITOUCH.md) ("the phone accepts 120 ms spacing"); the floors in `packages/propose/bin/plans/artifact-commands.ts` and `actuator.mjs`'s `SEAM_BANDS`, held by `test-seam-slack.ts` |
| `pan-probe.sh`, `pan-path-capture.py`, `pan-path-capture.sh`, `region-probe.sh`, `region-classify.py` | Office pan and what a touch does per screen region | `pan-shift.py` stays as the measuring stick; the scroll is read from the dump |
| `grid-signature.py` | Frame signatures for a live check | Superseded by the fitted `*-calibrate.py` rules (`monitor-rule-v1`, `camera-rule-v1`) the executor reads |
| `night5-modal-observer.mjs` | Dual-modality sampling on Night 5 | [`evidence/night5-monitor-raise-loss-20260909.json`](evidence/night5-monitor-raise-loss-20260909.json); Night 5 is won |
| `watch-vent-cue.sh` | Balloon Boy at the vent, by the helper's audio | The A2DP capture and `tickphase.py` ([`device/AUDIO-WITNESS-MAP.md`](device/AUDIO-WITNESS-MAP.md)) |
| `touch-contamination-guard.sh` | Physical touches during a run | Never wired into `night-run.sh`; a guard nothing calls guards nothing |
| `seed-clock.mjs` | Host/phone wall-clock samples for seed recovery | Superseded by `seedpin/` and `office-seed-bracket.ts`; [`device/RNG-SEED-RECOVERY.md`](device/RNG-SEED-RECOVERY.md) |

`hid-sweep-probe.ts` stays: despite its name it is the `COORDS`/`toRaw`
library the live intersection gate and `test-screen-map.ts` import.
`gate-worker.ts` and `minus-toys-jitter.ts` stay too — the `night matrix`
and `vent reactive` checks load them.

## The legacy `trial.sh` lane (2026-09-25, Plan 22 P9)

The open-loop shell runner that played the Minus 7-era nights: a host script
that piped a mksh driver to the phone. Deprecated on 2026-09-02, behind
`FNAF2_LEGACY_TRIAL=1` since, with no invocation in agent history from
2026-09-03 to 2026-09-25. Plan 22's P5 closed on 2026-09-14 with the campaign
executor qualified, and `night-run.sh` has driven every night since, Nights 5-7
included. Every file below is unchanged at the same tag
(`git checkout archive/2026-09-24 -- <path>`).

| Paths | What it was |
|---|---|
| `tools/device/legacy-trial.sh`, `tools/device/trial/` (12 driver parts and `assemble.sh`) | The runner and the program it sent to the phone |
| `tools/device/trial-maskcamp.sh`, `tools/device/run-batch.sh` | The mask-camp experiment runner and its batch launcher |
| `tools/device/preflight.sh` | The shell preflight that printed a `trial.sh` invocation |
| `tools/cue/pilot-supervisor.py` | The external audio authority's supervisor, hard-wired to that runner |
| `tools/device/cam11lit.py` and its four crop fixtures | The runner's screencap CAM 11 arm verifier |
| `tools/device/drifttrace.mjs`, `tools/device/desync-scan.py`, `tools/device/elegance.py` | Graders of that runner's own artifacts: its HID trace against the plan and the video, and its driver log |

With them went their tests (`test-runner-plan`, `test-plan-interpreter`,
`test-trial-assembly`, `test-hid-walltime`, `test-human-floor`,
`test-cue-trace-loop`, `test-screenrecord-capability`, `test-trial-reactive`,
`test-preflight`, `test-pilot-supervisor`, `test-drifttrace`, `test-elegance`,
`test-cam11lit`). Tests of shared modules kept their module half:
`test-human-gate.ts` still gates `human-gate.ts`, `test-session-manifest.sh`
now reads `collect-cue-audio.sh` as the producer, `policyartifacttest.ts` keeps
the artifact checks.

`grade-run.sh` lost the channels only that runner produced -- the HID trace,
session manifest, driver log, cue trace, receiver PCM and external-authority
facts -- and graded a retained night (`night6-n6-bbfix-20260920T010859Z`) to the
same output in every live instrument before and after. `scan-night.sh` and
`validate-session.py` stay, run by hand and by the session producers.

**What a restore would be for.** Minus 7's "heard" Balloon Boy -- the live
audio cue (`CUE_HELPER=1`, `CUE_SHADOW`, `REACTIVE=observe`) -- was wired into
this runner only; the campaign executor has no audio port. If Minus 7 comes back
as a device bot that listens, restore the runner from the tag or give the
executor an audio port.

## The fixture service path and the artifact lane (2026-09-25, Plan 22 P9)

The composition Plan 22 designed first: `DeviceControlService` over the
`packages/runtime` scheduler and safety supervisor, composed by
`composeDevice`, `composeModernDevice` and the seam-calibration fixture, and
reached by `npm run device:dry-run`, `device:run`/`device:qualification` and
`device:calibrate`. It never played a night -- `device:run` threw "live
transport is not composed by this CLI" -- while CI's device lane exercised it
and the campaign executor, which won Nights 5-7, went untested there. The
artifact lane (`trial.sh` → `artifact-runner.mjs`) was the same kind of second
path: its live branch needed an executor module nobody had written. Restore any
of it from the last commit that carried it:
`git checkout 7854394 -- <path>`.

| Paths | What it was |
|---|---|
| `packages/runtime/` | Fixture temporal dispatcher (`trajectory-v1`), safety supervisor (`supervisor-v1`) and the retained-run validators |
| `apps/device/src/service.js`, `composition.js`, `modern-composition.js`, `calibration-fixture.js`, `live-seam-composition.js`, `seam-calibration.js`, `index.ts`, `apps/device/fixtures/seam-calibration.json` | The service, its composition roots, the seam calibration workflow (`seam-actuator-qualification-v1`) and the package barrel |
| `createActuatorMcp` in `apps/device/src/mcp.js` | The MCP surface over the service; the Companion MCP beside it stays |
| `tools/device/trial.sh`, `tools/device/artifact-runner.mjs` | The artifact lane's launcher and runner |

What moved rather than left: `validateQualification`, `validateTelemetry` and
`validateManifest` now live in `core/contracts` (the campaign preflight and the
evidence index read them); the executor-request boundary `test-bundle.ts`
checked through the artifact runner is checked on `makeExecutorRequest`
directly. CI's device lane is now a campaign dry run over the committed Night 7
winner, and `test-winners-rebuild.ts` compiles every committed winner.

## The adapter hexagon and screencheck (2026-09-25, the same retirement's second half)

With the service gone, nothing that plays a night used the ports-and-adapters
layer it was built on: the capability registry (`packages/adapters/src/registry.js`,
`device:bench`, the generated `adapter-registry.json`), the actuator and sensor
classes (`actuators.js`, `sensors.js`), the core `Actuator`, `Sensor` and
`Detector` ports (`packages/core/src/actuation/`, `sensing/ports.js`), the
on-device `screencheck` classifier (`packages/screencheck`, its build, model,
replay and benchmark tools, `capture-screen-sample.sh`) and the `adb-screencap`
profile. Seven contracts whose only producers were these are retired:
`raw-sample-v1`, `measurement-v1`, `detector-v1`, `actuator-v1`,
`capability-v1`, `calibration-v1`, `screencheck-process-v1`. Restore from
`6d78c7e`: `git checkout 6d78c7e -- <path>`.

What the campaign does use stays: the HID and Companion transports, clocks,
night onset, the monitor/mask/camera and calibration-state rules, control
exclusion, button strokes, the control anchor, and the `fixture-hid-screencap`
profile the bundle tests compile against.

## Unwired trainer modules (2026-09-25)

Three Plan 24 modules the trainer never reached: `apps/trainer/src/adaptive-coach.js`
(the adaptive skill model and selector), `rhythm-highway.js` and
`threat-constellation.js` (two Arcade Lab renderers). The page's build bundled
none of them -- the UI renders only the `campaign` surface -- and only their own
tests imported them. Their contracts `adaptive-skill-model-v1`,
`adaptive-selection-v1`, `rhythm-highway-chart-v1` and
`threat-constellation-layout-v1` are retired with them. Plan 24 stays open; its
next step was already "close one package outright rather than widening the
foundation". Restore with `git checkout 903ffab -- <path>`.

## The machine executor (2026-09-25)

`AdbDeviceLocalMachineExecutor`, the compatibility executor that pushed an
assembled device program, a plan, a checker and a model to the phone and ran
them there, and its `runAdbProgram`. Its only composition root was the fixture
service path retired above; after that nothing constructed it, not even a test.
The artifact executor it sat beside is the one the campaign runs. It left when
the executor was split into `hid-schedule.js`, `device-shell.js` and
`control-effect.js`. Restore with
`git show 18684d8:apps/device/src/adb-device-local-executor.js`.

## The research sandbox (2026-09-29, ADR 0002)

`research/sandbox/` was Plan 22 principle 8's "permissive edge": probes that
production could not import. ADR 0002 drops that principle for its own
principle 7 -- no sandbox; claim-bearing cohorts and censuses are
pre-registered, and diagnostic sweeps name the explanation they test -- and the
directory retired in migration M5b. It held one file, the notes of the
HUD-signature probe archived on 2026-09-24 (row above); nothing imported it.
Restore the notes with `git show 861eac9:research/sandbox/README.md`, and the
probe itself from the `archive/2026-09-24` tag. The notes, as they stood:

### HUD-signature down/mask/up rule (parked 2026-09-01, archived 2026-09-24)

`hud-signature-probe.py` (self-test green) fitted the HUD-chrome hypothesis on
`captures/n1-minustoys-calib-01-aborted.mp4`; retained report:
`hud-signature-n1-minustoys-calib-01.json`. One night-1 story run, 90/90
corpus reads: mask uniquely zeroes the clock cell 1 (180,60), right-button
cell 174 (1740,1020) and chrome cell 172 (1500,1020) — margins 172–221;
bottom chrome cell 167 (900,1020) reads identically in down and mask
(175–182) and only dies when the monitor is up; grid luma down 27 / mask
4–6 / up 32–48; anim refuses 32/40, 8 firm votes unaudited. No evidence ID —
sandbox probes do not mint one; the report file is the observation.

It was not promotable as measured: the recording is an upscaled 1280x576 transcode
(a different sensor than the helper's native 2400x1080 grid), labels come
from grade-minus7, and the reads are in-sample. Open before any Plan 12
promotion:

1. Native re-fit of signature B ({down,up}|{mask}) on the 42-frame labelled
   corpus — frames live on Pedro's other machine. Copy them here as
   `down=… up=… mask=…` sources and extend `packages/play/bin/calibrate/monitor-calibrate.py`
   for the second signature; zero device cost.
2. Blackout frames — the mask-vs-blackout discriminator (left button present
   + luma band) has never seen a blackout; `blackout-unproven` stands.
3. Pressed-button and full-night frames (battery drain, clock hour changes).
4. Anim-vote audit against HID press timing (desync-scan alignment).
5. Held-out evaluation, then the schema decision: `monitor-rule-v2` with
   per-signature anchor sets vs a separate `maskOn` fact (core owns the fact
   vocabulary; Plan 12 owns promotion).

To re-run the probe, restore it from the archive tag first; it then takes
`python3 research/sandbox/hud-signature-probe.py captures/<run>.mp4 --out
<report>.json`, or `--self-test` for the logic only.

## The cue shadow tools and an unread grid rule (2026-09-30, ADR 0002 layout)

The final layout retires what nothing reads. Restore any of these with
`git checkout eebe1416 -- <path>`.

| Paths | Why it left |
|---|---|
| `tools/cue/build-shadow-windows.py`, `tools/cue/evaluate-shadow.py`, `tools/cue/export-model.py` and their three tests | They joined, evaluated and exported the on-phone cue detector's shadow corpus. Its `CUE_SHADOW` traces came from the archived `trial.sh` lane, and the detector left the Companion with its audio stack in 0.2.0 (2026-09-27). Their only callers were their own tests, which ran in the legacy ENGINE group alone. |
| `models/screen-rule-moto-g56-v207.json` | A grid-fitted `screen-rule-v1` that nothing reads. Its producer, `packages/play/bin/calibrate/screen-calibrate.py`, stays with the other grid calibrators until FNaF 2's pipeline is converted to native regions. |

The architecture review also listed `packages/play/src/sensors/screencap/intro_card.py` for
retirement as having no runtime caller. It has one: `lifecycle-observe.py`
imports it to label the story-night intro card (`state=intro`), which every
FNaF 2 night run reads. It stays.

## Kept on purpose

Minus 7 is **not** archived: Pedro means to bring it back as a second
device-bot strategy (2026-09-24). `tools/minus7/`, `tools/model/`,
`packages/propose/parked/minus7/cyclesearch.ts`, `packages/propose/parked/minus7/constrainedsearch.ts`, `packages/propose/parked/minus7/flicksweep.ts`
and `packages/propose/parked/minus7/phase-tolerance.ts` stay, and the engine checks the current model
fails on it are named in `BACKLOG` in [`../tools/test.ts`](../tools/test.ts)
as the recovery list.
