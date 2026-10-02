/** CameraSelected rule artifact conformance: calibration in, honest verdicts out. */
import assert from 'node:assert/strict';
import { cameraRuleDigest, measureCameraSelected, parseCameraRule } from '../src/sensors/fnaf2/camera-rule.ts';

const buttons = [
  { control: 'cam:1', entry: 'cam01_button', x: 1412, y: 784, feature: 'yellowness',
    rule: { kind: 'threshold', threshold: 87.5, refuse_band: 8.5 },
    separation_margin: 8.5, lit_range: [96, 194], unlit_range: [-19, -9] },
  { control: 'cam:2', entry: 'cam02_button', x: 1720, y: 784, feature: 'yellowness',
    rule: { kind: 'threshold', threshold: 87.5, refuse_band: 8.5 },
    separation_margin: 8.5, lit_range: [194, 194], unlit_range: [-19, -9] },
];
const artifact = {
  schema: 'camera-rule-v1',
  schema_version: 1,
  status: 'calibrated',
  reason: null,
  fact: {
    id: 'cameraSelected',
    labels: ['cam:1', 'cam:2'],
    unknown_reasons: ['monitor-not-up', 'no-camera-highlight', 'multiple-camera-highlight',
      'ambiguous-threshold', 'feature-missing', 'read-unavailable', 'read-stale',
      'sensor-mismatch', 'calibration-refused'],
  },
  sensor: {
    id: 'cue-helper-watch-native-2400x1080',
    geometry: [2400, 1080],
    sampling: 'pixel-watch-native-2400x1080',
    profile_id: 'moto-g56-v207-landscape',
  },
  adapter: {
    buttons,
    minimum_margin: 5,
    calibration_frames: 39,
    class_counts: { 'cam:1': 4, 'cam:2': 3 },
    corpus_reads: { 'cam:1': { named: 4, none: 0, multiple: 0, ambiguous: 0 },
      'cam:2': { named: 3, none: 0, multiple: 0, ambiguous: 0 } },
    limitations: ['night-1-corpus'],
  },
};

const up = { signal: 'monitorUp', state: 'OBSERVED', value: true, confidence: 1 };
const rule = parseCameraRule(artifact);
assert.equal(Object.isFrozen(rule), true);
assert.equal(cameraRuleDigest(artifact), cameraRuleDigest(JSON.parse(JSON.stringify(artifact))),
  'digest must be stable across serialization');
assert.notEqual(cameraRuleDigest(artifact), cameraRuleDigest({ ...artifact, adapter: {
  ...artifact.adapter, buttons: artifact.adapter.buttons.slice(0, 1) } }),
  'digest must move when the button set moves');

for (const [what, mutate] of [
  ['refused artifact', a => ({ ...a, status: 'refuse', reason: 'calibration-refused' })],
  ['wrong schema', a => ({ ...a, schema: 'camera-rule-v2' })],
  ['wrong fact id', a => ({ ...a, fact: { ...a.fact, id: 'monitorUp' } })],
  ['single camera', a => ({ ...a, fact: { ...a.fact, labels: ['cam:1'] } })],
  ['foreign geometry', a => ({ ...a, sensor: { ...a.sensor, geometry: [1080, 2400] } })],
  ['foreign sampling', a => ({ ...a, sensor: { ...a.sensor, sampling: 'grid' } })],
  ['one button', a => ({ ...a, adapter: { ...a.adapter, buttons: buttons.slice(0, 1) } })],
  ['repeated control', a => ({ ...a, adapter: { ...a.adapter,
    buttons: [{ ...buttons[0], entry: 'cam01_button' }, { ...buttons[1], control: 'cam:1' }] } })],
  ['repeated entry', a => ({ ...a, adapter: { ...a.adapter,
    buttons: [buttons[0], { ...buttons[1], entry: 'cam01_button' }] } })],
  ['non-yellowness feature', a => ({ ...a, adapter: { ...a.adapter,
    buttons: [buttons[0], { ...buttons[1], feature: 'luma' }] } })],
  ['band over margin', a => ({ ...a, adapter: { ...a.adapter,
    buttons: [buttons[0], { ...buttons[1], rule: { ...buttons[1].rule, refuse_band: 9 } }] } })],
  ['invented unknown reason', a => ({ ...a, fact: { ...a.fact, unknown_reasons: ['looks-fine'] } })],
] satisfies [string, (a: typeof artifact) => unknown][]) {
  assert.throws(() => parseCameraRule(mutate(artifact)), /camera-rule-v1/, what);
}

const down = { signal: 'monitorUp', state: 'OBSERVED', value: false, confidence: 1 };
assert.deepEqual(measureCameraSelected({ cam01_button: 194, cam02_button: -19 }, rule, down),
  { signal: 'cameraSelected', state: 'UNKNOWN', reason: 'monitor-not-up' },
  'the camera fact is meaningless while the monitor is down');
assert.deepEqual(measureCameraSelected({ cam01_button: 194 }, rule, up),
  { signal: 'cameraSelected', state: 'UNKNOWN', reason: 'read-unavailable' });
assert.deepEqual((measureCameraSelected({ cam01_button: 194, cam02_button: 'UNKNOWN' }, rule, up) as { reason?: string }).reason,
  'read-unavailable', 'an UNKNOWN watch value refuses instead of voting');

const reads = (a: number, b: number) => ({ cam01_button: a, cam02_button: b });
assert.deepEqual(measureCameraSelected(reads(194, -19), rule, up),
  { signal: 'cameraSelected', state: 'OBSERVED', value: 'cam:1', confidence: 1 });
assert.deepEqual(measureCameraSelected(reads(-19, 194), rule, up),
  { signal: 'cameraSelected', state: 'OBSERVED', value: 'cam:2', confidence: 1 });
assert.deepEqual(measureCameraSelected(reads(96, -19), rule, up),
  { signal: 'cameraSelected', state: 'OBSERVED', value: 'cam:1', confidence: 1 },
  'the dimmed wind-state selected value still names the camera');
assert.deepEqual((measureCameraSelected(reads(-19, -9), rule, up) as { reason?: string }).reason, 'no-camera-highlight',
  'the unlit band edge names no camera and must stay UNKNOWN');
assert.deepEqual((measureCameraSelected(reads(194, 194), rule, up) as { reason?: string }).reason, 'multiple-camera-highlight',
  'two lit buttons are the transition/double-camera-glitch signature, never a guess');
assert.deepEqual((measureCameraSelected(reads(90, -19), rule, up) as { reason?: string }).reason, 'ambiguous-threshold',
  'a value between the bands refuses');

console.log('camera rule artifact: parse refusal, digest binding, and strict verdicts pass');
