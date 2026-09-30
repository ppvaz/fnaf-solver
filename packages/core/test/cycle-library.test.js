// Plan 20 package 4: finite cycle primitives and fail-closed constraint gate.
import { DEVICE_CONSTRAINTS, gateCycle, getCycle } from '@sixam/core/control';
import { initialReducedState, advanceReduced, applyReduced } from '@sixam/source/fnaf2';
import * as C from '@sixam/source/fnaf2';

const check = (condition, message) => { if (!condition) throw new Error(message); };

// Establish the only state the wind primitive is allowed to assume: monitor
// up, controls known, and the sourced box camera selected.
let state = initialReducedState({ night: 1 });
state = applyReduced(state, 'monitor').state;
state = advanceReduced(state, C.MONITOR_ANIM_UP);
state = applyReduced(state, 'cam:11').state;
state.controlUnknown.monitor = false;
state.controlUnknown.mask = false;

const exactPass = cycle => ({ accepted: true, cycleId: cycle.id });
let result = gateCycle(getCycle('wind-and-anchor'), state, { exactGate: exactPass });
check(result.accepted, `reviewed wind primitive was rejected: ${result.reasons.join(', ')}`);
check(result.record.cycleId === 'wind-and-anchor' && result.record.reasons.length === 0,
  'accepted cycle did not produce a readable clean decision record');

// A defensive mask is not legal while the monitor is up, and no exact proof
// callback can override a local engine prerequisite.
result = gateCycle(getCycle('defensive-mask'), state, { exactGate: exactPass });
check(!result.accepted && result.reasons.some(reason => reason.startsWith('prerequisite:monitor')),
  'unsafe monitor/mask ordering was accepted');

// An action that lands during an existing monitor animation is rejected before
// it can be treated as a verified transition.
const animation = getCycle('verify-and-resume');
animation.actions.push({ atFrame: 1, kind: 'press', action: 'monitor', contactMs: 33 });
result = gateCycle(animation, applyReduced(initialReducedState({ night: 1 }), 'monitor').state,
  { exactGate: exactPass });
check(!result.accepted && result.reasons.some(reason => reason.startsWith('animation-window')),
  'monitor animation collision was accepted');

// Device-contact constraints and the exact-engine proof are independent gates.
const contact = getCycle('wind-and-anchor');
contact.actions[0].contactMs = 1;
result = gateCycle(contact, state, { exactGate: exactPass });
check(!result.accepted && result.reasons.some(reason => reason.startsWith('contact-floor')),
  'sub-floor contact was accepted');
result = gateCycle(getCycle('wind-and-anchor'), state);
check(!result.accepted && result.reasons.includes('exact-model-gate-missing'),
  'cycle without exact proof callback was admitted');

// The reduced model must not report a no-op control as accepted merely because
// the source stores its pressed bit. These are the same impossible surfaces the
// device artifact compiler refuses by semantic name.
const monitorRaising = applyReduced(initialReducedState({ night: 1 }), 'monitor').state;
check(!applyReduced(monitorRaising, 'monitor').accepted,
  'monitor reversal during its animation was accepted');
check(!applyReduced(initialReducedState({ night: 1 }), 'wind').accepted,
  'wind while the monitor is down was accepted');
const monitorUp = advanceReduced(monitorRaising, C.MONITOR_ANIM_UP);
check(!applyReduced(monitorUp, 'ventR').accepted,
  'right vent light while the monitor is up was accepted');

check(DEVICE_CONSTRAINTS.minContactMs === 33 && DEVICE_CONSTRAINTS.minReleasedMs === 33,
  'device constraint profile lost its measured floors');
console.log('cycle library: reviewed primitive, prerequisite, animation, contact, and exact-proof gates pass');

// --- Prerequisite reachability ------------------------------------------------
//
// A primitive whose prerequisites no sequence of library primitives can
// establish is dead code: the planner can never legally select it. This is not
// hypothetical -- it is why the check exists. Measured 2026-09-02, before
// `select-box-cam` / `lower-monitor` / `unmask` were added: `wind-and-anchor`
// was rejected at 1800/1800 decision boundaries for
// `prerequisite:monitor="down" | prerequisite:viewedCamera=null`, the controller
// selected `observe-and-hold` 241 times and nothing else, and Night 1 ended
// `death=puppet` at ~4 AM. No primitive emitted a `cam:` action and
// `C.initialCamera(1)` is CAM 09, not `C.BOX_CAM`. The register below is empty
// because that gap is closed; an entry records a defect, it does not excuse one.
//
// Plan 20 P5's nine-second blackout fixture cannot see this, and the wind gate
// above hand-builds the state the library cannot reach on its own.
import { CYCLE_LIBRARY } from '@sixam/core/control';

const keyOf = reduced => JSON.stringify([reduced.monitor, reduced.maskOn,
  reduced.viewedCamera, reduced.winding, reduced.lightHeld,
  reduced.ventLightL, reduced.ventLightR]);

// Bounded forward search over the library's own actions. Depth is small on
// purpose: a prerequisite needing a long setup the planner would have to
// discover is itself a finding, not a passing result.
const SEARCH_DEPTH = 4;
function reachableStates(depth) {
  let frontier = [initialReducedState({ night: 1 })];
  const seen = new Map([[keyOf(frontier[0]), frontier[0]]]);
  for (let step = 0; step < depth; step++) {
    const next = [];
    for (const state of frontier) {
      for (const cycle of CYCLE_LIBRARY) {
        let candidate = state;
        let ok = true;
        for (const action of cycle.actions) {
          candidate = advanceReduced(candidate, candidate.frame + action.atFrame);
          const applied = applyReduced(candidate, action.action, action.kind);
          if (!applied.accepted) { ok = false; break; }
          candidate = applied.state;
        }
        if (!ok) continue;
        candidate = advanceReduced(candidate, candidate.frame + cycle.durationFrames);
        const key = keyOf(candidate);
        if (seen.has(key)) continue;
        seen.set(key, candidate);
        next.push(candidate);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return [...seen.values()];
}

const reachable = reachableStates(SEARCH_DEPTH);
const satisfies = (state, prerequisite) => {
  const field = prerequisite.field;
  if (field.startsWith('controlUnknown.') || field.startsWith('hazards.')) return true;
  return JSON.stringify(state[field]) === JSON.stringify(prerequisite.equals);
};

const unreachable = [];
for (const cycle of CYCLE_LIBRARY) {
  if (!reachable.some(state => cycle.prerequisites.every(p => satisfies(state, p))))
    unreachable.push(cycle.id);
}

// Known-negative register. An entry records a defect, it does not excuse one:
// shrinking this list is the fix, an unlisted gap fails, and a fixed entry that
// is left behind also fails.
const KNOWN_UNREACHABLE = new Map();

for (const id of unreachable) {
  check(KNOWN_UNREACHABLE.has(id),
    `primitive ${id} has prerequisites no library sequence can establish, ` +
    `and is not recorded as a known negative`);
}
for (const id of KNOWN_UNREACHABLE.keys()) {
  check(unreachable.includes(id),
    `${id} is recorded as unreachable but the library can now establish it -- ` +
    `remove it from KNOWN_UNREACHABLE`);
}

check(reachable.length > 1, 'reachability search explored no states');
console.log(`cycle library: prerequisite reachability over ${reachable.length} states ` +
  `(depth ${SEARCH_DEPTH}); unreachable = [${unreachable.join(', ')}], all recorded`);
