#!/usr/bin/env node
/**
 * One FNaF 1 Custom Night on the handset, observed only through the Cue
 * Helper: whole native frames (SNAP) for the title and the dials, raw native
 * regions (REGION) for the night. No screencap, no luma, no grid.
 *
 *   apps/desktop/bin/fnaf1-custom-run.sh [--dry-run]          (dry by default: no --live, no phone)
 *   apps/desktop/bin/fnaf1-custom-run.sh --live --confirm-live --dials 0,0,0,0 --mode calibrate-empty [--label NAME]
 *   apps/desktop/bin/fnaf1-custom-run.sh --live --confirm-live --dials F,B,C,X --mode grid420 --detectors FILE
 *        [--winner FILE | --route tree] [--label NAME]
 *
 * A grid420 night that a committed FNaF 1 winner names runs from this tree
 * only while the tree holds the winner's pinned route byte for byte
 * (routeStatus below); a drifted tree is refused unless `--route tree` says
 * the night runs the tree's route as a new one. The winner itself is re-run
 * from its pinned commit by fnaf1-winner.ts.
 *
 * The menu path is the probe's measured one (fnaf1-menu-probe.ts): three
 * identical confident title reads, the Custom Night row, the settled screen,
 * every dial walked to its target with a read after each press. Then Ready --
 * the one control on that screen the probe never pressed.
 *
 * `calibrate-empty` needs 0/0/0/0: with every dial at 0 nothing moves until
 * the 2 AM row gives Bonnie 1 (179 s), so the choreography below is
 * open-loop and safe. It exercises every control the 4/20 route uses -- both
 * lights with each door open and shut, both doors, the monitor, CAM 4B, both
 * pans -- while every native region frame is recorded with its image time on
 * the host clock. Those frames are the empty-class templates and the latency
 * measurements (press to first changed frame) the route's detectors and
 * margins are built from. The night is left by a title-gated force-stop.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { AdbDeviceBridge } from '../../../packages/play/src/campaign/adb-bridge.ts';
import { AdbCompanionPort, AdbHidProcess } from '../../../packages/play/src/campaign/physical-ports.ts';
import { HidWireTransport } from '../../../packages/play/src/venues/phone/hid.ts';
import { BINDINGS_DIR } from '@sixam/kernel';
import { ProbeRecord, ensureTitle, titleRead, titleConsensus, settleCustomNight, setDials, restartToTitle,
  DIALS, LEAVE_WAIT_MS } from '../../../packages/play/games/fnaf1/fnaf1-menu-probe.ts';
import { loadRegionSet, registerSet } from '../../../packages/play/bin/phone/native-regions.ts';
import { RegionRecorder, startVideo } from '../../../packages/play/bin/phone/night-kit.ts';
import { loadDetectors, makeClassifier } from '../../../packages/play/games/fnaf1/fnaf1-detectors.ts';
import type { DeviceFrame } from '../../../packages/play/games/fnaf1/fnaf1-detectors.ts';
import { listWinners, routeDrift } from '../../../packages/play/games/fnaf1/fnaf1-winner.ts';
import { grid420, PHONE_OPTIONS } from '../../../packages/propose/bin/census/fnaf1-device-lane.ts';
import type { DeviceAction, DevicePolicy, Frame, LaneContext, RouteWinner } from '../../../packages/propose/bin/census/fnaf1-device-lane.ts';
import { resolveSerial } from '../../../packages/play/bin/phone/local-profile.ts';
import type { RegionRead } from '../../../packages/play/bin/phone/night-kit.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const TITLE_MODEL_PATH = join(HERE, '../../../packages/play/profiles/fnaf1/moto-g56/title-fnaf1-moto-g56-v207.json');
const CUSTOM_NIGHT_MODEL_PATH = join(HERE, '../../../packages/play/profiles/fnaf1/moto-g56/custom-night-fnaf1-moto-g56-v207.json');
const CONTROLS_PATH = join(HERE, '../../../packages/play/profiles/fnaf1/moto-g56/controls-fnaf1-moto-g56-v207.json');
const REGIONS_PATH = join(HERE, '../../../packages/play/profiles/fnaf1/moto-g56/regions-fnaf1-moto-g56-v207.json');
const CONTACT_MS = 160;
const MODES = Object.freeze(['calibrate-empty', 'grid420']);
const NIGHT_MS = 535000;                 // 90 s + 5 x 89 s (fnaf1.ts CLOCK)
const STALE_FRAME_MS = 400;              // frame age p95 82 ms, max 111 ms measured; 400 is a stall
/**
 * Consecutive distinct region frames that read neither the office nor a camera before the night
 * counts as left (a jumpscare, a blackout, the 6 AM screen). A monitor flip reads that way for
 * INPUT.monitorFlipFrames (23, sourced) and must not end a night; past it the margin is unmeasured,
 * set at 150 (about 2.5 s at the helper's 60 fps) with the first 6 AM (3aaf02cd).
 */
export const LEFT_OFFICE_FRAMES = 150;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[-:.]/g, '');
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function fail(message: string): never { throw new Error(`fnaf1-custom-run: ${message}`); }

type Dial = (typeof DIALS)[number];
/** A point on the screen. */
interface Point { readonly x: number, readonly y: number }
/** The controls model, with the CAM 4B button the region model measured. */
interface Controls {
  readonly controlMap: Readonly<Record<string, Point & { readonly anchor?: string, readonly measuredAtPan?: number }>>;
  readonly panMap: Readonly<Record<string, Point & { readonly durationMs: number, readonly resultingPan: number }>>;
  readonly cam4bButton: Point;
}
/** The HID's one call this runner makes besides start and abort. */
type Hid = Pick<HidWireTransport, 'send'>;
type Classify = ReturnType<typeof makeClassifier>;
/** What a night adds to the probe's record. */
interface RunFields {
  route?: ReturnType<typeof routeStatus>;
  readyHostMs?: number;
  night?: { officeImageHostMs: number, officeAfterReadyMs: number, epochHostMs: number, originOffsetMs: number,
    ended?: string, endedAtNightMs?: number };
  teach?: boolean;
  regions?: { frames: number, errors: number, path: string };
  video?: unknown;
}

export function parseArgs(argv: string[]) {
  const o = { live: false, confirmLive: false, dryRun: false, dials: null as Readonly<Record<Dial, number>> | null,
    mode: null as string | null, label: null as string | null,
    detectors: null as string | null, stopAfterMs: NIGHT_MS + 3000, originOffsetMs: -97, chicaByCamera: PHONE_OPTIONS.chicaByCamera,
    teach: false, video: false,
    winner: null as string | null, route: null as string | null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--live') o.live = true;
    else if (a === '--confirm-live') o.confirmLive = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--dials') {
      const parts = String(argv[++i] ?? '').split(',').map(Number);
      if (parts.length !== 4 || !parts.every(v => Number.isInteger(v) && v >= 0 && v <= 20)) fail('--dials is F,B,C,X in 0..20');
      if (parts.join('/') === '1/9/8/7') fail('--dials refuses 1/9/8/7: Ready goes somewhere other than a night');
      o.dials = Object.fromEntries(DIALS.map((d, n) => [d, parts[n]])) as Record<Dial, number>;
    } else if (a === '--mode') o.mode = argv[++i];
    else if (a === '--label') o.label = argv[++i];
    else if (a === '--detectors') o.detectors = argv[++i];
    else if (a === '--teach') o.teach = true;
    else if (a === '--video') o.video = true;
    else if (a === '--stop-after-ms') o.stopAfterMs = Number(argv[++i]);
    else if (a === '--winner') o.winner = argv[++i];
    else if (a === '--route') {
      o.route = argv[++i];
      if (o.route !== 'tree') fail('--route takes only "tree": this run executes the tree\'s route, knowingly');
    } else fail(`unknown argument ${a}`);
  }
  if (o.winner !== null && o.route !== null) fail('--winner and --route tree are exclusive');
  if (o.label !== null && !/^[a-z0-9][a-z0-9-]{0,40}$/.test(o.label)) fail('--label is lowercase letters, digits, hyphens');
  if (o.dryRun && o.live) fail('--dry-run and --live are mutually exclusive');
  // Dry unless --live (ADR 0002, 2026-09-29): no flag prints the bindings and touches no phone.
  if (!o.live) o.dryRun = true;
  if (o.dryRun) return o;
  if (!o.confirmLive) fail('live actuation needs --live and --confirm-live');
  if (!MODES.includes(String(o.mode))) fail(`--mode is one of ${MODES.join(', ')}`);
  const dials = o.dials;
  if (!dials) fail('--dials is required');
  if (o.mode === 'calibrate-empty' && DIALS.some(d => dials[d] !== 0))
    fail('calibrate-empty is open-loop and is only safe at 0/0/0/0');
  if (o.mode === 'grid420' && !o.detectors) fail('grid420 needs --detectors (a fnaf1-detectors-v1 file)');
  return o;
}

/** What a grid420 night executes from this tree when no committed winner names its night. */
const ROUTE_FILES = Object.freeze(['packages/propose/bin/census/fnaf1-device-lane.ts', 'apps/desktop/bin/fnaf1-custom-run.ts',
  'packages/play/games/fnaf1/fnaf1-detectors.ts', 'packages/play/profiles/fnaf1/moto-g56/fnaf1-device-timing-moto-g56-v207.json',
  'packages/play/profiles/fnaf1/moto-g56/regions-fnaf1-moto-g56-v207.json', 'packages/play/profiles/fnaf1/moto-g56/controls-fnaf1-moto-g56-v207.json',
  'packages/play/profiles/fnaf1/moto-g56/custom-night-fnaf1-moto-g56-v207.json']);

/** The route a grid420 night runs: each file's hash, the winner that names the night and whether the tree holds its route, and any refusal. */
interface RouteStatus {
  files: Record<string, string | null>;
  winner: { path: string, id: string, commit: string, matches: boolean, differs: string[] } | null;
  route: string | null;
  refusal: string | null;
}

/**
 * Which route a grid420 night executes from this tree, and whether it is a
 * committed winner's. A night whose mode and dials a committed FNaF 1 winner
 * names runs from the tree only while the tree holds that winner's pinned
 * files byte for byte. Otherwise it is refused, and the refusal names both
 * ways on: the replay that runs the pinned route (fnaf1-winner.ts), and
 * `--route tree`, which runs the tree's route as the new route it is.
 * `--winner FILE` asks for one winner by name and is refused the same way,
 * without the second way. The files are hashed as they stand; the result goes
 * into the run record, so every grid420 night names the route it ran.
 */
export function routeStatus(options: Pick<ReturnType<typeof parseArgs>, 'mode' | 'dials' | 'winner' | 'route'>,
  { root = ROOT, winners = listWinners(root) } = {}): RouteStatus | null {
  if (options.mode !== 'grid420') return null;
  const hash = (path: string) => { const file = join(root, path); return existsSync(file) ? sha256(readFileSync(file)) : null; };
  const dialsOf = (dials: Readonly<Record<string, number>> | null | undefined) => (dials ? DIALS.map((d) => dials[d]).join('/') : 'no dials');
  // A FNaF 1 winner records the options its policy ran with and the night it won.
  const sameNight = (winner: RouteWinner) => winner.resolvedOptions?.policy === options.mode
    && dialsOf(winner.night?.dials) === dialsOf(options.dials);
  const asked = options.winner;
  const named = asked ? winners.find(({ path }) => path === relative(root, resolve(asked))) : null;
  const match = named ?? winners.find(({ winner }) => sameNight(winner as RouteWinner)) ?? null;
  const files = Object.fromEntries((match ? Object.keys(match.winner.sources) : ROUTE_FILES).map((p) => [p, hash(p)]));
  const status: RouteStatus = { files, winner: null, route: options.route, refusal: null };
  if (options.winner && !named) {
    status.refusal = `--winner ${options.winner} is not a committed fnaf1-route-winner-v1 under ${BINDINGS_DIR}/fnaf1`;
    return status;
  }
  if (!match) return status;
  const { path } = match;
  const winner = match.winner as RouteWinner;
  const differs = routeDrift(winner, root).map((d) => d.path);
  status.winner = { path, id: winner.id, commit: winner.sourcesAtCommit, matches: differs.length === 0, differs };
  if (named && !sameNight(winner)) {
    status.refusal = `--winner ${path} won ${dialsOf(winner.night?.dials)} ${winner.resolvedOptions?.policy}; ` +
      `this night is ${dialsOf(options.dials)} ${options.mode}`;
  } else if (differs.length && (named || options.route !== 'tree')) {
    status.refusal = `${winner.id} won this night at ${String(winner.sourcesAtCommit).slice(0, 12)}, and the tree no longer ` +
      `runs its route (${differs.join(', ')} differ from its pins). Re-run the winner itself with: npm run night -- ` +
      `fnaf1-winner --winner ${path} --live --confirm-live --label NAME` +
      (named ? '' : '. To run the tree\'s route as the new route it is, add --route tree.');
  }
  return status;
}

/** The probe's bridge shape, backed by the helper's projection instead of screencap. */
class HelperFrameBridge {
  declare serial: string;
  declare port: AdbCompanionPort;
  declare adbBridge: AdbDeviceBridge;
  declare n: number;
  declare dir: string;
  constructor(serial: string, port: AdbCompanionPort, adbBridge: AdbDeviceBridge) {
    this.serial = serial; this.port = port; this.adbBridge = adbBridge; this.n = 0;
    this.dir = join(tmpdir(), `fnaf1-snap-${process.pid}`);
  }
  async capturePng() {
    await mkdir(this.dir, { recursive: true });
    this.n += 1;
    const target = join(this.dir, `f${this.n}.png`);
    await this.port.snap(`f${this.n}`, target);
    return readFile(target);
  }
  preflight(options: Parameters<AdbDeviceBridge['preflight']>[0]) { return this.adbBridge.preflight(options); }
}

async function press(hid: Hid, record: ProbeRecord, control: string, point: Point, detail: object = {}) {
  const at = performance.now();
  await record.event('input.requested', { control, point, durationMs: CONTACT_MS, hostMs: at, ...detail });
  await hid.send({ command: { action: { kind: 'press', durationMs: CONTACT_MS } }, point });
  record.document.inputsSent += 1;
  await record.event('input.released', { control, hostMs: performance.now() });
}

async function hold(hid: Hid, record: ProbeRecord, control: string, point: Point, durationMs: number) {
  const at = performance.now();
  await record.event('input.requested', { control, point, durationMs, hostMs: at, kind: 'hold' });
  await hid.send({ command: { action: { kind: 'hold', durationMs } }, point });
  record.document.inputsSent += 1;
  await record.event('input.released', { control, hostMs: performance.now() });
}

/** The 0/0/0/0 choreography: every route control, open-loop, timestamped. */
async function calibrateEmpty({ hid, record, controls, snapTo }: {
  hid: Hid, record: ProbeRecord, controls: Controls, snapTo: (name: string) => Promise<void>,
}) {
  const c = controls.controlMap;
  const pt = (name: string) => ({ x: c[name].x, y: c[name].y });
  const mark = (phase: string) => record.event('phase', { phase, hostMs: performance.now() });
  await mark('office-pan0'); await snapTo('office-pan0');
  for (const side of ['left', 'right']) {
    if (side === 'right') {
      const p = controls.panMap.right;
      await hold(hid, record, 'pan-right', { x: p.x, y: p.y }, p.durationMs);
      await sleep(600); await mark('office-pan600'); await snapTo('office-pan600');
    }
    const light = side === 'left' ? 'leftDoorLight' : 'rightDoorLight';
    const door = side === 'left' ? 'leftDoor' : 'rightDoor';
    await mark(`${side}-light-open`);
    for (let i = 0; i < 5; i += 1) {
      await press(hid, record, light, pt(light), { state: 'on' }); await sleep(1200);
      if (i === 0) await snapTo(`${side}-lit-open`);
      await press(hid, record, light, pt(light), { state: 'off' }); await sleep(800);
    }
    await mark(`${side}-door-shut`);
    await press(hid, record, door, pt(door), { state: 'close' }); await sleep(1500);
    await snapTo(`${side}-door-shut`);
    for (let i = 0; i < 4; i += 1) {
      await press(hid, record, light, pt(light), { state: 'on' }); await sleep(1200);
      if (i === 0) await snapTo(`${side}-lit-shut`);
      await press(hid, record, light, pt(light), { state: 'off' }); await sleep(800);
    }
    await press(hid, record, door, pt(door), { state: 'open' }); await sleep(1200);
    await mark(`${side}-monitor`);
    for (let i = 0; i < 5; i += 1) {
      await press(hid, record, 'monitor', pt('monitor'), { state: 'up' }); await sleep(900);
      if (i === 0 && side === 'left') {
        await press(hid, record, 'cam4B', controls.cam4bButton, { state: 'select' }); await sleep(800);
        await snapTo('cam4b');
      }
      await sleep(300);
      await press(hid, record, 'monitor', pt('monitor'), { state: 'down' }); await sleep(900);
    }
  }
  const p = controls.panMap.left;
  await hold(hid, record, 'pan-left', { x: p.x, y: p.y }, p.durationMs);
  await mark('choreography-done');
}

/** A live REGION read as the classifier takes it: region name -> raw samples. */
const samples = (r: RegionRead) => ({ ...r, regions: Object.fromEntries(Object.entries(r.regions).map(([k, v]) => [k, v.pixels])) });

/** The office's first frame: the left panel reads a known empty state at pan 0. */
async function waitForOffice(recorder: RegionRecorder, classify: Classify, boundMs: number) {
  const until = performance.now() + boundMs;
  let seen = -1;
  while (performance.now() < until) {
    const r = recorder.latest;
    if (r && r.seq !== seen) {
      seen = r.seq;
      const f = classify(samples(r), 0);
      if (f.monitor === 'down' && f.leftDoor === 0 && f.left === 'dark') return r;
    }
    await sleep(5);
  }
  return null;
}

/**
 * The Companion's FNaF 1 teach panel, fed from the route: the step each
 * policy task names, and each side's door and last lit reading when they
 * change. Words are the panel's own vocabulary (Fnaf1Lesson.java); lines are
 * sent in order and a failed send never touches the night.
 */
const F1_LINE = /^LESSON [0-9a-f]{32} f1 (origin \d{1,19}|step [A-Z_]+|seen [LR] (CLEAR|OCCUPIED)|door [LR] (OPEN|SHUT)|clear)$/;
function teachFeed(port: AdbCompanionPort, record: ProbeRecord) {
  const channel = port.openLesson({ timeoutMs: 800, lessonLine: F1_LINE });
  // openLesson discovers the endpoint when it has none.
  const token = (port.endpoint as NonNullable<AdbCompanionPort['endpoint']>).token;
  let chain: Promise<unknown> = Promise.resolve();
  const last: Record<string, string> = {};
  const say = (words: string, key: string | null = null) => {
    if (key !== null) { if (last[key] === words) return; last[key] = words; }
    chain = chain.then(() => channel.send(`LESSON ${token} f1 ${words}`))
      .catch((e: Error) => record.event('teach-error', { words, message: e.message }).catch(() => {}));
  };
  const STEP: [RegExp, string][] = [[/ flick /, 'FLICK'], [/run check-left/, 'CHECK_LEFT'], [/run check-right/, 'CHECK_RIGHT'],
    [/run (pull-)?close-left/, 'CLOSE_LEFT'], [/run (pull-)?close-right/, 'CLOSE_RIGHT'],
    [/run reopen-left/, 'REOPEN_LEFT'], [/run reopen-right/, 'REOPEN_RIGHT'], [/run task$/, 'WAIT']];
  return {
    origin: (ns: bigint) => say(`origin ${ns}`),
    policyLog: (m: string) => { for (const [re, step] of STEP) if (re.test(m)) { say(`step ${step}`, 'step'); return; } },
    frame: (f: DeviceFrame, pan: number) => {
      const side = pan === 0 ? 'L' : 'R';
      const seen = pan === 0 ? f.left : f.right;
      if (seen === 'occupied' || seen === 'clear') say(`seen ${side} ${seen.toUpperCase()}`, `seen${side}`);
      const door = pan === 0 ? f.leftDoor : f.rightDoor;
      if (f.monitor === 'down' && (door === 0 || door === 2)) say(`door ${side} ${door === 2 ? 'SHUT' : 'OPEN'}`, `door${side}`);
    },
    clear: async () => { say('clear'); await chain; channel.close(); },
  };
}

/**
 * Drive a device-lane policy (packages/propose/bin/census/fnaf1-device-lane.ts) on the phone: the
 * same generator, its actions performed by the HID and its reads answered by
 * the newest native-region frame, classified. Time is the night's own: 0 is
 * the origin placed from the first office frame.
 */
async function runPolicy({ policy, options, hid, record, controls, recorder, classify, epochHostMs, stopAfterMs, teach = null }: {
  policy: DevicePolicy, options: Readonly<Record<string, unknown>>, hid: Hid, record: ProbeRecord, controls: Controls,
  recorder: RegionRecorder, classify: Classify, epochHostMs: number, stopAfterMs: number, teach?: ReturnType<typeof teachFeed> | null,
}) {
  const c = controls.controlMap;
  const point = (control: string, pan: number) => {
    const p = c[control];
    if (p.anchor === 'world' && p.measuredAtPan !== pan) throw new Error(`${control} is not reachable at pan ${pan}`);
    return { x: p.x, y: p.y };
  };
  let pan = 0;
  const ctx: LaneContext = {
    now: () => performance.now() - epochHostMs,
    epochErrorMs: 0,
    believedRollMs: (period, k) => k * period,
    options: { ...options, debug: (m: string) => { record.event('policy', { m }).catch(() => {}); teach?.policyLog(m); } },
  };
  const it = policy(ctx);
  let value: DeviceAction | void; let send: Frame | null | undefined;
  let lastSeq = -1; let stale = 0;
  while (ctx.now() < stopAfterMs) {
    ({ value } = it.next(send));
    send = undefined;
    if (value === undefined) break;
    if ('wait' in value) { await sleep(Math.max(0, value.wait)); continue; }
    if ('read' in value) {
      const r = recorder.latest;
      if (!r) { await sleep(10); continue; }
      // A frame older than this is not the room now: answer nothing and let
      // the rule poll again, rather than act on it.
      // Number(): a read with no image time (null) counts from 0, as it did.
      if (performance.now() - Number(r.imageHostMs) > STALE_FRAME_MS) { send = null; continue; }
      const f: DeviceFrame & { frame?: number, seq?: number | null } = classify(samples(r), pan);
      f.frame = (Number(r.imageHostMs) - epochHostMs) / (1000 / 60);
      f.seq = r.seq;
      // A room that stops being the office (a jumpscare, a blackout, the
      // 6 AM screen) is the end of the night, not a state to act on.
      if (r.seq !== lastSeq) { lastSeq = r.seq; stale = f.monitor === 'flipping' ? stale + 1 : 0; }
      if (stale > LEFT_OFFICE_FRAMES) { await record.event('night-left-office', { atMs: ctx.now() }); return 'LEFT_OFFICE'; }
      teach?.frame(f, pan);
      // The policy reads the classifier's frame where the model hands it a rendered one.
      send = f as unknown as Frame;
      continue;
    }
    if ('pan' in value) {
      const p = controls.panMap[value.pan];
      await hold(hid, record, `pan-${value.pan}`, { x: p.x, y: p.y }, p.durationMs);
      pan = p.resultingPan;
      continue;
    }
    if ('tapCam' in value) { await press(hid, record, 'cam4B', controls.cam4bButton, { atNightMs: ctx.now() }); continue; }
    if ('tap' in value) {
      const map: Readonly<Record<string, string>> = { leftLight: 'leftDoorLight', rightLight: 'rightDoorLight', leftDoor: 'leftDoor', rightDoor: 'rightDoor', monitor: 'monitor' };
      const control = map[value.tap];
      await press(hid, record, control, point(control, pan), { atNightMs: ctx.now(), pan });
      continue;
    }
    throw new Error(`unknown policy action ${JSON.stringify(value)}`);
  }
  return 'STOP_AFTER';
}

async function main(argv: string[]) {
  const options = parseArgs(argv);
  const controlsModel = JSON.parse(await readFile(CONTROLS_PATH, 'utf8'));
  const regionModel = loadRegionSet(REGIONS_PATH, 'night');
  const cam = regionModel.model.controlsMeasuredFrom?.cam4bButton;
  if (!cam || !Number.isInteger(cam.x) || !Number.isInteger(cam.y)) fail('region model has no CAM 4B button point');
  const controls: Controls = { ...controlsModel, cam4bButton: { x: cam.x, y: cam.y } };
  const titleModel = JSON.parse(await readFile(TITLE_MODEL_PATH, 'utf8'));
  const customNight = JSON.parse(await readFile(CUSTOM_NIGHT_MODEL_PATH, 'utf8'));
  const ready = customNight.controls?.ready?.point;
  if (!Array.isArray(ready) || ready.length !== 2) fail('Custom Night model has no measured Ready point');
  const bindings = Object.fromEntries(await Promise.all([
    ['controls', CONTROLS_PATH], ['regions', REGIONS_PATH], ['title', TITLE_MODEL_PATH], ['customNight', CUSTOM_NIGHT_MODEL_PATH],
  ].map(async ([k, p]) => [k, { path: p.slice(ROOT.length + 1), sha256: sha256(await readFile(p)) }])));
  const route = routeStatus(options);
  if (options.dryRun) { console.log(JSON.stringify({ status: 'DRY_RUN', modes: MODES, bindings, route }, null, 2)); return; }
  if (route?.refusal) fail(route.refusal);
  if (route?.winner && !route.winner.matches)
    console.error(`fnaf1-custom-run: running the tree's route, not ${route.winner.id}'s (${route.winner.differs.join(', ')} differ)`);
  if (process.env.FNAF1_LEASE_HELD !== '1') fail('run through fnaf1-custom-run.sh so the serial lease is held');
  let serial: string;
  try { ({ serial } = resolveSerial()); } catch (error) { fail((error as Error).message); }

  const id = `fnaf1-custom-${options.mode}-${options.label ?? 'run'}-${stamp()}`;
  const outdir = join(ROOT, 'artifacts', 'runs', id);
  const captureDir = join(homedir(), 'fnaf-apks', 'fnaf1-device-runs', id);
  await Promise.all([mkdir(outdir, { recursive: true }), mkdir(captureDir, { recursive: true })]);
  const record = new ProbeRecord({ id, outdir, captureDir, options, bindings });
  const doc: typeof record.document & RunFields = record.document;
  record.document.schema = 'fnaf1-custom-run-v1';
  record.document.claimLevel = 'DEVICE_MEASURED helper native frames and regions; no detector or route is promoted by this record';
  doc.route = route;
  record.document.capture.sensor = 'cue-helper-mediaprojection-2400x1080';
  await record.save('PREFLIGHT');

  const adbBridge = new AdbDeviceBridge({ serial });
  const port = new AdbCompanionPort({ serial });
  // Name the target and show the lease on the phone (companion-status-v1). A
  // helper older than 0.2.0 answers unknown-verb; nothing this run reads changes.
  await record.event('companion-announce', await port.announce({ target: 'com.scottgames.fivenightsatfreddys', lease: id.slice(0, 48) }));
  const bridge = new HelperFrameBridge(serial, port, adbBridge);
  const snapTo = async (name: string) => { const png = await bridge.capturePng(); await record.capture(name, png); };
  let hidProcess = null as AdbHidProcess | null; let hid = null as HidWireTransport | null;
  let recorder = null as RegionRecorder | null; let channel = null as ReturnType<AdbCompanionPort['openRegions']> | null;
  let entered = false; let error: unknown = null; let video = null as ReturnType<typeof startVideo> | null;
  try {
    await ensureTitle(bridge, record, { requireHid: true });
    const process_ = new AdbHidProcess({ serial });
    hidProcess = process_;
    hid = new HidWireTransport({ write: l => process_.write(l), ready: () => process_.ready(), contactMs: CONTACT_MS });
    await hid.start();
    doc.titleBefore = await titleConsensus(bridge, record, 'title-before', ['customNight']);
    const row = titleModel.items.customNight;
    entered = true;
    await press(hid, record, 'customNight', { x: row[0], y: row[1] });
    const deadline = performance.now() + LEAVE_WAIT_MS;
    for (let n = 1; ; n += 1) {
      await sleep(500);
      const read = await titleRead(bridge, record, `after-row-${n}`);
      if (!read.confident && /not-the-title-screen/.test(read.output)) break;
      if (performance.now() > deadline) fail('the Custom Night row did not leave the title');
    }
    const start = await settleCustomNight(bridge, record, customNight.settle.boundMs);
    if (start.status !== 'PASS') fail(`dials unreadable at entry: ${start.reason}`);
    doc.dialsAtEntry = start.dials;
    doc.dialsSet = await setDials(bridge, record, hid, customNight, CONTACT_MS, options.dials as NonNullable<typeof options.dials>, 'set'); // parseArgs refuses a live night without dials

    channel = port.openRegions({ timeoutMs: 1500 });
    await registerSet(channel, regionModel.set as NonNullable<typeof regionModel.set>); // loadRegionSet refuses a missing set
    recorder = new RegionRecorder(channel, join(captureDir, 'regions.ndjson.gz'));
    recorder.start();
    await sleep(500);
    if (options.video) video = startVideo(serial, id);
    await press(hid, record, 'ready', { x: ready[0], y: ready[1] });
    const readyHostMs = performance.now();
    doc.readyHostMs = readyHostMs;
    await record.save('NIGHT');
    if (options.mode === 'calibrate-empty') {
      await sleep(12000);
      await calibrateEmpty({ hid, record, controls, snapTo });
      // Hold through 1 AM (90 s after the office) so the hour change is recorded.
      const until = readyHostMs + 110000;
      while (performance.now() < until) await sleep(500);
      await snapTo('end-of-calibration');
    } else if (options.mode === 'grid420') {
      const classify = makeClassifier(loadDetectors(options.detectors as string)); // parseArgs requires them for grid420
      const office = await waitForOffice(recorder, classify, 20000);
      if (!office) fail('no office frame within 20 s of Ready');
      // The office frame is a classified image, so it carries its image time.
      const officeImageHostMs = office.imageHostMs as number;
      const epochHostMs = officeImageHostMs + options.originOffsetMs;
      const night: NonNullable<RunFields['night']> = { officeImageHostMs, officeAfterReadyMs: officeImageHostMs - readyHostMs,
        epochHostMs, originOffsetMs: options.originOffsetMs };
      doc.night = night;
      await record.event('night-origin', night);
      await record.save('NIGHT_RUNNING');
      let teach = null as ReturnType<typeof teachFeed> | null;
      if (options.teach) {
        try {
          teach = teachFeed(port, record);
          // The origin on the helper's own image clock: the office frame's
          // imageNs plus the calibrated offset.
          teach.origin((office.imageNs as bigint) + BigInt(Math.round(options.originOffsetMs * 1e6)));
          teach.policyLog('run task');
        } catch (e) { await record.event('teach-error', { message: (e as Error).message }); teach = null; }
      }
      doc.teach = options.teach;
      const ended = await runPolicy({ policy: grid420, options: { ...PHONE_OPTIONS, chicaByCamera: options.chicaByCamera }, hid, record,
        controls, recorder, classify, epochHostMs, stopAfterMs: options.stopAfterMs, teach });
      if (teach) await teach.clear();
      night.ended = ended;
      night.endedAtNightMs = performance.now() - epochHostMs;
      await record.event('night-ended', { ended, atNightMs: night.endedAtNightMs });
      try { await hid.abort(); } catch { /* release any held contact before looking */ }
      for (let i = 0; i < 3; i += 1) { await snapTo(`after-night-${i}`); await sleep(2500); }
    }
  } catch (e) {
    error = e;
  } finally {
    try { await hid?.abort(); } catch { /* best effort */ }
    try { await hidProcess?.close(); } catch { /* the lease bounds cleanup */ }
    if (recorder) {
      await recorder.stop();
      doc.regions = { frames: recorder.frames, errors: recorder.errors, path: join(captureDir, 'regions.ndjson.gz') };
    }
    try { await channel?.clear(); } catch { /* the helper drops regions with its session */ }
    channel?.close();
    if (video) {
      try {
        const dir = join(homedir(), 'fnaf-apks', 'fnaf1-videos');
        await mkdir(dir, { recursive: true });
        doc.video = await video.stop(dir);
      } catch (e) { doc.video = `FAILED: ${(e as Error).message}`; }
    }
    if (entered) {
      try { await restartToTitle(bridge, record); doc.recovery = 'TITLE_CONFIRMED'; }
      catch (e) { doc.recovery = `FAILED: ${(e as Error).message}`; error ??= e; }
    }
  }
  if (error) {
    doc.error = (error as Error).message;
    await record.event('error', { message: (error as Error).message });
    await record.save('FAILED_OR_REFUSED');
  } else await record.save('COMPLETE');
  console.log(`fnaf1 custom run ${id}: ${record.document.status}; inputs=${record.document.inputsSent}; ` +
    `regionFrames=${doc.regions?.frames}; out=${outdir}; frames=${captureDir}`);
  if (record.document.status !== 'COMPLETE') process.exitCode = 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 2; });
}
