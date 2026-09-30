// What a reduction in actuator lateness would be worth, and where the knee is.
//
// plans/PROGRESS.md named launch lateness the only lever left on the 10/20
// mission after policy, recovery and perception were each exonerated. That
// makes one question decisive before anyone touches the phone: **is the mean
// worth reducing, and by how much before anything changes?** If halving it
// buys nothing the line of work stops here; if there is a knee, the knee is
// the device target.
//
// Every number this file prints is a SIMULATOR number. It prices the
// `hidpilot n6 target` pilot through `packages/play/bin/phone/actuator.mjs`, which models
// launch lateness and the mask seam and nothing else -- not the runner's
// blocking shell, not the classifier's tail, not `screenrecord` contention.
// The actuator's own header says survival under it is still survival in a
// model. Read a row as "how this route responds to lateness", never as "the
// phone would clear night 6".
//
// Two controls make the rows readable rather than merely favourable:
//
//   * The zero row must reproduce the exact figure (200/200 every night). A
//     lateness sweep whose zero end is not the unwrapped result is measuring
//     its own wrapper.
//   * The 110-300 ms row must reproduce plans/12's published table
//     (23/200 on night 1, 0/200 on nights 2-7). Both are asserted under
//     `--assert`, so a cell that drifts fails rather than being re-read.
//
// The mean and the spread are swept SEPARATELY because they are different
// device quantities with different fixes: the mean is what a phase offset
// could in principle absorb, the spread is what `wait_until` re-rolls at every
// wall-timed boundary. `actuator.mjs`'s header claims the mean is nearly free
// and the spread does the damage; plans/12 already found that false on this
// route, and the mean sweep below says why.
//
//   node tools/latenesssweep.mjs                  # mean, spread and the bands
//   node tools/latenesssweep.mjs --ablate         # which press's lateness costs it
//   node tools/latenesssweep.mjs --runs=200 --assert
import { pathToFileURL } from 'node:url';
import * as C from '@sixam/source/fnaf2';
import { run as hidRun } from '../packages/propose/parked/minus7/hid-device-pilot.mjs';
import { N6_TARGET, NIGHTS } from './model/closed-loop-reclaim.mjs';

const seedOf = (i) => (i * 2246822519) >>> 0;
const frames = (ms) => Math.round(ms / 1000 * C.FPS);

// The actuator quantises every draw to a frame, so a band is only ever worth
// what its frame count is worth. Printing both stops a reader inferring a
// millisecond threshold from what is really a 2-frame one.
export function cohort(night, runs, lateMinMs, lateMaxMs, lateWhen = null) {
  let won = 0;
  const reasons = new Map();
  for (let i = 0; i < runs; i++) {
    const r = hidRun({ ...N6_TARGET,
      deviceActuator: { lateMinMs, lateMaxMs, ...(lateWhen ? { lateWhen } : {}) },
      sim: { seed: seedOf(i), night } });
    if (r.sim.won) won++;
    else reasons.set(r.sim.death.reason, (reasons.get(r.sim.death.reason) || 0) + 1);
  }
  return { won, reasons };
}

const row = (label, runs, lo, hi, lateWhen) =>
  `${label.padEnd(26)} ` +
  NIGHTS.map(n => String(cohort(n, runs, lo, hi, lateWhen).won).padStart(4)).join('') +
  `   ${frames(lo)}-${frames(hi)}f`;

const header = (title) => {
  console.log(`\n${title}`);
  console.log(`${''.padEnd(26)} ` + NIGHTS.map(n => `  n${n}`).join('') + '   frames');
};

// The bands that exist as device measurements, each with where it came from.
// A band is only in this table if a page in this repository can be cited for
// it; a plausible number with no run behind it belongs in a comment.
export const BANDS = [
  [0, 0, 'perfect actuator', 'the control: must equal the exact figure'],
  [0, 10, 'fork-free clock',
   '/proc/uptime is a builtin read, 0.36 ms, 10 ms resolution (device probe 2026-08-26)'],
  [49, 93, 'wait_until, documented',
   'HID-MULTITOUCH.md "The shell\'s clock is 25x looser than the actuator\'s"'],
  [49, 106, 'wait_until, re-probed',
   'landing error over 20 targets 200 ms apart, game running (device probe 2026-08-26)'],
  [110, 180, 'anchor press, older traces',
   'ON-DEVICE-VALIDATION.md; the LOGGED press offset into the cycle, not the landing'],
  [110, 300, 'actuator.mjs default band',
   'the older traces plus night 6-40\'s inferred ~300 ms'],
];

export function bandTable(runs) {
  header('The bands this repository can cite, priced (simulator, per-beat draw)');
  for (const [lo, hi, label] of BANDS) console.log(row(label, runs, lo, hi));
  console.log('\n  sources:');
  for (const [lo, hi, label, why] of BANDS)
    console.log(`    ${String(lo)}-${String(hi)} ms  ${label}: ${why}`);
}

export function meanSweep(runs) {
  header('Mean only (zero spread): a uniformly late schedule');
  for (const ms of [0, 17, 33, 41, 42, 50, 58, 66, 83, 110, 205, 300])
    console.log(row(`+${ms} ms, no spread`, runs, ms, ms));
}

export function spreadSweep(runs) {
  header('Spread only, at zero mean: what a per-boundary re-roll costs');
  for (const hi of [0, 10, 17, 20, 33, 40, 42, 45, 50, 58, 66, 100])
    console.log(row(`0-${hi} ms`, runs, 0, hi));
  header('Spread at the documented 205 ms mean: is the spread the lever?');
  for (const s of [0, 10, 20, 40, 60, 95])
    console.log(row(`205 +/- ${s} ms`, runs, Math.max(0, 205 - s), 205 + s));
}

// Which press's lateness costs the night. The queue still serializes, so a
// row is "this class late, with the backlog that follows it" -- which is what
// the coprocess pipe does too, and is why the rows do not decompose cleanly
// once the delay exceeds the plan's own 33 ms gaps.
const CLASSES = {
  sweep: (a) => a.startsWith('cam:') || a === 'light',
  monitor: (a) => a === 'monitor',
  mask: (a) => a === 'mask',
  wind: (a) => a === 'wind',
  vent: (a) => a === 'ventL' || a === 'ventR',
};

export function ablation(runs) {
  header('One class late, the rest exactly on time (diagnostic, not a phone model)');
  for (const fr of [1, 2, 3]) {
    const ms = Math.round(fr * 1000 / C.FPS);
    console.log(`  everything +${fr}f`.padEnd(27) +
      NIGHTS.map(n => String(cohort(n, runs, ms, ms).won).padStart(4)).join(''));
    for (const [name, pred] of Object.entries(CLASSES))
      console.log(`    only ${name} +${fr}f`.padEnd(27) +
        NIGHTS.map(n => String(cohort(n, runs, ms, ms, pred).won).padStart(4)).join(''));
  }
}

// The two cells that are not allowed to drift, because published tables rest
// on them. Tolerances are binomial slack at 200 seeds, not opinion.
export function assertPins(runs) {
  const problems = [];
  for (const night of NIGHTS) {
    const zero = cohort(night, runs, 0, 0).won;
    if (zero !== runs)
      problems.push(`night ${night}: zero lateness gives ${zero}/${runs}, not the exact figure; ` +
        'the wrapper is costing nights the actuator is not');
  }
  const n1 = cohort(1, runs, 110, 300).won;
  if (Math.abs(n1 / runs - 23 / 200) > 0.06)
    problems.push(`night 1 at 110-300 ms is ${n1}/${runs}; plans/12 published 23/200`);
  for (const night of [2, 3, 4, 5, 6, 7]) {
    const w = cohort(night, runs, 110, 300).won;
    if (w) problems.push(`night ${night} at 110-300 ms is ${w}/${runs}; plans/12 published 0/200`);
  }
  // The knee itself. Two frames of per-boundary error is survivable and three
  // is not; if that ever stops being true the device target has moved and the
  // documented one is stale.
  const at2f = cohort(6, runs, 0, 40).won / runs;
  const at3f = cohort(6, runs, 0, 50).won / runs;
  if (!(at2f > 0.6)) problems.push(`night 6 under a 0-40 ms band is ${at2f}; the 2-frame budget is gone`);
  if (!(at3f < 0.2)) problems.push(`night 6 under a 0-50 ms band is ${at3f}; the 3-frame cliff moved`);
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const runs = +((args.find(a => a.startsWith('--runs=')) || '').split('=')[1] || 200);
  const known = ['--ablate', '--assert', '--bands'];
  const bad = args.filter(a => !known.includes(a) && !a.startsWith('--runs='));
  if (bad.length) throw new Error(`unknown argument: ${bad.join(', ')}`);
  console.log(`hidpilot n6 target through packages/play/bin/phone/actuator.mjs, ${runs} seeds per cell.`);
  console.log('Every figure here is a simulator figure.');
  // `--assert` alone prints no table: it is the suite's entry point and the
  // sweep costs three minutes at 200 seeds, while the pins cost sixteen cells.
  if (args.includes('--ablate')) ablation(runs);
  else if (args.includes('--bands')) bandTable(runs);
  else if (!args.includes('--assert')) { bandTable(runs); meanSweep(runs); spreadSweep(runs); }
  if (args.includes('--assert')) {
    const problems = assertPins(runs);
    if (problems.length) {
      console.error('\nlateness sweep:');
      for (const p of problems) console.error('  FAIL  ' + p);
      process.exit(1);
    }
    console.log('\nzero lateness reproduces the exact figure, 110-300 ms reproduces plans/12, ' +
      'and the budget is still two frames.');
  }
}
