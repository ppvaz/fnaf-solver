#!/usr/bin/env node
// Every TODO, FIXME, XXX or HACK names the work that will close it: a plan
// (`TODO(Plan 12)`), a ROADMAP step (`TODO(S4)`), an ADR (`TODO(ADR 0002)`) or
// an issue (`TODO(#42)`). A marker with no owner is a promise nobody holds;
// with one it is a pointer a reader can follow and a query can count. The tree
// had none on 2026-09-30, so there is no baseline: the first unreferenced
// marker fails.
//
//   node tools/test-todo-refs.ts     exit 0 clean, 1 naming file and line
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, repoFiles, report } from './gate-kit.ts';

const SOURCE = /\.(?:js|mjs|cjs|ts|mts|py|java|kt|sh|c|cc|cpp|h|hpp|cs|html|css|yml|yaml)$/;
// A comment that carries a marker: `//`, `#`, `/*`, a block comment's `*`, or `<!--`.
const MARKER = /(?:\/\/|#|\/\*|^\s*\*|<!--).*?\b(TODO|FIXME|XXX|HACK)\b(.*)$/;
const REFERENCE = /^\s*\((?:Plan \d+|S[1-7][a-z]?|ADR \d{4}|#\d+)\)/;

export function unreferenced(path: string, text: string) {
  const found = [];
  text.split('\n').forEach((line, index) => {
    const match = line.match(MARKER);
    if (match && !REFERENCE.test(match[2])) found.push(`${path}:${index + 1}: ${match[1]} without (Plan N | S1-S7 | ADR NNNN | #issue)`);
  });
  return found;
}

// Planted cases run first and must be caught.
assert.equal(unreferenced('a.js', '// TODO improve this someday').length, 1, 'an unowned TODO must be caught');
assert.equal(unreferenced('a.py', '    # FIXME: flaky').length, 1, 'a Python FIXME must be caught');
assert.equal(unreferenced('a.js', ' * HACK around the clock').length, 1, 'a block-comment HACK must be caught');
assert.deepEqual(unreferenced('a.js', '// TODO(S4) move the scheduler\n// FIXME(Plan 12) attest\n# XXX(#7)'), []);
assert.deepEqual(unreferenced('a.js', "const serial = 'XXXX'; // a placeholder\nconst todo = [];"), [],
  'a marker outside a comment and a word that contains one are not markers');

const files = repoFiles().filter(path => SOURCE.test(path) && path !== 'tools/test-todo-refs.ts');
const failures = files.flatMap(path => unreferenced(path, readFileSync(join(ROOT, path), 'utf8')));
report('todo-refs', failures, `${files.length} files; every TODO, FIXME, XXX and HACK names its plan, step, ADR or issue`);
