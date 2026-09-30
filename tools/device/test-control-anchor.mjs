// Gate for control anchoring: where a control lives, and at which view.
//
// Two halves. The first drives the resolver through every way of knowing and
// not knowing the pan. The second is the reason the resolver exists: FNaF 1's
// door separation is DERIVED here from the measured coordinates rather than
// read from a stored number, so the fact and the map cannot drift apart -- the
// whole failure mode of `MONITOR_MASK_READY_MS`, which was defined as what the
// route already did and therefore could never fail.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateControlAnchor, resolveControlPoint, worldX, unstatedPanDependentControls, ANCHOR_KINDS, PAN_UNKNOWN }
  from '../../packages/adapters/src/control-anchor.js';
import { GAME_CONTROLS } from '../../packages/source/src/clockwork/vocabulary.js';
import { validateControlCommand } from '../../packages/core/src/contracts/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const map = JSON.parse(readFileSync(join(HERE, 'models/controls-fnaf1-moto-g56-v207.json'), 'utf8'));
const SCREEN = map.view.screenWidth;
const MAX_PAN = map.view.maxPanPx;

assert.deepEqual(ANCHOR_KINDS, ['screen', 'world']);

// -- shape: a half-declared anchor is refused, because each half-declaration is
//    an author believing one of the two facts wrongly.
assert.doesNotThrow(() => validateControlAnchor('c', { x: 1, y: 1 }), 'an unstated anchor stays legal');
assert.throws(() => validateControlAnchor('c', { x: 1, y: 1, anchor: 'world' }), /must declare measuredAtPan/);
assert.throws(() => validateControlAnchor('c', { x: 1, y: 1, anchor: 'screen', measuredAtPan: 0 }), /cannot have been measured at a pan/);
assert.throws(() => validateControlAnchor('c', { x: 1, y: 1, measuredAtPan: 600 }), /states a pan but no anchor kind/);
assert.throws(() => validateControlAnchor('c', { x: 1, y: 1, anchor: 'floating' }), /must be screen or world/);
assert.throws(() => validateControlAnchor('c', { x: 1, y: 1, anchor: 'world', measuredAtPan: 0, measuredAtPanY: 5 }), /scroll on x alone/);
assert.throws(() => validateControlAnchor('c', { x: 'left', y: 1 }), /no finite coordinate/);

// -- resolution: what each anchor kind does at each kind of view.
const pinned = { x: 1040, y: 1002, anchor: 'screen' };
const world0 = { x: 106, y: 495, anchor: 'world', measuredAtPan: 0 };
const unstated = { x: 900, y: 540 };

assert.deepEqual(resolveControlPoint('monitor', pinned, { viewOffset: 0 }),
  { x: 1040, y: 1002, anchor: 'screen', viewOffset: 0 });
assert.equal(resolveControlPoint('monitor', pinned, { viewOffset: MAX_PAN }).x, 1040,
  'a pinned control has the same coordinate at every view offset');
assert.equal(resolveControlPoint('monitor', pinned, { viewOffset: PAN_UNKNOWN }).x, 1040,
  'a pinned control does not need the pan to be known');

assert.equal(resolveControlPoint('leftDoor', world0, { viewOffset: 0 }).x, 106);
assert.equal(resolveControlPoint('leftDoor', world0, { viewOffset: 60 }).x, 46,
  'panning right by d moves a world-anchored control left by d');
assert.throws(() => resolveControlPoint('leftDoor', world0, { viewOffset: PAN_UNKNOWN }),
  /scrolls with the office.*pan is UNKNOWN/s, 'an unknown pan refuses rather than assuming rest');

assert.equal(resolveControlPoint('hallLight', unstated, { viewOffset: 0 }).x, 900,
  'an unstated control still resolves at rest, which is what every existing route assumes');
assert.throws(() => resolveControlPoint('hallLight', unstated, { viewOffset: 300 }),
  /has no anchor kind.*office is panned 300 px/s,
  'and refuses anywhere else, naming the cause rather than the transport');
assert.throws(() => resolveControlPoint('hallLight', unstated, { viewOffset: PAN_UNKNOWN }), /pan is UNKNOWN/);
assert.throws(() => resolveControlPoint('c', world0, { viewOffset: -1 }), /non-negative/);

// -- the screen bound: a control can be correctly mapped and still unreachable.
assert.throws(() => resolveControlPoint('leftDoor', world0, { viewOffset: MAX_PAN, screenWidth: SCREEN }),
  /resolves to x -494 at pan 600, which is off a 2400 px screen/,
  'the left door is not merely mis-placed at full right pan, it is not on the screen');

// -- FNaF 1, the port vehicle. Every entry validates, and the fact that forces
//    this whole schema is computed from the map rather than trusted from prose.
for (const [control, point] of Object.entries(map.controlMap)) validateControlAnchor(control, point);

// The run's edge holds are not smuggled in as generic screen taps.  Their
// duration is device-measured, while their points are deliberately labelled
// SOURCE_DERIVED from the event sheet's fastest pan bands.  Keeping that
// distinction in the checked model stops a later caller from treating one as
// evidence of the other.
const pans = map.panMap;
assert.equal(pans.left.claimLevel, 'SOURCE_DERIVED');
assert.equal(pans.right.claimLevel, 'SOURCE_DERIVED');
assert.equal(pans.left.durationClaimLevel, 'DEVICE_MEASURED');
assert.equal(pans.right.durationClaimLevel, 'DEVICE_MEASURED');
assert.equal(pans.left.durationMs, 310, 'the left pan clears the 270 ms floor with a named margin');
assert.equal(pans.right.durationMs, 310, 'the right pan clears the 270 ms floor with a named margin');
assert.ok(pans.left.x < 153 * map.view.scale,
  'the left pan point stays inside the source-derived fastest left-edge band');
assert.ok(pans.right.x > 1143 * map.view.scale,
  'the right pan point stays inside the source-derived fastest right-edge band');
assert.equal(pans.left.resultingPan, 0);
assert.equal(pans.right.resultingPan, MAX_PAN);

const doors = ['leftDoor', 'rightDoor'].map(c => worldX(c, map.controlMap[c]));
const separation = Math.abs(doors[1] - doors[0]);
assert.equal(separation, 2780, 'the doors sit 2780 px apart in world space, from these coordinates');
assert.ok(separation > SCREEN,
  `the doors must be further apart (${separation}) than the screen is wide (${SCREEN}); ` +
  'if this ever fails, a flat control map became sufficient and this module is unnecessary');

// Each door is reachable from exactly one end of the pan, which is what makes
// every door press pan-then-press.
const reach = (control, viewOffset) => {
  try { resolveControlPoint(control, map.controlMap[control], { viewOffset, screenWidth: SCREEN }); return true; }
  catch { return false; }
};
assert.ok(reach('leftDoor', 0) && !reach('leftDoor', MAX_PAN), 'the left door is reachable only near pan 0');
assert.ok(reach('rightDoor', MAX_PAN) && !reach('rightDoor', 0), 'the right door is reachable only near full pan');
assert.ok(reach('monitor', 0) && reach('monitor', MAX_PAN), 'the camera tab is reachable from either');

// -- the map may only name controls the game's vocabulary registers, and those
//    names must pass the semantic contract.
const fnaf1 = GAME_CONTROLS[map.target.package];
assert.ok(fnaf1, `${map.target.package} is not registered in GAME_CONTROLS`);
for (const control of Object.keys(map.controlMap)) {
  assert.ok(fnaf1.controls.includes(control), `${control} is not in FNaF 1's registered vocabulary`);
  validateControlCommand({ schema: 'control-command-v1', id: 'c', action: { kind: 'press', control },
    requestedAt: { clock: 'host-monotonic-ms', value: 0 }, source: { controller: 'test' } });
}
assert.equal(fnaf1.cameraRange, 'UNKNOWN(unmapped-view-ids)',
  "FNaF 1 has cameras whose ids are unmapped; that is not FNaF 4's null, which means it has none");

// -- the profiles in the tree, pinned. These are deliberately NOT migrated: a
//    profile's bytes are hashed into the bundles bound to it, so rewriting one
//    here would orphan those bindings. This assertion exists so that migrating
//    one is a deliberate edit to this list rather than a silent change.
const PROFILES = join(ROOT, 'apps/device/profiles');
const unstatedByProfile = Object.fromEntries(readdirSync(PROFILES)
  .filter(name => name.endsWith('.json'))
  .map(name => [name, unstatedPanDependentControls(JSON.parse(readFileSync(join(PROFILES, name), 'utf8')))])
  .filter(([, controls]) => controls.length));
assert.deepEqual(unstatedByProfile, {
  'hid-mediaprojection.json': ['hallLight', 'leftVentLight', 'rightVentLight', 'cameraFeedLight'],
}, 'the FNaF 2 profile still binds four pan-dependent controls to coordinates valid only at pan 0');


// -- the press record. A coordinate in a bundle was not wrong so much as
//    unreadable: nothing said which view it assumed. Resolution now states the
//    offset it resolved at, and a control that cannot be resolved is refused
//    with the cause instead of landing somewhere. (Checked through the
//    AdbTapActuator until that fixture class was retired on 2026-09-25; the
//    resolver is where the rule lives.)
const atRest = resolveControlPoint('leftDoor', map.controlMap.leftDoor);
assert.deepEqual({ x: atRest.x, y: atRest.y, viewOffset: atRest.viewOffset, anchor: atRest.anchor },
  { x: 106, y: 495, viewOffset: 0, anchor: 'world' });

const panned = resolveControlPoint('rightDoor', map.controlMap.rightDoor, { viewOffset: MAX_PAN });
assert.deepEqual({ x: panned.x, y: panned.y, viewOffset: panned.viewOffset }, { x: 2286, y: 520, viewOffset: MAX_PAN },
  'the right door is pressed at its measured coordinate only when the office is panned there');

assert.throws(() => resolveControlPoint('hallLight', { x: 900, y: 540 }, { viewOffset: 300 }), /has no anchor kind/,
  'an unstated control at a pan is refused, not pressed');

// At rest an unstated control resolves exactly as it always has, which is what
// keeps every shipped FNaF 2 profile and its bound bundles behaving identically.
const legacy = resolveControlPoint('hallLight', { x: 900, y: 540 });
assert.deepEqual({ x: legacy.x, y: legacy.y }, { x: 900, y: 540 });

console.log(`control anchor: ${Object.keys(map.controlMap).length} FNaF 1 controls, doors ${separation} px apart ` +
  `on a ${SCREEN} px screen, and 4 FNaF 2 controls still unstated`);
