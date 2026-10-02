// sourcedFootstepValue2 (default off): the footstep cue as dump g695-g703 test it for the route units --
// the first loop of (value 2 > 0 AND on a `hear footsteps` marker), value 2 = 10 at promotion (g344-g358,
// again on every passed roll while the move waits) and drained by global 5 per loop (g458-g466).
// docs/evidence/footstep-cam-markers-adjudication-20260927.json
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.ts';
import type { Unit } from '../src/games/fnaf2/plant-model.ts';
import type { SimOptions } from '../src/games/fnaf2/plant-options.ts';

const BASE = { night: 7, seed: 111, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
               boxEnabled: false, foxyEnabled: false, sourcedSecondPass: true, sourcedSheetOrder: true,
               sourcedFootstepDraws: true, sourcedFootstepValue2: true };
const script = (s: Sim) => { const log: Array<[number, string]> = []; s.rng.int = (a, b) => { log.push([s.frame, `${a},${b}`]); return a; }; s.rng.chance = () => false; return log; };
const draws = (log: Array<[number, string]>) => log.filter(([, k]) => k === '0,4').map(([f]) => f);
const ticks = (s: Sim, n: number) => { for (let i = 0; i < n; i += 1) s.tick(); };

assert.throws(() => new Sim({ night: 7, sourcedSecondPass: true, sourcedSheetOrder: true, sourcedFootstepValue2: true }),
  /requires sourcedFootstepDraws/);

// A hop in its promotion loop draws, as the per-hop rule did: Withered Bonnie CAM 07 -> hall stage 1.
{
  const s = new Sim(BASE); s.frame = 1000;
  const u = s.units.find(x => x.id === 'withbonnie') as Unit; u.idx = u.path.indexOf(7);   // one of the seven route units
  const log = script(s);
  s.footstepPromote(u, true); s.advanceUnit(u); s.tick();
  assert.equal(u.path[u.idx], 'blindA');
  assert.deepEqual(draws(log), [1001], 'one Random(5) on the promotion loop');
  ticks(s, 30);
  assert.deepEqual(draws(log), [1001], 'none while standing there');
}

// Value 2 is 9 at the promotion loop's test and falls one per loop: a hop eight loops later still draws,
// nine loops later it is silent.
for (const [late, want] of [[8, [1009]], [9, []]] as const) {
  const s = new Sim(BASE); s.frame = 1000;
  const u = s.units.find(x => x.id === 'withbonnie') as Unit; u.idx = u.path.indexOf(7);   // one of the seven route units
  const log = script(s);
  s.footstepPromote(u, true); ticks(s, late);          // promotion loop 1001, CAM 07 is no marker
  s.advanceUnit(u); s.tick();                             // the hop lands on loop 1001 + late
  assert.equal(u.path[u.idx], 'blindA');
  assert.deepEqual(draws(log), want, `hop ${late} loops after its promotion`);
}

// Global 5 drains it: at 4 per loop (a long frame under the frame-time hook) the window is three loops.
{
  const s = new Sim({ ...BASE, frameMs: () => 4 * 50 / 3, frameValue5: () => 4 }); s.frame = 1000;
  const u = s.units.find(x => x.id === 'withbonnie') as Unit; u.idx = u.path.indexOf(7);   // one of the seven route units
  const log = script(s);
  s.footstepPromote(u, true); ticks(s, 2); s.advanceUnit(u); s.tick();
  assert.deepEqual(draws(log), [], '10 - 4 - 4 - 4 < 0: silent two loops after');
}

// A unit promoted while it stands on a marker draws where it stands, once; a passed roll promotes the
// waiting move again and draws again. Withered Freddy on hall stage 2, monitor down (g379 waits).
{
  const s = new Sim({ ...BASE, stalledEnabled: true, sourcedRouteForks: true }); s.frame = 1000;
  const u = s.units.find(x => x.id === 'withfreddy') as Unit; u.idx = u.path.indexOf('blindB'); u.pending = true;   // one of the seven route units
  const log = script(s);
  s.footstepPromote(u, true); ticks(s, 20);
  assert.equal(u.path[u.idx], 'blindB', 'the office hop waits for the cameras');
  assert.deepEqual(draws(log), [1001], 'one draw at the promotion, standing on hall stage 2');
  s.footstepPromote(u, true); s.tick();
  assert.deepEqual(draws(log), [1001, 1021], 'the next passed roll draws again');
}

// g378's return onto CAM 03 (footstepCamMarkers): in its promotion loop it draws on CAM 03; promoted
// twelve loops before the mask came on, value 2 is spent and the return is silent.
for (const [maskFirst, marks, want] of [[true, true, [1001]], [true, false, []], [false, true, [1001]]] as const) {
  const s = new Sim({ ...BASE, stalledEnabled: true, sourcedRouteForks: true, footstepCamMarkers: marks }); s.frame = 1000;
  const u = s.units.find(x => x.id === 'withfreddy') as Unit; u.idx = u.path.indexOf('blindB'); u.pending = true;   // one of the seven route units
  const log = script(s);
  if (maskFirst) { s.maskOn = true; s.maskAnim = 0; }
  s.footstepPromote(u, true);
  if (!maskFirst) { ticks(s, 12); s.maskOn = true; s.maskAnim = 0; }
  s.tick();
  assert.equal(u.path[u.idx], 3, 'g378 returned him to CAM 03');
  // mask first: promoted and returned on loop 1001, so the test sees CAM 03 (a marker only with the knob).
  // mask later: the one draw is the standing one on hall stage 2 at loop 1001; the return is silent.
  assert.deepEqual(draws(log), want, `mask ${maskFirst ? 'on at' : 'on 12 loops after'} the promotion, cam markers ${marks}`);
}

// Off: the per-hop rule, unchanged.
{
  const run = (opts: Partial<SimOptions>) => { const x = new Sim({ night: 7, seed: 11, lethal: false, sourcedSecondPass: true, sourcedSheetOrder: true,
    sourcedFootstepDraws: true, footstepCamMarkers: true, ...opts }); for (let i = 0; i < 7200; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  assert.equal(new Sim({ night: 7, seed: 1 }).opts.sourcedFootstepValue2, false, 'default off');
  assert.equal(run({}), run({ sourcedFootstepValue2: false }), 'explicit off equals the default');
  assert.notEqual(run({ sourcedFootstepValue2: true }), '', 'on runs a night');
}
console.log('footstep value 2: draws on the rising edge of value 2 > 0 on a marker; a hop 9+ loops after promotion is silent; standing promotions draw; off unchanged');
