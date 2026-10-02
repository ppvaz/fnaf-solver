// Plan 20 package 5 foundation: worst-case finite-cycle selection.
import { getCycle } from '@sixam/propose/fnaf2';
import { selectCycle } from '@sixam/propose/fnaf2';
import { initialReducedState, advanceReduced, applyReduced } from '@sixam/source/fnaf2';
import * as C from '@sixam/source/fnaf2';
import type { Cycle } from '@sixam/propose/fnaf2';

type Hypothesis = Parameters<typeof selectCycle>[1][number];
// getCycle hands back a fresh clone, which the fixtures below rename in place.
type EditableCycle = { -readonly [K in keyof Cycle]: Cycle[K] };

const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const exactPass = (cycle: Cycle, hypothesis: Hypothesis) => ({ accepted: true, cycleId: `${cycle.id}/${hypothesis.id}` });
const score = (cycle: Cycle, hypothesis: Hypothesis) => {
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

const cheap = getCycle('wind-and-anchor') as EditableCycle; // a library id, so never null
cheap.id = 'cheap-wind';
const safe = getCycle('wind-and-anchor') as EditableCycle; // a library id, so never null
safe.id = 'safe-wind';

let decision = selectCycle([cheap, safe], [
  { id: 'easy', state }, { id: 'hard', state },
], { exactGate: exactPass, score });
check(decision.selected === 'safe-wind',
  'selector used an average instead of the worst plausible hypothesis');
check(decision.record.hypotheses?.join(',') === 'easy,hard',
  'selected decision record omitted a plausible hypothesis');

// A primitive that is valid in one state cannot be selected when the belief
// still includes a monitor-down state. The rejected reason remains visible.
const down = initialReducedState({ night: 1 });
down.controlUnknown.monitor = false;
down.controlUnknown.mask = false;
decision = selectCycle([getCycle('wind-and-anchor') as Cycle], [ // a library id, so never null
  { id: 'up', state }, { id: 'down', state: down },
], { exactGate: exactPass, score: () => ({ risk: 0, resourceMargin: 1 }) });
check(decision.selected === null && decision.decisions[0].reasons
  .some(reason => reason.startsWith('down:prerequisite:monitor')),
  'unsafe cycle was selected across a plausible monitor-down state');

// The selected route can be verified from the down-state hypothesis once the
// matching primitive is offered.
decision = selectCycle([getCycle('verify-and-resume') as Cycle], [{ id: 'down', state: down }], { // a library id, so never null
  exactGate: exactPass, score: () => ({ risk: 0.1, resourceMargin: 4 }),
});
check(decision.selected === 'verify-and-resume', 'safe recovery primitive was not selectable');
console.log('cycle planner: worst-case selection, plausible-state rejection, and decision records pass');
