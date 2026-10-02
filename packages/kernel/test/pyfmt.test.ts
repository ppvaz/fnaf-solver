// pyFixed against Python's own format(x, '.Nf'): exact ties go to the even digit, and the sign of a
// negative value that rounds to zero is kept. pyRepr against repr(float), and pyDumps against json.dumps:
// its separators, escapes, indent and floats. Each expected string was printed by CPython 3.12.
import assert from 'node:assert/strict';
import { PyFloat, pyDumps, pyFixed, pyRepr } from '../src/pyfmt.ts';

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
console.log(`pyfmt: ${CASES.length} fixed, ${REPRS.length} repr and 4 json.dumps values print as Python prints them`);
