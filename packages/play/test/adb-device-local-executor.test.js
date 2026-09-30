import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stableHash } from '@sixam/kernel/contracts';
import { AdbDeviceLocalArtifactExecutor } from '../src/campaign/adb-device-local-executor.js';
import { compileDeviceLocalHidSchedule, sharedScheduleBody } from '../src/campaign/hid-schedule.js';
import { renderDeviceLocalScript } from '../src/campaign/device-shell.js';
import { expandNightBlocks } from '../src/campaign/device-local-executor.js';

const profile = JSON.parse(await readFile(new URL('../../../packages/play/profiles/fnaf2/moto-g56/hid-mediaprojection.json', import.meta.url), 'utf8'));
const timing = { periodMs: 1000, loopStartMs: 0, stopAtMs: 3000, observeUntilMs: 3000, idleUntilMs: 0 };
const action = (id, kind, control, atMs, extra = {}) => ({
  schema: 'artifact-action-v1', id, cycle: 'toys', atMs, kind, control, ...extra,
});
const block = (id, atMs, actions) => ({ schema: 'artifact-action-block-v1', id,
  cycle: 'toys', night: 6, atMs, actions });
const request = {
  schema: 'device-executor-v1', version: 1, mode: 'live',
  artifact: { winnerHash: 'a'.repeat(64), engineHash: 'b'.repeat(64), profileHash: 'c'.repeat(64),
    profileStableHash: stableHash(profile), plans: [{ night: 6, sha256: 'd'.repeat(64), timing }] },
  profile, limits: { maxActions: 64, maxDurationMs: 15000 },
  blocks: [
    { schema: 'artifact-action-block-v1', id: 'opening-block', cycle: 'opening', night: 6, atMs: 0,
      actions: [action('opening-monitor', 'ensure', 'monitor', 0, { cycle: 'opening', targetMonitorUp: true })] },
    block('toy-simple', 100, [action('toy-simple-action', 'hold', 'wind', 100, { durationMs: 33 })]),
    block('toy-sweep', 300, [action('toy-sweep-action', 'sweep-slot', 'cam:11', 300,
      { selectMs: 33, settleMs: 17, lightMs: 33, requiresMonitorUp: true })]),
    block('toy-hallraise', 500, [action('toy-hallraise-action', 'compound', 'hallLight', 500,
      { compound: 'hallraise', durationMs: 33, requiresMonitorUp: false, targetMonitorUp: true })]),
    block('toy-maskraise', 700, [action('toy-maskraise-action', 'compound', 'monitor', 700,
      { compound: 'maskraise', gapMs: 200, durationMs: 33, requiresMonitorUp: false, targetMonitorUp: true, targetMaskOn: false })]),
    block('toy-camdrop', 940, [action('toy-camdrop-action', 'compound', 'cameraFeedLight', 940,
      { compound: 'camdrop', leadMs: 10, durationMs: 33, tailMs: 10, requiresMonitorUp: true, targetMonitorUp: false })]),
    block('toy-hallvent', 1050, [action('toy-hallvent-action', 'compound', 'hallLight', 1050,
      { compound: 'hallvent', ventControl: 'rightVentLight', durationMs: 33, requiresMonitorUp: false })]),
  ],
};

const schedule = compileDeviceLocalHidSchedule(request, { readyDelayMs: 6000 });
assert.equal(schedule.schema, 'device-local-hid-schedule-v1');
assert.equal(schedule.night, 6);
assert.equal(schedule.readyDelayMs, 6000);
assert.ok(schedule.actionCount >= 10, 'opening and steady blocks must expand across the period');
assert.ok(schedule.lines.every(line => !line.includes('"duration":0')),
  'the on-device hid stream must never emit a zero delay');
const events = schedule.lines.map(line => JSON.parse(line));
assert.equal(events[0].command, 'register');
assert.deepEqual(events[0].feature_reports, [{ id: 1, data: [0] }],
  'the gameplay HID registration must answer Android feature-report queries');
assert.equal(events[1].command, 'delay');
assert.equal(events[1].duration, 6000);
assert.ok(events.some(event => event.command === 'report' && event.report[1] === 2),
  'compound actions must use well-formed two-contact reports');
assert.equal(events.at(-1).command, 'delay');
assert.equal(events.at(-1).duration, 7);

// A live phase correction shifts the complete phone-local stream once, without
// changing the authored intervals or the ready delay.
const phaseRequest = structuredClone(request);
phaseRequest.artifact.plans[0].timing = {
  ...phaseRequest.artifact.plans[0].timing, observeUntilMs: 4000,
  phaseOffsetMs: 333,
};
const phaseSchedule = compileDeviceLocalHidSchedule(phaseRequest, { readyDelayMs: 6000 });
const phaseEvents = phaseSchedule.lines.map(line => JSON.parse(line));
assert.equal(phaseSchedule.phaseOffsetMs, 333);
assert.equal(phaseEvents[1].duration, 6000);
assert.equal(phaseEvents[2].duration, 333,
  'phase correction must be an initial phone-local delay after HID readiness');

// A non-zero loop start is an idle prefix for the repeatable cycle, not an
// offset to add to the authored opening. This is the Night 1 arm shape: the
// opening must land at t=0 while steady work begins at the 2 AM boundary.
const shiftedRequest = structuredClone(request);
shiftedRequest.artifact.plans[0].timing.loopStartMs = 2000;
const shiftedBlocks = expandNightBlocks(shiftedRequest, 6);
assert.equal(shiftedBlocks[0].cycle, 'opening');
assert.equal(shiftedBlocks[0].scheduleAtMs, 0,
  'opening must remain on the authored night timeline when loopStartMs is non-zero');
assert.equal(shiftedBlocks.find(block => block.cycle === 'toys').scheduleAtMs, 2100,
  'steady blocks must begin at loopStartMs plus their authored offset');
assert.ok(events.every(event => event.command === 'register' || event.command === 'report' || event.command === 'delay'),
  'compiled stream must stay within the closed hid vocabulary');
const remote = renderDeviceLocalScript(schedule);
assert.match(remote, /stream=\/data\/local\/tmp\/fnaf2-modern-hid-\$\$\.jsonl/,
  'remote stream file must remain PID-scoped');
assert.doesNotMatch(remote, /mkfifo|fifo=/,
  'device-local shell must not require named-pipe creation on Android 16');
assert.match(remote, /printf '[^']*'[^\n]+>> \"\$stream\"/,
  'device-local shell must preload the bounded HID stream before starting hid');
assert.ok(remote.indexOf('/system/bin/hid - < "$stream"') < remote.lastIndexOf('wait "$hid_pid"'),
  'device-local shell must start hid from the preloaded stream before waiting');

const armRequest = structuredClone(request);
armRequest.blocks = [armRequest.blocks[0],
  block('toy-tail', 2500, [action('toy-tail-action', 'hold', 'wind', 2500, { durationMs: 33 })])];
armRequest.artifact.plans[0].armVerification = {
  cameras: ['cam:8', 'cam:11'], viewing: 'cam:11', untilMs: 2000,
};
armRequest.blocks[0].actions.push(
  action('opening-cam11', 'tap', 'cam:11', 200,
    { cycle: 'opening', requiresMonitorUp: true, durationMs: 33 }),
  action('opening-cam8', 'tap', 'cam:8', 250,
    { cycle: 'opening', requiresMonitorUp: true, durationMs: 33 }),
  action('opening-monitor-down', 'ensure', 'monitor', 1200,
    { cycle: 'opening', targetMonitorUp: false, durationMs: 33 }),
  action('opening-monitor-up', 'ensure', 'monitor', 1600,
    { cycle: 'opening', targetMonitorUp: true, durationMs: 33 }),
);
armRequest.blocks[0].actions.push(action('opening-wind', 'hold', 'wind', 2200,
  { cycle: 'opening', durationMs: 33, requiresMonitorUp: true }));
const armSchedule = compileDeviceLocalHidSchedule(armRequest, { readyDelayMs: 6000 });
const armEvents = armSchedule.lines.map(line => JSON.parse(line));
assert.ok(armEvents.some(event => event.command === 'report' && event.report.includes(0)),
  'the CAM08 arm request must compile into the same device-local HID stream');
assert.equal(armSchedule.gated.firstWindAtMs, 2200,
  'the gated schedule must identify the opening wind boundary');
assert.equal(armSchedule.gated.phaseBudgetMs, 2000,
  'the gated schedule must carry the arm phase budget');
const observeOnceRequest = structuredClone(armRequest);
observeOnceRequest.artifact.plans[0].armVerification.mode = 'observe-once';
const observeOnceSchedule = compileDeviceLocalHidSchedule(observeOnceRequest, { readyDelayMs: 6000 });
// Observe-once scopes to the ARM ONLY (Pedro, 2026-09-12). It must not park
// the stream -- and it must still compile the per-cycle state gates, which the
// old contract threw away with the blocking wait. A 2026-09-12 device run
// under the old behaviour had zero gates, inverted mask parity at the 1 AM
// edge, and nothing left that could repair it.
assert.ok(observeOnceSchedule.gated,
  'observe-once must still compile the per-cycle state gates');
assert.deepEqual(observeOnceSchedule.gated.gates, armSchedule.gated.gates,
  'observe-once must compile exactly the cycle gates blocking mode compiles');
assert.deepEqual(observeOnceSchedule.gated.maskCorrection, armSchedule.gated.maskCorrection,
  'observe-once must retain the same authored mask correction');
assert.deepEqual(observeOnceSchedule.gated.remainderSegments, armSchedule.gated.remainderSegments,
  'the two arm modes must differ only in the handover, never in the schedule');
{
  const parked = sharedScheduleBody(observeOnceSchedule, { armObserveOnce: false });
  const unparked = sharedScheduleBody(observeOnceSchedule, { armObserveOnce: true });
  assert.deepEqual(parked, observeOnceSchedule.gated.prefix,
    'blocking hands over the prefix alone, which is what parks the stream');
  assert.deepEqual(unparked,
    [...observeOnceSchedule.gated.prefix, ...observeOnceSchedule.gated.remainderSegments[0]],
    'observe-once must hand over the prefix AND the first gated segment, so ' +
    'the stream runs through the arm point and adds no phase lag');
  assert.ok(unparked.length > parked.length,
    'the observe-once handover must be strictly longer than the parked one');
}
assert.equal(observeOnceSchedule.armObservation.firstWindAtMs, 2200,
  'observe-once verification must retain the authored first-wind boundary');
assert.equal(observeOnceSchedule.armObservation.armReadyAtMs, armSchedule.gated.armReadyAtMs,
  'observe-once verification must use the same physical arm prefix timing');
// Runtime executor tests use the same arm shape at a compressed authored
// timeline. The physical production constants remain unchanged; the shorter
// fixture keeps these tests event-driven instead of sleeping through a model
// night just to reach the arm window.
const runtimeArmRequest = structuredClone(armRequest);
runtimeArmRequest.artifact.plans[0].timing = {
  periodMs: 300, loopStartMs: 0, stopAtMs: 300, observeUntilMs: 400, idleUntilMs: 0,
};
runtimeArmRequest.artifact.plans[0].armVerification.untilMs = 100;
runtimeArmRequest.blocks[0].actions = [
  action('runtime-cam11', 'tap', 'cam:11', 0,
    { cycle: 'opening', requiresMonitorUp: true, durationMs: 33 }),
  action('runtime-cam8', 'tap', 'cam:8', 40,
    { cycle: 'opening', requiresMonitorUp: true, durationMs: 33 }),
  action('runtime-monitor-down', 'ensure', 'monitor', 80,
    { cycle: 'opening', targetMonitorUp: false, durationMs: 33 }),
  action('runtime-monitor-up', 'ensure', 'monitor', 120,
    { cycle: 'opening', targetMonitorUp: true, durationMs: 33 }),
  action('runtime-opening-wind', 'hold', 'wind', 160,
    { cycle: 'opening', durationMs: 33, requiresMonitorUp: true }),
];
runtimeArmRequest.blocks = [runtimeArmRequest.blocks[0],
  block('runtime-toy-tail', 240, [action('runtime-toy-wind', 'hold', 'wind', 240,
    { durationMs: 33 })])];
const runtimeObserveOnceRequest = structuredClone(runtimeArmRequest);
runtimeObserveOnceRequest.artifact.plans[0].armVerification.mode = 'observe-once';
const lateRuntimeArmRequest = structuredClone(runtimeArmRequest);
lateRuntimeArmRequest.artifact.plans[0].armVerification.untilMs = 100;
const fastGateRequest = structuredClone(runtimeArmRequest);
fastGateRequest.artifact.plans[0].timing.periodMs = 400;
fastGateRequest.artifact.plans[0].timing.stopAtMs = 400;
fastGateRequest.artifact.plans[0].timing.observeUntilMs = 500;
fastGateRequest.artifact.plans[0].armVerification.untilMs = 100;
fastGateRequest.blocks = [fastGateRequest.blocks[0],
  block('runtime-mask', 200, [action('runtime-mask-on', 'press', 'mask', 200,
    { cycle: 'toys', targetMaskOn: true, durationMs: 33 })]),
  block('runtime-gate-tail', 300, [action('runtime-gate-wind', 'hold', 'wind', 300,
    { durationMs: 33 })])];
const armRemote = renderDeviceLocalScript(armSchedule, {
  startMarker: '/data/local/tmp/fnaf2-modern-start-test',
  armControl: {
    go: '/data/local/tmp/fnaf2-modern-go-test',
    retry: '/data/local/tmp/fnaf2-modern-retry-test',
    fail: '/data/local/tmp/fnaf2-modern-fail-test',
    rearm: '/data/local/tmp/fnaf2-modern-rearm-test',
    nightGo: '/data/local/tmp/fnaf2-modern-night-go-test',
    gateGo: '/data/local/tmp/fnaf2-modern-gate-go-test',
    gateFix: '/data/local/tmp/fnaf2-modern-gate-fix-test',
  },
});
// The cycle-boundary gate is placed only where the plan already idles, so no
// authored contact moves, and it asserts the plan's own mask belief there.
const gateRequest = structuredClone(armRequest);
gateRequest.artifact.plans[0].timing = {
  periodMs: 4000, loopStartMs: 0, stopAtMs: 12000, observeUntilMs: 16000, idleUntilMs: 0,
};
gateRequest.blocks = [gateRequest.blocks[0],
  block('toy-mask', 2600, [action('toy-mask-action', 'press', 'mask', 2600,
    { targetMaskOn: true, durationMs: 33 })]),
  block('toy-wind', 3000, [action('toy-wind-action', 'hold', 'wind', 3000,
    { durationMs: 33, requiresMonitorUp: true })])];
const gateSchedule = compileDeviceLocalHidSchedule(gateRequest, { readyDelayMs: 6000 });
const gates = gateSchedule.gated.gates;
assert.ok(gates.length >= 2, 'each idle cycle boundary must offer a gate');
// The budget is spent out of the idle each gate actually has, never added to
// it, so a wider idle buys more attempts and the authored contact never moves.
assert.ok(gates.every(entry => entry.budgetMs >= 2200 && entry.budgetMs <= 4000),
  'a gate must reserve a budget its own idle can pay for');
assert.ok(gates.every(entry => entry.gateAtMs + entry.budgetMs === 6600 ||
  entry.gateAtMs + entry.budgetMs === 10600),
  'a gate must release exactly on the authored contact it guards');
assert.ok(gates.every(entry => entry.believedMaskOn === true),
  "a gate must carry the plan's own mask belief at that instant");
assert.equal(gateSchedule.gated.remainderSegments.length, gates.length + 1,
  'the stream must be split into one more segment than it has gates');
assert.ok(gateSchedule.gated.maskCorrection.length > 0,
  'the corrective contact must be compiled from the authored mask press');
// The gate is carved out of existing idle: it never displaces a contact.
for (const entry of gates)
  assert.ok(gateRequest.blocks.every(item => item.actions.every(inner =>
    inner.atMs !== entry.gateAtMs)), 'a gate must not land on an authored contact');

// Timing neutrality is the whole claim: walk the gated stream the way the
// phone will -- delays run, each gate consumes exactly its budget -- and every
// authored contact must still land on the instant the plan authored it.
{
  let cursor = gateSchedule.gated.armReadyAtMs;
  const contacts = [];
  gateSchedule.gated.remainderSegments.forEach((segment, index) => {
    for (const raw of segment) {
      const item = JSON.parse(raw);
      if (item.command === 'delay') cursor += item.duration;
      else if (item.command === 'report' && item.report[1] > 0) contacts.push(Math.round(cursor));
    }
    const entry = gateSchedule.gated.gates[index];
    if (entry) cursor = entry.gateAtMs + entry.budgetMs;
  });
  assert.equal(cursor, gateSchedule.plannedUntilMs,
    'a gated stream must still end on the observation envelope');
  assert.ok(contacts.includes(2600) && contacts.includes(3000),
    'gating must not move the authored mask and wind contacts');
}

assert.match(armRemote, /sleep 6/, 'the gated stream must place setup delay before the start marker');
assert.match(armRemote, /cat "\$gate_correction"/,
  'the gated stream must be able to emit the corrective contact on demand');
assert.match(armRemote, /rm -f "\$gate_go"/,
  'each released gate must consume its marker so the next one blocks');
assert.match(armRemote, /arm_retry_signal=/, 'the gated stream must expose a bounded retry signal');
assert.match(armRemote, /cat "\$arm_prefix"/, 'the gated stream must emit the opening prefix first');
assert.match(armRemote, /\) \| \/system\/bin\/hid -/, 'the gated stream must use a shell pipe, not a named fifo');

// Night 1 minimal moves the first wind into the repeat cycle at an absolute
// 140.3 s. The arm compiler must still gate that wind on the opening split.
const delayedArmRequest = structuredClone(armRequest);
delayedArmRequest.artifact.plans[0].timing = {
  periodMs: 5000, loopStartMs: 140000, stopAtMs: 360000,
  observeUntilMs: 420000, idleUntilMs: 0,
};
delayedArmRequest.artifact.plans[0].armVerification = {
  cameras: ['cam:8', 'cam:11'], viewing: 'cam:11', untilMs: 140250,
};
delayedArmRequest.blocks[0].actions = delayedArmRequest.blocks[0].actions
  .filter(item => item.control !== 'wind');
delayedArmRequest.blocks = [delayedArmRequest.blocks[0],
  block('toy-delayed-wind', 300, [action('toy-delayed-wind-action',
    'hold', 'wind', 300, { durationMs: 33, requiresMonitorUp: true })])];
const delayedSchedule = compileDeviceLocalHidSchedule(delayedArmRequest, { readyDelayMs: 6000 });
assert.equal(delayedSchedule.gated.firstWindAtMs, 140300,
  'minimal Night 1 must place its first wind on the expanded repeat timeline');
assert.equal(delayedSchedule.gated.armReadyAtMs, 1633,
  'minimal Night 1 must verify after the opening raise, not after the 140 s idle');

// The effect ledger retains semantic targets in both directions. In
// particular, a maskraise contains two distinct contacts: mask off at its
// start and monitor up only at its declared gap.
const effectRequest = structuredClone(request);
effectRequest.artifact.plans[0].timing = {
  periodMs: 300, loopStartMs: 0, stopAtMs: 300, observeUntilMs: 400, idleUntilMs: 0,
};
effectRequest.blocks = [{ schema: 'artifact-action-block-v1', id: 'effect-opening',
  cycle: 'opening', night: 6, atMs: 0, actions: [
    action('effect-monitor-down', 'ensure', 'monitor', 0,
      { cycle: 'opening', targetMonitorUp: false, durationMs: 33 }),
    action('effect-mask-up', 'press', 'mask', 40,
      { cycle: 'opening', targetMaskOn: true, durationMs: 33 }),
    action('effect-monitor-up', 'ensure', 'monitor', 80,
      { cycle: 'opening', targetMonitorUp: true, durationMs: 33 }),
    action('effect-mask-down', 'press', 'mask', 120,
      { cycle: 'opening', targetMaskOn: false, durationMs: 33 }),
  ] },
  // A night is only runnable with a repeatable cycle beside its opening. This
  // wind hold carries no monitor/mask target, so the ledger below stays
  // exactly the four authored transitions.
  block('effect-steady', 160, [action('effect-wind', 'hold', 'wind', 160, { durationMs: 33 })])];
const effectSchedule = compileDeviceLocalHidSchedule(effectRequest, { readyDelayMs: 1 });
assert.deepEqual(effectSchedule.monitorTransitions.map(item => [item.actionId, item.atMs, item.targetMonitorUp]), [
  ['effect-monitor-down', 0, false], ['effect-monitor-up', 80, true],
], 'the compiled ledger must retain monitor-down and monitor-up targets');
assert.deepEqual(effectSchedule.maskTransitions.map(item => [item.actionId, item.atMs, item.targetMaskOn]), [
  ['effect-mask-up', 40, true], ['effect-mask-down', 120, false],
], 'the compiled ledger must retain mask-on and mask-off targets');

const fakeRoot = mkdtempSync(join(tmpdir(), 'fnaf2-modern-executor-'));
const fakeAdb = join(fakeRoot, 'adb');
writeFileSync(fakeAdb, '#!/bin/sh\ncase "$*" in *" logcat "*|*" test -e "*|*" touch "*) exit 0;; esac\ncat >/dev/null\nexec tail -f /dev/null\n');
chmodSync(fakeAdb, 0o755);
const gateAdb = join(fakeRoot, 'gate-adb');
writeFileSync(gateAdb, '#!/bin/sh\ncase "$*" in *" logcat "*|*" test -e "*|*" touch "*) exit 0;; esac\ncat >/dev/null\nexec tail -f /dev/null\n');
chmodSync(gateAdb, 0o755);
const effectAdb = join(fakeRoot, 'effect-adb');
writeFileSync(effectAdb, '#!/bin/sh\ncase "$*" in *" logcat "*) echo "I am_anr : [0,1,com.scottgames.fnaf2,0,Input dispatching timed out]"; exit 0;; *" test -e "*|*" touch "*) exit 0;; esac\ncat >/dev/null\nexec tail -f /dev/null\n');
chmodSync(effectAdb, 0o755);
const finishAfter = (events, predicate) => {
  let finished = false;
  return {
    observe: async () => finished ? 'gameover' : 'night',
    onEvent: event => {
      events.push(event);
      if (predicate(event)) finished = true;
    },
  };
};
try {
  let observations = 0;
  const guarded = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb,
    readyDelayMs: 1, pollMs: 250, timing: { pollMs: 1 },
    observe: async () => { observations += 1; return 'gameover'; } });
  const stopped = await guarded.execute(request);
  assert.equal(stopped.terminal, 'gameover', 'fresh game-over must stop the remote schedule as a failed attempt');
  assert.ok(observations >= 1, 'executor must sample the lifecycle while a schedule is running');

  let terminalObservations = 0;
  const immediateTerminal = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb,
    readyDelayMs: 1, pollMs: 250, timing: { pollMs: 1 },
    observe: async () => terminalObservations++ === 0 ? 'night' : 'gameover' });
  const immediateTerminalResult = await immediateTerminal.execute(request);
  assert.equal(immediateTerminalResult.terminal, 'gameover',
    'a definitive game-over must stop on its first positive terminal frame');
  assert.equal(terminalObservations, 2,
    'game-over must not spend the non-night confirmation window');

  // A title HID is already registered and InputReader-ready. The gameplay
  // handoff must append only the authored body to that process: a second
  // register/ready prefix would recreate the opening delay this path removes.
  const sharedWrites = [];
  const sharedEvents = [];
  const sharedHid = { write: async value => { sharedWrites.push(JSON.parse(value)); } };
  let sharedObservations = 0;
  const shared = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb,
    readyDelayMs: 1, pollMs: 250, timing: { pollMs: 1 }, sharedHid: () => sharedHid,
    observe: async () => sharedObservations++ === 0 ? 'night' : 'gameover',
    onEvent: event => sharedEvents.push(event) });
  const sharedResult = await shared.execute(request);
  assert.equal(sharedResult.terminal, 'gameover', 'shared HID handoff must retain terminal handling');
  assert.ok(sharedWrites.length > 0, 'shared HID handoff must write the authored body');
  assert.ok(sharedWrites.every(event => event.command !== 'register'),
    'shared HID handoff must not register a second device');
  assert.ok(!sharedWrites.some(event => event.command === 'delay' && event.duration === 1),
    'shared HID handoff must not replay the ready delay');
  assert.ok(sharedEvents.some(event => event.type === 'hid.handoff-reused'),
    'shared HID handoff must be explicit in the run event stream');
  assert.equal(sharedEvents.find(event => event.type === 'hid.night-go')?.source, 'lifecycle',
    'the executor must release a shared HID on its own first authoritative night frame');
  const sharedHandoff = sharedEvents.find(event => event.type === 'hid.handoff');
  assert.ok(sharedHandoff, 'shared HID handoff must measure the first delivered action');
  assert.ok(sharedHandoff.delayMs <= sharedHandoff.budgetMs,
    'an on-time handoff must remain inside the fail-fast budget');

  // A port-owned release: the office frame authorizes, and nothing is written
  // until the composition calls releaseNight() at its placed instant.
  const portEvents = [];
  const portWrites = [];
  let portReleasedAt = null;
  const portHid = { write: async value => { portWrites.push({ at: Date.now(), value: JSON.parse(value) }); } };
  const portOwned = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb,
    readyDelayMs: 1, pollMs: 250, timing: { pollMs: 1 }, sharedHid: () => portHid, nightReleaseOwner: 'port',
    observe: async () => portReleasedAt === null || Date.now() - portReleasedAt < 40 ? 'night' : 'gameover',
    onEvent: event => portEvents.push(event) });
  // The port places its release from the executor's own authorization edge.
  let portAuthorizedAt = null;
  const portAuthorized = portOwned.whenNightAuthorized().then(at => {
    portAuthorizedAt = at;
    return new Promise(resolve => setTimeout(() => { portReleasedAt = Date.now(); portOwned.releaseNight(); resolve(); }, 30));
  });
  const portResult = await portOwned.execute(request);
  await portAuthorized;
  assert.equal(typeof portAuthorizedAt, 'number', 'the authorization edge must resolve with its return time');
  assert.ok(portReleasedAt >= portAuthorizedAt, 'the release follows the authorization it was placed from');
  const authorizedEvent = portEvents.find(event => event.type === 'hid.night-authorized');
  assert.equal(authorizedEvent.authorizedAt, portAuthorizedAt, 'the event must carry when the gate opened');
  assert.ok(authorizedEvent.sampleStartedAt <= authorizedEvent.authorizedAt, 'the sample starts before it returns');
  assert.equal(await portOwned.whenNightAuthorized(), portAuthorizedAt,
    'a late subscriber to an already-authorized execution must resolve at once');
  assert.equal(portResult.terminal, 'gameover', 'a port-owned release must keep terminal handling');
  assert.ok(portEvents.some(event => event.type === 'hid.night-authorized'),
    'the office frame must be recorded as an authorization');
  assert.equal(portEvents.find(event => event.type === 'hid.night-go')?.source, 'intro-handoff',
    'a port-owned night must take its origin from the placed release, not the classifier');
  assert.ok(portWrites.length > 0 && portWrites[0].at >= portReleasedAt,
    'nothing may reach the HID before the port releases the night');
  assert.throws(() => new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', nightReleaseOwner: 'host' }),
    /nightReleaseOwner must be observer or port/);

  const lateEvents = [];
  let lateWrites = 0;
  const lateHid = { write: async value => {
    if (lateWrites === 0) {
      lateWrites += 1;
      await new Promise(resolve => setTimeout(resolve, 125));
    }
    lateWrites += 1;
    JSON.parse(value);
  } };
  const late = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb,
    readyDelayMs: 1, pollMs: 250, timing: { pollMs: 1 }, sharedHid: () => lateHid, observe: async () => 'night',
    onEvent: event => lateEvents.push(event) });
  const lateRelease = setTimeout(() => late.releaseNight(), 10);
  await assert.rejects(() => late.execute(request), /night handoff was \d+ms late/,
    'a delayed first HID action must invalidate the run');
  clearTimeout(lateRelease);
  const lateHandoff = lateEvents.find(event => event.type === 'hid.handoff');
  assert.ok(lateHandoff && lateHandoff.delayMs > lateHandoff.budgetMs,
    'the delayed handoff must be measured outside its budget');
  assert.ok(lateEvents.some(event => event.type === 'hid.handoff.abort'),
    'a late handoff must leave an explicit abort event');

  let startupObservations = 0;
  let startupFinished = false;
  const startup = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb,
    readyDelayMs: 1, pollMs: 250, timing: { pollMs: 1 },
    observe: async () => startupFinished ? 'gameover'
      : startupObservations++ === 0 ? 'newspaper' : 'night',
    onEvent: event => { if (event.type === 'hid.night-go') startupFinished = true; } });
  const startupResult = await startup.execute(request);
  assert.equal(startupResult.outcome, 'UNVERIFIED',
    'the measured newspaper transition must be allowed before the first night frame');

  const dropped = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb,
    readyDelayMs: 1, pollMs: 250, timing: { pollMs: 1 }, observe: async () => 'title' });
  await assert.rejects(() => dropped.execute(request), /lifecycle left night state \(title\)/,
    'a positively observed non-night screen must abort the device-local stream');

  let postNightObservations = 0;
  const postNightDrop = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb,
    readyDelayMs: 1, pollMs: 250, timing: { pollMs: 1 },
    observe: async () => postNightObservations++ === 0 ? 'night' : 'title' });
  await assert.rejects(() => postNightDrop.execute(request), /lifecycle left night state \(title\)/,
    'a title observed after night entry must abort the device-local stream');

  let transientObservations = 0;
  let transientFinished = false;
  const transientFrame = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb,
    readyDelayMs: 1, pollMs: 250, timing: { pollMs: 1 },
    observe: async () => transientFinished ? 'gameover'
      : transientObservations++ === 0 ? 'static' : 'night',
    onEvent: event => { if (event.type === 'hid.night-go') transientFinished = true; } });
  const transientResult = await transientFrame.execute(request);
  assert.equal(transientResult.outcome, 'UNVERIFIED',
    'one bad lifecycle frame must not abort an otherwise live schedule');

  let controlSequence = 0;
  const effectLog = [];
  const effectLifecycle = finishAfter(effectLog,
    event => event.type === 'control.effect.result' && event.actionId === 'effect-mask-down');
  const effects = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: effectAdb,
    readyDelayMs: 1, pollMs: 250, timing: { pollMs: 1 }, observe: effectLifecycle.observe,
    onEvent: effectLifecycle.onEvent,
    observeControlState: async () => ({ sequence: ++controlSequence, ageUs: 10,
      screen: 'FNAF2_NIGHT', monitorUp: true, maskOn: false, maskEvidence: 'fixture' }) });
  await effects.execute(effectRequest);
  const effectResults = Object.fromEntries(effectLog
    .filter(event => event.type === 'control.effect.result')
    .map(event => [event.actionId, event]));
  assert.equal(effectResults['effect-monitor-down']?.status, 'MISSING',
    'a confirmed monitor-up after a monitor-down target must be logged as a missing effect');
  assert.equal(effectResults['effect-monitor-up']?.status, 'PASS',
    'a confirmed monitor-up must acknowledge the monitor-up target');
  assert.equal(effectResults['effect-mask-up']?.status, 'MISSING',
    'a confirmed mask-off after a mask-on target must be logged as a missing effect');
  assert.equal(effectResults['effect-mask-down']?.status, 'PASS',
    'a confirmed mask-off must acknowledge the mask-off target');
  assert.equal(effectResults['effect-mask-down']?.evidence, 'fixture',
    'mask effect results must retain their evidence qualification');
  const passLatency = effectResults['effect-monitor-up'].latency;
  assert.ok(passLatency.lowerMs <= passLatency.upperMs,
    'a measured effect latency must be a bracket, not a point');
  assert.equal(passLatency.atFirstFrame, true,
    'a target already held on the first observed frame must be marked as indistinguishable');
  assert.equal(effectResults['effect-monitor-down'].latency, null,
    'a missing effect must not report a latency it never observed');
  assert.ok(effectResults['effect-monitor-down'].sampleCount <= 6,
    'a missing effect must not spend more than its read budget');
  // The observation window is derived from the plan: the next authored
  // transition of the same signal, never a settle constant.
  const monitorDownExpected = effectLog.find(event => event.type === 'control.effect.expected' &&
    event.actionId === 'effect-monitor-down');
  assert.equal(monitorDownExpected.windowEndAt - monitorDownExpected.contactAt, 80,
    'a monitor window must end at the next authored monitor transition');

  // A capture whose sequence never advances cannot confirm or refute anything.
  const stalledLog = [];
  const stalledLifecycle = finishAfter(stalledLog,
    event => event.type === 'control.effect.result' && event.actionId === 'effect-mask-down');
  const stalled = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: effectAdb,
    readyDelayMs: 1, pollMs: 250, timing: { pollMs: 1 }, observe: stalledLifecycle.observe,
    onEvent: stalledLifecycle.onEvent,
    observeControlState: async () => ({ sequence: 7, ageUs: 10,
      screen: 'FNAF2_NIGHT', monitorUp: true, maskOn: false, maskEvidence: 'fixture' }) });
  await stalled.execute(effectRequest);
  const stalledResult = stalledLog.find(event => event.type === 'control.effect.result' &&
    event.actionId === 'effect-monitor-up');
  assert.equal(stalledResult.status, 'UNKNOWN',
    'a stalled helper capture must refuse, not confirm a target from one frame');
  assert.equal(stalledResult.reason, 'insufficient-frames');

  // Which detector answered travels with the observation: the camera panel
  // and the office HUD see opposite halves of the monitor state.
  const sourcedLog = [];
  let sourcedSequence = 0;
  const sourcedLifecycle = finishAfter(sourcedLog,
    event => event.type === 'control.effect.result' && event.actionId === 'effect-mask-down');
  const sourced = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: effectAdb,
    readyDelayMs: 1, pollMs: 250, timing: { pollMs: 1 }, observe: sourcedLifecycle.observe,
    onEvent: sourcedLifecycle.onEvent,
    observeControlState: async () => ({ sequence: ++sourcedSequence, ageUs: 10,
      screen: 'UNKNOWN', monitorUp: true, monitorSource: 'camera-panel',
      panelSequence: 900 + sourcedSequence, maskOn: false, maskEvidence: 'fixture' }) });
  await sourced.execute(effectRequest);
  const sourcedResult = sourcedLog.find(event => event.type === 'control.effect.result' &&
    event.actionId === 'effect-monitor-up');
  assert.equal(sourcedResult.status, 'PASS',
    'a camera panel observation must be able to acknowledge a monitor-up target');
  assert.equal(sourcedResult.samples[0].monitorSource, 'camera-panel',
    'the deciding detector must be retained in the sample');
  assert.equal(sourcedResult.samples[0].panelSequence, 900 + sourcedResult.samples[0].sequence,
    'the camera read sequence must be retained beside the frame sequence it was paired with');

  // A frame the fitted rule refuses still refutes mask-on when the grid is far
  // too bright for an opaque mask, so the gate corrects rather than ending the
  // night. Darkness is never allowed to assert mask-on: a blackout reads the
  // same, which is why only this direction is inferred.
  const refuteLog = [];
  const refuteLifecycle = finishAfter(refuteLog, event => event.type === 'control.gate');
  let refuteSequence = 0;
  const refuted = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: gateAdb,
    readyDelayMs: 1, pollMs: 250, observe: refuteLifecycle.observe,
    onEvent: refuteLifecycle.onEvent,
    timing: { pollMs: 1, armSettleMs: 0, armObservationWindowMs: 500, gateRetryGapMs: 0, maskSettleMs: 0,
      gateMinSlackMs: 10, gateBudgetMinMs: 10, gateBudgetMaxMs: 20, gateBudgetReserveMs: 40 },
    observeArm: async () => ({ sequence: ++refuteSequence + 500,
      highlights: ['cam:8', 'cam:11'], viewing: null }),
    observeControlState: async () => ({ sequence: ++refuteSequence, ageUs: 10,
      screen: 'FNAF2_NIGHT', monitorUp: false, maskOn: null,
      maskReason: 'ambiguous-threshold', gridLuma: 44, maskEvidence: 'fixture' }) });
  await refuted.execute(fastGateRequest);
  const refuteGates = refuteLog.filter(event => event.type === 'control.gate');
  assert.ok(refuteGates.length > 0, 'the gated fixture must reach a gate');
  assert.equal(refuteGates[0].observedMaskOn, false,
    'a bright grid must refute mask-on even when the fitted rule refuses');
  assert.equal(refuteGates[0].maskEvidence, 'grid-luma-refutation');
  assert.equal(refuteGates[0].status, 'CORRECTED',
    'a refuted mask-on must correct the parity, not abort the night');
  assert.ok(!refuteLog.some(event => event.type === 'control.gate.abort'),
    'a refutable frame must not end the night');
  assert.ok(!refuteLog.some(event => event.type === 'control.effect.phase' && event.phase === 'remainder'),
    'a gated remainder must not let diagnostic reads delay the physical gate release');

  // A CORRECTION MUST NOT MOVE THE RELEASE.
  //
  // The read-back used to hold the stream until `correctedAt + maskSettleMs`
  // and push `releaseAt` to `correctedAt + maskSettleMs + 250`, so seeing
  // whether the correction took cost the schedule up to a second. The model
  // priced that on 2026-09-12: hold the Night 5 mask window at its full 4751 ms
  // and merely move it later and it scores 3000/3000 at +0 ms and 0/3000 at
  // +200 ms, +400 ms and +800 ms. The gate was reliably killing the cycle it
  // existed to rescue.
  //
  // The fixture above cannot see this because it sets maskSettleMs to 0 -- it
  // zeroes the exact constant that caused the defect. This one makes the settle
  // enormous: if the release is still anchored to it, the delay is unmissable.
  const settleLog = [];
  const settleLifecycle = finishAfter(settleLog, event => event.type === 'control.gate');
  let settleSequence = 0;
  const settled = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: gateAdb,
    readyDelayMs: 1, pollMs: 250, observe: settleLifecycle.observe,
    onEvent: settleLifecycle.onEvent,
    timing: { pollMs: 1, armSettleMs: 0, armObservationWindowMs: 500, gateRetryGapMs: 0,
      maskSettleMs: 4000,
      gateMinSlackMs: 10, gateBudgetMinMs: 10, gateBudgetMaxMs: 20, gateBudgetReserveMs: 40 },
    observeArm: async () => ({ sequence: ++settleSequence + 500,
      highlights: ['cam:8', 'cam:11'], viewing: null }),
    observeControlState: async () => ({ sequence: ++settleSequence, ageUs: 10,
      screen: 'FNAF2_NIGHT', monitorUp: false, maskOn: null,
      maskReason: 'ambiguous-threshold', gridLuma: 44, maskEvidence: 'fixture' }) });
  await settled.execute(fastGateRequest);
  const settledGates = settleLog.filter(event => event.type === 'control.gate');
  assert.ok(settledGates.length > 0, 'the settle fixture must reach a gate');
  const correctedGate = settledGates.find(event => event.status === 'CORRECTED');
  assert.ok(correctedGate, 'the settle fixture must produce a correction to measure');
  assert.ok(correctedGate.releaseAt - correctedGate.reachedAt < 4000,
    'a correction must not anchor the release to the mask settle: the schedule ' +
    'tolerates ~200 ms of shift and the settle is measured in seconds');

  // The verification is no longer part of the gate event: it cannot be, since
  // the gate no longer waits for it.
  assert.ok(!correctedGate.verify,
    'the gate event must no longer carry a verification it waited for');
  // It is deliberately NOT asserted to have fired here. This fixture ends the
  // night on the first gate, so the read-back correctly finds the run already
  // stopped and emits nothing -- best-effort is the contract, and a
  // verification that cannot run must never be a night failure. What is
  // asserted is that it was not paid for on the critical path, above.

  // Darkness stays unknown: mask-on and a blacked-out office read alike.
  const darkLog = [];
  const darkLifecycle = finishAfter(darkLog, event => event.type === 'control.gate.abort');
  let darkSequence = 0;
  const dark = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: gateAdb,
    readyDelayMs: 1, pollMs: 250, observe: darkLifecycle.observe,
    onEvent: darkLifecycle.onEvent,
    timing: { pollMs: 1, armSettleMs: 0, armObservationWindowMs: 500, gateRetryGapMs: 0, maskSettleMs: 0,
      gateMinSlackMs: 10, gateBudgetMinMs: 10, gateBudgetMaxMs: 20, gateBudgetReserveMs: 40 },
    observeArm: async () => ({ sequence: ++darkSequence + 500,
      highlights: ['cam:8', 'cam:11'], viewing: null }),
    observeControlState: async () => ({ sequence: ++darkSequence, ageUs: 10,
      screen: 'FNAF2_NIGHT', monitorUp: false, maskOn: null,
      maskReason: 'ambiguous-threshold', gridLuma: 4, maskEvidence: 'fixture' }) });
  await dark.execute(fastGateRequest);
  assert.ok(darkLog.some(event => event.type === 'control.gate.abort'),
    'a dark ambiguous frame must still stop the night rather than guess');

  const anrEvent = sourcedLog.find(event => event.type === 'device.anr');
  assert.ok(anrEvent, 'every run must record its ANR query, hit or not');
  assert.equal(anrEvent.count, anrEvent.lines.length);

  let armSequence = 0;
  const armLog = [];
  let armLifecycleCalls = 0;
  let releaseArmLifecycle;
  const armLifecycle = new Promise(resolve => { releaseArmLifecycle = resolve; });
  const armPass = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb,
    readyDelayMs: 1, pollMs: 250,
    timing: { pollMs: 1, armSettleMs: 0, armObservationWindowMs: 2000, gateRetryGapMs: 0, maskSettleMs: 0 },
    observe: async () => {
      if (armLifecycleCalls++ === 0) return 'night';
      await armLifecycle;
      return 'gameover';
    },
    onEvent: event => {
      armLog.push(event);
      if (event.type === 'arm.verified') releaseArmLifecycle();
    },
    observeArm: async () => {
      const sequence = ++armSequence;
      return { sequence, highlights: sequence === 2 ? ['cam:9']
        : sequence < 4 ? null : ['cam:8', 'cam:11'], viewing: null };
    } });
  const armed = await armPass.execute(runtimeArmRequest);
  assert.equal(armed.armVerification.status, 'PASS',
    'an exact CAM08 + CAM11 observation must arm before the schedule continues');
  assert.ok(armSequence >= 5, 'arming requires fresh confirming samples');
  assert.equal(armLog.filter(event => event.type === 'arm.retry').length, 0,
    'UNKNOWN and a single wrong frame must not cause a destructive re-arm');
  assert.ok(armLog.find(event => event.type === 'arm.verified').elapsedMs < 7000,
    'a slow lifecycle observer must not starve the native arm verifier after the night gate');

  // The one-shot mode starts the full authored stream immediately. A clear
  // exact pair is telemetry, while a clear wrong pair is a positive arm
  // failure and aborts without a retry or a phase re-anchor.
  const observeOnceLog = [];
  const observeOnceLifecycle = finishAfter(observeOnceLog, event => event.type === 'arm.verified');
  const observeOncePass = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb,
    readyDelayMs: 1, pollMs: 250,
    timing: { pollMs: 1, armSettleMs: 0, armObservationWindowMs: 20, gateRetryGapMs: 0, maskSettleMs: 0 },
    observe: observeOnceLifecycle.observe,
    onEvent: observeOnceLifecycle.onEvent,
    observeArm: async () => ({ sequence: 1, highlights: ['cam:8', 'cam:11'], viewing: null }) });
  const observeOnceResult = await observeOncePass.execute(runtimeObserveOnceRequest);
  assert.equal(observeOnceResult.armVerification.status, 'PASS',
    'one-shot arm verification must record a clear exact pair');
  assert.equal(observeOnceLog.filter(event => event.type === 'arm.sample').length, 1,
    'one-shot arm verification must read exactly once');
  assert.equal(observeOnceLog.filter(event => event.type === 'arm.retry').length, 0,
    'one-shot arm verification must never re-arm');
  assert.ok(!observeOnceLog.find(event => event.type === 'arm.verified').armGoAt,
    'one-shot arm verification must not create a delayed arm release');

  const observeOnceFailLog = [];
  const observeOnceFail = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb,
    readyDelayMs: 1, pollMs: 250,
    timing: { pollMs: 1, armSettleMs: 0, armObservationWindowMs: 0, gateRetryGapMs: 0, maskSettleMs: 0 },
    observe: async () => 'night',
    onEvent: event => observeOnceFailLog.push(event),
    observeArm: async () => ({ sequence: 1, highlights: ['cam:9'], viewing: null }) });
  await assert.rejects(() => observeOnceFail.execute(runtimeObserveOnceRequest), /identified a mismatch/,
    'one-shot arm verification must abort on a definitive wrong pair');
  assert.ok(observeOnceFailLog.some(event => event.type === 'arm.failed'),
    'a definitive wrong pair must leave an arm.failed event');
  assert.equal(observeOnceFailLog.filter(event => event.type === 'arm.sample').length, 1,
    'a definitive wrong pair must be decided by the single observation');
  assert.equal(observeOnceFailLog.filter(event => event.type === 'arm.retry').length, 0,
    'a definitive wrong pair must abort instead of replaying the arm');

  const observeOnceUnknownLog = [];
  const observeOnceUnknownLifecycle = finishAfter(observeOnceUnknownLog,
    event => event.type === 'arm.unresolved');
  const observeOnceUnknown = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb,
    readyDelayMs: 1, pollMs: 250,
    timing: { pollMs: 1, armSettleMs: 0, armObservationWindowMs: 0, gateRetryGapMs: 0, maskSettleMs: 0 },
    observe: observeOnceUnknownLifecycle.observe,
    onEvent: observeOnceUnknownLifecycle.onEvent,
    observeArm: async () => ({ sequence: 1, highlights: null, reason: 'ambiguous-threshold' }) });
  const observeOnceUnknownResult = await observeOnceUnknown.execute(runtimeObserveOnceRequest);
  assert.equal(observeOnceUnknownResult.armVerification.status, 'UNRESOLVED',
    'an unavailable one-shot frame must leave the run alone and remain unverified');
  assert.ok(observeOnceUnknownLog.some(event => event.type === 'arm.unresolved'),
    'an unavailable one-shot frame must be recorded as unresolved');

  // A fresh helper sequence can still be indeterminate for the whole first
  // camera window while the panel settles. That window must spend a bounded
  // physical re-arm, then accept only two fresh matching frames.
  const unknownRetryLog = [];
  let unknownRetrySequence = 0;
  let unknownRetryStarted = false;
  const unknownThenPass = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb,
    readyDelayMs: 1, pollMs: 250, observe: async () => 'night',
    timing: { pollMs: 1, armSettleMs: 0, armObservationWindowMs: 500, gateRetryGapMs: 0, maskSettleMs: 0 },
    onEvent: event => {
      unknownRetryLog.push(event);
      if (event.type === 'arm.retry') unknownRetryStarted = true;
    },
    observeArm: async () => {
      const sequence = ++unknownRetrySequence;
      return unknownRetryStarted
        ? { sequence, highlights: ['cam:8', 'cam:11'], viewing: null }
        : { sequence, highlights: null, viewing: null, reason: 'ambiguous-threshold' };
    } });
  await assert.rejects(() => unknownThenPass.execute(lateRuntimeArmRequest), /phase-invalid/,
    'an indeterminate arm window must refuse a late phase release');
  const unknownRetry = unknownRetryLog.filter(event => event.type === 'arm.retry');
  assert.equal(unknownRetry.length, 1,
    'an unavailable camera window must consume one retry before fresh evidence');
  assert.equal(unknownRetry[0].reason, 'camera-observation-unavailable',
    'the retry reason must distinguish unavailable camera evidence from a wrong pair');
  const phaseInvalid = unknownRetryLog.find(event => event.type === 'phase.invalid');
  assert.ok(phaseInvalid && phaseInvalid.phaseLagMs > phaseInvalid.phaseBudgetMs,
    'a recovered arm must be refused when its release is outside the phase budget');

  const armFail = new AdbDeviceLocalArtifactExecutor({ serial: 'fixture-device', adb: fakeAdb,
    readyDelayMs: 1, pollMs: 250,
    timing: { pollMs: 1, armSettleMs: 0, armObservationWindowMs: 0, gateRetryGapMs: 0, maskSettleMs: 0 },
    observe: async () => 'night',
    observeArm: async () => ({ sequence: ++armSequence, highlights: ['cam:9', 'cam:11'], viewing: null }) });
  await assert.rejects(() => armFail.execute(runtimeArmRequest), /camera arm verification missed/,
    'a CAM09 + CAM11 observation must never be accepted for a CAM08 arm');
} finally {
  rmSync(fakeRoot, { recursive: true, force: true });
}

console.log('device-local HID executor: semantic schedule, contact discipline, and bounded timing pass');
