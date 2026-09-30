// Smoke + invariants for the Minus Toys jitter/clock-error evaluator. No phone.
//
// This does not re-assert the survival numbers (those are a [CALIBRATED]
// sensitivity analysis, not a contract). It pins the behaviours a search would
// rely on: the ensemble degrades from the deterministic gate as error grows, a
// re-anchor helps, and the model is reproducible under a seed.
import { evalEnsemble, basinWidth, DEFAULTS } from './minus-toys-jitter.mjs';

const check = (ok, msg) => { if (!ok) throw new Error(msg); };

// 1. Zero error reproduces the deterministic gate: every seed clears night 2.
{
  const { survived, n } = evalEnsemble({
    night: 2, seeds: 80,
    opts: { epochErrMs: 0, driftMsPerMin: 0, jitterMs: 0 },
  });
  check(survived === n,
    `zero-error ensemble lost ${n - survived}/${n} on night 2 -- it must match ` +
    'the deterministic gate (minus-toys-plan.mjs --gate is 200/200)');
}

// 2. A large one-time phase error collapses it -- the schedule has no slack.
{
  const { survived, n } = evalEnsemble({
    night: 2, seeds: 80,
    opts: { epochErrMs: 900, driftMsPerMin: 0, jitterMs: 0 },
  });
  check(survived < n / 2,
    `a +/-900 ms epoch error still cleared ${survived}/${n}; the schedule was ` +
    'expected to have almost no phase tolerance');
}

// 3. The AM re-anchor removes accumulated drift, so it must help on a night
//    where drift (not the opening epoch) dominates. Night 3+ is drift-bound.
{
  const common = { night: 3, seeds: 150 };
  const none = evalEnsemble({ ...common, opts: { reanchor: 'none' } }).survived;
  const am = evalEnsemble({ ...common, opts: { reanchor: 'am' } }).survived;
  check(am > none,
    `AM re-anchor (${am}/150) did not beat T0-only (${none}/150) on night 3, ` +
    'where game-vs-wall drift is the dominant error');
}

// 4. The model is reproducible: same params -> byte-identical result.
{
  const a = evalEnsemble({ night: 2, seeds: 100, opts: { reanchor: 'am' } });
  const b = evalEnsemble({ night: 2, seeds: 100, opts: { reanchor: 'am' } });
  check(a.survived === b.survived &&
        JSON.stringify(a.deaths) === JSON.stringify(b.deaths),
    'evalEnsemble is not reproducible under a fixed seed set');
}

// 5. The phase basin is finite (the schedule is not phase-robust) and it
//    narrows as per-press jitter grows.
{
  const wide = basinWidth({ night: 2, seeds: 60, max: 264, step: 66,
                            opts: { jitterMs: 10 } });
  const tight = basinWidth({ night: 2, seeds: 60, max: 264, step: 66,
                             opts: { jitterMs: 45 } });
  check(Number.isFinite(wide.width) && wide.width <= 528,
    `the phase basin is not finite/small: ${wide.width} ms`);
  check(tight.width <= wide.width,
    `more jitter widened the basin (${wide.width} -> ${tight.width} ms)`);
}

check(DEFAULTS.driftMsPerMin < 0 && DEFAULTS.epochErrMs > 0 && DEFAULTS.jitterMs > 0,
  'the calibrated defaults were zeroed out -- the evaluator would report the ' +
  'deterministic gate');

console.log('minus toys jitter evaluator: zero-error matches the gate, a large ' +
  'phase error collapses it, AM re-anchor helps on drift-bound nights, the ' +
  'model replays under a seed, and the phase basin is finite and jitter-sensitive');
