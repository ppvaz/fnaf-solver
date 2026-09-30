#!/usr/bin/env node
/**
 * Run one pilot policy over a block of seeds on the native rebuilt runtime.
 *
 *   node tools/recompile/pilot/batch.mjs --game fnaf3|fnaf4 --policy NAME --binary FILE --assets FILE
 *        --save FILE --seeds A-B[,C,D-E...] --out DIR [--jobs 6] [--knobs JSON] [--win-key SECTION.KEY=VALUE ...]
 *
 * Each seed is one `pilot.mjs` run in DIR/s<seed>/: native, no trace, stopped
 * 30 updates into the win frame or killed on a loss. A seed WINS only if the
 * save the game wrote holds every --win-key. A seed whose controller never
 * logged a record never reached the night: it is NO_NIGHT, not a loss. The
 * harness seeds every frame visit with the one seed, as the runtime seeds each
 * frame from its clock, so a menu screen that routes on its first draw routes
 * the same way on every revisit. FNaF 3's what-day screen sends `rare random`
 * = 1 (seed 0 among others, about 66 of 65,536) to a rare screen that returns
 * to what-day, forever; on a phone the next visit has a new clock seed.
 * One JSON line per seed is
 * appended to DIR/results.jsonl, with the seed, verdict, pilot outcome,
 * updates, and the last few policy records for a loss. A seed already in
 * results.jsonl is skipped, so an interrupted block resumes. A won seed's run
 * directory is deleted; its pilot.input stays in results.jsonl as a sha256.
 * Each seed spawns a fresh pilot, which reads the policy source again, so the
 * batch hashes pilot.mjs and the game module at start, writes that hash into
 * every row, and stops if either file changes before the block is done.
 * DIR stays outside the repository. Host-only; no device.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');

function parseArgs(argv) {
  const o = { jobs: 6, knobs: {}, winKeys: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--game') o.game = v();
    else if (a === '--policy') o.policy = v();
    else if (a === '--binary') o.binary = resolve(v());
    else if (a === '--assets') o.assets = resolve(v());
    else if (a === '--save') o.save = resolve(v());
    else if (a === '--seeds') {
      o.seeds = v().split(',').flatMap((part) => {
        const [x, y] = part.split('-').map(Number);
        if (!Number.isInteger(x) || !Number.isInteger(y ?? x) || (y ?? x) < x) throw new Error(`batch: bad seed range ${part}`);
        return Array.from({ length: (y ?? x) - x + 1 }, (_, n) => x + n);
      });
    }
    else if (a === '--out') o.out = resolve(v());
    else if (a === '--jobs') o.jobs = Number(v());
    else if (a === '--knobs') o.knobs = JSON.parse(v());
    else if (a === '--win-key') o.winKeys.push(v());
    else throw new Error(`batch: unknown argument ${a}`);
  }
  for (const k of ['game', 'policy', 'binary', 'assets', 'save', 'seeds', 'out']) if (!o[k]) throw new Error(`batch: --${k} is required`);
  if (!o.winKeys.length) throw new Error('batch: at least one --win-key');
  if (o.out.startsWith(ROOT)) throw new Error('batch: --out must be outside the repository');
  return o;
}

function iniKeys(text) {
  const out = {};
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) { section = sec[1]; continue; }
    const kv = /^([^=]+)=(.*)$/.exec(line);
    if (kv && section) out[`${section}.${kv[1]}`] = kv[2];
  }
  return out;
}

const SOURCES = (game) => [join(HERE, 'pilot.mjs'), join(HERE, `${game}.mjs`)];
const sourcesSha256 = (game) => {
  const h = createHash('sha256');
  for (const f of SOURCES(game)) h.update(readFileSync(f));
  return h.digest('hex');
};

function runSeed(o, saveName, seed) {
  const dir = join(o.out, `s${seed}`);
  const args = [join(HERE, 'pilot.mjs'), '--game', o.game, '--run', dir, '--binary', o.binary, '--assets', o.assets,
    '--save', o.save, '--policy', o.policy, '--seed', String(seed), '--max-ticks', '30000',
    '--stop-frame', '5', '--no-trace', '--kill-on-loss', '--knobs', JSON.stringify({ ...o.knobs, quiet: true })];
  return new Promise((res) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) => {
      let summary = null;
      try { summary = JSON.parse(out.trim().split('\n').pop()); } catch { /* reported below */ }
      const save = existsSync(join(dir, saveName)) ? iniKeys(readFileSync(join(dir, saveName), 'utf8')) : {};
      const missing = o.winKeys.filter((k) => save[k.split('=')[0]] !== k.split('=')[1]);
      const input = existsSync(join(dir, 'pilot.input')) ? readFileSync(join(dir, 'pilot.input')) : null;
      const logName = o.game === 'fnaf3' ? 'guard.jsonl' : 'warden.jsonl';
      const logText = existsSync(join(dir, logName)) ? readFileSync(join(dir, logName), 'utf8').trim() : '';
      const verdict = code === 0 && summary && !missing.length ? 'WON'
        : code === 0 && summary && summary.outcome === null && logText === '' ? 'NO_NIGHT' : 'LOST';
      const row = { seed, verdict, policySha256: o.policySha256,
        outcome: summary?.outcome ?? null, updates: summary?.updates ?? null,
        inputSha256: input ? createHash('sha256').update(input).digest('hex') : null };
      if (row.verdict !== 'WON') {
        row.missing = missing;
        if (code !== 0) row.error = err.trim().split('\n').slice(-3).join(' | ');
        if (logText) row.tail = logText.split('\n').slice(-6);
      } else {
        rmSync(dir, { recursive: true, force: true });
      }
      res(row);
    });
  });
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const game = await import(`./${o.game}.mjs`);
  o.policySha256 = sourcesSha256(o.game);
  mkdirSync(o.out, { recursive: true });
  const resultsPath = join(o.out, 'results.jsonl');
  const done = new Set();
  if (existsSync(resultsPath)) for (const l of readFileSync(resultsPath, 'utf8').split('\n')) if (l) done.add(JSON.parse(l).seed);
  const queue = [];
  for (const s of o.seeds) if (!done.has(s)) queue.push(s);
  let won = 0, lost = 0, noNight = 0;
  const started = Date.now();
  async function worker() {
    while (queue.length) {
      const seed = queue.shift();
      const row = await runSeed(o, game.SAVE_NAME, seed);
      if (sourcesSha256(o.game) !== o.policySha256) {
        queue.length = 0;
        throw new Error(`batch: ${SOURCES(o.game).join(' or ')} changed during the block; seed ${seed} and later are not recorded`);
      }
      appendFileSync(resultsPath, JSON.stringify(row) + '\n');
      if (row.verdict === 'WON') won += 1; else if (row.verdict === 'NO_NIGHT') noNight += 1; else lost += 1;
      const n = won + lost + noNight;
      if (n % 10 === 0 || row.verdict !== 'WON')
        console.log(`${new Date().toISOString().slice(11, 19)} seed ${seed} ${row.verdict} (${row.outcome}); ${won} won, ${lost} lost, ${noNight} no night, ${queue.length} left, ${((Date.now() - started) / 1000 / n).toFixed(1)} s/seed`);
    }
  }
  await Promise.all(Array.from({ length: o.jobs }, worker));
  console.log(JSON.stringify({ won, lost, noNight, seeds: o.seeds.length, first: o.seeds[0], last: o.seeds[o.seeds.length - 1], skipped: done.size }));
}

main().catch((e) => { console.error(e.stack ?? String(e)); process.exit(1); });
