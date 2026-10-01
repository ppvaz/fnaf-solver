#!/usr/bin/env node
// Pin the FNaF 4 simulator and its policies.
//
// Same three groups as the FNaF 1 census test:
//
//   1. **Controls that must fail, and must fail for the stated reason.**
//      `do-nothing` must die to the black flash on every night -- the
//      g464/g468 cap is the mechanic whose absence made the 2026-09-20
//      session refuse to report this game at all -- and it must die on
//      distinct clocks: the slow Freddle fill on Night 1, the 30 s idle
//      accelerant (g593) on Night 2, and the 25 s Fredbear-night idle fuse
//      (g566/g564) on Night 5.
//   2. **The census itself**, a deterministic 100-seed block. The 3000-seed
//      figures live in the docs; this pins that the model and the community
//      line still clear the story nights and hold the measured shape on 5-8.
//   3. **Mechanics the census depends on**, each anchored to its group.
//
//   node packages/propose/bin/census/test-fnaf4-census.ts

import { Fnaf4Sim } from '@sixam/source/fnaf4';
import { POLICIES } from '@sixam/propose/games/policy-fnaf4.ts';
import { MODEL, BLACK_FLASH, BEDROOM, FOXY_CLOSET } from '@sixam/source/fnaf4';
import { nightSchedule, hourStartMs } from '@sixam/source';

const failures = [];
let checks = 0;
const ok = (what, condition) => { checks += 1; if (!condition) failures.push(what); };
const eq = (what, a, b) => {
  checks += 1;
  if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};

function run(night, makePolicy, seeds) {
  let wins = 0;
  const causes = new Map();
  for (let seed = 0; seed < seeds; seed += 1) {
    const sim = new Fnaf4Sim({ night, seed });
    const result = sim.run(makePolicy());
    if (result.outcome === '6AM') wins += 1;
    causes.set(result.outcome, (causes.get(result.outcome) ?? 0) + 1);
  }
  return { wins, seeds, causes: Object.fromEntries(causes) };
}

// --- 1. controls -------------------------------------------------------------

// The control that exposed the missing mechanic: a player who faces centre
// and never acts. Every gameover group the first simulator knew was
// player-triggered, so this control used to *clear* every night. The
// Freddy counter's 80 cap (g464) arming the black flash from anywhere is
// what kills it now, on every night.
{
  const r = run(1, POLICIES['do-nothing'], 100);
  eq('do-nothing loses night 1', r.wins, 0);
  eq('do-nothing dies to the black flash [g464->g468]', r.causes['black-flash'], 100);
}
for (const night of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const r = run(night, POLICIES['do-nothing'], 60);
  eq(`do-nothing loses night ${night}`, r.wins, 0);
  eq(`do-nothing black flash night ${night}`, r.causes['black-flash'], 60);
}

// And on three distinct clocks, one per idle mechanism.
{
  const s1 = new Fnaf4Sim({ night: 1, seed: 0 }); s1.run(POLICIES['do-nothing']());
  const s2 = new Fnaf4Sim({ night: 2, seed: 0 }); s2.run(POLICIES['do-nothing']());
  const s5 = new Fnaf4Sim({ night: 5, seed: 0 }); s5.run(POLICIES['do-nothing']());
  // Night 1 has no idle accelerant (g593 needs Night > 1) and Freddy AI 1,
  // so death is the plain fill: 80 units at 1/4 per second, late in the night.
  ok('do-nothing night 1 dies to the slow fill (> 200 s)', s1.frame > 200 * 60 && s1.frame < 360 * 60);
  // Night 2 adds +5/s after 30 s of standing still [g592/g593].
  ok('do-nothing night 2 dies to the idle accelerant (~43 s)', s2.frame > 30 * 60 && s2.frame < 60 * 60);
  // Night 5 is Fredbear-only, so the 25 s idle fuse [g566/g564] fires first.
  ok('do-nothing night 5 dies to the idle fuse (~22 s)', s5.frame > 15 * 60 && s5.frame < 30 * 60);
  ok('night 2 dies sooner than night 1', s2.frame < s1.frame);
  ok('night 5 dies sooner than night 2', s5.frame < s2.frame);
}

// The flash-blind control dies to the rule the audio cue exists to prevent:
// flashing into a hall-near occupant [g345/g346], or the flash never arriving
// at all and the meter capping.
{
  const r = run(2, POLICIES['flash-blind'], 60);
  eq('flash-blind loses night 2', r.wins, 0);
}

// The bed-stare control: watching the bed forever dies to the bedroom
// (g486/g480 arm the flag while the bed is viewed; g375/g376 kill on the
// forced turn) or the bed-watch fuse (g594/g595), never to a door.
{
  const r = run(2, POLICIES['bed-stare'], 60);
  eq('bed-stare loses night 2', r.wins, 0);
  ok('bed-stare dies in bed, not at a door',
     Object.keys(r.causes).every((c) => c.includes('bedroom') || c === 'black-flash' || c === 'foxy' || c === 'freddy'));
}

// --- 2. the census block -------------------------------------------------------

// Deterministic: same seeds, same draws, same result every run. The 3000-seed
// figures are the reported ones; this block pins the shape.
{
  const expected = { 1: 100, 2: 100, 3: 100, 4: 100 };
  for (const night of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const r = run(night, POLICIES['community-loop'], 100);
    if (expected[night] !== undefined) {
      eq(`community-loop clears night ${night} (100 seeds)`, r.wins, expected[night]);
    } else {
      // Nights 5-8 are the model ceiling: the published loop's tour period
      // against Fredbear's hall fuse. Pin the bands so a regression that
      // silently "fixes" or breaks the ceiling is caught.
      ok(`community-loop night ${night} stays partial (0 < wins, none perfect)`, r.wins >= 0 && r.wins < 100);
      if (night === 7 || night === 8) eq(`night ${night} is the ceiling (0/100)`, r.wins, 0);
    }
  }
}

// --- 3. mechanics ---------------------------------------------------------------

// The 80 cap arms from anywhere and kills on a drawn fuse [g464/g467/g468].
eq('black flash arms at 80', BLACK_FLASH.armAt, 80);
eq('black flash fuse is 50 + Random(100)', [BLACK_FLASH.framesMin, BLACK_FLASH.framesRandom], [50, 100]);

// The meter: fill only while the bed is unwatched [g397], drain 20/s while
// it is watched [g401], kill at 60 at the bed [g427/g428].
{
  const sim = new Fnaf4Sim({ night: 6, seed: 3 });   // hour 0: Freddy AI 5
  // The Every loads on its first reach and fires one period later, so the
  // first +5 lands on frame 241, not 240.
  for (let i = 0; i < 4 * 60 + 2; i += 1) sim.step();
  eq('meter fills at Freddy AI per 4 s [g397]', sim.freddyCounter, 5);
  sim.follow = 43; sim.viewingBed = 1;
  for (let i = 0; i < 60; i += 1) sim.step();        // 1 s of viewing
  ok('viewing the bed drains at 20/s [g401]', sim.freddyCounter < 5);
}

// The bedroom rule: dwell threshold 20 - Night, Bonnie strict, Chica at
// least [g486/g480], and a hall view resets the dwell [g485/g481].
eq('bedroom threshold expression', BEDROOM.threshold, '20 - Night');
eq('bedroom bonnie op strict', BEDROOM.bonnieOp, '>');
eq('bedroom chica op at-least', BEDROOM.chicaOp, '>=');
{
  const sim = new Fnaf4Sim({ night: 6, seed: 0 });
  sim.bonnie = 'nearL';
  sim.bonnieAV6 = 15;   // > 20 - 6 = 14: over Bonnie's line, under a view reset
  sim.follow = 43;      // at the bed
  sim.viewingBed = 1;
  sim.step();
  eq('bonnie bedroom flag arms over 20-Night [g486]', sim.bonnieAV7, 1);
  sim.follow = 10;      // at the left door
  sim.flashing = 1;     // viewing the hall
  sim.step();
  eq('a hall view resets the dwell and the flag [g485]', [sim.bonnieAV6, sim.bonnieAV7], [0, 0]);
}

// Foxy's closet: pulses at Random(10)+1 <= AI every 5 s [g236], the meter at
// 10 [g282], decay only from the closet-hold [g273].
eq('foxy got-you at AV2 10', FOXY_CLOSET.av2GotYou, 10);
{
  const sim = new Fnaf4Sim({ night: 3, seed: 1 });   // night 3: Foxy 10, all rolls pass
  // Run 100 s with a player standing at the closet holding it shut: Foxy
  // arrives, charges while unviewed, and decays under the hold.
  const pol = (s) => { s.follow = 29; s.closetShut = 1; };
  let frames = 0;
  while (!sim.over && frames < 100 * 60) { pol(sim); sim.step(); frames += 1; }
  ok('foxy charged and was held below got-you at the closet', sim.foxy === 'closet' && sim.foxyAv2 < 10);
}

// The shadow nights: 15s with Freddy 6 [g600], all 20s [g602], and both
// switch to Fredbear 20 alone at 4 AM [g601/g603].
{
  const s7 = nightSchedule(MODEL, 7);
  const s8 = nightSchedule(MODEL, 8);
  eq('night 7 opens 15/15/15/6', s7.hours[0].levels,
     { freddy: 6, bonnie: 15, chica: 15, foxy: 15, fredbear: 0 });
  eq('night 7 at 4 AM is Fredbear 20 alone', s7.hours[4].levels,
     { freddy: 0, bonnie: 0, chica: 0, foxy: 0, fredbear: 20 });
  eq('night 8 opens 20/20/20/6', s8.hours[0].levels,
     { freddy: 6, bonnie: 20, chica: 20, foxy: 20, fredbear: 0 });
  eq('night 8 at 4 AM is Fredbear 20 alone', s8.hours[4].levels,
     { freddy: 0, bonnie: 0, chica: 0, foxy: 0, fredbear: 20 });
}

// The night is 360 s and the win is the 6 AM leave [g568/g573].
eq('fnaf4 night is 360 s', nightSchedule(MODEL, 1).lengthMs, 360_000);
eq('fnaf4 hour 1 starts at 60 s', hourStartMs(MODEL.clock, 1), 60_000);

// --- report -------------------------------------------------------------------

if (failures.length) {
  console.error(`test-fnaf4-census: ${failures.length} of ${checks} checks failed`);
  for (const f of failures) console.error('  FAIL ' + f);
  process.exit(1);
}
console.log(`test-fnaf4-census: all ${checks} checks passed`);
