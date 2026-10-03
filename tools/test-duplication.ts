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
// files share: types erased by Node's own stripper (so a copy that gained
// annotations in one file is still a copy), trimmed, with blank, comment-only
// and punctuation-only lines dropped, so formatting and comments do not hide a
// copy. Tests are scanned like any other code -- a test harness pasted into
// six files drifts like any other copy -- and only test data and fixtures are
// not. Each pair of files is one finding, counted in shared normalised lines;
// a pair is accepted only as a `{count, why}` entry in
// tools/quality-baseline.json (`duplication`) naming why its copies are meant,
// and an entry only shrinks (tools/gate-kit.ts).
//
//   node tools/test-duplication.ts            exit 0 clean, 1 naming each pair
//   node tools/test-duplication.ts --list     print every pair with its first shared line
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';
import { ROOT, loadBaseline, ratchet, repoFiles, report } from './gate-kit.ts';

export const WINDOW = 6;
const SCRIPT = /\.(?:js|mjs|cjs|ts|mts)$/;
export const scanned = (path: string) => SCRIPT.test(path) && /^(?:packages|apps|tools|android)\//.test(path) &&
  !/(?:^|\/)(?:testdata|fixtures?)\//.test(path) && !/\.d\.ts$/.test(path);

/**
 * A module's text with its types erased, positions kept (Node's `strip` mode
 * blanks what it removes), so line numbers still name the source.
 * @param path decides whether there are types to erase
 */
export function untyped(path: string, text: string) {
  if (!/\.m?ts$/.test(path)) return text;
  try { return stripTypeScriptTypes(text, { mode: 'strip' }); } catch { return text; }
}

/** The lines that carry code, each with its line number. */
export function normalise(text: string) {
  const lines: { line: number, text: string }[] = [];
  let block = false;
  // An import, or an export list, spread over several lines: naming the same
  // modules is not copying code, so the whole statement is skipped.
  let names = false;
  text.split('\n').forEach((raw, index) => {
    let line = raw.trim();
    if (block) {
      if (!line.includes('*/')) return;
      line = line.slice(line.indexOf('*/') + 2).trim();
      block = false;
    }
    if (names) {
      if (line.includes('}')) names = false;
      return;
    }
    if (line.startsWith('/*') && !line.includes('*/')) { block = true; return; }
    if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*') || line.startsWith('#!')) return;
    if (/^[\s{}()[\];,.]*$/.test(line)) return;
    if (/^(?:import|export)\b.*\bfrom\b/.test(line) || /^import\s+['"]/.test(line)) return;
    if (/^(?:import|export)\s+(?:type\s+)?\{[^}]*$/.test(line) || /^import\s+[\w$]+\s*,\s*\{[^}]*$/.test(line)) { names = true; return; }
    // Spaces a type stripper leaves before punctuation (`x as T,` becomes `x      ,`) are not code.
    lines.push({ line: index + 1, text: line.replace(/\s+/g, ' ').replace(/ ([,;:)\]}])/g, '$1').replace(/([([{]) /g, '$1') });
  });
  return lines;
}

/**
 * Shared normalised lines per pair of files.
 * @param files path -> text
 */
export function clones(files: Map<string, string>) {
  const windows: Map<string, {path: string, at: number}[]> = new Map();
  const normalised = new Map<string, ReturnType<typeof normalise>>();
  for (const [path, text] of files) {
    const lines = normalise(untyped(path, text));
    normalised.set(path, lines);
    for (let at = 0; at + WINDOW <= lines.length; at += 1) {
      const key = createHash('sha1').update(lines.slice(at, at + WINDOW).map(({ text: code }) => code).join('\n')).digest('hex');
      if (!windows.has(key)) windows.set(key, []);
      (windows.get(key) as { path: string, at: number }[]).push({ path, at }); // set just above when missing
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
      // Every path a window names was normalised above, and a pair is set just above when missing.
      if (!pairs.has(key)) pairs.set(key, { covered: new Set(), first: `${a.path}:${(normalised.get(a.path) as ReturnType<typeof normalise>)[a.at].line}` });
      for (let k = 0; k < WINDOW; k += 1) (pairs.get(key) as { covered: Set<string> }).covered.add(`${a.at + k}`);
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
  assert.equal(found.get('clone:packages/a/src/one.js <> packages/b/src/two.js')?.count, WINDOW + 3);
  assert.deepEqual(normalise('/*\n * doc\n */\nconst a = 1; // x\n}\n\n'), [{ line: 4, text: 'const a = 1; // x' }]);
  assert.deepEqual(normalise("import {\n  a,\n  b,\n} from './x.ts';\nexport {\n  c,\n};\nconst d = 1;\n"), [{ line: 8, text: 'const d = 1;' }],
    'an import or export list spread over lines is not code');
  // A copy that differs only in its types is still a copy.
  const untypedBlock = Array.from({ length: WINDOW }, (_, i) => `const value${i} = compute(state, ${i});`).join('\n');
  const typedBlock = Array.from({ length: WINDOW }, (_, i) => `const value${i}: number = compute(state as State, ${i});`).join('\n');
  assert.deepEqual([...clones(new Map([['packages/a/src/one.ts', untypedBlock], ['packages/b/src/two.ts', typedBlock]])).keys()],
    ['clone:packages/a/src/one.ts <> packages/b/src/two.ts'], 'a copy that only gained types must be caught');
  // Tests are scanned; test data and fixtures are not.
  assert.ok(scanned('apps/trainer/test/browser.test.ts') && scanned('packages/play/test/campaign.test.ts'), 'tests must be scanned');
  assert.ok(!scanned('packages/play/test/testdata/mock.ts') && !scanned('packages/source/recompile/fixtures/a.ts'), 'fixtures must not be');
}

const files = new Map(repoFiles().filter(scanned).map(path => [path, readFileSync(join(ROOT, path), 'utf8')]));
const found = clones(files);
if (process.argv.includes('--list'))
  for (const [key, { count, detail }] of [...found].sort((a, b) => b[1].count - a[1].count)) console.log(`${count}\t${key}\t${detail}`);
report('duplication', ratchet(found, loadBaseline('duplication')),
  `${files.size} files; ${found.size} pair(s) share runs of ${WINDOW}+ lines, each recorded and not growing`);
