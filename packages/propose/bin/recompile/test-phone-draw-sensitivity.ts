#!/usr/bin/env node
// FIXTURE for phone-draw-sensitivity.ts (the generator's cycle both ways, the window agreement score, the site
// comparison), then docs/evidence/full06-draw-sensitivity-20261001.json re-derived from its own rows: every MOVES
// flag from its draw counts and first moved updates, every window score inside 0..1 at a shift within the range,
// and the record id. No model run. In `npm run test:unit`.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agreement, along, compareSites } from './phone-draw-sensitivity.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const canon = (v) => Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v);

// --- fixtures
assert.equal(along(47593, 1), (47593 * 31415 + 1) & 0xffff);
for (const s of [0, 1, 12345, 47593, 65535]) assert.equal(along(along(s, 7), -7), s, `stepping back undoes stepping forward from ${s}`);
assert.equal(agreement([1, 2, 3, 4], [1, 2, 3, 4]), 1);
assert.equal(agreement([1, 2, 3, 4], [9, 1, 2, 3, 4]), 1, 'one period of offset is aligned away');
assert.equal(agreement([1, 2, 3, 4], [5, 6, 7, 8]), 0);
const rows = compareSites(new Map([['a@x.ts:1', [5, 9]], ['b@x.ts:2', [3]]]), new Map([['a@x.ts:1', [5, 9]], ['b@x.ts:2', [4]], ['c@x.ts:3', [7]]]));
assert.deepEqual(rows.map((r) => [r.site, r.moved]), [['a@x.ts:1', false], ['b@x.ts:2', true], ['c@x.ts:3', true]]);
assert.deepEqual(rows[1].firstMoved, [3, 4]);
assert.deepEqual(rows[2].firstMoved, [null, 7], 'a site only one replay reaches moves at its first draw');

// --- the records
const checkResult = (data, label) => {
  let n = 0;
  for (const r of data.drawSites.rows) {
    assert.equal(r.moved, r.draws[0] !== r.draws[1] || r.firstMoved !== null, `${label} ${r.site}: MOVES flag`);
    if (!r.moved) assert.equal(r.firstMoved, null);
    n += 1;
  }
  for (const w of data.readoutWindows.rows) {
    assert.ok(w.periods >= 20, `${label} ${w.window}: a window of at least 20 periods`);
    for (const s of w.scores) assert.ok(s.agreement >= 0 && s.agreement <= 1 && Math.abs(s.k) <= data.readoutWindows.shiftRange, `${label} ${w.window} ${s.variant}`);
    n += 1;
  }
  return n;
};
const RECORDS = [['docs/evidence/full06-draw-sensitivity-20261001.json', 's2-draw-sensitivity', (rec) => [['played', rec.result]]],
  ['docs/evidence/full06-readout-dial-design-20261001.json', 's2-readout-dial-design', (rec) => Object.entries(rec.results)]];
let checked = 0;
for (const [path, prefix, results] of RECORDS) {
  if (!existsSync(join(ROOT, path))) continue;
  const rec = JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
  for (const [label, data] of results(rec)) checked += checkResult(data, label);
  const { id, ...body } = rec;
  assert.equal(id, `${prefix}-${createHash('sha256').update(canon(body)).digest('hex').slice(0, 16)}`, `${path}: record id`);
}
console.log(`phone-draw-sensitivity: cycle, agreement and site fixtures${checked ? `, and ${checked} rows of the full-06 records re-derived` : ''}`);
