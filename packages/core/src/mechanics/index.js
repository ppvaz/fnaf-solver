/**
 * Compatibility shim for `@sixam/core/mechanics` (ADR 0002 migration D1,
 * `core.mechanics-shim` in docs/architecture/generated/legacy-paths.json). FNaF
 * 2's mechanics live in `@sixam/source/fnaf2` (packages/source/src/games/fnaf2/),
 * whose export set is exactly the one this barrel had. New code imports it
 * directly.
 *
 * The three model sources beside this file (`plant-model.js`, `config.js`,
 * `rng.js`) are symbolic links to their homes in packages/source:
 * tools/recompile/model-draw-trace.mjs finds the model it hashes into a record
 * beside this barrel (`core.model-source-link.*`).
 */
export * from '@sixam/source/fnaf2';
