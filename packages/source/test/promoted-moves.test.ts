// sourcedPromotedMoves: a route move needs value 0 == 2, and the promotion test (g344-g358) gates only the
// promotion. Mangle's g358 promotes her with viewing == 0 only while `viewing hall light` == 0, on every hop,
// so a roll passed on a latched loop waits for the latch to clear before she moves (Night 7 k3's replay, tick
// 1800: CAM 02 -> CAM 01 a loop later in the rebuilt runtime). And the moves (g374-g435) never re-test value 1
// or the marker, so a promoted unit that is flashed while its move waits on the latch still moves. Off: the
// stun and the marker are re-tested at the move, and Mangle has no latch gate off her CAM 07 / hall hops.
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';
import type { Unit } from '../src/games/fnaf2/plant-model.ts';
import type { RouteNode } from '../src/games/fnaf2/config.ts';
import type { SimOptions } from '../src/games/fnaf2/plant-options.ts';
import { LEGACY_SIM_OPTIONS } from '../src/games/fnaf2/plant-options.ts';

const QUIET = { night: 7, seed: 5, lethal: false, bbEnabled: false, gfEnabled: false, boxEnabled: false, foxyEnabled: false };
const LATCHED = Number.MAX_SAFE_INTEGER;

/** A Sim whose only roller is `id` (AI 20, a sure pass), standing on `node` with the hall-light latch `latch`. */
const setup = (opts: Partial<SimOptions>, id: string, node: RouteNode) => {
  const s = new Sim({ ...LEGACY_SIM_OPTIONS, ...QUIET, ...opts });
  for (const k of Object.keys(s.ai)) s.ai[k] = 0;
  s.ai[id] = 20;
  const u = s.units.find(x => x.id === id) as Unit;   // one of the seven route units
  u.idx = u.path.indexOf(node);
  assert.ok(u.idx >= 0, `${id} stands on ${node}`);
  u.stunUntil = -1;
  s.lightLogicalUntil = LATCHED;             // `viewing hall light` set, monitor down
  return { s, u };
};

// Mangle on CAM 02, monitor down, roll passed on a latched loop.
{
  const off = setup({}, 'mangle', 2);
  off.s.rollAllFiveSecond();
  assert.equal(off.u.path[off.u.idx], 6, 'off: Mangle moves CAM 02 -> 06 on the latched roll loop');

  const on = setup({ sourcedPromotedMoves: true }, 'mangle', 2);
  on.s.rollAllFiveSecond();
  assert.equal(on.u.path[on.u.idx], 2, 'on: g358 refuses the promotion while the latch is set');
  assert.deepEqual([on.u.pending, on.u.promoted], [true, false], 'on: value 0 stays 1');
  on.s.tickUnits(on.s.frame);
  assert.equal(on.u.path[on.u.idx], 2, 'on: still latched, still waiting');
  on.s.lightLogicalUntil = -1;               // g488 cleared it
  on.s.tickUnits(on.s.frame);
  assert.equal(on.u.path[on.u.idx], 6, 'on: promoted and moved on the first loop the latch reads 0');
  assert.deepEqual([on.u.pending, on.u.promoted], [false, false], 'on: the move writes value 0 = 0');

  // With the monitor up g357 promotes her regardless of the latch (the marker is parked elsewhere).
  const up = setup({ sourcedPromotedMoves: true }, 'mangle', 2);
  up.s.monitor = 'up'; up.s.viewing = 9; up.s.cam = 9;
  up.s.rollAllFiveSecond();
  assert.equal(up.u.path[up.u.idx], 6, 'on, cameras up: g357 promotes, g396 moves on the roll loop');
}

// Toy Chica on CAM 07: promoted on a latched loop (g354/g355 carry no latch), held by g431's latch, then flashed.
{
  const run = (opts: Partial<SimOptions>) => {
    const { s, u } = setup(opts, 'toychica', 7);
    s.rollAllFiveSecond();
    const held = u.path[u.idx];
    u.stunUntil = s.frame + 400;               // a camera flash: value 1 = 400
    s.lightLogicalUntil = -1;
    s.tickUnits(s.frame);
    return { held, after: u.path[u.idx], promoted: u.promoted };
  };
  const off = run({});
  const on = run({ sourcedPromotedMoves: true });
  assert.deepEqual([off.held, on.held], [7, 7], 'both: g431 holds the move while the latch is set');
  assert.equal(off.after, 7, 'off: the stun is re-tested at the move');
  assert.equal(on.after, 'blindA', 'on: g431 tests value 0 == 2 and the latch, not value 1: the promoted move lands');
}

// Off leaves the default unchanged.
{
  const run = (opts: Partial<SimOptions>) => { const x = new Sim({ ...LEGACY_SIM_OPTIONS, night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ sourcedPromotedMoves: false }), 'off equals the default');
}

console.log('promoted moves: a move needs value 0 == 2; g358 latches Mangle\'s promotion on every hop; moves never re-test the stun; off unchanged');
