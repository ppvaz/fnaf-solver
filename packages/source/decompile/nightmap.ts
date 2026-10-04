#!/usr/bin/env node
// Read a night out of a rendered CTFAK event sheet, for any of the four games.
//
// `aimap.ts` answers one question about one game: FNaF 2's per-night AI counter table. This answers the same class
// of question about *whatever sheet it is pointed at*, which is what makes a second, third and fourth game's night
// modellable without a bespoke parser each time.
//
// The sheet format is the CTFAK-rendered one, produced by `dump_events.py`:
//
//     --- group N ---
//       IF   <condition>
//       DO   <action>
//
// Every line in all four games' dumps is one of: a group header, an `IF`, a `DO`, a `FRAME` header, its `====`
// underline, or blank. Nothing wraps, so the parse is a split rather than a grammar -- see `--audit`, which prints
// any line the reader could not classify. An empty audit is the claim that nothing was silently dropped.
//
// Reports (each also available as `--json`):
//
//   --table       the per-night / per-hour difficulty table
//   --clock       the night clock: what ticks, what rolls over, what wins
//   --rolls       movement rolls: `Every N ms` + `Random(B)+1 <= <counter>`
//   --graph OBJ   an object's movement graph: overlap source -> position target
//   --draws       every `Random` draw, with whether a timer forces it
//   --timers      every distinct `Every` / `TimerEquals` period
//   --audit       unclassified lines (should be empty)
//
// Usage:
//
//     packages/source/decompile/nightmap.ts --game fnaf1 --table
//     packages/source/decompile/nightmap.ts --sheet path/to/03-04-Office.txt --clock --json
//     packages/source/decompile/nightmap.ts --game fnaf4 --graph Bonnie
//
// `--game` resolves a sheet through `$FNAF_DUMP_ROOT` (default `~/fnaf-apks`), whose per-game `events/` directories
// hold extracted game content and stay outside the repository. `--sheet` takes a path directly.
//
// The counter names each game uses for its night and hour are *not* guessed from a convention -- FNaF 4's is
// `Night` where FNaF 1's is `night number`, and a lowercase-only query finds nothing in FNaF 4 while looking exactly
// like an absence. They are named per game in GAMES below, and `--clock` derives the clock chain structurally so
// that a wrong name shows up as a missing chain rather than as a plausible wrong number.
//
// Ported from nightmap.py: it reads, prints and exits as that did. Numbers read off the sheet are bigints, as
// Python's ints are, and a float is a PyFloat.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PyFloat, PySystemExit as Exit, type PyJson, pyAlign, pyArgs, pyCompare, pyDumps, pyExitStatus, pyFloat, pyInt, pyPath, pyReadText, pyRegExp,
  pySplitLines, pyStrRepr, pyStrip,
} from '@sixam/kernel/py';

// --- sheet resolution -------------------------------------------------------

const DUMP_ROOT = process.env.FNAF_DUMP_ROOT ?? `${homedir()}/fnaf-apks`;

// Per game: the night frame's sheet, and the counters that carry night and hour. Each name is quoted from that
// game's own sheet, not inferred.
const GAMES = new Map([
  ['fnaf1', { sheet: 'fnaf1/events/05-06-Main_Room.txt', night: 'night number', hour: 'time of day' }],
  ['fnaf2', { sheet: 'fnaf2/events/03-04-Office.txt', night: 'night', hour: 'time of the night' }],
  ['fnaf3', { sheet: 'fnaf3/events/03-04-Office.txt', night: 'night number', hour: 'hour' }],
  ['fnaf4', { sheet: 'fnaf4/events/03-04-level.txt', night: 'Night', hour: 'hour' }],
]);

function resolveSheet(game: string | null, sheet: string | null) {
  if (sheet) return pyPath(sheet);
  const profile = game ? GAMES.get(game) : undefined;
  if (profile) return pyPath(`${pyPath(DUMP_ROOT)}/${profile.sheet}`);
  throw new Exit('nightmap: pass --game or --sheet');
}

// --- the parse --------------------------------------------------------------

// The patterns are Python's, read as re read them (pyRegExp).
const GROUP = pyRegExp(String.raw`^--- group (\d+) ---`);
const LINE = pyRegExp(String.raw`^  (IF|DO)   (.*)$`);
const FRAME = pyRegExp(String.raw`^FRAME \d+:`);
const RULE = pyRegExp(String.raw`^=+$`);

/** int() of digits a pattern matched. */
const int = (text: string) => pyInt(text) ?? 0n;

export interface Group { id: bigint, conditions: string[], actions: string[] }

/** Split a rendered sheet into groups: [groups, unclassified [line number, text]]. */
export function parse(text: string): [Group[], [number, string][]] {
  const groups: Group[] = [];
  const unclassified: [number, string][] = [];
  let current: Group | null = null;
  pySplitLines(text).forEach((raw, k) => {
    if (!pyStrip(raw)) return;
    const header = GROUP.exec(raw);
    if (header) {
      current = { id: int(header[1]), conditions: [], actions: [] };
      groups.push(current);
      return;
    }
    if (FRAME.test(raw) || RULE.test(raw)) return;
    const kind = LINE.exec(raw);
    if (kind && current !== null) {
      (kind[1] === 'IF' ? current.conditions : current.actions).push(kind[2]);
      return;
    }
    unclassified.push([k + 1, raw]);
  });
  return [groups, unclassified];
}

// --- the shapes a condition or action can carry -----------------------------

const EVERY = pyRegExp(String.raw`\bEvery \(TIME\{[^}]*timer=(\d+)\}`);
const TIMER_EQUALS = pyRegExp(String.raw`\bTimerEquals \(TIME\{[^}]*timer=(\d+)\}`);
const COMPARE_COUNTER = pyRegExp(String.raw`^(?:NOT )?(?P<name>.+?) -> CompareCounter \(COMPARISON\{(?P<op>\S+) Long\[(?P<value>-?\d+)\]\}\)$`);
const WRITE_COUNTER = pyRegExp(String.raw`^(?P<name>.+?) -> (?P<verb>Set|Add|Subtract)CounterValue \(EXPRESSION\{= (?P<expr>.*)\}\)$`);
const COMPARE_AV = pyRegExp(String.raw`^(?P<neg>NOT )?(?P<obj>.+?) -> CompareAlterableValue \(AlterableValue\{[^}]*value=(?P<slot>\d+)\}, `
  + String.raw`COMPARISON\{(?P<op>\S+) (?:Long|Double)\[(?P<value>-?[\d.]+)\]\}\)$`);
const WRITE_AV = pyRegExp(String.raw`^(?P<obj>.+?) -> (?P<verb>SetAlterableValue|AddToAlterable) \(AlterableValue\{[^}]*value=(?P<slot>\d+)\}, `
  + String.raw`EXPRESSION\{= (?P<expr>.*)\}\)$`);
const OVERLAP = pyRegExp(String.raw`^(?P<neg>NOT )?(?P<obj>.+?) -> IsOverlapping \(OBJECT\{[^}]*objectInfo->(?P<target>[^}]*)\}\)$`);
const SET_POSITION = pyRegExp(String.raw`^(?P<obj>.+?) -> SetPosition \(POSITION\{[^}]*objectInfoParent->(?P<target>[^}]*)\}\)$`);
const RANDOM = pyRegExp(String.raw`Random Long\[(\d+)\]`, 'g');
// `Random(B) + 1 <= CounterValue[X]`: the movement roll every game uses.
const ROLL = pyRegExp(String.raw`^Compare \(EXPRESSION\{= Random Long\[(?P<bound>\d+)\] EndParenthesis Plus Long\[1\]\}, `
  + String.raw`COMPARISON\{(?P<op>\S+) CounterValue\[(?P<counter>[^\]]+)\]\}\)$`);
// `(Random(D) + 1) / D` under integer division: 1 with probability 1/D.
const ONE_IN = pyRegExp(String.raw`Parenthesis Random Long\[(\d+)\] EndParenthesis Plus Long\[1\] EndParenthesis Divide Long\[(\d+)\]`);
const LONG = pyRegExp(String.raw`^Long\[(-?\d+)\]$`);
// `base + Random(bound)`, which the sheet writes with either operand first: FNaF 1 writes
// `Long[1] Plus Random Long[2] EndParenthesis` and FNaF 4 writes `Random Long[4] EndParenthesis Plus Long[2]` for the
// same shape. Matching only one order reports the other as unreadable, which looks like an exotic expression rather
// than like a missing case.
const BASE_PLUS_RANDOM = pyRegExp(String.raw`^Long\[(-?\d+)\] Plus Random Long\[(\d+)\] EndParenthesis$`);
const RANDOM_PLUS_BASE = pyRegExp(String.raw`^Random Long\[(\d+)\] EndParenthesis Plus Long\[(-?\d+)\]$`);
// `CounterValue[x]`, optionally offset by a literal. FNaF 3's whole difficulty table is this shape
// (`AI = night number`, `AI = night number - 1`), and reading it as UNKNOWN would report the simplest of the four
// tables as the one that could not be read.
const COUNTER_OFFSET = pyRegExp(String.raw`^CounterValue\[(?P<counter>[^\]]+)\](?: (?P<sign>Plus|Minus) Long\[(?P<offset>-?\d+)\])?$`);
// Conditions carrying no operand a model needs: the trigger-once forms, the object-count and visibility tests, and
// the animation/frame lifecycle ones.
const BARE_CONDITION = pyRegExp(String.raw`^(?:(?P<neg>NOT )?)(?:[^ ]+(?:\.[^ ]+)? -> )?`
  + String.raw`(?P<kind>NotAlways|Always|Once|StartOfFrame|GroupEnd|NewGroup|Skip|`
  + String.raw`ObjectInvisible|ObjectVisible|NumberOfObjects|AnimationFinished|`
  + String.raw`OnTimerEvent|ObjectClicked|MouseOnObject|KeyDown|KeyPressed|`
  + String.raw`Multiple Touch|FlagOn|FlagOff|Compare|CompareGlobalValueIntEqual|`
  + String.raw`CompareAlterableValue|CompareCounter|IsOverlapping|TimerEquals)\b.*$`);
const JUMP_TO_FRAME = pyRegExp(String.raw`^JumpToFrame \(FRAME\{[^}]*value=(\d+)\}\)$`);

/** A named group's text: these patterns name only groups that took part when they matched, or optional ones. */
const named = (match: RegExpExecArray, name: string) => match.groups?.[name] ?? '';

/** Every timer period that gates this group, in ms. */
export function timersOf(group: Group): bigint[] {
  const found: bigint[] = [];
  for (const condition of group.conditions) {
    for (const pattern of [EVERY, TIMER_EQUALS]) {
      const match = pattern.exec(condition);
      if (match) found.push(int(match[1]));
    }
  }
  return found;
}

export function counterCompares(group: Group, name: string | null = null): [string, string, bigint][] {
  const out: [string, string, bigint][] = [];
  for (const condition of group.conditions) {
    const match = COMPARE_COUNTER.exec(condition);
    if (match && (name === null || named(match, 'name') === name)) out.push([named(match, 'name'), named(match, 'op'), int(named(match, 'value'))]);
  }
  return out;
}

export type AlterableCompare = { object: string, slot: bigint, op: string, value: PyFloat, negated: boolean };

export function alterableCompares(group: Group): AlterableCompare[] {
  return group.conditions.flatMap(condition => {
    const match = COMPARE_AV.exec(condition);
    if (!match) return [];
    return [{ object: named(match, 'obj'), slot: int(named(match, 'slot')), op: named(match, 'op'), value: float(named(match, 'value')),
      negated: match.groups?.neg !== undefined && match.groups.neg !== '' }];
  });
}
/** float() of `-?[\d.]+`: a ValueError (`1.2.3`) stops the run as it did there. */
function float(text: string) {
  const value = pyFloat(text);
  if (value === null) throw new RangeError(`could not convert string to float: ${pyStrRepr(text)}`);
  return new PyFloat(value);
}

export function counterWrites(group: Group, suffix: string | null = null): [string, string, string][] {
  return group.actions.flatMap(action => {
    const match = WRITE_COUNTER.exec(action);
    if (!match) return [];
    if (suffix !== null && !named(match, 'name').endsWith(suffix)) return [];
    const write: [string, string, string] = [named(match, 'name'), named(match, 'verb'), named(match, 'expr')];
    return [write];
  });
}

export type Expression =
  | { kind: 'literal', value: bigint } | { kind: 'oneIn', n: bigint } | { kind: 'range', min: bigint, max: bigint, base: bigint, bound: bigint }
  | { kind: 'global', expr: string } | { kind: 'counter', counter: string, offset: bigint } | { kind: 'UNKNOWN', expr: string };

/** Classify a counter-set expression into something a model can use.
 *
 *  Anything unrecognised comes back as `{"kind": "UNKNOWN", "expr": ...}` rather than a number, because a difficulty
 *  table that silently reads a Random as 0 is exactly the tidy wrong answer this reader exists to avoid. */
export function readExpression(expr: string): Expression {
  const literal = LONG.exec(expr);
  if (literal) return { kind: 'literal', value: int(literal[1]) };
  const chance = ONE_IN.exec(expr);
  if (chance && chance[1] === chance[2]) return { kind: 'oneIn', n: int(chance[1]) };
  let span = BASE_PLUS_RANDOM.exec(expr);
  if (span) {
    const [base, bound] = [int(span[1]), int(span[2])];
    return { kind: 'range', min: base, max: base + bound - 1n, base, bound };
  }
  span = RANDOM_PLUS_BASE.exec(expr);
  if (span) {
    const [bound, base] = [int(span[1]), int(span[2])];
    return { kind: 'range', min: base, max: base + bound - 1n, base, bound };
  }
  if (expr.startsWith('GlobalValue[')) return { kind: 'global', expr };
  const offset = COUNTER_OFFSET.exec(expr);
  if (offset) {
    let delta = int(offset.groups?.offset || '0');
    if (offset.groups?.sign === 'Minus') delta = -delta;
    return { kind: 'counter', counter: named(offset, 'counter'), offset: delta };
  }
  return { kind: 'UNKNOWN', expr };
}

// --- report: the per-night difficulty table ---------------------------------

const compareTerm = ([, op, value]: [string, string, bigint]) => ({ op, value });

/** Groups gated on the night counter, with what they write.
 *
 *  Each row keeps its night comparison verbatim (`=`, `>=`, `<`) rather than expanding it to a night list, because
 *  the sheet's own ordering decides which of two overlapping rows wins and that is not recoverable from an
 *  expansion. */
export function nightTable(groups: readonly Group[], nightName: string, hourName: string | null) {
  return groups.flatMap(group => {
    const nights = counterCompares(group, nightName);
    if (!nights.length) return [];
    const hours = counterCompares(group, hourName);
    const writes = counterWrites(group);
    if (!writes.length) return [];
    return [{
      group: group.id, night: nights.map(compareTerm), hour: hours.map(compareTerm),
      gates: group.conditions.filter(condition => {
        const match = COMPARE_COUNTER.exec(condition);
        return !match || ![nightName, hourName].includes(named(match, 'name'));
      }),
      sets: writes.map(([counter, verb, expr]) => ({ counter, verb, value: readExpression(expr) })),
    }];
  });
}

// --- report: the night clock ------------------------------------------------

const counterTerm = ([counter, op, value]: [string, string, bigint]) => ({ counter, op, value });

/** Derive the clock chain rather than assert it.
 *
 *  Looks for: a counter incremented on a timer (the minute), a group that compares that counter against a threshold
 *  and advances the hour, the hour's own wrap, and the hour value that leaves the frame. Each link is reported with
 *  the group that carries it, and a missing link is reported as missing -- an absent chain is the signal that the
 *  hour counter was named wrong, which is the one failure this cannot otherwise see. */
export function clock(groups: readonly Group[], hourName: string) {
  type When = { counter: string, op: string, value: bigint };
  const hourAdvance: { group: bigint, by: Expression, when: When[], whenAlterable: AlterableCompare[], timers: bigint[] }[] = [];
  const hourWrap: { group: bigint, to: Expression, when: When[], timers: bigint[] }[] = [];
  const hourSets: typeof hourWrap = [];
  const minuteTicks: { group: bigint, source: string, by: Expression, timers: bigint[], gates: string[] }[] = [];
  const leavesFrame: { group: bigint, at: { op: string, value: bigint }[], frameHandle: bigint }[] = [];

  // Which counters advance the hour, and on what threshold.
  for (const group of groups) {
    for (const [name, verb, expr] of counterWrites(group)) {
      if (name !== hourName) continue;
      if (verb === 'Add') {
        hourAdvance.push({ group: group.id, by: readExpression(expr), when: counterCompares(group).map(counterTerm),
          whenAlterable: alterableCompares(group), timers: timersOf(group) });
      } else if (verb === 'Set') {
        const target = readExpression(expr);
        const wrap = counterCompares(group, hourName);
        const entry = { group: group.id, to: target, when: counterCompares(group).map(counterTerm), timers: timersOf(group) };
        (wrap.length ? hourWrap : hourSets).push(entry);
      }
    }
  }

  // The minute source is whatever the hour advance tests. It is a counter in FNaF 1 (`minute counter`) and FNaF 3/4
  // (nothing -- the hour is on a wall clock), but in FNaF 2 it is an *alterable value* on the `AM` object, so a
  // counter-only search reports "no minute source" for the one game whose night this repository actually runs.
  // Both are collected.
  const minuteNames = new Set(hourAdvance.flatMap(entry => entry.when.filter(when => when.counter !== hourName).map(when => when.counter)));
  const minuteSlots: [string, bigint][] = [];
  for (const entry of hourAdvance) {
    for (const when of entry.whenAlterable) {
      if (!minuteSlots.some(([object, slot]) => object === when.object && slot === when.slot)) minuteSlots.push([when.object, when.slot]);
    }
  }
  for (const group of groups) {
    for (const [name, verb, expr] of counterWrites(group)) {
      if (!minuteNames.has(name) || verb !== 'Add') continue;
      minuteTicks.push({ group: group.id, source: name, by: readExpression(expr), timers: timersOf(group),
        gates: group.conditions.filter(condition => !EVERY.test(condition)) });
    }
    for (const action of group.actions) {
      const write = WRITE_AV.exec(action);
      if (!write || named(write, 'verb') !== 'AddToAlterable') continue;
      const [object, slot] = [named(write, 'obj'), int(named(write, 'slot'))];
      if (!minuteSlots.some(([o, s]) => o === object && s === slot)) continue;
      minuteTicks.push({ group: group.id, source: `${object}[${named(write, 'slot')}]`, by: readExpression(named(write, 'expr')), timers: timersOf(group),
        gates: group.conditions.filter(condition => !EVERY.test(condition)) });
    }
  }
  const minuteSources = [...[...minuteNames].sort(pyCompare), ...minuteSlots.map(([object, slot]) => `${object}[${slot}]`).sort(pyCompare)];

  // Leaving the frame on an hour value is the win condition.
  //
  // `frameHandle` is the raw value the action carries and is NOT the dumped frame index: FNaF 3's own timer names give
  // `JumpToGFreddy` -> 21 against index 22 and `JumpToMangle` -> 17 against index 20, so the two disagree by different
  // amounts and no constant offset reconciles them. UNKNOWN(frame-handle-map) -- the map lives outside the event
  // sheet. A night's win is therefore identified by the *hour it fires at*, which this reports, and never by where
  // it lands.
  for (const group of groups) {
    const hours = counterCompares(group, hourName);
    if (!hours.length) continue;
    for (const action of group.actions) {
      const jump = JUMP_TO_FRAME.exec(action);
      if (jump) leavesFrame.push({ group: group.id, at: hours.map(compareTerm), frameHandle: int(jump[1]) });
    }
  }
  return { hourCounter: hourName, minuteTicks, hourAdvance, hourWrap, leavesFrame, hourSets, minuteSources };
}


// --- report: movement rolls -------------------------------------------------

/** `Every N ms` + `Random(B)+1 <= <counter>` -- the shape all four use. */
export function rolls(groups: readonly Group[]) {
  return groups.flatMap(group => {
    const periods = timersOf(group);
    return group.conditions.flatMap((condition, index) => {
      const match = ROLL.exec(condition);
      if (!match) return [];
      return [{
        group: group.id, everyMs: periods.length ? periods[0] : null, bound: int(named(match, 'bound')), op: named(match, 'op'),
        counter: named(match, 'counter'),
        gates: group.conditions.filter((other, k) => k !== index && !EVERY.test(other)),
        actions: [...group.actions],
      }];
    });
  });
}

// --- report: an object's movement graph -------------------------------------

/** A branch condition as structured terms rather than as engine text.
 *
 *  `--graph` prints the sheet's own wording, which is what you want while reading. `--graphs` is the export mode and
 *  must not carry it: a file of verbatim event lines is a partial reproduction of the dump, and this project's
 *  publishing boundary allows derived facts out and dump content never. Everything a model needs -- which counter,
 *  which comparison, which value -- survives the conversion; only the engine's phrasing is dropped.
 *
 *  A condition the reader cannot classify is kept as `{"kind": "UNKNOWN"}` with its shape but not its text, so a gap
 *  stays visible without leaking. */
export function conditionTerms(conditions: readonly string[]): { [key: string]: PyJson }[] {
  const negated = (match: RegExpExecArray) => (match.groups?.neg ?? '') !== '';
  return conditions.map((condition): { [key: string]: PyJson } => {
    const counter = COMPARE_COUNTER.exec(condition);
    if (counter) return { kind: 'counter', name: named(counter, 'name'), op: named(counter, 'op'), value: int(named(counter, 'value')) };
    const alterable = COMPARE_AV.exec(condition);
    if (alterable) {
      return { kind: 'alterable', object: named(alterable, 'obj'), slot: int(named(alterable, 'slot')), op: named(alterable, 'op'),
        value: float(named(alterable, 'value')), negated: negated(alterable) };
    }
    const overlap = OVERLAP.exec(condition);
    if (overlap) return { kind: 'overlap', object: named(overlap, 'obj'), target: named(overlap, 'target'), negated: negated(overlap) };
    const every = EVERY.exec(condition);
    if (every) return { kind: 'every', ms: int(every[1]) };
    const roll = ROLL.exec(condition);
    if (roll) return { kind: 'roll', bound: int(named(roll, 'bound')), op: named(roll, 'op'), counter: named(roll, 'counter') };
    // Conditions with no operands worth carrying. The engine's name for the *kind* is a derived fact; its rendered
    // line is not, so only the kind is emitted.
    const bare = BARE_CONDITION.exec(condition);
    if (bare) return { kind: named(bare, 'kind'), negated: negated(bare) };
    return { kind: 'UNKNOWN' };
  });
}

/** Edges for one object: where it is (overlap) -> where it goes (position).
 *
 *  The branch selector is left as the group's remaining conditions verbatim. Naming it would mean guessing which
 *  alterable slot is "the" selector, and the four games do not agree on that. */
export function graph(groups: readonly Group[], object: string) {
  const wanted = object.toLowerCase();
  return groups.flatMap(group => {
    const moves = group.actions.map(action => SET_POSITION.exec(action)).filter((move): move is RegExpExecArray =>
      move !== null && named(move, 'obj').toLowerCase().includes(wanted));
    if (!moves.length) return [];
    const sources: { target: string, negated: boolean }[] = [];
    const branch: string[] = [];
    for (const condition of group.conditions) {
      const overlap = OVERLAP.exec(condition);
      if (overlap && named(overlap, 'obj').toLowerCase().includes(wanted)) sources.push({ target: named(overlap, 'target'), negated: (overlap.groups?.neg ?? '') !== '' });
      else branch.push(condition);
    }
    return moves.map(move => ({ group: group.id, object: named(move, 'obj'), from: sources, to: named(move, 'target'), branch, branchTerms: conditionTerms(branch) }));
  });
}

// --- report: the draw census ------------------------------------------------

/** Every Random draw, and what has to hold before it is consumed.
 *
 *  A draw a timer forces is consumed whether or not anything happens, so a seed model must reproduce it; a draw
 *  behind a state condition is consumed only when that state holds. The distinction is the whole difficulty of
 *  predicting a stream.
 *
 *  Where the draw sits decides this, and it is not the same question for the two sites:
 *
 *  - A draw in an **action** runs only if every condition passed.
 *  - A draw in a **condition** is evaluated while the conditions are being tested, and Clickteam stops at the first
 *    that fails. So a `Random` inside a movement roll's own comparison is consumed as soon as the timer fires *if
 *    nothing before it can fail* -- which is why `conditionsBefore` counts the non-timer conditions that precede the
 *    drawing line rather than the group's conditions as a whole.
 *
 *  `forcedByTimer` is therefore true when a timer gates the group and nothing that can fail stands in front of the
 *  draw. */
export function draws(groups: readonly Group[]) {
  const out: { group: bigint, site: string, bound: bigint, everyMs: bigint | null, conditionsBefore: number, forcedByTimer: boolean, text: string }[] = [];
  for (const group of groups) {
    const periods = timersOf(group);
    const blocking: string[] = [];           // non-timer conditions seen so far, in order
    const record = (site: string, bound: string, text: string) => out.push({ group: group.id, site, bound: int(bound),
      everyMs: periods.length ? periods[0] : null, conditionsBefore: blocking.length, forcedByTimer: periods.length > 0 && !blocking.length, text });
    for (const line of group.conditions) {
      for (const match of line.matchAll(RANDOM)) record('condition', match[1], line);
      if (!EVERY.test(line) && !TIMER_EQUALS.test(line)) blocking.push(line);
    }
    for (const line of group.actions) for (const match of line.matchAll(RANDOM)) record('action', match[1], line);
  }
  return out;
}

/** Every object that moves itself more than `minimum` times.
 *
 *  A character in these games *is* an object that repositions itself onto camera markers, so this finds the cast
 *  without being told who they are: FNaF 3's antagonist is named `dhfgh` in the sheet, which no list of expected
 *  names would have contained. */
export function movers(groups: readonly Group[], minimum = 3): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) {
    for (const action of group.actions) {
      const move = SET_POSITION.exec(action);
      if (move) counts.set(named(move, 'obj'), (counts.get(named(move, 'obj')) ?? 0) + 1);
    }
  }
  return new Map([...counts].filter(([, n]) => n >= minimum).sort((a, b) => b[1] - a[1]));
}

export function timers(groups: readonly Group[]): Map<string, bigint[]> {
  const seen = new Map<bigint, bigint[]>();
  for (const group of groups) {
    for (const period of timersOf(group)) {
      const ids = seen.get(period) ?? [];
      ids.push(group.id);
      seen.set(period, ids);
    }
  }
  return new Map([...seen.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map(period => [String(period), seen.get(period) ?? []]));
}

// --- CLI --------------------------------------------------------------------

type TableRow = ReturnType<typeof nightTable>[number];

function renderTable(rows: readonly TableRow[]) {
  for (const row of rows) {
    const night = row.night.map(c => `night ${c.op} ${c.value}`).join(', ');
    const hour = row.hour.map(c => `hour ${c.op} ${c.value}`).join(', ') || 'night start';
    console.log(`g${row.group}: ${night} | ${hour}`);
    for (const gate of row.gates) console.log(`    gate: ${gate}`);
    for (const write of row.sets) {
      const value = write.value;
      let shown: string;
      if (value.kind === 'literal') shown = String(value.value);
      else if (value.kind === 'oneIn') shown = `1 in ${value.n}`;
      else if (value.kind === 'range') shown = `${value.min}..${value.max}`;
      else if (value.kind === 'counter') shown = `[${value.counter}]${value.offset ? ` ${value.offset > 0n ? '+' : ''}${value.offset}` : ''}`;
      else if (value.kind === 'global') shown = value.expr;
      else shown = `UNKNOWN(${value.expr})`;
      const verb = write.verb === 'Set' ? '=' : write.verb === 'Add' ? '+=' : '-=';
      console.log(`    ${write.counter} ${verb} ${shown}`);
    }
  }
}

function main(argv: readonly string[]): number {
  const flags = ['--table', '--clock', '--rolls', '--graphs', '--movers', '--draws', '--timers', '--audit', '--json'];
  const args = pyArgs(argv, 'nightmap.ts', [{ name: '--game', choices: [...GAMES.keys()].sort() }, { name: '--sheet' }, { name: '--night' }, { name: '--hour' },
    { name: '--table', takes: 'flag' }, { name: '--clock', takes: 'flag' }, { name: '--rolls', takes: 'flag' }, { name: '--graph', metavar: 'OBJ' },
    { name: '--graphs', takes: 'flag' }, { name: '--movers', takes: 'flag' }, { name: '--draws', takes: 'flag' }, { name: '--timers', takes: 'flag' },
    { name: '--audit', takes: 'flag' }, { name: '--json', takes: 'flag' }]);
  if ('exit' in args) {
    (args.exit ? console.error : console.log)(args.text);
    return args.exit;
  }
  const text = (name: string) => { const value = args.options[name]; return typeof value === 'string' ? value : null; };
  const on = new Set(flags.filter(flag => args.options[flag] === true));
  try {
    const game = text('--game');
    const path = resolveSheet(game, text('--sheet'));
    if (!existsSync(path)) throw new Exit(`nightmap: no sheet at ${path}`);
    const [groups, unclassified] = parse(pyReadText(readFileSync(path), 'replace'));
    const profile = game ? GAMES.get(game) : undefined;
    const nightName = text('--night') || profile?.night || null;
    const hourName = text('--hour') || profile?.hour || null;
    const graphObject = text('--graph');

    const report = new Map<string, PyJson>([['sheet', path], ['groups', groups.length], ['unclassifiedLines', unclassified.length]]);
    if (![...on].some(flag => flag !== '--json') && !graphObject) on.add('--table');

    if (on.has('--table')) {
      if (!nightName) throw new Exit('nightmap: --table needs --game or --night');
      report.set('table', nightTable(groups, nightName, hourName));
    }
    if (on.has('--clock')) {
      if (!hourName) throw new Exit('nightmap: --clock needs --game or --hour');
      report.set('clock', clock(groups, hourName));
    }
    if (on.has('--rolls')) report.set('rolls', rolls(groups));
    if (graphObject) report.set('graph', graph(groups, graphObject));
    const moving = movers(groups);
    if (on.has('--movers') || on.has('--graphs')) report.set('movers', new Map<string, PyJson>(moving));
    // The export drops the verbatim `branch` and keeps `branchTerms`.
    const exported = on.has('--graphs')
      ? new Map([...moving.keys()].map(name => [name, graph(groups, name).map(({ branch: _dropped, ...kept }) => kept)])) : new Map<string, never[]>();
    if (on.has('--graphs')) report.set('graphs', exported);
    const census = draws(groups);
    if (on.has('--draws')) report.set('draws', census);
    if (on.has('--timers')) report.set('timers', timers(groups));
    if (on.has('--audit')) report.set('audit', unclassified.map(([line, raw]) => new Map<string, PyJson>([['line', line], ['text', raw]])));

    if (on.has('--json')) {
      console.log(pyDumps(report, 2));
      return 0;
    }
    console.log(`${path.slice(path.lastIndexOf('/') + 1)}: ${groups.length} groups, ${unclassified.length} unclassified lines`);
    if (on.has('--table')) {
      console.log(`\n--- night table (${nightName}) ---`);
      renderTable(nightTable(groups, nightName ?? '', hourName));
    }
    if (on.has('--clock')) {
      console.log(`\n--- clock (${hourName}) ---`);
      console.log(pyDumps(clock(groups, hourName ?? ''), 2));
    }
    if (on.has('--rolls')) {
      console.log('\n--- rolls ---');
      for (const roll of rolls(groups)) {
        console.log(`g${roll.group}: every ${roll.everyMs ?? 'None'} ms, Random(${roll.bound})+1 ${roll.op} ${roll.counter}`);
        for (const gate of roll.gates) console.log(`    gate: ${gate}`);
      }
    }
    if (graphObject) {
      console.log(`\n--- graph (${graphObject}) ---`);
      for (const edge of graph(groups, graphObject)) {
        const source = edge.from.map(s => (s.negated ? 'NOT ' : '') + s.target).join(', ') || '(unconditioned)';
        console.log(`g${edge.group}: ${source} -> ${edge.to}`);
        for (const branch of edge.branch) console.log(`    when: ${branch}`);
      }
    }
    if (on.has('--draws')) {
      console.log('\n--- draws ---');
      const forced = census.filter(draw => draw.forcedByTimer);
      const gated = census.filter(draw => draw.everyMs !== null);
      // Two different questions, and they rank the four games differently. "In a timer-gated group" is the loose
      // count -- how much of the sheet is on a clock at all. "Forced" is the count a seed model owes: draws with
      // nothing that can fail in front of them, consumed on every tick whatever happens.
      console.log(`${census.length} draw sites, ${gated.length} in a timer-gated group, ${forced.length} timer-forced`);
      for (const draw of census) console.log(`g${draw.group}: Random(${draw.bound}) [${draw.forcedByTimer ? 'FORCED' : 'cond'}, every ${draw.everyMs ?? 'None'} ms]`);
    }
    if (on.has('--movers')) {
      console.log('\n--- movers ---');
      for (const [name, count] of moving) console.log(`${pyAlign(String(count), 4, '>')}  ${name}`);
    }
    if (on.has('--graphs')) {
      console.log('\n--- graphs ---');
      for (const [name, edges] of exported) console.log(`${name}: ${edges.length} edges`);
    }
    if (on.has('--timers')) {
      console.log('\n--- timers ---');
      for (const [period, ids] of timers(groups)) {
        console.log(`${period} ms: ${ids.length} groups (${ids.slice(0, 8).map(String).join(', ')}${ids.length > 8 ? '...' : ''})`);
      }
    }
    if (on.has('--audit')) {
      console.log('\n--- audit ---');
      if (!unclassified.length) console.log('no unclassified lines');
      for (const [number, raw] of unclassified) console.log(`${number}: ${pyStrRepr(raw)}`);
    }
    return 0;
  } catch (error) {
    return pyExitStatus(error, console.error);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
