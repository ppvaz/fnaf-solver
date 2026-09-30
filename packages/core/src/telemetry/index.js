/**
 * Versioned measurement transport and telemetry codecs. The fact link and the
 * event clocks moved to `@sixam/kernel/time` (ADR 0002 migration D1); this
 * barrel re-exports them by name, as a compatibility shim registered in
 * docs/architecture/generated/legacy-paths.json (`core.telemetry-shim`), and
 * still owns the bench transport trace.
 */
export {
  FACT_MESSAGE_SCHEMA, MAX_FACT_MESSAGE_BYTES, MAX_FACT_TYPE_LENGTH, MAX_FACT_SOURCE_LENGTH,
  MAX_CALIBRATION_PROFILE_LENGTH, MAX_CYCLE_ACTIONS, MAX_CYCLE_HORIZON_MS,
  encodeFactMessage, decodeFactMessage, messageToFact, FactLinkReceiver, SafeCycleHandoff,
  EVENT_CLOCKS, TIMESTAMP_LEAF, clockOfField, eventTimestamps, plausibleForClock,
} from '@sixam/kernel/time';
export * from './bench-trace.js';
