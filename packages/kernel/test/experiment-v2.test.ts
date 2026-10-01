// Contract test for experiment-spec-v2 and experiment-result-v2 (packages/kernel/src/contracts/experiment.ts)
// and the kernel Seed (src/seed.js): a spec names at least two competing explanations, each predicting
// an observation over measures the separating observation names; its cohort is a development block and
// a named, disjoint held-out block, each saying how it was derived and what provenance its seeds stand
// for; a result tags every explanation once, surviving exactly when its prediction held, and reports
// every rate with an Interval and its method. v1 is still read.
import assert from 'node:assert/strict';
import { SEED_BELIEFS, SEED_PROVENANCES, validateSeed, validateSeedProvenance } from '../src/index.ts';
import {
  CONTRACTS, EXPERIMENT_PURPOSES, RATE_METHODS, SEED_DERIVATIONS, derivedCount, knownOverlap, validateExperiment,
  validateExperimentResultV2, validateExperimentSpecV2, validateRate, validateSeedSet,
} from '../src/contracts/index.ts';

const refuses = (fn, pattern, what) => assert.throws(fn, error => error instanceof TypeError && pattern.test(error.message), what);
const clone = value => JSON.parse(JSON.stringify(value));

assert.ok(CONTRACTS.includes('experiment-spec-v2') && CONTRACTS.includes('experiment-result-v2'));
assert.ok(CONTRACTS.includes('experiment-spec-v1') && CONTRACTS.includes('experiment-result-v1'), 'v1 stays registered');
assert.deepEqual([...SEED_DERIVATIONS], ['golden', 'explicit', 'explicit-range']);
assert.deepEqual([...SEED_PROVENANCES], ['natural', 'pinned', 'identified']);
assert.deepEqual([...SEED_BELIEFS], ['known', 'candidates', 'unknown']);
assert.deepEqual([...EXPERIMENT_PURPOSES], ['census', 'diagnostic']);
assert.deepEqual([...RATE_METHODS], ['wilson', 'wilson-bonferroni', 'exhaustive']);

// The kernel Seed: a pinned seed carries its bracket and only it does; a known seed carries its value.
assert.equal(validateSeedProvenance('natural'), 'natural');
assert.equal(validateSeedProvenance('pinned', { lo: 24848, hi: 24854 }), 'pinned');
refuses(() => validateSeedProvenance('pinned'), /bracket/, 'a pinned seed without its bracket');
refuses(() => validateSeedProvenance('natural', { lo: 0, hi: 1 }), /no bracket/, 'a natural seed with a bracket');
refuses(() => validateSeedProvenance('adversarial'), /provenance/, 'adversarial is an RNG mode, not a seed');
assert.ok(validateSeed({ provenance: 'identified', belief: 'known', value: 24850 }));
assert.ok(validateSeed({ provenance: 'natural', belief: 'candidates', candidates: [51376, 51377] }));
assert.ok(validateSeed({ provenance: 'natural', belief: 'unknown' }));
refuses(() => validateSeed({ provenance: 'natural', belief: 'known' }), /value/, 'a known seed without its value');
refuses(() => validateSeed({ provenance: 'natural', belief: 'candidates', candidates: [1, 1] }), /distinct/, 'a repeated candidate');
refuses(() => validateSeed({ provenance: 'natural', belief: 'unknown', origin: 0 }), /nothing else/, 'origin is a time zero, not a seed field');

// Seed sets and their derivations.
const range = (name, from, to) => ({ name, derivation: { kind: 'explicit-range', from, to }, provenance: 'natural', count: to - from + 1 });
const development = range('development', 0, 2999);
const heldOut = range('held-out', 40000, 42999);
assert.equal(validateSeedSet(development), development);
assert.equal(derivedCount(development.derivation), 3000);
assert.equal(derivedCount({ kind: 'golden', count: 3000, salt: 1, modulus: 65536 }), null, 'a reduced golden cohort needs the generator');
assert.ok(validateSeedSet({ name: 'golden', derivation: { kind: 'golden', count: 3000, salt: 0x9e3779b9, modulus: 65536 },
  provenance: 'natural', count: 2932 }));
assert.ok(validateSeedSet({ name: 'listed', derivation: { kind: 'explicit', seeds: [7, 3, 9] }, provenance: 'pinned',
  bracket: { lo: 0, hi: 10 }, count: 3, sha256: 'a'.repeat(64), definition: 'three pinned nights' }));
refuses(() => validateSeedSet({ ...development, count: 2999 }), /count 2999/, 'a count the derivation does not give');
refuses(() => validateSeedSet({ ...development, derivation: { kind: 'explicit-range', from: 9, to: 3 } }), /from <= to/, 'an inverted range');
refuses(() => validateSeedSet({ ...development, derivation: { kind: 'explicit', seeds: [1, 1] }, count: 2 }), /repeats/, 'a repeated explicit seed');
refuses(() => validateSeedSet({ ...development, derivation: { kind: 'sampled', count: 3 } }), /derivation\.kind/, 'an unnamed derivation');
refuses(() => validateSeedSet({ ...development, derivation: { kind: 'explicit-range', from: 0, to: 2999, salt: 1 } }), /explicit-range derivation is/,
  'a salt beside an explicit range misstates its derivation (LEG-010)');
refuses(() => validateSeedSet({ ...development, provenance: 'drawn' }), /provenance/, 'a provenance outside the kernel Seed');
refuses(() => validateSeedSet({ ...development, sha256: 'xyz' }), /sha256/, 'a malformed sha256');
assert.equal(knownOverlap(development, heldOut), 0);
assert.equal(knownOverlap(development, range('overlap', 2990, 5999)), 10);
assert.equal(knownOverlap({ ...development, derivation: { kind: 'explicit', seeds: [1, 5000] }, count: 2 }, range('r', 4000, 6000)), 1);
assert.equal(knownOverlap(development, { name: 'g', derivation: { kind: 'golden', count: 3, salt: 1 }, provenance: 'natural', count: 3 }), null);

// A spec.
const measures = ['classesLosing', 'classesPartial'];
const spec = {
  schema: 'experiment-spec-v2', id: 'fixture-band', purpose: 'census', claimLevel: 'MODEL_ONLY',
  question: 'Does every deliverable phase of the policy win every seed?',
  family: { id: 'fixture-family', description: 'one binding at every epoch of its band', grid: { epochMs: { from: 0, to: 3, stepMs: 1 } } },
  explanations: [
    { id: 'E1-flat', statement: 'the band is flat', assumptions: ['the exact lane'],
      predicts: { observation: 'no class loses a seed', when: { all: [{ measure: 'classesLosing', op: 'eq', value: 0 }] } } },
    { id: 'E2-perforated', statement: 'the phase decides some classes', assumptions: ['the exact lane'],
      predicts: { observation: 'a class loses, and only whole', when: { all: [{ measure: 'classesLosing', op: 'gt', value: 0 },
        { measure: 'classesPartial', op: 'eq', value: 0 }] } } },
    { id: 'E3-seeded', statement: 'the seed decides some classes', assumptions: ['the exact lane'],
      predicts: { observation: 'a class loses some seeds but not all', when: { measure: 'classesPartial', op: 'gt', value: 0 } } },
  ],
  separatingObservation: { description: 'per class, held-out losses: none, all or some', measures },
  cohort: { population: { description: 'every 16-bit seed', size: 65536 }, development, heldOut },
  decidingQuery: { text: 'count the classes by their held-out losses', block: 'heldOut' },
  stoppingRule: { kind: 'fixed-sample', text: 'both blocks run to the end; nothing is added' },
};
assert.equal(validateExperimentSpecV2(spec), spec);
refuses(() => validateExperiment(spec), /experiment spec is incomplete/, 'a v2 spec is not read as v1');
const broken = (edit, pattern, what) => { const copy = clone(spec); edit(copy); refuses(() => validateExperimentSpecV2(copy), pattern, what); };
broken(s => { s.explanations = s.explanations.slice(0, 1); }, /at least two competing explanations/, 'one explanation competes with nothing');
broken(s => { s.explanations[1].id = 'E1-flat'; }, /used twice/, 'a repeated explanation id');
broken(s => { s.explanations[0].assumptions = []; }, /assumptions/, 'an explanation with no assumptions');
broken(s => { s.explanations[2].predicts.when.measure = 'winRate'; }, /not one the separating observation names/, 'a prediction over an unnamed measure');
broken(s => { s.explanations[2].predicts.when.op = 'approx'; }, /op must be/, 'an unknown comparison');
broken(s => { s.explanations[2].predicts.when = { all: [] }; }, /at least one predicate/, 'an empty conjunction');
broken(s => { s.cohort.heldOut = range('held-out', 2000, 4999); }, /shares 1000 seed/, 'an overlapping held-out block');
broken(s => { s.cohort.heldOut.name = 'development'; }, /its own name/, 'a held-out block without its own name');
broken(s => { s.cohort.heldOut = range('held-out', 65000, 70000); }, /outside its population/, 'a block outside its population');
broken(s => { s.cohort.population.size = 2000; }, /larger than its population/, 'a block larger than its population');
broken(s => { delete s.family; }, /policy family/, 'a census without its policy family');
broken(s => { s.decidingQuery.block = 'development'; }, /decided on heldOut/, 'a query decided on the block it was developed on');
broken(s => { s.stoppingRule.kind = 'until-significant'; }, /stopping rule/, 'an optional-stopping rule');
broken(s => { s.purpose = 'sandbox'; }, /purpose/, 'there is no sandbox');
broken(s => { s.claimLevel = 'MEASURED'; }, /claim level/, 'a source label is not a claim level');
const diagnostic = clone(spec);
diagnostic.purpose = 'diagnostic';
delete diagnostic.family;
assert.ok(validateExperimentSpecV2(diagnostic), 'a diagnostic sweep names the explanation it tests, not a family');

// Rates.
const rate = { name: 'k3 band minimum', successes: 3000, n: 3000, rate: 1, interval: { lo: 0.99872, hi: 1 }, method: 'wilson', confidence: 0.95 };
assert.equal(validateRate(rate), rate);
assert.ok(validateRate({ ...rate, method: 'exhaustive', n: 65536, successes: 65536, interval: { lo: 1, hi: 1 }, confidence: 1 }));
assert.ok(validateRate({ ...rate, method: 'wilson-bonferroni', comparisons: 9 }));
refuses(() => validateRate({ ...rate, rate: 0.5 }), /successes \/ n/, 'a rate that is not its count');
refuses(() => validateRate({ ...rate, interval: { lo: 0.9, hi: 0.95 } }), /holds the rate/, 'an interval that misses its point');
refuses(() => validateRate({ ...rate, interval: { low: 0.9, high: 1 } }), /\{lo, hi\}/, 'the v1 {low, high} shape is not a kernel Interval');
refuses(() => validateRate({ ...rate, method: 'exhaustive' }), /exhaustive count is the point/, 'an exhaustive rate with a spread');
refuses(() => validateRate({ ...rate, method: 'wilson-bonferroni' }), /comparisons/, 'a Bonferroni interval without its comparisons');
refuses(() => validateRate({ ...rate, method: 'bootstrap' }), /method must be/, 'an unnamed method');
refuses(() => validateRate({ ...rate, confidence: 1 }), /confidence/, 'a sampled interval at confidence 1');

// A result.
const tag = (id, holds) => ({ id, status: holds ? 'surviving' : 'ruled-out', evidence: { holds, values: { classesLosing: 0, classesPartial: 0 } } });
const result = {
  schema: 'experiment-result-v2', specId: 'fixture-band', specSha256: 'b'.repeat(64), claimLevel: 'MODEL_ONLY',
  observations: { block: 'heldOut', values: { classesLosing: 0, classesPartial: 0 } },
  explanations: [tag('E1-flat', true), tag('E2-perforated', false), tag('E3-seeded', false)],
  rates: [rate], stopped: { rule: 'fixed-sample', reached: 'both blocks ran to the end' },
};
assert.equal(validateExperimentResultV2(result, spec), result);
const bad = (edit, pattern, what) => { const copy = clone(result); edit(copy); refuses(() => validateExperimentResultV2(copy, spec), pattern, what); };
bad(r => { r.explanations.pop(); }, /not the spec's/, 'an untagged explanation');
bad(r => { r.explanations.push(tag('E1-flat', true)); }, /once/, 'an explanation tagged twice');
bad(r => { r.explanations[0].status = 'ruled-out'; }, /survives exactly when/, 'a tag its own evidence contradicts');
bad(r => { r.explanations[0].status = 'undecided'; }, /status must be/, 'a third status');
bad(r => { delete r.observations.values.classesPartial; }, /classesPartial is missing/, 'a separating measure not observed');
bad(r => { r.observations.values.classesPartial = 'UNKNOWN'; }, /finite number/, 'an UNKNOWN read as a number');
bad(r => { r.specId = 'other'; }, /answers other/, 'a result for another spec');
bad(r => { r.rates[0].interval = { lo: 0.9, hi: 0.95 }; }, /holds the rate/, 'a result rate outside its interval');
bad(r => { r.observations.block = 'development'; }, /deciding block/, 'observations from the development block');
console.log('experiment v2 contracts: spec, seed set, Seed, rate and result validators accept their shape and refuse each broken one listed');
