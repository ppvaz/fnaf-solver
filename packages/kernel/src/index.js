/**
 * @sixam/kernel: the ADR 0002 kernel types with a consumer today, as
 * frozen enums, small constructors and validators. It imports nothing; every
 * package may import it (tools/architecture-test.js). Compile-time shapes are
 * in types.ts.
 */
export { CLAIM_LEVELS, SOURCE_LABELS, isClaimLevel, isSourceLabel, isUnknown, unknown, validateClaimLevel,
  validateSourceLabel } from './labels.js';
export { interval, validateInterval } from './time/interval.js';
export { BINDINGS_DIR, WINNER_FILE, winnerTag } from './bindings.js';
export { OUTCOME_KINDS, aborted, death, invalid, sixAm, timeout, validateOutcome } from './outcome.js';
export { CUSTODY_CLASSES, GAME_RUN_FIELDS, RUN_MODES, validateGameRun } from './game-run.js';
export { ANNOTATION_KINDS, ANNOTATION_STATUSES, SUBJECT_KINDS, validateAnnotation } from './annotation.js';
export { CLAIM_ENVELOPE_SCHEMA, CLAIM_FIELDS, ENVELOPE_STATUSES, REFUSAL_FIELDS, REPOSITORY_TARGET, claimEnvelope,
  isEnvelopeLabel, isRefusal, refusalEnvelope, unknownsIn, validateClaimEnvelope, validateEnvelopeLabel } from './claim-envelope.js';
