// A cohort result computed from run packs (packages/review/src/evidence-cohort.ts). Builds a
// four-slot cohort of packs in a throwaway tree -- a clean win, a death, a sixam
// the video never graded, and a slot re-run after an attempt that never reached
// the night -- and checks the predeclared rule is applied, not assumed.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CAMPAIGN_RESULT_SCHEMA } from '../src/evidence-campaign.ts';
import { buildPack, resolvePackTargets, writePack } from '../src/evidence-pack.ts';
import { COHORT_RESULT_SCHEMA, CORNER_COHORT_RESULT_SCHEMA, computeCohort, labelPrefix } from '../src/evidence-cohort.ts';

const root = mkdtempSync(join(tmpdir(), 'evidence-cohort-test-'));
const packs = join(root, 'docs/evidence/runs');
const put = (path, content) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); };
let serial = 0;
const night = 7;
function run(label, { outcome, reached = true, video = null, timeline = null, lostResult = false, winnerHash = 'fnv1a-bound', dials = null, observedDials = dials }) {
  serial += 1;
  const campaign = `campaign-2026-09-18T0${serial}-00-00.000Z`;
  const stamp = `20260918T03${String(serial).padStart(2, '0')}00Z`;
  const id = `night${night}-${label}-${stamp}`;
  const win = outcome === 'sixam';
  put(`artifacts/runs/${id}/run-report.json`, JSON.stringify({ night: { reached } }));
  put('artifacts/b/manifest.json', JSON.stringify({ winnerHash }));
  if (timeline) put(`artifacts/runs/${id}/timeline.json`, JSON.stringify({ video: `captures/${id}.mp4`, terminal: timeline }));
  if (lostResult) {
    // The campaign directory is gone and its result was never printed: only the log is left.
    const dir = `${root}/artifacts/${campaign}`;
    put(`artifacts/runs/${id}/verdict.txt`, `run          ${id}\nbundle       artifacts/b\ncampaign dir ${dir}\n`);
    put(`artifacts/runs/${id}/campaign.log`, [
      { at: '2026-09-18T03:21:22.200Z', type: 'evidence.started', evidenceDirectory: dir },
      { at: '2026-09-18T03:22:08.286Z', type: 'campaign.abort.restart', reason: 'device: lifecycle left night state (static)' },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    const [target] = resolvePackTargets(root, id);
    writePack(join(packs, id), buildPack({ root, ...target }));
    return id;
  }
  put(`artifacts/${campaign}/result.json`, JSON.stringify({ mode: 'live', status: 'COMPLETE', result: {
    schema: CAMPAIGN_RESULT_SCHEMA, version: 1, state: win ? 'COMPLETE' : 'ABORTED', specHash: 'fnv1a-spec',
    completedNights: win ? [night] : [], events: [],
    attempts: [{ attempt: 1, mode: 'live', night, status: win ? 'WIN' : 'DEATH', proofHash: win ? 'fnv1a-proof' : null,
      terminal: { night, outcome } }] } }));
  put(`artifacts/${campaign}/events.jsonl`, [
    { type: 'evidence.started' },
    ...(observedDials ? [{ type: 'observation', label: JSON.stringify({ status: 'PASS', dials: observedDials }) }] : []),
    ...(reached ? [{ type: 'observation', label: 'state=night' }] : []),
  ].map(e => JSON.stringify(e)).join('\n') + '\n');
  put(`artifacts/${campaign}/request.json`, JSON.stringify(dials ? { spec: { nights: [{ night, dials }] } } : {}));
  put(`artifacts/runs/${id}/verdict.txt`, `run          ${id}\nbundle       artifacts/b\ncampaign dir ${root}/artifacts/${campaign}\n`);
  if (video) put(`artifacts/runs/${id}/grade.log`, `--- run timeline ---\n  TERMINAL: ${video}\n`);
  const built = buildPack({ root, campaignDir: join(root, 'artifacts', campaign),
    runDir: join(root, 'artifacts/runs', id), packId: id });
  writePack(join(packs, id), built);
  return id;
}
try {
  const predeclaration = { schema: 'cohort-predeclaration-v1', night, size: 4,
    binding: { winnerHash: 'fnv1a-bound' }, labels: 'night7-k9-cohort-r01 .. night7-k9-cohort-r04' };
  assert.equal(labelPrefix(predeclaration), 'night7-k9-cohort');
  run('night7-k9-cohort-r01', { outcome: 'sixam', video: 'clear -- sixam at 453.5 s' });
  run('night7-k9-cohort-r02', { outcome: 'death', video: 'death -- visual-foxy-jumpscare at 20.0 s' });
  run('night7-k9-cohort-r03', { outcome: 'sixam' });
  run('night7-k9-cohort-r04', { outcome: 'death', reached: false });
  run('night7-k9-cohort-r04b', { outcome: 'sixam', video: 'clear -- sixam at 455.0 s' });
  run('night7-other-r01', { outcome: 'sixam', video: 'clear' });

  const result = computeCohort(predeclaration, packs, { source: 'fixture' });
  assert.equal(result.schema, COHORT_RESULT_SCHEMA);
  assert.deepEqual(result.slots.map(slot => slot.status), ['WIN', 'DEATH', 'UNGRADED', 'WIN']);
  assert.equal(result.winRate, '2/4');
  assert.equal(result.ungraded, 1, 'a sixam the video never graded is not a win');
  assert.equal(result.status, 'INCOMPLETE');
  const r04 = result.slots[3].runs;
  assert.deepEqual(r04.map(entry => entry.role), ['excluded', 'counted'], 'a run that never reached the night is excluded, its re-run counts');
  assert.ok(result.slots.every(slot => slot.runs.every(entry => /^[0-9a-f]{64}$/.test(entry.packSha256))),
    'every slot cites the pack it was read from');
  assert.equal(result.slots.flatMap(slot => slot.runs).length, 5, 'another cohort\'s packs are not read');
  assert.deepEqual(result.wrongBinding, []);

  run('night7-k9-cohort-r03b', { outcome: 'sixam', video: 'clear -- sixam at 454.0 s', winnerHash: 'fnv1a-other' });
  const rerun = computeCohort(predeclaration, packs);
  assert.equal(rerun.slots[2].status, 'WIN');
  assert.deepEqual(rerun.slots[2].runs.map(entry => entry.role), ['superseded', 'counted']);
  assert.equal(rerun.wrongBinding.length, 1, 'a run on another binding is named, not silently counted');
  assert.throws(() => computeCohort({ ...predeclaration, schema: 'x' }, packs), /cohort-predeclaration-v1/);

  // run-timeline.py's own output shape, and a slot whose result was lost with its campaign.
  const wider = { ...predeclaration, size: 6, labels: 'night7-k9-cohort-r01 .. night7-k9-cohort-r06' };
  run('night7-k9-cohort-r05', { outcome: 'sixam', timeline: { outcome: 'clear', evidence: 'sixam', at_s: 453.5 } });
  run('night7-k9-cohort-r06', { outcome: 'death', lostResult: true,
    timeline: { outcome: 'unknown', evidence: null, at_s: null, note: 'nothing terminal was captured' } });
  const six = computeCohort(wider, packs);
  assert.equal(six.slots[4].status, 'WIN', 'a timeline.json grade is read from terminal.outcome');
  assert.equal(six.slots[4].runs[0].videoDetail, 'sixam at 453.5 s');
  const lostSlot = six.slots[5].runs[0];
  assert.equal(lostSlot.executor, 'RESULT_LOST');
  assert.equal(six.slots[5].status, 'UNKNOWN', 'an abort with no terminal and an unknown video is not promoted to a death');
  assert.equal(lostSlot.abort, 'device: lifecycle left night state (static)', 'the executor\'s own abort reason is reported beside it');

  // Two dial corners have two rNN slots EACH, not four slots under either prefix.
  const corners = { schema: 'cohort-predeclaration-v1', night, size: 4,
    binding: { winnerHash: 'fnv1a-bound' }, corners: [
      { id: 'bbfoxy', dials: { bb: 20, foxy: 20 }, labels: 'corner-bbfoxy-r01, corner-bbfoxy-r02' },
      { id: 'bbgolden', dials: { bb: 20, golden: 20 }, labels: 'corner-bbgolden-r01, corner-bbgolden-r02' },
    ] };
  run('corner-bbfoxy-r01', { outcome: 'death', reached: false });
  run('corner-bbfoxy-r01', { outcome: 'death', video: 'death -- terminal-static at 44.0 s', dials: corners.corners[0].dials });
  run('corner-bbfoxy-r02', { outcome: 'sixam', timeline: { outcome: 'clear', evidence: 'sixam', at_s: 455 }, dials: corners.corners[0].dials });
  run('corner-bbgolden-r01', { outcome: 'sixam' });
  const partial = computeCohort(corners, packs, { source: 'corners.json' });
  assert.equal(partial.schema, CORNER_COHORT_RESULT_SCHEMA);
  assert.equal(partial.winRate, '1/3');
  assert.equal(partial.missing, 1);
  assert.equal(partial.ungraded, 1);
  assert.equal(partial.status, 'INCOMPLETE');
  assert.deepEqual(partial.corners.map(c => c.result.slots.map(s => s.status)), [['DEATH', 'WIN'], ['UNGRADED', 'MISSING']]);
  assert.deepEqual(partial.corners[0].result.slots[0].runs.map(r => r.role), ['excluded', 'counted']);
  assert.deepEqual(partial.corners[0].dials, { bb: 20, foxy: 20 });
  assert.equal(partial.evidenceId, computeCohort(corners, packs, { source: 'corners.json' }).evidenceId);
  assert.equal(partial.unverifiedDials.length, 1, 'a label alone does not verify the dial vector');
  run('corner-bbgolden-r01b', { outcome: 'sixam', video: 'clear -- sixam at 456 s', dials: corners.corners[1].dials });
  run('corner-bbgolden-r02', { outcome: 'sixam', video: 'clear -- sixam at 455 s', dials: corners.corners[1].dials });
  const complete = computeCohort(corners, packs, { source: 'corners.json' });
  assert.equal(complete.status, 'COMPLETE');
  assert.equal(complete.winRate, '3/4');
  assert.deepEqual(complete.unverifiedDials, []);
  assert.notEqual(complete.evidenceId, partial.evidenceId, 'the evidence ID changes with the retained result');
  assert.throws(() => computeCohort({ ...corners, size: 5 }, packs), /add up/);
  assert.throws(() => computeCohort({ ...corners, corners: [corners.corners[0], corners.corners[0]] }, packs), /unique/);
  assert.throws(() => computeCohort(corners, packs, { prefix: 'corner-bbfoxy' }), /prefix override/);
  assert.throws(() => computeCohort({ ...corners, corners: [{ ...corners.corners[0], labels: 'corner-bbfoxy-r01 .. r02' }] }, packs), /add up/);
  run('corner-bbgolden-r02b', { outcome: 'sixam', video: 'clear', dials: corners.corners[1].dials, observedDials: corners.corners[0].dials });
  const mismatch = computeCohort(corners, packs);
  assert.equal(mismatch.status, 'INCOMPLETE', 'a wrong dial readback cannot complete a corner cohort');
  assert.equal(mismatch.unverifiedDials.length, 1);
  run('corner-bbgolden-r02c', { outcome: 'sixam', video: 'clear', dials: corners.corners[1].dials, winnerHash: 'fnv1a-other' });
  const wrongWinner = computeCohort(corners, packs);
  assert.deepEqual(wrongWinner.unverifiedDials, []);
  assert.equal(wrongWinner.wrongBinding.length, 1);
  assert.equal(wrongWinner.status, 'INCOMPLETE', 'matching dials do not excuse a different winner binding');
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('evidence cohort: the predeclared rule is applied per slot from packs, ungraded sixams are not wins, re-runs and exclusions are named');
