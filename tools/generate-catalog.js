#!/usr/bin/env node
/** Generate checked-in inventories from executable repository truth. */
import { readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
// The tool indexes: tools/'s own READMEs and the decompile chain's, plus the
// `## Scripts` table of every package and application README, where a script
// that left tools/ for its context keeps its row (ADR 0002 layout, LEG-008).
const SCRIPTS_HEADING = '\n## Scripts\n';
const scriptsReadmes = files.map(path => relative(ROOT, path))
  .filter(path => /^(?:packages|apps)\/[^/]+\/README\.md$/.test(path)).sort();
const toolIndexes = ['tools/README.md', 'tools/device/README.md', 'packages/source/decompile/README.md',
  'packages/source/recompile/README.md', ...scriptsReadmes];
const toolsIndex = (await Promise.all(toolIndexes.map(async path => {
  const text = await readFile(join(ROOT, path), 'utf8');
  return scriptsReadmes.includes(path) ? (text.split(SCRIPTS_HEADING)[1] ?? '').split('\n## ')[0] : text;
}))).join('\n');
const toolCommands = [...toolsIndex.matchAll(/^\| `([^`]+)` \| ([^|]+) \|/gm)].map(match => ({
  id: match[1].split(/\s+/)[0], invocation: match[1], kind: match[2].trim(), lifecycle: /legacy|historical/i.test(match[2]) ? 'legacy' : 'supported',
}));
const contractRegister = JSON.parse(await readFile(join(ROOT, 'packages/kernel/contracts/register.json'), 'utf8'));
const protocols = contractRegister.contracts.filter(item => ['wire', 'process'].includes(item.kind));
const contractEvidence = {
  'plant-model-v1': ['packages/source/test/sourcetest.mjs', 'packages/source/test/simtest.mjs'],
  'semantic-control-v1': ['packages/source/test/contracts.test.js', 'packages/source/test/control-catalog.test.js',
    'packages/propose/bin/policy/test-policy-interpreter.mjs'],
  'policy-program-v1': ['packages/propose/test/policygrammartest.mjs', 'packages/propose/bin/policy/test-policy-ir.mjs',
    'packages/propose/test/policy-game.test.js'],
  'controller-v1': ['packages/propose/test/reactivetest.mjs', 'packages/propose/test/cycle-controller.test.js'],
  'qualification-v1': ['packages/source/test/contracts.test.js', 'packages/kernel/test/venue-identity.test.js'],
  'qualification-v2': ['packages/kernel/test/venue-identity.test.js', 'packages/play/test/venue-preflight.test.js'],
  'venue-identity-v1': ['packages/kernel/test/venue-identity.test.js', 'packages/play/test/android-venue.test.js'],
  'venue-check-v1': ['packages/kernel/test/venue-identity.test.js', 'packages/play/test/venue-preflight.test.js'],
  'venue-binding-v1': ['packages/kernel/test/venue-identity.test.js', 'packages/play/test/venue-preflight.test.js'],
  'state-estimate-v1': ['packages/play/test/estimator.test.js'],
  'clock-v1': ['packages/play/test/phase-clock.test.js'],
  'device-profile-v1': ['packages/propose/test/test-bundle.mjs', 'packages/play/test/profile-game.test.js'],
  'telemetry-event-v1': ['packages/kernel/test/factlinktest.mjs'],
  'session-manifest-v1': ['packages/play/bin/phone/test-session-manifest.sh'],
  'experiment-spec-v1': ['packages/propose/test/experiment.test.js'],
  'experiment-result-v1': ['packages/propose/test/experiment.test.js'],
  'experiment-spec-v2': ['packages/kernel/test/experiment-v2.test.js', 'packages/propose/test/census.test.js'],
  'experiment-result-v2': ['packages/kernel/test/experiment-v2.test.js', 'packages/propose/test/census.test.js'],
  'winner-v1': ['packages/propose/test/test-bundle.mjs'],
  'device-bundle-v1': ['packages/propose/test/test-bundle.mjs'],
  'device-artifact-v1': ['packages/propose/test/test-bundle.mjs'],
  'trainer-trace-v1': ['apps/trainer/test/tracereport.mjs'],
  'artifact-ref-v1': ['apps/desktop/src/evidence.ts'],
  'claim-evidence-v1': ['apps/desktop/src/evidence.ts'],
  'companion-status-v1': ['packages/play/test/companion-status.test.js', 'android/companion/test/com/ppvaz/fnafcompanion/CompanionStatusTest.java'],
  'cue-helper-control-v1': ['packages/propose/parked/minus7/cue/test-cue.py'],
  'fact-message-v1': ['packages/source/test/fixtures/fact-message-v1.jsonl'],
  'hid-executor-v1': ['packages/play/test/conformance.test.js', 'packages/play/test/adb-device-local-executor.test.js'],
  'device-executor-v1': ['packages/play/test/adb-device-local-executor.test.js', 'packages/play/test/profile-game.test.js'],
  'device-campaign-v1': ['packages/play/test/campaign.test.js', 'packages/play/test/campaign-runner.test.js'],
  'device-adb-preflight-v1': ['packages/play/test/adb-bridge.test.js'],
  'device-campaign-result-v1': ['packages/play/test/campaign.test.js', 'packages/play/test/campaign-runner.test.js'],
  'campaign-proof-v1': ['packages/play/test/campaign-runner.test.js'],
  'custom-night-config-v1': ['packages/play/test/campaign.test.js', 'packages/play/test/campaign-infrastructure.test.js'],
  'custom-night-calibration-v1': ['packages/play/test/campaign-infrastructure.test.js'],
  'device-campaign-preflight-v1': ['packages/play/test/campaign-infrastructure.test.js'],
  'bench-transport-trace-v1': ['packages/review/test/bench-trace.test.mjs'],
  'exercise-v1': ['apps/trainer/test/exercise.test.mjs'],
  'commitment-v1': ['apps/trainer/test/exercise.test.mjs'],
  'resolution-v1': ['apps/trainer/test/exercise.test.mjs'],
  'exercise-cancellation-v1': ['apps/trainer/test/exercise.test.mjs'],
  'exercise-event-v1': ['apps/trainer/test/exercise.test.mjs'],
  'exercise-attempt-v1': ['apps/trainer/test/exercise.test.mjs'],
  'activity-gate-v1': ['apps/trainer/test/activity-gate.test.mjs'],
  'activity-gate-profile-v1': ['apps/trainer/test/activity-gate.test.mjs'],
  'activity-gate-decision-v1': ['apps/trainer/test/activity-gate.test.mjs'],
  'microtrainer-session-v1': ['apps/trainer/test/microtrainer.test.mjs'],
  'exercise-renderer-v1': ['apps/trainer/test/renderer.test.mjs'],
  'arcade-lab-progress-v1': ['apps/trainer/test/arcade-lab.test.mjs'],
  'monitor-rule-v1': ['packages/play/test/monitor-rule.test.js', 'packages/play/bin/calibrate/test-monitor-calibrate.py'],
  'camera-rule-v1': ['packages/play/test/camera-rule.test.js', 'packages/play/bin/calibrate/test-camera-calibrate.py'],
  'calibration-state-v1': ['packages/play/test/calibration-state-rule.test.js'],
  'control-exclusion-v1': ['packages/play/test/control-exclusion.test.js'],
  'claim-envelope-v1': ['packages/kernel/test/claim-envelope.test.js', 'apps/desktop/test/companion-mcp.test.mjs'],
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
for (const path of sourceFiles.filter(path => /(?:test|check|spec)[^/]*\.(?:mjs|js|ts|mts|py|sh)$/.test(path) && !path.endsWith('.d.ts'))) {
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
    owner: path.includes('packages/core') ? '@sixam/core' : path.includes('packages/source') ? '@sixam/source' : path.includes('packages/propose') ? '@sixam/propose'
      : path.includes('packages/play') ? '@sixam/play'
      : path.includes('packages/kernel') ? '@sixam/kernel' : path.includes('packages') ? 'package boundary' : 'legacy migration',
    timeoutMs: lane === 'test:browser:realtime' ? 360000
      : id === 'packages/propose/bin/ventreacttest.mjs' ? 900000
        : id === 'packages/propose/parked/minus7/test-search.mjs' ? 600000
        : id === 'packages/propose/test/reactivetest.mjs' ? 300000
          : id === 'packages/propose/bin/plans/test-human-gate.mjs' ? 240000 : 180000,
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
  { responsibility: 'semantic policy IR', owner: '@sixam/propose', legacy: ['packages/propose/bin/policy/policy-ir.mjs'] },
  { responsibility: 'physical actuation', owner: '@sixam/play', legacy: ['packages/play/bin/phone/actuator.mjs'] },
  { responsibility: 'device composition', owner: '@sixam/desktop', legacy: ['packages/propose/bin/plans/recipe.mjs'] },
  { responsibility: 'research execution', owner: '@sixam/propose', legacy: ['tools/*search*', 'tools/*sweep*', 'tools/*probe*'] },
];

// The compatibility page is the human view; this register is the machine view
// used by migration checks and release reviews. Keep an entry for every
// caller-visible legacy or transitional path, including the generated remote
// driver pieces. A path is never removed merely because a replacement exists:
// the removal gate records the evidence still needed to make deletion safe.
const legacyPaths = [
  {
    id: 'device.shell-session', path: 'packages/play/bin/phone/session.sh', category: 'device',
    lifecycle: 'compatibility', owner: '@sixam/play',
    replacement: 'run packs (docs/evidence/runs/) for nights; this bridge stays for collect-cue-audio.sh and capture-screen-sample.sh',
    removalGate: 'The cue-audio and screen-sample collectors write run packs or retire',
    notes: 'Sourced manifest bridge; the historical shell runner that also used it was archived 2026-09-25.',
  },
  {
    id: 'device.session-manifest-producer', path: 'packages/review/bin/legacy/session-manifest.py', category: 'device',
    lifecycle: 'legacy', owner: '@sixam/play',
    replacement: 'run packs for nights; `session-manifest-v1` (core/contracts) for research sessions',
    removalGate: 'Historical manifests are indexed/replayable and the shell runner is removed',
    notes: 'Plan 09 producer for the shell-specific `fnaf2.session-manifest` dialect.',
  },
  {
    id: 'device.session-manifest-validator', path: 'packages/review/bin/legacy/validate-session.py', category: 'device',
    lifecycle: 'transitional', owner: '@sixam/evidence',
    replacement: 'core/contracts validateManifest + evidence CLI',
    removalGate: 'Historical shell manifests remain inspectable through the evidence boundary',
    notes: 'Validator for the legacy shell manifest; its filename must not be confused with the core `session-manifest-v1` contract.',
  },
  {
    id: 'device.session-manifest-schema', path: 'packages/review/bin/legacy/schema/session-manifest-v1.json', category: 'device',
    lifecycle: 'legacy', owner: '@sixam/play',
    replacement: 'core/contracts `session-manifest-v1` contract',
    removalGate: 'Legacy `fnaf2.session-manifest` fixtures and consumers are archived',
    notes: 'Legacy schema whose internal id is `fnaf2.session-manifest`; it is not the core JSON contract.',
  },
  {
    id: 'device.legacy-grader', path: 'packages/review/bin/grade/grade-run.sh', category: 'device-evidence',
    lifecycle: 'transitional', owner: '@sixam/evidence',
    replacement: 'evidence CLI over content-addressed device bundles',
    removalGate: 'Historical video/HID/session artifacts have an equivalent structured grader',
    notes: 'The night grader. Since 2026-09-25 it reads what night-run.sh retains -- recording, campaign directory, input and frame traces; the shell runner inputs left with that runner.',
  },
  {
    id: 'device.shell-adb-selector', path: 'packages/play/bin/phone/select-adb.sh', category: 'transport',
    lifecycle: 'transitional', owner: '@sixam/play',
    replacement: 'explicit injected transport selected by the device composition root',
    removalGate: 'All direct-ADB probes either become adapters or are explicitly archived',
    notes: 'Useful characterization guard, but it must not select a canonical live strategy.',
  },
  {
    id: 'device.shell-coordinates', path: 'packages/play/bin/phone/coords.sh', category: 'transport',
    lifecycle: 'transitional', owner: '@sixam/play',
    replacement: 'resolved device profile controlMap',
    removalGate: 'All device actions consume profile geometry; probe-only users are archived',
    notes: 'Legacy shell coordinate authority; modern semantic commands carry no coordinates.',
  },
  {
    id: 'device.shell-menu', path: 'packages/play/bin/phone/menu.sh', category: 'device',
    lifecycle: 'transitional', owner: '@sixam/play',
    replacement: 'title/menu detector and the campaign executor state gate',
    removalGate: 'Automated menu-state detector has calibrated evidence and a dry-run fixture',
    notes: 'Human-safe selector retained because the current phone cursor is not machine-qualified.',
  },
  {
    id: 'device.simulated-actuator', path: 'packages/play/bin/phone/actuator.mjs', category: 'simulation',
    lifecycle: 'transitional', owner: '@sixam/play',
    replacement: 'adapter actuator/error model with conformance fixtures',
    removalGate: 'Pilot/model consumers migrate without changing measured error semantics',
    notes: 'Historical device-lateness model; not a physical transport.',
  },
  {
    id: 'device.recipe-emitter', path: 'packages/propose/bin/plans/recipe.mjs', category: 'device-artifact',
    lifecycle: 'transitional', owner: '@sixam/play',
    replacement: 'package-owned winner/device-bundle emitter',
    removalGate: 'Bundle emitter no longer imports the tools tree and replay hashes match',
    notes: 'Still used by the bundle compiler, so removal is blocked until extraction.',
  },
  {
    id: 'device.policy-ir-module', path: 'packages/propose/bin/policy/policy-ir.mjs', category: 'policy',
    lifecycle: 'transitional', owner: '@sixam/propose',
    replacement: 'the policy-program contract in `@sixam/propose/policy` and the propose experiment emitter',
    removalGate: 'P3 policy vocabulary migration and fixed-seed artifact equivalence',
    notes: 'Compatibility policy builder retained while policy ownership moves out of tools.',
  },
  {
    id: 'research.stock-device-pilot', path: 'packages/propose/parked/minus7/stock-device-pilot.mjs', category: 'research',
    lifecycle: 'legacy', owner: '@sixam/propose',
    replacement: 'experiment spec/runner with an explicit historical actuator model',
    removalGate: 'Historical sweeps have structured, replayable experiment artifacts',
    notes: 'Retired swipe-era schedule report; it is not a selectable device route.',
  },
  {
    id: 'research.minus-toys-alias', path: 'packages/propose/bin/minustoystest.mjs', category: 'research-alias',
    lifecycle: 'compatibility', owner: '@sixam/propose',
    replacement: 'npm run research -- minus-toys',
    removalGate: 'Package structured artifacts and fixed-seed output are equivalent',
    notes: 'Compatibility alias for the propose package family evaluator (packages/propose/src/experiment/families/).',
  },
  {
    id: 'research.minus-two-alias', path: 'packages/propose/bin/minus2test.mjs', category: 'research-alias',
    lifecycle: 'compatibility', owner: '@sixam/propose',
    replacement: 'npm run research -- minus-two',
    removalGate: 'Package structured artifacts and fixed-seed output are equivalent',
    notes: 'Compatibility alias for the propose package family evaluator (packages/propose/src/experiment/families/).',
  },
  // ADR 0002's migration moved the contracts and Time into @sixam/kernel, each
  // game's mechanics into @sixam/source, the policy language and strategies into
  // @sixam/propose and the phone into @sixam/play. The compatibility shims left
  // in packages/core, packages/research and packages/adapters were removed on
  // 2026-09-30, when their removal gates held: no tracked module imported them,
  // and the records that name their paths are read through git history.
  // The FNaF 2 sensors CLAUDE.md discontinued on 2026-09-24/25 (the 20x9 grid,
  // grid-fitted rules, luma reducers) moved as they are: they are to be
  // converted to native-region rules, never extended.
  ...[
    ['monitor-rule', 'the grid-fitted monitor rule (monitor-rule-v1): map anchors read through the 20x9 GRID'],
    ['camera-rule', 'the grid-fitted camera rule (camera-rule-v1): watch pixels on the map buttons'],
    ['calibration-state-rule', 'the mask and monitor calibration-state rule (calibration-state-v1) over the grid cells, with its luma refutation'],
    ['button-strokes', 'the helper\'s downward-chevron stroke scores and their thresholds, the executor\'s mask and monitor tell'],
  ].map(([name, what]) => ({
    id: `play.sensor.fnaf2-${name}`, path: `packages/play/src/sensors/fnaf2/${name}.ts`, category: 'sensor',
    lifecycle: 'legacy', owner: '@sixam/play',
    replacement: 'a rule over native region pixels (the Companion REGION verb, packages/play/bin/phone/native-regions.mjs), recalibrated for FNaF 2',
    removalGate: 'FNaF 2\'s pipeline is recalibrated on native regions (ADR 0002 migration M7) and the campaign executor reads no grid, luma or grid-fitted rule; the retained grid_hex readers of old evidence stay',
    notes: `Deprecated: ${what}. Moved from packages/adapters unchanged; to be converted, not extended (CLAUDE.md, Sensors and on-device code).`,
  })),
  // The overnight window moved to apps/lab with the queue and the night jobs it
  // runs; a host's installed systemd units still name the old path in ExecStart.
  {
    id: 'lab.overnight-window-path', path: 'tools/device/overnight-window.py', category: 'host-unit-path',
    lifecycle: 'compatibility', owner: 'apps/lab',
    replacement: 'apps/lab/overnight-window.py, which renders its units from its own path',
    removalGate: 'Every host that installed the window\'s systemd units has re-rendered them from the new path ' +
      '(python3 apps/lab/overnight-window.py units --serial ID --out ~/.config/systemd/user, then systemctl --user daemon-reload), ' +
      'so no ExecStart names tools/device/overnight-window.py',
    notes: 'A thin forwarder: it execs apps/lab/overnight-window.py with every argument unchanged.',
  },
  {
    id: 'package.legacy-engine-command', path: 'package.json#scripts.test:legacy:engine', category: 'command',
    lifecycle: 'compatibility', owner: '@sixam/core',
    replacement: 'node tools/test.mjs --engine (canonical engine fixture lane)',
    removalGate: 'Bare-Node compatibility lane is no longer needed and P9 audit is green',
    notes: 'Retained package command for the old engine test entry point.',
  },
];

// Every committed winner's compiled winnerHash. compileBundle normalises a
// winner (it stamps the gate with the replay hash), so a pack can name a hash
// that is not the file's own stableHash; only Propose can compile, and Review
// never imports Propose (ADR 0002). So the catalog records the answer, CI's
// catalog diff keeps it current, and Review's trackedWinners() reads it, refusing
// when a winner file's bytes differ from the sha256 recorded here. Retired winners
// (bindings/<game>/retired/) are listed too, marked retired: a pack that ran one
// keeps its custody.
const { compileBundle } = await import(pathToFileURL(join(ROOT, 'packages/propose/bin/plans/bundle.mjs')).href);
const { custodyWinnerFiles } = await import(pathToFileURL(join(ROOT, 'packages/review/src/evidence-pack.ts')).href);
const winnerHashes = [];
for (const file of custodyWinnerFiles(ROOT)) {
  const bytes = await readFile(join(ROOT, file));
  const scratch = mkdtempSync(join(tmpdir(), 'winner-hashes-'));
  let compiledWinnerHash = null;
  let notCompiled;
  try { compiledWinnerHash = compileBundle(JSON.parse(bytes.toString('utf8')), join(scratch, 'bundle')).manifest.winnerHash; }
  catch (error) { notCompiled = error.message; }
  finally { rmSync(scratch, { recursive: true, force: true }); }
  winnerHashes.push({ file, sha256: createHash('sha256').update(bytes).digest('hex'),
    compiledWinnerHash, ...(notCompiled ? { notCompiled } : {}), ...(file.includes('/retired/') ? { retired: true } : {}) });
}

// The fact register's binding tables, for Review: the anchor aims registered
// per binding hash and the closed list of anchor bindings with no committed
// winner. The register is binding data a device run reads; Review never
// imports it, so its promotions query reads this generated copy. The register
// of fact producers itself is written beside them: it was generated by hand
// until 2026-09-30, and had gone three moves stale.
const factRegister = await import(pathToFileURL(join(ROOT, 'packages/propose/bindings/fact-register.mjs')).href);

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
  'anchor-aims.json': { schema: 'anchor-aims-v1', generatedFrom: 'packages/propose/bindings/fact-register.mjs (ANCHOR_AIMS, UNTRACKED_WINNER_DEBT)',
    anchorAims: factRegister.ANCHOR_AIMS, untrackedWinnerDebt: factRegister.UNTRACKED_WINNER_DEBT },
  'fact-register.json': factRegister.build(),
  'winner-hashes.json': { schema: 'winner-hashes-v1', generatedFrom: 'tools/generate-catalog.js (compileBundle over packages/propose/bindings/<game>/*-winner.json)',
    winners: winnerHashes },
  // The per-game control catalogs as data (LEG-007): every descriptor with its
  // aliases, action kinds, binding, preconditions and observation, and FNaF 2's
  // artifact action table. The validators are generated from the same objects.
  'control-catalog.json': { schema: 'control-catalog-register-v1',
    generatedFrom: 'packages/source/src/games/*/controls.ts', games: Object.values(CONTROL_CATALOGS) },
};
for (const [name, value] of Object.entries(outputs)) await writeFile(join(OUT, name), JSON.stringify(value, null, 2) + '\n');
console.log(`catalog: ${Object.keys(outputs).length} inventories (${sourceFiles.length} source files)`);
