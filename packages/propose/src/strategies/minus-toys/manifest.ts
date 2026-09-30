import { CAMERA_SPLIT } from '@sixam/source/games/fnaf2/mechanics.ts';

export const MANIFEST = Object.freeze({
  id: 'minus-toys',
  legacyIds: Object.freeze(['minustoys']),
  name: 'Minus Toys',
  family: 'camera-glitch',
  target: '10/20',
  canonicalNights: Object.freeze([7]),
  // The CAM 09 marker's toy stall needs the split; without it the route
  // scores 0/200 on 10/20 (minustoystest.mjs --no-split).
  requires: Object.freeze([CAMERA_SPLIT]),
  claim: 'MODEL_ONLY',
  status: 'model-route',
  source: 'docs/strategy/MINUS-3-STRATEGY.md',
  notes: Object.freeze([
    'The route arms the CAM 11-viewing / CAM 09-marker split before the first loop.',
    'The normal route uses a vent-bang ledger; open-loop is retained only as a control.',
  ]),
});
