#!/usr/bin/env node
// Compatibility command for the real Minus Two family evaluator in research.
import { pathToFileURL } from 'node:url';
import { runMinusTwo } from '@sixam/research';

const main = () => {
  const n = +(process.argv[2] || 200);
  const worst = process.argv.includes('--worst');
  const camsArg = process.argv.find(value => value.startsWith('--cams='));
  const flashCams = camsArg ? camsArg.slice(7).split(',').map(Number) : [3];
  const deaths = {};
  let wins = 0, minBox = 1, minPower = Infinity, maxHolds = 0, maxD = 0;
  for (let i = 0; i < n; i++) {
    const result = runMinusTwo({ seed: (i * 2654435761) >>> 0, worst, flashCams });
    minBox = Math.min(minBox, result.minBox); minPower = Math.min(minPower, result.sim.power);
    maxHolds = Math.max(maxHolds, result.maxConsecutiveHolds); maxD = Math.max(maxD, result.maxD);
    if (result.sim.won) wins++;
    else deaths[result.sim.death.reason] = (deaths[result.sim.death.reason] || 0) + 1;
  }
  console.log(`Minus Two probe (${worst ? 'pinned worst-luck' : 'normal'} seeds, flashing CAM ${flashCams.join('/')})`);
  console.log(`${wins}/${n} survived on the current Android model`);
  for (const [reason, count] of Object.entries(deaths)) console.log(`  ${count}x ${reason}`);
  console.log(`min box ${(minBox * 100).toFixed(0)}% | min power ${minPower} | ` +
    `max consecutive holds ${maxHolds} | max Foxy D ${maxD}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
