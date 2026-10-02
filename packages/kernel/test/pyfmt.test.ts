// pyFixed against Python's own format(x, '.Nf'): exact ties go to the even digit, and the sign of a
// negative value that rounds to zero is kept. Each expected string was printed by CPython 3.12.
import assert from 'node:assert/strict';
import { pyFixed } from '../src/pyfmt.ts';

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
console.log(`pyfmt: ${CASES.length} values print as Python prints them, exact ties to even`);
