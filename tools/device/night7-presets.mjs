// Score the ten Custom Night presets against the Minus Toys device schedule.
//
// Night 7 in this repository has always meant ONE preset: canonical 10/20,
// which is `golden-freddy` in the menu (every dial at 20). The other nine are
// different AI vectors on the same night-7 rule set -- the 45-frame office
// fuse, the CAM 10 parked marker -- and nothing had ever asked the model
// whether the shipped schedule clears them. This file asks, at the golden
// 3000-seed standard, in two lanes:
//
//   exact  -- every press lands on its scheduled frame. This is the model's
//             own answer about the ROUTE, and it is not a device result.
//   device -- the same presses through `actuator.mjs`: a launch-lateness draw
//             per press, the queue serializing behind it, and the mask seam.
//             The band is named on every line, because a device number with
//             no band behind it is a wish.
//
// The presets are read from the calibrated menu model
// (`models/custom-night-moto-g56-v207.json`), not retyped here: that file is
// what the phone's dial driver reads, so a preset this gate clears is the
// preset the runner would actually set. The engine caps still clamp on apply
// (g829/g830/g856-863), so a dial at 20 is Foxy 17, Golden Freddy 10 and 15
// for everyone else -- `golden-freddy` therefore reduces to exactly the
// night-7 table, which is the control this file checks first.
//
//   node tools/device/night7-presets.mjs --gate            # all ten, 3000 seeds, both lanes
//   node tools/device/night7-presets.mjs --gate --preset=foxy-foxy --runs=200
//   node tools/device/night7-presets.mjs --bands           # price every cited band
//   node tools/device/night7-presets.mjs --population --jobs 7 --out FILE   # all 65,536 seeds, exact lane
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as C from '@fnaf2-1020/core/mechanics';
import { Sim } from '@fnaf2-1020/core/mechanics';
import { GOLDEN_MODEL_SEED_SALT, randomSeedCohort, seedCohortDescriptor }
  from '@fnaf2-1020/research/seeds';
import { KNOBS0, build, schedule } from './minus-toys-plan.mjs';
import { DeviceActuator } from './actuator.mjs';
import { designBlock, forkBlocks, gitState } from '../winner-census.mjs';

const MENU_MODEL = new URL('./models/custom-night-moto-g56-v207.json', import.meta.url);

export function loadPresets() {
  const model = JSON.parse(readFileSync(MENU_MODEL, 'utf8'));
  return model.presets.map(p => ({ id: p.id, label: p.label, dials: { ...p.dials } }));
}

// The one knob this file changes from the shipped schedule, and why.
//
// `KNOBS0.hallOffsetMs` = 9500 puts the Foxy-reset hall pulse 300 ms after the
// mask-OFF press at 9200. `MASK_ANIM_OFF` is 15 frames = 250 ms and `lit?`
// needs `mask` = 0 (g75), so the pulse clears the animation it depends on by
// **50 ms** -- and the phone's own per-cycle displacement is wider than that
// (see MEASURED_SPREAD_MS below). When the gap closes, the pulse produces no
// light, Foxy is never reset, and he takes the night. At a 0-82 ms band the
// shipped offset scores 147/200 on `golden-freddy` and every single loss is
// `foxy`; at 0-100 ms it is 107/200, again all Foxy.
//
// The pulse is penned between two floors, one at each end:
//
//   below  the mask-OFF animation. hall must land at least MASK_ANIM_OFF
//          (250 ms) after the mask-OFF press at `maskOffMs`, and the band's
//          worst draw can close that gap by the full band width.
//   above  the 5 s roll grid. `loopPeriodMs` is 10000 = 2 x 5000, so the pulse
//          sits at the same roll phase every cycle and has to complete before
//          the boundary at 10000. This end is NOT epoch-invariant: the roll
//          grid is anchored to the game's frame counter and the schedule to
//          wall clock, so the run's epoch slides the pulse up into it.
//
// So the offset was chosen from the plateau measured across BOTH dimensions --
// eleven offsets x all twelve epochs of `LAST_VIEW_SAMPLE_FRAMES`, 100 seeds a
// cell at a 0-100 ms band, then the two edges re-measured at 300 seeds:
//
//   9525, 9533   284/300 at epoch 0        below the mask-OFF floor
//   9542 .. 9683 300/300 at every epoch    the plateau
//   9692, 9700   165/300 at epoch +11f     the roll grid, reached by the epoch
//
// **9613 is its centre**, clearing each edge by about 70 ms -- twice the 33 ms
// `test-seam-slack.mjs` refuses a plan for, and measured rather than inherited
// from the route it protects (mistake register, 2026-09-11 item 7).
//
// Inside the plateau every offset scores identically at every epoch, and the
// remaining per-epoch variation is the split arm, not the hall: at 9613 the
// win count EQUALS the armed count at all twelve epochs, so once the arm
// lands the route wins. That miss branch is the one the shipped plan closes on
// the phone with `#arm-verify`, which re-arms or aborts; it is not a hall
// defect and this knob cannot touch it.
//
// The exact lane is 200/200 at every offset in the sweep, so this buys device
// margin and costs no model ground.
// The plateau itself, so a test can pin the constant inside the measurement
// instead of inside a re-derivation. The LOWER edge has a mechanism and the
// arithmetic agrees with it (maskOffMs 9200 + MASK_ANIM_OFF 250 + the 82 ms
// spread = 9532, against a measured 9542). The UPPER edge does NOT yet have
// one: 9683 passes and 9692 fails at epoch +11f, which is far below the 10000
// roll boundary, so something between the pulse and the roll is closing first
// and this file does not know what. It is recorded as what it is -- a measured
// edge -- rather than dressed in an inequality that would pass at 9700.
export const HALL_PLATEAU_MS = Object.freeze({ lo: 9542, hi: 9683 });
export const PRESET_KNOBS = Object.freeze({ ...KNOBS0, hallOffsetMs: 9613 });

// What the phone's presses actually do to this schedule, measured on the two
// retained k3 frame traces (artifacts/forensics/k3-frametrace-nights-20260915,
// `ft2-full-04` and `ft2-full-06`). Each cycle's cameras-up static flash is
// located, the longest 10 s chain is fitted with a straight line, and the
// residual is that cycle's displacement about the run's own mean -- which is
// the quantity the actuator calls spread, and the one the epoch offset cannot
// dial out:
//
//   full-04 (n=9)   min -21.5  p10 -15.2  median  1.8  p90 13.8  max 23.0  span 44.6 ms
//   full-06 (n=41)  min -52.3  p10 -20.3  median  2.2  p90 14.6  max 29.3  span 81.5 ms
//
// Read at the screen, so each end carries up to one capture frame (16.7 ms) of
// quantisation: 82 ms is an upper bound on the actuator's own spread, not a
// tight estimate. The gate band is 0-100 ms -- the wider night's full span
// rounded up, with margin, and NOT its p10-p90 -- because a route that only
// survives the typical cycle has not survived the night that contains the tail.
export const MEASURED_SPREAD_MS = 82;

// The bands `latenesssweep.mjs` can cite, kept in the same words so the two
// files cannot drift into quoting different numbers for the same probe.
export const BANDS = {
  exact: [0, 0, 'perfect actuator (the control: must equal the exact lane)'],
  measured: [0, 100, "the k3 traces' worst per-cycle displacement span (81.5 ms) rounded up with margin"],
  clock: [0, 10, 'fork-free /proc/uptime clock (device probe 2026-08-26)'],
  shipped: [49, 106, 'wait_until re-probed: landing error over 20 targets 200 ms apart (device probe 2026-08-26)'],
  documented: [49, 93, 'wait_until as documented (HID-MULTITOUCH.md)'],
  anchor: [110, 180, 'anchor press, older traces (ON-DEVICE-VALIDATION.md)'],
  wide: [110, 300, "actuator.mjs default band (older traces + night 6-40's inferred ~300 ms)"],
};

// One night. `band === null` is the exact lane: the queue is delivered on its
// own frames, which is what `minus-toys-plan.replay()` does.
export function runNight({ preset, seed, worst = false, knobs = KNOBS0,
                           band = null, epochMs = 0, splitCamera = true } = {}) {
  const sim = new Sim({ night: 7, seed, worst, customNight: preset.dials });
  const { opening, loop, finish } = build(knobs);
  const periodMs = knobs.minimal ? knobs.minPeriodMs : knobs.loopPeriodMs;
  const queue = schedule({ splitCamera, opening, loop, finish, periodMs,
                           loopStartMs: 0, untilMs: 420000, epochMs });
  const actuator = band
    ? new DeviceActuator(sim, { seed, worst, lateMinMs: band[0], lateMaxMs: band[1] })
    : null;

  let i = 0, splitAt = -1;
  while (sim.alive && !sim.won) {
    while (i < queue.length && queue[i][0] <= sim.frame) {
      const [, kind, action] = queue[i++];
      if (actuator) actuator[kind](action); else sim[kind](action);
    }
    if (actuator) actuator.deliver();
    sim.tick();
    if (splitAt < 0 && sim.camsUp && sim.viewing === 11 && sim.cam === 9) splitAt = sim.frame;
  }
  return { sim, splitAt, seamDrops: actuator ? actuator.seamDrops : 0 };
}

export function cohort({ preset, runs, worst = false, knobs = PRESET_KNOBS, band = null,
                         epochMs = 0, requireSplit = true } = {}) {
  const population = randomSeedCohort({ count: runs });
  let wins = 0, armed = 0;
  const reasons = new Map();
  for (const seed of population) {
    const r = runNight({ preset, seed, worst, knobs, band, epochMs });
    if (r.splitAt >= 0) armed++;
    if (r.sim.won && (!requireSplit || r.splitAt >= 0)) wins++;
    else if (r.sim.death)
      reasons.set(r.sim.death.reason, (reasons.get(r.sim.death.reason) || 0) + 1);
  }
  return {
    wins, armed, runs: population.length, reasons,
    cohort: seedCohortDescriptor(population, { salt: GOLDEN_MODEL_SEED_SALT }),
  };
}

// --- the population ------------------------------------------------------
//
// `cohort()` scores the golden cohort, which draws uint32 seeds and so deals
// 2932 distinct nights of the 65,536 the 16-bit RNG can (winner-census.mjs).
// `--population` scores all of them for every preset in the exact lane -- the
// model's answer about the ROUTE, which is what a P_max is a statement of --
// with the win condition `cohort()` uses: 6 AM and the split armed.
export const POPULATION_KIND = 'night7-preset-population-v1';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Losses over [start, end) for each named preset: [seed, reason, frame]. */
export function populationBlock(ids, start, end) {
  return loadPresets().filter(p => ids.includes(p.id)).map(preset => {
    const losses = [];
    for (let seed = start; seed < end; seed++) {
      const { sim, splitAt } = runNight({ preset, seed, knobs: PRESET_KNOBS });
      if (!(sim.won && splitAt >= 0))
        losses.push([seed, sim.won ? 'unarmed' : (sim.death?.reason ?? 'alive'), sim.frame]);
    }
    return { id: preset.id, n: end - start, losses };
  });
}

export function populationRecord({ rows, start, count, git, date, command }) {
  const design = designBlock();
  const inDesign = new Set(design.seeds);
  const designIn = design.seeds.filter(seed => seed >= start && seed < start + count).length;
  const exhaustive = start === 0 && count === C.RNG_MODULUS;
  const presets = rows.map(({ id, n, losses }) => {
    const designLosses = losses.filter(([seed]) => inDesign.has(seed)).length;
    const deaths = {};
    for (const [, reason] of losses) deaths[reason] = (deaths[reason] ?? 0) + 1;
    return { id, wins: n - losses.length, n,
      design: { wins: designIn - designLosses, n: designIn },
      heldOut: { wins: (n - designIn) - (losses.length - designLosses), n: n - designIn },
      deaths, losses, pMaxExactLane: exhaustive && losses.length === 0 ? 1 : null };
  });
  const answer = presets.map(p => `${p.id} ${p.wins}/${p.n}`).join('; ') +
    (exhaustive && presets.every(p => p.pMaxExactLane === 1)
      ? '. Every preset is won on every night the model can deal, so P_max = 1 for each in the exact lane.' : '.');
  return {
    schema: 'evidence-record-v1', kind: POPULATION_KIND,
    id: `night7-preset-population-${date.replace(/-/g, '')}`, claimLevel: 'MODEL_ONLY', date,
    question: 'Does the Minus Toys preset schedule clear each of the ten Custom Night presets on every night the ' +
      'model can deal -- not the golden cohort, which is 2932 distinct nights -- and what is P_max per preset?',
    answer,
    whyItIsModelOnly: 'No device run, and only the exact lane: every press on its scheduled frame at epoch 0. ' +
      'The device lanes and the epoch scan stay on the golden cohort (night7-preset-sweep-20260917).',
    method: {
      tool: 'tools/device/night7-presets.mjs --population', command, git,
      population: { start, count, exhaustive,
        why: 'Rng keeps seed & 0xffff (packages/core/src/mechanics/rng.js), so seeds 0..65535 are every night the model can deal' },
      lane: 'exact, normal RNG: runNight({preset, seed, knobs: PRESET_KNOBS}) at epoch 0; a win is sim.won AND splitAt >= 0',
      family: 'one schedule, PRESET_KNOBS (KNOBS0 with hallOffsetMs 9613); each figure is a lower bound scoped to it',
      knobs: PRESET_KNOBS, knobsSha256: sha256(JSON.stringify(PRESET_KNOBS)),
      presetSource: { path: 'tools/device/models/custom-night-moto-g56-v207.json', sha256: sha256(readFileSync(MENU_MODEL)) },
      designBlock: { ...design.components, distinct: design.seeds.length, inCensus: designIn,
        sha256: sha256(JSON.stringify(design.seeds)) },
      heldOutBlock: { definition: 'every censused seed not in the design block', n: count - designIn },
    },
    presets,
  };
}

async function population(argv) {
  const flag = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i < 0 ? dflt : argv[i + 1]; };
  const jobs = Number(flag('jobs', '1'));
  const start = Number(flag('start', '0'));
  const count = Number(flag('count', String(C.RNG_MODULUS)));
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error('--jobs must be a positive integer');
  if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 1 || start + count > C.RNG_MODULUS)
    throw new Error(`--start/--count must lie inside 0..${C.RNG_MODULUS - 1}`);
  const ids = loadPresets().map(p => p.id);
  const started = Date.now();
  const rows = await forkBlocks({ script: fileURLToPath(import.meta.url), args: ids, start, count, jobs });
  const record = populationRecord({ rows, start, count, git: gitState(),
    date: flag('date', new Date().toISOString().slice(0, 10)),
    command: `node tools/device/night7-presets.mjs --population --start ${start} --count ${count} --jobs ${jobs}` });
  record.method.wallSeconds = Math.round((Date.now() - started) / 1000);
  const text = `${JSON.stringify(record, null, 2)}\n`;
  const out = flag('out', null);
  if (out) writeFileSync(out, text); else process.stdout.write(text);
  for (const p of record.presets)
    console.error(`  ${p.id.padEnd(20)} ${String(p.wins).padStart(6)}/${p.n}  held-out ${p.heldOut.wins}/${p.heldOut.n}` +
      (p.wins === p.n ? '' : `  | ${Object.entries(p.deaths).map(([c, k]) => `${c} ${k}`).join(', ')}`));
}

const why = (reasons) => [...reasons.entries()]
  .sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(', ');

function gate(presets, runs, bandName) {
  const band = BANDS[bandName];
  if (!band) throw new Error(`unknown band: ${bandName} (have ${Object.keys(BANDS).join(', ')})`);
  let ok = true;
  console.log(`Custom Night presets vs the Minus Toys schedule, ${runs} seeds each`);
  console.log(`  device lane band: ${band[0]}-${band[1]} ms -- ${band[2]}\n`);
  for (const preset of presets) {
    for (const worst of [false, true]) {
      const r = cohort({ preset, runs, worst });
      const tag = `${preset.id}${worst ? ' worst' : ''}`;
      console.log(`  exact  ${tag.padEnd(28)} ${String(r.wins).padStart(5)}/${r.runs}` +
        (r.wins === r.runs ? '' : `   ${why(r.reasons)}`));
      if (r.wins !== r.runs) ok = false;
    }
    // `worst` in the device lane is not the same pin as in the exact lane: the
    // actuator's own stream still DRAWS its lateness (a pinned mean would
    // delete the spread that does the damage -- actuator.mjs's header), but it
    // pins the mask-seam coin flip, so every monitor press inside the seam is
    // lost instead of some of them.
    for (const worst of [false, true]) {
      const d = cohort({ preset, runs, worst, band });
      const tag = `${preset.id}${worst ? ' worst' : ''}`;
      console.log(`  device ${tag.padEnd(28)} ${String(d.wins).padStart(5)}/${d.runs}` +
        (d.wins === d.runs ? '' : `   ${why(d.reasons)}`));
      if (d.wins !== d.runs) ok = false;
    }
  }
  return ok;
}

function bands(presets, runs) {
  const names = Object.keys(BANDS);
  console.log(`Every cited lateness band, ${runs} seeds per cell\n`);
  console.log('  ' + 'preset'.padEnd(20) + names.map(n => n.padStart(12)).join(''));
  for (const preset of presets) {
    const cells = names.map(n => {
      const b = BANDS[n];
      return String(cohort({ preset, runs, band: b[0] === 0 && b[1] === 0 ? null : b }).wins)
        .padStart(12);
    });
    console.log('  ' + preset.id.padEnd(20) + cells.join(''));
  }
  console.log('\n  bands:');
  for (const n of names) console.log(`    ${n.padEnd(12)} ${BANDS[n][0]}-${BANDS[n][1]} ms  ${BANDS[n][2]}`);
}

// The schedule's phase against the game's own frame counter, which the phone
// re-rolls every run and no knob controls. Printed as wins/armed, because the
// two answer different questions: a cell where they are EQUAL has lost only
// arms, which `#arm-verify` re-takes on the phone, while a cell where wins
// trails armed has lost nights the runner cannot recover.
function epochs(presets, runs, bandName) {
  const band = BANDS[bandName];
  const step = 1000 / C.FPS;
  const n = Math.round(C.LAST_VIEW_SAMPLE_FRAMES);
  console.log(`Epoch scan, ${runs} seeds per cell, band ${band[0]}-${band[1]} ms (wins/armed)\n`);
  console.log('  ' + 'preset'.padEnd(20) +
    [...Array(n).keys()].map(k => `+${k}f`.padStart(9)).join(''));
  for (const preset of presets) {
    const cells = [];
    for (let k = 0; k < n; k++) {
      const r = cohort({ preset, runs, band: band[1] ? band : null, epochMs: k * step });
      cells.push(`${r.wins}/${r.armed}`.padStart(9));
    }
    console.log('  ' + preset.id.padEnd(20) + cells.join(''));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === '--child') {
  const [, , , a, b, ...ids] = process.argv;
  process.send(populationBlock(ids, Number(a), Number(b)));
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href &&
           process.argv.includes('--population')) {
  population(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, dflt) => {
    const v = process.argv.find(a => a.startsWith(`--${name}=`));
    return v === undefined ? dflt : v.slice(name.length + 3);
  };
  const runs = +arg('runs', '3000');
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
  const only = arg('preset', null);
  let presets = loadPresets();
  if (only) {
    presets = presets.filter(p => p.id === only);
    if (!presets.length) throw new Error(`no such preset: ${only}`);
  }
  if (process.argv.includes('--bands')) bands(presets, runs);
  else if (process.argv.includes('--epochs')) epochs(presets, runs, arg('band', 'measured'));
  else if (process.argv.includes('--gate')) {
    if (!gate(presets, runs, arg('band', 'measured'))) process.exitCode = 1;
  } else for (const p of presets)
    console.log(`${p.id.padEnd(20)} ${p.label.padEnd(16)} ` +
      C.AI_DIALS.map(d => `${d}=${p.dials[d] ?? 0}`).join(' '));
}
