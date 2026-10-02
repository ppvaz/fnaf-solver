#!/usr/bin/env node
// A committed winner's schedule replayed into the rebuilt runtime and into the model: the outcome of
// each, and the per-update draw/LCG trace up to the first difference.
//
//   node packages/propose/bin/recompile/compare-schedule-replay.ts --trace FILE --input FILE --navigation FILE
//        --winner packages/propose/bindings/fnaf2/campaign-night1-minimal-winner.json --night 1 --seed 24850
//        --model-options packages/source/recompile/sourced-rebuild-model-options.json --out FILE
//        [--frame 3] [--frames 30000] [--profile FILE] [--custom-night FILE]
//        [--binary FILE] [--save FILE] [--repeat-trace FILE] [--ledger monitor|mask[=TRACE]]...
//        [--counter-trace FILE] [--baseline RECORD]
//
// --input must be the harness input the trace was run from, and it must be exactly --navigation plus
// schedule-to-input.ts's rows for this winner and night: the tool regenerates them and refuses a
// mismatch, so the model is driven by the Sim queue of the same expansion (compare-draw-trace.mjs
// compareTrace with `schedule`). The model trace is then checked against the binding's own gate
// replay (STRATEGY_REGISTRY emit(...).replay(seed), with the options injected at Sim construction as
// packages/propose/bin/recompile/rebuild-options-census.ts does): same end frame, outcome and LCG state, or the record says not.
//
// --ledger reads `# watch` lines (run the harness with CHOWDREN_WATCH set to the ledger's object and
// value, below) and compares that state per update with the model's (office tick t vs model frame t+1).
// The harness watches one object per run, so a second ledger names its own TRACE: another run of the
// same input, whose office draw projection must equal the main trace's (a repeat as well as a ledger).
//
// Outcome: the frame the rebuild visits after its office visit -- 4 (05-static) is a death, 5
// (06-next day) is 6 AM. A death's reason is the rebuild's own when the trace carries `# counter`
// lines that watch `being attacked by` (run the harness with CHOWDREN_WATCH_COUNTER naming it): its
// value on the last office update, named by ATTACKERS. Without that watch it is the model's only
// when the draw stream matched every update to the terminal loop, else UNKNOWN. --counter-trace
// reads the counters from another run of the same replay (its office draw projection must equal the
// main trace's), as a second ledger does.
//
// --baseline names an earlier record of the same replay, usually on another binary: the record says
// whether the two ordered draw projections are equal, i.e. whether a new binary or watch changed the
// Random stream.
//
// Content-free and hash-bound like compare-draw-trace.mjs; MODEL_ONLY, rebuilt-runtime fidelity.
import { createHash } from 'node:crypto';
import type { BinaryLike } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareTrace } from '../../../review/bin/recompile/compare-draw-trace.ts';
import { MODEL_SOURCES, simOptionsFrom } from '../../../source/recompile/model-draw-trace.ts';
import { DEFAULT_PROFILE, controlPoints, harnessInput, winnerSchedule, modelContacts } from './schedule-to-input.ts';
import type { ProfileView } from './schedule-to-input.ts';
import { withModelOptions } from './rebuild-options-census.ts';
import type { Sim } from '@sixam/source/fnaf2';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const hash = (value: BinaryLike) => createHash('sha256').update(value).digest('hex');
const fileHash = (path: string | URL) => hash(readFileSync(path));
export const DEATH_FRAME = 4;      // 05-static
export const SIX_AM_FRAME = 5;     // 06-next day
export const MAX_RUNS = 40;        // mismatch runs listed in a record (the count is always whole)

// A watched object's alterable and the model state it is the rebuild's copy of.
export const LEDGERS = Object.freeze({
  monitor: { watch: 'flip panel button:0', states: '0 down, 1 raising, 2 up, 3 lowering',
    model: (sim: Sim) => ({ down: 0, raising: 1, up: 2, lowering: 3 })[sim.monitor] },
  mask: { watch: 'mask:0', states: '0 off, 1 putting on, 2 on, 3 taking off',
    model: (sim: Sim) => sim.maskState },
});
/** A ledger the harness can watch. */
export type LedgerName = keyof typeof LEDGERS;

// `being attacked by` (object 136), the committed attack: its value names the attacker, as the office
// sheet (03-04-Office) writes it. The office's only jumps to 05-static (g588-g595) end the attack
// animation that g575-g587 show, force and count while it is > 0. Balloon Boy never writes it; 10 and
// 11 are unused.
export const ATTACKER_COUNTER = 'being attacked by';
export const ATTACKERS: Readonly<Record<number, { readonly name: string, readonly object: string, readonly setBy: readonly string[] }>> = Object.freeze({
  1: { name: 'Withered Freddy', object: 'old freddy', setBy: ['g556', 'g560', 'g564'] },
  2: { name: 'Withered Bonnie', object: 'old bonnie', setBy: ['g557', 'g561', 'g565'] },
  3: { name: 'Withered Chica', object: 'old chica', setBy: ['g558', 'g562', 'g566'] },
  4: { name: 'Withered Foxy', object: 'old foxy', setBy: ['g571', 'g572', 'g573'] },
  5: { name: 'Toy Bonnie', object: 'new bonnie', setBy: ['g568', 'g722'] },
  6: { name: 'Toy Chica', object: 'new chica', setBy: ['g569'] },
  7: { name: 'Toy Freddy', object: 'new freddy', setBy: ['g559', 'g563', 'g567'] },
  8: { name: 'The Mangle', object: 'new foxy', setBy: ['g731'] },
  9: { name: 'The Puppet', object: 'sockpuppet', setBy: ['g574'] },
  12: { name: 'Golden Freddy', object: 'golden', setBy: ['g570'] },
});

const actionLines = (text: string) => text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

/**
 * The harness's counter watch: `# counters a,b,...` once, then `# counter F T v...` per update.
 * Returns the lines of the first visit to `frame` as { names, series: Map tick -> [value | null] }
 * (null where the frame had no such Counter), or null when the trace watched no counter.
 */
export function counterSeries(text: string, frame: number) {
  let names = null as string[] | null;
  let visit = -1;
  let current = null as number | null;
  const series = new Map<number, (number | null)[]>();
  for (const line of text.split('\n')) {
    const seeded = /^# frame (\d+) seeded /.exec(line);
    if (seeded) {
      current = Number(seeded[1]);
      if (current === frame) visit += 1;
    } else if (line.startsWith('# counters ')) names = line.slice('# counters '.length).split(',');
    else if (line.startsWith('# counter ')) {
      const m = /^# counter (\d+) (\d+) (.+)$/.exec(line);
      if (!m || !names) throw new Error('a # counter line without its # counters header, or malformed');
      if (Number(m[1]) !== frame || current !== frame || visit !== 0) continue;
      const values = m[3].split(' ').map((v) => (v === '-' ? null : Number(v)));
      if (values.length !== names.length || values.some((v) => v !== null && !Number.isFinite(v)))
        throw new Error(`a # counter line does not carry one value per watched counter: ${line}`);
      series.set(Number(m[2]), values);
    }
  }
  return names ? { names, series } : null;
}

/**
 * The rebuild's attacker, from its own `being attacked by` on the office visit's last update: the
 * value, the character the sheet writes it for, the update it was set on, how many updates it held,
 * and every watched counter at the end of that update and of the one before. Null when the watch
 * does not include the counter.
 */
/** The rebuild's attacker as its counter watch names it, and the watched counters around its setting. */
export interface Attacker {
  counter: string, value: number | null, name: string | null, object?: string | null, setBy?: readonly string[];
  setAtTick?: number, lastTick: number, updatesHeld?: number;
  before?: Readonly<Record<string, number | null>> | null, at: Readonly<Record<string, number | null>> | null;
}

export function rebuiltAttacker(counters: Counters | null, lastTick: number): Attacker | null {
  const index = counters?.names.indexOf(ATTACKER_COUNTER) ?? -1;
  if (index < 0) return null;
  // A watch that names the counter (index >= 0).
  const watched = counters as Counters;
  const valuesAt = (tick: number) => watched.series.get(tick);
  const last = valuesAt(lastTick);
  if (!last) throw new Error(`the counter watch has no office update ${lastTick}`);
  const value = last[index];
  const snapshot = (tick: number) => {
    const values = valuesAt(tick);
    return values ? Object.fromEntries(watched.names.map((n, i) => [n, values[i]])) : null;
  };
  if (!value) return { counter: ATTACKER_COUNTER, value, name: null, lastTick, at: snapshot(lastTick) };
  let setAt = lastTick;
  while (valuesAt(setAt - 1)?.[index] === value) setAt -= 1;
  const known = ATTACKERS[value];
  return { counter: ATTACKER_COUNTER, value, name: known?.name ?? null, object: known?.object ?? null, setBy: known?.setBy ?? [],
    setAtTick: setAt, lastTick, updatesHeld: lastTick - setAt + 1, before: snapshot(setAt - 1), at: snapshot(setAt) };
}

/** The counters a trace watched and their values per office update (counterSeries). */
type Counters = NonNullable<ReturnType<typeof counterSeries>>;

/** `# watch F T off X Y new N x X v<i> value ...` lines of `frame`: tick -> value of the first listed alterable. */
export function watchSeries(text: string, frame: number) {
  const series = new Map<number, number>();
  for (const line of text.split('\n')) {
    const m = /^# watch (\d+) (\d+) off -?\d+ -?\d+ new -?\d+ x -?\d+ v\d+ (-?[\d.e+-]+)/.exec(line);
    if (m && Number(m[1]) === frame) series.set(Number(m[2]), Number(m[3]));
  }
  return series;
}

/** Value changes of a per-tick series: [{ tick, from, to }]. */
export function transitions<T>(pairs: readonly (readonly [number, T])[]) {
  const out: { tick: number, from: T, to: T }[] = [];
  for (let i = 1; i < pairs.length; i += 1)
    if (pairs[i][1] !== pairs[i - 1][1]) out.push({ tick: pairs[i][0], from: pairs[i - 1][1], to: pairs[i][1] });
  return out;
}

/**
 * Per-update ledger, rebuilt tick t against model frame t + 1: how many updates agree, and each side's
 * state changes paired in order. A pair is the same change (from -> to) on both sides; its offset is
 * rebuilt tick minus model tick. Pairing stops at the first change the two sides do not share. Both
 * series start from the model's frame-0 state (tick -1), so a press on the first update is a change.
 */
export function compareLedger(series: ReadonlyMap<number, number>, observed: readonly unknown[], name: LedgerName) {
  const pairs = [...series].sort((a, b) => a[0] - b[0]).filter(([tick]) => observed[tick + 1] !== undefined);
  let mismatches = 0;
  let firstMismatch = null as { tick: number, rebuilt: number, model: unknown } | null;
  for (const [tick, value] of pairs) {
    if (value === observed[tick + 1]) continue;
    mismatches += 1;
    firstMismatch ??= { tick, rebuilt: value, model: observed[tick + 1] };
  }
  // Both sides change from the state before the first office update: the model's frame 0.
  const base: [number, unknown] = [-1, observed[0]];
  const rebuilt = transitions<unknown>([base, ...pairs]);
  const model = transitions([base, ...pairs.map(([tick]): [number, unknown] => [tick, observed[tick + 1]])]);
  const offsets: Record<string, number> = {};
  let paired = 0;
  let firstUnpaired = null as { index: number, rebuilt: (typeof rebuilt)[number] | null, model: (typeof model)[number] | null } | null;
  for (; paired < Math.min(rebuilt.length, model.length); paired += 1) {
    const [r, m] = [rebuilt[paired], model[paired]];
    if (r.from !== m.from || r.to !== m.to) { firstUnpaired = { index: paired, rebuilt: r, model: m }; break; }
    const key = `${r.from}>${r.to} ${r.tick - m.tick >= 0 ? '+' : ''}${r.tick - m.tick}`;
    offsets[key] = (offsets[key] ?? 0) + 1;
  }
  if (!firstUnpaired && rebuilt.length !== model.length)
    firstUnpaired = { index: paired, rebuilt: rebuilt[paired] ?? null, model: model[paired] ?? null };
  return { name, watch: LEDGERS[name].watch, states: LEDGERS[name].states, compared: pairs.length, mismatches, firstMismatch,
    changes: { rebuilt: rebuilt.length, model: model.length, paired, offsets: Object.fromEntries(Object.entries(offsets).sort()), firstUnpaired } };
}

/**
 * Every run of consecutive mismatched updates (offset 1), in order: [{ start, length, rejoined }].
 * `rejoined` is false only for a run that lasts to the end of the compared updates.
 */
export function mismatchRuns(rows: readonly { tick: number, draws: number, state: number }[],
  out: readonly { draws: number, state: number }[]) {
  const runs: { start: number, length: number, rejoined: boolean }[] = [];
  let run = null as (typeof runs)[number] | null;
  let compared = 0;
  for (const row of rows) {
    const expected = out[row.tick + 1];
    if (!expected) break;
    compared += 1;
    const bad = row.draws !== expected.draws || row.state !== expected.state;
    if (bad && !run) runs.push(run = { start: row.tick, length: 0, rejoined: false });
    // A bad update has a run: the line above opened one.
    if (bad) (run as (typeof runs)[number]).length += 1;
    else if (run) { run.rejoined = true; run = null; }
  }
  return { compared, mismatchedUpdates: runs.reduce((n, r) => n + r.length, 0), runs };
}

/** `counters`: counterSeries() of the office visit, or null when the trace watched none. */
export function outcomes(result: ComparedTrace, { frame, counters = null }: { frame: number, counters?: Counters | null }) {
  const visits = result.runtime.visits;
  const index = visits.findIndex((v) => v.frame === frame);
  const next = index >= 0 ? visits[index + 1] : undefined;
  const updates = index >= 0 ? visits[index].updates : 0;
  const rebuiltResult = index < 0 ? 'NOT_REACHED' : !next ? 'NOT_ENDED'
    : next.frame === DEATH_FRAME ? 'death' : next.frame === SIX_AM_FRAME ? '6am' : 'UNKNOWN';
  const m = result.model;
  const modelResult = m.won ? '6am' : m.death ? 'death' : 'alive';
  const traced = result.status === 'MATCHED_TO_TERMINAL_LOOP';
  const attacker = rebuiltResult === 'death' ? rebuiltAttacker(counters, updates - 1) : null;
  const [reason, reasonSource] = rebuiltResult !== 'death' ? [null, null]
    : attacker?.name ? [attacker.name, `the rebuild's own \`${ATTACKER_COUNTER}\` (CHOWDREN_WATCH_COUNTER) = ${attacker.value} on its last office update`]
      : traced && m.death ? [m.death.reason, 'the model\'s, every update matched to its terminal loop']
        : attacker ? ['UNKNOWN', `the rebuild's own \`${ATTACKER_COUNTER}\` read ${attacker.value} on its last office update, which names no attacker`]
          : ['UNKNOWN', 'not read from the runtime'];
  return {
    rebuilt: { result: rebuiltResult, nextFrame: next?.frame ?? null, officeUpdates: updates,
      seconds: Number((updates / 60).toFixed(3)), reason, reasonSource, ...(attacker ? { attacker } : {}) },
    model: { result: modelResult, reason: m.death?.reason ?? null, frame: m.terminal.frame, seconds: Number((m.terminal.frame / 60).toFixed(3)) },
    sameResult: rebuiltResult === modelResult,
    officeUpdatesMinusModelFrames: updates - m.terminal.frame,
  };
}

/** The binding's gate replay under the same options, against the comparison's model trace. */
function gateReplayCheck(sched: ReturnType<typeof winnerSchedule>, seed: number, modelOptions: unknown, result: ComparedTrace) {
  const { sim } = withModelOptions(simOptionsFrom(modelOptions), () => sched.emitted.replay(seed));
  const replay = { won: !!sim.won, death: sim.death?.reason ?? null, frame: sim.frame, state: sim.rng.state };
  const traced = { won: result.model.won, death: result.model.death?.reason ?? null, frame: result.model.terminal.frame, state: result.model.terminal.state };
  return { agrees: JSON.stringify(replay) === JSON.stringify(traced), replay, traced };
}

/** A harness trace compared with the model (compare-draw-trace.ts compareTrace). */
type ComparedTrace = ReturnType<typeof compareTrace>;

const officeProjection = (text: string, frame: number) => hash(text.split('\n').filter((l) => l.startsWith(`${frame} `))
  .map((l) => l.split(/\s+/).slice(0, 4).join(' ')).join('\n'));

/**
 * `ledgers`: [{ name, text? }] -- a ledger without its own text reads the main trace's watch lines.
 * `counters`: undefined reads the main trace's `# counter` lines (if any), { text } another run's,
 * false none.
 */
export function compareScheduleReplay({ text, inputText, navigationText, winner, night, seed, frame = 3, frames = 30000,
  modelOptions = {}, customNight = null, profile, ledgers = [], counters: counterSource = undefined }: {
  text: string, inputText: string, navigationText: string, winner: unknown, night: number, seed: number, frame?: number;
  frames?: number, modelOptions?: unknown, customNight?: Readonly<Record<string, number>> | null, profile: ProfileView;
  ledgers?: readonly { name: LedgerName, text?: string }[], counters?: { text: string } | false,
}): ScheduleReplay {
  for (const { name } of ledgers) if (!LEDGERS[name]) throw new Error(`--ledger must be one of ${Object.keys(LEDGERS).join(', ')}`);
  if (new Set(ledgers.map((l) => l.name)).size !== ledgers.length) throw new Error('a ledger is named twice');
  const sched = winnerSchedule(winner, night);
  const points = controlPoints(profile);
  const expected = harnessInput({ navigation: navigationText, schedule: sched, points, frame });
  if (JSON.stringify(actionLines(inputText)) !== JSON.stringify(actionLines(expected.text)))
    throw new Error('the input is not the navigation plus this winner\'s schedule rows (schedule-to-input.ts)');
  const observe = ledgers.length ? (sim: Sim) => ledgers.map(({ name }) => LEDGERS[name].model(sim)) : null;
  // compareTrace refuses options that are not an object of model options.
  const flags = modelOptions as { readonly sourcedDropFlagOrder?: unknown, readonly sourcedSheetOrder?: unknown };
  const contacts = flags.sourcedDropFlagOrder && flags.sourcedSheetOrder ? modelContacts(sched.contacts) : null;
  const result: ComparedTrace & Partial<ScheduleReplayFields> = compareTrace(text, { night, seed, frame, frames, modelOptions, customNight, schedule: sched.queue,
    contacts,
    ...(observe ? { observe } : {}) });
  result.schema = 'recompile-schedule-replay-v1';
  result.question = 'Replaying one winner schedule into the rebuilt runtime and into the model: do the outcome and the per-update Random stream agree, and where do they first differ?';
  const used = [...new Set(sched.contacts.map((c) => c.control))].sort();
  result.schedule = {
    strategy: sched.strategy, night, epochMs: sched.epochMs, periodMs: sched.periodMs, loopStartMs: sched.loopStartMs, untilMs: sched.untilMs,
    planSha256: hash(sched.emitted.text), contacts: sched.contacts.length, simQueueRows: sched.queue.length,
    simQueueSha256: hash(JSON.stringify(sched.queue)), officeRows: expected.office.rows.length, officeRowsSha256: expected.officeSha256,
    lastOfficeRowTick: expected.office.rows.at(-1)?.tick ?? null,
    windowPoints: Object.fromEntries(used.map((c) => [c, points[/^cam\d+$/.test(c) ? `cam:${c.slice(3)}` : c]])),
    sameTickEdges: expected.office.sameTickEdges,
    modelInputMode: contacts ? 'explicit-contact-duration' : 'legacy-semantic-edges',
    ...(contacts ? { modelContactsSha256: hash(JSON.stringify(contacts)) } : {}),
    quantization: 'ms -> Math.round(ms * 60 / 1000) model frames; office tick = queue frame; down at press, up at release',
  };
  const main = officeProjection(text, frame);
  if (counterSource && officeProjection(counterSource.text, frame) !== main)
    throw new Error('the counter trace is not a run of the same replay');
  const counters = counterSource === false ? null : counterSeries(counterSource?.text ?? text, frame);
  result.outcome = outcomes(result, { frame, counters });
  if (counters) {
    const lastTick = [...counters.series.keys()].reduce((a, b) => Math.max(a, b), -1);
    const changes = Object.fromEntries(counters.names.map((name, i) => {
      let n = 0;
      let previous: number | null | undefined;
      for (const [, values] of [...counters.series].sort((a, b) => a[0] - b[0])) {
        if (previous !== undefined && values[i] !== previous) n += 1;
        previous = values[i];
      }
      return [name, n];
    }));
    result.counters = { watch: counters.names, officeUpdates: counters.series.size, changes,
      // lastTick is a key of the series.
      final: lastTick < 0 ? null : Object.fromEntries(counters.names.map((name, i) => [name, (counters.series.get(lastTick) as (number | null)[])[i]])),
      trace: !counterSource ? 'main' : { traceSha256: hash(counterSource.text), officeDrawProjectionMatches: true },
      scope: 'values at the end of each office update (harness_after_events); a change inside an update is not seen' };
  }
  result.gateReplay = gateReplayCheck(sched, seed, modelOptions, result);
  const gate: { inputNote?: string, note?: string } = result.gateReplay;
  if (contacts) gate.inputNote = 'The binding gate uses legacy semantic taps; this comparison preserves contact durations and camera selection on release.';
  if (customNight) gate.note = 'the gate replay carries no dial vector; the comparison model does';
  const { rows, model } = result.traces;
  const runs = mismatchRuns(rows, model.out);
  const persistent = runs.runs.find((r) => !r.rejoined) ?? null;
  result.drawRuns = { ...runs, runs: runs.runs.slice(0, MAX_RUNS), listed: Math.min(runs.runs.length, MAX_RUNS), total: runs.runs.length,
    firstPersistent: persistent, matchedBeforeFirstPersistent: persistent ? persistent.start - runs.runs.filter((r) => r.start < persistent.start).reduce((n, r) => n + r.length, 0) : null,
    scope: 'offset 1; a run that rejoined is a stretch of updates after which the rebuilt and model draw counts and LCG state are equal again' };
  if (ledgers.length) {
    result.ledgers = ledgers.map(({ name, text: own }, i) => {
      if (own !== undefined && officeProjection(own, frame) !== main) throw new Error(`the ${name} ledger trace is not a run of the same replay`);
      // observe ran (there are ledgers): one list of ledger states per model frame.
      return { ...compareLedger(watchSeries(own ?? text, frame), (model.observed as unknown[][]).map((o) => o[i]), name),
        trace: own === undefined ? 'main' : { traceSha256: hash(own), officeDrawProjectionMatches: true } };
    });
  }
  result.limitations = [...result.limitations,
    'One schedule quantized to 60 Hz frames; the phone\'s actuation latency, contact loss and frame stalls are not in either replay.',
    'The harness raises one new-touch trigger per update; same-tick edges are listed in schedule.sameTickEdges.',
    'Window points are the device profile\'s control points through the FULL stretch; the office pan is not modelled.'];
  // Every field of a schedule replay is set above.
  return result as ScheduleReplay;
}

/** What compareScheduleReplay adds to the comparison: the schedule, both outcomes, the gate replay and the draw runs. */
interface ScheduleReplayFields {
  schedule: { readonly officeRowsSha256: string, readonly [field: string]: unknown };
  outcome: ReturnType<typeof outcomes>;
  counters: {
    watch: string[], officeUpdates: number, changes: Record<string, number>, final: Record<string, number | null> | null;
    trace: 'main' | { traceSha256: string, officeDrawProjectionMatches: boolean }, scope: string,
  };
  gateReplay: ReturnType<typeof gateReplayCheck> & { inputNote?: string, note?: string };
  drawRuns: ReturnType<typeof mismatchRuns> & {
    listed: number, total: number, firstPersistent: ReturnType<typeof mismatchRuns>['runs'][number] | null;
    matchedBeforeFirstPersistent: number | null, scope: string,
  };
  ledgers: (ReturnType<typeof compareLedger> & { trace: unknown })[];
}
/** A schedule replay's record, and what the command line adds to it. */
type ScheduleReplay = ComparedTrace & Pick<ScheduleReplayFields, 'schedule' | 'outcome' | 'gateReplay' | 'drawRuns'>
  & Partial<Pick<ScheduleReplayFields, 'counters' | 'ledgers'>>
  & { repeatability?: object, provenance?: object, evidenceId?: string;
    baseline?: { readonly evidenceId: unknown, readonly drawTraceMatches: boolean, readonly [field: string]: unknown } };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const names = ['--trace', '--input', '--navigation', '--winner', '--night', '--seed', '--frame', '--frames', '--out', '--profile',
    '--model-options', '--custom-night', '--binary', '--save', '--repeat-trace', '--ledger', '--counter-trace', '--baseline'];
  const args: Record<string, string> = {};
  const ledgerArgs: string[][] = [];
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!names.includes(process.argv[i]) || !process.argv[i + 1]) throw new Error('see usage at top of file');
    if (process.argv[i] === '--ledger') ledgerArgs.push(process.argv[i + 1].split('='));
    else args[process.argv[i].slice(2)] = process.argv[i + 1];
  }
  for (const key of ['trace', 'input', 'navigation', 'winner', 'night', 'out']) if (!args[key]) throw new Error(`--${key} is required`);
  const settings = { night: Number(args.night), seed: Number(args.seed ?? 24850), frame: Number(args.frame ?? 3), frames: Number(args.frames ?? 30000) };
  if (Object.values(settings).some((v) => !Number.isInteger(v) || v < 0) || settings.frames === 0) throw new Error('invalid numeric argument');
  const profilePath = args.profile ?? join(ROOT, DEFAULT_PROFILE);
  const common = {
    ...settings, inputText: readFileSync(args.input, 'utf8'), navigationText: readFileSync(args.navigation, 'utf8'),
    winner: JSON.parse(readFileSync(args.winner, 'utf8')), profile: JSON.parse(readFileSync(profilePath, 'utf8')),
    modelOptions: args['model-options'] ? JSON.parse(readFileSync(args['model-options'], 'utf8')) : {},
    customNight: args['custom-night'] ? JSON.parse(readFileSync(args['custom-night'], 'utf8')) : null,
    // compareScheduleReplay refuses a name that is not a ledger.
    ledgers: ledgerArgs.map(([name, file]) => ({ name: name as LedgerName, ...(file ? { text: readFileSync(file, 'utf8') } : {}) })),
  };
  const result = compareScheduleReplay({ ...common, text: readFileSync(args.trace, 'utf8'),
    ...(args['counter-trace'] ? { counters: { text: readFileSync(args['counter-trace'], 'utf8') } } : {}) });
  if (args['repeat-trace']) {
    const repeat = compareScheduleReplay({ ...common, text: readFileSync(args['repeat-trace'], 'utf8'), ledgers: [], counters: false });
    result.repeatability = { traceSha256: repeat.runtime.traceSha256, drawTraceSha256: repeat.runtime.drawTraceSha256,
      drawTraceMatches: repeat.runtime.drawTraceSha256 === result.runtime.drawTraceSha256,
      wholeTraceMatches: repeat.runtime.traceSha256 === result.runtime.traceSha256,
      scope: 'Ordered frame/tick/draw-count/RNG-state projection. Other global values are not covered by draw repeatability.' };
  }
  const rel = (path: string) => relative(ROOT, resolve(path));
  if (args.baseline) {
    const base = JSON.parse(readFileSync(args.baseline, 'utf8'));
    if (base.schema !== result.schema || base.scope?.night !== result.scope.night || base.scope?.seed !== result.scope.seed ||
      base.schedule?.officeRowsSha256 !== result.schedule.officeRowsSha256) throw new Error('--baseline is not a record of this replay');
    result.baseline = { record: rel(args.baseline), evidenceId: base.evidenceId, binarySha256: base.provenance?.binarySha256 ?? null,
      drawTraceSha256: base.runtime.drawTraceSha256, drawTraceMatches: base.runtime.drawTraceSha256 === result.runtime.drawTraceSha256,
      scope: 'The same replay recorded earlier: equal ordered frame/tick/draw-count/RNG-state projections mean this binary and its watches left the Random stream as it was.' };
  }
  result.provenance = {
    winner: rel(args.winner), winnerSha256: fileHash(args.winner), profile: rel(profilePath), profileSha256: fileHash(profilePath),
    navigation: rel(args.navigation), navigationSha256: fileHash(args.navigation),
    ...(args['model-options'] ? { modelOptions: rel(args['model-options']), modelOptionsSha256: fileHash(args['model-options']) } : {}),
    ...(args['custom-night'] ? { customNight: rel(args['custom-night']), customNightSha256: fileHash(args['custom-night']) } : {}),
    toolSha256: fileHash(new URL(import.meta.url)),
    compareToolSha256: fileHash(new URL('../../../review/bin/recompile/compare-draw-trace.ts', import.meta.url)),
    scheduleToolSha256: fileHash(new URL('./schedule-to-input.ts', import.meta.url)),
    modelTraceToolSha256: fileHash(new URL('../../../source/recompile/model-draw-trace.ts', import.meta.url)),
    modelSourceSha256: Object.fromEntries(MODEL_SOURCES.map((path) => [rel(path), fileHash(path)])),
    patchSha256: fileHash(new URL('../../../source/recompile/mmfparser-chowdren-mobile.patch', import.meta.url)),
    configSha256: fileHash(new URL('../../../source/recompile/fnaf2-config.py', import.meta.url)),
    inputSha256: fileHash(args.input),
    ...Object.fromEntries(['binary', 'save'].filter((key) => args[key]).map((key) => [`${key}Sha256`, fileHash(args[key])])),
    ...(args.baseline ? { baselineSha256: fileHash(args.baseline) } : {}),
  };
  result.evidenceId = `recompile-replay-${hash(JSON.stringify(result)).slice(0, 16)}`;
  writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`);
  const o = result.outcome;
  const first = result.alignments[1].firstMismatch;
  const attacker = o.rebuilt.attacker?.setAtTick !== undefined ? `, \`${ATTACKER_COUNTER}\` set on update ${o.rebuilt.attacker.setAtTick}` : '';
  console.log(`${result.evidenceId}: ${result.status} (${result.claimLevel}, ${result.fidelity}); rebuilt ${o.rebuilt.result}` +
    `${o.rebuilt.reason ? ` (${o.rebuilt.reason}${attacker})` : ''} after ${o.rebuilt.officeUpdates} office updates, ` +
    `model ${o.model.result}${o.model.reason ? ` (${o.model.reason})` : ''} at frame ${o.model.frame}; first draw mismatch ${first ? `tick ${first.tick}` : 'none'}; ` +
    `${result.drawRuns.total} mismatch runs, first persistent ${result.drawRuns.firstPersistent ? `tick ${result.drawRuns.firstPersistent.start}` : 'none'}; ` +
    `gate replay ${result.gateReplay.agrees ? 'agrees' : 'DISAGREES'}` +
    (result.ledgers ?? []).map((l) => `; ${l.name} ledger ${l.changes.paired}/${l.changes.rebuilt} changes paired ${JSON.stringify(l.changes.offsets)}`).join('') +
    (result.baseline ? `; baseline ${result.baseline.evidenceId} draw projection ${result.baseline.drawTraceMatches ? 'equal' : 'DIFFERENT'}` : ''));
}
