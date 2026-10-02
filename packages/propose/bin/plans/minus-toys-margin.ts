// Per-instruction timing margin map for the Minus Toys device loop.
//
// The deterministic gate (minus-toys-plan.ts --gate) says 200/200 for a
// schedule that has almost no slack: the published strategy's own write-up
// (docs/strategy/MINUS-3-STRATEGY.md sec.3) states its error budget is only
// ~0.66 s per cycle, and the first device run (n2-minustoys-0117, 2026-08-28)
// died to a BB walk-in -> Foxy chain that the gate could not see.
//
// This maps where that slack actually is. It replays the loop with ONE
// instruction shifted in isolation (no other jitter) and reports the widest
// early/late offset at which every seed of a fixed set still survives -- i.e.
// how far off that one press can be before the night stops being winnable.
// It also reports the whole-schedule phase margin: the epoch/T0 alignment
// error the device can absorb before the same thing happens.
//
//   node packages/propose/bin/plans/minus-toys-margin.ts [--night=N] [--seeds=N] [--max=MS]
//
// `--steps` in cyclesearch.ts asks the same question for Minus 7; this is its
// Minus Toys counterpart. It is a measurement of the MODEL (no randomness), and
// it inherits the engine's Golden-Freddy-interval and Toy-cam-stall gaps
// (plans/02 sec.5) -- read it as "the model has at most this much slack here".
import { OPENING, LOOP, replay } from './minus-toys-plan.ts';
import { formatEdge, scanEdge } from './basin-edge.ts';
import { FNAF2_CONTROL_VOCABULARY as V } from '@sixam/source';

const arg = (k: string, d: number) => {
  const v = process.argv.find(a => a.startsWith(`--${k}=`));
  return v ? +v.slice(k.length + 3) : d;
};
const NIGHT = arg('night', 2);
const SEEDS = arg('seeds', 200);
const MAX = arg('max', 800);          // ms; search this far each way
const STEP = 33;                       // ms; one Fusion poll

const seed = (i: number) => (i * 2654435761) >>> 0;
/** A schedule() offset: how far one instruction of one cycle moves, in ms. */
type Shift = (cycle: string, index: number, at: number) => number;

// All seeds survive with this shift applied? `shift` is a schedule() offset fn.
function allSurvive(shift: Shift) {
  for (let i = 0; i < SEEDS; i++) {
    const r = replay({ night: NIGHT, seed: seed(i), shift });
    if (!(r.sim.won && r.splitAt >= 0)) return false;
  }
  return true;
}

// Largest k in [0, MAX] (ms, multiples of STEP) for which `mk(k)` still clears.
// The scan goes on past the first failure, and a response that clears again
// prints as banded rather than as a budget (basin-edge.ts).
const edge = (mk: (k: number) => Shift) => formatEdge(scanEdge(k => allSurvive(mk(k)), { step: STEP, max: MAX }));

const rowShift = (cycle: string, index: number, delta: number): Shift =>
  (c, i) => (c === cycle && i === index ? delta : 0);

console.log(`Minus Toys margin map -- night ${NIGHT}, ${SEEDS} seeds, ` +
  `+/-${MAX} ms in ${STEP} ms steps`);
console.log('(model only; no jitter. "early"/"late" = ms that one press can ' +
  'move before some seed dies. Strategy write-up budgets ~660 ms/cycle.)\n');

// Baseline sanity: the shipped schedule must clear at zero shift.
if (!allSurvive(() => 0)) {
  console.error('the shipped schedule does not clear at zero shift -- ' +
    'fix the plan before reading margins');
  process.exit(1);
}

const rows: { label: string, early: string, late: string }[] = [];
for (const [cycle, table] of [['opening', OPENING], ['toys', LOOP]] as const) {
  table.forEach((row, index) => {
    const [at, kind, a] = row;
    const label = `${cycle}[${index}] +${at} ${kind} ${a}`;
    const late = edge(k => rowShift(cycle, index, k));
    const early = edge(k => rowShift(cycle, index, -k));
    rows.push({ label, early, late });
  });
}

const pad = rows.reduce((m, r) => Math.max(m, r.label.length), 0);
for (const r of rows) {
  const tight = [r.early, r.late].some(v => /^\d+$/.test(v) && +v < 330);
  console.log(`  ${r.label.padEnd(pad)}   early ${String(r.early).padStart(5)}` +
    `   late ${String(r.late).padStart(5)}${tight ? '   <-- under half the budget' : ''}`);
}

// Whole-schedule phase margin: every instruction shifted together, which is
// what an epoch/T0 misalignment or a steady game-vs-wall clock offset does.
const phaseLate = edge(k => () => k);
const phaseEarly = edge(k => () => -k);
console.log(`\n  WHOLE-SCHEDULE PHASE (epoch/T0 error)   ` +
  `early ${String(phaseEarly).padStart(5)}   late ${String(phaseLate).padStart(5)}`);
console.log(`  n2-minustoys-0117 reported a 302 ms epoch bracket alone.`);

// Arm-gated SUFFIX phase: the error the device executor actually makes.
//
// The whole-schedule figure above prices an epoch/T0 misalignment, which moves
// every press together. The modern executor does not do that in `blocking`
// arm mode. It parks the opening prefix -- everything before the first wind --
// runs it on the night's own clock, then blocks on the CAM 09 + CAM 11 arm
// observation and releases the REMAINDER when the pair confirms. Whatever wall
// time that observation costs past the plan's own cursor is added to every
// press from the first wind onward and to nothing before it (`phaseLagMs` in
// packages/play/src/campaign/adb-device-local-executor.ts).
//
// **This response is BANDED, not a cliff.** `edge()` above prints such a
// response as banded, but its first band edge is still not the budget. A
// stop-at-first-failure scan, the earlier `edge()`, is correct only for a
// contiguous basin. The model's response to phase repeats
// on the game's 1-second grid with several separate loss bands inside it, so a
// stop-at-first-failure scan reports the first band edge and silently hides
// every winning window beyond it. Read on 2026-09-11 that way, the first edge
// (408 ms) was mistaken for the whole budget -- which would have condemned a
// 1320 ms run that the model actually scores 3000/3000.
//
// `phase-reconstruct.ts` is the authority here: it already computes the loss
// bands and reports a measured run's delivered offset against them. This
// section exists so the margin map does not imply a single number.
const ARM_AT = OPENING.find(row => row[1] === 'hold' && row[2] === V.wind)?.[0];
if (ARM_AT === undefined) {
  console.log('\n  ARM-GATED SUFFIX PHASE  UNKNOWN (the opening has no wind row to park before)');
} else {
  const PERIOD = 1000;                   // the game second the response repeats on
  const SCAN = Math.round(1000 / 60);    // one frame
  const bands: [number, number][] = [];
  let open: number | null = null;
  for (let lag = 0; lag <= PERIOD; lag += SCAN) {
    const lost = !allSurvive((cycle, index, at) => (at >= ARM_AT ? lag : 0));
    if (lost && open === null) open = lag;
    if (!lost && open !== null) { bands.push([open, lag]); open = null; }
  }
  if (open !== null) bands.push([open, PERIOD]);
  console.log(`\n  ARM-GATED SUFFIX PHASE (arm-release lag, from +${ARM_AT}), ` +
    `over one ${PERIOD} ms game second:`);
  if (!bands.length) console.log('    no loss band found at this seed count');
  for (const [from, to] of bands)
    console.log(`    LOSS band  ${String(from).padStart(4)}..${String(to).padStart(4)} ms`);
  const lost = bands.reduce((total, [from, to]) => total + (to - from), 0);
  console.log(`    ${((1 - lost / PERIOD) * 100).toFixed(1)}% of phases survive; ` +
    'a lag is safe only INSIDE a winning window, and the windows repeat every second.');
  console.log('    #arm-verify-until cannot be set from one number: it must land the ' +
    'delivered\n    offset in a window, which requires the ORIGIN to be pinned first.');
}

const budget = 330;
const tightPhase = [phaseEarly, phaseLate].some(v => /^\d+$/.test(v) && +v < budget);
if (tightPhase)
  console.log(`\n  => the WHOLE-SCHEDULE phase margin is under half the strategy's ` +
    `own ~660 ms/cycle budget. A fixed cadence anchored to T0 cannot hold it ` +
    `on a device whose epoch latch alone is uncertain by ~300 ms.`);
