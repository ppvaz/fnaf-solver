/**
 * FNaF 4's control catalog, measured 2026-09-20 on the handset from the
 * labels the game itself draws on Night 1 (`03-04-level` groups 722-729).
 *
 * Two facts are encoded in the descriptors rather than in a control map. The
 * three `run*` roles are reached by a DOUBLE contact, not a single one; and
 * `flashlight` and `closeDoor` are HOLDS with no latched state -- the door is
 * shut only while contact persists. A schedule for FNaF 4 therefore carries
 * contact durations where a FNaF 1/2 schedule carries toggles.
 *
 * FNaF 4 has no cameras, so its camera range is `null`. That absence is the
 * point: the field was FNaF 2's, generalised for FNaF 3, and a third game shows
 * it is not universal.
 *
 * Anchors, gestures and the device control map's own key for each role (listed
 * as an alias) are packages/play/profiles/fnaf4/moto-g56/controls-fnaf4-moto-g56-v204.json.
 * FNaF 4 runs through its own device lane, so it has no artifact table.
 * CONTRACT:semantic-control-v1.
 */
import { CONTROL_CATALOG_SCHEMA, defineControlCatalog } from '../../clockwork/control-catalog.ts';

export const FNAF4_PACKAGE = 'com.scottgames.fnaf4';

const role = (id, aliases, contact) => ({ id, aliases,
  binding: { adapter: 'touch', contact, anchor: 'screen' },
  requires: 'UNKNOWN(not-modelled)', observes: 'UNKNOWN(no-effect-reader)' });

export const FNAF4_CONTROL_CATALOG = defineControlCatalog({
  schema: CONTROL_CATALOG_SCHEMA,
  game: FNAF4_PACKAGE,
  title: 'FNaF 4',
  controls: [
    role('runLeftDoor', ['leftDoor'], 'double'),
    role('runRightDoor', ['rightDoor'], 'double'),
    role('runCloset', ['closet'], 'double'),
    role('goBack', ['back'], 'UNKNOWN(not-stated)'),
    role('flashlight', [], 'hold'),
    role('closeDoor', [], 'hold'),
  ],
  cameras: { range: null },
  modelControls: [],
  auxiliaryPoints: [],
  artifactActions: null,
  sources: ['packages/play/profiles/fnaf4/moto-g56/controls-fnaf4-moto-g56-v204.json (anchors, gestures, map keys)'],
});
