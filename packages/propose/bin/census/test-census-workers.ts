#!/usr/bin/env node
// census.ts --workers N gives the serial census byte for byte.
//
// The seeds of a FNaF 1, 3 or 4 census may be spread over pool.ts threads
// (2026-10-01); the result must not depend on how. Each night here has
// deaths, so the cause order among equal counts and the one floating sum of
// survived time are both exercised, and they are what a tally in any order
// but the seeds' would change.
//
//   node packages/propose/bin/census/test-census-workers.ts
import assert from 'node:assert/strict';
import { census, censusOnPool } from './census.ts';
import { SimPool } from './pool.ts';

const CASES = [
  { game: 'fnaf1', night: 1, policy: 'no-lights' },
  { game: 'fnaf3', night: 5, policy: 'community-line' },
  { game: 'fnaf4', night: 5, policy: 'community-loop' },
];

const pool = new SimPool({ workers: 3 });
try {
  for (const params of CASES) {
    const run = { seeds: 90, start: 1000, ...params };
    const serial = census(run);
    assert.ok(Object.keys(serial.causes).some((cause) => cause !== '6AM'), `${params.game}: the case must have deaths`);
    const pooled = await censusOnPool(run, pool);
    assert.equal(JSON.stringify(pooled), JSON.stringify(serial), `${params.game} night ${params.night}: pooled != serial`);
  }
} finally {
  await pool.close();
}
console.log(`census-workers: ${CASES.length} games, a 3-thread census equals the serial one byte for byte`);
