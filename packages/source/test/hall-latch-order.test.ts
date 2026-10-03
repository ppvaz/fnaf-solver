// sourcedHallLatchOrder: `viewing hall light` is cleared by g488 (Every 1000 ms) and set again by g489 while
// the light is lit, both after the route moves g380-g383 that read it. So on a second boundary after the light
// is released, the moves still see the latch set, and it clears only after them. The hooked clock used to
// clear it at the top of the tick, before the rolls and moves (Night 7 k3's first replay mismatch).
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';
import type { SimOptions } from '../src/games/fnaf2/plant-options.ts';
import { LEGACY_SIM_OPTIONS } from '../src/games/fnaf2/plant-options.ts';

const SOURCED = { sourcedDropLightOrder: true, sourcedFoxyChain: true, sourcedSecondPass: true, sourcedSheetOrder: true };
const HOOK60 = { frameMs: () => 50 / 3, frameValue5: () => 1 };
const QUIET = { night: 7, seed: 5, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                boxEnabled: false, foxyEnabled: false };

assert.throws(() => new Sim({ ...LEGACY_SIM_OPTIONS, night: 1, sourcedHallLatchOrder: true }), /requires frameMs/);

/** The latch as tickUnits sees it on the first second boundary after the light is released, and after that tick. */
const boundary = (opts: Partial<SimOptions>) => {
  const s = new Sim({ ...LEGACY_SIM_OPTIONS, ...QUIET, ...SOURCED, ...HOOK60, ...opts });
  const seen: Array<{ frame: number, sec: boolean, stall: boolean }> = [];
  const units = s.tickUnits.bind(s);
  s.tickUnits = (f) => { seen.push({ frame: s.frame, sec: s.secTick, stall: s.lightStallOn }); return units(f); };
  for (let i = 0; i < 20; i += 1) s.tick();
  s.lightHeld = true;                       // the office light, cameras down
  for (let i = 0; i < 10; i += 1) s.tick();
  s.lightHeld = false;
  const from = seen.length;
  let after = null;
  for (let i = 0; i < 90 && after === null; i += 1) {
    s.tick();
    if (seen[seen.length - 1].sec) after = s.lightStallOn;
  }
  const at = seen.slice(from).find((x) => x.sec) as (typeof seen)[number];   // a second boundary falls within the 90 ticks above
  return { during: at.stall, after };
};

{
  const off = boundary({});
  assert.equal(off.during, false, 'off: the one-second reset clears the latch before the moves');
  const on = boundary({ sourcedHallLatchOrder: true });
  assert.equal(on.during, true, 'on: the moves on the boundary loop still see the latch set (g381 waits)');
  assert.equal(on.after, false, 'on: g488 clears it after the moves, and g489 does not re-set it with the light off');
}

// Off leaves the default unchanged.
{
  const run = (opts: Partial<SimOptions>) => { const x = new Sim({ ...LEGACY_SIM_OPTIONS, night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ sourcedHallLatchOrder: false }), 'off equals the default');
}

console.log('hall latch order: g488/g489 after the route moves, so a boundary move waits one loop; off unchanged');
