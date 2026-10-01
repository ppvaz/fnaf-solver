// The evidence index reads the phone's own nights (packages/review/src/evidence-campaign.ts). Before
// 2026-09-18 every artifacts/campaign-*/result.json was UNRECOGNIZED_ARTIFACT, so the index
// reported zero DEVICE_MEASURED runs on a machine holding 24 device wins.
import assert from 'node:assert/strict';
import { isCampaignResult, campaignEntry, campaignPromotionChecks, CAMPAIGN_RESULT_SCHEMA } from '../src/evidence-campaign.ts';

const attempt = (over?) => ({ attempt: 1, mode: 'live', night: 5, status: 'WIN', proofHash: 'fnv1a-7990063c',
  terminal: { night: 5, outcome: 'sixam', sixAm: true }, ...over });
const wrapper = ({ mode = 'live', attempts = [attempt()], plan12Gate }: any = {}) => ({
  mode, status: 'COMPLETE', ...(plan12Gate ? { plan12Gate } : {}),
  result: { schema: CAMPAIGN_RESULT_SCHEMA, version: 1, state: 'COMPLETE', specHash: 'fnv1a-spec',
    completedNights: [5], attempts, events: [] },
});
const FILES = ['result.json', 'events.jsonl', 'request.json', 'observations.jsonl'];

assert.equal(isCampaignResult(wrapper()), true);
assert.equal(isCampaignResult({ mode: 'live', result: { schema: 'device-run-result-v1' } }), false, 'a session result is not a campaign');

const win = campaignEntry('c1', wrapper());
assert.equal(win.kind, 'device-campaign');
assert.equal(win.outcome, 'WIN');
assert.equal(win.claimLevel, 'DEVICE_MEASURED', 'a live campaign is the phone measuring itself');
assert.deepEqual(win.nights, [5]);

assert.equal(campaignEntry('c2', wrapper({ mode: 'dry-run' })).claimLevel, 'FIXTURE', 'only a live campaign is DEVICE_MEASURED');
assert.equal(campaignEntry('c3', wrapper({ attempts: [attempt({ status: 'DEATH', terminal: { night: 5, outcome: 'gameover' } })] })).outcome, 'DEATH');
assert.notEqual(campaignEntry('c4', wrapper({ attempts: [attempt({ proofHash: null })] })).outcome, 'WIN', 'a win needs its proof hash');

assert.deepEqual(campaignPromotionChecks(wrapper(), FILES),
  { offlineEvidence: true, terminalPass: true, manifestComplete: true, plan12Attestation: false },
  'a live win passes everything but the attestation, which is written over its pack, never inferred');
assert.equal(campaignPromotionChecks(wrapper({ plan12Gate: { status: 'PASS' } }), FILES).plan12Attestation, true);
assert.equal(campaignPromotionChecks(wrapper(), ['result.json']).manifestComplete, false, 'the events and request must be retained');

const error = { status: 'ERROR', mode: 'live', error: 'device: lifecycle left night state (static)' };
assert.equal(isCampaignResult(error), true, 'the CLI\'s retained exception is campaign evidence');
assert.deepEqual(campaignEntry('failed', error), { id: 'failed', kind: 'device-campaign', outcome: 'ERROR',
  claimLevel: 'UNKNOWN', nights: [], attempts: [], error: error.error });
assert.deepEqual(campaignPromotionChecks(error, FILES),
  { offlineEvidence: false, terminalPass: false, manifestComplete: true, plan12Attestation: false },
  'custody of an exception does not supply a device terminal');
assert.equal(isCampaignResult({ ...error, error: '' }), false);
assert.equal(isCampaignResult({ ...error, mode: 'arbitrary' }), false);
assert.equal(isCampaignResult({ ...error, result: { schema: 'unrecognized' } }), false, 'an error flag cannot hide a malformed result');

assert.throws(() => campaignEntry('bad', { mode: 'live', result: { schema: CAMPAIGN_RESULT_SCHEMA, version: 2 } }), /schema\/version/,
  'a malformed campaign result is refused, not guessed');
console.log('evidence campaign: live wins are DEVICE_MEASURED, deaths and dry runs are not wins, the gate refuses a campaign directory only on a missing attestation');
