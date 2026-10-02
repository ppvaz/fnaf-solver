#!/usr/bin/env node
// The camera static's blend coefficient as a readout of a phone night's random stream (ROADMAP S2, diagnostic sweep).
//
//   node packages/propose/bin/recompile/phone-static-readout.ts --predeclaration FILE [--workers 6] [--out FILE.json]
//
// Every 100 ms the Office sheet sets the static's blend coefficient from a fresh draw: value 0 = Random(50) + 125
// (g58, which then sets the coefficient to v0 + v1 - v2 - v3), v1 = Random(5) * 10 every 490 ms (g59), v2 = 50 on
// Random(31) == 30 (g192), v3 = 100 + Random(100) every 200 ms while the view overlaps the Puppet (g498); g827/g828
// with g478 make it opaque on Custom Night's CAM 08/09. While the cameras are up, the captured frame's mean luma
// follows the static's opacity in steps at each g58 period. For a winding window, every generator state is injected
// into the model just before the window (the model's own game state up to there, on the night's measured clock and
// landed contacts), its coefficient predicted per frame, and correlated with the retained frame trace's
// grid_mean_luma averaged over the frames of each g58 period. The predeclaration's rule decides, verbatim: per
// window IDENTIFIED or not, and for identified states their generator distance from the measured seed and from each
// other. DEVICE_MEASURED frames (retained, private) against MODEL_ONLY predictions.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { loadConfig, officeClock, traceColumns } from './phone-encounter-replay.ts';
import type { NightConfig } from './phone-encounter-replay.ts';
import { inputs } from './phone-stream-census.ts';
import type { Inputs } from './phone-stream-census.ts';
import { fanOut, predeclared, sha256, sweepArgs } from './sweep-common.ts';
import type { SweepArgs, SweepPredeclaration } from './sweep-common.ts';
import type { Sim } from '@sixam/source/fnaf2';
import { drawTrace } from '../../../source/recompile/model-draw-trace.ts';
import { RNG_INCREMENT, RNG_MASK, RNG_MULTIPLIER } from '../../../source/src/games/fnaf2/rng.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CONFIG = 'packages/propose/bin/recompile/phone-encounter-nights.json';
export const SCHEMA = 'phone-static-readout-v1';
const draw = (state: number, n: number) => (state * n) >> 16;   // CRun.random(N) on the post-draw state

/** The night's frame clock and per-image grid_mean_luma, from its hashed private trace. */
/** A predeclared window: the update a state is injected at, the frames it plays, and the view and time span it reads. */
export interface Win {
  readonly name: string, readonly injectAt: number, readonly endFrame: number, readonly fromMs: number, readonly toMs: number;
  readonly cam: number, readonly viewing: number, readonly detrendK?: number,
}
/** A static-readout predeclaration: its windows and the rule that scores them. */
interface StaticPre extends SweepPredeclaration {
  readonly kind?: string, readonly windows: readonly Win[];
  readonly decisionRule: { readonly minR: number, readonly minMargin: number, readonly radius: number, readonly alpha: number, readonly minHits: number };
}
/** The static's draws as the wired Sim keeps them: v0..v3, the coefficient and the g58 period count. */
export interface StaticState { v0: number, v1: number, v2: number, v3: number, alpha: number, block: number }
/** One start state's score over a window. */
type Score = ReturnType<typeof scoreState>;
/** A score with a correlation. */
type Scored = Score & { r: number };
/** The night's frame clock and luma (frames()). */
type Frames = ReturnType<typeof frames>;

export function frames(nightName: string, inputsRoot = ROOT) {
  // A static-readout night is configured, with its frame trace.
  const night = loadConfig(join(ROOT, CONFIG)).nights.find((n) => n.name === nightName) as
    NightConfig & { readonly trace: NonNullable<NightConfig['trace']> };
  const bytes = readFileSync(resolve(inputsRoot, night.trace.path));
  if (sha256(bytes) !== night.trace.sha256) throw new Error(`${night.trace.path}: not the recorded trace`);
  const cols = traceColumns(bytes.toString('utf8'), ['image_ns', 'grid_mean_luma']);
  const clock = officeClock(cols.image_ns, night.trace.first, { catchUp: true });
  // image j (from the first office frame) shows the state after its pass's last update: model frame passStart[j + 1]
  const shows = clock.imageMs.map((_, j) => (j + 1 < clock.passStart.length ? clock.passStart[j + 1] : clock.deltas.length));
  // A night recorded with night-run.sh --static-readout reads the camera picture's native pixels, matched to the
  // trace's frames by the image clock both share; a frame the recorder did not catch reads null. Otherwise the grid.
  let byImage = null as Map<number, number> | null;
  if (night.staticReadout) {
    const rows = readFileSync(resolve(inputsRoot, night.staticReadout.path));
    if (sha256(rows) !== night.staticReadout.sha256) throw new Error(`${night.staticReadout.path}: not the recorded static readout`);
    byImage = lumaByImage(rows.toString('utf8'), night.staticReadout.region ?? 'static_view');
  }
  return { imageMs: clock.imageMs, shows, source: byImage ? 'native static_view' : 'grid_mean_luma',
    luma: clock.imageMs.map((_, j): number | null => (byImage ? byImage.get(cols.image_ns[night.trace.first + j]) ?? null : cols.grid_mean_luma[night.trace.first + j])) };
}

/** Rec. 601 mean luma of one recorded region: native-regions.ts record's base64 of 0xRRGGBB words. */
export function regionMeanLuma(region: { readonly hex: string, readonly cols: number, readonly rows: number }) {
  const bytes = Buffer.from(region.hex, 'base64');
  if (bytes.length !== region.cols * region.rows * 4) throw new Error('a recorded region\'s pixels do not match its geometry');
  const words = new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  let sum = 0;
  for (const rgb of words) sum += 0.299 * ((rgb >> 16) & 0xff) + 0.587 * ((rgb >> 8) & 0xff) + 0.114 * (rgb & 0xff);
  return sum / words.length;
}

/** image_ns -> mean luma of one region, over native-regions.ts record rows (one JSON object per copied frame). */
export function lumaByImage(text: string, region: string) {
  const out = new Map<number, number>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.imageNs === null || row.imageNs === undefined || !row.regions?.[region]) continue;
    out.set(Number(row.imageNs), regionMeanLuma(row.regions[region]));
  }
  return out;
}

/**
 * Per model frame: the static's coefficient, whether it is shown, the view (counter `viewing`, selected camera) and
 * the g58 period, for the measured seed with the generator set to `state` after update `injectAt` (null: no injection).
 * Also the generator state after update `injectAt` and the number of draws spent by then, without injection.
 */
/**
 * Wire a Sim so its static draws keep their values in `st` (v0..v3, the coefficient, the g58 period count) and every
 * draw is counted through `count`: g58/g59/g192 as plant-sheet.ts spends them, g498 as drawViewed's last draw.
 * Wrappers are own properties, so a Sim restored from a snapshot needs wiring again.
 */
export function wireStatic(sim: Sim, st: StaticState, count: () => void = () => {}) {
  const next = sim.rng.next.bind(sim.rng);
  sim.rng.next = () => { count(); return next(); };
  sim.drawUnconditional = function drawUnconditional(this: Sim) {
    for (const t of this.unconditionalTimers) {
      if (this.opts.sourcedEveryOrigin && this.frame === 1) continue;
      t.counter -= this.frameUnits;
      if (t.counter > 0) continue;
      t.counter += t.delayUnits; this.rng.next(); this.unconditionalDraws += 1;
      if (t.group === 58) { st.v0 = draw(this.rng.state, 50) + 125; st.alpha = st.v0 + st.v1 - st.v2 - st.v3; st.block += 1; }
      else if (t.group === 59) st.v1 = draw(this.rng.state, 5) * 10;
      else if (t.group === 192) st.v2 = Math.floor(draw(this.rng.state, 31) / 30) * 50;
    }
  };
  const viewed = sim.drawViewed.bind(sim);
  sim.drawViewed = (f, part) => {
    const timer = sim.puppetStaticTimer; const before = sim.rng.state;
    viewed(f, part);
    const p = sim.puppet; const at = !p.out ? 11 : (typeof p.loc === 'number' ? p.loc : null);
    if ((part === undefined || part === 'g498') && sim.puppetStaticTimer > timer && at === sim.cam && sim.rng.state !== before) st.v3 = 100 + draw(sim.rng.state, 100);
    if (at !== sim.cam) st.v3 = 0;   // g499
  };
}

/** One update's static: its coefficient (0 where Custom Night's CAM 08/09 make it opaque), view and g58 period. */
export function staticRow(sim: Sim, st: StaticState) {
  const opaque = sim.opts.night === 7 && (sim.viewing === 8 || sim.viewing === 9);
  return { alpha: opaque ? 0 : Math.max(0, Math.min(255, st.alpha)), shown: sim.viewing > 0, cam: sim.cam, viewing: sim.viewing, block: st.block };
}

export function predict(inp: Pick<Inputs, 'night' | 'measuredSeed' | 'modelOptions' | 'customNight' | 'contacts'> & { readonly deltas?: number[] },
  { state = null, injectAt = 0, frames: total }: { state?: number | null, injectAt?: number, frames: number }) {
  const per: ReturnType<typeof staticRow>[] = [];
  const st: StaticState = { v0: 125, v1: 0, v2: 0, v3: 0, alpha: 255, block: 0 };
  let draws = 0; let atInject = null as { state: number, draws: number } | null;
  // The Sim is marked once it is wired.
  const observe = (sim: Sim & { __wired?: boolean }) => {
    if (!sim.__wired) { sim.__wired = true; wireStatic(sim, st, () => { draws += 1; }); }
    if (sim.frame === injectAt) { atInject = { state: sim.rng.state, draws }; if (state !== null) sim.rng.state = state; }
    per.push(staticRow(sim, st));
    return null;
  };
  drawTrace({ night: inp.night, seed: inp.measuredSeed, frames: total, modelOptions: inp.modelOptions,
    ...(inp.customNight ? { customNight: inp.customNight } : {}), contacts: inp.contacts, observe, frameTimes: inp.deltas });
  return { per, atInject };
}

/** Mean luma per g58 period over a window's frames that show the given view, edge periods dropped. */
export function blocks(per: readonly ReturnType<typeof staticRow>[], fr: Frames,
  { fromMs, toMs, cam, viewing }: Pick<Win, 'fromMs' | 'toMs' | 'cam' | 'viewing'>) {
  const groups = new Map<number, { alpha: number, ys: number[] }>();
  fr.imageMs.forEach((ms, j) => {
    if (ms < fromMs || ms > toMs) return;
    const p = per[fr.shows[j]];
    const luma = fr.luma[j];
    if (!p || !p.shown || p.cam !== cam || p.viewing !== viewing || luma === null) return;
    if (!groups.has(p.block)) groups.set(p.block, { alpha: p.alpha, ys: [] });
    (groups.get(p.block) as { ys: number[] }).ys.push(luma);
  });
  const all = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([block, g]) => ({ block, alpha: g.alpha, n: g.ys.length, mean: g.ys.reduce((a, b) => a + b, 0) / g.ys.length }));
  return all.slice(1, -1).filter((b) => b.n >= 3);
}

export function pearson(xs: readonly number[], ys: readonly number[]) {
  const n = xs.length; if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i += 1) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

/** r between a state's predicted opacity and the measured block means of one window. */
/**
 * Each value less the centred running mean of `k` values around it (fewer at the ends). The cameras pan on their own,
 * so the picture under the static drifts slowly while the static's coefficient steps every g58 period; a window's
 * `detrendK` removes that drift from both the measured means and the predicted opacity before they are correlated.
 */
export function detrend(xs: readonly number[], k: number | undefined) {
  if (!k) return xs;
  if (!Number.isInteger(k) || k < 3 || k % 2 === 0) throw new Error('detrendK must be an odd integer of at least 3');
  return xs.map((x, i) => { const w = xs.slice(Math.max(0, i - (k >> 1)), Math.min(xs.length, i + (k >> 1) + 1)); return x - w.reduce((a, b) => a + b, 0) / w.length; });
}

/** r between a state's predicted opacity and the measured block means of one window (detrended when the window says so). */
export function scoreState(inp: Inputs, fr: Frames, win: Win, state: number) {
  const { per } = predict(inp, { state, injectAt: win.injectAt, frames: win.endFrame });
  const b = blocks(per, fr, win);
  return { state, blocks: b.length, r: pearson(detrend(b.map((x) => 1 - x.alpha / 255), win.detrendK), detrend(b.map((x) => x.mean), win.detrendK)) };
}

/** The generator's cycle through `from`: state -> steps from `from` (the LCG splits 65,536 states into 4 cycles). */
export function cycleIndex(from: number) {
  const index = new Map<number, number>(); let s = from;
  for (let k = 0; !index.has(s); k += 1) { index.set(s, k); s = (s * RNG_MULTIPLIER + RNG_INCREMENT) & RNG_MASK; }
  return index;
}

/** The predeclared rule over one window's scores. */
export function identify<S extends { readonly state: number, readonly r: number | null }>(rule: Pick<StaticPre['decisionRule'], 'minR' | 'minMargin'>,
  scores: readonly S[]) {
  const ranked = scores.filter((s): s is S & { r: number } => s.r !== null).sort((a, b) => b.r - a.r || a.state - b.state);
  const [top, second] = ranked;
  const ok = top && top.r >= rule.minR && top.r - (second?.r ?? -1) >= rule.minMargin;
  return { verdict: ok ? 'IDENTIFIED' : 'UNIDENTIFIED', top: top ?? null, second: second ?? null };
}

/**
 * The confirmation (predeclaration kind `confirm`): per held-out window, the best r among the measured seed's cycle
 * states within `radius` steps of the model's own draw count, and its p-value against the window's full scan: the
 * chance that the best of 2 * radius + 1 random states does as well. A window is a hit below `alpha`.
 */
export function neighbourhoodP(scanRs: readonly number[], bestR: number, size: number) {
  const below = scanRs.filter((r) => r < bestR).length / scanRs.length;
  return 1 - below ** size;
}

async function confirm(pre: StaticPre, record: object, args: SweepArgs, inp: Inputs, fr: Frames, workers: number, all: readonly number[],
  t0: number) {
  const { radius, alpha, minHits } = pre.decisionRule;
  const windows = [];
  for (const win of pre.windows) {
    const control = predict(inp, { injectAt: win.injectAt, frames: win.endFrame });
    // The run injects at a frame it reaches.
    const atInject = control.atInject as NonNullable<typeof control.atInject>;
    const scores = await fanOut<number, Score>(import.meta.url, SCHEMA, { night: pre.night, win }, all, workers);
    const rs = scores.map((s) => s.r).filter((r) => r !== null).sort((a, b) => a - b);
    const byState = new Map(scores.map((s) => [s.state, s.r]));
    let s = pre.seed;
    for (let i = 0; i < atInject.draws - radius; i += 1) s = (s * RNG_MULTIPLIER + RNG_INCREMENT) & RNG_MASK;
    const offsets: { d: number, state: number, r: number | null | undefined }[] = [];
    for (let d = -radius; d <= radius; d += 1) { offsets.push({ d, state: s, r: byState.get(s) }); s = (s * RNG_MULTIPLIER + RNG_INCREMENT) & RNG_MASK; }
    const best = offsets.reduce((a, b) => (Number(b.r) > Number(a.r) ? b : a));
    // The scan scored every state of the neighbourhood.
    const bestR = best.r as number;
    const p = neighbourhoodP(rs, bestR, offsets.length);
    windows.push({ ...win, modelAtInject: control.atInject, rQuantiles: { p50: rs[rs.length >> 1], p95: rs[Math.floor(rs.length * 0.95)], p999: rs[Math.floor(rs.length * 0.999)], max: rs.at(-1) },
      scanRsSha256: sha256(JSON.stringify(rs)), below: rs.filter((r) => r < bestR).length, scanned: rs.length,
      top10: [...scores].filter((x): x is Scored => x.r !== null).sort((a, b) => b.r - a.r).slice(0, 10), best, p, hit: p < alpha, offsets });
    console.log(`${win.name}: best d=${best.d} state ${best.state} r ${bestR.toFixed(3)} (global max ${(rs.at(-1) as number).toFixed(3)}), p ${p.toExponential(2)} -> ${p < alpha ? 'hit' : 'miss'}`);
  }
  const hits = windows.filter((w) => w.hit).length;
  const verdict = hits >= minHits ? 'SUPPORTED' : 'NOT_SUPPORTED';
  console.log(`${hits} of ${windows.length} held-out windows hit: ${verdict}`);
  const result = { schema: SCHEMA, kind: 'confirm', claimLevel: 'DEVICE_MEASURED frames against MODEL_ONLY predictions', night: pre.night, seed: pre.seed,
    predeclaration: record, inputs: inp.hashes, windows, hits, verdict, elapsedMs: Date.now() - t0 };
  if (args.out) writeFileSync(args.out, `${JSON.stringify(result, null, 1)}\n`);
}

async function main(argv: string[]) {
  const args = sweepArgs(argv);
  const { pre, inp, record } = predeclared<StaticPre, Inputs>(args.predeclaration, inputs);
  const fr = frames(pre.night);
  const { workers } = args;
  const all = Array.from({ length: 0x10000 }, (_, s) => s);
  const cycle = cycleIndex(pre.seed);
  const t0 = Date.now();
  if (pre.kind === 'confirm') return confirm(pre, record, args, inp, fr, workers, all, t0);
  const windows = [];
  for (const win of pre.windows) {
    const control = predict(inp, { injectAt: win.injectAt, frames: win.endFrame });
    // The run injects at a frame it reaches.
    const atInject = control.atInject as NonNullable<typeof control.atInject>;
    const controlR = pearson(...((): [number[], number[]] => { const b = blocks(control.per, fr, win); return [b.map((x) => 1 - x.alpha / 255), b.map((x) => x.mean)]; })());
    const scores = await fanOut<number, Score>(import.meta.url, SCHEMA, { night: pre.night, win }, all, workers);
    const decision = identify(pre.decisionRule, scores);
    const rs = scores.map((s) => s.r).filter((r) => r !== null).sort((a, b) => a - b);
    const top = decision.top;
    windows.push({ ...win, modelAtInject: control.atInject, controlR,
      rQuantiles: { p50: rs[rs.length >> 1], p95: rs[Math.floor(rs.length * 0.95)], p999: rs[Math.floor(rs.length * 0.999)], max: rs.at(-1) },
      top10: [...scores].filter((s): s is Scored => s.r !== null).sort((a, b) => b.r - a.r).slice(0, 10), decision,
      ...(top ? { topInSeedCycle: cycle.has(top.state), stepsFromSeed: cycle.get(top.state) ?? null,
        stepsFromSeedLessModelDraws: cycle.has(top.state) ? (cycle.get(top.state) as number) - atInject.draws : null } : {}) });
  }
  const [a, b] = windows;
  // An identified window has its top state.
  const between = a?.decision.verdict === 'IDENTIFIED' && b?.decision.verdict === 'IDENTIFIED'
    ? (() => { const c = cycleIndex((a.decision.top as Scored).state); return { sameCycle: c.has((b.decision.top as Scored).state), steps: c.get((b.decision.top as Scored).state) ?? null,
      modelDraws: (b.modelAtInject as NonNullable<typeof b.modelAtInject>).draws - (a.modelAtInject as NonNullable<typeof a.modelAtInject>).draws }; })() : null;
  const result = { schema: SCHEMA, claimLevel: 'DEVICE_MEASURED frames against MODEL_ONLY predictions', night: pre.night, seed: pre.seed,
    predeclaration: record, inputs: inp.hashes, windows, between, elapsedMs: Date.now() - t0 };
  if (args.out) writeFileSync(args.out, `${JSON.stringify(result, null, 1)}\n`);
  for (const w of windows) {
    console.log(`${w.name}: control r ${w.controlR?.toFixed(3)}; r quantiles ${JSON.stringify(Object.fromEntries(Object.entries(w.rQuantiles).map(([k, v]) => [k, Number((v as number).toFixed(3))])))}`);
    console.log(`  top ${w.top10.slice(0, 5).map((s) => `${s.state}:${s.r.toFixed(3)}`).join(' ')} -> ${w.decision.verdict}`);
    if (w.decision.top) console.log(`  top state ${w.decision.top.state}: in the seed's cycle ${w.topInSeedCycle}, steps from seed ${w.stepsFromSeed}, less the model's ${(w.modelAtInject as NonNullable<typeof w.modelAtInject>).draws} draws by update ${w.injectAt}: ${w.stepsFromSeedLessModelDraws}`);
  }
  if (between) console.log(`between windows: same cycle ${between.sameCycle}, steps ${between.steps}, the model's draws ${between.modelDraws}`);
}

if (!isMainThread && workerData?.tool === SCHEMA) {
  const inp = inputs(workerData.night);
  const fr = frames(workerData.night);
  // A worker thread has its parent's port.
  (parentPort as NonNullable<typeof parentPort>).postMessage(workerData.chunk.map((s: number) => scoreState(inp, fr, workerData.win, s)));
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
