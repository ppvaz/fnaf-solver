// Plan 16 / PROGRESS item 13: price the device numbers against the ladder.
//
// Item 13 asked whether shaving the phone's timing numbers lets the sub-70
// nights clear. This asks the exact engine, one number at a time, then in
// combination -- always through the emitted plan and the human-gate jitter,
// scoring every story night.
//
// RESULT (2026-08-27, 600-800 runs/cell, correlated + iid):
//
//   readLatencyMs  550 -> 400   moves n2/n5/n6/n7 by < 1 pt. 250/100 throw:
//                               leftClear's fixed hall/tap offsets do not
//                               adapt to a shorter read latch.
//   hallPulseMs    130 -> 83    nothing on n2/n5/n6; costs n7 ~15 pt.
//   recovery Foxy reset beat    +0.5 to +1 pt everywhere. NOT a lever -- the
//     (an attackRstDeltaMs=7400 knob, a monitor-down hall at b+7.4s
//      straddling the recovery 5 s check) is inert against the wedge.
//
//   sweepSlotMs (-> emit spacing) is the ONLY number that moves the ladder:
//     slot 120 (spacing 133): corr n2 69  n5 62  n6 61  n7 34
//     slot 110 (spacing 123): corr n2 75  n5 70  n6 68  n7 39
//     slot 100 (spacing 113): corr n2 78  n5 73  n6 72  n7 43   [nights 2-6 >=70]
//     slot  90 (spacing 103): corr n2 82  n5 77  n6 75  n7 32   [n7 phase break]
//   Pinned n6target / n6target-worst hold 500/500 at slot 100 -- not a
//   readLatency-540 overfit like {attackSweepDeltaMs:-17} was.
//
// SO: the nights 2-6 shortfall is sweep-selection-spacing-bound. The one
// lever sits BELOW the device-validated 133 ms floor (HID-MULTITOUCH.md:
// 100 ms contact + one full 33 ms Fusion poll released; the CAM 07 last-flash
// finding is a fight over exactly this boundary). A reliable sub-120 ms sweep
// actuator would clear nights 2-6. n7 is not spacing-bound -- it tops out near
// 43 and degrades below slot 90; it needs the jitter-shape fix + bang-anchored
// reset (PROGRESS "What moves Night 7").
//
// NOT a device claim: `ANDROID-SOURCE-STATUS.md` -- the simulator prices
// nothing. This is "what would the schedule do if the phone were faster".
//
//   node packages/propose/parked/minus7/devicetimesearch.ts [--runs=600] [--nights=2,3,4,5,6,7]
import { build, devicePlan, replay } from '../../bin/plans/recipe.mjs';
import { jitterPlan } from '../../bin/plans/human-gate.ts';
import { makeSearchKnobs } from './hid-device-pilot.mjs';

const arg = (k, d) => {
  const m = process.argv.find(a => a.startsWith(`--${k}=`));
  return m ? m.split('=')[1] : d;
};
const RUNS = +arg('runs', '600');
const NIGHTS = arg('nights', '2,3,4,5,6,7').split(',').map(Number);

// One config: the device-timing numbers, plus whether to add the (inert)
// recovery Foxy-reset beat.
function score(cfg, shape) {
  const { readLatencyMs = 550, sweepSlotMs = 120, hallPulseMs = 130,
    recoveryReset = false } = cfg;
  const spacing = Math.max(sweepSlotMs, sweepSlotMs + 13); // emitter only widens
  const knobs = makeSearchKnobs({ attackRstDeltaMs: recoveryReset ? 7400 : 0 });
  const out = {};
  try {
    for (const night of NIGHTS) {
      const recipe = build({ night, readLatencyMs, sweepSlotMs, hallPulseMs, knobs });
      const plan = devicePlan(recipe, { deviceSpacingMs: spacing });
      // replay needs the SAME latch the plan was built for, or the schedule
      // and the replay diverge.
      let won = 0;
      for (let seed = 1; seed <= RUNS; seed++) {
        const { sim } = replay(jitterPlan(plan, seed, 60, shape),
          { night, seed, readLatencyMs, attackWindowMs: recipe.cycles.attack.lengthMs });
        if (sim.won) won++;
      }
      out[night] = +(100 * won / RUNS).toFixed(1);
    }
  } catch (e) { return { err: e.message }; }
  return out;
}

function row(label, cfg) {
  const c: any = score(cfg, 'correlated');
  const i = score(cfg, 'iid');
  if (c.err) { console.log(`  ${label.padEnd(42)} ERR ${c.err.slice(0, 60)}`); return; }
  const fmt = r => NIGHTS.map(n => `n${n} ${String(r[n]).padStart(5)}`).join('  ');
  const minC = Math.min(...NIGHTS.map(n => c[n]));
  console.log(`  ${label.padEnd(42)} corr[min ${String(minC).padStart(5)}] ${fmt(c)}   iid ${fmt(i)}`);
}

console.log(`device-time experiment  ${RUNS} runs/cell  nights ${NIGHTS}\n`);
console.log('--- baseline device numbers (readLat 550, slot 120, hall 130) ---');
row('baseline', {});
row('baseline + recovery reset (inert)', { recoveryReset: true });

console.log('\n--- sweepSlotMs: the one lever (emit spacing = slot + 13) ---');
row('sweepSlotMs 110', { sweepSlotMs: 110 });
row('sweepSlotMs 100', { sweepSlotMs: 100 });
row('sweepSlotMs 90 (n7 phase break)', { sweepSlotMs: 90 });

console.log('\n--- the numbers that do not move it ---');
row('readLatencyMs 400', { readLatencyMs: 400 });
row('readLatencyMs 250 (throws)', { readLatencyMs: 250 });
row('hallPulseMs 83', { hallPulseMs: 83 });
