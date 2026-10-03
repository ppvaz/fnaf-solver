#!/usr/bin/env node
// Phone-free tests for native input/frame alignment.
import assert from 'node:assert/strict';
import { type Frame, type Row, analyze, buildQuery, classifyState, clockOffset, parseGameEvents } from './input-frame-align.ts';
import { test } from 'node:test';
test('dispatch and native frame alignment', async () => {


const row = (kind: string, ts: bigint, name: string): Row =>
  ({ kind, ts_ns: ts, dur_ns: 1n, name, thread_name: 'main', process_name: 'com.scottgames.fnaf2', track_name: 'game' });

function frames(finalMaskOff = true): Frame[] {
  const states: [number, bigint, bigint][] = [
    [0, 142n, 144n], [90, 142n, 144n],
    [120, 4n, 24n], [140, 0n, 144n],
    [320, 0n, 0n], [360, 142n, 144n],
    [520, 4n, 20n], [550, 142n, 20n],
    [720, 4n, 0n], [740, 142n, 0n],
  ];
  if (finalMaskOff) states.push([800, 142n, 144n]);
  return states.map(([t, mask, monitor], index) => ({ seq: BigInt(index + 1), image_ns: BigInt(t) * 1_000_000n, interval_ns: 0n,
    mask_downstroke: mask, monitor_downstroke: monitor, trace_ns: BigInt(t) * 1_000_000n, state: classifyState(mask, monitor) }));
}

// Query and clock.
const query = buildQuery("com.example.o'reilly");
assert.ok(query.includes('publishMotionEvent') && query.includes('receiveMessage'), 'query must include publication and game-channel receipt');
assert.ok(query.includes("com.example.o''reilly") && !query.includes('clock_snapshot'), 'package must be SQL escaped without mixing the clock query');
assert.ok(buildQuery('a$&b').includes("process_name = 'a$&b'"), 'the package is placed as written, as str.format placed it');
const [offset, clock] = clockOffset([
  { snapshot_id: 0n, clock_name: 'BOOTTIME', clock_value: 1100n },
  { snapshot_id: 0n, clock_name: 'MONOTONIC', clock_value: 100n },
  { snapshot_id: 1n, clock_name: 'BOOTTIME', clock_value: 2200n },
  { snapshot_id: 1n, clock_name: 'MONOTONIC', clock_value: 1200n },
]);
assert.ok(offset === 1000n && clock.spreadNs === 0n, 'clock offset must be derived from paired snapshots');

function syntheticRows(): Row[] {
  const rows = [
    row('publish', 1n, 'publishMotionEvent(inputChannel=game, action=DOWN)'),
    row('receive', 2n, 'receiveMessage(inputChannel=game, seq=0x1, type=MOTION)'),
    row('finish', 3n, 'receiveMessage(inputChannel=game, seq=0x1, type=FINISHED)'),
    row('publish', 4n, 'publishMotionEvent(inputChannel=game, action=MOVE)'),
    row('receive', 5n, 'receiveMessage(inputChannel=game, seq=0x2, type=MOTION)'),
    row('finish', 6n, 'receiveMessage(inputChannel=game, seq=0x2, type=FINISHED)'),
    row('publish', 7n, 'publishMotionEvent(inputChannel=game, action=UP)'),
    row('receive', 8n, 'receiveMessage(inputChannel=game, seq=0x3, type=MOTION)'),
    row('finish', 9n, 'receiveMessage(inputChannel=game, seq=0x3, type=FINISHED)'),
  ];
  // Four independent device contacts follow the injected menu triplet.
  const actions: [bigint, string, string][] = [[100_000_000n, 'DOWN', '0x10'], [110_000_000n, 'UP', '0x11'],
    [300_000_000n, 'DOWN', '0x12'], [310_000_000n, 'UP', '0x13'],
    [500_000_000n, 'DOWN', '0x14'], [510_000_000n, 'UP', '0x15'],
    [700_000_000n, 'DOWN', '0x16'], [710_000_000n, 'UP', '0x17']];
  for (const [ts, action, eventId] of actions) {
    rows.push(row('publish', ts, `publishMotionEvent(inputChannel=game, action=${action})`),
      row('receive', ts + 1n, `receiveMessage(inputChannel=game, seq=${eventId}, type=MOTION)`),
      row('finish', ts + 2n, `receiveMessage(inputChannel=game, seq=${eventId}, type=FINISHED)`),
      row('dispatch', ts, `dispatchInputEvent MotionEvent ACTION_${action} deviceId=9 source=0x1002 historySize=0`));
  }
  // The first three dispatches are injected menu events.
  for (const [ts, action] of [[1n, 'DOWN'], [4n, 'MOVE'], [7n, 'UP']] as const)
    rows.push(row('dispatch', ts, `dispatchInputEvent MotionEvent ACTION_${action} deviceId=-1 source=0x1002 historySize=0`));
  return rows.sort((a, b) => (a.ts_ns < b.ts_ns ? -1 : a.ts_ns > b.ts_ns ? 1 : 0));
}

// Alignment.
const events = parseGameEvents(syntheticRows());
assert.equal(events.length, 11, 'publication and receipt rows should pair');
assert.ok(events[3].origin === 'device' && events[0].origin === 'injected', 'dispatch ordinals should preserve input origin');
const report = analyze(frames(), events);
assert.ok(report.deviceContacts === 4 && report.visualAcceptedContacts === 4, 'all four synthetic transitions should be visually accepted');
assert.equal(report.contacts[0].departure_frame, 3n, 'first transition departure must be the first UNKNOWN frame');
assert.equal(report.contacts[0].settled_frame, 4n, 'first transition settle must be the first new-state frame');
assert.equal(report.contacts[0].observed_animation_ms, 20.0, 'animation duration must use native frame timestamps');
const refused = analyze(frames(false), events);
assert.equal(refused.contacts[refused.contacts.length - 1].status, 'VISUAL_DEPARTURE_NO_SETTLED_TARGET',
  'a delivered contact without a settled target must remain explicit');

console.log('input-frame-align: clock mapping, channel pairing, native frame landing, animation intervals, and no-effect reporting pass');

});
