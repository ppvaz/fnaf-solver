#!/usr/bin/env node
// FIXTURE: a receipt's update tag precedes the accepted poll; missing,
// coalesced and incomplete observations must remain UNKNOWN.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contactLedger, readRows } from './calib-contact.ts';

const updates = [0, 1, 1, 0, 0, 0].map((m, i) => ({ f: 3, fu: i + 1, u: i + 101, m, tp: 1000 + i * 100, te: 1010 + i * 100 }));
const events = [{ src: 'sdl', k: 'mdown', t: 1050, sdl_ms: 10, u: 101, x: 1780, y: 994 },
  { src: 'sdl', k: 'mup', t: 1250, sdl_ms: 12, u: 103, x: 1780, y: 994 }];
const states = Array.from({ length: 6 }, (_, i) => ({ update: i + 1, elapsed_ms: i + 10, office: { camera: i < 4 ? 0 : 9 } }));

test('receipt, polled update and monitor effect remain distinct measured quantities', () => {
  const result = contactLedger(updates, events, states);
  if (result.status !== 'MEASURED') assert.fail(result.reason);
  assert.deepEqual(result.edges.map(r => [r.receiptReportedUpdate, r.globalUpdate, r.officeUpdate]), [[101, 102, 2], [103, 104, 4]]);
  assert.deepEqual(result.edges.map(r => r.receiptToPollMs), [0.00005, 0.00005]);
  assert.equal(result.heldUpdates, 2);
  assert.deepEqual(result.effect, { stateUpdate: 5, camera: 9, updatesAfterPress: 3, sdlEventToStateMs: 4 });
  assert.equal(result.hostToDeviceLatency, 'UNKNOWN');
  assert.equal(result.requestedUpdateAccuracy, 'NOT_TESTED');
});

test('missing, ambiguous, unbracketed and gapped measurements cannot grade as accepted', () => {
  for (const [u, e, s] of [
    [updates, events.slice(0, 1), states],
    [updates, [...events, events[0]], states],
    [updates, [...events, { src: 'mt', k: 'new', u: 102 }], states],
    [updates, [{ ...events[0], t: 1110 }, events[1]], states],
    [updates.filter(r => r.fu !== 3), events, states],
    [updates.slice(1), events, states],
    [updates, events, states.filter(r => r.update !== 3)],
    [updates, events, states.map(r => ({ ...r, office: { camera: 0 } }))],
  ]) assert.equal(contactLedger(u, e, s).status, 'UNKNOWN');
});

test('only a partial final JSON row is omitted, and malformed measured fields are refused', () => {
  assert.deepEqual(readRows('{"u":1}\n{"u":'), { rows: [{ u: 1 }], ignoredPartialTail: true });
  assert.throws(() => readRows('{"u":\n{"u":2}\n'), /invalid JSON at line 1/);
  assert.throws(() => contactLedger([{ f: 3, fu: 1, u: 1, m: 0 }], [], []), /invalid calibration update/);
  assert.equal(contactLedger([{ session: {} }, ...updates, { f: 1, fu: 1, u: 107, m: 0, tp: 2000, te: 2010 },
    ...updates.map(r => ({ ...r, u: r.u + 200 }))], events, states).status, 'MEASURED');
});
