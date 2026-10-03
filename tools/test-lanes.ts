#!/usr/bin/env node
// The lane table and its runner: Review's reader refuses a table that is not lanes of files and argv steps
// or that nests a lane it does not have, and tools/lanes.ts refuses an --only that selects nothing, and
// keeps a nested lane only when --only selects something in it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLanes } from '@sixam/review/lanes';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = join(ROOT, 'tools', 'lanes.ts');

const lanes = readLanes(ROOT);
assert.ok(lanes.unit.node.includes('tools/test-lanes.ts'), 'the unit lane runs this test');

const planted = mkdtempSync(join(tmpdir(), 'lanes-'));
try {
  mkdirSync(join(planted, 'tools'));
  const table = (value: unknown) => { writeFileSync(join(planted, 'tools', 'lanes.json'), JSON.stringify(value)); return () => readLanes(planted); };
  assert.throws(table([]), /not an object of lanes/);
  assert.throws(table({ a: { node: ['x.ts'] } }), /lane a needs node \(files\) and steps/);
  assert.throws(table({ a: { node: [1], steps: [] } }), /lane a needs node/);
  assert.throws(table({ a: { node: [], steps: [[]] } }), /lane a has a step that is not an argv/);
  assert.throws(table({ a: { node: [], steps: [['node', '']] } }), /lane a has a step that is not an argv/);
  assert.throws(table({ a: { node: [], steps: [['lane', 'b']] } }), /lane a runs no known lane: lane b/);
  assert.deepEqual(table({ a: { node: ['x.ts'], steps: [['lane', 'b']] }, b: { node: [], steps: [['bash', 'y.sh']] } })(),
    { a: { node: ['x.ts'], steps: [['lane', 'b']] }, b: { node: [], steps: [['bash', 'y.sh']] } });
} finally {
  rmSync(planted, { recursive: true, force: true });
}

const run = (...args: string[]) => spawnSync(process.execPath, [RUNNER, ...args], { cwd: ROOT, encoding: 'utf8' });
const none = run('contracts', '--only', 'no-file-is-named-this', '--list');
assert.equal(none.status, 2, `an --only that selects nothing refuses:\n${none.stderr}`);
assert.match(none.stderr, /selects no file or step/);
// contracts nests device:calibration: a text found only there keeps that lane, and one found only in contracts drops it.
const calibration = lanes['device:calibration'].node[0];
assert.ok(calibration, 'device:calibration has a node file to select');
assert.deepEqual(run('contracts', '--only', calibration, '--list').stdout.trim().split('\n'), ['lane device:calibration']);
const own = lanes.contracts.node[0];
assert.equal(run('contracts', '--only', own, '--list').stdout.includes('lane device:calibration'), false);
assert.equal(run('nope').status, 2, 'an unknown lane is a usage error');

console.log('lanes: the reader refuses 6 planted tables and the runner\'s --only refuses nothing selected and keeps a nested lane only when it selects in it');
