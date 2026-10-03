// Plan 16: constrained policy search over the device plan's named timing
// geometry, evaluated on the exact engine through recipe.build ->
// devicePlan -> modelGate. Dominance-pruned beam search over a small, sourced-
// floored parameter space (packages/propose/parked/minus7/hid-device-pilot.ts search knobs). No second
// simulator, no semantic-action free search (Plan 16 non-goals).
//
//   node packages/propose/parked/minus7/paramsearch.ts --nights=5,6,7 [--runs=400] [--admit=1200]
//                                     [--beam=12] [--rounds=6] [--shape=correlated]
//
// The objective's first key dominates at the current margin: min over the
// searched nights of modelGate survival under `--shape`. Frontier admission is
// a --admit-seed re-evaluation; screening during beam expansion is at --runs.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { build, devicePlan, idleUntilMs } from '../../bin/plans/recipe.ts';
import { modelGate } from '../../bin/plans/human-gate.ts';
import { makeSearchKnobs } from './hid-device-pilot.ts';
import { canonicalJson } from '@sixam/kernel/contracts';

const arg = (k: string, d: string) => {
  const m = process.argv.find(a => a.startsWith(`--${k}=`));
  return m ? m.split('=')[1] : d;
};

// Each knob's admissible delta window, in ms, with the sourced floor it may
// not cross. Steps are the perturbations beam expansion tries.
export const FLOORS: Readonly<Record<string, { min: number, max: number, step: number[] }>> = {
  // off+0.25 is exactly MASK_ANIM_OFF (15 fr, config.js:487); earlier lands
  // inside the mask-off animation and hallLightOn never asserts. Later is
  // bounded by the sweep (attackSweepDeltaMs).
  attackHallDeltaMs:   { min: 0,   max: 130, step: [17, 33, 50, -17] },
  // off+0.45 recovery sweep. EARLIER is safe (more Withered coverage); later
  // is hard-pinned by the 400-fr STUN_FRAMES budget from the prior sweep.
  attackSweepDeltaMs:  { min: -100, max: 34, step: [-33, -50, -67, -17, 17] },
  // Extra recovery reset. 0 = off; a value places a monitor-down hall beat
  // that many ms into the recovery wind (needs ~1 s of wind to fund it).
  attackRstDeltaMs:    { min: 0,   max: 8300, step: [0, 6800, 7100, 7400, 7700] },
  // Clear-cycle second reset b+3.10. Bounded by the b+3.27 raise ahead of it.
  clearHall2DeltaMs:   { min: -130, max: 130, step: [17, 33, -17, -33, 50] },
  // `off` phase margin, base 900. Floor ~300 (item 8: 300 collapses the gate).
  phaseMarginDeltaMs:  { min: -400, max: 200, step: [-100, -200, 100, -50] },
  // Hall pulse length, base 130. Floor MIN_CONTACT 100 -> delta >= -30.
  hallPulseDeltaMs:    { min: -30,  max: 170, step: [33, 67, -17, 100] },
  // pkg 5: opening gains a monitor-down GF-clear flick across the frame-300
  // check. Boolean.
  openGfFlick:         { min: 0,   max: 1,  step: [1, -1] },
  // pkg 4: a reset during the left-opening read.  The monitor-down animation
  // is 367 ms, so a pulse before 400 ms cannot reach the hallway; 800 ms
  // leaves room before the read's prophylactic mask.  It is meaningful only
  // with the opening GF suppression, but keeping that relation as a
  // constraint in the enumerator (rather than hiding it in HidPilot) makes
  // the permitted geometry auditable.
  preReadHallMs:        { min: 0,   max: 800, step: [400, 450, 500, 550, 600, 650, 700, 750, 800] },
  // The sole cross-cycle state lever: frames since an observed departure bang.
  // Its ceiling is FOXY_RETURN_MAX (999 frames); zero preserves the ordinary
  // unconditional geometry.
  bangAgeFrames:        { min: 0,   max: 999, step: [30, 37, 45, 60, 90, 120, 240, 500, 999] },
};
const KNOBS = Object.keys(FLOORS);

// The sweep geometry is NOT a beam knob -- its landscape is phase-locked and
// chaotic (2 ms of emitted spacing flips n6 survival by 20 points), so
// `packages/propose/parked/minus7/geometrysearch.ts` maps it on a dense grid instead. A geometry
// enters this search as a FIXED context the timing knobs are then optimised on
// top of -- which is how the two levers compose: pick the sweep geometry, then
// search the attack/opening/bang-anchor knobs at that geometry. `null` fields
// mean devicePlan()'s own device-validated defaults (spacing 133, contact 100).
/** A sweep geometry: the model's select slot, and the emitted spacing and contact (null = devicePlan's). */
interface Geom { sweepSlotMs: number, deviceSpacingMs: number | null, sweepContactMs: number | null }
export const SHIPPED_GEOM: Geom = { sweepSlotMs: 120, deviceSpacingMs: null, sweepContactMs: null };

function planTextFor(night: number, geom = SHIPPED_GEOM, knobs: ReturnType<typeof makeSearchKnobs> | undefined = undefined) {
  const recipe = build({ night, sweepSlotMs: geom.sweepSlotMs, knobs });
  const plan = devicePlan(recipe,
    geom.deviceSpacingMs != null || geom.sweepContactMs != null
      // A null field reaches devicePlan as null, not as its default.
      ? { deviceSpacingMs: geom.deviceSpacingMs, sweepContactMs: geom.sweepContactMs } as Parameters<typeof devicePlan>[1]
      : {});
  let text = `#night ${recipe.night}\n#idle-until ${idleUntilMs(recipe.night)}\n`;
  for (const [name, lines] of Object.entries(plan))
    text += `#cycle ${name} ${recipe.cycles[name as keyof typeof recipe.cycles].lengthMs}\n${lines.join('\n')}\n`; // devicePlan names its cycles after the recipe's
  return text;
}

// Apply a parameter assignment, then evaluate every requested night. Returns
// per-night { pct, won, runs, cvar } plus `ok` (false if any night threw --
// an over-floor value that devicePlan/makeRoom rejects, which is the sourced
// constraint doing its job).
/** A parameter assignment: knob -> delta, an absent knob meaning 0. */
export type Params = Readonly<Record<string, number>>;
/** One night's score: seeds won of `runs`, the percentage, and the worst-decile survival. */
export interface NightScore { won: number, runs: number, pct: number, cvar: number }
/** An assignment's per-night scores; `ok` false with `error` when it could not be built or replayed. */
interface EvalResult {
  params: Params, nights: Record<number, NightScore>, ok: boolean, error?: string,
  admit?: Record<number, NightScore>,
}
export function evalParams(params: Params, nights: readonly number[], runs: number, shape: string, seedStart = 1, geom = SHIPPED_GEOM): EvalResult {
  for (const k of KNOBS) {
    const v = params[k] || 0;
    if (!Number.isInteger(v) || v < FLOORS[k].min || v > FLOORS[k].max)
      return { params: { ...params }, nights: {}, ok: false,
        error: `${k}=${v} is outside its constrained search floor` };
  }
  if (params.preReadHallMs > 0 && !params.openGfFlick)
    return { params: { ...params }, nights: {}, ok: false,
      error: 'preReadHallMs requires the opening Golden Freddy suppression' };
  if (params.bangAgeFrames > 0 && !params.preReadHallMs)
    return { params: { ...params }, nights: {}, ok: false,
      error: 'bangAgeFrames may only control an in-read hall reset' };
  const knobs = makeSearchKnobs(params);
  const out: EvalResult = { params: { ...params }, nights: {}, ok: true };
  try {
    for (const night of nights) {
      const text = planTextFor(night, geom, knobs);
      // Keep the per-seed vector from modelGate itself so screening and
      // admission share exactly one jitter/replay implementation.
      const gate = modelGate(text, { night, runs, shape, seedStart, outcomes: true });
      const alive = gate.outcomes as number[]; // outcomes: true keeps the per-seed vector
      const won = gate.survived;
      // seed-CVaR: survival over the worst decile of seed trajectories. With a
      // 0/1 outcome this is just the mean of the lowest 10% -- i.e. is the
      // worst decile all deaths (cvar 0) or does it carry some survivors.
      const dec = Math.max(1, Math.floor(runs / 10));
      const cvar = alive.slice().sort((a, b) => a - b).slice(0, dec).reduce((a, b) => a + b, 0) / dec;
      out.nights[night] = { won, runs, pct: +(100 * won / runs).toFixed(1), cvar };
    }
  } catch (e) { out.ok = false; out.error = (e as Error).message; }
  return out;
}

export function baselineLadder(nights: readonly number[], runs: number, shape = 'iid', geom = SHIPPED_GEOM) {
  const r = evalParams({}, nights, runs, shape, 1, geom);
  const lad: Record<number, number> = {};
  for (const n of nights) lad[n] = r.nights[n].pct;
  return lad;
}

const minPct = (r: EvalResult, nights: readonly number[]) => Math.min(...nights.map(n => r.nights[n].pct));
function dominates(a: EvalResult, b: EvalResult, nights: readonly number[]) {  // a dominates b: >= on every night pct AND cvar, > somewhere
  const axes = nights.flatMap(n => [a.nights[n].pct - b.nights[n].pct, a.nights[n].cvar - b.nights[n].cvar]);
  return axes.every(d => d >= -1e-9) && axes.some(d => d > 1e-9);
}

export function searchParams({ nights, runs = 400, beam = 12, rounds = 6, shape = 'correlated', admit = 0, geom = SHIPPED_GEOM }: {
  nights: readonly number[], runs?: number, beam?: number, rounds?: number, shape?: string, admit?: number, geom?: Geom,
}) {
  const zero = Object.fromEntries(KNOBS.map(k => [k, 0]));
  let frontier = [evalParams(zero, nights, runs, shape, 1, geom)];
  let pool = [...frontier];
  for (let round = 0; round < rounds; round++) {
    const cand: EvalResult[] = [];
    for (const node of pool) {
      for (const k of KNOBS) {
        for (const d of FLOORS[k].step) {
          const v = (node.params[k] || 0) + d;
          if (v < FLOORS[k].min || v > FLOORS[k].max) continue;
          const params = { ...node.params, [k]: v };
          if (JSON.stringify(params) === JSON.stringify(node.params)) continue;
          const r = evalParams(params, nights, runs, shape, 1, geom);
          if (r.ok) cand.push(r);
        }
      }
    }
    if (!cand.length) break;
    // merge into frontier, Pareto-prune
    const all = [...frontier, ...cand];
    const kept = all.filter(x => !all.some(y => y !== x && dominates(y, x, nights)));
    frontier = kept.sort((a, b) => minPct(b, nights) - minPct(a, nights));
    pool = frontier.slice(0, beam);
    const best = frontier[0];
    console.error(`round ${round + 1}: frontier ${frontier.length}, best min ${minPct(best, nights).toFixed(1)}%  ${JSON.stringify(bestDeltas(best))}`);
  }
  // frontier admission: re-score the top candidates at `admit` seeds
  if (admit) {
    for (const node of frontier.slice(0, beam)) {
      const hi = evalParams(node.params, nights, admit, shape, 1, geom);
      node.admit = hi.nights;
    }
  }
  return frontier;
}
const bestDeltas = (node: EvalResult) => Object.fromEntries(Object.entries(node.params).filter(([, v]) => v));

function persistWinner(path: string, node: EvalResult, nights: readonly number[], geom: Geom, runs: number, shape: string) {
  if (!runs) throw new Error('--winner-out requires --admit so the persisted gate is explicit');
  const gateByNight = nights.map(night => {
    const text = planTextFor(night, geom, makeSearchKnobs(node.params));
    const result = modelGate(text, { night, runs, shape });
    return { ...result, outcomes: undefined };
  });
  const status = gateByNight.every(result => result.ok) ? 'PASS'
    : gateByNight.some(result => result.verdict === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'FAIL';
  if (status !== 'PASS')
    throw new Error(`best search candidate did not pass the persisted model gate (${status}); no winner was written`);
  const knobs = {
    night: nights[0], sweepSlotMs: geom.sweepSlotMs, readLatencyMs: 550,
    hallPulseMs: 130, pilotOffset: 10, maskMarginMs: 900,
    search: node.params,
  };
  const planOptions: { deviceSpacingMs?: number, sweepContactMs?: number } = {};
  if (geom.deviceSpacingMs != null) planOptions.deviceSpacingMs = geom.deviceSpacingMs;
  if (geom.sweepContactMs != null) planOptions.sweepContactMs = geom.sweepContactMs;
  const seeds = Array.from({ length: runs }, (_, index) => index + 1);
  const winner = {
    schema: 'winner-v1', strategy: 'minus7', knobs, planOptions,
    nights: [...nights], engineHash: 'model-sim-v1', seeds, replaySeeds: seeds.slice(0, 8),
    profile: 'fixture-hid-screencap',
    gate: { status, claimLevel: 'MODEL_ONLY', shape, runs,
      byNight: gateByNight.map(({ outcomes, ...result }) => result) },
  };
  if (existsSync(path)) throw new Error(`refusing to overwrite winner file ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canonicalJson(winner));
  console.log(`winner=${path} strategy=minus7 gate=${status} nights=${nights.join(',')}`);
}

function main() {
  const nights = arg('nights', '5,6,7').split(',').map(Number);
  const runs = +arg('runs', '400');
  const admit = +arg('admit', '0');
  const beam = +arg('beam', '12');
  const rounds = +arg('rounds', '6');
  const shape = arg('shape', 'correlated');
  const winnerOut = arg('winner-out', '');
  // --geom=slot:dev:con fixes the sweep geometry the timing knobs search on top
  // of (see geometrysearch.ts). Omitted = the shipped 120/133/100.
  const geomArg = arg('geom', '');
  const geom = geomArg
    ? (([s, d, c]) => ({ sweepSlotMs: s, deviceSpacingMs: d || null, sweepContactMs: c || null }))(geomArg.split(':').map(Number))
    : SHIPPED_GEOM;

  console.log(`plan-16 parameter search  nights ${nights}  screen ${runs} seeds  shape ${shape}` +
    (geomArg ? `  geom ${geomArg}` : ''));
  for (const sh of ['iid', 'correlated']) {
    const lad = baselineLadder(nights, runs, sh, geom);
    console.log(`  baseline (${sh}${geomArg ? ', this geom' : ', 803feb3'}): ${nights.map(n => `n${n} ${lad[n]}`).join('  ')}`);
  }
  console.log('');
  const frontier = searchParams({ nights, runs, beam, rounds, shape, admit, geom });
  console.log(`\nPareto frontier (${frontier.length} members), best-min first:`);
  for (const node of frontier.slice(0, 8)) {
    const line = nights.map(n => `n${n} ${node.nights[n].pct}%`).join('  ');
    console.log(`  min ${minPct(node, nights).toFixed(1)}%  ${line}   ${JSON.stringify(bestDeltas(node))}`);
    const admitted = node.admit;
    if (admitted)
      console.log(`      @${admit}: ${nights.map(n => `n${n} ${admitted[n].pct}%`).join('  ')}`);
  }
  if (winnerOut) persistWinner(winnerOut, frontier[0], nights, geom, admit, shape);
}

if (process.argv[1] && process.argv[1].endsWith('paramsearch.ts')) main();
