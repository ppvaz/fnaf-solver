#!/usr/bin/env node
/**
 * One FNaF 4 night on the handset, observed through the Cue Helper (native
 * REGION frames, SNAP for the title) and through the phone's own A2DP mix
 * (tools/cue/fnaf4-cues.py, live). No screencap, no luma, no grid.
 *
 *   tools/device/fnaf4-run.sh --dry-run
 *   tools/device/fnaf4-run.sh --live --confirm-live --mode calibrate [--label NAME]
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
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { AdbCueHelperPort, AdbHidProcess } from '../../apps/device/src/physical-ports.js';
import { HidWireTransport } from '../../packages/adapters/src/transports/hid.js';
import { loadRegionSet, registerSet } from './native-regions.mjs';
import { Actor, RegionRecorder, RunRecord, startVideo } from './night-kit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const DEFAULT_SERIAL = 'ZF525F5BH5';
const PACKAGE = 'com.scottgames.fnaf4';
const ACTIVITY = `${PACKAGE}/.Main`;
const CONTROLS_PATH = join(HERE, 'models/controls-fnaf4-moto-g56-v204.json');
const REGIONS_PATH = join(HERE, 'models/regions-fnaf4-moto-g56-v204.json');
const CUES = join(ROOT, 'tools/cue/fnaf4-cues.py');
const REFS = join(homedir(), 'fnaf-apks', 'fnaf4-refs');
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
const OCCUPIED = 2;
// The level's timers start this long after (negative: before) its first room
// frame: medians of 65, 88 and 74 breathing-phase reads on Nights 2-4 put it at
// -0.44..-0.55 s (the loop starts 1 s into the level, g4).
const LEVEL_ORIGIN_MS = -520;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[-:.]/g, '');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const wallOf = (hostMs) => performance.timeOrigin + hostMs;
function fail(message) { throw new Error(`fnaf4-run: ${message}`); }

export function parseArgs(argv) {
  const o = { live: false, confirmLive: false, dryRun: false, mode: null, label: null, detectors: null,
    stopAfterMs: NIGHT_MS + 20000, teach: false, video: false, night: null };
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
  if (o.dryRun) return o;
  if (!o.live || !o.confirmLive) fail('live actuation needs --live and --confirm-live');
  if (!MODES.includes(o.mode)) fail(`--mode is one of ${MODES.join(', ')}`);
  if (o.mode === 'loop' && !o.detectors) fail('loop needs --detectors (a fnaf4-detectors-v1 file)');
  if (o.mode === 'loop' && !(Number.isInteger(o.night) && o.night >= 1 && o.night <= 8))
    fail('loop needs --night 1..8 (the title\'s CONTINUE number, or 6-8 for the extra nights)');
  return o;
}

/**
 * The live audio detector as a child: its JSON lines are kept in order with
 * their host wall times (cue onsets, and the breathing level every 100 ms).
 */
function startCues(captureDir) {
  const child = spawn('python3', [CUES, '--refs', REFS, '--live', PCM, '--raw', join(captureDir, 'audio.raw'),
    '--events', join(captureDir, 'cues.jsonl')], { stdio: ['ignore', 'pipe', 'pipe'] });
  const events = [];
  const errors = [];
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

function controlsOf(model) {
  const c = model.controlMap;
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { x: v.x, y: v.y, holdMs: v.holdMs, gapMs: v.gapMs }]));
}

/**
 * Night 1's safe window, twice over: bed (lit), left door (listen, lit, shut),
 * closet (lit, shut), right door (listen, lit, shut), back to the left view.
 * Waits are generous on purpose -- this run measures them.
 */
async function calibrate({ act, c, record, snapTo }) {
  const mark = (phase) => record.event('phase', { phase, hostMs: performance.now() });
  const pt = (k) => ({ x: c[k].x, y: c[k].y });
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
function frameVector(r, keys) {
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
  constructor(recorder, det) {
    this.recorder = recorder;
    this.keys = det.regions;
    this.names = Object.keys(det.templates);
    this.t = this.names.map((n) => Float32Array.from(det.templates[n]));
    const [l, r] = det.sampleCounts;
    this.center = [l + r, det.sampleCounts.reduce((s, x) => s + x, 0)];
  }
  now() {
    const r = this.recorder.latest;
    if (!r || performance.now() - r.imageHostMs > STALE_FRAME_MS) return null;
    const v = frameVector(r, this.keys);
    let best = -1; let bd = Infinity; let second = Infinity;
    for (let i = 0; i < this.t.length; i += 1) {
      let d = 0; const t = this.t[i];
      for (let k = 0; k < v.length; k += 1) d += Math.abs(v[k] - t[k]);
      d /= v.length;
      if (d < bd) { second = bd; bd = d; best = i; } else if (d < second) second = d;
    }
    return { view: this.names[best], dist: bd, margin: second - bd, seq: r.seq, imageHostMs: r.imageHostMs, imageNs: r.imageNs, v };
  }
  /** Distance over the two edge regions only: the rooms, whatever the closet between them shows. */
  edgeDist(read, name) {
    const t = this.t[this.names.indexOf(name)];
    const b = this.center[0];
    let d = 0;
    for (let k = 0; k < b; k += 1) d += Math.abs(read.v[k] - t[k]);
    return d / b;
  }
  occupancy(read, litName) {
    const t = this.t[this.names.indexOf(litName)];
    const [a, b] = this.center;
    let d = 0;
    for (let k = a; k < b; k += 1) d += Math.abs(read.v[k] - t[k]);
    return d / (b - a);
  }
  async wait(views, boundMs) {
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
  async arrive(views, sinceHostMs, { minMs, boundMs, exact = 0.8, loose = 6, lateMs = 1500 }) {
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
const ROOM_VIEWS = ['hub', 'roomL', 'roomR'];
const ARRIVE = {
  leftDoor: { minMs: 2100, boundMs: 4200 }, rightDoor: { minMs: 2100, boundMs: 4200 },
  closet: { minMs: 1900, boundMs: 3800 },
  back: { minMs: 700, boundMs: 3000 },
  bed: { minMs: 250, boundMs: 1500, exact: 2.5 },
  panLeft: { minMs: 200, boundMs: 1500 }, panRight: { minMs: 200, boundMs: 1500 },
};

/** The live audio detector's lines, read by host time (wall ms). */
class Ears {
  constructor(cues) { this.cues = cues; this.loopOriginWall = null; }
  /** The game's breathing loop starts 1 s into the level (g4); its audio reaches the host AUDIO_LAG_MS later. */
  anchor(levelOriginWall) { this.loopOriginWall = levelOriginWall + 1000 + AUDIO_LAG_MS; }
  get envelope() { return this.cues.events.find((e) => e.cue === 'breath-envelope') ?? null; }
  /** Seconds of the loop's loud and medium stretches that [fromWall, toWall] covered. */
  coverage(fromWall, toWall) {
    const env = this.envelope;
    if (!env || this.loopOriginWall === null || toWall <= fromWall) return { loud: 0, mid: 0 };
    const L = env.lengthS;
    const a = (((fromWall - this.loopOriginWall) / 1000) % L + L) % L;
    const len = (toWall - fromWall) / 1000;
    const over = (spans) => {
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
  gameMatches(hops) {
    const env = this.envelope;
    if (!env || this.loopOriginWall === null) return 0;
    const L = env.lengthS * 1000;
    return hops.filter((e) => {
      if (e.ncc < 0.28 || e.loopStartMs === undefined) return false;
      const d = (((e.loopStartMs - this.loopOriginWall) % L) + L) % L;
      return Math.min(d, L - d) <= 300;
    }).length;
  }
  /** The newest onset of any of `names` after `fromWall`, or null. */
  latest(names, fromWall = 0) {
    for (let i = this.cues.events.length - 1; i >= 0; i -= 1) {
      const e = this.cues.events[i];
      if (e.onsetMs !== undefined && e.onsetMs > fromWall && names.includes(e.cue)) return e;
    }
    return null;
  }
  breath(fromWall, toWall) {
    const hops = this.cues.events.filter((e) => e.cue === 'breath' && e.atMs >= fromWall && e.atMs <= toWall);
    const max = hops.reduce((m, e) => Math.max(m, e.ncc), 0);
    const game = this.gameMatches(hops);
    // A real loop keeps its phase: >= 3 hops above 0.30 whose loop phase
    // agrees within 80 ms (circular over the 17.675 s loop).
    const strong = hops.filter((e) => e.ncc >= 0.30).map((e) => e.phase);
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
function teachFeed(port, record) {
  const channel = port.openLesson({ timeoutMs: 800, lessonLine: F4_LINE });
  const token = port.endpoint.token;
  let chain = Promise.resolve();
  const last = {};
  const say = (words, key = null) => {
    if (key !== null) { if (last[key] === words) return; last[key] = words; }
    chain = chain.then(() => channel.send(`LESSON ${token} f4 ${words}`))
      .catch((e) => record.event('teach-error', { words, message: e.message }).catch(() => {}));
  };
  return {
    origin: (ns) => say(`origin ${ns}`),
    step: (step) => say(`step ${step}`, 'step'),
    door: (side, word) => say(`door ${side} ${word}`, `door${side}`),
    closet: (word) => say(`closet ${word}`, 'closet'),
    bed: (word) => say(`bed ${word}`, 'bed'),
    level: (ncc) => say(ncc === null ? 'level OFF' : `level ${Math.max(0, Math.min(100, Math.round(ncc * 100)))}`, 'level'),
    cover: (fraction) => say(fraction === null ? 'cover OFF' : `cover ${Math.max(0, Math.min(100, Math.round(fraction * 100)))}`, 'cover'),
    bedLit: () => say('bedlit'),
    fbMode: (mode) => say(`fb mode ${mode}`, 'fbMode'),
    fbAt: (where) => say(`fb at ${where}`, 'fbAt'),
    fbHeard: (what) => say(`fb heard ${what}`),
    fbRan: () => say('fb ran'),
    clear: async () => { say('clear'); await chain; channel.close(); },
  };
}

/** The panel's words for nothing to say: a loop without --teach. */
const QUIET = { origin() {}, step() {}, door() {}, closet() {}, bed() {}, level() {}, cover() {}, bedLit() {}, fbMode() {}, fbAt() {}, fbHeard() {}, fbRan() {}, async clear() {} };

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
async function loopNight({ act, c, record, eyes, ears, epochHostMs, stopAfterMs, night, teach = QUIET }) {
  const pt = (k) => ({ x: c[k].x, y: c[k].y });
  const nightMs = () => performance.now() - epochHostMs;
  const log = (m, f = {}) => record.event('policy', { atNightMs: Math.round(nightMs()), m, ...f });
  const stats = { cycles: 0, closes: 0, flashes: 0, occupiedHall: 0, closetHolds: 0, lost: 0 };
  let where = 'roomL';

  const go = async (control, views, _boundMs, gesture = 'press') => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const at = performance.now();
      if (gesture === 'double') await act.double(control, pt(control), c[control].gapMs);
      else if (gesture === 'hold') await act.hold(control, pt(control), c[control].holdMs);
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
        now = eyes.now();
        const room = now && ROOM_VIEWS.find((v) => eyes.edgeDist(now, v) <= 0.8);
        if (room) { now = { ...now, view: room, dist: 0 }; break; }
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
  const flash = async (ms, litName) => {
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

  const door = async (side) => {
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
    const listen = async (fromWall, minMs = 900, maxMs = 4500) => {
      const start = performance.now();
      for (;;) {
        const hop = ears.cues.events.findLast?.((e) => e.cue === 'breath');
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
    const judge = (h, stepsSince, c) => {
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
    let occ = null;
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
  const unresolved = new Set();
  // The bed turn kills if Bonnie or Chica has dwelt at hall-near 20 - night
  // seconds (g484/g479 -> g375/g376), and a lit silent hall is what resets
  // it. n4h turned to the bed ~40 s after the left door's last check, while a
  // right-door episode ran 19 s. So a bed turn needs both doors cleared
  // within (20 - night - 4) s, and a stale door is checked first.
  const lastClearMs = { L: -Infinity, R: -Infinity };
  const FRESH_MS = Math.max(4000, (20 - Math.min(night, 8) - 4) * 1000);
  const staleDoors = () => ['L', 'R'].filter((d) => nightMs() - lastClearMs[d] > FRESH_MS);
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
  const home = async (side) => {
    const f = await back(ROOM_VIEWS, 2600);
    if (!f) return null;
    if (f.view === 'hub' && f.closetOff > 10) {
      await log(`closet stands open in the hub (${f.closetOff.toFixed(1)}): Foxy is inside`);
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

  const back = (views, boundMs) => go('back', views, boundMs);

  // --- Fredbear (Night 5; Nights 6-8 from 4 AM) --------------------------------
  // Every arrival of his on a living-room side plays a side's sound (fb-left
  // h26, fb-right h25: g491-g495, and the repels g502/g503, g522/g523,
  // g526/g527); only the step from a side into its hall is silent (g493/g496).
  // So the door to hold is the one on the side he last landed on, and a held
  // door with him in its hall sends him to the other side on the 3000 ms tick
  // (g502/g503), which we hear. Holding is also a key down, which keeps
  // listening mode at 0 (g322): the teleports g508-g511 need it non-zero.
  // A laugh can be the teleport into the bed or the closet (g3842-g3848, on a
  // 30 s clock; a fake on a 10 s one, g530): bed first, then the closet.
  const FRED_FROM_MS = night === 5 ? 0 : 240000;      // g599/g601/g603 at 4 AM
  const LAUGH_MIN = 0.62;                              // menu audio false-matched laughs at 0.55-0.59 (cal0)
  let fredSide = null;
  let roomCheckWall = wallOf(performance.now());
  const fredActive = () => night >= 5 && nightMs() >= FRED_FROM_MS;
  // The panel hears what the loop hears: every sound of his, as it lands.
  let fredWatch = null;
  const startFredWatch = () => {
    if (fredWatch) return;
    teach.fbMode(night === 8 ? 'NIGHTMARE_MAX' : night === 7 ? 'NIGHTMARE' : 'FREDBEAR');
    teach.fbRan();
    let seen = 0;
    fredWatch = setInterval(() => {
      for (const e of ears.cues.events.slice(seen)) {
        if (e.onsetMs === undefined) continue;
        if (e.cue === 'fb-left') { teach.fbHeard('RAN_LEFT'); teach.fbAt('LEFT'); }
        else if (e.cue === 'fb-right') { teach.fbHeard('RAN_RIGHT'); teach.fbAt('RIGHT'); }
        else if (e.cue === 'laugh' && e.ncc >= LAUGH_MIN) { teach.fbHeard('LAUGH'); teach.fbAt('ROOM'); }
      }
      seen = ears.cues.events.length;
    }, 200);
  };
  // To a door on his nights, with the door already held when we get there:
  // a passed roll while we LISTEN at a door teleports him into the room
  // without a sound (g508-g511: his flag and listening mode), and a hold is a
  // key down, which keeps listening at 0 (g322/g328). So the close button is
  // pressed during the run -- at (1990, 900) that touch cannot pan the room,
  // which only pans below follow 7 (g21-g24), and the run is follow >= 7.
  const toRoomView = async (side) => {
    const view = side === 'L' ? 'roomL' : 'roomR';
    return where === view || !!await go(side === 'L' ? 'panLeft' : 'panRight', [view], 1500, 'hold');
  };
  const roomCheck = async (why) => {
    await log(`fredbear room check (${why})`);
    teach.step('FB_BED');
    if (!await go('bed', ['bed', 'doorR', 'doorL'], 1500)) return false;
    // On the bed he leaves after two one-second ticks of light (g526/g527).
    let occ = null; let lit = 0;
    for (let slice = 0; slice < 7; slice += 1) {
      occ = await flash(600, 'bed-lit');
      lit += 600;
      if (lit >= 1800 && occ <= OCCUPIED) break;
    }
    await log(`fredbear bed occupancy ${occ?.toFixed(1)}`);
    if (!await back(ROOM_VIEWS, 1800)) return false;
    await centre();
    teach.step('FB_CLOSET');
    if (!await go('closet', ['closet'], 3200, 'double')) return false;
    // In the closet he is ejected on the 3000 ms tick while it is held (g522/g523).
    await act.hold('closeDoor', pt('closeDoor'), 3500);
    if (!await leaveCloset()) return false;
    roomCheckWall = wallOf(performance.now());
    return true;
  };
  // A real laugh -- the teleport into the bed or closet -- only happens on
  // the room clock, every 30 s (20 s on the shadow nights) of the level's own
  // time (g3844); the fakes run on a 10 s one (g530). A laugh off the room
  // clock is a fake and costs no trip.
  const ROOM_CLOCK_S = night >= 7 ? 20 : 30;
  const onRoomClock = (laugh) => {
    const t = (laugh.onsetMs - AUDIO_LAG_MS - wallOf(epochHostMs) - LEVEL_ORIGIN_MS) / 1000;
    const m = ((t % ROOM_CLOCK_S) + ROOM_CLOCK_S) % ROOM_CLOCK_S;
    return m < 1.5 || m > ROOM_CLOCK_S - 1.0;
  };
  let lastLaughMs = 0;
  const fredStep = async () => {
    const heard = ears.latest(['fb-left', 'fb-right']);
    if (heard) fredSide = heard.cue === 'fb-left' ? 'L' : 'R';
    const laugh = ears.latest(['laugh'], roomCheckWall);
    if (laugh && laugh.ncc >= LAUGH_MIN && laugh.onsetMs !== lastLaughMs) {
      lastLaughMs = laugh.onsetMs;
      if (onRoomClock(laugh)) return roomCheck(`laugh ${laugh.handle} ${laugh.ncc} on the room clock`);
      await log(`fredbear laugh ${laugh.handle} ${laugh.ncc} off the room clock: a fake`);
    }
    if (wallOf(performance.now()) - roomCheckWall > 45000) return roomCheck('45 s without one');
    const side = fredSide ?? 'L';
    teach.step('FB_SWITCH');
    if (!await toRoomView(side)) return false;
    const control = side === 'L' ? 'leftDoor' : 'rightDoor';
    await act.double(control, pt(control), c[control].gapMs);
    teach.fbRan();
    teach.step(side === 'L' ? 'FB_HOLD_LEFT' : 'FB_HOLD_RIGHT');
    teach.door(side, 'SHUT');
    const t0 = wallOf(performance.now());
    const shutView = side === 'L' ? 'doorL-shut' : 'doorR-shut';
    let reached = false;
    // At most ~9 s at the door (plus the run): standing still arms the black
    // flash at 25 s on a Fredbear night (g566/g564), and the walk home resets it.
    const r = await act.holdWhile('closeDoor', pt('closeDoor'), 11500, () => {
      const f = eyes.now();
      if (f && f.view === shutView) reached = true;
      const e = ears.latest(['fb-left', 'fb-right', 'laugh'], t0 - 200);
      if (!e) return null;
      if (e.cue === 'laugh') return e.ncc >= LAUGH_MIN && onRoomClock(e) ? 'laugh' : null;
      return (e.cue === 'fb-left' ? 'L' : 'R') !== side ? 'moved' : null;
    });
    where = reached ? (side === 'L' ? 'doorL' : 'doorR') : where;
    await log(`fredbear held ${side} ${Math.round(r.heldMs)} ms: ${r.why}${reached ? '' : ' (never saw the door shut)'}`, { side, fredSide });
    if (!reached) return !!eyes.now();
    teach.door(side, 'CLEAR');
    if (r.why === 'max') teach.step('FB_MOVE');
    return !!await back(ROOM_VIEWS, 2600);
  };

  while (nightMs() < stopAfterMs) {
    if (fredActive()) {
      startFredWatch();
      if (!await fredStep()) break;
      continue;
    }
    if (where !== 'roomL') {
      if (!await go('panLeft', ['roomL'], 1500, 'hold')) break;
    }
    // The closet's double tap at x 1050 is inside it from the hub and from
    // room-right, never from room-left (controls-fnaf4 closet).
    const toCloset = async (enteredMs) => {
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
  if (fredWatch) clearInterval(fredWatch);
  await log('loop ended', stats);
  return stats;
}

async function main(argv) {
  const options = parseArgs(argv);
  const controlsModel = JSON.parse(await readFile(CONTROLS_PATH, 'utf8'));
  const regionModel = loadRegionSet(REGIONS_PATH, 'night');
  const bindings = Object.fromEntries(await Promise.all([['controls', CONTROLS_PATH], ['regions', REGIONS_PATH], ['cues', CUES]]
    .map(async ([k, p]) => [k, { path: p.slice(ROOT.length + 1), sha256: sha256(await readFile(p)) }])));
  if (options.dryRun) { console.log(JSON.stringify({ status: 'DRY_RUN', modes: MODES, bindings }, null, 2)); return; }
  if (process.env.FNAF4_LEASE_HELD !== '1') fail('run through fnaf4-run.sh so the serial lease is held');
  const serial = process.env.FNAF_SERIAL ?? DEFAULT_SERIAL;
  const c = controlsOf(controlsModel);

  const id = `fnaf4-${options.mode}-${options.label ?? 'run'}-${stamp()}`;
  const outdir = join(ROOT, 'artifacts', 'runs', id);
  const captureDir = join(homedir(), 'fnaf-apks', 'fnaf4-device-runs', id);
  await Promise.all([mkdir(outdir, { recursive: true }), mkdir(captureDir, { recursive: true })]);
  const record = new RunRecord({ schema: 'fnaf4-run-v1', pkg: PACKAGE, id, outdir, captureDir, options, bindings,
    claimLevel: 'DEVICE_MEASURED helper native frames and regions, A2DP audio; no detector or route is promoted by this record',
    sensor: 'cue-helper-mediaprojection-2400x1080 + a2dp-bluealsa' });
  await record.save('PREFLIGHT');

  const port = new AdbCueHelperPort({ serial });
  const snapDir = join(tmpdir(), `fnaf4-snap-${process.pid}`);
  await mkdir(snapDir, { recursive: true });
  let n = 0;
  const snapTo = async (name) => {
    n += 1;
    const target = join(snapDir, `f${n}.png`);
    await port.snap(`f4s${n}`, target);
    await record.capture(name, await readFile(target));
  };
  let hidProcess = null; let recorder = null; let channel = null; let cues = null; let entered = false; let error = null; let video = null;
  try {
    const link = execFileSync(join(ROOT, 'tools/cue/bt-audio-link.sh'), ['--ensure', '--game-package', PACKAGE],
      { encoding: 'utf8', timeout: 90000 });
    await record.event('audio-link', { status: link.trim().split('\n').pop() });
    await snapTo('title-before');
    hidProcess = new AdbHidProcess({ serial });
    const hid = new HidWireTransport({ write: l => hidProcess.write(l), ready: () => hidProcess.ready(), contactMs: CONTACT_MS });
    await hid.start();
    const act = new Actor(hid, record, CONTACT_MS);

    cues = startCues(captureDir);
    for (let i = 0; i < 50 && !cues.started(); i += 1) await sleep(100);
    if (!cues.started()) fail(`audio detector did not start: ${cues.errors.slice(-3).join(' | ')}`);
    channel = port.openRegions({ timeoutMs: 1500 });
    await registerSet(channel, regionModel.set);
    recorder = new RegionRecorder(channel, join(captureDir, 'regions.ndjson.gz'));
    recorder.start();
    await sleep(500);

    if (options.video) video = startVideo(serial, id);
    entered = true;
    await act.press('continue', { x: c.continue.x, y: c.continue.y });
    record.document.continueHostMs = performance.now();
    await record.save('NIGHT');
    if (options.mode === 'calibrate') {
      // The night card, then the room; the first calibration step starts well after.
      await sleep(11000);
      await calibrate({ act, c, record, snapTo });
    } else {
      const det = JSON.parse(await readFile(options.detectors, 'utf8'));
      if (det.schema !== 'fnaf4-detectors-v1') fail('--detectors is not fnaf4-detectors-v1');
      record.document.detectors = { path: options.detectors, sha256: sha256(await readFile(options.detectors)), source: det.source };
      const eyes = new Eyes(recorder, det);
      const first = await eyes.wait(['roomL'], 20000);
      if (!first) fail('no room-left frame within 20 s of CONTINUE');
      // The level frame starts about when its first room frame shows
      // (UNKNOWN(origin-offset): no hour boundary has been measured yet).
      const epochHostMs = first.imageHostMs;
      record.document.night = { firstRoomAfterContinueMs: first.imageHostMs - record.document.continueHostMs, epochHostMs };
      await record.save('NIGHT_RUNNING');
      let teach = QUIET;
      if (options.teach) {
        try {
          teach = teachFeed(port, record);
          // The origin on the helper's own image clock: the first room frame.
          // The level's own clock starts LEVEL_ORIGIN_MS before its first
          // room frame (breathing phase, Nights 2-4): the panel's bars run on it.
          teach.origin(first.imageNs + BigInt(LEVEL_ORIGIN_MS) * 1000000n);
          teach.step('WALK');
        } catch (e) { await record.event('teach-error', { message: e.message }); teach = QUIET; }
      }
      record.document.teach = options.teach;
      const ears = new Ears(cues);
      ears.anchor(wallOf(epochHostMs) + LEVEL_ORIGIN_MS);
      record.document.loop = await loopNight({ act, c, record, eyes, ears, epochHostMs,
        stopAfterMs: options.stopAfterMs, night: options.night, teach });
      await teach.clear();
      record.document.night.endedAtNightMs = performance.now() - epochHostMs;
      for (let i = 0; i < 3; i += 1) { await snapTo(`after-night-${i}`); await sleep(2500); }
    }
    await snapTo('end');
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
    if (cues) {
      await cues.stop();
      record.document.audio = { events: cues.events.length, onsets: cues.events.filter(e => e.onsetMs).length,
        stderrTail: cues.errors.slice(-3), path: join(captureDir, 'cues.jsonl') };
    }
    if (video) {
      try {
        const dir = join(homedir(), 'fnaf-apks', 'fnaf4-videos');
        await mkdir(dir, { recursive: true });
        record.document.video = await video.stop(dir);
      } catch (e) { record.document.video = `FAILED: ${e.message}`; }
    }
    if (entered) {
      // Abandon whatever follows the night (the minigame, a game over); the
      // save already holds the result. Leave the title up.
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
  console.log(`fnaf4 run ${id}: ${record.document.status}; inputs=${record.document.inputsSent}; ` +
    `regionFrames=${record.document.regions?.frames}; audioEvents=${record.document.audio?.events}; out=${outdir}; frames=${captureDir}`);
  if (record.document.status !== 'COMPLETE') process.exitCode = 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 2; });
}
