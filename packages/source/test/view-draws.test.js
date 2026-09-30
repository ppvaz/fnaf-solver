// Camera-view draws under sourcedViewDraws (dump g366/g368/g419, g468-g476, g498).
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.js';

const QUIET = { night: 7, seed: 31, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                boxEnabled: false, foxyEnabled: false };
const countDraws = (s, ticks) => { let n = 0; for (let i = 0; i < ticks; i++) { const b = s.rng.state; s.tick(); if (s.rng.state !== b) n++; } return n; };
const viewing = (s, cam) => { s.monitor = 'up'; s.monAnim = 0; s.viewing = cam; s.cam = cam; };

// g498: the Puppet's 200 ms static draw, every 12 frames, only when your-view is on CAM 11 (box).
{
  const s = new Sim({ ...QUIET, sourcedViewDraws: true }); s.frame = 1000; s.cam = 11;
  assert.equal(countDraws(s, 120), 10, 'monitor down, your-view parked on CAM 11');
  const t = new Sim({ ...QUIET, sourcedViewDraws: true }); t.frame = 1000; t.cam = 7;
  assert.equal(countDraws(t, 120), 0, 'your-view elsewhere');
}

// g469: Withered Bonnie's fade counter under your-view with a camera up: 9 frames.
{
  const s = new Sim({ ...QUIET, sourcedViewDraws: true }); s.frame = 1000;
  const u = s.units.find(x => x.id === 'withbonnie'); u.idx = u.path.indexOf(5);
  viewing(s, 5); s.fadeUntil.withbonnie = s.frame + 9;
  assert.equal(countDraws(s, 20), 9);
  const t = new Sim({ ...QUIET, sourcedViewDraws: true }); t.frame = 1000;
  const v = t.units.find(x => x.id === 'withbonnie'); v.idx = v.path.indexOf(5);
  viewing(t, 6); t.fadeUntil.withbonnie = t.frame + 9;
  assert.equal(countDraws(t, 20), 0, 'a different camera');
}

// g368: Toy Chica waiting in state 2 under your-view draws every frame.
{
  const s = new Sim({ ...QUIET, sourcedViewDraws: true }); s.frame = 1000;
  const u = s.units.find(x => x.id === 'toychica'); u.idx = u.path.indexOf(7); u.pending = true;
  viewing(s, 7);
  assert.equal(countDraws(s, 11), 11);
  s.monitor = 'down'; s.viewing = 0;
  assert.equal(countDraws(s, 11), 0, 'monitor down: no camera-up draws (g498 is on CAM 11 only)');
}

// Off: the default is unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  if (new Sim({ night: 7, seed: 1 }).opts.sourcedViewDraws === false)
    assert.equal(run({}), run({ sourcedViewDraws: false }), 'explicit off equals the default');
}
console.log('view draws: g498 every 12 frames on the Puppet, fade counter 9 frames under your-view, waiting toy every frame; off unchanged');
