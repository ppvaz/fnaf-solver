/** Bind compiled, full-night plans to the reviewed story/custom campaign chain. */
import { createHash } from 'node:crypto';
import { canonicalJson, stableHash } from '@sixam/kernel/contracts';
import { validateCampaignSpec } from './campaign.js';
import { validateExecutorRequest } from './artifact-executor.js';

export const CAMPAIGN_BUNDLE_SCHEMA = 'device-campaign-bundle-v1';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new TypeError(`campaign bundle: ${message}`); };

function same(a, b) { return stableHash(a) === stableHash(b); }
const sha256 = value => createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');

/** @param {{spec?: any, plans?: any[]}} options */
export function validateCampaignBundle({ spec, plans } = {}) {
  validateCampaignSpec(spec);
  if (!Array.isArray(plans) || plans.length !== spec.nights.length) fail('one compiled plan is required per campaign night');
  const seen = new Set();
  const normalized = plans.map((plan, index) => {
    if (!isRecord(plan) || !Number.isInteger(plan.night) || seen.has(plan.night)) fail(`plans[${index}] night is invalid or duplicated`);
    seen.add(plan.night);
    const target = spec.nights.find(item => item.night === plan.night);
    if (!target) fail(`plans[${index}] is not a requested campaign night`);
    if (!same(plan.timing, target.timing)) fail(`plans[${index}] timing does not match Night ${plan.night}`);
    if (!isRecord(plan.cycles) || !Array.isArray(plan.cycles.opening?.blocks)) fail(`plans[${index}] opening blocks are missing`);
    if (!Array.isArray(plan.cycles.toys?.blocks) && !Array.isArray(plan.cycles.clear?.blocks)) fail(`plans[${index}] steady blocks are missing`);
    return { night: plan.night, timing: structuredClone(plan.timing), cycles: structuredClone(plan.cycles),
      ...(plan.armVerification ? { armVerification: structuredClone(plan.armVerification) } : {}),
      sha256: plan.sha256 ?? sha256(plan) };
  });
  if (seen.size !== spec.nights.length) fail('campaign plans do not cover every target');
  return Object.freeze({ schema: CAMPAIGN_BUNDLE_SCHEMA, version: 1,
    specHash: stableHash(spec), plans: normalized,
    bundleHash: stableHash({ spec, plans: normalized }) });
}

/** Turn one validated campaign plan into the request consumed by the local executor. */
/** @param {{bundle?: any, plan?: any, profile?: any, mode?: string, artifact?: any, armMode?: string}} options */
export function makeCampaignExecutionRequest({ bundle, plan, profile, mode = 'live', artifact = {}, armMode } = {}) {
  if (!isRecord(bundle) || bundle.schema !== CAMPAIGN_BUNDLE_SCHEMA) fail('validated campaign bundle is required');
  const bound = isRecord(plan) && bundle.plans.find(item => item.night === plan.night);
  if (!bound || plan.sha256 !== bound.sha256 || !same(plan.timing, bound.timing) ||
      !same(plan.cycles, bound.cycles) || !same(plan.armVerification, bound.armVerification))
    fail('plan is not bound immutably to bundle');
  if (armMode !== undefined && !['blocking', 'observe-once'].includes(armMode))
    fail('armMode must be blocking or observe-once');
  if (armMode !== undefined && !plan.armVerification)
    fail('armMode requires an arm-verified plan');
  if (!isRecord(profile)) fail('resolved profile is required');
  const requestArmVerification = plan.armVerification && armMode !== undefined
    ? { ...plan.armVerification, mode: armMode } : plan.armVerification;
  const request = {
    schema: 'device-executor-v1', version: 1, mode,
    artifact: { winnerHash: artifact.winnerHash ?? stableHash({ bundle: bundle.bundleHash, kind: 'winner' }),
      engineHash: artifact.engineHash ?? stableHash({ bundle: bundle.bundleHash, kind: 'engine' }),
      profileHash: artifact.profileHash ?? sha256(profile), profileStableHash: stableHash(profile),
      plans: [{ night: plan.night, sha256: plan.sha256, timing: plan.timing,
        ...(requestArmVerification ? { armVerification: structuredClone(requestArmVerification) } : {}) }] },
    profile: structuredClone(profile), limits: { maxActions: profile.limits?.maxActions ?? 64,
      maxDurationMs: profile.limits?.maxDurationMs ?? 15000 },
    blocks: Object.values(plan.cycles).flatMap(cycle => cycle.blocks.map(block => ({ ...block, night: plan.night }))),
  };
  try { return validateExecutorRequest(request); }
  catch (error) { fail(error.message); }
}
