// Conservative activity gate for Plan 24 package 2.
//
// This evaluator only admits a prompt when every prerequisite is positively
// qualified. It does not estimate risk, repair stale belief, or infer a quiet
// interval from an absent signal; those are upstream responsibilities.

import { among, isList } from '../validate.ts';

export const ACTIVITY_GATE_SCHEMA = 'activity-gate-v1';
export const ACTIVITY_GATE_PROFILE_SCHEMA = 'activity-gate-profile-v1';
export const ACTIVITY_GATE_DECISION_SCHEMA = 'activity-gate-decision-v1';
export const ACTIVITY_GATE_CAPABILITIES = Object.freeze([
  'overlay', 'capture', 'response',
]);
export const ACTIVITY_GATE_SCREEN_IDENTITIES = Object.freeze([
  'FNAF2_NIGHT', 'OTHER', 'UNKNOWN',
]);
export const ACTIVITY_GATE_QUALIFICATIONS = Object.freeze([
  'QUALIFIED', 'UNQUALIFIED', 'UNKNOWN',
]);

type Qualification = 'QUALIFIED' | 'UNQUALIFIED' | 'UNKNOWN';
/** The versioned latency/risk profile the gate reads. */
interface ActivityGateProfile {
  readonly schema: typeof ACTIVITY_GATE_PROFILE_SCHEMA;
  readonly id: string;
  readonly version: string;
  readonly profileLimit: number;
  readonly timing: { readonly promptMs: number, readonly revealMs: number, readonly cancelP99Ms: number, readonly humanRecoveryBudgetMs: number };
  readonly requiredCapabilities: readonly string[];
}
/** What the gate is asked to admit a prompt against. */
interface ActivityGateSnapshot {
  readonly schema: typeof ACTIVITY_GATE_SCHEMA;
  readonly profileId: string;
  readonly nowMs: number;
  readonly screen: { readonly identity: string, readonly qualification: Qualification };
  readonly belief: {
    readonly freshness: string, readonly consistency: string, readonly criticalState: string,
    readonly riskUpperBound: number | null, readonly quietHorizonMs: number | null,
  };
  readonly capabilities: Readonly<Record<string, Qualification>>;
}

const FRESHNESS: ReadonlySet<unknown> = new Set(['FRESH', 'STALE', 'UNKNOWN']);
const CONSISTENCY: ReadonlySet<unknown> = new Set(['CONSISTENT', 'CONFLICTING', 'UNKNOWN']);
const CRITICAL: ReadonlySet<unknown> = new Set(['CLEAR', 'ACTIVE', 'COOLING_DOWN', 'UNKNOWN']);
const clone = <T>(value: T) => structuredClone(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function fail(message: string): never { throw new TypeError(`activity gate: ${message}`); }
function object(name: string, value: unknown): asserts value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail(`${name} must be an object`);
}
function string(name: string, value: unknown, max = 128): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    fail(`${name} must be a non-empty bounded string`);
}
function nonNegative(name: string, value: unknown): asserts value is number {
  if (!finite(value) || value < 0) fail(`${name} must be finite and non-negative`);
}
function nullableNonNegative(name: string, value: unknown): asserts value is number | null {
  if (value !== null) nonNegative(name, value);
}

function validateTiming(timing: unknown) {
  object('profile.timing', timing);
  for (const name of ['promptMs', 'revealMs', 'cancelP99Ms', 'humanRecoveryBudgetMs'])
    nonNegative(`profile.timing.${name}`, timing[name]);
  return timing;
}

/** Validate the versioned latency/risk profile used by the gate. */
export function validateActivityGateProfile(input: unknown): Readonly<ActivityGateProfile> {
  object('profile', input);
  if (input.schema !== ACTIVITY_GATE_PROFILE_SCHEMA)
    fail(`profile schema must be ${ACTIVITY_GATE_PROFILE_SCHEMA}`);
  string('profile.id', input.id, 160);
  string('profile.version', input.version, 64);
  if (!finite(input.profileLimit) || input.profileLimit < 0 || input.profileLimit > 1)
    fail('profile.profileLimit must be between 0 and 1');
  validateTiming(input.timing);
  const required = input.requiredCapabilities;
  if (!isList(required) ||
      required.length !== ACTIVITY_GATE_CAPABILITIES.length ||
      required.some(name => !among(ACTIVITY_GATE_CAPABILITIES, name)) ||
      new Set(required).size !== required.length)
    fail('profile.requiredCapabilities must contain all unique known capabilities');
  return Object.freeze(clone(input) as unknown as ActivityGateProfile);
}

function validateCapabilities(capabilities: unknown) {
  object('snapshot.capabilities', capabilities);
  for (const name of ACTIVITY_GATE_CAPABILITIES) {
    if (!among(ACTIVITY_GATE_QUALIFICATIONS, capabilities[name]))
      fail(`snapshot.capabilities.${name} is invalid`);
  }
  return capabilities;
}

/** Validate an immutable snapshot without deciding whether it is eligible. */
export function validateActivityGateSnapshot(input: unknown): Readonly<ActivityGateSnapshot> {
  object('snapshot', input);
  if (input.schema !== ACTIVITY_GATE_SCHEMA)
    fail(`snapshot schema must be ${ACTIVITY_GATE_SCHEMA}`);
  string('snapshot.profileId', input.profileId, 160);
  nonNegative('snapshot.nowMs', input.nowMs);
  const screen = input.screen;
  object('snapshot.screen', screen);
  if (!among(ACTIVITY_GATE_SCREEN_IDENTITIES, screen.identity))
    fail('snapshot.screen.identity is invalid');
  if (!among(ACTIVITY_GATE_QUALIFICATIONS, screen.qualification))
    fail('snapshot.screen.qualification is invalid');
  const belief = input.belief;
  object('snapshot.belief', belief);
  if (!FRESHNESS.has(belief.freshness)) fail('snapshot.belief.freshness is invalid');
  if (!CONSISTENCY.has(belief.consistency)) fail('snapshot.belief.consistency is invalid');
  if (!CRITICAL.has(belief.criticalState)) fail('snapshot.belief.criticalState is invalid');
  nullableNonNegative('snapshot.belief.riskUpperBound', belief.riskUpperBound);
  if (belief.riskUpperBound !== null && belief.riskUpperBound > 1)
    fail('snapshot.belief.riskUpperBound must be at most 1');
  nullableNonNegative('snapshot.belief.quietHorizonMs', belief.quietHorizonMs);
  validateCapabilities(input.capabilities);
  return Object.freeze(clone(input) as unknown as ActivityGateSnapshot);
}

function requiredQuietMs(profile: ActivityGateProfile) {
  const { promptMs, revealMs, cancelP99Ms, humanRecoveryBudgetMs } = profile.timing;
  return promptMs + revealMs + cancelP99Ms + humanRecoveryBudgetMs;
}

/**
 * Evaluate eligibility with stable refusal reasons. The order is diagnostic;
 * all failed prerequisites are retained so callers do not retry blindly.
 */
export function evaluateActivityGate(snapshotInput: unknown, profileInput: unknown) {
  const snapshot = validateActivityGateSnapshot(snapshotInput);
  const profile = validateActivityGateProfile(profileInput);
  const reasons: string[] = [];
  if (snapshot.profileId !== profile.id) reasons.push('profile-mismatch');
  if (snapshot.screen.identity !== 'FNAF2_NIGHT') reasons.push('screen-not-night');
  if (snapshot.screen.qualification !== 'QUALIFIED') reasons.push('screen-unqualified');
  if (snapshot.belief.freshness !== 'FRESH') reasons.push(`belief-${snapshot.belief.freshness.toLowerCase()}`);
  if (snapshot.belief.consistency !== 'CONSISTENT')
    reasons.push(`belief-${snapshot.belief.consistency.toLowerCase()}`);
  if (snapshot.belief.criticalState === 'ACTIVE') reasons.push('critical-cue-active');
  else if (snapshot.belief.criticalState === 'COOLING_DOWN') reasons.push('critical-cue-cooldown');
  else if (snapshot.belief.criticalState === 'UNKNOWN') reasons.push('critical-state-unknown');
  if (snapshot.belief.riskUpperBound === null) reasons.push('critical-risk-unknown');
  else if (snapshot.belief.riskUpperBound > profile.profileLimit)
    reasons.push('critical-risk-above-profile-limit');
  const quietRequiredMs = requiredQuietMs(profile);
  if (snapshot.belief.quietHorizonMs === null) reasons.push('quiet-horizon-unknown');
  else if (snapshot.belief.quietHorizonMs < quietRequiredMs)
    reasons.push('quiet-horizon-too-short');
  for (const capability of profile.requiredCapabilities) {
    if (snapshot.capabilities[capability] !== 'QUALIFIED')
      reasons.push(`capability-${capability}-unqualified`);
  }
  return Object.freeze({
    schema: ACTIVITY_GATE_DECISION_SCHEMA,
    gateVersion: ACTIVITY_GATE_SCHEMA,
    admitted: reasons.length === 0,
    reasons: Object.freeze(reasons),
    requiredQuietHorizonMs: quietRequiredMs,
    profileId: profile.id,
    atMs: snapshot.nowMs,
  });
}
