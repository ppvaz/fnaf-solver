#!/usr/bin/env node
// Check nightmap.ts against a synthetic event sheet.
//
// The real sheets are extracted game content and cannot live here, so this builds a miniature one carrying the
// shapes all four games actually use, plus the shapes that were *nearly* misread while writing the reader:
//
//   - a night-gated difficulty row, with and without an hour,
//   - `Add` as well as `Set`, since FNaF 4 escalates by adding,
//   - both operand orders of `base + Random(bound)`, because FNaF 1 writes `Long[1] Plus Random Long[2]` and FNaF 4
//     writes `Random Long[4] EndParenthesis Plus Long[2]` for the same shape, and matching only one reports the
//     other as an exotic expression,
//   - `(Random(D) + 1) / D`, the one-in-D form,
//   - a counter-valued assignment (`AI = night number - 1`), which is the whole of FNaF 3's difficulty table,
//   - an accumulator clock built on an **alterable value** rather than a counter, which is FNaF 2's and which a
//     counter-only search misses in silence,
//   - a movement roll and a movement edge,
//   - a line the reader cannot classify, so that `--audit` is shown to report rather than to swallow.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clock, draws, graph, nightTable, parse, rolls, timers } from './nightmap.ts';

const SHEET = `FRAME 03: 04-Office
==========================================

--- group 10 ---
  IF   night number -> CompareCounter (COMPARISON{= Long[2]})
  IF   NotAlways
  DO   bonnie activity -> SetCounterValue (EXPRESSION{= Long[3]})
  DO   freddy activity -> SetCounterValue (EXPRESSION{= Long[1] Plus Random Long[2] EndParenthesis})

--- group 11 ---
  IF   night number -> CompareCounter (COMPARISON{= Long[2]})
  IF   time of day -> CompareCounter (COMPARISON{= Long[3]})
  IF   NotAlways
  DO   bonnie activity -> AddCounterValue (EXPRESSION{= Long[2]})
  DO   force Chica -> SetCounterValue (EXPRESSION{= Random Long[3] EndParenthesis Plus Long[3]})

--- group 12 ---
  IF   night number -> CompareCounter (COMPARISON{>= Long[6]})
  DO   Golden Freddy AI -> SetCounterValue (EXPRESSION{= Parenthesis Parenthesis Random Long[10] EndParenthesis Plus Long[1] EndParenthesis Divide Long[10]})
  DO   AI -> SetCounterValue (EXPRESSION{= CounterValue[night number] Minus Long[1]})

--- group 13 ---
  IF   CompareGlobalValueIntEqual (GlobalValue{isExpression=False value=3}, COMPARISON{= Long[0]})
  IF   Every (TIME{isExpression=False loops=0 timer=1000}, BUFFER4{isExpression=False value=0})
  DO   AM -> AddToAlterable (AlterableValue{isExpression=False value=0}, EXPRESSION{= Long[1]})

--- group 14 ---
  IF   AM -> CompareAlterableValue (AlterableValue{isExpression=False value=0}, COMPARISON{>= Long[70]})
  IF   time of day -> CompareCounter (COMPARISON{<> Long[12]})
  DO   AM -> SetAlterableValue (AlterableValue{isExpression=False value=0}, EXPRESSION{= Long[0]})
  DO   time of day -> AddCounterValue (EXPRESSION{= Long[1]})

--- group 15 ---
  IF   time of day -> CompareCounter (COMPARISON{= Long[6]})
  IF   NotAlways
  DO   JumpToFrame (FRAME{isExpression=False value=4})

--- group 16 ---
  IF   Every (TIME{isExpression=False loops=0 timer=4970}, BUFFER4{isExpression=False value=0})
  IF   Compare (EXPRESSION{= Random Long[20] EndParenthesis Plus Long[1]}, COMPARISON{<= CounterValue[bonnie activity]})
  IF   viewing -> CompareCounter (COMPARISON{= Long[0]})
  DO   move who? -> SetCounterValue (EXPRESSION{= Long[1]})

--- group 17 ---
  IF   move who? -> CompareCounter (COMPARISON{= Long[1]})
  IF   charBonnie.Active -> IsOverlapping (OBJECT{isExpression=False objectInfo=75 objectInfoList=0 objectType=2 objectInfo->cam1A.Active})
  IF   charBonnie.Active -> CompareAlterableValue (AlterableValue{isExpression=False value=0}, COMPARISON{= Long[2]})
  DO   charBonnie.Active -> SetPosition (POSITION{angle=0 direction=0 isExpression=False layer=0 objectInfoList=0 objectInfoParent=76 slope=0 typeParent=2 x=0 y=0 objectInfoParent->cam1B.Active})

this line belongs to no group and must be reported
`;

test('the night table, clock, rolls, graph and draw census read off a synthetic sheet', () => {
  const [groups, unclassified] = parse(SHEET);
  assert.equal(groups.length, 8, 'group count');
  assert.equal(unclassified.length, 1, 'the stray line is audited, not swallowed');
  assert.ok(unclassified[0][1].includes('belongs to no group'), 'the audit reports the line itself');

  // --- the difficulty table
  const table = nightTable(groups, 'night number', 'time of day');
  assert.equal(table.length, 3, 'table rows');
  let row = table[0];
  assert.equal(row.group, 10n, 'row cites its group');
  assert.deepEqual(row.hour, [], 'a row with no hour compare fires at night start');
  assert.deepEqual(row.night, [{ op: '=', value: 2n }], 'night comparison is kept verbatim');
  assert.deepEqual(row.sets[0], { counter: 'bonnie activity', verb: 'Set', value: { kind: 'literal', value: 3n } }, 'a literal set reads as a literal');
  assert.deepEqual(row.sets[1].value, { kind: 'range', min: 1n, max: 2n, base: 1n, bound: 2n }, '`Long[base] Plus Random Long[bound]` reads as a range');

  row = table[1];
  assert.deepEqual(row.hour, [{ op: '=', value: 3n }], 'an hour compare is carried');
  assert.equal(row.sets[0].verb, 'Add', 'Add is distinguished from Set');
  assert.deepEqual(row.sets[1].value, { kind: 'range', min: 3n, max: 5n, base: 3n, bound: 3n }, '`Random Long[bound] Plus Long[base]` reads as the same range');

  row = table[2];
  assert.deepEqual(row.night, [{ op: '>=', value: 6n }], '`>=` is kept, not expanded');
  assert.deepEqual(row.sets[0].value, { kind: 'oneIn', n: 10n }, '(Random(D)+1)/D reads as one-in-D');
  assert.deepEqual(row.sets[1].value, { kind: 'counter', counter: 'night number', offset: -1n }, 'a counter-valued set reads as a counter with an offset');

  // Nothing in a table may read UNKNOWN silently; the shapes above are the complete set the four sheets use.
  assert.deepEqual(table.flatMap(r => r.sets).filter(write => write.value.kind === 'UNKNOWN'), [], 'no expression is left unread');

  // --- the clock, on an alterable-value accumulator
  const night = clock(groups, 'time of day');
  assert.deepEqual(night.minuteSources, ['AM[0]'], 'the minute source is found even as an alterable value');
  assert.equal(night.minuteTicks.length, 1, 'the tick is found');
  assert.deepEqual(night.minuteTicks[0].timers, [1000n], "the tick's period");
  assert.equal(night.hourAdvance.length, 1, 'the hour advance is found');
  assert.equal(night.hourAdvance[0].whenAlterable[0].value.value, 70.0, 'the advance threshold comes off the alterable compare');
  assert.deepEqual(night.leavesFrame[0].at, [{ op: '=', value: 6n }], 'leaving the frame is reported with the hour it fires at');
  assert.ok('frameHandle' in night.leavesFrame[0], 'the jump target is labelled a handle, not an index');

  // --- rolls
  const found = rolls(groups);
  assert.equal(found.length, 1, 'one roll');
  assert.equal(found[0].everyMs, 4970n, 'roll period');
  assert.equal(found[0].bound, 20n, 'roll bound');
  assert.equal(found[0].counter, 'bonnie activity', 'roll counter');
  assert.equal(found[0].gates.length, 1, "a roll's remaining conditions are kept as gates");

  // --- the movement graph
  const edges = graph(groups, 'charBonnie');
  assert.equal(edges.length, 1, 'one edge');
  assert.deepEqual(edges[0].from, [{ target: 'cam1A.Active', negated: false }], 'edge source');
  assert.equal(edges[0].to, 'cam1B.Active', 'edge target');
  assert.ok(edges[0].branch.some(branch => branch.includes('value=0')), 'the branch condition is kept verbatim');

  // --- the draw census
  const census = draws(groups);
  const forced = census.filter(draw => draw.forcedByTimer);
  assert.equal(census.length, 4, 'every Random is counted');
  // g16's roll is `Every 4970 ms` + the Random comparison itself, and the comparison is the first condition that can
  // fail -- so the timer forces that draw even though the group also tests `viewing`, which comes after.
  assert.equal(forced.length, 1, 'a timer-forced condition draw is reported as forced');
  assert.equal(forced[0].group, 16n, 'the forced draw is the roll');
  assert.equal(forced[0].bound, 20n, 'its bound');
  assert.equal(forced[0].conditionsBefore, 0, 'nothing that can fail precedes it');
  assert.equal(census.filter(draw => draw.group === 10n)[0].forcedByTimer, false, 'a night-start draw is not timer-forced');

  assert.deepEqual([...timers(groups).keys()].sort(), ['1000', '4970'], 'timers are collected');
});
