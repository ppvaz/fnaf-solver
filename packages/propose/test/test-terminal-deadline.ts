#!/usr/bin/env node
// The night-terminal deadline, re-derived for every lane that can end a plan
// before the night ends (CLAUDE.md mistake register item 4: "Re-derive every
// deadline when a port crosses executors").
//
// On 2026-09-06 a 15 s terminal wait, right for the machine lane (its program
// blocked through the night), starved the artifact lane, whose schedule
// returned while the game clock trailed. Every executor now returns to one
// port, which watches for 6 AM or game over for NIGHT_TERMINAL_WAIT_MS after a
// plan ends without a terminal. So that one number has to answer for the
// committed plan that ends earliest, against the latest 6 AM measured.
//
// What is measured, and where: each won night's run pack holds its night onset
// (origin.anchor's host time plus its wall offset) and its first `state=sixam`
// observation, which the observer saw no earlier than 6 AM itself. Their
// difference less the 420 s night (Source's CLOCK) is the trail, an upper bound
// including the observer's poll. This file reads it from the packs every run,
// so the number that decides is not a comment.
//
// The gate: for every committed winner-v1 and night, the compiled plan's
// observeUntilMs (the HID schedule's plannedUntilMs) plus the port's wait
// stands above the night length plus the largest trail measured. A planted
// 2026-09-06 shape must fail first. In `npm run test:unit`.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nightLengthMs } from '@sixam/source';
import { CLOCK } from '@sixam/source/games/fnaf2/fnaf2.ts';
import { NIGHT_TERMINAL_WAIT_MS } from '../../play/src/campaign/modern-campaign-ports.ts';
import { compileBundle } from '../bin/plans/bundle.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const RUNS = join(ROOT, 'docs/evidence/runs');
const WINNERS = join(HERE, '../bindings/fnaf2');
const NIGHT_MS = nightLengthMs(CLOCK);
// A pack set this small or smaller measures nothing worth gating on.
const MIN_MEASURED = 20;

let failed = 0;
const fail = message => { failed += 1; console.error(`  FAIL ${message}`); };

/** The deficit, in ms, by which a lane stops watching before the latest measured 6 AM (> 0 fails). */
export const shortfallMs = ({ observeUntilMs, waitMs, trailMs }) => NIGHT_MS + trailMs - (observeUntilMs + waitMs);

// --- the trail, from the packs -----------------------------------------------
const trails = [];
for (const name of readdirSync(RUNS).filter(dir => /^night[1-7]-/.test(dir)).sort()) {
  let pack, rows;
  try {
    pack = JSON.parse(readFileSync(join(RUNS, name, 'pack.json'), 'utf8'));
    if (pack.outcome !== 'WIN') continue;
    rows = readFileSync(join(RUNS, name, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch { continue; }
  const anchor = rows.find(row => row.type === 'origin.anchor' && Number.isFinite(row.onsetHostMs) && Number.isFinite(row.wallMinusHostMs));
  const sixam = rows.find(row => row.type === 'observation' && row.label === 'state=sixam');
  if (!anchor || !sixam) continue;   // a recovered pack keeps no onset; it measures nothing here
  trails.push({ name, trailMs: Date.parse(sixam.at) - (anchor.onsetHostMs + anchor.wallMinusHostMs) - NIGHT_MS });
}
if (trails.length < MIN_MEASURED) fail(`only ${trails.length} won packs carry an onset and a 6 AM observation (need ${MIN_MEASURED})`);
const latest = trails.reduce((worst, row) => (worst === null || row.trailMs > worst.trailMs ? row : worst), null);
if (latest && latest.trailMs < 0) fail(`${latest.name}: 6 AM observed before the night's nominal end, so the onset or the clock is wrong`);
const trailMs = latest?.trailMs ?? Infinity;

// --- the planted violation: the 2026-09-06 shape ---------------------------
// A lane whose plan returns 60 s before the nominal end, behind a 15 s wait.
if (!(shortfallMs({ observeUntilMs: NIGHT_MS - 60000, waitMs: 15000, trailMs }) > 0))
  fail('the planted 2026-09-06 shape (a plan ending 60 s early behind a 15 s wait) was not refused');

// --- every committed plan, against the port's wait -------------------------
const scratch = mkdtempSync(join(tmpdir(), 'terminal-deadline-'));
let plans = 0;
let tightest = null;
try {
  for (const name of readdirSync(WINNERS).filter(file => file.endsWith('-winner.json')).sort()) {
    const winner = JSON.parse(readFileSync(join(WINNERS, name), 'utf8'));
    if (winner.schema !== 'winner-v1') continue;   // FNaF 1 routes run their own runner
    let built;
    try { built = compileBundle(winner, join(scratch, name)); }
    catch (error) { fail(`${name}: ${error.message}`); continue; }
    for (const plan of built.compiled) {
      const observeUntilMs = plan.timing?.observeUntilMs;
      if (!Number.isFinite(observeUntilMs)) { fail(`${name} night ${plan.night}: no observeUntilMs`); continue; }
      plans += 1;
      const short = shortfallMs({ observeUntilMs, waitMs: NIGHT_TERMINAL_WAIT_MS, trailMs });
      if (short > 0)
        fail(`${name} night ${plan.night}: the plan ends at ${observeUntilMs} ms and the port watches ${NIGHT_TERMINAL_WAIT_MS} ms ` +
          `more, ${Math.round(short)} ms before the latest measured 6 AM (${NIGHT_MS} + ${Math.round(trailMs)} ms, ${latest.name})`);
      if (tightest === null || -short < tightest.headroomMs) tightest = { name, night: plan.night, observeUntilMs, headroomMs: -short };
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
if (!plans) fail(`no winner-v1 plan was compiled from ${WINNERS}`);

if (failed) {
  console.error(`\nterminal deadline: ${failed} lane(s) stop watching before the night can end`);
  process.exit(1);
}
console.log(`terminal deadline: latest measured 6 AM ${(trailMs / 1000).toFixed(2)} s past the ${NIGHT_MS / 1000} s night ` +
  `(${trails.length} won packs, ${latest.name}); ${plans} committed plans plus the port's ${NIGHT_TERMINAL_WAIT_MS} ms wait ` +
  `cover it, the tightest ${tightest.name} night ${tightest.night} (ends ${tightest.observeUntilMs} ms) by ${Math.round(tightest.headroomMs)} ms`);
