// Drop latency, the hall latch and Foxy under sourcedDropLightOrder (dump g75/g84/g94/g262/g445/g488/g489/g614/g745/g573).
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';
import type { SimOptions } from '../src/games/fnaf2/plant-options.ts';
import { LEGACY_SIM_OPTIONS } from '../src/games/fnaf2/plant-options.ts';

const fresh = (extra = {}) => {
  const s = new Sim({ ...LEGACY_SIM_OPTIONS, night: 7, seed: 3, lethal: false, sourcedDropLightOrder: true, stalledEnabled: false, bbEnabled: false, gfEnabled: false, boxEnabled: false, ...extra });
  s.frame = 100; s.monitor = 'up'; s.monAnim = 0; s.viewing = 11; s.maskOn = false; s.maskAnim = 0; s.hallLatch = false;
  return s;
};

// g614 -> g262: the drop happens on the next tick, viewing zeroed then.
{
  const s = fresh(); s.press('monitor');
  assert.equal(s.monitor, 'up'); assert.equal(s.dropEverything, true);
  s.tick(); assert.equal(s.monitor, 'lowering'); assert.equal(s.viewing, 0);
}
// No encounter: the held light latches on the tick after the drop.
{
  const s = fresh(); s.lightHeld = true; s.press('monitor');
  s.tick(); assert.equal(s.hallLatch, false, 'the drop frame sees viewing from before g262');
  s.tick(); assert.equal(s.hallLatch, true, 'the next frame latches');
}
// An encounter running: the light never latches.
{
  const s = fresh(); s.lightHeld = true; s.press('monitor'); s.tick();
  s.blackout = { active: true, until: s.frame + 300, by: 'withbonnie', unitId: 'withbonnie', masked: false, deadline: s.frame + 45 };
  for (let i = 0; i < 20; i++) { s.tick(); assert.equal(s.hallLatch, false, `frame ${s.frame}`); }
}
// g488: a released light's latch clears on the next one-second tick.
{
  const s = fresh(); s.monitor = 'down'; s.viewing = 0; s.lightHeld = true; s.frame = 110; s.tick(); assert.equal(s.hallLatch, true);
  s.lightHeld = false; while (s.frame % 60 !== 59) { s.tick(); assert.equal(s.hallLatch, true); }
  s.tick(); assert.equal(s.frame % 60, 0); assert.equal(s.hallLatch, false);
}
// g745: Foxy's D resets only from the latch.
{
  const s = fresh(); s.monitor = 'down'; s.viewing = 0; s.foxy.loc = 'hall'; s.foxy.D = 5; s.lightHeld = false; s.frame = 130;
  s.tick(); assert.ok(s.foxy.D >= 5, 'no latch, no reset');
  s.lightHeld = true; s.tick(); assert.equal(s.foxy.D, 0, 'latched, D zeroed');
}
// g573: a latched hall with Foxy at 123 kills on any frame, blocked by a running encounter.
{
  const s = fresh({ lethal: true }); s.monitor = 'down'; s.viewing = 0; s.foxy.loc = 'hall'; s.foxy.gotYou = true; s.frame = 130;
  s.blackout = { active: true, until: s.frame + 300, by: 'x', unitId: null, masked: true, deadline: 0 }; s.hallLatch = true;
  s.tickFoxy(s.frame); assert.equal(s.alive, true, 'in danger blocks g573');
  s.blackout.active = false; s.tickFoxy(s.frame); assert.equal(s.alive, false); assert.equal(s.death?.reason, 'foxy');
}
// Off: the drop is immediate as before.
{
  const s = new Sim({ ...LEGACY_SIM_OPTIONS, night: 7, seed: 3, lethal: false, sourcedDropLightOrder: false }); s.monitor = 'up'; s.maskOn = false; s.maskAnim = 0;
  s.press('monitor'); assert.equal(s.monitor, 'lowering');
  const run = (opts: Partial<SimOptions>) => { const x = new Sim({ ...LEGACY_SIM_OPTIONS, night: 7, seed: 11, lethal: false, durationFrames: 3600, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify(x.events); };
  if (new Sim({ ...LEGACY_SIM_OPTIONS, night: 7, seed: 1 }).opts.sourcedDropLightOrder === false)
    assert.equal(run({}), run({ sourcedDropLightOrder: false }), 'explicit off equals the default');
}
console.log('drop light order: g614 drop latency, latch from frame-start state, encounter blocks the latch, g488 clear, g745 from the latch, g573 from the latch; off unchanged');
