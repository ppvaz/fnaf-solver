#!/usr/bin/env node
// A night's committed winners, scored at every frame phase around the one
// each binding declares -- and what knowing the seed would add.
//
// `winner-census.mjs` scores each binding at its declared phase only, where
// every one wins every seed. The phone does not deliver that phase exactly: an
// anchor aims it, and the aim, the helper's onset bias and the input latency
// leave an effective interval (fact-register.mjs ANCHOR_AIMS). This scans each
// binding at every frame step within +-windowMs of its declared epoch over a
// fixed block of held-out seeds and reports, per phase, how many seeds win.
//
// Two questions ride on it. Whether a night is decided by the phase or by the
// seed: a phase cell where every seed wins or every seed loses is decided by
// the phase alone. And what seed identification is worth to a controller that
// may choose among the night's committed bindings: the seed oracle wins a seed
// at a phase if ANY binding does, and its excess over the best single binding
// is the most knowing the seed could add within that family.
//
//   node tools/winner-phase-census.mjs --night 7 --count 1000 --window 1000 --jobs 7 --out FILE
//
// MODEL_ONLY, exact lane: the phase is the only thing moved.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FPS } from '@fnaf2-1020/core/mechanics';
import { STRATEGY_REGISTRY, compileBundle, validateWinner } from './device/bundle.mjs';
import { ANCHOR_AIMS } from './device/fact-register.mjs';
import { replay as replayToys } from './device/minus-toys-plan.mjs';
import { committedWinners, designBlock, forkBlocks, gitState } from './winner-census.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
export const PHASE_KIND = 'fnaf2-winner-phase-census-v1';
export const STEP_MS = 1000 / FPS;
// A phase cell some seeds win and some lose is where the seed matters; its
// losses are listed so a gate can replay them. Cells are few, lists short.
const MAX_LISTED_PARTIAL = 200;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** The first `count` seeds, ascending, that no tuning cohort reaches. */
export function heldOutSeeds(count) {
  const design = new Set(designBlock().seeds);
  const out = [];
  for (let seed = 0; out.length < count && seed < 0x10000; seed += 1) if (!design.has(seed)) out.push(seed);
  return out;
}

/** The night's phase-aware committed bindings, each with its declared epoch and replay knobs. */
export function nightBindings(night) {
  return committedWinners().map((path) => {
    const text = readFileSync(join(ROOT, path), 'utf8');
    const winner = validateWinner(JSON.parse(text));
    if (!winner.nights.includes(night) || !STRATEGY_REGISTRY[winner.strategy].phaseAware) return null;
    const emitted = STRATEGY_REGISTRY[winner.strategy].emit(winner, night);
    return { path, winnerSha256: sha256(text), planSha256: sha256(emitted.text), knobs: emitted.knobs,
      epochMs: (winner.anchorEpochMs ?? 0) + (winner.phaseOffsetMs ?? 0) };
  }).filter(Boolean);
}

/** One replay: does `binding` win `seed` with its epoch moved by `frame` frames? */
export function phaseWins(binding, night, seed, frame) {
  const r = replayToys({ night, seed, knobs: binding.knobs, epochMs: binding.epochMs + frame * STEP_MS });
  return { won: r.sim.won && r.splitAt >= 0, reason: r.sim.won ? 'unarmed' : (r.sim.death?.reason ?? 'alive'), frame: r.sim.frame };
}

/** Rows for seed indices [a, b): one per (binding, phase) and one per phase for the oracle. */
function phaseBlock(night, frames, count, a, b) {
  const seeds = heldOutSeeds(count).slice(a, b);
  const bindings = nightBindings(night);
  const rows = [];
  for (let f = -frames; f <= frames; f += 1) {
    const oracleLosses = [];
    const lost = bindings.map(() => []);
    for (const seed of seeds) {
      let any = false;
      bindings.forEach((binding, i) => {
        const r = phaseWins(binding, night, seed, f);
        if (r.won) any = true; else lost[i].push([seed, r.reason, r.frame]);
      });
      if (!any) oracleLosses.push([seed, 'no-binding', 0]);
    }
    bindings.forEach((binding, i) => rows.push({ subject: binding.path, f, n: seeds.length, losses: lost[i] }));
    rows.push({ subject: 'oracle', f, n: seeds.length, losses: oracleLosses });
  }
  return rows;
}

/** Contiguous runs of fully won phases, in the epoch the game sees. */
function wonBands(epochMs, frames, wins, n) {
  const bands = [];
  let open = null;
  for (let f = -frames; f <= frames; f += 1) {
    const full = wins[f + frames] === n;
    if (full && open === null) open = f;
    if (!full && open !== null) { bands.push([open, f - 1]); open = null; }
  }
  if (open !== null) bands.push([open, frames]);
  const at = (f) => +(epochMs + f * STEP_MS).toFixed(2);
  return bands.map(([a, b]) => ({ fromMs: at(a), toMs: at(b), frames: b - a + 1 }));
}

export function buildPhaseRecord({ rows, night, frames, count, bindings, winnerHashes, git, date, command }) {
  const width = 2 * frames + 1;
  const n = count;
  const series = (subject) => {
    const wins = new Array(width).fill(0);
    const partial = [];
    for (const row of rows.filter((r) => r.subject === subject)) {
      wins[row.f + frames] = row.n - row.losses.length;
      if (row.losses.length > 0 && row.losses.length < row.n)
        partial.push({ frame: row.f, losses: row.losses.slice(0, MAX_LISTED_PARTIAL), lost: row.losses.length });
    }
    return { wins, partial };
  };
  const oracle = series('oracle');
  const out = bindings.map((binding) => {
    const { wins, partial } = series(binding.path);
    const aim = ANCHOR_AIMS[winnerHashes[binding.path]];
    const effective = aim ? [aim.aimMs + (aim.onsetBiasMs ?? 0) + aim.latencyMs.min,
      aim.aimMs + (aim.onsetBiasMs ?? 0) + aim.latencyMs.max] : null;
    // Every frame phase whose epoch falls inside the effective interval.
    const inside = effective ? wins.map((w, i) => ({ w, ms: binding.epochMs + (i - frames) * STEP_MS }))
      .filter(({ ms }) => ms >= effective[0] && ms <= effective[1]) : [];
    return {
      binding: binding.path, winnerSha256: binding.winnerSha256, winnerHash: winnerHashes[binding.path],
      planSha256: binding.planSha256, declaredEpochMs: binding.epochMs,
      map: wins.map((w) => (w === n ? '#' : w === 0 ? '.' : '+')).join(''),
      wins, bands: wonBands(binding.epochMs, frames, wins, n), partial,
      anchor: aim ? { aimMs: aim.aimMs, effectiveMs: effective, refuted: aim.refuted ?? null,
        effectivePhasesWon: inside.every(({ w }) => w === n) && inside.length > 0, effectivePhases: inside.length } : null,
    };
  });
  const bestFixed = oracle.wins.map((_, i) => Math.max(...out.map((b) => b.wins[i])));
  const voi = oracle.wins.map((w, i) => w - bestFixed[i]);
  const cells = out.flatMap((b) => b.wins);
  const decided = cells.filter((w) => w === 0 || w === n).length;
  const differ = [];
  for (let x = 0; x < out.length; x += 1) for (let y = x + 1; y < out.length; y += 1) {
    if (out[x].declaredEpochMs !== out[y].declaredEpochMs) continue;
    const at = out[x].wins.map((w, i) => (w !== out[y].wins[i] ? i - frames : null)).filter((f) => f !== null);
    differ.push({ a: out[x].binding, b: out[y].binding, epochMs: out[x].declaredEpochMs, phasesThatDiffer: at });
  }
  const tag = (p) => p.replace(/^tools\/device\/|-winner\.json$/g, '');
  const answer = `Over ${n} held-out seeds at ${width} frame phases (+-${Math.round(frames * STEP_MS)} ms) per binding, ` +
    `${decided} of ${cells.length} (binding, phase) cells are decided by the phase alone (every seed wins or every ` +
    `seed loses). Knowing the seed and choosing among the ${out.length} bindings beats the best single binding at ` +
    `${voi.filter((v) => v > 0).length} of ${width} phases, by at most ${Math.max(...voi)} seeds. ` +
    differ.map((d) => `${tag(d.a)} and ${tag(d.b)} (both declared at ${d.epochMs} ms) differ at ` +
      `${d.phasesThatDiffer.length} phase(s)${d.phasesThatDiffer.length ? ` (frames ${d.phasesThatDiffer.join(', ')})` : ''}`).join('; ') + '. ' +
    out.filter((b) => b.anchor).map((b) => `${tag(b.binding)}'s effective interval [${b.anchor.effectiveMs.join(', ')}] ms ` +
      `${b.anchor.effectivePhasesWon ? 'lies inside a fully won band' : 'is not fully won'}`).join('; ') + '.';
  return {
    schema: 'evidence-record-v1', kind: PHASE_KIND, id: `fnaf2-night${night}-phase-census-${date.replace(/-/g, '')}`,
    claimLevel: 'MODEL_ONLY', date,
    question: `At every frame phase near each committed Night ${night} binding's declared epoch, does the seed or the ` +
      'phase decide the night, and what would identifying the seed add to a controller choosing among those bindings?',
    answer,
    whyItIsModelOnly: 'No device run. The exact lane with the whole schedule moved by whole frames; the phone ' +
      'delivers a phase the anchor aims but does not measure, and per-press lateness is not in this lane.',
    method: {
      tool: 'tools/winner-phase-census.mjs', command, git,
      seeds: { definition: `the first ${n} seeds, ascending, outside the design block (winner-census.mjs designBlock)`,
        n, sha256: sha256(JSON.stringify(heldOutSeeds(n))) },
      phases: { frames: width, stepMs: STEP_MS, windowMs: frames * STEP_MS,
        relativeTo: 'each binding\'s anchorEpochMs + phaseOffsetMs; map index i is frame i - window' },
      family: 'the night\'s committed phase-aware winner-v1 bindings; the oracle picks among them per seed',
      win: 'sim.won AND splitAt >= 0, as night7-presets.mjs and minus-toys-plan.mjs --gate score it',
    },
    bindings: out,
    oracle: { wins: oracle.wins, bestFixed, voi, maxVoi: Math.max(...voi), phasesWithVoi: voi.filter((v) => v > 0).length },
    pairs: differ,
  };
}

async function main(argv) {
  if (argv[0] === '--child') {
    const [, a, b, night, frames, count] = argv;
    process.send(phaseBlock(Number(night), Number(frames), Number(count), Number(a), Number(b)));
    return;
  }
  const flag = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i < 0 ? dflt : argv[i + 1]; };
  const night = Number(flag('night', '7'));
  const count = Number(flag('count', '1000'));
  const windowMs = Number(flag('window', '1000'));
  const jobs = Number(flag('jobs', '1'));
  const frames = Math.round(windowMs / STEP_MS);
  for (const [k, v] of Object.entries({ night, count, windowMs, jobs }))
    if (!Number.isInteger(v) || v < 1) throw new Error(`winner-phase-census: --${k} must be a positive integer`);
  const bindings = nightBindings(night);
  if (bindings.length === 0) throw new Error(`winner-phase-census: no phase-aware committed winner plays night ${night}`);
  const scratch = mkdtempSync(join(tmpdir(), 'winner-phase-census-'));
  const winnerHashes = {};
  try {
    for (const { path } of bindings)
      winnerHashes[path] = compileBundle(JSON.parse(readFileSync(join(ROOT, path), 'utf8')),
        join(scratch, path.replace(/\//g, '_'))).manifest.winnerHash;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  const started = Date.now();
  const rows = await forkBlocks({ script: fileURLToPath(import.meta.url),
    args: [String(night), String(frames), String(count)], start: 0, count, jobs });
  const record = buildPhaseRecord({ rows, night, frames, count, bindings, winnerHashes, git: gitState(),
    date: flag('date', new Date().toISOString().slice(0, 10)),
    command: `node tools/winner-phase-census.mjs --night ${night} --count ${count} --window ${windowMs} --jobs ${jobs}` });
  record.method.wallSeconds = Math.round((Date.now() - started) / 1000);
  const text = `${JSON.stringify(record, null, 2)}\n`;
  const out = flag('out', null);
  if (out) writeFileSync(out, text); else process.stdout.write(text);
  for (const b of record.bindings) console.error(`  ${b.binding.replace(/^tools\/device\/|-winner\.json$/g, '').padEnd(24)} ${b.map}`);
  console.error(`winner phase census: ${record.answer}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
