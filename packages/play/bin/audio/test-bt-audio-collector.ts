#!/usr/bin/env node
// Phone-free regression for receiver-side A2DP PCM timing bounds.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const COLLECTOR = fileURLToPath(new URL('bt-audio-collector.ts', import.meta.url));
const PCM = '/org/bluealsa/hci0/dev_A/a2dpsnk/source';
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const read = (path: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${path} holds an object`);
  return Object.fromEntries(Object.entries(value));
};
const number = (row: Record<string, unknown>, key: string) => {
  const value = row[key];
  assert.equal(typeof value, 'number', `${key} is a number: ${JSON.stringify(row)}`);
  return Number(value);
};

async function waitFor(path: string, predicate: (row: Record<string, unknown>) => boolean, timeoutMs = 3000) {
  const until = performance.now() + timeoutMs;
  while (performance.now() < until) {
    if (existsSync(path)) {
      const value = read(path);
      if (predicate(value)) return value;
    }
    await sleep(20);
  }
  assert.fail(`timed out waiting for ${path}`);
}

const fake = (path: string, body: string) => {
  writeFileSync(path, `#!${process.execPath}\nconst { writeSync } = require('node:fs');\nif (process.argv[2] !== 'open') process.exit(9);\n${body}`);
  chmodSync(path, 0o755);
};
const command = (root: string, name: string, cli: string) => [COLLECTOR, '--pcm', PCM, '--raw', join(root, `${name}.raw`),
  '--state', join(root, `${name}.stream.json`), '--stderr', join(root, `${name}.err`),
  '--format', 'S16_LE', '--rate', '44100', '--channels', '2', '--bluealsa-cli', cli];

test('first/final PCM bounds and SIGINT finalization', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bt-audio-collector-'));
  try {
    // The fake delivers in real time, as the phone does: each 10 ms chunk is paced to an absolute deadline. A bare
    // 10 ms wait per chunk let every wait's overshoot accumulate -- ~2.4 ms a chunk on a loaded Mac, a 496 ms span
    // for 400 ms of audio -- so the test measured the host's timer, not the collector's bounds.
    const paced = join(root, 'bluealsa-cli');
    fake(paced, 'const start = performance.now();\nlet i = 0;\nconst next = () => {\n  if (i === 40) return;\n'
      + '  writeSync(1, Buffer.alloc(1764));\n  i += 1;\n  setTimeout(next, Math.max(0, start + i * 10 - performance.now()));\n};\nnext();\n');
    const completed = spawnSync(process.execPath, command(root, 'capture', paced), { encoding: 'utf8', timeout: 10_000 });
    assert.equal(completed.status, 0, completed.stderr);
    const ended = read(join(root, 'capture.stream.json'));
    assert.equal(ended.status, 'ENDED', JSON.stringify(ended));
    assert.equal(ended.rawBytes, 40 * 1764, JSON.stringify(ended));
    assert.ok(ended.firstPcmMonotonicMs !== null && ended.lastPcmMonotonicMs !== null, JSON.stringify(ended));
    assert.ok(number(ended, 'sampleSpanMs') > 0 && number(ended, 'chunks') >= 1, JSON.stringify(ended));
    const expectedMs = 1000.0 * number(ended, 'rawBytes') / (44_100 * 2 * 2);
    assert.ok(Math.abs(number(ended, 'sampleSpanMs') - expectedMs) < 80.0, `${JSON.stringify(ended)} against ${expectedMs}`);

    const endless = join(root, 'bluealsa-endless');
    fake(endless, 'setInterval(() => writeSync(1, Buffer.alloc(1764)), 10);\n');
    const interrupted = spawn(process.execPath, command(root, 'interrupted', endless), { stdio: 'ignore' });
    const exited = new Promise<number | null>(done => interrupted.once('exit', code => done(code)));
    const state = join(root, 'interrupted.stream.json'), raw = join(root, 'interrupted.raw');
    await waitFor(state, row => row.status === 'RUNNING');
    // Signal only once PCM has reached the raw file (the collector writes every block). A fixed 0.12 s raced the
    // fake source's own start on a loaded host, and a stop before any PCM is -- correctly -- NO_PCM with exit 3,
    // which is not the path this checks.
    const until = performance.now() + 5000;
    while (!(existsSync(raw) && statSync(raw).size > 0)) {
      assert.ok(performance.now() <= until, 'no PCM reached the raw file within 5 s');
      await sleep(20);
    }
    interrupted.kill('SIGINT');
    const code = await Promise.race([exited, new Promise(done => setTimeout(() => done('timeout'), 5000).unref())]);
    assert.equal(code, 0, 'SIGINT collector did not terminate cleanly');
    const stopped = await waitFor(state, row => row.status === 'STOPPED');
    assert.equal(stopped.requestedSignal, 'SIGINT', JSON.stringify(stopped));
    assert.ok(number(stopped, 'rawBytes') > 0 && number(stopped, 'sampleSpanMs') > 0, JSON.stringify(stopped));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
