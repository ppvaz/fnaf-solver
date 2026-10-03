#!/usr/bin/env node
// Every node file a lane runs (tools/lanes.json) registers at least one node:test test. The lanes run
// each file under `node --test`, which reports a file that registers no test as one opaque pass whenever
// it exits 0, so a script that only prints its numbers (apps/trainer/test/browser.test.ts did, on
// 2026-10-02) passes whatever it prints. A file is counted when it imports node:test and calls
// test(), describe(), it() or suite() from it. The files that registered none when this landed are
// counted per area in tools/quality-baseline.json (`nodeTests`) and only shrink: a new lane file is a test.
//
//   node tools/test-node-tests.ts          exit 0 when no area's count grew, 1 naming each area that did
//   node tools/test-node-tests.ts --list   print each area's count
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { readLanes } from '@sixam/review/lanes';
import { ROOT, loadBaseline, ratchet, report } from './gate-kit.ts';
import { parse } from './module-refs.ts';

const REGISTERS = new Set(['test', 'describe', 'it', 'suite']);

/** Whether a module registers a node:test test: it imports node:test and calls one of its registrars. */
export function registersTests(path: string, text: string) {
  const file = parse(path, text);
  const local = new Set<string>();
  let namespace = null as string | null;
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== 'node:test' && statement.moduleSpecifier.text !== 'test') continue;
    const clause = statement.importClause;
    if (clause?.name) local.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespace = bindings.name.text;
    if (bindings && ts.isNamedImports(bindings))
      for (const element of bindings.elements) if (REGISTERS.has((element.propertyName ?? element.name).text)) local.add(element.name.text);
  }
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && local.has(callee.text)) found = true;
      else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
        && ((namespace !== null && callee.expression.text === namespace && REGISTERS.has(callee.name.text)) || local.has(callee.expression.text)))
        found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The area a lane file is counted in: a package's or an application's top directory, else its first. */
const areaOf = (path: string) => {
  const parts = path.split('/');
  return parts[0] === 'packages' || parts[0] === 'apps' ? parts.slice(0, 3).join('/') : parts[0];
};

test('every lane node file registers a node:test test, or is recorded', async () => {
  // Planted: a printing script registers nothing; named, default, namespace and aliased registrars count.
  assert.equal(registersTests('a.ts', "import assert from 'node:assert/strict';\nassert.equal(1, 1);\nconsole.log('ok');"), false);
  assert.equal(registersTests('a.ts', "import { test } from 'node:test';\nconst label = 'test';\nconsole.log(label);"), false,
    'an import alone is not a test');
  for (const source of ["import { test } from 'node:test';\ntest('x', () => {});", "import test from 'node:test';\ntest('x', () => {});",
    "import * as t from 'node:test';\nt.describe('x', () => {});", "import { it as check } from 'node:test';\ncheck('x', () => {});",
    "import { test } from 'node:test';\ntest.skip('x', () => {});"])
    assert.equal(registersTests('a.ts', source), true, source);

  const lanes = readLanes(ROOT);
  const files = [...new Set(Object.values(lanes).flatMap(lane => lane.node))].sort();
  const missing = new Map<string, { count: number, detail: string }>();
  for (const path of files) {
    if (registersTests(path, readFileSync(join(ROOT, path), 'utf8'))) continue;
    const key = `no-test:${areaOf(path)}`;
    const entry = missing.get(key) ?? { count: 0, detail: '' };
    missing.set(key, { count: entry.count + 1, detail: entry.detail || `first: ${path}` });
  }
  if (process.argv.includes('--list')) for (const [key, { count }] of [...missing].sort()) console.log(`${count}\t${key}`);
  const without = [...missing.values()].reduce((sum, item) => sum + item.count, 0);
  report('node-tests', ratchet(missing, loadBaseline('nodeTests')),
    `${files.length} lane node files; ${files.length - without} register node:test tests, ${without} recorded that do not, none growing (planted cases fire)`);
});
