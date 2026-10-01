/**
 * Runtime validators and immutable plain-data contracts for the boundaries
 * every context shares (`@sixam/kernel/contracts`, ADR 0002). This module has
 * no Node, DOM, filesystem, subprocess, network, or wall-clock dependency, and
 * imports nothing outside the kernel. The validators generated from the
 * per-game control catalogs (`validateControlCommand`, `deviceProfileGame`,
 * `resolveDeviceProfile`) live with the catalogs, outside the kernel.
 * CONTRACT:semantic-control-v1.
 */
import { isList, isOneOf, isRecord } from '../labels.ts';
import type {
  ArtifactRef, ClaimEvidenceGraph, ClockName, ClockRef, ExperimentResultV1, ExperimentSpecV1, RawDeviceProfile, SessionManifest,
  StateEstimate, TelemetryEvent,
} from './types.ts';

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
  'venue-identity-v1', 'venue-check-v1', 'venue-binding-v1', 'qualification-v2',
  'experiment-spec-v2', 'experiment-result-v2', ]);

export const CLOCKS: readonly ClockName[] = Object.freeze([
  'game-frame', 'simulator-frame', 'device-monotonic-ms',
  'host-monotonic-ms', 'audio-sample',
] as const);

export const CONTROL_KINDS = Object.freeze(['press', 'release', 'hold', 'select'] as const);
export const CLAIM_LEVELS = Object.freeze(['MODEL_ONLY', 'FIXTURE', 'DEVICE_MEASURED'] as const);

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const requiredString = (value: unknown, label: string) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256)
    throw new TypeError(`${label} must be a non-empty bounded string`);
  return value;
};
function fail(message: string): never { throw new TypeError(`contract: ${message}`); }

export function validateClockRef(value: unknown, label = 'clock'): ClockRef {
  if (!isRecord(value) || !isOneOf(CLOCKS, value.clock) || !finite(value.value) || value.value < 0)
    fail(`${label} must name a non-negative value in a declared clock domain`);
  return Object.freeze({ clock: value.clock, value: value.value });
}

export function validateProfile(input: unknown): RawDeviceProfile {
  if (!isRecord(input) || input.schema !== 'device-profile-v1') fail('profile schema mismatch');
  for (const field of ['id', 'targetBuild', 'actuator', 'visualSensor', 'visualDetector']) requiredString(input[field], `profile ${field}`);
  if (!isOneOf(CLOCKS, input.clock)) fail('profile clock is not declared');
  if (!isRecord(input.calibrations)) fail('profile calibrations are required');
  return input as unknown as RawDeviceProfile;
}

export function validateStateEstimate(input: unknown): StateEstimate {
  if (!isRecord(input) || input.schema !== 'state-estimate-v1' || typeof input.id !== 'string' ||
      !isRecord(input.at) || !isRecord(input.values)) fail('state estimate is incomplete');
  validateClockRef(input.at, 'state estimate at');
  return input as unknown as StateEstimate;
}

export function validateExperiment(input: unknown): ExperimentSpecV1 {
  if (!isRecord(input) || input.schema !== 'experiment-spec-v1' || typeof input.id !== 'string' ||
      typeof input.operation !== 'string' || typeof input.modelHash !== 'string' ||
      !isList(input.seeds) || !isRecord(input.sample) || typeof input.claimLevel !== 'string') fail('experiment spec is incomplete');
  return input as unknown as ExperimentSpecV1;
}

export function validateExperimentResult(input: unknown): ExperimentResultV1 {
  if (!isRecord(input) || input.schema !== 'experiment-result-v1' || typeof input.operation !== 'string' ||
      typeof input.verdict !== 'string' || typeof input.modelHash !== 'string' || typeof input.specHash !== 'string' || !isRecord(input.sample) ||
      typeof input.claimLevel !== 'string') fail('experiment result is incomplete');
  return input as unknown as ExperimentResultV1;
}

export function validateArtifactRef(input: unknown): ArtifactRef {
  if (!isRecord(input) || input.schema !== 'artifact-ref-v1' || typeof input.hash !== 'string' ||
      typeof input.mediaType !== 'string' || typeof input.producer !== 'string' ||
      typeof input.size !== 'number' || input.size < 0) fail('artifact reference is incomplete');
  return input as unknown as ArtifactRef;
}

export function validateClaimEvidence(input: unknown): ClaimEvidenceGraph {
  if (!isRecord(input) || input.schema !== 'claim-evidence-v1' || typeof input.id !== 'string' ||
      !isList(input.nodes) || !isList(input.edges)) fail('claim/evidence graph is incomplete');
  return input as unknown as ClaimEvidenceGraph;
}

// Retained-run contracts: the qualification (v1, and v2 with its venue) lives
// in qualification.js beside the venue identity it binds.
export {
  QUALIFICATION_SCHEMAS, QUALIFICATION_LIFECYCLES, validateQualification,
  bindQualificationVenue, qualificationStanding,
} from './qualification.ts';
export * from './venue-identity.ts';
// Experiments and censuses, v2: competing explanations, a named held-out block,
// seed sets that say how they were derived, and rates with their intervals
// (experiment.js). The v1 validators above are still read.
export {
  EXPERIMENT_PURPOSES, RATE_METHODS, SEED_DERIVATIONS, derivedCount, knownOverlap, validateExperimentResultV2,
  validateExperimentSpecV2, validateRate, validateSeedDerivation, validateSeedSet,
} from './experiment.ts';
// The campaign result and save proof a device campaign retains, read back by
// the evidence index (campaign-records.js).
export { CAMPAIGN_STATES, validateCampaignResult, validateSaveProof } from './campaign-records.ts';

export function validateTelemetry(value: unknown): TelemetryEvent {
  if (!isRecord(value) || value.schema !== 'telemetry-event-v1' || typeof value.sessionId !== 'string' ||
      typeof value.type !== 'string' || typeof value.component !== 'string')
    throw new TypeError('telemetry event is incomplete');
  validateClockRef(value.at);
  return value as unknown as TelemetryEvent;
}

export function validateManifest(value: unknown): SessionManifest {
  if (!isRecord(value) || value.schema !== 'session-manifest-v1' || typeof value.id !== 'string' ||
      typeof value.profileHash !== 'string' || typeof value.targetBuild !== 'string' ||
      !isList(value.events) || !value.artifacts || typeof value.artifacts !== 'object')
    throw new TypeError('session manifest is incomplete');
  for (const event of value.events) validateTelemetry(event);
  return value as unknown as SessionManifest;
}

export function canonicalJson(value: unknown): string {
  const sort = (current: unknown): unknown => {
    if (isList(current)) return current.map(sort);
    if (!isRecord(current)) return current;
    return Object.fromEntries(Object.keys(current).sort().map(key => [key, sort(current[key])]));
  };
  return JSON.stringify(sort(value)) + '\n';
}

export function stableHash(value: unknown): string {
  const text = typeof value === 'string' ? value : canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
