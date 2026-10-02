import assert from 'node:assert/strict';
import {
  applyArcadeGrade,
  exportArcadeProgress,
  makeArcadeProgress,
  makeArcadeSet,
  resetArcadeProgress,
  validateArcadeProgress,
} from '../src/arcade-lab.ts';
import {
  makePredictionExercise,
  makeReplaySnapshot,
} from '../src/microtrainer.ts';

const expectThrow = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, (error: unknown) => !pattern || pattern.test((error as Error).message));
const scheduler = { policyId: 'arcade-test', policyVersion: '1', selectionProbability: 1 };
function exercise(id: string, atMs: number) {
  const snapshot = makeReplaySnapshot({
    id: `snapshot-${id}`, sessionId: 'arcade-source', beliefSequence: atMs,
    clock: 'host-monotonic-ms', atMs, profileId: 'arcade-profile',
    activityGateVersion: 'activity-gate-v1', factIds: [`before-${id}`], stateFamily: 'hall', split: 'replay',
  });
  return makePredictionExercise({ id, snapshot, target: 'state', choices: ['A', 'B'], horizonMs: 300,
    scheduler, futureFact: { schema: 'resolution-v1', outcome: 'A', occurredAtMs: atMs + 100,
      evidenceFactIds: [`after-${id}`] } }).exercise;
}

const exercises = [exercise('one', 100), exercise('two', 200), exercise('three', 300)];
const first = makeArcadeSet({ id: 'set-1', seed: 'daily-7', exercises, surface: 'campaign' });
const second = makeArcadeSet({ id: 'set-1', seed: 'daily-7', exercises, surface: 'campaign' });
assert.deepEqual(first, second, 'the same seed must produce the same exercise order');
assert.equal(first.count, 3);
assert.equal(Object.isFrozen(first), true);
expectThrow(() => makeArcadeSet({ id: 'duplicate', seed: 'x', exercises: [exercises[0], exercises[0]] }), /unique/);

let progress = makeArcadeProgress({ playerId: 'arcade-player', setId: first.id, createdAtMs: 0 });
progress = applyArcadeGrade(progress, { status: 'SCORED', correct: true }, 100);
assert.equal(progress.combo, 1);
assert.equal(progress.bestCombo, 1);
progress = applyArcadeGrade(progress, { status: 'CENSORED', score: null }, 200);
assert.equal(progress.combo, 1, 'censoring must not break the combo');
assert.equal(progress.scored, 1);
assert.equal(progress.censored, 1);
progress = applyArcadeGrade(progress, { status: 'SCORED', correct: false }, 300);
assert.equal(progress.combo, 0);
assert.equal(progress.scored, 2);
assert.equal(progress.correct, 1);
assert.deepEqual(validateArcadeProgress(progress), progress);
const exported = JSON.parse(exportArcadeProgress(progress));
assert.equal(exported.playerId, 'arcade-player');
const reset = resetArcadeProgress(progress, 400);
assert.equal(reset.bestCombo, 0);
assert.equal(reset.updatedAtMs, 400);
expectThrow(() => applyArcadeGrade(progress, { status: 'SCORED', correct: true }, 250), /numeric bounds/);

console.log('arcade lab: deterministic seeded sets, neutral censoring, separate correctness/combo counters, reset, and export pass');
