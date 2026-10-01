// Compatibility adapter for the canonical Minus 3 strategy package.
//
// Strategy semantics and model gates live in:
//   packages/research/src/strategies/minus-3/
// This file keeps the established device-tool import path and adds only the
// phone plan headers/legacy open-loop census used by existing bundle tests.
import { pathToFileURL } from 'node:url';
import {
  KNOBS0, MINUS3_STORY_NIGHTS, build, schedule, replay,
  reactiveReplay, reactiveGate, countReactive, emitReactivePlan,
} from '@sixam/propose/strategies/minus-3';
import { GOLDEN_MODEL_SEED_SALT, randomSeedCohort, seedCohortDescriptor } from '@sixam/propose/seeds';
import { DOUBLE_GLITCH_CAMERA_PAIRS, cameraPairHeader } from '../../../play/bin/probe/arm-verification.ts';

export {
  KNOBS0, MINUS3_STORY_NIGHTS, build, schedule, replay,
  reactiveReplay, reactiveGate, countReactive, emitReactivePlan,
};

type Knobs = typeof KNOBS0;
type Row = ReturnType<typeof build>['opening'][number];

const clone = (overrides: Partial<Knobs> | null | undefined) => ({ ...KNOBS0, ...(overrides ?? {}) });

/** Emit the established unconditional phone-plan vocabulary. */
export function emitPlan(night: number, overrides: Partial<Knobs> = {}) {
  if (!Number.isInteger(night) || night < 3 || night > 7)
    throw new Error('Minus 3 plan requires night 3..7 (night 7 is Custom Night with a dial vector)');
  const k = clone(overrides);
  const { opening, clear } = build(k);
  const keep = (row: Row) => {
    if (k.maskless && row[1] === 'tap' && row[2] === 'mask') return false;
    return true;
  };
  const narrowVent = (row: Row) =>
    (k.ventless && row[1] === 'hallvent') ? [row[0], 'hall', ...row.slice(2)] : row;
  const firstWind = k.openWindAtMs;
  const lines = [
    '#policy minus3',
    `#night ${night}`,
    `#period ${k.periodMs}`,
    `#loop-start ${k.loopStartMs}`,
    `#stop-at ${k.stopAtMs}`,
    `#observe-until ${k.observeUntilMs}`,
    '#arm-verify 1',
    `#arm-verify-cameras ${cameraPairHeader(DOUBLE_GLITCH_CAMERA_PAIRS.minus3)}`,
    '#arm-verify-viewing cam:11',
    `#arm-verify-until ${firstWind - 50}`,
    `#cycle opening ${k.periodMs / 2}`,
    ...opening.filter(keep).map(narrowVent).map(row => row.join(' ')),
    `#cycle clear ${k.periodMs}`,
    ...clear.filter(keep).map(narrowVent).map(row => row.join(' ')),
  ];
  return lines.join('\n') + '\n';
}

function legacyCount(night: number, { worst = false, splitCamera = true,
                              runs = 3000, seeds }: { worst?: boolean, splitCamera?: boolean, runs?: number, seeds?: number[] } = {}) {
  const population = seeds ?? randomSeedCohort({ count: runs });
  let wins = 0, split = 0;
  const losses = new Map<string, number>();
  for (const seed of population) {
    const result = replay({ night, seed, worst, splitCamera });
    if (result.sim.won && (splitCamera ? result.splitAt >= 0 : true)) wins++;
    if (result.splitAt >= 0) split++;
    if (!result.sim.won) {
      const reason = result.sim.death?.reason ?? 'unknown';
      losses.set(reason, (losses.get(reason) ?? 0) + 1);
    }
  }
  return {
    wins, runs: population.length, split,
    losses: Object.fromEntries(losses),
    seedCohort: seedCohortDescriptor(population, { salt: GOLDEN_MODEL_SEED_SALT }),
  };
}

/** Legacy unconditional device-plan census; kept separate from the new route. */
export function gate(nights = [3, 4, 5, 6], runs = 3000) {
  if (!Number.isInteger(runs) || runs < 1) throw new Error('runs must be positive');
  let pass = true;
  const seeds = randomSeedCohort({ count: runs });
  for (const night of nights) {
    const normal = legacyCount(night, { seeds });
    const worst = legacyCount(night, { seeds, worst: true });
    const control = legacyCount(night, { seeds, splitCamera: false });
    console.log(`Minus 3 legacy night ${night} normal: ${normal.wins}/${normal.runs} ` +
      `split=${normal.split}/${normal.runs} cohort=${normal.seedCohort.sha256.slice(0, 12)} ` +
      `losses=${JSON.stringify(normal.losses)}`);
    console.log(`Minus 3 legacy night ${night} worst diagnostic: ${worst.wins}/${worst.runs} ` +
      `split=${worst.split}/${worst.runs} losses=${JSON.stringify(worst.losses)}`);
    console.log(`Minus 3 legacy night ${night} no-split reference: ${control.wins}/${control.runs} ` +
      `losses=${JSON.stringify(control.losses)}`);
    pass &&= normal.wins === runs && normal.split === runs;
  }
  return pass;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name: string, fallback: number) => {
    const value = process.argv.find(item => item.startsWith(`--${name}=`));
    return value === undefined ? fallback : Number(value.slice(name.length + 3));
  };
  const runs = arg('runs', 3000);
  const night = arg('night', 3);
  if (process.argv.includes('--reactive-gate')) {
    if (!reactiveGate([night], runs)) process.exitCode = 1;
  } else if (process.argv.includes('--reactive-plan')) {
    process.stdout.write(emitReactivePlan(night));
  } else if (process.argv.includes('--gate')) {
    if (!gate([night], runs)) process.exitCode = 1;
  } else {
    process.stdout.write(emitPlan(night));
  }
}
