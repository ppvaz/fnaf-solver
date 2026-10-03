#!/usr/bin/env node
// Phone nights whose seed is established, replayed into the rebuilt runtime on the phone's own clock and
// compared with the phone window by window (ROADMAP S2b).
//
//   node packages/propose/bin/recompile/phone-encounter-replay.ts emit --config packages/propose/bin/recompile/phone-encounter-nights.json \
//        --night full-06 --variant landed --out-dir RUNDIR [--inputs-root /path/to/main/checkout]
//   node packages/propose/bin/recompile/phone-encounter-replay.ts compare --config ... --runs DIR --out RESULT.json [--inputs-root ...]
//        [--evidence docs/evidence/RECORD.json]  (a predeclared response experiment only)
//   node packages/propose/bin/recompile/phone-encounter-replay.ts check RESULT.json
//
// emit writes RUNDIR/run.input (navigation plus the night's office contacts), RUNDIR/frametimes.txt (one
// timer delta in ms per office update, CHOWDREN_FRAME_TIMES), RUNDIR/save-before.ini and RUNDIR/env (the
// harness variables). compare reads DIR/<night>-<variant>/trace for every configured night and variant.
// check recomputes a committed result's arithmetic without the binary or any private input.
//
// The clock. A phone frame trace (fnaf2-frame-trace-v3, image_ns) from the night's first office frame gives
// the office updates' timer deltas: update 0 is one 60 Hz frame (the first loop after startTheFrame), and each
// later captured interval dt becomes clamp(round(dt / 16.667), 1, 3) updates -- Fusion's catch-up, the first
// taking dt - (n - 1) ms and each catch-up 1 ms (the rule the model's encounter replays use; `raw` keeps one
// update per captured frame). The rebuild spends exactly these deltas (CHOWDREN_FRAME_TIMES) and the model
// gets them through its frame-time hook (model-draw-trace.ts measuredClock). A night with no trace runs at
// a constant 60 Hz on both sides.
//
// The presses. The schedule is the winner binding's own rows at the night's measured release (originMs after
// the seed), and it must reproduce the retained press file action for action. Its times are sends, not
// landings. Three mappings onto updates, all through the trace clock (releaseAfterFirstNightFrameMs + t -
// originMs is the send on the image clock, 0 at the first office frame):
//   landed  the phone frame a press landed in: the send plus the night's own measured landing latency, the
//           median over its monitor raises of send -> the first captured frame whose monitor region changes by
//           20 or more (the flip starts on the update that reads the touch, g257), then the first update of the
//           pass that drew the first frame at or after that time;
//   sched   the same with no latency (the send's own frame);
//   cum     the model encounter records' rule: t after the seed on the update clock (update 0 ends at 16.667),
//           applied before the first update F with t <= cum(F) + delta(F) / 2 (about 60 ms after the send).
// The landing latency is read from the grid columns the retained trace already carries (monitor_luma), a
// luminance change that is the phenomenon timed; it is one number per night, not per press.
//
// A window is a schedule mask-on press (the even mask presses; the plans alternate on and off), indexed as the
// phone's readers index them. Its occupant is the first office character in its first 1500 ms:
//   model    blackout.unitId (encounter-replay.mjs windowCode);
//   rebuild  while `in danger` > 0, the first of old bonnie, old chica, old freddy, new freddy overlapping
//            `in office` (the test g445-g447 and g538-g541 make; CHOWDREN_WATCH_OVERLAP), else Toy Bonnie's or
//            Toy Chica's overlay object present, else '*' (danger with no named occupant).
// '.' needs the whole window played; '?' is unread, unplayed, or a press that did not put the mask on.
//
// Content-free: codes, ticks, times and hashes. The rebuild and the model are MODEL_ONLY; phone reads and
// terminals are reused DEVICE_MEASURED observations named by their records. Nothing here promotes anything.
import { createHash } from 'node:crypto';
import type { BinaryLike } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareTrace } from '../../../review/bin/recompile/compare-draw-trace.ts';
import { MODEL_SOURCES } from '../../../source/recompile/model-draw-trace.ts';
import { LEDGERS, compareLedger, counterSeries, mismatchRuns, outcomes, watchSeries } from './compare-schedule-replay.ts';
import { controlPoints, expandRows, frameOf, formatRows, harnessRows, modelContacts } from './schedule-to-input.ts';
import type { Contact, PlanRow } from './schedule-to-input.ts';
import { STRATEGY_REGISTRY, validateWinner } from '../plans/bundle.ts';
import { KNOBS0, build } from '../plans/minus-toys-plan.ts';
import { windowCode } from '../../../review/venue-grid/encounter-replay.ts';
import { MODEL_CONTEXT_LIGHT } from '@sixam/source';
import { buttonStrokeState, BUTTON_STROKE_THRESHOLDS } from '../../../play/src/sensors/fnaf2/button-strokes.ts';
import { currentPath } from '@sixam/review/renamed-path';
import type { Sim } from '@sixam/source/fnaf2';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
// A repository path a config names, where it lives now: the configs are hash-bound and keep the paths
// they were written with (ADR 0002 principle 9), and the files they name have moved since.
const current = (path: string) => currentPath(ROOT, path) ?? path;
const sha256 = (value: BinaryLike) => createHash('sha256').update(value).digest('hex');
export const FRAME_MS = 1000 / 60;
export const OFFICE_FRAME = 3;
export const WINDOW_MS = 1500;
export const SCHEMA = 'recompile-phone-encounters-v1';

// The harness watches every compared run carries (one run: they do not change the draw stream).
export const WATCH = Object.freeze({
  counters: ['being attacked by', 'in danger', 'got you stage', 'viewing', 'viewing hall light'],
  overlapZone: 'in office',
  overlap: ['old bonnie', 'old chica', 'old freddy', 'new freddy', 'new bonnie', 'new chica', 'new foxy', 'balloon boy',
    'Active 19', 'chicalookatyou'],
  object: 'mask:0',
});
// Occupant letters, as encounter-replay.mjs's CODE: B/C/F Withered, f/b/c Toy, M Mangle, x Balloon Boy.
const STREAK = [['old bonnie', 'B'], ['old chica', 'C'], ['old freddy', 'F'], ['new freddy', 'f']];
const OVERLAYS = [['Active 19', 'b'], ['chicalookatyou', 'c']];

export function watchEnv() {
  return [`CHOWDREN_WATCH_COUNTER=${WATCH.counters.join(',')}`,
    `CHOWDREN_WATCH_OVERLAP=${WATCH.overlapZone}:${WATCH.overlap.join(',')}`, `CHOWDREN_WATCH=${WATCH.object}`];
}

// ---------------------------------------------------------------- the clock

/** A frame trace's numeric columns, by name. */
export type Columns = Record<string, number[]>;
/** The office update clock from the first night frame (officeClock). */
export type Clock = ReturnType<typeof officeClock>;
/** A schedule row in ms after the seed: [ms, press|release, action]. */
export type QueuedMs = [ms: number, kind: 'press' | 'release', action: string];
/** A queue row on update ticks. */
type QueuedTick = [tick: number, kind: 'press' | 'release', action: string];
/** The binding's rows at a measured release (phoneSchedule). */
export type PhoneSchedule = ReturnType<typeof phoneSchedule>;
/** When a schedule time lands: its update tick, by the time and, for some rules, the edge and control. */
type TickOf = (ms: number, kind: string, control: string) => number;
/** A contact in ms, as the mappings read it. */
type ContactMs = Pick<Contact, 'control' | 'downMs' | 'upMs'>;
/** A schedule in ms, as the mappings read it: its contacts and its queue. */
export interface ScheduleMs<C extends ContactMs = ContactMs> {
  readonly contacts: readonly C[], readonly queueMs: readonly (readonly [number, 'press' | 'release', string])[];
}
/** What mapResponses reads of a response row: its contact and, for an observed one, its frames and latency. */
export type MappedResponse = Pick<ResponseRow, 'contactIndex' | 'control' | 'sendMs'>
  & ({ status: 'UNKNOWN' } | { status: 'OBSERVED_RESPONSE', priorImageMs: number, upperImageMs: number, latencyMs: number });

/** Named numeric columns of a fnaf2-frame-trace-v3 TSV (image_ns always). */
export function traceColumns(text: string, names: readonly string[] = ['image_ns']): Columns {
  const lines = text.split('\n');
  if (!lines[0].startsWith('# schema=fnaf2-frame-trace-v')) throw new Error('not a fnaf2 frame trace');
  const header = lines[1].split('\t');
  const index = names.map((name) => { const i = header.indexOf(name); if (i < 0) throw new Error(`frame trace has no ${name} column`); return i; });
  const rows = lines.slice(2).filter((l) => l.trim()).map((l) => l.split('\t'));
  return Object.fromEntries(names.map((name, j) => [name, rows.map((r) => Number(r[index[j]]))]));
}

/** image_ns of every row of a fnaf2-frame-trace-v3 TSV. */
export function traceImageNs(text: string) {
  return traceColumns(text).image_ns;
}

export const LANDING_CHANGE = 20;     // monitor_luma change that marks the flip's first drawn frame
export const LANDING_SEARCH = 30;     // captured frames searched after a send
export const OFFICE_VIEW_TOLERANCE = 3;

/**
 * Send -> landing latency from the trace's own frames: for each monitor press sent while the office view shows
 * (monitor_luma within 3 of its median over the 60 frames before the first send), the image time of the first
 * frame at or after the send whose monitor_luma differs by LANDING_CHANGE or more, less the send.
 * `sends` are send times on the image clock (0 = the first office frame).
 */
export function landingLatency(columns: Columns, first: number, sends: readonly number[]) {
  const t = columns.image_ns.map((ns) => (ns - columns.image_ns[first]) / 1e6);
  const luma = columns.monitor_luma;
  const at = (T: number) => { let k = first; while (k < t.length && t[k] < T) k += 1; return k; };
  const k0 = at(sends[0]);
  const reference = [...luma.slice(Math.max(first, k0 - 60), k0)].sort((a, b) => a - b);
  const office = reference[Math.floor(reference.length / 2)];
  const latencies = [];
  for (const T of sends) {
    const k = at(T);
    if (k < 1 || k + LANDING_SEARCH >= t.length) continue;
    const before = luma[k - 1];
    if (Math.abs(before - office) > OFFICE_VIEW_TOLERANCE) continue;           // a drop, or not the office view
    let j = k;
    while (j < k + LANDING_SEARCH && Math.abs(luma[j] - before) < LANDING_CHANGE) j += 1;
    if (j < k + LANDING_SEARCH) latencies.push(t[j] - T);
  }
  if (latencies.length < 5) throw new Error(`only ${latencies.length} measurable raises: no landing latency`);
  const sorted = [...latencies].sort((a, b) => a - b);
  const q = (p: number) => Number(sorted[Math.floor(p * (sorted.length - 1))].toFixed(1));
  return { raises: sorted.length, officeViewLuma: office, medianMs: q(0.5), p10Ms: q(0.1), p90Ms: q(0.9), minMs: q(0), maxMs: q(1) };
}

// These are bounded analysis searches, not measured input/animation floors.
export const RESPONSE_RULE = Object.freeze({ searchMs: 200, confirmMs: 600, stableFrames: 2,
  thresholds: BUTTON_STROKE_THRESHOLDS, source: 'packages/play/src/sensors/fnaf2/button-strokes.ts' });

/**
 * Per-contact visual response brackets from retained native strokes. Scheduled alternation supplies the
 * expected states, but both states must be observed. A missing response is UNKNOWN, never a lost-input claim.
 * A response is not dispatch: the preceding positive frame and first changed frame bound visible departure.
 * allowReadyAfterSend explicitly permits an observed prior state acquired after the scheduled send.
 */
/** One contact's visible response: UNKNOWN and why, or the frames that bracket and settle it. */
export type ResponseRow = {
  contactIndex: number, control: string, sendMs: number, sendImageMs: number, from: string, to: string,
} & ({ status: 'UNKNOWN', reason: string } & { [K in keyof ResponseFrames]?: undefined }
  | { status: 'OBSERVED_RESPONSE', reason: undefined } & ResponseFrames);
/** The frames that bracket and settle an observed response, and its latency. */
interface ResponseFrames {
  priorRow: number, responseRow: number, settledRow: number, readyAfterSend: boolean, priorImageMs: number;
  responseImageMs: number, lowerImageMs: number, upperImageMs: number, latencyMs: number;
}

export function nativeResponses(columns: Columns, first: number, contacts: readonly Pick<Contact, 'control' | 'downMs'>[], shift: number,
  { allowReadyAfterSend = false } = {}) {
  const { image_ns, mask_downstroke, monitor_downstroke } = columns;
  if (!image_ns?.length || !mask_downstroke || !monitor_downstroke ||
      mask_downstroke.length !== image_ns.length || monitor_downstroke.length !== image_ns.length)
    throw new Error('native responses need image_ns and both native stroke columns');
  if (!Number.isInteger(first) || first < 0 || first >= image_ns.length) throw new Error('response first frame outside trace');
  const times = image_ns.map((ns, k) => {
    if (!Number.isFinite(ns) || (k && ns <= image_ns[k - 1])) throw new Error('response image clock is not increasing');
    return (ns - image_ns[first]) / 1e6;
  });
  const states = image_ns.map((_, k) => buttonStrokeState({ maskButtonDownstroke: mask_downstroke[k],
    monitorButtonDownstroke: monitor_downstroke[k] }).signature);
  const at = (ms: number) => { let lo = first; let hi = times.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < ms) lo = mid + 1; else hi = mid; } return lo; };
  const ordinal = { mask: 0, monitor: 0 };
  const rows: ResponseRow[] = [];
  contacts.forEach((c, contactIndex) => {
    if (!['mask', 'monitor'].includes(c.control)) return;
    // The line above kept the mask and the monitor.
    const on = ordinal[c.control as 'mask' | 'monitor']++ % 2 === 0;
    const other = c.control === 'mask' ? 'mask-on' : 'monitor-up';
    const from = on ? 'office' : other; const to = on ? other : 'office';
    const sendImageMs = c.downMs + shift;
    const row: ResponseRow = { contactIndex, control: c.control, sendMs: c.downMs, sendImageMs, from, to,
      status: 'UNKNOWN', reason: 'no positive prior state' };
    rows.push(row);
    const k = at(sendImageMs);
    if (k >= times.length) { row.reason = 'send outside trace'; return; }
    let start = k;
    let prior = k - 1;
    if (k < first + 2 || states[k - 2] !== from || states[k - 1] !== from) {
      if (!allowReadyAfterSend) return;
      while (start + 1 < times.length && times[start + 1] - sendImageMs <= RESPONSE_RULE.searchMs &&
          !(states[start] === from && states[start + 1] === from)) start += 1;
      if (start + 1 >= times.length || times[start + 1] - sendImageMs > RESPONSE_RULE.searchMs) return;
      prior = start + 1; start += 2;
    }
    let j = start;
    while (j < times.length && times[j] - sendImageMs <= RESPONSE_RULE.searchMs && states[j] === from) j += 1;
    if (j >= times.length || times[j] - sendImageMs > RESPONSE_RULE.searchMs) { row.reason = 'no bounded departure'; return; }
    const nextSame = contacts.slice(contactIndex + 1).find((x) => x.control === c.control);
    const limit = Math.min(times[j] + RESPONSE_RULE.confirmMs, nextSame ? nextSame.downMs + shift : Infinity);
    let settled = j;
    while (settled + 1 < times.length && times[settled + 1] < limit &&
        !(states[settled] === to && states[settled + 1] === to)) settled += 1;
    if (settled + 1 >= times.length || times[settled + 1] >= limit) { row.reason = 'no confirmed target'; return; }
    Object.assign(row, { status: 'OBSERVED_RESPONSE', reason: undefined, priorRow: j - 1, responseRow: j,
      settledRow: settled, readyAfterSend: prior >= k, priorImageMs: times[j - 1], responseImageMs: times[j],
      lowerImageMs: Math.max(sendImageMs, times[j - 1]), upperImageMs: times[j],
      latencyMs: times[j] - sendImageMs });
  });
  return rows;
}

/** Coverage is derived from rows, retaining every unsupported contact as a median assumption. */
export function responseCoverage(rows: readonly ResponseRow[]) {
  return Object.fromEntries(['monitor', 'mask'].map((control) => {
    const rr = rows.filter((r) => r.control === control);
    const observed = rr.filter((r) => r.status === 'OBSERVED_RESPONSE');
    return [control, { total: rr.length, observed: observed.length, unknown: rr.length - observed.length,
      readyAfterSend: observed.filter((r) => r.readyAfterSend).length }];
  }));
}

/**
 * Override only observed monitor/mask presses. Release latency is unmeasured: preserve the scheduled contact
 * duration by giving the release the same visual-proxy delay. Other contacts keep the control's median rule.
 * The early sensitivity uses the first reconstructed update after the preceding unchanged capture, capped
 * by the first changed capture's update. It shifts the release by the same update count; it is not a proof
 * over every independently perturbed contact in the brackets.
 */
export function mapResponses<C extends ContactMs>(sched: ScheduleMs<C>, baselineTickOf: (ms: number) => number, rows: readonly MappedResponse[],
  clock: Clock, shift: number, { early = false } = {}) {
  const ticks = new Map<string, number>();
  const key = (ms: number, kind: string, control: string) => `${control}/${kind}/${ms.toFixed(3)}`;
  for (const row of rows) {
    if (row.status !== 'OBSERVED_RESPONSE') continue;
    const c = sched.contacts[row.contactIndex];
    if (!c || c.control !== row.control || c.downMs !== row.sendMs) throw new Error('response contact identity differs');
    const last = traceTick(row.upperImageMs, clock);
    const first = Math.min(last, traceTick(row.priorImageMs, clock) + 1);
    const down = early ? first : last;
    const up = traceTick(c.upMs + shift + row.latencyMs, clock) - (last - down);
    ticks.set(key(c.downMs, 'press', c.control), down);
    ticks.set(key(c.upMs, 'release', c.control), up);
  }
  return mapSchedule(sched, (ms: number, kind: string, control: string) => ticks.get(key(ms, kind, control)) ?? baselineTickOf(ms));
}

/**
 * Office update clock from the first night frame: { deltas, passStart, imageMs }. deltas[u] is update u's timer
 * delta in ms; passStart[k] is the first update of the pass that drew captured frame first + k; imageMs[k] is
 * that frame's image time after the first night frame.
 */
export function officeClock(imageNs: readonly number[], first: number, { catchUp = true } = {}) {
  if (!Number.isInteger(first) || first < 0 || first >= imageNs.length) throw new Error('first night frame is outside the trace');
  const deltas = [FRAME_MS];
  const passStart = [0];
  const imageMs = [0];
  for (let k = first + 1; k < imageNs.length; k += 1) {
    const dt = (imageNs[k] - imageNs[k - 1]) / 1e6;
    if (!(dt > 0)) throw new Error(`frame trace is not increasing at row ${k}`);
    passStart.push(deltas.length);
    imageMs.push((imageNs[k] - imageNs[first]) / 1e6);
    const n = catchUp ? Math.max(1, Math.min(3, Math.round(dt / FRAME_MS))) : 1;
    deltas.push(dt - (n - 1), ...Array(n - 1).fill(1));
  }
  return { deltas, passStart, imageMs };
}

/** cum[u] = the update clock when update u starts (sum of the deltas before it); past the list, 60 Hz. */
export function cumulative(deltas: readonly number[], length: number) {
  const cum = [0];
  for (let u = 0; u < length; u += 1) cum.push(cum[u] + (deltas[u] ?? FRAME_MS));
  return cum;
}

/** The `cum` rule: the first update F with t <= cum(F) + delta(F) / 2. */
export function cumTick(t: number, deltas: readonly number[]) {
  let cum = 0;
  for (let u = 0; ; u += 1) {
    const d = deltas[u] ?? FRAME_MS;
    if (t <= cum + d / 2) return u;
    cum += d;
  }
}

/** The landed and sched rules: the first update of the pass that drew the first captured frame at or after T. */
export function traceTick(T: number, clock: Clock) {
  const { imageMs, passStart, deltas } = clock;
  if (T <= 0) return 0;
  let lo = 0;
  let hi = imageMs.length - 1;
  if (imageMs[hi] < T) {                                  // past the trace: 60 Hz from its last update
    return deltas.length + Math.ceil((T - imageMs[hi]) / FRAME_MS) - 1;
  }
  while (lo < hi) { const mid = (lo + hi) >> 1; if (imageMs[mid] >= T) hi = mid; else lo = mid + 1; }
  return passStart[lo];
}

// ---------------------------------------------------------------- the schedule

const simAction = (control: string) => (/^cam\d+$/.test(control) ? `cam:${control.slice(3)}`
  : control === 'cameraFeedLight' || control === 'hallLight' ? MODEL_CONTEXT_LIGHT : control);

/**
 * The binding's rows at a measured release: contacts in ms (schedule-to-input.ts expandRows at epoch = originMs)
 * and the Sim queue in ms ([ms, press|release, action]), whose 60 Hz quantization must be expandRows's queue.
 */
export function phoneSchedule(winner: unknown, night: number, originMs: number) {
  const valid = validateWinner(winner);
  if (!valid.nights.includes(night)) throw new Error(`the binding does not name night ${night}`);
  if (valid.strategy !== 'minus-toys') throw new Error(`strategy ${valid.strategy}: only minus-toys schedules have a harness form`);
  const emitted = STRATEGY_REGISTRY[valid.strategy].emit(valid, night);
  // The minus-toys emitter's knobs are the plan's own.
  const knobs = emitted.knobs as Parameters<typeof build>[0];
  const kk = { ...KNOBS0, ...knobs };
  if (kk.reactiveBB) throw new Error('reactiveBB adds presses the schedule does not hold');
  const rows = build(knobs);
  const bounds = { periodMs: kk.minimal ? kk.minPeriodMs : kk.loopPeriodMs, loopStartMs: kk.minimal ? kk.minLoopStartMs : 0,
    untilMs: kk.minimal ? kk.minStopAtMs : 420000, epochMs: originMs };
  const expanded = expandRows({ ...rows, ...bounds });
  const queue: QueuedMs[] = [];
  const add = (base: number, row: PlanRow) => {
    const when = base + row[0] + originMs;
    if (row[1] === 'tap') queue.push([when, 'press', simAction(row[2])]);
    else if (row[1] === 'hold' || row[1] === 'hall') {
      const control = row[1] === 'hall' ? 'hallLight' : row[2];
      const duration = row[1] === 'hall' ? row[2] : row[3];
      queue.push([when, 'press', simAction(control)], [when + duration, 'release', simAction(control)]);
    } else if (row[1] === 'camdrop') {
      const [, , a, b, cc] = row;
      queue.push([when, 'press', MODEL_CONTEXT_LIGHT], [when + a, 'press', 'monitor'], [when + a + b + cc, 'release', MODEL_CONTEXT_LIGHT]);
      // A row of another kind: the rows come from JSON as well as from build().
    } else throw new Error(`row kind ${(row as PlanRow)[1]} has no harness form`);
  };
  rows.opening.forEach((row) => add(0, row));
  for (let base = bounds.loopStartMs; base < bounds.untilMs; base += bounds.periodMs) rows.loop.forEach((row) => add(base, row));
  (rows.finish ?? []).forEach((row) => add(0, row));
  const order = queue.map((q, i): [QueuedMs, number] => [q, i]).sort((x, y) => x[0][0] - y[0][0] || x[1] - y[1]).map(([q]) => q);
  const quantized = order.map(([ms, kind, action]): QueuedTick => [frameOf(ms), kind, action]).sort((x, y) => x[0] - y[0]);
  if (JSON.stringify(quantized) !== JSON.stringify(expanded.queue)) throw new Error('the ms queue does not quantize to expandRows\'s queue');
  return { emitted, bounds, contacts: expanded.contacts, queueMs: order };
}

/** The retained press file must be this schedule, action for action, to 0.05 ms. */
export function checkPressFile(queueMs: readonly QueuedMs[], pressFile: { readonly actions: readonly (readonly [number, string, string])[] }) {
  const actions = pressFile.actions;
  if (actions.length !== queueMs.length) throw new Error(`press file has ${actions.length} actions, the schedule ${queueMs.length}`);
  queueMs.forEach(([ms, kind, action], i) => {
    const [pms, pkind, paction] = actions[i];
    if (Math.abs(pms - ms) > 0.05 || pkind !== kind || paction !== action)
      throw new Error(`press file action ${i} ${JSON.stringify(actions[i])} is not the schedule's ${JSON.stringify([ms, kind, action])}`);
  });
  return actions.length;
}

/** Contacts on update ticks, and the model queue on the same ticks. */
export function mapSchedule<C extends ContactMs>(sched: ScheduleMs<C>, tickOf: TickOf) {
  let stretched = 0;
  const contacts = sched.contacts.map((c) => {
    const downFrame = tickOf(c.downMs, 'press', c.control);
    let upFrame = tickOf(c.upMs, 'release', c.control);
    if (upFrame <= downFrame) { upFrame = downFrame + 1; stretched += 1; }
    return { ...c, downFrame, upFrame };
  }).sort((x, y) => x.downFrame - y.downFrame || x.upFrame - y.upFrame);
  const queue = sched.queueMs.map(([ms, kind, action]): QueuedTick => [tickOf(ms, kind, action), kind, action]).sort((a, b) => a[0] - b[0]);
  return { contacts, queue, stretched };
}

/** Schedule mask presses (queue order) with their ordinal; windows are the even ones (on, off, on, ...). */
export function maskPresses(queue: readonly (readonly [number, string, string])[]) {
  return queue.filter(([, kind, action]) => kind === 'press' && action === 'mask').map(([tick], i) => ({ tick, i }));
}

// ---------------------------------------------------------------- trace reading and window codes

/** `# overlap F T v...` lines of the first visit to `frame`: tick -> [1 | 0 | null], in WATCH.overlap order. */
export function overlapSeries(text: string, frame: number) {
  let names = null as string[] | null;
  let visit = -1;
  let current = null as number | null;
  const series = new Map<number, (number | null)[]>();
  for (const line of text.split('\n')) {
    const seeded = /^# frame (\d+) seeded /.exec(line);
    if (seeded) { current = Number(seeded[1]); if (current === frame) visit += 1; }
    else if (line.startsWith('# overlaps ')) {
      const spec = line.slice('# overlaps '.length);
      names = spec.slice(spec.indexOf(':') + 1).split(',');
    } else if (line.startsWith('# overlap ')) {
      const m = /^# overlap (\d+) (\d+) (.+)$/.exec(line);
      if (!m || !names) throw new Error('an # overlap line without its # overlaps header, or malformed');
      if (Number(m[1]) !== frame || current !== frame || visit !== 0) continue;
      const values = m[3].split(' ').map((v) => (v === '-' ? null : Number(v)));
      if (values.length !== names.length) throw new Error(`an # overlap line does not carry one value per name: ${line}`);
      series.set(Number(m[2]), values);
    }
  }
  return names ? { names, series } : null;
}

/** The rebuild's occupant letter at the end of one update, or null. */
export function rebuiltOccupant(counterValues: readonly (number | null)[], counterNames: readonly string[],
  overlapValues: readonly (number | null)[], overlapNames: readonly string[]) {
  const danger = counterValues[counterNames.indexOf('in danger')];
  if (!(Number(danger) > 0)) return null;
  for (const [name, letter] of STREAK) if (overlapValues[overlapNames.indexOf(name)] === 1) return letter;
  for (const [name, letter] of OVERLAYS) if (overlapValues[overlapNames.indexOf(name)] !== null) return letter;
  return '*';
}

/**
 * Window codes on one side. `state(u)` is the side's state at the end of update u (null past its end):
 * { maskValue: 0 off / 1 putting on / 2 on / 3 taking off, occupant: letter | null }. `cum` is the update clock;
 * `endMs` the clock when the side's night ended (or its last update). Returns [{ index, tick, code, occupantTick }].
 */
/** A side's state at the end of one update: the mask's alterable, and the occupant's letter. */
export interface SideState { maskValue: number, occupant?: string | null }
/** A window's code on one side, the tick its occupant was first seen and, for a streak occupant, its arrival. */
export interface WindowRow { index: number, tick: number, code: string, occupantTick?: number, why?: string, arrivalMs?: number }

export function windowCodes(presses: readonly { tick: number, i: number }[], state: (u: number) => SideState | null | undefined,
  cum: readonly number[], endMs: number, { windowMs = WINDOW_MS } = {}) {
  const out: WindowRow[] = [];
  for (const { tick, i } of presses) {
    if (i % 2) continue;
    const index = i / 2;
    const before: SideState | null | undefined = tick === 0 ? { maskValue: 0 } : state(tick - 1);
    const at = state(tick);
    if (!before || !at) { out.push({ index, tick, code: '?', why: 'unplayed' }); continue; }
    if (before.maskValue !== 0 || at.maskValue !== 1) { out.push({ index, tick, code: '?', why: 'mask did not go on' }); continue; }
    const until = cum[tick] + windowMs;
    let first = null as string | null;
    let firstTick = null as number | null;
    for (let u = tick; ; u += 1) {
      const s = state(u);
      if (!s) break;
      if (!first && s.occupant) { first = s.occupant; firstTick = u; }
      if (cum[u + 1] > until) break;
    }
    const code = first ?? (endMs < until ? '?' : '.');
    out.push({ index, tick, code, ...(firstTick !== null ? { occupantTick: firstTick } : {}), ...(code === '?' ? { why: 'night ended inside the window' } : {}) });
  }
  return out;
}

/**
 * Phone vs one side, over windows the phone read. '*' (occupied, unnamed) agrees on occupancy only. A window the
 * phone read and the side did not play ('?': ended, or its mask never went on) is `unplayed`: never an agreement,
 * and the first disagreement when it comes first (the phone was there to read it).
 */
export function scoreWindows(phone: string, side: string) {
  let read = 0; let occupied = 0; let compared = 0; let agree = 0; let hits = 0; let occupancyAgree = 0; let unplayed = 0;
  let firstDisagreement = null as { window: number, phone: string, side: string } | null;
  for (let k = 0; k < phone.length; k += 1) {
    const p = phone[k];
    if (p === '?') continue;
    read += 1;
    if (p !== '.') occupied += 1;
    const s = side[k] ?? '?';
    if (s === '?') {
      unplayed += 1;
      if (firstDisagreement === null) firstDisagreement = { window: k, phone: p, side: s };
      continue;
    }
    compared += 1;
    const same = p === s && p !== '*';
    if (same) agree += 1;
    if (same && p !== '.') hits += 1;
    if ((p === '.') === (s === '.')) occupancyAgree += 1;
    if (!same && firstDisagreement === null) firstDisagreement = { window: k, phone: p, side: s };
  }
  return { read, occupied, compared, agree, hits, occupancyAgree, unplayed, firstDisagreement };
}

export const OUTCOME_TOLERANCE_MS = 10000;   // one 10 s cycle

/** A side's end against the phone's terminal: same result, and a death within one cycle of the phone's. */
export function compareOutcome(phoneTerminal: Terminal, side: { readonly result: string, readonly endMs: number | null }) {
  if (phoneTerminal.result === 'UNKNOWN') return { sameResult: null, deltaMs: null, agrees: null };
  const sameResult = phoneTerminal.result === side.result;
  // Number.isFinite passes only numbers.
  const deltaMs = Number.isFinite(phoneTerminal.seedClockMs) && Number.isFinite(side.endMs)
    ? Number(((side.endMs as number) - (phoneTerminal.seedClockMs as number)).toFixed(1)) : null;
  const agrees = sameResult && (side.result !== 'death' || (deltaMs !== null && Math.abs(deltaMs) <= OUTCOME_TOLERANCE_MS));
  return { sameResult, deltaMs, agrees };
}

/** Two host sides against each other over the windows both played. */
export function compareSides(a: string, b: string) {
  let compared = 0; let agree = 0; let firstDisagreement = null as { window: number, a: string, b: string } | null;
  for (let k = 0; k < Math.min(a.length, b.length); k += 1) {
    if (a[k] === '?' || b[k] === '?') continue;
    compared += 1;
    if (a[k] === b[k]) agree += 1;
    else if (firstDisagreement === null) firstDisagreement = { window: k, a: a[k], b: b[k] };
  }
  return { compared, agree, firstDisagreement };
}

// ---------------------------------------------------------------- config and inputs

/** The phone's terminal: how its night ended, and when on the seed's clock. */
export interface Terminal { readonly result: string, readonly seedClockMs?: number | null }
/** A hash-bound file a config names. */
export interface FileRef { readonly path: string, readonly sha256: string }
/** A replay variant: its clock and press rule, and its options. */
interface VariantSpec {
  readonly clock: string, readonly presses: string, readonly releaseLatencyMs?: number;
  readonly allowReadyAfterSend?: boolean, readonly early?: boolean,
}
/** A predeclared per-contact response experiment: its night and window, its control variant and the retained control. */
interface ResponseExperimentSpec { readonly night: string, readonly window: number, readonly control: string, readonly reference: FileRef }
/** One phone night of the config: its run, seed and binding, its hashed inputs, the phone's reads and the variants. */
export interface NightConfig {
  readonly name: string, readonly run: unknown, readonly night: number, readonly seed: number, readonly seedEvidence: unknown;
  readonly winner: string, readonly originMs: number, readonly presses: FileRef;
  readonly trace?: FileRef & { readonly first: number, readonly releaseAfterFirstNightFrameMs: number };
  readonly navigation: string, readonly save: string, readonly customNight?: string;
  readonly staticReadout?: FileRef & { readonly region?: string };
  readonly phone: { readonly windows: string, readonly terminal: Terminal };
  readonly modelRecord?: { readonly windows?: string }, readonly variants: readonly string[], readonly primaryVariant: string;
}
/** A phone-encounter-nights-v1 config. */
export interface EncounterConfig {
  readonly schema: string, readonly modelOptions: string, readonly profile: string, readonly binary: unknown, readonly harness: unknown;
  readonly variants: Record<string, VariantSpec>, readonly nights: readonly NightConfig[];
  readonly responseExperiment?: ResponseExperimentSpec;
}

export function loadConfig(path: string): EncounterConfig {
  const cfg = JSON.parse(readFileSync(path, 'utf8'));
  if (cfg.schema !== 'phone-encounter-nights-v1') throw new Error('config schema must be phone-encounter-nights-v1');
  return cfg;
}

function privateFile(inputsRoot: string, ref: FileRef) {
  const path = resolve(inputsRoot, ref.path);
  const bytes = readFileSync(path);
  if (sha256(bytes) !== ref.sha256) throw new Error(`${ref.path}: sha256 ${sha256(bytes)} is not the recorded ${ref.sha256}`);
  return bytes.toString('utf8');
}

/** Everything one (night, variant) replay needs, derived only from the config and its hashed inputs. */
export function prepare(cfg: EncounterConfig, nightCfg: NightConfig, variant: string, inputsRoot: string) {
  const winnerPath = resolve(ROOT, current(nightCfg.winner));
  const winner = JSON.parse(readFileSync(winnerPath, 'utf8'));
  const sched = phoneSchedule(winner, nightCfg.night, nightCfg.originMs);
  const pressCount = checkPressFile(sched.queueMs, JSON.parse(privateFile(inputsRoot, nightCfg.presses)));
  const spec = cfg.variants[variant];
  if (!spec) throw new Error(`unknown variant ${variant}`);
  let clock = null as Clock | null;
  let latency = null as ReturnType<typeof landingLatency> | null;
  let columns = null as Columns | null;
  if (spec.clock !== 'constant-60hz') {
    if (!nightCfg.trace) throw new Error(`${nightCfg.name} has no frame trace for the ${variant} variant`);
    columns = traceColumns(privateFile(inputsRoot, nightCfg.trace), ['image_ns', 'monitor_luma',
      ...(spec.presses === 'native-response' ? ['mask_downstroke', 'monitor_downstroke'] : [])]);
    clock = officeClock(columns.image_ns, nightCfg.trace.first, { catchUp: spec.clock === 'trace-catchup' });
    const shift = nightCfg.trace.releaseAfterFirstNightFrameMs - nightCfg.originMs;
    const sends = sched.queueMs.filter(([, kind, action]) => kind === 'press' && action === 'monitor').map(([ms]) => ms + shift);
    latency = landingLatency(columns, nightCfg.trace.first, sends);
  }
  // the harness reads frametimes.txt's six decimals; the model gets the same numbers
  const deltas = clock ? clock.deltas.map((d) => Number(d.toFixed(6))) : [];
  // A clock, and the landing latency, come from the night's trace.
  type Traced = NonNullable<NightConfig['trace']>;
  let tickOf: TickOf;
  if (spec.presses === 'landed' || spec.presses === 'sched' || spec.presses === 'native-response') {
    if (!clock) throw new Error(`the ${spec.presses} press rule needs a frame trace`);
    const shift = (nightCfg.trace as Traced).releaseAfterFirstNightFrameMs - nightCfg.originMs
      + (spec.presses !== 'sched' ? (latency as ReturnType<typeof landingLatency>).medianMs : 0);
    const measured = clock;
    tickOf = (ms) => traceTick(ms + shift, measured);
  } else if (spec.presses === 'cum') tickOf = (ms) => cumTick(ms, deltas);
  else throw new Error(`unknown press rule ${spec.presses}`);
  // A variant may land releases at their own latency after the send (docs/evidence/phone-release-latency-20261001.json:
  // at the press's latency the model drops a monitor still held when its raise completes, on nights the phone won).
  if (Number.isFinite(spec.releaseLatencyMs)) {
    if (!clock) throw new Error('a release latency needs a frame trace');
    const pressTick = tickOf;
    const sendShift = (nightCfg.trace as Traced).releaseAfterFirstNightFrameMs - nightCfg.originMs;
    const measured = clock;
    const releaseLatencyMs = spec.releaseLatencyMs as number;
    tickOf = (ms, kind, control) => (kind === 'release' ? traceTick(ms + sendShift + releaseLatencyMs, measured) : pressTick(ms, kind, control));
  }
  let responses = null as {
    rule: typeof RESPONSE_RULE, ruleSourceSha256: string, coverage: ReturnType<typeof responseCoverage>, rows: ResponseRow[];
    interpretation: string,
  } | null;
  let mapped = mapSchedule(sched, tickOf);
  if (spec.presses === 'native-response') {
    const shift = (nightCfg.trace as Traced).releaseAfterFirstNightFrameMs - nightCfg.originMs;
    const rows = nativeResponses(columns as Columns, (nightCfg.trace as Traced).first, sched.contacts, shift,
      { allowReadyAfterSend: spec.allowReadyAfterSend === true });
    // mapResponses reads the fallback rule by time alone, so a release latency would not reach a contact with no
    // observed response; no configured variant sets both.
    mapped = mapResponses(sched, tickOf as (ms: number) => number, rows, clock as Clock, shift, { early: spec.early === true });
    responses = { rule: RESPONSE_RULE, ruleSourceSha256: sha256(readFileSync(resolve(ROOT, RESPONSE_RULE.source))),
      coverage: responseCoverage(rows), rows,
      interpretation: 'Visible response proxies, not dispatch or measured release acceptance; UNKNOWN contacts retain the nightly median. Both host programs receive each mapped contact duration.' };
  }
  const profile = JSON.parse(readFileSync(resolve(ROOT, current(cfg.profile)), 'utf8'));
  const office = harnessRows(mapped.contacts, controlPoints(profile), { frame: OFFICE_FRAME });
  const navigation = readFileSync(resolve(ROOT, current(nightCfg.navigation)), 'utf8');
  const body = formatRows(office);
  const header = [`# phone-encounter-replay ${nightCfg.name} ${variant}: ${nightCfg.winner} night ${nightCfg.night} at ${nightCfg.originMs} ms after the seed`,
    `# clock ${spec.clock}, presses ${spec.presses}; ${mapped.stretched} contacts stretched to one update`];
  const inputText = `${navigation.endsWith('\n') ? navigation : `${navigation}\n`}${header.join('\n')}\n${body}`;
  const frameTimesText = clock ? `# ${nightCfg.name} ${variant}: office update timer deltas (ms)\n${deltas.map((d) => d.toFixed(6)).join('\n')}\n` : null;
  return { sched, pressCount, clock, latency, responses, deltas, mapped, office, inputText, frameTimesText, spec, officeRowsSha256: sha256(body) };
}

function emit(cfg: EncounterConfig, nightCfg: NightConfig, variant: string, outDir: string, inputsRoot: string) {
  const p = prepare(cfg, nightCfg, variant, inputsRoot);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'run.input'), p.inputText);
  copyFileSync(resolve(ROOT, current(nightCfg.save)), join(outDir, 'save-before.ini'));
  const env = [`CHOWDREN_SEED=${nightCfg.seed}`, 'CHOWDREN_STOP_FRAME=5', 'CHOWDREN_MAX_TICKS=30', 'CHOWDREN_MAX_TOTAL_TICKS=40000', ...watchEnv()];
  if (p.frameTimesText) {
    writeFileSync(join(outDir, 'frametimes.txt'), p.frameTimesText);
    env.push(`CHOWDREN_FRAME_TIMES=${join(outDir, 'frametimes.txt')}`, `CHOWDREN_FRAME_TIMES_FRAME=${OFFICE_FRAME}`);
  }
  writeFileSync(join(outDir, 'env'), `${env.join('\n')}\n`);
  console.log(`${outDir}: ${p.mapped.contacts.length} contacts (${p.mapped.stretched} stretched), ${p.office.rows.length} office rows, ` +
    `${p.office.sameTickEdges.length} same-tick edge sets, press file ${p.pressCount}/${p.pressCount}, ` +
    `${p.frameTimesText ? `${p.deltas.length} measured update times` : 'constant 60 Hz'}` +
    `${p.latency ? `, landing latency median ${p.latency.medianMs} ms over ${p.latency.raises} raises (p10 ${p.latency.p10Ms}, p90 ${p.latency.p90Ms})` : ''}, first office press on update ${p.mapped.queue[0][0]}`);
}

// ---------------------------------------------------------------- one comparison

export function compareOne(cfg: EncounterConfig, nightCfg: NightConfig, variant: string, runDir: string, inputsRoot: string,
  modelOptions: unknown) {
  const p = prepare(cfg, nightCfg, variant, inputsRoot);
  const inputPath = join(runDir, 'run.input');
  if (readFileSync(inputPath, 'utf8') !== p.inputText) throw new Error(`${inputPath} is not this night's emitted input`);
  const text = readFileSync(join(runDir, 'trace'), 'utf8');
  if (p.frameTimesText && !text.includes(`# frametimes ${p.deltas.length} updates of frame ${OFFICE_FRAME}\n`))
    throw new Error(`${runDir}/trace was not run on the measured clock (no # frametimes line)`);
  const customNight = nightCfg.customNight ? JSON.parse(readFileSync(resolve(ROOT, current(nightCfg.customNight)), 'utf8')) : null;
  const observe = (sim: Sim) => ({ mask: LEDGERS.mask.model(sim), unit: sim.blackout.active ? sim.blackout.unitId : null });
  const result = compareTrace(text, { night: nightCfg.night, seed: nightCfg.seed, frame: OFFICE_FRAME, frames: 40000, modelOptions,
    customNight, schedule: p.mapped.queue, contacts: modelContacts(p.mapped.contacts), observe, ...(p.clock ? { frameTimes: p.deltas } : {}) });
  const counters = counterSeries(text, OFFICE_FRAME);
  const overlaps = overlapSeries(text, OFFICE_FRAME);
  const maskWatch = watchSeries(text, OFFICE_FRAME);
  if (!counters || !overlaps || !maskWatch.size) throw new Error(`${runDir}/trace lacks the counter, overlap or mask watch`);
  const outcome = outcomes(result, { frame: OFFICE_FRAME, counters });
  const { rows, model } = result.traces;
  const officeUpdates = outcome.rebuilt.officeUpdates;
  const lastTick = p.mapped.queue.reduce((m, [tick]) => Math.max(m, tick), 0);
  const cum = cumulative(p.deltas, Math.max(officeUpdates, model.out.length, lastTick) + 2);
  const presses = maskPresses(p.mapped.queue);
  // rebuild: update u's end state; model: frame u + 1 is the state after the update the harness calls u
  // observe ran: one { mask, unit } per model frame.
  const observed = model.observed as ReturnType<typeof observe>[];
  const rebuiltState = (u: number) => {
    if (u < 0 || u >= officeUpdates) return null;
    const c = counters.series.get(u); const o = overlaps.series.get(u); const m = maskWatch.get(u);
    if (!c || !o || m === undefined) return null;
    return { maskValue: m, occupant: rebuiltOccupant(c, counters.names, o, overlaps.names) };
  };
  const CODE: Readonly<Record<string, string>> = { withbonnie: 'B', withchica: 'C', withfreddy: 'F', toybonnie: 'b', toychica: 'c', toyfreddy: 'f', mangle: 'M', bb: 'x' };
  const modelState = (u: number) => {
    const o = observed[u + 1];
    if (!o) return null;
    return { maskValue: o.mask, occupant: o.unit ? (CODE[o.unit] ?? '?') : null };
  };
  const modelEnd = cum[model.out.length - 1];
  const rebuiltEnd = cum[officeUpdates];
  const rebuiltWindows = windowCodes(presses, rebuiltState, cum, rebuiltEnd);
  // a streak occupant's arrival at `in office`: the first update of the overlap run it was seen in, less the mask-on
  const streakIndex = Object.fromEntries(STREAK.map(([name, letter]) => [letter, overlaps.names.indexOf(name)]));
  for (const w of rebuiltWindows) {
    const i = streakIndex[w.code];
    if (i === undefined || w.occupantTick === undefined) continue;
    let a = w.occupantTick;
    while (a > 0 && overlaps.series.get(a - 1)?.[i] === 1) a -= 1;
    w.arrivalMs = Number((cum[a] - cum[w.tick]).toFixed(1));
  }
  const modelWindows = windowCodes(presses, modelState, cum, modelEnd);
  // the model's own window rule (encounter-replay.mjs) closes on its own frame clock; windowCode is the same test
  if (windowCode(null, 1500, 1499) !== '?') throw new Error('encounter-replay windowCode changed its unplayed rule');
  const at = (tick: number | null | undefined) => (tick === null || tick === undefined ? null : Number(cum[tick].toFixed(1)));
  // A monitor contact sent from the office view whose finger is still down when the cameras come up, and the
  // cameras go down again before its release: g618 reads the held touch over the drop button once the flip is
  // fully up (v0 == 2), so a hold one update longer than the raise drops the monitor it raised.
  const viewing = counters.names.indexOf('viewing');
  const heldTapDrops: { tick: number, ms: number | null, downTick: number, upTick: number, holdUpdates: number, upAtTick: number }[] = [];
  for (const x of p.mapped.contacts) {
    if (x.control !== 'monitor' || (counters.series.get(x.downFrame - 1)?.[viewing] ?? 0) !== 0) continue;
    let upAt = -1;
    for (let u = x.downFrame; u <= x.upFrame; u += 1) {
      const v = counters.series.get(u)?.[viewing];
      if (v === undefined) break;
      if (Number(v) > 0 && upAt < 0) upAt = u;
      if (upAt >= 0 && v === 0) {
        heldTapDrops.push({ tick: u, ms: at(u), downTick: x.downFrame, upTick: x.upFrame, holdUpdates: x.upFrame - x.downFrame, upAtTick: upAt });
        break;
      }
    }
  }
  const runs = mismatchRuns(rows, model.out);
  const persistent = runs.runs.find((r) => !r.rejoined) ?? null;
  const ledger = compareLedger(maskWatch, observed.map((o) => o.mask), 'mask');
  const attacker = outcome.rebuilt.attacker ?? null;
  return {
    variant, clock: p.spec.clock, presses: p.spec.presses,
    landingLatency: p.latency,
    ...(p.responses ? { responses: p.responses } : {}),
    input: { officeRows: p.office.rows.length, officeRowsSha256: p.officeRowsSha256, stretchedContacts: p.mapped.stretched,
      sameTickEdgeSets: p.office.sameTickEdges.length, firstPressTick: p.mapped.queue[0][0], measuredUpdates: p.clock ? p.deltas.length : 0,
      frameTimesSha256: p.frameTimesText ? sha256(p.frameTimesText) : null, inputSha256: sha256(p.inputText),
      modelInputMode: 'explicit-contact-duration', modelContactsSha256: sha256(JSON.stringify(modelContacts(p.mapped.contacts))) },
    runtime: { traceSha256: result.runtime.traceSha256, drawTraceSha256: result.runtime.drawTraceSha256, officeUpdates },
    windows: {
      rebuilt: rebuiltWindows.map((w) => w.code).join(''),
      model: modelWindows.map((w) => w.code).join(''),
      rows: rebuiltWindows.map((w, k) => ({ index: w.index, tick: w.tick, ms: at(w.tick),
        rebuilt: w.code, ...(w.occupantTick !== undefined ? { rebuiltOccupantTick: w.occupantTick } : {}),
        ...(w.arrivalMs !== undefined ? { rebuiltArrivalMs: w.arrivalMs } : {}), ...(w.why ? { rebuiltWhy: w.why } : {}),
        model: modelWindows[k].code, ...(modelWindows[k].why ? { modelWhy: modelWindows[k].why } : {}) })),
    },
    outcome: {
      rebuilt: { result: outcome.rebuilt.result, reason: outcome.rebuilt.reason, officeUpdates, endMs: at(officeUpdates),
        ...(attacker?.setAtTick !== undefined ? { attackSetTick: attacker.setAtTick, attackSetMs: at(attacker.setAtTick) } : {}) },
      model: { result: outcome.model.result, reason: outcome.model.reason, frame: outcome.model.frame, endMs: at(outcome.model.frame) },
    },
    drawStream: { status: result.status, firstMismatch: result.alignments[1].firstMismatch,
      firstMismatchMs: at(result.alignments[1].firstMismatch?.tick), mismatchRuns: runs.runs.length, mismatchedUpdates: runs.mismatchedUpdates,
      firstPersistent: persistent ? { ...persistent, ms: at(persistent.start) } : null, compared: runs.compared },
    maskLedger: { compared: ledger.compared, mismatches: ledger.mismatches, paired: ledger.changes.paired, rebuiltChanges: ledger.changes.rebuilt,
      modelChanges: ledger.changes.model, offsets: ledger.changes.offsets },
    heldTapDrops,
  };
}

// ---------------------------------------------------------------- the record's own arithmetic

/** Everything check() recomputes from a result's rows: per night and variant, the scores and verdict fields. */
/** A variant's scores against the phone and between the host sides. */
interface VariantScores {
  rebuiltVsPhone: ReturnType<typeof scoreWindows>, modelVsPhone: ReturnType<typeof scoreWindows>;
  rebuiltVsModel: ReturnType<typeof compareSides>, rebuiltOutcome: ReturnType<typeof compareOutcome>;
  modelOutcome: ReturnType<typeof compareOutcome>;
}
/** A variant's record (compareOne). */
export type VariantRecord = ReturnType<typeof compareOne>;
/** A night of a result: the config's fields, the variants' records, the derived scores and the verdict. */
export interface NightRecord {
  name: string, run: unknown, night: number, seed: number, seedEvidence: unknown, winner: string, winnerSha256: string;
  originMs: number, presses: FileRef, trace: NightConfig['trace'], customNight: string | null;
  phone: NightConfig['phone'], modelRecord: { readonly windows?: string } | null, primaryVariant: string;
  variants: VariantRecord[], derived?: Record<string, unknown>, verdict?: string;
}
/** A recompile-phone-encounters-v1 result. */
export interface EncounterResult {
  schema: string, claimLevel: string, fidelity: string, comparedWith: string, question: string, status: string;
  method: { readonly [field: string]: unknown, readonly config: string, readonly configSha256: string, readonly modelOptions: string;
    readonly modelOptionsSha256: string, readonly binary: unknown, readonly responseExperiment?: ResponseExperimentSpec };
  provenance: object, nights: NightRecord[], limitations: string[];
  responseExperiment?: ReturnType<typeof deriveResponseExperiment>, evidenceId?: string;
}

export function derive(night: NightRecord) {
  const phone = night.phone.windows;
  const out: Record<string, unknown> = {};
  for (const v of night.variants) {
    out[v.variant] = {
      rebuiltVsPhone: scoreWindows(phone, v.windows.rebuilt),
      modelVsPhone: scoreWindows(phone, v.windows.model),
      rebuiltVsModel: compareSides(v.windows.rebuilt, v.windows.model),
      rebuiltOutcome: compareOutcome(night.phone.terminal, v.outcome.rebuilt),
      modelOutcome: compareOutcome(night.phone.terminal, v.outcome.model),
    };
  }
  if (night.modelRecord?.windows) out.modelRecordVsPhone = scoreWindows(phone, night.modelRecord.windows);
  // every host side at the primary replay's first disagreeing window: does the difference survive the press rule
  // and the clock, and do the rebuild and the model share it?
  // The primary variant is one of the night's variants.
  const first = (out[night.primaryVariant] as VariantScores).rebuiltVsPhone.firstDisagreement;
  if (first) {
    const at = (s: string) => s[first.window] ?? '?';
    out.atFirstDisagreement = { window: first.window, phone: phone[first.window],
      rebuilt: Object.fromEntries(night.variants.map((v) => [v.variant, at(v.windows.rebuilt)])),
      model: Object.fromEntries(night.variants.map((v) => [v.variant, at(v.windows.model)])),
      modelRecord: night.modelRecord?.windows ? at(night.modelRecord.windows) : null };
  }
  return out;
}

/** A predeclared per-contact experiment's conclusion, from rows and its hash-bound retained control. */
export function deriveResponseExperiment(result: EncounterResult, reference: EncounterResult) {
  // Called only for a result whose method names its experiment.
  const spec = result.method.responseExperiment as ResponseExperimentSpec;
  const night = result.nights.find((n) => n.name === spec.night);
  const control = night?.variants.find((v) => v.variant === spec.control);
  const retained = reference.nights.find((n) => n.name === spec.night)?.variants.find((v) => v.variant === spec.control);
  if (!night || !control || !retained || !Number.isInteger(spec.window) || spec.window < 0 || spec.window >= night.phone.windows.length)
    throw new Error('response experiment has no named control or phone window');
  const checks = {
    officeRowsHash: control.input.officeRowsSha256 === retained.input.officeRowsSha256,
    clockHash: control.input.frameTimesSha256 === retained.input.frameTimesSha256,
    drawHash: control.runtime.drawTraceSha256 === retained.runtime.drawTraceSha256,
    rebuiltWindows: control.windows.rebuilt === retained.windows.rebuilt,
    modelWindows: control.windows.model === retained.windows.model,
    outcomes: JSON.stringify(control.outcome) === JSON.stringify(retained.outcome),
  };
  const candidates = night.variants.filter((v) => v.variant !== spec.control).map((v) => ({
    variant: v.variant, rebuilt: v.windows.rebuilt[spec.window] ?? '?', model: v.windows.model[spec.window] ?? '?',
    coverage: v.responses?.coverage ?? null,
    firstDisagreement: ((night.derived as Record<string, unknown>)[v.variant] as VariantScores).rebuiltVsPhone.firstDisagreement,
    rebuiltOutcome: v.outcome.rebuilt.result, modelOutcome: v.outcome.model.result,
  }));
  if (!candidates.length) throw new Error('response experiment has no candidates');
  const phone = night.phone.windows[spec.window];
  const reproduced = Object.values(checks).every(Boolean);
  const status = !reproduced ? 'CONTROL_NOT_REPRODUCED' : phone === '?' || phone === '*' || candidates.some((v) => v.rebuilt === '?')
    ? 'UNKNOWN' : candidates.every((v) => v.rebuilt !== phone) ? 'TARGET_DISAGREEMENT_PERSISTS'
      : candidates.every((v) => v.rebuilt === phone) ? 'TARGET_CLEARS_IN_TESTED_VARIANTS' : 'VARIANT_SENSITIVE';
  return { schema: 'per-contact-response-experiment-v1', claimLevel: 'MODEL_ONLY', status,
    control: { reference: spec.reference, variant: spec.control, reproduced, checks },
    focus: { night: spec.night, window: spec.window, phone, controlRebuilt: control.windows.rebuilt[spec.window],
      controlModel: control.windows.model[spec.window] }, candidates,
    scope: 'Only these partial visual-response substitutions on the retained clock, seed, binding and model options. No general refutation of input timing and no new phone measurement.',
    open: ['response-to-input lag by action (drop and mask-off have a sheet-order delay)',
      'release acceptance and unknown contacts', 'runtime updates versus captured frames',
      'independently varied contact brackets; the early endpoint is one collective sensitivity', 'same-phase phone twin with a valid seed measurement'] };
}

/** A compact generated evidence record; the detailed result owns all response and encounter rows. */
export function responseEvidence(result: EncounterResult, resultPath: string, resultBytes: string) {
  if (!result.responseExperiment) throw new Error('an evidence record needs a response experiment');
  return { schema: 'evidence-record-v1', id: result.evidenceId, claimLevel: 'MODEL_ONLY', step: 'ROADMAP S2b',
    question: 'Does substituting individually observed native response proxies for the nightly median empty full-06 window 6?',
    result: { path: resultPath, sha256: sha256(resultBytes), evidenceId: result.evidenceId, status: result.responseExperiment.status },
    experiment: result.responseExperiment, config: { path: result.method.config, sha256: result.method.configSha256 },
    modelOptions: { path: result.method.modelOptions, sha256: result.method.modelOptionsSha256 },
    binary: result.method.binary, limitations: result.limitations };
}

function responseExperiment(result: EncounterResult) {
  // Called only for a result whose method names its experiment.
  const ref = (result.method.responseExperiment as ResponseExperimentSpec).reference;
  const bytes = readFileSync(resolve(ROOT, current(ref.path)));
  if (sha256(bytes) !== ref.sha256) throw new Error('response experiment control reference hash differs');
  return deriveResponseExperiment(result, JSON.parse(bytes.toString('utf8')));
}

/** The night's verdict from its primary variant: every phone-read window played and agreeing, and the same end. */
export function verdictOf(night: NightRecord, derived: Record<string, unknown>) {
  const primary = derived[night.primaryVariant] as VariantScores;
  const s = primary.rebuiltVsPhone;
  if (s.read === 0) return 'UNKNOWN';
  if (s.firstDisagreement === null && s.unplayed === 0 && primary.rebuiltOutcome.agrees !== false) return 'EQUIVALENT_ON_READ_WINDOWS';
  return 'DIVERGENT';
}

/** The comparison's status over its nights: equivalence is shown night by night, so no night shows none. */
export function overallStatus(verdicts: readonly (string | undefined)[]) {
  if (verdicts.length && verdicts.every((v) => v === 'EQUIVALENT_ON_READ_WINDOWS')) return 'EQUIVALENT_ON_READ_WINDOWS';
  return verdicts.some((v) => v === 'DIVERGENT') ? 'DIVERGENT' : 'UNKNOWN';
}

const idOf = (result: EncounterResult) => `recompile-phone-encounters-${sha256(JSON.stringify({ ...result, evidenceId: undefined })).slice(0, 16)}`;

/** Recompute every derived field and the id; throws on the first difference. */
export function check(result: EncounterResult) {
  if (result.schema !== SCHEMA) throw new Error(`schema must be ${SCHEMA}`);
  if (result.claimLevel !== 'MODEL_ONLY') throw new Error('a rebuild comparison is MODEL_ONLY');
  for (const night of result.nights) {
    for (const v of night.variants) {
      if (v.responses && JSON.stringify(responseCoverage(v.responses.rows)) !== JSON.stringify(v.responses.coverage))
        throw new Error(`${night.name}/${v.variant}: response coverage differs from rows`);
      if (v.windows.rows.map((r) => r.rebuilt).join('') !== v.windows.rebuilt) throw new Error(`${night.name}/${v.variant}: rebuilt rows`);
      if (v.windows.rows.map((r) => r.model).join('') !== v.windows.model) throw new Error(`${night.name}/${v.variant}: model rows`);
    }
    const derived = derive(night);
    if (JSON.stringify(derived) !== JSON.stringify(night.derived)) throw new Error(`${night.name}: derived scores differ from the rows`);
    if (verdictOf(night, derived) !== night.verdict) throw new Error(`${night.name}: verdict ${night.verdict} is not ${verdictOf(night, derived)}`);
  }
  const verdicts = result.nights.map((n) => n.verdict);
  const overall = overallStatus(verdicts);
  if (overall !== result.status) throw new Error(`status ${result.status} is not ${overall}`);
  if (result.method.responseExperiment && JSON.stringify(responseExperiment(result)) !== JSON.stringify(result.responseExperiment))
    throw new Error('response experiment conclusion differs from its rows or retained control');
  if (idOf(result) !== result.evidenceId) throw new Error(`evidenceId ${result.evidenceId} is not ${idOf(result)}`);
  return { nights: result.nights.length, status: overall, evidenceId: result.evidenceId };
}

// ---------------------------------------------------------------- compare, whole config

function compareAll(cfg: EncounterConfig, cfgPath: string, runsDir: string, inputsRoot: string) {
  const modelOptions = JSON.parse(readFileSync(resolve(ROOT, current(cfg.modelOptions)), 'utf8'));
  const nights: NightRecord[] = [];
  for (const nightCfg of cfg.nights) {
    const variants: VariantRecord[] = [];
    for (const variant of nightCfg.variants) {
      const runDir = join(runsDir, `${nightCfg.name}-${variant}`);
      variants.push(compareOne(cfg, nightCfg, variant, runDir, inputsRoot, modelOptions));
    }
    const night: NightRecord = {
      name: nightCfg.name, run: nightCfg.run, night: nightCfg.night, seed: nightCfg.seed, seedEvidence: nightCfg.seedEvidence,
      winner: nightCfg.winner, winnerSha256: sha256(readFileSync(resolve(ROOT, current(nightCfg.winner)))), originMs: nightCfg.originMs,
      presses: nightCfg.presses, trace: nightCfg.trace, customNight: nightCfg.customNight ?? null,
      phone: nightCfg.phone, modelRecord: nightCfg.modelRecord ?? null, primaryVariant: nightCfg.primaryVariant, variants,
    };
    night.derived = derive(night);
    night.verdict = verdictOf(night, night.derived);
    nights.push(night);
  }
  const verdicts = nights.map((n) => n.verdict);
  const result: EncounterResult = {
    schema: SCHEMA, claimLevel: 'MODEL_ONLY', fidelity: 'rebuilt-runtime',
    comparedWith: 'DEVICE_MEASURED phone reads and terminals, reused from the records each night names; no new phone run',
    question: 'On phone nights whose seed is established, replayed into the rebuilt runtime at that seed on the phone\'s own frame clock: does each mask window hold the same occupant as on the phone, and does the night end the same way?',
    status: overallStatus(verdicts),
    method: {
      config: relative(ROOT, cfgPath), configSha256: sha256(readFileSync(cfgPath)),
      variants: cfg.variants, windowMs: WINDOW_MS, watch: WATCH, officeFrame: OFFICE_FRAME,
      modelOptions: cfg.modelOptions, modelOptionsSha256: sha256(readFileSync(resolve(ROOT, current(cfg.modelOptions)))),
      binary: cfg.binary, harness: cfg.harness,
      ...(cfg.responseExperiment ? { responseExperiment: cfg.responseExperiment } : {}),
      windowRule: 'window k = the k-th schedule mask-on press; its code is the first occupant in its first 1500 ms of the update clock',
      scoring: 'agree = same code on a window both sides read ("*" never agrees on the character); hits = agreeing occupied phone windows; occupancyAgree = both empty or both occupied',
    },
    provenance: {
      toolSha256: sha256(readFileSync(new URL(import.meta.url))),
      patchSha256: sha256(readFileSync(new URL('../../../source/recompile/mmfparser-chowdren-mobile.patch', import.meta.url))),
      modelSourceSha256: Object.fromEntries(MODEL_SOURCES.map((path) => [path.slice(ROOT.length + 1), sha256(readFileSync(path))])),
    },
    nights,
    limitations: [
      'The rebuild and the model are host programs; neither result is a phone observation and neither promotes anything.',
      'Phone windows are the retained right-eyehole readers\' codes (B/C/F, "." empty); they cannot see Balloon Boy or the vent Toys.',
      'Visible responses are not input dispatch: the press-to-update rule and action-specific response lag remain assumptions. Each variant names its mapping.',
      'Frame traces time the displayed frames; the runtime\'s loops, its catch-up rule and its integer-ms timer are inferred from them.',
      'The harness raises one new-touch trigger per update; same-tick edges are counted per replay.',
      ...(cfg.responseExperiment ? [
        'Native responses reuse the shared stroke classifier on retained captures; two positive prior frames and two target frames are required. Unsupported contacts remain UNKNOWN and retain the median assumption.',
        'Response classification is exploratory. A target may settle after another control was sent; temporal association alone does not prove which input caused a transition.',
        'The same response-proxy delay is applied to each observed contact release to preserve its scheduled duration; release acceptance is not measured.',
        'The first changed capture can lag game acceptance, including the sourced one-update drop/mask-off sheet-order delay. No response-lag correction is applied.',
        'The early sensitivity moves all supported contacts to one bracket endpoint; it is not an exhaustive or adversarial search over independently varying landings.',
      ] : []),
    ],
  };
  if (cfg.responseExperiment) result.responseExperiment = responseExperiment(result);
  result.evidenceId = idOf(result);
  return result;
}

// ---------------------------------------------------------------- CLI

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, ...rest] = process.argv.slice(2);
  const args: Record<string, string> = {};
  if (mode === 'check') {
    const path = rest[0];
    if (!path) throw new Error('usage: check RESULT.json');
    const r = check(JSON.parse(readFileSync(path, 'utf8')));
    console.log(`${r.evidenceId}: ${r.status} over ${r.nights} nights; arithmetic rechecked`);
    process.exit(0);
  }
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--config', '--night', '--variant', '--out-dir', '--runs', '--out', '--inputs-root', '--evidence'].includes(rest[i]) || !rest[i + 1])
      throw new Error('see usage at top of file');
    args[rest[i].slice(2)] = rest[i + 1];
  }
  const cfgPath = resolve(args.config ?? join(ROOT, 'packages/propose/bin/recompile/phone-encounter-nights.json'));
  const cfg = loadConfig(cfgPath);
  const inputsRoot = resolve(args['inputs-root'] ?? ROOT);
  if (mode === 'emit') {
    const nightCfg = cfg.nights.find((n) => n.name === args.night);
    if (!nightCfg || !args.variant || !args['out-dir']) throw new Error('emit needs --night (a configured name), --variant and --out-dir');
    if (!nightCfg.variants.includes(args.variant)) throw new Error(`${args.night} does not run the ${args.variant} variant`);
    emit(cfg, nightCfg, args.variant, resolve(args['out-dir']), inputsRoot);
  } else if (mode === 'compare') {
    if (!args.runs || !args.out) throw new Error('compare needs --runs and --out');
    if (!args.out.endsWith('.json')) throw new Error('--out must be a .json path');
    if (args.evidence && (!cfg.responseExperiment || !args.evidence.endsWith('.json')))
      throw new Error('--evidence needs a response experiment and a .json path');
    const result = compareAll(cfg, cfgPath, resolve(args.runs), inputsRoot);
    check(result);
    const resultBytes = `${JSON.stringify(result, null, 1)}\n`;
    writeFileSync(args.out, resultBytes);
    if (args.evidence) writeFileSync(args.evidence, `${JSON.stringify(responseEvidence(result,
      relative(ROOT, resolve(args.out)), resultBytes), null, 1)}\n`);
    console.log(`${result.evidenceId}: ${result.status} (MODEL_ONLY rebuild vs retained phone reads)`);
    for (const n of result.nights) {
      console.log(`  ${n.name} seed ${n.seed}: ${n.verdict}; phone ${n.phone.windows.slice(0, 42)} (${n.phone.terminal.result})`);
      for (const v of n.variants) {
        // check() just derived every variant's scores.
        const d = (n.derived as Record<string, unknown>)[v.variant] as VariantScores;
        console.log(`    ${v.variant.padEnd(14)} rebuilt ${v.windows.rebuilt.slice(0, 42)} ${v.outcome.rebuilt.result}${v.outcome.rebuilt.reason ? ` (${v.outcome.rebuilt.reason})` : ''} @${v.outcome.rebuilt.endMs} ms` +
          ` (outcome ${d.rebuiltOutcome.agrees === null ? 'UNKNOWN' : d.rebuiltOutcome.agrees ? 'agrees' : 'differs'}${d.rebuiltOutcome.deltaMs !== null ? `, ${d.rebuiltOutcome.deltaMs} ms` : ''}); ` +
          `agree ${d.rebuiltVsPhone.agree}/${d.rebuiltVsPhone.compared} (+${d.rebuiltVsPhone.unplayed} unplayed), first ${JSON.stringify(d.rebuiltVsPhone.firstDisagreement)}`);
        console.log(`    ${''.padEnd(14)} model   ${v.windows.model.slice(0, 42)} ${v.outcome.model.result}${v.outcome.model.reason ? ` (${v.outcome.model.reason})` : ''} @${v.outcome.model.endMs} ms; ` +
          `agree ${d.modelVsPhone.agree}/${d.modelVsPhone.compared}; rebuilt vs model ${d.rebuiltVsModel.agree}/${d.rebuiltVsModel.compared}; draw split ${v.drawStream.firstPersistent ? `tick ${v.drawStream.firstPersistent.start}` : 'none'}`);
      }
    }
  } else throw new Error('mode must be emit, compare or check');
}
