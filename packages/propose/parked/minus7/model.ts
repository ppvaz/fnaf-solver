import * as C from '@sixam/source/fnaf2';
import { Sim, Rng } from '@sixam/source/fnaf2';
import { GOLDEN_MODEL_SEED_SALT, randomSeedCohort, seedCohortDescriptor } from '../../src/experiment/seeds.ts';
import { CYCLE, routeFor } from './route.ts';

const W = C.MO_FRAMES;
const JITTER_SALT = 0x6d377374; // "m7st"; separate from the simulator RNG.
const ROW = Object.freeze({ raise: 1, sweepA: 2, wind: 3, windOff: 4,
  sweepB: 5, lower: 6, hall: 7, mask: 8 });

function jitterer(seed, slackMs) {
  if (!slackMs) return () => 0;
  const span = Math.round(slackMs * C.FPS / 1000);
  return (row, win) => {
    const rng = new Rng((JITTER_SALT ^ (seed * 2654435761) ^ (win * 40503) ^ row) >>> 0);
    return rng.int(-span, span);
  };
}

/** Run one frame-exact Minus 7 night on the sourced plant model. */
export function runCycle(seed, opts: any = {}) {
  const { night = 7, slackMs = 0, bangLatencyMs = 0,
          cycle = CYCLE, simOpts = {} } = (opts as any);
  routeFor(night, cycle);
  const sim = new Sim({ seed, night, ...simOpts });
  const shift = opts.shift ?? jitterer(seed, slackMs);
  const bangLatency = Math.round(bangLatencyMs * C.FPS / 1000);
  const queue = new Map();
  const at = (frame, fn) => {
    const f = Math.max(sim.frame + 1, frame);
    if (!queue.has(f)) queue.set(f, []);
    queue.get(f).push(fn);
  };
  const up = () => sim.monitor === 'up';
  const rising = () => sim.monitor === 'raising';
  const sweep = base => {
    at(base, () => { if (up()) { sim.press('cam:10'); sim.press('light'); } });
    at(base + 1, () => { if (up()) sim.press('cam:4'); });
    at(base + 2, () => { if (up()) sim.press('cam:7'); });
    at(base + 3, () => sim.release('light'));
  };
  const hallFlash = () => {
    if (up() || rising() || sim.maskOn || sim.maskAnim > 0) return;
    sim.press('light');
    at(sim.frame + 2, () => sim.release('light'));
  };

  const countUnmask = opts.countUnmask ?? false;
  const unmaskSlack = C.MASK_ANIM_ON + 301;
  let plannedWin = -1;
  let unmaskAt = -1;
  while (sim.alive && !sim.won) {
    const frame = sim.frame + 1;
    const phase = frame % W;
    const win = (frame - phase) / W;
    const w0 = win * W;
    const due = queue.get(frame);
    if (due) { queue.delete(frame); for (const fn of due) fn(); }

    if (sim.maskOn) {
      if (!sim.bb.inOpening) {
        const bangAt = frame + bangLatency;
        unmaskAt = unmaskAt < 0 ? bangAt : Math.min(unmaskAt, bangAt);
      }
      if (unmaskAt >= 0 && frame >= unmaskAt) { sim.press('mask'); unmaskAt = -1; }
    } else if (sim.maskAnim === 0) {
      const maskDue = w0 + cycle.mask + shift(ROW.mask, win);
      if (frame === maskDue && sim.bb.inOpening && sim.monitor === 'down') {
        sim.press('mask');
        if (countUnmask) unmaskAt = frame + unmaskSlack;
      } else if (plannedWin !== win && sim.monitor === 'down' &&
                 !sim.bb.inOpening && phase >= cycle.raise + shift(ROW.raise, win) &&
                 phase <= cycle.lateMax) {
        plannedWin = win;
        sim.press('monitor');
        sweep(frame + cycle.sweepGap + shift(ROW.sweepA, win));
        if (phase <= cycle.raiseMax) {
          at(frame + cycle.windGap + shift(ROW.wind, win), () => {
            if (up()) { sim.press(`cam:${C.BOX_CAM}`); sim.press('wind'); }
          });
          at(w0 + cycle.windEnd + shift(ROW.windOff, win), () => sim.release('wind'));
          sweep(w0 + cycle.sweepB + shift(ROW.sweepB, win));
          at(w0 + cycle.lower + shift(ROW.lower, win),
            () => { if (up() || rising()) sim.press('monitor'); });
          at(w0 + cycle.hall + shift(ROW.hall, win), hallFlash);
        } else {
          at(frame + cycle.sweepGap + 4,
            () => { if (up() || rising()) sim.press('monitor'); });
          at(frame + cycle.sweepGap + 4 + C.MONITOR_ANIM_DOWN, hallFlash);
        }
      } else if (phase === cycle.hall + shift(ROW.hall, win) && plannedWin !== win) {
        hallFlash();
      }
    }
    sim.tick();
  }
  return {
    seed, night, won: sim.won, frame: sim.frame,
    seconds: +(sim.frame / C.FPS).toFixed(1),
    death: sim.death ? { reason: sim.death.reason, detail: sim.death.detail } : null,
    powerLeft: sim.power, box: +sim.box.toFixed(3),
    blackouts: sim.blackoutCount, brokeLoose: sim.mistakes.length,
  };
}

export function cohort({ night = 7, from, to, seeds, count = 3000,
                          slackMs = 0, bangLatencyMs = 0, worst = false }: {night?: number, from?: number, to?: number, seeds?: number[], count?: number, slackMs?: number, bangLatencyMs?: number, worst?: boolean} = {}) {
  const population = seeds ?? (from !== undefined && to !== undefined
    ? Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => (from + i) >>> 0)
    : randomSeedCohort({ count }));
  if (!population.length) throw new Error('Minus 7 cohort cannot be empty');
  const deaths = {}, lost = [];
  let won = 0, minPower = Infinity, minBox = Infinity, loose = 0;
  for (const seed of population) {
    const r = runCycle(seed, { night, slackMs, bangLatencyMs,
                               simOpts: worst ? { worst: true } : {} });
    if (r.won) won++;
    else {
      if (lost.length < 8) lost.push(seed);
      const key = `${r.death.reason}: ${r.death.detail}`;
      deaths[key] = (deaths[key] ?? 0) + 1;
    }
    minPower = Math.min(minPower, r.powerLeft);
    minBox = Math.min(minBox, r.box);
    loose += r.brokeLoose;
  }
  return { night, ...(from !== undefined && to !== undefined ? { from, to } : {}),
    runs: population.length, won, deaths, lost, minPower, minBox, loose,
    seedCohort: seedCohortDescriptor(population,
      { label: from !== undefined && to !== undefined ? 'explicit-range' : 'random',
        salt: from !== undefined && to !== undefined ? null : GOLDEN_MODEL_SEED_SALT }) };
}
