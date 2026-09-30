// The per-second draw groups as one sheet-ordered pass under sourcedSecondPass (dump g213..g781).
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.js';

const QUIET = { night: 7, seed: 61, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                boxEnabled: false, foxyEnabled: false };

// Scripted rng.int: returns a value per (min,max) and logs each call with its frame.
const script = (s, values) => {
  const log = [];
  s.rng.int = (a, b) => { const k = `${a},${b}`; log.push([s.frame, k]); return values[k] ?? a; };
  s.rng.chance = () => { log.push([s.frame, 'chance']); return false; };
  return log;
};
const at = (log, f) => log.filter(([fr]) => fr === f).map(([, k]) => k);

// Countdowns load on the first frame reached and fire 60 frames later; Random(2) == 1 commits the attack.
{
  const s = new Sim({ ...QUIET, sourcedSecondPass: true });
  s.frame = 1000; s.ai.golden = 0; s.box = 99;
  const u = s.units.find(x => x.id === 'withfreddy'); u.inside = true;
  s.maskOn = true; s.maskAnim = 0;
  const log = script(s, { '0,1': 1, '0,9': 0, '0,19': 19 });
  for (let i = 0; i < 70; i++) s.tick();
  assert.deepEqual(at(log, 1020), ['1,2', '0,1'], 'g497 and g744 on the model f % 60 origin');
  assert.deepEqual(at(log, 1061), ['0,19', '0,1', '0,9'], 'g496, g556 (Withered Freddy), g747 fire 60 frames after loading at 1001');
  assert.ok(u.committedAt >= 0, 'Random(2) == 1 commits the inside attack');
  assert.equal(u.inside, true, 'Random(10) = 0 does not leave');
}

// A group reachable from the first frame loaded on the dump's first loop (model frame 0): g496 fires with g497 at 60.
{
  const s = new Sim({ ...QUIET, sourcedSecondPass: true });
  s.ai.golden = 0; s.box = 99;
  const log = script(s, {});
  for (let i = 0; i < 121; i++) s.tick();
  assert.deepEqual(at(log, 60), ['0,19', '1,2', '0,1'], 'g496, g497, g744 on frame 60');
  assert.deepEqual(at(log, 120), ['0,19', '1,2', '0,1'], 'and again on 120');
  assert.deepEqual(at(log, 61), [], 'nothing on 61');
}

// A countdown only runs on frames its earlier conditions hold: g730 pauses while no camera is up.
{
  const s = new Sim({ ...QUIET, sourcedSecondPass: true });
  s.frame = 2000; s.ai.golden = 0; s.box = 99;
  const m = s.units.find(x => x.id === 'mangle'); m.inside = true;
  const log = script(s, {});
  for (let i = 0; i < 20; i++) { s.viewing = 5; s.tick(); }     // 2001 load, 2002..2020 count 19
  for (let i = 0; i < 50; i++) { s.viewing = 0; s.tick(); }     // 2021..2070 paused
  for (let i = 0; i < 45; i++) { s.viewing = 5; s.tick(); }     // 2071.. count the remaining 41 -> fires at 2111
  const g730 = log.filter(([fr, k]) => k === '0,19' && fr !== 2061 && fr !== 2121);
  assert.deepEqual(g730.map(([fr]) => fr), [2111], 'g730 fires once, at 2111');
  assert.equal(at(log, 2061).filter(k => k === '0,19').length, 6, 'g496 and g739-g743 at 2061 (never paused)');
}

// Toy Bonnie leaves on Random(3) == 1 during another unit's encounter (g437).
{
  const s = new Sim({ ...QUIET, sourcedSecondPass: true });
  s.frame = 3000; s.ai.golden = 0; s.box = 99;
  const tb = s.units.find(x => x.id === 'toybonnie'); tb.idx = tb.path.indexOf('ventR'); tb.atOpening = true;
  s.maskOn = true; s.maskAnim = 0;
  s.blackout = { active: true, until: 99999, by: 'x', unitId: null, masked: true, deadline: 0 };
  script(s, { '0,2': 1 });
  for (let i = 0; i < 61; i++) s.tick();
  assert.equal(tb.atOpening, false);
  assert.equal(tb.path[tb.idx], 3, 'back to CAM 03');
}

// Off: the default is unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  if (new Sim({ night: 7, seed: 1 }).opts.sourcedSecondPass === false)
    assert.equal(run({}), run({ sourcedSecondPass: false }), 'explicit off equals the default');
}
console.log('second pass: per-group countdowns load on first reach and pause, Random(N) == 1 outcomes, sheet order g496/g556/g747, g437 Toy Bonnie leave; off unchanged');
