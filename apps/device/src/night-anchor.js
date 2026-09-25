/**
 * Place the night schedule's release against the game's own one-second grid.
 *
 * Two independent facts meet here:
 *   - WHEN the night began: the Cue Helper's latched onset (NightOnsetLatch.java,
 *     rule in @fnaf2-1020/adapters/night-onset), read over a forwarded socket
 *     together with a device->host clock offset bounded by RTT/2;
 *   - WHETHER actuation may start: the lifecycle classifier's `state=night`,
 *     which stays the only authorization. Nothing is released before it.
 *
 * The plan is made from the latch, not from the authorization. The classifier
 * takes 1.8-1.9 s to answer (night5-anchor1/2), so a plan that waited for it
 * landed 2.18-2.22 s after the onset and could not reach k<=2. Instead the
 * release instants onset + aim + k s, for k = 0..maxK, are computed as soon as
 * the latch is read, and each one fires only if the authorization has already
 * arrived by then; otherwise the next k is tried.
 *
 * `maxK` bounds how many whole game seconds past the onset the release may
 * land. The epoch response is periodic only so far: for binding fnv1a-81b5e51c
 * epochs 233/1233/2233 score 3000/3000 but 3233 scores 2673/3000 (Balloon Boy).
 *
 * Never blocks a night: every refusal releases as soon as the night is
 * authorized, exactly as before anchoring existed, and names why in an
 * `origin.anchor` event. What the events do NOT claim: the delivered epoch
 * (released - onset, mod 1000) minus the aim is the clock estimate's error
 * plus release jitter. Actuation latency (effect frame minus injection) is a
 * separate quantity and never enters it.
 */
import { latchedNightOnsetMs } from '@fnaf2-1020/adapters/night-onset';

// The earliest a release may follow the latched onset is a latch hold plus a
// lead, and only with authorizeOnLatch; otherwise it waits for the classifier.
// Exported so a model scorer can say whether a band is deliverable at all.
export const DEFAULT_LATCH_HOLD_MS = 500;
export const DEFAULT_MIN_LEAD_MS = 80;

const defaultSleep = milliseconds => new Promise(resolve => setTimeout(resolve, Math.max(0, milliseconds)));

/**
 * The latched onset on the PHONE's wall clock, when the helper reports one.
 * The helper reads System.currentTimeMillis() beside the System.nanoTime() it
 * reports as snapshotNs (CaptureService GET reply, 2026-09-15), so wall minus
 * monotonic is exact to the two reads' spacing, not to an adb round trip. The
 * game seeds its 16-bit RNG from currentTimeMillis() at scene load, so this is
 * the clock a seed window is measured on. Older helpers omit the field.
 * @param {number} onsetDeviceMs
 * @param {Record<string, string> | undefined} fields
 */
export function phoneWallOnset(onsetDeviceMs, fields) {
  if (!fields || !/^\d+$/.test(fields.wallMs ?? '') || !/^\d+$/.test(fields.snapshotNs ?? '')) return {};
  const phoneWallMinusMonoMs = Number(fields.wallMs) - Number(BigInt(fields.snapshotNs)) / 1e6;
  const onsetPhoneWallMs = onsetDeviceMs + phoneWallMinusMonoMs;
  return { phoneWallMinusMonoMs, onsetPhoneWallMs, onsetPhoneWallLow16: Math.floor(onsetPhoneWallMs) % 65536 };
}

/**
 * @param {{
 *   clock: {
 *     read: () => Promise<{offsetMs: number, uncertaintyMs: number, rttMs: number, fields: Record<string, string>}>,
 *     probe: () => Promise<{offsetMs: number, uncertaintyMs: number, rttMs: number, fields: Record<string, string>}>,
 *   },
 *   authorization: { isAuthorized: () => boolean, whenAuthorized: () => Promise<unknown>, authorizedAt?: () => number | null },
 *   release: () => void, onEvent?: (event: any) => void, aimMs: number, maxK: number, notBeforeHostMs: number,
 *   now?: () => number, wallNow?: () => number, sleep?: (ms: number) => Promise<void>,
 *   latchPollMs?: number, latchWaitMs?: number, latchGraceAfterAuthorizationMs?: number,
 *   minLeadMs?: number, maxUncertaintyMs?: number, periodMs?: number, strict?: boolean,
 *   authorizeOnLatch?: boolean, latchHoldMs?: number,
 * }} options
 */
export async function anchorNightRelease({ clock, authorization, release, onEvent = () => {}, aimMs, maxK, notBeforeHostMs,
  now = () => performance.now(), wallNow = () => Date.now(), sleep = defaultSleep,
  latchPollMs = 100, latchWaitMs = 35000, latchGraceAfterAuthorizationMs = 1500,
  minLeadMs = DEFAULT_MIN_LEAD_MS, maxUncertaintyMs = 15, periodMs = 1000, strict = false,
  authorizeOnLatch = false, latchHoldMs = DEFAULT_LATCH_HOLD_MS }) {
  if (typeof clock?.read !== 'function' || typeof clock?.probe !== 'function')
    throw new TypeError('night anchor needs a clock with read and probe');
  if (typeof authorization?.isAuthorized !== 'function' || typeof authorization?.whenAuthorized !== 'function')
    throw new TypeError('night anchor needs an authorization with isAuthorized and whenAuthorized');
  if (typeof release !== 'function') throw new TypeError('night anchor needs a release function');
  if (!Number.isFinite(aimMs) || aimMs < 0 || aimMs >= periodMs)
    throw new RangeError('night anchor aim must lie in [0, period)');
  if (!Number.isInteger(maxK) || maxK < 0) throw new TypeError('night anchor needs a non-negative integer maxK');
  if (!Number.isFinite(notBeforeHostMs)) throw new TypeError('night anchor needs a finite notBeforeHostMs');

  const authorizedAtHostMs = () => authorization.authorizedAt?.() ?? null;
  // The latch sees the onset whenever the trace opened, so every attempt logs
  // what it last read, refused or not: the latch-vs-frames check needs both.
  let latchedSeenDeviceMs = null;
  let latchedSeenOffsetMs = null;
  // A refusal still owes the night its release, at authorization -- never before.
  const fallback = async (reason, detail = {}) => {
    onEvent({ type: 'origin.anchor', status: 'unavailable', reason, aimMs, maxK,
      latchedOnsetDeviceMs: latchedSeenDeviceMs, latchedOffsetMs: latchedSeenOffsetMs, ...detail });
    // A bundle qualified at its anchor epoch holds only there (bundle.mjs
    // winner.anchorEpochMs): releasing it at a drawn phase spends a night on a
    // stream no census has seen. Strict refuses instead; the attempt aborts.
    if (strict) {
      onEvent({ type: 'origin.anchor', status: 'refused', reason, strict: true });
      throw new Error(`anchored release refused (${reason}); strict anchor does not release unanchored`);
    }
    await authorization.whenAuthorized();
    release();
    onEvent({ type: 'origin.anchor', status: 'released-unanchored', reason, firedHostMs: now(),
      firedWallMs: wallNow(), authorizedAtHostMs: authorizedAtHostMs() });
    return { status: 'unavailable', reason };
  };

  // Every exchange is a clock sample: the offset is the one with the fastest
  // round trip seen so far (bound RTT/2). A failed exchange is transient --
  // the composition's execFileSync helper reads block this event loop for
  // 140-240 ms at a time during the intro (night5-anchor3 lost its only
  // probe to that) -- so the anchor keeps reading until its deadline instead
  // of refusing on the first one.
  let best = null;
  let failures = 0;
  let lastError = null;
  const consider = sample => { if (best === null || sample.rttMs < best.rttMs) best = sample; };
  const failed = error => { failures += 1; lastError = String(error?.message ?? error); };

  // 1. A first offset measurement while the intro card is still up (the clocks
  // drift 0.33 ms per 1000 s); the latch reads below keep improving it.
  try { consider(await clock.probe()); } catch (error) { failed(error); }

  // 2. Wait for a latched onset that belongs to THIS night.
  const startedAt = now();
  let authorizedSeenAt = null;
  let fieldPresent = false;
  let staleOnset = null;
  let reads = 0;
  let onsetDeviceMs = null;
  for (;;) {
    let read = null;
    try { read = await clock.read(); consider(read); reads += 1; }
    catch (error) { failed(error); }
    if (read !== null) {
      fieldPresent ||= read.fields?.nightOnsetImageNs !== undefined;
      let candidate;
      try { candidate = latchedNightOnsetMs(read.fields); }
      catch (error) { return fallback('onset-malformed', { error: String(error?.message ?? error), reads }); }
      if (candidate !== null) {
        // `read` was just considered, so `best` is at least as fast as it.
        const offsetMs = (best ?? read).offsetMs;
        latchedSeenDeviceMs = candidate;
        latchedSeenOffsetMs = offsetMs;
        if (candidate + offsetMs >= notBeforeHostMs) { onsetDeviceMs = candidate; break; }
        staleOnset = candidate;
      }
    }
    if (authorization.isAuthorized()) authorizedSeenAt ??= now();
    const graceSpent = authorizedSeenAt !== null && now() - authorizedSeenAt >= latchGraceAfterAuthorizationMs;
    if (graceSpent || now() - startedAt >= latchWaitMs) {
      const reason = reads === 0 ? 'probe-failed'
        : staleOnset !== null ? 'onset-predates-intro' : fieldPresent ? 'onset-not-latched' : 'helper-has-no-onset';
      return fallback(reason, { reads, failures, ...(lastError ? { lastError } : {}),
        ...(staleOnset !== null ? { staleOnsetDeviceMs: staleOnset } : {}) });
    }
    await sleep(latchPollMs);
  }
  // The latch read itself may be the only clean sample; one more probe gives
  // the fastest a chance, and its failure is not fatal either.
  // `best` is reassigned inside consider(), so the checker will not narrow it;
  // read it once into a const.
  const latchSample = best;
  if (latchSample === null || !(latchSample.uncertaintyMs <= maxUncertaintyMs)) {
    try { consider(await clock.probe()); } catch (error) { failed(error); }
  }
  const measured = best;
  if (measured === null)
    return fallback('probe-failed', { reads, failures, onsetDeviceMs, ...(lastError ? { lastError } : {}) });
  if (!(measured.uncertaintyMs <= maxUncertaintyMs))
    return fallback('offset-uncertain', { reads, failures, onsetDeviceMs, offsetMs: measured.offsetMs,
      uncertaintyMs: measured.uncertaintyMs, rttMs: measured.rttMs, maxUncertaintyMs });

  const detail = { reads, failures, onsetDeviceMs, offsetMs: measured.offsetMs, uncertaintyMs: measured.uncertaintyMs, rttMs: measured.rttMs,
    ...phoneWallOnset(onsetDeviceMs, measured.fields) };
  const onsetHostMs = onsetDeviceMs + measured.offsetMs;
  const planAt = now();
  if (onsetHostMs > planAt + measured.uncertaintyMs)
    return fallback('onset-in-future', { ...detail, onsetHostMs, planAt });

  // 3. The candidate instants still ahead, inside the clean range.
  const firstK = Math.max(0, Math.ceil((planAt + minLeadMs - onsetHostMs - aimMs) / periodMs));
  if (firstK > maxK)
    return fallback('k-unreachable', { ...detail, onsetHostMs, k: firstK, plannedAfterOnsetMs: planAt - onsetHostMs });
  const candidates = [];
  for (let k = firstK; k <= maxK; k += 1) candidates.push({ k, releaseHostMs: onsetHostMs + aimMs + k * periodMs });
  onEvent({ type: 'origin.anchor', status: 'scheduled', aimMs, maxK, onsetHostMs,
    plannedAfterOnsetMs: planAt - onsetHostMs, candidates, authorizedAtHostMs: authorizedAtHostMs(),
    hostClock: 'performance-now-ms', wallMinusHostMs: wallNow() - now(), ...detail });

  // 4. Fire the first candidate at or after the authorization: the first k
  // whose instant finds the night authorized.
  for (const { k, releaseHostMs } of candidates) {
    // Coarse timer, then short hops: a timer alone can land a few ms late,
    // and those ms are epoch error.
    for (;;) {
      const left = releaseHostMs - now();
      if (left <= 0) break;
      await sleep(left > 25 ? left - 20 : 0);
    }
    // The helper's latched onset is the first FNAF2_NIGHT frame held for
    // latchHoldMs of image time -- the same native identity the plan is made
    // from. With authorizeOnLatch an aim that falls after that hold is
    // released on the latch alone: the Night 7 band (aim 2510) is reachable
    // only 5 of 10 times through the ~1 Hz office classifier (1.7-3.5 s), and
    // that classifier still runs behind the release and aborts a false night.
    const latchAuthorized = authorizeOnLatch && releaseHostMs >= onsetHostMs + latchHoldMs + minLeadMs;
    if (!authorization.isAuthorized() && !latchAuthorized) {
      onEvent({ type: 'origin.anchor', status: 'skipped', k, releaseHostMs, reason: 'not-authorized',
        afterOnsetMs: releaseHostMs - onsetHostMs });
      continue;
    }
    if (latchAuthorized && !authorization.isAuthorized())
      onEvent({ type: 'origin.anchor', status: 'latch-authorized', k, releaseHostMs, afterOnsetMs: releaseHostMs - onsetHostMs });
    const firedHostMs = now();
    const firedWallMs = wallNow();
    release();
    const releasedAimMs = ((firedHostMs - onsetHostMs) % periodMs + periodMs) % periodMs;
    onEvent({ type: 'origin.anchor', status: 'released', aimMs, k, releaseHostMs, firedHostMs, firedWallMs,
      lateMs: firedHostMs - releaseHostMs, releasedAimMs, uncertaintyMs: measured.uncertaintyMs,
      authorizedAtHostMs: authorizedAtHostMs(), authorizedAfterOnsetMs: (authorizedAtHostMs() ?? NaN) - onsetHostMs });
    // onsetDeviceMs and afterOnsetMs place the schedule's origin on the
    // helper's own image clock (the teach panel narrates from there).
    return { status: 'released', k, releaseHostMs, firedHostMs, releasedAimMs,
      onsetDeviceMs, afterOnsetMs: firedHostMs - onsetHostMs };
  }
  return fallback('authorization-late', { ...detail, onsetHostMs, maxK,
    lastCandidateHostMs: candidates.at(-1).releaseHostMs });
}
