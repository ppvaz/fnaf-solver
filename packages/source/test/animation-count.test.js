// sourcedAnimationCount: the latches g1 (monitor fully up, >= 12), g6 (fully down, >= 22), g9 (mask fully on, >= 12) and
// g10 (fully off, >= 14) fire at the top of the Nth loop after their Active is shown. The model spent constant - 1 updates
// moving, one fewer than the sheet for the raise, the drop and the mask going on (MASK_ANIM_OFF = 15 already gives 14).
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.js';

const QUIET = { night: 7, seed: 5, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                boxEnabled: false, foxyEnabled: false };

/** The tick an animation finishes on, counted from the tick it starts on (a press applies before its tick). */
const span = (opts, start, done) => {
  const s = new Sim({ ...QUIET, ...opts });
  s.tick();
  start(s);
  let n = 0;
  while (!done(s) && n < 100) { s.tick(); n += 1; }
  return n - 1;
};

const raise = (opts) => span(opts, (s) => s.setMonitor(true), (s) => s.monitor === 'up');
const drop = (opts) => span(opts, (s) => { s.monitor = 'up'; s.setMonitor(false); }, (s) => s.monitor === 'down');
const maskOn = (opts) => span(opts, (s) => s.setMask(true), (s) => s.maskFullyOn);
const maskOff = (opts) => span(opts, (s) => { s.maskOn = true; s.setMask(false); }, (s) => s.maskFullyOff);

assert.deepEqual([raise({}), drop({}), maskOn({}), maskOff({})], [11, 21, 11, 14], 'off: one update short of g1, g6 and g9');
const on = { sourcedAnimationCount: true };
assert.deepEqual([raise(on), drop(on), maskOn(on), maskOff(on)], [12, 22, 12, 14], 'on: g1 >= 12, g6 >= 22, g9 >= 12, g10 >= 14');

// Off leaves the default unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ sourcedAnimationCount: false }), 'off equals the default');
}

console.log('animation count: the raise, the drop and the mask going on take 12, 22 and 12 updates, as g1, g6 and g9 count them; off unchanged');
