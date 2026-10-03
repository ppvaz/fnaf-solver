// Mechanical duplicate control for the invention search (Plan 05 package 6c).
//
// Plans 05, 06 and 16 closed real families by recorded negative. Until now
// that closure existed only as prose in those plan files, which means nothing
// stops a new campaign from rediscovering a refuted family and reporting it as
// a survivor. This module turns each closure into a check the search runs.
//
// A match is not an error. It is a classification: the candidate belongs to a
// family that has already been searched to a wall. A campaign may deliberately
// admit one as a declared control (that is what `mode: 'record'` is for), but
// it may not admit one by accident.
import { readFileSync } from 'node:fs';
import { isList, isRecord } from '@sixam/kernel';
import { OBSERVATION_BUDGET } from '@sixam/propose/policy';
import type { PolicyProgram } from '@sixam/propose/policy';
import { knownPolicyShapes, policyBranches, structuralShape } from './policy-grammar.ts';

/** What a rule is told besides the program: the timing-free shapes of the known families. */
interface RuleContext { readonly knownShapes: ReadonlyMap<string, string> }
const RULES: Readonly<Record<string, (program: PolicyProgram, context: RuleContext) => string | null>> = {
  'no-observation-branch': (program) =>
    policyBranches(program).length === 0
      ? 'the program has no observation-conditioned branch, so its control flow never reads a game fact'
      : null,

  'known-shape-different-times': (program, { knownShapes }) => {
    // A program that does not validate has no shape to compare; the grammar
    // gate reports that separately.
    let shape: string;
    try { shape = structuralShape(program); } catch { return null; }
    const known = knownShapes.get(shape);
    if (!known) return null;
    return `structurally identical to the ${known} family; only action times differ`;
  },

  'branch-on-audio-fact': (program) => {
    const audio = policyBranches(program)
      .map(branch => branch.observe?.fact)
      .filter(fact => OBSERVATION_BUDGET[fact]?.channel === 'audio');
    return audio.length
      ? `branches on audio fact(s) ${[...new Set(audio)].join(', ')}`
      : null;
  },
};

/** A family closed by recorded negative: the rule that recognises it and the plans that closed it. */
interface ClosedFamily { readonly id: string, readonly rule: string, readonly plans: readonly string[] }
const SCHEMA = 'closed-policy-families-v1';

/**
 * The register, checked: its schema, and each family's id, implemented rule and closing plans. A rule nobody
 * implemented is refused here, when the register loads, rather than when a candidate first meets it.
 */
export function parseClosedFamilies(value: unknown, where: string): { readonly schema: string, readonly families: readonly ClosedFamily[] } {
  const refuse = (why: string): never => { throw new Error(`${where}: ${why}`); };
  if (!isRecord(value) || value.schema !== SCHEMA) return refuse(`schema must be ${SCHEMA}`);
  if (!isList(value.families)) return refuse('families must be a list');
  for (const family of value.families) {
    if (!isRecord(family) || typeof family.id !== 'string' || !family.id) return refuse('a family needs an id');
    if (typeof family.rule !== 'string' || !Object.hasOwn(RULES, family.rule))
      refuse(`family ${family.id} names unimplemented rule ${String(family.rule)}`);
    if (!isList(family.plans) || !family.plans.every((plan) => typeof plan === 'string'))
      refuse(`family ${family.id}: plans must list the plans that closed it`);
  }
  return value as unknown as { readonly schema: string, readonly families: readonly ClosedFamily[] };
}

const REGISTER_URL = new URL('../../bindings/closed-families.json', import.meta.url);
const REGISTER = parseClosedFamilies(JSON.parse(readFileSync(REGISTER_URL, 'utf8')), 'closed-families.json');

export const CLOSED_FAMILIES_SCHEMA = REGISTER.schema;
export const CLOSED_FAMILIES = Object.freeze(REGISTER.families.map(family => Object.freeze(family)));

/**
 * Classify a candidate against every recorded closure.
 *
 * @returns 
 *   one entry per closed family the candidate belongs to; empty when the
 *   candidate is outside every family closed to date.
 */
export function closedFamilyMatches(program: PolicyProgram, { knownShapes = knownPolicyShapes() }: Partial<RuleContext> = {}): {id: string, rule: string, plans: string[], detail: string}[] {
  const matches = [];
  for (const entry of CLOSED_FAMILIES) {
    const detail = RULES[entry.rule](program, { knownShapes });
    if (detail) matches.push({ id: entry.id, rule: entry.rule, plans: [...entry.plans], detail });
  }
  return matches;
}

/** Rejection reasons in the search's `reasons` format. */
export function closedFamilyReasons(program: PolicyProgram, options?: Partial<RuleContext>) {
  return closedFamilyMatches(program, options)
    .map(match => `closed-family:${match.id}:${match.detail}`);
}
