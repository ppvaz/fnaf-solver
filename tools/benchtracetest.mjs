// Plan 20 package 6: raw transport-path and safe-continuation contract.
// This is a deterministic fixture check, not physical timing evidence.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BENCH_TRACE_SCHEMA, BENCH_TRACE_SUMMARY_SCHEMA,
  makeBenchTrace, summarizeBenchTrace, validateBenchTrace,
} from '@sixam/review/measure';

const sample = (id, path, offset, resultState = 'OBSERVED') => ({
  id, path,
  sourceEvent: { atMs: offset, kind: path === 'visual' ? 'screen' : 'audio', signal: 'blackout' },
  fact: { atMs: offset + 10, type: 'blackout', state: 'OBSERVED' },
  executorReceipt: { atMs: offset + 20, id: `${id}-receipt`, commandId: `${id}-command` },
  actuatorCommand: { atMs: offset + 30, id: `${id}-command`, receiptId: `${id}-receipt`, action: 'mask' },
  observedResult: resultState === 'OBSERVED'
    ? { atMs: offset + 70, state: 'OBSERVED', commandId: `${id}-command`, value: 'mask-on' }
    : { atMs: offset + 80, state: 'UNKNOWN', commandId: `${id}-command`, reason: 'frame-dropped' },
});

const trace = makeBenchTrace({
  id: 'fixture-bench-trace-001', profile: 'fixture-hid-screencap',
  clock: 'host-monotonic-ms', claimLevel: 'FIXTURE',
  samples: [
    sample('v1', 'visual', 0), sample('v2', 'visual', 100),
    sample('v3', 'visual', 200, 'UNKNOWN'), sample('a1', 'audio', 300),
  ],
  continuation: {
    upstreamDropAtMs: 150,
    approval: { cycleId: 'approved-safe', validFromMs: 0, validUntilMs: 500,
      actionIds: ['lower', 'mask'] },
    emitted: [{ id: 'lower', atMs: 100 }, { id: 'mask', atMs: 200 }],
    completed: true, replacementActions: [],
  },
});

assert.equal(trace.schema, BENCH_TRACE_SCHEMA);
assert.equal(validateBenchTrace(trace), trace);
const summary = summarizeBenchTrace(trace);
assert.equal(summary.schema, BENCH_TRACE_SUMMARY_SCHEMA);
assert.equal(summary.sampleCount, 4);
assert.equal(summary.paths.visual.sampleCount, 3);
assert.equal(summary.paths.visual.observedResultCount, 2);
assert.equal(summary.paths.visual.unknownResultCount, 1);
assert.deepEqual(summary.paths.visual.legs.sourceToFactMs, {
  count: 3, minMs: 10, maxMs: 10, p50Ms: 10, p95Ms: 10, p99Ms: 10, p99_9Ms: 10,
});
assert.deepEqual(summary.paths.visual.legs.actuatorToResultMs, {
  count: 3, minMs: 40, maxMs: 50, p50Ms: 40, p95Ms: 50, p99Ms: 50, p99_9Ms: 50,
});
assert.equal(summary.paths.audio.legs.endToEndMs.p50Ms, 70);
assert.equal(summary.all.legs.endToEndMs.p95Ms, 80);
assert.deepEqual(summary.continuation, {
  upstreamDropAtMs: 150, approvedCycleId: 'approved-safe',
  approvedActionCount: 2, emittedActionCount: 2, completed: true,
  replacementActionCount: 0,
});

const expectThrow = (mutate, message) => {
  const changed = structuredClone(trace);
  mutate(changed);
  assert.throws(() => validateBenchTrace(changed), undefined, message);
};

expectThrow(value => { value.samples[1].clock = 'device-monotonic-ms'; },
  'mixed trace clocks were accepted');
expectThrow(value => { value.samples[1].fact.atMs = value.samples[1].sourceEvent.atMs - 1; },
  'negative fact latency was accepted');
expectThrow(value => { value.samples[1].observedResult.commandId = 'unrelated'; },
  'unrelated result identity was accepted');
expectThrow(value => { value.samples[1].id = value.samples[0].id; },
  'duplicate sample ids were accepted');
expectThrow(value => { value.samples[0].observedResult = {
  atMs: 70, state: 'UNKNOWN', value: false, reason: 'bad',
}; }, 'UNKNOWN result with a value was accepted');
expectThrow(value => { value.continuation.replacementActions = [{ id: 'new-action' }]; },
  'link loss created a replacement action');
expectThrow(value => { value.continuation.emitted = [{ id: 'lower', atMs: 100 }]; },
  'incomplete safe-cycle continuation was accepted');

const work = mkdtempSync(join(tmpdir(), 'fnaf2-bench-trace-'));
try {
  const inputPath = join(work, 'trace.json');
  const outputPath = join(work, 'summary.json');
  writeFileSync(inputPath, JSON.stringify(trace) + '\n');
  const report = spawnSync(process.execPath, [
    fileURLToPath(new URL('./bench-trace.mjs', import.meta.url)),
    '--input', inputPath, '--out', outputPath,
  ], { encoding: 'utf8' });
  assert.equal(report.status, 0, `bench trace report failed: ${report.stderr}`);
  assert.equal(JSON.parse(readFileSync(outputPath, 'utf8')).traceId, trace.id);
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log('bench trace: visual/audio latency legs, quantiles, UNKNOWN results, and safe continuation pass');
