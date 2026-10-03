// ---------------------------------------------------------------------------
// The four games' nights, behind one registry.
//
// Ask any of them the same question:
//
//   import { nightsOf, scheduleFor } from '@sixam/source';
//   scheduleFor('fnaf3', 1).lengthMs      // 240000
//   scheduleFor('fnaf1', 4).hours[4].levels.bonnie
//
// The registry exists so that a cross-game claim has one place to be checked
// rather than four. It does **not** exist to make the games look alike: the
// `clock.kind` split (accumulator against wall clock) and the per-game
// `rolls` shapes are load-bearing differences, and code that reads a night
// through here gets them rather than an average of them.
// ---------------------------------------------------------------------------

import * as fnaf1 from '../games/fnaf1/fnaf1.ts';
import * as fnaf2 from '../games/fnaf2/fnaf2.ts';
import * as fnaf3 from '../games/fnaf3/fnaf3.ts';
import * as fnaf4 from '../games/fnaf4/fnaf4.ts';
import { FNAF1_PACKAGE } from '../games/fnaf1/controls.ts';
import { FNAF2_PACKAGE } from '../games/fnaf2/controls.ts';
import { FNAF3_PACKAGE } from '../games/fnaf3/controls.ts';
import { FNAF4_PACKAGE } from '../games/fnaf4/controls.ts';
import type { GamePackage } from '@sixam/kernel/contracts';
import { nightSchedule, peakLevel, canAct, rollChance, rollsInHour } from './night-model.ts';
import type { NightModel } from './night-model.ts';

export * from './night-model.ts';
export { fnaf1, fnaf2, fnaf3, fnaf4 };

export const GAMES = {
  fnaf1: fnaf1.MODEL,
  fnaf2: fnaf2.MODEL,
  fnaf3: fnaf3.MODEL,
  fnaf4: fnaf4.MODEL,
};

export const GAME_IDS = Object.keys(GAMES);

/** The package name each game ships under. The only reliable identifier: all
 *  four report plausible-looking and differing `versionName`s on one runtime. */
export const PACKAGES = Object.freeze({
  fnaf1: FNAF1_PACKAGE,
  fnaf2: FNAF2_PACKAGE,
  fnaf3: FNAF3_PACKAGE,
  fnaf4: FNAF4_PACKAGE,
} satisfies Record<string, GamePackage>);

// The kernel's GamePackage union and this table name the same games: a package the kernel
// registers and no game here ships under fails the type check.
type Unshipped = Exclude<GamePackage, (typeof PACKAGES)[keyof typeof PACKAGES]>;
true satisfies ([Unshipped] extends [never] ? true : never);

const BY_ID: Readonly<Record<string, NightModel>> = GAMES;

export function modelFor(game: string) {
  const model = Object.hasOwn(BY_ID, game) ? BY_ID[game] : undefined;
  if (!model) {
    throw new Error(`unknown game ${JSON.stringify(game)}; known: ${GAME_IDS.join(', ')}`);
  }
  return model;
}

/** The last night each game's difficulty table names. */
export const nightsOf = (game: string) =>
  modelFor(game).rows.reduce((last, row) => Math.max(last, row.night.value), 0);

export const scheduleFor = (game: string, night: number, options: { fastNights?: boolean } = {}) =>
  nightSchedule(modelFor(game), night, options);

export const peakFor = (game: string, night: number, id: string, options: { fastNights?: boolean } = {}) =>
  peakLevel(modelFor(game), night, id, options);

export const canActIn = (game: string, night: number, id: string, options: { fastNights?: boolean } = {}) =>
  canAct(modelFor(game), night, id, options);

/**
 * Every roll opportunity an hour holds, per character, for one game.
 *
 * This is what a schedule is budgeting against, and it is the one number that
 * is genuinely comparable across the four: a night is a count of chances.
 */
export function opportunities(game: string, night: number, options: { fastNights?: boolean } = {}) {
  const model = modelFor(game);
  const schedule = nightSchedule(model, night, options);
  return schedule.hours.slice(0, -1).map((hour) => ({
    hour: hour.hour,
    label: hour.label,
    startMs: hour.startMs,
    rolls: Object.fromEntries(Object.entries(model.rolls).map(([id, roll]) => {
      const level = hour.levels[id] ?? hour.levels.ai ?? 0;
      // A drawn level ({ min, max }) has no single chance: its counts are NaN.
      return [id, rollsInHour(roll, hour.durationMs, typeof level === 'number' ? level : NaN)];
    })),
  }));
}

export { rollChance, rollsInHour };
