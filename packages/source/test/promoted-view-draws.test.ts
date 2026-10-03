// sourcedPromotedViewDraws: g366/g368/g419 draw only for a Toy whose move is promoted (value 0 == 2), and
// g344-g360 write the fade counter C = 10 at that promotion, not at the roll. The schedule replays into the
// rebuilt runtime split on this on all three nights (packages/source/recompile/README.md, "Winner schedules replayed").
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';
import type { Unit } from '../src/games/fnaf2/plant-model.ts';
import type { SimOptions } from '../src/games/fnaf2/plant-options.ts';
import { LEGACY_SIM_OPTIONS } from '../src/games/fnaf2/plant-options.ts';

const SOURCED = { sourcedDropLightOrder: true, sourcedFoxyChain: true, sourcedSecondPass: true, sourcedSheetOrder: true,
                  sourcedViewDraws: true };
const QUIET = { night: 7, seed: 5, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                boxEnabled: false, foxyEnabled: false };

assert.throws(() => new Sim({ ...LEGACY_SIM_OPTIONS, night: 1, sourcedPromotedViewDraws: true }), /requires sourcedViewDraws/);

/** Random(100) draws spent by one call of drawViewed(part) with the monitor up on the Toy's room. */
const viewDraws = (opts: Partial<SimOptions>, id: string, part: string, setup: (u: Unit, s: Sim) => void) => {
  const s = new Sim({ ...LEGACY_SIM_OPTIONS, ...QUIET, ...SOURCED, ...opts });
  const u = s.units.find(x => x.id === id) as Unit;   // one of the seven route units
  s.viewing = 1; s.cam = u.path[u.idx] as number;   // a Toy waits on a camera
  setup(u, s);
  let n = 0;
  const int = s.rng.int.bind(s.rng);
  s.rng.int = (a, b, w) => { if (a === 0 && b === 99) n += 1; return int(a, b, w); };
  s.drawViewed(s.frame, part);
  return n;
};

for (const [id, part] of [['toybonnie', 'g366'], ['toychica', 'g368'], ['toyfreddy', 'g419']]) {
  const held = (u: Unit) => { u.pending = true; u.promoted = false; };      // a passed roll held at value 0 == 1
  const promoted = (u: Unit) => { u.pending = true; u.promoted = true; };   // value 0 == 2
  assert.equal(viewDraws({}, id, part, held), 1, `off: ${part} draws for any pending roll`);
  assert.equal(viewDraws({ sourcedPromotedViewDraws: true }, id, part, held), 0, `on: ${part} is silent at value 0 == 1`);
  assert.equal(viewDraws({ sourcedPromotedViewDraws: true }, id, part, promoted), 1, `on: ${part} draws at value 0 == 2`);
}

// The fade counter: a roll into the stun marks nothing; the promotion, once B is 0, writes C = 10.
{
  const s = new Sim({ ...LEGACY_SIM_OPTIONS, ...QUIET, ...SOURCED, sourcedPromotedViewDraws: true });
  const u = s.units.find(x => x.id === 'toyfreddy') as Unit;   // one of the seven route units
  u.stunUntil = s.frame + 100;
  s.footstepPromote(u, true);
  assert.equal(u.promoted, false, 'stunned: the roll is not promoted');
  assert.equal(s.fadeUntil.toyfreddy, undefined, 'stunned: no fade at the roll');
  u.stunUntil = -1;
  s.footstepPromote(u, false);
  assert.equal(u.promoted, true, 'B = 0: promoted');
  assert.equal(s.fadeUntil.toyfreddy, s.frame + 8, 'the fade starts at the promotion');
}

// Off leaves the default unchanged.
{
  const run = (opts: Partial<SimOptions>) => { const x = new Sim({ ...LEGACY_SIM_OPTIONS, night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ sourcedPromotedViewDraws: false }), 'off equals the default');
}

console.log('promoted view draws: g366/g368/g419 only at value 0 == 2, the fade at promotion; off unchanged');
