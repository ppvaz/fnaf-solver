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
  `tools/device/minus-toys-plan.mjs` (and two `tools/recompile` modules);
- `@sixam/research/seeds` and `@sixam/research/strategies/minus-3`
  ([`packages/research`](../research/README.md)) for
  `tools/device/minus-toys-plan.mjs` and `minus-3-plan.mjs`.

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
