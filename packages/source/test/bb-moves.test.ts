// sourcedBBMoves: Balloon Boy's hops are g413-g418, after the other units' moves and after the Paper Pals roll (g343);
// g414-g416 draw his cue there, and g611 redraws a cue of 4 much later in the loop (after g556-g559). Off: he hops, and a
// 4 is redrawn, inside the roll pass, before the Paper Pals roll.
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';

const SOURCED = { sourcedDropLightOrder: true, sourcedFoxyChain: true, sourcedSecondPass: true, sourcedSheetOrder: true,
                  sourcedRollDraws: true, sourcedEventDraws: true, sourcedPromotedMoves: true, sourcedRollsBeforeMoves: true,
                  sourcedRoutePass: true };
const QUIET = { night: 7, seed: 5, lethal: false, stalledEnabled: false, gfEnabled: false, boxEnabled: false, foxyEnabled: false };

assert.throws(() => new Sim({ ...QUIET, sourcedBBMoves: true }), /requires sourcedRoutePass/);

/** The draws of one roll loop with Balloon Boy on CAM 07 and a sure roll: labels in draw order. */
const loop = (opts, seed = 5) => {
  const s = new Sim({ ...QUIET, ...SOURCED, seed, ...opts });
  for (const k of Object.keys(s.ai)) s.ai[k] = 0;
  s.ai.bb = 20;
  s.bb.stage = 1;
  const log = [];
  const int = s.rng.int.bind(s.rng), chance = s.rng.chance.bind(s.rng);
  s.rng.chance = (p, ...r) => { log.push('roll'); return chance(p, ...r); };
  s.rng.int = (a, b, ...r) => { log.push(b === 19 ? 'pals' : b === 3 ? 'cue' : `int ${a},${b}`); return int(a, b, ...r); };
  s.rollAllFiveSecond();
  s.routePass(s.frame);
  return { log, stage: s.bb.stage };
};

{
  const off = loop({});
  const on = loop({ sourcedBBMoves: true });
  assert.deepEqual([off.stage, on.stage], [2, 2], 'both: CAM 07 -> CAM 03 on the roll loop');
  assert.ok(off.log.indexOf('cue') < off.log.indexOf('pals'), 'off: the cue is drawn inside the roll pass');
  assert.ok(on.log.indexOf('cue') > on.log.indexOf('pals'), 'on: g414 draws it after the Paper Pals roll (g343)');
}

// A cue of 4 waits for g611 (after g556-g559) instead of being redrawn at the hop.
{
  let seed = 1, found = null;
  for (; seed < 400 && !found; seed += 1) {
    const s = new Sim({ ...QUIET, ...SOURCED, seed, sourcedBBMoves: true });
    s.bb.stage = 1;
    s.bbHop();
    if (s.bb.cueRedraw) found = s;
  }
  assert.ok(found, 'some seed draws a cue of 4');
  const before = found.rng.state;
  found.secondPassLate(found.frame);
  assert.equal(found.bb.cueRedraw, false, 'g611 spends the redraw in the late pass');
  assert.notEqual(found.rng.state, before);
}

// Off leaves the default unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ sourcedBBMoves: false }), 'off equals the default');
}

console.log('BB moves: g413-g418 in the route pass after the Paper Pals roll, and g611 redraws a 4 in the late pass; off unchanged');
