// Plan 20 package 1: deterministic versioned belief contract.
import {
  BELIEF_SCHEMA, initialBelief, observed, unknown,
  reduceBelief, replayBelief,
} from '@sixam/play/player';

let failures = 0;
const check = (name, condition) => {
  if (!condition) { failures++; console.error(`FAIL ${name}`); }
  else console.log(`ok   ${name}`);
};

const start = initialBelief({ nowMs: 0, calibrationProfiles: { maskOn: 'native-v1' } });
check('belief has a versioned plain-data schema',
  start.schema === BELIEF_SCHEMA && start.pendingAction === null);

let belief = reduceBelief(start, { type: 'observation', nowMs: 100,
  facts: { maskOn: observed(true, { source: 'video', calibrationProfile: 'native-v1',
    observedAtMs: 90, receivedAtMs: 100 }) } });
belief = reduceBelief(belief, { type: 'observation', nowMs: 120,
  facts: { maskOn: unknown('mask-animating', { source: 'video',
    calibrationProfile: 'native-v1', receivedAtMs: 120 }) } });
check('UNKNOWN never becomes false and last positive evidence is explicit',
  belief.facts.maskOn.state === 'UNKNOWN' && belief.lastKnown.maskOn.value === true &&
  belief.control.mask.value === true);

belief = reduceBelief(belief, { type: 'observation', nowMs: 200,
  facts: { bbVent: observed('opening', { source: 'a2dp',
    observedAtMs: 80, receivedAtMs: 200, confidence: 0.8 }) } });
check('delayed observations retain source and both clocks',
  belief.facts.bbVent.observedAtMs === 80 && belief.facts.bbVent.receivedAtMs === 200 &&
  belief.sensorHealth.bbVent.reads === 1);

belief = reduceBelief(belief, { type: 'observation', nowMs: 205,
  facts: { cameraHighlights: observed(['cam:9', 'cam:11'], {
    source: 'cue-helper', receivedAtMs: 205 }) } });
check('split-camera observations retain both highlighted buttons for strategy checks',
  JSON.stringify(belief.control.cameraHighlights.value) ===
    JSON.stringify(['cam:9', 'cam:11']));
belief = reduceBelief(belief, { type: 'observation', nowMs: 210,
  facts: { cameraHighlights: unknown('monitor-not-up', {
    source: 'cue-helper', receivedAtMs: 210 }) } });
check('an unknown split-camera read does not erase the last observed pair',
  belief.facts.cameraHighlights.state === 'UNKNOWN' &&
  JSON.stringify(belief.lastKnown.cameraHighlights.value) ===
    JSON.stringify(['cam:9', 'cam:11']) &&
  JSON.stringify(belief.control.cameraHighlights.value) ===
    JSON.stringify(['cam:9', 'cam:11']));
belief = reduceBelief(belief, { type: 'observation', nowMs: 215,
  facts: { cameraSelected: observed('cam:11', {
    source: 'cue-helper', receivedAtMs: 215 }) } });
check('a singular camera observation updates the viewed-camera control fact',
  belief.control.viewedCamera.value === 'cam:11');

belief = reduceBelief(belief, { type: 'action-sent', nowMs: 220,
  action: 'maskOn', expected: false, token: 'm1' });
check('sent actions enter lockout before verification',
  belief.pendingAction.action === 'mask' && belief.control.actionLockout);
belief = reduceBelief(belief, { type: 'action-verified', nowMs: 240,
  token: 'm1', value: true });
check('a contradictory verification is an incident, not an execution',
  belief.pendingAction.action === 'mask' &&
  belief.incidents.at(-1).type === 'action-verification-mismatch');

const mismatched = reduceBelief(start, { type: 'observation', nowMs: 10,
  facts: { maskOn: observed(true, { source: 'other-capture',
    calibrationProfile: 'wrong-profile', receivedAtMs: 10 }) } });
check('a sensor-profile mismatch becomes UNKNOWN with an incident',
  mismatched.facts.maskOn.state === 'UNKNOWN' &&
  mismatched.incidents[0].type === 'sensor-mismatch');

const events = [
  { type: 'time', nowMs: 5 },
  { type: 'observation', nowMs: 10,
    facts: { blackout: observed(true, { source: 'video', receivedAtMs: 10 }) } },
  { type: 'plan', nowMs: 11, primitive: 'defensive-mask', validFromMs: 20 },
];
check('the same trace rebuilds the same belief deterministically',
  JSON.stringify(replayBelief(initialBelief(), events)) ===
  JSON.stringify(replayBelief(initialBelief(), events)));

if (failures) process.exit(1);
console.log('belief state: schema, unknowns, calibration, verification, and replay pass');
