#!/usr/bin/env node
/**
 * Run one pilot policy over a block of seeds on the native rebuilt runtime.
 *
 *   node packages/propose/bin/recompile/pilot/batch.ts --game fnaf3|fnaf4 --policy NAME --binary FILE --assets FILE
 *        --save FILE --seeds A-B[,C,D-E...] --out DIR [--jobs 6] [--knobs JSON] [--win-key SECTION.KEY=VALUE ...]
 *
 * Each seed is one `pilot.ts` run in DIR/s<seed>/: native, no trace, stopped
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
 * batch hashes pilot.ts and the game module at start, writes that hash into
 * every row, and stops if either file changes before the block is done.
 * DIR stays outside the repository. Host-only; no device.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameModulePath, loadGame } from './pilot.ts';
import { missingWinKeys, runPilotChild } from './pilot-child.ts';
import type { PilotChildRun } from './pilot-child.ts';
import { resumedSeeds } from '../sweep-common.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');

/** A batch: the policy over a block of seeds, where it runs and from what, and the keys a win writes. */
interface BatchOptions {
  game: string, policy: string, binary: string, assets: string, save: string, seeds: number[], out: string;
  jobs: number, knobs: Readonly<Record<string, unknown>>, winKeys: string[], policySha256?: string;
}

/** One seed's row in results.jsonl. */
interface SeedRow {
  seed: number, verdict: 'WON' | 'NO_NIGHT' | 'LOST' | 'ERROR', policySha256: string | undefined, outcome: unknown, updates: number | null;
  inputSha256: string | null, missing?: string[], error?: string, tail?: string[];
}

function parseArgs(argv: string[]): BatchOptions {
  const o: Partial<BatchOptions> & Pick<BatchOptions, 'jobs' | 'knobs' | 'winKeys'> = { jobs: 6, knobs: {}, winKeys: [] };
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
  for (const k of ['game', 'policy', 'binary', 'assets', 'save', 'seeds', 'out'] as const) if (!o[k]) throw new Error(`batch: --${k} is required`);
  if (!o.winKeys.length) throw new Error('batch: at least one --win-key');
  // Each required option was checked just above.
  const checked = o as BatchOptions;
  if (checked.out.startsWith(ROOT)) throw new Error('batch: --out must be outside the repository');
  return checked;
}

export const SOURCES = (game: string) => [join(HERE, 'pilot.ts'), gameModulePath(game)];
const sourcesSha256 = (game: string) => {
  const h = createHash('sha256');
  for (const f of SOURCES(game)) h.update(readFileSync(f));
  return h.digest('hex');
};

/**
 * A seed's verdict: ERROR when the child crashed or left no summary to trust, WON when the save holds every win key,
 * NO_NIGHT when the night never reached the office (no outcome and an empty log), and LOST otherwise.
 */
export function seedVerdict(run: Pick<PilotChildRun, 'failure' | 'summary'>, missing: readonly string[], logText: string): SeedRow['verdict'] {
  if (run.failure || !run.summary) return 'ERROR';
  if (!missing.length) return 'WON';
  return run.summary.outcome === null && logText === '' ? 'NO_NIGHT' : 'LOST';
}

async function runSeed(o: BatchOptions, saveName: string, seed: number): Promise<SeedRow> {
  const dir = join(o.out, `s${seed}`);
  const run = await runPilotChild(o, seed, dir, saveName);
  const missing = missingWinKeys(run.save, o.winKeys);
  const input = existsSync(join(dir, 'pilot.input')) ? readFileSync(join(dir, 'pilot.input')) : null;
  const logName = o.game === 'fnaf3' ? 'guard.jsonl' : 'warden.jsonl';
  const logText = existsSync(join(dir, logName)) ? readFileSync(join(dir, logName), 'utf8').trim() : '';
  const row: SeedRow = { seed, verdict: seedVerdict(run, missing, logText), policySha256: o.policySha256,
    outcome: run.summary?.outcome ?? null, updates: run.summary?.updates ?? null,
    inputSha256: input ? createHash('sha256').update(input).digest('hex') : null };
  if (row.verdict !== 'WON') {
    row.missing = missing;
    if (run.failure) row.error = run.failure;
    if (logText) row.tail = logText.split('\n').slice(-6);
  } else {
    rmSync(dir, { recursive: true, force: true });
  }
  return row;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const game = await loadGame(o.game);
  o.policySha256 = sourcesSha256(o.game);
  mkdirSync(o.out, { recursive: true });
  const resultsPath = join(o.out, 'results.jsonl');
  const done = resumedSeeds(resultsPath, 'policySha256', o.policySha256);
  const queue: number[] = [];
  for (const s of o.seeds) if (!done.has(s)) queue.push(s);
  let won = 0, lost = 0, noNight = 0, errors = 0;
  const started = Date.now();
  async function worker() {
    while (queue.length) {
      // The loop checked the queue's length.
      const seed = queue.shift() as number;
      const row = await runSeed(o, game.SAVE_NAME, seed);
      if (sourcesSha256(o.game) !== o.policySha256) {
        queue.length = 0;
        throw new Error(`batch: ${SOURCES(o.game).join(' or ')} changed during the block; seed ${seed} and later are not recorded`);
      }
      appendFileSync(resultsPath, JSON.stringify(row) + '\n');
      if (row.verdict === 'WON') won += 1; else if (row.verdict === 'NO_NIGHT') noNight += 1;
      else if (row.verdict === 'ERROR') errors += 1; else lost += 1;
      const n = won + lost + noNight + errors;
      if (n % 10 === 0 || row.verdict !== 'WON')
        console.log(`${new Date().toISOString().slice(11, 19)} seed ${seed} ${row.verdict} (${row.outcome}); ${won} won, ${lost} lost, ${noNight} no night, ${errors} errors, ${queue.length} left, ${((Date.now() - started) / 1000 / n).toFixed(1)} s/seed`);
    }
  }
  await Promise.all(Array.from({ length: o.jobs }, worker));
  console.log(JSON.stringify({ won, lost, noNight, errors, seeds: o.seeds.length, first: o.seeds[0], last: o.seeds[o.seeds.length - 1], skipped: done.size }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.stack ?? String(e)); process.exit(1); });
}
