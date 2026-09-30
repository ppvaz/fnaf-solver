/**
 * Compatibility shim for `@sixam/core/contracts` (ADR 0002 migration D1,
 * registered in docs/architecture/generated/legacy-paths.json as
 * `core.contracts-shim`). The contracts live in `@sixam/kernel/contracts`;
 * the three validators generated from the control catalogs live beside the
 * catalogs. This module re-exports both, so its export set is the one it had
 * before the move. New code imports the owners directly.
 */
export * from '@sixam/kernel/contracts';
export { deviceProfileGame, resolveDeviceProfile, validateControlCommand } from './control-contracts.js';
