#!/usr/bin/env node
// Inline the ES modules and CSS into one self-contained dist/index.html.
//
// The trainer has no dependencies and no build step for development (just serve the folder). This exists so
// the page can be opened from a phone or published as a single file. Ported from build.py; it writes the same
// bytes.
//
//   node apps/trainer/test/build.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pyFixed } from '@sixam/kernel/py';

// Node 22.13 added it; the @types/node this repository pins (22.10) does not declare it yet.
declare module 'node:module' {
  export function stripTypeScriptTypes(code: string, options?: { mode?: 'strip' | 'transform', sourceMap?: boolean, sourceUrl?: string }): string;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = join(ROOT, 'apps', 'trainer', 'src');
const ENTRY = 'apps/trainer/src/main.ts';

const IMPORT_NS = /^import \* as (\w+) from ['"]([^'"]+)['"];\s*$/gm;
const IMPORT_NAMED = /^import \{([^}]*)\} from ['"]([^'"]+)['"];\s*$/gm;
const EXPORT_STAR = /^export \* from ['"]([^'"]+)['"];\s*$/gm;
// `export { a, b as c } from './x.js';` -- a named re-export. The kernel's and core's barrels use it; before
// 2026-09-29 the bundler stripped only the `export ` keyword from it and left `{ ... } from '...';` in the
// bundle, a syntax error that blanked the built trainer.
const EXPORT_FROM = /^export \{([^}]*)\} from ['"]([^'"]+)['"];\s*$/gm;
const EXPORT_DECL = /^export\s+(async\s+function|function|class|const|let)\s+(\w+)/gm;
const EXPORT_LIST = /^export \{([^}]*)\};\s*$/gm;

const stripped = new Map<string, string>();
// build.py ran the stripper with --no-warnings: its ExperimentalWarning is not the build's to print.
process.removeAllListeners('warning');

/**
 * A module's code as the browser runs it. A .ts module has its types erased by Node's own stripper (what
 * the dev server serves too) and is otherwise the same text, so every regex here reads plain JavaScript either way.
 */
function sourceOf(path: string): string {
  const text = readFileSync(path, 'utf8');
  if (extname(path) !== '.ts') return text;
  let code = stripped.get(path);
  if (code === undefined) {
    code = stripTypeScriptTypes(text, { mode: 'strip' });
    stripped.set(path, code);
  }
  return code;
}

type Exports = string | Readonly<Record<string, string>>;

/** Every workspace package by name: its directory and its `exports` map. */
function workspaces() {
  const found = new Map<string, [string, Exports]>();
  for (const group of ['packages', 'apps']) {
    for (const name of readdirSync(join(ROOT, group)).sort()) {
      const manifest = join(ROOT, group, name, 'package.json');
      if (existsSync(manifest) && statSync(manifest).isFile()) {
        const data: { name: string, exports?: Exports } = JSON.parse(readFileSync(manifest, 'utf8'));
        found.set(data.name, [join(ROOT, group, name), data.exports ?? {}]);
      }
    }
  }
  return found;
}

const WORKSPACES = workspaces();

/**
 * Resolve a workspace specifier through its package.json `exports`, the way Node does for the two forms this
 * repository writes: an exact subpath and a trailing-`*` subpath pattern. A subpath the package does not
 * export fails.
 */
function workspaceTarget(spec: string): string | null {
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  const workspace = WORKSPACES.get(name);
  if (!workspace) return null;
  const [directory, raw] = workspace;
  const exports = typeof raw === 'string' ? { '.': raw } : raw;
  const subpath = `.${spec.slice(name.length)}`;
  if (subpath in exports) return join(directory, exports[subpath]);
  for (const [key, value] of Object.entries(exports))
    if (key.endsWith('*') && subpath.startsWith(key.slice(0, -1))) return join(directory, value.replaceAll('*', subpath.slice(key.length - 1)));
  throw new Error(`${name} does not export '${subpath}' (asked for '${spec}')`);
}

/** Path.resolve(): absolute, symlinks followed where the path exists. */
function realish(path: string) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Resolve an ESM edge: a relative path, or a workspace package's export. */
function resolvePath(path: string, spec: string): string {
  let target: string;
  if (spec.startsWith('.')) target = realish(join(dirname(path), spec));
  else {
    const found = workspaceTarget(spec);
    if (found === null) throw new Error(`trainer bundle cannot resolve bare import '${spec}' from ${path}`);
    target = found;
  }
  const suffix = extname(basename(target));
  if (suffix !== '.js' && suffix !== '.ts') target = suffix ? target.slice(0, -suffix.length) + '.js' : `${target}.js`;
  if (!existsSync(target)) throw new Error(`${relative(ROOT, path)} imports missing ${spec}`);
  return realish(target);
}

/** Collapse a compatibility `export *` shim to its core implementation. */
function canonicalPath(path: string, seen = new Set<string>()): string {
  path = realish(path);
  if (seen.has(path)) throw new Error(`compatibility export cycle at ${path}`);
  seen.add(path);
  const source = sourceOf(path);
  const matches = [...source.matchAll(EXPORT_STAR)];
  if (matches.length === 1 && !/^export\s+(?:async\s+function|function|class|const|let|\{)/m.test(source))
    return canonicalPath(resolvePath(path, matches[0][1]), seen);
  return path;
}

const moduleName = (path: string) => relative(ROOT, path).split('\\').join('/');

function transform(name: string, path: string, code: string): string {
  const dep = (spec: string) => moduleName(canonicalPath(resolvePath(path, spec)));
  code = code.replace(IMPORT_NS, (_, local: string, spec: string) => `const ${local} = __req('${dep(spec)}');`);
  // `import { a as b }` destructures as `{ a: b }`.
  code = code.replace(IMPORT_NAMED, (_, list: string, spec: string) => {
    const names = list.split(',').filter(part => part.trim()).map(part => part.trim().replaceAll(' as ', ': ')).join(', ');
    return `const { ${names} } = __req('${dep(spec)}');`;
  });
  code = code.replace(EXPORT_FROM, (_, list: string, spec: string) => {
    const pairs: string[] = [];
    for (const part of list.split(',')) {
      const trimmed = part.trim();
      const at = trimmed.indexOf(' as ');
      const local = at >= 0 ? trimmed.slice(0, at) : trimmed;
      const exported = at >= 0 ? trimmed.slice(at + 4) : '';
      if (local) pairs.push(`${(exported || local).trim()}: __t.${local.trim()}`);
    }
    return `{ const __t = __req('${dep(spec)}'); Object.assign(__x, { ${pairs.join(', ')} }); }`;
  });
  // A core barrel can be included by a future trainer module. Preserve its explicit re-export semantics in
  // the tiny bundle runtime.
  code = code.replace(EXPORT_STAR, (_, spec: string) => `Object.assign(__x, __req('${dep(spec)}'));`);
  let names = [...code.matchAll(EXPORT_DECL)].map(match => match[2]);
  // `export { a as b }` publishes `a` under `b`: an object literal says that as `b: a`.
  for (const match of code.matchAll(EXPORT_LIST))
    names.push(...match[1].split(',').map(part => part.trim()).filter(Boolean)
      .map(part => part.includes(' as ') ? part.split(' as ').map(side => side.trim()).reverse().join(': ') : part));
  code = code.replace(EXPORT_LIST, '');
  code = code.replace(/^export\s+/gm, '');
  names = [...new Set(names)].sort();
  const tail = names.length ? `\nObject.assign(__x, { ${names.join(', ')} });\n` : '';
  return `__def('${name}', function(__x, __req) {\n${code}\n${tail}});\n`;
}

/** Depth-first module order derived from the imports themselves, so adding a module needs no hand-kept list. */
function resolveOrder(entry = ENTRY): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const stack = new Set<string>();
  const visit = (start: string) => {
    const path = canonicalPath(start);
    const name = moduleName(path);
    if (order.includes(name)) return;
    if (stack.has(name)) throw new Error(`import cycle involving ${name}`);
    stack.add(name);
    const source = sourceOf(path);
    for (const match of [...source.matchAll(IMPORT_NS), ...source.matchAll(IMPORT_NAMED)]) visit(resolvePath(path, match[2]));
    for (const match of source.matchAll(EXPORT_STAR)) visit(resolvePath(path, match[1]));
    for (const match of source.matchAll(EXPORT_FROM)) visit(resolvePath(path, match[2]));
    stack.delete(name);
    seen.add(name);
    order.push(name);
  };
  visit(realish(join(ROOT, entry)));
  const stray = readdirSync(SRC).filter(file => (file.endsWith('.js') || file.endsWith('.ts')) && !file.endsWith('.d.ts'))
    .map(file => moduleName(join(SRC, file))).filter(name => !seen.has(name)).sort();
  if (stray.length) console.error(`note: not bundled (nothing imports them): [${stray.map(name => `'${name}'`).join(', ')}]`);
  return order;
}

const FONT_URL = /url\(([^)]+\.woff2)\)/g;

/**
 * Turn the @font-face file references into data URIs. The dev page loads the woff2 files straight off disk;
 * dist/index.html has to be one file, so the bytes come along inside the CSS.
 */
const inlineFonts = (css: string, cssSource: string) =>
  css.replace(FONT_URL, (_, file: string) => `url(data:font/woff2;base64,${readFileSync(realish(join(dirname(cssSource), file))).toString('base64')})`);

let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const css = `${inlineFonts(readFileSync(join(SRC, 'fonts.css'), 'utf8'), join(SRC, 'fonts.css'))}\n${readFileSync(join(SRC, 'style.css'), 'utf8')}`;
const shim = 'const __m={};const __def=(n,f)=>__m[n]={f,x:null};'
  + 'const __req=(n)=>{const m=__m[n];'
  + "if(!m)throw new Error('module not bundled: '+n);"
  + 'if(!m.x){m.x={};m.f(m.x,__req);}return m.x;};\n';
const order = resolveOrder();
const bundle = shim + order.map(name => transform(name, join(ROOT, name), sourceOf(join(ROOT, name)))).join('')
  + `__req('${moduleName(canonicalPath(realish(join(ROOT, ENTRY))))}');\n`;

html = html.replaceAll('<link rel="stylesheet" href="apps/trainer/src/fonts.css">\n', '');
html = html.replaceAll('<link rel="stylesheet" href="apps/trainer/src/style.css">', () => `<style>\n${css}\n</style>`);
html = html.replaceAll('<script type="module" src="apps/trainer/src/main.ts"></script>', () => `<script>\n${bundle}\n</script>`);

mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist', 'index.html'), html);
console.log(`dist/index.html  ${pyFixed(Buffer.byteLength(html) / 1024, 0)} KB  (${order.length} modules)`);
// data: URIs are self-contained -- they are the point of inlining, not a dangling reference.
const leftover = [...html.matchAll(/(?:src|href)="(?!https?:|data:|#)[^"]*"/g)].map(match => match[0]);
if (leftover.length) console.error(`WARNING: unresolved local reference(s): [${leftover.map(ref => `'${ref}'`).join(', ')}]`);
