import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dockerStep, localRecompile, prepareRuntimeBase } from '../src/local-recompile.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));
test('local recompile help and malformed options cannot start extraction or Docker', () => {
  const cli = fileURLToPath(new URL('../src/local-recompile.ts', import.meta.url));
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /owned|APK/);
  const missing = spawnSync(process.execPath, [cli, '--apk'], { encoding: 'utf8' });
  assert.equal(missing.status, 1); assert.match(missing.stderr, /usage/);
  const unsupported = spawnSync(process.execPath, [cli, '--game', 'fnaf5', '--apk', '/unused/base.apk',
    '--toolchain', '/unused/anaconda', '--out', '/unused/new-build'], { encoding: 'utf8' });
  assert.equal(unsupported.status, 1); assert.match(unsupported.stderr, /usage/);
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

test('FNaF 1 overlay stops empty paths and preserves nonempty start/restart behavior without changing the base', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fnaf1-empty-path-'));
  const original = 'void PathMovement::start()\n{\n    if (current_node == -1)\n'
    + '        set_current_node(0);\n    else if (current_node == -2)\n        return;\n'
    + '    else\n        set_speed(nodes[current_node].speed);\n}\n';
  const toolchain = join(dir, 'anaconda'), output = join(dir, 'build');
  const base = join(toolchain, 'Chowdren/base');
  const savedGitDir = process.env.GIT_DIR;
  try {
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'movement.cpp'), original);
    process.env.GIT_DIR = join(root, '.git');
    const overlay = prepareRuntimeBase(toolchain, output, 'fnaf1');
    assert.equal(overlay.patches.length, 1);
    assert.match(overlay.mounts.join(' '), /\/work\/Chowdren\/base:ro/);
    assert.equal(readFileSync(join(base, 'movement.cpp'), 'utf8'), original);
    const corrected = readFileSync(join(output, 'runtime/Chowdren/base/movement.cpp'), 'utf8');
    const harness = '#include <vector>\n#include <stdexcept>\n#include <cassert>\n'
      + 'struct Node { int speed; };\nclass PathMovement { public:\n'
      + 'std::vector<Node> nodes; int current_node=-1, speed=7;\n'
      + 'void set_speed(int n) { speed=n; }\n'
      + 'void set_current_node(int n) { set_speed(nodes.at(n).speed); current_node=n; }\n'
      + 'void start(); };\n';
    const main = 'int main() { PathMovement p; try { p.start(); } catch (const std::out_of_range&) { return 23; }\n'
      + 'assert(p.speed==0); p.nodes.push_back({9}); p.start(); assert(p.current_node==0 && p.speed==9);\n'
      + 'p.speed=0; p.start(); assert(p.speed==9); p.current_node=-2; p.speed=3; p.start(); assert(p.speed==3); }\n';
    for (const [name, functionText, expected] of [['baseline', original, 23], ['corrected', corrected, 0]] as const) {
      const source = join(dir, name + '.cpp'), binary = join(dir, name);
      writeFileSync(source, harness + functionText + main);
      const compile = spawnSync('c++', ['-std=c++11', source, '-o', binary], { encoding: 'utf8' });
      assert.equal(compile.status, 0, compile.stderr);
      assert.equal(spawnSync(binary).status, expected);
    }
    assert.deepEqual(prepareRuntimeBase(toolchain, join(dir, 'fnaf2'), 'fnaf2'), { mounts: [], patches: [] });
    writeFileSync(join(base, 'movement.cpp'), 'void PathMovement::start() { set_speed(1); }\n');
    assert.throws(() => prepareRuntimeBase(toolchain, join(dir, 'drifted'), 'fnaf1'));
  } finally {
    if (savedGitDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = savedGitDir;
    rmSync(dir, { recursive: true, force: true });
  }
});
