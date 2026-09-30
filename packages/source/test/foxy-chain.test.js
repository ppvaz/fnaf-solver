// Foxy's A/B chain under sourcedFoxyChain (dump g337/g349/g364/g389/g390/g573/g745/g824/g825/g846/g855/g864).
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.js';
import { RNG_MULTIPLIER, RNG_INCREMENT, RNG_MASK } from '../src/games/fnaf2/rng.js';

const lcg = s => (s * RNG_MULTIPLIER + RNG_INCREMENT) & RNG_MASK;
const ON = { sourcedDropLightOrder: true, sourcedFoxyChain: true };
const fresh = (extra = {}) => {
  const s = new Sim({ night: 7, seed: 9, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false, boxEnabled: false, ...ON, ...extra });
  s.frame = 100; s.monitor = 'down'; s.monAnim = 0; s.viewing = 0; s.maskOn = false; s.maskAnim = 0;
  s.hallLatch = false; s.hallLit = false;
  return s;
};

// The option needs the latch.
assert.throws(() => new Sim({ night: 7, seed: 1, sourcedFoxyChain: true }), /requires sourcedDropLightOrder/);

// No readyAt draw at construction: the off simulator is exactly one draw ahead.
{
  const on = new Sim({ night: 7, seed: 4242, ...ON });
  const off = new Sim({ night: 7, seed: 4242, sourcedDropLightOrder: true });
  assert.equal(off.rng.state, lcg(on.rng.state));
  assert.equal(on.foxy.A, 0); assert.equal(on.foxy.B, 0);
}

// g337: the roll draws while pinned and not ready; success zeroes D and writes A=1.
{
  const s = fresh(); const fx = s.foxy; fx.loc = 'hall'; fx.B = 50; fx.D = 30; s.frame = 300;
  const before = s.rng.state; s.onFiveSecond();
  assert.equal(s.rng.state, lcg(before), 'one Random(5) draw');
  assert.equal(fx.A, 1); assert.equal(fx.D, 0);
  const t = fresh(); t.foxy.D = 0; t.frame = 300; const b2 = t.rng.state; t.onFiveSecond();
  assert.equal(t.rng.state, lcg(b2), 'a failing roll still draws'); assert.equal(t.foxy.A, 0);
}

// g349 before g364: A waits for B to read 0 at its own group, one frame after the decay reaches it.
{
  const s = fresh(); const fx = s.foxy; fx.loc = 'hall'; fx.A = 1; fx.B = 2;
  s.foxyChainTransitions(); assert.deepEqual([fx.A, fx.B], [1, 1]);
  s.foxyChainTransitions(); assert.deepEqual([fx.A, fx.B], [1, 0]);
  s.hallLatch = true; s.foxyChainTransitions(); assert.equal(fx.A, 2); assert.equal(fx.gotYou, false, 'g390 waits on the latch');
  s.hallLatch = false; s.foxyChainTransitions(); assert.equal(fx.gotYou, true); assert.equal(fx.A, 0);
}

// g389: A=2 on CAM 08 arrives in the hall once the latch is clear, D zeroed, exposure kept.
{
  const s = fresh(); const fx = s.foxy; fx.A = 2; fx.D = 7; fx.exposure = 3;
  s.foxyChainTransitions(); assert.equal(fx.loc, 'hall'); assert.equal(fx.D, 0); assert.equal(fx.exposure, 3); assert.equal(fx.gotYou, false);
}

// g745 then g824: a latch held across a one-second boundary leaves D at 1; g855 pins B.
{
  const s = fresh(); const fx = s.foxy; fx.loc = 'hall'; fx.D = 6; s.hallLit = true;
  s.tickFoxyChain(120); assert.equal(fx.D, 1); assert.equal(fx.B, 50); assert.equal(fx.exposure, 1);
  s.hallLit = false; s.tickFoxyChain(121); assert.equal(s.hallLatch, true, 'the latch holds to the next second'); assert.equal(fx.D, 0);
}

// g824 is blocked by an encounter; g825 adds a second +1 while the mask is fully on and nobody waits at 122.
{
  const s = fresh(); const fx = s.foxy; fx.D = 2;
  s.blackout = { active: true, until: 999, by: 'x', unitId: null, masked: true, deadline: 0 };
  s.tickFoxyChain(180); assert.equal(fx.D, 2);
  s.blackout = { active: false, until: 0, by: null, unitId: null, masked: false, deadline: 0 };
  s.maskOn = true; s.maskAnim = 0; s.tickFoxyChain(240); assert.equal(fx.D, 4);
}

// g864: latched on CAM 08, D drops one per 500 ms.
{
  const s = fresh(); const fx = s.foxy; fx.D = 3; s.hallLit = true;
  s.tickFoxyChain(150); assert.equal(fx.D, 2);
  s.tickFoxyChain(151); assert.equal(fx.D, 2);
}

// g846: retreat needs lit? 0, latch 0 and B 0, has no position condition (it lifts a lock), and draws B.
{
  const s = fresh(); const fx = s.foxy; fx.loc = 'hall'; fx.gotYou = true; fx.exposure = 701; fx.B = 0; fx.A = 1;
  s.hallLit = true; s.tickFoxyChain(101); assert.equal(fx.loc, 'hall', 'lit? blocks');
  s.hallLit = false; s.hallLatch = false; const before = s.rng.state; s.tickFoxyChain(170);
  assert.equal(fx.loc, 'parts'); assert.equal(fx.gotYou, false); assert.equal(fx.A, 0); assert.equal(fx.exposure, 0);
  assert.equal(s.rng.state, lcg(before)); assert.ok(fx.B >= 500 && fx.B <= 999);
}

// Events 75 -> 211 -> 382 -> 426: a camera light held through the drop latches the hall on the drop
// frame, even when the encounter starts that frame; the next frame's lit? is cleared by in danger (81).
{
  const s = fresh(); const fx = s.foxy; fx.loc = 'hall'; fx.D = 4;
  s.monitor = 'up'; s.viewing = 11; s.lightHeld = true; s.frame = 1300;
  s.updateLitCounter(); assert.equal(s.hallLit, true, 'camera light sets lit? (75)');
  s.viewing = 0;                                     // the drop (211) later in the frame
  s.blackout = { active: true, until: 9999, by: 'x', unitId: null, masked: false, deadline: 0 };  // in danger (382) later still
  s.tickFoxyChain(1301); assert.equal(s.hallLatch, true, 'latched on the drop frame (426)'); assert.equal(fx.D, 0, 'g745 reset');
  s.updateLitCounter(); assert.equal(s.hallLit, false, 'in danger clears lit? next frame (81)');
  const c = fresh(); c.monitor = 'up'; c.viewing = 11; c.lightHeld = true; c.updateLitCounter(); c.hallLatch = false;
  c.tickFoxyChain(1302); assert.equal(c.hallLatch, false, 'no latch while a camera is still up');
}

// g573: at 123 with the latch set, viewing 0 and no encounter.
{
  const s = fresh({ lethal: true }); const fx = s.foxy; fx.loc = 'hall'; fx.gotYou = true; s.hallLit = true;
  s.viewing = 11; s.tickFoxyChain(130); assert.equal(s.alive, true, 'viewing a camera blocks g573');
  s.viewing = 0; s.tickFoxyChain(131); assert.equal(s.alive, false); assert.equal(s.death.reason, 'foxy');
}

// Off: the default is unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify(x.events); };
  if (new Sim({ night: 7, seed: 1 }).opts.sourcedFoxyChain === false)
    assert.equal(run({}), run({ sourcedFoxyChain: false }), 'explicit off equals the default');
}

// g364 drains the hall pin by 1 * Global(5), not by 1: the dump's expression is
// Max(0, AV1 - 1 * global -65531), the same frame-delta term g881 drains `hall movement` with,
// so a long frame drains it by more. Read from the CCN dump on 2026-09-17.
{
  const base = { night: 7, seed: 11, sourcedDropLightOrder: true, sourcedFoxyChain: true,
    sourcedSheetOrder: true, sourcedSecondPass: true };
  const drain = frameValue5 => {
    const s = new Sim({ ...base, frameMs: () => 1000 / 60, frameValue5 });
    s.foxy.B = 50;
    const before = s.foxy.B;
    s.tick();
    return before - s.foxy.B;
  };
  assert.equal(drain(() => 1), 1, 'a 60 fps frame drains the pin by one');
  assert.equal(drain(() => 2), 2, 'a frame worth two drains it by two');
  assert.equal(drain(() => 4), 4, 'the term is capped at four by the runtime, and the pin follows it');
  const unhooked = new Sim({ ...base });
  unhooked.foxy.B = 50;
  const was = unhooked.foxy.B;
  unhooked.tick();
  assert.equal(was - unhooked.foxy.B, 1, 'with no frame-time hook the term is one, as before');
}

console.log('foxy chain: g337 draws every 5 s, g349/g364 order, g389/g390 on the latch, g745 before g824, g825 masked tick, g846 retreat lifts a lock, g855 pin, g864, g573; no constructor draw; off unchanged');
