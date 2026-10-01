// The plan compiler must refuse a press scheduled inside an animation the
// engine drops it during. No phone required.
//
// Both rules were written after live nights were lost to them on 2026-09-08.
// The monitor rule is the one that matters most here: a wind press moved to
// 100 ms after the raise tap looked fine in the simulator, because
// `press('wind')` latches `winding = true` and `isWinding` simply waits for
// MON_UP. On the phone the monitor was still animating, the wind button was
// not on screen, the contact hit the office underneath, and the cycle wound
// nothing. The simulator latches presses; the device needs the control to
// exist at contact time, and only the compiler can see the difference.
import * as C from '@sixam/source/fnaf2';
import { compileCycle, SEAM_FLOORS } from '../bin/plans/artifact-commands.ts';
import { MIN_CONTACT_MS } from '../bin/plans/recipe.mjs';

const check = (ok, message) => { if (!ok) throw new Error(message); };
const MONITOR_ANIM_UP_MS = Math.round(C.MONITOR_ANIM_UP * 1000 / C.FPS);
const MASK_ANIM_OFF_MS = Math.round(C.MASK_ANIM_OFF * 1000 / C.FPS);
const MONITOR_ANIM_DOWN_MS = Math.round(C.MONITOR_ANIM_DOWN * 1000 / C.FPS);
// IMPORTED, not restated. This line used to recompute the floor as
// `MONITOR_ANIM_DOWN_MS + MIN_CONTACT_MS`, so when the compiler re-anchored it
// to the measured ~382.5 ms mask-button visibility the test kept asserting the
// old 400 and refused the corrected route. A second copy of a constant is how
// a gate ends up protecting the value it was supposed to check.
const MONITOR_MASK_READY_MS = SEAM_FLOORS.monitorMaskReadyMs;
const refuses = (rows, initial, needle) => {
  try {
    compileCycle('probe', rows, initial);
  } catch (error) {
    check(error instanceof TypeError && error.message.includes(needle),
      `refused with the wrong error: ${error.message}`);
    return true;
  }
  return false;
};
const down = { monitorUp: false, maskOn: false };

// --- monitor raise readiness, per control ------------------------------------
// The bound is not the animation: it is a DEVICE BRACKET. A wind hold missed at
// raise+100 ms and at raise+200 ms; the lowest gap observed to work is +434 ms,
// the minus-toys opening that armed all four story-night wins. A camera select
// is proven at +300 ms by that same arm.
{
  const raise = { at: 5300, kind: 'tap', control: 'monitor', duration: 33 };
  const wind = at => ({ at, kind: 'hold', control: 'wind', duration: 3200 });
  const cam = at => ({ at, kind: 'tap', control: 'cam11', duration: 33 });
  check(refuses([raise, wind(5400)], down, 'monitor raise'),
    'the wind-at-raise+100 regression still compiles');
  check(refuses([raise, wind(5500)], down, 'monitor raise'),
    'wind at raise+200 ms still compiles, and that timing missed on device twice');
  check(!refuses([raise, wind(5734)], down, 'monitor raise'),
    'wind at raise+434 ms was refused, but that is the proven minus-toys opening gap');
  check(!refuses([raise, wind(5800)], down, 'monitor raise'),
    'the shipped Minus 3 wind timing at raise+500 ms was refused');
  // a camera select is bound by the animation plus RAISE_MARGIN_MS, not by the
  // wind bracket, because +300 ms is the arm that landed every win
  check(!refuses([raise, cam(5600)], down, 'monitor raise'),
    'a camera select at raise+300 ms was refused, but that is the proven arm');
  check(refuses([raise, cam(5400)], down, 'monitor raise'),
    'a camera select inside the raise animation still compiles');
}

// --- the mask-off animation -------------------------------------------------
{
  const maskOff = { at: 9200, kind: 'tap', control: 'mask', duration: 33 };
  const initial = { monitorUp: false, maskOn: true };
  check(refuses([maskOff, { at: 9200 + MASK_ANIM_OFF_MS - 1, kind: 'hall', duration: 350 }], initial, 'mask-off'),
    'a hall flash inside the mask-off animation was compiled');
  check(!refuses([maskOff, { at: 9200 + MASK_ANIM_OFF_MS, kind: 'hall', duration: 350 }], initial, 'mask-off'),
    'a hall flash clearing the mask-off animation was refused');
  // a mask press itself is always allowed: the mask surface owns its own input
  check(!refuses([maskOff, { at: 9250, kind: 'tap', control: 'mask', duration: 33 }], initial, 'mask-off'),
    'a mask press inside its own animation was refused');
}

// --- monitor lowering -> mask availability -------------------------------
{
  const initial = { monitorUp: true, maskOn: false };
  const lower = { at: 100, kind: 'tap', control: 'monitor', duration: 33 };
  const mask = at => ({ at, kind: 'tap', control: 'mask', duration: 33 });
  check(refuses([lower, mask(100 + MONITOR_MASK_READY_MS - 1)], initial, 'mask control'),
    'a mask press before the monitor-down settle bracket was compiled');
  check(!refuses([lower, mask(100 + MONITOR_MASK_READY_MS)], initial, 'mask control'),
    'a mask press at exactly the monitor-down readiness floor was refused');
}

// --- contact floor and semantic state ---------------------------------------
{
  check(refuses([{ at: 0, kind: 'hall', duration: 32 }], down, 'device floor'),
    'a sub-floor hall contact was compiled');
  check(refuses([{ at: 0, kind: 'sweep', spacing: 100, contact: 32, cams: ['cam10', 'cam4'] }],
    { monitorUp: true, maskOn: false }, 'device floor'),
  'a sub-floor camera contact was compiled');
  check(refuses([{ at: 0, kind: 'tap', control: 'wind', duration: 33 }], down, 'requires monitor up'),
    'wind while the monitor is down was compiled');
  check(refuses([{ at: 0, kind: 'tap', control: 'cam11', duration: 33 }], down, 'requires monitor up'),
    'camera select while the monitor is down was compiled');
  check(refuses([{ at: 0, kind: 'hall', duration: 33 }], { monitorUp: true, maskOn: false },
    'requires monitor down'), 'hall flash while the monitor is up was compiled');
  check(refuses([{ at: 0, kind: 'tap', control: 'rightVentLight', duration: 33 }],
    { monitorUp: true, maskOn: false }, 'requires monitor down'),
  'right vent light while the monitor is up was compiled');
  check(refuses([
    { at: 0, kind: 'tap', control: 'mask', duration: 33 },
    { at: 100, kind: 'hall', duration: 33 },
  ], down, 'mask is up'), 'hall flash during mask-up ownership was compiled');
  check(refuses([
    { at: 0, kind: 'tap', control: 'monitor', duration: 33 },
    { at: 5, kind: 'tap', control: 'monitor', duration: 33 },
  ], down, 'reverses the monitor'), 'monitor reversal during raise was compiled');
  check(refuses([{ at: 0, kind: 'read', duration: 33, gap: 32 }], down, 'released-input'),
    'a read with no released Fusion poll was compiled');

  // The reviewed maskraise is the explicit exception to the mask lock: it
  // owns mask-off plus monitor-up/hall choreography as one compound.
  const maskraise = { at: 0, kind: 'maskraise', gap: 180, mode: 'hall', duration: 33 };
  const raised = compileCycle('probe', [maskraise,
    { at: 600, kind: 'sweep', spacing: 100, contact: 33, cams: ['cam10', 'cam4'] }],
  { monitorUp: false, maskOn: true });
  check(raised.final.monitorUp && !raised.final.maskOn,
    'the reviewed maskraise compound did not close in monitor-up/mask-off state');
  check(refuses([maskraise], down, 'maskraise requires the mask to be up'),
    'maskraise without a mask-up start state was compiled');

  // The mask-ON animation is a drop window exactly as the mask-off one is, and
  // until 2026-09-19 nothing checked it. minus7's clear cycle pressed the mask
  // on inside its `read` at +1007 ms and took it off in the maskraise at
  // +1140 ms -- 133 ms into a 200 ms animation -- so the engine dropped the
  // mask-off press, the mask stayed up, and every later contact in the cycle
  // hit the mask instead of the office. The phone graded that compound's
  // maskOn->false MISSING on 48 of 55 cycles and its raise on 54 of 55
  // (night1-minus7-n1-first-20260919T215533Z), while the rules read both
  // states hundreds of times elsewhere in the same run -- lost presses, not a
  // blind detector. The run still reached 6 AM, because nothing on Night 1 can
  // punish a blind pilot; that is precisely why this needs a gate and not an
  // outcome.
  const read = { at: 0, kind: 'read', duration: 600, gap: 40 };   // mask on at +640
  check(refuses([read, { at: 700, kind: 'maskraise', gap: 300, mode: 'hall', duration: 133 }],
    { monitorUp: false, maskOn: false }, 'mask-on animation'),
    'a maskraise inside the read\'s mask-on animation was compiled');
  check(!refuses([read, { at: 900, kind: 'maskraise', gap: 300, mode: 'hall', duration: 133 }],
    { monitorUp: false, maskOn: false }, 'mask-on animation'),
    'a maskraise clear of the mask-on animation was refused');
  // The same window applies to a plain mask toggle, not just the compound.
  check(refuses([{ at: 0, kind: 'tap', control: 'mask', duration: 33 },
    { at: 100, kind: 'tap', control: 'mask', duration: 33 }],
  { monitorUp: false, maskOn: false }, 'mask-on animation'),
  'a mask toggle inside the mask-on animation was compiled');
}

console.log(
  'artifact animation gates: a wind hold refuses within the 434 ms device bracket after a monitor raise ' +
  '(including the raise+100 and raise+200 timings that missed on the phone) while the proven +434 and +500 ' +
  'gaps compile, a camera select refuses inside the raise animation while the proven +300 arm compiles, and ' +
  `every non-mask press refuses inside the ${MASK_ANIM_OFF_MS} ms mask-off animation; contact, semantic-state, ` +
  `monitor-down mask readiness (${MONITOR_MASK_READY_MS} ms), mask ownership, and compound-transition gates pass`);
