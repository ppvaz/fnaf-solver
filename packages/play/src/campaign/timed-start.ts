// Place a tap at a chosen phone wall-clock residue (twin-nights test of clock seeding).
//
// The stock game seeds its 16-bit Fusion RNG from (short) System.currentTimeMillis()
// when a frame loads (packages/source/src/games/fnaf2/rng.ts, sourced from the
// decompile). Two nights whose scene loads fall on the same phone wall-clock
// millisecond modulo 65 536 would then replay the same RNG stream. The helper
// reports wallMs beside snapshotNs (CaptureService GET reply) and the clock port
// maps snapshotNs to host performance.now() through offsetMs, so the host can
// plan when the phone's wall clock reaches a residue. The tap still travels host
// -> adb -> phone and the scene load follows it, so a twin pair measures that
// jitter as much as it tests seeding; the night's own wall-clock onset
// (night-anchor.js onsetPhoneWallMs) records where each night actually landed.

export const SEED_PERIOD_MS = 65536;

/**
 * The phone wall-clock residue a timed start asks for, from its text form
 * (the operator's FNAF_START_PHONE_WALL_RESIDUE_MS): null when unset or empty,
 * otherwise an integer in 0..65535, refused before the run is composed.
 */
export function startResidueFrom(text: string | undefined): number | null {
  if (text === undefined || text === '') return null;
  const residueMs = Number(text);
  if (!isStartResidue(residueMs))
    throw new TypeError(`start residue must be an integer in 0..${SEED_PERIOD_MS - 1}, got ${JSON.stringify(text)}`);
  return residueMs;
}

/** A residue modulo the 16-bit seed period, in whole milliseconds. */
export function isStartResidue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < SEED_PERIOD_MS;
}

/**
 * The phone's wall clock at a host performance.now() instant, from one clock sample.
 */
export function phoneWallAt(sample: {offsetMs: number, fields: Record<string, string>}, hostPerfMs: number) {
  const fields = sample?.fields ?? {};
  if (!/^\d+$/.test(fields.wallMs ?? '') || !/^\d+$/.test(fields.snapshotNs ?? ''))
    throw new Error('clock sample has no wallMs/snapshotNs pair; the helper predates the wall-clock stamp');
  const hostAtSnapshotMs = Number(BigInt(fields.snapshotNs)) / 1e6 + sample.offsetMs;
  return Number(fields.wallMs) + (hostPerfMs - hostAtSnapshotMs);
}

/**
 * The next host instant, at least minLeadMs away, at which the phone's wall clock
 * is congruent to residueMs modulo 65 536 ms.
 */
export function planTimedStart({ sample, residueMs, nowHostMs, minLeadMs = 1500 }: {sample: {offsetMs: number, fields: Record<string, string>}, residueMs: number, nowHostMs: number, minLeadMs?: number}) {
  if (!isStartResidue(residueMs))
    throw new TypeError(`residueMs must be an integer in 0..${SEED_PERIOD_MS - 1}`);
  if (!(minLeadMs >= 0 && minLeadMs < SEED_PERIOD_MS)) throw new TypeError('minLeadMs must be in [0, 65536)');
  const phoneNowMs = phoneWallAt(sample, nowHostMs);
  const earliest = phoneNowMs + minLeadMs;
  const cycles = Math.ceil((earliest - residueMs) / SEED_PERIOD_MS);
  const targetPhoneWallMs = residueMs + cycles * SEED_PERIOD_MS;
  const waitMs = targetPhoneWallMs - phoneNowMs;
  return { targetPhoneWallMs, targetHostMs: nowHostMs + waitMs, waitMs, phoneNowMs };
}

/**
 * Wait until performance.now() reaches targetHostMs: coarse timers, then a short spin.
 */
export async function waitUntilHostMs(targetHostMs: number, { now = () => performance.now(), sleep = ms => new Promise<void>(r => setTimeout(r, ms)) }: {now?: () => number, sleep?: (ms: number) => Promise<void>} = {}) {
  for (;;) {
    const left = targetHostMs - now();
    if (left <= 0) return now();
    if (left > 20) await sleep(left - 15);
    else if (left > 2) await sleep(1);
    else while (now() < targetHostMs) { /* spin the last milliseconds */ }
  }
}
