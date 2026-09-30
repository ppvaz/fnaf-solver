// Sheet order for the hand-placed draws under sourcedSheetOrder (dump g213-g518 before the resolution, g556-g781 after tickBox).
import assert from 'node:assert/strict';
import { Sim } from '../src/games/fnaf2/plant-model.js';
import * as C from '../src/games/fnaf2/config.js';

const QUIET = { night: 7, seed: 81, lethal: false, stalledEnabled: false, bbEnabled: false, gfEnabled: false,
                boxEnabled: false, foxyEnabled: false };
const ALL = { sourcedSecondPass: true, sourcedViewDraws: true, sourcedPuppetGlitchDraws: true };

// Scripted rng.int: logs each (min,max) with its frame.
const script = (s, values) => {
  const log = [];
  s.rng.int = (a, b) => { const k = `${a},${b}`; log.push([s.frame, k]); return values[k] ?? a; };
  s.rng.chance = () => { log.push([s.frame, 'chance']); return false; };
  return log;
};

assert.throws(() => new Sim({ ...QUIET, sourcedSheetOrder: true }), /requires sourcedSecondPass/);

// One frame with g497, g498, a g500 hit (so g500-g502 and g505 draw) and g744: sheet order vs the default placement.
const frameKeys = sheetOrder => {
  const s = new Sim({ ...QUIET, ...ALL, sourcedSheetOrder: sheetOrder });
  s.frame = 1019; s.ai.golden = 0; s.box = 99;
  s.puppet.out = true; s.puppet.loc = 3;
  s.monitor = 'up'; s.monAnim = 0; s.viewing = 3; s.cam = 3;
  s.glitch.value5 = 1; s.puppetStaticTimer = 50;
  const log = script(s, { '0,49': 1 });
  s.tick();
  const keep = new Set(['1,2', '0,99', '0,49', '0,149', '0,1']);
  return log.filter(([f, k]) => f === 1020 && keep.has(k)).map(([, k]) => k);
};
assert.deepEqual(frameKeys(true), ['1,2', '0,99', '0,49', '0,49', '0,49', '0,149', '0,1'],
  'g497, g498, g500-g502, g505, g744');
assert.deepEqual(frameKeys(false), ['0,99', '0,49', '0,49', '0,49', '0,149', '1,2', '0,1'],
  'the default placement runs the view and glitch draws ahead of the whole pass');

// The Toy Bonnie waiting draw (g366) lands between g294 and g400; the fades (g468-g476) after g440.
{
  const s = new Sim({ ...QUIET, ...ALL, sourcedSheetOrder: true });
  s.frame = 1000; s.ai.golden = 0; s.box = 99;
  const calls = [];
  const dv = s.drawViewed.bind(s), pe = s.puppetGlitchEarly.bind(s), bf = s.blackoutFlicker.bind(s);
  s.drawViewed = (f, part) => { calls.push(part); return dv(f, part); };
  s.puppetGlitchEarly = () => { calls.push('g500'); return pe(); };
  s.blackoutFlicker = f => { calls.push('g517'); return bf(f); };
  s.tick();
  assert.deepEqual(calls, ['g366', 'g368', 'g419', 'fades', 'g498', 'g500', 'g517']);
}

// The late part: the hour table before g744, and g774 after it.
const hourOrder = sheetOrder => {
  const s = new Sim({ ...QUIET, ...ALL, sourcedRouteForks: true, sourcedSheetOrder: sheetOrder });
  s.frame = C.HOUR_FRAMES - 1;
  const calls = [];
  const h = s.applyAiHour.bind(s), r = s.rollDecidePath.bind(s), g = s.puppetGlitchLate.bind(s);
  s.applyAiHour = n => { calls.push('hour'); return h(n); };
  s.rollDecidePath = () => { calls.push('g744'); return r(); };
  s.puppetGlitchLate = () => { calls.push('g774'); return g(); };
  s.tick();
  return calls;
};
assert.equal(C.HOUR_FRAMES % C.FPS, 0);
assert.deepEqual(hourOrder(true), ['hour', 'g744', 'g774']);
assert.deepEqual(hourOrder(false), ['g744', 'hour', 'g774']);

// Off: the default is unchanged, and the pass without sheet order is unchanged by the split.
{
  const run = opts => { const x = new Sim({ night: 7, seed: 11, lethal: false, ...opts }); for (let i = 0; i < 3600; i++) x.tick(); return JSON.stringify([x.events, x.rng.state]); };
  if (new Sim({ night: 7, seed: 1 }).opts.sourcedSheetOrder === false)
    assert.equal(run({}), run({ sourcedSheetOrder: false }), 'explicit off equals the default');
}
console.log('sheet order: requires the pass; g497, g498, g500-g505, g744 in sheet order; view parts g366/g368/g419/fades/g498 then g500 and g517; hour table before g744; off unchanged');
