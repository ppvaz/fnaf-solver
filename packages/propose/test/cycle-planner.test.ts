// Plan 20 package 5 foundation: worst-case finite-cycle selection.
import { getCycle } from '@sixam/propose/fnaf2';
import { selectCycle } from '@sixam/propose/fnaf2';
import { initialReducedState, advanceReduced, applyReduced } from '@sixam/source/fnaf2';
import * as C from '@sixam/source/fnaf2';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const exactPass = (cycle, hypothesis) => ({ accepted: true, cycleId: `${cycle.id}/${hypothesis.id}` });
const score = (cycle, hypothesis) => {
  // Deliberately make the second candidate cheaper only in the easy state and
  // riskier in the hard state; a weighted average would choose incorrectly.
  if (cycle.id === 'cheap-wind')
    return { risk: hypothesis.id === 'hard' ? 0.90 : 0.05, resourceMargin: 10 };
  return { risk: 0.60, resourceMargin: 2 };
};

let state = initialReducedState({ night: 1 });
state = applyReduced(state, 'monitor').state;
state = advanceReduced(state, C.MONITOR_ANIM_UP);
state = applyReduced(state, 'cam:11').state;
state.controlUnknown.monitor = false;
state.controlUnknown.mask = false;

const cheap = getCycle('wind-and-anchor');
cheap.id = 'cheap-wind';
const safe = getCycle('wind-and-anchor');
safe.id = 'safe-wind';

let decision = selectCycle([cheap, safe], [
  { id: 'easy', state }, { id: 'hard', state },
], { exactGate: exactPass, score });
check(decision.selected === 'safe-wind',
  'selector used an average instead of the worst plausible hypothesis');
check(decision.record.hypotheses.join(',') === 'easy,hard',
  'selected decision record omitted a plausible hypothesis');

// A primitive that is valid in one state cannot be selected when the belief
// still includes a monitor-down state. The rejected reason remains visible.
const down = initialReducedState({ night: 1 });
down.controlUnknown.monitor = false;
down.controlUnknown.mask = false;
decision = selectCycle([getCycle('wind-and-anchor')], [
  { id: 'up', state }, { id: 'down', state: down },
], { exactGate: exactPass, score: () => ({ risk: 0, resourceMargin: 1 }) });
check(decision.selected === null && decision.decisions[0].reasons
  .some(reason => reason.startsWith('down:prerequisite:monitor')),
  'unsafe cycle was selected across a plausible monitor-down state');

// The selected route can be verified from the down-state hypothesis once the
// matching primitive is offered.
decision = selectCycle([getCycle('verify-and-resume')], [{ id: 'down', state: down }], {
  exactGate: exactPass, score: () => ({ risk: 0.1, resourceMargin: 4 }),
});
check(decision.selected === 'verify-and-resume', 'safe recovery primitive was not selectable');
console.log('cycle planner: worst-case selection, plausible-state rejection, and decision records pass');
