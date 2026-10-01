// ---------------------------------------------------------------------------
// The night, as a shape the four games share.
//
// All four titles are one Clickteam runtime (770.0, product build 296), and
// three things about a night are written the same way in all of them:
//
//   1. an hour counter that advances and ends the frame at 6,
//   2. difficulty rows gated on the night number, optionally on the hour,
//      that `set` or `add` counters and carry forward until overwritten,
//   3. a per-character roll `Random(bound) + 1 <= level` on a fixed period.
//
// That is the shape. The *content* is not shared and this file deliberately
// holds none of it: FNaF 1 counts an accumulator to a threshold while FNaF 3
// and 4 advance on wall clocks, FNaF 2 is the only one that clamps its AI
// counters, and FNaF 3 has a single `AI` counter where the others have one
// per character. Each game's own module carries its numbers with the group
// that states them.
//
// Every table in this directory is regenerable with
// `packages/source/decompile/nightmap.py --game <game> --table --clock --rolls`, and
// `packages/source/test/test-night-models.ts` checks the encoded tables against figures
// derived independently of them.
// ---------------------------------------------------------------------------

/**
 * A level a row sets: a number, or a draw the game makes when the row fires
 * (FNaF 1's `{ min, max }`, FNaF 2's `{ oneIn }`).
 */
type Level = number | Readonly<Record<string, number>>;
export type Levels = Readonly<Record<string, Level>>;

/** A row's night comparison, verbatim from the sheet: `=`, `<>`, `<`, `<=`, `>` or `>=`. */
interface NightComparison {
  readonly op: string;
  readonly value: number;
}

/** One difficulty row: the nights it admits, the hour it fires at (0 when absent), and what it sets or adds. */
export interface DifficultyRow {
  readonly night: NightComparison;
  readonly hour?: number;
  readonly set?: Levels;
  readonly add?: Readonly<Record<string, number>>;
  readonly [field: string]: unknown;
}

/** An hour's length: fixed, or read off the night (FNaF 3's first night is shorter). */
type HourMs = number | ((night: number | undefined) => number);

/** A counter that rolls over at `threshold` ticks, from `initialTick` in hour 0 and `resetTick` after. */
interface AccumulatorClock {
  readonly kind: 'accumulator';
  readonly tickMs: number;
  readonly fastTickMs?: number;
  readonly threshold: number;
  readonly initialTick: number;
  readonly resetTick: number;
  readonly winHour: number;
  readonly [field: string]: unknown;
}

/** Hours of a fixed wall-clock length. */
interface WallClock {
  readonly kind: 'wallclock';
  readonly hourMs: HourMs;
  readonly fastHourMs?: HourMs;
  readonly winHour: number;
  readonly [field: string]: unknown;
}

/** A night's clock; one resolved for a night carries it, for an hour length that reads it. */
export type NightClock = (AccumulatorClock | WallClock) & { readonly night?: number };

/** A periodic `Random(bound) + 1 <= level` roll, every `everyMs`. */
interface PeriodicRoll {
  readonly everyMs: number;
  readonly bound: number;
  readonly [field: string]: unknown;
}

/** One game's night-level model: its clock, its difficulty rows, its cap and its rolls. */
export interface NightModel {
  readonly game: string;
  readonly clock: NightClock;
  readonly rows: readonly DifficultyRow[];
  readonly cap?: ((id: string) => number) | null;
  readonly initialLevels?: Levels;
  readonly rolls: Readonly<Record<string, PeriodicRoll>>;
}

interface HourOptions {
  readonly fastNights?: boolean;
}

/**
 * The probability that one `Random(bound) + 1 <= level` roll passes.
 *
 * Clickteam's `Random(N)` yields 0..N-1, so `Random(N) + 1` yields 1..N and
 * the comparison passes with probability `min(level, bound) / bound`. A level
 * of 0 never passes, which is what makes "this character is not armed
 * tonight" a statement the difficulty table can make.
 */
export const rollChance = (bound: number, level: number) =>
  level <= 0 ? 0 : Math.min(level, bound) / bound;

/** Hour 0 reads 12 AM on every clock face in the series. */
export const clockLabel = (hour: number) => (hour === 0 ? 12 : hour);

/**
 * How long one hour lasts, in ms, for a resolved clock.
 *
 * `accumulator` clocks tick a counter and roll it over at a threshold, so the
 * first hour can differ from the rest: FNaF 1 resets its minute counter to 1
 * rather than 0, which makes hour 0 ninety ticks and every later hour
 * eighty-nine. `wallclock` clocks have no such seam.
 */
export function hourDurationMs(clock: NightClock, hour: number, { fastNights = false }: HourOptions = {}) {
  if (clock.kind === 'wallclock') {
    const base = typeof clock.hourMs === 'function' ? clock.hourMs(clock.night) : clock.hourMs;
    return fastNights && clock.fastHourMs !== undefined
      ? (typeof clock.fastHourMs === 'function' ? clock.fastHourMs(clock.night) : clock.fastHourMs)
      : base;
  }
  const tickMs = fastNights && clock.fastTickMs !== undefined ? clock.fastTickMs : clock.tickMs;
  const from = hour === 0 ? clock.initialTick : clock.resetTick;
  return (clock.threshold - from) * tickMs;
}

/**
 * The wall-clock offset at which an hour begins, measured from night start.
 */
export function hourStartMs(clock: NightClock, hour: number, options: HourOptions = {}) {
  let total = 0;
  for (let h = 0; h < hour; h += 1) total += hourDurationMs(clock, h, options);
  return total;
}

/** The whole night, night start to the hour that leaves the frame. */
export const nightLengthMs = (clock: NightClock, options: HourOptions = {}) =>
  hourStartMs(clock, clock.winHour, options);

/**
 * Whether a row's night comparison admits this night.
 *
 * The comparison is kept verbatim from the sheet rather than expanded into a
 * night list, because two rows can admit the same night and the sheet's own
 * order decides which wins -- an expansion loses that.
 */
export function nightMatches(comparison: NightComparison, night: number) {
  const { op, value } = comparison;
  switch (op) {
    case '=': return night === value;
    case '<>': return night !== value;
    case '<': return night < value;
    case '<=': return night <= value;
    case '>': return night > value;
    case '>=': return night >= value;
    default: return false;
  }
}

/**
 * Apply every difficulty row that fires as `hour` begins, in sheet order.
 *
 * `set` overwrites and `add` accumulates. A row with no `hour` fires at night
 * start (hour 0). Levels carry forward: a row names only what it changes, and
 * a character no row ever names stays at its starting level for the night --
 * which is how "Balloon Boy cannot act on Night 1" is a fact the table states
 * rather than a sample nobody happened to see.
 *
 * `cap` is a per-character ceiling applied after each row. Only FNaF 2 has
 * one; the query that finds its six cap groups finds nothing in the other
 * three, and it was run against FNaF 2 first to prove it can see a positive.
 */
export function applyRows(rows: readonly DifficultyRow[], night: number, hour: number, levels: Levels,
  { cap = null }: { cap?: ((id: string) => number) | null } = {}): Record<string, Level> {
  const next: Record<string, Level> = { ...levels };
  for (const row of rows) {
    if (!nightMatches(row.night, night)) continue;
    if ((row.hour ?? 0) !== hour) continue;
    for (const [id, amount] of Object.entries(row.set ?? {})) {
      next[id] = typeof amount === 'object' ? amount : amount;
    }
    for (const [id, amount] of Object.entries(row.add ?? {})) {
      const level = next[id];
      next[id] = (typeof level === 'number' ? level : 0) + amount;
    }
    if (cap) {
      for (const id of Object.keys(next)) {
        const level = next[id];
        if (typeof level === 'number') next[id] = Math.min(level, cap(id));
      }
    }
  }
  return next;
}

/**
 * Levels once every draw is taken. A Sim reads its levels as numbers; FNaF 1
 * draws its one drawn level (Night 4's Freddy) at night start and every other
 * row in the three tables sets a number, so a draw left here is refused.
 */
export function settledLevels(levels: Levels, game: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(levels)) {
    if (typeof value !== 'number') throw new Error(`${game} level ${id} is a draw no row resolves`);
    out[id] = value;
  }
  return out;
}

/**
 * The whole night, hour by hour: when each hour starts, and the levels in
 * force through it.
 *
 * This is the night-level model -- what a route's schedule is written
 * against. It says when a character switches on, not where it walks.
 */
export function nightSchedule(model: NightModel, night: number, options: HourOptions = {}) {
  const clock: NightClock = { ...model.clock, night };
  let levels: Levels = { ...(model.initialLevels ?? {}) };
  const hours: { hour: number, label: number, startMs: number, durationMs: number, levels: Levels }[] = [];
  for (let hour = 0; hour <= clock.winHour; hour += 1) {
    levels = applyRows(model.rows, night, hour, levels, { cap: model.cap ?? null });
    hours.push({
      hour,
      label: clockLabel(hour),
      startMs: hourStartMs(clock, hour, options),
      durationMs: hour === clock.winHour ? 0 : hourDurationMs(clock, hour, options),
      levels: { ...levels },
    });
  }
  return {
    game: model.game,
    night,
    winHour: clock.winHour,
    lengthMs: nightLengthMs(clock, options),
    hours,
  };
}

/**
 * The highest level a character reaches on a night, read off the same rows
 * the engine applies rather than inferred from a sampled run.
 *
 * A `{ oneIn: N }` level is 1 on its top draw, so its peak is 1: rare is not
 * impossible and must not read as zero.
 */
export function peakLevel(model: NightModel, night: number, id: string, options: HourOptions = {}) {
  let peak = 0;
  for (const hour of nightSchedule(model, night, options).hours) {
    const level = hour.levels[id];
    if (level === undefined) continue;
    peak = Math.max(peak, typeof level === 'number' ? level : 1);
  }
  return peak;
}

/** Whether the sourced table lets this character act at all on this night. */
export const canAct = (model: NightModel, night: number, id: string, options: HourOptions = {}) =>
  peakLevel(model, night, id, options) > 0;

/**
 * How many times a periodic roll comes up inside one hour, and how many of
 * them are expected to pass.
 *
 * `Every N ms` is the engine's own scheduler, so the count is the hour's
 * length over the period. The pass count is that times `rollChance`, which
 * makes "how many movement opportunities does this hour hold" answerable
 * from the table alone -- the quantity a schedule is actually budgeting.
 */
export function rollsInHour(roll: PeriodicRoll, hourMs: number, level: number) {
  const opportunities = Math.floor(hourMs / roll.everyMs);
  return {
    opportunities,
    expected: opportunities * rollChance(roll.bound, level),
    chance: rollChance(roll.bound, level),
  };
}
