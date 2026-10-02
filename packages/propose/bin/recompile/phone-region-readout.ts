#!/usr/bin/env node
// Read a measurement night's office generator state off its native static readout, without a frame trace
// (ROADMAP S2a: the instrument itself).
//
//   node packages/propose/bin/recompile/phone-region-readout.ts --derive-inputs RUN --predeclaration FILE --out INPUTS.json
//   node packages/propose/bin/recompile/phone-region-readout.ts --predeclaration FILE --night-inputs INPUTS.json
//       [--workers N] [--out FILE]
//   node packages/propose/bin/recompile/phone-region-readout.ts --predeclaration FILE --plant STATE --window NAME|all
//       [--noise SD] [--gain G] [--seed N] [--workers N] [--out FILE]
//
// --derive-inputs reads a packed run (docs/evidence/runs/RUN/events.jsonl: origin.anchor's onsetDeviceMs and
// releasedAimMs) and its recorder rows (captures/static-readouts/RUN.jsonl, hashed) into the night's inputs, bound to
// the predeclaration's sha256; nothing in it is chosen. The analysis then reads the predeclaration and those inputs.
//
// The night (the predeclaration's `night`) was recorded with `night-run.sh --static-readout --no-video`: the
// Companion's static_view rectangle on every copied frame, each row with its image time on the helper's clock, and
// the night onset on the same clock in the pack's origin.anchor (onsetDeviceMs). With no frame trace the model runs
// at a constant 60 Hz from the run's start (the night onset is `seedToFirstFrameMs` later), the binding's contacts at
// the measured release, each mid-update. A frame shows update floor(model ms / one update) plus an offset `o`; the
// offset is not measured, so every state is scored at its best `o` within the predeclared range, which the null
// distribution (every other state) gets as well.
//
// Per window, every generator state is written into the model at the window's injection update (one replay to
// there, then Sim.snapshot()/restore() per state, so each state replays only the window) and its static coefficient
// per g58 period correlated with the period-mean luma of the frames that show the window's view, both detrended.
// The predeclaration's rule decides, verbatim (phone-static-readout.ts identify()), and identified windows are
// checked against each other: the generator steps between two identified states against the draws the model
// spends between their injections.
//
// --plant writes synthetic rows for one window from a known state (its predicted static, a slow pan and Gaussian
// noise) and scans them: the method's own check that it can identify what it is built to. MODEL_ONLY in either mode:
// an identified state is a reading of the phone through the model.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { Sim } from '@sixam/source/fnaf2';
import { contactEdges, simOptionsFrom } from '../../../source/recompile/model-draw-trace.ts';
import { currentPath } from '@sixam/review/renamed-path';
import { cumTick, FRAME_MS, loadConfig, mapSchedule, phoneSchedule } from './phone-encounter-replay.ts';
import { cycleIndex, detrend, lumaByImage, pearson, staticRow, wireStatic } from './phone-static-readout.ts';
import type { StaticState, Win } from './phone-static-readout.ts';
import { modelContacts } from './schedule-to-input.ts';
import { fanOut, sha256 } from './sweep-common.ts';

/** The night a region-readout predeclaration names, with its measured onset, release and readout rows merged in. */
export interface RegionNight {
  readonly night: number, readonly winner: string, readonly releaseAfterRunStartMs: number, readonly modelSeed?: number;
  readonly customNight?: Readonly<Record<string, number>>, readonly onsetDeviceMs: number;
  readonly staticReadout: { readonly path: string, readonly sha256: string, readonly region: string };
}
/** How a period's value drops flash and black frames. */
type Robust = { readonly above: number, readonly below: number, readonly statistic?: string };
/** The predeclared method: the clock's offset, the injection lead and the frame offsets tried. */
interface Method {
  readonly seedToFirstFrameMs: number, readonly injectLeadMs: number, readonly offsets: readonly number[];
  readonly robust?: Robust | null,
}
/** The predeclared rule: the reading's floor and margin, its alias width, and the consistency counts. */
interface Rule {
  readonly minR: number, readonly minMargin: number, readonly aliasSteps: number, readonly consistencyDraws: number;
  readonly supportConsistentPairs: number, readonly refuteConsistentPairs: number,
}
/** A region-readout predeclaration. */
export interface RegionPre {
  readonly id: string, readonly night: RegionNight, readonly method: Method & { readonly seedToFirstFrameMs: number };
  readonly decisionRule: Rule, readonly windows: readonly Win[];
  readonly powerCheck: { readonly referenceState: number, readonly states: readonly number[] };
}
/** A packed night's measured inputs (deriveInputs). */
type NightInputsFile = ReturnType<typeof deriveInputs>;
/** A frame since the onset and its region's mean luma. */
type Image = { readonly imageMs: number, readonly luma: number | null };
/** The model's inputs for the night (nightInputs). */
type Base = ReturnType<typeof nightInputs>;
/** One state's best reading over a window. */
type RegionScore = { state: number } & ReturnType<typeof scoreSeries>;
/** A reading with a correlation. */
type Read = RegionScore & { r: number };

export const SCHEMA = 'phone-region-readout-v1';
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const CONFIG = 'packages/propose/bin/recompile/phone-encounter-nights.json';
const STATES = 0x10000;

/** The predeclared night with its measured inputs (derived after the night from its pack) merged in. */
/** What a night's measured inputs add to its predeclared fields. */
type Measured = {
  onsetDeviceMs: number, releaseAfterRunStartMs: number, staticReadout: { path: string, sha256: string, region: string },
};
/** A predeclaration's night, as measuredNight reads it. */
type DeclaredNight = { readonly staticReadout: { readonly region: string } };
export function measuredNight<N extends DeclaredNight>(pre: { readonly night: N, readonly method: { readonly seedToFirstFrameMs: number } },
  inputs: NightInputsFile, preSha256: string): N & Measured;
export function measuredNight<N extends DeclaredNight>(pre: { readonly night: N, readonly method: { readonly seedToFirstFrameMs: number } },
  inputs: NightInputsFile | null, preSha256: string): N | (N & Measured);
export function measuredNight<N extends DeclaredNight>(pre: { readonly night: N, readonly method: { readonly seedToFirstFrameMs: number } },
  inputs: NightInputsFile | null, preSha256: string) {
  if (!inputs) return pre.night;
  if (inputs.predeclarationSha256 !== preSha256) throw new Error('the night inputs were derived for another predeclaration');
  return { ...pre.night, onsetDeviceMs: inputs.onsetDeviceMs, releaseAfterRunStartMs: pre.method.seedToFirstFrameMs + inputs.releasedAimMs,
    staticReadout: { path: inputs.readout.path, sha256: inputs.readout.sha256, region: pre.night.staticReadout.region } };
}

/** A packed run's measured inputs: the onset and the delivered release on the helper's clock, and the readout rows. */
export function deriveInputs(run: string, preSha256: string, root = ROOT, { readoutSha256 = null as string | null } = {}) {
  /** An origin event of the pack, as the readout reads it. */
  type Anchor = { readonly type: string, readonly status: string, readonly onsetDeviceMs?: number, readonly releasedAimMs?: number };
  const rows: Anchor[] = readFileSync(join(root, 'docs/evidence/runs', run, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const scheduled = rows.find((r): r is Anchor & { onsetDeviceMs: number } => r.type === 'origin.anchor' && r.status === 'scheduled' && Number.isFinite(r.onsetDeviceMs));
  const released = rows.find((r): r is Anchor & { releasedAimMs: number } => r.type === 'origin.anchor' && r.status === 'released' && Number.isFinite(r.releasedAimMs));
  if (!scheduled || !released) throw new Error(`${run}: the pack holds no scheduled onset and released anchor`);
  const path = `captures/static-readouts/${run}.jsonl`;
  return { schema: `${SCHEMA}-inputs`, run, predeclarationSha256: preSha256, onsetDeviceMs: scheduled.onsetDeviceMs,
    // The rows stay in captures/ on the recording host (raw pixels); elsewhere the recorded hash stands in for them.
    releasedAimMs: released.releasedAimMs, readout: { path, sha256: readoutSha256 ?? sha256(readFileSync(join(root, path))) } };
}

/** The night as the predeclaration names it: binding, dials, model options, release, onset and the readout rows. */
export function nightInputs(night: RegionNight) {
  const cfg = loadConfig(join(ROOT, CONFIG));
  // The predeclared binding and the options file lead to their files (records keep their paths).
  const winner = JSON.parse(readFileSync(resolve(ROOT, currentPath(ROOT, night.winner) as string), 'utf8'));
  const sched = phoneSchedule(winner, night.night, night.releaseAfterRunStartMs);
  const modelOptions = JSON.parse(readFileSync(resolve(ROOT, currentPath(ROOT, cfg.modelOptions) as string), 'utf8'));
  return { night: night.night, seed: night.modelSeed ?? 0, customNight: night.customNight, modelOptions,
    contacts: modelContacts(mapSchedule(sched, (ms) => cumTick(ms, [])).contacts) };
}

/** Frames since the night onset, from the recorder's rows: [{ imageMs, luma }]. */
export function regionImages(rowsText: string, region: string, onsetDeviceMs: number): Image[] {
  return [...lumaByImage(rowsText, region)].map(([imageNs, luma]) => ({ imageMs: imageNs / 1e6 - onsetDeviceMs, luma }))
    .sort((a, b) => a.imageMs - b.imageMs);
}

/** The update a frame at `imageMs` after the onset shows, at a constant 60 Hz, before the predeclared offset. */
export const updateOf = (imageMs: number, seedToFirstFrameMs: number) => Math.floor(((imageMs + seedToFirstFrameMs) * 60) / 1000);   // not / FRAME_MS: 1000 / (1000 / 60) floors to 59

/**
 * One replay to update `injectAt`, then a function from a generator state to its window: per update from
 * injectAt + 1 to `endFrame`, the static row (staticRow) and the draws spent since the injection.
 */
export function windowRunner(base: Base, injectAt: number) {
  // Sim options, as simOptionsFrom admitted them.
  const sim = new Sim({ ...simOptionsFrom(base.modelOptions) as ConstructorParameters<typeof Sim>[0], night: base.night, seed: base.seed,
    ...(base.customNight ? { customNight: base.customNight } : {}) });
  sim.enableContactInput();
  const edges = contactEdges(base.contacts);
  const st: StaticState = { v0: 125, v1: 0, v2: 0, v3: 0, alpha: 255, block: 0 };
  wireStatic(sim, st);
  const step = (k: { i: number }) => { while (k.i < edges.length && edges[k.i][0] <= sim.frame) { const [, op, action] = edges[k.i++]; sim[op](action); } sim.tick(); };
  const cursor = { i: 0 };
  while (sim.frame < injectAt && sim.alive && !sim.won) step(cursor);
  const { i } = cursor;
  const snap = sim.snapshot();
  const st0 = { ...st };
  return (state: number, endFrame: number) => {
    sim.restore(snap); Object.assign(st, st0);
    let draws = 0;
    wireStatic(sim, st, () => { draws += 1; });
    sim.rng.state = state;
    const per: (ReturnType<typeof staticRow> & { draws: number })[] = []; const k = { i };
    while (sim.frame < endFrame && sim.alive && !sim.won) { step(k); per.push({ ...staticRow(sim, st), draws }); }
    return per;
  };
}

/** Period means of a window's frames against a state's predicted coefficient, best over the offsets: { r, o, blocks }. */
/**
 * A period's value from its frames' luma: the mean, or with `robust` ({ above, below, statistic }) the median or
 * mean of the frames inside (below, above), dropping the camera-switch flash (luma 255) and black frames that the
 * 0/20 night showed spill into a window's periods. null when no frame is left.
 */
export function periodValue(ys: readonly number[], robust: Robust | null = null) {
  const kept = robust ? ys.filter((y) => y < robust.above && y > robust.below) : ys;
  if (!kept.length) return null;
  if (robust?.statistic === 'median') { const s = [...kept].sort((a, b) => a - b); return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2; }
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

export function scoreSeries(per: readonly (ReturnType<typeof staticRow> & { draws: number })[], injectAt: number, images: readonly Image[],
  win: Win, offsets: readonly number[], seedToFirstFrameMs: number, minFrames = 2, robust: Robust | null = null) {
  let best = { r: null as number | null, o: null as number | null, blocks: 0 };
  for (const o of offsets) {
    const groups = new Map<number, { alpha: number, ys: number[] }>();
    for (const im of images) {
      if (im.imageMs < win.fromMs || im.imageMs > win.toMs || im.luma === null) continue;
      const p = per[updateOf(im.imageMs, seedToFirstFrameMs) + o - injectAt - 1];
      if (!p || !p.shown || p.cam !== win.cam || p.viewing !== win.viewing) continue;
      if (!groups.has(p.block)) groups.set(p.block, { alpha: p.alpha, ys: [] });
      (groups.get(p.block) as { ys: number[] }).ys.push(im.luma);
    }
    const b = [...groups.entries()].sort((x, y) => x[0] - y[0]).slice(1, -1).map(([, g]) => ({ alpha: g.alpha, value: periodValue(g.ys, robust), n: g.ys.length }))
      .filter((g): g is { alpha: number, value: number, n: number } => g.n >= minFrames && g.value !== null);
    const r = pearson(detrend(b.map((g) => 1 - g.alpha / 255), win.detrendK), detrend(b.map((g) => g.value), win.detrendK));
    if (r !== null && (best.r === null || r > best.r)) best = { r, o, blocks: b.length };
  }
  return best;
}

/** The window's injection and end updates at a constant 60 Hz: injection `injectLeadMs` before fromMs. */
export function windowUpdates(win: Pick<Win, 'fromMs' | 'toMs'>, method: Method) {
  return { injectAt: updateOf(win.fromMs - method.injectLeadMs, method.seedToFirstFrameMs),
    endFrame: updateOf(win.toMs, method.seedToFirstFrameMs) + Math.max(...method.offsets) + 2 };
}

/**
 * The rule over one window's scores, alias-aware: states a few generator steps from the top state replay the same
 * stream a period early or late and re-align through the frame offset, so they are the same reading, not rivals.
 * IDENTIFIED when the top state's r reaches `minR` and leads the best state more than `aliasSteps` steps from it
 * (or on another of the generator's four cycles) by at least `minMargin`.
 */
export function identifyReading<S extends { readonly state: number, readonly r: number | null }>(rule: Pick<Rule, 'minR' | 'minMargin' | 'aliasSteps'>,
  scores: readonly S[]) {
  const ranked = scores.filter((s): s is S & { r: number } => s.r !== null).sort((a, b) => b.r - a.r || a.state - b.state);
  const [top] = ranked;
  if (!top) return { verdict: 'UNIDENTIFIED', top: null, rival: null };
  const near = cycleIndex(top.state);
  const steps = (s: number) => { const k = near.get(s); return k === undefined ? Infinity : Math.min(k, near.size - k); };
  const rival = ranked.find((s) => steps(s.state) > rule.aliasSteps) ?? null;
  const ok = top.r >= rule.minR && top.r - (rival?.r ?? -1) >= rule.minMargin;
  return { verdict: ok ? 'IDENTIFIED' : 'UNIDENTIFIED', top, rival };
}

/** Synthetic rows for one window from `state`: its predicted static over a slow pan, plus noise; frames at ~30 fps. */
export function plantImages(base: Base, win: Win, method: Method, state: number, { noiseSd = 2, gain = 30, seed = 1 } = {}) {
  const { injectAt, endFrame } = windowUpdates(win, method);
  const per = windowRunner(base, injectAt)(state, endFrame);
  let s = seed >>> 0; const uniform = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 0.5) / 2 ** 32;
  const gauss = () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
  const images: Image[] = [];
  for (let ms = win.fromMs - 200; ms <= win.toMs + 200; ms += 2 * FRAME_MS) {
    const p = per[updateOf(ms, method.seedToFirstFrameMs) - injectAt - 1];
    if (!p) continue;
    const pan = 40 + 6 * Math.sin((2 * Math.PI * ms) / 4000);
    images.push({ imageMs: ms, luma: pan + gain * (1 - p.alpha / 255) + noiseSd * gauss() });
  }
  return images;
}

const median = (xs: readonly number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : null; };
/** Each value less the mean of the values within `halfMs` of its time: removes the slow camera pan, keeps the 100 ms static steps. */
const runningResidual = (xs: readonly number[], ts: readonly number[], halfMs: number) => xs.map((x, i) => {
  let sum = 0; let n = 0;
  for (let j = 0; j < xs.length; j += 1) if (Math.abs(ts[j] - ts[i]) <= halfMs) { sum += xs[j]; n += 1; }
  return x - sum / n;
});

/**
 * The readout's own strength, from a night's frames and the model: per window the frame-to-frame noise (a robust SD of
 * successive differences, which within a g58 period see only noise) and the gain (luma per unit of the static's
 * coefficient, from the residual variance above the noise over the coefficient's own variance in a reference
 * prediction), both after a mean over +-`halfMs` (five g58 periods) removes the cameras' pan. Medians over windows.
 */
export function readoutStrength<W extends Pick<Win, 'fromMs' | 'toMs'>>(images: readonly Image[], windows: readonly W[],
  coefficientAt: (win: W, ms: number) => number, halfMs = 250) {
  const noise: number[] = []; const gain: number[] = [];
  for (const win of windows) {
    const frames = images.filter((im): im is { imageMs: number, luma: number } => im.imageMs >= win.fromMs && im.imageMs <= win.toMs && im.luma !== null);
    if (frames.length < 20) continue;
    const ts = frames.map((f) => f.imageMs);
    const r = runningResidual(frames.map((f) => f.luma), ts, halfMs);
    const d = r.slice(1).map((x, i) => x - r[i]);
    // Twenty frames or more give differences to take a median of.
    const md = median(d) as number;
    const sd = (1.4826 * (median(d.map((x) => Math.abs(x - md))) as number)) / Math.SQRT2;
    const c = runningResidual(frames.map((f) => coefficientAt(win, f.imageMs)), ts, halfMs);
    const v = (xs: readonly number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length; };
    noise.push(sd);
    if (v(c) > 0) gain.push(Math.sqrt(Math.max(0, v(r) - sd ** 2) / v(c)));
  }
  return { noiseSd: median(noise), gain: median(gain), windows: noise.length };
}

/** A synthetic night: one run from the first window's injection with `state`, frames for every window as plantImages. */
export function plantNight(base: Base, windows: readonly Win[], method: Method, state: number,
  { noiseSd = 2, gain = 30, seed = 1, times = null }: { noiseSd?: number, gain?: number, seed?: number, times?: readonly number[] | null } = {}) {
  const first = windowUpdates(windows[0], method).injectAt;
  const last = Math.max(...windows.map((w) => windowUpdates(w, method).endFrame));
  const per = windowRunner(base, first)(state, last);
  let s = seed >>> 0; const uniform = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 0.5) / 2 ** 32;
  const gauss = () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
  const images: Image[] = [];
  const at = times ?? windows.flatMap((win) => { const xs: number[] = []; for (let ms = win.fromMs - 200; ms <= win.toMs + 200; ms += 2 * FRAME_MS) xs.push(ms); return xs; });
  for (const ms of at) {
    const p = per[updateOf(ms, method.seedToFirstFrameMs) - first - 1];
    if (!p) continue;
    images.push({ imageMs: ms, luma: 40 + 6 * Math.sin((2 * Math.PI * ms) / 4000) + gain * (1 - p.alpha / 255) + noiseSd * gauss() });
  }
  return images;
}

/**
 * The predeclared analysis over a night's frames: per window every state and its reading (identifyReading), then
 * consecutive windows' top states against each other (consistency). The verdict counts consistent consecutive pairs:
 * a pair of random states lands within the tolerance about (2 * tol + 1) / 65,536 of the time.
 */
async function analyze(preBytes: Buffer, pre: RegionPre, base: Base, images: readonly Image[], workers: number,
  log: (line: string) => void = console.log) {
  const { method, decisionRule: rule } = pre;
  const windows = [];
  for (const win of pre.windows) {
    const scan = await scanWindow(preBytes, win, images, workers);
    const reading = identifyReading(rule, scan.scores);
    windows.push({ ...win, ...windowUpdates(win, method), top10: scan.top10, rQuantiles: scan.rQuantiles, reading });
    log(`${win.name}: ${reading.verdict} top ${reading.top?.state}:${reading.top?.r.toFixed(3)}@${reading.top?.o} rival ${reading.rival?.r.toFixed(3)}`);
  }
  const tops = windows.filter((w) => w.reading.top).map((w) => ({ win: w, state: (w.reading.top as Read).state }));
  const pairs = tops.slice(1).map((b, k) => consistency(base, method, tops[k], b));
  const consistent = pairs.filter((p) => p.differ !== null && Math.abs(p.differ) <= rule.consistencyDraws).length;
  const identified = windows.filter((w) => w.reading.verdict === 'IDENTIFIED').length;
  const verdict = consistent >= rule.supportConsistentPairs ? 'SUPPORTED' : consistent <= rule.refuteConsistentPairs ? 'NOT_SUPPORTED' : 'INCONCLUSIVE';
  log(`${identified} of ${windows.length} windows identified; ${consistent} of ${pairs.length} consecutive top-state pairs consistent: ${verdict}`);
  return { windows, identified, pairs, consistent, verdict };
}

/** Every state over one window: the predeclared rule's verdict, the top states and the r quantiles. */
async function scanWindow(preBytes: Buffer, win: Win, images: readonly Image[], workers: number, plant: number | null = null) {
  const scores = (await fanOut<number, RegionScore>(import.meta.url, SCHEMA, { pre: preBytes.toString('utf8'), win, images }, Array.from({ length: STATES }, (_, k) => k), workers))
    .sort((a, b) => a.state - b.state);
  const rs = scores.map((x) => x.r).filter((r) => r !== null).sort((a, b) => a - b);
  const top10 = [...scores].filter((x): x is Read => x.r !== null).sort((a, b) => b.r - a.r || a.state - b.state).slice(0, 10);
  return { scores, top10, rQuantiles: { p50: rs[rs.length >> 1], p999: rs[Math.floor(rs.length * 0.999)], max: rs.at(-1) },
    ...(plant !== null ? { plantedRank: 1 + scores.filter((x) => x.r !== null && x.r > (scores[plant].r ?? -Infinity)).length } : {}) };
}

/** The generator steps from identified state a to b, against the model's draws between their injections. */
export function consistency(base: Base, method: Method, a: { readonly win: Win, readonly state: number },
  b: { readonly win: Win, readonly state: number }) {
  const wa = windowUpdates(a.win, method); const wb = windowUpdates(b.win, method);
  const per = windowRunner(base, wa.injectAt)(a.state, wb.injectAt);
  const modelDraws = per.at(-1)?.draws ?? null;
  const steps = cycleIndex(a.state).get(b.state) ?? null;
  return { from: a.win.name, to: b.win.name, steps, modelDraws, differ: steps === null || modelDraws === null ? null : steps - modelDraws };
}

async function main(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--predeclaration', '--workers', '--out', '--plant', '--window', '--noise', '--gain', '--seed', '--night-inputs', '--derive-inputs'].includes(argv[i]) || !argv[i + 1]) throw new Error('see usage at top of file');
    args[argv[i].slice(2)] = argv[i + 1];
  }
  const preBytes = readFileSync(args.predeclaration);
  if (args['derive-inputs']) {
    const inputs = deriveInputs(args['derive-inputs'], sha256(preBytes));
    if (!args.out) throw new Error('--out INPUTS.json is required');
    writeFileSync(args.out, `${JSON.stringify(inputs, null, 1)}\n`);
    console.log(`${inputs.run}: onset ${inputs.onsetDeviceMs} ms, release ${inputs.releasedAimMs.toFixed(1)} ms after it, readout ${inputs.readout.sha256.slice(0, 16)}`);
    return;
  }
  const inputsBytes = args['night-inputs'] ? readFileSync(args['night-inputs']) : null;
  const declared = JSON.parse(preBytes.toString('utf8'));
  const pre: RegionPre = { ...declared, night: measuredNight(declared, inputsBytes ? JSON.parse(inputsBytes.toString('utf8')) : null, sha256(preBytes)) };
  const workers = Number(args.workers ?? 4);
  const base = nightInputs(pre.night);
  const { method, decisionRule: rule } = pre;
  if (args.plant !== undefined && args.window === 'all') {
    const images = plantNight(base, pre.windows, method, Number(args.plant), { noiseSd: Number(args.noise ?? 2), gain: Number(args.gain ?? 30), seed: Number(args.seed ?? 1) });
    const t0 = Date.now();
    const out = await analyze(preBytes, pre, base, images, workers);
    if (args.out) writeFileSync(args.out, `${JSON.stringify({ schema: SCHEMA, kind: 'plant-night', state: Number(args.plant), noiseSd: Number(args.noise ?? 2), gain: Number(args.gain ?? 30), ...out, elapsedMs: Date.now() - t0 }, null, 1)}\n`);
    return;
  }
  if (args.plant !== undefined) {
    const win = pre.windows.find((w) => w.name === args.window) ?? pre.windows[0];
    const state = Number(args.plant);
    const images = plantImages(base, win, method, state, { noiseSd: Number(args.noise ?? 2), gain: Number(args.gain ?? 30), seed: Number(args.seed ?? 1) });
    const scan = await scanWindow(preBytes, win, images, workers, state);
    const decision = identifyReading(rule, scan.scores);
    // A scan over every state has a top state.
    const top = decision.top as Read;
    console.log(`planted ${state} in ${win.name} (gain ${args.gain ?? 30}, noise sd ${args.noise ?? 2}): rank ${scan.plantedRank}, ${decision.verdict}, top ${top.state}:${top.r.toFixed(3)}@${top.o} rival ${decision.rival?.state}:${decision.rival?.r.toFixed(3)}; null p50 ${scan.rQuantiles.p50.toFixed(3)} p999 ${scan.rQuantiles.p999.toFixed(3)}`);
    if (args.out) writeFileSync(args.out, `${JSON.stringify({ schema: SCHEMA, kind: 'plant', window: win.name, state, noiseSd: Number(args.noise ?? 2), gain: Number(args.gain ?? 30), plantedRank: scan.plantedRank, decision, top10: scan.top10, rQuantiles: scan.rQuantiles }, null, 1)}\n`);
    return;
  }
  const rows = readFileSync(resolve(ROOT, pre.night.staticReadout.path));
  if (sha256(rows) !== pre.night.staticReadout.sha256) throw new Error(`${pre.night.staticReadout.path}: not the recorded static readout`);
  const images = regionImages(rows.toString('utf8'), pre.night.staticReadout.region, pre.night.onsetDeviceMs);
  const t0 = Date.now();
  // The analyze() workers re-read the predeclaration and need the measured night: they get it merged.
  const merged = Buffer.from(JSON.stringify(pre));
  const out = await analyze(merged, pre, base, images, workers);
  // The power check: the night's own noise and gain, a planted state at that strength on the night's own frame times.
  const coefficientAt = (win: Win, ms: number) => {
    const { injectAt, endFrame } = windowUpdates(win, method);
    const per = (coefficientAt.cache[win.name] ??= windowRunner(base, injectAt)(pre.powerCheck.referenceState, endFrame));
    const p = per[updateOf(ms, method.seedToFirstFrameMs) - injectAt - 1];
    return p ? 1 - p.alpha / 255 : 0;
  };
  coefficientAt.cache = {} as Record<string, ReturnType<ReturnType<typeof windowRunner>>>;
  const strength = readoutStrength(images, pre.windows, coefficientAt);
  const times = images.map((im) => im.imageMs);
  const planted = [];
  for (const [k, state] of pre.powerCheck.states.entries()) {
    // The night's own frames give its noise and gain.
    const fake = plantNight(base, pre.windows, method, state, { noiseSd: strength.noiseSd as number, gain: strength.gain as number, seed: k + 1, times });
    const got = await analyze(merged, pre, base, fake, workers, (line) => console.log(`  [planted ${state}] ${line}`));
    planted.push({ state, verdict: got.verdict, identified: got.identified, consistent: got.consistent });
  }
  const powered = planted.every((p) => p.verdict === 'SUPPORTED');
  const verdict = powered ? out.verdict : 'UNINFORMATIVE';
  console.log(`power check at noise sd ${strength.noiseSd?.toFixed(3)}, gain ${strength.gain?.toFixed(2)}: ${planted.map((p) => `${p.state} ${p.verdict}`).join(', ')} -> ${verdict}`);
  const result = { schema: SCHEMA, claimLevel: 'MODEL_ONLY', predeclaration: { path: args.predeclaration, sha256: sha256(preBytes), id: declared.id },
    nightInputs: inputsBytes ? { path: args['night-inputs'], sha256: sha256(inputsBytes) } : null,
    readout: { path: pre.night.staticReadout.path, sha256: pre.night.staticReadout.sha256, images: images.length },
    ...out, analysisVerdict: out.verdict, powerCheck: { strength, planted, powered }, verdict, elapsedMs: Date.now() - t0 };
  if (args.out) writeFileSync(args.out, `${JSON.stringify(result, null, 1)}\n`);
}

if (!isMainThread && workerData?.tool === SCHEMA) {
  const { pre: preText, win, images, chunk } = workerData;
  const pre = JSON.parse(preText);
  const base = nightInputs(pre.night);
  const { injectAt, endFrame } = windowUpdates(win, pre.method);
  const run = windowRunner(base, injectAt);
  // A worker thread has its parent's port.
  (parentPort as NonNullable<typeof parentPort>).postMessage(chunk.map((state: number) => ({ state, ...scoreSeries(run(state, endFrame), injectAt, images, win, pre.method.offsets, pre.method.seedToFirstFrameMs, 2, pre.method.robust ?? null) })));
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}

