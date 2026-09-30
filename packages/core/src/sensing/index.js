/**
 * Compatibility shim for `@sixam/core/sensing` (ADR 0002 Play move,
 * `core.sensing-shim` in docs/architecture/generated/legacy-paths.json). The
 * Sim observer lives in `@sixam/play/sim` (packages/play/src/venues/sim/),
 * whose export set is exactly the one this subpath had. It stays because
 * tools/device/minus-toys-plan.mjs, whose bytes every Minus Toys bundle
 * hashes into engine.sourceSha256, imports it. New code imports
 * `@sixam/play/sim`.
 */
export * from '@sixam/play/sim';
