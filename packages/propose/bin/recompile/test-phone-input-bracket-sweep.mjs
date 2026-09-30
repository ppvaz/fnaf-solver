#!/usr/bin/env node
// The retained bracket family is checkable without the ignored frame trace or rebuilt binary.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { check, committedVersion, sameModelFiles } from './phone-input-bracket-sweep.mjs';

const root = new URL('../../../../', import.meta.url);
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

// A record names the paths it was computed at, and a file can move after it (ADR 0002 migration D1 moved
// the model sources from packages/core/src/mechanics to packages/source/src/games/fnaf2). seed-recovery.js
// moved with no link left behind: its old path is looked up in that path's history, not read.
const movedPath = 'packages/core/src/mechanics/seed-recovery.js';
const movedSha256 = '2198d6a3857327f448f0d19aa7d21788540440d3aef3c656ba41f387fd8936e4';
const found = committedVersion(movedPath, movedSha256);
assert.ok(found && found !== 'working tree', 'a moved file is found in its old path\'s history');
assert.equal(committedVersion(movedPath, '0'.repeat(64)), null, 'a moved path with bytes it never had is no committed version');
// The record's old paths name the same model files as the moved sources.
const recorded = Object.keys(result.source.modelSources);
assert.ok(recorded.every((path) => path.startsWith('packages/core/src/mechanics/')));
assert.ok(sameModelFiles(recorded, ['plant-model.js', 'config.js', 'rng.js'].map((name) => `packages/source/src/games/fnaf2/${name}`)));
assert.ok(!sameModelFiles(recorded, ['plant-model.js', 'rng.js', 'config.js'].map((name) => `packages/source/src/games/fnaf2/${name}`)));

console.log('phone-input-bracket-sweep: all measured prefix brackets, model snapshots and evidence hash rechecked; a moved model path resolves through its history');
