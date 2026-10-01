/**
 * The per-game control catalogs, keyed by Android package (LEG-007).
 *
 * A game is registered by adding its data module as `games/<game>/controls.js`
 * and one line here. `semantic-control-v1` validates a control against ONE game's
 * catalog when the caller names the game, and against the union of every
 * registered catalog when it does not; the union is what the contract accepted
 * before it took a game, kept so no existing caller is refused.
 * CONTRACT:semantic-control-v1.
 */
import { FNAF1_CONTROL_CATALOG, FNAF1_PACKAGE } from '../games/fnaf1/controls.ts';
import { FNAF2_ARTIFACT_ACTIONS, FNAF2_CONTROL_CATALOG, FNAF2_PACKAGE } from '../games/fnaf2/controls.ts';
import { FNAF3_CONTROL_CATALOG, FNAF3_PACKAGE } from '../games/fnaf3/controls.ts';
import { FNAF4_CONTROL_CATALOG, FNAF4_PACKAGE } from '../games/fnaf4/controls.ts';
import type { ControlCatalog, GamePackage } from '@sixam/kernel/contracts';

export * from './control-catalog.ts';
export { FNAF1_CONTROL_CATALOG, FNAF1_PACKAGE, FNAF2_ARTIFACT_ACTIONS, FNAF2_CONTROL_CATALOG, FNAF2_PACKAGE,
  FNAF3_CONTROL_CATALOG, FNAF3_PACKAGE, FNAF4_CONTROL_CATALOG, FNAF4_PACKAGE };

export const CONTROL_CATALOGS = Object.freeze({
  [FNAF1_PACKAGE]: FNAF1_CONTROL_CATALOG,
  [FNAF2_PACKAGE]: FNAF2_CONTROL_CATALOG,
  [FNAF3_PACKAGE]: FNAF3_CONTROL_CATALOG,
  [FNAF4_PACKAGE]: FNAF4_CONTROL_CATALOG,
});

/** Every registered game's package, in registry order. */
export const GAME_PACKAGES = Object.freeze(Object.keys(CONTROL_CATALOGS));

const BY_PACKAGE: Readonly<Record<string, ControlCatalog>> = CONTROL_CATALOGS;

/** The catalog for `game`, or a refusal naming the registered games. */
export function controlCatalogFor(game: unknown): ControlCatalog {
  const catalog = typeof game === 'string' && Object.hasOwn(BY_PACKAGE, game) ? BY_PACKAGE[game] : null;
  if (!catalog)
    throw new TypeError(`control catalog: ${JSON.stringify(game)} is not a registered game ` +
      `(${GAME_PACKAGES.join(', ')})`);
  return catalog;
}

/**
 * The game a `targetBuild` names. A device profile's `targetBuild` is
 * `<package>:<version>` (`com.scottgames.fnaf2:2.0.7+26`); the package half is
 * the profile's game dimension, so no profile file changes to carry it.
 */
export function gameOfTargetBuild(targetBuild: unknown): { readonly game: GamePackage, readonly version: string } {
  const match = typeof targetBuild === 'string' ? /^([a-z][a-z0-9_.]*):(\S+)$/.exec(targetBuild) : null;
  if (!match) throw new TypeError(`control catalog: targetBuild ${JSON.stringify(targetBuild)} is not <package>:<version>`);
  // A catalog is registered under its own game, so its game is the package the build named.
  return Object.freeze({ game: controlCatalogFor(match[1]).game, version: match[2] });
}

/**
 * The artifact action table `device-executor-v1` validates `game`'s requests
 * against. Only a game whose night runs through that executor has one.
 */
export function artifactActionTableFor(game: unknown) {
  const table = controlCatalogFor(game).artifactActions;
  if (!table)
    throw new TypeError(`control catalog: ${game} has no artifact action table; ` +
      'its nights do not run through device-executor-v1');
  return table;
}
