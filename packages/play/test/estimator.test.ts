// Plan 20 package 3: estimator timing, uncertainty, and reconciliation.
import {
  initialEstimator, predict, update, send, reconcile, needsVerification,
} from '@sixam/play/player';
import { initialBelief, observed, unknown } from '@sixam/play/player';

/** The provenance a test fact overrides; the rest is the video mock's. */
interface FactExtra { source?: string, profile?: string | null, observedAtMs?: number, receivedAtMs?: number, confidence?: number }

const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const O = (value: unknown, extra: FactExtra = {}) => observed(value, {
  source: extra.source ?? 'video-mock', calibrationProfile: extra.profile ?? null,
  observedAtMs: extra.observedAtMs ?? null, receivedAtMs: extra.receivedAtMs ?? null,
  confidence: extra.confidence ?? 1,
});
const U = (reason: string, extra: FactExtra = {}) => unknown(reason, {
  source: extra.source ?? 'video-mock', calibrationProfile: extra.profile ?? null,
  observedAtMs: extra.observedAtMs ?? null, receivedAtMs: extra.receivedAtMs ?? null,
});

// Delayed audio changes route evidence at the decision boundary, but its
// provenance remains the earlier game time. A consumer can therefore predict
// forward from observedAtMs instead of treating receipt as event time.
let e = initialEstimator({ nowMs: 0 });
e = update(e, { nowMs: 1250, facts: {
  bbVent: O('opening', { source: 'a2dp', observedAtMs: 1000, receivedAtMs: 1250 }),
}});
check(e.belief.routes.bb === 'opening', 'delayed audio did not update BB route risk');
check(e.latest.bbVent.observedAtMs === 1000 && e.latest.bbVent.receivedAtMs === 1250,
  'delayed audio timing was collapsed to receipt time');
check(e.trace.some(x => x.type === 'fact-accepted' && x.delayedMs === 250),
  'delayed audio was not logged with its transport delay');

// UNKNOWN is not a negative observation: an earlier opening risk survives a
// dropped read, while the current fact is explicitly unknown.
e = update(e, { nowMs: 1300, facts: {
  bbVent: U('audio-dropped', { source: 'a2dp', observedAtMs: 1300, receivedAtMs: 1300 }),
}});
check(e.belief.routes.bb === 'opening', 'UNKNOWN audio reduced an existing route risk');
check(e.belief.facts.bbVent.state === 'UNKNOWN', 'UNKNOWN audio was not preserved');

// Old control evidence enters recovery rather than silently permitting a
// monitor/mask transition.
let control = initialEstimator({ nowMs: 0, staleAfterMs: { monitorUp: 100 } });
control = update(control, { nowMs: 0, facts: {
  monitorUp: O(false, { observedAtMs: 0, receivedAtMs: 0 }),
}});
control = predict(control, 101);
check(needsVerification(control, 'monitor'), 'stale monitor evidence did not require verification');
check(control.belief.incidents.some(x => x.type === 'stale-control'),
  'stale monitor evidence had no incident');
check(control.belief.control.monitor.value === false,
  'stale evidence overwrote the last known monitor value');

// Two close, contradictory observations become UNKNOWN and a lockout; the
// second source does not win merely because it arrived later.
let conflict = initialEstimator({ nowMs: 0, contradictionWindowMs: 500 });
conflict = update(conflict, { nowMs: 100, facts: {
  maskOn: O(false, { source: 'video-a', observedAtMs: 100, receivedAtMs: 100 }),
}});
conflict = update(conflict, { nowMs: 200, facts: {
  maskOn: O(true, { source: 'video-b', observedAtMs: 200, receivedAtMs: 200 }),
}});
check(conflict.belief.facts.maskOn.state === 'UNKNOWN',
  'contradictory mask sensors used last-write-wins');
check(conflict.belief.incidents.some(x => x.type === 'sensor-contradiction'),
  'contradictory mask sensors produced no incident');
check(needsVerification(conflict, 'mask'),
  'contradictory mask sensors did not force recovery');

// A real transition from the same source is not a contradiction. This is the
// hazard edge the controller must be able to observe after a clear reading.
let transition = initialEstimator({ nowMs: 0, contradictionWindowMs: 500 });
transition = update(transition, { nowMs: 100, facts: {
  blackout: O(false, { source: 'video', observedAtMs: 100, receivedAtMs: 100 }),
}});
transition = update(transition, { nowMs: 200, facts: {
  blackout: O(true, { source: 'video', observedAtMs: 200, receivedAtMs: 200 }),
}});
check(transition.belief.facts.blackout.value === true &&
      !transition.belief.incidents.some(x => x.type === 'sensor-contradiction'),
  'same-source blackout transition was incorrectly treated as a contradiction');

// A declared calibration profile is mandatory, not advisory: a missing or
// foreign profile is UNKNOWN even when the numeric fact looks plausible.
let calibrated = initialEstimator({
  belief: initialBelief({ calibrationProfiles: { monitorUp: 'g56-native-v1' } }),
});
calibrated = update(calibrated, { nowMs: 10, facts: {
  monitorUp: O(false, { source: 'foreign-sensor', profile: null,
    observedAtMs: 10, receivedAtMs: 10 }),
}});
check(calibrated.belief.facts.monitorUp.state === 'UNKNOWN' &&
      calibrated.belief.incidents.some(x => x.type === 'sensor-mismatch'),
  'missing calibration profile was accepted as a control fact');

// Action verification is transactional: a wrong result remains locked, a
// matching result clears the corresponding verification requirement.
let action = initialEstimator({ nowMs: 0 });
action = send(action, { action: 'maskOn', expected: true, sentAtMs: 10, token: 'm1' });
action = reconcile(action, { action: 'maskOn', value: false, verifiedAtMs: 20, token: 'm1' });
check(needsVerification(action, 'mask'), 'bad mask verification did not remain locked');
check(action.belief.incidents.some(x => x.type === 'action-verification-mismatch'),
  'bad mask verification was not recorded');
action = reconcile(action, { action: 'maskOn', value: true, verifiedAtMs: 30, token: 'm1' });
check(!needsVerification(action, 'mask'), 'matching mask verification did not clear lockout');

console.log('estimator: delayed timing, UNKNOWN preservation, stale recovery, conflicts, and verification pass');
