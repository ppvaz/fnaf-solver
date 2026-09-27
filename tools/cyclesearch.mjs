// Search the neighbourhood of the Minus 7 cycle for the most forgiving variant
// (plan 04). A candidate cycle is described by named knobs (gaps between the
// cycle's events, in frames); fitness is the largest uniform jitter, in frames,
// at which every seed of a fixed set still survives — i.e. how late a player
// can consistently be before the night stops being winnable.
//
//   node tools/cyclesearch.mjs            # hill-climb from the current cycle
//   node tools/cyclesearch.mjs --curve    # just print jitter curves for the
//                                         # current cycle (no search)
//   node tools/cyclesearch.mjs --steps    # per-step tolerance window (no search)
//   node tools/cyclesearch.mjs --curve --knobs=hallHold=5,flashHold=3
//                                         # curve for one named variant, so a
//                                         # search winner stays reproducible
//   node tools/cyclesearch.mjs --profile=human   # score with a per-step human
//                                         # error profile instead of uniform
//
// Two different questions live here, and they must not be confused:
//
//   --steps asks what the *game* tolerates on each input while the rest of the
//     pass stays perfect. It shifts one step by a fixed number of frames and
//     uses no randomness, so it is a measurement of the model.
//   --profile asks whether a cycle survives a *player* whose error is
//     distributed unevenly across the steps. The weights are inferred, not
//     sourced (see PROFILES in model/reactive-pilot.mjs); this is a sensitivity analysis.
import * as C from '@fnaf2-1020/core/mechanics';
import { DEFAULT_CYCLE, labelCycle } from './model/reactive-pilot.mjs';
import { pool, closePool } from './pool.mjs';

// Every night this file simulates goes through the pool, so the hill-climb
// spreads across cores instead of one. `--serial` pins it to a single worker,
// which must produce identical output.
const BBTEST = new URL('./model/reactive-pilot.mjs', import.meta.url).href;
const sweep = (optsList) => pool().map(BBTEST, 'summarize', optsList);

// The current cycle, expressed as knobs. genCycle(KNOBS0) reproduces
// DEFAULT_CYCLE exactly (asserted below).
export const KNOBS0 = {
  maskDelay: 15, // monitor down -> mask on (covers the monitor animation)
  maskHold: C.MASK_ANIM_ON, // mask on -> first legal mask-off tap
  hallDelay: C.MASK_ANIM_OFF + 1, // take-off plus the existing one-frame margin
  hallHold: 2,   // hall flash duration
  upDelay: 4,    // hall flash off -> monitor up
  camDelay: 19,  // monitor up -> first camera tap (covers the animation)
  flashDelay: 2, // camera tap -> camera light on
  flashHold: 2,  // camera light duration
  camGap: 8,     // camera light off -> next camera tap
  homeDelay: 7,  // last light off -> CAM 11 tap
  windDelay: 3,  // CAM 11 tap -> wind press
};
const ORDER0 = [10, 4, 7];

// hallDelay's floor is sourced, not chosen: `mask` reaches 0 only when the
// mmaskOff animation ends (g10/g11), and `lit?` needs `mask` = 0 (g75), so a
// hall flash any earlier produces no light and no Foxy reset (g489 -> g745).
// Likewise, the put-on animation rejects a premature mask-off tap (g267/g270,
// the sourced input gate). Search may not shrink this below MASK_ANIM_ON.
export const MIN = { maskDelay: 15, maskHold: C.MASK_ANIM_ON, hallDelay: C.MASK_ANIM_OFF, hallHold: 1,
              upDelay: 1, camDelay: 15, flashDelay: 1, flashHold: 1, camGap: 1,
              homeDelay: 1, windDelay: 1 };

export function genCycle(k, order = ORDER0) {
  const rows = [[0, 'tap', 'monitor']];
  let t = k.maskDelay;
  rows.push([t, 'tap', 'mask']);
  rows.push([t += k.maskHold, 'tap', 'mask']);
  rows.push([t += k.hallDelay, 'down', 'light']);
  rows.push([t += k.hallHold, 'up', 'light']);
  rows.push([t += k.upDelay, 'tap', 'monitor']);
  t += k.camDelay;
  for (const cam of order) {
    rows.push([t, 'tap', `cam:${cam}`]);
    rows.push([t += k.flashDelay, 'down', 'light']);
    rows.push([t += k.flashHold, 'up', 'light']);
    t += k.camGap;
  }
  t -= k.camGap;
  rows.push([t += k.homeDelay, 'tap', 'cam:11']);
  rows.push([t += k.windDelay, 'down', 'wind']);
  return rows;
}

// Sanity: the knob encoding must reproduce the shipped cycle.
{
  const a = JSON.stringify(genCycle(KNOBS0));
  const b = JSON.stringify(DEFAULT_CYCLE);
  if (a !== b) throw new Error(`genCycle(KNOBS0) != DEFAULT_CYCLE\n${a}\n${b}`);
}

const SEED = (i) => (i * 2246822519) >>> 0;

// Set once from --profile; null keeps the original uniform error mechanism.
// Historical curves are for their old table/engine, not the corrected default.
let PROFILE = null;

async function survivors(cycle, jitter, n) {
  const nights = await sweep(Array.from({ length: n },
    (_, i) => ({ seed: SEED(i), jitter, cycle, profile: PROFILE })));
  return nights.reduce((ok, r) => ok + (r.won ? 1 : 0), 0);
}

// Lexicographic fitness: (largest all-survive jitter, survivors just past it).
const J_CAP = 30;
async function fitness(cycle, n) {
  let j = 0;
  while (j <= J_CAP && await survivors(cycle, j, n) === n) j++;
  const maxJ = j - 1;
  let tie = 0;
  for (let d = 0; d < 3; d++) tie += await survivors(cycle, j + d, n);
  return { maxJ, tie };
}

// ------------------------------------------------------ per-step sensitivity
// How far one step can be moved, on its own, before some seed dies. Expanding
// outward one frame at a time rather than bisecting: survival is not
// guaranteed monotone in the shift (a late camera tap can land inside a
// different 5s interval), so the first failure is the honest answer and a
// bisection could step straight over it.
const SHIFT_CAP = 45; // 0.75s either way; past that the pass has left its anchor

async function edge(cycle, id, dir, n) {
  for (let k = 1; k <= SHIFT_CAP; k++) {
    const nights = await sweep(Array.from({ length: n },
      (_, i) => ({ seed: SEED(i), cycle, stepShift: { id, frames: dir * k } })));
    if (nights.some(r => !r.won)) return dir * (k - 1);
  }
  return dir * SHIFT_CAP;
}

async function stepWindows(cycle, n) {
  const ids = [...new Set(labelCycle(cycle))];
  const out = [];
  for (const id of ids) {
    const early = await edge(cycle, id, -1, n);
    const late = await edge(cycle, id, +1, n);
    out.push({ id, early, late });
  }
  return out;
}

const better = (a, b) => a.maxJ > b.maxJ || (a.maxJ === b.maxJ && a.tie > b.tie);

async function hillClimb(knobs, order, n, log) {
  let best = { ...knobs };
  let bestFit = await fitness(genCycle(best, order), n);
  log(`start: maxJ ${bestFit.maxJ} frames (${Math.round(bestFit.maxJ / C.FPS * 1000)}ms), tie ${bestFit.tie}`);
  for (let pass = 0; ; pass++) {
    let improved = false;
    for (const key of Object.keys(best)) {
      for (const step of [-4, -2, -1, 1, 2, 4]) {
        const cand = { ...best, [key]: best[key] + step };
        if (cand[key] < MIN[key]) continue;
        const fit = await fitness(genCycle(cand, order), n);
        if (better(fit, bestFit)) {
          best = cand; bestFit = fit; improved = true;
          log(`  pass ${pass}: ${key} ${knobs[key]}->${cand[key]} => maxJ ${fit.maxJ}, tie ${fit.tie}`);
        }
      }
    }
    if (!improved) break;
  }
  return { knobs: best, fit: bestFit };
}

const msOf = (f) => `${(f / C.FPS * 1000).toFixed(0)}ms`;

async function curve(cycle, n) {
  const out = [];
  for (const ms of [0, 50, 100, 120, 150, 200, 250, 300]) {
    const j = Math.round(ms / 1000 * C.FPS);
    out.push(`${ms}ms:${(await survivors(cycle, j, n) / n * 100).toFixed(0)}%`);
  }
  return out.join('  ');
}

const isMain = process.argv[1] &&
  import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;
if (isMain) {
  const N_SEARCH = 48, N_VALID = 200;
  const profileArg = (process.argv.find(a => a.startsWith('--profile=')) || '').split('=')[1];
  if (profileArg) {
    PROFILE = profileArg;
    console.log(`error model: per-step profile "${profileArg}" (weights are [INFERRED])\n`);
  }

  // A search prints its winner as a knob set; --knobs feeds one back in so the
  // published curve for a variant can be reproduced without a scratch script.
  const knobArg = (process.argv.find(a => a.startsWith('--knobs=')) || '').split('=').slice(1).join('=');
  const knobs0 = { ...KNOBS0 };
  for (const pair of knobArg ? knobArg.split(',') : []) {
    const [k, v] = pair.split('=');
    if (!(k in KNOBS0)) throw new Error(`unknown knob: ${k} (have ${Object.keys(KNOBS0).join(', ')})`);
    knobs0[k] = +v;
  }
  const baseOrderArg = (process.argv.find(a => a.startsWith('--order=')) || '').split('=')[1];
  const baseOrder = baseOrderArg ? baseOrderArg.split('-').map(Number) : ORDER0;
  const baseCycle = knobArg || baseOrderArg ? genCycle(knobs0, baseOrder) : DEFAULT_CYCLE;
  if (knobArg) console.log(`knobs: ${JSON.stringify(knobs0)}  order ${baseOrder.join('-')}`);

  // --steps is a property of the table, not of the search, so it runs alone.
  if (process.argv.includes('--steps')) {
    const cycle = baseCycle;
    console.log(`per-step tolerance window, order ${baseOrder.join('-')} (${N_VALID} seeds,`);
    console.log('one step moved at a time, the rest of the pass perfect):\n');
    console.log('step           earliest    target    latest     window');
    for (const w of await stepWindows(cycle, N_VALID)) {
      const cap = (v) => (Math.abs(v) === SHIFT_CAP ? '*' : ' ');
      console.log(
        `${w.id.padEnd(14)} ${msOf(w.early).padStart(8)}${cap(w.early)} ` +
        `${'0ms'.padStart(8)}  ${msOf(w.late).padStart(8)}${cap(w.late)}  ` +
        `${msOf(w.late - w.early).padStart(8)}`);
    }
    console.log('\n* the sweep hit its +-0.75s cap without a death; the real edge is further out.');
    await closePool();
  } else {
  console.log(`current cycle jitter curve (${N_VALID} seeds):`);
  console.log(`  ${await curve(baseCycle, N_VALID)}`);
  if (process.argv.includes('--curve')) {
    // The costs a jitter curve cannot show: a variant can buy timing slack by
    // spending the music box or the flashlight, and both are what actually end
    // a real run.
    const clean = await sweep(Array.from({ length: N_VALID }, (_, i) => ({ seed: SEED(i), cycle: baseCycle })));
    const worst = await sweep(Array.from({ length: 100 }, (_, i) => ({ seed: SEED(i), cycle: baseCycle, worst: true })));
    const minPower = Math.min(...clean.map(r => r.power));
    const minBox = Math.min(...clean.map(r => r.minBox));
    console.log(`  clean ${clean.filter(r => r.won).length}/${N_VALID}  worst ${worst.filter(r => r.won).length}/100  ` +
      `min power left ${minPower}/${C.POWER_FRAMES} (${(minPower / C.POWER_FRAMES * 100).toFixed(0)}%)  ` +
      `min box ${(minBox * 100).toFixed(0)}%`);
  }
  if (!process.argv.includes('--curve')) {
    // Camera order first (cheap, discrete), then knobs (hill-climb).
    const orders = [[10, 4, 7], [10, 7, 4], [4, 10, 7], [4, 7, 10], [7, 10, 4], [7, 4, 10]];
    let bestOrder = baseOrder, bestOrderFit = await fitness(genCycle(knobs0, baseOrder), N_SEARCH);
    for (const o of orders) {
      const fit = await fitness(genCycle(knobs0, o), N_SEARCH);
      console.log(`order ${o.join('-')}: maxJ ${fit.maxJ}, tie ${fit.tie}`);
      if (better(fit, bestOrderFit)) { bestOrder = o; bestOrderFit = fit; }
    }
    console.log(`searching knobs with order ${bestOrder.join('-')} (${N_SEARCH} seeds)...`);
    const { knobs, fit } = await hillClimb(knobs0, bestOrder, N_SEARCH, (m) => console.log(m));
    const cycle = genCycle(knobs, bestOrder);
    console.log(`\nbest knobs: ${JSON.stringify(knobs)}`);
    console.log(`best order: ${bestOrder.join('-')}  (search fitness: maxJ ${fit.maxJ} = ${msOf(fit.maxJ)})`);
    console.log(`\nvalidation (${N_VALID} seeds):`);
    console.log(`  clean sweep : ${await survivors(cycle, 0, N_VALID)}/${N_VALID}`);
    const pinned = await sweep(Array.from({ length: 100 },
      (_, i) => ({ seed: SEED(i), cycle, worst: true })));
    console.log(`  worst luck  : ${pinned.filter(r => r.won).length}/100`);
    console.log(`  jitter curve: ${await curve(cycle, N_VALID)}`);
    console.log(`\ncycle table:\n${cycle.map(r => JSON.stringify(r)).join('\n')}`);
  }
  await closePool();
  }
}
