/**
 * The sha256 a profile binds a fitted rule artifact by: canonical JSON, keys sorted at every depth.
 * The monitor, camera, mask and calibration-state rules each named a copy of this until 2026-10-01.
 */
import { createHash } from 'node:crypto';
import { isList } from '@sixam/kernel';

const stable = (value: unknown): unknown => {
  if (isList(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, stable(record[key])]));
  }
  return value;
};

/** Stable sha256 over an artifact's canonical JSON, for profile binding. */
export const ruleDigest = (artifact: unknown) => createHash('sha256').update(JSON.stringify(stable(artifact))).digest('hex');

/** One measurement a fitted rule makes: a value, or UNKNOWN with its reason. */
export type Reading<Signal extends string, Value> =
  | { signal: Signal, state: 'UNKNOWN', reason: string }
  | { signal: Signal, state: 'OBSERVED', value: Value, confidence: number };
