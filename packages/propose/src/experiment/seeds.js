/**
 * Reproducible random seed populations for model experiments.
 *
 * A numeric run count is not a seed population.  In particular, iterating
 * `1..N` or multiplying an index by a constant makes a convenient smoke
 * cohort, not the project's golden model cohort.  This module samples
 * uint32 seeds from a deterministic SplitMix32 stream so every strategy sees
 * the same random-looking population and a result can still be replayed.
 */
import { createHash } from 'node:crypto';

export const MODEL_SEED_COHORT_SCHEMA = 'model-seed-cohort-v1';
export const GOLDEN_MODEL_SEEDS = 3000;
export const GOLDEN_MODEL_SEED_SALT = 0x9e3779b9;

const UINT32 = 0x100000000;

function nextSplitMix32(state) {
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

  const seeds = [];
  const seen = new Set();
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

/** Stable identity for the exact population used by a model result. */
export function seedCohortDescriptor(seeds, { salt = null, label = 'random' } = {}) {
  if (!Array.isArray(seeds) || seeds.length < 1 ||
      seeds.some(seed => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff))
    throw new TypeError('seed cohort must be a non-empty array of uint32 seeds');
  const bytes = Buffer.from(JSON.stringify(seeds));
  return {
    schema: MODEL_SEED_COHORT_SCHEMA,
    label,
    count: seeds.length,
    ...(salt === null ? {} : { salt: salt >>> 0 }),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    first: seeds.slice(0, 8),
  };
}

/**
 * Resolve the canonical random population, with an explicit escape hatch for
 * tests.
 * @param {{seeds?: number[], count?: number, salt?: number}} options
 */
export function resolveSeedCohort({ seeds, count = GOLDEN_MODEL_SEEDS,
                                    salt = GOLDEN_MODEL_SEED_SALT } = {}) {
  const population = seeds ?? randomSeedCohort({ count, salt });
  if (!Array.isArray(population) || population.length < 1)
    throw new TypeError('a non-empty seed population is required');
  return population;
}
