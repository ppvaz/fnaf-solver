/**
 * Compatibility shim (`research.minus-3-shim` in legacy-paths.json): the Minus
 * 3 strategy lives in `@sixam/propose/strategies/minus-3` since ADR 0002
 * migration M8. It stays for packages/propose/bin/plans/minus-3-plan.mjs, whose bytes every
 * Minus 3 bundle hashes into engine.sourceSha256.
 */
export * from '@sixam/propose/strategies/minus-3';
