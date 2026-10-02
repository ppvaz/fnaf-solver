#!/usr/bin/env node
// Resume the existing FNaF 1 population scorer without losing completed blocks.
// No phone access. Sources must be committed; checkpoints bind that commit,
// the pinned policy, options, range and block size, and retain every raw loss.
//   nice -n 10 node packages/propose/bin/census/fnaf1-population-checkpoints.ts --route winner \
//     --checkpoints artifacts/fnaf1-winner-population --jobs 3 --out FILE
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FOUR_TWENTY, LANE_FILE, PHONE_OPTIONS, POPULATION_LANES, TIMING_PATH, newestTreeRecord,
  populationRecord, winnerPolicyOptions } from './fnaf1-device-lane.ts';
import type { LaneRow, Route, RouteWinner } from './fnaf1-device-lane.ts';
import { isList } from '@sixam/kernel';
import { designBlock, forkBlocks, gitState } from './winner-census.ts';
import { loadWinner, materialize, removeTree } from '../../../play/games/fnaf1/fnaf1-winner.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const read = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const atomicWrite = (file: string, value: unknown) => {
  const pending = `${file}.tmp-${process.pid}`;
  writeFileSync(pending, json(value));
  renameSync(pending, file);
};

/** A block's rows as a checkpoint holds them, before checkRows has read them. */
type UncheckedRow = { readonly lane?: unknown, readonly n?: unknown, readonly losses?: unknown };

function checkRows(rows: unknown, start: number, end: number): asserts rows is LaneRow[] {
  if (!isList(rows) || JSON.stringify((rows as readonly UncheckedRow[]).map((r) => r.lane)) !== JSON.stringify(POPULATION_LANES))
    throw new Error(`block ${start}../../../..${end}: wrong lanes`);
  for (const row of rows as readonly UncheckedRow[]) {
    if (row.n !== end - start || !isList(row.losses)) throw new Error(`block ${start}../../../..${end}: wrong count`);
    const seeds = new Set<unknown>();
    for (const loss of row.losses) {
      // Each comparison follows the integer check that guards it.
      if (!isList(loss) || loss.length !== 3 || !Number.isInteger(loss[0]) || (loss[0] as number) < start || (loss[0] as number) >= end
          || seeds.has(loss[0]) || typeof loss[1] !== 'string' || !Number.isInteger(loss[2]) || (loss[2] as number) < 0)
        throw new Error(`block ${start}../../../..${end}: invalid or duplicate loss`);
      seeds.add(loss[0]);
    }
  }
}

/** Only complete, checksummed blocks of this exact source identity may resume. */
/** How far a checkpointed census has come: blocks completed of the total, and the seeds just retained. */
type Progress = { completed: number, total: number, start: number, end: number };

export async function checkpointedBlocks({ dir, identity, start, count, blockSize = 1024, jobs = 3, runBlock,
  onComplete = () => {} }: {
  dir: string, identity: unknown, start: number, count: number, blockSize?: number, jobs?: number,
  runBlock: (start: number, end: number) => unknown, onComplete?: (progress: Progress) => void,
}) {
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(count) || count < 1 || start + count > 65536
      || !Number.isInteger(blockSize) || blockSize < 1 || blockSize > 4096
      || !Number.isInteger(jobs) || jobs < 1 || jobs > 3)
    throw new Error('invalid checkpoint range, block size (1..4096), or jobs (1..3)');
  mkdirSync(dir, { recursive: true });
  const manifest = { schema: 'fnaf1-population-checkpoints-v1', identity, start, count, blockSize };
  const manifestPath = join(dir, 'manifest.json');
  if (existsSync(manifestPath)) {
    if (JSON.stringify(read(manifestPath)) !== JSON.stringify(manifest))
      throw new Error('checkpoint identity/range changed; use a new checkpoint directory');
  } else atomicWrite(manifestPath, manifest);
  const key = sha256(JSON.stringify(manifest));
  const blocks: { start: number, end: number }[] = [];
  for (let a = start; a < start + count; a += blockSize)
    blocks.push({ start: a, end: Math.min(a + blockSize, start + count) });
  const parts = new Array<LaneRow[]>(blocks.length);
  const missing: { i: number, file: string, start: number, end: number }[] = [];
  let reused = 0;
  for (const [i, block] of blocks.entries()) {
    const file = join(dir, `block-${block.start}-${block.end}.json`);
    if (!existsSync(file)) { missing.push({ i, file, ...block }); continue; }
    const saved = read(file) as { schema?: unknown, key?: unknown, start?: unknown, end?: unknown, rowsSha256?: unknown, rows?: unknown };
    if (saved.schema !== 'fnaf1-population-block-v1' || saved.key !== key || saved.start !== block.start
        || saved.end !== block.end || saved.rowsSha256 !== sha256(JSON.stringify(saved.rows)))
      throw new Error(`checkpoint ${file}: identity or checksum mismatch`);
    checkRows(saved.rows, block.start, block.end);
    parts[i] = saved.rows;
    reused += 1;
  }
  let cursor = 0;
  let failure: unknown = null;
  let completed = reused;
  await Promise.all(Array.from({ length: Math.min(jobs, missing.length) }, async () => {
    while (!failure) {
      const block = missing[cursor++];
      if (!block) return;
      try {
        const rows = await runBlock(block.start, block.end);
        checkRows(rows, block.start, block.end);
        atomicWrite(block.file, { schema: 'fnaf1-population-block-v1', key, start: block.start, end: block.end,
          rowsSha256: sha256(JSON.stringify(rows)), rows });
        parts[block.i] = rows;
        completed += 1;
        onComplete({ completed, total: blocks.length, start: block.start, end: block.end });
      } catch (error) { failure ??= error; }
    }
  }));
  if (failure) throw failure;
  const rows = POPULATION_LANES.map((lane, i) => ({ lane, n: count,
    losses: parts.flatMap((part) => part[i].losses).sort((a, b) => a[0] - b[0]) }));
  return { rows, reused, blocks: blocks.length, manifestSha256: key };
}

async function main(argv: string[]) {
  const allowed = new Set(['route', 'checkpoints', 'jobs', 'start', 'count', 'block-size', 'date', 'out']);
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].slice(2);
    if (!argv[i].startsWith('--') || !allowed.has(key) || argv[i + 1] === undefined) throw new Error(`unknown or incomplete argument ${argv[i]}`);
    args[key] = argv[i + 1];
  }
  if (!args.checkpoints || !args.out) throw new Error('--checkpoints DIR and --out FILE are required');
  const kind = args.route ?? 'winner';
  if (!['tree', 'winner'].includes(kind)) throw new Error('--route is tree or winner');
  const start = Number(args.start ?? 0), count = Number(args.count ?? 65536);
  const jobs = Number(args.jobs ?? 3), blockSize = Number(args['block-size'] ?? 1024);
  const paths = ['packages/core', 'packages/source', 'packages/kernel', 'packages/propose/bindings', LANE_FILE, 'packages/propose/bin/census/winner-census.ts', 'packages/propose/bin/census/fnaf1-population-checkpoints.ts'];
  const git = gitState(paths);
  if (git.dirtyEnginePaths.length) throw new Error('checkpoint census needs committed sources; commit source edits first');
  const started = Date.now();
  let scratch: string | null = null, route: Route | null = null, source = 'tree';
  let options: Readonly<Record<string, unknown>> = { ...PHONE_OPTIONS };
  try {
    if (kind === 'winner') {
      const path = 'packages/propose/bindings/fnaf1/fnaf1-custom-night7-420-grid420-winner.json';
      const winner: RouteWinner = loadWinner(path);
      if (winner.resolvedOptions?.policy !== 'grid420' || JSON.stringify(winner.night?.dials) !== JSON.stringify(FOUR_TWENTY))
        throw new Error('the committed winner is not grid420 at 4/20');
      scratch = mkdtempSync(join(tmpdir(), 'fnaf1-checkpoint-winner-'));
      const built = materialize(winner, join(scratch, 'tree'));
      source = built.dir;
      options = winnerPolicyOptions(winner);
      route = { path, winner, commit: built.commit, tree: built.tree, files: built.files, options };
    }
    const identity = { commit: git.commit, route: kind, policyCommit: route?.commit ?? git.commit, options,
      harnessSha256: sha256(readFileSync(join(ROOT, LANE_FILE))), timingSha256: sha256(readFileSync(TIMING_PATH)) };
    const result = await checkpointedBlocks({ dir: resolve(args.checkpoints), identity, start, count, jobs, blockSize,
      runBlock: (a, b) => forkBlocks<LaneRow>({ script: join(ROOT, LANE_FILE), args: [source, JSON.stringify(options), ...POPULATION_LANES],
        start: a, count: b - a, jobs: 1 }),
      onComplete: ({ completed, total, start: a, end: b }) => console.error(`checkpoint ${completed}/${total}: seeds ${a}../../../..${b - 1} retained`) });
    const after = gitState(paths);
    if (after.commit !== git.commit || after.dirtyEnginePaths.length)
      throw new Error('sources changed during the census; no final evidence emitted');
    const record: ReturnType<typeof populationRecord> & { method: { wallSeconds?: number, checkpoints?: object } } =
      populationRecord({ rows: result.rows, start, count, design: designBlock(), route,
      treeRecord: route ? newestTreeRecord() : null, git, date: args.date ?? new Date().toISOString().slice(0, 10),
      command: `node packages/propose/bin/census/fnaf1-population-checkpoints.ts --route ${kind} --checkpoints artifacts/fnaf1-${kind}-population ` +
        `--start ${start} --count ${count} --block-size ${blockSize} --jobs ${jobs} --out ${args.out}` });
    record.method.tool = 'packages/propose/bin/census/fnaf1-population-checkpoints.ts';
    record.method.wallSeconds = Math.round((Date.now() - started) / 1000);
    record.method.checkpoints = { blockSize, blocks: result.blocks, reusedBlocks: result.reused,
      manifestSha256: result.manifestSha256, wallTimeScope: 'this invocation; previously completed blocks may be reused' };
    writeFileSync(args.out, json(record));
    console.error(`${record.id}: ${record.answer}`);
  } finally {
    if (scratch) { removeTree(join(scratch, 'tree')); rmSync(scratch, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
