#!/usr/bin/env node
/**
 * Bounded FNaF 1 story-night attempt with native-frame door sensing and
 * retained Bluetooth audio.
 *
 * This is deliberately independent from `night-run.sh`: that driver is a
 * FNaF 2 artifact runner and its title model defaults to FNaF 2.  This runner
 * accepts only Continue on the FNaF 1-specific observer, records FNaF 1's
 * resolved models/hashes, and never invokes `menu.sh`.
 *
 * Usage (the shell wrapper holds the serial lease; without --live it is a dry
 * run that prints the resolved bindings and touches no phone):
 *   tools/device/fnaf1-night-run.sh [--dry-run]
 *   tools/device/fnaf1-night-run.sh --live --confirm-live --bt-audio --teach-overlay [--abort-restart] \
 *       --night 1 --cursor-observed 1 --label community-loop-a
 *
 * `--cursor-observed` is an operator/visual attestation written into the run
 * record, not OCR.  The actual title gate is three fresh native FNaF 1 title
 * reads containing Continue.  The saved title frames remain with the run so a
 * later reader can check the cursor rather than trusting this argument.
 */
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, stat, writeFile, appendFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { AdbDeviceBridge } from '../../apps/device/src/adb-bridge.js';
import { AdbHidProcess } from '../../apps/device/src/physical-ports.js';
import { HidWireTransport } from '../../packages/play/src/venues/phone/hid.js';
import { resolveSerial } from './local-profile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const PACKAGE = 'com.scottgames.fivenightsatfreddys';
const BUILD = '2.0.7+40';
const ROUTE_PATH = join(HERE, 'models/fnaf1-community-loop-moto-g56-v207.json');
const CONTROL_PATH = join(HERE, 'models/controls-fnaf1-moto-g56-v207.json');
const TITLE_MODEL_PATH = join(HERE, 'models/title-fnaf1-moto-g56-v207.json');
const TITLE_OBSERVER = join(HERE, 'fnaf1-title-observe.sh');
const DOOR_SENSOR = join(HERE, 'fnaf1-door-light.py');
const TEACH_MODEL_PATH = join(HERE, 'models/teach-panel-fnaf1-moto-g56-v207.json');
const TEACH_OVERLAY = join(HERE, 'fnaf1-teach-overlay.sh');
const AUDIO_LINK = join(ROOT, 'tools/cue/bt-audio-link.sh');
const AUDIO_CAPTURE = join(ROOT, 'tools/cue/capture-bt-audio.sh');
const TEARDOWN = join(HERE, 'game-teardown.sh');
const TITLE_INTERVAL_MS = 250;

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
const stamp = () => new Date().toISOString().replace(/[-:.]/g, '').replace('T', 'T').replace('Z', 'Z');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Wait in one-second slices so an abort request never hides behind a long idle. */
async function waitUntil(monotonicMs, shouldStop = () => false) {
  while (!shouldStop()) {
    const remaining = monotonicMs - performance.now();
    if (remaining <= 0) return true;
    await sleep(Math.min(remaining, 1000));
  }
  return false;
}

function fail(message) { throw new Error(`fnaf1-night-run: ${message}`); }

function parseInteger(value, name, { min, max }) {
  if (!/^[0-9]+$/.test(String(value))) fail(`${name} must be an integer`);
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max)
    fail(`${name} must be ${min}..${max}`);
  return number;
}

export function parseArgs(argv) {
  const options = { live: false, confirmLive: false, btAudio: false, teachOverlay: false, abortRestart: false, night: null,
    cursorObserved: null, label: null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--live') options.live = true;
    else if (arg === '--confirm-live') options.confirmLive = true;
    else if (arg === '--bt-audio') options.btAudio = true;
    else if (arg === '--teach-overlay') options.teachOverlay = true;
    else if (arg === '--abort-restart') options.abortRestart = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--night') options.night = parseInteger(argv[++index], '--night', { min: 1, max: 2 });
    else if (arg === '--cursor-observed') options.cursorObserved = parseInteger(argv[++index], '--cursor-observed', { min: 1, max: 2 });
    else if (arg === '--label') options.label = String(argv[++index] ?? '');
    else fail(`unknown argument ${arg}`);
  }
  if (options.label !== null && !/^[a-z0-9][a-z0-9-]{0,47}$/.test(options.label))
    fail('--label must be 1..48 lowercase letters, digits, or hyphens');
  if (options.dryRun && options.live) fail('--dry-run and --live are mutually exclusive');
  if (options.abortRestart && !options.live) fail('--abort-restart is only valid for an explicit live run');
  // Dry unless --live (ADR 0002, 2026-09-29): no flag prints the bindings and touches no phone.
  if (!options.live) options.dryRun = true;
  if (!options.dryRun) {
    if (!options.confirmLive) fail('live actuation needs both --live and --confirm-live');
    if (!options.btAudio) fail('a live FNaF 1 run requires --bt-audio for retained passive evidence');
    if (!options.teachOverlay) fail('a live FNaF 1 run requires --teach-overlay for the verified passive teaching presenter');
    if (options.night === null || options.cursorObserved === null)
      fail('a live run needs --night and the visually checked --cursor-observed');
    if (options.night !== options.cursorObserved)
      fail(`requested Night ${options.night} conflicts with cursor attestation Night ${options.cursorObserved}`);
  }
  return Object.freeze(options);
}

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function fileHash(path) { return sha256(await readFile(path)); }
async function executable(path) { await access(path, fsConstants.X_OK); }

export function validateRoute(route, controls, titleModel, teachModel) {
  if (route?.schema !== 'fnaf1-device-route-v1') fail('route schema is not fnaf1-device-route-v1');
  if (route?.target?.package !== PACKAGE || route?.target?.build !== BUILD || route?.target?.launcher !== '.Main')
    fail('route targets the wrong game or build');
  if (route?.title?.observer !== 'tools/device/fnaf1-title-observe.sh' ||
      route?.title?.model !== 'tools/device/models/title-fnaf1-moto-g56-v207.json' ||
      route?.title?.requiredItem !== 'continue' || route?.title?.consensusFrames !== 3)
    fail('route title gate is not the FNaF 1 Continue-only observer');
  if (titleModel?.schema !== 'title-model-v1' ||
      !String(titleModel?.build ?? '').startsWith(`${PACKAGE} v2.0.7 versionCode 40`) ||
      !Array.isArray(titleModel?.items?.continue) || titleModel.items.continue.length !== 2 ||
      !titleModel.items.continue.every(Number.isInteger))
    fail('title model is not the measured FNaF 1 Continue binding');
  if (route?.audio?.required !== true || !/Passive/.test(route?.audio?.purpose ?? ''))
    fail('route does not require passive retained audio');
  if (route?.teachingOverlay?.required !== true ||
      route.teachingOverlay.tool !== 'tools/device/fnaf1-teach-overlay.sh' ||
      route.teachingOverlay.model !== 'tools/device/models/teach-panel-fnaf1-moto-g56-v207.json' ||
      route.teachingOverlay.schema !== 'fnaf1-teach-overlay-v1')
    fail('route does not require the isolated FNaF 1 teaching overlay');
  if (teachModel?.schema !== 'fnaf1-teach-overlay-v1' ||
      teachModel?.target?.package !== PACKAGE || teachModel?.target?.build !== BUILD ||
      teachModel?.presenter?.package !== 'com.ppvaz.fnaf1teach' ||
      !Array.isArray(teachModel?.stages) || !teachModel.stages.includes('full-loop'))
    fail('teaching overlay model is not the FNaF 1 passive presenter binding');
  if (route?.controls?.contactMs !== 160 || route?.controls?.startsAtPan !== 0)
    fail('route control contact/start pan disagrees with the measured map');
  if (controls?.target?.package !== PACKAGE || controls?.target?.version !== BUILD)
    fail('control model targets the wrong game or build');
  if (controls?.view?.startsAt !== 0 || controls?.view?.maxPanPx !== 600 || controls?.view?.scale !== 1.875)
    fail('control model has an unexpected pan geometry');
  for (const [side, expected] of Object.entries({ left: 0, right: 600 })) {
    const pan = controls?.panMap?.[side];
    if (!pan || pan.resultingPan !== expected || pan.durationMs !== 310 ||
        pan.claimLevel !== 'SOURCE_DERIVED' || pan.durationClaimLevel !== 'DEVICE_MEASURED')
      fail(`control model's ${side} pan is not the qualified/source-derived binding`);
  }
  if (!(controls.panMap.left.x < 153 * controls.view.scale) ||
      !(controls.panMap.right.x > 1143 * controls.view.scale))
    fail('pan points fall outside their source-derived edge bands');
  for (const control of ['leftDoor', 'leftDoorLight', 'rightDoor', 'rightDoorLight', 'monitor']) {
    const point = controls.controlMap?.[control];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
      fail(`control model has no finite ${control} point`);
  }
  for (const key of ['lightAfterPressMs', 'flipSettleMs', 'cameraUpDwellMs', 'officeReadyDelayMs', 'doorRecheckMs', 'actionBoundMs']) {
    if (!Number.isInteger(route?.timing?.[key]) || route.timing[key] < 1)
      fail(`route timing ${key} is missing`);
  }
  night1Staging(route);
  return Object.freeze({ route, controls, titleModel, teachModel });
}

/**
 * Validate the Night 1-only hands-off staging plan. Its source facts are
 * numeric gates here rather than explanatory prose in JSON, so a later edit
 * cannot quietly reintroduce the midnight full loop.
 */
export function night1Staging(route) {
  const staging = route?.night1Staging;
  const keys = ['bonnieArmedAtMs', 'leftCalibrationAtMs', 'leftCalibrationBudgetMs',
    'leftCalibrationObservedMs', 'firstLeftScanAtMs', 'leftScanIntervalMs',
    'rightAndCameraArmedAtMs', 'rightAndMonitorCalibrationAtMs',
    'rightAndMonitorCalibrationBudgetMs', 'rightAndMonitorObservedMs', 'fullLoopAtMs'];
  for (const key of keys) {
    if (!Number.isInteger(staging?.[key]) || staging[key] < 1)
      fail(`Night 1 staging ${key} is missing`);
  }
  if (staging.bonnieArmedAtMs !== 179000 || staging.rightAndCameraArmedAtMs !== 268000)
    fail('Night 1 staging does not use the sourced 2 AM / 3 AM boundaries');
  if (staging.leftCalibrationObservedMs > staging.leftCalibrationBudgetMs ||
      staging.leftCalibrationAtMs + staging.leftCalibrationBudgetMs + 3000 > staging.bonnieArmedAtMs)
    fail('Night 1 left calibration does not clear 2 AM with a measured budget and 3 s margin');
  if (staging.firstLeftScanAtMs < staging.bonnieArmedAtMs || staging.leftScanIntervalMs < 7000)
    fail('Night 1 starts a left scan before Bonnie can arm or rechecks faster than the sourced interval');
  if (staging.rightAndMonitorObservedMs > staging.rightAndMonitorCalibrationBudgetMs ||
      staging.rightAndMonitorCalibrationAtMs + staging.rightAndMonitorCalibrationBudgetMs > staging.fullLoopAtMs ||
      staging.fullLoopAtMs + 2000 > staging.rightAndCameraArmedAtMs)
    fail('Night 1 right/monitor preparation does not clear 3 AM with its measured budget');
  return Object.freeze({ ...staging });
}

function run(command, args, { input = null, timeoutMs = 15000, env = {} } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: ROOT, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env } });
    const stdout = [], stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, timedOut, stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8') });
    });
    if (input === null) child.stdin.end(); else child.stdin.end(input);
  });
}

function parseJsonLine(text, context) {
  try { return JSON.parse(text.trim()); }
  catch { fail(`${context} did not return JSON: ${text.trim() || 'empty'}`); }
}

function relativeToRoot(path) { return relative(ROOT, path).replaceAll('\\', '/'); }

/**
 * `capture-bt-audio.sh --start` deliberately accepts a connected PCM that is
 * not running yet: title/menu music can be suspended until the game resumes.
 * Do not collapse that state into a disconnected route.  The recorder still
 * does the authoritative `bluealsa-cli info` check before it opens anything.
 */
export function audioLinkState(result) {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.code === 0 && /audio-route=READY\b/.test(output)) return 'READY';
  if (/audio-route=UNKNOWN reason=a2dp-stream-not-running\b/.test(output)) return 'CONNECTED_NOT_STREAMING';
  return 'UNAVAILABLE';
}

class RunRecord {
  constructor({ id, outdir, captureDir, options, bindings }) {
    this.id = id; this.outdir = outdir; this.captureDir = captureDir;
    this.document = {
      schema: 'fnaf1-device-run-v1', id, startedAt: new Date().toISOString(),
      claimLevel: 'DEVICE_MEASURED controls/screencaps/audio capture; route timing is SOURCE_DERIVED where named',
      target: { package: PACKAGE, build: BUILD }, options, bindings,
      capture: { sensor: 'screencap-2400x1080', directory: captureDir, frames: [] },
      events: [], status: 'STARTING', terminal: 'UNKNOWN', audio: { requested: options.btAudio },
    };
    this.eventsPath = join(outdir, 'events.jsonl');
  }

  async event(type, fields = {}) {
    const row = { atWallMs: Date.now(), atMonotonicMs: Math.round(performance.now()), type, ...fields };
    this.document.events.push(row);
    await appendFile(this.eventsPath, `${JSON.stringify(row)}\n`);
    return row;
  }

  async capture(name, png) {
    const filename = `${String(this.document.capture.frames.length).padStart(4, '0')}-${name}.png`;
    const path = join(this.captureDir, filename);
    await writeFile(path, png);
    const frame = { name, path, sha256: sha256(png), bytes: png.length, atWallMs: Date.now() };
    this.document.capture.frames.push(frame);
    await this.event('capture', { ...frame });
    return path;
  }

  async save(status) {
    this.document.status = status;
    this.document.updatedAt = new Date().toISOString();
    await writeFile(join(this.outdir, 'run.json'), `${JSON.stringify(this.document, null, 2)}\n`);
  }
}

async function titleRead(bridge, record, label) {
  const png = await bridge.capturePng(bridge.serial);
  if (!png) fail('native title capture failed');
  const path = await record.capture(label, png);
  const observed = await run(TITLE_OBSERVER, [], { input: png, timeoutMs: 10000 });
  const result = { confident: observed.code === 0, output: observed.stdout.trim(), stderr: observed.stderr.trim(),
    frame: path, code: observed.code };
  await record.event('title-read', result);
  return result;
}

async function titleConsensus(bridge, record, frames, prefix) {
  const reads = [];
  for (let index = 0; index < frames; index += 1) {
    const read = await titleRead(bridge, record, `${prefix}-${index + 1}`);
    reads.push(read);
    await sleep(TITLE_INTERVAL_MS);
  }
  const values = reads.map(read => read.output);
  if (reads.some(read => !read.confident) || new Set(values).size !== 1 || !values[0].split('=')[1]?.split(',').includes('continue'))
    fail(`FNaF 1 title consensus refused: ${values.join(' | ')}`);
  return reads[0];
}

async function waitForTitleToLeave(bridge, record) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(1000);
    const read = await titleRead(bridge, record, `after-continue-${attempt + 1}`);
    if (!read.confident && /not-the-title-screen/.test(`${read.output} ${read.stderr}`)) return;
  }
  fail('Continue did not leave the observed FNaF 1 title within the bounded start wait');
}

class Fnaf1Controls {
  constructor({ hid, record, route, controls, bridge, notBeforeControlMs = null }) {
    this.hid = hid; this.record = record; this.route = route; this.controls = controls; this.bridge = bridge;
    this.pan = controls.view.startsAt;
    this.doors = { left: { closed: false, recheckAt: 0 }, right: { closed: false, recheckAt: 0 } };
    this.notBeforeControlMs = notBeforeControlMs;
  }

  point(control) { return this.controls.controlMap[control]; }

  assertControlWindow(action) {
    if (this.notBeforeControlMs !== null && performance.now() < this.notBeforeControlMs)
      fail(`Night 1 hands-off gate refused ${action} before ${Math.round(this.notBeforeControlMs)} ms`);
  }

  async press(control, durationMs = this.route.controls.contactMs, detail = {}) {
    this.assertControlWindow(control);
    const point = this.point(control);
    await this.record.event('input.requested', { control, point: { x: point.x, y: point.y }, durationMs,
      pan: this.pan, ...detail });
    await this.hid.send({ command: { action: { kind: 'press', durationMs } }, point });
    await this.record.event('input.released', { control, durationMs, pan: this.pan, ...detail });
  }

  async panTo(side) {
    const binding = this.controls.panMap[side];
    if (this.pan === binding.resultingPan) return;
    this.assertControlWindow(`pan-${side}`);
    await this.record.event('pan.requested', { side, point: { x: binding.x, y: binding.y },
      durationMs: binding.durationMs, fromPan: this.pan, resultingPan: binding.resultingPan,
      claimLevel: binding.claimLevel, durationClaimLevel: binding.durationClaimLevel });
    await this.hid.send({ command: { action: { kind: 'hold', durationMs: binding.durationMs } },
      point: { x: binding.x, y: binding.y } });
    this.pan = binding.resultingPan;
    await this.record.event('pan.released', { side, pan: this.pan });
  }

  async toggleLight(side) {
    await this.press(side === 'left' ? 'leftDoorLight' : 'rightDoorLight', undefined, { side, action: 'toggle-light' });
    await sleep(this.route.timing.lightAfterPressMs);
  }

  async setDoor(side, closed, reason) {
    const state = this.doors[side];
    if (state.closed === closed) return;
    await this.panTo(side);
    await this.press(side === 'left' ? 'leftDoor' : 'rightDoor', undefined,
      { side, action: closed ? 'close-door' : 'open-door', reason });
    state.closed = closed;
    if (closed) state.recheckAt = Date.now() + this.route.timing.doorRecheckMs;
    await sleep(this.route.timing.flipSettleMs);
  }

  async monitorFlick(captureName = null) {
    await this.press('monitor', undefined, { action: 'monitor-raise' });
    await sleep(this.route.timing.flipSettleMs);
    if (captureName) {
      const png = await this.bridge.capturePng(this.bridge.serial);
      if (!png) fail('native monitor-up capture failed');
      await this.record.capture(captureName, png);
    }
    await sleep(this.route.timing.cameraUpDwellMs);
    await this.press('monitor', undefined, { action: 'monitor-lower' });
    await sleep(this.route.timing.flipSettleMs);
  }
}

async function detectorCalibrate(side, off, ons, modelPath, record) {
  const args = [DOOR_SENSOR, 'calibrate', '--side', side, '--off', off];
  for (const on of ons) args.push('--on', on);
  args.push('--out', modelPath);
  const result = await run('python3', args, { timeoutMs: 30000 });
  const payload = parseJsonLine(result.stdout, `door-light ${side} calibration`);
  await record.event('door-light-calibration', { side, code: result.code, payload, stderr: result.stderr.trim() });
  return result.code === 0 && payload.status === 'READY' ? payload : null;
}

async function detectorScore(modelPath, frame, side, record) {
  const result = await run('python3', [DOOR_SENSOR, 'score', '--model', modelPath, '--frame', frame], { timeoutMs: 30000 });
  const payload = parseJsonLine(result.stdout, `door-light ${side} score`);
  await record.event('door-light-score', { side, code: result.code, payload, stderr: result.stderr.trim(), frame });
  if (result.code !== 0 || payload.status !== 'READY') return { state: 'ambiguous', reason: payload.reason ?? 'detector-refused' };
  return payload;
}

async function captureNative(bridge, record, name) {
  const png = await bridge.capturePng(bridge.serial);
  if (!png) fail(`native capture failed: ${name}`);
  return record.capture(name, png);
}

async function calibrateSide(side, control, record) {
  await control.panTo(side);
  await captureNative(control.bridge, record, `${side}-before-calibration`);
  await control.toggleLight(side);
  const a = await captureNative(control.bridge, record, `${side}-toggle-a`);
  await control.toggleLight(side);
  const b = await captureNative(control.bridge, record, `${side}-toggle-b`);
  const firstModel = join(record.captureDir, `${side}-try-a-bright.json`);
  const first = await detectorCalibrate(side, b, [a], firstModel, record);
  if (first) {
    // b is the unlit state.  Take a second fresh on/off pair so the score has
    // a normal lit-frame variation band rather than treating zero variance as
    // a portable fact.
    await control.toggleLight(side);
    const c = await captureNative(control.bridge, record, `${side}-on-2`);
    await control.toggleLight(side);
    const model = join(record.captureDir, `${side}-door-light.json`);
    const final = await detectorCalibrate(side, b, [a, c], model, record);
    if (!final) fail(`${side} door-light model refused after a visible transition`);
    return model; // second toggle ended with the light known off
  }

  const secondModel = join(record.captureDir, `${side}-try-b-bright.json`);
  const second = await detectorCalibrate(side, a, [b], secondModel, record);
  if (!second) fail(`${side} door-light transition could not be established`);
  // b is lit now.  C is off, D is on, and E restores the known-off state.
  await control.toggleLight(side);
  const c = await captureNative(control.bridge, record, `${side}-off-2`);
  await control.toggleLight(side);
  const d = await captureNative(control.bridge, record, `${side}-on-2`);
  const model = join(record.captureDir, `${side}-door-light.json`);
  const final = await detectorCalibrate(side, c, [b, d], model, record);
  if (!final) fail(`${side} door-light model refused after its reverse transition`);
  await control.toggleLight(side); // restore from D (on) to known off
  return model;
}

async function scanDoor(side, modelPath, control, record, cycle) {
  await control.panTo(side);
  const door = control.doors[side];
  if (door.closed && Date.now() < door.recheckAt) {
    await record.event('door-scan-held', { side, cycle, recheckAt: door.recheckAt });
    return { state: 'held' };
  }
  if (door.closed) await control.setDoor(side, false, 'closed-interval-complete');
  await control.toggleLight(side);
  const frame = await captureNative(control.bridge, record, `${side}-scan-${String(cycle).padStart(3, '0')}`);
  const verdict = await detectorScore(modelPath, frame, side, record);
  await control.toggleLight(side); // every score is from an explicitly lit frame; leave it off
  if (verdict.state !== 'clear') await control.setDoor(side, true, `door-light-${verdict.state}`);
  return verdict;
}

/**
 * Night 1 is not Night 2 with lower numbers. Its table leaves every character
 * at zero until Bonnie's 2 AM row, so it spends the inert opening hands-off.
 * The only controls before each sourced activation are the bounded calibration
 * needed to make the next phase observable; the steady full loop cannot begin
 * before the right/monitor 3 AM preparation has completed.
 */
async function stageNight1({ route, record, bridge, control, nightEpochMs, shouldStop, teachStage = null }) {
  const staging = night1Staging(route);
  const at = offset => nightEpochMs + offset;
  const leftDeadline = at(staging.leftCalibrationAtMs + staging.leftCalibrationBudgetMs);
  const rightDeadline = at(staging.fullLoopAtMs);
  await record.event('night1-hands-off', {
    clockOrigin: 'continue-hid-release', startedAtMonotonicMs: Math.round(nightEpochMs),
    noControlBeforeMonotonicMs: Math.round(at(staging.leftCalibrationAtMs)),
    bonnieArmedAtMonotonicMs: Math.round(at(staging.bonnieArmedAtMs)),
  });
  await record.save('NIGHT1_HANDS_OFF');
  if (!await waitUntil(at(staging.leftCalibrationAtMs), shouldStop)) return { stopped: true };

  if (teachStage) await teachStage('left-calibration');
  await record.event('night1-stage-start', { stage: 'left-calibration', deadlineMonotonicMs: Math.round(leftDeadline) });
  const leftModel = await calibrateSide('left', control, record);
  if (performance.now() > leftDeadline)
    fail('Night 1 left calibration exceeded its 2 AM readiness budget');
  await record.event('night1-stage-complete', { stage: 'left-calibration', completedAtMonotonicMs: Math.round(performance.now()) });
  await record.save('NIGHT1_LEFT_READY');
  if (teachStage) await teachStage('left-watch');
  if (!await waitUntil(at(staging.firstLeftScanAtMs), shouldStop)) return { leftModel, stopped: true };

  let cycle = 0;
  while (!shouldStop() && performance.now() < at(staging.rightAndMonitorCalibrationAtMs)) {
    const title = await titleRead(bridge, record, `night1-left-terminal-${String(cycle).padStart(3, '0')}`);
    if (title.confident) {
      record.document.terminal = `TITLE:${title.output}`;
      return { leftModel, terminal: true };
    }
    const began = performance.now();
    const left = await scanDoor('left', leftModel, control, record, cycle);
    await record.event('night1-left-cycle', { cycle, left, pan: control.pan,
      doorClosed: control.doors.left.closed });
    cycle += 1;
    if (!await waitUntil(Math.min(at(staging.rightAndMonitorCalibrationAtMs), began + staging.leftScanIntervalMs), shouldStop))
      return { leftModel, stopped: true };
  }
  if (shouldStop()) return { leftModel, stopped: true };

  if (teachStage) await teachStage('right-monitor-calibration');
  await record.event('night1-stage-start', { stage: 'right-monitor-calibration', deadlineMonotonicMs: Math.round(rightDeadline) });
  const rightModel = await calibrateSide('right', control, record);
  await control.monitorFlick('monitor-up-calibration');
  await captureNative(bridge, record, 'monitor-down-calibration');
  if (performance.now() > rightDeadline)
    fail('Night 1 right/monitor calibration exceeded its 3 AM readiness budget');
  await record.event('night1-stage-complete', { stage: 'right-monitor-calibration', completedAtMonotonicMs: Math.round(performance.now()) });
  await record.save('NIGHT1_FULL_LOOP_PENDING');
  if (!await waitUntil(at(staging.fullLoopAtMs), shouldStop)) return { leftModel, rightModel, stopped: true };
  return { leftModel, rightModel, terminal: false, stopped: false };
}

async function startAudio(serial, id, record) {
  const env = { ANDROID_SERIAL: serial };
  const link = await run('bash', [AUDIO_LINK, '--ensure', '--game-package', PACKAGE], { timeoutMs: 120000, env });
  await writeFile(join(record.outdir, 'bt-audio-link.txt'), `${link.stdout}${link.stderr}`);
  const linkState = audioLinkState(link);
  await record.event('audio-link', { code: link.code, state: linkState, output: `${link.stdout}${link.stderr}`.trim() });
  if (linkState === 'UNAVAILABLE')
    fail(`Bluetooth audio route is not connected: ${(link.stdout || link.stderr).trim().split('\n').at(-1)}`);
  const base = join(homedir(), 'fnaf-apks', 'bt-audio-captures', id);
  await mkdir(dirname(base), { recursive: true });
  const capture = await run('bash', [AUDIO_CAPTURE, '--start', base], { timeoutMs: 30000, env });
  await writeFile(join(record.outdir, 'bt-audio-start.txt'), `${capture.stdout}${capture.stderr}`);
  await record.event('audio-start', { code: capture.code, base, output: `${capture.stdout}${capture.stderr}`.trim() });
  if (capture.code !== 0) fail(`Bluetooth audio capture refused: ${(capture.stdout || capture.stderr).trim()}`);
  record.document.audio = { requested: true, linkState, base, pid: capture.stdout.trim(), status: 'CAPTURING' };
  return base;
}

async function stopAudio(serial, base, record) {
  if (!base) return;
  const result = await run('bash', [AUDIO_CAPTURE, '--stop', base], { timeoutMs: 120000, env: { ANDROID_SERIAL: serial } });
  await writeFile(join(record.outdir, 'bt-audio-stop.txt'), `${result.stdout}${result.stderr}`);
  const sidecar = `${base}.bt.json`;
  try {
    await copyFile(sidecar, join(record.outdir, 'bt-audio.json'));
    record.document.audio.sidecar = JSON.parse(await readFile(sidecar, 'utf8'));
  } catch { record.document.audio.sidecar = { status: 'UNKNOWN', reason: 'sidecar-unreadable' }; }
  record.document.audio.status = result.code === 0 ? 'STOPPED' : 'STOP-FAILED';
  await record.event('audio-stop', { code: result.code, output: `${result.stdout}${result.stderr}`.trim(), sidecar });
}

/**
 * The presenter is deliberately a separate FNaF 1 app with a bounded stage
 * vocabulary. Its own dumpsys proof confirms an attached non-touchable window;
 * it is never asked to identify game pixels or authorize an input.
 */
async function teachOverlay(serial, record, mode, { night = null, stage = null, runId = null } = {}) {
  const args = [TEACH_OVERLAY, mode];
  if (mode === '--show' || mode === '--update') {
    args.push('--night', String(night), '--stage', String(stage), '--run', String(runId));
  }
  const result = await run('bash', args, { timeoutMs: 15000, env: { ANDROID_SERIAL: serial } });
  const output = `${result.stdout}${result.stderr}`.trim();
  await record.event('teach-overlay', { mode, night, stage, code: result.code, output });
  if (result.code !== 0) fail(`teaching overlay ${mode} refused: ${output || 'no status'}`);
  return output;
}

async function titleGatedTeardown(serial, record) {
  const result = await run('bash', [TEARDOWN, PACKAGE, '--after-night'], {
    timeoutMs: 190000,
    env: { ANDROID_SERIAL: serial, TITLE_MODEL: TITLE_MODEL_PATH, FNAF_TITLE_OBSERVE: TITLE_OBSERVER },
  });
  await writeFile(join(record.outdir, 'teardown.txt'), `${result.stdout}${result.stderr}`);
  await record.event('teardown', { code: result.code, output: `${result.stdout}${result.stderr}`.trim() });
  return result;
}

/**
 * An explicitly authorized abort discards the current unbanked attempt, then
 * proves the same FNaF 1 title state after relaunch. This is intentionally not
 * the normal post-night path: a completed night still waits for its observed
 * title/save boundary before any stop reaches the game.
 */
async function abortRestart(serial, bridge, record, route) {
  const stopped = await run('bash', [TEARDOWN, PACKAGE], {
    timeoutMs: 30000, env: { ANDROID_SERIAL: serial },
  });
  await record.event('abort-restart-stop', { code: stopped.code, output: `${stopped.stdout}${stopped.stderr}`.trim() });
  if (stopped.code !== 0) fail(`explicit abort stop failed: ${(stopped.stdout || stopped.stderr).trim()}`);
  const launched = await run('adb', ['-s', serial, 'shell', 'am', 'start', '-W', '-n', `${PACKAGE}${route.target.launcher}`], {
    timeoutMs: 30000,
  });
  await record.event('abort-restart-launch', { code: launched.code, output: `${launched.stdout}${launched.stderr}`.trim() });
  if (launched.code !== 0 || !/Status:\s*ok/i.test(`${launched.stdout}${launched.stderr}`))
    fail(`explicit abort restart launch failed: ${(launched.stdout || launched.stderr).trim()}`);
  await titleConsensus(bridge, record, route.title.consensusFrames, 'post-abort-restart-title');
  record.document.abortRestart = 'TITLE_CONFIRMED';
}

function titleGone(read) { return !read.confident && /not-the-title-screen/.test(`${read.output} ${read.stderr}`); }

async function main(argv) {
  const options = parseArgs(argv);
  const [route, controls, titleModel, teachModel] = await Promise.all([
    readJson(ROUTE_PATH), readJson(CONTROL_PATH), readJson(TITLE_MODEL_PATH), readJson(TEACH_MODEL_PATH),
  ]);
  validateRoute(route, controls, titleModel, teachModel);
  await Promise.all([executable(TITLE_OBSERVER), executable(AUDIO_LINK), executable(AUDIO_CAPTURE),
    executable(TEARDOWN), executable(TEACH_OVERLAY), stat(DOOR_SENSOR)]);
  const bindings = {
    route: { path: relativeToRoot(ROUTE_PATH), sha256: await fileHash(ROUTE_PATH) },
    controls: { path: relativeToRoot(CONTROL_PATH), sha256: await fileHash(CONTROL_PATH) },
    titleModel: { path: relativeToRoot(TITLE_MODEL_PATH), sha256: await fileHash(TITLE_MODEL_PATH) },
    titleObserver: { path: relativeToRoot(TITLE_OBSERVER), sha256: await fileHash(TITLE_OBSERVER) },
    doorSensor: { path: relativeToRoot(DOOR_SENSOR), sha256: await fileHash(DOOR_SENSOR) },
    teachingOverlay: { path: relativeToRoot(TEACH_MODEL_PATH), sha256: await fileHash(TEACH_MODEL_PATH),
      tool: relativeToRoot(TEACH_OVERLAY), toolSha256: await fileHash(TEACH_OVERLAY) },
  };
  if (options.dryRun) {
    console.log(JSON.stringify({ status: 'DRY_RUN', target: { package: PACKAGE, build: BUILD },
      titleObserver: bindings.titleObserver.path, titleModel: bindings.titleModel.path,
      audio: route.audio, teachingOverlay: route.teachingOverlay, bindings }, null, 2));
    return;
  }
  if (process.env.FNAF1_LEASE_HELD !== '1') fail('must run through fnaf1-night-run.sh so the serial lease is held');
  let serial;
  try { ({ serial } = resolveSerial()); } catch (error) { fail(error.message); }
  const id = `fnaf1-night${options.night}-${options.label ?? 'community-loop'}-${stamp()}`;
  const outdir = join(ROOT, 'artifacts', 'runs', id);
  const captureDir = join(homedir(), 'fnaf-apks', 'fnaf1-device-runs', id);
  await Promise.all([mkdir(outdir, { recursive: true }), mkdir(captureDir, { recursive: true })]);
  const record = new RunRecord({ id, outdir, captureDir, options, bindings });
  await record.save('PREFLIGHT');
  const bridge = new AdbDeviceBridge({ serial });
  let audioBase = null;
  let hidProcess = null;
  let hid = null;
  let continueSent = false;
  let teachVisible = false;
  let stopRequested = false;
  const requestStop = signal => { stopRequested = true; record.event('signal', { signal }).catch(() => {}); };
  process.once('SIGINT', () => requestStop('SIGINT'));
  process.once('SIGTERM', () => requestStop('SIGTERM'));
  try {
    const preflight = await bridge.preflight({ targetPackage: PACKAGE, targetBuild: `${PACKAGE}:${BUILD}`,
      requireHelper: false, requireHid: true });
    record.document.preflight = preflight;
    await record.event('preflight', { status: preflight.status, checks: preflight.checks });
    if (preflight.status !== 'READY') fail(`preflight ${preflight.status}: ${JSON.stringify(preflight.checks)}`);
    await teachOverlay(serial, record, '--preflight');
    record.document.teachingOverlay = { requested: true, status: 'PREFLIGHT_READY', model: bindings.teachingOverlay };
    audioBase = await startAudio(serial, id, record);
    await record.save('TITLE_GATE');
    await titleConsensus(bridge, record, route.title.consensusFrames, 'title-before-continue');

    hidProcess = new AdbHidProcess({ serial });
    hid = new HidWireTransport({ write: line => hidProcess.write(line), ready: () => hidProcess.ready(),
      contactMs: route.controls.contactMs });
    await hid.start();
    await record.event('hid-ready', { contactMs: route.controls.contactMs });
    // Re-read after HID registration.  No stale title observation authorises
    // a menu action; FNaF 2's model is never present in this call chain.
    await titleConsensus(bridge, record, route.title.consensusFrames, 'title-immediate-before-continue');
    const continuePoint = route.title.requiredItem === 'continue'
      ? { x: titleModel.items.continue[0], y: titleModel.items.continue[1] } : null;
    if (!continuePoint) fail('route does not name a safe Continue point');
    await record.event('input.requested', { control: 'continue', point: continuePoint, durationMs: route.controls.contactMs,
      cursorAttestation: options.cursorObserved });
    await hid.send({ command: { action: { kind: 'press', durationMs: route.controls.contactMs } }, point: continuePoint });
    continueSent = true;
    await record.event('input.released', { control: 'continue' });
    // The source timer can begin immediately after Continue. Every Night 1
    // staging offset is measured from this release rather than from a later
    // card or office observation that could make an early control look safe.
    const nightEpochMs = performance.now();
    await record.event('night-clock-origin', { source: 'continue-hid-release', atMonotonicMs: Math.round(nightEpochMs) });
    await waitForTitleToLeave(bridge, record);
    const initialTeachStage = options.night === 1 ? 'hands-off' : 'night2-calibration';
    await teachOverlay(serial, record, '--show', { night: options.night, stage: initialTeachStage, runId: id });
    teachVisible = true;
    record.document.teachingOverlay.status = 'VISIBLE';
    record.document.teachingOverlay.stage = initialTeachStage;
    await captureNative(bridge, record, `teach-overlay-${initialTeachStage}`);
    const teachStage = async stage => {
      await teachOverlay(serial, record, '--update', { night: options.night, stage, runId: id });
      record.document.teachingOverlay.status = 'VISIBLE';
      record.document.teachingOverlay.stage = stage;
    };
    // This is not a readiness claim. It avoids the immediate transition while
    // the Night 1 hands-off clock continues; its later light transition is the
    // first proof that office controls are live.
    await sleep(route.timing.officeReadyDelayMs);
    await captureNative(bridge, record, 'office-before-calibration');
    const staging = options.night === 1 ? night1Staging(route) : null;
    const control = new Fnaf1Controls({ hid, record, route, controls, bridge,
      notBeforeControlMs: staging === null ? null : nightEpochMs + staging.leftCalibrationAtMs });
    let leftModel = null;
    let rightModel = null;
    let stageTerminal = false;
    if (options.night === 1) {
      const staged = await stageNight1({ route, record, bridge, control, nightEpochMs,
        shouldStop: () => stopRequested, teachStage });
      leftModel = staged.leftModel ?? null;
      rightModel = staged.rightModel ?? null;
      stageTerminal = staged.terminal === true;
      if (staged.stopped) stopRequested = true;
    } else {
      // Night 2 begins with active Bonnie, Chica, and Foxy, so it has no
      // hands-off opening. Its per-run sensor calibration remains the first
      // proof that the office is interactive.
      leftModel = await calibrateSide('left', control, record);
      rightModel = await calibrateSide('right', control, record);
      await control.monitorFlick('monitor-up-calibration');
      await captureNative(bridge, record, 'monitor-down-calibration');
    }
    record.document.doorSensors = { left: leftModel, right: rightModel };
    if (!stageTerminal && !stopRequested && leftModel && rightModel) {
      await teachStage('full-loop');
      await record.save('RUNNING');
      let cycle = 0;
      while (!stopRequested && performance.now() - nightEpochMs < route.timing.actionBoundMs) {
        const title = await titleRead(bridge, record, `terminal-poll-${String(cycle).padStart(3, '0')}`);
        if (title.confident) { record.document.terminal = `TITLE:${title.output}`; break; }
        if (!titleGone(title)) await record.event('terminal-poll-unknown', { cycle, output: title.output, stderr: title.stderr });
        const left = await scanDoor('left', leftModel, control, record, cycle);
        await control.monitorFlick(cycle % 8 === 0 ? `monitor-up-${String(cycle).padStart(3, '0')}` : null);
        const right = await scanDoor('right', rightModel, control, record, cycle);
        await control.monitorFlick();
        await record.event('cycle', { cycle, left, right, pan: control.pan,
          doors: { left: control.doors.left.closed, right: control.doors.right.closed } });
        cycle += 1;
      }
    }
    if (stopRequested) record.document.terminal = 'ABORT_REQUESTED: controls released; teardown waits for title';
    else if (record.document.terminal === 'UNKNOWN') record.document.terminal = 'ACTION_BOUND_REACHED: teardown waits for title';
  } catch (error) {
    record.document.error = error instanceof Error ? error.message : String(error);
    record.document.terminal = continueSent ? 'RUN_ERROR_AFTER_CONTINUE' : 'PRE_RUN_REFUSAL';
    await record.event('error', { message: record.document.error });
  } finally {
    try { await hid?.abort(); } catch { /* release is best effort, teardown remains title-gated */ }
    try { await hidProcess?.close(); } catch { /* the lease still bounds process cleanup */ }
    if (teachVisible) {
      try {
        await teachOverlay(serial, record, '--clear');
        record.document.teachingOverlay.status = 'CLEARED';
      } catch (error) {
        record.document.teachingOverlay.clearError = error instanceof Error ? error.message : String(error);
      }
    }
    const explicitAbort = continueSent && stopRequested && options.abortRestart
      && !String(record.document.terminal).startsWith('TITLE:');
    if (explicitAbort) {
      try { await abortRestart(serial, bridge, record, route); }
      catch (error) { record.document.abortRestart = `FAILED:${error instanceof Error ? error.message : String(error)}`; }
    } else if (continueSent) {
      const teardown = await titleGatedTeardown(serial, record);
      if (teardown.code !== 0) record.document.teardown = 'REFUSED_OR_FAILED';
      else record.document.teardown = 'TITLE_CONFIRMED_AND_STOPPED';
    }
    try { await stopAudio(serial, audioBase, record); }
    catch (error) { record.document.audio.stopError = error instanceof Error ? error.message : String(error); }
    await record.save(record.document.error ? 'FAILED_OR_REFUSED' : 'COMPLETE');
    console.log(`fnaf1 run ${id}: ${record.document.status}; terminal=${record.document.terminal}; out=${outdir}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 2; });
}
