/**
 * Seed (ADR 0002 kernel): a night's seed has a provenance -- `natural` (the
 * game drew it and nothing forced it), `pinned(bracket)` (forced into a
 * bracket, as tools/device/seedpin does) or `identified` (recovered after the
 * fact from what the night showed) -- and a belief -- `known`,
 * `candidates(set)` or `unknown`. Adversarial is an RNG mode, not a seed.
 * "Origin" is not this: it keeps its code meaning, a night's time zero.
 *
 * A model census draws no seed; it enumerates a population that stands for
 * seeds the game would draw, so its provenance says which kind of night each
 * member stands for (a census over the pinned window is `pinned`, with the
 * window as its bracket).
 */
import { fail, isRecord } from './labels.ts';
import { validateInterval } from './time/interval.ts';
import type { Seed, SeedBelief, SeedProvenance } from './types.ts';

export const SEED_PROVENANCES = Object.freeze(['natural', 'pinned', 'identified']);
export const SEED_BELIEFS = Object.freeze(['known', 'candidates', 'unknown']);
const FIELDS = Object.freeze(['provenance', 'bracket', 'belief', 'value', 'candidates']);
const isSeedValue = (value: any) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

/**
 * A provenance, with the bracket a pinned seed carries and no other does.
 */
export function validateSeedProvenance(provenance: any, bracket?: any): SeedProvenance {
  if (!SEED_PROVENANCES.includes(provenance))
    fail(`seed provenance must be one of ${SEED_PROVENANCES.join(', ')}, not ${JSON.stringify(provenance)}`);
  if (provenance === 'pinned') {
    if (bracket === undefined) fail('a pinned seed names the bracket it was pinned into');
    validateInterval(bracket);
  } else if (bracket !== undefined) fail(`a ${provenance} seed has no bracket; only a pinned one does`);
  return provenance;
}

/**
 * One seed: {provenance, bracket? (pinned only), belief, value? (known only), candidates? (candidates only)}.
 */
export function validateSeed(value: any): Seed {
  if (!isRecord(value) || Object.keys(value).some(key => !FIELDS.includes(key)))
    fail(`a seed is {${FIELDS.join(', ')}} and nothing else`);
  validateSeedProvenance(value.provenance, value.bracket);
  if (!SEED_BELIEFS.includes(value.belief))
    fail(`seed belief must be one of ${SEED_BELIEFS.join(', ')}, not ${JSON.stringify(value.belief)}`);
  if ((value.belief === 'known') !== (value.value !== undefined)) fail('a known seed carries its value, and only a known one does');
  if (value.value !== undefined && !isSeedValue(value.value)) fail('a seed value is an unsigned 32-bit integer');
  if ((value.belief === 'candidates') !== (value.candidates !== undefined)) fail('a candidates belief carries its set, and only it does');
  if (value.candidates !== undefined && (!Array.isArray(value.candidates) || value.candidates.length < 2 ||
      !value.candidates.every(isSeedValue) || new Set(value.candidates).size !== value.candidates.length))
    fail('a candidate set holds at least two distinct unsigned 32-bit seeds');
  return (value as Seed);
}
