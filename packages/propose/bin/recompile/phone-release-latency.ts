#!/usr/bin/env node
// How late after its send can a release land, for the model to play a phone night the way the phone played it?
// (ROADMAP S2: release acceptance, one of its open items.) EXPLORATORY.
//
//   node packages/propose/bin/recompile/phone-release-latency.ts [--out FILE]
//
// The encounter replays land every contact's press AND release the night's median monitor landing latency after its
// send. Two phone-won nights are replayed through the production Sim on their measured clocks with presses at that
// latency and releases at each latency of a sweep: the 0/20 measurement night (its read seed 23712) and full-06 at
// 10/20 (its measured seed 47593, scored against its eyehole windows). The night's own outcome bounds the release
// latency: a value at which the model loses a night the phone won is excluded. MODEL_ONLY replays over
// DEVICE_MEASURED clocks, landings and outcomes.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { currentPath } from '@sixam/review/renamed-path';
import { drawTrace } from '../../../source/recompile/model-draw-trace.ts';
import { landingLatency, loadConfig, mapSchedule, officeClock, phoneSchedule, traceColumns, traceTick } from './phone-encounter-replay.ts';
import { inputs as censusInputs, playState } from './phone-stream-census.ts';
import { modelContacts } from './schedule-to-input.ts';
import { sha256 } from './sweep-common.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
export const SCHEMA = 'phone-release-latency-v1';
export const SWEEP_MS = [70, 60, 50, 40, 30, 20, 10, 0];

/** Contacts with presses `pressMs` and releases `releaseMs` after their sends, on a measured clock. */
export function landedContacts(sched, clock, shift, pressMs, releaseMs) {
  return mapSchedule(sched, (ms, kind) => traceTick(ms + shift + (kind === 'release' ? releaseMs : pressMs), clock));
}

function zeroOfTwenty() {
  const spec = JSON.parse(readFileSync(join(ROOT, 'docs/evidence/s2-seed-scan-night7-0of20-spec-20261001.json'), 'utf8'));
  const inputs = JSON.parse(readFileSync(join(ROOT, 'docs/evidence/s2-region-readout-night7-0of20-inputs-20261001.json'), 'utf8'));
  const text = readFileSync(resolve(ROOT, spec.trace.path), 'utf8');
  if (sha256(text) !== spec.trace.sha256) throw new Error(`${spec.trace.path}: not the recorded trace`);
  const cols = traceColumns(text, ['image_ns', 'monitor_luma']);
  const first = cols.image_ns.findIndex((ns) => Math.abs(ns - Math.round(inputs.onsetDeviceMs * 1e6)) < 1e6);
  const clock = officeClock(cols.image_ns, first, { catchUp: true });
  const winner = JSON.parse(readFileSync(resolve(ROOT, currentPath(ROOT, spec.winner)), 'utf8'));
  const originMs = spec.seedToFirstFrameMs + inputs.releasedAimMs;
  const sched = phoneSchedule(winner, 7, originMs);
  const shift = inputs.releasedAimMs - originMs;
  const press = landingLatency(cols, first, sched.queueMs.filter(([, k, a]) => k === 'press' && a === 'monitor').map(([ms]) => ms + shift)).medianMs;
  const cfg = loadConfig(join(ROOT, 'packages/propose/bin/recompile/phone-encounter-nights.json'));
  const modelOptions = JSON.parse(readFileSync(resolve(ROOT, currentPath(ROOT, cfg.modelOptions)), 'utf8'));
  const deltas = clock.deltas.map((d) => Number(d.toFixed(6)));
  const rows = [press, ...SWEEP_MS].map((releaseMs) => {
    const mapped = landedContacts(sched, clock, shift, press, releaseMs);
    const run = drawTrace({ night: 7, seed: 23712, frames: deltas.length + 120, modelOptions, customNight: spec.customNight,
      contacts: modelContacts(mapped.contacts), frameTimes: deltas });
    return { releaseMs, outcome: run.won ? '6am' : run.death ? `death:${run.death.reason}@${run.death.t.toFixed(1)}` : 'alive', stretched: mapped.stretched };
  });
  return { night: 'night7-k3-0of20-sr01-20261001T221003Z', dials: '0/20', seed: 23712, seedSource: 'docs/evidence/s2-seed-scan-night7-0of20-20261001.json',
    phone: '6am', pressLandingMs: press, rows };
}

function fullSix() {
  const cfg = loadConfig(join(ROOT, 'packages/propose/bin/recompile/phone-encounter-nights.json'));
  const n = cfg.nights.find((x) => x.name === 'full-06');
  const base = censusInputs('full-06');
  const cols = traceColumns(readFileSync(resolve(ROOT, n.trace.path), 'utf8'), ['image_ns', 'monitor_luma']);
  const clock = officeClock(cols.image_ns, n.trace.first, { catchUp: true });
  const winner = JSON.parse(readFileSync(resolve(ROOT, currentPath(ROOT, n.winner)), 'utf8'));
  const sched = phoneSchedule(winner, n.night, n.originMs);
  const shift = n.trace.releaseAfterFirstNightFrameMs - n.originMs;
  const press = landingLatency(cols, n.trace.first, sched.queueMs.filter(([, k, a]) => k === 'press' && a === 'monitor').map(([ms]) => ms + shift)).medianMs;
  const rows = [press, ...SWEEP_MS].map((releaseMs) => {
    const mapped = landedContacts(sched, clock, shift, press, releaseMs);
    const r = playState({ ...base, contacts: modelContacts(mapped.contacts), queue: mapped.queue }, base.measuredSeed, null);
    return { releaseMs, outcome: r.outcome, prefix: r.prefix, agree: r.agree, compared: r.compared, codes: r.codes, stretched: mapped.stretched };
  });
  return { night: n.run, dials: '10/20', seed: base.measuredSeed, seedSource: n.seedEvidence, phone: n.phone.terminal.result, phoneWindows: base.phone, pressLandingMs: press, rows };
}

function main(argv) {
  const out = argv[0] === '--out' ? argv[1] : null;
  const nights = [zeroOfTwenty(), fullSix()];
  const result = { schema: SCHEMA, claimLevel: 'MODEL_ONLY replays over DEVICE_MEASURED clocks, landings and outcomes', exploratory: true, sweepMs: SWEEP_MS, nights };
  if (out) writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
  for (const n of nights) {
    console.log(`${n.night} (${n.dials}, phone ${n.phone}, press landing ${n.pressLandingMs} ms):`);
    for (const r of n.rows) console.log(`  release ${String(r.releaseMs).padStart(5)} ms: ${r.outcome}${r.agree !== undefined ? `, windows ${r.agree}/${r.compared}, prefix ${r.prefix}` : ''}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
