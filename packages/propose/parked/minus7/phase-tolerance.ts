// Common-mode phase tolerance of the frame-exact published cycles.
//
//   node packages/propose/parked/minus7/phase-tolerance.ts --family=minus7 --seeds=300 --kmax=30
//   node packages/propose/parked/minus7/phase-tolerance.ts --family=minustoys --night=7
//   node packages/propose/parked/minus7/phase-tolerance.ts --slack=0,8,17,33 --kstep=2   # the joint map
//   node packages/propose/parked/minus7/phase-tolerance.ts --sigma=0,2,4,6,8,10          # dispatch jitter
//
// WHAT A NUMBER FROM HERE IS. A statement about the model, and nothing else.
// It is not gameplay evidence, it is not a device claim, and it does not move
// a rung of Plan 12's ladder.
// In particular, sigma=29 is NOT a measured command-to-app distribution:
// minus-toys-jitter.ts sourced it from driver per-anchor residuals. This IID
// Gaussian, nearest-frame experiment does not identify the phone's error
// correlation, game-poll phase, clock drift, or effective input latency.
//
// ------------------------------------------------------------ why it exists
//
// `--slack` in either family's `cycle.mjs` perturbs the routine IID PER ROW:
// every row of every cycle draws its own independent error, so a night takes
// roughly 8 x 84 = 670 draws. Under that model both families collapse at
// +/-1 frame (Minus 7 422/3000, Minus Toys 172/3000). That is easy to read as
// "the strategy is impossibly tight", and it is not what it says, because it
// is not the executor a human is:
//
//   * IID per row destroys the RELATIVE spacing inside a cycle, which is where
//     the routine's safety lives (press, MASK_ANIM_ON + 301, release). A human
//     runs the cycle as one motor program and the gaps survive.
//   * 670 independent draws compound over a night. A human re-anchors to the
//     game's own clock every interval (MINUS-7-STRATEGY.md §1's mandatory
//     timer), so the error does not accumulate across cycles.
//
// The human error is COMMON MODE: the whole cycle sits k frames off the
// interval with its internal gaps intact. So is the error of an executor whose
// dispatch latency is stable but unknown -- which is the question that decides
// whether the external device route is reachable at all. The two models
// disagree by more than an order of magnitude, so quote the one that matches
// the executor being argued about, and say which it is.
//
// NEITHER MODEL ALONE IS A DEVICE NUMBER, and the two are orthogonal rather
// than rival. Decompose a real executor's timing error into (a) a common-mode
// offset of the whole cycle against the interval and (b) residual per-row
// scatter around it. `--slack` sweeps (b) with (a) pinned at zero -- note that
// every row is scheduled from `w0`, the TRUE interval, so it also assumes a
// perfect clock and models neither a wrong epoch nor drift. `--kmax` sweeps
// (a) with (b) pinned at zero, which is a perfectly repeatable hand that is
// consistently late. A phone has both at once: an epoch bracket and drift on
// (a), dispatch jitter on (b). `--slack` together with the k sweep prints the
// joint map, which is the only one of the three that can be compared against a
// measured handset.
//
// The asymmetry between them is mechanical, not a curiosity: the routine's
// margins live in the GAPS between rows, so a common-mode shift slides every
// gap along intact until one walks off a cliff, while per-row scatter attacks
// every gap at once and gets ~670 attempts a night.
//
// The families differ only in WHICH cycle rows are absolute offsets from the
// interval, so that is the only family-specific thing here and it is data.
import { CYCLE as M7, runCycle } from './cycle.ts';
import { CYCLE as MT, runMinusToys7 } from '../../bin/minus-toys/cycle.ts';

const FAMILIES = {
  minus7: {
    cycle: M7, run: runCycle,
    // `sweepGap`/`windGap` are gaps measured from `raise`, so they ride along
    // with it and must not be shifted again.
    relative: ['sweepGap', 'windGap'],
  },
  minustoys: {
    cycle: MT, run: runMinusToys7,
    // Every row is documented as an interval-relative offset from w0.
    relative: [],
  },
};

const option = (name, fallback) => {
  const found = process.argv.find(a => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const NAME = option('family', 'minus7');
const family = FAMILIES[NAME];
if (!family) throw new Error(`--family must be one of ${Object.keys(FAMILIES).join(', ')}`);
const SEEDS = Number(option('seeds', '300'));
const KMAX = Number(option('kmax', '30'));
const KSTEP = Number(option('kstep', '1'));
const NIGHT = Number(option('night', '7'));
const SLACKS = option('slack', '0').split(',').map(Number);
const SIGMAS = option('sigma', '').split(',').filter(Boolean).map(Number);
const MEAN_MS = Number(option('mean', '0'));

// A DISPATCH-LATENCY model, because neither sweep above can express the range a
// handset actually lives in. `--slack` quantizes to frames as
// `span = round(slackMs * FPS / 1000)`, so under about 8 ms it is no jitter at
// all and from 8 to 25 ms it is a uniform draw over three frames -- two rows in
// three land on the wrong frame. The model can say p = 0 or p = 2/3 and nothing
// between, and the published "collapses at one frame" figure is the 2/3 end:
// not a demanding executor, a broken one.
//
// What a measured handset yields is a latency distribution, so that is what
// this takes. Each row is dispatched at its intended time plus a draw from
// N(mean, sigma) in ms, and the engine being frame-quantized turns that into a
// frame shift. The slip probability falls out rather than being assumed, and it
// is reported next to survival so a measured sigma converts directly.
//
// The draws are hashed from (seed, row, win) rather than taken from a running
// stream, so a cell is reproducible and independent of evaluation order. The
// game's own LCG is deliberately NOT used: it carries 16 bits of state and a
// period of 16384, which is faithful for reproducing the source's rolls and
// wrong for generating statistics about them.
const splitmix32 = (x) => {
  x = (x + 0x9e3779b9) >>> 0;
  let z = x;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
};
const gaussian = (seed, row, win) => {
  // Box-Muller from two independently hashed uniforms; u1 is nudged off zero.
  const u1 = Math.max(splitmix32(seed ^ Math.imul(row, 0x27d4eb2d) ^ Math.imul(win, 0x165667b1)), 1e-9);
  const u2 = splitmix32(seed ^ Math.imul(row, 0x85ebca6b) ^ Math.imul(win, 0xc2b2ae35) ^ 0x5bf03635);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};
const FPS = 60;
const latencyShift = (seed, sigmaMs) => {
  const shifts = { n: 0, slipped: 0 };
  const fn = (row, win) => {
    const ms = MEAN_MS + sigmaMs * gaussian(seed, row, win);
    const frames = Math.round((ms * FPS) / 1000);
    shifts.n++;
    if (frames !== 0) shifts.slipped++;
    return frames;
  };
  fn.stats = shifts;
  return fn;
};

// The operator's own clock is what is offset, so every absolute row moves with
// it -- including any guard the routine applies to its own decisions.
const shifted = (k) => Object.fromEntries(Object.entries(family.cycle).map(
  ([key, value]) => [key, family.relative.includes(key) ? value : value + k]));

const cell = (k, slackMs) => {
  const cycle = shifted(k);
  const deaths: Record<string, number> = {};
  let won = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = family.run(seed, { night: NIGHT, cycle, slackMs });
    if (r.won) won++;
    else deaths[r.death.reason] = (deaths[r.death.reason] ?? 0) + 1;
  }
  const top = Object.entries(deaths).sort((a, b) => b[1] - a[1])[0];
  return { won, top: top ? `${top[0]}:${top[1]}` : '-' };
};

if (SIGMAS.length) {
  console.log(`dispatch-jitter sweep: ${NAME}, night ${NIGHT}, ${SEEDS} seeds, ` +
    `mean ${MEAN_MS} ms, sigma = ${SIGMAS.join('/')} ms ` +
    `(1 frame = ${(1000 / FPS).toFixed(1)} ms)`);
  console.log('| sigma ms |     won | rows slipped | dominant death |');
  console.log('|---------:|--------:|-------------:|---|');
  for (const sigmaMs of SIGMAS) {
    const deaths: Record<string, number> = {};
    let won = 0, rows = 0, slipped = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const shift = latencyShift(seed, sigmaMs);
      const r = family.run(seed, { night: NIGHT, cycle: family.cycle, shift });
      if (r.won) won++;
      else deaths[r.death.reason] = (deaths[r.death.reason] ?? 0) + 1;
      rows += shift.stats.n; slipped += shift.stats.slipped;
    }
    const top = Object.entries(deaths).sort((a, b) => b[1] - a[1])[0];
    const pct = rows ? ((100 * slipped) / rows).toFixed(1) : '0.0';
    console.log(`| ${String(sigmaMs).padStart(8)} | ${`${won}/${SEEDS}`.padStart(7)} | ` +
      `${`${pct}%`.padStart(12)} | ${top ? `${top[0]}:${top[1]}` : '-'} |`);
  }
  process.exit(0);
}

console.log(`phase sweep: ${NAME}, night ${NIGHT}, ${SEEDS} seeds, ` +
  `offset k = -${KMAX}../../../..+${KMAX} step ${KSTEP} (1 frame = ${(1000 / 60).toFixed(1)} ms), ` +
  `scatter = ${SLACKS.join('/')} ms`);
if (SLACKS.length === 1) {
  console.log('|   k |   ms |     won | dominant death |');
  console.log('|----:|-----:|--------:|---|');
  for (let k = -KMAX; k <= KMAX; k += KSTEP) {
    const { won, top } = cell(k, SLACKS[0]);
    console.log(`| ${String(k).padStart(3)} | ${String(Math.round(k * 1000 / 60)).padStart(4)} | ` +
      `${`${won}/${SEEDS}`.padStart(7)} | ${top} |`);
  }
} else {
  // The joint map: offset down the rows, per-row scatter across the columns.
  console.log(`|   k |   ms | ${SLACKS.map(s => `${s}ms`.padStart(8)).join(' | ')} |`);
  console.log(`|----:|-----:|${SLACKS.map(() => '---------:|').join('')}`);
  for (let k = -KMAX; k <= KMAX; k += KSTEP) {
    const row = SLACKS.map(s => `${cell(k, s).won}/${SEEDS}`.padStart(8));
    console.log(`| ${String(k).padStart(3)} | ${String(Math.round(k * 1000 / 60)).padStart(4)} | ` +
      `${row.join(' | ')} |`);
  }
}
