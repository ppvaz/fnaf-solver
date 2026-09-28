#!/usr/bin/env node
// The retained bracket family is checkable without the ignored frame trace or rebuilt binary.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { check } from './phone-input-bracket-sweep.mjs';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const resultPath = 'tools/recompile/results/phone-input-bracket-full-06-20260928.json';
const recordPath = 'docs/evidence/phone-input-bracket-20260928.json';
const result = JSON.parse(read(resultPath));
const evidence = JSON.parse(read(recordPath));

assert.equal(check(result).evidenceId, result.evidenceId);
assert.equal(result.evidenceId, 'recompile-phone-input-bracket-f7147f352c9115f7');
assert.equal(result.coverage.measuredResponseRowsThroughHorizon, 29);
assert.equal(result.coverage.observedResponseRowsThroughHorizon, 29);
assert.equal(result.coverage.unknownRowsThroughHorizon, 0);
assert.deepEqual(result.coverage.contactsWithoutResponseRowsThroughHorizon, []);
assert.deepEqual(result.dimensions.map(({ contactIndex, minTick, maxTick }) => [contactIndex, minTick, maxTick]), [
  [12, 606, 607], [16, 831, 832],
]);
assert.equal(result.candidateCount, 4);
assert.ok(result.candidates.every((candidate) => candidate.preservesPhonePrefix && candidate.targetCode === 'B' && !candidate.clearsTarget));
assert.ok(result.limitations.some((limit) => limit.includes('wind and camera/light contacts retain their baseline timing mapping')));
assert.ok(result.candidates.every((candidate) => candidate.targetState.activeBlackoutUnit === 'withbonnie' &&
  candidate.targetState.withBonnie.openingSince === 3627 && candidate.targetState.withBonnieEncounterFrame === 3840 &&
  candidate.targetState.encounterLeadUpdates === 24));
assert.equal(result.conclusion, 'No measured response-bracket timing choice preserves the first six phone windows and clears window 6.');

const row = evidence.results.find((entry) => entry.evidenceId === result.evidenceId);
assert.ok(row);
assert.equal(row.sha256, hash(read(resultPath)));
assert.equal(evidence.measurements.coverage.candidateSchedules, result.candidateCount);
assert.equal(evidence.measurements.coverage.allModelWindow6, 'B');

const missingBranch = structuredClone(result);
missingBranch.candidates.pop();
missingBranch.candidateCount -= 1;
assert.throws(() => check(missingBranch), /candidate family is incomplete/);

const changedState = structuredClone(result);
changedState.candidates[0].targetState.encounterLeadUpdates += 1;
assert.throws(() => check(changedState), /target-state snapshot/);

console.log('phone-input-bracket-sweep: all measured prefix brackets, model snapshots and evidence hash rechecked');
