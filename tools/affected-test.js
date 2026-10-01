#!/usr/bin/env node
/** Select the smallest deterministic validation set for the current diff. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const explicit = process.argv.slice(2).filter(path => path !== '--files');
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const changed = explicit.length ? explicit : [...new Set([
  ...git(['diff', '--name-only']).split('\n'),
  ...git(['diff', '--cached', '--name-only']).split('\n'),
  ...git(['ls-files', '--others', '--exclude-standard']).split('\n'),
].filter(Boolean))];

const checks = new Map();
const add = (id, command, args = []) => checks.set(id, { command, args });
add('architecture', 'node', ['tools/architecture-test.js']);
add('references', 'node', ['tools/validate-references.js']);

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
  for (const test of ['belieftest', 'estimatortest', 'phaseclocktest', 'reactivetest'])
    add(`test:tools/${test}.mjs`, 'node', [`tools/${test}.mjs`]);
if (changed.some(path => path.startsWith('packages/review/src/measure/')))
  add('bench-trace', 'node', ['packages/review/test/bench-trace.test.mjs']);
if (changed.some(path => path.startsWith('apps/trainer/src/training/')))
  for (const test of ['exercise', 'activity-gate'])
    add(`test:apps/trainer/test/${test}.test.mjs`, 'node', [`apps/trainer/test/${test}.test.mjs`]);
if (kernelChanged)
  for (const test of ['kernel', 'venue-identity', 'claim-envelope'])
    add(`test:packages/kernel/test/${test}.test.js`, 'node', [`packages/kernel/test/${test}.test.js`]);
if (kernelChanged || sourceChanged || coreChanged) {
  add('source-contracts', 'node', ['packages/source/test/contracts.test.js']);
  add('control-catalog', 'node', ['packages/source/test/control-catalog.test.js']);
  add('source-mechanics', 'node', ['packages/source/test/sourcetest.mjs']);
}
if (sourceChanged || coreChanged || proposeChanged || playModelChanged) {
  // The closed loop is the device work's spine (ROADMAP Track A); its gates
  // belong in the same lane as the code they gate, not the legacy campaign.
  // Keyed by path so an edit to the gate itself (below) dedupes against this.
  for (const gate of ['cycle-library', 'cycle-planner', 'cycle-controller',
    'night-policy'])
    add(`test:packages/propose/test/${gate}.test.js`, 'node', [`packages/propose/test/${gate}.test.js`]);
  // Offline replay determinism: the same recorded facts must rebuild the same
  // decisions, which is what makes a retained stream evidence rather than a log.
  add('fact-replay', 'node', ['packages/propose/bin/factreplay.mjs', '--assert']);
  // The winners compile through the Sim and the catalogs.
  add('winners-rebuild', 'node', ['packages/propose/test/test-winners-rebuild.mjs']);
}
if (changed.some(path => path.startsWith('packages/play/') || path.startsWith('packages/adapters/') ||
    path === 'apps/desktop/src/device-cli.ts')) {
  add('adapter-contracts', 'node', ['packages/play/test/conformance.test.js']);
  add('device-executor', 'node', ['packages/play/test/adb-device-local-executor.test.js']);
  add('device-campaign', 'node', ['packages/play/test/campaign.test.js']);
  add('device-cli', 'node', ['apps/desktop/test/device-cli.test.js']);
  add('winners-rebuild', 'node', ['packages/propose/test/test-winners-rebuild.mjs']);
}
if (changed.some(path => path.startsWith('packages/propose/src/policy/') || path.startsWith('packages/core/src/control/') ||
    path.startsWith('packages/source/src/clockwork/') || path.startsWith('tools/device/policy-') ||
    path.startsWith('tools/device/closed-families'))) {
  add('policy-grammar', 'node', ['packages/propose/test/policygrammartest.mjs']);
  add('policy-search', 'node', ['packages/propose/test/policysearchtest.mjs']);
  add('policy-equivalence', 'node', ['packages/propose/test/policyequivalencetest.mjs']);
  add('observation-language', 'node', ['packages/propose/test/observationlanguagetest.mjs']);
}
// FNaF 1, 3 and 4's policies are what each game's census runs.
for (const game of [1, 3, 4])
  if (changed.includes(`packages/propose/src/games/policy-fnaf${game}.js`))
    add(`census-fnaf${game}`, 'node', [`tools/test-fnaf${game}-census.mjs`]);
// Experiments, strategies, seed cohorts, specs and parked Minus 7 (were
// packages/research, now its compatibility shim).
if (changed.some(path => ['packages/propose/src/experiment/', 'packages/propose/src/strategies/', 'packages/propose/parked/',
  'packages/propose/experiments/', 'packages/research/'].some(prefix => path.startsWith(prefix)))) {
  add('research-contracts', 'node', ['packages/propose/test/experiment.test.js']);
  add('research-aliases', 'node', ['packages/propose/test/legacy-equivalence.test.js']);
}
// Review reads the committed evidence (packs, graph, winners, the anchor
// register): a change to it or to what it reads runs its own tests and the
// evidence CLI that composes it (`npm run evidence`). Review imports the
// kernel, so a kernel change runs both. LEG-003's interim mapping for the two
// packages created on 2026-09-29.
if (changed.some(path => path.startsWith('packages/review/') || path.startsWith('packages/kernel/') || path === 'apps/desktop/src/evidence.ts' ||
    path === 'tools/evidence-pack.mjs' || path.startsWith('docs/evidence/runs/') || path === 'docs/evidence/graph.json' ||
    path === 'packages/propose/bindings/fact-register.mjs' || /^packages\/propose\/bindings\/[^/]+\/[^/]+-winner\.json$/.test(path))) {
  for (const test of ['evidence-campaign', 'evidence-pack', 'evidence-cohort', 'evidence-promotion'])
    add(`test:packages/review/test/${test}.test.mjs`, 'node', [`packages/review/test/${test}.test.mjs`]);
  for (const test of ['pack-lift', 'promotions-query'])
    add(`test:packages/review/test/${test}.test.js`, 'node', [`packages/review/test/${test}.test.js`]);
  add('evidence-cli', 'node', ['apps/desktop/test/test-evidence-cli.mjs']);
}
// The composition root: the MCP server and the lab.
if (changed.some(path => path.startsWith('apps/desktop/')))
  for (const test of ['apps/desktop/test/companion-mcp.test.mjs', 'apps/desktop/test/lab.test.mjs'])
    add(`test:${test}`, 'node', [test]);
if (changed.some(path => path.startsWith('apps/trainer/')))
  add('trainer-build', 'python3', ['apps/trainer/test/build.py']);
for (const path of changed.filter(p => /^packages\/[^/]+\/test\/.*\.test\.m?[jt]s$/.test(p)))
  add(`test:${path}`, 'node', [path]);
if (changed.some(path => path.startsWith('docs/') || path.startsWith('plans/')))
  add('documentation', 'node', ['tools/test-docs.mjs']);
if (changed.some(path => path === 'packages/review/src/vault.ts' || path === 'packages/review/test/vault.test.mjs'))
  add('vault', 'node', ['packages/review/test/vault.test.mjs']);
if (changed.some(path => path.startsWith('packages/propose/parked/')))
  add('model-syntax', 'node', ['--check', ...changed.filter(path => /\.(?:js|mjs|ts|mts)$/.test(path) && path.startsWith('packages/propose/parked/'))]);

assert.ok(checks.size > 0);
console.log(`affected: ${changed.length} changed paths -> ${[...checks.keys()].join(', ')}`);
for (const [id, { command, args }] of checks) {
  if (!args.length) continue;
  console.log(`affected: ${id}`);
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' });
}
