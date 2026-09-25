/**
 * Architectural guardrails for the refactor. This is intentionally small and
 * deterministic: it protects package ownership while explicitly named legacy
 * device boundaries remain.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const rootPackage = JSON.parse(await readFile(join(ROOT, 'package.json')));
assert.deepEqual(rootPackage.workspaces, ['packages/*', 'apps/*']);
assert.equal(rootPackage.private, true);
assert.ok(rootPackage.scripts['device:campaign']);

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await files(path));
    else if (/\.(?:js|mjs|ts)$/.test(entry.name)) output.push(path);
  }
  return output;
}

// Keep the guard deterministic without depending on a parser/toolchain in the
// fast lane.  Strings/comments are removed before checking runtime globals so
// prose such as `const window = ...` does not create a false boundary failure.
function codeOnly(source) {
  return source
    .replace(/`(?:\\.|[^`\\])*`/gs, template =>
      [...template.matchAll(/\$\{([\s\S]*?)\}/g)].map(match => match[1]).join('\n'))
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/gs, '')
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
}

function importSpecifiers(source) {
  return [...source.matchAll(/\b(?:from|import)\s*(?:\(\s*)?['"]([^'"]+)['"]/g)]
    .map(match => match[1]);
}

const forbiddenCoreGlobal = /\b(?:document|window|fetch|process|globalThis|performance)\b/;
const forbiddenCoreNames = ['document', 'window', 'fetch', 'process', 'globalThis', 'performance'];
const unboundCoreCode = source => {
  const code = codeOnly(source);
  const bindings = [...code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)]
    .map(match => match[1]).filter(name => forbiddenCoreNames.includes(name));
  return bindings.length
    ? code.replace(new RegExp(`\\b(?:${[...new Set(bindings)].join('|')})\\b`, 'g'), '')
    : code;
};
assert.match(unboundCoreCode('const host = window;'), forbiddenCoreGlobal,
  'architecture guard must recognize host-global access in module bodies');
assert.doesNotMatch(unboundCoreCode('const window = 1; return window;'), forbiddenCoreGlobal,
  'architecture guard must not mistake a local binding for a host global');
assert.match(unboundCoreCode('const host = `${window}`;'), forbiddenCoreGlobal,
  'architecture guard must inspect template interpolations');

const core = await files(join(ROOT, 'packages/core/src'));
const legacyCatalog = JSON.parse(await readFile(join(ROOT, 'docs/architecture/generated/legacy-paths.json'), 'utf8'));
assert.equal(legacyCatalog.schema, 'legacy-path-map-v1');
assert.ok(Array.isArray(legacyCatalog.entries) && legacyCatalog.entries.length > 0,
  'legacy path catalog must contain migration entries');
for (const entry of legacyCatalog.entries) {
  assert.match(entry.id, /^[a-z0-9][a-z0-9.-]+$/,
    'legacy path entries need stable ids');
  assert.ok(['compatibility', 'transitional', 'legacy'].includes(entry.lifecycle),
    `${entry.id} has an invalid lifecycle`);
  assert.equal(typeof entry.replacement, 'string');
  assert.ok(entry.replacement.length > 0, `${entry.id} has no replacement owner`);
  assert.equal(typeof entry.removalGate, 'string');
  assert.ok(entry.removalGate.length > 0, `${entry.id} has no removal gate`);
  const target = entry.path.split('#', 1)[0];
  assert.ok(target && !target.startsWith('/') && !target.includes('..'),
    `${entry.id} has an unsafe path`);
  try {
    await readFile(join(ROOT, target));
  } catch (error) {
    assert.fail(`${entry.id} points at missing path ${entry.path}: ${error.message}`);
  }
}
// The checked-in inventories describe the REPOSITORY, and a directory walk
// cannot tell that from the working directory it happens to run in. On
// 2026-09-02 an agent worktree under `.claude/` was walked into three of them
// and doubled every count (Shell 63 -> 126 files), so the catalogs asserted
// code that is not in this repository. git already draws the line -- it
// reports a nested checkout as one opaque directory entry -- so its
// enumeration is the authority here.
const enumerated = new Set(execFileSync('git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean));
const catalogPaths = {
  'import-graph.json': catalog => catalog.files.map(entry => entry.file),
  'test-manifest.json': catalog => catalog.tests.map(entry => entry.id),
  'reverse-links.json': catalog => catalog.links.map(link => link.path),
};
for (const [name, select] of Object.entries(catalogPaths)) {
  const catalog = JSON.parse(await readFile(join(ROOT, 'docs/architecture/generated', name), 'utf8'));
  const foreign = [...new Set(select(catalog)
    .map(path => path.split('#', 1)[0])
    .filter(path => !enumerated.has(path)))].sort();
  assert.deepEqual(foreign, [],
    `${name} names ${foreign.length} path(s) outside this repository, starting ` +
    `with ${foreign[0]}; regenerate with npm run catalog`);
}
try {
  const rootSrc = await readdir(join(ROOT, 'src'));
  assert.equal(rootSrc.length, 0, 'root src must remain empty after P9 shim removal');
} catch (error) {
  assert.equal(error.code, 'ENOENT');
}
for (const path of core) {
  const source = await readFile(path, 'utf8');
  const imports = importSpecifiers(source);
  assert.ok(!imports.some(spec => spec.startsWith('node:') ||
    /^@fnaf2-1020\/(?:adapters|device|trainer)/.test(spec)),
  `${path} crosses the core package boundary`);
  assert.doesNotMatch(unboundCoreCode(source), forbiddenCoreGlobal,
    `${path} uses a host/browser global in core`);
}
const research = await files(join(ROOT, 'packages/research/src'));
for (const path of research) {
  const source = await readFile(path, 'utf8');
  const imports = importSpecifiers(source);
  assert.ok(!imports.some(spec => spec.includes('tools/device') || spec.includes('apps/device') ||
    spec === '@fnaf2-1020/device' ||
    spec === 'node:child_process' || spec === 'node:net' || spec === 'node:dgram'),
  `${path} imports a device-shell boundary directly`);
}
const production = await files(join(ROOT, 'packages'));
for (const path of production) {
  const source = await readFile(path, 'utf8');
  assert.doesNotMatch(source, /from ['"][^'"]*(?:test|report)[^'"]*['"]/, `${path} imports a test/report module`);
}
const operational = [
  ...production,
  ...await files(join(ROOT, 'apps')),
  ...await files(join(ROOT, 'tools')),
].filter(path => !/(?:^|\/)test[^/]*\.(?:js|mjs|ts)$/.test(path) &&
                !/(?:^|\/)report[^/]*\.(?:js|mjs|ts)$/.test(path));
for (const path of operational) {
  const source = await readFile(path, 'utf8');
  // `apps/trainer/src/report.js` is presentation code, not a report harness;
  // only test-named modules are forbidden across operational boundaries.
  assert.doesNotMatch(source, /(?:from\s+|import\s*\()['"][^'"]*(?:^|\/|[-_.])test[^'"]*['"]/i, `${path} imports a test module`);
  assert.doesNotMatch(source, /\bSEARCH_KNOBS(?:\s*\.\s*[A-Za-z_$][\w$]*|\s*\[[^\]]+\])\s*=/, `${path} mutates a process-global search knob`);
}
// The HID transport presses the phone. Only the device runners compose it:
// the FNaF 2 campaign ports, the three FNaF 1 runners, the FNaF 3 and FNaF 4
// night runners and the one-step explorer, each behind its own lease and
// --confirm-live. A
// new composer is a new way onto the phone and has to be named here in the
// diff that adds it.
const physicalActuatorOwners = new Set(['apps/device/src/modern-campaign-ports.js',
  'tools/device/fnaf1-night-run.mjs', 'tools/device/fnaf1-custom-run.mjs', 'tools/device/fnaf1-menu-probe.mjs',
  'tools/device/fnaf3-run.mjs', 'tools/device/fnaf4-run.mjs', 'tools/device/explore-step.mjs']
  .map(path => join(ROOT, path)));
for (const path of [...await files(join(ROOT, 'apps')), ...await files(join(ROOT, 'tools'))]
  .filter(path => !/(?:^|\/)test[^/]*\.(?:js|mjs|ts)$/.test(path) &&
                  !/(?:^|\/)report[^/]*\.(?:js|mjs|ts)$/.test(path) &&
                  path !== fileURLToPath(import.meta.url))) {
  const source = await readFile(path, 'utf8');
  if (!physicalActuatorOwners.has(path) && /\bHidWireTransport\b/.test(codeOnly(source)))
    assert.fail(`${path} reaches the HID transport outside the device runners`);
}
const cli = await readFile(join(ROOT, 'apps/device/src/cli.js'), 'utf8');
// The campaign is the only command that touches a phone; its live branch must
// keep refusing without the explicit confirmation.
assert.match(cli, /if \(!options\.confirmLive\) throw new Error\('live campaign requires --confirm-live'\);/,
  'device live execution lost its explicit confirmation gate');
// No second way onto the phone: the generic `live` command and the fixture
// service behind it were retired on 2026-09-25, and must not come back as a
// path around the campaign's gates.
const commands = cli.match(/const knownCommands = new Set\(\[([^\]]*)\]\)/)?.[1] ?? '';
assert.ok(commands && !/'(live|dry-run|calibrate)'/.test(commands),
  'device CLI must not regain a live command outside the campaign');
console.log(`architecture: ${core.length} core modules and ${production.length} package modules obey boundary checks`);
