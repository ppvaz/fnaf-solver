#!/usr/bin/env node
// Phone-free interrupted/resumed execution, source identity and corruption controls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkpointedBlocks } from './fnaf1-population-checkpoints.ts';

const scratch = mkdtempSync(join(tmpdir(), 'test-fnaf1-checkpoints-'));
const lanes = ['typical', 'worst', 'starved'];
const rows = (a: number, b: number) => lanes.map((lane, i) => ({ lane, n: b - a,
  losses: Array.from({ length: b - a }, (_, k) => a + k).filter((s) => s % 3 === i).map((s) => [s, 'fixture-loss', 100 + s]) }));
const base = { dir: join(scratch, 'resume'), identity: { commit: 'fixture-source', options: { chicaByCamera: false } },
  start: 10, count: 11, blockSize: 3, jobs: 1 };
try {
  const first: number[] = [];
  await assert.rejects(checkpointedBlocks({ ...base, runBlock: async (a, b) => {
    first.push(a); if (a === 16) throw new Error('fixture interruption'); return rows(a, b);
  } }), /fixture interruption/);
  assert.deepEqual(first, [10, 13, 16]);
  const resumed: number[] = [];
  const result = await checkpointedBlocks({ ...base, runBlock: async (a, b) => { resumed.push(a); return rows(a, b); } });
  assert.deepEqual(resumed, [16, 19], 'already completed blocks are not rerun');
  assert.equal(result.reused, 2);
  assert.deepEqual(result.rows, rows(10, 21), 'resumed aggregate is exactly the uninterrupted result');
  const cached = await checkpointedBlocks({ ...base, runBlock: async () => { throw new Error('must not run'); } });
  assert.equal(cached.reused, 4);
  assert.deepEqual(cached.rows, result.rows);
  await assert.rejects(checkpointedBlocks({ ...base, identity: { commit: 'changed-source' }, runBlock: rows }), /identity\/range changed/);
  await assert.rejects(checkpointedBlocks({ ...base, count: 12, runBlock: rows }), /identity\/range changed/);
  const file = join(base.dir, 'block-10-13.json');
  const original = readFileSync(file, 'utf8');
  const tampered = JSON.parse(original);
  tampered.rows[0].losses[0][2] += 1;
  writeFileSync(file, JSON.stringify(tampered));
  await assert.rejects(checkpointedBlocks({ ...base, runBlock: rows }), /checksum mismatch/);
  tampered.rows[0].losses[0][0] = 65535;
  tampered.rowsSha256 = createHash('sha256').update(JSON.stringify(tampered.rows)).digest('hex');
  writeFileSync(file, JSON.stringify(tampered));
  await assert.rejects(checkpointedBlocks({ ...base, runBlock: rows }), /invalid or duplicate loss/);
  writeFileSync(file, original);
  let active = 0, peak = 0;
  const parallel = await checkpointedBlocks({ ...base, dir: join(scratch, 'parallel'), jobs: 3, runBlock: async (a, b) => {
    active += 1; peak = Math.max(peak, active);
    await new Promise<void>((done) => setTimeout(done, 10));
    active -= 1; return rows(a, b);
  } });
  assert.equal(peak, 3);
  assert.deepEqual(parallel.rows, result.rows);
  await assert.rejects(checkpointedBlocks({ ...base, jobs: 4, runBlock: rows }), /jobs/);
  console.log('fnaf1 population checkpoints: interrupted blocks resume exactly; completed blocks reuse; source/range drift, corruption and invalid losses refuse; at most 3 workers');
} finally { rmSync(scratch, { recursive: true, force: true }); }
