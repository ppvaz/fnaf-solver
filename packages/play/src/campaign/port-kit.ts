/**
 * The two helpers each campaign module kept its own copy of.
 */
import type { ChildProcess } from 'node:child_process';
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

/**
 * End a child process and confirm it is gone: SIGTERM, then SIGKILL after `graceMs`, each waited on. It throws
 * when the process outlives SIGKILL too, so a caller never records a process as stopped while it still runs.
 */
export async function terminate(child: ChildProcess, graceMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  const within = (ms: number) => Promise.race([exited.then(() => true),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), ms).unref())]);
  child.kill('SIGTERM');
  if (await within(graceMs)) return;
  child.kill('SIGKILL');
  if (await within(graceMs)) return;
  throw new Error(`process ${child.pid} did not exit after SIGKILL`);
}
