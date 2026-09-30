/**
 * UNKNOWN(reason) and the two evidence labels (ADR 0002 kernel, "Labels").
 * Both label enums are closed and never promote one another; UNKNOWN is a
 * value with a reason, never a default.
 */

/** @typedef {import('./types.js').Unknown} Unknown */
/** @typedef {import('./types.js').ClaimLevel} ClaimLevel */
/** @typedef {import('./types.js').SourceLabel} SourceLabel */

export const fail = message => { throw new TypeError(`kernel: ${message}`); };
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isText = value => typeof value === 'string' && value.trim().length > 0;

/**
 * An unknown value and why it is unknown.
 * @param {string} reason
 * @returns {Unknown}
 */
export function unknown(reason) {
  if (!isText(reason)) fail('UNKNOWN needs a reason');
  return Object.freeze({ kind: 'UNKNOWN', reason });
}

/** @param {any} value @returns {value is Unknown} */
export function isUnknown(value) {
  return isRecord(value) && value.kind === 'UNKNOWN' && isText(value.reason) && Object.keys(value).length === 2;
}

export const CLAIM_LEVELS = Object.freeze(['MODEL_ONLY', 'FIXTURE', 'DEVICE_MEASURED']);

/** @param {unknown} value @returns {value is ClaimLevel} */
export const isClaimLevel = value => typeof value === 'string' && CLAIM_LEVELS.includes(value);

/** @param {any} value @returns {ClaimLevel} */
export function validateClaimLevel(value) {
  if (!isClaimLevel(value)) fail(`claim level must be one of ${CLAIM_LEVELS.join(', ')}, not ${JSON.stringify(value)}`);
  return value;
}

/** The named source labels, and UNKNOWN, which is only ever written with its reason. */
export const SOURCE_LABELS = Object.freeze(['SOURCED', 'CALIBRATED', 'MEASURED', 'INFERRED', 'MODEL', 'UNKNOWN']);
const NAMED_SOURCE_LABELS = SOURCE_LABELS.filter(label => label !== 'UNKNOWN');

/** @param {unknown} value @returns {value is SourceLabel} */
export const isSourceLabel = value => (typeof value === 'string' && NAMED_SOURCE_LABELS.includes(value)) || isUnknown(value);

/** @param {any} value @returns {SourceLabel} */
export function validateSourceLabel(value) {
  if (value === 'UNKNOWN') fail('source label UNKNOWN needs its reason: write unknown(reason)');
  if (!isSourceLabel(value)) fail(`source label must be one of ${NAMED_SOURCE_LABELS.join(', ')} or UNKNOWN(reason), not ${JSON.stringify(value)}`);
  return value;
}
