#!/usr/bin/env node
// FIXTURE for the trace-derived hour grid and the committed DEVICE_MEASURED records. The arithmetic
// checks run in a clean checkout; source frame traces remain hash-named inputs and are not required.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { check, fitHourGrid, hourTransitions, SCHEMA } from './hour-grid-fit.ts';

const read = (rel) => readFileSync(new URL(`../../../../${rel}`, import.meta.url), 'utf8');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// --- detect a dark interstitial after each expected hour and fit its phase
{
  const ms = [0, 62_000, 69_990, 70_010, 139_970, 140_030];
  const transitions = hourTransitions(ms.map((t) => t * 1e6), [40, 40, 40, 12, 40, 8], 0, 0, [1, 2, 3]);
  assert.deepEqual(transitions, [
    { k: 1, imageMs: 70_010, luma: 12, prevLuma: 40 },
    { k: 2, imageMs: 140_030, luma: 8, prevLuma: 40 },
    { k: 3, imageMs: null },
  ]);
  assert.deepEqual(fitHourGrid(transitions), {
    zeroMsAfterFirst: 20, residualsMs: [-10, 10], intervalsMs: [70_020], found: 2,
  });
  assert.throws(() => hourTransitions([0], [40], 1, 0, [1]), /first must name/);
}

// --- a hash-bound fixture can be checked with the local source bytes
{
  const traceBytes = Buffer.from('fixture trace bytes');
  const transitions = [
    { k: 1, imageMs: 70_010, luma: 12, prevLuma: 40 },
    { k: 2, imageMs: 140_030, luma: 8, prevLuma: 40 },
  ];
  const fit = { ...fitHourGrid(transitions), zeroMinusAnchorFireMs: 20 };
  const result: any = {
    schema: SCHEMA,
    claimLevel: 'DEVICE_MEASURED observations; arithmetic fit',
    toolSha256: sha256(Buffer.from('fixture tool bytes')),
    input: { tracePath: 'fixture.tsv', traceSha256: sha256(traceBytes), anchorFireAfterFirstFrameMs: 0, anchorFireToleranceMs: 50 },
    transitions,
    fit,
  };
  result.evidenceId = `phone-hour-grid-${sha256(JSON.stringify(result)).slice(0, 16)}`;
  assert.equal(check(result, { traceBytes }).zeroMinusAnchorFireMs, 20);
  assert.throws(() => check(result, { traceBytes: Buffer.from('different') }), /trace hash differs/);
  assert.throws(() => check({ ...result, transitions: [{ ...transitions[0], imageMs: 71_000 }, transitions[1]] }), /fit zeroMsAfterFirst differs/);
}

// --- committed result arithmetic is checkable without the ignored source traces
{
  const full06 = JSON.parse(read('tools/recompile/results/phone-hour-grid-full-06-20260928.json'));
  const full04 = JSON.parse(read('tools/recompile/results/phone-hour-grid-full-04-20260928.json'));
  const record = JSON.parse(read('docs/evidence/phone-hour-grid-20260928.json'));
  assert.equal(full06.claimLevel.includes('DEVICE_MEASURED'), true);
  assert.equal(check(full06).evidenceId, full06.evidenceId);
  assert.equal(full06.fit.found, 5);
  assert.equal(full06.fit.zeroMsAfterFirst, 3836.7);
  assert.equal(full06.fit.zeroMinusAnchorFireMs, 0.7);
  assert.equal(check(full04).evidenceId, full04.evidenceId);
  assert.equal(full04.fit.found, 1);
  assert.equal(full04.fit.zeroMsAfterFirst, 3831.4);
  assert.equal(full04.fit.zeroMinusAnchorFireMs, -48.2);
  for (const result of [full06, full04]) {
    const row = record.results.find((r) => r.night === result.label);
    assert.equal(row.evidenceId, result.evidenceId);
    assert.equal(row.sha256, sha256(read(row.path)));
  }
}

console.log('hour-grid-fit: fixtures and both hash-bound phone records rechecked');
