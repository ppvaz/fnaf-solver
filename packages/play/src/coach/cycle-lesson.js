/**
 * The teach panel's lesson: the compiled artifact's own semantic actions,
 * encoded as the bounded `LESSON` rows the Cue Helper re-expands
 * (CycleLesson.java). The helper owns the words; this sends only verbs,
 * times, and the header it needs to repeat the steady cycle exactly the way
 * expandNightBlocks() does. A lesson is a narration of the schedule, never an
 * observation, and a refusal here only means the night runs without a panel.
 * CONTRACT:cue-helper-control-v1.
 */
import { createHash } from 'node:crypto';

const STEADY_CYCLES = new Set(['toys', 'clear']);
const HOLD_VERBS = Object.freeze({
  hallLight: 'hall-light', cameraFeedLight: 'feed-light', wind: 'wind',
  leftVentLight: 'vent-left', rightVentLight: 'vent-right',
});
// CycleLesson.java bounds, mirrored so a lesson the helper would refuse is
// refused here with a reason instead of mid-upload.
const MAX_ROWS = 48;
const MAX_NIGHT_MS = 900000;

function refuse(reason) { throw new Error(`teach: ${reason}`); }

const integerIn = (value, min, max, what) => {
  if (!Number.isInteger(value) || value < min || value > max) refuse(`${what} ${JSON.stringify(value)} is outside ${min}..${max}`);
  return value;
};

/** The helper verb for one artifact action, or a refusal naming it. */
export function lessonVerb(action) {
  const name = `${action?.kind}/${action?.compound ?? action?.control}`;
  if (action?.kind === 'ensure' && action.control === 'monitor' && typeof action.targetMonitorUp === 'boolean')
    return action.targetMonitorUp ? 'cams-up' : 'cams-down';
  if (action?.kind === 'press' && action.control === 'mask' && typeof action.targetMaskOn === 'boolean')
    return action.targetMaskOn ? 'mask-on' : 'mask-off';
  if (action?.kind === 'tap') {
    const camera = /^cam:(\d{1,2})$/.exec(action.control ?? '');
    if (camera && Number(camera[1]) >= 1 && Number(camera[1]) <= 12) return `cam-${Number(camera[1])}`;
  }
  if (action?.kind === 'hold' && Object.hasOwn(HOLD_VERBS, action.control)) return HOLD_VERBS[action.control];
  if (action?.kind === 'compound' && action.compound === 'camdrop') return 'camdrop';
  return refuse(`the panel has no words for ${name}`);
}

const cameraNumber = value => {
  const match = /^cam:(\d{1,2})$/.exec(value ?? '');
  return match ? Number(match[1]) : null;
};

/**
 * Build the lesson for one compiled artifact plan (artifact.plans[i]).
 * @param {any} plan
 */
export function lessonFromArtifactPlan(plan) {
  if (!plan || typeof plan !== 'object') refuse('no artifact plan');
  const night = integerIn(plan.night, 1, 7, 'night');
  const timing = plan.timing ?? {};
  const periodMs = integerIn(timing.periodMs, 1000, 60000, 'periodMs');
  const loopStartMs = integerIn(timing.loopStartMs, 0, MAX_NIGHT_MS, 'loopStartMs');
  const idleUntilMs = integerIn(timing.idleUntilMs ?? 0, 0, MAX_NIGHT_MS, 'idleUntilMs');
  const stopAtMs = integerIn(timing.stopAtMs, 1, MAX_NIGHT_MS, 'stopAtMs');
  const observeUntilMs = integerIn(timing.observeUntilMs, 1, MAX_NIGHT_MS, 'observeUntilMs');
  if (stopAtMs <= loopStartMs || observeUntilMs < stopAtMs) refuse('plan observation bounds are invalid');
  const names = Object.keys(plan.cycles ?? {});
  const steadyNames = names.filter(name => STEADY_CYCLES.has(name));
  const other = names.filter(name => name !== 'opening' && !STEADY_CYCLES.has(name));
  if (!names.includes('opening')) refuse('plan has no opening');
  if (steadyNames.length !== 1) refuse(`plan needs exactly one steady cycle, has ${JSON.stringify(steadyNames)}`);
  if (other.length) refuse(`the panel cannot narrate cycle ${JSON.stringify(other)}`);

  const rowsOf = (name, cycle) => (plan.cycles[name].blocks ?? []).flatMap(block => (block.actions ?? []).map(action => {
    const verb = lessonVerb(action);
    const row = { cycle, atMs: integerIn(action.atMs, 0, MAX_NIGHT_MS, 'action atMs'), verb,
      durationMs: integerIn(action.durationMs, 1, periodMs, `${verb} duration`) };
    if (verb === 'camdrop') {
      row.leadMs = integerIn(action.leadMs ?? 0, 0, periodMs, 'camdrop lead');
      row.tailMs = integerIn(action.tailMs ?? 0, 0, periodMs, 'camdrop tail');
    }
    return row;
  }));
  const rows = [...rowsOf('opening', 'opening'), ...rowsOf(steadyNames[0], 'steady')];
  if (rows.length === 0 || rows.length > MAX_ROWS) refuse(`a lesson carries 1..${MAX_ROWS} rows, not ${rows.length}`);

  // The helper repeats the steady cycle as the executor does; say so only when
  // the plan declares the split the cameras are left in.
  const arm = plan.armVerification;
  const viewCamera = cameraNumber(arm?.viewing);
  const markerCamera = viewCamera === null ? null
    : (arm.cameras ?? []).map(cameraNumber).find(camera => camera !== null && camera !== viewCamera) ?? null;
  const header = { night, periodMs, loopStartMs, idleUntilMs, stopAtMs, observeUntilMs,
    viewCamera, markerCamera };
  const canonical = [
    `lesson-v1 ${night} ${periodMs} ${loopStartMs} ${idleUntilMs} ${stopAtMs} ${observeUntilMs} ` +
      `${viewCamera ?? '-'} ${markerCamera ?? '-'}`,
    ...rows.map(rowText),
  ].join('\n') + '\n';
  const id = createHash('sha256').update(canonical, 'ascii').digest('hex').slice(0, 16);
  return Object.freeze({ id, header: Object.freeze(header), rows: Object.freeze(rows.map(Object.freeze)), canonical });
}

/**
 * The lesson for one night of a validated campaign bundle -- the same bound
 * plan the executor's request is built from (makeCampaignExecutionRequest).
 * @param {{plans?: any[]}} bundle @param {number} night
 */
export function lessonForNight(bundle, night) {
  const plan = Array.isArray(bundle?.plans) ? bundle.plans.find(item => item?.night === night) : undefined;
  if (!plan) refuse(`the bundle binds no plan for night ${night}`);
  return lessonFromArtifactPlan(plan);
}

function rowText(row) {
  const base = `${row.cycle} ${row.atMs} ${row.verb} ${row.durationMs}`;
  return row.verb === 'camdrop' ? `${base} ${row.leadMs} ${row.tailMs}` : base;
}

const TOKEN = /^[0-9a-f]{32}$/;

/** The upload: begin, one row per action, commit. */
export function lessonLines(token, lesson) {
  if (!TOKEN.test(token ?? '')) refuse('the helper token must be 128-bit hex');
  const h = lesson.header;
  return [
    `LESSON ${token} begin ${lesson.id} ${h.night} ${h.periodMs} ${h.loopStartMs} ${h.idleUntilMs} ` +
      `${h.stopAtMs} ${h.observeUntilMs} ${lesson.rows.length} ${h.viewCamera ?? '-'} ${h.markerCamera ?? '-'}`,
    ...lesson.rows.map((row, index) => `LESSON ${token} row ${index} ${rowText(row)}`),
    `LESSON ${token} commit`,
  ];
}

/**
 * The schedule's origin, as the anchor released it: the helper's own latched
 * onset (its image clock, ns) plus the host-measured interval from that onset
 * to the release. The helper refuses an onset that is not its latch.
 * @param {string} token @param {{onsetDeviceMs: number, afterOnsetMs: number}} release
 */
export function lessonOriginLine(token, { onsetDeviceMs, afterOnsetMs }) {
  if (!TOKEN.test(token ?? '')) refuse('the helper token must be 128-bit hex');
  if (!(Number.isFinite(onsetDeviceMs) && onsetDeviceMs > 0)) refuse('the release carries no latched onset');
  if (!(Number.isFinite(afterOnsetMs) && afterOnsetMs >= 0 && afterOnsetMs < 60000))
    refuse(`release ${afterOnsetMs} ms after the onset is not a schedule origin`);
  const onsetNs = BigInt(Math.round(onsetDeviceMs * 1e6));
  return `LESSON ${token} origin ${onsetNs} ${Math.round(afterOnsetMs * 1000)}`;
}

/** Every line the host may send on the lesson channel. */
export const LESSON_LINE = new RegExp('^LESSON [0-9a-f]{32} (?:' + [
  'begin [0-9a-f]{16}(?: \\d{1,7}){7} (?:\\d{1,2}|-) (?:\\d{1,2}|-)',
  'row \\d{1,2} (?:opening|steady) \\d{1,7} (?:cams-up|cams-down|mask-on|mask-off|cam-\\d{1,2}|hall-light|feed-light|wind|vent-left|vent-right|camdrop) \\d{1,7}(?: \\d{1,7} \\d{1,7})?',
  'commit', 'origin \\d{1,20} \\d{1,10}', 'clear', 'status',
].join('|') + ')$');
