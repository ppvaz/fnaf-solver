/**
 * UNKNOWN(reason) and the two evidence labels (ADR 0002 kernel, "Labels").
 * Both label enums are closed and never promote one another; UNKNOWN is a
 * value with a reason, never a default.
 */
import type { ClaimLevel, SourceLabel, Unknown } from './types.ts';

export function fail(message: string): never { throw new TypeError(`kernel: ${message}`); }
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
/** A string with something in it. Only the true branch narrows soundly: a blank string is a string too. */
export const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
/** A list, whose items are still to be checked (Array.isArray would call them `any`). */
export const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);
/** One of a closed list's members. */
export const isOneOf = <T>(values: readonly T[], value: unknown): value is T => (values as readonly unknown[]).includes(value);

/**
 * An unknown value and why it is unknown.
 */
export function unknown(reason: string): Unknown {
  if (!isText(reason)) fail('UNKNOWN needs a reason');
  return Object.freeze({ kind: 'UNKNOWN', reason });
}

export function isUnknown(value: unknown): value is Unknown {
  return isRecord(value) && value.kind === 'UNKNOWN' && isText(value.reason) && Object.keys(value).length === 2;
}

export const CLAIM_LEVELS = Object.freeze(['MODEL_ONLY', 'FIXTURE', 'DEVICE_MEASURED'] as const);

export const isClaimLevel = (value: unknown): value is ClaimLevel => isOneOf(CLAIM_LEVELS, value);

export function validateClaimLevel(value: unknown): ClaimLevel {
  if (!isClaimLevel(value)) fail(`claim level must be one of ${CLAIM_LEVELS.join(', ')}, not ${JSON.stringify(value)}`);
  return value;
}

/** The named source labels, and UNKNOWN, which is only ever written with its reason. */
export const SOURCE_LABELS = Object.freeze(['SOURCED', 'CALIBRATED', 'MEASURED', 'INFERRED', 'MODEL', 'UNKNOWN'] as const);
const NAMED_SOURCE_LABELS = SOURCE_LABELS.filter(label => label !== 'UNKNOWN');

export const isSourceLabel = (value: unknown): value is SourceLabel => isOneOf(NAMED_SOURCE_LABELS, value) || isUnknown(value);

export function validateSourceLabel(value: unknown): SourceLabel {
  if (value === 'UNKNOWN') fail('source label UNKNOWN needs its reason: write unknown(reason)');
  if (!isSourceLabel(value)) fail(`source label must be one of ${NAMED_SOURCE_LABELS.join(', ')} or UNKNOWN(reason), not ${JSON.stringify(value)}`);
  return value;
}
