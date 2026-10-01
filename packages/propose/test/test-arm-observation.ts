// The observe-once arm read lands only where the plan shows the camera map (arm-observation.ts), on the committed
// winners' own compiled schedules: never inside a planned monitor-down, and never the +2.7 s office read that left
// 52 of 53 Night 7 arms unresolved.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARM_READ_MARGIN_MS, armObservationTimes } from '../../play/src/campaign/arm-observation.ts';
import { compileDeviceLocalHidSchedule } from '../../play/src/campaign/hid-schedule.ts';
import { compileBundle } from '../bin/plans/bundle.ts';
import { laneRequest } from '../bin/plans/device-lane.ts';

const up = (atMs: number) => ({ atMs, targetMonitorUp: true });
const down = (atMs: number) => ({ atMs, targetMonitorUp: false });

// k3's opening: raised at 1616, lowered by the camdrop at 2333; the first cycle raises at 10100 and lowers at 14050.
const k3 = [up(0), down(883), up(1616), down(2333), up(10100), down(14050), up(20100), down(24050)];
assert.deepEqual(armObservationTimes(k3, { notBeforeMs: 2016, settleMs: 600 }), [10700, 20700],
  'the 1616-2333 window is too short after the settle; the read waits for the first cycle');
assert.ok(!armObservationTimes(k3, { notBeforeMs: 2016, settleMs: 600 }).includes(2616),
  'never the old armReadyAtMs + settle instant, which falls after the camdrop');
// A minimal plan whose monitor stays up through the arm: read inside that window.
assert.deepEqual(armObservationTimes([up(0), down(883), up(1616), down(4000)], { notBeforeMs: 1730, settleMs: 600 }), [2216]);
assert.deepEqual(armObservationTimes([up(1000), up(1500), down(5000)], { notBeforeMs: 0, settleMs: 600 }), [1600], 'a repeated up keeps the first raise');
assert.deepEqual(armObservationTimes([up(1000)], { notBeforeMs: 0, settleMs: 600 }), [1600], 'an interval the plan never closes');
assert.deepEqual(armObservationTimes(k3, { notBeforeMs: 0, settleMs: 600, limit: 1 }), [600], 'limit');
assert.deepEqual(armObservationTimes([down(500)], { notBeforeMs: 0, settleMs: 600 }), [], 'no up interval, no read');

// Every committed winner-v1 binding's compiled schedule: each read time sits inside a planned up interval, settled,
// and ends the margin before the plan lowers the monitor.
const WINNERS = join(fileURLToPath(new URL('.', import.meta.url)), '../bindings/fnaf2');
const scratch = mkdtempSync(join(tmpdir(), 'arm-observation-'));
let checked = 0;
try {
  for (const name of readdirSync(WINNERS).filter((f) => f.endsWith('-winner.json')).sort()) {
    const winner = JSON.parse(readFileSync(join(WINNERS, name), 'utf8'));
    if (winner.schema !== 'winner-v1') continue;
    const dir = join(scratch, name);
    const built = compileBundle(winner, dir);
    for (const night of built.manifest.nights) {
      const schedule = compileDeviceLocalHidSchedule(laneRequest(dir, night));
      if (!schedule.armObservation) continue;
      const transitions = schedule.monitorTransitions;
      const times = armObservationTimes(transitions, { notBeforeMs: schedule.armObservation.armReadyAtMs, settleMs: 600 });
      assert.ok(times.length > 0, `${name} night ${night}: no window shows the camera map after the arm`);
      for (const at of times) {
        const before = transitions.filter((t: { atMs: number }) => t.atMs <= at).at(-1);
        const next = transitions.find((t: { atMs: number, targetMonitorUp: boolean }) => t.atMs > at && !t.targetMonitorUp);
        assert.ok(before?.targetMonitorUp, `${name} night ${night}: a read at ${at} with the monitor planned down`);
        assert.ok(!next || at + ARM_READ_MARGIN_MS <= next.atMs, `${name} night ${night}: a read at ${at} too close to the lowering at ${next?.atMs}`);
      }
      checked += 1;
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
assert.ok(checked > 0, 'no committed winner compiled an arm-verifying schedule');
console.log(`arm observation: read times fixtures, and ${checked} committed winner schedules read the arm only with the camera map planned on screen`);
