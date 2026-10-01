// The Puppet's static glitch chain under sourcedPuppetGlitchDraws (dump g500-g506, g774).
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';

const QUIET = { night: 7, seed: 71, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                boxEnabled: false, foxyEnabled: false };
const lcg = s => (s * 31415 + 1) & 0xffff;
const stepsTo = (from, to) => { let n = 0, s = from; while (s !== to && n < 50) { s = lcg(s); n++; } return n; };
const view = (s, cam) => { s.monitor = 'up'; s.monAnim = 0; s.viewing = cam; s.cam = cam; };

// In the box (CAM 11): no draws, flag or not.
{
  const s = new Sim({ ...QUIET, sourcedPuppetGlitchDraws: true }); s.frame = 1000;
  view(s, 11); s.glitch.value5 = 1;
  const b = s.rng.state; for (let i = 0; i < 30; i++) s.tick();
  assert.equal(s.rng.state, b);
}

// Out on CAM 03 under your-view with the flag set and the light off: g500-g502 draw, a hit makes g505 draw too.
{
  const s = new Sim({ ...QUIET, worst: true, sourcedPuppetGlitchDraws: true }); s.frame = 1000;
  s.puppet.out = true; s.puppet.loc = 3; view(s, 3); s.glitch.value5 = 1;
  const b = s.rng.state; s.tick();
  assert.equal(stepsTo(b, s.rng.state), 4, 'three Random(50) rolls (worst luck hits) and one Random(150)');
  assert.equal(s.glitch.value4, 0, 'g505 took the one off');
}

// g774 raises the flag while the light is on the Puppet; g506 clears it within 110 ms.
{
  const s = new Sim({ ...QUIET, sourcedPuppetGlitchDraws: true }); s.frame = 1000;
  s.puppet.out = true; s.puppet.loc = 3; view(s, 3); s.lightHeld = true;
  s.tick(); assert.equal(s.glitch.value5, 1, 'set by g774');
  s.lightHeld = false;
  let cleared = -1;
  for (let i = 1; i <= 8 && cleared < 0; i++) { s.tick(); if (s.glitch.value5 === 0) cleared = i; }
  assert.ok(cleared > 0 && cleared <= 7, `cleared after ${cleared} frames`);
}

// g506 from the start of the night: loaded before frame 1, it clears the flag on frame 7 (330 units, 50 a frame),
// the same origin as g498's 200 ms countdown firing on frame 12.
{
  const s = new Sim({ ...QUIET, sourcedPuppetGlitchDraws: true });
  s.glitch.value5 = 1;
  let cleared = -1;
  for (let i = 0; i < 10 && cleared < 0; i++) { s.tick(); if (s.glitch.value5 === 0) cleared = s.frame; }
  assert.equal(cleared, 7);
}

// With the Foxy chain on, both groups read the lit? counter (events 74-83): held light raises the flag, no rolls while lit.
{
  const s = new Sim({ ...QUIET, sourcedDropLightOrder: true, sourcedFoxyChain: true, sourcedPuppetGlitchDraws: true }); s.frame = 1000;
  s.puppet.out = true; s.puppet.loc = 4; view(s, 4); s.lightHeld = true;
  s.tick();
  assert.equal(s.hallLit, true);
  assert.equal(s.glitch.value5, 1, 'g774 set from the counter');
  const b = s.rng.state; s.tick();
  assert.equal(s.rng.state, b, 'lit? == 1 blocks g500-g503 with the flag up');
}

// Off: the default is unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  if (new Sim({ night: 7, seed: 1 }).opts.sourcedPuppetGlitchDraws === false)
    assert.equal(run({}), run({ sourcedPuppetGlitchDraws: false }), 'explicit off equals the default');
}
console.log('puppet glitch draws: none in the box, g500-g502 + g505 on a hit, g774 sets and g506 clears the flag; off unchanged');
