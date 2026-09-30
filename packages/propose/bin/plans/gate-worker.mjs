// One worker's share of a model-gate sweep.
//
// A gated night is pure -- seeded RNG, no shared state -- so the gate's 1200
// seeds are embarrassingly parallel, and the night matrix's six nights are too.
// Nothing here span the threads until the suite's critical path became the
// matrix at 53 s, which is the whole wall time of `node tools/test.mjs
// --engine` and therefore the cost of every edit.
//
// The plan is rebuilt per (night, options) rather than shipped across the
// structured clone, and cached for the life of the worker: building is ~50 ms
// against 1200 replays, and a plan crossing the clone 1200 times is the kind of
// saving that costs more than it saves.
//
// Results must be bit-identical to the serial path. The seeds are named, not
// counted, so a chunk boundary cannot change which seeds ran.
import { build, devicePlan } from './recipe.mjs';
import { jitterPlan, parsePlanText, HUMAN_SLACK_MS } from './human-gate.mjs';
import { replay } from './recipe.mjs';

const cache = new Map();

function planFor(night) {
  if (!cache.has(night)) {
    const recipe = build({ night });
    const plan = devicePlan(recipe);
    const text = `#night ${recipe.night}\n` + Object.entries(plan).map(([name, lines]) =>
      `#cycle ${name} ${recipe.cycles[name].lengthMs}\n${lines.join('\n')}`).join('\n') + '\n';
    cache.set(night, parsePlanText(text).plan);
  }
  return cache.get(night);
}

// `from`..`to` inclusive, the same seeds the serial gate uses.
export function survivors({ night, from, to, slackMs = HUMAN_SLACK_MS }) {
  const plan = planFor(night);
  let won = 0;
  for (let seed = from; seed <= to; seed++) {
    const { sim } = replay(jitterPlan(plan, seed, slackMs), { night, seed });
    if (sim.won) won++;
  }
  return { night, from, to, won };
}
