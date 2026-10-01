// Replayable adaptive-coach contracts for Plan 24 package 1.
//
// An exercise freezes a question at prompt time. A later resolution is an
// independently evidenced outcome; the player's commitment is separate from
// that outcome. Ambiguous, interrupted, stale, or missing evidence is
// explicitly censored and can never be scored as an incorrect answer.

import { among, isInteger, isList } from '../validate.ts';

export const EXERCISE_SCHEMA = 'exercise-v1';
export const COMMITMENT_SCHEMA = 'commitment-v1';
export const RESOLUTION_SCHEMA = 'resolution-v1';
export const CANCELLATION_SCHEMA = 'exercise-cancellation-v1';
export const EXERCISE_EVENT_SCHEMA = 'exercise-event-v1';
export const EXERCISE_ATTEMPT_SCHEMA = 'exercise-attempt-v1';

export const EXERCISE_KINDS = Object.freeze([
  'prediction', 'recognition', 'timing', 'strategy',
]);
export const EXERCISE_DISPOSITIONS = Object.freeze([
  'COMPLETED', 'CANCELLED', 'EXPIRED', 'UNRESOLVED',
]);
export const CANCELLATION_REASONS = Object.freeze([
  'critical-cue', 'capture-loss', 'belief-conflict', 'stale-sensor',
  'target-interrupted', 'session-ended', 'renderer-lost', 'activity-gate',
  'ambiguous-outcome', 'commit-deadline', 'resolution-deadline', 'manual-abort',
]);
export const EXERCISE_EVENT_TYPES = Object.freeze([
  'PROMPTED', 'COMMITTED', 'RESOLVED', 'CANCELLED', 'EXPIRED',
]);
export const EXERCISE_CLOCKS = Object.freeze([
  'host-monotonic-ms', 'device-monotonic-ms',
]);

/** The question an exercise freezes at prompt time. */
interface ExerciseQuestion {
  readonly target: string;
  readonly choices: readonly string[];
  readonly horizonMs: number;
  readonly [field: string]: unknown;
}
/** Why the exercise could be asked: the gate, the profile and the facts behind it. */
interface ExerciseEligibility {
  readonly activityGateVersion: string;
  readonly profileId: string;
  readonly factIds: readonly string[];
  readonly [field: string]: unknown;
}
/** The player's answer. Its choice is checked against the frozen choices where a caller passes them. */
export interface Commitment {
  readonly schema: typeof COMMITMENT_SCHEMA;
  readonly choice: unknown;
  readonly committedAtMs: number;
  readonly responsePort: string;
}
/** An independently evidenced outcome. */
export interface Resolution {
  readonly schema: typeof RESOLUTION_SCHEMA;
  readonly outcome: unknown;
  readonly occurredAtMs: number;
  readonly evidenceFactIds: readonly string[];
}
interface Cancellation {
  readonly schema: typeof CANCELLATION_SCHEMA;
  readonly reason: string;
  readonly atMs: number;
  readonly detail?: string;
}
export interface Exercise {
  readonly schema: typeof EXERCISE_SCHEMA;
  readonly id: string;
  readonly kind: string;
  readonly sourceSessionId: string;
  readonly beliefSequence: number;
  readonly clock: string;
  readonly createdAtMs: number;
  readonly promptAtMs: number;
  readonly commitDeadlineMs: number;
  readonly revealDeadlineMs: number;
  readonly eligibility: ExerciseEligibility;
  readonly question: ExerciseQuestion;
  readonly disposition: string;
  readonly commitment: Commitment | null;
  readonly resolution: Resolution | 'CENSORED';
  readonly cancellation: Cancellation | null;
}
interface EventBase {
  readonly schema: typeof EXERCISE_EVENT_SCHEMA;
  readonly exerciseId: string;
  readonly seq: number;
  readonly atMs: number;
  readonly clock?: string;
}
/** One replay event; each type carries what it records. */
type ExerciseEvent = EventBase & (
  | { readonly type: 'PROMPTED' }
  | { readonly type: 'COMMITTED', readonly commitment: Commitment }
  | { readonly type: 'RESOLVED', readonly resolution: Resolution }
  | { readonly type: 'CANCELLED', readonly cancellation: Cancellation }
  | { readonly type: 'EXPIRED', readonly reason?: string });
/** How the response was made, kept apart from whether it was right. */
interface Motor { readonly inputEvents: number, readonly pathLength?: number, readonly timingErrorMs?: number }
/** A presentation of an exercise and the response to it, kept beside the exercise record. */
export interface ExerciseAttempt {
  readonly schema: typeof EXERCISE_ATTEMPT_SCHEMA;
  readonly exerciseId: string;
  readonly rendererId: string;
  readonly rendererVersion: string;
  readonly sessionId: string;
  readonly clock: string;
  readonly shownAtMs: number;
  readonly commitment: Commitment | null;
  readonly resolutionDisposition: string;
  readonly motor: Motor | null;
  readonly score: Readonly<Record<string, number>> | null;
}
/** An exercise while replay writes its outcome. */
type Draft = { -readonly [K in keyof Exercise]: Exercise[K] };

const clone = <T>(value: T) => structuredClone(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function object(name: string, value: unknown): asserts value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`exercise: ${name} must be an object`);
}
function string(name: string, value: unknown, max = 160): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    throw new TypeError(`exercise: ${name} must be a non-empty bounded string`);
}
function time(name: string, value: unknown): asserts value is number {
  if (!finite(value) || value < 0)
    throw new TypeError(`exercise: ${name} must be finite and non-negative`);
}
function integer(name: string, value: unknown): asserts value is number {
  if (!isInteger(value) || value < 0)
    throw new TypeError(`exercise: ${name} must be a non-negative integer`);
}
function uniqueStrings(name: string, values: unknown, { min = 0, max = 128 } = {}): asserts values is readonly string[] {
  if (!isList(values) || values.length < min || values.length > max ||
      values.some(value => typeof value !== 'string' || value.length === 0 || value.length > 160))
    throw new TypeError(`exercise: ${name} must contain ${min}-${max} bounded strings`);
  if (new Set(values).size !== values.length)
    throw new TypeError(`exercise: ${name} must contain unique strings`);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function boundedFraction(name: string, value: unknown) {
  if (!finite(value) || value < 0 || value > 1)
    throw new TypeError(`exercise: ${name} must be between 0 and 1`);
}

function validateQuestion(question: unknown): asserts question is ExerciseQuestion {
  object('question', question);
  string('question.target', question.target, 128);
  uniqueStrings('question.choices', question.choices, { min: 2, max: 32 });
  if (!finite(question.horizonMs) || question.horizonMs <= 0)
    throw new TypeError('exercise: question.horizonMs must be positive');
}

function validateEligibility(eligibility: unknown): asserts eligibility is ExerciseEligibility {
  object('eligibility', eligibility);
  string('eligibility.activityGateVersion', eligibility.activityGateVersion, 96);
  string('eligibility.profileId', eligibility.profileId, 160);
  uniqueStrings('eligibility.factIds', eligibility.factIds, { min: 1, max: 128 });
}

function checkCommitment(input: unknown, choices?: unknown, { label = 'commitment' } = {}): asserts input is Commitment {
  object(label, input);
  if (input.schema !== COMMITMENT_SCHEMA)
    throw new TypeError(`exercise: ${label} schema mismatch`);
  if (isList(choices) && !choices.includes(input.choice))
    throw new TypeError(`exercise: ${label}.choice is not one of the frozen choices`);
  time(`${label}.committedAtMs`, input.committedAtMs);
  string(`${label}.responsePort`, input.responsePort, 96);
}

function checkResolution(input: unknown, choices: unknown, { label = 'resolution' } = {}): asserts input is Resolution {
  object(label, input);
  if (input.schema !== RESOLUTION_SCHEMA)
    throw new TypeError(`exercise: ${label} schema mismatch`);
  if (isList(choices) && !choices.includes(input.outcome) && input.outcome !== 'none-in-horizon')
    throw new TypeError(`exercise: ${label}.outcome is not a declared competing outcome`);
  time(`${label}.occurredAtMs`, input.occurredAtMs);
  uniqueStrings(`${label}.evidenceFactIds`, input.evidenceFactIds, { min: 1, max: 128 });
}

function checkCancellation(input: unknown, { label = 'cancellation' } = {}): asserts input is Cancellation {
  object(label, input);
  if (input.schema !== CANCELLATION_SCHEMA)
    throw new TypeError(`exercise: ${label} schema mismatch`);
  if (!among(CANCELLATION_REASONS, input.reason))
    throw new TypeError(`exercise: ${label}.reason is not declared`);
  time(`${label}.atMs`, input.atMs);
  if (input.detail !== undefined) string(`${label}.detail`, input.detail, 256);
}

/** Validate the nested commitment contract and return its frozen copy. */
export function validateCommitment(input: unknown, choices: readonly unknown[] | null = null) {
  checkCommitment(input, choices);
  return deepFreeze(clone(input));
}

/** Validate an independently evidenced outcome, without player state. */
export function validateResolution(input: unknown, choices: readonly unknown[] | null = null) {
  checkResolution(input, choices);
  return deepFreeze(clone(input));
}

/** Validate an explicit cancellation/censoring reason. */
export function validateCancellation(input: unknown) {
  checkCancellation(input);
  return deepFreeze(clone(input));
}

/** Validate a complete immutable exercise record. */
export function validateExercise(input: unknown): Exercise {
  object('exercise', input);
  if (input.schema !== EXERCISE_SCHEMA)
    throw new TypeError(`exercise: schema must be ${EXERCISE_SCHEMA}`);
  string('id', input.id);
  if (!among(EXERCISE_KINDS, input.kind)) throw new TypeError('exercise: kind is invalid');
  string('sourceSessionId', input.sourceSessionId);
  integer('beliefSequence', input.beliefSequence);
  if (!among(EXERCISE_CLOCKS, input.clock))
    throw new TypeError('exercise: clock must be a declared monotonic clock');
  time('createdAtMs', input.createdAtMs);
  time('promptAtMs', input.promptAtMs);
  time('commitDeadlineMs', input.commitDeadlineMs);
  time('revealDeadlineMs', input.revealDeadlineMs);
  if (input.createdAtMs > input.promptAtMs || input.promptAtMs > input.commitDeadlineMs ||
      input.commitDeadlineMs > input.revealDeadlineMs)
    throw new TypeError('exercise: lifecycle times are not ordered');
  validateEligibility(input.eligibility);
  validateQuestion(input.question);
  if (!among(EXERCISE_DISPOSITIONS, input.disposition))
    throw new TypeError('exercise: disposition is invalid');

  const choices = input.question.choices;
  if (input.commitment !== null) {
    checkCommitment(input.commitment, choices);
    if (input.commitment.committedAtMs < input.promptAtMs ||
        input.commitment.committedAtMs > input.commitDeadlineMs)
      throw new TypeError('exercise: commitment is outside its response window');
  }
  if (input.resolution !== 'CENSORED') {
    checkResolution(input.resolution, choices);
    if (input.resolution.occurredAtMs < input.promptAtMs ||
        input.resolution.occurredAtMs > input.revealDeadlineMs)
      throw new TypeError('exercise: resolution is outside its reveal window');
  }
  if (input.cancellation !== null) {
    checkCancellation(input.cancellation);
    if (input.cancellation.atMs < input.promptAtMs)
      throw new TypeError('exercise: cancellation precedes the prompt');
  }
  if (input.disposition === 'COMPLETED' &&
      (input.commitment === null || input.resolution === 'CENSORED'))
    throw new TypeError('exercise: COMPLETED requires commitment and resolution');
  if ((input.disposition === 'CANCELLED' || input.disposition === 'EXPIRED') &&
      (input.resolution !== 'CENSORED' || input.cancellation === null))
    throw new TypeError('exercise: cancelled/expired records must be censored with a reason');
  if (input.disposition === 'UNRESOLVED' && input.cancellation !== null)
    throw new TypeError('exercise: unresolved record cannot carry cancellation');
  return deepFreeze(clone(input) as unknown as Exercise);
}

/** Create the initial frozen exercise, before prompt/response events replay. */
export function makeExercise(input: object) {
  return validateExercise({
    schema: EXERCISE_SCHEMA,
    ...clone(input),
    commitment: null,
    resolution: 'CENSORED',
    cancellation: null,
    disposition: 'UNRESOLVED',
  });
}

function validateEvent(input: unknown, exercise: Exercise): ExerciseEvent {
  object('event', input);
  if (input.schema !== EXERCISE_EVENT_SCHEMA)
    throw new TypeError(`exercise: event schema must be ${EXERCISE_EVENT_SCHEMA}`);
  string('event.exerciseId', input.exerciseId);
  if (input.exerciseId !== exercise.id) throw new TypeError('exercise: event targets another exercise');
  integer('event.seq', input.seq);
  if (!among(EXERCISE_EVENT_TYPES, input.type)) throw new TypeError('exercise: event type is invalid');
  time('event.atMs', input.atMs);
  if (input.clock !== undefined && input.clock !== exercise.clock)
    throw new TypeError('exercise: event clock does not match exercise');
  if (input.type === 'PROMPTED') {
    if (input.atMs !== exercise.promptAtMs)
      throw new TypeError('exercise: prompt timestamp differs from exercise');
  } else if (input.type === 'COMMITTED') {
    checkCommitment(input.commitment, exercise.question.choices);
    if (input.commitment.committedAtMs !== input.atMs)
      throw new TypeError('exercise: commitment timestamp differs from event timestamp');
  } else if (input.type === 'RESOLVED') {
    checkResolution(input.resolution, exercise.question.choices);
    if (input.resolution.occurredAtMs !== input.atMs)
      throw new TypeError('exercise: resolution timestamp differs from event timestamp');
  } else if (input.type === 'CANCELLED') {
    checkCancellation(input.cancellation);
    if (input.cancellation.atMs !== input.atMs)
      throw new TypeError('exercise: cancellation timestamp differs from event timestamp');
  } else if (input.type === 'EXPIRED' && input.reason !== undefined &&
             !among(CANCELLATION_REASONS, input.reason)) {
    throw new TypeError('exercise: expiry reason is invalid');
  }
  return input as unknown as ExerciseEvent;
}

/** Validate one replay event. */
export function validateExerciseEvent(input: unknown, exercise: unknown) {
  return deepFreeze(clone(validateEvent(input, validateExercise(exercise))));
}

function initialForReplay(exercise: unknown): Draft {
  const valid = validateExercise(exercise);
  if (valid.commitment !== null || valid.resolution !== 'CENSORED' ||
      valid.cancellation !== null || valid.disposition !== 'UNRESOLVED')
    throw new TypeError('exercise: replay requires an unresolved initial record');
  return {
    ...clone(valid), commitment: null, resolution: 'CENSORED',
    cancellation: null, disposition: 'UNRESOLVED',
  };
}

function terminal(record: Exercise) {
  return record.disposition !== 'UNRESOLVED' || record.resolution !== 'CENSORED';
}

/**
 * Rebuild one exercise from an ordered event stream. All temporal refusal
 * paths are explicit: a late commit is not silently accepted, and missing or
 * ambiguous outcomes must be represented by CANCELLED/EXPIRED.
 */
export function replayExercise(exercise: unknown, events: unknown) {
  const record = initialForReplay(exercise);
  if (!isList(events) || events.length === 0)
    throw new TypeError('exercise: replay needs a non-empty event stream');
  let previousAt = -Infinity;
  let previousSeq = -1;
  for (const [index, raw] of events.entries()) {
    const event = validateEvent(raw, record);
    if (event.seq !== previousSeq + 1)
      throw new TypeError(`exercise: event sequence gap at index ${index}`);
    if (event.atMs < previousAt) throw new TypeError('exercise: event times are not ordered');
    previousSeq = event.seq; previousAt = event.atMs;
    if (index === 0 && (event.type !== 'PROMPTED' || event.atMs !== record.promptAtMs))
      throw new TypeError('exercise: replay must begin with the prompt event');
    if (index > 0 && event.type === 'PROMPTED')
      throw new TypeError('exercise: prompt event may occur only once');
    if (event.type === 'PROMPTED') continue;
    if (terminal(record)) throw new TypeError('exercise: event follows a terminal disposition');

    if (event.type === 'COMMITTED') {
      if (event.atMs < record.promptAtMs || event.atMs > record.commitDeadlineMs)
        throw new TypeError('exercise: commitment missed its deadline');
      if (record.commitment !== null) throw new TypeError('exercise: commitment occurred twice');
      record.commitment = clone(event.commitment);
    } else if (event.type === 'RESOLVED') {
      if (event.atMs < record.promptAtMs || event.atMs > record.revealDeadlineMs)
        throw new TypeError('exercise: resolution missed its evidence horizon');
      record.resolution = clone(event.resolution);
      record.disposition = record.commitment === null ? 'UNRESOLVED' : 'COMPLETED';
    } else if (event.type === 'CANCELLED') {
      if (event.atMs < record.promptAtMs || event.atMs > record.revealDeadlineMs)
        throw new TypeError('exercise: cancellation is outside its exercise horizon');
      record.cancellation = clone(event.cancellation);
      record.resolution = 'CENSORED';
      record.disposition = 'CANCELLED';
    } else if (event.type === 'EXPIRED') {
      const minimum = record.commitment === null
        ? record.commitDeadlineMs : record.revealDeadlineMs;
      if (event.atMs < minimum) throw new TypeError('exercise: expiry occurred before its deadline');
      record.cancellation = {
        schema: CANCELLATION_SCHEMA,
        reason: event.reason ?? (record.commitment === null ? 'commit-deadline' : 'resolution-deadline'),
        atMs: event.atMs,
      };
      checkCancellation(record.cancellation);
      record.resolution = 'CENSORED';
      record.disposition = 'EXPIRED';
    }
  }
  return validateExercise(record);
}

function validateMotor(motor: unknown) {
  if (motor === null) return;
  object('attempt.motor', motor);
  if (!isInteger(motor.inputEvents) || motor.inputEvents < 0)
    throw new TypeError('exercise: attempt.motor.inputEvents is invalid');
  if (motor.pathLength !== undefined && (!finite(motor.pathLength) || motor.pathLength < 0))
    throw new TypeError('exercise: attempt.motor.pathLength is invalid');
  if (motor.timingErrorMs !== undefined && !finite(motor.timingErrorMs))
    throw new TypeError('exercise: attempt.motor.timingErrorMs is invalid');
}

function validateScore(score: unknown) {
  if (score === null) return;
  object('attempt.score', score);
  for (const name of ['prediction', 'recognition', 'timing', 'execution']) {
    if (score[name] !== undefined) boundedFraction(`attempt.score.${name}`, score[name]);
  }
}

/** Validate presentation/response telemetry kept separate from the exercise. */
export function validateExerciseAttempt(input: unknown) {
  object('attempt', input);
  if (input.schema !== EXERCISE_ATTEMPT_SCHEMA)
    throw new TypeError(`exercise: attempt schema must be ${EXERCISE_ATTEMPT_SCHEMA}`);
  string('attempt.exerciseId', input.exerciseId);
  string('attempt.rendererId', input.rendererId, 96);
  string('attempt.rendererVersion', input.rendererVersion, 64);
  string('attempt.sessionId', input.sessionId);
  if (!among(EXERCISE_CLOCKS, input.clock))
    throw new TypeError('exercise: attempt clock must be a declared monotonic clock');
  time('attempt.shownAtMs', input.shownAtMs);
  if (input.commitment !== null) checkCommitment(input.commitment);
  if (!among(EXERCISE_DISPOSITIONS, input.resolutionDisposition))
    throw new TypeError('exercise: attempt resolutionDisposition is invalid');
  validateMotor(input.motor);
  validateScore(input.score);
  return deepFreeze(clone(input) as unknown as ExerciseAttempt);
}
