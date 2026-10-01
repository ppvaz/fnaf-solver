// Gate for the device-proven Minus 3 frame-light recipe. No phone required.
//
// The recipe in minus3-frame-light.ts is the schedule that cleared story
// Nights 3 and 4 on the Moto g56. Until it was written down it existed only as
// an inline schedule in a one-off runner under a gitignored artifacts
// directory: a `rm -rf artifacts/` would have deleted the only copy of the
// thing that won. This checks the three ways it can rot silently:
//
//  1. the recipe still expands to the exact 774 contact edges the winning run
//     actuated, by hash -- a knob edit that changes the schedule fails here
//     rather than on the phone;
//  2. the recipe stays a delta on the shipped KNOBS0, and the shipped default
//     is not dragged along with it (the default is what the 3000-seed story
//     gate measures; the recipe is what the device ran);
//  3. every control the recipe names is one the resolved profile can actuate,
//     and the two flash points stay distinct -- the winning run pressed
//     `cameraFeedLight` and `hallLight` at different measured coordinates, and collapsing them
//     onto one control would silently actuate a different schedule.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { KNOBS0, emitPlan } from './minus-3-plan.mjs';
import { WIN_KNOBS, MASK_GAP_MS, EDGES_SHA256, deviceEdges, edgesSha256, winRows, census }
  from './minus3-frame-light.ts';

const here = dirname(fileURLToPath(import.meta.url));
const check = (ok, message) => { if (!ok) throw new Error(message); };

// --- 1. the recipe still reproduces the edges that won -----------------------
const edges = deviceEdges();
check(edges.length === 774, `recipe expands to ${edges.length} edges, not the 774 that won`);
check(edgesSha256(edges) === EDGES_SHA256,
  `recipe edge hash ${edgesSha256(edges)} does not match the winning run ${EDGES_SHA256}`);
check(deviceEdges({ knobs: { ...WIN_KNOBS, windMs: WIN_KNOBS.windMs + 250 } }).length === 774 &&
  edgesSha256(deviceEdges({ knobs: { ...WIN_KNOBS, windMs: WIN_KNOBS.windMs + 250 } })) !== EDGES_SHA256,
  'a windMs change did not alter the edge hash -- deviceEdges is not reading its knobs');

// Contacts are well formed: every down is matched by a later up on the same
// control, and no control is pressed twice without being released.
{
  const held = new Map();
  for (const e of edges) {
    if (e.down) {
      check(!held.has(e.control), `${e.control} pressed again at ${e.atMs} while still held`);
      held.set(e.control, e.atMs);
    } else {
      check(held.has(e.control), `${e.control} released at ${e.atMs} without being held`);
      check(held.get(e.control) < e.atMs, `${e.control} released at its own press time`);
      held.delete(e.control);
    }
  }
  check(held.size === 0, `schedule ends holding ${[...held.keys()].join(', ')}`);
}

// --- 2. the recipe is a delta on KNOBS0, and the default is untouched --------
{
  const changed = Object.keys(WIN_KNOBS).filter(k => WIN_KNOBS[k] !== KNOBS0[k]).sort();
  // KNOBS0's wind timing was corrected to the device-proven raise+500 ms on
  // 2026-09-09, so the recipe no longer has to override it: the delta shrank
  // from five fields to three.
  //
  // It grew back to five on 2026-09-19, in the other direction. KNOBS0's
  // OPENING wind sat at 2050 ms -- raise+434, exactly the wind-ready floor,
  // zero slack -- so the default moved to raise+434+33 = 2083. The device-proven
  // recipe must not follow it: 2050/1800 is what actuated the 774 edges that
  // cleared Nights 3 and 4, and check 1 above failed the moment the default
  // dragged it. The recipe pins both fields by value now, so the winning
  // schedule is immune to future KNOBS0 corrections.
  check(JSON.stringify(changed) ===
    JSON.stringify(['maskOnMs', 'openMaskAtMs', 'openWindAtMs', 'openWindMs', 'secondHallVent']),
    `the recipe now differs from KNOBS0 in ${JSON.stringify(changed)}; update this gate and the evidence record`);
  check(KNOBS0.secondHallVent === true,
    'the shipped default lost its right-vent second contact -- that is what the story gate measured');
  check(WIN_KNOBS.secondHallVent === false,
    'the recipe gained a right-vent hold the winning device runs did not fire');
  check(emitPlan(3).includes('hallvent') && !emitPlan(3, WIN_KNOBS).includes('hallvent'),
    'the secondHallVent knob no longer selects the emitted second contact');
  // The mask follows the monitor press by the measured gap, not the light tail.
  check(WIN_KNOBS.openMaskAtMs === WIN_KNOBS.openCamdropAtMs + WIN_KNOBS.openCamdropLeadMs + MASK_GAP_MS,
    'opening mask is no longer monitor-press + MASK_GAP_MS');
  check(WIN_KNOBS.maskOnMs === WIN_KNOBS.camdropMs + WIN_KNOBS.camdropLeadMs + MASK_GAP_MS,
    'clear-cycle mask is no longer monitor-press + MASK_GAP_MS');
}

// --- 3. controls resolve, and the two flash points stay distinct -------------
{
  const profile = JSON.parse(readFileSync(join(here, '../../../../packages/play/profiles/fnaf2/moto-g56/hid-mediaprojection.json')));
  const map = profile.controlMap;
  const used = [...new Set(edges.map(e => e.control))].sort();
  for (const control of used)
    check(map[control] !== undefined, `the recipe actuates ${control}, absent from the profile controlMap`);
  check(used.includes('cameraFeedLight') && used.includes('hallLight'),
    'the recipe no longer presses both distinct flash controls');
  check(JSON.stringify(map.cameraFeedLight) !== JSON.stringify(map.hallLight),
    'profile cameraFeedLight and hallLight collapsed onto one point -- the winning schedule pressed them apart');
  const { clear } = winRows();
  check(clear.some(row => row[1] === 'hall'), 'the recipe clear cycle lost its hall-only contact');
}

// --- 4. the model still drives this schedule to a win ------------------------
// A determinism check, not a rate: the measured rates live at 3000 seeds in the
// evidence records and in `--census`, which is where a number may be quoted from.
{
  const one = census(3, { runs: 1 });
  check(one.wins === 1 && one.split === 1,
    'the recipe no longer clears night 3 on the first census seed with the split armed');
}

console.log(
  'minus3 frame light: recipe expands to the 774 edges that cleared Nights 3 and 4 ' +
  `(sha256 ${EDGES_SHA256.slice(0, 12)}), contacts are balanced, it is a five-field delta on ` +
  'KNOBS0 with the shipped default untouched, and every control resolves with cameraFeedLight/hallLight distinct');
