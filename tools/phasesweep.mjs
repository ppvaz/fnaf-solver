// Price every 200 ms alignment of the device cycle against the 5 s movement
// interval. Balloon Boy's final hop is monitor-gated, but g417 consumes a
// latched A=2 later: cams-down defers rather than cancels it. This report is
// retained so that failed "solve BB by phase alone" idea is not reinvented.
//
//   node tools/phasesweep.mjs [nights] [--sync]
import { run } from './model/stock-device-pilot.mjs';
import * as C from '@sixam/source/fnaf2';

const N = +(process.argv[2] || 200);
const SYNC = process.argv.includes('--sync');
const rows = [];
for (let base = 5200; base <= 10000; base += 200) {
  let foxy = 0, bbIn = 0, chain = 0, survived = 0;
  const depth = [];
  const causes = {};
  for (let i = 0; i < N; i++) {
    const result = run({ cycles: 80, base, sync: SYNC,
      sim: { seed: (i * 2246822519) >>> 0 } });
    const sim = result.sim;
    depth.push(sim.frame / C.FPS);
    if (sim.won) { survived++; continue; }
    causes[sim.death.reason] = (causes[sim.death.reason] || 0) + 1;
    if (sim.death.reason === 'foxy') foxy++;
    if (sim.bb.inside) bbIn++;
    if (sim.bb.inside && sim.death.reason === 'foxy') chain++;
  }
  depth.sort((left, right) => left - right);
  const phase = ((-base % 5000) + 5000) % 5000;
  rows.push({ base, phase, foxy, bbIn, chain, survived,
    median: depth[N >> 1], best: depth[N - 1],
    top: Object.entries(causes).sort((left, right) => right[1] - left[1])[0] });
}

console.log(`${N} nights per row. "phase" is where the 5 s movement interval`);
console.log('falls inside the cycle; the cams are down from 0 to about 1550 ms.\n');
console.log('base   phase   BB in office   foxy   chain   median   best   dominant death');
for (const row of rows) {
  const camsDown = row.phase < 1550 ? ' *' : '  ';
  console.log(
    `${String(row.base).padStart(5)}${camsDown} ${String(row.phase).padStart(5)}   ` +
    `${String(row.bbIn).padStart(10)}   ${String(row.foxy).padStart(4)}   ` +
    `${String(row.chain).padStart(5)}   ${row.median.toFixed(0).padStart(5)}s   ` +
    `${row.best.toFixed(0).padStart(4)}s   ${row.top ? row.top[0] + ' ' + row.top[1] : '-'}`
  );
}
console.log('\n* = the movement interval lands while the cams are down');
