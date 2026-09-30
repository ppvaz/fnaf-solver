// The frame-time hook (frameMs, frameValue5) over the sheet-ordered countdowns.
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';
import * as C from '../src/games/fnaf2/config.ts';

const SOURCED = { sourcedDropLightOrder: true, sourcedFoxyChain: true, sourcedUnconditionalDraws: true,
  sourcedEventDraws: true, sourcedBlackoutDraws: true, sourcedViewDraws: true, sourcedRollDraws: true,
  sourcedMonitorDownDraw: true, sourcedSecondPass: true, sourcedPuppetGlitchDraws: true, sourcedRouteForks: true,
  sourcedSheetOrder: true };
const QUIET = { night: 7, seed: 91, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                boxEnabled: false, foxyEnabled: false };

assert.throws(() => new Sim({ night: 7, frameMs: () => 17 }), /requires sourcedSheetOrder/);
{
  const { sourcedFoxyChain, ...noChain } = SOURCED;
  assert.throws(() => new Sim({ night: 7, foxyEnabled: true, ...noChain, sourcedDropLightOrder: true, frameMs: () => 17 }),
    /requires sourcedFoxyChain/);
}

// The shared cadences at 20 ms loops (60 units): 1 s every 50 frames, 500 ms every 25, 200 ms every 10, 10 s every 500.
{
  const s = new Sim({ ...QUIET, ...SOURCED, frameMs: () => 20 });
  const seen = { sec: [], half: [], sample: [], ten: [] };
  while (s.frame < 1000) {
    s.tick();
    if (s.secTick) seen.sec.push(s.frame);
    if (s.halfTick) seen.half.push(s.frame);
    if (s.sampleTick) seen.sample.push(s.frame);
    if (s.tenTick) seen.ten.push(s.frame);
  }
  assert.deepEqual(seen.sec.slice(0, 3), [50, 100, 150]);
  assert.deepEqual(seen.half.slice(0, 3), [25, 50, 75]);
  assert.deepEqual(seen.sample.slice(0, 3), [10, 20, 30]);
  assert.deepEqual(seen.ten, [500, 1000]);
}

// A 60 fps hook (50/3 ms, value 5 = 1) is trace-identical to no hook: lethal nights with every character through
// their deaths, and a quiet night to 6 AM. (Under lethal: false a model kill returns early and skips that frame's
// countdown reaches, so hooked cadences slip a frame per non-lethal kill -- frames the phone never plays.)
{
  const cams = [11, 3, 4, 1, 10, 7, 8, 5];
  const play = (seed, hook, base = {}) => {
    const s = new Sim({ night: 7, lethal: true, seed, ...base, ...SOURCED, ...hook });
    while (s.alive && !s.won && s.frame < 30000) {
      const f = s.frame;
      if (f % 150 === 20) s.setMonitor(true);
      if (f % 150 === 30 && s.viewing > 0) { const c = cams[(f / 150 | 0) % cams.length]; s.viewing = c; s.cam = c; }
      s.lightHeld = f % 150 >= 40 && f % 150 < 70;
      if (f % 150 === 90) s.setMonitor(false);
      s.tick();
    }
    return JSON.stringify([s.events, s.rng.state, s.frame, s.won]);
  };
  const hook60 = { frameMs: () => 50 / 3, frameValue5: () => 1 };
  for (const seed of [3, 4, 5])
    assert.equal(play(seed, hook60), play(seed, {}), `seed ${seed}`);
  const quiet = { stalledEnabled: false, bbEnabled: false, gfEnabled: false, boxEnabled: false, foxyEnabled: false };
  const hooked = play(6, hook60, quiet);
  assert.equal(hooked, play(6, {}, quiet), 'quiet night');
  const [, , frame, won] = JSON.parse(hooked);
  assert.equal(won, true, 'the quiet night reaches 6 AM, so the identity covers the whole night');
  assert.equal(frame, C.NIGHT_FRAMES);
}

// 20 ms loops (60 units): a second is 50 frames, an hour 3500, the night 21000.
{
  const s = new Sim({ ...QUIET, ...SOURCED, frameMs: () => 20 });
  const hours = []; const h = s.applyAiHour.bind(s);
  s.applyAiHour = n => { hours.push([s.frame, n]); return h(n); };
  const fives = []; const five = s.onFiveSecond.bind(s);
  s.onFiveSecond = () => { fives.push(s.frame); return five(); };
  while (!s.won && s.frame < 25200) s.tick();
  assert.deepEqual(fives.slice(0, 3), [250, 500, 750]);
  assert.deepEqual(hours.slice(0, 2), [[3500, 1], [7000, 2]]);
  assert.equal(s.frame, 21000, 'six hours of 20 ms loops');
}

// g514 at global value 5 = 2: the clock passes 20 and reaches 200 twice as fast -- 89 flicker draws, not 179.
{
  const count = v5 => {
    const s = new Sim({ ...QUIET, ...SOURCED, frameValue5: () => v5 });
    s.frame = 1000;
    let n = 0; const int = s.rng.int.bind(s.rng);
    s.rng.int = (a, b, w) => { if (a === 0 && b === 49) n++; return int(a, b, w); };
    s.startBlackout('test');
    for (let i = 0; i < C.BLACKOUT_FRAMES; i++) s.tick();
    return n;
  };
  assert.equal(count(1), 179);
  assert.equal(count(2), 89);
}
console.log('frame-time hook: requires sheet order; a 60 fps hook is trace-identical; 20 ms loops give 250-frame rolls, 3500-frame hours, a 21000-frame night; value 5 = 2 halves the flicker draws');
