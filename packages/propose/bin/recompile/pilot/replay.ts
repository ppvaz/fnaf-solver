#!/usr/bin/env node
/**
 * Replay a pilot night with no pilot: the rows the pilot's harness applied
 * (`pilot.input`, plain CHOWDREN_INPUT) into a fresh run of a rebuilt binary.
 *
 *   node packages/propose/bin/recompile/pilot/replay.ts --game fnaf3|fnaf4 --from PILOT_RUN_DIR --run DIR
 *        --binary FILE --assets FILE [--seed N] [--max-ticks N] [--docker]
 *   node packages/propose/bin/recompile/pilot/replay.ts --record tools/recompile/results/<name>.json --run DIR
 *        --binary FILE --assets FILE [--docker]
 *   node packages/propose/bin/recompile/pilot/replay.ts --game G --input ROWS --save FILE --run DIR
 *        --binary FILE --assets FILE [--seed N] [--max-ticks N] [--docker]
 *
 * With --from, the save is the pilot run's `save-before.ini` and the rows its
 * `pilot.input`, and the replay's trace is compared with the pilot run's. With
 * --record, a committed recompile-pilot-night-v1 record supplies the game,
 * seed, update count and input fixture, the save is the fixture in
 * packages/source/recompile/fixtures/ whose sha256 the record names, and the trace is
 * compared with the record's replay digest: that re-checks a committed win on
 * another binary. With --input and --save, the rows and the save are given
 * directly and there is no trace to compare (search.ts checks its wins so). Either way the replay writes its own trace and save and
 * reports whether the traces agree update for update (frame, tick, Random
 * draws, graine and every global value) and what the game wrote to its save.
 * It runs natively (pilot.ts NATIVE_ENV) unless --docker. Nothing leaves DIR.
 * Host-only.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, createReadStream, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NATIVE_ENV, loadGame } from './pilot.ts';
import { currentPath } from '@sixam/review/renamed-path';
import { captureRoot } from '../../../../play/bin/phone/local-profile.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const IMAGE = 'fnaf2-chowdren:buster';
// The container mounts this host's capture root at the same path, so a run directory names one place on both sides.
const MOUNT = captureRoot();

/** What a replay plays into a fresh run: the rows and the save before them, on which binary and assets, at which seed. */
/** The committed save fixtures a --record replay starts from. */
export const FIXTURES = join(ROOT, 'packages/source/recompile/fixtures');

/**
 * What a --record replay starts from: the record's input fixture where it stands now (a record keeps the path it
 * was written with) and the fixture save whose sha256 it names; refused when either is missing.
 */
export function recordInputs(rec: { readonly input: { readonly fixture: string }, readonly saveBefore: { readonly sha256: string } }) {
  const input = join(ROOT, currentPath(ROOT, rec.input.fixture) ?? rec.input.fixture);
  const save = readdirSync(FIXTURES).filter((f) => f.endsWith('.ini')).find((f) => sha256(join(FIXTURES, f)) === rec.saveBefore.sha256);
  if (!save) throw new Error(`replay: no fixture in ${FIXTURES} has the record's save sha256 ${rec.saveBefore.sha256}`);
  return { input, saveBefore: join(FIXTURES, save) };
}

export interface ReplayRun {
  run: string, binary: string, assets: string, seed: number, maxTicks: number, docker: boolean, input: string, saveBefore: string;
}

/** A replay, and where its rows, save and expected trace come from. */
interface ReplayOptions extends ReplayRun {
  game: string, from?: string, record?: string, expect?: { rows: number, sha256: string };
}

function parseArgs(argv: string[]) {
  const o: Partial<ReplayOptions> & Pick<ReplayOptions, 'seed' | 'maxTicks' | 'docker'> = { seed: 24850, maxTicks: 30000, docker: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--game') o.game = v();
    else if (a === '--from') o.from = resolve(v());
    else if (a === '--record') o.record = resolve(v());
    else if (a === '--input') o.input = resolve(v());
    else if (a === '--save') o.saveBefore = resolve(v());
    else if (a === '--docker') o.docker = true;
    else if (a === '--run') o.run = resolve(v());
    else if (a === '--binary') o.binary = resolve(v());
    else if (a === '--assets') o.assets = resolve(v());
    else if (a === '--seed') o.seed = Number(v());
    else if (a === '--max-ticks') o.maxTicks = Number(v());
    else throw new Error(`replay: unknown argument ${a}`);
  }
  const modes = [o.from, o.record, o.input].filter(Boolean).length;
  if (modes !== 1) throw new Error('replay: exactly one of --from, --record and --input');
  if (o.input && !o.saveBefore) throw new Error('replay: --input needs --save');
  if (o.record) {
    const rec = JSON.parse(readFileSync(o.record, 'utf8'));
    const { input, saveBefore } = recordInputs(rec);
    Object.assign(o, { game: rec.game, seed: rec.seed, maxTicks: rec.replay.rows, input,
      saveBefore, expect: rec.replay });
  } else if (o.from) {
    Object.assign(o, { input: join(o.from, 'pilot.input'), saveBefore: join(o.from, 'save-before.ini') });
  }
  for (const k of ['game', 'run', 'binary', 'assets'] as const) if (!o[k]) throw new Error(`replay: --${k} is required`);
  // Each required option was checked just above, and every mode set the rows and the save.
  const checked = o as ReplayOptions;
  if (checked.run.startsWith(ROOT)) throw new Error('replay: --run must be outside the repository');
  if (checked.docker && !checked.run.startsWith(MOUNT + '/')) throw new Error(`replay: --run must sit under ${MOUNT} (the container mount)`);
  return checked;
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Hash of the trace's update rows and the frame visits it records. */
export async function traceDigest(path: string) {
  const h = createHash('sha256');
  const visits: { frame: number, updates: number }[] = [];
  let rows = 0;
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    const seeded = /^# frame (-?\d+) seeded (\d+)/.exec(line);
    if (seeded) { visits.push({ frame: Number(seeded[1]), updates: 0 }); continue; }
    if (!line || line.startsWith('#')) continue;
    rows += 1;
    if (visits.length) visits[visits.length - 1].updates += 1;
    h.update(line + '\n');
  }
  return { rows, sha256: h.digest('hex'), visits };
}

export function runReplay(o: ReplayRun, game: { readonly SAVE_NAME: string }) {
  mkdirSync(o.run, { recursive: true });
  for (const f of ['trace', 'run.log', game.SAVE_NAME, 'Assets.dat', 'run.input', 'save-before.ini'])
    rmSync(join(o.run, f), { force: true });
  copyFileSync(o.saveBefore, join(o.run, 'save-before.ini'));
  copyFileSync(o.saveBefore, join(o.run, game.SAVE_NAME));
  copyFileSync(o.input, join(o.run, 'run.input'));
  symlinkSync(o.assets, join(o.run, 'Assets.dat'));
  const env = {
    CHOWDREN_HARNESS: '1', CHOWDREN_NO_DRAW: '1', CHOWDREN_SEED: String(o.seed),
    CHOWDREN_MAX_TOTAL_TICKS: String(o.maxTicks), CHOWDREN_TIMEOUT_SECONDS: '1200',
    CHOWDREN_TRACE: 'trace', CHOWDREN_INPUT: 'run.input',
  };
  writeFileSync(join(o.run, 'env'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  if (!o.docker) {
    const r = spawnSync(o.binary, [], { cwd: o.run, encoding: 'utf8', maxBuffer: 1 << 28,
      env: { ...process.env, ...env, ...NATIVE_ENV } });
    writeFileSync(join(o.run, 'run.log'), (r.stdout ?? '') + (r.stderr ?? '') + `exit ${r.status ?? r.signal}\n`);
    return r.status ?? r.signal;
  }
  const args = ['run', '--rm', '-v', `${MOUNT}:${MOUNT}`, '-v', `${ROOT}/packages/source/recompile/run-harness.sh:/run-harness.sh:ro`,
    '-w', o.run, '-e', `CHOWDREN_BINARY=${o.binary}`];
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  args.push(IMAGE, 'bash', '/run-harness.sh');
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  writeFileSync(join(o.run, 'run.log'), (r.stdout ?? '') + (r.stderr ?? '') + `exit ${r.status}\n`);
  return r.status;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const game = await loadGame(o.game);
  const exit = runReplay(o, game);
  const replay = await traceDigest(join(o.run, 'trace'));
  const pilot = o.expect ? { rows: o.expect.rows, sha256: o.expect.sha256 }
    : o.from ? await traceDigest(join(o.from, 'trace')) : null;
  const out = {
    exit, runtime: o.docker ? 'docker' : 'native', ...(o.record ? { record: relative(ROOT, o.record) } : {}),
    binarySha256: sha256(o.binary), assetsSha256: sha256(o.assets),
    inputSha256: sha256(join(o.run, 'run.input')), saveBeforeSha256: sha256(join(o.run, 'save-before.ini')),
    pilotTrace: pilot, replayTrace: { rows: replay.rows, sha256: replay.sha256, visits: replay.visits },
    traceEqual: pilot ? pilot.sha256 === replay.sha256 : null,
    saveAfter: readFileSync(join(o.run, game.SAVE_NAME), 'utf8'),
  };
  writeFileSync(join(o.run, 'replay-summary.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify({ exit, traceEqual: out.traceEqual, rows: [pilot?.rows ?? null, replay.rows],
    visits: replay.visits.map((v) => `${v.frame}:${v.updates}`).join(' ') }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.stack ?? String(e)); process.exit(1); });
}
