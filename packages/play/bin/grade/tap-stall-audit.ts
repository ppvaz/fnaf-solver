// Audit every scheduled contact of a device run against the Companion's
// native frame trace: was the button there when the contact arrived, did the
// effect follow, and did a frame stall longer than the contact cover it.
//
// WHY IT EXISTS
//
// night5-strokes3 (2026-09-12) recorded two CORRECTED cycle gates and the
// standing reading was "a lost MASK press, about one cycle in eight, a
// Bernoulli rate no estimator fixes". The retained frame trace said otherwise
// once it was read against the schedule: in both cycles a 33 ms MONITOR tap
// (the camdrop's at +14000 in one cycle, the raise at +10100 in the other)
// fell inside a capture-frame interval longer than 33 ms and never registered,
// so the mask tap at +14449 hit the raised monitor bar and lowered it instead.
// Every mask tap sent with the button present landed.
//
// Whether a stall COVERED those two taps depends on the clock at the tens-of-
// milliseconds level, and the gate reads only bracket that clock to 180 ms;
// the tool therefore reports it as ambiguous there. What holds at both ends of
// the bracket: both lost contacts were 33 ms monitor taps, and the mask taps
// that followed arrived with the monitor up. The dump
// makes the mechanism legible: the monitor flip is level-triggered with a
// one-shot latch (g257 raises on `Multiple Touch` over `white button` and
// sets `flip panel button` value 1; g258 clears it when no touch is on `drop
// button`; g614 lowers via `MouseOnObject`), so a contact that fits between
// two event-loop ticks is invisible and a longer hold flips exactly once.
//
// The root is a floor equal to its own poll: `MIN_CONTACT_MS` and
// `FUSION_POLL_MS` are both 33 in recipe.ts, which is mistake-register #7
// one level down -- a contact of exactly one poll period has zero slack.
//
// WHAT IT IS NOT
//
// actuation-frame-metric.ts reads the trace alone (state coverage, no
// schedule). input-frame-align.py aligns a Perfetto input trace to frames, and
// this handset advertises no `android.input.inputevent` source, so that tool
// cannot run here. This one aligns the SCHEDULE -- the compiled blocks in the
// run's own request.json, on the executor's wall clock -- to the frames,
// through a clock BRACKET derived from the gate samples (see clockBracket). It measures nothing about dispatch; a contact it calls MISSING was
// scheduled and had no visible effect, which is all the trace can say.
//
// The intervals are those of the helper's capture stream, not the game loop.
// The inference that a covered contact was swallowed rests on the coincidence
// above; SurfaceFlinger latency (grade-run's SF_LAYER step) would confirm it
// from the game's side.
//
// Exit 3 when a contact is MISSING or arrived with its button absent: that is
// information about the run, not an instrument failure, and grade-run.sh's
// step() reads it that way.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isList, isRecord } from '@sixam/kernel';
import { buttonStrokeState } from '@sixam/play';

/** One row of a fnaf2-frame-trace-v3 stroke trace. */
export interface StrokeRow {
  readonly seq: number, readonly imageMs: number, readonly elapsedMs: number, readonly screenIdentity: number,
  readonly maskButtonDownstroke: number, readonly monitorButtonDownstroke: number, readonly hallLuma: number | null;
}
interface Proof { readonly signature: string, readonly windowMs: number }
/** What a contact must do to the strokes: a toggle proven by signatures, or the hall flash lit. */
type Expectation =
  | { readonly name: string, readonly proofs: readonly Proof[], readonly inverse: string, readonly hall?: undefined }
  | { readonly name: 'hall-lit', readonly hall: true, readonly proofs: readonly Proof[], readonly inverse: null, readonly windowMs: number };
/** One row of a compiled plan, as request.json carries it. */
export interface PlanAction {
  readonly id: string, readonly kind: string, readonly compound?: string, readonly leadMs?: number, readonly control?: string,
  readonly atMs: number, readonly durationMs: number, readonly targetMonitorUp?: unknown, readonly targetMaskOn?: unknown;
}
/** A compiled plan, as request.json's bundle.plans carry it. */
export interface Plan {
  readonly night?: number;
  readonly timing: { readonly periodMs: number, readonly loopStartMs: number, readonly stopAtMs: number, readonly idleUntilMs?: number,
    readonly observeUntilMs?: number };
  readonly cycles: Readonly<Record<string, { readonly blocks: readonly { readonly actions: readonly PlanAction[] }[] }>>;
}
/** A scheduled contact on the night timeline. */
interface Contact {
  readonly id: string, readonly cycle: string, readonly iteration: number, readonly kind: string, readonly control: string | undefined,
  readonly atMs: number, readonly durationMs: number, readonly expect: Expectation | null;
}
type HallContact = Contact & { readonly expect: Extract<Expectation, { hall: true }> };
/** An events.jsonl row, as the clock bracket reads gate samples off it. */
export interface RunEvent {
  readonly type?: string, readonly at?: number;
  readonly sample?: { readonly visualCaptureAt?: number, readonly ageUs?: number | string };
  readonly reads?: readonly { readonly startedAt?: number, readonly finishedAt?: number }[];
}
/** The helper clock against the executor's, as a bracket. */
interface Bracket { readonly earlyOffsetMs: number, readonly lateOffsetMs: number, readonly bracketMs: number }
/** A contact graded at one end of the bracket. */
type Grade =
  | { readonly status: 'OUTSIDE_TRACE' }
  | { readonly status: 'UNGRADED' | 'HALL' | 'UNREADABLE' | 'ALREADY' | 'INVERTED' | 'MISSING' | 'LANDED', readonly startAt: number,
    readonly preSignature: string | null, readonly maxGapMs: number, readonly coveredByStall: boolean, readonly buttonAbsent: boolean,
    readonly landedAfterMs: number | null };
export type InTrace = Exclude<Grade, { status: 'OUTSIDE_TRACE' }>;
/** A contact as the audit reports it. */
export type Graded = Contact & {
  readonly status: string, readonly buttonAbsent?: boolean, readonly coveredByStall?: boolean, readonly buttonAbsentAmbiguous?: boolean,
  readonly coveredAmbiguous?: boolean, readonly maxGapMs?: number, readonly atEarly?: Grade, readonly atLate?: Grade,
  readonly landedAfterMs?: number | null, readonly officeFrames?: number, readonly startAt?: number;
};
/** A kernel touch contact (getevent clock, ms). */
interface TouchEdge { readonly pressMs: number, readonly releaseMs: number }
/** A press edge matched to a scheduled contact, with its effect's latency. */
interface LatencyMatch {
  readonly id: string, readonly atMs: number, readonly control: string | undefined, readonly name: string, readonly pressMs: number,
  readonly releaseMs: number, readonly holdMs: number, readonly pressToEffectMs: number | null, readonly releaseToEffectMs: number | null;
}
interface Stats { readonly n: number, readonly min: number, readonly median: number, readonly max: number }
/** The press edges read under one clock hypothesis. */
interface Hypothesis {
  readonly matched: number, readonly withEffect: number,
  readonly perControl: Readonly<Record<string, { readonly pressToEffect: Stats | null, readonly releaseToEffect: Stats | null }>>;
  readonly matches: readonly LatencyMatch[];
}
type Report = ReturnType<typeof audit>;

export const SCHEMA = 'device-tap-stall-audit-v1';

/** Contact lengths priced in every report, alongside the plan's own. */
export const REFERENCE_CONTACTS_MS = Object.freeze([33, 50, 67, 100]);

/** Contacts at or below this are the tap class the exposure table counts. */
export const TAP_CLASS_MAX_MS = 100;

/**
 * Bounds on the latency from a scheduled contact's start to the first
 * captured frame showing its effect, used to turn the SCHEDULE into a clock
 * anchor (see scheduleAnchor). Stated, not measured: USB HID report (~8 ms)
 * + Android input delivery (10-20 ms) + up to one Fusion poll (FUSION_POLL_MS
 * 33) + up to one render frame (16.7 ms) + up to one capture frame (16.7 ms)
 * -- about 30 ms at best and about 110 ms at worst. hid-transition-probe.mjs
 * is the instrument that would measure it; until then these are the
 * assumption every clock-dependent finding here rests on, and they are
 * printed with the report.
 */
export const ACTUATION_LATENCY_BOUNDS_MS = Object.freeze([30, 110]);

/** Only contacts this short anchor the schedule; longer holds occlude the strokes. */
export const ANCHOR_CONTACT_MAX_MS = 50;

/**
 * The hall ROI: the provisional Foxy hall envelope the Companion's watchlist
 * used to carry (PixelWatch FOXY_HALL_X/Y/WIDTH/HEIGHT until 2026-09-27, when
 * the phone stopped reading it -- it had no live reader). This audit reads
 * retained fnaf2-frame-trace-v3 files, which carry no foxy_hall reducer, only
 * the 20x9 grid_hex -- the old-evidence use CLAUDE.md keeps -- so the hall is
 * read from the grid cells that rectangle covers, and ONLY on frames whose
 * strokes read office: hall-flash-metric.mjs was retracted on 2026-09-12 for
 * scoring the camera-monitor screen, which is what reading this rectangle
 * without that gate does. This constant is now the rectangle's only home.
 */
export const HALL_ROI = Object.freeze({ nativeWidth: 2400, nativeHeight: 1080,
  x: 1650, y: 300, width: 450, height: 400, gridCols: 20, gridRows: 9 });

/** Lit hall frames read ~45 on this grid, dark ones 0-3 (strokes3, contact200a). */
export const HALL_LIT_MIN = 20;

/** A 33 ms flash shows for two frames starting 20-40 ms after the tap. */
export const HALL_WINDOW_MS = 160;

/** Grid cells (row-major indices) the hall rectangle covers. */
export function hallCells(roi = HALL_ROI) {
  const cellW = roi.nativeWidth / roi.gridCols;
  const cellH = roi.nativeHeight / roi.gridRows;
  const cells: number[] = [];
  for (let row = 0; row < roi.gridRows; row += 1)
    for (let col = 0; col < roi.gridCols; col += 1)
      if (col * cellW < roi.x + roi.width && (col + 1) * cellW > roi.x &&
          row * cellH < roi.y + roi.height && (row + 1) * cellH > roi.y)
        cells.push(row * roi.gridCols + col);
  return cells;
}

const HALL_CELLS = hallCells();
const cellLuma = (rgb: number) => ((77 * ((rgb >> 16) & 255) + 150 * ((rgb >> 8) & 255) + 29 * (rgb & 255)) >> 8);

/** Mean luma of the hall cells of one grid_hex field, or null when absent. */
export function hallLumaOf(gridHex: unknown) {
  if (typeof gridHex !== 'string' || gridHex.length < HALL_ROI.gridCols * HALL_ROI.gridRows * 6) return null;
  let sum = 0;
  for (const cell of HALL_CELLS) sum += cellLuma(parseInt(gridHex.slice(cell * 6, cell * 6 + 6), 16));
  return sum / HALL_CELLS.length;
}

/**
 * How long after a contact its effect must show in the strokes before it is
 * MISSING. Monitor lowering is fully visible at ~382.5 ms (native trace,
 * 2026-09-11); the mask-off animation is ~220 ms; raising and masking are
 * visible within two frames of the press on strokes3.
 */
export const EFFECT_WINDOW_MS = Object.freeze({
  'monitor-up': 300,
  'mask-on': 300,
  'office-after-monitor-down': 600,
  'office-after-mask-off': 500,
});

const fail: (message: string) => never = message => { throw new TypeError(`tap-stall-audit: ${message}`); };
const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** request.json's bundle plans, checked as far as the audit reads them: the timing and every action's time and kind. */
export function requestPlans(request: unknown): Plan[] {
  const bundle = isRecord(request) ? request.bundle : undefined;
  const plans = isRecord(bundle) ? bundle.plans : undefined;
  if (plans === undefined) return [];
  if (!isList(plans)) fail('request.json bundle.plans is not a list');
  plans.forEach((plan, p) => {
    const timing = isRecord(plan) ? plan.timing : undefined;
    if (!isRecord(plan) || !isRecord(timing) || ![timing.periodMs, timing.loopStartMs, timing.stopAtMs].every(finiteNumber) ||
        (plan.night !== undefined && !Number.isInteger(plan.night)) || !isRecord(plan.cycles))
      fail(`request.json plan ${p} has no timing {periodMs, loopStartMs, stopAtMs} or no cycles`);
    for (const [name, cycle] of Object.entries(plan.cycles)) {
      const blocks = isRecord(cycle) ? cycle.blocks : undefined;
      if (!isList(blocks)) fail(`request.json plan ${p} cycle ${name} has no blocks`);
      for (const block of blocks) {
        const actions = isRecord(block) ? block.actions : undefined;
        if (!isList(actions) || !actions.every((a) => isRecord(a) && typeof a.id === 'string' && typeof a.kind === 'string' &&
            finiteNumber(a.atMs) && finiteNumber(a.durationMs)))
          fail(`request.json plan ${p} cycle ${name} has an action without {id, kind, atMs, durationMs}`);
      }
    }
  });
  return plans as unknown as Plan[];
}

/**
 * Rows of a `fnaf2-frame-trace-v3` TSV with the two native stroke scores.
 * phase-reconstruct's parser keeps only identity; this one keeps what the
 * button classifier needs, on the same helper-monotonic millisecond clock.
 */
export function parseStrokeTrace(text: string) {
  const rows: StrokeRow[] = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#') || line.startsWith('seq')) continue;
    const field = line.split('\t');
    if (field.length < 11) continue;
    rows.push({
      seq: Number(field[0]),
      imageMs: Number(field[1]) / 1e6,
      elapsedMs: Number(field[2]) / 1e6,
      screenIdentity: Number(field[6]),
      maskButtonDownstroke: Number(field[9]),
      monitorButtonDownstroke: Number(field[10]),
      hallLuma: hallLumaOf(field[11]?.trim()),
    });
  }
  return rows;
}

/**
 * What a contact is expected to do to the stroke signature, if readable.
 *
 * Each expectation lists the signatures that PROVE it, each with its own
 * window, and the signature that would prove the toggle was INVERTED instead.
 * Turning a toggle ON is proven by its own signature. Turning one OFF is
 * proven by the office reading, or -- because a held button's pressed sprite
 * blanks both strokes until release and the office can be on screen for under
 * 100 ms between a camdrop and a 200 ms mask hold -- by the NEXT toggle's ON
 * signature inside a longer window: a mask that came on 900 ms after the
 * camdrop proves the monitor came down in time, while strokes3's lost camdrop
 * left the mask off for 1400 ms. night5-contact200a graded a working camdrop
 * MISSING before this (its office frames read blank; the mask came on at
 * +804 ms as in every other cycle).
 *
 * Every window is stretched by the contact's own length: the game acts on the
 * press (the mask and monitor luma move at the same latency for 33 and 200 ms
 * contacts), but the strokes are hidden until release.
 */
function expectation(action: PlanAction): Expectation | null {
  const d = action.durationMs;
  const proof = (signature: string, windowMs: number) => ({ signature, windowMs: windowMs + d });
  if (action.kind === 'compound' && action.compound === 'camdrop')
    return { name: 'monitor-down', proofs: [proof('office', 600), proof('mask-on', 900)], inverse: 'monitor-up' };
  if (action.control === 'monitor' && typeof action.targetMonitorUp === 'boolean')
    return action.targetMonitorUp
      ? { name: 'monitor-up', proofs: [proof('monitor-up', 300)], inverse: 'office' }
      : { name: 'monitor-down', proofs: [proof('office', 600), proof('mask-on', 900)], inverse: 'monitor-up' };
  if (action.control === 'mask' && typeof action.targetMaskOn === 'boolean')
    return action.targetMaskOn
      ? { name: 'mask-on', proofs: [proof('mask-on', 300)], inverse: 'office' }
      : { name: 'mask-off', proofs: [proof('office', 500), proof('monitor-up', 1200)], inverse: 'mask-on' };
  // The hall flash: proven by the hall cells lighting while the strokes read
  // office. The engine refuses the flash during the mask-off animation
  // (plant-model.js maskFullyOff: "the post-mask flash lockout IS that
  // animation"), so DARK is a refused or lost flash -- and, per the dump, an
  // upper bound: the light stays on during hall movement, which renders dark.
  if (action.control === 'hallLight')
    return { name: 'hall-lit', hall: true, proofs: [], inverse: null, windowMs: HALL_WINDOW_MS + d };
  return null;
}

const provesAlready = (expect: Expectation, signature: string | null) => expect.proofs.some(p => p.signature === signature);

/**
 * Every physical contact the plan schedules, on the night timeline, expanded
 * the way device-local-executor.js expands blocks: the opening once, every
 * other cycle from max(loopStartMs, idleUntilMs) every periodMs until
 * stopAtMs. A camdrop's contact is its monitor tap, `leadMs` after the row.
 */
export function expandContacts(plan: Plan) {
  if (!plan?.timing || !plan?.cycles) fail('plan has no timing/cycles');
  const { periodMs, loopStartMs, stopAtMs, idleUntilMs = 0 } = plan.timing;
  const cycles = Object.entries(plan.cycles);
  const opening = cycles.filter(([name]) => name === 'opening');
  const steady = cycles.filter(([name]) => name !== 'opening' && name !== 'finish');
  if (!opening.length) fail('plan has no opening cycle');
  const contacts: Contact[] = [];
  const push = (cycleName: string, action: PlanAction, baseMs: number, iteration: number) => {
    const lead = action.kind === 'compound' ? (action.leadMs ?? 0) : 0;
    const control = action.kind === 'compound' && action.compound === 'camdrop' ? 'monitor' : action.control;
    contacts.push({
      id: action.id, cycle: cycleName, iteration, kind: action.kind, control,
      atMs: baseMs + action.atMs + lead, durationMs: action.durationMs,
      expect: expectation(action),
    });
  };
  for (const [name, cycle] of opening)
    for (const block of cycle.blocks) for (const action of block.actions) push(name, action, 0, 0);
  const startMs = Math.max(loopStartMs, idleUntilMs);
  let iteration = 0;
  for (let base = startMs; base < stopAtMs; base += periodMs, iteration += 1)
    for (const [name, cycle] of steady)
      for (const block of cycle.blocks)
        for (const action of block.actions)
          if (base + action.atMs < stopAtMs) push(name, action, base, iteration);
  return contacts.sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id));
}

const signatureOf = (row: StrokeRow) => buttonStrokeState(row).signature;

/** Fraction of the trace's span on which a `contactMs` contact fits inside one interval. */
export function exposure(intervalsMs: readonly number[], spanMs: number, contactMs: number) {
  if (!(spanMs > 0)) return 0;
  let covered = 0;
  for (const gap of intervalsMs) covered += Math.max(0, gap - contactMs);
  return covered / spanMs;
}

/**
 * The helper clock against the executor's, as a BRACKET.
 *
 * A gate read carries `visualCaptureAt` (helper ms) and `ageUs`, how old that
 * frame was when the helper answered, plus the read's `startedAt` and
 * `finishedAt` on the wall clock. The capture instant lies between
 * `startedAt - age` (if the helper answered the moment the request arrived)
 * and `finishedAt - age` (if the answer took no time to return). On strokes3
 * the reads take 139-237 ms, so the two anchors sit 180 ms apart, and neither
 * end is physical: the early one has mask presses take effect 2-16 ms after
 * the contact (a touch cannot be rendered in 2 ms) and the late one has them
 * take 135-196 ms. phase-reconstruct.ts's `helperClockOffset` is the late
 * end alone; for a 33 ms contact that is not a clock, it is a range.
 *
 * So every contact is graded at BOTH ends and a finding is asserted only when
 * both ends agree. Anything else is AMBIGUOUS and says so. The exposure table
 * needs no clock at all: it reads the intervals.
 */
export function clockBracket(events: readonly RunEvent[]) {
  const early: number[] = [];
  const late: number[] = [];
  for (const event of events) {
    const sample = event?.sample;
    const read = event?.reads?.at?.(-1);
    if (!sample?.visualCaptureAt || !sample?.ageUs || !read?.finishedAt || !read?.startedAt) continue;
    const ageMs = Number(sample.ageUs) / 1000;
    early.push(read.startedAt - ageMs - sample.visualCaptureAt);
    late.push(read.finishedAt - ageMs - sample.visualCaptureAt);
  }
  if (!early.length) return null;
  const min = (values: number[]) => Math.min(...values);
  return { earlyOffsetMs: min(early), lateOffsetMs: min(late),
    bracketMs: min(late) - min(early), samples: early.length };
}

/**
 * The schedule as a clock. Every contact's start is known EXACTLY on the wall
 * clock (the stream has no drift: phase-reconstruct finds every gate on its
 * planned offset), and a fast effect -- the mask-on or monitor-up signature
 * appearing -- follows it by the actuation latency. So for each such contact,
 * `startAt - E` (E the helper time of the first frame showing the effect)
 * differs from the true offset by exactly that latency, and the median over
 * the run plus ACTUATION_LATENCY_BOUNDS_MS brackets the offset far tighter
 * than the gate reads do (strokes3: ~80 ms against 180). The gate bracket
 * still bounds the search window and the result.
 */
export function scheduleAnchor(contacts: readonly Contact[], trace: readonly StrokeRow[], released: number, gate: Bracket,
  latencyBoundsMs: readonly number[]) {
  const differences: number[] = [];
  for (const contact of contacts) {
    const wanted = contact.expect?.name;
    if (wanted !== 'mask-on' && wanted !== 'monitor-up') continue;
    const windowMs = (contact.expect as Expectation).proofs[0].windowMs;   // named, so expected
    // A held button's pressed sprite blanks the strokes until release, so a
    // long contact's signature transition tracks the RELEASE, not the press.
    if (contact.durationMs > ANCHOR_CONTACT_MAX_MS) continue;
    const startAt = released + contact.atMs;
    const fromImage = startAt - gate.lateOffsetMs;
    const toImage = startAt - gate.earlyOffsetMs + windowMs;
    for (let index = 1; index < trace.length; index += 1) {
      const image = trace[index].imageMs;
      if (image < fromImage) continue;
      if (image > toImage) break;
      if (signatureOf(trace[index]) === wanted && signatureOf(trace[index - 1]) !== wanted) {
        differences.push(startAt - image);
        break;
      }
    }
  }
  if (!differences.length) return null;
  differences.sort((a, b) => a - b);
  const median = differences[differences.length >> 1];
  const [minLatency, maxLatency] = latencyBoundsMs;
  const early = Math.max(median + minLatency, gate.earlyOffsetMs);
  const late = Math.min(median + maxLatency, gate.lateOffsetMs);
  if (early > late) return null; // the stated latency bounds contradict the gate reads: say nothing
  return { medianDifferenceMs: median, transitions: differences.length, latencyBoundsMs,
    earlyOffsetMs: early, lateOffsetMs: late, bracketMs: late - early };
}

function gradeContacts(contacts: readonly Contact[], trace: readonly StrokeRow[], offsetMs: number, released: number): Grade[] {
  const frames = trace.map(row => ({ ...row, wallMs: row.imageMs + offsetMs }));
  const intervals = frames.slice(1).map((row, index) => row.wallMs - frames[index].wallMs);
  const indexAtOrBefore = (wallMs: number) => {
    let low = 0, high = frames.length - 1, found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (frames[mid].wallMs <= wallMs) { found = mid; low = mid + 1; } else high = mid - 1;
    }
    return found;
  };
  return contacts.map(contact => {
    const startAt = released + contact.atMs;
    const endAt = startAt + contact.durationMs;
    const before = indexAtOrBefore(startAt);
    // trace has two frames at least (audit checks).
    if (before < 0 || endAt > (frames.at(-1) as (typeof frames)[number]).wallMs) return { status: 'OUTSIDE_TRACE' };
    const preSignature = signatureOf(frames[before]);
    let maxGapMs = 0;
    for (let index = before; index < frames.length - 1 && frames[index].wallMs < endAt; index += 1)
      maxGapMs = Math.max(maxGapMs, intervals[index]);
    const coveredByStall = maxGapMs > contact.durationMs;
    // The button the contact needs is absent in exactly one signature each.
    const buttonAbsent = (contact.control === 'mask' && preSignature === 'monitor-up') ||
      (contact.control === 'monitor' && preSignature === 'mask-on');
    const firstAfter = (wanted: string | null, windowMs: number) => {
      for (let index = before + 1; index < frames.length &&
           frames[index].wallMs <= startAt + windowMs; index += 1)
        if (signatureOf(frames[index]) === wanted) return Math.round(frames[index].wallMs - startAt);
      return null;
    };
    let status: InTrace['status'] = 'UNGRADED';
    let landedAfterMs = null as number | null;
    if (contact.expect?.hall) status = 'HALL'; // graded once on the midpoint clock, see gradeHall
    else if (contact.expect) {
      const expect = contact.expect;
      const longest = Math.max(...expect.proofs.map(p => p.windowMs));
      if (preSignature === null) status = 'UNREADABLE';
      else if (provesAlready(expect, preSignature)) {
        // A press on a toggle already in the wanted state INVERTS it:
        // strokes3's cycle-2 camdrop found the monitor down (the raise had
        // been swallowed) and raised it.
        landedAfterMs = firstAfter(expect.inverse, longest);
        status = landedAfterMs === null ? 'ALREADY' : 'INVERTED';
      } else {
        const hits = expect.proofs.map(p => firstAfter(p.signature, p.windowMs)).filter(ms => ms !== null);
        landedAfterMs = hits.length ? Math.min(...hits) : null;
        status = landedAfterMs === null ? 'MISSING' : 'LANDED';
      }
    }
    return { startAt, preSignature, maxGapMs: Math.round(maxGapMs * 10) / 10,
      coveredByStall, buttonAbsent, status, landedAfterMs };
  });
}

/**
 * The hall flash is graded ONCE, on the bracket's midpoint, with the window
 * widened by the half-bracket: the flash is two frames (33 ms) and the hall
 * tap sits ~17 ms after the office appears, so grading it at each end of an
 * 80 ms bracket puts the pre-frame on the mask-off animation at one end and
 * the flash outside the window at the other, and every tap reads AMBIGUOUS.
 * The screen gate is on the frames themselves: a lit frame counts only if its
 * strokes read office, and a window with no office frame at all is UNREADABLE.
 */
function gradeHall(contact: HallContact, trace: readonly StrokeRow[], offsetMs: number, halfBracketMs: number, released: number) {
  const startAt = released + contact.atMs;
  const from = startAt - halfBracketMs;
  const to = startAt + contact.expect.windowMs + halfBracketMs;
  let office = 0;
  let litAfterMs = null as number | null;
  for (const row of trace) {
    const wallMs = row.imageMs + offsetMs;
    if (wallMs < from) continue;
    if (wallMs > to) break;
    if (signatureOf(row) !== 'office' || row.hallLuma === null) continue;
    office += 1;
    if (row.hallLuma >= HALL_LIT_MIN) { litAfterMs = Math.round(wallMs - startAt); break; }
  }
  const status = !office ? 'UNREADABLE' : litAfterMs === null ? 'DARK' : 'LIT';
  return { startAt, status, landedAfterMs: litAfterMs, officeFrames: office };
}

/**
 * `adb shell getevent -lt` as night-run.sh records it beside the frame
 * trace (artifacts/runs/<run>/input-events.txt): `# started ...` header,
 * `add device N: /dev/input/eventX` + `  name: "..."` blocks, then rows
 * `[  sec.usec] /dev/input/eventX: EV_KEY BTN_TOUCH DOWN` (with -l names),
 * and a `# stopped ...` trailer. The virtual touch device the campaign
 * uses is resolved by NAME from its add-device block, never by number. When
 * the night reuses the already-attached menu HID, no "FNAF Timed Touch" node
 * appears: the schedule's reports stay on "FNAF Campaign Menu".
 */
export const VIRTUAL_TOUCH_DEVICE_NAME = /FNAF Timed Touch/i;
const REUSED_MENU_TOUCH_DEVICE_NAME = /FNAF Campaign Menu/i;

export function parseInputEvents(text: string) {
  const devices: Record<string, string> = {};
  const events: { ms: number, node: string, type: string, code: string, value: string }[] = [];
  let pendingNode = null as string | null;
  for (const line of text.split('\n')) {
    const add = line.match(/^add device \d+: (\/dev\/input\/event\d+)/);
    if (add) { pendingNode = add[1]; devices[pendingNode] = devices[pendingNode] ?? ''; continue; }
    const name = line.match(/^\s+name:\s+"([^"]*)"/);
    if (name && pendingNode) { devices[pendingNode] = name[1]; continue; }
    const row = line.match(/^\[\s*(\d+)\.(\d{6})\]\s+(\/dev\/input\/event\d+):\s+(\S+)\s+(\S+)\s+(\S+)/);
    if (row) events.push({ ms: Number(row[1]) * 1000 + Number(row[2]) / 1000, node: row[3], type: row[4], code: row[5], value: row[6] });
  }
  return { devices, events };
}

/** Press/release edges of the virtual touch device, in the getevent clock (ms). */
export function touchEdges(parsed: ReturnType<typeof parseInputEvents>, deviceName = VIRTUAL_TOUCH_DEVICE_NAME) {
  const entries = Object.entries(parsed.devices);
  const node = entries.find(([, name]) => deviceName.test(name))?.[0]
    ?? (deviceName === VIRTUAL_TOUCH_DEVICE_NAME
      ? entries.find(([, name]) => REUSED_MENU_TOUCH_DEVICE_NAME.test(name))?.[0]
      : null);
  if (!node) return { node: null, edges: [] };
  const edges: TouchEdge[] = [];
  let down = null as number | null;
  for (const event of parsed.events) {
    if (event.node !== node) continue;
    const isDown = (event.code === 'BTN_TOUCH' && event.value === 'DOWN') ||
      (event.code === 'ABS_MT_TRACKING_ID' && !/^f{8}$/i.test(event.value));
    const isUp = (event.code === 'BTN_TOUCH' && event.value === 'UP') ||
      (event.code === 'ABS_MT_TRACKING_ID' && /^f{8}$/i.test(event.value));
    if (isDown && down === null) down = event.ms;
    else if (isUp && down !== null) { edges.push({ pressMs: down, releaseMs: event.ms }); down = null; }
  }
  return { node, edges };
}

/**
 * Actuation latency L per control: the first frame showing the contact's
 * effect minus the press edge the kernel stamped -- both on the DEVICE, so no
 * host bracket enters. The getevent clock is not assumed: every latency is
 * computed against the trace's image clock (monotonic) and its elapsed clock
 * (boottime), presses are matched to scheduled contacts under both, and the
 * hypothesis that matches more presses with a visible effect is reported as
 * the physical one. Press and release edges are reported separately.
 */
export function actuationLatency({ contacts, trace, edges, released, clock, windowMs = 250 }: { contacts: readonly Contact[],
  trace: readonly StrokeRow[], edges: readonly TouchEdge[], released: number, clock: Bracket, windowMs?: number }) {
  if (!edges.length) return null;
  const mid = (clock.earlyOffsetMs + clock.lateOffsetMs) / 2;
  const bootMinusMono = trace[0].elapsedMs - trace[0].imageMs;
  const hypotheses: Record<string, Hypothesis> = {};
  for (const [name, frameClock, toWall] of [
    ['monotonic', row => row.imageMs, ms => ms + mid],
    ['boottime', row => row.elapsedMs, ms => ms - bootMinusMono + mid],
  ] satisfies [string, (row: StrokeRow) => number, (ms: number) => number][]) {
    const matches: LatencyMatch[] = [];
    for (const edge of edges) {
      const pressWall = toWall(edge.pressMs);
      let best = null as { contact: Contact, d: number } | null;
      for (const contact of contacts) {
        const d = Math.abs(released + contact.atMs - pressWall);
        if (d <= windowMs && (!best || d < best.d)) best = { contact, d };
      }
      if (!best || !best.contact.expect) continue;
      const expect = best.contact.expect;
      let effectMs = null as number | null;
      for (const row of trace) {
        const t = frameClock(row);
        if (t <= edge.pressMs) continue;
        if (t > edge.pressMs + 1500) break;
        const sig = signatureOf(row);
        const hit = expect.hall ? (sig === 'office' && row.hallLuma !== null && row.hallLuma >= HALL_LIT_MIN)
          : expect.proofs.some(p => p.signature === sig);
        if (hit) { effectMs = t; break; }
      }
      matches.push({ id: best.contact.id, atMs: best.contact.atMs, control: best.contact.control, name: expect.name,
        pressMs: edge.pressMs, releaseMs: edge.releaseMs, holdMs: Math.round(edge.releaseMs - edge.pressMs),
        pressToEffectMs: effectMs === null ? null : Math.round(effectMs - edge.pressMs),
        releaseToEffectMs: effectMs === null ? null : Math.round(effectMs - edge.releaseMs) });
    }
    const perControl: Record<string, { press: number[], release: number[] }> = {};
    for (const m of matches) {
      if (m.pressToEffectMs === null) continue;
      const bucket = perControl[m.name] ?? (perControl[m.name] = { press: [], release: [] });
      bucket.press.push(m.pressToEffectMs); bucket.release.push(m.releaseToEffectMs as number);   // set with the press
    }
    const stats = (values: number[]) => { const v = [...values].sort((a, b) => a - b); return v.length ? { n: v.length, min: v[0], median: v[v.length >> 1], max: v.at(-1) as number } : null; };
    hypotheses[name] = { matched: matches.length, withEffect: matches.filter(m => m.pressToEffectMs !== null).length,
      perControl: Object.fromEntries(Object.entries(perControl).map(([k, b]) => [k, { pressToEffect: stats(b.press), releaseToEffect: stats(b.release) }])),
      matches };
  }
  const best = Object.entries(hypotheses).sort((a, b) => b[1].withEffect - a[1].withEffect)[0];
  return { edges: edges.length, physicalClock: best && best[1].withEffect ? best[0] : null, hypotheses };
}

const LOST = new Set(['MISSING', 'INVERTED']);

/**
 * The audit. `events` is the run's events.jsonl, `plan` one entry of
 * request.json's bundle.plans, `trace` the parsed stroke trace.
 */
export function audit({ events, plan, trace, referenceContactsMs = REFERENCE_CONTACTS_MS,
  anchor = 'schedule', actuationLatencyBoundsMs = ACTUATION_LATENCY_BOUNDS_MS, inputEvents = null }: { events: readonly RunEvent[],
  plan: Plan, trace: readonly StrokeRow[], referenceContactsMs?: readonly number[], anchor?: string,
  actuationLatencyBoundsMs?: readonly number[], inputEvents?: ReturnType<typeof parseInputEvents> | null }) {
  if (!Array.isArray(events)) fail('events must be an array');
  if (!Array.isArray(trace) || trace.length < 2) fail('frame trace has fewer than two frames');
  const first = (type: string) => events.find(event => event.type === type);
  const nightGo = first('hid.night-go');
  if (!nightGo) fail('bundle has no hid.night-go: the run never reached a night');
  // The executor stamps both rows with their time.
  const released = (first('hid.night-go-released')?.at ?? nightGo.at) as number;
  const gate = clockBracket(events);
  if (!gate) fail('no gate sample carries visualCaptureAt/ageUs: the helper clock cannot be tied to the executor');

  const intervals = trace.slice(1).map((row, index) => row.imageMs - trace[index].imageMs);
  const spanMs = (trace.at(-1) as StrokeRow).imageMs - trace[0].imageMs;   // two frames at least, checked above
  const contacts = expandContacts(plan);
  const schedule = anchor === 'schedule' ? scheduleAnchor(contacts, trace, released, gate, actuationLatencyBoundsMs) : null;
  const clock = schedule
    ? { basis: 'schedule', earlyOffsetMs: schedule.earlyOffsetMs, lateOffsetMs: schedule.lateOffsetMs,
      bracketMs: schedule.bracketMs, gate, schedule }
    : { basis: 'gate-reads', earlyOffsetMs: gate.earlyOffsetMs, lateOffsetMs: gate.lateOffsetMs,
      bracketMs: gate.bracketMs, gate, schedule: null };
  const atEarly = gradeContacts(contacts, trace, clock.earlyOffsetMs, released);
  const atLate = gradeContacts(contacts, trace, clock.lateOffsetMs, released);

  const midOffset = (clock.earlyOffsetMs + clock.lateOffsetMs) / 2;
  const graded = contacts.map((contact, index): Graded => {
    const early = atEarly[index];
    const late = atLate[index];
    if (early.status === 'OUTSIDE_TRACE' || late.status === 'OUTSIDE_TRACE')
      return { ...contact, status: 'OUTSIDE_TRACE' };
    if (contact.expect?.hall) {
      const hall = gradeHall(contact as HallContact, trace, midOffset, clock.bracketMs / 2, released);
      return { ...contact, ...hall, buttonAbsent: false, coveredByStall: early.coveredByStall && late.coveredByStall,
        buttonAbsentAmbiguous: false, coveredAmbiguous: early.coveredByStall !== late.coveredByStall,
        maxGapMs: Math.max(early.maxGapMs, late.maxGapMs), atEarly: early, atLate: late };
    }
    const agree = early.status === late.status;
    return {
      ...contact,
      status: agree ? early.status : 'AMBIGUOUS',
      // Asserted only when both ends of the clock bracket say so.
      buttonAbsent: early.buttonAbsent && late.buttonAbsent,
      coveredByStall: early.coveredByStall && late.coveredByStall,
      // True when the two ends disagree on that fact.
      buttonAbsentAmbiguous: early.buttonAbsent !== late.buttonAbsent,
      coveredAmbiguous: early.coveredByStall !== late.coveredByStall,
      maxGapMs: Math.max(early.maxGapMs, late.maxGapMs),
      atEarly: early, atLate: late,
    };
  });

  const inTrace = graded.filter(row => row.status !== 'OUTSIDE_TRACE');
  const tally: Record<string, number> = {};
  for (const row of graded) tally[row.status] = (tally[row.status] ?? 0) + 1;
  const key = (row: Graded) => `${row.id}@${row.atMs}`;
  const lost = inTrace.filter(row => LOST.has(row.status));
  const covered = inTrace.filter(row => row.coveredByStall);
  const absent = inTrace.filter(row => row.buttonAbsent);
  const hall = inTrace.filter(row => row.expect?.hall);
  const hallDark = hall.filter(row => row.status === 'DARK');
  const ambiguous = inTrace.filter(row => row.status === 'AMBIGUOUS' || row.buttonAbsentAmbiguous || row.coveredAmbiguous);

  // Physics check on the bracket: an effect cannot be rendered in under one
  // frame, so the smallest landed-effect latency at each end says how far
  // that end can be from the truth.
  const minLatency = (grades: readonly Grade[]) => Math.min(...grades
    .flatMap(g => (g.status === 'LANDED' && g.landedAfterMs !== null ? [g.landedAfterMs] : [])), Infinity);

  const nightTaps = contacts.filter(row => row.durationMs <= TAP_CLASS_MAX_MS).length;
  const lengths = [...new Set([...referenceContactsMs,
    ...contacts.map(row => row.durationMs).filter(ms => ms <= TAP_CLASS_MAX_MS)])].sort((a, b) => a - b);
  const exposureTable = lengths.map(contactMs => {
    const fraction = exposure(intervals, spanMs, contactMs);
    const expectedLost = fraction * nightTaps;
    return { contactMs, exposure: fraction, expectedLostPerNight: expectedLost, pZeroLost: Math.exp(-expectedLost) };
  });
  const sorted = [...intervals].sort((a, b) => a - b);

  let latency = null as ReturnType<typeof actuationLatency> | { edges: number, physicalClock: null, hypotheses: Record<string, Hypothesis>, note: string };
  if (inputEvents) {
    const { node, edges: touch } = touchEdges(inputEvents);
    latency = node ? actuationLatency({ contacts, trace, edges: touch, released, clock })
      : { edges: 0, physicalClock: null, hypotheses: {}, note: 'no device named like the virtual touch device in the getevent log' };
  }

  return {
    schema: SCHEMA,
    nightGoAt: nightGo.at, releasedAt: released,
    actuationLatency: latency,
    clock: { ...clock, samples: gate.samples,
      minLandedLatencyMs: { early: minLatency(atEarly), late: minLatency(atLate) } },
    frames: { count: trace.length, spanMs,
      intervalMs: { p50: sorted[sorted.length >> 1], p99: sorted[Math.floor(sorted.length * 0.99)],
        max: sorted.at(-1) as number, over33: intervals.filter(gap => gap > 33).length } },
    contacts: graded,
    summary: {
      scheduled: contacts.length, inTrace: inTrace.length, tally,
      lost: lost.map(key),
      coveredByStall: covered.map(key),
      coveredAndLost: covered.filter(row => LOST.has(row.status)).map(key),
      buttonAbsentAtContact: absent.map(key),
      ambiguous: ambiguous.map(key),
      nightTapsPriced: nightTaps,
      hall: { lit: hall.filter(row => row.status === 'LIT').length, dark: hallDark.length,
        unreadable: hall.filter(row => row.status === 'UNREADABLE').length,
        ambiguous: hall.filter(row => row.status === 'AMBIGUOUS').length,
        darkAt: hallDark.map(key) },
    },
    exposure: exposureTable,
    verdict: lost.length || absent.length ? 'CONTACT_LOST' : hallDark.length ? 'HALL_DARK'
      : ambiguous.length ? 'AMBIGUOUS' : 'ALL_CONTACTS_LANDED',
  };
}

/**
 * One line per plan cycle: every signature transition, in milliseconds from
 * that cycle's start, on the midpoint of the clock bracket (the bracket is
 * stated in the header). This is the view that says in one glance whether a
 * corrected cycle lost its MASK press or its MONITOR tap: strokes3's two read
 * `... monitor-up@+14476 office@+14819 ... mask-on@+15385` -- the monitor
 * came down 450 ms late (at the mask tap) and the mask came on at the gate's
 * correction -- against `monitor-up@+14018 office@+14384 mask-on@+14469` on
 * every clean cycle.
 */
export function formatTransitions(report: Report, trace: readonly StrokeRow[], plan: Plan) {
  const { periodMs, loopStartMs, stopAtMs, idleUntilMs = 0 } = plan.timing;
  const offset = (report.clock.earlyOffsetMs + report.clock.lateOffsetMs) / 2;
  const half = report.clock.bracketMs / 2;
  const transitions: { at: number, signature: string | null }[] = [];
  let previous: string | null | undefined;
  for (const row of trace) {
    const signature = signatureOf(row);
    if (signature === previous) continue;
    transitions.push({ at: row.imageMs + offset - report.releasedAt, signature });
    previous = signature;
  }
  // Loop rows are authored from `firstRowMs` into the next period (the Night 5
  // loop runs +9200..+14449), so iteration k's window starts there and its
  // offsets are printed from the iteration BASE, matching the plan's atMs.
  const startMs = Math.max(loopStartMs, idleUntilMs);
  const steadyRows = Object.entries(plan.cycles).filter(([name]) => name !== 'opening' && name !== 'finish')
    .flatMap(([, cycle]) => cycle.blocks.flatMap(block => block.actions.map(action => action.atMs)));
  const firstRowMs = steadyRows.length ? Math.min(...steadyRows) : 0;
  const lines = [`signature transitions per plan iteration, ms from the iteration base (loop rows run +${firstRowMs}..), ` +
    `clock at the bracket midpoint (+-${half.toFixed(0)} ms):`];
  const cycles = [{ label: 'opening', base: 0, from: 0, to: startMs + firstRowMs }];
  for (let base = startMs, index = 0; base < stopAtMs; base += periodMs, index += 1)
    cycles.push({ label: `cycle ${index}`, base, from: base + firstRowMs, to: base + firstRowMs + periodMs });
  for (const cycle of cycles) {
    const inside = transitions.filter(t => t.at >= cycle.from && t.at < cycle.to);
    if (!inside.length) continue;
    lines.push(`  ${cycle.label.padEnd(9)} ` + inside.map(t => `${t.signature ?? 'null'}@+${Math.round(t.at - cycle.base)}`).join(' '));
  }
  return lines.join('\n');
}

export function formatReport(report: Report) {
  const lines: string[] = [];
  const { summary, frames, clock, exposure: table } = report;
  lines.push(`frames ${frames.count} over ${(frames.spanMs / 1000).toFixed(1)} s; interval p50 ${frames.intervalMs.p50.toFixed(2)} ms, ` +
    `p99 ${frames.intervalMs.p99.toFixed(1)} ms, max ${frames.intervalMs.max.toFixed(1)} ms, ${frames.intervalMs.over33} over 33 ms`);
  lines.push(`clock: ${clock.gate.samples} gate reads bracket the helper clock by ${clock.gate.bracketMs.toFixed(1)} ms` +
    (clock.schedule
      ? `; ${clock.schedule.transitions} landed effects anchor the schedule and, under an actuation latency of ` +
        `${clock.schedule.latencyBoundsMs[0]}-${clock.schedule.latencyBoundsMs[1]} ms (stated, unmeasured), narrow it to ${clock.bracketMs.toFixed(1)} ms`
      : '; no landed effect could anchor the schedule, so the gate bracket stands') +
    `. Smallest landed-effect latency: ${clock.minLandedLatencyMs.early} ms at the early end, ` +
    `${clock.minLandedLatencyMs.late} ms at the late end. A finding below holds at BOTH ends or is AMBIGUOUS.`);
  lines.push(`contacts: ${summary.scheduled} scheduled, ${summary.inTrace} inside the trace; ` +
    Object.entries(summary.tally).map(([status, count]) => `${status} ${count}`).join(', '));
  const anomalies = report.contacts.filter(row => row.status !== 'OUTSIDE_TRACE' &&
    (LOST.has(row.status) || row.status === 'AMBIGUOUS' || row.buttonAbsent || row.coveredByStall ||
      row.buttonAbsentAmbiguous || row.coveredAmbiguous));
  if (anomalies.length) {
    lines.push('contacts covered by a stall, arrived with their button absent, without their effect, or ambiguous across the bracket:');
    for (const row of anomalies) {
      // A row the bracket graded has both ends.
      const side = (grade: InTrace) => `${grade.status}${grade.landedAfterMs === null ? '' : `+${grade.landedAfterMs}ms`}` +
        `${grade.buttonAbsent ? ' absent' : ''}${grade.coveredByStall ? ' covered' : ''} pre=${grade.preSignature ?? 'unreadable'}`;
      lines.push(`  ${row.id}@${row.atMs} ${row.control} ${row.durationMs} ms  max interval ${row.maxGapMs} ms  ` +
        `${row.status}${row.buttonAbsent ? ' BUTTON ABSENT' : ''}${row.coveredByStall ? ' COVERED' : ''}` +
        `  [early: ${side(row.atEarly as InTrace)} | late: ${side(row.atLate as InTrace)}]`);
    }
  } else lines.push('no contact was covered by a stall, arrived with its button absent, or missed its effect');
  const hall = summary.hall;
  if (hall.lit + hall.dark + hall.unreadable + hall.ambiguous)
    lines.push(`hall flashes (grid cells over PixelWatch FOXY_HALL, read on office frames only): lit ${hall.lit}, ` +
      `DARK ${hall.dark}, unreadable ${hall.unreadable}, ambiguous ${hall.ambiguous}` +
      `${hall.dark ? ' -- dark is an upper bound on refused flashes (the light stays on during hall movement, which renders dark); ' +
        'the engine refuses a flash inside the mask-off animation' : ''}` +
      `${hall.darkAt.length ? '\n  dark at ' + hall.darkAt.join(' ') : ''}`);
  lines.push(`exposure of a contact to this trace's stalls (clock-free), priced over the ${summary.nightTapsPriced} taps the plan schedules per night:`);
  lines.push('  contact   exposure   expected lost/night   P(zero lost)');
  for (const row of table)
    lines.push(`  ${String(row.contactMs).padStart(5)} ms   ${(row.exposure * 100).toFixed(3).padStart(6)}%   ` +
      `${row.expectedLostPerNight.toFixed(2).padStart(8)}              ${(row.pZeroLost * 100).toFixed(0).padStart(3)}%`);
  const L = report.actuationLatency;
  if (L) {
    if (!L.physicalClock) lines.push(`actuation latency (getevent): ${'note' in L ? L.note : `${L.edges} press edges, none matched a scheduled contact with a visible effect under either clock`}`);
    else {
      const h = L.hypotheses[L.physicalClock];
      lines.push(`actuation latency (getevent kernel press edge -> first effect frame, both on the device clock; ` +
        `getevent clock read as ${L.physicalClock}: ${h.withEffect} of ${L.edges} edges matched with an effect; ` +
        Object.entries(L.hypotheses).filter(([k]) => k !== L.physicalClock).map(([k, v]) => `${v.withEffect} under ${k}`).join(', ') + '):');
      for (const [control, v] of Object.entries(h.perControl)) {
        // A control is listed only with a matched effect.
        const p = v.pressToEffect as Stats, r = v.releaseToEffect as Stats;
        lines.push(`  ${control.padEnd(13)} press->effect n=${p.n} min ${p.min} median ${p.median} max ${p.max} ms | release->effect median ${r.median} ms`);
      }
    }
  }
  lines.push(`verdict: ${report.verdict}`);
  return lines.join('\n');
}

const readJsonl = (path: string) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name: string, fallback?: string) => {
    const found = process.argv.find(value => value.startsWith(`--${name}=`));
    if (found) return found.slice(name.length + 3);
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')
      ? process.argv[index + 1] : fallback;
  };
  const run = arg('run');
  const tracePath = arg('frame-trace');
  const inputPath = arg('input-events');
  if (!run || !tracePath) {
    process.stderr.write('usage: tap-stall-audit.ts --run artifacts/campaign-... --frame-trace FILE ' +
      '[--input-events FILE] [--night N] [--transitions] [--json] [--out FILE]\n');
    process.exit(2);
  }
  try {
    const events = readJsonl(join(run, 'events.jsonl'));
    const plans = requestPlans(JSON.parse(readFileSync(join(run, 'request.json'), 'utf8')));
    const night = arg('night');
    const plan = night === undefined ? plans[0] : plans.find(entry => entry.night === Number(night));
    if (!plan) fail(`request.json binds no plan${night === undefined ? '' : ` for night ${night}`}`);
    const trace = parseStrokeTrace(readFileSync(tracePath, 'utf8'));
    const inputEvents = inputPath ? parseInputEvents(readFileSync(inputPath, 'utf8')) : null;
    const report: Report & { run?: string, frameTrace?: string } = audit({ events, plan, trace, inputEvents });
    report.run = run;
    report.frameTrace = tracePath;
    const out = arg('out');
    if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    const text = process.argv.includes('--json') ? JSON.stringify(report, null, 2)
      : formatReport(report) + (process.argv.includes('--transitions') ? '\n' + formatTransitions(report, trace, plan) : '');
    process.stdout.write(text + '\n');
    process.exit(report.verdict === 'CONTACT_LOST' || report.verdict === 'HALL_DARK' ? 3 : 0);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(2);
  }
}
