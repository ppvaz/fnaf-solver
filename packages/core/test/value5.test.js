// sourcedValue5: global value 5 as g1236 writes it, Min(4, previous loop's TimerValue delta / 16.666666666511446)
// (the Double token as the Android runtime decodes it, 32.32 fixed). At an exact 60 Hz step that is a hair above 1,
// so g514's blackout clock passes g517's `> 20` on the 20th loop of `in danger`, where value 5 = 1 needs 21 (Night 7
// k3 tick 2044 and Night 5 contact-final tick 7460 in the rebuilt runtime). Off: value 5 is frameValue5, or 1.
import assert from 'node:assert/strict';
import { Sim } from '../src/mechanics/plant-model.js';

const SOURCED = { sourcedDropLightOrder: true, sourcedFoxyChain: true, sourcedSecondPass: true, sourcedSheetOrder: true,
                  sourcedBlackoutDraws: true };
const QUIET = { night: 7, seed: 5, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                boxEnabled: false, foxyEnabled: false };
const MS60 = () => 50 / 3;

assert.throws(() => new Sim({ ...QUIET, ...SOURCED, sourcedValue5: true }), /requires frameMs/);
assert.throws(() => new Sim({ ...QUIET, ...SOURCED, sourcedValue5: true, frameMs: MS60, frameValue5: () => 1 }), /not both/);

// The value itself: the previous loop's delta over the 32.32 divisor, capped at 4.
{
  const s = new Sim({ ...QUIET, ...SOURCED, sourcedValue5: true, frameMs: (f) => (f === 10 ? 17 : f === 11 ? 100 : 50 / 3) });
  assert.ok(s.value5(5) > 1 && s.value5(5) - 1 < 1e-10, 'an exact 60 Hz delta reads a hair above 1');
  assert.equal(s.value5(11), 17 / (71582788266 / 2 ** 32), 'loop 11 reads loop 10\'s delta');
  assert.equal(s.value5(12), 4, 'Min(4, ...)');
  const off = new Sim({ ...QUIET, ...SOURCED, frameMs: MS60, frameValue5: () => 1 });
  assert.equal(off.value5(5), 1, 'off: frameValue5');
}

/** Frames after the blackout starts on which the g517/g518 flicker draws. */
const flicker = (hook) => {
  const s = new Sim({ ...QUIET, ...SOURCED, ...hook });
  for (let i = 0; i < 30; i += 1) s.tick();
  s.startBlackout('test');
  const start = s.frame;
  const drawn = [];
  const int = s.rng.int.bind(s.rng);
  s.rng.int = (a, b, ...r) => { if (b === 49 && s.blackout.active) drawn.push(s.frame - start); return int(a, b, ...r); };
  for (let i = 0; i < 260; i += 1) s.tick();
  return drawn;
};

{
  const off = flicker({ frameMs: MS60, frameValue5: () => 1 });
  const on = flicker({ frameMs: MS60, sourcedValue5: true });
  assert.equal(off[0], 20, 'off: the clock is 21 on the 20th loop after the start, the first > 20');
  assert.equal(on[0], 19, 'on: 20 loops of a value above 1 already pass > 20');
  assert.equal(on.length, off.length + 1, 'one more draw per encounter; g518 still stops before 200');
  assert.equal(on.at(-1), off.at(-1), 'the last draw is the same loop');
}

// Off leaves the default unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ sourcedValue5: false }), 'off equals the default');
}

console.log('value 5: g1236\'s previous-loop delta over the 32.32 divisor, a hair above 1 at 60 Hz, so the flicker draws from clock 20; off unchanged');
