#!/usr/bin/env node
/**
 * Per-seed input search over a rebuilt night: does some sequence of in-window
 * touches win this seed?
 *
 *   node packages/propose/bin/recompile/pilot/search.ts --game fnaf3|fnaf4 --policy NAME --binary FILE --assets FILE
 *        --save FILE --seeds A-B[,C...] --out DIR --win-key SECTION.KEY=VALUE [--budget 24] [--jobs 2]
 *        [--knobs JSON]
 *
 * Attempt 0 is the policy alone. After a loss, a new attempt replays the
 * losing attempt's own touches up to a branch point in the play frame
 * (pilot.ts --prefix/--branch), holds k updates with no touch, and hands
 * the night back to the policy. The runtime is deterministic. The branch
 * points are the updates at which the policy started a task (its summary's
 * `starts` when it reports them, else its log's `start` records) merged with
 * `BACKOFF` steps, latest first: a hold
 * there delays that task, and every touch that draws from the shared
 * generator (a play's Random(7) and Random(100), a seal's charge) draws at a
 * different update, so the rolls after it are different ones. Holds are
 * `HOLDS`; when the first hold at a branch point dies on the very update the
 * base's chain began, the point is already inside the lost chain and its
 * other holds are skipped. A game module that exports `doomStart(records)`
 * names where a lost chain began, and no branch point is taken after it;
 * without one, the death stands in for it. An attempt whose chain begins
 * later becomes the new base: a later death inside the same chain is noise.
 * When a base's branch points are used up, the search backs up to the base
 * it came from and goes on with that one's. A seed is WON
 * the first time an attempt's save holds every --win-key, and its touches are
 * then a plain CHOWDREN_INPUT that replay.ts plays with no pilot: the search
 * replays them so, and the row says whether that replay's save holds every
 * win key too (`replayWon`). A touch the harness logged across a frame
 * change is dropped from win.input first (`withoutStrays`, `straysDropped`).
 *
 * This asks whether a seed is winnable by touches alone; it is not a player's
 * route, and nothing here is a device claim. One JSON line per seed goes to
 * DIR/search.jsonl, with each attempt's branch, hold, outcome and death
 * update; the winning attempt's pilot.input is kept as DIR/s<seed>/win.input.
 * Every row carries the sha256 of the sources that decide it (pilot.ts, the
 * game module, search.ts, replay.ts), and the search stops if any of them
 * changes before the block is done. Host-only; DIR stays outside the
 * repository.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isList } from '@sixam/kernel';
import { gameModulePath, loadGame } from './pilot.ts';
import type { PilotGame, PilotSummary } from './pilot.ts';
import { runReplay } from './replay.ts';
import { missingWinKeys, runPilotChild } from './pilot-child.ts';
import { iniKeys } from './record.ts';
import { resumedSeeds } from '../sweep-common.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
// Updates before the death to branch at: 5, 10, 20, 40 and 80 s at 60 Hz.
// FNaF 3's attack chain runs about 1,600 updates from stage 1 to the death,
// so a branch point inside it is already lost.
export const BACKOFF = [300, 600, 1200, 2400, 4800];
export const HOLDS = [1, 2, 3, 5, 8, 13, 21];
// A branch point sits at least LEAD updates before its base's chain began, and
// a new base must push the chain's start back by more than GAIN updates: a
// hold of k updates otherwise just delays the same chain by k.
export const LEAD = 60;
export const GAIN = 120;

export const SOURCES = (game: string) => [join(HERE, 'pilot.ts'), gameModulePath(game), join(HERE, 'search.ts'), join(HERE, 'replay.ts')];
export function sourcesSha256(game: string) {
  const h = createHash('sha256');
  for (const f of SOURCES(game)) h.update(readFileSync(f));
  return h.digest('hex');
}

/** A search: the policy over a block of seeds, where it runs and from what, its budget and the keys a win writes. */
interface SearchOptions {
  game: string, policy: string, binary: string, assets: string, save: string, seeds: number[], out: string;
  jobs: number, budget: number, knobs: Readonly<Record<string, unknown>>, winKeys: string[], sourcesSha256?: string;
}

/** One attempt at a seed: whether it won, where it died and its chain began, and the updates its policy started tasks on. */
interface Attempt {
  won: boolean, outcome: unknown, death: number | null, starts: readonly number[], doom: number | null;
  error: string | undefined;
}

/** An attempt as the seed's row lists it. */
interface Try {
  n: number, from: number | null, branch?: number, hold?: number;
  outcome: unknown, death: number | null, doom: number | null, won: boolean | null, error?: string;
}

/** One seed's row in search.jsonl. */
interface SearchRow {
  seed: number, verdict: 'WON' | 'EXHAUSTED' | 'NO_NIGHT' | 'ERROR', sourcesSha256: string | undefined, budget: number;
  attempts?: number, tries: Try[], straysDropped?: number, winInputSha256?: string, replayWon?: boolean;
}

function parseArgs(argv: string[]): SearchOptions {
  const o: Partial<SearchOptions> & Pick<SearchOptions, 'jobs' | 'knobs' | 'winKeys' | 'budget'> = { jobs: 2, knobs: {}, winKeys: [], budget: 24 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--game') o.game = v();
    else if (a === '--policy') o.policy = v();
    else if (a === '--binary') o.binary = resolve(v());
    else if (a === '--assets') o.assets = resolve(v());
    else if (a === '--save') o.save = resolve(v());
    else if (a === '--seeds') o.seeds = parseSeeds(v());
    else if (a === '--out') o.out = resolve(v());
    else if (a === '--jobs') o.jobs = Number(v());
    else if (a === '--budget') o.budget = Number(v());
    else if (a === '--knobs') o.knobs = JSON.parse(v());
    else if (a === '--win-key') o.winKeys.push(v());
    else throw new Error(`search: unknown argument ${a}`);
  }
  for (const k of ['game', 'policy', 'binary', 'assets', 'save', 'seeds', 'out'] as const) if (!o[k]) throw new Error(`search: --${k} is required`);
  if (!o.winKeys.length) throw new Error('search: at least one --win-key');
  // Each required option was checked just above.
  const checked = o as SearchOptions;
  if (checked.out.startsWith(ROOT)) throw new Error('search: --out must be outside the repository');
  return checked;
}

export function parseSeeds(text: string) {
  return text.split(',').flatMap((part) => {
    const [x, y] = part.split('-').map(Number);
    if (!Number.isInteger(x) || !Number.isInteger(y ?? x) || (y ?? x) < x) throw new Error(`bad seed range ${part}`);
    return Array.from({ length: (y ?? x) - x + 1 }, (_, n) => x + n);
  });
}

/**
 * The update at which the night was lost: the last update pilot.ts saw in
 * the play frame (`lastPlayTick`), which every game's summary carries.
 */
export function deathUpdate(summary: PilotSummary | null) {
  if (!summary || summary.outcome === '6AM' || summary.outcome === null) return null;
  return Number.isInteger(summary.lastPlayTick) ? summary.lastPlayTick : null;
}

/**
 * The branch points to try from a base attempt that died at update `death`:
 * the updates its policy started a task at (`starts`) and the `BACKOFF` steps
 * back from the last admissible point, merged, latest first. Points at or before `floor` (the base's own
 * branch) are skipped, since the prefix up to there is fixed, and so are
 * points within 30 updates of the death.
 */
export function branchPoints(death: number | null, starts: readonly number[] = [], floor = 0, doom: number | null = null) {
  const last = Math.min(Number(death) - 30, doom === null ? Infinity : doom - LEAD);
  const pts = [...starts.filter((t) => t < last), ...BACKOFF.map((b) => last - b)]
    .filter((t) => t > floor);
  return [...new Set(pts)].sort((a, b) => b - a);
}

/**
 * A pilot.input without its frame-change strays. A touch sent in reply to the
 * last update of a frame lands on the next frame's first update, and the
 * harness logs it with the old frame's index and the new update number 0
 * (harness_before_events runs before `frame->index` changes). Replayed, such
 * a row fires at the old frame's own update 0, the start of the night. It is
 * an update-0 row after rows of the same frame index; it is dropped.
 */
export function withoutStrays(text: string) {
  const out: string[] = [];
  let prev = null as { f: number, t: number } | null, dropped = 0;
  for (const line of text.split('\n')) {
    const m = /^(-?\d+) (\d+) /.exec(line);
    if (m) {
      const row = { f: Number(m[1]), t: Number(m[2]) };
      // A pilot reply lands on the update after the state it answers, so a
      // touch of its own is never on update 0; a stray always is.
      if (row.t === 0 && prev && row.f === prev.f) { dropped += 1; continue; }
      prev = row;
    }
    out.push(line);
  }
  return { text: out.join('\n'), dropped };
}

/** How far a lost attempt got: where its chain began, else its death. */
export const progress = (r: { readonly doom: number | null, readonly death: number | null }) => r.doom ?? r.death;

/** The policy log's records, parsed. */
function logRecords(dir: string, game: string) {
  const log = join(dir, game === 'fnaf3' ? 'guard.jsonl' : 'warden.jsonl');
  if (!existsSync(log)) return [];
  const out: Readonly<Record<string, unknown>>[] = [];
  for (const line of readFileSync(log, 'utf8').split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn last line */ }
  }
  return out;
}

async function attempt(o: SearchOptions, gameModule: PilotGame, seed: number, dir: string, extra: readonly string[]): Promise<Attempt> {
  const run = await runPilotChild(o, seed, dir, gameModule.SAVE_NAME, { extra, tailLines: 2 });
  const won = !run.failure && !missingWinKeys(run.save, o.winKeys).length;
  const records = logRecords(dir, o.game);
  // A policy that reports every task start in its summary gives the whole
  // night; else the log's `start` records, as far back as the log goes.
  // Number.isInteger read each logged update; a policy's summary lists its starts as updates.
  const logged = records.filter((r) => r.start && Number.isInteger(r.t)).map((r) => r.t as number);
  const { summary } = run;
  return { won, outcome: summary?.outcome ?? null, death: deathUpdate(summary),
    starts: isList(summary?.starts) ? summary.starts as readonly number[] : logged,
    doom: gameModule.doomStart ? gameModule.doomStart(records) : null,
    error: run.failure ?? undefined };
}

/**
 * A seed whose first night was neither won nor lost at an update the search can branch from: an ERROR when the child
 * failed or the night ended some other way, a NO_NIGHT only when it ran cleanly and never reached the office.
 */
export function unbranchedVerdict(base: { readonly error?: string, readonly outcome: unknown }): 'NO_NIGHT' | 'ERROR' {
  return !base.error && base.outcome === null ? 'NO_NIGHT' : 'ERROR';
}

async function searchSeed(o: SearchOptions, gameModule: PilotGame, seed: number): Promise<SearchRow> {
  const root = join(o.out, `s${seed}`);
  mkdirSync(root, { recursive: true });
  const tries: Try[] = [];
  const run = async (n: number, extra: readonly string[], meta: Pick<Try, 'from' | 'branch' | 'hold'>) => {
    const dir = join(root, `a${n}`);
    rmSync(dir, { recursive: true, force: true });
    const r = await attempt(o, gameModule, seed, dir, extra);
    tries.push({ n, ...meta, outcome: r.outcome, death: r.death, doom: r.doom, won: r.won, ...(r.error ? { error: r.error } : {}) });
    return { ...r, dir };
  };
  let base = await run(0, [], { from: null });
  let n = 1;
  if (!base.won && base.death === null) {
    return { seed, verdict: unbranchedVerdict(base), sourcesSha256: o.sourcesSha256, budget: o.budget, tries };
  }
  // Depth first: a branch whose chain begins later becomes the base, and
  // when a base's branch points are used up the search returns to the one it
  // came from and goes on with that one's.
  const stack: { base: typeof base, baseN: number, points: number[] }[] = base.won ? [] : [{ base, baseN: 0, points: branchPoints(base.death, base.starts, 0, base.doom) }];
  search: while (stack.length && n <= o.budget) {
    const top = stack[stack.length - 1];
    if (!top.points.length) { stack.pop(); continue; }
    // The loop checked the points' length.
    const at = top.points.shift() as number;
    for (const hold of HOLDS) {
      if (n > o.budget) break search;
      const r = await run(n, ['--prefix', join(top.base.dir, 'pilot.input'), '--branch', String(at), '--hold', String(hold)],
        { from: top.baseN, branch: at, hold });
      const thisN = n;
      n += 1;
      if (r.won) { base = r; break search; }
      if (progress(r) !== null && Number(progress(r)) > Number(progress(top.base)) + GAIN) {
        stack.push({ base: r, baseN: thisN, points: branchPoints(r.death, r.starts, at, r.doom) });
        continue search;
      }
      // The same chain on the first hold: this point is inside the lost chain.
      if (hold === HOLDS[0] && Math.abs(Number(progress(r)) - Number(progress(top.base))) <= HOLDS[0]) break;
    }
  }
  const row: SearchRow = { seed, verdict: base.won ? 'WON' : 'EXHAUSTED', sourcesSha256: o.sourcesSha256, budget: o.budget,
    attempts: tries.length, tries };
  if (base.won) {
    const clean = withoutStrays(readFileSync(join(base.dir, 'pilot.input'), 'utf8'));
    writeFileSync(join(root, 'win.input'), clean.text);
    row.straysDropped = clean.dropped;
    row.winInputSha256 = createHash('sha256').update(readFileSync(join(root, 'win.input'))).digest('hex');
    // The touches alone, with no pilot, must win too.
    const verify = join(root, 'verify');
    rmSync(verify, { recursive: true, force: true });
    const code = runReplay({ run: verify, binary: o.binary, assets: o.assets, seed, maxTicks: 30000, docker: false,
      input: join(root, 'win.input'), saveBefore: o.save }, gameModule);
    const save = existsSync(join(verify, gameModule.SAVE_NAME)) ? iniKeys(readFileSync(join(verify, gameModule.SAVE_NAME), 'utf8')) : {};
    row.replayWon = code === 0 && !missingWinKeys(save, o.winKeys).length;
    rmSync(verify, { recursive: true, force: true });
  }
  for (const t of tries) rmSync(join(root, `a${t.n}`), { recursive: true, force: true });
  return row;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const game = await loadGame(o.game);
  o.sourcesSha256 = sourcesSha256(o.game);
  mkdirSync(o.out, { recursive: true });
  const path = join(o.out, 'search.jsonl');
  const done = resumedSeeds(path, 'sourcesSha256', o.sourcesSha256);
  const queue = o.seeds.filter((s) => !done.has(s));
  const tally: Record<string, number> = {};
  async function worker() {
    while (queue.length) {
      // The loop checked the queue's length.
      const seed = queue.shift() as number;
      const row = await searchSeed(o, game, seed);
      if (sourcesSha256(o.game) !== o.sourcesSha256) {
        queue.length = 0;
        throw new Error(`search: ${SOURCES(o.game).join(', ')} changed during the block; seed ${seed} and later are not recorded`);
      }
      appendFileSync(path, JSON.stringify(row) + '\n');
      tally[row.verdict] = (tally[row.verdict] ?? 0) + 1;
      console.log(`${new Date().toISOString().slice(11, 19)} seed ${seed} ${row.verdict} after ${row.tries.length} attempt(s); ${JSON.stringify(tally)}, ${queue.length} left`);
    }
  }
  await Promise.all(Array.from({ length: o.jobs }, worker));
  console.log(JSON.stringify({ ...tally, seeds: o.seeds.length, skipped: done.size }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.stack ?? String(e)); process.exit(1); });
}
