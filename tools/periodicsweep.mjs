// Test a blind clocked Balloon Boy response instead of a visual cue. Every
// third/fourth cycle keeps him out in the modeled policy, but the long mask
// response removes the hall light and trades the BB->Foxy chain for earlier
// Foxy/office deaths. Retained to prevent repeating that negative search.
//
//   node tools/periodicsweep.mjs [nights]
import { run } from './model/stock-device-pilot.mjs';
import * as C from '@sixam/core/mechanics';

const N = +(process.argv[2] || 200);
console.log(`${N} nights per row. "every" is the response cadence in cycles;`);
console.log('each response occupies about two cycles of the stall sweep.\n');
console.log('every   BB in office   foxy   BB->foxy   median   best   dominant death');

for (const periodic of [0, 3, 4, 5, 6, 7, 8, 10, 12]) {
  let foxy = 0, bbIn = 0, chain = 0, survived = 0;
  const depth = [];
  const causes = {};
  for (let i = 0; i < N; i++) {
    const result = run({ cycles: 80, sync: true, periodic,
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
  const top = Object.entries(causes).sort((left, right) => right[1] - left[1])[0];
  const label = periodic ? String(periodic) : 'never';
  console.log(
    `${label.padStart(5)}   ${String(bbIn).padStart(10)}   ` +
    `${String(foxy).padStart(4)}   ${String(chain).padStart(8)}   ` +
    `${depth[N >> 1].toFixed(0).padStart(5)}s   ${depth[N - 1].toFixed(0).padStart(4)}s   ` +
    `${top ? top[0] + ' ' + top[1] : '-'}` +
    (survived ? `   SURVIVED ${survived}` : '')
  );
}
