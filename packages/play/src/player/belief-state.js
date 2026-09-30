// Versioned, plain-data belief contract for Plan 20 package 1.
//
// This is deliberately a reducer, not a hidden digital twin: unknown facts do
// not become false, delayed observations retain both timestamps, and control
// actions are not considered executed until a matching verification arrives.

import { plainClone, appendLog, shareLog } from './plain-clone.js';

export const BELIEF_SCHEMA = 'belief-v1';
export const FACT_STATES = Object.freeze({ OBSERVED: 'OBSERVED', UNKNOWN: 'UNKNOWN' });

const clone = plainClone;
const finite = value => Number.isFinite(value);

export function observed(value, {
  source = 'unknown-sensor', calibrationProfile = null,
  observedAtMs = null, receivedAtMs = null, confidence = 1,
} = {}) {
  if (!finite(confidence) || confidence < 0 || confidence > 1)
    throw new RangeError('fact confidence must be between 0 and 1');
  return { state: FACT_STATES.OBSERVED, value, source, calibrationProfile,
           observedAtMs, receivedAtMs, confidence };
}

export function unknown(reason, {
  source = 'unknown-sensor', calibrationProfile = null,
  observedAtMs = null, receivedAtMs = null,
} = {}) {
  if (!reason) throw new TypeError('UNKNOWN facts need a reason');
  return { state: FACT_STATES.UNKNOWN, reason, source, calibrationProfile,
           observedAtMs, receivedAtMs, confidence: 0 };
}

export function initialBelief({ nowMs = 0, calibrationProfiles = {} } = {}) {
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

const controlFact = {
  monitorUp: 'monitor',
  maskOn: 'mask',
};
const cameraName = value => typeof value === 'string' &&
  /^cam:(?:[1-9]|1[0-2])$/.test(value);

function checkCameraFact(name, value) {
  if (name === 'cameraSelected' && !cameraName(value))
    throw new TypeError('cameraSelected must name one calibrated camera');
  if (name === 'cameraHighlights' &&
      (!Array.isArray(value) || value.length === 0 ||
       value.some(camera => !cameraName(camera)) ||
       new Set(value).size !== value.length))
    throw new TypeError('cameraHighlights must contain unique calibrated cameras');
}

function recordHealth(next, factName, fact) {
  const old = next.sensorHealth[factName] ??
    { reads: 0, unknowns: 0, lastReceivedAtMs: null };
  next.sensorHealth[factName] = {
    reads: old.reads + 1,
    unknowns: old.unknowns + (fact.state === FACT_STATES.UNKNOWN ? 1 : 0),
    lastReceivedAtMs: fact.receivedAtMs ?? old.lastReceivedAtMs,
  };
}

function applyFact(next, name, fact) {
  if (!fact || !Object.values(FACT_STATES).includes(fact.state))
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

  const control = controlFact[name];
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
export function cloneBelief(belief) {
  const { incidents, ...rest } = belief;
  const next = clone(rest);
  next.incidents = shareLog(incidents);
  return next;
}

/** Apply one deterministic event and return a new plain-data belief. */
export function reduceBelief(belief, event) {
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
    if (!event.action || !controlFact[event.action])
      throw new TypeError('action-sent needs monitorUp or maskOn');
    next.pendingAction = { action: controlFact[event.action],
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
    throw new TypeError(`unknown belief event type: ${event.type}`);
  }
  return next;
}

export function replayBelief(initial, events) {
  return events.reduce(reduceBelief, initial);
}
