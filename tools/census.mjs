#!/usr/bin/env node
// Seed census: run one policy over N seeds of one night and report the win
// rate with its dominant death cause.
//
// The project's standing rule is that no win rate below 3000 seeds may be
// quoted, because the 16-bit RNG makes small samples misleading and makes
// 65,536-seed exhaustive censuses practical. This defaults to 3000 and will
// take `--seeds 65536` for the exhaustive answer.
//
//   node tools/census.mjs --game fnaf1 --policy community-loop
//   node tools/census.mjs --game fnaf1 --night 4 --seeds 65536
//   node tools/census.mjs --game fnaf4 --night 5 --seeds 3000 --start 3000
//   node tools/census.mjs --game fnaf1 --all
//
// A census is a **model** result. It says what the simulator does under the
// rules read out of the dump; it is not a device measurement and cannot be
// promoted as one.

import { Fnaf1Sim } from '../packages/core/src/mechanics/games/sim-fnaf1.js';
import { POLICIES as FNAF1_POLICIES } from '../packages/core/src/mechanics/games/policy-fnaf1.js';
import { Fnaf3Sim } from '../packages/core/src/mechanics/games/sim-fnaf3.js';
import { POLICIES as FNAF3_POLICIES } from '../packages/core/src/mechanics/games/policy-fnaf3.js';
import { Fnaf4Sim } from '../packages/core/src/mechanics/games/sim-fnaf4.js';
import { POLICIES as FNAF4_POLICIES } from '../packages/core/src/mechanics/games/policy-fnaf4.js';

const SIMS = {
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
// the policy families in `policybaselines.mjs`, and a live route staked on
// both. Its census runs through that machinery rather than beside it, so the
// figures this prints are the same engine every other FNaF 2 number in the
// repository comes from.
async function censusFnaf2({ night, policy, seeds, start }) {
  if (start !== 0) throw new Error('fnaf2 census does not support --start');
  const [{ sweep }, { POLICIES }] = await Promise.all([
    import('./policy.mjs'), import('./policybaselines.mjs')]);
  const make = POLICIES[policy];
  if (!make) {
    throw new Error(`no fnaf2 policy ${policy}; have ${Object.keys(POLICIES).join(', ')}`);
  }
  const result = sweep((seed, slack, model) => make(seed, slack, model),
                       { runs: seeds, night });
  return {
    game: 'fnaf2', night, policy, seeds, wins: result.survived, custom: null,
    rate: result.survived / seeds,
    meanSurvivedS: NaN,
    causes: Object.fromEntries(result.deaths ?? []),
  };
}

function parseArgs(argv) {
  const args = { game: 'fnaf1', policy: null, seeds: 3000, night: null,
                 start: 0, all: false, json: false, options: {}, custom: null, hyper: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--game') args.game = argv[++i];
    else if (flag === '--policy') args.policy = argv[++i];
    else if (flag === '--seeds') args.seeds = Number(argv[++i]);
    else if (flag === '--start') args.start = Number(argv[++i]);
    else if (flag === '--night') args.night = Number(argv[++i]);
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
    else throw new Error(`unknown flag ${flag}`);
  }
  return args;
}

export function census({ game, night, policy, seeds, start = 0, options = {}, custom = null, hyper = false }) {
  if (!Number.isInteger(start) || start < 0) throw new Error('--start must be a non-negative integer');
  if (game === 'fnaf2') return censusFnaf2({ night, policy, seeds, start });
  if (hyper && game !== 'fnaf3') throw new Error('--hyper is FNaF 3\'s Aggressive cheat');
  const entry = SIMS[game];
  if (!entry) throw new Error(`no simulator for ${game}`);
  const makePolicy = entry.policies[policy];
  if (!makePolicy) {
    throw new Error(`no policy ${policy} for ${game}; have ${Object.keys(entry.policies).join(', ')}`);
  }
  const causes = new Map();
  let wins = 0;
  let survivedMs = 0;
  for (let seed = start; seed < start + seeds; seed += 1) {
    const sim = new entry.Sim({ night, seed, custom, hyper });
    const result = sim.run(makePolicy(options));
    if (result.outcome === '6AM') wins += 1;
    causes.set(result.outcome, (causes.get(result.outcome) ?? 0) + 1);
    survivedMs += result.frames * (1000 / 60);
  }
  return {
    game, night, policy, seeds, start, wins, custom, ...(hyper ? { hyper } : {}),
    rate: wins / seeds,
    meanSurvivedS: survivedMs / seeds / 1000,
    causes: Object.fromEntries([...causes.entries()].sort((a, b) => b[1] - a[1])),
  };
}

function report(row) {
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
  const rows = [];
  for (const policy of policies) {
    for (const night of nights) {
      rows.push(await census({ game: args.game, night, policy, seeds: args.seeds,
                               start: args.start, options: args.options, custom: args.custom, hyper: args.hyper }));
    }
  }
  if (args.json) { console.log(JSON.stringify(rows, null, 2)); return; }
  for (const row of rows) console.log(report(row));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
