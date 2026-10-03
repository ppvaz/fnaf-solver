/**
 * Canonical project vocabulary for controls, generated per game from the
 * control catalogs registered in ./control-registry.js (LEG-007).
 *
 * The sourced simulator intentionally keeps `light` as its historical
 * context-dependent game action: it is the camera flash with the monitor up
 * and the hall flash with the monitor down.  Device artifacts must not use
 * that overloaded name.  They use the physical names below instead.
 *
 * Every export here existed before the catalogs and keeps its name and its
 * value. `CONTROL_VOCABULARY` and `DEVICE_CONTROL_NAMES` are FNaF 2's, as
 * they always were; new code names the game (`FNAF2_CONTROL_VOCABULARY`, or
 * `controlVocabularyFor(game)`) so a second game's tool cannot pick FNaF 2's
 * controls up by accident.
 * CONTRACT:semantic-control-v1.
 */
import { CONTROL_CATALOGS, FNAF2_CONTROL_CATALOG, controlCatalogFor, controlIds } from './control-registry.ts';
import type { ControlCatalog, GameControl, GamePackage } from '@sixam/kernel/contracts';

/** `{ id: id }` for one catalog, in catalog order. */
const vocabularyOf = <G extends GamePackage>(catalog: ControlCatalog<G>) =>
  Object.freeze(Object.fromEntries(controlIds(catalog).map(id => [id, id]))) as { readonly [K in GameControl<G>]: K };

/** A game's control vocabulary, `{ id: id }`, generated from its catalog. */
export const controlVocabularyFor = (game: unknown) => vocabularyOf(controlCatalogFor(game));

export const FNAF2_CONTROL_VOCABULARY = vocabularyOf(FNAF2_CONTROL_CATALOG);

/** FNaF 2's vocabulary under its original, game-less name. */
export const CONTROL_VOCABULARY = FNAF2_CONTROL_VOCABULARY;

/** The simulator-only action retained for source fidelity. */
export const MODEL_CONTEXT_LIGHT = 'light';

/**
 * Names accepted only when translating old inputs: FNaF 2's catalog aliases.
 * New plans and profiles must use the vocabulary; `light` is deliberately
 * absent because its meaning depends on monitor state.
 */
export const LEGACY_CONTROL_NAMES = Object.freeze(Object.fromEntries(
  FNAF2_CONTROL_CATALOG.controls.flatMap(control => control.aliases.map(alias => [alias, control.id]))));

/** FNaF 2's seven controls, in catalog order. */
export const DEVICE_CONTROL_NAMES = Object.freeze(controlIds(FNAF2_CONTROL_CATALOG));

/**
 * Per-game control names and camera ranges, keyed by package: the catalogs'
 * summary in the shape this registry had before them. `cameraRange` is
 * `[lo, hi]`, `null` (the game has no cameras) or `UNKNOWN(reason)`.
 */
export const GAME_CONTROLS = Object.freeze(Object.fromEntries(Object.entries(CONTROL_CATALOGS)
  .map(([game, catalog]) => [game, Object.freeze({
    controls: catalog === FNAF2_CONTROL_CATALOG ? DEVICE_CONTROL_NAMES : Object.freeze(controlIds(catalog)),
    cameraRange: catalog.cameras.range,
  })])));
