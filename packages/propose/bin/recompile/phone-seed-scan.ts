#!/usr/bin/env node
// Every office seed of a traced phone night replayed from its first update against the night's native static readout
// (ROADMAP S2a/S4: the seed read in-night, at any dials). EXPLORATORY until a predeclaration names it.
//
//   node packages/propose/bin/recompile/phone-seed-scan.ts --night-inputs INPUTS.json --spec SPEC.json [--workers N]
//       [--from S --to S] [--out FILE]                                        exploratory: scan only
//   node packages/propose/bin/recompile/phone-seed-scan.ts --derive-inputs RUN --spec PRE.json --out INPUTS.json
//   node packages/propose/bin/recompile/phone-seed-scan.ts --night-inputs INPUTS.json --spec PRE.json --power-check
//       [--workers N] [--out FILE]                                            a predeclaration: scan, rule, power check
//
// With --power-check the spec is a predeclaration: its decisionRule reads the scan (IDENTIFIED when the top seed's mean
// r reaches minR and leads the next by minMargin), and its powerCheck plants each named seed at the night's own noise
// and gain (nightStrength) on the night's own frame times and scans again: unless every planted seed is identified as
// itself, the verdict is UNINFORMATIVE. Each declared window's r for the identified seed is reported (not tested).
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
import type { FileRef } from './phone-encounter-replay.ts';
import { detrend, lumaByImage, pearson, staticRow, wireStatic } from './phone-static-readout.ts';
import type { StaticState, Win } from './phone-static-readout.ts';
import { deriveInputs, periodValue, readoutStrength } from './phone-region-readout.ts';
import { modelContacts } from './schedule-to-input.ts';
import { fanOut, powerCheckPassed, sha256 } from './sweep-common.ts';
import type { Sim } from '@sixam/source/fnaf2';

/** A seed-scan spec (predeclared or exploratory): the night and binding, its windows, region and rules. */
interface SeedSpec {
  readonly night: number, readonly winner: string, readonly seedToFirstFrameMs: number, readonly releaseLatencyMs?: number;
  readonly region: string, readonly windows: readonly Win[], readonly reportWindows?: readonly Win[], readonly trace?: FileRef;
  readonly customNight?: Readonly<Record<string, number>>;
  readonly robust?: { readonly above: number, readonly below: number, readonly statistic?: string };
  readonly decisionRule: { readonly minR: number, readonly minMargin: number };
  readonly powerCheck: { readonly referenceSeed: number, readonly seeds: readonly number[] };
}
/** A run's derived inputs (deriveInputs), with its frame trace. */
type SeedInputs = ReturnType<typeof deriveInputs> & { readonly trace?: FileRef };
/** The night prepared for the scan (tracedNight). */
type TracedNight = ReturnType<typeof tracedNight>;
/** One seed's score. */
type SeedScore = ReturnType<typeof scoreSeed>;
/** A seed's score with a correlation. */
type Ranked = SeedScore & { r: number };

export const SCHEMA = 'phone-seed-scan-v1';
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const CONFIG = 'packages/propose/bin/recompile/phone-encounter-nights.json';

/**
 * The night's model inputs from its trace and pack: the measured update clock from the first night frame (the trace
 * row whose image time is the Companion's latched onset), the binding's contacts at the measured release, landed, and
 * each readout frame inside a window as { window, update, luma }.
 */
export function tracedNight(spec: SeedSpec, inputs: SeedInputs, root = ROOT) {
  const cfg = loadConfig(join(root, CONFIG));
  const trace = (inputs.trace ?? spec.trace) as FileRef;   // a predeclared night's trace comes with its derived inputs
  const traceText = readFileSync(resolve(root, trace.path), 'utf8');
  if (sha256(traceText) !== trace.sha256) throw new Error(`${trace.path}: not the recorded trace`);
  const cols = traceColumns(traceText, ['image_ns', 'monitor_luma']);
  const onsetNs = Math.round(inputs.onsetDeviceMs * 1e6);
  const first = cols.image_ns.findIndex((ns) => Math.abs(ns - onsetNs) < 1e6);
  if (first < 0) throw new Error('no trace row at the latched onset');
  const clock = officeClock(cols.image_ns, first, { catchUp: true });
  const deltas = clock.deltas.map((d) => Number(d.toFixed(6)));
  // The binding and the options file lead to their files (records keep their paths).
  const winner = JSON.parse(readFileSync(resolve(root, currentPath(root, spec.winner) as string), 'utf8'));
  // Contacts in ms after the run start (the seed), the release `seedToFirstFrameMs + releasedAimMs` after it; mapped
  // onto the trace clock, which starts at the first night frame, plus the night's median landing latency.
  const originMs = spec.seedToFirstFrameMs + inputs.releasedAimMs;
  const sched = phoneSchedule(winner, spec.night, originMs);
  const shift = inputs.releasedAimMs - originMs;
  const sends = sched.queueMs.filter(([, kind, action]) => kind === 'press' && action === 'monitor').map(([ms]) => ms + shift);
  const latency = landingLatency(cols, first, sends);
  // A release lands `spec.releaseLatencyMs` after its send when the spec names it, else as late as the press: on the
  // 0/20 night and on full-06 the press's latency on releases makes the model drop a monitor the phone kept
  // (docs/evidence/phone-release-latency-20261001.json).
  const releaseMs = Number.isFinite(spec.releaseLatencyMs) ? spec.releaseLatencyMs as number : latency.medianMs;
  const contacts = modelContacts(mapSchedule(sched, (ms, kind) => traceTick(ms + shift + (kind === 'release' ? releaseMs : latency.medianMs), clock)).contacts);
  const modelOptions = JSON.parse(readFileSync(resolve(root, currentPath(root, cfg.modelOptions) as string), 'utf8'));
  const rows = readFileSync(resolve(root, inputs.readout.path));
  if (sha256(rows) !== inputs.readout.sha256) throw new Error(`${inputs.readout.path}: not the recorded readout`);
  const lumaAt = lumaByImage(rows.toString('utf8'), spec.region);
  const frames: { window: string, imageMs: number, update: number, luma: number }[] = [];
  for (let j = 0; j + first < cols.image_ns.length; j += 1) {
    const ms = clock.imageMs[j];
    const win = spec.windows.find((w) => ms >= w.fromMs && ms <= w.toMs);
    const luma = win ? lumaAt.get(cols.image_ns[first + j]) : undefined;
    if (!win || luma === undefined) continue;
    frames.push({ window: win.name, imageMs: ms, update: j + 1 < clock.passStart.length ? clock.passStart[j + 1] : clock.deltas.length, luma });
  }
  return { first, deltas, contacts, modelOptions, frames, latency, endFrame: Math.max(...frames.map((f) => f.update)) + 2 };
}

/** One seed's static row per update, from update 0 to the night's `endFrame`. */
export function staticRows(night: Pick<TracedNight, 'endFrame' | 'modelOptions' | 'contacts' | 'deltas'>,
  spec: Pick<SeedSpec, 'night' | 'customNight'>, seed: number) {
  const st: StaticState = { v0: 125, v1: 0, v2: 0, v3: 0, alpha: 255, block: 0 };
  const per: ReturnType<typeof staticRow>[] = [];
  drawTrace({ night: spec.night, seed, frames: night.endFrame, modelOptions: night.modelOptions,
    ...(spec.customNight ? { customNight: spec.customNight } : {}), contacts: night.contacts, frameTimes: night.deltas,
    // The Sim is marked once it is wired.
    observe: (sim: Sim & { __wired?: boolean }) => { if (!sim.__wired) { sim.__wired = true; wireStatic(sim, st); } per.push(staticRow(sim, st)); return null; } });
  return per;
}

/**
 * The night's frames with their luma replaced by a planted seed's static at a given strength (a slow pan plus gain x
 * coefficient plus Gaussian noise), on the same frame times and updates: the power check's synthetic night.
 */
export function plantFrames(night: TracedNight, spec: SeedSpec, seed: number,
  { gain, noiseSd, noiseSeed = 1 }: { gain: number, noiseSd: number, noiseSeed?: number }) {
  const per = staticRows(night, spec, seed);
  let s = noiseSeed >>> 0; const uniform = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 0.5) / 2 ** 32;
  const gauss = () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
  return night.frames.map((f) => ({ ...f, luma: 40 + 6 * Math.sin((2 * Math.PI * f.imageMs) / 4000) + gain * (1 - (per[f.update]?.alpha ?? 255) / 255) + noiseSd * gauss() }));
}

/**
 * The night's noise and gain from its own frames, against a reference seed's coefficient (readoutStrength), with the
 * camera-switch flash and black frames left out as the period values leave them out (`spec.robust`): on the 0/20 night
 * they inflated the gain from about 30 to 277 and made the planted check easier than the night.
 */
export function nightStrength(night: TracedNight, spec: SeedSpec, referenceSeed: number) {
  const per = staticRows(night, spec, referenceSeed);
  const byMs = new Map(night.frames.map((f) => [f.imageMs, f.update]));
  const kept = spec.robust ? night.frames.filter((f) => f.luma < (spec.robust as NonNullable<SeedSpec['robust']>).above
    && f.luma > (spec.robust as NonNullable<SeedSpec['robust']>).below) : night.frames;
  return readoutStrength(kept.map((f) => ({ imageMs: f.imageMs, luma: f.luma })), spec.windows,
    // A frame's time names its update.
    (_win, ms) => 1 - (per[byMs.get(ms) as number]?.alpha ?? 255) / 255);
}

/** One seed's static per update to `endFrame`, then each window's r: { seed, r: mean over windows, perWindow }. */
export function scoreSeed(night: TracedNight, spec: SeedSpec, seed: number) {
  const per = staticRows(night, spec, seed);
  const perWindow = spec.windows.map((win) => {
    const groups = new Map<number, { alpha: number, ys: number[] }>();
    for (const f of night.frames) {
      if (f.window !== win.name) continue;
      const p = per[f.update];
      if (!p || !p.shown || p.cam !== win.cam || p.viewing !== win.viewing) continue;
      if (!groups.has(p.block)) groups.set(p.block, { alpha: p.alpha, ys: [] });
      (groups.get(p.block) as { ys: number[] }).ys.push(f.luma);
    }
    const b = [...groups.values()].slice(1, -1).map((g) => ({ alpha: g.alpha, value: periodValue(g.ys, spec.robust), n: g.ys.length }))
      .filter((g): g is { alpha: number, value: number, n: number } => g.n >= 2 && g.value !== null);
    return pearson(detrend(b.map((g) => 1 - g.alpha / 255), win.detrendK), detrend(b.map((g) => g.value), win.detrendK));
  });
  const rs = perWindow.filter((r) => r !== null);
  return { seed, r: rs.length === perWindow.length ? rs.reduce((a, c) => a + c, 0) / rs.length : null, perWindow };
}

/** The rule over a ranked scan: IDENTIFIED when the top seed's r reaches minR and leads the next by minMargin. */
export function identifySeed<S extends { readonly seed: number, readonly r: number }>(rule: SeedSpec['decisionRule'], ranked: readonly S[]) {
  const [top, second] = ranked;
  const ok = !!top && top.r >= rule.minR && top.r - (second?.r ?? -1) >= rule.minMargin;
  return { verdict: ok ? 'IDENTIFIED' : 'UNIDENTIFIED', top: top ?? null, second: second ?? null };
}

const scan = async (night: TracedNight, specText: string, seeds: readonly number[], workers: number) =>
  (await fanOut<number, SeedScore>(import.meta.url, SCHEMA, { spec: specText, night: JSON.stringify(night) }, seeds, workers))
    .filter((s): s is Ranked => s.r !== null).sort((a, b) => b.r - a.r || a.seed - b.seed);

async function main(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--power-check') { args['power-check'] = '1'; i -= 1; continue; }
    if (!['--night-inputs', '--spec', '--workers', '--from', '--to', '--out', '--derive-inputs'].includes(argv[i]) || !argv[i + 1]) throw new Error('see usage at top of file');
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (args['derive-inputs']) {
    // The readout's derived inputs (onset, release, rows) plus the run's frame trace, hashed; nothing chosen.
    const run = args['derive-inputs'];
    const base = deriveInputs(run, sha256(readFileSync(args.spec)));
    const file = readFileSync(join(ROOT, 'artifacts/runs', run, 'frame-trace.file'), 'utf8').trim();
    const path = `captures/frame-traces/${file}`;
    const inputs = { ...base, schema: `${SCHEMA}-inputs`, trace: { path, sha256: sha256(readFileSync(join(ROOT, path))) } };
    writeFileSync(args.out, `${JSON.stringify(inputs, null, 1)}\n`);
    console.log(`${run}: onset ${inputs.onsetDeviceMs}, release ${inputs.releasedAimMs.toFixed(1)} ms, trace ${inputs.trace.sha256.slice(0, 16)}, readout ${inputs.readout.sha256.slice(0, 16)}`);
    return;
  }
  const specText = readFileSync(args.spec, 'utf8');
  const inputsText = readFileSync(args['night-inputs'], 'utf8');
  const spec: SeedSpec = JSON.parse(specText); const inputs: SeedInputs = JSON.parse(inputsText);
  const night = tracedNight(spec, inputs);
  const from = Number(args.from ?? 0); const to = Number(args.to ?? 65535);
  const seeds = Array.from({ length: to - from + 1 }, (_, k) => from + k);
  const t0 = Date.now();
  // The night is prepared once here: each worker gets its few hundred window frames, the clock and the contacts,
  // never the recorder rows (hundreds of MB of pixels) or the trace.
  const workers = Number(args.workers ?? 4);
  const ranked = await scan(night, specText, seeds, workers);
  let decision = null as object | null;
  if (args['power-check']) {
    if (inputs.predeclarationSha256 !== sha256(specText)) throw new Error('the night inputs were derived for another predeclaration');
    const reading = identifySeed(spec.decisionRule, ranked);
    const strength = nightStrength(night, spec, spec.powerCheck.referenceSeed);
    const planted: { seed: number, verdict: string, top: Ranked | null, second: Ranked | null, recovered: boolean }[] = [];
    for (const [k, seed] of spec.powerCheck.seeds.entries()) {
      // The night's own frames give its noise and gain.
      const fake = { ...night, frames: plantFrames(night, spec, seed, { gain: strength.gain as number, noiseSd: strength.noiseSd as number, noiseSeed: k + 1 }) };
      const got = identifySeed(spec.decisionRule, await scan(fake, specText, seeds, workers));
      planted.push({ seed, verdict: got.verdict, top: got.top, second: got.second, recovered: got.verdict === 'IDENTIFIED' && (got.top as Ranked).seed === seed });
      console.log(`  planted ${seed}: ${got.verdict} top ${got.top?.seed}:${got.top?.r.toFixed(3)} next ${got.second?.r.toFixed(3)}`);
    }
    const powered = powerCheckPassed(planted, (p) => p.recovered);
    const verdict = !powered ? 'UNINFORMATIVE' : reading.verdict === 'IDENTIFIED' ? 'SUPPORTED' : 'NOT_SUPPORTED';
    // Descriptive, not tested: the top seed's r in every window the predeclaration reports (`reportWindows`, else the
    // scanned ones), replayed once through the night: where the model's stream stops reproducing the phone's static.
    const reportSpec = spec.reportWindows ? { ...spec, windows: spec.reportWindows } : spec;
    const reportNight = spec.reportWindows ? tracedNight(reportSpec, inputs) : night;
    const best = reading.top ? scoreSeed(reportNight, reportSpec, reading.top.seed) : null;
    decision = { reading, powerCheck: { strength, planted, powered }, verdict,
      topSeedPerWindow: best ? reportSpec.windows.map((w, i) => ({ window: w.name, r: best.perWindow[i] })) : null };
    console.log(`reading ${reading.verdict} (top ${reading.top?.seed}:${reading.top?.r.toFixed(3)}, next ${reading.second?.r.toFixed(3)}); power ${powered ? 'passed' : 'failed'} -> ${verdict}`);
  }
  const result = { schema: SCHEMA, claimLevel: 'MODEL_ONLY replays over DEVICE_MEASURED frames and clock', exploratory: true,
    spec: { path: args.spec, sha256: sha256(specText) }, nightInputs: { path: args['night-inputs'], sha256: sha256(inputsText) },
    first: night.first, landingLatency: night.latency, frames: night.frames.length, endFrame: night.endFrame, seeds: seeds.length,
    top20: ranked.slice(0, 20), quantiles: { p50: ranked[ranked.length >> 1]?.r, p999: ranked[Math.floor(ranked.length * 0.001)]?.r },
    ...(decision ? { exploratory: false, ...decision } : {}), runFacts: { elapsedMs: Date.now() - t0 } };
  if (args.out) writeFileSync(args.out, `${JSON.stringify(result, null, 1)}\n`);
  console.log(`${seeds.length} seeds, ${night.frames.length} frames to update ${night.endFrame}, landing ${night.latency.medianMs} ms; top ${ranked.slice(0, 5).map((s) => `${s.seed}:${s.r.toFixed(3)}`).join(' ')}`);
}

if (!isMainThread && workerData?.tool === SCHEMA) {
  const spec = JSON.parse(workerData.spec); const night = JSON.parse(workerData.night);
  // A worker thread has its parent's port.
  (parentPort as NonNullable<typeof parentPort>).postMessage(workerData.chunk.map((seed: number) => scoreSeed(night, spec, seed)));
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
