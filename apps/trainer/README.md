# `@sixam/trainer`

The trainer is the public browser application under the Understanding layer.
It owns UI, touch input, audio, assets, curriculum, coaching, and trainer
traces. It does not own sourced mechanics, device profiles, policy authority,
or live actuation; those come from `@sixam/source`, `@sixam/kernel` and explicit device
services. Its replayable exercise and activity-gate records (`exercise-v1`,
`activity-gate-v1` and their siblings) live in `src/training/`
(`@sixam/trainer/training`), which moved here from `@sixam/core/training` in ADR
0002's Play move; `test/exercise.test.mjs` and `test/activity-gate.test.mjs` test
them. The static HTML entry remains at the repository root for publishing,
while its browser modules live under this application.

Public API: the browser entry, `Coach`, and the DOM-free replay microtrainer
factory from `src/index.js`. The microtrainer builds prediction and timing
exercises from retained snapshots plus independently evidenced future facts;
recognition requires retained profile-bound crops and an `UNKNOWN` choice; and
strategy cases require visible exact-simulator `MODEL_ONLY` provenance. Its
`microtrainer-session-v1` records retain prompt, commitment, resolution,
latency, scheduler, source-fact, artifact, and split metadata without raw
media. Censored or unresolved exercises never receive a correctness score.
The adaptive skill model is an isolated per-player/profile consumer of those
records: it reports denominators and Wilson uncertainty, excludes holdout data
from training, and records capped selection probabilities; it cannot affect
game belief, safety, or device policy.
The renderer boundary also exposes campaign, Rhythm Highway, and Threat
Constellation descriptors with shared semantic grading and accessibility
capabilities. The shipped menu includes a clearly labelled offline
`FIXTURE / PRACTICE` Arcade Lab drawer with prediction answer flow and local
progress export/reset; retained/live corpus joins and the rhythm/spatial pilots
remain separate follow-up work.
The Rhythm Highway chart boundary also reuses canonical routine windows,
refuses dense-lane collisions, and keeps prediction outcomes out of chart data;
its real canvas and player qualification are still separate pilot work.
The Threat Constellation boundary similarly fixes profile-relative semantic
anchors and touch-target geometry, with explicit tap/hold/slider records and
non-pointer alternatives; the retained-corpus hit-circle pilot is not implied.
Dependency: core only. Commands: root `build:trainer`, `serve:trainer`, and
`test:trainer`. Artifacts: the ignored single-file trainer bundle and optional
trace captures. This app does not own the canonical model, device execution,
or claim promotion.

## Tests and tools

Everything here lives in `apps/trainer/test/`. The npm script names are the
stable interface; the paths are where the files live now (they were in `tools/`
until 2026-09-30).

| Tool | Kind | Purpose and interface |
|---|---|---|
| `build.py` | build | `npm run build:trainer`. Inlines the imported JS modules, CSS, and fonts into ignored `dist/index.html`. Source works without this build during development. |
| `serve.py [port]` | dev server | `npm run serve:trainer`. Serves the repo on 127.0.0.1 only, defaulting to port 8731; a phone reaches it over USB with `adb reverse tcp:8731 tcp:8731` and `http://localhost:8731`, never over the network (until 2026-09-29 it bound 0.0.0.0, so anyone on the LAN could rewrite the core config). `POST /save-layout` validates a calibrated layout, rewrites `packages/source/src/games/fnaf2/config.js`, and rebuilds, so that endpoint is intentionally mutating. Every POST is refused with 403 unless its client is loopback, its Host names this machine and any Origin is the page's own (`write_refusal`), so a web page open in the host's browser cannot write either. `POST /save-trace` records a trainer run's per-step timing census under ignored `captures/traces/`, stamped with save time and commit (`FNAF_TRACE_DIR` overrides the directory for tests). |
| `serve_test.py` | check | Pins that `serve.py` writes for this machine only: the socket binds 127.0.0.1, a loopback client with its own Host and Origin (or none) writes, and a page on another origin, a DNS-rebound Host or an off-host client is refused with 403 and writes nothing; no answer carries `Access-Control-Allow-Origin`. Dry runs and a temporary `FNAF_TRACE_DIR` only. `test:unit`. |
| `exercise.test.mjs` | check | Phone-free Plan 24 package 1 contract: freezes exercise questions, replays ordered commitments and independent resolutions, and censors cancelled, expired, or unresolved outcomes. It does not score a player or render a live prompt. `test:contracts`. |
| `activity-gate.test.mjs` | check | Phone-free Plan 24 package 2 contract: admits only qualified fresh quiet windows, retains refusal reasons, and proves increasing risk/latency cannot weaken the gate or outrank a critical cue. `test:contracts`. |
| `microtrainer.test.mjs` | check | Phone-free Plan 24 package 3 contract: retained prediction/timing sources, profile-bound recognition with `UNKNOWN`, exact-simulator `MODEL_ONLY` strategy provenance, censoring, latency/scheduler/session joins, and deterministic replay. `test:contracts`. |
| `renderer.test.mjs` | check | Phone-free Plan 24 Arcade Lab renderer contract: campaign/rhythm/spatial frozen views, accessibility capabilities, raw-media exclusion, shared attempts, and presentation-invariant semantic grading. `test:contracts`. |
| `arcade-lab.test.mjs` | check | Phone-free Plan 24 Arcade Lab progression contract: deterministic seeded sets, local personal-best counters, neutral censored outcomes, reset, export, and no cross-player state. `test:contracts`. |
| `trace.test.mjs` | check | Gates the trainer's per-step trace: the Coach's census rows against scripted lateness, `tracereport.mjs` banding math, and `serve.py`'s `/save-trace` against a temporary directory. No browser or phone. `tools/test.mjs --engine` (`trainer trace`). |
| `tracereport.mjs [dir]` | report | Bands the recorded trainer traces per step: lateness quantiles, wind-hold coverage, inter-press spacing, and provenance. Excludes webdriver and off-speed runs from the census. The measured replacement for plans/04's `[INFERRED]` human profile, once enough runs accumulate. `tools/test.mjs --reports`. |
| `browser.test.mjs [url] [screenshot]` | check | Browser group (`browsertest`). General load/input smoke check; writes `/tmp/m7-report.png` by default. |
| `calibration.test.mjs [url]` | check | Browser group (`caltest`). Exercises drag-versus-press and layout saving. It snapshots and restores `packages/source/src/games/fnaf2/config.js` because saving is a real write. |
| `lesson.test.mjs [url]` | check | Browser group (`lessontest`). Drives the lesson ladder with an in-page perfect player and checks gating, cues, streaks, and pass screens. It takes real lesson time; `--wind-only` is the focused held-input regression. |
| `light.test.mjs [url]` | check | Browser group (`lightcheck`). Verifies that office and camera lights swap with monitor state and remain independently calibratable. |
| `phase.test.mjs [url]` | check | Browser group (`phasetest`). Drives the BB-focused Phase A and Phase B lessons and asserts their browser behavior. |

The browser group runs through `npm run test:trainer` (`node tools/test.mjs
--browser`), which builds `dist/` and starts `serve.py` when port 8731 is free.
CI does not run it: a trainer graded in real-time milliseconds on a shared
runner says nothing about the code when it fails (`.github/workflows/ci.yml`).
