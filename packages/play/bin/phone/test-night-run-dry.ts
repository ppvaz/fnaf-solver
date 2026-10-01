// Every night runner is dry unless told otherwise, and the serial it addresses
// comes from this host, never from the repository (Pedro, 2026-09-29; ADR 0002
// decisions 2 and 8). Pinned here for night-run.sh and the FNaF 1, 3 and 4
// wrappers, against a fake adb that records every call:
//
//   - no flag means dry: exit 0, no adb call at all, no lease, no serial needed.
//     Until 2026-09-29 night-run.sh went live unless --dry-run was passed.
//   - --live (with --confirm-live) means live: the runner takes the serial lease
//     before its first adb call, and holds (exit 75, no adb call) while another
//     owner has it. --live without --confirm-live refuses.
//   - a live run with no serial -- no --serial, no FNAF_SERIAL, no local
//     profile -- refuses with how to set one, before any adb call or lease.
//
// And packages/play/bin/phone/local-profile.ts, which every runner asks: FNAF_SERIAL,
// then the profile (a worktree falls back to the main checkout's), then a
// refusal that says how to set it.
//
// A dry run of night-run.sh must not actuate the phone: on 2026-09-27 its EXIT
// trap still force-stopped and relaunched FNaF 2 and screencapped the title, on
// a phone its owner was using. The runner's real EXIT handler is exercised last.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOW_TO, PROFILE_SCHEMA, SerialUnset, mainCheckout, resolveSerial, writeProfile } from './local-profile.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const tmp = mkdtempSync(join(tmpdir(), 'night-run-dry-'));
const label = `dryprobe${process.pid}`;
const runsDir = join(ROOT, 'artifacts/runs');
const ours = () => (existsSync(runsDir) ? readdirSync(runsDir).filter((n) => n.startsWith(`night5-${label}-`)) : []);
const FAKE = 'FAKE0001';
const LEASE_MARKERS = ['FNAF_LEASE_HELD', 'FNAF1_LEASE_HELD', 'FNAF3_LEASE_HELD', 'FNAF4_LEASE_HELD', 'CUE_HELPER_LEASE_OWNER_PID'];
let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks += 1; };

try {
  const bin = join(tmp, 'bin');
  mkdirSync(bin);
  const log = join(tmp, 'adb.log');
  writeFileSync(join(bin, 'adb'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\ncase "$*" in *get-state*) echo device ;; esac\nexit 0\n`);
  chmodSync(join(bin, 'adb'), 0o755);
  const adbCalls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
  const locks = join(tmp, 'locks');
  const noProfile = join(tmp, 'no-such-profile.json');
  // The environment of a host with no serial anywhere: no FNAF_SERIAL, no
  // ANDROID_SERIAL, a profile path that does not exist, no lease marker.
  const bare = (extra = {}) => {
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CUE_HELPER_LOCK_DIR: locks,
      FNAF_LOCAL_PROFILE: noProfile, ...extra };
    for (const name of ['FNAF_SERIAL', 'ANDROID_SERIAL', ...LEASE_MARKERS]) if (!(name in extra)) delete env[name];
    return env;
  };
  const run = (argv, env) => {
    writeFileSync(log, '');
    return spawnSync(argv[0], argv.slice(1), { cwd: ROOT, encoding: 'utf8', env, timeout: 120000 });
  };

  // --- local-profile.ts: FNAF_SERIAL, then the profile, then a refusal ---------
  const profile = join(tmp, 'profile.json');
  ok(resolveSerial({ env: { FNAF_SERIAL: FAKE, FNAF_LOCAL_PROFILE: noProfile } }).serial === FAKE, 'FNAF_SERIAL is read first');
  assert.throws(() => resolveSerial({ env: { FNAF_LOCAL_PROFILE: noProfile } }),
    (error) => error instanceof SerialUnset && error.message.includes('local-profile.ts set <serial>'),
    'no serial anywhere refuses with how to set one');
  checks += 1;
  assert.throws(() => resolveSerial({ env: { FNAF_SERIAL: 'x;reboot', FNAF_LOCAL_PROFILE: noProfile } }), SerialUnset,
    'an environment serial that is not a device token is refused, not used');
  checks += 1;
  ok(writeProfile(FAKE, { env: { FNAF_LOCAL_PROFILE: profile } }) === profile, 'set writes the named profile');
  ok(JSON.parse(readFileSync(profile, 'utf8')).schema === PROFILE_SCHEMA, 'the profile names its schema');
  const fromProfile = resolveSerial({ env: { FNAF_LOCAL_PROFILE: profile } });
  ok(fromProfile.serial === FAKE && fromProfile.source === profile, 'the profile is read when FNAF_SERIAL is unset');
  ok(resolveSerial({ env: { FNAF_SERIAL: 'OTHER0002', FNAF_LOCAL_PROFILE: profile } }).serial === 'OTHER0002',
    'FNAF_SERIAL outranks the profile');
  ok(resolveSerial({ env: { ANDROID_SERIAL: 'ADB0003', FNAF_LOCAL_PROFILE: noProfile }, names: ['FNAF_SERIAL', 'ANDROID_SERIAL'] })
    .serial === 'ADB0003', 'a caller may name a second environment variable');
  const broken = join(tmp, 'broken.json');
  writeFileSync(broken, '{"schema":"device-local-profile-v1","serial":""}\n');
  assert.throws(() => resolveSerial({ env: { FNAF_LOCAL_PROFILE: broken } }), SerialUnset, 'a malformed profile refuses');
  checks += 1;
  // A worktree without its own profile reads the main checkout's.
  const main = join(tmp, 'main');
  const worktree = join(tmp, 'wt');
  mkdirSync(join(main, '.git/worktrees/wt'), { recursive: true });
  mkdirSync(join(main, 'tools/device'), { recursive: true });
  mkdirSync(worktree);
  writeFileSync(join(main, '.git/worktrees/wt/commondir'), '../..\n');
  writeFileSync(join(worktree, '.git'), `gitdir: ${join(main, '.git/worktrees/wt')}\n`);
  writeFileSync(join(main, 'tools/device/local-profile.json'), JSON.stringify({ schema: PROFILE_SCHEMA, serial: 'MAIN0004' }));
  ok(mainCheckout(worktree) === main, 'a worktree resolves its main checkout');
  ok(resolveSerial({ env: {}, root: worktree }).serial === 'MAIN0004', 'a worktree reads the main checkout\'s profile');
  const cli = run(['node', 'packages/play/bin/phone/local-profile.ts', 'serial'], bare());
  ok(cli.status === 2 && cli.stderr.includes(HOW_TO) && cli.stdout === '', `the CLI refuses with how to set it:\n${cli.stderr}`);
  const cliProfile = run(['node', 'packages/play/bin/phone/local-profile.ts', 'serial'], bare({ FNAF_LOCAL_PROFILE: profile }));
  ok(cliProfile.status === 0 && cliProfile.stdout === `${FAKE}\n`, `the CLI prints the profile's serial:\n${cliProfile.stderr}`);
  console.log(`local-profile: FNAF_SERIAL, then the profile (the main checkout's from a worktree), then a refusal (${checks} checks)`);

  // --- night-run.sh --------------------------------------------------------------
  mkdirSync(join(tmp, 'bundle'));
  writeFileSync(join(tmp, 'bundle/manifest.json'), '{}\n');
  writeFileSync(join(tmp, 'qualification.json'), '{}\n');
  const nightRun = (...flags) => ['bash', 'packages/play/bin/phone/night-run.sh', '--label', label, '--night', '5',
    '--bundle', join(tmp, 'bundle'), '--qualification', join(tmp, 'qualification.json'), '--no-trace', '--no-grade', ...flags];

  for (const flags of [[], ['--dry-run']]) {
    const r = run(nightRun(...flags), bare());
    const what = flags.length ? 'an explicit --dry-run' : 'no flag';
    ok(r.status === 0, `${what}: the dry run failed:\n${r.stdout}\n${r.stderr}`);
    ok(/DRY RUN, the phone is not actuated/.test(r.stdout), `${what}: not reported as a dry run:\n${r.stdout}`);
    const command = (r.stdout.split('DRY RUN')[1] ?? '').split('\n')[1] ?? '';
    ok(/device-cli\.ts campaign /.test(command) && !command.includes('--live'),
      `${what}: the printed campaign command is missing or asks for a live run:\n${r.stdout}`);
    ok(/serial   UNKNOWN/.test(r.stdout), `${what}: a dry run with no serial anywhere should say UNKNOWN:\n${r.stdout}`);
    ok(adbCalls().length === 0, `${what}: a dry run called adb:\n  ${adbCalls().join('\n  ')}`);
    ok(!/returning the phone to an observed title/.test(r.stdout), `${what}: the dry run reset the phone`);
  }
  console.log('night-run: no flag is a dry run -- no adb call, no lease, no serial needed');

  // A run executes a private snapshot of night-run.sh (an edit under a running night garbled night7-k3-sr01's
  // tail on 2026-10-01): the snapshot is what runs, and it is gone once the run is past the lease.
  const snapDir = join(tmp, 'snapshots');
  mkdirSync(snapDir);
  const snapped = run(nightRun(), bare({ TMPDIR: snapDir }));
  ok(snapped.status === 0 && /DRY RUN/.test(snapped.stdout), `a dry run from a snapshot failed:\n${snapped.stdout}\n${snapped.stderr}`);
  ok(readdirSync(snapDir).length === 0, `a dry run left its snapshot behind: ${readdirSync(snapDir).join(', ')}`);
  const snapshotText = readFileSync(join(ROOT, 'packages/play/bin/phone/night-run.sh'), 'utf8');
  ok(/exec bash "\$NIGHT_RUN_SNAPSHOT"/.test(snapshotText) && /bash "\$NIGHT_RUN_SNAPSHOT" "\$\{ORIGINAL_ARGS\[@\]\}"/.test(snapshotText),
    'night-run.sh must run, and re-run under the lease, from its snapshot rather than from the checkout');
  console.log('night-run: every run executes a private snapshot, removed once past the lease');

  // --static-readout: native camera-view pixels into captures/ (never the packed run directory), never beside a frame
  // trace (on Companion 0.1.14 the trace starves the region copier: 0 of 553 frames, 2026-10-01), and nothing on the
  // phone in a dry run.
  const traced = run(nightRun('--frame-trace', '--static-readout'), bare());
  ok(traced.status !== 0 && /exclude each other/.test(traced.stderr) && adbCalls().length === 0,
    `--static-readout with --frame-trace must refuse before adb:\n${traced.stdout}\n${traced.stderr}`);
  const readout = run(nightRun('--static-readout'), bare());
  const recorder = readout.stdout.split('\n').find((line) => line.startsWith('static readout (from hid.schedule-start):')) ?? '';
  ok(readout.status === 0 && /native-regions\.ts record --model packages\/play\/profiles\/fnaf2\/moto-g56\/static-view-moto-g56-v207\.json --set static /.test(recorder)
    && /--out captures\/static-readouts\//.test(recorder) && adbCalls().length === 0,
    `a dry --static-readout run names its recorder, writing under captures/:\n${readout.stdout}\n${readout.stderr}`);
  console.log('night-run: --static-readout refuses a frame trace beside it and records native camera pixels under captures/');

  const half = run(nightRun('--live'), bare({ FNAF_SERIAL: FAKE }));
  ok(half.status === 2 && /both --live and --confirm-live/.test(half.stderr) && adbCalls().length === 0,
    `--live without --confirm-live must refuse before adb:\n${half.stderr}`);
  const both = run(nightRun('--dry-run', '--live', '--confirm-live'), bare({ FNAF_SERIAL: FAKE }));
  ok(both.status === 2 && /mutually exclusive/.test(both.stderr), `--dry-run --live must refuse:\n${both.stderr}`);
  const noSerial = run(nightRun('--live', '--confirm-live'), bare());
  ok(noSerial.status === 2 && noSerial.stderr.includes('local-profile.ts set <serial>') && adbCalls().length === 0
    && !existsSync(locks), `a live night with no serial must refuse before adb and the lease:\n${noSerial.stderr}`);
  console.log('night-run: a live night needs --live and --confirm-live, and refuses without a serial');

  // --- the FNaF 1, 3 and 4 wrappers: dry, and serial-less refusals ------------------
  // Each is a thin lease wrapper around a Node runner with the same contract.
  // The Custom Night runner composes Play with Propose's grid420, so it is the desktop's.
  const wrapperPath = name => (name === 'fnaf1-custom-run.sh' ? `apps/desktop/bin/${name}`
    : `packages/play/games/${name.split('-')[0]}/${name}`);
  const wrappers = {
    'fnaf1-night-run.sh': { live: ['--bt-audio', '--teach-overlay', '--night', '1', '--cursor-observed', '1'] },
    'fnaf1-custom-run.sh': { live: ['--dials', '0,0,0,0', '--mode', 'calibrate-empty'] },
    'fnaf3-run.sh': { live: ['--mode', 'calibrate'] },
    'fnaf4-run.sh': { live: ['--mode', 'calibrate'] },
    'fnaf1-menu-probe.sh': { live: ['--stage', 'title'] },
  };
  for (const [name, { live }] of Object.entries(wrappers)) {
    const script = wrapperPath(name);
    const dry = run([script], bare());
    const parsed = (() => { try { return JSON.parse(dry.stdout); } catch { return null; } })();
    ok(dry.status === 0 && parsed?.status === 'DRY_RUN', `${name} with no flag is not a dry run:\n${dry.stdout}\n${dry.stderr}`);
    ok(adbCalls().length === 0, `${name} dry called adb:\n  ${adbCalls().join('\n  ')}`);
    const unserialed = run([script, '--live', '--confirm-live', ...live], bare());
    ok(unserialed.status === 2 && unserialed.stderr.includes('local-profile.ts set <serial>') && adbCalls().length === 0,
      `${name} --live with no serial must refuse before adb and the lease:\n${unserialed.stdout}\n${unserialed.stderr}`);
  }
  ok(!existsSync(locks), 'a dry run or a serial-less refusal touched the lease directory');
  console.log(`FNaF 1/3/4 wrappers (${Object.keys(wrappers).join(', ')}): no flag is dry, and a live run without `
    + 'a serial refuses before adb and the lease');

  // A live run takes the serial lease before its first adb call (it took none
  // until 2026-09-27). With another owner holding it, the run holds at once.
  // The serial comes from --serial, or from the local profile when none is given.
  const holdLease = async (serial, body) => {
    const holder = spawn('python3', ['-c', [
      'import sys, time', `sys.path.insert(0, ${JSON.stringify(join(ROOT, 'packages/play/src/safety'))})`,
      'from companion_device_lock import DeviceLock', `lease = DeviceLock(${JSON.stringify(serial)}); lease.__enter__()`,
      "print('held', flush=True)", 'time.sleep(120)'].join('\n')],
    { env: { ...process.env, CUE_HELPER_LOCK_DIR: locks }, stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      await new Promise<any>((resolve, reject) => {
        holder.stdout.once('data', resolve);
        holder.once('exit', code => reject(new Error(`the lease holder exited ${code}`)));
      });
      body();
    } finally {
      holder.kill('SIGTERM');
      await new Promise<void>((resolve) => (holder.exitCode !== null ? resolve() : holder.once('exit', resolve)));
    }
  };
  await holdLease(FAKE, () => {
    for (const [how, argv, env] of [
      ['--serial', nightRun('--live', '--confirm-live', '--serial', FAKE), bare()],
      ['the local profile', nightRun('--live', '--confirm-live'), bare({ FNAF_LOCAL_PROFILE: profile })],
    ]) {
      const live = run(argv, env);
      ok(live.status === 75, `night-run --live (serial from ${how}) under another owner's lease did not hold:\n${live.stdout}\n${live.stderr}`);
      ok(live.stderr.includes(`DEVICE HOLD reason=device-busy serial=${FAKE}`), `night-run --live: no lease hold line:\n${live.stderr}`);
      ok(adbCalls().length === 0, `night-run --live called adb before it held the lease:\n  ${adbCalls().join('\n  ')}`);
    }
  });
  console.log('night-run: --live takes the serial lease before any adb call (serial from --serial or the local profile)');
  await holdLease(FAKE, () => {
    for (const [name, { live }] of Object.entries(wrappers)) {
      const held = run([wrapperPath(name), '--live', '--confirm-live', ...live], bare({ FNAF_SERIAL: FAKE }));
      ok(held.status === 75 && held.stderr.includes(`DEVICE HOLD reason=device-busy serial=${FAKE}`) && adbCalls().length === 0,
        `${name} --live under another owner's lease did not hold before adb:\n${held.stdout}\n${held.stderr}`);
    }
  });
  console.log('FNaF 1/3/4 wrappers: --live takes the serial lease before any adb call');


  // Exercise the actual EXIT handler with device-free stage doubles. A
  // repeated signal during reset must not cut off the observed-title or
  // evidence stages (the 2026-09-27 twin-loop interruption regression).
  const source = readFileSync(join(ROOT, 'packages/play/bin/phone/night-run.sh'), 'utf8');
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
  const exitCode = await new Promise<any>((resolve, reject) => {
    cleanup.once('error', reject);
    cleanup.once('close', (code, signal) => resolve({ code, signal }));
  });
  assert.deepEqual(exitCode, { code: 7, signal: null }, 'cleanup keeps the original result through repeated signals');
  assert.equal(signalled, true);
  assert.match(cleanupOutput, /title-observed[\s\S]*evidence-retained/);
  console.log('night-run cleanup: repeated interrupts cannot truncate physical cleanup or retained evidence');

  // The video grade is a promotion's independent witness (ADR 0002 principle
  // 11). On 2026-09-30 night-run.sh's grade wrapper ran taskset unguarded, and
  // on macOS, which has none, the grade of night5-s1toys5-20260930T132120Z
  // died on "nice: taskset: No such file or directory". grade-run.sh already
  // pins only where taskset exists; the runner must do the same.
  const runner = readFileSync(join(ROOT, 'packages/play/bin/phone/night-run.sh'), 'utf8');
  for (const line of runner.split('\n').filter((text) => /\btaskset\b/.test(text) && !/^\s*#/.test(text)))
    ok(/command -v taskset/.test(line), `night-run.sh runs taskset only where it exists: ${line.trim()}`);
  console.log(`night runners: ${checks} checks passed`);
} finally {
  for (const d of ours()) rmSync(join(runsDir, d), { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
}
