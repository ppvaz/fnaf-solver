// The night's onset, and where to release the schedule against it.
//
// The Night 5 route is phase-critical: it scores 3000/3000 when the schedule's
// T0 sits at a winning epoch against the game's one-second grid and loses
// Balloon Boy in the 4-tick bands. Until 2026-09-12 the phone DREW that epoch
// on every run, because the release followed a ~1 Hz screenshot classifier.
// Two of three measured epochs that day fell in a losing band.
//
// Epoch 0 is defined once, here, and used on both sides:
//   - post hoc, over a Cue Helper frame trace (tools/device/phase-reconstruct.mjs);
//   - live, over the onset the helper latches (NightOnsetLatch.java), so the
//     release the executor places and the epoch the audit measures are the
//     same definition by construction.
// The onset is the first frame of the first run of FNAF2_NIGHT identities that
// spans NIGHT_ONSET_HOLD_MS of image time; any other identity before the hold
// is met restarts the run, so a one-frame flicker is never an onset.
//
// Sign convention (tools/device/minus-toys-plan.mjs): when = base + at + epochMs,
// so a POSITIVE epoch fires the schedule LATER against the game's grid, and a
// release at onset + epoch delivers that epoch. Quoting the aim as 1000 - epoch
// names the opposite band.

/** ScreenIdentity.java: UNKNOWN 0, CUE_HELPER 1, FNAF2_NIGHT 2, FNAF2_MENU 3. */
export const SCREEN_FNAF2_NIGHT = 2;
/** Image time a FNAF2_NIGHT run must span to count as the night (~30 frames at 60 Hz). */
export const NIGHT_ONSET_HOLD_MS = 500;
/**
 * Centre of the Night 5 winning band [166.67, 300]: every model row there is
 * 5 mask ticks and 3000/3000 with no hole, so the aim tolerates +-67 ms of
 * placement error before touching a losing row. k is free: epochs 233.33,
 * 1233.33 and 2233.33 all score 3000/3000.
 */
export const NIGHT5_ANCHOR_AIM_MS = 233;

const finite = value => typeof value === 'number' && Number.isFinite(value);

/**
 * First held FNAF2_NIGHT frame of a trace.
 * @param {{imageMs: number, screenIdentity: number}[]} rows capture order
 * @returns {{imageMs: number, index: number, resolutionMs: number|null, priorIdentity: number|null}|null}
 */
export function nightOnsetFromFrames(rows, { holdMs = NIGHT_ONSET_HOLD_MS } = {}) {
  if (!Array.isArray(rows)) throw new TypeError('night onset needs an array of frames');
  if (!finite(holdMs) || holdMs <= 0) throw new TypeError('night onset hold must be a positive duration');
  let candidate = -1;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.screenIdentity !== SCREEN_FNAF2_NIGHT) { candidate = -1; continue; }
    if (candidate < 0) candidate = index;
    if (row.imageMs - rows[candidate].imageMs < holdMs) continue;
    const prior = candidate > 0 ? rows[candidate - 1] : null;
    return { imageMs: rows[candidate].imageMs, index: candidate,
      resolutionMs: prior ? rows[candidate].imageMs - prior.imageMs : null,
      priorIdentity: prior ? prior.screenIdentity : null };
  }
  return null;
}

/**
 * The helper's latched onset from a GET/FRAME response, in device-monotonic ms.
 * Absent (older helper) or not yet latched both read as null: the caller must
 * then fall back rather than invent an origin.
 * @param {Record<string, string>} fields
 */
export function latchedNightOnsetMs(fields) {
  const raw = fields?.nightOnsetImageNs;
  if (raw === undefined || raw === '-1') return null;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new Error('night onset field is malformed');
  const ns = BigInt(raw);
  if (ns <= 0n) throw new Error('night onset field is malformed');
  return Number(ns) / 1e6;
}

/**
 * Host time at which to release so the schedule's T0 lands at `aimMs` past the
 * onset, modulo one game second, no earlier than `earliestHostMs`.
 * @param {{onsetDeviceMs: number, deviceToHostOffsetMs: number, aimMs?: number,
 *   periodMs?: number, earliestHostMs: number}} args
 * @returns {{releaseHostMs: number, k: number, onsetHostMs: number}}
 */
export function anchoredReleaseAt({ onsetDeviceMs, deviceToHostOffsetMs,
  aimMs = NIGHT5_ANCHOR_AIM_MS, periodMs = 1000, earliestHostMs }) {
  for (const [name, value] of Object.entries({ onsetDeviceMs, deviceToHostOffsetMs, aimMs, periodMs, earliestHostMs }))
    if (!finite(value)) throw new TypeError(`anchored release needs a finite ${name}`);
  if (periodMs <= 0) throw new TypeError('anchored release period must be positive');
  if (aimMs < 0 || aimMs >= periodMs) throw new RangeError('anchored release aim must lie in [0, period)');
  const onsetHostMs = onsetDeviceMs + deviceToHostOffsetMs;
  const first = onsetHostMs + aimMs;
  const k = Math.max(0, Math.ceil((earliestHostMs - first) / periodMs));
  return { releaseHostMs: first + k * periodMs, k, onsetHostMs };
}
