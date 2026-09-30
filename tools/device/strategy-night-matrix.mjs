#!/usr/bin/env node
// Which strategy can be played on which night, as a measured matrix.
//
// The repo has always answered this one cell at a time. Every committed winner
// is minus-toys, every manifest names a single `canonicalNights`, and the
// device lane grew around whatever happened to be winning -- so "can Minus 3
// play Night 6?" or "can Minus 7 play Night 2?" had no answer anywhere, and
// the absence looked like a no rather than an unasked question.
//
// Two different things are reported per cell, because they fail for different
// reasons and a single verdict hides that:
//
//   EMIT     the strategy's registered emitter produces a plan for that night,
//            AND artifact-commands.mjs compiles it against the resolved device
//            profile. This is a DEVICE question: it fails on a control the
//            profile cannot actuate, a contact under the floor, or a press
//            inside an animation the engine drops it during.
//   MODEL    the emitted plan's own replay, over a seed cohort. This is a
//            STRATEGY question: it fails when the route does not answer the
//            night's roster.
//
// A cell can compile and still lose every seed (minus7 on Night 7: the plan is
// legal, Foxy ends it), and a cell can score perfectly and be unrunnable (any
// minus7 night whose model reaches the `attack` branch: the device executor
// cannot branch, so the plan has no faithful single-cycle form).
//
// Usage:
//   node tools/device/strategy-night-matrix.mjs [--runs 3000] [--structural] [--json]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileArtifactPlans } from '../../packages/propose/bin/plans/artifact-commands.mjs';
import { parsePlan, validateWinner, STRATEGY_REGISTRY } from '../../packages/propose/bin/plans/bundle.mjs';
import * as C from '@sixam/source/fnaf2';

const HERE = dirname(fileURLToPath(import.meta.url));
const NIGHTS = [1, 2, 3, 4, 5, 6, 7];

// What each strategy's own mechanism actually holds, from STRATEGY-HISTORY.md:
// Minus 3 "keeps Parts/Service selected all night, so the three stallable
// Withereds never leave"; Minus Toys is "the glitch aimed at CAM 09 instead,
// freezing the three Toys"; Minus 7's "three-camera flash sweep holds all seven
// stallable animatronics forever" -- the roster less Foxy, Balloon Boy and
// Golden Freddy, who are the three nothing stalls.
//
// This column exists because a win rate alone hides whether a strategy is even
// addressing the night it scores on. Minus Toys scores 3000/3000 on Night 3,
// but Night 3 arms toybonnie at AI 1 and toychica at AI 1 and does not arm
// toyfreddy at all, so its CAM 09 stall is holding almost nothing there and the
// score is coming from the mask cadence instead. On 2026-09-19 that mattered:
// three Night 3 device runs died across two strategies, at least two to Balloon
// Boy, who no stall in this table covers on any night.
const WITHEREDS = Object.freeze(['withfreddy', 'withbonnie', 'withchica']);
const TOYS = Object.freeze(['toyfreddy', 'toybonnie', 'toychica']);
const UNSTALLABLE = Object.freeze(['foxy', 'bb', 'golden']);
const ROSTER = Object.freeze([...WITHEREDS, ...TOYS, 'mangle', ...UNSTALLABLE]);
const STALLS = Object.freeze({
  'minus-toys': TOYS,
  minus3: WITHEREDS,
  minus7: ROSTER.filter(id => !UNSTALLABLE.includes(id)),
});

function stallCoverage(strategy, night) {
  const armed = ROSTER.filter(id => C.peakAi(night, id) > 0);
  const held = armed.filter(id => (STALLS[strategy] ?? []).includes(id));
  return { armed, held, loose: armed.filter(id => !held.includes(id)) };
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
};

// A night-7 minus3 winner must name the Custom Night dial vector it was gated
// on; 10/20 is the only vector this matrix asks about.
const DIALS_10_20 = Object.freeze({
  withfreddy: 20, withbonnie: 20, withchica: 20, foxy: 20, toyfreddy: 20,
  toybonnie: 20, toychica: 20, mangle: 20, bb: 20, golden: 20,
});

function probeWinner(strategy, night) {
  return {
    schema: 'winner-v1', strategy,
    knobs: strategy === 'minus7' ? {} : 'KNOBS0',
    nights: [night], seeds: [1],
    engineHash: `${strategy}-matrix-probe-v1`, profile: 'hid-mediaprojection',
    // The matrix asks whether a cell CAN be emitted, so it supplies the
    // declarations an emitter refuses without. It never supplies a gate
    // result: `status` here is a probe, and no cell in this table is a
    // promotion or a route claim.
    ...(strategy === 'minus3' && night === 7 ? { dials: DIALS_10_20 } : {}),
    attackFreeEvidence: 'strategy-night-matrix probe',
    gate: { status: 'PASS', claimLevel: 'MODEL_ONLY' },
  };
}

const profile = JSON.parse(readFileSync(
  join(HERE, '../../apps/device/profiles/hid-mediaprojection.json'), 'utf8'));

export function probeCell(strategy, night, { runs = 0 } = {}) {
  const cell = { strategy, night, emit: null, emitReason: null, model: null, modelReason: null,
    stall: stallCoverage(strategy, night) };
  let emitted;
  try {
    emitted = STRATEGY_REGISTRY[strategy].emit(validateWinner(probeWinner(strategy, night)), night);
  } catch (error) { cell.emit = false; cell.emitReason = error.message; return cell; }
  try {
    compileArtifactPlans([{ night, policy: strategy, text: emitted.text }], parsePlan, profile);
    cell.emit = true;
  } catch (error) { cell.emit = false; cell.emitReason = error.message; }
  if (!runs) return cell;
  try {
    let wins = 0;
    const losses = new Map();
    for (let seed = 1; seed <= runs; seed += 1) {
      const { sim } = emitted.replay(seed);
      if (sim.won) { wins += 1; continue; }
      const reason = sim.death?.reason ?? 'unknown';
      losses.set(reason, (losses.get(reason) ?? 0) + 1);
    }
    const top = [...losses.entries()].sort((a, b) => b[1] - a[1])[0];
    cell.model = { wins, runs, topKiller: top ? { killer: top[0], count: top[1] } : null };
  } catch (error) { cell.modelReason = error.message; }
  return cell;
}

const runs = process.argv.includes('--structural') ? 0 : Number(arg('runs', 3000));
const strategies = Object.keys(STRATEGY_REGISTRY);
const cells = [];
for (const strategy of strategies)
  for (const night of NIGHTS) cells.push(probeCell(strategy, night, { runs }));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ schema: 'strategy-night-matrix-v1', runs, cells }, null, 2));
} else {
  const label = cell => {
    if (cell.emit === false) return 'no-emit';
    // A reached-but-dropped branch is structural, not a replay failure: the
    // device executor cannot branch, so that night has no single-cycle form.
    if (cell.modelReason) return /attack branch/.test(cell.modelReason) ? 'branch' : 'no-replay';
    if (!cell.model) return 'emits';
    const { wins, runs: n } = cell.model;
    return `${wins}/${n}`;
  };
  process.stdout.write(`strategy x night${runs ? ` (${runs} seeds)` : ' (structural only)'}\n`);
  process.stdout.write(`${''.padEnd(14)}${NIGHTS.map(n => `N${n}`.padStart(12)).join('')}\n`);
  for (const strategy of strategies) {
    const row = NIGHTS.map(night =>
      label(cells.find(c => c.strategy === strategy && c.night === night)).padStart(12)).join('');
    process.stdout.write(`${strategy.padEnd(14)}${row}\n`);
  }
  process.stdout.write('\nwhat each strategy\'s own stall holds, of what the night arms:\n');
  process.stdout.write(`${''.padEnd(14)}${NIGHTS.map(n => `N${n}`.padStart(12)).join('')}\n`);
  for (const strategy of strategies) {
    const row = NIGHTS.map(night => {
      const s = cells.find(c => c.strategy === strategy && c.night === night).stall;
      return `${s.held.length}/${s.armed.length}`.padStart(12);
    }).join('');
    process.stdout.write(`${strategy.padEnd(14)}${row}\n`);
  }
  process.stdout.write('\nwho each strategy leaves moving (armed, not held by its stall):\n');
  for (const strategy of strategies) {
    for (const night of NIGHTS) {
      const s = cells.find(c => c.strategy === strategy && c.night === night).stall;
      if (!s.armed.length) continue;
      process.stdout.write(`  ${strategy} N${night}: ${s.loose.join(', ') || 'nothing'}\n`);
    }
  }

  process.stdout.write('\nwhy a cell cannot be emitted:\n');
  const seen = new Set();
  for (const cell of cells) {
    if (cell.emit !== false) continue;
    const key = `${cell.strategy}:${cell.emitReason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    process.stdout.write(`  ${cell.strategy} N${cell.night}: ${cell.emitReason}\n`);
  }
  for (const cell of cells) {
    if (!cell.modelReason) continue;
    process.stdout.write(`  ${cell.strategy} N${cell.night} replay: ${cell.modelReason}\n`);
  }
}
