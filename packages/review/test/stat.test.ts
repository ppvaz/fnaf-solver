// Contract tests for the repository's small statistical helper. Its Python twin, stat.py, had
// no caller and was removed on 2026-10-02 (unforced Python, CLAUDE.md "Types").
import assert from 'node:assert/strict';
import {
  DEFAULT_Z, contractVerdict, formatRate, requiredN,
  twoProportionTest, wilsonInterval,
} from '../src/stat.ts';


const edge = wilsonInterval(0, 10);
assert.equal(edge.low, 0);
assert(edge.high > 0 && edge.high < 1);
const full = wilsonInterval(10, 10);
assert(full.high <= 1 && full.high > 0.99);
assert(full.low > 0 && full.low < 1);

const interval = wilsonInterval(648, 1200);
assert(Math.abs(interval.rate - 0.54) < 1e-12);
assert(interval.low < interval.rate && interval.rate < interval.high);
assert(interval.high - interval.low < 0.06);

const need = requiredN(0.5, 0.05);
assert.equal(need, 381);
assert(requiredN(0, 0.05) > 1);
assert(requiredN(1, 0.05) > 1);

const pass = contractVerdict(900, 1000, 0.4);
assert.equal(pass.status, 'PASS');
assert(pass.ok && pass.low >= 0.4);
const fail = contractVerdict(100, 1000, 0.4);
assert.equal(fail.status, 'FAIL');
assert(!fail.ok && fail.high < 0.4);
const inconclusive = contractVerdict(4, 10, 0.4);
assert.equal(inconclusive.status, 'INCONCLUSIVE');
assert(!inconclusive.ok);

const same = twoProportionTest(50, 100, 50, 100);
assert.equal(same.z, 0);
assert(Math.abs(same.pValue - 1) < 1e-7);
const different = twoProportionTest(80, 100, 50, 100);
assert(different.z > 0 && different.pValue < 0.001);
assert.match(formatRate(648, 1200), /^rate 54\.0% \[[0-9.]+%, [0-9.]+%\] n=1200$/);

assert(DEFAULT_Z > 1.95 && DEFAULT_Z < 1.97);

console.log('stat checks passed');
