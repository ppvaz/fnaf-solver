import assert from 'node:assert/strict';
import { AI_10_20, AI_DIALS, PUPPET_AI } from '@sixam/source/fnaf2';
import {
  CAMPAIGN_STATES, CampaignStateMachine, makeCampaignSpec, validateCampaignSpec,
} from '../src/campaign/campaign.ts';
import type { CampaignTarget } from '../src/campaign/campaign.ts';
import { makeAttemptProof } from '../src/campaign/campaign-proof.ts';

const defaultSpec = makeCampaignSpec({ profile: 'hid-mediaprojection', targetBuild: 'com.scottgames.fnaf2:2.0.7+26' });
assert.deepEqual(defaultSpec.nights.map(target => target.night), [1, 2, 3, 4, 5, 6, 7]);
assert.deepEqual(defaultSpec.nights.map(target => target.menuTarget),
  ['newGame', 'continue', 'continue', 'continue', 'continue', 'sixthNight', 'customNight']);
const spec = makeCampaignSpec({ profile: 'hid-mediaprojection', targetBuild: 'com.scottgames.fnaf2:2.0.7+26', nights: [6, 7] });
assert.deepEqual(spec.nights.map(target => target.night), [6, 7]);
// makeCampaignSpec makes Night 7 the Custom Night, with its dials and Puppet.
const night7 = spec.nights[1] as Extract<CampaignTarget, { mode: 'custom' }>;
assert.deepEqual(Object.values(night7.dials), AI_DIALS.map(() => AI_10_20));
assert.equal(night7.puppet, PUPPET_AI);
assert.doesNotThrow(() => validateCampaignSpec(spec));
assert.throws(() => validateCampaignSpec({ ...spec, nights: [{ ...spec.nights[0], menuTarget: 'customNight' }] }), /Night 6/);
assert.throws(() => validateCampaignSpec({ ...spec, nights: [{ ...spec.nights[1], dials: { ...night7.dials, foxy: 21 } }] }), /foxy/);

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
// The readback's status is more than acceptCustomConfiguration's type names.
const readback = { status: 'PASS', dials: night7.dials, puppet: PUPPET_AI };
machine.acceptCustomConfiguration({ status: 'PASS', dials: night7.dials, puppet: PUPPET_AI, readback });
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
assert.equal(chain.target?.night, 2);
for (const night of [2, 3, 4]) {
  chain.acceptMenu({ target: 'continue', visible: false, selected: true, rolledThrough: true });
  chain.acceptIntro({ night, identity: 'story', observed: true });
  chain.beginAttempt();
  chain.acceptTerminal({ night, outcome: 'sixam', sixAm: true });
  chain.acceptTerminalVerification({ sixAm: true, positive: true });
  chain.acceptSave({ observed: true, nextNightStarted: true });
  assert.equal(chain.snapshot().state, 'MENU');
  assert.equal(chain.target?.night, night + 1);
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

// ADR 0002, decision 3: an Invalid run does not spend a campaign attempt, and
// the campaign holds after two consecutive Invalid runs.
const why = 'phase-invalid: arm release lag 1320ms exceeds budget 200ms';
const oneNight = (budget: number) => ({ ...spec, nights: [spec.nights[0]], retry: { maxAttempts: budget } });
const started = (budget: number) => {
  const machine = new CampaignStateMachine({ spec: oneNight(budget) });
  machine.startPreflight();
  machine.acceptPreflight({ status: 'READY' });
  return machine;
};
const play = (machine: CampaignStateMachine) => {
  machine.acceptMenu({ target: 'sixthNight', visible: true, selected: true });
  machine.acceptIntro({ night: 6, identity: 'story', observed: true });
  machine.beginAttempt();
  assert.equal(machine.state, 'ACTIVE');
};

// With one attempt allowed, an Invalid run leaves it unspent: the night is
// played again, and a 6 AM on the second run completes the campaign.
const refunded = started(1);
play(refunded);
refunded.acceptTerminal({ night: 6, outcome: 'invalid', why });
assert.equal(refunded.state, 'RETRY_VERIFY');
assert.equal(refunded.events.at(-1)?.data.reason, 'attempt-invalid');
assert.equal(refunded.events.at(-1)?.data.why, why);
assert.equal(refunded.snapshot().invalidRuns, 1);
refunded.acceptRetry({ menuReady: true });
assert.equal(refunded.state, 'MENU', 'the Invalid run did not spend the only attempt');
play(refunded);
refunded.acceptTerminal({ night: 6, outcome: 'sixam', sixAm: true });
refunded.acceptTerminalVerification({ sixAm: true, positive: true });
refunded.acceptSave({ customNightVisible: true, observed: true });
const refundedResult = refunded.result();
assert.equal(refundedResult.state, 'COMPLETE');
assert.deepEqual(refundedResult.attempts.map(item => [item.attempt, item.status]), [[1, 'INVALID'], [2, 'WIN']],
  'attempt numbers stay unique; only the status says the first did not count');
assert.deepEqual(refundedResult.attempts[0].terminal, { night: 6, outcome: 'invalid', sixAm: false, why });

// A death still spends its attempt: one allowed, one death, the budget is gone.
const spent = started(1);
play(spent);
spent.acceptTerminal({ night: 6, outcome: 'death' });
spent.acceptRetry({ menuReady: true });
assert.equal(spent.state, 'ABORTED');
assert.equal(spent.events.at(-1)?.data.reason, 'attempt-budget-exhausted');

// Two consecutive Invalid runs hold the campaign, with the budget untouched.
const twice = started(3);
play(twice);
twice.acceptTerminal({ night: 6, outcome: 'invalid', why });
twice.acceptRetry({ menuReady: true });
play(twice);
twice.acceptTerminal({ night: 6, outcome: 'invalid', why: 'night identity read as Night 5' });
assert.equal(twice.state, 'HOLD');
assert.deepEqual(twice.events.at(-1)?.data, { previous: 'ACTIVE', reason: 'consecutive-invalid-runs', night: 6,
  why: 'night identity read as Night 5', consecutive: 2 });
assert.deepEqual(twice.result().attempts.map(item => item.status), ['INVALID', 'INVALID']);
// A resume is the operator's decision: the count starts again, the budget stands.
twice.resume();
twice.acceptPreflight({ status: 'READY' });
play(twice);
assert.equal(twice.attempt, 3);
twice.acceptTerminal({ night: 6, outcome: 'invalid', why });
assert.equal(twice.state, 'RETRY_VERIFY', 'one Invalid run after a resume does not hold');

// Only consecutive Invalid runs hold: a death between them resets the count,
// and spends its own attempt, so the budget still bounds the campaign.
const broken = started(2);
play(broken);
broken.acceptTerminal({ night: 6, outcome: 'invalid', why });
broken.acceptRetry({ menuReady: true });
play(broken);
broken.acceptTerminal({ night: 6, outcome: 'death' });
broken.acceptRetry({ menuReady: true });
play(broken);
broken.acceptTerminal({ night: 6, outcome: 'invalid', why });
assert.equal(broken.state, 'RETRY_VERIFY');
broken.acceptRetry({ menuReady: true });
play(broken);
broken.acceptTerminal({ night: 6, outcome: 'death' });
broken.acceptRetry({ menuReady: true });
assert.equal(broken.state, 'ABORTED', 'two deaths spend both attempts; the two Invalid runs spent none');
assert.deepEqual(broken.result().attempts.map(item => item.status), ['INVALID', 'DEATH', 'INVALID', 'DEATH']);

// Invalid is a value with a reason: an Invalid terminal without one holds.
const bare = started(3);
play(bare);
bare.acceptTerminal({ night: 6, outcome: 'invalid' });
assert.equal(bare.state, 'HOLD');
assert.equal(bare.events.at(-1)?.data.reason, 'terminal-invalid-without-reason');
// Pedro, 2026-09-30: a RunSpec's constraints travel with the bundle. The spec
// carries the mechanics the bundle's strategy requires and the ones the build
// and the run forbid, its hash covers them, a spec that forbids what it
// requires is refused, and the first event names them, so the result and the
// pack made from it do.
const mechanics = { requires: ['fnaf2.camera-split'], forbidden: [] };
const carried = makeCampaignSpec({ profile: 'hid-mediaprojection', targetBuild: 'com.scottgames.fnaf2:2.0.7+26',
  nights: [7], mechanics });
assert.deepEqual(carried.mechanics, mechanics);
const unconstrained = makeCampaignSpec({ profile: 'hid-mediaprojection', targetBuild: 'com.scottgames.fnaf2:2.0.7+26', nights: [7] });
assert.equal(unconstrained.mechanics, undefined, 'a spec without a bundle records no mechanics');
assert.throws(() => makeCampaignSpec({ profile: 'hid-mediaprojection', targetBuild: 'com.scottgames.fnaf2:2.0.7+26',
  nights: [7], mechanics: { requires: ['fnaf2.camera-split'], forbidden: ['fnaf2.camera-split'] } }),
/the run forbids fnaf2\.camera-split, which its strategy requires/);
assert.throws(() => validateCampaignSpec({ ...carried, mechanics: { requires: [], forbidden: [], extra: [] } }),
  /mechanics is \{requires, forbidden\}/);
const carrying = new CampaignStateMachine({ spec: carried });
carrying.startPreflight();
assert.deepEqual(carrying.result().events[0].data.mechanics, mechanics, 'the first event names the run\'s mechanics');
assert.notEqual(carrying.result().specHash, new CampaignStateMachine({ spec: unconstrained }).result().specHash,
  'the spec hash covers the mechanics');

console.log('device campaign: target validation, lifecycle gates, retry boundary, story Nights 1..5 chain, completion proof, ' +
  'Invalid runs that spend no attempt and hold when consecutive, and the bundle\'s mechanics carried in the spec pass');
