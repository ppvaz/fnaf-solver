// Reactive "perfect player" including Balloon Boy. This is the real test of the
// model: if a correctly-played Minus 7 cannot clear the night here, either the
// routine in docs/strategy/MINUS-7-STRATEGY.md is wrong or the engine is.
import { pathToFileURL } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { Rng } from '@sixam/source/fnaf2';
import type { SimOptions } from '@sixam/source/games/fnaf2/plant-options.ts';
import { formatRate } from '../../../review/src/stat.ts';

/** A plan row: its frame (an offset from the anchor in a table, absolute in a plan), the hand's motion, and the control. */
export type PlanRow = [number, 'tap' | 'down' | 'up' | 'wait', string];

// The scripted half of the routine, as frame offsets from the cycle anchor.
// packages/propose/parked/minus7/cyclesearch.ts optimises alternatives to this table; everything the
// bot does reactively (BB phases, recovery) is built around whichever table
// is in use.
// Retimed 2026-08-24 for the sourced post-mask flash lockout: `mask` returns
// to 0 only when the mmaskOff animation finishes (g10/g11), and the hall flash
// resets Foxy through `lit?` (g489 -> g745), so a flash inside those 15 frames
// resets nothing. The old table flashed 3 frames after the mask-off tap and
// therefore never lit at all. Re-derived by `cyclesearch`, not by hand.
// Retain the pre-2026-09-27 table as a negative control. Its second mask tap
// lands inside the 12-frame put-on animation and is correctly ignored since
// 3d5c5f7. Historical jitter curves describe that table/engine, not the fixed
// baseline below; they must not be carried forward as current measurements.
export const LEGACY_ANIMATION_INVALID_CYCLE: PlanRow[] = [
  [0, 'tap', 'monitor'], [15, 'tap', 'mask'], [24, 'tap', 'mask'],
  [40, 'down', 'light'], [42, 'up', 'light'], [46, 'tap', 'monitor'],
  [65, 'tap', 'cam:10'], [67, 'down', 'light'], [69, 'up', 'light'],
  [77, 'tap', 'cam:4'], [79, 'down', 'light'], [81, 'up', 'light'],
  [89, 'tap', 'cam:7'], [91, 'down', 'light'], [93, 'up', 'light'],
  [100, 'tap', 'cam:11'], [103, 'down', 'wind'],
];

// A mask-off tap first becomes legal after MASK_ANIM_ON ticks. Keep the
// existing one-frame hall margin after take-off and all downstream gaps.
// This is a host policy baseline, not a change to a committed device winner.
const maskOn = 15;
const maskOff = maskOn + C.MASK_ANIM_ON;
const hallOn = maskOff + C.MASK_ANIM_OFF + 1;
export const DEFAULT_CYCLE: PlanRow[] = [
  [0, 'tap', 'monitor'], [maskOn, 'tap', 'mask'], [maskOff, 'tap', 'mask'],
  [hallOn, 'down', 'light'], [hallOn + 2, 'up', 'light'], [hallOn + 6, 'tap', 'monitor'],
  [hallOn + 25, 'tap', 'cam:10'], [hallOn + 27, 'down', 'light'], [hallOn + 29, 'up', 'light'],
  [hallOn + 37, 'tap', 'cam:4'], [hallOn + 39, 'down', 'light'], [hallOn + 41, 'up', 'light'],
  [hallOn + 49, 'tap', 'cam:7'], [hallOn + 51, 'down', 'light'], [hallOn + 53, 'up', 'light'],
  [hallOn + 60, 'tap', 'cam:11'], [hallOn + 63, 'down', 'wind'],
];

const A = (f: number) => { // next frame landing on a :X2 / :X7 second boundary
  for (let k = 0; k < 12 * C.FPS; k++) {
    const g = f + k;
    if (g % C.FPS === 0) { const d = (g / C.FPS) % 10; if (d === 2 || d === 7) return g; }
  }
  return f;
};

// ---------------------------------------------------------------- step model
// A cycle table is a list of button rows, but a *human* executes it as a list
// of steps: one motor act may be two rows (a light's press and release) and
// three rows for a camera flash (tap, light down, light up). Lateness attaches
// to the step, not the row, so both jitter profiles and the per-step
// sensitivity sweep need the grouping.
//
// The ids returned here are deliberately the ids in C.CYCLE_SCRIPT, so a
// profile measured from the trainer's own grading (Coach.results carries
// {stepId, delta} per input) can be dropped in without a translation table.
//
// The walk tracks monitor/mask state because the same row means different
// things in different states: `light` is the hall flash with the cams down and
// the camera light with them up. A scripted cycle always begins mid-loop with
// the cams up and the mask off.
export function labelCycle(rows: readonly PlanRow[]) {
  let monUp = true, maskOn = false, lastCam = null as number | null, lightId = null as string | null;
  return rows.map(([, kind, act]) => {
    if (act === 'monitor' && kind === 'tap') { monUp = !monUp; return monUp ? 'monitor-up' : 'monitor-down'; }
    if (act === 'mask' && kind === 'tap') { maskOn = !maskOn; return maskOn ? 'mask-on' : 'mask-off'; }
    if (act.startsWith('cam:')) { lastCam = +act.slice(4); return `cam-${lastCam}`; }
    if (act === 'light') {
      if (kind === 'down') lightId = monUp && lastCam != null ? `cam-${lastCam}` : 'flash-hall';
      return lightId || 'flash-hall';
    }
    if (act === 'wind') return 'wind';
    return act;
  });
}

// Per-step error weights. `jitter` still sets the magnitude; a profile only
// says how that magnitude is *distributed* across the steps.
//
// [INFERRED] These weights are a model of the player, not of the game, so
// nothing in the event sheet can source them. They encode three claims from
// docs/strategy/MINUS-7-STRATEGY.md that are defensible but unmeasured:
//
//   - a rehearsed tap in a memorised sweep is the cheapest input (weight 1);
//   - the Golden Freddy flick is a 0.1-0.2 s *duration* held under time
//     pressure (§8), so it is harder to place than a tap;
//   - WIND is a held control released by feel, not on a cue -- the trainer
//     grades it on frames held rather than on press time (Coach.windStep) --
//     and the BB duel is reaction, not recall: §6 gives it ~0.7 s to absorb
//     two ~0.25 s animations. Those are where real lateness clusters.
//
// Replace with measured weights (relative sigma of `delta` per stepId, taken
// from a drilled session) before treating a profile result as more than a
// sensitivity analysis.
/** How a jitter's magnitude is spread: `common` scales the per-pass offset, `reactive` an unscripted row, `steps` each step id. */
export interface Profile {
  readonly common?: number;
  readonly reactive?: number;
  readonly steps?: Readonly<Record<string, number>>;
}
export const PROFILES: Readonly<Record<string, Profile>> = {
  // The null model: every step equally hard. Not the same as the legacy
  // uniform path, which draws per row rather than per step.
  flat: { common: 1, reactive: 1, steps: {} },
  human: {
    common: 1,     // scale on the once-per-pass "started the pass late" offset
    reactive: 3,   // any row of an unscripted BB attack/recovery plan
    steps: {
      'monitor-down': 1, 'monitor-up': 1,
      'mask-on': 1.5, 'mask-off': 1.5,
      'flash-hall': 1,
      'cam-10': 1, 'cam-4': 1, 'cam-7': 1, 'cam-11': 1,
      'wind': 2,
    },
  },
};

// Move one step (every row that makes it up) by a signed number of frames,
// with no randomness at all. This is the measurement half: it asks what the
// *game* tolerates on a given input while the rest of the pass stays perfect.
//
// "Every row that makes it up" includes the same motor act where a plan repeats
// it -- phaseA's extra cams-down/up pair is shifted along with the cycle's own
// monitor taps. That is the deliberate reading: being late on a button means
// being late on it everywhere in the pass, not only on its first appearance.
/** One step moved by a signed number of frames. */
export interface StepShift { readonly id: string; readonly frames: number }

export function shiftStep(rows: readonly PlanRow[], { id, frames }: StepShift) {
  const ids = labelCycle(rows);
  return rows
    .map((row, i): PlanRow => (ids[i] === id ? [row[0] + frames, row[1], row[2]] : row))
    .sort((x, y) => x[0] - y[0]);
}

// Total error on a row = a per-pass offset shared by every step (you started
// the whole pass late) plus an independent per-step term scaled by that step's
// weight. The shared term is what makes this correlated rather than i.i.d.,
// which is the thing plan 04 flagged as missing from the uniform model.
function jitterPlan(rows: readonly PlanRow[], jitter: number, profile: Profile, rng: Rng, scripted: boolean) {
  const spread = Math.max(1, Math.round(jitter / 3));
  const base = Math.floor(rng.next() * jitter * (profile.common ?? 1));
  const ids = scripted ? labelCycle(rows) : null;
  const drawn = new Map<string, number>();
  return rows
    .map((row, i): PlanRow => {
      const id = ids ? ids[i] : 'reactive';
      let step = drawn.get(id);
      if (step === undefined) {
        const w = scripted ? (profile.steps?.[id] ?? 1) : (profile.reactive ?? 1);
        step = Math.floor(rng.next() * spread * w);
        drawn.set(id, step);
      }
      return [row[0] + base + step, row[1], row[2]];
    })
    .sort((x, y) => x[0] - y[0]);
}

/** What a Bot reads and drives: the frame, Balloon Boy, the controls. A Sim is one; the policy adapter's proxy is another. */
export interface BotSim {
  readonly frame: number;
  readonly bb: { readonly inOpening: boolean; readonly stage: number };
  press(act: string): void;
  release(act: string): void;
}

export class Bot<S extends BotSim = BotSim> {
  declare sim: S;
  declare table: readonly PlanRow[];
  declare targets: number[];
  declare plan: PlanRow[];
  declare waiting: string | null;
  declare kind: string;
  declare nextAt: number;
  constructor(sim: S, table: readonly PlanRow[] = DEFAULT_CYCLE, targets: number[] | null = null) {
    this.sim = sim; this.table = table;
    // The BB attack/recovery path has to refresh the same camera set as the
    // regular cycle.  Derive it from the table by default so search tools can
    // evaluate structurally different cycles without silently falling back to
    // Minus 7's 10/04/07 sweep.
    this.targets = targets || [...new Set(table
      .filter(([, , act]) => act.startsWith('cam:') && act !== `cam:${C.BOX_CAM}`)
      .map(([, , act]) => +act.slice(4)))];
    this.plan = []; this.waiting = null; this.kind = 'start';
    this.plan = [[2, 'tap', 'monitor'], [20, 'tap', 'cam:11'], [24, 'down', 'wind']];
    this.nextAt = C.s(7);
  }

  cycle(a: number) {
    return this.table.map(([o, k, act]): PlanRow => [a + o, k, act]);
  }

  // BB is in the vent camera: same cycle, but the cams must be DOWN across the
  // next 5s interval. That defers his last movement rather than denying it
  // (g417 latches), which is what buys a prepared arrival instead of a random one.
  phaseA(a: number, cycleRows = this.cycle(a)) {
    const p = cycleRows;
    const drop = a + 150;                     // :X4.5 — before the interval
    const back = a + 150 + C.MONITOR_ANIM_DOWN * 3; // safely after it
    p.push([drop, 'tap', 'monitor'], [back, 'tap', 'monitor']);
    return p;
  }

  // BB is in the opening: flash everything, drop, mask, and wait for his bang.
  attack(a: number) {
    const p: PlanRow[] = [[a, 'down', 'light']];
    this.targets.forEach((cam, i) => p.push([a + 3 + i * 6, 'tap', `cam:${cam}`]));
    const drop = a + 4 + this.targets.length * 6;
    p.push([drop, 'tap', 'monitor'], [drop + 12, 'tap', 'mask'],
      [drop + 14, 'wait', 'bbgone']);
    return p;
  }

  recover(f: number) {
    // Raising the monitor re-exposes the final camera from attack() while the
    // light is still held, so only the preceding cameras need explicit taps.
    //
    // The raise has to wait out the mask-off animation. The light is still
    // held here, and g75 only lights it once `mask` returns to 0 (g10/g11) --
    // so those frames are the pass's Foxy reset (g489 -> g745). Raising early
    // spends them with the monitor already up, where the same held light is
    // the camera light instead and Foxy's D is never zeroed.
    const up = f + 2 + C.MASK_ANIM_OFF + 2;
    const p: PlanRow[] = [[f + 2, 'tap', 'mask'], [up, 'tap', 'monitor']];
    this.targets.slice(0, -1).forEach((cam, i) =>
      p.push([up + 17 + i * 4, 'tap', `cam:${cam}`]));
    const lightUp = up + 17 + Math.max(1, this.targets.length - 1) * 4;
    p.push([lightUp, 'up', 'light'], [lightUp + 4, 'tap', `cam:${C.BOX_CAM}`],
      [lightUp + 7, 'down', 'wind']);
    return p;
  }

  step() {
    const s = this.sim, f = s.frame;

    // Waiting out a mask: the cams must stay down until BB's leaving bang.
    if (this.waiting === 'bbgone') {
      if (!s.bb.inOpening) { this.waiting = null; this.kind = 'recover'; this.plan = this.recover(f); }
      return;
    }

    // BB stepping into the opening overrides whatever we were doing. The attack
    // has to start with the cams already up, so we never queue a raise first.
    if (s.bb.inOpening && this.kind !== 'attack' && this.kind !== 'recover') {
      this.kind = 'attack';
      this.plan = this.attack(A(f + 1));
    }

    while (this.plan.length && this.plan[0][0] <= f) {
      const [, kind, act] = this.plan.shift() as PlanRow; // the loop's condition holds a row
      if (kind === 'wait') { this.waiting = act; return; }
      if (kind === 'up') s.release(act); else s.press(act);
    }
    if (this.plan.length) return;

    const a = A(f + 1);
    if (s.bb.inOpening) { this.kind = 'attack'; this.plan = this.attack(a); }
    else if (s.bb.stage >= C.BB_STAGES - 1) { this.kind = 'phaseA'; this.plan = this.phaseA(a); }
    else { this.kind = 'cycle'; this.plan = this.cycle(a); }
  }
}

// A jitter draw taken from sim.rng moves the game's own roll stream, so two
// error models -- or two cycles with different row counts -- cannot be compared
// on identical luck. The profile and step-shift paths therefore run their own
// generator. The legacy uniform path deliberately keeps drawing from sim.rng:
// historical curves used that mechanism, but the corrected DEFAULT_CYCLE is
// different. Reproducing those curves also needs their archived table/engine.
const JITTER_SALT = 0x9e3779b9;

/** A night of the pilot: the Sim's options, the table and its cameras, and the error model. */
export interface PilotOptions extends Partial<SimOptions> {
  readonly cycle?: readonly PlanRow[];
  readonly targets?: number[] | null;
  readonly jitter?: number;
  readonly profile?: string | Profile | null;
  readonly stepShift?: StepShift | null;
}

export function run(opts: PilotOptions = {}) {
  const jitter = opts.jitter || 0;
  const profile = typeof opts.profile === 'string' ? PROFILES[opts.profile] : opts.profile || null;
  if (opts.profile && !profile) throw new Error(`unknown jitter profile: ${opts.profile}`);
  const shift = opts.stepShift || null;
  const sim = new Sim(Object.assign({ seed: 999 }, opts));
  const bot = new Bot(sim, opts.cycle || DEFAULT_CYCLE, opts.targets || null);
  if (profile || shift) {
    // Per-step model. `scripted` says whether the plan is the searched cycle
    // table (labelled, weighted per step) or an unscripted BB attack/recovery
    // (one blanket reactive weight, and never step-shifted -- the sweep is a
    // statement about the table, and the recovery path is not in it).
    const jrng = new Rng((((opts.seed ?? 999) >>> 0) ^ JITTER_SALT) >>> 0);
    const transform = (rows: PlanRow[], scripted: boolean) => {
      if (shift && scripted) rows = shiftStep(rows, shift);
      if (profile && jitter) rows = jitterPlan(rows, jitter, profile, jrng, scripted);
      return rows;
    };
    bot.cycle = (a) => transform(Bot.prototype.cycle.call(bot, a), true);
    // phaseA() normally obtains its rows through this.cycle(). Supply the
    // untransformed base explicitly so the added gate actions and cycle rows
    // receive exactly one shift/profile draw, not one here and one in cycle().
    bot.phaseA = (a) => transform(Bot.prototype.phaseA.call(
      bot, a, Bot.prototype.cycle.call(bot, a)), true);
    bot.attack = (a) => transform(Bot.prototype.attack.call(bot, a), false);
    bot.recover = (a) => transform(Bot.prototype.recover.call(bot, a), false);
  } else if (jitter) {
    // Human sloppiness: the whole cycle lands late by a random amount, with a
    // little spread inside it. Order is preserved -- this models a late player,
    // not one pressing things in the wrong sequence.
    const wrap = (fn: (a: number) => PlanRow[]) => (a: number) => {
      const base = Math.floor(sim.rng.next() * jitter);
      const spread = Math.max(1, Math.round(jitter / 3));
      return fn.call(bot, a)
        .map(([f, k, act]): PlanRow => [f + base + Math.floor(sim.rng.next() * spread), k, act])
        .sort((x, y) => x[0] - y[0]);
    };
    bot.cycle = wrap(Bot.prototype.cycle);
    bot.phaseA = wrap(Bot.prototype.phaseA);
    bot.attack = wrap(Bot.prototype.attack);
    bot.recover = wrap(Bot.prototype.recover);
  }
  let minBox = 1;
  while (sim.alive && !sim.won) { bot.step(); sim.tick(); minBox = Math.min(minBox, sim.box); }
  return { sim, minBox };
}

// Pool task (packages/propose/bin/census/pool.ts): one night reduced to a structured-cloneable
// summary. A worker cannot hand back a Sim, so everything the search tools
// rank on has to come through here.
export function summarize(opts: PilotOptions) {
  const { sim, minBox } = run(opts);
  return { won: sim.won, reason: sim.death?.reason || 'unknown', minBox, power: sim.power };
}

// isMainThread: a pool worker inherits process.argv from its parent, so
// without it this CLI block would re-run inside every worker that imports
// bbtest as its task module.
if (isMainThread && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
const n = +(process.argv[2] || 200);
const fails: Record<string, number> = {}; let minB = 1, minP = C.POWER_FRAMES, lapses = 0;
for (let i = 0; i < n; i++) {
  const jf = (process.argv.find(a => a.startsWith('--jitter=')) || '').split('=')[1];
  const r = run({ seed: (i * 2246822519) >>> 0, worst: process.argv.includes('--worst'),
                  jitter: jf ? Math.round(+jf / 1000 * C.FPS) : 0,
                  record: true });   // the stun-lapse count below reads sim.rec
  minB = Math.min(minB, r.minBox); minP = Math.min(minP, r.sim.power);
  for (let k = 0; k < 3; k++)
    for (let j = 1; j < r.sim.rec.n; j++)
      if (r.sim.rec.stun[k][j] === 0 && r.sim.rec.stun[k][j - 1] > 0) lapses++;
  if (!r.sim.won) {
    const death = r.sim.death as NonNullable<Sim['death']>; // a night that is not won ended in a death
    const key = `${death.reason}: ${death.detail}`;
    fails[key] = (fails[key] || 0) + 1;
  }
}
const failed = Object.values(fails).reduce((a, b) => a + b, 0);
console.log(`${n - failed}/${n} survived (${formatRate(n - failed, n, { label: 'survival' })})` +
  `${process.argv.includes('--worst') ? ' (worst luck)' : ''}`);
for (const [k, v] of Object.entries(fails)) console.log(`  ${v}x  ${k}`);
console.log(`min box ${(minB * 100).toFixed(0)}% | min power ${minP} | stun lapses total ${lapses}`);

// --assert turns the README's headline claim -- Minus 7 has no unwinnable RNG,
// and a correct cycle never lets a stun lapse -- into something a test runner
// can fail on. Without it this file only ever printed numbers and exited 0.
if (process.argv.includes('--assert')) {
  const problems: string[] = [];
  if (failed) problems.push(`${failed}/${n} seeds died`);
  if (lapses) problems.push(`${lapses} stun lapses`);

  // The step model is only useful if its ids stay the trainer's ids: a profile
  // is keyed by stepId, so a rename on either side would silently start
  // weighting nothing. Compared as sets, so reordering the camera sweep is
  // allowed but losing, adding or renaming a step is not.
  const set = (a: string[]) => [...new Set(a)].sort().join(',');
  const botIds = set(labelCycle(DEFAULT_CYCLE));
  const trainerIds = set(C.CYCLE_SCRIPT.map(st => st.id));
  if (botIds !== trainerIds)
    problems.push(`step ids drifted from CYCLE_SCRIPT:\n    bot     ${botIds}\n    trainer ${trainerIds}`);

  // Both per-step paths must be identities when they are asked for nothing.
  const plain = JSON.stringify(summarize({ seed: 4242 }));
  if (JSON.stringify(summarize({ seed: 4242, stepShift: { id: 'wind', frames: 0 } })) !== plain)
    problems.push('a zero-frame step shift changed the night');
  if (JSON.stringify(summarize({ seed: 4242, jitter: 0, profile: 'human' })) !== plain)
    problems.push('a profile with no jitter changed the night');
  if (problems.length) {
    console.error(`FAIL: ${problems.join(', ')}`);
    process.exitCode = 1;
  }
}
}
