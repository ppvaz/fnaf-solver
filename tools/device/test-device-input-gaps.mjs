// The plan must respect the gaps the PHONE needs to accept an input.
//
// This gate exists because the same failure cost two days twice. The simulator
// emits a schedule in frames; it has no concept of an input being *refused*,
// so a plan can be 1000/1000 in the engine and still be un-runnable on the
// device. Every constraint below is a measurement recorded in
// docs/device/ON-DEVICE-VALIDATION.md, not a guess, and each one is quoted at
// its check so a future edit has to argue with the measurement rather than
// with a number.
//
// The failure this was written for: the pilot raises the monitor and selects a
// camera 134 ms later. The port swallows that selection and leaves the feed on
// CAM 11. The pilot then winds on a camera that is not CAM 11, sweeps cameras
// that never got selected, and reads a vent that is not on screen -- and
// because nothing observes the result, it never recovers. Rendered classifier
// frames from nights 6-22 to 6-25 show exactly that: CAM 11 with the music box gauge,
// captured at a moment the schedule believed was the office.
import { pathToFileURL } from 'node:url';
import * as C from '@sixam/source/fnaf2';
import { build, devicePlan, MONITOR_ANIM_UP_MS, RAISE_MARGIN_MS, DEVICE_SPACING_MS, MODEL_SLOT_MS, MIN_CONTACT_MS } from '../../packages/propose/bin/plans/recipe.mjs';

// The sourced constant, not the swipe-era one.
//
// src/config.js: MONITOR_ANIM_UP = 12 frames = 204 ms, decompiled and gated by
// sourcetest. engine.js:238 drops a camera select outright unless the monitor
// has finished raising:
//
//     if (this.monitor === MON_UP && C.CAMS[n]) this.cam = n;
//
// so a select delivered during MON_RAISING sets nothing and the feed stays
// where it was. That is the game's own rule, and it is measured press-to-press
// because setMonitor starts the animation on the press.
//
// ON-DEVICE-VALIDATION.md also records 500 ms ("swallowed by the flip and left
// the feed on CAM 11"), but read the bullet it sits in: it is the `input
// swipe` era, whose helper cost ~170 ms and whose schedule was quantised into
// 190 ms slots. That 500 is a slot-quantised gap measured through an actuator
// this runner no longer uses, and pricing the HID route against it would
// repeat the mistake of pricing against the ideal 267 ms sweep, pointed the
// other way. It is kept here as context, not as the threshold.
// Derived, never restated. This gate and the emitter it checks must not each
// hold their own copy of the animation length: a 204 here against a 200 there
// is how the emitter relaxed a raise to exactly the gap this file then called a
// violation, which is precisely the two-files-one-number failure that produced
// the 90-vs-100 contact floor. MONITOR_ANIM_UP_MS comes from recipe.mjs, which
// converts src/config.js's sourced frame count with the same 60 fps the rest of
// the codebase uses. The 33 ms margin absorbs the rounding (config's comment
// calls 12 frames 0.204 s).
export const SWIPE_ERA_FIGURE_MS = 500;
// The margin beyond the animation is RAISE_MARGIN_MS, also from the emitter:
// the anchor of a macro is a wall-timed boundary and this phone's wait_until
// lands 49-93 ms late, so a gap equal to the animation is a coin flip --
// deterministic in the engine, a refusal on the phone whenever the press slips.
export const CAMERA_AFTER_RAISE_MS = MONITOR_ANIM_UP_MS + RAISE_MARGIN_MS;
if (MONITOR_ANIM_UP_MS !== Math.round(C.MONITOR_ANIM_UP * 1000 / 60))
  throw new Error('the emitter and src/config.js disagree about MONITOR_ANIM_UP');

// docs/device/ON-DEVICE-VALIDATION.md: "The port swallows inputs briefly
// around the monitor flip; the mask press goes in ~0.3 s after the drop
// press". The sourced MONITOR_ANIM_DOWN is 367 ms and the runner already
// floors the vent light at the press that actually happened; this is the
// plan-level version of the same rule.
export const OFFICE_INPUT_AFTER_LOWER_MS = 367;

const CONTACT_MS = MIN_CONTACT_MS;

// Walk one cycle and report where the monitor ends up after each instruction.
// A steady cycle is entered with the cams UP -- its anchor is the press that
// lowers them -- while the opening starts in the office.
function violations(name, lines) {
  const ins = lines.map(line => {
    const [at, kind, ...rest] = line.split(' ');
    return { at: +at, kind, rest };
  });
  let up = name !== 'opening';
  let raisedAt = null, loweredAt = null;
  const found = [];
  for (const e of ins) {
    const isCamera = e.kind === 'sweep' ||
      (e.kind === 'tap' && /^cam\d+$/.test(e.rest[0]));
    const isMonitor = e.kind === 'hallraise' || e.kind === 'maskraise' ||
      (e.kind === 'tap' && e.rest[0] === 'monitor');
    const monitorAt = e.kind === 'maskraise' ? e.at + +e.rest[0] : e.at;

    if (isCamera && raisedAt !== null) {
      // Press to press: the animation starts when the raise is registered.
      const gap = e.at - raisedAt;
      if (gap < CAMERA_AFTER_RAISE_MS)
        found.push(`${name}: the monitor is raised at +${raisedAt} ms and ` +
          `${e.kind === 'sweep' ? 'the sweep' : e.rest[0].toUpperCase()} is selected at ` +
          `+${e.at} ms -- ${gap} ms after the raise press, against MONITOR_ANIM_UP ` +
          `${MONITOR_ANIM_UP_MS} ms plus ${RAISE_MARGIN_MS} ms of margin. engine.js:238 drops a ` +
          `select that arrives before the raise completes, so the feed stays where it was.`);
      raisedAt = null;                      // report the first one per raise
    }
    // An office control pressed inside the lowering animation is not refused
    // by the game so much as delivered to a screen that is not interactive yet.
    if (!up && loweredAt !== null && !isMonitor && !isCamera) {
      const gap = e.at - loweredAt - CONTACT_MS;
      if (gap < OFFICE_INPUT_AFTER_LOWER_MS - CONTACT_MS)
        found.push(`${name}: the monitor is lowered at +${loweredAt} ms and ` +
          `${e.kind === 'read' ? 'the vent read' : e.kind} starts at +${e.at} ms -- ` +
          `${gap} ms later, inside the ${OFFICE_INPUT_AFTER_LOWER_MS} ms flip.`);
      loweredAt = null;
    }

    if (isMonitor) {
      up = !up;
      if (up) { raisedAt = monitorAt; loweredAt = null; }
      else { loweredAt = monitorAt; raisedAt = null; }
    }
  }
  return found;
}

export function check(plan) {
  return Object.entries(plan).flatMap(([name, lines]) => violations(name, lines));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plan = devicePlan(build({ night: 6, sweepSlotMs: MODEL_SLOT_MS, maskMarginMs: 900,
                                  readLatencyMs: 550, hallPulseMs: 130,
                                  pilotOffset: 10 }));
  const problems = check(plan);
  if (problems.length) {
    console.error('\nThe device plan violates gaps this phone was MEASURED to need.\n');
    for (const p of problems) console.error('  ' + p);
    console.error(
      `\nMONITOR_ANIM_UP is ${MONITOR_ANIM_UP_MS} ms of sourced animation and engine.js:238\n` +
      'refuses a camera select until it finishes. A plan that clears it by zero is\n' +
      'deterministic in the engine -- the select lands on the completing frame -- and\n' +
      "a coin flip on the phone, because the macro's anchor is wall-timed and lands\n" +
      '49-93 ms late. Nights 6-22 to 6-25 lost the sweep that bridges the five-tick mask\n' +
      'exactly this way; the rendered classifier frame is CAM 11, unchanged.\n\n' +
      'Fix it by moving the RAISE earlier, not the sweep later: HID-MULTITOUCH.md\n' +
      'records that one frame of sweep tail costs 272 of 400 nights. Re-validate the\n' +
      'route 1000/1000 afterwards. Do not lower these constants to make this pass --\n' +
      `the ${SWIPE_ERA_FIGURE_MS} ms in ON-DEVICE-VALIDATION.md belongs to the retired swipe actuator\n` +
      'and is not a licence to raise this one either.\n');
    process.exit(1);
  }
  console.log(`device input gaps: every camera select clears MONITOR_ANIM_UP ` +
    `(${MONITOR_ANIM_UP_MS} ms) by at least ${RAISE_MARGIN_MS} ms, and the office ` +
    `respects the ${OFFICE_INPUT_AFTER_LOWER_MS} ms lowering flip`);
}
