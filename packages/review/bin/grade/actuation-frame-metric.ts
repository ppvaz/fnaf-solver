#!/usr/bin/env node
// Report native-frame state coverage for one physical actuation.
//
// The frame trace is the Companion's native-resolution 2400x1080 ImageReader stream. This tool applies the
// native fixed bottom-control strokes when a v3 trace carries them, and falls back to the checked-in monitor
// and mask anchor rules for older traces. It reports the percentage of frames on which the combined control
// state is UNKNOWN. A positive observation of one exclusive control safely complements the other; a negative
// observation never invents its opposite.
//
// The trace path intentionally records `screen_identity=UNKNOWN` so it can drain every ImageReader frame
// without running the live detector stack. For v3 traces, the offline metric uses the native fixed-stroke
// observations and does not use that field as a screen gate. Older traces without those stroke columns use the
// checked-in fitted anchors as a compatibility fallback (reading the 20x9 grid_hex already retained in a
// trace). This is a measurement of trace coverage, not a promotion of an unqualified rule to live control
// authority.
//
//   node packages/review/bin/grade/actuation-frame-metric.ts TRACE [--start-ns N] [--end-ns N] [--json]
//
// When no bounds are supplied the report is explicitly `scope=full-trace`; callers should use bounds that
// cover the actuation itself when setup frames are present in the capture. Ported from
// actuation-frame-metric.py; it prints what that printed and exits as it did.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PyFloat, isList, isRecord, pyArgs, pyDumps, pyFixed, pyInt, pyPath, pySplit, pySplitLines } from '@sixam/kernel';

const DEFAULT_MONITOR = fileURLToPath(new URL('../../../play/profiles/fnaf2/moto-g56/monitor-rule-moto-g56-v207.json', import.meta.url));
const DEFAULT_MASK = fileURLToPath(new URL('../../../play/profiles/fnaf2/moto-g56/mask-rule-moto-g56-v207.json', import.meta.url));
export const GRID_CELLS = 20 * 9;
const GRID_HEX_WIDTH = GRID_CELLS * 6;
const STROKE_VISIBLE_MIN = 100;
const STROKE_ABSENT_MAX = 40;

// The Python's MetricError was a ValueError, which parse_trace's row loop also caught: a bad grid_hex inside a
// row is reported as an invalid numeric field, as it was.
class MetricError extends Error {}

const luma = (rgb: number) => (77 * ((rgb >> 16) & 0xff) + 150 * ((rgb >> 8) & 0xff) + 29 * (rgb & 0xff)) >> 8;

type Rule = Readonly<Record<string, unknown>>;

function readRule(path: string): Rule {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path)));
  } catch (error) {
    throw new MetricError(`cannot read rule ${path}: ${(error as Error).message}`);
  }
  if (!isRecord(value)) throw new Error(`'${Array.isArray(value) ? 'list' : typeof value}' object has no attribute 'get'`);
  if (value.status !== 'calibrated') throw new MetricError(`rule ${path} is not calibrated`);
  if (value.schema !== 'monitor-rule-v1' && value.schema !== 'mask-rule-v1') throw new MetricError(`rule ${path} has an unsupported schema`);
  return value;
}

function parseCells(raw: string): number[] {
  if (raw.length !== GRID_HEX_WIDTH) throw new MetricError(`grid_hex has ${raw.length} hex characters; expected ${GRID_HEX_WIDTH}`);
  const cells: number[] = [];
  for (let index = 0; index < GRID_HEX_WIDTH; index += 6) {
    const cell = pyInt(raw.slice(index, index + 6), 16);
    if (cell === null) throw new MetricError('grid_hex contains a non-hex value');
    cells.push(Number(cell));
  }
  return cells;
}

interface Row {
  seq: number | null, image_ns: bigint, grid_mean_luma: number, screen_identity: number, mask_luma: number, monitor_luma: number,
  cells: number[], elapsed_ns?: bigint, mask_downstroke?: number, monitor_downstroke?: number,
}

function parseTrace(path: string): [Readonly<Record<string, string>>, Row[]] {
  let lines: string[];
  try {
    lines = pySplitLines(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path)));
  } catch (error) {
    if (error instanceof TypeError) throw error;   // undecodable text: Python raised, uncaught
    throw new MetricError(`cannot read trace ${path}: ${(error as Error).message}`);
  }
  if (lines.length < 2 || !lines[0].startsWith('# schema=fnaf2-frame-trace-v')) throw new MetricError(`${path}: not a fnaf2-frame-trace-v1 trace`);
  const header: Record<string, string> = {};
  for (const field of pySplit(lines[0].slice(2))) {
    const at = field.indexOf('=');
    if (at >= 0) header[field.slice(0, at)] = field.slice(at + 1);
  }
  const columns = lines[1].split('\t');
  const required = ['image_ns', 'grid_mean_luma', 'screen_identity', 'mask_luma', 'monitor_luma', 'grid_hex'];
  if (!required.every(name => columns.includes(name))) throw new MetricError(`${path}: trace columns do not carry the required state fields`);
  const index = new Map(required.map(name => [name, columns.indexOf(name)]));
  for (const name of ['elapsed_ns', 'seq']) if (columns.includes(name)) index.set(name, columns.indexOf(name));
  const strokes = ['mask_downstroke', 'monitor_downstroke'].filter(name => columns.includes(name));
  if (strokes.length === 1) throw new MetricError(`${path}: trace carries only one native stroke column`);
  for (const name of strokes) index.set(name, columns.indexOf(name));
  const rows: Row[] = [];
  lines.slice(2).forEach((line, k) => {
    const lineNumber = k + 3;
    if (!pySplit(line).length) return;
    const fields = line.split('\t');
    if (fields.length !== columns.length) throw new MetricError(`${path}:${lineNumber}: wrong column count`);
    const int = (name: string) => {
      const value = pyInt(fields[index.get(name) ?? -1] ?? '');
      if (value === null) throw new MetricError(`${path}:${lineNumber}: invalid numeric field`);
      return value;
    };
    const cells = () => {
      try {
        return parseCells(fields[index.get('grid_hex') ?? -1] ?? '');
      } catch {
        throw new MetricError(`${path}:${lineNumber}: invalid numeric field`);
      }
    };
    const row: Row = {
      seq: index.has('seq') ? Number(int('seq')) : null, image_ns: int('image_ns'), grid_mean_luma: Number(int('grid_mean_luma')),
      screen_identity: Number(int('screen_identity')), mask_luma: Number(int('mask_luma')), monitor_luma: Number(int('monitor_luma')),
      cells: cells(),
    };
    if (index.has('elapsed_ns')) row.elapsed_ns = int('elapsed_ns');
    for (const name of strokes) row[name === 'mask_downstroke' ? 'mask_downstroke' : 'monitor_downstroke'] = Number(int(name));
    rows.push(row);
  });
  if (!rows.length) throw new MetricError(`${path}: trace contains no frames`);
  return [header, rows];
}

/** A control's state on one frame, or null (UNKNOWN) with the reason. */
export interface State { readonly value: boolean | null, readonly reason: string | null }
export const state = (value: boolean | null, reason: string | null = null): State => ({ value, reason });

// What Python's indexing did: a key or item that is missing raised and stopped the run.
function at(value: unknown, key: string | number): unknown {
  if (typeof key === 'number') {
    if (!isList(value)) throw new Error(`cannot index ${JSON.stringify(value)} by ${key}`);
    const item = value.at(key);
    if (item === undefined) throw new Error('list index out of range');
    return item;
  }
  if (!isRecord(value) || !(key in value)) throw new Error(`KeyError: '${key}'`);
  return value[key];
}
const num = (value: unknown) => {
  if (typeof value !== 'number') throw new Error(`not a number: ${JSON.stringify(value)}`);
  return value;
};

function classify(rule: Rule, cells: readonly number[]): State {
  const guard = at(at(rule, 'adapter'), 'guard');
  if (Math.floor(cells.reduce((sum, cell) => sum + luma(cell), 0) / cells.length) < num(at(guard, 'min'))) return state(null, 'frame-dark');
  const readings: boolean[] = [];
  const anchors = at(at(rule, 'adapter'), 'anchors');
  if (!isList(anchors)) throw new Error('anchors is not a list');
  for (const anchor of anchors) {
    const value = luma(num(at(cells, num(at(anchor, 'cell')))));
    const threshold = num(at(at(anchor, 'rule'), 'threshold'));
    const band = num(at(at(anchor, 'rule'), 'refuse_band'));
    const present = at(anchor, 'kind') === 'present';
    const positive = present ? value >= threshold + band : value <= threshold - band;
    const negative = present ? value <= threshold - band : value >= threshold + band;
    if (positive === negative) return state(null, 'ambiguous-threshold');
    readings.push(positive);
  }
  if (!readings.length || readings.slice(1).some(value => value !== readings[0])) return state(null, 'ambiguous-threshold');
  return state(readings[0]);
}

/** Classify the exclusive monitor state from the fixed native strokes. */
function classifyNativeStrokes(maskStroke: number, monitorStroke: number): State {
  if (maskStroke < 0 || monitorStroke < 0) return state(null, 'native-stroke-unavailable');
  if (maskStroke <= STROKE_ABSENT_MAX && monitorStroke >= STROKE_VISIBLE_MIN) return state(true, 'native-stroke-monitor-up');
  if (maskStroke >= STROKE_VISIBLE_MIN && monitorStroke >= STROKE_VISIBLE_MIN) return state(false, 'native-stroke-office');
  return state(null, 'native-stroke-ambiguous');
}

/** The tested exclusive control states both imply mask-down. */
const classifyNativeMask = (monitor: State) => (monitor.value !== null ? state(false, 'native-stroke-mask-complement')
  : state(null, 'native-stroke-mask-ambiguous'));

export function reconcile(monitor: State, mask: State): State {
  if (monitor.value === true && mask.value === true) return state(null, 'mask-monitor-contradiction');
  if (monitor.value === true && mask.value === null) return state(true, 'mask-off-monitor-complement');
  if (monitor.value === null && mask.value === true) return state(false, 'monitor-down-mask-complement');
  if (monitor.value !== null && mask.value !== null) return state(true, 'observed');
  if (monitor.value === null && mask.value === null) return state(null, 'monitor-and-mask-unknown');
  return state(null, monitor.value === null ? 'monitor-unknown' : 'mask-unknown');
}

// round(100.0 * count / total, 3), a float
const pct = (count: number, total: number) => new PyFloat(total ? Number(pyFixed(100.0 * count / total, 3)) : 0.0);

function summary(states: readonly State[], total: number) {
  const unknown = states.filter(item => item.value === null);
  const reasons: Record<string, number> = {};
  for (const item of unknown) reasons[String(item.reason)] = (reasons[String(item.reason)] ?? 0) + 1;
  return { knownFrames: total - unknown.length, unknownFrames: unknown.length, unknownFramePct: pct(unknown.length, total), reasons };
}

export function report(path: string, startNs: bigint | null = null, endNs: bigint | null = null,
  monitorPath = DEFAULT_MONITOR, maskPath = DEFAULT_MASK) {
  if (startNs !== null && endNs !== null && endNs <= startNs) throw new MetricError('--end-ns must be greater than --start-ns');
  const [header, allRows] = parseTrace(path);
  const rows = allRows.filter(row => (startNs === null || row.image_ns >= startNs) && (endNs === null || row.image_ns < endNs));
  if (!rows.length) throw new MetricError('the selected trace scope contains no frames');
  const monitorRule = readRule(monitorPath);
  const maskRule = readRule(maskPath);
  const nativeStrokes = rows.every(row => row.mask_downstroke !== undefined && row.monitor_downstroke !== undefined);
  let monitorStates: State[], maskStates: State[], basis: string;
  if (nativeStrokes) {
    monitorStates = rows.map(row => classifyNativeStrokes(row.mask_downstroke ?? -1, row.monitor_downstroke ?? -1));
    maskStates = monitorStates.map(classifyNativeMask);
    basis = 'native-strokes';
  } else {
    monitorStates = rows.map(row => classify(monitorRule, row.cells));
    maskStates = rows.map(row => classify(maskRule, row.cells));
    basis = 'fitted-grid';
  }
  const combined = monitorStates.map((monitor, k) => reconcile(monitor, maskStates[k]));
  const total = rows.length;
  const unknown = combined.filter(item => item.value === null);
  return {
    schema: 'actuation-frame-metric-v1', basis, trace: pyPath(path),
    scope: { kind: startNs !== null || endNs !== null ? 'bounded' : 'full-trace', startNs, endNs },
    frames: total, traceFrames: allRows.length,
    monitor: summary(monitorStates, total), mask: summary(maskStates, total), combined: summary(combined, total),
    unknown_frame_pct: pct(unknown.length, total),
    traceStartNs: header.start_ns ?? null,
  };
}

function main(argv: readonly string[]): number {
  const args = pyArgs(argv, 'actuation-frame-metric.ts', [{ name: '--start-ns', type: 'int' }, { name: '--end-ns', type: 'int' },
    { name: '--monitor-rule' }, { name: '--mask-rule' }, { name: '--json', takes: 'flag' }], [{ name: 'trace' }]);
  if ('exit' in args) {
    (args.exit ? console.error : console.log)(args.text);
    return args.exit;
  }
  const values = args.options;
  const json = values['--json'] === true;
  const positional = args.positionals;
  const trace = pyPath(positional[0]);
  const bound = (flag: string) => { const value = values[flag]; return typeof value === 'string' ? pyInt(value) : null; };
  let output: ReturnType<typeof report>;
  try {
    const rule = (flag: string, fallback: string) => { const value = values[flag]; return typeof value === 'string' ? value : fallback; };
    output = report(trace, bound('--start-ns'), bound('--end-ns'), rule('--monitor-rule', DEFAULT_MONITOR), rule('--mask-rule', DEFAULT_MASK));
  } catch (caught) {
    if (!(caught instanceof MetricError)) throw caught;
    console.error(`actuation-frame-metric: ${caught.message}`);
    return 2;
  }
  if (json) console.log(pyDumps(output, 2, { sortKeys: true }));
  else {
    const name = trace.split('/').pop() ?? '';
    console.log(`ACTUATION_METRIC trace=${trace === '/' ? '' : name} scope=${output.scope.kind} `
      + `frames=${output.frames} `
      + `monitor_unknown_frame_pct=${pyFixed(output.monitor.unknownFramePct.value, 3)} `
      + `mask_unknown_frame_pct=${pyFixed(output.mask.unknownFramePct.value, 3)} `
      + `state_basis=${output.basis} `
      + `unknown_frames=${output.combined.unknownFrames}/${output.frames} `
      + `unknown_frame_pct=${pyFixed(output.unknown_frame_pct.value, 3)}`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
