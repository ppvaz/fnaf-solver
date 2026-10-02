#!/usr/bin/env node
// Check the four games' night models against figures derived independently
// of them.
//
// A table transcribed from a dump is only as good as what can contradict it,
// and "it parses" contradicts nothing. Every assertion below is anchored to
// something that was not read off the same table:
//
//   - FNaF 1's difficulty table and its 8:55 night are published community
//     figures, measured from the game years before this repository existed.
//   - FNaF 2's rows must round-trip against `config.js`'s `AI_BY_NIGHT`,
//     which the live route and every graded bundle are computed against.
//   - FNaF 3's Night 1 length was measured on the handset (~240 s, 2026-09-20)
//     before this model was written.
//   - The roll arithmetic is checked against the engine's own semantics
//     (`Random(N)` yields 0..N-1), not against a table.
//
// Structural checks cover the rest: every row cites the group it came from,
// and no clock is missing its source.
//
//   node packages/source/test/test-night-models.ts

import {
  GAMES, GAME_IDS, PACKAGES, scheduleFor, peakFor, canActIn, nightsOf,
  rollChance, rollsInHour, opportunities, modelFor, fnaf1, fnaf2, fnaf3, fnaf4,
} from '@sixam/source';
import { AI_BY_NIGHT, aiCap } from '@sixam/source/fnaf2';
import * as FPS_C from '@sixam/source/games/fnaf2/config.ts';

const failures: string[] = [];
let checks = 0;

function ok(what: string, condition: unknown) {
  checks += 1;
  if (!condition) failures.push(what);
}

function eq(what: string, actual: unknown, expected: unknown) {
  checks += 1;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${what}: expected ${e}, got ${a}`);
}

// --- the roll, against the engine's semantics -------------------------------
//
// `Random(N)` is 0..N-1, so `Random(N) + 1 <= L` passes on L of N values.
eq('rollChance(20, 0) -- an unarmed character never rolls', rollChance(20, 0), 0);
eq('rollChance(20, 20) -- a full dial always passes', rollChance(20, 20), 1);
eq('rollChance(20, 10)', rollChance(20, 10), 0.5);
eq('rollChance clamps above its bound', rollChance(10, 15), 1);
eq('rollChance(20, 1) is one in twenty', rollChance(20, 1), 0.05);

// FNaF 4's bounds are not uniform, and that is the point of carrying them.
eq('fnaf4 Foxy at 10 is certain (bound 10)', rollChance(fnaf4.ROLLS.foxy.bound, 10), 1);
eq('fnaf4 Bonnie at 10 is even (bound 20)', rollChance(fnaf4.ROLLS.bonnie.bound, 10), 0.5);

// --- night lengths, against independent measurements ------------------------
//
// FNaF 1: g399 resets the minute counter to 1, not 0, so hour 0 is 90 ticks
// and every later hour 89 -- 90 + 5*89 = 535 s. The community publishes 8:55.
eq('fnaf1 night is 8:55', scheduleFor('fnaf1', 1).lengthMs, 535_000);
eq('fnaf1 hour 0 is 90 s', scheduleFor('fnaf1', 1).hours[0].durationMs, 90_000);
eq('fnaf1 hour 1 is 89 s', scheduleFor('fnaf1', 1).hours[1].durationMs, 89_000);

// FNaF 2: g630 zeroes the accumulator, so there is no first-hour seam.
eq('fnaf2 night is 7:00', scheduleFor('fnaf2', 1).lengthMs, 420_000);
eq('fnaf2 hour 0 is 70 s', scheduleFor('fnaf2', 1).hours[0].durationMs, 70_000);
eq('fnaf2 hour 1 is 70 s too -- no seam', scheduleFor('fnaf2', 1).hours[1].durationMs, 70_000);

// FNaF 3: Night 1 is measured on the handset at ~240 s; later nights 360 s.
eq('fnaf3 night 1 is 240 s (handset-corroborated)', scheduleFor('fnaf3', 1).lengthMs, 240_000);
eq('fnaf3 night 2 is 360 s', scheduleFor('fnaf3', 2).lengthMs, 360_000);
ok('fnaf3 is the only game whose hour depends on the night',
  GAME_IDS.filter((g) => scheduleFor(g, 1).lengthMs !== scheduleFor(g, 2).lengthMs).join() === 'fnaf3');

eq('fnaf4 night is 360 s', scheduleFor('fnaf4', 1).lengthMs, 360_000);

// Fast nights halve every game's night. FNaF 1 and 2 halve the tick, FNaF 3
// and 4 halve the hour; both land in the same place.
for (const game of GAME_IDS) {
  const normal = scheduleFor(game, 2).lengthMs;
  const fast = scheduleFor(game, 2, { fastNights: true }).lengthMs;
  eq(`${game} fast nights halve the night`, fast, normal / 2);
}

// --- FNaF 1 against the published table -------------------------------------
//
// These six rows are the community's published FNaF 1 AI table. They were
// measured from the game independently of this dump, so agreement is a real
// cross-check on the reader, the XOR constant and the transcription at once.
const PUBLISHED_FNAF1 = {
  1: { freddy: 0, bonnie: 0, chica: 0, foxy: 0 },
  2: { freddy: 0, bonnie: 3, chica: 1, foxy: 1 },
  3: { freddy: 1, bonnie: 0, chica: 5, foxy: 2 },
  // Night 4's Freddy is 1 or 2 -- `1 + Random(2)`, drawn at night start.
  4: { freddy: { min: 1, max: 2 }, bonnie: 2, chica: 4, foxy: 6 },
  5: { freddy: 3, bonnie: 5, chica: 7, foxy: 5 },
  6: { freddy: 4, bonnie: 10, chica: 12, foxy: 6 },
};
for (const [night, expected] of Object.entries(PUBLISHED_FNAF1)) {
  const atStart = scheduleFor('fnaf1', Number(night)).hours[0].levels;
  for (const [id, level] of Object.entries(expected)) {
    eq(`fnaf1 night ${night} ${id} matches the published table`, atStart[id], level);
  }
}

// The published movement periods, to two decimals: 4.97 / 4.98 / 3.02 / 5.01 s.
eq('fnaf1 bonnie period', fnaf1.ROLLS.bonnie.everyMs, 4970);
eq('fnaf1 chica period', fnaf1.ROLLS.chica.everyMs, 4980);
eq('fnaf1 freddy period', fnaf1.ROLLS.freddy.everyMs, 3020);
eq('fnaf1 foxy period', fnaf1.ROLLS.foxy.everyMs, 5010);

// The hourly escalation carries no night comparison in the sheet, so it must
// apply on every night -- including Night 1, where it raises Bonnie off zero.
eq('fnaf1 night 1 Bonnie is 0 at midnight', scheduleFor('fnaf1', 1).hours[0].levels.bonnie, 0);
eq('fnaf1 night 1 Bonnie is 1 by 2 AM', scheduleFor('fnaf1', 1).hours[2].levels.bonnie, 1);
eq('fnaf1 night 1 Bonnie is 3 by 4 AM', scheduleFor('fnaf1', 1).hours[4].levels.bonnie, 3);

// Night 6's Chica reaches 14 by 4 AM, which is above every FNaF 2 cap and is
// allowed here because FNaF 1 has no cap group.
eq('fnaf1 night 6 Chica peaks at 14', peakFor('fnaf1', 6, 'chica'), 14);
eq('fnaf1 has no cap', fnaf1.CAP, null);
eq('fnaf3 has no cap', fnaf3.CAP, null);
eq('fnaf4 has no cap', fnaf4.CAP, null);
ok('fnaf2 is the one game that caps', fnaf2.CAP === aiCap);

// --- FNaF 2 round-trips against config.js -----------------------------------
//
// The shared shape must not quietly become a second source of truth for the
// game this repository actually runs.
for (const [night, rows] of Object.entries(AI_BY_NIGHT)) {
  const mine = fnaf2.ROWS.filter((row) => row.night.value === Number(night));
  eq(`fnaf2 night ${night} row count`, mine.length, rows.length);
  rows.forEach((row, index) => {
    eq(`fnaf2 night ${night} row ${index} hour`, mine[index].hour, row.hour);
    eq(`fnaf2 night ${night} row ${index} set`, mine[index].set, row.set);
  });
}
// And the cap must still bite through the shared applier.
eq('fnaf2 night 7 Foxy is capped at 17', scheduleFor('fnaf2', 7).hours[0].levels.foxy, 17);
eq('fnaf2 night 7 Golden Freddy is capped at 10', scheduleFor('fnaf2', 7).hours[0].levels.golden, 10);
eq('fnaf2 night 7 Toy Bonnie is capped at 15', scheduleFor('fnaf2', 7).hours[0].levels.toybonnie, 15);

// --- what each night arms, and what it does not -----------------------------
//
// "This character cannot act tonight" is a statement the table makes. It is
// the positive control every policy family is scored against.
ok('fnaf1 night 1 arms nobody at midnight',
  ['freddy', 'bonnie', 'chica', 'foxy'].every((id) => !canActIn('fnaf1', 1, id) ||
    scheduleFor('fnaf1', 1).hours[0].levels[id] === 0));

// FNaF 3 Night 1 is AI 0 with no phantoms armed -- which is why it was
// cleared on the handset with zero input on 2026-09-20.
eq('fnaf3 night 1 AI is 0', scheduleFor('fnaf3', 1).hours[0].levels.ai, 0);
for (const phantom of ['bb', 'mangle', 'golden', 'chica', 'puppet']) {
  eq(`fnaf3 night 1 does not arm ${phantom}`, scheduleFor('fnaf3', 1).hours[6].levels[phantom], 0);
}
eq('fnaf3 night 2 arms BB and Mangle only',
  ['bb', 'mangle', 'golden', 'chica', 'puppet'].filter((id) => canActIn('fnaf3', 2, id)),
  ['bb', 'mangle']);
eq('fnaf3 night 4 arms all five',
  ['bb', 'mangle', 'golden', 'chica', 'puppet'].filter((id) => canActIn('fnaf3', 4, id)),
  ['bb', 'mangle', 'golden', 'chica', 'puppet']);

// The phantom exposure fuse halves across the six nights.
eq('fnaf3 night 1 time limit', scheduleFor('fnaf3', 1).hours[0].levels.timeLimit, 100);
eq('fnaf3 night 6 time limit', scheduleFor('fnaf3', 6).hours[0].levels.timeLimit, 50);

// FNaF 4 Night 5 names only Fredbear, so the other four cannot act at all.
eq('fnaf4 night 5 arms only Fredbear',
  ['freddy', 'bonnie', 'chica', 'foxy', 'fredbear'].filter((id) => canActIn('fnaf4', 5, id)),
  ['fredbear']);
// Night 6 switches antagonist at 4 AM: a `set` to 0, not a decay.
eq('fnaf4 night 6 Bonnie is 12 at midnight', scheduleFor('fnaf4', 6).hours[0].levels.bonnie, 12);
eq('fnaf4 night 6 Bonnie is 0 at 4 AM', scheduleFor('fnaf4', 6).hours[4].levels.bonnie, 0);
eq('fnaf4 night 6 Fredbear is 15 at 4 AM', scheduleFor('fnaf4', 6).hours[4].levels.fredbear, 15);
// The shadow nights [g600-g603]: Night 7 is 15s with Freddy 6, Night 8 is
// 20s, and both end as Fredbear 20 alone from 4 AM.
eq('fnaf4 night 7 Bonnie is 15 at midnight', scheduleFor('fnaf4', 7).hours[0].levels.bonnie, 15);
eq('fnaf4 night 7 Freddy is 6 at midnight', scheduleFor('fnaf4', 7).hours[0].levels.freddy, 6);
eq('fnaf4 night 7 is Fredbear 20 alone at 4 AM', scheduleFor('fnaf4', 7).hours[4].levels,
  { freddy: 0, bonnie: 0, chica: 0, foxy: 0, fredbear: 20 });
eq('fnaf4 night 8 opens at 20/20/20/20', [scheduleFor('fnaf4', 8).hours[0].levels.bonnie,
  scheduleFor('fnaf4', 8).hours[0].levels.chica, scheduleFor('fnaf4', 8).hours[0].levels.foxy], [20, 20, 20]);
eq('fnaf4 night 8 is Fredbear 20 alone at 4 AM', scheduleFor('fnaf4', 8).hours[4].levels.fredbear, 20);
// Nights 1-4 escalate by adding, so a mid-night level exceeds its opening one.
eq('fnaf4 night 2 Foxy opens at 1', scheduleFor('fnaf4', 2).hours[0].levels.foxy, 1);
eq('fnaf4 night 2 Foxy is 4 from 3 AM', scheduleFor('fnaf4', 2).hours[3].levels.foxy, 4);

// --- roll opportunities, the cross-game comparable --------------------------
//
// A night is a count of chances. FNaF 1's Freddy gets the most opportunities
// of any character in the series because his 3020 ms period is the shortest.
const f1 = opportunities('fnaf1', 6);
eq('fnaf1 hour 0 gives Freddy 29 chances', f1[0].rolls.freddy.opportunities,
  Math.floor(90_000 / 3020));
ok('fnaf1 night 6 Freddy expects at least 5 moves an hour',
  f1[0].rolls.freddy.expected >= 5);
// FNaF 4 Night 3 Foxy is the extreme case: bound 10, level 10.
eq('fnaf4 night 3 Foxy passes every roll', opportunities('fnaf4', 3)[0].rolls.foxy.chance, 1);
eq('rollsInHour counts whole periods only',
  rollsInHour({ everyMs: 4000 } as Parameters<typeof rollsInHour>[0], 10_000, 0).opportunities, 2);   // only the period counts opportunities

// --- structure: nothing may be uncited --------------------------------------
for (const game of GAME_IDS) {
  const model = modelFor(game);
  ok(`${game} clock cites its groups`, typeof model.clock.source === 'string'
    && model.clock.source.length > 0);
  ok(`${game} declares a win hour`, model.clock.winHour === 6);
  ok(`${game} knows its package`, typeof (PACKAGES as Partial<Record<string, string>>)[game] === 'string');   // any id may be missing
  for (const [index, row] of model.rows.entries()) {
    // FNaF 2's rows are translated from config.js, which cites its groups in
    // comments beside the table rather than per row; every other game's rows
    // must name the group they were read from.
    if (game === 'fnaf2') continue;
    ok(`${game} row ${index} cites a group`, Number.isInteger(row.group));
    ok(`${game} row ${index} has a night comparison`,
      row.night && typeof row.night.op === 'string');
  }
  for (const [id, roll] of Object.entries(model.rolls)) {
    ok(`${game}.${id} roll cites a group`, Number.isInteger(roll.group));
    ok(`${game}.${id} roll has a period`, roll.everyMs > 0);
    ok(`${game}.${id} roll has a bound`, roll.bound > 0);
  }
}

// --- the two blockers Plan 26 named, now closed ---------------------------
//
// FNaF 3: the attack chain advances on the ventilation blackout, not on a
// movement action, so a simulator needs the systems economy first.
{
  const vent = fnaf3.VENTILATION;
  eq('the chain advances above blackout 250', vent.chainAdvancesAbove, 250);
  eq('all four chain steps are cited',
    Object.keys(vent.chainGroups).length, 4);
  eq('the shared error threshold', vent.errorAt, -10);
  // The blackout ramp needs twice the dwell the hallucination does, so
  // clearing an error late still avoids the chain.
  ok('the blackout ramp needs a longer dwell than the hallucination',
    vent.blackoutRampAt(5) > vent.hallucinationAt(5));
  eq('at AI 5 the hallucination needs 500 frames of error', vent.hallucinationAt(5), 500);
  eq('at AI 5 the blackout ramp needs 1000', vent.blackoutRampAt(5), 1000);
  // The AI-indexed drain table stops at 6 while Night 6 runs AI 7. A model
  // that extrapolated the 12/10/9/8/6 series would drain a night the game
  // does not, so the gap is pinned rather than smoothed over.
  eq('the AI-indexed drain covers AI 2 to 6 only',
    Object.keys(vent.drains.byAi.everyMsByAi).map(Number), [2, 3, 4, 5, 6]);
  eq('and says where it stops', vent.drains.byAi.missingAbove, 6);
  ok('Night 6 runs AI 7, above that table',
    scheduleFor('fnaf3', 6).hours[0].levels.ai === 7);
  // Which is why the inactivity drain matters: it is what still runs there.
  eq('the inactivity drain is 1 per second', vent.drains.inactivity.everyMs, 1000);
  ok('and it is not AI-indexed', vent.drains.inactivity.amount === 1);
}

// FNaF 4: `follow` is a walk machine, and only five of its 46 states can act.
{
  const follow = fnaf4.FOLLOW;
  eq('four stations plus the hub are actionable', follow.actionable.length, 5);
  eq('the bed is state 43, which Freddy kills at', follow.stations.bed, 43);
  ok('every station is actionable',
    Object.values(follow.stations).every((state) => follow.actionable.includes(state)));
  ok('the hub is actionable', follow.actionable.includes(follow.hub));
  // Every station has an approach and a return, and neither is empty -- that
  // is the travel cost a schedule has to carry.
  for (const name of Object.keys(follow.stations) as Array<keyof typeof follow.stations>) {   // the keys of a literal record
    ok(`${name} has an approach walk`, follow.approaches[name].via.length > 0);
    ok(`${name} has a return walk`, follow.returns[name].via.length > 0);
  }
  // A station action returns to the same station, so it costs time and not
  // position. The closet has no flashlight; the bed has no action at all.
  ok('the left door can be closed and flashed',
    follow.actions.leftDoor.close && follow.actions.leftDoor.flashlight);
  ok('the closet can be closed but not flashed',
    follow.actions.closet.close && !(follow.actions.closet as Readonly<Record<string, unknown>>).flashlight);   // a key it lacks reads undefined
  eq('the bed has no station action', Object.keys(follow.actions.bed).length, 0);
  // The doors are reached by different hitzones and are never co-located.
  ok('the two doors are separate stations',
    follow.stations.leftDoor !== follow.stations.rightDoor);
  eq('the left door is reached by its own hitzone',
    follow.approaches.leftDoor.hitzone, 'HUDDoorLeftHitzone');
  // The hub is a *facing*: g30 auto-walks left at X = 512 and g34 right at
  // X = 788, and 750 matches neither, so facing centre rests. Three distinct
  // values, or the auto-walk would be ambiguous.
  eq('three distinct facings', new Set(Object.values(follow.facing)).size, 3);
  ok('centre matches neither auto-walk',
    follow.facing.centre !== follow.facing.leftDoor
    && follow.facing.centre !== follow.facing.rightDoor);
}

// --- animation durations, and the model that derives them -----------------
//
// The Fusion duration model: an animation's counter advances by `speed` each
// tick and the frame flips at 100, so a sequence lasts
// `frames * 100 / (speed * rate)`. `dump_animations.py` documents it and
// `config.js:528-535` used it for FNaF 2's flips.
//
// Register entry 9 says a measurement in a comment is not a gate. Those four
// derivations lived only in a comment, so they are checked here against the
// frames and speeds that comment quotes: if someone edits a constant without
// the bank, this fails.
{
  const durationMs = (frames: number, speed: number, rate = 60) => frames * 100 / (speed * rate) * 1000;
  const BANK = {                       // as read from build 296's animation bank
    mmonitorUp: { frames: 11, speed: 90, constant: FPS_C.MONITOR_ANIM_UP },
    mmonitorDown: { frames: 11, speed: 50, constant: FPS_C.MONITOR_ANIM_DOWN },
    mmaskOn: { frames: 9, speed: 75, constant: FPS_C.MASK_ANIM_ON },
    mmaskOff: { frames: 11, speed: 75, constant: FPS_C.MASK_ANIM_OFF },
  };
  for (const [name, row] of Object.entries(BANK)) {
    const fromBank = durationMs(row.frames, row.speed);
    const fromConstant = row.constant * 1000 / FPS_C.FPS;
    ok(`${name}: the engine-frame constant matches the animation bank`,
      Math.abs(fromBank - fromConstant) < 1000 / FPS_C.FPS);
  }
  // The flips are asymmetric, which is the fact the route is built on:
  // lowering the monitor takes ~1.8x raising it.
  ok('monitor-down is much slower than monitor-up',
    FPS_C.MONITOR_ANIM_DOWN / FPS_C.MONITOR_ANIM_UP > 1.7);
}

// FNaF 4's walk costs, and the caveat that they are animation lengths.
{
  const walk = fnaf4.WALK_MS;
  const rot = fnaf4.ROTATION_MS;
  ok('the walk table says it is a lower bound', walk.bound.startsWith('LOWER'));
  // Approach is longer than return on every station, in the source's own
  // numbers -- so a rotation is not symmetric and a schedule cannot average it.
  eq('left door: out costs more than back', walk.toLeftDoor > walk.fromLeftDoor, true);
  eq('right door: out costs more than back', walk.toRightDoor > walk.fromRightDoor, true);
  eq('closet: out costs more than back', walk.toCloset > walk.fromCloset, true);
  // The two doors are symmetric on the way out and differ by one leg back.
  eq('the two approaches are symmetric', walk.toLeftDoor, walk.toRightDoor);
  // The rotation figures must follow from the legs, not float free of them.
  eq('leftToRight is fromLeftDoor + toRightDoor',
    rot.leftToRight, walk.fromLeftDoor + walk.toRightDoor);
  eq('the tour is all four legs',
    rot.bothDoorsTour,
    walk.toLeftDoor + walk.fromLeftDoor + walk.toRightDoor + walk.fromRightDoor);
  eq('the bed round trip', rot.bedRoundTrip, walk.toBed + walk.fromBed);
  // The result that made the map worth having.
  ok('a door-to-door rotation eats most of one roll period',
    rot.leftToRight / rot.rollGridMs > 0.7);
  ok('and a both-doors tour does not fit inside one at all',
    rot.bothDoorsTour > rot.rollGridMs);
  ok('the bed is the cheapest station by a wide margin',
    rot.bedRoundTrip < rot.closetRoundTrip / 2);
  eq('the roll grid matches the rolls it is compared against',
    rot.rollGridMs, fnaf4.ROLLS.bonnie.everyMs);
  eq('and Chica is on the same grid', rot.rollGridMs, fnaf4.ROLLS.chica.everyMs);
}

eq('every game is registered', GAME_IDS, ['fnaf1', 'fnaf2', 'fnaf3', 'fnaf4']);
eq('fnaf3 is the only six-night game', GAME_IDS.filter((g) => nightsOf(g) === 6), ['fnaf3']);

// --- report -----------------------------------------------------------------
if (failures.length) {
  console.error(`night models: ${failures.length} of ${checks} checks FAILED`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`night models: all ${checks} checks passed`);
