#!/usr/bin/env node
// One definition per measured constant (tools/measured-constants.json; CLAUDE.md mistake register 9: a
// number that decides behaviour lives where a check reads it). A second `const NAME = <number>` (or Java's
// `final ... NAME = <number>`) of a registered name or alias, anywhere but its registered file, is a copy
// that a re-measurement leaves stale: FUSION_POLL_MS stood in three files, MIN_CONTACT_MS in two and the
// start delay in Play and the Companion. A copy imported or derived (`= DEFAULT_READY_DELAY_MS`,
// `= Math.round(C.MONITOR_ANIM_DOWN ...)`) is not a definition. The copies that existed when this landed
// are recorded in tools/quality-baseline.json (`measuredConstants`) and only shrink.
//
//   node tools/test-measured-constants.ts     exit 0 when no copy grew, 1 naming each
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { isList, isRecord } from '@sixam/kernel';
import { ROOT, loadBaseline, ratchet, repoFiles, report } from './gate-kit.ts';
import { parse } from './module-refs.ts';

const REGISTER = 'tools/measured-constants.json';

/** Each registered name and alias, with the one file that defines it. */
function register(root: string) {
  const record: unknown = JSON.parse(readFileSync(join(root, REGISTER), 'utf8'));
  if (!isRecord(record) || record.schema !== 'measured-constants-v1' || !isRecord(record.constants)) throw new Error(`${REGISTER}: not measured-constants-v1`);
  const owners = new Map<string, { name: string, file: string }>();
  for (const [name, entry] of Object.entries(record.constants)) {
    if (!isRecord(entry) || typeof entry.file !== 'string' || !isList(entry.aliases) || typeof entry.measured !== 'string')
      throw new Error(`${REGISTER}: ${name} needs file, aliases and measured`);
    for (const alias of [name, ...entry.aliases]) owners.set(String(alias), { name, file: entry.file });
  }
  return owners;
}

/** Every numeric-literal definition of a registered name in one file, as [line, name]. */
export function literalDefinitions(path: string, text: string, names: ReadonlySet<string>): [number, string][] {
  if (path.endsWith('.java')) {
    const found: [number, string][] = [];
    for (const match of text.matchAll(/\bfinal\s+[\w<>]+\s+([A-Z_][A-Z0-9_]*)\s*=\s*-?[\d_.]+[LlFfDd]?\s*;/g))
      if (names.has(match[1])) found.push([text.slice(0, match.index).split('\n').length, match[1]]);
    return found;
  }
  const file = parse(path, text);
  const found: [number, string][] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.has(node.name.text) && node.initializer) {
      const value = ts.isPrefixUnaryExpression(node.initializer) ? node.initializer.operand : node.initializer;
      if (ts.isNumericLiteral(value)) found.push([file.getLineAndCharacterOfPosition(node.getStart()).line + 1, node.name.text]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

// Planted: a literal copy is refused in TypeScript and Java; an import, a derivation and the owner are not.
{
  const names = new Set(['FUSION_POLL_MS', 'READY_DELAY_MS']);
  assert.deepEqual(literalDefinitions('a.ts', 'export const FUSION_POLL_MS = 33;\nconst READY_DELAY_MS = 7_000;', names),
    [[1, 'FUSION_POLL_MS'], [2, 'READY_DELAY_MS']]);
  assert.deepEqual(literalDefinitions('a.ts', "import { FUSION_POLL_MS } from 'x';\nconst READY_DELAY_MS = DEFAULT_READY_DELAY_MS;\n" +
    'const FUSION_POLL_MS = Math.round(1000 / 30);', names), []);
  assert.deepEqual(literalDefinitions('A.java', 'private static final int READY_DELAY_MS = 7_000;', names), [[1, 'READY_DELAY_MS']]);
}

const owners = register(ROOT);
const copies = new Map<string, { count: number, detail: string }>();
for (const [alias, { file }] of owners)
  if (!existsSync(join(ROOT, file))) throw new Error(`${REGISTER}: ${alias} names ${file}, which does not exist`);
const names = new Set(owners.keys());
const owned = new Set<string>();
for (const path of repoFiles(ROOT).filter(file => /\.(?:m?js|cjs|ts|mts|java)$/.test(file) && !file.endsWith('.d.ts'))) {
  for (const [line, name] of literalDefinitions(path, readFileSync(join(ROOT, path), 'utf8'), names)) {
    const owner = owners.get(name) as { name: string, file: string };   // names are the register's keys
    if (path === owner.file) { owned.add(owner.name); continue; }
    const key = `copy:${owner.name}`;
    const entry = copies.get(key) ?? { count: 0, detail: '' };
    copies.set(key, { count: entry.count + 1, detail: `${entry.detail ? `${entry.detail}, ` : ''}${path}:${line}` });
  }
}
const unowned = [...new Set([...owners.values()].map(owner => owner.name))].filter(name => !owned.has(name));
report('measured-constants', [...unowned.map(name => `${name}: ${owners.get(name)?.file} does not define it as a number`),
  ...ratchet(copies, loadBaseline('measuredConstants'))],
`${owned.size} measured constants each defined once, in its registered file; ${[...copies.values()].reduce((sum, item) => sum + item.count, 0)} recorded copies, none growing`);
