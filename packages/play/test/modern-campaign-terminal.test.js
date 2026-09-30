import { test } from 'node:test';
import assert from 'node:assert/strict';

import { terminalFromExecution } from '../src/campaign/modern-campaign-ports.js';

const target = { night: 5, mode: 'story' };

// night5-strokes1 (2026-09-12) is the run this pins. The executor stopped on
// its first positive `gameover` read at 03:06:42.950 and published it; the
// terminal port re-observed anyway, the screen was already gone (title at
// 03:06:44.823), and the campaign burned its full 120 s deadline before
// aborting a night that had ended normally. The death was then reported as
// `campaign-abort`, not as a death.
test('a published game-over is accepted without re-observing the screen', () => {
  const resolved = terminalFromExecution({ target, execution: { terminal: 'gameover' } });
  assert.ok(resolved, 'the executor published gameover; the port must not re-observe it');
  assert.equal(resolved.outcome, 'death');
  assert.equal(resolved.sixAm, false);
  assert.equal(resolved.positive, false);
  assert.equal(resolved.night, 5);
  assert.equal(resolved.state, 'gameover');
  assert.equal(resolved.source, 'executor');
});

test('a published six AM is accepted as a proven-positive terminal', () => {
  const resolved = terminalFromExecution({ target, execution: { terminal: 'sixam' } });
  assert.ok(resolved);
  assert.equal(resolved.outcome, 'sixam');
  assert.equal(resolved.sixAm, true);
  assert.equal(resolved.positive, true);
  assert.equal(resolved.state, 'sixam');
});

// The short-circuit must stay narrow: campaign-runner.js still treats an
// observer as authoritative when the executor's own poll missed the
// transition, so anything the executor did not positively publish has to fall
// through to observation rather than be invented here.
test('nothing else short-circuits observation', () => {
  for (const execution of [
    undefined, null, {}, { terminal: null }, { terminal: 'title' },
    { terminal: 'night' }, { terminal: 'static' }, { terminal: 'unknown' },
    { terminal: '' }, { terminal: 'GAMEOVER' },
  ])
    assert.equal(terminalFromExecution({ target, execution }), null,
      `execution ${JSON.stringify(execution)} must fall through to observation`);
});

// The state machine's `acceptTerminal` compares the terminal's night against
// the target's; a resolved terminal that dropped the night would silently HOLD
// with `terminal-night-identity-unknown`.
test('the resolved terminal carries the night and mode the machine checks', () => {
  const resolved = terminalFromExecution({
    target: { night: 6, mode: 'sixth' }, execution: { terminal: 'sixam' } });
  assert.equal(resolved.night, 6);
  assert.equal(resolved.identity, 'sixth');
});

// Pedro, 2026-09-30: a late handoff or arm release, a camera pair that never
// matched and a camera that never showed one end the attempt without testing
// its policy. The executor tags them (invalidRun), executeAttempt turns the
// tagged rejection into an INVALID execution, and this makes it the Invalid
// terminal the state machine replays without spending an attempt.
test('an Invalid execution is an Invalid terminal with its why', () => {
  const resolved = terminalFromExecution({ target, execution: { status: 'INVALID', why: 'late-night-handoff',
    detail: 'night handoff was 480ms late (budget 250ms)' } });
  assert.equal(resolved.outcome, 'invalid');
  assert.equal(resolved.why, 'late-night-handoff');
  assert.equal(resolved.sixAm, false);
  assert.equal(resolved.positive, false);
  assert.equal(resolved.night, 5, 'the machine checks the night before it reads the outcome');
  // campaign.test.js holds what the state machine does with it: a retry that
  // spends no attempt, and a hold after the second in a row.
});

test('a venue that moved during the night makes the run Invalid, whatever it showed', async () => {
  const { venueCheckedTerminal } = await import('../src/campaign/modern-campaign-ports.js');
  const sixAm = { night: 7, identity: 'custom', outcome: 'sixam', sixAm: true, positive: true, state: 'sixam' };
  const drift = [{ field: 'versionCode', from: '26', to: '27' }];
  const checked = venueCheckedTerminal(sixAm, drift);
  assert.equal(checked.outcome, 'invalid');
  assert.equal(checked.observedOutcome, 'sixam');
  assert.equal(checked.sixAm, false);
  assert.equal(checked.positive, false);
  assert.equal(checked.why, 'venue-drift: versionCode 26 -> 27');
  assert.equal(venueCheckedTerminal(sixAm, []), sixAm, 'no drift leaves the terminal as observed');
  const invalid = { ...sixAm, outcome: 'invalid', why: 'late-arm-release' };
  assert.equal(venueCheckedTerminal(invalid, drift), invalid, 'an Invalid terminal keeps its first why');
});

test('venue drift during a run counts only drift fields both readings know', async () => {
  const { venueDriftDuringRun } = await import('../src/campaign/venue.js');
  const { VENUE_DRIFT_FIELDS } = await import('@sixam/kernel/contracts');
  const [first, second] = VENUE_DRIFT_FIELDS;
  const before = { [first]: 'a', [second]: 'b', timeZone: 'America/Sao_Paulo', companionVersion: '1' };
  assert.deepEqual(venueDriftDuringRun(before, { ...before }), []);
  assert.deepEqual(venueDriftDuringRun(before, { ...before, [first]: 'c' }), [{ field: first, from: 'a', to: 'c' }]);
  assert.deepEqual(venueDriftDuringRun(before, { ...before, [second]: null }), [], 'an unread field is not drift');
  assert.deepEqual(venueDriftDuringRun(before, { ...before, timeZone: 'UTC', companionVersion: '2' }), [],
    'the note fields are recorded at preflight, never drift');
  assert.deepEqual(venueDriftDuringRun(null, before), [], 'no preflight reading, nothing to compare');
});
