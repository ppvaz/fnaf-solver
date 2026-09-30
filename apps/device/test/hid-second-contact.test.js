// A monitor press that would start within one Fusion poll of the first
// contact's release goes out on the second contact, so the game sees a new
// touch instead of the first one dragged. The arm's CAM 09 tap and its monitor
// drop 17 ms later are the case: on the first contact they merged, and Night 1
// minimal missed its double-camera arm on every attempt on 2026-09-27.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stableHash } from '@sixam/core/contracts';
import { compileDeviceLocalHidSchedule, SECOND_CONTACT_UNDER_MS } from '../src/hid-schedule.js';

const profile = JSON.parse(await readFile(new URL('../profiles/hid-mediaprojection.json', import.meta.url), 'utf8'));
const timing = { periodMs: 5000, loopStartMs: 0, stopAtMs: 5000, observeUntilMs: 5000, idleUntilMs: 0 };
const act = (id, atMs, kind, control, extra = {}) => ({ schema: 'artifact-action-v1', id, cycle: 'opening', atMs, kind, control,
  requiresMonitorUp: false, durationMs: 33, ...extra });
const request = {
  schema: 'device-executor-v1', version: 1, mode: 'live',
  artifact: { winnerHash: 'a'.repeat(64), engineHash: 'b'.repeat(64), profileHash: 'c'.repeat(64),
    profileStableHash: stableHash(profile), plans: [{ night: 1, sha256: 'd'.repeat(64), timing }] },
  profile, limits: { maxActions: 64, maxDurationMs: 15000 },
  blocks: [{ schema: 'artifact-action-block-v1', id: 'opening-arm', cycle: 'opening', night: 1, atMs: 833,
    actions: [act('opening-3', 833, 'tap', 'cam:9', { requiresMonitorUp: true }), act('opening-4', 883, 'tap', 'monitor'),
      act('opening-5', 1616, 'tap', 'monitor')] },
  { schema: 'artifact-action-block-v1', id: 'toys-wind', cycle: 'toys', night: 1, atMs: 3000,
    actions: [{ ...act('toys-1', 3000, 'hold', 'wind'), cycle: 'toys', durationMs: 100 }] }],
};
const reports = compileDeviceLocalHidSchedule(request, { readyDelayMs: 6000 }).lines.map((l) => JSON.parse(l))
  .filter((r) => r.command === 'report').map((r) => r.report);
// cam9 down (1 record, flags 3), up, then the drop 17 ms later: two records, the second active on contact 1.
assert.equal(SECOND_CONTACT_UNDER_MS, 33);
assert.deepEqual([reports[0][1], reports[0][2]], [1, 3], 'cam9 is a first-contact tap (ObjectClicked needs the mouse)');
assert.deepEqual([reports[2][1], reports[2][2], reports[2][7]], [2, 0, 7], 'the drop 17 ms after release goes out on contact 1');
assert.deepEqual([reports[3][1], reports[3][7]], [2, 4], 'and is released on contact 1');
assert.deepEqual([reports[4][1], reports[4][2]], [1, 3], 'a monitor press 700 ms later is an ordinary first-contact tap');
console.log('hid second contact: a monitor press inside one poll of a release goes out on the second contact');
