import { strict as assert } from 'node:assert';
import { BbCueState, BB_POSITION as P } from './bb-cue-state.mjs';

const safe = { stunsCurrent: true, boxWound: true };
const voice = { cue: 'bb_voice', role: 'route' };
const bang = { cue: 'bang' };

{
  const bb = new BbCueState();
  assert.deepEqual(bb.snapshot().positions, [P.CAM10]);
  // The first hop is silent, so no observation must retain stay + CAM 7.
  assert.deepEqual(bb.movementOpportunity({ monitorUp: true, invariants: safe }).positions,
    [P.CAM10, P.CAM7]);
  assert.deepEqual(bb.movementOpportunity({ monitorUp: true, events: [voice], invariants: safe }).positions,
    [P.CAM3]);
  assert.deepEqual(bb.movementOpportunity({ monitorUp: true, events: [voice], invariants: safe }).positions,
    [P.CAM1]);
  const cam5 = bb.movementOpportunity({ monitorUp: true, events: [voice, bang], invariants: safe });
  assert.deepEqual(cam5.positions, [P.CAM5]);
  assert.equal(cam5.directive, 'prepare-cam5');

  const held = bb.movementOpportunity({ monitorUp: false, invariants: safe });
  assert.deepEqual(held.positions, [P.CAM5, P.CAM5_PENDING]);
  assert.equal(held.directive, 'await-opening');
  const opening = bb.monitorRaised({ events: [bang, voice], invariants: safe });
  assert.deepEqual(opening.positions, [P.OPENING]);
  assert.equal(opening.directive, 'mask-now');
  assert.equal(bb.beginMask().directive, 'hold-mask');
  const departure = bb.maskedWindow({ events: [bang], invariants: safe });
  assert.deepEqual(departure.positions, [P.CAM10]);
  assert.equal(departure.directive, 'recover-early');
}

{
  const bb = new BbCueState();
  bb.movementOpportunity({ monitorUp: true, invariants: safe });
  // A loud/unknown vocal on a selected BB camera is not a route movement.
  const ignored = bb.movementOpportunity({
    monitorUp: true,
    events: [{ cue: 'bb_voice', role: 'view' }],
    invariants: safe,
  });
  assert.equal(ignored.note, 'view-or-route-voice-ignored');
  assert(ignored.positions.includes(P.CAM10) && ignored.positions.includes(P.CAM3));
}

{
  const bb = new BbCueState();
  const failed = bb.movementOpportunity({
    monitorUp: true,
    events: [bang],
    invariants: { stunsCurrent: false, boxWound: true },
  });
  assert.equal(failed.directive, 'abort');
  assert.equal(failed.fault, 'bang-attribution-invalid');
}

{
  const bb = new BbCueState();
  assert.equal(bb.beginMask().fault, 'mask-without-confirmed-opening');
}

{
  const bb = new BbCueState();
  bb.positions = new Set([P.OPENING]);
  bb.beginMask();
  for (let tick = 0; tick < 4; tick++)
    assert.equal(bb.maskedWindow({ elapsedTick: true, invariants: safe }).directive, 'hold-mask');
  const last = bb.maskedWindow({ elapsedTick: true, invariants: safe });
  assert.equal(last.directive, 'abort');
  assert.equal(last.fault, 'departure-cue-missed');
}

console.log('BB cue state: source route, composites, ambiguity, and fail-closed gates pass');
