#!/usr/bin/env node
// Align game-channel input with the Companion's native presented frames.
//
// This is deliberately narrower than `inputtrace.ts`. Android dispatch and the app-channel FINISHED
// acknowledgement prove transport, but neither proves that the game changed state. A v3 native frame trace
// supplies the visual clock and the fixed bottom-control strokes. This tool joins:
//
//   publishMotionEvent -> receiveMessage(MOTION) -> receiveMessage(FINISHED)
//   -> first native frame that leaves the prior settled state
//   -> first native frame in the new settled state.
//
// The image timestamp is CLOCK_MONOTONIC. Perfetto slices are CLOCK_BOOTTIME on this handset, so the trace's
// clock_snapshot table supplies the offset. Using the callback time instead would add ImageReader queue
// latency to every frame.
//
// The result is visual acceptance evidence, not a claim about the game's private touch handler. A delivered
// contact with no observed state change is reported as `CHANNEL_DELIVERED_NO_VISUAL_EFFECT`. Missing
// game-channel rows are a trace failure, never silently reclassified as a game rejection.
//
//   node packages/review/bin/grade/input-frame-align.ts INPUT.pftrace FRAME.tsv --trace-processor ./trace_processor
//   node packages/review/bin/grade/input-frame-align.ts INPUT.pftrace FRAME.tsv --json
//
// Ported from input-frame-align.py: it prints and exits as that did.
import { present, isRecord, isList } from '@sixam/kernel';
import { DISPATCH_RE, QUERY_PREFIX, formatQuery, which, queryText, csvBody } from './perfetto.ts';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PyFloat, type PyJson, pyArgs, pyCsvDicts, pyDecodeUtf8, pyDumps, pyFixed, pyFloat, pyInt, pyMedian, pyPath, pyRepr, pySplit, pySplitLines,
  pyStrRepr, pyStrip,
} from '@sixam/kernel/py';

const DEFAULT_PACKAGE = 'com.scottgames.fnaf2';
const STROKE_VISIBLE_MIN = 100;
const STROKE_ABSENT_MAX = 40;
// Python's re, kept: `$` also matches before a final newline, \d is any Unicode decimal digit (int() then
// reads it), and \b is a boundary between Unicode word characters and the rest.
const ACTION_RE = /action=(?<action>[^\n]+)\)(?=\n?$)/u;
const SEQ_RE = /(?<![\p{L}\p{N}_])seq=(?<seq>0x[0-9a-fA-F]+)(?![\p{L}\p{N}_])/u;

/** The two clocks or their evidence cannot be aligned safely. */
class AlignError extends Error {}

const QUERY_TEMPLATE = `${QUERY_PREFIX}
UNION ALL
SELECT 'publish' AS kind, ts_ns, dur_ns, name, thread_name, process_name, track_name
FROM joined
WHERE name GLOB 'publishMotionEvent(inputChannel=*{package}*, action=*)'
UNION ALL
SELECT 'receive' AS kind, ts_ns, dur_ns, name, thread_name, process_name, track_name
FROM joined
WHERE name GLOB 'receiveMessage(inputChannel=*{package}*, seq=*, type=MOTION)'
UNION ALL
SELECT 'finish' AS kind, ts_ns, dur_ns, name, thread_name, process_name, track_name
FROM joined
WHERE name GLOB 'receiveMessage(inputChannel=*{package}*, seq=*, type=FINISHED)'
ORDER BY ts_ns;
`;

export const buildQuery = (pkg = DEFAULT_PACKAGE): string => formatQuery(QUERY_TEMPLATE, pkg);


type CsvRow = ReadonlyMap<string | null, string | null | string[]>;
const rowRepr = (row: CsvRow) => `{${[...row].map(([key, value]) =>
  `${key === null ? 'None' : pyStrRepr(key)}: ${value === null ? 'None' : Array.isArray(value) ? `[${value.map(pyStrRepr).join(', ')}]` : pyStrRepr(value)}`).join(', ')}}`;

export interface Row { kind: string | null, ts_ns: bigint, dur_ns: bigint, name: string | null, thread_name: string, process_name: string, track_name: string }

export function parseQueryCsv(stdout: string): Row[] {
  const { fieldnames, rows } = pyCsvDicts(csvBody(stdout, message => { throw new AlignError(message); }));
  const required = ['kind', 'ts_ns', 'dur_ns', 'name', 'thread_name', 'process_name', 'track_name'];
  if (!required.every(name => (fieldnames ?? []).includes(name))) throw new AlignError('trace processor CSV lacks required columns');
  return rows.map((row, k) => {
    const text = (name: string): string | null => {
      const value = row.get(name);
      if (value === undefined || isList(value)) throw new AlignError(`invalid trace-processor column ${name}`);
      return value;
    };   // a required column: a string, or None where the row ran short
    const int = (value: string | null) => {
      const parsed = value === null ? null : pyInt(value);
      if (parsed === null) throw new AlignError(`invalid trace-processor row ${k + 2}: ${rowRepr(row)}`);
      return parsed;
    };
    return { kind: text('kind'), ts_ns: int(text('ts_ns')), dur_ns: text('dur_ns') ? int(text('dur_ns')) : 0n, name: text('name'),
      thread_name: text('thread_name') || '', process_name: text('process_name') || '', track_name: text('track_name') || '' };
  });
}

export interface ClockRow { snapshot_id: bigint, clock_name: string | null, clock_value: bigint }

export function parseClockRows(stdout: string): ClockRow[] {
  const lines = pySplitLines(stdout);
  const at = lines.findIndex(line => line.startsWith('"snapshot_id"') || line.startsWith('snapshot_id,'));
  if (at < 0) throw new AlignError('trace processor returned no clock_snapshot header');
  return pyCsvDicts(lines.slice(at).join('\n')).rows.map(row => {
    const int = (name: string) => {
      const value = row.get(name);
      const parsed = typeof value === 'string' ? pyInt(value) : null;
      if (parsed === null) throw new AlignError(`invalid clock_snapshot row: ${rowRepr(row)}`);
      return parsed;
    };
    if (!row.has('clock_name')) throw new AlignError(`invalid clock_snapshot row: ${rowRepr(row)}`);
    const clock_name = row.get('clock_name');
    if (clock_name === undefined || isList(clock_name)) throw new AlignError(`invalid clock_snapshot row: ${rowRepr(row)}`);
    return { snapshot_id: int('snapshot_id'), clock_name, clock_value: int('clock_value') };
  });
}

function parseFrameHeader(line: string): Map<string, string> {
  if (!line.startsWith('# schema=fnaf2-frame-trace-v')) throw new AlignError('frame trace is not a fnaf2-frame-trace-v trace');
  const result = new Map<string, string>();
  for (const field of pySplit(line.slice(2))) {
    const at = field.indexOf('=');
    if (at >= 0) result.set(field.slice(0, at), field.slice(at + 1));
  }
  return result;
}

export interface RawFrame { seq: bigint, image_ns: bigint, interval_ns: bigint, mask_downstroke: bigint, monitor_downstroke: bigint }

export function readFrameTrace(path: string): [Map<string, string>, RawFrame[]] {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw new AlignError(`cannot read frame trace ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  // read_text(encoding='utf-8'): a bad byte is a ValueError, not a read failure.
  const lines = pySplitLines(pyDecodeUtf8(bytes));
  if (lines.length < 3) throw new AlignError(`${path}: frame trace is empty`);
  const header = parseFrameHeader(lines[0]);
  const columns = lines[1].split('\t');
  const required = ['seq', 'image_ns', 'interval_ns', 'mask_downstroke', 'monitor_downstroke'];
  const missing = required.filter(name => !columns.includes(name));
  if (missing.length) throw new AlignError(`${path}: exact alignment requires native stroke columns (${[...missing].sort().join(', ')})`);
  const rows: RawFrame[] = [];
  lines.slice(2).forEach((line, k) => {
    if (!pyStrip(line)) return;
    const fields = line.split('\t');
    if (fields.length !== columns.length) throw new AlignError(`${path}:${k + 3}: wrong column count`);
    const value = (name: string) => {
      const parsed = pyInt(fields[columns.indexOf(name)]);
      if (parsed === null) throw new AlignError(`${path}:${k + 3}: invalid numeric field`);
      return parsed;
    };
    rows.push({ seq: value('seq'), image_ns: value('image_ns'), interval_ns: value('interval_ns'),
      mask_downstroke: value('mask_downstroke'), monitor_downstroke: value('monitor_downstroke') });
  });
  if (!rows.length) throw new AlignError(`${path}: frame trace contains no frames`);
  return [header, rows];
}

/** int / int as Python divides: the exact quotient, correctly rounded to a double. */
function trueDivide(a: bigint, b: bigint): number {
  if (b < 0n) [a, b] = [-a, -b];
  const negative = a < 0n;
  let n = negative ? -a : a;
  if (n === 0n) return negative ? -0 : 0;
  // Scale so the integer quotient carries at least 64 significant bits, then round once.
  const shift = Math.max(0, 64 - (n.toString(2).length - b.toString(2).length));
  n <<= BigInt(shift);
  const q = n / b, r = n % b;
  const sticky = r === 0n ? 0n : 1n;
  const value = Number((q << 1n) | sticky) / 2 ** (shift + 1);
  return negative ? -value : value;
}

const round = (x: number, digits: number) => (Number.isFinite(x) ? Number(pyFixed(x, digits)) : x);
const nsToMs = (ns: bigint, digits: number) => round(trueDivide(ns, 1_000_000n), digits);

export function clockOffset(clockRows: readonly ClockRow[]) {
  const bySnapshot = new Map<bigint, Map<string, bigint>>();
  for (const row of clockRows) {
    if (!bySnapshot.has(row.snapshot_id)) bySnapshot.set(row.snapshot_id, new Map());
    bySnapshot.get(row.snapshot_id)?.set(String(row.clock_name), row.clock_value);
  }
  const offsets = [...bySnapshot.values()].flatMap(values => {
    const boot = values.get('BOOTTIME'), mono = values.get('MONOTONIC');
    return boot !== undefined && mono !== undefined ? [boot - mono] : [];
  });
  if (!offsets.length) throw new AlignError('trace clock_snapshot has no BOOTTIME/MONOTONIC pair');
  const middle = pyMedian(offsets);
  const median = typeof middle === 'bigint' ? middle : BigInt(Math.trunc(middle));
  const max = offsets.reduce((a, b) => (b > a ? b : a)), min = offsets.reduce((a, b) => (b < a ? b : a));
  return [median, { offsetNs: median, offsetMs: nsToMs(median, 6), samples: offsets.length, spreadNs: max - min,
    method: 'median(clock_snapshot.BOOTTIME - MONOTONIC)' }] as const;
}

export function classifyState(mask: bigint, monitor: bigint): string {
  if (mask < 0n || monitor < 0n) return 'UNKNOWN';
  if (mask <= STROKE_ABSENT_MAX && monitor >= STROKE_VISIBLE_MIN) return 'MONITOR_UP';
  if (mask >= STROKE_VISIBLE_MIN && monitor >= STROKE_VISIBLE_MIN) return 'OFFICE';
  if (mask >= STROKE_VISIBLE_MIN && monitor <= STROKE_ABSENT_MAX) return 'MASK_ON';
  return 'UNKNOWN';
}

export interface Frame extends RawFrame { trace_ns: bigint, state: string }

export function decorateFrames(raw: readonly RawFrame[], offsetNs: bigint): Frame[] {
  return raw.map(frame => ({ ...frame, trace_ns: frame.image_ns + offsetNs, state: classifyState(frame.mask_downstroke, frame.monitor_downstroke) }))
    .sort((a, b) => (a.trace_ns < b.trace_ns ? -1 : a.trace_ns > b.trace_ns ? 1 : 0));
}

/** pattern.search(name): a row whose name ran short (None) stopped the run, as re did with a TypeError. */
function search(pattern: RegExp, name: string | null) {
  if (name === null) throw new TypeError("expected string or bytes-like object, got 'NoneType'");
  return pattern.exec(name);
}

export interface GameEvent {
  ordinal: number, action: string, publish_ts_ns: bigint, receive_ts_ns: bigint, channel_latency_ms: number, seq: string,
  finish_ts_ns: bigint | null, finish_latency_ms: number | null, origin: string, device_id: bigint | null, dispatch_ts_ns?: bigint,
}

export function parseGameEvents(rows: readonly Row[]): GameEvent[] {
  const all = [...rows].sort((a, b) => (a.ts_ns < b.ts_ns ? -1 : a.ts_ns > b.ts_ns ? 1 : 0));
  const dispatch = all.flatMap(row => {
    if (row.kind !== 'dispatch') return [];
    const groups = search(DISPATCH_RE, row.name)?.groups;
    return groups ? [{ action: groups.action, device_id: present(pyInt(groups.device_id), 'device ID'), dispatch_ts_ns: row.ts_ns }] : [];
  });
  const publishes = all.filter(row => row.kind === 'publish').map(row => ({ action: search(ACTION_RE, row.name)?.groups?.action ?? null, ts_ns: row.ts_ns }));
  // The action is carried by the matching publication; only the channel sequence is needed here.
  const receives = all.flatMap(row => {
    if (row.kind !== 'receive') return [];
    const seq = search(SEQ_RE, row.name)?.groups?.seq.toLowerCase();
    return seq ? [{ ts_ns: row.ts_ns, seq }] : [];
  });
  const finishes = new Map<string, bigint>();
  for (const row of all) {
    if (row.kind !== 'finish') continue;
    const seq = search(SEQ_RE, row.name)?.groups?.seq.toLowerCase();
    if (seq && !finishes.has(seq)) finishes.set(seq, row.ts_ns);
  }
  if (!publishes.length || !receives.length) return [];
  if (publishes.length !== receives.length) throw new AlignError(`game publish/receive cardinality differs (${publishes.length} vs ${receives.length})`);
  const events: GameEvent[] = publishes.map((published, k) => {
    const received = receives[k];
    if (published.action === null) throw new AlignError(`game publication ${k + 1} has no action`);
    const finish = finishes.get(received.seq);
    return {
      ordinal: k + 1, action: published.action, publish_ts_ns: published.ts_ns, receive_ts_ns: received.ts_ns,
      channel_latency_ms: nsToMs(received.ts_ns - published.ts_ns, 3), seq: received.seq, finish_ts_ns: finish ?? null,
      finish_latency_ms: finish === undefined ? null : nsToMs(finish - received.ts_ns, 3), origin: 'UNKNOWN', device_id: null,
    };
  });
  // Dispatch order matches the game publication order on this Android input channel. Use it only when both
  // cardinality and action sequence agree; otherwise retain UNKNOWN origin instead of guessing.
  if (dispatch.length === events.length && dispatch.every((row, k) => row.action === events[k].action)) {
    dispatch.forEach((row, k) => {
      Object.assign(events[k], { device_id: row.device_id, dispatch_ts_ns: row.dispatch_ts_ns, origin: row.device_id === -1n ? 'injected' : 'device' });
    });
  }
  return events;
}

const bisectLeft = (times: readonly bigint[], x: bigint) => { let lo = 0, hi = times.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < x) lo = mid + 1; else hi = mid; } return lo; };
const bisectRight = (times: readonly bigint[], x: bigint) => { let lo = 0, hi = times.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (x < times[mid]) hi = mid; else lo = mid + 1; } return lo; };

function contactGroups(events: readonly GameEvent[]): [GameEvent, GameEvent][] {
  const contacts: [GameEvent, GameEvent][] = [];
  let active: GameEvent | null = null;
  for (const event of events) {
    if (event.origin !== 'device') continue;
    if (event.action === 'DOWN') active = event;
    else if (event.action === 'UP' && active !== null) { contacts.push([active, event]); active = null; }
  }
  return contacts;
}

function targetState(index: number, before: string, after: string | null): string | null {
  if (after !== null && after !== before) return after;
  // The transition-only stream has an explicit legal order. This label is only a presentation aid; visual
  // evidence still has to show the change.
  const expected = ['MONITOR_UP', 'OFFICE', 'MASK_ON', 'OFFICE'];
  return index < expected.length ? expected[index] : null;
}

export function analyze(frames: readonly Frame[], events: readonly GameEvent[], maxWaitMs = 2500.0) {
  if (!frames.length) throw new AlignError('no native frames');
  if (maxWaitMs <= 0) throw new RangeError('max_wait_ms must be positive');
  const intervals = frames.slice(1).flatMap((later, k) => (later.image_ns > frames[k].image_ns ? [trueDivide(later.image_ns - frames[k].image_ns, 1_000_000n)] : []));
  // Keep the repository's actuation metric contract: the calibrated coverage rule currently proves only OFFICE
  // versus MONITOR_UP. A native MASK_ON classification is useful for animation landing, but it is not promoted
  // to combined control coverage until its independent mask rule is qualified. Therefore MASK_ON remains UNKNOWN
  // in this percentage.
  const known = frames.filter(frame => frame.state === 'OFFICE' || frame.state === 'MONITOR_UP').length;
  const coverageUnknown = frames.length - known;
  const stateUnknown = frames.filter(frame => frame.state === 'UNKNOWN').length;
  const times = frames.map(frame => frame.trace_ns);
  // int(max_wait_ms * 1_000_000): NaN is a ValueError, infinity an OverflowError that main does not catch.
  const waitNs = maxWaitMs * 1_000_000;
  const waitError = Number.isNaN(waitNs) ? new RangeError('cannot convert float NaN to integer')
    : waitNs === Infinity ? new Error('cannot convert float infinity to integer') : null;
  const contacts = contactGroups(events).map(([down, up], index) => {
    const beforeIndex = bisectRight(times, down.receive_ts_ns) - 1;
    const preState = beforeIndex >= 0 ? frames[beforeIndex].state : 'UNKNOWN';
    const startIndex = bisectLeft(times, down.receive_ts_ns);
    if (waitError) throw waitError;
    const limitNs = up.receive_ts_ns + BigInt(Math.trunc(waitNs));
    let departure: Frame | null = null, departureIndex: number | null = null;
    if (preState !== 'UNKNOWN') {
      for (let k = startIndex; k < frames.length; k += 1) {
        if (frames[k].trace_ns > limitNs) break;
        if (frames[k].state !== preState) { departure = frames[k]; departureIndex = k; break; }
      }
    }
    let settled: Frame | null = null;
    if (departureIndex !== null) {
      for (const candidate of frames.slice(departureIndex)) {
        if (candidate.trace_ns > limitNs) break;
        if (['OFFICE', 'MONITOR_UP', 'MASK_ON'].includes(candidate.state) && candidate.state !== preState) { settled = candidate; break; }
      }
    }
    const target = settled ? settled.state : null;
    const expected = targetState(index, preState, target);
    const status = departure === null ? 'CHANNEL_DELIVERED_NO_VISUAL_EFFECT' : settled === null ? 'VISUAL_DEPARTURE_NO_SETTLED_TARGET'
      : target !== expected ? 'VISUAL_STATE_UNEXPECTED' : 'VISUAL_ACCEPTED';
    return {
      ordinal: index + 1, down_event_ordinal: down.ordinal, up_event_ordinal: up.ordinal,
      down_receive_ts_ns: down.receive_ts_ns, up_receive_ts_ns: up.receive_ts_ns,
      contact_channel_ms: nsToMs(up.receive_ts_ns - down.receive_ts_ns, 3), pre_state: preState, expected_state: expected,
      departure_frame: departure ? departure.seq : null, departure_trace_ns: departure ? departure.trace_ns : null,
      departure_after_release_ms: departure ? nsToMs(departure.trace_ns - up.receive_ts_ns, 3) : null,
      settled_state: target, settled_frame: settled ? settled.seq : null, settled_trace_ns: settled ? settled.trace_ns : null,
      observed_animation_ms: departure && settled ? nsToMs(settled.trace_ns - departure.trace_ns, 3) : null, status,
    };
  });
  let intervalSummary: { minMs: number, p50Ms: number, maxMs: number, over25ms: number } | null = null;
  if (intervals.length) {
    const ordered = [...intervals].sort((a, b) => a - b);
    intervalSummary = { minMs: round(ordered[0], 3), p50Ms: round(Number(pyMedian(ordered)), 3), maxMs: round(ordered[ordered.length - 1], 3),
      over25ms: ordered.filter(value => value > 25.0).length };
  }
  return {
    frames: frames.length, knownFrames: known, unknownFrames: coverageUnknown,
    unknownFramePct: round(100.0 * coverageUnknown / frames.length, 3), stateUnknownFrames: stateUnknown,
    stateUnknownFramePct: round(100.0 * stateUnknown / frames.length, 3), intervals: intervalSummary, contacts,
    visualAcceptedContacts: contacts.filter(row => row.status === 'VISUAL_ACCEPTED').length, deviceContacts: contacts.length,
  };
}


function findTraceProcessor(explicit: string | null): string {
  for (const candidate of [explicit, process.env.TRACE_PROCESSOR, 'trace_processor', 'trace_processor_shell'])
    if (candidate && ((existsSync(candidate) && statSync(candidate).isFile()) || which(candidate))) return candidate;
  throw new AlignError('trace_processor not found; pass --trace-processor');
}

function runQuery(processor: string, trace: string, query: string): string {
  const { stdout, stderr, code } = queryText(processor, trace, query, message => { throw new AlignError(message); });
  if (code) {
    const detail = pySplitLines(pyStrip(stderr || stdout));
    throw new AlignError(`trace processor failed: ${detail.length ? detail[detail.length - 1] : 'unknown error'}`);
  }
  return stdout;
}

// --- Python's values: a float through PyFloat, so a whole one keeps its .0 ----------------------------------

const f = (x: number | null) => (x === null ? null : new PyFloat(x));
const eventJson = (e: GameEvent): PyJson => {
  const json = new Map<string, PyJson>([
  ['ordinal', e.ordinal], ['action', e.action], ['publish_ts_ns', e.publish_ts_ns], ['receive_ts_ns', e.receive_ts_ns],
  ['channel_latency_ms', f(e.channel_latency_ms)], ['seq', e.seq], ['finish_ts_ns', e.finish_ts_ns], ['finish_latency_ms', f(e.finish_latency_ms)],
  ['origin', e.origin], ['device_id', e.device_id]]);
  if (e.dispatch_ts_ns !== undefined) json.set('dispatch_ts_ns', e.dispatch_ts_ns);
  return json;
};
type Contact = ReturnType<typeof analyze>['contacts'][number];
const contactJson = (c: Contact): PyJson => new Map<string, PyJson>(Object.entries(c).map<[string, PyJson]>(([key, value]) => {
  if (!key.endsWith('_ms')) return [key, value];
  if (typeof value !== 'number' && value !== null) throw new TypeError(`${key}: expected a duration`);
  return [key, f(value)];
}));
const intervalsJson = (i: ReturnType<typeof analyze>['intervals']): PyJson => (i === null ? {} : new Map<string, PyJson>([
  ['minMs', new PyFloat(i.minMs)], ['p50Ms', new PyFloat(i.p50Ms)], ['maxMs', new PyFloat(i.maxMs)], ['over25ms', i.over25ms]]));

function main(argv: readonly string[]): number {
  const args = pyArgs(argv, 'input-frame-align.ts', [{ name: '--package' }, { name: '--trace-processor' }, { name: '--max-wait-ms', type: 'float' },
    { name: '--json', takes: 'flag' }], [{ name: 'trace' }, { name: 'frame_trace' }]);
  if ('exit' in args) {
    (args.exit ? console.error : console.log)(args.text);
    return args.exit;
  }
  const option = (name: string) => { const value = args.options[name]; return typeof value === 'string' ? value : null; };
  const [trace, frameTrace] = args.positionals.map(pyPath);
  const pkg = option('--package') ?? DEFAULT_PACKAGE;
  const waitText = option('--max-wait-ms');
  const maxWaitMs = waitText === null ? 2500.0 : present(pyFloat(waitText), 'max wait');   // checked by pyArgs
  try {
    const file = (path: string) => existsSync(path) && statSync(path).isFile();
    if (!file(trace) || !file(frameTrace)) throw new AlignError('trace and frame trace must both exist');
    const processor = findTraceProcessor(option('--trace-processor'));
    const rows = parseQueryCsv(runQuery(processor, trace, buildQuery(pkg)));
    const clockQuery = "select snapshot_id,clock_name,clock_value from clock_snapshot where clock_name in ('BOOTTIME','MONOTONIC') order by snapshot_id,clock_name";
    const [offset, clock] = clockOffset(parseClockRows(runQuery(processor, trace, clockQuery)));
    const [header, rawFrames] = readFrameTrace(frameTrace);
    const frames = decorateFrames(rawFrames, offset);
    const events = parseGameEvents(rows);
    const visual = analyze(frames, events, maxWaitMs);
    const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
    const channel = { publishes: rows.filter(row => row.kind === 'publish').length, receives: rows.filter(row => row.kind === 'receive').length,
      finishAcks: rows.filter(row => row.kind === 'finish').length };
    if (args.options['--json'] === true) {
      const report = new Map<string, PyJson>([
        ['schema', 'input-frame-align-v1'], ['trace', trace], ['frameTrace', frameTrace], ['package', pkg], ['traceProcessor', processor],
        ['clock', new Map<string, PyJson>([['offsetNs', clock.offsetNs], ['offsetMs', new PyFloat(clock.offsetMs)], ['samples', clock.samples],
          ['spreadNs', clock.spreadNs], ['method', clock.method]])],
        ['frameTraceHeader', header], ['channel', new Map<string, PyJson>([['publishes', channel.publishes], ['receives', channel.receives],
          ['finishAcks', channel.finishAcks], ['events', events.map(eventJson)]])],
        ['visual', new Map<string, PyJson>([
          ['frames', visual.frames], ['knownFrames', visual.knownFrames], ['unknownFrames', visual.unknownFrames],
          ['unknownFramePct', new PyFloat(visual.unknownFramePct)], ['stateUnknownFrames', visual.stateUnknownFrames],
          ['stateUnknownFramePct', new PyFloat(visual.stateUnknownFramePct)], ['intervals', intervalsJson(visual.intervals)],
          ['contacts', visual.contacts.map(contactJson)], ['visualAcceptedContacts', visual.visualAcceptedContacts],
          ['deviceContacts', visual.deviceContacts]])],
        ['traceSha256', sha(trace)], ['frameTraceSha256', sha(frameTrace)],
      ]);
      console.log(pyDumps(report, 2, { sortKeys: true }));
    } else {
      const i = visual.intervals;
      console.log(`native frames: ${visual.frames} known=${visual.knownFrames} unknown=${visual.unknownFrames}/${visual.frames} `
        + `unknown_frame_pct=${pyFixed(visual.unknownFramePct, 3)}`);
      console.log(`native cadence: ${i === null ? 'none' : `{'minMs': ${pyRepr(i.minMs)}, 'p50Ms': ${pyRepr(i.p50Ms)}, 'maxMs': ${pyRepr(i.maxMs)}, 'over25ms': ${i.over25ms}}`}`);
      console.log(`clock mapping: +${pyFixed(clock.offsetMs, 6)} ms (${clock.method}, samples=${clock.samples}, spread_ns=${clock.spreadNs})`);
      console.log(`game channel: publishes=${channel.publishes} receives=${channel.receives} finish_acks=${channel.finishAcks}`);
      console.log('# contact pre -> target departure_frame settled_frame animation_ms status');
      const width = (text: string) => [...text].length;
      const left = (text: string, size: number) => text + ' '.repeat(Math.max(0, size - width(text)));
      const right = (text: string, size: number) => ' '.repeat(Math.max(0, size - width(text))) + text;
      for (const c of visual.contacts) {
        console.log(`${String(c.ordinal).padStart(2, '0')} ${left(c.pre_state, 11)} -> ${left(c.expected_state || '-', 11)} `
          + `${right(c.departure_frame ? String(c.departure_frame) : '-', 6)} ${right(c.settled_frame ? String(c.settled_frame) : '-', 6)} `
          + `${right(c.observed_animation_ms === null ? '-' : pyRepr(c.observed_animation_ms), 13)} ${c.status}`);
      }
    }
    if (!events.length) {
      console.error('NO GAME CHANNEL EVENTS');
      return 3;
    }
    return 0;
  } catch (error) {
    if (!(error instanceof AlignError || error instanceof RangeError || (isRecord(error) && error.code !== undefined))) throw error;
    console.error(`input-frame-align: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
