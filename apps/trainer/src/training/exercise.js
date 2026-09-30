// Replayable adaptive-coach contracts for Plan 24 package 1.
//
// An exercise freezes a question at prompt time. A later resolution is an
// independently evidenced outcome; the player's commitment is separate from
// that outcome. Ambiguous, interrupted, stale, or missing evidence is
// explicitly censored and can never be scored as an incorrect answer.

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

const clone = value => structuredClone(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const object = (name, value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`exercise: ${name} must be an object`);
  return value;
};
const string = (name, value, max = 160) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    throw new TypeError(`exercise: ${name} must be a non-empty bounded string`);
  return value;
};
const time = (name, value) => {
  if (!finite(value) || value < 0)
    throw new TypeError(`exercise: ${name} must be finite and non-negative`);
  return value;
};
const integer = (name, value) => {
  if (!Number.isInteger(value) || value < 0)
    throw new TypeError(`exercise: ${name} must be a non-negative integer`);
  return value;
};
const uniqueStrings = (name, values, { min = 0, max = 128 } = {}) => {
  if (!Array.isArray(values) || values.length < min || values.length > max ||
      values.some(value => typeof value !== 'string' || value.length === 0 || value.length > 160))
    throw new TypeError(`exercise: ${name} must contain ${min}-${max} bounded strings`);
  if (new Set(values).size !== values.length)
    throw new TypeError(`exercise: ${name} must contain unique strings`);
  return values;
};

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function boundedFraction(name, value) {
  if (!finite(value) || value < 0 || value > 1)
    throw new TypeError(`exercise: ${name} must be between 0 and 1`);
}

function validateQuestion(question) {
  object('question', question);
  string('question.target', question.target, 128);
  uniqueStrings('question.choices', question.choices, { min: 2, max: 32 });
  if (!finite(question.horizonMs) || question.horizonMs <= 0)
    throw new TypeError('exercise: question.horizonMs must be positive');
  return question;
}

function validateEligibility(eligibility) {
  object('eligibility', eligibility);
  string('eligibility.activityGateVersion', eligibility.activityGateVersion, 96);
  string('eligibility.profileId', eligibility.profileId, 160);
  uniqueStrings('eligibility.factIds', eligibility.factIds, { min: 1, max: 128 });
  return eligibility;
}

function checkCommitment(input, choices, { label = 'commitment' } = {}) {
  object(label, input);
  if (input.schema !== COMMITMENT_SCHEMA)
    throw new TypeError(`exercise: ${label} schema mismatch`);
  if (Array.isArray(choices) && !choices.includes(input.choice))
    throw new TypeError(`exercise: ${label}.choice is not one of the frozen choices`);
  time(`${label}.committedAtMs`, input.committedAtMs);
  string(`${label}.responsePort`, input.responsePort, 96);
  return input;
}

function checkResolution(input, choices, { label = 'resolution' } = {}) {
  object(label, input);
  if (input.schema !== RESOLUTION_SCHEMA)
    throw new TypeError(`exercise: ${label} schema mismatch`);
  if (Array.isArray(choices) && !choices.includes(input.outcome) && input.outcome !== 'none-in-horizon')
    throw new TypeError(`exercise: ${label}.outcome is not a declared competing outcome`);
  time(`${label}.occurredAtMs`, input.occurredAtMs);
  uniqueStrings(`${label}.evidenceFactIds`, input.evidenceFactIds, { min: 1, max: 128 });
  return input;
}

function checkCancellation(input, { label = 'cancellation' } = {}) {
  object(label, input);
  if (input.schema !== CANCELLATION_SCHEMA)
    throw new TypeError(`exercise: ${label} schema mismatch`);
  if (!CANCELLATION_REASONS.includes(input.reason))
    throw new TypeError(`exercise: ${label}.reason is not declared`);
  time(`${label}.atMs`, input.atMs);
  if (input.detail !== undefined) string(`${label}.detail`, input.detail, 256);
  return input;
}

/** Validate the nested commitment contract and return its frozen copy. */
export function validateCommitment(input, choices = null) {
  return deepFreeze(clone(checkCommitment(input, choices)));
}

/** Validate an independently evidenced outcome, without player state. */
export function validateResolution(input, choices = null) {
  return deepFreeze(clone(checkResolution(input, choices)));
}

/** Validate an explicit cancellation/censoring reason. */
export function validateCancellation(input) {
  return deepFreeze(clone(checkCancellation(input)));
}

/** Validate a complete immutable exercise record. */
export function validateExercise(input) {
  object('exercise', input);
  if (input.schema !== EXERCISE_SCHEMA)
    throw new TypeError(`exercise: schema must be ${EXERCISE_SCHEMA}`);
  string('id', input.id);
  if (!EXERCISE_KINDS.includes(input.kind)) throw new TypeError('exercise: kind is invalid');
  string('sourceSessionId', input.sourceSessionId);
  integer('beliefSequence', input.beliefSequence);
  if (!EXERCISE_CLOCKS.includes(input.clock))
    throw new TypeError('exercise: clock must be a declared monotonic clock');
  for (const field of ['createdAtMs', 'promptAtMs', 'commitDeadlineMs', 'revealDeadlineMs'])
    time(field, input[field]);
  if (input.createdAtMs > input.promptAtMs || input.promptAtMs > input.commitDeadlineMs ||
      input.commitDeadlineMs > input.revealDeadlineMs)
    throw new TypeError('exercise: lifecycle times are not ordered');
  validateEligibility(input.eligibility);
  validateQuestion(input.question);
  if (!EXERCISE_DISPOSITIONS.includes(input.disposition))
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
  return deepFreeze(clone(input));
}

/** Create the initial frozen exercise, before prompt/response events replay. */
export function makeExercise(input) {
  return validateExercise({
    schema: EXERCISE_SCHEMA,
    ...clone(input),
    commitment: null,
    resolution: 'CENSORED',
    cancellation: null,
    disposition: 'UNRESOLVED',
  });
}

function validateEvent(input, exercise) {
  object('event', input);
  if (input.schema !== EXERCISE_EVENT_SCHEMA)
    throw new TypeError(`exercise: event schema must be ${EXERCISE_EVENT_SCHEMA}`);
  string('event.exerciseId', input.exerciseId);
  if (input.exerciseId !== exercise.id) throw new TypeError('exercise: event targets another exercise');
  integer('event.seq', input.seq);
  if (!EXERCISE_EVENT_TYPES.includes(input.type)) throw new TypeError('exercise: event type is invalid');
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
             !CANCELLATION_REASONS.includes(input.reason)) {
    throw new TypeError('exercise: expiry reason is invalid');
  }
  return input;
}

/** Validate one replay event. */
export function validateExerciseEvent(input, exercise) {
  return deepFreeze(clone(validateEvent(input, validateExercise(exercise))));
}

function initialForReplay(exercise) {
  const valid = validateExercise(exercise);
  if (valid.commitment !== null || valid.resolution !== 'CENSORED' ||
      valid.cancellation !== null || valid.disposition !== 'UNRESOLVED')
    throw new TypeError('exercise: replay requires an unresolved initial record');
  return {
    ...clone(valid), commitment: null, resolution: 'CENSORED',
    cancellation: null, disposition: 'UNRESOLVED',
  };
}

function terminal(record) {
  return record.disposition !== 'UNRESOLVED' || record.resolution !== 'CENSORED';
}

/**
 * Rebuild one exercise from an ordered event stream. All temporal refusal
 * paths are explicit: a late commit is not silently accepted, and missing or
 * ambiguous outcomes must be represented by CANCELLED/EXPIRED.
 */
export function replayExercise(exercise, events) {
  let record = initialForReplay(exercise);
  if (!Array.isArray(events) || events.length === 0)
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

function validateMotor(motor) {
  if (motor === null) return;
  object('attempt.motor', motor);
  if (!Number.isInteger(motor.inputEvents) || motor.inputEvents < 0)
    throw new TypeError('exercise: attempt.motor.inputEvents is invalid');
  if (motor.pathLength !== undefined && (!finite(motor.pathLength) || motor.pathLength < 0))
    throw new TypeError('exercise: attempt.motor.pathLength is invalid');
  if (motor.timingErrorMs !== undefined && !finite(motor.timingErrorMs))
    throw new TypeError('exercise: attempt.motor.timingErrorMs is invalid');
}

function validateScore(score) {
  if (score === null) return;
  object('attempt.score', score);
  for (const name of ['prediction', 'recognition', 'timing', 'execution']) {
    if (score[name] !== undefined) boundedFraction(`attempt.score.${name}`, score[name]);
  }
}

/** Validate presentation/response telemetry kept separate from the exercise. */
export function validateExerciseAttempt(input) {
  object('attempt', input);
  if (input.schema !== EXERCISE_ATTEMPT_SCHEMA)
    throw new TypeError(`exercise: attempt schema must be ${EXERCISE_ATTEMPT_SCHEMA}`);
  string('attempt.exerciseId', input.exerciseId);
  string('attempt.rendererId', input.rendererId, 96);
  string('attempt.rendererVersion', input.rendererVersion, 64);
  string('attempt.sessionId', input.sessionId);
  if (!EXERCISE_CLOCKS.includes(input.clock))
    throw new TypeError('exercise: attempt clock must be a declared monotonic clock');
  time('attempt.shownAtMs', input.shownAtMs);
  if (input.commitment !== null) checkCommitment(input.commitment);
  if (!EXERCISE_DISPOSITIONS.includes(input.resolutionDisposition))
    throw new TypeError('exercise: attempt resolutionDisposition is invalid');
  validateMotor(input.motor);
  validateScore(input.score);
  return deepFreeze(clone(input));
}
