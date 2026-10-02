// `npm run probe` (apps/desktop/src/probe.ts): the shape of its report, on this machine and on machines
// built for the test out of fake programs on PATH. The probe is informational, so it must exit 0
// whatever is missing, and it must never contact a Docker daemon that is not on a local socket:
// the fake docker below records any `docker info` it is asked, and a remote daemon must leave no
// record.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const PROBE = join(ROOT, 'apps/desktop/src/probe.ts');
const CHECKS = ['Node', 'npm ci', 'Java', 'Python', 'ffmpeg', 'Clone', 'Docker'];
const ROUTES = ['Story', 'Strategies', 'Claims', 'Full tests', 'Rebuild (owner only)', 'Phone'];
const PHONE = 'Ready: Phone -- not checked here, no phone access (needs a Moto g56 and the game)';

/** Run the probe, check its shape, and return its checks and routes by name. */
function run(env = process.env) {
  const result = spawnSync(process.execPath, [PROBE], { cwd: ROOT, encoding: 'utf8', env, timeout: 60000 });
  assert.equal(result.status, 0, `the probe informs and exits 0 whatever is missing: ${result.stderr}`);
  assert.equal(result.stderr, '');
  const lines = result.stdout.trimEnd().split('\n');
  assert.equal(lines.length, 1 + CHECKS.length + ROUTES.length + 1, result.stdout);
  assert.match(lines[0], /^probe: .*no phone, no network\)$/);
  const checks: Record<string, { status: string, detail: string }> = {};
  lines.slice(1, 1 + CHECKS.length).forEach((line, index) => {
    const match = line.match(/^ {2}(ok|warn|missing) +([^:]+): (\S.*)$/);
    assert.ok(match, `a check line: ${line}`);
    assert.equal(match[2], CHECKS[index], 'one line per check, in order');
    checks[match[2]] = { status: match[1], detail: match[3] };
  });
  const routes: Record<string, { state: string, detail: string, line: string }> = {};
  lines.slice(1 + CHECKS.length, -1).forEach((line, index) => {
    const match = line.match(/^Ready: (.+?) -- (yes|no|not checked)\b(.*)$/);
    assert.ok(match, `a Ready line: ${line}`);
    assert.equal(match[1], ROUTES[index], 'one Ready line per route, in order');
    routes[match[1]] = { state: match[2], detail: match[3].replace(/^: /, ''), line };
  });
  assert.equal(routes.Phone.line, PHONE, 'the phone is never probed');
  assert.equal(routes.Story.state, 'yes', 'reading needs nothing');
  const next = lines.at(-1) as string; // the length check above leaves a last line
  assert.match(next, /^Next: \S/, 'one Next suggestion, last');
  return { checks, routes, next };
}

// This machine: only the shape; what is installed differs from one machine to the next.
run();

const scratch = mkdtempSync(join(tmpdir(), 'probe-test-'));
try {
  /** A directory of fake programs; each call adds one and returns the directory. */
  const bin = (name: string) => {
    const dir = join(scratch, name);
    mkdirSync(dir, { recursive: true });
    return (program: string, script: string) => {
      const path = join(dir, program);
      writeFileSync(path, `#!/bin/sh\n${script}\n`);
      chmodSync(path, 0o755);
      return dir;
    };
  };

  // Nothing on PATH but the probe's own node (spawned by absolute path).
  const empty = mkdtempSync(join(scratch, 'empty-'));
  const bare = run({ PATH: empty, HOME: scratch });
  for (const name of ['Java', 'Python', 'ffmpeg', 'Clone', 'Docker'])
    assert.equal(bare.checks[name].status, 'missing', `${name} is missing on an empty PATH: ${bare.checks[name].detail}`);
  assert.equal(bare.checks.Node.status, 'ok');
  assert.equal(bare.routes['Full tests'].line, 'Ready: Full tests -- no: needs Java, Python, ffmpeg, Clone');
  assert.equal(bare.routes['Rebuild (owner only)'].line, 'Ready: Rebuild (owner only) -- no: needs Docker');
  assert.match(bare.next, /install Java 17; install Python 3\.12 with Pillow, NumPy and SciPy; install ffmpeg; install git$/,
    'the suggestion names what the full tests are missing, each by its own cause');

  // Fakes: CI's Java and Python, ffmpeg, a shallow clone, and a Docker whose context is remote.
  const asked = join(scratch, 'docker-info-asked');
  const fake = bin('fake');
  fake('java', `echo 'openjdk version "17.0.12" 2024-07-16' >&2`);
  fake('python3', `echo '{"version": "3.12.4", "modules": {"PIL": "12.3.0", "numpy": "2.2.4", "scipy": "1.15.3"}}'`);
  fake('ffmpeg', `echo 'ffmpeg version 6.1.1 Copyright (c) 2000-2023 the FFmpeg developers'`);
  fake('git', `echo true`);
  const dir = fake('docker', [
    'case "$1" in',
    `  --version) echo 'Docker version 27.0.0, build abc1234';;`,
    `  context) echo 'tcp://build-host.example:2376';;`,
    `  info) : > '${asked}'; echo 27.0.0;;`,
    'esac'].join('\n'));
  const faked = run({ PATH: dir, HOME: scratch });
  assert.deepEqual(faked.checks.Java, { status: 'ok', detail: '17 (17 needed)' });
  assert.deepEqual(faked.checks.Python, { status: 'ok', detail: '3.12.4 with Pillow 12.3.0, NumPy 2.2.4, SciPy 1.15.3' });
  assert.deepEqual(faked.checks.ffmpeg, { status: 'ok', detail: '6.1.1' });
  assert.equal(faked.checks.Clone.status, 'missing');
  assert.match(faked.checks.Clone.detail, /shallow/);
  assert.equal(faked.checks.Docker.status, 'warn');
  assert.match(faked.checks.Docker.detail, /tcp:\/\/build-host\.example:2376 is not contacted/);
  assert.ok(!existsSync(asked), 'a daemon on another machine is never asked');
  assert.equal(faked.routes['Full tests'].line, 'Ready: Full tests -- no: needs Clone');
  assert.equal(faked.routes['Rebuild (owner only)'].state, 'not checked');
  assert.match(faked.next, /git fetch --unshallow/);

  // DOCKER_HOST over SSH, an old Java and a Python without SciPy; then a local daemon that is asked.
  const other = bin('other');
  other('java', `echo 'java version "1.8.0_401"' >&2`);
  other('python3', `echo '{"version": "3.12.1", "modules": {"PIL": "12.3.0", "numpy": "2.2.4", "scipy": null}}'`);
  const otherDir = other('docker', [
    'case "$1" in',
    `  --version) echo 'Docker version 27.0.0, build abc1234';;`,
    `  context) echo 'unix:///var/run/docker.sock';;`,
    `  info) : > '${asked}'; echo 27.0.0;;`,
    'esac'].join('\n'));
  const remote = run({ PATH: otherDir, HOME: scratch, DOCKER_HOST: 'ssh://builder' });
  assert.deepEqual(remote.checks.Java, { status: 'missing', detail: '8 (17 needed)' });
  assert.equal(remote.checks.Python.status, 'missing');
  assert.match(remote.checks.Python.detail, /SciPy missing \(install SciPy\)/);
  assert.equal(remote.checks.Docker.status, 'warn');
  assert.ok(!existsSync(asked), 'DOCKER_HOST naming another machine is not contacted either');
  const local = run({ PATH: otherDir, HOME: scratch });
  assert.equal(local.checks.Docker.status, 'ok');
  assert.ok(existsSync(asked), 'a daemon on a local socket is asked');
  assert.match(local.routes['Rebuild (owner only)'].line, /^Ready: Rebuild \(owner only\) -- yes: .*your own copy of the game \(not checked\)$/);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('probe: one line per check, a Ready line per route with the phone never probed, one Next, exit 0 on an empty PATH; '
  + 'fake programs pin the parsing, and a Docker daemon off this machine is never contacted');
