#!/usr/bin/env node
// Which of a phone night's office draws move when its presses land a few updates differently, and does the static
// readout's prediction inside a winding window survive the clock a trace-free night would have? (ROADMAP S2,
// exploratory characterization; MODEL_ONLY.)
//
//   node packages/propose/bin/recompile/phone-draw-sensitivity.ts --night full-06 [--frames 3000] [--custom-night DIALS.json]
//     [--out FILE.json]
//
// --custom-night replays the night's clock and contacts at another Custom Night dial vector (a design question:
// which dials leave a readout window's draws independent of the presses), not the phone's own night.
//
// A. Draw sites. The production Sim replays the night on its measured clock twice: with the primary variant's
//    contacts (each press on the update that drew its landing frame) and with the `sched` rule (the same clock,
//    each press on the update of its send, no landing latency). Every Random draw is attributed to the model
//    function and line that spent it; a site MOVES when its list of updates differs between the two replays.
//    Line numbers name the model whose sources are hashed in the record.
// B. Readout windows. For each winding window of the static-readout predeclarations, one fixed generator state is
//    injected at the window's start and the static's coefficient predicted per g58 period under four clocks: the
//    primary variant (reference), `sched`, a constant 60 Hz clock (`const60`, what a night without a frame trace
//    has) and the frame trace thinned to half its frames with the catch-up rule (what a recorder at ~30 fps sees).
//    Each variant scores its best agreement with the reference over injected states 0..30 steps either way along
//    the generator's cycle (a constant draw offset is harmless to a scan over every state).
//
// Explanations it characterizes, not tests (the record is exploratory, made after the sweeps were first run by
// hand): E-press, the readout's window prediction depends on press landing through press-anchored draw sites;
// E-clock, a trace-free night's 60 Hz clock keeps the window's draw interleaving.
import { sha256, stepRng } from './sweep-common.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inputs } from './phone-stream-census.ts';
import type { Inputs } from './phone-stream-census.ts';
import { predict } from './phone-static-readout.ts';
import type { Win } from './phone-static-readout.ts';
import { cumTick, cumulative, FRAME_MS, loadConfig, mapSchedule, officeClock, phoneSchedule, traceColumns, traceTick } from './phone-encounter-replay.ts';
import type { NightConfig } from './phone-encounter-replay.ts';
import type { Sim } from '@sixam/source/fnaf2';
import { modelContacts } from './schedule-to-input.ts';
import { drawTrace, MODEL_SOURCES } from '../../../source/recompile/model-draw-trace.ts';

export const SCHEMA = 'phone-draw-sensitivity-v1';
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const CONFIG = 'packages/propose/bin/recompile/phone-encounter-nights.json';
const PREDECLARATIONS = ['docs/evidence/full06-static-readout-predeclaration-20261001.json',
  'docs/evidence/full06-static-readout-confirm-predeclaration-20261001.json',
  'docs/evidence/full06-static-readout-detrended-predeclaration-20261001.json'];
const INJECTED = 12345;
const SHIFT = 30;
/** A traced night of the config. */
type TracedNight = NightConfig & { readonly trace: NonNullable<NightConfig['trace']> };
/** A clock variant: the update deltas and the contacts mapped onto them. */
type Variant = { name: string, what: string, deltas: number[], contacts: Inputs['contacts'] };


/** The share of a reference sequence matched by `s` at its best alignment within two periods either way. */
export function agreement(ref: readonly number[], s: readonly number[]) {
  let best = 0;
  for (let off = -2; off <= 2; off += 1) {
    let agree = 0; let n = 0;
    for (let i = 0; i < ref.length; i += 1) { const j = i + off; if (j < 0 || j >= s.length) continue; n += 1; if (s[j] === ref[i]) agree += 1; }
    if (n && agree / n > best) best = agree / n;
  }
  return best;
}

/**
 * Per site, the updates at which it drew up to `horizon` (the shorter replay's last update: a replay that ends at a
 * death stops spending draws there); a site MOVES when its lists differ inside the horizon.
 */
export function compareSites(a: ReadonlyMap<string, readonly number[]>, b: ReadonlyMap<string, readonly number[]>, horizon = Infinity) {
  const upTo = (list: readonly number[] | undefined) => (list ?? []).filter((u) => u <= horizon);
  return [...new Set([...a.keys(), ...b.keys()])].sort().map((site) => {
    const ua = upTo(a.get(site)); const ub = upTo(b.get(site));
    const i = ua.findIndex((u, k) => ub[k] !== u);
    const moved = ua.length !== ub.length || i >= 0;
    const at = i >= 0 ? i : Math.min(ua.length, ub.length);
    return { site, draws: [ua.length, ub.length], moved, firstMoved: moved ? [ua[at] ?? null, ub[at] ?? null] : null };
  });
}

function clockVariants(night: TracedNight, base: Inputs): Variant[] {
  const cols = traceColumns(readFileSync(resolve(ROOT, night.trace.path), 'utf8'), ['image_ns']);
  const winner = JSON.parse(readFileSync(resolve(ROOT, 'packages/propose/bindings/fnaf2/campaign-night7-k3-winner.json'), 'utf8'));
  const sched = phoneSchedule(winner, night.night, night.originMs);
  const shift = night.trace.releaseAfterFirstNightFrameMs - night.originMs;
  const onClock = (imageNs: readonly number[], first: number) => {
    const clock = officeClock(imageNs, first, { catchUp: true });
    return { deltas: clock.deltas.map((d) => Number(d.toFixed(6))), contacts: modelContacts(mapSchedule(sched, (ms) => traceTick(ms + shift, clock)).contacts) };
  };
  // half the frames, chosen by a fixed LCG, the first night frame always kept
  let s = 7; const keep = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) < 0.5;
  const kept: number[] = []; let first = null as number | null;
  cols.image_ns.forEach((ns, k) => { if (k === night.trace.first) { first = kept.length; kept.push(ns); } else if (keep()) kept.push(ns); });
  return [
    { name: 'landed', what: 'the primary variant: measured clock, each press on its landing frame', deltas: base.deltas, contacts: base.contacts },
    { name: 'sched', what: 'the same clock, each press on the update of its send', ...onClock(cols.image_ns, night.trace.first) },
    { name: 'const60', what: 'a constant 60 Hz clock, presses mid-update (a night without a frame trace)', deltas: [], contacts: modelContacts(mapSchedule(sched, (ms) => cumTick(ms, [])).contacts) },
    // The first night frame is always kept.
    { name: 'thinned50', what: 'the frame trace thinned to half its frames, catch-up rule', ...onClock(kept, first as number) },
  ];
}

function sites(base: Inputs, contacts: Inputs['contacts'], frames: number) {
  const per = new Map<string, number[]>();
  const run = drawTrace({ night: base.night, seed: base.measuredSeed, frames, modelOptions: base.modelOptions,
    ...(base.customNight ? { customNight: base.customNight } : {}), contacts, frameTimes: base.deltas,
    // The Sim is marked once its draws are counted.
    observe: (sim: Sim & { __site?: boolean }) => {
      if (!sim.__site) {
        sim.__site = true; const next = sim.rng.next.bind(sim.rng);
        sim.rng.next = () => {
          const frame = (new Error().stack as string).split('\n').slice(2).find((l) => !/[/\\]rng\.ts:|Rng\.(int|next)/.test(l)) ?? '';
          const m = frame.match(/at (?:Sim\.|Module\.)?([\w$]+) \(.*[/\\]([\w-]+\.ts):(\d+)/);
          const site = m ? `${m[1]}@${m[2]}:${m[3]}` : 'UNKNOWN';
          if (!per.has(site)) per.set(site, []);
          (per.get(site) as number[]).push(sim.frame + 1);
          return next();
        };
      }
      return null;
    } });
  return { per, last: run.out.length - 1, outcome: run.won ? '6am' : run.death ? `death:${run.death.reason}` : 'alive' };
}

function windowSequence(base: Inputs, v: Variant, w: Win, cumRef: readonly number[], state: number) {
  const updateAt = (deltas: readonly number[], ms: number) => { let cum = 0; for (let u = 0; ; u += 1) { if (cum >= ms) return u; cum += deltas[u] ?? FRAME_MS; } };
  const injectAt = updateAt(v.deltas, cumRef[w.injectAt]);
  const endFrame = updateAt(v.deltas, cumRef[w.endFrame]);
  const { per } = predict({ ...base, deltas: v.deltas.length ? v.deltas : undefined, contacts: v.contacts }, { state, injectAt, frames: endFrame });
  const cum = cumulative(v.deltas, endFrame + 2);
  const byBlock = new Map<number, number>();
  per.forEach((p, u) => { if (u >= injectAt && cum[u] >= w.fromMs && cum[u] <= w.toMs && p.shown && !byBlock.has(p.block)) byBlock.set(p.block, p.alpha); });
  return [...byBlock.values()];
}

async function main(argv: string[]) {
  const args: Record<string, string> = { frames: '3000' };
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--night', '--frames', '--custom-night', '--out'].includes(argv[i]) || !argv[i + 1]) throw new Error('see usage at top of file');
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.night) throw new Error('--night is required');
  const night = loadConfig(join(ROOT, CONFIG)).nights.find((n) => n.name === args.night);
  if (!night?.trace) throw new Error(`${args.night} has no frame trace`);
  const measured = inputs(args.night);
  const dials = args['custom-night'] ? JSON.parse(readFileSync(resolve(args['custom-night']), 'utf8')) : null;
  const base = dials ? { ...measured, customNight: dials } : measured;
  const variants = clockVariants(night as TracedNight, base);
  const t0 = Date.now();
  const frames = Number(args.frames);
  const landedSites = sites(base, base.contacts, frames);
  const schedSites = sites(base, variants[1].contacts, frames);
  const horizon = Math.min(landedSites.last, schedSites.last);
  const siteRows = compareSites(landedSites.per, schedSites.per, horizon).filter((r) => r.draws[0] || r.draws[1]);
  const windows: Win[] = PREDECLARATIONS.flatMap((p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8')).windows)
    .filter((w, i, all) => all.findIndex((x) => x.name === w.name) === i).sort((a, b) => a.fromMs - b.fromMs);
  const cumRef = cumulative(base.deltas, 40000);
  const windowRows = windows.map((w) => {
    const ref = windowSequence(base, variants[0], w, cumRef, INJECTED);
    const scores = variants.slice(1).map((v) => {
      let best = { k: null as number | null, agreement: -1 };
      for (let k = -SHIFT; k <= SHIFT && best.agreement < 1; k += 1) {
        const a = agreement(ref, windowSequence(base, v, w, cumRef, stepRng(INJECTED, k)));
        if (a > best.agreement) best = { k, agreement: a };
      }
      return { variant: v.name, ...best };
    });
    return { window: w.name, fromMs: w.fromMs, toMs: w.toMs, periods: ref.length, scores };
  });
  const result = {
    schema: SCHEMA, claimLevel: 'MODEL_ONLY', night: args.night, exploratory: true, ...(dials ? { customNight: dials } : {}),
    model: Object.fromEntries(MODEL_SOURCES.map((p) => [p.slice(ROOT.length + (ROOT.endsWith('/') ? 0 : 1)), sha256(readFileSync(p))])),
    inputs: base.hashes,
    variants: variants.map((v) => ({ name: v.name, what: v.what, contactsSha256: sha256(JSON.stringify(v.contacts)), deltas: v.deltas.length })),
    drawSites: { frames, horizon, replays: { landed: { last: landedSites.last, outcome: landedSites.outcome }, sched: { last: schedSites.last, outcome: schedSites.outcome } }, rows: siteRows },
    readoutWindows: { injectedState: INJECTED, shiftRange: SHIFT, rows: windowRows },
    runFacts: { elapsedMs: Date.now() - t0 },
  };
  if (args.out) writeFileSync(args.out, `${JSON.stringify(result, null, 1)}\n`);
  for (const r of siteRows) console.log(`${r.moved ? 'MOVES' : 'same '} ${r.site.padEnd(46)} ${r.draws.join('/').padEnd(11)} ${r.firstMoved ? `first ${r.firstMoved.join(' vs ')}` : ''}`);
  for (const w of windowRows) console.log(`${w.window.padEnd(8)} ${w.scores.map((s) => `${s.variant} ${s.agreement.toFixed(2)}@${s.k}`).join('  ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
