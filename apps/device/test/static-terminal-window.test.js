// A death's static must not end the night before its terminal screen is read.
//
// night7-corner-bbfoxy-r01-20260927T072310Z became UNKNOWN because three static
// reads ended it 4477 ms after the first one; the committed packs read Game
// Over up to 6306 ms after the first static. The executor's window is that
// measured maximum plus one observer interval, and this file holds it to the
// record that measured it (CLAUDE.md register item 9: a number that decides
// behaviour lives where a check reads it) before exercising the rule.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stableHash } from '@sixam/kernel/contracts';
import {
  AdbDeviceLocalArtifactExecutor, OBSERVER_INTERVAL_BOUND_MS, STATIC_TERMINAL_MAX_MS, STATIC_TERMINAL_WAIT_MS,
} from '../src/adb-device-local-executor.js';
import { SHARED_HID_RELEASE } from '../src/hid-schedule.js';

const RECORD_PATH = 'docs/evidence/static-terminal-window-20260927.json';
const record = JSON.parse(await readFile(new URL(`../../../${RECORD_PATH}`, import.meta.url), 'utf8'));
const executorSource = await readFile(new URL('../src/adb-device-local-executor.js', import.meta.url), 'utf8');

// --- The constant is the record's measurement plus its named margin ---------
assert.equal(record.schema, 'static-terminal-window-v1');
assert.match(record.evidenceId, /^static-terminal-window-[0-9a-f]{16}$/);
assert.equal(STATIC_TERMINAL_MAX_MS, record.window.measuredMaxMs,
  'the executor\'s static-to-terminal maximum must be the record\'s measured maximum');
assert.equal(OBSERVER_INTERVAL_BOUND_MS, record.staticAbort.observerIntervalBoundMs,
  'the executor\'s margin must be the record\'s observer-interval bound');
assert.equal(record.window.marginMs, record.staticAbort.observerIntervalBoundMs,
  'the record\'s named margin must be one observer interval');
assert.equal(STATIC_TERMINAL_WAIT_MS, STATIC_TERMINAL_MAX_MS + OBSERVER_INTERVAL_BOUND_MS,
  'the window is the measurement plus the margin, not a route-chosen number');
assert.equal(STATIC_TERMINAL_WAIT_MS, record.window.waitMs,
  'the executor\'s window must equal the record\'s derived window');
// Every terminal the packs read after a first static stands a full margin
// inside the window -- including the 6 AM read after a static abort.
const measuredDelays = [
  ...record.runs.staticToTerminal.map(item => item.delayMs),
  ...record.runs.staticAbort.filter(item => item.terminalAfterAbort).map(item => item.terminalAfterAbort.delayMs),
];
assert.ok(measuredDelays.length >= 32, 'the record must carry the measured terminal reads, not only their maximum');
for (const delayMs of measuredDelays)
  assert.ok(delayMs + OBSERVER_INTERVAL_BOUND_MS <= STATIC_TERMINAL_WAIT_MS,
    `a terminal read ${delayMs} ms after the first static must clear the window by one observer interval`);
assert.ok(record.observerIntervalDirect.n > 0 &&
  record.observerIntervalDirect.maxMs <= OBSERVER_INTERVAL_BOUND_MS,
  'every directly measured read-to-read gap inside a static episode must stay within the interval bound');
// Every old static exit happened inside the new window: each of these nights
// would now have withheld its third static read.
assert.ok(record.staticAbort.maxMs < STATIC_TERMINAL_WAIT_MS);
assert.ok(record.runs.staticAbort.some(item => item.run === 'night7-corner-bbfoxy-r01-20260927T072310Z'),
  'the record must include the run that motivated the window');
// The citation beside the constant names this record and its evidence id.
assert.ok(executorSource.includes(RECORD_PATH) && executorSource.includes(record.evidenceId),
  'the executor must cite the record and evidence id its window is derived from');

// --- The rule on a fake lifecycle observer ----------------------------------
const profile = JSON.parse(await readFile(new URL('../profiles/hid-mediaprojection.json', import.meta.url), 'utf8'));
const request = {
  schema: 'device-executor-v1', version: 1, mode: 'live',
  artifact: { winnerHash: 'a'.repeat(64), engineHash: 'b'.repeat(64), profileHash: 'c'.repeat(64),
    profileStableHash: stableHash(profile), plans: [{ night: 6, sha256: 'd'.repeat(64),
      timing: { periodMs: 1000, loopStartMs: 0, stopAtMs: 3000, observeUntilMs: 3000, idleUntilMs: 0 } }] },
  profile, limits: { maxActions: 64, maxDurationMs: 15000 },
  blocks: [{ schema: 'artifact-action-block-v1', id: 'opening-block', cycle: 'opening', night: 6, atMs: 0,
    actions: [{ schema: 'artifact-action-v1', id: 'opening-monitor', cycle: 'opening', atMs: 0,
      kind: 'ensure', control: 'monitor', targetMonitorUp: true }] },
  { schema: 'artifact-action-block-v1', id: 'toy-simple', cycle: 'toys', night: 6, atMs: 100,
    actions: [{ schema: 'artifact-action-v1', id: 'toy-simple-action', cycle: 'toys', atMs: 100,
      kind: 'hold', control: 'wind', durationMs: 33 }] }],
};

const fakeRoot = mkdtempSync(join(tmpdir(), 'fnaf2-static-window-'));
const fakeAdb = join(fakeRoot, 'adb');
writeFileSync(fakeAdb, '#!/bin/sh\ncase "$*" in *" logcat "*|*" test -e "*|*" touch "*) exit 0;; esac\ncat >/dev/null\nexec tail -f /dev/null\n');
chmodSync(fakeAdb, 0o755);

/** Replays `states`, then repeats the last one; records when each read returned. */
const scripted = (states, { readMs = 0 } = {}) => {
  const reads = [];
  return {
    reads,
    observe: async () => {
      if (readMs > 0) await new Promise(resolve => setTimeout(resolve, readMs));
      const state = states[Math.min(reads.length, states.length - 1)];
      reads.push({ state, at: Date.now() });
      return state;
    },
  };
};
const executorFor = (observer, events, extra = {}) => new AdbDeviceLocalArtifactExecutor({
  serial: 'fixture-device', adb: fakeAdb, readyDelayMs: 1, pollMs: 250,
  observe: observer.observe, onEvent: event => events.push(event), ...extra,
  timing: { pollMs: 1, ...(extra.timing ?? {}) } });

try {
  // 1. The r01 shape at the measured window: three static reads no longer end
  // the night, and the Game Over that follows is the night's terminal.
  {
    const events = [];
    const observer = scripted(['night', 'static', 'static', 'static', 'gameover']);
    const result = await executorFor(observer, events).execute(request);
    assert.equal(result.status, 'COMPLETED', 'a death read after its static must complete the attempt');
    assert.equal(result.terminal, 'gameover', 'the terminal must be the Game Over, not the static');
    assert.deepEqual(observer.reads.map(read => read.state), ['night', 'static', 'static', 'static', 'gameover'],
      'every static read inside the window must be withheld, not counted');
    const holds = events.filter(event => event.type === 'lifecycle.static-hold');
    assert.equal(holds.length, 1, 'one run of statics opens one hold');
    assert.equal(holds[0].waitMs, STATIC_TERMINAL_WAIT_MS, 'the default hold is the measured window');
    assert.ok(!events.some(event => event.type === 'lifecycle.static-hold.expired'));
  }

  // 2. A static misread inside a live night that ends at 6 AM (night5-perfetto1
  // read static, then 6 AM 5.76 s later): the 6 AM ends the night normally.
  {
    const events = [];
    const observer = scripted(['night', 'static', 'static', 'static', 'static', 'static', 'sixam']);
    const result = await executorFor(observer, events).execute(request);
    assert.equal(result.terminal, 'sixam', 'a 6 AM read inside the window must end the night as a 6 AM');
  }

  // 3. Since 2026-09-27 the first static after a night halts actuation, and
  // the halt is latched (post-night-halt.test.js): a night read between
  // statics resumes nothing and does not restart the window -- p1b read
  // `state=night` once from inside its death minigame. One hold, one halt.
  {
    const events = [];
    const observer = scripted(['night', 'static', 'static', 'night', 'static', 'static', 'static', 'gameover']);
    const result = await executorFor(observer, events).execute(request);
    assert.equal(result.terminal, 'gameover');
    assert.equal(events.filter(event => event.type === 'lifecycle.static-hold').length, 1,
      'a night read after the halt must not open a second hold');
    assert.equal(events.filter(event => event.type === 'lifecycle.actuation-halted').length, 1,
      'the first static halts actuation once');
  }

  // 4. Static that outlasts the window still ends the night, and only after
  // the window: with actuation halted, the first read past the window ends it
  // (it no longer waits for three post-window votes -- nothing is pressing).
  {
    const events = [];
    const waitMs = 120;
    const observer = scripted(['night', 'static'], { readMs: 10 });
    await assert.rejects(() => executorFor(observer, events, { timing: { staticTerminalWaitMs: waitMs } }).execute(request),
      /lifecycle left night state \(static\)/,
      'a static that persists past the window must still end the night');
    const statics = observer.reads.filter(read => read.state === 'static');
    const firstStaticAt = statics[0].at;
    const pastWindow = statics.filter(read => read.at - firstStaticAt >= waitMs);
    assert.ok(statics.length > 3, 'static reads inside the window must not have ended the night');
    assert.ok(pastWindow.length <= 1, 'the first read past the window ends the night');
    const expired = events.find(event => event.type === 'lifecycle.static-hold.expired');
    assert.ok(expired && expired.heldMs >= waitMs, 'the expiry must be recorded with how long the hold lasted');
  }

  // 5. The first static releases the HID (the halt); a stop from elsewhere
  // inside the window (in r01 a gate lost the mask read on the static screen)
  // still hands the terminal to the campaign's own read instead of ending the
  // attempt as "lifecycle left night state (static)", and writes nothing more.
  {
    const events = [];
    const writes = [];
    const sharedHid = { write: async value => { writes.push(value); } };
    let executor = null;
    let stoppedAfter = null;
    const states = ['night', 'static', 'static', 'static', 'static'];
    let index = 0;
    const observe = async () => {
      const state = states[Math.min(index, states.length - 1)];
      index += 1;
      if (index === states.length && stoppedAfter === null) {
        stoppedAfter = writes.length;
        setTimeout(() => { void executor.releaseAll(); }, 5);
      }
      return state;
    };
    executor = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb, readyDelayMs: 1,
      pollMs: 250, timing: { pollMs: 1 }, sharedHid: () => sharedHid, observe,
      onEvent: event => events.push(event) });
    const result = await executor.execute(request);
    assert.equal(result.status, 'COMPLETED', 'a stop inside the static window must not become a lifecycle ERROR');
    assert.equal(result.terminal, undefined, 'the executor publishes no terminal it did not read');
    assert.ok(stoppedAfter > 1, 'the schedule must have been written before the statics');
    assert.equal(writes.indexOf(SHARED_HID_RELEASE), stoppedAfter - 1,
      'the first static read releases the HID, and nothing is written after that release');
    assert.equal(writes.slice(stoppedAfter).length, 0, 'the external stop after the halt writes nothing more');
  }
} finally {
  rmSync(fakeRoot, { recursive: true, force: true });
}

console.log(`static terminal window: PASS (${STATIC_TERMINAL_WAIT_MS} ms = ${STATIC_TERMINAL_MAX_MS} + ` +
  `${OBSERVER_INTERVAL_BOUND_MS}, ${record.evidenceId})`);
