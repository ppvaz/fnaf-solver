// sourcedBlackoutClockEnd: an office encounter resolves when g514's clock reaches 300. g537 (clock >= 300, NotAlways)
// sets `check and move`, and g538-g555 resolve on that loop. The clock adds global value 5 from the loop `in danger`
// rises, that loop included, so the 300th loop of the encounter resolves it, not the 301st (Night 5 contact-final
// tick 7740 and every Night 7 k3 encounter end in the rebuilt runtime). Off: the model resolves 300 frames after the
// start frame.
import assert from 'node:assert/strict';
import { Sim } from '../src/mechanics/plant-model.js';

const SOURCED = { sourcedDropLightOrder: true, sourcedFoxyChain: true, sourcedSecondPass: true, sourcedSheetOrder: true,
                  sourcedBlackoutDraws: true, frameMs: () => 50 / 3 };
const QUIET = { night: 7, seed: 5, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                boxEnabled: false, foxyEnabled: false };

assert.throws(() => new Sim({ ...QUIET, sourcedBlackoutClockEnd: true }), /requires sourcedBlackoutDraws and frameMs/);

/** Frames from the start frame to the frame the encounter resolved on. */
const length = (opts) => {
  const s = new Sim({ ...QUIET, ...SOURCED, ...opts });
  for (let i = 0; i < 30; i += 1) s.tick();
  s.startBlackout('test');
  const start = s.frame;
  while (s.blackout.active && s.frame < start + 400) s.tick();
  return s.frame - start;
};

for (const v5 of [{ frameValue5: () => 1 }, { sourcedValue5: true }]) {
  assert.equal(length({ ...v5 }), 300, 'off: 300 frames after the start frame');
  assert.equal(length({ ...v5, sourcedBlackoutClockEnd: true }), 299, 'on: the loop the clock reaches 300');
}

// Off leaves the default unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ sourcedBlackoutClockEnd: false }), 'off equals the default');
}

console.log('blackout clock end: g537 resolves the encounter on the loop g514\'s clock reaches 300; off unchanged');
