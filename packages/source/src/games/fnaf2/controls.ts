/**
 * FNaF 2's control catalog and its artifact action table: the FNaF 2
 * cartridge's half of `semantic-control-v1` and `device-executor-v1`.
 *
 * The seven control ids are serialized in every committed plan, winner and
 * run pack, so they are frozen (ADR 0002): this file may say more about a
 * control, never rename one. Each fact names where it was read; a fact that
 * was never read is `UNKNOWN(reason)`.
 *
 * - `requires`: packages/propose/bin/plans/artifact-commands.mjs refuses a plan that breaks
 *   these (every control but the mask is illegal while the mask is up; the
 *   mask and the lights below it need the monitor down; the feed light, the
 *   cameras and the wind need it up; a wind needs the box camera viewed,
 *   plant-model.js `winding && monitor === MON_UP && viewing === C.BOX_CAM`).
 * - `binding.anchor`: the profile's `view-scroll-v1` block (04-Office layers):
 *   the four lights are layer 0 at xCoef 1.0 (`world`), the flip mask button
 *   is pinned on layer 4 (`screen`), and the monitor toggle's own hitbox was
 *   not traced.
 * - `observes`: the fact that confirms the control's effect on the phone --
 *   `monitorUp` (monitor-rule-v1), `maskOn` (the effect grader in
 *   packages/play/src/campaign/control-effect.ts) and `cameraSelected` (camera-rule-v1).
 * - `model`: the simulator action the control drives. Both lights drive the
 *   one context-dependent `light` (packages/propose/bin/plans/device-lane.mjs SIM_ACTION).
 * CONTRACT:semantic-control-v1 CONTRACT:device-executor-v1.
 */
import { ARTIFACT_ACTION_TABLE_SCHEMA, CONTROL_CATALOG_SCHEMA, defineControlCatalog } from '../../clockwork/control-catalog.ts';

export const FNAF2_PACKAGE = 'com.scottgames.fnaf2';

const touch = (contact, anchor) => ({ adapter: 'touch', contact, anchor });
const NO_READER = 'UNKNOWN(no-effect-reader)';

/**
 * The FNaF 2 artifact action table. Until D5 these rules were literals in
 * apps/device/src/artifact-executor.js (validateAction), where a transport
 * module decided that `camdrop` holds the feed light and `observe-left` reads
 * the left vent -- mechanics in the transport layer, which the charter
 * forbids. The executor now reads them from here, for the request's game.
 */
const FNAF2_ARTIFACT_ACTION_TABLE = {
  schema: ARTIFACT_ACTION_TABLE_SCHEMA,
  game: FNAF2_PACKAGE,
  // The seven controls, and the cameras the reviewed plans select; an
  // artifact action naming any other camera is refused.
  controls: ['monitor', 'mask', 'cameraFeedLight', 'hallLight', 'leftVentLight', 'rightVentLight',
    'wind', 'cam:4', 'cam:5', 'cam:7', 'cam:8', 'cam:9', 'cam:10', 'cam:11'],
  kinds: {
    // A monitor target state, never a parity toggle.
    ensure: { controls: ['monitor'] },
    tap: { controls: '*' },
    press: { controls: '*' },
    hold: { controls: '*' },
    compound: { controls: '*' },
    'sweep-slot': { controls: ['cam:4', 'cam:5', 'cam:7', 'cam:8', 'cam:9', 'cam:10', 'cam:11'] },
    // The Minus 3 vent read: hold the left vent light, then the mask.
    'observe-left': { controls: ['leftVentLight'] },
  },
  // Fields each compound pins, checked in this order.
  compounds: {
    hallvent: { control: 'hallLight', ventControl: 'rightVentLight' },
    hallraise: { control: 'hallLight' },
    maskraise: {},
    camdrop: { control: 'cameraFeedLight' },
  },
  // The double-camera arm: two highlighted cameras in CAM 01-12, and the
  // first wind must come after its window closes.
  armVerification: { cameras: [1, 12], firstAction: 'wind' },
};

export const FNAF2_CONTROL_CATALOG = defineControlCatalog({
  schema: CONTROL_CATALOG_SCHEMA,
  game: FNAF2_PACKAGE,
  title: 'FNaF 2',
  controls: [
    { id: 'monitor', aliases: [], model: 'monitor',
      binding: touch('tap', 'UNKNOWN(not-traced)'), requires: { mask: 'off' }, observes: 'monitorUp' },
    { id: 'mask', aliases: [], model: 'mask',
      binding: touch('tap', 'screen'), requires: { monitor: 'down' }, observes: 'maskOn' },
    { id: 'cameraFeedLight', aliases: [], model: 'light',
      binding: touch('hold', 'world'), requires: { monitor: 'up', mask: 'off' }, observes: NO_READER },
    { id: 'hallLight', aliases: [], model: 'light',
      binding: touch('hold', 'world'), requires: { monitor: 'down', mask: 'off' }, observes: NO_READER },
    { id: 'leftVentLight', aliases: ['ventL'], model: 'ventL',
      binding: touch('hold', 'world'), requires: { monitor: 'down', mask: 'off' }, observes: NO_READER },
    { id: 'rightVentLight', aliases: ['ventR'], model: 'ventR',
      binding: touch('hold', 'world'), requires: { monitor: 'down', mask: 'off' }, observes: NO_READER },
    // Old plans already spelled it `wind`; listed so the legacy translation
    // table stays generated rather than written out twice.
    { id: 'wind', aliases: ['wind'], model: 'wind',
      binding: touch('hold', 'UNKNOWN(not-stated)'),
      requires: { monitor: 'up', mask: 'off', viewing: 'cam:11' }, observes: NO_READER },
  ],
  cameras: {
    // CAM 1-12, plus `cam:0`, which semantic-control-v1 has always allowed.
    range: [0, 12],
    binding: touch('tap', 'UNKNOWN(not-stated)'),
    requires: { monitor: 'up', mask: 'off' },
    observes: 'cameraSelected',
  },
  // Simulator names the contract keeps accepting for source fidelity: `light`
  // is the camera flash with the monitor up and the hall flash with it down,
  // so device artifacts never use it.
  modelControls: ['light', 'hall', 'ventL', 'ventR'],
  // Profile points that are not controls: the phone-call mute button.
  auxiliaryPoints: ['mute'],
  artifactActions: FNAF2_ARTIFACT_ACTION_TABLE,
  sources: [
    'packages/propose/bin/plans/artifact-commands.mjs (preconditions)',
    'packages/play/profiles/fnaf2/moto-g56/hid-mediaprojection.json viewScroll (anchors)',
    'packages/play/src/sensors/fnaf2/monitor-rule.ts, camera-rule.js; packages/play/src/campaign/control-effect.ts (observations)',
  ],
});

/** The table the artifact executor validates FNaF 2 requests against. */
export const FNAF2_ARTIFACT_ACTIONS = FNAF2_CONTROL_CATALOG.artifactActions;
