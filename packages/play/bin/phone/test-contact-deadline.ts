// FIXTURE: a late or invalid deadline cannot authorize a contact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactDeadline, awaitContactDeadline } from './contact-deadline.ts';

test('monotonic contact deadlines are explicit, future and bounded', () => {
  assert.equal(contactDeadline(undefined, 100), null);
  assert.equal(contactDeadline('101.5', 100), 101.5);
  assert.equal(contactDeadline('10100', 100), 10100);
  for (const text of ['', ' ', 'NaN', 'Infinity', '100', '-1', '10101'])
    assert.throws(() => contactDeadline(text, 100), /next 10 seconds/);
});

test('readiness after HID setup refuses expired targets and excessive wake-up delay', async () => {
  let clock = 100, waits = 0;
  const now = () => clock;
  const wait = async (at: number) => { waits++; clock = at + 0.25; return clock; };
  assert.deepEqual(await awaitContactDeadline(150, { now, wait }),
    { plannedHostMonoMs: 150, readyHostMonoMs: 150.25 });
  await assert.rejects(awaitContactDeadline(150, { now, wait }), /expired/);
  assert.equal(waits, 1);
  await assert.rejects(awaitContactDeadline(200, { now, wait: async () => { clock = 206; return clock; } }), /no press authorized/);
  await assert.rejects(awaitContactDeadline(300, { now, wait: async () => clock }), /no press authorized/);
});
