#!/usr/bin/env node
// Where the actuation machinery loses a contact, graded by a game that says
// which update took each input.
//
// The retail game only lets us infer a press from its effect on a captured
// frame. The FNaF 2 practice rebuild (apply-practice-mod.py) writes, from
// inside its office loop, every left-button state edge with the update that
// saw it (practice-input.jsonl) and every office update's SDL clock and RNG
// state (practice-state.jsonl). This tool sends one stream of contacts
// through the campaign's own transport -- `/system/bin/hid` on the phone, the
// HID_DESCRIPTOR / report() codec and the stream vocabulary of
// packages/play/src/campaign/hid-schedule.ts -- and grades each contact three ways:
// planned, stamped by the kernel (getevent -lt), and taken by the game loop.
//
// What it measures is shared with the retail game up to Android's dispatch;
// the last hop (SDL's touch-to-mouse and the rebuild's per-update poll) is
// the rebuild's own. A level-polled edge log sees a contact only if the button
// is down when an update reads it, which is the retail monitor flip's rule
// (g257/g258) but not every control's. Results are `rebuilt-runtime`
// measurements of this phone, never retail evidence.
//
//   node practice-audit.ts plan  [--seed N] [--plan sweep|monitor]   the contact plan (no device)
//   node practice-audit.ts stream [--seed N] [--plan sweep|monitor]  the hid lines (no device)
//   node practice-audit.ts live --out DIR [--seed N] [--plan sweep|monitor] [--continue] --live
//                                                       under device-lock-exec.py only
//   node practice-audit.ts grade --in DIR [--record FILE]
//
// DRY unless --live. A live run refuses without the serial lease, refuses an
// --out inside the repository (the pulled logs are derived from game state and
// stay outside Git), and only ever presses one point inside the office.
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isList, isRecord, mulberry32 } from '@sixam/kernel';
import { HID_DESCRIPTOR, HID_FEATURE_REPORTS, report } from '@sixam/play';
import { DEFAULT_READY_DELAY_MS } from '@sixam/play/campaign/hid-schedule';
import { parseInputEvents, touchEdges } from '../grade/tap-stall-audit.ts';
import { resolveSerial } from '../phone/local-profile.ts';

interface Point { readonly x: number, readonly y: number }
/** One planned contact: when, how long, and where when not the plan's own point. */
interface PlannedContact {
  readonly index: number, readonly atMs: number, readonly holdMs: number, readonly gapMs: number, readonly point?: Point, readonly sync?: boolean;
}
type Plan = ReturnType<typeof plan>;
/** A practice-state.jsonl row: one office update, its SDL clock. */
interface StateRow { readonly frame: number, readonly update: number, readonly elapsed_ms: number }
/** A practice-input.jsonl row: a left-button edge with the update that saw it. */
interface InputEdge {
  readonly frame: number, readonly edge: 'down' | 'up', readonly update: number, readonly elapsed_ms: number, readonly x: number, readonly y: number;
}
/** One update's pump and swap times (ns), the frame it ran in and whether the button was down at its poll. */
interface PumpRow {
  readonly u: number, readonly f: number, readonly t0: number, readonly tp: number, readonly te: number, readonly ts: number,
  readonly tu: number, readonly m: number, readonly session?: undefined, readonly seed?: undefined;
}
/** A frame's RNG seed and the update it followed. */
interface SeedRow { readonly seed: unknown, readonly f: number, readonly after_u: number, readonly u?: undefined, readonly session?: undefined }
/** A calib-updates.jsonl row: the session header (its clocks), a seed, or a pump. */
type CalibUpdate = PumpRow | SeedRow
  | { readonly session: { readonly boot_ns: number, readonly mono_ns: number }, readonly u?: undefined, readonly seed?: undefined };
/** A calib-input.jsonl row: a Java MotionEvent (action, event and receive times) or the SDL event native code queued. */
interface CalibInput {
  readonly src: string, readonly t: number, readonly a?: number, readonly ev?: number, readonly rx?: number, readonly k?: string;
}
type JavaRow = CalibInput & { readonly a: number, readonly ev: number, readonly rx: number };
interface KernelEdge { readonly pressMs: number, readonly releaseMs: number }
/** One contact followed down the chain: its verdict, and when traced the pumps and stage times (ns) of each edge. */
interface ChainRow {
  index: number, sync: boolean, holdMs: number, gapMs: number, verdict: string, pressPump?: number, releasePump?: number,
  polledDown?: number, flagsAgree?: boolean, press?: Record<string, number | null>, release?: Record<string, number | null>;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const SCHEMA = 'recompile-practice-actuation-audit-v1';
export const PACKAGE = 'org.fnaf2practice.play';
export const ACTIVITY = `${PACKAGE}/org.libsdl.app.SDLActivity`;
export const HID_NAME = 'FNAF Practice Audit';
const HID_ID = 104;
// The campaign's readiness delay: InputReader attaches ~5.1 s after
// registration on this phone and reports sent before that are lost.
export const READY_DELAY_MS = DEFAULT_READY_DELAY_MS;
// The office press point: the retail profile's camera-feed / hall light point
// (hid-sweep-probe.ts COORDS.cameraFeedLight), native 2400 x 1080. With the
// monitor down it is the hall flashlight; a hold lights the hall and nothing
// else. The rebuild stretches 1024 x 768 onto 2400 x 1080 (EXACT_FIT, as the
// retail Display Mode FULL), so the game logs it near (384, 384).
export const PRESS_POINT = Object.freeze({ x: 900, y: 540 });
// The monitor toggle: the retail profile's monitor point (hid-sweep-probe.ts
// COORDS.monitor). A raise or lower is an input the office's events answer
// with draws, so a `monitor` plan tests whether input landings reach the RNG.
export const MONITOR_POINT = Object.freeze({ x: 1780, y: 1015 });
// Continue on the rebuild's title, through its touch zone [64,528,80,544]
// (../fixtures/continue.input, game space), stretched EXACT_FIT to native.
export const CONTINUE_GAME = Object.freeze({ x: 72, y: 536 });
export const GAME_SIZE = Object.freeze([1024, 768]);
export const NATIVE_SIZE = Object.freeze([2400, 1080]);
export const toNative = ({ x, y }: Point) => ({ x: x * NATIVE_SIZE[0] / GAME_SIZE[0], y: y * NATIVE_SIZE[1] / GAME_SIZE[1] });

// Hold durations straddle one and two 60 Hz updates; gaps test whether a
// release followed by a press is seen as two contacts. 33 ms is the campaign's
// MIN_CONTACT_MS (recipe.ts), which equals its FUSION_POLL_MS.
export const DURATIONS_MS = Object.freeze([8, 17, 25, 33, 42, 50, 67, 100]);
export const GAPS_MS = Object.freeze([17, 33, 50, 100, 250]);
export const REPEATS = 3;
// Long, well-separated contacts first and last: the clock between the kernel
// and the game loop is fitted on them, never on the contacts being graded.
export const SYNC = Object.freeze({ count: 3, holdMs: 200, gapMs: 600 });

/**
 * The contact plan: times are ms after the readiness delay ends. `sweep`
 * crosses hold durations with gaps at the hall light; `monitor` toggles the
 * monitor with 50 ms holds at seeded gaps of 900-2500 ms, so every raise and
 * lower lands on its own update.
 */
export function plan(seed = 1, kind = 'sweep') {
  const rand = mulberry32(seed);
  const cells: { holdMs: number, gapMs: number, point?: Point, sync?: boolean }[] = [];
  if (kind === 'monitor') {
    for (let i = 0; i < 30; i++) cells.push({ holdMs: 50, gapMs: 900 + Math.floor(rand() * 1600), point: MONITOR_POINT });
  } else if (kind === 'sweep') {
    for (let r = 0; r < REPEATS; r++)
      for (const holdMs of DURATIONS_MS) for (const gapMs of GAPS_MS) cells.push({ holdMs, gapMs });
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
  } else throw new Error(`unknown plan ${kind}`);
  const sync = () => Array.from({ length: SYNC.count }, () => ({ holdMs: SYNC.holdMs, gapMs: SYNC.gapMs, sync: true }));
  const contacts: PlannedContact[] = [];
  let t = 0;
  for (const cell of [...sync(), ...cells, ...sync()]) {
    contacts.push({ index: contacts.length, atMs: t, ...cell });
    t += cell.holdMs + cell.gapMs;
  }
  return Object.freeze({ seed, kind, point: PRESS_POINT, readyDelayMs: READY_DELAY_MS, spanMs: t, contacts });
}

const line = (command: string, fields: object = {}) => JSON.stringify({ id: HID_ID, command, ...fields });
const down = (point: Point) => line('report', { report: report([{ flags: 0x03, point }]) });
const up = (point: Point) => line('report', { report: report([{ flags: 0x00, point }]) });
const delay = (duration: number) => line('delay', { duration });

function register(readyDelayMs: number) {
  return [line('register', { name: HID_NAME, vid: 6353, pid: 61959, bus: 'usb',
    descriptor: HID_DESCRIPTOR, feature_reports: HID_FEATURE_REPORTS }), delay(readyDelayMs)];
}

/** The hid lines for a plan: register, wait, then each contact on contact 0. */
export function stream(p: Plan) {
  const out = register(p.readyDelayMs);
  for (const c of p.contacts) {
    const point = c.point ?? p.point;
    out.push(down(point), delay(c.holdMs), up(point), delay(c.gapMs));
  }
  return out;
}

/** One tap on the rebuild title's Continue zone. */
export function continueStream() {
  const point = toNative(CONTINUE_GAME);
  return [...register(READY_DELAY_MS), down(point), delay(50), up(point), delay(500)];
}

// The runtime's stdio buffers flush at arbitrary bytes, so a process killed
// mid-buffer leaves a row cut anywhere, and the next launch's first row is
// appended to it on the same line. Rows are split where one object ends and
// the next begins; a fragment that does not parse is dropped and counted.
export const dropped = { rows: 0 };
// Every log row begins with one of these keys, and no nested object does, so a
// row cut at any byte is split from whatever the next launch appended to it.
export const ROW_START = /(?=\{"(?:schema|u|seed|src|event)":)/;
/** The rows of a log, of the shape its writer gives them. */
export function jsonl<T = unknown>(text: string) {
  const out: T[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    for (const piece of line.split(ROW_START)) {
      try { out.push(JSON.parse(piece)); } catch { dropped.rows++; }
    }
  }
  return out;
}
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Grade a live run's files with a poll model.
 *
 * The game samples the button once per update, before that update's events;
 * the log stamps an update at the END of its events (SDL ms). A kernel press k
 * whose down edge the game logged at update u therefore arrived, on the SDL
 * clock, after update u-1's stamp and no later than update u's:
 *   E(u-1) < k + C <= E(u)
 * where C is the unknown constant joining the kernel clock to SDL's plus the
 * kernel-to-poll latency. Every logged edge bounds C to one interval; if one
 * C lies in all of them, the chain from kernel to game loop is a constant
 * delay and the width of the intersection is its precision. If none does,
 * the smallest widening that restores one is the jitter the chain adds.
 * With that C, each kernel contact is predicted TAKEN (the button is down at
 * some poll), INVISIBLE (press and release between two polls) or MERGED into
 * the previous contact (its gap falls between two polls), and the prediction
 * is compared with what the game logged.
 */
export function grade({ planJson, getevent, inputEdges, stateRows }:
  { planJson: Plan, getevent: string, inputEdges: readonly InputEdge[], stateRows: readonly StateRow[] }) {
  const p = planJson;
  const kernel = touchEdges(parseInputEvents(getevent), new RegExp(HID_NAME, 'i'));
  if (kernel.node === null) throw new Error(`no "${HID_NAME}" device in the getevent log`);
  if (kernel.edges.length !== p.contacts.length)
    throw new Error(`kernel saw ${kernel.edges.length} presses for ${p.contacts.length} planned`);
  const office = stateRows.filter(r => r.frame === 3);
  const E = new Map(office.map(r => [r.update, r.elapsed_ms]));
  const edges = inputEdges.filter(e => e.frame === 3);
  const downs = edges.filter(e => e.edge === 'down');
  const ups = edges.filter(e => e.edge === 'up');
  if (downs.length === 0) throw new Error('the game loop logged no press');
  // Coarse C from the long sync contacts: median of down-edge stamp minus press.
  const syncIdx = p.contacts.filter(c => c.sync).map(c => c.index);
  const coarseFirst = downs[0].elapsed_ms - kernel.edges[syncIdx[0]].pressMs;
  const syncLags = syncIdx.map(i => {
    const k = kernel.edges[i].pressMs;
    const d = downs.find(x => Math.abs(x.elapsed_ms - (k + coarseFirst)) < 400);
    return d ? d.elapsed_ms - k : null;
  }).filter(v => v !== null).sort((a, b) => a - b);
  if (syncLags.length < 2) throw new Error('fewer than two sync contacts were taken by the game loop');
  const C0 = syncLags[Math.floor(syncLags.length / 2)];
  // Pair every logged edge with the kernel edge nearest its C0-predicted stamp.
  const kernelDowns = kernel.edges.map((k, i) => ({ i, ms: k.pressMs }));
  const kernelUps = kernel.edges.map((k, i) => ({ i, ms: k.releaseMs }));
  type Paired = { edge: InputEdge, kernel: number | null, kMs?: number };
  const pair = (logged: readonly InputEdge[], kset: readonly { i: number, ms: number }[]) => logged.map((e): Paired => {
    let best = null as { i: number, ms: number, d: number } | null;
    for (const k of kset) {
      const d = e.elapsed_ms - (k.ms + C0);
      if (d > -20 && d <= 36 && (best === null || Math.abs(d - 8) < Math.abs(best.d - 8))) best = { ...k, d };
    }
    return best ? { edge: e, kernel: best.i, kMs: best.ms } : { edge: e, kernel: null };
  });
  const pairedDowns = pair(downs, kernelDowns);
  const pairedUps = pair(ups, kernelUps);
  // Interval of C from each paired edge. E(u-1) may be missing if the update
  // before is not logged; such an edge bounds C from above only.
  const bounds = [...pairedDowns, ...pairedUps].filter((x): x is typeof x & { kernel: number, kMs: number } => x.kernel !== null).map(x => {
    const u = x.edge.update;
    // An update the log does not hold reads NaN, as it did untyped.
    const hi = (E.get(u) as number) - x.kMs;
    const prev = E.get(u - 1);
    const lo = prev === undefined ? -Infinity : prev - x.kMs;
    return { kind: x.edge.edge, kernel: x.kernel, update: u, lo, hi };
  });
  const lo = Math.max(...bounds.map(b => b.lo));
  const hi = Math.min(...bounds.map(b => b.hi));
  // The C that violates the fewest intervals, and by how much the rest must widen.
  const candidates = [...new Set(bounds.flatMap(b => [b.lo, b.hi]).filter(Number.isFinite))].sort((a, b) => a - b);
  let best = null as { c: number, violations: number, worst: number } | null;
  for (let c = candidates[0]; c <= (candidates.at(-1) as number); c += 0.25) {
    const miss = bounds.map(b => (c <= b.lo ? b.lo - c + 1e-9 : c > b.hi ? c - b.hi : 0));
    const violations = miss.filter(m => m > 0).length;
    const worst = Math.max(...miss);
    if (best === null || violations < best.violations || (violations === best.violations && worst < best.worst))
      best = { c, violations, worst };
  }
  // Every paired edge bounds C, so the scan visits a candidate.
  const fitted = best as { c: number, violations: number, worst: number };
  const C = lo <= hi ? (lo + hi) / 2 : fitted.c;
  // Predict each kernel contact from the logged update stamps (poll ~ stamp).
  const updates = office.map(r => r.update);
  const stampOf = (u: number) => E.get(u) as number;   // every office update is stamped
  const pollsIn = (a: number, b: number) => updates.filter(u => stampOf(u) >= a && stampOf(u) < b).length;
  const rows = p.contacts.map((c, i): { index: number, sync: boolean, holdMs: number, gapMs: number, plannedAtMs: number,
    kernelAtMs: number, kernelHoldMs: number, predicted: string, observed: string | null, downUpdate?: number } => {
    const k = kernel.edges[i];
    const press = k.pressMs + C, release = k.releaseMs + C;
    const prev = i > 0 ? kernel.edges[i - 1].releaseMs + C : -Infinity;
    const predicted = pollsIn(press, release) === 0 ? 'INVISIBLE'
      : i > 0 && pollsIn(prev, press) === 0 ? 'MERGED' : 'TAKEN';
    const d = pairedDowns.find(x => x.kernel === i);
    const observed = d ? 'TAKEN' : null;
    return {
      index: i, sync: !!c.sync, holdMs: c.holdMs, gapMs: c.gapMs, plannedAtMs: c.atMs,
      kernelAtMs: +(k.pressMs - kernel.edges[0].pressMs).toFixed(3),
      kernelHoldMs: +(k.releaseMs - k.pressMs).toFixed(3),
      predicted, observed,
      ...(d ? { downUpdate: d.edge.update } : {}),
    };
  });
  // A contact the game did not log a down edge for is INVISIBLE or MERGED;
  // which one is decided by whether the button was already down (merged).
  for (const r of rows) if (r.observed === null) {
    const prevUp = pairedUps.find(x => x.kernel === r.index - 1);
    r.observed = prevUp ? 'INVISIBLE' : 'MERGED';
  }
  const graded = rows.filter(r => !r.sync);
  const table = (key: 'holdMs' | 'gapMs', values: readonly number[]) => values.map(v => {
    const set = graded.filter(r => r[key] === v);
    const count = (s: 'observed' | 'predicted') => Object.fromEntries(['TAKEN', 'INVISIBLE', 'MERGED'].map(t => [t, set.filter(r => r[s] === t).length]));
    return { [key]: v, contacts: set.length, observed: count('observed'), predicted: count('predicted'),
      agree: set.filter(r => r.observed === r.predicted).length };
  });
  const drift = rows.map(r => r.kernelAtMs - r.plannedAtMs);
  const holdErr = rows.map(r => r.kernelHoldMs - r.holdMs);
  const deltas: number[] = [];
  for (let i = 1; i < office.length; i++)
    if (office[i].update === office[i - 1].update + 1) deltas.push(office[i].elapsed_ms - office[i - 1].elapsed_ms);
  return {
    kernelEdges: kernel.edges,
    kernelNode: kernel.node,
    loggedEdges: { down: downs.length, up: ups.length,
      unpairedDown: pairedDowns.filter(x => x.kernel === null).length,
      unpairedUp: pairedUps.filter(x => x.kernel === null).length },
    clock: {
      coarseMs: C0,
      feasible: lo <= hi ? { loMs: +lo.toFixed(3), hiMs: +hi.toFixed(3), widthMs: +(hi - lo).toFixed(3) } : null,
      constantDelayHolds: lo <= hi,
      bestMs: +fitted.c.toFixed(3), violatedIntervals: fitted.violations, of: bounds.length,
      jitterLowerBoundMs: lo <= hi ? 0 : +fitted.worst.toFixed(3),
    },
    contacts: rows.length, graded: graded.length,
    agree: graded.filter(r => r.observed === r.predicted).length,
    byHold: table('holdMs', DURATIONS_MS),
    byGap: table('gapMs', GAPS_MS),
    hidTiming: { startDriftMs: range(drift), holdErrorMs: range(holdErr) },
    updateDeltaMs: countBy(deltas),
    officeUpdates: office.length,
    pressPointGame: countBy(downs.map(g => `${g.x},${g.y}`)),
    rows,
  };
}

/**
 * The input chain on the phone's CLOCK_MONOTONIC, from the calibration logs.
 *
 * Each kernel press and release (getevent) is followed to the Java
 * MotionEvent carrying its event time, the SDL mouse event native code then
 * queued, and the pump that drained it: the first update whose pump ended at
 * or after the event was queued. The game polls the button once per pump, so
 * a contact is TAKEN exactly when its press and release are drained by
 * different pumps, INVISIBLE when one pump drains both, and MERGED into the
 * previous contact when one pump drains that contact's release and this
 * one's press. The update rows' polled flag checks every verdict. The
 * getevent clock is not assumed: its offset to the MotionEvent time is
 * measured, and the session header's MONOTONIC and BOOTTIME stamps name it.
 */
export function chain({ kernelEdges, plan: p, calibUpdates, calibInput }:
  { kernelEdges: readonly KernelEdge[], plan: { readonly contacts: readonly { readonly holdMs: number, readonly gapMs: number, readonly sync?: boolean }[] },
    calibUpdates: readonly CalibUpdate[], calibInput: readonly CalibInput[] }) {
  const header = calibUpdates.find(r => r.session)?.session ?? null;
  const updates = calibUpdates.filter((r): r is PumpRow => r.u !== undefined);
  // A Java row carries its action and both times.
  const java = calibInput.filter((r): r is JavaRow => r.src === 'java');
  const sdl = calibInput.filter(r => r.src === 'sdl');
  const ns = (ms: number) => Math.round(ms * 1e6);
  const offsets = kernelEdges.map(k => {
    const best = java.filter(j => j.a === 0)
      .reduce<JavaRow | null>((b, j) => (b === null || Math.abs(j.ev - ns(k.pressMs)) < Math.abs(b.ev - ns(k.pressMs)) ? j : b), null);
    return best ? best.ev - ns(k.pressMs) : null;
  }).filter(v => v !== null).sort((a, b) => a - b);
  const offsetNs = offsets[Math.floor(offsets.length / 2)] ?? 0;
  const bootMinusMono = header ? header.boot_ns - header.mono_ns : null;
  const clock = Math.abs(offsetNs) < 5e6 ? 'CLOCK_MONOTONIC'
    : bootMinusMono !== null && Math.abs(-offsetNs - bootMinusMono) < 5e6 ? 'CLOCK_BOOTTIME' : 'UNKNOWN';
  const pumpOf = (t: number) => updates.find(u => u.tp >= t) ?? null;
  const edge = (kNs: number, action: number, kind: string):
    { j: JavaRow, q: CalibInput, pump: PumpRow | null } | { j: JavaRow, q?: undefined, pump?: undefined } | null => {
    const j = java.find(r => r.a === action && Math.abs(r.ev - kNs) < 2e6);
    if (!j) return null;
    const q = sdl.find(r => r.k === kind && r.t >= j.t - 1e6 && r.t <= j.t + 50e6);
    if (!q) return { j };
    return { j, q, pump: pumpOf(q.t) };
  };
  const rows = kernelEdges.map((k, i): ChainRow => {
    const kd = ns(k.pressMs) + offsetNs, ku = ns(k.releaseMs) + offsetNs;
    const d = edge(kd, 0, 'mdown'), u = edge(ku, 1, 'mup');
    const c = p.contacts[i];
    const base = { index: i, sync: !!c.sync, holdMs: c.holdMs, gapMs: c.gapMs };
    if (!d?.pump || !u?.pump) return { ...base, verdict: 'UNTRACED' };
    const pressPump = d.pump, releasePump = u.pump;
    const polled = updates.filter(x => x.u >= pressPump.u && x.u < releasePump.u);
    const verdict = u.pump.u > d.pump.u ? 'TAKEN' : 'INVISIBLE';
    return {
      ...base, verdict, pressPump: d.pump.u, releasePump: u.pump.u,
      polledDown: polled.length, flagsAgree: polled.every(x => x.m === 1),
      press: {
        dispatchNs: d.j.rx - d.j.ev, nativeNs: d.q.t - d.j.rx, pollWaitNs: d.pump.tp - d.q.t,
        eventsNs: d.pump.te - d.pump.tp, swapNs: d.pump.ts > 0 ? d.pump.ts - d.pump.te : null,
        kernelToPollNs: d.pump.tp - kd, kernelToSwapNs: d.pump.ts > 0 ? d.pump.ts - kd : null,
      },
      release: {
        dispatchNs: u.j.rx - u.j.ev, nativeNs: u.q.t - u.j.rx, pollWaitNs: u.pump.tp - u.q.t,
        kernelToPollNs: u.pump.tp - ku,
      },
    };
  });
  for (let i = 1; i < rows.length; i++)
    if (rows[i].verdict === 'TAKEN' && rows[i - 1].releasePump !== undefined && rows[i - 1].releasePump === rows[i].pressPump
        && rows[i - 1].verdict === 'TAKEN')
      rows[i].verdict = 'MERGED';
  const graded = rows.filter(r => !r.sync);
  const table = (key: 'holdMs' | 'gapMs', values: readonly number[]) => values.map(v => {
    const set = graded.filter(r => r[key] === v);
    return { [key]: v, contacts: set.length, ...countBy(set.map(r => r.verdict)) };
  });
  const taken = rows.filter(r => r.verdict === 'TAKEN' || r.verdict === 'MERGED');
  // A taken contact was traced, so it has both sides.
  const stat = (side: 'press' | 'release', key: string) => range(taken.map(r => (r[side] as Record<string, number | null>)[key])
    .filter((v): v is number => v !== null && v !== undefined).map(v => v / 1e6));
  const office = updates.filter(r => r.f === 3);
  const period: number[] = [];
  for (let i = 1; i < office.length; i++) if (office[i].u === office[i - 1].u + 1) period.push((office[i].t0 - office[i - 1].t0) / 1e6);
  return {
    getevent: { clock, offsetToMotionEventMs: +(offsetNs / 1e6).toFixed(3),
      bootMinusMonoMs: bootMinusMono === null ? null : +(bootMinusMono / 1e6).toFixed(3) },
    verdicts: countBy(graded.map(r => r.verdict)),
    flagsAgree: rows.filter(r => r.flagsAgree === false).length === 0,
    byHold: table('holdMs', DURATIONS_MS),
    byGap: table('gapMs', GAPS_MS),
    press: { dispatchMs: stat('press', 'dispatchNs'), nativeMs: stat('press', 'nativeNs'),
      pollWaitMs: stat('press', 'pollWaitNs'), eventsMs: stat('press', 'eventsNs'), swapMs: stat('press', 'swapNs'),
      kernelToPollMs: stat('press', 'kernelToPollNs'), kernelToSwapMs: stat('press', 'kernelToSwapNs') },
    release: { dispatchMs: stat('release', 'dispatchNs'), nativeMs: stat('release', 'nativeNs'),
      pollWaitMs: stat('release', 'pollWaitNs'), kernelToPollMs: stat('release', 'kernelToPollNs') },
    office: {
      updates: office.length,
      periodMs: range(period),
      timerUnits: range(office.map(r => r.tu)),
      pumpMs: range(office.map(r => (r.tp - r.t0) / 1e6)),
      eventsMs: range(office.map(r => (r.te - r.tp) / 1e6)),
      swapMs: range(office.filter(r => r.ts > 0).map(r => (r.ts - r.te) / 1e6)),
      periodsOver25Ms: period.filter(v => v > 25).length,
    },
    seeds: calibUpdates.filter((r): r is SeedRow => r.seed !== undefined).map(r => ({ frame: r.f, seed: r.seed, afterUpdate: r.after_u })),
    rows,
  };
}

function countBy(values: Iterable<string | number>) {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}
function range(values: readonly number[]) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))];
  return { n: s.length, min: +s[0].toFixed(3), p50: +q(0.5).toFixed(3), p90: +q(0.9).toFixed(3), max: +(s.at(-1) as number).toFixed(3) };
}

// ---- live (device) -------------------------------------------------------

function fail(message: string): never { console.error(`practice-audit: ${message}`); process.exit(2); }

function adb(serial: string, args: string[], { input, timeout = 20000 }: { input?: string, timeout?: number } = {}) {
  return execFileSync('adb', ['-s', serial, ...args], { input, timeout, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function runAs(serial: string, command: string, timeout = 30000) {
  return adb(serial, ['shell', `run-as ${PACKAGE} sh -c '${command}'`], { timeout });
}

// run-as starts in the app's data directory; the runtime chdirs to files/.
const FILES = 'files';

function lineCount(serial: string, file: string) {
  const out = runAs(serial, `if [ -f ${FILES}/${file} ]; then wc -l < ${FILES}/${file}; else echo MISSING; fi`).trim();
  if (out === 'MISSING') return 0;
  if (!/^\d+$/.test(out)) fail(`cannot count ${file}: ${out}`);
  return Number(out);
}

function sendStream(serial: string, lines: string[], name: string, timeoutMs: number) {
  const remote = `/data/local/tmp/${name}.hid`;
  adb(serial, ['shell', `cat > ${remote}`], { input: lines.join('\n') + '\n' });
  adb(serial, ['shell', `/system/bin/hid - < ${remote} > /dev/null 2>&1; rm -f ${remote}`], { timeout: timeoutMs });
}

function preflight(serial: string) {
  const pkg = adb(serial, ['shell', `pm path ${PACKAGE}`]).trim();
  if (!pkg.startsWith('package:')) fail(`${PACKAGE} is not installed`);
  const apk = pkg.split('\n')[0].slice('package:'.length).trim();
  const apkSha = adb(serial, ['shell', `sha256sum ${apk}`]).trim().split(/\s+/)[0];
  const top = adb(serial, ['shell', 'dumpsys activity activities | grep -m1 topResumedActivity']).trim();
  const lock = adb(serial, ['shell', 'dumpsys window | grep -m1 -E "mDreamingLockscreen"']).trim();
  return { apkSha256: apkSha, top, lock };
}

async function live(args: string[]) {
  if (!args.includes('--live')) fail('dry by default: add --live to press the phone');
  if (process.env.CUE_HELPER_LEASE_OWNER_PID === undefined && process.env.FNAF_LEASE_HELD !== '1')
    fail('run under packages/play/src/safety/device-lock-exec.py SERIAL -- ... so the serial lease is held');
  let serial: string;
  try { ({ serial } = resolveSerial()); } catch (error) { fail((error as Error).message); }
  const out = resolve(opt(args, '--out') ?? fail('--out DIR is required'));
  if (!relative(ROOT, out).startsWith('..')) fail('--out must be outside the repository');
  mkdirSync(out, { recursive: true });
  const seed = Number(opt(args, '--seed') ?? 1);
  const pre = preflight(serial);
  if (!pre.top.includes(PACKAGE)) fail(`the practice build is not in front: ${pre.top}`);
  if (/mDreamingLockscreen=true/.test(pre.lock)) fail('the phone is locked');
  const log = (m: string) => { console.log(m); writeFileSync(join(out, 'live.log'), `${new Date().toISOString()} ${m}\n`, { flag: 'a' }); };
  log(`preflight ${JSON.stringify(pre)}`);
  // Both logs are appended across launches and SDL ticks restart at each
  // launch, so only rows written after this point belong to this run.
  const stateStart = lineCount(serial, 'practice-state.jsonl');
  const cu0 = lineCount(serial, 'calib-updates.jsonl');
  const ci0 = lineCount(serial, 'calib-input.jsonl');
  if (args.includes('--continue')) {
    const before = lineCount(serial, 'practice-state.jsonl');
    log('title: Continue');
    sendStream(serial, continueStream(), 'practice-continue', 20000);
    await sleep(6000);
    const after = lineCount(serial, 'practice-state.jsonl');
    if (after <= before) fail('no office update logged after Continue; the title tap did not reach the office');
    log(`office reached: state lines ${before} -> ${after}`);
  }
  const s0 = lineCount(serial, 'practice-state.jsonl');
  await sleep(1000);
  const s1 = lineCount(serial, 'practice-state.jsonl');
  if (s1 <= s0) fail('the office loop is not logging; is the practice build in the office?');
  const i0 = lineCount(serial, 'practice-input.jsonl');
  const p = plan(seed, opt(args, '--plan') ?? 'sweep');
  writeFileSync(join(out, 'plan.json'), JSON.stringify(p, null, 1));
  const lines = stream(p);
  writeFileSync(join(out, 'stream.hid'), lines.join('\n') + '\n');
  log(`stream: ${p.contacts.length} contacts over ${p.spanMs} ms after a ${p.readyDelayMs} ms ready delay`);
  const ge = spawn('adb', ['-s', serial, 'shell', 'getevent -lt'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const geChunks: Buffer[] = [];
  ge.stdout.on('data', d => geChunks.push(d));
  await sleep(500);
  try {
    sendStream(serial, lines, 'practice-audit', p.readyDelayMs + p.spanMs + 30000);
  } finally {
    await sleep(800);
    try { adb(serial, ['shell', 'pkill -x getevent']); } catch { /* already gone */ }
    ge.kill('SIGTERM');
  }
  writeFileSync(join(out, 'getevent.txt'), Buffer.concat(geChunks).toString('utf8'));
  await sleep(1500);
  const inputText = runAs(serial, `tail -n +${i0 + 1} ${FILES}/practice-input.jsonl`, 60000);
  const stateText = runAs(serial, `tail -n +${stateStart + 1} ${FILES}/practice-state.jsonl`, 120000);
  writeFileSync(join(out, 'practice-input.jsonl'), inputText);
  // The calibration build (apply-calib-mod.py) also writes these; the plain
  // practice build does not, and the grade then omits the chain.
  if (cu0 > 0 || ci0 > 0) {
    writeFileSync(join(out, 'calib-updates.jsonl'), runAs(serial, `tail -n +${cu0 + 1} ${FILES}/calib-updates.jsonl`, 120000));
    writeFileSync(join(out, 'calib-input.jsonl'), runAs(serial, `tail -n +${ci0 + 1} ${FILES}/calib-input.jsonl`, 60000));
  }
  writeFileSync(join(out, 'practice-state.jsonl'), stateText);
  writeFileSync(join(out, 'meta.json'), JSON.stringify({ ...pre, seed, inputStartLine: i0,
    calibUpdatesStartLine: cu0, calibInputStartLine: ci0,
    stateStartLine: stateStart, finishedAt: new Date().toISOString() }, null, 1));
  log(`pulled ${inputText.split('\n').filter(Boolean).length} input edges, ${stateText.split('\n').filter(Boolean).length} state rows`);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function opt(args: string[], name: string) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPoint = (value: unknown) => isRecord(value) && finiteNumber(value.x) && finiteNumber(value.y);

/** A plan.json that plan() wrote, checked before grading reads it; a bad one throws. */
export function readPlanFile(value: unknown): Plan {
  if (!isRecord(value) || !Number.isInteger(value.seed) || typeof value.kind !== 'string' || !isPoint(value.point) ||
      !finiteNumber(value.readyDelayMs) || !finiteNumber(value.spanMs) || !isList(value.contacts))
    throw new Error('practice-audit: plan.json is not a practice plan {seed, kind, point, readyDelayMs, spanMs, contacts}');
  value.contacts.forEach((contact, i) => {
    if (!isRecord(contact) || !Number.isInteger(contact.index) || ![contact.atMs, contact.holdMs, contact.gapMs].every(finiteNumber) ||
        (contact.point !== undefined && !isPoint(contact.point)) || (contact.sync !== undefined && typeof contact.sync !== 'boolean'))
      throw new Error(`practice-audit: plan.json contact ${i} is not {index, atMs, holdMs, gapMs, point?, sync?}`);
  });
  return value as unknown as Plan;
}

function gradeDir(args: string[]) {
  const dir = resolve(opt(args, '--in') ?? fail('--in DIR is required'));
  const read = (f: string) => readFileSync(join(dir, f), 'utf8');
  const planJson = readPlanFile(JSON.parse(read('plan.json')));
  const getevent = read('getevent.txt');
  const inputEdges = jsonl<InputEdge>(read('practice-input.jsonl'));
  const stateRows = jsonl<StateRow>(read('practice-state.jsonl'));
  const metaJson: unknown = existsSync(join(dir, 'meta.json')) ? JSON.parse(read('meta.json')) : {};
  const apkSha256 = isRecord(metaJson) ? metaJson.apkSha256 : undefined;
  if (apkSha256 !== undefined && typeof apkSha256 !== 'string') fail('meta.json apkSha256 is not a string');
  const meta = { apkSha256 };
  const { kernelEdges, ...graded } = grade({ planJson, getevent, inputEdges, stateRows });
  const result: typeof graded & { chain?: ReturnType<typeof chain> } = graded;
  if (existsSync(join(dir, 'calib-updates.jsonl')) && existsSync(join(dir, 'calib-input.jsonl'))) {
    result.chain = chain({ kernelEdges, plan: planJson, calibUpdates: jsonl<CalibUpdate>(read('calib-updates.jsonl')),
      calibInput: jsonl<CalibInput>(read('calib-input.jsonl')) });
  }
  const inputs = { plan: sha256(read('plan.json')), getevent: sha256(getevent),
    practiceInput: sha256(read('practice-input.jsonl')), practiceState: sha256(read('practice-state.jsonl')),
    ...(result.chain ? { calibUpdates: sha256(read('calib-updates.jsonl')), calibInput: sha256(read('calib-input.jsonl')) } : {}) };
  const record = {
    schema: SCHEMA, step: 'ROADMAP S2', claimLevel: 'DEVICE_MEASURED', fidelity: 'rebuilt-runtime',
    evidenceId: `practice-actuation-audit-${sha256(JSON.stringify(inputs)).slice(0, 16)}`,
    question: 'Which contacts of the campaign transport does a game loop on this phone take, lose or merge, and on which update?',
    device: { package: PACKAGE, apkSha256Prefix: (meta.apkSha256 ?? '').slice(0, 16) },
    instrument: { transport: '/system/bin/hid, HID_DESCRIPTOR and report() of @sixam/adapters',
      kernel: 'getevent -lt, touchEdges() of packages/play/bin/grade/tap-stall-audit.ts',
      game: 'practice-input.jsonl level-polled left-button edges and practice-state.jsonl SDL ticks' },
    inputsSha256: inputs,
    droppedFragments: dropped.rows,
    notClaimed: [
      'The retail game: its last input hop is the Clickteam runtime, not SDL.',
      'Controls that latch a new touch between updates: this grader sees the polled level only.',
      'Absolute kernel-to-loop latency from the practice log alone: its clock constant is fitted. The chain, where present, is absolute.',
    ],
    // With calibration logs the chain's verdicts come from the pumps that
    // drained each edge and are checked by the polled flag; the poll model
    // pairs ms-stamped edges and can mis-pair neighbouring short contacts.
    verdictSource: result.chain ? 'chain' : 'pollModel',
    result,
  };
  const outFile = opt(args, '--record');
  if (outFile) writeFileSync(outFile, JSON.stringify(record, null, 1) + '\n');
  const { rows, ...summary } = result;
  console.log(JSON.stringify({ evidenceId: record.evidenceId, ...summary }, null, 1));
  void rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...args] = process.argv.slice(2);
  const seed = Number(opt(args, '--seed') ?? 1);
  const kind = opt(args, '--plan') ?? 'sweep';
  if (cmd === 'plan') console.log(JSON.stringify(plan(seed, kind), null, 1));
  else if (cmd === 'stream') console.log(stream(plan(seed, kind)).join('\n'));
  else if (cmd === 'live') await live(args);
  else if (cmd === 'grade') gradeDir(args);
  else fail('usage: plan | stream | live --out DIR --live [--continue] | grade --in DIR [--record FILE]');
}
