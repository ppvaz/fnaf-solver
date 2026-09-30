import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { GOLDEN_MODEL_SEED_SALT, randomSeedCohort, seedCohortDescriptor } from '../../experiment/seeds.js';
import { build, schedule, REACTIVE_KNOBS, MINUS3_STORY_NIGHTS } from './route.js';

/**
 * @param {{night?: number, seed?: number, worst?: boolean, splitCamera?: boolean, knobs?: Record<string, any>,
 *   customNight?: Record<string, number>}} options
 */
export function replay({ night, seed = 1, worst = false, splitCamera = true, knobs, customNight } = {}) {
  const storyNight = Number.isInteger(night) && night >= 3 && night <= 6;
  const customNightOk = night === 7 && customNight !== null && typeof customNight === 'object';
  if (!storyNight && !customNightOk)
    throw new Error('Minus 3 replay requires story night 3..6, or night 7 with a customNight dial vector');
  const sim = new Sim({ night, seed, worst, ...(customNightOk ? { customNight } : {}) });
  const k = { ...knobs };
  let queue = schedule({ ...build(k), knobs: k });
  if (k.maskless || k.ventless)
    queue = queue.filter(([, , , action]) =>
      !(k.maskless && action === 'mask') && !(k.ventless && action === 'ventR'));
  let cursor = 0;
  let splitAt = -1;
  let minBox = 1;
  let minPower = sim.power;
  while (sim.alive && !sim.won) {
    while (cursor < queue.length && queue[cursor][0] <= sim.frame) {
      const [, , kind, action] = queue[cursor++];
      if (!splitCamera && action === 'cam:8') continue;
      sim[kind](action);
    }
    sim.tick();
    if (splitAt < 0 && sim.camsUp && sim.viewing === 11 && sim.cam === 8)
      splitAt = sim.frame;
    minBox = Math.min(minBox, sim.box);
    minPower = Math.min(minPower, sim.power);
  }
  return { sim, splitAt, minBox, minPower };
}

function readCues(sim, state) {
  for (; state.eventCursor < sim.events.length; state.eventCursor++) {
    const event = sim.events[state.eventCursor];
    if (event.type === 'vent-bang') {
      const who = event.data?.who;
      const leaving = Boolean(event.data?.leaving);
      if (who === 'toybonnie') state.toyBonnieCueAt = leaving ? -1 : event.f;
      // CAM 05's BB cue is not the opening cue.
      if (who === 'bb' && !event.data?.cam) state.bbOpening = !leaving;
      if (who === 'mangle') state.mangleOpening = !leaving;
    } else if (event.type === 'bb-inside') {
      state.bbOpening = false;
    } else if (event.type === 'mangle-static' && event.data?.context === 'office') {
      state.mangleOpening = Boolean(event.data.present);
    }
  }
}

function toyBonnieNearExpiry(sim, night, state, knobs) {
  if (state.toyBonnieCueAt < 0) return false;
  const remaining = C.toyBonnieOpeningFrames(night) - (sim.frame - state.toyBonnieCueAt);
  return remaining <= knobs.toyBonnieSafetyFrames;
}

function routeThreat(sim, night, state, knobs) {
  return sim.blackout.active || state.bbOpening || state.mangleOpening ||
    toyBonnieNearExpiry(sim, night, state, knobs);
}

function add(queue, at, kind, action, tag) {
  const rows = queue.get(at) ?? [];
  rows.push({ kind, action, tag });
  queue.set(at, rows);
}

function scheduleReactiveCycle(queue, anchor, knobs) {
  add(queue, anchor - knobs.maskOffLeadFrames, 'press', 'mask', 'mask-off');
  add(queue, anchor + knobs.hallOffsetFrames, 'press', 'light', 'hall');
  add(queue, anchor + knobs.hallOffsetFrames + knobs.hallHoldFrames,
    'release', 'light', 'hall-release');
  add(queue, anchor + knobs.raiseOffsetFrames, 'press', 'monitor', 'raise');
  add(queue, anchor + knobs.cameraOffsetFrames, 'press', 'cam:11', 'camera');
  add(queue, anchor + knobs.windOffsetFrames, 'press', 'wind', 'wind');
  add(queue, anchor + knobs.dropOffsetFrames, 'release', 'wind', 'wind-release');
  add(queue, anchor + knobs.dropOffsetFrames, 'press', 'light', 'drop-light');
  add(queue, anchor + knobs.dropOffsetFrames + knobs.monitorDropLeadFrames,
    'press', 'monitor', 'drop-monitor');
  add(queue, anchor + knobs.dropOffsetFrames + knobs.lightTailFrames,
    'release', 'light', 'drop-light-release');
  add(queue, anchor + knobs.maskOnOffsetFrames, 'press', 'mask', 'mask-on');
}

/**
 * Model-only branch-aware Minus 3 replay. Cues come from the event stream as
 * a stand-in for the future observer: blackout, BB left opening, Mangle
 * static/right opening, and elapsed time since Toy Bonnie's right-vent cue.
 */
/**
 * @param {{night?: number, seed?: number, worst?: boolean, splitCamera?: boolean, knobs?: Record<string, any>}} options
 */
export function reactiveReplay({ night, seed = 1, worst = false,
                                  splitCamera = true, knobs } = {}) {
  if (!Number.isInteger(night) || !MINUS3_STORY_NIGHTS.includes(night))
    throw new Error('Minus 3 reactive replay requires story night 3..5');
  const k = { ...REACTIVE_KNOBS, ...(knobs ?? {}) };
  const sim = new Sim({ night, seed, worst });
  const queue = new Map();
  const opening = schedule({ ...build(), untilMs: 0 });
  for (const [at, , kind, action] of opening) {
    if (!splitCamera && action === 'cam:8') continue;
    add(queue, at, kind, action, 'opening');
  }
  /** @type {{eventCursor: number, toyBonnieCueAt: number, bbOpening: boolean, mangleOpening: boolean, phase: string, anchor: number, cycles: number, deferrals: number}} */
  const state = {
    eventCursor: 0, toyBonnieCueAt: -1, bbOpening: false, mangleOpening: false,
    phase: 'normal', anchor: k.firstAnchorFrames, cycles: 0, deferrals: 0,
  };
  scheduleReactiveCycle(queue, state.anchor, k);
  state.cycles++;
  let splitAt = -1, minBox = 1, minPower = sim.power;
  while (sim.alive && !sim.won) {
    readCues(sim, state);
    const rows = queue.get(sim.frame) ?? [];
    queue.delete(sim.frame);
    let deferred = false;
    for (const row of rows) {
      if (row.tag === 'mask-off' && sim.blackout.active) {
        queue.clear(); state.phase = 'hold'; state.deferrals++; deferred = true; break;
      }
      if (row.tag === 'raise' && routeThreat(sim, night, state, k)) {
        queue.clear();
        if (!sim.maskOn && sim.monitor === 'down' && sim.maskAnim === 0) sim.press('mask');
        state.phase = 'hold'; state.deferrals++; deferred = true; break;
      }
      sim[row.kind](row.action);
      if (row.tag === 'mask-on') {
        state.phase = 'normal'; state.anchor += k.cycleFrames;
        scheduleReactiveCycle(queue, state.anchor, k); state.cycles++;
      }
    }
    if (!deferred && state.phase === 'hold' &&
        !routeThreat(sim, night, state, k) && sim.maskFullyOn) {
      const anchor = Math.ceil((sim.frame + k.resumeLeadFrames) / C.MO_FRAMES) * C.MO_FRAMES;
      if (anchor - k.maskOffLeadFrames > sim.frame) {
        state.anchor = anchor; state.phase = 'normal';
        scheduleReactiveCycle(queue, state.anchor, k); state.cycles++;
      }
    }
    if (splitAt < 0 && sim.camsUp && sim.viewing === 11 && sim.cam === 8)
      splitAt = sim.frame;
    minBox = Math.min(minBox, sim.box);
    minPower = Math.min(minPower, sim.power);
    sim.tick();
  }
  return { sim, splitAt, minBox, minPower, state };
}

/**
 * @param {number} night
 * @param {{worst?: boolean, splitCamera?: boolean, runs?: number, seeds?: number[], knobs?: Record<string, any>}} options
 */
function count(night, { worst = false, splitCamera = true, runs = 3000, seeds, knobs } = {}) {
  const population = seeds ?? randomSeedCohort({ count: runs });
  let wins = 0, split = 0, minBox = 1, minPower = Infinity;
  const losses = new Map();
  for (const seed of population) {
    const result = reactiveReplay({ night, seed, worst, splitCamera, knobs });
    minBox = Math.min(minBox, result.minBox); minPower = Math.min(minPower, result.minPower);
    if (result.sim.won && (splitCamera ? result.splitAt >= 0 : true)) wins++;
    if (result.splitAt >= 0) split++;
    if (!result.sim.won) {
      const reason = result.sim.death?.reason ?? 'unknown';
      losses.set(reason, (losses.get(reason) ?? 0) + 1);
    }
  }
  return {
    wins, runs: population.length, split,
    minBox: Number(minBox.toFixed(4)), minPower,
    losses: Object.fromEntries([...losses].sort((a, b) => b[1] - a[1])),
    seedCohort: seedCohortDescriptor(population, { salt: GOLDEN_MODEL_SEED_SALT }),
  };
}

export function reactiveGate(nights = MINUS3_STORY_NIGHTS, runs = 3000) {
  if (!Number.isInteger(runs) || runs < 1) throw new Error('runs must be positive');
  const seeds = randomSeedCohort({ count: runs });
  let pass = true;
  for (const night of nights) {
    const normal = count(night, { seeds });
    const worst = count(night, { seeds, worst: true });
    const control = count(night, { seeds, splitCamera: false });
    console.log(`Minus 3 reactive night ${night} normal: ${normal.wins}/${normal.runs} ` +
      `split=${normal.split}/${normal.runs} cohort=${normal.seedCohort.sha256.slice(0, 12)} ` +
      `losses=${JSON.stringify(normal.losses)}`);
    console.log(`Minus 3 reactive night ${night} worst diagnostic: ${worst.wins}/${worst.runs} ` +
      `losses=${JSON.stringify(worst.losses)}`);
    console.log(`Minus 3 reactive night ${night} no-split reference: ${control.wins}/${control.runs} ` +
      `losses=${JSON.stringify(control.losses)}`);
    pass &&= normal.wins === runs && normal.split === runs;
  }
  return pass;
}

export { count as countReactive };
