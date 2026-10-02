#!/usr/bin/env node
// No dead code in the libraries: every module under a package's or an
// application's `src/` is loaded by something, and every name it exports is
// imported by something. Code nobody runs still has to be read, kept typed and
// carried through every move, and it is where a stale rule survives unnoticed.
//
// A module is loaded when any tracked script imports it (static, dynamic,
// `require`, a re-export) or names its path in a string that resolves to it
// (a URL built from its own location, a spawned script), or when a
// package.json, shell, Python, YAML or HTML file names its path. An export is
// used when a module imports that name from it, directly or through a
// re-export (`export * from`, `export { a as b } from`), and every name counts
// as used when a module is loaded whole (a namespace import, a dynamic import,
// a path string). Tests count as users. Entry scripts (`bin/`, tools, tests)
// are not judged: people and CI run them by name.
//
// The debt that existed when this landed is recorded in
// tools/quality-baseline.json (`deadCode`) and only shrinks (tools/gate-kit.ts).
//
//   node tools/test-dead-code.ts            exit 0 clean, 1 naming each finding
//   node tools/test-dead-code.ts --list     print every finding, recorded or not
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, posix } from 'node:path';
import ts from 'typescript';
import { ROOT, loadBaseline, ratchet, repoFiles, report } from './gate-kit.ts';

const SCRIPT = /\.(?:js|mjs|cjs|ts|mts)$/;
// What can start a module by its path: manifests, shell, Python, CI and pages.
// Other JSON is data -- the generated catalogs list every module and prove nothing.
const NAMING = /(?:^|\/)package\.json$|\.(?:sh|py|yml|yaml|html)$/;
/** The libraries this judges: modules under a package's or an application's src/. */
export const judged = (path: string) => /^(?:packages|apps)\/[^/]+\/src\//.test(path) && SCRIPT.test(path) && !path.endsWith('.d.ts');

// --- One module's syntax: what it imports and what it exports ------------------

/** One module's syntax: the specifiers it imports with the names it reads, path strings, its own exports, re-exports and star re-exports. */
interface ModuleSyntax {
  uses: {specifier: string, names: string[] | '*'}[], strings: string[], local: Set<string>,
  reexports: {name: string, from: string, as: string}[], stars: string[],
}

export function readModule(path: string, text: string): ModuleSyntax {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true,
    /\.m?ts$/.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const uses: ModuleSyntax['uses'] = [];
  const strings: string[] = [];
  const local = new Set<string>();
  const reexports: ModuleSyntax['reexports'] = [];
  const stars: string[] = [];
  const exported = (node: ts.Node): node is ts.HasModifiers => ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(mod => mod.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (node: ts.HasModifiers) => (ts.getModifiers(node) ?? []).some(mod => mod.kind === ts.SyntaxKind.DefaultKeyword);
  const bindingNames = (name: ts.BindingName): string[] => ts.isIdentifier(name) ? [name.text]
    : (name.elements as readonly ts.ArrayBindingElement[]).flatMap(element => ts.isOmittedExpression(element) ? [] : bindingNames(element.name));
  // A module specifier is read as an import above, not as a path string.
  const specifierOf = (node: ts.StringLiteralLike) => (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) &&
    node.parent.moduleSpecifier === node || (ts.isCallExpression(node.parent) && node.parent.arguments[0] === node &&
    (node.parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
     (ts.isIdentifier(node.parent.expression) && node.parent.expression.text === 'require')));
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const clause = node.importClause;
      const names: string[] = [];
      let whole = false;
      if (clause?.name) names.push('default');
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) whole = true;
      else if (bindings) for (const element of bindings.elements) names.push((element.propertyName ?? element.name).text);
      uses.push({ specifier: node.moduleSpecifier.text, names: whole ? '*' : names });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      if (!node.exportClause) stars.push(from);
      else if (ts.isNamespaceExport(node.exportClause)) {
        local.add(node.exportClause.name.text);
        uses.push({ specifier: from, names: '*' });
      } else for (const element of node.exportClause.elements)
        reexports.push({ as: element.name.text, name: (element.propertyName ?? element.name).text, from });
    } else if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) local.add(element.name.text);
    } else if (ts.isExportAssignment(node)) local.add('default');
    else if (exported(node)) {
      if (isDefault(node)) local.add('default');
      else if (ts.isVariableStatement(node))
        for (const declaration of node.declarationList.declarations) bindingNames(declaration.name).forEach(name => local.add(name));
      else {
        // Any other exported declaration that names itself.
        const name = (node as { name?: ts.Node }).name;
        if (name && ts.isIdentifier(name)) local.add(name.text);
      }
    } else if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
       (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      uses.push({ specifier: node.arguments[0].text, names: '*' });
    } else if (ts.isStringLiteralLike(node) && SCRIPT.test(node.text) && !specifierOf(node)) strings.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { uses, strings, local, reexports, stars };
}

// --- Resolving a specifier to a repository path --------------------------------

export function workspaces(root: string) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const found: { name: string, dir: string, exports: string | Readonly<Record<string, ExportTarget>> }[] = [];
  for (const pattern of manifest.workspaces ?? []) {
    const parent = pattern.replace(/\/\*$/, '');
    const listing = repoFiles(root).filter(path => path.startsWith(`${parent}/`) && path.endsWith('/package.json') &&
      path.split('/').length === parent.split('/').length + 2);
    for (const path of listing) {
      const pkg = JSON.parse(readFileSync(join(root, path), 'utf8'));
      if (pkg.name) found.push({ name: pkg.name, dir: dirname(path), exports: pkg.exports ?? (pkg.main ? { '.': pkg.main } : {}) });
    }
  }
  return found.sort((a, b) => b.name.length - a.name.length);
}

/** A package export's target: a path, or conditions naming one. */
type ExportTarget = string | { readonly import?: string, readonly default?: string } | null | undefined;
const target = (entry: ExportTarget) => typeof entry === 'string' ? entry : entry?.import ?? entry?.default ?? null;

/** @param from repository path */
export function resolveSpecifier(specifier: string, from: string, packages: ReturnType<typeof workspaces>, known: Set<string>) {
  const candidates = (path: string) => [path, path.replace(/\.m?js$/, '.ts'), path.replace(/\.js$/, '.mjs')];
  const pick = (path: string) => candidates(posix.normalize(path)).find(candidate => known.has(candidate)) ?? null;
  if (specifier.startsWith('.')) return pick(posix.join(posix.dirname(from), specifier));
  const pkg = packages.find(({ name }) => specifier === name || specifier.startsWith(`${name}/`));
  if (!pkg) return null;
  const subpath = `.${specifier.slice(pkg.name.length)}`;
  const exports = typeof pkg.exports === 'string' ? { '.': pkg.exports } : pkg.exports;
  if (exports[subpath] !== undefined) {
    const to = target(exports[subpath]);
    return to ? pick(posix.join(pkg.dir, to)) : null;
  }
  for (const [key, entry] of Object.entries(exports)) {
    if (!key.includes('*')) continue;
    const [head, tail] = key.split('*');
    if (!subpath.startsWith(head) || !subpath.endsWith(tail)) continue;
    const middle = subpath.slice(head.length, subpath.length - tail.length);
    const to = target(entry);
    if (to) return pick(posix.join(pkg.dir, to.replace('*', middle)));
  }
  return null;
}

// --- The findings ---------------------------------------------------------------

/**
 * @param scripts repository path -> text, every script the tree holds
 * @param naming repository path -> text of the manifests, shell, Python, YAML and HTML
 */
export function deadCode(scripts: Map<string, string>, naming: Map<string, string>, packages: ReturnType<typeof workspaces>) {
  const known = new Set(scripts.keys());
  const modules = new Map([...scripts].map(([path, text]) => [path, readModule(path, text)]));
  const loaded = new Set<string>();
  const whole = new Set<string>();
  const usedNames: Map<string, Set<string>> = new Map();
  const markName = (path: string, name: string, seen = new Set<string>()) => {
    const key = `${path}#${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const module = modules.get(path);
    if (!module) return;
    if (!usedNames.has(path)) usedNames.set(path, new Set());
    (usedNames.get(path) as Set<string>).add(name); // set just above when missing
    for (const { as, name: original, from } of module.reexports) {
      if (as !== name) continue;
      const to = resolveSpecifier(from, path, packages, known);
      if (to) markName(to, original, seen);
    }
    if (!module.local.has(name) && name !== 'default')
      for (const from of module.stars) {
        const to = resolveSpecifier(from, path, packages, known);
        if (to) markName(to, name, seen);
      }
  };
  const markWhole = (path: string, seen = new Set<string>()) => {
    if (seen.has(path)) return;
    seen.add(path);
    whole.add(path);
    const module = modules.get(path);
    for (const from of [...(module?.stars ?? []), ...(module?.reexports ?? []).map(({ from }) => from)]) {
      const to = resolveSpecifier(from, path, packages, known);
      if (to) { loaded.add(to); markWhole(to, seen); }
    }
  };
  for (const [path, module] of modules) {
    for (const { specifier, names } of module.uses) {
      const to = resolveSpecifier(specifier, path, packages, known);
      if (!to) continue;
      loaded.add(to);
      if (names === '*') markWhole(to);
      else names.forEach(name => markName(to, name));
    }
    for (const { from } of module.reexports) {
      const to = resolveSpecifier(from, path, packages, known);
      if (to) loaded.add(to);
    }
    for (const from of module.stars) {
      const to = resolveSpecifier(from, path, packages, known);
      if (to) loaded.add(to);
    }
    for (const text of module.strings) {
      const to = [posix.join(posix.dirname(path), text), posix.normalize(text)].map(candidate => posix.normalize(candidate))
        .find(candidate => known.has(candidate));
      if (to) { loaded.add(to); markWhole(to); }
    }
  }
  const namingText = [...naming.values()].join('\n');
  // A bare file name counts only when no other script shares it: `index.ts` in
  // a manifest says nothing about which index.
  const basenames = new Map();
  for (const path of modules.keys()) basenames.set(basename(path), (basenames.get(basename(path)) ?? 0) + 1);
  const found = new Map();
  for (const [path, module] of modules) {
    if (!judged(path)) continue;
    const named = namingText.includes(path) || (basenames.get(basename(path)) === 1 && namingText.includes(basename(path)));
    if (named) { loaded.add(path); markWhole(path); }
    if (!loaded.has(path)) {
      found.set(`orphan:${path}`, { count: 1, detail: 'no script loads it and no manifest, script or page names it' });
      continue;
    }
    if (whole.has(path)) continue;
    const used = usedNames.get(path) ?? new Set();
    const exported = new Set([...module.local, ...module.reexports.map(({ as }) => as)]);
    for (const name of exported)
      if (!used.has(name)) found.set(`export:${path}#${name}`, { count: 1, detail: 'exported and never imported' });
  }
  return found;
}

// Planted cases run first and must be caught.
{
  const packages = [{ name: '@x/lib', dir: 'packages/lib', exports: { '.': './src/index.ts', './games/*': './src/games/*' } }];
  const scripts = new Map([
    ['packages/lib/src/index.ts', "export * from './a.js';\nexport { b as bee } from './b.js';\n"],
    ['packages/lib/src/a.js', 'export const a = 1;\nexport const unusedA = 2;\n'],
    ['packages/lib/src/b.js', 'export function b() {}\nexport default 3;\n'],
    ['packages/lib/src/orphan.js', 'export const lost = 1;\n'],
    ['packages/lib/src/games/g.js', 'export const g = 1;\n'],
    ['packages/lib/src/worker.js', 'export const w = 1;\n'],
    ['packages/lib/src/named.js', 'export const n = 1;\n'],
    ['packages/lib/bin/cli.mjs', "import { a, bee } from '@x/lib';\nimport * as g from '@x/lib/games/g.js';\n" +
      `new URL('../src/${'worker'}.js', import.meta.url);\n`],
  ]);
  const found = deadCode(scripts, new Map([['package.json', '"x": "node packages/lib/src/named.js"']]), packages);
  assert.deepEqual([...found.keys()].sort(), [
    'export:packages/lib/src/a.js#unusedA',
    'export:packages/lib/src/b.js#default',
    'orphan:packages/lib/src/orphan.js',
  ], 'the planted orphan and unused exports must be caught, and re-exports, namespaces, URLs and named paths must count as use');
}

const root = ROOT;
const files = repoFiles(root);
const scripts = new Map(files.filter(path => SCRIPT.test(path) && !path.endsWith('.d.ts'))
  .map(path => [path, readFileSync(join(root, path), 'utf8')]));
const naming = new Map(files.filter(path => NAMING.test(path) && existsSync(join(root, path)))
  .map(path => [path, readFileSync(join(root, path), 'utf8')]));
const found = deadCode(scripts, naming, workspaces(root));
if (process.argv.includes('--list')) for (const [key, { detail }] of found) console.log(`${key}  ${detail}`);
const orphans = [...found.keys()].filter(key => key.startsWith('orphan:')).length;
report('dead-code', ratchet(found, loadBaseline('deadCode')),
  `${[...scripts.keys()].filter(judged).length} library modules; ${orphans} orphan module(s) and ` +
  `${found.size - orphans} unused export(s), each recorded and not growing`);
