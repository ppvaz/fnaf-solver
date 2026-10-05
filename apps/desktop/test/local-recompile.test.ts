import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dockerStep, localRecompile } from '../src/local-recompile.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));
test('local recompile help and malformed options cannot start extraction or Docker', () => {
  const cli = fileURLToPath(new URL('../src/local-recompile.ts', import.meta.url));
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /owned|APK/);
  const missing = spawnSync(process.execPath, [cli, '--apk'], { encoding: 'utf8' });
  assert.equal(missing.status, 1); assert.match(missing.stderr, /usage/);
});
test('local recompile refuses game content in the checkout, including symlink destinations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fnaf2-build-boundary-'));
  try {
    const link = join(dir, 'checkout'); symlinkSync(root, link, 'dir');
    for (const out of [join(root, 'artifacts', 'forbidden-game-build'), join(link, 'artifacts', 'forbidden-game-build')]) {
      await assert.rejects(localRecompile({ apk: join(dir, 'base.apk'), toolchain: join(dir, 'anaconda'), out }), /outside the repository/);
      assert.equal(existsSync(out), false);
    }
    await assert.rejects(localRecompile({ apk: join(dir, 'base.apk'), toolchain: join(dir, 'anaconda'), out: join(dir, 'new') }), /missing/);
    assert.equal(existsSync(join(dir, 'new')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('build deadline removes its named container even when the Docker client ignores termination', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fnaf2-docker-deadline-'));
  const savedPath = process.env.PATH;
  try {
    const bin = join(dir, 'bin'); mkdirSync(bin);
    const calls = join(dir, 'calls.jsonl');
    writeFileSync(join(bin, 'docker'), '#!/usr/bin/env node\n'
      + 'const fs = require("node:fs"); const args = process.argv.slice(2);\n'
      + 'fs.appendFileSync(' + JSON.stringify(calls) + ', JSON.stringify(args) + "\\n");\n'
      + 'if (args[0] === "run") { process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); }\n', { mode: 0o755 });
    process.env.PATH = bin + ':' + savedPath;
    await assert.rejects(dockerStep(dir, 'blocked', ['run', '--rm', 'fixture-image'], 1000), /deadline/);
    const log = readFileSync(calls, 'utf8');
    assert.match(log, /"run","--rm","--name","fnaf2-local-/);
    assert.match(log, /"rm","--force","fnaf2-local-/);
    assert.equal(existsSync(join(dir, 'blocked.log')), true);
  } finally {
    if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
    rmSync(dir, { recursive: true, force: true });
  }
});
