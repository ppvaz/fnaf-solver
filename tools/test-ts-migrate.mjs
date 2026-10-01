#!/usr/bin/env node
// Holds tools/ts-migrate.mjs to what the kernel, Source and Play migrations
// needed, each on a planted fixture in a throwaway repository: every case here
// once came out wrong. The migrated fixture must typecheck at the strictness
// JavaScript had (strict off) and run under Node's type stripping with the
// JavaScript's behaviour:
//   - a JSDoc cast of an arrow keeps the arrow parenthesized;
//   - a one-parameter arrow gets its parameter type, not its return type;
//   - a class field the constructor assigns is `declare`d, so no own field
//     appears early and a prototype setter still fires;
//   - a member installed with Object.defineProperty is declared on the class;
//   - `@this {C}` is a `this: C` parameter;
//   - a parameter a call leaves out is optional, an open literal read is any,
//     and a promise resolved with nothing is Promise<void>.
//
//   node tools/test-ts-migrate.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(ROOT, 'tools/ts-migrate.mjs');
const TSC = join(ROOT, 'node_modules/typescript/bin/tsc');
const repo = mkdtempSync(join(tmpdir(), 'ts-migrate-'));
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
try {
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }));
  writeFileSync(join(repo, 'tsconfig.js.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: false, allowJs: true, checkJs: true,
    noEmit: true, allowImportingTsExtensions: true, erasableSyntaxOnly: true, verbatimModuleSyntax: true,
    skipLibCheck: true, types: [] }, include: ['src/**/*.js', 'src/**/*.ts'] }));
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src/types.ts'), 'export interface Point { x: number; y: number }\n');
  writeFileSync(join(repo, 'src/lib.js'), `/** Fixture. */
/** @typedef {import('./types.ts').Point} Point */

/** @param {string} why */
export const invalid = why => ({ kind: 'Invalid', why });
/** @param {unknown} value @returns {value is string} */
export const isText = value => typeof value === 'string';
export const onEvent = /** @type {(record: any) => void} */ (() => {});
/** @param {Point} point @returns {number} */
export function norm(point) { return point.x + point.y; }

export class Model {
  constructor(opts) { this.opts = opts; this.count = 0; }
  bump() { this.count += 1; return this.count; }
}
/** @this {Model} */
function twice() { return this.bump() + this.bump(); }
Object.defineProperty(Model.prototype, 'twice', { value: twice, writable: true, configurable: true });

export function arity(a, b) { return b === undefined ? a : a + b; }
export const one = arity(1);
export const bare = over => ({ base: 1, ...over });
export const made = bare();
export function open(options = {}) { return options.flag ?? null; }
export const later = cycles => Object.values(cycles).map(cycle => cycle.blocks.length);
export const settled = new Promise((resolve) => { resolve(); });
`);
  // An .mjs module becomes .ts too, and JSDoc `{object}` is `any`, as JavaScript read it.
  writeFileSync(join(repo, 'src/reader.mjs'), `import { norm } from './lib.js';
/** @param {object} entry */
export function idOf(entry) { return entry.id; }
export const total = norm({ x: 1, y: 2 });
`);
  git('add', '.');
  git('commit', '-qm', 'fixture');

  const run = spawnSync(process.execPath, [TOOL, 'src'], { cwd: repo, encoding: 'utf8', env: { ...process.env, TS_MIGRATE_ROOT: repo } });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = readFileSync(join(repo, 'src/lib.ts'), 'utf8');
  assert.match(out, /^import type \{ Point \} from '\.\/types\.ts';$/m, 'a JSDoc import alias is a type import');
  assert.match(out, /export const invalid = \(why: string\) => \(\{ kind: 'Invalid', why \}\);/, 'the one-parameter arrow keeps its return untyped');
  assert.match(out, /export const isText = \(value: unknown\): value is string =>/, 'a predicate is a return type');
  assert.match(out, /export const onEvent = \(\(\(\) => \{\}\) as \(record: any\) => void\);/, 'a cast arrow keeps its parentheses');
  assert.match(out, /export function norm\(point: Point\): number \{/);
  assert.match(out, /^  declare opts: any;$/m, 'an assigned field is declare');
  assert.match(out, /^  declare twice: typeof twice;$/m, 'an installed member is declared');
  assert.match(out, /function twice\(this: Model\)/, '@this is a this parameter');
  assert.match(out, /export function arity\(a, b\?\)/, 'a parameter a call leaves out is optional');
  assert.match(out, /export const bare = \(over\?\) => /, 'a bare arrow parameter a call leaves out takes parentheses with its ?');
  assert.match(out, /export function open\(options: any = \{\}\)/, 'an open literal read types its parameter any');
  assert.match(out, /new Promise<void>\(/, 'a promise resolved with nothing is Promise<void>');
  assert.doesNotMatch(out, /\w: any =>/, 'no unparenthesized typed arrow parameter');
  const reader = readFileSync(join(repo, 'src/reader.ts'), 'utf8');
  assert.match(reader, /^import \{ norm \} from '\.\/lib\.ts';$/m, 'an .mjs module is .ts, its specifiers too');
  assert.match(reader, /export function idOf\(entry: any\)/, 'JSDoc {object} is any, never a closed object');
  assert.doesNotMatch(reader, /as any\)/, 'no read needed a cast');

  const typecheck = spawnSync(process.execPath, [TSC, '--noEmit', '-p', join(repo, 'tsconfig.js.json')], { encoding: 'utf8' });
  assert.equal(typecheck.status, 0, typecheck.stdout + typecheck.stderr);

  // Behaviour under type stripping: no early own fields, a prototype setter fires, installed members work.
  const lib = await import(pathToFileURL(join(repo, 'src/lib.ts')).href);
  let setterFired = false;
  Object.defineProperty(lib.Model.prototype, 'opts', { configurable: true, set(value) {
    setterFired = true;
    Object.defineProperty(this, 'opts', { value, writable: true, configurable: true, enumerable: true });
  } });
  const model = new lib.Model({ a: 1 });
  assert.equal(setterFired, true, 'a prototype setter still intercepts the constructor\'s assignment');
  assert.deepEqual(Object.keys(model), ['opts', 'count']);
  assert.equal(model.twice(), 3);
  assert.equal(lib.one, 1);
  assert.equal(lib.open(), null);
  assert.deepEqual(lib.later({ a: { blocks: [1, 2] } }), [2]);
  assert.equal(await lib.settled, undefined);
  const readerModule = await import(pathToFileURL(join(repo, 'src/reader.ts')).href);
  assert.equal(readerModule.idOf({ id: 'a' }), 'a');
  assert.equal(readerModule.total, 3);
} finally {
  rmSync(repo, { recursive: true, force: true });
}
console.log('ts-migrate: casts, one-parameter arrows, predicates, declare fields, installed members, this parameters, ' +
  'arity, open literals, void promises, .mjs modules and JSDoc {object} migrate, typecheck, and run as the JavaScript did');
