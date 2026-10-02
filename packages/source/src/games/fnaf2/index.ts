/**
 * FNaF 2's Source, `@sixam/source/fnaf2`: canonical sourced mechanics and the
 * deterministic plant implementation. Its export set is exactly the one
 * `@sixam/core/mechanics` had, which now re-exports it.
 */
export * from './config.ts';
export * from './rng.ts';
export * from './seed-recovery.ts';
export * from './plant-model.ts';
export * from './reduced-model.ts';
export * from './plant.ts';
export { FNAF2_MODEL } from './plant-options.ts';
