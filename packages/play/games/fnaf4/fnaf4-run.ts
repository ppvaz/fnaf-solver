#!/usr/bin/env node
/**
 * One FNaF 4 night on the handset, observed through the Companion (native
 * REGION frames, SNAP for the title) and through the phone's own A2DP mix
 * (packages/play/bin/audio/fnaf4-cues.py, live). No screencap, no luma, no grid.
 *
 *   packages/play/games/fnaf4/fnaf4-run.sh [--dry-run]          (dry by default: no --live, no phone)
 *   packages/play/games/fnaf4/fnaf4-run.sh --live --confirm-live --mode calibrate [--label NAME]
 *
 * `calibrate` needs Night 1 on CONTINUE: every AI is 0 until the 2 AM row
 * (g581, 120 s), so the choreography below is open-loop and safe. It visits
 * every station the loop uses -- bed, left door, closet, right door -- and
 * uses every control there (flashlight, close, back), twice, while every
 * native-region frame and the audio mix are recorded on the host clock. Those
 * are the view templates and the transition timings a closed loop is built on.
 * The night is then abandoned by a force-stop (the save stays at Night 1).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { AdbCompanionPort, AdbHidProcess } from '../../src/campaign/physical-ports.ts';
import { HidWireTransport } from '../../src/venues/phone/hid.ts';
import { loadRegionSet, regionOpener } from '../../bin/phone/native-regions.ts';
import {
  Actor, type Point, type RegionRead, RegionRecorder, RunRecord, interruptibleSleep, onStopSignal, relaunchToTitle, releaseContacts,
  startVideo,
} from '../../bin/phone/night-kit.ts';
import { audioPreflight } from '../../bin/companion/audio-players.ts';
import { isList, isRecord } from '@sixam/kernel';
import { captureRoot, resolveSerial } from '../../bin/phone/local-profile.ts';
import {
  type CueEvent, type Hearing, HEARING_PATH, loadHearing, sideGrid, laughGrid, landings, laughs, quietTapAt, releaseAt, shadowOf,
} from './fnaf4-fredbear.ts';

type Side = 'L' | 'R';
type Control = Point & { readonly holdMs?: number, readonly gapMs?: number };
/** The measured FNaF 4 control map: the door and closet runs with their double-tap gaps, the pans with their holds. */
type Controls = Readonly<Record<string, Control>> & Readonly<Record<'leftDoor' | 'rightDoor' | 'closet', Control & { readonly gapMs: number }>>
  & Readonly<Record<'panLeft' | 'panRight', Control & { readonly holdMs: number }>>;
/** A fnaf4-detectors-v1 file: view templates over the edge and centre regions. */
interface Detectors {
  readonly schema: string, readonly regions: readonly string[], readonly templates: Readonly<Record<string, readonly number[]>>,
  readonly sampleCounts: readonly number[], readonly source?: unknown;
}
/** A frame read as its nearest view. */
interface Read {
  readonly view: string, readonly dist: number, readonly margin: number, readonly seq: number, readonly imageHostMs: number,
  readonly imageNs: bigint | null, readonly v: Float32Array, readonly loose?: boolean, readonly closetOff?: number;
}
/** A line of the live audio detector: a cue with its onset, a breathing hop, or the loop's envelope. */
interface CueLine extends CueEvent {
  readonly atMs?: number, readonly phase?: number, readonly loopStartMs?: number, readonly handle?: unknown;
}
/** The breathing loop's envelope line. */
interface Envelope { readonly lengthS: number, readonly loudS: readonly (readonly [number, number])[], readonly midS?: readonly (readonly [number, number])[] }
interface Stats {
  cycles: number, closes: number, flashes: number, occupiedHall: number, closetHolds: number, lost: number, foxyEntries?: number,
  fredbear?: object;
}
const isInteger = (value: unknown): value is number => Number.isInteger(value);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const PACKAGE = 'com.scottgames.fnaf4';
const ACTIVITY = `${PACKAGE}/.Main`;
const CONTROLS_PATH = join(HERE, '../../profiles/fnaf4/moto-g56/controls-fnaf4-moto-g56-v204.json');
const REGIONS_PATH = join(HERE, '../../profiles/fnaf4/moto-g56/regions-fnaf4-moto-g56-v204.json');
const CUES = join(ROOT, 'packages/play/bin/audio/fnaf4-cues.py');
const REFS = captureRoot('fnaf4-refs');
const PCM = '/org/bluealsa/hci0/dev_10_2B_1C_DA_18_2C/a2dpsnk/source';
const CONTACT_MS = 160;
const MODES = Object.freeze(['calibrate', 'loop']);
const NIGHT_MS = 360000;                 // 6 x 60 s (fnaf4.js CLOCK.hourMs, g568)
const STALE_FRAME_MS = 400;
const AUDIO_LAG_MS = 175;                // cal0: audio onset trails the same event's first frame by 112-244 ms
// An empty lit station renders pixel-identically (occupancy 0.0 on cal0 and
// on every empty read since). Foxy in the closet read 5.1 at an intermediate
// stage -- Pedro watched him plainly there while the panel said EMPTY (n4b)
// -- and 9.1-16 at others (n3c). A cut at 6 left that stage unheld; anything
// above 2 is somebody.
export const OCCUPIED = 2;
// The level's timers start this long after (negative: before) its first room
// frame: medians of 65, 88 and 74 breathing-phase reads on Nights 2-4 put it at
// -0.44..-0.55 s (the loop starts 1 s into the level, g4).
export const LEVEL_ORIGIN_MS = -520;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[-:.]/g, '');
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const wallOf = (hostMs: number) => performance.timeOrigin + hostMs;
function fail(message: string): never { throw new Error(`fnaf4-run: ${message}`); }

export function parseArgs(argv: string[]) {
  const o = { live: false, confirmLive: false, dryRun: false, mode: null as string | null, label: null as string | null,
    detectors: null as string | null, stopAfterMs: NIGHT_MS + 20000, teach: false, video: false, night: null as number | null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--live') o.live = true;
    else if (a === '--confirm-live') o.confirmLive = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--mode') o.mode = argv[++i];
    else if (a === '--label') o.label = argv[++i];
    else if (a === '--detectors') o.detectors = argv[++i];
    else if (a === '--stop-after-ms') o.stopAfterMs = Number(argv[++i]);
    else if (a === '--teach') o.teach = true;
    else if (a === '--video') o.video = true;
    else if (a === '--night') o.night = Number(argv[++i]);
    else fail(`unknown argument ${a}`);
  }
  if (o.label !== null && !/^[a-z0-9][a-z0-9-]{0,40}$/.test(o.label)) fail('--label is lowercase letters, digits, hyphens');
  if (o.dryRun && o.live) fail('--dry-run and --live are mutually exclusive');
  // Dry unless --live (ADR 0002, 2026-09-29): no flag prints the bindings and touches no phone.
  if (!o.live) o.dryRun = true;
  if (o.dryRun) return o;
  if (!o.confirmLive) fail('live actuation needs --live and --confirm-live');
  if (!MODES.includes(o.mode as string)) fail(`--mode is one of ${MODES.join(', ')}`);
  if (o.mode === 'loop' && !o.detectors) fail('loop needs --detectors (a fnaf4-detectors-v1 file)');
  if (o.mode === 'loop' && !(isInteger(o.night) && o.night >= 1 && o.night <= 8))
    fail('loop needs --night 1..8 (the title\'s CONTINUE number, or 6-8 for the extra nights)');
  return o;
}

/**
 * The live audio detector as a child: its JSON lines are kept in order with
 * their host wall times (cue onsets, and the breathing level every 100 ms).
 */
/**
 * Night 5 is Fredbear's alone (g228; every other AI stays 0), so its detector
 * matches only his families and our own run: the full set costs 109 ms of a
 * 100 ms hop on a loaded host (2026-09-27), and a detector that falls behind
 * hears every landing late.
 */
export const FREDBEAR_ONLY_FAMILIES = ['run', 'fb-left', 'fb-right', 'laugh'];
export function cueArgs(captureDir: string, night: number | null) {
  return [CUES, '--refs', REFS, '--live', PCM, '--raw', join(captureDir, 'audio.raw'),
    '--events', join(captureDir, 'cues.jsonl'), '--hearing', fileURLToPath(HEARING_PATH),
    ...(night === 5 ? ['--families', FREDBEAR_ONLY_FAMILIES.join(','), '--no-breath'] : [])];
}

function startCues(captureDir: string, night: number | null) {
  const child = spawn('python3', cueArgs(captureDir, night), { stdio: ['ignore', 'pipe', 'pipe'] });
  const events: CueLine[] = [];
  const errors: string[] = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    try { events.push(JSON.parse(line)); } catch { /* partial line at exit */ }
  });
  createInterface({ input: child.stderr }).on('line', (line) => errors.push(line));
  return {
    events, errors,
    started: () => events.some(e => e.cue === 'start'),
    async stop() {
      if (child.exitCode === null) child.kill('SIGTERM');
      for (let i = 0; i < 40 && child.exitCode === null; i += 1) await sleep(100);
      if (child.exitCode === null) child.kill('SIGKILL');
    },
  };
}

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const numberList = (value: unknown) => isList(value) && value.every(finiteNumber);

/** The measured control map, checked: every control a point, the runs with their gaps and the pans with their holds. */
export function controlsOf(model: unknown): Controls {
  const map = isRecord(model) ? model.controlMap : undefined;
  if (!isRecord(map)) fail('the control model has no controlMap');
  const controls: Record<string, Control> = {};
  for (const [name, point] of Object.entries(map)) {
    if (!isRecord(point) || !finiteNumber(point.x) || !finiteNumber(point.y)) fail(`control ${name} is not a point`);
    for (const key of ['holdMs', 'gapMs']) {
      if (point[key] !== undefined && !finiteNumber(point[key])) fail(`control ${name}'s ${key} is not a number`);
    }
    controls[name] = { x: point.x, y: point.y, holdMs: point.holdMs as number | undefined, gapMs: point.gapMs as number | undefined };
  }
  for (const run of ['leftDoor', 'rightDoor', 'closet']) if (!finiteNumber(controls[run]?.gapMs)) fail(`control ${run} has no double-tap gap`);
  for (const pan of ['panLeft', 'panRight']) if (!finiteNumber(controls[pan]?.holdMs)) fail(`control ${pan} has no hold time`);
  return controls as Controls;
}

/** A fnaf4-detectors-v1 file, checked: named regions, a template per view and a sample count per region. */
export function readDetectors(value: unknown): Detectors {
  if (!isRecord(value) || value.schema !== 'fnaf4-detectors-v1') fail('--detectors is not fnaf4-detectors-v1');
  const { regions, templates, sampleCounts } = value;
  if (!isList(regions) || !regions.every((r) => typeof r === 'string')) fail('--detectors regions are not names');
  if (!isRecord(templates) || !Object.values(templates).every(numberList)) fail('--detectors templates are not lists of numbers');
  if (!numberList(sampleCounts) || sampleCounts.length !== regions.length || sampleCounts.length < 2)
    fail('--detectors needs a sample count for each region, edges first');
  return value as unknown as Detectors;
}

/**
 * Night 1's safe window, twice over: bed (lit), left door (listen, lit, shut),
 * closet (lit, shut), right door (listen, lit, shut), back to the left view.
 * Waits are generous on purpose -- this run measures them.
 */
async function calibrate({ act, c, record, snapTo }: { act: Actor, c: Controls, record: RunRecord, snapTo: (name: string) => Promise<void> }) {
  const mark = (phase: string) => record.event('phase', { phase, hostMs: performance.now() });
  const pt = (k: string) => ({ x: c[k].x, y: c[k].y });
  for (let round = 1; round <= 2; round += 1) {
    await mark(`r${round}-room-left`); await sleep(1500);
    if (round === 1) await snapTo('room-left');
    await mark(`r${round}-bed`);
    await act.press('bed', pt('bed')); await sleep(1600);
    if (round === 1) await snapTo('bed');
    await mark(`r${round}-bed-lit`);
    await act.hold('flashlight', pt('flashlight'), 1500); await sleep(500);
    await mark(`r${round}-bed-back`);
    await act.press('back', pt('back')); await sleep(1800);
    await mark(`r${round}-left-door`);
    await act.double('leftDoor', pt('leftDoor'), c.leftDoor.gapMs); await sleep(3500);
    if (round === 1) await snapTo('left-door');
    await mark(`r${round}-left-lit`);
    await act.hold('flashlight', pt('flashlight'), 900); await sleep(900);
    await mark(`r${round}-left-shut`);
    await act.hold('closeDoor', pt('closeDoor'), 1500); await sleep(600);
    await mark(`r${round}-left-back`);
    await act.press('back', pt('back')); await sleep(2800);
    if (round === 1) await snapTo('hub-after-left');
    await mark(`r${round}-closet`);
    await act.double('closet', pt('closet'), c.closet.gapMs); await sleep(2800);
    if (round === 1) await snapTo('closet');
    await mark(`r${round}-closet-lit`);
    await act.hold('flashlight', pt('flashlight'), 900); await sleep(600);
    await mark(`r${round}-closet-shut`);
    await act.hold('closeDoor', pt('closeDoor'), 1500); await sleep(600);
    await mark(`r${round}-closet-back`);
    await act.press('back', pt('back')); await sleep(2500);
    await mark(`r${round}-pan-right`);
    await act.hold('panRight', pt('panRight'), c.panRight.holdMs); await sleep(1200);
    if (round === 1) await snapTo('room-right');
    await mark(`r${round}-right-door`);
    await act.double('rightDoor', pt('rightDoor'), c.rightDoor.gapMs); await sleep(3500);
    await mark(`r${round}-right-lit`);
    await act.hold('flashlight', pt('flashlight'), 900); await sleep(900);
    await mark(`r${round}-right-shut`);
    await act.hold('closeDoor', pt('closeDoor'), 1500); await sleep(600);
    await mark(`r${round}-right-back`);
    await act.press('back', pt('back')); await sleep(2800);
    await mark(`r${round}-pan-left`);
    await act.hold('panLeft', pt('panLeft'), c.panLeft.holdMs); await sleep(1500);
  }
  await mark('choreography-done');
}

/** A region frame as the detector file lays it out: left_edge, right_edge, center, RGB per sample. */
function frameVector(r: RegionRead, keys: readonly string[]) {
  const parts = keys.map((k) => r.regions[k].pixels);
  const n = parts.reduce((s, p) => s + p.length * 3, 0);
  const v = new Float32Array(n);
  let o = 0;
  for (const p of parts) for (const px of p) { v[o++] = (px >> 16) & 255; v[o++] = (px >> 8) & 255; v[o++] = px & 255; }
  return v;
}

/**
 * Views by nearest template (fnaf4-detectors-v1), and occupancy as the
 * centre region's distance from a lit view's EMPTY template: static views
 * render pixel-identically, so anyone in the hall, the closet or on the bed
 * is distance, not noise (cal0 held-out self-distance p90 0.0).
 */
class Eyes {
  declare recorder: RegionRecorder;
  declare keys: readonly string[];
  declare names: string[];
  declare t: Float32Array<ArrayBuffer>[];
  declare center: number[];
  constructor(recorder: RegionRecorder, det: Detectors) {
    this.recorder = recorder;
    this.keys = det.regions;
    this.names = Object.keys(det.templates);
    this.t = this.names.map((n) => Float32Array.from(det.templates[n]));
    const [l, r] = det.sampleCounts;
    this.center = [l + r, det.sampleCounts.reduce((s, x) => s + x, 0)];
  }
  now(): Read | null {
    const r = this.recorder.latest;
    // A null image time subtracts as 0, so such a frame is stale.
    if (!r || performance.now() - (r.imageHostMs as number) > STALE_FRAME_MS) return null;
    const v = frameVector(r, this.keys);
    let best = -1; let bd = Infinity; let second = Infinity;
    for (let i = 0; i < this.t.length; i += 1) {
      let d = 0; const t = this.t[i];
      for (let k = 0; k < v.length; k += 1) d += Math.abs(v[k] - t[k]);
      d /= v.length;
      if (d < bd) { second = bd; bd = d; best = i; } else if (d < second) second = d;
    }
    return { view: this.names[best], dist: bd, margin: second - bd, seq: r.seq, imageHostMs: r.imageHostMs as number, imageNs: r.imageNs, v };
  }
  /** Distance over the two edge regions only: the rooms, whatever the closet between them shows. */
  edgeDist(read: Read, name: string) {
    const t = this.t[this.names.indexOf(name)];
    const b = this.center[0];
    let d = 0;
    for (let k = 0; k < b; k += 1) d += Math.abs(read.v[k] - t[k]);
    return d / b;
  }
  occupancy(read: Read, litName: string) {
    const t = this.t[this.names.indexOf(litName)];
    const [a, b] = this.center;
    let d = 0;
    for (let k = a; k < b; k += 1) d += Math.abs(read.v[k] - t[k]);
    return d / (b - a);
  }
  async wait(views: readonly string[], boundMs: number) {
    const until = performance.now() + boundMs;
    let seen = -1;
    while (performance.now() < until) {
      const f = this.now();
      if (f && f.seq !== seen) {
        seen = f.seq;
        if (views.includes(f.view) && f.dist < 12) return f;
      }
      await sleep(15);
    }
    return null;
  }
  /**
   * Arrival at a station: a frame rendered at least `minMs` after the input
   * that matches the station's template almost exactly. The dark stations
   * are nearly the same picture -- the carpet run reads `doorR` at 0.8-2.6
   * mid-walk (n2a) -- but a station at rest renders pixel-identically (0.0),
   * so nearest-template alone arrives early and the next input is dropped.
   * Past `minMs + lateMs` a looser match is accepted and says so.
   */
  async arrive(views: readonly string[], sinceHostMs: number,
    { minMs, boundMs, exact = 0.8, loose = 6, lateMs = 1500 }: { minMs: number, boundMs: number, exact?: number, loose?: number, lateMs?: number }):
    Promise<Read | null> {
    let seen = -1;
    while (performance.now() < sinceHostMs + boundMs) {
      const f = this.now();
      if (f && f.seq !== seen) {
        seen = f.seq;
        const age = f.imageHostMs - sinceHostMs;
        if (age >= minMs && views.includes(f.view)) {
          if (f.dist <= exact) return { ...f, loose: false };
          if (age >= minMs + lateMs && f.dist <= loose) return { ...f, loose: true };
        }
        // The room views by their edges alone: the closet between them opens
        // wider as Foxy climbs inside (n4d's hub read 35.4 whole, and the
        // loop took it for the end of the night).
        if (age >= minMs) {
          for (const room of views.filter((v) => ROOM_VIEWS.includes(v))) {
            if (this.edgeDist(f, room) <= exact) return { ...f, view: room, loose: f.dist > exact, closetOff: f.dist };
          }
        }
      }
      await sleep(15);
    }
    return null;
  }
}

// Measured on cal0 (touch start -> settled frame): door runs 2357-2612 ms,
// closet 2195-2224, back from a door 1671-1752, from the closet 1748-1767,
// from the bed 955-969, bed turn 332-333, pans 289-567.
const ROOM_VIEWS: readonly string[] = ['hub', 'roomL', 'roomR'];
const ARRIVE: Readonly<Record<string, { readonly minMs: number, readonly boundMs: number, readonly exact?: number }>> = {
  leftDoor: { minMs: 2100, boundMs: 4200 }, rightDoor: { minMs: 2100, boundMs: 4200 },
  closet: { minMs: 1900, boundMs: 3800 },
  back: { minMs: 700, boundMs: 3000 },
  bed: { minMs: 250, boundMs: 1500, exact: 2.5 },
  panLeft: { minMs: 200, boundMs: 1500 }, panRight: { minMs: 200, boundMs: 1500 },
};

/** The live audio detector's lines, read by host time (wall ms). */
class Ears {
  declare cues: Pick<ReturnType<typeof startCues>, 'events'>;
  declare loopOriginWall: number | null;
  declare levelOriginWall: number | null;
  constructor(cues: Pick<ReturnType<typeof startCues>, 'events'>) { this.cues = cues; this.loopOriginWall = null; this.levelOriginWall = null; }
  /** The game's breathing loop starts 1 s into the level (g4); its audio reaches the host AUDIO_LAG_MS later. */
  anchor(levelOriginWall: number) { this.levelOriginWall = levelOriginWall; this.loopOriginWall = levelOriginWall + 1000 + AUDIO_LAG_MS; }
  // The detector's breath-envelope line.
  get envelope() { return (this.cues.events.find((e) => e.cue === 'breath-envelope') ?? null) as Envelope | null; }
  /** Seconds of the loop's loud and medium stretches that [fromWall, toWall] covered. */
  coverage(fromWall: number, toWall: number) {
    const env = this.envelope;
    if (!env || this.loopOriginWall === null || toWall <= fromWall) return { loud: 0, mid: 0 };
    const L = env.lengthS;
    const a = (((fromWall - this.loopOriginWall) / 1000) % L + L) % L;
    const len = (toWall - fromWall) / 1000;
    const over = (spans: Envelope['loudS']) => {
      let t = 0;
      for (const [s0, s1] of spans) for (const k of [0, L]) {
        const lo = Math.max(a, s0 + k); const hi = Math.min(a + len, s1 + k);
        if (hi > lo) t += hi - lo;
      }
      return t;
    };
    return { loud: over(env.loudS), mid: over(env.midS ?? env.loudS) };
  }
  /** Hops whose best lag puts the loop where the GAME's loop is (within 300 ms). */
  gameMatches(hops: readonly CueLine[]) {
    const env = this.envelope;
    if (!env || this.loopOriginWall === null) return 0;
    const L = env.lengthS * 1000;
    const origin = this.loopOriginWall;
    return hops.filter((e) => {
      if (e.ncc < 0.28 || e.loopStartMs === undefined) return false;
      const d = (((e.loopStartMs - origin) % L) + L) % L;
      return Math.min(d, L - d) <= 300;
    }).length;
  }
  /** The newest onset of any of `names` after `fromWall`, or null. */
  latest(names: readonly string[], fromWall = 0) {
    for (let i = this.cues.events.length - 1; i >= 0; i -= 1) {
      const e = this.cues.events[i];
      if (e.onsetMs !== undefined && e.onsetMs > fromWall && names.includes(e.cue)) return e;
    }
    return null;
  }
  breath(fromWall: number, toWall: number) {
    // A breathing hop carries its time and phase; undefined compares false.
    const hops = this.cues.events.filter((e) => e.cue === 'breath' && (e.atMs as number) >= fromWall && (e.atMs as number) <= toWall);
    const max = hops.reduce((m, e) => Math.max(m, e.ncc), 0);
    const game = this.gameMatches(hops);
    // A real loop keeps its phase: >= 3 hops above 0.30 whose loop phase
    // agrees within 80 ms (circular over the 17.675 s loop).
    const strong = hops.filter((e) => e.ncc >= 0.30).map((e) => e.phase as number);
    let consistent = 0;
    for (const p of strong) {
      const near = strong.filter((q) => { const d = Math.abs(p - q) % 17.675; return Math.min(d, 17.675 - d) <= 0.08; }).length;
      consistent = Math.max(consistent, near);
    }
    return { hops: hops.length, max, consistent, game };
  }
}

/**
 * The Companion's FNaF 4 teach panel, fed from the loop: the step, what each
 * station last showed, and the listening level while at a door. Words are the
 * panel's own vocabulary (Fnaf4Lesson.java); lines go out in order and a
 * failed send never touches the night.
 */
const F4_LINE = /^LESSON [0-9a-f]{32} f4 (origin \d{1,19}|step [A-Z_]+|door [LR] (CLEAR|BREATH|STEPS|HALL|SHUT)|closet (EMPTY|FOXY)|bed (CLEAR|FREDDLES)|level (\d{1,3}|OFF)|cover (\d{1,3}|OFF)|bedlit|fb mode (OFF|FREDBEAR|NIGHTMARE|NIGHTMARE_MAX)|fb at (UNKNOWN|LEFT|RIGHT|ROOM)|fb heard (RAN_LEFT|RAN_RIGHT|LAUGH)|fb ran|clear)$/;
function teachFeed(port: AdbCompanionPort, record: RunRecord) {
  const channel = port.openLesson({ timeoutMs: 800, lessonLine: F4_LINE });
  // openLesson found the endpoint.
  const token = (port.endpoint as NonNullable<AdbCompanionPort['endpoint']>).token;
  let chain: Promise<unknown> = Promise.resolve();
  const last: Record<string, string> = {};
  const say = (words: string, key: string | null = null) => {
    if (key !== null) { if (last[key] === words) return; last[key] = words; }
    chain = chain.then(() => channel.send(`LESSON ${token} f4 ${words}`))
      .catch((e: Error) => record.event('teach-error', { words, message: e.message }).catch(() => {}));
  };
  return {
    origin: (ns: bigint) => say(`origin ${ns}`),
    step: (step: string) => say(`step ${step}`, 'step'),
    door: (side: Side, word: string) => say(`door ${side} ${word}`, `door${side}`),
    closet: (word: string) => say(`closet ${word}`, 'closet'),
    bed: (word: string) => say(`bed ${word}`, 'bed'),
    level: (ncc: number | null) => say(ncc === null ? 'level OFF' : `level ${Math.max(0, Math.min(100, Math.round(ncc * 100)))}`, 'level'),
    cover: (fraction: number | null) => say(fraction === null ? 'cover OFF' : `cover ${Math.max(0, Math.min(100, Math.round(fraction * 100)))}`, 'cover'),
    bedLit: () => say('bedlit'),
    fbMode: (mode: string) => say(`fb mode ${mode}`, 'fbMode'),
    fbAt: (where: string) => say(`fb at ${where}`, 'fbAt'),
    fbHeard: (what: string) => say(`fb heard ${what}`),
    fbRan: () => say('fb ran'),
    clear: async () => { say('clear'); await chain; channel.close(); },
  };
}

/** The panel's words for nothing to say: a loop without --teach. */
type Teach = ReturnType<typeof teachFeed>;
const QUIET: Teach = { origin() {}, step() {}, door() {}, closet() {}, bed() {}, level() {}, cover() {}, bedLit() {}, fbMode() {}, fbAt() {}, fbHeard() {}, fbRan() {}, async clear() {} };

/**
 * The community loop on the handset, stations confirmed by native frames and
 * doors decided by the A2DP breathing level (the published audio line; the
 * rules are policy-fnaf4.js communityLoop's, device-timed):
 *
 *   left door -> right door -> closet -> bed -> back to the left
 *
 * The bed comes right after the doors and the closet: a bed turn is what
 * kills with a door-camper's bedroom flag set (g375/g376) or with Foxy's
 * attack full (g438), so it is taken when all three were just cleared. At a door, breathing (or doubt) means hold it
 * shut past a 3000 ms dismiss tick (g342); silence means a flash, which pushes
 * a hall-far occupant home (g68/g84) -- a flash into hall-near is the one
 * certain death (g345/g346), so doubt always closes.
 */
export async function loopNight({ act, c, record, eyes, ears, epochHostMs, stopAfterMs, night, teach = QUIET, hearing = loadHearing(),
  shouldStop = () => false }:
  { act: Actor, c: Controls, record: RunRecord, eyes: Eyes, ears: Ears, epochHostMs: number, stopAfterMs: number, night: number,
    teach?: Teach, hearing?: Hearing, shouldStop?: () => boolean }) {
  const pt = (k: string) => ({ x: c[k].x, y: c[k].y });
  const nightMs = () => performance.now() - epochHostMs;
  const log = (m: string, f: object = {}) => record.event('policy', { atNightMs: Math.round(nightMs()), m, ...f });
  const stats: Stats = { cycles: 0, closes: 0, flashes: 0, occupiedHall: 0, closetHolds: 0, lost: 0 };
  let where = 'roomL';

  const go = async (control: string, views: readonly string[], _boundMs: number, gesture = 'press'): Promise<Read | null> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const at = performance.now();
      // A double-tap control names its gap, a held one its hold.
      if (gesture === 'double') await act.double(control, pt(control), c[control].gapMs as number);
      else if (gesture === 'hold') await act.hold(control, pt(control), c[control].holdMs as number);
      else await act.press(control, pt(control));
      const f = await eyes.arrive(views, at, ARRIVE[control]);
      // Every walk resets his stillness counter (g567: a carpet run exists).
      if (f && ['leftDoor', 'rightDoor', 'closet', 'back'].includes(control)) teach.fbRan();
      if (f) {
        where = f.view;
        if (f.loose) await log(`${control}: arrived loose at ${f.view} ${f.dist.toFixed(1)}`);
        return f;
      }
      let now = eyes.now();
      await log(`${control}: no ${views.join('/')} (see ${now?.view} ${now?.dist?.toFixed(1)})`);
      // Not a view we know. The night is over only if that lasts: a jumpscare,
      // the game over and 06:00 never turn back into a room within 5 s.
      for (let waited = 0; (!now || now.dist >= 12) && waited < 5000; waited += 250) {
        await sleep(250);
        const read = eyes.now();
        now = read;
        const room = read && ROOM_VIEWS.find((v) => eyes.edgeDist(read, v) <= 0.8);
        if (read && room) { now = { ...read, view: room, dist: 0 }; break; }
      }
      if (!now || now.dist >= 12) return null;
      where = now.view;
      if (views.includes(now.view)) return now;
      // A back that lands in a room view has done its job, whichever of the
      // three it is (the right door returns through follow 37 to room-right,
      // g-follow); pressing the strip again from a room turns to the BED --
      // n3b did exactly that and sat facing the bed until Foxy struck.
      if (control === 'back' && ROOM_VIEWS.includes(now.view)) return now;
    }
    stats.lost += 1;
    return null;
  };
  /**
   * Hold the flashlight; the occupancy is the BEST frame of the hold against
   * the EMPTY lit template (the beam flickers with danger), whatever template
   * a frame is nearest to: n4c's Foxy at his last stage was nearer another
   * view than the lit closet, read 'undefined', and went unheld twice. A
   * flash with no frame at all reads as occupied (Infinity), never empty.
   */
  const flash = async (ms: number, litName: string) => {
    const start = performance.now();
    const done = act.hold('flashlight', pt('flashlight'), ms);
    let occ = Infinity; let seen = -1;
    while (performance.now() < start + ms + 40) {
      const f = eyes.now();
      if (f && f.seq !== seen) {
        seen = f.seq;
        if (f.imageHostMs > start + 60) occ = Math.min(occ, eyes.occupancy(f, litName));
      }
      await sleep(15);
    }
    await done;
    stats.flashes += 1;
    return occ;
  };

  const door = async (side: Side) => {
    const view = side === 'L' ? 'doorL' : 'doorR';
    teach.step('WALK');
    const arrived = await go(side === 'L' ? 'leftDoor' : 'rightDoor', [view], 3600, 'double');
    if (!arrived) return false;
    teach.step(side === 'L' ? 'LISTEN_LEFT' : 'LISTEN_RIGHT');
    const t0 = wallOf(arrived.imageHostMs) + AUDIO_LAG_MS + 100;
    // The breathing loop has quiet stretches of up to 4.5 s between breaths
    // (breath-envelope); with the game's loop phase known (the level origin),
    // a listen lasts until it has covered 0.5 s of loud or 1.4 s of medium
    // breath -- n4e/n4g trusted 1.1-1.4 s listens that may have covered
    // neither. It stops early on breathing that sits at the game's own phase.
    const listen = async (fromWall: number, minMs = 900, maxMs = 4500) => {
      const start = performance.now();
      for (;;) {
        const hop = ears.cues.events.findLast((e) => e.cue === 'breath');
        if (hop) teach.level(hop.ncc);
        const now = wallOf(performance.now());
        const cov = ears.coverage(fromWall - AUDIO_LAG_MS, now - AUDIO_LAG_MS);
        teach.cover(Math.min(1, Math.max(cov.loud / 0.5, cov.mid / 1.4)));
        const h = ears.breath(fromWall, now);
        const elapsed = performance.now() - start;
        if (elapsed >= minMs && (h.game >= 2 || cov.loud >= 0.5 || cov.mid >= 1.4)) return { ...cov, enough: true };
        if (elapsed >= maxMs) return { ...cov, enough: h.game >= 2 };
        await sleep(120);
      }
    };
    // A quiet verdict needs a listen that covered a breath: n4k lit the left
    // hall after a listen that ran out at 60% coverage (the panel said so).
    const judge = (h: ReturnType<Ears['breath']>, stepsSince: number, c: { readonly enough: boolean } | null) => {
      if (h.game >= 2 || (h.consistent >= 3 && h.max >= 0.45)) return 'BREATH';
      if (h.game === 1 || h.max >= 0.33 || ears.latest(['step'], stepsSince)) return 'DOUBT';
      if (c && !c.enough) return 'DOUBT';
      return 'CLEAR';
    };
    let cov = await listen(t0);
    let heard = ears.breath(t0, wallOf(performance.now()));
    let verdict = judge(heard, wallOf(arrived.imageHostMs) - 1500, cov);
    // Footsteps while we walked up or listened are someone arriving who has
    // not started breathing yet (n4e: Chica's steps at 80.3-81.7 s, a quiet
    // listen, and the flash met her at hall-near). Doubt closes; it never lights.
    const steps = ears.latest(['step'], wallOf(arrived.imageHostMs) - 1500);
    await log(`door ${side} listen ${verdict}`, { ...heard, step: steps ? steps.ncc : null, loudS: +cov.loud.toFixed(2), midS: +cov.mid.toFixed(2) });
    // What the panel says is why the loop holds: breathing, or footsteps of
    // someone who is not breathing yet.
    const why = () => (heard.game >= 1 || heard.max >= 0.33 ? 'BREATH' : 'STEPS');
    teach.door(side, verdict === 'CLEAR' ? 'CLEAR' : why());
    // A hold dismisses on the 3000 ms tick (g342) only while the door reads
    // shut (follow 21, g337), which the close animation reaches 733 ms in
    // (the animation bank): 3.4 s left 2.67 s shut and n4f's Bonnie sat
    // through three holds. 4.2 s covers a whole tick shut.
    for (let round = 0; verdict !== 'CLEAR' && round < 5; round += 1) {
      teach.step(why() === 'STEPS' ? (side === 'L' ? 'STEPS_LEFT' : 'STEPS_RIGHT') : (side === 'L' ? 'HOLD_LEFT' : 'HOLD_RIGHT'));
      teach.door(side, 'SHUT');
      teach.level(null);
      await act.hold('closeDoor', pt('closeDoor'), 4200);
      stats.closes += 1;
      teach.step(side === 'L' ? 'LISTEN_LEFT' : 'LISTEN_RIGHT');
      // The door takes ~0.7 s to open again, and listening is off until it
      // has (follow 22 -> 10/17): the listen starts after that.
      const t1 = wallOf(performance.now()) + 700 + AUDIO_LAG_MS;
      cov = await listen(t1, 1600);
      heard = ears.breath(t1, wallOf(performance.now()));
      verdict = judge(heard, t1 - AUDIO_LAG_MS, cov);
      await log(`door ${side} after close ${verdict}`, { ...heard, loudS: +cov.loud.toFixed(2), midS: +cov.mid.toFixed(2) });
      teach.door(side, verdict === 'CLEAR' ? 'CLEAR' : why());
    }
    teach.level(null);
    teach.cover(null);
    if (verdict !== 'CLEAR') {
      unresolved.add(side);
      await log(`door ${side} left without a flash, still breathing: no bed turn until it is cleared`);
      return true;
    }
    unresolved.delete(side);
    teach.step(side === 'L' ? 'FLASH_LEFT' : 'FLASH_RIGHT');
    const occ = await flash(350, `${view}-lit`);
    // A lit, silent hall resets that side's bedroom dwell (g485/g481).
    lastClearMs[side] = nightMs();
    if (occ > OCCUPIED) stats.occupiedHall += 1;
    teach.door(side, occ > OCCUPIED ? 'HALL' : 'CLEAR');
    await log(`door ${side} flash occupancy ${occ?.toFixed(1)}`);
    // The flashlight is a sub-cycle that returns to the door (follow 36/41 ->
    // 17, g-flash); a back pressed before it lands is dropped -- n1a lost the
    // first back at the right door in 18 of 18 cycles.
    await eyes.wait([view], 800);
    await sleep(120);
    return true;
  };

  // Freddy fills his meter by his AI every 4 s while the bed is unwatched
  // (g397) and lighting the bed at 60 kills (g427/g428); at Night 4's 4 that
  // is 60 in a minute, and n4c died on a bed light 57 s after the last one,
  // its cycle stretched by door and closet holds. So the bed is not once a
  // cycle but whenever it is due.
  const BED_EVERY_MS = night >= 6 ? 28000 : 35000;
  let lastBedMs = 0;
  const bedDue = () => nightMs() - lastBedMs > BED_EVERY_MS && unresolved.size === 0;
  const bed = async () => {
    for (const d of staleDoors()) {
      await log(`bed waits for the ${d} door (${Math.round((nightMs() - lastClearMs[d]) / 1000)} s since it was cleared)`);
      teach.step('BED_WAITS');
      if (d === 'L' && where !== 'roomL' && !await go('panLeft', ['roomL'], 1500, 'hold')) return false;
      if (d === 'R' && where !== 'roomR' && !await go('panRight', ['roomR'], 1500, 'hold')) return false;
      if (!await door(d)) return false;
      const ret = await home(d === 'L' ? 'left' : 'right');
      if (!ret) return false;
      if (ret === 'FOXY' && !(await centre(), await closet(nightMs())) ) return false;
      if (ret === 'FOXY' && !await leaveCloset()) return false;
    }
    if (unresolved.size > 0) { teach.step('BED_WAITS'); await log(`bed skipped: ${[...unresolved].join('/')} still breathing`); return true; }
    lastBedMs = nightMs();
    teach.step('WALK');
    const at = await go('bed', ['bed', 'doorR', 'doorL'], 1500);
    if (!at) return false;
    teach.step('BED');
    // Freddles are distance from the empty lit bed; drain until it reads empty.
    let occ = null as number | null;
    for (let slice = 0; slice < 6; slice += 1) {
      occ = await flash(600, 'bed-lit');
      teach.bed(occ <= OCCUPIED ? 'CLEAR' : 'FREDDLES');
      if (slice >= 1 && occ <= OCCUPIED) break;
    }
    await log(`bed occupancy ${occ?.toFixed(1)}`);
    teach.bedLit();
    // The turn back is part of the bed: a caller never presses back itself,
    // because from a room the same strip turns TO the bed.
    return !!await back(ROOM_VIEWS, 1800);
  };

  /**
   * The closet takes its double tap only with `follow` at 0 -- the room
   * between the two looks (g172/g173) -- and a settled look left or right is
   * follow 2 or 5 (g30-g37), so n4a's taps from room-right were refused
   * twice while Foxy sat inside. A short pan toward the middle ends the look
   * (follow 6 -> 0 on its animation, g36/g37); at 12 px/frame (g22/g24) a
   * 160 ms hold from the right or 250 ms from the left leaves the closet's
   * hitzone under x 1050 and outside both pan bands.
   */
  const centre = async () => {
    if (where === 'roomR') await act.hold('panLeft', pt('panLeft'), 160);
    else if (where === 'roomL') await act.hold('panRight', pt('panRight'), 250);
    else return;
    where = 'middle';
    await sleep(700);
  };

  /**
   * Out of the closet. The walk back ends at follow 0 wherever the room was
   * when the closet was entered (g31/g39), and after centre() that is about
   * x 680 -- no template's room (n4d read the hub at 35.4 and gave up on the
   * night at 2 AM). A full pan right then clamps the view at 788, room-right,
   * which renders exactly.
   */
  const leaveCloset = async () => {
    await act.press('back', pt('back'));
    await sleep(ARRIVE.back.minMs + 1100);
    return !!await go('panRight', ['roomR'], 1500, 'hold');
  };

  /**
   * The closet. Foxy inside is the lit closet's distance from its empty
   * template (0.0 when empty). A hold is sized by what the light shows: every
   * second shut takes a step off his attack and each passed 5 s roll adds one
   * (g273, g236); n4b's 6 s holds only took 9.1 back to 5.1 and he climbed to
   * the kill, so the hold grows with the stage he shows, and while he is
   * inside the loop comes here twice a cycle. `enteredMs` (his entry seen on
   * the way back from a door) buys the long first hold against the 3-7 steps
   * he enters with.
   */
  let foxyInside = false;
  // Foxy climbs one step per passed 5 s roll once inside and kills at 10 from
  // the 3-7 he enters with (g236, g273): 15 s at the fastest where every roll
  // passes (Night 6 on). n4j's closet went ~50 s unchecked across two door
  // episodes. So the closet is also kept due.
  let lastClosetMs = 0;
  const CLOSET_EVERY_MS = night >= 6 ? 15000 : 20000;
  const closetDue = () => nightMs() - lastClosetMs > CLOSET_EVERY_MS;
  // A door left with someone still breathing at it: the bed turn is what
  // kills with his bedroom flag (g375/g376), so no bed until it is cleared.
  const unresolved = new Set<Side>();
  // The bed turn kills if Bonnie or Chica has dwelt at hall-near 20 - night
  // seconds (g484/g479 -> g375/g376), and a lit silent hall is what resets
  // it. n4h turned to the bed ~40 s after the left door's last check, while a
  // right-door episode ran 19 s. So a bed turn needs both doors cleared
  // within (20 - night - 4) s, and a stale door is checked first.
  const lastClearMs: Record<Side, number> = { L: -Infinity, R: -Infinity };
  const FRESH_MS = Math.max(4000, (20 - Math.min(night, 8) - 4) * 1000);
  const staleDoors = () => (['L', 'R'] as const).filter((d) => nightMs() - lastClearMs[d] > FRESH_MS);
  const closet = async (enteredMs = 0) => {
    lastClosetMs = nightMs();
    teach.step('WALK');
    const at = await go('closet', ['closet'], 3200, 'double');
    if (!at) return false;
    teach.step('CLOSET');
    let occ = await flash(400, 'closet-lit');
    await log(`closet occupancy ${occ?.toFixed(1)}${enteredMs ? ' (entry seen)' : ''}`);
    foxyInside = enteredMs > 0 || occ > OCCUPIED;
    teach.closet(foxyInside ? 'FOXY' : 'EMPTY');
    if (foxyInside) {
      const holdMs = enteredMs > 0 || occ > 12 ? 9000 : occ > 7 ? 7000 : 5000;
      teach.step('CLOSET_HOLD');
      await act.hold('closeDoor', pt('closeDoor'), holdMs);
      stats.closetHolds += 1;
      teach.step('CLOSET');
      occ = await flash(400, 'closet-lit');
      await log(`closet after ${holdMs} ms hold occupancy ${occ?.toFixed(1)}`);
      foxyInside = occ > OCCUPIED;
      teach.closet(foxyInside ? 'FOXY' : 'EMPTY');
    }
    return true;
  };

  /**
   * Back from a door. The walk home ends at the hub (follow 13 -> X 750,
   * g97/g99/g110) unless Foxy ran in behind us: then it ends through follow
   * 37 with the closet creak and the view left on that door's side
   * (g98/g100/g111), which is the entry a player sees and hears. So a return
   * that lands in room-left or room-right is Foxy in the closet.
   */
  const home = async (side: string) => {
    const f = await back(ROOM_VIEWS, 2600);
    if (!f) return null;
    // A read without its closet distance compares false.
    if (f.view === 'hub' && (f.closetOff as number) > 10) {
      await log(`closet stands open in the hub (${(f.closetOff as number).toFixed(1)}): Foxy is inside`);
      foxyInside = true;
      teach.closet('FOXY');
    }
    if (f.view !== 'hub') {
      stats.foxyEntries = (stats.foxyEntries ?? 0) + 1;
      await log(`foxy ran in behind the ${side} door (return ended in ${f.view})`);
      teach.closet('FOXY');
      return 'FOXY';
    }
    return 'HUB';
  };

  const back = (views: readonly string[], boundMs: number) => go('back', views, boundMs);

  // --- Fredbear (Night 5; Nights 6-8 from 4 AM) --------------------------------
  // Every landing of his on a living-room side plays that side's sound (fb-left
  // h26 = AV11 3, fb-right h25 = AV17 3: g491/g492/g494/g495, the repels
  // g502/g503, the closet ejects g522/g523, the bed exits g526/g527); the step
  // from a side into its hall is silent (g493/g496). In a hall 15 s (AV19,
  // g644-g646) arms the black flash, and a shut door there sends him to the
  // other side on the 3000 ms tick. So the door to hold is the side he last
  // landed on -- as HEARD ON THE LEVEL'S GRID (fnaf4-fredbear.ts): n5b's four
  // landings scored 0.27-0.35, under the old 0.55 floor, and the loop held the
  // left door blind while he sat 15 s in the right hall. Holding is a key down,
  // which keeps listening mode at 0 (g321/g322): a roll while we LISTEN at a
  // door teleports him silently (g508-g511), so a door is never left untouched.
  const FRED_FROM_MS = night === 5 ? 0 : 240000;      // g599/g601/g603 at 4 AM
  const fredActive = () => night >= 5 && nightMs() >= FRED_FROM_MS;
  const nowWall = () => wallOf(performance.now());
  // main anchors the ears before the loop starts.
  const levelOriginWall = ears.levelOriginWall as number;
  const sGrid = sideGrid(levelOriginWall, night, hearing);
  const lGrid = laughGrid(levelOriginWall, hearing);
  const roomPeriodMs = hearing.laughGrid.roomPeriodMs[shadowOf(night) ? 'shadow1' : 'shadow0'];
  // His first move from the centre is a landing (g491/g492) on a roll that
  // passes with Fredbear AI / 20 (12 on Night 5, g228): after 4 rolls unheard
  // (2.6 % at 0.6) the start is a guess, and the panel says so. The wait ends
  // by ~17 s of level time, well inside the 25 s stillness fuse (g564).
  const FIRST_LISTEN_TICKS = 4;
  const fred = { side: null as Side | null, k: -Infinity, guess: null as Side | null, lastRunWall: null as number | null, heard: 0, laughs: 0,
    fakes: 0, roomChecks: 0, holds: 0 };
  const handledLaughs = new Set<number>();
  // Fold every decided grid tick into what we believe, and tell the panel
  // what was heard -- only what the grid accepted, never a raw cue line.
  const hearFred = () => {
    const now = nowWall();
    for (const row of landings(ears.cues.events, sGrid, hearing.sideGrid, { fromK: fred.k + 1 })) {
      if (!row.side || !sGrid.decided(row.k, now)) continue;
      fred.side = row.side; fred.k = row.k; fred.heard += 1;
      teach.fbHeard(row.side === 'L' ? 'RAN_LEFT' : 'RAN_RIGHT');
      teach.fbAt(row.side === 'L' ? 'LEFT' : 'RIGHT');
      record.event('policy', { atNightMs: Math.round(nightMs()), m: `fredbear landed ${row.side} (tick ${row.k})`, L: row.L, R: row.R }).catch(() => {});
    }
    for (const l of laughs(ears.cues.events, lGrid, hearing.laughGrid, roomPeriodMs)) {
      if (!l.accepted || handledLaughs.has(l.k) || !lGrid.decided(l.k, now)) continue;
      if (!l.room) {
        handledLaughs.add(l.k); fred.fakes += 1;
        record.event('policy', { atNightMs: Math.round(nightMs()), m: `fredbear laugh off the room period: a fake (10 s tick ${l.k})`, ncc: l.ncc }).catch(() => {});
      }
    }
  };
  const pendingRoom = () => laughs(ears.cues.events, lGrid, hearing.laughGrid, roomPeriodMs)
    .find((l) => l.accepted && l.room && !handledLaughs.has(l.k) && lGrid.decided(l.k, nowWall())) ?? null;
  // A walk waits for its quiet slot: our own run is the loudest sound in the
  // mix and would hide a landing on the tick it covers (n5b: 32.4 s, 35.4 s).
  const quiet = async (gesture: string) => {
    const wait = quietTapAt(nowWall(), sGrid, hearing, gesture, roomPeriodMs) - nowWall();
    if (wait > 0) await sleep(wait);
  };
  const ran = () => { fred.lastRunWall = nowWall(); teach.fbRan(); };
  const toRoomView = async (side: Side) => {
    const view = side === 'L' ? 'roomL' : 'roomR';
    return where === view || !!await go(side === 'L' ? 'panLeft' : 'panRight', [view], 1500, 'hold');
  };
  /** Off a door: wait for it to read open (a back pressed while it reopens is dropped: n5b 2 of 2), then back. */
  const offDoor = async (side: Side) => {
    const open = await eyes.wait([side === 'L' ? 'doorL' : 'doorR'], hearing.door.openAfterReleaseMs[1] + 900);
    if (!open) await log(`fredbear: the ${side} door never read open after the release`);
    const f = await back(ROOM_VIEWS, 2600);
    if (f) ran();
    return f;
  };
  const shutViewOf = (side: Side) => (side === 'L' ? 'doorL-shut' : 'doorR-shut');
  /**
   * To a door and hold it, one contact from the run until a reason to leave:
   * he landed on the other side (released just after the next tick, so the
   * door is shut on it), a laugh on the room period, 18 s since the last run
   * (25 s still arms the black flash, g564), a guess that has had one tick
   * shut, or the view is gone (a death).
   * The close button is pressed during the run -- at (1990, 900) it cannot pan
   * the room, which pans only below follow 7 (g21-g24).
   */
  const holdDoor = async (side: Side, guess: boolean) => {
    const stepName = `${guess ? 'FB_GUESS' : 'FB_HOLD'}_${side === 'L' ? 'LEFT' : 'RIGHT'}`;
    teach.step(stepName);
    if (!guess) teach.fbAt(side === 'L' ? 'LEFT' : 'RIGHT');
    if (!await toRoomView(side)) return false;
    await quiet('double');
    // What was decided while we panned and waited for the slot re-plans the walk.
    hearFred();
    if (pendingRoom() || (guess ? fred.side !== null : fred.side !== side)) return true;
    const control = side === 'L' ? 'leftDoor' : 'rightDoor';
    await act.double(control, pt(control), c[control].gapMs);
    ran();
    teach.door(side, 'SHUT');
    const started = nowWall();
    let shutAt = null as number | null; let lostSince = null as number | null; let releaseSlot = null as number | null;
    let reason = null as string | null;
    const heldK = fred.k;
    const openView = side === 'L' ? 'doorL' : 'doorR';
    fred.holds += 1;
    const r = await act.holdWhile('closeDoor', pt('closeDoor'), hearing.idle.holdCapS * 1000 + 4000, () => {
      const now = nowWall();
      const f = eyes.now();
      if (f && f.view === shutViewOf(side) && f.dist <= 2) shutAt ??= now;
      // n5b: the double tap to shut read 3.24-3.35 s; a miss leaves us in a
      // room view, where this touch pans the room (x > 819, g21-g24).
      if (shutAt === null) return now - started > 4500 ? 'never-shut' : null;
      // Fresh frames that are not this door for 1.5 s: the night ended under
      // us (n5b's death read black, then white, while the hold ran on 7.5 s).
      // A stale frame (none new for 400 ms) is not evidence either way.
      if (f) {
        const onDoor = (f.view === shutViewOf(side) || f.view === openView) && f.dist <= 2;
        if (!onDoor) { lostSince ??= now; if (now - lostSince > 1500) return 'lost'; } else lostSince = null;
      }
      hearFred();
      if (pendingRoom()) return 'laugh';
      if (releaseSlot === null) {
        if (fred.k > heldK && fred.side !== side) { reason = 'moved'; releaseSlot = releaseAt(fred.k + 1, sGrid, hearing); }
        else if (guess && fred.k > heldK && fred.side === side) { guess = false; teach.step(`FB_HOLD_${side === 'L' ? 'LEFT' : 'RIGHT'}`); teach.fbAt(side === 'L' ? 'LEFT' : 'RIGHT'); }
        else if (guess && now > shutAt + sGrid.periodMs) { reason = 'guess'; releaseSlot = releaseAt(sGrid.nextK(now), sGrid, hearing); }
        // Set when Fredbear's branch started.
        else if (now - (fred.lastRunWall as number) > hearing.idle.holdCapS * 1000) { reason = 'still'; releaseSlot = releaseAt(sGrid.nextK(now), sGrid, hearing); }
      }
      return releaseSlot !== null && now >= releaseSlot ? reason : null;
    });
    where = shutAt !== null ? (side === 'L' ? 'doorL' : 'doorR') : where;
    await log(`fredbear held ${side}${guess ? ' (a guess)' : ''} ${Math.round(r.heldMs)} ms: ${r.why}`,
      { side, fredSide: fred.side, fredK: fred.k, shutAfterMs: shutAt === null ? null : Math.round(shutAt - started) });
    if (r.why === 'lost') return false;
    if (r.why === 'never-shut') {
      const f = eyes.now();
      where = f && ROOM_VIEWS.includes(f.view) && f.dist <= 0.8 ? f.view : 'unknown';
      return !!f;
    }
    teach.door(side, 'CLEAR');
    if (r.why === 'still' || r.why === 'max') teach.step('FB_MOVE');
    if (!await offDoor(side)) return false;
    if (r.why === 'laugh') return roomCheck();
    return true;
  };
  /**
   * A laugh on the room period: he is on the bed or in the closet (g639/g640),
   * or it was g530's fake on the same tick. Every walk home runs the
   * fredcheck (g97/g99/g104/g374), which kills once he has been there 10 s
   * (g558): so the bed first, lit only until it reads empty, then the closet.
   * Both are SEEN: the lit bed and the lit closet against their empty templates.
   */
  const roomCheck = async () => {
    const l = pendingRoom();
    if (l) handledLaughs.add(l.k);
    fred.roomChecks += 1; fred.laughs += 1;
    const sinceMs = l ? Math.round(nowWall() - lGrid.at(l.k)) : null;
    await log(`fredbear room check (laugh ${l?.ncc} on the room period, ${sinceMs} ms ago)`);
    teach.fbHeard('LAUGH'); teach.fbAt('ROOM'); teach.step('FB_BED');
    if (!await go('bed', ['bed', 'doorR', 'doorL'], 1500)) return false;
    // On the lit bed he leaves on its own ticks (g525-g527); an empty bed needs
    // one lit frame (the light's first change is 53-117 ms at a settled
    // station, cal0), so frames before 250 ms are not read. He counts as seen
    // after three occupied frames in a row.
    let bedOcc = Infinity; let run = 0; let bedSeen = false; let seenSeq = -1; const lit0 = performance.now();
    const bed = await act.holdWhile('flashlight', pt('flashlight'), 8000, () => {
      const f = eyes.now();
      if (!f || f.seq === seenSeq || f.imageHostMs < lit0 + 250) return null;
      seenSeq = f.seq;
      bedOcc = eyes.occupancy(f, 'bed-lit');
      run = bedOcc > OCCUPIED ? run + 1 : 0;
      if (run >= 3) bedSeen = true;
      return bedOcc <= OCCUPIED ? 'empty' : null;
    });
    await log(`fredbear bed ${bedSeen ? 'held him' : 'empty'} after ${Math.round(bed.heldMs)} ms: ${bed.why} (last occupancy ${bedOcc.toFixed(1)})`);
    if (!await back(ROOM_VIEWS, 1800)) return false;
    if (bedSeen && bed.why === 'empty') return true;
    await centre();
    teach.step('FB_CLOSET');
    if (!await go('closet', ['closet'], 3200, 'double')) return false;
    ran();
    let occ = await flash(400, 'closet-lit');
    await log(`fredbear closet occupancy ${occ.toFixed(1)}`);
    if (occ > OCCUPIED) {
      // Shut, he walks out on the next 3000 ms tick (g522/g523), with a landing sound.
      const heldK = fred.k;
      const r = await act.holdWhile('closeDoor', pt('closeDoor'), 9000, () => { hearFred(); return fred.k > heldK ? 'ejected' : null; });
      occ = await flash(400, 'closet-lit');
      await log(`fredbear closet held ${Math.round(r.heldMs)} ms: ${r.why}; occupancy now ${occ.toFixed(1)}`);
    }
    return leaveCloset().then((ok) => { if (ok) ran(); return ok; });
  };
  const fredStep = async (): Promise<boolean> => {
    hearFred();
    if (pendingRoom()) return roomCheck();
    if (fred.side !== null) return holdDoor(fred.side, false);
    // Nothing heard yet: he is in the centre until his first landing. Wait in
    // a room view (never at a door: that is listening) for the first rolls.
    const firstTicks = sGrid.nextK(levelOriginWall + FRED_FROM_MS + 1) + FIRST_LISTEN_TICKS;
    if (fred.guess === null && !sGrid.decided(firstTicks, nowWall())) {
      teach.step('FB_LISTEN'); teach.fbAt('UNKNOWN');
      if (!ROOM_VIEWS.includes(where) && !await toRoomView('L')) return false;
      await sleep(120);
      return true;
    }
    fred.guess = fred.guess === 'L' ? 'R' : 'L';
    teach.fbAt('UNKNOWN');
    await log(`fredbear not heard: guessing the ${fred.guess} door`);
    return holdDoor(fred.guess, true);
  };

  let fredStarted = false;
  while (nightMs() < stopAfterMs && !shouldStop()) {
    if (fredActive()) {
      if (!fredStarted) {
        fredStarted = true;
        teach.fbMode(night === 8 ? 'NIGHTMARE_MAX' : night === 7 ? 'NIGHTMARE' : 'FREDBEAR');
        teach.fbAt('UNKNOWN');
        fred.lastRunWall = nowWall();
      }
      if (!await fredStep()) break;
      continue;
    }
    if (where !== 'roomL') {
      if (!await go('panLeft', ['roomL'], 1500, 'hold')) break;
    }
    // The closet's double tap at x 1050 is inside it from the hub and from
    // room-right, never from room-left (controls-fnaf4 closet).
    const toCloset = async (enteredMs: number) => {
      await centre();
      if (!await closet(enteredMs)) return false;
      return leaveCloset();
    };
    if (!await door('L')) break;
    let ret = await home('left');
    if (!ret) break;
    if (bedDue() && !await bed()) break;
    if ((ret === 'FOXY' || foxyInside || closetDue()) && !await toCloset(ret === 'FOXY' ? nightMs() : 0)) break;
    if (where !== 'roomR') {
      if (!await go('panRight', ['roomR'], 1500, 'hold')) break;
    }
    if (!await door('R')) break;
    ret = await home('right');
    if (!ret) break;
    if (ret !== 'FOXY' && bedDue() && !await bed()) break;
    // The closet before the bed: Foxy's kill fires as a bed turn finishes
    // (g438), so he is set back right before it (n3a died on that turn).
    await centre();
    if (!await closet(ret === 'FOXY' ? nightMs() : 0)) break;
    if (!await leaveCloset()) break;
    // bed() checks stale doors first and skips the turn while one breathes.
    if (!await bed()) break;
    stats.cycles += 1;
  }
  if (fredStarted) stats.fredbear = { heard: fred.heard, holds: fred.holds, roomChecks: fred.roomChecks, fakes: fred.fakes, lastSide: fred.side };
  await log('loop ended', stats);
  return stats;
}

async function main(argv: string[]) {
  const options = parseArgs(argv);
  const controlsModel = JSON.parse(await readFile(CONTROLS_PATH, 'utf8'));
  const regionModel = loadRegionSet(REGIONS_PATH, 'night');
  const hearing = loadHearing();
  const bindings = Object.fromEntries(await Promise.all([['controls', CONTROLS_PATH], ['regions', REGIONS_PATH], ['cues', CUES],
    ['hearing', fileURLToPath(HEARING_PATH)]]
    .map(async ([k, p]) => [k, { path: p.slice(ROOT.length + 1), sha256: sha256(await readFile(p)) }] as const)));
  if (options.dryRun) { console.log(JSON.stringify({ status: 'DRY_RUN', modes: MODES, bindings }, null, 2)); return; }
  if (process.env.FNAF4_LEASE_HELD !== '1') fail('run through fnaf4-run.sh so the serial lease is held');
  let serial: string;
  try { ({ serial } = resolveSerial()); } catch (error) { fail((error as Error).message); }
  const c = controlsOf(controlsModel);

  const id = `fnaf4-${options.mode}-${options.label ?? 'run'}-${stamp()}`;
  const outdir = join(ROOT, 'artifacts', 'runs', id);
  const captureDir = captureRoot('fnaf4-device-runs', id);
  await Promise.all([mkdir(outdir, { recursive: true }), mkdir(captureDir, { recursive: true })]);
  const record = new RunRecord({ schema: 'fnaf4-run-v1', pkg: PACKAGE, id, outdir, captureDir, options, bindings,
    claimLevel: 'DEVICE_MEASURED helper native frames and regions, A2DP audio; no detector or route is promoted by this record',
    sensor: 'cue-helper-mediaprojection-2400x1080 + a2dp-bluealsa' });
  await record.save('PREFLIGHT');
  let stopRequested = false;
  onStopSignal((signal) => { stopRequested = true; record.event('signal', { signal }).catch(() => {}); });

  const port = new AdbCompanionPort({ serial });
  // Name the target and show the lease on the phone (companion-status-v1). A
  // helper older than 0.2.0 answers unknown-verb; nothing this run reads changes.
  await record.event('companion-announce', await port.announce({ target: PACKAGE, lease: id.slice(0, 48) }));
  const snapDir = join(tmpdir(), `fnaf4-snap-${process.pid}`);
  await mkdir(snapDir, { recursive: true });
  let n = 0;
  const snapTo = async (name: string) => {
    n += 1;
    const target = join(snapDir, `f${n}.png`);
    await port.snap(`f4s${n}`, target);
    await record.capture(name, await readFile(target));
  };
  let hidProcess = null as AdbHidProcess | null; let hid = null as HidWireTransport | null;
  let recorder = null as RegionRecorder | null;
  let cues = null as ReturnType<typeof startCues> | null;
  let entered = false; let error = null as (Error & { refused?: boolean }) | null; let video = null as ReturnType<typeof startVideo> | null;
  try {
    const link = execFileSync(join(ROOT, 'packages/play/bin/audio/bt-audio-link.sh'), ['--ensure', '--game-package', PACKAGE],
      { encoding: 'utf8', timeout: 90000 });
    await record.event('audio-link', { status: link.trim().split('\n').pop() });
    // The mix is the whole phone's: another app's player masks the game (n5c:
    // org.fnaf2rebuild.play's title music, -22 against -35 dBFS, a deaf night).
    const players = audioPreflight({ serial, target: PACKAGE });
    await record.event('audio-players', players);
    if (players.status !== 'READY') {
      const refusal: Error & { refused?: boolean } = new Error(`fnaf4-run: audio preflight ${players.status}: ${players.reason}`);
      refusal.refused = true;
      throw refusal;
    }
    await snapTo('title-before');
    const adbHid = new AdbHidProcess({ serial });
    hidProcess = adbHid;
    // One sleep port the Actor can cut short: a door hold is ONE contact (holdWhile).
    const naps = interruptibleSleep();
    const wire = new HidWireTransport({ write: l => adbHid.write(l), ready: () => adbHid.ready(), contactMs: CONTACT_MS, sleep: naps.sleep });
    hid = wire;
    await wire.start();
    const act = new Actor(wire, record, CONTACT_MS, { interrupt: naps.interrupt });

    const live = startCues(captureDir, options.night);
    cues = live;
    for (let i = 0; i < 50 && !live.started(); i += 1) await sleep(100);
    if (!live.started()) fail(`audio detector did not start: ${live.errors.slice(-3).join(' | ')}`);
    const frames = new RegionRecorder(regionOpener(serial, regionModel.set, { port }), join(captureDir, 'regions.ndjson.gz'),
      { onReopen: (row) => { record.event('regions-reopened', { ...row }).catch(() => {}); } });
    recorder = frames;
    await frames.start();
    await sleep(500);

    if (options.video) video = startVideo(serial, id);
    entered = true;
    await act.press('continue', { x: c.continue.x, y: c.continue.y });
    const continueHostMs = performance.now();
    record.document.continueHostMs = continueHostMs;
    await record.save('NIGHT');
    if (options.mode === 'calibrate') {
      // The night card, then the room; the first calibration step starts well after.
      await sleep(11000);
      await calibrate({ act, c, record, snapTo });
    } else {
      // The loop requires --detectors and --night (parseArgs).
      const detectors = options.detectors as string;
      const det = readDetectors(JSON.parse(await readFile(detectors, 'utf8')));
      record.document.detectors = { path: options.detectors, sha256: sha256(await readFile(detectors)), source: det.source };
      const eyes = new Eyes(frames, det);
      const first = await eyes.wait(['roomL'], 20000);
      if (!first) fail('no room-left frame within 20 s of CONTINUE');
      // The level frame starts about when its first room frame shows
      // (UNKNOWN(origin-offset): no hour boundary has been measured yet).
      const epochHostMs = first.imageHostMs;
      const nightDoc: { firstRoomAfterContinueMs: number, epochHostMs: number, levelOriginWallMs: number, endedAtNightMs?: number } =
        { firstRoomAfterContinueMs: first.imageHostMs - continueHostMs, epochHostMs, levelOriginWallMs: wallOf(epochHostMs) + LEVEL_ORIGIN_MS };
      record.document.night = nightDoc;
      await record.save('NIGHT_RUNNING');
      let teach = QUIET;
      if (options.teach) {
        try {
          teach = teachFeed(port, record);
          // The origin on the helper's own image clock: the first room frame.
          // The level's own clock starts LEVEL_ORIGIN_MS before its first
          // room frame (breathing phase, Nights 2-4): the panel's bars run on it.
          // A region read names its image time.
          teach.origin((first.imageNs as bigint) + BigInt(LEVEL_ORIGIN_MS) * 1000000n);
          teach.step('WALK');
        } catch (e) { await record.event('teach-error', { message: (e as Error).message }); teach = QUIET; }
      }
      record.document.teach = options.teach;
      const ears = new Ears(live);
      ears.anchor(wallOf(epochHostMs) + LEVEL_ORIGIN_MS);
      record.document.loop = await loopNight({ act, c, record, eyes, ears, epochHostMs,
        stopAfterMs: options.stopAfterMs, night: options.night as number, teach, hearing, shouldStop: () => stopRequested });
      await teach.clear();
      nightDoc.endedAtNightMs = performance.now() - epochHostMs;
      for (let i = 0; i < 3; i += 1) { await snapTo(`after-night-${i}`); await sleep(2500); }
    }
    await snapTo('end');
  } catch (e) {
    error = e as Error;
  } finally {
    await releaseContacts(hid, hidProcess);
    if (recorder) {
      await recorder.stop();
      record.document.regions = { frames: recorder.frames, reopened: recorder.reopened, failure: recorder.failure,
        path: join(captureDir, 'regions.ndjson.gz') };
    }
    if (cues) {
      await cues.stop();
      record.document.audio = { events: cues.events.length, onsets: cues.events.filter(e => e.onsetMs).length,
        stderrTail: cues.errors.slice(-3), path: join(captureDir, 'cues.jsonl') };
    }
    if (video) {
      try {
        const dir = captureRoot('fnaf4-videos');
        await mkdir(dir, { recursive: true });
        record.document.video = await video.stop(dir);
      } catch (e) { record.document.video = `FAILED: ${(e as Error).message}`; }
    }
    if (entered) {
      // Abandon whatever follows the night (the minigame, a game over); the
      // save already holds the result. Leave the title up. FNaF 4 has no
      // title rule yet, so the relaunch says it is unverified.
      try {
        record.document.recovery = await relaunchToTitle({ pkg: PACKAGE, activity: ACTIVITY, snapTo,
          adb: (args, timeout) => { execFileSync('adb', ['-s', serial, ...args], { timeout }); } });
      } catch (e) { record.document.recovery = `FAILED: ${(e as Error).message}`; error ??= e as Error; }
    }
  }
  if (error) {
    record.document.error = error.message;
    await record.event('error', { message: error.message });
    await record.save(error.refused && record.document.inputsSent === 0 ? 'REFUSED' : 'FAILED_OR_REFUSED');
  } else await record.save('COMPLETE');
  console.log(`fnaf4 run ${id}: ${record.document.status}; inputs=${record.document.inputsSent}; ` +
    `regionFrames=${recorder?.frames}; audioEvents=${cues?.events.length}; out=${outdir}; frames=${captureDir}`);
  if (record.document.status !== 'COMPLETE') process.exitCode = 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: Error) => { console.error(error.message); process.exitCode = 2; });
}
