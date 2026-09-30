// Mangle's mask-leave return under sourcedMangleReturn (dump g400/g401: CAM 7, not the route start).
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.js';
const QUIET = { night: 7, seed: 121, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false, boxEnabled: false, foxyEnabled: false };
const leave = opts => { const s = new Sim({ ...QUIET, ...opts }); const m = s.units.find(u => u.id === 'mangle'); m.idx = m.path.indexOf('ventR'); m.atOpening = true; s.unitLeave(m); return m.path[m.idx]; };
assert.equal(leave({ sourcedMangleReturn: true }), 7, 'a mask leave puts Mangle at CAM 7');
assert.equal(leave({}), 12, 'the default keeps the route start');
{
  const s = new Sim({ ...QUIET, sourcedMangleReturn: true }); const b = s.units.find(u => u.id === 'withbonnie'); b.idx = b.path.indexOf('ventL'); b.atOpening = true; s.unitLeave(b);
  assert.equal(b.path[b.idx], 7, 'the other units keep their sourced repel index');
}
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  if (new Sim({ night: 7, seed: 1 }).opts.sourcedMangleReturn === false) assert.equal(run({}), run({ sourcedMangleReturn: false }), 'explicit off equals the default');
}
console.log('mangle return: a mask leave lands on CAM 7 under the option, the route start by default; other units unchanged');
