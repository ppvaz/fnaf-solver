#!/usr/bin/env node
// Seed census: run one policy over N seeds of one night and report the win
// rate with its dominant death cause.
//
// The project's standing rule is that no win rate below 3000 seeds may be
// quoted, because the 16-bit RNG makes small samples misleading and makes
// 65,536-seed exhaustive censuses practical. This defaults to 3000 and will
// take `--seeds 65536` for the exhaustive answer.
//
//   node packages/propose/bin/census/census.ts --game fnaf1 --policy community-loop
//   node packages/propose/bin/census/census.ts --game fnaf1 --night 4 --seeds 65536
//   node packages/propose/bin/census/census.ts --game fnaf4 --night 5 --seeds 3000 --start 3000
//   node packages/propose/bin/census/census.ts --game fnaf1 --all
//   node packages/propose/bin/census/census.ts --game fnaf3 --night 5 --seeds 65536 --workers 6
//
// `--workers N` spreads the seeds over N threads of pool.ts (FNaF 1, 3 and 4);
// the default is one, so a census leaves the machine usable for other work.
// Every seed's outcome is tallied in seed order whatever N is, so the printed
// and --json results are the same byte for byte.
//
// A census is a **model** result. It says what the simulator does under the
// rules read out of the dump; it is not a device measurement and cannot be
// promoted as one.

import { isMainThread } from 'node:worker_threads';
import { Fnaf1Sim } from '@sixam/source/fnaf1';
import { POLICIES as FNAF1_POLICIES } from '@sixam/propose/games/policy-fnaf1.ts';
import { Fnaf3Sim } from '@sixam/source/fnaf3';
import { POLICIES as FNAF3_POLICIES } from '@sixam/propose/games/policy-fnaf3.ts';
import { Fnaf4Sim } from '@sixam/source/fnaf4';
import { POLICIES as FNAF4_POLICIES } from '@sixam/propose/games/policy-fnaf4.ts';
import { SimPool } from './pool.ts';

/** A game's simulator as the census drives it: built from a night and a seed, run under one policy. */
interface CensusGame {
  readonly Sim: new (options: { night: number, seed: number, custom: Readonly<Record<string, number>> | null, hyper: boolean }) =>
    { run(policy: unknown): { readonly outcome: string, readonly frames: number } };
  readonly policies: Readonly<Record<string, (options: Readonly<Record<string, number>>) => unknown>>;
  readonly nights: readonly number[];
  readonly modelOnlyPolicies?: readonly string[];
  readonly incomplete?: string;
}
/** One census: the game, night and policy, how many seeds from where, and the policy's and simulator's options. */
interface CensusParams {
  readonly game: string, readonly night: number, readonly policy: string, readonly seeds: number, readonly start?: number,
  readonly options?: Readonly<Record<string, number>>, readonly custom?: Readonly<Record<string, number>> | null,
  readonly hyper?: boolean, readonly sim?: Readonly<Record<string, unknown>>,
}
/** One census result: the wins over the seeds, the mean time survived, and the outcomes by count. */
interface CensusRow {
  readonly game: string, readonly night: number, readonly policy: string, readonly seeds: number, readonly start?: number,
  readonly wins: number, readonly custom: Readonly<Record<string, number>> | null, readonly hyper?: boolean,
  readonly rate: number, readonly meanSurvivedS: number, readonly causes: Readonly<Record<string, number>>,
}

const SIMS: Readonly<Record<string, CensusGame>> = {
  fnaf1: { Sim: Fnaf1Sim, policies: FNAF1_POLICIES, nights: [1, 2, 3, 4, 5, 6],
           // `roll-grid` scores perfectly and is not a device route: the two
           // doors are never both on screen, so its 333 ms windows would need
           // a 540 ms pan round trip for the first half of every night.
           modelOnlyPolicies: ['roll-grid'] },
  fnaf3: { Sim: Fnaf3Sim, policies: FNAF3_POLICIES, nights: [1, 2, 3, 4, 5, 6] },
  // Nights 7 and 8 are the shadow nights: `shadow = 1` sets Night 7 (the
  // Nightmare night, 15s and Freddy 6) and `shadow = 2` sets Night 8
  // (20/20/20/20) [g600/g602], and both switch to Fredbear 20 alone at
  // 4 AM [g601/g603].
  fnaf4: { Sim: Fnaf4Sim, policies: FNAF4_POLICIES, nights: [1, 2, 3, 4, 5, 6, 7, 8] },
};

// FNaF 2 does not get a new simulator here -- it already has `plant-model.js`,
// the policy families in `policybaselines.ts`, and a live route staked on
// both. Its census runs through that machinery rather than beside it, so the
// figures this prints are the same engine every other FNaF 2 number in the
// repository comes from.
async function censusFnaf2({ night, policy, seeds, start }: CensusParams): Promise<CensusRow> {
  if (start !== 0) throw new Error('fnaf2 census does not support --start');
  const [{ sweep }, { POLICIES }] = await Promise.all([
    import('../../parked/minus7/policy.ts'), import('../../parked/minus7/policybaselines.ts')]);
  const make = POLICIES[policy];
  if (!make) {
    throw new Error(`no fnaf2 policy ${policy}; have ${Object.keys(POLICIES).join(', ')}`);
  }
  const result = sweep(make, { runs: seeds, night });
  return {
    game: 'fnaf2', night, policy, seeds, wins: result.survived, custom: null,
    rate: result.survived / seeds,
    meanSurvivedS: NaN,
    causes: Object.fromEntries(result.deaths ?? []),
  };
}

function parseArgs(argv: string[]) {
  const args = { game: 'fnaf1', policy: null as string | null, seeds: 3000, night: null as number | null, workers: 1,
                 start: 0, all: false, json: false, options: {} as Record<string, number>,
                 custom: null as Record<string, number> | null, hyper: false, sim: {} as Record<string, number | boolean> };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--game') args.game = argv[++i];
    else if (flag === '--policy') args.policy = argv[++i];
    else if (flag === '--seeds') args.seeds = Number(argv[++i]);
    else if (flag === '--start') args.start = Number(argv[++i]);
    else if (flag === '--night') args.night = Number(argv[++i]);
    else if (flag === '--workers') args.workers = Number(argv[++i]);
    else if (flag === '--all') args.all = true;
    // FNaF 3's Aggressive cheat (`hyper on?`, g222): the move counter gains 2 a second.
    else if (flag === '--hyper') args.hyper = true;
    else if (flag === '--json') args.json = true;
    // `--custom 20` is 4/20: every dial at 20 on Night 7. `--custom
    // 20,20,20,20` sets freddy, bonnie, chica, foxy individually.
    else if (flag === '--custom') {
      const parts = argv[++i].split(',').map(Number);
      const ids = ['freddy', 'bonnie', 'chica', 'foxy'];
      args.custom = Object.fromEntries(ids.map((id, n) => [id, parts.length === 1 ? parts[0] : parts[n]]));
      if (args.night === null) args.night = 7;
    }
    else if (flag.startsWith('--opt.')) args.options[flag.slice(6)] = Number(argv[++i]);
    // Simulator options (the constructor's), e.g. `--sim.stage1Advance 0` for
    // FNaF 3's pre-2026-09-29 stage-1 rule: 0/1 read as booleans.
    else if (flag.startsWith('--sim.')) { const v = argv[++i]; args.sim[flag.slice(6)] = v === '0' ? false : v === '1' ? true : Number(v); }
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!Number.isInteger(args.workers) || args.workers < 1) throw new Error('--workers must be a positive integer');
  return args;
}

function checkStart({ start = 0 }: { start?: number }) {
  if (!Number.isInteger(start) || start < 0) throw new Error('--start must be a non-negative integer');
}

function checkGame({ game, policy, hyper = false }: { game: string, policy: string, hyper?: boolean }) {
  if (hyper && game !== 'fnaf3') throw new Error('--hyper is FNaF 3\'s Aggressive cheat');
  const entry = SIMS[game];
  if (!entry) throw new Error(`no simulator for ${game}`);
  if (!entry.policies[policy]) {
    throw new Error(`no policy ${policy} for ${game}; have ${Object.keys(entry.policies).join(', ')}`);
  }
}

/** One seed of a FNaF 1, 3 or 4 census as [outcome, frames]: plain data, so it is also pool.ts's task. */
export function censusSeed({ game, night, policy, seed, options = {}, custom = null, hyper = false, sim = {} }:
  Omit<CensusParams, 'seeds' | 'start'> & { readonly seed: number }): [outcome: string, frames: number] {
  const entry = SIMS[game];
  const result = new entry.Sim({ night, seed, custom, hyper, ...sim }).run(entry.policies[policy](options));
  return [result.outcome, result.frames];
}

const seedList = ({ game, night, policy, seeds, start = 0, options = {}, custom = null, hyper = false, sim = {} }: CensusParams) =>
  Array.from({ length: seeds }, (_, i) => ({ game, night, policy, seed: start + i, options, custom, hyper, sim }));

export function census(params: CensusParams) {
  checkStart(params);
  if (params.game === 'fnaf2') return censusFnaf2(params);
  checkGame(params);
  return tally(params, seedList(params).map(censusSeed));
}

/** census() with the seeds spread over a pool.ts pool; the same result, tallied in seed order. */
export async function censusOnPool(params: CensusParams, pool: SimPool) {
  checkStart(params);
  if (params.game === 'fnaf2') return censusFnaf2(params);
  checkGame(params);
  // The pool hands back each seed's censusSeed() across a structured clone.
  return tally(params, await pool.map(import.meta.url, 'censusSeed', seedList(params)) as ReturnType<typeof censusSeed>[]);
}

// Seed order, always: the causes keep their first-seen order among equal
// counts and the survived time is one floating sum, so a different order
// would change the result.
function tally({ game, night, policy, seeds, start = 0, custom = null, hyper = false, sim = {} }: CensusParams,
  rows: readonly ReturnType<typeof censusSeed>[]): CensusRow {
  const causes = new Map<string, number>();
  let wins = 0;
  let survivedMs = 0;
  for (const [outcome, frames] of rows) {
    if (outcome === '6AM') wins += 1;
    causes.set(outcome, (causes.get(outcome) ?? 0) + 1);
    survivedMs += frames * (1000 / 60);
  }
  return {
    game, night, policy, seeds, start, wins, custom, ...(hyper ? { hyper } : {}),
    ...(Object.keys(sim).length ? { sim } : {}),
    rate: wins / seeds,
    meanSurvivedS: survivedMs / seeds / 1000,
    causes: Object.fromEntries([...causes.entries()].sort((a, b) => b[1] - a[1])),
  };
}

function report(row: CensusRow) {
  const pct = (row.rate * 100).toFixed(2).padStart(6);
  const dials = row.custom ? ` [${Object.values(row.custom).join('/')}]` : row.hyper ? ' [aggressive]' : '';
  const mean = Number.isFinite(row.meanSurvivedS)
    ? `  mean ${row.meanSurvivedS.toFixed(0).padStart(3)}s` : '';
  const line = `${row.game} night ${row.night}${dials} ${row.policy.padEnd(16)} ` +
    `${String(row.wins).padStart(6)}/${row.seeds}  ${pct}%${mean}` +
    (row.start ? `  seeds ${row.start}-${row.start + row.seeds - 1}` : '');
  const worst = Object.entries(row.causes).filter(([cause]) => cause !== '6AM');
  const entry = SIMS[row.game];
  const warn = entry?.incomplete ? `  [INCOMPLETE: ${entry.incomplete}]`
    : entry?.modelOnlyPolicies?.includes(row.policy)
      ? '  [MODEL ONLY: the two doors are never both on screen; see policy-fnaf1.js]' : '';
  return (worst.length ? `${line}  | ${worst.map(([c, n]) => `${c} ${n}`).join(', ')}` : line) + warn;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fnaf2 = args.game === 'fnaf2';
  const entry = SIMS[args.game];
  // Each game's published line is its own default, so `--game fnaf3` needs no
  // `--policy` to mean "the community strategy for that game".
  if (!args.policy) args.policy = { fnaf3: 'community-line', fnaf4: 'community-loop',
                                    fnaf2: 'minus7' }[args.game] ?? 'community-loop';
  const nights = args.night ? [args.night]
    : (fnaf2 ? [1, 2, 3, 4, 5, 6, 7] : entry.nights);
  const policies = args.all && !fnaf2 ? Object.keys(entry.policies) : [args.policy];
  const pool = new SimPool({ workers: args.workers });
  const rows: CensusRow[] = [];
  try {
    for (const policy of policies) {
      for (const night of nights) {
        rows.push(await censusOnPool({ game: args.game, night, policy, seeds: args.seeds,
                                       start: args.start, options: args.options, custom: args.custom, hyper: args.hyper,
                                       sim: args.sim }, pool));
      }
    }
  } finally {
    await pool.close();
  }
  if (args.json) { console.log(JSON.stringify(rows, null, 2)); return; }
  for (const row of rows) console.log(report(row));
}

// isMainThread: a pool worker inherits process.argv, so without it every
// worker that imports this module as its task would run the census again.
if (isMainThread && import.meta.url === `file://${process.argv[1]}`) main();
