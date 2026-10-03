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
 *   packages/play/games/fnaf1/fnaf1-night-run.sh [--dry-run]
 *   packages/play/games/fnaf1/fnaf1-night-run.sh --live --confirm-live --bt-audio --teach-overlay [--abort-restart] \
 *       --night 1 --cursor-observed 1 --label community-loop-a
 *
 * `--teach-overlay` shows the Companion's FNaF 1 teaching strip, so the
 * Companion must be capturing first: packages/play/bin/companion/companion-setup.sh
 * --target fnaf1, which also brings FNaF 1 to its title.
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { AdbDeviceBridge } from '../../src/campaign/adb-bridge.ts';
import { AdbHidProcess } from '../../src/campaign/physical-ports.ts';
import { HidWireTransport } from '../../src/venues/phone/hid.ts';
import { isList, isRecord } from '@sixam/kernel';
import { resolveSerial } from '../../bin/phone/local-profile.ts';
import { onStopSignal, releaseContacts, runProcess as run } from '../../bin/phone/night-kit.ts';
import { type TitleRead, titleConsensus, titleRead } from './fnaf1-menu-probe.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const PACKAGE = 'com.scottgames.fivenightsatfreddys';
const BUILD = '2.0.7+40';
const ROUTE_PATH = join(HERE, '../../profiles/fnaf1/moto-g56/fnaf1-community-loop-moto-g56-v207.json');
const CONTROL_PATH = join(HERE, '../../profiles/fnaf1/moto-g56/controls-fnaf1-moto-g56-v207.json');
const TITLE_MODEL_PATH = join(HERE, '../../profiles/fnaf1/moto-g56/title-fnaf1-moto-g56-v207.json');
const TITLE_OBSERVER = join(HERE, 'fnaf1-title-observe.sh');
const DOOR_SENSOR = join(HERE, 'fnaf1-door-light.py');
const TEACH_MODEL_PATH = join(HERE, '../../profiles/fnaf1/moto-g56/teach-panel-fnaf1-moto-g56-v207.json');
const TEACH_OVERLAY = join(HERE, 'fnaf1-teach-overlay.ts');
const AUDIO_LINK = join(ROOT, 'packages/play/bin/audio/bt-audio-link.sh');
const AUDIO_CAPTURE = join(ROOT, 'packages/play/bin/audio/capture-bt-audio.sh');
const TEARDOWN = join(HERE, '../../bin/phone/game-teardown.sh');
// The Bluetooth link's settings fallback hands the screen back to this game.
export const AUDIO_LINK_ARGS = ['--ensure', '--game-package', PACKAGE] as const;
const TITLE_INTERVAL_MS = 250;

type Side = 'left' | 'right';
/** The Night 1 staging offsets, each from Continue's release. */
type Night1Staging = Readonly<Record<'bonnieArmedAtMs' | 'leftCalibrationAtMs' | 'leftCalibrationBudgetMs' | 'leftCalibrationObservedMs' |
  'firstLeftScanAtMs' | 'leftScanIntervalMs' | 'rightAndCameraArmedAtMs' | 'rightAndMonitorCalibrationAtMs' |
  'rightAndMonitorCalibrationBudgetMs' | 'rightAndMonitorObservedMs' | 'fullLoopAtMs', number>>;
/** The FNaF 1 route profile (fnaf1-device-route-v1), as validateRoute checks it. */
interface Route {
  readonly schema: string;
  readonly target: { readonly package: string, readonly build: string, readonly launcher: string };
  readonly title: { readonly observer: string, readonly model: string, readonly requiredItem: string, readonly consensusFrames: number };
  readonly audio: { readonly required: boolean, readonly purpose?: string };
  readonly teachingOverlay: { readonly required: boolean, readonly tool: string, readonly model: string, readonly schema: string };
  readonly controls: { readonly contactMs: number, readonly startsAtPan: number };
  readonly timing: { readonly lightAfterPressMs: number, readonly flipSettleMs: number, readonly cameraUpDwellMs: number,
    readonly officeReadyDelayMs: number, readonly doorRecheckMs: number, readonly actionBoundMs: number };
  readonly night1Staging?: Night1Staging;
}
interface PanBinding {
  readonly x: number, readonly y: number, readonly resultingPan: number, readonly durationMs: number,
  readonly claimLevel: string, readonly durationClaimLevel: string;
}
/** The FNaF 1 control map, as validateRoute checks it. */
interface Controls {
  readonly target: { readonly package: string, readonly version: string };
  readonly view: { readonly startsAt: number, readonly maxPanPx: number, readonly scale: number };
  readonly panMap: Readonly<Record<string, PanBinding>>;
  readonly controlMap: Readonly<Record<string, { readonly x: number, readonly y: number }>>;
}
/** The FNaF 1 title model, as validateRoute checks it. */
interface TitleModel { readonly schema: string, readonly build?: string, readonly items: { readonly continue: readonly [number, number] } }
/** The FNaF 1 teaching strip's model, as validateRoute checks it. */
interface TeachModel {
  readonly schema: string, readonly target: { readonly package: string, readonly build: string };
  readonly presenter: { readonly package: string, readonly lesson: string }, readonly stages: readonly string[];
}
/** fnaf1-door-light.py's JSON line. */
interface DoorVerdict { readonly status?: unknown, readonly reason?: unknown, readonly state?: unknown }
/** A bridge built on the serial the lease resolved. */
type Bridge = AdbDeviceBridge & { readonly serial: string };
type Options = ReturnType<typeof parseArgs>;
/** The teaching strip's record, which preflight writes before anything else reads it. */
type Overlay = NonNullable<RunRecord['document']['teachingOverlay']>;

const sleep = (ms: number) => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
const stamp = () => new Date().toISOString().replace(/[-:.]/g, '').replace('T', 'T').replace('Z', 'Z');
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Wait in one-second slices so an abort request never hides behind a long idle. */
async function waitUntil(monotonicMs: number, shouldStop = () => false) {
  while (!shouldStop()) {
    const remaining = monotonicMs - performance.now();
    if (remaining <= 0) return true;
    await sleep(Math.min(remaining, 1000));
  }
  return false;
}

function fail(message: string): never { throw new Error(`fnaf1-night-run: ${message}`); }

function parseInteger(value: unknown, name: string, { min, max }: { min: number, max: number }) {
  if (!/^[0-9]+$/.test(String(value))) fail(`${name} must be an integer`);
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max)
    fail(`${name} must be ${min}..${max}`);
  return number;
}

export function parseArgs(argv: string[]) {
  const options = { live: false, confirmLive: false, btAudio: false, teachOverlay: false, abortRestart: false, night: null as number | null,
    cursorObserved: null as number | null, label: null as string | null, dryRun: false };
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

/** A profile file, unchecked until validateRoute reads it. */
async function readModel(path: string): Promise<unknown> { return JSON.parse(await readFile(path, 'utf8')); }
async function fileHash(path: string) { return sha256(await readFile(path)); }
async function executable(path: string) { await access(path, fsConstants.X_OK); }

/** The value at `keys` under `value`, or undefined where a step is not a record. */
function at(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Check the four FNaF 1 profiles a night reads, and return them typed. */
export function validateRoute(route: unknown, controls: unknown, titleModel: unknown, teachModel: unknown) {
  if (at(route, 'schema') !== 'fnaf1-device-route-v1') fail('route schema is not fnaf1-device-route-v1');
  if (at(route, 'target', 'package') !== PACKAGE || at(route, 'target', 'build') !== BUILD || at(route, 'target', 'launcher') !== '.Main')
    fail('route targets the wrong game or build');
  if (at(route, 'title', 'observer') !== relativeToRoot(TITLE_OBSERVER) ||
      at(route, 'title', 'model') !== relativeToRoot(TITLE_MODEL_PATH) ||
      at(route, 'title', 'requiredItem') !== 'continue' || at(route, 'title', 'consensusFrames') !== 3)
    fail('route title gate is not the FNaF 1 Continue-only observer');
  const continueAt = at(titleModel, 'items', 'continue');
  if (at(titleModel, 'schema') !== 'title-model-v1' ||
      !String(at(titleModel, 'build') ?? '').startsWith(`${PACKAGE} v2.0.7 versionCode 40`) ||
      !isList(continueAt) || continueAt.length !== 2 || !continueAt.every(Number.isInteger))
    fail('title model is not the measured FNaF 1 Continue binding');
  if (at(route, 'audio', 'required') !== true || !/Passive/.test(String(at(route, 'audio', 'purpose') ?? '')))
    fail('route does not require passive retained audio');
  if (at(route, 'teachingOverlay', 'required') !== true ||
      at(route, 'teachingOverlay', 'tool') !== relativeToRoot(TEACH_OVERLAY) ||
      at(route, 'teachingOverlay', 'model') !== relativeToRoot(TEACH_MODEL_PATH) ||
      at(route, 'teachingOverlay', 'schema') !== 'fnaf1-teach-overlay-v2')
    fail('route does not require the isolated FNaF 1 teaching overlay');
  const stages = at(teachModel, 'stages');
  if (at(teachModel, 'schema') !== 'fnaf1-teach-overlay-v2' ||
      at(teachModel, 'target', 'package') !== PACKAGE || at(teachModel, 'target', 'build') !== BUILD ||
      at(teachModel, 'presenter', 'package') !== 'com.ppvaz.fnafcompanion' ||
      at(teachModel, 'presenter', 'lesson') !== 'f1strip' ||
      !isList(stages) || !stages.includes('full-loop'))
    fail('teaching overlay model is not the FNaF 1 passive presenter binding');
  if (at(route, 'controls', 'contactMs') !== 160 || at(route, 'controls', 'startsAtPan') !== 0)
    fail('route control contact/start pan disagrees with the measured map');
  if (at(controls, 'target', 'package') !== PACKAGE || at(controls, 'target', 'version') !== BUILD)
    fail('control model targets the wrong game or build');
  const scale = at(controls, 'view', 'scale');
  if (at(controls, 'view', 'startsAt') !== 0 || at(controls, 'view', 'maxPanPx') !== 600 || scale !== 1.875)
    fail('control model has an unexpected pan geometry');
  for (const [side, expected] of Object.entries({ left: 0, right: 600 })) {
    const pan = at(controls, 'panMap', side);
    if (!isRecord(pan) || !finite(pan.x) || !finite(pan.y) || pan.resultingPan !== expected || pan.durationMs !== 310 ||
        pan.claimLevel !== 'SOURCE_DERIVED' || pan.durationClaimLevel !== 'DEVICE_MEASURED')
      fail(`control model's ${side} pan is not the qualified/source-derived binding`);
  }
  const leftX = at(controls, 'panMap', 'left', 'x');
  const rightX = at(controls, 'panMap', 'right', 'x');
  if (!(finite(leftX) && leftX < 153 * scale) || !(finite(rightX) && rightX > 1143 * scale))
    fail('pan points fall outside their source-derived edge bands');
  for (const control of ['leftDoor', 'leftDoorLight', 'rightDoor', 'rightDoorLight', 'monitor']) {
    if (!finite(at(controls, 'controlMap', control, 'x')) || !finite(at(controls, 'controlMap', control, 'y')))
      fail(`control model has no finite ${control} point`);
  }
  for (const key of ['lightAfterPressMs', 'flipSettleMs', 'cameraUpDwellMs', 'officeReadyDelayMs', 'doorRecheckMs', 'actionBoundMs'] as const) {
    const value = at(route, 'timing', key);
    if (!Number.isInteger(value) || (value as number) < 1) fail(`route timing ${key} is missing`);
  }
  night1Staging(route);
  return Object.freeze({ route: route as unknown as Route, controls: controls as unknown as Controls,
    titleModel: titleModel as unknown as TitleModel, teachModel: teachModel as unknown as TeachModel });
}

/**
 * Validate the Night 1-only hands-off staging plan. Its source facts are
 * numeric gates here rather than explanatory prose in JSON, so a later edit
 * cannot quietly reintroduce the midnight full loop.
 */
export function night1Staging(route: unknown) {
  const keys = ['bonnieArmedAtMs', 'leftCalibrationAtMs', 'leftCalibrationBudgetMs',
    'leftCalibrationObservedMs', 'firstLeftScanAtMs', 'leftScanIntervalMs',
    'rightAndCameraArmedAtMs', 'rightAndMonitorCalibrationAtMs',
    'rightAndMonitorCalibrationBudgetMs', 'rightAndMonitorObservedMs', 'fullLoopAtMs'] as const;
  for (const key of keys) {
    const value = at(route, 'night1Staging', key);
    if (!Number.isInteger(value) || (value as number) < 1) fail(`Night 1 staging ${key} is missing`);
  }
  // Every key is a positive integer.
  const staging = at(route, 'night1Staging') as Night1Staging;
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


function parseJsonLine(text: string, context: string): DoorVerdict {
  try { return JSON.parse(text.trim()); }
  catch { fail(`${context} did not return JSON: ${text.trim() || 'empty'}`); }
}

function relativeToRoot(path: string) { return relative(ROOT, path).replaceAll('\\', '/'); }

/**
 * `capture-bt-audio.sh --start` deliberately accepts a connected PCM that is
 * not running yet: title/menu music can be suspended until the game resumes.
 * Do not collapse that state into a disconnected route.  The recorder still
 * does the authoritative `bluealsa-cli info` check before it opens anything.
 */
export function audioLinkState(result: { readonly code: number | null, readonly stdout?: string, readonly stderr?: string }) {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.code === 0 && /audio-route=READY\b/.test(output)) return 'READY';
  if (/audio-route=UNKNOWN reason=a2dp-stream-not-running\b/.test(output)) return 'CONNECTED_NOT_STREAMING';
  return 'UNAVAILABLE';
}

/** A retained native frame. */
interface CaptureFrame { name: string, path: string, sha256: string, bytes: number, atWallMs: number }

class RunRecord {
  declare id: string;
  declare outdir: string;
  declare captureDir: string;
  declare document: {
    schema: string, id: string, startedAt: string, claimLevel: string, target: { package: string, build: string }, options: Options,
    bindings: object, capture: { sensor: string, directory: string, frames: CaptureFrame[] }, events: object[], status: string,
    terminal: string, updatedAt?: string, preflight?: unknown, doorSensors?: { left: string | null, right: string | null },
    teachingOverlay?: { requested: boolean, status: string, model: object, stage?: string, clearError?: string },
    error?: string, abortRestart?: string, teardown?: string,
    audio: { requested: boolean, linkState?: string, base?: string, pid?: string, status?: string, sidecar?: unknown, stopError?: string },
  };
  declare eventsPath: string;
  constructor({ id, outdir, captureDir, options, bindings }: { id: string, outdir: string, captureDir: string, options: Options, bindings: object }) {
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

  async event(type: string, fields: object = {}) {
    const row = { atWallMs: Date.now(), atMonotonicMs: Math.round(performance.now()), type, ...fields };
    this.document.events.push(row);
    await appendFile(this.eventsPath, `${JSON.stringify(row)}\n`);
    return row;
  }

  async capture(name: string, png: Buffer) {
    const filename = `${String(this.document.capture.frames.length).padStart(4, '0')}-${name}.png`;
    const path = join(this.captureDir, filename);
    await writeFile(path, png);
    const frame = { name, path, sha256: sha256(png), bytes: png.length, atWallMs: Date.now() };
    this.document.capture.frames.push(frame);
    await this.event('capture', { ...frame });
    return path;
  }

  async save(status: string) {
    this.document.status = status;
    this.document.updatedAt = new Date().toISOString();
    await writeFile(join(this.outdir, 'run.json'), `${JSON.stringify(this.document, null, 2)}\n`);
  }
}

async function waitForTitleToLeave(bridge: Bridge, record: RunRecord) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(1000);
    const read = await titleRead(bridge, record, `after-continue-${attempt + 1}`);
    if (!read.confident && /not-the-title-screen/.test(`${read.output} ${read.stderr}`)) return;
  }
  fail('Continue did not leave the observed FNaF 1 title within the bounded start wait');
}

export class Fnaf1Controls {
  declare hid: HidWireTransport;
  declare record: RunRecord;
  declare route: Route;
  declare controls: Controls;
  declare bridge: Bridge;
  declare pan: number;
  declare doors: { left: { closed: boolean; recheckAt: number; }; right: { closed: boolean; recheckAt: number; }; };
  declare notBeforeControlMs: number | null;
  constructor({ hid, record, route, controls, bridge, notBeforeControlMs = null }:
    { hid: HidWireTransport, record: RunRecord, route: Route, controls: Controls, bridge: Bridge, notBeforeControlMs?: number | null }) {
    this.hid = hid; this.record = record; this.route = route; this.controls = controls; this.bridge = bridge;
    this.pan = controls.view.startsAt;
    this.doors = { left: { closed: false, recheckAt: 0 }, right: { closed: false, recheckAt: 0 } };
    this.notBeforeControlMs = notBeforeControlMs;
  }

  point(control: string) { return this.controls.controlMap[control]; }

  assertControlWindow(action: string) {
    if (this.notBeforeControlMs !== null && performance.now() < this.notBeforeControlMs)
      fail(`Night 1 hands-off gate refused ${action} before ${Math.round(this.notBeforeControlMs)} ms`);
  }

  async press(control: string, durationMs = this.route.controls.contactMs, detail: object = {}) {
    this.assertControlWindow(control);
    const point = this.point(control);
    await this.record.event('input.requested', { control, point: { x: point.x, y: point.y }, durationMs,
      pan: this.pan, ...detail });
    await this.hid.send({ command: { action: { kind: 'press', durationMs } }, point });
    await this.record.event('input.released', { control, durationMs, pan: this.pan, ...detail });
  }

  async panTo(side: Side) {
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

  async toggleLight(side: Side) {
    await this.press(side === 'left' ? 'leftDoorLight' : 'rightDoorLight', undefined, { side, action: 'toggle-light' });
    await sleep(this.route.timing.lightAfterPressMs);
  }

  async setDoor(side: Side, closed: boolean, reason: string) {
    const state = this.doors[side];
    if (state.closed === closed) return;
    await this.panTo(side);
    await this.press(side === 'left' ? 'leftDoor' : 'rightDoor', undefined,
      { side, action: closed ? 'close-door' : 'open-door', reason });
    state.closed = closed;
    if (closed) state.recheckAt = Date.now() + this.route.timing.doorRecheckMs;
    await sleep(this.route.timing.flipSettleMs);
  }

  async monitorFlick(captureName: string | null = null) {
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

async function detectorCalibrate(side: Side, off: string, ons: string[], modelPath: string, record: RunRecord) {
  const args = [DOOR_SENSOR, 'calibrate', '--side', side, '--off', off];
  for (const on of ons) args.push('--on', on);
  args.push('--out', modelPath);
  const result = await run('python3', args, { timeoutMs: 30000 });
  const payload = parseJsonLine(result.stdout, `door-light ${side} calibration`);
  await record.event('door-light-calibration', { side, code: result.code, payload, stderr: result.stderr.trim() });
  return result.code === 0 && payload.status === 'READY' ? payload : null;
}

async function detectorScore(modelPath: string, frame: string, side: Side, record: RunRecord): Promise<DoorVerdict> {
  const result = await run('python3', [DOOR_SENSOR, 'score', '--model', modelPath, '--frame', frame], { timeoutMs: 30000 });
  const payload = parseJsonLine(result.stdout, `door-light ${side} score`);
  await record.event('door-light-score', { side, code: result.code, payload, stderr: result.stderr.trim(), frame });
  if (result.code !== 0 || payload.status !== 'READY') return { state: 'ambiguous', reason: payload.reason ?? 'detector-refused' };
  return payload;
}

async function captureNative(bridge: Bridge, record: RunRecord, name: string) {
  const png = await bridge.capturePng(bridge.serial);
  if (!png) fail(`native capture failed: ${name}`);
  return record.capture(name, png);
}

async function calibrateSide(side: Side, control: Fnaf1Controls, record: RunRecord) {
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

async function scanDoor(side: Side, modelPath: string, control: Fnaf1Controls, record: RunRecord, cycle: number): Promise<DoorVerdict> {
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
async function stageNight1({ route, record, bridge, control, nightEpochMs, shouldStop, teachStage = null }:
  { route: Route, record: RunRecord, bridge: Bridge, control: Fnaf1Controls, nightEpochMs: number, shouldStop: () => boolean,
    teachStage?: ((stage: string) => Promise<void>) | null }):
  Promise<{ leftModel?: string, rightModel?: string, terminal?: boolean, stopped?: boolean }> {
  const staging = night1Staging(route);
  const at = (offset: number) => nightEpochMs + offset;
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

async function startAudio(serial: string, id: string, record: RunRecord) {
  const env = { ANDROID_SERIAL: serial };
  const link = await run('bash', [AUDIO_LINK, ...AUDIO_LINK_ARGS], { timeoutMs: 120000, env });
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

async function stopAudio(serial: string, base: string | null, record: RunRecord) {
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
 * The Companion's FNaF 1 teaching strip (Fnaf1Strip.java), with a bounded stage
 * vocabulary. The Companion's own status reply confirms an attached
 * non-touchable window; it is never asked to identify game pixels or authorize
 * an input.
 */
async function teachOverlay(serial: string, record: RunRecord, mode: string,
  { night = null, stage = null, runId = null }: { night?: number | null, stage?: string | null, runId?: string | null } = {}) {
  const args = [TEACH_OVERLAY, mode];
  if (mode === '--show' || mode === '--update') {
    args.push('--night', String(night), '--stage', String(stage), '--run', String(runId));
  }
  const result = await run(process.execPath, args, { timeoutMs: 15000, env: { ANDROID_SERIAL: serial } });
  const output = `${result.stdout}${result.stderr}`.trim();
  await record.event('teach-overlay', { mode, night, stage, code: result.code, output });
  if (result.code !== 0) fail(`teaching overlay ${mode} refused: ${output || 'no status'}`);
  return output;
}

async function titleGatedTeardown(serial: string, record: RunRecord) {
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
async function abortRestart(serial: string, bridge: Bridge, record: RunRecord, route: Route) {
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
  await titleConsensus(bridge, record, 'post-abort-restart-title', ['continue'],
    { frames: route.title.consensusFrames, intervalMs: TITLE_INTERVAL_MS });
  record.document.abortRestart = 'TITLE_CONFIRMED';
}

function titleGone(read: TitleRead) { return !read.confident && /not-the-title-screen/.test(`${read.output} ${read.stderr}`); }

async function main(argv: string[]) {
  const options = parseArgs(argv);
  const { route, controls, titleModel } = validateRoute(...await Promise.all([
    readModel(ROUTE_PATH), readModel(CONTROL_PATH), readModel(TITLE_MODEL_PATH), readModel(TEACH_MODEL_PATH),
  ]));
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
  let serial: string;
  try { ({ serial } = resolveSerial()); } catch (error) { fail((error as Error).message); }
  const id = `fnaf1-night${options.night}-${options.label ?? 'community-loop'}-${stamp()}`;
  const outdir = join(ROOT, 'artifacts', 'runs', id);
  const captureDir = join(homedir(), 'fnaf-apks', 'fnaf1-device-runs', id);
  await Promise.all([mkdir(outdir, { recursive: true }), mkdir(captureDir, { recursive: true })]);
  const record = new RunRecord({ id, outdir, captureDir, options, bindings });
  await record.save('PREFLIGHT');
  const bridge = new AdbDeviceBridge({ serial }) as Bridge;
  let audioBase = null as string | null;
  let hidProcess = null as AdbHidProcess | null;
  let hid = null as HidWireTransport | null;
  let continueSent = false;
  let teachVisible = false;
  let stopRequested = false;
  const requestStop = (signal: string) => { stopRequested = true; record.event('signal', { signal }).catch(() => {}); };
  onStopSignal(requestStop);
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
    await titleConsensus(bridge, record, 'title-before-continue', ['continue'],
    { frames: route.title.consensusFrames, intervalMs: TITLE_INTERVAL_MS });

    const adbHid = new AdbHidProcess({ serial });
    hidProcess = adbHid;
    hid = new HidWireTransport({ write: line => adbHid.write(line), ready: () => adbHid.ready(),
      contactMs: route.controls.contactMs });
    await hid.start();
    await record.event('hid-ready', { contactMs: route.controls.contactMs });
    // Re-read after HID registration.  No stale title observation authorises
    // a menu action; FNaF 2's model is never present in this call chain.
    await titleConsensus(bridge, record, 'title-immediate-before-continue', ['continue'],
    { frames: route.title.consensusFrames, intervalMs: TITLE_INTERVAL_MS });
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
    (record.document.teachingOverlay as Overlay).status = 'VISIBLE';
    (record.document.teachingOverlay as Overlay).stage = initialTeachStage;
    await captureNative(bridge, record, `teach-overlay-${initialTeachStage}`);
    const teachStage = async (stage: string) => {
      await teachOverlay(serial, record, '--update', { night: options.night, stage, runId: id });
      (record.document.teachingOverlay as Overlay).status = 'VISIBLE';
      (record.document.teachingOverlay as Overlay).stage = stage;
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
    await releaseContacts(hid, hidProcess);
    if (teachVisible) {
      try {
        await teachOverlay(serial, record, '--clear');
        (record.document.teachingOverlay as Overlay).status = 'CLEARED';
      } catch (error) {
        (record.document.teachingOverlay as Overlay).clearError = error instanceof Error ? error.message : String(error);
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
  main(process.argv.slice(2)).catch((error: Error) => { console.error(error.message); process.exitCode = 2; });
}
