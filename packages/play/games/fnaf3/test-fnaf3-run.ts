#!/usr/bin/env node
// The FNaF 3 runner's refusals, its template-free readers on synthetic
// frames, its search order along Springtrap's source edges, the
// occupancy score's two jobs: static alone stays low, a figure does not,
// and the region recorder it reads its night through (night-kit.ts), across
// the ways a night took the CLI's recorder on 2026-10-01.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseArgs, searchOrder, NEXT, VENT_OF, SystemsClock, chooseReboot, teachFeed, raiseMonitor } from './fnaf3-run.ts';
import { FEED, PICTURE_MASK, Reader, boxSamples, medianLuma, occupancy, decodePng, sampleBlocks, boxLuma, stateScore, IMAGE_GEOMETRY, CAMERA_FRAMES } from './fnaf3-detectors.ts';
import { pngFromRegion } from '../../bin/phone/native-regions.ts';
import type { AdbCompanionPort } from '../../src/campaign/physical-ports.ts';
import { RegionRecorder, type RegionRead, type RunRecord, relaunchToTitle, releaseContacts } from '../../bin/phone/night-kit.ts';

const failures: string[] = [];
let checks = 0;
const ok = (what: string, c: unknown) => { checks += 1; if (!c) failures.push(what); };
const throws = (what: string, fn: () => unknown) => { try { fn(); ok(what, false); } catch { ok(what, true); } };
/** A fake that implements only what the code under test calls. */
const fakeOf = <T>(value: unknown) => value as T;
type Rect = { x: number, y: number, width: number, height: number, step: number };

// --- refusals ---------------------------------------------------------------------
throws('live needs both flags', () => parseArgs(['--live', '--mode', 'calibrate']));
throws('an unknown mode is refused', () => parseArgs(['--live', '--confirm-live', '--mode', 'play']));
throws('a loop needs detectors', () => parseArgs(['--live', '--confirm-live', '--mode', 'loop', '--night', '2']));
throws('a loop needs its night', () => parseArgs(['--live', '--confirm-live', '--mode', 'loop', '--detectors', 'd.json']));
throws('FNaF 3 has no Night 7', () => parseArgs(['--live', '--confirm-live', '--mode', 'loop', '--detectors', 'd.json', '--night', '7']));
throws('a label is a slug', () => parseArgs(['--dry-run', '--label', 'Bad Label']));
ok('a dry run needs nothing', parseArgs(['--dry-run']).dryRun === true);
ok('a loop parses', parseArgs(['--live', '--confirm-live', '--mode', 'loop', '--detectors', 'd.json', '--night', '6']).night === 6);

// --- readers ----------------------------------------------------------------------
const controls = JSON.parse(readFileSync(new URL('../../profiles/fnaf3/moto-g56/controls-fnaf3-moto-g56-v204.json', import.meta.url), 'utf8')).controlMap;
const reader = new Reader(controls);
const regionsModel: { sets: { night: Record<string, Rect> } } = JSON.parse(readFileSync(new URL('../../profiles/fnaf3/moto-g56/regions-fnaf3-moto-g56-v204.json', import.meta.url), 'utf8'));
const f = regionsModel.sets.night.feed;
ok('the feed grid matches its region', FEED.x === f.x && FEED.y === f.y && FEED.step === f.step
  && FEED.cols === Math.ceil(f.width / f.step) && FEED.rows === Math.ceil(f.height / f.step));
const total = Object.values(regionsModel.sets.night).reduce((s, r) => s + Math.ceil(r.width / r.step) * Math.ceil(r.height / r.step), 0);
ok(`the set fits the helper's 8192 samples (${total})`, total <= 8192);

const size = (name: string) => { const r = regionsModel.sets.night[name]; return Math.ceil(r.width / r.step) * Math.ceil(r.height / r.step); };
const frameOf = (fill: Record<string, number> = {}) => {
  const regions: Record<string, { pixels: Uint32Array }> = {};
  for (const name of Object.keys(regionsModel.sets.night)) regions[name] = { pixels: new Uint32Array(size(name)).fill(fill[name] ?? 0x202020) };
  return { regions };
};
const GREEN = (153 << 16) | (173 << 8) | 61;
const GREY = (102 << 16) | (102 << 8) | 102;
{
  const fr = frameOf();
  ok('no green label: the monitor is down', reader.selected(fr) === null);
  for (const n of [1, 10, 14]) {
    const g = frameOf();
    for (let m = 1; m <= 15; m += 1) for (const i of reader.labels[m]) g.regions.feed.pixels[i] = GREY;
    for (const i of reader.labels[n]) g.regions.feed.pixels[i] = GREEN;
    ok(`a green CAM ${n} label reads as camera ${n}`, reader.selected(g) === n);
  }
  for (let n = 1; n <= 15; n += 1) ok(`CAM ${n}'s label is sampled at least 3 times`, reader.labels[n].length >= 3);
  // The ventilation blackout darkens everything to a tenth (n2d 210-231 s).
  const dim = (px: number) => (Math.round(((px >> 16) & 255) / 10) << 16) | (Math.round(((px >> 8) & 255) / 10) << 8) | Math.round((px & 255) / 10);
  const dark = frameOf({ feed: dim(0x202020) });
  for (let m = 1; m <= 15; m += 1) for (const i of reader.labels[m]) dark.regions.feed.pixels[i] = dim(GREY);
  for (const i of reader.labels[10]) dark.regions.feed.pixels[i] = dim(GREEN);
  ok('in the dark, the one green label still names the camera', reader.selected(dark) === 10);
  const office = frameOf({ feed: (60 << 16) | (68 << 8) | (26) });
  ok('a green-tinted office tinting every label box is no monitor', reader.selected(office) === null);
  // n2d read the line in the dark at 211.9 s with the frame's brightest sample at 149.
  const dimRed = frameOf();
  for (let c = 10; c < 40; c += 1) dimRed.regions.errors.pixels[((296 - 200) / 8) * 80 + c] = (44 << 16) | (10 << 8) | 10;
  ok('a darkened ventilation line is still read', [...reader.errorLines(dimRed)].join() === 'VENT');
  const shared = new Set<number>();
  let overlap = false;
  for (let n = 1; n <= 10; n += 1) for (const i of reader.labels[n]) { if (shared.has(i)) overlap = true; shared.add(i); }
  ok('no two camera-map labels share a sample', !overlap);
  const red = frameOf({ errors: (220 << 16) | (50 << 8) | 50 });
  ok('red error text is read', reader.errorRed(red) > 12);
  ok('grey static is not an error', reader.errorRed(frameOf({ errors: 0xc0c0c0 })) === 0);
  const lineAt = (y: number) => { const g = frameOf(); for (let c = 10; c < 40; c += 1) g.regions.errors.pixels[((y - 200) / 8) * 80 + c] = (220 << 16) | (50 << 8) | 50; return g; };
  ok('a red line at y 248 is the video error', [...reader.errorLines(lineAt(248))].join() === 'VIDEO');
  ok('a red line at y 296 is the ventilation error', [...reader.errorLines(lineAt(296))].join() === 'VENT');
  ok('no red, no error', reader.errorLines(frameOf()).size === 0);
  ok('a red line at y 200 is the audio error', [...reader.errorLines(lineAt(200))].join() === 'AUDIO');
  // n2e 282 s: cam 10's EXIT sign, dark red at y 360-408 x 980-1132, read as an audio line.
  const exitSign = frameOf();
  for (let y = 360; y <= 408; y += 8) for (let x = 980; x <= 1132; x += 8) exitSign.regions.errors.pixels[((y - 200) / 8) * 80 + (x - 500) / 8] = (45 << 16) | (18 << 8) | 18;
  ok('red below the three lines is the picture, not an error', reader.errorLines(exitSign).size === 0);
  // calibration cam 1: up to 11 dim reddish samples on a band row.
  const staticRow = frameOf();
  for (let c = 10; c < 21; c += 1) staticRow.regions.errors.pixels[((208 - 200) / 8) * 80 + c] = (40 << 16) | (4 << 8) | 4;
  ok('eleven dim red samples on a line row are static', reader.errorLines(staticRow).size === 0);
  ok('the title logo reads bright', reader.title(frameOf({ title: 0xe0f0a0 })) >= 0.2);
  ok('a dark office is not the title', reader.title(frameOf()) < 0.05);
  const bars = frameOf({ bar11: (66 << 16) | (106 << 8) | 82, bar12: (66 << 16) | (106 << 8) | 82, bar13: (66 << 16) | (106 << 8) | 82,
    bar14: (112 << 16) | (65 << 8) | 80, bar15: (66 << 16) | (106 << 8) | 82 });
  ok('a red bar is the sealed vent', reader.sealed(bars) === 14);
  bars.regions.bar14.pixels.fill((66 << 16) | (106 << 8) | 82);
  ok('all green: nothing sealed', reader.sealed(bars) === null);
}
ok('the picture mask keeps most of the picture below the banner band', PICTURE_MASK.length > 0.4 * FEED.cols * FEED.rows);
ok('the picture mask excludes every camera label', [...Array(15).keys()].every((k) =>
  reader.labels[k + 1].every((i) => !PICTURE_MASK.includes(i)) || k + 1 === 11));
ok('boxSamples finds a sample at a grid point', boxSamples(FEED, 400, 130, 0, 0).length === 1);

// --- search order -----------------------------------------------------------------
ok('the first search is the far rooms, nearest the spawn first', searchOrder(null)[0] === 10);
ok('a search starts where he was', searchOrder(9)[0] === 9);
ok('then his neighbours, the vents first', searchOrder(9).slice(1, 4).join() === '11,10,8');
ok('from cam 10 the lethal vent comes first', searchOrder(10)[1] === 14);
ok('every camera and vent is reached from anywhere', [10, 2, 5, 14].every((n) => new Set(searchOrder(n)).size >= 14));
for (const [cam, vent] of Object.entries(VENT_OF)) ok(`cam ${cam} can move into vent ${vent}`, NEXT[Number(cam)].includes(vent));
ok('cam 10 moves to 9 as well as vent 14 (g227/g228)', NEXT[10].includes(9) && NEXT[10].includes(14));
ok('cams 8, 6, 4 and 3 lead into no vent', [8, 6, 4, 3].every((n) => NEXT[n].every((m) => m <= 10)));

// --- occupancy --------------------------------------------------------------------
{
  // mulberry32: a float LCG past 2^53 repeats its pattern frame to frame.
  let s = 12345;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const room = new Uint32Array(FEED.cols * FEED.rows).map((_, i) => { const v = 40 + (i % 17) * 3; return (v << 16) | (v << 8) | v; });
  // Static: a random fifth of the samples bright white, new every frame.
  const staticOf = (base: Uint32Array) => base.map((px) => (rand() < 0.2 ? 0xf0f0f0 : px));
  const template = medianLuma([staticOf(room), staticOf(room), staticOf(room), staticOf(room), staticOf(room)]);
  const empty = occupancy(medianLuma([staticOf(room), staticOf(room), staticOf(room)]), template);
  // A figure: a dark-and-light block over a fifth of the picture.
  const figure = room.map((px, i) => {
    const r = Math.floor(i / FEED.cols); const c = i % FEED.cols;
    return r > 8 && r < 30 && c > 20 && c < 45 ? ((c + r) % 2 ? 0x9aa050 : 0x101408) : px;
  });
  const him = occupancy(medianLuma([staticOf(figure), staticOf(figure), staticOf(figure)]), template);
  ok(`static alone scores low (${empty.over.toFixed(3)})`, empty.over < 0.02);
  ok(`a figure scores high (${him.over.toFixed(3)})`, him.over > 0.08);
  const dim = occupancy(medianLuma([room.map((px) => { const v = Math.round(((px >> 16) & 255) * 0.5); return (v << 16) | (v << 8) | v; })]), template);
  ok(`a dimmed empty room is gain-matched back to empty (${dim.over.toFixed(3)})`, dim.over < 0.02);
}

// --- the game's pictures (v2) ------------------------------------------------------
{
  // A PNG the repository's own encoder writes decodes back to its luma.
  const region = { cols: 5, rows: 3, pixels: Uint32Array.from({ length: 15 }, (_, i) => (i * 17 << 16) | (i * 9 << 8) | (i * 3)) };
  const png = decodePng(pngFromRegion(region, 1));
  ok('a PNG decodes to its size', png.width === 5 && png.height === 3);
  const want = (i: number) => Math.round(0.299 * i * 17 + 0.587 * i * 9 + 0.114 * i * 3);
  ok('and to its luma, pixel for pixel', [...png.gray].every((v, i) => v === want(i)));
  // An image the size of the camera picture: grey, with a dark figure where "C" has one.
  const { width, height } = IMAGE_GEOMETRY;
  const room = { width, height, gray: new Uint8Array(width * height).fill(90) };
  const him = { width, height, gray: new Uint8Array(width * height).fill(90) };
  for (let v = 100; v < 500; v += 1) for (let u = 200; u < 400; u += 1) him.gray[v * width + u] = 15;
  const A = sampleBlocks(room); const C = sampleBlocks(him);
  ok('the picture covers the feed where the geometry puts it', A.filter((x) => !Number.isNaN(x)).length > 0.8 * A.length);
  const pairs = [{ A, B: null, C }];
  const frameOf = (img: { gray: Uint8Array }) => {
    const feed = new Uint32Array(FEED.cols * FEED.rows);
    for (let i = 0; i < feed.length; i += 1) {
      const X = FEED.x + FEED.step * (i % FEED.cols); const Y = FEED.y + FEED.step * Math.floor(i / FEED.cols);
      const u = Math.round((X - IMAGE_GEOMETRY.x0) / IMAGE_GEOMETRY.sx); const v = Math.round((Y - IMAGE_GEOMETRY.y0) / IMAGE_GEOMETRY.sy);
      const g = u >= 0 && u < width && v >= 0 && v < height ? img.gray[v * width + u] : 0;
      feed[i] = (g << 16) | (g << 8) | g;
    }
    return feed;
  };
  const sRoom = stateScore(pairs, boxLuma(frameOf(room))); const sHim = stateScore(pairs, boxLuma(frameOf(him)));
  // Both pictures differ from the room on many samples, so each scores C.
  ok(`the empty room scores below zero (${(sRoom.C as number).toFixed(1)})`, (sRoom.C as number) < 0);
  ok(`his picture scores above zero (${(sHim.C as number).toFixed(1)})`, (sHim.C as number) > 10);
  ok('every camera and vent has an empty and a Springtrap picture', Object.keys(CAMERA_FRAMES).length === 15
    && Object.values(CAMERA_FRAMES).every((f) => f.A.length && f.C.length));
  ok('the alternate pairs frame for frame with the empty room where both animate',
    Object.values(CAMERA_FRAMES).every((f) => !f.B || f.B.length === f.A.length || f.B.length === 1));
}

// --- the systems' counters and the reboot choice (g425/g426/g430, g783/g784, g301) ---
{
  const n2 = new SystemsClock(2);
  ok('Night 2 video lasts 60 s of monitor time', n2.cameraLeftS() === 60);
  const n6 = new SystemsClock(7);
  ok('Nightmare video lasts 24 s of monitor time', n6.cameraLeftS() === 24);
  ok('and audio two lures', n6.luresLeft() === 2);
  n6.addMonitorMs(13500);
  ok('12 s of monitor time is one camera hit', n6.camHits === 1 && n6.av5 === 1);
  ok('and leaves 11 s of sight', n6.cameraLeftS() === 11);
  n6.rebooted('VIDEO');
  ok('a camera reboot clears the hits but not the 12 s counter', n6.camHits === 0 && n6.av5 === 1 && n6.cameraLeftS() === 23);
  n6.rebooted('ALL');
  ok('reboot all clears the counter too', n6.av5 === 0 && n6.cameraLeftS() === 24);
  const set = (...w: string[]) => new Set(w);
  ok('two broken systems take reboot all', chooseReboot(set('AUDIO', 'VIDEO'), new SystemsClock(2)) === 'ALL');
  const fresh = new SystemsClock(2);
  ok('a lone video error with a fresh counter takes the camera reboot', chooseReboot(set('VIDEO'), fresh) === 'VIDEO');
  const late = new SystemsClock(2); late.addMonitorMs(8000);
  ok('a lone video error with 8 s on the counter takes reboot all', chooseReboot(set('VIDEO'), late) === 'ALL');
  const lured = new SystemsClock(7); lured.lured();
  ok('a lone video error one lure from breaking audio takes reboot all', chooseReboot(set('VIDEO'), lured) === 'ALL');
  ok('a lone audio error with sight to spare takes the audio reboot', chooseReboot(set('AUDIO'), new SystemsClock(2)) === 'AUDIO');
  const dim = new SystemsClock(7); dim.addMonitorMs(14000);
  ok('a lone audio error with the camera about to fail takes reboot all', chooseReboot(set('AUDIO'), dim) === 'ALL');
  ok('ventilation weighs the same way', chooseReboot(set('VENT'), dim) === 'ALL' && chooseReboot(set('VENT'), new SystemsClock(2)) === 'VENT');
  ok('nothing broken, nothing rebooted', chooseReboot(set(), new SystemsClock(2)) === null);
}

{
  const sent: string[] = [];
  const port = { endpoint: { token: '0'.repeat(32) }, openLesson: ({ lessonLine }: { lessonLine: RegExp }) => ({
    send: async (line: string) => { if (!lessonLine.test(line)) throw new Error('outside the grammar'); sent.push(line.split(' ').slice(3).join(' ')); return 'OK'; },
    close() {} }) };
  const teach = teachFeed(fakeOf<AdbCompanionPort>(port), fakeOf<RunRecord>({ event: async () => {} }));
  teach.origin(5); teach.night(3, false);
  await teach.clear();
  ok('a night starts from a fresh lesson', sent.join('|') === 'clear|origin 5|night 3 NORMAL|clear');
}

{
  // n3b 227.5 s: the menu stayed open behind a misread close; the monitor tab does nothing until Exit.
  const presses: string[] = [];
  let menu = true; let label = null as number | null;
  const act = {
    press: async (k: string) => { presses.push(k); if (k === 'exitMaint') menu = false; if (k === 'monitor' && !menu) label = 10; },
    hold: async (k: string) => { presses.push(k); },
  };
  type Seen = { label: number | null };
  const eyes = { until: async (test: (f: Seen) => boolean) => (label !== null && test({ label }) ? { label, imageHostMs: 0 } : null), now: () => ({ label }) };
  const fake = { selected: (f: Seen) => f.label ?? null, title: () => 0 };
  type Hands = Parameters<typeof raiseMonitor>[0];
  const r = await raiseMonitor(fakeOf<Hands>({ act, c: controls, eyes, reader: fake }));
  ok('a raise closes a menu left open before it pans', r !== null && presses.slice(0, 3).join() === 'exitMaint,panRight,monitor');
  presses.length = 0; label = 4;
  await raiseMonitor(fakeOf<Hands>({ act, c: controls, eyes, reader: fake }));
  ok('a raised monitor is left alone', presses.length === 0);
}

// --- the region recorder crosses a still intro and a capture restart -----------------------
/**
 * A simulated helper on a fake clock: a session copies frame k at 33 ms intervals once the screen moves, or
 * nothing while it is still; a capture restart at `restartAt` replaces the session (new endpoint, seq from 1) and
 * leaves an old channel reading its last frame. The run ends when the clock passes `endAt`.
 */
async function recorderRun({ endAt = 10000, stillUntil = 0, restartAt = Infinity, freshFails = false }) {
  let clock = 0;
  const now = () => clock;
  const pixels = new Uint32Array([0x808080]);
  const sessionAt = (t: number) => (t >= restartAt ? 1 : 0);
  let endpoint = 0;
  const calls = { cached: 0, fresh: 0, closed: 0, cleared: 0 };
  let recorder = null as RegionRecorder | null;
  const channelOn = (session: number) => {
    let lastSeq = -1;
    return {
      read: async () => {
        clock += 15;
        if (clock > endAt) void recorder?.stop();
        const live = sessionAt(clock) === session;
        if (live) {
          const start = session === 0 ? stillUntil : restartAt;
          lastSeq = clock < start ? -1 : Math.floor((clock - start) / 33) + 1;
        }
        return { seq: lastSeq, imageNs: BigInt(Math.round(clock * 1e6)), imageHostMs: clock, rttMs: 15,
          regions: { v: { cols: 1, rows: 1, step: 1, pixels } } } as unknown as RegionRead;
      },
      close: () => { calls.closed += 1; },
      clear: async () => { calls.cleared += 1; },
    };
  };
  const open = async (fresh: boolean) => {
    clock += 200;
    if (fresh) { calls.fresh += 1; if (freshFails) throw new Error('Companion endpoint: no READY or DEGRADED endpoint'); endpoint = sessionAt(clock); }
    else { calls.cached += 1; if (endpoint !== sessionAt(clock)) throw new Error('Companion exchange timed out'); }
    return channelOn(endpoint);
  };
  const dir = mkdtempSync(join(tmpdir(), 'night-kit-'));
  const reopens: number[] = [];
  try {
    recorder = new RegionRecorder(open, join(dir, 'regions.ndjson.gz'), { now, onReopen: (row) => { reopens.push(row.reopened); } });
    const seen: number[] = [];
    recorder.onFrame((r) => { seen.push(r.imageHostMs as number); });
    await recorder.start();
    await recorder.loop;
    await recorder.stop();
    const rows = gunzipSync(readFileSync(join(dir, 'regions.ndjson.gz'))).toString('utf8').trim().split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as { seq: number, imageHostMs: number });
    return { recorder, seen, rows, calls, reopens };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

{
  // night7-k3-sr01: capture restarts 2 s in; the old channel repeats its last frame and its endpoint is gone.
  const restart = await recorderRun({ restartAt: 2000 });
  const after = restart.seen.filter((t) => t > 5000).length;
  ok(`a capture restart is crossed: frames after it are recorded (${after})`, after > 100);
  ok('the stopped session is reached by rediscovery after the cached endpoint fails', restart.calls.fresh >= 1);
  ok('each reopen is reported', restart.reopens.length === restart.recorder.reopened && restart.recorder.reopened >= 1);
  ok('the file holds only frame rows', restart.rows.every((row) => typeof row.seq === 'number' && row.seq >= 1));
  ok('stop clears and closes the live channel', restart.calls.cleared === 1 && restart.calls.closed >= 1);
  // night7-k3-sr02: a still intro card is waited through on the cached endpoint.
  const still = await recorderRun({ stillUntil: 5000 });
  ok(`a still intro does not end the recording (${still.seen.length} frames)`, still.seen.length > 100 && still.calls.fresh === 0);
  // Both ways failing ends the recorder and says so, instead of reading a dead channel forever.
  const dead = await recorderRun({ restartAt: 2000, freshFails: true });
  ok(`a restart with no reachable endpoint is a named failure (${dead.recorder.failure})`,
    /could not be reopened/.test(dead.recorder.failure ?? ''));
}

// --- teardown: release before close, and a relaunch read by the title rule ------------------
{
  const calls: string[] = [];
  await releaseContacts({ abort: async () => { calls.push('abort'); throw new Error('stream gone'); } },
    { close: async () => { calls.push('close'); } });
  ok(`a held contact is released before the HID process closes, even when the release fails (${calls.join(',')})`,
    calls.join(',') === 'abort,close');
  const adb: string[] = [];
  const snaps: string[] = [];
  let reads = 0;
  const verified = await relaunchToTitle({ pkg: 'p', activity: 'p/.A', snapTo: async (name) => { snaps.push(name); },
    adb: (args) => { adb.push(args.join(' ')); }, onTitle: async () => ++reads >= 3, pollMs: 1 });
  ok('the relaunch force-stops and starts the game', adb.join('|') === 'shell am force-stop p|shell am start -W -n p/.A');
  ok(`a relaunch is verified by the title rule, not a fixed wait (${verified})`, /^RELAUNCHED_TO_TITLE/.test(verified) && reads === 3);
  ok('the title is retained as a snap', snaps.join() === 'title-after');
  let refused = '';
  try {
    await relaunchToTitle({ pkg: 'p', activity: 'p/.A', snapTo: async () => {}, adb: () => {}, onTitle: async () => false,
      boundMs: 20, pollMs: 1 });
  } catch (e) { refused = (e as Error).message; }
  ok(`a title that never shows is an error (${refused})`, /did not show/.test(refused));
  const blind = await relaunchToTitle({ pkg: 'p', activity: 'p/.A', snapTo: async () => {}, adb: () => {}, settleMs: 1 });
  ok(`without a title rule the relaunch says it is unverified (${blind})`, /^RELAUNCHED_UNVERIFIED/.test(blind));
}

if (failures.length) {
  console.error(`fnaf3 run: ${failures.length} of ${checks} checks FAILED`);
  for (const x of failures) console.error(`  - ${x}`);
  process.exit(1);
}
console.log(`fnaf3 run: all ${checks} checks passed`);
