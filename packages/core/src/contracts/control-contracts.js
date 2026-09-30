/**
 * The contract validators that are generated from the per-game control
 * catalogs: `semantic-control-v1`'s control check (`validateControlCommand`)
 * and the device profile's game dimension and resolution
 * (`deviceProfileGame`, `resolveDeviceProfile`). They left the contracts
 * module when it moved into @sixam/kernel (ADR 0002 migration D1): the kernel
 * imports nothing, and these need the catalogs. Their bodies and refusal
 * texts are unchanged. CONTRACT:semantic-control-v1 CONTRACT:device-profile-v1.
 */
import {
  CONTROL_CATALOGS, GAME_PACKAGES, catalogAcceptsControl, controlCatalogFor, gameOfTargetBuild,
  unknownProfilePoints,
} from '../control/catalog/index.js';
import { CONTROL_KINDS, validateClockRef, validateProfile } from '@sixam/kernel/contracts';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const requiredString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256)
    throw new TypeError(`${label} must be a non-empty bounded string`);
  return value;
};
const fail = message => { throw new TypeError(`contract: ${message}`); };

// `semantic-control-v1` is parametric by game (D5). The accepted set is
// generated from the control catalogs (control/catalog/), never written out
// here. Two FNaF 2 facts used to be literals in this function: its seven
// control names, and a camera range of 0-12. FNaF 3 addresses fifteen
// locations, so `cam:13` upward failed this check and reported a cause --
// coordinates or transport text -- that had nothing to do with the refusal.
//
// With `{ game }` the check is strict: the control must be one of THAT game's
// ids, its simulator names (FNaF 2's `light`, `hall`, `ventL`, `ventR`) or one
// of its stated cameras, so `cam:13` is refused for FNaF 2 and a FNaF 3 role is
// refused for FNaF 1. Without a game the check is the union over every
// registered catalog -- exactly the set this validator accepted before it took
// a game (every game's names, FNaF 2's simulator names, `cam:0`-`cam:15`) --
// so no existing caller is refused. The union asserts "semantic, not
// physical"; only the strict form asserts "legal for this game".
const CONTROL_REFUSAL =
  'action.control must be semantic and must not contain coordinates or transport text';

function validateControl(control, game) {
  if (typeof control !== 'string') fail(CONTROL_REFUSAL);
  if (game === undefined) {
    if (GAME_PACKAGES.some(id => catalogAcceptsControl(CONTROL_CATALOGS[id], control))) return control;
    fail(CONTROL_REFUSAL);
  }
  let catalog;
  try { catalog = controlCatalogFor(game); } catch (error) { fail(error.message); }
  if (catalogAcceptsControl(catalog, control)) return control;
  fail(`action.control ${JSON.stringify(control)} is not a ${catalog.title} control; ${CONTROL_REFUSAL}`);
}

/**
 * Validate a `control-command-v1`. `game` (an Android package) makes the
 * control check strict for that game's catalog; without it the check is the
 * union over every registered game.
 * @param {any} input @param {{game?: string}} [options]
 */
export function validateControlCommand(input, { game } = {}) {
  if (!isRecord(input) || input.schema !== 'control-command-v1') fail('control command schema mismatch');
  requiredString(input.id, 'command id');
  if (!isRecord(input.action) || !CONTROL_KINDS.includes(input.action.kind)) fail('control action kind is invalid');
  validateControl(input.action.control, game);
  validateClockRef(input.requestedAt, 'requestedAt');
  if (input.deadline !== undefined) validateClockRef(input.deadline, 'deadline');
  if (!isRecord(input.source)) fail('command source is required');
  requiredString(input.source.controller, 'command source controller');
  if (input.source.policyHash !== undefined) requiredString(input.source.policyHash, 'policy hash');
  const forbidden = ['x', 'y', 'coordinates', 'shell', 'adb', 'hid', 'bytes'];
  if (forbidden.some(key => Object.hasOwn(input, key) || Object.hasOwn(input.action, key)))
    fail('physical encoding is not allowed in core commands');
  return input;
}

/**
 * The game dimension of a device profile: the package half of `targetBuild`
 * (`com.scottgames.fnaf2:2.0.7+26`), which must be a registered game.
 * @param {any} profile
 */
export function deviceProfileGame(profile) {
  if (!isRecord(profile)) fail('profile is required');
  let identity;
  try { identity = gameOfTargetBuild(profile.targetBuild); } catch (error) { fail(`profile ${error.message}`); }
  return Object.freeze({ ...identity, title: controlCatalogFor(identity.game).title });
}

/**
 * Resolve a stored `device-profile-v1` (a RawDeviceProfile) into the profile
 * a campaign runs (a ResolvedDeviceProfile): the stored shape, plus its game
 * read from `targetBuild`, plus the checks that game's catalog generates --
 * `controlMap` may name only its controls, its stated cameras and its
 * auxiliary points, and `limits` must be bounded numbers.
 *
 * Resolution adds no field and returns the same object. A profile's bytes are
 * hashed into every bundle and qualification bound to it, so the game dimension
 * is derived from data the profile already carries rather than stored twice;
 * read it with `deviceProfileGame`. The schema id therefore stays
 * `device-profile-v1`.
 * @param {any} input
 */
export function resolveDeviceProfile(input) {
  validateProfile(input);
  const { game, title } = deviceProfileGame(input);
  if (input.controlMap !== undefined) {
    if (!isRecord(input.controlMap)) fail('profile controlMap must be an object');
    const unknown = unknownProfilePoints(controlCatalogFor(game), input.controlMap);
    if (unknown.length > 0)
      fail(`profile controlMap names ${unknown.join(', ')}, which ${title} has no control, camera or point for`);
  }
  if (input.limits !== undefined) {
    const limits = input.limits;
    if (!isRecord(limits)) fail('profile limits must be an object');
    if (limits.maxActions !== undefined && (!Number.isInteger(limits.maxActions) || limits.maxActions < 1))
      fail('profile limits.maxActions must be a positive integer');
    if (limits.maxDurationMs !== undefined && (!finite(limits.maxDurationMs) || limits.maxDurationMs <= 0))
      fail('profile limits.maxDurationMs must be a positive number of ms');
    if (limits.dryRunOnly !== undefined && typeof limits.dryRunOnly !== 'boolean')
      fail('profile limits.dryRunOnly must be boolean');
  }
  return input;
}
