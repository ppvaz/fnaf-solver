#!/usr/bin/env node
// Synthetic contract for the read-only observation index.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = fileURLToPath(new URL('./index-observations.ts', import.meta.url));

const write = (root: string, name: string, body = 'x') => {
  mkdirSync(dirname(join(root, name)), { recursive: true });
  writeFileSync(join(root, name), body);
};
const contents = (root: string): Record<string, string> => Object.fromEntries(
  (readdirSync(root, { recursive: true }) as string[]).filter(name => statSync(join(root, name)).isFile())
    .map(name => [relative(root, join(root, name)), readFileSync(join(root, name), 'latin1')]));
const tool = (...args: string[]) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });

const temporary = mkdtempSync(join(tmpdir(), 'fnaf-observation-index-'));
try {
  const root = join(temporary, 'captures');
  const samples: Record<string, string> = {
    'run-aborted.mp4': 'aborted-run-video',
    'run-epoch.txt': 'epoch-report',
    'run-hid.jsonl': 'hid-trace',
    'run-cue.txt': 'cue-scalar-trace',
    'run-keyframes.png': 'video-keyframes',
    'probe.hid': 'hid-probe-input',
    'traces/lesson.json': 'trainer-trace',
    'screencheck/bb-left/calibration/session-a/empty/a.raw': 'labeled-screen-frame',
    'screencheck/bb-left/models/runtime.scm': 'scm1-model',
    'screencheck-keep/run/001000-bb.raw': 'selected-raw-frame',
    'cue-helper/calibration/run-cue-1-p0-q1.wav': 'cue-audio',
    'cue-helper/calibration/run-visual.tsv': 'visual-watch',
    'cue-helper/calibration/run-sessions.tsv': 'collection-boundaries',
    'cue-helper/soak-20260826.tsv': 'helper-soak',
    'mystery.bin': 'unclassified',
  };
  for (const name of Object.keys(samples)) write(root, name);
  const before = contents(root);

  const result = tool(root, '--json', '--hash');
  assert.equal(result.status, 0, result.stderr);
  const payload: { artifacts: { path: string, kind: string, authority: string, join: string | null, verdict: string, sha256: string }[] } =
    JSON.parse(result.stdout);
  const rows = Object.fromEntries(payload.artifacts.map(row => [row.path, row]));
  assert.deepEqual(new Set(Object.keys(rows)), new Set(Object.keys(samples)));
  for (const [name, kind] of Object.entries(samples)) {
    assert.equal(rows[name].kind, kind, name);
    assert.equal(rows[name].sha256.length, 64);
  }
  assert.equal(rows['run-hid.jsonl'].authority, 'emitted-action-record');
  assert.equal(rows['run-hid.jsonl'].join, 'run');
  assert.equal(rows['mystery.bin'].verdict, 'needs-manual-classification');
  assert.deepEqual(contents(root), before, 'index modified a capture');

  assert.equal(tool(root, '--strict').status, 1);
  unlinkSync(join(root, 'mystery.bin'));
  const strict = tool(root, '--strict');
  assert.equal(strict.status, 0, strict.stderr);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log('observation index: families classified, joins stable, strict mode and read-only contract pass');
