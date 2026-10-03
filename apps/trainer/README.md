# `@sixam/trainer`

The browser trainer: ADR 0002's Teach context, in the charter's Understanding
layer. It drills Niko Frost's Minus 7 for FNaF 2's 10/20 mode as touch lessons
on a phone held sideways, graded against the Sim from `@sixam/source/fnaf2`,
and it says on its first screen why the bot on the phone plays Zach_Scream's
Minus Toys instead. It is published from the repository root's `index.html`
(GitHub Pages, through its import map) and built into one offline file by
`npm run build:trainer`.

It owns the UI, touch input, audio, the lesson ladder and the taught cycle
(`MINUS7_CYCLE`, `src/curriculum.js`), the coach, trainer traces, and its
replayable exercise and activity-gate records (`exercise-v1`,
`activity-gate-v1` and their siblings, in `src/training/`, the
`@sixam/trainer/training` export). It imports only `@sixam/kernel` and
`@sixam/source`. It does not own the game's mechanics, device profiles,
policies, live input to the phone or claim promotion.

## What it teaches, and how that is kept honest

- **The taught pass is one the Sim accepts.** Every gap the Sim gates on an
  animation is the sourced animation length plus two frames; the rest keeps
  Source's `CYCLE_SCRIPT` spacing, whose own mask-off the Sim has refused since
  3d5c5f7. `test/lessons.test.ts` plays every lesson through the Sim.
- **The coach grades what the game took.** `playPress` lets the Sim take a
  press before the coach grades it, and a press the Sim refuses is graded
  `refused`, not on its timing.
- **Every number about a route wears its label.** `src/route-facts.js` holds
  each statement with its claim level (`MODEL_ONLY`, `DEVICE_MEASURED`) and
  the committed record behind it; `test/route-facts.test.ts` fails when a
  label or a value differs from that record. A quantity nobody has measured is
  shown as UNKNOWN with its reason: whether this Minus 7 pass clears a whole
  10/20 night in the model, and how late each of its steps may be.
- **The page names what its server can write.** Only `serve.py` adds the
  `trainer-dev-server` tag, so only there does a coached run post its trace
  (`trainer-trace-v1`, dry when a browser is automated) or a layout get saved.

Which route a person should learn is roadmap step S5's question: its
widest-margin candidate so far is a preset Minus Toys schedule that has never
been played on the phone. The trainer keeps teaching Minus 7 until a route is
certified there. Coached nights are practice and never count toward S5's
`P(win | H)` (ADR 0002, Pedro's decision 19).

The DOM-free parts are exported from `src/index.ts`: `Coach`, and the Plan 24
replay microtrainer and renderer descriptors (`microtrainer-session-v1`,
`exercise-renderer-v1`, `arcade-lab-progress-v1`). The Arcade lab in the menu
is a clearly labelled `FIXTURE / PRACTICE` prediction demo over three fixture
items; the Rhythm Highway and Threat Constellation modules and the adaptive
skill model were archived on 2026-09-25 (`8a49403c`) and only their renderer
ids remain.

## Tests and tools

Everything here lives in `apps/trainer/test/`. The npm script names are the
stable interface; the paths are where the files live now (they were in `tools/`
until 2026-09-30).

| Tool | Kind | Purpose and interface |
|---|---|---|
| `build.ts` | build | `npm run build:trainer`. Inlines the imported modules, CSS, and fonts into ignored `dist/index.html`; a `.ts` module is inlined with its types erased by Node's own stripper, as `strip-types.ts` prints it. Since 2026-09-30 this bundle is what GitHub Pages publishes as `index.html` (`.github/workflows/pages.yml`); source works without it during development, through `serve.py`. |
| `strip-types.ts FILE...` | build helper | Prints each TypeScript module with its types erased by Node's own stripper (`module.stripTypeScriptTypes`, mode `strip`, so lines and columns stay the source's), as JSON. `serve.py` calls it, and `build.ts` calls the same stripper in-process, since the sources run under Node's type stripping and a browser cannot strip types. Refuses syntax that needs more than erasure (an enum, a namespace), as `erasableSyntaxOnly` does at typecheck. |
| `serve.py [port]` | dev server | `npm run serve:trainer`. Serves the repo on 127.0.0.1 only, defaulting to port 8731; a phone reaches it over USB with `adb reverse tcp:8731 tcp:8731` and `http://localhost:8731`, never over the network (until 2026-09-29 it bound 0.0.0.0, so anyone on the LAN could rewrite the core config). `POST /save-layout` validates a calibrated layout, rewrites `packages/source/src/games/fnaf2/config.ts`, and rebuilds, so that endpoint is intentionally mutating. Every POST is refused with 403 unless its client is loopback, its Host names this machine and any Origin is the page's own (`write_refusal`), so a web page open in the host's browser cannot write either. `POST /save-trace` records a trainer run's per-step timing census under ignored `captures/traces/`, stamped with save time and commit (`FNAF_TRACE_DIR` overrides the directory for tests). Every trainer page it serves gets a `trainer-dev-server` meta tag naming those two endpoints; a page served without it (GitHub Pages, any static host) posts no trace and offers no layout save. A `.ts` module is served as `text/javascript` with its types erased (`strip-types.ts`, cached until the file changes), so the root `index.html`'s import map loads TypeScript sources in the browser. |
| `serve_test.py` | check | Pins that `serve.py` writes for this machine only: the socket binds 127.0.0.1, a loopback client with its own Host and Origin (or none) writes, and a page on another origin, a DNS-rebound Host or an off-host client is refused with 403 and writes nothing; no answer carries `Access-Control-Allow-Origin`. It also pins the `trainer-dev-server` tag on the served page, and that a `.ts` module is served as JavaScript with its types erased while a path outside the repository or a missing one is a 404 (before 2026-09-30 any 404 raised in `log_message` and dropped the connection). Dry runs and a temporary `FNAF_TRACE_DIR` only. `test:unit`. |
| `exercise.test.ts` | check | Phone-free Plan 24 package 1 contract: freezes exercise questions, replays ordered commitments and independent resolutions, and censors cancelled, expired, or unresolved outcomes. It does not score a player or render a live prompt. `test:contracts`. |
| `activity-gate.test.ts` | check | Phone-free Plan 24 package 2 contract: admits only qualified fresh quiet windows, retains refusal reasons, and proves increasing risk/latency cannot weaken the gate or outrank a critical cue. `test:contracts`. |
| `microtrainer.test.ts` | check | Phone-free Plan 24 package 3 contract: retained prediction/timing sources, profile-bound recognition with `UNKNOWN`, exact-simulator `MODEL_ONLY` strategy provenance, censoring, latency/scheduler/session joins, and deterministic replay. `test:contracts`. |
| `renderer.test.ts` | check | Phone-free Plan 24 Arcade Lab renderer contract: campaign/rhythm/spatial frozen views, accessibility capabilities, raw-media exclusion, shared attempts, and presentation-invariant semantic grading. `test:contracts`. |
| `arcade-lab.test.ts` | check | Phone-free Plan 24 Arcade Lab progression contract: deterministic seeded sets, local personal-best counters, neutral censored outcomes, reset, export, and no cross-player state. `test:contracts`. |
| `coach.test.ts` | check | The coach grades what the game did with a press: `pressLanded` judges a press from the Sim state it changes, and `playPress`, the app's one press path, lets the Sim take the press before the coach grades it, so a press the Sim refuses (the mask mid-animation, anything but the mask while it is on, a camera before the monitor is up) is graded `refused` and breaks the pass instead of scoring on its timing. A pass that ends on the held WIND is settled when the hold ends, at the next anchor, so its hold is graded on that pass and not the next. `test:contracts`. |
| `lessons.test.ts` | check | Every scripted lesson played headless on its cues through `playPress`: no press refused by the Sim, every graded row `good` from the first pass, every drill passed, the lethal "survive" lesson survived on ten seeds, and the taught cycle's animation-gated gaps equal the sourced animation plus two frames. Its control plays Source's `CYCLE_SCRIPT`, the pattern taught until 2026-09-30, and must see it refused. `test:contracts`. |
| `route-facts.test.ts` | check | Every statement the trainer makes about a route's results (`src/route-facts.js`) is checked against the committed record it cites: the record's `claimLevel` must equal the fact's label, each value must equal the record field it names, and every other number in its text must be one of those values or a name (10/20, 6 AM, the ±60 ms human gate, a date). An UNKNOWN fact must carry its reason and cite no value. `test:contracts`. |
| `trace.test.ts` | check | Gates the trainer's per-step trace: the Coach's census rows against scripted lateness, `tracereport.ts` banding math, and `serve.py`'s `/save-trace` against a temporary directory. No browser or phone. `tools/test.ts --engine` (`trainer trace`). |
| `tracereport.ts [dir]` | report | Bands the recorded trainer traces per step: lateness quantiles, wind-hold coverage, inter-press spacing, and provenance. Excludes webdriver and off-speed runs from the census. The measured replacement for plans/04's `[INFERRED]` human profile, once enough runs accumulate. `tools/test.ts --reports`. |
| `browser.test.ts [url] [screenshot]` | check | Browser group (`browsertest`). General load/input smoke check; writes `/tmp/m7-report.png` by default. |
| `calibration.test.ts [url]` | check | Browser group (`caltest`). Exercises drag-versus-press and layout saving. It snapshots and restores `packages/source/src/games/fnaf2/config.ts` because saving is a real write. |
| `lesson.test.ts [url]` | check | Browser group (`lessontest`). Drives the lesson ladder with an in-page perfect player and checks gating, cues, streaks, and pass screens. It takes real lesson time; `--wind-only` is the focused held-input regression. |
| `light.test.ts [url]` | check | Browser group (`lightcheck`). Verifies that office and camera lights swap with monitor state and remain independently calibratable. |
| `phase.test.ts [url]` | check | Browser group (`phasetest`). Drives the BB-focused Phase A and Phase B lessons and asserts their browser behavior. |
| `pages.test.ts [url]` | check | Browser group (`pages entry`). The Pages entry as a visitor's phone gets it: `build.ts`'s bundle at `/`, as `pages.yml` publishes it, over the repository's other files, from its own GET-only static server (or the live site given as `url`), upright and sideways at phone sizes; runs and quits a lesson with real (CDP) taps. Fails on any console error, exception, failed or 4xx request, sideways scroll, or a layout save offered where no dev server is. |

The browser group runs through `npm run test:trainer` (`node tools/test.ts
--browser`), which builds `dist/` and starts `serve.py` when port 8731 is free.
CI does not run it: a trainer graded in real-time milliseconds on a shared
runner says nothing about the code when it fails (`.github/workflows/ci.yml`).
