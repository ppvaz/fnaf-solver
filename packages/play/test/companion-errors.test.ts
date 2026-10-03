/**
 * The host half of the Companion's refusal vocabulary (companion-errors-v1.txt;
 * ControlErrorsTest.java holds the Companion's half). The host's REGION limits
 * must be the Companion's, and every quoted `ERROR <word>` in Play's and the
 * desktop's code, tests and mocks -- each one a host copy of what the Companion
 * says -- must be a word the Companion sends. A fake that answers a word the
 * real helper never does tests a protocol that does not exist.
 * CONTRACT:cue-helper-control-v1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGION_LIMITS } from '../src/venues/phone/companion.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const vector = readFileSync(new URL('testdata/companion-errors-v1.txt', import.meta.url), 'utf8').split('\n');
const errors = new Set(vector.filter(row => row.startsWith('error: ')).map(row => row.slice(7)));
const limit = (name: string) => {
  const row = vector.find(line => line.startsWith(`limit: ${name} `));
  if (row === undefined) throw new Error(`companion-errors-v1.txt names no ${name} limit`);
  return Number(row.slice(`limit: ${name} `.length));
};

// Where the host speaks for the Companion: its codec and ports, the runners, the
// desktop, and the tests and mocks that stand in for the helper.
const SCANNED = ['packages/play/src', 'packages/play/bin', 'packages/play/games', 'packages/play/test',
  'apps/desktop/src', 'apps/desktop/bin', 'apps/desktop/test'];
const QUOTED = /['"`]ERROR ([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/g;

/** Every quoted ERROR word under the scanned trees, with the file that quotes it. */
function quotedWords() {
  const found: { file: string, word: string }[] = [];
  for (const tree of SCANNED) {
    for (const entry of readdirSync(join(ROOT, tree), { recursive: true, encoding: 'utf8' })) {
      if (!/\.(ts|sh|py)$/.test(entry)) continue;
      const path = join(ROOT, tree, entry);
      for (const match of readFileSync(path, 'utf8').matchAll(QUOTED))
        found.push({ file: relative(ROOT, path), word: match[1] });
    }
  }
  return found;
}

test('the host\'s REGION limits are the Companion\'s', () => {
  assert.equal(REGION_LIMITS.regions, limit('regions'));
  assert.equal(REGION_LIMITS.samples, limit('samples'));
  assert.equal(REGION_LIMITS.step, limit('step'));
});

test('every ERROR word the host quotes is one the Companion sends', () => {
  assert.ok(errors.size > 0, 'the vector names error words');
  const quoted = quotedWords();
  assert.ok(quoted.length > 0, 'the scan found the host\'s quoted error words');
  const invented = quoted.filter(({ word }) => !errors.has(word)).map(({ file, word }) => `${file}: ERROR ${word}`);
  assert.deepEqual(invented, [], 'a word the Companion never sends');
});
