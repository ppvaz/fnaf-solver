#!/usr/bin/env node
/**
 * Stdio MCP contract test for the fnaf-solver server: the safe Companion
 * queue as it always answered, and the solver interface's verbs, the `jobs`
 * queue tool, `truth`, the lab's read-only `lab.status`, `lab.next` and
 * `lab.doctor`, and the fnaf:// resources, every one of which answers in
 * claim-envelope-v1 (Plan 28 steps 1-5). It checks that no tool takes a tap, a
 * coordinate, a shell command or a rebuild; that a refused promote is a
 * refusal envelope; that truth reads only a local dump (here a synthetic one)
 * and refuses where none is configured; and that nothing the verbs do writes
 * the evidence graph or a run pack.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isList, isRecord, isUnknown, validateClaimEnvelope } from '@sixam/kernel';
import { CACHE_ENV, NO_LOCAL_DUMP, VAULT_ENV } from '@sixam/source/truth';
import { syntheticDump } from '../../../packages/source/test/fixtures/truth-dump.ts';

const root = resolve(import.meta.dirname, '../../..');
const temp = await mkdtemp(join(tmpdir(), 'fnaf-solver-mcp-'));
// truth reads a local dump named by the local vault: here a synthetic FNaF 2 one, and none for any other game.
writeFileSync(join(temp, 'events.txt'), syntheticDump());
writeFileSync(join(temp, 'vault.json'), JSON.stringify({ schema: 'truth-local-vault-v1',
  games: { 'com.scottgames.fnaf2': { dump: join(temp, 'events.txt') } } }));
const { CTFAK_SRC, DOTNET, DOTNET_ROOT, ...inherited } = process.env;
const child = spawn(process.execPath, [join(root, 'apps/desktop/src/companion-mcp.ts')], {
  cwd: root,
  env: { ...inherited, CUE_HELPER_QUEUE_FILE: join(temp, 'jobs.json'), ANDROID_SERIAL: 'missing-device',
    [VAULT_ENV]: join(temp, 'vault.json'), [CACHE_ENV]: join(temp, 'cache'), PATH: process.env.PATH },
  stdio: ['pipe', 'pipe', 'pipe'],
});
/** A JSON-RPC request this test sends. */
interface RpcRequest { readonly jsonrpc: '2.0', readonly id: number, readonly method: string, readonly params?: object }
/** A JSON-RPC reply: its id, and a result object or an error code. */
interface RpcReply { readonly id: unknown, readonly result: Readonly<Record<string, unknown>>, readonly error: { readonly code: number } | null }
/** A tool as tools/list describes it, in the fields this test reads. */
interface Tool { readonly name: string, readonly properties: readonly string[], readonly additionalProperties: unknown, readonly readOnly: unknown }

/** One reply line, checked to be a JSON-RPC reply. */
function parseReply(line: string): RpcReply {
  const value: unknown = JSON.parse(line);
  assert.ok(isRecord(value), `not a JSON-RPC reply: ${line.slice(0, 200)}`);
  if (value.error !== undefined) {
    assert.ok(isRecord(value.error) && typeof value.error.code === 'number', `a reply error has a numeric code: ${line.slice(0, 200)}`);
    return { id: value.id, result: {}, error: { code: value.error.code } };
  }
  assert.ok(isRecord(value.result), `a reply has a result or an error: ${line.slice(0, 200)}`);
  return { id: value.id, result: value.result, error: null };
}
/** A result field that is a list of records. */
function records(reply: RpcReply, key: string) {
  const items = reply.result[key];
  assert.ok(isList(items) && items.every(isRecord), `result.${key} is a list of records`);
  return items;
}
/** A record's text field. */
function text(item: Readonly<Record<string, unknown>>, field: string) {
  const value = item[field];
  assert.ok(typeof value === 'string', `${field} is text`);
  return value;
}
/** The JSON a tool or resource reply carries in its first content item. */
const payload = (reply: RpcReply, key: 'content' | 'contents' = 'content') => JSON.parse(text(records(reply, key)[0], 'text'));
const toolsOf = (reply: RpcReply): Tool[] => records(reply, 'tools').map(tool => {
  const { inputSchema: schema, annotations } = tool;
  assert.ok(isRecord(schema) && isRecord(annotations), `${String(tool.name)} has an input schema and annotations`);
  return { name: text(tool, 'name'), properties: isRecord(schema.properties) ? Object.keys(schema.properties) : [],
    additionalProperties: schema.additionalProperties, readOnly: annotations.readOnlyHint };
});

/** How long one reply may take: the slowest verb (lab.doctor, describe) answers in seconds. */
const REPLY_TIMEOUT_MS = 120_000;
const lines = createInterface({ input: child.stdout });
const next = async (): Promise<RpcReply> => {
  const done = new AbortController();
  const deadline = AbortSignal.timeout(REPLY_TIMEOUT_MS);
  const signal = AbortSignal.any([done.signal, deadline]);
  try {
    const [line] = await Promise.race([
      once(lines, 'line', { signal }),
      once(lines, 'close', { signal }).then(() => assert.fail('the server closed its output before replying')),
    ]);
    return parseReply(line);
  } catch (error) {
    if (deadline.aborted) assert.fail(`no reply within ${REPLY_TIMEOUT_MS} ms`);
    throw error;
  } finally {
    done.abort();
  }
};
const send = (request: RpcRequest) => child.stdin.write(`${JSON.stringify(request)}\n`);
let id = 100;
const call = async (name: string, args: object) => {
  send({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
  const response = await next();
  assert.equal(response.id, id);
  return { isError: response.result.isError, value: payload(response) };
};

// Every reproducer is a command the generated registry knows: `npm run <script>` or a registered tool.
const registry: { commands: { id: string }[], tools: { id: string }[] } =
  JSON.parse(readFileSync(join(root, 'docs/architecture/generated/command-registry.json'), 'utf8'));
const scripts = new Set(registry.commands.map(item => item.id));
const tools = new Set(registry.tools.map(item => item.id));
const envelope = <T extends { readonly refused?: unknown, readonly reproducer: string }>(value: T, what: string) => {
  validateClaimEnvelope(value);
  if (value.refused) return value;
  const [first, second, script] = value.reproducer.split(' ');
  assert.ok(first === 'npm' ? second === 'run' && scripts.has(script) : tools.has(first),
    `${what}: reproducer ${value.reproducer} names no registered command`);
  return value;
};
const refused = (result: Awaited<ReturnType<typeof call>>, rule: string, what: string) => {
  assert.equal(result.isError, true, `${what} is reported as an error`);
  envelope(result.value, what);
  assert.equal(result.value.refused, true, `${what} is refused`);
  if (rule) assert.equal(result.value.rule, rule, `${what} is refused by ${rule}`);
  return result.value;
};
const claimed = (result: Awaited<ReturnType<typeof call>>, what: string) => {
  assert.equal(result.isError, false, `${what}: ${JSON.stringify(result.value).slice(0, 400)}`);
  envelope(result.value, what);
  assert.notEqual(result.value.refused, true, `${what} is a claim`);
  return result.value;
};

// The verbs never write: the evidence graph and every pack hash the same before and after.
const treeHash = (dir: string) => {
  const hash = createHash('sha256');
  const walk = (path: string) => {
    for (const name of readdirSync(path).sort()) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) walk(full);
      else hash.update(`${full}\0`).update(readFileSync(full));
    }
  };
  walk(dir);
  return hash.digest('hex');
};
const evidenceBefore = treeHash(join(root, 'docs/evidence'));

const PROMOTED = 'night1-ladder-n1e-20260927T055611Z';
const HELD_BACK = 'night7-n7-420-minimal-m3-20260914T020543Z';
const DEATH = 'night5-anchor1-20260912T202654Z';

try {
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  const { serverInfo, capabilities } = (await next()).result;
  assert.ok(isRecord(serverInfo) && isRecord(capabilities), 'initialize answers with serverInfo and capabilities');
  assert.equal(serverInfo.name, 'fnaf-solver');
  assert.ok(capabilities.resources, 'the server offers resources');

  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const listed = toolsOf(await next());
  const names = listed.map(tool => tool.name);
  assert.deepEqual(names.slice(0, 4), ['cue.setup', 'cue.queue.enqueue', 'cue.queue.list', 'cue.queue.run'],
    'every existing tool name still answers, first and in order');
  assert.deepEqual(names.slice(4), ['describe', 'query', 'review', 'promote', 'check', 'jobs', 'truth',
    'lab.status', 'lab.next', 'lab.doctor']);
  assert.equal(names.length, 14, 'fourteen tools: the four cue.*, the six solver verbs, jobs and the three lab tools');
  assert.ok(names.length <= 15, 'Plan 28: agents degrade past about fifteen tools');
  for (const name of names) assert.doesNotMatch(name, /shell|exec|tap|coord|hid|touch|rebuild|build|attest/i, `${name} is not an actuator`);
  for (const tool of listed) {
    for (const key of tool.properties) assert.doesNotMatch(key, /^(x|y|coords?|command|shell|argv|script|tap)$/i, `${tool.name}.${key}`);
    assert.equal(tool.additionalProperties, false, `${tool.name} refuses arguments it does not name`);
  }
  for (const name of ['describe', 'query', 'review', 'promote', 'check', 'lab.status', 'lab.next', 'lab.doctor'])
    assert.equal(listed.find(tool => tool.name === name)?.readOnly, true, `${name} is read-only`);
  for (const name of ['start', 'commit', 'end', 'morning'])
    assert.ok(!names.includes(`lab.${name}`), `lab ${name} is not served over MCP: only status, next and doctor are`);

  // --- the Companion queue, unchanged ---------------------------------------------------------
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
    name: 'cue.queue.enqueue', arguments: { kind: 'menu-check' },
  } });
  const queued = await next();
  const queuedValue = payload(queued);
  assert.equal(queuedValue.status, 'QUEUED');

  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: {
    name: 'cue.queue.enqueue', arguments: {
      kind: 'menu-check', idempotencyKey: 'mcp-retry-menu-check',
    },
  } });
  const keyed = payload(await next());
  assert.equal(keyed.status, 'QUEUED');

  send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: {
    name: 'cue.queue.enqueue', arguments: {
      kind: 'menu-check', idempotencyKey: 'mcp-retry-menu-check',
    },
  } });
  const keyedAgain = payload(await next());
  assert.equal(keyedAgain.status, 'EXISTING');
  assert.equal(keyedAgain.job.id, keyed.job.id);

  // A night job: one night of a committed winner, validated and bound by hash.
  send({ jsonrpc: '2.0', id: 51, method: 'tools/call', params: {
    name: 'cue.queue.enqueue', arguments: {
      kind: 'night', game: 'fnaf2', winner: 'packages/propose/bindings/fnaf2/campaign-night7-k3-winner.json', night: 7,
    },
  } });
  const night = payload(await next());
  assert.equal(night.status, 'QUEUED');
  assert.equal(night.job.kind, 'night');
  assert.match(night.job.planSha256, /^[0-9a-f]{64}$/);
  assert.ok(night.job.budgetS > 425, 'the budget spans the emitted plan\'s night');
  for (const [requestId, args, why] of [
    [52, { kind: 'night', game: 'fnaf2', winner: 'packages/propose/bindings/fnaf2/campaign-night7-k3-winner.json', night: 5 }, 'not the winner\'s night'],
    [53, { kind: 'night', game: 'fnaf2', winner: '/etc/passwd', night: 7 }, 'not a winner path'],
    [54, { kind: 'menu-check', winner: 'packages/propose/bindings/fnaf2/campaign-night7-k3-winner.json' }, 'a night field on a check'],
  ] as const) {
    send({ jsonrpc: '2.0', id: requestId, method: 'tools/call', params: { name: 'cue.queue.enqueue', arguments: args } });
    const refusedJob = await next();
    assert.equal(refusedJob.result.isError, true, `a night job with ${why} was queued`);
  }

  send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'cue.queue.list', arguments: {} } });
  const listedJobs = payload(await next());
  assert.equal(listedJobs.jobs.length, 3);
  assert.equal(listedJobs.jobs[0].state, 'PENDING');

  send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: {
    name: 'cue.queue.run', arguments: { waitSeconds: 0 },
  } });
  const held = payload(await next());
  assert.equal(held.status, 'HOLD');
  assert.equal(held.ok, true);

  // --- jobs: the same queue, in claim-envelope-v1, one tool with an op ---------------------------
  const jobQueued = claimed(await call('jobs', { op: 'enqueue', kind: 'night-check' }), 'jobs op enqueue');
  assert.equal(jobQueued.claim.status, 'QUEUED');
  assert.ok(isUnknown(jobQueued.label), 'a queue record carries no evidence label');
  const jobList = claimed(await call('jobs', { op: 'list' }), 'jobs op list');
  assert.equal(jobList.claim.jobs.length, 4, 'jobs op list reads the queue cue.queue.enqueue wrote');
  const jobHeld = claimed(await call('jobs', { op: 'run', waitSeconds: 0 }), 'jobs op run');
  assert.equal(jobHeld.claim.status, 'HOLD');
  refused(await call('jobs', { op: 'enqueue', kind: 'night', game: 'fnaf2', winner: '/etc/passwd', night: 7 }), 'queue', 'a bad night job');
  refused(await call('jobs', { op: 'list', kind: 'setup' }), 'invalid-argument', 'an argument its op does not take');
  refused(await call('jobs', { kind: 'setup' }), 'invalid-argument', 'jobs without an op');
  refused(await call('jobs', { op: 'drain' }), 'invalid-argument', 'an op that does not exist');

  // --- describe ------------------------------------------------------------------------------
  const fnaf2 = claimed(await call('describe', { game: 'fnaf2' }), 'describe fnaf2');
  assert.equal(fnaf2.target, 'com.scottgames.fnaf2');
  assert.ok(isUnknown(fnaf2.label), 'a coverage map carries no single label');
  assert.equal(fnaf2.reproducer, 'npm run review -- describe fnaf2');
  const { phone, chronicle, controls, gaps, refuted: negatives } = fnaf2.claim;
  assert.equal(phone.label, 'DEVICE_MEASURED');
  assert.equal(phone.consistent, true);
  assert.ok(phone.promotedRuns >= 47, `FNaF 2 has ${phone.promotedRuns} promoted runs; 47 by 2026-09-29`);
  assert.ok(phone.executorWins >= phone.promotedRuns);
  assert.ok(chronicle.entries >= 83 && chronicle.byLabel.DEVICE_MEASURED > 0);
  assert.equal(controls.count, 7);
  assert.ok(negatives.length >= 24 && negatives.every((entry: { kind: string, status: string }) => ['refutation', 'retraction', 'negative'].includes(entry.kind) || entry.status !== 'standing'));
  assert.deepEqual(gaps.map((gap: { gap: number }) => gap.gap), [1, 2, 3, 4], 'Plan 28\'s four gaps, each a query');
  assert.equal(gaps[2].holds, false, 'describe exists, so "no coverage map" no longer holds');
  assert.deepEqual([gaps[1].holds, gaps[1].localDump], [false, true], 'truth exists and this game has a local dump');
  assert.equal(gaps[0].registered, true, 'claim-envelope-v1 is registered');
  assert.ok(fnaf2.notMeasured.some((item: string) => item.includes('MODEL_ONLY')) || phone.modelOnlyWinners.files.length === 0);
  assert.ok(!fnaf2.notMeasured.some((item: string) => item.startsWith('Plan 28 gap 2')) && !fnaf2.notMeasured.includes(NO_LOCAL_DUMP));
  const fnaf3 = claimed(await call('describe', { game: 'com.scottgames.fnaf3' }), 'describe fnaf3');
  assert.deepEqual([fnaf3.claim.gaps[1].holds, fnaf3.claim.gaps[1].notMeasured], [false, [NO_LOCAL_DUMP]], 'closed, with no dump for FNaF 3 here');
  assert.ok(fnaf3.notMeasured.includes(NO_LOCAL_DUMP));
  assert.ok(isUnknown(fnaf3.claim.phone), 'no pack is attributed to FNaF 3');
  assert.ok(fnaf3.claim.chronicle.entries >= 1 && fnaf3.claim.chronicle.attribution.includes('chronicle-entries-v2'),
    'chronicle-entries-v2 entries name FNaF 3');
  const fnaf1 = claimed(await call('describe', { game: 'fnaf1' }), 'describe fnaf1');
  assert.ok(!isUnknown(fnaf1.claim.phone.promotion) && fnaf1.claim.phone.promotion.promotedRuns.length >= 1, 'the FNaF 1 4/20 run is promoted');
  refused(await call('describe', { game: 'fnaf9' }), 'invalid-argument', 'an unregistered game');
  refused(await call('describe', { game: 'fnaf2', shell: 'rm -rf /' }), 'invalid-argument', 'an argument the tool does not name');

  // --- query ---------------------------------------------------------------------------------
  const promotions = claimed(await call('query', { what: 'promotions' }), 'query promotions');
  assert.equal(promotions.label, 'DEVICE_MEASURED');
  assert.equal(promotions.claim.consistent, true);
  assert.equal(promotions.claim.edges.matched, promotions.claim.edges.graph);
  const fnaf1Packs = claimed(await call('query', { what: 'packs', game: 'fnaf1' }), 'query packs');
  assert.ok(fnaf1Packs.claim.packs.length >= 1 && fnaf1Packs.claim.packs.every((pack: { game: string }) => pack.game === 'com.scottgames.fivenightsatfreddys'));
  const negative = claimed(await call('query', { what: 'chronicle', negative: true, game: 'fnaf2' }), 'query chronicle');
  assert.equal(negative.claim.entries.length, negatives.length);
  const foxy = claimed(await call('query', { what: 'chronicle', text: 'Foxy' }), 'query chronicle text');
  assert.ok(foxy.claim.entries.every((entry: unknown) => JSON.stringify(entry).toLowerCase().includes('foxy')));
  const contracts = claimed(await call('query', { what: 'contracts', text: 'claim-envelope' }), 'query contracts');
  assert.deepEqual(contracts.claim.contracts.map((item: { id: string }) => item.id), ['claim-envelope-v1']);
  refused(await call('query', { what: 'truth' }), 'invalid-argument', 'a query that does not exist');

  // --- lab.*: the operator's read-only verbs, the functions `npm run lab` calls -------------------
  const labStatus = claimed(await call('lab.status', {}), 'lab.status');
  assert.equal(labStatus.reproducer, 'npm run lab -- status');
  assert.deepEqual(labStatus.claim.steps.map((row: { id: string }) => row.id), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'], 'every ROADMAP step has a row');
  for (const row of labStatus.claim.steps)
    assert.ok(['open', 'closed'].includes(row.state) || isUnknown(row.state), `${row.id} is open, closed or UNKNOWN(reason)`);
  const s1 = labStatus.claim.steps[0];
  assert.equal(s1.state, promotions.claim.open.modelOnlyWinners.count === 0 && promotions.claim.edges.matched > 0 ? 'closed' : 'open',
    'S1 is computed from the promotions query');
  assert.equal(labStatus.claim.promotions.edges, promotions.claim.edges.matched, 'lab.status carries the promotions query');
  assert.ok(labStatus.claim.phone.queue.jobs >= 4, 'lab.status reads the queue the jobs above were written to');
  assert.equal(typeof labStatus.claim.doctor.findings, 'number');
  const labNext = claimed(await call('lab.next', {}), 'lab.next');
  assert.deepEqual(labNext.claim.actions.map((item: { rank: number }) => item.rank), labNext.claim.actions.map((_: unknown, index: number) => index + 1), 'actions are ranked');
  if (s1.state === 'open') assert.ok(labNext.claim.actions.some((item: { step: string | null }) => item.step === 'S1'), 'an open S1 is ranked');
  assert.ok(labNext.claim.blocked.some((row: { step: string }) => row.step === 'S3'), 'S3 waits on S2');
  const labDoctor = claimed(await call('lab.doctor', {}), 'lab.doctor');
  assert.deepEqual(labDoctor.claim.checks.map((item: { id: string }) => item.id), ['hooks-path', 'stale-pending', 'push-gate-worktrees', 'agent-worktrees',
    'node-modules', 'local-profile', 'catalog-drift', 'memory', 'untracked-winner']);
  assert.ok(isUnknown(labDoctor.claim.checks.find((item: { id: string }) => item.id === 'catalog-drift').ok), 'the MCP doctor builds no worktree');
  refused(await call('lab.status', { verbose: true }), 'invalid-argument', 'an argument lab.status does not name');

  // --- review --------------------------------------------------------------------------------
  const custody = claimed(await call('review', { pack: HELD_BACK, instrument: 'custody' }), 'review custody');
  assert.equal(custody.claim.custody.kind, 'recovered-from-run-log');
  assert.ok(custody.notMeasured.some((item: string) => item.startsWith('request.json')), 'what custody lost is named');
  const outcome = claimed(await call('review', { pack: HELD_BACK, instrument: 'outcome' }), 'review outcome');
  assert.equal(outcome.claim.reported[0].reportedOutcome.kind, 'SixAM');
  const checks = claimed(await call('review', { pack: HELD_BACK, instrument: 'promotion-checks' }), 'review promotion-checks');
  assert.equal(checks.claim.checks.plan12Attestation, false);
  const deathTime = refused(await call('review', { pack: DEATH, instrument: 'death-time' }), 'unknown-as-number', 'a death time the pack does not hold');
  assert.match(deathTime.because, /Death\.at/);
  refused(await call('review', { pack: '../../etc', instrument: 'custody' }), 'invalid-argument', 'a path that is not a pack');

  // --- promote: a proposal or a refusal, never a write -----------------------------------------
  const heldBack = refused(await call('promote', { pack: HELD_BACK }), 'plan12-promotion', 'the held-back Night 7 win');
  assert.match(heldBack.because, /winnerCommitted/);
  assert.match(heldBack.because, /plan12Attestation/);
  const proposal = claimed(await call('promote', { pack: PROMOTED }), 'promote a promoted pack');
  assert.equal(proposal.claim.proposal, 'PROMOTED_BY');
  assert.equal(proposal.claim.inGraph, 'ALREADY_RECORDED');
  assert.equal(proposal.label, 'DEVICE_MEASURED');
  // A FNaF 1 runner pack is read by Plan 12's checks too (packages/review/src/fnaf1-promotion.ts): its 4/20 night is promoted.
  const fnaf1Proposal = claimed(await call('promote', { pack: 'fnaf1-custom-grid420-420-a-20260925T024452598Z' }), 'promote the FNaF 1 4/20 night');
  assert.equal(fnaf1Proposal.claim.inGraph, 'ALREADY_RECORDED');
  assert.equal(fnaf1Proposal.claim.edge.from, 'claim.fnaf1.custom-night.20-20-20-20.device-6am');

  // --- truth: the caller's own local dump, never the repository's --------------------------------
  const events = claimed(await call('truth', { op: 'events', game: 'fnaf2', query: { object: 'lamp', value: 2 } }), 'truth events');
  assert.equal(events.label, 'SOURCED');
  assert.deepEqual(events.claim.matches.map((match: { frame: number | null, group: string }) => `${match.frame}/${match.group}`), ['1/g0', '1/g1']);
  assert.deepEqual(events.cite.slice(0, 2), ['fnaf://truth/fnaf2/frame/1/group/0', 'fnaf://truth/fnaf2/frame/1/group/1']);
  assert.ok(events.claim.matches.every((match: { conditions: { num: unknown, params: unknown }[] }) => match.conditions.every(row => typeof row.num === 'number' && Array.isArray(row.params))),
    'conditions and actions come back as parsed fields');
  const object = claimed(await call('truth', { op: 'object', game: 'fnaf2', name: 'crate' }), 'truth object');
  assert.deepEqual([object.claim.objects[0].createdBy[0].group, object.claim.objects[0].destroyedBy[0].group], ['g2', 'g3']);
  const noDump = refused(await call('truth', { op: 'events', game: 'fnaf3', query: { global: 1 } }), 'no-local-dump', 'a game with no local dump');
  assert.match(noDump.remedy, /truth decode/);
  refused(await call('truth', { op: 'decode', game: 'fnaf2', path: join(temp, 'missing.apk') }), 'invalid-argument', 'decode of a file not on this host');
  refused(await call('truth', { op: 'decode', game: 'fnaf2', path: join(root, 'package.json') }), 'game-content-in-repository', 'decode inside the repository');
  refused(await call('truth', { op: 'events', game: 'fnaf2', path: '/tmp/x' }), 'invalid-argument', 'an argument its op does not take');
  refused(await call('truth', { op: 'pull', game: 'fnaf2' }), 'invalid-argument', 'an op that does not exist');

  // --- check: the four refusals --------------------------------------------------------------
  refused(await call('check', { rule: 'seed-floor', seeds: 1200, wins: 1199 }), 'seed-floor', 'a rate over 1200 seeds');
  claimed(await call('check', { rule: 'seed-floor', seeds: 3000, wins: 2990, heldOut: { start: 3000, seeds: 3000 } }), 'a rate over 3000 seeds');
  refused(await call('check', { rule: 'directional-reuse', constant: 'SEAM_BANDS', use: { first: 'monitor', then: 'mask' } }),
    'directional-reuse', 'SEAM_BANDS in reverse');
  claimed(await call('check', { rule: 'directional-reuse', constant: 'SEAM_BANDS', use: { first: 'mask', then: 'monitor' } }), 'SEAM_BANDS as measured');
  refused(await call('check', { rule: 'capabilities-first', instrument: 'packages/review/bin/grade/inputtrace.ts' }), 'capabilities-first',
    'an instrument before capabilities');
  refused(await call('check', { rule: 'unknown-as-number', operands: { gap: 400, floor: { kind: 'UNKNOWN', reason: 'not traced' } } }),
    'unknown-as-number', 'UNKNOWN in arithmetic');
  claimed(await call('check', { rule: 'unknown-as-number', operands: { gap: 400, floor: 383 } }), 'two numbers');

  // --- resources -----------------------------------------------------------------------------
  send({ jsonrpc: '2.0', id: 8, method: 'resources/list' });
  const resources = records(await next(), 'resources').map(item => text(item, 'uri'));
  for (const uri of ['fnaf://chronicle', 'fnaf://evidence/graph', 'fnaf://contracts', 'fnaf://refuted',
    'fnaf://game/com.scottgames.fnaf2/controls']) assert.ok(resources.includes(uri), `${uri} is listed`);
  send({ jsonrpc: '2.0', id: 9, method: 'resources/templates/list' });
  assert.deepEqual(records(await next(), 'resourceTemplates').map(item => text(item, 'uriTemplate')),
    ['fnaf://game/{pkg}/controls', 'fnaf://truth/{game}/frame/{frame}/group/{group}']);
  send({ jsonrpc: '2.0', id: 12, method: 'resources/read', params: { uri: 'fnaf://truth/fnaf2/frame/1/group/2' } });
  const citedGroup = envelope(payload(await next(), 'contents'), 'a cited truth group');
  assert.deepEqual(citedGroup.claim.matches.map((match: { group: string }) => match.group), ['g2'], 'a truth citation reads back as its group');
  for (const [index, uri] of resources.entries()) {
    send({ jsonrpc: '2.0', id: 1000 + index, method: 'resources/read', params: { uri } });
    const read = await next();
    assert.equal(text(records(read, 'contents')[0], 'uri'), uri);
    const value = envelope(payload(read, 'contents'), uri);
    assert.notEqual(value.refused, true, `${uri} answers with a claim`);
  }
  send({ jsonrpc: '2.0', id: 10, method: 'resources/read', params: { uri: 'fnaf://refuted' } });
  const refutedResource = payload(await next(), 'contents');
  assert.ok(refutedResource.claim.chronicle.length >= 24 && refutedResource.claim.archivedRoutes.length >= 1);
  assert.ok(refutedResource.claim.archivedRoutes.every((route: { status: string }) => ['parked', 'refuted'].includes(route.status)));
  send({ jsonrpc: '2.0', id: 11, method: 'resources/read', params: { uri: 'fnaf://truth/fnaf2/group/1' } });
  assert.equal((await next()).error?.code, -32002, 'an unknown resource is not found');

  assert.equal(treeHash(join(root, 'docs/evidence')), evidenceBefore, 'no verb wrote under docs/evidence');
} finally {
  child.kill('SIGTERM');
  await once(child, 'close').catch(() => {});
  lines.close();
  await rm(temp, { recursive: true, force: true });
}

console.log('fnaf-solver stdio MCP: 14 tools; the Companion queue unchanged, jobs, lab.* and every verb and resource in claim-envelope-v1, ' +
  'truth over a synthetic local dump and refused without one, a refused promote, the four refusals, and no write under docs/evidence');
