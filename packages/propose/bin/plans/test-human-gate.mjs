// Mock regression for the model gate. No phone, no adb.
//
// Five claims: the plan text round-trips into replay()'s shape; the error
// injection is deterministic, bounded, and touches only offsets (a hold's
// release shares its press's draw by construction -- the duration column is
// untouched); a small sample is explicitly inconclusive rather than a pass or
// fail; and the shipped Night 6 plan
// PASSES under measured human slack -- the 2026-08-25 grounding after the
// Golden Freddy mask-off + raise became one measured-safe compound row.
// (The legacy shell runner's own gate-before-adb checks left with it on
// 2026-09-25; docs/ARCHIVED-ROUTES.md.)
import { parsePlanText, jitterPlan, modelGate, HUMAN_SLACK_MS, GATE_MIN_SURVIVAL }
  from './human-gate.mjs';
import { build, devicePlan } from './recipe.mjs';

let failed = 0;
const check = (name, cond, detail = '') => {
  if (!cond) { failed++; console.error(`FAIL ${name}${detail ? ` -- ${detail}` : ''}`); }
};

// ------------------------------------------------- parse: text -> plan shape
const recipe = build({ night: 6 });
const plan = devicePlan(recipe);
const text = `#night ${recipe.night}\n` + Object.entries(plan).map(([name, lines]) =>
  `#cycle ${name} ${recipe.cycles[name].lengthMs}\n${lines.join('\n')}`).join('\n') + '\n';
const { night: parsedNight, plan: parsed } = parsePlanText(text);
check('round-trips the emitted plan', JSON.stringify(parsed) === JSON.stringify(plan));
check('the plan names its own night', parsedNight === 6);
let threw = false;
try { parsePlanText('#cycle x 1000\n0 teleport monitor 100\n'); } catch { threw = true; }
check('unknown instruction refused', threw);
// The gate prices a plan against the night it names. A default of 6 would
// have gated a Night 3 plan against Night 6's AI table; see plans/13.
let unnamed = '';
try { modelGate(text.replace(/^#night 6\n/, ''), { runs: 1 }); }
catch (e) { unnamed = e.message; }
check('a plan that names no night is refused', /does not name its night/.test(unnamed), unnamed);

// -------------------------------------------------------- the error injection
const j1 = jitterPlan(parsed, 7);
const j2 = jitterPlan(parsed, 7);
const j3 = jitterPlan(parsed, 8);
check('deterministic per seed', JSON.stringify(j1) === JSON.stringify(j2));
check('seeds differ', JSON.stringify(j1) !== JSON.stringify(j3));
let bounded = true, tailsIntact = true, moved = 0, offsets = 0;
for (const name of Object.keys(parsed)) {
  for (let i = 0; i < parsed[name].length; i++) {
    const [o0, ...rest0] = parsed[name][i].split(' ');
    const [o1, ...rest1] = j1[name][i].split(' ');
    offsets++;
    if (+o1 !== +o0) moved++;
    if (+o1 < 0 || Math.abs(+o1 - +o0) > HUMAN_SLACK_MS) bounded = false;
    if (rest0.join(' ') !== rest1.join(' ')) tailsIntact = false;
  }
}
check('draws bounded by the slack and clamped', bounded);
check('only offsets move (hold durations, sweep spacing untouched)', tailsIntact);
check('draws actually move rows', moved > offsets / 2, `${moved}/${offsets}`);

// ------------------------------------------------------- verdict thresholding
const stub = (survivals) => {
  let i = 0;
  return () => ({ sim: { won: survivals[i++ % survivals.length], death: { reason: 'x', detail: 'y' } } });
};
const runs = 10;
const atBar = modelGate(text, { runs, replayFn: stub([true, true, true, true, false, false, false, false, false, false]) });
check('a small sample at the bar is inconclusive', !atBar.ok &&
  atBar.verdict === 'INCONCLUSIVE' && atBar.survived === Math.ceil(runs * GATE_MIN_SURVIVAL));
const underBar = modelGate(text, { runs, replayFn: stub([true, true, true, false, false, false, false, false, false, false]) });
check('a small sample under the bar is also inconclusive', !underBar.ok &&
  underBar.verdict === 'INCONCLUSIVE' && underBar.deaths.length === 1);
const definitePass = modelGate(text, { runs: 1000,
  replayFn: stub(Array(900).fill(true).concat(Array(100).fill(false))) });
check('a large sample whose interval clears the bar passes',
  definitePass.ok && definitePass.verdict === 'PASS');
const definiteFail = modelGate(text, { runs: 1000,
  replayFn: stub(Array(100).fill(true).concat(Array(900).fill(false))) });
check('a large sample whose interval misses the bar fails',
  !definiteFail.ok && definiteFail.verdict === 'FAIL');

// ----------------------------------------- the decision: the repaired plan passes
//
// The prior plan was first asserted to pass on the strength of 46/100 at seeds
// 1..100. Over 1200 seeds it was 449/1200 =
// 37.4% against a 40% contract, and only five of twelve 100-seed blocks clear
// the bar. That assertion measured a seed block, not the plan. The route fix
// carries the previously omitted first Foxy reset on the post-read maskraise.
//
// Re-pinned 2026-08-27, 672 -> 680. RAISE_JITTER_MARGIN_MS moved every wind
// park clear of the monitor-raise animation by the gate's own +/-60 ms jitter
// instead of the phone's 33 ms. Parks that used to land inside MON_RAISING now
// land after it, so their winds are credited. The read and the sweep did not
// move -- only the park, and the hold that follows it pays for the shift.
//
// Re-pinned again at 648/1200 when the device sweep widened from 120 to 133 ms.
// The policy slot and the sweep's end are unchanged; its start moves 26 ms
// earlier to buy a full released Fusion poll between camera buttons. That
// actuator correction costs 32 modeled-human survivors but remains well above
// the unchanged 480/1200 gate.
//
// Keep both sides pinned: the gate bar stays 40%, and the plan must pass the
// full sample.
const real = modelGate(text);
check('shipped n6 plan passes under human slack', real.ok,
  `${real.survived}/${real.runs} ${real.verdict} -- the route must clear the unchanged 40% bar`);
check('the broad Night 6 result stays pinned', real.survived === 648,
  `${real.survived}/${real.runs}`);

if (failed) { console.error(`${failed} model-gate check(s) failed`); process.exit(1); }
console.log(`model gate: verified; shipped plan passes at ${real.survived}/${real.runs} under +/-${HUMAN_SLACK_MS} ms`);
