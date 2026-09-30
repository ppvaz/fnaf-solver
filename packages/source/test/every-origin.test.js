// sourcedEveryOrigin: every CND_EVERY2 countdown loads on the loop it is first
// reached, which for an ungated group is the frame's first loop -- the loop
// that also spends g822's StartOfFrame draw (classes.dex: initRunLoop runs no
// events; the first f_GameLoop runs the StartOfFrame list, then the first
// always pass). Off keeps the committed frame-0 origin.
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';

const SOURCED = { sourcedDropLightOrder: true, sourcedFoxyChain: true, sourcedUnconditionalDraws: true,
  sourcedEventDraws: true, sourcedBlackoutDraws: true, sourcedViewDraws: true, sourcedRollDraws: true,
  sourcedMonitorDownDraw: true, sourcedSecondPass: true, sourcedPuppetGlitchDraws: true, sourcedRouteForks: true,
  sourcedSheetOrder: true };
const HOOK60 = { frameMs: () => 50 / 3, frameValue5: () => 1 };
const QUIET = { night: 7, seed: 91, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                boxEnabled: false, foxyEnabled: false };

// Only the hook runs every cadence as a countdown; unhooked f % N timers keep their own origin.
assert.throws(() => new Sim({ ...QUIET, ...SOURCED, sourcedEveryOrigin: true }), /requires frameMs or frameValue5/);

const cadence = (origin) => {
  const s = new Sim({ ...QUIET, ...SOURCED, ...HOOK60, sourcedEveryOrigin: origin });
  const seen = { unconditional: [], sec: [], half: [], sample: [] };
  let before = s.unconditionalDraws;
  while (s.frame < 130) {
    s.tick();
    if (s.unconditionalDraws !== before) seen.unconditional.push([s.frame, s.unconditionalDraws - before]);
    before = s.unconditionalDraws;
    if (s.secTick) seen.sec.push(s.frame);
    if (s.halfTick) seen.half.push(s.frame);
    if (s.sampleTick) seen.sample.push(s.frame);
  }
  return seen;
};

{
  const off = cadence(false);
  const on = cadence(true);
  // g822 on frame 1 either way; g58 and g192 (Every 100 ms) together on frame 6 off, frame 7 on.
  assert.deepEqual(off.unconditional.slice(0, 2), [[1, 1], [6, 2]]);
  assert.deepEqual(on.unconditional.slice(0, 2), [[1, 1], [7, 2]]);
  // The shared cadences move by the same one loop: 1 s, 500 ms, 200 ms.
  assert.deepEqual(off.sec.slice(0, 2), [60, 120]);
  assert.deepEqual(on.sec.slice(0, 2), [61, 121]);
  assert.deepEqual(off.half.slice(0, 2), [30, 60]);
  assert.deepEqual(on.half.slice(0, 2), [31, 61]);
  assert.deepEqual(off.sample.slice(0, 2), [12, 24]);
  assert.deepEqual(on.sample.slice(0, 2), [13, 25]);
}

// A group first reached after frame 1 loads there in both origins; only the frame-1 reach differs.
{
  const s = new Sim({ ...QUIET, ...SOURCED, ...HOOK60, sourcedEveryOrigin: true });
  s.tick();
  const t = { v: 0, init: false };
  s.tick();
  assert.equal(s.passEvery(t, 100), false, 'a later first reach loads and returns false');
  const fires = [];
  for (let i = 0; i < 14; i += 1) { s.tick(); if (s.passEvery(t, 100)) fires.push(s.frame); }
  assert.deepEqual(fires, [8, 14], 'loaded on frame 2, Every 100 ms fires six loops later');
}

console.log('every origin: the frame-1 countdown load follows the dex, off unchanged');
