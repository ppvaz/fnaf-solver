// Policy-program IR validation and canonicalization (Plan 21 package 1).
// The IR is intentionally finite plain data: it describes reviewed actions
// and observations, never shell commands or arbitrary callbacks.

import { validateBranch } from './observation-language.js';

export const POLICY_SCHEMA = 'policy-v1';
export const PHASE_KINDS = Object.freeze(['idle', 'setup', 'repeat', 'finish', 'observe']);
export const ACTIONS = Object.freeze([
  'monitor', 'mask', 'cam9', 'cam11', 'ventl', 'light', 'wind', 'hall',
]);

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => Number.isFinite(value);

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
}

export function canonicalPolicy(program) {
  return JSON.stringify(sorted(program)) + '\n';
}

function checkAction(action, label) {
  if (!isObject(action) || !ACTIONS.includes(action.action))
    throw new TypeError(`${label} has an unsupported action`);
  const time = action.atMs ?? action.offsetMs;
  if (!finite(time) || time < 0) throw new TypeError(`${label} needs a non-negative time`);
  if (action.contactMs !== undefined &&
      (!finite(action.contactMs) || action.contactMs <= 0))
    throw new TypeError(`${label} has invalid contactMs`);
}

export function validatePolicy(program) {
  if (!isObject(program) || program.schema !== POLICY_SCHEMA)
    throw new TypeError('policy schema mismatch');
  if (!isObject(program.metadata) || typeof program.metadata.id !== 'string' ||
      !Array.isArray(program.metadata.nights) || !program.metadata.nights.length)
    throw new TypeError('policy metadata is incomplete');
  if (!Array.isArray(program.phases) || !program.phases.length)
    throw new TypeError('policy needs phases');
  let previousEnd = 0;
  for (const [index, phase] of program.phases.entries()) {
    const label = `phase ${index}`;
    if (!isObject(phase) || !PHASE_KINDS.includes(phase.kind) ||
        typeof phase.id !== 'string' || !finite(phase.startMs) ||
        !finite(phase.endMs) || phase.startMs < previousEnd ||
        phase.endMs < phase.startMs)
      throw new TypeError(`${label} has invalid bounds or kind`);
    if (phase.kind === 'repeat' &&
        (!finite(phase.periodMs) || phase.periodMs <= 0))
      throw new TypeError(`${label} repeat needs a positive periodMs`);
    for (const [actionIndex, action] of (phase.actions ?? []).entries())
      checkAction(action, `${label} action ${actionIndex}`);
    // An observation-conditioned branch is the only construct that may read a
    // fact and change what runs. Validating it here means no consumer of the
    // IR -- interpreter, device compiler, search -- can be handed a branch
    // that reads an excluded fact or acts faster than the measured read.
    if (phase.branches !== undefined) {
      if (!Array.isArray(phase.branches))
        throw new TypeError(`${label} branches must be an array`);
      if (phase.kind !== 'repeat' && phase.branches.length)
        throw new TypeError(`${label} branches are only defined inside a repeat body`);
      for (const branch of phase.branches) validateBranch(branch);
    }
    for (const [observationIndex, observation] of (phase.observations ?? []).entries()) {
      if (!isObject(observation) || typeof observation.fact !== 'string' ||
          !finite(observation.maxAgeMs) || observation.maxAgeMs < 0 ||
          !finite(observation.confidenceFloor) || observation.confidenceFloor < 0 ||
          observation.confidenceFloor > 1)
        throw new TypeError(`${label} observation ${observationIndex} is invalid`);
    }
    previousEnd = phase.endMs;
  }
  if (!isObject(program.proof) || !Array.isArray(program.proof.seeds) ||
      typeof program.proof.traceEquivalence !== 'boolean')
    throw new TypeError('policy proof obligations are incomplete');
  return program;
}

export function roundTripPolicy(program) {
  validatePolicy(program);
  return JSON.parse(canonicalPolicy(program));
}
