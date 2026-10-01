#!/usr/bin/env node
/**
 * Observe FNaF 1's menus on the handset, one bounded stage at a time.
 *
 * FNaF 1's title grows two rows once a save has beaten Night 5 and Night 6
 * (`btn6thNight` and `btnCustomNight`, shown by the StartOfFrame reads of
 * `beatgame` and `beat6`, title groups 0 and 94-97), and Custom Night opens a
 * frame of its own. None of that is calibrated until it has been captured on
 * this phone, so this tool captures it rather than trusting the event sheet's
 * design coordinates: those predict where a row should be, the native frames
 * say where it is.
 *
 *   packages/play/games/fnaf1/fnaf1-menu-probe.sh [--dry-run]          (dry by default: no --live, no phone)
 *   packages/play/games/fnaf1/fnaf1-menu-probe.sh --live --confirm-live --stage title [--frames 12] [--label NAME]
 *   packages/play/games/fnaf1/fnaf1-menu-probe.sh --live --confirm-live --stage custom-night [--frames 12] [--label NAME]
 *   packages/play/games/fnaf1/fnaf1-menu-probe.sh --live --confirm-live --stage custom-night --sweep [--label NAME]
 *   packages/play/games/fnaf1/fnaf1-menu-probe.sh --live --confirm-live --stage custom-night --set 20,20,20,20 [--label NAME]
 *
 * Stage `title` sends no input. It launches FNaF 1 only when the game is not
 * already in front, waits a bounded time for a confident FNaF 1 title read,
 * then retains native frames with the observer's verdict on each.
 *
 * Stage `custom-night` sends exactly one input: the title model's measured
 * Custom Night row, and only after three fresh, identical, confident title
 * reads that list `customNight`. It retains the Custom Night screen as it
 * settles, then leaves by force-stop and relaunch -- that frame writes no INI
 * key (its only writes are globals at EndOfFrame, customize groups 71/102) --
 * and proves the title again with the same consensus, so the save the probe
 * found is the save it leaves.
 *
 * `--sweep` walks every dial through a full cycle each way: 21 presses up and
 * 21 down (the counters wrap modulo 21, customize g41). After every press the
 * dial reader must show that dial's mask changed and no other dial's did, and
 * each 21-press cycle must end on the mask it began on; the first violation
 * stops input. The sweep then leaves through the measured Back control and
 * must find the title it started from. Its frames are what the glyph table in
 * the Custom Night model is learned from.
 *
 * `--set F,B,C,X` is the held-out use of that table: it reads the dials, walks
 * each to its target the short way round the 21-value cycle, and requires the
 * reader to name the expected value after every single press. It then walks
 * them back to the values it found, leaves through Back, and must find the
 * same title. It never presses Ready, and it refuses a target of 1/9/8/7 --
 * the combination that sends Ready somewhere other than a night.
 *
 * Frames are game content and stay outside the repository; the run record and
 * its hashes go to artifacts/runs/<id>/.
 */
import { createHash } from 'node:crypto';
import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { AdbDeviceBridge } from '../../src/campaign/adb-bridge.ts';
import { AdbHidProcess } from '../../src/campaign/physical-ports.ts';
import { HidWireTransport } from '../../src/venues/phone/hid.ts';
import { resolveSerial } from '../../bin/phone/local-profile.ts';
import { isList } from '@sixam/kernel';

/** The title observer's verdict on one native frame. */
interface TitleRead { confident: boolean, output: string, code: number | null, frame: string }
/** What a child process left. */
interface RunResult { code: number | null, signal: NodeJS.Signals | null, timedOut: boolean, stdout: string, stderr: string }
type RunOptions = { input?: string | Buffer | null, timeoutMs?: number, env?: NodeJS.ProcessEnv };
/** fnaf1-custom-night-read.py's verdict on one Custom Night frame. */
interface DialRead {
  readonly screen: string, readonly status?: string, readonly reason?: string,
  readonly masks: Readonly<Record<string, unknown>>, readonly dials: Readonly<Record<Dial, number>>;
}
type Point = readonly [number, number];
/** The measured FNaF 1 Custom Night model (profiles/fnaf1/moto-g56). */
interface CustomNightModel {
  readonly schema: string, readonly build: string;
  readonly dials: Readonly<Record<string, { readonly increment: Point, readonly decrement: Point }>>;
  readonly stepping: { readonly modulus: number, readonly contactMs: number, readonly autoRepeatAfterMs: number };
  readonly controls: { readonly back: { readonly point: Point } };
  readonly settle: { readonly boundMs: number };
}
/** The measured FNaF 1 title model. */
interface TitleModel { readonly schema: string, readonly build?: string, readonly items: Readonly<Record<string, unknown>> }
type Options = ReturnType<typeof parseArgs>;
/** A bridge built on the serial the lease resolved. */
type Bridge = AdbDeviceBridge & { readonly serial: string };

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const PACKAGE = 'com.scottgames.fivenightsatfreddys';
const BUILD = '2.0.7+40';
const LAUNCHER = '.Main';
const TITLE_MODEL_PATH = join(HERE, '../../profiles/fnaf1/moto-g56/title-fnaf1-moto-g56-v207.json');
const TITLE_OBSERVER = join(HERE, 'fnaf1-title-observe.sh');
const ROUTE_PATH = join(HERE, '../../profiles/fnaf1/moto-g56/fnaf1-community-loop-moto-g56-v207.json');
const TEARDOWN = join(HERE, '../../bin/phone/game-teardown.sh');
const CUSTOM_NIGHT_MODEL_PATH = join(HERE, '../../profiles/fnaf1/moto-g56/custom-night-fnaf1-moto-g56-v207.json');
const DIAL_READER = join(HERE, 'fnaf1-custom-night-read.py');
// A cap on what one probe may send, not a target: 4 dials x 2 directions x 21
// steps, plus the entry and the exit.
const MAX_INPUTS = 172;
const STEP_SETTLE_MS = 300;
const STAGES = Object.freeze(['title', 'custom-night']);
const CONSENSUS_FRAMES = 3;
const CONSENSUS_ATTEMPTS = 4;
// Bounds, not measurements: they cap how long a stage may wait before it
// refuses. The launch-to-title time is UNKNOWN(not-measured) on this build.
const TITLE_WAIT_MS = 45000;
const LEAVE_WAIT_MS = 12000;
const FRAME_INTERVAL_MS = 400;

const sleep = (ms: number) => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
const stamp = () => new Date().toISOString().replace(/[-:.]/g, '');
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

function fail(message: string): never { throw new Error(`fnaf1-menu-probe: ${message}`); }

function parseInteger(value: unknown, name: string, { min, max }: { min: number, max: number }) {
  if (!/^[0-9]+$/.test(String(value))) fail(`${name} must be an integer`);
  const number = Number(value);
  if (number < min || number > max) fail(`${name} must be ${min}..${max}`);
  return number;
}

const DIALS = Object.freeze(['freddy', 'bonnie', 'chica', 'foxy'] as const);
type Dial = (typeof DIALS)[number];
const isPoint = (value: unknown): value is Point => isList(value) && value.length === 2 && value.every(Number.isInteger);

/** `F,B,C,X` as four integers 0..20 in screen order; 1/9/8/7 is refused. */
export function parseTargets(text: unknown) {
  const parts = String(text ?? '').split(',');
  if (parts.length !== 4) fail('--set needs four comma-separated values: Freddy,Bonnie,Chica,Foxy');
  const values = parts.map((part, index) => parseInteger(part, `--set ${DIALS[index]}`, { min: 0, max: 20 }));
  if (values.join('/') === '1/9/8/7') fail('--set refuses 1/9/8/7: that combination sends Ready away from the night (customize g8, g60-g64)');
  // One entry per dial.
  return Object.freeze(Object.fromEntries(DIALS.map((dial, index) => [dial, values[index]])) as Record<Dial, number>);
}

/** The short way round the 21-value cycle: a signed step count, ties going up. */
export function stepsBetween(from: number, to: number, modulus = 21) {
  const up = ((to - from) % modulus + modulus) % modulus;
  return up <= modulus - up ? up : -(modulus - up);
}

export function parseArgs(argv: string[]) {
  const options = { live: false, confirmLive: false, dryRun: false, stage: null as string | null, frames: 12, label: null as string | null,
    sweep: false, set: null as Readonly<Record<Dial, number>> | null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--live') options.live = true;
    else if (arg === '--confirm-live') options.confirmLive = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--stage') options.stage = String(argv[++index] ?? '');
    else if (arg === '--frames') options.frames = parseInteger(argv[++index], '--frames', { min: 1, max: 40 });
    else if (arg === '--label') options.label = String(argv[++index] ?? '');
    else if (arg === '--sweep') options.sweep = true;
    else if (arg === '--set') options.set = parseTargets(argv[++index]);
    else fail(`unknown argument ${arg}`);
  }
  if (options.label !== null && !/^[a-z0-9][a-z0-9-]{0,47}$/.test(options.label))
    fail('--label must be 1..48 lowercase letters, digits, or hyphens');
  if (options.dryRun && options.live) fail('--dry-run and --live are mutually exclusive');
  // Dry unless --live (ADR 0002, 2026-09-29): no flag prints the bindings and touches no phone.
  if (!options.live) options.dryRun = true;
  if (!options.dryRun) {
    if (!options.confirmLive) fail('live observation needs both --live and --confirm-live');
    if (!STAGES.includes(options.stage as string)) fail(`--stage must be one of ${STAGES.join(', ')}`);
    if ((options.sweep || options.set) && options.stage !== 'custom-night') fail('--sweep and --set belong to --stage custom-night');
    if (options.sweep && options.set) fail('--sweep and --set are separate probes');
  }
  return Object.freeze(options);
}

function run(command: string, args: string[], { input = null, timeoutMs = 15000, env = {} }: RunOptions = {}) {
  return new Promise<RunResult>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: ROOT, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env } });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
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

const relativeToRoot = (path: string) => relative(ROOT, path).replaceAll('\\', '/');

/** A retained native frame. */
interface CaptureFrame { name: string, path: string, sha256: string, bytes: number, atWallMs: number }

class ProbeRecord {
  declare outdir: string;
  declare captureDir: string;
  declare document: {
    schema: string, id: string, startedAt: string, claimLevel: string, target: { package: string, build: string }, options: Options,
    bindings: object, capture: { sensor: string, directory: string, frames: CaptureFrame[] }, inputsSent: number, events: object[],
    status: string, updatedAt?: string, preflight?: unknown, titleReads?: string[], titleBefore?: string, titleAfter?: string,
    dialsAtEntry?: unknown, dialsSet?: unknown, dialsRestored?: unknown, recovery?: string, error?: string,
  };
  declare eventsPath: string;
  constructor({ id, outdir, captureDir, options, bindings }: { id: string, outdir: string, captureDir: string, options: Options, bindings: object }) {
    this.outdir = outdir; this.captureDir = captureDir;
    this.document = {
      schema: 'fnaf1-menu-probe-v1', id, startedAt: new Date().toISOString(),
      claimLevel: 'DEVICE_MEASURED native screencaps; no row is promoted to a model by this record alone',
      target: { package: PACKAGE, build: BUILD }, options, bindings,
      capture: { sensor: 'screencap-2400x1080', directory: captureDir, frames: [] },
      inputsSent: 0, events: [], status: 'STARTING',
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
    await this.event('capture', frame);
    return path;
  }

  async save(status: string) {
    this.document.status = status;
    this.document.updatedAt = new Date().toISOString();
    await writeFile(join(this.outdir, 'probe.json'), `${JSON.stringify(this.document, null, 2)}\n`);
  }
}

async function titleRead(bridge: Bridge, record: ProbeRecord, label: string): Promise<TitleRead> {
  const png = await bridge.capturePng(bridge.serial);
  if (!png) fail('native capture failed');
  const frame = await record.capture(label, png);
  const observed = await run(TITLE_OBSERVER, [], { input: png, timeoutMs: 10000 });
  const read = { confident: observed.code === 0, output: observed.stdout.trim(), code: observed.code, frame };
  await record.event('title-read', read);
  return read;
}

async function focused(serial: string) {
  const windows = await run('adb', ['-s', serial, 'shell', 'dumpsys', 'window'], { timeoutMs: 10000 });
  const focus = windows.stdout.split('\n').find(line => /mCurrentFocus=/.test(line)) ?? '';
  return focus.includes(`${PACKAGE}/`);
}

async function launch(serial: string, record: ProbeRecord) {
  const launched = await run('adb', ['-s', serial, 'shell', 'am', 'start', '-W', '-n', `${PACKAGE}/${LAUNCHER}`],
    { timeoutMs: 30000 });
  await record.event('launch', { code: launched.code, output: `${launched.stdout}${launched.stderr}`.trim() });
  if (launched.code !== 0 || !/Status:\s*ok/i.test(launched.stdout))
    fail(`launch failed: ${(launched.stdout || launched.stderr).trim()}`);
}

async function ensureTitle(bridge: Bridge, record: ProbeRecord, { requireHid }: { requireHid: boolean }) {
  if (!await focused(bridge.serial)) await launch(bridge.serial, record);
  else await record.event('launch-skipped', { reason: 'FNaF 1 already focused' });
  const preflight = await bridge.preflight({ targetPackage: PACKAGE, targetBuild: `${PACKAGE}:${BUILD}`,
    requireHelper: false, requireHid });
  record.document.preflight = preflight;
  await record.event('preflight', { status: preflight.status, checks: preflight.checks });
  if (preflight.status !== 'READY') fail(`preflight ${preflight.status}: ${JSON.stringify(preflight.checks)}`);
  await waitForTitle(bridge, record, 'wait');
}

async function waitForTitle(bridge: Bridge, record: ProbeRecord, prefix: string) {
  const deadline = performance.now() + TITLE_WAIT_MS;
  for (let waited = 0; ; waited += 1) {
    const read = await titleRead(bridge, record, `${prefix}-${String(waited).padStart(2, '0')}`);
    if (read.confident) return read;
    if (performance.now() > deadline) fail(`no confident FNaF 1 title within ${TITLE_WAIT_MS} ms: ${read.output}`);
    await sleep(1000);
  }
}

/**
 * Three fresh, identical, confident reads that list what the caller needs. The
 * title static refuses about one frame in ten (`ambiguous:static-bar`), so a
 * refused triple is retried a bounded number of times rather than read.
 */
async function titleConsensus(bridge: Bridge, record: ProbeRecord, prefix: string, required: readonly string[]) {
  let values: string[] = [];
  for (let attempt = 1; attempt <= CONSENSUS_ATTEMPTS; attempt += 1) {
    const reads: TitleRead[] = [];
    for (let index = 0; index < CONSENSUS_FRAMES; index += 1) {
      reads.push(await titleRead(bridge, record, `${prefix}-${attempt}-${index + 1}`));
      await sleep(FRAME_INTERVAL_MS);
    }
    values = reads.map(read => read.output);
    const items = values[0].startsWith('items=') ? values[0].slice('items='.length).split(',') : [];
    if (reads.every(read => read.confident) && new Set(values).size === 1 && required.every(item => items.includes(item))) {
      await record.event('title-consensus', { prefix, attempt, output: values[0] });
      return values[0];
    }
    await record.event('title-consensus-refused', { prefix, attempt, values });
  }
  fail(`FNaF 1 title consensus refused (${required.join('+')}) ${CONSENSUS_ATTEMPTS} times; last: ${values.join(' | ')}`);
}

async function stageTitle(bridge: Bridge, record: ProbeRecord, options: Options) {
  await ensureTitle(bridge, record, { requireHid: false });
  const reads: TitleRead[] = [];
  for (let index = 0; index < options.frames; index += 1) {
    reads.push(await titleRead(bridge, record, `title-${String(index + 1).padStart(2, '0')}`));
    await sleep(FRAME_INTERVAL_MS);
  }
  record.document.titleReads = reads.map(read => read.output);
}

async function readDials(png: Buffer): Promise<DialRead> {
  const result = await run('python3', [DIAL_READER, '--model', CUSTOM_NIGHT_MODEL_PATH], { input: png, timeoutMs: 15000 });
  try { return JSON.parse(result.stdout.trim()); }
  catch { fail(`dial reader returned no JSON: ${result.stdout.trim() || result.stderr.trim()}`); }
}

async function captureDials(bridge: Bridge, record: ProbeRecord, name: string) {
  const png = await bridge.capturePng(bridge.serial);
  if (!png) fail('native capture failed');
  const frame = await record.capture(name, png);
  const read = await readDials(png);
  await record.event('dial-read', { frame, ...read });
  if (read.screen !== 'custom-night') fail(`not the Custom Night screen: ${read.reason ?? read.status}`);
  return read;
}

/** Two consecutive identical reads: the screen has no static once it has faded in. */
async function settleCustomNight(bridge: Bridge, record: ProbeRecord, boundMs: number) {
  const deadline = performance.now() + boundMs;
  let previous = null as DialRead | null;
  for (let index = 1; ; index += 1) {
    const png = await bridge.capturePng(bridge.serial);
    if (!png) fail('native capture failed');
    const frame = await record.capture(`settle-${String(index).padStart(2, '0')}`, png);
    const read = await readDials(png);
    await record.event('dial-read', { frame, ...read });
    if (read.screen === 'custom-night' && previous?.screen === 'custom-night' &&
        JSON.stringify(read.masks) === JSON.stringify(previous.masks)) return read;
    previous = read;
    if (performance.now() > deadline) fail(`Custom Night did not settle within ${boundMs} ms`);
    await sleep(FRAME_INTERVAL_MS);
  }
}

/**
 * Every dial through a full cycle each way. One press, one read; the press
 * must move its own dial and nothing else, and 21 presses must come home.
 */
async function sweepDials(bridge: Bridge, record: ProbeRecord, hid: HidWireTransport, customNight: CustomNightModel, contactMs: number,
  start: DialRead) {
  let masks = start.masks;
  for (const [name, dial] of Object.entries(customNight.dials)) {
    for (const direction of ['increment', 'decrement'] as const) {
      const home = masks[name];
      for (let step = 1; step <= customNight.stepping.modulus; step += 1) {
        if (record.document.inputsSent >= MAX_INPUTS) fail(`input cap ${MAX_INPUTS} reached`);
        const [x, y] = dial[direction];
        await record.event('input.requested', { control: `${name}.${direction}`, step, point: { x, y }, durationMs: contactMs });
        await hid.send({ command: { action: { kind: 'press', durationMs: contactMs } }, point: { x, y } });
        record.document.inputsSent += 1;
        await record.event('input.released', { control: `${name}.${direction}`, step });
        await sleep(STEP_SETTLE_MS);
        const read = await captureDials(bridge, record, `${name}-${direction}-${String(step).padStart(2, '0')}`);
        const moved = Object.keys(read.masks).filter(other => read.masks[other] !== masks[other]);
        if (moved.length !== 1 || moved[0] !== name)
          fail(`${name}.${direction} step ${step} moved [${moved.join(', ') || 'nothing'}], not exactly ${name}`);
        masks = read.masks;
      }
      if (masks[name] !== home) fail(`${name}.${direction}: ${customNight.stepping.modulus} presses did not return to the starting value`);
      await record.event('dial-cycle-closed', { dial: name, direction, steps: customNight.stepping.modulus });
    }
  }
  return masks;
}

/** Press the measured Back and demand the title the probe entered from. */
async function leaveThroughBack(bridge: Bridge, record: ProbeRecord, hid: HidWireTransport, customNight: CustomNightModel, contactMs: number) {
  const [x, y] = customNight.controls.back.point;
  await record.event('input.requested', { control: 'back', point: { x, y }, durationMs: contactMs });
  await hid.send({ command: { action: { kind: 'press', durationMs: contactMs } }, point: { x, y } });
  record.document.inputsSent += 1;
  await record.event('input.released', { control: 'back' });
  await waitForTitle(bridge, record, 'after-back');
  const after = await titleConsensus(bridge, record, 'title-after-back', ['customNight']);
  record.document.titleAfter = after;
  if (after !== record.document.titleBefore) fail(`the title changed across the probe: ${record.document.titleBefore} -> ${after}`);
}

/**
 * Walk every dial to its target, one press at a time, and demand that the
 * reader names the expected value after each press -- the held-out test of a
 * glyph table learned from a different run's frames.
 */
async function setDials(bridge: Bridge, record: ProbeRecord, hid: HidWireTransport, customNight: CustomNightModel, contactMs: number,
  targets: Readonly<Record<Dial, number>>, label: string) {
  let read = await captureDials(bridge, record, `${label}-start`);
  if (read.status !== 'PASS') fail(`dials unreadable before ${label}: ${read.reason}`);
  const modulus = customNight.stepping.modulus;
  for (const dial of DIALS) {
    const steps = stepsBetween(read.dials[dial], targets[dial], modulus);
    const direction = steps > 0 ? 'increment' : 'decrement';
    for (let step = 1; step <= Math.abs(steps); step += 1) {
      if (record.document.inputsSent >= MAX_INPUTS) fail(`input cap ${MAX_INPUTS} reached`);
      const expected = ((read.dials[dial] + (steps > 0 ? 1 : -1)) % modulus + modulus) % modulus;
      const [x, y] = customNight.dials[dial][direction];
      await record.event('input.requested', { control: `${dial}.${direction}`, step, expected, point: { x, y }, durationMs: contactMs });
      await hid.send({ command: { action: { kind: 'press', durationMs: contactMs } }, point: { x, y } });
      record.document.inputsSent += 1;
      await record.event('input.released', { control: `${dial}.${direction}`, step });
      await sleep(STEP_SETTLE_MS);
      const next = await captureDials(bridge, record, `${label}-${dial}-${String(step).padStart(2, '0')}`);
      if (next.status !== 'PASS') fail(`${dial} unreadable after ${direction} ${step}: ${next.reason}`);
      const want = { ...read.dials, [dial]: expected };
      if (DIALS.some(other => next.dials[other] !== want[other]))
        fail(`${dial}.${direction} step ${step} read ${JSON.stringify(next.dials)}, expected ${JSON.stringify(want)}`);
      read = next;
    }
  }
  if (DIALS.some(dial => read.dials[dial] !== targets[dial]))
    fail(`${label} ended at ${JSON.stringify(read.dials)}, not ${JSON.stringify(targets)}`);
  await record.event('dials-set', { label, dials: read.dials });
  return read.dials;
}

/**
 * Force-stop, relaunch, and demand the title the probe started from. Every path
 * that sent the entry press and did not come home through Back ends here --
 * success and failure alike -- so no run leaves the phone in an unverified
 * state (mistake register entry 6).
 */
async function restartToTitle(bridge: Bridge, record: ProbeRecord) {
  const stopped = await run('bash', [TEARDOWN, PACKAGE], { timeoutMs: 30000, env: { ANDROID_SERIAL: bridge.serial } });
  await record.event('restart-stop', { code: stopped.code, output: `${stopped.stdout}${stopped.stderr}`.trim() });
  if (stopped.code !== 0) fail('the force-stop failed; the game state is UNKNOWN');
  await launch(bridge.serial, record);
  await waitForTitle(bridge, record, 'after-restart');
  const after = await titleConsensus(bridge, record, 'title-after-restart', ['customNight']);
  record.document.titleAfter = after;
  if (after !== record.document.titleBefore) fail(`the title changed across the probe: ${record.document.titleBefore} -> ${after}`);
}

/**
 * One press on the measured Custom Night row, then either the settling screen
 * retained (discovery) or the checked sweep and an exit through Back.
 */
async function stageCustomNight(bridge: Bridge, record: ProbeRecord, options: Options,
  { titleModel, contactMs, customNight }: { titleModel: TitleModel, contactMs: number, customNight: CustomNightModel }) {
  const point = titleModel.items.customNight;
  if (!isPoint(point)) fail('title model has no measured customNight row');
  await ensureTitle(bridge, record, { requireHid: true });
  const hidProcess = new AdbHidProcess({ serial: bridge.serial });
  const hid = new HidWireTransport({ write: line => hidProcess.write(line), ready: () => hidProcess.ready(), contactMs });
  let pressed = false;
  let exitedByBack = false;
  let stageError: unknown = null;
  try {
    await hid.start();
    await record.event('hid-ready', { contactMs });
    record.document.titleBefore = await titleConsensus(bridge, record, 'title-before-custom-night', ['customNight']);
    await record.event('input.requested', { control: 'customNight', point: { x: point[0], y: point[1] }, durationMs: contactMs });
    pressed = true;
    await hid.send({ command: { action: { kind: 'press', durationMs: contactMs } }, point: { x: point[0], y: point[1] } });
    record.document.inputsSent += 1;
    await record.event('input.released', { control: 'customNight' });
    const deadline = performance.now() + LEAVE_WAIT_MS;
    for (let attempt = 0; ; attempt += 1) {
      await sleep(500);
      const read = await titleRead(bridge, record, `after-press-${String(attempt + 1).padStart(2, '0')}`);
      if (!read.confident && /not-the-title-screen/.test(read.output)) break;
      if (performance.now() > deadline) fail('the Custom Night press did not leave the observed title');
    }
    if (options.set) {
      const start = await settleCustomNight(bridge, record, customNight.settle.boundMs);
      if (start.status !== 'PASS') fail(`dials unreadable at entry: ${start.reason}`);
      record.document.dialsAtEntry = start.dials;
      record.document.dialsSet = await setDials(bridge, record, hid, customNight, contactMs, options.set, 'set');
      record.document.dialsRestored = await setDials(bridge, record, hid, customNight, contactMs, start.dials, 'restore');
      await leaveThroughBack(bridge, record, hid, customNight, contactMs);
      exitedByBack = true;
    } else if (!options.sweep) {
      for (let index = 0; index < options.frames; index += 1) {
        const png = await bridge.capturePng(bridge.serial);
        if (!png) fail('native capture failed');
        await record.capture(`custom-night-${String(index + 1).padStart(2, '0')}`, png);
        await sleep(FRAME_INTERVAL_MS);
      }
    } else {
      const start = await settleCustomNight(bridge, record, customNight.settle.boundMs);
      record.document.dialsAtEntry = start.masks;
      const end = await sweepDials(bridge, record, hid, customNight, contactMs, start);
      if (JSON.stringify(end) !== JSON.stringify(start.masks)) fail('the sweep did not leave every dial where it found it');
      await leaveThroughBack(bridge, record, hid, customNight, contactMs);
      exitedByBack = true;
    }
  } catch (error) {
    stageError = error;
  } finally {
    try { await hid.abort(); } catch { /* release is best effort; the recovery below is the known state */ }
    try { await hidProcess.close(); } catch { /* the lease bounds process cleanup */ }
  }
  // Nothing pressed means the game is still on the title it was read on.
  if (pressed && !exitedByBack) {
    try {
      await restartToTitle(bridge, record);
      record.document.recovery = 'TITLE_CONFIRMED';
    } catch (error) {
      record.document.recovery = `FAILED: ${error instanceof Error ? error.message : String(error)}`;
      stageError ??= error;
    }
  }
  if (stageError) throw stageError;
}

async function main(argv: string[]) {
  const options = parseArgs(argv);
  const titleModel: TitleModel = JSON.parse(await readFile(TITLE_MODEL_PATH, 'utf8'));
  if (titleModel.schema !== 'title-model-v1' || !String(titleModel.build ?? '').startsWith(`${PACKAGE} `))
    fail('title model is not FNaF 1\'s');
  // The one measured FNaF 1 contact (controls-fnaf1 contactRule: 160 ms landed
  // where `input tap` was dropped). The route that carries it is the checked copy.
  const route = JSON.parse(await readFile(ROUTE_PATH, 'utf8'));
  const contactMs: unknown = route?.controls?.contactMs;
  if (contactMs !== 160) fail('the FNaF 1 route no longer carries the measured 160 ms contact');
  const customNight: CustomNightModel = JSON.parse(await readFile(CUSTOM_NIGHT_MODEL_PATH, 'utf8'));
  if (customNight.schema !== 'fnaf1-custom-night-model-v1' || customNight.build !== `${PACKAGE}:${BUILD}`)
    fail('Custom Night model is not FNaF 1\'s');
  if (customNight.stepping?.contactMs !== contactMs ||
      contactMs + 33 > customNight.stepping.autoRepeatAfterMs)
    fail('the dial contact does not clear the auto-repeat ceiling by the 33 ms seam margin');
  await Promise.all([access(TITLE_OBSERVER, fsConstants.X_OK), access(TEARDOWN, fsConstants.X_OK),
    access(DIAL_READER, fsConstants.X_OK)]);
  const bindings = {
    titleModel: { path: relativeToRoot(TITLE_MODEL_PATH), sha256: sha256(await readFile(TITLE_MODEL_PATH)) },
    titleObserver: { path: relativeToRoot(TITLE_OBSERVER), sha256: sha256(await readFile(TITLE_OBSERVER)) },
    contact: { path: relativeToRoot(ROUTE_PATH), contactMs },
    customNightModel: { path: relativeToRoot(CUSTOM_NIGHT_MODEL_PATH), sha256: sha256(await readFile(CUSTOM_NIGHT_MODEL_PATH)) },
    dialReader: { path: relativeToRoot(DIAL_READER), sha256: sha256(await readFile(DIAL_READER)) },
  };
  if (options.dryRun) {
    console.log(JSON.stringify({ status: 'DRY_RUN', stages: STAGES, target: { package: PACKAGE, build: BUILD },
      bindings }, null, 2));
    return;
  }
  if (process.env.FNAF1_LEASE_HELD !== '1') fail('must run through fnaf1-menu-probe.sh so the serial lease is held');
  let serial: string;
  try { ({ serial } = resolveSerial()); } catch (error) { fail((error as Error).message); }
  const mode = options.sweep ? '-sweep' : options.set ? '-set' : '';
  const id = `fnaf1-menu-${options.stage}${mode}-${options.label ?? 'probe'}-${stamp()}`;
  const outdir = join(ROOT, 'artifacts', 'runs', id);
  const captureDir = join(homedir(), 'fnaf-apks', 'fnaf1-device-runs', id);
  await Promise.all([mkdir(outdir, { recursive: true }), mkdir(captureDir, { recursive: true })]);
  const record = new ProbeRecord({ id, outdir, captureDir, options, bindings });
  await record.save('PREFLIGHT');
  const bridge = new AdbDeviceBridge({ serial }) as Bridge;
  try {
    if (options.stage === 'title') await stageTitle(bridge, record, options);
    else if (options.stage === 'custom-night') await stageCustomNight(bridge, record, options, { titleModel, contactMs, customNight });
    await record.save('COMPLETE');
  } catch (error) {
    record.document.error = error instanceof Error ? error.message : String(error);
    await record.event('error', { message: record.document.error });
    await record.save('FAILED_OR_REFUSED');
  }
  console.log(`fnaf1 menu probe ${id}: ${record.document.status}; inputs=${record.document.inputsSent}; ` +
    `frames=${record.document.capture.frames.length}; out=${outdir}; frames=${captureDir}`);
  if (record.document.status !== 'COMPLETE') process.exitCode = 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: Error) => { console.error(error.message); process.exitCode = 2; });
}

// The measured menu steps, for a runner that goes on past Ready. Everything a
// caller needs to reach a set Custom Night the same way the probe does.
export { ProbeRecord, ensureTitle, titleRead, titleConsensus, waitForTitle, settleCustomNight, setDials,
  restartToTitle, launch, readDials, DIALS, PACKAGE, BUILD, LEAVE_WAIT_MS };
