// Jitter / clock-error robustness evaluator for the Minus Toys device loop.
//
// The deterministic gate (`minus-toys-plan.ts --gate`) scores the loop with
// every press landing on its exact game frame: it says 200/200 on nights 2-7.
// The first device run (`n2-minustoys-0117`, 2026-08-28) died anyway -- a BB
// walk-in -> Foxy chain -- because the phone does not deliver the schedule on
// the game's clock. This tool replays the loop through a model of that error
// and reports what survives.
//
// The error model, per run:
//   delivered(t) = t + epoch0 + drift(t) + gauss(sigma)
//     epoch0  : one-time uniform +/- epochErrMs. Default 150 = half the 302 ms
//               epoch-latch bracket n2-minustoys-0117 reported.
//     drift(t): driftMsPerMin/60000 * (t - t_lastAnchor). Default -184 ms/min,
//               from that run's drift trace. The live runner re-anchors each
//               cycle to /proc/uptime, so drift does not compound WITHIN a
//               cycle -- but the game frame each press lands on still walks
//               away from the plan over the 420 s night, because /proc/uptime
//               is the phone's wall clock, not the game's.
//     gauss   : per-press N(0, sigma). Default sigma 29 ms => p95 ~ 57 ms, the
//               drift trace's per-anchor residual.
//               PROVENANCE CAVEAT (2026-09-05): these are driver mark pairs,
//               not matched request/app-dispatch IDs. Treat sigma as an
//               assumed sensitivity parameter, not measured dispatch jitter.
//   reanchor 'am': at each in-game hour edge (70 s -- verified from
//               n2-minustoys-0117: HUD-first 7550 ms, 1 AM 77550 ms), a live
//               clock read (Companion, ~3 ms) zeroes the accumulated drift.
//               A fresh +/- 17 ms read error remains (clocktrace.mjs
//               resolution). 'none' (default) = anchored to T0 only.
//
// [CALIBRATED] -- every parameter here is fit to ONE device run. Every number
// this tool prints is a SENSITIVITY ANALYSIS, not a measurement, until more
// device runs ground the drift and jitter model. It also inherits the engine's
// Golden-Freddy-interval and Toy-cam-stall model gaps (plans/02 sec.5). Read
// each figure as "in the model, under the calibrated ensemble".
import { pathToFileURL } from 'node:url';
import { replay, KNOBS0 } from './minus-toys-plan.ts';
import { scanEdge } from './basin-edge.ts';

const HOUR_MS = 70000;
const NIGHT_MS = 420000;

// --- seeded PRNG -----------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const DEFAULTS = {
  epochErrMs: 150,
  driftMsPerMin: -184,
  jitterMs: 29,
  reanchor: 'none',   // 'none' | 'am'
  amReadErrMs: 17,
  phaseMs: 0,          // extra deterministic global offset (basin sweep)
};

// Build the per-instruction shift function for one run. `shift(cycle, index,
// whenMs)` -> ms offset; feeds minus-toys-plan.ts's schedule()/replay().
export function makeShift(opts, rng) {
  const o = { ...DEFAULTS, ...opts };
  const uni = e => (rng() * 2 - 1) * e;
  const gauss = s => {
    let u = 0, v = 0;
    while (!u) u = rng();
    while (!v) v = rng();
    return s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  // Anchors: {at, epoch}. epoch is the residual alignment error known at that
  // anchor -- epoch0 at T0, a fresh small read error after each AM re-sync.
  const anchors = [{ at: 0, epoch: uni(o.epochErrMs) }];
  if (o.reanchor === 'am')
    for (let h = HOUR_MS; h < NIGHT_MS; h += HOUR_MS)
      anchors.push({ at: h, epoch: uni(o.amReadErrMs) });
  const driftPerMs = o.driftMsPerMin / 60000;
  return (_cycle, _index, whenMs) => {
    let a = anchors[0];
    for (const c of anchors) if (c.at <= whenMs) a = c;
    return o.phaseMs + a.epoch + driftPerMs * (whenMs - a.at) + gauss(o.jitterMs);
  };
}

const deathKey = sim => {
  if (!sim.death) return 'unknown';
  return (sim.bb.inside ? 'BBin/' : '') + sim.death.reason;
};

export function runOne(night, seed, opts, knobs) {
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const r = replay({ night, seed, shift: makeShift(opts, rng), knobs });
  // A run counts only if it survives AND the split armed -- a phase error can
  // leave the CAM 09 tap unregistered so `viewing` never disagrees with the
  // marker, which is a Minus-Toys failure even when the night is won.
  const key = r.sim.won
    ? (r.splitAt >= 0 ? null : 'won-but-no-split')
    : deathKey(r.sim);
  return { won: r.sim.won && r.splitAt >= 0, key };
}

// The fitness primitive a search calls: survival of `seeds` runs under `opts`.
export function evalEnsemble({ night, opts = {}, seeds = 400, knobs }) {
  let survived = 0;
  const deaths = {};
  for (let i = 0; i < seeds; i++) {
    const s = (i * 2654435761) >>> 0;
    const { won, key } = runOne(night, s, opts, knobs);
    if (won) survived++;
    else deaths[key] = (deaths[key] || 0) + 1;
  }
  return { survived, n: seeds, deaths };
}

// The phase basin: a fixed global phase offset is what an epoch/T0 misalignment
// or a steady game-vs-wall clock offset does to every press at once. This holds
// the epoch and drift terms at zero (a re-anchor removes them) but keeps
// per-press jitter, then sweeps that fixed offset and reports the contiguous
// band around 0 that still clears `threshold`, plus the survival curve. Width 0
// means jitter alone already sinks it -- no amount of phase alignment helps.
export function basinWidth({ night, opts = {}, seeds = 200, max = 560, step = 33,
                             threshold = 0.7, knobs }) {
  const base = { epochErrMs: 0, driftMsPerMin: 0, jitterMs: DEFAULTS.jitterMs,
                 reanchor: (opts as any).reanchor ?? 'none', ...opts };
  const rate = phaseMs => {
    const { survived, n } = evalEnsemble({ night, opts: { ...base, phaseMs }, seeds, knobs });
    return survived / n;
  };
  const offs = [0];
  for (let k = step; k <= max; k += step) offs.push(-k, k);
  const curve = offs.sort((a, b) => a - b).map(k => [k, rate(k)]);
  const at = k => (curve.find(([p]) => p === k) ?? [k, 0])[1];
  if (at(0) < threshold) return { early: 0, late: 0, width: 0, curve, resumesLate: null, resumesEarly: null };
  const late = scanEdge(k => at(k) >= threshold, { step, max });
  const early = scanEdge(k => at(-k) >= threshold, { step, max });
  // A band that clears again past the edge (basin-edge.ts) is not part of the
  // width, and is returned so a reader does not take the width as the budget.
  return { early: early.edge, late: late.edge, width: early.edge + late.edge, curve,
           cappedLate: late.capped, cappedEarly: early.capped,
           resumesLate: late.resumesAt, resumesEarly: early.resumesAt };
}

// --- CLI -----------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => {
    const v = process.argv.find(a => a.startsWith(`--${k}=`));
    return v === undefined ? d : v.slice(k.length + 3);
  };
  const nights = String(arg('nights', '2,3,4,5,7')).split(',').map(Number);
  const seeds = +arg('seeds', 400);
  const reanchor = arg('reanchor', 'none');
  // --reactive: price the VentThreatReactive layer (minus-toys-plan replay
  // knobs.reactiveBB) under the same ensemble, directly comparable to the
  // open-loop rows.
  const knobs = process.argv.includes('--reactive')
    ? { ...KNOBS0, reactiveBB: true } : undefined;
  const banner = () => {
    console.log('minus-toys-jitter -- MODEL, under the [CALIBRATED] ' +
      'n2-minustoys-0117 error ensemble. Sensitivity analysis, not a ' +
      'measurement. Inherits plans/02 sec.5 engine gaps.');
  };

  if (process.argv.includes('--basin')) {
    banner();
    console.log(`\nphase basin: fixed global offset + sigma ${DEFAULTS.jitterMs} ms ` +
      `per-press jitter (epoch/drift 0), >=70% survival, ${Math.min(seeds, 250)} seeds`);
    for (const night of nights) {
      const b = basinWidth({ night, opts: { reanchor }, seeds: Math.min(seeds, 250), knobs });
      const curve = b.curve.filter(([k]) => k % 132 === 0)
        .map(([k, r]) => `${k >= 0 ? '+' : ''}${k}:${(r * 100).toFixed(0)}%`).join('  ');
      const again = [b.resumesEarly !== null && `-${b.resumesEarly}`, b.resumesLate !== null && `+${b.resumesLate}`].filter(Boolean);
      console.log(`  night ${night}:  basin early -${b.early}${b.cappedEarly ? '+' : ''} ` +
        `late +${b.late}${b.cappedLate ? '+' : ''}  (width ${b.width} ms)` +
        (again.length ? `  BANDED: clears again at ${again.join(' and ')}` : ''));
      console.log(`           ${curve}`);
    }
    console.log('  width 0 => per-press jitter alone is below 70%; no fixed phase ' +
      'alignment recovers it. n2-minustoys-0117 reported a 302 ms epoch bracket alone.');
  } else if (process.argv.includes('--sweep-jitter')) {
    banner();
    const night = nights[0] ?? 2;
    console.log(`\npure per-press jitter (epoch 0, drift 0), night ${night}, ${seeds} seeds`);
    let crossed = null;
    for (const j of [0, 10, 15, 20, 25, 29, 35, 45, 60, 80]) {
      const { survived, n } = evalEnsemble({
        night, seeds, knobs, opts: { epochErrMs: 0, driftMsPerMin: 0, jitterMs: j, reanchor },
      });
      const pct = (100 * survived / n).toFixed(1);
      if (crossed === null && survived / n < 0.7) crossed = j;
      console.log(`  sigma ${String(j).padStart(3)} ms  =>  ${String(survived).padStart(4)}/${n}  (${pct}%)`);
    }
    console.log(`  night ${night} falls below 70% at sigma ~ ${crossed ?? '>80'} ms ` +
      `(the measured device p95 57 ms is sigma ~29).`);
  } else {
    banner();
    console.log(`\nsurvival under the ensemble, ${seeds} seeds, reanchor=${reanchor}`);
    for (const night of nights) {
      const { survived, n, deaths } = evalEnsemble({ night, seeds, knobs, opts: { reanchor } });
      const top = Object.entries(deaths).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([k, v]) => `${k}:${v}`).join('  ');
      console.log(`  night ${night}:  ${String(survived).padStart(4)}/${n}  ` +
        `(${(100 * survived / n).toFixed(1)}%)   ${top}`);
    }
  }
}
