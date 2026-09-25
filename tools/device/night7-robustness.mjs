#!/usr/bin/env node
// Which Night 7 route keeps the widest timing margin, on the two axes the
// phone actually moves: the phase the whole schedule is delivered at, and the
// lateness of each press.
//
// S5 starts from the route that maximises the worst-case timing margin. Every
// candidate here wins 10/20 on every seed at its own declared phase
// (winner-census.mjs), so the seed does not separate them; the margins do.
// For each schedule -- the preset schedule the ten-preset sweep uses (epoch 0,
// never run on the phone) and each committed Night 7 binding at its anchor --
// this measures, over held-out seeds:
//
//   phase     every frame phase within +-windowMs of the declared epoch; the
//             fully won band around it and its margins to the delivered
//             interval (the anchor register's effective interval, or the
//             declared epoch for a schedule with no anchor);
//   lateness  each press delivered late by a draw from [0, L] through
//             actuator.mjs (queue serialized, mask seam modelled), for L in
//             LATENESS_MS; the largest L up to which every seed still wins;
//   human     the human gate's +-60 ms per press: the epoch 60 ms early and
//             lateness drawn from [0, 120], the same spread.
//
//   node tools/device/night7-robustness.mjs --count 300 --jobs 7 --out FILE
//
// MODEL_ONLY. The actuator's lateness is independent per press, which is not
// how the phone's displacement is shaped (night7-preset-sweep-20260917's
// measuredDeviceNumber); read the lateness column as a comparison between
// routes, not as a prediction of a cohort.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FPS } from '@fnaf2-1020/core/mechanics';
import { compileBundle } from './bundle.mjs';
import { ANCHOR_AIMS } from './fact-register.mjs';
import { runNight, loadPresets, PRESET_KNOBS } from './night7-presets.mjs';
import { forkBlocks, gitState } from '../winner-census.mjs';
import { heldOutSeeds, nightBindings } from '../winner-phase-census.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
export const ROBUSTNESS_KIND = 'night7-robustness-v1';
export const LATENESS_MS = Object.freeze([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150]);
export const HUMAN_MS = 60;
export const PHASE_FRAMES = 30;
const STEP_MS = 1000 / FPS;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const tag = (path) => path.replace(/^tools\/device\/campaign-night7-|-winner\.json$/g, '');

/** The preset schedule and every committed phase-aware Night 7 binding. */
export function schedules() {
  return [
    { id: 'preset', knobs: PRESET_KNOBS, epochMs: 0, knobsSha256: sha256(JSON.stringify(PRESET_KNOBS)) },
    ...nightBindings(7).map((b) => ({ id: tag(b.path), path: b.path, knobs: b.knobs, epochMs: b.epochMs,
      winnerSha256: b.winnerSha256 })),
  ];
}

const tenTwenty = () => loadPresets().find((p) => p.id === 'golden-freddy');

/** One night: does `schedule` win `seed` with its epoch moved and presses late by up to `lateMs`? */
export function robustWins(schedule, seed, { frame = 0, lateMs = 0, earlyMs = 0, preset = tenTwenty() } = {}) {
  const r = runNight({ preset, seed, knobs: schedule.knobs, epochMs: schedule.epochMs + frame * STEP_MS - earlyMs,
    band: lateMs > 0 ? [0, lateMs] : null });
  return { won: r.sim.won && r.splitAt >= 0, reason: r.sim.won ? 'unarmed' : (r.sim.death?.reason ?? 'alive'), frame: r.sim.frame };
}

function block(count, from, to) {
  const seeds = heldOutSeeds(count).slice(from, to);
  const preset = tenTwenty();
  const rows = [];
  const push = (subject, test) => {
    const losses = [];
    for (const seed of seeds) {
      const r = test(seed);
      if (!r.won) losses.push([seed, r.reason, r.frame]);
    }
    rows.push({ subject, n: seeds.length, losses });
  };
  for (const s of schedules()) {
    for (let f = -PHASE_FRAMES; f <= PHASE_FRAMES; f += 1) push(`${s.id}|phase|${f}`, (seed) => robustWins(s, seed, { frame: f, preset }));
    for (const L of LATENESS_MS) push(`${s.id}|late|${L}`, (seed) => robustWins(s, seed, { lateMs: L, preset }));
    push(`${s.id}|human|${HUMAN_MS}`, (seed) => robustWins(s, seed, { earlyMs: HUMAN_MS, lateMs: 2 * HUMAN_MS, preset }));
  }
  return rows;
}

export function buildRobustnessRecord({ rows, count, winnerHashes, git, date, command }) {
  const out = schedules().map((s) => {
    const row = (axis, value) => rows.find((r) => r.subject === `${s.id}|${axis}|${value}`);
    const wins = (r) => r.n - r.losses.length;
    const phaseWins = [];
    for (let f = -PHASE_FRAMES; f <= PHASE_FRAMES; f += 1) phaseWins.push(wins(row('phase', f)));
    const at = (f) => +(s.epochMs + f * STEP_MS).toFixed(2);
    const aim = s.path ? ANCHOR_AIMS[winnerHashes[s.path]] : null;
    const delivered = aim
      ? [aim.aimMs + (aim.onsetBiasMs ?? 0) + aim.latencyMs.min, aim.aimMs + (aim.onsetBiasMs ?? 0) + aim.latencyMs.max]
      : [s.epochMs, s.epochMs];
    // The fully won run of frames containing the delivered interval, if one does.
    const inside = (f) => at(f) >= delivered[0] - STEP_MS / 2 && at(f) <= delivered[1] + STEP_MS / 2;
    const full = (f) => phaseWins[f + PHASE_FRAMES] === count;
    const covering = [];
    for (let f = -PHASE_FRAMES; f <= PHASE_FRAMES; f += 1) if (inside(f)) covering.push(f);
    let band = null;
    if (covering.length && covering.every(full)) {
      let lo = Math.min(...covering); let hi = Math.max(...covering);
      while (lo - 1 >= -PHASE_FRAMES && full(lo - 1)) lo -= 1;
      while (hi + 1 <= PHASE_FRAMES && full(hi + 1)) hi += 1;
      band = { fromMs: at(lo), toMs: at(hi), earlyMarginMs: +(delivered[0] - at(lo)).toFixed(2),
        lateMarginMs: +(at(hi) - delivered[1]).toFixed(2), reachesWindowEdge: lo === -PHASE_FRAMES || hi === PHASE_FRAMES };
    }
    const lateness = Object.fromEntries(LATENESS_MS.map((L) => [L, wins(row('late', L))]));
    let maxLateMs = null;
    for (const L of LATENESS_MS) { if (lateness[L] === count) maxLateMs = L; else break; }
    const firstLoss = LATENESS_MS.find((L) => lateness[L] < count);
    const human = row('human', HUMAN_MS);
    return {
      id: s.id, binding: s.path ?? null, declaredEpochMs: s.epochMs,
      ...(s.path ? { winnerSha256: s.winnerSha256, winnerHash: winnerHashes[s.path] } : { knobsSha256: s.knobsSha256 }),
      deliveredMs: delivered, deliveredFrom: aim ? 'ANCHOR_AIMS effective interval' : 'declared epoch (no anchor)',
      anchorRefuted: aim?.refuted ?? null,
      phase: { map: phaseWins.map((w) => (w === count ? '#' : w === 0 ? '.' : '+')).join(''), band },
      lateness: { wins: lateness, maxAllWinMs: maxLateMs,
        firstLoss: firstLoss === undefined ? null : { lateMs: firstLoss, losses: row('late', firstLoss).losses.slice(0, 20) } },
      human: { pmMs: HUMAN_MS, wins: wins(human), n: human.n, losses: human.losses.slice(0, 20) },
    };
  });
  const minPhase = (s) => (s.phase.band ? Math.min(s.phase.band.earlyMarginMs, s.phase.band.lateMarginMs) : -Infinity);
  const byLate = [...out].sort((a, b) => (b.lateness.maxAllWinMs ?? -1) - (a.lateness.maxAllWinMs ?? -1));
  const byPhase = [...out].sort((a, b) => minPhase(b) - minPhase(a));
  const answer = out.map((s) => `${s.id}: lateness to ${s.lateness.maxAllWinMs ?? 'none'} ms, ` +
    `phase margin ${s.phase.band ? `${s.phase.band.earlyMarginMs}/${s.phase.band.lateMarginMs} ms` : 'none (delivered interval not fully won)'}, ` +
    `human +-${HUMAN_MS} ${s.human.wins}/${s.human.n}`).join('; ') +
    `. Widest lateness tolerance: ${byLate[0].id}; widest phase margin: ${byPhase[0].id}.`;
  return {
    schema: 'evidence-record-v1', kind: ROBUSTNESS_KIND, id: `night7-robustness-${date.replace(/-/g, '')}`,
    claimLevel: 'MODEL_ONLY', date,
    question: 'Among the preset schedule and the committed Night 7 bindings, which keeps the widest timing margin at ' +
      '10/20 -- against the phase the schedule is delivered at, and against per-press lateness?',
    answer,
    whyItIsModelOnly: 'No device run. The lateness axis is actuator.mjs\'s independent per-press draw, not the phone\'s ' +
      'measured displacement shape; the phase axis moves the whole schedule by whole frames. A comparison between routes.',
    method: {
      tool: 'tools/device/night7-robustness.mjs', command, git,
      seeds: { definition: `the first ${count} seeds outside the design block (winner-phase-census.mjs heldOutSeeds)`,
        n: count, sha256: sha256(JSON.stringify(heldOutSeeds(count))) },
      night: '10/20 (golden-freddy: every dial at 20, clamped)',
      phase: { frames: 2 * PHASE_FRAMES + 1, stepMs: STEP_MS, relativeTo: 'each schedule\'s declared epoch; map index i is frame i - window' },
      lateness: { ms: LATENESS_MS, lane: 'DeviceActuator lateMinMs 0, lateMaxMs L: per-press, queue serialized, mask seam modelled' },
      human: `+-${HUMAN_MS} ms per press: epoch - ${HUMAN_MS} ms and lateness [0, ${2 * HUMAN_MS}]`,
      win: 'sim.won AND splitAt >= 0',
    },
    schedules: out,
    ranking: { lateness: byLate.map((s) => s.id), phaseMargin: byPhase.map((s) => s.id) },
  };
}

async function main(argv) {
  if (argv[0] === '--child') {
    const [, from, to, count] = argv;
    process.send(block(Number(count), Number(from), Number(to)));
    return;
  }
  const flag = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i < 0 ? dflt : argv[i + 1]; };
  const count = Number(flag('count', '300'));
  const jobs = Number(flag('jobs', '1'));
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(jobs) || jobs < 1)
    throw new Error('night7-robustness: --count and --jobs must be positive integers');
  const scratch = mkdtempSync(join(tmpdir(), 'night7-robustness-'));
  const winnerHashes = {};
  try {
    for (const s of schedules().filter((x) => x.path))
      winnerHashes[s.path] = compileBundle(JSON.parse(readFileSync(join(ROOT, s.path), 'utf8')),
        join(scratch, s.path.replace(/\//g, '_'))).manifest.winnerHash;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  const started = Date.now();
  const rows = await forkBlocks({ script: fileURLToPath(import.meta.url), args: [String(count)], start: 0, count, jobs });
  const record = buildRobustnessRecord({ rows, count, winnerHashes, git: gitState(),
    date: flag('date', new Date().toISOString().slice(0, 10)),
    command: `node tools/device/night7-robustness.mjs --count ${count} --jobs ${jobs}` });
  record.method.wallSeconds = Math.round((Date.now() - started) / 1000);
  const text = `${JSON.stringify(record, null, 2)}\n`;
  const out = flag('out', null);
  if (out) writeFileSync(out, text); else process.stdout.write(text);
  for (const s of record.schedules) console.error(`  ${s.id.padEnd(7)} ${s.phase.map}  late<=${s.lateness.maxAllWinMs} human ${s.human.wins}/${s.human.n}`);
  console.error(`night7 robustness: ${record.answer}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
