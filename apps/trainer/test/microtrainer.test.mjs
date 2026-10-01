import assert from 'node:assert/strict';
import {
  EXACT_SIMULATOR_CASE_SCHEMA,
  RETAINED_CROP_SCHEMA,
  TIMING_BUCKET_SCHEMA,
  UNKNOWN_CHOICE,
  makeMicrotrainerAttempt,
  makeMicrotrainerRecord,
  makeMicrotrainerSession,
  makePredictionExercise,
  makeRecognitionExercise,
  makeReplaySnapshot,
  makeStrategyExercise,
  makeTimingExercise,
  replayMicrotrainerSession,
} from '../src/microtrainer.ts';

const expectThrow = (fn, pattern) => {
  assert.throws(fn, error => {
    if (pattern && !pattern.test(error.message)) return false;
    return true;
  });
};

const scheduler = Object.freeze({
  policyId: 'fixed-replay-v1', policyVersion: '1', selectionProbability: 0.5,
  seed: 17, reason: 'state-family-balanced',
});

const snapshot = makeReplaySnapshot({
  id: 'snapshot-hall-1', sessionId: 'source-session-1', beliefSequence: 12,
  clock: 'host-monotonic-ms', atMs: 1000, profileId: 'trainer-profile-v1',
  activityGateVersion: 'activity-gate-v1', factIds: ['belief-12', 'hall-fact-12'],
  stateFamily: 'hall-threat', split: 'replay', artifactIds: ['night-session-1'],
});

assert(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.factIds),
  'retained snapshots must be immutable');
expectThrow(() => makeReplaySnapshot({ ...snapshot, runtime: { mutable: true } }), /runtime fields/);

const prediction = makePredictionExercise({
  id: 'prediction-1', snapshot, target: 'next-hall-state', choices: ['CLEAR', 'THREAT'],
  horizonMs: 600, scheduler,
  futureFact: { schema: 'resolution-v1', outcome: 'THREAT', occurredAtMs: 1300,
    evidenceFactIds: ['future-hall-fact-13'] },
  commitment: { schema: 'commitment-v1', choice: 'THREAT', committedAtMs: 1150,
    responsePort: 'replay-keyboard' },
});
assert.equal(prediction.exercise.disposition, 'UNRESOLVED');
assert.equal(prediction.replay.disposition, 'COMPLETED');
assert.equal(prediction.replay.resolution.outcome, 'THREAT');

const predictionAttempt = makeMicrotrainerAttempt({
  exercise: prediction.replay, rendererId: 'campaign', rendererVersion: '1',
  sessionId: 'trainer-session-1', shownAtMs: 1000,
  commitment: prediction.replay.commitment,
});
const predictionRecord = makeMicrotrainerRecord({
  exercise: prediction.exercise, events: prediction.events, attempt: predictionAttempt,
});
assert.deepEqual(predictionRecord.grade, {
  status: 'SCORED', correct: true, score: { prediction: 1 }, denominator: 1, outcome: 'THREAT',
});
assert.equal(predictionRecord.latency.promptToCommitMs, 150);
assert.equal(predictionRecord.latency.promptToResolutionMs, 300);

const censoredPrediction = makePredictionExercise({
  id: 'prediction-uncommitted', snapshot, target: 'next-hall-state', choices: ['CLEAR', 'THREAT'],
  horizonMs: 600, scheduler,
  futureFact: { schema: 'resolution-v1', outcome: 'THREAT', occurredAtMs: 1300,
    evidenceFactIds: ['future-hall-fact-14'] },
});
const censoredAttempt = makeMicrotrainerAttempt({
  exercise: censoredPrediction.replay, rendererId: 'replay', rendererVersion: '1',
  sessionId: 'trainer-session-1', shownAtMs: 1000,
});
const censoredRecord = makeMicrotrainerRecord({
  exercise: censoredPrediction.exercise, events: censoredPrediction.events,
  attempt: censoredAttempt,
});
assert.equal(censoredRecord.final.disposition, 'UNRESOLVED');
assert.equal(censoredRecord.grade.status, 'CENSORED');
assert.equal(censoredRecord.grade.score, null);

const crop = {
  schema: RETAINED_CROP_SCHEMA, id: 'crop-cam-05-1', artifactId: 'frames-holdout-1',
  sha256: 'sha256-crop-1', factId: 'crop-label-fact-1', sessionId: 'source-session-2',
  profileId: snapshot.profileId, retained: true, split: 'holdout', label: 'CAM_05',
  labelProvenance: { annotator: 'reviewed', source: 'independent-frame-label' },
};
const recognition = makeRecognitionExercise({
  id: 'recognition-1', snapshot, crop, choices: ['CAM_10'], horizonMs: 500,
  scheduler, commitment: { schema: 'commitment-v1', choice: UNKNOWN_CHOICE, committedAtMs: 1100,
    responsePort: 'replay-keyboard' },
});
assert(recognition.exercise.question.choices.includes(UNKNOWN_CHOICE),
  'recognition must always offer abstention');
assert(recognition.exercise.eligibility.sourceCrop.sha256 === crop.sha256,
  'recognition must retain artifact hash provenance');
const recognitionAttempt = makeMicrotrainerAttempt({
  exercise: recognition.replay, rendererId: 'threat-constellation', rendererVersion: '1',
  sessionId: 'trainer-session-1', shownAtMs: 1000, commitment: recognition.replay.commitment,
});
const recognitionRecord = makeMicrotrainerRecord({
  exercise: recognition.exercise, events: recognition.events, attempt: recognitionAttempt,
});
assert.equal(recognitionRecord.grade.correct, false,
  'an abstention is scored against the retained label, not treated as the label');
expectThrow(() => makeRecognitionExercise({
  id: 'recognition-bad-profile', snapshot, crop: { ...crop, profileId: 'other-profile' },
  choices: ['CAM_05'], horizonMs: 500, scheduler,
}), /microtrainer exercise is ineligible/);
expectThrow(() => makeRecognitionExercise({
  id: 'recognition-raw', snapshot, crop: { ...crop, pixels: [1, 2, 3] },
  choices: ['CAM_05'], horizonMs: 500, scheduler,
}), /raw media fields/);

const buckets = {
  schema: TIMING_BUCKET_SCHEMA,
  buckets: [
    { id: 'LATE', minMs: null, maxMs: 0 },
    { id: 'SOON', minMs: 0, maxMs: 250 },
    { id: 'LATER', minMs: 250, maxMs: null },
  ],
};
const timing = makeTimingExercise({
  id: 'timing-1', snapshot, target: 'hall-deadline', deadlineAtMs: 1800,
  responseLatencyBudgetMs: 200, timingBuckets: buckets, observedActionAtMs: 1650,
  evidenceFactIds: ['action-fact-1'], scheduler,
  commitment: { schema: 'commitment-v1', choice: 'SOON', committedAtMs: 1200,
    responsePort: 'replay-keyboard' },
});
assert.equal(timing.replay.resolution.outcome, 'SOON');
assert.equal(timing.exercise.eligibility.responseLatencyBudgetMs, 200);
expectThrow(() => makeTimingExercise({
  id: 'timing-too-late', snapshot, target: 'deadline', deadlineAtMs: 1150,
  responseLatencyBudgetMs: 200, timingBuckets: buckets, scheduler,
}), /timing-deadline-inside-response-budget/);
expectThrow(() => makeTimingExercise({
  id: 'timing-bad-buckets', snapshot, target: 'deadline', deadlineAtMs: 1800,
  responseLatencyBudgetMs: 100,
  timingBuckets: { schema: TIMING_BUCKET_SCHEMA, buckets: [
    { id: 'A', minMs: null, maxMs: 0 }, { id: 'B', minMs: 5, maxMs: null },
  ] }, scheduler,
}), /contiguous/);

const simulatorCase = {
  schema: EXACT_SIMULATOR_CASE_SCHEMA, id: 'minus7-case-1', version: 'engine-1',
  engineHash: 'fnv1a-engine-1', authority: 'exact-simulator', modelLabel: 'MODEL_ONLY',
  provenance: { source: 'exact-engine-replay', factIds: ['sim-result-fact-1'], seed: 4 },
};
const strategy = makeStrategyExercise({
  id: 'strategy-1', snapshot, target: 'choose-safe-cycle', choices: ['MASK', 'FLASH'],
  horizonMs: 700, simulatorCase,
  result: { outcome: 'MASK', occurredAtMs: 1400, evidenceFactIds: ['sim-result-fact-1'] },
  scheduler, commitment: { schema: 'commitment-v1', choice: 'MASK', committedAtMs: 1200,
    responsePort: 'replay-keyboard' },
});
assert.equal(strategy.exercise.eligibility.modelLabel, 'MODEL_ONLY');
assert.equal(strategy.replay.disposition, 'COMPLETED');
expectThrow(() => makeStrategyExercise({
  id: 'strategy-live', snapshot, target: 'unsafe', choices: ['A', 'B'], horizonMs: 700,
  simulatorCase: { ...simulatorCase, modelLabel: 'DEVICE_MEASURED' },
  result: { outcome: 'A', occurredAtMs: 1400, evidenceFactIds: ['sim-result-fact-2'] }, scheduler,
}), /microtrainer exercise is ineligible/);

const strategyAttempt = makeMicrotrainerAttempt({
  exercise: strategy.replay, rendererId: 'replay', rendererVersion: '1',
  sessionId: 'trainer-session-1', shownAtMs: 1000, commitment: strategy.replay.commitment,
});
const strategyRecord = makeMicrotrainerRecord({
  exercise: strategy.exercise, events: strategy.events, attempt: strategyAttempt,
});
const session = makeMicrotrainerSession({
  session: {
    sessionId: 'trainer-session-1', sourceSessionId: 'source-session-1',
    clock: 'host-monotonic-ms', startedAtMs: 1000, endedAtMs: 1800,
    profileId: snapshot.profileId, surface: 'replay', split: 'replay',
  },
  artifacts: [
    { artifactId: 'frames-holdout-1', sha256: crop.sha256,
      mediaType: 'image/png', role: 'recognition-source', size: 128 },
    { artifactId: 'night-session-1', sha256: 'sha256-night-1',
      mediaType: 'application/jsonl', role: 'source-session' },
  ],
  records: [recognitionRecord, predictionRecord, censoredRecord, strategyRecord],
});
assert(Object.isFrozen(session) && Object.isFrozen(session.records),
  'microtrainer session must be immutable');
assert(session.events.some(event => event.type === 'COMMITTED'),
  'session event stream must retain commitment events');
assert(session.events.some(event => event.type === 'RESOLVED'),
  'session event stream must retain independent resolution events');
assert.equal(replayMicrotrainerSession(session).find(row => row.exerciseId === 'prediction-1').grade.correct, true);
expectThrow(() => makeMicrotrainerSession({
  session: { ...session.session, endedAtMs: 1200 }, records: [predictionRecord], artifacts: [],
}), /outside session bounds/);
expectThrow(() => makeMicrotrainerSession({
  session: session.session, records: [{ ...predictionRecord, grade: { status: 'SCORED', correct: false } }], artifacts: [],
}), /record.grade does not match replay/);

console.log('microtrainer: prediction, timing, retained recognition, MODEL_ONLY strategy, censoring, provenance, and session replay pass');
