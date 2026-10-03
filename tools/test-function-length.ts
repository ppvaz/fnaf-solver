#!/usr/bin/env node
// No function grows past MAX_LINES. The file ceiling (tools/test-file-size.ts)
// let a 1,169-line execute() live inside a 1,640-line file: a function that long
// holds several concerns, keeps dozens of mutable locals, and can only be tested
// whole. Each function, method or arrow whose body spans more than MAX_LINES
// lines is a finding keyed by its file and qualified name and counted in lines.
// The ones recorded in tools/quality-baseline.json (`functionLength`) each name
// the split that remains and why it is not done yet, and only shrink
// (tools/gate-kit.ts); a new one fails.
//
//   node tools/test-function-length.ts          exit 0 clean, 1 naming each function
//   node tools/test-function-length.ts --list   print every function over the limit
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { ROOT, loadBaseline, ratchet, repoFiles, report } from './gate-kit.ts';

export const MAX_LINES = 200;

type Fn = ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression |
  ts.ConstructorDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration;
const isFn = (node: ts.Node): node is Fn => ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
  ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isConstructorDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);

/** The name a function is known by in its file: its own, its variable's or property's, or `<callee> callback`. */
function nameOf(node: Fn): string {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isPrivateIdentifier(node.name))) return node.name.text;
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent) && (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))) return parent.name.text;
  if (ts.isCallExpression(parent)) {
    const callee = parent.expression;
    return `${ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : 'call'} callback`;
  }
  return 'anonymous';
}

/** Functions whose body spans more than MAX_LINES lines, keyed `fn:PATH#outer/inner`. */
export function longFunctions(path: string, text: string) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = new Map<string, { count: number, detail: string }>();
  const visit = (node: ts.Node, scope: readonly string[]) => {
    let inner = scope;
    if (isFn(node) && node.body) {
      const owner = node.parent && ts.isClassLike(node.parent) && node.parent.name ? `${node.parent.name.text}.` : '';
      inner = [...scope, owner + nameOf(node)];
      const lines = file.getLineAndCharacterOfPosition(node.body.getEnd()).line -
        file.getLineAndCharacterOfPosition(node.body.getStart(file)).line + 1;
      if (lines > MAX_LINES) {
        const base = `fn:${path}#${inner.join('/')}`;
        let key = base;
        for (let n = 2; found.has(key); n += 1) key = `${base}~${n}`;
        found.set(key, { count: lines, detail: `${lines} lines, limit ${MAX_LINES}` });
      }
    }
    node.forEachChild(child => visit(child, inner));
  };
  visit(file, []);
  return found;
}

// Planted cases run first and must be caught.
{
  const body = (lines: number) => Array.from({ length: lines - 2 }, (_, i) => `  step(${i});`).join('\n');
  const planted = longFunctions('a.ts', [
    `function long() {\n${body(MAX_LINES + 1)}\n}`,
    `function exact() {\n${body(MAX_LINES)}\n}`,
    `const outer = () => {\n  const inner = () => {\n${body(MAX_LINES + 1)}\n  };\n  inner();\n};`,
  ].join('\n'));
  assert.deepEqual([...planted.keys()], ['fn:a.ts#long', 'fn:a.ts#outer', 'fn:a.ts#outer/inner'],
    'a body over the limit is caught, one at the limit is not, and a nested function is named inside its owner');
  assert.equal(planted.get('fn:a.ts#long')?.count, MAX_LINES + 1);
}

const found = new Map<string, { count: number, detail: string }>();
for (const path of repoFiles().filter(f => /\.m?ts$/.test(f) && !f.endsWith('.d.ts')))
  for (const [key, value] of longFunctions(path, readFileSync(join(ROOT, path), 'utf8'))) found.set(key, value);
if (process.argv.includes('--list'))
  for (const [key, { count }] of [...found].sort((a, b) => b[1].count - a[1].count)) console.log(`${count}\t${key}`);
report('function-length', ratchet(found, loadBaseline('functionLength')),
  `${found.size} function(s) over ${MAX_LINES} lines, each recorded and not growing`);
