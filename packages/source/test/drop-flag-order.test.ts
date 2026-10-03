// sourcedDropFlagOrder: the drop button's `drop everything` write where the sheet makes it. g262/g274 perform
// the flag near the top of the sheet, g612 clears it, and only then g618 (monitor fully up, mask off) and g619
// (mask fully on, viewing 0, in danger 0) set it from a touch, so a drop or mask-off touched on update F is
// performed on F+1. A press queued before tick F -> F+1 is harness office update F. Off: the default is unchanged.
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';
import type { SimOptions } from '../src/games/fnaf2/plant-options.ts';
import * as C from '../src/games/fnaf2/config.ts';
import { contactEdges, drawTrace } from '../recompile/model-draw-trace.ts';
import { LEGACY_SIM_OPTIONS } from '../src/games/fnaf2/plant-options.ts';

const QUIET = { ...LEGACY_SIM_OPTIONS, night: 7, seed: 3, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false, boxEnabled: false, foxyEnabled: false,
                sourcedDropLightOrder: true };
const settle = (s: Sim, n: number) => { for (let i = 0; i < n; i++) s.tick(); };
// The ledger states compare-schedule-replay.ts reads (`flip panel button` v0 and `mask` v0).
const monitorState = (s: Sim) => ({ down: 0, raising: 1, up: 2, lowering: 3 })[s.monitor as 'down' | 'raising' | 'up' | 'lowering'];   // the panel's four states
const maskState = (s: Sim) => (s.maskOn ? (s.maskAnim > 0 ? 1 : 2) : (s.maskAnim > 0 ? 3 : 0));
/** Press on update F (the Sim's frame now), then tick; the update each state was first reached on. */
const firstReached = (s: Sim, action: string, read: (s: Sim) => number, states: number[], ticks = 40) => {
  const F = s.frame;
  s.press(action);
  const at: Record<number, number> = {};
  for (let i = 0; i < ticks; i++) { s.tick(); const v = read(s); if (states.includes(v) && at[v] === undefined) at[v] = s.frame - 1 - F; }
  return at;
};
const upAtRest = (extra: Partial<SimOptions>) => { const s = new Sim({ ...LEGACY_SIM_OPTIONS, ...QUIET, ...extra }); settle(s, 5); s.press('monitor'); settle(s, 30); assert.equal(s.monitor, 'up'); return s; };
const maskedAtRest = (extra: Partial<SimOptions>) => { const s = new Sim({ ...LEGACY_SIM_OPTIONS, ...QUIET, ...extra }); settle(s, 5); s.press('mask'); settle(s, 30); assert.ok(s.maskFullyOn); return s; };

assert.throws(() => new Sim({ ...LEGACY_SIM_OPTIONS, night: 7, sourcedDropFlagOrder: true }), /requires sourcedDropLightOrder/);

// g618 -> g262: the drop touched on F lowers on F+1 (sourcedDropLightOrder alone lowered on F), and g6's
// 22-count lowering then ends one update later too.
{
  const on = upAtRest({ sourcedDropFlagOrder: true });
  const F = on.frame;
  on.press('monitor'); assert.equal(on.dropEverything, false, 'the press only records the touch');
  on.tick(); assert.equal(on.monitor, 'up', 'update F: g262 has already run'); assert.equal(on.dropEverything, true, 'g618 raised the flag');
  on.tick(); assert.equal(on.monitor, 'lowering', 'update F+1: g262 performs it'); assert.equal(on.viewing, 0); assert.equal(on.dropEverything, false);
  assert.equal(on.frame - 1 - F, 1);
  const off = upAtRest({});
  assert.deepEqual(firstReached(off, 'monitor', monitorState, [3, 0]), { 3: 0, 0: C.MONITOR_ANIM_DOWN - 1 });
  assert.deepEqual(firstReached(upAtRest({ sourcedDropFlagOrder: true }), 'monitor', monitorState, [3, 0]), { 3: 1, 0: C.MONITOR_ANIM_DOWN });
}

// g619 -> g274: the mask-off touched on F starts on F+1 and is fully off on F+15 (g10: mmaskOff v0 >= 14, the
// counter 1 at the end of its show loop and read at the top of the sheet). Off: F and F+14.
{
  assert.deepEqual(firstReached(maskedAtRest({}), 'mask', maskState, [3, 0]), { 3: 0, 0: C.MASK_ANIM_OFF - 1 });
  assert.deepEqual(firstReached(maskedAtRest({ sourcedDropFlagOrder: true }), 'mask', maskState, [3, 0]), { 3: 1, 0: 15 });
  const s = maskedAtRest({ sourcedDropFlagOrder: true });
  s.press('mask'); assert.equal(s.maskFullyOn, true, 'the press only records the touch');
  s.tick(); assert.equal(s.maskFullyOn, true); assert.equal(s.dropEverything, true, 'g619 raised the flag');
  s.tick(); assert.equal(maskState(s), 3, 'g274 performs it');
}

// The mask goes on at the press as before (g270 runs before g274 in the sheet).
{
  const s = new Sim({ ...LEGACY_SIM_OPTIONS, ...QUIET, sourcedDropFlagOrder: true }); settle(s, 5);
  s.press('mask'); assert.equal(maskState(s), 1);
}

// g619 needs `in danger` == 0: a mask-off during an encounter blackout is refused, and flagged.
{
  const s = maskedAtRest({ sourcedDropFlagOrder: true });
  s.blackout = { active: true, until: s.frame + 300, by: 'x', unitId: null, masked: true, deadline: s.frame + 45 };
  s.press('mask'); settle(s, 3);
  assert.equal(s.maskFullyOn, true, 'in danger refuses the mask-off');
  assert.ok(s.mistakes.some(m => /g619/.test(m.detail)), 'the refusal is flagged');
  const old = maskedAtRest({});
  old.blackout = { ...s.blackout }; old.press('mask'); assert.equal(old.maskOn, false, 'off: the model took it off in danger');
}

// g618/g619 read the touch at their sheet position, after g1/g9 finished an animation at the update's top:
// a drop touched on the update the raise completes is performed. sourcedDropLightOrder alone read it at the
// press, from the previous update's state, and refused it.
{
  const raising = (extra: Partial<SimOptions>) => { const s = new Sim({ ...LEGACY_SIM_OPTIONS, ...QUIET, ...extra }); settle(s, 5); s.press('monitor'); while (s.monAnim > 1) s.tick(); assert.equal(s.monitor, 'raising'); return s; };
  const on = raising({ sourcedDropFlagOrder: true }); on.press('monitor'); settle(on, 2); assert.equal(on.monitor, 'lowering');
  const off = raising({}); off.press('monitor'); settle(off, 2); assert.equal(off.monitor, 'up');
  const masking = (extra: Partial<SimOptions>) => { const s = new Sim({ ...LEGACY_SIM_OPTIONS, ...QUIET, ...extra }); settle(s, 5); s.press('mask'); while (s.maskAnim > 1) s.tick(); return s; };
  const m = masking({ sourcedDropFlagOrder: true }); m.press('mask'); settle(m, 2); assert.equal(maskState(m), 3, 'g9 finished at the top, g619 reads mask == 2');
  const mid = masking({ sourcedDropFlagOrder: true }); mid.maskAnim = 3; mid.press('mask'); settle(mid, 4); assert.equal(maskState(mid), 2, 'mid put-on: g619 refuses');
}

// A touch whose update's tick returned early (a non-lethal kill) is not read on a later update.
{
  const s = upAtRest({ sourcedDropFlagOrder: true });
  s.dropTouch = s.frame - 1; s.tick(); assert.equal(s.dropEverything, false);
}

// Off: the default is unchanged -- no new state, and the same events, draws and states under a scripted night.
{
  const script: Array<[number, string]> = [[30, 'monitor'], [80, 'monitor'], [140, 'mask'], [200, 'mask'], [260, 'monitor'], [262, 'monitor'], [330, 'monitor'],
                  [400, 'mask'], [405, 'mask'], [470, 'mask']];
  const run = (opts: Partial<SimOptions>) => {
    const x = new Sim({ ...LEGACY_SIM_OPTIONS, night: 7, seed: 11, lethal: false, durationFrames: 3600, ...opts });
    const rows = [...script]; const trace = [];
    for (let i = 0; i < 3600; i++) {
      while (rows.length && rows[0][0] === x.frame) x.press((rows.shift() as [number, string])[1]);   // rows.length was checked
      x.tick(); trace.push(monitorState(x), maskState(x));
    }
    return JSON.stringify([x.events, x.rng.state, trace, Object.keys(x.snapshot()).sort()]);
  };
  if (new Sim({ ...LEGACY_SIM_OPTIONS, night: 7, seed: 1 }).opts.sourcedDropFlagOrder === false) {
    assert.equal(run({}), run({ sourcedDropFlagOrder: false }), 'explicit off equals the default');
    assert.equal(run({ sourcedDropLightOrder: true }), run({ sourcedDropLightOrder: true, sourcedDropFlagOrder: false }), 'off under sourcedDropLightOrder');
    assert.ok(!('dropTouch' in new Sim({ ...LEGACY_SIM_OPTIONS, night: 7 })), 'off adds no state');
    assert.notEqual(run({ sourcedDropLightOrder: true }), run({ sourcedDropLightOrder: true, sourcedDropFlagOrder: true }), 'on moves the script');
  }
}
// Explicit contacts retain duration, the mask's lock, and camera selection on release.
{
  const opts = { ...QUIET, sourcedDropFlagOrder: true, sourcedSheetOrder: true, sourcedSecondPass: true, sourcedAnimationCount: true };
  const s = new Sim(opts);
  s.contactDown('monitor'); settle(s, 13);
  assert.equal(s.monitor, 'up'); assert.equal(s.dropEverything, true);
  s.contactUp('monitor'); s.tick();
  assert.equal(s.monitor, 'lowering'); assert.equal(s.contactInput?.flipLock, true, 'forcedown writes after release clears the lock');
  s.tick(); assert.equal(s.contactInput?.flipLock, false);
  const short = new Sim(opts);
  short.contactDown('monitor'); settle(short, 12); short.contactUp('monitor'); settle(short, 30);
  assert.equal(short.monitor, 'up', 'release on the completion update prevents the held-touch drop');
  const held = new Sim(opts);
  held.contactDown('monitor'); settle(held, 70);
  assert.equal(held.monitor, 'down'); assert.equal(held.contactInput?.flipLock, true, 'one long contact cannot reopen the monitor');
  const mask = new Sim(opts);
  mask.contactDown('mask'); settle(mask, 50);
  assert.equal(maskState(mask), 2); assert.equal(mask.dropEverything, false);
  const copy = Sim.fromSnapshot(mask.opts, mask.snapshot());
  for (const x of [mask, copy]) { x.contactUp('mask'); x.tick(); x.contactDown('mask'); settle(x, 2); }
  assert.equal(maskState(mask), 3); assert.deepEqual(copy.snapshot(), mask.snapshot());
  const previous = short.viewing;
  short.contactDown('cam:11'); settle(short, 2); assert.equal(short.viewing, previous);
  short.contactUp('cam:11'); short.tick(); assert.equal(short.viewing, 11);
  assert.throws(() => new Sim(QUIET).enableContactInput(), /requires sourcedDropFlagOrder and sourcedSheetOrder/);
  assert.throws(() => contactEdges([{ action: 'mask', downFrame: 2, upFrame: 2 }]), /upFrame > downFrame/);
  assert.throws(() => contactEdges([{ action: 'monitor', downFrame: 0, upFrame: 2 },
    { action: 'monitor', downFrame: 1, upFrame: 3 }]), /overlapping/);
  assert.deepEqual(contactEdges([{ action: 'monitor', downFrame: 0, upFrame: 2 },
    { action: 'mask', downFrame: 2, upFrame: 3 }]).slice(1, 3), [[2, 'contactUp', 'monitor'], [2, 'contactDown', 'mask']]);
  assert.throws(() => drawTrace({ night: 7, seed: 1, frames: 2, rows: [[0, 'press', 'mask']], contacts: [] }), /choose contacts or legacy rows/);
}
console.log('drop flag order: late touch read, forcedown, held monitor, mask lock, release-selected camera, and contact snapshot pass; legacy taps unchanged');
