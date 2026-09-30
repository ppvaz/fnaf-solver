/**
 * Kernel Time (ADR 0002): `Interval`, the declared clock of every campaign
 * timestamp (`event-clocks.js`), the bounded fact link's measurement transport
 * (`fact-link.js`) and the clock port (`ports.js`). `@sixam/kernel/time`.
 */
export * from './interval.js';
export * from './fact-link.js';
export * from './event-clocks.js';
export * from './ports.js';
