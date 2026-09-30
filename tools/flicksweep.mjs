// Price the blind per-cycle Golden Freddy mask flick. A visual player can skip
// it after seeing an empty office, but simply removing it from a blind pilot is
// fatal: g776 makes the mask the only clear and g777/g778 punish a raise/hall
// flash while Golden Freddy is present.
//
//   node tools/flicksweep.mjs [nights]
import { run } from './model/stock-device-pilot.mjs';
import * as C from '@sixam/source/fnaf2';

const N = +(process.argv[2] || 200);
const variants = [
  ['flick, no BB response', {}],
  ['no flick, no BB response', { noFlick: true }],
  ['flick + BB response/4', { periodic: 4 }],
  ['no flick + BB response/4', { noFlick: true, periodic: 4 }],
];

console.log(`${N} nights per row.\n`);
console.log('variant                     golden   foxy   BB in office   median   best');
for (const [name, options] of variants) {
  let golden = 0, foxy = 0, bbIn = 0;
  const depth = [];
  for (let i = 0; i < N; i++) {
    const result = run(Object.assign({ cycles: 80, sync: true }, options,
      { sim: { seed: (i * 2246822519) >>> 0 } }));
    const sim = result.sim;
    depth.push(sim.frame / C.FPS);
    if (sim.won) continue;
    if (sim.death.reason.startsWith('golden')) golden++;
    if (sim.death.reason === 'foxy') foxy++;
    if (sim.bb.inside) bbIn++;
  }
  depth.sort((left, right) => left - right);
  console.log(
    `${name.padEnd(26)} ${String(golden).padStart(6)}   ${String(foxy).padStart(4)}   ` +
    `${String(bbIn).padStart(12)}   ${depth[N >> 1].toFixed(0).padStart(5)}s   ` +
    `${depth[N - 1].toFixed(0).padStart(4)}s`
  );
}
