/**
 * Reproducible random seed populations for model experiments.
 *
 * A numeric run count is not a seed population.  In particular, iterating
 * `1..N` or multiplying an index by a constant makes a convenient smoke
 * cohort, not the project's golden model cohort.  This module samples
 * uint32 seeds from a deterministic SplitMix32 stream so every strategy sees
 * the same random-looking population and a result can still be replayed.
 *
 * Every seed set says how it was derived (LEG-010): `golden` (this stream,
 * from a salt), `explicit` (a list) or `explicit-range` ({from, to}), read from
 * the seeds themselves rather than inferred from a salt a caller passes, and
 * which kernel Seed provenance its members stand for (`natural`, `pinned`,
 * `identified`). The experiment-spec-v2 seed set (`describeSeedSet`,
 * `expandSeedSet`) carries both, with the list's count and sha256.
 */
import { createHash } from 'node:crypto';
import { isList, validateSeedProvenance } from '@sixam/kernel';
import { validateSeedDerivation, validateSeedSet } from '@sixam/kernel/contracts';
import { SEED_FLOOR } from '@sixam/review/refusals';
import type { SeedDerivation, SeedSet } from '@sixam/kernel/contracts';

export type { SeedSet };

export const MODEL_SEED_COHORT_SCHEMA = 'model-seed-cohort-v1';
/** The golden cohort's size: Review's seed floor, the fewest seeds a win rate is quoted over (refusals.ts). */
export const GOLDEN_MODEL_SEEDS = SEED_FLOOR;

/**
 * A smoke cohort's seed: index times Knuth's multiplicative constant, quick and replayable. It is never a
 * population a rate is quoted over -- that is randomSeedCohort's golden cohort.
 */
export const smokeSeed = (index: number) => (index * 2654435761) >>> 0;
export const GOLDEN_MODEL_SEED_SALT = 0x9e3779b9;

const UINT32 = 0x100000000;

function nextSplitMix32(state: number) {
  state = (state + 0x9e3779b9) >>> 0;
  let z = state;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return { state, value: (z ^ (z >>> 16)) >>> 0 };
}

/** Return `count` distinct random-looking uint32 seeds. */
export function randomSeedCohort({ count = GOLDEN_MODEL_SEEDS,
                                   salt = GOLDEN_MODEL_SEED_SALT } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > UINT32)
    throw new RangeError('seed cohort count must be an integer in 1..2^32-1');
  if (!Number.isInteger(salt) || salt < 0 || salt > 0xffffffff)
    throw new RangeError('seed cohort salt must be an unsigned 32-bit integer');

  const seeds: number[] = [];
  const seen = new Set<number>();
  let state = salt >>> 0;
  while (seeds.length < count) {
    const next = nextSplitMix32(state);
    state = next.state;
    if (seen.has(next.value)) continue;
    seen.add(next.value);
    seeds.push(next.value);
  }
  return seeds;
}

const isUint32 = (seed: unknown): seed is number => Number.isInteger(seed) && (seed as number) >= 0 && (seed as number) <= 0xffffffff;
const sha256Of = (seeds: readonly number[]) => createHash('sha256').update(Buffer.from(JSON.stringify(seeds))).digest('hex');

/**
 * Refuse a seed list that is not a non-empty list of distinct uint32 seeds:
 * the canonical generator never repeats a seed, so an explicit cohort may not.
 */
export function validateSeedList(seeds: unknown, label: string = 'seed cohort'): number[] {
  if (!isList(seeds) || seeds.length < 1 || !seeds.every(isUint32))
    throw new TypeError(`${label} must be a non-empty array of uint32 seeds`);
  if (new Set(seeds).size !== seeds.length) throw new TypeError(`${label} repeats a seed`);
  // Returned as given, so a caller's array keeps its identity.
  return seeds as number[];
}

/**
 * How a list of seeds was derived, read from the list itself (LEG-010):
 * `golden` only when it IS `randomSeedCohort({count, salt})` for the salt a
 * caller names -- a salt passed beside an explicit list is not recorded, since
 * it would misstate the list's provenance -- `explicit-range` when it is every
 * integer from its first to its last in order, and `explicit` otherwise.
 */
export function seedDerivation(seeds: number[], { salt = null }: {salt?: number | null} = {}): {kind: 'golden', count: number, salt: number} | {kind: 'explicit-range', from: number, to: number} | {kind: 'explicit'} {
  validateSeedList(seeds);
  if (salt !== null) {
    const golden = randomSeedCohort({ count: seeds.length, salt: salt >>> 0 });
    if (golden.every((seed, index) => seed === seeds[index])) return { kind: 'golden', count: seeds.length, salt: salt >>> 0 };
  }
  if (seeds.every((seed, index) => seed === seeds[0] + index))
    return { kind: 'explicit-range', from: seeds[0], to: seeds[seeds.length - 1] };
  return { kind: 'explicit' };
}

/**
 * Stable identity for the exact population used by a model result. It records
 * the derivation read from the seeds (`seedDerivation`) and the kernel Seed
 * provenance its members stand for; `salt` appears only for a golden cohort.
 */
export function seedCohortDescriptor(seeds: number[], { salt = null, label = 'random', provenance = 'natural' }: {salt?: number | null, label?: string, provenance?: 'natural' | 'pinned' | 'identified'} = {}) {
  validateSeedProvenance(provenance, undefined);
  const derivation = seedDerivation(seeds, { salt });
  return {
    schema: MODEL_SEED_COHORT_SCHEMA,
    label,
    count: seeds.length,
    ...(derivation.kind === 'golden' ? { salt: derivation.salt } : {}),
    derivation,
    provenance,
    sha256: sha256Of(seeds),
    first: seeds.slice(0, 8),
  };
}

/**
 * Resolve the canonical random population, or an explicit one a caller
 * supplies, validated like the generator's own output.
 */
export function resolveSeedCohort({ seeds, count = GOLDEN_MODEL_SEEDS,
                                    salt = GOLDEN_MODEL_SEED_SALT }: {seeds?: number[], count?: number, salt?: number} = {}): number[] {
  if (seeds !== undefined) return validateSeedList(seeds, 'an explicit seed population');
  return randomSeedCohort({ count, salt });
}

/**
 * The seeds of a kernel seed set (experiment-spec-v2), checked against the
 * count and, when the set names one, the sha256 it declares. A golden
 * derivation with a modulus keeps each night's first occurrence.
 */
export function expandSeedSet(set: SeedSet): number[] {
  validateSeedSet(set, `seed set ${set?.name ?? '?'}`);
  const seeds = seedsOf(set.derivation);
  if (seeds.length !== set.count) throw new TypeError(`seed set ${set.name}: ${seeds.length} seeds, not the ${set.count} it declares`);
  if (set.sha256 !== undefined && sha256Of(seeds) !== set.sha256)
    throw new TypeError(`seed set ${set.name}: its seeds do not hash to the sha256 it declares`);
  return seeds;
}

function seedsOf(derivation: SeedDerivation): number[] {
  if (derivation.kind === 'explicit') return [...derivation.seeds];
  if (derivation.kind === 'explicit-range')
    return Array.from({ length: derivation.to - derivation.from + 1 }, (_, index) => derivation.from + index);
  const seeds = randomSeedCohort({ count: derivation.count, salt: derivation.salt });
  const modulus = derivation.modulus;
  return modulus === undefined ? seeds : [...new Set(seeds.map(seed => seed % modulus))];
}

/**
 * A complete seed set for a spec: the count and sha256 computed from its derivation.
 */
export function describeSeedSet({ name, derivation, provenance = 'natural', bracket, definition }: {name: string, derivation: SeedDerivation, provenance?: 'natural' | 'pinned' | 'identified', bracket?: {lo: number, hi: number}, definition?: string}): SeedSet {
  validateSeedDerivation(derivation, `seed set ${name}`);
  const seeds = seedsOf(derivation);
  return validateSeedSet({ name, derivation, provenance, ...(bracket ? { bracket } : {}), count: seeds.length,
    sha256: sha256Of(seeds), ...(definition ? { definition } : {}) }, `seed set ${name}`);
}
