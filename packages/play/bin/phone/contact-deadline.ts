// Host CLOCK_MONOTONIC scheduling only; a deadline does not imply game acceptance.
import { waitUntilHostMs } from '../../src/campaign/timed-start.ts';

export function contactDeadline(text: string | undefined, nowMs: number): number | null {
  if (text === undefined) return null;
  const target = Number(text);
  if (!text.trim() || !Number.isFinite(target) || target <= nowMs || target - nowMs > 10000)
    throw new Error('contact deadline must be in the next 10 seconds of host monotonic time');
  return target;
}

export async function awaitContactDeadline(target: number, {
  now = () => Number(process.hrtime.bigint()) / 1e6,
  wait = (at: number) => waitUntilHostMs(at, { now }),
}: { now?: () => number; wait?: (at: number) => Promise<number> } = {}) {
  if (!Number.isFinite(target) || target <= now() || target - now() > 10000)
    throw new Error('contact deadline expired or outside the bounded wait');
  await wait(target);
  const actual = now();
  if (actual < target || actual - target > 5)
    throw new Error('contact deadline missed by more than 5 ms; no press authorized');
  return { plannedHostMonoMs: target, readyHostMonoMs: actual };
}
