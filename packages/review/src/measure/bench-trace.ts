// Versioned bench trace for Plan 20 package 6. CONTRACT:bench-transport-trace-v1
//
// A trace is deliberately stricter than a log line: every timestamp belongs to
// one declared monotonic clock and every latency leg has both endpoints. This
// makes a missing observation visible instead of allowing a partial path to be
// reported as a fast one. The contract is host-only; it does not claim that a
// phone, MCU, USB-HID device, or audio route has been measured.

import { isList, isOneOf } from '@sixam/kernel';
import { isFiniteNumber as finite } from '@sixam/kernel/contracts';
import type { BenchTraceSample, BenchTransportTrace } from '@sixam/kernel/contracts';

export const BENCH_TRACE_SCHEMA = 'bench-transport-trace-v1';
export const BENCH_TRACE_SUMMARY_SCHEMA = 'bench-transport-summary-v1';
const BENCH_TRACE_PATHS = Object.freeze(['visual', 'audio'] as const);
const BENCH_TRACE_CLOCKS = Object.freeze([
  'device-monotonic-ms', 'host-monotonic-ms',
] as const);
const BENCH_TRACE_MAX_SAMPLES = 100000;

const STAGES = Object.freeze([
  'sourceEvent', 'fact', 'executorReceipt', 'actuatorCommand', 'observedResult',
] as const);
type StageName = (typeof STAGES)[number];
const LATENCY_LEGS: readonly (readonly [string, StageName, StageName])[] = Object.freeze([
  ['sourceToFactMs', 'sourceEvent', 'fact'],
  ['factToExecutorMs', 'fact', 'executorReceipt'],
  ['executorToActuatorMs', 'executorReceipt', 'actuatorCommand'],
  ['actuatorToResultMs', 'actuatorCommand', 'observedResult'],
  ['endToEndMs', 'sourceEvent', 'observedResult'],
] as const);
const CLAIM_LEVELS = new Set(['MODEL_ONLY', 'FIXTURE', 'DEVICE_MEASURED']);
type Fields = Readonly<Record<string, unknown>>;
/** A validated continuation: the approved cycle that ran on after the upstream drop. */
type Continuation = { readonly upstreamDropAtMs: number, readonly completed: boolean,
  readonly approval: { readonly cycleId: string, readonly actionIds: readonly string[] },
  readonly emitted: readonly unknown[], readonly replacementActions: readonly unknown[] };
const clone = <T>(value: T): T => structuredClone(value);

function fail(message: string): never { throw new TypeError(`bench trace: ${message}`); }

function string(name: string, value: unknown, max = 128) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    fail(`${name} must be a non-empty string of at most ${max} characters`);
  return value;
}

function time(name: string, value: unknown) {
  if (!finite(value) || value < 0) fail(`${name} must be finite and non-negative`);
  return value;
}

function object(name: string, value: unknown): Fields {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail(`${name} must be an object`);
  return value as Fields;
}

function validateSourceEvent(input: unknown, path: unknown) {
  const stage = object('sourceEvent', input);
  time('sourceEvent.atMs', stage.atMs);
  const expected = path === 'visual' ? 'screen' : 'audio';
  if (stage.kind !== expected)
    fail(`sourceEvent.kind must be ${expected} for ${path} traces`);
  string('sourceEvent.signal', stage.signal);
  return stage;
}

function validateFact(input: unknown) {
  const stage = object('fact', input);
  time('fact.atMs', stage.atMs);
  string('fact.type', stage.type);
  if (stage.state !== 'OBSERVED' && stage.state !== 'UNKNOWN')
    fail('fact.state must be OBSERVED or UNKNOWN');
  if (stage.state === 'UNKNOWN') {
    if (Object.hasOwn(stage, 'value')) fail('UNKNOWN fact cannot carry value');
    string('fact.reason', stage.reason, 128);
  }
  return stage;
}

function validateReceipt(input: unknown) {
  const stage = object('executorReceipt', input);
  time('executorReceipt.atMs', stage.atMs);
  string('executorReceipt.id', stage.id);
  string('executorReceipt.commandId', stage.commandId, 64);
  return stage;
}

function validateCommand(input: unknown) {
  const stage = object('actuatorCommand', input);
  time('actuatorCommand.atMs', stage.atMs);
  string('actuatorCommand.id', stage.id);
  string('actuatorCommand.receiptId', stage.receiptId, 64);
  string('actuatorCommand.action', stage.action);
  return stage;
}

function validateResult(input: unknown) {
  const stage = object('observedResult', input);
  time('observedResult.atMs', stage.atMs);
  string('observedResult.commandId', stage.commandId, 64);
  if (stage.state !== 'OBSERVED' && stage.state !== 'UNKNOWN')
    fail('observedResult.state must be OBSERVED or UNKNOWN');
  if (stage.state === 'UNKNOWN') {
    if (Object.hasOwn(stage, 'value')) fail('UNKNOWN result cannot carry value');
    string('observedResult.reason', stage.reason, 128);
  } else if (!Object.hasOwn(stage, 'value')) {
    fail('OBSERVED result needs value');
  }
  return stage;
}

function validateSample(input: unknown, index: number, traceClock: unknown, seen: Set<unknown>) {
  const sample = object(`sample ${index}`, input);
  string(`sample ${index}.id`, sample.id);
  if (seen.has(sample.id)) fail(`duplicate sample id ${sample.id}`);
  seen.add(sample.id);
  if (!isOneOf(BENCH_TRACE_PATHS, sample.path))
    fail(`sample ${index}.path must be visual or audio`);
  for (const stage of STAGES) if (!Object.hasOwn(sample, stage))
    fail(`sample ${index} is missing ${stage}`);
  const stages: Readonly<Record<StageName, Fields>> = {
    sourceEvent: validateSourceEvent(sample.sourceEvent, sample.path),
    fact: validateFact(sample.fact),
    executorReceipt: validateReceipt(sample.executorReceipt),
    actuatorCommand: validateCommand(sample.actuatorCommand),
    observedResult: validateResult(sample.observedResult),
  };
  if (stages.executorReceipt.commandId !== stages.actuatorCommand.id)
    fail(`sample ${index} receipt does not identify its actuator command`);
  if (stages.actuatorCommand.receiptId !== stages.executorReceipt.id)
    fail(`sample ${index} actuator command does not identify its receipt`);
  if (stages.observedResult.commandId !== stages.actuatorCommand.id)
    fail(`sample ${index} result does not identify its actuator command`);
  let previous = -Infinity;
  for (const stage of STAGES) {
    // Each stage's atMs was checked finite above.
    const atMs = stages[stage].atMs as number;
    if (atMs < previous) fail(`sample ${index} stages are not time ordered`);
    previous = atMs;
  }
  if (sample.clock !== undefined && sample.clock !== traceClock)
    fail(`sample ${index} clock does not match trace clock`);
}

function validateContinuation(input: unknown): Continuation {
  const value = object('continuation', input);
  const upstreamDropAtMs = time('continuation.upstreamDropAtMs', value.upstreamDropAtMs);
  const approval = object('continuation.approval', value.approval);
  string('continuation.approval.cycleId', approval.cycleId, 96);
  const validFromMs = time('continuation.approval.validFromMs', approval.validFromMs);
  const validUntilMs = time('continuation.approval.validUntilMs', approval.validUntilMs);
  if (validUntilMs < validFromMs)
    fail('continuation approval validity is reversed');
  if (upstreamDropAtMs > validUntilMs)
    fail('upstream drop is after the approved cycle expired');
  const actionIds = approval.actionIds;
  if (!isList(actionIds) ||
      actionIds.length === 0 || actionIds.length > 16)
    fail('continuation approval needs 1-16 action ids');
  const approved = new Set(actionIds.map((id, index) =>
    string(`continuation action id ${index}`, id, 64)));
  if (approved.size !== actionIds.length)
    fail('continuation approval action ids must be unique');
  if (!isList(value.emitted)) fail('continuation.emitted must be an array');
  const emitted = new Set<string>();
  let previous = -Infinity;
  let emittedAfterDrop = false;
  for (const [index, entry] of value.emitted.entries()) {
    const item = object(`continuation emitted ${index}`, entry);
    const id = string(`continuation emitted ${index}.id`, item.id, 64);
    const atMs = time(`continuation emitted ${index}.atMs`, item.atMs);
    if (!approved.has(id)) fail(`continuation emitted unknown action ${id}`);
    if (emitted.has(id)) fail(`continuation emitted action twice: ${id}`);
    if (atMs < previous) fail('continuation emitted actions are not ordered');
    if (atMs < validFromMs || atMs > validUntilMs)
      fail(`continuation emitted action ${id} is outside approval`);
    emitted.add(id);
    previous = atMs;
    if (atMs >= upstreamDropAtMs) emittedAfterDrop = true;
  }
  if (value.completed !== true) fail('continuation must be marked completed');
  if (emitted.size !== approved.size)
    fail('completed continuation did not emit every approved action');
  if (!emittedAfterDrop)
    fail('continuation has no approved action emitted after upstream drop');
  if (!isList(value.replacementActions) || value.replacementActions.length !== 0)
    fail('upstream loss must not create replacement actions');
  return value as unknown as Continuation;
}

/** Validate a complete raw bench trace without changing it. */
export function validateBenchTrace(value: unknown): BenchTransportTrace {
  const input = object('trace', value);
  if (input.schema !== BENCH_TRACE_SCHEMA)
    fail(`schema must be ${BENCH_TRACE_SCHEMA}`);
  string('trace id', input.id, 160);
  string('profile', input.profile, 160);
  if (!isOneOf(BENCH_TRACE_CLOCKS, input.clock))
    fail('clock must be a declared monotonic millisecond clock');
  if (typeof input.claimLevel !== 'string' || !CLAIM_LEVELS.has(input.claimLevel)) fail('claimLevel is invalid');
  const samples = input.samples;
  if (!isList(samples) || samples.length === 0 ||
      samples.length > BENCH_TRACE_MAX_SAMPLES)
    fail(`samples must contain 1-${BENCH_TRACE_MAX_SAMPLES} entries`);
  const seen = new Set<unknown>();
  samples.forEach((sample, index) => validateSample(sample, index, input.clock, seen));
  validateContinuation(input.continuation);
  return input as unknown as BenchTransportTrace;
}

function quantile(values: readonly number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank quantiles are deterministic and do not interpolate a
  // latency that was never observed. This is the retained report convention.
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1];
}

function latencyStats(values: readonly number[]) {
  const min = values.length ? values.reduce((value, current) => Math.min(value, current)) : null;
  const max = values.length ? values.reduce((value, current) => Math.max(value, current)) : null;
  return {
    count: values.length,
    minMs: min,
    maxMs: max,
    p50Ms: quantile(values, 0.5),
    p95Ms: quantile(values, 0.95),
    p99Ms: quantile(values, 0.99),
    p99_9Ms: quantile(values, 0.999),
  };
}

function emptyPathSummary(path: string) {
  return {
    path, sampleCount: 0, observedResultCount: 0, unknownResultCount: 0,
    legs: Object.fromEntries(LATENCY_LEGS.map(([name]) => [name, latencyStats([])])),
  };
}

function pathSummary(path: string, samples: readonly BenchTraceSample[]) {
  const summary = emptyPathSummary(path);
  summary.sampleCount = samples.length;
  summary.observedResultCount = samples.filter(sample =>
    sample.observedResult.state === 'OBSERVED').length;
  summary.unknownResultCount = samples.length - summary.observedResultCount;
  for (const [name, from, to] of LATENCY_LEGS) {
    summary.legs[name] = latencyStats(samples.map(sample =>
      sample[to].atMs - sample[from].atMs));
  }
  return summary;
}

/** Produce reproducible latency statistics from a validated raw trace. */
export function summarizeBenchTrace(value: unknown) {
  const input = validateBenchTrace(value);
  const all = input.samples;
  // validateBenchTrace checked the continuation field by field.
  const continuation = input.continuation as unknown as Continuation;
  return {
    schema: BENCH_TRACE_SUMMARY_SCHEMA,
    traceId: input.id,
    profile: input.profile,
    clock: input.clock,
    claimLevel: input.claimLevel,
    sampleCount: all.length,
    paths: Object.fromEntries(BENCH_TRACE_PATHS.map(path => [path,
      pathSummary(path, all.filter(sample => sample.path === path))])),
    all: pathSummary('all', all),
    continuation: {
      upstreamDropAtMs: continuation.upstreamDropAtMs,
      approvedCycleId: continuation.approval.cycleId,
      approvedActionCount: continuation.approval.actionIds.length,
      emittedActionCount: continuation.emitted.length,
      completed: continuation.completed,
      replacementActionCount: continuation.replacementActions.length,
    },
  };
}

/** Build a trace and validate it at the creation boundary. */
export function makeBenchTrace(input: Readonly<Record<string, unknown>>) {
  const trace = {
    schema: BENCH_TRACE_SCHEMA,
    ...clone(input),
  };
  return validateBenchTrace(trace);
}
