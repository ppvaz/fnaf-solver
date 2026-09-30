// The solver interface's verbs, in process and through `npm run review` (Plan 28 steps 2-4).
//
// Every answer is a valid claim-envelope-v1. describe is a join, not prose: for every registered
// game its counts equal the registers it cites -- the chronicle, the contract register, the packs
// and the graph's PROMOTED_BY edges -- and what a register cannot say is UNKNOWN with its reason.
// promote proposes exactly the edge the graph records for every promoted pack and refuses every
// other pack, and nothing any verb does writes under docs/evidence. The CLI prints the same
// envelopes, exits 1 on a refusal, and `query promotions --envelope` wraps exactly the query.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '@sixam/kernel/contracts';
import { CONTROL_CATALOGS } from '@sixam/source';
import { NO_LOCAL_DUMP, VAULT_ENV } from '@sixam/source/truth';
import { isUnknown, validateClaimEnvelope } from '@sixam/kernel';
import { PACKS_DIR, trackedWinners } from '../src/evidence-pack.mjs';
import { GRAPH_FILE, PROMOTION_EDGE } from '../src/evidence-promotion.mjs';
import { queryPromotions } from '../src/promotions-query.mjs';
import { GAMES, catalogUnknowns, isNegative, readArchivedRoutes, readChronicle, readContracts } from '../src/registers.mjs';
import { INSTRUMENTS, VERBS, createSolver } from '../src/solver.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const CLI = join(ROOT, 'packages/review/src/cli.mjs');
// truth reads a host's own local dump; this test runs with none configured, in process and in the CLI it spawns.
process.env[VAULT_ENV] = join(tmpdir(), `solver-test-no-vault-${process.pid}.json`);

// The CLI's promotions envelope compiles every committed winner (~7 s): it runs beside the rest.
const envelopeRun = new Promise((done, fail) => {
  const child = spawn(process.execPath, [CLI, 'query', 'promotions', '--envelope'], { cwd: ROOT });
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.on('error', fail);
  child.on('close', status => done({ status, stdout }));
});

const treeHash = dir => {
  const hash = createHash('sha256');
  const walk = path => {
    for (const name of readdirSync(path).sort()) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) walk(full);
      else hash.update(`${full}\0`).update(readFileSync(full));
    }
  };
  walk(dir);
  return hash.digest('hex');
};
const before = treeHash(join(ROOT, 'docs/evidence'));

const winners = trackedWinners(ROOT);
const solver = createSolver({ root: ROOT, winners: () => winners });
const claim = (value, what) => {
  validateClaimEnvelope(value);
  assert.notEqual(value.refused, true, `${what} is a claim: ${JSON.stringify(value).slice(0, 300)}`);
  return value;
};
const refusal = (value, rule, what) => {
  validateClaimEnvelope(value);
  assert.equal(value.refused, true, `${what} is refused`);
  assert.equal(value.rule, rule, `${what} is refused by ${rule}, not ${value.rule}`);
  return value;
};
assert.deepEqual([...VERBS], ['describe', 'query', 'review', 'promote', 'check', 'truth']);

// --- describe: a join over the registers, for every registered game ---------------------------
const graph = JSON.parse(readFileSync(join(ROOT, GRAPH_FILE), 'utf8'));
const graphEdges = graph.edges.filter(edge => edge.type === PROMOTION_EDGE);
const chronicle = readChronicle(ROOT);
const contracts = readContracts(ROOT).contracts;
const packIds = readdirSync(join(ROOT, PACKS_DIR));
for (const game of GAMES) {
  const described = claim(solver.describe({ game: game.alias }), `describe ${game.alias}`);
  assert.deepEqual(described, solver.describe({ game: game.package }), 'a game by package or short name is the same answer');
  assert.equal(described.target, game.package);
  const { controls, contracts: bound, chronicle: story, phone, gaps } = described.claim;
  const catalog = CONTROL_CATALOGS[game.package];
  assert.equal(controls.count, catalog.controls.length);
  for (const item of catalogUnknowns(catalog))
    assert.ok(described.notMeasured.includes(`control ${item.control} ${item.field}: ${item.value}`), `${game.alias}: ${item.control} ${item.field} is not measured`);
  assert.equal(bound.registered, contracts.length);
  assert.deepEqual(bound.gameScoped.map(item => item.id), catalog.artifactActions ? ['semantic-control-v1', 'device-executor-v1'] : ['semantic-control-v1']);
  assert.ok(isUnknown(bound.others), 'the contract register has no game dimension, and says so');
  assert.deepEqual(gaps.map(gap => [gap.gap, gap.holds === false ? 'closed' : 'open']).slice(0, 3), [[1, 'open'], [2, 'closed'], [3, 'closed']],
    'Plan 28 gap 1 still holds (partly); gap 2 is closed by truth, gap 3 by describe itself');
  assert.equal(gaps[1].localDump, false);
  assert.deepEqual(gaps[1].notMeasured, [NO_LOCAL_DUMP], 'with no local dump the surface is there, and what it cannot read is said');
  assert.ok(described.notMeasured.includes(NO_LOCAL_DUMP));
  if (game.alias === 'fnaf2') {
    assert.equal(story.entries, chronicle.entries.length);
    assert.equal(story.newest, chronicle.entries.map(entry => entry.date).sort().at(-1));
    assert.equal(described.claim.refuted.length, chronicle.entries.filter(isNegative).length);
    assert.equal(phone.promotedRuns, graphEdges.length, 'every PROMOTED_BY edge in the graph is a FNaF 2 promotion that re-derives');
    assert.equal(phone.label, 'DEVICE_MEASURED');
    assert.equal(gaps[3].promotionEdges, graphEdges.length);
    assert.equal(gaps[3].holds, 'partly', 'promotion is no longer empty, and custody is not complete for every pack');
    assert.ok(described.notMeasured.some(item => item.startsWith('reliability')), 'a promotion is one clear, and that is said');
  } else {
    assert.ok(isUnknown(story), `the chronicle attributes nothing to ${game.alias}`);
    assert.ok(isUnknown(described.claim.refuted));
  }
  if (game.alias === 'fnaf3' || game.alias === 'fnaf4') assert.ok(isUnknown(phone), `no pack is attributed to ${game.alias}`);
  if (game.alias === 'fnaf1') assert.ok(isUnknown(phone.promotion), 'no Plan 12 gate reads a FNaF 1 run');
}
refusal(solver.describe({ game: 'fnaf5' }), 'invalid-argument', 'an unregistered game');

// --- truth: with no local dump it refuses and names the decode (packages/source/test/truth.test.js reads one) ---
const noDump = refusal(solver.truth({ op: 'events', game: 'fnaf2', query: { global: 1 } }), 'no-local-dump', 'truth events with no dump');
assert.match(noDump.remedy, /npm run review -- truth decode/);
refusal(solver.truth({ op: 'object', game: 'fnaf4', name: 'x' }), 'no-local-dump', 'truth object with no dump');
refusal(solver.truth({ op: 'grep' }), 'invalid-argument', 'a truth op that does not exist');
validateClaimEnvelope(solver.readResource('fnaf://truth/fnaf2/frame/3/group/413'));
assert.equal(solver.readResource('fnaf://truth/fnaf2/frame/3/group/413').rule, 'no-local-dump', 'a cited group with no dump is a refusal');

// --- query ---------------------------------------------------------------------------------
const packs = claim(solver.query({ what: 'packs' }), 'query packs');
assert.equal(packs.claim.matched, packIds.length);
assert.equal(Object.values(packs.claim.byGame).reduce((sum, n) => sum + n, 0), packIds.length);
assert.equal(packs.claim.promoted, graphEdges.length);
assert.equal(claim(solver.query({ what: 'contracts' }), 'query contracts').claim.matched, contracts.length);
assert.equal(claim(solver.query({ what: 'chronicle', negative: true }), 'query chronicle').claim.matched, chronicle.entries.filter(isNegative).length);
const limited = claim(solver.query({ what: 'chronicle', limit: 2 }), 'query chronicle limit');
assert.equal(limited.claim.entries.length, 2);
assert.ok(limited.notMeasured.some(item => item.includes('beyond the limit')));
assert.equal(claim(solver.query({ what: 'chronicle', game: 'fnaf3' }), 'chronicle for FNaF 3').claim.matched, 0);
const promotions = claim(solver.query({ what: 'promotions' }), 'query promotions');
assert.deepEqual(promotions.claim, queryPromotions(ROOT, { winners }), 'query promotions wraps exactly the promotions query');

// --- review --------------------------------------------------------------------------------
const promotedIds = graphEdges.map(edge => edge.to.replace(/^run\./, ''));
for (const instrument of INSTRUMENTS)
  claim(solver.review({ pack: promotedIds[0], instrument }), `review ${instrument}`);
const checks = solver.review({ pack: promotedIds[0], instrument: 'promotion-checks' }).claim.checks;
assert.ok(Object.values(checks).every(Boolean), 'a promoted pack passes every check');
refusal(solver.review({ pack: promotedIds[0], instrument: 'grade' }), 'invalid-argument', 'an instrument that does not exist');
refusal(solver.review({ pack: '../graph.json', instrument: 'custody' }), 'invalid-argument', 'a path outside the packs');

// --- promote: the graph's edge for every promoted pack, a refusal for every other ---------------
const byRun = new Map(graphEdges.map(edge => [edge.to, edge]));
let proposals = 0;
for (const id of packIds) {
  const answer = solver.promote({ pack: id });
  validateClaimEnvelope(answer);
  const recorded = byRun.get(`run.${id}`);
  if (recorded) {
    claim(answer, `promote ${id}`);
    assert.equal(canonicalJson(answer.claim.edge), canonicalJson(recorded), `${id}: the proposal is the recorded edge`);
    assert.equal(answer.claim.inGraph, 'ALREADY_RECORDED');
    proposals += 1;
  } else refusal(answer, 'plan12-promotion', `promote ${id}`);
}
assert.equal(proposals, graphEdges.length);

// --- resources -----------------------------------------------------------------------------
for (const { uri } of solver.listResources()) claim(solver.readResource(uri), uri);
assert.equal(solver.readResource('fnaf://nothing'), null);
const archived = readArchivedRoutes(ROOT);
assert.ok(archived.routes.length >= 4 && archived.routes.every(route => route.route && route.paths && /^\d{4}-\d{2}-\d{2}$/.test(route.lastCommit)),
  'every archived-route row is read with its paths and date');
assert.deepEqual(solver.readResource('fnaf://refuted').claim.archivedRoutes, archived.routes);

// --- the CLI: the same envelopes, exit 1 on a refusal ----------------------------------------
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
const fnaf4 = run('describe', 'fnaf4');
assert.equal(fnaf4.status, 0, fnaf4.stderr);
assert.deepEqual(JSON.parse(fnaf4.stdout), solver.describe({ game: 'fnaf4' }), 'the CLI prints what the verb returns');
const floor = run('check', 'seed-floor', '{"seeds":1200,"wins":1200}');
assert.equal(floor.status, 1, 'a refusal exits 1');
assert.equal(refusal(JSON.parse(floor.stdout), 'seed-floor', 'the CLI check').rule, 'seed-floor');
const passed = run('check', 'seed-floor', '{"seeds":3000,"wins":2990}');
assert.equal(passed.status, 0, passed.stderr);
assert.equal(JSON.parse(passed.stdout).reproducer, "npm run review -- check seed-floor '{\"seeds\":3000,\"wins\":2990}'");
assert.equal(run('query', 'contracts', '--text', 'claim-envelope').status, 0);
assert.equal(run('resource', 'fnaf://game/com.scottgames.fnaf2/controls').status, 0);
assert.equal(run('frobnicate').status, 2, 'a usage error exits 2');
const truthCli = run('truth', 'events', 'fnaf2', '{"global":1}');
assert.equal(truthCli.status, 1, 'truth with no local dump is a refusal');
assert.equal(JSON.parse(truthCli.stdout).rule, 'no-local-dump');
assert.equal(run('truth', 'events', 'fnaf2', 'not json').status, 2, 'a truth query that is not JSON is a usage error');
const wrapped = await envelopeRun;
assert.equal(wrapped.status, 0);
assert.deepEqual(validateClaimEnvelope(JSON.parse(wrapped.stdout)).claim, queryPromotions(ROOT, { winners }),
  'query promotions --envelope wraps exactly the query');

assert.equal(treeHash(join(ROOT, 'docs/evidence')), before, 'no verb wrote under docs/evidence');
console.log(`solver: describe joins the registers for ${GAMES.length} games, every verb and resource answers in claim-envelope-v1, ` +
  `promote proposes the recorded edge for ${proposals} packs and refuses the other ${packIds.length - proposals}, and nothing is written`);
