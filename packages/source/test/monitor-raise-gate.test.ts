// g254/g257 under sourcedMonitorRaiseGate: the monitor goes up only from a still, down panel with the mask fully
// off, no encounter blackout and no committed attack. Off: the default is unchanged.
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';
import type { SimOptions } from '../src/games/fnaf2/plant-options.ts';

const BASE = { night: 7, seed: 5, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false, boxEnabled: false, foxyEnabled: false };
const settle = (s: Sim, n: number) => { for (let i = 0; i < n; i++) s.tick(); };

// Plain raise from the office still works.
{ const s = new Sim({ ...BASE, sourcedMonitorRaiseGate: true }); settle(s, 5); s.press('monitor'); settle(s, 20); assert.equal(s.monitor, 'up'); }

// Mask on, or still coming off: refused; fully off: accepted.
{ const s = new Sim({ ...BASE, sourcedMonitorRaiseGate: true }); settle(s, 5);
  s.press('mask'); settle(s, 30); assert.ok(s.maskFullyOn);
  s.press('monitor'); settle(s, 20); assert.equal(s.monitor, 'down', 'mask fully on refuses the raise');
  s.press('mask'); settle(s, 3); assert.ok(!s.maskFullyOff, 'mask still animating off');
  s.press('monitor'); settle(s, 20); assert.equal(s.monitor, 'down', 'mask mid-animation refuses the raise');
  settle(s, 30); assert.ok(s.maskFullyOff);
  s.press('monitor'); settle(s, 20); assert.equal(s.monitor, 'up', 'fully off accepts'); }

// During an encounter blackout (`in danger`): refused.
{ const s = new Sim({ ...BASE, sourcedMonitorRaiseGate: true }); settle(s, 5);
  s.blackout.active = true;
  s.press('monitor'); settle(s, 20); assert.equal(s.monitor, 'down', 'in danger refuses the raise');
  assert.ok(s.mistakes.some(m => /g254\/g257/.test(m.detail)), 'the refusal is flagged');
  s.blackout.active = false; s.press('monitor'); settle(s, 20); assert.equal(s.monitor, 'up'); }

// While the panel is still lowering: refused (the panel must be down and still).
{ const s = new Sim({ ...BASE, sourcedMonitorRaiseGate: true }); settle(s, 5);
  s.press('monitor'); settle(s, 20); assert.equal(s.monitor, 'up');
  s.press('monitor'); settle(s, 3); assert.equal(s.monitor, 'lowering');
  s.press('monitor'); settle(s, 30); assert.equal(s.monitor, 'down', 'a raise pressed mid-lowering is refused'); }

// Off: the default is unchanged.
{ const run = (opts: Partial<SimOptions>) => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  if (new Sim({ night: 7, seed: 1 }).opts.sourcedMonitorRaiseGate === false)
    assert.equal(run({}), run({ sourcedMonitorRaiseGate: false }), 'explicit off equals the default'); }
console.log('monitor raise gate: refused with the mask on or mid-animation, in danger, or a moving panel; accepted from a still office; off unchanged');
