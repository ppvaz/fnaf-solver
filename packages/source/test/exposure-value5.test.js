// sourcedExposureValue5: g745 adds `1 * Global(5)` to Withered Foxy's hall exposure and g779 to hallway Golden Freddy's;
// g846 (> 100 * night) and g780 (> 100) compare them strictly, so with value 5 a hair above 1 the Nth lit loop already
// passes > N (Night 7 k3 tick 20449: Foxy's retreat on his 700th lit loop). Off: both count 1 per loop.
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.js';

const SOURCED = { sourcedDropLightOrder: true, sourcedFoxyChain: true, sourcedSecondPass: true, sourcedSheetOrder: true,
                  frameMs: () => 50 / 3, sourcedValue5: true };
const QUIET = { night: 7, seed: 5, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false, boxEnabled: false };

assert.throws(() => new Sim({ ...QUIET, sourcedExposureValue5: true }), /requires sourcedValue5/);

/** Foxy in the hall with the latch held: the loop count at which g846 would pass once the latch and B clear. */
const loopsToRetreat = (opts) => {
  const s = new Sim({ ...QUIET, ...SOURCED, ...opts });
  const fx = s.foxy;
  fx.loc = 'hall';
  let n = 0;
  while (!(fx.exposure > 100 * 7) && n < 1000) { s.hallLatch = true; s.tickFoxyChain(s.frame); n += 1; s.frame += 1; }
  return n;
};
assert.equal(loopsToRetreat({}), 701, 'off: 701 lit loops before 700 is passed');
assert.equal(loopsToRetreat({ sourcedExposureValue5: true }), 700, 'on: 700 loops of a hair above 1 pass > 700');

// Off leaves the default unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ sourcedExposureValue5: false }), 'off equals the default');
}

console.log('exposure value 5: g745 and g779 add value 5, so g846 and g780 pass on the Nth loop; off unchanged');
