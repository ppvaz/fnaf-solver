import assert from 'node:assert/strict';
import { reconcileExclusiveControls } from '../src/phone/control-exclusion.ts';
import { gateMaskEvidence } from '../src/campaign/gate-evidence.ts';

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

// Widened to take the string its type forbids: the refusal is what is tested.
assert.throws(() => (reconcileExclusiveControls as (facts: { monitorUp: unknown }) => unknown)({ monitorUp: 'true' }),
  /boolean or null/);

// A cycle gate's mask evidence: the button chevrons decide; the fitted rule and
// the grid-luma refutation answer only where no chevron source exists, and a
// chevron source that shows no signature is a refusal, never a luma fallback.
const evidence = (sample: Parameters<typeof gateMaskEvidence>[0], believed: boolean | null) => {
  const { observedMaskOn, source } = gateMaskEvidence(sample, believed);
  return [observedMaskOn, source];
};
assert.deepEqual(evidence({ maskOn: null, maskButtonDownstroke: 142, monitorButtonDownstroke: 0 }, false),
  [true, 'button-stroke:mask-on']);
assert.deepEqual(evidence({ maskOn: true, maskButtonDownstroke: 142, monitorButtonDownstroke: 142 }, true),
  [false, 'button-stroke:office'], 'the chevrons overrule the fitted rule');
assert.deepEqual(evidence({ maskOn: false }, true), [false, 'mask-rule']);
assert.deepEqual(evidence({ maskOn: null, gridLuma: 44 }, true), [false, 'grid-luma-refutation']);
assert.deepEqual(evidence({ maskOn: null, gridLuma: 4 }, true), [null, 'stroke-unavailable'],
  'darkness never asserts mask-on: a blackout reads the same');
assert.deepEqual(evidence({ maskOn: null, gridLuma: 44 }, false), [null, 'stroke-unavailable'],
  'the luma floor refutes a believed mask-on and nothing else');
assert.deepEqual(evidence({ maskOn: false, gridLuma: 44, maskButtonDownstroke: 60, monitorButtonDownstroke: 60 }, true),
  [null, 'stroke-signature-absent'], 'an unidentified frame withholds an answer');

console.log('control exclusion: safe complements, non-inference, and contradiction refusal pass');
