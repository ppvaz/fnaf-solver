// sourcedAnimationCount: the latches g1 (monitor fully up, >= 12), g6 (fully down, >= 22), g9 (mask fully on, >= 12) and
// g10 (fully off, >= 14) read the prior loop's accumulated value 5. At 60 Hz, N loops; a measured clock can differ.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim } from '../src/games/fnaf2/plant-model.ts';
import type { Death, Unit } from '../src/games/fnaf2/plant-model.ts';
import type { SimOptions } from '../src/games/fnaf2/plant-options.ts';
import { LEGACY_SIM_OPTIONS } from '../src/games/fnaf2/plant-options.ts';

const QUIET = { night: 7, seed: 5, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                boxEnabled: false, foxyEnabled: false };

/** The tick an animation finishes on, counted from the tick it starts on (a press applies before its tick). */
const span = (opts: Partial<SimOptions>, start: (s: Sim) => void, done: (s: Sim) => boolean) => {
  const s = new Sim({ ...LEGACY_SIM_OPTIONS, ...QUIET, ...opts });
  s.tick();
  start(s);
  let n = 0;
  while (!done(s) && n < 100) { s.tick(); n += 1; }
  return n - 1;
};

const raise = (opts: Partial<SimOptions>) => span(opts, (s) => s.setMonitor(true), (s) => s.monitor === 'up');
const drop = (opts: Partial<SimOptions>) => span(opts, (s) => { s.monitor = 'up'; s.setMonitor(false); }, (s) => s.monitor === 'down');
const maskOn = (opts: Partial<SimOptions>) => span(opts, (s) => s.setMask(true), (s) => s.maskFullyOn);
const maskOff = (opts: Partial<SimOptions>) => span(opts, (s) => { s.maskOn = true; s.setMask(false); }, (s) => s.maskFullyOff);

assert.deepEqual([raise({}), drop({}), maskOn({}), maskOff({})], [11, 21, 11, 14], 'off: one update short of g1, g6 and g9');
const on = { sourcedAnimationCount: true };
assert.deepEqual([raise(on), drop(on), maskOn(on), maskOff(on)], [12, 22, 12, 14], 'on: g1 >= 12, g6 >= 22, g9 >= 12, g10 >= 14');

const hooked = { ...on, sourcedDropLightOrder: true, sourcedSecondPass: true, sourcedSheetOrder: true };
// Each direction uses the late animation clock, with completion on the next loop's top latch.
for (const [delta, expected] of [[2, [6, 11, 6, 7]], [0.5, [24, 44, 24, 28]]] as const) {
  const opts = { ...hooked, frameValue5: () => delta };
  assert.deepEqual([raise(opts), drop(opts), maskOn(opts), maskOff(opts)], expected, `value 5 = ${delta}`);
}

// The nine measured raises include five that fixed frame counting finished one update early.
const measured = JSON.parse(readFileSync(new URL('../../../docs/evidence/full06-animation-clock-20260930.json', import.meta.url), 'utf8'));
assert.equal(measured.measurements.raiseCompletions.length, 9, 'a nonempty measured regression fixture');
for (const row of measured.measurements.raiseCompletions) {
  const opts = { ...hooked, frameValue5: (f: number) => Math.min(4,
    (row.deltasMsUsed[f - 2] ?? 50 / 3) / measured.sourceInterpretation.divisor) };
  assert.equal(raise(opts), row.actualCompletionUpdate - row.startUpdate, `raise at update ${row.startUpdate}`);
}

// A later show resets each clock, and snapshot/restore retains a partially accumulated one.
{
  const s = new Sim({ ...LEGACY_SIM_OPTIONS, ...QUIET, ...hooked, frameValue5: () => 0.75 });
  const cycle = (set: () => void, done: () => boolean) => {
    set(); let ticks = 0;
    while (!done() && ticks < 100) { s.tick(); ticks++; }
    return ticks - 1;
  };
  for (let i = 0; i < 2; i++) {
    assert.equal(cycle(() => s.setMonitor(true), () => s.monitor === 'up'), 16);
    assert.equal(cycle(() => s.setMonitor(false), () => s.monitor === 'down'), 30);
    assert.equal(cycle(() => s.setMask(true), () => s.maskFullyOn), 16);
    assert.equal(cycle(() => s.setMask(false), () => s.maskFullyOff), 19);
  }
  s.setMonitor(true);
  for (let i = 0; i < 5; i++) s.tick();
  const copy = Sim.fromSnapshot(s.opts, s.snapshot());
  for (let i = 0; i < 15; i++) { s.tick(); copy.tick(); }
  assert.deepEqual(copy.snapshot(), s.snapshot(), 'animation clock survives a branch');
}

// Off leaves the default unchanged.
{
  const run = (opts: Partial<SimOptions>) => { const x = new Sim({ ...LEGACY_SIM_OPTIONS, night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ sourcedAnimationCount: false }), 'off equals the default');
}

// g10/g11 separate the visual animation endpoint from the mask state during an attack.
for (const sourcedAnimationCount of [false, true]) {
  const s = new Sim({ ...LEGACY_SIM_OPTIONS, ...QUIET, ...hooked, sourcedAnimationCount });
  s.maskOn = true;
  s.setMask(false);
  (s.units.find(u => u.id === 'withbonnie') as Unit).committedAt = 1000;   // one of the seven route units
  for (let i = 0; i < 30; i++) s.tick();
  assert.equal(s.maskAnim, 0, 'the visual mask-off animation finishes');
  assert.equal(s.maskState, sourcedAnimationCount ? 3 : 0, 'only the sourced marker latches during attack');
  assert.equal(s.maskFullyOff, !sourcedAnimationCount);
  assert.equal(Sim.fromSnapshot(s.opts, s.snapshot()).maskState, s.maskState);
  s.setMonitor(true); s.setMonitor(false);
  for (let i = 0; i < 30; i++) s.tick();
  assert.equal(s.monAnim, 0);
  assert.equal(s.monitor, sourcedAnimationCount ? 'lowering' : 'down', 'g6/g7 have the same attack gate');
}

// Rebuilt sprite exits use their own fixed clock; g587/g588 use value 5.
// The terminal early dispatch spends no ordinary-loop RNG or attack-counter increment.
const attackOpts = { ...QUIET, ...hooked, lethal: true, sourcedAttackAnimation: true };
for (const [value5, updates, mechanism] of [[0.5, 32, 'animation'], [1, 32, 'animation'], [2, 20, 'counter']] as const) {
  const s = new Sim({ ...LEGACY_SIM_OPTIONS, ...attackOpts, frameValue5: () => value5 });
  for (let i = 0; i < 3; i++) s.tick();
  s.commitAttack(s.units.find(u => u.id === 'withbonnie') as Unit, 'fixture');   // one of the seven route units
  const start = s.frame;
  let prior = null;
  while (s.alive && s.frame < start + 100) { prior = s.attackAnimation?.count; s.tick(); }
  assert.equal(s.frame - start, updates, `value5=${value5}: ${mechanism} ends the attack`);
  assert.match((s.death as Death).detail, new RegExp(mechanism));   // the frame count above ended on the death
  if (mechanism === 'animation') assert.equal(s.attackAnimation?.count, prior);
}
{
  const s = new Sim({ ...LEGACY_SIM_OPTIONS, ...attackOpts, frameValue5: () => 0.75 });
  for (let i = 0; i < 3; i++) s.tick();
  s.commitAttack(s.units.find(u => u.id === 'withbonnie') as Unit, 'fixture');   // one of the seven route units
  for (let i = 0; i < 8; i++) s.tick();
  const copy = Sim.fromSnapshot(s.opts, s.snapshot());
  while (s.alive) { s.tick(); copy.tick(); }
  assert.deepEqual(copy.snapshot(), s.snapshot(), 'both attack clocks survive a branch');
}
assert.throws(() => new Sim({ ...LEGACY_SIM_OPTIONS, sourcedAttackAnimation: true }), /requires sourcedSheetOrder/);
for (const [who, updates, mechanism] of [
  ['withfreddy', 80, 'counter'], ['withchica', 80, 'counter'], ['toyfreddy', 80, 'counter'],
  ['toybonnie', 26, 'animation'], ['toychica', 32, 'animation'], ['mangle', 32, 'animation'],
  ['puppet', 30, 'animation'], ['golden', 32, 'animation'],
] as const) {
  const s = new Sim({ ...LEGACY_SIM_OPTIONS, ...attackOpts, frameValue5: () => 0.5 });
  for (let i = 0; i < 3; i++) s.tick();
  if (who === 'puppet') s.puppet.attackAt = 43;
  else if (who === 'golden') s.gf.attackAt = 43;
  else s.commitAttack(s.units.find(u => u.id === who) as Unit, 'fixture');   // one of the seven route units
  const start = s.frame;
  while (s.alive && s.frame < start + 100) s.tick();
  assert.equal(s.frame - start, updates, `${who}: sourced attack sprite and shared counter`);
  assert.match((s.death as Death).detail, new RegExp(mechanism));   // the frame count above ended on the death
}

console.log('animation count: 9 measured raises; four panel clocks and terminal latches; attack counter vs sprite exits; snapshots; legacy unchanged');
