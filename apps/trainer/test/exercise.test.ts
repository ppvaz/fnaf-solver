// Plan 24 package 1: frozen exercise and independent outcome replay.
import assert from 'node:assert/strict';
import {
  CANCELLATION_SCHEMA, COMMITMENT_SCHEMA, EXERCISE_ATTEMPT_SCHEMA,
  EXERCISE_EVENT_SCHEMA, EXERCISE_SCHEMA, RESOLUTION_SCHEMA,
  makeExercise, replayExercise, validateCommitment, validateExercise,
  validateExerciseAttempt, validateExerciseEvent, validateResolution,
} from '@sixam/trainer/training';
import type { Resolution } from '@sixam/trainer/training';

const base = makeExercise({
  id: 'exercise-001', kind: 'prediction', sourceSessionId: 'session-001',
  beliefSequence: 17, clock: 'host-monotonic-ms', createdAtMs: 90, promptAtMs: 100,
  commitDeadlineMs: 300, revealDeadlineMs: 700,
  eligibility: {
    activityGateVersion: 'activity-gate-v1', profileId: 'fixture-g56-v1',
    factIds: ['fact-blackout-1'],
  },
  question: {
    target: 'first-threat-in-horizon',
    choices: ['left-vent', 'right-vent', 'none-in-horizon'], horizonMs: 500,
  },
});

const prompted = (atMs: number) => ({
  schema: EXERCISE_EVENT_SCHEMA, exerciseId: base.id, seq: 0,
  type: 'PROMPTED', clock: base.clock, atMs,
});
const committed = (seq = 1, atMs = 180) => ({
  schema: EXERCISE_EVENT_SCHEMA, exerciseId: base.id, seq,
  type: 'COMMITTED', clock: base.clock, atMs,
  commitment: {
    schema: COMMITMENT_SCHEMA, choice: 'left-vent', committedAtMs: atMs,
    responsePort: 'trainer-touch',
  },
});
const resolved = (seq = 2, atMs = 420, outcome = 'left-vent') => ({
  schema: EXERCISE_EVENT_SCHEMA, exerciseId: base.id, seq,
  type: 'RESOLVED', clock: base.clock, atMs,
  resolution: {
    schema: RESOLUTION_SCHEMA, outcome, occurredAtMs: atMs,
    evidenceFactIds: ['fact-threat-2'],
  },
});

assert.equal(base.schema, EXERCISE_SCHEMA);
assert.equal(base.disposition, 'UNRESOLVED');
assert.ok(Object.isFrozen(base) && Object.isFrozen(base.question));
assert.equal(validateExercise(base).id, base.id);
assert.equal(validateCommitment({
  schema: COMMITMENT_SCHEMA, choice: 'arbitrary-choice', committedAtMs: 1,
  responsePort: 'fixture-port',
}).responsePort, 'fixture-port');
assert.equal(validateResolution({
  schema: RESOLUTION_SCHEMA, outcome: 'arbitrary-outcome', occurredAtMs: 2,
  evidenceFactIds: ['fact-1'],
}).evidenceFactIds[0], 'fact-1');

const completed = replayExercise(base, [prompted(100), committed(), resolved()]);
assert.equal(completed.disposition, 'COMPLETED');
assert.equal(completed.commitment?.choice, 'left-vent');
// A COMPLETED replay carries its resolution.
assert.equal((completed.resolution as Resolution).outcome, 'left-vent');
assert.equal(base.commitment, null, 'replay mutated the frozen initial record');
assert.equal(validateExerciseEvent(prompted(100), base).type, 'PROMPTED');

const resolvedWithoutPlayer = replayExercise(base, [prompted(100), resolved(1)]);
assert.equal(resolvedWithoutPlayer.disposition, 'UNRESOLVED');
assert.notEqual(resolvedWithoutPlayer.resolution, 'CENSORED');

const cancelled = replayExercise(base, [prompted(100), {
  schema: EXERCISE_EVENT_SCHEMA, exerciseId: base.id, seq: 1,
  type: 'CANCELLED', atMs: 150,
  cancellation: { schema: CANCELLATION_SCHEMA, reason: 'critical-cue', atMs: 150 },
}]);
assert.equal(cancelled.disposition, 'CANCELLED');
assert.equal(cancelled.resolution, 'CENSORED');
assert.equal(cancelled.cancellation?.reason, 'critical-cue');

const ambiguous = replayExercise(base, [prompted(100), {
  schema: EXERCISE_EVENT_SCHEMA, exerciseId: base.id, seq: 1,
  type: 'CANCELLED', atMs: 160,
  cancellation: { schema: CANCELLATION_SCHEMA, reason: 'ambiguous-outcome', atMs: 160 },
}]);
assert.equal(ambiguous.disposition, 'CANCELLED');
assert.equal(ambiguous.cancellation?.reason, 'ambiguous-outcome');

const expiredBeforeCommit = replayExercise(base, [prompted(100), {
  schema: EXERCISE_EVENT_SCHEMA, exerciseId: base.id, seq: 1,
  type: 'EXPIRED', atMs: 301,
}]);
assert.equal(expiredBeforeCommit.disposition, 'EXPIRED');
assert.equal(expiredBeforeCommit.cancellation?.reason, 'commit-deadline');

const expiredBeforeResolution = replayExercise(base, [prompted(100), committed(), {
  schema: EXERCISE_EVENT_SCHEMA, exerciseId: base.id, seq: 2,
  type: 'EXPIRED', atMs: 701,
}]);
assert.equal(expiredBeforeResolution.cancellation?.reason, 'resolution-deadline');

const attempt = validateExerciseAttempt({
  schema: EXERCISE_ATTEMPT_SCHEMA, exerciseId: base.id,
  rendererId: 'trainer', rendererVersion: '1', sessionId: 'session-001',
  clock: base.clock, shownAtMs: 100, commitment: null, resolutionDisposition: 'CANCELLED',
  motor: { inputEvents: 0 }, score: null,
});
assert.ok(Object.isFrozen(attempt));

const expectThrow = (fn: () => unknown, message: string) => assert.throws(fn, message);
expectThrow(() => replayExercise(base, [prompted(100), committed(1, 301)]),
  'late commitment was accepted');
expectThrow(() => replayExercise(base, [prompted(100), resolved(2), committed(1)]),
  'event sequence/order violation was accepted');
expectThrow(() => replayExercise(base, [
  { ...prompted(100), seq: 0 }, { ...committed(), seq: 2 },
]), 'event sequence gap was accepted');
expectThrow(() => validateExercise({ ...base, disposition: 'COMPLETED' }),
  'completed exercise without evidence was accepted');
expectThrow(() => validateExerciseEvent({ ...prompted(99) }, base),
  'prompt timestamp mismatch was accepted');

console.log('exercise contracts: frozen questions, independent outcomes, deadlines, censoring, and replay pass');
