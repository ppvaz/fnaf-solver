// Dump route forks and gates behind sourcedRouteForks (docs/evidence/withered-freddy-route-night7-20260915.json).
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';
import { Rng } from '../src/games/fnaf2/rng.ts';

const sim = (night, extra = {}) => new Sim({ night, seed: 7, lethal: false, sourcedRouteForks: true, ...extra });
const unit = (s, id) => s.units.find(u => u.id === id);

// g744: one bit-exact Random(2)+1 draw.
{
  const s = sim(7); const ref = new Rng(s.rng.seed); ref.state = s.rng.state;
  const expected = Math.floor(ref.next() * 2) + 1;
  assert.equal(s.rollDecidePath(), expected); assert.equal(s.rng.state, ref.state, 'exactly one draw');
}
// g376/g377: W. Freddy's CAM 03 fork.
{
  const s = sim(7); const u = unit(s, 'withfreddy'); u.idx = u.path.indexOf(3);
  s.decidePath = 2; s.advance(u); assert.equal(u.path[u.idx], 7, 'decide path 2 -> CAM 07');
  u.idx = u.path.indexOf(3); s.decidePath = 1; s.advance(u); assert.equal(u.path[u.idx], 'blindB', 'decide path 1 -> hall stage 2');
  u.idx = u.path.indexOf(3); s.decidePath = 0; assert.equal(s.sourcedRouteStep(u, 100), 'hold', 'no hop before decide path is rolled');
}
// g378: return from hall stage 2 under a fully-on mask, B = 5000 - night*500.
for (const night of [7, 3]) {
  const s = sim(night); const u = unit(s, 'withfreddy'); u.idx = u.path.indexOf('blindB'); u.stunUntil = 0;
  s.frame = 1000; s.maskOn = true; s.maskAnim = 0; s.lightLogicalUntil = 0;
  if (night === 3) { const c = unit(s, 'withchica'); const b = unit(s, 'withbonnie'); c.idx = 1; b.idx = 1; }
  assert.equal(s.sourcedRouteStep(u, 1000), 'returned');
  assert.equal(u.path[u.idx], 3); assert.equal(u.stunUntil, 1000 + 5000 - night * 500);
}
{
  const s = sim(7); const u = unit(s, 'withfreddy'); u.idx = u.path.indexOf('blindB'); u.stunUntil = 0;
  s.maskOn = false; s.maskAnim = 0; assert.equal(s.sourcedRouteStep(u, 1000), null, 'no return without a fully-on mask');
  s.maskOn = true; s.lightLogicalUntil = 5000; assert.equal(s.sourcedRouteStep(u, 1000), null, 'no return while the hall light latch is set');
}
// g396/g397/g399: Mangle's CAM 01 detour restores her base route.
{
  const s = sim(7); const m = unit(s, 'mangle'); const base = m.path; const shared = [...base];
  m.idx = base.indexOf(2); s.decidePath = 2; s.advance(m); assert.equal(m.path[m.idx], 1, 'decide path 2 -> CAM 01');
  s.monitor = 'down'; s.frame = 10; s.lightLogicalUntil = 50; m.stunUntil = 0;
  assert.equal(s.canAdvance(m, 10), false, 'g399 waits for the hall light latch');
  s.lightLogicalUntil = 0; assert.equal(s.canAdvance(m, 10), true);
  s.advance(m); assert.equal(m.path[m.idx], 2); assert.equal(m.path, base, 'base route restored');
  s.decidePath = 1; s.advance(m); assert.equal(m.path[m.idx], 6, 'decide path 1 -> CAM 06');
  assert.deepEqual(base, shared, 'the shared route table was not mutated');
}
// g384/g388: W. Bonnie / W. Chica final hops wait on the running encounter.
{
  const s = sim(7); const b = unit(s, 'withbonnie'); b.idx = b.path.indexOf(5); b.stunUntil = 0;
  s.monitor = 'up'; s.cam = 11; s.engagedToy = null; s.blackout.active = true;
  assert.equal(s.canAdvance(b, 10), false); s.blackout.active = false; assert.equal(s.canAdvance(b, 10), true);
}
// g344/g347/g352/g356: off Night 7 only.
{
  const s = sim(5); const f = unit(s, 'withfreddy'); const c = unit(s, 'withchica'); const b = unit(s, 'withbonnie');
  f.idx = 0; c.idx = 0; b.idx = 0;
  assert.equal(s.sourcedRouteStep(f, 10), 'hold'); assert.equal(s.sourcedRouteStep(c, 10), 'hold');
  b.idx = 1; assert.equal(s.sourcedRouteStep(c, 10), null); assert.equal(s.sourcedRouteStep(f, 10), 'hold');
  c.idx = 1; assert.equal(s.sourcedRouteStep(f, 10), null);
  const tf = unit(s, 'toyfreddy'); const tc = unit(s, 'toychica'); tf.stunUntil = 0; tc.idx = tc.path.indexOf(9);
  assert.equal(s.sourcedRouteStep(tf, 10), 'discard');
  const s7 = sim(7); const f7 = unit(s7, 'withfreddy'); unit(s7, 'withchica').idx = 0;
  assert.equal(s7.sourcedRouteStep(f7, 10), null, 'Night 7 drops the CAM 08 departure order');
}
// Off: no rule fires and a full night is trace-identical to the default.
{
  const off = new Sim({ night: 7, seed: 7, lethal: false, sourcedRouteForks: false }); const u = unit(off, 'withfreddy'); u.idx = u.path.indexOf(3);
  off.decidePath = 2; assert.equal(off.sourcedRouteStep(u, 1), null); off.advance(u); assert.equal(u.path[u.idx], 'blindB');
  const run = opts => { const s = new Sim({ night: 7, seed: 11, lethal: false, durationFrames: 3600, ...opts }); for (let i = 0; i < 3600; i++) s.tick(); return JSON.stringify(s.events); };
  assert.notEqual(run({ sourcedRouteForks: false }), run({ sourcedRouteForks: true }), 'on changes the night (at least the per-second draw)');
  // Until the default flips (bundles must be re-emitted first), the default is off and equals explicit off.
  if (new Sim({ night: 7, seed: 1 }).opts.sourcedRouteForks === false)
    assert.equal(run({}), run({ sourcedRouteForks: false }), 'explicit off equals the default');
}
console.log('route forks: g744 draw, W. Freddy g377/g378, Mangle g397/g399, Bonnie/Chica in-danger, off-Night-7 departure order and toy discard; off is trace-identical');
