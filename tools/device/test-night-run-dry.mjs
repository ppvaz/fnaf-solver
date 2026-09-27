// A dry run of night-run.sh must not actuate the phone. It may ask adb whether
// the device is reachable and read its capabilities; it must not start,
// stop, relaunch, record or screencap anything. On 2026-09-27 its EXIT trap
// still force-stopped and relaunched FNaF 2 and screencapped the title, on a
// phone its owner was using. This runs the dry path against a fake adb that
// records every call, and refuses any call that is not a read.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const tmp = mkdtempSync(join(tmpdir(), 'night-run-dry-'));
const label = `dryprobe${process.pid}`;
const runsDir = join(ROOT, 'artifacts/runs');
const ours = () => (existsSync(runsDir) ? readdirSync(runsDir).filter((n) => n.startsWith(`night5-${label}-`)) : []);
try {
  const bin = join(tmp, 'bin');
  mkdirSync(bin);
  const log = join(tmp, 'adb.log');
  writeFileSync(join(bin, 'adb'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\ncase "$*" in *get-state*) echo device ;; esac\nexit 0\n`);
  chmodSync(join(bin, 'adb'), 0o755);
  mkdirSync(join(tmp, 'bundle'));
  writeFileSync(join(tmp, 'bundle/manifest.json'), '{}\n');
  writeFileSync(join(tmp, 'qualification.json'), '{}\n');
  const r = spawnSync('bash', ['tools/device/night-run.sh', '--label', label, '--night', '5',
    '--bundle', join(tmp, 'bundle'), '--qualification', join(tmp, 'qualification.json'),
    '--serial', 'FAKE0001', '--no-trace', '--no-grade', '--dry-run'],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assert.equal(r.status, 0, `the dry run failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /DRY RUN, the phone is not actuated/);
  const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  const writes = calls.filter((c) => !/(^| )get-state$|getprop|perfetto --query|cmd package list|dumpsys/.test(c));
  assert.deepEqual(writes, [], `a dry run called adb beyond reads:\n  ${writes.join('\n  ')}`);
  assert.doesNotMatch(r.stdout, /returning the phone to an observed title/, 'the dry run reset the phone');
  console.log(`night-run dry: the phone is not actuated (${calls.length} read-only adb call(s))`);
} finally {
  for (const d of ours()) rmSync(join(runsDir, d), { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
}
