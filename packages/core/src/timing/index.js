/**
 * Explicit clock and phase contracts. The clock port moved to
 * `@sixam/kernel/time` (ADR 0002 migration D1); this barrel re-exports it by
 * name, as a compatibility shim registered in
 * docs/architecture/generated/legacy-paths.json (`core.timing-shim`), and still
 * owns the phase clock.
 */
export { ClockPort } from '@sixam/kernel/time';
export * from './phase-clock.js';
