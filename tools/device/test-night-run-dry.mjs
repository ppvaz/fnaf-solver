// A dry run of night-run.sh must not actuate the phone. It may ask adb whether
// the device is reachable and read its capabilities; it must not start,
// stop, relaunch, record or screencap anything. On 2026-09-27 its EXIT trap
// still force-stopped and relaunched FNaF 2 and screencapped the title, on a
// phone its owner was using. This runs the dry path against a fake adb that
// records every call, and refuses any call that is not a read.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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

  // A live run takes the serial lease before its first adb call (it took none
  // until 2026-09-27). With another owner holding it, the run holds at once.
  const locks = join(tmp, 'locks');
  const holder = spawn('python3', ['-c', [
    'import sys, time', `sys.path.insert(0, ${JSON.stringify(join(ROOT, 'tools/device'))})`,
    'from cue_helper_device_lock import DeviceLock', "lease = DeviceLock('FAKE0001'); lease.__enter__()",
    "print('held', flush=True)", 'time.sleep(120)'].join('\n')],
  { env: { ...process.env, CUE_HELPER_LOCK_DIR: locks }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((resolve, reject) => {
      holder.stdout.once('data', resolve);
      holder.once('exit', code => reject(new Error(`the lease holder exited ${code}`)));
    });
    writeFileSync(log, '');
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CUE_HELPER_LOCK_DIR: locks };
    delete env.FNAF_LEASE_HELD;
    const live = spawnSync('bash', ['tools/device/night-run.sh', '--label', label, '--night', '5',
      '--bundle', join(tmp, 'bundle'), '--qualification', join(tmp, 'qualification.json'),
      '--serial', 'FAKE0001', '--no-trace', '--no-grade'], { cwd: ROOT, encoding: 'utf8', env });
    assert.equal(live.status, 75, `a live run under another owner's lease did not hold:\n${live.stdout}\n${live.stderr}`);
    assert.match(live.stderr, /DEVICE HOLD reason=device-busy serial=FAKE0001/);
    assert.equal(readFileSync(log, 'utf8'), '', 'a live run called adb before it held the lease');
    console.log('night-run live: takes the serial lease before any adb call, and holds when another owner has it');
  } finally {
    holder.kill('SIGTERM');
  }

  // Exercise the actual EXIT handler with device-free stage doubles. A
  // repeated signal during reset must not cut off the observed-title or
  // evidence stages (the 2026-09-27 twin-loop interruption regression).
  const source = readFileSync(join(ROOT, 'tools/device/night-run.sh'), 'utf8');
  const handler = source.match(/on_exit\(\) \{[\s\S]*?\n\}\ntrap on_exit EXIT/)?.[0];
  assert.ok(handler, 'the runner EXIT handler is present');
  const cleanup = spawn('bash', ['-c', `
say() { :; }
stop_frame_trace() { :; }
stop_input_trace() { :; }
stop_recording() { :; }
reset_device() { echo cleanup-start; sleep 0.2; echo title-observed; }
analyze() { echo evidence-retained; }
RUNID=fixture OUTDIR=fixture
${handler}
exit 7
`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let cleanupOutput = '';
  let signalled = false;
  cleanup.stdout.on('data', chunk => {
    cleanupOutput += chunk;
    if (!signalled && cleanupOutput.includes('cleanup-start')) {
      signalled = true;
      cleanup.kill('SIGTERM'); cleanup.kill('SIGINT');
    }
  });
  const exitCode = await new Promise((resolve, reject) => {
    cleanup.once('error', reject);
    cleanup.once('close', (code, signal) => resolve({ code, signal }));
  });
  assert.deepEqual(exitCode, { code: 7, signal: null }, 'cleanup keeps the original result through repeated signals');
  assert.equal(signalled, true);
  assert.match(cleanupOutput, /title-observed[\s\S]*evidence-retained/);
  console.log('night-run cleanup: repeated interrupts cannot truncate physical cleanup or retained evidence');
} finally {
  for (const d of ours()) rmSync(join(runsDir, d), { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
}
