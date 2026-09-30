// The per-game control catalogs (LEG-007) and what is generated from them:
// the vocabulary exports, `semantic-control-v1`'s per-game check, the profile
// resolver's control-map check, and FNaF 2's artifact action table.
// CONTRACT:semantic-control-v1 CONTRACT:device-profile-v1.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CONTROL_CATALOGS, CONTROL_VOCABULARY, DEVICE_CONTROL_NAMES, FNAF2_ARTIFACT_ACTIONS, FNAF2_CONTROL_VOCABULARY,
  GAME_CONTROLS, GAME_PACKAGES, LEGACY_CONTROL_NAMES, artifactActionTableFor, controlCatalogFor,
  controlVocabularyFor, defineControlCatalog, gameOfTargetBuild, isUnknown,
} from '../src/clockwork/index.ts';
import { deviceProfileGame, resolveDeviceProfile, validateControlCommand } from '../src/clockwork/control-contracts.ts';
import { stableHash } from '@sixam/kernel/contracts';
import { PlantModel } from '../src/games/fnaf2/plant.ts';

const FNAF1 = 'com.scottgames.fivenightsatfreddys';
const FNAF2 = 'com.scottgames.fnaf2';
const FNAF3 = 'com.scottgames.fnaf3';
const FNAF4 = 'com.scottgames.fnaf4';

// -- the four games are registered, and every descriptor carries the LEG-007
//    fields: canonical id, aliases, allowed action kinds, adapter binding,
//    state preconditions and observation requirement.
assert.deepEqual(GAME_PACKAGES, [FNAF1, FNAF2, FNAF3, FNAF4]);
for (const [game, catalog] of Object.entries(CONTROL_CATALOGS)) {
  assert.equal(catalog.schema, 'control-catalog-v1');
  assert.equal(catalog.game, game);
  assert.ok(Object.isFrozen(catalog) && Object.isFrozen(catalog.controls[0]), `${game} is frozen`);
  for (const control of catalog.controls) {
    for (const field of ['id', 'aliases', 'actions', 'binding', 'requires', 'observes'])
      assert.ok(field in control, `${game} ${control.id} lacks ${field}`);
    assert.ok(Array.isArray(control.actions) || isUnknown(control.actions), `${game} ${control.id}.actions`);
  }
}

// -- serialized control ids are frozen (ADR 0002): FNaF 2's seven, in order.
const FNAF2_IDS = ['monitor', 'mask', 'cameraFeedLight', 'hallLight', 'leftVentLight', 'rightVentLight', 'wind'];
assert.deepEqual([...DEVICE_CONTROL_NAMES], FNAF2_IDS);
assert.deepEqual(Object.keys(CONTROL_VOCABULARY), FNAF2_IDS);
assert.equal(CONTROL_VOCABULARY, FNAF2_CONTROL_VOCABULARY, 'the game-less name is FNaF 2\'s vocabulary');
assert.deepEqual(controlVocabularyFor(FNAF2), FNAF2_CONTROL_VOCABULARY);
assert.deepEqual(LEGACY_CONTROL_NAMES, { ventL: 'leftVentLight', ventR: 'rightVentLight', wind: 'wind' });
assert.deepEqual(GAME_CONTROLS[FNAF3].cameraRange, [1, 15]);
assert.equal(GAME_CONTROLS[FNAF4].cameraRange, null);
assert.equal(GAME_CONTROLS[FNAF1].cameraRange, 'UNKNOWN(unmapped-view-ids)');

// -- the compile-time ids in types.ts are compared mechanically with the
//    catalogs, so the two cannot drift (LEG-006: "generate or mechanically
//    compare types, validators, and catalogs").
{
  const types = readFileSync(fileURLToPath(new URL('../../kernel/src/contracts/types.ts', import.meta.url)), 'utf8');
  const block = /export interface GameControlIds \{([\s\S]*?)\n\}/.exec(types)?.[1];
  assert.ok(block, 'types.ts declares GameControlIds');
  const declared = Object.fromEntries([...block.matchAll(/readonly '([^']+)':([^;]+);/g)]
    .map(([, game, union]) => [game, [...union.matchAll(/'([^']+)'/g)].map(match => match[1]).sort()]));
  const cataloged = Object.fromEntries(Object.entries(CONTROL_CATALOGS)
    .map(([game, catalog]) => [game, catalog.controls.map(control => control.id).sort()]));
  assert.deepEqual(declared, cataloged, 'types.ts GameControlIds matches the catalogs');
}

// -- semantic-control-v1 is parametric by game.
const command = (control, game) => validateControlCommand({ schema: 'control-command-v1', id: 'c',
  action: { kind: 'press', control }, requestedAt: { clock: 'game-frame', value: 0 },
  source: { controller: 'test' } }, game === undefined ? undefined : { game });
const accepts = (control, game) => { try { command(control, game); return true; } catch { return false; } };

for (const control of [...FNAF2_IDS, 'light', 'hall', 'ventL', 'ventR', 'cam:0', 'cam:12'])
  assert.ok(accepts(control, FNAF2), `FNaF 2 accepts ${control}`);
for (const control of ['cam:13', 'cam:15', 'audioLure', 'leftDoor', 'runCloset', 'mute', 'cam:07'])
  assert.ok(!accepts(control, FNAF2), `FNaF 2 refuses ${control}`);
assert.throws(() => command('cam:13', FNAF2), /"cam:13" is not a FNaF 2 control/);
for (const control of ['monitor', 'audioLure', 'rebootVentilation', 'cam:1', 'cam:15'])
  assert.ok(accepts(control, FNAF3), `FNaF 3 accepts ${control}`);
for (const control of ['mask', 'light', 'cam:0', 'cam:16', 'rebootVent'])
  assert.ok(!accepts(control, FNAF3), `FNaF 3 refuses ${control}`);
// FNaF 1 has cameras whose ids are unmapped, so no `cam:N` is legal for it
// yet; FNaF 4 has none at all.
assert.ok(accepts('leftDoor', FNAF1) && !accepts('cam:1', FNAF1) && !accepts('mask', FNAF1));
assert.ok(accepts('runCloset', FNAF4) && !accepts('cam:1', FNAF4) && !accepts('monitor', FNAF4));
assert.throws(() => command('monitor', 'com.scottgames.fnaf5'), /not a registered game/);
// Without a game: the union, as before D5.
for (const control of ['cam:0', 'cam:15', 'audioLure', 'runCloset', 'leftDoor', 'light'])
  assert.ok(accepts(control), `the union accepts ${control}`);
for (const control of ['cam:16', 'mute', 'x:1', 'cam:01'])
  assert.ok(!accepts(control), `the union refuses ${control}`);
assert.throws(() => command('cam:16'), /must be semantic/);

// The FNaF 2 plant checks its commands against FNaF 2's catalog alone.
assert.throws(() => new PlantModel(1, 2).apply({ schema: 'control-command-v1', id: 'p',
  action: { kind: 'select', control: 'cam:13' }, requestedAt: { clock: 'game-frame', value: 0 },
  source: { controller: 'test' } }), /not a FNaF 2 control/);

// -- the profile's game dimension is the package half of targetBuild.
assert.deepEqual({ ...gameOfTargetBuild('com.scottgames.fnaf2:2.0.7+26') },
  { game: FNAF2, version: '2.0.7+26' });
assert.throws(() => gameOfTargetBuild('com.scottgames.fnaf2'), /<package>:<version>/);
assert.throws(() => gameOfTargetBuild('com.example.other:1.0'), /not a registered game/);
const profile = {
  schema: 'device-profile-v1', id: 'p', targetBuild: 'com.scottgames.fnaf2:2.0.7+26', clock: 'device-monotonic-ms',
  actuator: 'hid-multi', visualSensor: 'mediaprojection', visualDetector: 'cue-helper-detector', calibrations: {},
  controlMap: { mask: { x: 1, y: 1 }, 'cam:11': { x: 2, y: 2 }, mute: { x: 3, y: 3 } },
  limits: { maxActions: 64, maxDurationMs: 15000, dryRunOnly: true },
};
const before = stableHash(profile);
assert.equal(resolveDeviceProfile(profile), profile, 'resolution returns the stored object');
assert.equal(stableHash(profile), before, 'and adds no field');
assert.deepEqual({ ...deviceProfileGame(profile) }, { game: FNAF2, version: '2.0.7+26', title: 'FNaF 2' });
assert.throws(() => resolveDeviceProfile({ ...profile, controlMap: { ...profile.controlMap, leftDoor: { x: 1, y: 1 } } }),
  /controlMap names leftDoor, which FNaF 2 has no control, camera or point for/);
assert.throws(() => resolveDeviceProfile({ ...profile, controlMap: { 'cam:13': { x: 1, y: 1 } } }), /cam:13/);
assert.throws(() => resolveDeviceProfile({ ...profile, targetBuild: 'com.example.other:1.0' }), /not a registered game/);
assert.throws(() => resolveDeviceProfile({ ...profile, limits: { maxActions: 0 } }), /maxActions/);
// A FNaF 3 profile resolves against FNaF 3's catalog, where `mask` is not a control.
assert.throws(() => resolveDeviceProfile({ ...profile, targetBuild: 'com.scottgames.fnaf3:2.0.4' }), /mask/);
assert.equal(resolveDeviceProfile({ ...profile, targetBuild: 'com.scottgames.fnaf3:2.0.4',
  controlMap: { audioLure: { x: 1, y: 1 }, 'cam:15': { x: 2, y: 2 } } }).id, 'p');

// -- FNaF 2's artifact action table: the rules that were literals in
//    apps/device/src/artifact-executor.js until D5, pinned here as moved.
assert.equal(artifactActionTableFor(FNAF2), FNAF2_ARTIFACT_ACTIONS);
assert.deepEqual(FNAF2_ARTIFACT_ACTIONS.controls,
  [...FNAF2_IDS, 'cam:4', 'cam:5', 'cam:7', 'cam:8', 'cam:9', 'cam:10', 'cam:11']);
assert.deepEqual(Object.keys(FNAF2_ARTIFACT_ACTIONS.kinds).sort(),
  ['compound', 'ensure', 'hold', 'observe-left', 'press', 'sweep-slot', 'tap']);
assert.deepEqual(FNAF2_ARTIFACT_ACTIONS.kinds.ensure.controls, ['monitor']);
assert.deepEqual(FNAF2_ARTIFACT_ACTIONS.kinds['observe-left'].controls, ['leftVentLight']);
assert.deepEqual(FNAF2_ARTIFACT_ACTIONS.kinds['sweep-slot'].controls,
  ['cam:4', 'cam:5', 'cam:7', 'cam:8', 'cam:9', 'cam:10', 'cam:11']);
assert.deepEqual(FNAF2_ARTIFACT_ACTIONS.kinds.tap.controls, FNAF2_ARTIFACT_ACTIONS.controls);
assert.deepEqual(JSON.parse(JSON.stringify(FNAF2_ARTIFACT_ACTIONS.compounds)), {
  hallvent: { control: 'hallLight', ventControl: 'rightVentLight' },
  hallraise: { control: 'hallLight' }, maskraise: {}, camdrop: { control: 'cameraFeedLight' },
});
assert.deepEqual(JSON.parse(JSON.stringify(FNAF2_ARTIFACT_ACTIONS.armVerification)),
  { cameras: [1, 12], firstAction: 'wind' });
// The descriptors' action kinds are generated from that table.
const actionsOf = id => controlCatalogFor(FNAF2).controls.find(control => control.id === id).actions;
assert.deepEqual(actionsOf('monitor'), ['ensure', 'tap', 'press', 'hold', 'compound']);
assert.deepEqual(actionsOf('leftVentLight'), ['tap', 'press', 'hold', 'compound', 'observe-left']);
for (const game of [FNAF1, FNAF3, FNAF4]) {
  assert.throws(() => artifactActionTableFor(game), /no artifact action table/);
  assert.equal(controlCatalogFor(game).controls[0].actions, 'UNKNOWN(no-artifact-action-table)');
}

// -- the catalog shape is enforced when a game is defined.
const minimal = { schema: 'control-catalog-v1', game: 'com.scottgames.test', title: 'T',
  controls: [{ id: 'button', aliases: [], binding: { adapter: 'touch', contact: 'tap', anchor: 'screen' },
    requires: {}, observes: 'UNKNOWN(no-effect-reader)' }],
  cameras: { range: null }, modelControls: [], auxiliaryPoints: [], artifactActions: null, sources: ['test'] };
assert.equal(defineControlCatalog(minimal).controls[0].id, 'button');
assert.throws(() => defineControlCatalog({ ...minimal, controls: [{ ...minimal.controls[0], observes: undefined }] }),
  /observes/);
assert.throws(() => defineControlCatalog({ ...minimal, controls: [{ ...minimal.controls[0],
  requires: { monitor: 'sideways' } }] }), /requires\.monitor/);
assert.throws(() => defineControlCatalog({ ...minimal, controls: [{ ...minimal.controls[0],
  binding: { adapter: 'touch', contact: 'tap', anchor: 'somewhere' } }] }), /anchor/);
assert.throws(() => defineControlCatalog({ ...minimal, cameras: {} }), /cameras must state a range/);
assert.throws(() => defineControlCatalog({ ...minimal, auxiliaryPoints: ['button'] }), /is a control/);

console.log(`control catalog: ${GAME_PACKAGES.length} games, ` +
  `${Object.values(CONTROL_CATALOGS).reduce((sum, catalog) => sum + catalog.controls.length, 0)} descriptors; ` +
  'semantic-control-v1 per game, profile game dimension, FNaF 2 action table: ok');
