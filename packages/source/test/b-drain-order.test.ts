// sourcedBDrainOrder: g344-g360 read value 1 (B) for a promotion before g361-g371 drain it, and every writer of B sits
// after the drain. So B = N written on loop L is 0 at the promotion only on L+N+1: stunUntil (L+N) blocks through
// f == stunUntil (Night 1 minimal tick 21714: Toy Bonnie promoted a loop early after a camera flash). The hall pin
// (g848-g854) is written after g488/g489, so under sourcedHallLatchOrder it follows the deferred latch reset.
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';
import { drainUnitStuns, setUnitStun, unitStunReady } from '../src/games/fnaf2/movement-clock.ts';

const QUIET = { night: 7, seed: 5, lethal: false, bbEnabled: false, gfEnabled: false, boxEnabled: false, foxyEnabled: false };

const WEIGHTED = { sourcedBDrainOrder: true, sourcedMovementClock: true, sourcedRoutePass: true,
  sourcedPromotedMoves: true, sourcedRollsBeforeMoves: true, sourcedRollDraws: true,
  sourcedRouteForks: true, sourcedSecondPass: true, sourcedSheetOrder: true, frameValue5: () => 1.5 };
assert.throws(() => new Sim({ ...QUIET, sourcedMovementClock: true }), /requires sourcedBDrainOrder and sourcedRoutePass/);

// A fractional B is still a closed promotion gate. Draining it to zero permits the next pass.
{
  const s = new Sim({ ...QUIET, ...WEIGHTED });
  s.decidePath = 1;
  const u = s.units.find(x => x.id === 'withfreddy');
  u.idx = u.path.indexOf(3); u.pending = true;
  setUnitStun(s, u, 2.5);
  s.routePass(1);
  assert.equal(s.unitStunLeft(u), 1);
  assert.equal(u.promoted, false);
  s.routePass(2);
  assert.equal(s.unitStunLeft(u), 0);
  assert.equal(u.path[u.idx], 3, 'B became zero only after the promotion tests');
  s.routePass(3);
  assert.equal(u.path[u.idx], 'blindB', 'promotion and movement happen on the next update');
}

// Every B writer uses the same counter: camera flash, route return, repel, and Toy Bonnie's arrival.
{
  const s = new Sim({ ...QUIET, ...WEIGHTED });
  const u = s.units.find(x => x.id === 'withfreddy');
  u.idx = u.path.indexOf(3);
  s.stunCam(3, 7.25);
  assert.equal(s.unitStunLeft(u), 7.25);
  s.unitLeave(u, { cooldown: 3.25 });
  assert.equal(s.unitStunLeft(u), 3.25);
  u.idx = u.path.indexOf('blindB'); u.promoted = true; s.maskOn = true; s.maskAnim = 0;
  assert.equal(s.sourcedRouteStep(u, s.frame, 'move'), 'returned');
  assert.equal(s.unitStunLeft(u), 1500);
  const toy = s.units.find(x => x.id === 'toybonnie');
  toy.idx = toy.path.length - 2;
  s.advanceUnit(toy);
  assert.equal(s.unitStunLeft(toy), 300);
  setUnitStun(s, s.puppet, 0.75);
  drainUnitStuns(s, s.frame);
  assert.equal(unitStunReady(s, s.puppet, s.frame), true, 'Puppet reads B after g372 clamps it to zero');
  assert.equal(s.unitStunLeft(u), 1498.5);
  const copy = Sim.fromSnapshot(s.opts, s.snapshot());
  drainUnitStuns(copy, copy.frame); drainUnitStuns(s, s.frame);
  assert.deepEqual(copy.snapshot(), s.snapshot(), 'remaining B survives a branch');
}

// Runtime repels retain the fractional quotient: Random(500) / night, e.g. 310 / 7 at full-06 update 2328.
{
  const s = new Sim({ ...QUIET, ...WEIGHTED });
  s.rng.int = () => 310;
  assert.equal(s.repelCooldown(), 310 / 7);
  const old = new Sim(QUIET); old.rng.int = () => 310;
  assert.equal(old.repelCooldown(), 44, 'the legacy lane retains its integer deadline');
}

// The promotion read: a flash on loop L = 1000 writes stunUntil 1400.
{
  const promotable = (opts, f) => {
    const s = new Sim({ ...QUIET, ...opts });
    const u = s.units.find(x => x.id === 'toybonnie');
    u.stunUntil = 1400;
    return s.footstepPromotable(u, f);
  };
  assert.equal(promotable({}, 1400), true, 'off: promoted on the loop B reaches 0');
  assert.equal(promotable({ sourcedBDrainOrder: true }, 1400), false, 'on: g353 still reads B = 1 before the drain');
  assert.equal(promotable({ sourcedBDrainOrder: true }, 1401), true, 'on: promoted on the next loop');
}

// The Night 1 discard (g356): Toy Chica's accepted roll is discarded on the loop her B is first read 0.
{
  const discard = (opts, f) => {
    const s = new Sim({ ...QUIET, night: 1, sourcedRouteForks: true, ...opts });
    const u = s.units.find(x => x.id === 'toychica');
    u.stunUntil = 1400;
    return s.sourcedRouteStep(u, f);
  };
  assert.equal(discard({}, 1400), 'discard', 'off: g356 on the loop B reaches 0');
  assert.equal(discard({ sourcedBDrainOrder: true }, 1400), null, 'on: not yet');
  assert.equal(discard({ sourcedBDrainOrder: true }, 1401), 'discard', 'on: a loop later');
}

// The hall pin after the latch reset: on the one-second loop that clears the latch, g848 no longer pins.
{
  const SOURCED = { sourcedDropLightOrder: true, sourcedFoxyChain: true, sourcedSecondPass: true, sourcedSheetOrder: true,
                    sourcedHallLatchOrder: true, frameMs: () => 50 / 3, frameValue5: () => 1 };
  const lastPin = (opts) => {
    const s = new Sim({ ...QUIET, ...SOURCED, stalledEnabled: true, ...opts });
    for (const k of Object.keys(s.ai)) s.ai[k] = 0;
    const u = s.units.find(x => x.id === 'withfreddy');
    u.idx = u.path.indexOf('blindB');
    for (let i = 0; i < 20; i += 1) s.tick();
    s.lightHeld = true;
    for (let i = 0; i < 10; i += 1) s.tick();
    s.lightHeld = false;
    let reset = -1;
    for (let i = 0; i < 90 && reset < 0; i += 1) { s.tick(); if (s.secTick) reset = s.frame; }
    return { reset, until: u.stunUntil };
  };
  const off = lastPin({});
  const on = lastPin({ sourcedBDrainOrder: true });
  assert.equal(off.until, off.reset + 40, 'off: tickLight pins again on the reset loop, before the deferred reset');
  assert.equal(on.until, on.reset - 1 + 40, 'on: the last pin is the loop before g488 clears the latch');
}

// Off leaves the default unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ sourcedBDrainOrder: false }), 'off equals the default');
}

console.log('B drain order: promotions read value 1 before g361-g371 drain it, and the hall pin follows g488/g489; off unchanged');
