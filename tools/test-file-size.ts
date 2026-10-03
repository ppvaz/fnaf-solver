#!/usr/bin/env node
// No source file grows past the ceiling. Pedro's working agreement sets ~2,000
// lines as the hard ceiling and asks for the refactor before a file crosses it,
// not after; until 2026-09-30 nothing measured it, and plant-model.js had
// reached 2,719 lines. Files already over are recorded in
// tools/quality-baseline.json (`fileSize`) at their length and may only shrink
// (tools/gate-kit.ts); a file that crosses WARN_AT is named, without failing,
// so the split can be planned while it is still cheap.
//
//   node tools/test-file-size.ts     exit 0 clean, 1 naming each file
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadBaseline, ratchet, repoFiles, report } from './gate-kit.ts';

export const CEILING = 2000;
export const WARN_AT = 1800;
const SOURCE = /\.(?:js|mjs|cjs|ts|mts|py|java|kt|sh|c|cc|cpp|h|hpp|cs)$/;

export const lineCount = (text: string) => text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

/** @param files path and text */
export function oversized(files: Iterable<[string, string]>) {
  const found = new Map();
  const near = [];
  for (const [path, text] of files) {
    if (!SOURCE.test(path)) continue;
    const lines = lineCount(text);
    if (lines > CEILING) found.set(path, { count: lines, detail: `${lines} lines, ceiling ${CEILING}` });
    else if (lines > WARN_AT) near.push(`${path} (${lines})`);
  }
  return { found, near };
}

// Planted cases run first and must be caught.
{
  const long = 'x\n'.repeat(CEILING + 1);
  const planted = oversized([['a/long.js', long], ['a/short.py', 'x\n'], ['a/notes.md', long]]);
  assert.deepEqual([...planted.found.keys()], ['a/long.js'], 'a source file over the ceiling must be caught; prose is not source');
  assert.deepEqual(ratchet(planted.found, { entries: {} }), [`a/long.js: new (${CEILING + 1} lines, ceiling ${CEILING})`]);
  const accepted = (count: number) => ({ entries: { 'a/long.js': { count, why: 'a planted reason' } } });
  assert.deepEqual(ratchet(planted.found, accepted(CEILING + 1)), []);
  assert.match(ratchet(planted.found, { entries: { 'a/long.js': CEILING + 1 } })[0], /bare count/,
    'a bare count must be refused: an entry names why it is accepted');
  assert.match(ratchet(planted.found, accepted(CEILING + 5))[0], /shrank .*lower its entry/,
    'a recorded file that shrank must lower its entry');
  assert.match(ratchet(new Map(), accepted(CEILING + 1))[0], /gone; remove its entry/);
  assert.equal(lineCount('a\nb\n'), 2);
  assert.equal(lineCount('a\nb'), 2);
}

const files = repoFiles().filter(path => SOURCE.test(path)).map((path): [string, string] => [path, readFileSync(join(ROOT, path), 'utf8')]);
const { found, near } = oversized(files);
if (near.length) console.log(`file-size: over ${WARN_AT} lines, plan the split now: ${near.join(', ')}`);
report('file-size', ratchet(found, loadBaseline('fileSize')),
  `${files.length} source files; ${found.size} over ${CEILING} lines, each recorded and not growing`);
