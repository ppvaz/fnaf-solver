/** The historical family commands must remain thin aliases, not second models. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMinusToys } from '../src/experiment/families/minus-toys.ts';
import { runMinusTwo } from '../src/experiment/families/minus-two.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const seeds = [0, 2654435761, 1013904226, 3668339987];
const run = (file, args) => execFileSync(process.execPath, [join(ROOT, file), ...args], {
  encoding: 'utf8', cwd: ROOT,
});

const toys = seeds.map(seed => runMinusToys({ seed, splitCamera: true }));
assert.equal(toys.filter(result => result.sim.won).length, 4);
assert.match(run('packages/propose/bin/minustoystest.ts', ['4', '--assert']), /4\/4 survived/);
assert.match(run('packages/propose/bin/minustoystest.ts', ['4', '--no-split', '--assert']), /0\/4 survived/);

const two = seeds.map(seed => runMinusTwo({ seed, flashCams: [3] }));
assert.equal(two.filter(result => result.sim.won).length, 0);
assert.match(run('packages/propose/bin/minus2test.ts', ['4']), /0\/4 survived/);
console.log('research aliases: Minus Toys split/control and Minus Two match shared family evaluators');
