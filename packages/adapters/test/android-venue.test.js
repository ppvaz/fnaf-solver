// Reading venue-identity-v1 off Android text (packages/adapters/src/transports/android-venue.js).
// The two fixtures are shaped like `dumpsys package com.scottgames.fnaf2` on
// current Android (firstInstallTime under `User 0:`, a `Hidden system
// packages` block after) and on Android 10 (firstInstallTime at package
// level). Their values are invented; no phone was queried.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handsetHash, parseDumpsysPackage, parseGetprop, readVenueIdentity } from '../src/transports/android-venue.js';
import { validateVenueIdentity } from '@sixam/core/contracts';

const fixture = name => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const GAME = 'com.scottgames.fnaf2';

// Current Android: the queried package's block, not the hidden system copy
// after it, and the per-user firstInstallTime.
assert.deepEqual(parseDumpsysPackage(fixture('dumpsys-package-android15.txt'), GAME), {
  versionName: '2.0.7', versionCode: '26',
  firstInstallTime: '2026-08-20 11:02:13', lastUpdateTime: '2026-09-27 01:34:10',
});
// Android 10: firstInstallTime printed at package level.
assert.deepEqual(parseDumpsysPackage(fixture('dumpsys-package-android10.txt'), GAME), {
  versionName: '2.0.7', versionCode: '26',
  firstInstallTime: '2026-08-20 11:02:13', lastUpdateTime: '2026-09-11 09:58:42',
});
// A bare field dump (the adb bridge's older fixture) is read whole; a
// missing field is null, never a guess.
assert.deepEqual(parseDumpsysPackage('versionCode=26 versionName=2.0.7\n', GAME), {
  versionName: '2.0.7', versionCode: '26', firstInstallTime: null, lastUpdateTime: null,
});
assert.equal(parseDumpsysPackage('Unable to find package: com.ppvaz.fnafcompanion\n', 'com.ppvaz.fnafcompanion').versionName, null);

assert.equal(parseGetprop('motorola/fake/fake:15/V1FAKE.1/abc:user/release-keys\n'), 'motorola/fake/fake:15/V1FAKE.1/abc:user/release-keys');
assert.equal(parseGetprop('\n'), null);
assert.equal(parseGetprop('a\nb\n'), null, 'a multi-line answer is not one property value');

const SERIAL = 'FAKE0SERIAL1';
assert.equal(handsetHash(SERIAL), `sha256-${createHash('sha256').update(SERIAL).digest('hex').slice(0, 16)}`);
assert.match(handsetHash(SERIAL), /^sha256-[0-9a-f]{16}$/);
assert.throws(() => handsetHash(''), /needs a serial/);

const ok = stdout => ({ ok: true, stdout, stderr: '' });
const reads = {
  packageName: GAME, serial: SERIAL, game: ok(fixture('dumpsys-package-android15.txt')),
  fingerprint: ok('motorola/fake/fake:15/V1FAKE.1/abc:user/release-keys\n'),
  securityPatch: ok('2026-08-01\n'), timeZone: ok('America/Sao_Paulo\n'),
  companion: ok('Packages:\n  Package [com.ppvaz.fnafcompanion] (1):\n    versionCode=16 minSdk=26\n    versionName=0.2.0\n'),
};
const identity = readVenueIdentity(reads);
assert.equal(validateVenueIdentity(identity), identity);
assert.deepEqual({ ...identity }, {
  schema: 'venue-identity-v1', package: GAME, versionName: '2.0.7', versionCode: '26',
  firstInstallTime: '2026-08-20 11:02:13', lastUpdateTime: '2026-09-27 01:34:10',
  buildFingerprint: 'motorola/fake/fake:15/V1FAKE.1/abc:user/release-keys', securityPatch: '2026-08-01',
  handsetHash: handsetHash(SERIAL), companionVersion: '0.2.0+16', timeZone: 'America/Sao_Paulo',
});
assert.ok(!JSON.stringify(identity).includes(SERIAL), 'the raw serial never reaches the record');

// Unreadable: each unread field is null with its reason.
const unread = readVenueIdentity({ ...reads, game: { ok: false, stdout: '', stderr: 'device offline' },
  securityPatch: ok('\n'), fingerprint: ok('not a fingerprint\n'), companion: null, serial: null });
for (const field of ['versionName', 'versionCode', 'firstInstallTime', 'lastUpdateTime'])
  assert.match(unread.unknown[field], /dumpsys package com\.scottgames\.fnaf2 failed: device offline/);
assert.equal(unread.securityPatch, null);
assert.match(unread.unknown.securityPatch, /getprop ro\.build\.version\.security_patch is empty/);
assert.equal(unread.buildFingerprint, null, 'a reading in an unknown shape is recorded as unread');
assert.match(unread.unknown.buildFingerprint, /unrecognised buildFingerprint text/);
assert.match(unread.unknown.companionVersion, /not queried/);
assert.match(unread.unknown.handsetHash, /no device serial/);

console.log('android venue: dumpsys package (current and Android 10 shapes), getprop, handset hash and unread reasons pass');
