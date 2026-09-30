// Read-only gate for the legal camera-light intersection probe.
//
// This process owns no input writer. It polls the Companion's authenticated,
// atomic Companion read and exits only after two fresh, increasing frame
// sequences agree. The bottom controls are translucent, so their whole-ROI
// means are diagnostic only. The gate consumes the fixed native downward
// chevrons: a local max-channel contrast score over the two stroke lines.
// GET is sufficient because the helper publishes those scores from the same
// native image as seq/age/state; FRAME remains available for full-grid
// diagnostics without making every poll serialize 1080 hex characters.
//
// The helper's explicit monitorUp fact is preferred; fitted grid anchors are a
// diagnostic fallback only. This keeps the gate aligned with the user's
// observation that the monitor button remains visible while the mask button
// disappears on monitor-up. A missing stroke score is a refusal, never a luma
// fallback.
import { appendFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CompanionControlTransport, measureMaskOn, measureMonitorUp,
  parseMaskRule, parseMonitorRule } from '@sixam/play';
import { AdbCompanionPort } from '../../src/campaign/physical-ports.js';

export const BUTTON_THRESHOLDS = Object.freeze({
  /** 100 of roughly 142 sampled stroke columns is a full glyph. */
  visibleMin: 100,
  /** Transitional/scene edges remain below this absent ceiling. */
  absentMax: 40,
});

const sleep = milliseconds => new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds));
const integer = (value, name) => {
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
};

function numericField(fields, name) {
  const value = Number(fields?.[name]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** The fixed downward-chevron scores from the native helper image. */
export function bottomButtons(cells, fields = null) {
  const maskStroke = numericField(fields, 'mask_button_downstroke');
  const monitorStroke = numericField(fields, 'monitor_button_downstroke');
  const maskMean = numericField(fields, 'mask_button_mean_luma');
  const monitorMean = numericField(fields, 'monitor_button_mean_luma');
  if (maskStroke !== null && monitorStroke !== null) {
    return { maskStroke, monitorStroke, maskMean, monitorMean, source: 'native-stroke' };
  }
  // Keep this argument for the pure-test/API shape, but never derive a state
  // tell from the 20x9 grid. Its bottom samples are too coarse for the glyph.
  void cells;
  return { maskStroke: null, monitorStroke: null, maskMean, monitorMean, source: 'unavailable' };
}

/**
 * Derive the exclusive monitor state from the native control strokes alone.
 * This is intentionally independent of the helper's broader visual-validity
 * flag: a capture can reject its content metadata while still carrying a
 * fresh, unambiguous pair of fixed UI strokes from the same image.
 */
function strokeMonitorState(buttons) {
  if (buttons.maskStroke === null || buttons.monitorStroke === null) return null;
  if (buttons.maskStroke <= BUTTON_THRESHOLDS.absentMax &&
      buttons.monitorStroke >= BUTTON_THRESHOLDS.visibleMin) return true;
  if (buttons.maskStroke >= BUTTON_THRESHOLDS.visibleMin &&
      buttons.monitorStroke >= BUTTON_THRESHOLDS.visibleMin) return false;
  return null;
}

function explicitMonitor(fields) {
  if (fields.monitorUp === 'true') return true;
  if (fields.monitorUp === 'false') return false;
  return null;
}

/**
 * Classify one parsed FRAME for a gate. This function is pure and is exercised
 * without a phone by test-intersection-state-gate.mjs.
 */
export function classifyFrame(fields, { monitorRule, maskRule, target }) {
  const ageUs = Number(fields?.ageUs);
  const sequence = Number(fields?.seq);
  const visualObserved = fields?.visual === 'OBSERVED';
  const visualReason = typeof fields?.visualReason === 'string'
    ? fields.visualReason : visualObserved ? null : 'legacy-visual-unknown';
  const common = {
    sequence: Number.isSafeInteger(sequence) ? sequence : null,
    ageUs: Number.isFinite(ageUs) ? ageUs : null,
    screen: fields?.screen ?? 'UNKNOWN',
    visual: fields?.visual ?? 'UNKNOWN',
    observerState: visualObserved ? 'OBSERVED' : 'UNKNOWN',
    observerReason: visualReason,
  };
  // A known non-night screen is still a hard refusal. When the helper only
  // rejects capture metadata, the direct control strokes below may establish
  // the state without pretending that full-screen identity was observed.
  if (fields?.screen && fields.screen !== 'UNKNOWN' && fields.screen !== 'FNAF2_NIGHT') {
    return { ...common, pass: false, reason: 'screen-not-night' };
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) return { ...common, pass: false, reason: 'sequence-invalid' };
  if (!Number.isFinite(ageUs) || ageUs < 0 || ageUs > 500000)
    return { ...common, pass: false, reason: 'frame-stale' };

  const buttons = bottomButtons(fields?.cells, fields);
  const explicit = explicitMonitor(fields);
  const hasGrid = Array.isArray(fields.cells) && fields.cells.length === 180 &&
    fields.cells.every(cell => Number.isInteger(cell));
  const derivedMeasurement = hasGrid
    ? measureMonitorUp({ ...fields, monitorUp: undefined,
      monitorReason: undefined, gridSeq: fields.seq }, monitorRule,
    { maxAgeUs: 500000, cells: fields.cells })
    : { state: 'UNKNOWN', value: null, reason: 'grid-unavailable' };
  const derived = derivedMeasurement.state === 'OBSERVED' ? derivedMeasurement.value : null;
  const strokeMonitor = strokeMonitorState(buttons);
  const monitor = explicit ?? derived ?? strokeMonitor;
  const monitorSource = explicit !== null ? 'helper-explicit'
    : derived !== null ? 'fitted-grid'
      : strokeMonitor !== null ? 'native-stroke' : 'unknown';
  const maskMeasurement = target === 'office' && hasGrid
    ? measureMaskOn({ ...fields, gridSeq: fields.seq }, maskRule,
      { maxAgeUs: 500000, cells: fields.cells })
    : { signal: 'maskOn', state: 'UNKNOWN', value: null, confidence: 0,
      reason: 'grid-unavailable' };
  const mask = maskMeasurement.state === 'OBSERVED' ? maskMeasurement.value : null;
  const strokesAvailable = buttons.maskStroke !== null && buttons.monitorStroke !== null;
  const buttonsOffice = strokesAvailable &&
    buttons.maskStroke >= BUTTON_THRESHOLDS.visibleMin &&
    buttons.monitorStroke >= BUTTON_THRESHOLDS.visibleMin;
  const buttonsMonitorUp = strokesAvailable &&
    buttons.maskStroke <= BUTTON_THRESHOLDS.absentMax &&
    buttons.monitorStroke >= BUTTON_THRESHOLDS.visibleMin;
  let pass = false;
  let reason = 'state-not-ready';
  if (target === 'monitor-up') {
    pass = strokesAvailable && monitor === true && buttonsMonitorUp;
    if (!pass) {
      reason = !strokesAvailable ? 'button-strokes-unavailable'
        : monitor !== true ? (explicit === null && derived === null
        ? (!visualObserved
            ? `state-unknown:${visualReason ?? 'unavailable'}`
            : `monitor-unknown:${derivedMeasurement.reason ?? 'unavailable'}`)
          : 'monitor-not-up')
        : 'monitor-up-stroke-signature-missing';
    }
  } else {
    pass = strokesAvailable && monitor === false && buttonsOffice;
    if (!pass) {
    reason = !strokesAvailable ? 'button-strokes-unavailable'
        : monitor !== false ? (!visualObserved && monitor === null
            ? `state-unknown:${visualReason ?? 'unavailable'}` : 'monitor-not-down')
          : !buttonsOffice ? 'office-stroke-signature-missing'
            : mask !== false ? (maskMeasurement.reason ?? 'mask-not-down')
              : 'office-stroke-signature-missing';
    }
  }
  return { ...common, pass, reason: pass ? 'positive-state' : reason,
    monitor, monitorSource, stateSource: monitorSource,
    derivedMonitor: derived, monitorReason: derivedMeasurement.reason ?? null,
    mask, maskReason: maskMeasurement.reason ?? null,
    strokeSource: buttons.source,
    maskButtonDownstroke: buttons.maskStroke,
    monitorButtonDownstroke: buttons.monitorStroke,
    // Diagnostic only. These fields never participate in pass/fail.
    maskButtonMean: buttons.maskMean,
    monitorButtonMean: buttons.monitorMean,
  };
}

function parseArguments(argv) {
  const values = { target: null, timeoutMs: 8000, pollMs: 50, log: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--target') values.target = argv[++index];
    else if (arg === '--timeout-ms') values.timeoutMs = Number(argv[++index]);
    else if (arg === '--poll-ms') values.pollMs = Number(argv[++index]);
    else if (arg === '--log') values.log = argv[++index];
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!['office', 'monitor-up'].includes(values.target))
    throw new Error('--target must be office or monitor-up');
  integer(values.timeoutMs, 'timeout-ms');
  integer(values.pollMs, 'poll-ms');
  if (values.timeoutMs < 1000 || values.timeoutMs > 30000) throw new Error('timeout-ms must be 1000..30000');
  if (values.pollMs < 20 || values.pollMs > 1000) throw new Error('poll-ms must be 20..1000');
  if (values.log !== null && (typeof values.log !== 'string' || values.log.length === 0))
    throw new Error('--log needs a path');
  return values;
}

function writeLogger(path) {
  if (!path) return () => {};
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  const fd = openSync(target, 'wx');
  closeSync(fd);
  return row => appendFileSync(target, `${JSON.stringify(row)}\n`);
}

async function run({ target, timeoutMs, pollMs, log }) {
  const serial = process.env.ANDROID_SERIAL;
  if (typeof serial !== 'string' || serial.length === 0)
    throw new Error('ANDROID_SERIAL must be selected before the state gate starts');
  const logger = writeLogger(log);
  const monitorRule = parseMonitorRule(JSON.parse(await readFile(
    new URL('../../../../models/monitor-rule-moto-g56-v207.json', import.meta.url), 'utf8')));
  const maskRule = parseMaskRule(JSON.parse(await readFile(
    new URL('../../../../models/mask-rule-moto-g56-v207.json', import.meta.url), 'utf8')));
  const port = new AdbCompanionPort({ serial, adb: process.env.ADB || 'adb' });
  const endpoint = port.discover();
  const cue = new CompanionControlTransport({ token: endpoint.token,
    request: request => port.request(request), maxAgeUs: 500000 });
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let lastSequence = 0;
  let streak = 0;
  let last = null;
  let observations = 0;
  while (Date.now() < deadline) {
    let row;
    try {
      // The gate needs only the lightweight native stroke fields. FRAME would
      // serialize the full 20x9 grid on every poll and can load the capture
      // path enough to drop the very frames this gate is meant to observe.
      const fields = cue.snapshot();
      const sequence = Number(fields.seq);
      if (!Number.isSafeInteger(sequence) || sequence <= lastSequence) {
        row = { target, hostMs: Date.now(), verdict: 'UNKNOWN', reason: 'sequence-not-advancing',
          sequence: Number.isSafeInteger(sequence) ? sequence : null, previousSequence: lastSequence };
        streak = 0;
      } else {
        lastSequence = sequence;
        const classified = classifyFrame(fields, { monitorRule, maskRule, target });
        row = { target, hostMs: Date.now(), ...classified };
        if (classified.pass && last?.pass && last.sequence < classified.sequence) streak += 1;
        else streak = classified.pass ? 1 : 0;
        last = classified;
        observations += 1;
      }
    } catch (error) {
      row = { target, hostMs: Date.now(), verdict: 'UNKNOWN', reason: 'frame-read-failed',
        error: error instanceof Error ? error.message : String(error) };
      streak = 0;
    }
    logger(row);
    console.log(JSON.stringify(row));
    if (streak >= 2) {
      const result = { target, verdict: 'PASS', sequence: row.sequence,
        samples: streak, observations, elapsedMs: Date.now() - startedAt,
        maskButtonDownstroke: row.maskButtonDownstroke,
        monitorButtonDownstroke: row.monitorButtonDownstroke,
        maskButtonMean: row.maskButtonMean, monitorButtonMean: row.monitorButtonMean,
        monitorSource: row.monitorSource };
      logger({ ...result, terminal: true });
      console.log(`STATE_GATE target=${target} verdict=PASS seq=${row.sequence} samples=${streak} ` +
        `elapsed_ms=${result.elapsedMs} monitor_source=${row.monitorSource} ` +
        `mask_downstroke=${row.maskButtonDownstroke} ` +
        `monitor_downstroke=${row.monitorButtonDownstroke} ` +
        `mask_button_mean_diag=${row.maskButtonMean ?? 'UNKNOWN'} ` +
        `monitor_button_mean_diag=${row.monitorButtonMean ?? 'UNKNOWN'}`);
      return 0;
    }
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
  const result = { target, verdict: 'TIMEOUT', reason: last?.reason ?? 'no-frame',
    observations, elapsedMs: Date.now() - startedAt, lastSequence };
  logger({ ...result, terminal: true });
  console.error(`STATE_GATE target=${target} verdict=TIMEOUT reason=${result.reason} ` +
    `observations=${observations} last_seq=${lastSequence}`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    process.exitCode = await run(options);
  } catch (error) {
    console.error(`STATE_GATE verdict=ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
