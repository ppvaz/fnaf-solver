#!/usr/bin/env node
// Pin the native-region observation path and the FNaF 1 detectors on it.
//
//   1. the REGION codec: the request line refuses what the helper refuses, and
//      a read parses to raw pixels in native order;
//   2. the classifier: a panel names the state, the lit empty scene is
//      `clear`, a frame that matches the UNLIT room is `flicker` (the
//      posctl1 defect: Bonnie hidden by a flicker read clear), and anything
//      else lit is `occupied`;
//   3. the runner refuses the unsafe invocations it exists to refuse.
//
//   node apps/desktop/test/test-native-regions.ts

import { parseRegionRead, regionSetLine } from '@sixam/play/venues/phone/companion';
import { loadRegionSet, pngFromRegion, recordFrames } from '../../../packages/play/bin/phone/native-regions.ts';
import { makeClassifier } from '../../../packages/play/games/fnaf1/fnaf1-detectors.ts';
import type { Detectors, RegionRead } from '../../../packages/play/games/fnaf1/fnaf1-detectors.ts';
import { INPUT } from '@sixam/source/fnaf1';
import { LEFT_OFFICE_FRAMES, parseArgs, routeStatus } from '../bin/fnaf1-custom-run.ts';

const failures = [];
let checks = 0;
const ok = (what: string, cond: unknown) => { checks += 1; if (!cond) failures.push(what); };
const throws = (what: string, fn: () => unknown) => { checks += 1; try { fn(); failures.push(`${what}: did not throw`); } catch { /* expected */ } };

// --- 1. codec -------------------------------------------------------------------
const token = 'a'.repeat(32);
ok('set line', regionSetLine(token, 'left_doorway', { x: 40, y: 200, width: 480, height: 600, step: 12 })
  === `REGION ${token} set left_doorway 40 200 480 600 12`);
throws('bad name refused', () => regionSetLine(token, 'Left', { x: 0, y: 0, width: 1, height: 1 }));
throws('zero width refused', () => regionSetLine(token, 'a', { x: 0, y: 0, width: 0, height: 1 }));
throws('bad token refused', () => regionSetLine('xyz', 'a', { x: 0, y: 0, width: 1, height: 1 }));
{
  const r = parseRegionRead('OK seq=9 imageNs=100 copiedNs=120 captured=9 regions=1 a=10,20,3,2,2:ff0000000000 snapshotNs=200');
  ok('seq', r.seq === 9 && r.imageNs === 100n && r.snapshotNs === 200n);
  const a = r.regions.a;
  ok('strided geometry', a.cols === 2 && a.rows === 1 && a.pixels.length === 2);
  ok('raw pixels in order', a.pixels[0] === 0xff0000 && a.pixels[1] === 0x000000);
  throws('sample count must match geometry', () => parseRegionRead('OK seq=1 regions=1 a=0,0,2,2,1:ff0000 snapshotNs=1'));
  throws('an ERROR reply is not a read', () => parseRegionRead('ERROR region-bounds'));
  const png = pngFromRegion(a);
  ok('png signature', png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
}

// --- 2. classifier ------------------------------------------------------------------
const fill = (n: number, rgb: number) => new Uint32Array(n).fill(rgb);
const b64 = (px: Uint32Array) => Buffer.from(new Uint8Array(px.buffer)).toString('base64');
const N = 16;
const panels = { 'open/off': 0x800000, 'open/on': 0x80ffff, 'shut/off': 0x008000, 'shut/on': 0x00ffff };
const templates: Detectors['templates'] = {};
for (const [state, rgb] of Object.entries(panels)) {
  const lit = state.endsWith('on');
  templates[`pan0|L:${state}`] = { left_panel: b64(fill(N, rgb)), left_doorway: b64(fill(N, lit ? 0x606060 : 0x101010)) };
  templates[`pan600|R:${state}`] = { right_panel: b64(fill(N, rgb)), right_window: b64(fill(N, lit ? 0x606060 : 0x101010)),
    right_doorway: b64(fill(N, lit ? 0x505050 : 0x101010)) };
}
templates.up42 = { cam_label: b64(fill(N, 0xffffff)), map_cam4b: b64(fill(N, 0x404040)) };
// A partial model: the classifier reads only its thresholds and templates.
const classify = makeClassifier({ schema: 'fnaf1-detectors-v1', thresholds: { panelMatch: 8, upMatch: 40, occupied: 4 }, templates } as Detectors);
const read = (regions: RegionRead['regions']) => ({ regions: { cam_label: fill(N, 0), ...regions } });
{
  const lit = classify(read({ left_panel: fill(N, panels['open/on']), left_doorway: fill(N, 0x606060) }), 0);
  ok('lit empty doorway is clear', lit.monitor === 'down' && lit.left === 'clear' && lit.leftDoor === 0);
  const flicker = classify(read({ left_panel: fill(N, panels['open/on']), left_doorway: fill(N, 0x101010) }), 0);
  ok('a lit light rendering the unlit room is flicker, never clear', flicker.left === 'flicker');
  const bonnie = classify(read({ left_panel: fill(N, panels['open/on']), left_doorway: fill(N, 0x6a3a8a) }), 0);
  ok('anything else lit is occupied', bonnie.left === 'occupied');
  const dark = classify(read({ left_panel: fill(N, panels['shut/off']), left_doorway: fill(N, 0x101010) }), 0);
  ok('light off reads dark, door shut reads 2', dark.left === 'dark' && dark.leftDoor === 2);
  const up = classify({ regions: { left_panel: fill(N, 0x123456), left_doorway: fill(N, 0), cam_label: fill(N, 0xffffff) } }, 0);
  ok('a raised CAM 4B reads up on 42', up.monitor === 'up' && up.cam === 42);
  const moving = classify({ regions: { left_panel: fill(N, 0x123456), left_doorway: fill(N, 0), cam_label: fill(N, 0x000000) } }, 0);
  ok('neither room nor camera is flipping, and acts on nothing', moving.monitor === 'flipping' && moving.left === 'hidden');
  ok(`a monitor flip (${INPUT.monitorFlipFrames} frames) reads flipping and does not end the night (${LEFT_OFFICE_FRAMES})`,
    LEFT_OFFICE_FRAMES > INPUT.monitorFlipFrames);
  const chica = classify(read({ right_panel: fill(N, panels['shut/on']), right_window: fill(N, 0xd0c040), right_doorway: fill(N, 0x505050) }), 600);
  ok('someone in the lit window behind a shut door is occupied', chica.right === 'occupied' && chica.rightDoor === 2);
}

// --- 2b. each teach panel clears every region its route reads ----------------------
// The helper captures the overlay with the game, so a panel over a region
// would be read as the room.
{
  const { readFileSync } = await import('node:fs');
  for (const [game, lesson, regions] of [
    ['FNaF 1', 'Fnaf1Lesson.java', 'fnaf1/moto-g56/regions-fnaf1-moto-g56-v207.json'],
    ['FNaF 3', 'Fnaf3Lesson.java', 'fnaf3/moto-g56/regions-fnaf3-moto-g56-v204.json'],
    ['FNaF 4', 'Fnaf4Lesson.java', 'fnaf4/moto-g56/regions-fnaf4-moto-g56-v204.json'],
  ]) {
    const java = readFileSync(new URL(`../../../android/companion/src/com/ppvaz/fnafcompanion/${lesson}`, import.meta.url), 'utf8');
    const constant = (name: string) => Number(new RegExp(`int ${name} = (\\d+);`).exec(java)?.[1]);
    const panel = { left: constant('LEFT'), top: constant('TOP'), right: constant('RIGHT'), bottom: constant('BOTTOM'), guard: constant('GUARD_PX') };
    ok(`${game} panel constants read`, Object.values(panel).every(Number.isFinite));
    const model: { sets: { night: ReturnType<typeof loadRegionSet>['set'] } } = JSON.parse(readFileSync(new URL(`../../../packages/play/profiles/${regions}`, import.meta.url), 'utf8'));
    for (const [name, r] of Object.entries(model.sets.night)) {
      const apart = r.x >= panel.right + panel.guard || r.x + r.width <= panel.left - panel.guard
        || r.y >= panel.bottom + panel.guard || r.y + r.height <= panel.top - panel.guard;
      ok(`${game} teach panel clears ${name} by ${panel.guard} px`, apart);
    }
  }
}

// --- 3. runner refusals ------------------------------------------------------------
throws('live needs both flags', () => parseArgs(['--live', '--dials', '0,0,0,0', '--mode', 'calibrate-empty']));
throws('calibration is only safe at 0/0/0/0',
  () => parseArgs(['--live', '--confirm-live', '--dials', '0,20,0,0', '--mode', 'calibrate-empty']));
throws('1/9/8/7 is refused', () => parseArgs(['--live', '--confirm-live', '--dials', '1,9,8,7', '--mode', 'grid420', '--detectors', 'x']));
throws('grid420 needs detectors', () => parseArgs(['--live', '--confirm-live', '--dials', '20,20,20,20', '--mode', 'grid420']));
ok('the winning invocation parses', parseArgs(['--live', '--confirm-live', '--dials', '20,20,20,20', '--mode', 'grid420',
  '--detectors', 'x']).stopAfterMs === 538000);
throws('--route takes only tree', () => parseArgs(['--live', '--confirm-live', '--dials', '20,20,20,20', '--mode', 'grid420',
  '--detectors', 'x', '--route', 'winner']));
throws('--winner and --route tree are exclusive', () => parseArgs(['--live', '--confirm-live', '--dials', '20,20,20,20',
  '--mode', 'grid420', '--detectors', 'x', '--winner', 'w.json', '--route', 'tree']));
const unnamed = routeStatus({ mode: 'grid420', dials: null, winner: 'nowhere-winner.json', route: null }, { winners: [] });
ok('an uncommitted --winner is refused, naming where winners are committed',
  unnamed?.refusal?.includes('packages/propose/bindings/fnaf1') === true);

// --- 4. the recorder through the three ways a night took it (2026-10-01) --------------------------------------
// A simulated helper on a fake clock: a session copies frame k at 33 ms intervals from `firstAt`, or nothing while the
// screen is still; a capture restart replaces the session (new endpoint, seq from 1) and leaves an old channel reading
// its last frame. `fresh` rediscovery can be made to fail, as a rotated logcat line makes it fail mid-night.
/** A frame row as recordFrames appends it, in the fields these checks read. */
interface FrameRow { readonly seq: number, readonly imageHostMs: number }
async function recorderRun({ seconds = 10, stillUntil = 0, restartAt = Infinity, freshFails = false, cachedFails = false }) {
  let clock = 0;
  const now = () => clock;
  const pixels = new Uint32Array([0x808080]);
  const sessionAt = (t: number) => (t >= restartAt ? 1 : 0);
  let endpoint = 0;   // the session a cached channel was opened on
  const calls = { cached: 0, fresh: 0 };
  const channelOn = (session: number) => {
    let lastSeq = -1;
    return {
      read: async () => {
        clock += 15;
        if (sessionAt(clock) !== session) return { seq: lastSeq, imageNs: 0n, imageHostMs: clock, rttMs: 15, regions: { v: { cols: 1, rows: 1, step: 1, pixels } } };
        const start = session === 0 ? stillUntil : restartAt;
        lastSeq = clock < start ? -1 : Math.floor((clock - start) / 33) + 1;
        return { seq: lastSeq, imageNs: BigInt(Math.round(clock * 1e6)), imageHostMs: clock, rttMs: 15, regions: { v: { cols: 1, rows: 1, step: 1, pixels } } };
      },
      close: () => {}, clear: async () => {},
    };
  };
  const open = async (fresh: boolean) => {
    clock += 200;
    if (fresh) { calls.fresh += 1; if (freshFails) throw new Error('Companion endpoint: no READY or DEGRADED endpoint'); endpoint = sessionAt(clock); }
    else {
      calls.cached += 1;
      if (cachedFails || endpoint !== sessionAt(clock)) throw new Error('Companion exchange timed out');
    }
    return { opened: channelOn(endpoint), read: null };
  };
  const rows: object[] = [];
  // A fake channel: its reads carry only the fields recordFrames reads.
  const done = await recordFrames({ open: open as unknown as Parameters<typeof recordFrames>[0]['open'], seconds, append: (row) => rows.push(row), now });
  return { done, rows, calls, frames: rows.filter((row): row is FrameRow => 'seq' in row) };
}
{
  // night7-k3-sr02: the intro card is still for 5 s; the recorder waits and records the night that follows.
  const still = await recorderRun({ stillUntil: 5000 });
  ok('a still intro does not end the recording', still.frames.length > 100);
  ok('a still screen reopens through the cached endpoint, never by rediscovery', still.calls.fresh === 0 && still.done.reopened >= 1);
  ok('no row is written for seq -1', still.frames.every((row) => row.seq >= 1));
  // night7-k3-sr01: the preflight restarts capture 2 s in; the old channel repeats its last frame, its endpoint is gone.
  const restart = await recorderRun({ restartAt: 2000 });
  const before = restart.frames.filter((row) => row.imageHostMs < 2000).length;
  const after = restart.frames.filter((row) => row.imageHostMs > 5000).length;
  ok(`a capture restart is crossed: frames from both sessions are kept (${before} before, ${after} after)`, before > 40 && after > 100);
  ok('the stopped session is reached by rediscovery after the cached endpoint fails', restart.calls.fresh >= 1);
  // night7-k3-sr03: rediscovery fails mid-night; a still screen must not need it.
  const rotated = await recorderRun({ stillUntil: 8000, freshFails: true });
  ok('a still screen survives a failing rediscovery', rotated.frames.length > 30 && rotated.calls.fresh === 0);
  // Both ways failing is a failure, said as one.
  let refused = null;
  try { await recorderRun({ restartAt: 2000, freshFails: true }); } catch (error) { refused = (error as Error).message; }
  checks += 1;
  if (!refused || !/could not be reopened/.test(refused)) failures.push(`a restart with no reachable endpoint must throw, got ${refused}`);
}

if (failures.length) {
  console.error(`native regions: ${failures.length} of ${checks} checks failed`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`native regions: all ${checks} checks passed`);
