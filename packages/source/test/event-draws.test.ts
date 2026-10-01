// Draws at events the model already simulates, under sourcedEventDraws (dump e237/e324/e338/e351-e354/e377/e478-e489/e548).
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';
import * as C from '../src/games/fnaf2/config.ts';
import { RNG_MULTIPLIER, RNG_INCREMENT, RNG_MASK, RNG_MODULUS } from '../src/games/fnaf2/rng.ts';

const lcg = s => (s * RNG_MULTIPLIER + RNG_INCREMENT) & RNG_MASK;
const after = (s, n) => { for (let i = 0; i < n; i++) s = lcg(s); return s; };
/** Random(n) from a state: [value, next state], bit-exact to Rng.int(0, n-1). */
const rnd = (s, n) => { const t = lcg(s); return [Math.floor((t / RNG_MODULUS) * n), t]; };
const QUIET = { night: 7, seed: 5, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                boxEnabled: false, foxyEnabled: false };
const pair = (extra = {}) => [new Sim({ ...QUIET, ...extra }), new Sim({ ...QUIET, ...extra, sourcedEventDraws: true })];

// Resolution that lets the unit inside: one Random(500) more than the default.
{
  const [off, on] = pair();
  for (const s of [off, on]) {
    s.frame = 1000;
    const u = s.units.find(x => x.id === 'withbonnie'); u.atOpening = true;
    s.blackout = { active: true, until: s.frame + 1, by: u.name, unitId: u.id, masked: false, deadline: 0 };
  }
  const s0 = on.rng.state; assert.equal(off.rng.state, s0);
  off.tick(); on.tick();
  assert.equal(off.rng.state, s0, 'default: no draw on the failed branch');
  assert.equal(on.rng.state, lcg(s0), 'e478-e489: one Random(500)');
  assert.equal(on.units.find(x => x.id === 'withbonnie').inside, true);
}

// Balloon Boy hops: stage 1 silent, stages 2-3 one cue, stage 4 two cues, e548 redraws a 4.
{
  const s = new Sim({ ...QUIET, sourcedEventDraws: true });
  let st = s.rng.state;
  s.bbHop(); assert.equal(s.rng.state, st, 'CAM 10 -> 07 draws nothing');
  for (const stage of [2, 3, 4]) {
    st = s.rng.state;
    let [cue, t] = rnd(st, 4);
    if (stage === 4) t = lcg(t);
    if (cue + 1 === 4) t = lcg(t);
    s.bbHop();
    assert.equal(s.bb.stage, stage);
    assert.equal(s.rng.state, t, `stage ${stage}`);
  }
  st = s.rng.state; s.bbEnterOpening(); assert.equal(s.rng.state, lcg(st), 'e354');
  // A cue of 4 is redrawn: find a state whose Random(4) is 3 and check the extra draw.
  let seed4 = 0; while (rnd(seed4, 4)[0] !== 3) seed4++;
  const r = new Sim({ ...QUIET, sourcedEventDraws: true }); r.bb.stage = 1; r.rng.state = seed4;
  r.bbHop(); assert.equal(r.rng.state, after(seed4, 2), 'e548 after a cue of 4');
}

// The five-tick mask sendback draws the early-leave roll and a cue; the default draws neither.
{
  const [off, on] = pair({ bbEnabled: true });
  for (const s of [off, on]) {
    s.bb.inOpening = true; s.bb.maskTicks = C.VENT_MASK_TICKS - 1;
    s.maskOn = true; s.maskAnim = 0; s.frame = 1200;
  }
  const s0 = on.rng.state;
  off.tickMask(); on.tickMask();
  assert.equal(off.rng.state, s0); assert.equal(on.rng.state, after(s0, 2), 'g292 roll + e237 cue');
  assert.equal(off.bb.inOpening, false); assert.equal(on.bb.inOpening, false);
}

// Withered Chica CAM 02 -> 06: one cue.
{
  const [off, on] = pair({ stalledEnabled: true });
  const s0 = on.rng.state;
  for (const s of [off, on]) { const u = s.units.find(x => x.id === 'withchica'); u.idx = u.path.indexOf(2); s.advanceUnit(u); }
  assert.equal(off.rng.state, s0); assert.equal(on.rng.state, lcg(s0), 'e324');
  assert.equal(on.units.find(x => x.id === 'withchica').path[on.units.find(x => x.id === 'withchica').idx], 6);
}

// The cameras-up streak sending a Withered unit inside draws its Random(500) (e479-e482).
{
  const [off, on] = pair({ stalledEnabled: true });
  const f = 1000;
  const s0 = on.rng.state;
  for (const s of [off, on]) {
    s.frame = f; s.monitor = 'up'; s.monAnim = 0;
    s.camsUpSince = f - C.entryStreakFrames(7) - 1;
    s.units.find(x => x.id === 'withfreddy').atOpening = true;
    s.tickUnits(f);
  }
  assert.equal(off.rng.state, s0, 'default: the streak entry draws nothing');
  assert.equal(on.rng.state, lcg(s0), 'e479-e482: one Random(500)');
  assert.equal(on.units.find(x => x.id === 'withfreddy').inside, true);
  assert.equal(off.units.find(x => x.id === 'withfreddy').inside, true);
}

// Off: the default is unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  if (new Sim({ night: 7, seed: 1 }).opts.sourcedEventDraws === false)
    assert.equal(run({}), run({ sourcedEventDraws: false }), 'explicit off equals the default');
}
console.log('event draws: failed-resolution Random(500), BB hop cues with the e548 redraw, e354, the mask sendback roll + cue, e324, the streak entry Random(500); off unchanged');
