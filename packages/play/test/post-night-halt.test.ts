// After a night, the first static read halts actuation and observation goes on.
//
// On 2026-09-27 the executor kept pressing through a death's static window and
// its presses went through the post-death screens: in
// night7-corner2-bbfoxy-r02-20260927T193022Z they skipped Game Over and entered
// Custom Night from the title, in night7-n7-420-minimal-m3-p1b-20260927T195732Z
// they opened the in-app store. This file holds the halting rule to the record
// that justifies it (docs/evidence/post-night-static-halt-20260927.json,
// packages/review/bin/grade/post-night-static.ts) and runs it on fake observers and HIDs:
// presses stop at the halt, the observer still reads the Game Over that
// follows, a window with no terminal still ends as a static exit, the halt is
// latched against a later night read, and a night with no death is untouched.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stableHash } from '@sixam/kernel/contracts';
import {
  AdbDeviceLocalArtifactExecutor, OBSERVER_INTERVAL_BOUND_MS, POST_NIGHT_STATIC_HALT, STATIC_TERMINAL_WAIT_MS,
} from '../src/campaign/adb-device-local-executor.ts';
import { SHARED_HID_RELEASE, compileDeviceLocalHidSchedule } from '../src/campaign/hid-schedule.ts';
import type { HidSchedule } from '../src/campaign/hid-schedule.ts';
import type { NightTiming } from '../src/campaign/campaign.ts';
import type { LifecycleState } from '../src/campaign/lifecycle-state.ts';

type ExecutorEvent = Parameters<NonNullable<NonNullable<ConstructorParameters<typeof AdbDeviceLocalArtifactExecutor>[0]>['onEvent']>>[0];

const RECORD_PATH = 'docs/evidence/post-night-static-halt-20260927.json';
const record = JSON.parse(await readFile(new URL(`../../../${RECORD_PATH}`, import.meta.url), 'utf8'));
const executorSource = await readFile(new URL('../src/campaign/adb-device-local-executor.ts', import.meta.url), 'utf8');

// --- The rule is the record's, and the comment's numbers are the record's ----
assert.equal(record.schema, 'post-night-static-halt-v1');
assert.match(record.evidenceId, /^post-night-static-halt-[0-9a-f]{16}$/);
assert.ok(executorSource.includes(RECORD_PATH) && executorSource.includes(record.evidenceId),
  'the executor must cite the record and evidence id its halting rule is derived from');
assert.equal(POST_NIGHT_STATIC_HALT, 'post-night-static');
// No static after a night was followed by a night that went on, except at
// 6 AM inside the window -- which the halted observer still reads.
for (const episode of record.episodes.nightWentOn) {
  assert.equal(episode.consecutiveNightReadsAfter < 2, true,
    `${episode.run}: the office read twice in a row after a post-night static refutes halting on the first one`);
  assert.equal(episode.end.state, 'sixam');
  assert.ok(episode.end.delayMs < STATIC_TERMINAL_WAIT_MS,
    `${episode.run}: a 6 AM after a static must fall inside the window the halted observer keeps`);
}
for (const episode of record.episodes.endedAtSixam)
  assert.equal(episode.insideWindow, episode.delayMs < STATIC_TERMINAL_WAIT_MS,
    'the record\'s window must be the executor\'s');
// Every night read after a static was a single misread (p1b's death minigame),
// which is why the halt is latched.
assert.ok(record.episodes.withNightReadAfter.length > 0 &&
  record.episodes.withNightReadAfter.every((item: { consecutiveNightReadsAfter: number }) => item.consecutiveNightReadsAfter < 2));
// The classifier misreads live nights, but never as static.
assert.equal(record.everyRead.liveNightMisreads['state=static'].liveNight, 0);
assert.ok(record.everyRead.liveNightMisreads['state=static'].reads > 0);
assert.ok(record.everyRead.liveNightMisreads['state=newspaper'].liveNight > 0,
  'the record must show the misreads a live night does produce, which is why other screens keep three votes');
// The numbers the executor's comment cites.
const perfetto = record.episodes.endedAtSixam.find((item: { run: string }) => item.run.startsWith('night5-perfetto1'));
const r02 = record.everyRead.byEpisode.find((item: { run: string }) => item.run.startsWith('night7-corner2-bbfoxy-r02'));
const cited = {
  episodes: record.episodes.n, packs: record.packs.scanned, gameover: record.episodes.byEnd.gameover,
  aborts: record.episodes.byEnd.intro, everyReadPacks: record.everyRead.packs, nightReads: record.everyRead.nightReads,
  staticReads: record.everyRead.postNightStaticReads,
  newspaper: record.everyRead.liveNightMisreads['state=newspaper'].liveNight,
  sixamMs: perfetto.delayMs, releaseMs: perfetto.gateReleasesAfterStaticMs[0], pressingMs: perfetto.pressingBeforeOldStopMs,
  secondReadMs: r02.secondReadMs, gapBeforeMs: r02.gapBeforeMs,
  nightGapsOver: record.everyRead.nightGaps.overBound, nightGaps: record.everyRead.nightGaps.n,
  nightGapMaxMs: record.everyRead.nightGaps.maxMs,
};
const haltComment = executorSource.slice(executorSource.indexOf('// The first static read after a night HALTS'),
  executorSource.indexOf('export const POST_NIGHT_STATIC_HALT'));
for (const [name, value] of Object.entries(cited))
  assert.ok(new RegExp(`\\b${value}\\b`).test(haltComment),
    `the executor's halting comment must cite the record's ${name} (${value})`);
assert.ok(r02.secondReadMs > OBSERVER_INTERVAL_BOUND_MS && r02.gapBeforeMs > OBSERVER_INTERVAL_BOUND_MS,
  'r02 is the measured violation of the observer-interval bound');

// --- Fixtures ---------------------------------------------------------------
const profile = JSON.parse(await readFile(new URL('../../../packages/play/profiles/fnaf2/moto-g56/hid-mediaprojection.json', import.meta.url), 'utf8'));
const action = (id: string, kind: string, control: string, atMs: number, extra = {}) => ({ schema: 'artifact-action-v1', id, cycle: 'toys', atMs,
  kind, control, ...extra });
const block = (id: string, atMs: number, actions: ReturnType<typeof action>[]) => ({ schema: 'artifact-action-block-v1', id, cycle: 'toys', night: 6, atMs, actions });
const artifact = (timing: NightTiming, extra = {}) => ({ winnerHash: 'a'.repeat(64), engineHash: 'b'.repeat(64),
  profileHash: 'c'.repeat(64), profileStableHash: stableHash(profile),
  plans: [{ night: 6, sha256: 'd'.repeat(64), timing, ...extra }] });
// Ungated: the whole body is written at the release.
const request = {
  schema: 'device-executor-v1', version: 1, mode: 'live',
  artifact: artifact({ periodMs: 1000, loopStartMs: 0, stopAtMs: 3000, observeUntilMs: 3000, idleUntilMs: 0 }),
  profile, limits: { maxActions: 64, maxDurationMs: 15000 },
  blocks: [{ schema: 'artifact-action-block-v1', id: 'opening-block', cycle: 'opening', night: 6, atMs: 0,
    actions: [action('opening-monitor', 'ensure', 'monitor', 0, { cycle: 'opening', targetMonitorUp: true })] },
  block('toy-simple', 100, [action('toy-simple-action', 'hold', 'wind', 100, { durationMs: 33 })])],
};
// Gated, observe-once: the executor writes one more segment at every gate,
// through the night, which is what a halt has to stop. 19 gates over 4.1 s of
// plan at the compressed gate timing below.
const gatedRequest = {
  schema: 'device-executor-v1', version: 1, mode: 'live',
  artifact: artifact({ periodMs: 400, loopStartMs: 0, stopAtMs: 4000, observeUntilMs: 4100, idleUntilMs: 0 },
    { armVerification: { cameras: ['cam:8', 'cam:11'], viewing: 'cam:11', untilMs: 100, mode: 'observe-once' } }),
  profile, limits: { maxActions: 64, maxDurationMs: 15000 },
  blocks: [
    { schema: 'artifact-action-block-v1', id: 'opening', cycle: 'opening', night: 6, atMs: 0, actions: [
      action('o-cam11', 'tap', 'cam:11', 0, { cycle: 'opening', requiresMonitorUp: true, durationMs: 33 }),
      action('o-cam8', 'tap', 'cam:8', 40, { cycle: 'opening', requiresMonitorUp: true, durationMs: 33 }),
      action('o-mon-down', 'ensure', 'monitor', 80, { cycle: 'opening', targetMonitorUp: false, durationMs: 33 }),
      action('o-mon-up', 'ensure', 'monitor', 120, { cycle: 'opening', targetMonitorUp: true, durationMs: 33 }),
      action('o-wind', 'hold', 'wind', 160, { cycle: 'opening', durationMs: 33, requiresMonitorUp: true }),
    ] },
    block('t-mask', 200, [action('t-mask-on', 'press', 'mask', 200, { targetMaskOn: true, durationMs: 33 })]),
    block('t-wind', 300, [action('t-wind', 'hold', 'wind', 300, { durationMs: 33 })]),
  ],
};
const gateTiming = { pollMs: 1, armSettleMs: 0, armObservationWindowMs: 500, gateRetryGapMs: 0,
  gateMinSlackMs: 10, gateBudgetMinMs: 10, gateBudgetMaxMs: 20, gateBudgetReserveMs: 40 };
// An observe-once arm compiles to a gated schedule.
const gatedSchedule = compileDeviceLocalHidSchedule(gatedRequest, { readyDelayMs: 1,
  gateTiming: { minSlackMs: 10, budgetMinMs: 10, budgetMaxMs: 20, budgetReserveMs: 40 } }) as
  HidSchedule & { gated: NonNullable<HidSchedule['gated']> };
assert.equal(gatedSchedule.gated.gates.length, 19, 'the gated fixture must keep writing through the night');

const fakeRoot = mkdtempSync(join(tmpdir(), 'fnaf2-post-night-halt-'));
const fakeAdb = join(fakeRoot, 'adb');
writeFileSync(fakeAdb, '#!/bin/sh\ncase "$*" in *" logcat "*|*" test -e "*|*" touch "*) exit 0;; esac\ncat >/dev/null\nexec tail -f /dev/null\n');
chmodSync(fakeAdb, 0o755);
// A device-local shell that says when it is killed.
const shellLog = join(fakeRoot, 'shell.log');
const loggingAdb = join(fakeRoot, 'logging-adb');
writeFileSync(loggingAdb, `#!/bin/sh\ncase "$*" in *" logcat "*|*" test -e "*|*" touch "*) exit 0;; esac\n` +
  `echo started >> '${shellLog}'\ntrap 'echo killed >> "${shellLog}"; exit 143' TERM\ncat >/dev/null\n` +
  'while :; do sleep 0.02; done\n');
chmodSync(loggingAdb, 0o755);

/**
 * One ordered log of writes, closes and events, so "nothing after the halt"
 * is a question about positions in it.
 */
/** One entry of the log: a line written, the shared process closed, or an executor event. */
type LogEntry = { kind: 'write', line: string, at: number } | { kind: 'close', at: number }
  | { kind: 'event', event: ExecutorEvent, at: number };
const harness = () => {
  const log: LogEntry[] = [];
  let closed = false;
  const hid = {
    write: async (value: string) => {
      if (closed) throw new Error('write after close');
      log.push({ kind: 'write', line: value, at: Date.now() });
    },
  };
  return {
    log, hid,
    close: async () => { closed = true; log.push({ kind: 'close', at: Date.now() }); },
    onEvent: (event: ExecutorEvent) => log.push({ kind: 'event', event, at: Date.now() }),
    events: () => log.filter(item => item.kind === 'event').map(item => item.event),
    writes: () => log.filter(item => item.kind === 'write'),
    indexOfEvent: (type: string) => log.findIndex(item => item.kind === 'event' && item.event.type === type),
  };
};
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

try {
  // 1. Presses stop at the halt; the observer still reads the Game Over.
  {
    const h = harness();
    let gatesSeen = 0;
    let halted = false;
    let readsAfterHalt = [];
    const observe = async () => {
      if (!halted) return gatesSeen >= 3 ? 'static' : 'night';
      readsAfterHalt.push(Date.now());
      // r01's shape: static again, then the Game Over.
      return readsAfterHalt.length === 1 ? 'static' : readsAfterHalt.length < 4 ? null : 'gameover';
    };
    const executor = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb, readyDelayMs: 1,
      pollMs: 250, timing: gateTiming, sharedHid: () => h.hid, closeSharedHid: h.close, observe,
      observeArm: async () => ({ sequence: 1, highlights: ['cam:8', 'cam:11'], viewing: null }),
      observeControlState: async () => ({ sequence: Date.now(), ageUs: 10, screen: 'FNAF2_NIGHT',
        monitorUp: false, maskOn: true, maskEvidence: 'fixture' }),
      onEvent: event => {
        h.onEvent(event);
        if (event.type === 'control.gate') gatesSeen += 1;
        if (event.type === 'lifecycle.actuation-halted') halted = true;
      } });
    const result = await executor.execute(gatedRequest);
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.terminal, 'gameover', 'the Game Over read after the halt must be the terminal');
    assert.ok(readsAfterHalt.length >= 4, 'the lifecycle observer must keep reading after the halt');
    const events = h.events();
    const halt = events.find(event => event.type === 'lifecycle.actuation-halted');
    assert.equal(halt?.reason, POST_NIGHT_STATIC_HALT);
    assert.equal(halt?.state, 'static');
    assert.equal(halt?.shared, true);
    assert.equal(events.find(event => event.type === 'lifecycle.actuation-stopped')?.method, 'hid-closed',
      'the owner must close the shared process: that is what kills its buffered stream');
    const haltAt = h.indexOfEvent('lifecycle.actuation-halted');
    const after = h.log.slice(haltAt + 1);
    assert.deepEqual(after.filter(item => item.kind === 'write').map(item => item.line), [SHARED_HID_RELEASE],
      'after the halt the only line written is the release report');
    assert.equal(after.filter(item => item.kind === 'close').length, 1, 'the shared process is closed once');
    assert.ok(!after.some(item => item.kind === 'event' && item.event.type === 'control.gate'),
      'no gate reads, corrects or releases after the halt');
    const segmentsWritten = h.log.slice(0, haltAt).filter(item => item.kind === 'event' &&
      item.event.type === 'control.gate').length;
    assert.ok(segmentsWritten >= 3 && segmentsWritten < gatedSchedule.gated.gates.length,
      'the halt must land mid-night, with gates still to come');
  }

  // 2. The no-death path is unchanged: every gate releases its segment, nothing
  // halts, and the 6 AM is the terminal.
  {
    const h = harness();
    let gatesSeen = 0;
    // The last gate's event precedes its release, so the night ends once that
    // release has written the final segment.
    const totalLines = gatedSchedule.gated.prefix.length +
      gatedSchedule.gated.remainderSegments.reduce((sum, segment) => sum + segment.length, 0);
    const finalWritten = () => gatesSeen >= gatedSchedule.gated.gates.length && h.writes().length >= totalLines;
    const executor = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb, readyDelayMs: 1,
      pollMs: 250, timing: gateTiming, sharedHid: () => h.hid, closeSharedHid: h.close,
      observe: async () => finalWritten() ? 'sixam' : 'night',
      observeArm: async () => ({ sequence: 1, highlights: ['cam:8', 'cam:11'], viewing: null }),
      observeControlState: async () => ({ sequence: Date.now(), ageUs: 10, screen: 'FNAF2_NIGHT',
        monitorUp: false, maskOn: true, maskEvidence: 'fixture' }),
      onEvent: event => {
        h.onEvent(event);
        if (event.type === 'control.gate') gatesSeen += 1;
      } });
    const result = await executor.execute(gatedRequest);
    assert.equal(result.terminal, 'sixam');
    const events = h.events();
    assert.ok(!events.some(event => event.type.startsWith('lifecycle.actuation') ||
      event.type === 'lifecycle.static-hold' || event.type === 'lifecycle.observe-gap'),
    'a night with no static must not halt, hold, or report gaps');
    assert.equal(events.filter(event => event.type === 'control.gate' && event.status === 'AGREED').length,
      gatedSchedule.gated.gates.length, 'every gate must still run');
    const lines = h.writes().map(item => item.line);
    for (const segment of gatedSchedule.gated.remainderSegments)
      for (const line of segment) assert.ok(lines.includes(line), 'every segment must still be written');
    assert.equal(lines.filter(line => line === SHARED_HID_RELEASE).length, 1, 'the terminal releases once, as before');
    assert.ok(!h.log.some(item => item.kind === 'close'), 'the executor does not close the process on a normal end');
  }

  // 3. A device-local shell is killed at the halt, and its exit is the halt,
  // not a transport failure: the Game Over after it completes the attempt.
  {
    const h = harness();
    let reads = 0;
    let halted = false;
    let afterHalt = 0;
    const executor = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: loggingAdb, readyDelayMs: 1,
      pollMs: 250, timing: { pollMs: 1 },
      observe: async () => {
        reads += 1;
        if (!halted) return reads < 4 ? 'night' : 'static';
        afterHalt += 1;
        await sleep(10);
        return afterHalt < 4 ? null : 'gameover';
      },
      onEvent: event => {
        h.onEvent(event);
        if (event.type === 'lifecycle.actuation-halted') halted = true;
      } });
    const result = await executor.execute(request);
    assert.equal(result.terminal, 'gameover');
    assert.equal(h.events().find(event => event.type === 'lifecycle.actuation-stopped')?.method, 'shell-killed');
    assert.deepEqual(readFileSync(shellLog, 'utf8').trim().split('\n'), ['started', 'killed'],
      'the device-local shell must be killed by the halt');
    assert.ok(afterHalt >= 4, 'the observer must outlive the shell it killed');
  }

  // 4. r02's shape: after the static, no read names a screen. The halted run
  // ends at the window's expiry as a static exit, with nothing written after
  // the halt, and every read-to-read gap over the bound from the halting read
  // on is evented -- but not the ones inside the live night before it.
  {
    const h = harness();
    const waitMs = 150;
    const boundMs = 20;
    let reads = 0;
    let halted = false;
    const executor = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb, readyDelayMs: 1,
      pollMs: 250, timing: { pollMs: 1, staticTerminalWaitMs: waitMs, observerGapBoundMs: boundMs },
      sharedHid: () => h.hid, closeSharedHid: h.close,
      observe: async () => {
        reads += 1;
        if (reads === 2) { await sleep(40); return 'night'; } // a slow read inside the live night
        if (reads < 5) return 'night';
        if (reads === 5) { await sleep(50); return 'static'; } // the halting read, late
        await sleep(30);
        return null;
      },
      onEvent: event => {
        h.onEvent(event);
        if (event.type === 'lifecycle.actuation-halted') halted = true;
      } });
    await assert.rejects(() => executor.execute(request), /lifecycle left night state \(static\)/,
      'a window that expires with no terminal read ends as the static exit the campaign already handles');
    const events = h.events();
    const halt = events.find(event => event.type === 'lifecycle.actuation-halted');
    const expired = events.find(event => event.type === 'lifecycle.static-hold.expired');
    assert.ok(halted && expired && Number(expired.heldMs) >= waitMs && Number(expired.at) - Number(halt?.at) === expired.heldMs,
      'the window is measured from the static read that halted actuation');
    const haltIndex = h.indexOfEvent('lifecycle.actuation-halted');
    assert.deepEqual(h.log.slice(haltIndex + 1).filter(item => item.kind === 'write').map(item => item.line),
      [SHARED_HID_RELEASE], 'nothing but the release is written after the halt');
    const gaps = events.filter(event => event.type === 'lifecycle.observe-gap');
    assert.ok(gaps.length >= 2, 'the post-night gaps over the bound must be evented');
    assert.ok(gaps.every(event => Number(event.gapMs) > boundMs && event.boundMs === boundMs && Number(event.at) >= Number(halt?.at)),
      'only gaps from the halting read on are evented, never a slow read inside the live night');
    assert.equal(gaps[0].state, 'static', 'the gap that ends at the halting read is the first one evented');
    assert.equal(halt?.gapMs, gaps[0].gapMs, 'the halt carries how long before it the previous read returned');
  }

  // 5. p1b's shape: two statics, a death minigame read as unknown, and one
  // `state=night` misread from inside it. The night read resumes nothing and
  // does not restart the window.
  {
    const h = harness();
    const waitMs = 150;
    let reads = 0;
    let nightAfterHaltAt = null;
    let halted = false;
    const executor = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb, readyDelayMs: 1,
      pollMs: 250, timing: { pollMs: 1, staticTerminalWaitMs: waitMs, observerGapBoundMs: 1000 },
      sharedHid: () => h.hid, closeSharedHid: h.close,
      observe: async () => {
        reads += 1;
        if (!halted) return reads < 3 ? 'night' : 'static';
        await sleep(10);
        if (reads === 4) return 'static';
        if (reads === 9) { nightAfterHaltAt = Date.now(); return 'night'; }
        return null;
      },
      onEvent: event => {
        h.onEvent(event);
        if (event.type === 'lifecycle.actuation-halted') halted = true;
      } });
    await assert.rejects(() => executor.execute(request), /lifecycle left night state \(static\)/);
    const events = h.events();
    assert.ok(nightAfterHaltAt !== null, 'the fixture must read a night after the halt');
    assert.equal(events.filter(event => event.type === 'lifecycle.actuation-halted').length, 1);
    assert.equal(events.filter(event => event.type === 'lifecycle.static-hold').length, 1);
    const expired = events.find(event => event.type === 'lifecycle.static-hold.expired');
    assert.ok(Number(expired?.at) - Number(nightAfterHaltAt) < waitMs,
      'the window must still run from the first static, not restart at the night misread');
    const haltIndex = h.indexOfEvent('lifecycle.actuation-halted');
    assert.deepEqual(h.log.slice(haltIndex + 1).filter(item => item.kind === 'write').map(item => item.line),
      [SHARED_HID_RELEASE], 'a night read after the halt must not resume the schedule');
  }

  // 6. What a live night does produce is left alone: a newspaper misread (60
  // in the record, every one inside a live night) and a static before any
  // night neither halt nor end the night.
  for (const states of [['night', 'night', 'newspaper', 'night', 'night', 'sixam'],
    ['static', 'night', 'night', 'night', 'sixam']] satisfies LifecycleState[][]) {
    const h = harness();
    let reads = 0;
    const executor = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb, readyDelayMs: 1,
      pollMs: 250, timing: { pollMs: 1 }, sharedHid: () => h.hid, closeSharedHid: h.close,
      observe: async () => states[Math.min(reads++, states.length - 1)], onEvent: h.onEvent });
    const result = await executor.execute(request);
    assert.equal(result.terminal, 'sixam', `${states.join(',')} must reach its 6 AM`);
    assert.ok(!h.events().some(event => event.type === 'lifecycle.actuation-halted'),
      `${states.join(',')} must not halt actuation`);
    assert.ok(!h.log.some(item => item.kind === 'close'));
  }

  // 7. A port-owned release that fires after the halt starts nothing.
  {
    const h = harness();
    let reads = 0;
    let executor = null as AdbDeviceLocalArtifactExecutor | null;
    executor = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb, readyDelayMs: 1,
      pollMs: 250, timing: { pollMs: 1 }, sharedHid: () => h.hid, closeSharedHid: h.close,
      nightReleaseOwner: 'port',
      observe: async () => {
        reads += 1;
        if (reads === 1) return 'night';
        if (reads === 2) return 'static';
        await sleep(5);
        return reads < 6 ? null : 'gameover';
      },
      onEvent: event => {
        h.onEvent(event);
        // executor is assigned before execute() emits any event.
        if (event.type === 'lifecycle.actuation-halted') setTimeout(() => (executor as AdbDeviceLocalArtifactExecutor).releaseNight(), 0);
      } });
    const result = await executor.execute(request);
    assert.equal(result.terminal, 'gameover');
    assert.deepEqual(h.writes().map(item => item.line), [SHARED_HID_RELEASE],
      'the schedule body must never be written once actuation has halted');
  }
} finally {
  rmSync(fakeRoot, { recursive: true, force: true });
}

console.log(`post-night halt: PASS (first static after a night halts actuation; ${record.evidenceId}: ` +
  `${record.episodes.n} episodes, ${record.episodes.nightWentOn.length} went on, inside the window)`);
