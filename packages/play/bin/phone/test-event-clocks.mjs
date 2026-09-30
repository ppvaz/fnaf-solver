// Every timestamp in a packed campaign night must name its clock.
//
// packages/kernel/src/time/event-clocks.js declares, field by field, which of
// the host wall, host monotonic, phone monotonic and phone wall clocks (or the
// plan, or a duration) each events.jsonl field was read from. This reads every
// committed campaign pack (docs/evidence/runs/*) and refuses a timestamp-like
// field nothing declares -- a new executor field has to be declared in the diff
// that adds it -- and a value implausible for its declared clock, which is how
// a field declared on the wrong clock shows. It also checks the dictionary
// against fixed rows, so it means something on a checkout with no packs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT_CLOCKS as C, clockOfField, eventTimestamps, plausibleForClock } from '@sixam/kernel/time';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const PACKS = join(ROOT, 'docs/evidence/runs');

// Fixed rows, one per clock, copied from real campaign events.
assert.equal(clockOfField('at'), C.HOST_WALL);
assert.equal(clockOfField('samples[].readStartedAt'), C.HOST_WALL);
assert.equal(clockOfField('sample.visualCaptureAt'), C.DEVICE_MONOTONIC, 'the helper capture stamp is the phone\'s clock, not the host\'s');
assert.equal(clockOfField('candidates[].releaseHostMs'), C.HOST_MONOTONIC);
assert.equal(clockOfField('onsetPhoneWallMs'), C.PHONE_WALL);
assert.equal(clockOfField('gateAtMs'), C.PLAN);
assert.equal(clockOfField('offsetMs'), C.OFFSET);
assert.equal(clockOfField('status'), null);
// The post-night halt's rows (adb-device-local-executor.js): the halt, the stop, and a gap over the bound.
for (const event of [
  { type: 'lifecycle.actuation-halted', at: 1790537593352, reason: 'post-night-static', state: 'static', waitMs: 8724, gapMs: 11776 },
  { type: 'lifecycle.actuation-stopped', at: 1790537593410, reason: 'post-night-static', method: 'hid-closed' },
  { type: 'lifecycle.observe-gap', at: 1790537601745, gapMs: 8393, boundMs: 2418, state: null },
]) for (const stamp of eventTimestamps(event)) {
  assert.notEqual(stamp.clock, 'UNKNOWN', `${event.type}.${stamp.path} must declare its clock`);
  assert.ok(plausibleForClock(stamp.clock, stamp.value), `${event.type}.${stamp.path} must be plausible for ${stamp.clock}`);
}
const anchor = { at: '2026-09-20T01:45:30.000Z', type: 'origin.anchor', onsetHostMs: 24986.1, onsetDeviceMs: 1050505904.2,
  onsetPhoneWallMs: 1789868728804.5, offsetMs: -1050478327.3, lateMs: 0.4, firedWallMs: 1789868734066, status: 'fired' };
const stamps = Object.fromEntries(eventTimestamps(anchor).map(stamp => [stamp.path, stamp.clock]));
assert.deepEqual(stamps, { at: C.HOST_WALL, onsetHostMs: C.HOST_MONOTONIC, onsetDeviceMs: C.DEVICE_MONOTONIC,
  onsetPhoneWallMs: C.PHONE_WALL, offsetMs: C.OFFSET, lateMs: C.DURATION, firedWallMs: C.HOST_WALL });
assert.equal(plausibleForClock(C.HOST_WALL, 24986.1), false, 'a host-monotonic value is not a wall time');
assert.equal(plausibleForClock(C.DEVICE_MONOTONIC, 1789868728804), false, 'a wall time is not a phone uptime');
assert.equal(eventTimestamps({ type: 'x', newThingAt: 5 })[0].clock, 'UNKNOWN');

let rows = 0;
let packs = 0;
const problems = [];
for (const id of existsSync(PACKS) ? readdirSync(PACKS).sort() : []) {
  const dir = join(PACKS, id);
  // Campaign packs only, including those recovered from a run log whose result was lost.
  if (!existsSync(join(dir, 'events.jsonl')) || !existsSync(join(dir, 'pack.json'))) continue;
  if (JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')).kind === 'fnaf1-run') continue;
  packs += 1;
  for (const [index, line] of readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').entries()) {
    if (!line.trim()) continue;
    rows += 1;
    const event = JSON.parse(line);
    for (const stamp of eventTimestamps(event)) {
      if (stamp.clock === 'UNKNOWN')
        problems.push(`${id} line ${index + 1} ${event.type}: ${stamp.path} has no declared clock`);
      else if (!plausibleForClock(stamp.clock, stamp.value))
        problems.push(`${id} line ${index + 1} ${event.type}: ${stamp.path}=${stamp.value} is implausible for ${stamp.clock}`);
    }
  }
}
if (problems.length) {
  console.error([...new Set(problems.map(problem => problem.replace(/ line \d+/, '')))].slice(0, 20).join('\n'));
  process.exit(1);
}
// The read side runs on packs as it runs on campaign directories: a pack keeps
// the file names, so run-report (and phase-reconstruct, too slow for this lane)
// project the committed night on any checkout.
const win = 'night6-n6h2-01-20260920T024030Z';
if (existsSync(join(PACKS, win))) {
  const report = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'packages/review/bin/grade/run-report.mjs'),
    '--run', join(PACKS, win), '--json'], { encoding: 'utf8' }));
  assert.equal(report.night.reached, true, 'run-report read the packed night');
  assert.equal(report.cycles.gates, 42, 'run-report counted the packed cycle gates');
}
console.log(`event clocks: ${rows} events in ${packs} campaign packs, every timestamp on a declared, plausible clock; run-report reads a pack`);
