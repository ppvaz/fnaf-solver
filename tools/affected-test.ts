#!/usr/bin/env node
/** Select the smallest deterministic validation set for the current diff. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// --self-check (in `npm run test:unit`): one probe path per branch below, so
// every check is selected and every script it would run must exist; nothing runs.
const SELF_CHECK = process.argv.includes('--self-check');
const PROBES = ['packages/kernel/probe.ts', 'packages/source/probe.ts', 'packages/play/src/venues/sim/probe.ts',
  'packages/review/src/measure/probe.ts', 'apps/trainer/src/training/probe.ts', 'packages/propose/src/policy/probe.ts',
  ...[1, 3, 4].map(game => `packages/propose/src/games/policy-fnaf${game}.ts`), 'packages/propose/src/experiment/probe.ts',
  'apps/desktop/probe.ts', 'docs/probe.md', 'packages/review/src/vault.ts'];
const explicit = process.argv.slice(2).filter(path => path !== '--files' && path !== '--self-check');
const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const changed = SELF_CHECK ? PROBES : explicit.length ? explicit : [...new Set([
  ...git(['diff', '--name-only']).split('\n'),
  ...git(['diff', '--cached', '--name-only']).split('\n'),
  ...git(['ls-files', '--others', '--exclude-standard']).split('\n'),
].filter(Boolean))];

const checks = new Map<string, { command: string, args: string[] }>();
const add = (id: string, command: string, args: string[] = []) => checks.set(id, { command, args });
add('architecture', 'node', ['tools/architecture-test.ts']);
add('references', 'node', ['tools/validate-references.ts']);

// ADR 0002 migrations D1/D4/M8: the contracts, the register and Time live in
// the kernel, each game's Rulebook, Sim and controls in source, the policy
// language and the cycle machinery over them in propose; core keeps only
// registered shims (the Play move took its last modules). A change
// to the kernel, source or core runs the contract and Sim lanes that read them;
// propose's own gates run when propose, or what it imports, changes.
const kernelChanged = changed.some(path => path.startsWith('packages/kernel/'));
const sourceChanged = changed.some(path => path.startsWith('packages/source/'));
const coreChanged = changed.some(path => path.startsWith('packages/core/'));
const proposeChanged = changed.some(path => path.startsWith('packages/propose/'));
// Play's host-free modules (were core's): the Sim observer, the estimator and
// the phase clock, which propose's controllers read; their own gates run too.
const playModelChanged = changed.some(path => ['packages/play/src/venues/sim/', 'packages/play/src/player/',
  'packages/play/src/clocks/'].some(prefix => path.startsWith(prefix)));
if (playModelChanged)
  for (const test of ['packages/play/test/belief.test.ts', 'packages/play/test/estimator.test.ts',
    'packages/play/test/phase-clock.test.ts', 'packages/propose/test/reactivetest.ts'])
    add(`test:${test}`, 'node', [test]);
if (changed.some(path => path.startsWith('packages/review/src/measure/')))
  add('bench-trace', 'node', ['packages/review/test/bench-trace.test.ts']);
if (changed.some(path => path.startsWith('apps/trainer/src/training/')))
  for (const test of ['exercise', 'activity-gate'])
    add(`test:apps/trainer/test/${test}.test.ts`, 'node', [`apps/trainer/test/${test}.test.ts`]);
if (kernelChanged)
  for (const test of ['kernel', 'venue-identity', 'claim-envelope'])
    add(`test:packages/kernel/test/${test}.test.ts`, 'node', [`packages/kernel/test/${test}.test.ts`]);
if (kernelChanged || sourceChanged || coreChanged) {
  add('source-contracts', 'node', ['packages/source/test/contracts.test.ts']);
  add('control-catalog', 'node', ['packages/source/test/control-catalog.test.ts']);
  add('source-mechanics', 'node', ['packages/source/test/sourcetest.ts']);
}
if (sourceChanged || coreChanged || proposeChanged || playModelChanged) {
  // The closed loop is the device work's spine (ROADMAP Track A); its gates
  // belong in the same lane as the code they gate, not the legacy campaign.
  // Keyed by path so an edit to the gate itself (below) dedupes against this.
  for (const gate of ['cycle-library', 'cycle-planner', 'cycle-controller',
    'night-policy'])
    add(`test:packages/propose/test/${gate}.test.ts`, 'node', [`packages/propose/test/${gate}.test.ts`]);
  // Offline replay determinism: the same recorded facts must rebuild the same
  // decisions, which is what makes a retained stream evidence rather than a log.
  add('fact-replay', 'node', ['packages/propose/bin/factreplay.ts', '--assert']);
  // The winners compile through the Sim and the catalogs.
  add('winners-rebuild', 'node', ['packages/propose/test/test-winners-rebuild.ts']);
}
if (changed.some(path => path.startsWith('packages/play/') || path.startsWith('packages/adapters/') ||
    path === 'apps/desktop/src/device-cli.ts')) {
  add('adapter-contracts', 'node', ['packages/play/test/conformance.test.ts']);
  add('device-executor', 'node', ['packages/play/test/adb-device-local-executor.test.ts']);
  add('device-campaign', 'node', ['packages/play/test/campaign.test.ts']);
  add('device-cli', 'node', ['apps/desktop/test/device-cli.test.ts']);
  add('winners-rebuild', 'node', ['packages/propose/test/test-winners-rebuild.ts']);
}
if (changed.some(path => path.startsWith('packages/propose/src/policy/') || path.startsWith('packages/core/src/control/') ||
    path.startsWith('packages/source/src/clockwork/') || path.startsWith('packages/propose/bin/policy/') ||
    path === 'packages/propose/bindings/closed-families.json')) {
  add('policy-grammar', 'node', ['packages/propose/test/policygrammartest.ts']);
  add('policy-search', 'node', ['packages/propose/test/policysearchtest.ts']);
  add('policy-equivalence', 'node', ['packages/propose/test/policyequivalencetest.ts']);
  add('observation-language', 'node', ['packages/propose/test/observationlanguagetest.ts']);
}
// FNaF 1, 3 and 4's policies are what each game's census runs.
for (const game of [1, 3, 4])
  if (changed.includes(`packages/propose/src/games/policy-fnaf${game}.ts`))
    add(`census-fnaf${game}`, 'node', [`packages/propose/bin/census/test-fnaf${game}-census.ts`]);
// Experiments, strategies, seed cohorts, specs and parked Minus 7 (were
// packages/research, now its compatibility shim).
if (changed.some(path => ['packages/propose/src/experiment/', 'packages/propose/src/strategies/', 'packages/propose/parked/',
  'packages/propose/experiments/', 'packages/research/'].some(prefix => path.startsWith(prefix)))) {
  add('research-contracts', 'node', ['packages/propose/test/experiment.test.ts']);
  add('research-aliases', 'node', ['packages/propose/test/legacy-equivalence.test.ts']);
}
// Review reads the committed evidence (packs, graph, winners, the anchor
// register): a change to it or to what it reads runs its own tests and the
// evidence CLI that composes it (`npm run evidence`). Review imports the
// kernel, so a kernel change runs both. LEG-003's interim mapping for the two
// packages created on 2026-09-29.
if (changed.some(path => path.startsWith('packages/review/') || path.startsWith('packages/kernel/') || path === 'apps/desktop/src/evidence.ts' ||
    path.startsWith('docs/evidence/runs/') || path === 'docs/evidence/graph.json' ||
    path === 'packages/propose/bindings/fact-register.ts' || /^packages\/propose\/bindings\/[^/]+\/[^/]+-winner\.json$/.test(path))) {
  for (const test of ['evidence-campaign', 'evidence-pack', 'evidence-cohort', 'evidence-promotion', 'pack-lift', 'promotions-query'])
    add(`test:packages/review/test/${test}.test.ts`, 'node', [`packages/review/test/${test}.test.ts`]);
  add('evidence-cli', 'node', ['apps/desktop/test/test-evidence-cli.ts']);
}
// The composition root: the MCP server and the lab.
if (changed.some(path => path.startsWith('apps/desktop/')))
  for (const test of ['apps/desktop/test/companion-mcp.test.ts', 'apps/desktop/test/lab.test.ts'])
    add(`test:${test}`, 'node', [test]);
if (changed.some(path => path.startsWith('apps/trainer/')))
  add('trainer-build', 'python3', ['apps/trainer/test/build.py']);
for (const path of changed.filter(p => /^packages\/[^/]+\/test\/.*\.test\.m?[jt]s$/.test(p)))
  add(`test:${path}`, 'node', [path]);
if (changed.some(path => path.startsWith('docs/') || path.startsWith('plans/')))
  add('documentation', 'node', ['tools/test-docs.ts']);
if (changed.some(path => path === 'packages/review/src/vault.ts' || path === 'packages/review/test/vault.test.ts'))
  add('vault', 'node', ['packages/review/test/vault.test.ts']);
if (changed.some(path => path.startsWith('packages/propose/parked/')))
  add('model-syntax', 'node', ['--check', ...changed.filter(path => /\.(?:js|mjs|ts|mts)$/.test(path) && path.startsWith('packages/propose/parked/'))]);

assert.ok(checks.size > 0);
// A moved script would otherwise fail only when its branch first fires.
const missing = [...checks.values()].map(({ args }) => args.find(a => !a.startsWith('-'))).filter(a => a && !existsSync(resolve(ROOT, a)));
assert.deepEqual(missing, [], `affected: selected scripts that do not exist: ${missing.join(', ')}`);
if (SELF_CHECK) {
  console.log(`affected: self-check, ${checks.size} checks selected over ${PROBES.length} probes, every script exists`);
  process.exit(0);
}
console.log(`affected: ${changed.length} changed paths -> ${[...checks.keys()].join(', ')}`);
for (const [id, { command, args }] of checks) {
  if (!args.length) continue;
  console.log(`affected: ${id}`);
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' });
}
