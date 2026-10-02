// Venue identity at preflight: the adb bridge records it, compares it with
// what the run is bound to, and refuses on drift; the campaign preflight
// reports the qualification's demotion; the campaign result keeps the venue.
// Every phone answer below is a fixture passed through the bridge's injected
// run port -- no adb is opened.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindQualificationVenue } from '@sixam/kernel/contracts';
import type { VenueBound, VenueCheck, VenueIdentity } from '@sixam/kernel';
import { AdbDeviceBridge, preflightVenue } from '../src/campaign/adb-bridge.ts';
import { CampaignStateMachine, campaignVenue, makeCampaignSpec } from '../src/campaign/campaign.ts';
import { evaluateCampaignPreflight } from '../src/campaign/campaign-preflight.ts';
import { bindVenueFromPreflight, dryRunVenue, loadVenueBindings, renderVenueCheck } from '../src/campaign/venue.ts';

const SERIAL = 'FAKE0SERIAL1';
const TARGET = 'com.scottgames.fnaf2:2.0.7+26';
const DUMPSYS = readFileSync(fileURLToPath(new URL(
  '../../../packages/play/test/fixtures/dumpsys-package-android15.txt', import.meta.url)), 'utf8');
const FINGERPRINT = 'motorola/fake/fake:15/V1FAKE.1/abc:user/release-keys';

/** A phone whose venue answers can be changed between preflights. */
function phone(overrides = {}) {
  const state = { serial: SERIAL, dumpsys: DUMPSYS, fingerprint: FINGERPRINT, patch: '2026-08-01', patchFails: false, ...overrides };
  const run = async (args: readonly string[]) => {
    const ok = (stdout: string) => ({ ok: true, stdout, stderr: '' });
    if (args[0] === 'devices') return ok(`List of devices attached\n${state.serial}\tdevice usb:1-1\n`);
    if (args.at(-1) === 'get-state') return ok('device\n');
    if (args.includes('pm')) return ok('package:/data/app/com.scottgames.fnaf2/base.apk\n');
    if (args.includes('dumpsys') && args.includes('com.scottgames.fnaf2')) return ok(state.dumpsys);
    if (args.includes('dumpsys') && args.includes('com.ppvaz.fnafcompanion'))
      return ok('Packages:\n  Package [com.ppvaz.fnafcompanion] (1):\n    versionCode=16 minSdk=26\n    versionName=0.2.0\n');
    if (args.includes('getprop') && args.at(-1) === 'ro.build.fingerprint') return ok(`${state.fingerprint}\n`);
    if (args.includes('getprop') && args.at(-1) === 'ro.build.version.security_patch')
      return state.patchFails ? { ok: false, stdout: '', stderr: 'getprop: closed' } : ok(`${state.patch}\n`);
    if (args.includes('getprop') && args.at(-1) === 'persist.sys.timezone') return ok('America/Sao_Paulo\n');
    if (args.includes('power')) return ok('mWakefulness=Awake\n');
    if (args.includes('window')) return ok('mCurrentFocus=Window{ com.scottgames.fnaf2/.MainActivity }\nisKeyguardShowing=false\n');
    if (args.includes('wm')) return ok('Physical size: 1080x2400\n');
    if (args.includes('ls')) return ok('/system/bin/hid\n');
    if (args.includes('pidof')) return ok('1234\n');
    if (args.includes('logcat')) return ok('I/FnafCueHelper: control=READY port=49707 token=0123456789abcdef0123456789abcdef\n');
    throw new Error(`unexpected adb ${args.join(' ')}`);
  };
  return new AdbDeviceBridge({ serial: state.serial, run });
}
const preflight = (bridge: AdbDeviceBridge, venueBindings: readonly VenueBound[] = []) => bridge.preflight({ targetBuild: TARGET, venueBindings });
// A live run's preflight: the campaign CLI and the modern ports both require a binding.
const livePreflight = (bridge: AdbDeviceBridge, venueBindings: readonly VenueBound[] = []) => bridge.preflight({ targetBuild: TARGET, venueBindings,
  requireVenueBinding: true, profileId: 'hid-mediaprojection' });
// Every preflight here reaches the venue check, and its detail is text.
const venueCheck = (record: Awaited<ReturnType<typeof preflight>>) =>
  record.checks.find(item => item.id === 'venue-identity') as { status: string, detail: string };

// 1. Unbound (every committed profile today): the identity is recorded and
// the run is not refused.
const unbound = await preflight(phone());
assert.equal(unbound.schema, 'device-preflight-v2');
assert.equal(unbound.status, 'READY');
assert.equal(unbound.reason, null);
assert.equal(unbound.venue.status, 'UNBOUND');
assert.equal(venueCheck(unbound).status, 'PASS');
assert.match(venueCheck(unbound).detail, /^unbound: the observed venue identity is recorded; no profile, winner or qualification binds one/);
assert.match(venueCheck(unbound).detail, /a live run refuses an unbound venue\. Remedy: .*--bind-venue FILE --by NAME/);

// 1b. The same phone, for a live run: nothing binds the venue, so drift is
// UNKNOWN and the run is refused, with the command that records a binding.
const unboundLive = await livePreflight(phone());
assert.equal(unboundLive.status, 'FAIL');
assert.equal(unboundLive.reason, 'venue-identity-unbound');
assert.equal(unboundLive.venue.status, 'UNBOUND');
assert.equal(venueCheck(unboundLive).status, 'FAIL');
assert.match(venueCheck(unboundLive).detail, /drift is UNKNOWN, so a live run refuses\. Remedy: /);
assert.match(venueCheck(unboundLive).detail,
  /`npm run device:preflight -- --profile hid-mediaprojection --bind-venue FILE --by NAME`.*`--venue-binding FILE`/);
const seen = unbound.venue.observed as VenueIdentity; // the fake phone answered every read
assert.deepEqual([seen.versionCode, seen.lastUpdateTime, seen.firstInstallTime, seen.buildFingerprint, seen.securityPatch, seen.companionVersion],
  ['26', '2026-09-27 01:34:10', '2026-08-20 11:02:13', FINGERPRINT, '2026-08-01', '0.2.0+16']);
assert.match(seen.handsetHash ?? '', /^sha256-[0-9a-f]{16}$/);
assert.ok(!JSON.stringify(unbound.venue).includes(SERIAL), 'the venue never carries the raw serial');
assert.equal(preflightVenue(unbound), unbound.venue);
assert.equal(preflightVenue({ schema: 'device-preflight-v1', version: 1, status: 'READY', checks: [] }), null,
  'a v1 preflight is still read: it simply has no venue');
const printed = renderVenueCheck(unbound.venue);
assert.match(printed, /^venue UNBOUND: the observed venue identity is recorded; no profile, winner or qualification binds one/);
assert.match(printed, /game {6}com\.scottgames\.fnaf2 2\.0\.7 code 26/);
assert.match(printed, /updated 2026-09-27 01:34:10/);

// The binding under test: a qualification-v2 written from that record.
const v1 = { schema: 'qualification-v1', verdict: 'PASS', claimLevel: 'DEVICE_MEASURED', policyHash: 'fnv1a-11111111',
  modelHash: 'engine-v1', sampleCount: 3000, evidenceId: 'qualification-fixture' };
const v2 = bindQualificationVenue(v1, seen);
const bindings = await loadVenueBindings({ profileId: 'hid-mediaprojection', qualification: v2 });
assert.deepEqual(bindings.map(item => [item.source, item.id]), [['qualification', 'qualification-fixture']]);

// 2. No drift: READY, MATCH, for an inspection and for a live run alike.
const same = await preflight(phone(), bindings);
assert.equal(same.status, 'READY');
assert.equal(same.venue.status, 'MATCH');
assert.equal(venueCheck(same).status, 'PASS');
const sameLive = await livePreflight(phone(), bindings);
assert.equal(sameLive.status, 'READY');
assert.equal(sameLive.reason, null);
assert.equal(venueCheck(sameLive).status, 'PASS');

// 3. versionCode moved: refused, the field named from and to, with a remedy.
const upgraded = await preflight(phone({ dumpsys: DUMPSYS.replace('versionCode=26 minSdk=21 targetSdk=34', 'versionCode=27 minSdk=21 targetSdk=34') }), bindings);
assert.equal(upgraded.status, 'FAIL');
assert.equal(upgraded.reason, 'venue-identity-drift');
assert.equal(venueCheck(upgraded).status, 'FAIL');
assert.match(venueCheck(upgraded).detail, /venue drifted from qualification qualification-fixture: versionCode 26 -> 27/);
assert.match(venueCheck(upgraded).detail, /Remedy: re-qualify on the observed venue .* or roll the game back/);
assert.deepEqual(upgraded.venue.drift.map(item => item.field), ['versionCode']);
// target-build reads the same dumpsys and refuses 27 on its own, as before.
assert.equal(upgraded.checks.find(item => item.id === 'target-build')?.status, 'FAIL');

// 4. The 09-27 case: same build reinstalled, only lastUpdateTime moved.
// target-build passes (2.0.7+26 either way); the venue alone refuses.
const reinstalled = await preflight(phone({ dumpsys: DUMPSYS.replace('lastUpdateTime=2026-09-27 01:34:10', 'lastUpdateTime=2026-09-28 01:34:10') }), bindings);
assert.equal(reinstalled.checks.find(item => item.id === 'target-build')?.status, 'PASS');
assert.equal(reinstalled.status, 'FAIL');
assert.deepEqual(reinstalled.venue.drift.map(item => [item.field, item.from, item.to]),
  [['lastUpdateTime', '2026-09-27 01:34:10', '2026-09-28 01:34:10']]);
assert.match(renderVenueCheck(reinstalled.venue), /^venue DRIFT: drifted from qualification qualification-fixture: lastUpdateTime/);
assert.match(renderVenueCheck(reinstalled.venue), /\n {2}remedy {4}re-qualify/);

// 5. An OS update moves the fingerprint: refused.
const updated = await preflight(phone({ fingerprint: 'motorola/fake/fake:15/V1FAKE.2/def:user/release-keys' }), bindings);
assert.equal(updated.status, 'FAIL');
assert.deepEqual(updated.venue.drift.map(item => item.field), ['buildFingerprint']);
assert.match(venueCheck(updated).detail, /buildFingerprint motorola\/fake\/fake:15\/V1FAKE\.1\/abc:user\/release-keys -> motorola/);

// 6. Bound, but the patch level cannot be read: held, not passed.
const unreadable = await preflight(phone({ patchFails: true }), bindings);
assert.equal(unreadable.status, 'HOLD');
assert.equal(venueCheck(unreadable).status, 'HOLD');
assert.match(venueCheck(unreadable).detail, /securityPatch unread \(getprop ro\.build\.version\.security_patch failed: getprop: closed\)/);

// 7. Campaign preflight: the qualification's standing on the observed venue.
const fixtureProfile = JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/play/profiles/fnaf2/moto-g56/fixture-hid-screencap.json', import.meta.url)), 'utf8'));
const liveProfile = { ...fixtureProfile, limits: { ...fixtureProfile.limits, dryRunOnly: false } };
const spec = makeCampaignSpec({ profile: liveProfile.id, targetBuild: liveProfile.targetBuild, nights: [2] });
const campaign = (device: NonNullable<Parameters<typeof evaluateCampaignPreflight>[0]>['device'], qualification: unknown) =>
  evaluateCampaignPreflight({ spec, device, profile: liveProfile, qualification,
    executor: { terminal: true, save: true, portsReady: true, deviceLocal: true } });
// Every campaign here is given a qualification, so it carries the qualification-venue check.
const standing = (result: ReturnType<typeof campaign>) =>
  result.checks.find(item => item.id === 'qualification-venue') as { status: string, detail: unknown };
/** That check's detail when the venue drifted or is unread; otherwise it is the standing's message. */
interface Demotion { lifecycle: string, demotedFrom: string, message: string, drift: readonly { field: string }[], remedy: string }
const unboundCampaign = campaign(unboundLive, v1);
assert.equal(unboundCampaign.status, 'FAIL', 'a live campaign refuses an unbound venue even with a passing qualification-v1');
assert.equal(unboundCampaign.checks.find(item => item.id === 'venue-identity')?.status, 'FAIL');
const demotedPreflight = campaign(reinstalled, v2);
assert.equal(demotedPreflight.status, 'FAIL');
assert.equal(demotedPreflight.checks.find(item => item.id === 'venue-identity')?.status, 'FAIL',
  'the device venue check is carried into the campaign preflight');
assert.equal(standing(demotedPreflight).status, 'FAIL');
assert.equal((standing(demotedPreflight).detail as Demotion).lifecycle, 'CANDIDATE');
assert.equal((standing(demotedPreflight).detail as Demotion).demotedFrom, 'QUALIFIED');
assert.match((standing(demotedPreflight).detail as Demotion).message, /^demoted QUALIFIED -> CANDIDATE: /);
assert.equal(standing(campaign(same, v2)).status, 'PASS');
assert.match(standing(campaign(same, v2)).detail as string, /^venue matches qualification qualification-fixture/);
// The qualification binds the handset and the build: a qualification-v2
// measured on another handset, or on another OS build, refuses, and is
// demoted, even when every game field matches.
const otherHandset = await livePreflight(phone({ serial: 'FAKE0SERIAL2' }), bindings);
assert.equal(otherHandset.status, 'FAIL');
assert.equal(otherHandset.reason, 'venue-identity-drift');
assert.deepEqual(otherHandset.venue.drift.map(item => item.field), ['handsetHash']);
const otherHandsetCampaign = campaign(otherHandset, v2);
assert.equal(otherHandsetCampaign.status, 'FAIL');
assert.equal(standing(otherHandsetCampaign).status, 'FAIL');
assert.equal((standing(otherHandsetCampaign).detail as Demotion).lifecycle, 'CANDIDATE');
assert.deepEqual((standing(otherHandsetCampaign).detail as Demotion).drift.map(item => item.field), ['handsetHash']);
assert.match((standing(otherHandsetCampaign).detail as Demotion).remedy, /a different handset/);
const otherBuild = campaign(await livePreflight(phone({ fingerprint: 'motorola/fake/fake:15/V1FAKE.2/def:user/release-keys' }), bindings), v2);
assert.equal(otherBuild.status, 'FAIL');
assert.deepEqual((standing(otherBuild).detail as Demotion).drift.map(item => item.field), ['buildFingerprint']);
assert.match((standing(otherBuild).detail as Demotion).remedy, /cannot be rolled back/);
// A qualification-v1 is still read: unbound, recorded, not refused.
const v1Preflight = campaign(unbound, v1);
assert.equal(standing(v1Preflight).status, 'PASS');
assert.match(standing(v1Preflight).detail as string, /^qualification-v1 binds no venue identity: unbound/);
assert.equal(v1Preflight.checks.find(item => item.id === 'qualified-live-profile')?.status, 'PASS');
// A v1 device record carries no venue: a v2 qualification cannot be cleared.
const oldDevice = { schema: 'device-preflight-v1', version: 1, status: 'READY', serial: SERIAL,
  checks: unbound.checks.filter(item => item.id !== 'venue-identity') };
assert.equal(standing(campaign(oldDevice, v2)).status, 'HOLD');

// 8. The campaign result keeps the venue its preflight observed.
const machine = new CampaignStateMachine({ spec, now: () => 0 });
machine.startPreflight();
machine.acceptPreflight(same);
assert.equal(machine.state, 'MENU');
// campaignVenue hands back the venue-check-v1 the preflight event recorded, untyped.
assert.equal((campaignVenue(machine.result()) as VenueCheck | null)?.status, 'MATCH');
assert.equal((campaignVenue(machine.result()) as VenueCheck | null)?.observed?.lastUpdateTime, '2026-09-27 01:34:10');
const refused = new CampaignStateMachine({ spec, now: () => 0 });
refused.startPreflight();
refused.acceptPreflight(reinstalled);
assert.equal(refused.state, 'HOLD');
assert.equal(refused.result().events.at(-1)?.data.reason, 'venue-identity-drift');
assert.equal((campaignVenue(refused.result()) as VenueCheck | null)?.status, 'DRIFT');
const older = new CampaignStateMachine({ spec, now: () => 0 });
older.startPreflight();
older.acceptPreflight(oldDevice);
assert.equal(campaignVenue(older.result()), null, 'a result from a v1 preflight has no venue, and is still valid');

// 9. venue-binding-v1 files: a profile binding applies to its own profile only.
const scratch = mkdtempSync(join(tmpdir(), 'venue-binding-'));
try {
  const path = join(scratch, 'binding.json');
  writeFileSync(path, JSON.stringify({ schema: 'venue-binding-v1', subject: { kind: 'profile', id: 'hid-mediaprojection' },
    identity: seen, boundBy: 'fixture', boundAt: '2026-09-29', evidenceId: 'venue-binding-fixture' }));
  const profileBound = await loadVenueBindings({ profileId: 'hid-mediaprojection', paths: [path] });
  assert.deepEqual(profileBound.map(item => [item.source, item.id]), [['profile', 'hid-mediaprojection']]);
  const profileDrift = await preflight(phone({ fingerprint: 'other/fingerprint' }), profileBound);
  assert.equal(profileDrift.status, 'FAIL');
  assert.match(venueCheck(profileDrift).detail, /venue drifted from profile hid-mediaprojection: buildFingerprint/);
  await assert.rejects(() => loadVenueBindings({ profileId: 'hid-mediaprojection-17ms', paths: [path] }),
    /names profile hid-mediaprojection; this run uses profile hid-mediaprojection-17ms/);
  // An invalid qualification binds nothing here; the campaign preflight refuses it itself.
  assert.deepEqual(await loadVenueBindings({ profileId: 'hid-mediaprojection', qualification: { schema: 'qualification-v2' } }), []);

  // 10. Recording a binding from the phone (`device:preflight --bind-venue`):
  // it holds exactly what the preflight read, and a live run then compares.
  const recorded = bindVenueFromPreflight({ preflight: unbound, profileId: 'hid-mediaprojection',
    boundBy: 'fixture', boundAt: '2026-09-30' });
  assert.equal(recorded.schema, 'venue-binding-v1');
  assert.deepEqual(recorded.subject, { kind: 'profile', id: 'hid-mediaprojection' });
  assert.equal(recorded.identity, unbound.venue.observed);
  assert.match(recorded.evidenceId, /^venue-binding-hid-mediaprojection-fnv1a-[0-9a-f]{8}$/);
  assert.ok(!JSON.stringify(recorded).includes(SERIAL), 'a binding never carries the raw serial');
  const recordedPath = join(scratch, 'recorded.json');
  writeFileSync(recordedPath, JSON.stringify(recorded));
  const recordedBindings = await loadVenueBindings({ profileId: 'hid-mediaprojection', paths: [recordedPath] });
  const boundLive = await livePreflight(phone(), recordedBindings);
  assert.equal(boundLive.status, 'READY');
  assert.equal(boundLive.venue.status, 'MATCH');
  // Never bind a drifted identity, an unread field, or another build.
  assert.throws(() => bindVenueFromPreflight({ preflight: reinstalled, profileId: 'hid-mediaprojection',
    boundBy: 'fixture', boundAt: '2026-09-30' }), /venue binding refused: venue drifted from .*re-qualify on this venue rather than bind it/);
  const unreadUnbound = await preflight(phone({ patchFails: true }));
  assert.throws(() => bindVenueFromPreflight({ preflight: unreadUnbound, profileId: 'hid-mediaprojection',
    boundBy: 'fixture', boundAt: '2026-09-30' }), /securityPatch is unknown .*a binding needs every drift field read/);
  assert.throws(() => bindVenueFromPreflight({ preflight: upgraded, profileId: 'hid-mediaprojection',
    boundBy: 'fixture', boundAt: '2026-09-30' }), /the installed build is not profile hid-mediaprojection's/);
  assert.throws(() => bindVenueFromPreflight({ preflight: oldDevice, profileId: 'hid-mediaprojection',
    boundBy: 'fixture', boundAt: '2026-09-30' }), /observed no venue identity/);
} finally { rmSync(scratch, { recursive: true, force: true }); }

// 11. A dry run opens no phone: the venue is UNKNOWN with that reason, and it
// says what a live run would compare with, or that a live run would refuse.
const dryUnbound = dryRunVenue({ profileId: 'hid-mediaprojection', bindings: [] });
assert.equal(dryUnbound.status, 'UNKNOWN');
assert.match(dryUnbound.reason, /^dry run: no phone is opened/);
assert.match(dryUnbound.live, /^a live run refuses: no profile, winner or qualification binds a venue identity\. Remedy: .*--bind-venue FILE/);
const dryBound = dryRunVenue({ profileId: 'hid-mediaprojection', bindings });
assert.deepEqual(dryBound.bound, ['qualification qualification-fixture']);
assert.match(dryBound.live, /^a live run compares the phone with qualification qualification-fixture and refuses on drift$/);

console.log('venue preflight: unbound record and live refusal, match, versionCode / lastUpdateTime / fingerprint refusals, ' +
  'unreadable hold, qualification demotion on another handset or build, the campaign result venue, recording a binding, ' +
  'and the dry run\'s unchecked venue pass');
