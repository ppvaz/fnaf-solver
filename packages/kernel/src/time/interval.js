/**
 * Interval{lo, hi} (ADR 0002 kernel, "Time"): a value known only to lie
 * between two bounds, both included, in the unit of the field that holds it.
 */
import { fail, isRecord } from '../labels.js';

/** @typedef {import('../types.js').Interval} Interval */

/** @param {any} value @returns {Interval} */
export function validateInterval(value) {
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'lo' && key !== 'hi'))
    fail('an interval is {lo, hi} and nothing else');
  if (!Number.isFinite(value.lo) || !Number.isFinite(value.hi)) fail('an interval needs finite lo and hi');
  if (value.lo > value.hi) fail(`an interval needs lo <= hi, not [${value.lo}, ${value.hi}]`);
  return /** @type {Interval} */ (value);
}

/** @param {number} lo @param {number} hi @returns {Interval} */
export const interval = (lo, hi) => validateInterval(Object.freeze({ lo, hi }));
