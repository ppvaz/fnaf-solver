// The footstep cue draws under sourcedFootstepDraws (dump g695-g703): one Random(5) per roll hop onto a
// marker that overlaps `hear footsteps` (cams 01/2/3/4, hall stage 1/2), Random(3) for Mangle.
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';

const BASE = { night: 7, seed: 111, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
               boxEnabled: false, foxyEnabled: false, sourcedSecondPass: true, sourcedSheetOrder: true };
const script = s => { const log = []; s.rng.int = (a, b) => { log.push([s.frame, `${a},${b}`]); return a; }; s.rng.chance = () => false; return log; };

assert.throws(() => new Sim({ night: 7, sourcedFootstepDraws: true }), /requires sourcedSheetOrder/);

// Withered Bonnie hops 7 -> hall stage 1 (blindA): one Random(5) that frame; a further hop off it draws nothing.
{
  const s = new Sim({ ...BASE, sourcedFootstepDraws: true }); s.frame = 1000;
  const u = s.units.find(x => x.id === 'withbonnie'); u.idx = u.path.indexOf(7);
  const log = script(s);
  s.advanceUnit(u); s.tick();
  assert.equal(u.path[u.idx], 'blindA');
  assert.deepEqual(log.filter(([, k]) => k === '0,4').map(([f]) => f), [1001], 'one Random(5) on the hop frame');
  s.tick(); s.tick();
  assert.equal(log.filter(([, k]) => k === '0,4').length, 1, 'no draw while standing there');
  s.advanceUnit(u); s.tick();
  assert.equal(u.path[u.idx], 1);
  assert.equal(log.filter(([, k]) => k === '0,4').length, 1, 'cam 01 is not a footstep trigger');
}

// Withered Freddy 8 -> 7 -> 3: neither is a hall stage, no draw; 3 -> hall stage 2 draws.
{
  const s = new Sim({ ...BASE, sourcedFootstepDraws: true }); s.frame = 1000;
  const u = s.units.find(x => x.id === 'withfreddy');
  const log = script(s);
  s.advanceUnit(u); s.tick(); assert.equal(u.path[u.idx], 7);
  assert.equal(log.filter(([, k]) => k === '0,4').length, 0, 'cam 7 is not a footstep marker');
  s.advanceUnit(u); s.tick(); assert.equal(u.path[u.idx], 3);
  assert.equal(log.filter(([, k]) => k === '0,4').length, 0, 'cam 3 neither');
  s.advanceUnit(u); s.tick(); assert.equal(u.path[u.idx], 'blindB');
  assert.equal(log.filter(([, k]) => k === '0,4').length, 1, 'hall stage 2 draws');
}

// Mangle onto hall stage 1 (blindA) draws Random(3), not Random(5).
{
  const s = new Sim({ ...BASE, sourcedFootstepDraws: true }); s.frame = 1000;
  const u = s.units.find(x => x.id === 'mangle'); u.idx = u.path.indexOf(7);
  const log = script(s);
  s.advanceUnit(u); s.tick(); assert.equal(u.path[u.idx], 'blindA');
  assert.deepEqual(log.map(([, k]) => k).filter(k => k === '0,2' || k === '0,4'), ['0,2']);
}

// Off: the default is unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  if (new Sim({ night: 7, seed: 1 }).opts.sourcedFootstepDraws === false)
    assert.equal(run({}), run({ sourcedFootstepDraws: false }), 'explicit off equals the default');
}
console.log('footstep draws: one Random(5) per roll hop onto hall stage 1 or 2, Random(3) for Mangle, none elsewhere or while standing; off unchanged');
