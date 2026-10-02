#!/usr/bin/env node
// The office seed of a phone night, from its static readout, against the phone's own wall clock (ROADMAP S2a).
//
//   node packages/propose/bin/recompile/phone-seed-readout.ts --predeclaration SEED_PRE.json --readout RESULT.json
//       --night-inputs INPUTS.json [--out FILE]
//
// RESULT.json is phone-region-readout.ts's analysis of the night (its consecutive windows' top states and pairs).
// The anchor is the earliest window that starts two consecutive consistent pairs: its state is on the stream. Stepped
// back by the model's draws to the first window's injection, it is the stream's state there (S1). The rule under test
// is the wall-clock seed: Fusion seeds the office generator with the phone's wall clock in milliseconds, mod 65,536,
// `x` ms before the night onset, and the phone spends the model's draws to the first window plus `c`. Every x in the
// predeclared bracket is tried with the predeclared c; a hit is S1 = seed_x advanced D1 + c draws. Under the null (a
// seed unrelated to the clock) a hit has probability about (bracket width) / 65,536. Every x is also reported with
// the c it would need, for the record (not tested). MODEL_ONLY draw counts over DEVICE_MEASURED states and clocks.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { drawTrace } from '../../../source/recompile/model-draw-trace.ts';
import { cycleIndex } from './phone-static-readout.ts';
import { measuredNight, nightInputs, windowRunner, windowUpdates } from './phone-region-readout.ts';
import type { RegionPre } from './phone-region-readout.ts';
import { sha256 } from './sweep-common.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
export const SCHEMA = 'phone-seed-readout-v1';

/** The generator `k` steps back from `s` (33543 is 31415's inverse mod 65,536). */
export const back = (s: number, k: number) => { let x = s; for (let i = 0; i < k; i += 1) x = (((x - 1) & 0xffff) * 33543) & 0xffff; return x; };

/** The earliest window index whose pair and the next pair are both consistent within `tolerance`, or null. */
export function anchorIndex(pairs: readonly { differ: number | null }[], tolerance: number) {
  const ok = (p: { differ: number | null } | undefined) => !!p && p.differ !== null && Math.abs(p.differ) <= tolerance;
  for (let k = 0; k + 1 < pairs.length; k += 1) if (ok(pairs[k]) && ok(pairs[k + 1])) return k;
  return null;
}

/** For each x in [lo, hi]: the wall-clock seed and the draws c beyond D1 it would need to reach S1 (null off its cycle). */
export function seedCandidates(onsetPhoneWallMs: number, s1: number, d1: number, lo: number, hi: number) {
  const rows = [];
  for (let x = lo; x <= hi; x += 1) {
    const seed = Math.floor(onsetPhoneWallMs - x) % 65536;
    const steps = cycleIndex(seed).get(s1);
    rows.push({ x, seed, c: steps === undefined ? null : steps - d1 });
  }
  return rows;
}

function main(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--predeclaration', '--readout', '--night-inputs', '--out'].includes(argv[i]) || !argv[i + 1]) throw new Error('see usage at top of file');
    args[argv[i].slice(2)] = argv[i + 1];
  }
  const preBytes = readFileSync(args.predeclaration);
  const pre = JSON.parse(preBytes.toString('utf8'));
  const readoutBytes = readFileSync(args.readout);
  const readout = JSON.parse(readoutBytes.toString('utf8'));
  const inputsBytes = readFileSync(args['night-inputs']);
  const inputs = JSON.parse(inputsBytes.toString('utf8'));
  const readoutPre: RegionPre = JSON.parse(readFileSync(join(ROOT, readout.predeclaration.path), 'utf8'));
  if (readout.verdict !== 'SUPPORTED') {
    const result = { schema: SCHEMA, verdict: 'UNINFORMATIVE', reason: `the night's readout is ${readout.verdict}: no state is known on the stream` };
    if (args.out) writeFileSync(args.out, `${JSON.stringify(result, null, 1)}\n`);
    console.log(result.reason);
    return;
  }
  const night = measuredNight(readoutPre, inputs, readout.predeclaration.sha256);
  const base = nightInputs(night);
  const { method, windows } = readoutPre;
  const k = anchorIndex(readout.pairs, readoutPre.decisionRule.consistencyDraws);
  if (k === null) throw new Error('a SUPPORTED readout with no two consecutive consistent pairs');
  const anchor = readout.windows[k];
  const first = windowUpdates(windows[0], method).injectAt;
  const at = windowUpdates(windows[k], method).injectAt;
  const between = k === 0 ? 0 : (windowRunner(base, first)(0, at).at(-1)?.draws ?? 0);
  const s1 = back(anchor.reading.top.state, between);
  const d1 = (drawTrace({ night: base.night, seed: 0, frames: first, modelOptions: base.modelOptions,
    // The replay plays at least its first frame.
    ...(base.customNight ? { customNight: base.customNight } : {}), contacts: base.contacts }).out.at(-1) as { draws: number }).draws;
  const events = readFileSync(join(ROOT, 'docs/evidence/runs', inputs.run, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const onsetPhoneWallMs = events.find((r) => r.type === 'origin.anchor' && r.status === 'scheduled' && Number.isFinite(r.onsetPhoneWallMs))?.onsetPhoneWallMs;
  if (!Number.isFinite(onsetPhoneWallMs)) throw new Error(`${inputs.run}: the pack holds no onsetPhoneWallMs`);
  const { bracketMs: [lo, hi], extraDraws } = pre.decisionRule;
  const candidates = seedCandidates(onsetPhoneWallMs, s1, d1, lo, hi);
  const hits = candidates.filter((r) => r.c === extraDraws);
  const verdict = hits.length ? 'SUPPORTED' : 'NOT_SUPPORTED';
  const result = { schema: SCHEMA, claimLevel: 'DEVICE_MEASURED states and clocks against MODEL_ONLY draw counts',
    predeclaration: { path: args.predeclaration, sha256: sha256(preBytes), id: pre.id },
    readout: { path: args.readout, sha256: sha256(readoutBytes), id: readout.id ?? null },
    nightInputs: { path: args['night-inputs'], sha256: sha256(inputsBytes) },
    anchor: { window: anchor.name, state: anchor.reading.top.state, drawsBackToFirstWindow: between }, s1, d1, onsetPhoneWallMs,
    candidates, hits, verdict };
  if (args.out) writeFileSync(args.out, `${JSON.stringify(result, null, 1)}\n`);
  console.log(`S1 ${s1} (from ${anchor.name}, ${between} draws back), D1 ${d1}; ${hits.length ? `hit at x = ${hits.map((h) => h.x).join(', ')}` : 'no hit'}: ${verdict}`);
  console.log(`c needed per x (null off-cycle): ${candidates.filter((r) => r.c !== null && Math.abs(r.c) <= 50).map((r) => `${r.x}:${r.c}`).join(' ') || 'none within 50'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
