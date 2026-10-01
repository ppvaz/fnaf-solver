import assert from 'node:assert/strict';
import { anchorNightRelease, phoneWallOnset } from '../src/campaign/night-anchor.ts';

// Fake host clock in ms. The helper's device clock is host - 5000; the night's
// onset is at host 10000 (device 5000). The latch reads -1 until host 10500
// (its 500 ms hold), then the onset.
const OFFSET_MS = 5000;
const ONSET_HOST_MS = 10000;
const ns = hostMs => String(Math.round((hostMs - OFFSET_MS) * 1e6));

function harness({ startMs = 8000, authorizeAt, latchAt = ONSET_HOST_MS + 500, onsetHostMs = ONSET_HOST_MS,
  field = 'present', readError = null, failUntil = null, uncertaintyMs = 3, staleUntil = null }: any = {}) {
  const state = { t: startMs, releases: [], events: [], reads: 0 };
  const fields = () => {
    if (field === 'absent') return {};
    if (field === 'malformed') return { nightOnsetImageNs: 'nope' };
    // An earlier night's onset: a real (positive) device time from before the intro began.
    if (staleUntil !== null && state.t < staleUntil) return { nightOnsetImageNs: ns(6000) };
    return { nightOnsetImageNs: state.t >= latchAt ? ns(onsetHostMs) : '-1' };
  };
  const sample = () => ({ offsetMs: OFFSET_MS, uncertaintyMs, rttMs: uncertaintyMs * 2, fields: fields() });
  const options = {
    now: () => state.t,
    wallNow: () => 1_700_000_000_000 + state.t,
    sleep: async ms => { state.t += Math.max(1, ms); },
    release: () => state.releases.push(state.t),
    onEvent: event => state.events.push(event),
    clock: {
      read: async () => {
        state.reads += 1; state.t += 10;
        if (readError || (failUntil !== null && state.t < failUntil)) { state.t += 1000; throw readError ?? new Error('Companion clock probe timed out'); }
        return sample();
      },
      probe: async () => {
        state.t += 170;
        if (readError || (failUntil !== null && state.t < failUntil)) { state.t += 1000; throw readError ?? new Error('Companion clock probe timed out'); }
        return sample();
      },
    },
    authorization: {
      isAuthorized: () => state.t >= authorizeAt,
      authorizedAt: () => state.t >= authorizeAt ? authorizeAt : null,
      whenAuthorized: async () => { if (state.t < authorizeAt) state.t = authorizeAt; return authorizeAt; },
    },
    aimMs: 233, maxK: 2, notBeforeHostMs: startMs,
  };
  return { state, options };
}
const released = state => state.events.find(event => event.status === 'released');

// The measured case: latch at +500 ms, authorization at +1953 ms. The plan is
// made from the latch; k=0 (+233) and k=1 (+1233) pass unauthorized; k=2 fires.
{
  const { state, options } = harness({ authorizeAt: ONSET_HOST_MS + 1953 });
  const result: any = await anchorNightRelease(options);
  assert.equal(result.status, 'released');
  assert.equal(result.k, 2);
  assert.deepEqual(state.releases, [ONSET_HOST_MS + 2233]);
  assert.equal(released(state).releasedAimMs, 233);
  assert.equal(state.events.filter(event => event.status === 'skipped').length, 1,
    'k=0 is already behind the latch read at +510 ms, so only k=1 is skipped');
  const scheduled = state.events.find(event => event.status === 'scheduled');
  assert.deepEqual(scheduled.candidates.map(candidate => candidate.k), [1, 2]);
  assert.equal(released(state).authorizedAfterOnsetMs, 1953, 'the fired k must say when authorization resolved');
  // The teach panel's origin: the helper's latch on its own clock, plus the
  // whole release interval (k seconds included, not the mod-period aim).
  assert.equal(result.onsetDeviceMs, ONSET_HOST_MS - OFFSET_MS);
  assert.equal(result.afterOnsetMs, 2233);
}

// A quick authorization takes the earliest clean second.
{
  const { state, options } = harness({ authorizeAt: ONSET_HOST_MS + 900 });
  const result: any = await anchorNightRelease(options);
  assert.equal(result.k, 1);
  assert.deepEqual(state.releases, [ONSET_HOST_MS + 1233]);
}

// Authorization after the last clean candidate: release at authorization, unanchored.
{
  const { state, options } = harness({ authorizeAt: ONSET_HOST_MS + 2500 });
  const result: any = await anchorNightRelease(options);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'authorization-late');
  assert.deepEqual(state.releases, [ONSET_HOST_MS + 2500]);
  assert.equal(state.events.at(-1).status, 'released-unanchored');
}

// A stale onset from an earlier night is not this night's: keep polling for the fresh one.
{
  const { state, options } = harness({ authorizeAt: ONSET_HOST_MS + 1953, staleUntil: ONSET_HOST_MS + 400 });
  const result: any = await anchorNightRelease(options);
  assert.equal(result.k, 2);
  assert.deepEqual(state.releases, [ONSET_HOST_MS + 2233]);
}

// night5-anchor3: exchanges time out while the event loop is blocked during
// the intro. Transient failures must not refuse the anchor.
{
  const { state, options } = harness({ authorizeAt: ONSET_HOST_MS + 1953, failUntil: ONSET_HOST_MS - 500 });
  const result: any = await anchorNightRelease(options);
  assert.equal(result.status, 'released', 'timeouts before the onset must not cost the anchor');
  assert.equal(result.k, 2);
  assert.deepEqual(state.releases, [ONSET_HOST_MS + 2233]);
  assert.ok(state.events.find(event => event.status === 'scheduled').failures >= 1, 'the failures must be counted');
}

// Every refusal releases exactly once, and never before authorization.
const refusals = [
  ['onset-not-latched', { latchAt: Infinity }],
  ['helper-has-no-onset', { field: 'absent' }],
  ['onset-malformed', { field: 'malformed' }],
  ['probe-failed', { readError: new Error('forward refused') }],
  ['offset-uncertain', { uncertaintyMs: 40 }],
  ['onset-predates-intro', { staleUntil: Infinity }],
  ['onset-in-future', { onsetHostMs: ONSET_HOST_MS + 60000 }],
  // The latch is first readable 2.3 s after the onset: k=3 would be needed.
  ['k-unreachable', { latchAt: ONSET_HOST_MS + 2300 }],
];
for (const [reason, extra] of refusals) {
  const authorizeAt = ONSET_HOST_MS + 1953;
  const { state, options } = harness({ authorizeAt, ...extra });
  const result: any = await anchorNightRelease(options);
  assert.equal(result.status, 'unavailable', reason);
  assert.equal(result.reason, reason, reason);
  assert.equal(state.releases.length, 1, `${reason} must still release the night once`);
  assert.ok(state.releases[0] >= authorizeAt, `${reason} must never release before authorization`);
  const refusal = state.events.find(event => event.status === 'unavailable');
  assert.ok('latchedOnsetDeviceMs' in refusal, `${reason} must log the latch it last read, even when null`);
  if (reason === 'offset-uncertain' || reason === 'k-unreachable' || reason === 'onset-in-future')
    assert.equal(typeof refusal.latchedOnsetDeviceMs, 'number', `${reason} read a latched onset and must log it`);
  // Grace after authorization, plus at most one exchange that times out (1 s) and one poll.
  assert.ok(state.releases[0] <= authorizeAt + 1500 + 1000 + 250, `${reason} must release within the latch grace`);
}

// The invariant across the whole authorization range: never early, always once.
for (let authorizeOffset = 0; authorizeOffset <= 4000; authorizeOffset += 137) {
  const authorizeAt = ONSET_HOST_MS + authorizeOffset;
  const { state, options } = harness({ authorizeAt });
  const result: any = await anchorNightRelease(options);
  assert.equal(state.releases.length, 1);
  assert.ok(state.releases[0] >= authorizeAt, `authorization at +${authorizeOffset} released early`);
  if (result.status === 'released') {
    assert.ok(result.k <= 2);
    assert.equal(Math.round(((state.releases[0] - ONSET_HOST_MS) % 1000)), 233);
  }
}

// Night 6 aims on the five-second Foxy roll grid (g337): the aim may exceed one
// second, k steps by the period, and the released aim is quoted mod the period.
{
  const { state, options } = harness({ authorizeAt: ONSET_HOST_MS + 2400 });
  const result: any = await anchorNightRelease({ ...options, aimMs: 3600, maxK: 0, periodMs: 5000 });
  assert.equal(result.status, 'released');
  assert.equal(result.k, 0);
  assert.deepEqual(state.releases, [ONSET_HOST_MS + 3600]);
  assert.equal(released(state).releasedAimMs, 3600);
}
{
  const { state, options } = harness({ authorizeAt: ONSET_HOST_MS + 4200 });
  const result: any = await anchorNightRelease({ ...options, aimMs: 3600, maxK: 1, periodMs: 5000 });
  assert.equal(result.status, 'released');
  assert.equal(result.k, 1, 'a late authorization steps one PERIOD, not one second');
  assert.deepEqual(state.releases, [ONSET_HOST_MS + 8600]);
}
{
  const { state, options } = harness({ authorizeAt: ONSET_HOST_MS + 4200 });
  const result = await anchorNightRelease({ ...options, aimMs: 3600, maxK: 0, periodMs: 5000 });
  assert.equal(result.status, 'unavailable', 'k=1 is refused when the register caps k at 0');
  assert.equal(state.releases.length, 1);
}
await assert.rejects(() => anchorNightRelease({ ...harness({ authorizeAt: 0 }).options, aimMs: 3600 }), RangeError,
  'an aim past the period is refused: a Night 6 aim needs its period');

// authorizeOnLatch: the latched onset alone releases an aim past the latch
// hold; the classifier's authorization (here at +4200) is not waited for.
{
  const { state, options } = harness({ authorizeAt: ONSET_HOST_MS + 4200 });
  const result: any = await anchorNightRelease({ ...options, aimMs: 2510, maxK: 0, periodMs: 5000, strict: true, authorizeOnLatch: true });
  assert.equal(result.status, 'released');
  assert.equal(result.k, 0);
  assert.deepEqual(state.releases, [ONSET_HOST_MS + 2510]);
  assert.ok(state.events.some(event => event.status === 'latch-authorized'));
}
{
  // An aim inside the latch hold is still not released on the latch.
  const { state, options } = harness({ authorizeAt: ONSET_HOST_MS + 4200 });
  await assert.rejects(() => anchorNightRelease({ ...options, aimMs: 300, maxK: 0, periodMs: 5000, strict: true, authorizeOnLatch: true }), /refused/);
  assert.equal(state.releases.length, 0);
}

// Strict: a late authorization refuses instead of releasing unanchored, and
// releases nothing.
{
  const { state, options } = harness({ authorizeAt: ONSET_HOST_MS + 4200 });
  await assert.rejects(() => anchorNightRelease({ ...options, aimMs: 3600, maxK: 0, periodMs: 5000, strict: true }),
    /anchored release refused \(authorization-late\)/);
  assert.equal(state.releases.length, 0, 'strict must not release');
  assert.ok(state.events.some(event => event.status === 'refused'));
}

await assert.rejects(() => anchorNightRelease({ ...harness({ authorizeAt: 0 }).options, aimMs: 1000 }), RangeError);
await assert.rejects(() => anchorNightRelease({ ...harness({ authorizeAt: 0 }).options, maxK: undefined }), /maxK/);

console.log('night anchor: plans from the latch, fires only once authorized, k cap, and every refusal releases once');

// The phone wall clock: onset 5000 ms monotonic, the helper's wall read 1 700 000 012 345 ms
// beside snapshotNs 12 000 ms monotonic, so wall - mono = 1 699 999 999 345 + 1000? -- computed exactly below.
{
  const fields = { wallMs: '1700000012345', snapshotNs: String(12000n * 1000000n) };
  const got = phoneWallOnset(5000, fields);
  assert.equal(got.phoneWallMinusMonoMs, 1700000012345 - 12000);
  assert.equal(got.onsetPhoneWallMs, 5000 + 1700000012345 - 12000);
  assert.equal(got.onsetPhoneWallLow16, Math.floor(5000 + 1700000012345 - 12000) % 65536);
  assert.deepEqual(phoneWallOnset(5000, { snapshotNs: '1' }), {}, 'an older helper without wallMs adds nothing');
  assert.deepEqual(phoneWallOnset(5000, undefined), {});
}
{
  // The scheduled event carries the phone wall onset when the helper reports wallMs.
  const { state, options } = harness({ authorizeAt: ONSET_HOST_MS + 1953 });
  const read = options.clock.read, probe = options.clock.probe;
  const withWall = s => ({ ...s, fields: { ...s.fields, wallMs: String(1_700_000_000_000 + Math.round(state.t) - OFFSET_MS), snapshotNs: ns(state.t) } });
  options.clock.read = async () => withWall(await read());
  options.clock.probe = async () => withWall(await probe());
  await anchorNightRelease(options);
  const scheduled = state.events.find(event => event.status === 'scheduled');
  assert.equal(typeof scheduled.onsetPhoneWallMs, 'number', 'the scheduled event must carry onsetPhoneWallMs');
  assert.ok(Math.abs(scheduled.phoneWallMinusMonoMs - 1_700_000_000_000) < 20, `wall - mono ${scheduled.phoneWallMinusMonoMs}`);
}
console.log('night anchor: phone wall onset carried when the helper reports wallMs');
