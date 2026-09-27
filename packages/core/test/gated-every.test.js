// sourcedGatedEvery: an `Every` placed after other conditions is a CND_EVERY2
// countdown that loads on its first reach and only counts down on frames it is
// reached, keeping its remainder between stretches (dump g907, g904, g786,
// g824, g825, g722, g570). The mask-tick case (g907: mask == 2, then Every
// 1000) is the one that decides Balloon Boy, Mangle and Toy Chica at the vent:
// a fully-on window gets 4 or 5 ticks by the carried remainder, at any phase.
import assert from 'node:assert/strict';
import * as C from '../src/mechanics/index.js';

const QUIET = { night: 5, seed: 7, worst: true, lethal: false, stalledEnabled: false, gfEnabled: false, bbEnabled: false,
                boxEnabled: false, foxyEnabled: false, powerEnabled: false };
const bbAtVent = s => { s.bb.stage = C.BB_STAGES; s.bb.inOpening = true; s.bb.openingAtCamsUp = s.camsUpCount; };
// Put the mask on, hold it FULLY on for `frames` frames (the put-on's last tick is the first fully-on
// frame), take it off and let the take-off finish. Returns the vent ticks the window counted.
function window(s, frames) {
  s.press('mask');
  for (let i = 0; i < C.MASK_ANIM_ON - 1 + frames; i++) s.tick();
  const ticks = s.bb.maskTicks;
  s.press('mask');
  for (let i = 0; i < C.MASK_ANIM_OFF; i++) s.tick();
  return ticks;
}

// g907 on: the countdown loads on the first fully-on frame and fires every 60 reached frames after it,
// so a fresh 300-frame window gets four ticks and Balloon Boy stays at the vent -- and the next
// 300-frame window starts one frame short of a fire, gets five, and sends him back.
{
  const s = new C.Sim({ ...QUIET, sourcedGatedEvery: true });
  bbAtVent(s);
  assert.equal(window(s, 300), 4, 'fresh countdown: fires on reached frames 61, 121, 181, 241 -- four in 300');
  assert.equal(s.bb.inOpening, true, 'four ticks do not clear Balloon Boy (g294 needs five)');
  window(s, 300);
  assert.equal(s.bb.inOpening, false, 'the carried remainder puts five ticks in the same 300 frames');
  assert.equal(s.bb.stage, 0, 'g294 sends him back to CAM 10');
}
// The same window length on the global one-second grid (option off) is decided by phase alone.
{
  const s = new C.Sim(QUIET); bbAtVent(s);
  // fully on over frames 12..311: 60, 120, 180, 240, 300 -- five boundaries
  window(s, 300);
  assert.equal(s.bb.inOpening, false, 'off: five global boundaries inside the window clear him');
  const t = new C.Sim(QUIET); t.frame = 30; bbAtVent(t);
  // fully on over frames 42..314 (273 frames = 4551 ms): 60, 120, 180, 240, 300 -- five again
  window(t, 273);
  assert.equal(t.bb.inOpening, false, 'off: a 4551 ms window at a lucky phase gets five');
  const u = new C.Sim(QUIET); u.frame = 50; bbAtVent(u);
  // fully on over frames 62..334: 120, 180, 240, 300 -- four
  window(u, 273);
  assert.equal(u.bb.inOpening, true, 'off: the same window one phase later gets four and he stays');
}
// A window exceeding 5000 ms by one reached frame gets five ticks whatever
// the remainder, including the first-load frame (the h2 / mask5plus floor).
for (const prime of [0, 1, 17, 59, 100, 133]) {
  const s = new C.Sim({ ...QUIET, sourcedGatedEvery: true });
  if (prime) window(s, prime);
  bbAtVent(s);
  window(s, 301);
  assert.equal(s.bb.inOpening, false, `on: 301 fully-on frames clear him after a ${prime}-frame primer`);
}

// g786 on: the cams-up streak counts gated fires while viewing > 0, g785 zeroes it at viewing 0, and
// the countdown keeps its remainder across the drop.
{
  const s = new C.Sim({ ...QUIET, night: 7, sourcedGatedEvery: true });
  s.frame = 1000;   // off frame 1, where a countdown first reached is already loaded (plant-model.js passEvery)
  s.monitor = 'up'; s.monAnim = 0; s.viewing = 5; s.cam = 5;
  for (let i = 0; i < 300; i++) s.tick();
  assert.equal(s.streakTicks, 4, 'fires on viewed frames 61, 121, 181, 241');
  s.monitor = 'down'; s.viewing = 0;
  for (let i = 0; i < 100; i++) s.tick();
  assert.equal(s.streakTicks, 0, 'g785 zeroes the streak once viewing is 0');
  s.monitor = 'up'; s.viewing = 5;
  s.tick();
  assert.equal(s.streakTicks, 1, 'the countdown held its remainder: the first viewed frame after the drop fires');
}

// g824 on (requires the sourced Foxy chain): D counts gated fires, which stop while in danger.
{
  const mk = gated => {
    const s = new C.Sim({ ...QUIET, foxyEnabled: true, sourcedDropLightOrder: true, sourcedFoxyChain: true,
                          sourcedGatedEvery: gated });
    s.ai.foxy = 0;          // g337 never accepts, so nothing zeroes D
    s.frame = 1000;
    const quiet = { active: false, until: 0, by: null, unitId: null, masked: false, deadline: 0 };
    for (let f = 1001; f <= 1300; f++) {
      // an encounter (`in danger`) over frames 1050..1169, held open and defended so it never resolves
      s.blackout = f >= 1050 && f < 1170 ? { ...quiet, active: true, until: 1e9, by: 'test', masked: true } : quiet;
      s.tick();
    }
    return s.foxy.D;
  };
  assert.equal(mk(false), 3, 'off: global boundaries 1020, 1200, 1260 fall outside the encounter');
  assert.equal(mk(true), 2, 'on: loaded at 1001, 48 + 12 reached frames fire at 1181, then 1241 only');
}

// Mangle shares g907's countdown. A short first hold cannot force her out;
// the next hold can, because the countdown retains its remainder.
{
  const s = new C.Sim({ ...QUIET, stalledEnabled: true, sourcedGatedEvery: true, sourcedMangleReturn: true });
  s.onFiveSecond = () => {}; // isolate this encounter from new movement rolls
  const m = s.units.find(u => u.id === 'mangle');
  m.idx = m.path.indexOf('ventR'); m.atOpening = true;
  window(s, 273);
  assert.equal(m.atOpening, true, 'g401 cannot force Mangle out after four ticks');
  window(s, 301);
  assert.equal(m.atOpening, false, 'five carried ticks force Mangle out');
  assert.equal(m.path[m.idx], 7, 'sourced Mangle return is CAM 07');
}

// A variable frame clock measures reached time, not the number or phase of
// frames. At 20 ms per frame, a fresh g907 needs its load plus 250 reaches.
{
  const s = new C.Sim({ ...QUIET, sourcedGatedEvery: true, sourcedSheetOrder: true,
    sourcedSecondPass: true, frameMs: () => 20 });
  s.rng.int = () => 0; // deny the independent g292 random early exit
  bbAtVent(s);
  window(s, 250);
  assert.equal(s.bb.inOpening, true, '250 frames include the load, leaving four fires');
  window(s, 252);
  assert.equal(s.bb.inOpening, false, 'five fires and the next sheet pass clear Balloon Boy');
}

// Toy Chica's g904 countdown advances only while she is at the vent. A
// camera-up stretch arms her on the sixth fire, not on a wall-clock second.
{
  const s = new C.Sim({ ...QUIET, stalledEnabled: true, sourcedGatedEvery: true });
  s.onFiveSecond = () => {}; // isolate this encounter from new movement rolls
  const u = s.units.find(x => x.id === 'toychica');
  s.frame = 1000; s.monitor = 'up'; s.monAnim = 0; s.viewing = 5; s.cam = 5;
  u.idx = u.path.indexOf('ventL'); u.atOpening = true;
  for (let i = 0; i < 301; i++) s.tick();
  assert.equal(u.openingTicks, 5, 'five reached seconds');
  u.atOpening = false;
  for (let i = 0; i < 100; i++) s.tick();
  u.atOpening = true;
  for (let i = 0; i < 59; i++) s.tick();
  assert.equal(u.inside, false, 'absence from the vent did not advance g904');
  s.tick();
  assert.equal(u.inside, true, 'sixth g904 fire arms the cameras-up entry');
}

// Toy Bonnie's ten-second inside attack starts when its conditions become
// true, even when that is unrelated to the global ten-second boundary.
{
  const s = new C.Sim({ ...QUIET, stalledEnabled: true, sourcedGatedEvery: true });
  s.onFiveSecond = () => {};
  const u = s.units.find(x => x.id === 'toybonnie');
  s.frame = 1000; s.monitor = 'up'; s.monAnim = 0; s.viewing = 5; s.cam = 5;
  u.inside = true;
  for (let i = 0; i < 600; i++) s.tick();
  assert.equal(u.committedAt, -1, 'g722 first loads, then waits ten reached seconds');
  s.tick();
  assert.equal(u.committedAt, s.frame + C.INSIDE_ATTACK_FRAMES, 'g722 commits after the 601st reached frame');
}

// Hall Golden Freddy also loads only after reaching marker 123 (g570).
{
  const s = new C.Sim({ ...QUIET, gfEnabled: true, sourcedGatedEvery: true });
  s.onFiveSecond = () => {};
  s.frame = 1000; s.gf.hallInside = true;
  for (let i = 0; i < 60; i++) s.tick();
  assert.equal(s.gf.attackAt, -1, 'g570 does not use the intervening global boundary');
  s.tick();
  assert.equal(s.gf.attackAt, s.frame + C.INSIDE_ATTACK_FRAMES, 'g570 fires after a full reached second');
}

// Default off, and explicit off equals the default, event for event.
{
  assert.equal(new C.Sim({ night: 6, seed: 1 }).opts.sourcedGatedEvery, false, 'default off');
  const run = opts => { const x = new C.Sim({ night: 6, seed: 23, lethal: false, ...opts }); for (let i = 0; i < 6000; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ sourcedGatedEvery: false }), 'explicit off equals the default');
}
console.log('gated every: BB/Mangle mask windows, variable frame clock, cams streak, Foxy danger, Toy Chica/Bonnie and Golden Freddy countdowns; off keeps the global grid');
