// Seed derivation (LEG-010), the aggregate terminal (LEG-009), and the pure half of a census over a
// policy family: the cohort a spec pre-registers, refused below the seed floor; rates with a kernel
// Interval and their method; and the decision that tags each explanation ruled-out or surviving.
import assert from 'node:assert/strict';
import { isUnknown } from '@sixam/kernel';
import {
  GOLDEN_MODEL_SEED_SALT, describeSeedSet, expandSeedSet, randomSeedCohort, resolveSeedCohort, seedCohortDescriptor,
  seedDerivation, validateSeedList,
} from '../src/experiment/seeds.ts';
import { SEED_FLOOR, decideExperiment, evaluatePredicate, probit, rateOf, resolveCensusCohort } from '../src/experiment/census.ts';
import { aggregateTerminal, makeResultPayload } from '../src/experiment/experiment.ts';

// LEG-010: the derivation is read from the seeds, never inferred from a salt a caller passes.
const golden = randomSeedCohort({ count: 3000 });
assert.deepEqual(seedDerivation(golden, { salt: GOLDEN_MODEL_SEED_SALT }), { kind: 'golden', count: 3000, salt: GOLDEN_MODEL_SEED_SALT });
assert.deepEqual(seedDerivation(golden), { kind: 'explicit' }, 'without a salt the golden stream is just a list');
assert.deepEqual(seedDerivation([4, 5, 6], { salt: GOLDEN_MODEL_SEED_SALT }), { kind: 'explicit-range', from: 4, to: 6 },
  'an explicit range passed with the golden salt is recorded as the range it is');
assert.deepEqual(seedDerivation([9, 2, 7], { salt: GOLDEN_MODEL_SEED_SALT }), { kind: 'explicit' });
assert.deepEqual(seedDerivation(golden.slice(1), { salt: GOLDEN_MODEL_SEED_SALT }), { kind: 'explicit' },
  'a golden cohort missing its first seed is not the golden cohort');
const described = seedCohortDescriptor(golden, { salt: GOLDEN_MODEL_SEED_SALT });
assert.equal(described.salt, GOLDEN_MODEL_SEED_SALT);
assert.equal(described.provenance, 'natural');
assert.equal(described.derivation.kind, 'golden');
const misstated = seedCohortDescriptor([1, 2, 3, 4, 5, 6, 7, 8], { salt: GOLDEN_MODEL_SEED_SALT });
assert.equal(misstated.salt, undefined, 'an explicit list never carries the golden salt it was passed beside');
assert.deepEqual(misstated.derivation, { kind: 'explicit-range', from: 1, to: 8 });
assert.equal(seedCohortDescriptor(golden, { salt: GOLDEN_MODEL_SEED_SALT }).sha256, described.sha256, 'the hash is the list\'s alone');
assert.throws(() => seedCohortDescriptor([1, 2], { provenance: 'drawn' }), /provenance/);
// Explicit cohorts obey the generator's own rules: uint32, distinct, non-empty.
assert.deepEqual(resolveSeedCohort({ seeds: [3, 1, 2] }), [3, 1, 2]);
assert.equal(resolveSeedCohort().length, 3000);
assert.deepEqual(resolveSeedCohort({ count: 5 }), randomSeedCohort({ count: 5 }));
for (const seeds of [[], [1, 1], [-1], [2 ** 32], [1.5], 'seeds'])
  assert.throws(() => resolveSeedCohort({ seeds: (seeds as any) }), TypeError, JSON.stringify(seeds));
assert.throws(() => validateSeedList([7, 7]), /repeats/);
// A kernel seed set expands to its seeds, and a count or hash it does not have is refused.
const range = describeSeedSet({ name: 'development', derivation: { kind: 'explicit-range', from: 0, to: 2999 } });
assert.equal(range.count, 3000);
assert.deepEqual(expandSeedSet(range).slice(0, 3), [0, 1, 2]);
assert.throws(() => expandSeedSet({ ...range, sha256: '0'.repeat(64) }), /do not hash/);
const nights = describeSeedSet({ name: 'golden nights', derivation: { kind: 'golden', count: 3000, salt: GOLDEN_MODEL_SEED_SALT, modulus: 65536 } });
assert.equal(nights.count, 2932, 'the golden cohort\'s 3000 uint32 seeds are 2932 distinct nights');
assert.throws(() => expandSeedSet({ ...nights, count: 3000 }), /2932 seeds, not the 3000/);
const pinned = describeSeedSet({ name: 'pinned window', derivation: { kind: 'explicit-range', from: 24847, to: 24853 },
  provenance: 'pinned', bracket: { lo: 24847, hi: 24853 } });
assert.equal(pinned.provenance, 'pinned');

// LEG-009: the result's terminal is an aggregate over EVERY evaluation, not the first one's.
const evaluations = [
  { seed: 1, eventCount: 3, terminal: { alive: true, won: false, death: null, frame: 60 } },
  { seed: 2, eventCount: 4, terminal: { alive: false, won: false, death: { reason: 'foxy' }, frame: 12 } },
  { seed: 3, eventCount: 5, terminal: { alive: true, won: true, death: null, frame: 25200 } },
];
const payload = makeResultPayload({ evaluations, schema: 'experiment-result-v1' }, 'fixture');
assert.deepEqual(payload.terminalAggregate, { clock: 'simulator-frame', frames: { lo: 12, hi: 25200 }, evaluations: 3, reporting: 3 });
assert.equal(payload.terminal, undefined, 'the first evaluation\'s terminal is no longer promoted to the experiment');
assert.equal(payload.eventCount, 12);
assert.deepEqual(payload.evaluations.map(item => item.terminal.frame), [60, 12, 25200], 'each evaluation keeps its own terminal');
const reordered = makeResultPayload({ evaluations: [evaluations[2], evaluations[0], evaluations[1]] }, 'fixture');
assert.deepEqual(reordered.terminalAggregate, payload.terminalAggregate, 'the aggregate does not depend on which evaluation came first');
assert.ok(isUnknown(aggregateTerminal([{ eventCount: 1 }])), 'no terminal frame is UNKNOWN, never frame 0');
assert.deepEqual((aggregateTerminal([{ terminal: { frame: 7 } }, {}]) as any).reporting, 1);

// Rates carry a kernel Interval and name their method.
assert.ok(Math.abs(probit(0.975) - 1.959963985) < 1e-8);
assert.ok(Math.abs(probit(0.001) + 3.090232306) < 1e-8);
const perfect = rateOf('perfect', 3000, 3000);
assert.deepEqual(Object.keys(perfect.interval), ['lo', 'hi']);
assert.equal(perfect.interval.hi, 1);
assert.ok(Math.abs(perfect.interval.lo - 3000 / (3000 + probit(0.975) ** 2)) < 1e-12, 'Wilson at p = 1 is n / (n + z^2)');
const joint = rateOf('joint', 3000, 3000, { method: 'wilson-bonferroni', comparisons: 12 });
assert.ok(joint.interval.lo < perfect.interval.lo, 'a joint interval over 12 comparisons is wider');
assert.equal(joint.comparisons, 12);
const population = rateOf('population', 65536, 65536, { method: 'exhaustive', population: 65536 });
assert.deepEqual(population.interval, { lo: 1, hi: 1 });
assert.throws(() => rateOf('not all', 3000, 3000, { method: 'exhaustive', population: 65536 }), /whole population/);
assert.throws(() => rateOf('bad', 4, 3), RangeError);

// The cohort a census pre-registers: disjoint, inside its population, and never under the floor.
assert.equal(SEED_FLOOR, 3000);
const block = (name, from, to) => describeSeedSet({ name, derivation: { kind: 'explicit-range', from, to } });
const spec = {
  schema: 'experiment-spec-v2', id: 'fixture-census', purpose: 'census', claimLevel: 'MODEL_ONLY',
  question: 'Does the fixture family win every seed?',
  family: { id: 'fixture', description: 'a fixture', grid: { members: 2 } },
  explanations: [
    { id: 'E1', statement: 'flat', assumptions: ['fixture'], predicts: { observation: 'nothing loses', when: { measure: 'losing', op: 'eq', value: 0 } } },
    { id: 'E2', statement: 'not flat', assumptions: ['fixture'], predicts: { observation: 'something loses', when: { not: { measure: 'losing', op: 'eq', value: 0 } } } },
  ],
  separatingObservation: { description: 'members that lose a held-out seed', measures: ['losing'] },
  cohort: { population: { description: 'every 16-bit seed', size: 65536 }, development: block('development', 0, 2999), heldOut: block('held-out', 40000, 42999) },
  decidingQuery: { text: 'count losing members on the held-out block', block: 'heldOut' },
  stoppingRule: { kind: 'fixed-sample', text: 'both blocks run to the end' },
};
const cohort = resolveCensusCohort(spec);
assert.equal(cohort.development.length, 3000);
assert.equal(cohort.heldOut[0], 40000);
assert.throws(() => resolveCensusCohort({ ...spec, cohort: { ...spec.cohort, heldOut: block('held-out', 40000, 42998) } }),
  /held-out block is refused: a win rate is quoted over 2999 seeds/, 'a census under the seed floor is refused by review\'s rule');
const diagnostic = { ...spec, purpose: 'diagnostic', cohort: { ...spec.cohort, heldOut: block('held-out', 40000, 40099) } };
assert.equal(resolveCensusCohort(diagnostic).heldOut.length, 100, 'a diagnostic sweep is not held to the census floor');
const goldenBlock = describeSeedSet({ name: 'golden', derivation: { kind: 'golden', count: 3000, salt: GOLDEN_MODEL_SEED_SALT, modulus: 65536 } });
const overlapping = { ...spec, cohort: { ...spec.cohort, development: goldenBlock, heldOut: block('held-out', 0, 65535) } };
assert.throws(() => resolveCensusCohort(overlapping), /shares 2932 seed/, 'an overlap only the generator can see is still refused');
const unreduced = { ...spec, cohort: { ...spec.cohort, development: describeSeedSet({ name: 'uint32',
  derivation: { kind: 'golden', count: 3000, salt: GOLDEN_MODEL_SEED_SALT } }) } };
assert.throws(() => resolveCensusCohort(unreduced), /outside the population/, 'uint32 seeds alias 16-bit nights');

// The decision: surviving exactly when the predicted observation holds; an unobserved measure is refused.
assert.equal(evaluatePredicate({ all: [{ measure: 'a', op: 'ge', value: 1 }, { not: { measure: 'b', op: 'lt', value: 0 } }] }, { a: 1, b: 0 }), true);
assert.throws(() => evaluatePredicate({ measure: 'a', op: 'eq', value: 0 }, {}), /not observed/);
const decided = decideExperiment(spec, { specSha256: 'c'.repeat(64), observations: { losing: 0 },
  rates: [perfect], stopped: { rule: 'fixed-sample', reached: 'both blocks ran to the end' } });
assert.deepEqual(decided.explanations.map(item => [item.id, item.status]), [['E1', 'surviving'], ['E2', 'ruled-out']]);
assert.deepEqual(decided.explanations[1].evidence.values, { losing: 0 });
const flipped = decideExperiment(spec, { specSha256: 'c'.repeat(64), observations: { losing: 2 },
  stopped: { rule: 'fixed-sample', reached: 'both blocks ran to the end' } });
assert.deepEqual(flipped.explanations.map(item => item.status), ['ruled-out', 'surviving']);
console.log('propose census: seed derivation (LEG-010), the aggregate terminal over every evaluation (LEG-009), ' +
  'rates with kernel Intervals, the cohort floor and the explanation decision pass');
