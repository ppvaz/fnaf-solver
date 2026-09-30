import assert from 'node:assert/strict';
import { AI_10_20, AI_DIALS, PUPPET_AI } from '@sixam/source/fnaf2';
import {
  CAMPAIGN_STATES, CampaignStateMachine, makeCampaignSpec, validateCampaignSpec,
} from '../src/campaign/campaign.js';
import { makeAttemptProof } from '../src/campaign/campaign-proof.js';

const defaultSpec = makeCampaignSpec({ profile: 'hid-mediaprojection', targetBuild: 'com.scottgames.fnaf2:2.0.7+26' });
assert.deepEqual(defaultSpec.nights.map(target => target.night), [1, 2, 3, 4, 5, 6, 7]);
assert.deepEqual(defaultSpec.nights.map(target => target.menuTarget),
  ['newGame', 'continue', 'continue', 'continue', 'continue', 'sixthNight', 'customNight']);
const spec = makeCampaignSpec({ profile: 'hid-mediaprojection', targetBuild: 'com.scottgames.fnaf2:2.0.7+26', nights: [6, 7] });
assert.deepEqual(spec.nights.map(target => target.night), [6, 7]);
assert.deepEqual(Object.values(spec.nights[1].dials), AI_DIALS.map(() => AI_10_20));
assert.equal(spec.nights[1].puppet, PUPPET_AI);
assert.doesNotThrow(() => validateCampaignSpec(spec));
assert.throws(() => validateCampaignSpec({ ...spec, nights: [{ ...spec.nights[0], menuTarget: 'customNight' }] }), /Night 6/);
assert.throws(() => validateCampaignSpec({ ...spec, nights: [{ ...spec.nights[1], dials: { ...spec.nights[1].dials, foxy: 21 } }] }), /foxy/);

const trace = [];
const machine = new CampaignStateMachine({ spec, now: () => 10, onEvent: record => trace.push(record) });
assert.equal(machine.snapshot().state, 'IDLE');
machine.startPreflight();
machine.acceptPreflight({ status: 'READY', serial: 'fixture-phone' });
machine.acceptMenu({ target: spec.nights[0].menuTarget, visible: true, selected: true });
machine.acceptIntro({ night: 6, identity: 'story', observed: true });
machine.beginAttempt();
machine.acceptTerminal({ night: 6, outcome: 'sixam', sixAm: true });
machine.acceptTerminalVerification({ sixAm: true, positive: true });
machine.acceptSave({ customNightVisible: true, observed: true });
assert.equal(machine.snapshot().state, 'MENU');
machine.acceptMenu({ target: 'customNight', visible: true, selected: true });
machine.acceptCustomConfiguration({ status: 'PASS', dials: spec.nights[1].dials, puppet: PUPPET_AI,
  readback: { status: 'PASS', dials: spec.nights[1].dials, puppet: PUPPET_AI } });
machine.acceptIntro({ night: 7, identity: 'custom', observed: true });
machine.beginAttempt();
machine.acceptTerminal({ night: 7, outcome: 'sixam', sixAm: true });
machine.acceptTerminalVerification({ sixAm: true, positive: true });
machine.acceptSave({ menuReturned: true, customCompleted: true, observed: true });
assert.equal(machine.snapshot().state, 'COMPLETE');
assert.ok(trace.length >= 10);

const held = new CampaignStateMachine({ spec });
held.startPreflight();
held.acceptPreflight({ status: 'HOLD', reason: 'no-ready-device' });
assert.equal(held.snapshot().state, 'HOLD');
held.resume();
assert.equal(held.snapshot().state, 'PREFLIGHT');
held.abort('test-stop');
assert.equal(held.snapshot().state, 'ABORTED');
assert.ok(CAMPAIGN_STATES.includes('TERMINAL_VERIFY'));

const retry = new CampaignStateMachine({ spec: { ...spec, nights: [spec.nights[0]] } });
retry.startPreflight();
retry.acceptPreflight({ status: 'READY' });
retry.acceptMenu({ target: retry.spec?.nights?.[0]?.menuTarget ?? 'sixthNight', visible: true, selected: true });
retry.acceptIntro({ night: 6, identity: 'story', observed: true });
retry.beginAttempt();
retry.acceptTerminal({ night: 6, outcome: 'death' });
retry.acceptRetry({ menuReady: true });
assert.equal(retry.snapshot().state, 'MENU');
retry.acceptMenu({ target: retry.spec?.nights?.[0]?.menuTarget ?? 'sixthNight', visible: true, selected: true });
retry.acceptIntro({ night: 6, identity: 'story', observed: true });
retry.beginAttempt();
retry.acceptTerminal({ night: 6, outcome: 'unknown' });
assert.equal(retry.snapshot().state, 'HOLD');

// Story chain Nights 1..5: fresh-save newGame start, chained continue, and
// night-specific save advancement proof (Continue appears; Night 5 reveals
// the measured sixthNight item).
const storySpec = makeCampaignSpec({ profile: 'hid-mediaprojection',
  targetBuild: 'com.scottgames.fnaf2:2.0.7+26', nights: [1, 2, 3, 4, 5] });
assert.deepEqual(storySpec.nights.map(target => [target.night, target.menuTarget]), [
  [1, 'newGame'], [2, 'continue'], [3, 'continue'], [4, 'continue'], [5, 'continue'],
]);
assert.throws(() => makeCampaignSpec({ profile: 'p', targetBuild: 'b', nights: [1, 3] }), /consecutive/);
const standalone = makeCampaignSpec({ profile: 'p', targetBuild: 'b', nights: [2] });
assert.equal(standalone.nights[0].menuTarget, 'continue');
assert.throws(() => validateCampaignSpec({ ...storySpec,
  nights: [{ ...storySpec.nights[0], menuTarget: 'sixthNight' }] }), /menuTarget/);
assert.throws(() => makeCampaignSpec({ profile: 'p', targetBuild: 'b', nights: [2], storyStart: 'newGame' }), /storyStart/);
assert.throws(() => validateCampaignSpec({ ...storySpec,
  nights: [{ ...storySpec.nights[1], saveCursorObserved: 3 }, ...storySpec.nights.slice(2)] }), /saveCursorObserved/);

assert.doesNotThrow(() => makeAttemptProof({ target: storySpec.nights[1], attempt: 1,
  terminal: { night: 2, identity: 'story', outcome: 'sixam', sixAm: true, positive: true },
  terminalVerification: { sixAm: true, positive: true },
  save: { observed: true, nextNightStarted: true } }));
assert.throws(() => makeAttemptProof({ target: storySpec.nights[1], attempt: 1,
  terminal: { night: 2, identity: 'story', outcome: 'sixam', sixAm: true, positive: true },
  terminalVerification: { sixAm: true, positive: true },
  save: { observed: true, menuReturned: true, continueVisible: true } }), /next-night roll-through/);

// Mid-chain story Nights 1..4 roll their 6 AM straight into the next night
// on this build: menu-mediated proof (menuReturned/continueVisible) is the
// wrong evidence there and must abort, not pass.
const titleProof = new CampaignStateMachine({ spec: storySpec });
titleProof.startPreflight();
titleProof.acceptPreflight({ status: 'READY' });
titleProof.acceptMenu({ target: 'newGame', visible: true, selected: true });
titleProof.acceptIntro({ night: 1, identity: 'story', observed: true });
titleProof.beginAttempt();
titleProof.acceptTerminal({ night: 1, outcome: 'sixam', sixAm: true });
titleProof.acceptTerminalVerification({ sixAm: true, positive: true });
titleProof.acceptSave({ observed: true, menuReturned: true, continueVisible: true });
assert.equal(titleProof.state, 'ABORTED');

const chain = new CampaignStateMachine({ spec: storySpec });
chain.startPreflight();
chain.acceptPreflight({ status: 'READY' });
chain.acceptMenu({ target: 'newGame', visible: true, selected: true });
chain.acceptIntro({ night: 1, identity: 'story', observed: true });
chain.beginAttempt();
chain.acceptTerminal({ night: 1, outcome: 'sixam', sixAm: true });
chain.acceptTerminalVerification({ sixAm: true, positive: true });
chain.acceptSave({ observed: true, nextNightStarted: true });
assert.equal(chain.snapshot().state, 'MENU');
assert.equal(chain.target.night, 2);
for (const night of [2, 3, 4]) {
  chain.acceptMenu({ target: 'continue', visible: false, selected: true, rolledThrough: true });
  chain.acceptIntro({ night, identity: 'story', observed: true });
  chain.beginAttempt();
  chain.acceptTerminal({ night, outcome: 'sixam', sixAm: true });
  chain.acceptTerminalVerification({ sixAm: true, positive: true });
  chain.acceptSave({ observed: true, nextNightStarted: true });
  assert.equal(chain.snapshot().state, 'MENU');
  assert.equal(chain.target.night, night + 1);
}
// Night 5 never rolls: its 6 AM ends in the paycheck and the title, so the
// roll-through payload must be refused there and only the measured title
// items can prove the advancement.
chain.acceptMenu({ target: 'continue', visible: false, selected: true, rolledThrough: true });
chain.acceptIntro({ night: 5, identity: 'story', observed: true });
chain.beginAttempt();
chain.acceptTerminal({ night: 5, outcome: 'sixam', sixAm: true });
chain.acceptTerminalVerification({ sixAm: true, positive: true });
chain.acceptSave({ observed: true, nextNightStarted: true });
assert.equal(chain.state, 'ABORTED');
const chainResult = chain.result();
assert.equal(chainResult.state, 'ABORTED');
const proven5 = new CampaignStateMachine({ spec: { ...storySpec, nights: [storySpec.nights[4]] } });
proven5.startPreflight();
proven5.acceptPreflight({ status: 'READY' });
proven5.acceptMenu({ target: 'continue', visible: true, selected: true });
proven5.acceptIntro({ night: 5, identity: 'story', observed: true });
proven5.beginAttempt();
proven5.acceptTerminal({ night: 5, outcome: 'sixam', sixAm: true });
proven5.acceptTerminalVerification({ sixAm: true, positive: true });
proven5.acceptSave({ observed: true, menuReturned: true, continueVisible: true, sixthNightVisible: true });
assert.equal(proven5.result().state, 'COMPLETE');
assert.deepEqual(proven5.result().completedNights, [5]);
console.log('device campaign: target validation, lifecycle gates, retry boundary, story Nights 1..5 chain, and completion proof pass');
