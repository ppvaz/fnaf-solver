import * as C from '@sixam/source/fnaf2';
import { Sim, Rng } from '@sixam/source/fnaf2';
import { stableHash } from '@sixam/kernel/contracts';
import { GOLDEN_MODEL_SEED_SALT, randomSeedCohort, seedCohortDescriptor } from '../../experiment/seeds.ts';
import { CYCLE, LEGACY_LOOP, LEGACY_SETUP, fifthBoundary, routeFor } from './route.ts';
import type { SimEdge } from './route.ts';
import type { SimOptions } from '@sixam/source/games/fnaf2/plant-options.ts';

/** Moves a session row by some frames; the jitter studies supply their own. */
type Shift = (row: number, window: number) => number;
/** The legacy family's options: the Sim's own, and whether the opening splits the camera. */
type LegacyOptions = Partial<SimOptions> & { readonly splitCamera?: boolean };

const JITTER_SALT = 0x6d32746f; // "m2to"; separate from the simulator RNG.
const ROW = Object.freeze({ raise: 1, flashOn: 2, flashOff: 3, wind: 4,
  windOff: 5, drop: 6, mask: 7, lightOff: 8 });

function jitterer(seed: number, slackMs: number): Shift {
  if (!slackMs) return () => 0;
  const span = Math.round(slackMs * C.FPS / 1000);
  return (row, win) => {
    const rng = new Rng((JITTER_SALT ^ (seed * 2654435761) ^ (win * 40503) ^ row) >>> 0);
    return rng.int(-span, span);
  };
}

export function runMinusToys7(seed: number, opts: { night?: number, slackMs?: number, openLoop?: boolean,
  cycle?: typeof CYCLE, simOpts?: Partial<SimOptions>, shift?: Shift, trace?: boolean } = {}) {
  const { night = 7, slackMs = 0, openLoop = false,
          cycle = CYCLE, simOpts = {} } = opts;
  routeFor(night, cycle);
  const sim = new Sim({ seed, night, ...simOpts });
  const shift = opts.shift ?? jitterer(seed, slackMs);
  const queue = new Map<number, (() => void)[]>();
  const at = (frame: number, fn: () => void) => {
    const f = Math.max(sim.frame + 1, frame);
    let rows = queue.get(f);
    if (!rows) { rows = []; queue.set(f, rows); }
    rows.push(fn);
  };
  const up = () => sim.monitor === 'up';
  const down = () => sim.monitor === 'down';

  let threats = 0;
  let eventIndex = 0;
  const drainEvents = () => {
    for (; eventIndex < sim.events.length; eventIndex++) {
      const event = sim.events[eventIndex];
      if (event.type !== 'vent-bang' || event.data?.cam) continue;
      threats = Math.max(0, threats + (event.data?.leaving ? -1 : 1));
    }
  };

  // Set inside pressMask; typed by assertion so the checker does not narrow it to its initial null.
  let poll = null as {w0: number, fullOn: number} | null;
  const pressMask = (w0: number) => {
    sim.press('mask');
    if (sim.maskOn) poll = { w0, fullOn: sim.frame + C.MASK_ANIM_ON };
  };
  let session = 0;
  const trace: Record<string, unknown>[] | null = opts.trace ? [] : null;
  const mark = (kind: string, extra: Record<string, unknown> = {}) => {
    if (trace) trace.push({ f: sim.frame + 1, kind, threats,
                            D: sim.foxy.D, ...extra });
  };
  const scheduleSession = (raiseFrame: number, w0: number) => {
    const sh = (row: number) => shift(row, w0 / C.MO_FRAMES);
    session++;
    at(raiseFrame + cycle.flashOn + sh(ROW.flashOn), () => {
      mark('flashOn'); if (up()) sim.press('light');
    });
    at(raiseFrame + cycle.flashOff + sh(ROW.flashOff), () => {
      mark('flashOff'); sim.release('light');
    });
    at(raiseFrame + cycle.windOn + sh(ROW.wind), () => {
      mark('windOn'); if (up()) sim.press('wind');
    });
    at(raiseFrame + cycle.windOff + sh(ROW.windOff), () => {
      mark('windOff'); sim.release('wind'); sim.press('light');
    });
    at(w0 + cycle.drop + sh(ROW.drop), () => {
      mark('drop'); if (!down()) sim.press('monitor');
    });
    at(w0 + cycle.mask + sh(ROW.mask), () => {
      mark('maskRow'); if (!sim.maskOn) pressMask(w0);
    });
    at(w0 + cycle.lightOff + sh(ROW.lightOff), () => {
      mark('lightOff'); sim.release('light');
    });
  };
  const flashAfterUnmask = (unmaskFrame: number) => {
    at(unmaskFrame + C.MASK_ANIM_OFF + 1, () => {
      if (sim.maskFullyOff && down()) sim.press('light');
    });
    at(unmaskFrame + C.MASK_ANIM_OFF + 5, () => sim.release('light'));
  };

  const setup: readonly (readonly [number, SimEdge])[] = [[0, ['press', 'monitor']], [13, ['press', 'cam:11']],
    [25, ['press', 'cam:9']], [25, ['press', 'monitor']], [48, ['press', 'monitor']],
    [62, ['press', 'light']], [66, ['release', 'light']], [67, ['press', 'wind']],
    [235, ['release', 'wind']], [235, ['press', 'light']], [240, ['press', 'monitor']],
    [242, ['press', 'mask']], [244, ['release', 'light']]];
  for (const [frame, action] of setup) {
    at(frame, () => {
      if (frame === 13 && !up()) return;
      if (frame === 25 && action[1] === 'cam:9' && !up()) return;
      if (frame === 48 && !down()) return;
      if (frame === 62 && !up()) return;
      if (frame === 67 && !up()) return;
      if (frame === 240 && down()) return;
      if (frame === 242 && sim.maskOn) return;
      if (frame === 242) { pressMask(0); return; }
      sim[action[0]](action[1]);
    });
  }

  let raiseAt = -1;
  while (sim.alive && !sim.won) {
    const frame = sim.frame + 1;
    const phase = frame % C.MO_FRAMES;
    const w0 = frame - phase;
    const due = queue.get(frame);
    if (due) { queue.delete(frame); for (const fn of due) fn(); }
    drainEvents();
    if (trace && phase === 0) mark('check');

    if (poll && sim.maskOn) {
      const deadline = Math.max(poll.w0 + cycle.unmaskMin,
                                fifthBoundary(poll.fullOn));
      if (frame >= deadline && (openLoop || threats === 0)) {
        poll = null;
        mark('unmask');
        sim.press('mask');
        flashAfterUnmask(frame);
      }
    }
    if (!openLoop && threats > 0 && down() && sim.maskFullyOff && !poll && frame > 300)
      pressMask(w0);

    if (phase === cycle.raise && raiseAt !== w0 && down() && !sim.maskOn &&
        sim.maskAnim === 0 && !sim.bb.inOpening && !sim.blackout.active &&
        (openLoop || threats === 0)) {
      raiseAt = w0;
      mark('raise');
      sim.press('monitor');
      scheduleSession(frame, w0);
    }
    sim.tick();
  }
  return {
    seed, night, won: sim.won, frame: sim.frame, trace,
    seconds: +(sim.frame / C.FPS).toFixed(1),
    death: sim.death ? { reason: sim.death.reason, detail: sim.death.detail } : null,
    powerLeft: sim.power, box: +sim.box.toFixed(3),
    blackouts: sim.blackoutCount, brokeLoose: sim.mistakes.length, sessions: session,
  };
}

export function cohort({ night = 7, from, to, seeds, count = 3000,
                          slackMs = 0, openLoop = false, worst = false }: {night?: number, from?: number, to?: number, seeds?: number[], count?: number, slackMs?: number, openLoop?: boolean, worst?: boolean} = {}) {
  const population = seeds ?? (from !== undefined && to !== undefined
    ? Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => (from + i) >>> 0)
    : randomSeedCohort({ count }));
  if (!population.length) throw new Error('Minus Toys cohort cannot be empty');
  const deaths: Record<string, number> = {}, lost: number[] = [];
  let won = 0, minPower = Infinity, minBox = Infinity, loose = 0;
  for (const seed of population) {
    const r = runMinusToys7(seed, { night, slackMs, openLoop,
                                    simOpts: worst ? { worst: true } : {} });
    if (r.won) won++;
    else {
      if (lost.length < 8) lost.push(seed);
      // A run that did not win ended in a death.
      const death = r.death as { reason: unknown, detail: unknown };
      const key = `${death.reason}: ${death.detail}`;
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

/** Compatibility evaluator for the package's original structured API. */
export function runLegacyMinusToys(opts: LegacyOptions = {}) {
  const sim = new Sim(Object.assign({ seed: 1 }, opts));
  let minBox = 1, minPower = sim.power, splitAt = -1;
  let blackouts = 0, ventArrivals = 0, eventIndex = 0;
  const act = (rows: readonly SimEdge[] | undefined) => { for (const [kind, action] of rows ?? []) sim[kind](action); };
  while (sim.alive && !sim.won) {
    const setupRows: readonly SimEdge[] | undefined = sim.frame === 25 && opts.splitCamera === false
      ? [['press', 'monitor']] : LEGACY_SETUP.get(sim.frame);
    act(setupRows);
    for (const [offset, rows] of LEGACY_LOOP) {
      if (sim.frame >= offset && (sim.frame - offset) % (C.MO_FRAMES * 2) === 0)
        act(rows);
    }
    sim.tick();
    if (splitAt < 0 && sim.camsUp && sim.viewing === 11 && sim.cam === 9)
      splitAt = sim.frame;
    minBox = Math.min(minBox, sim.box);
    minPower = Math.min(minPower, sim.power);
    for (; eventIndex < sim.events.length; eventIndex++) {
      const event = sim.events[eventIndex];
      if (event.type === 'blackout') blackouts++;
      if (event.type === 'vent-bang' && !event.data?.leaving && !event.data?.cam)
        ventArrivals++;
    }
  }
  return { sim, minBox, minPower, splitAt, blackouts, ventArrivals };
}

export function summarizeLegacyMinusToys(opts: LegacyOptions = {}) {
  const result = runLegacyMinusToys(opts);
  return {
    family: 'minus-toys', seed: opts.seed ?? 1, won: result.sim.won,
    reason: result.sim.death?.reason ?? null, minBox: result.minBox,
    minPower: result.minPower, splitAt: result.splitAt,
    blackouts: result.blackouts, ventArrivals: result.ventArrivals,
    terminal: { alive: result.sim.alive, won: result.sim.won,
      death: result.sim.death ?? null, frame: result.sim.frame },
    traceHash: stableHash(result.sim.events),
    eventCount: result.sim.events.length,
  };
}
