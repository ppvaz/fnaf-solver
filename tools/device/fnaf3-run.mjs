#!/usr/bin/env node
/**
 * One FNaF 3 night on the handset, observed through the Cue Helper's native
 * REGION frames (and SNAPs for a person to read). No screencap, no luma, no grid.
 *
 *   tools/device/fnaf3-run.sh --dry-run
 *   tools/device/fnaf3-run.sh --live --confirm-live --mode calibrate [--label NAME]
 *   tools/device/fnaf3-run.sh --live --confirm-live --mode loop --detectors FILE --night N [--teach] [--video]
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
import { AdbCueHelperPort, AdbHidProcess } from '../../apps/device/src/physical-ports.js';
import { HidWireTransport } from '../../packages/adapters/src/transports/hid.js';
import { loadRegionSet, registerSet } from './native-regions.mjs';
import { Actor, RegionRecorder, RunRecord, startVideo } from './night-kit.mjs';
import { Reader, boxLuma, loadPairs, medianLuma, occupancy, stateScore } from './fnaf3-detectors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const DEFAULT_SERIAL = 'ZF525F5BH5';
const PACKAGE = 'com.scottgames.fnaf3';
const ACTIVITY = `${PACKAGE}/.Main`;
const CONTROLS_PATH = join(HERE, 'models/controls-fnaf3-moto-g56-v204.json');
const REGIONS_PATH = join(HERE, 'models/regions-fnaf3-moto-g56-v204.json');
const CONTACT_MS = 160;
const MODES = Object.freeze(['calibrate', 'loop']);
const NIGHT_MS = 360000;                 // 6 x 60 s on Nights 2+ (fnaf3.js CLOCK, g644)
const STALE_FRAME_MS = 400;
// A vent seal is a double tap on its label (the game's instruction); FNaF 4's
// doors take the same gesture at 100 ms.
const SEAL_GAP_MS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[-:.]/g, '');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fail(message) { throw new Error(`fnaf3-run: ${message}`); }
// A SIGINT ends the night's loop at its next step, so the record, the region
// file and the game's teardown still run (a killed run leaves all three).
const STOP = { requested: false };

export function parseArgs(argv) {
  const o = { live: false, confirmLive: false, dryRun: false, mode: null, label: null, detectors: null,
    stopAfterMs: NIGHT_MS + 30000, teach: false, video: false, night: null, survey: false };
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
  if (o.dryRun) return o;
  if (!o.live || !o.confirmLive) fail('live actuation needs --live and --confirm-live');
  if (!MODES.includes(o.mode)) fail(`--mode is one of ${MODES.join(', ')}`);
  if (o.mode === 'loop' && !o.detectors) fail('loop needs --detectors (a fnaf3-detectors-v1 file)');
  if (o.mode === 'loop' && !(Number.isInteger(o.night) && o.night >= 1 && o.night <= 6))
    fail('loop needs --night 1..6 (the title\'s LOAD GAME number, 6 for Nightmare)');
  return o;
}

class Eyes {
  constructor(recorder, reader) { this.recorder = recorder; this.reader = reader; }
  now() {
    const r = this.recorder.latest;
    if (!r || performance.now() - r.imageHostMs > STALE_FRAME_MS) return null;
    return r;
  }
  /** The first frame rendered after `sinceHostMs` that satisfies `test`, or null by the bound. */
  async until(test, sinceHostMs, boundMs) {
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

function controlsOf(model) {
  return Object.fromEntries(Object.entries(model.controlMap).map(([k, v]) => [k, { ...v }]));
}

/**
 * The monitor up: pan right, press its tab, and wait for a CAM label to turn
 * green; up to three tries. A try fails when the office is not taking input
 * yet -- for ~12 s after LOAD GAME (cal2: the raises at 7.3 s and 11.1 s
 * missed, 15.4 s landed) and just after the maintenance menu closes (cal2: a
 * pan 300 ms after the close left the tab out of view; 4 s later it landed).
 */
async function raiseMonitor({ act, c, eyes, reader }, tries = 3) {
  const pt = (k) => ({ x: c[k].x, y: c[k].y });
  // Its tab is a toggle: pressed with the monitor up, it drops it (cal2's
  // recoveries flipped a raised monitor down after one unread label).
  const up = await eyes.until((fr) => reader.selected(fr) !== null, performance.now() - 400, 500);
  if (up) return { frame: up, tries: 0, ms: 0 };
  for (let i = 0; i < tries; i += 1) {
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
async function collect(eyes, ms, read) {
  const out = new Set();
  let seq = -1;
  const until = performance.now() + ms;
  while (performance.now() < until) {
    const f = eyes.now();
    if (f && f.seq !== seq) { seq = f.seq; for (const x of read(f)) out.add(x); }
    await sleep(15);
  }
  return out;
}

const REBOOT_ROW = { VENT: 'rebootVent', VIDEO: 'rebootCamera', AUDIO: 'rebootAudio', ALL: 'rebootAll' };

/**
 * Answer the monitor's red error lines with the reboot they need. The lines
 * name the system by their row; the maintenance menu's red "error" words say
 * it again and decide. Ventilation and video together take `reboot all`
 * (10-20 s, g426) rather than two trips; an audio error alone is left, since
 * this loop plays no lure. Exit does nothing while a reboot runs (cal1), so it
 * is pressed each second until the menu closes, and the office is given
 * 500 ms before the monitor goes back up (cal2).
 */
async function serviceSystems({ act, c, eyes, reader, onMenu = async () => {} }) {
  const pt = (k) => ({ x: c[k].x, y: c[k].y });
  const lines = await collect(eyes, 700, (f) => (reader.selected(f) !== null ? reader.errorLines(f) : []));
  if (lines.size === 0) return null;
  if (lines.size === 1 && lines.has('AUDIO')) return { lines: [...lines], rebooted: null, why: 'audio only: no lure to lose' };
  const t0 = performance.now();
  await act.press('monitor', pt('monitor'));
  await eyes.until((fr) => reader.selected(fr) === null, t0, 1500);
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
  await onMenu(words);
  const which = words.has('VENT') && words.has('VIDEO') ? 'ALL'
    : words.has('VENT') ? 'VENT' : words.has('VIDEO') ? 'VIDEO' : null;
  const rebootAt = performance.now();
  if (which) {
    await act.press(REBOOT_ROW[which], pt(REBOOT_ROW[which]));
    await sleep(900);
  }
  let closed = null;
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
async function calibrate({ act, c, record, eyes, reader, snapTo, stopAfterMs, epochHostMs, det = null, survey = false }) {
  const pt = (k) => ({ x: c[k].x, y: c[k].y });
  const nightMs = () => performance.now() - epochHostMs;
  const mark = (phase, f = {}) => record.event('phase', { phase, atNightMs: Math.round(nightMs()), ...f });
  const over = () => {
    const f = eyes.now();
    return f && reader.title(f) >= 0.2;
  };
  const monitorUp = async () => {
    const r = await raiseMonitor({ act, c, eyes, reader });
    await mark('monitor-up', { selected: r ? reader.selected(r.frame) : null, tries: r?.tries ?? null, ms: r ? Math.round(r.ms) : null });
    return r?.frame ?? null;
  };
  const show = async (n, dwellMs) => {
    const k = `cam${String(n).padStart(2, '0')}`;
    const at = performance.now();
    await act.press(k, pt(k));
    const f = await eyes.until((fr) => reader.selected(fr) === n, at, 1500);
    await mark('shown', { cam: n, ms: f ? Math.round(f.imageHostMs - at) : null });
    if (!f || !det?.templates[n]) { await sleep(dwellMs); return !!f; }
    // With templates from an earlier night: score the visit and SNAP it when
    // it is unlike the empty room, so a person can say what was there.
    const t0 = performance.now();
    const feeds = []; let seq = -1;
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
export const NEXT = {
  10: [9, 14], 9: [10, 8, 11], 8: [9, 7, 5], 7: [8, 6, 12], 6: [7, 5],
  5: [6, 2, 4, 13], 2: [5, 4, 15], 4: [2, 3], 3: [4], 1: [],
  11: [9], 12: [7], 13: [5], 14: [10], 15: [2],
};
// The vent each camera leads into (every entrance is on branch 4).
export const VENT_OF = { 10: 14, 9: 11, 7: 12, 5: 13, 2: 15 };
// 14 and 15 kill on his next move out of them; 11 and 12 put him two moves out.
const DANGER = { 14: 0, 15: 0, 11: 1, 12: 1, 13: 2 };

/** The cameras to look at, nearest ring first, from where he was last seen. */
export function searchOrder(from) {
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

const F3_LINE = /^LESSON [0-9a-f]{32} f3 (origin \d{1,19}|night [1-6] (NORMAL|AGGRESSIVE)|step [A-Z_]+|look (\d{1,2}|OFF)|seen (\d{1,2}|NONE)|sealed (1[1-5]|NONE)|lure \d{1,2}|sys (AUDIO|CAMERA|VENT) (OK|ERROR|REBOOT)|clear)$/;
function teachFeed(port, record) {
  const channel = port.openLesson({ timeoutMs: 800, lessonLine: F3_LINE });
  const token = port.endpoint.token;
  let chain = Promise.resolve();
  const last = {};
  const say = (words, key = null) => {
    if (key !== null) { if (last[key] === words) return; last[key] = words; }
    chain = chain.then(() => channel.send(`LESSON ${token} f3 ${words}`))
      .catch((e) => record.event('teach-error', { words, message: e.message }).catch(() => {}));
  };
  return {
    origin: (ns) => say(`origin ${ns}`),
    night: (n, aggressive) => say(`night ${n} ${aggressive ? 'AGGRESSIVE' : 'NORMAL'}`),
    step: (s) => say(`step ${s}`, 'step'),
    look: (n) => say(`look ${n ?? 'OFF'}`, 'look'),
    seen: (n) => say(`seen ${n ?? 'NONE'}`),
    sealed: (v) => say(`sealed ${v ?? 'NONE'}`, 'sealed'),
    lure: (n) => say(`lure ${n}`),
    sys: (which, state) => say(`sys ${which} ${state}`, `sys${which}`),
    clear: async () => { say('clear'); await chain; channel.close(); },
  };
}
const QUIET = { origin() {}, night() {}, step() {}, look() {}, seen() {}, sealed() {}, lure() {}, sys() {}, async clear() {} };

/**
 * The tracking loop. The monitor stays up. While he is seen, the loop stays
 * on his camera; when he arrives beside a vent it seals that vent (the seal
 * selects the vent's own camera, so the vent is watched while it charges);
 * when he leaves, it seals the vent beside the camera he left if that is not
 * the sealed one, and looks for him ring by ring along his edges. The
 * ventilation error line is answered with a reboot whose timer runs on
 * after the panel is left.
 */
async function loopNight({ act, c, record, eyes, reader, det, epochHostMs, stopAfterMs, night, teach = QUIET }) {
  const pt = (k) => ({ x: c[k].x, y: c[k].y });
  const camKey = (n) => `cam${String(n).padStart(2, '0')}`;
  const nightMs = () => performance.now() - epochHostMs;
  const log = (m, f = {}) => record.event('policy', { atNightMs: Math.round(nightMs()), m, ...f });
  const stats = { looks: 0, sightings: 0, seals: 0, sealFails: 0, reboots: 0, lost: 0, recoveries: 0 };
  let look = null;            // the camera on screen, as its green label says
  let seen = null;            // { cam, atMs } where he was last seen
  let sealed = null;          // the vent whose bar last read red
  const cut = (n) => det.cuts?.[n] ?? det.occupied;

  const current = () => { const f = eyes.now(); return f ? reader.selected(f) : null; };
  const monitorUp = async () => {
    const r = await raiseMonitor({ act, c, eyes, reader });
    look = r ? reader.selected(r.frame) : null;
    if (look !== null) teach.look(look);
    return !!r;
  };
  /** Put camera n on screen: toggle the map if n is on the other one. */
  const view = async (n) => {
    const onVents = (m) => m !== null && m >= 11;
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
  const score = async (n, frames = det.window ?? 5) => {
    if (pairs ? !pairs[n] : !det.templates[n]) return null;
    const since = performance.now() + (det.settleMs ?? 400);
    const feeds = [];
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
    if (!pairs) return { ...occupancy(medianLuma(feeds), det.templates[n]), v: 1 };
    let C = 0; let B = 0; let nB = 0;
    for (const feed of feeds) {
      const r = stateScore(pairs[n], boxLuma(feed));
      C += r.C ?? 0;
      if (r.B !== null) { B += r.B; nB += 1; }
    }
    return { C: C / feeds.length, B: nB ? B / nB : null, v: 2 };
  };
  const occupied = (n, s) => {
    if (s.v === 1) return s.over > cut(n);
    const cam = det.cams[n];
    return s.C > cam.cut || (cam.cutB !== null && s.B !== null && s.B > cam.cutB);
  };
  const here = async (n) => {
    if (!await view(n)) return null;
    const s = await score(n);
    if (!s) return null;
    const occ = occupied(n, s);
    if (occ) {
      stats.sightings += 1;
      seen = { cam: n, atMs: nightMs() };
      teach.seen(n);
    }
    return { occ, ...s };
  };
  /** Seal vent v: double-tap its label on the vent map and keep the map open until the bar is red. */
  const seal = async (v) => {
    teach.step('SEAL');
    // The vent map, without a single press on v first: a lone press just
    // before the double tap could pair with its first tap.
    if (!await ventMap()) { stats.sealFails += 1; return false; }
    const at = performance.now();
    await act.double(camKey(v), pt(camKey(v)), SEAL_GAP_MS);
    look = v; teach.look(v);
    // 50-100 frames of charge (g572), plus the press itself.
    const f = await eyes.until((fr) => reader.sealed(fr) === v, at, 2600);
    if (!f) { stats.sealFails += 1; await log(`seal ${v}: bar never read red`); return false; }
    sealed = v; stats.seals += 1; teach.sealed(v);
    await log(`sealed ${v}`, { ms: Math.round(f.imageHostMs - at) });
    return true;
  };
  const TEACH_SYS = { VENT: 'VENT', VIDEO: 'CAMERA', AUDIO: 'AUDIO' };
  /** True when the loop left the monitor to reboot something (its picture of him is stale). */
  const service = async () => {
    const f = eyes.now();
    if (!f || reader.selected(f) === null) return false;
    const lines = reader.errorLines(f);
    // An audio line alone costs nothing here: this loop plays no lure. Only a
    // video or ventilation line is worth the 700 ms read that decides a trip.
    if (lines.size === 0 || (lines.size === 1 && lines.has('AUDIO'))) return false;
    const r = await serviceSystems({ act, c, eyes, reader, onMenu: async (words) => {
      for (const w of words) teach.sys(TEACH_SYS[w], 'ERROR');
      teach.look(null);
      teach.step(words.has('VENT') && words.has('VIDEO') ? 'REBOOT_ALL' : words.has('VENT') ? 'REBOOT_VENT'
        : words.has('VIDEO') ? 'REBOOT_CAMERA' : 'REBOOT_AUDIO');
      for (const w of words) if (w !== 'AUDIO') teach.sys(TEACH_SYS[w], 'REBOOT');
    } });
    if (!r || !r.rebooted) return false;
    look = current();
    if (look !== null) teach.look(look);
    if (r.rebooted) stats.reboots += 1;
    await log(`systems: lines ${r.lines.join('+')}, menu ${(r.words ?? []).join('+') || '-'}, rebooted ${r.rebooted ?? 'nothing'}: ${r.why}`,
      { rebootMs: Math.round(r.rebootMs ?? 0), awayMs: Math.round(r.awayMs ?? 0) });
    if (r.ok && r.rebooted) for (const w of (r.words ?? [])) if (w !== 'AUDIO') teach.sys(TEACH_SYS[w], 'OK');
    return true;
  };
  const over = () => { const f = eyes.now(); return !!f && reader.title(f) >= 0.2; };

  if (!await monitorUp()) await monitorUp();
  let lostSinceMs = null;
  while (nightMs() < stopAfterMs && !over() && !STOP.requested) {
    await service();
    if (current() === null) {
      // The monitor is down and we did not put it down: a scare, or the night is over.
      await sleep(400);
      if (over()) break;
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
        const v = VENT_OF[seen.cam];
        if (v && sealed !== v) {
          await log(`he is at ${seen.cam} beside vent ${v}: sealing it`, { C: r.C ?? r.over, B: r.B ?? null });
          await seal(v);
        }
        continue;
      }
      if (!r) continue;
      await log(`he left ${seen.cam}`, { C: r.C ?? r.over, B: r.B ?? null });
      lostSinceMs = nightMs();
      const v = VENT_OF[seen.cam];
      if (v && sealed !== v) await seal(v);
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
      if (seen && nightMs() - seen.atMs > 15000) seen = null;
    }
  }
  await log('loop ended', stats);
  return stats;
}

async function main(argv) {
  const options = parseArgs(argv);
  const controlsModel = JSON.parse(await readFile(CONTROLS_PATH, 'utf8'));
  const regionModel = loadRegionSet(REGIONS_PATH, 'night');
  const bindings = Object.fromEntries(await Promise.all([['controls', CONTROLS_PATH], ['regions', REGIONS_PATH]]
    .map(async ([k, p]) => [k, { path: p.slice(ROOT.length + 1), sha256: sha256(await readFile(p)) }])));
  if (options.dryRun) { console.log(JSON.stringify({ status: 'DRY_RUN', modes: MODES, bindings }, null, 2)); return; }
  if (process.env.FNAF3_LEASE_HELD !== '1') fail('run through fnaf3-run.sh so the serial lease is held');
  const serial = process.env.FNAF_SERIAL ?? DEFAULT_SERIAL;
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

  const port = new AdbCueHelperPort({ serial });
  const snapDir = join(tmpdir(), `fnaf3-snap-${process.pid}`);
  await mkdir(snapDir, { recursive: true });
  let n = 0;
  const snapTo = async (name) => {
    n += 1;
    const target = join(snapDir, `f${n}.png`);
    const at = performance.now();
    await port.snap(`f3s${n}`, target);
    await record.capture(name, await readFile(target));
    await record.event('snap-ms', { name, ms: Math.round(performance.now() - at) });
  };
  let hidProcess = null; let recorder = null; let channel = null; let entered = false; let error = null; let video = null;
  try {
    await snapTo('title-before');
    hidProcess = new AdbHidProcess({ serial });
    const hid = new HidWireTransport({ write: (l) => hidProcess.write(l), ready: () => hidProcess.ready(), contactMs: CONTACT_MS });
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
    record.document.night = { officeAfterLoadMs: office.imageHostMs - pressAt, epochHostMs };
    await record.save('NIGHT_RUNNING');
    if (options.mode === 'calibrate') {
      const det = options.detectors ? JSON.parse(await readFile(options.detectors, 'utf8')) : null;
      if (det) record.document.detectors = { path: options.detectors, sha256: sha256(await readFile(options.detectors)), source: det.source };
      await calibrate({ act, c, record, eyes, reader, snapTo, stopAfterMs: options.stopAfterMs, epochHostMs, det, survey: options.survey });
    } else {
      const det = JSON.parse(await readFile(options.detectors, 'utf8'));
      if (!['fnaf3-detectors-v1', 'fnaf3-detectors-v2'].includes(det.schema)) fail('--detectors is not fnaf3-detectors-v1 or v2');
      if (det.schema === 'fnaf3-detectors-v2' ? !Object.values(det.cams).every((v) => Number.isFinite(v.cut))
        : !Number.isFinite(det.occupied) && !det.cuts) fail('--detectors has no occupancy cut chosen');
      record.document.detectors = { path: options.detectors, sha256: sha256(await readFile(options.detectors)), source: det.source };
      let teach = QUIET;
      if (options.teach) {
        try {
          teach = teachFeed(port, record);
          // The office's first frame on the helper's own image clock.
          teach.origin(office.imageNs);
          teach.night(options.night, false);
          teach.step('SWEEP');
        } catch (e) { await record.event('teach-error', { message: e.message }); teach = QUIET; }
      }
      record.document.teach = options.teach;
      record.document.loop = await loopNight({ act, c, record, eyes, reader, det, epochHostMs,
        stopAfterMs: options.stopAfterMs, night: options.night, teach });
      await teach.clear();
    }
    record.document.night.endedAtNightMs = performance.now() - epochHostMs;
    for (let i = 0; i < 3; i += 1) { await snapTo(`after-night-${i}`); await sleep(2500); }
  } catch (e) {
    error = e;
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
      } catch (e) { record.document.video = `FAILED: ${e.message}`; }
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
      } catch (e) { record.document.recovery = `FAILED: ${e.message}`; error ??= e; }
    }
  }
  if (error) {
    record.document.error = error.message;
    await record.event('error', { message: error.message });
    await record.save('FAILED_OR_REFUSED');
  } else await record.save('COMPLETE');
  console.log(`fnaf3 run ${id}: ${record.document.status}; inputs=${record.document.inputsSent}; ` +
    `regionFrames=${record.document.regions?.frames}; out=${outdir}; frames=${captureDir}`);
  if (record.document.status !== 'COMPLETE') process.exitCode = 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.on('SIGINT', () => { STOP.requested = true; });
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 2; });
}
