#!/usr/bin/env node
// Map every character's AI level, per hour and night, from the event sheet.
//
// Two input forms are accepted. The canonical one is the tabular `events-android.txt` that
// `packages/source/decompile/regen-dump.sh` produces and `readdump.ts` reads; the older CTFAK-rendered
// `03-04-Office.txt` is still parsed for archived sheets. Either way the relevant groups carry a night comparison,
// an optional hour comparison, and `<name> AI` counter writes.
//
// Levels carry forward within a night: group 673 zeroes every counter on any night but Custom Night, then each
// night/hour group overwrites only the characters it names.
//
//   packages/source/decompile/aimap.ts [path/to/events-android.txt]
//   packages/source/decompile/aimap.ts --json
//
// `$FNAF2_DUMP` (canonical) or `$FNAF2_OFFICE_DUMP` (rendered sheet) selects the input. Either file is extracted
// game content and stays outside the repository.
//
// Ported from aimap.py: it reads, prints and exits as that did. Levels are bigints, as Python's ints are.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type PyJson, pyAlign, pyArgs, pyDumps, pyPath, pyReadText, pyRegExp, pySplitLines, pyStrRepr, pyStrip } from '@sixam/kernel/py';
import { Dump, at, cells, int } from './readdump.ts';

const DEFAULT = process.env.FNAF2_OFFICE_DUMP || process.env.FNAF2_DUMP || '/private/tmp/fnaf2-android-dump/events-android.txt';

// The patterns are Python's, read as re read them (pyRegExp).
// --- the rendered `03-04-Office.txt` form
const GROUP = pyRegExp(String.raw`^--- group (\d+) ---`);
const NIGHT = pyRegExp(String.raw`IF\s+night -> CompareCounter \(COMPARISON\{(\S+) Long\[(\d+)\]\}`);
const HOUR = pyRegExp(String.raw`IF\s+time of the night -> CompareCounter \(COMPARISON\{= Long\[(\d+)\]\}`);
const SET = pyRegExp(String.raw`DO\s+(.+?) AI -> SetCounterValue \(EXPRESSION\{= (.+?)\}\)`);
const LONG = pyRegExp(String.raw`^Long\[(\d+)\]$`);
// (Random(D) + 1) / D uses integer division, so it is one only on D-1.
const RAND = pyRegExp(String.raw`Parenthesis Random Long\[(\d+)\] EndParenthesis Plus Long\[1\] EndParenthesis Divide Long\[(\d+)\]`);
const CUSTOM = pyRegExp(String.raw`CounterValue\[cust_(.+?) AI\]`);

// --- the canonical tabular form
// One flattened expression item, as EventTextDumper renders it.
const ITEM = pyRegExp(String.raw`^\[(?P<index>\d+)\]ot=(?P<ot>-?\d+),num=(?P<num>-?\d+),oi=(?P<oi>-?\d+),oil=(?P<oil>-?\d+),loader=(?P<loader>[^,]*),value=(?P<value>.*)$`);
// Counter compare and counter set: the two condition/action ids this reads.
const COMPARE_COUNTER = -81n;
const SET_COUNTER = 80n;
const COUNTER_OT = 7n;

export const NAMES = [
  'old Freddy', 'old Bonnie', 'old Chica', 'old Foxy',
  'new Freddy', 'new Bonnie', 'new Chica', 'new Foxy',
  'Balloon Boy', 'Sockpuppet', 'Paperpals', 'Golden Freddy',
];
// Post-XOR, the dump's old/new names are Withered/Toy; new Foxy is Mangle.
const PRETTY = new Map([
  ['old Freddy', 'W. Freddy'], ['old Bonnie', 'W. Bonnie'], ['old Chica', 'W. Chica'], ['old Foxy', 'W. Foxy'],
  ['new Freddy', 'Toy Freddy'], ['new Bonnie', 'Toy Bonnie'], ['new Chica', 'Toy Chica'], ['new Foxy', 'Mangle'],
  ['Balloon Boy', 'BB'], ['Sockpuppet', 'Puppet'], ['Paperpals', 'PaperPals'], ['Golden Freddy', 'G. Freddy'],
]);

/** A level: an int, `1/N` for a Random roll, `dial` for a Custom Night copy, or the expression it could not read. */
export type Level = bigint | string;
export interface Group { id: bigint, night: bigint | null, nightOp: string | null, hour: bigint | null, sets: [string, Level][] }
type Item = Record<'index' | 'ot' | 'num' | 'oi' | 'oil' | 'loader' | 'value', string>;

/** Read one rendered-sheet assignment. */
export function value(expression: string): Level {
  const literal = LONG.exec(expression);
  if (literal) return int(literal[1]);
  const random = RAND.exec(expression);
  if (random && random[1] === random[2]) return `1/${int(random[1])}`;
  // Night 7 copies the Custom Night dials rather than a fixed table.
  if (CUSTOM.test(expression)) return 'dial';
  return expression;
}

export function parseRendered(path: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  for (const line of pySplitLines(pyReadText(readFileSync(path), 'replace'))) {
    const header = GROUP.exec(line);
    if (header) {
      current = { id: int(header[1]), night: null, nightOp: null, hour: null, sets: [] };
      groups.push(current);
      continue;
    }
    if (current === null) continue;
    const night = NIGHT.exec(line);
    if (night) [current.nightOp, current.night] = [night[1], int(night[2])];
    const hour = HOUR.exec(line);
    if (hour) current.hour = int(hour[1]);
    const set = SET.exec(line);
    if (set) current.sets.push([pyStrip(set[1]), value(pyStrip(set[2]))]);
  }
  return groups;
}

/** str.partition(separator). */
const partition = (text: string, separator: string): [string, string, string] => {
  const cut = text.indexOf(separator);
  return cut < 0 ? [text, '', ''] : [text.slice(0, cut), separator, text.slice(cut + separator.length)];
};

/** Each ExpressionParameter in a PARAMS field, as [operator, items]. */
export function expressions(params: string): [string, Item[]][] {
  const out: [string, Item[]][] = [];
  for (const chunk of params.split(' || ')) {
    const [, , rest] = partition(chunk, ':');
    const [kind, , body] = partition(rest, ':');
    if (kind !== 'ExpressionParameter') continue;
    const [operator, , rendered] = partition(body, ' ');
    const items: Item[] = [];
    for (const text of rendered.split(' ; ')) {
      const groups = ITEM.exec(pyStrip(text))?.groups;
      if (groups) {
        items.push({ index: groups.index, ot: groups.ot, num: groups.num, oi: groups.oi, oil: groups.oil, loader: groups.loader, value: groups.value });
      }
    }
    out.push([[...operator].slice('cmp='.length).join(''), items]);
  }
  return out;
}

/** Read one tabular assignment from its flattened expression items. */
export function tabularValue(items: readonly Item[], dump: Dump): Level {
  const longs = items.filter(item => item.loader === 'LongExp').map(item => int(item.value));
  if (items.length === 1 && items[0].loader === 'LongExp') return longs[0];
  // (Random(D) + 1) / D: integer division makes this one only on D-1.
  if (items.some(item => item.ot === '-1' && item.num === '1')) {
    if (longs.length === 3 && longs[0] === longs[2] && longs[1] === 1n) return `1/${longs[0]}`;
  }
  for (const item of items) {
    if (int(item.ot) === COUNTER_OT) {
      const name = dump.name(int(item.oi));
      // Night 7 copies the Custom Night dials rather than a fixed table.
      return name.startsWith('cust_') ? 'dial' : name;
    }
  }
  return items.map(item => item.value).join(' ');
}

export function parseTabular(path: string, xor = 28n): Group[] {
  const dump = new Dump(path, xor);
  const office = dump.frames.find(frame => frame.name.endsWith('Office'));
  if (office === undefined) throw new RangeError('StopIteration: no frame named ...Office');
  return office.groups.map(group => {
    const entry: Group = { id: group.idx, night: null, nightOp: null, hour: null, sets: [] };
    for (const line of group.lines) {
      const field = line.split('\t');
      const kind = pyStrip(field[0]);
      const cell = cells(field);
      if (int(cell.get('OT') ?? '0') !== COUNTER_OT) continue;
      const name = dump.name(int(cell.get('OI') ?? '0'));
      const cut = line.indexOf('PARAMS\t');
      const params = cut < 0 ? '' : line.slice(cut + 'PARAMS\t'.length);
      const expression = expressions(params)[0];
      if (expression === undefined) continue;
      const [operator, items] = expression;
      if (kind === 'C' && int(cell.get('NUM') ?? '0') === COMPARE_COUNTER) {
        if (name === 'night') [entry.nightOp, entry.night] = [operator, int(at(items, 0).value)];
        else if (name === 'time of the night') entry.hour = int(at(items, 0).value);
      } else if (kind === 'A' && int(cell.get('NUM') ?? '0') === SET_COUNTER) {
        if (name.endsWith(' AI') && !name.startsWith('cust_')) entry.sets.push([name.slice(0, -' AI'.length), tabularValue(items, dump)]);
      }
    }
    return entry;
  });
}

export function parse(path: string, xor = 28n): Group[] {
  const tabular = pyReadText(readFileSync(path), 'replace').startsWith('GAME\t');
  const groups = tabular ? parseTabular(path, xor) : parseRendered(path);
  return groups.filter(group => group.sets.length && group.night !== null);
}

/** Does a group's night comparison hold for this night?
 *
 *  Both dump forms carry `<` and `>` comparisons -- group 804 zeroes Golden Freddy below night 6, group 821 pins
 *  the Puppet above it -- so a reader that only understands `=`/`<>` silently applies them to every night. */
export function applies(operator: string | null, bound: bigint | null, night: number): boolean {
  const at = BigInt(night);
  const limit = bound ?? 0n;
  if (operator === '=' || operator === '==') return at === bound;
  if (operator === '<>' || operator === '!=') return at !== bound;
  if (operator === '<') return at < limit;
  if (operator === '>') return at > limit;
  if (operator === '<=') return at <= limit;
  if (operator === '>=') return at >= limit;
  throw new RangeError(`unknown night comparison ${operator === null ? 'None' : pyStrRepr(operator)}`);
}

/** Replay the table groups, in group order, for nights 1 through 7: night -> hour -> name -> level. */
export function build(groups: readonly Group[]): Map<number, Map<number, Map<string, Level>>> {
  const nights = new Map<number, Map<number, Map<string, Level>>>();
  for (let night = 1; night < 8; night += 1) {
    const levels = new Map<string, Level>(NAMES.map(name => [name, 0n]));
    const perHour = new Map<number, Map<string, Level>>();
    for (let hour = 0; hour < 7; hour += 1) {
      for (const group of groups) {
        if (!applies(group.nightOp, group.night, night)) continue;
        // A group with no hour condition fires at the start of the night.
        if ((group.hour ?? 0n) !== BigInt(hour)) continue;
        for (const [name, level] of group.sets) if (levels.has(name)) levels.set(name, level);
      }
      perHour.set(hour, new Map(levels));
    }
    nights.set(night, perHour);
  }
  return nights;
}

function main(argv: readonly string[]): number {
  const args = pyArgs(argv, 'aimap.ts', [{ name: '--xor', type: 'int' }, { name: '--json', takes: 'flag' }], [{ name: 'path', optional: true }]);
  if ('exit' in args) {
    (args.exit ? console.error : console.log)(args.text);
    return args.exit;
  }
  const xorText = args.options['--xor'];
  const path = pyPath(args.positionals[0] ?? DEFAULT);
  if (!existsSync(path)) {
    console.error(`no event sheet at ${path} -- see docs/android/SOURCE-DUMP-GUIDE.md`);
    return 1;
  }
  const nights = build(parse(path, typeof xorText === 'string' ? int(xorText) : 28n));
  if (args.options['--json'] === true) {
    const json = new Map<string, PyJson>([...nights].map(([night, perHour]) => [String(night),
      new Map<string, PyJson>([...perHour].map(([hour, levels]) => [String(hour), new Map<string, PyJson>(levels)]))]));
    console.log(pyDumps(json, 2));
    return 0;
  }
  console.log('AI level by hour, from the Office event sheet.');
  console.log('Hour 0 is 12 AM; a value repeats until a later group overwrites it.');
  console.log('"1/N" is `(Random(N)+1)/N` with integer division: one with probability 1/N, otherwise zero.\n');
  const hours = [0, 1, 2, 3, 4, 5, 6];
  for (let night = 1; night < 8; night += 1) {
    console.log(`=== ${night === 7 ? '10/20 (Custom)' : `Night ${night}`} ===`);
    console.log(`character   ${hours.map(hour => pyAlign(String(hour), 8, '>')).join('')}`);
    console.log(`            ${hours.map(hour => pyAlign(hour === 0 ? '12AM' : `${hour}AM`, 8, '>')).join('')}`);
    const perHour = nights.get(night) ?? new Map<number, Map<string, Level>>();
    for (const name of NAMES) {
      const row = hours.map(hour => perHour.get(hour)?.get(name) ?? 0n);
      if (row.every(level => level === 0n)) continue;
      console.log(pyAlign(PRETTY.get(name) ?? name, 12) + row.map(level => pyAlign(String(level), 8, '>')).join(''));
    }
    console.log();
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
