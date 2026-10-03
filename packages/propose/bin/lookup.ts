/**
 * A value a lookup must find. A miss fails here, naming what was missing,
 * instead of reaching the caller as `undefined` behind an `as T` (which is
 * `x!` under another name) and failing later as a TypeError, or not at all.
 *
 * @param value what `find`, a map read or an index returned
 * @param what what was looked up, for the failure
 */
export function found<T>(value: T | null | undefined, what = 'a looked-up value'): T {
  if (value === null || value === undefined) throw new Error(`${what} was not found`);
  return value;
}
