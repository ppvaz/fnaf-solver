#!/usr/bin/env node
// office-seed-bracket.ts against the lines that fooled a timestamp-ordered read.
//
// The fixture is full-06's office load (2026-09-15): a "startTheFrame() called" line shares the millisecond
// with "Starting new frame" and precedes it. Read by time, the bracket collapses to one candidate; read by
// line order it is the 14 ms pair that the helper onset sits 69-82 ms after. No phone, no game log.
//
// The second fixture is the sourced bracket (2026-09-16): allocRunHeader is instruction 0 of initRunLoop,
// which startTheFrame only calls at 231, after logging "Starting new frame" (42) and running updateViewport
// (113). So the seed sits between the last line logged before initRunLoop and the first logged inside it --
// "Created extension: " from createFrameObjects or "iPhoneOptions are " from f_InitLoop -- which is one or
// two milliseconds, not fourteen.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bracket } from './office-seed-bracket.ts';

const TOOL = fileURLToPath(new URL('./office-seed-bracket.ts', import.meta.url));

const FULL06 = `         1789512692.806 26897 26897 I MMFRuntime: startTheFrame() called
         1789512692.920 26897 26897 I MMFRuntime: loading frame #:4
         1789512693.100 26897 26897 I MMFRuntime: (loading)
         1789512694.248 26897 26897 I MMFRuntime: startTheFrame() called
         1789512694.248 26897 26897 I MMFRuntime: Starting new frame
         1789512694.250 26897 26897 I MMFRuntime: (init)
         1789512694.261 26897 26897 I MMFRuntime: startTheFrame() called
         1789512694.261 26897 26897 I MMFRuntime: All loaded in frame: 4 and took: 1307 (msecs) ...
`;
const lines = FULL06.split('\n').slice(0, -1);
assert.deepEqual(bracket(lines, true), [1789512694248, 1789512694261], 'full-06 pair by line order');
// With nothing logged from inside initRunLoop, the sourced rule falls back to that pair.
assert.deepEqual(bracket(lines), [1789512694248, 1789512694261], 'fallback when initRunLoop logged nothing');

// The sourced bracket: the viewport block is pre-seed, the first extension is post-seed.
const SOURCED = `         1789598221.184 1 1 I MMFRuntime: loading frame #:4
         1789598222.512 1 1 I MMFRuntime: startTheFrame() called
         1789598222.512 1 1 I MMFRuntime: Starting new frame
         1789598222.512 1 1 I MMFRuntime: Thread Thread[main,5,main] updating viewport
         1789598222.512 1 1 I MMFRuntime: Setting renderer limits...
         1789598222.513 1 1 I MMFRuntime: Created extension: kcclock
         1789598222.515 1 1 I MMFRuntime: Created extension: Android
         1789598222.527 1 1 I MMFRuntime: startTheFrame() called
`.split('\n').slice(0, -1);
assert.deepEqual(bracket(SOURCED), [1789598222512, 1789598222513], 'sourced bracket');
assert.deepEqual(bracket(SOURCED, true), [1789598222512, 1789598222527], 'legacy pair still available');
const backwards = SOURCED.map(line => line.replace('222.513', '222.507'));
assert.match(String(bracket(backwards)), /backwards/, 'a reversed bracket is UNKNOWN, never a negative candidate count');
assert.match(String(bracket(backwards, true)), /backwards/, 'increasing outer endpoints do not excuse an internal backwards step');
// f_InitLoop's line closes it too, and a viewport block that is absent leaves "Starting new frame" as the opener.
const noViewport = SOURCED.filter(line => !line.includes('viewport') && !line.includes('renderer limits') && !line.includes('Created extension'));
noViewport.splice(3, 0, '         1789598222.513 1 1 I MMFRuntime: iPhoneOptions are 1024');
assert.deepEqual(bracket(noViewport), [1789598222512, 1789598222513], 'f_InitLoop closes the bracket');

// An earlier frame's load must not be taken for the office: the LAST office load wins.
const earlier = ['         1789512680.000 1 1 I MMFRuntime: loading frame #:4',
  '         1789512680.100 1 1 I MMFRuntime: Starting new frame',
  '         1789512680.105 1 1 I MMFRuntime: startTheFrame() called', ...lines];
assert.deepEqual(bracket(earlier), [1789512694248, 1789512694261], 'the last office load is the bracket');

assert.equal(typeof bracket(lines.slice(0, 2)), 'string', 'a load without its pair is refused');
assert.equal(typeof bracket(['         1.0 1 1 I MMFRuntime: Starting new frame']), 'string', 'no office load is refused');

const dir = mkdtempSync(join(tmpdir(), 'office-seed-bracket-'));
try {
  const cli = (...args: string[]) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
  const log = join(dir, 'x.logcat');
  writeFileSync(log, FULL06);
  let out = cli(log, '--onset-ms', '1789512694330.005'); // this fixture logs nothing from inside initRunLoop
  assert.equal(out.status, 0, `cli exit ${out.status}: ${out.stderr}`);
  let j = JSON.parse(out.stdout || '{}');
  assert.ok(j.candidates === 14 && j.low16[0] === 47592 && j.low16[1] === 47605, `cli bracket: ${out.stdout}`);
  assert.ok(!j.rule.includes('legacy'), `cli names its rule: ${j.rule}`);
  assert.deepEqual(j.beforeOnsetMs, [69, 82], 'before onset');
  assert.match(out.stdout, /"beforeOnsetMs": \[69\.0, 82\.0\]/, 'printed as Python printed its floats');
  out = cli(log, '--clock-pinned', '--json', join(dir, 'unknown.json'));
  j = JSON.parse(out.stdout || '{}');
  assert.ok(out.status === 1 && j.status === 'UNKNOWN' && j.seedProvenance === 'pinned', 'a known pin is refused even with increasing endpoints');
  assert.ok(j.candidates === null && j.low16 === null, 'UNKNOWN supplies no seed candidates');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'unknown.json'), 'utf8')), j, 'the retained diagnostic matches stdout');
  writeFileSync(log, backwards.join('\n'));
  out = cli(log);
  assert.ok(out.status === 1 && JSON.parse(out.stdout).status === 'UNKNOWN', 'a detected reversal emits a refused diagnostic');
  assert.equal(cli(join(dir, 'missing.logcat')).status, 1, 'a missing log exits 1');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('office-seed-bracket: sourced initRunLoop bracket, legacy pair, fallback, last load, refusals, cli json');
