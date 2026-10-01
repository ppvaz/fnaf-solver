#!/usr/bin/env node
/**
 * One FNaF 3 night on the handset, observed through the Companion's native
 * REGION frames (and SNAPs for a person to read). No screencap, no luma, no grid.
 *
 *   packages/play/games/fnaf3/fnaf3-run.sh [--dry-run]          (dry by default: no --live, no phone)
 *   packages/play/games/fnaf3/fnaf3-run.sh --live --confirm-live --mode calibrate [--label NAME]
 *   packages/play/games/fnaf3/fnaf3-run.sh --live --confirm-live --mode loop --detectors FILE --night N [--teach] [--video]
 *
 * `calibrate` plays the night from LOAD GAME at speed -- monitor up, every
 * camera in turn, the vent map, ventilation rebooted when its error line
 * shows -- while every native-region frame and every input is recorded on
 * the host clock. Those frames are the per-camera templates the loop reads
 * Springtrap against. It ends when the night does (a death returns to the
 * title; 6 AM goes on to the minigame).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { AdbCompanionPort, AdbHidProcess } from '../../src/campaign/physical-ports.ts';
import { HidWireTransport } from '../../src/venues/phone/hid.ts';
import { loadRegionSet, registerSet } from '../../bin/phone/native-regions.ts';
import { Actor, type Point, type RegionRead, RegionRecorder, RunRecord, startVideo } from '../../bin/phone/night-kit.ts';
import { Reader, type StoredPair, boxLuma, loadPairs, medianLuma, occupancy, stateScore } from './fnaf3-detectors.ts';
import { resolveSerial } from '../../bin/phone/local-profile.ts';

/** The measured FNaF 3 control map, with the pans' hold times. */
type Controls = Readonly<Record<string, Point>> & { readonly panLeft: Point & { readonly holdMs: number },
  readonly panRight: Point & { readonly holdMs: number } };
/** A frame recent enough to read: one with no image time reads as old as the process. */
type Seen = RegionRead & { readonly imageHostMs: number };
type Reboot = 'ALL' | 'VENT' | 'VIDEO' | 'AUDIO';
/** fnaf3-detectors-v1: each camera's empty template and an occupancy cut. */
interface DetectorsV1 {
  readonly schema: 'fnaf3-detectors-v1', readonly templates: Readonly<Record<string, readonly number[]>>, readonly occupied: number | null,
  readonly cuts?: Readonly<Record<string, number>>, readonly window?: number, readonly settleMs?: number, readonly source?: unknown,
  readonly cams?: undefined;
}
/** fnaf3-detectors-v2: the game's own pictures per camera, and each camera's cut. */
interface DetectorsV2 {
  readonly schema: 'fnaf3-detectors-v2',
  readonly cams: Readonly<Record<string, { readonly cut: number, readonly cutB: number | null, readonly pairs: readonly StoredPair[] }>>;
  readonly window?: number, readonly settleMs?: number, readonly source?: unknown;
  readonly templates?: undefined, readonly cuts?: undefined, readonly occupied?: undefined;
}
type Detectors = DetectorsV1 | DetectorsV2;
/** One look's verdict: v1 a temporal median against the empty template, v2 the game's pictures. */
type Score =
  | { v: 1, mean: number, over: number, gain: number, C?: undefined, B?: undefined, P?: undefined, phantom?: boolean }
  | { v: 2, C: number, B: number | null, P: number | null, mean?: undefined, over?: undefined, phantom?: boolean };
interface Stats {
  looks: number, sightings: number, seals: number, sealFails: number, reboots: number, lost: number, recoveries: number, lures: number,
  phantoms?: number;
}
/** Where one move can take him from each place the monitor shows. */
type Edges = Readonly<Record<number, readonly number[]>>;
/** How many of his moves out of a vent stand between him and the kill. */
type MovesToKill = Readonly<Record<number, number>>;
const isInteger = (value: unknown): value is number => Number.isInteger(value);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const PACKAGE = 'com.scottgames.fnaf3';
const ACTIVITY = `${PACKAGE}/.Main`;
const CONTROLS_PATH = join(HERE, '../../profiles/fnaf3/moto-g56/controls-fnaf3-moto-g56-v204.json');
const REGIONS_PATH = join(HERE, '../../profiles/fnaf3/moto-g56/regions-fnaf3-moto-g56-v204.json');
const CONTACT_MS = 160;
const MODES = Object.freeze(['calibrate', 'loop']);
const NIGHT_MS = 360000;                 // 6 x 60 s on Nights 2+ (fnaf3.js CLOCK, g644)
const STALE_FRAME_MS = 400;
// A vent seal is a double tap on its label (the game's instruction); FNaF 4's
// doors take the same gesture at 100 ms.
const SEAL_GAP_MS = 120;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[-:.]/g, '');
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function fail(message: string): never { throw new Error(`fnaf3-run: ${message}`); }
// A SIGINT ends the night's loop at its next step, so the record, the region
// file and the game's teardown still run (a killed run leaves all three).
const STOP = { requested: false };

export function parseArgs(argv: string[]) {
  const o = { live: false, confirmLive: false, dryRun: false, mode: null as string | null, label: null as string | null,
    detectors: null as string | null, stopAfterMs: NIGHT_MS + 30000, teach: false, video: false, night: null as number | null, survey: false };
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
    else if (a === '--survey') o.survey = true;
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
  if (o.mode === 'loop' && !o.detectors) fail('loop needs --detectors (a fnaf3-detectors-v1 file)');
  if (o.mode === 'loop' && !(isInteger(o.night) && o.night >= 1 && o.night <= 6))
    fail('loop needs --night 1..6 (the title\'s LOAD GAME number, 6 for Nightmare)');
  return o;
}

class Eyes {
  declare recorder: RegionRecorder;
  declare reader: Reader;
  constructor(recorder: RegionRecorder, reader: Reader) { this.recorder = recorder; this.reader = reader; }
  now() {
    const r = this.recorder.latest;
    // A null image time subtracts as 0.
    if (!r || performance.now() - (r.imageHostMs as number) > STALE_FRAME_MS) return null;
    return r as Seen;
  }
  /** The first frame rendered after `sinceHostMs` that satisfies `test`, or null by the bound. */
  async until(test: (frame: Seen) => boolean, sinceHostMs: number, boundMs: number) {
    let seen = -1;
    while (performance.now() < sinceHostMs + boundMs) {
      const f = this.now();
      if (f && f.seq !== seen && f.imageHostMs > sinceHostMs) {
        seen = f.seq;
        if (test(f)) return f;
      }
      await sleep(15);
    }
    return null;
  }
}

function controlsOf(model: { readonly controlMap: Readonly<Record<string, object>> }) {
  // The measured map names every control, the pans with their hold times.
  return Object.fromEntries(Object.entries(model.controlMap).map(([k, v]) => [k, { ...v }])) as Controls;
}
/** What the night's steps share. */
interface Hands { readonly act: Actor, readonly c: Controls, readonly eyes: Eyes, readonly reader: Reader }

/**
 * The monitor up: pan right, press its tab, and wait for a CAM label to turn
 * green; up to three tries. A try fails when the office is not taking input
 * yet -- for ~12 s after LOAD GAME (cal2: the raises at 7.3 s and 11.1 s
 * missed, 15.4 s landed) and just after the maintenance menu closes (cal2: a
 * pan 300 ms after the close left the tab out of view; 4 s later it landed).
 */
export async function raiseMonitor({ act, c, eyes, reader }: Hands, tries = 3) {
  const pt = (k: string) => ({ x: c[k].x, y: c[k].y });
  // Its tab is a toggle: pressed with the monitor up, it drops it (cal2's
  // recoveries flipped a raised monitor down after one unread label).
  const up = await eyes.until((fr) => reader.selected(fr) !== null, performance.now() - 400, 500);
  if (up) return { frame: up, tries: 0, ms: 0 };
  for (let i = 0; i < tries; i += 1) {
    // The menu may still be open: Exit is refused while a reboot runs, and the
    // blackout hides the menu for 2-3 s of every pulse, so a read of it closed
    // proves nothing (n3b 227.5 s: one Exit, a black frame read as closed, and
    // two minutes of raises behind the open menu). Exit first; with the menu
    // closed it is harmless (controls: exitMaint), and the pan follows.
    await act.press('exitMaint', pt('exitMaint'));
    await sleep(150);
    await act.hold('panRight', pt('panRight'), c.panRight.holdMs);
    await sleep(150);
    const at = performance.now();
    await act.press('monitor', pt('monitor'));
    const f = await eyes.until((fr) => reader.selected(fr) !== null, at, 1500);
    if (f) return { frame: f, tries: i + 1, ms: f.imageHostMs - at };
    const now = eyes.now();
    if (now && reader.title(now) >= 0.2) return null;
    await sleep(600);
  }
  return null;
}

/** Every read of `read(frame)` over `ms`, united: the error lines and words blink. */
async function collect(eyes: Eyes, ms: number, read: (frame: Seen) => Iterable<string>) {
  const out = new Set<string>();
  let seq = -1;
  const until = performance.now() + ms;
  while (performance.now() < until) {
    const f = eyes.now();
    if (f && f.seq !== seq) { seq = f.seq; for (const x of read(f)) out.add(x); }
    await sleep(15);
  }
  return out;
}

/**
 * What the loop knows of the three systems' counters without seeing them
 * (fnaf3 event sheet): the camera loses AI points each 12 s of monitor time
 * (`camera text` AV5, g783/g784) and a camera reboot zeroes the loss but not
 * AV5, which only reboot all does (g428, g430); each lure costs AI audio
 * points (g301/g308); every system errors at -10 (g380-g382).
 */
export class SystemsClock {
  declare ai: number;
  declare upMs: number;
  declare av5: number;
  declare camHits: number;
  declare lures: number;
  constructor(ai: number) { this.ai = Math.max(1, ai); this.upMs = 0; this.av5 = 0; this.camHits = 0; this.lures = 0; }
  /** Account monitor-up time; the game's 1 s tick counts it whole seconds at a time. */
  addMonitorMs(ms: number) {
    this.upMs += ms;
    while (this.upMs >= 1000) {
      this.upMs -= 1000;
      this.av5 += 1;
      if (this.av5 >= 12) { this.av5 = 0; this.camHits += 1; }
    }
  }
  /** Seconds of monitor time before video fails, from a camera counter at `hits`. */
  cameraLeftS(hits = this.camHits, av5 = this.av5) {
    const need = Math.ceil(10 / this.ai) - hits;
    return need <= 0 ? 0 : (12 - av5) + 12 * (need - 1);
  }
  luresLeft() { return Math.max(0, Math.ceil((10 - this.ai * this.lures) / this.ai)); }
  lured() { this.lures += 1; }
  rebooted(which: Reboot) {
    if (which === 'VIDEO' || which === 'ALL') this.camHits = 0;
    if (which === 'ALL') { this.av5 = 0; this.upMs = 0; }
    if (which === 'AUDIO' || which === 'ALL') this.lures = 0;
  }
}

/**
 * Which reboot, for the systems the menu says are broken. A single reboot is
 * 5-10 s (g425, 1 s ticks) and reboot all 10-20 s (g426, 2 s ticks), and exit
 * waits for either, so two single reboots in one visit cost what reboot all
 * does -- which also restores the third system and zeroes the camera's 12 s
 * counter. With one broken system, reboot all's extra ~6.7 s is worth it when
 * it buys that much: 7+ s of sight the camera counter already holds, an audio
 * counter one lure from breaking, or a camera that would send the loop back
 * within 15 s of monitor time anyway (a trip is ~5 s plus its reboot).
 */
export function chooseReboot(words: ReadonlySet<string>, clock: SystemsClock): Reboot | null {
  if (words.size >= 2) return 'ALL';
  if (words.has('VIDEO')) return clock.av5 >= 7 || clock.luresLeft() <= 1 ? 'ALL' : 'VIDEO';
  const other = words.has('VENT') ? 'VENT' : words.has('AUDIO') ? 'AUDIO' : null;
  if (!other) return null;
  return clock.cameraLeftS() < 15 ? 'ALL' : other;
}

const REBOOT_ROW: Readonly<Record<Reboot, string>> = { VENT: 'rebootVent', VIDEO: 'rebootCamera', AUDIO: 'rebootAudio', ALL: 'rebootAll' };

/**
 * Answer the monitor's red error lines with the reboot they need. The lines
 * name the system by their row; the maintenance menu's red "error" words say
 * it again and decide. Ventilation and video together take `reboot all`
 * (10-20 s, g426) rather than two trips; an audio error alone is left, since
 * this loop plays no lure. Exit does nothing while a reboot runs (cal1), so it
 * is pressed each second until the menu closes, and the office is given
 * 500 ms before the monitor goes back up (cal2).
 */
async function serviceSystems({ act, c, eyes, reader, clock = null, force = [], onMenu = async () => {} }: Hands & {
  clock?: SystemsClock | null, force?: readonly string[], onMenu?: (words: Set<string>, which: Reboot | null) => Promise<unknown> }):
  Promise<{ lines: string[], words?: string[], rebooted: Reboot | null, rebootMs?: number, ok?: boolean, why: string, awayMs: number } | null> {
  const pt = (k: string) => ({ x: c[k].x, y: c[k].y });
  const lines = await collect(eyes, 700, (f) => (reader.selected(f) !== null ? reader.errorLines(f) : []));
  for (const w of force) lines.add(w);
  if (lines.size === 0) return null;
  const t0 = performance.now();
  // The tab is a toggle: press it only with the monitor up (a scare has
  // usually dropped it already, g665 `drop it`).
  const shown = eyes.now();
  if (shown && reader.selected(shown) !== null) {
    await act.press('monitor', pt('monitor'));
    await eyes.until((fr) => reader.selected(fr) === null, t0, 1500);
  }
  await act.hold('panLeft', pt('panLeft'), c.panLeft.holdMs);
  await sleep(120);
  let at = performance.now();
  await act.press('maintenance', pt('maintenance'));
  const menu = await eyes.until((fr) => reader.menuOpen(fr), at, 1500);
  if (!menu) {
    await raiseMonitor({ act, c, eyes, reader });
    return { lines: [...lines], rebooted: null, why: 'no menu', awayMs: performance.now() - t0 };
  }
  const words = await collect(eyes, 900, (f) => (reader.menuOpen(f) ? reader.menuErrors(f) : []));
  for (const w of force) words.add(w);
  // Audio is serviced too: the lure is the only way back off attack stage 1
  // (g320), and n2b left it broken all night. chooseReboot weighs a single
  // reboot against reboot all.
  const which: Reboot | null = clock ? chooseReboot(words, clock)
    : words.size >= 2 ? 'ALL' : words.has('VENT') ? 'VENT' : words.has('VIDEO') ? 'VIDEO' : words.has('AUDIO') ? 'AUDIO' : null;
  await onMenu(words, which);
  const rebootAt = performance.now();
  if (which) {
    await act.press(REBOOT_ROW[which], pt(REBOOT_ROW[which]));
    await sleep(900);
  }
  let closed = null as Seen | null;
  for (let i = 0; i < 24 && !closed; i += 1) {
    at = performance.now();
    await act.press('exitMaint', pt('exitMaint'));
    closed = await eyes.until((fr) => !reader.menuOpen(fr), at, 900);
  }
  const rebootMs = performance.now() - rebootAt;
  await sleep(500);
  const up = await raiseMonitor({ act, c, eyes, reader });
  return { lines: [...lines], words: [...words], rebooted: which, rebootMs,
    ok: !!closed && !!up, why: closed ? (up ? 'done' : 'monitor stayed down') : 'menu never closed',
    awayMs: performance.now() - t0 };
}

/**
 * The calibration night. The monitor stays up (the office drains ventilation
 * once a second on Nights 2+ and raises aggression, g908/g909) and every
 * camera is shown again and again for 900 ms -- no SNAP during the sweeps,
 * because a SNAP stalls the region stream (cal1: 6-8 frames/s against 12) --
 * so that each camera's median over the night is its empty room across its
 * light states. Every fourth sweep shows the vents; the first vent pass
 * seals vent 14 by a double tap. Ventilation is rebooted on its red line.
 */
async function calibrate({ act, c, record, eyes, reader, snapTo, stopAfterMs, epochHostMs, det = null, survey = false }: Hands & {
  record: RunRecord, snapTo: (name: string) => Promise<void>, stopAfterMs: number, epochHostMs: number, det?: DetectorsV1 | null,
  survey?: boolean }) {
  const pt = (k: string) => ({ x: c[k].x, y: c[k].y });
  const nightMs = () => performance.now() - epochHostMs;
  const mark = (phase: string, f: object = {}) => record.event('phase', { phase, atNightMs: Math.round(nightMs()), ...f });
  const over = () => {
    const f = eyes.now();
    return f && reader.title(f) >= 0.2;
  };
  const monitorUp = async () => {
    const r = await raiseMonitor({ act, c, eyes, reader });
    await mark('monitor-up', { selected: r ? reader.selected(r.frame) : null, tries: r?.tries ?? null, ms: r ? Math.round(r.ms) : null });
    return r?.frame ?? null;
  };
  const show = async (n: number, dwellMs: number) => {
    const k = `cam${String(n).padStart(2, '0')}`;
    const at = performance.now();
    await act.press(k, pt(k));
    const f = await eyes.until((fr) => reader.selected(fr) === n, at, 1500);
    await mark('shown', { cam: n, ms: f ? Math.round(f.imageHostMs - at) : null });
    if (!f || !det?.templates[n]) { await sleep(dwellMs); return !!f; }
    // With templates from an earlier night: score the visit and SNAP it when
    // it is unlike the empty room, so a person can say what was there.
    const t0 = performance.now();
    const feeds: Uint32Array[] = []; let seq = -1;
    while (performance.now() < t0 + dwellMs) {
      const g = eyes.now();
      if (g && g.seq !== seq && g.imageHostMs >= at + 400 && reader.selected(g) === n) { seq = g.seq; feeds.push(g.regions.feed.pixels); }
      await sleep(10);
    }
    if (feeds.length >= 3) {
      const o = occupancy(medianLuma(feeds.slice(-5)), Float32Array.from(det.templates[n]));
      await mark('score', { cam: n, over: +o.over.toFixed(3), mean: +o.mean.toFixed(1), frames: feeds.length });
      if (o.over > 0.15 || survey) await snapTo(`cam${String(n).padStart(2, '0')}-o${Math.round(o.over * 1000)}-m${Math.round(o.mean)}`);
    } else if (survey) await snapTo(`cam${String(n).padStart(2, '0')}-unscored`);
    return true;
  };
  const maybeService = async () => {
    const r = await serviceSystems({ act, c, eyes, reader, onMenu: () => snapTo('maintenance') });
    if (r) await mark('systems', { ...r, rebootMs: Math.round(r.rebootMs ?? 0), awayMs: Math.round(r.awayMs ?? 0) });
  };

  if (!await monitorUp()) await monitorUp();
  let sweep = 0;
  let sealedOnce = false;
  while (nightMs() < stopAfterMs && !over() && !STOP.requested) {
    sweep += 1;
    for (const n of [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) {
      if (over()) break;
      if (!await show(n, 900)) {
        // Lost only if no label reads for a whole second (a switch burst or
        // an error flash can hide one for a frame or two).
        const any = await eyes.until((fr) => reader.selected(fr) !== null || reader.menuOpen(fr), performance.now() - 100, 1000);
        if (!any) { await mark('monitor-lost'); await monitorUp(); }
      }
      await maybeService();
    }
    if (sweep % 4 === 1 && !over()) {
      await act.press('mapToggle', pt('mapToggle'));
      const at = performance.now();
      const f = await eyes.until((fr) => (reader.selected(fr) ?? 0) >= 11, at, 1500);
      await mark('vent-map', { selected: f ? reader.selected(f) : null });
      for (const n of [11, 12, 13, 14, 15]) {
        if (over()) break;
        await show(n, 900);
      }
      if (!sealedOnce) {
        sealedOnce = true;
        const s0 = performance.now();
        await act.double('cam14', pt('cam14'), SEAL_GAP_MS);
        const g = await eyes.until((fr) => reader.sealed(fr) === 14, s0, 2600);
        await mark('seal', { vent: 14, ms: g ? Math.round(g.imageHostMs - s0) : null });
        await snapTo('sealed-14');
      }
      await act.press('mapToggle', pt('mapToggle'));
      await sleep(300);
    }
  }
  await mark('calibration-ended', { over: over(), sweeps: sweep });
}

// --- the loop ----------------------------------------------------------------------
// Springtrap's edges (graphs/fnaf3.json, g227-g251, g604-g613): from each camera,
// where one move can take him. A vent resolves back to its camera when it is
// the sealed one and onward otherwise; 'A1'/'A3' are the attack chain's
// stages (A1 advances only on the blackout, g486; A3 two moves from the kill).
export const NEXT: Edges = {
  10: [9, 14], 9: [10, 8, 11], 8: [9, 7, 5], 7: [8, 6, 12], 6: [7, 5],
  5: [6, 2, 4, 13], 2: [5, 4, 15], 4: [2, 3], 3: [4], 1: [],
  11: [9], 12: [7], 13: [5], 14: [10], 15: [2],
};
// The vent each camera leads into (every entrance is on branch 4).
export const VENT_OF: Readonly<Record<number, number>> = { 10: 14, 9: 11, 7: 12, 5: 13, 2: 15 };
// 14 and 15 kill on his next move out of them; 11 and 12 put him two moves out.
const DANGER: MovesToKill = { 14: 0, 15: 0, 11: 1, 12: 1, 13: 2 };

/** The cameras to look at, nearest ring first, from where he was last seen. */
export function searchOrder(from: number | null) {
  if (!from) return [10, 9, 8, 7, 6, 5, 2, 4, 3];
  const seen = new Set([from]);
  const order = [from];
  let ring = [from];
  while (ring.length) {
    const next = [];
    for (const n of ring) for (const m of NEXT[n] ?? []) {
      if (seen.has(m)) continue;
      seen.add(m); next.push(m);
    }
    next.sort((a, b) => (DANGER[a] ?? 9) - (DANGER[b] ?? 9));
    order.push(...next);
    ring = next;
  }
  for (const n of [10, 9, 8, 7, 6, 5, 2, 4, 3]) if (!seen.has(n)) order.push(n);
  return order;
}

const F3_LINE = /^LESSON [0-9a-f]{32} f3 (origin \d{1,19}|night [1-6] (NORMAL|AGGRESSIVE)|step [A-Z_]+|look (\d{1,2}|OFF)|seen (\d{1,2}|NONE)|sealed (1[1-5]|NONE)|lure \d{1,2}|sight \d{1,3}|lures \d{1,2}|sys (AUDIO|CAMERA|VENT) (OK|ERROR|REBOOT)|clear)$/;
export function teachFeed(port: AdbCompanionPort, record: RunRecord) {
  const channel = port.openLesson({ timeoutMs: 800, lessonLine: F3_LINE });
  // openLesson found the endpoint.
  const token = (port.endpoint as NonNullable<AdbCompanionPort['endpoint']>).token;
  let chain: Promise<unknown> = Promise.resolve();
  const last: Record<string, string> = {};
  const say = (words: string, key: string | null = null) => {
    if (key !== null) { if (last[key] === words) return; last[key] = words; }
    chain = chain.then(() => channel.send(`LESSON ${token} f3 ${words}`))
      .catch((e: Error) => record.event('teach-error', { words, message: e.message }).catch(() => {}));
  };
  // A runner that dies before its own clear leaves its lesson on the panel,
  // and the next origin would reattach it (n2e's last sighting showed on the
  // title): each night starts from a fresh one.
  say('clear');
  return {
    origin: (ns: bigint | number | null) => say(`origin ${ns}`),
    night: (n: number, aggressive: boolean) => say(`night ${n} ${aggressive ? 'AGGRESSIVE' : 'NORMAL'}`),
    step: (s: string) => say(`step ${s}`, 'step'),
    look: (n: number | null) => say(`look ${n ?? 'OFF'}`, 'look'),
    seen: (n: number | null) => say(`seen ${n ?? 'NONE'}`),
    sealed: (v: number | null) => say(`sealed ${v ?? 'NONE'}`, 'sealed'),
    lure: (n: number) => say(`lure ${n}`),
    sys: (which: string, state: string) => say(`sys ${which} ${state}`, `sys${which}`),
    sight: (sec: number) => say(`sight ${Math.max(0, Math.min(999, Math.round(sec)))}`, 'sight'),
    lures: (n: number) => say(`lures ${Math.max(0, Math.min(99, n))}`, 'lures'),
    clear: async () => { say('clear'); await chain; channel.close(); },
  };
}
type Teach = ReturnType<typeof teachFeed>;
const QUIET: Teach = { origin() {}, night() {}, step() {}, look() {}, seen() {}, sealed() {}, lure() {}, sys() {}, sight() {}, lures() {}, async clear() {} };

/**
 * The tracking loop. The monitor stays up. While he is seen, the loop stays
 * on his camera; when he arrives beside a vent it seals that vent (the seal
 * selects the vent's own camera, so the vent is watched while it charges);
 * when he leaves, it seals the vent beside the camera he left if that is not
 * the sealed one, and looks for him ring by ring along his edges. The
 * ventilation error line is answered with a reboot whose timer runs on
 * after the panel is left.
 */
async function loopNight({ act, c, record, eyes, reader, det, epochHostMs, stopAfterMs, night, teach = QUIET }: Hands & {
  record: RunRecord, det: Detectors, epochHostMs: number, stopAfterMs: number, night: number, teach?: Teach }) {
  const pt = (k: string) => ({ x: c[k].x, y: c[k].y });
  const camKey = (n: number) => `cam${String(n).padStart(2, '0')}`;
  const nightMs = () => performance.now() - epochHostMs;
  const log = (m: string, f: object = {}) => record.event('policy', { atNightMs: Math.round(nightMs()), m, ...f });
  const stats: Stats = { looks: 0, sightings: 0, seals: 0, sealFails: 0, reboots: 0, lost: 0, recoveries: 0, lures: 0 };
  const ai = night <= 1 ? 0 : night <= 5 ? night : 7;
  const clock = new SystemsClock(ai);
  let clockAt = performance.now();
  let flashSeq = -1;
  let scareAt = null as number | null;
  const clockTimer = setInterval(() => {
    const now = performance.now();
    const f = eyes.now();
    if (f && reader.selected(f) !== null) clock.addMonitorMs(now - clockAt);
    // Every phantom's scare ends in the white flash (g686/g687/g744/g745),
    // which breaks ventilation and sets the blackout past the chain's
    // threshold (g704): the screen darkens and he advances every frame
    // until ventilation is rebooted (n2d 209.5 s, dead at 231 s).
    if (f && f.seq !== flashSeq) {
      flashSeq = f.seq;
      let sum = 0; const px = f.regions.feed.pixels;
      for (let i = 0; i < px.length; i += 7) sum += (px[i] >> 8) & 255;
      if (sum / Math.ceil(px.length / 7) > 200) scareAt = now;
    }
    clockAt = now;
    teach.sight(clock.cameraLeftS());
    teach.lures(clock.luresLeft());
  }, 200);
  let look = null as number | null;                         // the camera on screen, as its green label says
  let seen = null as { cam: number, atMs: number } | null;  // where he was last seen
  let sealed = null as number | null;                       // the vent whose bar last read red
  // main refuses a v1 file with neither a cut per camera nor one cut.
  const cut = (n: number) => (det.cuts?.[n] ?? det.occupied) as number;

  const current = () => { const f = eyes.now(); return f ? reader.selected(f) : null; };
  const monitorUp = async () => {
    const r = await raiseMonitor({ act, c, eyes, reader });
    look = r ? reader.selected(r.frame) : null;
    if (look !== null) teach.look(look);
    return !!r;
  };
  /** Put camera n on screen: toggle the map if n is on the other one. */
  const view = async (n: number) => {
    const onVents = (m: number | null) => m !== null && m >= 11;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      look = current();
      if (look === n) return true;
      if (look === null) { if (!await monitorUp()) continue; look = current(); }
      if (onVents(look) !== (n >= 11)) {
        const at = performance.now();
        await act.press('mapToggle', pt('mapToggle'));
        const f = await eyes.until((fr) => { const s = reader.selected(fr); return s !== null && onVents(s) === (n >= 11); }, at, 1200);
        look = f ? reader.selected(f) : current();
        if (look === n) return true;
      }
      const at = performance.now();
      await act.press(camKey(n), pt(camKey(n)));
      const f = await eyes.until((fr) => reader.selected(fr) === n, at, 1000);
      if (f) { look = n; teach.look(n); return true; }
    }
    look = current();
    return false;
  };
  /** The vent map on screen (any vent label green). */
  const ventMap = async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      look = current();
      if (look !== null && look >= 11) return true;
      if (look === null) { if (!await monitorUp()) continue; look = current(); if (look !== null && look >= 11) return true; }
      const at = performance.now();
      await act.press('mapToggle', pt('mapToggle'));
      const f = await eyes.until((fr) => (reader.selected(fr) ?? 0) >= 11, at, 1200);
      if (f) { look = reader.selected(f); return true; }
    }
    return false;
  };
  const pairs = det.schema === 'fnaf3-detectors-v2' ? loadPairs(det) : null;
  /**
   * What camera n shows, over the settled frames of one look: v2 scores each
   * frame against the game's own pictures of that camera (empty, alternate,
   * Springtrap) and averages; v1 compares a temporal median with the camera's
   * empty template.
   */
  // pairs is null exactly for a v1 file.
  const templates = () => (det as DetectorsV1).templates;
  const score = async (n: number, frames = det.window ?? 5): Promise<Score | null> => {
    if (pairs ? !pairs[n] : !templates()[n]) return null;
    const since = performance.now() + (det.settleMs ?? 400);
    const feeds: Uint32Array[] = [];
    let seq = -1;
    const until = since + 1500;
    while (performance.now() < until && feeds.length < frames) {
      const f = eyes.now();
      if (f && f.seq !== seq && f.imageHostMs >= since && reader.selected(f) === n) {
        seq = f.seq; feeds.push(f.regions.feed.pixels);
      }
      await sleep(10);
    }
    if (feeds.length < Math.min(3, frames)) return null;
    stats.looks += 1;
    if (!pairs) return { ...occupancy(medianLuma(feeds), templates()[n]), v: 1 };
    let C = 0; let B = 0; let nB = 0; let P = 0; let nP = 0;
    for (const feed of feeds) {
      const r = stateScore(pairs[n], boxLuma(feed));
      C += r.C ?? 0;
      if (r.B !== null) { B += r.B; nB += 1; }
      if (r.P !== null) { P += r.P; nP += 1; }
    }
    return { C: C / feeds.length, B: nB ? B / nB : null, P: nP ? P / nP : null, v: 2 };
  };
  const occupied = (n: number, s: Score) => {
    if (s.v === 1) return s.over > cut(n);
    const cam = (det as DetectorsV2).cams[n];   // a v2 score comes only from a v2 file
    const him = s.C > cam.cut || (cam.cutB !== null && s.B !== null && s.B > cam.cutB);
    // A phantom's picture that fits better than his is a phantom, not him.
    if (him && s.P !== null && s.P > 2 && s.P > Math.max(s.C, s.B ?? -Infinity)) { s.phantom = true; return false; }
    return him;
  };
  const here = async (n: number) => {
    if (!await view(n)) return null;
    const s = await score(n);
    if (!s) return null;
    const occ = occupied(n, s);
    if (s.phantom) {
      stats.phantoms = (stats.phantoms ?? 0) + 1;
      teach.step('PHANTOM');
      await log(`a phantom on ${n}, not him: looking away`, { C: s.C, B: s.B, P: s.P });
    }
    if (occ) {
      stats.sightings += 1;
      seen = { cam: n, atMs: nightMs() };
      teach.seen(n);
    }
    return { occ, ...s };
  };
  /** Seal vent v: double-tap its label on the vent map and keep the map open until the bar is red. */
  const seal = async (v: number) => {
    teach.step('SEAL');
    // The vent map, without a single press on v first: a lone press just
    // before the double tap could pair with its first tap.
    if (!await ventMap()) { stats.sealFails += 1; return false; }
    // A double tap right after the map toggles lost its first tap (n2a 16.9 s).
    await sleep(250);
    const at = performance.now();
    await act.double(camKey(v), pt(camKey(v)), SEAL_GAP_MS);
    look = v; teach.look(v);
    // The mobile seal charges 100 + Random(100) frames (g635; PC's button is
    // 50 + Random(50), g572), up to 3.3 s: waiting 2.6 s gave up on charges
    // still running, and the retry's double tap restarted them (n2b 49-58 s).
    const f = await eyes.until((fr) => reader.sealed(fr) === v, at, 4000);
    if (!f) { stats.sealFails += 1; await log(`seal ${v}: bar never read red`); return false; }
    sealed = v; stats.seals += 1; teach.sealed(v);
    await log(`sealed ${v}`, { ms: Math.round(f.imageHostMs - at) });
    return true;
  };
  const TEACH_SYS: Readonly<Record<string, string>> = { VENT: 'VENT', VIDEO: 'CAMERA', AUDIO: 'AUDIO' };
  /** True when the loop left the monitor to reboot something (its picture of him is stale). */
  const service = async () => {
    const f = eyes.now();
    let force: string[] = [];
    if (scareAt !== null) {
      // Let the scare's frozen state pass (g890-g894 clear it) before the menu.
      await log('a white flash: a phantom scare broke ventilation; rebooting it');
      teach.step('PHANTOM');
      scareAt = null;
      await sleep(1200);
      force = ['VENT'];
    } else {
      if (!f || reader.selected(f) === null) return false;
      if (reader.errorLines(f).size === 0) return false;
    }
    const r = await serviceSystems({ act, c, eyes, reader, clock, force, onMenu: async (words, which) => {
      for (const w of words) teach.sys(TEACH_SYS[w], 'ERROR');
      teach.look(null);
      // No reboot indexes as the key 'null', which names no step.
      teach.step(({ ALL: 'REBOOT_ALL', VENT: 'REBOOT_VENT', VIDEO: 'REBOOT_CAMERA', AUDIO: 'REBOOT_AUDIO' } as Readonly<Record<string, string>>)[String(which)] ?? 'SWEEP');
      for (const w of which === 'ALL' ? ['AUDIO', 'VIDEO', 'VENT'] : which ? [which] : []) teach.sys(TEACH_SYS[w], 'REBOOT');
    } });
    if (!r || !r.rebooted) return false;
    if (r.ok) clock.rebooted(r.rebooted);
    look = current();
    if (look !== null) teach.look(look);
    if (r.rebooted) stats.reboots += 1;
    await log(`systems: lines ${r.lines.join('+')}, menu ${(r.words ?? []).join('+') || '-'}, rebooted ${r.rebooted ?? 'nothing'}: ${r.why}`,
      { rebootMs: Math.round(r.rebootMs ?? 0), awayMs: Math.round(r.awayMs ?? 0) });
    if (r.ok) for (const w of r.rebooted === 'ALL' ? ['AUDIO', 'VIDEO', 'VENT'] : [r.rebooted]) teach.sys(TEACH_SYS[w], 'OK');
    return true;
  };
  // The title after a death carries static that dims the logo to 0.06-0.15
  // (n2c 158-175 s) against the office's 0.00: a second of it is the title.
  let titleSince = null as number | null;
  const over = () => {
    const f = eyes.now();
    if (!f) return false;
    const t = reader.title(f);
    if (t >= 0.2) return true;
    if (t >= 0.05 && reader.selected(f) === null && !reader.menuOpen(f)) {
      titleSince ??= performance.now();
      return performance.now() - titleSince > 1000;
    }
    titleSince = null;
    return false;
  };

  /**
   * Play audio on camera n: it pulls him onto n from any camera the lure
   * table pairs with it (g319-g341; cam 02 also from attack stage 1, cam 01
   * from stage 4) after Random(100) frames, and resets his move counter
   * (g343-g352). It needs the camera map, Play Audio ready (not dashes) and
   * no audio error, and costs AI audio points (g301).
   */
  const lureAt = async (n: number, why: string) => {
    if (!await view(n)) return false;
    await sleep(150);
    const f = eyes.now();
    if (!f || reader.errorLines(f).has('AUDIO') || !reader.playReady(f)) {
      await log(`no lure at ${n} (${why}): audio ${f && reader.errorLines(f).has('AUDIO') ? 'broken' : 'not ready'}`);
      return false;
    }
    teach.step('LURE');
    await act.press('playAudio', pt('playAudio'));
    clock.lured(); stats.lures += 1; teach.lure(n);
    await log(`lure at ${n}: ${why}`, { luresLeft: clock.luresLeft() });
    return true;
  };
  // Cameras whose lost occupant may be on attack stage 1, where only a lure on
  // cam 02 reaches him (g320): cam 02 itself (pic random 0), cam 03 (g251),
  // vent 13 or 15 unsealed.
  const NEAR_OFFICE = new Set([1, 2, 3, 4, 13, 15]);
  // Where to lure him from each office-side camera: one step further out.
  const HERD: Readonly<Record<number, number>> = { 2: 5, 3: 2, 4: 2, 5: 6 };

  if (!await monitorUp()) await monitorUp();
  let lostSinceMs = null as number | null;
  while (nightMs() < stopAfterMs && !over() && !STOP.requested) {
    await service();
    if (current() === null) {
      // The monitor is down and we did not put it down: a scare, or the night is over.
      await sleep(400);
      if (over()) break;
      if (scareAt !== null) { await service(); continue; }
      if (current() === null) {
        if (nightMs() > (night <= 1 ? 235000 : 355000)) { await log('monitor gone at the end of the night'); break; }
        stats.recoveries += 1;
        await log('monitor down unasked: raising it');
        if (!await monitorUp()) { await sleep(500); continue; }
      }
    }
    if (seen && lostSinceMs === null) {
      teach.step('WATCH');
      const r = await here(seen.cam);
      if (r && r.occ) {
        // The office side feeds attack stage 1 (cam 02's and cam 03's exits)
        // and vents 13 and 15: a lure one camera further out pulls him off it
        // and resets his move counter (the lure table, g319-g341).
        const target = HERD[seen.cam];
        if (target && clock.luresLeft() >= 1 && await lureAt(target, `herding him off cam ${seen.cam}`)) {
          await sleep(1800);
          seen = { cam: target, atMs: seen.atMs };
          continue;
        }
        // Cam 02 and cam 05 show him plainly with `pic random` 0 and as their
        // alternate with 1, and the same coin picks his action-4 exit
        // (g242/g243, g246/g247): plainly there, his exit is attack stage 1
        // or cam 04, not the vent, and a seal buys nothing.
        const plain = r.v === 2 && (seen.cam === 2 || seen.cam === 5) && r.C > (det as DetectorsV2).cams[seen.cam].cut;
        const v = VENT_OF[seen.cam];
        if (v && sealed !== v && !plain) {
          await log(`he is at ${seen.cam} beside vent ${v}: sealing it`, { C: r.C ?? r.over, B: r.B ?? null });
          await seal(v);
        }
        continue;
      }
      if (!r) continue;
      // One weak look is not a departure (n2d: cam 9 read left, found, left,
      // found within 4 s): a second look must miss too.
      const again = await here(seen.cam);
      if (again && again.occ) continue;
      await log(`he left ${seen.cam}`, { C: r.C ?? r.over, B: r.B ?? null });
      lostSinceMs = nightMs();
      const v = VENT_OF[seen.cam];
      if (v && sealed !== v && seen.cam !== 2) await seal(v);
      if (NEAR_OFFICE.has(seen.cam) && await lureAt(2, `lost at ${seen.cam}: attack stage 1 is one step away`)) {
        await sleep(1800);
        seen = { cam: 2, atMs: seen.atMs };
      }
    }
    // Look for him, nearest ring first; a sighting ends the search.
    teach.step('SWEEP');
    let found = false;
    for (const n of searchOrder(seen?.cam ?? null)) {
      if (over()) break;
      if (await service()) break;
      if (n >= 11 && sealed === n) continue;
      const r = await here(n);
      if (r && r.occ) {
        await log(`found at ${n}`, { C: r.C ?? r.over, B: r.B ?? null, lostMs: lostSinceMs === null ? null : Math.round(nightMs() - lostSinceMs) });
        if (n >= 11 && sealed !== n) await seal(n);
        found = true; lostSinceMs = null;
        break;
      }
    }
    if (!found) {
      stats.lost += 1;
      await log('not found in a full search');
      if (seen && NEAR_OFFICE.has(seen.cam)) await lureAt(2, 'not found and last seen near the office');
      if (seen && nightMs() - seen.atMs > 15000) seen = null;
    }
  }
  clearInterval(clockTimer);
  await log('loop ended', stats);
  return stats;
}

async function main(argv: string[]) {
  const options = parseArgs(argv);
  const controlsModel = JSON.parse(await readFile(CONTROLS_PATH, 'utf8'));
  const regionModel = loadRegionSet(REGIONS_PATH, 'night');
  const bindings = Object.fromEntries(await Promise.all([['controls', CONTROLS_PATH], ['regions', REGIONS_PATH]]
    .map(async ([k, p]) => [k, { path: p.slice(ROOT.length + 1), sha256: sha256(await readFile(p)) }] as const)));
  if (options.dryRun) { console.log(JSON.stringify({ status: 'DRY_RUN', modes: MODES, bindings }, null, 2)); return; }
  if (process.env.FNAF3_LEASE_HELD !== '1') fail('run through fnaf3-run.sh so the serial lease is held');
  let serial: string;
  try { ({ serial } = resolveSerial()); } catch (error) { fail((error as Error).message); }
  const c = controlsOf(controlsModel);
  const reader = new Reader(c);

  const id = `fnaf3-${options.mode}-${options.label ?? 'run'}-${stamp()}`;
  const outdir = join(ROOT, 'artifacts', 'runs', id);
  const captureDir = join(homedir(), 'fnaf-apks', 'fnaf3-device-runs', id);
  await Promise.all([mkdir(outdir, { recursive: true }), mkdir(captureDir, { recursive: true })]);
  const record = new RunRecord({ schema: 'fnaf3-run-v1', pkg: PACKAGE, id, outdir, captureDir, options, bindings,
    claimLevel: 'DEVICE_MEASURED helper native frames and regions; no detector or route is promoted by this record',
    sensor: 'cue-helper-mediaprojection-2400x1080' });
  await record.save('PREFLIGHT');

  const port = new AdbCompanionPort({ serial });
  // Name the target and show the lease on the phone (companion-status-v1). A
  // helper older than 0.2.0 answers unknown-verb; nothing this run reads changes.
  await record.event('companion-announce', await port.announce({ target: PACKAGE, lease: id.slice(0, 48) }));
  const snapDir = join(tmpdir(), `fnaf3-snap-${process.pid}`);
  await mkdir(snapDir, { recursive: true });
  let n = 0;
  const snapTo = async (name: string) => {
    n += 1;
    const target = join(snapDir, `f${n}.png`);
    const at = performance.now();
    await port.snap(`f3s${n}`, target);
    await record.capture(name, await readFile(target));
    await record.event('snap-ms', { name, ms: Math.round(performance.now() - at) });
  };
  let hidProcess = null as AdbHidProcess | null; let recorder = null as RegionRecorder | null;
  let channel = null as ReturnType<AdbCompanionPort['openRegions']> | null; let entered = false; let error = null as Error | null;
  let video = null as ReturnType<typeof startVideo> | null;
  try {
    await snapTo('title-before');
    const adbHid = new AdbHidProcess({ serial });
    hidProcess = adbHid;
    const hid = new HidWireTransport({ write: (l) => adbHid.write(l), ready: () => adbHid.ready(), contactMs: CONTACT_MS });
    await hid.start();
    const act = new Actor(hid, record, CONTACT_MS);
    channel = port.openRegions({ timeoutMs: 1500 });
    await registerSet(channel, regionModel.set);
    recorder = new RegionRecorder(channel, join(captureDir, 'regions.ndjson.gz'));
    recorder.start();
    const eyes = new Eyes(recorder, reader);
    await sleep(500);
    const t = eyes.now();
    if (!t || reader.title(t) < 0.2) fail(`not on the title (title gate ${t ? reader.title(t).toFixed(2) : 'no frame'})`);

    if (options.video) video = startVideo(serial, id);
    entered = true;
    const pressAt = performance.now();
    await act.press('loadGame', { x: c.loadGame.x, y: c.loadGame.y });
    record.document.loadGameHostMs = pressAt;
    // The office: the logo gone and the frame settled (the "..." loader sits
    // over the office for ~3 s, and a pan held during it moved a third, f3-ex2).
    const office = await eyes.until((f) => reader.title(f) < 0.05, pressAt, 15000);
    if (!office) fail('the title did not leave within 15 s of LOAD GAME');
    await sleep(3500);
    const epochHostMs = office.imageHostMs;
    const nightDoc: { officeAfterLoadMs: number, epochHostMs: number, endedAtNightMs?: number } =
      { officeAfterLoadMs: office.imageHostMs - pressAt, epochHostMs };
    record.document.night = nightDoc;
    await record.save('NIGHT_RUNNING');
    if (options.mode === 'calibrate') {
      const det: DetectorsV1 | null = options.detectors ? JSON.parse(await readFile(options.detectors, 'utf8')) : null;
      // A file was read only when --detectors named one.
      if (det) record.document.detectors = { path: options.detectors, sha256: sha256(await readFile(options.detectors as string)), source: det.source };
      await calibrate({ act, c, record, eyes, reader, snapTo, stopAfterMs: options.stopAfterMs, epochHostMs, det, survey: options.survey });
    } else {
      // The loop requires --detectors and --night (parseArgs).
      const detectors = options.detectors as string;
      const det: Detectors = JSON.parse(await readFile(detectors, 'utf8'));
      if (!['fnaf3-detectors-v1', 'fnaf3-detectors-v2'].includes(det.schema)) fail('--detectors is not fnaf3-detectors-v1 or v2');
      if (det.schema === 'fnaf3-detectors-v2' ? !Object.values(det.cams).every((v) => Number.isFinite(v.cut))
        : !Number.isFinite(det.occupied) && !det.cuts) fail('--detectors has no occupancy cut chosen');
      record.document.detectors = { path: options.detectors, sha256: sha256(await readFile(detectors)), source: det.source };
      let teach = QUIET;
      if (options.teach) {
        try {
          teach = teachFeed(port, record);
          // The office's first frame on the helper's own image clock.
          teach.origin(office.imageNs);
          teach.night(options.night as number, false);
          teach.step('SWEEP');
        } catch (e) { await record.event('teach-error', { message: (e as Error).message }); teach = QUIET; }
      }
      record.document.teach = options.teach;
      record.document.loop = await loopNight({ act, c, record, eyes, reader, det, epochHostMs,
        stopAfterMs: options.stopAfterMs, night: options.night as number, teach });
      await teach.clear();
    }
    nightDoc.endedAtNightMs = performance.now() - epochHostMs;
    for (let i = 0; i < 3; i += 1) { await snapTo(`after-night-${i}`); await sleep(2500); }
  } catch (e) {
    error = e as Error;
  } finally {
    try { await hidProcess?.close(); } catch { /* the lease bounds cleanup */ }
    if (recorder) {
      await recorder.stop();
      record.document.regions = { frames: recorder.frames, errors: recorder.errors, path: join(captureDir, 'regions.ndjson.gz') };
    }
    try { await channel?.clear(); } catch { /* the helper drops regions with its session */ }
    channel?.close();
    if (video) {
      try {
        const dir = join(homedir(), 'fnaf-apks', 'fnaf3-videos');
        await mkdir(dir, { recursive: true });
        record.document.video = await video.stop(dir);
      } catch (e) { record.document.video = `FAILED: ${(e as Error).message}`; }
    }
    if (entered) {
      // FNaF 3 banks a won night before its minigame (fnaf3-first-night-20260920),
      // so whatever follows the night can be abandoned. Leave the title up.
      try {
        execFileSync('adb', ['-s', serial, 'shell', 'am', 'force-stop', PACKAGE], { timeout: 10000 });
        execFileSync('adb', ['-s', serial, 'shell', 'am', 'start', '-W', '-n', ACTIVITY], { timeout: 30000 });
        await sleep(10000);
        await snapTo('title-after');
        record.document.recovery = 'RELAUNCHED_TO_TITLE (snap retained, read by a person)';
      } catch (e) { record.document.recovery = `FAILED: ${(e as Error).message}`; error ??= e as Error; }
    }
  }
  if (error) {
    record.document.error = error.message;
    await record.event('error', { message: error.message });
    await record.save('FAILED_OR_REFUSED');
  } else await record.save('COMPLETE');
  console.log(`fnaf3 run ${id}: ${record.document.status}; inputs=${record.document.inputsSent}; ` +
    `regionFrames=${recorder?.frames}; out=${outdir}; frames=${captureDir}`);
  if (record.document.status !== 'COMPLETE') process.exitCode = 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.on('SIGINT', () => { STOP.requested = true; });
  main(process.argv.slice(2)).catch((error: Error) => { console.error(error.message); process.exitCode = 2; });
}
