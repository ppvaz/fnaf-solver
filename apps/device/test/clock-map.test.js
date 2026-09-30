/** Clock-map fitting conformance. All anchors are synthetic; nothing here
 * measures a handset, and the fit must stay interval arithmetic rather than
 * statistics so a bound, once emitted, is derivable from the samples. */
import assert from 'node:assert/strict';
import { fitClockMap, mapClockInterval } from '@sixam/adapters';

const exact = (fromMs, toMs, count, spanMs) => Array.from({ length: count }, (_, index) => {
  const sourceMs = fromMs + Math.round(spanMs * index / (count - 1));
  return { sourceMs, targetBeforeMs: toMs(sourceMs), targetAfterMs: toMs(sourceMs) };
});
const base = { sourceClock: 'device-monotonic-ms', targetClock: 'host-monotonic-ms',
  sourceSession: 'boot-a', targetSession: 'host-a', id: 'map-fit', evidenceId: 'map-fit-evidence' };
const map = mapping => value => mapClockInterval({ clock: 'device-monotonic-ms', value }, {
  targetClock: 'host-monotonic-ms', targetSession: 'host-a', sourceSession: 'boot-a',
  uncertaintyMs: 0, mapping,
});

// Exact anchors pin the arithmetic: rate, offset and both error terms zero.
const identity = fitClockMap({ ...base, samples: exact(10000, s => s + 5000, 4, 30000) });
assert.equal(identity.schema, 'clock-map-v1');
assert.equal(identity.rate, 1);
assert.equal(identity.errorMs, 0);
assert.equal(identity.rateErrorPpm, 0);
assert.equal(identity.validFromMs, 10000);
assert.equal(identity.validUntilMs, 40000);
assert.equal(identity.sourceAtMs, 20000, 'anchor sits nearest the span midpoint (earliest on ties)');
assert.equal(identity.targetAtMs, 25000);
assert.deepEqual(map(identity)(30000), { clock: 'host-monotonic-ms', earliestMs: 35000,
  latestMs: 35000, uncertaintyMs: 0, mappingId: 'map-fit' });

// A drifting device clock fits its true ratio exactly when brackets are exact.
const drifting = fitClockMap({ ...base, samples: exact(0, s => 500 + s * 1.0002, 5, 20000) });
assert.ok(Math.abs(drifting.rate - 1.0002) < 1e-9, `rate ${drifting.rate}`);
assert.equal(drifting.errorMs, 0);
assert.equal(drifting.rateErrorPpm, 0);

// Bracketed anchors: every pairwise interval must contain the true rate, so
// the intersection bound stays inside the budget and the mapped interval
// still brackets the truth the samples were generated from.
const truth = value => 2000 + value * 1.00005;
const bracketed = exact(50000, s => s, 6, 30000).map(sample => {
  const center = truth(sample.sourceMs);
  return { ...sample, targetBeforeMs: center - 10, targetAfterMs: center + 10 };
});
const fitted = fitClockMap({ ...base, samples: bracketed, sourceUncertaintyMs: 6 });
assert.ok(fitted.rate > 0.999 && fitted.rate < 1.001, `rate ${fitted.rate}`);
assert.ok(fitted.rateErrorPpm > 0 && fitted.rateErrorPpm <= 2500, `ppm ${fitted.rateErrorPpm}`);
assert.ok(fitted.errorMs > 0 && fitted.errorMs <= 100, `errorMs ${fitted.errorMs}`);
for (const at of [fitted.validFromMs + 7, fitted.sourceAtMs, fitted.validUntilMs - 7]) {
  const interval = mapClockInterval({ clock: 'device-monotonic-ms', value: at }, {
    targetClock: 'host-monotonic-ms', targetSession: 'host-a', sourceSession: 'boot-a',
    uncertaintyMs: 6, mapping: fitted });
  assert.ok(interval.earliestMs <= truth(at) && interval.latestMs >= truth(at),
    `mapped interval must bracket the truth at ${at}`);
}
// The validity window is the measured span: one step outside either end refuses.
assert.throws(() => map(fitted)(fitted.validFromMs - 1), /validity/);
assert.throws(() => map(fitted)(fitted.validUntilMs + 1), /validity/);

// Refusals: closed vocabulary, ordered arrival, mutual consistency, budgets.
assert.throws(() => fitClockMap({ ...base, samples: exact(0, s => s, 3, 2000) }), /at least 4/);
assert.throws(() => fitClockMap({ ...base, samples: exact(0, s => s, 4, 3000) }), /span 3000ms/);
assert.equal(fitClockMap({ ...base, samples: exact(0, s => s, 4, 3000), minSpanMs: 2000 }).spanMs, 3000);
assert.throws(() => fitClockMap({ ...base, samples: exact(0, s => s, 4, 20000)
  .map((sample, index) => index === 2 ? { ...sample, sourceMs: exact(0, s => s, 4, 20000)[1].sourceMs } : sample) }),
  /did not advance/);
assert.throws(() => fitClockMap({ ...base, samples: [ ...exact(20000, s => s, 3, 10000),
  ...exact(0, s => s + 5, 3, 5000)] }), /did not advance/);
assert.throws(() => fitClockMap({ ...base, samples: exact(0, s => s, 5, 20000),
  sourceClock: 'host-monotonic-ms', sourceSession: 'host-a' }), /identical/);
assert.throws(() => fitClockMap({ ...base, samples: exact(0, s => s * 2, 5, 20000) }), /plausible/);
assert.throws(() => fitClockMap({ ...base, samples: exact(0, s => s, 5, 20000)
  .map((sample, index) => index === 1 ? { ...sample, targetBeforeMs: sample.targetBeforeMs + 2000,
    targetAfterMs: sample.targetAfterMs + 2000 } : sample) }), /mutually inconsistent/);
assert.throws(() => fitClockMap({ ...base, samples: bracketed, sourceUncertaintyMs: 6,
  maxRateErrorPpm: 10 }), /rate error/);
assert.throws(() => fitClockMap({ ...base, samples: bracketed, sourceUncertaintyMs: 6,
  maxErrorMs: 10 }), /offset error/);
assert.throws(() => fitClockMap({ ...base }), /invalid fit request/);

console.log('clock map: interval-arithmetic fit, budgets, and refusal gates pass');
