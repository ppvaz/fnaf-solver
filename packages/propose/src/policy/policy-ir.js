// Policy-program IR validation and canonicalization (Plan 21 package 1).
// The IR is intentionally finite plain data: it describes reviewed actions
// and observations, never shell commands or arbitrary callbacks.

import { PACKAGES, catalogAcceptsControl, controlCatalogFor } from '@sixam/source';
import { validateBranch } from './observation-language.js';

export const POLICY_SCHEMA = 'policy-v1';
export const PHASE_KINDS = Object.freeze(['idle', 'setup', 'repeat', 'finish', 'observe']);

// A policy names its game in `metadata.game` (fnaf1..fnaf4). Every policy-v1
// written before the IR took a game is FNaF 2's, so an absent game means
// FNaF 2 and those programs keep their canonical bytes.
const DEFAULT_GAME = 'fnaf2';

// An action names a control in its game's catalog (@sixam/source,
// games/<game>/controls.js): a control id, a simulator name the catalog keeps,
// or a stated camera. FNaF 2's IR predates the catalog and spells three
// actions its own way. Those spellings are stored in every canonical policy
// and hashed into its artifact (ADR 0002 principle 9), so they are mapped
// here, never renamed. `light` and `hall` are FNaF 2 simulator names the
// catalog accepts as spelled.
const STORED_ACTIONS = Object.freeze({
  fnaf2: Object.freeze({ cam9: 'cam:9', cam11: 'cam:11', ventl: 'leftVentLight' }),
});

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => Number.isFinite(value);

/** The game `program` is written for: its `metadata.game`, or `fnaf2` when it names none. */
export function policyGame(program) {
  const game = program?.metadata?.game ?? DEFAULT_GAME;
  if (typeof game !== 'string' || !Object.hasOwn(PACKAGES, game))
    throw new TypeError(`policy metadata.game ${JSON.stringify(game)} is not a registered game ` +
      `(${Object.keys(PACKAGES).join(', ')})`);
  return game;
}

function actionControl(action, game) {
  const stored = STORED_ACTIONS[game];
  return stored && Object.hasOwn(stored, action) ? stored[action] : action;
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
}

export function canonicalPolicy(program) {
  return JSON.stringify(sorted(program)) + '\n';
}

function checkAction(action, label, catalog, game) {
  if (!isObject(action) || typeof action.action !== 'string' ||
      !catalogAcceptsControl(catalog, actionControl(action.action, game)))
    throw new TypeError(`${label} has an unsupported action: ` +
      `${JSON.stringify(isObject(action) ? action.action : action)} is not a ${catalog.title} control`);
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
  const game = policyGame(program);
  const catalog = controlCatalogFor(PACKAGES[game]);
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
      checkAction(action, `${label} action ${actionIndex}`, catalog, game);
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
