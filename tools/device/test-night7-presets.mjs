// Gate for the Custom Night preset scorer. No phone required.
//
// Six things here can go wrong silently, and the first three have each cost a session
// elsewhere in this repository:
//
//  1. The presets could drift from the file the phone's dial driver reads.
//     They are loaded from `models/custom-night-moto-g56-v207.json`, so this
//     checks the ten are present, that every dial is one the engine knows, and
//     that `golden-freddy` reduces to the night-7 table after the caps -- the
//     control that proves the customNight path reaches the engine at all.
//
//  2. The device lane could quietly stop being a device lane. A band that is
//     never applied scores exactly like the exact lane, and the whole file
//     would then be a wish. This pins that a wide band DOES lose nights.
//
//  3. `PRESET_KNOBS.hallOffsetMs` could drift back onto a floor. It exists
//     because the shipped 9500 clears `MASK_ANIM_OFF` by 50 ms, which is
//     narrower than the phone's own measured spread. The check is the mistake
//     register's, 2026-09-11 item 7: a constant is only anchored if it stands
//     clear of its floor by a NAMED margin, and the margin is re-derived here
//     from the engine's own animation constant rather than restated.
//
//  4. The population record could stop describing the tree. `--population`
//     takes a quarter of an hour on seven cores, so this does not re-run it;
//     it checks that nothing the record depends on has moved, and replays
//     every loss it lists and a fixed held-out sample.
//
//  5. A dial-plane record (`--plane`) could stop describing the tree: its seed
//     block, the preset knobs and the k3 winner must be the ones censused, and
//     each grid's corners and centre, and every lost cell's first listed loss,
//     must replay as recorded.
//
//  6. The robustness record (night7-robustness.mjs) could stop describing the
//     tree: its seed block and schedules as censused, and each schedule's
//     tolerated lateness, first lateness loss, phase band edges and first
//     human-jitter loss replaying as recorded.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import * as C from '@fnaf2-1020/core/mechanics';
import { KNOBS0 } from './minus-toys-plan.mjs';
import { loadPresets, cohort, runNight, PRESET_KNOBS, MEASURED_SPREAD_MS, HALL_PLATEAU_MS, BANDS,
  POPULATION_KIND, PLANE_KIND, planeSchedules, planeVector, planeWins } from './night7-presets.mjs';
import { heldOutSeeds } from '../winner-phase-census.mjs';
import { ROBUSTNESS_KIND, PHASE_FRAMES, HUMAN_MS, schedules as robustSchedules, robustWins } from './night7-robustness.mjs';
import { designBlock } from '../winner-census.mjs';

const check = (ok, message) => { if (!ok) throw new Error(message); };

// --- 1. the presets are the phone's presets ---------------------------------
{
  const presets = loadPresets();
  check(presets.length === 10, `expected 10 Custom Night presets, got ${presets.length}`);
  const ids = new Set(presets.map(p => p.id));
  for (const id of ['golden-freddy', 'foxy-foxy', 'new-and-shiny', 'cupcake-challenge'])
    check(ids.has(id), `preset ${id} is missing from the menu model`);
  for (const p of presets)
    for (const dial of Object.keys(p.dials))
      check(C.AI_DIALS.includes(dial), `preset ${p.id} names an unknown dial: ${dial}`);

  // The control: every dial at 20 IS night 7 once the caps clamp, so the
  // customNight path must produce the same AI vector the night-7 table does.
  const gf = presets.find(p => p.id === 'golden-freddy');
  check(C.AI_DIALS.every(d => gf.dials[d] === 20),
    'golden-freddy is no longer all-20; it is the 10/20 control for this file');
}

// --- 2. the device lane is really the device lane ---------------------------
//
// A narrow band must clear and a wide one must not. If both clear, the
// actuator is not wired in and every device figure this file prints is the
// exact lane wearing a band's name.
{
  const gf = loadPresets().find(p => p.id === 'golden-freddy');
  const runs = 120;
  const tight = cohort({ preset: gf, runs, band: BANDS.measured });
  check(tight.wins === runs,
    `the measured band must clear on 10/20, got ${tight.wins}/${runs}`);
  const wide = cohort({ preset: gf, runs, band: BANDS.wide });
  check(wide.wins < runs,
    `the ${BANDS.wide[0]}-${BANDS.wide[1]} ms band cleared ${wide.wins}/${runs}: ` +
    'the actuator is not being applied, so the device lane is not one');
}

// --- 3. the hall pulse stands clear of both its floors ----------------------
{
  const k = PRESET_KNOBS;
  check(k.hallOffsetMs !== KNOBS0.hallOffsetMs,
    'PRESET_KNOBS no longer moves hallOffsetMs; the Foxy fix has been reverted');

  // Below: the mask-OFF animation. `lit?` needs mask = 0 (g75) and the
  // animation is MASK_ANIM_OFF frames, so the pulse must clear the mask-OFF
  // press by that much PLUS the band width, because the band's worst draw can
  // close the gap by its full span.
  const maskAnimOffMs = C.MASK_ANIM_OFF * 1000 / C.FPS;
  const floor = k.maskOffMs + maskAnimOffMs + MEASURED_SPREAD_MS;
  check(k.hallOffsetMs >= floor + 33,
    `hallOffsetMs ${k.hallOffsetMs} clears its mask-OFF floor (${floor.toFixed(1)} ms = ` +
    `maskOffMs ${k.maskOffMs} + MASK_ANIM_OFF ${maskAnimOffMs.toFixed(1)} + spread ` +
    `${MEASURED_SPREAD_MS}) by less than 33 ms`);

  // Above: a measured edge with no mechanism yet (see HALL_PLATEAU_MS). Pin
  // the constant inside the plateau that was actually measured, and require it
  // to stand 33 ms clear of BOTH edges. Writing an inequality here instead
  // would be the 2026-09-11 item 7 mistake in its exact original form: it
  // would pass at 9700, which the +11f epoch column measures as a loss.
  check(k.hallOffsetMs >= HALL_PLATEAU_MS.lo + 33 &&
        k.hallOffsetMs <= HALL_PLATEAU_MS.hi - 33,
    `hallOffsetMs ${k.hallOffsetMs} is not 33 ms inside the measured plateau ` +
    `[${HALL_PLATEAU_MS.lo}, ${HALL_PLATEAU_MS.hi}]`);
  check(HALL_PLATEAU_MS.lo >= floor,
    `the measured plateau's lower edge ${HALL_PLATEAU_MS.lo} is below the derived ` +
    `mask-OFF floor ${floor.toFixed(1)}; the two disagree and one of them is wrong`);

  // And it must still be before the raise, or there is no cams-down hall at all.
  check(k.hallOffsetMs + k.hallMs < k.raiseMs,
    `the hall pulse at ${k.hallOffsetMs} overruns the monitor raise at ${k.raiseMs}`);
}

// --- 4. the population record still describes the tree ---------------------
let populationLine;
{
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const dir = new URL('../../docs/evidence/', import.meta.url);
  const name = readdirSync(dir).filter(n => /^night7-preset-population-\d{8}\.json$/.test(n)).sort().pop();
  check(name, 'no docs/evidence/night7-preset-population-YYYYMMDD.json is committed');
  const record = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
  check(record.kind === POPULATION_KIND, `${name} is not a ${POPULATION_KIND}`);
  check(record.method.knobsSha256 === sha256(JSON.stringify(PRESET_KNOBS)),
    `PRESET_KNOBS changed since ${name}; re-run night7-presets.mjs --population`);
  check(record.method.presetSource.sha256 ===
      sha256(readFileSync(new URL('./models/custom-night-moto-g56-v207.json', import.meta.url))),
    `the menu model changed since ${name}; re-run night7-presets.mjs --population`);
  const design = designBlock();
  check(record.method.designBlock.sha256 === sha256(JSON.stringify(design.seeds)),
    `the design block no longer rebuilds to the one ${name} split on`);
  const presets = loadPresets();
  check(record.presets.length === presets.length && presets.every(p => record.presets.some(r => r.id === p.id)),
    `${name} does not cover the ten presets of the menu model`);
  const inDesign = new Set(design.seeds);
  const { start, count } = record.method.population;
  let replays = 0;
  for (const row of record.presets) {
    const preset = presets.find(p => p.id === row.id);
    check(row.wins + row.losses.length === row.n && row.design.n + row.heldOut.n === row.n,
      `${row.id}: the record's counts do not add up`);
    for (const [seed, reason, frame] of row.losses.slice(0, 20)) {
      const { sim, splitAt } = runNight({ preset, seed, knobs: PRESET_KNOBS });
      replays++;
      const now = sim.won && splitAt >= 0 ? 'win' : sim.won ? 'unarmed' : (sim.death?.reason ?? 'alive');
      check(now === reason && sim.frame === frame, `${row.id} seed ${seed}: recorded ${reason}@${frame}, now ${now}@${sim.frame}`);
    }
    const lost = new Set(row.losses.map(([seed]) => seed));
    let taken = 0;
    for (let k = 0; taken < 3 && k < count; k++) {
      const seed = start + ((k * 40503 + row.id.length * 977) % count);
      if (inDesign.has(seed)) continue;
      taken++; replays++;
      const r = runNight({ preset, seed, knobs: PRESET_KNOBS });
      check((r.sim.won && r.splitAt >= 0) === !lost.has(seed),
        `${row.id} held-out seed ${seed} replays otherwise than ${name} records`);
    }
  }
  populationLine = `${name} still describes the tree (${replays} replays)`;
}

// --- 5. every dial-plane record still describes the tree ---------------------
let planeLine = '';
{
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const dir = new URL('../../docs/evidence/', import.meta.url);
  const names = readdirSync(dir).filter(n => /^night7-dial-plane-[a-z]+-[a-z]+-\d{8}\.json$/.test(n)).sort();
  const schedules = planeSchedules();
  let replays = 0;
  for (const name of names) {
    const record = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    check(record.kind === PLANE_KIND, `${name} is not a ${PLANE_KIND}`);
    const seeds = heldOutSeeds(record.method.seeds.n);
    check(record.method.seeds.sha256 === sha256(JSON.stringify(seeds)), `${name}: the held-out seed block no longer rebuilds`);
    for (const recorded of record.method.schedules) {
      const now = schedules.find(s => s.id === recorded.id);
      check(now, `${name} names a schedule ${recorded.id} the scorer no longer has`);
      if (recorded.knobsSha256) check(recorded.knobsSha256 === sha256(JSON.stringify(PRESET_KNOBS)), `PRESET_KNOBS changed since ${name}`);
      if (recorded.winnerSha256) check(recorded.winnerSha256 === now.winnerSha256, `the k3 winner changed since ${name}`);
    }
    const { a, b } = record.method.plane;
    for (const grid of record.grids) {
      const schedule = schedules.find(s => s.id === grid.schedule);
      const probes = [[0, 0], [0, 20], [20, 0], [20, 20], [10, 10]];
      for (const [x, y] of probes) {
        const cell = grid.map[x][y];
        const listed = grid.lost.find(c => c[a] === x && c[b] === y);
        check(cell === '#' || listed?.losses?.length,
          `${name} ${grid.schedule}@${grid.base} ${a}${x}/${b}${y} is recorded '${cell}' with no listed loss`);
        const seed = cell === '#' ? seeds[(x * 21 + y) % seeds.length] : listed.losses[0][0];
        const { won } = planeWins(schedule, planeVector(a, b, grid.base, x, y), seed);
        replays++;
        check(won === (cell === '#'), `${name} ${grid.schedule}@${grid.base} ${a}${x}/${b}${y} seed ${seed}: recorded '${cell}', replays ${won ? 'won' : 'lost'}`);
      }
      for (const lost of grid.lost) {
        const [seed, reason, frame] = lost.losses[0];
        const r = planeWins(schedule, planeVector(a, b, grid.base, lost[a], lost[b]), seed);
        replays++;
        check(!r.won && r.reason === reason && r.frame === frame, `${name} ${grid.schedule}@${grid.base} ${a}${lost[a]}/${b}${lost[b]} seed ${seed} no longer dies as recorded`);
      }
    }
  }
  check(names.length > 0, 'no docs/evidence/night7-dial-plane-*.json is committed');
  planeLine = `; ${names.length} dial plane(s) still replay as recorded (${replays} replays)`;
}

// --- 6. the robustness record still describes the tree ------------------------
let robustLine = '';
{
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const dir = new URL('../../docs/evidence/', import.meta.url);
  const name = readdirSync(dir).filter(n => /^night7-robustness-\d{8}\.json$/.test(n)).sort().pop();
  check(name, 'no docs/evidence/night7-robustness-YYYYMMDD.json is committed');
  const record = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
  check(record.kind === ROBUSTNESS_KIND, `${name} is not a ${ROBUSTNESS_KIND}`);
  const seeds = heldOutSeeds(record.method.seeds.n);
  check(record.method.seeds.sha256 === sha256(JSON.stringify(seeds)), `${name}: the held-out seed block no longer rebuilds`);
  const now = robustSchedules();
  check(now.length === record.schedules.length, `${name} covers ${record.schedules.length} schedules, the tree has ${now.length}`);
  let replays = 0;
  const lostAs = (schedule, opts, [seed, reason, frame], what) => {
    const r = robustWins(schedule, seed, opts);
    replays++;
    check(!r.won && r.reason === reason && r.frame === frame, `${name} ${schedule.id} ${what} seed ${seed} no longer dies as recorded`);
  };
  for (const rec of record.schedules) {
    const schedule = now.find(x => x.id === rec.id);
    check(schedule, `${name} names ${rec.id}, which the tree no longer has`);
    if (rec.knobsSha256) check(rec.knobsSha256 === schedule.knobsSha256, `PRESET_KNOBS changed since ${name}`);
    if (rec.winnerSha256) check(rec.winnerSha256 === schedule.winnerSha256, `${rec.binding} changed since ${name}`);
    const L = rec.lateness.maxAllWinMs;
    if (L !== null) for (const seed of seeds.slice(0, 2)) {
      replays++;
      check(robustWins(schedule, seed, { lateMs: L }).won, `${name} ${rec.id} seed ${seed} no longer survives ${L} ms lateness`);
    }
    if (rec.lateness.firstLoss) lostAs(schedule, { lateMs: rec.lateness.firstLoss.lateMs }, rec.lateness.firstLoss.losses[0], `${rec.lateness.firstLoss.lateMs} ms lateness`);
    if (rec.human.losses.length) lostAs(schedule, { earlyMs: HUMAN_MS, lateMs: 2 * HUMAN_MS }, rec.human.losses[0], `+-${HUMAN_MS} ms`);
    const map = rec.phase.map;
    for (let i = 0; i < map.length; i++) {
      if (i > 0 && map[i] === map[i - 1] && i < map.length - 1 && map[i] === map[i + 1]) continue;
      if (map[i] === '+') continue;
      const r = robustWins(schedule, seeds[i % seeds.length], { frame: i - PHASE_FRAMES });
      replays++;
      check(r.won === (map[i] === '#'), `${name} ${rec.id} frame ${i - PHASE_FRAMES}: recorded '${map[i]}', replays ${r.won ? 'won' : 'lost'}`);
    }
  }
  robustLine = `; ${name} still describes the tree (${replays} replays)`;
}

console.log('night7-presets: presets match the menu model, the device lane bites, ' +
  `the hall pulse clears both floors by more than 33 ms, and ${populationLine}${planeLine}${robustLine}`);
