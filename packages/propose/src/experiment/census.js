/**
 * The pure half of a census over a policy family (experiment-spec-v2): the
 * cohort a spec pre-registers, expanded and refused below the seed floor; the
 * rate of every count, with a kernel Interval and the method that produced it;
 * and the decision, which tags each competing explanation `ruled-out` or
 * `surviving` from the observation the spec says separates them.
 *
 * What plays a night lives with the family's emitter (a tool, since propose
 * never reaches tools/); what is claimed from the counts lives here, so a gate
 * re-derives the decision with the same function the census wrote it with.
 */
import { interval } from '@sixam/kernel';
import { validateExperimentResultV2, validateExperimentSpecV2, validateRate } from '@sixam/kernel/contracts';
import { SEED_FLOOR, checkSeedFloor } from '@sixam/review/refusals';
import { expandSeedSet } from './seeds.js';

export { SEED_FLOOR };

// Acklam's rational approximation to the standard normal quantile (relative
// error below 1.2e-9), enough for an interval's z.
const A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02,
  -3.066479806614716e+01, 2.506628277459239e+00];
const B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01,
  -1.328068155288572e+01];
const C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00,
  4.374664141464968e+00, 2.938163982698783e+00];
const D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];

/** The standard normal quantile. @param {number} p in (0, 1) */
export function probit(p) {
  if (!(p > 0 && p < 1)) throw new RangeError(`probit needs 0 < p < 1, not ${p}`);
  const tail = q => (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
    ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q /
    (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
}

/** The Wilson score interval for successes of n at quantile z, clamped to hold the point. */
export function wilsonInterval(successes, n, z) {
  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denominator;
  return interval(Math.max(0, Math.min(p, centre - half)), Math.min(1, Math.max(p, centre + half)));
}

/**
 * A reported rate: successes of n with its Interval and method.
 *
 * - `exhaustive`: the count is over the whole population (`population === n`), so the rate is
 *   the population's own and its interval is the point, at confidence 1.
 * - `wilson`: the Wilson score interval at `confidence` (default 0.95).
 * - `wilson-bonferroni`: the same at a per-rate confidence of 1 - (1 - confidence) / comparisons,
 *   so `comparisons` rates taken jointly (a minimum over a band, say) hold together at `confidence`.
 * @param {string} name @param {number} successes @param {number} n
 * @param {{method?: 'wilson' | 'wilson-bonferroni' | 'exhaustive', confidence?: number, comparisons?: number, population?: number}} [options]
 */
export function rateOf(name, successes, n, { method = 'wilson', confidence = 0.95, comparisons = 1, population } = {}) {
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(successes) || successes < 0 || successes > n)
    throw new RangeError(`${name}: ${successes} of ${n} is not a count`);
  const rate = successes / n;
  if (method === 'exhaustive') {
    if (population !== n) throw new RangeError(`${name}: an exhaustive rate counts the whole population (${population ?? 'unnamed'}), not ${n}`);
    return validateRate({ name, successes, n, rate, interval: interval(rate, rate), method, confidence: 1 }, name);
  }
  if (!(confidence > 0 && confidence < 1)) throw new RangeError(`${name}: confidence must lie in (0, 1)`);
  if (method === 'wilson')
    return validateRate({ name, successes, n, rate, interval: wilsonInterval(successes, n, probit(1 - (1 - confidence) / 2)),
      method, confidence }, name);
  if (method === 'wilson-bonferroni') {
    if (!Number.isInteger(comparisons) || comparisons < 1) throw new RangeError(`${name}: comparisons is a positive integer`);
    const each = (1 - confidence) / comparisons;
    return validateRate({ name, successes, n, rate, interval: wilsonInterval(successes, n, probit(1 - each / 2)),
      method, confidence, comparisons }, name);
  }
  throw new RangeError(`${name}: unknown interval method ${method}`);
}

/**
 * The seeds of a spec's two blocks. They must be disjoint and lie in the
 * population; a census (not a diagnostic sweep) is refused on any block under
 * the seed floor, by Review's own `seed-floor` rule.
 * @param {any} spec an experiment-spec-v2
 * @returns {{development: number[], heldOut: number[]}}
 */
export function resolveCensusCohort(spec) {
  validateExperimentSpecV2(spec);
  const development = expandSeedSet(spec.cohort.development);
  const heldOut = expandSeedSet(spec.cohort.heldOut);
  const seen = new Set(development);
  const shared = heldOut.filter(seed => seen.has(seed));
  if (shared.length) throw new RangeError(`${spec.id}: the held-out block shares ${shared.length} seed(s) with the development block (first ${shared[0]})`);
  const size = spec.cohort.population.size;
  for (const [name, seeds] of [[spec.cohort.development.name, development], [spec.cohort.heldOut.name, heldOut]]) {
    const outside = seeds.find(seed => seed >= size);
    if (outside !== undefined) throw new RangeError(`${spec.id}: ${name} seed ${outside} lies outside the population 0..${size - 1}`);
    if (spec.purpose !== 'census') continue;
    const verdict = checkSeedFloor({ seeds: seeds.length, heldOut: spec.cohort.heldOut.name });
    if (verdict.refused) throw new RangeError(`${spec.id}: the ${name} block is refused: ${verdict.because}. ${verdict.remedy}`);
  }
  return { development, heldOut };
}

/** The measures a predicate reads. @param {any} predicate @returns {string[]} */
export function predicateMeasures(predicate) {
  if ('all' in predicate) return [...new Set(predicate.all.flatMap(predicateMeasures))];
  if ('any' in predicate) return [...new Set(predicate.any.flatMap(predicateMeasures))];
  if ('not' in predicate) return predicateMeasures(predicate.not);
  return [predicate.measure];
}

/**
 * Whether a predicate holds of the observed measures. A measure the census
 * did not observe as a number is refused, never read as zero.
 * @param {any} predicate @param {Record<string, number>} values
 * @returns {boolean}
 */
export function evaluatePredicate(predicate, values) {
  if ('all' in predicate) return predicate.all.every(item => evaluatePredicate(item, values));
  if ('any' in predicate) return predicate.any.some(item => evaluatePredicate(item, values));
  if ('not' in predicate) return !evaluatePredicate(predicate.not, values);
  const value = values[predicate.measure];
  if (!Number.isFinite(value)) throw new TypeError(`measure ${predicate.measure} was not observed as a number`);
  switch (predicate.op) {
    case 'eq': return value === predicate.value;
    case 'ne': return value !== predicate.value;
    case 'lt': return value < predicate.value;
    case 'le': return value <= predicate.value;
    case 'gt': return value > predicate.value;
    case 'ge': return value >= predicate.value;
    default: throw new TypeError(`unknown predicate op ${predicate.op}`);
  }
}

/**
 * The experiment-result-v2 a spec's observation decides: each explanation
 * `surviving` exactly when the observation it predicted holds on the deciding
 * block, with the values that decided it.
 * @param {any} spec an experiment-spec-v2
 * @param {{specSha256: string, observations: Record<string, number>, rates?: any[], stopped: {rule: string, reached: string},
 *   evidence?: Record<string, Record<string, unknown>>}} input
 */
export function decideExperiment(spec, { specSha256, observations, rates = [], stopped, evidence = {} }) {
  validateExperimentSpecV2(spec);
  const explanations = spec.explanations.map(item => {
    const holds = evaluatePredicate(item.predicts.when, observations);
    const values = Object.fromEntries(predicateMeasures(item.predicts.when).map(measure => [measure, observations[measure]]));
    return { id: item.id, status: holds ? 'surviving' : 'ruled-out',
      evidence: { holds, predicted: item.predicts.observation, when: item.predicts.when, values, ...(evidence[item.id] ?? {}) } };
  });
  return validateExperimentResultV2({
    schema: 'experiment-result-v2', specId: spec.id, specSha256, claimLevel: spec.claimLevel,
    observations: { block: spec.decidingQuery.block, values: { ...observations } },
    explanations, rates, stopped,
  }, spec);
}
