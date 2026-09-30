// Full-night closed-loop campaign: drive the belief-state cycle controller
// cycle by cycle for whole nights and compare it against its controls.
// ROADMAP Track A1's exit-gate instrument.
//
//   node tools/nightloop.mjs                       # 20 seeds, night 1, all arms
//   node tools/nightloop.mjs --nights=1-7 --seeds=200
//   node tools/nightloop.mjs --policy=baseline     # the declared control scorer
//   node tools/nightloop.mjs --gate=exact          # privileged lookahead bound
//   node tools/nightloop.mjs --assert              # smoke cohort, exit 1 on failure
//
// There is NO compiled full-night schedule anywhere in this path. Every action
// is a bounded primitive selected at its own decision boundary and committed
// only as an immediate prefix; the caller-owned queue releases each deferred
// action at its own frame.
//
// WHAT A NUMBER FROM HERE IS. A statement about the model, and nothing else.
// It is not gameplay evidence, it is not a device claim, and it does not move
// a rung of Plan 12's ladder. Read `--gate` before quoting any of it:
//
//   static  the device-realistic gate. A primitive's exact-engine proof was
//           discharged offline when the library admitted it, and the run-time
//           gate attests membership. THIS is the headline number.
//   exact   replays each candidate through the live engine and rejects one
//           that dies inside its own duration. That is a privileged lookahead
//           into the true future of the same RNG stream; it is an upper bound
//           and a diagnostic, never a device-realistic result.
import * as C from '@sixam/source/fnaf2';
import { wilsonInterval } from '../packages/review/src/stat.mjs';
import { runNight } from './nightloop-run.mjs';
import { SimPool } from './pool.mjs';

const RUN_MODULE = new URL('./nightloop-run.mjs', import.meta.url).href;
const flag = name => process.argv.includes(`--${name}`);
const option = (name, fallback) => {
  const found = process.argv.find(a => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const ASSERT = flag('assert');
const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
const SEEDS = Number(option('seeds', positional[0] ?? (ASSERT ? 6 : 20)));
const GATE = option('gate', 'static');
const POLICY = option('policy', 'night');
const QUIET = flag('quiet');

// `--nights=1-7`, `--nights=1,3,6`, or a positional night.
function parseNights(text) {
  const out = [];
  for (const part of String(text).split(',')) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) for (let n = +range[1]; n <= +range[2]; n++) out.push(n);
    else if (part.trim()) out.push(Number(part));
  }
  if (!out.length || out.some(n => !Number.isInteger(n) || n < 1))
    throw new Error(`--nights must name whole nights, got ${text}`);
  return out;
}
const NIGHTS = parseNights(option('nights', positional[1] ?? '1'));
// Seeds are deterministic in the index, so a disjoint block is a held-out
// cohort: tune on one, report on another, and say which is which.
const SEED_BASE = Number(option('seed-base', '0'));
const ARMS = option('arms', 'estimator,disabled,open-loop').split(',');
const WORKERS = Number(option('workers', '0'));

async function cohort(night, mode) {
  const jobs = Array.from({ length: SEEDS }, (_, offset) => ({
    night, seedIndex: SEED_BASE + offset, mode, policy: POLICY, gate: GATE,
  }));
  const runs = WORKERS > 1
    ? await new SimPool({ workers: WORKERS }).map(RUN_MODULE, 'runNight', jobs)
        .finally(() => {})
    : jobs.map(runNight);
  const result = { night, mode, won: 0, deaths: {}, detail: {}, selected: {},
    actions: 0, released: 0, refused: 0, stranded: 0, frames: 0,
    emergencyReleased: 0, cancelled: 0,
    flashes: 0, minBox: 1, camsUpMax: 0, powerLeftMin: Infinity };
  for (const run of runs) {
    if (run.won) result.won++;
    if (run.death) {
      result.deaths[run.death] = (result.deaths[run.death] ?? 0) + 1;
      if (run.detail) result.detail[run.detail] = (result.detail[run.detail] ?? 0) + 1;
    }
    result.actions += run.actions;
    result.released += run.released;
    result.refused += run.refused;
    result.stranded += run.stranded;
    result.emergencyReleased += run.emergencyReleased;
    result.cancelled += run.cancelled;
    result.frames += run.frame;
    result.flashes += run.flashes;
    result.minBox = Math.min(result.minBox, run.minBox);
    result.camsUpMax = Math.max(result.camsUpMax, run.camsUpMax);
    result.powerLeftMin = Math.min(result.powerLeftMin, run.powerLeft);
    for (const [id, n] of Object.entries(run.selected))
      result.selected[id] = (result.selected[id] ?? 0) + n;
  }
  return result;
}

const started = Date.now();
/** @type {any[]} */ const table = [];
for (const night of NIGHTS) {
  /** @type {Record<string, any>} */ const arms = {};
  for (const mode of ['estimator', 'disabled', 'open-loop']) {
    if (!ARMS.includes(mode)) continue;
    arms[mode] = await cohort(night, mode);
  }
  table.push({ night, arms });
}

console.log(`closed loop, ${SEEDS} full nights per arm, policy=${POLICY} ` +
  `gate=${GATE}, seeds ${SEED_BASE}..${SEED_BASE + SEEDS - 1} ` +
  `(${((Date.now() - started) / 1000).toFixed(1)}s)`);
for (const { night, arms } of table) {
  console.log(`night ${night}:`);
  for (const [mode, arm] of Object.entries(arms)) {
    const ci = wilsonInterval(arm.won, SEEDS);
    console.log(`  ${mode.padEnd(10)} ${String(arm.won).padStart(4)}/${SEEDS} survived` +
      ` (${(100 * arm.won / SEEDS).toFixed(1)}% [${(100 * ci.low).toFixed(1)}, ${(100 * ci.high).toFixed(1)}]),` +
      ` mean ${(arm.frames / SEEDS / C.FPS).toFixed(1)}s alive,` +
      ` ${arm.actions} actions, ${arm.released} released / ${arm.refused} refused /` +
      ` ${arm.stranded} stranded` +
      (arm.emergencyReleased || arm.cancelled
        ? ` (${arm.emergencyReleased} emergency releases, ${arm.cancelled} cancelled)` : ''));
    if (Object.keys(arm.deaths).length)
      console.log(`    deaths ${JSON.stringify(arm.deaths)}`);
    if (!QUIET && mode === 'estimator') {
      console.log(`    minBox ${arm.minBox.toFixed(3)}, camsUpMax ${arm.camsUpMax}f,` +
        ` power left >= ${arm.powerLeftMin}, ${arm.flashes} hall flashes`);
      console.log(`    cycles ${JSON.stringify(arm.selected)}`);
    }
  }
}

if (ASSERT) {
  const check = (condition, message) => {
    if (!condition) { console.error(`FAIL ${message}`); process.exitCode = 1; }
    else console.log(`ok   ${message}`);
  };
  const first = table[0].arms;
  const estimator = first.estimator, disabled = first.disabled, openLoop = first['open-loop'];
  check(estimator.actions > 0, 'the acting arm actually acted');
  check(estimator.released > 0,
    `held inputs were released at their own boundary (${estimator.released})`);
  check(estimator.stranded === 0,
    `no deferred action was left holding an input at the end of a night (${estimator.stranded})`);
  check(Object.keys(estimator.selected).length >= 4,
    `the acting arm used a real primitive set (used ${Object.keys(estimator.selected).length})`);
  check(estimator.frames > disabled.frames,
    `observations bought survival time (${estimator.frames} > ${disabled.frames})`);
  check(estimator.won > disabled.won,
    `observations bought survival (${estimator.won} > ${disabled.won})`);
  check(disabled.actions === 0,
    'the observation-disabled control never acted on an UNKNOWN fact');
  check(openLoop.won === 0 && openLoop.actions === 0,
    'the open-loop control neither acted nor survived');
}
