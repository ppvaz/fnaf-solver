// sourcedRouteViewDraws: g366/g368 sit between the promotions and the moves, and g419 before Toy Freddy's own moves,
// so a Toy promoted and moved off the viewed camera on one loop still draws where it stood (Night 5 contact-final tick
// 22241: Toy Bonnie leaves CAM 09 with your view on it). Off: the model drew them after every move.
import assert from 'node:assert/strict';
import { Sim } from '../src/mechanics/plant-model.js';

const SOURCED = { sourcedDropLightOrder: true, sourcedFoxyChain: true, sourcedSecondPass: true, sourcedSheetOrder: true,
                  sourcedRollDraws: true, sourcedViewDraws: true, sourcedPromotedViewDraws: true,
                  sourcedPromotedMoves: true, sourcedRollsBeforeMoves: true, sourcedRoutePass: true };
const QUIET = { night: 5, seed: 5, lethal: false, bbEnabled: false, gfEnabled: false, boxEnabled: false, foxyEnabled: false };

assert.throws(() => new Sim({ ...QUIET, sourcedRoutePass: true, sourcedPromotedMoves: true, sourcedRollsBeforeMoves: true,
  sourcedRouteViewDraws: true }), /requires sourcedRoutePass and sourcedPromotedViewDraws/);

/** Toy Bonnie waiting on CAM 09 with value 1 at 0, the monitor up on CAM 09: g366 draws on the loop he moves? */
const drawsOnMoveLoop = (opts) => {
  const s = new Sim({ ...QUIET, ...SOURCED, ...opts });
  const u = s.units.find(x => x.id === 'toybonnie');
  u.idx = 0; u.pending = true; u.promoted = false; u.stunUntil = -1;
  s.monitor = 'up'; s.viewing = 9; s.cam = 9;
  let n = 0;
  const int = s.rng.int.bind(s.rng);
  s.rng.int = (a, b, ...r) => { if (b === 99) n += 1; return int(a, b, ...r); };
  s.routePass(s.frame);
  s.drawViewed(s.frame, 'g366');
  return { draws: n, node: u.path[u.idx] };
};
assert.deepEqual(drawsOnMoveLoop({}), { draws: 0, node: 3 }, 'off: he has left CAM 09 when g366 is read');
assert.deepEqual(drawsOnMoveLoop({ sourcedRouteViewDraws: true }), { draws: 1, node: 3 }, 'on: g366 draws before his move');

// Off leaves the default unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ sourcedRouteViewDraws: false }), 'off equals the default');
}

console.log('route view draws: g366/g368 before the moves and g419 before Toy Freddy\'s, in the sheet\'s move order; off unchanged');
