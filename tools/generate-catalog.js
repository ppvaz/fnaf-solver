#!/usr/bin/env node
/** Generate checked-in inventories from executable repository truth. */
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const OUT = join(ROOT, 'docs/architecture/generated');

// The inventories describe the REPOSITORY, not whatever the working directory
// happens to hold. A directory walk cannot tell the two apart: on 2026-09-02 an
// agent worktree under `.claude/` was walked into `import-graph`,
// `reverse-links` and `test-manifest`, doubling their file counts (Shell 63 ->
// 126, JavaScript 240 -> 491). git already draws that line --
// a nested checkout comes back as a single opaque directory entry, and its
// ignore rules cover the build output the old SKIP list missed
// (`android/companion/build/`) -- so git's enumeration is the boundary.
// `--others` keeps a newly added, not-yet-committed file in the catalog, which
// is what lets a tool and its catalog row land in one commit.
const files = execFileSync('git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean)
  .filter(path => !path.endsWith('/'))
  .map(path => join(ROOT, path)).sort();
const sourceFiles = files.filter(path => /\.(?:js|mjs|ts|py|sh|c|S)$/.test(path));
const importGraph = [];
for (const path of sourceFiles.filter(path => /\.(?:js|mjs|ts)$/.test(path))) {
  const source = await readFile(path, 'utf8');
  const imports = [...source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)].map(match => match[2]);
  if (imports.length) importGraph.push({ file: relative(ROOT, path), imports: [...new Set(imports)].sort() });
}

const rootPackage = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const commandRegistry = Object.entries(rootPackage.scripts).map(([id, command]) => ({
  id, command,
  lifecycle: id.includes('legacy') ? 'legacy'
    : id.includes('qualification') ? 'supported-live' : 'supported',
}));
const toolIndexes = ['tools/README.md', 'tools/cue/README.md', 'tools/device/README.md', 'tools/dump/README.md'];
const toolsIndex = (await Promise.all(toolIndexes.map(path => readFile(join(ROOT, path), 'utf8')))).join('\n');
const toolCommands = [...toolsIndex.matchAll(/^\| `([^`]+)` \| ([^|]+) \|/gm)].map(match => ({
  id: match[1].split(/\s+/)[0], invocation: match[1], kind: match[2].trim(), lifecycle: /legacy|historical/i.test(match[2]) ? 'legacy' : 'supported',
}));
const contractRegister = JSON.parse(await readFile(join(ROOT, 'packages/core/contracts/register.json'), 'utf8'));
const protocols = contractRegister.contracts.filter(item => ['wire', 'process'].includes(item.kind));
const contractEvidence = {
  'plant-model-v1': ['tools/sourcetest.mjs', 'tools/simtest.mjs'],
  'semantic-control-v1': ['packages/core/test/contracts.test.js', 'tools/device/test-policy-interpreter.mjs'],
  'policy-program-v1': ['tools/policygrammartest.mjs', 'tools/device/test-policy-ir.mjs'],
  'controller-v1': ['tools/reactivetest.mjs', 'packages/core/test/cycle-controller.test.js'],
  'qualification-v1': ['packages/core/test/contracts.test.js', 'packages/core/test/venue-identity.test.js'],
  'qualification-v2': ['packages/core/test/venue-identity.test.js', 'apps/device/test/venue-preflight.test.js'],
  'venue-identity-v1': ['packages/core/test/venue-identity.test.js', 'packages/adapters/test/android-venue.test.js'],
  'venue-check-v1': ['packages/core/test/venue-identity.test.js', 'apps/device/test/venue-preflight.test.js'],
  'venue-binding-v1': ['packages/core/test/venue-identity.test.js', 'apps/device/test/venue-preflight.test.js'],
  'state-estimate-v1': ['tools/estimatortest.mjs'],
  'clock-v1': ['tools/phaseclocktest.mjs'],
  'device-profile-v1': ['tools/device/test-bundle.mjs'],
  'telemetry-event-v1': ['tools/factlinktest.mjs'],
  'session-manifest-v1': ['tools/device/test-session-manifest.sh'],
  'experiment-spec-v1': ['packages/research/test/experiment.test.js'],
  'experiment-result-v1': ['packages/research/test/experiment.test.js'],
  'winner-v1': ['tools/device/test-bundle.mjs'],
  'device-bundle-v1': ['tools/device/test-bundle.mjs'],
  'device-artifact-v1': ['tools/device/test-bundle.mjs'],
  'trainer-trace-v1': ['tools/tracereport.mjs'],
  'artifact-ref-v1': ['tools/evidence.js'],
  'claim-evidence-v1': ['tools/evidence.js'],
  'companion-status-v1': ['packages/adapters/test/companion-status.test.js', 'android/companion/test/com/ppvaz/fnafcompanion/CompanionStatusTest.java'],
  'cue-helper-control-v1': ['tools/cue/test-cue.py'],
  'fact-message-v1': ['packages/core/test/fixtures/fact-message-v1.jsonl'],
  'hid-executor-v1': ['packages/adapters/test/conformance.test.js', 'apps/device/test/adb-device-local-executor.test.js'],
  'device-executor-v1': ['apps/device/test/adb-device-local-executor.test.js'],
  'device-campaign-v1': ['apps/device/test/campaign.test.js', 'apps/device/test/campaign-runner.test.js'],
  'device-adb-preflight-v1': ['apps/device/test/adb-bridge.test.js'],
  'device-campaign-result-v1': ['apps/device/test/campaign.test.js', 'apps/device/test/campaign-runner.test.js'],
  'campaign-proof-v1': ['apps/device/test/campaign-runner.test.js'],
  'custom-night-config-v1': ['apps/device/test/campaign.test.js', 'apps/device/test/campaign-infrastructure.test.js'],
  'custom-night-calibration-v1': ['apps/device/test/campaign-infrastructure.test.js'],
  'device-campaign-preflight-v1': ['apps/device/test/campaign-infrastructure.test.js'],
  'bench-transport-trace-v1': ['tools/benchtracetest.mjs'],
  'exercise-v1': ['tools/exercisetest.mjs'],
  'commitment-v1': ['tools/exercisetest.mjs'],
  'resolution-v1': ['tools/exercisetest.mjs'],
  'exercise-cancellation-v1': ['tools/exercisetest.mjs'],
  'exercise-event-v1': ['tools/exercisetest.mjs'],
  'exercise-attempt-v1': ['tools/exercisetest.mjs'],
  'activity-gate-v1': ['tools/activitygatetest.mjs'],
  'activity-gate-profile-v1': ['tools/activitygatetest.mjs'],
  'activity-gate-decision-v1': ['tools/activitygatetest.mjs'],
  'microtrainer-session-v1': ['tools/microtrainertest.mjs'],
  'exercise-renderer-v1': ['tools/renderertest.mjs'],
  'arcade-lab-progress-v1': ['tools/arcadelabtest.mjs'],
  'monitor-rule-v1': ['packages/adapters/test/monitor-rule.test.js', 'tools/device/test-monitor-calibrate.py'],
  'camera-rule-v1': ['packages/adapters/test/camera-rule.test.js', 'tools/device/test-camera-calibrate.py'],
  'calibration-state-v1': ['apps/device/test/calibration-state-rule.test.js'],
  'control-exclusion-v1': ['packages/adapters/test/control-exclusion.test.js'],
};
const repositoryPaths = new Set(files.map(path => relative(ROOT, path)));
for (const contract of contractRegister.contracts) {
  const fixtures = contractEvidence[contract.id];
  if (!fixtures?.length)
    throw new Error(`catalog: contract ${contract.id} has no conformance fixture`);
  for (const fixture of fixtures) {
    if (!repositoryPaths.has(fixture))
      throw new Error(`catalog: conformance fixture for ${contract.id} is missing: ${fixture}`);
  }
}
const contractSpecifications = {
  schema: 'contract-specification-catalog-v1',
  generatedFrom: 'packages/core/contracts/register.json',
  specifications: contractRegister.contracts.map(item => ({
    contractId: item.id,
    id: item.id,
    version: Number(item.id.match(/-v(\d+)$/)?.[1] ?? 1),
    owner: item.owner,
    kind: item.kind,
    purpose: `Stable ${item.id} boundary for ${item.owner}; its validator is ${item.validator}.`,
    nonPurpose: 'Does not grant capabilities beyond the fields and actions explicitly validated by the contract.',
    clockDomains: ['declared-by-payload-or-profile'],
    units: 'Values carry explicit units or are documented by the owning validator.',
    unknownBehavior: 'Invalid or unavailable data is rejected or represented as an explicit UNKNOWN state; it is never silently promoted.',
    errorBehavior: 'Reject malformed, incompatible, uncalibrated, or out-of-budget values at the boundary.',
    compatibility: 'Versioned IDs are additive by default; incompatible changes require a new version and retained fixtures.',
    runtimeValidation: item.validator,
    conformanceFixtures: contractEvidence[item.id],
  })),
};

// Stable IDs are the joins between source, tests, documentation, and retained
// evidence. Keep the forward register as the authority, but generate the
// reverse view from repository text so a reader can start at a contract or
// claim and reach every current reference without maintaining another table.
const stableLinks = [];
const linkFiles = files.filter(path => /\.(?:md|txt|js|mjs|ts|py|sh|c|S|json)$/.test(path));
const stablePatterns = [
  ['CONTRACT', /CONTRACT:([a-z0-9-]+)/gi],
  ['ADR', /ADR:([0-9]{4}-[a-z0-9-]+)/gi],
  ['CLAIM', /CLAIM:([a-z0-9._-]+)/gi],
  ['EVIDENCE', /EVIDENCE:([a-z0-9._-]+)/gi],
];
for (const path of linkFiles) {
  const source = await readFile(path, 'utf8');
  const relativePath = relative(ROOT, path);
  for (const [kind, pattern] of stablePatterns) {
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split('\n').length;
      stableLinks.push({ id: `${kind.toLowerCase()}.${match[1]}`, kind,
        path: relativePath, line, relation: 'REFERENCES' });
    }
  }
}
for (const [contractId, paths] of Object.entries(contractEvidence)) {
  for (const path of paths)
    stableLinks.push({ id: `contract.${contractId}`, kind: 'CONTRACT', path,
      relation: 'CONFORMANCE_FIXTURE' });
}
const reverseLinks = {
  schema: 'reverse-links-v1',
  generatedFrom: ['stable IDs in repository text', 'contractEvidence in tools/generate-catalog.js'],
  links: [...new Map(stableLinks.map(link => [
    `${link.id}\u0000${link.path}\u0000${link.line ?? ''}\u0000${link.relation}`, link,
  ])).values()].sort((a, b) => a.id.localeCompare(b.id) || a.path.localeCompare(b.path) ||
    (a.line ?? 0) - (b.line ?? 0) || a.relation.localeCompare(b.relation)),
};
const tests = [];
for (const path of sourceFiles.filter(path => /(?:test|check|spec)[^/]*\.(?:mjs|js|py|sh)$/.test(path))) {
  const source = await readFile(path, 'utf8');
  const id = relative(ROOT, path);
  const lane = path.includes('browser') || path.includes('realtime') ? 'test:browser:realtime' : path.includes('device') ? 'test:contracts' : 'test:unit';
  const fixedSleeps = [...source.matchAll(/(?:setTimeout|sleep|time\.sleep)\s*\(([^\n)]*)/g)]
    .map(match => match[0].trim()).slice(0, 12);
  const nondeterministic = [...source.matchAll(/\b(Math\.random|Date\.now|new Date\(|performance\.now|crypto\.randomUUID)\b/g)]
    .map(match => match[1]);
  const sharedResources = [...new Set([
    ...(source.includes('chrome') || source.includes('CDP') ? ['browser'] : []),
    ...(source.includes('adb') || source.includes('/dev/') || source.includes('hid') ? ['device-transport'] : []),
    ...(source.includes('8731') || source.includes('serve.py') ? ['local-http-port'] : []),
  ])];
  tests.push({
    id, lane,
    owner: path.includes('packages/core') ? '@fnaf2-1020/core' : path.includes('packages') ? 'package boundary' : 'legacy migration',
    timeoutMs: lane === 'test:browser:realtime' ? 360000
      : id === 'tools/ventreacttest.mjs' ? 900000
        : id === 'tools/minus7/test-search.mjs' ? 600000
        : id === 'tools/reactivetest.mjs' ? 300000
          : id === 'tools/device/test-human-gate.mjs' ? 240000 : 180000,
    timeoutSource: 'tools/test.mjs per-test watchdog',
    deterministic: nondeterministic.length === 0,
    determinismSignals: nondeterministic,
    fixedSleeps,
    sharedResources,
    subprocesses: /(?:\.sh|test-docs|test\.mjs|spawn\(|execFile)/.test(source),
    measurement: { status: 'NOT_MEASURED', runs: 0, durationMs: null, flakiness: null },
  });
}
const duplicateResponsibilities = [
  { responsibility: 'canonical mechanics', owner: '@fnaf2-1020/core', legacy: [] },
  { responsibility: 'semantic policy IR', owner: '@fnaf2-1020/core', legacy: ['tools/device/policy-ir.mjs'] },
  { responsibility: 'physical actuation', owner: '@fnaf2-1020/adapters', legacy: ['tools/device/actuator.mjs'] },
  { responsibility: 'device composition', owner: '@fnaf2-1020/device', legacy: ['tools/device/recipe.mjs'] },
  { responsibility: 'research execution', owner: '@fnaf2-1020/research', legacy: ['tools/*search*', 'tools/*sweep*', 'tools/*probe*'] },
];

// The compatibility page is the human view; this register is the machine view
// used by migration checks and release reviews. Keep an entry for every
// caller-visible legacy or transitional path, including the generated remote
// driver pieces. A path is never removed merely because a replacement exists:
// the removal gate records the evidence still needed to make deletion safe.
const legacyPaths = [
  {
    id: 'device.shell-session', path: 'tools/device/session.sh', category: 'device',
    lifecycle: 'compatibility', owner: '@fnaf2-1020/device',
    replacement: 'run packs (docs/evidence/runs/) for nights; this bridge stays for collect-cue-audio.sh and capture-screen-sample.sh',
    removalGate: 'The cue-audio and screen-sample collectors write run packs or retire',
    notes: 'Sourced manifest bridge; the historical shell runner that also used it was archived 2026-09-25.',
  },
  {
    id: 'device.session-manifest-producer', path: 'tools/device/session-manifest.py', category: 'device',
    lifecycle: 'legacy', owner: '@fnaf2-1020/device',
    replacement: 'run packs for nights; `session-manifest-v1` (core/contracts) for research sessions',
    removalGate: 'Historical manifests are indexed/replayable and the shell runner is removed',
    notes: 'Plan 09 producer for the shell-specific `fnaf2.session-manifest` dialect.',
  },
  {
    id: 'device.session-manifest-validator', path: 'tools/device/validate-session.py', category: 'device',
    lifecycle: 'transitional', owner: '@fnaf2-1020/evidence',
    replacement: 'core/contracts validateManifest + evidence CLI',
    removalGate: 'Historical shell manifests remain inspectable through the evidence boundary',
    notes: 'Validator for the legacy shell manifest; its filename must not be confused with the core `session-manifest-v1` contract.',
  },
  {
    id: 'device.session-manifest-schema', path: 'tools/device/schema/session-manifest-v1.json', category: 'device',
    lifecycle: 'legacy', owner: '@fnaf2-1020/device',
    replacement: 'core/contracts `session-manifest-v1` contract',
    removalGate: 'Legacy `fnaf2.session-manifest` fixtures and consumers are archived',
    notes: 'Legacy schema whose internal id is `fnaf2.session-manifest`; it is not the core JSON contract.',
  },
  {
    id: 'device.legacy-grader', path: 'tools/device/grade-run.sh', category: 'device-evidence',
    lifecycle: 'transitional', owner: '@fnaf2-1020/evidence',
    replacement: 'evidence CLI over content-addressed device bundles',
    removalGate: 'Historical video/HID/session artifacts have an equivalent structured grader',
    notes: 'The night grader. Since 2026-09-25 it reads what night-run.sh retains -- recording, campaign directory, input and frame traces; the shell runner inputs left with that runner.',
  },
  {
    id: 'device.shell-adb-selector', path: 'tools/device/select-adb.sh', category: 'transport',
    lifecycle: 'transitional', owner: '@fnaf2-1020/adapters',
    replacement: 'explicit injected transport selected by the device composition root',
    removalGate: 'All direct-ADB probes either become adapters or are explicitly archived',
    notes: 'Useful characterization guard, but it must not select a canonical live strategy.',
  },
  {
    id: 'device.shell-coordinates', path: 'tools/device/coords.sh', category: 'transport',
    lifecycle: 'transitional', owner: '@fnaf2-1020/adapters',
    replacement: 'resolved device profile controlMap',
    removalGate: 'All device actions consume profile geometry; probe-only users are archived',
    notes: 'Legacy shell coordinate authority; modern semantic commands carry no coordinates.',
  },
  {
    id: 'device.shell-menu', path: 'tools/device/menu.sh', category: 'device',
    lifecycle: 'transitional', owner: '@fnaf2-1020/device',
    replacement: 'title/menu detector and the campaign executor state gate',
    removalGate: 'Automated menu-state detector has calibrated evidence and a dry-run fixture',
    notes: 'Human-safe selector retained because the current phone cursor is not machine-qualified.',
  },
  {
    id: 'device.simulated-actuator', path: 'tools/device/actuator.mjs', category: 'simulation',
    lifecycle: 'transitional', owner: '@fnaf2-1020/adapters',
    replacement: 'adapter actuator/error model with conformance fixtures',
    removalGate: 'Pilot/model consumers migrate without changing measured error semantics',
    notes: 'Historical device-lateness model; not a physical transport.',
  },
  {
    id: 'device.recipe-emitter', path: 'tools/device/recipe.mjs', category: 'device-artifact',
    lifecycle: 'transitional', owner: '@fnaf2-1020/device',
    replacement: 'package-owned winner/device-bundle emitter',
    removalGate: 'Bundle emitter no longer imports the tools tree and replay hashes match',
    notes: 'Still used by the bundle compiler, so removal is blocked until extraction.',
  },
  {
    id: 'device.policy-ir-module', path: 'tools/device/policy-ir.mjs', category: 'policy',
    lifecycle: 'transitional', owner: '@fnaf2-1020/core',
    replacement: 'core policy-program contract and research package emitter',
    removalGate: 'P3 policy vocabulary migration and fixed-seed artifact equivalence',
    notes: 'Compatibility policy builder retained while policy ownership moves out of tools.',
  },
  {
    id: 'research.stock-device-pilot', path: 'tools/model/stock-device-pilot.mjs', category: 'research',
    lifecycle: 'legacy', owner: '@fnaf2-1020/research',
    replacement: 'experiment spec/runner with an explicit historical actuator model',
    removalGate: 'Historical sweeps have structured, replayable experiment artifacts',
    notes: 'Retired swipe-era schedule report; it is not a selectable device route.',
  },
  {
    id: 'research.minus-toys-alias', path: 'tools/minustoystest.mjs', category: 'research-alias',
    lifecycle: 'compatibility', owner: '@fnaf2-1020/research',
    replacement: 'npm run research -- minus-toys',
    removalGate: 'Package structured artifacts and fixed-seed output are equivalent',
    notes: 'Compatibility alias for the research package family evaluator.',
  },
  {
    id: 'research.minus-two-alias', path: 'tools/minus2test.mjs', category: 'research-alias',
    lifecycle: 'compatibility', owner: '@fnaf2-1020/research',
    replacement: 'npm run research -- minus-two',
    removalGate: 'Package structured artifacts and fixed-seed output are equivalent',
    notes: 'Compatibility alias for the research package family evaluator.',
  },
  {
    id: 'package.legacy-engine-command', path: 'package.json#scripts.test:legacy:engine', category: 'command',
    lifecycle: 'compatibility', owner: '@fnaf2-1020/core',
    replacement: 'node tools/test.mjs --engine (canonical engine fixture lane)',
    removalGate: 'Bare-Node compatibility lane is no longer needed and P9 audit is green',
    notes: 'Retained package command for the old engine test entry point.',
  },
];

const outputs = {
  'import-graph.json': { schema: 'import-graph-v1', files: importGraph },
  'command-registry.json': { schema: 'command-registry-v1', source: ['package.json', ...toolIndexes], commands: commandRegistry, tools: toolCommands },
  'contract-register.json': contractRegister,
  'contract-specifications.json': contractSpecifications,
  'protocol-register.json': { schema: 'protocol-register-v1', protocols },
  'test-manifest.json': { schema: 'test-manifest-v1', generatedFrom: 'source inventory', tests },
  'duplicate-responsibilities.json': { schema: 'duplicate-responsibility-map-v1', entries: duplicateResponsibilities },
  'legacy-paths.json': { schema: 'legacy-path-map-v1', generatedFrom: 'tools/generate-catalog.js', entries: legacyPaths },
  'reverse-links.json': reverseLinks,
};
for (const [name, value] of Object.entries(outputs)) await writeFile(join(OUT, name), JSON.stringify(value, null, 2) + '\n');
console.log(`catalog: ${Object.keys(outputs).length} inventories (${sourceFiles.length} source files)`);
