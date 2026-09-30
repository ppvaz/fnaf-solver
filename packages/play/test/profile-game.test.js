// D5: device profiles carry a game dimension, and the artifact executor
// validates a request against the action table of that game, which the FNaF 2
// cartridge owns in @sixam/core. CONTRACT:device-profile-v1 CONTRACT:device-executor-v1.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deviceProfileGame, resolveDeviceProfile } from '@sixam/source';
import { stableHash } from '@sixam/kernel/contracts';
import { validateExecutorRequest } from '../src/campaign/artifact-executor.ts';
import { compileDeviceLocalHidSchedule } from '../src/campaign/hid-schedule.ts';

const PROFILES = fileURLToPath(new URL('../../../packages/play/profiles/fnaf2/moto-g56/', import.meta.url));
const read = name => JSON.parse(readFileSync(`${PROFILES}${name}`, 'utf8'));

// -- every committed profile still loads, unchanged: resolution derives the
//    game from targetBuild and adds no field, because a profile's bytes are
//    hashed into the bundles bound to it.
// The profiles share Play's FNaF 2 folder with the fitted models, so they are picked by schema.
const names = readdirSync(PROFILES).filter(name => name.endsWith('.json') && read(name).schema === 'device-profile-v1').sort();
assert.deepEqual(names, ['fixture-hid-screencap.json', 'hid-mediaprojection-17ms.json', 'hid-mediaprojection.json'],
  'the committed profiles are present');
for (const name of names) {
  const text = readFileSync(`${PROFILES}${name}`, 'utf8');
  const profile = JSON.parse(text);
  const hash = stableHash(profile);
  assert.equal(resolveDeviceProfile(profile), profile, `${name} resolves to itself`);
  assert.equal(stableHash(profile), hash, `${name} is not rewritten`);
  assert.equal(readFileSync(`${PROFILES}${name}`, 'utf8'), text);
  assert.equal(deviceProfileGame(profile).game, 'com.scottgames.fnaf2', `${name} targets FNaF 2`);
}

// -- a minimal FNaF 2 request, then one change at a time.
const profile = read('hid-mediaprojection.json');
const timing = { periodMs: 1000, loopStartMs: 0, stopAtMs: 3000, observeUntilMs: 3000, idleUntilMs: 0 };
const action = (id, kind, control, atMs, extra = {}) => ({
  schema: 'artifact-action-v1', id, cycle: 'toys', atMs, kind, control, ...extra });
const requestWith = (actions, { requestProfile = profile, armVerification } = {}) => ({
  schema: 'device-executor-v1', version: 1, mode: 'live',
  artifact: { winnerHash: 'a'.repeat(64), engineHash: 'b'.repeat(64), profileHash: 'c'.repeat(64),
    profileStableHash: stableHash(requestProfile),
    plans: [{ night: 6, sha256: 'd'.repeat(64), timing, ...(armVerification ? { armVerification } : {}) }] },
  profile: requestProfile, limits: { maxActions: 64, maxDurationMs: 15000 },
  blocks: [{ schema: 'artifact-action-block-v1', id: 'b', cycle: 'toys', night: 6, atMs: 0, actions }],
});
const ok = requestWith([action('m', 'ensure', 'monitor', 0, { targetMonitorUp: true })]);
assert.equal(validateExecutorRequest(ok), ok);

// The executor reads the table for the profile's game; a game without one is
// refused before any action is read, and so is a profile with no game.
const fnaf3 = { ...profile, targetBuild: 'com.scottgames.fnaf3:2.0.4' };
assert.throws(() => validateExecutorRequest(requestWith(ok.blocks[0].actions, { requestProfile: fnaf3 })),
  /request profile: .*com\.scottgames\.fnaf3 has no artifact action table/);
const gameless = { ...profile, targetBuild: 'fnaf2' };
assert.throws(() => validateExecutorRequest(requestWith(ok.blocks[0].actions, { requestProfile: gameless })),
  /request profile: .*<package>:<version>/);

// The FNaF 2 rules that moved into the cartridge still refuse, with the same words.
const refuses = (actions, pattern, options) =>
  assert.throws(() => validateExecutorRequest(requestWith(actions, options)), pattern);
refuses([action('c', 'compound', 'hallLight', 0, { compound: 'camdrop', requiresMonitorUp: true })],
  /\.camdrop control must be cameraFeedLight/);
refuses([action('c', 'compound', 'hallLight', 0, { compound: 'hallvent', ventControl: 'leftVentLight',
  requiresMonitorUp: false })], /\.hallvent ventControl must be rightVentLight/);
refuses([action('c', 'compound', 'monitor', 0, { compound: 'hallraise', requiresMonitorUp: false })],
  /\.hallraise control must be hallLight/);
refuses([action('c', 'compound', 'monitor', 0, { compound: 'spin', requiresMonitorUp: false })],
  /\.compound is unsupported/);
refuses([action('o', 'observe-left', 'rightVentLight', 0)], /\.observe-left control must be leftVentLight/);
refuses([action('e', 'ensure', 'mask', 0, { targetMonitorUp: true })], /must be an explicit monitor target/);
refuses([action('s', 'sweep-slot', 'cam:6', 0, { selectMs: 33, settleMs: 0, lightMs: 33 })],
  /not a semantic camera control/);
refuses([action('t', 'tap', 'cam:12', 0)], /\.control is unsupported/);
refuses([action('t', 'tap', 'audioLure', 0)], /\.control is unsupported/);
refuses([action('k', 'toString', 'monitor', 0)], /\.kind is unsupported/);
const arm = { cameras: ['cam:9', 'cam:11'], viewing: 'cam:11', untilMs: 100 };
refuses(ok.blocks[0].actions, /cameras\[1\] is not a semantic camera/,
  { armVerification: { ...arm, cameras: ['cam:9', 'cam:13'] } });
refuses(ok.blocks[0].actions, /armVerification requires a wind action/, { armVerification: arm });
refuses([...ok.blocks[0].actions, action('w', 'hold', 'wind', 50, { durationMs: 33 })],
  /starts wind before the arm-verification window closes/, { armVerification: arm });

// The HID macros are FNaF 2's physical shapes; the schedule compiler says so.
assert.throws(() => compileDeviceLocalHidSchedule(requestWith(ok.blocks[0].actions, { requestProfile: fnaf3 })),
  /no artifact action table/);

// -- the leak does not come back: no FNaF 2 control id is a literal in the executor.
const executor = readFileSync(fileURLToPath(new URL('../src/campaign/artifact-executor.ts', import.meta.url)), 'utf8');
assert.doesNotMatch(executor,
  /['"`](?:monitor|mask|cameraFeedLight|hallLight|leftVentLight|rightVentLight|wind|cam:\d+)['"`]/,
  'artifact-executor.js names a FNaF 2 control; the rule belongs in the game\'s action table');
assert.doesNotMatch(executor, /CONTROL_VOCABULARY|DEVICE_CONTROL_NAMES/);

console.log(`profile game: ${names.length} profiles resolve unchanged; executor validates by the game's action table`);
