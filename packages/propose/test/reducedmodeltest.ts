// Plan 20 package 2: reduced transition model against a seeded exact-engine
// replay. The comparison is intentionally limited to controller-visible
// control/resource state; hidden RNG routes remain risk buckets.
import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { build, schedule } from '../bin/plans/minus-toys-plan.ts';
import { advanceReduced, applyReduced, initialReducedState, observeReduced, isMaskFullyOn, isMaskFullyOff } from '@sixam/source/fnaf2';
import type { ReducedState } from '@sixam/source/games/fnaf2/reduced-model.ts';

const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const seed = (i: number) => (i * 2654435761) >>> 0;

function compare(sim: Sim, reduced: ReducedState, label: string) {
  check(sim.frame === reduced.frame, `${label}: frame diverged (${sim.frame} vs ${reduced.frame})`);
  check(sim.monitor === reduced.monitor && sim.monAnim === reduced.monitorAnim,
    `${label}: monitor diverged (${sim.monitor}/${sim.monAnim} vs ` +
    `${reduced.monitor}/${reduced.monitorAnim})`);
  check(sim.maskOn === reduced.maskOn && sim.maskAnim === reduced.maskAnim,
    `${label}: mask diverged (${sim.maskOn}/${sim.maskAnim} vs ` +
    `${reduced.maskOn}/${reduced.maskAnim})`);
  check(sim.winding === reduced.winding && sim.lightHeld === reduced.lightHeld,
    `${label}: held controls diverged`);
  check(Math.abs(sim.box - reduced.box) < 1e-9,
    `${label} at frame ${sim.frame}: box diverged (${sim.box} vs ${reduced.box})`);
  check(sim.power === reduced.power,
    `${label}: power diverged (${sim.power} vs ${reduced.power})`);
}

function run(seedValue: number) {
  const sim = new Sim({ night: 1, seed: seedValue });
  const built = build({ minimal: true });
  const queue = schedule({
    opening: built.opening, loop: built.loop, finish: built.finish,
    periodMs: 5000, loopStartMs: 140000, untilMs: 360000,
  });
  let reduced = initialReducedState({ night: 1 });
  let i = 0;
  while (sim.alive && !sim.won) {
    const next = queue[i]?.[0] ?? C.NIGHT_FRAMES;
    while (sim.alive && !sim.won && sim.frame < next) {
      sim.tick();
    }
    if (!sim.alive) break;
    reduced = advanceReduced(reduced, sim.frame);
    while (i < queue.length && queue[i][0] === sim.frame) {
      const [, kind, action] = queue[i++];
      sim[kind](action);
      reduced = applyReduced(reduced, action, kind).state;
    }
    sim.tick();
    if (sim.frame > reduced.frame) reduced = advanceReduced(reduced, sim.frame);
    compare(sim, reduced, `seed ${seedValue}`);
  }
  check(sim.won, `seed ${seedValue}: reduced replay did not reach the engine terminal frame`);
  return reduced;
}

for (const n of [0, 1, 2, 17]) run(seed(n));

// The vent path: the one control this replay never exercises, and the reason
// the comparison above needs an EFFECT and not only a held button.
//
// Until 2026-09-09 this file compared `sim.lightHeld` -- the button -- and no
// derived term. plant-model.js's `anyOfficeLightHeld` was missing the view
// condition the dump gives g301/g303/g320 (`mask` = 0 AND `viewing` = 0), so
// the engine credited a vent light held with a camera up, and nothing here
// could have said so: the minus-toys queue above is
// ['cam:11','cam:9','light','mask','monitor','wind'] and contains no vent
// action at all. An unexercised path cannot disagree. So drive it directly.
//
// The reduced model is deliberately NOT held to the same predicate. It tracks
// ventLightL/R and reads them nowhere, and a held vent light costs no power in
// either model -- measured 7000 -> 7000 over 30 s, against 7000 -> 5200 for a
// held hall light in BOTH. What the two models are held to here is the button
// state and the compared fields; what Sim alone is held to is the sourced rule.
function ventScenario(monitorUp: boolean) {
  const sim = new Sim({ night: 1, seed: seed(3) });
  let reduced = initialReducedState({ night: 1 });
  if (monitorUp) {
    sim.press('monitor');
    reduced = applyReduced(reduced, 'monitor').state;
    while (sim.frame < C.MONITOR_ANIM_UP) sim.tick();
    reduced = advanceReduced(reduced, sim.frame);
  }
  sim.press('ventL');
  reduced = applyReduced(reduced, 'ventL').state;
  return { sim, reduced };
}

for (const monitorUp of [false, true]) {
  const { sim, reduced } = ventScenario(monitorUp);
  const label = `vent press, monitor ${monitorUp ? 'up' : 'down'}`;
  check(sim.ventLightL === reduced.ventLightL,
    `${label}: vent button state diverged (${sim.ventLightL} vs ${reduced.ventLightL})`);
  check(sim.anyOfficeLightHeld === !monitorUp,
    `${label}: anyOfficeLightHeld is ${sim.anyOfficeLightHeld}, expected ${!monitorUp}. ` +
    'g301/g303/g320 re-assert the vent lights each requiring mask = 0 AND ' +
    'viewing = 0, so a vent light counts only with the monitor down');
  compare(sim, reduced, label);
}

// Action locks are explicit and UNKNOWN observations do not become false.
let state = initialReducedState({ night: 2 });
state = observeReduced(state, {
  monitorUp: { state: 'OBSERVED', value: false },
  maskOn: { state: 'UNKNOWN', reason: 'mask-animating' },
});
check(state.controlUnknown.mask && state.hazards.blackout.state === 'unknown',
  'UNKNOWN control observation collapsed into a negative hazard claim');
check(isMaskFullyOff(state) && !isMaskFullyOn(state),
  'initial mask polarity was not represented as fully off');
state = applyReduced(state, 'monitor').state;
state = advanceReduced(state, C.MONITOR_ANIM_UP);
check(!applyReduced(state, 'mask').accepted,
  'mask-on was accepted while the reduced monitor was up');
console.log('reduced model: control/resource trace matches seeded Night 1 Sim replays; ' +
  'locks and UNKNOWN pass; a vent light counts only with the monitor down');
