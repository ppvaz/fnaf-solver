// Causal estimator for the 2 Hz winding-tick clock described in Plan 21.
//
// This module consumes detector timestamps in the receiver's monotonic clock.
// It can estimate period and phase before latency calibration exists, but it
// explicitly refuses to call that phase "game phase" until an independently
// paired reference has measured the A2DP delay.

export const PHASE_STATES = Object.freeze({
  UNLOCKED: 'UNLOCKED',
  ACQUIRING: 'ACQUIRING',
  LOCKED: 'LOCKED',
  STALE: 'STALE',
});

const finite = value => Number.isFinite(value);
const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Paired calibration of a known game/reference timestamp and BT receipt time.
 * The reference may be a synchronized visual event or a controlled run; a
 * detector timestamp alone cannot populate this class.
 */
export class LatencyCalibrator {
  constructor({ minSamples = 3, maxSamples = 32 } = {}) {
    if (!Number.isInteger(minSamples) || minSamples < 1 ||
        !Number.isInteger(maxSamples) || maxSamples < minSamples)
      throw new RangeError('invalid latency calibration sample limits');
    this.minSamples = minSamples;
    this.maxSamples = maxSamples;
    this.samples = [];
  }

  addPair(referenceMs, receivedMs) {
    if (!finite(referenceMs) || !finite(receivedMs))
      throw new TypeError('latency calibration timestamps must be finite');
    this.samples.push(receivedMs - referenceMs);
    if (this.samples.length > this.maxSamples) this.samples.shift();
    return this.status();
  }

  status() {
    const latencyMs = median(this.samples);
    if (latencyMs === null) {
      return { calibrated: false, sampleCount: 0, latencyMs: null,
               uncertaintyMs: Infinity, minMs: null, maxMs: null };
    }
    const deviations = this.samples.map(value => Math.abs(value - latencyMs));
    const mad = median(deviations) ?? 0;
    const minMs = Math.min(...this.samples);
    const maxMs = Math.max(...this.samples);
    // Keep the measured interval visible. MAD is useful for a stable center,
    // while half-range prevents a small sample from claiming false precision.
    const uncertaintyMs = Math.max(3 * mad, (maxMs - minMs) / 2);
    return {
      calibrated: this.samples.length >= this.minSamples,
      sampleCount: this.samples.length,
      latencyMs,
      uncertaintyMs,
      minMs,
      maxMs,
    };
  }
}

export class PhaseClockEstimator {
  constructor({ tickPeriodMs = 500, minLockTicks = 6, windowTicks = 12,
                minConfidence = 0.5, maxResidualMs = tickPeriodMs * 0.2,
                staleAfterMs = tickPeriodMs * 3, latencyCalibration = null } = {}) {
    if (!finite(tickPeriodMs) || tickPeriodMs <= 0 ||
        !Number.isInteger(minLockTicks) || minLockTicks < 2 ||
        !Number.isInteger(windowTicks) || windowTicks < minLockTicks ||
        !finite(minConfidence) || minConfidence < 0 || minConfidence > 1 ||
        !finite(maxResidualMs) || maxResidualMs <= 0 ||
        !finite(staleAfterMs) || staleAfterMs <= 0)
      throw new RangeError('invalid phase estimator options');
    this.tickPeriodMs = tickPeriodMs;
    this.minLockTicks = minLockTicks;
    this.windowTicks = windowTicks;
    this.minConfidence = minConfidence;
    this.maxResidualMs = maxResidualMs;
    this.staleAfterMs = staleAfterMs;
    this.latencyCalibration = latencyCalibration;
    this.samples = [];
    this.nextIndex = 0;
    this.lastReceivedMs = null;
    /** @type {string} */ this.state = PHASE_STATES.UNLOCKED;
    this.gridParity = null;
    this.paritySource = null;
  }

  _latency() {
    const calibration = this.latencyCalibration?.status?.();
    return calibration?.calibrated ? calibration : {
      calibrated: false, latencyMs: 0, uncertaintyMs: Infinity,
    };
  }

  observe(receivedMs, { confidence = 1 } = {}) {
    if (!finite(receivedMs) || !finite(confidence))
      throw new TypeError('phase observations must be finite');
    if (confidence < this.minConfidence) return this.status(receivedMs);

    if (this.lastReceivedMs !== null &&
        receivedMs - this.lastReceivedMs > this.staleAfterMs) {
      this.samples = [];
      this.nextIndex = 0;
      this.state = PHASE_STATES.STALE;
    }

    let index = this.nextIndex;
    if (this.samples.length) {
      const previous = this.samples[this.samples.length - 1].receivedMs;
      const gap = receivedMs - previous;
      // Preserve the phase through an occasional missed detector peak while
      // refusing a zero/negative interval as a new clock observation.
      index = this.nextIndex + Math.max(1, Math.round(gap / this.tickPeriodMs));
    }
    this.samples.push({ receivedMs, index, confidence });
    if (this.samples.length > this.windowTicks) this.samples.shift();
    this.nextIndex = index;
    this.lastReceivedMs = receivedMs;
    this._updateState();
    return this.status(receivedMs);
  }

  _fit() {
    if (this.samples.length < 2) return null;
    const latency = this._latency();
    const meanX = this.samples.reduce((sum, sample) => sum + sample.index, 0) /
      this.samples.length;
    const meanY = this.samples.reduce((sum, sample) =>
      sum + sample.receivedMs - latency.latencyMs, 0) / this.samples.length;
    let xx = 0, xy = 0;
    for (const sample of this.samples) {
      const x = sample.index - meanX;
      const y = sample.receivedMs - latency.latencyMs - meanY;
      xx += x * x;
      xy += x * y;
    }
    if (!xx) return null;
    const periodMs = xy / xx;
    const phaseMs = meanY - periodMs * meanX;
    const residuals = this.samples.map(sample =>
      sample.receivedMs - latency.latencyMs - (phaseMs + periodMs * sample.index));
    const rmsMs = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) /
      residuals.length);
    const maxResidual = Math.max(...residuals.map(Math.abs));
    return { phaseMs, periodMs, rmsMs, maxResidualMs: maxResidual,
             latencyUncertaintyMs: latency.uncertaintyMs,
             latencyCalibrated: latency.calibrated };
  }

  _updateState() {
    if (this.samples.length === 0) {
      this.state = PHASE_STATES.UNLOCKED;
      return;
    }
    const fit = this._fit();
    this.state = this.samples.length >= this.minLockTicks && fit &&
      Math.abs(fit.periodMs - this.tickPeriodMs) <= this.maxResidualMs &&
      fit.maxResidualMs <= this.maxResidualMs
      ? PHASE_STATES.LOCKED : PHASE_STATES.ACQUIRING;
  }

  setParity(parity, source = 'external-reference') {
    if (parity !== 0 && parity !== 1)
      throw new RangeError('grid parity must be 0 or 1');
    this.gridParity = parity;
    this.paritySource = source;
    return this.status(this.lastReceivedMs ?? 0);
  }

  status(nowMs = this.lastReceivedMs ?? 0) {
    if (!finite(nowMs)) throw new TypeError('phase status time must be finite');
    if (this.lastReceivedMs !== null && nowMs - this.lastReceivedMs > this.staleAfterMs)
      this.state = PHASE_STATES.STALE;
    const fit = this._fit();
    const latency = this._latency();
    const phaseModuloMs = fit
      ? ((fit.phaseMs % this.tickPeriodMs) + this.tickPeriodMs) % this.tickPeriodMs
      : null;
    const uncertaintyMs = fit
      ? Math.max(fit.rmsMs, fit.latencyUncertaintyMs)
      : Infinity;
    return {
      state: this.state,
      locked: this.state === PHASE_STATES.LOCKED,
      phaseMs: fit?.phaseMs ?? null,
      phaseModuloMs,
      periodMs: fit?.periodMs ?? null,
      uncertaintyMs,
      driftPpm: fit ? (fit.periodMs / this.tickPeriodMs - 1) * 1e6 : null,
      gridParity: this.gridParity,
      paritySource: this.paritySource,
      latencyCalibrated: latency.calibrated,
      gamePhaseKnown: this.state === PHASE_STATES.LOCKED && latency.calibrated,
      lastReceivedMs: this.lastReceivedMs,
      sampleCount: this.samples.length,
    };
  }
}

/**
 * Adapter from the fact-link envelope to the winding-tick estimator.  The
 * transport may carry many observations; only an OBSERVED boolean
 * `wind-tick` fact is allowed to advance this clock. UNKNOWN, another fact
 * type, duplicate timestamps, and non-boolean values are visible refusals,
 * not clock samples.
 */
export class WindTickFactAdapter {
  constructor(estimator, { type = 'wind-tick' } = {}) {
    if (!estimator || typeof estimator.observe !== 'function' ||
        typeof estimator.status !== 'function')
      throw new TypeError('WindTickFactAdapter needs a PhaseClockEstimator');
    if (typeof type !== 'string' || !type.length)
      throw new TypeError('wind-tick fact type must be a non-empty string');
    this.estimator = estimator;
    this.type = type;
    this.lastReceivedMs = null;
    this.accepted = 0;
    this.ignored = 0;
    this.rejected = 0;
  }

  observe(fact) {
    if (!fact || typeof fact !== 'object') {
      this.rejected++;
      throw new TypeError('wind-tick fact must be an object');
    }
    if (fact.type !== this.type) {
      this.ignored++;
      return this.result(false, 'fact-type-not-wind-tick');
    }
    if (fact.state !== 'OBSERVED' || fact.value !== true) {
      this.ignored++;
      return this.result(false, fact.state === 'UNKNOWN'
        ? 'fact-unknown' : 'wind-tick-value-not-true');
    }
    if (!finite(fact.receivedAtMs) || fact.receivedAtMs < 0) {
      this.rejected++;
      throw new TypeError('wind-tick receivedAtMs must be finite and non-negative');
    }
    if (this.lastReceivedMs !== null && fact.receivedAtMs <= this.lastReceivedMs) {
      this.rejected++;
      throw new RangeError('wind-tick receipt time must increase');
    }
    if (!finite(fact.confidence) || fact.confidence < 0 || fact.confidence > 1) {
      this.rejected++;
      throw new RangeError('wind-tick confidence must be between 0 and 1');
    }
    this.lastReceivedMs = fact.receivedAtMs;
    this.accepted++;
    return this.result(true, null,
      this.estimator.observe(fact.receivedAtMs, { confidence: fact.confidence }));
  }

  result(accepted, reason, estimatorStatus = this.estimator.status(
    this.lastReceivedMs ?? 0)) {
    return {
      schema: 'wind-tick-adapter-v1', accepted, reason,
      estimator: estimatorStatus,
      acceptedCount: this.accepted,
      ignoredCount: this.ignored,
      rejectedCount: this.rejected,
      lastReceivedMs: this.lastReceivedMs,
    };
  }

  status(nowMs = this.lastReceivedMs ?? 0) {
    return this.result(false, null, this.estimator.status(nowMs));
  }
}

// Adapt the estimator's calibrated reference-clock fit to the frame provider
// consumed by VentThreatReactive. `frameOriginMs` is the independently paired
// timestamp of game frame 0 (or an equivalent stable frame origin); it is not
// inferred from Bluetooth receipt time. Until latency and one-second parity
// are both calibrated, nextBoundaryFrame() returns Infinity and callers must
// use a conservative fallback.
export class EstimatedPhaseClock {
  constructor(estimator, { frameOriginMs = 0, frameRate = 60 } = {}) {
    if (!estimator || typeof estimator.status !== 'function')
      throw new TypeError('EstimatedPhaseClock needs a PhaseClockEstimator');
    if (!finite(frameOriginMs) || !finite(frameRate) || frameRate <= 0)
      throw new RangeError('invalid frame-clock origin or rate');
    this.estimator = estimator;
    this.frameOriginMs = frameOriginMs;
    this.frameRate = frameRate;
    this.kind = 'estimated-a2dp-phase';
  }

  _status(frame = null) {
    const nowMs = frame === null ? undefined
      : this.frameOriginMs + frame * 1000 / this.frameRate;
    return this.estimator.status(nowMs);
  }

  get periodFrames() {
    const status = this._status();
    return (status.periodMs ?? this.estimator.tickPeriodMs * 2) *
      this.frameRate / 1000 * 2;
  }

  get uncertaintyFrames() {
    const status = this._status();
    return finite(status.uncertaintyMs)
      ? Math.ceil(status.uncertaintyMs * this.frameRate / 1000) : Infinity;
  }

  nextBoundaryFrame(frame) {
    if (!Number.isFinite(frame)) return Infinity;
    const status = this._status(frame);
    if (!status.gamePhaseKnown || status.gridParity === null ||
        !finite(status.phaseMs) || !finite(status.periodMs)) return Infinity;
    const nowMs = this.frameOriginMs + frame * 1000 / this.frameRate;
    let index = Math.ceil((nowMs - status.phaseMs) / status.periodMs - 1e-9);
    while (((index % 2) + 2) % 2 !== status.gridParity) index++;
    const boundaryFrame = Math.ceil(
      (status.phaseMs + index * status.periodMs - this.frameOriginMs) *
      this.frameRate / 1000 - 1e-9);
    return Math.max(frame, boundaryFrame);
  }
}
