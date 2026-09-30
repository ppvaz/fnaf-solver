// sourcedRoutePass: every loop, g344-g360 test every waiting roll's promotion, and only then do g374-g435 move the
// promoted units. So on Night 1 Toy Chica's g356 discard reads Toy Bonnie still on CAM 09 on the loop he moves off it
// (the rebuilt runtime, tick 21715). Off: tickUnits settles waiting units one at a time, and Toy Bonnie's move lands
// before Toy Chica's promotion test.
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.js';

const BASE = { night: 1, seed: 5, lethal: false, bbEnabled: false, gfEnabled: false, boxEnabled: false, foxyEnabled: false,
               sourcedRouteForks: true, sourcedRollDraws: true, sourcedPromotedMoves: true, sourcedRollsBeforeMoves: true };

assert.throws(() => new Sim({ night: 1, sourcedRoutePass: true }), /requires sourcedPromotedMoves and sourcedRollsBeforeMoves/);

/** Toy Bonnie and Toy Chica both on CAM 09 with a passed roll and value 1 at 0; one loop of the route logic. */
const loop = (opts) => {
  const s = new Sim({ ...BASE, ...opts });
  for (const id of ['toybonnie', 'toychica']) {
    const u = s.units.find(x => x.id === id);
    u.idx = 0; u.pending = true; u.promoted = false; u.stunUntil = -1;
  }
  s.frame = 100;
  if (opts.sourcedRoutePass) s.routePass(s.frame); else s.tickUnits(s.frame);
  const at = id => { const u = s.units.find(x => x.id === id); return [u.path[u.idx], u.pending]; };
  return { bonnie: at('toybonnie'), chica: at('toychica') };
};

{
  const off = loop({});
  assert.deepEqual(off.bonnie, [3, false], 'off: Toy Bonnie moves CAM 09 -> 03');
  assert.deepEqual(off.chica, [7, false], 'off: Toy Chica, tested after his move, is promoted and moves too');
  const on = loop({ sourcedRoutePass: true });
  assert.deepEqual(on.bonnie, [3, false], 'on: Toy Bonnie moves in the move pass');
  assert.deepEqual(on.chica, [9, false], 'on: g356 read him on CAM 09 in the promotion pass and discarded her roll');
}

// Off leaves the default unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ sourcedRoutePass: false }), 'off equals the default');
}

console.log('route pass: every promotion test, then every move, after the rolls; off unchanged');
