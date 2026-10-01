#!/usr/bin/env node
// Which office RNG start state reproduces a phone night's mask windows? (ROADMAP S2, diagnostic sweep)
//
//   node packages/propose/bin/recompile/phone-stream-census.mjs --night full-06 --predeclaration FILE
//     [--workers 6] [--out FILE.json]
//
// The explanation it tests is named by the predeclaration: the phone's office stream started at a state other
// than the night's measured seed (a wrong seed, or a constant startup draw offset), while the model's mechanics and
// the landed inputs are right. Every one of the 65,536 start states is replayed through the production Sim on the
// night's own measured clock and landed contacts (phone-encounter-replay.mjs's prepare(), the primary variant),
// and its mask-window codes are scored against the phone's eyehole reads with the replay tool's own windowCodes and
// scoreWindows. Stage 1 plays every state through the predeclared number of windows; stage 2 plays every state whose
// agreeing prefix reaches the predeclared floor through the whole night. The decision rule is the predeclaration's,
// applied here verbatim; this file never chooses a threshold. MODEL_ONLY: a state that fits is a hypothesis about
// the phone, not a measurement of it.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cumulative, loadConfig, maskPresses, prepare, scoreWindows, windowCodes, WINDOW_MS } from './phone-encounter-replay.mjs';
import { LEDGERS } from './compare-schedule-replay.mjs';
import { modelContacts } from './schedule-to-input.mjs';
import { drawTrace } from '../../../source/recompile/model-draw-trace.mjs';
import { currentPath } from '@sixam/review/renamed-path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CONFIG = 'packages/propose/bin/recompile/phone-encounter-nights.json';
export const SCHEMA = 'phone-stream-census-v1';
export const STATES = 0x10000;
const CODE = { withbonnie: 'B', withchica: 'C', withfreddy: 'F', toybonnie: 'b', toychica: 'c', toyfreddy: 'f', mangle: 'M', bb: 'x' };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const current = (path) => currentPath(ROOT, path);

/** Everything a worker needs to replay one start state, derived once from the config and its hashed inputs. */
export function inputs(nightName) {
  const cfg = loadConfig(join(ROOT, CONFIG));
  const night = cfg.nights.find((n) => n.name === nightName);
  if (!night) throw new Error(`no night ${nightName} in ${CONFIG}`);
  const p = prepare(cfg, night, night.primaryVariant, ROOT);
  const modelOptions = JSON.parse(readFileSync(resolve(ROOT, current(cfg.modelOptions)), 'utf8'));
  const customNight = night.customNight ? JSON.parse(readFileSync(resolve(ROOT, current(night.customNight)), 'utf8')) : null;
  return {
    name: night.name, night: night.night, measuredSeed: night.seed, variant: night.primaryVariant,
    phone: night.phone.windows, contacts: modelContacts(p.mapped.contacts), queue: p.mapped.queue,
    deltas: p.deltas, modelOptions, customNight,
    hashes: { config: sha256(readFileSync(join(ROOT, CONFIG))), modelOptions: sha256(JSON.stringify(modelOptions)),
      contacts: sha256(JSON.stringify(modelContacts(p.mapped.contacts))), frameTimes: p.frameTimesText ? sha256(p.frameTimesText) : null },
  };
}

/** One start state through `windows` mask windows (all of them when null): its codes and score against the phone. */
export function playState(inp, state, windows = null) {
  const presses = maskPresses(inp.queue);
  const ons = presses.filter(({ i }) => i % 2 === 0);
  const frames = windows === null || windows >= ons.length ? 40000 : ons[windows].tick;
  const observe = (sim) => ({ mask: LEDGERS.mask.model(sim), unit: sim.blackout.active ? sim.blackout.unitId : null });
  const run = drawTrace({ night: inp.night, seed: state, frames, modelOptions: inp.modelOptions,
    ...(inp.customNight ? { customNight: inp.customNight } : {}), contacts: inp.contacts, observe, frameTimes: inp.deltas });
  const cum = cumulative(inp.deltas, Math.max(frames, run.out.length) + 2);
  const at = (u) => { const o = run.observed[u + 1]; return o ? { maskValue: o.mask, occupant: o.unit ? (CODE[o.unit] ?? '?') : null } : null; };
  const codes = windowCodes(presses, at, cum, cum[run.out.length - 1], { windowMs: WINDOW_MS }).map((w) => w.code).join('');
  const phone = windows === null ? inp.phone : inp.phone.slice(0, windows);
  const score = scoreWindows(phone, codes);
  const prefix = score.firstDisagreement === null ? phone.length : score.firstDisagreement.window;
  return { state, codes: codes.slice(0, phone.length), prefix, agree: score.agree, compared: score.compared,
    outcome: run.won ? '6am' : run.death ? `death:${run.death.reason}@${run.death.t ?? '?'}` : 'alive' };
}

function pool(nightName, states, windows, workers) {
  const chunks = Array.from({ length: workers }, (_, w) => states.filter((_, k) => k % workers === w));
  return Promise.all(chunks.filter((c) => c.length).map((chunk) => new Promise((done, fail) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { nightName, states: chunk, windows } });
    worker.on('message', done); worker.on('error', fail);
    worker.on('exit', (code) => { if (code) fail(new Error(`census worker exited ${code}`)); });
  }))).then((parts) => parts.flat().sort((a, b) => a.state - b.state));
}

const histogram = (rows) => rows.reduce((h, r) => { h[r.prefix] = (h[r.prefix] ?? 0) + 1; return h; }, {});

/** The predeclared rule over stage-2 rows: IDENTIFIED, MEASURED_SEED_BEST or INCONCLUSIVE, with its reason. */
export function decide(rule, measuredSeed, full) {
  const ranked = [...full].sort((a, b) => b.prefix - a.prefix || b.agree - a.agree || a.state - b.state);
  const [best, second] = ranked;
  if (!best) return { verdict: 'INCONCLUSIVE', reason: 'no state reached stage 2' };
  const margin = best.prefix - (second?.prefix ?? 0);
  if (best.state !== measuredSeed && margin >= rule.identifyMarginWindows && best.prefix >= rule.identifyMinPrefix)
    return { verdict: 'IDENTIFIED', state: best.state, prefix: best.prefix, margin,
      reason: `state ${best.state} agrees through window ${best.prefix}, ${margin} windows past any other state` };
  const measured = full.find((r) => r.state === measuredSeed);
  if (measured && measured.prefix >= best.prefix)
    return { verdict: 'MEASURED_SEED_BEST', state: measuredSeed, prefix: measured.prefix,
      reason: `no start state agrees with the phone longer than the measured seed (${measured.prefix} windows)` };
  return { verdict: 'INCONCLUSIVE', best: best.state, prefix: best.prefix, margin,
    reason: `best state ${best.state} at ${best.prefix} windows, margin ${margin}: below the predeclared identification rule` };
}

async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--night', '--predeclaration', '--workers', '--out'].includes(argv[i]) || !argv[i + 1]) throw new Error('see usage at top of file');
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.night || !args.predeclaration) throw new Error('--night and --predeclaration are required');
  const preBytes = readFileSync(args.predeclaration);
  const pre = JSON.parse(preBytes.toString('utf8'));
  const rule = pre.decisionRule;
  if (pre.night !== args.night || !Number.isInteger(rule?.stage1Windows) || !Number.isInteger(rule?.stage2MinPrefix))
    throw new Error('the predeclaration must name this night and its stage1Windows / stage2MinPrefix rule');
  const inp = inputs(args.night);
  for (const [k, v] of Object.entries(pre.inputs ?? {})) if (inp.hashes[k] !== v) throw new Error(`input ${k} changed since the predeclaration`);
  const workers = Number(args.workers ?? Math.max(1, Math.min(6, cpus().length - 2)));
  const all = Array.from({ length: STATES }, (_, s) => s);
  const t0 = Date.now();
  const stage1 = await pool(args.night, all, rule.stage1Windows, workers);
  const survivors = stage1.filter((r) => r.prefix >= rule.stage2MinPrefix).map((r) => r.state);
  if (!survivors.includes(inp.measuredSeed)) survivors.push(inp.measuredSeed);
  const stage2 = await pool(args.night, survivors, null, workers);
  const decision = decide(rule, inp.measuredSeed, stage2);
  const measured1 = stage1.find((r) => r.state === inp.measuredSeed);
  const result = {
    schema: SCHEMA, claimLevel: 'MODEL_ONLY', night: args.night, variant: inp.variant, measuredSeed: inp.measuredSeed,
    predeclaration: { path: args.predeclaration, sha256: sha256(preBytes), id: pre.id },
    inputs: inp.hashes, phoneWindows: inp.phone,
    stage1: { windows: rule.stage1Windows, states: stage1.length, prefixHistogram: histogram(stage1),
      measuredSeed: measured1, atLeastMeasured: stage1.filter((r) => r.prefix >= measured1.prefix).length },
    stage2: { minPrefix: rule.stage2MinPrefix, states: stage2.length,
      rows: [...stage2].sort((a, b) => b.prefix - a.prefix || b.agree - a.agree || a.state - b.state) },
    decision, elapsedMs: Date.now() - t0,
  };
  const text = `${JSON.stringify(result, null, 1)}\n`;
  if (args.out) writeFileSync(args.out, text);
  console.log(`${args.night}: stage 1 ${stage1.length} states x ${rule.stage1Windows} windows, prefix histogram ${JSON.stringify(result.stage1.prefixHistogram)}`);
  console.log(`  measured seed ${inp.measuredSeed}: prefix ${measured1.prefix} (${result.stage1.atLeastMeasured} states at least as long); stage 2 ${stage2.length} states`);
  for (const r of result.stage2.rows.slice(0, 10)) console.log(`  ${String(r.state).padStart(5)} prefix ${r.prefix} agree ${r.agree}/${r.compared} ${r.codes} ${r.outcome}`);
  console.log(`  ${decision.verdict}: ${decision.reason}`);
}

if (!isMainThread) {
  const { nightName, states, windows } = workerData;
  const inp = inputs(nightName);
  parentPort.postMessage(states.map((s) => playState(inp, s, windows)));
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
