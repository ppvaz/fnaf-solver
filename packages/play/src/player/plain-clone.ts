// Structural copy for the plain-data belief and estimator records.
//
// `structuredClone` is the obvious way to copy these values and it was the
// measured cost of the entire closed loop. Profiling one full Night 1 run of
// `packages/propose/bin/nightloop.ts` on 2026-09-02 put **95% of 48.5 s inside
// structuredClone**, 80% of it in the single `clone(estimator)` at the head of
// `predict()`: the bounded 4096-entry diagnostic trace is deep-copied on every
// decision boundary, twice more per committed action, which is ~150M value
// copies a night. Bounding the trace (the 2026-09-02 fix) stopped the growth;
// it did not stop the copying.
//
// These records are plain JSON data by contract -- `belief-v1` and
// `estimator-v1` both say "plain-data" -- so a purpose-built copy is not only
// faster, it is STRICTER. structuredClone silently accepts a Date, a Map or a
// TypedArray and hands back something a JSON replay would not reproduce; this
// refuses them by name, so the schemas stay honest instead of drifting.
//
// This is not only a benchmark concern. The controller is specified to run
// beside the phone against a measured deadline (Plan 20 P6), and a decision
// cost dominated by copying a diagnostic buffer is spent where the deadline is
// tightest.

import { isList } from '@sixam/kernel';

function fail(what: string): never {
  throw new TypeError(`plain-clone: ${what} is not plain data`);
}

/**
 * Deep-copy plain JSON data: primitives, arrays, and plain objects. Anything
 * else is refused rather than approximated.
 */
export function plainClone<T>(value: T): T {
  // A copy of plain data has the shape it was copied from.
  return copy(value) as T;
}

function copy(value: unknown): unknown {
  if (value === null) return null;
  const type = typeof value;
  if (type !== 'object') {
    if (type === 'function' || type === 'symbol' || type === 'bigint')
      fail(`a ${type}`);
    return value;
  }
  if (isList(value)) {
    const items = value;
    const out = new Array<unknown>(items.length);
    for (let i = 0; i < items.length; i++) out[i] = copy(items[i]);
    return out;
  }
  const record = value as Readonly<Record<string, unknown>> & { constructor?: { name?: string } };
  const proto = Object.getPrototypeOf(record);
  if (proto !== Object.prototype && proto !== null)
    fail(`an instance of ${record.constructor?.name ?? 'an exotic object'}`);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record)) out[key] = copy(record[key]);
  return out;
}

/**
 * Append to an append-only log. The entry is frozen so that sharing its
 * reference across copies of the owning record cannot become a mutation
 * channel: `shareLog` copies the array, never the entries.
 */
export function appendLog<T>(log: T[], entry: T) {
  log.push(Object.freeze(entry));
  return log;
}

/** Copy an append-only log's spine, sharing its frozen entries. */
export const shareLog = <T>(log: readonly T[]) => log.slice();
