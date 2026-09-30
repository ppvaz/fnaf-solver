// A `read` (observe-left) holds the left vent light, releases it, and presses
// the mask `maskGapMs` later -- the timing artifact-commands.mjs compiles and
// validates. The HID schedule used to send the mask press in the same instant
// as the release (it measured the gap from the read's start), and the phone
// lost that mask-on press on about half of a Night 1 minus7 run's cycles.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stableHash } from '@sixam/kernel/contracts';
import { compileDeviceLocalHidSchedule } from '../src/campaign/hid-schedule.js';

const profile = JSON.parse(await readFile(new URL('../../../apps/device/profiles/hid-mediaprojection.json', import.meta.url), 'utf8'));
const timing = { periodMs: 5000, loopStartMs: 0, stopAtMs: 5000, observeUntilMs: 5000, idleUntilMs: 0 };
const request = {
  schema: 'device-executor-v1', version: 1, mode: 'live',
  artifact: { winnerHash: 'a'.repeat(64), engineHash: 'b'.repeat(64), profileHash: 'c'.repeat(64),
    profileStableHash: stableHash(profile), plans: [{ night: 1, sha256: 'd'.repeat(64), timing }] },
  profile, limits: { maxActions: 64, maxDurationMs: 15000 },
  blocks: [{ schema: 'artifact-action-block-v1', id: 'opening-read', cycle: 'opening', night: 1, atMs: 367,
    actions: [{ schema: 'artifact-action-v1', id: 'opening-2', cycle: 'opening', atMs: 367, kind: 'observe-left',
      control: 'leftVentLight', requiresMonitorUp: false, durationMs: 600, maskGapMs: 40, targetMaskOn: true }] },
  { schema: 'artifact-action-block-v1', id: 'clear-wind', cycle: 'clear', night: 1, atMs: 3000,
    actions: [{ schema: 'artifact-action-v1', id: 'clear-1', cycle: 'clear', atMs: 3000, kind: 'hold',
      control: 'wind', requiresMonitorUp: false, durationMs: 100 }] }],
};
const schedule = compileDeviceLocalHidSchedule(request, { readyDelayMs: 6000 });
const body = schedule.events ?? schedule.lines ?? schedule.script;
const text = Array.isArray(body) ? body.join('\n') : String(body ?? JSON.stringify(schedule));
// The report sequence: vent down, 600 ms, vent up, the 40 ms gap, mask down, 33 ms, mask up.
const delays = [...text.matchAll(/delay[^0-9]*(\d+)/g)].map((m) => Number(m[1]));
const i = delays.indexOf(600);
assert.ok(i >= 0, `no 600 ms vent hold in the schedule:\n${text.slice(0, 800)}`);
assert.equal(delays[i + 1], 40, `the mask press must follow the vent release by the authored 40 ms gap, got ${delays[i + 1]} (delays ${delays.join(',')})`);
assert.equal(delays[i + 2], 33, 'the mask contact is 33 ms');
console.log('hid read gap: the read mask press follows the vent release by its authored gap');
