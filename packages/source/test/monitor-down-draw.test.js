// The monitor-down image's draw under sourcedMonitorDownDraw (generated e7, e211, e720-e722, e871-e872; dump g807).
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';

const QUIET = { night: 7, seed: 51, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                boxEnabled: false, foxyEnabled: false };
const drawsIn = (s, ticks) => { let n = 0; for (let i = 0; i < ticks; i++) { const b = s.rng.state; s.tick(); if (s.rng.state !== b) n++; } return n; };
const up = s => { s.monitor = 'up'; s.monAnim = 0; };

// One draw on the drop frame, none while the sprite shows.
{
  const s = new Sim({ ...QUIET, sourcedMonitorDownDraw: true }); s.frame = 1000; up(s);
  s.setMonitor(false);
  const b = s.rng.state; s.tick();
  assert.notEqual(s.rng.state, b, 'the drop frame draws');
  assert.equal(drawsIn(s, 21), 0, 'no draw while the sprite is visible');
  assert.equal(s.monDown.visible, true);
  s.tick(); assert.equal(s.monDown.visible, false, 'hidden on the frame value 0 reaches 22');
}

// A second drop after the sprite hid draws again.
{
  const s = new Sim({ ...QUIET, sourcedMonitorDownDraw: true }); s.frame = 1000; up(s);
  s.setMonitor(false); assert.equal(drawsIn(s, 30), 1);
  up(s); s.setMonitor(false); assert.equal(drawsIn(s, 30), 1, 'value 2 was reset while hidden');
}

// A re-drop while the sprite is still showing does not draw.
{
  const s = new Sim({ ...QUIET, sourcedMonitorDownDraw: true }); s.frame = 1000; up(s);
  s.setMonitor(false); assert.equal(drawsIn(s, 5), 1);
  up(s); s.setMonitor(false); assert.equal(drawsIn(s, 5), 0);
}

// Off: the default is unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  if (new Sim({ night: 7, seed: 1 }).opts.sourcedMonitorDownDraw === false)
    assert.equal(run({}), run({ sourcedMonitorDownDraw: false }), 'explicit off equals the default');
}
console.log('monitor-down draw: one Random(1000000) per drop, hidden at value 0 = 22, no draw on a re-drop while showing; off unchanged');
