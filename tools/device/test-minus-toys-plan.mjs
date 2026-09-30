// Gate for the Minus Toys device plan. No phone required.
//
// minus-toys-plan.mjs is the device half of plan 02 package 2a: it ports the
// engine-verified glitch-based Minus Toys loop (tools/minustoystest.mjs) into
// the modern semantic artifact plan, whose bundle compiler and device
// executor own the physical handoff. This checks three things that can each
// go wrong silently:
//
//  1. the ported schedule still clears the night in the exact model, with the
//     split actually armed (splitAt >= 0) and the no-split control still losing;
//  2. the emitted plan is shaped the way the artifact parser expects -- policy
//     and night headers, the two named cycles, columns in the right order;
//  3. every instruction kind and control the plan names compiles to the
//     canonical device vocabulary. A cameraFeedLight row names the physical
//     camera flash explicitly; the simulator maps it to its context-dependent
//     action.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OPENING, LOOP, KNOBS0, build, replay, emitPlan, schedule, maskWindows, phaseScan } from '../../packages/propose/bin/plans/minus-toys-plan.mjs';
import { DOUBLE_GLITCH_CAMERA_PAIRS } from '../../packages/play/bin/probe/arm-verification.mjs';
import { parsePlan } from '../../packages/propose/bin/plans/bundle.mjs';
import { compileArtifactPlans } from '../../packages/propose/bin/plans/artifact-commands.mjs';
import * as C from '@sixam/source/fnaf2';

const here = dirname(fileURLToPath(import.meta.url));
const check = (ok, message) => { if (!ok) throw new Error(message); };
const seed = i => (i * 2654435761) >>> 0;

// --- 0. the parametrized build reproduces the shipped schedule ---------------
//
// minus-toys-plan.mjs self-asserts this on import (build(KNOBS0) === the frozen
// arrays); re-state it here so a change to that assertion also trips a suite
// check, and pin the two facts a search depends on: a knob perturbs the plan,
// and the shipped default does not.
{
  const d = build();
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check(eq(d.opening, OPENING) && eq(d.loop, LOOP),
    'build() does not reproduce the exported OPENING/LOOP');
  check(!eq(build({ windMs: KNOBS0.windMs + 500 }).loop, LOOP),
    'a windMs knob change did not alter the loop -- build() is not reading knobs');
  check(emitPlan(2, { windMs: KNOBS0.windMs + 500 }) !== emitPlan(2),
    'emitPlan ignored its knobs argument');

  const exactQueue = schedule({ opening: OPENING, loop: LOOP, untilMs: 30000,
                                periodMs: KNOBS0.loopPeriodMs });
  const exactWindows = maskWindows(exactQueue);
  // DERIVED from the schedule, not pinned to frame literals. These used to be
  // 264 and 552, the frames of the 4400 ms opening mask-on and the 9200 ms loop
  // mask-off; moving either press out of a device timing floor then failed a
  // check that was only ever asserting a relationship. The relationship is what
  // this pins: coverage starts once the ON animation has run, and ends on the
  // authored OFF press.
  const frameOf = ms => Math.round(ms / 1000 * C.FPS);
  const openingMaskAt = OPENING.find(row => row[2] === 'mask')[0];
  const loopMaskOffAt = LOOP.find(row => row[2] === 'mask')[0];
  check(exactWindows[0].startFrame === frameOf(openingMaskAt) + C.MASK_ANIM_ON &&
        exactWindows[0].endFrame === frameOf(loopMaskOffAt),
    'mask coverage does not start after ON animation or end at the OFF press');
  const jitterQueue = schedule({ opening: OPENING, loop: LOOP, untilMs: 30000,
    periodMs: KNOBS0.loopPeriodMs,
    shift: (cycle, index) => cycle === 'opening' && index === 7 ? 20
      : cycle === 'toys' && index === 0 ? -20 : 0 });
  const jitterWindow = maskWindows(jitterQueue)[0];
  check(jitterWindow.endFrame - jitterWindow.startFrame !==
        exactWindows[0].endFrame - exactWindows[0].startFrame,
    'independent mask-row jitter was collapsed into the nominal window');
}

// The published routine is 5 s-interval-anchored but the port is a 10 s loop.
// cyclelengthsearch.mjs found the same for Minus 7: a 10 s period is structural
// (2x the 5 s movement grid). Pin that a 5 s symmetric build does NOT clear --
// it cannot deliver Balloon Boy's 5 consecutive mask ticks without the
// reactive blackout branch. If this ever passes, the loop-period picture changed.
{
  let wins = 0;
  for (let i = 0; i < 100; i++) {
    const r = replay({ night: 2, seed: seed(i), knobs: { loopPeriodMs: 5000 } });
    if (r.sim.won && r.splitAt >= 0) wins++;
  }
  check(wins < 20,
    `the 5 s loop-period build cleared night 2 ${wins}/100 -- it was expected to ` +
    'fail without the reactive branch; the 10 s period may no longer be structural');
}

// --- 1. the ported schedule survives, and the split is what does it ----------

for (const night of [2, 7]) {
  for (const worst of [false, true]) {
    const runs = worst ? 100 : 200;
    let wins = 0, armed = 0, minBox = 1;
    for (let i = 0; i < runs; i++) {
      const r = replay({ night, worst, seed: seed(i) });
      if (r.sim.won) wins++;
      if (r.splitAt >= 0) armed++;
      minBox = Math.min(minBox, r.minBox);
    }
    check(wins === runs,
      `night ${night} ${worst ? 'worst' : 'normal'}: ${wins}/${runs} survived`);
    check(armed === runs,
      `night ${night} ${worst ? 'worst' : 'normal'}: the split armed on only ${armed}/${runs} runs`);
    check(minBox > 0.4,
      `night ${night} ${worst ? 'worst' : 'normal'}: music box fell to ${(minBox * 100).toFixed(0)}%`);
  }
}

// The load-bearing negative control: the identical loop with the marker left
// synchronized on CAM 11 must not clear canonical 10/20. Its splitAt stays -1.
let controlWins = 0, controlArmed = 0;
for (let i = 0; i < 200; i++) {
  const r = replay({ night: 7, splitCamera: false, seed: seed(i) });
  if (r.sim.won) controlWins++;
  if (r.splitAt >= 0) controlArmed++;
}
check(controlWins === 0,
  `the no-split control cleared night 7 ${controlWins}/200 times; the split is not what wins`);
check(controlArmed === 0,
  `the no-split control reported the split armed ${controlArmed} times`);

// The CLI entry point uses the same gate before emitting a bundle plan.
for (const night of ['2', '7']) {
  execFileSync('node', [join(here, '../../packages/propose/bin/plans/minus-toys-plan.mjs'), `--night=${night}`, '--gate'],
    { stdio: 'ignore' });
}

// --- 1b. the minimal Night 1 plan (MINUS-3-STRATEGY.md sec.9) ----------------

{
  // Arm + flash + wind, 5 s cycle, no mask/hall/camdrop. Clears Night 1 on
  // normal seeds with the split armed; the box never empties.
  let wins = 0, armed = 0;
  for (let i = 0; i < 200; i++) {
    const r = replay({ night: 1, seed: seed(i), knobs: { minimal: true } });
    if (r.sim.won) wins++;
    if (r.splitAt >= 0) armed++;
  }
  check(wins === 200, `minimal night 1: ${wins}/200 survived`);
  check(armed === 200, `minimal night 1: split armed on only ${armed}/200`);

  const m = build({ minimal: true });
  const kinds = new Set([...m.opening, ...m.loop, ...m.finish].map(r => r[1]));
  check(!kinds.has('mask') && !kinds.has('hall') && !kinds.has('camdrop'),
    `the minimal plan still has defensive churn: ${[...kinds].join(', ')}`);
  check(m.opening[0][0] === 115000,
    `the minimal plan arms at ${m.opening[0][0]}ms, not the sourced ~1:38 delay`);
  check(m.opening.every(([at]) => at >= 115000),
    'the minimal plan sends an action before the Night 1 idle window ends');
  check(JSON.stringify(m.finish) === JSON.stringify([
    [359700, 'tap', 'cam9', 100], [360000, 'tap', 'monitor', 100],
  ]), `the minimal plan has no CAM 09 proof visit then exact 5:08 AM monitor-down: ${JSON.stringify(m.finish)}`);

  const audioGated = build({ preventiveVentLight: false });
  check(!audioGated.loop.some(row => row[2] === 'cameraFeedLight'),
    'the audio-gated observation variant removes the preventive vent light');
  check(build().loop.some(row => row[2] === 'cameraFeedLight'),
    'the shipped standard schedule retains its preventive vent light');
  const queued = schedule({ opening: m.opening, loop: m.loop, finish: m.finish,
    periodMs: 5000, loopStartMs: 140000, untilMs: 360000 });
  check(queued.at(-2)?.[2] === 'cam:9' && queued.at(-1)?.[0] === 21600 &&
    queued.at(-1)?.[2] === 'monitor',
  'the minimal schedule does not end with CAM 09 proof then its 5:08 AM monitor-down');

  const plan = emitPlan(1, { minimal: true });
  check(plan.includes('#period 5000'), 'the minimal plan does not name its 5 s period');
  check(plan.includes('#loop-start 140000'),
    'the minimal plan does not defer its flash/wind loop to 2 AM');
  check(plan.includes('#stop-at 360000') && plan.includes('#observe-until 420000') &&
    plan.includes('#cycle finish'),
  'the minimal plan does not stop at 5:08 AM and observe hands-off through 6 AM');
  check(plan.includes('#arm-verify 1'),
    'the minimal plan does not ask the driver for the arm-verify window -- the ' +
    'runner-side check is what closes the 3-of-12 arm miss branch');
  check(plan.includes('#arm-verify-cameras cam:9,cam:11'),
    'the minimal plan does not identify the required CAM 09 + CAM 11 split');
  check(JSON.stringify(DOUBLE_GLITCH_CAMERA_PAIRS.minus3) ===
      JSON.stringify(['cam:8', 'cam:11']) &&
      JSON.stringify(DOUBLE_GLITCH_CAMERA_PAIRS.minusToys) ===
      JSON.stringify(['cam:9', 'cam:11']),
    'the double-glitch camera pair registry drifted from Minus 3/Minus Toys');

  // --gate exits 0; and it refuses any night but 1.
  execFileSync('node', [join(here, '../../packages/propose/bin/plans/minus-toys-plan.mjs'), '--night=1', '--minimal', '--gate'],
    { stdio: 'ignore' });
  let refused = false;
  try {
    execFileSync('node', [join(here, '../../packages/propose/bin/plans/minus-toys-plan.mjs'), '--night=3', '--minimal'],
      { stdio: 'ignore' });
  } catch { refused = true; }
  check(refused, '--minimal did not refuse night 3 (it is Night 1 only)');
}

// --- 1c. the arm's phase sensitivity (2026-08-29, r2/r3 device coin flip) ----
//
// The deterministic gate above is blind to the miss branch BY CONSTRUCTION: it
// replays at epochMs=0, where the schedule sits at a fixed phase of g263's
// 200 ms sampler (engine.js samples `lastViewed` only on
// `f % LAST_VIEW_SAMPLE_FRAMES === 0`). On the phone the run-to-run epoch
// error rotates the schedule against that grid, and the arm is a coin flip --
// measured as armed on calib-01 + r2, missed on r3, with r3 dying to the
// Puppet at ~4 AM because the box cannot be wound from CAM 09.
//
// The shipped arm's hazard window is 3 frames wide: the CAM 09 touch lands on
// frame 6950 (115833 ms, ~ 2 mod 12) and the monitor drop on frame 6953
// (115883 ms). A sampler tick inside that window samples `viewing=9` into
// `lastViewed` and the raise writes `viewing=9` -- exactly the r3 state (only
// CAM 09 lit, Show Stage, no wind button). That predicts misses at epoch
// offsets +7f/+8f/+9f and nowhere else, i.e. P(miss) = 3/12 per attempt.
{
  const rows = phaseScan({ night: 1, seeds: 48, knobs: { minimal: true } });
  check(rows.length === 12, `phase scan returned ${rows.length} epochs, not one sampler period`);
  const miss = rows.filter(r => r.armed === 0).map(r => r.epochFrames);
  const land = rows.filter(r => r.armed === 48).map(r => r.epochFrames);
  check(miss.length + land.length === 12,
    `the arm is not bimodal per epoch: missed ${JSON.stringify(miss)}, landed ${JSON.stringify(land)}` +
    ' -- partial epochs mean the model has arm nondeterminism it should not have');
  check(JSON.stringify(miss) === JSON.stringify([7, 8, 9]),
    `the arm misses at epochs ${JSON.stringify(miss)}, not the arithmetic-predicted [7,8,9] ` +
    '(CAM 09 touch at 6950 ~ 2 mod 12 with a 3-frame touch->drop window)');
  check(land.length === 9,
    `the arm lands on ${land.length}/12 epochs; the emitted geometry changed`);
  // The deterministic gate must keep assuming the arm lands (epochMs=0 is the
  // phase the emitter anchors to); the runner-side arm verify owns the miss
  // branch. If epoch 0 ever misses here, that contract is broken at its root.
  check(rows[0].armed === 48 && rows[0].wins === 48,
    'the arm missed at epoch 0 -- the deterministic gate no longer describes the emitter');
}

// --- 2. the emitted plan is shaped for the interpreter -----------------------

const plan = emitPlan(7);
const lines = plan.trimEnd().split('\n');
check(lines[0] === '#policy minus-toys', `first line is "${lines[0]}", not the policy header`);
check(lines.includes('#night 7'), 'the emitted plan does not name its night');
check(lines.includes('#period 10000'), 'the emitted plan does not name its loop period');
const openAt = lines.indexOf('#cycle opening');
check(openAt >= 0 && lines.slice(0, openAt).every(l => l.startsWith('#')),
  'the opening cycle must follow the `#` headers');
check(lines.includes('#cycle toys'), 'the emitted plan has no toys loop cycle');
check(plan.endsWith('\n'), 'the plan must end with a newline for `read` to see its last row');

// Rows round-trip: what emitPlan writes is exactly OPENING then LOOP, joined.
const rowText = rows => rows.map(r => r.join(' '));
check(
  lines.slice(openAt + 1, openAt + 1 + OPENING.length).join('|') === rowText(OPENING).join('|'),
  'the opening rows are not the OPENING table verbatim');
const toysAt = lines.indexOf('#cycle toys');
check(
  lines.slice(toysAt + 1).join('|') === rowText(LOOP).join('|'),
  'the toys rows are not the LOOP table verbatim');

// --- 3. every kind and control the plan names is implemented -----------------

// Parse and compile through the active modern handoff. The profile is read
// from the checked-in fixture so this test checks the same canonical bindings
// that a bundle will carry to the device executor.
const profile = JSON.parse(readFileSync(
  join(here, '../../apps/device/profiles/fixture-hid-screencap.json'), 'utf8'));
const parsed = parsePlan(plan, { strategy: 'minus-toys', night: 7, profile });
const compiled = compileArtifactPlans(
  [{ text: plan, policy: 'minus-toys', night: 7 }], parsePlan, profile)[0];
const actions = Object.values(compiled.cycles).flatMap(cycle =>
  cycle.blocks.flatMap(block => block.actions));
check(parsed.cycles.opening.rows.some(row => row.kind === 'camdrop'),
  'the parsed opening lost its camdrop compound');
check(parsed.cycles.toys.rows.some(row => row.kind === 'hall'),
  'the parsed toys loop lost its standalone hall row');
// hallMs 0 is the death-targeting knob that drops the post-mask flash; the
// default keeps it, and nothing else in the loop may move when it goes.
{
  const withFlash = build({ ...KNOBS0 }).loop;
  const noFlash = build({ ...KNOBS0, hallMs: 0 }).loop;
  check(withFlash.some(row => row[1] === 'hall') && !noFlash.some(row => row[1] === 'hall'),
    'hallMs 0 must drop the loop hall row and the default must keep it');
  check(noFlash.length === withFlash.length - 1 &&
    withFlash.filter(row => row[1] !== 'hall').every((row, i) => JSON.stringify(row) === JSON.stringify(noFlash[i])),
    'dropping the flash must leave every other loop row byte-identical');
}
check(actions.some(action => action.control === 'cameraFeedLight'),
  'the artifact compiler did not emit cameraFeedLight');
check(actions.some(action => action.control === 'hallLight'),
  'the artifact compiler did not emit hallLight');
check(actions.every(action => !['light', 'hall', 'ventL', 'ventR', 'ventl', 'ventr'].includes(action.control)),
  'the modern artifact retained an ambiguous legacy control name');

console.log(
  `minus toys device plan: nights 2 and 7 clear 200/200 + 100/100 worst with the ` +
  `split armed every run, no-split control 0/200; minimal night 1 clears with the ` +
  `arm landing on exactly 9/12 sampler epochs (misses at +7f/+8f/+9f, the r2/r3 ` +
  `device coin flip, runner-side arm verify owns the miss branch); emitted plan ` +
  `parses and every kind/control is implemented`);
