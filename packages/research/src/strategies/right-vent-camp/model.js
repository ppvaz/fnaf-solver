import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { GOLDEN_MODEL_SEED_SALT, randomSeedCohort, seedCohortDescriptor } from '../../seeds.js';
import { CYCLE, routeFor } from './route.js';

const at = seconds => Math.round(seconds * C.FPS);

function add(queue, frame, fn) {
  const rows = queue.get(frame) ?? [];
  rows.push(fn);
  queue.set(frame, rows);
}

/** @param {(sim: any) => boolean} guard */
function press(queue, frame, action, guard = () => true) {
  add(queue, frame, sim => { if (guard(sim)) sim.press(action); });
}

function release(queue, frame, action) {
  add(queue, frame, sim => sim.release(action));
}

function monitorDown(sim) { return sim.monitor === 'up' || sim.monitor === 'raising'; }
function monitorUp(sim) { return sim.monitor === 'down' || sim.monitor === 'lowering'; }

function flash(queue, frame) {
  press(queue, frame, 'light', sim => monitorUp(sim) && sim.maskFullyOff);
  release(queue, frame + 3, 'light');
}

function opening(queue) {
  press(queue, 1, 'monitor');
  press(queue, CYCLE.openingFirstCameraFrames, 'cam:11', sim => sim.camsUp);
  press(queue, CYCLE.openingFirstWindFrames, 'wind', sim => sim.camsUp);
  for (const boundary of [5, 10, 15, 20]) {
    release(queue, at(boundary - 0.6), 'wind');
    press(queue, at(boundary - 0.55), 'monitor', monitorDown);
    flash(queue, at(boundary - 0.15));
    if (boundary < 20) {
      press(queue, at(boundary + 0.1), 'monitor', monitorUp);
      press(queue, at(boundary + 0.35), 'cam:11', sim => sim.camsUp);
      press(queue, at(boundary + 0.4), 'wind', sim => sim.camsUp);
    }
  }
  flash(queue, at(24));
  press(queue, at(25), 'monitor', monitorUp);
  press(queue, at(25.35), 'cam:11', sim => sim.camsUp);
  press(queue, at(25.4), 'wind', sim => sim.camsUp);
}

function mainCycle(queue, base, cycle = CYCLE) {
  const lower = base + cycle.maskDownFrames;
  press(queue, lower, 'monitor', monitorDown);
  // The mask press follows monitor lowering, not the same frame as the tap.
  press(queue, lower + C.MONITOR_ANIM_DOWN + 3, 'mask', sim => sim.maskFullyOff);
  press(queue, base + cycle.maskOffFrames, 'mask', sim => sim.maskOn);
  flash(queue, base + cycle.foxyFlashFrames);
  press(queue, base + cycle.ventLightFrames, 'ventR', sim => sim.maskFullyOff);
  release(queue, base + cycle.nextRaiseFrames, 'ventR');
  press(queue, base + cycle.nextRaiseFrames, 'monitor', monitorUp);
  press(queue, base + cycle.windFrames, 'cam:11', sim => sim.camsUp);
  press(queue, base + cycle.windFrames + 2, 'wind', sim => sim.camsUp);
  release(queue, base + cycle.periodFrames - 30, 'wind');
}

/** Faithful published timer skeleton, evaluated only on the Android plant model. */
export function run(seed, opts = {}) {
  const { night = 7, ventStall = true, simOpts = {}, cycle = CYCLE } = opts;
  routeFor(night, cycle);
  const sim = new Sim({ seed, night, ...simOpts });
  const queue = new Map();
  opening(queue);
  for (let base = cycle.mainStartFrames;
       base < C.NIGHT_FRAMES;
       base += cycle.periodFrames) mainCycle(queue, base, cycle);

  let cursor = 0, minBox = 1, powerOutAt = -1;
  while (sim.alive && !sim.won) {
    const frame = sim.frame + 1;
    for (const fn of queue.get(frame) ?? []) fn(sim);
    queue.delete(frame);
    if (!ventStall) sim.release('ventR');
    sim.tick();
    minBox = Math.min(minBox, sim.box);
    if (powerOutAt < 0 && sim.power <= 0) powerOutAt = sim.frame;
    cursor = frame;
  }
  return {
    seed, night, won: sim.won, frame: sim.frame, cursor,
    seconds: +(sim.frame / C.FPS).toFixed(1),
    death: sim.death ? { reason: sim.death.reason, detail: sim.death.detail } : null,
    minBox, minPower: sim.power, powerOutAt,
  };
}

/**
 * @param {{night?: number, from?: number, to?: number, seeds?: number[], count?: number, ventStall?: boolean, worst?: boolean}} options
 */
export function cohort({ night = 7, from, to, seeds, count = 3000,
                          ventStall = true, worst = false } = {}) {
  const population = seeds ?? (from !== undefined && to !== undefined
    ? Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => (from + i) >>> 0)
    : randomSeedCohort({ count }));
  if (!population.length) throw new Error('Right Vent Camp cohort cannot be empty');
  const deaths = {}, lost = [];
  let won = 0, minBox = Infinity, minPower = Infinity, firstPowerOut = Infinity;
  for (const seed of population) {
    const result = run(seed, { night, ventStall,
      simOpts: worst ? { worst: true } : {} });
    if (result.won) won++;
    else {
      if (lost.length < 8) lost.push(seed);
      const reason = result.death?.reason ?? 'unknown';
      deaths[reason] = (deaths[reason] ?? 0) + 1;
    }
    minBox = Math.min(minBox, result.minBox);
    minPower = Math.min(minPower, result.minPower);
    if (result.powerOutAt >= 0) firstPowerOut = Math.min(firstPowerOut, result.powerOutAt);
  }
  return {
    night, runs: population.length, won, deaths, lost, minBox, minPower,
    firstPowerOut: Number.isFinite(firstPowerOut) ? firstPowerOut : null,
    seedCohort: seedCohortDescriptor(population, { salt: GOLDEN_MODEL_SEED_SALT }),
  };
}
