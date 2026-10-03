// pyFixed against Python's own format(x, '.Nf'): exact ties go to the even digit, and the sign of a
// negative value that rounds to zero is kept. pyRepr against repr(float), and pyDumps against json.dumps:
// its separators, escapes, indent and floats. Each expected string was printed by CPython 3.12.
import assert from 'node:assert/strict';
import {
  PyFloat, pyDumps, pyFixed, pyFloat, pyFloatValue, pyInt, pyIntValue, pyKeyValues, pyPath, pyRegExp, pyRepr, pyRound, pySplit, pySplitLimit, pySplitLines,
} from '../src/pyfmt.ts';

const CASES: [number, number, string][] = [
  [0.125, 2, '0.12'], [0.375, 2, '0.38'], [2.5, 0, '2'], [3.5, 0, '4'], [-0.125, 2, '-0.12'], [-2.5, 0, '-2'],
  [0.0, 2, '0.00'], [-0.0, 2, '-0.00'], [5e-324, 3, '0.000'], [1e22, 1, '10000000000000000000000.0'],
  [123456789.125, 2, '123456789.12'], [0.005, 2, '0.01'], [1.005, 2, '1.00'], [2.675, 2, '2.67'], [0.125, 0, '0'],
  [1 / 3, 6, '0.333333'], [2 / 3, 2, '0.67'], [1000000000000000.5, 0, '1000000000000000'], [-1e-9, 2, '-0.00'],
  [999.995, 2, '1000.00'], [1440 / 11520, 2, '0.12'],
];
for (const [x, digits, want] of CASES) assert.equal(pyFixed(x, digits), want, `format(${x}, '.${digits}f')`);
assert.equal(pyFixed(0.125, 2) === (0.125).toFixed(2), false, 'the planted tie: toFixed rounds 0.125 up');
assert.deepEqual([pyFixed(NaN, 2), pyFixed(Infinity, 1), pyFixed(-Infinity, 0)], ['nan', 'inf', '-inf']);

const REPRS: [number, string][] = [
  [1.0, '1.0'], [-0.0, '-0.0'], [0.1, '0.1'], [0.1 + 0.2, '0.30000000000000004'], [1e16, '1e+16'],
  [9999999999999998.0, '9999999999999998.0'], [0.0001, '0.0001'], [1e-05, '1e-05'], [1.5e-07, '1.5e-07'],
  [123456.789, '123456.789'], [1e22, '1e+22'], [5e-324, '5e-324'], [1.7976931348623157e308, '1.7976931348623157e+308'],
  [1789512694330.005, '1789512694330.005'], [69.0, '69.0'],
];
for (const [x, want] of REPRS) assert.equal(pyRepr(x), want, `repr(${x})`);
assert.deepEqual([pyRepr(NaN), pyRepr(Infinity), pyRepr(-Infinity)], ['nan', 'inf', '-inf']);

// A whole float is marked (PyFloat); an unmarked whole number is an int.
assert.equal(pyDumps({ schema: 'office-seed-bracket-v1', candidates: 14, low16: [47592, 47605],
  beforeOnsetMs: [new PyFloat(69), new PyFloat(82)], status: null, ok: true }),
'{"schema": "office-seed-bracket-v1", "candidates": 14, "low16": [47592, 47605], "beforeOnsetMs": [69.0, 82.0], "status": null, "ok": true}');
assert.equal(pyDumps('tab\t e\u00e9 del\u007f \u{1F600}'), '"tab\\t e\\u00e9 del\\u007f \\ud83d\\ude00"', 'ensure_ascii escapes DEL and past');
assert.equal(pyDumps({ pid: '6690', outputs: [{ tracks: [], kind: 'fast' }], empty: {} }, 1),
  '{\n "pid": "6690",\n "outputs": [\n  {\n   "tracks": [],\n   "kind": "fast"\n  }\n ],\n "empty": {}\n}');
assert.equal(pyDumps([NaN, Infinity, -Infinity, new PyFloat(2)]), '[NaN, Infinity, -Infinity, 2.0]');
// str(PurePosixPath(text)), printed by CPython 3.12.
const PATHS: [string, string][] = [['', '.'], ['./', '.'], ['/', '/'], ['//', '//'], ['///', '/'], ['////a', '/a'], ['a/', 'a'],
  ['a//b', 'a/b'], ['a/./b', 'a/b'], ['a/../b', 'a/../b'], ['//a//b/', '//a/b'], ['/./a/.', '/a']];
for (const [text, want] of PATHS) assert.equal(pyPath(text), want, `str(Path(${JSON.stringify(text)}))`);
// str.split(), str.splitlines(), float() and round(), against CPython 3.12: Python's whitespace takes
// 0x1c-0x1f and NEL and not U+FEFF; float() reads a non-ASCII digit or space but refuses 0x1f; round()
// takes a half to the even integer.
assert.deepEqual(pySplit(' a\x1cb\x85c\ufeffd '), ['a', 'b', 'c\ufeffd']);
assert.deepEqual(pySplitLines('a\r\nb\x0bc\u2028d\n'), ['a', 'b', 'c', 'd']);
assert.deepEqual([pyFloat('1_0.5'), pyFloat(' \u0662.5\u3000'), pyFloat('-inf')], [10.5, 2.5, -Infinity]);
assert.deepEqual([pyFloat('\x1f2'), pyFloat('0x10'), pyFloat('1__0')], [null, null, null], 'ValueError in Python');
assert.deepEqual([0.5, 1.5, 2.5, -2.5, 1789512694248.5].map(pyRound), [0, 2, 2, -2, 1789512694248]);
assert.deepEqual([pyRound(NaN), pyRound(Infinity)], [null, null], 'ValueError and OverflowError in Python');
// int() in base 10 and 16, as a bigint; json.dumps(sort_keys=True) orders keys by code point (an astral
// character after U+FFFF, where UTF-16 order puts it before) and prints an int past 2**53 whole.
assert.deepEqual([pyInt('0x_1F', 16), pyInt(' +0_7 '), pyInt('-ff', 16), pyInt('\u0661\u0662')], [31n, 7n, -255n, 12n]);
assert.deepEqual([pyInt('0x', 16), pyInt('_1'), pyInt('1__2'), pyInt('1.0'), pyInt('0x1')], [null, null, null, null, null], 'ValueError in Python');
assert.equal(pyDumps({ b: 1, '\u{1F600}': 2, '\uffff': 3, a: { d: 4, c: 5 } }, undefined, { sortKeys: true }),
  '{"a": {"c": 5, "d": 4}, "b": 1, "\\uffff": 3, "\\ud83d\\ude00": 2}');
assert.equal(pyDumps(1n << 70n), '1180591620717411303424');
// pyRegExp: each pattern searched in each text as CPython's re searched it (re.I where the pattern names groups).
const searches: [string, string, string[] | null][] = [
  ["^Long\\[(\\d+)\\]$", "Long[\u0664\u0662]\n", ["Long[\u0664\u0662]", "\u0664\u0662"]],
  ["\\bseq=(0x[0-9a-f]+)\\b", "xseq=0x1 seq=0x2", ["seq=0x2", "0x2"]],
  ["a.c", "a\u2028c", ["a\u2028c"]],
  ["a.c", "a\nc", null],
  ["value=(?P<v>-?[\\d.]+)", "value=\u0661.5", ["value=\u0661.5", "\u0661.5"]],
  ["IF\\s+night", "IF\u001fnight", ["IF\u001fnight"]],
  ["IF\\s+night", "IF\ufeffnight", null],
  ["(\\S+) Long", "x\u001f< Long", ["< Long", "<"]],
  ["\\bAI$", "Golden Freddy AI", ["AI"]],
  ["\\bAI$", "XAI", null],
  ["(?:\\bg|\\bgroups?\\s*)(\\d{2,4})", "see \u017fee group 413", ["group 413", "413"]],
  ["[^\\]]+\\]", "ab]", ["ab]"]],
  ["\\w+", "\u00e9_1x", ["\u00e9_1x"]],
  ["\\W", "ab-c", ["-"]],
  ["\\Bb", "ab", ["b"]],
  ["\\D+", "12ab3", ["ab"]],
];
for (const [pattern, text, want] of searches) {
  const match = pyRegExp(pattern, pattern.includes('groups') ? 'i' : '').exec(text);
  assert.deepEqual(match ? [...match] : null, want, `${pattern} in ${JSON.stringify(text)}`);
}

// str.split with a limit, dict() over KEY=VALUE pairs, and int() and float() with their ValueError, as CPython gives them.
assert.deepEqual([pySplitLimit('a:b:c', ':', 1), pySplitLimit('abc', ':', 1), pySplitLimit('a::', ':', 2)], [['a', 'b:c'], ['abc'], ['a', '', '']]);
assert.deepEqual([...pyKeyValues(['k=v=w', 'x='])], [['k', 'v=w'], ['x', '']]);
assert.throws(() => pyIntValue('x'), { message: "invalid literal for int() with base 10: 'x'" });
assert.throws(() => pyFloatValue('x'), { message: "could not convert string to float: 'x'" });

console.log(`pyfmt: ${CASES.length} fixed, ${REPRS.length} repr, 6 json.dumps and ${PATHS.length} path values print as Python prints them, and split, splitlines, float, int and round read as Python reads; ${searches.length} patterns search as re does`);
