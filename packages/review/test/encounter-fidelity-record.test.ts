// The 2026-09-27 encounter study's prose states numbers its tool assembles from private inputs.
// The tool refuses to write when the inputs no longer give those numbers; this checks the check
// against the committed record, which keeps every field the prose cites.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { jsonObject } from '../src/records.ts';
import { failedPremises } from '../venue-grid/model-encounter-fidelity.ts';

const RECORD = fileURLToPath(new URL('../../../docs/evidence/model-encounter-fidelity-20260927.json', import.meta.url));
const record = jsonObject(readFileSync(RECORD, 'utf8'), RECORD);
assert.deepEqual(failedPremises(record), [], 'the committed record gives every number its prose states');

const drifted = structuredClone(record);
const populations = drifted.populations as Record<string, Record<string, unknown>>; // the record keeps one object per population
populations['gated-tw04'].won = 481;
assert.deepEqual(failedPremises(drifted), ['gated null replays that reach 6 AM: the inputs give 481 of 1202, the prose states 480 of 1202']);
assert.equal(failedPremises({}).length, 15, 'a record that keeps none of the fields supports none of the prose');
console.log('encounter fidelity record: the prose\'s 15 numbers re-read from the committed record, and a drifted input is refused');
