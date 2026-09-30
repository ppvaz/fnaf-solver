#!/usr/bin/env node
/** Generate checked-in inventories from executable repository truth. */
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROL_CATALOGS } from '@sixam/source';

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
const toolIndexes = ['tools/README.md', 'tools/cue/README.md', 'tools/device/README.md', 'packages/source/decompile/README.md'];
const toolsIndex = (await Promise.all(toolIndexes.map(path => readFile(join(ROOT, path), 'utf8')))).join('\n');
const toolCommands = [...toolsIndex.matchAll(/^\| `([^`]+)` \| ([^|]+) \|/gm)].map(match => ({
  id: match[1].split(/\s+/)[0], invocation: match[1], kind: match[2].trim(), lifecycle: /legacy|historical/i.test(match[2]) ? 'legacy' : 'supported',
}));
const contractRegister = JSON.parse(await readFile(join(ROOT, 'packages/kernel/contracts/register.json'), 'utf8'));
const protocols = contractRegister.contracts.filter(item => ['wire', 'process'].includes(item.kind));
const contractEvidence = {
  'plant-model-v1': ['tools/sourcetest.mjs', 'tools/simtest.mjs'],
  'semantic-control-v1': ['packages/source/test/contracts.test.js', 'packages/source/test/control-catalog.test.js',
    'tools/device/test-policy-interpreter.mjs'],
  'policy-program-v1': ['tools/policygrammartest.mjs', 'tools/device/test-policy-ir.mjs'],
  'controller-v1': ['tools/reactivetest.mjs', 'packages/core/test/cycle-controller.test.js'],
  'qualification-v1': ['packages/source/test/contracts.test.js', 'packages/kernel/test/venue-identity.test.js'],
  'qualification-v2': ['packages/kernel/test/venue-identity.test.js', 'apps/device/test/venue-preflight.test.js'],
  'venue-identity-v1': ['packages/kernel/test/venue-identity.test.js', 'packages/adapters/test/android-venue.test.js'],
  'venue-check-v1': ['packages/kernel/test/venue-identity.test.js', 'apps/device/test/venue-preflight.test.js'],
  'venue-binding-v1': ['packages/kernel/test/venue-identity.test.js', 'apps/device/test/venue-preflight.test.js'],
  'state-estimate-v1': ['tools/estimatortest.mjs'],
  'clock-v1': ['tools/phaseclocktest.mjs'],
  'device-profile-v1': ['tools/device/test-bundle.mjs', 'apps/device/test/profile-game.test.js'],
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
  'fact-message-v1': ['packages/source/test/fixtures/fact-message-v1.jsonl'],
  'hid-executor-v1': ['packages/adapters/test/conformance.test.js', 'apps/device/test/adb-device-local-executor.test.js'],
  'device-executor-v1': ['apps/device/test/adb-device-local-executor.test.js', 'apps/device/test/profile-game.test.js'],
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
  'claim-envelope-v1': ['packages/kernel/test/claim-envelope.test.js', 'tools/device/test-cue-helper-mcp.mjs'],
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
  generatedFrom: 'packages/kernel/contracts/register.json',
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
    owner: path.includes('packages/core') ? '@sixam/core' : path.includes('packages/source') ? '@sixam/source'
      : path.includes('packages/kernel') ? '@sixam/kernel' : path.includes('packages') ? 'package boundary' : 'legacy migration',
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
  { responsibility: 'canonical mechanics', owner: '@sixam/source', legacy: [] },
  { responsibility: 'semantic policy IR', owner: '@sixam/core', legacy: ['tools/device/policy-ir.mjs'] },
  { responsibility: 'physical actuation', owner: '@sixam/adapters', legacy: ['tools/device/actuator.mjs'] },
  { responsibility: 'device composition', owner: '@sixam/device', legacy: ['tools/device/recipe.mjs'] },
  { responsibility: 'research execution', owner: '@sixam/research', legacy: ['tools/*search*', 'tools/*sweep*', 'tools/*probe*'] },
];

// The compatibility page is the human view; this register is the machine view
// used by migration checks and release reviews. Keep an entry for every
// caller-visible legacy or transitional path, including the generated remote
// driver pieces. A path is never removed merely because a replacement exists:
// the removal gate records the evidence still needed to make deletion safe.
const legacyPaths = [
  {
    id: 'device.shell-session', path: 'tools/device/session.sh', category: 'device',
    lifecycle: 'compatibility', owner: '@sixam/device',
    replacement: 'run packs (docs/evidence/runs/) for nights; this bridge stays for collect-cue-audio.sh and capture-screen-sample.sh',
    removalGate: 'The cue-audio and screen-sample collectors write run packs or retire',
    notes: 'Sourced manifest bridge; the historical shell runner that also used it was archived 2026-09-25.',
  },
  {
    id: 'device.session-manifest-producer', path: 'tools/device/session-manifest.py', category: 'device',
    lifecycle: 'legacy', owner: '@sixam/device',
    replacement: 'run packs for nights; `session-manifest-v1` (core/contracts) for research sessions',
    removalGate: 'Historical manifests are indexed/replayable and the shell runner is removed',
    notes: 'Plan 09 producer for the shell-specific `fnaf2.session-manifest` dialect.',
  },
  {
    id: 'device.session-manifest-validator', path: 'tools/device/validate-session.py', category: 'device',
    lifecycle: 'transitional', owner: '@sixam/evidence',
    replacement: 'core/contracts validateManifest + evidence CLI',
    removalGate: 'Historical shell manifests remain inspectable through the evidence boundary',
    notes: 'Validator for the legacy shell manifest; its filename must not be confused with the core `session-manifest-v1` contract.',
  },
  {
    id: 'device.session-manifest-schema', path: 'tools/device/schema/session-manifest-v1.json', category: 'device',
    lifecycle: 'legacy', owner: '@sixam/device',
    replacement: 'core/contracts `session-manifest-v1` contract',
    removalGate: 'Legacy `fnaf2.session-manifest` fixtures and consumers are archived',
    notes: 'Legacy schema whose internal id is `fnaf2.session-manifest`; it is not the core JSON contract.',
  },
  {
    id: 'device.legacy-grader', path: 'tools/device/grade-run.sh', category: 'device-evidence',
    lifecycle: 'transitional', owner: '@sixam/evidence',
    replacement: 'evidence CLI over content-addressed device bundles',
    removalGate: 'Historical video/HID/session artifacts have an equivalent structured grader',
    notes: 'The night grader. Since 2026-09-25 it reads what night-run.sh retains -- recording, campaign directory, input and frame traces; the shell runner inputs left with that runner.',
  },
  {
    id: 'device.shell-adb-selector', path: 'tools/device/select-adb.sh', category: 'transport',
    lifecycle: 'transitional', owner: '@sixam/adapters',
    replacement: 'explicit injected transport selected by the device composition root',
    removalGate: 'All direct-ADB probes either become adapters or are explicitly archived',
    notes: 'Useful characterization guard, but it must not select a canonical live strategy.',
  },
  {
    id: 'device.shell-coordinates', path: 'tools/device/coords.sh', category: 'transport',
    lifecycle: 'transitional', owner: '@sixam/adapters',
    replacement: 'resolved device profile controlMap',
    removalGate: 'All device actions consume profile geometry; probe-only users are archived',
    notes: 'Legacy shell coordinate authority; modern semantic commands carry no coordinates.',
  },
  {
    id: 'device.shell-menu', path: 'tools/device/menu.sh', category: 'device',
    lifecycle: 'transitional', owner: '@sixam/device',
    replacement: 'title/menu detector and the campaign executor state gate',
    removalGate: 'Automated menu-state detector has calibrated evidence and a dry-run fixture',
    notes: 'Human-safe selector retained because the current phone cursor is not machine-qualified.',
  },
  {
    id: 'device.simulated-actuator', path: 'tools/device/actuator.mjs', category: 'simulation',
    lifecycle: 'transitional', owner: '@sixam/adapters',
    replacement: 'adapter actuator/error model with conformance fixtures',
    removalGate: 'Pilot/model consumers migrate without changing measured error semantics',
    notes: 'Historical device-lateness model; not a physical transport.',
  },
  {
    id: 'device.recipe-emitter', path: 'tools/device/recipe.mjs', category: 'device-artifact',
    lifecycle: 'transitional', owner: '@sixam/device',
    replacement: 'package-owned winner/device-bundle emitter',
    removalGate: 'Bundle emitter no longer imports the tools tree and replay hashes match',
    notes: 'Still used by the bundle compiler, so removal is blocked until extraction.',
  },
  {
    id: 'device.policy-ir-module', path: 'tools/device/policy-ir.mjs', category: 'policy',
    lifecycle: 'transitional', owner: '@sixam/core',
    replacement: 'core policy-program contract and research package emitter',
    removalGate: 'P3 policy vocabulary migration and fixed-seed artifact equivalence',
    notes: 'Compatibility policy builder retained while policy ownership moves out of tools.',
  },
  {
    id: 'research.stock-device-pilot', path: 'tools/model/stock-device-pilot.mjs', category: 'research',
    lifecycle: 'legacy', owner: '@sixam/research',
    replacement: 'experiment spec/runner with an explicit historical actuator model',
    removalGate: 'Historical sweeps have structured, replayable experiment artifacts',
    notes: 'Retired swipe-era schedule report; it is not a selectable device route.',
  },
  {
    id: 'research.minus-toys-alias', path: 'tools/minustoystest.mjs', category: 'research-alias',
    lifecycle: 'compatibility', owner: '@sixam/research',
    replacement: 'npm run research -- minus-toys',
    removalGate: 'Package structured artifacts and fixed-seed output are equivalent',
    notes: 'Compatibility alias for the research package family evaluator.',
  },
  {
    id: 'research.minus-two-alias', path: 'tools/minus2test.mjs', category: 'research-alias',
    lifecycle: 'compatibility', owner: '@sixam/research',
    replacement: 'npm run research -- minus-two',
    removalGate: 'Package structured artifacts and fixed-seed output are equivalent',
    notes: 'Compatibility alias for the research package family evaluator.',
  },
  {
    id: 'review.evidence-pack-shim', path: 'tools/evidence-pack.mjs', category: 'evidence',
    lifecycle: 'compatibility', owner: '@sixam/review',
    replacement: 'packages/review/src/evidence-pack.mjs (`@sixam/review/evidence-pack`)',
    removalGate: 'No tracked file imports tools/evidence-pack.mjs, and every reader of a pack takes its stored `packer` as a name read against the commit that wrote the pack (ADR 0002 principle 9), never as a path to load',
    notes: 'One-line re-export left by the 2026-09-29 move of the four evidence tools into packages/review. Every committed run pack records `packer: tools/evidence-pack.mjs`, a stored value the pack digest (and so every attestation) covers, so the value stays and the path keeps resolving.',
  },
  // ADR 0002 migration D1/D3/D4 (Plan 27's move map): the contracts, the
  // register and Time moved into @sixam/kernel. The core subpaths that named
  // them keep every export as re-exports, so no importer breaks mid-migration.
  {
    id: 'core.contracts-shim', path: 'packages/core/src/contracts/index.js', category: 'package-subpath',
    lifecycle: 'compatibility', owner: '@sixam/kernel',
    replacement: '`@sixam/kernel/contracts` (packages/kernel/src/contracts/); the three catalog-generated validators from `@sixam/source`',
    removalGate: 'No tracked module imports a contract from `@sixam/core/contracts` or `@sixam/core` (true since D3, 2026-09-30), and the docs and hand-run commands that still name the subpath are updated',
    notes: 'Re-exports `@sixam/kernel/contracts` and the three catalog-generated validators (validateControlCommand, deviceProfileGame, resolveDeviceProfile); its export set is the one it had before the move.',
  },
  {
    id: 'core.mechanics-shim', path: 'packages/core/src/mechanics/index.js', category: 'package-subpath',
    lifecycle: 'compatibility', owner: '@sixam/source',
    replacement: '`@sixam/source/fnaf2` (packages/source/src/games/fnaf2/), whose export set is exactly this barrel\'s',
    removalGate: 'No tracked module imports `@sixam/core/mechanics`: the tools/recompile importers (their owner repoints them) and the engine-source files a bundle manifest hashes (tools/device/minus-toys-plan.mjs, recipe.mjs, tools/model/hid-device-pilot.mjs) are repointed in a commit that re-derives every emitted bundle',
    notes: 'One `export *` of `@sixam/source/fnaf2`. tools/recompile/model-draw-trace.mjs resolves this barrel to find the model sources it hashes beside it, which is why the three links below live in this directory.',
  },
  ...['plant-model', 'config', 'rng'].map(name => ({
    id: `core.model-source-link.${name}`, path: `packages/core/src/mechanics/${name}.js`, category: 'model-source',
    lifecycle: 'compatibility', owner: '@sixam/source',
    replacement: `packages/source/src/games/fnaf2/${name}.js (the same bytes; this path is a symbolic link to it)`,
    removalGate: 'tools/recompile/model-draw-trace.mjs (the recompile session\'s) finds the model sources it hashes into new records through @sixam/source instead of beside the @sixam/core/mechanics barrel',
    notes: 'The frozen phone-input-bracket-full-06-20260928 result names these paths; since 2026-09-30 its check resolves each through that path\'s git history and matches the model files by name, so it passes without the links (pinned in test-phone-input-bracket-sweep.mjs). Record producers still hash MODEL_SOURCES at these paths; the link keeps them reading the moved file.',
  })),
  {
    id: 'core.control-vocabulary-shim', path: 'packages/core/src/control/index.js', category: 'package-subpath',
    lifecycle: 'compatibility', owner: '@sixam/source',
    replacement: '`@sixam/source` for the control vocabulary and the per-game catalogs; the policy language, controllers and cycle machinery stay here until they move to Propose',
    removalGate: 'No tracked module imports a vocabulary or catalog name from `@sixam/core/control` (true since D3, 2026-09-30, outside tools/recompile, whose owner repoints two), and the rest of the barrel has its Propose home',
    notes: 'Re-exports the 37 vocabulary and catalog names by name from `@sixam/source` beside the modules that still live in core; its export set is the one it had before the move.',
  },
  {
    id: 'core.telemetry-shim', path: 'packages/core/src/telemetry/index.js', category: 'package-subpath',
    lifecycle: 'compatibility', owner: '@sixam/kernel',
    replacement: '`@sixam/kernel/time` for the fact link and the event clocks; the bench transport trace stays here until it moves to Review',
    removalGate: 'No tracked module imports the fact link or the event clocks from `@sixam/core/telemetry` (true since D3, 2026-09-30), and bench-trace.js has its Review home',
    notes: 'Re-exports fact-link.js and event-clocks.js by name from the kernel beside bench-trace.js, which still lives here.',
  },
  {
    id: 'core.timing-shim', path: 'packages/core/src/timing/index.js', category: 'package-subpath',
    lifecycle: 'compatibility', owner: '@sixam/kernel',
    replacement: '`@sixam/kernel/time` for `ClockPort`; the phase clock stays here until it moves to Play',
    removalGate: 'No tracked module imports `ClockPort` from `@sixam/core/timing` (true since D3, 2026-09-30), and phase-clock.js has its Play home',
    notes: 'Re-exports the kernel clock port by name beside phase-clock.js, which still lives here.',
  },
  {
    id: 'package.legacy-engine-command', path: 'package.json#scripts.test:legacy:engine', category: 'command',
    lifecycle: 'compatibility', owner: '@sixam/core',
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
  // The per-game control catalogs as data (LEG-007): every descriptor with its
  // aliases, action kinds, binding, preconditions and observation, and FNaF 2's
  // artifact action table. The validators are generated from the same objects.
  'control-catalog.json': { schema: 'control-catalog-register-v1',
    generatedFrom: 'packages/source/src/games/*/controls.js', games: Object.values(CONTROL_CATALOGS) },
};
for (const [name, value] of Object.entries(outputs)) await writeFile(join(OUT, name), JSON.stringify(value, null, 2) + '\n');
console.log(`catalog: ${Object.keys(outputs).length} inventories (${sourceFiles.length} source files)`);
