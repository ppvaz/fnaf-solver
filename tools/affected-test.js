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

// ADR 0002 migration D1/D4: the contracts, the register and Time live in the
// kernel, each game's Rulebook, Sim and controls in source, and core keeps the
// policy language and the cycle machinery over them. A change to any of the
// three runs the contract and Sim lanes that read them; core's own gates run
// when core, or what it imports, changes.
const kernelChanged = changed.some(path => path.startsWith('packages/kernel/'));
const sourceChanged = changed.some(path => path.startsWith('packages/source/'));
const coreChanged = changed.some(path => path.startsWith('packages/core/'));
if (kernelChanged)
  for (const test of ['kernel', 'venue-identity', 'claim-envelope'])
    add(`test:packages/kernel/test/${test}.test.js`, 'node', [`packages/kernel/test/${test}.test.js`]);
if (kernelChanged || sourceChanged || coreChanged) {
  add('source-contracts', 'node', ['packages/source/test/contracts.test.js']);
  add('control-catalog', 'node', ['packages/source/test/control-catalog.test.js']);
  add('source-mechanics', 'node', ['tools/sourcetest.mjs']);
}
if (sourceChanged || coreChanged) {
  // The closed loop is the device work's spine (ROADMAP Track A); its gates
  // belong in the same lane as the code they gate, not the legacy campaign.
  // Keyed by path so an edit to the gate itself (below) dedupes against this.
  for (const gate of ['cycle-library', 'cycle-planner', 'cycle-controller',
    'night-policy'])
    add(`test:packages/core/test/${gate}.test.js`, 'node', [`packages/core/test/${gate}.test.js`]);
  // Offline replay determinism: the same recorded facts must rebuild the same
  // decisions, which is what makes a retained stream evidence rather than a log.
  add('fact-replay', 'node', ['tools/factreplay.mjs', '--assert']);
  // The winners compile through the Sim and the catalogs.
  add('winners-rebuild', 'node', ['tools/device/test-winners-rebuild.mjs']);
}
if (changed.some(path => path.startsWith('packages/adapters/') || path.startsWith('apps/device/'))) {
  add('adapter-contracts', 'node', ['packages/adapters/test/conformance.test.js']);
  add('device-executor', 'node', ['apps/device/test/adb-device-local-executor.test.js']);
  add('device-campaign', 'node', ['apps/device/test/campaign.test.js']);
  add('device-cli', 'node', ['apps/device/test/cli.test.js']);
  add('winners-rebuild', 'node', ['tools/device/test-winners-rebuild.mjs']);
}
if (changed.some(path => path.startsWith('packages/core/src/control/') || path.startsWith('packages/source/src/clockwork/') ||
    path.startsWith('tools/device/policy-') || path.startsWith('tools/device/closed-families'))) {
  add('policy-grammar', 'node', ['tools/policygrammartest.mjs']);
  add('policy-search', 'node', ['tools/policysearchtest.mjs']);
  add('policy-equivalence', 'node', ['tools/policyequivalencetest.mjs']);
  add('observation-language', 'node', ['tools/observationlanguagetest.mjs']);
}
if (changed.some(path => path.startsWith('packages/research/')))
  add('research-contracts', 'node', ['packages/research/test/experiment.test.js']);
// Review reads the committed evidence (packs, graph, winners, the anchor
// register): a change to it or to what it reads runs its own tests and the
// evidence CLI that composes it (`npm run evidence`). Review imports the
// kernel, so a kernel change runs both. LEG-003's interim mapping for the two
// packages created on 2026-09-29.
if (changed.some(path => path.startsWith('packages/review/') || path.startsWith('packages/kernel/') || path === 'tools/evidence.js' ||
    path === 'tools/evidence-pack.mjs' || path.startsWith('docs/evidence/runs/') || path === 'docs/evidence/graph.json' ||
    path === 'tools/device/fact-register.mjs' || /^tools\/device\/[^/]+-winner\.json$/.test(path))) {
  for (const test of ['evidence-campaign', 'evidence-pack', 'evidence-cohort', 'evidence-promotion'])
    add(`test:packages/review/test/${test}.test.mjs`, 'node', [`packages/review/test/${test}.test.mjs`]);
  for (const test of ['pack-lift', 'promotions-query'])
    add(`test:packages/review/test/${test}.test.js`, 'node', [`packages/review/test/${test}.test.js`]);
  add('evidence-cli', 'node', ['tools/test-evidence-cli.mjs']);
}
if (changed.some(path => path.startsWith('apps/trainer/')))
  add('trainer-build', 'python3', ['tools/build.py']);
for (const path of changed.filter(p => /^packages\/[^/]+\/test\/.*\.test\.m?js$/.test(p)))
  add(`test:${path}`, 'node', [path]);
if (changed.some(path => path.startsWith('docs/') || path.startsWith('plans/')))
  add('documentation', 'node', ['tools/test-docs.mjs']);
if (changed.some(path => path === 'tools/vault.mjs' || path === 'tools/vaulttest.mjs'))
  add('vault', 'node', ['tools/vaulttest.mjs']);
if (changed.some(path => path.startsWith('tools/model/') || path.startsWith('tools/minus7/')))
  add('model-syntax', 'node', ['--check', ...changed.filter(path => /\.(?:js|mjs)$/.test(path) && (path.startsWith('tools/model/') || path.startsWith('tools/minus7/')))]);

assert.ok(checks.size > 0);
console.log(`affected: ${changed.length} changed paths -> ${[...checks.keys()].join(', ')}`);
for (const [id, { command, args }] of checks) {
  if (!args.length) continue;
  console.log(`affected: ${id}`);
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' });
}
