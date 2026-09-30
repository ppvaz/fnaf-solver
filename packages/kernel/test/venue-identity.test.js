// venue-identity-v1, venue-check-v1, venue-binding-v1 and qualification-v2
// (packages/kernel/src/contracts/venue-identity.ts, qualification.js). The
// 2026-09-27 case is a Play Store reinstall of the same build: only
// lastUpdateTime moved, and it must refuse.
import assert from 'node:assert/strict';
import {
  VENUE_DRIFT_FIELDS, makeVenueIdentity, validateVenueIdentity, validateVenueBinding,
  validateVenueCheck, compareVenueIdentity, venueBindingsFor,
  validateQualification, bindQualificationVenue, qualificationStanding,
} from '../src/contracts/index.ts';

const readings = {
  package: 'com.scottgames.fnaf2', versionName: '2.0.7', versionCode: '26',
  firstInstallTime: '2026-08-20 11:02:13', lastUpdateTime: '2026-09-11 09:58:42',
  buildFingerprint: 'motorola/fake/fake:15/V1FAKE.1/abc:user/release-keys', securityPatch: '2026-08-01',
  handsetHash: 'sha256-0123456789abcdef', companionVersion: '0.2.0+16', timeZone: 'America/Sao_Paulo',
};
const bound = makeVenueIdentity(readings);
const observed = (changes = {}) => makeVenueIdentity({ ...readings, ...changes });
const byQualification = [{ source: 'qualification', id: 'q-1', identity: bound }];

// The record is closed and never carries the serial.
assert.equal(validateVenueIdentity(bound), bound);
assert.throws(() => validateVenueIdentity({ ...bound, serial: 'FAKE0SERIAL1' }), /raw serial/);
assert.throws(() => validateVenueIdentity({ ...bound, model: 'x' }), /undeclared fields: model/);
assert.throws(() => validateVenueIdentity({ ...bound, handsetHash: 'FAKE0SERIAL1' }), /handsetHash is malformed/);
assert.throws(() => makeVenueIdentity({ ...readings, securityPatch: null }), /securityPatch is unread and has no reason/,
  'UNKNOWN is a value with a reason, never a default');
const partly = makeVenueIdentity({ ...readings, securityPatch: null }, { securityPatch: 'getprop empty' });
assert.equal(partly.unknown.securityPatch, 'getprop empty');
assert.throws(() => validateVenueIdentity(partly, { requireKnown: true }), /securityPatch is unknown/);

// Unbound: the observed identity is recorded, nothing is refused.
const unbound = compareVenueIdentity({ observed: bound });
assert.equal(unbound.status, 'UNBOUND');
assert.equal(unbound.refuses, false);
assert.equal(unbound.observed, bound);
assert.match(unbound.message, /^unbound: the observed venue identity is recorded/);
assert.equal(validateVenueCheck(unbound), unbound);

// No drift: MATCH.
const match = compareVenueIdentity({ observed: observed(), bindings: byQualification });
assert.equal(match.status, 'MATCH');
assert.equal(match.refuses, false);
assert.equal(match.remedy, null);

// A versionCode change refuses and names the field, from and to.
const code = compareVenueIdentity({ observed: observed({ versionCode: '27', versionName: '2.0.8' }), bindings: byQualification });
assert.equal(code.status, 'DRIFT');
assert.equal(code.refuses, true);
assert.deepEqual(code.drift.map(item => [item.field, item.from, item.to]),
  [['versionName', '2.0.7', '2.0.8'], ['versionCode', '26', '27']]);
assert.match(code.message, /versionCode 26 -> 27/);
assert.match(code.remedy, /re-qualify/);
assert.match(code.remedy, /roll the game back/);

// The 09-27 case: the same build reinstalled, only lastUpdateTime moves.
const reinstall = compareVenueIdentity({ observed: observed({ lastUpdateTime: '2026-09-27 01:34:10' }), bindings: byQualification });
assert.equal(reinstall.status, 'DRIFT');
assert.deepEqual(reinstall.drift, [{ field: 'lastUpdateTime', from: '2026-09-11 09:58:42',
  to: '2026-09-27 01:34:10', source: 'qualification', id: 'q-1' }]);
assert.match(reinstall.message, /lastUpdateTime 2026-09-11 09:58:42 -> 2026-09-27 01:34:10/);

// An OS update: fingerprint and patch; rolling the game back does not help.
const os = compareVenueIdentity({ observed: observed({
  buildFingerprint: 'motorola/fake/fake:15/V1FAKE.2/def:user/release-keys', securityPatch: '2026-09-01' }),
bindings: byQualification });
assert.equal(os.status, 'DRIFT');
assert.deepEqual(os.drift.map(item => item.field), ['buildFingerprint', 'securityPatch']);
assert.doesNotMatch(os.remedy, /roll the game back/);
assert.match(os.remedy, /cannot be rolled back/);

// Another handset.
const handset = compareVenueIdentity({ observed: observed({ handsetHash: 'sha256-fedcba9876543210' }), bindings: byQualification });
assert.deepEqual(handset.drift.map(item => item.field), ['handsetHash']);
assert.match(handset.remedy, /different handset/);

// Every drift field refuses on its own.
for (const field of VENUE_DRIFT_FIELDS) {
  if (field === 'package') continue;
  const moved = { ...readings };
  moved[field] = { versionName: '9.9.9', versionCode: '99', firstInstallTime: '2027-01-01 00:00:00',
    lastUpdateTime: '2027-01-01 00:00:00', buildFingerprint: 'other/fp', securityPatch: '2027-01-01',
    handsetHash: 'sha256-ffffffffffffffff' }[field];
  assert.equal(compareVenueIdentity({ observed: makeVenueIdentity(moved), bindings: byQualification }).status,
    'DRIFT', `${field} refuses`);
}

// Note fields are reported, never refused.
const companion = compareVenueIdentity({ observed: observed({ companionVersion: '0.2.1+17' }), bindings: byQualification });
assert.equal(companion.status, 'MATCH');
assert.deepEqual(companion.notes.map(item => item.field), ['companionVersion']);
assert.match(companion.message, /noted, not refused: companionVersion 0\.2\.0\+16 -> 0\.2\.1\+17/);

// Bound, but a bound field is unread: it cannot be cleared.
const unknown = compareVenueIdentity({ observed: partly, bindings: byQualification });
assert.equal(unknown.status, 'UNKNOWN');
assert.equal(unknown.refuses, false);
assert.deepEqual(unknown.unknown.map(item => item.field), ['securityPatch']);
assert.equal(compareVenueIdentity({ observed: null, bindings: byQualification }).status, 'UNKNOWN');
// A known drift outranks an unread field.
assert.equal(compareVenueIdentity({ observed: makeVenueIdentity({ ...readings, versionCode: '27', securityPatch: null },
  { securityPatch: 'getprop empty' }), bindings: byQualification }).status, 'DRIFT');

// venue-binding-v1: binds a profile or a winner without editing either.
const binding = { schema: 'venue-binding-v1', subject: { kind: 'profile', id: 'hid-mediaprojection' },
  identity: bound, boundBy: 'fixture', boundAt: '2026-09-29', evidenceId: 'venue-binding-fixture' };
assert.equal(validateVenueBinding(binding), binding);
assert.throws(() => validateVenueBinding({ ...binding, identity: partly }), /binding needs every drift field read/);
assert.deepEqual(venueBindingsFor({ profileId: 'hid-mediaprojection', bindings: [binding] }),
  [{ source: 'profile', id: 'hid-mediaprojection', identity: bound }]);
assert.throws(() => venueBindingsFor({ profileId: 'hid-mediaprojection-17ms', bindings: [binding] }),
  /names profile hid-mediaprojection; this run uses profile hid-mediaprojection-17ms/);
const winnerBinding = { ...binding, subject: { kind: 'winner', id: 'fnv1a-00000000' } };
assert.throws(() => venueBindingsFor({ profileId: 'hid-mediaprojection', bindings: [winnerBinding] }),
  /no winner to match it/);
assert.equal(venueBindingsFor({ winnerHash: 'fnv1a-00000000', bindings: [winnerBinding] })[0].source, 'winner');

// qualification-v1 is still read; it binds no venue.
const v1 = { schema: 'qualification-v1', policyHash: 'p', modelHash: 'm', sampleCount: 16,
  verdict: 'PASS', claimLevel: 'DEVICE_MEASURED', evidenceId: 'q-1' };
assert.equal(validateQualification(v1), v1);
assert.deepEqual(venueBindingsFor({ qualification: v1 }), []);
const v1Standing = qualificationStanding({ qualification: v1, observed: bound });
assert.equal(v1Standing.lifecycle, 'QUALIFIED');
assert.equal(v1Standing.venue, 'UNBOUND');
assert.equal(v1Standing.demoted, false);

// qualification-v2 is written from a v1 and the venue it was measured on.
const v2 = bindQualificationVenue(v1, bound);
assert.equal(v2.schema, 'qualification-v2');
assert.equal(v2.venue, bound);
assert.equal(v2.policyHash, v1.policyHash);
assert.equal(validateQualification(v2), v2);
assert.equal(v1.schema, 'qualification-v1', 'the v1 record is not edited');
assert.throws(() => bindQualificationVenue(v2, bound), /already binds a venue/);
assert.throws(() => bindQualificationVenue(v1, partly), /qualification is incomplete: .*securityPatch is unknown/);
assert.throws(() => validateQualification({ ...v2, venue: undefined }), /qualification is incomplete/);
assert.deepEqual(venueBindingsFor({ qualification: v2 }), byQualification);

// Drift demotes a QUALIFIED v2 to CANDIDATE; a match keeps it.
assert.equal(qualificationStanding({ qualification: v2, observed: observed() }).lifecycle, 'QUALIFIED');
const demoted = qualificationStanding({ qualification: v2, observed: observed({ lastUpdateTime: '2026-09-27 01:34:10' }) });
assert.equal(demoted.lifecycle, 'CANDIDATE');
assert.equal(demoted.demoted, true);
assert.equal(demoted.demotedFrom, 'QUALIFIED');
assert.match(demoted.message, /^demoted QUALIFIED -> CANDIDATE: venue drifted from qualification q-1: lastUpdateTime/);
assert.equal(qualificationStanding({ qualification: v2, observed: null }).venue, 'UNKNOWN');
const failed = qualificationStanding({ qualification: { ...v2, verdict: 'FAIL' }, observed: observed({ versionCode: '27' }) });
assert.equal(failed.lifecycle, 'CANDIDATE');
assert.equal(failed.demoted, false, 'a qualification that never passed is not demoted, it was never QUALIFIED');

console.log('venue identity: record, unbound/match/drift/unknown comparison, bindings, and qualification v1 read / v2 written pass');
