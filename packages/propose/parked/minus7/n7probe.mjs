// Plan 16 package 5: where is Night 7 actually lost?
//
// Pkg 5's stated premise was the opener -- "n7's median death is 54 s, half the
// runs die in the first in-game hour to Foxy at his capped 17 with no
// foxyDormant, and the opening has no Golden-Freddy clear". This probe tests
// that premise with three controlled engine perturbations (each a `Sim`
// prototype patch, applied and restored -- a measurement control, not a second
// simulator; plan 16 design rule "negative controls are mandatory") and it
// REFUTES the premise:
//
//   1. A perfect opening Foxy reset (extend `foxyDormant` to cover the first
//      N seconds on n7) moves n7 by ~0.0 points at N = 5, 8, 12, 20, 40.
//      The opener is not where n7 is lost.
//   2. A perfect EXTRA Foxy D-zero every 5.0 s: no change (redundant with the
//      schedule). Every 2.5 s: n7 33 -> 61 %. So n7 needs a Foxy reset twice
//      per 5 s cycle -- and the clear cycle HAS two (b+1.38, b+3.10), so the
//      shortfall is those two MISSING under jitter, not a missing third.
//   3. Making the clear cycle's own two resets perfect (D-zero at their intended
//      cycle phases) reproduces the same ~61 %. Beyond that, every remaining
//      n7 death is `inside-office` -- the sweep-geometry lever's territory, not
//      Foxy's.
//
// Conclusion: n7 -> 70 % is (a) jitter-robust execution of the clear cycle's
// two existing Foxy resets -- which pkg 4 already showed cannot be moved out of
// the mask-off animation without colliding with the 400-frame sweep pin, i.e.
// new device time -- stacked with (b) the tight sweep geometry for the office
// entries. Neither is an opener change.
//
//   node packages/propose/parked/minus7/n7probe.mjs [--runs=800]
import { Sim } from '@sixam/source/fnaf2';
import * as C from '@sixam/source/fnaf2';
import { build, devicePlan, idleUntilMs } from '../../bin/plans/recipe.mjs';
import { modelGate } from '../../bin/plans/human-gate.mjs';

const arg = (k, d) => {
  const m = process.argv.find(a => a.startsWith(`--${k}=`));
  return m ? m.split('=')[1] : d;
};
const RUNS = +arg('runs', '800');
const NIGHTS = [5, 6, 7];

function planText(night) {
  const r = build({ night });
  const p = devicePlan(r, {});
  let t = `#night ${r.night}\n#idle-until ${idleUntilMs(r.night)}\n`;
  for (const [n, l] of Object.entries(p))
    t += `#cycle ${n} ${r.cycles[n].lengthMs}\n${l.join('\n')}\n`;
  return t;
}

// Run a scenario with a temporary Sim patch. `patch` returns a restore fn.
function score(nights, patch) {
  const restore = patch ? patch() : () => {};
  const out = {};
  try {
    for (const n of nights) {
      const g = modelGate(planText(n), { night: n, runs: RUNS, slackMs: 60, shape: 'correlated' });
      out[n] = { pct: +(100 * g.survived / RUNS).toFixed(1), deaths: g.deaths };
    }
  } finally { restore(); }
  return out;
}
const row = (label, r) => console.log(
  `  ${label.padEnd(34)} ` +
  NIGHTS.map(n => `n${n} ${String(r[n].pct).padStart(5)}`).join('  '));

// --- patch factories -------------------------------------------------------
const dormantDesc = Object.getOwnPropertyDescriptor(Sim.prototype, 'foxyDormant');
const patchDormantUntil = sec => () => {
  Object.defineProperty(Sim.prototype, 'foxyDormant', {
    configurable: true,
    get() {
      const n = this.opts.night;
      if (n === 1 || (n === 2 && this.frame < 2 * C.HOUR_FRAMES)) return true;
      return n === 7 && this.frame < sec * C.FPS;
    },
  });
  return () => Object.defineProperty(Sim.prototype, 'foxyDormant', dormantDesc);
};

const origTickFoxy = Sim.prototype.tickFoxy;
// `phases` is a list of frame-mod-300 values at which to zero fx.D while Foxy
// is in the hall on n7 -- a perfect reset at those cycle phases.
const patchPerfectReset = phases => () => {
  Sim.prototype.tickFoxy = function (f) {
    origTickFoxy.call(this, f);
    if (this.opts.night === 7 && this.foxy.loc === 'hall' &&
        phases.some(p => (f % 300) === p)) this.foxy.D = 0;
  };
  return () => { Sim.prototype.tickFoxy = origTickFoxy; };
};

// --- the experiments -----------------------------------------------------
console.log(`plan-16 pkg 5: where is Night 7 lost?  ${RUNS} runs/cell  correlated ±60\n`);

console.log('baseline (unpatched)');
const base = score(NIGHTS, null);
row('803feb3', base);

console.log('\n1. a PERFECT opening Foxy reset (foxyDormant extended on n7):');
for (const sec of [5, 8, 12, 20, 40])
  row(`  dormant first ${sec}s`, score(NIGHTS, patchDormantUntil(sec)));
console.log('   -> the opener is not where n7 is lost.');

console.log('\n2. a PERFECT extra Foxy reset at a fixed sub-cycle period on n7:');
row('  every 5.0s (ph 0)', score(NIGHTS, patchPerfectReset([0])));
row('  every 2.5s (ph 0,150)', score(NIGHTS, patchPerfectReset([0, 150])));
row('  every ~1.7s (ph 0,100,200)', score(NIGHTS, patchPerfectReset([0, 100, 200])));
console.log('   -> n7 needs a reset ~every 2.5s; a third beyond that adds nothing.');

console.log('\n3. the clear cycle\'s OWN two resets, made perfect (ph ~83, ~186):');
const perfect2 = score(NIGHTS, patchPerfectReset([83, 186]));
row('  perfect x2', perfect2);
const off = perfect2[7].deaths.reduce((a, [k, v]) =>
  (a[k.split(':')[0]] = (a[k.split(':')[0]] || 0) + v, a), {});
console.log(`   n7 remaining deaths: ${Object.entries(off).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log('   -> the schedule\'s two resets MISS under jitter; once perfect, every');
console.log('      remaining n7 death is inside-office (the sweep-geometry lever).');

console.log(`\nCONCLUSION: n7 is a steady-state clear-cycle problem, not an opener one.`);
console.log(`  Foxy: robust execution of the two existing resets -- pkg 4 showed they`);
console.log(`  cannot clear the mask-off animation without hitting the sweep pin (new`);
console.log(`  device time). Office entries: the tight sweep geometry. Neither is the`);
console.log(`  opening. Pkg 5's opener premise is refuted.`);
