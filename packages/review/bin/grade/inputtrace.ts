#!/usr/bin/env node
// Report Android input dispatch and frame landing from a Perfetto trace.
//
// The trace is queried through Perfetto's dependency-free `trace_processor` wrapper. This tool deliberately
// reports missing correlations instead of turning them into dropped events: an input slice can exist without a
// delivery or a usable frame signal, and those are different findings.
//
//   node packages/review/bin/grade/inputtrace.ts RUN-input.pftrace
//   node packages/review/bin/grade/inputtrace.ts RUN-input.pftrace --trace-processor ./trace_processor
//
// The command exits non-zero for an unreadable trace/query, an explicit `--expected` count mismatch, or a
// trace with no matching app events. The last case is printed as `NO APP EVENTS` so a caller cannot mistake a
// trace that recorded no input for a successful sweep.
//
// Ported from inputtrace.py: it prints and exits as that did. Its evidenceId hashes this analyzer and the
// shared Perfetto source, so a result names the code that produced it.
import { present, isRecord, isList } from '@sixam/kernel';
import { DISPATCH_RE, QUERY_PREFIX, formatQuery, which, queryText, csvBody } from './perfetto.ts';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PyFloat, type PyJson, pyArgs, pyCsvDicts, pyDecodeUtf8, pyDumps, pyFixed, pyFloat, pyInt, pyMedian, pyPath, pyPstdev, pyRepr, pyReprOf,
  pySplitLines, pyStrRepr, pyStrip,
} from '@sixam/kernel/py';

export const DEFAULT_PACKAGE = 'com.scottgames.fnaf2';
const DEFAULT_FRAME_WINDOW_MS = 50.0;

// The package filter belongs in SQL for two reasons: it keeps the CSV small on a whole-device trace, and it
// prevents a launcher/system-ui touch from being counted as a game contact merely because it has the same
// source value.
const QUERY_TEMPLATE = `${QUERY_PREFIX}
UNION ALL
SELECT 'delivery' AS kind, ts_ns, dur_ns, name, thread_name, process_name, track_name
FROM app_joined
WHERE name GLOB 'deliverInputEvent src=* eventTimeNano=* id=*'
UNION ALL
SELECT 'frame' AS kind, ts_ns, dur_ns, name, thread_name, process_name, track_name
FROM app_joined
WHERE name GLOB 'Choreographer#doFrame *'
UNION ALL
SELECT 'finish' AS kind, ts_ns, dur_ns, name, thread_name, process_name, track_name
FROM joined
WHERE lower(name) LIKE '%finishdispatchcycle%'
UNION ALL
-- Some Android builds omit process/track names for app slices. The input
-- dispatcher still preserves the package in this game-channel publication
-- marker, so retain it as a separate, auditable delivery observation rather
-- than declaring a good trace empty.
SELECT 'game_publish' AS kind, ts_ns, dur_ns, name, thread_name, process_name, track_name
FROM joined
WHERE name GLOB 'publishMotionEvent(inputChannel=*{package}*, action=*)'
ORDER BY ts_ns;
`;

// Python's re, kept: `$` also matches before a final newline, \d is any Unicode decimal digit (int() then
// reads it), and \b is a boundary between Unicode word characters and the rest.
export { DISPATCH_RE } from './perfetto.ts';
const DELIVERY_RE = /^deliverInputEvent [^\n]*?eventTimeNano=(?<event_time_ns>\p{Nd}+) id=(?<event_id>0x[0-9a-fA-F]+)(?=\n?$)/u;
const ID_RE = /(?<![\p{L}\p{N}_])id=(?<event_id>0x[0-9a-fA-F]+)(?![\p{L}\p{N}_])/u;
const FRAME_RE = /^Choreographer#doFrame (?<frame_id>\p{Nd}+)(?=\n?$)/u;
export const PUBLISHED_RE = /^publishMotionEvent\(inputChannel=[^\n]*?, action=(?<action>[^\n]+)\)(?=\n?$)/u;

/** An input trace could not be queried or decoded. */
class InputTraceError extends Error {}

/** Build the fixed query, escaping only the caller-supplied package. */
export const buildQuery = (pkg = DEFAULT_PACKAGE): string => formatQuery(QUERY_TEMPLATE, pkg);

/** Discard optional trace-processor progress text before the CSV header. */

export interface Row { kind: string | null, ts_ns: bigint, dur_ns: bigint, name: string | null, thread_name: string, process_name: string, track_name: string }

const rowRepr = (row: ReadonlyMap<string | null, string | null | string[]>) => `{${[...row].map(([key, value]) =>
  `${key === null ? 'None' : pyStrRepr(key)}: ${value === null ? 'None' : Array.isArray(value) ? `[${value.map(pyStrRepr).join(', ')}]` : pyStrRepr(value)}`).join(', ')}}`;

/** Parse trace_processor CSV into normalized rows. */
export function parseQueryCsv(stdout: string): Row[] {
  const { fieldnames, rows } = pyCsvDicts(csvBody(stdout, message => { throw new InputTraceError(message); }));
  const required = ['kind', 'ts_ns', 'dur_ns', 'name', 'thread_name', 'process_name', 'track_name'];
  if (!required.every(name => (fieldnames ?? []).includes(name)))
    throw new InputTraceError(`trace-processor CSV lacks required columns (got ${(fieldnames ?? []).join(', ')})`);
  return rows.map((row, k) => {
    const text = (name: string): string | null => {
      const value = row.get(name);
      if (value === undefined || isList(value)) throw new InputTraceError(`invalid CSV column ${name}`);
      return value;
    };   // a required column: a string, or None where the row ran short
    const int = (value: string | null) => {
      const parsed = value === null ? null : pyInt(value);
      if (parsed === null) throw new InputTraceError(`invalid CSV row ${k + 2}: ${rowRepr(row)}`);
      return parsed;
    };
    return {
      kind: text('kind'), ts_ns: int(text('ts_ns')), dur_ns: text('dur_ns') ? int(text('dur_ns')) : 0n,
      name: text('name'), thread_name: text('thread_name') || '', process_name: text('process_name') || '', track_name: text('track_name') || '',
    };
  });
}

/** pattern.match(name): a row whose name column ran short (None) stopped the run, as re did with a TypeError. */
function match(pattern: RegExp, name: string | null) {
  if (name === null) throw new TypeError("expected string or bytes-like object, got 'NoneType'");
  return pattern.exec(name);
}

/** round(x, 3): the exact value to three decimals, read back as a float. */
const round3 = (x: number) => Number(pyFixed(x, 3));

interface Delivery extends Row { event_time_ns: bigint, event_id: string }
interface Finish extends Row { event_id: string }
interface Frame extends Row { frame_id: bigint | null }

export interface Event {
  action: string, device_id: bigint, source: string, history_size: bigint, dispatch_ts_ns: bigint, dispatch_dur_ns: bigint,
  thread_name: string, process_name: string, input_origin: string, delivery_ts_ns: bigint | null, event_time_ns: bigint | null,
  event_id: string | null, delivery_correlation: string, finish_ts_ns: bigint | null, frame_ts_ns: bigint | null,
  frame_id: bigint | null, frame_delta_ms: number | null, frame_status: string,
}

function nearestDelivery(event: Event, deliveries: readonly Delivery[]) {
  const containing = deliveries.filter(d => d.ts_ns <= event.dispatch_ts_ns && event.dispatch_ts_ns <= d.ts_ns + (d.dur_ns > 0n ? d.dur_ns : 0n));
  if (!containing.length) return null;
  // min by (dur, -ts): the first of the smallest
  return containing.reduce((best, d) => (d.dur_ns < best.dur_ns || (d.dur_ns === best.dur_ns && d.ts_ns > best.ts_ns) ? d : best));
}

function attachDelivery(event: Event, delivery: Delivery, method: string) {
  Object.assign(event, { delivery_ts_ns: delivery.ts_ns, event_time_ns: delivery.event_time_ns, event_id: delivery.event_id, delivery_correlation: method });
}

function attachFinish(event: Event, delivery: Delivery, finishes: readonly Finish[]) {
  const matching = finishes.filter(f => f.event_id === delivery.event_id && f.ts_ns >= delivery.ts_ns);
  if (matching.length) event.finish_ts_ns = matching.reduce((best, f) => (f.ts_ns < best.ts_ns ? f : best)).ts_ns;
}

export interface Distribution { n: number, median_ms: bigint | number, p90_ms: bigint | number, p95_ms: bigint | number, p99_ms: bigint | number,
  max_ms: bigint | number, sigma_ms: number, percentile_method: string }

/** Latency distribution, not a claim that errors are IID or Gaussian. A bigint is a Python int, a number a float. */
export function distributionMs(values: readonly (bigint | number)[]): Distribution | null {
  const ordered = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (!ordered.length) return null;
  const percentile = (p: number) => ordered[Math.max(0, Math.ceil(p * ordered.length) - 1)];
  return { n: ordered.length, median_ms: pyMedian(ordered), p90_ms: percentile(0.90), p95_ms: percentile(0.95),
    p99_ms: percentile(0.99), max_ms: ordered[ordered.length - 1], sigma_ms: pyPstdev(ordered), percentile_method: 'nearest-rank' };
}

function timingSummary(events: readonly Event[]) {
  const presses = events.filter(event => event.action === 'DOWN' || event.action === 'POINTER_DOWN');
  // Perfetto normalizes slice timestamps onto its trace clock; Android's MotionEvent eventTimeNano is a source
  // timestamp. Without clock snapshots mapping those domains, subtracting them would manufacture dispatch lag.
  // A Choreographer slice is not a Fusion input poll or a visible game effect.
  const frameDelays = presses.flatMap(event => (event.frame_delta_ms === null ? [] : [event.frame_delta_ms]));
  return {
    clock_domains: { event_time_ns: 'android-monotonic-ns', dispatch_ts_ns: 'perfetto-trace-ns', frame_ts_ns: 'perfetto-trace-ns' },
    press_count: presses.length,
    inject: { status: 'UNKNOWN', reason: 'no-id-matched-command-request-timestamps' },
    dispatch: { status: 'UNKNOWN', reason: 'no-event-clock-to-trace-clock-mapping' },
    effective: { status: 'UNKNOWN', reason: 'no-id-matched-request-and-positive-game-effect' },
    dispatch_to_next_app_frame_proxy: {
      status: frameDelays.length ? 'OBSERVED' : 'UNKNOWN',
      distribution: distributionMs(frameDelays),
      missing: presses.length - frameDelays.length,
      out_of_window: presses.filter(event => event.frame_status === 'out-of-window').length,
      meaning: 'next-Choreographer-slice-only; NOT game input acceptance or game-frame phase',
    },
  };
}

const counter = (values: readonly string[]) => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return new Map([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
};

/** Correlate app dispatch slices with deliveries, finish cycles, and frames. */
export function analyze(rows: readonly Row[], frameWindowMs = DEFAULT_FRAME_WINDOW_MS) {
  if (frameWindowMs <= 0) throw new RangeError('frame window must be positive');
  const deliveries = rows.flatMap(row => {
    const m = row.kind === 'delivery' ? match(DELIVERY_RE, row.name) : null;
    return m?.groups ? [{ ...row, event_time_ns: present(pyInt(m.groups.event_time_ns), 'parsed integer'), event_id: m.groups.event_id.toLowerCase() }] : [];
  });
  const published = rows.flatMap(row => {
    const m = row.kind === 'game_publish' ? match(PUBLISHED_RE, row.name) : null;
    return m?.groups ? [{ ...row, action: m.groups.action }] : [];
  });
  const finishes = rows.flatMap(row => {
    const m = row.kind === 'finish' ? match(ID_RE, row.name) : null;
    return m?.groups ? [{ ...row, event_id: m.groups.event_id.toLowerCase() }] : [];
  });
  const frames: Frame[] = rows.filter(row => row.kind === 'frame').map(row => {
    const id = match(FRAME_RE, row.name)?.groups?.frame_id;
    return { ...row, frame_id: id === undefined ? null : present(pyInt(id), 'parsed integer') };
  }).sort((a, b) => (a.ts_ns < b.ts_ns ? -1 : a.ts_ns > b.ts_ns ? 1 : 0));
  const events: Event[] = [];
  let unparsed = 0;
  for (const row of rows) {
    if (row.kind !== 'dispatch') continue;
    const groups = match(DISPATCH_RE, row.name)?.groups;
    if (!groups) { unparsed += 1; continue; }
    const event: Event = {
      action: groups.action, device_id: present(pyInt(groups.device_id), 'parsed integer'), source: groups.source.toLowerCase(),
      history_size: present(pyInt(groups.history_size), 'parsed integer'), dispatch_ts_ns: row.ts_ns, dispatch_dur_ns: row.dur_ns,
      thread_name: row.thread_name, process_name: row.process_name,
      input_origin: pyInt(groups.device_id) === -1n ? 'injected' : 'device',
      delivery_ts_ns: null, event_time_ns: null, event_id: null, delivery_correlation: 'missing', finish_ts_ns: null,
      frame_ts_ns: null, frame_id: null, frame_delta_ms: null, frame_status: 'missing',
    };
    const delivery = nearestDelivery(event, deliveries);
    if (delivery) {
      attachDelivery(event, delivery, 'enclosing');
      attachFinish(event, delivery, finishes);
    }
    const frame = frames.find(item => item.ts_ns >= event.dispatch_ts_ns);
    if (frame) {
      const deltaMs = Number(frame.ts_ns - event.dispatch_ts_ns) / 1_000_000;
      Object.assign(event, { frame_ts_ns: frame.ts_ns, frame_id: frame.frame_id, frame_delta_ms: round3(deltaMs),
        frame_status: deltaMs <= frameWindowMs ? 'matched' : 'out-of-window' });
    }
    events.push(event);
  }
  // On Android's input trace, the app's `dispatchInputEvent` slice can be emitted just before the app's
  // `deliverInputEvent` slice rather than as a parent/child pair. When both app streams have the same
  // cardinality, the chronological ordinal is an explicit, auditable fallback; it is never applied to a partial
  // stream where it could silently hide a missing read.
  const freeEvents = events.filter(event => event.event_id === null);
  const freeDeliveries = deliveries.filter(delivery => !events.some(event => event.event_id === delivery.event_id));
  if (freeEvents.length && freeEvents.length === freeDeliveries.length) {
    freeEvents.forEach((event, k) => {
      attachDelivery(event, freeDeliveries[k], 'ordinal');
      attachFinish(event, freeDeliveries[k], finishes);
    });
  }
  return {
    events,
    timing: timingSummary(events),
    summary: {
      dispatch_events: events.length,
      unparsed_dispatch_slices: unparsed,
      actions: counter(events.map(event => event.action)),
      origins: counter(events.map(event => event.input_origin)),
      delivery_matches: events.filter(event => event.event_id !== null).length,
      finish_matches: events.filter(event => event.finish_ts_ns !== null).length,
      game_channel_publishes: published.length,
      game_channel_actions: counter(published.map(item => item.action)),
      frame_candidates: events.filter(event => event.frame_ts_ns !== null).length,
      frame_matches: events.filter(event => event.frame_status === 'matched').length,
      frame_out_of_window: events.filter(event => event.frame_status === 'out-of-window').length,
      trace_rows: rows.length,
      delivery_slices: deliveries.length,
      finish_slices: finishes.length,
      frame_slices: frames.length,
      frame_window_ms: frameWindowMs,
    },
  };
}

/** Summarize the stable integer rows from `dumpsys ... --latency`: the refresh period, then present-time triples. */
export function parseSurfaceflingerLatency(text: string) {
  // re.fullmatch(r"\d+") takes any Unicode decimal digit, which int() then reads.
  const values = pySplitLines(text).map(pyStrip).filter(value => /^\p{Nd}+$/u.test(value)).map(value => present(pyInt(value), 'parsed integer'));
  if (!values.length) return { refresh_period_ns: null, frame_count: 0, interval_ms: new Map<string, number>() };
  const presents = values.filter((_, k) => k >= 2 && (k - 2) % 3 === 0).filter(value => value > 0n);
  const intervals = presents.slice(1).map((later, k) => later - presents[k]).filter(gap => gap > 0n);
  const interval = new Map<string, number>();
  if (intervals.length) {
    const median = pyMedian(intervals);
    interval.set('median', round3(Number(median) / 1_000_000));
    interval.set('min', round3(Number(intervals.reduce((a, b) => (b < a ? b : a))) / 1_000_000));
    interval.set('max', round3(Number(intervals.reduce((a, b) => (b > a ? b : a))) / 1_000_000));
  }
  return { refresh_period_ns: values[0], frame_count: presents.length, interval_ms: interval };
}

/** shutil.which, for a command name or a path. */

function findTraceProcessor(explicit: string | null): string {
  for (const candidate of [explicit, process.env.TRACE_PROCESSOR, 'trace_processor', 'trace_processor_shell'])
    if (candidate && ((existsSync(candidate) && statSync(candidate).isFile()) || which(candidate))) return candidate;
  throw new InputTraceError('trace_processor not found; set TRACE_PROCESSOR or pass --trace-processor '
    + '(download the official dependency-free wrapper outside the repository)');
}

export function runQuery(processor: string, trace: string, pkg: string): Row[] {
  const { stdout, stderr, code } = queryText(processor, trace, buildQuery(pkg), message => { throw new InputTraceError(message); });
  if (code) {
    const detail = pySplitLines(pyStrip(stderr || stdout));
    throw new InputTraceError(`trace processor failed (${code}): ${detail.length ? detail[detail.length - 1] : 'no diagnostic'}`);
  }
  return parseQueryCsv(stdout);
}

// --- Python's values, for the JSON and the text report --------------------------------------------------

/** A float of this port as Python wrote it: through PyFloat, so 50.0 stays 50.0. */
const float = (x: number | null) => (x === null ? null : new PyFloat(x));
const num = (x: bigint | number) => (typeof x === 'bigint' ? x : new PyFloat(x));
const distributionJson = (d: Distribution | null): PyJson => (d === null ? null : new Map<string, PyJson>([
  ['n', d.n], ['median_ms', num(d.median_ms)], ['p90_ms', num(d.p90_ms)], ['p95_ms', num(d.p95_ms)], ['p99_ms', num(d.p99_ms)],
  ['max_ms', num(d.max_ms)], ['sigma_ms', new PyFloat(d.sigma_ms)], ['percentile_method', d.percentile_method]]));
const eventJson = (e: Event): PyJson => new Map<string, PyJson>(Object.entries(e).map<[string, PyJson]>(([key, value]) =>
  [key, key === 'frame_delta_ms' ? float(e.frame_delta_ms) : value]));

function main(argv: readonly string[]): number {
  const args = pyArgs(argv, 'inputtrace.ts', [{ name: '--package' }, { name: '--trace-processor' }, { name: '--frame-window-ms', type: 'float' },
    { name: '--sf-latency' }, { name: '--expected', type: 'int' }, { name: '--json', takes: 'flag' }], [{ name: 'trace' }]);
  if ('exit' in args) {
    (args.exit ? console.error : console.log)(args.text);
    return args.exit;
  }
  const option = (name: string) => { const value = args.options[name]; return typeof value === 'string' ? value : null; };
  const trace = pyPath(args.positionals[0]);
  const pkg = option('--package') ?? DEFAULT_PACKAGE;
  const windowText = option('--frame-window-ms');
  const frameWindowMs = windowText === null ? DEFAULT_FRAME_WINDOW_MS : present(pyFloat(windowText), 'frame window');   // checked by pyArgs
  const expectedText = option('--expected');
  const expected = expectedText === null ? null : present(pyInt(expectedText), 'parsed integer');   // checked by pyArgs
  try {
    if (!existsSync(trace) || !statSync(trace).isFile()) throw new InputTraceError(`trace does not exist: ${trace}`);
    const processor = findTraceProcessor(option('--trace-processor'));
    const rows = runQuery(processor, trace, pkg);
    const report = analyze(rows, frameWindowMs);
    const traceHash = createHash('sha256').update(readFileSync(trace)).digest('hex');
    const analyzer = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url)))
      .update(readFileSync(fileURLToPath(new URL('./perfetto.ts', import.meta.url)))).digest('hex');
    const evidenceId = `inputtrace-${createHash('sha256').update(pyDumps(new Map<string, PyJson>([['trace', traceHash], ['package', pkg],
      ['window', new PyFloat(frameWindowMs)], ['analyzer', analyzer]]), undefined, { sortKeys: true })).digest('hex').slice(0, 20)}`;
    let surfaceflinger: ReturnType<typeof parseSurfaceflingerLatency> | null = null;
    const sfPath = option('--sf-latency');
    if (sfPath !== null) {
      const sf = pyPath(sfPath);
      if (!existsSync(sf) || !statSync(sf).isFile()) throw new InputTraceError(`SurfaceFlinger latency file does not exist: ${sf}`);
      surfaceflinger = parseSurfaceflingerLatency(pyDecodeUtf8(readFileSync(sf)));
    }
    const s = report.summary;
    const sfJson = surfaceflinger && new Map<string, PyJson>([['refresh_period_ns', surfaceflinger.refresh_period_ns],
      ['frame_count', surfaceflinger.frame_count], ['interval_ms', new Map([...surfaceflinger.interval_ms].map(([k, v]) => [k, new PyFloat(v)]))]]);
    const t = report.timing;
    const json = new Map<string, PyJson>([
      ['events', report.events.map(eventJson)],
      ['timing', new Map<string, PyJson>([['clock_domains', t.clock_domains], ['press_count', t.press_count], ['inject', t.inject], ['dispatch', t.dispatch],
        ['effective', t.effective], ['dispatch_to_next_app_frame_proxy', new Map<string, PyJson>([['status', t.dispatch_to_next_app_frame_proxy.status],
          ['distribution', distributionJson(t.dispatch_to_next_app_frame_proxy.distribution)], ['missing', t.dispatch_to_next_app_frame_proxy.missing],
          ['out_of_window', t.dispatch_to_next_app_frame_proxy.out_of_window], ['meaning', t.dispatch_to_next_app_frame_proxy.meaning]])]])],
      ['summary', new Map<string, PyJson>(Object.entries(s).map<[string, PyJson]>(([key, value]) => [key, key === 'frame_window_ms' ? new PyFloat(s.frame_window_ms) : value]))],
      ['trace', trace], ['package', pkg], ['trace_processor', processor], ['schema', 'inputtrace-result-v2'], ['trace_sha256', traceHash], ['evidenceId', evidenceId],
    ]);
    if (sfJson) json.set('surfaceflinger_latency', sfJson);
    if (args.options['--json'] === true) console.log(pyDumps(json, 2, { sortKeys: true }));
    else printReport(trace, pkg, report, surfaceflinger);
    if (!report.events.length && !s.game_channel_publishes) return 3;
    if (expected !== null && BigInt(s.dispatch_events) !== expected) {
      console.error(`expected ${expected} dispatch events, found ${s.dispatch_events}`);
      return 1;
    }
    return 0;
  } catch (error) {
    if (!(error instanceof InputTraceError || error instanceof RangeError || (isRecord(error) && error.code !== undefined))) throw error;
    console.error(`inputtrace: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

const width = (text: string) => [...text].length;
const left = (text: string, size: number) => text + ' '.repeat(Math.max(0, size - width(text)));
const right = (text: string, size: number) => ' '.repeat(Math.max(0, size - width(text))) + text;

function printReport(trace: string, pkg: string, report: ReturnType<typeof analyze>, sf: ReturnType<typeof parseSurfaceflingerLatency> | null) {
  const s = report.summary;
  const orNone = (counts: ReadonlyMap<string, number>) => (counts.size ? pyReprOf(new Map([...counts].map(([k, v]) => [k, BigInt(v)]))) : 'none');
  console.log(`trace: ${trace}`);
  console.log(`package: ${pkg}`);
  console.log(`dispatch events: ${s.dispatch_events}  actions=${orNone(s.actions)}  origins=${orNone(s.origins)}`);
  console.log(`delivery matches: ${s.delivery_matches}/${s.dispatch_events}  finish matches: ${s.finish_matches}/${s.dispatch_events}`);
  console.log(`game-channel publishes: ${s.game_channel_publishes}  actions=${orNone(s.game_channel_actions)}`);
  console.log(`frame candidates: ${s.frame_candidates}/${s.dispatch_events}  within ${pyRepr(s.frame_window_ms)} ms: ${s.frame_matches}`);
  if (sf !== null) {
    const interval = sf.interval_ms;
    console.log(`SurfaceFlinger latency: ${String(sf.frame_count)} frames, refresh=${sf.refresh_period_ns === null ? 'None' : String(sf.refresh_period_ns)} ns, `
      + `intervals=${interval.size ? `{${[...interval].map(([k, v]) => `${pyStrRepr(k)}: ${pyRepr(v)}`).join(', ')}}` : 'none'}`);
  }
  console.log('inject / dispatch / effective latency: UNKNOWN (request IDs, clock mapping and game effects required)');
  const d = report.timing.dispatch_to_next_app_frame_proxy.distribution;
  const value = (x: bigint | number) => (typeof x === 'bigint' ? String(x) : pyRepr(x));
  console.log(`dispatch -> next app frame PROXY: ${d === null ? 'None' : `{'n': ${d.n}, 'median_ms': ${value(d.median_ms)}, 'p90_ms': ${value(d.p90_ms)}, `
    + `'p95_ms': ${value(d.p95_ms)}, 'p99_ms': ${value(d.p99_ms)}, 'max_ms': ${value(d.max_ms)}, 'sigma_ms': ${pyRepr(d.sigma_ms)}, 'percentile_method': 'nearest-rank'}`}`);
  if (!report.events.length) {
    console.log(s.game_channel_publishes ? 'NO APP DISPATCH SLICES; GAME CHANNEL PUBLISHES PRESENT' : 'NO APP EVENTS');
    return;
  }
  const origin = report.events.reduce((low, event) => (event.dispatch_ts_ns < low ? event.dispatch_ts_ns : low), report.events[0].dispatch_ts_ns);
  console.log('# action origin device dispatch_ms delivery event_id frame_id frame_delta_ms status');
  report.events.forEach((event, k) => {
    const dispatchMs = Number(event.dispatch_ts_ns - origin) / 1_000_000;
    console.log(`${String(k + 1).padStart(2, '0')} ${left(event.action, 6)} ${left(event.input_origin, 8)} `
      + `${right(String(event.device_id), 6)} ${right(pyFixed(dispatchMs, 3), 10)} ${left(event.event_id ? 'yes' : 'no', 8)} `
      + `${left(event.event_id || '-', 12)} ${right(event.frame_id ? String(event.frame_id) : '-', 8)} `
      + `${right(event.frame_delta_ms === null ? '-' : pyRepr(event.frame_delta_ms), 15)} ${event.frame_status}`);
  });
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
