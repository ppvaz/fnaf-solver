/** Bind compiled, full-night plans to the reviewed story/custom campaign chain. */
import { createHash } from 'node:crypto';
import { canonicalJson, stableHash } from '@sixam/kernel/contracts';
import { validateCampaignSpec } from './campaign.ts';
import type { CampaignSpec, NightTiming } from './campaign.ts';
import { validateExecutorRequest } from './artifact-executor.ts';
import type { ArmVerification } from './artifact-executor.ts';
import { isList, isOneOf, isRecord } from '@sixam/kernel';

export const CAMPAIGN_BUNDLE_SCHEMA = 'device-campaign-bundle-v1';
function fail(message: string): never { throw new TypeError(`campaign bundle: ${message}`); }

/** A compiled night bound to its campaign target; its blocks are validated when a request is made of them. */
interface BundlePlan {
  readonly night: number;
  readonly timing?: NightTiming;
  readonly cycles: Readonly<Record<string, { readonly blocks: readonly unknown[] }>>;
  readonly armVerification?: ArmVerification;
  readonly sha256: string;
}
/** device-campaign-bundle-v1: one compiled plan per campaign night, hashed with its spec. */
export interface CampaignBundle {
  readonly schema: 'device-campaign-bundle-v1';
  readonly version: 1;
  readonly specHash: string;
  readonly plans: readonly BundlePlan[];
  readonly bundleHash: string;
}

function same(a: unknown, b: unknown) { return stableHash(a) === stableHash(b); }
const sha256 = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');

export function validateCampaignBundle({ spec: input, plans }: {spec?: unknown, plans?: unknown} = {}): CampaignBundle {
  const spec: CampaignSpec = validateCampaignSpec(input);
  if (!isList(plans) || plans.length !== spec.nights.length) fail('one compiled plan is required per campaign night');
  const seen = new Set<number>();
  const normalized = plans.map((plan, index): BundlePlan => {
    if (!isRecord(plan) || typeof plan.night !== 'number' || !Number.isInteger(plan.night) || seen.has(plan.night))
      fail(`plans[${index}] night is invalid or duplicated`);
    const night = plan.night;
    seen.add(night);
    const target = spec.nights.find(item => item.night === night);
    if (!target) fail(`plans[${index}] is not a requested campaign night`);
    if (!same(plan.timing, target.timing)) fail(`plans[${index}] timing does not match Night ${night}`);
    const cycles = plan.cycles;
    const blocksOf = (cycle: string) => isRecord(cycles) && isRecord(cycles[cycle]) ? cycles[cycle].blocks : undefined;
    if (!isRecord(cycles) || !isList(blocksOf('opening'))) fail(`plans[${index}] opening blocks are missing`);
    if (!isList(blocksOf('toys')) && !isList(blocksOf('clear'))) fail(`plans[${index}] steady blocks are missing`);
    const hash = plan.sha256 ?? sha256(plan);
    if (typeof hash !== 'string') fail(`plans[${index}].sha256 is not a digest`);
    // The executor request validates every cycle's blocks before anything runs.
    return { night, timing: structuredClone(plan.timing) as NightTiming | undefined, cycles: structuredClone(cycles) as BundlePlan['cycles'],
      ...(plan.armVerification ? { armVerification: structuredClone(plan.armVerification) as ArmVerification } : {}),
      sha256: hash };
  });
  if (seen.size !== spec.nights.length) fail('campaign plans do not cover every target');
  return Object.freeze({ schema: CAMPAIGN_BUNDLE_SCHEMA, version: 1,
    specHash: stableHash(spec), plans: normalized,
    bundleHash: stableHash({ spec, plans: normalized }) });
}

/** Turn one validated campaign plan into the request consumed by the local executor. */
export function makeCampaignExecutionRequest({ bundle, plan: input, profile, mode = 'live', artifact = {}, armMode }:
  {bundle?: CampaignBundle, plan?: unknown, profile?: unknown, mode?: string,
    artifact?: { winnerHash?: string, engineHash?: string, profileHash?: string }, armMode?: string} = {}) {
  if (!isRecord(bundle) || bundle.schema !== CAMPAIGN_BUNDLE_SCHEMA) fail('validated campaign bundle is required');
  const bound = isRecord(input) && bundle.plans.find(item => item.night === input.night);
  if (!bound || !isRecord(input) || input.sha256 !== bound.sha256 || !same(input.timing, bound.timing) ||
      !same(input.cycles, bound.cycles) || !same(input.armVerification, bound.armVerification))
    fail('plan is not bound immutably to bundle');
  // Bound means stably equal to the bundle's own plan, field by field.
  const plan = input as unknown as BundlePlan;
  if (armMode !== undefined && !isOneOf(['blocking', 'observe-once'] as const, armMode))
    fail('armMode must be blocking or observe-once');
  if (armMode !== undefined && !plan.armVerification)
    fail('armMode requires an arm-verified plan');
  if (!isRecord(profile)) fail('resolved profile is required');
  const limits = isRecord(profile.limits) ? profile.limits : undefined;
  const requestArmVerification = plan.armVerification && armMode !== undefined
    ? { ...plan.armVerification, mode: armMode } : plan.armVerification;
  const request = {
    schema: 'device-executor-v1', version: 1, mode,
    artifact: { winnerHash: artifact.winnerHash ?? stableHash({ bundle: bundle.bundleHash, kind: 'winner' }),
      engineHash: artifact.engineHash ?? stableHash({ bundle: bundle.bundleHash, kind: 'engine' }),
      profileHash: artifact.profileHash ?? sha256(profile), profileStableHash: stableHash(profile),
      plans: [{ night: plan.night, sha256: plan.sha256, timing: plan.timing,
        ...(requestArmVerification ? { armVerification: structuredClone(requestArmVerification) } : {}) }] },
    profile: structuredClone(profile), limits: { maxActions: limits?.maxActions ?? 64,
      maxDurationMs: limits?.maxDurationMs ?? 15000 },
    blocks: Object.values(plan.cycles).flatMap(cycle => cycle.blocks.map(block => ({ ...(block as object), night: plan.night }))),
  };
  try { return validateExecutorRequest(request); }
  catch (error) { fail((error as Error).message); }
}
