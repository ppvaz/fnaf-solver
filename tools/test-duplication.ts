#!/usr/bin/env node
// No copied code between two files. Two call sites doing the same thing is a
// coincidence and three a pattern (the working agreement), but a block pasted
// from one file into another is neither: it is one rule kept in two places,
// and the day one copy is fixed the other is wrong. Some repetition is meant --
// the hand model and the recompiled game are independent readings on purpose
// (ADR 0002's venue grid) -- and a pair whose copies are intended is recorded
// with that reason.
//
// A clone is a run of at least WINDOW consecutive normalised lines that two
// files share: trimmed, with blank, comment-only and punctuation-only lines
// dropped, so formatting and comments do not hide a copy. Tests, fixtures and
// frozen records are not scanned. Each pair of files is one finding, counted
// in shared normalised lines; the pairs that existed when this landed are in
// tools/quality-baseline.json (`duplication`) and only shrink (tools/gate-kit.ts).
//
//   node tools/test-duplication.ts            exit 0 clean, 1 naming each pair
//   node tools/test-duplication.ts --list     print every pair with its first shared line
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadBaseline, ratchet, repoFiles, report } from './gate-kit.ts';

export const WINDOW = 6;
const SCRIPT = /\.(?:js|mjs|cjs|ts|mts)$/;
const scanned = path => SCRIPT.test(path) && /^(?:packages|apps|tools|android)\//.test(path) &&
  !/(?:^|\/)(?:test|tests|testdata|fixtures?)\//.test(path) && !/(?:^|\/)test[^/]*\.|\.test\.|\.d\.ts$/.test(path);

/** The lines that carry code, each with its line number. */
export function normalise(text: string) {
  const lines = [];
  let block = false;
  text.split('\n').forEach((raw, index) => {
    let line = raw.trim();
    if (block) {
      if (!line.includes('*/')) return;
      line = line.slice(line.indexOf('*/') + 2).trim();
      block = false;
    }
    if (line.startsWith('/*') && !line.includes('*/')) { block = true; return; }
    if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*') || line.startsWith('#!')) return;
    if (/^[\s{}()[\];,.]*$/.test(line)) return;
    if (/^(?:import|export)\b.*\bfrom\b/.test(line) || /^import\s+['"]/.test(line)) return;
    lines.push({ line: index + 1, text: line.replace(/\s+/g, ' ') });
  });
  return lines;
}

/**
 * Shared normalised lines per pair of files.
 * @param files path -> text
 */
export function clones(files: Map<string, string>) {
  const windows: Map<string, {path: string, at: number}[]> = new Map();
  const normalised = new Map();
  for (const [path, text] of files) {
    const lines = normalise(text);
    normalised.set(path, lines);
    for (let at = 0; at + WINDOW <= lines.length; at += 1) {
      const key = createHash('sha1').update(lines.slice(at, at + WINDOW).map(({ text: code }) => code).join('\n')).digest('hex');
      if (!windows.has(key)) windows.set(key, []);
      windows.get(key).push({ path, at });
    }
  }
  const pairs: Map<string, {covered: Set<string>, first: string}> = new Map();
  for (const occurrences of windows.values()) {
    const paths = [...new Set(occurrences.map(({ path }) => path))];
    if (paths.length < 2) continue;
    for (let i = 0; i < occurrences.length; i += 1) for (let j = i + 1; j < occurrences.length; j += 1) {
      const [a, b] = [occurrences[i], occurrences[j]].sort((x, y) => x.path.localeCompare(y.path));
      if (a.path === b.path) continue;
      const key = `${a.path} <> ${b.path}`;
      if (!pairs.has(key)) pairs.set(key, { covered: new Set(), first: `${a.path}:${normalised.get(a.path)[a.at].line}` });
      for (let k = 0; k < WINDOW; k += 1) pairs.get(key).covered.add(`${a.at + k}`);
    }
  }
  return new Map([...pairs].map(([key, { covered, first }]) => [`clone:${key}`, { count: covered.size, detail: `from ${first}` }]));
}

// Planted cases run first and must be caught.
{
  const block = Array.from({ length: WINDOW + 3 }, (_, i) => `const value${i} = compute(${i}, state.step${i});`).join('\n');
  const found = clones(new Map([
    ['packages/a/src/one.js', `// one\n${block}\n`],
    ['packages/b/src/two.js', `/* two */\n${block.replaceAll('  ', ' ')}\n\n}\n`],
    ['packages/c/src/three.js', block.split('\n').slice(0, WINDOW - 1).join('\n')],
  ]));
  assert.deepEqual([...found.keys()], ['clone:packages/a/src/one.js <> packages/b/src/two.js'],
    'a pasted block must be caught across comments and blank lines, and a shorter run must not');
  assert.equal(found.get('clone:packages/a/src/one.js <> packages/b/src/two.js').count, WINDOW + 3);
  assert.deepEqual(normalise('/*\n * doc\n */\nconst a = 1; // x\n}\n\n'), [{ line: 4, text: 'const a = 1; // x' }]);
}

const files = new Map(repoFiles().filter(scanned).map(path => [path, readFileSync(join(ROOT, path), 'utf8')]));
const found = clones(files);
if (process.argv.includes('--list'))
  for (const [key, { count, detail }] of [...found].sort((a, b) => b[1].count - a[1].count)) console.log(`${count}\t${key}\t${detail}`);
report('duplication', ratchet(found, loadBaseline('duplication')),
  `${files.size} files; ${found.size} pair(s) share runs of ${WINDOW}+ lines, each recorded and not growing`);
