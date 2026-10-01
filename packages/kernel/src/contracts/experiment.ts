/**
 * experiment-spec-v2 and experiment-result-v2 (ADR 0002 kernel, "Experiment"):
 * an experiment names its competing explanations and the observation that
 * separates them, and a census names its population, policy family, seeds and
 * held-out block. v1 (`validateExperiment`, `validateExperimentResult` in
 * index.ts) is still read; nothing here changes it.
 *
 * A spec v2 holds the question; `explanations[]`, each with its assumptions and
 * the observation it predicts, written as a predicate over named measures; the
 * separating observation, which names those measures; the cohort, a
 * development block and a named, disjoint held-out block, each a seed set that
 * says how it was derived (`golden`, `explicit` or `explicit-range`) and what
 * provenance its seeds stand for (the kernel Seed's `natural | pinned |
 * identified`); the deciding query; and the stopping rule.
 *
 * A result v2 tags every explanation `ruled-out` or `surviving`, with the
 * evidence for the tag, and reports each rate as successes of n with an
 * Interval and the method that produced it.
 *
 * Plain data only: expanding a golden cohort and hashing a seed list need the
 * generator and a digest, which live in Propose (`@sixam/propose/seeds`).
 */
import { fail, isList, isOneOf, isRecord, isText, validateClaimLevel } from '../labels.ts';
import { validateSeedProvenance } from '../seed.ts';
import { validateInterval } from '../time/interval.ts';
import type { ExperimentRate, ExperimentResultV2, ExperimentSpecV2, SeedDerivation, SeedSet } from './types.ts';

const EXPERIMENT_SPEC_V2 = 'experiment-spec-v2';
const EXPERIMENT_RESULT_V2 = 'experiment-result-v2';
/** A census makes a claim and holds the seed floor; a diagnostic sweep names the explanation it tests. */
export const EXPERIMENT_PURPOSES = Object.freeze(['census', 'diagnostic'] as const);
export const SEED_DERIVATIONS = Object.freeze(['golden', 'explicit', 'explicit-range'] as const);
const EXPLANATION_STATUSES = Object.freeze(['ruled-out', 'surviving'] as const);
const EXPERIMENT_PREDICATE_OPS = Object.freeze(['eq', 'ne', 'lt', 'le', 'gt', 'ge'] as const);
const STOPPING_KINDS = Object.freeze(['fixed-sample'] as const);
const DECIDING_BLOCKS = Object.freeze(['heldOut'] as const);
/**
 * How a rate's interval was computed. `exhaustive` is a count over the whole population, so its
 * interval is the point itself; `wilson-bonferroni` is a Wilson score interval at a per-rate
 * confidence split over the `comparisons` it is taken jointly with.
 */
export const RATE_METHODS = Object.freeze(['wilson', 'wilson-bonferroni', 'exhaustive'] as const);

const SEED_SET_FIELDS: readonly string[] = Object.freeze(['name', 'derivation', 'provenance', 'bracket', 'count', 'sha256', 'definition']);
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const matches = (pattern: RegExp, value: unknown) => typeof value === 'string' && pattern.test(value);
const isSeed = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1;
const texts = (value: unknown, label: string, { min = 1 } = {}): readonly string[] => {
  if (!isList(value) || value.length < min || !value.every(isText)) fail(`${label} is a list of at least ${min} non-empty text(s)`);
  return value;
};

/**
 * How a seed set was derived. `golden` is the SplitMix32 cohort of `count` distinct uint32 seeds
 * from `salt`, optionally reduced `mod modulus` (distinct nights, first occurrence kept);
 * `explicit` lists its seeds; `explicit-range` is every integer from `from` to `to`, both included.
 */
export function validateSeedDerivation(derivation: unknown, label: string = 'seed set'): SeedDerivation {
  if (!isRecord(derivation) || !isOneOf(SEED_DERIVATIONS, derivation.kind))
    fail(`${label}: derivation.kind must be one of ${SEED_DERIVATIONS.join(', ')}`);
  const only = (keys: readonly string[]) => {
    if (Object.keys(derivation).some(key => !keys.includes(key))) fail(`${label}: a ${derivation.kind} derivation is {${keys.join(', ')}}`);
  };
  if (derivation.kind === 'golden') {
    only(['kind', 'count', 'salt', 'modulus']);
    if (!isCount(derivation.count)) fail(`${label}: a golden derivation names a positive count`);
    if (!isSeed(derivation.salt)) fail(`${label}: a golden derivation names its unsigned 32-bit salt`);
    const modulus = derivation.modulus;
    if (modulus !== undefined && !(typeof modulus === 'number' && Number.isInteger(modulus) && modulus >= 2))
      fail(`${label}: a golden modulus is an integer of at least 2`);
  } else if (derivation.kind === 'explicit') {
    only(['kind', 'seeds']);
    const seeds = derivation.seeds;
    if (!isList(seeds) || !seeds.length || !seeds.every(isSeed))
      fail(`${label}: an explicit derivation lists unsigned 32-bit seeds`);
    if (new Set(seeds).size !== seeds.length) fail(`${label}: an explicit seed list repeats a seed`);
  } else {
    only(['kind', 'from', 'to']);
    if (!isSeed(derivation.from) || !isSeed(derivation.to) || derivation.from > derivation.to)
      fail(`${label}: an explicit range is {from, to} with 0 <= from <= to < 2^32`);
  }
  return derivation as unknown as SeedDerivation;
}

/** The count a derivation fixes without expanding it, or null for a golden cohort reduced by a modulus. */
export function derivedCount(derivation: SeedDerivation): number | null {
  if (derivation.kind === 'explicit') return derivation.seeds.length;
  if (derivation.kind === 'explicit-range') return derivation.to - derivation.from + 1;
  return derivation.modulus === undefined ? derivation.count : null;
}

/**
 * A seed set: {name, derivation, provenance, bracket? (pinned), count, sha256?, definition?}.
 * `sha256` is over JSON.stringify of the expanded seed list, as `seedCohortDescriptor` writes it.
 */
export function validateSeedSet(value: unknown, label: string = 'seed set'): SeedSet {
  if (!isRecord(value) || Object.keys(value).some(key => !SEED_SET_FIELDS.includes(key)))
    fail(`${label} is {${SEED_SET_FIELDS.join(', ')}} and nothing else`);
  if (!isText(value.name)) fail(`${label} is named`);
  const derivation = validateSeedDerivation(value.derivation, label);
  validateSeedProvenance(value.provenance, value.bracket);
  if (!isCount(value.count)) fail(`${label}: count is a positive integer`);
  const fixed = derivedCount(derivation);
  if (fixed !== null && fixed !== value.count) fail(`${label}: count ${value.count} is not the ${fixed} its derivation gives`);
  if (fixed === null && derivation.kind === 'golden' && value.count > derivation.count)
    fail(`${label}: a reduced golden cohort cannot outnumber its members`);
  if (value.sha256 !== undefined && !matches(SHA256, value.sha256)) fail(`${label}: sha256 is 64 lowercase hex digits`);
  if (value.definition !== undefined && !isText(value.definition)) fail(`${label}: a definition is non-empty text`);
  return value as unknown as SeedSet;
}

/** Seeds two sets are known to share without expanding a golden cohort; null when that needs the generator. */
export function knownOverlap(a: SeedSet, b: SeedSet): number | null {
  const list = (set: SeedSet) => set.derivation.kind === 'explicit' ? set.derivation.seeds : null;
  const range = (set: SeedSet) => set.derivation.kind === 'explicit-range' ? set.derivation : null;
  const inRange = (seeds: readonly number[], r: { from: number, to: number }) => seeds.filter(seed => seed >= r.from && seed <= r.to).length;
  const [listA, listB, rangeA, rangeB] = [list(a), list(b), range(a), range(b)];
  if (rangeA && rangeB) return Math.max(0, Math.min(rangeA.to, rangeB.to) - Math.max(rangeA.from, rangeB.from) + 1);
  if (listA && rangeB) return inRange(listA, rangeB);
  if (rangeA && listB) return inRange(listB, rangeA);
  if (listA && listB) { const seen = new Set(listA); return listB.filter(seed => seen.has(seed)).length; }
  return null;
}

function validatePredicate(predicate: unknown, measures: Set<string>, label: string) {
  if (!isRecord(predicate)) fail(`${label}: a predicate is a record`);
  const keys = Object.keys(predicate);
  if ('all' in predicate || 'any' in predicate) {
    const key = 'all' in predicate ? 'all' : 'any';
    const items = predicate[key];
    if (keys.length !== 1 || !isList(items) || !items.length)
      fail(`${label}: {${key}: [...]} holds at least one predicate and nothing else`);
    items.forEach((item, index) => validatePredicate(item, measures, `${label}.${key}[${index}]`));
    return;
  }
  if ('not' in predicate) {
    if (keys.length !== 1) fail(`${label}: {not: predicate} holds nothing else`);
    validatePredicate(predicate.not, measures, `${label}.not`);
    return;
  }
  if (keys.some(key => !['measure', 'op', 'value'].includes(key))) fail(`${label}: a comparison is {measure, op, value}`);
  if (typeof predicate.measure !== 'string' || !measures.has(predicate.measure))
    fail(`${label}: measure ${JSON.stringify(predicate.measure)} is not one the separating observation names`);
  if (!isOneOf(EXPERIMENT_PREDICATE_OPS, predicate.op)) fail(`${label}: op must be one of ${EXPERIMENT_PREDICATE_OPS.join(', ')}`);
  if (!Number.isFinite(predicate.value)) fail(`${label}: a comparison's value is a finite number`);
}

export function validateExperimentSpecV2(input: unknown): ExperimentSpecV2 {
  if (!isRecord(input) || input.schema !== EXPERIMENT_SPEC_V2) fail('experiment spec v2: schema must be experiment-spec-v2');
  if (!matches(ID, input.id)) fail('experiment spec v2: id is a short identifier');
  if (!isOneOf(EXPERIMENT_PURPOSES, input.purpose)) fail(`experiment spec v2: purpose must be one of ${EXPERIMENT_PURPOSES.join(', ')}`);
  if (!isText(input.question)) fail('experiment spec v2: the question is stated');
  validateClaimLevel(input.claimLevel);
  const observation = input.separatingObservation;
  if (!isRecord(observation) || !isText(observation.description)) fail('experiment spec v2: the separating observation is described');
  const named = texts(observation.measures, 'experiment spec v2: separatingObservation.measures');
  const measures = new Set<string>(named);
  if (measures.size !== named.length) fail('experiment spec v2: a measure is named twice');
  if (!isList(input.explanations) || input.explanations.length < 2)
    fail('experiment spec v2: an experiment names at least two competing explanations');
  const ids = new Set<unknown>();
  input.explanations.forEach((explanation, index) => {
    const label = `experiment spec v2: explanations[${index}]`;
    if (!isRecord(explanation) || !matches(ID, explanation.id)) fail(`${label} has a short id`);
    if (ids.has(explanation.id)) fail(`${label}: id ${explanation.id} is used twice`);
    ids.add(explanation.id);
    if (!isText(explanation.statement)) fail(`${label} states the explanation`);
    texts(explanation.assumptions, `${label}.assumptions`);
    if (!isRecord(explanation.predicts) || !isText(explanation.predicts.observation))
      fail(`${label}.predicts names the observation it predicts`);
    validatePredicate(explanation.predicts.when, measures, `${label}.predicts.when`);
  });
  const cohort = input.cohort;
  if (!isRecord(cohort)) fail('experiment spec v2: the cohort is a record');
  const population = cohort.population;
  if (!isRecord(population) || !isText(population.description) || !isCount(population.size))
    fail('experiment spec v2: cohort.population is {description, size}');
  const development = validateSeedSet(cohort.development, 'experiment spec v2: cohort.development');
  const heldOut = validateSeedSet(cohort.heldOut, 'experiment spec v2: cohort.heldOut');
  if (heldOut.name === development.name) fail('experiment spec v2: the held-out block has its own name');
  const shared = knownOverlap(development, heldOut);
  if (shared) fail(`experiment spec v2: the held-out block shares ${shared} seed(s) with the development block`);
  for (const set of [development, heldOut]) {
    if (set.count > population.size) fail(`experiment spec v2: ${set.name} is larger than its population`);
    const top = set.derivation.kind === 'explicit-range' ? set.derivation.to
      : set.derivation.kind === 'explicit' ? Math.max(...set.derivation.seeds) : null;
    if (top !== null && top >= population.size)
      fail(`experiment spec v2: ${set.name} reaches seed ${top}, outside its population 0..${population.size - 1}`);
  }
  if (input.purpose === 'census') {
    const family = input.family;
    if (!isRecord(family) || !isText(family.id) || !isText(family.description) || !isRecord(family.grid))
      fail('experiment spec v2: a census names its policy family {id, description, grid}');
  }
  const query = input.decidingQuery;
  if (!isRecord(query) || !isText(query.text) || !isOneOf(DECIDING_BLOCKS, query.block))
    fail(`experiment spec v2: the deciding query is {text, block} and is decided on ${DECIDING_BLOCKS.join(' or ')}`);
  const rule = input.stoppingRule;
  if (!isRecord(rule) || !isOneOf(STOPPING_KINDS, rule.kind) || !isText(rule.text))
    fail(`experiment spec v2: the stopping rule is {kind: ${STOPPING_KINDS.join(' | ')}, text}`);
  return input as unknown as ExperimentSpecV2;
}

/**
 * A reported rate: successes of n, with an Interval and the method (and confidence) behind it.
 */
export function validateRate(rate: unknown, label: string = 'rate'): ExperimentRate {
  if (!isRecord(rate) || !isText(rate.name)) fail(`${label} is a named record`);
  const { n, successes, confidence } = rate;
  if (!isCount(n) || typeof successes !== 'number' || !Number.isInteger(successes) || successes < 0 || successes > n)
    fail(`${label}: successes is a count in 0..n`);
  const value = successes / n;
  if (rate.rate !== value) fail(`${label}: rate is successes / n`);
  if (!isOneOf(RATE_METHODS, rate.method)) fail(`${label}: method must be one of ${RATE_METHODS.join(', ')}`);
  const interval = validateInterval(rate.interval);
  if (interval.lo < 0 || interval.hi > 1 || interval.lo > value || interval.hi < value)
    fail(`${label}: the interval lies in [0, 1] and holds the rate`);
  if (rate.method === 'exhaustive') {
    if (confidence !== 1 || interval.lo !== value || interval.hi !== value)
      fail(`${label}: an exhaustive count is the point itself, at confidence 1`);
  } else if (!(typeof confidence === 'number' && confidence > 0 && confidence < 1))
    fail(`${label}: a sampled interval names its confidence in (0, 1)`);
  const comparisons = rate.comparisons;
  if (rate.method === 'wilson-bonferroni' && !(typeof comparisons === 'number' && Number.isInteger(comparisons) && comparisons >= 1))
    fail(`${label}: a Bonferroni interval names how many comparisons it is taken jointly with`);
  return rate as unknown as ExperimentRate;
}

/**
 * An experiment-result-v2, and, given its spec, that it answers that spec.
 * @param spec when given, every one of its explanations must be tagged once
 */
export function validateExperimentResultV2(input: unknown, spec?: ExperimentSpecV2): ExperimentResultV2 {
  if (!isRecord(input) || input.schema !== EXPERIMENT_RESULT_V2) fail('experiment result v2: schema must be experiment-result-v2');
  if (!matches(ID, input.specId)) fail('experiment result v2: specId names the spec it answers');
  if (!matches(SHA256, input.specSha256)) fail('experiment result v2: specSha256 is the sha256 of the spec file it answers');
  validateClaimLevel(input.claimLevel);
  const observations = input.observations;
  if (!isRecord(observations) || !isOneOf(DECIDING_BLOCKS, observations.block) || !isRecord(observations.values))
    fail('experiment result v2: observations are {block, values} on the deciding block');
  const values = observations.values;
  for (const [name, value] of Object.entries(values))
    if (!Number.isFinite(value)) fail(`experiment result v2: observation ${name} is a finite number`);
  if (!isList(input.explanations) || !input.explanations.length) fail('experiment result v2: explanations are tagged');
  const tagged = new Set<unknown>();
  input.explanations.forEach((item, index) => {
    const label = `experiment result v2: explanations[${index}]`;
    if (!isRecord(item) || !matches(ID, item.id) || tagged.has(item.id)) fail(`${label} names one explanation once`);
    tagged.add(item.id);
    if (!isOneOf(EXPLANATION_STATUSES, item.status)) fail(`${label}: status must be one of ${EXPLANATION_STATUSES.join(', ')}`);
    const evidence = item.evidence;
    if (!isRecord(evidence) || typeof evidence.holds !== 'boolean' || !isRecord(evidence.values))
      fail(`${label}: the evidence is {holds, values, ...}`);
    if ((item.status === 'surviving') !== evidence.holds) fail(`${label}: an explanation survives exactly when its prediction holds`);
  });
  if (!isList(input.rates)) fail('experiment result v2: rates is a list');
  input.rates.forEach((rate, index) => validateRate(rate, `experiment result v2: rates[${index}]`));
  const stopped = input.stopped;
  if (!isRecord(stopped) || !isText(stopped.rule) || !isText(stopped.reached))
    fail('experiment result v2: stopped is {rule, reached}');
  if (spec) {
    validateExperimentSpecV2(spec);
    if (input.specId !== spec.id) fail(`experiment result v2: answers ${input.specId}, not ${spec.id}`);
    const expected = spec.explanations.map(item => item.id);
    if (expected.length !== tagged.size || expected.some(id => !tagged.has(id)))
      fail(`experiment result v2: tags ${[...tagged].join(', ')}, not the spec's ${expected.join(', ')}`);
    for (const measure of spec.separatingObservation.measures)
      if (!(measure in values)) fail(`experiment result v2: observation ${measure} is missing`);
  }
  return input as unknown as ExperimentResultV2;
}
