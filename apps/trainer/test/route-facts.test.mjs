// Every number the trainer states about a route is its record's number, under
// its record's label. The page cannot read the records (it is one offline
// file on a phone), so it carries the values and this reads the records: a
// fact whose label differs from its record's claimLevel, or whose value
// differs from the field it names, fails here instead of being published.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLAIM_LEVELS } from '@sixam/kernel';
import { ROUTE_FACTS, factText, pick } from '../src/route-facts.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const NAMED = /10\/20|6 AM|±60 ms|\d{4}-\d{2}-\d{2}/g;
const unnamed = text => text.replace(NAMED, '').match(/\d+(?:\.\d+)?/g) ?? [];

// The checks catch a planted drift first, or they check nothing.
{
  assert.deepEqual(unnamed('8 of 10 10/20 nights reached 6 AM, ±60 ms on 2026-09-30'), ['8', '10'],
    'a number in the text is found unless it is a name');
  const record = { claimLevel: 'DEVICE_MEASURED', rows: [{ id: 'a', n: 3 }] };
  assert.equal(pick(record, ['rows', { id: 'a' }, 'n']), 3);
  assert.equal(pick(record, ['rows', { id: 'b' }, 'n']), undefined);
  assert.throws(() => factText({ id: 'x', label: 'MODEL_ONLY', text: '{n} of {m}', values: { n: 1 } }), /holds no value/);
}

const ids = new Set();
for (const fact of ROUTE_FACTS) {
  assert.ok(!ids.has(fact.id), `route fact ${fact.id} is listed twice`);
  ids.add(fact.id);
  assert.ok(CLAIM_LEVELS.includes(fact.label), `${fact.id}: ${fact.label} is not a claim level`);
  const text = factText(fact);
  assert.ok(!/[{}]/.test(text), `${fact.id}: unfilled placeholder in "${text}"`);
  if (fact.unknown) {
    assert.ok(fact.unknown.trim().length > 20, `${fact.id}: UNKNOWN needs its reason`);
    assert.ok(!fact.values && !fact.record, `${fact.id}: an UNKNOWN fact cites no value`);
    assert.match(text, /UNKNOWN/);
    continue;
  }
  assert.ok(fact.record && existsSync(`${ROOT}${fact.record}`), `${fact.id}: no record at ${fact.record}`);
  const record = JSON.parse(readFileSync(`${ROOT}${fact.record}`, 'utf8'));
  assert.equal(record.claimLevel, fact.label, `${fact.id}: labelled ${fact.label}, but ${fact.record} is ${record.claimLevel}`);
  for (const [key, value] of Object.entries(fact.values)) {
    assert.ok(fact.from?.[key], `${fact.id}: {${key}} names no field of its record`);
    assert.equal(pick(record, fact.from[key]), value,
      `${fact.id}: {${key}} shows ${value}, ${fact.record} ${JSON.stringify(fact.from[key])} holds ${pick(record, fact.from[key])}`);
    assert.ok(text.includes(String(value)), `${fact.id}: {${key}} is not in its text`);
  }
  // Every other number in its text is one of those checked values. The only
  // numbers left unchecked are names: the 10/20 mode, 6 AM, the human gate's
  // ±60 ms (ROADMAP S5) and a date.
  const shown = new Set(Object.values(fact.values).map(String));
  for (const number of unnamed(text))
    assert.ok(shown.has(number), `${fact.id}: "${number}" in its text is not a value checked against its record`);
}
console.log(`route facts: ${ROUTE_FACTS.length} statements, each number equal to its record's field under its record's label`);
