#!/usr/bin/env node
// Diagnostic hypotheses about host cost, not a population census or device qualification.
// node --expose-gc packages/propose/bin/census/runtime-cost.ts --out docs/evidence/runtime-cost-20261005
// Each child is isolated and bounded; instrumentation must preserve the complete nightloop result.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import type { Profiler, HeapProfiler } from 'node:inspector';
import { cpus, loadavg, platform, totalmem } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import { isList, isRecord, present } from '@sixam/kernel';
import { Sim, FNAF2_MODEL } from '@sixam/source/fnaf2';
import { CycleController } from '@sixam/propose/fnaf2';
import { runNight } from '../nightloop-run.ts';
import { STRATEGY_REGISTRY, validateWinner } from '../plans/bundle.ts';
import { canonical, recordId, sha256 } from '../recompile/sweep-common.ts';
import { SimPool } from './pool.ts';

const FILE = fileURLToPath(import.meta.url);
const ROOT = resolve(FILE, '../../../../..');
const WINNER = 'packages/propose/bindings/fnaf2/campaign-night7-k3-winner.json';
const LOOP_CASES = [1, 7].flatMap(night => [0, 1, 2].map(seedIndex => ({ night, seedIndex, trace: true })));
const REPLAY_COUNT = 512;
const winner = validateWinner(JSON.parse(readFileSync(join(ROOT, WINNER), 'utf8')));
const emitted = STRATEGY_REGISTRY[winner.strategy].emit(winner, 7);
const digest = (value: unknown) => sha256(canonical(value));
const MiB = 1024 * 1024;

/** Pool worker entry: retain an outcome and a digest of the full final snapshot, including events. */
export function replayJob({ seed }: { seed: number }) {
  const { sim } = emitted.replay(seed);
  if (!(sim instanceof Sim)) throw new Error('diagnostic requires the FNaF 2 Sim with snapshot custody');
  return { seed, frame: sim.frame, won: sim.won, snapshotSha256: digest(sim.snapshot()) };
}

function summary(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => present(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))], 'nonempty measurements');
  return { n: sorted.length, min: at(0), median: at(.5), p95: at(.95), p99: at(.99), max: at(1),
    sum: values.reduce((a, b) => a + b, 0) };
}

function cpuSummary(profile: Profiler.Profile) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parents = new Map(profile.nodes.flatMap(node => (node.children ?? []).map(child => [child, node.id] as const)));
  const own = new Map<number, number>(), inclusive = new Map<number, number>();
  for (const [i, id] of (profile.samples ?? []).entries()) {
    const us = profile.timeDeltas?.[i] ?? 0;
    own.set(id, (own.get(id) ?? 0) + us);
    let ancestor: number | undefined = id;
    while (ancestor !== undefined) {
      inclusive.set(ancestor, (inclusive.get(ancestor) ?? 0) + us);
      ancestor = parents.get(ancestor);
    }
  }
  const totalUs = [...own.values()].reduce((a, b) => a + b, 0);
  const rows = [...own].map(([id, us]) => {
    const node = present(nodes.get(id), 'sampled node');
    return { function: node.callFrame.functionName, file: node.callFrame.url.replace(`file://${ROOT}/`, ''),
      line: node.callFrame.lineNumber + 1, ownMs: us / 1000, ownShare: us / totalUs,
      inclusiveMs: (inclusive.get(id) ?? 0) / 1000 };
  }).sort((a, b) => b.ownMs - a.ownMs);
  const copyShare = rows.filter(row => /clone|copy|shareLog|serialize|deserialize/i.test(row.function))
    .reduce((sum, row) => sum + row.ownShare, 0);
  return { samples: profile.samples?.length ?? 0, totalSampledMs: totalUs / 1000, copyShare,
    gcShare: rows.filter(row => /garbage collector/i.test(row.function)).reduce((sum, row) => sum + row.ownShare, 0),
    topOwn: rows.slice(0, 25), topFiveOwnShare: rows.slice(0, 5).reduce((sum, row) => sum + row.ownShare, 0) };
}

function heapSummary(profile: HeapProfiler.SamplingHeapProfile) {
  const rows: { function: string, file: string, sampledLiveBytes: number }[] = [];
  const visit = (node: HeapProfiler.SamplingHeapProfileNode) => {
    if (node.selfSize) rows.push({ function: node.callFrame.functionName,
      file: node.callFrame.url.replace(`file://${ROOT}/`, ''), sampledLiveBytes: node.selfSize });
    node.children.forEach(visit);
  };
  visit(profile.head);
  rows.sort((a, b) => b.sampledLiveBytes - a.sampledLiveBytes);
  return { sampledLiveBytes: rows.reduce((sum, row) => sum + row.sampledLiveBytes, 0), top: rows.slice(0, 20),
    transientAllocationBytes: 'UNKNOWN', peakBytesPerFunction: 'UNKNOWN' };
}

function instrument(discardDiagnostics: boolean) {
  const observe = CycleController.prototype.observe, plan = CycleController.prototype.plan;
  const commit = CycleController.prototype.commit, tick = Sim.prototype.tick;
  const samples = new Map<string, number[]>();
  const memory: { frame: number, traceEntries: number, decisions: number, heapUsedMiB: number, rssMiB: number }[] = [];
  let boundaryStart = 0, observeCount = 0;
  const timed = <T>(name: string, call: () => T): T => {
    const start = performance.now();
    const value = call();
    const values = samples.get(name) ?? [];
    values.push(performance.now() - start); samples.set(name, values);
    return value;
  };
  CycleController.prototype.observe = function (...args: Parameters<typeof observe>) {
    boundaryStart = performance.now();
    const value = timed('observe', () => observe.apply(this, args));
    if (observeCount++ % 150 === 0) {
      const mem = process.memoryUsage();
      memory.push({ frame: this.reduced.frame, traceEntries: this.estimator.trace.length,
        decisions: this.decisions.length, heapUsedMiB: mem.heapUsed / MiB, rssMiB: mem.rss / MiB });
    }
    if (discardDiagnostics) { this.estimator.trace.length = 0; this.decisions.length = 0; }
    return value;
  };
  CycleController.prototype.plan = function (...args: Parameters<typeof plan>) {
    return timed('plan', () => plan.apply(this, args));
  };
  CycleController.prototype.commit = function (...args: Parameters<typeof commit>) {
    const value = timed('commit', () => commit.apply(this, args));
    const values = samples.get('observe-through-commit') ?? [];
    values.push(performance.now() - boundaryStart); samples.set('observe-through-commit', values);
    return value;
  };
  Sim.prototype.tick = function (...args: Parameters<typeof tick>) {
    return timed('sim.tick', () => tick.apply(this, args));
  };
  return { samples, memory, restore: () => {
    CycleController.prototype.observe = observe; CycleController.prototype.plan = plan;
    CycleController.prototype.commit = commit; Sim.prototype.tick = tick;
  } };
}

async function loopChild(kind: string, out: string) {
  // Same warm-up in every variant; not included in timed or profiled windows.
  runNight({ night: 1, seedIndex: 100 });
  global.gc?.();
  const instrumentation = ['timing', 'discard-diagnostics'].includes(kind) ? instrument(kind === 'discard-diagnostics') : null;
  const session = new Session();
  if (kind === 'cpu' || kind === 'heap') {
    session.connect();
    if (kind === 'cpu') {
      await session.post('Profiler.enable'); await session.post('Profiler.setSamplingInterval', { interval: 1000 });
      await session.post('Profiler.start');
    } else await session.post('HeapProfiler.startSampling', { samplingInterval: 32768 });
  }
  const before = process.memoryUsage(), start = performance.now();
  const plantedBuffer = kind === 'regression' ? Buffer.alloc(64 * MiB, 0xa5) : null;
  const rows = LOOP_CASES.map(options => {
    const at = performance.now(), result = runNight(options);
    if (kind === 'regression') runNight(options); // Known redundant work, never changes the reported result.
    return { options, wallMs: performance.now() - at, resultSha256: digest(result),
      frame: result.frame, decisionsTraced: result.trace.length };
  });
  const wallMs = performance.now() - start, after = process.memoryUsage();
  instrumentation?.restore();
  let cpu: ReturnType<typeof cpuSummary> | null = null, heap: ReturnType<typeof heapSummary> | null = null;
  let profile: { file: string, sha256: string } | null = null;
  if (kind === 'cpu' || kind === 'heap') {
    const payload = kind === 'cpu' ? await session.post('Profiler.stop') : await session.post('HeapProfiler.stopSampling');
    const profileFile = join(out, `${kind}.json`), bytes = JSON.stringify(payload);
    writeFileSync(profileFile, bytes); profile = { file: relative(ROOT, profileFile), sha256: sha256(bytes) };
    if ('nodes' in payload.profile) cpu = cpuSummary(payload.profile);
    else heap = heapSummary(payload.profile);
    session.disconnect();
  }
  const memory = instrumentation?.memory ?? [];
  return { kind, wallMs, rows, cpu, heap, profile, before, after,
    plantedResidentBytes: plantedBuffer?.byteLength ?? 0,
    maxRssMiB: process.resourceUsage().maxRSS / 1024,
    sampledHeapMaxMiB: memory.length ? Math.max(...memory.map(row => row.heapUsedMiB)) : null,
    methods: Object.fromEntries([...(instrumentation?.samples ?? [])].map(([name, values]) => [name, summary(values)])), memory };
}

async function poolChild(workers: number) {
  const pool = new SimPool({ workers });
  const jobs = Array.from({ length: REPLAY_COUNT }, (_, i) => ({ seed: 50000 + i }));
  const module = import.meta.url;
  try {
    const coldStart = performance.now();
    if (workers === 1) jobs.slice(0, 16).map(replayJob);
    else await pool.map(module, 'replayJob', jobs.slice(0, 16));
    const startupAndWarmupMs = performance.now() - coldStart;
    const rounds: { wallMs: number, resultSha256: string }[] = [];
    for (let round = 0; round < 3; round++) {
      const start = performance.now(), rows = workers === 1 ? jobs.map(replayJob) : await pool.map(module, 'replayJob', jobs);
      rounds.push({ wallMs: performance.now() - start, resultSha256: digest(rows) });
    }
    return { workers, startupAndWarmupMs, rounds, wallMs: summary(rounds.map(row => row.wallMs)),
      maxRssMiB: process.resourceUsage().maxRSS / 1024 };
  } finally { await pool.close(); }
}

function child(kind: string, out: string, workers = 1) {
  const result = spawnSync(process.execPath, ['--expose-gc', FILE, '--child', kind, out, String(workers)],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * MiB });
  if (result.status !== 0) throw new Error(`bounded child ${kind}/${workers}: ${result.signal ?? result.status}: ${result.stderr}`);
  const value: unknown = JSON.parse(result.stdout);
  if (!isRecord(value)) throw new Error('child must return a record');
  return value;
}

function hashes(row: Readonly<Record<string, unknown>>, key: string) {
  const values = row[key];
  if (!isList(values) || !values.length) throw new Error(`missing ${key}`);
  return values.map(value => {
    if (!isRecord(value) || typeof value.resultSha256 !== 'string') throw new Error('missing result hash');
    return value.resultSha256;
  });
}

function wall(row: Readonly<Record<string, unknown>>) {
  if (typeof row.wallMs !== 'number' || !Number.isFinite(row.wallMs)) throw new Error('missing finite wall time');
  return row.wallMs;
}

function assess(loops: readonly Readonly<Record<string, unknown>>[], pools: readonly Readonly<Record<string, unknown>>[]) {
  const plain = loops.filter(row => row.kind === 'plain' && Number(row.round) < 3), discard = loops.filter(row => row.kind === 'discard-diagnostics');
  const reduction = 1 - summary(discard.map(wall)).median / summary(plain.map(wall)).median;
  const cpu = present(loops.find(row => row.kind === 'cpu'), 'CPU experiment').cpu;
  if (!isRecord(cpu) || typeof cpu.copyShare !== 'number') throw new Error('missing CPU copy share');
  const serial = present(pools.find(row => row.workers === 1), 'serial replay').wallMs;
  if (!isRecord(serial) || typeof serial.median !== 'number') throw new Error('missing serial replay time');
  const serialMs = serial.median;
  const speedups = pools.map(row => {
    if (!isRecord(row.wallMs) || typeof row.wallMs.median !== 'number') throw new Error('missing pool time');
    return { workers: row.workers, speedup: serialMs / row.wallMs.median };
  });
  return { copying: { status: cpu.copyShare >= .3 ? 'SUPPORTED' : 'DISPROVEN', measuredShare: cpu.copyShare, threshold: .3 },
    diagnostics: { status: reduction >= .2 ? 'SUPPORTED' : 'DISPROVEN', measuredTimeReduction: reduction, threshold: .2 },
    scaling: { status: speedups.some(row => row.speedup >= 1.5) ? 'SUPPORTED' : 'DISPROVEN', speedups, threshold: 1.5 },
    semantics: { status: 'MATCHED', loopCases: LOOP_CASES.length, replaySeeds: REPLAY_COUNT },
    deadlines: { status: 'UNKNOWN', reason: 'No device execution or independently measured deadline in this diagnostic.' } };
}

async function main(argv: readonly string[]) {
  if (argv[0] === '--child') {
    const kind = present(argv[1], 'child kind'), out = present(argv[2], 'profile output');
    const result = kind === 'pool' ? await poolChild(Number(argv[3])) : await loopChild(kind, out);
    process.stdout.write(JSON.stringify(result)); return;
  }
  if (argv.length !== 2 || argv[0] !== '--out') throw new Error('usage: node --expose-gc packages/propose/bin/census/runtime-cost.ts --out DIR');
  const out = resolve(present(argv[1], 'output directory')); mkdirSync(out, { recursive: true });
  const raw = join(ROOT, 'artifacts/runtime-cost-20261005'); mkdirSync(raw, { recursive: true });
  const paths = execFileSync('git', ['ls-files', 'packages/source', 'packages/play', 'packages/propose', 'packages/kernel'],
    { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(path => /\.(ts|js|json)$/.test(path));
  paths.push(relative(ROOT, FILE));
  const sources = Object.fromEntries([...new Set(paths)].sort().map(path => [path, sha256(readFileSync(join(ROOT, path)))]));
  const declaration = { schema: 'runtime-cost-diagnostic-v1', purpose: 'diagnostic', step: ['S3', 'S4'],
    claimLevel: 'MODEL_ONLY', explanation: 'Copying and diagnostic histories dominate the current loop; parallel replays trade RAM for throughput.',
    hypotheses: {
      copying: 'Named copy/clone/serialization functions account for at least 30% of sampled own CPU time.',
      diagnostics: 'Discarding estimator trace and controller decision history reduces median whole-night time by at least 20%, preserving all runNight outputs.',
      scaling: 'At least one of 2/4/6 workers improves median replay throughput by at least 50% over serial, with identical final snapshot hashes.',
      deltaGate: 'Three independent no-op repeats should pass a 20% resource tolerance; redundant identical replays and a touched 64 MiB buffer should be detected without changing the semantic hashes.',
      deadlines: 'UNKNOWN without current device execution and independently measured deadlines.',
    },
    loop: { cases: LOOP_CASES, policy: 'night', gate: 'static', warmupSeedIndex: 100, repeats: 3 },
    replay: { winner: WINNER, seeds: { start: 50000, count: REPLAY_COUNT }, workers: [1, 2, 4, 6], rounds: 3,
      qualification: 'Diagnostic block, not a population win-rate census; no policy selection or reliability estimate.' },
    stoppingRule: 'Fixed cells; each child bounded at 120 seconds; stop on trace mismatch, never tune based on timing.', sources };
  const declarationFile = join(out, 'declaration.json');
  writeFileSync(declarationFile, `${JSON.stringify(declaration, null, 2)}\n`);
  const loops: Record<string, unknown>[] = [], pools: Record<string, unknown>[] = [];
  let expectedLoop: string[] | null = null, expectedReplay: string | null = null;
  const appendLoop = (row: Record<string, unknown>) => {
    const current = hashes(row, 'rows');
    if (expectedLoop && canonical(current) !== canonical(expectedLoop)) throw new Error('STOP: loop trace mismatch');
    expectedLoop ??= current; loops.push(row);
  };
  for (let round = 0; round < 6; round++) {
    for (const kind of (round < 3 ? (round % 2 ? ['discard-diagnostics', 'plain'] : ['plain', 'discard-diagnostics']) : ['plain', 'regression'])) {
      console.error(`runtime-cost: loop ${kind}, round ${round + 1}`); appendLoop({ round, ...child(kind, raw) });
    }
  }
  for (const kind of ['timing', 'cpu', 'heap']) {
    console.error(`runtime-cost: loop ${kind}`); appendLoop(child(kind, raw));
  }
  for (const workers of [1, 2, 4, 6]) {
    console.error(`runtime-cost: ${REPLAY_COUNT} replay seeds, ${workers} worker(s)`);
    const row = child('pool', raw, workers);
    for (const hash of hashes(row, 'rounds')) {
      if (expectedReplay && hash !== expectedReplay) throw new Error('STOP: serial/parallel snapshot mismatch');
      expectedReplay ??= hash;
    }
    pools.push(row);
  }
  for (const [path, hash] of Object.entries(sources))
    if (sha256(readFileSync(join(ROOT, path))) !== hash) throw new Error(`source drift: ${path}`);
  const body = { schema: 'runtime-cost-result-v1', claimLevel: 'MODEL_ONLY', date: new Date().toISOString().slice(0, 10),
    step: ['S3', 'S4'], model: FNAF2_MODEL,
    declaration: { file: relative(ROOT, declarationFile), sha256: sha256(readFileSync(declarationFile)) },
    method: { tool: relative(ROOT, FILE), command: `node --expose-gc ${relative(ROOT, FILE)} --out ${relative(ROOT, out)}`,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      host: { platform: platform(), node: process.version, cpu: cpus()[0]?.model, cores: cpus().length, totalMemoryBytes: totalmem(), loadavg: loadavg() },
      timing: 'Wall-clock milliseconds on host; methods inclusive; do not add inclusive method totals.',
      memory: 'maxRSS is process high-water including warmup and worker isolates. Heap samples are observed lower bounds, not allocation deltas or per-function peaks.',
      heap: '32 KiB allocation sampling, live sampled objects only; freed transient objects and allocation peaks UNKNOWN.',
      equivalence: 'All runNight return fields including selected-cycle traces; replay final snapshots include events. Not a same-phase device twin.' },
    loops, pools, hypotheses: assess(loops, pools),
    open: ['device deadlines and acceptance', 'guaranteed WCET', 'per-function allocation peaks', 'native/browser runtime costs', 'full seed/state coverage'] };
  const record = { ...body, evidenceId: recordId('runtime-cost', body) };
  writeFileSync(join(out, 'result.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.error(`runtime-cost: ${record.evidenceId}`);
}

if (isMainThread && process.argv[1] && resolve(process.argv[1]) === FILE)
  await main(process.argv.slice(2));
