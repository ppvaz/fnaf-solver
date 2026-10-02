// Plan 12 attestation and promotion over run packs (packages/review/src/evidence-promotion.ts). Pedro,
// 2026-09-27, delegated writing the attestation to agents and accepted recovered packs fully.
// What that must not become: an attestation written over a pack nobody re-derived, one that
// outlives an edit to its pack, one over a pack failing another check, a recovered pack whose
// losses disappear, or a promotion nobody can see. Throwaway tree; no device.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stableHash } from '@sixam/kernel/contracts';
import { CAMPAIGN_RESULT_SCHEMA } from '../src/evidence-campaign.ts';
import { AGENT_DELEGATION, ATTESTATION_FILE, ATTESTATION_SCHEMA, ATTESTATION_SCHEMA_V1, ATTESTED_CHECKS, RECOVERY_RECORD,
  attestationStatus, buildFnaf1Pack, buildPack, packManifestComplete, packPromotionChecks, readPack, resolvePackTargets, writePack } from '../src/evidence-pack.ts';
import { GRAPH_FILE, attestPack, derivePromotion, formatGraph, makeAttestation, promotionEdgeFor, promotionSummary, readGraph,
  recordPromotion } from '../src/evidence-promotion.ts';
import type { RunPack } from '../src/evidence-pack.ts';

type CampaignTarget = Extract<ReturnType<typeof resolvePackTargets>[number], { campaignDir: string }>;
type Claim = NonNullable<ReturnType<typeof derivePromotion>['claim']>;
type Dials = Readonly<Record<string, number>>;

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const root = mkdtempSync(join(tmpdir(), 'evidence-promotion-test-'));
const put = (path: string, content: string | Buffer) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); };
const TEN_AT_20 = { withfreddy: 20, withbonnie: 20, withchica: 20, foxy: 20, toyfreddy: 20, toybonnie: 20, toychica: 20, mangle: 20, bb: 20, golden: 20 };
const agent = { by: 'agent' as const, note: 'test-evidence-promotion.mjs', date: '2026-09-27' };

try {
  const winner = { schema: 'winner-v1', strategy: 'minus-toys', knobs: { hallOffsetMs: 7400 } };
  put('packages/propose/bindings/fnaf2/campaign-night5-test-winner.json', JSON.stringify(winner));
  put('artifacts/b1/manifest.json', JSON.stringify({ schema: 'device-bundle-v1', winnerHash: stableHash(winner) }));
  const winners = new Map([[stableHash(winner), 'campaign-night5-test-winner.json']]);
  put(RECOVERY_RECORD, JSON.stringify({ schema: 'custody-recovery-check-v1',
    summary: { campaigns: 9, eventsIdentical: 9, resultsPrinted: 7, resultsIdentical: 7, resultsNotPrinted: [] } }));
  put(GRAPH_FILE, formatGraph({ schema: 'claim-evidence-v1', version: 1,
    nodes: [{ id: 'run.fixture', kind: 'Run', label: 'fixture dry run' }], edges: [] }));

  const saves: Record<number, Record<string, boolean>> = {
    5: { observed: true, menuReturned: true, continueVisible: true, sixthNightVisible: true },
    7: { observed: true, menuReturned: true, customCompleted: true },
  };
  const result = (night: number, won: boolean) => ({ mode: 'live', status: 'COMPLETE', result: {
    schema: CAMPAIGN_RESULT_SCHEMA, version: 1, state: 'COMPLETE', specHash: 'fnv1a-spec', completedNights: won ? [night] : [],
    attempts: [won
      ? { attempt: 1, mode: night === 7 ? 'custom' : 'story', night, status: 'WIN', proofHash: 'fnv1a-proof',
        terminal: { night, outcome: 'sixam', sixAm: true }, terminalVerification: { sixAm: true, positive: true }, save: saves[night] }
      : { attempt: 1, mode: 'story', night, status: 'DEATH', terminal: { night, outcome: 'gameover' } }],
    events: [] } });
  const rows = (dir: string, { won = true, dials = null }: { won?: boolean, dials?: Dials | null } = {}) => [
    { at: '2026-09-27T00:00:00.000Z', type: 'evidence.started', evidenceDirectory: dir },
    ...(dials ? [{ at: '2026-09-27T00:00:01.000Z', type: 'observation',
      label: JSON.stringify({ status: 'PASS', dials, puppet: 15, unknown: [] }) }] : []),
    { at: '2026-09-27T00:00:02.000Z', type: 'observation', label: 'state=night' },
    ...(won ? [{ at: '2026-09-27T00:07:00.000Z', type: 'campaign.terminal.from-executor', state: 'sixam', outcome: 'sixam' }] : []),
  ].map(row => JSON.stringify(row)).join('\n') + '\n';

  /** A campaign whose directory survived, packed under its night-run label. */
  const original = (label: string, { night = 5, won = true, dials = null, requested = dials, timeline = null }:
    { night?: number, won?: boolean, dials?: Dials | null, requested?: Dials | null, timeline?: string | null } = {}) => {
    const campaign = `campaign-${label}`;
    put(`artifacts/${campaign}/result.json`, JSON.stringify(result(night, won)));
    put(`artifacts/${campaign}/events.jsonl`, rows(`${root}/artifacts/${campaign}`, { won, dials }));
    put(`artifacts/${campaign}/request.json`, JSON.stringify(requested ? { spec: { nights: [{ night, dials: requested }] } } : {}));
    put(`artifacts/runs/${label}/verdict.txt`, `run          ${label}\nbundle       artifacts/b1\ncampaign dir ${root}/artifacts/${campaign}\n`);
    if (timeline) {
      put(`artifacts/runs/${label}/video.sha256`, `${'d'.repeat(64)}  captures/${label}.mp4\n`);
      put(`artifacts/runs/${label}/timeline.json`, JSON.stringify({ video: `captures/${label}.mp4`, terminal: { outcome: timeline } }));
    }
    const [target] = resolvePackTargets(root, label) as CampaignTarget[]; // its campaign directory is on disk
    writePack(join(root, 'docs/evidence/runs', label), buildPack({ root, ...target }));
    return join(root, 'docs/evidence/runs', label);
  };
  /** A campaign that is gone, recovered from the night-run log. */
  const recovered = (label: string, { night = 7, dials = TEN_AT_20 } = {}) => {
    const campaignDir = `${root}/artifacts/campaign-${label}-gone`;
    const log = `${rows(campaignDir, { dials })}${JSON.stringify(result(night, true), null, 2)}\n`;
    put(`artifacts/runs/${label}/verdict.txt`, `run          ${label}\nbundle       artifacts/b1\ncampaign dir ${campaignDir}\n`);
    put(`artifacts/runs/${label}/campaign.log`, log);
    const [target] = resolvePackTargets(root, label) as CampaignTarget[]; // a campaign recovered from its night-run log
    assert.equal(target.recoverFromLog, true);
    writePack(join(root, 'docs/evidence/runs', label), buildPack({ root, ...target }));
    return join(root, 'docs/evidence/runs', label);
  };

  // An original Night 5 win: every check re-derived, the attestation written by an agent.
  const winId = 'night5-win-20260927T000000Z';
  const winDir = original(winId);
  const derived = derivePromotion(root, winId, winners);
  assert.equal(derived.pass, true);
  assert.deepEqual(derived.verified.map(item => item.check), [...ATTESTED_CHECKS, 'claimIdentity']);
  assert.equal(derived.claim?.id, 'claim.fnaf2.night5.device-6am');
  const packed = readPack(winDir).pack.files;
  const terminal = derived.verified.find(item => item.check === 'terminalPass');
  assert.deepEqual(terminal?.inputs, ['result.json', 'events.jsonl'].map(name => ({ name, sha256: packed.find(f => f.name === name)?.sha256 })),
    'each check names the sha256 of every input it read');
  assert.equal(packPromotionChecks(readPack(winDir), winners).plan12Attestation, false, 'nothing is attested until attest runs');
  const written = attestPack(root, winId, winners, agent);
  assert.equal(written.status, 'WRITTEN');
  const attestation = JSON.parse(readFileSync(join(winDir, ATTESTATION_FILE), 'utf8'));
  assert.equal(attestation.schema, ATTESTATION_SCHEMA);
  assert.equal(attestation.packSha256, readPack(winDir).digest);
  assert.deepEqual(attestation.attestedBy, { kind: 'agent', delegation: AGENT_DELEGATION, note: agent.note }, 'an agent attestation names its author');
  assert.deepEqual(attestation.custody, { kind: 'original', lost: [] });
  assert.deepEqual(packPromotionChecks(readPack(winDir), winners), { offlineEvidence: true, terminalPass: true,
    manifestComplete: true, plan12Attestation: true, winnerCommitted: true }, 'an agent attestation under the delegation is accepted');
  assert.equal(attestPack(root, winId, winners, { ...agent, date: '2026-09-28' }).status, 'UNCHANGED', 're-attesting the same pack is a no-op');
  assert.throws(() => attestPack(root, winId, winners, { by: 'human', name: 'Pedro Vaz', date: '2026-09-27' }), /different attestation/,
    'an attestation is not edited in place');
  assert.equal(attestPack(root, winId, winners, { by: 'human', name: 'Pedro Vaz', date: '2026-09-27' }, { replace: true }).status, 'REPLACED');
  assert.equal(attestationStatus(JSON.parse(readFileSync(join(winDir, ATTESTATION_FILE), 'utf8')), readPack(winDir).digest).by, 'human:Pedro Vaz');
  attestPack(root, winId, winners, agent, { replace: true });

  // What the gate refuses in an attestation.
  const digest = readPack(winDir).digest;
  const base: { readonly verified: readonly { readonly check: string }[], readonly [field: string]: unknown } =
    JSON.parse(readFileSync(join(winDir, ATTESTATION_FILE), 'utf8'));
  const status = (over: Record<string, unknown>) => attestationStatus({ ...base, ...over }, digest);
  assert.match(status({ packSha256: '0'.repeat(64) }).reason as string, /binds pack sha256 0{64}, not this pack's/, 'a mismatched digest is refused'); // a refusal names its reason
  assert.equal(status({ attestedBy: { kind: 'agent', note: 'x' } }).valid, false, 'an agent attests only under the delegation');
  assert.equal(status({ attestedBy: { kind: 'agent', delegation: AGENT_DELEGATION, note: ' ' } }).valid, false, 'an agent names its session');
  assert.equal(status({ attestedBy: { kind: 'human', name: '' } }).valid, false);
  assert.equal(status({ attestedBy: 'Pedro' }).valid, false, 'v2 needs a structured author');
  assert.equal(status({ status: 'FAIL' }).valid, false);
  assert.match(status({ verified: base.verified.filter(item => item.check !== 'winnerCommitted') }).reason as string, /winnerCommitted/, // as above
    'an attestation that does not list a check as verified is refused');
  assert.equal(status({ verified: base.verified.map(item => ({ ...item, pass: item.check !== 'terminalPass' })) }).valid, false);
  assert.equal(attestationStatus({ schema: ATTESTATION_SCHEMA_V1, status: 'PASS', packSha256: digest, attestedBy: 'Pedro' }, digest).valid, true,
    'a v1 attestation (a person\'s name) is still read');
  assert.throws(() => makeAttestation(derived, { by: 'agent', date: '2026-09-27' }), /--note/);
  assert.throws(() => makeAttestation(derived,
    { by: 'bot', note: 'x', date: '2026-09-27' } as unknown as Parameters<typeof makeAttestation>[1]), /agent or human/); // an unknown author, on purpose
  // Editing any packed file voids the attestation: readPack refuses the pack itself.
  const events = join(winDir, 'events.jsonl');
  const kept = readFileSync(events);
  writeFileSync(events, `${kept} `);
  assert.throws(() => derivePromotion(root, winId, winners), /integrity mismatch/);
  writeFileSync(events, kept);

  // An attestation is never written over a pack failing another check, and a hand-written one
  // does not carry such a pack through the gate.
  const deathId = 'night5-death-20260927T001000Z';
  const deathDir = original(deathId, { won: false });
  const refused = attestPack(root, deathId, winners, agent);
  assert.equal(refused.status, 'REFUSED');
  assert.deepEqual(refused.failed, ['terminalPass', 'claimIdentity']);
  assert.ok(!existsSync(join(deathDir, ATTESTATION_FILE)), 'a refused attestation writes nothing');
  writeFileSync(join(deathDir, ATTESTATION_FILE), JSON.stringify({ ...base, evidenceId: deathId, packSha256: readPack(deathDir).digest }));
  const forced = packPromotionChecks(readPack(deathDir), winners);
  assert.equal(forced.plan12Attestation, true);
  assert.equal(forced.terminalPass, false, 'an attestation cannot supply a terminal');
  const uncommitted = attestPack(root, winId, new Map(), agent, { replace: true });
  assert.equal(uncommitted.status, 'REFUSED', 'a win whose winner is not committed is refused');
  assert.deepEqual(uncommitted.failed, ['winnerCommitted']);
  const contradicted = 'night5-contradicted-20260927T002000Z';
  original(contradicted, { timeline: 'death' });
  assert.match(String(derivePromotion(root, contradicted, winners).verified.find(item => item.check === 'terminalPass')?.detail.failed),
    /video grade reads death/, 'a packed video grade that disagrees with the executor refuses the terminal');
  const graded = 'night5-graded-20260927T003000Z';
  original(graded, { timeline: 'clear' });
  assert.equal(derivePromotion(root, graded, winners).pass, true);

  // A recovered Night 7 10/20 win passes custody and still shows what it lost.
  const recId = 'night7-recovered-r01-20260927T004000Z';
  const recDir = recovered(recId);
  const recDerived = derivePromotion(root, recId, winners);
  assert.equal(recDerived.pass, true);
  assert.equal(recDerived.claim?.id, 'claim.fnaf2.night7.10-20.device-6am', 'a Custom Night is named by its own menu readback');
  const custodyCheck = recDerived.verified.find(item => item.check === 'manifestComplete');
  assert.deepEqual(custodyCheck?.detail.lost, ['observations.jsonl', 'observer frames', 'request.json']);
  assert.ok(custodyCheck?.inputs.some(input => input.name === RECOVERY_RECORD && input.sha256 === sha256(readFileSync(join(root, RECOVERY_RECORD)))));
  assert.ok(custodyCheck?.inputs.some(input => input.name === 'run/campaign.log'));
  assert.equal(attestPack(root, recId, winners, agent).status, 'WRITTEN');
  const recAttestation = JSON.parse(readFileSync(join(recDir, ATTESTATION_FILE), 'utf8'));
  assert.deepEqual(recAttestation.custody, { kind: 'recovered-from-run-log', lost: ['observations.jsonl', 'observer frames', 'request.json'] },
    'the attestation keeps the loss visible');
  assert.equal(Object.values(packPromotionChecks(readPack(recDir), winners)).every(Boolean), true);
  const recPack = readPack(recDir).pack;
  assert.equal(packManifestComplete({ ...recPack, custody: { ...recPack.custody, sourceSha256: 'e'.repeat(64) } as NonNullable<RunPack['custody']> }, // a recovered pack names its custody
    readPack(recDir).files), false,
    'recovered custody must cite the log the pack withheld, by the same sha256');
  assert.equal(packManifestComplete({ ...recPack, custody: { ...recPack.custody, lost: undefined } } as unknown as RunPack, // no lost list, on purpose
    readPack(recDir).files), false,
    'recovered custody must say what it lost');
  assert.equal(packManifestComplete({ ...recPack, custody: { kind: 'incomplete-campaign', lost: ['result.json'] } }, readPack(recDir).files), false);
  const recordBytes = readFileSync(join(root, RECOVERY_RECORD));
  put(RECOVERY_RECORD, JSON.stringify({ summary: { campaigns: 9, eventsIdentical: 8, resultsPrinted: 7, resultsIdentical: 7 } }));
  assert.equal(derivePromotion(root, recId, winners).verified.find(item => item.check === 'manifestComplete')?.pass, false,
    'a recovery check that is not byte-identical cannot back recovered custody');
  writeFileSync(join(root, RECOVERY_RECORD), recordBytes);

  // Night 7 claims: another vector is another claim; a readback that disagrees with the
  // request, or none at all, names none.
  original('night7-corner-r01-20260927T005000Z', { night: 7, dials: { ...Object.fromEntries(Object.keys(TEN_AT_20).map(k => [k, 0])), bb: 20, foxy: 20 } });
  assert.equal(derivePromotion(root, 'night7-corner-r01-20260927T005000Z', winners).claim?.id, 'claim.fnaf2.night7.foxy20-bb20.device-6am');
  original('night7-mismatch-20260927T006000Z', { night: 7, dials: TEN_AT_20, requested: { ...TEN_AT_20, golden: 0 } });
  assert.match(String(derivePromotion(root, 'night7-mismatch-20260927T006000Z', winners).verified.find(item => item.check === 'claimIdentity')?.detail.failed),
    /differs from the requested/);
  original('night7-noreadback-20260927T007000Z', { night: 7 });
  assert.equal(attestPack(root, 'night7-noreadback-20260927T007000Z', winners, agent).status, 'REFUSED',
    'a Custom Night whose vector the pack never observed cannot be named, so it is not attested');

  // Promotion is recorded, visibly, and only once.
  const graph = readGraph(root);
  const first = recordPromotion(graph, { id: recId, claim: recDerived.claim as Claim, digest: recDerived.digest, // it passed, so it names its claim
    attestation: recAttestation, custody: recDerived.custody, nights: [7] });
  assert.equal(first.status, 'ADDED');
  assert.deepEqual(first.edge, { from: 'claim.fnaf2.night7.10-20.device-6am', to: `run.${recId}`, type: 'PROMOTED_BY',
    source: `docs/evidence/runs/${recId}/${ATTESTATION_FILE}`, packSha256: recDerived.digest, attestedBy: `agent:${AGENT_DELEGATION}`,
    attestedOn: '2026-09-27', custody: 'recovered-from-run-log', lost: ['observations.jsonl', 'observer frames', 'request.json'],
    authority: 'plans/12-end-to-end-evidence-campaign.md' }, 'the edge names who attested and what custody lost');
  writeFileSync(join(root, GRAPH_FILE), formatGraph(first.graph));
  assert.equal(readFileSync(join(root, GRAPH_FILE), 'utf8'), formatGraph(readGraph(root)), 'the graph layout round-trips');
  assert.equal(recordPromotion(readGraph(root), { id: recId, claim: recDerived.claim as Claim, digest: recDerived.digest, // as above
    attestation: recAttestation, custody: recDerived.custody, nights: [7] }).status, 'ALREADY_RECORDED');
  assert.equal(promotionEdgeFor(readGraph(root), recId)?.packSha256, recDerived.digest);
  const summary = promotionSummary(root, winners);
  assert.equal(summary.nights['7'].promoted, 1);
  assert.equal(summary.nights['5'].promoted, 0, 'an attested pack is not promoted until its edge is recorded');
  assert.ok(summary.refusedWins.some(item => item.id === winId && item.failing.includes('not recorded in the graph')));
  assert.ok(summary.nights['5'].refused['terminalPass'] >= 1, 'a refusal names its failing check');
  assert.match(summary.evidenceId, /^plan12-promotions-fnv1a-/);
  // A runner's pack carries kind fnaf1-run whatever game it played (FNaF 4's runner packs do):
  // it is filed under the game its record targets, and FNaF 1's gate does not judge it.
  const fnaf4 = 'fnaf4-loop-n3c-teach-20260925T054831301Z';
  put(`artifacts/runs/${fnaf4}/run.json`, JSON.stringify({ status: 'COMPLETE', claimLevel: 'DEVICE_MEASURED',
    target: { package: 'com.scottgames.fnaf4' }, options: { live: true, dryRun: false } }));
  put(`artifacts/runs/${fnaf4}/events.jsonl`, `${JSON.stringify({ type: 'night-ended', ended: 'SIX_AM', atNightMs: 480000 })}\n`);
  const [fnaf4Target] = resolvePackTargets(root, fnaf4);
  writePack(join(root, 'docs/evidence/runs', fnaf4), buildFnaf1Pack({ root, ...fnaf4Target } as Parameters<typeof buildFnaf1Pack>[0]));
  const fnaf4Derived = derivePromotion(root, fnaf4, winners);
  assert.equal(fnaf4Derived.pass, false);
  assert.ok(fnaf4Derived.verified.every(item => !item.pass && /fnaf4/.test(String(item.detail.failed))),
    'every check refuses, naming the game no promotion gate reads yet');
  const filed = promotionSummary(root, winners).nights;
  assert.equal(filed.fnaf4?.packs, 1, 'a FNaF 4 runner\'s pack is filed under fnaf4');
  assert.equal(filed.fnaf1, undefined, 'and not under FNaF 1');
  // An edge that outlives its attestation is reported, not hidden.
  rmSync(join(recDir, ATTESTATION_FILE));
  assert.deepEqual(promotionSummary(root, winners).staleEdges, [{ id: recId, reason: 'edge recorded but plan12Attestation fail' }]);
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('evidence promotion: an agent attests only what it re-derived from the pack, a mismatched digest or a pack failing another check is refused, recovered custody passes while naming its loss, and every promotion is a visible PROMOTED_BY edge');
