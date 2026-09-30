// g811 under sourcedRandomImageDraw: Random(1000) on the first loop `viewing` is 0 -- at night start and after
// every monitor drop -- never while a camera is up, never twice in one stretch.
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.js';

const BASE = { night: 7, seed: 111, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
               boxEnabled: false, foxyEnabled: false };
const script = s => { const log = []; s.rng.int = (a, b) => { log.push([s.frame, `${a},${b}`]); return a; }; s.rng.chance = () => false; return log; };
const draws = log => log.filter(([, k]) => k === '0,999');

{
  const s = new Sim({ ...BASE, sourcedRandomImageDraw: true });
  const log = script(s);
  s.tick(); assert.deepEqual(draws(log).map(([f]) => f), [1], 'one draw on the first loop, viewing starts at 0');
  for (let i = 0; i < 120; i++) s.tick();
  assert.equal(draws(log).length, 1, 'none while viewing stays 0');
  s.press('monitor'); for (let i = 0; i < 60; i++) s.tick();
  assert.ok(s.viewing > 0, 'the monitor is up');
  assert.equal(draws(log).length, 1, 'none while a camera is up');
  s.press('monitor'); for (let i = 0; i < 60; i++) s.tick();
  assert.equal(s.viewing, 0);
  assert.equal(draws(log).length, 2, 'one draw when viewing falls to 0');
  for (let i = 0; i < 120; i++) s.tick();
  assert.equal(draws(log).length, 2, 'and only one for that stretch');
  s.press('monitor'); for (let i = 0; i < 60; i++) s.tick(); s.press('monitor'); for (let i = 0; i < 60; i++) s.tick();
  assert.equal(draws(log).length, 3, 'each drop draws again');
}

// Off: the default is unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  if (new Sim({ night: 7, seed: 1 }).opts.sourcedRandomImageDraw === false)
    assert.equal(run({}), run({ sourcedRandomImageDraw: false }), 'explicit off equals the default');
}
console.log('random image draw: Random(1000) at night start and once per monitor drop, never with a camera up; off unchanged');
