/**
 * FNaF 1's control catalog, measured 2026-09-20 on the handset.
 *
 * Five controls and one hard geometric fact: the two door buttons sit at world
 * x 106 and 2885 on a 2400 px screen, so they can NEVER both be on screen and
 * every door press is pan-then-press. The door LIGHTS are here for
 * completeness, not because a route needs them -- a public clear exists with
 * them never used, paying for continuous camera tracking in power instead
 * (docs/research/FNAF-SENSOR-ABLATION-RUNS.md), which is why FNaF 1's
 * difficulty is a scheduling problem rather than a sensing one.
 *
 * `monitor` is the camera tab and keeps its FNaF 2 name because it is the same
 * semantic role. Unlike every other control here it is screen-PINNED: it reads
 * at x 475-1605 at both pan extremes.
 *
 * Anchors and the contact are tools/device/models/controls-fnaf1-moto-g56-v207.json
 * (`anchor`, and its `contactRule`: a 160 ms held contact). FNaF 1 runs through
 * its own device lane, not `device-executor-v1`, so it has no artifact table.
 * CONTRACT:semantic-control-v1.
 */
import { CONTROL_CATALOG_SCHEMA, defineControlCatalog } from './define.js';

export const FNAF1_PACKAGE = 'com.scottgames.fivenightsatfreddys';

const button = (id, anchor) => ({ id, aliases: [], binding: { adapter: 'touch', contact: 'tap', anchor },
  requires: 'UNKNOWN(not-modelled)', observes: 'UNKNOWN(no-effect-reader)' });

export const FNAF1_CONTROL_CATALOG = defineControlCatalog({
  schema: CONTROL_CATALOG_SCHEMA,
  game: FNAF1_PACKAGE,
  title: 'FNaF 1',
  controls: [
    button('monitor', 'screen'),
    button('leftDoor', 'world'),
    button('rightDoor', 'world'),
    button('leftDoorLight', 'world'),
    button('rightDoorLight', 'world'),
  ],
  cameras: {
    /** FNaF 1 HAS cameras, and their `viewing` ids are **sparse**, not a
     *  range: the Main Room sheet compares `viewing` against exactly
     *  `{1, 2, 3, 4, 5, 6, 7, 22, 33, 42, 99}` -- eleven values for eleven
     *  cameras. So this stays a string rather than an array, because a
     *  `[min, max]` would be read by `MAX_GAME_CAMERA_INDEX` and would make
     *  `cam:50` valid for every game. FNaF 4's `null` means the opposite
     *  thing (there are none), so this is still not null.
     *
     *  **Five of the eleven are now pinned by the sheet itself** (2026-09-20,
     *  recorded with their groups in `mechanics/games/fnaf1.js` `VIEWS`):
     *  1 = CAM 1A, 3 = CAM 2A (West Hall), 4 = CAM 4A, 42 = CAM 4B,
     *  99 = CAM 1C (Pirate Cove). The remaining six are inferred from the
     *  camera set, not pinned, so the label stays.
     *
     *  The Foxy `viewing <> 99` discrepancy that this note used to call the
     *  open question **is resolved**: 99 is Pirate Cove (g90-g94 render his
     *  stage art there), and watching it blocks his advance through a gate
     *  that is *separate* from the camera-attention hold -- g460 refreshes
     *  that hold from **any** camera, which is what the community means by
     *  "check any camera to hold Foxy". */
    range: 'UNKNOWN(unmapped-view-ids)',
  },
  modelControls: [],
  auxiliaryPoints: [],
  artifactActions: null,
  sources: ['tools/device/models/controls-fnaf1-moto-g56-v207.json (anchors, contact rule)'],
});
