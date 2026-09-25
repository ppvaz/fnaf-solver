#!/usr/bin/env node
// The committed winner census must still describe the tree it sits in.
//
// `winner-census.mjs` takes half an hour on eight cores, so CI does not re-run
// it. What CI can do in a second is check that nothing the record depends on
// has moved: each binding's file and emitted plan hash to what was censused,
// every loss the record lists still dies of the same cause on the same frame,
// and a fixed sample of held-out seeds replays to the outcome the record
// implies. An engine change that flips a censused night fails here, and the
// fix is to re-run the census in the diff that changed the engine.
//
// A committed winner the record does not cover is reported as
// UNCENSUSED_WINNERS, not failed: a new binding is unmeasured, not wrong.
//
// The phase census (winner-phase-census.mjs) is held the same way: its
// bindings and seed block as censused, and every band edge, the declared
// phase and each partial cell's first listed loss replaying as recorded --
// the cells an engine change would move first.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableHash } from '@fnaf2-1020/core/contracts';
import { RNG_MODULUS } from '@fnaf2-1020/core/mechanics';
import { STRATEGY_REGISTRY, validateWinner } from './device/bundle.mjs';
import { CENSUS_KIND, committedWinners, designBlock } from './winner-census.mjs';
import { PHASE_KIND, heldOutSeeds, nightBindings, phaseWins } from './winner-phase-census.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = join(ROOT, 'docs/evidence');
const HELD_OUT_SAMPLE = 4;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const recordName = readdirSync(EVIDENCE).filter((name) => /^fnaf2-winner-census-\d{8}\.json$/.test(name)).sort().pop();
assert.ok(recordName, 'no docs/evidence/fnaf2-winner-census-YYYYMMDD.json is committed');
const record = JSON.parse(readFileSync(join(EVIDENCE, recordName), 'utf8'));
assert.equal(record.kind, CENSUS_KIND);
assert.equal(record.claimLevel, 'MODEL_ONLY');

// The population claim rests on the RNG keeping 16 bits: a seed and the same
// seed plus 2^16 must deal the same night, event for event.
{
  const winner = validateWinner(JSON.parse(readFileSync(join(ROOT, 'tools/device/campaign-night7-k3-winner.json'), 'utf8')));
  const { replay } = STRATEGY_REGISTRY[winner.strategy].emit(winner, 7);
  for (const seed of [5, 40961]) {
    const a = replay(seed).sim;
    const b = replay(seed + RNG_MODULUS).sim;
    assert.equal(stableHash(a.events), stableHash(b.events), `seed ${seed} and ${seed + RNG_MODULUS} deal different nights`);
  }
}

// The design block is a definition, not a sample: it must rebuild to the
// seeds the record split on, and the golden cohort's 3000 uint32 seeds reach
// 2932 distinct nights.
const design = designBlock();
assert.equal(sha256(JSON.stringify(design.seeds)), record.method.designBlock.sha256, 'the design block no longer rebuilds to the censused one');
assert.equal(design.components.golden.distinct, 2932);
const inDesign = new Set(design.seeds);

let replays = 0;
for (const row of record.bindings) {
  const tag = `${row.binding} night ${row.night}`;
  const bytes = readFileSync(join(ROOT, row.binding));
  assert.equal(sha256(bytes), row.winnerSha256, `${tag} changed since the census; re-run tools/winner-census.mjs --winner ${row.binding}`);
  const winner = validateWinner(JSON.parse(bytes.toString('utf8')));
  const emitted = STRATEGY_REGISTRY[winner.strategy].emit(winner, row.night);
  assert.equal(sha256(emitted.text), row.planSha256, `${tag} emits a different plan than the census scored`);

  const lost = row.losses ?? [];
  assert.equal(row.wins + (row.losses ? lost.length : row.n - row.wins), row.n, `${tag} wins and losses do not add up`);
  assert.equal(row.design.n + row.heldOut.n, row.n, `${tag} blocks do not partition the census`);
  for (const [seed, reason, frame] of lost.slice(0, 50)) {
    const { sim } = emitted.replay(seed);
    replays += 1;
    assert.ok(!sim.won, `${tag} seed ${seed} now wins; the record says it lost to ${reason}`);
    assert.deepEqual([sim.death?.reason ?? 'alive', sim.frame], [reason, frame], `${tag} seed ${seed} dies differently now`);
  }

  // A fixed, spread sample of held-out seeds: the record's census start plus
  // an odd stride, skipping design seeds.
  const lostSeeds = new Set(lost.map(([seed]) => seed));
  const { start, count } = record.method.population;
  let taken = 0;
  for (let k = 0; taken < HELD_OUT_SAMPLE && k < count; k += 1) {
    const seed = start + ((k * 40503 + row.night * 977) % count);
    if (inDesign.has(seed)) continue;
    taken += 1;
    replays += 1;
    const won = emitted.replay(seed).sim.won;
    if (row.losses) assert.equal(won, !lostSeeds.has(seed), `${tag} held-out seed ${seed} replays ${won ? 'WON' : 'LOST'}, the record says otherwise`);
  }
}

const phaseName = readdirSync(EVIDENCE).filter((name) => /^fnaf2-night\d-phase-census-\d{8}\.json$/.test(name)).sort().pop();
assert.ok(phaseName, 'no docs/evidence/fnaf2-night<N>-phase-census-YYYYMMDD.json is committed');
let phaseReplays = 0;
{
  const phase = JSON.parse(readFileSync(join(EVIDENCE, phaseName), 'utf8'));
  assert.equal(phase.kind, PHASE_KIND);
  const night = Number(phaseName.match(/night(\d)/)[1]);
  const seeds = heldOutSeeds(phase.method.seeds.n);
  assert.equal(sha256(JSON.stringify(seeds)), phase.method.seeds.sha256, `${phaseName}: the held-out seed block no longer rebuilds`);
  const frames = (phase.method.phases.frames - 1) / 2;
  const bindings = nightBindings(night);
  for (const row of phase.bindings) {
    const binding = bindings.find((b) => b.path === row.binding);
    assert.ok(binding, `${phaseName} names ${row.binding}, which no longer plays night ${night}`);
    assert.equal(binding.winnerSha256, row.winnerSha256, `${row.binding} changed since ${phaseName}; re-run winner-phase-census.mjs`);
    assert.equal(binding.planSha256, row.planSha256, `${row.binding} emits a different plan than ${phaseName} scored`);
    const probes = new Set([0]);
    for (let i = 1; i < row.map.length; i += 1)
      if (row.map[i] !== row.map[i - 1]) { probes.add(i - frames); probes.add(i - 1 - frames); }
    for (const f of probes) {
      const cell = row.map[f + frames];
      const seed = cell === '+' ? row.partial.find((p) => p.frame === f).losses[0][0] : seeds[(f + frames) % seeds.length];
      const { won } = phaseWins(binding, night, seed, f);
      phaseReplays += 1;
      assert.equal(won, cell === '#', `${row.binding} frame ${f} seed ${seed} ${won ? 'wins' : 'loses'}; ${phaseName} records '${cell}'`);
    }
  }
}

const censused = new Set(record.bindings.map((row) => row.binding));
const uncensused = committedWinners().filter((path) => !censused.has(path));
console.log(`winner census ${recordName}: ${record.bindings.length} night-bindings still match the tree ` +
  `(${replays} replays), ${phaseName} still maps the phases (${phaseReplays} replays); ` +
  `UNCENSUSED_WINNERS ${uncensused.length}${uncensused.length ? `: ${uncensused.join(', ')}` : ''}`);
