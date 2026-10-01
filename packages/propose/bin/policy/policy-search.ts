// Constrained structural policy search (Plan 21 package 4 foundation).
//
// This search intentionally takes its mutation dimensions from the caller. It
// does not invent a grammar outside policy-grammar.ts, and it records every
// candidate before Pareto pruning. The exact-engine replay is the admission
// gate; device-plan equivalence and contact floors are separate gates.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { canonicalPolicy, observationLanguage } from '@sixam/propose/policy';
import { closedFamilyMatches } from './closed-families.ts';
import { classifyPolicy, validateGrammarPolicy } from './policy-grammar.ts';
import { compilePolicy, replayPolicy } from './policy-interpreter.ts';
import { compileDevicePlan, comparePolicyToDevice } from './policy-equivalence.ts';

export const SEARCH_SCHEMA = 'policy-search-v1';
const clone = value => structuredClone(value);
const seedAt = index => (index * 2654435761) >>> 0;

function hashPolicy(policy) {
  return createHash('sha256').update(canonicalPolicy(policy)).digest('hex');
}

function reject(policy, reasons, extra = {}) {
  return {
    id: policy?.metadata?.id ?? null, hash: policy ? hashPolicy(policy) : null,
    status: 'rejected', reasons: [...reasons], policy: policy ? clone(policy) : null,
    ...extra,
  };
}

/** Enumerate only explicitly requested structural mutations. */
export function enumerateCandidates(base, {
  periods = [], dropRepeatActions = [],
} = {}) {
  const candidates = [{ label: 'base', policy: clone(base) }];
  for (const period of periods) {
    const policy = clone(base);
    policy.phases.find(phase => phase.kind === 'repeat').periodMs = period;
    policy.metadata.id = `${base.metadata.id}-period-${period}`;
    candidates.push({ label: `period-${period}`, policy });
  }
  for (const action of dropRepeatActions) {
    const policy = clone(base);
    const repeat = policy.phases.find(phase => phase.kind === 'repeat');
    repeat.actions = repeat.actions.filter(item => item.action !== action);
    policy.metadata.id = `${base.metadata.id}-drop-${action}`;
    candidates.push({ label: `drop-${action}`, policy });
  }
  return candidates;
}

function contactGate(policy, minContactMs) {
  const bad = [];
  for (const phase of policy.phases) for (const action of phase.actions ?? []) {
    if ((action.contactMs ?? 0) < minContactMs)
      bad.push(`${phase.id}:${action.action}:${action.contactMs ?? 0}<${minContactMs}`);
  }
  return bad;
}

function replayMetrics(policy, { night, seeds, worst = false }) {
  let survived = 0;
  const deaths = {};
  const untilMs = policy.phases.find(phase => phase.kind === 'observe')?.endMs;
  for (let i = 0; i < seeds; i++) {
    // Sim's `worst` mode is intentionally not silently substituted here: the
    // current policy-v1 adapter exposes exact normal replay only. A caller may
    // supply a separate exact worst-control runner in a later campaign.
    if (worst) throw new Error('policy search worst control requires an exact adapter');
    const result = replayPolicy(policy, { night, seed: seedAt(i), untilMs });
    if (result.sim.won) survived++;
    else {
      const reason = result.sim.death?.reason ?? 'not-won';
      deaths[reason] = (deaths[reason] ?? 0) + 1;
    }
  }
  return { survived, seeds, survival: survived / seeds, deaths };
}

/** Evaluate one candidate and retain every gate/provenance decision. */
export function evaluateCandidate(policy, {
  night = 1, seeds = 1200, minContactMs = 33, exactDevice = true,
  closedFamilyPolicy = 'reject',
} = {}) {
  if (closedFamilyPolicy !== 'reject' && closedFamilyPolicy !== 'record')
    throw new RangeError("closedFamilyPolicy must be 'reject' or 'record'");
  if (!Number.isInteger(seeds) || seeds <= 0)
    throw new RangeError('policy search seeds must be a positive integer');
  const reasons = [];
  let normal = null;
  let device = null;
  try {
    validateGrammarPolicy(policy);
  } catch (error) {
    reasons.push(`grammar:${error.message}`);
  }
  // The duplicate control runs before any expensive gate: re-running a family
  // Plans 05/06/16 already closed by negative costs seeds and proves nothing.
  const closedFamilies = (() => {
    try { return closedFamilyMatches(policy); } catch { return []; }
  })();
  if (!reasons.length && closedFamilyPolicy === 'reject' && closedFamilies.length)
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
  const classification = (() => {
    try { return classifyPolicy(policy); } catch { return { known: false, family: null }; }
  })();
  const metric = normal ? {
    survival: normal.survival,
    presses: compilePolicy(policy, { untilMs: policy.phases.find(p => p.kind === 'observe').endMs })
      .filter(event => event.kind === 'press').length,
  } : null;
  const result: any = reasons.length ? reject(policy, reasons) : {
    id: policy.metadata.id, hash: hashPolicy(policy), status: 'accepted', reasons: [],
    policy: clone(policy), normal, device, metric,
  };
  result.knownFamily = classification.family;
  result.closedFamilies = closedFamilies;
  result.dependencies = {
    sourceDependencies: [...(policy.metadata.sourceDependencies ?? [])],
    calibrationProfile: policy.metadata.calibrationProfile ?? null,
  };
  return result;
}

function dominates(a, b) {
  if (a.status !== 'accepted' || b.status !== 'accepted') return false;
  const noWorse = a.metric.survival >= b.metric.survival && a.metric.presses <= b.metric.presses;
  const better = a.metric.survival > b.metric.survival || a.metric.presses < b.metric.presses;
  return noWorse && better;
}

export function paretoFrontier(results) {
  return results.filter(candidate => candidate.status === 'accepted' &&
    !results.some(other => other !== candidate && dominates(other, candidate)));
}

export function runSearch(base, options: any = {}) {
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
