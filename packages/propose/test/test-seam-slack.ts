#!/usr/bin/env node
// Refuse a plan that only just clears a device timing floor, and refuse a floor
// that was calibrated to the route instead of to its own measurement.
//
// WHY THIS EXISTS. `artifact-commands.ts` already refuses a mask press that
// lands inside the monitor-down animation. It never fired for the Night 5
// route, because that route presses the mask at +400 ms and the floor is
// MONITOR_MASK_READY_MS = 400: `400 < 400` is false, so the plan compiled in
// silence. The floor's own comment says it was set to "the +400 ms timing used
// by the Night 5 route", and test-artifact-animation-gates.ts then pinned
// that boundary as correct -- so the one check that could have caught this was
// calibrated to accept it, and a test protected the calibration.
//
// On the phone that zero cost about one cycle in eight: the mask press was
// graded MISSING with the monitor observably down, and every corrected cycle
// handed a vent occupant a free pass (docs/evidence/night5-mask-tick-budget-*).
//
// A floor with no margin is a floor that documents the status quo. Two things
// are checked here, and both are about margin rather than legality:
//
//   1. every compiled plan clears every timing floor by at least the jitter
//      allowance, not by zero;
//   2. every floor that derives from a measurement stands at least the jitter
//      allowance above that measurement.
//
// And one about order (mistake register item 10, "a number measured in one
// direction does not transfer to the other"): every seam a plan compiles names
// its floor and the two events its gap runs between, as the compiler's own
// state saw them, and a floor measured in one order is used only in that order
// (Review's DIRECTIONAL_CONSTANTS). A floor with no registered order is an
// engine animation listed below with its reason.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileArtifactPlans, SEAM_FLOORS } from '../bin/plans/artifact-commands.ts';
import { parsePlan, validateWinner, STRATEGY_REGISTRY } from '../bin/plans/bundle.ts';
import { FUSION_POLL_MS } from '../bin/plans/recipe.ts';
import { checkDirectionalReuse, DIRECTIONAL_CONSTANTS } from '@sixam/review/refusals';

type Seam = ReturnType<typeof compileArtifactPlans>[number]['seams'][number];

const HERE = dirname(fileURLToPath(import.meta.url));
// The committed FNaF 2 winners (winner-v1): packages/propose/bindings/fnaf2.
const WINNERS = join(HERE, '../bindings/fnaf2');

// The allowance is TWO Fusion polls, not one, and that is the whole point.
//
// 33 ms is already MIN_CONTACT_MS, FUSION_POLL_MS and RAISE_MARGIN_MS. When the
// allowance was also 33, "this plan clears its floor by the allowance" meant
// "this plan clears its floor by exactly one poll" -- so a single dropped poll,
// the smallest error the device can make, puts the contact ON the boundary, and
// the check passed it because it only refused values BELOW 33. A margin equal
// to the quantum of the error it protects against is not a margin.
//
// What that cost, measured 2026-09-19: every shipped minus-toys plan put its
// once-per-cycle mask press at monitor-down + 449 ms against a 416 ms floor --
// slack exactly 33 -- roughly 42 times a night. The floor is anchored to a
// native trace (mask button absent through 322 ms, faint at ~337 ms, fully
// visible at ~382.5 ms), so that press lands 33 ms after the button finishes
// appearing. Three Night 3 device runs died across two strategies, at least two
// to Balloon Boy, who no strategy's stall holds on any night and whom only the
// mask cadence answers. A lost mask press is a cycle BB walks through.
//
// This is mistake-register item 7 one level up: item 7 was a FLOOR calibrated to
// the route it protected; this is the ALLOWANCE calibrated to the error it
// protects against. Both look derived and neither can refuse anything.
// ONE Fusion poll, not two.
//
// Two was tried on 2026-09-19 and reverted, and the reason is worth keeping:
// raising it forced every shipped plan's knobs to move, `validateWinner`
// normalises a winner by filling in KNOBS0 defaults, so changing the DEFAULTS
// re-hashes every winner that inherits any of them -- which silently broke the
// anchor bindings those hashes key (`no anchor aim registered for binding ...`)
// and the replayHash bindings that pin a winner's emitted plan. A margin change
// is never local: it re-binds the proven routes.
//
// What survived from that attempt is the floor correction below, which was the
// real defect. The floors used to embed a margin of their own, so this gate's
// allowance stacked on top: a plan standing 66.5 ms above the measured
// mask-button visibility was reported as clearing by 33, and chasing that
// phantom 33 took the 10/20 measured band from 120/120 to 0/120. With floors
// now equal to their measurement, a reported slack IS the true margin, and the
// shipped mask press reads 66 ms rather than a misleading 33.
export const SEAM_JITTER_ALLOWANCE_MS = FUSION_POLL_MS;

let failed = 0;
const fail = (message: string) => { failed += 1; process.stdout.write(`  FAIL ${message}\n`); };

// --- 1. a floor must BE its measurement, not its measurement plus a margin --
//
// The inverse of the old check, and the reason it is inverted: when the floor
// carried a margin of its own, this gate's own allowance stacked on top of it,
// so a plan standing 66.5 ms above the measured full-visibility point was
// reported as clearing by 33 -- and the phantom 33 was then "fixed" by moving
// the press, which took the 10/20 measured band from 120/120 to 0/120. A floor
// that embeds margin cannot be reasoned about, because no reader can tell which
// of the two numbers a schedule is actually standing on.
{
  const measured = SEAM_FLOORS.maskButtonFullyVisibleAfterMonitorDownMs;
  const floor = SEAM_FLOORS.monitorMaskReadyMs;
  process.stdout.write(
    `mask-after-monitor-down floor ${floor} ms == measured full visibility ` +
    `${measured} ms (margin lives in this gate, not in the floor)\n`);
  if (floor > Math.ceil(measured))
    fail(`MONITOR_MASK_READY_MS is ${floor} ms but the measurement is ${measured} ms. ` +
      'A floor must be the physical fact; the margin above it is this gate\'s job, and ' +
      'embedding one here double-counts it against every plan.');
  // The other direction was unchecked until 2026-09-27: a floor BELOW the
  // measurement admits a press before the button is visible, and reports the
  // difference as slack a plan does not have -- item 7's zero margin, hidden.
  if (floor < Math.ceil(measured))
    fail(`MONITOR_MASK_READY_MS is ${floor} ms, below the ${measured} ms measurement: ` +
      'the compiler would accept a mask press before the button is fully visible, and ' +
      'every slack this gate reports would overstate the true margin by the difference.');
}

// --- order: every floor is measured in one order, or is an engine animation --
// An animation lasts as long whichever press follows it, so its floor has no
// order to reuse; the others were measured as one press after another.
const ANIMATION_FLOORS = Object.freeze({
  maskAnimOffMs: 'the mask-off animation (engine frames): no press lands while it plays',
  maskAnimOnMs: 'the mask-on animation (engine frames): the mask cannot be toggled while it plays',
  monitorAnimUpMs: 'the monitor raise animation (engine frames): the monitor cannot reverse while it plays',
  monitorAnimDownMs: 'the monitor lowering animation (engine frames): the monitor cannot reverse while it plays',
});
for (const floor of Object.keys(SEAM_FLOORS))
  if (!Object.hasOwn(DIRECTIONAL_CONSTANTS, floor) && !Object.hasOwn(ANIMATION_FLOORS, floor))
    fail(`SEAM_FLOORS.${floor} has no registered order (DIRECTIONAL_CONSTANTS) and is not an engine animation`);
const orderRefusal = (seam: Pick<Seam, 'relation' | 'atMs' | 'floor' | 'first' | 'then'>) => {
  if (!seam.floor || !seam.first || !seam.then)
    return `${seam.relation} at +${seam.atMs} names no floor or no order (${seam.floor}: ${seam.first} -> ${seam.then})`;
  if (Object.hasOwn(ANIMATION_FLOORS, seam.floor)) return null;
  const verdict = checkDirectionalReuse({ constant: seam.floor, use: { first: seam.first, then: seam.then } });
  return verdict.refused ? `${seam.relation} at +${seam.atMs}: ${verdict.because}` : null;
};
// The planted violation: the mask floor read after a monitor RAISE, the reverse
// of the lowering its trace measured, must be refused.
if (!orderRefusal({ relation: 'mask-after-monitor-down', atMs: 0, floor: 'monitorMaskReadyMs', first: 'monitor-up', then: 'mask' }))
  fail('the order check passed the mask floor used after a monitor raise; it measures monitor-down -> mask');

// --- 2. every shipped plan must clear every floor by the allowance ----------
const winners = readdirSync(WINNERS)
  .filter(name => name.startsWith('campaign-') && name.endsWith('-winner.json'))
  .sort();
if (!winners.length) fail('no shipped winner was found to audit');

const profile = JSON.parse(readFileSync(
  join(HERE, '../../../packages/play/profiles/fnaf2/moto-g56/hid-mediaprojection.json'), 'utf8'));

// --- 2b. every REGISTERED strategy, not only the ones with a shipped winner --
// Auditing `campaign-*-winner.json` alone audits whatever already won. Every
// committed winner is minus-toys, so this gate had never evaluated a minus7 or
// minus3 plan -- and minus7's maskraise gap stood 16.7 ms above the mask-off
// animation for as long as the gate existed. A strategy is unshipped precisely
// while its timing is least examined, which is when a floor check is worth
// most. Each registered strategy is emitted here on a minimal winner so its
// floors are audited whether or not anyone has shipped it.
const probeWinners = Object.keys(STRATEGY_REGISTRY).map(strategy => ({
  label: `registry:${strategy}`,
  winner: {
    schema: 'winner-v1', strategy,
    knobs: strategy === 'minus7' ? {} : 'KNOBS0',
    // Night 1 is the only night every registered emitter can render without a
    // Custom Night dial vector or a reachable reactive branch.
    nights: [strategy === 'minus3' ? 3 : 1], seeds: [1],
    engineHash: `${strategy}-seam-probe-v1`, profile: 'hid-mediaprojection',
    attackFreeEvidence: 'seam probe: night 1 minus7 replays detections=0 over seeds 1..3000',
    gate: { status: 'PASS', claimLevel: 'MODEL_ONLY' },
  },
}));

const audits = [
  ...winners.map(file => ({ label: file, winner: JSON.parse(readFileSync(join(WINNERS, file), 'utf8')) })),
  ...probeWinners,
];

for (const { label: file, winner: rawWinner } of audits) {
  let winner;
  try { winner = validateWinner(rawWinner); }
  catch (error) { fail(`${file}: ${(error as Error).message}`); continue; }
  const emit = STRATEGY_REGISTRY[winner.strategy]?.emit;
  if (typeof emit !== 'function') { fail(`${file}: no emitter for ${winner.strategy}`); continue; }
  let plans;
  try {
    plans = winner.nights.map(night => ({
      night, policy: winner.strategy, text: emit(winner, night).text,
    }));
  } catch (error) { fail(`${file}: ${(error as Error).message}`); continue; }
  let compiled;
  try { compiled = compileArtifactPlans(plans, parsePlan, profile); }
  catch (error) { fail(`${file}: ${(error as Error).message}`); continue; }
  for (const plan of compiled) {
    const tight = (plan.seams ?? []).filter(s => s.slackMs < SEAM_JITTER_ALLOWANCE_MS)
      .sort((a, b) => a.slackMs - b.slackMs);
    const worst = (plan.seams ?? []).reduce<Seam | null>((low, s) =>
      (low === null || s.slackMs < low.slackMs ? s : low), null);
    process.stdout.write(`${file} night ${plan.night}: ${(plan.seams ?? []).length} gated rows, ` +
      `worst slack ${worst ? `${worst.slackMs} ms (${worst.relation} at +${worst.atMs})` : 'n/a'}\n`);
    for (const s of plan.seams ?? []) {
      const refusal = orderRefusal(s);
      if (refusal) fail(`${file} night ${plan.night}: ${refusal}`);
    }
    for (const s of tight)
      fail(`${file} night ${plan.night}: ${s.kind} at +${s.atMs} ms clears the ${s.relation} ` +
        `floor of ${s.floorMs} ms by only ${s.slackMs} ms (gap ${s.gapMs} ms); ` +
        `needs >= ${SEAM_JITTER_ALLOWANCE_MS} ms`);
  }
}

if (failed) {
  process.stdout.write(`\nseam slack: ${failed} zero-or-thin margin(s). These are not style ` +
    'findings: each one is a press the phone can lose to a frame of jitter.\n');
  process.exit(1);
}
process.stdout.write('seam slack: every floor stands above its measurement, every shipped ' +
  `plan clears every timing floor by at least ${SEAM_JITTER_ALLOWANCE_MS} ms, and uses each ` +
  'measured floor in the order it was measured\n');
