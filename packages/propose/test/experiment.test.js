import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCandidates, replayModelResult, runModelExperiment } from '../src/experiment/experiment.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const cases = ['model-smoke', 'controller-synthesis', 'cycle-optimization',
  'robustness-sweep', 'model-probe', 'device-characterization', 'minus-toys', 'minus-two'];
for (const id of cases) {
  const spec = JSON.parse(await readFile(join(ROOT, 'experiments', `${id}.json`), 'utf8'));
  const candidates = generateCandidates(spec);
  const result = runModelExperiment(spec);
  const dimensions = Object.values(spec.candidateSpace?.dimensions ?? {})
    .filter(values => Array.isArray(values) && values.length);
  const parameterCount = dimensions.length
    ? dimensions.reduce((count, values) => count * values.length, 1)
    : spec.evaluator ? spec.candidateParameters.length : 1;
  const expectedCandidates = (spec.evaluator || spec.candidateSpace)
    ? spec.seeds.length * parameterCount : spec.seeds.length;
  assert.equal(candidates.length, expectedCandidates, `${id}: candidate count`);
  assert.equal(result.evaluations.length, expectedCandidates, `${id}: evaluation count`);
  assert.equal(result.operation, spec.operation, `${id}: operation`);
  assert.equal(result.claimLevel, 'MODEL_ONLY', `${id}: claim ceiling`);
  assert.ok(result.evaluations.every(item => item.traceHash.startsWith('fnv1a-')), `${id}: trace hashes`);
  const replay = replayModelResult(spec, { evidenceId: `replay-${id}` });
  assert.equal(replay.resultHash, replayModelResult(spec, { evidenceId: `replay-${id}` }).resultHash, `${id}: replay hash`);
}
const synthesis = JSON.parse(await readFile(join(ROOT, 'experiments', 'controller-synthesis.json'), 'utf8'));
assert.equal(generateCandidates(synthesis).length, 18, 'controller synthesis expands its cartesian candidate space');
assert.equal(runModelExperiment(synthesis).campaign.method, 'exhaustive-enumeration');
const toys = JSON.parse(await readFile(join(ROOT, 'experiments', 'minus-toys.json'), 'utf8'));
const toysResult = runModelExperiment(toys);
assert.deepEqual(toysResult.campaign.ranking.map(item => item.candidate), ['split', 'no-split-control']);
const two = JSON.parse(await readFile(join(ROOT, 'experiments', 'minus-two.json'), 'utf8'));
assert.ok(runModelExperiment(two).evaluations.every(item => item.family === 'minus-two'));
console.log(`research reference cases: ${cases.length} shared experiment paths pass, including Minus Toys/Two family evaluators`);
