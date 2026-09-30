// The mask answers only at rest: g270 puts it on from `mask` == 0 and g615
// takes it off from `mask` == 2, so a press during the put-on (1) or take-off
// (3) animation is dropped. The simulator used to toggle mid-animation and so
// scored plans the phone does not execute.
import assert from 'node:assert/strict';
import * as C from '../src/games/fnaf2/index.js';

const sim = new C.Sim({ night: 1, seed: 1 });
sim.press('mask');
assert.equal(sim.maskOn, true, 'a mask press at rest puts the mask on');
sim.tick();
sim.press('mask');
assert.equal(sim.maskOn, true, 'a second press inside the 12-frame put-on animation is dropped');
for (let i = 0; i < C.MASK_ANIM_ON; i++) sim.tick();
sim.press('mask');
assert.equal(sim.maskOn, false, 'once the mask is fully on, a press takes it off');
sim.tick();
sim.press('mask');
assert.equal(sim.maskOn, false, 'a press inside the take-off animation is dropped');
for (let i = 0; i < C.MASK_ANIM_OFF; i++) sim.tick();
sim.press('mask');
assert.equal(sim.maskOn, true, 'at rest again, the mask goes back on');
console.log('mask animation input: presses inside either mask animation are dropped');
