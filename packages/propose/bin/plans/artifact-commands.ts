// Compile validated phone-plan rows into short semantic blocks.  This is not a
// coordinate encoder: physical geometry stays in the resolved device profile.
// Every block declares the monitor state it needs, and every monitor action is
// a target state rather than a parity toggle.

import * as C from '@sixam/source/fnaf2';
import { FNAF2_CONTROL_VOCABULARY as V } from '@sixam/source';
import { FUSION_POLL_MS, MASK_ANIM_ON_MS, MIN_CONTACT_MS, MONITOR_READY_WIND_MS, RAISE_MARGIN_MS, SEAM_MARGIN_MS } from './recipe.mjs';

// [SOURCED] The engine animates the monitor and the mask, and drops input that
// lands inside those windows: a camera select or wind press during the raise
// hits the office underneath, and every non-mask touch is dropped while the
// mask-off animation runs. Both were costing live nights before they were
// enforced here rather than watched for on the phone.
const MONITOR_ANIM_UP_MS = Math.round(C.MONITOR_ANIM_UP * 1000 / C.FPS);
const MASK_ANIM_OFF_MS = Math.round(C.MASK_ANIM_OFF * 1000 / C.FPS);
// The mask-ON animation had no gate at all until 2026-09-19, only the mask-OFF
// one below. The engine drops input during BOTH. minus7's clear cycle presses
// the mask on inside its `read` and takes it off 133 ms later in the maskraise
// -- inside this 200 ms window -- so the mask-off press was dropped, the mask
// stayed up, and every later contact in the cycle landed on the mask instead of
// the office. On the phone that graded maskOn->false MISSING on 48 of 55 cycles
// and the raise on 54 of 55, with the rule reading both states hundreds of times
// elsewhere in the same run (night1-minus7-n1-first-20260919T215533Z).

const MONITOR_ANIM_DOWN_MS = Math.round(C.MONITOR_ANIM_DOWN * 1000 / C.FPS);
// The native trace showed the mask button absent throughout the first 322 ms
// after monitor-down, only faint at ~337 ms, and fully visible at ~382.5 ms.
//
// This floor is anchored to THAT MEASUREMENT, not to the animation constant and
// not to a route. It used to be `MONITOR_ANIM_DOWN_MS + MIN_CONTACT_MS` = 400,
// whose own comment said it was "the +400 ms timing used by the Night 5 route"
// -- and the route pressed at exactly 400, so `400 < 400` was false and the
// check passed in silence while the phone lost that press on about one cycle
// in eight (docs/evidence/night5-mask-tick-budget-20260911.json). A floor set
// to what a route already does can never refuse that route.
const MASK_BUTTON_VISIBLE_AFTER_MONITOR_DOWN_MS = 382.5;
// The floor is the MEASUREMENT, and nothing else. A press before the mask
// button is fully visible is illegal; how much room a schedule leaves beyond
// that is a margin question, and margin belongs to test-seam-slack.mjs.
//
// Folding a margin in here double-counted it. The floor was
// measurement + MIN_CONTACT_MS = 416, the gate then demanded the allowance on
// top, and a plan at 449 was reported as "clears by 33" when it in fact stood
// 66.5 ms above the measured full-visibility point. Chasing that phantom 33 by
// moving the Minus Toys loop mask took the 10/20 measured band from 120/120 to
// 0/120 (bisected 2026-09-19); moving the camdrop to widen the same seam from
// the other side broke it too. One margin, applied once, from the physical fact.
const MONITOR_MASK_READY_MS = Math.ceil(MASK_BUTTON_VISIBLE_AFTER_MONITOR_DOWN_MS);
// MONITOR_ANIM_UP alone is not the moment a control is usable, and the delay
// is not the same for every control. The model constant is 12 engine frames and
// the profile still carries no measured raise readiness
// ('hid-100ms-candidate-unqualified-v1'), so these are DEVICE BRACKETS, not
// measurements, and a measured readiness should replace them:
//
//   camera select  raise+300 ms works -- it is the arm that landed every one of
//                  the four story-night wins, so the bound is the animation
//                  plus recipe.mjs's RAISE_MARGIN_MS.
//   wind hold      raise+100 ms and raise+200 ms both MISSED on the phone; the
//                  taps did not land and the box went unwound. Observed to
//                  work: +434 ms (the minus-toys opening, which armed all four
//                  story-night wins), +450 ms (its loop) and +500 ms (the
//                  Minus 3 loop that reached 5 AM). The bound is therefore the
//                  LOWEST OBSERVED WORKING gap, not a measurement: it refuses
//                  the failing region without refusing anything proven. The
//                  true readiness lies somewhere in (200, 434].
const MONITOR_READY_CAMERA_MS = Math.round(C.MONITOR_ANIM_UP * 1000 / C.FPS) + RAISE_MARGIN_MS;

// Contact length is only the actuator floor.  It is deliberately checked
// separately from the state/animation gates below: a 33 ms contact can still
// miss a game sampler phase or land on a surface that is not present.
const contactFloor = (cycle, label, value) => {
  if (!Number.isFinite(value) || value < MIN_CONTACT_MS)
    throw new TypeError(`${cycle}: ${label} contact ${value} ms is below the ` +
      `measured device floor of ${MIN_CONTACT_MS} ms`);
};

function validateRowContacts(cycle, row) {
  if (row.kind === 'tap' || row.kind === 'hold' || row.kind === 'hall' ||
      row.kind === 'hallvent' || row.kind === 'hallraise' || row.kind === 'maskraise')
    contactFloor(cycle, row.kind, row.duration);
  else if (row.kind === 'camdrop') contactFloor(cycle, 'camdrop monitor', row.contact);
  else if (row.kind === 'sweep') {
    contactFloor(cycle, 'sweep select', row.contact);
    for (const token of row.cams) {
      const override = token.includes(':') ? Number(token.split(':')[1]) : row.contact;
      contactFloor(cycle, `sweep ${token.split(':')[0]}`, override);
    }
  } else if (row.kind === 'read') {
    contactFloor(cycle, 'read vent', row.duration);
    if (row.hallAt !== undefined) contactFloor(cycle, 'read hall', row.hallDuration);
    if (row.gap < FUSION_POLL_MS)
      throw new TypeError(`${cycle}: read mask gap ${row.gap} ms is below the ` +
        `released-input floor of ${FUSION_POLL_MS} ms`);
    if (row.hallAt !== undefined &&
        (row.hallAt <= 0 || row.hallAt >= row.duration ||
         row.hallAt + row.hallDuration > row.duration))
      throw new TypeError(`${cycle}: read hall contact must fit inside the held vent-light window`);
  }
}

const camera = control => /^cam(?:[0-9]|1[0-2])$/.test(control);
const semantic = control => camera(control) ? `cam:${Number(control.slice(3))}`
  : control === 'ventl' ? V.leftVentLight : control === 'ventr' ? V.rightVentLight : control;

function action(cycle, row, index, fields) {
  return Object.freeze({ schema: 'artifact-action-v1', id: `${cycle}-${index}`,
    cycle, atMs: row.at, ...fields });
}

function initialState(cycle) {
  return { monitorUp: cycle === 'opening' ? false : true, maskOn: false };
}

function planTiming(parsed) {
  const idleUntilMs = parsed.headers['idle-until'] === undefined
    ? 0 : Number(parsed.headers['idle-until']);
  if (!Number.isInteger(idleUntilMs) || idleUntilMs < 0)
    throw new TypeError('artifact plan #idle-until must be a non-negative integer');
  const phaseOffsetMs = parsed.headers['phase-offset'] === undefined
    ? undefined : Number(parsed.headers['phase-offset']);
  if (phaseOffsetMs !== undefined &&
      (!Number.isInteger(phaseOffsetMs) || phaseOffsetMs < 0 || phaseOffsetMs > 2000))
    throw new TypeError('artifact plan #phase-offset must be an integer in 0..2000 ms');
  return Object.freeze({
    periodMs: parsed.period, loopStartMs: parsed.loopStart, stopAtMs: parsed.stopAt,
    observeUntilMs: parsed.observeUntil, idleUntilMs,
    ...(phaseOffsetMs === undefined ? {} : { phaseOffsetMs }),
  });
}

function armVerification(parsed) {
  const headers = parsed.headers;
  const declared = headers['arm-verify'] !== undefined ||
    headers['arm-verify-cameras'] !== undefined || headers['arm-verify-until'] !== undefined ||
    headers['arm-verify-viewing'] !== undefined;
  if (!declared) return undefined;
  if (headers['arm-verify'] !== '1')
    throw new TypeError('artifact plan #arm-verify must be 1 when arm verification is declared');
  const cameras = (headers['arm-verify-cameras'] ?? '').split(',').filter(Boolean);
  if (cameras.length !== 2 || cameras.some(camera => !/^cam:(?:[1-9]|1[0-2])$/.test(camera)) ||
      new Set(cameras).size !== cameras.length)
    throw new TypeError('artifact plan #arm-verify-cameras must contain two unique semantic cameras');
  const viewing = headers['arm-verify-viewing'] ?? 'cam:11';
  if (!/^cam:(?:[1-9]|1[0-2])$/.test(viewing) || !cameras.includes(viewing))
    throw new TypeError('artifact plan #arm-verify-viewing must name one highlighted camera');
  const untilMs = Number(headers['arm-verify-until']);
  if (!Number.isInteger(untilMs) || untilMs < 1)
    throw new TypeError('artifact plan #arm-verify-until must be a positive integer');
  if (untilMs >= parsed.observeUntil)
    throw new TypeError('artifact plan arm-verification must close before the observation envelope');
  return Object.freeze({ cameras: Object.freeze([...cameras].sort((a, b) =>
    Number(a.slice(4)) - Number(b.slice(4)))), viewing, untilMs });
}

// Every timing gate below is a floor, and a plan that CLEARS a floor by zero
// is indistinguishable here from one that clears it by half a second. That is
// how the Night 5 mask timing survived: its +400 ms sits exactly on
// MONITOR_MASK_READY_MS, `400 < 400` is false, and the compile passed in
// silence while the phone lost the press on about one cycle in eight.
//
// So each gate now records what it had to spare. `seams` is collected into a
// caller-supplied array and attached at PLAN level, never inside `cycles`, so
// it never reaches persistArtifactPlans and never moves an artifact hash.
// `test-seam-slack.ts` is what turns the record into a refusal.
/** The timing floors these gates enforce, so no auditor has to restate one. */
export const SEAM_FLOORS = Object.freeze({
  maskAnimOffMs: MASK_ANIM_OFF_MS,
  monitorAnimDownMs: MONITOR_ANIM_DOWN_MS,
  monitorAnimUpMs: MONITOR_ANIM_UP_MS,
  monitorMaskReadyMs: MONITOR_MASK_READY_MS,
  monitorReadyCameraMs: MONITOR_READY_CAMERA_MS,
  monitorReadyWindMs: MONITOR_READY_WIND_MS,
  // The native frame trace behind monitorMaskReadyMs: the mask button is absent
  // through the first 322 ms after monitor-down, faint at ~337 ms, and fully
  // visible at ~382.5 ms.
  maskButtonFullyVisibleAfterMonitorDownMs: MASK_BUTTON_VISIBLE_AFTER_MONITOR_DOWN_MS,
});

export function compileCycle(cycle, rows, initial = initialState(cycle), seams = [], declaredViewing = null) {
  const seam = (relation, row, gapMs, floorMs) => {
    if (!Number.isFinite(gapMs)) return;   // no prior transition to measure against
    seams.push(Object.freeze({ cycle, relation, atMs: row.at, kind: row.kind,
      gapMs, floorMs, slackMs: gapMs - floorMs }));
  };
  if (!Array.isArray(rows)) throw new TypeError('artifact cycle rows must be an array');
  const state: any = { ...initial };
  // When the monitor raise and the mask-off press began, so a press cannot be
  // scheduled inside an animation the engine drops it during.
  let monitorUpAt = -Infinity;
  let monitorDownAt = -Infinity;
  let monitorTransitionAt = -Infinity;
  let monitorTransitionMs = 0;
  let maskOffAt = -Infinity;
  let maskOnAt = -Infinity;
  const blocks = [];
  for (const [rowIndex, row] of rows.entries()) {
    const id = rowIndex + 1;
    const actions = [];
    validateRowContacts(cycle, row);
    const isMaskRow = (row.kind === 'tap' || row.kind === 'hold') && semantic(row.control) === V.mask;

    // Once the mask owns the surface, every other control is an impossible
    // plan. `maskraise` is the one explicit exception: it is the reviewed
    // mask-off + raise compound, and its internal timing owns the transition.
    if (state.maskOn && !isMaskRow && row.kind !== 'maskraise')
      throw new TypeError(`${cycle}: ${row.kind} is illegal while the mask is up; ` +
        'only the mask-off control or maskraise may proceed');
    if (row.kind === 'maskraise' && !state.maskOn)
      throw new TypeError(`${cycle}: maskraise requires the mask to be up at its start`);

    if (!isMaskRow && row.at - maskOffAt < MASK_ANIM_OFF_MS)
      throw new TypeError(`${cycle}: ${row.kind} at +${row.at} ms lands inside the ` +
        `${MASK_ANIM_OFF_MS} ms mask-off animation from +${maskOffAt} ms, where the engine drops it`);
    if (!isMaskRow) seam('after-mask-off-animation', row, row.at - maskOffAt, MASK_ANIM_OFF_MS);

    const rawControl = row.kind === 'tap' || row.kind === 'hold' ? semantic(row.control) : null;
    const needsMonitorDown = rawControl === V.hallLight || rawControl === V.leftVentLight ||
      rawControl === V.rightVentLight || row.kind === 'hall' || row.kind === 'hallvent' ||
      row.kind === 'hallraise' || row.kind === 'read';
    const needsMonitorUpNow = camera(row.control) || row.kind === 'sweep' || row.kind === 'camdrop' ||
      rawControl === V.cameraFeedLight || rawControl === V.wind;
    if (needsMonitorDown && state.monitorUp)
      throw new TypeError(`${cycle}: ${row.kind} ${rawControl ?? ''} requires monitor down`);
    // The box is on CAM 11 and the engine only credits a wind while that camera
    // is the VIEWED feed: plant-model.js `winding && monitor === MON_UP &&
    // viewing === C.BOX_CAM`. The compiler required only monitor-up, so a plan
    // could schedule a wind with another camera viewed, compile clean, and be a
    // silent no-op on the phone -- the box drains and the Puppet arrives. On
    // 2026-09-20 a Night 5 run died at 48.4 s that way, with the arm unresolved
    // so nothing had confirmed CAM 11 was up; the box empties in 20 s at that
    // night's drain rate.
    //
    // The double-camera glitch makes "which camera is viewed" something a
    // last-tapped tracker gets wrong -- the route taps cam11 then cam9 and the
    // glitch keeps cam11 VIEWED with cam9 as the marker -- so this checks the
    // plan's own declaration instead of trying to model the glitch. A plan that
    // winds must declare the box camera as its viewing feed.
    if (rawControl === V.wind && declaredViewing && declaredViewing !== `cam:${C.BOX_CAM}`)
      throw new TypeError(`${cycle}: wind at +${row.at} ms needs cam:${C.BOX_CAM} viewed (the box ` +
        `camera), but the plan declares #arm-verify-viewing ${declaredViewing}`);
    if (needsMonitorUpNow && !state.monitorUp)
      throw new TypeError(`${cycle}: ${row.kind} ${rawControl ?? ''} requires monitor up`);

    // A second monitor transition cannot reverse the first one mid-animation.
    // Hall flashes during monitor lowering remain legal; the mask is different:
    // its button is absent while the monitor is coming down, so a mask contact
    // in this interval is an illegal device action even though the simulator
    // accepts the semantic press.
    const startsMonitorTransition = (row.kind === 'tap' || row.kind === 'hold') &&
      rawControl === V.monitor || row.kind === 'hallraise' || row.kind === 'maskraise' ||
      row.kind === 'camdrop';
    if (startsMonitorTransition && row.at - monitorTransitionAt < monitorTransitionMs)
      throw new TypeError(`${cycle}: ${row.kind} at +${row.at} ms reverses the monitor ` +
        `inside its ${monitorTransitionMs} ms animation from +${monitorTransitionAt} ms`);
    if (startsMonitorTransition)
      seam('monitor-reversal', row, row.at - monitorTransitionAt, monitorTransitionMs);

    // rule: a press that needs the monitor up must clear the raise animation
    const needsMonitorUp = row.kind === 'camdrop' || row.kind === 'sweep' ||
      ((row.kind === 'tap' || row.kind === 'hold') &&
        (camera(row.control) || semantic(row.control) === V.wind ||
          semantic(row.control) === V.cameraFeedLight));
    if (needsMonitorUp) {
      const isWind = (row.kind === 'tap' || row.kind === 'hold') && semantic(row.control) === V.wind;
      const readyMs = isWind ? MONITOR_READY_WIND_MS : MONITOR_READY_CAMERA_MS;
      seam(isWind ? 'after-monitor-raise-wind' : 'after-monitor-raise-camera',
        row, row.at - monitorUpAt, readyMs);
      if (row.at - monitorUpAt < readyMs)
        throw new TypeError(`${cycle}: ${row.kind} at +${row.at} ms is within ${readyMs} ms of the ` +
          `monitor raise at +${monitorUpAt} ms; that control is not reliably on screen yet and the contact ` +
          'hits the office underneath (device: wind missed at raise+200 ms, works at raise+450 ms)');
    }
    if (isMaskRow)
      seam('mask-after-monitor-down', row, row.at - monitorTransitionAt, MONITOR_MASK_READY_MS);
    if (isMaskRow && row.at - monitorTransitionAt < MONITOR_MASK_READY_MS)
      throw new TypeError(`${cycle}: mask at +${row.at} ms lands before the mask ` +
        `control reappears after monitor lowering from +${monitorTransitionAt} ms; ` +
        `requires ${MONITOR_MASK_READY_MS} ms (device trace: fully visible at ~382.5 ms)`);
    if (row.kind === 'tap' || row.kind === 'hold') {
      const control = semantic(row.control);
      if (control === V.monitor) {
        state.monitorUp = !state.monitorUp;
        monitorTransitionAt = row.at;
        monitorTransitionMs = state.monitorUp ? MONITOR_ANIM_UP_MS : MONITOR_ANIM_DOWN_MS;
        if (state.monitorUp) monitorUpAt = row.at;
        if (!state.monitorUp) { monitorDownAt = row.at; state.camera = null; }
        actions.push(action(cycle, row, id, { kind: 'ensure', control,
          targetMonitorUp: state.monitorUp, durationMs: row.duration }));
      } else if (control === V.mask) {
        if (state.monitorUp) throw new TypeError(`${cycle}: mask toggle requires monitor down`);
        if (state.maskOn) {
          seam('after-mask-on-animation', row, row.at - maskOnAt, MASK_ANIM_ON_MS);
          if (row.at - maskOnAt < MASK_ANIM_ON_MS)
            throw new TypeError(`${cycle}: mask toggle at +${row.at} ms lands inside the ` +
              `${MASK_ANIM_ON_MS} ms mask-on animation from +${maskOnAt} ms, where the engine drops it`);
        }
        state.maskOn = !state.maskOn;
        if (!state.maskOn) maskOffAt = row.at; else maskOnAt = row.at;
        actions.push(action(cycle, row, id, { kind: 'press', control,
          requiresMonitorUp: false, targetMaskOn: state.maskOn, durationMs: row.duration }));
      } else {
        const needsUp = camera(row.control) || control === V.wind || control === V.cameraFeedLight;
        actions.push(action(cycle, row, id, { kind: row.kind, control,
          requiresMonitorUp: needsUp ? true : undefined, durationMs: row.duration }));
      }
    } else if (row.kind === 'hall') {
      actions.push(action(cycle, row, id, { kind: 'hold', control: V.hallLight,
        requiresMonitorUp: false, durationMs: row.duration }));
    } else if (row.kind === 'hallvent') {
      actions.push(action(cycle, row, id, { kind: 'compound', compound: 'hallvent',
        control: V.hallLight, ventControl: V.rightVentLight, requiresMonitorUp: false,
        durationMs: row.duration }));
    } else if (row.kind === 'hallraise') {
      if (state.monitorUp) throw new TypeError(`${cycle}: hallraise starts with monitor up`);
      state.monitorUp = true;
      monitorTransitionAt = row.at;
      monitorTransitionMs = MONITOR_ANIM_UP_MS;
      monitorUpAt = row.at;
      actions.push(action(cycle, row, id, { kind: 'compound', compound: 'hallraise',
        control: V.hallLight, requiresMonitorUp: false, targetMonitorUp: true,
        durationMs: row.duration }));
    } else if (row.kind === 'maskraise') {
      if (state.monitorUp) throw new TypeError(`${cycle}: maskraise starts with monitor up`);
      // The compound's internal gap is deliberately NOT checked against
      // MASK_ANIM_OFF_MS. That was tried on 2026-09-19 and was wrong: the
      // reviewed gap is 180 ms, and 180 ms is a DEVICE measurement of this
      // exact transition (actuator.mjs: a monitor press after a mask press,
      // 0 of 17 lost at or above 180 ms). Refusing it would contradict a
      // measurement with a model constant -- mistake-register item 10 in the
      // other direction.
      seam('after-mask-on-animation', row, row.at - maskOnAt, MASK_ANIM_ON_MS);
      if (row.at - maskOnAt < MASK_ANIM_ON_MS)
        throw new TypeError(`${cycle}: maskraise at +${row.at} ms takes the mask off inside the ` +
          `${MASK_ANIM_ON_MS} ms mask-on animation from +${maskOnAt} ms, where the engine drops it`);
      state.maskOn = false; state.monitorUp = true;
      maskOffAt = row.at;
      monitorTransitionAt = row.at + row.gap;
      monitorTransitionMs = MONITOR_ANIM_UP_MS;
      monitorUpAt = row.at + row.gap;
      actions.push(action(cycle, row, id, { kind: 'compound', compound: 'maskraise',
        control: row.mode === 'hall' ? V.hallLight : V.monitor, requiresMonitorUp: false,
        targetMaskOn: false, targetMonitorUp: true, gapMs: row.gap,
        durationMs: row.duration }));
    } else if (row.kind === 'sweep') {
      if (!state.monitorUp) throw new TypeError(`${cycle}: sweep requires monitor up`);
      const cams = row.cams.map(token => Number(token.split(':')[0]));
      for (const [camIndex, cam] of cams.entries()) {
        const lightMs = row.cams[camIndex].includes(':')
          ? Number(row.cams[camIndex].split(':')[1]) : row.contact;
        actions.push(action(cycle, { at: row.at + camIndex * row.spacing }, `${id}-cam${cam}`,
          { kind: 'sweep-slot', control: `cam:${cam}`, requiresMonitorUp: true,
            selectMs: row.contact, settleMs: row.contact < 50 ? 17 : 0, lightMs }));
      }
    } else if (row.kind === 'read') {
      if (state.monitorUp) throw new TypeError(`${cycle}: vent read requires monitor down`);
      state.maskOn = true;
      // "The read owns the prophylactic mask-on press" (recipe.mjs): it lands
      // after the held vent window plus the released-input gap, not at row.at.
      maskOnAt = row.at + row.duration + row.gap;
      actions.push(action(cycle, row, id, { kind: 'observe-left', control: V.leftVentLight,
        requiresMonitorUp: false, durationMs: row.duration, maskGapMs: row.gap,
        targetMaskOn: true }));
    } else if (row.kind === 'camdrop') {
      if (!state.monitorUp) throw new TypeError(`${cycle}: camdrop requires monitor up`);
      state.monitorUp = false;
      monitorDownAt = row.at + row.lead;
      monitorTransitionAt = monitorDownAt;
      monitorTransitionMs = MONITOR_ANIM_DOWN_MS;
      actions.push(action(cycle, row, id, { kind: 'compound', compound: 'camdrop',
        control: V.cameraFeedLight, requiresMonitorUp: true, targetMonitorUp: false,
        leadMs: row.lead, durationMs: row.contact, tailMs: row.tail }));
    } else {
      throw new TypeError(`${cycle}: unsupported artifact row ${row.kind}`);
    }
    blocks.push(Object.freeze({ schema: 'artifact-action-block-v1', id: `${cycle}-block-${id}`,
      cycle, atMs: row.at, actions: Object.freeze(actions) }));
  }
  return Object.freeze({ cycle, initial: Object.freeze({ ...initial }), final: Object.freeze({ ...state }),
    blocks: Object.freeze(blocks) });
}

export function compileArtifactPlans(plans, parsePlan, profile) {
  if (!Array.isArray(plans) || typeof parsePlan !== 'function')
    throw new TypeError('validated plans and parser are required');
  return plans.map(plan => {
    const parsed = parsePlan(plan.text, { strategy: plan.policy, night: plan.night, profile });
    const compiled: any = {};
    const seams = [];
    const declaredViewing = parsed.armVerification?.viewing ?? null;
    compiled.opening = compileCycle('opening', parsed.cycles.opening.rows, undefined, seams, declaredViewing);
    for (const [name, value] of Object.entries(parsed.cycles)) {
      if (name === 'opening') continue;
      const prior = name === 'finish' && compiled.toys ? compiled.toys.final : compiled.opening.final;
      compiled[name] = compileCycle(name, (value as any).rows, prior, seams, declaredViewing);
    }
    return Object.freeze({ night: plan.night, policy: plan.policy,
      timing: planTiming(parsed), armVerification: armVerification(parsed),
      cycles: Object.freeze(compiled), seams: Object.freeze(seams) });
  });
}

/**
 * Strip host-only policy labels before the compiled artifact is persisted for
 * the device lane.  The executor needs cycles and semantic blocks, never the
 * strategy name or plan interpreter inputs.
 */
export function persistArtifactPlans(compiledPlans) {
  if (!Array.isArray(compiledPlans)) throw new TypeError('compiled plans are required');
  return compiledPlans.map(plan => Object.freeze({ night: plan.night, timing: plan.timing,
    ...(plan.armVerification ? { armVerification: plan.armVerification } : {}), cycles: plan.cycles }));
}
