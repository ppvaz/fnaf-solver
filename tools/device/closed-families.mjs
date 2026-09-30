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
import { OBSERVATION_BUDGET } from '@sixam/propose/policy';
import { knownPolicyShapes, policyBranches, structuralShape } from './policy-grammar.mjs';

const REGISTER = JSON.parse(readFileSync(
  new URL('./closed-families.json', import.meta.url), 'utf8'));

export const CLOSED_FAMILIES_SCHEMA = REGISTER.schema;
export const CLOSED_FAMILIES = Object.freeze(REGISTER.families.map(Object.freeze));

const RULES = {
  'no-observation-branch': (program) =>
    policyBranches(program).length === 0
      ? 'the program has no observation-conditioned branch, so its control flow never reads a game fact'
      : null,

  'known-shape-different-times': (program, { knownShapes }) => {
    // A program that does not validate has no shape to compare; the grammar
    // gate reports that separately.
    let shape;
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

/**
 * Classify a candidate against every recorded closure.
 *
 * @returns {{id: string, rule: string, plans: string[], detail: string}[]}
 *   one entry per closed family the candidate belongs to; empty when the
 *   candidate is outside every family closed to date.
 */
export function closedFamilyMatches(program, { knownShapes = knownPolicyShapes() } = {}) {
  const matches = [];
  for (const entry of CLOSED_FAMILIES) {
    const rule = RULES[entry.rule];
    if (!rule) throw new Error(`closed family ${entry.id} names unimplemented rule ${entry.rule}`);
    const detail = rule(program, { knownShapes });
    if (detail) matches.push({ id: entry.id, rule: entry.rule, plans: [...entry.plans], detail });
  }
  return matches;
}

/** Rejection reasons in the search's `reasons` format. */
export function closedFamilyReasons(program, options) {
  return closedFamilyMatches(program, options)
    .map(match => `closed-family:${match.id}:${match.detail}`);
}
