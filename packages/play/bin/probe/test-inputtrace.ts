#!/usr/bin/env node
// Phone-free regression tests for inputtrace.ts's correlation contract.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PACKAGE, DISPATCH_RE, PUBLISHED_RE, type Row, analyze, buildQuery, distributionMs, parseQueryCsv, parseSurfaceflingerLatency, runQuery } from './inputtrace.ts';
import { test } from 'node:test';
test("input dispatch, delivery and frame correlations", async () => {


function rows(): Row[] {
  const common = { dur_ns: 10n, thread_name: 'main', process_name: 'com.scottgames.fnaf2', track_name: 'com.scottgames.fnaf2/com.scottgames.fnaf2.Main' };
  return [
    { ...common, kind: 'delivery', dur_ns: 200_000n, ts_ns: 1_000_000n, name: 'deliverInputEvent src=0x1002 eventTimeNano=900 id=0xabc' },
    { ...common, kind: 'dispatch', ts_ns: 1_050_000n, name: 'dispatchInputEvent MotionEvent ACTION_DOWN deviceId=7 source=0x1002 historySize=0' },
    { ...common, kind: 'finish', ts_ns: 1_090_000n, name: 'finishDispatchCycleLocked(inputChannel=game, id=0xabc)' },
    { ...common, kind: 'frame', ts_ns: 1_100_000n, name: 'Choreographer#doFrame 42' },
    { ...common, kind: 'dispatch', ts_ns: 2_000_000n, name: 'dispatchInputEvent MotionEvent ACTION_UP deviceId=-1 source=0x1002 historySize=0' },
    { ...common, kind: 'frame', ts_ns: 2_050_000n, name: 'Choreographer#doFrame 43' },
  ];
}

// Correlation.
const report = analyze(rows());
const { summary, events, timing } = report;
assert.equal(summary.dispatch_events, 2, 'both dispatch slices should be reported');
assert.equal(summary.delivery_matches, 1, 'only the enclosing delivery should match');
assert.equal(summary.finish_matches, 1, 'finish should correlate by event id');
assert.equal(summary.frame_matches, 2, 'next frames should be assigned within the window');
assert.deepEqual(Object.fromEntries(summary.origins), { device: 1, injected: 1 }, 'deviceId=-1 must remain visibly injected');
assert.ok(events[0].event_time_ns === 900n && events[0].event_id === '0xabc', 'delivery event time and id must survive correlation');
assert.ok(events[0].frame_id === 42n && events[0].frame_delta_ms === 0.05, 'dispatch must land on the next frame with measured delta');
assert.equal(events[1].event_id, null, 'unmatched dispatch must not invent an id');
assert.equal(timing.press_count, 1, 'releases must not become independent presses');
for (const stage of ['inject', 'dispatch', 'effective'] as const) assert.equal(timing[stage].status, 'UNKNOWN', `${stage} must not be invented from unrelated clocks`);
assert.equal(timing.dispatch_to_next_app_frame_proxy.distribution?.max_ms, 0.05,
  'same-trace frame proxy remains measurable, without claiming gameplay acceptance');
const tails = distributionMs(Array.from({ length: 100 }, (_, k) => BigInt(k + 1)));
assert.ok(tails && tails.p99_ms === 99n && tails.max_ms === 100n && tails.median_ms === 50.5,
  'latency tails must not be replaced by average or Gaussian extrapolation');

// CSV and query.
const parsed = parseQueryCsv('progress text\n'
  + '"kind","ts_ns","dur_ns","name","thread_name","process_name","track_name"\n'
  + '"dispatch","1","2","dispatchInputEvent MotionEvent ACTION_DOWN deviceId=1 source=0x1002 historySize=0","main","","28af0db com.scottgames.fnaf2/com.scottgames.fnaf2.Main"\n');
assert.ok(parsed[0].ts_ns === 1n && parsed[0].dur_ns === 2n && parsed[0].track_name.endsWith('Main'),
  'CSV parser should retain a package-bearing track when process_name is empty');
const query = buildQuery("com.example.o'reilly");
assert.ok(query.split("com.example.o''reilly").length - 1 >= 3 && query.includes('INSTR(track_name')
  && query.includes('deliverInputEvent src=* eventTimeNano=* id=*') && query.includes('game_publish'),
  'package must be SQL-escaped across process, track, and game-channel matches');
assert.ok(buildQuery('a$&b').includes("process_name = 'a$&b'"), 'the package is placed as written, as str.format placed it');
assert.equal(DISPATCH_RE.exec('dispatchInputEvent MotionEvent ACTION_POINTER_DOWN(1) deviceId=335 source=0x1002 historySize=0')?.groups?.action,
  'POINTER_DOWN(1)', 'pointer MotionEvents must remain parseable');
assert.equal(PUBLISHED_RE.exec('publishMotionEvent(inputChannel=game, action=POINTER_UP(1))')?.groups?.action, 'POINTER_UP(1)',
  'parenthesized game-channel actions must remain parseable');

// SurfaceFlinger.
const sf = parseSurfaceflingerLatency('16666666\n0\n16666666\n17000000\n17000000\n33333332\n34000000\n');
assert.ok(sf.refresh_period_ns === 16666666n && sf.frame_count === 2, 'SurfaceFlinger refresh and present rows should be read');
assert.equal(sf.interval_ms.get('median'), 16.667, 'SurfaceFlinger interval summary should use present timestamps');

// The subprocess boundary, without a trace processor dependency.
const directory = mkdtempSync(join(tmpdir(), 'm7-inputtrace-'));
try {
  const processor = join(directory, 'trace_processor');
  writeFileSync(processor, "#!/bin/sh\nprintf '%s\\n' 'kind,ts_ns,dur_ns,name,thread_name,process_name,track_name' "
    + "'dispatch,1,2,dispatchInputEvent MotionEvent ACTION_DOWN deviceId=1 source=0x1002 historySize=0,main,,com.scottgames.fnaf2/Main'\n");
  chmodSync(processor, 0o700);
  const trace = join(directory, 'trace.pftrace');
  writeFileSync(trace, 'fixture');
  const result = runQuery(processor, trace, DEFAULT_PACKAGE);
  assert.ok(result.length === 1 && result[0].kind === 'dispatch', 'query runner should pass through fixture CSV');
  const alias = join(directory, 'reader.ts');
  symlinkSync(fileURLToPath(new URL('./inputtrace.ts', import.meta.url)), alias);
  const cli = spawnSync(process.execPath, [alias, join(directory, 'missing.pftrace')], { encoding: 'utf8', timeout: 5000 });
  assert.equal(cli.status, 2, 'the CLI runs through a symlink and refuses a missing trace');
  assert.match(cli.stderr, /trace does not exist/);
  writeFileSync(processor, "#!/bin/sh\nprintf '\\377'\n");
  assert.throws(() => runQuery(processor, trace, DEFAULT_PACKAGE), /utf-8.*invalid start byte/);
  writeFileSync(processor, "#!/bin/sh\nkill -TERM $$\n");
  assert.throws(() => runQuery(processor, trace, DEFAULT_PACKAGE), /trace processor failed.*-15/);

} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log('inputtrace: dispatch/delivery/frame correlation and SurfaceFlinger parsing pass');

});
