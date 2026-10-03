// Offline/replay microtrainer boundary for Plan 24 package 3.
//
// This module deliberately has no DOM, timer, storage, or simulator import.
// It turns retained snapshots and independently retained labels/outcomes into
// the core exercise records, then records presentation/response data beside
// (rather than inside) those records. Live prompting and game input are out of
// scope here.

import {
  EXERCISE_ATTEMPT_SCHEMA,
  EXERCISE_CLOCKS,
  EXERCISE_EVENT_SCHEMA,
  makeExercise,
  replayExercise,
  validateExercise,
  validateExerciseAttempt,
  validateResolution,
  validateCommitment,
} from './training/index.ts';
import type { Commitment, Exercise, ExerciseAttempt, Resolution } from './training/index.ts';
import { stableHash } from '@sixam/kernel/contracts';
import { among, finite, freeze, isInteger, isList, isRecord, validatorsFor } from './validate.ts';
const kit = validatorsFor('microtrainer', { textMax: 160 });
// Annotated, so the checker knows a call to it does not return.
const fail: (message: string) => never = kit.fail;
const { object, text } = kit;
type Fields = Readonly<Record<string, unknown>>;

const MICROTRAINER_SESSION_SCHEMA = 'microtrainer-session-v1';
const MICROTRAINER_EVENT_SCHEMA = 'microtrainer-event-v1';
const REPLAY_SNAPSHOT_SCHEMA = 'replay-snapshot-v1';
export const RETAINED_CROP_SCHEMA = 'retained-crop-v1';
export const EXACT_SIMULATOR_CASE_SCHEMA = 'exact-simulator-case-v1';
export const TIMING_BUCKET_SCHEMA = 'timing-buckets-v1';
export const UNKNOWN_CHOICE = 'UNKNOWN';
const MICROTRAINER_SPLITS = Object.freeze(['calibration', 'holdout', 'practice', 'replay']);
const MICROTRAINER_SURFACES = Object.freeze(['campaign', 'rhythm-highway', 'threat-constellation', 'replay']);

/** The retained, pre-prompt state every exercise is built from. */
interface ReplaySnapshot {
  readonly schema: typeof REPLAY_SNAPSHOT_SCHEMA;
  readonly id: string;
  readonly sessionId: string;
  readonly beliefSequence: number;
  readonly clock: string;
  readonly atMs: number;
  readonly profileId: string;
  readonly activityGateVersion: string;
  readonly factIds: readonly string[];
  readonly stateFamily: string;
  readonly split: string;
  readonly artifactIds?: readonly string[];
}
/** A retained, profile-bound image label. */
interface RetainedCrop {
  readonly schema: typeof RETAINED_CROP_SCHEMA;
  readonly id: string;
  readonly artifactId: string;
  readonly sha256: string;
  readonly factId: string;
  readonly sessionId: string;
  readonly profileId: string;
  readonly retained: true;
  readonly split: string;
  readonly label: string;
  readonly labelProvenance?: Fields;
}
interface TimingBucket { readonly id: string, readonly minMs: number | null, readonly maxMs: number | null }
interface TimingBuckets { readonly schema: typeof TIMING_BUCKET_SCHEMA, readonly buckets: readonly TimingBucket[] }
interface SimulatorCase {
  readonly schema: typeof EXACT_SIMULATOR_CASE_SCHEMA;
  readonly id: string;
  readonly version: string;
  readonly engineHash: string;
  readonly authority: 'exact-simulator';
  readonly modelLabel: 'MODEL_ONLY';
  readonly provenance: { readonly source: string, readonly factIds: readonly string[] };
}
interface SessionHeader {
  readonly sessionId: string;
  readonly sourceSessionId: string;
  readonly clock: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly profileId: string;
  readonly surface: string;
  readonly split: string;
}
type Grade = ReturnType<typeof gradeMicrotrainerAttempt>;
/** One exercise's replay record: prompt, response, outcome, timing and scheduler joined. */
interface MicrotrainerRecord {
  readonly exercise: Exercise;
  readonly events: readonly unknown[];
  readonly final: Exercise;
  readonly attempt: ExerciseAttempt;
  readonly prompt: { readonly atMs: number, readonly target: string, readonly choices: readonly string[] };
  readonly commitment: Commitment | null;
  readonly resolution: Resolution | 'CENSORED';
  readonly latency: { readonly shownToPromptMs: number, readonly promptToCommitMs: number | null, readonly promptToResolutionMs: number | null };
  readonly scheduler: unknown;
  readonly provenance: {
    readonly sourceSessionId: string, readonly factIds: readonly string[], readonly artifactIds?: readonly string[],
    readonly split: string, readonly activityGateVersion?: unknown,
  };
  readonly grade: Grade;
}
/** The options every builder takes; each is checked before it is used. */
interface ExerciseOptions {
  readonly id?: string;
  readonly snapshot?: unknown;
  readonly target?: string;
  readonly choices?: readonly string[];
  readonly horizonMs?: number;
  readonly commitWindowMs?: number;
  readonly scheduler?: unknown;
  readonly commitment?: unknown;
}

const clone = <T>(value: T) => structuredClone(value);
class MicrotrainerIneligibleError extends Error {
  declare name: string;
  declare reason: string;
  constructor(reason: string) {
    super(`microtrainer exercise is ineligible: ${reason}`);
    this.name = 'MicrotrainerIneligibleError';
    this.reason = reason;
  }
}

const reject = (reason: string) => new MicrotrainerIneligibleError(reason);

function number(name: string, value: unknown, { min = 0, max = Infinity } = {}) {
  if (!finite(value) || value < min || value > max) fail(`${name} is outside its numeric bounds`);
  return value;
}

function integer(name: string, value: unknown) {
  if (!isInteger(value) || value < 0) fail(`${name} must be a non-negative integer`);
  return value;
}

function list(name: string, values: unknown, { min = 0, max = 128 } = {}) {
  if (!isList(values) || values.length < min || values.length > max ||
      values.some(value => typeof value !== 'string' || value.length === 0 || value.length > 160))
    fail(`${name} must contain ${min}-${max} bounded strings`);
  if (new Set(values).size !== values.length) fail(`${name} must contain unique strings`);
  // Every member was just checked to be a string.
  return values as readonly string[];
}

function clock(name: string, value: unknown) {
  if (!among(EXERCISE_CLOCKS, value)) fail(`${name} must be a declared monotonic clock`);
  return value;
}

function validateScheduler(input: unknown) {
  const value = object('scheduler', input);
  text('scheduler.policyId', value.policyId, 96);
  text('scheduler.policyVersion', value.policyVersion, 64);
  number('scheduler.selectionProbability', value.selectionProbability, { max: 1 });
  if (value.seed !== undefined && !Number.isInteger(value.seed) && typeof value.seed !== 'string')
    fail('scheduler.seed must be an integer or string');
  if (value.reason !== undefined) text('scheduler.reason', value.reason, 256);
  return value;
}

/** Validate the retained, pre-prompt source snapshot used by all exercise families. */
function validateReplaySnapshot(input: unknown): ReplaySnapshot {
  const value = object('snapshot', input);
  if (value.schema !== REPLAY_SNAPSHOT_SCHEMA) fail(`snapshot schema must be ${REPLAY_SNAPSHOT_SCHEMA}`);
  const allowed = new Set(['schema', 'id', 'sessionId', 'beliefSequence', 'clock', 'atMs',
    'profileId', 'activityGateVersion', 'factIds', 'stateFamily', 'split', 'artifactIds']);
  const extra = Object.keys(value).filter(key => !allowed.has(key));
  if (extra.length) fail(`snapshot contains unsupported runtime fields: ${extra.join(',')}`);
  text('snapshot.id', value.id);
  text('snapshot.sessionId', value.sessionId);
  integer('snapshot.beliefSequence', value.beliefSequence);
  clock('snapshot.clock', value.clock);
  number('snapshot.atMs', value.atMs);
  text('snapshot.profileId', value.profileId);
  text('snapshot.activityGateVersion', value.activityGateVersion, 96);
  list('snapshot.factIds', value.factIds, { min: 1 });
  text('snapshot.stateFamily', value.stateFamily, 96);
  if (!among(MICROTRAINER_SPLITS, value.split)) fail('snapshot.split is invalid');
  if (value.artifactIds !== undefined) list('snapshot.artifactIds', value.artifactIds);
  return freeze(clone(value) as unknown as ReplaySnapshot);
}

/** Construct a source snapshot without allowing a mutable belief/runtime object in it. */
export function makeReplaySnapshot(input: object) {
  return validateReplaySnapshot({ schema: REPLAY_SNAPSHOT_SCHEMA, ...clone(input) });
}

function validateChoices(choices: unknown, { requireUnknown = false } = {}) {
  const valid = list('question.choices', choices, { min: 2, max: 32 });
  if (requireUnknown && !valid.includes(UNKNOWN_CHOICE))
    fail(`question.choices must include ${UNKNOWN_CHOICE}`);
  return valid;
}

function validateResolutionForSource(resolution: unknown, snapshot: ReplaySnapshot, choices: readonly string[], revealDeadlineMs: number) {
  const value = validateResolution(resolution, choices);
  if (value.occurredAtMs < snapshot.atMs || value.occurredAtMs > revealDeadlineMs)
    fail('resolution is outside the replay horizon');
  if (value.evidenceFactIds.some(id => snapshot.factIds.includes(id)))
    fail('resolution evidence must be independent of the pre-prompt facts');
  return value;
}

function validateOptionalCommitment(commitment: unknown, snapshot: ReplaySnapshot, choices: readonly string[], commitDeadlineMs: number) {
  if (commitment === null || commitment === undefined) return null;
  const value = validateCommitment(commitment, choices);
  if (value.committedAtMs < snapshot.atMs || value.committedAtMs > commitDeadlineMs)
    fail('commitment is outside the response window');
  return value;
}

function validateEligibilitySource(snapshot: ReplaySnapshot, scheduler: unknown, extra: object = {}) {
  validateScheduler(scheduler);
  return {
    activityGateVersion: snapshot.activityGateVersion,
    profileId: snapshot.profileId,
    factIds: snapshot.factIds,
    sourceSessionId: snapshot.sessionId,
    sourceSnapshotId: snapshot.id,
    stateFamily: snapshot.stateFamily,
    split: snapshot.split,
    scheduler: clone(scheduler),
    ...clone(extra),
  };
}

function baseExercise({ id, kind, snapshot, target, choices, questionHorizonMs,
  commitWindowMs, revealHorizonMs, scheduler, extraEligibility = {}, commitment = null,
  resolution = null, cancellation = null }: {
    id: unknown, kind: string, snapshot: ReplaySnapshot, target: unknown, choices: unknown, questionHorizonMs: unknown,
    commitWindowMs: unknown, revealHorizonMs: unknown, scheduler: unknown, extraEligibility?: object, commitment?: unknown,
    resolution?: unknown, cancellation?: unknown,
  }) {
  text('exercise.id', id);
  const questionChoices = validateChoices(choices);
  number('question.horizonMs', questionHorizonMs, { min: Number.MIN_VALUE });
  const commitWindow = number('commitWindowMs', commitWindowMs, { min: Number.MIN_VALUE });
  const revealHorizon = number('revealHorizonMs', revealHorizonMs, { min: commitWindow });
  const promptAtMs = snapshot.atMs;
  const commitDeadlineMs = promptAtMs + commitWindow;
  const revealDeadlineMs = promptAtMs + revealHorizon;
  const initial = makeExercise({
    id, kind, sourceSessionId: snapshot.sessionId, beliefSequence: snapshot.beliefSequence,
    clock: snapshot.clock, createdAtMs: promptAtMs, promptAtMs, commitDeadlineMs,
    revealDeadlineMs,
    eligibility: validateEligibilitySource(snapshot, scheduler, extraEligibility),
    question: { target: text('question.target', target, 128), choices: questionChoices, horizonMs: questionHorizonMs },
  });
  const events: Fields[] = [{
    schema: EXERCISE_EVENT_SCHEMA, exerciseId: initial.id, seq: 0,
    type: 'PROMPTED', atMs: promptAtMs, clock: snapshot.clock,
  }];
  const validCommitment = validateOptionalCommitment(commitment, snapshot, questionChoices, commitDeadlineMs);
  if (validCommitment) events.push({
    schema: EXERCISE_EVENT_SCHEMA, exerciseId: initial.id, seq: events.length,
    type: 'COMMITTED', atMs: validCommitment.committedAtMs, clock: snapshot.clock,
    commitment: validCommitment,
  });
  if (resolution !== null && resolution !== undefined) {
    const validResolution = validateResolutionForSource(resolution, snapshot, questionChoices, revealDeadlineMs);
    events.push({
      schema: EXERCISE_EVENT_SCHEMA, exerciseId: initial.id, seq: events.length,
      type: 'RESOLVED', atMs: validResolution.occurredAtMs, clock: snapshot.clock,
      resolution: validResolution,
    });
  }
  if (cancellation !== null && cancellation !== undefined) {
    if (resolution !== null && resolution !== undefined) fail('an exercise cannot resolve and cancel in the same replay');
    const validCancellation = clone(cancellation);
    if (!isRecord(validCancellation) || validCancellation.schema !== 'exercise-cancellation-v1')
      fail('cancellation schema is invalid');
    // Compared as JavaScript compares: a field that is not a number is converted to one.
    if (Number(validCancellation.atMs) < promptAtMs || Number(validCancellation.atMs) > revealDeadlineMs)
      fail('cancellation is outside the replay horizon');
    events.push({
      schema: EXERCISE_EVENT_SCHEMA, exerciseId: initial.id, seq: events.length,
      type: 'CANCELLED', atMs: validCancellation.atMs, clock: snapshot.clock,
      cancellation: validCancellation,
    });
  }
  const replay = events.length === 1 ? initial : replayExercise(initial, events);
  return freeze(clone({ exercise: initial, events, replay }));
}

function independentEvidence(value: unknown, snapshot: ReplaySnapshot) {
  // A value that is not an object has no evidence ids.
  const ids = list('resolution.evidenceFactIds', isRecord(value) ? value.evidenceFactIds : undefined, { min: 1 });
  if (ids.some(id => snapshot.factIds.includes(id)))
    fail('resolution evidence must be independent of the pre-prompt facts');
}

/** Build a prediction exercise from a retained future fact, never from the prediction itself. */
export function makePredictionExercise({ id, snapshot: snapshotInput, target, choices, horizonMs,
  commitWindowMs = horizonMs, scheduler, futureFact = null, commitment = null }: ExerciseOptions & { futureFact?: unknown } = {}) {
  const snapshot = validateReplaySnapshot(snapshotInput);
  const resolution = futureFact ? clone(futureFact) : null;
  if (resolution) independentEvidence(resolution, snapshot);
  return baseExercise({
    id, kind: 'prediction', snapshot, target, choices, questionHorizonMs: horizonMs,
    commitWindowMs, revealHorizonMs: horizonMs, scheduler,
    extraEligibility: { family: 'prediction' }, commitment, resolution,
  });
}

function validateCrop(input: unknown, snapshot: ReplaySnapshot): RetainedCrop {
  const value = object('crop', input);
  if (value.schema !== RETAINED_CROP_SCHEMA) fail(`crop schema must be ${RETAINED_CROP_SCHEMA}`);
  const allowed = new Set(['schema', 'id', 'artifactId', 'sha256', 'factId', 'sessionId',
    'profileId', 'retained', 'split', 'label', 'labelProvenance']);
  const extra = Object.keys(value).filter(key => !allowed.has(key));
  if (extra.length) fail(`crop contains raw media fields: ${extra.join(',')}`);
  text('crop.id', value.id);
  text('crop.artifactId', value.artifactId);
  text('crop.sha256', value.sha256, 128);
  text('crop.factId', value.factId);
  text('crop.sessionId', value.sessionId);
  text('crop.profileId', value.profileId);
  if (value.profileId !== snapshot.profileId) throw reject('recognition-profile-mismatch');
  if (value.retained !== true) throw reject('recognition-crop-not-retained');
  if (!among(['calibration', 'holdout', 'practice', 'replay'], value.split))
    fail('crop.split is invalid');
  text('crop.label', value.label, 96);
  if (value.label === UNKNOWN_CHOICE) fail('a retained crop label must be distinct from UNKNOWN');
  if (value.labelProvenance !== undefined) object('crop.labelProvenance', value.labelProvenance);
  return value as unknown as RetainedCrop;
}

/** Build recognition only from retained, profile-bound labels and always expose abstention. */
export function makeRecognitionExercise({ id, snapshot: snapshotInput, crop: cropInput, choices,
  horizonMs = 1000, commitWindowMs = horizonMs, scheduler, commitment = null }: ExerciseOptions & { crop?: unknown } = {}) {
  const snapshot = validateReplaySnapshot(snapshotInput);
  const crop = validateCrop(cropInput, snapshot);
  const questionChoices = [...new Set([...(choices || []), crop.label, UNKNOWN_CHOICE])];
  // Math.max converts its arguments to numbers; a commitment that is not an object has no time.
  const committedAtMs = isRecord(commitment) ? commitment.committedAtMs : undefined;
  const resolutionAtMs = Math.max(snapshot.atMs + 1, Number(committedAtMs ?? snapshot.atMs + 1));
  const resolution = {
    schema: 'resolution-v1', outcome: crop.label, occurredAtMs: resolutionAtMs,
    evidenceFactIds: [crop.factId],
  };
  const result = baseExercise({
    id, kind: 'recognition', snapshot, target: crop.id, choices: questionChoices,
    questionHorizonMs: horizonMs, commitWindowMs, revealHorizonMs: horizonMs,
    scheduler,
    extraEligibility: {
      family: 'recognition',
      sourceArtifactIds: [...new Set([crop.artifactId, ...(snapshot.artifactIds ?? [])])],
      sourceCrop: {
        schema: RETAINED_CROP_SCHEMA, artifactId: crop.artifactId, sha256: crop.sha256,
        factId: crop.factId, sessionId: crop.sessionId, profileId: crop.profileId,
        split: crop.split, labelProvenance: crop.labelProvenance ?? 'retained-label',
      },
    },
    commitment, resolution,
  });
  return result;
}

function validateTimingBuckets(input: unknown) {
  const value = object('timingBuckets', input);
  if (value.schema !== TIMING_BUCKET_SCHEMA) fail(`timing bucket schema must be ${TIMING_BUCKET_SCHEMA}`);
  const buckets = value.buckets;
  if (!isList(buckets) || buckets.length < 2 || buckets.length > 16)
    fail('timingBuckets.buckets must contain 2-16 buckets');
  const ids = new Set();
  let previousMax: number | null = null;
  for (const [index, item] of buckets.entries()) {
    const bucket = object(`timingBuckets.buckets[${index}]`, item);
    text(`timingBuckets.buckets[${index}].id`, bucket.id, 64);
    if (ids.has(bucket.id)) fail('timing bucket ids must be unique');
    ids.add(bucket.id);
    const minMs = bucket.minMs === null ? null : number(`timing bucket ${bucket.id}.minMs`, bucket.minMs, { min: -Infinity });
    const maxMs = bucket.maxMs === null ? null : number(`timing bucket ${bucket.id}.maxMs`, bucket.maxMs, { min: -Infinity });
    if (minMs === null && index !== 0) fail('only the first timing bucket may be unbounded below');
    if (maxMs === null && index !== buckets.length - 1) fail('only the last timing bucket may be unbounded above');
    if (minMs !== null && maxMs !== null && maxMs <= minMs)
      fail(`timing bucket ${bucket.id} is empty`);
    if (previousMax !== null && minMs !== previousMax)
      fail('timing bucket boundaries must be contiguous');
    previousMax = maxMs;
  }
  // Every bucket was checked above.
  const checked = value as unknown as TimingBuckets;
  if (checked.buckets[0].minMs !== null || (checked.buckets.at(-1) as TimingBucket).maxMs !== null)
    fail('timing buckets must cover the full numeric range');
  return checked;
}

function timingBucketFor(value: number, buckets: readonly TimingBucket[]) {
  return buckets.find(bucket => (bucket.minMs === null || value >= bucket.minMs) &&
    (bucket.maxMs === null || value < bucket.maxMs))?.id ?? null;
}

/** Build a coarse timing exercise and refuse deadlines already inside the measured response budget. */
export function makeTimingExercise({ id, snapshot: snapshotInput, target, deadlineAtMs,
  responseLatencyBudgetMs, timingBuckets, observedActionAtMs = null, evidenceFactIds = null,
  scheduler, commitment = null }: ExerciseOptions & {
    deadlineAtMs?: number, responseLatencyBudgetMs?: number, timingBuckets?: unknown,
    observedActionAtMs?: number | null, evidenceFactIds?: readonly string[] | null,
  } = {}) {
  const snapshot = validateReplaySnapshot(snapshotInput);
  const deadline = number('deadlineAtMs', deadlineAtMs, { min: snapshot.atMs });
  const budget = number('responseLatencyBudgetMs', responseLatencyBudgetMs);
  const bucketSpec = validateTimingBuckets(timingBuckets);
  const questionHorizonMs = deadline - snapshot.atMs;
  if (questionHorizonMs <= budget)
    throw reject('timing-deadline-inside-response-budget');
  let futureFact = null;
  let revealHorizonMs = questionHorizonMs;
  if (observedActionAtMs !== null && observedActionAtMs !== undefined) {
    const observed = number('observedActionAtMs', observedActionAtMs, { min: snapshot.atMs });
    const remainingMs = deadline - observed;
    const outcome = timingBucketFor(remainingMs, bucketSpec.buckets);
    if (!outcome) fail('observed timing does not fit a declared bucket');
    list('evidenceFactIds', evidenceFactIds, { min: 1 });
    futureFact = {
      schema: 'resolution-v1', outcome, occurredAtMs: observed,
      evidenceFactIds: clone(evidenceFactIds),
    };
    independentEvidence(futureFact, snapshot);
    // Late actions remain resolvable, but only within a declared evidence window.
    revealHorizonMs = Math.max(questionHorizonMs, observed - snapshot.atMs) + 1;
  }
  return baseExercise({
    id, kind: 'timing', snapshot, target,
    choices: bucketSpec.buckets.map(bucket => bucket.id), questionHorizonMs,
    commitWindowMs: questionHorizonMs, revealHorizonMs, scheduler,
    extraEligibility: {
      family: 'timing', deadlineAtMs, responseLatencyBudgetMs,
      timingBuckets: clone(bucketSpec),
    }, commitment, resolution: futureFact,
  });
}

function validateSimulatorCase(input: unknown, snapshot: ReplaySnapshot): SimulatorCase {
  const value = object('simulatorCase', input);
  if (value.schema !== EXACT_SIMULATOR_CASE_SCHEMA)
    fail(`simulatorCase schema must be ${EXACT_SIMULATOR_CASE_SCHEMA}`);
  text('simulatorCase.id', value.id);
  text('simulatorCase.version', value.version, 64);
  text('simulatorCase.engineHash', value.engineHash, 128);
  if (value.authority !== 'exact-simulator') throw reject('strategy-case-not-exact-simulator');
  if (value.modelLabel !== 'MODEL_ONLY') throw reject('strategy-case-not-model-only');
  const provenance = object('simulatorCase.provenance', value.provenance);
  text('simulatorCase.provenance.source', provenance.source, 128);
  const factIds = list('simulatorCase.provenance.factIds', provenance.factIds, { min: 1 });
  if (factIds.some(id => snapshot.factIds.includes(id)))
    fail('strategy evidence must be independent of the pre-prompt facts');
  return value as unknown as SimulatorCase;
}

/** Build strategy only from an exact-simulator result with visible MODEL_ONLY provenance. */
export function makeStrategyExercise({ id, snapshot: snapshotInput, target, choices, horizonMs,
  simulatorCase, result, scheduler, commitment = null }: ExerciseOptions & { simulatorCase?: unknown, result?: unknown } = {}) {
  const snapshot = validateReplaySnapshot(snapshotInput);
  const exactCase = validateSimulatorCase(simulatorCase, snapshot);
  const outcome = object('simulatorCase.result', result);
  const resolution = validateResolution({
    schema: 'resolution-v1', outcome: outcome.outcome, occurredAtMs: outcome.occurredAtMs,
    evidenceFactIds: outcome.evidenceFactIds,
  }, choices);
  // An absent horizon makes this NaN, and baseExercise refuses it below.
  if (resolution.occurredAtMs < snapshot.atMs || resolution.occurredAtMs > snapshot.atMs + (horizonMs as number))
    fail('strategy result is outside the replay horizon');
  independentEvidence(resolution, snapshot);
  return baseExercise({
    id, kind: 'strategy', snapshot, target, choices,
    questionHorizonMs: horizonMs, commitWindowMs: horizonMs, revealHorizonMs: horizonMs,
    scheduler,
    extraEligibility: {
      family: 'strategy', modelLabel: 'MODEL_ONLY',
      simulatorCase: {
        schema: EXACT_SIMULATOR_CASE_SCHEMA, id: exactCase.id, version: exactCase.version,
        engineHash: exactCase.engineHash, authority: exactCase.authority,
        modelLabel: exactCase.modelLabel, provenance: clone(exactCase.provenance),
      },
    }, commitment, resolution,
  });
}

/** Create a presentation/response attempt, keeping it separate from exercise truth. */
export function makeMicrotrainerAttempt({ exercise, rendererId, rendererVersion,
  sessionId, shownAtMs, commitment = null, motor = null }: {
    exercise?: unknown, rendererId?: string, rendererVersion?: string, sessionId?: string, shownAtMs?: number,
    commitment?: unknown, motor?: unknown,
  } = {}) {
  const value = validateExercise(exercise);
  text('rendererId', rendererId, 96);
  text('rendererVersion', rendererVersion, 64);
  text('attempt.sessionId', sessionId);
  clock('attempt.clock', value.clock);
  const shown = number('shownAtMs', shownAtMs);
  if (shown > value.promptAtMs) fail('attempt was shown after the exercise prompt');
  const validCommitment = commitment === null ? null : validateCommitment(commitment, value.question.choices);
  if (validCommitment && (validCommitment.committedAtMs < value.promptAtMs ||
      validCommitment.committedAtMs > value.commitDeadlineMs))
    fail('attempt commitment is outside the exercise deadline');
  return validateExerciseAttempt({
    schema: EXERCISE_ATTEMPT_SCHEMA, exerciseId: value.id, rendererId, rendererVersion,
    sessionId, clock: value.clock, shownAtMs, commitment: validCommitment,
    resolutionDisposition: value.disposition, motor: motor === null ? null : clone(motor), score: null,
  });
}

/** Grade only a completed, independently resolved exercise; every other case is censored. */
export function gradeMicrotrainerAttempt(exercise: unknown, attempt: unknown) {
  const value = validateExercise(exercise);
  const response = validateExerciseAttempt(attempt);
  if (response.exerciseId !== value.id) fail('attempt targets another exercise');
  if (response.resolutionDisposition !== value.disposition) fail('attempt disposition disagrees with replay');
  if (value.disposition !== 'COMPLETED' || value.resolution === 'CENSORED' ||
      value.commitment === null || response.commitment === null) {
    return freeze({ status: 'CENSORED' as const, reason: value.commitment === null ? 'missing-commitment' : 'non-completed-exercise', score: null });
  }
  if (response.commitment.choice !== value.commitment.choice ||
      response.commitment.committedAtMs !== value.commitment.committedAtMs)
    fail('attempt commitment disagrees with exercise replay');
  const correct = response.commitment.choice === value.resolution.outcome;
  return freeze({
    status: 'SCORED' as const, correct, score: { [value.kind]: correct ? 1 : 0 },
    denominator: 1, outcome: value.resolution.outcome,
  });
}

function eventForRecord(record: MicrotrainerRecord, type: string, atMs: number, data: object) {
  return {
    schema: MICROTRAINER_EVENT_SCHEMA, sessionId: record.attempt.sessionId,
    exerciseId: record.exercise.id, seq: 0, type, clock: record.exercise.clock,
    atMs, source: {
      sourceSessionId: record.exercise.sourceSessionId,
      factIds: clone(record.exercise.eligibility.factIds),
      artifactIds: clone(record.exercise.eligibility.sourceArtifactIds ?? []),
    }, data: clone(data),
  };
}

function validateLatency(input: unknown, record: { final: Exercise, attempt: ExerciseAttempt }) {
  const latency = object('record.latency', input);
  for (const name of ['shownToPromptMs', 'promptToCommitMs', 'promptToResolutionMs']) {
    if (latency[name] !== null) number(`record.latency.${name}`, latency[name]);
  }
  const expectedShown = record.final.promptAtMs - record.attempt.shownAtMs;
  const expectedCommit = record.final.commitment === null ? null :
    record.final.commitment.committedAtMs - record.final.promptAtMs;
  const expectedResolution = record.final.resolution === 'CENSORED' ? null :
    record.final.resolution.occurredAtMs - record.final.promptAtMs;
  if (latency.shownToPromptMs !== expectedShown || latency.promptToCommitMs !== expectedCommit ||
      latency.promptToResolutionMs !== expectedResolution)
    fail('record latency does not match its declared timestamps');
  return latency;
}

function validateRecord(input: unknown): MicrotrainerRecord {
  const record = object('record', input);
  const exercise = validateExercise(record.exercise);
  const events = record.events;
  if (!isList(events) || events.length === 0) fail('record.events are required');
  const final = replayExercise(exercise, events);
  if (stableHash(final) !== stableHash(record.final)) fail('record.final does not match replayed events');
  const attempt = validateExerciseAttempt(record.attempt);
  const grade = gradeMicrotrainerAttempt(final, attempt);
  if (stableHash(record.grade) !== stableHash(grade)) fail('record.grade does not match replay');
  validateScheduler(record.scheduler);
  if (stableHash(record.scheduler) !== stableHash(final.eligibility.scheduler))
    fail('record scheduler does not match exercise eligibility');
  // record.attempt was just validated as an attempt, so it is an object.
  if (attempt.sessionId !== (record.attempt as Fields).sessionId) fail('record attempt identity is inconsistent');
  const prompt = object('record.prompt', record.prompt);
  if (prompt.atMs !== final.promptAtMs || prompt.target !== final.question.target ||
      stableHash(prompt.choices) !== stableHash(final.question.choices))
    fail('record.prompt does not match the frozen exercise');
  if (record.commitment !== null && stableHash(record.commitment) !== stableHash(final.commitment))
    fail('record.commitment does not match replay');
  if (record.resolution !== final.resolution && stableHash(record.resolution) !== stableHash(final.resolution))
    fail('record.resolution does not match replay');
  const provenance = object('record.provenance', record.provenance);
  text('record.provenance.sourceSessionId', provenance.sourceSessionId);
  list('record.provenance.factIds', provenance.factIds, { min: 1 });
  if (provenance.artifactIds !== undefined)
    list('record.provenance.artifactIds', provenance.artifactIds);
  if (provenance.sourceSessionId !== final.sourceSessionId ||
      stableHash(provenance.factIds) !== stableHash(final.eligibility.factIds))
    fail('record provenance does not match the exercise source');
  if (!among(MICROTRAINER_SPLITS, provenance.split)) fail('record.provenance.split is invalid');
  validateLatency(record.latency, { final, attempt });
  // Every field was checked above, against the replay it records.
  return { ...record, exercise, final, attempt, grade } as unknown as MicrotrainerRecord;
}

/** Make one Plan 09-compatible replay record with prompt, response, outcome, timing, and scheduler joins. */
export function makeMicrotrainerRecord({ exercise, events, attempt, scheduler = null }: { exercise?: unknown, events?: unknown, attempt?: unknown, scheduler?: unknown } = {}) {
  const value = validateExercise(exercise);
  const final = replayExercise(value, events);
  const response = validateExerciseAttempt(attempt);
  if (response.exerciseId !== value.id) fail('attempt targets another exercise');
  const selectedScheduler = scheduler ?? value.eligibility.scheduler;
  validateScheduler(selectedScheduler);
  const grade = gradeMicrotrainerAttempt(final, response);
  const record = {
    exercise: value, events: clone(events), final,
    attempt: response,
    prompt: { atMs: final.promptAtMs, target: final.question.target, choices: clone(final.question.choices) },
    commitment: final.commitment,
    resolution: final.resolution,
    latency: {
      shownToPromptMs: final.promptAtMs - response.shownAtMs,
      promptToCommitMs: final.commitment === null ? null : final.commitment.committedAtMs - final.promptAtMs,
      promptToResolutionMs: final.resolution === 'CENSORED' ? null : final.resolution.occurredAtMs - final.promptAtMs,
    },
    scheduler: clone(selectedScheduler),
    provenance: {
      sourceSessionId: final.sourceSessionId,
      factIds: clone(final.eligibility.factIds),
      artifactIds: clone(final.eligibility.sourceArtifactIds ?? []),
      split: final.eligibility.split,
      activityGateVersion: final.eligibility.activityGateVersion,
    },
    grade,
  };
  return freeze(clone(validateRecord(record)));
}

function validateSessionHeader(input: unknown) {
  const session = object('session', input);
  text('session.sessionId', session.sessionId);
  text('session.sourceSessionId', session.sourceSessionId);
  clock('session.clock', session.clock);
  const startedAtMs = number('session.startedAtMs', session.startedAtMs);
  number('session.endedAtMs', session.endedAtMs, { min: startedAtMs });
  text('session.profileId', session.profileId);
  if (!among(MICROTRAINER_SURFACES, session.surface)) fail('session.surface is invalid');
  if (!among(MICROTRAINER_SPLITS, session.split)) fail('session.split is invalid');
  return session as unknown as SessionHeader;
}

/** Validate and freeze the complete offline session artifact. */
function validateMicrotrainerSession(input: unknown) {
  const value = object('session record', input);
  if (value.schema !== MICROTRAINER_SESSION_SCHEMA)
    fail(`session schema must be ${MICROTRAINER_SESSION_SCHEMA}`);
  if (value.version !== 1) fail('session version is unsupported');
  const session = validateSessionHeader(value.session);
  const recordsIn = value.records, artifacts = value.artifacts;
  if (!isList(recordsIn)) fail('session.records are required');
  if (!isList(artifacts)) fail('session.artifacts are required');
  for (const [index, item] of artifacts.entries()) {
    const artifact = object(`session.artifacts[${index}]`, item);
    text(`session.artifacts[${index}].artifactId`, artifact.artifactId);
    text(`session.artifacts[${index}].sha256`, artifact.sha256, 128);
    text(`session.artifacts[${index}].mediaType`, artifact.mediaType, 96);
    text(`session.artifacts[${index}].role`, artifact.role, 96);
    if (artifact.size !== undefined) number(`session.artifacts[${index}].size`, artifact.size);
  }
  const records = recordsIn.map(record => validateRecord(record));
  let previousAt = -Infinity;
  for (const [index, record] of records.entries()) {
    if (record.final.clock !== session.clock) fail(`record ${index} clock does not match session`);
    if (record.final.promptAtMs < session.startedAtMs || record.final.promptAtMs > session.endedAtMs)
      fail(`record ${index} prompt is outside session bounds`);
    const last = record.final.resolution === 'CENSORED'
      ? record.final.cancellation?.atMs ?? record.final.promptAtMs
      : record.final.resolution.occurredAtMs;
    if (last > session.endedAtMs) fail(`record ${index} terminal event is outside session bounds`);
    if (last < previousAt) fail('session records are not ordered');
    previousAt = last;
    if (record.provenance.split !== session.split && session.split !== 'replay')
      fail(`record ${index} split does not match session`);
    if (record.final.eligibility.profileId !== session.profileId)
      fail(`record ${index} profile does not match session`);
    if (record.final.sourceSessionId !== session.sourceSessionId)
      fail(`record ${index} source session does not match session`);
  }
  // Each artifact was checked to be an object above.
  const artifactIds = new Set(artifacts.map(artifact => (artifact as Fields).artifactId));
  for (const [index, record] of records.entries()) {
    if (record.attempt.sessionId !== session.sessionId)
      fail(`record ${index} attempt does not belong to the session`);
    for (const artifactId of record.provenance.artifactIds ?? []) {
      if (!artifactIds.has(artifactId)) fail(`record ${index} references an unretained artifact`);
    }
  }
  const events = value.events;
  if (!isList(events)) fail('session.events are required');
  const expectedEvents = sessionEvents(records);
  if (stableHash(events) !== stableHash(expectedEvents))
    fail('session.events do not match the replay records');
  let previousEventAt = -Infinity;
  for (const [index, item] of events.entries()) {
    const event = object(`session.events[${index}]`, item);
    if (event.schema !== MICROTRAINER_EVENT_SCHEMA) fail(`session event ${index} schema mismatch`);
    text(`session.events[${index}].sessionId`, event.sessionId);
    if (event.sessionId !== session.sessionId) fail(`session event ${index} targets another session`);
    integer(`session.events[${index}].seq`, event.seq);
    if (event.seq !== index) fail(`session event ${index} sequence is not contiguous`);
    clock(`session.events[${index}].clock`, event.clock);
    if (event.clock !== session.clock) fail(`session event ${index} clock does not match session`);
    const atMs = number(`session.events[${index}].atMs`, event.atMs);
    if (atMs < previousEventAt) fail('session events are not ordered');
    previousEventAt = atMs;
  }
  // Every record was replayed above, and every field of the header checked.
  return freeze(clone(value) as unknown as { readonly session: SessionHeader, readonly records: readonly MicrotrainerRecord[], readonly [field: string]: unknown });
}

/** Emit one ordered event stream from the validated per-exercise records. */
function sessionEvents(records: readonly MicrotrainerRecord[]) {
  const events: ReturnType<typeof eventForRecord>[] = [];
  for (const record of records) {
    events.push(eventForRecord(record, 'PROMPTED', record.final.promptAtMs, {
      target: record.final.question.target, choices: record.final.question.choices,
      scheduler: record.scheduler,
    }));
    if (record.final.commitment) events.push(eventForRecord(record, 'COMMITTED',
      record.final.commitment.committedAtMs, { commitment: record.final.commitment }));
    if (record.final.resolution !== 'CENSORED') events.push(eventForRecord(record, 'RESOLVED',
      record.final.resolution.occurredAtMs, { resolution: record.final.resolution }));
    else if (record.final.cancellation) events.push(eventForRecord(record, 'CENSORED',
      record.final.cancellation.atMs, { cancellation: record.final.cancellation }));
  }
  return events.sort((a, b) => a.atMs - b.atMs || a.exerciseId.localeCompare(b.exerciseId))
    .map((event, seq) => ({ ...event, seq }));
}

/** Build an immutable Plan 09-compatible session record; no raw media is embedded. */
export function makeMicrotrainerSession({ session, records = [], artifacts = [] }: { session?: unknown, records?: unknown, artifacts?: unknown } = {}) {
  const header = validateSessionHeader(session);
  if (!isList(records)) fail('records must be an array');
  const validatedRecords = records.map(record => validateRecord(record));
  const value = {
    schema: MICROTRAINER_SESSION_SCHEMA, version: 1, session: clone(header),
    artifacts: clone(artifacts), records: validatedRecords, events: sessionEvents(validatedRecords),
  };
  return validateMicrotrainerSession(value);
}

/** Replay every record in a session and return the same semantic grades. */
export function replayMicrotrainerSession(input: unknown) {
  const session = validateMicrotrainerSession(input);
  return freeze(clone(session.records.map(record => ({
    exerciseId: record.exercise.id,
    final: replayExercise(record.exercise, record.events),
    grade: gradeMicrotrainerAttempt(record.final, record.attempt),
  }))));
}
