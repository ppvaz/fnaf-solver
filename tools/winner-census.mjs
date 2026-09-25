#!/usr/bin/env node
// Every committed FNaF 2 winner, scored over every night the model can deal.
//
// A winner-v1 binding's gate replays it over its own seeds -- eight of them
// for most bindings, 1..3000 for a few -- and `test-winners-rebuild.mjs`
// only checks that it still compiles. Nothing had asked how the schedule the
// phone actually runs does over the whole population. The population is
// small and closed: `Rng` keeps `seed & 0xffff` (rng.js), so 65,536 seeds are
// every night the model can deal, and a count over them is the model's
// population rate, not a sample of it.
//
//   node tools/winner-census.mjs --jobs 8 --out docs/evidence/fnaf2-winner-census-YYYYMMDD.json
//   node tools/winner-census.mjs --winner tools/device/campaign-night7-k3-winner.json --count 3000
//
// The lane is the binding's own emitter replay -- `STRATEGY_REGISTRY[s].emit`,
// at the binding's anchorEpochMs + phaseOffsetMs -- which is exactly what
// `gate.replayHash` certifies. Each binding is recompiled with `compileBundle`
// first, so a binding whose gate no longer replays is refused, not censused.
//
// The held-out block is the complement of every seed the repository's tuning
// cohorts can reach (designBlock below). Knobs were chosen on those; a
// schedule that only survives them is fitted to them, and the split says so.
//
// A census is a MODEL result. It says what the simulator does with the
// schedule; it prices no actuator lateness, seam loss or frame phase the phone
// re-rolls, and it cannot be promoted as a device claim.
import { execFileSync, fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RNG_MODULUS } from '@fnaf2-1020/core/mechanics';
import { GOLDEN_MODEL_SEED_SALT, randomSeedCohort } from '@fnaf2-1020/research/seeds';
import { STRATEGY_REGISTRY, WINNER_SCHEMA, compileBundle, validateWinner } from './device/bundle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const WINNER_DIR = join(ROOT, 'tools/device');
const EVIDENCE_DIR = join(ROOT, 'docs/evidence');
export const RECORD_SCHEMA = 'evidence-record-v1';
export const CENSUS_KIND = 'fnaf2-winner-census-v1';
// A loss list longer than this is kept as a count and a hash; the record is
// meant to be read, and a binding that loses thousands of nights is described
// by its causes, not by its seeds.
export const MAX_LISTED_LOSSES = 1000;
// `tools/policy.mjs`'s sweep stride, which every policy-family census used.
const SWEEP_STRIDE = 2246822519;
const TUNING_COUNT = 3000;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** The committed winner-v1 files, repository-relative and sorted. */
export function committedWinners() {
  return readdirSync(WINNER_DIR).filter((name) => name.endsWith('-winner.json')).sort()
    .map((name) => join('tools/device', name))
    .filter((path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8')).schema === WINNER_SCHEMA);
}

/**
 * Every 16-bit seed the repository's tuning cohorts reach: 0..3000 (the
 * winners' own gate seeds are 1..8 or 1..3000), the golden cohort, and the
 * policy sweep's first 3000 strides. The golden cohort draws uint32 seeds, so
 * it reaches fewer distinct nights than it has members.
 */
export function designBlock() {
  const golden = randomSeedCohort({ count: TUNING_COUNT, salt: GOLDEN_MODEL_SEED_SALT })
    .map((seed) => seed % RNG_MODULUS);
  const stride = Array.from({ length: TUNING_COUNT }, (_, i) => ((i * SWEEP_STRIDE) >>> 0) % RNG_MODULUS);
  const counting = Array.from({ length: TUNING_COUNT + 1 }, (_, i) => i);
  const seeds = [...new Set([...counting, ...golden, ...stride])].sort((a, b) => a - b);
  return {
    seeds,
    components: {
      counting: { definition: `0..${TUNING_COUNT}`, distinct: counting.length },
      golden: { definition: `randomSeedCohort({count: ${TUNING_COUNT}, salt: 0x${GOLDEN_MODEL_SEED_SALT.toString(16)}}) mod 2^16`,
        members: TUNING_COUNT, distinct: new Set(golden).size },
      sweepStride: { definition: `(i * ${SWEEP_STRIDE}) >>> 0 mod 2^16, i < ${TUNING_COUNT}`, distinct: new Set(stride).size },
    },
  };
}

/**
 * The phone cohorts `npm run evidence -- cohort` computed from run packs,
 * keyed by the winner hash they name, so a binding's population rate sits
 * beside what the phone did with the same binding.
 */
export function phoneCohorts() {
  return readdirSync(EVIDENCE_DIR).filter((name) => /-cohort-.*-computed-\d{8}\.json$/.test(name)).sort()
    .map((name) => ({ record: `docs/evidence/${name}`, ...JSON.parse(readFileSync(join(EVIDENCE_DIR, name), 'utf8')) }))
    .filter((cohort) => cohort.schema === 'cohort-result-v2')
    .map(({ record, binding, night, wins, counted, size, status }) => ({ record, binding, night, wins, counted, size, status }));
}

/** One replay per (binding, night): the emitter the bundle gate uses. */
function loadBindings(paths) {
  const out = [];
  for (const path of paths) {
    const text = readFileSync(join(ROOT, path), 'utf8');
    const winner = validateWinner(JSON.parse(text));
    for (const night of winner.nights) {
      const emitted = STRATEGY_REGISTRY[winner.strategy].emit(winner, night);
      out.push({ path, night, winner, text, emitted });
    }
  }
  return out;
}

/** Losses over [start, end) for every binding: [seed, reason, frame]. */
function censusBlock(paths, start, end) {
  const bindings = loadBindings(paths);
  return bindings.map(({ path, night, emitted }) => {
    const losses = [];
    for (let seed = start; seed < end; seed += 1) {
      const { sim } = emitted.replay(seed);
      if (!sim.won) losses.push([seed, sim.death?.reason ?? 'alive', sim.frame]);
    }
    return { path, night, planSha256: sha256(emitted.text), n: end - start, losses };
  });
}

function runChild(script, args, start, end) {
  return new Promise((resolveChild, reject) => {
    const child = fork(script, ['--child', String(start), String(end), ...args],
      { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], serialization: 'advanced' });
    let result = null;
    child.on('message', (message) => { result = message; });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 && result ? resolveChild(result)
      : reject(new Error(`${script}: block ${start}..${end} exited ${code}`))));
  });
}

/**
 * Split [start, start + count) into `jobs` contiguous blocks, each run as
 * `node <script> --child a b ...args`, which sends back one row per subject
 * ({n, losses, ...}) in a fixed order. Rows are merged in that order; the
 * other fields are taken from the first block.
 */
export async function forkBlocks({ script, args, start, count, jobs }) {
  const size = Math.ceil(count / jobs);
  const blocks = [];
  for (let a = start; a < start + count; a += size) blocks.push([a, Math.min(a + size, start + count)]);
  const parts = await Promise.all(blocks.map(([a, b]) => runChild(script, args, a, b)));
  return parts[0].map((row, i) => ({
    ...row,
    n: parts.reduce((sum, part) => sum + part[i].n, 0),
    losses: parts.flatMap((part) => part[i].losses).sort((x, y) => x[0] - y[0]),
  }));
}

export function gitState() {
  const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();
  return { commit: git('rev-parse', 'HEAD'),
    dirtyEnginePaths: git('status', '--porcelain', '--', 'packages/core', 'tools/device').split('\n').filter(Boolean) };
}

/** The evidence record: per binding, per block, per night. */
export function buildRecord({ rows, start, count, design, git, date, command, winnerHashes, cohorts }) {
  const inDesign = new Set(design.seeds);
  const population = count === RNG_MODULUS && start === 0;
  const designIn = design.seeds.filter((seed) => seed >= start && seed < start + count).length;
  const bindings = rows.map(({ path, night, planSha256, n, losses }) => {
    const winner = JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
    const designLosses = losses.filter(([seed]) => inDesign.has(seed)).length;
    const deaths = {};
    for (const [, reason] of losses) deaths[reason] = (deaths[reason] ?? 0) + 1;
    return {
      binding: path, night, strategy: winner.strategy,
      anchorEpochMs: winner.anchorEpochMs ?? null, phaseOffsetMs: winner.phaseOffsetMs ?? null,
      winnerSha256: sha256(readFileSync(join(ROOT, path))), winnerHash: winnerHashes[path], planSha256,
      gateSeeds: winner.seeds.length, gateReplayHash: winner.gate?.replayHash ?? null,
      wins: n - losses.length, n,
      design: { wins: designIn - designLosses, n: designIn },
      heldOut: { wins: (n - designIn) - (losses.length - designLosses), n: n - designIn },
      deaths,
      losses: losses.length <= MAX_LISTED_LOSSES ? losses : null,
      lossesSha256: sha256(JSON.stringify(losses)),
      phone: cohorts.filter((c) => c.binding === winnerHashes[path] && c.night === night)
        .map(({ record, wins, counted, size, status }) => ({ record, wins, counted, size, status })),
    };
  });
  const nights = {};
  for (const row of bindings) {
    const best = nights[row.night];
    if (!best || row.wins > best.wins) nights[row.night] = { binding: row.binding, wins: row.wins, n: row.n };
  }
  for (const entry of Object.values(nights)) {
    entry.lowerBound = entry.wins / entry.n;
    entry.pMaxExactLane = population && entry.wins === entry.n ? 1 : null;
  }
  // When every night has a binding that wins the whole population, the exact
  // lane has no ceiling left to find, and a phone cohort short of it is short
  // for a reason this lane cannot see.
  const saturated = population && Object.values(nights).every((e) => e.wins === e.n);
  const short = bindings.flatMap((row) => row.phone.filter((c) => c.wins < c.counted)
    .map((c) => `${row.binding.replace(/^tools\/device\/|-winner\.json$/g, '')} ${row.wins}/${row.n} here, ` +
      `${c.wins}/${c.counted} on the phone (${c.record})`));
  const consequence = !saturated ? null
    : 'Every story night has a committed binding that wins every night the model can deal in the exact lane, so ' +
      'P_max = 1 there, and a policy search in this lane has nothing left to find. ' +
      (short.length ? `The phone falls short with bindings this lane scores perfect: ${short.join('; ')}. ` +
        'That gap is not the seed: it is how the schedule is delivered (the frame phase the phone re-rolls, press ' +
        'lateness and loss) and the model\'s encounter fidelity (S2), none of which this lane prices.' : '');
  const answer = Object.entries(nights).map(([night, e]) => `Night ${night}: ${e.wins}/${e.n}` +
    (!population ? ' (a block, not the population)'
      : e.pMaxExactLane === 1 ? ' (P_max = 1 in the exact lane)' : ` (P_max >= ${e.lowerBound.toFixed(6)})`) +
    ` by ${e.binding.replace(/^tools\/device\/|-winner\.json$/g, '')}`).join('; ');
  return {
    schema: RECORD_SCHEMA, kind: CENSUS_KIND,
    id: `fnaf2-winner-census-${date.replace(/-/g, '')}`,
    claimLevel: 'MODEL_ONLY', date,
    question: 'What does every committed FNaF 2 winner-v1 binding score over every night the model can deal, ' +
      'replayed exactly as its bundle gate replays it, and what lower bound does that put on P_max for each story night?',
    answer, consequence,
    whyItIsModelOnly: 'No device run. Every figure is the simulator replaying the binding\'s emitted schedule on ' +
      'its scheduled frames; actuator lateness, the mask seam and the frame phase the phone re-rolls are not in this lane.',
    method: {
      tool: 'tools/winner-census.mjs', command, git,
      population: { start, count, exhaustive: population,
        why: 'Rng keeps seed & 0xffff (packages/core/src/mechanics/rng.js), so seeds 0..65535 are every night the model can deal' },
      lane: 'exact: STRATEGY_REGISTRY[strategy].emit(winner, night).replay(seed), at anchorEpochMs + phaseOffsetMs -- the replay gate.replayHash certifies; each binding recompiled with compileBundle first',
      family: 'the committed winner-v1 bindings for each night; the per-night figure is a lower bound scoped to them, not to all policies',
      designBlock: { ...design.components, distinct: design.seeds.length, inCensus: designIn,
        sha256: sha256(JSON.stringify(design.seeds)) },
      heldOutBlock: { definition: 'every censused seed not in the design block', n: count - designIn },
    },
    bindings, nights,
  };
}

function parseArgs(argv) {
  const args = { winners: [], jobs: 1, start: 0, count: RNG_MODULUS, out: null, date: new Date().toISOString().slice(0, 10) };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--winner') args.winners.push(argv[++i]);
    else if (flag === '--jobs') args.jobs = Number(argv[++i]);
    else if (flag === '--start') args.start = Number(argv[++i]);
    else if (flag === '--count') args.count = Number(argv[++i]);
    else if (flag === '--out') args.out = argv[++i];
    else if (flag === '--date') args.date = argv[++i];
    else throw new Error(`winner-census: unknown flag ${flag}`);
  }
  if (!Number.isInteger(args.jobs) || args.jobs < 1) throw new Error('winner-census: --jobs must be a positive integer');
  if (!Number.isInteger(args.start) || !Number.isInteger(args.count) || args.start < 0 || args.count < 1 ||
      args.start + args.count > RNG_MODULUS)
    throw new Error(`winner-census: --start/--count must lie inside 0..${RNG_MODULUS - 1}`);
  return args;
}

async function main(argv) {
  if (argv[0] === '--child') {
    const [, a, b, ...paths] = argv;
    process.send(censusBlock(paths, Number(a), Number(b)));
    return;
  }
  const args = parseArgs(argv);
  const paths = args.winners.length ? args.winners.map((path) => relative(ROOT, resolve(process.cwd(), path)))
    : committedWinners();
  const scratch = mkdtempSync(join(tmpdir(), 'winner-census-'));
  const winnerHashes = {};
  try {
    for (const path of paths) {
      const built = compileBundle(JSON.parse(readFileSync(join(ROOT, path), 'utf8')), join(scratch, path.replace(/\//g, '_')));
      winnerHashes[path] = built.manifest.winnerHash;
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  const started = Date.now();
  const rows = await forkBlocks({ script: fileURLToPath(import.meta.url), args: paths,
    start: args.start, count: args.count, jobs: args.jobs });
  const command = `node tools/winner-census.mjs${args.winners.map((w) => ` --winner ${w}`).join('')}` +
    ` --start ${args.start} --count ${args.count} --jobs ${args.jobs}`;
  const record = buildRecord({ rows, start: args.start, count: args.count, design: designBlock(),
    git: gitState(), date: args.date, command, winnerHashes, cohorts: phoneCohorts() });
  record.method.wallSeconds = Math.round((Date.now() - started) / 1000);
  const text = `${JSON.stringify(record, null, 2)}\n`;
  if (args.out) writeFileSync(args.out, text); else process.stdout.write(text);
  for (const row of record.bindings) {
    const tag = row.binding.replace(/^tools\/device\/|-winner\.json$/g, '');
    console.error(`  ${tag.padEnd(36)} n${row.night} ${String(row.wins).padStart(6)}/${row.n}` +
      `  held-out ${row.heldOut.wins}/${row.heldOut.n}` +
      (row.wins === row.n ? '' : `  | ${Object.entries(row.deaths).map(([c, k]) => `${c} ${k}`).join(', ')}`));
  }
  console.error(`winner census: ${record.answer}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
