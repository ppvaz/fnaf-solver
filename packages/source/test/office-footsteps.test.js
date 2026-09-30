// sourcedOfficeFootsteps: `in office` (122) overlaps `hear footsteps` for the bottom/centre-hotspot sprites (W. Bonnie,
// Toy Bonnie and Mangle among the route units). g333-g343 roll a unit wherever it stands, so a passed roll at 122 is
// promoted (value 2 = 10) and g696/g700/g703 draw its footstep there; an arrival inside value 2's window draws too.
// Off: a unit at 122 is not promoted by its roll, and 122 is no footstep marker (Night 7 k3's replay, tick 2100).
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';

const SOURCED = { sourcedSecondPass: true, sourcedSheetOrder: true, sourcedRollDraws: true, sourcedFootstepDraws: true,
                  sourcedFootstepValue2: true, footstepCamMarkers: true };
const QUIET = { night: 7, seed: 5, lethal: false, bbEnabled: false, gfEnabled: false, boxEnabled: false, foxyEnabled: false };

assert.throws(() => new Sim({ ...QUIET, sourcedOfficeFootsteps: true }), /requires sourcedFootstepValue2 and sourcedRollDraws/);

/** `id` standing at its opening (122); its roll passes; the footstep draws of the loop that follows. */
const rollAt122 = (opts, id) => {
  const s = new Sim({ ...QUIET, ...SOURCED, ...opts });
  for (const k of Object.keys(s.ai)) s.ai[k] = 0;
  s.ai[id] = 20;
  const u = s.units.find(x => x.id === id);
  u.idx = u.path.length - 1; u.atOpening = true; u.stunUntil = -1;
  s.rollAllFiveSecond();
  const value2 = u.value2;                   // g344-g358 write 10; g458-g466 drain it before g695
  const before = s.events.length;
  s.footstepDraws();
  return { value2, footsteps: s.events.slice(before).filter(e => e.type === 'footstep').map(e => e.data.who), node: u.path[u.idx] };
};

{
  const off = rollAt122({}, 'withbonnie');
  assert.deepEqual([off.value2, off.footsteps], [0, []], 'off: no promotion and no footstep at 122');
  const on = rollAt122({ sourcedOfficeFootsteps: true }, 'withbonnie');
  assert.equal(on.value2, 10, 'on: g346 promotes her where she stands');
  assert.deepEqual(on.footsteps, ['withbonnie'], 'on: g696 draws at `in office`');
  assert.equal(on.node, 'ventL', 'on: no move group leaves 122');
  const chica = rollAt122({ sourcedOfficeFootsteps: true }, 'withchica');
  assert.deepEqual([chica.value2, chica.footsteps], [10, []], 'on: W. Chica is promoted, but her sprite on 122 misses the marker');
}

// An arrival at 122 while value 2 is still above 0 draws; the draw is once per continuous overlap (NotAlways).
{
  const arrive = (opts) => {
    const s = new Sim({ ...QUIET, ...SOURCED, ...opts });
    const u = s.units.find(x => x.id === 'toybonnie');
    u.idx = u.path.length - 2; u.value2 = 5; u.promoted = true;
    s.footstepDraws();                        // on CAM 06: no marker
    u.idx += 1; u.atOpening = true;           // g428 into the vent
    const before = s.events.length;
    s.footstepDraws(); s.footstepDraws();
    return s.events.slice(before).filter(e => e.type === 'footstep').length;
  };
  assert.equal(arrive({}), 0, 'off: no footstep at the vent');
  assert.equal(arrive({ sourcedOfficeFootsteps: true }), 1, 'on: one footstep on arrival, not one per loop');
}

// Off leaves the default unchanged.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(run({}), run({ sourcedOfficeFootsteps: false }), 'off equals the default');
}

console.log('office footsteps: rolls promote at 122, and W. Bonnie, Toy Bonnie and Mangle draw g696/g700/g703 there; off unchanged');
