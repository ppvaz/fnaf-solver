// sourcedOfficeRolls: a passed roll at 122 waits at value 0 = 1 until g344-g360 promote it, re-tested every loop (Mangle's
// g358 holds on the hall latch); Balloon Boy is rolled at 122 too (g359, g702), and his value 0 = 2 left there makes g413
// move him on to CAM 07 on the loop g292/g294 send him to CAM 10.
import assert from 'node:assert/strict';
import { Sim } from '../src/mechanics/plant-model.js';

const SOURCED = { sourcedSecondPass: true, sourcedSheetOrder: true, sourcedRollDraws: true, sourcedFootstepDraws: true,
                  sourcedFootstepValue2: true, footstepCamMarkers: true, sourcedOfficeFootsteps: true,
                  sourcedPromotedMoves: true, sourcedRollsBeforeMoves: true, sourcedRoutePass: true };
const QUIET = { night: 7, seed: 5, lethal: false, gfEnabled: false, boxEnabled: false, foxyEnabled: false };

assert.throws(() => new Sim({ ...QUIET, sourcedOfficeRolls: true }), /requires sourcedOfficeFootsteps and sourcedRoutePass/);

const footsteps = (s, before) => s.events.slice(before).filter(e => e.type === 'footstep').map(e => e.data.who);

// Mangle at 122, monitor down, the hall latch set when her roll passes; the latch clears the loop after.
{
  const run = (opts) => {
    const s = new Sim({ ...QUIET, bbEnabled: false, ...SOURCED, ...opts });
    for (const k of Object.keys(s.ai)) s.ai[k] = 0;
    s.ai.mangle = 20;
    const u = s.units.find(x => x.id === 'mangle');
    u.idx = u.path.length - 1; u.atOpening = true; u.stunUntil = -1;
    s.lightLogicalUntil = Number.MAX_SAFE_INTEGER;
    s.rollAllFiveSecond();
    s.routePass(s.frame);
    let before = s.events.length;
    s.footstepDraws();
    const onRoll = footsteps(s, before);
    s.lightLogicalUntil = -1;                  // g488
    s.frame += 1;
    s.routePass(s.frame);
    before = s.events.length;
    s.footstepDraws();
    return { onRoll, next: footsteps(s, before), promoted: u.promoted };
  };
  const off = run({});
  assert.deepEqual([off.onRoll, off.next, off.promoted], [[], [], false], 'off: the latched roll is never promoted');
  const on = run({ sourcedOfficeRolls: true });
  assert.deepEqual([on.onRoll, on.next, on.promoted], [[], ['mangle'], true], 'on: g358 promotes her the loop the latch reads 0, and g703 draws');
}

// Balloon Boy at 122: g359 promotes him, g702 draws, and a leave then hops him on to CAM 07 on the same loop.
{
  const run = (opts) => {
    const s = new Sim({ ...QUIET, ...SOURCED, stalledEnabled: false, ...opts });
    for (const k of Object.keys(s.ai)) s.ai[k] = 0;
    s.ai.bb = 20;
    s.bb.stage = 4; s.bb.inOpening = true;
    s.rollAllFiveSecond();
    const before = s.events.length;
    s.footstepDraws();
    const drew = footsteps(s, before);
    s.bbLeave();                                // g292/g294
    return { drew, stage: s.bb.stage };
  };
  const off = run({});
  assert.deepEqual([off.drew, off.stage], [[], 0], 'off: no footstep, and the leave lands on CAM 10');
  const on = run({ sourcedOfficeRolls: true });
  assert.deepEqual([on.drew, on.stage], [['bb'], 1], 'on: g702 draws at 122, and g413 takes him on to CAM 07');
}

// Off leaves the default unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ sourcedOfficeRolls: false }), 'off equals the default');
}

console.log('office rolls: a roll at 122 waits for its promotion, Balloon Boy is rolled and drawn there, and his stale promotion hops him on; off unchanged');
