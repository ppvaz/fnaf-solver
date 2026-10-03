// The blackout flicker's per-frame draws under sourcedBlackoutDraws (dump g514/g517/g518).
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';
import type { SimOptions } from '../src/games/fnaf2/plant-options.ts';
import { LEGACY_SIM_OPTIONS } from '../src/games/fnaf2/plant-options.ts';

const QUIET = { night: 7, seed: 21, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                boxEnabled: false, foxyEnabled: false };

const drawFrames = (extra: Partial<SimOptions>) => {
  const s = new Sim({ ...LEGACY_SIM_OPTIONS, ...QUIET, ...extra });
  s.frame = 1000;
  s.startBlackout('test');
  const frames = [];
  for (let i = 0; i < 260; i++) {
    const before = s.rng.state;
    s.tick();
    if (s.rng.state !== before) frames.push(s.frame - 1000);
  }
  return frames;
};

// Off: an encounter draws nothing by itself in a quiet simulator.
assert.deepEqual(drawFrames({}), []);

// On: one draw per frame on frames 20..198 after the start (clock 21..199), 179 in all.
{
  const frames = drawFrames({ sourcedBlackoutDraws: true });
  assert.equal(frames.length, 179);
  assert.equal(frames[0], 20);
  assert.equal(frames[frames.length - 1], 198);
  assert.ok(frames.every((f, i) => f === 20 + i), 'contiguous');
}

// A second encounter restarts the clock from its own start frame.
{
  const s = new Sim({ ...LEGACY_SIM_OPTIONS, ...QUIET, sourcedBlackoutDraws: true });
  s.frame = 2000; s.startBlackout('first');
  for (let i = 0; i < 310; i++) s.tick();
  s.startBlackout('second');
  const start = s.frame; let first = -1;
  for (let i = 0; i < 40 && first < 0; i++) { const b = s.rng.state; s.tick(); if (s.rng.state !== b) first = s.frame - start; }
  assert.equal(first, 20);
}

// Off: the default is unchanged.
{
  const run = (opts: Partial<SimOptions>) => { const x = new Sim({ ...LEGACY_SIM_OPTIONS, night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  if (new Sim({ ...LEGACY_SIM_OPTIONS, night: 7, seed: 1 }).opts.sourcedBlackoutDraws === false)
    assert.equal(run({}), run({ sourcedBlackoutDraws: false }), 'explicit off equals the default');
}
console.log('blackout draws: g517/g518 on encounter frames 20..198 (179 per encounter), clock restarts per encounter; off unchanged');
