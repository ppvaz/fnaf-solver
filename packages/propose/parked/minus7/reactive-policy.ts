// A reactive Minus 7 policy in the semantic-action vocabulary: observation ->
// action, evaluated against the sourced engine. Every rule is a sourced danger
// signal (see docs/android/UNIFIED-SOURCED-ENGINE-FACT-INDEX.md), not a tuned
// schedule -- the point is to see how far pure reaction gets before any
// timing is fitted, and to serve as the rollout policy the search leans on.
//
//   node packages/propose/parked/minus7/reactive-policy.ts --night=7 --seeds=50 [--verbose]
import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { view, ACTIONS, run } from './sim.ts';
import type { View } from './sim.ts';

const arg = (k: string, d: string) => {
  const m = process.argv.find(a => a.startsWith(`--${k}=`));
  return m ? m.split('=')[1] : d;
};
const FLAG = (k: string) => process.argv.includes(`--${k}`);

// Decide the next semantic action from the sourced state alone.
export function decide(v: View, night: number, customNight: Readonly<Record<string, number>> | null = null) {
  // `peakAi` takes the Custom Night dials; without them this policy believes
  // Foxy sits at the standard night's level whatever the dial says, which
  // mis-sizes its own safety band under Custom Night (Plan 05 pkg 7b).
  const safeD = 20 - C.peakAi(night, 'foxy', customNight);
  const drain = C.boxDrainFrames(night);
  const boxFramesLeft = v.winding ? Infinity : v.box * drain;
  const toCheck = (300 - (v.frame % 300)) % 300 || 300;
  const projD = v.foxyD + Math.floor(toCheck / C.FPS);

  // 1. A committed office attack or an active blackout: mask is the only answer.
  if (v.committed.length || v.blackout) return v.maskOn ? 'HOLD_MASK' : 'MASK_ON';

  // 2. Balloon Boy in the opening: hold the mask for the five-tick repel.
  if (v.bbOpening) return 'HOLD_MASK';

  // 3. Foxy about to cross the safe band at the next 5 s check.
  if (projD >= safeD && v.foxyLoc !== 'parts') {
    if (v.maskOn) return 'MASK_OFF';
    if (v.monitor === 'up') return 'LOWER';
    if (v.gfPresent) return 'FLICK';        // clear GF before the hall flash
    return 'HALL_FLASH';
  }

  // 4. Box near empty: wind.
  if (boxFramesLeft < 260) {
    if (v.maskOn) return 'MASK_OFF';
    if (v.monitor !== 'up') return 'RAISE';
    return 'WIND_LONG';
  }

  // 5. A stall camera occupant losing its stun: sweep.
  const needSweep = v.stun.some(st => st.occupied && st.stun < 120);
  if (needSweep) {
    if (v.maskOn) return 'MASK_OFF';
    if (v.monitor !== 'up') return 'RAISE';
    return 'SWEEP';
  }

  // 6. Prophylactic Golden Freddy clear roughly once per movement window.
  if (v.gfPresent && v.monitor !== 'up' && !v.maskOn) return 'FLICK';

  // 7. Default: keep the box topped up.
  if (v.maskOn) return 'MASK_OFF';
  if (v.monitor !== 'up') return 'RAISE';
  return 'WIND';
}

export function runPolicy(night: number, seed: number, { verbose = false } = {}) {
  const sim = new Sim({ seed, night });
  let guard = 0;
  while (sim.alive && !sim.won && guard++ < 4000) {
    const v = view(sim);
    const a = decide(v, night);
    if (verbose && sim.frame % 300 < 20)
      console.log(`  f=${sim.frame} D=${v.foxyD} box=${v.box.toFixed(2)} pow=${v.power} mon=${v.monitor} mask=${v.maskOn} -> ${a}`);
    run(sim, ACTIONS[a](v));
  }
  return { won: sim.won, t: +(sim.frame / C.FPS).toFixed(1),
    death: sim.death ? `${sim.death.reason}: ${sim.death.detail}` : null };
}

function main() {
  const nights = arg('night', '7').split(',').map(Number);
  const seeds = +arg('seeds', '50');
  const verbose = FLAG('verbose');
  for (const night of nights) {
    let won = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const r = runPolicy(night, seed, { verbose: verbose && seed === 1 });
      if (r.won) won++;
      else if (verbose) console.log(`  n${night} seed ${seed}: died ${r.t}s ${r.death}`);
    }
    console.log(`night ${night}: reactive policy ${won}/${seeds} (${(100*won/seeds).toFixed(1)}%)`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('policy.ts')) main();
