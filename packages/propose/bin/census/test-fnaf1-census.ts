#!/usr/bin/env node
// Pin the FNaF 1 simulator and its two policies.
//
// The headline result is a census, and a census is only worth the controls
// around it. The checks below are in three groups:
//
//   1. **Controls that must fail, and must fail for the stated reason.**
//      `sealed` must die of power on every seed and never to a character;
//      parking the camera anywhere but CAM 4B must let Freddy in on every
//      seed. A suite where nothing dies cannot tell a working defence from a
//      dead code path -- mistake register #12.
//   2. **The census itself**, at a reduced seed count so it runs in CI. The
//      3000-seed figures are reported in the docs; this pins that the model
//      and policies still clear a representative slice.
//   3. **Mechanics that the census result depends on**, each anchored to the
//      group that states it, so a regression names the rule it broke.
//
//   node packages/propose/bin/census/test-fnaf1-census.ts

import { Fnaf1Sim, DOOR_OPEN, DOOR_SHUT } from '@sixam/source/fnaf1';
import { communityLoop, rollGrid, sealed, doNothing, CAM }
  from '@sixam/propose/games/policy-fnaf1.ts';
import { POWER, ROLLS, FOXY } from '@sixam/source/fnaf1';

const failures: string[] = [];
let checks = 0;
const ok = (what: string, condition: unknown) => { checks += 1; if (!condition) failures.push(what); };
const eq = (what: string, a: unknown, b: unknown) => {
  checks += 1;
  if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};

const FOUR_TWENTY = { freddy: 20, bonnie: 20, chica: 20, foxy: 20 };

/** A FNaF 1 policy, as Fnaf1Sim.run takes it. */
type Policy = Parameters<Fnaf1Sim['run']>[0];

function run(night: number, makePolicy: () => Policy, seeds: number, custom: Readonly<Record<string, number>> | null = null) {
  const causes = new Map();
  let wins = 0;
  for (let seed = 0; seed < seeds; seed += 1) {
    const sim = new Fnaf1Sim({ night, seed, custom });
    const result = sim.run(makePolicy());
    if (result.outcome === '6AM') wins += 1;
    causes.set(result.outcome, (causes.get(result.outcome) ?? 0) + 1);
  }
  return { wins, seeds, causes: Object.fromEntries(causes) };
}

// --- 1. controls -------------------------------------------------------------

// Both doors shut all night spends usage 3 against a 999 reserve, so it must
// black out on every seed -- and must never be reached by a character first.
for (const night of [1, 6]) {
  const sealedRun = run(night, sealed, 200);
  eq(`sealed wins nothing on night ${night}`, sealedRun.wins, 0);
  ok(`sealed dies of power on night ${night}, not of a character`,
    Object.keys(sealedRun.causes).every((cause) => cause.startsWith('blackout')));
}

// Freddy's detector: g556 kills whenever the monitor is up and `viewing <> 42`.
// Watching CAM 4B is the only park that shuts him out; CAM 4A does not,
// because only the *retreat* (g557) excludes view 4. If this ever passes for
// 4A, the two groups have been collapsed into one rule again.
{
  const park4B = run(7, () => rollGrid({ park: CAM.eastCorner }), 200, FOUR_TWENTY);
  const park4A = run(7, () => rollGrid({ park: CAM.eastHall }), 200, FOUR_TWENTY);
  eq('4/20 parked on CAM 4B clears', park4B.wins, 200);
  eq('4/20 parked on CAM 4A is killed by Freddy every time', park4A.causes.freddy, 200);
  const parkCove = run(7, () => rollGrid({ park: CAM.pirate }), 200, FOUR_TWENTY);
  eq('4/20 parked on Pirate Cove is killed by Freddy every time', parkCove.causes.freddy, 200);
}

// Doing nothing must lose, and must lose mostly to Foxy: with no camera ever
// raised his attention timer never loads [g460], so he advances on every roll.
{
  const idle = run(3, () => doNothing, 200);
  ok('doing nothing loses night 3', idle.wins === 0);
  ok('and Foxy is the dominant cause', (idle.causes.foxy ?? 0) > 50);
}

// --- 2. the census -----------------------------------------------------------

// `roll-grid` is the result: every night and 4/20, with no losses.
for (const night of [1, 2, 3, 4, 5, 6]) {
  const result = run(night, () => rollGrid(), 400);
  eq(`roll-grid clears night ${night}`, result.wins, 400);
}
eq('roll-grid clears 4/20', run(7, () => rollGrid(), 400, FOUR_TWENTY).wins, 400);

// The published loop is the control `roll-grid` is measured against. It does
// not clear Night 5, and the way it fails is the point: never at a door.
//
// Its door discipline is sound -- no Bonnie, Chica or Freddy ever reaches the
// office with the reserve up. What it cannot afford is holding a door through
// a camp, and the failure surfaces either as a blackout or, once the power
// governor starts cutting camera time to stay solvent, as a Foxy run. Both
// are the same budget failure wearing different clothes, which is why the
// assertion is about *where* it never fails rather than about one cause.
//
// The claim is a *comparison* on a **held-out** block, not a rate on the block
// the knobs were chosen against. A third knob sweep produced a setting that
// scored 3000/3000 on seeds 0-2999 and then 2998/3000 on 3000-5999: at a
// ~1-in-3000 failure rate, a grid of a few dozen settings contains one that
// clears any given block by luck. Asserting a small-sample loss would be just
// as brittle in the other direction -- 400 seeds usually clear.
{
  const HELD_OUT = 3000;
  const rate = (makePolicy: () => Policy) => {
    let wins = 0;
    const causes = new Map();
    for (let seed = HELD_OUT; seed < HELD_OUT + 3000; seed += 1) {
      const sim = new Fnaf1Sim({ night: 5, seed });
      const r = sim.run(makePolicy());
      if (r.outcome === '6AM') wins += 1;
      else causes.set(r.outcome, (causes.get(r.outcome) ?? 0) + 1);
    }
    return { wins, causes: Object.fromEntries(causes) };
  };
  const loop = rate(() => communityLoop());
  const grid = rate(() => rollGrid());
  ok('roll-grid clears the held-out night 5 block', grid.wins === 3000);
  ok('the published loop does not', loop.wins < 3000);
  ok('and never loses at a door -- its failure is the budget, not the defence',
    !loop.causes.bonnie && !loop.causes.chica && !loop.causes.freddy);
  ok('it loses to the reserve or to what cutting the camera buys Foxy',
    Object.keys(loop.causes).every(
      (cause) => cause === 'foxy' || cause.startsWith('blackout')));
}

// --- 3. the mechanics the result rests on ------------------------------------

// The night is 535 s: hour 0 is 90 ticks and the rest 89 [g399 resets to 1].
{
  const sim = new Fnaf1Sim({ night: 1, seed: 1 });
  const result = sim.run(rollGrid());
  eq('a cleared night ends at 6 AM', result.outcome, '6AM');
  ok('and lasts 535 s to within a frame', Math.abs(result.frames / 60 - 535) < 1.5);
}

// The per-night power drain [g477-g480] must actually bite: night 5 has to
// end with less power than night 1 under an identical policy and seed.
{
  const one = new Fnaf1Sim({ night: 1, seed: 5 });
  one.run(rollGrid());
  const five = new Fnaf1Sim({ night: 5, seed: 5 });
  five.run(rollGrid());
  ok('the per-night drain costs night 5 more power than night 1',
    five.power < one.power - 100);
  eq('night 1 has no extra drain registered', POWER.extraDrainMs[1], null);
  eq('night 5 drains one extra unit every 3 s', POWER.extraDrainMs[5], 3000);
}

// Usage is 1 plus one per active control [g313].
{
  const sim = new Fnaf1Sim({ night: 1, seed: 0 });
  eq('idle usage is 1', sim.usage, 1);
  sim.viewing = CAM.eastCorner;
  eq('the camera costs 1', sim.usage, 2);
  sim.leftDoor = DOOR_SHUT; sim.rightDoor = DOOR_SHUT;
  eq('each door costs 1', sim.usage, 4);
  sim.leftLight = 1;
  eq('each light costs 1', sim.usage, 5);
  sim.viewing = 0; sim.leftDoor = DOOR_OPEN; sim.rightDoor = DOOR_OPEN; sim.leftLight = 0;
  eq('and everything off is 1 again', sim.usage, 1);
}

// The four roll periods, which are the published community figures.
eq('bonnie rolls every 4970 ms', ROLLS.bonnie.everyMs, 4970);
eq('chica rolls every 4980 ms', ROLLS.chica.everyMs, 4980);
eq('freddy rolls every 3020 ms', ROLLS.freddy.everyMs, 3020);
eq('foxy rolls every 5010 ms', ROLLS.foxy.everyMs, 5010);

// Foxy's hold is `50 + Random(1000)`, set every 100 ms while any camera is up
// [g460]. `docs/research/FNAF-SENSOR-ABLATION-RUNS.md` records this constant
// as UNKNOWN(not-located) and guesses `Random(950)+50`; it is located, and
// the bound is 1000, not 950.
eq('Foxy hold floor', FOXY.attentionTimer.min, 50);
eq('Foxy hold bound', FOXY.attentionTimer.bound, 1000);
eq('Foxy hold is refreshed every 100 ms', FOXY.attentionTimer.refreshMs, 100);
eq('Pirate Cove is view 99', FOXY.pirateCoveView, 99);

// A blocked Foxy costs 10, then 60, then 110 raw units [g455]. The community
// figures of 1, 6 and 11 are the same numbers in displayed units, because
// g313 renders `power left / 10`.
{
  const sim = new Fnaf1Sim({ night: 1, seed: 0 });
  sim.foxProgress = 5;
  sim.leftDoor = DOOR_SHUT;
  const before = sim.power;
  sim.step();
  eq('the first blocked Foxy run costs 10 raw units', before - sim.power, 10);
  ok('which is 1 displayed unit', (before - sim.power) / 10 === 1);
}

// --- report ------------------------------------------------------------------
if (failures.length) {
  console.error(`fnaf1 census: ${failures.length} of ${checks} checks FAILED`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`fnaf1 census: all ${checks} checks passed`);
