// Which clock each timestamp in a campaign's events.jsonl was read from.
//
// The campaign executor stamps its events from four clocks and names none of
// them in the rows: the host's wall clock (`Date.now()`, and the ISO `at` every
// row carries), the host's monotonic clock (`performance.now()`, the `*HostMs`
// fields), the phone's monotonic clock (the helper's capture and onset stamps)
// and the phone's wall clock, plus times relative to the plan. Mixing two of them
// cost a session on 2026-09-17: host and phone stamps stood 1374.8 ms apart and a
// Foxy rule that was fine looked broken. So the clock of every timestamp field is
// declared here, read off the code that writes it (apps/device/src/
// adb-device-local-executor.js, modern-campaign-ports.js, night-anchor.js), and
// tools/device/test-event-clocks.mjs refuses a packed event whose timestamp field
// is not declared or whose value is implausible for its clock. The executor's
// rows are unchanged; this is the reader's contract for them.

export const EVENT_CLOCKS = Object.freeze({
  HOST_WALL: 'host-wall-ms',
  HOST_MONOTONIC: 'host-monotonic-ms',
  DEVICE_MONOTONIC: 'device-monotonic-ms',
  PHONE_WALL: 'phone-wall-ms',
  PLAN: 'plan-ms',
  DURATION: 'duration-ms',
  DURATION_US: 'duration-us',
  OFFSET: 'clock-offset-ms',
});
const C = EVENT_CLOCKS;

/** A leaf that carries a time, a duration or an offset, by name. Case-sensitive: `status` is not one. */
export const TIMESTAMP_LEAF = /(?:At|Ms|Us|Ns)$|^at$/;

// Leaf name -> clock, for every event type. Paths use the leaf name only;
// `samples[].readStartedAt` and `readStartedAt` are the same field.
const BY_LEAF = Object.freeze({
  at: C.HOST_WALL, // the ISO stamp modern-campaign-ports adds, or the executor's own Date.now()
  // host wall clock: Date.now() in the executor and the anchor
  reachedAt: C.HOST_WALL, releaseAt: C.HOST_WALL, contactAt: C.HOST_WALL, windowEndAt: C.HOST_WALL,
  resultAt: C.HOST_WALL, originAt: C.HOST_WALL, readStartedAt: C.HOST_WALL, readFinishedAt: C.HOST_WALL,
  startedAt: C.HOST_WALL, finishedAt: C.HOST_WALL, firstWriteAt: C.HOST_WALL, requestedAt: C.HOST_WALL,
  sampleStartedAt: C.HOST_WALL, authorizedAt: C.HOST_WALL, armGoAt: C.HOST_WALL, firedWallMs: C.HOST_WALL,
  correctedAt: C.HOST_WALL, // a gate's corrective contact, Date.now() (control.gate, control.gate.verify)
  // the night-origin refinement (adb-device-local-executor.js, origin.refined): Date.now() reads
  authorityAtMs: C.HOST_WALL, authorityBracketFromMs: C.HOST_WALL, nativeBracketFromMs: C.HOST_WALL, nativeAtMs: C.HOST_WALL,
  // host monotonic clock: performance.now() in night-anchor.js and the timed start
  onsetHostMs: C.HOST_MONOTONIC, releaseHostMs: C.HOST_MONOTONIC, firedHostMs: C.HOST_MONOTONIC,
  authorizedAtHostMs: C.HOST_MONOTONIC,
  // the last candidate a late authorization missed (night-anchor.js), and the timed start's tap
  // (modern-campaign-ports.js, menu.start / custom-night.start)
  lastCandidateHostMs: C.HOST_MONOTONIC, tapHostMs: C.HOST_MONOTONIC,
  // phone monotonic clock: the helper's capture and onset stamps
  visualCaptureAt: C.DEVICE_MONOTONIC, onsetDeviceMs: C.DEVICE_MONOTONIC,
  latchedOnsetDeviceMs: C.DEVICE_MONOTONIC, // the onset the latch last read (night-anchor.js)
  staleOnsetDeviceMs: C.DEVICE_MONOTONIC, // an onset the latch read and refused as predating the intro (night-anchor.js)
  // phone wall clock: onsetDeviceMs + (wallMs - snapshotNs / 1e6), night-anchor.js
  onsetPhoneWallMs: C.PHONE_WALL,
  // the timed start (timed-start.js, modern-campaign-ports.js): the planned and the actual tap,
  // on the phone's wall clock because the office seed is drawn from it
  targetPhoneWallMs: C.PHONE_WALL, plannedPhoneWallMs: C.PHONE_WALL, tapPhoneWallMs: C.PHONE_WALL,
  // relative to the plan's night start
  gateAtMs: C.PLAN,
  // durations
  elapsedMs: C.DURATION, delayMs: C.DURATION, budgetMs: C.DURATION, readyDelayMs: C.DURATION,
  handoffDelayMs: C.DURATION, phaseOffsetMs: C.DURATION, originUncertaintyMs: C.DURATION,
  visualCaptureUncertaintyMs: C.DURATION, uncertaintyMs: C.DURATION, lateMs: C.DURATION, rttMs: C.DURATION,
  lowerMs: C.DURATION, upperMs: C.DURATION, sinceContactLowerMs: C.DURATION, sinceContactUpperMs: C.DURATION,
  aimMs: C.DURATION, plannedAfterOnsetMs: C.DURATION, authorizedAfterOnsetMs: C.DURATION,
  releasedAimMs: C.DURATION, periodMs: C.DURATION, lagMs: C.DURATION, phaseLagMs: C.DURATION,
  gateLagMs: C.DURATION, armReadyAtMs: C.DURATION, settleMs: C.DURATION, durationMs: C.DURATION, shrunkByMs: C.DURATION,
  afterOnsetMs: C.DURATION, residueMs: C.DURATION, waitMs: C.DURATION,
  leadMs: C.DURATION, // the anchor's lead between latch and release (night-anchor.js, 2026-09-12 releases)
  ageUs: C.DURATION_US, frameAgeUs: C.DURATION_US,
  // differences between two clocks
  offsetMs: C.OFFSET, phoneWallMinusMonoMs: C.OFFSET, wallMinusHostMs: C.OFFSET,
  latchedOffsetMs: C.OFFSET, // host monotonic minus device monotonic, as the latch saw it
});

/** The declared clock of a field, or null when nothing declares it. */
export function clockOfField(path) {
  const leaf = String(path).split('.').pop().replace(/\[\]$/, '');
  return Object.hasOwn(BY_LEAF, leaf) ? BY_LEAF[leaf] : null;
}

/**
 * Every timestamp-like leaf of one event, with its declared clock (`UNKNOWN`
 * when undeclared). Null values are skipped: an unmeasured read is not a time.
 * @param {object} event one parsed events.jsonl row
 * @returns {{path: string, clock: string, value: number | string}[]}
 */
export function eventTimestamps(event) {
  const out = [];
  const walk = (prefix, value) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) { for (const item of value) walk(`${prefix}[]`, item); return; }
    if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) walk(prefix ? `${prefix}.${key}` : key, item);
      return;
    }
    const leaf = prefix.split('.').pop().replace(/\[\]$/, '');
    if (!TIMESTAMP_LEAF.test(leaf)) return;
    out.push({ path: prefix, clock: clockOfField(prefix) ?? 'UNKNOWN', value });
  };
  walk('', event);
  return out;
}

// Plausible ranges per clock, so a field declared on the wrong clock shows up:
// a wall clock is an epoch between 2020 and 2100, a monotonic clock is under 10^11 ms
// (three years of uptime), a plan time is inside a night.
const WALL = [1.577e12, 4.1e12];
const PLAUSIBLE = {
  [C.HOST_WALL]: value => typeof value === 'string' ? !Number.isNaN(Date.parse(value)) : value >= WALL[0] && value <= WALL[1],
  [C.PHONE_WALL]: value => value >= WALL[0] && value <= WALL[1],
  [C.HOST_MONOTONIC]: value => value >= 0 && value < 1e11,
  [C.DEVICE_MONOTONIC]: value => value >= 0 && value < 1e11,
  [C.PLAN]: value => value >= 0 && value <= 3.6e6,
};

/** Is `value` plausible for `clock`? Durations and offsets are only required to be finite numbers. */
export function plausibleForClock(clock, value) {
  if (PLAUSIBLE[clock]) return (typeof value === 'number' && Number.isFinite(value)) || clock === C.HOST_WALL
    ? PLAUSIBLE[clock](value) : false;
  if ([C.DURATION, C.DURATION_US, C.OFFSET].includes(clock))
    return (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value));
  return false;
}
