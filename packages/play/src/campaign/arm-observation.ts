// When an observe-once arm read can see the camera map.
//
// The double-camera arm (CAM 11 viewed with the second camera highlighted) is read off the camera map, which is on
// screen only while the monitor is up and its raise has settled. observe-once used to read once at
// armReadyAtMs + settle. On the k2/k3 Night 7 plans that instant is about +2.7 s, after the opening camdrop has
// lowered the monitor at +2333 ms: 52 of the 53 `ambiguous-threshold` arm.unresolved reads in the Night 7 packs were
// of the office, all twelve buttons near 0, while frames later the same nights read the armed pair exactly
// (diagnosed 2026-10-01 on night7-k3-0of20-sr01: read at release + 2702 ms, the map showing CAM 09 + CAM 11 in the
// retained frames). The pair holds all night, so a read may wait for any later window in which the plan holds the
// monitor up.

/** One authored monitor target at its contact time, as hid-schedule.ts lists them. */
export interface PlannedMonitorTransition {
  readonly atMs: number;
  readonly targetMonitorUp: boolean;
}

/**
 * A read must start this long before the plan lowers the monitor: the Companion exchange's round trip (15-60 ms) and
 * the copied frame's age (up to about 56 ms at the menu on Companion 15) with room to spare.
 */
export const ARM_READ_MARGIN_MS = 200;

/**
 * The plan-relative instants, in order, at which the plan holds the monitor up and settled: in each up interval,
 * the later of the raise plus `settleMs` and `notBeforeMs`, kept only when a read starting there ends `marginMs`
 * before the plan lowers the monitor again. At most `limit` of them.
 */
export function armObservationTimes(transitions: readonly PlannedMonitorTransition[],
  { notBeforeMs, settleMs, marginMs = ARM_READ_MARGIN_MS, limit = 3 }:
  { notBeforeMs: number, settleMs: number, marginMs?: number, limit?: number }): number[] {
  const times: number[] = [];
  const consider = (upAt: number, downAt: number) => {
    const at = Math.max(upAt + settleMs, notBeforeMs);
    if (at + marginMs <= downAt) times.push(at);
  };
  let upAt = null as number | null;
  for (const transition of [...transitions].sort((a, b) => a.atMs - b.atMs)) {
    if (transition.targetMonitorUp) { if (upAt === null) upAt = transition.atMs; continue; }
    if (upAt !== null) consider(upAt, transition.atMs);
    upAt = null;
  }
  if (upAt !== null) consider(upAt, Infinity);
  return times.slice(0, limit);
}
