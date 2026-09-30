# `@sixam/propose`

ADR 0002's Propose context (Decision layer): what a player does, and the
research work that decides which of those choices to keep -- strategies,
policies, controllers, and experiments with their seed cohorts.

| Path | Holds | Entry point |
|---|---|---|
| `src/policy/` | the finite policy IR (`CONTRACT:policy-program-v1`), the observation language its branches read, and the controller and supervisor ports (`CONTRACT:controller-v1`) | `@sixam/propose/policy` |
| `src/games/fnaf2/` | FNaF 2's reactive controllers, the reviewed Minus Toys cycle library, its planner, the belief-backed cycle controller and the sourced night policy | `@sixam/propose/fnaf2` |
| `src/games/policy-fnaf{1,3,4}.js` | FNaF 1, 3 and 4's published lines and controls, which `tools/census.mjs` runs | `@sixam/propose/games/policy-fnaf1.js` (each exports its own `POLICIES`) |
| `src/strategies/{minus-3,minus-toys,right-vent-camp}/` | each strategy's manifest, route and model gate | `@sixam/propose/strategies/<name>` |
| `src/experiment/` | the experiment runner (`experiment.js`), the Minus Toys and Minus Two family evaluators (`families/`), seed cohorts (`seeds.js`) and the CLI (`cli.js`) | `@sixam/propose/experiment`, `@sixam/propose/seeds`, `npm run research` |
| `experiments/` | the eight named experiment specs (`CONTRACT:experiment-spec-v1`) | `npm run research -- <case>` |
| `parked/minus7/` | Minus 7, kept on purpose ([archived routes](../../docs/ARCHIVED-ROUTES.md)) | `@sixam/propose/parked/minus7` |
| `test/` | the cycle library, planner and controller, the night policy, the experiment cases and the legacy aliases (`test:contracts`) | |

The package root re-exports the policy language and FNaF 2's controllers,
which read no host or browser global; the experiment half reads the filesystem
and `node:crypto`, so it has its own subpaths.

## Experiments

Named experiments use the shared `generateCandidates` -> pure evaluator ->
aggregator path in `src/experiment/experiment.js`. The checked-in reference
cases are `model-smoke`, `controller-synthesis`, `cycle-optimization`,
`robustness-sweep`, `model-probe`, `device-characterization`, `minus-toys` and
`minus-two`. The last two use family-specific evaluators for the actual
Android-model policies, including the split-camera control and the distinct
glitchless Minus Two path; they do not route through the generic
monitor/camera smoke evaluator. Each claim-producing operation retains its
input spec, structured result and session manifest under `artifacts/`; console
output is a view of that bundle. Candidate-family statistics include a
fixed-sample Wilson interval, terminal causes and a trace hash.

There is no sandbox beside it (ADR 0002 principle 7): a claim-bearing cohort or
census is pre-registered with its family and held-out block, and a diagnostic
sweep names the explanation it tests. Every result here is `MODEL_ONLY` until a
device run of it is packed and promoted under Plan 12.

The legacy `tools/minustoystest.mjs` and `tools/minus2test.mjs` commands are
compatibility aliases covered by `test/legacy-equivalence.test.js`; they hold
no other copy of either family model. Stored names keep the old word: the
`npm run research` script, the `fnaf2-research` bin, the `research-<case>-...`
evidence ids, the `research-cli` producer and the `research` event component.

## Where it came from, and its shims

Moved here byte for byte but for their imports in migration M8 (2026-09-30):
the policy language, controllers and cycle machinery from `@sixam/core`
(`src/control/`, `src/mechanics/games/policy-fnaf*.js`), and the experiments,
strategies, specs and Minus 7 from `@sixam/research`. Two compatibility shims,
registered in
[`legacy-paths.json`](../../docs/architecture/generated/legacy-paths.json),
keep the old import paths for the files whose bytes a bundle hashes into its
`engine.sourceSha256`:

- `@sixam/core/control` (`core.control-policy-shim`) for
  `packages/propose/bin/plans/minus-toys-plan.mjs` (and two `tools/recompile` modules);
- `@sixam/research/seeds` and `@sixam/research/strategies/minus-3`
  ([`packages/research`](../research/README.md)) for
  `packages/propose/bin/plans/minus-toys-plan.mjs` and `minus-3-plan.mjs`.

New code imports `@sixam/propose/*`.

## Dependencies

`tools/architecture-test.js` (rules `propose`, `propose-test` and
`propose-importers`): propose imports the kernel, source, play (`@sixam/play/sim` for the Sim
observer, `@sixam/play/player` for the estimator), review, and Node built-ins. It never reaches the device shell -- the
applications, `tools/`, `child_process`, `net`, `dgram` -- and never
imports `@sixam/core` or `@sixam/core/control`, which re-export it. Nothing
imports propose except the applications and the registered shims, which may
only re-export it. It does not own device execution, trainer presentation or
Plan 12 promotion.

## Scripts

Entry points and checks that lived in `tools/` until the ADR 0002 layout
moved them here, with the description their tool index gave them.

| Script | Kind | What it does |
|---|---|---|
| `parked/minus7/hid-device-pilot.mjs [runs] [--night=6]` | report/check | Exact-simulator report for HID policy comparisons. `--sparse-left --night=7` is the idealized 267 ms upper bound; `--pilot-offset-ms=N` exposes its epoch dependency. `--device-sweep` substitutes the phone-proven 790 ms/240 ms-feed actuator and now also applies to the selected Night 6 left-opening route, and `--assert-rejected` requires zero survivors so the ideal result cannot be mistaken for a live route. `--pulse-light` pulses the camera light around each selection instead of holding contact 0 across the sweep, which is what makes the sweep affordable at all on night 6's 3000-frame flashlight; `--mask-margin-ms=N` sizes the BB mask's phase margin against a known T0 instead of spending a blind second. `--vocal-cam5` is plan 08's perfect-third-vocal upper bound; its error controls are `--drop-vocal=1..3` and `--vocal-false-count=1..3`. `--assert` requires complete survival with no missed BB state. Other diagnostic modes include `--cam5`, `--sparse-cam5`, `--always-threat`, and `--tick-aligned-mask`. `--bang-cam5` arms the CAM 05 read from the source bang and re-syncs its count on the read result; `--drop-bang=`/`--false-bang=` inject cue errors. `--device-actuator` prices the run through `packages/play/bin/phone/actuator.mjs` with one lateness draw per wall-timed beat (the branch macros floor off the read that happened, like `rm_floor`); `--press-late-ms=MIN,MAX` overrides the measured band. This pilot has no desync recovery loop, so its actuator numbers price open-loop monitor toggling, not the live runner. |
| `bin/plans/emit.mjs --winner winner.json --out artifacts/run-001` | compiler | CLI implementation of `device:emit`; it writes only a new/empty output directory and fails closed on an invalid winner or bundle. |
| `bin/plans/artifact-commands.mjs` | module/check | Compiles validated plan rows into bounded `artifact-action-block-v1` semantic blocks. Monitor targets and camera/office preconditions are explicit; it emits no coordinates or transport bytes. |
| `bin/plans/bundle.mjs` | module/check | Shared `winner-v1`/`device-bundle-v1` compiler and validator. New strategies register an emitter plus replay adapter instead of adding a second runner or loose-variable handoff. |
| `bin/plans/recipe.mjs` | generator/report | Emits the device pilot's opening/clear/attack cycle recipes **from the exact simulator**, with per-cycle budgets (light, wind against break-even, sweep span, camera spacing, shortest contact) and the nightly flashlight total. `--json` for the artifact, `--track` to render the same recipe in `CYCLE_SCRIPT`'s trainer shape. Monitor and mask events carry the state the engine reached, never an inferred toggle. |
| `bin/plans/minus-toys-plan.mjs --night=N [--gate] [--knobs=k=v,...]` | generator/check | Emits the measured-device port of the glitch-based Minus Toys loop (plan 02 pkg 2a) in the on-phone interpreter's plan format: an opening that arms the CAM 11-viewing / CAM 09-marker split before 0:05, then a repeating wind/mask cycle. `build(knobs)` derives the schedule from `KNOBS0` (the shipped values, byte-reproduced) so it can be searched, not hand-tuned -- arming gap, mask window, wind, hall pulse, camdrop split, `loopPeriodMs` (10000; 5000 = faithful per-interval, currently 0/200), `preventiveVentLight` (the regular ventl refresh; false is the explicit audio-gated observation variant), and an optional BB-only `reactiveBB` layer (Mangle occupancy is not implemented). `--gate` replays through the exact engine (200/200 normal + 100/100 worst per night, split armed, no-split control 0/200 on 10/20) and is what `trial.sh DEVICE_POLICY=minus-toys` runs before its first adb command. `schedule({shift})` exposes a per-instruction time offset for `minus-toys-margin.mjs` and `minus-toys-jitter.mjs`; `maskWindows(queue)` exposes post-animation/full-off coverage endpoints. Exports `KNOBS0`, `build`, `schedule`, `maskWindows`, `replay`, `emitPlan`, `OPENING`, `LOOP`. |
| `bin/plans/minus-3-plan.mjs --night=N [--gate] [--runs=N]` | generator/check | Emits the Minus 3 story route in the on-phone plan format: the CAM 11-viewing / CAM 08-marker split, then a ten-second cycle that raises and winds for one movement interval, lowers with a hall flash during the lowering gesture, and holds the mask through the interval. `build(knobs)` derives the schedule from `KNOBS0`; `secondHallVent` selects whether the second contact is the hall/right-vent compound (the shipped default, which the seed gate measures) or hall alone (what the device-winning recipe fired). `--gate` replays through the exact engine at 3000 seeds per night with the split armed. Model/device-plan boundary: it claims no device success. Exports `KNOBS0`, `build`, `schedule`, `replay`, `emitPlan`, `gate`. |
| `bin/plans/minus-toys-plan.mjs --phasegate` | report | Measures the split arm's phase sensitivity: replays the night at every whole-frame offset across one g263 sampler period (`epochMs` in `schedule()`/`replay()` shifts the whole schedule against the game's frame grid, which is what the run-to-run epoch error does on the phone) and reports wins and split-landed per epoch. The shipped minimal arm misses at exactly +7f/+8f/+9f (bimodal, P(miss) = 3/12 per attempt) -- the deterministic gate is blind to this branch by construction. A measurement, not a contract; the suite pins the table. |
