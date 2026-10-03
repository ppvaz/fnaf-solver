/**
 * The two helpers each campaign module kept its own copy of.
 */
import { isRecord } from '@sixam/kernel';

/** Resolve after `milliseconds` of host time; a negative wait is no wait. */
export const sleep = (milliseconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, Math.max(0, milliseconds)));

/** A host wall clock in ms, and waits on it; a test runs a night on its own. */
export interface Clock {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}
export const HOST_CLOCK: Clock = Object.freeze({ now: () => Date.now(), sleep });

/**
 * A thrown value as text: its message when it carries one, else the value itself.
 * @param maxChars bound for an event record
 */
export function messageOf(error: unknown, maxChars = Infinity): string {
  return String(isRecord(error) && error.message !== undefined ? error.message : error).slice(0, maxChars);
}
