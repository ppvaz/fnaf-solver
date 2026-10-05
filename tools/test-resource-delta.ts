#!/usr/bin/env node
// Refutation controls: noise, real regressions, missing measurements and dishonest expectations.
import assert from 'node:assert/strict';
import test from 'node:test';
import { compareResources, validateExpectations, validateMap } from './resource-delta.ts';
import type { ResourceMap } from './resource-delta.ts';

const map = (id: string, time: readonly number[], memory: readonly number[]): ResourceMap => ({
  schema: 'resource-map-v1', evidenceId: id, claimLevel: 'FIXTURE',
  context: { hardware: 'same-device', runtime: 'same-vm', workload: 'same-seeded-input', instrument: 'same-instrument' },
  coverage: ['controller cycle', 'process RSS'],
  metrics: [
    { id: 'cycle', unit: 'ms', scope: 'path', samples: time },
    { id: 'rss', unit: 'MiB', scope: 'process', samples: memory },
  ],
});
test('resource deltas refuse regressions, incompatible observations and unbounded expectations', () => {
const baseline = map('base', [10, 10.1, 10.2], [80, 81, 82]);
assert.equal(compareResources(baseline, map('noop', [10.3, 10.2, 10.1], [80, 82, 83])).status, 'PASS');
const regression = map('regression', [20, 21, 22], [150, 151, 152]);
const refusal = compareResources(baseline, regression);
assert.equal(refusal.status, 'REVIEW_REQUIRED');
assert.ok(refusal.rows.every(row => row.status === 'UNEXPECTED_INCREASE'));
const permitted = validateExpectations({ schema: 'resource-expectations-v1', baselineId: 'base', changes: [
  { metric: 'cycle', maxRatio: 2.3, reason: 'The scenario now evaluates two independent policies.' },
  { metric: 'rss', maxRatio: 2, reason: 'A bounded second worker retains its own model state.' },
] });
assert.equal(compareResources(baseline, regression, permitted).status, 'PASS');
const tooTight = { ...permitted, changes: [{ metric: 'cycle', maxRatio: 1.01, reason: 'Tight time budget.' }] };
assert.equal(compareResources(baseline, map('small-increase', [10.8, 10.9, 11], [80, 81, 82]), tooTight).status, 'REVIEW_REQUIRED');
assert.throws(() => validateExpectations({ ...permitted, changes: [{ metric: 'cycle', maxRatio: Infinity, reason: 'Unlimited.' }] }));
assert.throws(() => validateExpectations({ ...permitted, changes: [{ metric: 'cycle', maxRatio: 3, reason: ' ' }] }));
assert.throws(() => compareResources(baseline, regression, { ...permitted, baselineId: 'wrong-base' }));
assert.throws(() => compareResources(baseline, regression, { ...permitted,
  changes: [{ metric: 'unmeasured', maxRatio: 2, reason: 'Not actually observed.' }] }));
assert.equal(compareResources(baseline, { ...regression, context: { ...regression.context, instrument: 'slower-profiler' } }).status, 'REVIEW_REQUIRED');
assert.equal(compareResources(baseline, { ...regression, claimLevel: 'DEVICE_MEASURED' }).status, 'REVIEW_REQUIRED');
assert.equal(compareResources(baseline, { ...baseline, metrics: baseline.metrics.slice(0, 1) }).status, 'REVIEW_REQUIRED');
assert.equal(compareResources(baseline, map('noise', [10, 14, 18], [80, 81, 82])).rows[0].status, 'INCONCLUSIVE');
assert.equal(compareResources(baseline, map('tail-spike', [10.1, 10.2, 30], [80, 81, 82])).status, 'REVIEW_REQUIRED');
for (const invalid of [[], { ...baseline, metrics: [] }, { ...baseline, metrics: [baseline.metrics[0], baseline.metrics[0]] },
  { ...baseline, metrics: [{ ...baseline.metrics[0], samples: [10, 11] }] },
  { ...baseline, claimLevel: ['FIXTURE'] }, { ...baseline, metrics: [{ ...baseline.metrics[0], unit: ['ms'] }] },
  { ...baseline, context: { runtime: 'missing-identities' } }]) assert.throws(() => validateMap(invalid));
assert.deepEqual(validateMap(baseline), baseline);
console.log('resource-delta: no-op noise passes; time/RSS regressions, mismatched ceilings, missing data and unbounded excuses refuse; finite reasons remain accountable');
});
