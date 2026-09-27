// Sheet-order corrections the rebuilt runtime exposed on Nights 1-5 (tools/recompile), each behind
// its own default-off option: footstepCamMarkers (CAM 01-04 under `hear footsteps`),
// sourcedBoxCountdown (g653-g661: the drain as a gated Every 50 ms, and the wind hold), and
// sourcedPuppetMoveOrder (g403-g411 carry out g496's armed hop on the next loop), and sourcedHourTable
// (g673-g684 on the first loop, with nights 3-5's Golden Freddy roll).
import assert from 'node:assert/strict';
import { Sim } from '../src/mechanics/plant-model.js';
import * as C from '../src/mechanics/config.js';

const BASE = { night: 7, seed: 111, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
               boxEnabled: false, foxyEnabled: false, sourcedSecondPass: true, sourcedSheetOrder: true };
const script = s => { const log = []; s.rng.int = (a, b) => { log.push([s.frame, `${a},${b}`]); return a; }; s.rng.chance = () => false; return log; };

assert.throws(() => new Sim({ night: 1, sourcedBoxCountdown: true }), /requires sourcedSheetOrder/);
assert.throws(() => new Sim({ night: 1, sourcedPuppetMoveOrder: true }), /requires sourcedSheetOrder/);

// footstepCamMarkers: Withered Freddy 8 -> 7 -> 3 -> hall stage 2 draws on CAM 03 and on the hall stage.
{
  const hops = knob => {
    const s = new Sim({ ...BASE, sourcedFootstepDraws: true, footstepCamMarkers: knob }); s.frame = 1000;
    const u = s.units.find(x => x.id === 'withfreddy');
    const log = script(s);
    const at = [];
    for (let i = 0; i < 3; i += 1) { s.advance(u); s.tick(); at.push([u.path[u.idx], log.filter(([, k]) => k === '0,4').length]); }
    return at;
  };
  assert.deepEqual(hops(false), [[7, 0], [3, 0], ['blindB', 1]], 'off: the hall stages only');
  assert.deepEqual(hops(true), [[7, 0], [3, 1], ['blindB', 2]], 'on: CAM 03 draws too, CAM 07 still does not');
}

// sourcedBoxCountdown on Night 1: nothing drains before 2 AM; from its first reach the gated Every 50 ms
// takes 2 units every 3 loops, so 2000 units last exactly 1000 fires = 3000 loops, in whole units. (The
// continuous drain's last frame depends on float residue and on its frame-count hour, so it is not a
// fixed offset from this.)
const HOOK60 = { frameMs: () => 50 / 3, frameValue5: () => 1 };
const SOURCED = { sourcedDropLightOrder: true, sourcedFoxyChain: true, sourcedSecondPass: true, sourcedSheetOrder: true };
const QUIET1 = { night: 1, seed: 7, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                 foxyEnabled: false, boxEnabled: true, ...SOURCED, ...HOOK60 };
{
  const s = new Sim({ ...QUIET1, sourcedBoxCountdown: true });
  let reach = -1; let last = 1;
  while (s.box > 0 && s.frame < 20000) {
    last = s.box;
    s.tick();
    if (reach < 0 && s.hour >= 2) reach = s.frame;
  }
  assert.ok(reach > 0, 'the hooked clock reaches 2 AM');
  assert.equal(s.frame - reach, 3000, 'first reach loads; 1000 fires of 2 units, 3 loops apart');
  assert.equal(last, 2 / C.BOX_UNITS, 'whole units: exactly one fire left before empty');
  assert.equal(s.box, 0);
}

// The wind hold: a wind loop sets music button value 1 to 10 and g661 drains it after the drain has run,
// so the drain countdown is next reached ten loops after the last wind loop.
{
  const s = new Sim({ ...QUIET1, sourcedBoxCountdown: true });
  while (s.hour < 2) s.tick();
  for (let i = 0; i < 30; i += 1) s.tick();
  const t = s.gatedEvery.box;
  s.monitor = 'up'; s.viewing = C.BOX_CAM; s.winding = true; s.tick(); s.winding = false;   // one wind loop
  const held = t.v;
  const seen = [];
  for (let i = 0; i < 12; i += 1) { s.tick(); seen.push(t.v !== held); }
  assert.equal(seen.indexOf(true), 9, 'the countdown next moves on the tenth loop after the wind');
}

// sourcedPuppetMoveOrder: g496 arms a hop; the hop lands at g403-g411 of the next loop, not the same one.
{
  const firstHop = opts => {
    const s = new Sim({ ...QUIET1, ...opts });   // tickPuppet runs at the end of tickBox
    const p = /** @type {any} */ (s.puppet);
    p.out = true; p.stage = C.PUPPET_ESCAPE_STAGES; p.stunUntil = 0; s.ai.puppet = 20;   // every one-second roll arms a hop
    let armed = -1;
    let n = s.events.length;
    while (s.frame < 3000) {
      s.tick();
      if (armed < 0 && p.pending) armed = s.frame;
      const moved = s.events.slice(n).find(e => e.type === 'puppet-move');
      n = s.events.length;
      if (moved) return { armed: armed < 0 ? s.frame : armed, moved: s.frame };
    }
    return null;
  };
  const on = firstHop({ sourcedPuppetMoveOrder: true, sourcedPuppetGlitchDraws: false });
  const off = firstHop({ sourcedPuppetGlitchDraws: false });
  assert.ok(on && off, 'the Puppet hops at AI 20');
  assert.equal(on.moved - on.armed, 1, 'on: the hop lands the loop after the arming roll');
  assert.equal(off.moved, off.armed, 'off: armed and moved in one frame, as before');
}

// sourcedHourTable: hour 0's rows run on frame 1 at g673-g684 -- after g822, before g811 -- and nights
// 3-5 roll Golden Freddy there (g677 Random(1000), g679/g681 Random(100)); the constructor draws nothing.
assert.throws(() => new Sim({ night: 4, sourcedHourTable: true }), /requires sourcedSheetOrder/);
{
  const firstFrame = (night, opts) => {
    const log = [];
    const Probe = class extends Sim {};
    const s = new Probe({ night, seed: 5, ...SOURCED, sourcedUnconditionalDraws: true, sourcedRandomImageDraw: true, ...opts });
    const built = s.rng.state;
    const next = s.rng.next.bind(s.rng); const int = s.rng.int.bind(s.rng);
    let inner = false;   // int() draws through next(); log the call once
    s.rng.int = (a, b, w) => { log.push(`int ${a},${b}`); inner = true; try { return int(a, b, w); } finally { inner = false; } };
    s.rng.next = () => { if (!inner) log.push('next'); return next(); };
    s.tick();
    return { built, log };
  };
  const on = firstFrame(4, { sourcedHourTable: true });
  assert.equal(on.built, new Sim({ night: 4, seed: 5, ...SOURCED, sourcedHourTable: true }).rng.state);
  assert.equal(on.built, new Sim({ night: 1, seed: 5, ...SOURCED }).rng.state, 'the constructor draws nothing for the hour table');
  assert.deepEqual(on.log.slice(0, 3), ['next', 'int 0,99', 'int 0,999'], 'g822, then g679\'s Golden Freddy roll, then g811');
  const off = firstFrame(4, {});
  assert.ok(!off.log.includes('int 0,99'), 'off: the model\'s night 4 table rolls no Golden Freddy');
  assert.deepEqual(firstFrame(3, { sourcedHourTable: true }).log.slice(0, 3), ['next', 'int 0,999', 'int 0,999'], 'night 3 rolls Random(1000)');
  assert.deepEqual(firstFrame(2, { sourcedHourTable: true }).log.slice(0, 2), ['next', 'int 0,999'], 'night 2: no hour-0 roll, g822 then g811');
  // Night 6's hour-0 Golden Freddy roll (g683, Random(10)) moves from the constructor to after g822.
  const six = firstFrame(6, { sourcedHourTable: true });
  assert.deepEqual(six.log.slice(0, 2), ['next', 'int 0,9']);
  assert.ok(!firstFrame(6, {}).log.slice(0, 2).includes('int 0,9'), 'off: night 6 rolled it in the constructor');
}

// Off, all three leave the default unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ footstepCamMarkers: false }), 'footstep knob off equals the default');
}

console.log('rebuild order: CAM 01-04 footsteps, the gated box drain and wind hold, the next-loop Puppet hop, the first-loop hour table; off unchanged');
