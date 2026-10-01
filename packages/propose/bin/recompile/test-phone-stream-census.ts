#!/usr/bin/env node
// FIXTURE for phone-stream-census.ts's decision rule, then docs/evidence/full06-stream-census-20261001.json re-derived
// from its own rows and the committed predeclaration. Needs no model run, frame trace or press file. In `npm run test:unit`.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './phone-stream-census.ts';
import { chiSquare, missExpectation, tally } from './phone-occupancy-rates.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (path) => readFileSync(join(ROOT, path));
const json = (path) => JSON.parse(read(path).toString('utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rule = { identifyMinPrefix: 20, identifyMarginWindows: 4 };
const row = (state, prefix, agree = prefix) => ({ state, prefix, agree });

// --- the rule
assert.equal(decide(rule, 7, [row(1, 30), row(2, 25), row(7, 6)]).verdict, 'IDENTIFIED');
assert.equal(decide(rule, 7, [row(1, 30), row(2, 27), row(7, 6)]).verdict, 'INCONCLUSIVE', 'a lead under four windows is not identification');
assert.equal(decide(rule, 7, [row(1, 19), row(7, 6)]).verdict, 'INCONCLUSIVE', 'a prefix under 20 is not identification');
assert.equal(decide(rule, 7, [row(7, 30), row(1, 30)]).verdict, 'MEASURED_SEED_BEST', 'the measured seed tying the top is its best');
assert.equal(decide(rule, 7, [row(7, 31), row(1, 20)]).verdict, 'MEASURED_SEED_BEST');
assert.equal(decide(rule, 7, []).verdict, 'INCONCLUSIVE');

// --- the full-06 record
const rec = json('docs/evidence/full06-stream-census-20261001.json');
const pre = json(rec.predeclaration.path);
assert.equal(rec.predeclaration.sha256, sha256(read(rec.predeclaration.path)), 'the predeclaration is the committed one');
assert.deepEqual(rec.inputs, pre.inputs, 'the census ran on the predeclared inputs');
const rows = rec.stage2.rows.split(' ').map((r) => { const [state, prefix, agree, compared] = r.split(',').map(Number); return { state, prefix, agree, compared }; });
assert.equal(rows.length, rec.stage2.states);
const hist = rec.stage1.prefixHistogram;
assert.equal(Object.values(hist).reduce((a, b) => a + b, 0), 65536, 'stage 1 played every start state');
assert.equal(Object.entries(hist).filter(([k]) => Number(k) >= pre.decisionRule.stage2MinPrefix).reduce((a, [, v]) => a + v, 0) +
  (rec.stage1.measuredSeed.prefix < pre.decisionRule.stage2MinPrefix ? 1 : 0), rows.length, 'stage 2 is every state at the floor, plus the measured seed');
assert.equal(rec.stage1.atLeastMeasured, Object.entries(hist).filter(([k]) => Number(k) >= rec.stage1.measuredSeed.prefix).reduce((a, [, v]) => a + v, 0));
const decision = decide(pre.decisionRule, rec.measuredSeed, rows);
assert.deepEqual(decision, rec.decision);
assert.equal(rec.verdict, decision.verdict);
assert.equal(decision.verdict, 'INCONCLUSIVE');

// exploratory: start states a few LCG steps from the measured seed, and the windows every strong state misses
const step = (s, k) => { const inv = 33543; for (let i = 0; i < Math.abs(k); i += 1) s = k > 0 ? (s * 31415 + 1) & 0xffff : (((s - 1) & 0xffff) * inv) & 0xffff; return s; };
assert.equal((31415 * 33543) & 0xffff, 1, 'the LCG multiplier inverse');
const byState = new Map(rows.map((r) => [r.state, r]));
for (const n of rec.exploratory.startOffsetNeighbours.rows) {
  assert.equal(n.state, step(rec.measuredSeed, n.k));
  assert.equal(n.prefix, (byState.get(n.state) as any)?.prefix ?? '<10');
}
const best = [...rows].sort((a, b) => b.agree - a.agree || a.state - b.state).slice(0, 40);
const counts = {};
for (const r of best) {
  const codes = rec.stage2.codes[String(r.state)];
  assert.ok(codes, `codes retained for ${r.state}`);
  [...rec.phoneWindows].forEach((p, k) => { if (p !== '?' && codes[k] !== '?' && codes[k] !== undefined && p !== codes[k]) counts[k] = (counts[k] ?? 0) + 1; });
}
assert.deepEqual(Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v])), rec.exploratory.systematicDisagreements.counts);
assert.ok(counts[22] >= 30 && counts[26] >= 30 && rec.phoneWindows[22] === 'F' && rec.phoneWindows[26] === 'F', 'the strong states miss both Withered Freddy windows');

const { id, ...body } = rec;
// keys sorted as strings, as Python's sort_keys does (a JS object would put integer-like keys first, in number order)
const canon = (v) => Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v);
assert.equal(id, `s2-stream-census-${sha256(canon(body)).slice(0, 16)}`, 'record id: sha256 of the body, keys sorted, compact');

// --- the occupancy-rate correction of this record's exploratory reading
const occ = json('docs/evidence/full06-occupancy-rates-20261001.json');
assert.equal(occ.corrects.id, rec.id);
const t = tally(occ.codes.split(' '), occ.phoneWindows, occ.windows);
assert.equal(occ.codes.split(' ').length, occ.states);
assert.deepEqual([t.model, t.played, t.phone, t.phoneRead], [occ.model, occ.played, occ.phone, occ.phoneRead]);
const chi = chiSquare(t);
assert.equal(chi.chi, occ.chiSquare.chi);
// chi-square survival on 3 df: erfc(sqrt(x / 2)) + sqrt(2x / pi) e^(-x / 2); erfc by Abramowitz-Stegun 7.1.26 (|error| < 1.5e-7)
const erfc = (z) => { const t1 = 1 / (1 + 0.3275911 * z); return t1 * (0.254829592 + t1 * (-0.284496736 + t1 * (1.421413741 + t1 * (-1.453152027 + t1 * 1.061405429)))) * Math.exp(-z * z); };
const p3 = (x) => erfc(Math.sqrt(x / 2)) + Math.sqrt((2 * x) / Math.PI) * Math.exp(-x / 2);
assert.equal(chi.df, 3);
assert.ok(Math.abs(p3(chi.chi) - occ.chiSquare.p) < 0.005, `p ${p3(chi.chi)} is the recorded ${occ.chiSquare.p}`);
const best40 = [...rows].sort((a, b) => b.agree - a.agree || a.state - b.state).slice(0, 40).map((r) => rec.stage2.codes[String(r.state)]);
assert.deepEqual(missExpectation(best40, rec.phoneWindows, occ.model, occ.played).filter((m) => m && [22, 26, 31, 32].includes(m.window)), occ.censusBest40.windows);
const { id: occId, ...occBody } = occ;
assert.equal(occId, `s2-occupancy-rates-${sha256(canon(occBody)).slice(0, 16)}`, 'occupancy record id');
console.log(`phone-stream-census: decision rule fixtures, and ${id} (${decision.verdict}) re-derived from its rows, and its occupancy-rate correction rechecked`);
