import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecFileOptions } from 'node:child_process';
import { AdbDeviceBridge, parseAdbDevices } from '../src/campaign/adb-bridge.ts';
import { restartCompanionCapture } from '../src/campaign/companion-capture.ts';
import { AdbCompanionPort, parseCompanionLogEndpoint } from '../src/campaign/physical-ports.ts';

assert.deepEqual(parseAdbDevices('List of devices attached\nusb-1\tdevice product/foo transport_id:1\noffline\toffline\n'), [
  { serial: 'usb-1', status: 'device', details: ['product/foo', 'transport_id:1'] },
  { serial: 'offline', status: 'offline', details: [] },
]);
assert.deepEqual(parseCompanionLogEndpoint('I/FnafCueHelper: control=DEGRADED port=49707 token=0123456789abcdef0123456789abcdef\n'), {
  port: 49707, token: '0123456789abcdef0123456789abcdef',
});
assert.throws(() => parseCompanionLogEndpoint('control=READY port=1 token=short'), /endpoint has no bounded/);
assert.throws(() => new AdbCompanionPort({ serial: 'usb-1' }).request('SHELL anything'), /outside the authenticated/);

const scratch = mkdtempSync(join(tmpdir(), 'helper-discovery-'));
try {
  const adb = join(scratch, 'adb.cjs');
  writeFileSync(adb, `#!/usr/bin/env node
const {execFileSync} = require('node:child_process');
const {readFileSync} = require('node:fs');
const {dirname} = require('node:path');
const args = process.argv.slice(2);
if (args.includes('pidof')) { console.log('1234'); }
else if (args.includes('sh')) {
  process.stdout.write(execFileSync('sh', ['-s', '--', args.at(-1)], {
    input: readFileSync(0), env: {...process.env, PATH: dirname(__filename) + ':' + process.env.PATH},
  }));
} else { process.exitCode = 2; }
`, { mode: 0o755 });
  writeFileSync(join(scratch, 'logcat'), `#!/usr/bin/env node
const args = process.argv.slice(2);
  const rows = [
    'I/FnafCueHelper: control=DEGRADED port=49707 token=0123456789abcdef0123456789abcdef',
    ...Array(20000).fill('I/FnafCueHelper: captured native frame; repeated capture diagnostics fill the log buffer'),
    ...Array(20000).fill('I/FnafCueHelper: control=READY port=49707 token=0123456789abcdef0123456789abcdef'),
    'I/FnafCueHelper: control=READY port=49708 token=fedcba9876543210fedcba9876543210',
  ];
  const at = args.indexOf('-e');
  const filter = at < 0 ? null : new RegExp(args[at + 1]);
  console.log(rows.filter(row => !filter || filter.test(row)).join('\\n'));
`, { mode: 0o755 });
  assert.deepEqual(new AdbCompanionPort({ serial: 'usb-1', adb }).discover(), {
    port: 49708, token: 'fedcba9876543210fedcba9876543210',
  }, 'capture diagnostics exceeding 1 MB do not hide the latest helper endpoint');
} finally { rmSync(scratch, { recursive: true, force: true }); }

// The Companion's endpoint file (companion-endpoint-v1) is read first: it
// cannot rotate out of logcat, and it must belong to the running helper.
const fileScratch = mkdtempSync(join(tmpdir(), 'helper-endpoint-file-'));
try {
  const adb = join(fileScratch, 'adb.cjs');
  writeFileSync(adb, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('pidof')) { console.log(process.env.MOCK_PID || '1234'); }
else if (args.includes('run-as')) {
  process.stdout.write('schema=companion-endpoint-v1\\napp=0.2.0\\ncode=16\\nsession=3\\npid=1234\\nport=49707\\n'
    + 'socket=com.fnaf2.cuehelper.control.3\\ntoken=00112233445566778899aabbccddeeff\\n');
} else { process.exitCode = 2; }
`, { mode: 0o755 });
  assert.deepEqual(new AdbCompanionPort({ serial: 'usb-1', adb }).discover(), {
    port: 49707, token: '00112233445566778899aabbccddeeff', socket: 'com.fnaf2.cuehelper.control.3',
    session: 3, source: 'endpoint-file',
  }, 'the endpoint file is the discovery source when present');
  process.env.MOCK_PID = '999';
  assert.throws(() => new AdbCompanionPort({ serial: 'usb-1', adb }).discover(),
    /belongs to pid 1234, not the running helper 999/, 'a stale endpoint file from another process is refused');
  delete process.env.MOCK_PID;
} finally { rmSync(fileScratch, { recursive: true, force: true }); }

const noAdb = new AdbDeviceBridge({ run: async () => ({ ok: false, code: 'ENOENT', stdout: '', stderr: 'adb missing' }) });
const noAdbPreflight = await noAdb.preflight({ targetBuild: 'com.scottgames.fnaf2:2.0.7+26' });
const { venue: noAdbVenue, ...noAdbRecord } = noAdbPreflight;
assert.deepEqual(noAdbRecord, {
  schema: 'device-preflight-v2', version: 2, status: 'HOLD', reason: 'adb-unavailable',
  checks: [{ id: 'adb-device', status: 'HOLD', detail: 'adb missing' }], devices: [],
});
assert.equal(noAdbVenue.status, 'UNBOUND', 'no device and no binding: unbound, nothing observed');
assert.equal(noAdbVenue.observed, null);

const run = async (args: readonly string[], options: { maxBuffer?: number } = {}) => {
  if (args.includes('exec-out')) {
    assert.equal(options.maxBuffer, 16 * 1024 * 1024,
      'full-resolution PNG capture must have a bounded buffer above 2 MB');
    return { ok: true, stdout: Buffer.from('png'), stderr: '' };
  }
  if (args[0] === 'devices') return { ok: true, stdout: 'List of devices attached\nusb-1\tdevice usb:1-1\n', stderr: '' };
  if (args.at(-1) === 'get-state') return { ok: true, stdout: 'device\n', stderr: '' };
  if (args.includes('pm')) return { ok: true, stdout: 'package:/data/app/com.scottgames.fnaf2/base.apk\n', stderr: '' };
  if (args.includes('dumpsys') && args.includes('package')) return { ok: true, stdout: 'versionCode=26 versionName=2.0.7\n', stderr: '' };
  // getprop's last argument is the property it reads.
  if (args.includes('getprop')) return { ok: true, stdout: ({ 'ro.build.fingerprint': 'motorola/fake/fake:15/V1FAKE.1/abc:user/release-keys',
    'ro.build.version.security_patch': '2026-08-01', 'persist.sys.timezone': 'America/Sao_Paulo' } as Readonly<Record<string, string>>)[args.at(-1) as string] + '\n', stderr: '' };
  if (args.includes('power')) return { ok: true, stdout: 'mWakefulness=Awake\n', stderr: '' };
  if (args.includes('window')) return { ok: true, stdout: 'mCurrentFocus=Window{ com.scottgames.fnaf2/.MainActivity }\nisKeyguardShowing=false\nmInputRestricted=false\n', stderr: '' };
  if (args.includes('wm')) return { ok: true, stdout: 'Physical size: 1080x2400\n', stderr: '' };
  if (args.includes('ls')) return { ok: true, stdout: '/system/bin/hid\n', stderr: '' };
  if (args.includes('pidof')) return { ok: true, stdout: '1234\n', stderr: '' };
  if (args.includes('logcat')) return { ok: true, stdout: 'I/FnafCueHelper: control=READY port=49707 token=0123456789abcdef0123456789abcdef\n', stderr: '' };
  if (args.includes('date')) return { ok: true, stdout: '1760000000123\n', stderr: '' };
  if (args.at(-1)?.includes('boot_id')) return { ok: true, stdout: '377068.03 7654321.00\nb0c1d2e3-1111-2222-3333-444455556666\n', stderr: '' };
  throw new Error(`unexpected adb ${args.join(' ')}`);
};
const bridge = new AdbDeviceBridge({ serial: 'usb-1', run });
const ready = await bridge.preflight({ targetBuild: 'com.scottgames.fnaf2:2.0.7+26' });
assert.equal(ready.status, 'READY');
assert.equal(ready.serial, 'usb-1');
assert.ok(ready.checks.every(item => item.status === 'PASS'));
assert.equal(ready.schema, 'device-preflight-v2');
assert.equal(ready.venue.status, 'UNBOUND', 'every committed profile is unbound: recorded, not refused');
assert.equal(ready.venue.observed?.versionCode, '26');

let captureRestart;
const restartedPreflightBridge = new AdbDeviceBridge({ serial: 'usb-1', run,
  // A fake restart: the bridge reads only its status and output.
  captureRestart: async options => { captureRestart = options;
    return { status: 'READY', output: 'CAPTURE started' } as Awaited<ReturnType<typeof restartCompanionCapture>>; } });
const restartedPreflight = await restartedPreflightBridge.preflight({
  targetBuild: 'com.scottgames.fnaf2:2.0.7+26', restartCapture: true });
assert.equal(restartedPreflight.status, 'READY');
assert.deepEqual(captureRestart, { serial: 'usb-1', adb: 'adb', target: 'fnaf2', screen: 'menu', waitSeconds: 30 });
assert.deepEqual(restartedPreflight.checks.find(item => item.id === 'cue-helper-capture-restart'), {
  id: 'cue-helper-capture-restart', status: 'PASS', detail: 'CAPTURE started',
});

let setupCall = undefined as [file: string, args: readonly string[], options: ExecFileOptions] | undefined;
await assert.rejects(() => restartCompanionCapture({ serial: 'usb-1', adb: '/mock/adb',
  run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) }), /explicit target game/,
  'a capture restart without a named target is refused: setup has no default game');
const captureResult = await restartCompanionCapture({ serial: 'usb-1', adb: '/mock/adb', target: 'fnaf4',
  run: async (...args) => { setupCall = args; return { exitCode: 0, stdout: 'CAPTURE started\n', stderr: '' }; } });
assert.equal(captureResult.status, 'READY');
assert.deepEqual(setupCall?.[1], ['--restart-capture', '--target', 'fnaf4', '--screen', 'menu', '--wait', '30']);
assert.equal(setupCall?.[2].env?.ANDROID_SERIAL, 'usb-1');
assert.equal(setupCall?.[2].env?.ADB_BIN, '/mock/adb');

// The fake adb answers date, so this is the READY sample with its device reading.
const clock = await bridge.clockSample() as Extract<Awaited<ReturnType<typeof bridge.clockSample>>, { status: 'READY' }>;
assert.equal(clock.status, 'READY');
assert.equal(clock.serial, 'usb-1');
assert.equal(clock.deviceMs, 1760000000123);
assert.ok(clock.roundTripMs >= 0);
assert.ok(clock.uncertaintyMs >= 1);
assert.equal(clock.deviceWindow.startMs, clock.deviceMs - clock.uncertaintyMs);
assert.equal(clock.deviceWindow.endMs, clock.deviceMs + clock.uncertaintyMs);

const uptime = await bridge.uptimeSample();
assert.equal(uptime.status, 'READY');
assert.equal(uptime.schema, 'device-uptime-sample-v1');
assert.equal(uptime.serial, 'usb-1');
assert.equal(uptime.bootId, 'b0c1d2e3-1111-2222-3333-444455556666');
assert.equal(uptime.sourceMs, 377068030);
assert.ok(uptime.targetAfterMs >= uptime.targetBeforeMs);
assert.equal(uptime.quantizationMs, 5);
const garbageUptime = new AdbDeviceBridge({ serial: 'usb-1',
  run: async args => args.includes('uptime') ? { ok: true, stdout: 'garbage\n', stderr: '' } :
    { ok: true, stdout: '', stderr: '' } });
const unparseable = await garbageUptime.uptimeSample();
assert.equal(unparseable.status, 'HOLD');
assert.equal(unparseable.reason, 'device-uptime-unparseable');
const missingUptime = new AdbDeviceBridge({ serial: undefined,
  run: async () => ({ ok: false, code: 'ENOENT', stdout: '', stderr: 'adb missing' }) });
const held = await missingUptime.uptimeSample();
assert.equal(held.status, 'HOLD');
assert.equal(held.reason, 'adb-unavailable');
const captured = await bridge.capturePng('usb-1');
assert.deepEqual(captured, Buffer.from('png'));

const restartCalls: (readonly string[])[] = [];
const restartBridge = new AdbDeviceBridge({ serial: 'usb-1', run: async args => {
  restartCalls.push(args);
  if (args.includes('resolve-activity'))
    return { ok: true, stdout: 'priority=0\ncom.scottgames.fnaf2/.Main\n', stderr: '' };
  if (args.includes('force-stop') || args.includes('start'))
    return { ok: true, stdout: '', stderr: '' };
  throw new Error(`unexpected restart adb ${args.join(' ')}`);
} });
assert.deepEqual(await restartBridge.restartGame(), {
  status: 'READY', stage: 'start', launcher: 'com.scottgames.fnaf2/.Main', detail: 'com.scottgames.fnaf2/.Main',
});
assert.deepEqual(restartCalls, [
  ['-s', 'usb-1', 'shell', 'am', 'force-stop', 'com.scottgames.fnaf2'],
  ['-s', 'usb-1', 'shell', 'cmd', 'package', 'resolve-activity', '--brief', 'com.scottgames.fnaf2'],
  ['-s', 'usb-1', 'shell', 'am', 'start', '-n', 'com.scottgames.fnaf2/.Main'],
]);

console.log('adb bridge: closed command set, selection, build, lock, focus, HID, helper and venue record gates pass');
