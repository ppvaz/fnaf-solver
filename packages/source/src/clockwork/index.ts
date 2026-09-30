/**
 * The cross-game clockwork: what every game's Source shares.
 *
 * - `games.js`: the four games' nights behind one registry, with the night
 *   model (`night-model.js`) it re-exports;
 * - `rng.js`: the Fusion 16-bit RNG every Sim draws from;
 * - `control-registry.js`: the per-game control catalogs keyed by Android
 *   package, with the catalog shape (`control-catalog.js`) it re-exports;
 * - `vocabulary.js`: the control vocabularies generated from those catalogs;
 * - `control-contracts.js`: `semantic-control-v1`'s control check and the
 *   device profile's game dimension, generated from the same catalogs.
 */
export * from './games.ts';
export * from './rng.ts';
export * from './control-registry.ts';
export * from './vocabulary.ts';
export * from './control-contracts.ts';
