// Versioned bench trace for Plan 20 package 6. CONTRACT:bench-transport-trace-v1
//
// A trace is deliberately stricter than a log line: every timestamp belongs to
// one declared monotonic clock and every latency leg has both endpoints. This
// makes a missing observation visible instead of allowing a partial path to be
// reported as a fast one. The contract is host-only; it does not claim that a
// phone, MCU, USB-HID device, or audio route has been measured.

export const BENCH_TRACE_SCHEMA = 'bench-transport-trace-v1';
export const BENCH_TRACE_SUMMARY_SCHEMA = 'bench-transport-summary-v1';
export const BENCH_TRACE_PATHS = Object.freeze(['visual', 'audio']);
export const BENCH_TRACE_CLOCKS = Object.freeze([
  'device-monotonic-ms', 'host-monotonic-ms',
]);
export const BENCH_TRACE_MAX_SAMPLES = 100000;

const STAGES = Object.freeze([
  'sourceEvent', 'fact', 'executorReceipt', 'actuatorCommand', 'observedResult',
]);
const LATENCY_LEGS = Object.freeze([
  ['sourceToFactMs', 'sourceEvent', 'fact'],
  ['factToExecutorMs', 'fact', 'executorReceipt'],
  ['executorToActuatorMs', 'executorReceipt', 'actuatorCommand'],
  ['actuatorToResultMs', 'actuatorCommand', 'observedResult'],
  ['endToEndMs', 'sourceEvent', 'observedResult'],
]);
const CLAIM_LEVELS = new Set(['MODEL_ONLY', 'FIXTURE', 'DEVICE_MEASURED']);
const clone = value => structuredClone(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);

function fail(message) { throw new TypeError(`bench trace: ${message}`); }

function string(name, value, max = 128) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    fail(`${name} must be a non-empty string of at most ${max} characters`);
  return value;
}

function time(name, value) {
  if (!finite(value) || value < 0) fail(`${name} must be finite and non-negative`);
  return value;
}

function object(name, value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail(`${name} must be an object`);
  return value;
}

function validateSourceEvent(stage, path) {
  object('sourceEvent', stage);
  time('sourceEvent.atMs', stage.atMs);
  const expected = path === 'visual' ? 'screen' : 'audio';
  if (stage.kind !== expected)
    fail(`sourceEvent.kind must be ${expected} for ${path} traces`);
  string('sourceEvent.signal', stage.signal);
}

function validateFact(stage) {
  object('fact', stage);
  time('fact.atMs', stage.atMs);
  string('fact.type', stage.type);
  if (stage.state !== 'OBSERVED' && stage.state !== 'UNKNOWN')
    fail('fact.state must be OBSERVED or UNKNOWN');
  if (stage.state === 'UNKNOWN') {
    if (Object.hasOwn(stage, 'value')) fail('UNKNOWN fact cannot carry value');
    string('fact.reason', stage.reason, 128);
  }
}

function validateReceipt(stage) {
  object('executorReceipt', stage);
  time('executorReceipt.atMs', stage.atMs);
  string('executorReceipt.id', stage.id);
  string('executorReceipt.commandId', stage.commandId, 64);
}

function validateCommand(stage) {
  object('actuatorCommand', stage);
  time('actuatorCommand.atMs', stage.atMs);
  string('actuatorCommand.id', stage.id);
  string('actuatorCommand.receiptId', stage.receiptId, 64);
  string('actuatorCommand.action', stage.action);
}

function validateResult(stage) {
  object('observedResult', stage);
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
}

function validateSample(sample, index, traceClock, seen) {
  object(`sample ${index}`, sample);
  string(`sample ${index}.id`, sample.id);
  if (seen.has(sample.id)) fail(`duplicate sample id ${sample.id}`);
  seen.add(sample.id);
  if (!BENCH_TRACE_PATHS.includes(sample.path))
    fail(`sample ${index}.path must be visual or audio`);
  for (const stage of STAGES) if (!Object.hasOwn(sample, stage))
    fail(`sample ${index} is missing ${stage}`);
  validateSourceEvent(sample.sourceEvent, sample.path);
  validateFact(sample.fact);
  validateReceipt(sample.executorReceipt);
  validateCommand(sample.actuatorCommand);
  validateResult(sample.observedResult);
  if (sample.executorReceipt.commandId !== sample.actuatorCommand.id)
    fail(`sample ${index} receipt does not identify its actuator command`);
  if (sample.actuatorCommand.receiptId !== sample.executorReceipt.id)
    fail(`sample ${index} actuator command does not identify its receipt`);
  if (sample.observedResult.commandId !== sample.actuatorCommand.id)
    fail(`sample ${index} result does not identify its actuator command`);
  let previous = -Infinity;
  for (const stage of STAGES) {
    const atMs = sample[stage].atMs;
    if (atMs < previous) fail(`sample ${index} stages are not time ordered`);
    previous = atMs;
  }
  if (sample.clock !== undefined && sample.clock !== traceClock)
    fail(`sample ${index} clock does not match trace clock`);
}

function validateContinuation(value) {
  object('continuation', value);
  time('continuation.upstreamDropAtMs', value.upstreamDropAtMs);
  object('continuation.approval', value.approval);
  string('continuation.approval.cycleId', value.approval.cycleId, 96);
  time('continuation.approval.validFromMs', value.approval.validFromMs);
  time('continuation.approval.validUntilMs', value.approval.validUntilMs);
  if (value.approval.validUntilMs < value.approval.validFromMs)
    fail('continuation approval validity is reversed');
  if (value.upstreamDropAtMs > value.approval.validUntilMs)
    fail('upstream drop is after the approved cycle expired');
  if (!Array.isArray(value.approval.actionIds) ||
      value.approval.actionIds.length === 0 || value.approval.actionIds.length > 16)
    fail('continuation approval needs 1-16 action ids');
  const approved = new Set(value.approval.actionIds.map((id, index) =>
    string(`continuation action id ${index}`, id, 64)));
  if (approved.size !== value.approval.actionIds.length)
    fail('continuation approval action ids must be unique');
  if (!Array.isArray(value.emitted)) fail('continuation.emitted must be an array');
  const emitted = new Set();
  let previous = -Infinity;
  let emittedAfterDrop = false;
  for (const [index, item] of value.emitted.entries()) {
    object(`continuation emitted ${index}`, item);
    string(`continuation emitted ${index}.id`, item.id, 64);
    time(`continuation emitted ${index}.atMs`, item.atMs);
    if (!approved.has(item.id)) fail(`continuation emitted unknown action ${item.id}`);
    if (emitted.has(item.id)) fail(`continuation emitted action twice: ${item.id}`);
    if (item.atMs < previous) fail('continuation emitted actions are not ordered');
    if (item.atMs < value.approval.validFromMs || item.atMs > value.approval.validUntilMs)
      fail(`continuation emitted action ${item.id} is outside approval`);
    emitted.add(item.id);
    previous = item.atMs;
    if (item.atMs >= value.upstreamDropAtMs) emittedAfterDrop = true;
  }
  if (value.completed !== true) fail('continuation must be marked completed');
  if (emitted.size !== approved.size)
    fail('completed continuation did not emit every approved action');
  if (!emittedAfterDrop)
    fail('continuation has no approved action emitted after upstream drop');
  if (!Array.isArray(value.replacementActions) || value.replacementActions.length !== 0)
    fail('upstream loss must not create replacement actions');
  return value;
}

/** Validate a complete raw bench trace without changing it. */
export function validateBenchTrace(input) {
  object('trace', input);
  if (input.schema !== BENCH_TRACE_SCHEMA)
    fail(`schema must be ${BENCH_TRACE_SCHEMA}`);
  string('trace id', input.id, 160);
  string('profile', input.profile, 160);
  if (!BENCH_TRACE_CLOCKS.includes(input.clock))
    fail('clock must be a declared monotonic millisecond clock');
  if (!CLAIM_LEVELS.has(input.claimLevel)) fail('claimLevel is invalid');
  if (!Array.isArray(input.samples) || input.samples.length === 0 ||
      input.samples.length > BENCH_TRACE_MAX_SAMPLES)
    fail(`samples must contain 1-${BENCH_TRACE_MAX_SAMPLES} entries`);
  const seen = new Set();
  input.samples.forEach((sample, index) => validateSample(sample, index, input.clock, seen));
  validateContinuation(input.continuation);
  return input;
}

function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank quantiles are deterministic and do not interpolate a
  // latency that was never observed. This is the retained report convention.
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1];
}

function latencyStats(values) {
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

function emptyPathSummary(path) {
  return {
    path, sampleCount: 0, observedResultCount: 0, unknownResultCount: 0,
    legs: Object.fromEntries(LATENCY_LEGS.map(([name]) => [name, latencyStats([])])),
  };
}

function pathSummary(path, samples) {
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
export function summarizeBenchTrace(input) {
  validateBenchTrace(input);
  const all = input.samples;
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
      upstreamDropAtMs: input.continuation.upstreamDropAtMs,
      approvedCycleId: input.continuation.approval.cycleId,
      approvedActionCount: input.continuation.approval.actionIds.length,
      emittedActionCount: input.continuation.emitted.length,
      completed: input.continuation.completed,
      replacementActionCount: input.continuation.replacementActions.length,
    },
  };
}

/** Build a trace and validate it at the creation boundary. */
export function makeBenchTrace(input) {
  const trace = {
    schema: BENCH_TRACE_SCHEMA,
    ...clone(input),
  };
  return validateBenchTrace(trace);
}
