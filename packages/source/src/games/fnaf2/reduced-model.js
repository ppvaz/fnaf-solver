// Small, plain-data transition model for Plan 20 package 2.
//
// This is intentionally not a second game engine. It owns only the facts a
// controller can predict or verify at a cycle boundary: input locks,
// monitor/mask animation, box/power resource motion, and coarse hazard/risk
// labels. Hidden RNG state and character positions stay UNKNOWN/risk buckets.
import * as C from './config.js';

export const REDUCED_SCHEMA = 'reduced-v1';
export const ROUTE_RISK = Object.freeze(['unknown', 'absent', 'possible', 'opening', 'inside']);

const clone = value => structuredClone(value);
const MONITOR = Object.freeze({ DOWN: 'down', LOWERING: 'lowering', UP: 'up', RAISING: 'raising' });

export function initialReducedState({ night = 7, frame = 0, box = 1,
                                      power = C.powerFrames(night) } = {}) {
  return {
    schema: REDUCED_SCHEMA, night, frame,
    monitor: MONITOR.DOWN, monitorAnim: 0,
    maskOn: false, maskAnim: 0,
    viewedCamera: null, lastViewedCamera: null, hasViewedCamera: false, winding: false,
    lightHeld: false, ventLightL: false, ventLightR: false,
    box, power,
    // D under the HALL hypothesis: the value that decides `got you` if Foxy is
    // standing in the hall, which is the only place he can lock on. A hall
    // flash zeroes it there. The parts hypothesis -- where the same light only
    // decays D by one per 30 frames -- is deliberately not carried as a second
    // number, because a parts D is not lethal on its own; what it costs is an
    // ARRIVAL, and `lastHallLightFrame` is what bounds the damage an arrival
    // can do (see the policy's five-second cap).
    foxyD: 0,
    lastHallLightFrame: -1,
    // The last frame a CAMERA flash landed. The same button is the hall light
    // monitor-down and the camera light monitor-up, and the two do completely
    // different things: one zeroes Foxy's D, the other loads a 400-frame stun
    // into whoever the selected-camera marker overlaps. A policy that wants to
    // keep a route stunned has to know when the stun was last refreshed.
    lastCameraFlashFrame: -1,
    // Self-state, in the same family as `lastViewedCamera`: when this
    // controller last had each control in its dangerous or protective
    // position. A policy needs both to answer "has the office been open since
    // I last wore the mask?", which is exactly the Golden Freddy question --
    // he can only appear while the monitor is up and the mask press clears him
    // outright, and nothing observable says whether he is there.
    lastMaskOnFrame: -1,
    lastMonitorUpFrame: -1,
    // The frame the CURRENT mask period began, or -1 while it is off. The
    // sourced vent repel is five continuous one-second ticks, so a policy that
    // wants it has to know how long this mask has been worn, not merely that
    // it is on.
    maskSinceFrame: -1,
    // The most recently COMPLETED mask period: how long it ran and the frame
    // it ended. `maskSinceFrame` answers "how long have I been wearing this
    // one"; these two answer "have I already paid a full repel, and was it
    // after the cue I am looking at". Both are self-state in the same family
    // as `lastMaskOnFrame` -- nothing here knows what a repel costs, which is
    // a policy quantity.
    lastMaskRunFrames: 0,
    lastMaskOffFrame: -1,
    controlUnknown: { monitor: true, mask: true },
    hazards: {
      blackout: { state: 'unknown', deadlineFrame: -1 },
      opening: { state: 'unknown', observedAtFrame: -1 },
    },
    routeRisk: { bb: 'unknown', mangle: 'unknown' },
    incidents: [],
  };
}

export const isMonitorUp = state => state.monitor === MONITOR.UP;
export const isMaskFullyOn = state => state.maskOn && state.maskAnim === 0;
export const isMaskFullyOff = state => !state.maskOn && state.maskAnim === 0;

function record(state, type, data = {}) {
  state.incidents.push({ type, frame: state.frame, ...data });
}

function stepAnimation(state) {
  if (state.monitorAnim > 0 && --state.monitorAnim === 0) {
    if (state.monitor === MONITOR.RAISING) {
      state.monitor = MONITOR.UP;
      if (!state.hasViewedCamera) {
        state.viewedCamera = C.initialCamera(state.night);
        state.hasViewedCamera = true;
      } else if (state.lastViewedCamera !== null) {
        state.viewedCamera = state.lastViewedCamera;
      }
    }
    else if (state.monitor === MONITOR.LOWERING) {
      state.monitor = MONITOR.DOWN;
      state.viewedCamera = null;
    }
  }
  if (state.maskAnim > 0 && --state.maskAnim === 0 && state.maskOn)
    state.viewedCamera = null;
  if (state.viewedCamera !== null && state.frame % C.LAST_VIEW_SAMPLE_FRAMES === 0)
    state.lastViewedCamera = state.viewedCamera;
}

function stepSelfState(state) {
  if (isMonitorUp(state)) state.lastMonitorUpFrame = state.frame;
  if (state.maskOn) {
    state.lastMaskOnFrame = state.frame;
    if (state.maskSinceFrame < 0) state.maskSinceFrame = state.frame;
  } else {
    if (state.maskSinceFrame >= 0) {
      state.lastMaskRunFrames = state.frame - state.maskSinceFrame;
      state.lastMaskOffFrame = state.frame;
    }
    state.maskSinceFrame = -1;
  }
}

function stepResources(state) {
  const winding = state.winding && isMonitorUp(state) && state.viewedCamera === C.BOX_CAM;
  if (winding) {
    state.box = Math.min(1, Math.max(state.box, C.BOX_SNAP) + 1 / C.BOX_WIND_FRAMES);
  } else if (C.boxDrainsAtHour(state.night, Math.floor(state.frame / C.HOUR_FRAMES))) {
    state.box = Math.max(0, state.box - 1 / C.boxDrainFrames(state.night));
  }
  if (state.lightHeld && !state.maskOn) state.power = Math.max(0, state.power - 1);
  // A held hall light is a hall flash for as long as it is held, not only on
  // its press: record the last frame one was actually lighting the hall.
  if (state.lightHeld && !state.maskOn && !isMonitorUp(state))
    state.lastHallLightFrame = state.frame;
  if (state.lightHeld && !state.maskOn && isMonitorUp(state) &&
      state.viewedCamera !== null)
    state.lastCameraFlashFrame = state.frame;
  // Foxy's D as an UPPER bound on the lethal path. The engine advances it once
  // a second whenever no blackout covers the tick, with no mask condition at
  // all, and a SECOND time per second while the mask is on and no vent opening
  // is occupied.
  //
  // Corrected 2026-09-02. This accumulator ran only while UNMASKED and called
  // itself a lower bound. Both halves were wrong in the optimistic direction:
  // it dropped the base tick for the whole of a mask camp and the mask
  // acceleration with it, so a controller pricing a Foxy budget off this state
  // believed camping in the mask was free of Foxy risk when it is in fact
  // twice as expensive as standing in the office. Opening occupancy is not
  // observable, so the mask term is applied unconditionally: that can only
  // over-state D, which is the safe direction for a budget.
  const foxyDormant = state.night === 1 ||
    (state.night === 2 && state.frame < 2 * C.HOUR_FRAMES);
  if (state.hazards.blackout.state !== 'active' && !foxyDormant &&
      state.frame % C.FPS === 0) {
    state.foxyD++;
    if (state.maskOn) state.foxyD++;
  }
}

// Predict one or more frames. `state.frame` is the frame before the next
// engine tick, matching Sim.tick()'s ++frame convention.
export function advanceReduced(input, targetFrame) {
  const state = clone(input);
  if (!Number.isInteger(targetFrame) || targetFrame < state.frame)
    throw new RangeError('reduced model time must move forward in whole frames');
  while (state.frame < targetFrame) {
    state.frame++;
    stepAnimation(state);
    stepSelfState(state);
    stepResources(state);
  }
  return state;
}

export function actionAllowed(state, action) {
  if (typeof action !== 'string') return false;
  if (action === 'release') return true;
  // The off press clears maskOn immediately but the mask surface remains in
  // its lowering animation until maskAnim reaches zero. No later control is
  // usable during that interval; keep the reduced model aligned with Sim and
  // the phone-visible input lock.
  if ((state.maskOn || state.maskAnim > 0) && action !== 'mask') return false;
  // A monitor toggle during either monitor animation is not a reversal; the
  // source setMonitor() refuses it and leaves the current transition intact.
  if (action === 'monitor' && state.monitorAnim > 0) return false;
  if (action === 'mask' && !state.maskOn &&
      (state.monitor === MONITOR.UP || state.monitor === MONITOR.RAISING)) return false;
  // These physical controls have no useful surface in the opposite monitor
  // state.  The source may retain the pressed bit for wind/vent, but the
  // effect is impossible, so the reduced gate must not call that a success.
  if (action === 'wind' && !isMonitorUp(state)) return false;
  if ((action === 'ventL' || action === 'ventR') && state.monitor !== MONITOR.DOWN)
    return false;
  if (action.startsWith('cam:') && !isMonitorUp(state)) return false;
  if (!['monitor', 'mask', 'wind', 'light', 'ventL', 'ventR'].includes(action) &&
      !action.startsWith('cam:')) return false;
  return true;
}

function setMonitor(state, up) {
  if (up && (state.monitor === MONITOR.UP || state.monitor === MONITOR.RAISING)) return false;
  if (!up && (state.monitor === MONITOR.DOWN || state.monitor === MONITOR.LOWERING)) return false;
  if (up) {
    state.monitor = MONITOR.RAISING;
    state.monitorAnim = C.MONITOR_ANIM_UP;
  } else {
    state.monitor = MONITOR.LOWERING;
    state.monitorAnim = C.MONITOR_ANIM_DOWN;
    state.viewedCamera = null;
    state.winding = false;
  }
  return true;
}

// Apply an engine-semantic action at the state's current frame. Returns a
// structured acceptance result so callers can log rejected inputs instead of
// assuming that a press executed.
export function applyReduced(input, action, kind = 'press') {
  const state = clone(input);
  if (kind === 'release') {
    if (action === 'light') state.lightHeld = false;
    else if (action === 'wind') state.winding = false;
    else if (action === 'ventL') state.ventLightL = false;
    else if (action === 'ventR') state.ventLightR = false;
    return { state, accepted: true, reason: null };
  }
  if (!actionAllowed(state, action)) {
    record(state, 'action-rejected', { action, reason: 'engine-input-lock' });
    return { state, accepted: false, reason: 'engine-input-lock' };
  }
  if (action === 'mask') {
    state.maskOn = !state.maskOn;
    state.maskAnim = state.maskOn ? C.MASK_ANIM_ON : C.MASK_ANIM_OFF;
  } else if (action === 'monitor') {
    setMonitor(state, !(state.monitor === MONITOR.UP || state.monitor === MONITOR.RAISING));
  } else if (action === 'wind') state.winding = true;
  else if (action === 'light') {
    state.lightHeld = true;
    // The hall light zeroes D outright while Foxy is standing in the hall, and
    // the hall is the only place he can lock on: a hall flash is a D reset on
    // the lethal path. While he is in parts the same light only decays D by
    // one per 30 frames, which this deliberately does not model, because a
    // parts D cannot kill -- it can only bring his arrival forward.
    if (!isMonitorUp(state) && !state.maskOn) state.foxyD = 0;
  }
  else if (action === 'ventL') state.ventLightL = true;
  else if (action === 'ventR') state.ventLightR = true;
  else if (action.startsWith('cam:')) {
    state.viewedCamera = +action.slice(4);
    state.hasViewedCamera = true;
  }
  else record(state, 'action-rejected', { action, reason: 'unknown-action' });
  return { state, accepted: true, reason: null };
}

function updateFact(state, name, fact) {
  if (!fact || (fact.state !== 'OBSERVED' && fact.state !== 'UNKNOWN'))
    throw new TypeError(`invalid reduced fact: ${name}`);
  if (fact.state === 'UNKNOWN') {
    state.controlUnknown[name === 'monitorUp' ? 'monitor' : name === 'maskOn' ? 'mask' : name] = true;
    return;
  }
  // An observed control state CORRECTS the prediction; it does not merely mark
  // it known. The engine moves both controls with no press behind them --
  // g718-721 slam the monitor down on a ten-second boundary while a streak
  // attacker waits at marker 122, and g262/g274's forcedown takes the mask
  // with it -- so a predicted `up` that the sensor reports down is not a
  // sensor fault, it is the game.
  //
  // This is the closed loop's whole point and it was missing. Measured
  // 2026-09-02, Night 1 seed 11: a forcedown at ~f=23800 left the controller
  // predicting `monitor: up` for the remaining 24 s while the engine had it
  // down, and 274 decision boundaries were then spent in verification lockout
  // with the monitor stuck open. Mid-animation reads arrive UNKNOWN, so this
  // can only ever correct a settled disagreement, never race an animation.
  if (name === 'monitorUp') {
    state.controlUnknown.monitor = false;
    if (fact.value === true && state.monitor === MONITOR.DOWN) {
      state.monitor = MONITOR.UP;
      state.monitorAnim = 0;
      if (!state.hasViewedCamera) {
        state.viewedCamera = C.initialCamera(state.night);
        state.hasViewedCamera = true;
      } else if (state.lastViewedCamera !== null) {
        state.viewedCamera = state.lastViewedCamera;
      }
      record(state, 'control-corrected', { control: 'monitor', to: 'up' });
    } else if (fact.value === false && state.monitor === MONITOR.UP) {
      state.monitor = MONITOR.DOWN;
      state.monitorAnim = 0;
      state.viewedCamera = null;
      state.winding = false;
      record(state, 'control-corrected', { control: 'monitor', to: 'down' });
    }
  }
  if (name === 'maskOn') {
    state.controlUnknown.mask = false;
    // The fact is the fully-on state, so it is only comparable once this
    // model's own mask animation has settled.
    if (state.maskAnim === 0 && fact.value !== state.maskOn) {
      state.maskOn = fact.value === true;
      record(state, 'control-corrected', { control: 'mask', to: state.maskOn });
    }
  }
  // The office fuse starts when the encounter starts, so its deadline is set
  // on the RISING edge only. Re-stamping it on every read of a blackout that
  // is still up would push the deadline forward once per observation and make
  // a fuse that has already burned look like one that has not.
  if (name === 'blackout') {
    const active = fact.value === true;
    const wasActive = state.hazards.blackout.state === 'active';
    state.hazards.blackout = {
      state: active ? 'active' : 'clear',
      deadlineFrame: !active ? -1
        : wasActive ? state.hazards.blackout.deadlineFrame
        : state.frame + C.maskGraceFrames(state.night),
    };
  }
  if (name === 'leftOpening') state.hazards.opening = {
    state: fact.value, observedAtFrame: state.frame,
  };
  // The box gauge is directly legible on the CAM 11 feed, so an observed pie
  // CORRECTS the dead-reckoned level instead of running beside it. Everywhere
  // else it stays UNKNOWN and the prediction carries on undisturbed.
  if (name === 'boxPie' && Number.isFinite(fact.value))
    state.box = Math.max(0, Math.min(1, fact.value));
  if (name === 'bbVent' && ROUTE_RISK.includes(fact.value)) state.routeRisk.bb = fact.value;
  if (name === 'mangleOpening' && ROUTE_RISK.includes(fact.value)) state.routeRisk.mangle = fact.value;
}

// Apply sensor facts without turning UNKNOWN into a negative claim. The
// current value is deliberately represented by controlUnknown; callers may
// still use the last verified physical state held elsewhere in their belief.
export function observeReduced(input, facts, { frame = input.frame } = {}) {
  const state = advanceReduced(input, frame);
  for (const [name, fact] of Object.entries(facts ?? {})) updateFact(state, name, fact);
  return state;
}

export function reduceCycle(input, { actions = [], observations = [] } = {}) {
  let state = clone(input);
  const events = [...actions.map(event => ({ ...event, kind: event.kind ?? 'press' })),
                  ...observations.map(event => ({ ...event, kind: 'observation' }))]
    .sort((a, b) => a.frame - b.frame || (a.kind === 'observation' ? 1 : -1));
  for (const event of events) {
    state = advanceReduced(state, event.frame);
    state = event.kind === 'observation'
      ? observeReduced(state, event.facts)
      : applyReduced(state, event.action, event.kind).state;
  }
  return state;
}
