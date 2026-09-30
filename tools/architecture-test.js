/**
 * Architectural guardrails for the refactor. This is intentionally small and
 * deterministic: it protects package ownership while explicitly named legacy
 * device boundaries remain.
 *
 * Every import check reads the module's syntax tree through the pinned
 * `typescript` parser (LEG-011, 2026-09-29), not regexes over its text. A
 * module reference is a static import, any re-export (`export * as x from`,
 * `export { a as b } from`), a dynamic `import()` with a string or template
 * specifier, a `require()` call, `import x = require()` and a TS import type.
 * A dynamic import whose specifier is computed cannot be checked, so a guarded
 * package refuses it. The regex guard it replaces found imports in comments
 * and strings, and let `import(\`...\`)` through. The planted fixtures below run
 * first and must be caught, or the guard fails.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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

// --- Reading a module's syntax tree ----------------------------------------

/** @param {string} path repository-relative @param {string} source */
function parse(path, source) {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true,
    path.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
}

/**
 * Every module the file loads or re-exports. `specifier` is null when the
 * parser cannot know it (a computed dynamic import or require).
 * @param {ts.SourceFile} file
 * @returns {{specifier: string | null, form: string}[]}
 */
function moduleReferences(file) {
  const found = [];
  const literal = node => node && ts.isStringLiteralLike(node) ? node.text : null;
  const visit = node => {
    if (ts.isImportDeclaration(node)) found.push({ specifier: literal(node.moduleSpecifier), form: 'import' });
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier)
      found.push({ specifier: literal(node.moduleSpecifier), form: 're-export' });
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
      found.push({ specifier: literal(node.moduleReference.expression), form: 'import-equals' });
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      found.push({ specifier: literal(node.argument.literal), form: 'import-type' });
    else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword)
        found.push({ specifier: literal(node.arguments[0]), form: 'dynamic-import' });
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'require')
        found.push({ specifier: literal(node.arguments[0]), form: 'require' });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Is this identifier read as a value, rather than naming a property, a member or a declaration? */
function isReference(node) {
  const parent = node.parent;
  if (!parent) return true;
  if ((ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) && parent.name === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) ||
       ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent) ||
       ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) && parent.name === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent) ||
      ts.isNamespaceImport(parent) || ts.isNamespaceExport(parent)) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  return true;
}

/** Names the file binds anywhere: a declared `window` shadows the global in this heuristic, as before. */
function declaredNames(file) {
  const names = new Set();
  const visit = node => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node) ||
         ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isFunctionExpression(node) ||
         ts.isClassExpression(node)) && node.name && ts.isIdentifier(node.name)) names.add(node.name.text);
    if ((ts.isImportSpecifier(node) || ts.isNamespaceImport(node) || ts.isImportClause(node)) && node.name)
      names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

/** @param {ts.SourceFile} file @param {(node: ts.Identifier) => boolean} test */
function identifiers(file, test) {
  const found = [];
  const visit = node => {
    if (ts.isIdentifier(node) && test(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const HOST_GLOBALS = ['document', 'window', 'fetch', 'process', 'globalThis', 'performance'];
/** Host or browser globals a core module reads. @param {ts.SourceFile} file */
function hostGlobals(file) {
  const declared = declaredNames(file);
  return [...new Set(identifiers(file, node => HOST_GLOBALS.includes(node.text) && !declared.has(node.text) &&
    isReference(node)).map(node => node.text))];
}

/**
 * Ambient entropy a core module reads: `Math.random()`, `Date.now()` and an
 * argument-less `new Date()`. A model, a policy or an estimator that draws one
 * gives two runs of the same input two answers, and a replay cannot reproduce
 * it; time comes from the kernel's clocks and randomness from the game's seeded
 * generator. `new Date(x)` is a pure conversion and passes.
 * @param {ts.SourceFile} file
 */
function ambientEntropy(file) {
  const found = [];
  const named = (node, object, property) => ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) && node.expression.text === object && node.name.text === property;
  const visit = node => {
    if (ts.isCallExpression(node) && named(node.expression, 'Math', 'random')) found.push('Math.random()');
    else if (ts.isCallExpression(node) && named(node.expression, 'Date', 'now')) found.push('Date.now()');
    else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Date' &&
      !(node.arguments?.length)) found.push('new Date()');
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

// Each tolerated draw, with its count so a tolerated file cannot gain another.
// These are defaults for a caller that passes nothing; the fix is to make the
// caller say where its seed or clock comes from.
const AMBIENT_ENTROPY_TOLERATED = new Map([
  ['packages/source/src/games/fnaf2/plant-options.js', { count: 1,
    why: 'an unseeded Sim draws a natural seed; every census and gate passes its seed' }],
  ['packages/source/src/games/fnaf2/rng.js', { count: 1,
    why: 'the generator\'s default seed for an unseeded Sim; the same default as plant-options.js' }],
  ['packages/play/src/venues/sim/observer.js', { count: 2,
    why: 'the Sim observer\'s noise falls back to Math.random() when no generator is given: a silent fallback to remove' }],
]);

/** Writes into the process-global search knobs. @param {ts.SourceFile} file */
function searchKnobWrites(file) {
  let writes = 0;
  const onKnobs = node => (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
    ts.isIdentifier(node.expression) && node.expression.text === 'SEARCH_KNOBS';
  const visit = node => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && onKnobs(node.left)) writes += 1;
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator) && onKnobs(node.operand))
      writes += 1;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return writes;
}

// --- Where a reference lands -------------------------------------------------

const WORKSPACES = new Map();
for (const group of ['packages', 'apps']) {
  for (const entry of await readdir(join(ROOT, group), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(await readFile(join(ROOT, group, entry.name, 'package.json'), 'utf8'));
      WORKSPACES.set(manifest.name, `${group}/${entry.name}`);
    } catch { /* a folder without a package.json is not a workspace */ }
  }
}
const BUILTINS = new Set(builtinModules);
const unitOf = path => {
  const [top, next] = path.split('/');
  return (top === 'packages' || top === 'apps') && next ? `${top}/${next}` : top;
};

/**
 * The repository unit a reference lands in: a workspace directory
 * (`packages/core`, `apps/device`), a top-level directory (`tools`), `builtin`,
 * `external`, `outside` the repository, or `UNRESOLVED`.
 * @param {string} from repository-relative path of the importing file
 * @param {string | null} specifier
 */
function landing(from, specifier) {
  if (specifier === null) return { unit: 'UNRESOLVED', target: null };
  if (specifier.startsWith('node:') || BUILTINS.has(specifier.split('/')[0]))
    return { unit: 'builtin', target: specifier.startsWith('node:') ? specifier : `node:${specifier}` };
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const target = relative(ROOT, resolve(ROOT, dirname(from), specifier)).split(sep).join('/');
    return target.startsWith('..') ? { unit: 'outside', target } : { unit: unitOf(target), target };
  }
  const name = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
  if (WORKSPACES.has(name)) {
    const dir = WORKSPACES.get(name);
    return { unit: dir, target: `${dir}${specifier.slice(name.length)}` };
  }
  return { unit: name.startsWith('@sixam/') ? name : 'external', target: specifier };
}

// --- The dependency rule -------------------------------------------------------

/**
 * One rule per guarded area. `scope` picks the files, `refuse(reference, path)`
 * a reference that crosses the boundary. ADR 0002: `kernel <- source <- play <-
 * propose -> review -> source`; in today's names review is packages/review,
 * propose is packages/propose, source is packages/source, and play is
 * packages/play (@sixam/play: the phone, its venues, the campaign, the Sim
 * observer, the player's estimator, the phase clock and the deprecated FNaF 2
 * sensors). Play imports only the kernel and source. Nothing imports propose
 * but the applications, and nothing imports play but propose and the
 * applications. The compatibility shims packages/core, packages/research and
 * packages/adapters were removed on 2026-09-30, when their removal gates held.
 */
const legacyCatalog = JSON.parse(await readFile(join(ROOT, 'docs/architecture/generated/legacy-paths.json'), 'utf8'));
const PLAY_READS = ['packages/play', 'packages/kernel', 'packages/source', 'builtin'];
const DEVICE_SHELL = ['node:child_process', 'node:net', 'node:dgram'];
const PROPOSE_READS = ['packages/propose', 'packages/kernel', 'packages/source', 'packages/play', 'packages/review', 'builtin'];
// Propose command lines that import a module whose path is computed, each with why it cannot be written down.
const COMPUTED_IMPORTS = new Map([
  ['packages/propose/bin/census/fnaf1-device-lane.mjs', 'grid420 as a winner\'s pinned commit holds it, from the ' +
    'temporary tree fnaf1-winner.mjs materializes and checks file by file'],
  ['packages/propose/bin/census/pool-worker.mjs', 'the task module a pool.mjs batch names, held for the life of the worker'],
  ['packages/propose/bin/census/pool.mjs', 'the same task module, imported in-process when the pool runs serially'],
  ['packages/propose/bin/recompile/pilot/batch.mjs', 'the game\'s pilot module (./fnaf3.mjs or ./fnaf4.mjs) that --game names'],
  ['packages/propose/bin/recompile/pilot/pilot.mjs', 'the game\'s pilot module (./fnaf3.mjs or ./fnaf4.mjs) that --game names'],
  ['packages/propose/bin/recompile/pilot/replay.mjs', 'the game\'s pilot module (./fnaf3.mjs or ./fnaf4.mjs) that --game names'],
  ['packages/propose/bin/recompile/pilot/search.mjs', 'the game\'s pilot module (./fnaf3.mjs or ./fnaf4.mjs) that --game names'],
]);
const RULES = [
  {
    id: 'kernel', scope: path => path.startsWith('packages/kernel/src/'),
    refuse: ref => ref.unit !== 'packages/kernel',
    why: 'the kernel imports nothing: no workspace, no repository path, no Node built-in, no dependency (ADR 0002); every package may import it',
  },
  {
    id: 'kernel-test', scope: path => path.startsWith('packages/kernel/') && !path.startsWith('packages/kernel/src/'),
    refuse: ref => !['packages/kernel', 'builtin'].includes(ref.unit),
    why: 'kernel tests import only the kernel and Node built-ins',
  },
  {
    id: 'source', scope: path => path.startsWith('packages/source/src/'),
    refuse: ref => !['packages/source', 'packages/kernel'].includes(ref.unit),
    why: 'source imports only itself and the kernel (ADR 0002): no core, application, adapter, research, review, tools module, host API or dependency',
  },
  {
    id: 'source-test', scope: path => path.startsWith('packages/source/') && !path.startsWith('packages/source/src/'),
    refuse: ref => !['packages/source', 'packages/kernel', 'builtin'].includes(ref.unit),
    why: 'source tests import only source, the kernel and Node built-ins',
  },
  {
    id: 'play', scope: path => path.startsWith('packages/play/src/'),
    refuse: ref => !PLAY_READS.includes(ref.unit),
    why: 'play imports only itself, the kernel, source and Node built-ins (ADR 0002): no core, propose, review, research, application, tools module, dependency or computed import',
  },
  {
    id: 'play-test', scope: path => path.startsWith('packages/play/') && !path.startsWith('packages/play/src/'),
    refuse: ref => !PLAY_READS.includes(ref.unit),
    why: 'play tests import only play, the kernel, source and Node built-ins',
  },
  {
    id: 'propose', scope: path => path.startsWith('packages/propose/src/'),
    refuse: ref => !PROPOSE_READS.includes(ref.unit) || DEVICE_SHELL.includes(ref.target ?? ''),
    why: 'propose imports itself, the kernel, source, play and review (ADR 0002), ' +
      'never the device shell (apps, tools, child_process, net, dgram)',
  },
  {
    id: 'propose-bin', scope: path => path.startsWith('packages/propose/') && !path.startsWith('packages/propose/src/') &&
      !path.startsWith('packages/propose/test/'),
    refuse: (ref, path) => !PROPOSE_READS.includes(ref.unit) && !(ref.unit === 'UNRESOLVED' && COMPUTED_IMPORTS.has(path)),
    why: 'propose\'s command lines and parked work import what propose may and Node built-ins, a child process ' +
      'included; never an application, tools/ or a computed import outside COMPUTED_IMPORTS',
  },
  {
    id: 'propose-test', scope: path => path.startsWith('packages/propose/test/'),
    refuse: ref => !PROPOSE_READS.includes(ref.unit),
    why: 'propose tests import propose, what propose may import, and Node built-ins',
  },
  {
    id: 'propose-importers', scope: path => path.startsWith('packages/') && !path.startsWith('packages/propose/'),
    refuse: ref => ref.unit === 'packages/propose',
    why: 'nothing imports propose except the applications (ADR 0002)',
  },
  {
    id: 'play-importers', scope: path => path.startsWith('packages/') && !path.startsWith('packages/play/') && !path.startsWith('packages/propose/'),
    refuse: ref => ref.unit === 'packages/play',
    why: 'nothing imports play except propose and the applications (ADR 0002)',
  },
  {
    id: 'review', scope: path => path.startsWith('packages/review/'),
    refuse: ref => ['UNRESOLVED', 'packages/play', 'packages/propose'].includes(ref.unit) ||
      ref.unit.startsWith('apps/'),
    why: 'review never imports play or propose (ADR 0002): no packages/play, packages/propose or application',
  },
];

/**
 * Every boundary a file crosses.
 * @param {string} path repository-relative
 * @param {ts.SourceFile} file
 */
function violations(path, file) {
  const found = [];
  const references = moduleReferences(file).map(reference => ({ ...reference, ...landing(path, reference.specifier) }));
  for (const rule of RULES.filter(item => item.scope(path)))
    for (const reference of references.filter(item => rule.refuse(item, path)))
      found.push({ rule: rule.id, why: rule.why, reference });
  return found;
}
const describe = (path, found) => found.map(({ rule, why, reference }) =>
  `${path} crosses the ${rule} boundary with ${reference.form} ${JSON.stringify(reference.specifier)} ` +
  `(lands in ${reference.unit}): ${why}`).join('\n');

// --- Planted violations: each must be caught, or the guard measures nothing ---

const planted = (path, source) => violations(path, parse(path, source)).map(item => item.rule);
const REVIEW = 'packages/review/src/planted.mjs';
// A dynamic import() is an import, however its specifier is written.
assert.deepEqual(planted(REVIEW, "export const load = () => import('../../../apps/device/src/campaign.js');"), ['review'],
  'the guard must catch a dynamic import() of the device app');
assert.deepEqual(planted(REVIEW, 'export const load = () => import(`@sixam/propose`);'), ['propose-importers', 'review'],
  'the guard must catch a dynamic import() written with a template literal');
assert.deepEqual(planted(REVIEW, "const where = '@sixam/play';\nexport const load = () => import(where);"), ['review'],
  'the guard must refuse a dynamic import() it cannot resolve');
// An alias is still an import: aliased and namespace re-exports, namespace imports, require.
assert.deepEqual(planted(REVIEW, "export { validateCampaignResult as validate } from '../../../apps/device/src/campaign.js';"),
  ['review'], 'the guard must catch an aliased re-export');
assert.deepEqual(planted(REVIEW, "export * as phone from '@sixam/play/phone/night-onset';"), ['play-importers', 'review'],
  'the guard must catch a namespace re-export');
assert.deepEqual(planted(REVIEW, "import * as seeds from '@sixam/propose/seeds';\nexport const s = seeds;"), ['propose-importers', 'review'],
  'the guard must catch a namespace import');
assert.deepEqual(planted(REVIEW, "import { createRequire } from 'node:module';\nconst load = createRequire(import.meta.url);\n" +
  "const require = load;\nexport const device = require('@sixam/desktop/package.json');"), ['review'],
'the guard must catch a require() through createRequire');
// Text that only looks like an import is not one.
assert.deepEqual(planted(REVIEW, "// import('../../../apps/device/src/cli.js')\nexport const text = \"from '@sixam/research'\";"), [],
  'the guard must not read comments or strings as imports');
assert.deepEqual(planted(REVIEW, "import { stableHash } from '@sixam/kernel/contracts';\nexport const h = stableHash;"), [],
  'review may import the kernel');
// The kernel imports nothing, and everything may import it.
const KERNEL = 'packages/kernel/src/planted.js';
assert.deepEqual(planted(KERNEL, "import { stableHash } from '@sixam/core/contracts';"), ['kernel'],
  'the kernel must not import core');
assert.deepEqual(planted(KERNEL, "import { readFileSync } from 'node:fs';"), ['kernel'],
  'the kernel must not import a Node built-in');
assert.deepEqual(planted(KERNEL, "export const load = () => import('../../review/src/pack-lift.mjs');"), ['kernel'],
  'the kernel must not reach another package by a relative dynamic import');
assert.deepEqual(planted(KERNEL, "export * from './labels.js';"), [], 'the kernel may import itself');
assert.deepEqual(planted('packages/kernel/test/planted.test.js',
  "import assert from 'node:assert/strict';\nimport { unknown } from '../src/index.js';"), [], 'a kernel test may import the kernel and node:');
assert.deepEqual(planted('packages/kernel/test/planted.test.js', "import { readPack } from '@sixam/review/evidence-pack';"),
  ['kernel-test'], 'a kernel test must not import review');
assert.deepEqual(planted(REVIEW, "import { unknown } from '@sixam/kernel';"), [], 'review may import the kernel');
// Source imports only the kernel (ADR 0002), and core may import source.
const SOURCE = 'packages/source/src/planted.js';
assert.deepEqual(planted(SOURCE, "import { stableHash } from '@sixam/kernel/contracts';"), [], 'source may import the kernel');
assert.deepEqual(planted(SOURCE, "export * from './clockwork/index.js';"), [], 'source may import itself');
assert.deepEqual(planted(SOURCE, "import { NightPolicy } from '@sixam/core/control';"), ['source'],
  'source must not import core');
assert.deepEqual(planted(SOURCE, "export const load = () => import('../../core/src/sensing/observer.js');"), ['source'],
  'source must not reach core by a relative dynamic import');
assert.deepEqual(planted(SOURCE, "import { readFileSync } from 'node:fs';"), ['source'], 'source must not import a Node built-in');
assert.deepEqual(planted('packages/source/test/planted.test.js', "import { Sim } from '@sixam/core/mechanics';"), ['source-test'],
  'a source test must not import core');
// Propose (ADR 0002) imports the kernel, source, play's host-free half in core
// and review, never the device shell; nothing imports it but the applications
// and the registered compatibility shims, which may only re-export it.
const PROPOSE = 'packages/propose/src/planted.js';
assert.deepEqual(planted(PROPOSE, "import { Observer } from '@sixam/play/sim';\nimport { Sim } from '@sixam/source/fnaf2';\n" +
  "import { stableHash } from '@sixam/kernel/contracts';\nimport { readPack } from '@sixam/review/evidence-pack';\n" +
  "import { createHash } from 'node:crypto';"), [], 'propose may import play, source, the kernel, review and node:');
assert.deepEqual(planted(PROPOSE, "import { Observer } from '@sixam/core/sensing';"), ['propose'],
  'propose must not import core, whose Play subpath is only a shim over play');
assert.deepEqual(planted(PROPOSE, "import { spawn } from 'node:child_process';"), ['propose'], 'propose must not reach the device shell');
assert.deepEqual(planted(PROPOSE, "import { cli } from '@sixam/desktop';"), ['propose'], 'propose must not import the composition root');
assert.deepEqual(planted('packages/play/src/planted.js', "import { createLab } from '@sixam/desktop/package.json';"), ['play'],
  'play must not import the composition root');
assert.deepEqual(planted(PROPOSE, "export const load = () => import('../../../tools/device/bundle.mjs');"), ['propose'],
  'propose must not reach tools/, even by a dynamic import');
assert.deepEqual(planted(PROPOSE, "import { NightPolicy } from '@sixam/core/control';"), ['propose'],
  'propose must not import the core shim that re-exports it');
assert.deepEqual(planted('packages/propose/test/planted.test.js',
  "import { spawn } from 'node:child_process';\nimport { NightPolicy } from '@sixam/propose/fnaf2';"), [],
'a propose test may import propose and node:');
// Its command lines (bin/, parked/) run censuses in child processes; they still stay out of the applications.
const PROPOSE_BIN = 'packages/propose/bin/planted.mjs';
assert.deepEqual(planted(PROPOSE_BIN, "import { fork } from 'node:child_process';"), [], 'a propose command line may fork');
assert.deepEqual(planted(PROPOSE_BIN, "import { cli } from '@sixam/desktop';"), ['propose-bin'],
  'a propose command line must not import the composition root');
assert.deepEqual(planted(PROPOSE_BIN, "export const load = (where) => import(where);"), ['propose-bin'],
  'a propose command line must not import a computed path unless COMPUTED_IMPORTS names it');
assert.deepEqual(planted('packages/play/src/planted.js', "import { NightPolicy } from '@sixam/propose';"),
  ['play', 'propose-importers'], 'play must not import propose');
// Play (ADR 0002) imports itself, the kernel, source and Node built-ins; nothing
// imports it but propose, the applications and its registered shims, which may
// only re-export it.
const PLAY = 'packages/play/src/planted.js';
assert.deepEqual(planted(PLAY, "import { stableHash } from '@sixam/kernel/contracts';\nimport { Sim } from '@sixam/source/fnaf2';\n" +
  "import { spawn } from 'node:child_process';\nexport * from './phone/clocks.js';"), [],
'play may import itself, the kernel, source and node:');
assert.deepEqual(planted(PLAY, "import { readPack } from '@sixam/review/evidence-pack';"), ['play'], 'play must not import review');
assert.deepEqual(planted(PLAY, "import { Observer } from '@sixam/core/sensing';"), ['play'], 'play must not import core');
assert.deepEqual(planted(PLAY, "export const load = () => import('../../../tools/device/bundle.mjs');"), ['play'],
  'play must not reach tools/, even by a dynamic import');
assert.deepEqual(planted(PLAY, "export { cli } from '../../../apps/desktop/src/lab.mjs';"), ['play'], 'play must not import an application');
assert.deepEqual(planted(PLAY, "const where = './phone/clocks.js';\nexport const load = () => import(where);"), ['play'],
  'play must refuse a dynamic import() it cannot resolve');
assert.deepEqual(planted('packages/play/test/planted.test.js', "import assert from 'node:assert/strict';\n" +
  "import { HID_DESCRIPTOR } from '@sixam/play';\nimport { AI_DIALS } from '@sixam/source/fnaf2';"), [],
'a play test may import play, source and node:');
assert.deepEqual(planted('packages/play/test/planted.test.js', "import { NightPolicy } from '@sixam/propose/fnaf2';"),
  ['play-test', 'propose-importers'], 'a play test must not import propose');
assert.deepEqual(planted(PROPOSE, "import { HID_DESCRIPTOR } from '@sixam/play';"), [], 'propose may import play');
assert.deepEqual(planted(SOURCE, "import { HID_DESCRIPTOR } from '@sixam/play';"), ['source', 'play-importers'],
  'source must not import play');
assert.deepEqual(planted(REVIEW, "import { HID_DESCRIPTOR } from '@sixam/play';"), ['play-importers', 'review'],
  'review must not import play');
assert.deepEqual(planted(REVIEW, "export const load = () => import('../../../apps/desktop/src/lab.mjs');"), ['review'],
  'review must not import an application');
assert.deepEqual(planted(REVIEW, "import { NightPolicy } from '@sixam/propose';"), ['propose-importers', 'review'],
  'review must not import propose');
const globalsOf = source => hostGlobals(parse('packages/source/src/planted.js', source));
assert.deepEqual(globalsOf('const host = window;'), ['window'],
  'architecture guard must recognize host-global access in module bodies');
assert.deepEqual(globalsOf('const window = 1; export const again = window;'), [],
  'architecture guard must not mistake a local binding for a host global');
assert.deepEqual(globalsOf('const host = `${window}`;'), ['window'],
  'architecture guard must inspect template interpolations');
assert.deepEqual(globalsOf('export const read = state => state.window + state.process;'), [],
  'architecture guard must not mistake a property for a host global');
const entropyOf = source => ambientEntropy(parse('packages/source/src/planted.js', source));
assert.deepEqual(entropyOf('export const roll = () => Math.random() < 0.5;'), ['Math.random()'],
  'architecture guard must catch Math.random() in a core module');
assert.deepEqual(entropyOf('export const stamp = () => [Date.now(), new Date()];'), ['Date.now()', 'new Date()'],
  'architecture guard must catch the wall clock in a core module');
assert.deepEqual(entropyOf('// Math.random()\nexport const at = ms => new Date(ms); const r = rng.random();'), [],
  'architecture guard must pass comments, a converted timestamp and a seeded generator');
assert.equal(searchKnobWrites(parse('tools/planted.mjs', 'SEARCH_KNOBS.maskMs = 3; SEARCH_KNOBS[key] += 1;')), 2);
assert.equal(searchKnobWrites(parse('tools/planted.mjs', '// SEARCH_KNOBS.maskMs = 3\nconst copy = { ...SEARCH_KNOBS };')), 0);

// --- The tree ------------------------------------------------------------------

const parsed = new Map();
const tree = async path => {
  if (!parsed.has(path)) parsed.set(path, parse(relative(ROOT, path).split(sep).join('/'), await readFile(path, 'utf8')));
  return parsed.get(path);
};
const repoPath = path => relative(ROOT, path).split(sep).join('/');

// Source, the kernel and propose's policy language and game policies came out
// of the retired packages/core and keep its host-global rule, and so do the
// modules that left it for play (the Sim observer, the
// player's estimator, the phase clock), review (the bench trace) and the
// trainer (training).
const hostFree = [...await files(join(ROOT, 'packages/source/src')), ...await files(join(ROOT, 'packages/kernel/src')),
  ...await files(join(ROOT, 'packages/propose/src/policy')), ...await files(join(ROOT, 'packages/propose/src/games')),
  ...await files(join(ROOT, 'packages/play/src/venues/sim')), ...await files(join(ROOT, 'packages/play/src/player')),
  ...await files(join(ROOT, 'packages/play/src/clocks')), ...await files(join(ROOT, 'packages/review/src/measure')),
  ...await files(join(ROOT, 'apps/trainer/src/training'))];
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
const production = await files(join(ROOT, 'packages'));
for (const path of production) {
  const file = await tree(path);
  const found = violations(repoPath(path), file);
  assert.equal(found.length, 0, describe(repoPath(path), found));
  // A package's own test folder is not production: its tests may load
  // `node:test` and their fixtures (the device app's tests moved into
  // packages/play/test with ADR 0002's Play move). Its boundary rules still hold.
  if (/^packages\/[^/]+\/test\//.test(repoPath(path))) continue;
  const reports = moduleReferences(file).filter(ref => ref.specifier !== null && /(?:test|report)/.test(ref.specifier));
  assert.equal(reports.length, 0, `${path} imports a test/report module: ${reports.map(ref => ref.specifier).join(', ')}`);
}
for (const path of hostFree) {
  const globals = hostGlobals(await tree(path));
  assert.equal(globals.length, 0, `${path} uses a host/browser global in core, source, the kernel or propose's policy and game modules: ${globals.join(', ')}`);
  const entropy = ambientEntropy(await tree(path));
  const tolerated = AMBIENT_ENTROPY_TOLERATED.get(repoPath(path));
  assert.equal(entropy.length, tolerated?.count ?? 0, tolerated
    ? `${repoPath(path)} is tolerated ${tolerated.count} ambient draw(s) (${tolerated.why}) and has ${entropy.length}: ` +
      'update AMBIENT_ENTROPY_TOLERATED only to lower the count'
    : `${repoPath(path)} reads ambient entropy in a module that must be replayable: ${entropy.join(', ')}. ` +
      'Take time from the kernel clocks and randomness from a seeded generator the caller passes');
}
for (const path of AMBIENT_ENTROPY_TOLERATED.keys())
  assert.ok(hostFree.some(file => repoPath(file) === path), `AMBIENT_ENTROPY_TOLERATED names ${path}, which is not a host-free module`);
// A test is a test-named file, or a `*.test.*` file in a package's or an
// application's test folder (apps/desktop/test loads package fixtures).
const testNamed = path => /(?:^|\/)test[^/]*\.(?:js|mjs|ts)$/.test(path) || /\/test\/[^/]+\.test\.m?js$/.test(path);
const reportNamed = path => /(?:^|\/)report[^/]*\.(?:js|mjs|ts)$/.test(path);
const operational = [
  ...production,
  ...await files(join(ROOT, 'apps')),
  ...await files(join(ROOT, 'tools')),
].filter(path => !testNamed(path) && !reportNamed(path));
for (const path of operational) {
  const file = await tree(path);
  // `apps/trainer/src/report.js` is presentation code, not a report harness;
  // only test-named modules are forbidden across operational boundaries.
  const tests = moduleReferences(file).filter(ref => ref.specifier !== null && /(?:^|\/|[-_.])test/i.test(ref.specifier));
  assert.equal(tests.length, 0, `${path} imports a test module: ${tests.map(ref => ref.specifier).join(', ')}`);
  assert.equal(searchKnobWrites(file), 0, `${path} mutates a process-global search knob`);
}
// The HID transport presses the phone. Only the device runners compose it:
// the FNaF 2 campaign ports, the three FNaF 1 runners, the FNaF 3 and FNaF 4
// night runners and the one-step explorer, each behind its own lease and
// --confirm-live. A
// new composer is a new way onto the phone and has to be named here in the
// diff that adds it.
const physicalActuatorOwners = new Set(['packages/play/src/campaign/modern-campaign-ports.js',
  'packages/play/games/fnaf1/fnaf1-night-run.mjs', 'apps/desktop/bin/fnaf1-custom-run.mjs', 'packages/play/games/fnaf1/fnaf1-menu-probe.mjs',
  'packages/play/games/fnaf3/fnaf3-run.mjs', 'packages/play/games/fnaf4/fnaf4-run.mjs', 'packages/play/bin/phone/explore-step.mjs']
  .map(path => join(ROOT, path)));
// The transport's own module defines the class; every other module in apps,
// tools and every package (the runners live in packages/play/games and bin/
// since the ADR 0002 layout) is checked.
const HID_TRANSPORT = join(ROOT, 'packages/play/src/venues/phone/hid.js');
for (const path of [...await files(join(ROOT, 'apps')), ...await files(join(ROOT, 'tools')), ...await files(join(ROOT, 'packages'))]
  .filter(path => !testNamed(path) && !reportNamed(path) && path !== fileURLToPath(import.meta.url) && path !== HID_TRANSPORT)) {
  if (!physicalActuatorOwners.has(path) && identifiers(await tree(path), node => node.text === 'HidWireTransport').length)
    assert.fail(`${path} reaches the HID transport outside the device runners`);
}
const cli = await readFile(join(ROOT, 'apps/desktop/src/device-cli.js'), 'utf8');
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
console.log(`architecture: ${hostFree.length} host-free core, source, kernel and propose modules and ${production.length} package modules obey boundary checks ` +
  `(${parsed.size} modules parsed; rules: ${RULES.map(rule => rule.id).join(', ')})`);
