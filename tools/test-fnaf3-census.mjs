#!/usr/bin/env node
// Pin the FNaF 3 simulator and the published community line.
//
// The headline is that the community line clears all six nights at 3000/3000.
// A clean sweep is worth nothing without controls that fail, so the first
// group here is the set of runs that must lose, and lose for the stated
// reason. The second checks the mechanics the result actually rests on --
// above all that **the attack chain advances on the ventilation blackout**,
// because a model that missed that would report a night that never ends and
// would look like a perfect score.
//
//   node tools/test-fnaf3-census.mjs

import { Fnaf3Sim } from '../packages/core/src/mechanics/games/sim-fnaf3.js';
import { communityLine, doNothing, officeCamp, trackingLoop, searchOrder, VENT_FROM }
  from '../packages/core/src/mechanics/games/policy-fnaf3.js';
import { GRAPH } from '../packages/core/src/mechanics/games/sim-fnaf3.js';
import { searchOrder as deviceSearchOrder } from './device/fnaf3-run.mjs';
import { CLOCK, VENTILATION, SPRINGTRAP } from '../packages/core/src/mechanics/games/fnaf3.js';

const failures = [];
let checks = 0;
const ok = (what, c) => { checks += 1; if (!c) failures.push(what); };
const eq = (what, a, b) => {
  checks += 1;
  if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};

function run(night, makePolicy, seeds) {
  const causes = new Map();
  let wins = 0;
  let frames = 0;
  for (let seed = 0; seed < seeds; seed += 1) {
    const sim = new Fnaf3Sim({ night, seed });
    const r = sim.run(makePolicy());
    if (r.outcome === '6AM') wins += 1;
    causes.set(r.outcome, (causes.get(r.outcome) ?? 0) + 1);
    frames += r.frames;
  }
  return { wins, seeds, causes: Object.fromEntries(causes), meanS: frames / seeds / 60 };
}

// --- 1. controls that must fail ---------------------------------------------

// Standing in the office drains ventilation (g908) and raises aggression
// (g909) off one counter, so camping must lose on every night but the first.
for (const night of [2, 3, 5]) {
  const camp = run(night, officeCamp, 200);
  ok(`office camping loses night ${night}`, camp.wins <= 2);
  ok(`and it loses to the systems or the vents on night ${night}`,
    Object.keys(camp.causes).every((c) => c === '6AM' || c.startsWith('springtrap')));
}

// Doing nothing loses too, but **not** on Night 1, where it is merely a coin
// flip: AI 0 slows Springtrap without stopping him, because his rule is a
// threshold and not a roll. If this ever reads 300/300 the threshold has been
// turned into a roll somewhere.
{
  const one = run(1, () => doNothing, 300);
  ok('doing nothing on night 1 is neither safe nor hopeless',
    one.wins > 100 && one.wins < 290);
  const two = run(2, () => doNothing, 200);
  ok('doing nothing loses night 2 nearly always', two.wins <= 5);
}

// --- 2. the census ----------------------------------------------------------
for (const night of [1, 2, 3, 4, 5, 6]) {
  const r = run(night, () => communityLine(), 400);
  eq(`the community line clears night ${night}`, r.wins, 400);
}

// --- 3. the mechanics the result rests on -----------------------------------

// The clock: 240 s on Night 1 and 360 s after, which is both what the clock
// groups state and what the handset measured on 2026-09-20.
{
  const one = run(1, () => communityLine(), 40);
  const two = run(2, () => communityLine(), 40);
  ok('night 1 runs 240 s', Math.abs(one.meanS - 240) < 1.5);
  ok('night 2 runs 360 s', Math.abs(two.meanS - 360) < 1.5);
  eq('the win fires on the displayed hour, not the counter', CLOCK.winHour, 6);
}

// The chain advances on the blackout, and the blackout needs twice the error
// dwell the hallucination does. If these ever coincide, a route that clears an
// error late stops being safe.
ok('the chain threshold is the blackout, not a move',
  VENTILATION.chainAdvancesAbove === 250);
for (const ai of [2, 3, 4, 5, 7]) {
  ok(`at AI ${ai} the blackout ramp needs a longer dwell than the hallucination`,
    VENTILATION.blackoutRampAt(ai) > VENTILATION.hallucinationAt(ai));
}

// Springtrap's threshold is drawn every second whether or not he moves: the
// `Random(15)` sits inside the comparison. That is the night's unconditional
// draw and the reason its stream position is knowable.
eq('the move test is per second', SPRINGTRAP.counterMs, 1000);
eq('and the draw inside it is Random(15)', SPRINGTRAP.threshold.plusRandom, 15);
eq('aggression decays on a 15 s timer', SPRINGTRAP.aggressionResetMs, 15000);

// The spawn is the first draw of the night and is uniform over five cameras,
// so it is predictable per seed -- the property that makes this game the
// cheapest seed laboratory of the four.
{
  const spawns = new Map();
  for (let seed = 0; seed < 500; seed += 1) {
    const s = new Fnaf3Sim({ night: 2, seed });
    spawns.set(s.where, (spawns.get(s.where) ?? 0) + 1);
  }
  eq('the spawn lands on exactly five cameras', [...spawns.keys()].sort(),
    ['cam06', 'cam07', 'cam08', 'cam09', 'cam10']);
  ok('and it is roughly uniform',
    [...spawns.values()].every((n) => n > 500 / 5 * 0.6 && n < 500 / 5 * 1.4));
  // Same seed, same spawn: the whole point of a seeded census.
  eq('the spawn is a function of the seed',
    new Fnaf3Sim({ night: 2, seed: 7 }).where, new Fnaf3Sim({ night: 2, seed: 7 }).where);
}

// The vent topology the sealing order comes from: 14 and 15 are entered from
// cam 10 and cam 02 and bypass the attack chain entirely.
eq('cam 10 feeds vent 14', VENT_FROM[10], 14);
eq('cam 02 feeds vent 15', VENT_FROM[2], 15);
eq('cam 09 feeds vent 11', VENT_FROM[9], 11);
eq('cam 07 feeds vent 12', VENT_FROM[7], 12);
eq('cam 05 feeds vent 13', VENT_FROM[5], 13);

// One vent at a time [g583]: `what vent is closed` is a single counter, so a
// second seal replaces the first. A model that let two stand would make the
// night much easier than it is.
{
  const sim = new Fnaf3Sim({ night: 4, seed: 3 });
  sim.armSeal(14);
  ok('a seal takes 50-100 frames to charge',
    sim.sealCharge >= 50 && sim.sealCharge <= 100);
  ok('a second seal cannot be armed while one is charging', sim.armSeal(15) === false);
  sim.sealCharge = 1; sim.viewing = 2; sim.ventMap = true;
  sim.step();
  eq('the charge commits to one vent', sim.sealedVent, 14);
  sim.armSeal(15); sim.sealCharge = 1; sim.step();
  eq('and a later seal replaces it rather than adding', sim.sealedVent, 15);
}

// The seal cancels if the map closes or the monitor drops [g584/g585].
{
  const sim = new Fnaf3Sim({ night: 4, seed: 9 });
  sim.viewing = 2; sim.ventMap = true; sim.armSeal(14);
  sim.ventMap = false;
  sim.step();
  eq('closing the vent map cancels a charging seal', sim.sealCharge, 0);
  eq('and commits nothing', sim.sealedVent, 0);
}

// --- the source edges (graphs/fnaf3.json), which an earlier table misread ------------
eq('cam 10 leaves for cam 09 on actions 2 and 3 (g227)', [GRAPH.cam10[2], GRAPH.cam10[3]], ['cam09', 'cam09']);
eq('and for vent 14 on action 4 (g228)', GRAPH.cam10[4], 'vent14');
eq('cam 06 on actions above 2 goes to cam 05 (g239)', [GRAPH.cam06[3], GRAPH.cam06[4]], ['cam05', 'cam05']);
eq('cam 04 on actions above 2 goes to cam 03 (g249)', [GRAPH.cam04[3], GRAPH.cam04[4]], ['cam03', 'cam03']);
eq('cam 03 on actions above 2 goes to attack stage 1 (g251)', [GRAPH.cam03[3], GRAPH.cam03[4]], ['attack1', 'attack1']);
{
  const sim = new Fnaf3Sim({ night: 6, seed: 1 });
  sim.where = 'attack2'; sim.act(3);
  eq('attack stage 2 advances on an action above 2 (g253)', sim.where, 'attack3');
  sim.where = 'cam01'; sim.viewing = 2; sim.act(4);
  eq('cam 01 advances to stage 4 while a screen is viewed (g258)', sim.where, 'attack4');
  sim.where = 'attack1'; sim.act(4);
  eq('attack stage 1 waits for the blackout (g486)', sim.where, 'attack1');
}

// --- the device loop at the device's pace -------------------------------------------
for (let from = 0; from <= 15; from += 1) {
  if (from > 0 && from < 1) continue;
  eq(`the model's search order from ${from || 'nowhere'} is the device loop's`,
    searchOrder(from || null), deviceSearchOrder(from || null));
}
{
  const r = run(6, () => trackingLoop(), 200);
  ok(`the tracking loop at device pace holds Nightmare (${r.wins}/200)`, r.wins >= 190);
  const slow = run(6, () => trackingLoop({ lookFrames: 150 }), 200);
  ok(`and a loop three times slower does not (${slow.wins}/200)`, slow.wins < r.wins);
}

if (failures.length) {
  console.error(`fnaf3 census: ${failures.length} of ${checks} checks FAILED`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`fnaf3 census: all ${checks} checks passed`);
