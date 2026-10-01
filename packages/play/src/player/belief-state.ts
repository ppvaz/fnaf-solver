// Versioned, plain-data belief contract for Plan 20 package 1.
//
// This is deliberately a reducer, not a hidden digital twin: unknown facts do
// not become false, delayed observations retain both timestamps, and control
// actions are not considered executed until a matching verification arrives.

import { isList, isOneOf } from '@sixam/kernel';
import { plainClone, appendLog, shareLog } from './plain-clone.ts';

export const BELIEF_SCHEMA = 'belief-v1';
export const FACT_STATES = Object.freeze({ OBSERVED: 'OBSERVED', UNKNOWN: 'UNKNOWN' } as const);

/**
 * One sensor fact: an observed value, or UNKNOWN with its reason, with both timestamps. `observed` and
 * `unknown` fill every field; a fact a sensor hands in may leave its provenance out.
 */
export interface Fact {
  readonly state: 'OBSERVED' | 'UNKNOWN';
  readonly value?: unknown;
  readonly reason?: string;
  readonly source?: unknown;
  readonly calibrationProfile?: unknown;
  readonly observedAtMs?: number | null;
  readonly receivedAtMs?: number | null;
  readonly confidence?: number;
}

interface FactOptions {
  source?: unknown;
  calibrationProfile?: unknown;
  observedAtMs?: number | null;
  receivedAtMs?: number | null;
}

/** What the controller believes about one control: a value, how sure, and what said so. */
interface ControlBelief {
  value: unknown;
  /** As the fact carried it: absent when the sensor stated none. */
  confidence: number | undefined;
  source: unknown;
}

/** belief-v1: plain data, reduced from events; an UNKNOWN fact never becomes false. */
export interface Belief {
  schema: typeof BELIEF_SCHEMA;
  nowMs: number;
  facts: Record<string, Fact>;
  lastKnown: Record<string, Fact>;
  control: {
    monitor: ControlBelief,
    mask: ControlBelief,
    viewedCamera: ControlBelief,
    cameraHighlights: ControlBelief,
    actionLockout: boolean,
  };
  resources: { box: { min: number, max: number }, foxy: { risk: string } };
  hazards: { blackout: string, opening: unknown };
  routes: { bb: unknown, mangle: unknown };
  sensorHealth: Record<string, { reads: number, unknowns: number, lastReceivedAtMs: number | null }>;
  calibrationProfiles: Readonly<Record<string, unknown>>;
  plan: { primitive: unknown, validFromMs: number | null };
  pendingAction: { action: 'monitor' | 'mask', expected: unknown, sentAtMs: number, token: unknown } | null;
  incidents: Readonly<Record<string, unknown>>[];
}

/** One event the belief reduces. */
type BeliefEvent =
  | { type: 'observation', nowMs?: number, facts?: Readonly<Record<string, Fact>> | null }
  | { type: 'action-sent', nowMs?: number, action: string, expected: unknown, sentAtMs?: number, token?: unknown }
  | { type: 'action-abandoned', nowMs?: number, reason?: string }
  | { type: 'action-verified', nowMs?: number, token?: unknown, value: unknown }
  | { type: 'plan', nowMs?: number, primitive?: unknown, validFromMs?: number }
  | { type: 'time', nowMs?: number };

const clone = plainClone;
const finite = (value: unknown): value is number => Number.isFinite(value);

export function observed(value: unknown, {
  source = 'unknown-sensor', calibrationProfile = null,
  observedAtMs = null, receivedAtMs = null, confidence = 1,
}: FactOptions & { confidence?: number } = {}): Fact {
  if (!finite(confidence) || confidence < 0 || confidence > 1)
    throw new RangeError('fact confidence must be between 0 and 1');
  return { state: FACT_STATES.OBSERVED, value, source, calibrationProfile,
           observedAtMs, receivedAtMs, confidence };
}

export function unknown(reason: string, {
  source = 'unknown-sensor', calibrationProfile = null,
  observedAtMs = null, receivedAtMs = null,
}: FactOptions = {}): Fact {
  if (!reason) throw new TypeError('UNKNOWN facts need a reason');
  return { state: FACT_STATES.UNKNOWN, reason, source, calibrationProfile,
           observedAtMs, receivedAtMs, confidence: 0 };
}

export function initialBelief({ nowMs = 0, calibrationProfiles = {} }: { nowMs?: number, calibrationProfiles?: Readonly<Record<string, unknown>> } = {}): Belief {
  if (!finite(nowMs)) throw new TypeError('belief time must be finite');
  return {
    schema: BELIEF_SCHEMA,
    nowMs,
    facts: {},
    lastKnown: {},
    control: {
      monitor: { value: 'unknown', confidence: 0, source: null },
      mask: { value: 'unknown', confidence: 0, source: null },
      viewedCamera: { value: null, confidence: 0, source: null },
      cameraHighlights: { value: null, confidence: 0, source: null },
      actionLockout: false,
    },
    resources: { box: { min: 0, max: 1 }, foxy: { risk: 'unknown' } },
    hazards: { blackout: 'unknown', opening: 'unknown' },
    routes: { bb: 'unknown', mangle: 'unknown' },
    sensorHealth: {},
    calibrationProfiles: clone(calibrationProfiles),
    plan: { primitive: null, validFromMs: null },
    pendingAction: null,
    incidents: [],
  };
}

const controlFact: Readonly<Record<string, 'monitor' | 'mask'>> = {
  monitorUp: 'monitor',
  maskOn: 'mask',
};
const controlOf = (name: string) => Object.hasOwn(controlFact, name) ? controlFact[name] : undefined;
const cameraName = (value: unknown) => typeof value === 'string' &&
  /^cam:(?:[1-9]|1[0-2])$/.test(value);

function checkCameraFact(name: string, value: unknown) {
  if (name === 'cameraSelected' && !cameraName(value))
    throw new TypeError('cameraSelected must name one calibrated camera');
  if (name === 'cameraHighlights' &&
      (!isList(value) || value.length === 0 ||
       value.some(camera => !cameraName(camera)) ||
       new Set(value).size !== value.length))
    throw new TypeError('cameraHighlights must contain unique calibrated cameras');
}

function recordHealth(next: Belief, factName: string, fact: Fact) {
  const old = next.sensorHealth[factName] ??
    { reads: 0, unknowns: 0, lastReceivedAtMs: null };
  next.sensorHealth[factName] = {
    reads: old.reads + 1,
    unknowns: old.unknowns + (fact.state === FACT_STATES.UNKNOWN ? 1 : 0),
    lastReceivedAtMs: fact.receivedAtMs ?? old.lastReceivedAtMs,
  };
}

function applyFact(next: Belief, name: string, fact: Fact) {
  if (!fact || !isOneOf(Object.values(FACT_STATES), fact.state))
    throw new TypeError(`invalid fact envelope for ${name}`);
  recordHealth(next, name, fact);
  if (fact.state === FACT_STATES.UNKNOWN) {
    // Preserve the last positive evidence separately. Consumers see UNKNOWN
    // now and must not accidentally read lastKnown as the current truth.
    next.facts[name] = clone(fact);
    return;
  }
  checkCameraFact(name, fact.value);
  next.facts[name] = clone(fact);
  next.lastKnown[name] = clone(fact);

  const control = controlOf(name);
  if (control) {
    next.control[control] = {
      value: fact.value === true,
      confidence: fact.confidence,
      source: fact.source,
    };
    if (next.pendingAction && next.pendingAction.action === control &&
        next.pendingAction.expected !== fact.value) {
      next.control.actionLockout = true;
      appendLog(next.incidents, { type: 'control-disagreement', fact: name,
        expected: next.pendingAction.expected, actual: fact.value,
        receivedAtMs: fact.receivedAtMs });
    }
  }
  if (name === 'blackout') next.hazards.blackout = fact.value ? 'active' : 'clear';
  if (name === 'cameraSelected') next.control.viewedCamera = {
    value: fact.value, confidence: fact.confidence, source: fact.source,
  };
  if (name === 'cameraHighlights') next.control.cameraHighlights = {
    value: clone(fact.value), confidence: fact.confidence, source: fact.source,
  };
  if (name === 'leftOpening') next.hazards.opening = fact.value;
  if (name === 'bbVent') next.routes.bb = fact.value;
  if (name === 'mangleOpening') next.routes.mangle = fact.value;
  if (name === 'boxPie' && finite(fact.value)) {
    const box = Math.max(0, Math.min(1, fact.value));
    next.resources.box = { min: box, max: box };
  }
}

/**
 * Copy a belief without deep-copying its append-only incident log. Incidents
 * are frozen on append and never revised, so copies share the entries.
 */
export function cloneBelief(belief: Belief): Belief {
  const { incidents, ...rest } = belief;
  return { ...clone(rest), incidents: shareLog(incidents) };
}

/** Apply one deterministic event and return a new plain-data belief. */
export function reduceBelief(belief: Belief, event: BeliefEvent): Belief {
  if (!belief || belief.schema !== BELIEF_SCHEMA)
    throw new TypeError('belief schema mismatch');
  if (!event || typeof event.type !== 'string') throw new TypeError('invalid belief event');
  const next = cloneBelief(belief);
  if (event.nowMs !== undefined) {
    if (!finite(event.nowMs) || event.nowMs < next.nowMs)
      throw new RangeError('belief time must be monotonic');
    next.nowMs = event.nowMs;
  }

  if (event.type === 'observation') {
    for (const [name, fact] of Object.entries(event.facts ?? {})) {
      const expectedProfile = next.calibrationProfiles[name];
      if (expectedProfile && fact.calibrationProfile !== expectedProfile) {
        applyFact(next, name, unknown('calibration-mismatch', {
          source: fact.source, calibrationProfile: fact.calibrationProfile,
          observedAtMs: fact.observedAtMs, receivedAtMs: fact.receivedAtMs,
        }));
        appendLog(next.incidents, { type: 'sensor-mismatch', fact: name,
          expectedProfile, receivedProfile: fact.calibrationProfile });
      } else {
        applyFact(next, name, fact);
      }
    }
  } else if (event.type === 'action-sent') {
    const action = event.action ? controlOf(event.action) : undefined;
    if (!action)
      throw new TypeError('action-sent needs monitorUp or maskOn');
    next.pendingAction = { action,
      expected: event.expected, sentAtMs: event.sentAtMs ?? next.nowMs,
      token: event.token ?? null };
    next.control.actionLockout = true;
  } else if (event.type === 'action-abandoned') {
    // A transaction that never verified is a FAILED action, not an eternally
    // pending one. Clearing it here does not claim the control's state -- the
    // estimator keeps `verificationRequired` set until something observes it.
    if (next.pendingAction) {
      appendLog(next.incidents, { type: 'action-abandoned',
        action: next.pendingAction.action, expected: next.pendingAction.expected,
        token: next.pendingAction.token ?? null,
        reason: event.reason ?? 'verification-deadline' });
      next.pendingAction = null;
    }
    next.control.actionLockout = false;
  } else if (event.type === 'action-verified') {
    if (!next.pendingAction || (event.token !== undefined &&
        event.token !== next.pendingAction.token)) {
      appendLog(next.incidents, { type: 'unexpected-action-verification', token: event.token ?? null });
    } else if (event.value !== next.pendingAction.expected) {
      appendLog(next.incidents, { type: 'action-verification-mismatch',
        action: next.pendingAction.action, expected: next.pendingAction.expected,
        actual: event.value });
    } else {
      next.control[next.pendingAction.action] = {
        value: event.value, confidence: 1, source: 'action-verification',
      };
      next.pendingAction = null;
      next.control.actionLockout = false;
    }
  } else if (event.type === 'plan') {
    next.plan = { primitive: event.primitive ?? null,
                  validFromMs: event.validFromMs ?? next.nowMs };
  } else if (event.type !== 'time') {
    // An untyped caller can still send a type this reducer does not know.
    throw new TypeError(`unknown belief event type: ${(event as { type: unknown }).type}`);
  }
  return next;
}

export function replayBelief(initial: Belief, events: readonly BeliefEvent[]) {
  return events.reduce(reduceBelief, initial);
}
