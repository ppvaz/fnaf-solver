#!/usr/bin/env node
// Holds tools/ts-strict.ts to its promise: a module it edits passes strict mode, says in erasable
// syntax what the JavaScript already assumed, and computes exactly what it did before.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TOOL = join(ROOT, 'tools', 'ts-strict.ts');
const repo = realpathSync(mkdtempSync(join(tmpdir(), 'ts-strict-')));
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

const SOURCE = `export const id = (a) => a;
export function first(x, ...rest) { return [x, rest.length]; }
export const field = ({ p }) => p;
let acc = [];
export function read() { return acc; }
acc.push(7);
export const last = (xs: string[]) => xs.pop().length;
export const size = (value: unknown) => value.length;
export const pick = (k: string) => { const table = { a: 1 }; return table[k]; };
export const prop = (o: {}) => o.missing;
export const depth = (n) => n > 0 ? depth(n - 1) + 1 : 0;
export class Slot {
  declare held: { n: number };
  constructor() { this.held = null; }
  fill() { this.held = { n: 1 }; return this.held.n; }
}
`;

try {
  git('init', '-q');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'package.json'), '{ "type": "module" }\n');
  writeFileSync(join(repo, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext',
    moduleResolution: 'NodeNext', strict: false, noEmit: true, erasableSyntaxOnly: true, allowImportingTsExtensions: true,
    skipLibCheck: true }, include: ['src/**/*.ts'] }, null, 2));
  writeFileSync(join(repo, 'src/lib.ts'), SOURCE);
  git('add', '.');
  git('-c', 'user.email=t@users.noreply.github.com', '-c', 'user.name=t', 'commit', '-qm', 'fixture');
  const before = await import(`${pathToFileURL(join(repo, 'src/lib.ts')).href}?before`);
  const expected = [before.id(3), before.first(1, 2, 3), before.field({ p: 'q' }), before.read().length, before.last(['ab', 'cde']),
    before.size('abcd'), before.pick('a'), before.prop({ missing: 5 }), before.depth(3), new before.Slot().fill()];

  const run = spawnSync(process.execPath, [TOOL, 'src'], { cwd: repo, encoding: 'utf8', env: { ...process.env, TS_STRICT_ROOT: repo } });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /0 strict diagnostic\(s\) left/, run.stdout);
  const out = readFileSync(join(repo, 'src/lib.ts'), 'utf8');
  assert.match(out, /export const id = \(a: any\) => a;/, 'a bare arrow parameter takes parentheses with its any');
  assert.match(out, /function first\(x: any, \.\.\.rest: any\[\]\)/, 'a rest parameter is any[]');
  assert.match(out, /\(\{ p \}: any\) => p/, 'a destructured parameter is typed as a whole');
  assert.match(out, /let acc: any\[\] = \[\];/, 'an array whose element type cannot be determined is any[]');
  assert.match(out, /xs\.pop\(\)!\.length/, 'a value strict null checks doubt gets the assumption the code ran on');
  assert.match(out, /\(value as any\)\.length/, 'an unknown read is cast');
  assert.match(out, /\(table as any\)\[k\]/, 'an index a type refuses is cast');
  assert.match(out, /\(o as any\)\.missing/, 'a property a type does not declare is cast');
  assert.match(out, /export const depth = \(n: any\): any =>/, 'a recursive arrow names its return');
  assert.match(out, /declare held: \{ n: number \} \| null;/, 'a field set to null widens its declaration, not the assignment');

  const strict = spawnSync(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json', '--strict'],
    { cwd: repo, encoding: 'utf8' });
  assert.equal(strict.status, 0, `the edited module passes strict mode:\n${strict.stdout}`);
  const after = await import(`${pathToFileURL(join(repo, 'src/lib.ts')).href}?after`);
  assert.deepEqual([after.id(3), after.first(1, 2, 3), after.field({ p: 'q' }), after.read().length, after.last(['ab', 'cde']),
    after.size('abcd'), after.pick('a'), after.prop({ missing: 5 }), after.depth(3), new after.Slot().fill()], expected,
  'the edited module computes what it did');
  console.log('ts-strict: implicit any, rest, destructured, an undetermined array, recursive return, null fields, ' +
    'non-null and four casts write down what the JavaScript assumed; the module passes strict and runs the same');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
