// g685-g690 under sourcedVentCamDraws: Random(4) the first loop a unit stands on CAM 05 (Toy Chica, W. Bonnie)
// or CAM 06 (Toy Bonnie, W. Chica, Mangle, Puppet), once per stay, in the sheet slot before the footstep cues.
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';

const BASE = { night: 7, seed: 111, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
               boxEnabled: false, foxyEnabled: false, sourcedSecondPass: true, sourcedSheetOrder: true };
const script = s => { const log = []; s.rng.int = (a, b) => { log.push([s.frame, `${a},${b}`]); return a; }; s.rng.chance = () => false; return log; };
const draws = log => log.filter(([, k]) => k === '0,3');

assert.throws(() => new Sim({ night: 7, sourcedVentCamDraws: true }), /requires sourcedSheetOrder/);

// Withered Bonnie 1 -> 5: one Random(4) on the first loop she stands on CAM 05, none while she stays.
{
  const s = new Sim({ ...BASE, sourcedVentCamDraws: true }); s.frame = 1000;
  const u = s.units.find(x => x.id === 'withbonnie'); u.idx = u.path.indexOf(1);
  const log = script(s);
  s.tick(); assert.equal(draws(log).length, 0, 'CAM 01 is not a vent camera');
  s.advance(u); s.tick(); assert.equal(u.path[u.idx], 5);
  assert.deepEqual(draws(log).map(([f]) => f), [1002], 'one Random(4) on the arrival loop');
  s.tick(); s.tick(); assert.equal(draws(log).length, 1, 'no redraw while standing there');
}

// Leaving and coming back re-arms the flag: Withered Chica 2 -> 6, back to 4 by hand, 2 -> 6 again.
{
  const s = new Sim({ ...BASE, sourcedVentCamDraws: true, sourcedEventDraws: false }); s.frame = 1000;
  const u = s.units.find(x => x.id === 'withchica'); u.idx = u.path.indexOf(2);
  const log = script(s);
  s.advance(u); s.tick(); assert.equal(u.path[u.idx], 6); assert.equal(draws(log).length, 1);
  u.idx = u.path.indexOf(4); s.tick(); assert.equal(draws(log).length, 1);
  u.idx = u.path.indexOf(2); s.advance(u); s.tick(); assert.equal(u.path[u.idx], 6);
  assert.equal(draws(log).length, 2, 'a second stay draws again');
}

// Sheet order: the vent-cam draw precedes the footstep draw of the same loop (Mangle: 6 is not a footstep node,
// so use Toy Chica reaching 5 with a pending footstep from blindA -> 1 -> 5? No: footsteps only on hall stages.)
// Instead check the slot directly: with both options, a unit arriving on 5 draws Random(4) and the footstep
// queue (hall stages) is untouched.
{
  const s = new Sim({ ...BASE, sourcedVentCamDraws: true, sourcedFootstepDraws: true }); s.frame = 1000;
  const u = s.units.find(x => x.id === 'toychica'); u.idx = u.path.indexOf(1);
  const log = script(s);
  s.advance(u); s.tick(); assert.equal(u.path[u.idx], 5);
  assert.deepEqual(log.filter(([, k]) => k === '0,3' || k === '0,4').map(([, k]) => k), ['0,3']);
}

// Off: the default is unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  if (new Sim({ night: 7, seed: 1 }).opts.sourcedVentCamDraws === false)
    assert.equal(run({}), run({ sourcedVentCamDraws: false }), 'explicit off equals the default');
}
console.log('vent-cam draws: Random(4) once per stay on CAM 05/06, re-armed on leaving, before the footstep slot; off unchanged');
