# `@sixam/research`

Named experiments use the shared `generateCandidates` → pure evaluator →
aggregator path in `src/experiment.js`. The checked-in reference cases are
`model-smoke`, `controller-synthesis`, `cycle-optimization`,
`robustness-sweep`, `model-probe`, `device-characterization`, `minus-toys`,
and `minus-two`. The last two use family-specific evaluators for the actual
Android-model policies, including the split-camera control and the distinct
glitchless Minus Two path; they do not route through the generic monitor/camera
smoke evaluator. Each claim-producing operation retains its input spec,
structured result, and session manifest; console output is a view of that
bundle.

Research owns experiment specifications, candidate generation, pure model
evaluation, statistics, and structured result artifacts. It consumes core and
declared fault/adapter models; it never imports trainer presentation or live
device shell internals. There is no sandbox beside it (ADR 0002 principle 7,
2026-09-29): a claim-bearing cohort or census is pre-registered, and a
diagnostic sweep names the explanation it tests.

Public API: experiment primitives from the package root and the explicit CLI
entry point. Dependency: core only. Commands: `npm run research -- --help` and
named operations such as `model-smoke`. Artifacts: versioned specs, result
bundles, manifests, and evidence IDs. It does not own device execution,
trainer presentation, or Plan 12 promotion.

Every claim-producing operation reports model/profile/hash/sample context and a
claim ceiling. Candidate-family statistics include a fixed-sample Wilson
interval, terminal causes, and a trace hash. Simulation results remain model
candidates until Plan 12's promotion ladder supplies the required evidence.

The legacy `tools/minustoystest.mjs` and `tools/minus2test.mjs` commands are
compatibility aliases covered by `test/legacy-equivalence.test.js`; they do not
contain another copy of either family model.
