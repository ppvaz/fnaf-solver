/** The historical family commands must remain thin aliases, not second models. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMinusToys } from '../src/experiment/families/minus-toys.ts';
import { runMinusTwo } from '../src/experiment/families/minus-two.ts';
import { randomSeedCohort } from '@sixam/propose/seeds';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
// The cohort minustoystest.ts runs for `4`. The counts are whatever the current model says: an alias has to print
// the shared evaluator's, not a fixed number (on fnaf2-legacy, KNOBS0 Minus Toys won 4/4 with the split and
// 0/4 without; on fnaf2-sourced, the default since 2026-10-02, it loses both).
const seeds = randomSeedCohort({ count: 4 });
const run = (file: string, args: string[]) => execFileSync(process.execPath, [join(ROOT, file), ...args], {
  encoding: 'utf8', cwd: ROOT,
});
const survived = (results: readonly { readonly sim: { readonly won: boolean } }[]) => results.filter(result => result.sim.won).length;

const split = survived(seeds.map(seed => runMinusToys({ seed, splitCamera: true })));
const control = survived(seeds.map(seed => runMinusToys({ seed, splitCamera: false })));
assert.match(run('packages/propose/bin/minustoystest.ts', ['4']), new RegExp(`^${split}/4 survived`, 'm'));
assert.match(run('packages/propose/bin/minustoystest.ts', ['4', '--no-split']), new RegExp(`^${control}/4 survived`, 'm'));

// minus2test.ts strides its seeds by 2654435761 rather than drawing the cohort.
const strided = Array.from({ length: 4 }, (_, i) => (i * 2654435761) >>> 0);
const two = survived(strided.map(seed => runMinusTwo({ seed, flashCams: [3] })));
assert.match(run('packages/propose/bin/minus2test.ts', ['4']), new RegExp(`^${two}/4 survived`, 'm'));
console.log('research aliases: Minus Toys split/control and Minus Two match shared family evaluators');
