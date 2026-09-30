#!/usr/bin/env node
// The press-phase x office-timer-rate sweep on the phone nights whose seed is established
// (ROADMAP S2, Observatory-style: rule one named explanation in or out). Every earlier replay
// pinned the schedule to the measured origin and the office timer to the displayed-frame clock;
// a shared error in either reference would sit upstream of the model and the rebuild together,
// exactly where the retained first disagreements live (model and rebuild agree with each other
// at every first-disagreeing window; the phone read them differently).
//
//   node packages/propose/bin/recompile/phone-clock-sweep.mjs sweep --config packages/propose/bin/recompile/phone-clock-sweep.json \
//        --out tools/recompile/results/PHONE-CLOCK-SWEEP.json [--inputs-root DIR] [--night NAME]
//   node packages/propose/bin/recompile/phone-clock-sweep.mjs check RESULT.json
//
// sweep runs, for each configured night, the control cell (deltaMs 0, timerRate 0, which must
// reproduce the retained phone-encounters result's model windows byte for byte) and then the
// predeclared grid: deltaMs shifts the whole schedule against the office clock (a constant
// origin-phase error); timerRate r scales every office update's timer delta by (1 + r) while
// presses stay pinned to captured frames (a uniform timer-rate error: r < 0 delays rolls in
// image time). A night with no frame trace cannot separate the two clocks and sweeps deltaMs
// only. check re-derives every score, the best cells and the verdict from the result's own
// rows and the retained control, without the model or any private input.
//
// Content-free: codes, counts, times and hashes. MODEL_ONLY; nothing promotes anything.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  cumTick, cumulative, loadConfig, mapSchedule, maskPresses, officeClock, phoneSchedule, checkPressFile,
  compareOutcome, scoreWindows, traceColumns, traceTick, windowCodes,
} from './phone-encounter-replay.mjs';
import { drawTrace, MODEL_SOURCES } from '../../../source/recompile/model-draw-trace.mjs';
import { LEDGERS } from './compare-schedule-replay.mjs';
import { currentPath } from '@sixam/review/renamed-path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
// A path a committed record names, where it lives now (records keep the paths they were written with).
const current = (path) => currentPath(ROOT, path) ?? path;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const SCHEMA = 'phone-clock-sweep-result-v1';
export const MODEL_FRAMES = 40000;
const CODE = { withbonnie: 'B', withchica: 'C', withfreddy: 'F', toybonnie: 'b', toychica: 'c', toyfreddy: 'f', mangle: 'M', bb: 'x' };

function privateText(inputsRoot, ref) {
  const bytes = readFileSync(resolve(inputsRoot, ref.path));
  if (sha256(bytes) !== ref.sha256) throw new Error(`${ref.path}: sha256 ${sha256(bytes)} is not the recorded ${ref.sha256}`);
  return bytes.toString('utf8');
}

/** timerRate r scales every update's timer delta by (1 + r); 0 is the retained clock. */
export function scaledDeltas(deltas, timerRate) {
  if (!Number.isFinite(timerRate) || timerRate <= -1) throw new Error('timerRate must exceed -1');
  return deltas.map((d) => d * (1 + timerRate));
}

/**
 * The measured night-zero correction: the game's night clock starts at the night-go tap (the anchor fire),
 * which the retained hour transitions put at first-night-frame + 3836.7 ms on full-06 and + 3831.4 ms on
 * full-04 (70.000 s hours, residuals +-30 ms; zero = fire within +-50 ms on both nights). The retained
 * reconstruction instead starts office updates at the first captured night frame, attributing ~3.84 s of
 * pre-night capture to the office clock. `dropMs` drops every captured frame whose image time (after the
 * first night frame) is under dropMs from the office clock: those frames contribute no update and no timer,
 * and the office clock's zero moves to the first kept frame. A press mapped before the kept clock starts is
 * clamped to update 0 (it landed during the intro; what the game did with it is not modelled here).
 */
export function droppedClock(clock, dropMs) {
  if (!Number.isFinite(dropMs) || dropMs < 0) throw new Error('dropMs must be 0 or positive');
  if (!clock) throw new Error('a dropped clock needs a frame trace');
  let k = 0;
  while (k < clock.imageMs.length && clock.imageMs[k] < dropMs) k += 1;
  if (k >= clock.imageMs.length) throw new Error('dropMs drops the whole trace');
  const startMs = clock.imageMs[k];
  const imageNs = clock.imageMs.slice(k).map((t) => Math.round((t - startMs) * 1e6));
  // Rebuild from the first retained image; slicing the old deltas retains the interval that led
  // into the dropped region as update 0.
  const kept = officeClock(imageNs, 0, { catchUp: true });
  return { ...kept, droppedFrames: k, startMs };
}

/** One model replay at a cell: the schedule shifted by deltaMs against the office clock. */
export function modelCell({ nightCfg, sched, clock, deltas, modelOptions, customNight, deltaMs, timerRate, dropMs = 0 }) {
  const kept = clock ? (dropMs > 0 ? droppedClock(clock, dropMs) : { ...clock, droppedFrames: 0, startMs: 0 }) : null;
  const keptDeltas = dropMs > 0 ? kept.deltas.map((d) => Number(d.toFixed(6))) : deltas;
  const scaled = scaledDeltas(keptDeltas, timerRate);
  const shift = nightCfg.trace ? nightCfg.trace.releaseAfterFirstNightFrameMs - nightCfg.originMs : 0;
  const tickOf = nightCfg.trace
    ? (ms) => Math.max(0, traceTick(ms + shift - deltaMs - kept.startMs, kept))
    : (ms) => cumTick(ms - deltaMs, keptDeltas);
  const mapped = mapSchedule(sched, tickOf);
  const observe = (sim) => ({ mask: LEDGERS.mask.model(sim), unit: sim.blackout.active ? sim.blackout.unitId : null });
  const model = drawTrace({ night: nightCfg.night, seed: nightCfg.seed, frames: MODEL_FRAMES, rows: mapped.queue,
    modelOptions, customNight, observe, ...(nightCfg.trace ? { frameTimes: scaled } : {}) });
  const presses = maskPresses(mapped.queue);
  const cum = cumulative(scaled, model.out.length + 2);
  const state = (u) => {
    const o = model.observed[u + 1];
    return o ? { maskValue: o.mask, occupant: o.unit ? (CODE[o.unit] ?? '?') : null } : null;
  };
  const endMs = Number(cum[model.out.length - 1].toFixed(1));
  const windows = windowCodes(presses, state, cum, endMs);
  return { codes: windows.map((w) => w.code).join(''), rows: windows, result: model.won ? '6am' : model.death ? 'death' : 'alive',
    endMs, clockStartMs: kept?.startMs ?? null, droppedFrames: kept?.droppedFrames ?? 0,
    stretched: mapped.stretched, firstPressTick: mapped.queue[0][0] };
}

/** A cell's scores, recomputed from its codes string and the night's phone reads. */
export function cellScore(phone, terminal, cell) {
  const s = scoreWindows(phone, cell.codes);
  const o = compareOutcome(terminal, { result: cell.modelResult, endMs: cell.modelEndMs });
  return { agree: s.agree, compared: s.compared, occupied: s.occupied, occupancyAgree: s.occupancyAgree,
    unplayed: s.unplayed, hits: s.hits, read: s.read, firstDisagreement: s.firstDisagreement,
    outcomeAgrees: o.agrees, outcomeDeltaMs: o.deltaMs };
}

/** The best cell: any match beats every non-match; then agreeing windows (count), then occupancy, then the smallest perturbation. */
export function bestCell(cells, verdictCfg) {
  if (!cells.length) throw new Error('no cells to rank');
  const rank = (c) => (cellMatches(c, verdictCfg) ? 1 : 0);
  return cells.reduce((a, b) => {
    if (rank(b) !== rank(a)) return rank(b) > rank(a) ? b : a;
    if (b.agree !== a.agree) return b.agree > a.agree ? b : a;
    if (b.occupancyAgree !== a.occupancyAgree) return b.occupancyAgree > a.occupancyAgree ? b : a;
    return Math.abs(b.deltaMs) + Math.abs(b.timerRate) * 1000 + (b.dropMs ?? 0)
      < Math.abs(a.deltaMs) + Math.abs(a.timerRate) * 1000 + (a.dropMs ?? 0) ? b : a;
  });
}

/** A cell matches when every phone-read window it played agrees and it played enough of them. */
export function cellMatches(cell, verdictCfg) {
  return cell.unplayed === 0 && cell.compared >= verdictCfg.matchMinCompared && cell.agree === cell.compared;
}

/**
 * One night's derived summary. Scores every cell from its codes (pure: the same call re-derives a committed
 * result), ranks them, and applies the predeclared match and improve rules. Returns the scored cells too;
 * the sweep keeps them as the night's rows and stores only the summary as `derived`.
 */
export function deriveNight(night) {
  const v = night.verdictCfg;
  const withScores = night.cells.map((c) => ({ ...c, ...cellScore(night.phone.windows, night.phone.terminal, c) }));
  const controlScore = cellScore(night.phone.windows, night.phone.terminal, night.control);
  const rate = (c) => (c.compared ? c.agree / c.compared : -1);
  const best = bestCell(withScores, v);
  const matches = withScores.filter((c) => cellMatches(c, v));
  const hasDropAxis = night.cells.some((c) => c.dropMs !== undefined);
  return { cells: withScores, controlScore,
    best: { deltaMs: best.deltaMs, timerRate: best.timerRate, ...(hasDropAxis ? { dropMs: best.dropMs ?? 0 } : {}), agree: best.agree, compared: best.compared,
      occupancyAgree: best.occupancyAgree, unplayed: best.unplayed, modelResult: best.modelResult,
      outcomeAgrees: best.outcomeAgrees, outcomeDeltaMs: best.outcomeDeltaMs, codes: best.codes },
    matchCells: matches.map((c) => ({ deltaMs: c.deltaMs, timerRate: c.timerRate, ...(hasDropAxis ? { dropMs: c.dropMs ?? 0 } : {}), agree: c.agree, compared: c.compared })),
    matches: matches.length > 0, improves: best.agree >= controlScore.agree + Math.ceil(v.improveMargin * controlScore.compared),
    bestRate: rate(best), controlRate: rate({ compared: controlScore.compared, agree: controlScore.agree }) };
}

/** The whole sweep's verdict, from the nights' derived summaries only. */
export function deriveVerdict(nights) {
  const matched = nights.filter((n) => n.derived.matches);
  const improved = nights.filter((n) => n.derived.improves && !n.derived.matches);
  let consistency = null;
  if (matched.length >= 2) {
    const v = matched[0].verdictCfg;
    let ok = true;
    for (let i = 0; i < matched.length && ok; i += 1) {
      for (let j = i + 1; j < matched.length; j += 1) {
        const a = matched[i].derived.best;
        const b = matched[j].derived.best;
        if (Math.abs(a.deltaMs - b.deltaMs) > v.consistentDeltaMs || Math.abs(a.timerRate - b.timerRate) > v.consistentRate
          || Math.abs((a.dropMs ?? 0) - (b.dropMs ?? 0)) > (v.consistentDropMs ?? 0)) ok = false;
      }
    }
    consistency = ok ? 'CONSISTENT_ACROSS_NIGHTS' : 'NIGHT_SPECIFIC';
  }
  const status = matched.length ? 'ALIGNMENT_CELLS_FOUND' : improved.length ? 'IMPROVED_NOT_ALIGNED' : 'NO_PHASE_RATE_ALIGNMENT';
  return { status, nightsWithMatches: matched.map((n) => n.name), nightsImproved: improved.map((n) => n.name), consistency };
}

/** Recompute every derived field; throws on the first difference. */
export function check(result) {
  if (result.schema !== SCHEMA) throw new Error(`schema must be ${SCHEMA}`);
  if (result.claimLevel !== 'MODEL_ONLY') throw new Error('the sweep is MODEL_ONLY');
  const cfgPath = resolve(ROOT, current(result.method.sweepConfig));
  const sweepCfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  if (sha256(readFileSync(cfgPath)) !== result.method.sweepConfigSha256) throw new Error('the sweep config hash differs');
  const refPath = resolve(ROOT, current(sweepCfg.control.reference.path));
  if (sha256(readFileSync(refPath)) !== sweepCfg.control.reference.sha256) throw new Error('the retained control result hash differs');
  const reference = JSON.parse(readFileSync(refPath, 'utf8'));
  for (const night of result.nights) {
    const refNight = reference.nights.find((n) => n.name === night.name);
    const retained = refNight?.variants.find((v) => v.variant === night.controlVariant);
    if (!retained || night.control.codes !== retained.windows.model || night.control.retainedEqual !== true)
      throw new Error(`${night.name}: the control cell does not reproduce the retained ${night.controlVariant} model windows`);
    for (const c of night.cells) {
      const s = cellScore(night.phone.windows, night.phone.terminal, c);
      for (const key of Object.keys(s)) {
        if (JSON.stringify(s[key]) !== JSON.stringify(c[key])) throw new Error(`${night.name} cell ${c.deltaMs}/${c.timerRate}: ${key} differs from its codes`);
      }
    }
    const derived = deriveNight(night);
    if (JSON.stringify(derived.best) !== JSON.stringify(night.derived.best)) throw new Error(`${night.name}: best cell differs from the rows`);
    if (JSON.stringify(derived.matchCells) !== JSON.stringify(night.derived.matchCells)) throw new Error(`${night.name}: match cells differ`);
    if (derived.matches !== night.derived.matches || derived.improves !== night.derived.improves
      || derived.bestRate !== night.derived.bestRate || derived.controlRate !== night.derived.controlRate
      || JSON.stringify(derived.controlScore) !== JSON.stringify(night.derived.controlScore))
      throw new Error(`${night.name}: derived summary differs from the rows`);
  }
  const verdict = deriveVerdict(result.nights);
  if (JSON.stringify(verdict) !== JSON.stringify(result.verdict)) throw new Error(`verdict differs from the rows: ${JSON.stringify(verdict)}`);
  return { nights: result.nights.length, status: verdict.status, evidenceId: result.evidenceId };
}

// ---------------------------------------------------------------- the sweep

function nightInputs(sweepCfg, nightCfg, inputsRoot, modelOptions) {
  const winner = JSON.parse(readFileSync(resolve(ROOT, nightCfg.winner), 'utf8'));
  const sched = phoneSchedule(winner, nightCfg.night, nightCfg.originMs);
  const pressCount = checkPressFile(sched.queueMs, JSON.parse(privateText(inputsRoot, nightCfg.presses)));
  let clock = null;
  let deltas = [];
  if (nightCfg.trace) {
    const columns = traceColumns(privateText(inputsRoot, nightCfg.trace), ['image_ns']);
    clock = officeClock(columns.image_ns, nightCfg.trace.first, { catchUp: true });
    deltas = clock.deltas.map((d) => Number(d.toFixed(6)));        // the harness's six decimals; the model's clock
  }
  const customNight = nightCfg.customNight ? JSON.parse(readFileSync(resolve(ROOT, nightCfg.customNight), 'utf8')) : null;
  return { sched, pressCount, clock, deltas, customNight, modelOptions };
}

function runCell(inputs, nightCfg, deltaMs, timerRate, dropMs = 0) {
  const cell = modelCell({ nightCfg, sched: inputs.sched, clock: inputs.clock, deltas: inputs.deltas,
    modelOptions: inputs.modelOptions, customNight: inputs.customNight, deltaMs, timerRate, dropMs });
  return { deltaMs, timerRate, dropMs, clockStartMs: cell.clockStartMs, droppedFrames: cell.droppedFrames,
    codes: cell.codes, modelResult: cell.result, modelEndMs: cell.endMs,
    stretchedContacts: cell.stretched, firstPressTick: cell.firstPressTick };
}

function sweep(sweepCfg, cfgPath, inputsRoot, only) {
  const nightsCfg = loadConfig(resolve(ROOT, sweepCfg.nights));
  const reference = JSON.parse(readFileSync(resolve(ROOT, sweepCfg.control.reference.path), 'utf8'));
  if (sha256(readFileSync(resolve(ROOT, sweepCfg.control.reference.path))) !== sweepCfg.control.reference.sha256)
    throw new Error('the retained control result hash differs');
  const modelOptions = JSON.parse(readFileSync(resolve(ROOT, sweepCfg.modelOptions ?? nightsCfg.modelOptions), 'utf8'));
  const baseGrid = sweepCfg.grid;
  const refineCells = (best) => {
    const out = [];
    for (let d = best.deltaMs - sweepCfg.refine.deltaWindowMs; d <= best.deltaMs + sweepCfg.refine.deltaWindowMs + 1e-9; d += sweepCfg.refine.deltaStepMs) {
      out.push({ deltaMs: Number(d.toFixed(3)), timerRate: best.timerRate, dropMs: best.dropMs ?? 0 });
    }
    return out;
  };
  const refineRates = (best) => {
    const out = [];
    for (let r = best.timerRate - sweepCfg.refine.rateWindow; r <= best.timerRate + sweepCfg.refine.rateWindow + 1e-9; r += sweepCfg.refine.rateStep) out.push({ deltaMs: best.deltaMs, timerRate: Number(r.toFixed(4)), dropMs: best.dropMs ?? 0 });
    return out;
  };
  const refineDrops = (best) => {
    const out = [];
    if (!sweepCfg.refine.dropWindowMs) return out;
    for (let d = (best.dropMs ?? 0) - sweepCfg.refine.dropWindowMs; d <= (best.dropMs ?? 0) + sweepCfg.refine.dropWindowMs + 1e-9; d += sweepCfg.refine.dropStepMs) {
      if (d > 0) out.push({ deltaMs: best.deltaMs, timerRate: best.timerRate, dropMs: Math.round(d) });
    }
    return out;
  };
  const nights = [];
  for (const nightCfg of nightsCfg.nights) {
    if (only && nightCfg.name !== only) continue;
    const grid = baseGrid.byNight?.[nightCfg.name] ? { ...baseGrid, ...baseGrid.byNight[nightCfg.name] } : baseGrid;
    const refNight = reference.nights.find((n) => n.name === nightCfg.name);
    if (!refNight) throw new Error(`${nightCfg.name} is not in the retained control result`);
    const controlVariant = sweepCfg.control.variant[nightCfg.name];
    const retained = refNight.variants.find((v) => v.variant === controlVariant);
    if (!retained) throw new Error(`${nightCfg.name} has no retained ${controlVariant} variant`);
    const inputs = nightInputs(sweepCfg, nightCfg, inputsRoot, modelOptions);
    const controlCell = runCell(inputs, nightCfg, 0, 0);
    if (controlCell.codes !== retained.windows.model)
      throw new Error(`${nightCfg.name}: control cell ${controlCell.codes.slice(0, 20)} is not the retained ${controlVariant} model windows ${retained.windows.model.slice(0, 20)}`);
    const rates = nightCfg.trace ? grid.timerRate : [0];
    const seen = new Set(['0/0/0']);
    const cells = [controlCell];
    const drops = nightCfg.trace ? (grid.dropMs ?? [0]) : [0];   // a dropped clock needs a frame trace
    for (const dropMs of drops) {
      for (const timerRate of rates) {
        for (const deltaMs of grid.deltaMs) {
          const key = `${deltaMs}/${timerRate}/${dropMs}`;
          if (seen.has(key)) continue;
          seen.add(key);
          cells.push(runCell(inputs, nightCfg, deltaMs, timerRate, dropMs));
        }
      }
    }
    const night = {
      name: nightCfg.name, run: nightCfg.run, night: nightCfg.night, seed: nightCfg.seed, originMs: nightCfg.originMs,
      hasTrace: !!nightCfg.trace, controlVariant, pressCount: inputs.pressCount,
      phone: nightCfg.phone, verdictCfg: sweepCfg.verdict,
      control: { deltaMs: 0, timerRate: 0, codes: controlCell.codes, modelResult: controlCell.modelResult, modelEndMs: controlCell.modelEndMs,
        retainedModelWindows: retained.windows.model, retainedEqual: true },
      cells,
    };
    night.cells = cells;                                    // coarse rows; deriveNight scores copies
    const coarseDerived = deriveNight(night);
    // refinement, predeclared: around this night's own best coarse cell
    const around = [];
    for (const c of [...refineCells(coarseDerived.best), ...refineRates(coarseDerived.best), ...refineDrops(coarseDerived.best)]) {
      const key = `${c.deltaMs}/${c.timerRate}/${c.dropMs ?? 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      around.push(c);
    }
    for (const c of around) cells.push(runCell(inputs, nightCfg, c.deltaMs, c.timerRate, c.dropMs ?? 0));
    night.derived = deriveNight(night);
    night.cells = night.derived.cells;                      // the scored rows are the record's rows
    const { cells: _scored, ...summary } = night.derived;
    night.derived = summary;
    night.refined = around.length;
    nights.push(night);
    console.log(`  ${nightCfg.name} seed ${nightCfg.seed}: control ${controlVariant} reproduced; ${cells.length} cells; ` +
      `best deltaMs ${night.derived.best.deltaMs} rate ${night.derived.best.timerRate} dropMs ${night.derived.best.dropMs ?? 0} ` +
      `agree ${night.derived.best.agree}/${night.derived.best.compared} ` +
      `(control ${night.derived.controlScore.agree}/${night.derived.controlScore.compared}); matches ${night.derived.matchCells.length}`);
  }
  if (!nights.length) throw new Error(`no configured night named ${only}`);
  const result = {
    schema: SCHEMA, claimLevel: 'MODEL_ONLY', fidelity: 'model',
    comparedWith: 'DEVICE_MEASURED phone reads and terminals, reused from the records each night names; no new phone run',
      question: 'Does the measured clock-origin and schedule-phase correction, alone or together, make the model agree with the phone window by window?',
    method: {
      sweepConfig: relative(ROOT, cfgPath), sweepConfigSha256: sha256(readFileSync(cfgPath)),
      nightsConfig: sweepCfg.nights, nightsConfigSha256: sha256(readFileSync(resolve(ROOT, sweepCfg.nights))),
      modelOptions: sweepCfg.modelOptions ?? nightsCfg.modelOptions,
      modelOptionsSha256: sha256(readFileSync(resolve(ROOT, sweepCfg.modelOptions ?? nightsCfg.modelOptions))),
      toolSha256: sha256(readFileSync(new URL(import.meta.url))),
      modelSourceSha256: Object.fromEntries(MODEL_SOURCES.map((path) => [path.slice(ROOT.length + 1), sha256(readFileSync(path))])),
      frames: MODEL_FRAMES,
      cellRule: 'presses by the sched rule on the update clock (image-pinned for a traced night, no landing latency), the whole schedule shifted by deltaMs; dropMs starts a rebuilt office clock at the first captured frame at or after that image time; timerRate r scales every office update timer delta by (1 + r)',
      refineRule: sweepCfg.refine.rule,
    },
    nights,
    limitations: [
      'Model-side sweep only: no rebuild run and no phone run; the rebuild shares the model side of every retained first disagreement, but a found cell is a candidate until confirmed in the rebuild.',
      'A uniform rate and a constant phase are one-parameter families, not a full timing topology: intermittent jank deficits, per-press jitter and lost contacts are not in this grid.',
      'deltaMs shifts the whole schedule, keeping the press file shape; the phone press stream itself was not changed.',
      'A night with no frame trace (twin-01) cannot separate press phase from timer rate and sweeps deltaMs only on a constant 60 Hz clock.',
      'Phone windows are the retained right-eyehole readers\' codes; they cannot see Balloon Boy, Mangle or the vent Toys, and full-04 window 3\'s occupant is unlabelled.',
      'Matching cells would be necessary, not sufficient, for equivalence: the outcome must also agree, and one night at one cell is not a trace-equivalence record.',
    ],
  };
  result.verdict = deriveVerdict(nights);
  const { evidenceId } = { evidenceId: `recompile-phone-clock-sweep-${sha256(JSON.stringify({ ...result, evidenceId: undefined })).slice(0, 16)}` };
  result.evidenceId = evidenceId;
  check(result);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === 'check') {
    const path = rest[0];
    if (!path) throw new Error('usage: check RESULT.json');
    const r = check(JSON.parse(readFileSync(path, 'utf8')));
    console.log(`${r.evidenceId}: ${r.status} over ${r.nights} nights; arithmetic rechecked`);
    process.exit(0);
  }
  const args = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--config', '--out', '--inputs-root', '--night'].includes(rest[i]) || !rest[i + 1]) throw new Error('see usage at top of file');
    args[rest[i].slice(2)] = rest[i + 1];
  }
  if (mode !== 'sweep' || !args.out) throw new Error('mode must be sweep with --out, or check RESULT.json');
  if (!args.out.endsWith('.json')) throw new Error('--out must be a .json path');
  const cfgPath = resolve(args.config ?? join(ROOT, 'packages/propose/bin/recompile/phone-clock-sweep.json'));
  const sweepCfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  if (sweepCfg.schema !== 'phone-clock-sweep-v1') throw new Error('sweep config schema must be phone-clock-sweep-v1');
  const inputsRoot = resolve(args.inputsRoot ?? ROOT);
  const result = sweep(sweepCfg, cfgPath, inputsRoot, args.night ?? null);
  writeFileSync(args.out, `${JSON.stringify(result, null, 1)}\n`);
  console.log(`${result.evidenceId}: ${result.verdict.status} (MODEL_ONLY model-side sweep vs retained phone reads)`);
  for (const n of result.nights) {
    console.log(`  ${n.name} seed ${n.seed}: best ${n.derived.best.agree}/${n.derived.best.compared} at deltaMs ${n.derived.best.deltaMs} rate ${n.derived.best.timerRate} dropMs ${n.derived.best.dropMs ?? 0}; ` +
      `control ${n.derived.controlScore.agree}/${n.derived.controlScore.compared}; matches ${JSON.stringify(n.derived.matchCells)}`);
  }
}
