/**
 * Hearing Fredbear on the level's own grid, and the timing rules the FNaF 4
 * runner's Fredbear branch keeps (fnaf4-run.mjs). Pure: no device, no clock
 * of its own; every number comes from the hearing model
 * (packages/play/profiles/fnaf4/moto-g56/hearing-fnaf4-fredbear-moto-g56-v204.json), which cites the run it
 * was measured on, and test-fnaf4-fredbear.mjs replays that run's derived rows.
 *
 * Why a grid: his side sounds (h26 landing left, h25 landing right, g239/g242)
 * reach the phone's A2DP mix about 5 dB under the room's ambience. n5b's four
 * landings matched at 0.27-0.35 with a 1 s window -- under the detector's 0.55
 * default, so none was published and the loop held the left door blind until
 * he struck from the right hall. But every one of them can only start on the
 * 3000 ms grid of the level's own timer (g286 rolls, g502/g503 repels,
 * g522/g523 ejects), and every laugh on the 10000 ms one (g530 fakes; the room
 * teleports g639/g640 on 30000 ms). At the grid instants silence scores <= 0.15.
 */
import { readFileSync } from 'node:fs';

export const HEARING_PATH = new URL('../../profiles/fnaf4/moto-g56/hearing-fnaf4-fredbear-moto-g56-v204.json', import.meta.url);

export function loadHearing(path = HEARING_PATH) {
  const m = JSON.parse(readFileSync(path, 'utf8'));
  if (m.schema !== 'fnaf4-fredbear-hearing-v1') throw new Error(`${path}: not a fnaf4-fredbear-hearing-v1 file`);
  for (const g of [m.sideGrid, m.laughGrid]) {
    for (const k of ['onsetOffsetMs', 'halfWidthMs', 'minNcc', 'decideAfterMs']) {
      if (!Number.isFinite(g[k])) throw new Error(`${path}: grid ${k} missing`);
    }
  }
  return m;
}

/** Shadow nights (7, 8) roll every 2000 ms (g287) and teleport every 20000 (g641/g642). */
export const shadowOf = (night) => (night >= 7 ? 1 : 0);

/**
 * A grid of the level's own timer on the host wall clock: tick k's sound
 * starts at origin + k * period + offset (the offset folds in the A2DP lag).
 */
export class Grid {
  constructor(originWall, periodMs, { onsetOffsetMs, halfWidthMs, decideAfterMs }) {
    Object.assign(this, { originWall, periodMs, offsetMs: onsetOffsetMs, halfWidthMs, decideAfterMs });
  }
  at(k) { return this.originWall + k * this.periodMs + this.offsetMs; }
  /** The tick whose window holds an onset, or null (off the grid: not his). */
  tickOf(onsetWall) {
    const k = Math.round((onsetWall - this.originWall - this.offsetMs) / this.periodMs);
    return Math.abs(onsetWall - this.at(k)) <= this.halfWidthMs ? k : null;
  }
  /** The first tick at or after a wall time. */
  nextK(wall) { return Math.ceil((wall - this.originWall - this.offsetMs) / this.periodMs); }
  /** The last tick at or before a wall time. */
  lastK(wall) { return Math.floor((wall - this.originWall - this.offsetMs) / this.periodMs); }
  /** Whether tick k's candidates are all in by `nowWall`. */
  decided(k, nowWall) { return nowWall >= this.at(k) + this.decideAfterMs; }
}

export function sideGrid(originWall, night, hearing) {
  return new Grid(originWall, hearing.sideGrid.periodMs[shadowOf(night) ? 'shadow1' : 'shadow0'], hearing.sideGrid);
}
export function laughGrid(originWall, hearing) {
  return new Grid(originWall, hearing.laughGrid.periodMs, hearing.laughGrid);
}

/**
 * Landings heard on the grid. Per tick, the best candidate of each side; a
 * side is accepted at `minNcc` when it also beats the other side's best at the
 * same tick by `sideRatio` (h25 and h26 are both runs: each matches the other
 * at up to 0.28 of its own score). Rows come back in tick order, accepted or
 * not, so a caller can show what it heard and why it did not act.
 */
export function landings(events, grid, gate, { fromK = -Infinity, toK = Infinity } = {}) {
  const per = new Map();
  for (const e of events) {
    if ((e.cue !== 'fb-left' && e.cue !== 'fb-right') || !Number.isFinite(e.onsetMs)) continue;
    const k = grid.tickOf(e.onsetMs);
    if (k === null || k < fromK || k > toK) continue;
    const row = per.get(k) ?? { k, L: 0, R: 0 };
    const s = e.cue === 'fb-left' ? 'L' : 'R';
    if (e.ncc > row[s]) row[s] = e.ncc;
    per.set(k, row);
  }
  return [...per.values()].sort((a, b) => a.k - b.k).map((row) => {
    const side = row.L >= row.R ? 'L' : 'R';
    const best = row[side];
    const other = row[side === 'L' ? 'R' : 'L'];
    const accepted = best >= gate.minNcc && best >= gate.sideRatio * other;
    return { ...row, side: accepted ? side : null, ncc: best, other };
  });
}

/**
 * Laughs heard on the 10 s grid. `room` marks a tick of the teleport's own
 * period (30 s, 20 s under shadow): only there can a laugh mean he is on the
 * bed or in the closet (g639-g642); elsewhere it is g530's fake.
 */
export function laughs(events, grid, gate, roomPeriodMs) {
  const per = new Map();
  for (const e of events) {
    if (e.cue !== 'laugh' || !Number.isFinite(e.onsetMs)) continue;
    const k = grid.tickOf(e.onsetMs);
    if (k === null) continue;
    per.set(k, Math.max(per.get(k) ?? 0, e.ncc));
  }
  return [...per.entries()].sort((a, b) => a[0] - b[0]).map(([k, ncc]) => ({
    k, ncc, accepted: ncc >= gate.minNcc, room: (k * grid.periodMs) % roomPeriodMs === 0,
  }));
}

/**
 * The slot, in ms after a tick's sound onset (grid.at(k)), in which a walk of
 * one gesture may be issued: its run sound then starts after the first
 * `windowClearMs` of the tick's window and ends before the next window opens.
 * Null when no such slot exists (a 2000 ms grid is too short for a 1.48 s run).
 */
export function walkSlot(grid, hearing, gesture) {
  const q = hearing.quietWalk;
  const [onLo, onHi] = q.runOnsetAfterIssueMs[gesture];
  const lo = -grid.halfWidthMs + q.windowClearMs - onLo;
  const hi = grid.periodMs - grid.halfWidthMs - onHi - q.runLengthMs;
  return lo <= hi ? [lo, hi] : null;
}

/**
 * When to issue a walk so that our own carpet run -- the loudest sound in the
 * mix -- hides no grid instant. Room ticks (where a laugh must be heard) are
 * skipped: a walk waits for the next tick's slot. Returns a wall time >= now;
 * with no slot at all (shadow grid), now.
 */
export function quietTapAt(nowWall, grid, hearing, gesture, roomPeriodMs = 0) {
  const slot = walkSlot(grid, hearing, gesture);
  if (!slot) return nowWall;
  for (let k = grid.lastK(nowWall) - 1; ; k += 1) {
    if (roomPeriodMs && (k * grid.periodMs) % roomPeriodMs === 0) continue;
    const lo = grid.at(k) + slot[0]; const hi = grid.at(k) + slot[1];
    if (nowWall <= hi) return Math.max(nowWall, lo);
  }
}

/**
 * When to let go of a held door after tick k so that it has stayed shut
 * through the tick (a repel fires on it, g502/g503) and reads open in time for
 * a back issued at the start of the tick's press slot.
 */
export function releaseAt(k, grid, hearing) {
  const slot = walkSlot(grid, hearing, 'press');
  const open = hearing.door.openAfterReleaseMs[1];
  return grid.at(k) + Math.max(slot ? slot[0] - open : 0, hearing.door.releaseAfterOnsetMs);
}
