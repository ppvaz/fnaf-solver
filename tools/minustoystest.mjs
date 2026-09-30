#!/usr/bin/env node
// Compatibility command for the real Minus Toys evaluator now owned by
// @sixam/propose. Keep this command until its structured artifacts and
// the package campaign remain equivalent on fixed seeds.
import { pathToFileURL } from 'node:url';
import { runMinusToys } from '@sixam/propose/experiment';
import { GOLDEN_MODEL_SEED_SALT, randomSeedCohort, seedCohortDescriptor } from '@sixam/propose/seeds';
import { formatRate } from '../packages/review/src/stat.mjs';

const main = () => {
  const runs = +(process.argv[2] || 3000);
  const seeds = randomSeedCohort({ count: runs });
  const worst = process.argv.includes('--worst');
  const control = process.argv.includes('--no-split');
  const shouldAssert = process.argv.includes('--assert');
  const deaths = {};
  let wins = 0, minBox = 1, minPower = Infinity, splitMisses = 0;
  let maxBlackouts = 0, maxVentArrivals = 0;
  for (const seed of seeds) {
    const result = runMinusToys({ seed, worst, splitCamera: !control });
    if (result.sim.won) wins++;
    else deaths[result.sim.death?.reason || 'unknown'] = (deaths[result.sim.death?.reason || 'unknown'] || 0) + 1;
    if (result.splitAt < 0) splitMisses++;
    minBox = Math.min(minBox, result.minBox); minPower = Math.min(minPower, result.minPower);
    maxBlackouts = Math.max(maxBlackouts, result.blackouts);
    maxVentArrivals = Math.max(maxVentArrivals, result.ventArrivals);
  }
  console.log(`Minus Toys probe (${worst ? 'pinned worst-luck' : 'normal'} seeds${control ? ', no-split control' : ''})`);
  console.log(`${wins}/${runs} survived (${formatRate(wins, runs, { label: 'survival' })}) on the current Android model`);
  for (const [reason, count] of Object.entries(deaths)) console.log(`  ${count}x ${reason}`);
  console.log(`split misses ${splitMisses} | min box ${(minBox * 100).toFixed(0)}% | ` +
    `min power ${minPower} | max blackouts ${maxBlackouts} | max vent arrivals ${maxVentArrivals}`);
  console.log(`seed cohort ${JSON.stringify(seedCohortDescriptor(seeds, { salt: GOLDEN_MODEL_SEED_SALT }))}`);
  if (shouldAssert) {
    const passed = control ? wins === 0 : wins === runs && splitMisses === 0;
    if (!passed) process.exitCode = 1;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
