// Small, dependency-free statistical primitives shared by simulator/device
// gates. Rates are proportions in [0, 1]; callers decide whether a result is
// a release gate or an exploratory report.

const DEFAULT_Z = 1.959963984540054;

function finiteNumber(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function countInputs(successes, trials) {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) ||
      trials <= 0 || successes < 0 || successes > trials)
    throw new RangeError('successes/trials must be integers with 0 <= successes <= trials and trials > 0');
}

function zInput(z) {
  finiteNumber('z', z);
  if (z <= 0) throw new RangeError('z must be greater than zero');
  return z;
}

function halfWidthForRate(rate, trials, z) {
  const zz = z * z;
  const d = 1 + zz / trials;
  return z * Math.sqrt(rate * (1 - rate) / trials + zz / (4 * trials * trials)) / d;
}

// Wilson score interval for a binomial proportion. It behaves sensibly at
// both 0/n and n/n, unlike the symmetric normal interval.
export function wilsonInterval(successes, trials, z = DEFAULT_Z) {
  countInputs(successes, trials);
  z = zInput(z);
  const rate = successes / trials;
  const zz = z * z;
  const d = 1 + zz / trials;
  const center = (rate + zz / (2 * trials)) / d;
  const halfWidth = halfWidthForRate(rate, trials, z);
  return {
    successes, trials, rate,
    low: Math.max(0, center - halfWidth),
    high: Math.min(1, center + halfWidth),
    halfWidth,
    z,
  };
}

// Smallest continuous-n equivalent for which a Wilson interval around the
// requested rate is no wider than halfWidth. This is deliberately a planning
// estimate: a later observed integer count still gets its own exact interval.
// Binary search makes the boundary explicit and avoids the normal-interval
// shortcut becoming over-optimistic near rates 0 and 1.
export function requiredN(rate, halfWidth, z = DEFAULT_Z) {
  finiteNumber('rate', rate);
  finiteNumber('halfWidth', halfWidth);
  if (rate < 0 || rate > 1) throw new RangeError('rate must be in [0, 1]');
  if (halfWidth <= 0 || halfWidth >= 1)
    throw new RangeError('halfWidth must be in (0, 1)');
  z = zInput(z);

  let lo = 1, hi = 1;
  while (halfWidthForRate(rate, hi, z) > halfWidth) {
    hi *= 2;
    if (hi > 1_000_000_000) throw new RangeError('requested halfWidth requires more than 1e9 observations');
  }
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (halfWidthForRate(rate, mid, z) <= halfWidth) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// Two-sided large-sample z test for two independent proportions. This is an
// inferential report, not a gate: callers must choose the practical contract
// and the acceptable error rate separately.
export function twoProportionTest(successesA, trialsA, successesB, trialsB,
                                  z = DEFAULT_Z) {
  countInputs(successesA, trialsA);
  countInputs(successesB, trialsB);
  z = zInput(z);
  const rateA = successesA / trialsA;
  const rateB = successesB / trialsB;
  const pooled = (successesA + successesB) / (trialsA + trialsB);
  const variance = pooled * (1 - pooled) * (1 / trialsA + 1 / trialsB);
  const difference = rateA - rateB;
  const statistic = variance === 0 ? (difference === 0 ? 0 : (difference > 0 ? Infinity : -Infinity))
    : difference / Math.sqrt(variance);
  const pValue = normalTwoSidedP(statistic);
  return { successesA, trialsA, successesB, trialsB, rateA, rateB,
    difference, pooled, z: statistic, pValue, criticalZ: z };
}

// Abramowitz-Stegun 7.1.26. The error is below 1.5e-7, plenty for a report
// and keeps the helper usable on Node versions without Math.erf.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) +
    1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

function normalTwoSidedP(z) {
  if (z === Infinity || z === -Infinity) return 0;
  return 1 - erf(Math.abs(z) / Math.SQRT2);
}

// A contract is accepted only when the entire interval clears the bar, and
// rejected only when the entire interval is below it. A straddling interval
// is explicitly inconclusive, never a hidden pass or fail.
export function contractVerdict(successes, trials, bar, z = DEFAULT_Z) {
  finiteNumber('bar', bar);
  if (bar < 0 || bar > 1) throw new RangeError('bar must be in [0, 1]');
  const interval = wilsonInterval(successes, trials, z);
  const status = interval.low >= bar ? 'PASS'
    : interval.high < bar ? 'FAIL' : 'INCONCLUSIVE';
  return { ...interval, bar, status, ok: status === 'PASS' };
}

export function formatRate(successes, trials, { digits = 1, label = 'rate', z = DEFAULT_Z } = {}) {
  const r = wilsonInterval(successes, trials, z);
  const pct = n => (100 * n).toFixed(digits);
  return `${label} ${pct(r.rate)}% [${pct(r.low)}%, ${pct(r.high)}%] n=${trials}`;
}

export { DEFAULT_Z };
