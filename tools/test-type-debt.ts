#!/usr/bin/env node
// Explicit `any` and non-null `!`, counted per area so they only shrink, to none. Strict mode refuses an
// implicit `any` but accepts a written one, and `x!` switches its null check off; Pedro's decision on
// 2026-10-01 is real types everywhere, with no explicit `any`. This counts both, per area (a package's
// or an application's src, test or bin, and tools), from the syntax tree -- `any` written as a type,
// and the `x!` assertion -- and holds each area to its entry in tools/quality-baseline.json
// (`typeDebt`, through tools/gate-kit.ts): a new one fails unless one is paid elsewhere in the area, a
// paid one lowers the entry, and an area with no entry carries none. That is how an area stays typed
// once it is: the kernel, Source, Play, Propose and Review src, the wiki and the trainer, since 2026-10-01.
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

// Planted cases run first and must be counted.
{
  assert.deepEqual(debtOf('a.ts', 'const f = (a: any, b: any[]) => (b as any).x!.y; let c: Record<string, any>;'), { any: 4, nonNull: 1 });
  assert.deepEqual(debtOf('a.ts', "// any, x!\nconst s = 'as any'; const t = a !== b;"), { any: 0, nonNull: 0 },
    'a comment, a string and an inequality are not debt');
  assert.equal(areaOf('packages/play/src/campaign/x.ts'), 'packages/play/src');
  assert.equal(areaOf('apps/wiki/chronicle.ts'), 'apps/wiki');
  assert.equal(areaOf('tools/gate-kit.ts'), 'tools');
}

const found = new Map<string, { count: number, detail: string }>();
for (const path of repoFiles().filter(f => /\.m?ts$/.test(f) && !f.endsWith('.d.ts'))) {
  const { any, nonNull } = debtOf(path, readFileSync(join(ROOT, path), 'utf8'));
  if (!any && !nonNull) continue;
  const key = `debt:${areaOf(path)}`;
  const entry = found.get(key) ?? { count: 0, detail: '' };
  entry.count += any + nonNull;
  found.set(key, entry);
}
for (const entry of found.values()) entry.detail = `${entry.count} explicit any and non-null assertions`;
if (process.argv.includes('--list')) for (const [key, { count }] of [...found].sort()) console.log(`${count}\t${key}`);
const total = [...found.values()].reduce((sum, { count }) => sum + count, 0);
report('type-debt', ratchet(found, loadBaseline('typeDebt')),
  `${found.size} areas carry ${total} explicit any and non-null assertions, none growing`);
