/**
 * FNaF 3's control catalog.
 *
 * The names are the semantic roles of its *measured* touch and click targets
 * (2026-09-19, `04-Office`): the audio lure's play button, the vent-map
 * toggle, the seal-vent button, and the four reboot selections that the
 * `rebooting` counter distinguishes. They are roles, not on-screen labels, for
 * the same reason `continue` names FNaF 3's LOAD GAME entry: this vocabulary is
 * semantic.
 *
 * FNaF 3 addresses fifteen locations -- ten cameras and five vents sharing one
 * numbering -- which is why the camera range is no longer FNaF 2's 0-12.
 *
 * Anchors, the frame each control is pressed on, and the device control map's
 * own key for it (listed as an alias) are
 * packages/play/profiles/fnaf3/moto-g56/controls-fnaf3-moto-g56-v204.json. A control drawn on
 * the monitor needs the monitor up; the reboot rows need the maintenance menu
 * open, a state this catalog's precondition vocabulary does not have yet.
 * FNaF 3 runs through its own device lane, so it has no artifact table.
 * CONTRACT:semantic-control-v1.
 */
import { CONTROL_CATALOG_SCHEMA, defineControlCatalog } from '../../clockwork/control-catalog.js';

export const FNAF3_PACKAGE = 'com.scottgames.fnaf3';

const NO_READER = 'UNKNOWN(no-effect-reader)';
const touch = anchor => ({ adapter: 'touch', contact: 'UNKNOWN(not-stated)', anchor });
const MAINTENANCE = 'UNKNOWN(maintenance-menu-state-not-in-vocabulary)';

export const FNAF3_CONTROL_CATALOG = defineControlCatalog({
  schema: CONTROL_CATALOG_SCHEMA,
  game: FNAF3_PACKAGE,
  title: 'FNaF 3',
  controls: [
    // The tab exists only in the right view: measured at pan right.
    { id: 'monitor', aliases: [], binding: touch('world'), requires: 'UNKNOWN(not-modelled)', observes: NO_READER },
    { id: 'audioLure', aliases: ['playAudio'], binding: touch('screen'), requires: { monitor: 'up' }, observes: NO_READER },
    { id: 'ventMapToggle', aliases: ['mapToggle'], binding: touch('screen'), requires: { monitor: 'up' }, observes: NO_READER },
    // The seal bars sit beside each vent camera on the vent map.
    { id: 'sealVent', aliases: [], binding: touch('screen'), requires: { monitor: 'up' }, observes: NO_READER },
    { id: 'rebootAudio', aliases: [], binding: touch('screen'), requires: MAINTENANCE, observes: NO_READER },
    { id: 'rebootCamera', aliases: [], binding: touch('screen'), requires: MAINTENANCE, observes: NO_READER },
    { id: 'rebootVentilation', aliases: ['rebootVent'], binding: touch('screen'), requires: MAINTENANCE, observes: NO_READER },
    { id: 'rebootAll', aliases: [], binding: touch('screen'), requires: MAINTENANCE, observes: NO_READER },
  ],
  cameras: {
    /** 1-10 are cameras and 11-15 are vents, in one measured numbering. */
    range: [1, 15],
    binding: touch('screen'),
    requires: { monitor: 'up' },
    observes: NO_READER,
  },
  modelControls: [],
  auxiliaryPoints: [],
  artifactActions: null,
  sources: ['packages/play/profiles/fnaf3/moto-g56/controls-fnaf3-moto-g56-v204.json (anchors, frames, map keys)'],
});
