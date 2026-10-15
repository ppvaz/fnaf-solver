#!/usr/bin/env node
// FIXTURE: compile the actual configuration header; exercise opt-in, bounds,
// missing object rejection and patch drift without owned game data or a phone.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { applyFrameProbe } from './apply-frame-probe.ts';

const header = fileURLToPath(new URL('./frame-probe.h', import.meta.url));
const HARNESS = `#include "harness.h"
void init() {
    h_active = env_int("CHOWDREN_HARNESS", 0) != 0;
}
void apply() {
    for (auto & r : rows) {
        if (r.op == OP_DOWN_OBJECT) {
            if (!object_center()) {
                if (h_trace) fprintf(h_trace, "# miss %d %d %s\\n", frame_index, h_tick, r.object.c_str());
            } else {
                created++;
            }
        }
        r.consumed = true;
    }
}
`;

function compile(root: string, source: string, flags: readonly string[] = []) {
  const path = join(root, 'probe.cpp');
  writeFileSync(path, source);
  return spawnSync(process.env.CXX ?? 'c++', ['-std=c++14', '-DCHOWDREN_IS_ANDROID', ...flags, path, '-o', join(root, 'probe')],
    { encoding: 'utf8', timeout: 20000 });
}

test('private configuration is opt-in, bounded, strict and independent of the package path', () => {
  const root = mkdtempSync(join(tmpdir(), 'frame-probe-config-'));
  try {
    const source = `#include "${header}"
int main(int argc, char ** argv) {
    if (argc != 2) return 2;
    frame_probe_init(argv[1]);
    const char * keys[] = {"CHOWDREN_HARNESS", "CHOWDREN_SEED", "CHOWDREN_MAX_TICKS",
        "CHOWDREN_MAX_TOTAL_TICKS", "CHOWDREN_INPUT", "CHOWDREN_TRACE", "CHOWDREN_FRAME_TIMES"};
    for (const char * key : keys) {
        const char * value = getenv(key);
        printf("%s=%s\\n", key, value == NULL ? "ABSENT" : value);
    }
}
`;
    const release = compile(root, source, ['-DNDEBUG']);
    assert.notEqual(release.status, 0);
    assert.match(release.stderr, /object names enabled/);
    const named = compile(root, source, ['-DNDEBUG', '-UNDEBUG']);
    assert.equal(named.status, 0, named.stderr);
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('CHOWDREN_')) delete env[key];
    const run = () => spawnSync(join(root, 'probe'), [root], { encoding: 'utf8', timeout: 2000, env });
    const absent = run();
    assert.equal(absent.status, 0);
    assert.match(absent.stdout, /CHOWDREN_HARNESS=ABSENT/);
    for (const [seed, updates] of [[0, 1], [65535, 6000]]) {
      writeFileSync(join(root, 'frame-probe.enabled'), `frame-probe-v1 ${seed} ${updates}\n`);
      const result = run();
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /CHOWDREN_HARNESS=1\n/);
      assert.ok(result.stdout.includes(`CHOWDREN_SEED=${seed}\n`));
      assert.ok(result.stdout.includes(`CHOWDREN_MAX_TICKS=${updates}\n`));
      assert.ok(result.stdout.includes(`CHOWDREN_INPUT=${root}/frame-probe.input\n`));
      assert.ok(result.stdout.includes(`CHOWDREN_TRACE=${root}/frame-probe.trace\n`));
      assert.ok(result.stdout.includes(`CHOWDREN_FRAME_TIMES=${root}/frame-probe.clock\n`));
      assert.match(result.stdout, /CHOWDREN_MAX_TOTAL_TICKS=9000\n/);
    }
    for (const config of ['', 'frame-probe-v2 1 120', 'frame-probe-v1 -1 120', 'frame-probe-v1 +1 120',
      'frame-probe-v1 65536 120', 'frame-probe-v1 99999999999999999999 120', 'frame-probe-v1 1 0',
      'frame-probe-v1 1 6001', 'frame-probe-v1 1 1.5', 'frame-probe-v1 1 1 extra',
      'frame-probe-v1 1 1\nframe-probe-v1 2 2', 'x'.repeat(200)]) {
      writeFileSync(join(root, 'frame-probe.enabled'), config);
      assert.equal(run().status, 3, `must reject ${JSON.stringify(config)}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('patching is idempotent, refuses drift and never reports a missed object as applied', () => {
  const root = mkdtempSync(join(tmpdir(), 'frame-probe-patch-'));
  const base = join(root, 'base');
  mkdirSync(base);
  const path = join(base, 'harness.cpp');
  try {
    writeFileSync(path, HARNESS);
    assert.deepEqual(applyFrameProbe(root), { changed: true });
    const patched = readFileSync(path, 'utf8');
    assert.deepEqual(applyFrameProbe(root), { changed: false });
    assert.equal(readFileSync(path, 'utf8'), patched);
    const apply = patched.slice(patched.indexOf('void apply()'));
    const compiled = compile(root, `#include <cstdio>
#include <string>
#include <vector>
struct Row { int op, tick, pointer; std::string object; bool consumed; };
const int OP_DOWN_OBJECT = 3;
std::vector<Row> rows = {{3, 20, 0, "missing", false}, {3, 21, 0, "present", false}};
int frame_index = 1, h_tick = 21, created = 0;
FILE * h_trace = stdout;
bool object_center() { return created++ != 0; }
${apply}
int main() { apply(); return rows[0].consumed && rows[1].consumed ? 0 : 9; }
`);
    assert.equal(compiled.status, 0, compiled.stderr);
    const result = spawnSync(join(root, 'probe'), [], { encoding: 'utf8', timeout: 2000 });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /# miss 1 21 missing/);
    const applications = result.stdout.split('\n').filter(line => line.startsWith('# applied '));
    assert.deepEqual(applications, ['# applied frame 1 requested 21 applied 21 op 3 pointer 0']);
    writeFileSync(join(base, 'frame-probe.h'), 'changed');
    assert.throws(() => applyFrameProbe(root), /partial or changed installation/);
    writeFileSync(path, HARNESS.replace('h_active = env_int', 'h_active = missing'));
    assert.throws(() => applyFrameProbe(root), /expected one anchor, found 0/);
    assert.equal(readFileSync(path, 'utf8'), HARNESS.replace('h_active = env_int', 'h_active = missing'));
    writeFileSync(path, HARNESS + '\n// frame-probe.enabled\n');
    assert.throws(() => applyFrameProbe(root), /pre-existing experimental hook/);
    rmSync(path);
    symlinkSync(fileURLToPath(new URL('./apply-frame-probe.ts', import.meta.url)), path);
    assert.throws(() => applyFrameProbe(root), /inside the repository/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
