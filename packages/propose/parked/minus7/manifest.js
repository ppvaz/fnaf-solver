export const MANIFEST = Object.freeze({
  id: 'minus-7',
  legacyIds: ['minus7'],
  name: 'Minus 7',
  family: 'camera-stall',
  target: '10/20',
  canonicalNights: Object.freeze([7]),
  // The monitor stays down; the route uses no FNaF 2 mechanic a run may forbid.
  requires: Object.freeze([]),
  claim: 'MODEL_ONLY',
  status: 'model-route',
  source: 'docs/strategy/MINUS-7-STRATEGY.md',
  notes: Object.freeze([
    'The monitor stays down on every five-second interval.',
    'This module describes the plant model; device composition remains an adapter.',
  ]),
});
