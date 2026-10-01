/**
 * The HID schedule a device-local night runs: one bounded stream of
 * `/system/bin/hid` lines compiled from a validated semantic request, with
 * the gate and arm segments the executor spends at runtime. Split out of
 * adb-device-local-executor.js on 2026-09-25; nothing here touches adb.
 * CONTRACT:hid-executor-v1.
 */
import { HID_DESCRIPTOR, HID_FEATURE_REPORTS, report } from '@sixam/play';
import { validateExecutorRequest } from './artifact-executor.ts';
import { expandNightBlocks } from './device-local-executor.ts';
import { deviceProfileGame } from '@sixam/source';
import { FNAF2_CONTROL_VOCABULARY as V, FNAF2_PACKAGE } from '@sixam/source';

const HID_ID = 92;
const HID_NAME = 'FNAF Timed Touch';
const HID_VID = 6353;
const HID_PID = 61959;
const HID_BUS = 'usb';
// The menu HID waits for InputReader explicitly. The device-local stream
// cannot query readiness without moving its clock, so use the measured
// seven-second attachment bound on the Moto g56 rather than dropping the
// opening reports at the six-second edge.
export const DEFAULT_READY_DELAY_MS = 7000;
// A cycle-boundary gate costs one helper READ (85-180 ms measured), one
// corrective contact, and one verifying read. The mask effect appeared
// 358-712 ms after contact across the 2026-09-09 Night 5 runs, so 1200 ms
// covers observe + correct + verify. The budget is spent whether or not a
// correction is needed: releasing early would let each gate advance the
// stream and reintroduce the drift that refuted the per-action host lane.
// Measured on device 2026-09-09 (campaign-2026-09-09T15-18-01): one control
// read is 190 ms at p50 and 374 ms at worst, and the mask effect needs up to
// 712 ms to appear. A gate therefore has to afford up to three reads, a
// corrective contact, and that settle before it may release.
export const GATE_BUDGET_MIN_MS = 2200;
// A gate spends its idle rather than a fixed constant, so a plan that idles
// longer buys more attempts and one that idles less is simply not gated.
export const GATE_BUDGET_MAX_MS = 4000;
// Keep a measured release reserve between the end of the prior contact and
// the host-owned gate. Fixture timing can shorten this reserve without
// changing the production default or the physical contact duration.
export const GATE_BUDGET_RESERVE_MS = 400;
// A gate is only placed where the authored plan already has idle to pay for
// it, so gating never displaces a contact the plan's timing was validated on.
export const GATE_MIN_SLACK_MS = 2600;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new TypeError(`adb device-local executor: ${message}`); };

function point(value, control) {
  if (!isRecord(value) || !Number.isInteger(value.x) || !Number.isInteger(value.y) ||
      value.x < 0 || value.y < 0 || value.x >= 2400 || value.y >= 1080)
    fail(`profile.controlMap.${control} is not a bounded screen point`);
  return value;
}

function controlPoint(request, control) {
  return point(request.profile.controlMap?.[control], control);
}

export function line(command, fields = {}) {
  return JSON.stringify({ id: HID_ID, command, ...fields });
}

export const SHARED_HID_RELEASE = line('report', {
  report: [1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
});

export function sharedScheduleBody(schedule, { armObserveOnce = false } = {}) {
  // Blocking mode hands over only the prefix and waits for the arm to confirm
  // before the remainder is released. Observe-once hands over the prefix and
  // the first gated segment together, so the stream never parks and adds no
  // phase lag -- the later cycle gates are unchanged and still fire.
  if (schedule.gated) return armObserveOnce
    ? [...schedule.gated.prefix, ...schedule.gated.remainderSegments[0]]
    : schedule.gated.prefix;
  const register = JSON.parse(schedule.lines[0]);
  const readyDelay = JSON.parse(schedule.lines[1]);
  if (register.command !== 'register' || readyDelay.command !== 'delay' ||
      readyDelay.duration !== schedule.readyDelayMs)
    fail('shared HID handoff requires a register and ready delay prefix');
  return schedule.lines.slice(2);
}

function addDelay(events, duration) {
  if (!Number.isInteger(duration) || duration < 0) fail(`invalid integer delay ${duration}`);
  // AOSP hid rejects a zero duration. A zero is a valid semantic adjacency,
  // so it is represented by no event rather than a fatal device command.
  if (duration > 0) events.push(line('delay', { duration }));
}

function addReport(events, records) {
  events.push(line('report', { report: report(records) }));
}

function addSingle(events, request, control, duration) {
  const target = controlPoint(request, control);
  if (!Number.isInteger(duration) || duration < 1 || duration > 30000)
    fail(`${control} duration is outside 1..30000 ms`);
  addReport(events, [{ flags: 3, point: target }]);
  addDelay(events, duration);
  addReport(events, [{ flags: 0, point: target }]);
}

function addTwoContact(events, request, first, second, duration) {
  const firstPoint = controlPoint(request, first);
  const secondPoint = controlPoint(request, second);
  if (!Number.isInteger(duration) || duration < 1 || duration > 30000)
    fail(`${first}/${second} duration is outside 1..30000 ms`);
  addReport(events, [{ flags: 3, point: firstPoint }, { flags: 7, point: secondPoint }]);
  addDelay(events, duration);
  // Both records remain in the packet. The HID descriptor's contact count is
  // the number of records consumed, not the number that stays active.
  addReport(events, [{ flags: 0, point: firstPoint }, { flags: 4, point: secondPoint }]);
}

function addAction(events, request, action) {
  const duration = action.durationMs ?? 33;
  if (action.kind === 'ensure' || action.kind === 'tap' || action.kind === 'press' ||
      action.kind === 'hold') {
    addSingle(events, request, action.control, duration);
    return duration;
  }
  if (action.kind === 'observe-left') {
    // The mask press comes `maskGapMs` AFTER the vent light is released: the
    // compiler (artifact-commands.ts) places it at at + duration + gap and
    // refuses a gap under one Fusion poll, because a release and a press on
    // the same contact in the same instant can reach the game as a move, not a
    // new touch. Until 2026-09-27 this measured the gap from the read's start
    // (max(0, gap - duration) = 0 for every authored read), so the phone got
    // the mask press with no gap at all and lost it on about half the cycles
    // (night1-ladder-n1a-20260927T053211Z, clear-3 maskOn->false missing 23 of
    // 45), inverting the mask parity for the rest of the night.
    addSingle(events, request, action.control, duration);
    const released = action.maskGapMs ?? 0;
    addDelay(events, released);
    addSingle(events, request, V.mask, 33);
    return duration + released + 33;
  }
  if (action.kind === 'sweep-slot') {
    addSingle(events, request, action.control, action.selectMs);
    addDelay(events, action.settleMs);
    addSingle(events, request, V.cameraFeedLight, action.lightMs);
    return action.selectMs + action.settleMs + action.lightMs;
  }
  if (action.kind === 'compound' && action.compound === 'hallvent') {
    addTwoContact(events, request, V.hallLight, V.rightVentLight, duration);
    return duration;
  }
  if (action.kind === 'compound' && action.compound === 'hallraise') {
    addTwoContact(events, request, V.hallLight, V.monitor, duration);
    return duration;
  }
  if (action.kind === 'compound' && action.compound === 'maskraise') {
    addSingle(events, request, V.mask, 33);
    const gap = action.gapMs ?? 0;
    addDelay(events, Math.max(0, gap - 33));
    addSingle(events, request, action.control === V.hallLight ? V.hallLight : V.monitor, duration);
    return gap + duration;
  }
  if (action.kind === 'compound' && action.compound === 'camdrop') {
    const lightPoint = controlPoint(request, V.cameraFeedLight);
    const monitorPoint = controlPoint(request, V.monitor);
    const lead = action.leadMs ?? 0;
    // camdrop's monitor transition is a second contact. The light is kept
    // active over the monitor press and for its declared tail.
    addReport(events, [{ flags: 3, point: lightPoint }]);
    addDelay(events, lead);
    addReport(events, [{ flags: 3, point: lightPoint }, { flags: 7, point: monitorPoint }]);
    addDelay(events, duration);
    addReport(events, [{ flags: 3, point: lightPoint }, { flags: 4, point: monitorPoint }]);
    addDelay(events, action.tailMs ?? 0);
    addReport(events, [{ flags: 0, point: lightPoint }, { flags: 4, point: monitorPoint }]);
    return lead + duration + (action.tailMs ?? 0);
  }
  fail(`unsupported physical action ${action.kind}/${action.compound ?? ''}`);
}

function actionsOf(block) {
  return block.actions.map(action => ({ action,
    atMs: block.scheduleAtMs + action.atMs - block.atMs }));
}

// One Fusion event-loop poll. A contact that starts on the slot another
// contact left less than this long ago can reach the game as a drag of the
// first touch rather than a new one; the arm's CAM 09 tap and the monitor
// drop 17 ms after its release did exactly that (minus-toys-plan.mjs
// armingGapMs: "collapse to 0 (drag, not two taps)"), and Night 1 minimal
// missed its double-camera arm on every attempt on 2026-09-27
// (night1-ladder-n1c/n1d). The monitor toggle is read through Multiple Touch
// (cameraHitbox, ExtCondition -87/-88/-82 in 04-Office), which answers any
// contact, so such a monitor press goes out on the second contact instead.
// Camera buttons are ObjectClicked -- the mouse, the first contact only -- and
// never move.
export const SECOND_CONTACT_UNDER_MS = 33;

function addSecondContact(events, request, control, duration) {
  const target = controlPoint(request, control);
  if (!Number.isInteger(duration) || duration < 1 || duration > 30000)
    fail(`${control} duration is outside 1..30000 ms`);
  addReport(events, [{ flags: 0, point: target }, { flags: 7, point: target }]);
  addDelay(events, duration);
  addReport(events, [{ flags: 0, point: target }, { flags: 4, point: target }]);
}

function compileActionEvents(request, actions, { originAtMs = 0 } = {}) {
  const events = [];
  let cursor = originAtMs;
  let released = -Infinity;
  for (const { action, atMs } of actions) {
    if (!Number.isFinite(atMs) || atMs < cursor)
      fail(`action ${action.id} overlaps the previous HID macro`);
    addDelay(events, atMs - cursor);
    const single = ['ensure', 'tap', 'press'].includes(action.kind) && action.control === V.monitor;
    if (single && atMs - released < SECOND_CONTACT_UNDER_MS) {
      const duration = action.durationMs ?? 33;
      addSecondContact(events, request, action.control, duration);
      cursor = atMs + duration;
    } else cursor = atMs + addAction(events, request, action);
    released = cursor;
  }
  return { events, cursor };
}

/**
 * Return the point at which an artifact action actually asks the game to
 * change monitor state.  A camdrop starts with a flashlight lead, so treating
 * its block start as the monitor edge would falsely accuse a healthy
 * transition before the monitor contact has even been sent.
 */
function monitorPressAtMs(action, atMs) {
  if (action.kind === 'compound' && action.compound === 'camdrop')
    return atMs + (action.leadMs ?? 0);
  if (action.kind === 'compound' && action.compound === 'maskraise')
    return atMs + (action.gapMs ?? 0);
  return atMs;
}

/**
 * The stream remains semantic at this boundary: retain only authored monitor
 * targets and their actual contact times.  The IDs bind effect samples back
 * to the artifact rather than asking a post-run reader to infer a control
 * from otherwise identical HID DOWN/UP pairs.
 */
function monitorTransitionsOf(actions) {
  return Object.freeze(actions
    .filter(({ action }) => typeof action.targetMonitorUp === 'boolean')
    .map(({ action, atMs }) => Object.freeze({
      actionId: action.id,
      cycle: action.cycle,
      atMs: monitorPressAtMs(action, atMs),
      targetMonitorUp: action.targetMonitorUp,
    }))
    .sort((left, right) => left.atMs - right.atMs || left.actionId.localeCompare(right.actionId)));
}

/** Return the actual contact where an action asks the game to toggle mask. */
function maskPressAtMs(action, atMs) {
  // An observe-left macro holds the vent button first, then presses mask. The
  // target belongs to that latter contact, not the start of the visual read.
  if (action.kind === 'observe-left')
    return atMs + (action.durationMs ?? 33) + (action.maskGapMs ?? 0);
  return atMs;
}

/**
 * Retain authored mask targets beside their real HID contact times.  `true`
 * means the mask should be on; `false` means it should be off.  This is an
 * evidence ledger only and never feeds state back into the scheduled plan.
 */
function maskTransitionsOf(actions) {
  return Object.freeze(actions
    .filter(({ action }) => typeof action.targetMaskOn === 'boolean')
    .map(({ action, atMs }) => Object.freeze({
      actionId: action.id,
      cycle: action.cycle,
      atMs: maskPressAtMs(action, atMs),
      targetMaskOn: action.targetMaskOn,
    }))
    .sort((left, right) => left.atMs - right.atMs || left.actionId.localeCompare(right.actionId)));
}

/**
 * Split the post-arm stream at the points where the authored plan already
 * idles, and record the mask parity the plan believes holds there.
 *
 * A plan's `targetMaskOn` chain is a simulation: `artifact-commands.ts`
 * derives it by toggling a modelled state, so every target after the first
 * missed contact describes a device state that no longer exists. Gating at a
 * cycle boundary is what stops one missed toggle from re-aiming the whole
 * night -- and mask-on and monitor-up are mutually exclusive on device, so
 * one mask observation settles both halves of the parity.
 *
 * Gates are placed only where the idle is wide enough to pay for them, so no
 * authored contact moves. The budget is carved out of that idle, never added
 * to it.
 */
function compileGateSegments(request, actions, originAtMs, {
  minSlackMs = GATE_MIN_SLACK_MS,
  budgetMinMs = GATE_BUDGET_MIN_MS,
  budgetMaxMs = GATE_BUDGET_MAX_MS,
  budgetReserveMs = GATE_BUDGET_RESERVE_MS,
} = {}) {
  const ends = actions.map(({ action, atMs }) =>
    atMs + compileActionEvents(request, [{ action, atMs }]).cursor - atMs);
  const points = [];
  for (let index = 0; index + 1 < actions.length; index += 1) {
    const finishedAtMs = ends[index];
    const nextAtMs = actions[index + 1].atMs;
    if (nextAtMs - finishedAtMs < minSlackMs) continue;
    const budgetMs = Math.max(budgetMinMs,
      Math.min(budgetMaxMs, nextAtMs - finishedAtMs - budgetReserveMs));
    const gateAtMs = nextAtMs - budgetMs;
    if (gateAtMs <= finishedAtMs) continue;
    points.push({ index: index + 1, gateAtMs, budgetMs });
  }
  const segments = [];
  const gates = [];
  let from = 0;
  let cursor = originAtMs;
  for (const point of points) {
    const group = actions.slice(from, point.index);
    const compiled = compileActionEvents(request, group, { originAtMs: cursor });
    if (!group.length) fail('gate split produced an empty stream segment');
    const events = [...compiled.events];
    // Park the stream exactly on the gate instant. The host owns the budget
    // between here and the next authored contact, and nothing else does.
    addDelay(events, point.gateAtMs - compiled.cursor);
    segments.push(Object.freeze(events));
    // The plan's own belief about the mask at this instant is the assertion
    // the gate checks; an unstated belief is not invented here.
    const believed = maskTransitionsOf(actions.slice(0, point.index))
      .filter(transition => transition.atMs <= point.gateAtMs).at(-1);
    const believedMonitor = monitorTransitionsOf(actions.slice(0, point.index))
      .filter(transition => transition.atMs <= point.gateAtMs).at(-1);
    gates.push(Object.freeze({ gateAtMs: point.gateAtMs, budgetMs: point.budgetMs,
      nextActionId: actions[point.index].action.id,
      cycle: actions[point.index].action.cycle,
      believedMaskOn: believed ? believed.targetMaskOn : null,
      believedMonitorUp: believedMonitor ? believedMonitor.targetMonitorUp : null }));
    from = point.index;
    // The host holds the stream for exactly `budgetMs` and releases on the
    // next contact's authored instant, so the resumed segment starts with no
    // lead-in. Compiling it against the gate instead would make every cycle
    // wait the budget twice and drift a further 1200 ms late.
    cursor = actions[point.index].atMs;
  }
  const tail = compileActionEvents(request, actions.slice(from), { originAtMs: cursor });
  segments.push(Object.freeze(tail.events));
  return { segments, gates, cursor: tail.cursor };
}

function compileArmWindow(request, actions) {
  const firstWind = actions.find(({ action }) =>
    action.control === V.wind);
  if (!firstWind) fail('arm-verified schedule has no wind action');

  // The opening prefix ends after the raised-monitor arm. Blocking execution
  // parks here; observe-once execution uses the same boundary only to choose
  // one later frame to inspect without moving the HID stream.
  const openingPrefix = actions.filter(item =>
    item.action.cycle === 'opening' && item.atMs < firstWind.atMs);
  if (openingPrefix.length < 2) fail('arm-verified schedule has no re-armable opening');
  const prefixCompiled = compileActionEvents(request, openingPrefix);
  return Object.freeze({ firstWind, prefix: openingPrefix, prefixCompiled,
    armReadyAtMs: prefixCompiled.cursor });
}

function compileArmSegments(request, actions, register, plan,
  armWindow = compileArmWindow(request, actions), gateTiming = {}) {
  const { firstWind, prefix, prefixCompiled, armReadyAtMs } = armWindow;
  // A minimal Night 1 has a steady CAM 09 flash at 140150 ms and its first
  // wind at 140300 ms. That flash is not part of the arm prefix: it must stay
  // behind the same host gate as the wind, otherwise a missed opening would
  // sit idle until 2 AM before it was allowed to re-arm.
  const remainder = actions.filter(item => !prefix.includes(item));
  if (remainder.some(item => item.atMs < prefix[0].atMs))
    fail('arm-verified schedule has an action before the opening arm');
  const remainderCompiled = compileGateSegments(request, remainder, prefixCompiled.cursor, gateTiming);

  // Re-arm from the already-raised monitor: CAM 11, CAM 09, drop, raise.
  // Keep this derived from the authored opening so the physical retry cannot
  // drift from the policy's own split-arm sequence.
  // Production plans author the camera arm in `opening`; keep the retry
  // sequence tied to that opening rather than any later steady action.
  const rearmStart = prefix[1].atMs;
  const rearmActions = prefix.slice(1).map(item => ({
    ...item, atMs: item.atMs - rearmStart,
  }));
  const rearmCompiled = compileActionEvents(request, rearmActions);
  if (rearmCompiled.cursor < 1) fail('arm re-arm sequence has no physical duration');

  const remainderSegments = remainderCompiled.segments.map(events => [...events]);
  const tail = plan.timing.observeUntilMs - remainderCompiled.cursor;
  if (tail < 0) fail('HID schedule exceeds the observation envelope');
  addDelay(remainderSegments.at(-1), tail);
  // The corrective contact is the plan's own authored mask press, not a
  // coordinate invented for the corrector. A plan with no mask action cannot
  // be parity-corrected, and says so rather than pressing something else.
  const maskAction = remainder.find(({ action }) => action.control === V.mask &&
    typeof action.targetMaskOn === 'boolean');
  const maskCorrection = maskAction
    ? compileActionEvents(request, [{ action: maskAction.action, atMs: 0 }]).events : null;
  // The monitor chain has the same single-miss fragility the mask chain has:
  // one lost monitor press inverts every later toggle (observed on device
  // 2026-09-14, night7-n7-420-minimal-m2: the +5300 monitor tap of cycle 5
  // never raised the monitor, the camdrop then raised it, and every later
  // hall flash landed cams-up and was dropped). The boundary correction for
  // a maskless plan is the plan's own monitor-down tap.
  const monitorDownAction = remainder.find(({ action }) => action.control === V.monitor &&
    action.targetMonitorUp === false);
  const monitorCorrection = monitorDownAction && !maskCorrection
    ? compileActionEvents(request, [{ action: monitorDownAction.action, atMs: 0 }]).events : null;
  return Object.freeze({
    register,
    prefix: Object.freeze(prefixCompiled.events),
    remainderSegments: Object.freeze(remainderSegments.map(events => Object.freeze(events))),
    gates: Object.freeze(remainderCompiled.gates),
    maskCorrection: maskCorrection ? Object.freeze(maskCorrection) : null,
    monitorCorrection: monitorCorrection ? Object.freeze(monitorCorrection) : null,
    rearm: Object.freeze(rearmCompiled.events),
    monitorTransitions: Object.freeze({
      prefix: monitorTransitionsOf(prefix),
      remainder: monitorTransitionsOf(remainder),
      rearm: monitorTransitionsOf(rearmActions),
    }),
    maskTransitions: Object.freeze({
      prefix: maskTransitionsOf(prefix),
      remainder: maskTransitionsOf(remainder),
      rearm: maskTransitionsOf(rearmActions),
    }),
    armReadyAtMs: prefixCompiled.cursor,
    // The authored arm window is also the maximum phase error the route can
    // tolerate. A retry that resumes beyond it cannot claim the same stream.
    phaseBudgetMs: plan.armVerification.untilMs,
    rearmDurationMs: rearmCompiled.cursor,
    firstWindAtMs: firstWind.atMs,
  });
}

/**
 * Compile a validated one-night request to the device-local HID event stream.
 * The returned lines contain only the fixed hid vocabulary and are suitable
 * for one bounded `adb shell sh -s` transfer.
 */
export function compileDeviceLocalHidSchedule(request, {
  readyDelayMs = DEFAULT_READY_DELAY_MS, gateTiming = {},
} = {}) {
  validateExecutorRequest(request);
  // The macros below (hallvent, camdrop, the vent read's mask press, the
  // second-contact monitor) are FNaF 2's physical shapes. The request was
  // validated against its game's action table; only FNaF 2's reaches here.
  const { game } = deviceProfileGame(request.profile);
  if (game !== FNAF2_PACKAGE) fail(`the HID schedule compiles ${FNAF2_PACKAGE} actions, not ${game}`);
  if (request.artifact.plans.length !== 1) fail('one night per execution is required');
  if (!Number.isInteger(readyDelayMs) || readyDelayMs < 1 || readyDelayMs > 30000)
    fail('readyDelayMs must be an integer in 1..30000');
  const night = request.artifact.plans[0].night;
  const blocks = expandNightBlocks(request, night);
  const plan = request.artifact.plans[0];
  const phaseOffsetMs = plan.timing.phaseOffsetMs ?? 0;
  if (!Number.isInteger(phaseOffsetMs) || phaseOffsetMs < 0 || phaseOffsetMs > 2000)
    fail('plan phase offset is outside 0..2000 ms');
  // The offset is applied once at the phone-local night origin. It preserves
  // every authored interval and every gate budget while moving the complete
  // stream against the game's one-second frame grid.
  const actions = blocks.flatMap(actionsOf)
    .map(item => ({ ...item, atMs: item.atMs + phaseOffsetMs }))
    .sort((a, b) => a.atMs - b.atMs || a.action.id.localeCompare(b.action.id));
  const register = line('register', { name: HID_NAME, vid: HID_VID, pid: HID_PID,
    bus: HID_BUS, descriptor: HID_DESCRIPTOR, feature_reports: HID_FEATURE_REPORTS });
  const events = [register];
  addDelay(events, readyDelayMs);
  const compiled = compileActionEvents(request, actions);
  events.push(...compiled.events);
  const cursor = compiled.cursor;
  if (cursor > plan.timing.observeUntilMs) fail('HID schedule exceeds the observation envelope');
  addDelay(events, plan.timing.observeUntilMs - cursor);
  const armWindow = plan.armVerification
    ? compileArmWindow(request, actions) : undefined;
  // The cycle gates are compiled for BOTH arm modes.
  //
  // `observe-once` used to skip compileArmSegments entirely, which silently
  // threw away the per-cycle state gates and the authored mask correction
  // along with the blocking wait. The 2026-09-12 run showed what that costs:
  // zero gates, a mask parity inversion at the 1 AM edge, and nothing left in
  // the run that could repair it -- every later mask press was swallowed.
  //
  // Only the double-camera ARM is observed once. Everything else keeps
  // observing, which is Pedro's standing direction (2026-09-12). The two modes
  // now differ in one thing only: whether the opening prefix is PARKED on the
  // arm observation, which is what costs delivered phase.
  const gated = armWindow
    ? compileArmSegments(request, actions, register, plan, armWindow, gateTiming) : undefined;
  return Object.freeze({ schema: 'device-local-hid-schedule-v1', version: 1, night,
    readyDelayMs, phaseOffsetMs, actionCount: actions.length, plannedUntilMs: plan.timing.observeUntilMs,
    lines: Object.freeze(events), monitorTransitions: monitorTransitionsOf(actions),
    maskTransitions: maskTransitionsOf(actions),
    ...(armWindow ? { armObservation: Object.freeze({ armReadyAtMs: armWindow.armReadyAtMs,
      firstWindAtMs: armWindow.firstWind.atMs }) } : {}),
    ...(gated ? { gated } : {}) });
}
