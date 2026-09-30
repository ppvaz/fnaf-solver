// Gate for the sourced observation-only night policy (ROADMAP Track A1).
//
// Two things are checked here and neither is a survival number: that the
// policy's PRIORITIES are the sourced ones, and that it reads nothing it is
// not allowed to read. Survival belongs to `tools/nightloop.mjs`, which runs
// whole nights against the exact engine and its controls.
import { STUN_FRAMES } from '@sixam/core/mechanics';
import { initialReducedState, advanceReduced, observeReduced } from '@sixam/core/mechanics';
import { CYCLE_LIBRARY, NightPolicy, NIGHT_POLICY_CYCLES } from '@sixam/core/control';

let failures = 0;
const check = (condition, message) => {
  if (condition) console.log(`ok   ${message}`);
  else { failures++; console.error(`FAIL ${message}`); }
};

const O = value => ({ state: 'OBSERVED', value });
const U = reason => ({ state: 'UNKNOWN', reason });

// A stand-in for the controller surface the policy is allowed to touch: the
// reduced belief and the last fact batch. Nothing else exists here, so a
// policy that reached for an engine would fail to run at all.
function surface(state, facts = {}) {
  return { reduced: state, facts };
}

// Settle the two control facts so the reduced model stops reporting them
// UNKNOWN, which every primitive's prerequisites require.
function settled(night, overrides = {}) {
  let state = initialReducedState({ night, frame: 0 });
  state = observeReduced(state, { monitorUp: O(false), maskOn: O(false) }, { frame: 0 });
  return Object.assign(state, overrides);
}

// ------------------------------------------------------- library agreement
const ids = new Set(CYCLE_LIBRARY.map(cycle => cycle.id));
check(NIGHT_POLICY_CYCLES.every(id => ids.has(id)),
  'every cycle the policy names exists in the reviewed library');

// --------------------------------------------------------------- priorities
const night6 = new NightPolicy({ night: 6 });

check(night6.want(surface(settled(6), { blackout: O(true) })) === 'mask-now',
  'an observed blackout takes the mask before anything else');
check(night6.want(surface(settled(6, { monitor: 'up', viewedCamera: 11 }),
  { blackout: O(true) })) === 'lower-monitor',
  'a blackout with the monitor up lowers it first, because the mask cannot go on over it');
check(night6.want(surface(settled(6, { maskOn: true, maskSinceFrame: 0 }),
  { blackout: O(true) })) === 'observe-and-hold',
  'a blackout already answered by the mask is held, not re-pressed');

check(night6.want(surface(settled(6), { blackout: O(false), leftOpening: O('threat') }))
  === 'mask-now', 'Balloon Boy in the opening takes the mask');
check(night6.want(surface(settled(6), { blackout: O(false), mangleStatic: O(true) }))
  === 'mask-now', 'Mangle static at the office edge takes the mask');

const completedRepel = settled(6, {
  frame: night6.campFrames, maskOn: true, maskSinceFrame: 0,
});
check(night6.want(surface(completedRepel, {
  blackout: O(false), leftOpening: U('mask-on'), bbVent: O('opening'),
})) === 'unmask', 'a retained BB audio cue cannot extend a completed five-tick repel');
const oldAudioOverruled = settled(6, { frame: night6.campFrames + 20 });
night6.want(surface(oldAudioOverruled, {
  blackout: O(false), leftOpening: O('empty'), bbVent: O('opening'),
}));
check(!night6.lastDecision.why.startsWith('balloon boy'),
  'a current empty office level supersedes an older retained BB audio edge');

// UNKNOWN is not a hazard and it is not an all-clear: with nothing observed
// the policy still runs its deadline race rather than refusing or masking.
const unknownFacts = { blackout: U('read-dropped'), leftOpening: U('opening-not-in-view') };
check(NIGHT_POLICY_CYCLES.includes(night6.want(surface(settled(6), unknownFacts))),
  'an UNKNOWN read leaves the policy on its deadlines rather than inventing a hazard');

// ----------------------------------------------------------- Golden Freddy
// He can only appear while the monitor is up and the mask press clears him, so
// a night that can arm him owes a flick after a cams-up trip. A night that
// cannot arm him must not pay for one.
const afterTrip = { lastMonitorUpFrame: 500, lastMaskOnFrame: 100, frame: 520 };
// The cycle alone cannot tell these apart -- an idle Night 1 masks anyway, to
// camp -- so this reads the recorded REASON, which is the thing under test.
const gfWhy = (night) => {
  const policy = new NightPolicy({ night });
  policy.want(surface(settled(night, afterTrip), { blackout: O(false) }));
  return policy.lastDecision;
};
check(gfWhy(7).cycle === 'mask-now' && gfWhy(7).why.startsWith('golden freddy'),
  'a night that can arm Golden Freddy clears the office after a cams-up trip');
check(!gfWhy(1).why.startsWith('golden freddy'),
  'a night that cannot arm Golden Freddy does not pay for the flick');

// ------------------------------------------------------------------- Foxy
// The band and the five-second check are both real deadlines and the policy
// takes the nearer one. Night 1 has neither, because the source pins D at zero.
const n1 = new NightPolicy({ night: 1 });
check(n1.foxySlack(settled(1, { frame: 12000, foxyD: 40 })) === Infinity,
  'Night 1 has no Foxy deadline at all, read off the AI rows rather than the night number');
const n5 = new NightPolicy({ night: 5 });
check(n5.foxySlack(settled(5, { frame: 600, foxyD: 0, lastHallLightFrame: 599 })) > 0,
  'a fresh hall flash leaves Foxy slack');
check(n5.foxySlack(settled(5, { frame: 600, foxyD: 0, lastHallLightFrame: 290 })) <= 0,
  'a whole five-second check period without a flash is due, even at D = 0');
// D IS ONLY LETHAL ON A GRID, so "reaching the band" is not by itself a
// deadline. `[SOURCED]` arrival and lock-on are the same equation and both are
// evaluated inside `onFiveSecond`, so D crossing the band BETWEEN two rolls
// costs nothing provided a flash lands before the next roll. What is due is
// the first roll that would land unsafe. The pre-grid rule is retained under
// `rollGrid: false` -- the fallback for a lost grid phase -- and still calls
// the band itself due, so both rules are pinned here rather than only the
// default.
const atBand = settled(5, { frame: 600, foxyD: n5.safeD, lastHallLightFrame: 599 });
check(n5.foxySlack(atBand) > 0,
  'reaching the band between two rolls is not due under the grid rule');
check(new NightPolicy({ night: 5, rollGrid: false }).foxySlack(atBand) <= 0,
  'reaching the band is due under the retained grid-free rule');
// ...and the grid rule is not merely permissive: with the same D one tick
// before a roll, that roll is the one that lands unsafe and it is due.
check(n5.foxySlack(settled(5, { frame: 880, foxyD: n5.safeD, lastHallLightFrame: 879 }))
  <= n5.actWithinFrames,
  'the roll that would land unsafe is due under the grid rule');
check(n5.foxySlack(settled(5, { frame: 600, foxyD: 0, lastHallLightFrame: 599, power: 0 }))
  === Infinity, 'a flash that cannot be paid for is not scheduled');

// ------------------------------------------------------------------ the box
const n6box = new NightPolicy({ night: 6 });
const full = settled(6, { frame: 6000, box: 1, lastHallLightFrame: 5999 });
const empty = settled(6, { frame: 6000, box: 0.05, lastHallLightFrame: 5999 });
check(n6box.boxSlack(full) > n6box.boxSlack(empty),
  'a fuller box is further from its deadline');
// "Due" is now "inside one idle quantum", not "already negative": the only
// idle primitive is a full second, so a deadline nearer than that has to be
// acted on rather than held through.
check(n6box.boxSlack(empty) <= n6box.actWithinFrames, 'a nearly empty box is due');
check(new NightPolicy({ night: 1 }).boxSlack(settled(1, { frame: 0, box: 1 })) === Infinity,
  "Night 1's first two hours do not drain the box, so nothing is due there");

// A standalone overdue route sweep must actually sweep. Earlier code routed
// this through the wind-trip helper; when already parked on CAM 11 it skipped
// the sweep and wound forever, leaving the stun permanently overdue.
const overdueSweep = settled(1, {
  frame: 500, monitor: 'up', viewedCamera: 11,
  lastCameraFlashFrame: 0, lastMonitorUpFrame: -1,
});
// The periodic refresh is off by default (measured: a trip taken only to
// sweep costs more Night 1 exposure than the stun buys), so this asks for it
// explicitly -- the behaviour under test is the knob, not the default.
check(new NightPolicy({ night: 1, sweepPeriodFrames: STUN_FRAMES }).want(
  surface(overdueSweep, { blackout: O(false), leftOpening: U('cams-up') }))
  === 'sweep-routes', 'an overdue standalone route refresh sweeps instead of winding');
check(new NightPolicy({ night: 1 }).sweepSlack(overdueSweep) === Infinity,
  'the default never makes a cams-up trip purely to refresh the stun');

// ---------------------------------------------------------------- purity
// The same belief must produce the same answer: the policy keeps no private
// state that could disagree with the controller about what happened.
const belief = settled(4, { frame: 9000, box: 0.4, foxyD: 3, lastHallLightFrame: 8900 });
const facts = { blackout: O(false), leftOpening: O('empty') };
const a = new NightPolicy({ night: 4 }).want(surface(belief, facts));
const b = new NightPolicy({ night: 4 }).want(surface(belief, facts));
const shared = new NightPolicy({ night: 4 });
shared.want(surface(advanceReduced(belief, 9600), facts));
check(a === b && shared.want(surface(belief, facts)) === a,
  'the policy is a pure function of the belief it is shown');

console.log(failures
  ? `night policy: ${failures} failed`
  : 'night policy: sourced priorities, deadlines, and purity pass');
if (failures) process.exitCode = 1;
