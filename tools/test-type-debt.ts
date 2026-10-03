#!/usr/bin/env node
// Explicit `any` and non-null `!`, counted per area so they only shrink, to none. Strict mode refuses an
// implicit `any` but accepts a written one, and `x!` switches its null check off; Pedro's decision on
// 2026-10-01 is real types everywhere, with no explicit `any`. This counts both, per area (a package's
// or an application's src, test or bin, and tools), from the syntax tree -- `any` written as a type,
// and the `x!` assertion -- and holds each area to its entry in tools/quality-baseline.json
// (`typeDebt`, through tools/gate-kit.ts): a new one fails unless one is paid elsewhere in the area, a
// paid one lowers the entry, and an area with no entry carries none. That is how an area stays typed
// once it is; since 2026-10-03, when tools paid its last, no area has an entry.
//
// Counting only `any` and `x!` let the debt move where it could not be seen: a `!` became `as T`, and a
// record read with JSON.parse became a variable annotated with the type it was hoped to have. So the gate
// also counts, per area (`castDebt`), every cast that skips a check -- `as T` and `<T>x`, except `as const`,
// a cast to `unknown`, and a validator's closing `return value as unknown as T` (CLAUDE.md: the one
// assertion where a checked record becomes its type) -- each call of a `found()`-style helper (a generic
// function that only returns its parameter `as T`), and each JSON.parse or `.json()` result given an
// annotated type.
//
//   node tools/test-type-debt.ts          exit 0 when no area's debt grew, 1 naming each area that did
//   node tools/test-type-debt.ts --list   print each area's count
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { ROOT, loadBaseline, ratchet, repoFiles, report } from './gate-kit.ts';

/** The area a file's debt is counted in. @param path repository-relative */
export function areaOf(path: string): string {
  const parts = path.split('/');
  if (parts[0] === 'tools') return 'tools';
  if ((parts[0] === 'packages' || parts[0] === 'apps') && parts.length > 3) return parts.slice(0, 3).join('/');
  return parts.slice(0, 2).join('/');
}

/** `any` written as a type, and non-null assertions, in one module. */
export function debtOf(path: string, text: string): { any: number, nonNull: number } {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let any = 0, nonNull = 0;
  const visit = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) any += 1;
    else if (ts.isNonNullExpression(node)) nonNull += 1;
    node.forEachChild(visit);
  };
  visit(file);
  return { any, nonNull };
}

/** The final statement of the function body a node sits in, if the node is that statement. */
function isClosingReturn(node: ts.Node) {
  const statement = node.parent;
  if (!statement || !ts.isReturnStatement(statement) || !ts.isBlock(statement.parent)) return false;
  const body = statement.parent;
  const owner = body.parent;
  return Boolean(owner && ts.isFunctionLike(owner) && body.statements[body.statements.length - 1] === statement);
}

/** A cast that checks nothing: not `as const`, not to `unknown`, not a validator's closing `as unknown as T`. */
function isUncheckedCast(node: ts.Node) {
  if (!ts.isAsExpression(node) && !ts.isTypeAssertionExpression(node)) return false;
  const type = node.type;
  if (type.kind === ts.SyntaxKind.UnknownKeyword) return false;
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === 'const') return false;
  const inner = node.expression;
  if ((ts.isAsExpression(inner) || ts.isTypeAssertionExpression(inner)) && inner.type.kind === ts.SyntaxKind.UnknownKeyword &&
      isClosingReturn(node)) return false;
  return true;
}

/** `<T>(value) => value as T`, or a function whose body is only `return value as T`: a cast with a name. */
function castHelperName(node: ts.Node): string | null {
  const fn = ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ? { name: node.name, fn: node.initializer } : ts.isFunctionDeclaration(node) && node.name ? { name: node.name, fn: node } : null;
  if (!fn || !ts.isIdentifier(fn.name) || !fn.fn.typeParameters?.length || fn.fn.parameters.length < 1) return null;
  const body = fn.fn.body;
  const returned = body && ts.isBlock(body) ? (body.statements.length === 1 && ts.isReturnStatement(body.statements[0]) ? body.statements[0].expression : undefined) : body;
  if (!returned || !ts.isAsExpression(returned) || !ts.isIdentifier(returned.expression)) return null;
  const param = fn.fn.parameters[0].name;
  if (!ts.isIdentifier(param) || returned.expression.text !== param.text) return null;
  const typeParams = new Set(fn.fn.typeParameters.map(p => p.name.text));
  return ts.isTypeReferenceNode(returned.type) && ts.isIdentifier(returned.type.typeName) && typeParams.has(returned.type.typeName.text) ? fn.name.text : null;
}

/** JSON.parse(...) or x.json(), awaited or not. */
function isParsedJson(expression: ts.Expression | undefined): boolean {
  if (!expression) return false;
  if (ts.isAwaitExpression(expression) || ts.isParenthesizedExpression(expression)) return isParsedJson(expression.expression);
  if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) return false;
  const { expression: target, name } = expression.expression;
  return (name.text === 'parse' && ts.isIdentifier(target) && target.text === 'JSON') || name.text === 'json';
}

/** Casts that skip a check in one module (see the header). */
export function castsOf(path: string, text: string): number {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const helpers = new Set<string>();
  const collect = (node: ts.Node) => { const name = castHelperName(node); if (name) helpers.add(name); node.forEachChild(collect); };
  collect(file);
  let casts = 0;
  const visit = (node: ts.Node) => {
    if (isUncheckedCast(node)) casts += 1;
    else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && helpers.has(node.expression.text)) casts += 1;
    else if (ts.isVariableDeclaration(node) && node.type && node.type.kind !== ts.SyntaxKind.UnknownKeyword && isParsedJson(node.initializer)) casts += 1;
    node.forEachChild(visit);
  };
  visit(file);
  return casts;
}

// Planted cases run first and must be counted.
{
  assert.equal(castsOf('a.ts', 'const a = b as Foo; const c = <Bar>d; const e = f as unknown as Baz;'), 3, 'casts that check nothing');
  assert.equal(castsOf('a.ts', 'const a = [1] as const; const b = c as unknown;'), 0, 'as const and a cast to unknown');
  assert.equal(castsOf('a.ts', 'function v(x: unknown): T { if (!ok(x)) fail(); return x as unknown as T; }'), 0,
    "a validator's closing `as unknown as T`");
  assert.equal(castsOf('a.ts', 'function v(x: unknown) { const t = x as unknown as T; return t; }'), 1, 'the idiom anywhere else');
  assert.equal(castsOf('a.ts', 'const found = <T>(value: T | null | undefined) => value as T; const a = found(b); const c = found(d).e;'), 3,
    'a found()-style helper is a cast at each call');
  assert.equal(castsOf('a.ts', 'const a: Foo = JSON.parse(t); const b: Bar = await r.json(); const c: unknown = JSON.parse(t); const d = JSON.parse(t);'), 2,
    'parsed JSON given a type it was never checked for');
  assert.deepEqual(debtOf('a.ts', 'const f = (a: any, b: any[]) => (b as any).x!.y; let c: Record<string, any>;'), { any: 4, nonNull: 1 });
  assert.deepEqual(debtOf('a.ts', "// any, x!\nconst s = 'as any'; const t = a !== b;"), { any: 0, nonNull: 0 },
    'a comment, a string and an inequality are not debt');
  assert.equal(areaOf('packages/play/src/campaign/x.ts'), 'packages/play/src');
  assert.equal(areaOf('apps/wiki/chronicle.ts'), 'apps/wiki');
  assert.equal(areaOf('tools/gate-kit.ts'), 'tools');
}

const found = new Map<string, { count: number, detail: string }>();
const casts = new Map<string, { count: number, detail: string }>();
const add = (map: typeof found, key: string, count: number) => {
  if (!count) return;
  const entry = map.get(key) ?? { count: 0, detail: '' };
  entry.count += count;
  map.set(key, entry);
};
for (const path of repoFiles().filter(f => /\.m?ts$/.test(f) && !f.endsWith('.d.ts'))) {
  const text = readFileSync(join(ROOT, path), 'utf8');
  const { any, nonNull } = debtOf(path, text);
  add(found, `debt:${areaOf(path)}`, any + nonNull);
  add(casts, `cast:${areaOf(path)}`, castsOf(path, text));
}
for (const entry of found.values()) entry.detail = `${entry.count} explicit any and non-null assertions`;
for (const entry of casts.values()) entry.detail = `${entry.count} unchecked casts`;
if (process.argv.includes('--list')) for (const [key, { count }] of [...found, ...casts].sort()) console.log(`${count}\t${key}`);
const total = [...found.values()].reduce((sum, { count }) => sum + count, 0);
const castTotal = [...casts.values()].reduce((sum, { count }) => sum + count, 0);
report('type-debt', [...ratchet(found, loadBaseline('typeDebt')), ...ratchet(casts, loadBaseline('castDebt'))],
  `${found.size} areas carry ${total} explicit any and non-null assertions and ${casts.size} carry ${castTotal} unchecked casts, none growing`);
