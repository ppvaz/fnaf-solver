// Constrained policy search over the sourced engine (see the user's
// architecture note, 2026-08-27).
//
// This is the SEED-CONDITIONED optimiser: given one exact RNG stream it beam-
// searches the semantic-action sequence that survives longest, using
// packages/core/src/mechanics/plant-model.js as the authoritative transition
// model. Run over many seeds it answers the question hand-tuning could not:
// is every night winnable at all, and if so what does optimal play look
// like -- an upper bound on any policy.
//
//   node tools/minus7/search.mjs --night=7 --seeds=20 [--beam=40] [--verbose]
//   node tools/minus7/search.mjs --self-test
//
// It is NOT the shipped controller and does not pretend to be robust: it plays
// each seed with foreknowledge of that seed's rolls. A robust policy is the
// next layer (learn observation->action rules from the winning traces).
import * as C from '@sixam/core/mechanics';
import { Sim } from '@sixam/core/mechanics';
import { cloneSim, view, ACTIONS, run } from './sim.mjs';
import { decide } from './policy.mjs';

// Lookahead: from a beam node, play the reactive policy (policy.mjs) forward
// and return how many frames it survives, capped at `horizon`. This is a
// weak rollout -- the reactive policy is not tuned -- but "frames survived
// under a fixed default policy from here" separates good positions from bad
// far better than any myopic heuristic can. A proper implementation would be
// MCTS with this as the default policy; the beam + rollout here is the cheap
// first cut the user's note calls for before upgrading.
function rollout(sim, night, horizon) {
  const s = cloneSim(sim);
  const stop = Math.min(C.NIGHT_FRAMES, s.frame + horizon);
  let guard = 0;
  while (s.alive && !s.won && s.frame < stop && guard++ < 800)
    run(s, ACTIONS[decide(view(s), night)](view(s)));
  return s.won ? C.NIGHT_FRAMES + 1 : s.frame;
}

const arg = (k, d) => {
  const m = process.argv.find(a => a.startsWith(`--${k}=`));
  return m ? m.split('=')[1] : d;
};
const FLAG = k => process.argv.includes(`--${k}`);

const DECISION = 30;                 // frames between decisions
const ROLLOUT_HORIZON = 3000;        // ~50 s reactive lookahead per beam node
const ACTION_KEYS = Object.keys(ACTIONS);

// Heuristic: survival frame dominates; the shaping terms are threat DEADLINES
// derived from sourced rates -- "how many frames until this kills me if I do
// nothing" -- not guesses about strategy. A short deadline is a steep penalty.
function score(sim) {
  if (!sim.alive) return -1e12 + sim.frame;      // dead: earlier death is worse
  if (sim.won) return 1e12;
  const v = view(sim);
  const night = sim.opts.night;
  let h = sim.frame * 1000;

  // box -> puppet. Drains 1/boxDrainFrames per unwound tick; empty box lets
  // the Puppet roll out in ~3 s.
  const drain = C.boxDrainFrames(night);
  const boxFramesLeft = v.winding ? Infinity : v.box * drain;
  if (boxFramesLeft < 300) h -= (300 - boxFramesLeft) * 120;

  // battery. Only lit? drains it, 1/frame.
  if (v.power < 400) h -= (400 - v.power) * 30;

  // Foxy. Safe D is 20 - peakAI; D climbs +1/s and locks/arrives on the 5 s
  // check (f % 300 == 0) when D >= safeD + roll. Project D forward to the NEXT
  // check -- that is the value that actually kills, not the value right now.
  const safeD = 20 - C.peakAi(night, 'foxy');
  const toCheck = (300 - (sim.frame % 300)) % 300 || 300;
  const projD = v.foxyD + (v.maskOn ? 0 : 0) + Math.floor(toCheck / C.FPS);
  if (projD >= safeD) h -= (projD - safeD + 1) * 12000;
  h -= v.foxyD * 150;
  if (v.foxyGotYou) h -= 200000;

  // Office / vent state.
  h -= v.atOpening.length * 4000;
  h -= v.inside.length * 20000;
  h -= v.committed.length * 200000;
  if (v.blackout) h -= 6000;
  if (v.gfPresent && v.monitor !== 'up') h -= 12000;   // can't safely raise
  for (const st of v.stun) if (st.occupied && st.stun < 90) h -= (90 - st.stun) * 40;
  return h;
}

// Pareto dominance on the resource frontier, gated on identical categorical
// state so we never merge two genuinely different situations.
function key(sim) {
  const v = view(sim);
  return [v.monitor, v.maskOn, v.foxyLoc, v.foxyGotYou, v.bbInside, v.bbOpening,
    v.blackout, v.atOpening.sort().join(','), v.inside.sort().join(','),
    v.committed.sort().join(',')].join('|');
}
function dominates(a, b) {   // does a dominate b? (a at least as good on every axis, better on one)
  const x = view(a), y = view(b);
  const axes = [x.box - y.box, x.power - y.power, y.foxyD - x.foxyD,
    y.foxyExposure - x.foxyExposure];
  return axes.every(d => d >= 0) && axes.some(d => d > 0);
}

function prune(beam, width) {
  // group by categorical key, drop Pareto-dominated within a group
  const groups = new Map();
  for (const b of beam) {
    const k = key(b.sim);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  const kept = [];
  for (const g of groups.values()) {
    for (const b of g) {
      if (!g.some(o => o !== b && dominates(o.sim, b.sim))) kept.push(b);
    }
  }
  kept.sort((a, b) => b.score - a.score);
  return kept.slice(0, width);
}

export function searchSeed(night, seed, { beam = 40 } = {}) {
  let states = [{ sim: new Sim({ seed, night }), score: 0, trace: [] }];
  const end = C.NIGHT_FRAMES;
  let best = states[0];
  while (states.length) {
    // all beam states are frame-aligned to a DECISION boundary
    const f0 = states[0].sim.frame;
    if (f0 >= end) { best = states[0]; break; }
    const next = [];
    for (const st of states) {
      for (const ak of ACTION_KEYS) {
        const sim = cloneSim(st.sim);
        const plan = ACTIONS[ak](view(sim));
        run(sim, plan);
        // resync to the next decision boundary
        const target = Math.min(end, Math.ceil((f0 + 1) / DECISION) * DECISION + DECISION * (plan.frames > DECISION ? Math.floor(plan.frames / DECISION) : 0));
        while (sim.alive && !sim.won && sim.frame < target) sim.tick();
        const sc = (sim.alive && !sim.won)
          ? rollout(sim, night, ROLLOUT_HORIZON) * 1000 + score(sim) / 1e6
          : score(sim);
        next.push({ sim, score: sc, trace: [...st.trace, ak] });
      }
    }
    // track the deepest survivor even if the whole beam later dies
    for (const n of next) if (n.sim.won || (n.sim.alive && n.sim.frame > best.sim.frame)) best = n;
    const alive = next.filter(n => n.sim.alive && !n.sim.won);
    const wins = next.filter(n => n.sim.won);
    if (wins.length) { best = wins.sort((a, b) => b.score - a.score)[0]; break; }
    if (!alive.length) { best = next.sort((a, b) => b.score - a.score)[0]; break; }
    states = prune(alive, beam);
  }
  return {
    won: best.sim.won, frame: best.sim.frame,
    t: +(best.sim.frame / C.FPS).toFixed(1),
    death: best.sim.death ? `${best.sim.death.reason}: ${best.sim.death.detail}` : null,
    trace: best.trace,
  };
}

function selfTest() {
  const s = new Sim({ seed: 42, night: 7 });
  for (let i = 0; i < 600; i++) s.tick();
  const c = cloneSim(s);
  for (let i = 0; i < 900; i++) { s.tick(); c.tick(); }
  const ok = JSON.stringify(s) === JSON.stringify(c);
  console.log(`clone fidelity over 1500 ticks: ${ok ? 'OK' : 'MISMATCH'}`);
  process.exit(ok ? 0 : 1);
}

function main() {
  if (FLAG('self-test')) return selfTest();
  const nights = (arg('night', '7')).split(',').map(Number);
  const seeds = +arg('seeds', '10');
  const beam = +arg('beam', '40');
  const verbose = FLAG('verbose');
  for (const night of nights) {
    let won = 0; const rows = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const r = searchSeed(night, seed, { beam });
      if (r.won) won++;
      rows.push(r);
      if (verbose) console.log(`  n${night} seed ${seed}: ${r.won ? 'WON' : `died ${r.t}s ${r.death}`}`);
    }
    console.log(`night ${night}: seed-optimal ${won}/${seeds} reach 6 AM (beam ${beam})`);
    if (verbose && rows[0].won)
      console.log(`  example winning trace (seed 1): ${rows[0].trace.slice(0, 60).join(' ')} ...`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()))
  main();
