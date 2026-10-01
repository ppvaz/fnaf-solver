// `npm run review -- query promotions` equals docs/evidence/graph.json's PROMOTED_BY edges.
//
// The query re-derives every edge from the committed packs, their attestations and the committed
// winners. This pins that the derivation and the graph are the same set, edge for edge in
// canonical JSON (47 on 2026-09-29, and never fewer: an edge the packs stop supporting fails
// here); that each carries its attester and custody class; that the comparison it rests on
// catches a dropped, an altered and an extra edge; that S1's open items are derived, not copied;
// and that the CLI prints the in-process query byte for byte and exits 0.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, stableHash } from '@sixam/kernel/contracts';
import { CUSTODY_CLASSES, isUnknown, validateAnnotation } from '@sixam/kernel';
import { PACKS_DIR, trackedWinners, winnerFiles } from '../src/evidence-pack.ts';
import { GRAPH_FILE, PROMOTION_EDGE } from '../src/evidence-promotion.ts';
import { compareEdges, promotionsRecord, queryPromotions } from '../src/promotions-query.ts';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

// The CLI runs beside the in-process query: each compiles every committed winner (~8 s).
const cliRun = new Promise<any>((done, fail) => {
  const child = spawn(process.execPath, [join(ROOT, 'packages/review/src/cli.ts'), 'query', 'promotions'], { cwd: ROOT });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', fail);
  child.on('close', status => done({ status, stdout, stderr }));
});

const winners = trackedWinners(ROOT);
const result = queryPromotions(ROOT, { winners });
const graph = JSON.parse(readFileSync(join(ROOT, GRAPH_FILE), 'utf8'));
const graphEdges = graph.edges.filter(edge => edge.type === PROMOTION_EDGE);

// The query equals the graph's edges.
assert.ok(graphEdges.length >= 47, `graph.json holds ${graphEdges.length} PROMOTED_BY edges; 47 by 2026-09-29`);
const byRun = edges => [...edges].sort((a, b) => a.to.localeCompare(b.to)).map(edge => canonicalJson(edge));
assert.deepEqual(byRun(result.promoted.map(row => row.edge)), byRun(graphEdges),
  'the re-derived PROMOTED_BY edges are exactly the graph\'s, byte for byte in canonical JSON');
assert.equal(result.edges.graph, graphEdges.length);
assert.equal(result.edges.derived, graphEdges.length);
assert.equal(result.edges.matched, graphEdges.length);
for (const key of ['differing', 'notInGraph', 'onlyInGraph', 'refused', 'notSixAm']) assert.deepEqual(result.edges[key], [], key);
assert.equal(result.edges.duplicatedInGraph, 0);
assert.equal(result.lift.failures.length, 0, 'every committed pack lifts');
assert.equal(result.consistent, true);

// Principle 11: the attester and the custody class beside every edge, and each edge an annotation.
for (const row of result.promoted) {
  assert.equal(row.graph, 'MATCHED', row.run);
  assert.equal(row.attestedBy, row.edge.attestedBy);
  assert.ok(typeof row.attestedBy === 'string' && row.attestedBy.length > 0, `${row.run} names its attester`);
  assert.ok(CUSTODY_CLASSES.includes(row.custody.class), `${row.run} carries a kernel custody class`);
  const pack = JSON.parse(readFileSync(join(ROOT, PACKS_DIR, row.run, 'pack.json'), 'utf8'));
  assert.equal(row.custody.class, pack.custody ? 'recovered' : 'complete');
  assert.deepEqual(row.custody.lost, pack.custody?.lost ?? []);
  assert.equal(row.reportedOutcome, 'SixAM', 'a promoted run reported a 6 AM');
  validateAnnotation(row.annotation);
  assert.deepEqual(row.annotation.subject, { kind: 'GameRun', id: row.run });
  assert.equal(row.annotation.value, row.edge.from);
  assert.equal(row.annotation.inputs[0], row.edge.packSha256);
}
const sum = counts => Object.values(counts).reduce((a, b) => a + b, 0);
assert.equal(sum(result.edges.byAttester), graphEdges.length);
assert.equal(sum(result.edges.byCustody), graphEdges.length);

// The comparison catches a dropped, an altered, an extra and a duplicated edge.
const derivedEdges = result.promoted.map(row => row.edge);
const [first, second, ...rest] = graphEdges;
const dropped = compareEdges(derivedEdges, [second, ...rest]);
assert.deepEqual(dropped.notInGraph, [first.to]);
assert.equal(dropped.agree, false);
const altered = compareEdges(derivedEdges, [{ ...first, attestedBy: 'human:someone' }, second, ...rest]);
assert.deepEqual(altered.differing, [first.to]);
assert.equal(altered.agree, false);
const extra = compareEdges(derivedEdges, [...graphEdges, { ...first, to: 'run.not-a-pack' }]);
assert.deepEqual(extra.onlyInGraph, [{ run: 'run.not-a-pack', claim: first.from }]);
assert.equal(compareEdges(derivedEdges, [...graphEdges, first]).agree, false, 'a duplicated edge');
assert.equal(compareEdges(derivedEdges, graphEdges).agree, true);

// S1's open items are derived from the packs and the winners, not copied from prose.
const packHashes = new Set();
for (const id of readdirSync(join(ROOT, PACKS_DIR))) {
  const hash = JSON.parse(readFileSync(join(ROOT, PACKS_DIR, id, 'pack.json'), 'utf8')).bundle?.winnerHash;
  if (hash) packHashes.add(hash);
}
const hashesOf = new Map();
const pathOf = new Map(winnerFiles(ROOT).map(file => [basename(file), file]));
for (const [hash, name] of winners) hashesOf.set(pathOf.get(name), [...(hashesOf.get(pathOf.get(name)) ?? []), hash]);
const winnerV1 = winnerFiles(ROOT).filter(file => JSON.parse(readFileSync(join(ROOT, file), 'utf8')).schema === 'winner-v1');
const open = result.open.modelOnlyWinners;
assert.equal(open.of, winnerV1.length);
assert.equal(open.claimLevel, 'MODEL_ONLY');
for (const file of winnerV1) {
  const named = hashesOf.get(file).some(hash => packHashes.has(hash));
  assert.equal(open.winners.some(item => item.file === file), !named, `${file} is listed exactly when no pack names its hash`);
}
assert.equal(open.count, open.winners.length);
const debt = result.open.untrackedWinnerDebt;
assert.equal(debt.agrees, true, 'the registered bindings without a committed winner are exactly the declared debt');
assert.equal(debt.summary, `${debt.untracked} of ${debt.declared}`);
for (const entry of debt.entries) {
  const committed = winnerFiles(ROOT)
    .some(file => stableHash(JSON.parse(readFileSync(join(ROOT, file), 'utf8'))) === entry.hash);
  assert.equal(entry.committed, committed, `${entry.hash}: committed is read from the tree`);
}

// The record a --write retains: the query, the command, the commit and a content hash over them.
const record = promotionsRecord(result, { date: '2026-09-29', command: 'npm run review -- query promotions', commit: 'a'.repeat(40), dirtyInputs: [] });
assert.equal(record.schema, 'evidence-record-v1');
assert.equal(record.id, 'review-promotions-20260929');
assert.equal(record.query, result);
assert.match(record.evidenceId, /^review-promotions-sha256-[0-9a-f]{16}$/);
assert.notEqual(promotionsRecord(result, { date: '2026-09-29', command: 'x', commit: 'b'.repeat(40), dirtyInputs: [] }).evidenceId,
  record.evidenceId, 'the content hash covers the commit');
assert.ok(!isUnknown(result.promoted[0].custody.class));

// The CLI prints the same query and exits 0.
const cli = await cliRun;
assert.equal(cli.status, 0, `npm run review -- query promotions exits 0; stderr: ${cli.stderr}`);
assert.equal(cli.stdout, `${JSON.stringify(result, null, 2)}\n`, 'the CLI prints the in-process query byte for byte');

console.log(`promotions query: ${result.edges.matched} of ${graphEdges.length} PROMOTED_BY edges re-derive byte for byte from ` +
  `${result.lift.packs} packs (${Object.entries(result.edges.byCustody).map(([k, n]) => `${k} ${n}`).join(', ')}; ` +
  `${Object.entries(result.edges.byAttester).map(([k, n]) => `${k} ${n}`).join(', ')}); open: ${open.count} MODEL_ONLY winners no pack names, ` +
  `UNTRACKED_WINNER_DEBT ${debt.summary}; the comparison catches a dropped, altered, extra and duplicated edge`);
