/**
 * Semantic control laws, policy IR, and reviewed cycle primitives.
 *
 * The control vocabulary and the per-game control catalogs moved to
 * `@sixam/source` (ADR 0002 migration D4). This barrel re-exports them by
 * name, so its export set is the one it had before the move: a compatibility
 * shim registered in docs/architecture/generated/legacy-paths.json
 * (`core.control-vocabulary-shim`). New code imports them from `@sixam/source`.
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
export * from './policy-ir.js';
export * from './observation-language.js';
export * from './controller.js';
export * from './cycle-library.js';
export * from './cycle-planner.js';
export * from './cycle-controller.js';
export * from './night-policy.js';
export * from './ports.js';
