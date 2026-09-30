/**
 * Compatibility shim for `@sixam/core/control` (ADR 0002 migrations D4 and M8).
 * Nothing here is implemented in core any more:
 *
 * - the control vocabulary and the per-game control catalogs live in
 *   `@sixam/source`, re-exported by name (`core.control-vocabulary-shim` in
 *   docs/architecture/generated/legacy-paths.json);
 * - the policy language (`@sixam/propose/policy`) and FNaF 2's controllers and
 *   cycle machinery (`@sixam/propose/fnaf2`) live in `@sixam/propose`
 *   (`core.control-policy-shim`).
 *
 * Its export set is the one it had before either move. It stays because
 * tools/device/minus-toys-plan.mjs, whose bytes every Minus Toys bundle hashes
 * into engine.sourceSha256, imports it, as do two tools/recompile modules.
 * New code imports `@sixam/source` and `@sixam/propose`.
 */
export {
  ALL_GAME_CONTROL_NAMES, ARTIFACT_ACTION_TABLE_SCHEMA, BINDING_ANCHORS, BINDING_CONTACTS, CONTROL_CATALOGS,
  CONTROL_CATALOG_SCHEMA, CONTROL_VOCABULARY, DEVICE_CONTROL_NAMES, FNAF1_CONTROL_CATALOG, FNAF1_CONTROL_VOCABULARY,
  FNAF1_PACKAGE, FNAF2_ARTIFACT_ACTIONS, FNAF2_CONTROL_CATALOG, FNAF2_CONTROL_VOCABULARY, FNAF2_PACKAGE,
  FNAF3_CONTROL_CATALOG, FNAF3_CONTROL_VOCABULARY, FNAF3_PACKAGE, FNAF4_CONTROL_CATALOG, FNAF4_CONTROL_VOCABULARY,
  FNAF4_PACKAGE, GAME_CONTROLS, GAME_PACKAGES, LEGACY_CONTROL_NAMES, MAX_GAME_CAMERA_INDEX, MODEL_CONTEXT_LIGHT,
  PRECONDITION_VALUES, artifactActionTableFor, catalogAcceptsControl, catalogCamera, controlCatalogFor, controlIds,
  controlVocabularyFor, defineControlCatalog, gameOfTargetBuild, isUnknown, unknownProfilePoints,
} from '@sixam/source';
export * from '@sixam/propose/policy';
export * from '@sixam/propose/fnaf2';
