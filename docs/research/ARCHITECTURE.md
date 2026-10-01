# Research architecture

Research operations are classified as controller synthesis,
trajectory/parameter optimization, model discrimination, robustness analysis,
device characterization, or conformance/regression. Each operation declares
its model hash, candidate space, observation privilege, fault/profile, seeds,
sample/stopping/statistical contract, controls, artifacts, and claim ceiling.

`ExperimentSpec -> CandidateGenerator -> Evaluator -> Objectives/Aggregator ->
experiment-result-v1`. Candidate generation is replaceable; pure evaluation is
not coupled to trainer or live shell. Search winners are model candidates until
Plan 12 supplies promotion evidence. Sandbox probes can remain cheap but may
only depend inward on published contracts.

The reference CLI cases cover model probing, controller synthesis, cycle
optimization, bounded robustness, fixture-profile characterization, and two
family-specific Android-model campaigns: the split-camera Minus Toys policy and
the glitchless Minus Two policy. The legacy `minustoystest.ts` and
`minus2test.ts` commands call those same family evaluators, so a new candidate
space can be changed without copying their simulation loop. All remain capped
at `MODEL_ONLY` until external/device evidence is retained.

When a search has a passing gate, its explicit knobs and seed census can be
handed to `npm run device:emit -- --winner winner.json --out artifacts/run-001`.
The shared device registry currently emits `minus-toys` and `minus7`; the
resulting bundle is re-emitted and replayed during validation, so adding a
strategy means adding one registry adapter rather than another shell schedule.
