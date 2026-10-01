// Plan 16 package 1/3 gates: snapshot/restore fidelity, the semantic action
// layer's clone, and the harness reproducing the 803feb3 ladder on a zero
// perturbation.
import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { cloneSim, view, ACTIONS, run } from './sim.ts';
import { searchParams, baselineLadder, evalParams, SHIPPED_GEOM } from './paramsearch.ts';
import { enumeratePackage4 } from './constrainedsearch.ts';
import { makeSearchKnobs } from './hid-device-pilot.ts';
import { build, devicePlan, idleUntilMs, replay } from '../../bin/plans/recipe.ts';
import { modelGate } from '../../bin/plans/human-gate.ts';

let fails = 0;
const ok = (name, cond) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails++; };

// Search inputs are values owned by one run, never a mutable module singleton.
const frozenKnobs = makeSearchKnobs({ attackBangGateMs: 1 });
ok('search knob assignments are frozen and reject unknown keys', Object.isFrozen(frozenKnobs));
try { makeSearchKnobs({ madeUpKnob: 1 }); ok('unknown search knob is refused', false); }
catch { ok('unknown search knob is refused', true); }

// --- snapshot/restore: bit-identical continuation from an arbitrary frame
{
  let mismatch = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const night = (seed % 7) + 1;
    const a = new Sim({ seed, night });
    const N = 2000 + (seed * 131) % 9000;
    for (let i = 0; i < N && a.alive && !a.won; i++) a.tick();
    const b = Sim.fromSnapshot({ seed, night }, a.snapshot());
    while (a.alive && !a.won) a.tick();
    while (b.alive && !b.won) b.tick();
    if (JSON.stringify([a.won, a.frame, a.death]) !== JSON.stringify([b.won, b.frame, b.death])) mismatch++;
  }
  ok('snapshot/restore: 60/60 bit-identical continuation', mismatch === 0);
}

// --- Package 4 enumeration is finite, constrained, and has one baseline.
{
  const candidates = enumeratePackage4();
  const baseline = candidates.filter(c => Object.values(c.params).every(v => v === 0));
  const invalidPulse = candidates.filter(c => c.params.preReadHallMs > 0 && c.params.openGfFlick !== 1);
  const invalidAge = candidates.filter(c => c.params.preReadHallMs === 0 && c.params.bangAgeFrames !== 0);
  ok('pkg-4 enumerator omits its duplicate baseline', baseline.length === 0);
  ok('pkg-4 in-read resets always include GF suppression', invalidPulse.length === 0);
  ok('pkg-4 bang-age state only controls an in-read reset', invalidAge.length === 0);
  const conditional = evalParams({ preReadHallMs: 500, openGfFlick: 1,
    bangAgeFrames: 37 }, [7], 1, 'correlated');
  ok('pkg-4 conditional read replays through modelGate', conditional.ok &&
    conditional.nights[7].runs === 1);
}

// --- cloneSim (the search branch primitive) agrees with a fresh run
{
  const s = new Sim({ seed: 7, night: 7 });
  for (let i = 0; i < 900; i++) s.tick();
  const c = cloneSim(s);
  for (let i = 0; i < 1200; i++) { s.tick(); c.tick(); }
  ok('cloneSim: 1200-tick continuation identical', JSON.stringify(s) === JSON.stringify(c));
}

// --- every semantic action compiles and runs without throwing
{
  let threw = null;
  for (const key of Object.keys(ACTIONS)) {
    try {
      const sim = new Sim({ seed: 3, night: 6 });
      for (let i = 0; i < 400; i++) sim.tick();
      run(sim, ACTIONS[key](view(sim)));
    } catch (e) { threw = `${key}: ${e.message}`; }
  }
  ok(`all ${Object.keys(ACTIONS).length} semantic actions run` + (threw ? ` (${threw})` : ''), !threw);
}

// --- Package 3 gate: a zero-perturbation search reproduces the 803feb3 ladder
//     within binomial noise, and its frontier is the single unmodified point.
{
  const RUNS = 160;
  const baseline = { 2: 66.3, 5: 62.0, 7: 26.0 };
  const lad = baselineLadder([2, 5, 7], RUNS, 'iid');
  let within = true;
  for (const n of [2, 5, 7]) {
    const se = 100 * Math.sqrt(0.25 / RUNS);         // conservative binomial SE
    if (Math.abs(lad[n] - baseline[n]) > 4.5 * se) within = false;
  }
  ok(`harness reproduces 803feb3 ladder within noise (n2 ${lad[2]} n5 ${lad[5]} n7 ${lad[7]})`, within);

  const frontier = searchParams({ nights: [6], runs: RUNS, beam: 1, rounds: 0, shape: 'iid' });
  ok('zero-perturbation search frontier is the single unmodified point',
    frontier.length === 1 && Object.keys(frontier[0].params).every(k => frontier[0].params[k] === 0));
}

// --- the sweep-geometry axis: a fixed geom threads through evalParams, and the
//     shipped geom is inert (identical to omitting it).
{
  const base = evalParams({}, [6], 120, 'iid', 1, SHIPPED_GEOM);
  const omit = evalParams({}, [6], 120, 'iid');
  ok('SHIPPED_GEOM is inert (== omitting geom)', base.nights[6].pct === omit.nights[6].pct);

  // A tight LIGHT_AFTER geometry must (a) still build and replay, (b) actually
  // change the outcome -- if it did not, the axis would be doing nothing.
  const tight = evalParams({}, [6], 200, 'correlated', 1,
    { sweepSlotMs: 46, deviceSpacingMs: 54, sweepContactMs: 25 });
  ok('a LIGHT_AFTER geom builds + replays through evalParams',
    tight.ok && tight.nights[6].runs === 200);
  const shippedC = evalParams({}, [6], 200, 'correlated', 1, SHIPPED_GEOM);
  ok(`the geometry axis moves n6 (tight ${tight.nights[6].pct} vs shipped ${shippedC.nights[6].pct})`,
    Math.abs(tight.nights[6].pct - shippedC.nights[6].pct) > 3);
}

// --- item 10 (attackBangGateMs): the bang-anchored attack-raise. This is a
//     RECORDED NEGATIVE (plan 16 pkg 4), and the shape of the negative is the
//     point: fire the attack cycle's mask-off/reset/raise the instant a BB
//     departure bang is heard, and it clears every story night ~90% -- but
//     ONLY with a perfect instant bang oracle. At any realistic detection
//     latency the recovery sweep (pinned to the cycle end) drags late and toy
//     coverage collapses below the blind baseline. Default-off; this pins both
//     halves so the search cannot rediscover the lat=0 number as a win.
{
  const pt = (night, knobs) => {
    const r = build({ night, knobs });
    const p = devicePlan(r, {});
    let t = `#night ${r.night}\n#idle-until ${idleUntilMs(r.night)}\n`;
    for (const [n, l] of Object.entries(p)) t += `#cycle ${n} ${r.cycles[n].lengthMs}\n${(l as any).join('\n')}\n`;
    return t;
  };
  const RUNS = 300;
  const gate6 = (latMs, knobs?) => modelGate(pt(6, knobs), {
    night: 6, runs: RUNS, slackMs: 60, shape: 'correlated',
    replayFn: (plan, o) => replay(plan, { ...o, bangLatencyMs: latMs }),
  }).survived;

  const blind = gate6(0);
  let text0, oracle, laggy;
  const gatedKnobs = makeSearchKnobs({ attackBangGateMs: 1 });
  text0 = pt(6, gatedKnobs);
  oracle = gate6(0, gatedKnobs);      // perfect instant oracle
  laggy = gate6(150, gatedKnobs);     // a realistic device bang-detection latency

  ok('item 10: the knob folds the recovery sweep into the maskraise row',
    /maskraise \d+ hall \d+ bang 1 \d+ \d+ \d+ [\d,]+ \d+/.test(text0));
  ok(`item 10 at a perfect instant oracle is a large win (n6 ${oracle}/${RUNS} vs blind ${blind}/${RUNS})`,
    oracle > blind + RUNS * 0.15);
  ok(`item 10 at 150 ms bang latency is worse than blind (n6 ${laggy}/${RUNS} vs blind ${blind}/${RUNS}) -- the win needs an oracle the phone has not got`,
    laggy < blind);
}

// --- plan 16 pkg 5 (n7probe): a perfect opening Foxy reset does not move
//     Night 7 -- the opener premise is refuted, n7 is a steady-state problem.
{
  const pt7 = () => {
    const r = build({ night: 7 });
    const p = devicePlan(r, {});
    let t = `#night 7\n#idle-until ${idleUntilMs(7)}\n`;
    for (const [n, l] of Object.entries(p)) t += `#cycle ${n} ${r.cycles[n].lengthMs}\n${(l as any).join('\n')}\n`;
    return t;
  };
  const RUNS = 250;
  const g = (opts?) => modelGate(pt7(), { night: 7, runs: RUNS, slackMs: 60, shape: 'correlated', ...opts }).survived;
  const base = g();

  const dormantDesc = Object.getOwnPropertyDescriptor(Sim.prototype, 'foxyDormant');
  let opener;
  Object.defineProperty(Sim.prototype, 'foxyDormant', {
    configurable: true,
    get() { return this.opts.night === 7 ? this.frame < 20 * C.FPS : dormantDesc.get.call(this); },
  });
  try { opener = g(); } finally { Object.defineProperty(Sim.prototype, 'foxyDormant', dormantDesc); }

  ok(`pkg 5: a perfect opening Foxy reset does not move n7 (opener ${opener}/${RUNS} vs base ${base}/${RUNS}) -- refuted`,
    Math.abs(opener - base) <= RUNS * 0.08);
}

console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
