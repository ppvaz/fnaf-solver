#!/usr/bin/env node
// Scientific scoring and the default-off census option are part of the green lane.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { score, windowCode } from '../../review/venue-grid/encounter-replay.ts';
import { Sim } from '@sixam/source/fnaf2';
import { applySimOpts } from '../bin/census/winner-census.mjs';
import { STRATEGY_REGISTRY, validateWinner } from '../bin/plans/bundle.mjs';
import { fileURLToPath } from 'node:url';
import { currentPath } from '@sixam/review/renamed-path';

// A binding as the committed record names it, where the file lives now (records keep their paths).
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const current = (path) => currentPath(ROOT, path) ?? path;

assert.deepEqual(score('..CB?', '.'), {
  hits: 0, occ: 2, read: 4, agreeRead: 1, comparedRead: 1, unknownModel: 3,
}, 'an early death must not agree with an unplayed empty window');
assert.deepEqual(score('.C?B', '.C.B'), {
  hits: 2, occ: 2, read: 3, agreeRead: 3, comparedRead: 3, unknownModel: 0,
}, 'unread phone windows do not enter the comparison');
assert.equal(score('.', '?').unknownModel, 1, 'an unclassified model character is UNKNOWN');
assert.equal(windowCode(null, 1500, 1499), '?', 'a terminally truncated empty window is UNKNOWN');
assert.equal(windowCode(null, 1500, 1500), '.', 'a fully observed empty window is empty');
assert.equal(windowCode('withchica', 1500, 1499), 'C', 'a positive occupant read survives terminal truncation');

const record = JSON.parse(readFileSync(new URL('../../../docs/evidence/model-encounter-fidelity-20260927.json', import.meta.url)));
assert.equal(record.id, 'model-encounter-fidelity-20260927');
assert.match(record.claimLevel, /^MODEL_ONLY/);
assert.match(record.verdict, /S2 remains OPEN/);
let scored = 0;
for (const night of record.nights) {
  for (const variant of ['baseline', 'gated', 'cam8', 'rollResolution']) {
    if (!Array.isArray(night[variant])) continue;
    for (const row of night[variant]) {
      assert.deepEqual(row.score, score(night.phoneWindows, row.windows), `${night.name}/${variant}/${row.seed}`);
      scored++;
    }
  }
}
assert.ok(record.nights.find(n => n.name === 'tw-04').gated[0].score.unknownModel > 0);
assert.deepEqual(record.census.method.simOpts, ['sourcedGatedEvery']);
assert.equal(record.census.method.heldOutBlock.n, 0);
assert.equal(record.census.method.population.count, 3000);
for (const row of record.census.bindings) {
  const bytes = readFileSync(new URL(`../../../${current(row.binding)}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), row.winnerSha256,
    `${row.binding} must still be the binding censused`);
  assert.equal(row.design.n, 3000);
  assert.equal(row.heldOut.n, 0);
  assert.equal(row.wins + Object.values(row.deaths).reduce((a, b) => a + b, 0), row.n);
}

// Constructor-time options are refused: the census only injects options whose
// semantics are read at tick time. Enabling one on the first tick must behave
// exactly like requesting it at construction.
assert.throws(() => applySimOpts(['sourcedFoxyChain']), /not a tick-time option/);
const base = { night: 6, seed: 23, lethal: false, boxEnabled: false, foxyEnabled: false };
const explicit = new Sim({ ...base, sourcedGatedEvery: true });
const injected = new Sim(base);
assert.equal(injected.opts.sourcedGatedEvery, false);
applySimOpts(['sourcedGatedEvery']);
for (let i = 0; i < 1800; i++) {
  if (i % 400 === 0) { explicit.setMask(true); injected.setMask(true); }
  if (i % 400 === 320) { explicit.setMask(false); injected.setMask(false); }
  explicit.tick(); injected.tick();
}
assert.equal(injected.opts.sourcedGatedEvery, true);
assert.deepEqual([injected.events, injected.gatedEvery, injected.rng.state],
  [explicit.events, explicit.gatedEvery, explicit.rng.state], 'first-tick injection preserves the constructor-option replay');
assert.throws(() => applySimOpts(['sourcedGatedEvery']), /already applied/);
// Replay retained losses exactly and probe every all-win night-binding. The
// large-loss rows retain a digest rather than the complete loss list; this
// bounded gate does not pretend to rerun the full 84,000-night comparison.
let replays = 0;
for (const row of record.census.bindings) {
  const winner = validateWinner(JSON.parse(readFileSync(new URL(`../../../${current(row.binding)}`, import.meta.url))));
  const { replay } = STRATEGY_REGISTRY[winner.strategy].emit(winner, row.night);
  if (row.wins === row.n) {
    for (const seed of [1, 1777]) {
      assert.equal(replay(seed).sim.won, true, `${row.binding}/${row.night}/${seed} option-on census win`);
      replays++;
    }
  } else if (row.losses) {
    for (const [seed, reason, frame] of row.losses.slice(0, 2)) {
      const { sim } = replay(seed);
      assert.equal(sim.won, false);
      assert.deepEqual([sim.death?.reason, sim.frame], [reason, frame], `${row.binding}/${seed} recorded loss`);
      replays++;
    }
  }
}
assert.ok(replays > 0);
console.log(`encounter fidelity: ${scored} rows score missing model windows UNKNOWN; ${replays} option-on census probes match; 3000 design / 0 held-out seeds; first-tick injection matches construction`);
