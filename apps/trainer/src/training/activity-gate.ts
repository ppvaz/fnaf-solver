// Conservative activity gate for Plan 24 package 2.
//
// This evaluator only admits a prompt when every prerequisite is positively
// qualified. It does not estimate risk, repair stale belief, or infer a quiet
// interval from an absent signal; those are upstream responsibilities.

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

const FRESHNESS = new Set(['FRESH', 'STALE', 'UNKNOWN']);
const CONSISTENCY = new Set(['CONSISTENT', 'CONFLICTING', 'UNKNOWN']);
const CRITICAL = new Set(['CLEAR', 'ACTIVE', 'COOLING_DOWN', 'UNKNOWN']);
const clone = value => structuredClone(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);

function fail(message) { throw new TypeError(`activity gate: ${message}`); }
function object(name, value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail(`${name} must be an object`);
  return value;
}
function string(name, value, max = 128) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    fail(`${name} must be a non-empty bounded string`);
  return value;
}
function nonNegative(name, value) {
  if (!finite(value) || value < 0) fail(`${name} must be finite and non-negative`);
}
function nullableNonNegative(name, value) {
  if (value !== null) nonNegative(name, value);
}

function validateTiming(timing) {
  object('profile.timing', timing);
  for (const name of ['promptMs', 'revealMs', 'cancelP99Ms', 'humanRecoveryBudgetMs'])
    nonNegative(`profile.timing.${name}`, timing[name]);
  return timing;
}

/** Validate the versioned latency/risk profile used by the gate. */
export function validateActivityGateProfile(input) {
  object('profile', input);
  if (input.schema !== ACTIVITY_GATE_PROFILE_SCHEMA)
    fail(`profile schema must be ${ACTIVITY_GATE_PROFILE_SCHEMA}`);
  string('profile.id', input.id, 160);
  string('profile.version', input.version, 64);
  if (!finite(input.profileLimit) || input.profileLimit < 0 || input.profileLimit > 1)
    fail('profile.profileLimit must be between 0 and 1');
  validateTiming(input.timing);
  if (!Array.isArray(input.requiredCapabilities) ||
      input.requiredCapabilities.length !== ACTIVITY_GATE_CAPABILITIES.length ||
      input.requiredCapabilities.some(name => !ACTIVITY_GATE_CAPABILITIES.includes(name)) ||
      new Set(input.requiredCapabilities).size !== input.requiredCapabilities.length)
    fail('profile.requiredCapabilities must contain all unique known capabilities');
  return Object.freeze(clone(input));
}

function validateCapabilities(capabilities) {
  object('snapshot.capabilities', capabilities);
  for (const name of ACTIVITY_GATE_CAPABILITIES) {
    if (!ACTIVITY_GATE_QUALIFICATIONS.includes(capabilities[name]))
      fail(`snapshot.capabilities.${name} is invalid`);
  }
  return capabilities;
}

/** Validate an immutable snapshot without deciding whether it is eligible. */
export function validateActivityGateSnapshot(input) {
  object('snapshot', input);
  if (input.schema !== ACTIVITY_GATE_SCHEMA)
    fail(`snapshot schema must be ${ACTIVITY_GATE_SCHEMA}`);
  string('snapshot.profileId', input.profileId, 160);
  nonNegative('snapshot.nowMs', input.nowMs);
  object('snapshot.screen', input.screen);
  if (!ACTIVITY_GATE_SCREEN_IDENTITIES.includes(input.screen.identity))
    fail('snapshot.screen.identity is invalid');
  if (!ACTIVITY_GATE_QUALIFICATIONS.includes(input.screen.qualification))
    fail('snapshot.screen.qualification is invalid');
  object('snapshot.belief', input.belief);
  if (!FRESHNESS.has(input.belief.freshness)) fail('snapshot.belief.freshness is invalid');
  if (!CONSISTENCY.has(input.belief.consistency)) fail('snapshot.belief.consistency is invalid');
  if (!CRITICAL.has(input.belief.criticalState)) fail('snapshot.belief.criticalState is invalid');
  nullableNonNegative('snapshot.belief.riskUpperBound', input.belief.riskUpperBound);
  if (input.belief.riskUpperBound !== null && input.belief.riskUpperBound > 1)
    fail('snapshot.belief.riskUpperBound must be at most 1');
  nullableNonNegative('snapshot.belief.quietHorizonMs', input.belief.quietHorizonMs);
  validateCapabilities(input.capabilities);
  return Object.freeze(clone(input));
}

function requiredQuietMs(profile) {
  const { promptMs, revealMs, cancelP99Ms, humanRecoveryBudgetMs } = profile.timing;
  return promptMs + revealMs + cancelP99Ms + humanRecoveryBudgetMs;
}

/**
 * Evaluate eligibility with stable refusal reasons. The order is diagnostic;
 * all failed prerequisites are retained so callers do not retry blindly.
 */
export function evaluateActivityGate(snapshotInput, profileInput) {
  const snapshot = validateActivityGateSnapshot(snapshotInput);
  const profile = validateActivityGateProfile(profileInput);
  const reasons = [];
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
