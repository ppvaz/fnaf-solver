// sourcedBlackoutClockEnd: an office encounter resolves when g514's clock reaches 300. g537 (clock >= 300, NotAlways)
// sets `check and move`, and g538-g555 resolve on that loop. The clock adds global value 5 from the loop `in danger`
// rises, that loop included, so the 300th loop of the encounter resolves it, not the 301st (Night 5 contact-final
// tick 7740 and every Night 7 k3 encounter end in the rebuilt runtime). Off: the model resolves 300 frames after the
// start frame.
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';

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

// full-06's winning branch: g845 requests fade completion, but a new danger
// edge at g534 resets the fade before g536 can clear the old clock.
{
  const s = new Sim({ ...QUIET, ...SOURCED, sourcedBlackoutClockEnd: true, frameValue5: () => 1 });
  for (const id of Object.keys(s.ai)) s.ai[id] = 0;
  s.frame = 100; s.maskOn = true; s.maskAnim = 0; s.startBlackout('prior');
  for (let i = 0; i < 299; i++) s.tick();
  assert.equal(s.blackout.active, false);
  assert.equal(s.blackoutClock, 300);
  s.maskOn = false; s.monitor = 'up'; s.viewing = 11; s.tick();
  s.monitor = 'down'; s.viewing = 0;
  s.opts.stalledEnabled = true;
  const u = s.units.find(x => x.id === 'withchica');
  u.atOpening = true; u.officeCue = false;
  s.tick();
  assert.equal(s.blackoutClock, 301, 'entry retains the previous clock');
  assert.equal(s.blackout.active, true, 'g537 cannot fire again while its condition stays true');
  assert.equal(s.blackoutPhase.fade, 2, 'g534 resets 250 to 1 before g535 adds the delta');
  for (let i = 0; i < 248; i++) s.tick();
  assert.equal(s.blackoutClock, 0, 'g536 clears the clock only when the new fade reaches 250');
  assert.equal(s.blackout.active, true, 'the encounter survives that reset');
  for (let i = 0; i < 299; i++) s.tick();
  assert.equal(s.blackout.active, true);
  s.tick();
  assert.equal(s.blackout.active, false, 'a fresh crossing of 300 resolves the encounter');
}

// Without a new danger edge, g845's fade request clears on the next g536 pass.
{
  const s = new Sim({ ...QUIET, ...SOURCED, sourcedBlackoutClockEnd: true, frameValue5: () => 1 });
  s.frame = 100; s.maskOn = true; s.maskAnim = 0; s.startBlackout('prior');
  for (let i = 0; i < 299; i++) s.tick();
  s.maskOn = false; s.monitor = 'up'; s.viewing = 11; s.tick();
  s.tick();
  assert.equal(s.blackoutClock, 0, 'camera viewing completes the old fade');
}

// Off leaves the default unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ sourcedBlackoutClockEnd: false }), 'off equals the default');
}

console.log('blackout clock end: g534-g537 preserve and reset the clock through overlapping fades; g845 camera completion; off unchanged');
