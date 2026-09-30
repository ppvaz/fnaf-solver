// Cross-language contract tests for the repository's small statistical helper.
// The Python twin is intentionally exercised as a process, so drift between
// the two gate/report implementations cannot hide behind two unit suites.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_Z, contractVerdict, formatRate, requiredN,
  twoProportionTest, wilsonInterval,
} from '../src/stat.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

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

const py = spawnSync('python3', ['-c', `
import json
import importlib.util
spec = importlib.util.spec_from_file_location("fnaf_stat", "stat.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
contract_verdict = module.contract_verdict
required_n = module.required_n
two_proportion_test = module.two_proportion_test
wilson_interval = module.wilson_interval
result = contract_verdict(648, 1200, 0.4)
print(json.dumps({
  "low": result["low"], "high": result["high"],
  "status": result["status"], "required": required_n(0.5, 0.05),
  "p": two_proportion_test(80, 100, 50, 100)["p_value"],
  "edge": wilson_interval(0, 10)["high"],
}))
`], { cwd: HERE, encoding: 'utf8' });
assert.equal(py.status, 0, py.stderr);
const twin = JSON.parse(py.stdout);
assert.equal(twin.status, contractVerdict(648, 1200, 0.4).status);
assert.equal(twin.required, need);
assert(Math.abs(twin.low - interval.low) < 1e-12);
assert(Math.abs(twin.high - interval.high) < 1e-12);
assert(Math.abs(twin.p - different.pValue) < 1e-7);
assert(Math.abs(twin.edge - edge.high) < 1e-12);
assert(DEFAULT_Z > 1.95 && DEFAULT_Z < 1.97);

console.log('stat checks passed');
