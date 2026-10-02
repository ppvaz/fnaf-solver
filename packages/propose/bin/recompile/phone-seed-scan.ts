#!/usr/bin/env node
// Every office seed of a traced phone night replayed from its first update against the night's native static readout
// (ROADMAP S2a/S4: the seed read in-night, at any dials). EXPLORATORY until a predeclaration names it.
//
//   node packages/propose/bin/recompile/phone-seed-scan.ts --night-inputs INPUTS.json --spec SPEC.json [--workers N]
//       [--from S --to S] [--out FILE]
//
// At 10/20 a window's draws depend on game state, so a generator state cannot be injected per window
// (phone-region-readout.ts does that at every dial 0): each seed is replayed through the production Sim from update 0
// on the night's measured clock (the frame trace's image clock with Fusion's catch-up, phone-encounter-replay.ts
// officeClock) with the binding's presses on the updates that drew their landing frames (the night's median monitor
// landing latency, as the encounter replays do). The readout's frames carry the same Image timestamps as the trace's
// rows, so each frame maps to the exact update it shows: no frame offset is scanned. Per declared window, the static's
// predicted coefficient per g58 period is correlated with the frames' robust period values (detrended); a seed's
// score is its windows' mean r. MODEL_ONLY replays over DEVICE_MEASURED frames and clock.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { currentPath } from '@sixam/review/renamed-path';
import { drawTrace } from '../../../source/recompile/model-draw-trace.ts';
import { landingLatency, loadConfig, mapSchedule, officeClock, phoneSchedule, traceColumns, traceTick } from './phone-encounter-replay.ts';
import { detrend, lumaByImage, pearson, staticRow, wireStatic } from './phone-static-readout.ts';
import { periodValue } from './phone-region-readout.ts';
import { modelContacts } from './schedule-to-input.ts';
import { fanOut, sha256 } from './sweep-common.ts';

export const SCHEMA = 'phone-seed-scan-v1';
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const CONFIG = 'packages/propose/bin/recompile/phone-encounter-nights.json';

/**
 * The night's model inputs from its trace and pack: the measured update clock from the first night frame (the trace
 * row whose image time is the Companion's latched onset), the binding's contacts at the measured release, landed, and
 * each readout frame inside a window as { window, update, luma }.
 */
export function tracedNight(spec, inputs, root = ROOT) {
  const cfg = loadConfig(join(root, CONFIG));
  const traceText = readFileSync(resolve(root, spec.trace.path), 'utf8');
  if (sha256(traceText) !== spec.trace.sha256) throw new Error(`${spec.trace.path}: not the recorded trace`);
  const cols = traceColumns(traceText, ['image_ns', 'monitor_luma']);
  const onsetNs = Math.round(inputs.onsetDeviceMs * 1e6);
  const first = cols.image_ns.findIndex((ns) => Math.abs(ns - onsetNs) < 1e6);
  if (first < 0) throw new Error('no trace row at the latched onset');
  const clock = officeClock(cols.image_ns, first, { catchUp: true });
  const deltas = clock.deltas.map((d) => Number(d.toFixed(6)));
  const winner = JSON.parse(readFileSync(resolve(root, currentPath(root, spec.winner)), 'utf8'));
  // Contacts in ms after the run start (the seed), the release `seedToFirstFrameMs + releasedAimMs` after it; mapped
  // onto the trace clock, which starts at the first night frame, plus the night's median landing latency.
  const originMs = spec.seedToFirstFrameMs + inputs.releasedAimMs;
  const sched = phoneSchedule(winner, spec.night, originMs);
  const shift = inputs.releasedAimMs - originMs;
  const sends = sched.queueMs.filter(([, kind, action]) => kind === 'press' && action === 'monitor').map(([ms]) => ms + shift);
  const latency = landingLatency(cols, first, sends);
  const contacts = modelContacts(mapSchedule(sched, (ms) => traceTick(ms + shift + latency.medianMs, clock)).contacts);
  const modelOptions = JSON.parse(readFileSync(resolve(root, currentPath(root, cfg.modelOptions)), 'utf8'));
  const rows = readFileSync(resolve(root, inputs.readout.path));
  if (sha256(rows) !== inputs.readout.sha256) throw new Error(`${inputs.readout.path}: not the recorded readout`);
  const lumaAt = lumaByImage(rows.toString('utf8'), spec.region);
  const frames = [];
  for (let j = 0; j + first < cols.image_ns.length; j += 1) {
    const ms = clock.imageMs[j];
    const win = spec.windows.find((w) => ms >= w.fromMs && ms <= w.toMs);
    const luma = win ? lumaAt.get(cols.image_ns[first + j]) : undefined;
    if (!win || luma === undefined) continue;
    frames.push({ window: win.name, update: j + 1 < clock.passStart.length ? clock.passStart[j + 1] : clock.deltas.length, luma });
  }
  return { first, deltas, contacts, modelOptions, frames, latency, endFrame: Math.max(...frames.map((f) => f.update)) + 2 };
}

/** One seed's static per update to `endFrame`, then each window's r: { seed, r: mean over windows, perWindow }. */
export function scoreSeed(night, spec, seed) {
  const st = { v0: 125, v1: 0, v2: 0, v3: 0, alpha: 255, block: 0 };
  const per = [];
  drawTrace({ night: spec.night, seed, frames: night.endFrame, modelOptions: night.modelOptions,
    ...(spec.customNight ? { customNight: spec.customNight } : {}), contacts: night.contacts, frameTimes: night.deltas,
    observe: (sim) => { if (!sim.__wired) { sim.__wired = true; wireStatic(sim, st); } per.push(staticRow(sim, st)); return null; } });
  const perWindow = spec.windows.map((win) => {
    const groups = new Map();
    for (const f of night.frames) {
      if (f.window !== win.name) continue;
      const p = per[f.update];
      if (!p || !p.shown || p.cam !== win.cam || p.viewing !== win.viewing) continue;
      if (!groups.has(p.block)) groups.set(p.block, { alpha: p.alpha, ys: [] });
      groups.get(p.block).ys.push(f.luma);
    }
    const b = [...groups.values()].slice(1, -1).map((g) => ({ alpha: g.alpha, value: periodValue(g.ys, spec.robust), n: g.ys.length }))
      .filter((g) => g.n >= 2 && g.value !== null);
    return pearson(detrend(b.map((g) => 1 - g.alpha / 255), win.detrendK), detrend(b.map((g) => g.value), win.detrendK));
  });
  const rs = perWindow.filter((r) => r !== null);
  return { seed, r: rs.length === perWindow.length ? rs.reduce((a, c) => a + c, 0) / rs.length : null, perWindow };
}

async function main(argv) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--night-inputs', '--spec', '--workers', '--from', '--to', '--out'].includes(argv[i]) || !argv[i + 1]) throw new Error('see usage at top of file');
    args[argv[i].slice(2)] = argv[i + 1];
  }
  const specText = readFileSync(args.spec, 'utf8');
  const inputsText = readFileSync(args['night-inputs'], 'utf8');
  const spec = JSON.parse(specText); const inputs = JSON.parse(inputsText);
  const night = tracedNight(spec, inputs);
  const from = Number(args.from ?? 0); const to = Number(args.to ?? 65535);
  const seeds = Array.from({ length: to - from + 1 }, (_, k) => from + k);
  const t0 = Date.now();
  // The night is prepared once here: each worker gets its few hundred window frames, the clock and the contacts,
  // never the recorder rows (hundreds of MB of pixels) or the trace.
  const scores = await fanOut(import.meta.url, SCHEMA, { spec: specText, night: JSON.stringify(night) }, seeds, Number(args.workers ?? 4));
  const ranked = scores.filter((s) => s.r !== null).sort((a, b) => b.r - a.r || a.seed - b.seed);
  const result = { schema: SCHEMA, claimLevel: 'MODEL_ONLY replays over DEVICE_MEASURED frames and clock', exploratory: true,
    spec: { path: args.spec, sha256: sha256(specText) }, nightInputs: { path: args['night-inputs'], sha256: sha256(inputsText) },
    first: night.first, landingLatency: night.latency, frames: night.frames.length, endFrame: night.endFrame, seeds: seeds.length,
    top20: ranked.slice(0, 20), quantiles: { p50: ranked[ranked.length >> 1]?.r, p999: ranked[Math.floor(ranked.length * 0.001)]?.r }, elapsedMs: Date.now() - t0 };
  if (args.out) writeFileSync(args.out, `${JSON.stringify(result, null, 1)}\n`);
  console.log(`${seeds.length} seeds, ${night.frames.length} frames to update ${night.endFrame}, landing ${night.latency.medianMs} ms; top ${ranked.slice(0, 5).map((s) => `${s.seed}:${s.r.toFixed(3)}`).join(' ')}`);
}

if (!isMainThread && workerData?.tool === SCHEMA) {
  const spec = JSON.parse(workerData.spec); const night = JSON.parse(workerData.night);
  parentPort.postMessage(workerData.chunk.map((seed) => scoreSeed(night, spec, seed)));
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
