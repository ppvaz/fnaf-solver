// Constrained structural policy search (Plan 21 package 4 foundation).
//
// This search intentionally takes its mutation dimensions from the caller. It
// does not invent a grammar outside policy-grammar.ts, and it records every
// candidate before Pareto pruning. The exact-engine replay is the admission
// gate; device-plan equivalence and contact floors are separate gates.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { canonicalPolicy, observationLanguage } from '@sixam/propose/policy';
import type { PolicyAction, PolicyProgram } from '@sixam/propose/policy';
import { closedFamilyMatches } from './closed-families.ts';
import { classifyPolicy, validateGrammarPolicy } from './policy-grammar.ts';
import { smokeSeed } from '@sixam/propose/seeds';
import { compilePolicy, phaseOf, replayPolicy } from './policy-interpreter.ts';
import { compileDevicePlan, comparePolicyToDevice } from './policy-equivalence.ts';

export const SEARCH_SCHEMA = 'policy-search-v1';
const clone = <T>(value: T): T => structuredClone(value);

/** A clone of the base the search edits before the grammar checks it: the fields it sets are writable. */
type Draft = PolicyProgram & {
  metadata: { id: string },
  phases: readonly (PolicyProgram['phases'][number] & { periodMs: number, actions: readonly PolicyAction[] })[],
};
// A mutation edits the repeat phase, which a base the grammar accepted has once.
const editable = (policy: PolicyProgram) => clone(policy) as Draft;
const repeatOf = (policy: Draft) => policy.phases.find(phase => phase.kind === 'repeat') as Draft['phases'][number];

function hashPolicy(policy: PolicyProgram) {
  return createHash('sha256').update(canonicalPolicy(policy)).digest('hex');
}

function reject(policy: PolicyProgram | null, reasons: readonly string[], extra: Readonly<Record<string, unknown>> = {}) {
  return {
    id: policy?.metadata?.id ?? null, hash: policy ? hashPolicy(policy) : null,
    status: 'rejected' as const, reasons: [...reasons], policy: policy ? clone(policy) : null,
    ...extra,
  };
}

/** Enumerate only explicitly requested structural mutations. */
export function enumerateCandidates(base: PolicyProgram, {
  periods = [], dropRepeatActions = [],
}: { periods?: readonly number[], dropRepeatActions?: readonly string[] } = {}) {
  const candidates: { label: string, policy: PolicyProgram }[] = [{ label: 'base', policy: clone(base) }];
  for (const period of periods) {
    const policy = editable(base);
    repeatOf(policy).periodMs = period;
    policy.metadata.id = `${base.metadata.id}-period-${period}`;
    candidates.push({ label: `period-${period}`, policy });
  }
  for (const action of dropRepeatActions) {
    const policy = editable(base);
    const repeat = repeatOf(policy);
    repeat.actions = repeat.actions.filter(item => item.action !== action);
    policy.metadata.id = `${base.metadata.id}-drop-${action}`;
    candidates.push({ label: `drop-${action}`, policy });
  }
  return candidates;
}

function contactGate(policy: PolicyProgram, minContactMs: number) {
  const bad: string[] = [];
  for (const phase of policy.phases) for (const action of phase.actions ?? []) {
    if ((action.contactMs ?? 0) < minContactMs)
      bad.push(`${phase.id}:${action.action}:${action.contactMs ?? 0}<${minContactMs}`);
  }
  return bad;
}

function replayMetrics(policy: PolicyProgram, { night, seeds, worst = false }: { night: number, seeds: number, worst?: boolean }) {
  let survived = 0;
  const deaths: Record<string, number> = {};
  const untilMs = policy.phases.find(phase => phase.kind === 'observe')?.endMs;
  for (let i = 0; i < seeds; i++) {
    // Sim's `worst` mode is intentionally not silently substituted here: the
    // current policy-v1 adapter exposes exact normal replay only. A caller may
    // supply a separate exact worst-control runner in a later campaign.
    if (worst) throw new Error('policy search worst control requires an exact adapter');
    const result = replayPolicy(policy, { night, seed: smokeSeed(i), untilMs });
    if (result.sim.won) survived++;
    else {
      const reason = result.sim.death?.reason ?? 'not-won';
      deaths[reason] = (deaths[reason] ?? 0) + 1;
    }
  }
  return { survived, seeds, survival: survived / seeds, deaths };
}

/** Evaluate one candidate and retain every gate/provenance decision. */
/** How a candidate is judged: its night and seeds, the contact floor, and what a closed family does to it. */
interface EvaluateOptions { night?: number, seeds?: number, minContactMs?: number, exactDevice?: boolean, closedFamilyPolicy?: string }
/** A candidate that passed every gate, with the replay and device comparison that admitted it. */
interface Accepted {
  id: string, hash: string, status: 'accepted', reasons: string[], policy: PolicyProgram,
  normal: ReturnType<typeof replayMetrics> | null, device: ReturnType<typeof comparePolicyToDevice> | null,
  metric: { survival: number, presses: number } | null,
}
/** One evaluated candidate, with its family classification and what it depends on. */
type Evaluated = (ReturnType<typeof reject> | Accepted) & {
  knownFamily?: string | null, closedFamilies?: ReturnType<typeof closedFamilyMatches> | null,
  dependencies?: { sourceDependencies: unknown[], calibrationProfile: unknown },
};

export function evaluateCandidate(policy: PolicyProgram, {
  night = 1, seeds = 1200, minContactMs = 33, exactDevice = true,
  closedFamilyPolicy = 'reject',
}: EvaluateOptions = {}) {
  if (closedFamilyPolicy !== 'reject' && closedFamilyPolicy !== 'record')
    throw new RangeError("closedFamilyPolicy must be 'reject' or 'record'");
  if (!Number.isInteger(seeds) || seeds <= 0)
    throw new RangeError('policy search seeds must be a positive integer');
  const reasons: string[] = [];
  let normal: ReturnType<typeof replayMetrics> | null = null;
  let device: ReturnType<typeof comparePolicyToDevice> | null = null;
  try {
    validateGrammarPolicy(policy);
  } catch (error) {
    reasons.push(`grammar:${(error as Error).message}`);
  }
  // The duplicate control runs before any expensive gate: re-running a family
  // Plans 05/06/16 already closed by negative costs seeds and proves nothing.
  // A program the grammar refused has no shape to classify, so its closed
  // families are unknown (null), never "outside every family" ([]).
  const grammatical = !reasons.length;
  const closedFamilies = grammatical ? closedFamilyMatches(policy) : null;
  if (!reasons.length && closedFamilyPolicy === 'reject' && closedFamilies?.length)
    reasons.push(...closedFamilies.map(match => `closed-family:${match.id}:${match.detail}`));
  if (!reasons.length) {
    const contact = contactGate(policy, minContactMs);
    if (contact.length) reasons.push(`device-contact:${contact.join(',')}`);
  }
  if (!reasons.length) {
    const text = compileDevicePlan(policy);
    device = comparePolicyToDevice(policy, text);
    if (exactDevice && !device.equal)
      reasons.push(`device-equivalence:${JSON.stringify(device.mismatches.slice(0, 2))}`);
  }
  if (!reasons.length) {
    normal = replayMetrics(policy, { night, seeds });
    if (normal.survived !== seeds)
      reasons.push(`exact-survival:${normal.survived}/${seeds}`);
  }
  const classification = grammatical ? classifyPolicy(policy) : { known: false, family: null };
  const metric = normal ? {
    survival: normal.survival,
    presses: compilePolicy(policy, { untilMs: phaseOf(policy, 'observe').endMs })
      .filter(event => event.kind === 'press').length,
  } : null;
  const result: Evaluated = reasons.length ? reject(policy, reasons) : {
    id: policy.metadata.id, hash: hashPolicy(policy), status: 'accepted', reasons: [],
    policy: clone(policy), normal, device, metric,
  };
  result.knownFamily = classification.family;
  result.closedFamilies = closedFamilies;
  result.dependencies = {
    // Read as written: nothing checks that it is a list.
    sourceDependencies: [...(policy.metadata.sourceDependencies ?? []) as unknown[]],
    calibrationProfile: policy.metadata.calibrationProfile ?? null,
  };
  return result;
}

function dominates(a: Evaluated, b: Evaluated) {
  if (a.status !== 'accepted' || b.status !== 'accepted') return false;
  // An accepted candidate passed the replay, so it has a metric.
  const am = a.metric as NonNullable<Accepted['metric']>, bm = b.metric as NonNullable<Accepted['metric']>;
  const noWorse = am.survival >= bm.survival && am.presses <= bm.presses;
  const better = am.survival > bm.survival || am.presses < bm.presses;
  return noWorse && better;
}

export function paretoFrontier(results: readonly Evaluated[]) {
  return results.filter(candidate => candidate.status === 'accepted' &&
    !results.some(other => other !== candidate && dominates(other, candidate)));
}

export function runSearch(base: PolicyProgram, options: Parameters<typeof enumerateCandidates>[1] & EvaluateOptions & { output?: string } = {}) {
  const candidates = enumerateCandidates(base, options).map(({ policy }) =>
    evaluateCandidate(policy, options));
  const report = {
    schema: SEARCH_SCHEMA, baseId: base.metadata.id,
    options: { night: options.night ?? 1, seeds: options.seeds ?? 1200,
      minContactMs: options.minContactMs ?? 33,
      closedFamilyPolicy: options.closedFamilyPolicy ?? 'reject' },
    language: observationLanguage(),
    candidates, frontier: paretoFrontier(candidates).map(candidate => candidate.id),
  };
  if (options.output) writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1]?.endsWith('/policy-search.ts')) {
  console.error('policy-search.ts is a library; provide a policy and explicit dimensions from a campaign runner');
}
