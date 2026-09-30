/**
 * Runtime validators and immutable plain-data contracts for core boundaries.
 * This module has no Node, DOM, filesystem, subprocess, network, or wall-clock
 * dependency. CONTRACT:semantic-control-v1.
 */
import {
  CONTROL_CATALOGS, GAME_PACKAGES, catalogAcceptsControl, controlCatalogFor, gameOfTargetBuild,
  unknownProfilePoints,
} from '../control/catalog/index.js';

export const CONTRACTS = Object.freeze([
  'plant-model-v1', 'semantic-control-v1', 'policy-program-v1', 'controller-v1',
  'qualification-v1', 'state-estimate-v1', 'clock-v1',
  'device-profile-v1',
  'telemetry-event-v1', 'session-manifest-v1', 'experiment-spec-v1',
  'experiment-result-v1', 'winner-v1', 'device-bundle-v1', 'trainer-trace-v1', 'artifact-ref-v1',
  'claim-evidence-v1', 'companion-status-v1', 'cue-helper-control-v1',
  'fact-message-v1', 'hid-executor-v1', 'device-artifact-v1', 'device-executor-v1',
  'device-campaign-v1', 'device-adb-preflight-v1', 'device-campaign-result-v1',
  'campaign-proof-v1', 'custom-night-config-v1', 'custom-night-calibration-v1',
  'device-campaign-preflight-v1', 'bench-transport-trace-v1',
  'exercise-v1', 'commitment-v1', 'resolution-v1', 'exercise-cancellation-v1',
  'exercise-event-v1', 'exercise-attempt-v1',
  'activity-gate-v1', 'activity-gate-profile-v1', 'activity-gate-decision-v1',
  'microtrainer-session-v1',
  'exercise-renderer-v1', 'arcade-lab-progress-v1',
  'venue-identity-v1', 'venue-check-v1', 'venue-binding-v1', 'qualification-v2', ]);

export const CLOCKS = Object.freeze([
  'game-frame', 'simulator-frame', 'device-monotonic-ms',
  'host-monotonic-ms', 'audio-sample',
]);

export const CONTROL_KINDS = Object.freeze(['press', 'release', 'hold', 'select']);
export const CLAIM_LEVELS = Object.freeze(['MODEL_ONLY', 'FIXTURE', 'DEVICE_MEASURED']);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const requiredString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256)
    throw new TypeError(`${label} must be a non-empty bounded string`);
  return value;
};
const fail = message => { throw new TypeError(`contract: ${message}`); };

export function validateClockRef(value, label = 'clock') {
  if (!isRecord(value) || !CLOCKS.includes(value.clock) || !finite(value.value) || value.value < 0)
    fail(`${label} must name a non-negative value in a declared clock domain`);
  return Object.freeze({ clock: value.clock, value: value.value });
}

// `semantic-control-v1` is parametric by game (D5). The accepted set is
// generated from the control catalogs (control/catalog/), never written out
// here. Two FNaF 2 facts used to be literals in this function: its seven
// control names, and a camera range of 0-12. FNaF 3 addresses fifteen
// locations, so `cam:13` upward failed this check and reported a cause --
// coordinates or transport text -- that had nothing to do with the refusal.
//
// With `{ game }` the check is strict: the control must be one of THAT game's
// ids, its simulator names (FNaF 2's `light`, `hall`, `ventL`, `ventR`) or one
// of its stated cameras, so `cam:13` is refused for FNaF 2 and a FNaF 3 role is
// refused for FNaF 1. Without a game the check is the union over every
// registered catalog -- exactly the set this validator accepted before it took
// a game (every game's names, FNaF 2's simulator names, `cam:0`-`cam:15`) --
// so no existing caller is refused. The union asserts "semantic, not
// physical"; only the strict form asserts "legal for this game".
const CONTROL_REFUSAL =
  'action.control must be semantic and must not contain coordinates or transport text';

function validateControl(control, game) {
  if (typeof control !== 'string') fail(CONTROL_REFUSAL);
  if (game === undefined) {
    if (GAME_PACKAGES.some(id => catalogAcceptsControl(CONTROL_CATALOGS[id], control))) return control;
    fail(CONTROL_REFUSAL);
  }
  let catalog;
  try { catalog = controlCatalogFor(game); } catch (error) { fail(error.message); }
  if (catalogAcceptsControl(catalog, control)) return control;
  fail(`action.control ${JSON.stringify(control)} is not a ${catalog.title} control; ${CONTROL_REFUSAL}`);
}

/**
 * Validate a `control-command-v1`. `game` (an Android package) makes the
 * control check strict for that game's catalog; without it the check is the
 * union over every registered game.
 * @param {any} input @param {{game?: string}} [options]
 */
export function validateControlCommand(input, { game } = {}) {
  if (!isRecord(input) || input.schema !== 'control-command-v1') fail('control command schema mismatch');
  requiredString(input.id, 'command id');
  if (!isRecord(input.action) || !CONTROL_KINDS.includes(input.action.kind)) fail('control action kind is invalid');
  validateControl(input.action.control, game);
  validateClockRef(input.requestedAt, 'requestedAt');
  if (input.deadline !== undefined) validateClockRef(input.deadline, 'deadline');
  if (!isRecord(input.source)) fail('command source is required');
  requiredString(input.source.controller, 'command source controller');
  if (input.source.policyHash !== undefined) requiredString(input.source.policyHash, 'policy hash');
  const forbidden = ['x', 'y', 'coordinates', 'shell', 'adb', 'hid', 'bytes'];
  if (forbidden.some(key => Object.hasOwn(input, key) || Object.hasOwn(input.action, key)))
    fail('physical encoding is not allowed in core commands');
  return input;
}

export function validateProfile(input) {
  if (!isRecord(input) || input.schema !== 'device-profile-v1') fail('profile schema mismatch');
  for (const field of ['id', 'targetBuild', 'actuator', 'visualSensor', 'visualDetector']) requiredString(input[field], `profile ${field}`);
  if (!CLOCKS.includes(input.clock)) fail('profile clock is not declared');
  if (!isRecord(input.calibrations)) fail('profile calibrations are required');
  return input;
}

/**
 * The game dimension of a device profile: the package half of `targetBuild`
 * (`com.scottgames.fnaf2:2.0.7+26`), which must be a registered game.
 * @param {any} profile
 */
export function deviceProfileGame(profile) {
  if (!isRecord(profile)) fail('profile is required');
  let identity;
  try { identity = gameOfTargetBuild(profile.targetBuild); } catch (error) { fail(`profile ${error.message}`); }
  return Object.freeze({ ...identity, title: controlCatalogFor(identity.game).title });
}

/**
 * Resolve a stored `device-profile-v1` (a RawDeviceProfile) into the profile
 * a campaign runs (a ResolvedDeviceProfile): the stored shape, plus its game
 * read from `targetBuild`, plus the checks that game's catalog generates --
 * `controlMap` may name only its controls, its stated cameras and its
 * auxiliary points, and `limits` must be bounded numbers.
 *
 * Resolution adds no field and returns the same object. A profile's bytes are
 * hashed into every bundle and qualification bound to it, so the game dimension
 * is derived from data the profile already carries rather than stored twice;
 * read it with `deviceProfileGame`. The schema id therefore stays
 * `device-profile-v1`.
 * @param {any} input
 */
export function resolveDeviceProfile(input) {
  validateProfile(input);
  const { game, title } = deviceProfileGame(input);
  if (input.controlMap !== undefined) {
    if (!isRecord(input.controlMap)) fail('profile controlMap must be an object');
    const unknown = unknownProfilePoints(controlCatalogFor(game), input.controlMap);
    if (unknown.length > 0)
      fail(`profile controlMap names ${unknown.join(', ')}, which ${title} has no control, camera or point for`);
  }
  if (input.limits !== undefined) {
    const limits = input.limits;
    if (!isRecord(limits)) fail('profile limits must be an object');
    if (limits.maxActions !== undefined && (!Number.isInteger(limits.maxActions) || limits.maxActions < 1))
      fail('profile limits.maxActions must be a positive integer');
    if (limits.maxDurationMs !== undefined && (!finite(limits.maxDurationMs) || limits.maxDurationMs <= 0))
      fail('profile limits.maxDurationMs must be a positive number of ms');
    if (limits.dryRunOnly !== undefined && typeof limits.dryRunOnly !== 'boolean')
      fail('profile limits.dryRunOnly must be boolean');
  }
  return input;
}

export function validateStateEstimate(input) {
  if (!isRecord(input) || input.schema !== 'state-estimate-v1' || typeof input.id !== 'string' ||
      !isRecord(input.at) || !isRecord(input.values)) fail('state estimate is incomplete');
  validateClockRef(input.at, 'state estimate at');
  return input;
}

export function validateExperiment(input) {
  if (!isRecord(input) || input.schema !== 'experiment-spec-v1' || typeof input.id !== 'string' ||
      typeof input.operation !== 'string' || typeof input.modelHash !== 'string' ||
      !Array.isArray(input.seeds) || !isRecord(input.sample) || typeof input.claimLevel !== 'string') fail('experiment spec is incomplete');
  return input;
}

export function validateExperimentResult(input) {
  if (!isRecord(input) || input.schema !== 'experiment-result-v1' || typeof input.operation !== 'string' ||
      typeof input.verdict !== 'string' || typeof input.modelHash !== 'string' || typeof input.specHash !== 'string' || !isRecord(input.sample) ||
      typeof input.claimLevel !== 'string') fail('experiment result is incomplete');
  return input;
}

export function validateArtifactRef(input) {
  if (!isRecord(input) || input.schema !== 'artifact-ref-v1' || typeof input.hash !== 'string' ||
      typeof input.mediaType !== 'string' || typeof input.producer !== 'string' ||
      typeof input.size !== 'number' || input.size < 0) fail('artifact reference is incomplete');
  return input;
}

export function validateClaimEvidence(input) {
  if (!isRecord(input) || input.schema !== 'claim-evidence-v1' || typeof input.id !== 'string' ||
      !Array.isArray(input.nodes) || !Array.isArray(input.edges)) fail('claim/evidence graph is incomplete');
  return input;
}

// Retained-run contracts: the qualification (v1, and v2 with its venue) lives
// in qualification.js beside the venue identity it binds.
export {
  QUALIFICATION_SCHEMAS, QUALIFICATION_LIFECYCLES, validateQualification,
  bindQualificationVenue, qualificationStanding,
} from './qualification.js';
export * from './venue-identity.js';
// The campaign result and save proof a device campaign retains, read back by
// the evidence index (campaign-records.js).
export { CAMPAIGN_STATES, validateCampaignResult, validateSaveProof } from './campaign-records.js';

export function validateTelemetry(value) {
  if (!value || value.schema !== 'telemetry-event-v1' || typeof value.sessionId !== 'string' ||
      typeof value.type !== 'string' || typeof value.component !== 'string')
    throw new TypeError('telemetry event is incomplete');
  validateClockRef(value.at);
  return value;
}

export function validateManifest(value) {
  if (!value || value.schema !== 'session-manifest-v1' || typeof value.id !== 'string' ||
      typeof value.profileHash !== 'string' || typeof value.targetBuild !== 'string' ||
      !Array.isArray(value.events) || !value.artifacts || typeof value.artifacts !== 'object')
    throw new TypeError('session manifest is incomplete');
  for (const event of value.events) validateTelemetry(event);
  return value;
}

export function canonicalJson(value) {
  const sort = current => {
    if (Array.isArray(current)) return current.map(sort);
    if (!isRecord(current)) return current;
    return Object.fromEntries(Object.keys(current).sort().map(key => [key, sort(current[key])]));
  };
  return JSON.stringify(sort(value)) + '\n';
}

export function stableHash(value) {
  const text = typeof value === 'string' ? value : canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
