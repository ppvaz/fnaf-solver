// Plan 16, the sweep-geometry axis paramsearch never had.
//
// PROGRESS item 13 / devicetimesearch.mjs found `sweepSlotMs` is the one device
// number that moves the sub-70 ladder, but it could only WIDEN the emitted
// spacing (slot + 13) and never entered the LIGHT_AFTER regime. The
// minus7-perfect-experiment branch (merged 1ac9e13) proved 33 ms contacts
// register for every touch control, so the sweep can now be emitted NARROW:
// `devicePlan(r, {deviceSpacingMs, sweepContactMs})` with a sub-50 ms contact
// takes the LIGHT_AFTER path in replay() (select Click + settle + a separate
// light hold). A tight model layout (`build({sweepSlotMs})`) plus a narrow
// device emission re-phases the whole 5 s cycle, and PROGRESS "Very next step"
// (2026-08-27) showed that lifts n2-n6 by +5..+13 at human-correlated jitter --
// but the landscape is phase-locked and chaotic: slot 50 dev 60 -> min(n2-6) 71,
// slot 45 dev 56 -> 45 (a hole between two peaks), slot 36 -> everything 0.
//
// So this is a dense grid, not a beam or a hill-climb. Three knobs:
//   sweepSlotMs      build() -- where the model quantises the three selects,
//                    which sets the sweep's anchored END in the cycle.
//   deviceSpacingMs  devicePlan() -- the emitted inter-select spacing replay()
//                    places the selects at. Either end of the sweep can move;
//                    the END is anchored (five-tick-mask stun bridge), so a
//                    narrower spacing just starts the sweep LATER.
//   sweepContactMs   devicePlan() -- the select's own contact. < 50 ms is the
//                    LIGHT_AFTER path; it also sets the light-hold length.
//
// NOT a device claim (ANDROID-SOURCE-STATUS.md: "the simulator prices
// nothing"). And note the standing caveat: a device run of `50/66/33 slot 50`
// DIED on the phone (Toy Chica escape + a BB kill) while this model said 100%
// at machine precision -- either a LIGHT_AFTER runner bug or the on-device stun
// does not match the model. Every number here is simulator-only and pending
// that being understood.
//
//   node tools/minus7/geometrysearch.mjs                       # grid screen
//   node tools/minus7/geometrysearch.mjs --mode=grid --runs=400 \
//        --slots=40,44,48,52,56,60 --dev-offsets=8,12,16
//   node tools/minus7/geometrysearch.mjs --mode=admit --runs=1200 \
//        --configs=50:60:30,40:50:25
//   node tools/minus7/geometrysearch.mjs --mode=exact --runs=3000 \
//        --configs=50:66:33:33,50:60:33:33 --winner-out=winner.json
//
// `--configs` entries are slot:deviceSpacing:sweepContact[:tapContact].
// `admit` mode re-scores at
// --runs seeds under BOTH slack shapes and ALSO rebuilds+replays at
// readLatencyMs 480 (the `hidpilot n6 target` latch), because a geometry that
// wins only at 550 is a resonance -- exactly how the pkg-4 timing search failed
// (plan 16 progress log).
import { build, devicePlan, replay, idleUntilMs } from '../device/recipe.mjs';
import { modelGate, jitterPlan } from '../device/human-gate.mjs';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJson } from '@sixam/core/contracts';

const arg = (k, d) => {
  const m = process.argv.find(a => a.startsWith(`--${k}=`));
  return m ? m.split('=')[1] : d;
};
const MODE = arg('mode', 'grid');
const RUNS = +arg('runs', MODE === 'admit' ? '1200' : '400');
const SLACK = +arg('slack', '60');
const NIGHTS = [1, 2, 3, 4, 5, 6, 7];
const STORY = [2, 3, 4, 5, 6, 7];
const CORE = [2, 3, 4, 5, 6]; // the search objective: min over these

function configsArg(fallback = '50:66:33:33,50:60:33:33') {
  return arg('configs', fallback).split(',').map(s => {
    const values = s.split(':').map(Number);
    const [slot, dev, con, tap = 33] = values;
    if (values.length < 3 || values.length > 4 ||
        ![slot, dev, con, tap].every(Number.isFinite) ||
        slot <= 0 || dev <= 0 || con <= 0 || tap <= 0 || con >= dev)
      throw new Error(`invalid geometry "${s}"; expected positive slot:spacing:sweep-contact[:tap-contact] with sweep-contact < spacing`);
    return { slot, dev, con, tap };
  });
}

// One geometry -> the emitted plan text for one night.
function planText(night, { slot, dev, con, tap = 33 }) {
  const recipe = build({ night, sweepSlotMs: slot });
  const plan = devicePlan(recipe, (dev || con) ? { deviceSpacingMs: dev, sweepContactMs: con,
    tapContactMs: tap } : {});
  let text = `#night ${recipe.night}\n#idle-until ${idleUntilMs(recipe.night)}\n`;
  for (const [name, lines] of Object.entries(plan))
    text += `#cycle ${name} ${recipe.cycles[name].lengthMs}\n${lines.join('\n')}\n`;
  return text;
}

// The default con for a slot: the LIGHT_AFTER regime wants a sub-50 ms select,
// and the table's rows sit near slot*0.55 (50->30, 40->25, 45->28).
const conFor = slot => Math.min(45, Math.max(20, Math.round(slot * 0.55)));

function ladder(geom, runs, shape, replayFn) {
  const cells = {};
  for (const n of NIGHTS) {
    try {
      const g = modelGate(planText(n, geom), { night: n, runs, slackMs: SLACK, shape, replayFn });
      cells[n] = +(100 * g.survived / runs).toFixed(1);
    } catch (e) { cells[n] = `ERR(${e.message.slice(0, 32)})`; }
  }
  return cells;
}
const minOf = (l, ns) => {
  const v = ns.map(n => l[n]).filter(x => typeof x === 'number');
  return v.length === ns.length ? Math.min(...v) : NaN;
};
const fmt = l => NIGHTS.map(n => `${String(l[n]).padStart(5)}`).join(' ');

// A rebuild+replay at the 480 ms lit-frame latch: the plan is BUILT at 480 too,
// or the schedule and the replay diverge (devicetimesearch.mjs).
function ladder480(geom, runs, shape) {
  const cells = {};
  for (const n of NIGHTS) {
    try {
      const recipe = build({ night: n, sweepSlotMs: geom.slot, readLatencyMs: 480 });
      const plan = devicePlan(recipe, (geom.dev || geom.con)
        ? { deviceSpacingMs: geom.dev, sweepContactMs: geom.con } : {});
      let won = 0;
      for (let seed = 1; seed <= runs; seed++) {
        const { sim } = replay(jitterPlan(plan, seed, SLACK, shape),
          { night: n, seed, readLatencyMs: 480,
            attackWindowMs: recipe.cycles.attack.lengthMs });
        if (sim.won) won++;
      }
      cells[n] = +(100 * won / runs).toFixed(1);
    } catch (e) { cells[n] = `ERR(${e.message.slice(0, 32)})`; }
  }
  return cells;
}

function grid() {
  const slots = arg('slots', '40,42,44,46,48,50,52,54,56,58,60').split(',').map(Number);
  const devOffsets = arg('dev-offsets', '8,11,14,17').split(',').map(Number);
  const winnerOut = arg('winner-out', '');
  const admitRuns = +arg('admit-runs', '0');
  console.log(`geometry grid  ${RUNS} seeds/night  correlated ±${SLACK}`);
  console.log(`slots ${slots.join(',')}   dev = slot + {${devOffsets.join(',')}}   con = round(slot*0.55)\n`);

  const base = ladder({ slot: 120, dev: 0, con: 0 }, RUNS, 'correlated');
  console.log(`  shipped 120/133/100   ${fmt(base)}   min(n2-6) ${minOf(base, CORE)}  n7 ${base[7]}\n`);
  console.log(`  ${'slot/dev/con'.padEnd(16)} ${NIGHTS.map(n => `   n${n}`).join(' ')}   min26   n7`);

  const rows = [];
  for (const slot of slots) {
    const con = conFor(slot);
    for (const off of devOffsets) {
      const dev = slot + off;
      if (con >= dev) continue;
      const geom = { slot, dev, con };
      const l = ladder(geom, RUNS, 'correlated');
      const m = minOf(l, CORE);
      rows.push({ geom, l, m, n7: l[7] });
      console.log(`  ${`${slot}/${dev}/${con}`.padEnd(16)} ${fmt(l)}   ${String(m).padStart(5)}  ${String(l[7]).padStart(4)}`);
    }
  }
  rows.sort((a, b) => (b.m || -1) - (a.m || -1));
  console.log(`\n--- top 8 by min(n2-6), correlated ${RUNS} seeds ---`);
  for (const r of rows.slice(0, 8)) {
    const g = r.geom;
    console.log(`  ${`${g.slot}/${g.dev}/${g.con}`.padEnd(16)} min26 ${String(r.m).padStart(5)}   n7 ${String(r.n7).padStart(4)}   ${fmt(r.l)}`);
  }
  console.log(`\nshipped baseline min(n2-6) ${minOf(base, CORE)} / n7 ${base[7]}.`);
  console.log(`Re-score the winners with:  --mode=admit --configs=${rows.slice(0, 4).map(r => `${r.geom.slot}:${r.geom.dev}:${r.geom.con}`).join(',')}`);
  if (winnerOut) {
    if (!admitRuns) throw new Error('--winner-out requires --admit-runs so the persisted gate is explicit');
    const best = rows[0];
    if (!best) throw new Error('geometry search produced no candidate to persist');
    const byNight = [];
    for (const shape of ['correlated', 'iid']) for (const night of NIGHTS) {
      const result = modelGate(planText(night, best.geom), { night, runs: admitRuns, slackMs: SLACK, shape });
      byNight.push({ shape, night, ...result, outcomes: undefined });
    }
    const status = byNight.every(result => result.ok) ? 'PASS'
      : byNight.some(result => result.verdict === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'FAIL';
    if (status !== 'PASS')
      throw new Error(`best geometry did not pass the persisted model gate (${status}); no winner was written`);
    const seeds = Array.from({ length: admitRuns }, (_, index) => index + 1);
    const winner = {
      schema: 'winner-v1', strategy: 'minus7',
      knobs: { night: NIGHTS[0], sweepSlotMs: best.geom.slot, readLatencyMs: 550,
        hallPulseMs: 130, pilotOffset: 10, maskMarginMs: 900, search: {} },
      planOptions: { deviceSpacingMs: best.geom.dev, sweepContactMs: best.geom.con },
      nights: [...NIGHTS], engineHash: 'model-sim-v1', seeds, replaySeeds: seeds.slice(0, 8),
      profile: 'fixture-hid-screencap',
      gate: { status, claimLevel: 'MODEL_ONLY', runs: admitRuns,
        byNight: byNight.map(({ outcomes, ...result }) => result) },
    };
    if (existsSync(winnerOut)) throw new Error(`refusing to overwrite winner file ${winnerOut}`);
    mkdirSync(dirname(winnerOut), { recursive: true });
    writeFileSync(winnerOut, canonicalJson(winner));
    console.log(`winner=${winnerOut} strategy=minus7 gate=${status} geometry=${best.geom.slot}:${best.geom.dev}:${best.geom.con}`);
  }
}

// The n2-n6 basins are ~6 ms wide in emitted spacing (slot 46: dev 54 -> min
// 70, dev 56 -> min 42). A real lever survives the actuator not hitting the
// exact centre; a phase-lock resonance does not. Re-score a small neighbourhood
// and report the WORST corner alongside the centre -- if the worst corner
// collapses, the centre number is a spike, not a basin (plan 16 pkg 3/4: a win
// that games one latch model is not a strategy).
function neighbourhood(geom, runs, shape) {
  const pts = [];
  for (const ds of [-2, 0, 2])
    for (const dd of [-3, 0, 3]) {
      const g = { slot: geom.slot + ds, dev: geom.dev + dd, con: geom.con };
      if (g.con >= g.dev) continue;
      pts.push({ g, min: minOf(ladder(g, runs, shape), CORE) });
    }
  const mins = pts.map(p => p.min).filter(x => typeof x === 'number');
  return { worst: Math.min(...mins), best: Math.max(...mins), n: pts.length };
}

function admit() {
  const configs = configsArg('50:60:30,40:50:25');
  const doNbhd = !process.argv.includes('--no-nbhd');
  console.log(`geometry admission  ${RUNS} seeds/night  ±${SLACK}\n`);
  const controls = [{ slot: 120, dev: 0, con: 0 }, ...configs];
  for (const geom of controls) {
    const tag = geom.slot === 120 && !geom.dev ? 'shipped 120/133/100' : `${geom.slot}/${geom.dev}/${geom.con}`;
    console.log(`===== ${tag} =====`);
    for (const shape of ['correlated', 'iid']) {
      const l = ladder(geom, RUNS, shape);
      console.log(`  gate  ${shape.padEnd(11)} ${fmt(l)}   min(n2-6) ${String(minOf(l, CORE)).padStart(5)}   min(n2-7) ${String(minOf(l, STORY)).padStart(5)}`);
    }
    for (const shape of ['correlated', 'iid']) {
      const l = ladder480(geom, RUNS, shape);
      console.log(`  480   ${shape.padEnd(11)} ${fmt(l)}   min(n2-6) ${String(minOf(l, CORE)).padStart(5)}   (rebuilt + replayed at readLatency 480)`);
    }
    if (doNbhd && tag !== 'shipped 120/133/100') {
      const nb = neighbourhood(geom, Math.min(RUNS, 400), 'correlated');
      console.log(`  nbhd  correlated  min(n2-6) over ${nb.n}-pt (slot±2, dev±3) grid: worst ${nb.worst}  best ${nb.best}` +
        (nb.worst < 60 ? '   <-- SPIKE, not a basin' : '   <-- holds'));
    }
    console.log('');
  }
  console.log('A geometry clears the sub-70 nights only if min(n2-6) >= 70 on BOTH');
  console.log('shapes AND the 480 rebuild does not collapse AND the ±ms neighbourhood');
  console.log('holds. n7 is a separate problem (jitter shape + bang-anchored reset).');
}

// Exact simulator admission for a device geometry. This deliberately does not
// call modelGate or jitterPlan: a winner here means the emitted plan itself
// survived every requested simulator seed. Pinned-worst is scored as a second
// cohort so an RNG-mode artifact cannot be hidden by the ordinary sequence.
function exactCohort(geom, runs, worst) {
  const night = 6;
  const recipe = build({ night, sweepSlotMs: geom.slot });
  const plan = devicePlan(recipe, { deviceSpacingMs: geom.dev, sweepContactMs: geom.con,
    tapContactMs: geom.tap });
  let wins = 0;
  const deaths = {};
  for (let seed = 1; seed <= runs; seed++) {
    const { sim } = replay(plan, { night, seed, worst,
      attackWindowMs: recipe.cycles.attack.lengthMs });
    if (sim.won) wins++;
    else {
      const reason = sim.death?.reason ?? 'unknown';
      deaths[reason] = (deaths[reason] ?? 0) + 1;
    }
  }
  return { wins, seeds: runs, deaths };
}

function exact() {
  const configs = configsArg();
  const winnerOut = arg('winner-out', '');
  const profile = arg('profile', 'fixture-hid-screencap');
  console.log(`geometry exact admission  night 6  ${RUNS} seeds/cohort  no human jitter`);
  let winner = null;
  for (const geom of configs) {
    const ordinary = exactCohort(geom, RUNS, false);
    const worst = exactCohort(geom, RUNS, true);
    const pass = ordinary.wins === RUNS && worst.wins === RUNS;
    console.log(`  ${geom.slot}:${geom.dev}:${geom.con}:${geom.tap}  ordinary ${ordinary.wins}/${RUNS}` +
      `  pinned-worst ${worst.wins}/${RUNS}  ${pass ? 'PASS' : 'FAIL'}`);
    if (!pass) {
      if (Object.keys(ordinary.deaths).length) console.log(`    ordinary deaths ${JSON.stringify(ordinary.deaths)}`);
      if (Object.keys(worst.deaths).length) console.log(`    pinned-worst deaths ${JSON.stringify(worst.deaths)}`);
    }
    if (!winner && pass) winner = { geom, ordinary, worst };
  }
  if (!winner) throw new Error(`no geometry cleared ${RUNS}/${RUNS} in both exact cohorts`);
  if (!winnerOut) return;
  if (existsSync(winnerOut)) throw new Error(`refusing to overwrite winner file ${winnerOut}`);
  const seeds = Array.from({ length: RUNS }, (_, index) => index + 1);
  const document = {
    schema: 'winner-v1', strategy: 'minus7',
    knobs: { night: 6, sweepSlotMs: winner.geom.slot, readLatencyMs: 550,
      hallPulseMs: 130, pilotOffset: 10, maskMarginMs: 900, search: {} },
    planOptions: { deviceSpacingMs: winner.geom.dev, sweepContactMs: winner.geom.con,
      tapContactMs: winner.geom.tap },
    nights: [6], engineHash: 'model-sim-v1', seeds, replaySeeds: seeds.slice(0, 8),
    profile,
    gate: { status: 'PASS', claimLevel: 'MODEL_ONLY', mode: 'exact', night: 6,
      geometry: winner.geom, cohorts: { ordinary: winner.ordinary, worst: winner.worst } },
  };
  mkdirSync(dirname(winnerOut), { recursive: true });
  writeFileSync(winnerOut, canonicalJson(document));
  console.log(`winner=${winnerOut} strategy=minus7 gate=PASS geometry=` +
    `${winner.geom.slot}:${winner.geom.dev}:${winner.geom.con}:${winner.geom.tap}`);
}

if (MODE === 'exact') exact();
else if (MODE === 'admit') admit();
else grid();
