/**
 * Play's phone half (ADR 0002): the HID and Companion transports, clocks, night onset, the control anchor
 * and exclusion, the venue parser, and the deprecated FNaF 2 grid/luma rules the campaign still reads. Its
 * export set is the one `@sixam/adapters` had.
 */
export * from './phone/clocks.ts';
export * from './venues/phone/hid.ts';
export * from './venues/phone/companion.ts';
export * from './venues/phone/companion-status.ts';
export * from './phone/android-venue.ts';
export * from './sensors/fnaf2/monitor-rule.ts';
export * from './sensors/fnaf2/camera-rule.ts';
export * from './sensors/fnaf2/calibration-state-rule.ts';
export * from './phone/control-exclusion.ts';
export * from './phone/control-anchor.ts';
export * from './sensors/fnaf2/button-strokes.ts';
