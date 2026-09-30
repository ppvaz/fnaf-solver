// The eleven 5 s movement rolls under sourcedRollDraws (dump g333-g343): every roll draws, in sheet order.
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';
import * as C from '../src/games/fnaf2/config.ts';

const QUIET = { night: 7, seed: 41, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                boxEnabled: false, foxyEnabled: false };

// Records every draw the next onFiveSecond makes: ['chance', p] or ['int', min, max].
const recordRoll = s => {
  const calls = [];
  const chance = s.rng.chance.bind(s.rng), int = s.rng.int.bind(s.rng);
  s.rng.chance = (p, w) => { calls.push(['chance', p]); return chance(p, w); };
  s.rng.int = (a, b, w) => { calls.push(['int', a, b]); return int(a, b, w); };
  s.onFiveSecond();
  s.rng.chance = chance; s.rng.int = int;
  return calls;
};

// Sheet order with distinct AIs, even with every character disabled or gated.
{
  const s = new Sim({ ...QUIET, sourcedRollDraws: true });
  Object.assign(s.ai, { withfreddy: 1, withbonnie: 2, withchica: 3, golden: 4, foxy: 5,
                        toyfreddy: 6, toybonnie: 7, toychica: 8, mangle: 9, bb: 10 });
  const expected = [
    ['chance', C.MO_CHANCE(1)], ['chance', C.MO_CHANCE(2)], ['chance', C.MO_CHANCE(3)],   // g333-g335
    ['chance', C.MO_CHANCE(4)],                                                            // g336 Golden Freddy
    ['int', 0, 4],                                                                         // g337 Foxy
    ['chance', C.MO_CHANCE(6)], ['chance', C.MO_CHANCE(7)], ['chance', C.MO_CHANCE(8)],    // g338-g340
    ['chance', C.MO_CHANCE(9)], ['chance', C.MO_CHANCE(10)],                               // g341 Mangle, g342 BB
    ['int', 0, 19],                                                                        // g343 Paper Pals
  ];
  assert.deepEqual(recordRoll(s), expected);
}

// Gated characters still draw: a unit at the opening, Balloon Boy in the opening, Golden Freddy with the monitor down.
{
  const s = new Sim({ ...QUIET, stalledEnabled: true, bbEnabled: true, gfEnabled: true, foxyEnabled: true, sourcedRollDraws: true });
  s.units.find(x => x.id === 'withbonnie').atOpening = true;
  s.bb.inOpening = true; s.monitor = 'down';
  assert.equal(recordRoll(s).length, 11);
  const d = new Sim({ ...QUIET, stalledEnabled: true, bbEnabled: true, gfEnabled: true, foxyEnabled: true });
  d.units.find(x => x.id === 'withbonnie').atOpening = true;
  d.bb.inOpening = true; d.monitor = 'down';
  assert.ok(recordRoll(d).length < 11, 'the default skips the gated draws');
}

// A tick on a 5 s frame advances the stream by exactly the eleven roll draws in a quiet simulator.
{
  const s = new Sim({ ...QUIET, sourcedRollDraws: true }); s.frame = C.MO_FRAMES - 1;
  let st = s.rng.state; s.tick();
  let n = 0; while (st !== s.rng.state && n < 20) { st = (st * 31415 + 1) & 0xffff; n++; }
  assert.equal(n, 11);
}

// Off: the default is unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  if (new Sim({ night: 7, seed: 1 }).opts.sourcedRollDraws === false)
    assert.equal(run({}), run({ sourcedRollDraws: false }), 'explicit off equals the default');
}
console.log('roll draws: eleven 5 s rolls in sheet order g333-g343, gated characters still draw, a 5 s tick spends exactly eleven; off unchanged');
