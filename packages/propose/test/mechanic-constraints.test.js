// A strategy declares the FNaF 2 mechanics it requires, and a run's
// constraints may forbid one. Minus Toys and Minus 3 arm the camera split (the
// double-camera glitch) before their first loop; Minus 7 keeps the monitor
// down and needs none.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMERA_SPLIT, FNAF2_MECHANICS } from '@sixam/source/games/fnaf2/mechanics.js';
import { MANIFEST as MINUS_TOYS } from '@sixam/propose/strategies/minus-toys';
import { MANIFEST as MINUS_3 } from '@sixam/propose/strategies/minus-3';
import { MANIFEST as MINUS_7 } from '@sixam/propose/parked/minus7';
import { STRATEGY_REGISTRY, compileBundle } from '../bin/plans/bundle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const EMIT = join(HERE, '../bin/plans/emit.mjs');
const K3 = join(HERE, '../bindings/fnaf2/campaign-night7-k3-winner.json');
const MINUS7_WINNER = join(HERE, '../bindings/fnaf2/campaign-night1-minus7-winner.json');
const FORBID_SPLIT = { constraints: { forbidMechanics: [CAMERA_SPLIT] } };
const fixture = (strategy, nights) => ({
  schema: 'winner-v1', strategy, knobs: 'KNOBS0', nights, engineHash: 'mechanic-constraints-fixture',
  seeds: [1], gate: { status: 'PASS', claimLevel: 'MODEL_ONLY' },
});
const refusal = strategy => new RegExp(`^TypeError: device bundle: strategy ${strategy} requires ` +
  `fnaf2\\.camera-split \\(the double-camera glitch\\), which the run's constraints forbid$`);

// -- Source names the mechanic once, and the section it cites exists.
assert.equal(CAMERA_SPLIT, 'fnaf2.camera-split');
const split = FNAF2_MECHANICS[CAMERA_SPLIT];
assert.equal(split.id, CAMERA_SPLIT);
assert.equal(split.label, 'SOURCED');
assert.ok(split.groups.includes('g263'), 'the split cites the last-viewed sampler');
const [doc, section] = split.cites.split(' §');
assert.match(readFileSync(join(ROOT, doc), 'utf8'), new RegExp(`^## ${section}\\. .*double-camera glitch`, 'm'));

// -- the strategies that need it declare it where they are defined, and the
//    bundle's registry carries exactly those declarations.
assert.deepEqual(MINUS_TOYS.requires, [CAMERA_SPLIT]);
assert.deepEqual(MINUS_3.requires, [CAMERA_SPLIT]);
assert.deepEqual(MINUS_7.requires, []);
assert.equal(STRATEGY_REGISTRY['minus-toys'].requires, MINUS_TOYS.requires);
assert.equal(STRATEGY_REGISTRY.minus3.requires, MINUS_3.requires);
assert.equal(STRATEGY_REGISTRY.minus7.requires, MINUS_7.requires);
for (const [strategy, entry] of Object.entries(STRATEGY_REGISTRY))
  for (const id of entry.requires)
    assert.ok(Object.hasOwn(FNAF2_MECHANICS, id), `${strategy} requires ${id}, which Source does not name`);

const scratch = mkdtempSync(join(tmpdir(), 'mechanic-constraints-'));
try {
  // -- a split-requiring strategy under a constraint that forbids the split
  //    is refused with the plain message, before anything is written.
  for (const [strategy, nights] of [['minus-toys', [2]], ['minus3', [3]]]) {
    const out = join(scratch, `refused-${strategy}`);
    assert.throws(() => compileBundle(fixture(strategy, nights), out, FORBID_SPLIT),
      error => refusal(strategy).test(String(error)));
    assert.equal(existsSync(out), false, `${strategy}: a refused build wrote ${out}`);
  }

  // -- a constraint names only mechanics Source knows, and only that field.
  assert.throws(() => compileBundle(fixture('minus-toys', [2]), join(scratch, 'unknown'),
    { constraints: { forbidMechanics: ['fnaf2.camera-glitch'] } }),
  /forbidMechanics names "fnaf2\.camera-glitch", which is not a known FNaF 2 mechanic \(fnaf2\.camera-split\)/);
  assert.throws(() => compileBundle(fixture('minus-toys', [2]), join(scratch, 'typo'),
    { constraints: { forbidMechanic: [CAMERA_SPLIT] } }), /constraints has unknown field forbidMechanic/);

  // -- the default allows every known mechanic, and a constraint the strategy
  //    satisfies changes nothing: the bundles are byte-identical.
  const minus7 = JSON.parse(readFileSync(MINUS7_WINNER, 'utf8'));
  const bytes = dir => Object.fromEntries(readdirSync(dir).sort().map(file => [file, readFileSync(join(dir, file), 'utf8')]));
  compileBundle(minus7, join(scratch, 'minus7-default'));
  compileBundle(minus7, join(scratch, 'minus7-no-split'), FORBID_SPLIT);
  assert.deepEqual(bytes(join(scratch, 'minus7-no-split')), bytes(join(scratch, 'minus7-default')));

  // -- `npm run device:emit` takes the constraint and refuses the same way.
  const emitted = spawnSync(process.execPath, [EMIT, '--winner', K3, '--out', join(scratch, 'k3'),
    '--forbid-mechanic', CAMERA_SPLIT], { encoding: 'utf8' });
  assert.equal(emitted.status, 1, emitted.stderr);
  assert.match(emitted.stderr, /^device:emit: device bundle: strategy minus-toys requires fnaf2\.camera-split \(the double-camera glitch\), which the run's constraints forbid$/m);
  assert.equal(existsSync(join(scratch, 'k3')), false);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('mechanic constraints: Source names fnaf2.camera-split, Minus Toys and Minus 3 require it, ' +
  'a build that forbids it refuses them by name, and the default and a satisfied constraint build identical bundles');
