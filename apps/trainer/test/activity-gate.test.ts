// Plan 24 package 2: conservative activity admission and refusal contract.
import assert from 'node:assert/strict';
import {
  ACTIVITY_GATE_SCHEMA, ACTIVITY_GATE_PROFILE_SCHEMA,
  evaluateActivityGate, validateActivityGateProfile,
  validateActivityGateSnapshot,
} from '@sixam/trainer/training';

const profile = {
  schema: ACTIVITY_GATE_PROFILE_SCHEMA, id: 'fixture-quiet-v1', version: '1',
  profileLimit: 0.2,
  timing: { promptMs: 200, revealMs: 500, cancelP99Ms: 100, humanRecoveryBudgetMs: 200 },
  requiredCapabilities: ['overlay', 'capture', 'response'],
};
const snapshot = {
  schema: ACTIVITY_GATE_SCHEMA, profileId: profile.id, nowMs: 1000,
  screen: { identity: 'FNAF2_NIGHT', qualification: 'QUALIFIED' },
  belief: { freshness: 'FRESH', consistency: 'CONSISTENT', criticalState: 'CLEAR',
    riskUpperBound: 0.1, quietHorizonMs: 3000 },
  capabilities: { overlay: 'QUALIFIED', capture: 'QUALIFIED', response: 'QUALIFIED' },
};

const admitted = evaluateActivityGate(snapshot, profile);
assert.equal(admitted.admitted, true);
assert.deepEqual(admitted.reasons, []);
assert.equal(admitted.requiredQuietHorizonMs, 1000);
assert.ok(Object.isFrozen(admitted));
assert.equal(validateActivityGateProfile(profile).id, profile.id);
assert.equal(validateActivityGateSnapshot(snapshot).profileId, profile.id);

const withChanges = (changes: object) => evaluateActivityGate({ ...snapshot, ...changes }, profile);
assert.ok(withChanges({ screen: { identity: 'OTHER', qualification: 'QUALIFIED' } }).reasons.includes('screen-not-night'));
assert.ok(withChanges({ screen: { identity: 'FNAF2_NIGHT', qualification: 'UNQUALIFIED' } }).reasons.includes('screen-unqualified'));
assert.ok(withChanges({ belief: { ...snapshot.belief, freshness: 'STALE' } }).reasons.includes('belief-stale'));
assert.ok(withChanges({ belief: { ...snapshot.belief, consistency: 'CONFLICTING' } }).reasons.includes('belief-conflicting'));
assert.ok(withChanges({ belief: { ...snapshot.belief, criticalState: 'ACTIVE' } }).reasons.includes('critical-cue-active'));
assert.ok(withChanges({ belief: { ...snapshot.belief, criticalState: 'COOLING_DOWN' } }).reasons.includes('critical-cue-cooldown'));
assert.ok(withChanges({ belief: { ...snapshot.belief, riskUpperBound: null } }).reasons.includes('critical-risk-unknown'));
assert.ok(withChanges({ belief: { ...snapshot.belief, riskUpperBound: 0.21 } }).reasons.includes('critical-risk-above-profile-limit'));
assert.ok(withChanges({ belief: { ...snapshot.belief, quietHorizonMs: 999 } }).reasons.includes('quiet-horizon-too-short'));
assert.ok(withChanges({ belief: { ...snapshot.belief, quietHorizonMs: null } }).reasons.includes('quiet-horizon-unknown'));
assert.ok(evaluateActivityGate({ ...snapshot, capabilities: { ...snapshot.capabilities, response: 'UNKNOWN' } }, profile)
  .reasons.includes('capability-response-unqualified'));
assert.ok(evaluateActivityGate({ ...snapshot, profileId: 'other-profile' }, profile)
  .reasons.includes('profile-mismatch'));

// Increasing either risk or the measured cancellation budget cannot create a
// new admission. These are the monotonic controls required by P2.
for (const risk of [0.2001, 0.3, 0.9, 1]) {
  const result = withChanges({ belief: { ...snapshot.belief, riskUpperBound: risk } });
  assert.equal(result.admitted, false, `risk ${risk} weakened the gate`);
}
for (const cancelP99Ms of [100.1, 1000, 2000, 2501]) {
  const result = evaluateActivityGate(snapshot, {
    ...profile, timing: { ...profile.timing, cancelP99Ms },
  });
  assert.equal(result.admitted, cancelP99Ms < 2500,
    `latency ${cancelP99Ms} had an unexpected admission result`);
}

// Critical-cue priority wins even when every other field is ideal.
const critical = withChanges({ belief: { ...snapshot.belief, criticalState: 'ACTIVE' } });
assert.equal(critical.admitted, false);
assert.deepEqual(critical.reasons, ['critical-cue-active']);

const expectThrow = (fn: () => unknown, message: string) => assert.throws(fn, message);
expectThrow(() => validateActivityGateSnapshot({ ...snapshot,
  belief: { ...snapshot.belief, riskUpperBound: -0.1 },
}), 'negative risk was accepted');
expectThrow(() => validateActivityGateProfile({ ...profile,
  requiredCapabilities: ['overlay', 'overlay'],
}), 'duplicate required capabilities were accepted');
expectThrow(() => validateActivityGateProfile({ ...profile,
  requiredCapabilities: ['overlay', 'capture'],
}), 'profile with a missing safety capability was accepted');
expectThrow(() => evaluateActivityGate(snapshot, {
  ...profile, timing: { ...profile.timing, cancelP99Ms: Number.NaN },
}), 'non-finite latency profile was accepted');

console.log('activity gate: qualified quiet admission, monotonic risk/latency refusals, and critical priority pass');
