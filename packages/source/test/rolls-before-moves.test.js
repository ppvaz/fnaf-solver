// sourcedRollsBeforeMoves: g333-g343 roll every character first; promotions (g344-g358) and moves (g380 on)
// follow the last roll. So W. Chica's CAM 02 -> 06 move draw (e324, Random(4)) lands after the Paper Pals roll
// (g343, Random(20)), not between her roll and Golden Freddy's. Off: the move and its draw happen inside the roll
// pass, and every later roll of that loop reads another value (Night 7 k3's replay mismatch at tick 1200).
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.js';

const SOURCED = { sourcedDropLightOrder: true, sourcedFoxyChain: true, sourcedSecondPass: true, sourcedSheetOrder: true,
                  sourcedRollDraws: true, sourcedEventDraws: true };
const QUIET = { night: 7, seed: 5, lethal: false, bbEnabled: false, gfEnabled: false, boxEnabled: false, foxyEnabled: false };

/** The draw sequence of one five-second roll pass with W. Chica one sure roll away from CAM 02 -> 06. */
const rollPass = (opts) => {
  const s = new Sim({ ...QUIET, ...SOURCED, ...opts });
  for (const id of Object.keys(s.ai)) s.ai[id] = 0;
  s.ai.withchica = 20;
  const u = s.units.find(x => x.id === 'withchica');
  u.idx = u.path.findIndex((node, i) => node === 2 && u.path[i + 1] === 6);
  assert.ok(u.idx >= 0, 'W. Chica has a CAM 02 -> 06 edge');
  u.stunUntil = -1;
  const log = [];
  const chance = s.rng.chance.bind(s.rng), int = s.rng.int.bind(s.rng);
  s.rng.chance = (p, ...r) => { log.push('roll'); return chance(p, ...r); };
  s.rng.int = (a, b, ...r) => { log.push(`int ${a},${b}`); return int(a, b, ...r); };
  s.rollAllFiveSecond();
  return { log, node: u.path[u.idx] };
};

{
  const off = rollPass({});
  const on = rollPass({ sourcedRollsBeforeMoves: true });
  assert.equal(off.node, 6, 'off: Chica moved to CAM 06');
  assert.equal(on.node, 6, 'on: Chica still moves to CAM 06 on the same loop');
  const pals = (log) => log.indexOf('int 0,19');
  const e324 = (log) => log.indexOf('int 0,3');
  assert.ok(e324(off.log) >= 0 && e324(off.log) < pals(off.log), 'off: e324 draws inside the roll pass');
  assert.ok(e324(on.log) > pals(on.log), 'on: e324 draws after the Paper Pals roll (g343)');
  assert.equal(on.log.length, off.log.length, 'the same draws, in another order');
}

// Off leaves the default unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ sourcedRollsBeforeMoves: false }), 'off equals the default');
}

console.log('rolls before moves: g333-g343 roll first, promotions and moves after g343; off unchanged');
