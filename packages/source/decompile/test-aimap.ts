#!/usr/bin/env node
// Check aimap.ts against a synthetic event sheet.
//
// The real Office sheet is extracted game content and cannot live here, so this builds a miniature dump in both
// accepted forms -- the canonical tabular one and the older rendered one -- with the same shapes the real table uses:
// the night-start zeroing group, per-night and per-hour sets, `<` and `>` night comparisons, a Random assignment, and
// the Custom Night dial copy.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applies, build, parse } from './aimap.ts';

const XOR = 28;
// Stored item-table handles; events address each of these as handle ^ XOR.
const STORED = new Map([
  ['night', 108], ['time of the night', 144], ['old Freddy AI', 109], ['Balloon Boy AI', 117], ['Sockpuppet AI', 118],
  ['Golden Freddy AI', 154], ['cust_BB AI', 161],
]);
const handle = (name: string) => String((STORED.get(name) ?? 0) ^ XOR);

const longExpression = (value: number) => `[0]ot=-1,num=0,oi=0,oil=0,loader=LongExp,value=${value}`;
/** `(Random(bound) + 1) / bound`, flattened the way the dumper writes it. */
const randomExpression = (bound: number) => [
  '[0]ot=-1,num=-1,oi=0,oil=0,loader=,value=null', '[1]ot=-1,num=1,oi=0,oil=0,loader=,value=null',
  `[2]ot=-1,num=0,oi=0,oil=0,loader=LongExp,value=${bound}`, '[3]ot=-1,num=-2,oi=0,oil=0,loader=,value=null',
  '[4]ot=0,num=2,oi=0,oil=0,loader=,value=null', '[5]ot=-1,num=0,oi=0,oil=0,loader=LongExp,value=1',
  '[6]ot=-1,num=-2,oi=0,oil=0,loader=,value=null', '[7]ot=0,num=8,oi=0,oil=0,loader=,value=null',
  `[8]ot=-1,num=0,oi=0,oil=0,loader=LongExp,value=${bound}`,
].join(' ; ');
const counterExpression = (name: string) => `[0]ot=7,num=80,oi=${handle(name)},oil=0,loader=,value=null`;
const condition = (name: string, operator: string, expression: string) => [' C', 'OT', '7', 'NUM', '-81', 'OI', handle(name), 'NAME', 'ignored',
  'OIL', '0', 'CFLAGS', '0', 'COTHER', '0', 'PARAMS', `23:ExpressionParameter:cmp=${operator} ${expression}`].join('\t');
const action = (name: string, expression: string) => [' A', 'OT', '7', 'NUM', '80', 'OI', handle(name), 'NAME', 'ignored', 'OIL', '0',
  'PARAMS', `22:ExpressionParameter:cmp== ${expression}`].join('\t');
const group = (index: number, conditions: string[], actions: string[]) =>
  [['GROUP', String(index), 'FLAGS', '0', 'RESTRICT', 'False', 'CONDS', String(conditions.length), 'ACTS', String(actions.length)].join('\t'),
    ...conditions, ...actions].join('\n');

function tabularSheet() {
  const lines = ['GAME\ttest\tBUILD\t296\tFRAMES\t1', 'OBJECTS'];
  for (const [name, stored] of STORED) lines.push(['OBJECT', String(stored), 'TYPE', '7', 'NAME', name, 'VALUES', '', 'STRINGS', ''].join('\t'));
  lines.push('FRAME\t0\t04-Office\tGROUPS\t6');
  // The night-start zeroing group: every night but Custom.
  lines.push(group(673, [condition('night', '!=', longExpression(7))],
    [action('old Freddy AI', longExpression(0)), action('Balloon Boy AI', longExpression(0)), action('Golden Freddy AI', longExpression(0))]));
  // Night 6, 12 AM and 2 AM: the second row overwrites only what it names.
  lines.push(group(683, [condition('night', '==', longExpression(6))],
    [action('old Freddy AI', longExpression(5)), action('Balloon Boy AI', longExpression(5)), action('Golden Freddy AI', randomExpression(10))]));
  lines.push(group(684, [condition('night', '==', longExpression(6)), condition('time of the night', '==', longExpression(2))],
    [action('old Freddy AI', longExpression(10)), action('Balloon Boy AI', longExpression(9))]));
  // Custom Night copies the dials.
  lines.push(group(787, [condition('night', '==', longExpression(7))], [action('Balloon Boy AI', counterExpression('cust_BB AI'))]));
  // Golden Freddy exists only from night 6 up; the Puppet is pinned above it.
  lines.push(group(804, [condition('night', '<', longExpression(6))], [action('Golden Freddy AI', longExpression(0))]));
  lines.push(group(815, [condition('night', '==', longExpression(1))], [action('Sockpuppet AI', longExpression(1))]));
  lines.push(group(821, [condition('night', '>', longExpression(6))], [action('Sockpuppet AI', longExpression(15))]));
  return `${lines.join('\n')}\n`;
}

const RENDERED_SHEET = `--- group 683 ---
IF\tnight -> CompareCounter (COMPARISON{= Long[6]})
DO\tBalloon Boy AI -> SetCounterValue (EXPRESSION{= Long[5]})
--- group 684 ---
IF\tnight -> CompareCounter (COMPARISON{= Long[6]})
IF\ttime of the night -> CompareCounter (COMPARISON{= Long[2]})
DO\tBalloon Boy AI -> SetCounterValue (EXPRESSION{= Long[9]})
--- group 815 ---
IF\tnight -> CompareCounter (COMPARISON{= Long[1]})
DO\tSockpuppet AI -> SetCounterValue (EXPRESSION{= Long[1]})
--- group 821 ---
IF\tnight -> CompareCounter (COMPARISON{> Long[6]})
DO\tSockpuppet AI -> SetCounterValue (EXPRESSION{= Long[15]})
`;

test('the AI table replays its night and hour groups, in both dump forms', () => {
  const directory = mkdtempSync(join(tmpdir(), 'test-aimap-'));
  try {
    const tabular = join(directory, 'events-android.txt');
    writeFileSync(tabular, tabularSheet());
    const nights = build(parse(tabular));
    const level = (night: number, hour: number, name: string) => nights.get(night)?.get(hour)?.get(name);

    assert.ok(level(6, 0, 'Balloon Boy') === 5n && level(6, 1, 'Balloon Boy') === 5n, 'night 6 carries 12 AM values into 1 AM');
    assert.ok(level(6, 2, 'Balloon Boy') === 9n && level(6, 6, 'Balloon Boy') === 9n, 'night 6 raises Balloon Boy at 2 AM');
    assert.equal(level(6, 2, 'old Freddy'), 10n, "an unnamed character keeps the earlier row's value");
    assert.equal(level(6, 0, 'Golden Freddy'), '1/10', 'a Random assignment reads as its probability');
    assert.equal(level(6, 2, 'Golden Freddy'), '1/10', 'the 2 AM row leaves Golden Freddy on the 12 AM roll');

    // The night comparison the old reader ignored: `<` and `>` were applied to every night, which zeroed Golden
    // Freddy on night 6 and pinned the Puppet at 15 on night 1.
    assert.ok([1, 2, 3, 4, 5].every(night => level(night, 6, 'Golden Freddy') === 0n), 'group 804 zeroes Golden Freddy below night 6');
    assert.equal(level(6, 0, 'Golden Freddy'), '1/10', 'group 804 leaves night 6 alone');
    assert.equal(level(1, 0, 'Sockpuppet'), 1n, 'group 821 does not reach night 1');
    assert.equal(level(7, 0, 'Sockpuppet'), 15n, 'group 821 pins the Puppet on Custom Night');

    assert.equal(level(7, 0, 'Balloon Boy'), 'dial', 'the zeroing group spares Custom Night');
    assert.equal(level(5, 0, 'Balloon Boy'), 0n, 'the zeroing group runs on every other night');

    const rendered = join(directory, '03-04-Office.txt');
    writeFileSync(rendered, RENDERED_SHEET);
    const renderedNights = build(parse(rendered));
    assert.ok(renderedNights.get(6)?.get(2)?.get('Balloon Boy') === 9n && renderedNights.get(1)?.get(0)?.get('Sockpuppet') === 1n,
      'the rendered form still parses');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('night comparisons hold as written, and an unknown one is refused', () => {
  const cases: [string, number, number, boolean][] = [
    ['=', 6, 6, true], ['==', 6, 7, false], ['<>', 6, 7, true], ['!=', 7, 7, false], ['<', 5, 6, true], ['<', 6, 6, false],
    ['>', 7, 6, true], ['>', 6, 6, false], ['<=', 6, 6, true], ['>=', 5, 6, false],
  ];
  for (const [operator, night, bound, expected] of cases) assert.equal(applies(operator, BigInt(bound), night), expected, `applies(${operator}, ${bound}, ${night})`);
  assert.throws(() => applies('~=', 1n, 1), RangeError, 'an unknown comparison must raise');
});
