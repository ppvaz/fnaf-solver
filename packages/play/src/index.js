/**
 * Play's phone half (ADR 0002): the HID and Cue Helper transports, clocks, night onset, the control anchor
 * and exclusion, the venue parser, and the deprecated FNaF 2 grid/luma rules the campaign still reads. Its
 * export set is the one `@sixam/adapters` had.
 */
export * from './phone/clocks.js';
export * from './venues/phone/hid.js';
export * from './venues/phone/cue-helper.js';
export * from './venues/phone/companion-status.js';
export * from './phone/android-venue.js';
export * from './sensors/fnaf2/monitor-rule.js';
export * from './sensors/fnaf2/camera-rule.js';
export * from './sensors/fnaf2/calibration-state-rule.js';
export * from './phone/control-exclusion.js';
export * from './phone/control-anchor.js';
export * from './sensors/fnaf2/button-strokes.js';
