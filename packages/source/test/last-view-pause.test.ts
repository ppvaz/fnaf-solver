// g263's 200 ms last-viewed sample under sourcedLastViewPause: the countdown sits after `viewing > 0`.
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';
import type { SimOptions } from '../src/games/fnaf2/plant-options.ts';

const QUIET = { night: 7, seed: 101, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                boxEnabled: false, foxyEnabled: false };
const up = (s: Sim, cam: number) => { s.monitor = 'up'; s.monAnim = 0; s.viewing = cam; s.cam = cam; };
const down = (s: Sim) => { s.monitor = 'down'; s.monAnim = 0; s.viewing = 0; };

// The countdown only runs on camera-up frames: 7 up + 50 down + 6 up = 13 camera-up frames, loaded on the
// first reach, so the first sample lands on the 13th camera-up frame, not on a global f % 12 boundary.
{
  const s = new Sim({ ...QUIET, sourcedLastViewPause: true });
  s.frame = 1000; s.lastViewed = 0;
  up(s, 5); for (let i = 0; i < 7; i++) s.tick();
  assert.equal(s.lastViewed, 0, 'no sample in the first 7 camera-up frames');
  down(s); for (let i = 0; i < 50; i++) s.tick();
  assert.equal(s.lastViewed, 0, 'the countdown holds while no camera is displayed');
  up(s, 5); for (let i = 0; i < 5; i++) s.tick();
  assert.equal(s.lastViewed, 0, '12 camera-up frames: loaded on the first, 11 subtractions of 50 from 600');
  s.tick();
  assert.equal(s.lastViewed, 5, 'the 13th camera-up frame samples');
}

// Off: the global 200 ms sample (f % 12) is unchanged.
{
  const s = new Sim(QUIET); s.frame = 1000; s.lastViewed = 0;
  up(s, 7); for (let i = 0; i < 7; i++) s.tick();
  assert.equal(s.lastViewed, 0, 'frames 1001-1007 carry no global boundary');
  s.tick();
  assert.equal(s.lastViewed, 7, 'frame 1008 is a global 12-frame boundary');
}
{
  const run = (opts: Partial<SimOptions>) => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  if (new Sim({ night: 7, seed: 1 }).opts.sourcedLastViewPause === false)
    assert.equal(run({}), run({ sourcedLastViewPause: false }), 'explicit off equals the default');
}
console.log('last-view pause: g263 counts only camera-up frames and holds while cameras are down; off keeps f % 12');
