import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeCampaignSpec } from '../src/campaign/campaign.js';
import { validateCampaignBundle } from '../src/campaign/campaign-bundle.js';
import { composeCampaignPorts } from '../src/campaign/campaign-composition.js';

const profile = JSON.parse(await readFile(fileURLToPath(new URL('../../../apps/device/profiles/fixture-hid-screencap.json', import.meta.url)), 'utf8'));
const full = makeCampaignSpec({ profile: profile.id, targetBuild: profile.targetBuild, nights: [6, 7] });
const spec = { ...full, nights: [full.nights[0]] };
const block = { schema: 'artifact-action-block-v1', id: 'opening', cycle: 'opening', atMs: 0,
  actions: [{ schema: 'artifact-action-v1', id: 'opening-action', cycle: 'opening', atMs: 0,
    kind: 'press', control: 'mask', requiresMonitorUp: false, durationMs: 33 }] };
const bundle = validateCampaignBundle({ spec, plans: [{ night: 6, timing: spec.nights[0].timing,
  cycles: { opening: { blocks: [block] }, toys: { blocks: [block] } } }] });
let request;
let executorAborts = 0;
let executorReleases = 0;
let restarts = 0;
const composed = composeCampaignPorts({ spec, bundle, profile,
  devicePreflight: async () => ({ status: 'READY', serial: 'fixture' }),
  menu: async ({ target }) => ({ target: target.menuTarget, visible: true, selected: true }),
  intro: async ({ target }) => ({ night: target.night, identity: target.mode, observed: true }),
  terminal: async ({ target }) => ({ night: target.night, identity: target.mode, outcome: 'sixam', sixAm: true }),
  terminalVerification: async () => ({ sixAm: true, positive: true }),
  save: async () => ({ cursorNight: 7, observed: true }),
  retryReady: async () => ({ menuReady: true }),
  restartAfterAbort: async reason => {
    restarts += 1;
    assert.equal(reason.message, 'late handoff');
  },
  localExecutor: { execute: async value => { request = value; return { status: 'COMPLETED', outcome: 'UNVERIFIED' }; },
    abort: async () => { executorAborts += 1; },
    releaseAll: async () => { executorReleases += 1; } },
});
const result = await composed.runner.run();
assert.equal(result.state, 'COMPLETE');
assert.deepEqual(result.completedNights, [6]);
assert.equal(result.attempts[0].save.cursorNight, 7);
assert.equal(request.artifact.plans[0].timing.stopAtMs, 420000);
assert.equal(request.mode, 'live');
assert.equal(executorAborts, 0);
assert.equal(executorReleases, 1, 'a completed campaign still releases the executor once');
await composed.ports.cleanup(new Error('late handoff'));
assert.equal(executorAborts, 1, 'campaign cleanup must abort the active executor');
assert.equal(executorReleases, 2, 'campaign cleanup must release the executor');
assert.equal(restarts, 1, 'campaign cleanup must restart the game after an abort');
console.log('campaign composition: bundle-to-local-executor binding and result handoff pass');
