#!/usr/bin/env node
// Keeping a phone night's measured seed, does one change before Balloon Boy's first roll reproduce both the phone's
// Balloon Boy audio and its mask windows? (ROADMAP S2, diagnostic sweep)
//
//   node packages/propose/bin/recompile/phone-early-perturbation.ts --predeclaration FILE [--workers 6] [--out FILE.json]
//
// Members: each landed contact pressed before the first window's mask press, shifted -3..+3 updates or removed; and
// the generator advanced or stepped back one or two draws after one update in 0..300. Each member is one full-night
// replay through the production Sim (phone-stream-census.ts inputs()), scored on the predeclared fingerprints and
// decided by the predeclared rule, verbatim. MODEL_ONLY: a fitting member is a hypothesis about the phone.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cumulative, maskPresses, scoreWindows, windowCodes, WINDOW_MS } from './phone-encounter-replay.ts';
import { LEDGERS } from './compare-schedule-replay.ts';
import { inputs } from './phone-stream-census.ts';
import type { Inputs } from './phone-stream-census.ts';
import { fanOut, predeclared, sweepArgs } from './sweep-common.ts';
import type { DeclaredFields, SweepPredeclaration } from './sweep-common.ts';
import { isRecord } from '@sixam/kernel';
import type { Sim } from '@sixam/source/fnaf2';
import { drawTrace } from '../../../source/recompile/model-draw-trace.ts';
import { RNG_INCREMENT, RNG_MASK, RNG_MULTIPLIER } from '../../../source/src/games/fnaf2/rng.ts';

export const SCHEMA = 'phone-early-perturbation-v1';
const CODE: Readonly<Record<string, string>> = { withbonnie: 'B', withchica: 'C', withfreddy: 'F', toybonnie: 'b', toychica: 'c', toyfreddy: 'f', mangle: 'M', bb: 'x' };
const INVERSE = (() => { for (let m = 1; m < 0x10000; m += 2) if (((RNG_MULTIPLIER * m) & RNG_MASK) === 1) return m; throw new Error('no inverse'); })();
/** The generator's state `k` draws on (k < 0: back). */
/** A contact as the family reads it: its control (or Sim action) and its updates. */
type FamilyContact = { readonly control?: string, readonly action?: string, readonly downFrame: number, readonly upFrame: number };
/** A member of the predeclared family: a contact shifted or dropped, draws added or removed at an update, or none. */
export type Member = { kind: 'shift', index: number, control?: string, d: number }
  | { kind: 'drop', index: number, control?: string } | { kind: 'draws', update: number, k: number } | { kind: 'none' };
/** An early-perturbation predeclaration: its rule. */
interface EarlyPre extends SweepPredeclaration { readonly decisionRule: { readonly minAgree: number } }

/** An early-perturbation predeclaration's own field: the agreement a member needs to fit. */
export function earlyPredeclaration(fields: DeclaredFields, where: string): EarlyPre {
  const rule = fields.decisionRule;
  if (!isRecord(rule) || !Number.isInteger(rule.minAgree) || Number(rule.minAgree) < 0)
    throw new Error(`${where}: decisionRule.minAgree must be a whole number of windows`);
  return fields as unknown as EarlyPre;
}
/** One member's night (playMember). */
type MemberRow = ReturnType<typeof playMember>;

export function stepState(state: number, k: number) {
  let s = state;
  for (let i = 0; i < Math.abs(k); i += 1)
    s = k > 0 ? (s * RNG_MULTIPLIER + RNG_INCREMENT) & RNG_MASK : (((s - RNG_INCREMENT) & RNG_MASK) * INVERSE) & RNG_MASK;
  return s;
}

/** Every member of the predeclared family, as plain data. */
export function family(contacts: readonly FamilyContact[], firstMaskTick: number, lastDrawUpdate = 300) {
  const out: Member[] = [];
  contacts.forEach((c, index) => {
    if (c.downFrame >= firstMaskTick) return;
    for (const d of [-3, -2, -1, 1, 2, 3]) out.push({ kind: 'shift', index, control: c.control ?? c.action, d });
    out.push({ kind: 'drop', index, control: c.control ?? c.action });
  });
  for (let u = 0; u <= lastDrawUpdate; u += 1) for (const k of [-2, -1, 1, 2]) out.push({ kind: 'draws', update: u, k });
  return out;
}

/** The contacts a member plays: one shifted (edges kept in order, nothing before update 1) or removed. */
export function memberContacts<C extends { readonly downFrame: number, readonly upFrame: number }>(contacts: readonly C[], member: Member) {
  if (member.kind === 'drop') return contacts.filter((_, i) => i !== member.index);
  if (member.kind !== 'shift') return contacts;
  return contacts.map((c, i) => {
    if (i !== member.index) return c;
    const downFrame = Math.max(1, c.downFrame + member.d);
    return { ...c, downFrame, upFrame: Math.max(downFrame + 1, c.upFrame + member.d) };
  }).sort((a, b) => a.downFrame - b.downFrame || a.upFrame - b.upFrame);
}

const PHONE_VOCALS = [[10, 24], [15, 23], [20, 23]];
const HOP_BY_UPDATE = 312;

/** One member's full night: windows against the phone, Balloon Boy's first hop and his vocals at the 10/15/20 s rolls. */
export function playMember(inp: Inputs, member: Member) {
  const contacts = memberContacts(inp.contacts, member);
  const cum = cumulative(inp.deltas, 40002);
  const vocals: { update: number, vocal: number | string }[] = [];
  let firstHop = null as number | null;
  // The Sim is marked once it is wired.
  const observe = (sim: Sim & { __wired?: boolean }) => {
    if (!sim.__wired) {
      sim.__wired = true;
      // The wrapper hands every event its second argument, as it always has.
      const emit = sim.emit.bind(sim) as (kind: string, detail?: { readonly vocal?: number }) => void;
      sim.emit = ((kind: string, detail?: { readonly vocal?: number }) => { if (kind === 'laugh') vocals.push({ update: sim.frame, vocal: detail?.vocal ?? 'redraw' }); return emit(kind, detail); }) as Sim['emit'];
    }
    if (member.kind === 'draws' && sim.frame === member.update) sim.rng.state = stepState(sim.rng.state, member.k);
    if (firstHop === null && sim.bb.stage > 0) firstHop = sim.frame;
    return { mask: LEDGERS.mask.model(sim), unit: sim.blackout.active ? sim.blackout.unitId : null };
  };
  const run = drawTrace({ night: inp.night, seed: inp.measuredSeed, frames: 40000, modelOptions: inp.modelOptions,
    ...(inp.customNight ? { customNight: inp.customNight } : {}), contacts, observe, frameTimes: inp.deltas });
  // observe ran: one { mask, unit } per model frame.
  const at = (u: number) => { const o = (run.observed as ReturnType<typeof observe>[])[u + 1]; return o ? { maskValue: o.mask, occupant: o.unit ? (CODE[o.unit] ?? '?') : null } : null; };
  const codes = windowCodes(maskPresses(inp.queue), at, cum, cum[run.out.length - 1], { windowMs: WINDOW_MS }).map((w) => w.code).join('').slice(0, inp.phone.length);
  const score = scoreWindows(inp.phone, codes);
  const vocalAt = (sec: number) => vocals.find((v) => Math.abs(cum[v.update - 1] / 1000 - sec) < 0.2)?.vocal ?? null;
  const audio = PHONE_VOCALS.map(([sec, phone]) => ({ sec, phone, model: vocalAt(sec) }));
  return { member, codes, agree: score.agree, compared: score.compared,
    prefix: score.firstDisagreement === null ? inp.phone.length : score.firstDisagreement.window,
    firstHopUpdate: firstHop, hopsAtFirstRoll: firstHop !== null && firstHop <= HOP_BY_UPDATE, audio,
    audioFits: firstHop !== null && firstHop <= HOP_BY_UPDATE && audio.every((a) => a.model === a.phone || a.model === 'redraw'),
    outcome: run.won ? '6am' : run.death ? `death:${run.death.reason}@${run.death.t ?? '?'}` : 'alive' };
}

/** The predeclared rule: SUPPORTED when some member meets both fingerprints. */
export function decide(rule: EarlyPre['decisionRule'], rows: readonly Pick<MemberRow, 'audioFits' | 'agree' | 'member'>[]) {
  if (!rows.length) throw new Error('no member was scored, so the rule decides nothing');
  const fits = rows.filter((r) => r.audioFits && r.agree >= rule.minAgree);
  return fits.length ? { verdict: 'SUPPORTED', fits: fits.map((r) => r.member) } : { verdict: 'NOT_SUPPORTED', fits: [] };
}

async function main(argv: string[]) {
  const args = sweepArgs(argv);
  const { pre, inp, record } = predeclared<EarlyPre, Inputs>(args.predeclaration, inputs, earlyPredeclaration);
  const firstMask = maskPresses(inp.queue)[0].tick;
  const members = family(inp.contacts, firstMask);
  const t0 = Date.now();
  const control = playMember(inp, { kind: 'none' });
  const rows = (await fanOut<[number, Member], { i: number, row: MemberRow }>(import.meta.url, SCHEMA, { night: pre.night },
    members.map((m, i): [number, Member] => [i, m]), args.workers)).sort((a, b) => a.i - b.i).map(({ row }) => row);
  const decision = decide(pre.decisionRule, rows);
  const result = { schema: SCHEMA, claimLevel: 'MODEL_ONLY', night: pre.night, seed: pre.seed,
    predeclaration: record, inputs: inp.hashes, phoneWindows: inp.phone,
    firstMaskTick: firstMask, members: members.length, control, rows, decision, runFacts: { elapsedMs: Date.now() - t0 } };
  if (args.out) writeFileSync(args.out, `${JSON.stringify(result, null, 1)}\n`);
  const best = [...rows].sort((a, b) => b.agree - a.agree || b.prefix - a.prefix).slice(0, 8);
  console.log(`${pre.night} seed ${pre.seed}: control agree ${control.agree}/${control.compared}, first hop update ${control.firstHopUpdate}, audio fits ${control.audioFits}`);
  console.log(`  ${members.length} members; ${rows.filter((r) => r.audioFits).length} fit the audio, ${rows.filter((r) => r.agree >= pre.decisionRule.minAgree).length} reach agreement ${pre.decisionRule.minAgree}`);
  for (const r of best) console.log(`  ${JSON.stringify(r.member)} agree ${r.agree}/${r.compared} prefix ${r.prefix} hop ${r.firstHopUpdate} audio ${r.audio.map((a) => a.model).join(',')} ${r.outcome}`);
  console.log(`  ${decision.verdict}${decision.fits.length ? `: ${JSON.stringify(decision.fits)}` : ''}`);
}

if (!isMainThread && workerData?.tool === SCHEMA) {
  const inp = inputs(workerData.night);
  // A worker thread has its parent's port.
  (parentPort as NonNullable<typeof parentPort>).postMessage(workerData.chunk.map(([i, member]: [number, Member]) => ({ i, row: playMember(inp, member) })));
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
