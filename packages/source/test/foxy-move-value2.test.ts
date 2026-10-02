// sourcedFoxyMoveValue2 (default off): g389 (generated e317) moves Foxy from CAM 08 to hall stage 1 and
// sets his value 2 = 10 itself, so g698's footstep cue draws on every move, not only within ten loops of
// g349's acceptance. Night 7 10/20 k3 at seed 27656: accepted on office loop 300, value 2 drained to 0 by
// 309, moved on 361 with value 2 = 10 again, and the rebuilt runtime drew Random(5) there.
// tools/recompile/results/model-foxy-move-value2-20260929.json
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';

const ON = { sourcedDropLightOrder: true, sourcedFoxyChain: true, sourcedSecondPass: true, sourcedSheetOrder: true,
             sourcedFootstepDraws: true };
const fresh = (extra = {}) => {
  const s = new Sim({ night: 7, seed: 9, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                      boxEnabled: false, ...ON, ...extra });
  s.frame = 1000; s.monitor = 'down'; s.monAnim = 0; s.viewing = 0; s.maskOn = false; s.maskAnim = 0;
  s.hallLatch = false; s.hallLit = false;
  return s;
};
const foxySteps = (s: Sim) => s.events.filter(e => e.type === 'footstep' && e.data?.who === 'foxy').map(e => e.f);

assert.throws(() => new Sim({ night: 7, sourcedDropLightOrder: true, sourcedFoxyChain: true, sourcedFoxyMoveValue2: true }),
  /requires sourcedFootstepDraws and sourcedFoxyChain/);
assert.throws(() => new Sim({ night: 7, sourcedSecondPass: true, sourcedSheetOrder: true, sourcedFootstepDraws: true,
  sourcedFoxyMoveValue2: true }), /requires sourcedFootstepDraws and sourcedFoxyChain/);

// An accepted move that the latch held for 40 loops: off, the move is silent; on, it draws on the move.
// Events carry the frame the tick produces: a tick from 1000 moves him on 1001.
for (const [fix, want] of [[false, []], [true, [1001]]]) {
  const s = fresh({ sourcedFoxyMoveValue2: fix }); const fx = s.foxy;
  fx.A = 2; fx.acceptedAt = s.frame - 40; fx.loc = 'parts';
  s.tick();
  assert.equal(fx.loc, 'hall', 'g389 moved him to hall stage 1');
  assert.deepEqual(foxySteps(s), want, `a move 40 loops after the acceptance, sourcedFoxyMoveValue2 ${fix}`);
  const before = foxySteps(s).length;
  for (let i = 0; i < 30; i += 1) s.tick();
  assert.equal(foxySteps(s).length, before, 'no second draw while he stands there');
}

// A move inside g349's ten loops draws either way: the option changes only the late move.
for (const fix of [false, true]) {
  const s = fresh({ sourcedFoxyMoveValue2: fix }); const fx = s.foxy;
  fx.A = 2; fx.acceptedAt = s.frame - 5; fx.loc = 'parts';
  s.tick();
  assert.deepEqual(foxySteps(s), [1001], `a move five loops after the acceptance, sourcedFoxyMoveValue2 ${fix}`);
}

// The latch still holds the move, and the draw comes with the move, not with the acceptance.
{
  const s = fresh({ sourcedFoxyMoveValue2: true }); const fx = s.foxy;
  fx.A = 2; fx.acceptedAt = s.frame; fx.loc = 'parts'; s.hallLatch = true;
  s.updateHallLatch = () => {};                     // hold the latch set, as a lit hall would
  for (let i = 0; i < 20; i += 1) s.tick();
  assert.equal(fx.loc, 'parts', 'the latch held the move');
  assert.deepEqual(foxySteps(s), [], 'no draw while the move waits');
  s.hallLatch = false;
  const at = s.frame + 1; s.tick();
  assert.equal(fx.loc, 'hall');
  assert.deepEqual(foxySteps(s), [at], 'the draw lands on the move');
}

console.log('foxy-move-value2: g389 writes value 2, and g698 draws on every move to hall stage 1');
