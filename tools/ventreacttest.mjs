// The vent-threat reactive layer, gated as a policy. Plan 19 follow-on to
// package 1 (2026-08-30 directive: reactive handling is the top priority).
//
//   node tools/ventreacttest.mjs            # all checks
//   node tools/ventreacttest.mjs --assert   # exit 1 on any failure (suite mode)
//
// What is gated, and why: the Minus Toys scheduled mask window is nominally
// ~4.8 s of the 10 s cycle, but the post-animation/full-off endpoints and phase
// decide whether it crosses four or five of Balloon Boy's CONSECUTIVE ticks.
// VentThreatReactive pre-empts the cycle on the left-opening fact and holds the
// mask the extra tick, then hands back. The threat is real, not injected: BB is
// live at AI 3 on the story Night 2 table from 1 AM (g676). Mangle occupancy is
// intentionally not claimed until Observer has a separately calibrated fact.
import { pathToFileURL } from 'node:url';
import * as C from '@sixam/core/mechanics';
import { Rng } from '@sixam/core/mechanics';
import { Observer } from '@sixam/core/sensing';
import { VentThreatReactive } from '@sixam/core/control';
import { replay, KNOBS0, ENGINE_PHASE_ORACLE } from './device/minus-toys-plan.mjs';
import { evalEnsemble } from './device/minus-toys-jitter.mjs';
import { formatRate } from './stat.mjs';

let failures = 0, knownNegatives = 0;
const assertMode = process.argv.includes('--assert');
const ok = (group, what, cond) => {
  if (!cond) { failures++; console.error(`FAIL  ${group}: ${what}`); }
  else console.log(`ok    ${group}: ${what}`);
};
// Reports remain useful without --assert, but a release-style run must fail
// when one of the policy claims regresses. The previous helper returned true
// unconditionally, so --assert was only a formatting flag.
const KNOWN_NEGATIVE = (group, what, why) => {
  knownNegatives++;
  if (assertMode) {
    failures++;
    console.error(`FAIL  ${group}: ${what} -- ${why}`);
  } else {
    console.error(`KNOWN-NEGATIVE (${knownNegatives}) ${group}: ${what} -- ${why}`);
  }
};
const policyGate = (group, what, condition, why) => {
  if (condition) ok(group, what, true);
  else KNOWN_NEGATIVE(group, what, why);
};
const O = (v) => ({ state: 'OBSERVED', value: v });
const U = (r) => ({ state: 'UNKNOWN', reason: r });

// --- 1. controller unit: detection -> drop -> flash -> mask -> hold -> verify
{
  const c = new VentThreatReactive({ phaseClock: ENGINE_PHASE_ORACLE });

  // monitor down, mask off, threat: the pre-mask hall pulse comes FIRST
  // (Pedro: "do one quick extra flash of the hall before masking").
  let d = c.decide({ leftOpening: O('threat'), maskOn: O(false), monitorUp: O(false) },
                   { frame: 10, scheduled: [] });
  ok('unit', 'threat, mask off, cams down -> hall pulse first',
    d.length === 1 && d[0].action === 'hall' && c.state === 'securing' && c.flashed);

  d = c.decide({ leftOpening: O('threat'), maskOn: O(false), monitorUp: O(false) },
               { frame: 11, scheduled: [] });
  ok('unit', 'then the mask press, anchored at fully-on',
    d.length === 1 && d[0].action === 'mask' && c.since === 11 + C.MASK_ANIM_ON);

  d = c.decide({ leftOpening: U('opening-not-in-view'), maskOn: O(true), monitorUp: O(false) },
               { frame: 13, scheduled: [] });
  ok('unit', 'mask confirmed -> holding', d.length === 0 && c.state === 'holding');

  d = c.decide({ leftOpening: U('x'), maskOn: O(true), monitorUp: O(false) },
               { frame: 40, scheduled: [] });
  ok('unit', 'holding before the ticks elapse -> keep holding',
    d.length === 0 && c.state === 'holding');

  // 5 ticks counted from fully-on, but the drop is PHASE-ALIGNED: release
  // right behind the fifth one-second boundary at or after fully-on. The
  // stored deadline is already the FINAL fifth-tick deadline.
  const since = 11 + C.MASK_ANIM_ON;
  const firstTick = since + ((C.FPS - (since % C.FPS)) % C.FPS);
  const dropAt = firstTick + (C.VENT_MASK_TICKS - 1) * C.FPS + 2;
  d = c.decide({ leftOpening: U('x'), maskOn: O(true), monitorUp: O(false) },
               { frame: dropAt - 1, scheduled: [] });
  ok('unit', 'does not release before the stored fifth-tick deadline',
    d.length === 0 && c.state === 'holding');
  d = c.decide({ leftOpening: U('x'), maskOn: O(true), monitorUp: O(false) },
               { frame: dropAt, scheduled: [] });
  ok('unit', 'fifth tick boundary crossed -> drop and verify',
    d.length === 1 && d[0].action === 'mask' && c.state === 'verifying');

  d = c.decide({ leftOpening: O('empty'), maskOn: O(false), monitorUp: O(false) },
               { frame: dropAt + 60, scheduled: [] });
  ok('unit', 'verified empty, monitor never ours -> straight to idle',
    d.length === 0 && c.state === 'idle');

  // the common Night 2 case: detection lands INSIDE the scheduled mask phase.
  const c3 = new VentThreatReactive({ phaseClock: ENGINE_PHASE_ORACLE });
  let e = c3.decide({ leftOpening: O('threat'), maskOn: O(true), monitorUp: O(false) },
                    { frame: 100, scheduled: [] });
  ok('unit', 'threat with the scheduled mask on -> drop it to make room for the pulse',
    e.length === 1 && e[0].action === 'mask' && c3.state === 'securing');
  e = c3.decide({ leftOpening: U('x'), maskOn: O(false), monitorUp: O(false) },
                { frame: 160, scheduled: [] });
  ok('unit', 'mask dropped -> hall pulse', e.length === 1 && e[0].action === 'hall');
  e = c3.decide({ leftOpening: U('x'), maskOn: O(false), monitorUp: O(false) },
                { frame: 161, scheduled: [] });
  ok('unit', 'then re-mask, ticks restart from the re-mask (g293)',
    e.length === 1 && e[0].action === 'mask' && c3.since === 161 + C.MASK_ANIM_ON);

  // a masked hold that receives a scheduled-mask collision risk: guard is
  // inherited (guardIntents), covered by the P1 tests; here pin the restart:
  const c2 = new VentThreatReactive({ phaseClock: ENGINE_PHASE_ORACLE });
  c2.state = 'verifying'; c2.since = 100; c2.loweredMonitor = true;
  c2.decide({ leftOpening: O('threat'), maskOn: O(false), monitorUp: O(false) },
            { frame: 200, scheduled: [] });
  ok('unit', 'threat during verify -> restart at securing', c2.state === 'securing');

  // coverage decision, three ways (lo/hi boundary range vs the five ticks):
  // oracle-phase covered -> stand down and spend nothing.
  const cg = new VentThreatReactive({ maskWindowFrames: 288, phaseUncertaintyFrames: 0,
                                      phaseClock: ENGINE_PHASE_ORACLE });
  let g = cg.decide({ leftOpening: O('threat'), maskOn: O(true), monitorUp: O(false),
                      bbVent: O(false) }, { frame: 120, scheduled: [],
                                            phaseClock: ENGINE_PHASE_ORACLE }); // [120,408]: 5
  ok('unit', 'aligned mask window (5 boundaries ahead) -> covered, spend nothing',
    g.length === 0 && cg.state === 'covered');
  // +-6 frames of phase uncertainty makes the same window ambiguous: the
  // decision latches to the BOUNDED EXTENSION (hold the current mask until
  // the fifth boundary is guaranteed), not the full rescue.
  const ca = new VentThreatReactive({ maskWindowFrames: 288, phaseUncertaintyFrames: 6,
                                      phaseClock: ENGINE_PHASE_ORACLE });
  g = ca.decide({ leftOpening: O('threat'), maskOn: O(true), monitorUp: O(false),
                  bbVent: O(false) }, { frame: 120, scheduled: [],
                                        phaseClock: ENGINE_PHASE_ORACLE });
  ok('unit', 'ambiguous coverage -> bounded extension of the current mask',
    g.length === 0 && ca.state === 'holding' && ca.firstTick === ca.guaranteedFifthTick());
  // a short window that cannot hold five boundaries even at the best phase:
  // intervene with the full rescue (drop -> flash -> mask).
  const cu = new VentThreatReactive({ maskWindowFrames: 220, phaseUncertaintyFrames: 0,
                                      phaseClock: ENGINE_PHASE_ORACLE });
  g = cu.decide({ leftOpening: O('threat'), maskOn: O(true), monitorUp: O(false),
                  bbVent: O(false) }, { frame: 120, scheduled: [],
                                        phaseClock: ENGINE_PHASE_ORACLE }); // [120,340]: 4
  ok('unit', 'genuinely uncovered -> intervene (drop the scheduled mask first)',
    g.length === 1 && g[0].action === 'mask' && cu.state === 'securing');

  const late = new VentThreatReactive({ phaseUncertaintyFrames: 0,
                                        phaseClock: ENGINE_PHASE_ORACLE });
  late.decide({ leftOpening: O('threat'), maskOn: O(true), monitorUp: O(false) },
              { frame: 100, scheduled: [],
                maskWindow: { startFrame: 112, endFrame: 348 },
                phaseClock: ENGINE_PHASE_ORACLE });
  ok('unit', 'coverage starts after mask-on animation and ends at the actual off press',
    late.state === 'securing');

  const unknown = new VentThreatReactive({ phaseUncertaintyFrames: 0,
                                            phaseClock: ENGINE_PHASE_ORACLE });
  unknown.maskOnAt = 100;
  unknown.state = 'holding';
  unknown.since = 100;
  unknown.firstTick = 500;
  unknown.decide({ leftOpening: U('x'), maskOn: U('mask-animating'), monitorUp: O(false) },
                 { frame: 200, scheduled: [] });
  ok('unit', 'UNKNOWN mask reads do not erase the mask anchor or toggle it',
    unknown.state === 'holding' && unknown.maskOnAt === 100);

  const cue = new VentThreatReactive({ phaseClock: ENGINE_PHASE_ORACLE });
  const cueObs = { leftOpening: U('opening-not-in-view'), maskOn: O(false),
                   monitorUp: O(false), bbVent: O('opening'), bbVentId: O('visit-1') };
  let cueIntent = cue.decide(cueObs, { frame: 200, scheduled: [] });
  cue.settle(cueIntent);
  cue.state = 'idle';
  cueIntent = cue.decide(cueObs, { frame: 400, scheduled: [] });
  ok('unit', 'one audio visit identity cannot retrigger after the mask drops',
    cueIntent.length === 0 && cue.state === 'idle');
  const anonymousCue = new VentThreatReactive({ phaseClock: ENGINE_PHASE_ORACLE });
  const anonymousObs = { leftOpening: U('opening-not-in-view'), maskOn: O(false),
                        monitorUp: O(false), bbVent: O('opening'), bbVentId: U('no-identity') };
  const anonymousIntent = anonymousCue.decide(anonymousObs, { frame: 200, scheduled: [] });
  ok('unit', 'anonymous audio levels fail closed instead of creating a rescue visit',
    anonymousIntent.length === 0 && anonymousCue.state === 'idle');
}

// --- 2. Night 2 policy A/B: base vs reactive vs noisy ------------------------
const NIGHT = 2;
const numericArg = (name, fallback) => {
  const raw = process.argv.find(arg => arg.startsWith(`--${name}=`));
  if (raw === undefined) return fallback;
  const value = Number(raw.slice(name.length + 3));
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`);
  return value;
};
const SEEDS = Array.from({ length: numericArg('seeds', 300) },
  (_, i) => (i * 2654435761) >>> 0);

const bbInsides = (r) => r.sim.events.filter(e => e.type === 'bb-inside').length;

function rate(knobs) {
  let won = 0, bbIn = 0, bbInRuns = 0;
  const deaths = {};
  for (const seed of SEEDS) {
    const r = replay({ night: NIGHT, seed, knobs });
    if (r.sim.won) won++;
    const n = bbInsides(r);
    bbIn += n; if (n > 0) bbInRuns++;
    if (r.sim.death) deaths[r.sim.death.reason] = (deaths[r.sim.death.reason] || 0) + 1;
  }
  return { won, bbIn, bbInRuns, deaths };
}

const base = rate(KNOBS0);
const clean = rate({ ...KNOBS0, reactiveBB: true });
const noisy = rate({ ...KNOBS0, reactiveBB: true, reactiveDelayFrames: 8, reactiveDropRate: 0.2 });

const fmt = (x) => `${x.won}/${SEEDS.length} won (${formatRate(x.won, SEEDS.length, { label: 'survival' })}), ` +
  `bb-inside runs ${x.bbInRuns}, ` +
  `deaths ${Object.entries(x.deaths).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ') || 'none'}`;

console.log(`\nNight ${NIGHT} story table, ${SEEDS.length} seeds, zero jitter:`);
console.log(`  base             ${fmt(base)}`);
console.log(`  +vent-reactive   ${fmt(clean)}`);
console.log(`  +reactive(noisy) ${fmt(noisy)}`);

policyGate('policy', 'the reactive layer never costs survival at zero jitter',
  clean.won >= base.won,
    'the current policy still pays a monitor-down/box cost when it rescues. ' +
    'The gate stays red until cycle selection and phase estimation price that ' +
    'cost explicitly (plans/20-21).');
policyGate('policy', 'noisy observation stays within 5 points of clean',
  noisy.won >= clean.won - SEEDS.length * 0.05,
    'coverage decisions are anchor-sensitive: an 8-frame delay + 20% drops ' +
    'the mixed delay/drop run is not a phase-only experiment. The gate stays ' +
    'red until the observer error model and the controller cost are separately ' +
    'priced (plans/20-21).');
if (base.bbInRuns > 0)
  ok('policy', 'reactive strictly reduces BB walk-ins when the base has them',
    clean.bbInRuns < base.bbInRuns || (clean.bbInRuns === 0));
else
  console.log('  (no BB walk-ins at zero jitter in the base -- the reactive value ' +
              'is priced under the ensemble below)');

// --- 3. the ensemble: where the BB share actually lives ----------------------
const N_ENS = numericArg('ensemble-seeds', 600);
const ensBase = evalEnsemble({ night: NIGHT, seeds: N_ENS });
const ensReact = evalEnsemble({ night: NIGHT, seeds: N_ENS, knobs: { ...KNOBS0, reactiveBB: true } });
console.log(`\nEnsemble (calibrated clock-error model), ${N_ENS} seeds, night ${NIGHT}:`);
  console.log(`  base             ${ensBase.survived}/${N_ENS} (` +
    `${formatRate(ensBase.survived, N_ENS, { label: 'survival' })})`);
  console.log(`  +vent-reactive   ${ensReact.survived}/${N_ENS} (` +
    `${formatRate(ensReact.survived, N_ENS, { label: 'survival' })})`);
console.log(`  base deaths ${JSON.stringify(ensBase.deaths)}`);
console.log(`  react deaths ${JSON.stringify(ensReact.deaths)}`);

policyGate('ensemble', 'the reactive layer lifts ensemble survival',
  ensReact.survived > ensBase.survived,
    'this ensemble combines epoch, drift, per-action jitter, observation loss, ' +
    'and controller rescue cost; it cannot isolate sustained phase error. The ' +
    'gate stays red pending the estimator/control decomposition (plans/20-21).');

if (assertMode && failures) process.exit(1);
console.log(failures
  ? `\n${failures} failure(s)`
  : knownNegatives
    ? `\nvent-reactive report completed: ${knownNegatives} policy negative${knownNegatives === 1 ? '' : 's'} remain (see plans/20-21)`
    : '\nall vent-reactive checks passed');
