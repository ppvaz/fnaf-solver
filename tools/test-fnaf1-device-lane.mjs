#!/usr/bin/env node
// Pin FNaF 1's input rules and the device lane built on them.
//
// The idealised lane (policy-fnaf1.js) writes simulator state directly and
// prices nothing. These checks pin the rules the device lane depends on, each
// anchored to the group that states it, and pin that the lane refuses what
// the phone refuses:
//
//   1. input acceptance: cooldown, flip lock, door animation, light reset;
//   2. the moving-door rule: neither death nor turn-back at AV0 1 or 4;
//   3. the lane itself: a policy that taps a control off its pan is an error,
//      and the roll-grid policy clears a small slice while a control policy
//      that never flicks loses to Foxy;
//   4. the population record (`--population`, minutes on seven cores, not
//      re-run here) still describes the tree: its timing model and design
//      block hash as recorded, the listed losses replay to the same outcome
//      and frame, and a fixed held-out sample replays as recorded.
//
//   node tools/test-fnaf1-device-lane.mjs

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Fnaf1Sim, DOOR_OPEN, DOOR_SHUT, DOOR_CLOSING, DOOR_OPENING, INPUT }
  from '../packages/core/src/mechanics/games/sim-fnaf1.js';
import { runDeviceNight, loadTiming, grid420, FOUR_TWENTY, TIMING_PATH, POPULATION_KIND, POPULATION_LANES }
  from './fnaf1-device-lane.mjs';
import { designBlock } from './winner-census.mjs';

const failures = [];
let checks = 0;
const ok = (what, condition) => { checks += 1; if (!condition) failures.push(what); };
const eq = (what, a, b) => {
  checks += 1;
  if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};

const quiet = () => new Fnaf1Sim({ night: 1, seed: 0 });
const steps = (sim, n) => { for (let i = 0; i < n; i += 1) sim.step(); };

// --- 1. acceptance -----------------------------------------------------------
{
  const sim = quiet();
  ok('a light press is taken', sim.press('leftLight'));
  eq('the light is on', sim.leftLight, 1);
  ok('a second press inside the cooldown is refused [g166/g213]', !sim.press('leftLight'));
  steps(sim, INPUT.clickCooldownFrames - 1);
  ok('still refused one frame early', !sim.press('rightLight'));
  steps(sim, 1);
  ok('taken once the cooldown is out', sim.press('rightLight'));
  eq('the other light went out [g215]', [sim.leftLight, sim.rightLight], [0, 1]);
}
{
  const sim = quiet();
  ok('monitor up is taken', sim.press('monitor'));
  eq('viewing stays 0 through the flip', sim.viewing, 0);
  ok('a second monitor press is locked out by the flip [g270/g271]', !sim.press('monitor'));
  // The press frame is the first step: g5 is evaluated before g270 in it, and
  // g846 has counted 1 by its end, so g5 first sees 23 twenty-three frames on.
  steps(sim, INPUT.monitorFlipFrames);
  eq('not up one frame early', sim.viewing, 0);
  steps(sim, 1);
  ok('up 23 frames after the press frame [g5]', sim.viewing > 0);
  ok('a door press with the monitor up is refused', !sim.press('leftDoor'));
  ok('a camera tap is taken while up', sim.selectCamera(42));
  steps(sim, 1);
  eq('the view follows next frame [g33]', sim.viewing, 42);
}
{
  const sim = quiet();
  sim.press('leftLight');
  steps(sim, INPUT.clickCooldownFrames);
  sim.press('monitor');
  steps(sim, INPUT.monitorFlipFrames + 1);
  ok('a lit light stays lit under the raised monitor', sim.leftLight === 1 && sim.viewing > 0);
  sim.press('monitor');
  eq('down is immediate [g453]', sim.viewing, 0);
  steps(sim, 1);
  eq('and the lights go out after it [g357]', sim.leftLight, 0);
}
{
  const sim = quiet();
  ok('a door press is taken', sim.press('leftDoor'));
  eq('it starts closing [g168]', sim.leftDoor, DOOR_CLOSING);
  steps(sim, INPUT.clickCooldownFrames);
  ok('an opening press mid-animation matches no rule', !sim.press('leftDoor'));
  steps(sim, INPUT.doorAnimFrames - INPUT.clickCooldownFrames);
  eq('shut after 32 frames [g160]', sim.leftDoor, DOOR_SHUT);
  ok('the reopen is taken', sim.press('leftDoor'));
  eq('opening [g190]', sim.leftDoor, DOOR_OPENING);
  steps(sim, INPUT.doorAnimFrames);
  eq('open after 32 frames [g161]', sim.leftDoor, DOOR_OPEN);
}

// --- 2. a moving door holds its occupant --------------------------------------
{
  const sim = new Fnaf1Sim({ night: 7, seed: 1, custom: FOUR_TWENTY });
  sim.bonnie = 'door';
  sim.leftDoor = DOOR_CLOSING;
  sim.leftDoorAnim = -100000;            // keep it closing through the roll
  steps(sim, 400);                       // Bonnie rolls at ~5 s
  ok('a closing door neither kills nor turns him back', sim.over === null && sim.bonnie === 'door');
  const usageShut = (() => { const s = quiet(); s.leftDoor = DOOR_SHUT; return s.usage; })();
  const usageClosing = (() => { const s = quiet(); s.leftDoor = DOOR_CLOSING; return s.usage; })();
  const usageOpening = (() => { const s = quiet(); s.leftDoor = DOOR_OPENING; return s.usage; })();
  eq('a closing door costs nothing, a shut or opening one costs 1 [g305-g308]',
    [usageClosing, usageShut, usageOpening], [1, 2, 2]);
}

// --- 3. the lane ---------------------------------------------------------------
const timing = loadTiming();
{
  function* offPan() { yield { tap: 'rightLight' }; }
  const r = runDeviceNight({ seed: 0, timing, policy: offPan });
  eq('tapping a right control from pan 0 is a policy error', r.outcome, 'policy-error');
}
{
  function* never() { for (;;) yield { wait: 1000 }; }
  let foxy = 0;
  for (let seed = 0; seed < 20; seed += 1) {
    if (runDeviceNight({ seed, timing, policy: never }).outcome !== '6AM') foxy += 1;
  }
  ok('doing nothing at 4/20 loses every seed', foxy === 20);
}
{
  let wins = 0;
  const lanes = ['typical', 'worst'];
  for (const lane of lanes) {
    for (let seed = 0; seed < 25; seed += 1) {
      if (runDeviceNight({ seed, timing, lane, policy: grid420 }).outcome === '6AM') wins += 1;
    }
  }
  eq('grid420 clears a 25-seed slice in both lanes (3000-seed figures are in the lane doc)', wins, 50);
}

// --- 4. the population record ---------------------------------------------------
let population = '';
{
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const dir = new URL('../docs/evidence/', import.meta.url);
  const name = readdirSync(dir).filter((n) => /^fnaf1-420-device-lane-population-\d{8}\.json$/.test(n)).sort().pop();
  ok('a fnaf1-420-device-lane-population record is committed', Boolean(name));
  if (name) {
    const record = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    eq(`${name} kind`, record.kind, POPULATION_KIND);
    eq(`${name} lanes`, record.lanes.map((l) => l.lane), [...POPULATION_LANES]);
    ok(`${name}: the timing model changed since; re-run --population`,
      record.method.timingSha256 === sha256(readFileSync(TIMING_PATH)));
    const design = designBlock();
    ok(`${name}: the design block no longer rebuilds`, record.method.designBlock.sha256 === sha256(JSON.stringify(design.seeds)));
    const inDesign = new Set(design.seeds);
    const { start, count } = record.method.population;
    let replays = 0;
    for (const row of record.lanes) {
      ok(`${name} ${row.lane}: counts add up`, row.design.n + row.heldOut.n === row.n
        && row.design.wins + row.heldOut.wins === row.wins
        && row.losses.length === row.lossesListed && row.lossesListed <= row.n - row.wins);
      for (const [seed, outcome, frames] of row.losses.slice(0, 15)) {
        const r = runDeviceNight({ seed, timing, lane: row.lane, policy: grid420 });
        replays += 1;
        eq(`${name} ${row.lane} seed ${seed} replays as recorded`, [r.outcome, r.frames], [outcome, frames]);
      }
      // Only a lane whose every loss is listed can say which held-out seeds won.
      if (row.lossesListed === row.n - row.wins) {
        const lost = new Set(row.losses.map(([seed]) => seed));
        let taken = 0;
        for (let k = 0; taken < 3 && k < count; k += 1) {
          const seed = start + ((k * 40503 + row.lane.length * 977) % count);
          if (inDesign.has(seed)) continue;
          taken += 1; replays += 1;
          const won = runDeviceNight({ seed, timing, lane: row.lane, policy: grid420 }).outcome === '6AM';
          eq(`${name} ${row.lane} held-out seed ${seed} replays as recorded`, won, !lost.has(seed));
        }
      }
    }
    population = `; ${name} still describes the tree (${replays} replays)`;
  }
}

if (failures.length) {
  console.error(`fnaf1 device lane: ${failures.length} of ${checks} checks failed`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`fnaf1 device lane: all ${checks} checks passed${population}`);
