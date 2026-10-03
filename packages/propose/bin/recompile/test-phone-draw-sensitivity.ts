#!/usr/bin/env node
// FIXTURE for phone-draw-sensitivity.ts (the generator's cycle both ways, the window agreement score, the site
// comparison), then docs/evidence/full06-draw-sensitivity-20261001.json re-derived from its own rows: every MOVES
// flag from its draw counts and first moved updates, every window score inside 0..1 at a shift within the range,
// and the record id. No model run. In `npm run test:unit`.
import { nextRngState, rngStateAfterDraws } from '@sixam/source/fnaf2';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agreement, compareSites } from './phone-draw-sensitivity.ts';
import { recordId, stepRng } from './sweep-common.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');

// --- fixtures
assert.equal(stepRng(47593, 1), (47593 * 31415 + 1) & 0xffff);
for (const s of [0, 1, 12345, 47593, 65535]) assert.equal(stepRng(stepRng(s, 7), -7), s, `stepping back undoes stepping forward from ${s}`);
// The readouts' generator is Source's: one step forward is nextRngState, n steps rngStateAfterDraws.
for (const s of [0, 1, 12345, 47593, 65535]) {
  assert.equal(stepRng(s, 1), nextRngState(s));
  assert.equal(stepRng(s, 597), rngStateAfterDraws(s, 597));
}
assert.equal(agreement([1, 2, 3, 4], [1, 2, 3, 4]), 1);
assert.equal(agreement([1, 2, 3, 4], [9, 1, 2, 3, 4]), 1, 'one period of offset is aligned away');
assert.equal(agreement([1, 2, 3, 4], [5, 6, 7, 8]), 0);
const rows = compareSites(new Map([['a@x.ts:1', [5, 9]], ['b@x.ts:2', [3]]]), new Map([['a@x.ts:1', [5, 9]], ['b@x.ts:2', [4]], ['c@x.ts:3', [7]]]));
assert.deepEqual(rows.map((r) => [r.site, r.moved]), [['a@x.ts:1', false], ['b@x.ts:2', true], ['c@x.ts:3', true]]);
assert.deepEqual(rows[1].firstMoved, [3, 4]);
assert.deepEqual(rows[2].firstMoved, [null, 7], 'a site only one replay reaches moves at its first draw');

// --- the records
/** A committed draw-sensitivity result, as the checks below read it. */
type Result = {
  readonly drawSites: { readonly rows: readonly { readonly site: string, readonly moved: boolean, readonly draws: readonly number[], readonly firstMoved: unknown }[] };
  readonly readoutWindows: { readonly shiftRange: number, readonly rows: readonly { readonly window: string, readonly periods: number;
    readonly scores: readonly { readonly variant: string, readonly agreement: number, readonly k: number }[] }[] },
};
const checkResult = (data: Result, label: string) => {
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
const RECORDS: [path: string, prefix: string, results: (rec: { result: Result, results: Record<string, Result> }) => [string, Result][]][] = [
  ['docs/evidence/full06-draw-sensitivity-20261001.json', 's2-draw-sensitivity', (rec) => [['played', rec.result]]],
  ['docs/evidence/full06-readout-dial-design-20261001.json', 's2-readout-dial-design', (rec) => Object.entries(rec.results)]];
let checked = 0;
for (const [path, prefix, results] of RECORDS) {
  if (!existsSync(join(ROOT, path))) continue;
  const rec = JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
  for (const [label, data] of results(rec)) checked += checkResult(data, label);
  assert.equal(rec.id, recordId(prefix, rec), `${path}: record id`);
}
console.log(`phone-draw-sensitivity: cycle, agreement and site fixtures${checked ? `, and ${checked} rows of the full-06 records re-derived` : ''}`);
