// Finite reviewed cycle primitives and their fail-closed gate (Plan 20 P4).
//
// A primitive is data, not a callback. The reduced model checks local engine
// locks and animation windows; an explicit exactGate callback must additionally
// attest that the primitive was replayed through the exact engine. Keeping
// those two checks separate prevents a controller-visible approximation from
// being mistaken for a survival proof.
import * as C from '@sixam/source/games/fnaf2/config.ts';
import { REDUCED_SCHEMA, advanceReduced, applyReduced } from '@sixam/source/games/fnaf2/reduced-model.ts';

export const CYCLE_SCHEMA = 'cycle-v1';
export const DEVICE_CONSTRAINTS = Object.freeze({
  // The g56 runner's accepted contact floor and released Fusion poll are
  // measured device constraints; callers may provide a stricter profile.
  minContactMs: 33,
  minReleasedMs: 33,
});

const clone = value => structuredClone(value);
// The sweep cameras are the ones the sourced routine touches (`CYCLE_SCRIPT`:
// CAM 10, CAM 04, CAM 07, then CAM 11 to wind), which are also the rooms four
// of the seven routes pass through.
const ACTIONS = new Set(['monitor', 'mask', 'cam:4', 'cam:7', 'cam:9', 'cam:10',
  'cam:11', 'ventL', 'ventR', 'light', 'wind']);
const CONTROL_FIELDS = new Set(['monitor', 'maskOn', 'viewedCamera', 'winding',
  'lightHeld', 'ventLightL', 'ventLightR']);
const finiteInt = value => Number.isInteger(value) && value >= 0;

function fail(message) { throw new TypeError(`cycle: ${message}`); }

function stateField(state, field) {
  if (field.startsWith('controlUnknown.'))
    return state.controlUnknown[field.slice('controlUnknown.'.length)];
  if (field.startsWith('hazards.'))
    return state.hazards[field.slice('hazards.'.length)]?.state;
  if (CONTROL_FIELDS.has(field)) {
    if (field === 'monitor') return state.monitor === 'up' ? 'up' : state.monitor;
    return state[field];
  }
  return undefined;
}

function checkExpected(state, expected, label) {
  for (const [field, value] of Object.entries(expected ?? {})) {
    if (stateField(state, field) !== value)
      return `${label}:${field} expected ${JSON.stringify(value)}, got ${JSON.stringify(stateField(state, field))}`;
  }
  return null;
}

function validateAction(action, index) {
  if (!action || typeof action !== 'object' || Array.isArray(action))
    fail(`action ${index} is not an object`);
  if (!finiteInt(action.atFrame)) fail(`action ${index} needs a non-negative atFrame`);
  if (action.kind !== 'press' && action.kind !== 'release')
    fail(`action ${index} has invalid kind`);
  if (!ACTIONS.has(action.action)) fail(`action ${index} is unsupported`);
  if (action.contactMs !== undefined &&
      (!Number.isFinite(action.contactMs) || action.contactMs <= 0))
    fail(`action ${index} has invalid contactMs`);
}

export function validateCycle(cycle) {
  if (!cycle || cycle.schema !== CYCLE_SCHEMA || typeof cycle.id !== 'string')
    fail('schema or id is invalid');
  if (!finiteInt(cycle.durationFrames) || cycle.durationFrames <= 0)
    fail('durationFrames must be positive');
  if (!Array.isArray(cycle.prerequisites) || !Array.isArray(cycle.actions) ||
      !Array.isArray(cycle.verifications)) fail('cycle arrays are incomplete');
  if (!cycle.proof || cycle.proof.exactEngineRequired !== true)
    fail('proof.exactEngineRequired must be true');
  for (const [index, action] of cycle.actions.entries()) {
    validateAction(action, index);
    if (action.atFrame > cycle.durationFrames)
      fail(`action ${index} escapes durationFrames`);
  }
  for (let i = 1; i < cycle.actions.length; i++) {
    if (cycle.actions[i].atFrame < cycle.actions[i - 1].atFrame)
      fail('actions are not ordered by frame');
  }
  for (const [index, verification] of cycle.verifications.entries()) {
    if (!finiteInt(verification.atFrame) || verification.atFrame > cycle.durationFrames ||
        !verification.fields || typeof verification.fields !== 'object')
      fail(`verification ${index} is invalid`);
  }
  if (!cycle.cost || typeof cycle.cost !== 'object' ||
      !Array.isArray(cycle.hazardCoverage)) fail('cost/hazard coverage is incomplete');
  return cycle;
}

function primitive({ id, durationFrames, prerequisites, actions, verifications,
  cost, hazardCoverage }) {
  return Object.freeze({
    schema: CYCLE_SCHEMA, id, durationFrames,
    prerequisites: Object.freeze(prerequisites.map(clone)),
    actions: Object.freeze(actions.map(clone)),
    verifications: Object.freeze(verifications.map(clone)),
    cost: Object.freeze(clone(cost)), hazardCoverage: Object.freeze([...hazardCoverage]),
    proof: Object.freeze({ exactEngineRequired: true }),
  });
}

// These are intentionally conservative primitives, not complete strategies.
// They cover reviewed monitor/mask/wind/hall building blocks and leave
// route-specific branches to a later selector package.
export const CYCLE_LIBRARY = Object.freeze([
  primitive({
    id: 'wind-and-anchor', durationFrames: C.s(5),
    prerequisites: [
      { field: 'monitor', equals: 'up' },
      { field: 'maskOn', equals: false },
      { field: 'viewedCamera', equals: C.BOX_CAM },
      { field: 'controlUnknown.monitor', equals: false },
      { field: 'controlUnknown.mask', equals: false },
    ],
    actions: [
      { atFrame: 0, kind: 'press', action: 'wind', contactMs: 33 },
      { atFrame: C.s(4.5), kind: 'release', action: 'wind' },
    ],
    verifications: [{ atFrame: C.s(4.5), fields: { winding: false } }],
    cost: { presses: 1, heldFrames: C.s(4.5), maskFrames: 0, powerFrames: 0 },
    hazardCoverage: ['clock-anchor'],
  }),
  // The same wind, sized to fit inside one hall-flash period.
  //
  // `wind-and-anchor` holds for 4.5 s, which is longer than the whole sourced
  // movement period the hall flash has to be repeated in (`MO_FRAMES`, 5 s).
  // On the late nights that makes the two tasks mutually exclusive: a wind
  // trip guarantees a missed flash, and a flash guarantees the box keeps
  // draining. `CYCLE_SCRIPT`, the routine this project already teaches, solves
  // it by winding INSIDE the period rather than instead of it -- its wind runs
  // 1.50 s to 5.00 s of a five-second cycle. This is that wind: same action,
  // same anchor, a hold that leaves room for the flash and the trip around it.
  primitive({
    id: 'wind-short', durationFrames: C.s(2.5) + 6,
    prerequisites: [
      { field: 'monitor', equals: 'up' },
      { field: 'maskOn', equals: false },
      { field: 'viewedCamera', equals: C.BOX_CAM },
      { field: 'controlUnknown.monitor', equals: false },
      { field: 'controlUnknown.mask', equals: false },
    ],
    actions: [
      { atFrame: 0, kind: 'press', action: 'wind', contactMs: 33 },
      { atFrame: C.s(2.5), kind: 'release', action: 'wind' },
    ],
    verifications: [{ atFrame: C.s(2.5), fields: { winding: false } }],
    cost: { presses: 1, heldFrames: C.s(2.5), maskFrames: 0, powerFrames: 0 },
    hazardCoverage: ['clock-anchor'],
  }),
  primitive({
    id: 'defensive-mask', durationFrames: C.MASK_ANIM_ON + C.s(5),
    prerequisites: [
      { field: 'monitor', equals: 'down' },
      { field: 'maskOn', equals: false },
      { field: 'controlUnknown.monitor', equals: false },
      { field: 'controlUnknown.mask', equals: false },
    ],
    actions: [{ atFrame: 0, kind: 'press', action: 'mask', contactMs: 33 }],
    verifications: [{ atFrame: C.MASK_ANIM_ON, fields: { maskOn: true } }],
    cost: { presses: 1, heldFrames: 0, maskFrames: C.s(5), powerFrames: 0 },
    hazardCoverage: ['visible-office-threat', 'blackout'],
  }),
  // The fast safety mask. `defensive-mask` bakes a five-second hold into its
  // DURATION, which means committing to it: while a cycle is in flight the
  // planner will not replan, so wearing the mask for one second costs the same
  // 5.2 s as wearing it for five. That is the right shape for the sourced
  // five-tick vent repel and the wrong shape for everything else -- clearing
  // Golden Freddy needs only the press, and on the late nights the hall-flash
  // cadence is shorter than the hold.
  //
  // This primitive ends the moment the mask is verifiably on. How long to keep
  // it there then becomes a decision the policy takes at every boundary
  // instead of a number frozen into the library.
  primitive({
    id: 'mask-now', durationFrames: C.MASK_ANIM_ON + 2,
    prerequisites: [
      { field: 'monitor', equals: 'down' },
      { field: 'maskOn', equals: false },
      { field: 'controlUnknown.monitor', equals: false },
      { field: 'controlUnknown.mask', equals: false },
    ],
    actions: [{ atFrame: 0, kind: 'press', action: 'mask', contactMs: 33 }],
    verifications: [{ atFrame: C.MASK_ANIM_ON, fields: { maskOn: true } }],
    cost: { presses: 1, heldFrames: 0, maskFrames: C.MASK_ANIM_ON, powerFrames: 0 },
    hazardCoverage: ['visible-office-threat', 'blackout', 'golden-freddy'],
  }),
  primitive({
    id: 'observe-and-hold', durationFrames: C.s(1),
    prerequisites: [
      { field: 'controlUnknown.monitor', equals: false },
      { field: 'controlUnknown.mask', equals: false },
    ],
    actions: [],
    verifications: [],
    cost: { presses: 0, heldFrames: 0, maskFrames: 0, powerFrames: 0 },
    hazardCoverage: [],
  }),
  primitive({
    // Match the shipped device recipe's 130 ms hall pulse (eight 60 Hz
    // frames) and the reviewed semantic action's short post-release boundary.
    // The previous one-second primitive held the light for 0.55 s: more than
    // four times the measured pulse, consuming the entire Night 7 battery
    // budget merely to maintain the reset cadence while also delaying every
    // reaction behind a full second of in-flight time.
    id: 'foxy-hall-reset', durationFrames: 18,
    prerequisites: [
      { field: 'monitor', equals: 'down' },
      { field: 'maskOn', equals: false },
      { field: 'controlUnknown.monitor', equals: false },
      { field: 'controlUnknown.mask', equals: false },
    ],
    actions: [
      { atFrame: 0, kind: 'press', action: 'light', contactMs: 33 },
      { atFrame: 8, kind: 'release', action: 'light' },
    ],
    verifications: [{ atFrame: 8, fields: { lightHeld: false } }],
    cost: { presses: 1, heldFrames: 8, maskFrames: 0, powerFrames: 8 },
    hazardCoverage: ['foxy-reset'],
  }),
  primitive({
    id: 'verify-and-resume', durationFrames: C.MONITOR_ANIM_UP + 1,
    prerequisites: [
      { field: 'monitor', equals: 'down' },
      { field: 'maskOn', equals: false },
      { field: 'controlUnknown.monitor', equals: false },
      { field: 'controlUnknown.mask', equals: false },
    ],
    actions: [{ atFrame: 0, kind: 'press', action: 'monitor', contactMs: 33 }],
    verifications: [{ atFrame: C.MONITOR_ANIM_UP, fields: { monitor: 'up' } }],
    cost: { presses: 1, heldFrames: 0, maskFrames: 0, powerFrames: 0 },
    hazardCoverage: ['control-verification'],
  }),
  // The three primitives below exist because the library was not closed under
  // its own prerequisites. `wind-and-anchor` demands monitor-up on the box
  // camera, and nothing could establish either; measured 2026-09-02, a Night 1
  // controller driven cycle by cycle selected `observe-and-hold` 241 times and
  // died `death=puppet` at ~4 AM. These add no new timing: every duration is an
  // existing sourced animation constant, and each is one engine-legal tap.
  primitive({
    id: 'select-box-cam', durationFrames: 2,
    prerequisites: [
      { field: 'monitor', equals: 'up' },
      { field: 'maskOn', equals: false },
      { field: 'controlUnknown.monitor', equals: false },
      { field: 'controlUnknown.mask', equals: false },
    ],
    actions: [{ atFrame: 0, kind: 'press', action: `cam:${C.BOX_CAM}`, contactMs: 33 }],
    verifications: [{ atFrame: 0, fields: { viewedCamera: C.BOX_CAM } }],
    cost: { presses: 1, heldFrames: 0, maskFrames: 0, powerFrames: 0 },
    hazardCoverage: ['box-access'],
  }),
  // Lowering clears viewedCamera and winding in the engine; that is the point
  // of a separate primitive rather than a tail on the wind cycle.
  primitive({
    id: 'lower-monitor', durationFrames: C.MONITOR_ANIM_DOWN + 1,
    prerequisites: [
      { field: 'monitor', equals: 'up' },
      { field: 'maskOn', equals: false },
      { field: 'controlUnknown.monitor', equals: false },
      { field: 'controlUnknown.mask', equals: false },
    ],
    actions: [{ atFrame: 0, kind: 'press', action: 'monitor', contactMs: 33 }],
    verifications: [{ atFrame: C.MONITOR_ANIM_DOWN, fields: { monitor: 'down' } }],
    cost: { presses: 1, heldFrames: 0, maskFrames: 0, powerFrames: 0 },
    hazardCoverage: ['office-access'],
  }),
  // The camera flash is the only thing in this library that acts on a
  // character before it reaches an opening, and without it the controller can
  // only ever react at the office door.
  //
  // [SOURCED] Groups 450-457: while the camera light is on, whoever the
  // selected-camera marker overlaps has their B counter loaded with `stun
  // time` -- `STUN_FRAMES` = 400, or 6.7 s against a 5 s movement roll. The
  // stun is written on any frame the light is on, so the light needs to be
  // held only for the device contact floor, not for the length of the look:
  // this whole sweep costs SIX frames of battery, against 33 for one hall
  // flash. The three cameras and their 0.2 s spacing are `CYCLE_SCRIPT`'s
  // cam-10 / cam-04 / cam-07 steps unchanged, and between them they cover an
  // edge on the Withered Freddy, Withered Bonnie, Withered Chica, Toy Freddy,
  // Toy Bonnie, Toy Chica and Mangle routes.
  //
  // Note what this primitive deliberately does NOT do: CAM 08, CAM 09 and CAM
  // 11 are the source's three flash immunities (`viewing` 8 excludes the
  // Withereds, 9 the Toys, 11 Mangle), so sweeping them would look like work
  // and stun nobody.
  primitive({
    id: 'sweep-routes', durationFrames: 32,
    prerequisites: [
      { field: 'monitor', equals: 'up' },
      { field: 'maskOn', equals: false },
      { field: 'controlUnknown.monitor', equals: false },
      { field: 'controlUnknown.mask', equals: false },
    ],
    actions: [
      { atFrame: 0, kind: 'press', action: 'cam:10', contactMs: 33 },
      { atFrame: 2, kind: 'release', action: 'cam:10' },
      { atFrame: 4, kind: 'press', action: 'light', contactMs: 33 },
      { atFrame: 6, kind: 'release', action: 'light' },
      { atFrame: 12, kind: 'press', action: 'cam:4', contactMs: 33 },
      { atFrame: 14, kind: 'release', action: 'cam:4' },
      { atFrame: 16, kind: 'press', action: 'light', contactMs: 33 },
      { atFrame: 18, kind: 'release', action: 'light' },
      { atFrame: 24, kind: 'press', action: 'cam:7', contactMs: 33 },
      { atFrame: 26, kind: 'release', action: 'cam:7' },
      { atFrame: 28, kind: 'press', action: 'light', contactMs: 33 },
      { atFrame: 30, kind: 'release', action: 'light' },
    ],
    verifications: [{ atFrame: 30, fields: { viewedCamera: 7, lightHeld: false } }],
    cost: { presses: 6, heldFrames: 12, maskFrames: 0, powerFrames: 6 },
    hazardCoverage: ['route-stun'],
  }),
  // The office lights are FREE -- only the flashlight drains the battery
  // (g284) -- and a held vent light is three sourced movement blocks at once:
  // it refuses Toy Bonnie's `camsDown` vent entry outright (g428's right-vent
  // gate), it raises the one-second `new bonnie` latch that closes every
  // route edge listed in a character's `lightStallAt`, and it pins hall
  // occupants at the two blind transit markers for 40 more frames (g848-854).
  // The library had no way to spend idle time on any of that.
  //
  // One second, not one movement period: the hold has to end at a boundary
  // where the controller can still react to a blackout, and a 5 s commitment
  // is longer than the sourced hall-flash cadence it has to fit inside.
  primitive({
    id: 'vent-stall-right', durationFrames: C.FPS,
    prerequisites: [
      { field: 'monitor', equals: 'down' },
      { field: 'maskOn', equals: false },
      { field: 'controlUnknown.monitor', equals: false },
      { field: 'controlUnknown.mask', equals: false },
    ],
    actions: [
      { atFrame: 0, kind: 'press', action: 'ventR', contactMs: 33 },
      { atFrame: C.FPS - 1, kind: 'release', action: 'ventR' },
    ],
    verifications: [{ atFrame: C.FPS - 1, fields: { ventLightR: false } }],
    cost: { presses: 1, heldFrames: C.FPS - 1, maskFrames: 0, powerFrames: 0 },
    hazardCoverage: ['vent-entry-stall', 'route-stall'],
  }),
  // While the mask is on or animating the engine accepts no other action, so
  // without this the defensive mask is a terminal state for the controller.
  primitive({
    id: 'unmask', durationFrames: C.MASK_ANIM_OFF + 1,
    prerequisites: [
      { field: 'maskOn', equals: true },
      { field: 'controlUnknown.mask', equals: false },
    ],
    actions: [{ atFrame: 0, kind: 'press', action: 'mask', contactMs: 33 }],
    verifications: [{ atFrame: C.MASK_ANIM_OFF, fields: { maskOn: false } }],
    cost: { presses: 1, heldFrames: 0, maskFrames: 0, powerFrames: 0 },
    hazardCoverage: ['mask-release'],
  }),
]);

for (const cycle of CYCLE_LIBRARY) validateCycle(cycle);

export function getCycle(id) {
  const found = CYCLE_LIBRARY.find(cycle => cycle.id === id);
  return found ? clone(found) : null;
}

function gateContact(actions, constraints, reasons) {
  const minContact = constraints.minContactMs;
  const minReleased = constraints.minReleasedMs;
  let lastPress = null;
  let lastRelease = null;
  for (const action of actions) {
    if (action.kind === 'press') {
      if (minContact !== undefined && (action.contactMs ?? 0) < minContact)
        reasons.push(`contact-floor:${action.action}:${action.contactMs ?? 0}<${minContact}`);
      if (lastPress && lastRelease === null && lastPress.action !== action.action)
        reasons.push(`missing-release:${lastPress.action}->${action.action}`);
      if (lastRelease !== null && minReleased !== undefined &&
          (action.atFrame - lastRelease) * 1000 / C.FPS < minReleased)
        reasons.push(`released-gap:${action.action}`);
      lastPress = action;
      lastRelease = null;
    } else if (lastPress && action.action === lastPress.action) {
      lastRelease = action.atFrame;
    }
  }
}

/**
 * Gate one primitive from a current reduced-model state. The result is a
 * readable record even on rejection, so the planner can retain why a move was
 * not legal instead of retrying it blindly.
 */
export function gateCycle(cycle, input, {
  constraints = DEVICE_CONSTRAINTS, exactGate = null,
} = {}) {
  const reasons = [];
  let state = clone(input);
  try {
    validateCycle(cycle);
    if (!state || state.schema !== REDUCED_SCHEMA) fail('initial state schema mismatch');
    for (const prerequisite of cycle.prerequisites) {
      if (stateField(state, prerequisite.field) !== prerequisite.equals)
        reasons.push(`prerequisite:${prerequisite.field}=${JSON.stringify(stateField(state, prerequisite.field))}`);
    }
    gateContact(cycle.actions, constraints ?? {}, reasons);
    const originFrame = state.frame;
    let lastFrame = originFrame;
    let lastOffset = -Infinity;
    for (const action of cycle.actions) {
      if (action.atFrame < lastOffset) reasons.push(`time-reversed:${action.action}`);
      const at = Math.max(lastFrame, originFrame + action.atFrame);
      state = advanceReduced(state, at);
      if (action.kind === 'press' &&
          ((action.action === 'monitor' && state.monitorAnim > 0) ||
           (action.action === 'mask' && state.maskAnim > 0)))
        reasons.push(`animation-window:${action.action}@${action.atFrame}`);
      const result = applyReduced(state, action.action, action.kind);
      if (!result.accepted) reasons.push(`engine-rejected:${action.action}:${result.reason}`);
      state = result.state;
      lastFrame = at;
      lastOffset = action.atFrame;
    }
    for (const verification of cycle.verifications) {
      state = advanceReduced(state, Math.max(state.frame, originFrame + verification.atFrame));
      const mismatch = checkExpected(state, verification.fields,
        `verification@${verification.atFrame}`);
      if (mismatch) reasons.push(mismatch);
    }
    if (exactGate === null) reasons.push('exact-model-gate-missing');
    else {
      const proof = exactGate(cycle);
      if (proof !== true && proof?.accepted !== true)
        reasons.push(`exact-model-gate:${proof?.reason ?? 'rejected'}`);
    }
  } catch (error) {
    reasons.push(error.message);
  }
  return {
    schema: 'cycle-decision-v1', cycleId: cycle?.id ?? null,
    accepted: reasons.length === 0, reasons, finalState: state,
    record: {
      cycleId: cycle?.id ?? null, accepted: reasons.length === 0,
      reasons: [...reasons], cost: cycle?.cost ?? null,
      hazardCoverage: cycle?.hazardCoverage ?? [],
    },
  };
}
