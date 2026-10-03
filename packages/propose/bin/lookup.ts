/**
 * Propose's bins read a value a lookup must find through `found`: the kernel's
 * `present`, which refuses a miss by name instead of letting `undefined` through
 * an `as T` (which is `x!` under another name).
 */
export { present as found } from '@sixam/kernel';
