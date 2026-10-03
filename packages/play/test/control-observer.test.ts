// The live campaign's control observers over the committed fitted rules, with
// the Companion's reads injected: the arm watch is loaded once and refused
// unloaded, the arm sees exactly the camera pair the panel highlights, and a
// control-state read carries its frame, the panel read it was paired with and
// the mask rule's standing.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCameraRule, parseCompanionFrame, parseMaskRule, parseMonitorRule } from '@sixam/play';
import { createControlObserver } from '../src/campaign/control-observer.ts';

const rule = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(`../../../packages/play/profiles/fnaf2/moto-g56/${name}`, import.meta.url), 'utf8'));
const cameraRule = parseCameraRule(await rule('camera-rule-moto-g56-v207.json'));
const monitorRule = parseMonitorRule(await rule('monitor-rule-moto-g56-v207.json'));
const maskRule = parseMaskRule(await rule('mask-rule-moto-g56-v207.json'));

const SPEC = 'a'.repeat(64);
const watchCalls: string[] = [];
let watchActive = false;
const lit = new Set(['cam:8', 'cam:11']);
const panel = () => Object.freeze({
  read: 'OBSERVED', ageUs: '1000', seq: '41',
  ...Object.fromEntries(cameraRule.adapter.buttons.map(button => [button.entry,
    String(lit.has(button.control) ? button.rule.threshold + button.rule.refuse_band + 1
      : button.rule.threshold - button.rule.refuse_band - 1)])),
});
const frameReply = (screen: string) => `OK seq=40 ageUs=900 snapshotNs=5000000000 screen=${screen} grid=20x9 ` +
  `cells=${'404040'.repeat(180)}`;
let screen = 'FNAF2_CAMERA';
const observer = createControlObserver({
  watch: async action => {
    watchCalls.push(action);
    if (action !== 'status') watchActive = true;
    return Object.freeze({ watch: watchActive ? 'ACTIVE' : 'IDLE', spec: SPEC });
  },
  readPanel: async () => panel(),
  readFrame: async () => parseCompanionFrame(frameReply(screen)),
}, { cameraRule, monitorRule, maskRule });

await assert.rejects(() => observer.observeArm(), /native camera watchlist is not active/);
await observer.ensureArmWatch();
await observer.ensureArmWatch();
assert.deepEqual(watchCalls, ['status', SPEC], 'the watch is loaded once, by its own spec hash');

const arm = await observer.observeArm();
assert.deepEqual(arm.highlights, ['cam:8', 'cam:11']);
assert.equal(arm.sequence, '41');
assert.equal(arm.viewing, null, 'a double highlight has no singleton viewing camera');

const state = await observer.observeControlState();
assert.equal(state.sequence, '40');
assert.equal(state.panelSequence, '41', 'the panel read it was paired with is named');
assert.equal(state.monitorUp, true);
assert.equal(state.monitorSource, 'camera-panel');
assert.equal(state.gridLuma, 0x40);
assert.equal(state.maskOn, false, 'a raised monitor rules the mask out');
assert.equal(state.maskEvidence, 'exclusive-monitor-up');

// A highlight claimed over the office HUD is a contradiction, not a state.
screen = 'FNAF2_NIGHT';
const office = await observer.observeControlState();
assert.equal(office.monitorUp, null, 'a raised monitor covers the office HUD');
assert.equal(office.monitorReason, 'camera-panel-over-office-hud');
assert.equal(office.maskOn, null);
assert.equal(office.maskEvidence, 'diagnostic-provisional:night-1-corpus,animation-unproven,blackout-unproven',
  'the mask rule\'s own standing rides on every reading it gives');

console.log('control observer: one watch load, the exact arm pair, and paired control-state reads pass');
