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
import { fail, isRecord, isText, validateClaimLevel } from '../labels.ts';
import { validateSeedProvenance } from '../seed.ts';
import { validateInterval } from '../time/interval.ts';
import type { ExperimentSpecV2 } from './types.ts';

const EXPERIMENT_SPEC_V2 = 'experiment-spec-v2';
const EXPERIMENT_RESULT_V2 = 'experiment-result-v2';
/** A census makes a claim and holds the seed floor; a diagnostic sweep names the explanation it tests. */
export const EXPERIMENT_PURPOSES = Object.freeze(['census', 'diagnostic']);
export const SEED_DERIVATIONS = Object.freeze(['golden', 'explicit', 'explicit-range']);
const EXPLANATION_STATUSES = Object.freeze(['ruled-out', 'surviving']);
const EXPERIMENT_PREDICATE_OPS = Object.freeze(['eq', 'ne', 'lt', 'le', 'gt', 'ge']);
const STOPPING_KINDS = Object.freeze(['fixed-sample']);
const DECIDING_BLOCKS = Object.freeze(['heldOut']);
/**
 * How a rate's interval was computed. `exhaustive` is a count over the whole population, so its
 * interval is the point itself; `wilson-bonferroni` is a Wilson score interval at a per-rate
 * confidence split over the `comparisons` it is taken jointly with.
 */
export const RATE_METHODS = Object.freeze(['wilson', 'wilson-bonferroni', 'exhaustive']);

const SEED_SET_FIELDS = Object.freeze(['name', 'derivation', 'provenance', 'bracket', 'count', 'sha256', 'definition']);
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const isSeed = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const isCount = value => Number.isInteger(value) && value >= 1;
const texts = (value, label, { min = 1 } = {}) => {
  if (!Array.isArray(value) || value.length < min || !value.every(isText)) fail(`${label} is a list of at least ${min} non-empty text(s)`);
  return value;
};

/**
 * How a seed set was derived. `golden` is the SplitMix32 cohort of `count` distinct uint32 seeds
 * from `salt`, optionally reduced `mod modulus` (distinct nights, first occurrence kept);
 * `explicit` lists its seeds; `explicit-range` is every integer from `from` to `to`, both included.
 */
export function validateSeedDerivation(derivation: any, label: string = 'seed set') {
  if (!isRecord(derivation) || !SEED_DERIVATIONS.includes(derivation.kind))
    fail(`${label}: derivation.kind must be one of ${SEED_DERIVATIONS.join(', ')}`);
  const only = keys => { if (Object.keys(derivation).some(key => !keys.includes(key))) fail(`${label}: a ${derivation.kind} derivation is {${keys.join(', ')}}`); };
  if (derivation.kind === 'golden') {
    only(['kind', 'count', 'salt', 'modulus']);
    if (!isCount(derivation.count)) fail(`${label}: a golden derivation names a positive count`);
    if (!isSeed(derivation.salt)) fail(`${label}: a golden derivation names its unsigned 32-bit salt`);
    if (derivation.modulus !== undefined && !(Number.isInteger(derivation.modulus) && derivation.modulus >= 2))
      fail(`${label}: a golden modulus is an integer of at least 2`);
  } else if (derivation.kind === 'explicit') {
    only(['kind', 'seeds']);
    if (!Array.isArray(derivation.seeds) || !derivation.seeds.length || !derivation.seeds.every(isSeed))
      fail(`${label}: an explicit derivation lists unsigned 32-bit seeds`);
    if (new Set(derivation.seeds).size !== derivation.seeds.length) fail(`${label}: an explicit seed list repeats a seed`);
  } else {
    only(['kind', 'from', 'to']);
    if (!isSeed(derivation.from) || !isSeed(derivation.to) || derivation.from > derivation.to)
      fail(`${label}: an explicit range is {from, to} with 0 <= from <= to < 2^32`);
  }
  return derivation;
}

/** The count a derivation fixes without expanding it, or null for a golden cohort reduced by a modulus. */
export function derivedCount(derivation) {
  if (derivation.kind === 'explicit') return derivation.seeds.length;
  if (derivation.kind === 'explicit-range') return derivation.to - derivation.from + 1;
  return derivation.modulus === undefined ? derivation.count : null;
}

/**
 * A seed set: {name, derivation, provenance, bracket? (pinned), count, sha256?, definition?}.
 * `sha256` is over JSON.stringify of the expanded seed list, as `seedCohortDescriptor` writes it.
 */
export function validateSeedSet(value: any, label: string = 'seed set') {
  if (!isRecord(value) || Object.keys(value).some(key => !SEED_SET_FIELDS.includes(key)))
    fail(`${label} is {${SEED_SET_FIELDS.join(', ')}} and nothing else`);
  if (!isText(value.name)) fail(`${label} is named`);
  validateSeedDerivation(value.derivation, label);
  validateSeedProvenance(value.provenance, value.bracket);
  if (!isCount(value.count)) fail(`${label}: count is a positive integer`);
  const fixed = derivedCount(value.derivation);
  if (fixed !== null && fixed !== value.count) fail(`${label}: count ${value.count} is not the ${fixed} its derivation gives`);
  if (fixed === null && value.count > value.derivation.count) fail(`${label}: a reduced golden cohort cannot outnumber its members`);
  if (value.sha256 !== undefined && !SHA256.test(value.sha256)) fail(`${label}: sha256 is 64 lowercase hex digits`);
  if (value.definition !== undefined && !isText(value.definition)) fail(`${label}: a definition is non-empty text`);
  return value;
}

/** Seeds two sets are known to share without expanding a golden cohort; null when that needs the generator. */
export function knownOverlap(a, b) {
  const list = set => set.derivation.kind === 'explicit' ? set.derivation.seeds : null;
  const range = set => set.derivation.kind === 'explicit-range' ? set.derivation : null;
  if (range(a) && range(b)) return Math.max(0, Math.min(a.derivation.to, b.derivation.to) - Math.max(a.derivation.from, b.derivation.from) + 1);
  const inRange = (seeds, r) => seeds.filter(seed => seed >= r.from && seed <= r.to).length;
  if (list(a) && range(b)) return inRange(list(a), range(b));
  if (range(a) && list(b)) return inRange(list(b), range(a));
  if (list(a) && list(b)) { const seen = new Set(list(a)); return list(b).filter(seed => seen.has(seed)).length; }
  return null;
}

function validatePredicate(predicate: any, measures: Set<string>, label: string) {
  if (!isRecord(predicate)) fail(`${label}: a predicate is a record`);
  const keys = Object.keys(predicate);
  if ('all' in predicate || 'any' in predicate) {
    const key = 'all' in predicate ? 'all' : 'any';
    if (keys.length !== 1 || !Array.isArray(predicate[key]) || !predicate[key].length)
      fail(`${label}: {${key}: [...]} holds at least one predicate and nothing else`);
    predicate[key].forEach((item, index) => validatePredicate(item, measures, `${label}.${key}[${index}]`));
    return;
  }
  if ('not' in predicate) {
    if (keys.length !== 1) fail(`${label}: {not: predicate} holds nothing else`);
    validatePredicate(predicate.not, measures, `${label}.not`);
    return;
  }
  if (keys.some(key => !['measure', 'op', 'value'].includes(key))) fail(`${label}: a comparison is {measure, op, value}`);
  if (!measures.has(predicate.measure)) fail(`${label}: measure ${JSON.stringify(predicate.measure)} is not one the separating observation names`);
  if (!EXPERIMENT_PREDICATE_OPS.includes(predicate.op)) fail(`${label}: op must be one of ${EXPERIMENT_PREDICATE_OPS.join(', ')}`);
  if (!Number.isFinite(predicate.value)) fail(`${label}: a comparison's value is a finite number`);
}

export function validateExperimentSpecV2(input: any): ExperimentSpecV2 {
  if (!isRecord(input) || input.schema !== EXPERIMENT_SPEC_V2) fail('experiment spec v2: schema must be experiment-spec-v2');
  if (!ID.test(input.id ?? '')) fail('experiment spec v2: id is a short identifier');
  if (!EXPERIMENT_PURPOSES.includes(input.purpose)) fail(`experiment spec v2: purpose must be one of ${EXPERIMENT_PURPOSES.join(', ')}`);
  if (!isText(input.question)) fail('experiment spec v2: the question is stated');
  validateClaimLevel(input.claimLevel);
  const observation = input.separatingObservation;
  if (!isRecord(observation) || !isText(observation.description)) fail('experiment spec v2: the separating observation is described');
  const measures = new Set<string>(texts(observation.measures, 'experiment spec v2: separatingObservation.measures'));
  if (measures.size !== observation.measures.length) fail('experiment spec v2: a measure is named twice');
  if (!Array.isArray(input.explanations) || input.explanations.length < 2)
    fail('experiment spec v2: an experiment names at least two competing explanations');
  const ids = new Set();
  input.explanations.forEach((explanation, index) => {
    const label = `experiment spec v2: explanations[${index}]`;
    if (!isRecord(explanation) || !ID.test(explanation.id ?? '')) fail(`${label} has a short id`);
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
  if (!isRecord(cohort.population) || !isText(cohort.population.description) || !isCount(cohort.population.size))
    fail('experiment spec v2: cohort.population is {description, size}');
  validateSeedSet(cohort.development, 'experiment spec v2: cohort.development');
  validateSeedSet(cohort.heldOut, 'experiment spec v2: cohort.heldOut');
  if (cohort.heldOut.name === cohort.development.name) fail('experiment spec v2: the held-out block has its own name');
  const shared = knownOverlap(cohort.development, cohort.heldOut);
  if (shared) fail(`experiment spec v2: the held-out block shares ${shared} seed(s) with the development block`);
  for (const set of [cohort.development, cohort.heldOut]) {
    if (set.count > cohort.population.size) fail(`experiment spec v2: ${set.name} is larger than its population`);
    const top = set.derivation.kind === 'explicit-range' ? set.derivation.to
      : set.derivation.kind === 'explicit' ? Math.max(...set.derivation.seeds) : null;
    if (top !== null && top >= cohort.population.size)
      fail(`experiment spec v2: ${set.name} reaches seed ${top}, outside its population 0..${cohort.population.size - 1}`);
  }
  if (input.purpose === 'census') {
    if (!isRecord(input.family) || !isText(input.family.id) || !isText(input.family.description) || !isRecord(input.family.grid))
      fail('experiment spec v2: a census names its policy family {id, description, grid}');
  }
  const query = input.decidingQuery;
  if (!isRecord(query) || !isText(query.text) || !DECIDING_BLOCKS.includes(query.block))
    fail(`experiment spec v2: the deciding query is {text, block} and is decided on ${DECIDING_BLOCKS.join(' or ')}`);
  const rule = input.stoppingRule;
  if (!isRecord(rule) || !STOPPING_KINDS.includes(rule.kind) || !isText(rule.text))
    fail(`experiment spec v2: the stopping rule is {kind: ${STOPPING_KINDS.join(' | ')}, text}`);
  return (input as ExperimentSpecV2);
}

/**
 * A reported rate: successes of n, with an Interval and the method (and confidence) behind it.
 */
export function validateRate(rate: any, label: string = 'rate') {
  if (!isRecord(rate) || !isText(rate.name)) fail(`${label} is a named record`);
  if (!isCount(rate.n) || !Number.isInteger(rate.successes) || rate.successes < 0 || rate.successes > rate.n)
    fail(`${label}: successes is a count in 0..n`);
  if (rate.rate !== rate.successes / rate.n) fail(`${label}: rate is successes / n`);
  if (!RATE_METHODS.includes(rate.method)) fail(`${label}: method must be one of ${RATE_METHODS.join(', ')}`);
  validateInterval(rate.interval);
  if (rate.interval.lo < 0 || rate.interval.hi > 1 || rate.interval.lo > rate.rate || rate.interval.hi < rate.rate)
    fail(`${label}: the interval lies in [0, 1] and holds the rate`);
  if (rate.method === 'exhaustive') {
    if (rate.confidence !== 1 || rate.interval.lo !== rate.rate || rate.interval.hi !== rate.rate)
      fail(`${label}: an exhaustive count is the point itself, at confidence 1`);
  } else if (!(rate.confidence > 0 && rate.confidence < 1)) fail(`${label}: a sampled interval names its confidence in (0, 1)`);
  if (rate.method === 'wilson-bonferroni' && !(Number.isInteger(rate.comparisons) && rate.comparisons >= 1))
    fail(`${label}: a Bonferroni interval names how many comparisons it is taken jointly with`);
  return rate;
}

/**
 * 
 * @param spec when given, every one of its explanations must be tagged once
 */
export function validateExperimentResultV2(input: any, spec?: ExperimentSpecV2) {
  if (!isRecord(input) || input.schema !== EXPERIMENT_RESULT_V2) fail('experiment result v2: schema must be experiment-result-v2');
  if (!ID.test(input.specId ?? '')) fail('experiment result v2: specId names the spec it answers');
  if (!SHA256.test(input.specSha256 ?? '')) fail('experiment result v2: specSha256 is the sha256 of the spec file it answers');
  validateClaimLevel(input.claimLevel);
  if (!isRecord(input.observations) || !DECIDING_BLOCKS.includes(input.observations.block) || !isRecord(input.observations.values))
    fail('experiment result v2: observations are {block, values} on the deciding block');
  for (const [name, value] of Object.entries(input.observations.values))
    if (!Number.isFinite(value)) fail(`experiment result v2: observation ${name} is a finite number`);
  if (!Array.isArray(input.explanations) || !input.explanations.length) fail('experiment result v2: explanations are tagged');
  const tagged = new Set();
  input.explanations.forEach((item, index) => {
    const label = `experiment result v2: explanations[${index}]`;
    if (!isRecord(item) || !ID.test(item.id ?? '') || tagged.has(item.id)) fail(`${label} names one explanation once`);
    tagged.add(item.id);
    if (!EXPLANATION_STATUSES.includes(item.status)) fail(`${label}: status must be one of ${EXPLANATION_STATUSES.join(', ')}`);
    if (!isRecord(item.evidence) || typeof item.evidence.holds !== 'boolean' || !isRecord(item.evidence.values))
      fail(`${label}: the evidence is {holds, values, ...}`);
    if ((item.status === 'surviving') !== item.evidence.holds) fail(`${label}: an explanation survives exactly when its prediction holds`);
  });
  if (!Array.isArray(input.rates)) fail('experiment result v2: rates is a list');
  input.rates.forEach((rate, index) => validateRate(rate, `experiment result v2: rates[${index}]`));
  if (!isRecord(input.stopped) || !isText(input.stopped.rule) || !isText(input.stopped.reached))
    fail('experiment result v2: stopped is {rule, reached}');
  if (spec) {
    validateExperimentSpecV2(spec);
    if (input.specId !== spec.id) fail(`experiment result v2: answers ${input.specId}, not ${spec.id}`);
    const expected = spec.explanations.map(item => item.id);
    if (expected.length !== tagged.size || expected.some(id => !tagged.has(id)))
      fail(`experiment result v2: tags ${[...tagged].join(', ')}, not the spec's ${expected.join(', ')}`);
    for (const measure of spec.separatingObservation.measures)
      if (!(measure in input.observations.values)) fail(`experiment result v2: observation ${measure} is missing`);
  }
  return input;
}
