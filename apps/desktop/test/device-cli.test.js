// Device CLI grammar regression: help is side-effect free, and an unknown
// command, a missing command or a retired one fails closed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeVenueIdentity } from '@sixam/kernel/contracts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = join(ROOT, 'apps/desktop/src/device-cli.js');
const run = args => spawnSync(process.execPath, [CLI, ...args], {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' },
});

for (const args of [['--help'], ['campaign', '--help']]) {
  const result = run(args);
  assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.stderr}`);
  assert.match(result.stdout, /Usage:/);
  assert.doesNotMatch(result.stdout, /result=|evidence=/,
    `${args.join(' ')} unexpectedly executed a run`);
}

for (const args of [['not-a-command'], ['dry-run'], ['live', '--live', '--confirm-live'], ['calibrate'],
  ['--profile', 'hid-mediaprojection']]) {
  const result = run(args);
  assert.equal(result.status, 2, args.join(' '));
  assert.match(result.stderr, /unknown command|a command is required/, args.join(' '));
  assert.doesNotMatch(result.stdout, /result=|evidence=/);
}

for (const args of [['clockmap', '--live'], ['clockmap', '--count', '3'], ['clockmap', '--span-ms', '1000'], ['clockmap', '--out']]) {
  const result = run(args);
  assert.equal(result.status, 2, args.join(' '));
  assert.doesNotMatch(result.stdout, /result=|evidence=/);
}

const oneAttempt = run(['campaign', '--profile', 'fixture-hid-screencap', '--nights', '6',
  '--max-attempts', '1', '--json']);
assert.equal(oneAttempt.status, 0, oneAttempt.stderr);
assert.equal(JSON.parse(oneAttempt.stdout).spec.retry.maxAttempts, 1,
  'a diagnostic campaign must be able to retain one plan epoch');
const invalidAttempts = run(['campaign', '--profile', 'fixture-hid-screencap',
  '--max-attempts', '0']);
assert.equal(invalidAttempts.status, 2);

// A binding names who made it, and only preflight writes one: both refused
// before any phone is queried.
const unsigned = run(['preflight', '--profile', 'fixture-hid-screencap', '--bind-venue', 'binding.json']);
assert.equal(unsigned.status, 2);
assert.match(unsigned.stderr, /--bind-venue requires --by NAME/);
const misplaced = run(['campaign', '--profile', 'fixture-hid-screencap', '--bind-venue', 'binding.json', '--by', 'fixture']);
assert.equal(misplaced.status, 2);
assert.match(misplaced.stderr, /--bind-venue belongs to preflight/);

// The dry run opens no phone: it reports the venue UNKNOWN with that reason,
// and whether a live run would compare it or refuse it unbound.
const dryVenue = JSON.parse(oneAttempt.stdout).venue;
assert.equal(dryVenue.status, 'UNKNOWN');
assert.match(dryVenue.reason, /^dry run: no phone is opened/);
assert.deepEqual(dryVenue.bound, []);
assert.match(dryVenue.live, /^a live run refuses: .*--profile fixture-hid-screencap --bind-venue FILE --by NAME/);
const scratch = mkdtempSync(join(tmpdir(), 'device-cli-venue-'));
try {
  const path = join(scratch, 'binding.json');
  writeFileSync(path, JSON.stringify({ schema: 'venue-binding-v1', subject: { kind: 'profile', id: 'fixture-hid-screencap' },
    identity: makeVenueIdentity({ package: 'com.scottgames.fnaf2', versionName: '2.0.7', versionCode: '26',
      firstInstallTime: '2026-08-20 11:02:13', lastUpdateTime: '2026-09-11 09:58:42',
      buildFingerprint: 'motorola/fake/fake:15/V1FAKE.1/abc:user/release-keys', securityPatch: '2026-08-01',
      handsetHash: 'sha256-0123456789abcdef', companionVersion: '0.2.0+16', timeZone: 'America/Sao_Paulo' }),
    boundBy: 'fixture', boundAt: '2026-09-30', evidenceId: 'venue-binding-fixture' }));
  const bound = run(['campaign', '--profile', 'fixture-hid-screencap', '--nights', '6', '--venue-binding', path]);
  assert.equal(bound.status, 0, bound.stderr);
  assert.match(bound.stdout, /^campaign READY \(dry-run\)/);
  assert.match(bound.stdout, /\nvenue UNKNOWN \(dry run: no phone is opened, .*\): a live run compares the phone with profile fixture-hid-screencap and refuses on drift$/m);
} finally { rmSync(scratch, { recursive: true, force: true }); }

console.log('device CLI: help is side-effect free, unknown, missing and retired commands fail closed, ' +
  'a venue binding is refused without its author, and the dry run reports the venue it did not check');
