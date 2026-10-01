import assert from 'node:assert/strict';
import { reconcileExclusiveControls } from '../src/phone/control-exclusion.ts';

assert.deepEqual(reconcileExclusiveControls({ monitorUp: true, maskOn: null }), {
  monitorUp: true, maskOn: false,
  monitorInference: null, maskInference: 'monitor-up-complement',
  contradiction: false, reason: null,
});

assert.deepEqual(reconcileExclusiveControls({ monitorUp: null, maskOn: true }), {
  monitorUp: false, maskOn: true,
  monitorInference: 'mask-up-complement', maskInference: null,
  contradiction: false, reason: null,
});

assert.deepEqual(reconcileExclusiveControls({ monitorUp: false, maskOn: null }), {
  monitorUp: false, maskOn: null,
  monitorInference: null, maskInference: null,
  contradiction: false, reason: null,
}, 'monitor down does not prove mask up');

assert.deepEqual(reconcileExclusiveControls({ monitorUp: true, maskOn: false }), {
  monitorUp: true, maskOn: false,
  monitorInference: null, maskInference: null,
  contradiction: false, reason: null,
});

assert.deepEqual(reconcileExclusiveControls({ monitorUp: true, maskOn: true }), {
  monitorUp: null, maskOn: null,
  monitorInference: null, maskInference: null,
  contradiction: true, reason: 'mask-monitor-contradiction',
});

assert.throws(() => reconcileExclusiveControls({ monitorUp: 'true' }), /boolean or null/);

console.log('control exclusion: safe complements, non-inference, and contradiction refusal pass');
