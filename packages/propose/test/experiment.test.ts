import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isList } from '@sixam/kernel';
import { generateCandidates, replayModelResult, runModelExperiment } from '../src/experiment/experiment.ts';
import { withModelOptions } from '../bin/recompile/rebuild-options-census.ts';
import { simOptionsFrom } from '../../source/recompile/model-draw-trace.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
// The experiments' expectations were computed on the legacy model (fnaf2-legacy, the default before
// 2026-10-02), so their Sims run that model until the legacy branches go.
withModelOptions(simOptionsFrom({}), () => {
const cases = ['model-smoke', 'controller-synthesis', 'cycle-optimization',
  'robustness-sweep', 'model-probe', 'device-characterization', 'minus-toys', 'minus-two'];
for (const id of cases) {
  const spec = JSON.parse(readFileSync(join(ROOT, 'experiments', `${id}.json`), 'utf8'));
  const candidates = generateCandidates(spec);
  const result = runModelExperiment(spec);
  const dimensions = Object.values(spec.candidateSpace?.dimensions ?? {})
    .filter((values): values is readonly unknown[] => isList(values) && values.length > 0);
  const parameterCount = dimensions.length
    ? dimensions.reduce((count, values) => count * values.length, 1)
    : spec.evaluator ? spec.candidateParameters.length : 1;
  const expectedCandidates = (spec.evaluator || spec.candidateSpace)
    ? spec.seeds.length * parameterCount : spec.seeds.length;
  assert.equal(candidates.length, expectedCandidates, `${id}: candidate count`);
  assert.equal(result.evaluations.length, expectedCandidates, `${id}: evaluation count`);
  assert.equal(result.operation, spec.operation, `${id}: operation`);
  assert.equal(result.claimLevel, 'MODEL_ONLY', `${id}: claim ceiling`);
  // Every evaluator hashes its trace to a string.
  assert.ok(result.evaluations.every(item => (item.traceHash as string).startsWith('fnv1a-')), `${id}: trace hashes`);
  const replay = replayModelResult(spec, { evidenceId: `replay-${id}` });
  assert.equal(replay.resultHash, replayModelResult(spec, { evidenceId: `replay-${id}` }).resultHash, `${id}: replay hash`);
  // LEG-009: the result's terminal spans every evaluation, not the first one's.
  // Every evaluator here ends in a terminal frame.
  const frames = result.evaluations.map(item => (item.terminal as { readonly frame: number }).frame);
  assert.deepEqual(replay.payload.terminalAggregate,
    { clock: 'simulator-frame', frames: { lo: Math.min(...frames), hi: Math.max(...frames) },
      evaluations: result.evaluations.length, reporting: frames.length }, `${id}: aggregate terminal`);
  // Read as a record: the payload's type has no terminal field to look for.
  assert.equal((replay.payload as Readonly<Record<string, unknown>>).terminal, undefined, `${id}: no first-evaluation terminal`);
}
const synthesis = JSON.parse(readFileSync(join(ROOT, 'experiments', 'controller-synthesis.json'), 'utf8'));
assert.equal(generateCandidates(synthesis).length, 18, 'controller synthesis expands its cartesian candidate space');
assert.equal(runModelExperiment(synthesis).campaign.method, 'exhaustive-enumeration');
const toys = JSON.parse(readFileSync(join(ROOT, 'experiments', 'minus-toys.json'), 'utf8'));
const toysResult = runModelExperiment(toys);
assert.deepEqual(toysResult.campaign.ranking.map(item => item.candidate), ['split', 'no-split-control']);
const two = JSON.parse(readFileSync(join(ROOT, 'experiments', 'minus-two.json'), 'utf8'));
assert.ok(runModelExperiment(two).evaluations.every(item => item.family === 'minus-two'));
console.log(`research reference cases: ${cases.length} shared experiment paths pass, including Minus Toys/Two family evaluators`);
});
