// Non-invasive seed recovery helpers for the stock Android APK.
//
// These helpers never claim that a seed inferred from observations is true.
// They return the surviving hypotheses and the evidence used to obtain them.
// Exact seed/state telemetry requires instrumentation inside the game, which
// is intentionally outside this module's authority boundary.
import { isList, isRecord } from '@sixam/kernel';
import { Sim } from './plant-model.ts';
import type { SimEvent } from './plant-model.ts';
import type { SimOptions } from './plant-options.ts';
import {
  RNG_INCREMENT, RNG_MASK, RNG_MODULUS, RNG_MULTIPLIER,
} from './rng.ts';

export const SEED_RECOVERY_SCHEMA = 'rng-seed-recovery-v1';
export const SEED_SPACE = RNG_MODULUS;

/** An observation a caller describes: every field is read, and checked where it is read. */
type Observation = Readonly<Record<string, unknown>>;

function integer(value: unknown, label: string, { min = null, max = null }: { min?: number | null, max?: number | null } = {}) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || (min !== null && value < min) ||
      (max !== null && value > max))
    throw new TypeError(`${label} must be an integer${min === null ? '' : ` >= ${min}`}` +
      `${max === null ? '' : ` <= ${max}`}`);
  return value;
}

function seed(value: unknown, label = 'seed') {
  return integer(value, label, { min: 0, max: RNG_MASK });
}

function timeMs(value: unknown, label: string) {
  return integer(value, label, { min: 0 });
}

/** Return the stock runtime's 16-bit seed for a device epoch millisecond. */
export function seedFromDeviceTimeMs(value: unknown) {
  const ms = timeMs(value, 'device time');
  return ms % SEED_SPACE;
}

interface TimeWindowOptions {
  readonly startMs?: unknown;
  readonly endMs?: unknown;
  readonly centerMs?: unknown;
  readonly halfWidthMs?: unknown;
}

function timeWindow(options: TimeWindowOptions = {}) {
  const { startMs, endMs, centerMs, halfWidthMs } = options;
  if (startMs !== undefined || endMs !== undefined) {
    if (startMs === undefined || endMs === undefined)
      throw new TypeError('a time window needs both startMs and endMs');
    const start = timeMs(startMs, 'startMs');
    const end = timeMs(endMs, 'endMs');
    if (end < start) throw new RangeError('endMs must be >= startMs');
    return { startMs: start, endMs: end };
  }
  if (centerMs === undefined) throw new TypeError('time window needs startMs/endMs or centerMs');
  const center = timeMs(centerMs, 'centerMs');
  const halfWidth = halfWidthMs === undefined ? 0 : integer(halfWidthMs, 'halfWidthMs', { min: 0 });
  if (center - halfWidth < 0)
    throw new RangeError('centerMs - halfWidthMs must not be negative');
  return { startMs: center - halfWidth, endMs: center + halfWidth };
}

/**
 * Enumerate distinct 16-bit seeds covered by an inclusive device-time window.
 * A window wider than one RNG period returns the complete seed space without
 * doing unbounded work.
 */
export function seedCandidatesFromTimeWindow(options: TimeWindowOptions = {}) {
  const { startMs, endMs } = timeWindow(options);
  const span = endMs - startMs + 1;
  const count = Math.min(span, SEED_SPACE);
  const seen = new Uint8Array(SEED_SPACE);
  const candidates: { seed: number, timestampMs: number }[] = [];
  for (let offset = 0; offset < count; offset++) {
    const timestampMs = startMs + offset;
    const value = seedFromDeviceTimeMs(timestampMs);
    if (seen[value]) continue;
    seen[value] = 1;
    candidates.push({ seed: value, timestampMs });
  }
  return Object.freeze({
    schema: SEED_RECOVERY_SCHEMA,
    method: 'device-time-window',
    startMs,
    endMs,
    spanMs: span,
    complete: candidates.length === SEED_SPACE,
    candidates: Object.freeze(candidates),
  });
}

/**
 * Convert a host epoch marker to a device-time seed window using one clock
 * sample returned by AdbDeviceBridge.clockSample(). `markerUncertaintyMs`
 * covers the uncertainty in identifying the game's actual seed-init moment.
 */
export function seedCandidatesFromHostMarker(options: { hostMarkerMs?: unknown, clockSample?: unknown, markerUncertaintyMs?: unknown } = {}) {
  const { hostMarkerMs, clockSample, markerUncertaintyMs = 0 } = options;
  const marker = timeMs(hostMarkerMs, 'hostMarkerMs');
  if (!isRecord(clockSample) || clockSample.status !== 'READY')
    throw new TypeError('clockSample must be a READY device clock sample');
  const offsetMs = clockSample.offsetMs;
  if (typeof offsetMs !== 'number' || !Number.isFinite(offsetMs))
    throw new TypeError('clockSample.offsetMs must be finite');
  const clockUncertaintyMs = integer(clockSample.uncertaintyMs, 'clockSample.uncertaintyMs', { min: 0 });
  const markerUncertainty = integer(markerUncertaintyMs, 'markerUncertaintyMs', { min: 0 });
  const estimatedDeviceMs = Math.round(marker + offsetMs);
  const halfWidthMs = clockUncertaintyMs + markerUncertainty + 1;
  return Object.freeze({
    ...seedCandidatesFromTimeWindow({ centerMs: estimatedDeviceMs, halfWidthMs }),
    method: 'host-marker-window', hostMarkerMs: marker, estimatedDeviceMs,
    uncertaintyMs: halfWidthMs,
  });
}

/** Normalize a seed list while preserving first-seen order. */
export function normalizeSeedCandidates(values: unknown, label = 'candidates') {
  if (!isList(values)) throw new TypeError(`${label} must be an array`);
  const seen = new Uint8Array(SEED_SPACE);
  const result: number[] = [];
  for (const [index, value] of values.entries()) {
    const current = seed(isRecord(value) ? value.seed : value, `${label}[${index}]`);
    if (seen[current]) continue;
    seen[current] = 1;
    result.push(current);
  }
  return result;
}

/** Advance one state, matching CRun.random's 16-bit LCG. */
export function nextRngState(state: unknown) {
  return (seed(state) * RNG_MULTIPLIER + RNG_INCREMENT) & RNG_MASK;
}

/** Return the source Random(bound) result and the post-draw state. */
export function randomDraw(state: unknown, bound: unknown) {
  seed(state, 'state');
  const range = integer(bound, 'bound', { min: 1 });
  const next = nextRngState(state);
  return { state: next, result: Math.floor(next * range / RNG_MODULUS) };
}

function relationMatches(result: number, observation: Observation) {
  const relation = observation.relation ?? '<';
  const value = observation.value ?? observation.threshold;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError('roll observation needs a non-negative integer value/threshold');
  if (relation === '<') return result < value;
  if (relation === '<=') return result <= value;
  if (relation === '>') return result > value;
  if (relation === '>=') return result >= value;
  if (relation === '==') return result === value;
  if (relation === '!=') return result !== value;
  throw new TypeError(`unsupported roll relation: ${relation}`);
}

function matchesDraw(draw: { state: number, result: number }, observation: Observation) {
  let asserted = false;
  if (observation.result !== undefined) {
    asserted = true;
    integer(observation.result, 'roll observation result', { min: 0 });
    if (draw.result !== observation.result) return false;
  }
  if (observation.outcome !== undefined) {
    asserted = true;
    if (typeof observation.outcome !== 'boolean')
      throw new TypeError('roll observation outcome must be boolean');
    if (relationMatches(draw.result, observation) !== observation.outcome) return false;
  }
  if (observation.state !== undefined) {
    asserted = true;
    if (seed(observation.state, 'observed state') !== draw.state) return false;
  }
  if (!asserted) throw new TypeError('roll observation needs result, outcome, or state');
  return true;
}

/**
 * Filter seeds using known Random(N) outcomes in draw order.
 *
 * Each observation consumes exactly one global game RNG draw. `drawIndex` is
 * zero-based from the night seed and can skip hidden draws. An observation may
 * assert the raw result, the post-draw state, or a boolean relation such as
 * `Random(20) < 10` via `{ relation: '<', threshold: 10, outcome: true }`.
 */
export function filterSeedCandidatesByRolls(options: { candidates?: unknown, observations?: unknown } = {}) {
  const { candidates, observations } = options;
  let survivors = normalizeSeedCandidates(candidates);
  if (!isList(observations)) throw new TypeError('roll observations must be an array');
  let nextIndex = 0;
  const applied: { index: number, drawIndex: number, bound: number, survivors: number }[] = [];
  for (const [index, observation] of observations.entries()) {
    if (!isRecord(observation)) throw new TypeError(`roll observation ${index} must be an object`);
    const bound = integer(observation.bound, `roll observation ${index}.bound`, { min: 1 });
    const drawIndex = observation.drawIndex === undefined
      ? nextIndex : integer(observation.drawIndex, `roll observation ${index}.drawIndex`, { min: 0 });
    if (drawIndex < nextIndex)
      throw new RangeError(`roll observation ${index} goes backwards from draw ${nextIndex}`);
    const keep: number[] = [];
    for (const currentSeed of survivors) {
      // `drawIndex` is zero-based. Bounds do not affect the LCG state, so
      // hidden draws can be skipped without knowing their Random(N) bound.
      let state = currentSeed;
      for (let draw = 0; draw < drawIndex; draw++) state = nextRngState(state);
      const result = randomDraw(state, bound);
      if (matchesDraw(result, observation)) keep.push(currentSeed);
    }
    survivors = keep;
    nextIndex = drawIndex + 1;
    applied.push({ index, drawIndex, bound, survivors: survivors.length });
    if (survivors.length === 0) break;
  }
  return Object.freeze({
    schema: SEED_RECOVERY_SCHEMA,
    method: 'roll-observations',
    initialCount: normalizeSeedCandidates(candidates).length,
    candidates: Object.freeze(survivors),
    consumedThroughDraw: nextIndex === 0 ? -1 : nextIndex - 1,
    applied: Object.freeze(applied),
  });
}

function deepPartialMatch(actual: unknown, expected: unknown): boolean {
  if (isRecord(expected)) {
    if (!isRecord(actual)) return false;
    return Object.entries(expected).every(([key, value]) => deepPartialMatch(actual[key], value));
  }
  if (isList(expected)) {
    return isList(actual) && expected.length === actual.length &&
      expected.every((value, index) => deepPartialMatch(actual[index], value));
  }
  return actual === expected;
}

function eventFrameRange(observation: Observation) {
  const exact = observation.frame;
  if (exact !== undefined) {
    const frame = integer(exact, 'event observation frame', { min: 0 });
    const tolerance = observation.toleranceFrames === undefined ? 0 :
      integer(observation.toleranceFrames, 'event observation toleranceFrames', { min: 0 });
    return { minFrame: Math.max(0, frame - tolerance), maxFrame: frame + tolerance };
  }
  if (observation.minFrame === undefined && observation.maxFrame === undefined)
    throw new TypeError('event observation needs frame or minFrame/maxFrame');
  const minFrame = observation.minFrame === undefined ? 0 :
    integer(observation.minFrame, 'event observation minFrame', { min: 0 });
  const maxFrame = observation.maxFrame === undefined ? minFrame :
    integer(observation.maxFrame, 'event observation maxFrame', { min: 0 });
  if (maxFrame < minFrame) throw new RangeError('event observation maxFrame must be >= minFrame');
  return { minFrame, maxFrame };
}

function eventMatches(event: SimEvent, observation: Observation) {
  const eventType = observation.event ?? observation.eventType;
  if (typeof eventType !== 'string' || eventType.length === 0)
    throw new TypeError('event observation needs event or eventType');
  if (event.type !== eventType) return false;
  const range = eventFrameRange(observation);
  if (event.f < range.minFrame || event.f > range.maxFrame) return false;
  return observation.data === undefined || deepPartialMatch('data' in event ? event.data : undefined, observation.data);
}

/** One input of a replayed trace, at the frame before whose tick it lands. */
interface ScheduledAction {
  readonly frame: number;
  readonly kind: 'press' | 'release' | 'tap';
  readonly action: string;
  readonly index: number;
}

function normalizeActionTrace(actions: unknown) {
  if (!isList(actions)) throw new TypeError('actions must be an array');
  const scheduled: ScheduledAction[] = [];
  for (const [index, action] of actions.entries()) {
    if (!isRecord(action)) throw new TypeError(`action ${index} must be an object`);
    const atFrame = integer(action.atFrame ?? action.frame, `action ${index}.atFrame`, { min: 0 });
    if (typeof action.action !== 'string' || action.action.length === 0)
      throw new TypeError(`action ${index}.action must be a non-empty string`);
    const kind = action.kind ?? 'tap';
    if (kind === 'hold') {
      const duration = integer(action.durationFrames, `action ${index}.durationFrames`, { min: 1 });
      scheduled.push({ frame: atFrame, kind: 'press', action: action.action, index });
      scheduled.push({ frame: atFrame + duration, kind: 'release', action: action.action, index });
    } else if (kind === 'tap') {
      scheduled.push({ frame: atFrame, kind: 'tap', action: action.action, index });
    } else if (kind === 'press' || kind === 'release') {
      scheduled.push({ frame: atFrame, kind, action: action.action, index });
    } else {
      throw new TypeError(`unsupported action kind: ${kind}`);
    }
  }
  return scheduled.sort((a, b) => a.frame - b.frame || a.index - b.index ||
    (a.kind === 'release' ? 1 : -1));
}

function runActionTrace(sim: Sim, scheduled: readonly ScheduledAction[], untilFrame: number) {
  let cursor = 0;
  while (sim.frame < untilFrame) {
    // Match the simulator tools: an action stamped for frame F is applied
    // before the tick that produces frame F+1. This keeps scheduler-boundary
    // actions from being shifted by one frame during candidate replay.
    while (cursor < scheduled.length && scheduled[cursor].frame === sim.frame) {
      const current = scheduled[cursor++];
      if (current.kind === 'release') sim.release(current.action);
      else if (current.kind === 'tap') { sim.press(current.action); sim.release(current.action); }
      else sim.press(current.action);
    }
    sim.tick();
  }
}

function observationEndFrame(observations: readonly Observation[]) {
  return observations.reduce((end, observation) => {
    const range = eventFrameRange(observation);
    return Math.max(end, range.maxFrame);
  }, 0);
}

/**
 * Replay one known action trace for each candidate and retain candidates whose
 * event stream satisfies all positive/negative observations. This is intended
 * for the small candidate sets produced by the time-window method; callers
 * should explicitly opt into a full 65,536-seed scan.
 */
export function filterSeedCandidatesByEvents(options: { candidates?: unknown, simOptions?: Partial<SimOptions>,
  actions?: unknown, observations?: readonly Observation[], untilFrame?: unknown, maxCandidates?: unknown } = {}) {
  const { candidates, simOptions = {}, actions = [], observations,
    untilFrame, maxCandidates = 4096 } = options;
  if (!isRecord(simOptions)) throw new TypeError('simOptions must be an object');
  const survivors = normalizeSeedCandidates(candidates);
  if (!isList(observations)) throw new TypeError('event observations must be an array');
  const limit = integer(maxCandidates, 'maxCandidates', { min: 1 });
  if (survivors.length > limit)
    throw new RangeError(`event replay has ${survivors.length} candidates; maxCandidates is ${limit}`);
  const scheduled = normalizeActionTrace(actions);
  const lastActionFrame = scheduled.reduce((last, item) => Math.max(last, item.frame), 0);
  const endFrame = untilFrame === undefined
    ? Math.max(observationEndFrame(observations), lastActionFrame)
    : integer(untilFrame, 'untilFrame', { min: 0 });
  const reports: { seed: number, eventCount: number, endFrame: number }[] = [];

  for (const currentSeed of survivors) {
    const options = { ...simOptions, seed: currentSeed,
      // A death ends a real run, but would make later candidate observations
      // incomparable. The caller should provide only pre-death evidence.
      lethal: simOptions.lethal ?? false };
    const sim = new Sim(options);
    runActionTrace(sim, scheduled, endFrame);
    let matches = true;
    for (const observation of observations) {
      const present = observation.present !== false;
      const found = sim.events.some(event => eventMatches(event, observation));
      if (present !== found) { matches = false; break; }
    }
    if (matches) reports.push({ seed: currentSeed, eventCount: sim.events.length,
      endFrame: sim.frame });
  }
  return Object.freeze({
    schema: SEED_RECOVERY_SCHEMA,
    method: 'event-observations',
    initialCount: normalizeSeedCandidates(candidates).length,
    untilFrame: endFrame,
    candidates: Object.freeze(reports),
    candidateSeeds: Object.freeze(reports.map(report => report.seed)),
  });
}

/** Return the state after exactly `drawCount` draws from a seed. */
export function rngStateAfterDraws(initialSeed: unknown, drawCount: unknown) {
  let state = seed(initialSeed, 'initialSeed');
  const draws = integer(drawCount, 'drawCount', { min: 0 });
  for (let i = 0; i < draws; i++) state = nextRngState(state);
  return state;
}
