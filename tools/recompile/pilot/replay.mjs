#!/usr/bin/env node
/**
 * Replay a pilot night with no pilot: the rows the pilot's harness applied
 * (`pilot.input`, plain CHOWDREN_INPUT) into a fresh run of a rebuilt binary.
 *
 *   node tools/recompile/pilot/replay.mjs --game fnaf3|fnaf4 --from PILOT_RUN_DIR --run DIR
 *        --binary FILE --assets FILE [--seed N] [--max-ticks N] [--docker]
 *   node tools/recompile/pilot/replay.mjs --record tools/recompile/results/<name>.json --run DIR
 *        --binary FILE --assets FILE [--docker]
 *
 * With --from, the save is the pilot run's `save-before.ini` and the rows its
 * `pilot.input`, and the replay's trace is compared with the pilot run's. With
 * --record, a committed recompile-pilot-night-v1 record supplies the game,
 * seed, update count and input fixture, the save is the fixture in
 * tools/recompile/fixtures/ whose sha256 the record names, and the trace is
 * compared with the record's replay digest: that re-checks a committed win on
 * another binary. Either way the replay writes its own trace and save and
 * reports whether the traces agree update for update (frame, tick, Random
 * draws, graine and every global value) and what the game wrote to its save.
 * It runs natively (pilot.mjs NATIVE_ENV) unless --docker. Nothing leaves DIR.
 * Host-only.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, createReadStream, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NATIVE_ENV } from './pilot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const IMAGE = 'fnaf2-chowdren:buster';
const MOUNT = '/home/pedro/fnaf-apks';

function parseArgs(argv) {
  const o = { seed: 24850, maxTicks: 30000, docker: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--game') o.game = v();
    else if (a === '--from') o.from = resolve(v());
    else if (a === '--record') o.record = resolve(v());
    else if (a === '--docker') o.docker = true;
    else if (a === '--run') o.run = resolve(v());
    else if (a === '--binary') o.binary = resolve(v());
    else if (a === '--assets') o.assets = resolve(v());
    else if (a === '--seed') o.seed = Number(v());
    else if (a === '--max-ticks') o.maxTicks = Number(v());
    else throw new Error(`replay: unknown argument ${a}`);
  }
  if (!o.from === !o.record) throw new Error('replay: exactly one of --from and --record');
  if (o.record) {
    const rec = JSON.parse(readFileSync(o.record, 'utf8'));
    const fixtures = join(ROOT, 'tools/recompile/fixtures');
    const save = readdirSync(fixtures).filter((f) => f.endsWith('.ini'))
      .find((f) => sha256(join(fixtures, f)) === rec.saveBefore.sha256);
    if (!save) throw new Error(`replay: no fixture in ${fixtures} has the record's save sha256 ${rec.saveBefore.sha256}`);
    Object.assign(o, { game: rec.game, seed: rec.seed, maxTicks: rec.replay.rows, input: join(ROOT, rec.input.fixture),
      saveBefore: join(fixtures, save), expect: rec.replay });
  } else {
    Object.assign(o, { input: join(o.from, 'pilot.input'), saveBefore: join(o.from, 'save-before.ini') });
  }
  for (const k of ['game', 'run', 'binary', 'assets']) if (!o[k]) throw new Error(`replay: --${k} is required`);
  if (o.run.startsWith(ROOT)) throw new Error('replay: --run must be outside the repository');
  if (o.docker && !o.run.startsWith(MOUNT + '/')) throw new Error(`replay: --run must sit under ${MOUNT} (the container mount)`);
  return o;
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Hash of the trace's update rows and the frame visits it records. */
export async function traceDigest(path) {
  const h = createHash('sha256');
  const visits = [];
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

export function runReplay(o, game) {
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
  const args = ['run', '--rm', '-v', `${MOUNT}:${MOUNT}`, '-v', `${ROOT}/tools/recompile/run-harness.sh:/run-harness.sh:ro`,
    '-w', o.run, '-e', `CHOWDREN_BINARY=${o.binary}`];
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  args.push(IMAGE, 'bash', '/run-harness.sh');
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  writeFileSync(join(o.run, 'run.log'), (r.stdout ?? '') + (r.stderr ?? '') + `exit ${r.status}\n`);
  return r.status;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const game = await import(`./${o.game}.mjs`);
  const exit = runReplay(o, game);
  const replay = await traceDigest(join(o.run, 'trace'));
  const pilot = o.expect ? { rows: o.expect.rows, sha256: o.expect.sha256 } : await traceDigest(join(o.from, 'trace'));
  const out = {
    exit, runtime: o.docker ? 'docker' : 'native', ...(o.record ? { record: relative(ROOT, o.record) } : {}),
    binarySha256: sha256(o.binary), assetsSha256: sha256(o.assets),
    inputSha256: sha256(join(o.run, 'run.input')), saveBeforeSha256: sha256(join(o.run, 'save-before.ini')),
    pilotTrace: pilot, replayTrace: { rows: replay.rows, sha256: replay.sha256, visits: replay.visits },
    traceEqual: pilot.sha256 === replay.sha256,
    saveAfter: readFileSync(join(o.run, game.SAVE_NAME), 'utf8'),
  };
  writeFileSync(join(o.run, 'replay-summary.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify({ exit, traceEqual: out.traceEqual, rows: [pilot.rows, replay.rows],
    visits: replay.visits.map((v) => `${v.frame}:${v.updates}`).join(' ') }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.stack ?? String(e)); process.exit(1); });
}
