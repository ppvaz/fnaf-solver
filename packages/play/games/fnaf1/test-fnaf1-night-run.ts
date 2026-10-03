// Phone-free contracts for the FNaF 1-only attempt driver.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { AUDIO_LINK_ARGS, Fnaf1Controls, audioLinkState, night1Staging, parseArgs, validateRoute } from './fnaf1-night-run.ts';

const here = dirname(fileURLToPath(import.meta.url));
const route = JSON.parse(readFileSync(join(here, '../../profiles/fnaf1/moto-g56/fnaf1-community-loop-moto-g56-v207.json'), 'utf8'));
const controls = JSON.parse(readFileSync(join(here, '../../profiles/fnaf1/moto-g56/controls-fnaf1-moto-g56-v207.json'), 'utf8'));
const titleModel = JSON.parse(readFileSync(join(here, '../../profiles/fnaf1/moto-g56/title-fnaf1-moto-g56-v207.json'), 'utf8'));
const teachModel = JSON.parse(readFileSync(join(here, '../../profiles/fnaf1/moto-g56/teach-panel-fnaf1-moto-g56-v207.json'), 'utf8'));

assert.doesNotThrow(() => validateRoute(route, controls, titleModel, teachModel));
const night1 = night1Staging(route);
assert.equal(night1.bonnieArmedAtMs, 179000, 'Night 1 is hands-off until the sourced 2 AM boundary');
assert.equal(night1.rightAndCameraArmedAtMs, 268000, 'right/camera threats remain zero through 2 AM');
assert.ok(night1.leftCalibrationAtMs + night1.leftCalibrationBudgetMs + 3000 <= night1.bonnieArmedAtMs,
  'the one-time left calibration has a measured budget and a named 2 AM margin');
assert.ok(night1.firstLeftScanAtMs >= night1.bonnieArmedAtMs && night1.leftScanIntervalMs >= 7000,
  'Night 1 never scans before Bonnie can arm and does not churn the left light faster than its roll interval');
assert.ok(night1.rightAndMonitorCalibrationAtMs + night1.rightAndMonitorCalibrationBudgetMs <= night1.fullLoopAtMs &&
  night1.fullLoopAtMs + 2000 <= night1.rightAndCameraArmedAtMs,
  'right/camera preparation finishes before the sourced 3 AM boundary');
assert.deepEqual(parseArgs(['--dry-run']), {
  live: false, confirmLive: false, btAudio: false, teachOverlay: false, abortRestart: false,
  night: null, cursorObserved: null, label: null, dryRun: true,
});
assert.deepEqual(parseArgs(['--live', '--confirm-live', '--bt-audio', '--teach-overlay', '--night', '1', '--cursor-observed', '1', '--label', 'community-loop-a']), {
  live: true, confirmLive: true, btAudio: true, teachOverlay: true, abortRestart: false,
  night: 1, cursorObserved: 1, label: 'community-loop-a', dryRun: false,
});
assert.equal(parseArgs(['--live', '--confirm-live', '--bt-audio', '--teach-overlay', '--abort-restart',
  '--night', '1', '--cursor-observed', '1']).abortRestart, true,
  'an explicit live diagnostic may discard and relaunch an unbanked attempt');
assert.throws(() => parseArgs(['--abort-restart', '--dry-run']), /only valid for an explicit live run/);
assert.throws(() => parseArgs(['--live', '--confirm-live', '--night', '1', '--cursor-observed', '1']), /requires --bt-audio/);
assert.throws(() => parseArgs(['--live', '--confirm-live', '--bt-audio', '--night', '1', '--cursor-observed', '1']), /requires --teach-overlay/);
assert.throws(() => parseArgs(['--live', '--confirm-live', '--bt-audio', '--teach-overlay', '--night', '1', '--cursor-observed', '2']), /conflicts/);
assert.equal(audioLinkState({ code: 0, stdout: 'audio-route=READY transport=bluealsa\n', stderr: '' }), 'READY');
assert.equal(audioLinkState({ code: 1, stdout: '', stderr: 'audio-route=UNKNOWN reason=a2dp-stream-not-running\n' }), 'CONNECTED_NOT_STREAMING');
assert.equal(audioLinkState({ code: 1, stdout: '', stderr: 'audio-route=UNKNOWN reason=a2dp-source-not-connected\n' }), 'UNAVAILABLE');

// The title gate and the teaching overlay are FNaF 1's: validateRoute accepts only the tools this runner executes.
const refusesRoute = (what: string, edit: (r: typeof route, t: typeof teachModel) => void) => {
  const r = structuredClone(route);
  const t = structuredClone(teachModel);
  edit(r, t);
  assert.throws(() => validateRoute(r, controls, titleModel, t), what);
};
refusesRoute('the FNaF 2 title model is not reachable', (r) => { r.title.model = 'packages/play/profiles/fnaf2/moto-g56/title-moto-g56-v207.json'; });
refusesRoute('the FNaF 2 title observer is not reachable', (r) => { r.title.observer = 'packages/play/src/sensors/screencap/title-observe.py'; });
refusesRoute('the teaching tool is the FNaF 1 overlay', (r) => { r.teachingOverlay.tool = 'packages/play/bin/phone/menu.sh'; });
// Since 2026-10-01 the presenter is the Companion's FNaF 1 strip, not a second APK.
refusesRoute('the presenter is not the retired FNaF 1 teaching APK', (_r, t) => { t.presenter.package = 'com.ppvaz.fnaf1teach'; });
refusesRoute('the presenter is the Companion\'s f1strip lesson', (_r, t) => { t.presenter.lesson = 'f2strip'; });
assert.deepEqual(AUDIO_LINK_ARGS, ['--ensure', '--game-package', 'com.scottgames.fivenightsatfreddys'],
  'the Bluetooth settings fallback restores the FNaF 1 package');

// Night 1's runtime control gate: before its window opens, no press or pan reaches the HID transport.
{
  const sent: unknown[] = [];
  const gated = new Fnaf1Controls({
    hid: { send: async (input: unknown) => { sent.push(input); } } as unknown as ConstructorParameters<typeof Fnaf1Controls>[0]['hid'],
    record: { event: async () => ({}) } as unknown as ConstructorParameters<typeof Fnaf1Controls>[0]['record'],
    bridge: {} as ConstructorParameters<typeof Fnaf1Controls>[0]['bridge'],
    route, controls, notBeforeControlMs: performance.now() + 60000 });
  await assert.rejects(gated.press('leftDoor'), /Night 1 hands-off gate refused leftDoor/);
  await assert.rejects(gated.panTo('right'), /Night 1 hands-off gate refused pan-right/);
  assert.equal(sent.length, 0, 'a refused control sends nothing');
}

// A live run outside the wrapper is refused before it resolves a serial or touches a phone.
{
  const live = spawnSync(process.execPath, [join(here, 'fnaf1-night-run.ts'), '--live', '--confirm-live', '--bt-audio',
    '--teach-overlay', '--night', '1', '--cursor-observed', '1'], { encoding: 'utf8', timeout: 60000,
    env: { ...process.env, FNAF1_LEASE_HELD: '' } });
  assert.equal(live.status, 2, `a live run without the lease exits 2 (${live.status}: ${live.stderr.trim().split('\n').at(-1)})`);
  assert.match(live.stderr, /serial lease is held/);
}

const wrapper = readFileSync(join(here, 'fnaf1-night-run.sh'), 'utf8');
assert.ok(wrapper.includes('device-lock-exec.py') && wrapper.includes('FNAF1_LEASE_HELD=1'),
  'the live wrapper must acquire the serial lease before running the driver');

console.log('fnaf1 night runner: FNaF 1 title isolation, audio requirement, and lease gate pass');
