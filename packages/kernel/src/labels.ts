/**
 * UNKNOWN(reason) and the two evidence labels (ADR 0002 kernel, "Labels").
 * Both label enums are closed and never promote one another; UNKNOWN is a
 * value with a reason, never a default.
 */
import type { ClaimLevel, SourceLabel, Unknown } from './types.ts';

export const fail = message => { throw new TypeError(`kernel: ${message}`); };
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isText = value => typeof value === 'string' && value.trim().length > 0;

/**
 * An unknown value and why it is unknown.
 */
export function unknown(reason: string): Unknown {
  if (!isText(reason)) fail('UNKNOWN needs a reason');
  return Object.freeze({ kind: 'UNKNOWN', reason });
}

export function isUnknown(value: any): value is Unknown {
  return isRecord(value) && value.kind === 'UNKNOWN' && isText(value.reason) && Object.keys(value).length === 2;
}

export const CLAIM_LEVELS = Object.freeze(['MODEL_ONLY', 'FIXTURE', 'DEVICE_MEASURED']);

export const isClaimLevel = (value: unknown): value is ClaimLevel => typeof value === 'string' && CLAIM_LEVELS.includes(value);

export function validateClaimLevel(value: any): ClaimLevel {
  if (!isClaimLevel(value)) fail(`claim level must be one of ${CLAIM_LEVELS.join(', ')}, not ${JSON.stringify(value)}`);
  return value;
}

/** The named source labels, and UNKNOWN, which is only ever written with its reason. */
export const SOURCE_LABELS = Object.freeze(['SOURCED', 'CALIBRATED', 'MEASURED', 'INFERRED', 'MODEL', 'UNKNOWN']);
const NAMED_SOURCE_LABELS = SOURCE_LABELS.filter(label => label !== 'UNKNOWN');

export const isSourceLabel = (value: unknown): value is SourceLabel => (typeof value === 'string' && NAMED_SOURCE_LABELS.includes(value)) || isUnknown(value);

export function validateSourceLabel(value: any): SourceLabel {
  if (value === 'UNKNOWN') fail('source label UNKNOWN needs its reason: write unknown(reason)');
  if (!isSourceLabel(value)) fail(`source label must be one of ${NAMED_SOURCE_LABELS.join(', ')} or UNKNOWN(reason), not ${JSON.stringify(value)}`);
  return value;
}
