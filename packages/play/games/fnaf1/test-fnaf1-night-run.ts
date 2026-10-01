// Phone-free contracts for the FNaF 1-only attempt driver.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioLinkState, night1Staging, parseArgs, validateRoute } from './fnaf1-night-run.ts';

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

const source = readFileSync(join(here, 'fnaf1-night-run.ts'), 'utf8');
assert.ok(source.includes("'fnaf1-title-observe.sh'"), 'FNaF 1 runner must name the FNaF 1 title wrapper');
assert.ok(!source.includes('title-moto-g56-v207.json'), 'FNaF 2 title model must not be reachable from the FNaF 1 runner');
assert.ok(!source.includes("'menu.sh'"), 'FNaF 1 runner must not route title input through menu.sh');
assert.ok(source.includes("'--game-package', PACKAGE"), 'Bluetooth settings fallback must restore the FNaF 1 package');
assert.ok(source.includes('requires --bt-audio'), 'live runs must retain passive audio');
assert.ok(source.includes('requires --teach-overlay') && source.includes("'fnaf1-teach-overlay.ts'"),
  'live runs must require and verify the FNaF 1 teaching overlay');
// Since 2026-10-01 the presenter is the Companion's FNaF 1 strip, not a second APK.
assert.ok(source.includes("presenter?.lesson !== 'f1strip'") && !source.includes('com.ppvaz.fnaf1teach'),
  'the FNaF 1 teaching presenter is the Companion\'s f1strip lesson');
assert.ok(source.includes('stageNight1') && source.includes('Night 1 hands-off gate'),
  'Night 1 must have a runtime control gate and staged source-derived opening');

const wrapper = readFileSync(join(here, 'fnaf1-night-run.sh'), 'utf8');
assert.ok(wrapper.includes('device-lock-exec.py') && wrapper.includes('FNAF1_LEASE_HELD=1'),
  'the live wrapper must acquire the serial lease before running the driver');

console.log('fnaf1 night runner: FNaF 1 title isolation, audio requirement, and lease gate pass');
