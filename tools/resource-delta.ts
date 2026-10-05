#!/usr/bin/env node
// Compare resource maps from equivalent workloads on one host/runtime.
// npm run test:resources -- --baseline MAP --candidate MAP --out REPORT [--expectations FILE]
// REVIEW_REQUIRED is actionable by an agent: declare a bounded reason, change the implementation,
// or obtain a better measurement. It is not a request for human approval.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isList, isRecord, present } from '@sixam/kernel';

export interface ResourceMap {
  readonly schema: 'resource-map-v1';
  readonly evidenceId: string;
  readonly claimLevel: 'MODEL_ONLY' | 'FIXTURE' | 'DEVICE_MEASURED';
  readonly context: Readonly<Record<string, string>>;
  readonly coverage: readonly string[];
  readonly metrics: readonly {
    readonly id: string;
    readonly unit: 'ms' | 'MiB';
    readonly scope: 'function' | 'path' | 'process';
    readonly samples: readonly number[];
  }[];
}
export interface ResourceExpectations {
  readonly schema: 'resource-expectations-v1';
  readonly baselineId: string;
  readonly changes: readonly { readonly metric: string, readonly maxRatio: number, readonly reason: string }[];
}

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
function refuse(why: string): never { throw new TypeError(`resource-delta: ${why}`); }

export function validateMap(value: unknown): ResourceMap {
  if (!isRecord(value) || value.schema !== 'resource-map-v1' || !text(value.evidenceId)) refuse('invalid map identity');
  if (value.claimLevel !== 'MODEL_ONLY' && value.claimLevel !== 'FIXTURE' && value.claimLevel !== 'DEVICE_MEASURED')
    refuse('map requires its measurement ceiling');
  if (!isRecord(value.context) || !Object.keys(value.context).length || !Object.values(value.context).every(text))
    refuse('context must bind hardware, runtime, workload and instrument');
  for (const key of ['hardware', 'runtime', 'workload', 'instrument'])
    if (!text(value.context[key])) refuse(`context.${key} is required`);
  if (!isList(value.coverage) || !value.coverage.length || !value.coverage.every(text)) refuse('coverage is required');
  const metrics = value.metrics;
  if (!isList(metrics) || !metrics.length) return refuse('no measured metrics');
  const ids = new Set<string>();
  for (const row of metrics) {
    if (!isRecord(row) || !text(row.id) || (row.unit !== 'ms' && row.unit !== 'MiB') ||
      (row.scope !== 'function' && row.scope !== 'path' && row.scope !== 'process')) refuse('invalid metric identity/unit/scope');
    if (ids.has(row.id)) refuse(`duplicate metric ${row.id}`);
    ids.add(row.id);
    if (!isList(row.samples) || row.samples.length < 3 || !row.samples.every(positive))
      refuse(`${row.id}: require at least three positive finite observations`);
  }
  return value as unknown as ResourceMap;
}

export function validateExpectations(value: unknown): ResourceExpectations {
  if (!isRecord(value) || value.schema !== 'resource-expectations-v1' || !text(value.baselineId)) refuse('invalid expectation identity');
  const changes = value.changes;
  if (!isList(changes)) return refuse('expectations need changes');
  const ids = new Set<string>();
  for (const row of changes) {
    if (!isRecord(row) || !text(row.metric) || !positive(row.maxRatio) || !text(row.reason))
      refuse('each expectation needs a metric, finite positive limit and concrete reason');
    if (ids.has(row.metric)) refuse(`duplicate expectation ${row.metric}`);
    ids.add(row.metric);
  }
  return value as unknown as ResourceExpectations;
}

function stats(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? present(sorted[mid], 'median')
    : (present(sorted[mid - 1], 'lower middle') + present(sorted[mid], 'upper middle')) / 2;
  return { min: present(sorted[0], 'minimum'), median, max: present(sorted.at(-1), 'maximum'), n: sorted.length };
}

export function compareResources(baseline: ResourceMap, candidate: ResourceMap,
  expectations: ResourceExpectations = { schema: 'resource-expectations-v1', baselineId: baseline.evidenceId, changes: [] }) {
  if (expectations.baselineId !== baseline.evidenceId) refuse('expectations name a different baseline');
  const keys = [...new Set([...Object.keys(baseline.context), ...Object.keys(candidate.context)])].sort();
  const incompatible = keys.filter(key => baseline.context[key] !== candidate.context[key]);
  if (baseline.claimLevel !== candidate.claimLevel) incompatible.push('claimLevel');
  if ([...baseline.coverage].sort().join('\n') !== [...candidate.coverage].sort().join('\n')) incompatible.push('coverage');
  const baselineMetrics = new Map(baseline.metrics.map(metric => [metric.id, metric]));
  const candidateMetrics = new Map(candidate.metrics.map(metric => [metric.id, metric]));
  for (const item of expectations.changes)
    if (!baselineMetrics.has(item.metric) || !candidateMetrics.has(item.metric)) refuse(`expectation names unmeasured metric ${item.metric}`);
  const ids = [...new Set([...baselineMetrics.keys(), ...candidateMetrics.keys()])].sort();
  const rows = ids.map(id => {
    const before = baselineMetrics.get(id), after = candidateMetrics.get(id);
    if (!before || !after) return { id, status: 'UNKNOWN', reason: 'Missing counterpart; never interpret absence as zero.' };
    if (before.unit !== after.unit || before.scope !== after.scope || incompatible.length)
      return { id, status: 'UNKNOWN', reason: `Incompatible context/unit/scope: ${incompatible.join(', ')}` };
    const a = stats(before.samples), b = stats(after.samples);
    const ratio = b.median / a.median, ratioRange = { lo: b.min / a.max, hi: b.max / a.min };
    const observedMaxRatio = b.max / a.max;
    // A tolerance for this pilot, not a physical bound or a statistical confidence interval.
    const tolerance = 1.2;
    const expectation = expectations.changes.find(item => item.metric === id);
    const status = expectation && ratioRange.hi > expectation.maxRatio ? 'BUDGET_EXCEEDED'
      : ratio <= tolerance && observedMaxRatio <= tolerance ? 'WITHIN_TOLERANCE'
        : expectation && ratioRange.hi <= expectation.maxRatio ? 'EXPECTED_INCREASE'
        : ratioRange.lo > tolerance ? 'UNEXPECTED_INCREASE' : 'INCONCLUSIVE';
    return { id, unit: before.unit, scope: before.scope, baseline: a, candidate: b,
      medianDeltaPercent: (ratio - 1) * 100, observedMaxRatio, ratioRange, tolerance, status,
      expectation: expectation ?? null };
  });
  const pending = rows.filter(row => !['WITHIN_TOLERANCE', 'EXPECTED_INCREASE'].includes(row.status));
  const body = { schema: 'resource-delta-v1', baselineId: baseline.evidenceId, candidateId: candidate.evidenceId,
    claimLevel: baseline.claimLevel, status: pending.length ? 'REVIEW_REQUIRED' : 'PASS', coverage: baseline.coverage, incompatible, rows,
    note: 'Observed costs only. Range is min/max over repeats, not a confidence interval or WCET. Peaks remain at the scope measured.' };
  return { ...body, evidenceId: `resource-delta-${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)}` };
}

/** Project measured diagnostics into the gate's schema, preserving scope and sample provenance. */
export function diagnosticMaps(value: unknown) {
  if (!isRecord(value) || !text(value.evidenceId) || !isRecord(value.method) || !isRecord(value.method.host) ||
    !isList(value.loops) || !text(value.model)) refuse('invalid runtime diagnostic');
  const host = value.method.host, loops = value.loops;
  if (!text(host.node) || !text(host.cpu) || !text(host.platform) || !positive(host.cores) || !positive(host.totalMemoryBytes))
    refuse('diagnostic must bind an observed host/runtime');
  const rowsOf = (row: unknown) => {
    if (!isRecord(row) || !isList(row.rows)) return refuse('diagnostic needs measured case rows');
    return row.rows.map(item => {
      if (!isRecord(item) || !isRecord(item.options) || !positive(item.wallMs) || !text(item.resultSha256))
        return refuse('invalid case measurement');
      return { options: item.options, wallMs: item.wallMs, resultSha256: item.resultSha256 };
    });
  };
  const groups = {
    baseline: loops.filter(row => isRecord(row) && row.kind === 'plain' && Number(row.round) < 3),
    noop: loops.filter(row => isRecord(row) && row.kind === 'plain' && Number(row.round) >= 3),
    regression: loops.filter(row => isRecord(row) && row.kind === 'regression'),
  };
  const referenceRows = rowsOf(groups.baseline[0]);
  const context = { hardware: JSON.stringify([host.platform, host.cpu, host.cores, host.totalMemoryBytes]),
    runtime: String(host.node), instrument: 'runtime-cost-v1/whole-night-wall-and-process-high-water',
    workload: JSON.stringify({ model: value.model, cases: referenceRows.map(row => row.options) }) };
  const project = (name: keyof typeof groups) => {
    const group = groups[name];
    if (group.length !== 3) refuse(`require exactly three ${name} repeats`);
    const cases = group.map(rowsOf);
    for (const rows of cases) {
      if (rows.length !== referenceRows.length || rows.some((row, i) =>
        JSON.stringify(row.options) !== JSON.stringify(referenceRows[i].options) || row.resultSha256 !== referenceRows[i].resultSha256))
        refuse('cannot compare different workload/semantic results');
    }
    const metrics: ResourceMap['metrics'] = [
      ...referenceRows.map((row, i) => ({ id: `nightloop/night${String(row.options.night)}/seedIndex${String(row.options.seedIndex)}`,
        unit: 'ms' as const, scope: 'path' as const, samples: cases.map(items => present(items[i], 'case').wallMs) })),
      { id: 'nightloop/process-maxRSS', unit: 'MiB', scope: 'process', samples: group.map(row => {
        if (!isRecord(row) || !positive(row.maxRssMiB)) return refuse('missing process high-water');
        return row.maxRssMiB;
      }) },
    ];
    return validateMap({ schema: 'resource-map-v1', claimLevel: 'MODEL_ONLY', evidenceId: `${value.evidenceId}/${name}`,
      context, coverage: ['six full runNight scenarios (two nights, three seeds)', 'process RSS; includes warmup; no per-function peaks'], metrics });
  };
  return { baseline: project('baseline'), noop: project('noop'), regression: project('regression') };
}

function pilot(path: string, out: string) {
  const input: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const maps = diagnosticMaps(input);
  for (const [name, map] of Object.entries(maps)) writeFileSync(resolve(out, `${name}-map.json`), `${JSON.stringify(map, null, 2)}\n`);
  const noop = compareResources(maps.baseline, maps.noop), regression = compareResources(maps.baseline, maps.regression);
  const expectations = validateExpectations({ schema: 'resource-expectations-v1', baselineId: maps.baseline.evidenceId,
    changes: maps.baseline.metrics.map(metric => ({ metric: metric.id, maxRatio: metric.unit === 'ms' ? 3 : 2.5,
      reason: metric.unit === 'ms' ? 'Diagnostic control deliberately executes the same night twice; it must preserve its returned trace.'
        : 'Diagnostic control deliberately allocates and touches a retained 64 MiB buffer; it must remain at process scope.' })) });
  const expected = compareResources(maps.baseline, maps.regression, expectations);
  for (const [name, record] of Object.entries({ noop, regression, expected, expectations }))
    writeFileSync(resolve(out, `${name}.json`), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`resource pilot: no-op ${noop.status}; planted increase ${regression.status}; bounded explanation ${expected.status}`);
  // A finite reason is not a free pass: a planted observation outside its declared budget must still refuse.
  const bounded = expected.rows.every(row => ['WITHIN_TOLERANCE', 'EXPECTED_INCREASE', 'BUDGET_EXCEEDED'].includes(row.status));
  return noop.status === 'PASS' && regression.status === 'REVIEW_REQUIRED' && bounded ? 0 : 1;
}

function main(argv: readonly string[]) {
  if (argv.length === 4 && argv[0] === '--diagnostic' && argv[2] === '--out')
    return pilot(present(argv[1], 'diagnostic file'), present(argv[3], 'output directory'));
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!['--baseline', '--candidate', '--expectations', '--out'].includes(key) || !value || flags[key])
      refuse('usage: --baseline MAP --candidate MAP --out REPORT [--expectations FILE]');
    flags[key] = value;
  }
  const load = (key: string): unknown => JSON.parse(readFileSync(present(flags[key], key), 'utf8'));
  const baseline = validateMap(load('--baseline')), candidate = validateMap(load('--candidate'));
  const expectations = flags['--expectations'] ? validateExpectations(load('--expectations')) : undefined;
  const report = compareResources(baseline, candidate, expectations);
  writeFileSync(present(flags['--out'], '--out'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`resource-delta: ${report.status} ${report.evidenceId}`);
  for (const row of report.rows) console.log(`  ${row.id}: ${row.status}`);
  return report.status === 'PASS' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
