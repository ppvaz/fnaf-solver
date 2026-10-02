import assert from 'node:assert/strict';
import { DeviceCampaignRunner } from '../src/campaign/campaign-runner.ts';
import type { CampaignPorts } from '../src/campaign/campaign-runner.ts';
import { makeCampaignSpec } from '../src/campaign/campaign.ts';
import type { CampaignTarget } from '../src/campaign/campaign.ts';
import type { Dials } from '../src/campaign/custom-night.ts';

const full = makeCampaignSpec({
  profile: 'fixture-hid-screencap',
  targetBuild: 'com.scottgames.fnaf2:2.0.7+26',
  nights: [6, 7],
});
const calls: string[] = [];
const ports: CampaignPorts = {
  preflight: async () => ({ status: 'READY', serial: 'fixture' }),
  menu: async ({ target }) => { calls.push(`menu:${target.night}`); return { target: target.menuTarget, visible: true, selected: true }; },
  // Only a custom target carries dials and a puppet, and only a custom target is asked for them.
  customNight: async ({ target }: { target: CampaignTarget & { dials?: Dials, puppet?: number } }) => ({ status: 'PASS', dials: target.dials, puppet: target.puppet,
    readback: { status: 'PASS', dials: target.dials, puppet: target.puppet } }),
  intro: async ({ target }) => ({ night: target.night, identity: target.mode, observed: true }),
  executeAttempt: async ({ target, attempt }) => { calls.push(`attempt:${target.night}:${attempt}`); return { id: `${target.night}-${attempt}` }; },
  terminal: async ({ target }) => ({ night: target.night, identity: target.mode, outcome: 'sixam', sixAm: true }),
  terminalVerification: async () => ({ sixAm: true, positive: true }),
  save: async ({ target }) => target.night === 6
    ? { customNightVisible: true, observed: true } : { menuReturned: true, customCompleted: true, observed: true },
  retryReady: async () => ({ menuReady: true }),
};
const runner = new DeviceCampaignRunner({ spec: full, ports });
assert.equal((await runner.run()).state, 'COMPLETE');
assert.deepEqual(calls, ['menu:6', 'attempt:6:1', 'menu:7', 'attempt:7:1']);

let acted = false;
const held = new DeviceCampaignRunner({ spec: full, ports: {
  ...ports,
  preflight: async () => ({ status: 'HOLD', reason: 'phone-locked' }),
  executeAttempt: async () => { acted = true; },
}});
assert.equal((await held.run()).state, 'HOLD');
assert.equal(acted, false, 'a held preflight must prevent menu and game actuation');

let cleaned = false;
const broken = new DeviceCampaignRunner({ spec: full, ports: {
  ...ports,
  intro: async () => { throw new Error('intro-timeout'); },
  cleanup: async () => { cleaned = true; },
}});
await assert.rejects(() => broken.run(), /intro-timeout/);
assert.equal(broken.machine.state, 'ABORTED');
assert.equal(cleaned, true);
console.log('device campaign runner: ordered target execution, hold-before-actuation, and cleanup pass');

let attempts = 0;
let terminalStops = 0;
const retryRunner = new DeviceCampaignRunner({ spec: { ...full, nights: [full.nights[0]] }, ports: {
  ...ports,
  executeAttempt: async ({ target, attempt }) => { attempts += 1; return { target, attempt }; },
  stopAttempt: async ({ reason }) => {
    terminalStops += 1;
    assert.ok(['terminal-retry', 'terminal-proof'].includes(reason));
  },
  // executeAttempt above returns the attempt it played.
  terminal: async ({ target, execution }) => (execution as { attempt: number }).attempt === 1
    ? { night: target.night, outcome: 'death', sixAm: false }
    : { night: target.night, identity: target.mode, outcome: 'sixam', sixAm: true },
  save: async () => ({ customNightVisible: true, observed: true }),
} });
const retried = await retryRunner.run();
assert.equal(retried.state, 'COMPLETE');
assert.equal(attempts, 2);
assert.equal(terminalStops, 2, 'each terminal must stop the actuator before retryReady or save proof');
assert.equal(retried.attempts[0].status, 'DEATH');
assert.equal(retried.attempts[1].status, 'WIN');
assert.match(retried.attempts[1].proofHash ?? '', /^fnv1a-/);
console.log('device campaign runner: bounded death retry and per-attempt result record pass');

// An Invalid run (ADR 0002, decision 3) is stopped like a death and played
// again without spending the attempt; two in a row hold before a third.
const single = { ...full, nights: [full.nights[0]], retry: { maxAttempts: 1 } };
const invalidRun = async (outcomes: string[]) => {
  const stops: string[] = [];
  let played = 0;
  const runner = new DeviceCampaignRunner({ spec: single, ports: {
    ...ports,
    executeAttempt: async ({ attempt }) => { played += 1; return { attempt }; },
    stopAttempt: async ({ reason }) => { stops.push(reason); },
    terminal: async ({ target, execution }) => outcomes[(execution as { attempt: number }).attempt - 1] === 'invalid'
      ? { night: target.night, outcome: 'invalid', why: 'fixture: the delivered phase left its budget' }
      : { night: target.night, identity: target.mode, outcome: 'sixam', sixAm: true },
    save: async () => ({ customNightVisible: true, observed: true }),
  } });
  return { result: await runner.run(), stops, played };
};
const refunded = await invalidRun(['invalid', 'sixam']);
assert.equal(refunded.result.state, 'COMPLETE', 'one attempt allowed, and the Invalid run did not spend it');
assert.equal(refunded.played, 2);
assert.deepEqual(refunded.stops, ['terminal-retry', 'terminal-proof']);
assert.deepEqual(refunded.result.attempts.map(item => item.status), ['INVALID', 'WIN']);
const heldInvalid = await invalidRun(['invalid', 'invalid', 'sixam']);
assert.equal(heldInvalid.result.state, 'HOLD');
assert.equal(heldInvalid.played, 2, 'the campaign holds after the second Invalid run and plays no third');
assert.deepEqual(heldInvalid.stops, ['terminal-retry', 'HOLD'], 'the held attempt is stopped too');
console.log('device campaign runner: an Invalid run is replayed without spending the attempt, and two in a row hold');
