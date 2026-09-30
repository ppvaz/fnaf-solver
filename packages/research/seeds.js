/**
 * Compatibility shim (`research.seeds-shim` in legacy-paths.json): the seed
 * cohorts live in `@sixam/propose/seeds` since ADR 0002 migration M8. It stays
 * for tools/device/minus-toys-plan.mjs and minus-3-plan.mjs, whose bytes every
 * Minus Toys and Minus 3 bundle hashes into engine.sourceSha256.
 */
export * from '@sixam/propose/seeds';
