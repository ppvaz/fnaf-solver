/** Injected monotonic/logical clocks; scheduling never calls wall time directly. */
import { isList, isOneOf, isRecord } from '@sixam/kernel';
import { ClockPort } from '@sixam/kernel/time';

type MonotonicClock = 'host-monotonic-ms' | 'device-monotonic-ms';
const CLOCKS: readonly MonotonicClock[] = ['host-monotonic-ms', 'device-monotonic-ms'];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** clock-map-v1: a measured map from one session's clock to another's, valid only over its measured span. */
export interface ClockMap {
  readonly schema: 'clock-map-v1';
  readonly id: string;
  readonly evidenceId: string;
  readonly sourceClock: MonotonicClock;
  readonly targetClock: MonotonicClock;
  readonly sourceSession: string;
  readonly targetSession: string;
  readonly sourceAtMs: number;
  readonly targetAtMs: number;
  readonly rate: number;
  readonly errorMs: number;
  readonly rateErrorPpm: number;
  readonly validFromMs: number;
  readonly validUntilMs: number;
}

export class Clock extends ClockPort {
  declare name: string;
  declare read: () => number;
  constructor({ name, read }: { name: string, read: () => number }) {
    super();
    if (typeof name !== 'string' || typeof read !== 'function') throw new TypeError('clock needs a name and read function');
    this.name = name; this.read = read;
  }
  now() {
    const value = this.read();
    if (!Number.isFinite(value) || value < 0) throw new Error(`${this.name} returned an invalid time`);
    return { clock: this.name, value };
  }
}

/** Map a capture interval, not a receipt timestamp. No extrapolation across
 * validity windows or sensor restarts. Both domains use milliseconds; offset,
 * rate and their uncertainty come from an explicit calibration artifact.
 */
export function mapClockInterval(stamp: unknown, options: { targetClock?: unknown, targetSession?: unknown,
  sourceSession?: unknown, uncertaintyMs?: unknown, mapping?: unknown } = {}) {
  const { targetClock, targetSession, sourceSession, uncertaintyMs, mapping } = options;
  function fail(reason: string): never { throw new Error(`clock mapping: ${reason}`); }
  if (!isRecord(stamp) || !isOneOf(CLOCKS, stamp.clock) || !isOneOf(CLOCKS, targetClock) ||
      !finite(stamp.value) || stamp.value < 0 || !finite(uncertaintyMs) || uncertaintyMs < 0 ||
      typeof sourceSession !== 'string' || !sourceSession || typeof targetSession !== 'string' || !targetSession)
    fail('invalid clock, capture time or uncertainty');
  if (stamp.value - uncertaintyMs < 0 || !finite(stamp.value + uncertaintyMs)) fail('invalid capture interval');
  // Domain names alone do not identify a timebase: two Android boots can
  // both report device-monotonic-ms while referring to different instants.
  if (stamp.clock === targetClock && sourceSession === targetSession) return {
    clock: targetClock, earliestMs: stamp.value - uncertaintyMs,
    latestMs: stamp.value + uncertaintyMs, uncertaintyMs, mappingId: null,
  };
  if (!isRecord(mapping) || mapping.schema !== 'clock-map-v1' || typeof mapping.id !== 'string' || !mapping.id ||
      typeof mapping.evidenceId !== 'string' || !mapping.evidenceId ||
      mapping.sourceClock !== stamp.clock || mapping.targetClock !== targetClock ||
      mapping.sourceSession !== sourceSession || mapping.targetSession !== targetSession)
    fail('missing mapping or source-session mismatch');
  for (const field of ['sourceAtMs', 'targetAtMs', 'rate', 'errorMs', 'rateErrorPpm', 'validFromMs', 'validUntilMs'])
    if (!finite(mapping[field]) || (mapping[field] as number) < 0) fail(`invalid ${field}`);
  // Every field the map is read by is checked above.
  const map = mapping as unknown as ClockMap;
  if (map.rate <= 0 || map.validFromMs > map.sourceAtMs ||
      map.sourceAtMs > map.validUntilMs ||
      stamp.value - uncertaintyMs < map.validFromMs ||
      stamp.value + uncertaintyMs > map.validUntilMs)
    fail('outside calibrated validity interval');
  const delta = stamp.value - map.sourceAtMs;
  const value = map.targetAtMs + map.rate * delta;
  const error = map.errorMs + map.rate * uncertaintyMs
    + (Math.abs(delta) + uncertaintyMs) * map.rateErrorPpm / 1e6;
  if (!finite(value) || !finite(error) || !finite(value + error) || value - error < 0) fail('invalid mapped interval');
  return { clock: targetClock, earliestMs: value - error, latestMs: value + error,
    uncertaintyMs: error, mappingId: map.id };
}

/** Fit a measured clock-map-v1 from bracketed anchor samples. Each sample
 * reads the SOURCE clock once inside a TARGET-clock bracket
 * (`targetBeforeMs`/`targetAfterMs`), so the pair midpoint carries the true
 * simultaneous instant to within `uncertaintyMs`. Bounds are interval
 * arithmetic, not statistics: every pairwise slope interval must contain the
 * true rate, so the intersection bounds it and a sample whose bounds are
 * violated by the others fails the fit instead of averaging away. The
 * validity window is exactly the measured span; extrapolating beyond it is
 * refused by mapClockInterval by construction.
 * */
export function fitClockMap(input: {samples: readonly unknown[], sourceClock: string, targetClock: string, sourceSession: string, targetSession: string, id: string, evidenceId: string, sourceUncertaintyMs?: number, minSamples?: number, minSpanMs?: number, maxErrorMs?: number, maxRateErrorPpm?: number}) {
  function failFit(reason: string): never { throw new Error(`clock map fit: ${reason}`); }
  const { samples, sourceClock, targetClock, sourceSession, targetSession, id, evidenceId } = input;
  if (!isList(samples) || typeof id !== 'string' || !id || typeof evidenceId !== 'string' || !evidenceId ||
      !isOneOf(CLOCKS, sourceClock) || !isOneOf(CLOCKS, targetClock) ||
      typeof sourceSession !== 'string' || !sourceSession || typeof targetSession !== 'string' || !targetSession)
    failFit('invalid fit request');
  if (sourceClock === targetClock && sourceSession === targetSession) failFit('domains and sessions are identical');
  const sourceUncertaintyMs = input.sourceUncertaintyMs ?? 0;
  const minSamples = input.minSamples ?? 4;
  const minSpanMs = input.minSpanMs ?? 5000;
  const maxErrorMs = input.maxErrorMs ?? 100;
  const maxRateErrorPpm = input.maxRateErrorPpm ?? 2500;
  if (!(sourceUncertaintyMs >= 0) || !Number.isFinite(sourceUncertaintyMs)) failFit('invalid source uncertainty');
  if (samples.length < minSamples) failFit(`need at least ${minSamples} anchors`);
  const time = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) failFit('anchor times must be finite and non-negative');
    return value;
  };
  const anchors: { sourceMs: number, mid: number, uncertaintyMs: number }[] = [];
  for (const sample of samples) {
    const fields = isRecord(sample) ? sample : {};
    const sourceMs = time(fields.sourceMs), targetBeforeMs = time(fields.targetBeforeMs), targetAfterMs = time(fields.targetAfterMs);
    if (targetAfterMs < targetBeforeMs) failFit('target bracket is inverted');
    anchors.push({ sourceMs, mid: (targetBeforeMs + targetAfterMs) / 2,
      uncertaintyMs: (targetAfterMs - targetBeforeMs) / 2 });
  }
  // Arrival order, not sorted order: a device reboot resets the monotonic
  // clock and must refuse the fit even though sorting would hide it.
  for (let index = 1; index < anchors.length; index += 1)
    if (anchors[index].sourceMs <= anchors[index - 1].sourceMs) failFit('source clock did not advance (session change?)');
  const spanMs = anchors[anchors.length - 1].sourceMs - anchors[0].sourceMs;
  if (spanMs < minSpanMs) failFit(`span ${spanMs}ms is under the ${minSpanMs}ms minimum`);
  let rateLow = -Infinity, rateHigh = Infinity;
  for (let i = 0; i < anchors.length; i += 1) for (let j = i + 1; j < anchors.length; j += 1) {
    const denominator = anchors[j].sourceMs - sourceUncertaintyMs - (anchors[i].sourceMs + sourceUncertaintyMs);
    if (denominator <= 1) continue;
    const deltaMid = anchors[j].mid - anchors[i].mid;
    const deltaUnc = anchors[j].uncertaintyMs + anchors[i].uncertaintyMs;
    const slopeLow = (deltaMid - deltaUnc) /
      (denominator + 2 * sourceUncertaintyMs);
    const slopeHigh = (deltaMid + deltaUnc) / denominator;
    rateLow = Math.max(rateLow, slopeLow);
    rateHigh = Math.min(rateHigh, slopeHigh);
  }
  if (!Number.isFinite(rateLow) || !Number.isFinite(rateHigh)) failFit('no usable anchor pair; spread the samples');
  if (rateLow <= 0 || rateLow > rateHigh) failFit('anchors are mutually inconsistent');
  const rate = (rateLow + rateHigh) / 2;
  if (rate < 0.9 || rate > 1.1) failFit(`fitted rate ${rate} is outside a plausible clock ratio`);
  const rateErrorPpm = Math.ceil((rateHigh - rateLow) / 2 / rate * 1e6);
  if (rateErrorPpm > maxRateErrorPpm) failFit(`rate error ${rateErrorPpm}ppm exceeds the ${maxRateErrorPpm}ppm budget`);
  // Anchor at the sample nearest the span midpoint so the offset bound and
  // the consumer's distance-growing term stay small on both sides.
  const middle = anchors[0].sourceMs + spanMs / 2;
  let anchor = anchors[0];
  for (const candidate of anchors)
    if (Math.abs(candidate.sourceMs - middle) < Math.abs(anchor.sourceMs - middle)) anchor = candidate;
  let low = -Infinity, high = Infinity;
  for (const sample of anchors) {
    const distanceHigh = sample.sourceMs + sourceUncertaintyMs - anchor.sourceMs;
    const distanceLow = sample.sourceMs - sourceUncertaintyMs - anchor.sourceMs;
    // The true anchor instant lies in EVERY sample's back-projection, so the
    // offset bound is the intersection of them, not a union.
    const projectedLow = sample.mid - sample.uncertaintyMs -
      (distanceHigh > 0 ? rateHigh * distanceHigh : rateLow * distanceHigh);
    const projectedHigh = sample.mid + sample.uncertaintyMs -
      (distanceLow > 0 ? rateLow * distanceLow : rateHigh * distanceLow);
    low = Math.max(low, projectedLow);
    high = Math.min(high, projectedHigh);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high) || low > high)
    failFit('anchors are mutually inconsistent at the offset anchor');
  const targetAtMs = (low + high) / 2;
  const errorMs = Math.ceil((high - low) / 2);
  if (!Number.isFinite(targetAtMs) || targetAtMs - errorMs < 0) failFit('anchor offset is not finite');
  if (errorMs > maxErrorMs) failFit(`offset error ${errorMs}ms exceeds the ${maxErrorMs}ms budget`);
  return Object.freeze({ schema: 'clock-map-v1', id, evidenceId,
    sourceClock, targetClock, sourceSession, targetSession,
    sourceAtMs: anchor.sourceMs, targetAtMs, rate, errorMs, rateErrorPpm,
    validFromMs: anchors[0].sourceMs, validUntilMs: anchors[anchors.length - 1].sourceMs,
    sampleCount: anchors.length, spanMs });
}
