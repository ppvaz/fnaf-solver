// Finite structural grammar for policy-v1 (Plan 21 package 3).
//
// The grammar owns legal phase shape and engine-action ordering.  It does not
// claim that every syntactically legal policy survives a model gate; that is
// the next search package.  Setup targets are named so a candidate cannot
// smuggle in an unsourced opening as an anonymous list of taps.
import {
  BRANCH_SCHEMA, POLICY_SCHEMA, canonicalPolicy, validateBranch, validatePolicy,
} from '@sixam/propose/policy';
import { minimalPolicy } from './policy-ir.ts';

export const GRAMMAR_SCHEMA = 'policy-grammar-v1';
export const PHASE_ORDER = Object.freeze(['idle', 'setup', 'repeat', 'finish', 'observe']);
export const SETUP_TARGETS = Object.freeze({
  'minus-toys-split': Object.freeze({ family: 'minus-toys', nights: [1] }),
});

const finite = value => Number.isFinite(value);
const clone = value => structuredClone(value);
const TRANSITIONS = new Set(['monitor', 'mask']);
const CAMERAS = new Set(['cam9', 'cam11']);

function fail(message) { throw new TypeError(`policy grammar: ${message}`); }

function actionAt(action, repeat) {
  const key = repeat ? 'offsetMs' : 'atMs';
  if (action[key] === undefined) fail(`${key} is required for ${action.action}`);
  if (repeat ? action.atMs !== undefined : action.offsetMs !== undefined)
    fail(`repeat and absolute action times cannot be mixed (${action.action})`);
  if (!finite(action[key]) || action[key] < 0)
    fail(`action time must be non-negative (${action.action})`);
  return action[key];
}

function actionSpan(action) {
  const mode = action.mode ?? 'tap';
  if (mode === 'camdrop') {
    for (const key of ['leadMs', 'durationMs', 'tailMs'])
      if (!finite(action[key]) || action[key] < 0) fail(`camdrop needs ${key}`);
    return action.leadMs + action.durationMs + action.tailMs;
  }
  if (mode === 'hold' || mode === 'hall') {
    if (!finite(action.durationMs) || action.durationMs <= 0)
      fail(`${mode} needs a positive durationMs`);
    return action.durationMs;
  }
  if (mode !== 'tap') fail(`unsupported action mode ${mode}`);
  return action.contactMs ?? 0;
}

function checkAction(action, { repeat, phase, index }) {
  const label = `${phase} action ${index}`;
  if (!action || typeof action !== 'object' || Array.isArray(action)) fail(`${label} is not an object`);
  if (!['monitor', 'mask', 'cam9', 'cam11', 'ventl', 'light', 'wind', 'hall']
      .includes(action.action)) fail(`${label} has an unsupported action`);
  const at = actionAt(action, repeat);
  const mode = action.mode ?? 'tap';
  const span = actionSpan(action);
  if (action.action === 'hall' && mode !== 'hall') fail(`${label} hall must use hall mode`);
  if (mode === 'hall' && action.action !== 'hall') fail(`${label} hall mode must use hall action`);
  if (mode === 'camdrop' && action.action !== 'monitor')
    fail(`${label} camdrop must be a monitor action`);
  if (CAMERAS.has(action.action) && mode !== 'tap')
    fail(`${label} camera selection must be a tap`);
  if (TRANSITIONS.has(action.action) && mode !== 'tap')
    fail(`${label} monitor/mask transitions must be taps`);
  return { action, at, span, end: at + span };
}

function checkPhaseActions(phase, repeat) {
  const actions = phase.actions ?? [];
  if (!Array.isArray(actions)) fail(`${phase.id} actions must be an array`);
  const checked = actions.map((action, index) => checkAction(action, {
    repeat, phase: phase.id, index,
  }));
  for (let i = 1; i < checked.length; i++) {
    if (checked[i].at < checked[i - 1].at)
      fail(`${phase.id} actions are not ordered by time`);
    if (checked[i - 1].end > checked[i].at)
      fail(`${phase.id} actions overlap at ${checked[i].at}ms`);
  }
  return checked;
}

function applySymbolicAction(state, checked, phase) {
  const { action } = checked;
  const mode = action.mode ?? 'tap';
  if (mode === 'camdrop') {
    if (!state.monitorUp) fail(`${phase}: camdrop requires the monitor up`);
    if (state.maskOn) fail(`${phase}: camdrop cannot start while the mask is on`);
    state.monitorUp = false;
    state.camera = null;
    return;
  }
  if (action.action === 'monitor') {
    state.monitorUp = !state.monitorUp;
    if (!state.monitorUp) state.camera = null;
    return;
  }
  if (action.action === 'mask') {
    if (!state.maskOn && state.monitorUp)
      fail(`${phase}: mask-on requires the monitor to be down`);
    state.maskOn = !state.maskOn;
    return;
  }
  if (state.maskOn) fail(`${phase}: ${action.action} is blocked while the mask is on`);
  if (CAMERAS.has(action.action)) {
    if (!state.monitorUp) fail(`${phase}: ${action.action} requires the monitor up`);
    state.camera = Number(action.action.slice(3));
    return;
  }
  if (action.action === 'ventl' || action.action === 'light' || action.action === 'wind') {
    if (!state.monitorUp) fail(`${phase}: ${action.action} requires the monitor up`);
    return;
  }
  if (action.action === 'hall') {
    if (state.monitorUp || state.maskOn)
      fail(`${phase}: hall requires monitor down and mask off`);
    return;
  }
  fail(`${phase}: unknown action ${action.action}`);
}

function checkTiming(phases, checked) {
  const byId = new Map(checked.map(({ phase, actions }) => [phase.id, actions]));
  for (const phase of phases) {
    const actions = byId.get(phase.id) ?? [];
    if (phase.kind === 'repeat') {
      for (const item of actions) {
        if (item.end > phase.periodMs)
          fail(`repeat action ${item.action.action} escapes its period`);
      }
    } else if (phase.kind === 'setup') {
      for (const item of actions) {
        if (item.at < phase.startMs || item.at > phase.endMs)
          fail(`setup action ${item.action.action} is outside its phase`);
        if (item.end > phase.endMs)
          fail(`setup action ${item.action.action} escapes its phase`);
      }
    } else if (phase.kind === 'finish') {
      for (const item of actions) {
        // A terminal tap is a press at the boundary; its physical contact is
        // owned by the driver and may finish during the hands-off tail. Holds
        // and compound camdrops, however, must be complete by the boundary.
        const tap = (item.action.mode ?? 'tap') === 'tap';
        if (item.at > phase.endMs || (!tap && item.end > phase.endMs))
          fail(`finish action ${item.action.action} is after the terminal boundary`);
      }
    }
  }
}

function checkOrdering(phases, checked) {
  const state = { monitorUp: false, maskOn: false, camera: null };
  for (const phase of phases) {
    const actions = checked.find(item => item.phase.id === phase.id)?.actions ?? [];
    if (phase.kind === 'idle' || phase.kind === 'observe') {
      if (actions.length) fail(`${phase.kind} phases cannot emit actions`);
      continue;
    }
    const entryState = clone(state);
    for (const item of actions) applySymbolicAction(state, item, phase.id);
    if (phase.kind === 'repeat') {
      // A branch may re-select the viewed camera; both arms agree on which,
      // so the body's end state stays determined.
      const exit: any = checkBranches(phase, actions, entryState);
      if (Object.hasOwn(exit, 'camera')) state.camera = exit.camera;
      // A body is repeated indefinitely.  Requiring its symbolic control state
      // to close prevents a one-mask/one-monitor body from alternating hidden
      // state on every iteration.
      const after = clone(state);
      for (const item of actions) applySymbolicAction(state, item, phase.id);
      if (JSON.stringify(state) !== JSON.stringify(after))
        fail(`${phase.id} body does not close its monitor/mask state`);
      state.monitorUp = after.monitorUp;
      state.maskOn = after.maskOn;
      state.camera = after.camera;
    }
  }
}

// --- Observation-conditioned branches (Plan 05 package 6b) --------------
//
// A branch is the one construct policy-v1 was missing: a decision point inside
// the repeat body that reads a fact and takes one of two reviewed arms. The
// measured-budget half of the rules lives in core's observation language; the
// engine-shaped half lives here.
//
// Reconvergence, in two parts:
//
//  - both arms must leave the SAME symbolic state, so everything scheduled
//    after the branch is deterministic whichever arm ran; and
//  - that state's monitor/mask mode must equal the decision point's, so the
//    body's own close-your-state rule still holds.
//
// The viewed camera may differ from the decision point -- re-selecting a
// camera is the point of a branch -- because no action's legality depends on
// which camera is viewed, only on the monitor being up.
function checkBranchArm(branch, arm, name, stateAtDecision, phaseId) {
  const label = `${phaseId} branch ${branch.id} ${name}`;
  const checked = arm.map((action, index) => checkAction(
    { ...action, offsetMs: action.offsetMs }, { repeat: true, phase: label, index }));
  for (let i = 1; i < checked.length; i++) {
    if (checked[i - 1].end > checked[i].at) fail(`${label} actions overlap`);
  }
  const state = clone(stateAtDecision);
  for (const item of checked) applySymbolicAction(state, item, label);
  if (state.monitorUp !== stateAtDecision.monitorUp || state.maskOn !== stateAtDecision.maskOn)
    fail(`${label} does not restore the monitor/mask state it started from`);
  return { end: checked.length ? checked[checked.length - 1].end : 0, state };
}

function checkBranches(phase, unconditional, entryState) {
  const branches = phase.branches ?? [];
  if (!Array.isArray(branches)) fail(`${phase.id} branches must be an array`);
  if (branches.length && phase.kind !== 'repeat')
    fail(`${phase.id}: branches are only defined inside a repeat body`);
  const ids = new Set();
  const windows = [];
  const exit: any = {};
  for (const branch of branches) {
    validateBranch(branch);
    if (ids.has(branch.id)) fail(`${phase.id} has duplicate branch id ${branch.id}`);
    ids.add(branch.id);
    // Replay the unconditional body from the state the body is entered in, up
    // to the decision point, to learn the symbolic state the arms start from.
    const state = clone(entryState);
    for (const item of unconditional) {
      if (item.at > branch.atMs) break;
      applySymbolicAction(state, item, phase.id);
    }
    const taken = checkBranchArm(branch, branch.then, 'then', state, phase.id);
    const skipped = checkBranchArm(branch, branch.otherwise, 'otherwise', state, phase.id);
    if (JSON.stringify(taken.state) !== JSON.stringify(skipped.state))
      fail(`${phase.id} branch ${branch.id} arms leave different control states`);
    exit.camera = taken.state.camera;
    const span = Math.max(taken.end, skipped.end);
    const window = { start: branch.atMs, end: branch.atMs + span, id: branch.id };
    if (window.end > phase.periodMs)
      fail(`${phase.id} branch ${branch.id} escapes its period`);
    for (const item of unconditional) {
      if (item.at < window.end && item.end > window.start)
        fail(`${phase.id} branch ${branch.id} overlaps unconditional ${item.action.action}`);
    }
    for (const other of windows) {
      if (window.start < other.end && window.end > other.start)
        fail(`${phase.id} branch ${branch.id} overlaps branch ${other.id}`);
    }
    windows.push(window);
  }
  return exit;
}

/** Validate policy-v1 against the finite, engine-shaped structural grammar. */
export function validateGrammarPolicy(program) {
  validatePolicy(program);
  const target = program.metadata.setupTarget;
  if (!target || !SETUP_TARGETS[target]) fail('metadata.setupTarget is not a sourced target');
  if (program.phases.length !== PHASE_ORDER.length ||
      program.phases.some((phase, i) => phase.kind !== PHASE_ORDER[i]))
    fail(`phases must be ${PHASE_ORDER.join(',')}`);
  const checked = [];
  for (const phase of program.phases) {
    const actions = checkPhaseActions(phase, phase.kind === 'repeat');
    checked.push({ phase, actions });
    if (phase.branches !== undefined && phase.kind !== 'repeat')
      fail(`${phase.id}: branches are only defined inside a repeat body`);
    if (phase.kind === 'repeat') {
      if (phase.endMs <= phase.startMs) fail('repeat phase must have positive duration');
      if (phase.periodMs > phase.endMs - phase.startMs)
        fail('repeat period cannot exceed repeat phase duration');
    }
  }
  checkTiming(program.phases, checked);
  checkOrdering(program.phases, checked);
  return program;
}

/** Construct a canonical five-phase program from grammar moves. */
export function buildPolicy({ metadata, idleEndMs, loopStartMs, loopEndMs,
  periodMs, observeUntilMs, setupActions = [], repeatActions = [],
  repeatBranches = [], finishActions = [], observations = [], proof }: any = {}) {
  const target = metadata?.setupTarget;
  if (!metadata || !target || !proof) fail('metadata, setupTarget, and proof are required');
  const program = {
    schema: POLICY_SCHEMA,
    metadata: clone(metadata),
    phases: [
      { id: 'idle', kind: 'idle', startMs: 0, endMs: idleEndMs, actions: [] },
      { id: 'setup', kind: 'setup', startMs: idleEndMs, endMs: loopStartMs,
        actions: clone(setupActions) },
      { id: 'repeat', kind: 'repeat', startMs: loopStartMs, endMs: loopEndMs,
        periodMs, actions: clone(repeatActions),
        ...(repeatBranches.length ? { branches: clone(repeatBranches) } : {}) },
      { id: 'finish', kind: 'finish', startMs: loopEndMs, endMs: loopEndMs,
        actions: clone(finishActions) },
      { id: 'observe', kind: 'observe', startMs: loopEndMs, endMs: observeUntilMs,
        actions: [], observations: clone(observations) },
    ],
    proof: clone(proof),
  };
  return validateGrammarPolicy(program);
}

function structuralFingerprint(program) {
  validateGrammarPolicy(program);
  return JSON.stringify({
    setupTarget: program.metadata.setupTarget,
    family: program.metadata.family,
    nights: program.metadata.nights,
    phases: program.phases.map(phase => ({
      kind: phase.kind,
      durationMs: phase.endMs - phase.startMs,
      periodMs: phase.periodMs ?? null,
      actions: (phase.actions ?? []).map(action => {
        const result: any = { action: action.action, mode: action.mode ?? 'tap' };
        if (phase.kind === 'repeat') result.offsetMs = action.offsetMs;
        else result.relativeMs = action.atMs - phase.startMs;
        for (const key of ['leadMs', 'durationMs', 'tailMs'])
          if (action[key] !== undefined) result[key] = action[key];
        return result;
      }),
      observations: phase.observations ?? [],
      branches: (phase.branches ?? []).map(branch => ({
        id: branch.id, atMs: branch.atMs, fact: branch.observe.fact,
        op: branch.predicate.op,
        then: branch.then.map(action => ({ action: action.action, mode: action.mode ?? 'tap', offsetMs: action.offsetMs })),
        otherwise: branch.otherwise.map(action => ({ action: action.action, mode: action.mode ?? 'tap', offsetMs: action.offsetMs })),
      })),
    })),
  });
}

// The same structure with every time removed. Two programs with the same shape
// differ only in timing knobs -- which is the space Plan 16 closed by recorded
// negative, so the duplicate control needs to see it.
export function structuralShape(program) {
  validateGrammarPolicy(program);
  return JSON.stringify({
    setupTarget: program.metadata.setupTarget,
    family: program.metadata.family,
    nights: program.metadata.nights,
    phases: program.phases.map(phase => ({
      kind: phase.kind,
      actions: (phase.actions ?? []).map(action =>
        `${action.action}:${action.mode ?? 'tap'}`),
      observations: (phase.observations ?? []).map(observation => observation.fact),
      branches: (phase.branches ?? []).map(branch =>
        `${branch.observe.fact}:${branch.predicate.op}:` +
        `${branch.then.map(a => a.action).join('+')}/` +
        `${branch.otherwise.map(a => a.action).join('+')}`),
    })),
  });
}

/** Every observation-conditioned branch in the program, in document order. */
export function policyBranches(program) {
  return program.phases.flatMap(phase => phase.branches ?? []);
}

const MINIMAL = minimalPolicy();
if (!MINIMAL.metadata.setupTarget) MINIMAL.metadata.setupTarget = 'minus-toys-split';
const KNOWN = new Map([
  [structuralFingerprint(MINIMAL), 'minus-toys-minimal'],
]);

export function policyFingerprint(program) {
  return structuralFingerprint(program);
}

export function classifyPolicy(program) {
  const fingerprint = structuralFingerprint(program);
  return {
    fingerprint,
    known: KNOWN.has(fingerprint),
    family: KNOWN.get(fingerprint) ?? null,
  };
}

export function knownPolicyFamilies() {
  return [...new Set(KNOWN.values())].sort();
}

/** Timing-free shapes of the known families, for the duplicate control. */
export function knownPolicyShapes() {
  return new Map([[structuralShape(MINIMAL), 'minus-toys-minimal']]);
}
