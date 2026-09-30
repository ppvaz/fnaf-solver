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
