// Every committed run pack lifts to kernel GameRuns without a throw, and the lift never writes.
//
// ADR 0002: stored records keep their v1 names and readers lift them into kernel words; a value
// the pack does not hold is UNKNOWN with its reason, never a default. This lifts all of
// docs/evidence/runs, checks each GameRun against the kernel's validator, pins the reading on one
// pack of each custody kind, and hashes every pack file before and after to show nothing was written.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isUnknown, validateGameRun } from '@sixam/kernel';
import { PACKS_DIR } from '../src/evidence-pack.mjs';
import { liftPack, packIds } from '../src/pack-lift.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

function treeDigest(dir) {
  const hash = createHash('sha256');
  const walk = path => {
    for (const name of readdirSync(path).sort()) {
      const file = join(path, name);
      if (statSync(file).isDirectory()) walk(file);
      else hash.update(`${file}\0`).update(readFileSync(file));
    }
  };
  walk(dir);
  return hash.digest('hex');
}

const before = treeDigest(join(ROOT, PACKS_DIR));
const ids = packIds(ROOT);
assert.ok(ids.length >= 184, `${ids.length} committed packs; 184 were committed by 2026-09-29`);
const lifted = new Map();
for (const id of ids) {
  let result;
  assert.doesNotThrow(() => { result = liftPack(ROOT, id); }, `${id} lifts`);
  assert.ok(result.runs.length >= 1, `${id} lifts to at least one GameRun`);
  for (const run of result.runs) {
    validateGameRun(run);
    assert.ok(run.id === id || run.id.startsWith(`${id}#attempt`), `${run.id} names its pack`);
  }
  lifted.set(id, result.runs);
}
assert.equal(treeDigest(join(ROOT, PACKS_DIR)), before, 'lifting wrote nothing under docs/evidence/runs');

const one = id => {
  assert.ok(lifted.has(id), `${id} is a committed pack`);
  assert.equal(lifted.get(id).length, 1);
  return lifted.get(id)[0];
};
const json = (id, name) => JSON.parse(readFileSync(join(ROOT, PACKS_DIR, id, name), 'utf8'));

// An original pack: complete custody, a reported 6 AM, the night cut at the executor's own reads.
const original = one('night1-ladder-n1e-20260927T055611Z');
assert.deepEqual(original.reportedOutcome, { kind: 'SixAM' });
assert.deepEqual(original.custody, { class: 'complete', lost: [] });
assert.equal(original.runMode, 'live');
assert.deepEqual(original.spec.campaign, json('night1-ladder-n1e-20260927T055611Z', 'request.json').spec);
assert.equal(original.spec.winnerHash, json('night1-ladder-n1e-20260927T055611Z', 'pack.json').bundle.winnerHash);
assert.equal(original.night[0].label, 'state=night', 'the night begins at the executor\'s first state=night read');
assert.match(original.night.at(-1).type, /^campaign\.terminal\./, 'and ends at its terminal row');
assert.ok(isUnknown(original.venue) && /venue-check-v1/.test(original.venue.reason), 'no venue identity before 2026-09-29');
assert.ok(isUnknown(original.clocks));
const packJson = json('night1-ladder-n1e-20260927T055611Z', 'pack.json');
assert.equal(original.witnesses.length, packJson.files.length + packJson.withheld.length, 'every file the pack names by hash is a witness');

// A recovered pack: recovered custody keeps its lost list, and request.json's absence is a reason, not a default.
const recovered = one('night5-final2-20260912T070853Z');
assert.equal(recovered.custody.class, 'recovered');
assert.deepEqual(recovered.custody.lost, json('night5-final2-20260912T070853Z', 'pack.json').custody.lost);
assert.ok(isUnknown(recovered.spec.campaign) && /request\.json/.test(recovered.spec.campaign.reason));
assert.equal(recovered.reportedOutcome.kind, 'Death', 'the executor reported a death');
for (const field of ['by', 'how', 'rule', 'at'])
  assert.ok(isUnknown(recovered.reportedOutcome[field]), `a death's ${field} is UNKNOWN: the executor never reads it; Review decides it`);

// A lost result: the reported outcome and the run mode are UNKNOWN, with the custody that lost them.
const lost = one('night1-minus7-n1-first-20260919T215053Z');
assert.equal(lost.reportedOutcome.kind, 'UNKNOWN');
assert.match(lost.reportedOutcome.reason, /result\.json is lost/);
assert.ok(isUnknown(lost.runMode));

// An incomplete campaign: the kernel has no custody class for it, so the class is UNKNOWN and says why.
const incomplete = one('night6-tw27-01-20260927T080849Z');
assert.ok(isUnknown(incomplete.custody.class) && /incomplete-campaign/.test(incomplete.custody.class.reason));
assert.deepEqual(incomplete.custody.lost, ['result.json']);
assert.match(incomplete.reportedOutcome.reason, /never wrote result\.json/);

// A campaign that held before any night: aborted, with its state trail; the night is empty, not unknown.
const held = one('night3-ladder-n3-bbfix-20260920T001307Z');
assert.equal(held.reportedOutcome.kind, 'Aborted');
assert.match(held.reportedOutcome.why, /PREFLIGHT>HOLD/);
assert.deepEqual(held.night, []);

// The FNaF 1 runner's pack: its stop-after budget is a Timeout, its night cut at night-origin/night-ended.
const fnaf1 = one('fnaf1-custom-grid420-420-a-20260925T024452598Z');
assert.deepEqual(fnaf1.reportedOutcome, { kind: 'Timeout' });
assert.equal(fnaf1.runMode, 'live');
assert.equal(fnaf1.night[0].type, 'night-origin');
assert.equal(fnaf1.night.at(-1).type, 'night-ended');

const count = key => [...lifted.values()].flat().reduce((sum, run) => ({ ...sum, [key(run)]: (sum[key(run)] ?? 0) + 1 }), {});
const outcomes = count(run => run.reportedOutcome.kind);
const custody = count(run => (isUnknown(run.custody.class) ? 'UNKNOWN' : run.custody.class));
console.log(`pack lift: ${ids.length} committed packs lift to ${[...lifted.values()].flat().length} GameRuns with no throw and no write ` +
  `(${Object.entries(outcomes).map(([k, n]) => `${k} ${n}`).join(', ')}; custody ${Object.entries(custody).map(([k, n]) => `${k} ${n}`).join(', ')})`);
