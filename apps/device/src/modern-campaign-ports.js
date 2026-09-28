/**
 * Modern physical campaign composition for the calibrated Android path.
 *
 * This is the campaign composition root: title/lifecycle observers are
 * bounded read ports, HID is the only game actuator, and the full-night
 * request is handed to the device-local executor as one scheduled transfer.
 * No legacy runner, strategy interpreter, or arbitrary shell port is used.
 * CONTRACT:device-campaign-v1 CONTRACT:device-executor-v1.
 */
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CueHelperControlTransport, HidWireTransport, measureMaskOn, measureMonitorUp,
  parseCameraRule, parseMaskRule, parseMonitorRule, reconcileExclusiveControls } from '@fnaf2-1020/adapters';
import { configureCustomNight, selectCustomNightPreset, validateCustomNightCalibration, CUSTOM_NIGHT_CONTACT_MS } from './custom-night.js';
import { AdbDeviceBridge } from './adb-bridge.js';
import { composeCampaignPorts } from './campaign-composition.js';
import { AdbDeviceLocalArtifactExecutor } from './adb-device-local-executor.js';
import { makeCampaignExecutionRequest } from './campaign-bundle.js';
import { AdbCueHelperPort, AdbHidProcess } from './physical-ports.js';
import { anchorNightRelease } from './night-anchor.js';
import { LESSON_LINE, lessonForNight, lessonLines, lessonOriginLine } from './cycle-lesson.js';
import { phoneWallAt, planTimedStart, waitUntilHostMs } from './timed-start.js';
import { DeviceCampaignRunner } from './campaign-runner.js';

const TITLE_MODEL = new URL('../../../tools/device/models/title-moto-g56-v207.json', import.meta.url);
const CAMERA_RULE = new URL('../../../models/camera-rule-moto-g56-v207.json', import.meta.url);
const MONITOR_RULE = new URL('../../../models/monitor-rule-moto-g56-v207.json', import.meta.url);
const MASK_RULE = new URL('../../../models/mask-rule-moto-g56-v207.json', import.meta.url);
const LIFECYCLE_OBSERVER = new URL('../../../tools/device/lifecycle-observe.py', import.meta.url);
const TITLE_OBSERVER = new URL('../../../tools/device/title-observe.py', import.meta.url);
const CUSTOM_NIGHT_READBACK = new URL('../../../tools/device/custom-night-readback.py', import.meta.url);
const AI_DIALS_ALL = ['withfreddy', 'withbonnie', 'withchica', 'foxy', 'toyfreddy', 'toybonnie', 'toychica', 'mangle', 'bb', 'golden'];
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

async function observePython(script, input, args = []) {
  return new Promise(resolve => {
    const child = spawn('python3', [script.pathname, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'], shell: false,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (code, detail = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: Number.isInteger(code) ? code : 1, stdout, stderr: stderr || detail });
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(1, 'observer timeout');
    }, 15000);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => finish(1, error.message));
    child.on('close', code => finish(code));
    child.stdin.end(input);
  });
}

function lastLine(output) {
  return String(output).replace(/\r/g, '').trim().split(/\n/).at(-1) ?? '';
}

async function captureAndObserve(bridge, serial, script, args = []) {
  const png = await bridge.capturePng(serial);
  if (!png) throw new Error('observer capture failed');
  const result = await observePython(script, png, args);
  await bridge.recordObservation?.({ script: fileURLToPath(script).split('/').at(-1), png, ...result });
  return result;
}

async function lifecycle(bridge, serial) {
  const result = await captureAndObserve(bridge, serial, LIFECYCLE_OBSERVER, ['--sensor', 'screencap-2400x1080']);
  const line = lastLine(result.stdout);
  return line.startsWith('state=') ? line.slice(6) : null;
}

async function title(bridge, serial, model) {
  const result = await captureAndObserve(bridge, serial, TITLE_OBSERVER,
    ['--sensor', 'screencap-2400x1080', '--model', model]);
  const line = lastLine(result.stdout);
  if (!line.startsWith('items=')) {
    const detail = line || lastLine(result.stderr) || `observer-exit-${result.code}`;
    throw new Error(`title observer refused: ${detail}`);
  }
  return line.slice(6).split(',').filter(Boolean);
}

/** A press that activates a title row loads the next frame about 260 ms later (frame #3 at
 * +262 ms on 2026-09-18, night6-ft-01) and the office about 3.5 s later. A read whose screen
 * capture precedes that first frame shows the title whether the press focused the row or started
 * the night, so a read may only answer once this long has passed since the press was stamped. */
export const FIRST_PRESS_SETTLE_MS = 400;
/** No read may start later than this after the press: a lifecycle read takes 1.1-1.8 s, and its
 * answer has to be in before the office appears so intro() stamps first. */
export const FIRST_PRESS_LAST_READ_MS = 1400;

/**
 * The lifecycle state a title press left behind, read only once the press has had time to act.
 * `title` means the press focused the row; any other state means the screen moved on, and the
 * caller must not press again. When only unknown reads arrive before the last read may start,
 * the answer is `unknown`, which callers treat as a press that activated: a second press into a
 * night that may already have begun is the failure this exists to prevent.
 * @param {() => Promise<string | null>} read
 * @param {{settleMs?: number, lastReadMs?: number, now?: () => number,
 *   pause?: (ms: number) => Promise<unknown>}} [options]
 */
export async function settledAfterPress(read, { settleMs = FIRST_PRESS_SETTLE_MS,
  lastReadMs = FIRST_PRESS_LAST_READ_MS, now = Date.now, pause = sleep } = {}) {
  const calledAt = now();
  await pause(settleMs);
  for (;;) {
    const state = await read();
    if (typeof state === 'string' && state !== '') return state;
    if (now() - calledAt >= lastReadMs) return 'unknown';
    await pause(100);
  }
}

async function waitFor(bridge, serial, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await lifecycle(bridge, serial);
    if (predicate(last)) return last;
    await sleep(150);
  }
  throw new Error(`${label} was not observed before the ${timeoutMs}ms deadline (last=${last ?? 'unknown'})`);
}

/** Resolve a night terminal from what the executor already observed.
 *
 * The device-local executor stops on the FIRST positive terminal read and
 * publishes it as `execution.terminal`. That screen is TRANSIENT: in
 * night5-strokes1 (2026-09-12) the executor consumed `gameover` at
 * 03:06:42.950 and the game was already back at `title` by 03:06:44.823. The
 * terminal port then started observing at 03:06:43.956 and spent its whole
 * 120 s deadline polling title/night for a screen that had gone, aborting a
 * night that had ended normally two minutes earlier and reporting
 * `campaign-abort` instead of the death as the run's stop reason.
 *
 * `campaign-runner.js` still calls a terminal observer "authoritative ... even
 * when the device-local executor's own poll missed the short game-over/static
 * transition", and that stays true: this only short-circuits when the executor
 * DID publish a terminal. Returning null means nothing trustworthy was
 * published and the caller must observe for itself.
 *
 * @param {{target: {night: number, mode: string},
 *   execution?: {terminal?: string} | null}} args
 */
export function terminalFromExecution({ target, execution }) {
  const observed = execution?.terminal;
  if (observed !== 'sixam' && observed !== 'gameover') return null;
  const sixAm = observed === 'sixam';
  return { night: target.night, identity: target.mode,
    outcome: sixAm ? 'sixam' : 'death', sixAm, positive: sixAm,
    state: observed, source: 'executor' };
}

function point(value, label) {
  if (!isRecord(value) || !Number.isInteger(value.x) || !Number.isInteger(value.y) ||
      value.x < 0 || value.y < 0 || value.x >= 2400 || value.y >= 1080)
    throw new TypeError(`${label} must be a bounded screen point`);
  return value;
}

function modelPoint(value, label) {
  if (!Array.isArray(value) || value.length !== 2)
    throw new TypeError(`${label} must be a two-element model point`);
  return point({ x: value[0], y: value[1] }, label);
}

/**
 * Read the exact camera highlight set from the authenticated native watch.
 * The helper's singular `cameraSelected` fact deliberately becomes UNKNOWN
 * for the Android double-camera glitch; the arm gate needs the complete set,
 * so it consumes the calibrated button entries from that same READ frame.
 */
function nativeCameraHighlights(read, rule) {
  const unknown = reason => ({ state: 'UNKNOWN', reason });
  if (read?.read !== 'OBSERVED') return unknown('read-unavailable');
  const ageUs = Number(read.ageUs);
  if (!Number.isFinite(ageUs) || ageUs < 0) return unknown('read-unavailable');
  if (ageUs > 500000) return unknown('read-stale');
  const highlights = [];
  for (const button of rule.adapter.buttons) {
    const raw = read[button.entry];
    if (raw === undefined || raw === 'UNKNOWN') return unknown('read-unavailable');
    const value = Number(raw);
    if (!Number.isFinite(value)) return unknown('feature-missing');
    const lower = button.rule.threshold - button.rule.refuse_band;
    const upper = button.rule.threshold + button.rule.refuse_band;
    if (value >= upper) highlights.push(button.control);
    else if (value > lower) return unknown('ambiguous-threshold');
  }
  if (highlights.length === 0) return unknown('no-camera-highlight');
  return { state: 'OBSERVED', value: highlights };
}

function createHidSender(hidProcess, { registerDelayMs = 0 } = {}) {
  const name = 'FNAF Campaign Menu';
  const transport = new HidWireTransport({
    write: line => hidProcess.write(line),
    ready: () => hidProcess.ready(name),
    name,
    contactMs: CUSTOM_NIGHT_CONTACT_MS,
    registerDelayMs,
  });
  return {
    transport,
    send: ({ point: target, durationMs = CUSTOM_NIGHT_CONTACT_MS }) => transport.send({
      command: { action: { kind: 'press', durationMs }, source: { controller: 'modern-campaign-menu' } },
      point: target,
    }),
  };
}

/**
 * Create all ports for one explicit phone. Construction is side-effect free:
 * it does not start HID, query the helper, capture the screen, or press a
 * menu item. Those actions occur only after campaign preflight is READY.
 *
 * `configReadback` is an optional measured Custom Night readback adapter. The
 * default CLI intentionally leaves it absent until a config-model artifact is
 * reviewed; a missing reader refuses before a dial is changed.
 */
/** @param {any} options */
/** The measured window between a title press and the office frame beginning to load: 0.6 s when
 * the cursor already sat on the row, 3.6 s when the press had to focus it first (2026-09-17).
 * A timed start must not hold the menu phase open across it. */
export const PRESS_TO_OFFICE_MS = [600, 3600];

/**
 * Whether the seed a run measured belongs to the press that was timed, or why it does not.
 * The activating press fixes the seed, and which press that is depends on where the title cursor
 * already sat. A run whose office seed falls the measured interval after the planned instant was
 * timed; one outside it was started by some other press, its residue means nothing, and the
 * attempt is void rather than a sample.
 * @param {{plannedPhoneWallMs: number | null, seedPhoneWallMs: number | null}} run
 */
export function timedStartHeld({ plannedPhoneWallMs, seedPhoneWallMs }) {
  if (plannedPhoneWallMs === null || seedPhoneWallMs === null)
    return { held: false, reason: 'no planned instant, or no seed was read' };
  const delayMs = seedPhoneWallMs - plannedPhoneWallMs;
  const [lo, hi] = PRESS_TO_OFFICE_MS;
  if (delayMs < lo)
    return { held: false, delayMs, reason: `the seed is ${Math.round(delayMs)} ms after the planned press, sooner than any office load` };
  if (delayMs > hi + 2000)
    return { held: false, delayMs, reason: `the seed is ${Math.round(delayMs)} ms after the planned press, too late to be its night` };
  return { held: true, delayMs };
}

export async function createCampaignPorts(options = {}) {
  const { spec, bundle, profile, calibration, calibrationPath = null, qualification, serial, adb = 'adb',
    // `armMode` is undefined for a plan that declares no #arm-verify.  It must
    // NOT default to 'blocking' here: cli.js already maps `--arm-none` to
    // undefined, and a default parameter turns that back into 'blocking',
    // which campaign-bundle.js then refuses as "armMode requires an
    // arm-verified plan".  Only the double-camera-glitch strategies (minus-toys,
    // minus3) carry that header, so the default locked every glitchless
    // strategy -- Minus 7 among them -- out of the device lane entirely.
    machineOnly = false, allowSaveReset = false, armMode = undefined, captureRestarted = false,
    nightAnchorAimMs = null, nightAnchorMaxK = null, nightAnchorPeriodMs = 1000, nightAnchorStrict = false, nightAnchorAuthorizeOnLatch = false,
    teachOverlay = false } = options;
  if (typeof teachOverlay !== 'boolean') throw new TypeError('teachOverlay must be boolean');
  // The teach panel narrates from the anchor's release; an unanchored night
  // has no origin on the helper's clock to narrate from.
  if (teachOverlay && nightAnchorAimMs === null) throw new TypeError('teachOverlay requires a night anchor');
  if (typeof serial !== 'string' || serial.length === 0) throw new TypeError('modern campaign ports require an ADB serial');
  if (typeof allowSaveReset !== 'boolean') throw new TypeError('allowSaveReset must be boolean');
  if (typeof captureRestarted !== 'boolean') throw new TypeError('captureRestarted must be boolean');
  // The aim is a phase of the game timer the route is banded against: the
  // one-second grid on Night 5 (Balloon Boy), the five-second Foxy roll grid
  // on Night 6 (g337). The period travels with the aim from the fact register.
  if (!(Number.isInteger(nightAnchorPeriodMs) && nightAnchorPeriodMs > 0))
    throw new TypeError('nightAnchorPeriodMs must be a positive integer number of milliseconds');
  if (nightAnchorAimMs !== null && !(Number.isFinite(nightAnchorAimMs) && nightAnchorAimMs >= 0 && nightAnchorAimMs < nightAnchorPeriodMs))
    throw new TypeError(`nightAnchorAimMs must be null or a millisecond epoch in [0, ${nightAnchorPeriodMs})`);
  // The aim is only as good as the whole seconds it was confirmed at: an aim
  // without its register bound would anchor at an unscored k.
  if (nightAnchorAimMs !== null && !(Number.isInteger(nightAnchorMaxK) && nightAnchorMaxK >= 0))
    throw new TypeError('nightAnchorAimMs requires nightAnchorMaxK, a non-negative integer');
  // An arm-verified plan still has to name a mode; a glitchless plan must be
  // able to say "no arm verification" rather than being forced to pick one.
  if (armMode !== undefined && !['blocking', 'observe-once'].includes(armMode))
    throw new TypeError('armMode must be blocking or observe-once');
  if (profile?.actuator !== 'hid-multi' || profile?.visualSensor !== 'mediaprojection')
    throw new TypeError('modern campaign ports require a HID + MediaProjection profile');
  const bridge = new AdbDeviceBridge({ serial, adb });
  if (!captureRestarted) {
    const restarted = await bridge.restartCueHelperCapture({ target: 'fnaf2', screen: 'menu' });
    if (restarted.status !== 'READY')
      throw new Error(`Cue Helper capture restart failed: ${restarted.output ?? restarted.status}`);
  }
  const evidenceDirectory = resolve('artifacts', `campaign-${new Date().toISOString().replaceAll(':', '-')}`);
  await mkdir(evidenceDirectory, { recursive: false });
  await writeFile(join(evidenceDirectory, 'request.json'), JSON.stringify({ spec, bundle, profile,
    execution: { armMode } }, null, 2));
  const onEvent = event => {
    const row = JSON.stringify({ at: new Date().toISOString(), ...event });
    appendFileSync(join(evidenceDirectory, 'events.jsonl'), row + '\n');
    process.stderr.write(row + '\n');
  };
  onEvent({ type: 'evidence.started', evidenceDirectory });
  onEvent({ type: 'arm.mode', mode: armMode });
  let lastLabel = null;
  let lastFrameAt = 0;
  let frameNumber = 0;
  bridge.recordObservation = async ({ script, png, stdout, stderr, code }) => {
    const label = lastLine(stdout);
    const at = Date.now();
    const retain = label !== lastLabel || !label.startsWith('state=night') || at - lastFrameAt >= 10000;
    let frame;
    if (retain) {
      frame = `${String(++frameNumber).padStart(5, '0')}-${script}.png`;
      await writeFile(join(evidenceDirectory, frame), png);
      lastFrameAt = at;
    }
    await appendFile(join(evidenceDirectory, 'observations.jsonl'), JSON.stringify({ at, script, label, code, stderr, frame }) + '\n');
    if (label !== lastLabel) onEvent({ type: 'observation', label, frame });
    lastLabel = label;
  };
  // Endpoint discovery is bounded and happens before the executor is armed;
  // no input is sent here. The modern artifact executor consumes only the
  // validated semantic bundle and the authenticated Cue Helper read port.
  const cuePort = new AdbCueHelperPort({ serial, adb });
  let cueEndpoint = cuePort.discover();
  // The FNaF 2 legacy readers (FRAME, READ, TRACE, the onset latch) run only
  // while the Companion's target is retail FNaF 2; name it, and show the
  // phone who holds the lease. A pre-0.2.0 helper answers unknown-verb, which
  // changes nothing this lane reads.
  onEvent({ type: 'companion.announce', ...(await cuePort.announce({ target: 'fnaf2',
    lease: `fnaf2-campaign:${process.pid}` })) });
  const cueTransport = new CueHelperControlTransport({
    request: line => cuePort.request(line), token: cueEndpoint.token,
  });
  const refreshCueEndpoint = () => {
    cueEndpoint = cuePort.discover();
    cueTransport.token = cueEndpoint.token;
    return cueEndpoint;
  };
  // The teach panel (--teach-overlay): the helper narrates the schedule this
  // attempt is about to run, for a person watching. Every step is best-effort
  // and evented; a refusal leaves the night exactly as it runs without one.
  // The forward is opened here, at setup, because opening it blocks.
  let teach = null;
  if (teachOverlay) {
    try { teach = { channel: cuePort.openLesson({ lessonLine: LESSON_LINE }), lessonId: null }; }
    catch (error) { onEvent({ type: 'teach.unavailable', error: String(error?.message ?? error) }); }
  }
  const teachArm = async target => {
    if (!teach) return;
    teach.lessonId = null;
    try {
      const lesson = lessonForNight(bundle, target.night);
      let reply = '';
      for (const line of lessonLines(cueEndpoint.token, lesson)) reply = await teach.channel.send(line);
      teach.lessonId = lesson.id;
      onEvent({ type: 'teach.lesson', status: 'armed', id: lesson.id, night: target.night,
        rows: lesson.rows.length, reply });
    } catch (error) {
      onEvent({ type: 'teach.lesson', status: 'refused', night: target.night, error: String(error?.message ?? error) });
    }
  };
  const teachOrigin = async release => {
    if (!teach?.lessonId) return;
    if (release?.status !== 'released') {
      onEvent({ type: 'teach.origin', status: 'skipped', reason: release?.status ?? 'unanchored' });
      return;
    }
    try {
      const reply = await teach.channel.send(lessonOriginLine(cueEndpoint.token, release));
      onEvent({ type: 'teach.origin', status: 'running', id: teach.lessonId,
        onsetDeviceMs: release.onsetDeviceMs, afterOnsetMs: release.afterOnsetMs, reply });
    } catch (error) {
      onEvent({ type: 'teach.origin', status: 'refused', error: String(error?.message ?? error) });
    }
  };
  const teachClear = async reason => {
    if (!teach?.lessonId) return;
    const id = teach.lessonId;
    teach.lessonId = null;
    try {
      await teach.channel.send(`LESSON ${cueEndpoint.token} clear`);
      onEvent({ type: 'teach.clear', id, reason });
    } catch (error) {
      onEvent({ type: 'teach.clear', id, reason, status: 'failed', error: String(error?.message ?? error) });
    }
  };
  const [cameraRule, monitorRule, maskRule] = await Promise.all([
    readJson(CAMERA_RULE).then(parseCameraRule),
    readJson(MONITOR_RULE).then(parseMonitorRule),
    readJson(MASK_RULE).then(parseMaskRule),
  ]);
  const maskLimitations = (maskRule.adapter?.limitations ?? []).filter(value =>
    typeof value === 'string' && value.length <= 63);
  // The fitted mask rule is intentionally diagnostic-only until its blackout
  // and animation limitations are retired. Preserve that fact in each ACK so
  // later analysis cannot mistake a useful trace clue for a live safety gate.
  const maskEvidence = maskLimitations.length
    ? `diagnostic-provisional:${maskLimitations.join(',')}` : 'calibrated';
  let armWatchLoaded = false;
  const ensureArmWatch = () => {
    if (armWatchLoaded) return;
    const status = cueTransport.watch('status');
    if (typeof status.spec !== 'string' || !/^[0-9a-f]{64}$/.test(status.spec))
      throw new Error('native camera watchlist status has no valid spec hash');
    const active = status.watch === 'ACTIVE';
    const loaded = active ? status : cueTransport.watch(status.spec);
    if (loaded.watch !== 'ACTIVE' || loaded.spec !== status.spec)
      throw new Error('native camera watchlist did not activate');
    armWatchLoaded = true;
  };
  const observeArm = () => {
    if (!armWatchLoaded) throw new Error('native camera watchlist is not active');
    const read = cueTransport.read();
    const highlights = nativeCameraHighlights(read, cameraRule);
    const cameraValues = Object.fromEntries(cameraRule.adapter.buttons.map(button =>
      [button.control, read[button.entry] ?? 'UNKNOWN']));
    return {
      sequence: read.seq,
      highlights: highlights.state === 'OBSERVED' ? highlights.value : null,
      cameraValues,
      // A true double highlight intentionally has no singleton camera fact.
      // The declared viewing camera is verified by the exact pair contract.
      viewing: null,
      reason: highlights.state === 'UNKNOWN' ? highlights.reason : null,
    };
  };
  const observeControlState = () => {
    // FRAME carries the snapshot and its 20x9 grid under one sequence. A
    // GET/GRID pair is deliberately not used here: those reads cannot prove
    // they describe the same image at the helper's capture cadence.
    const frame = cueTransport.frame();
    const monitor = measureMonitorUp(frame, monitorRule, { cells: frame.cells });
    const mask = measureMaskOn(frame, maskRule, { cells: frame.cells });
    // The fitted monitor rule answers only on the office HUD -- the screen a
    // raised monitor hides. Measured on Night 5 (campaign-2026-09-09T14-14-39,
    // 41 observations: 40 false, 1 true) it never once saw the monitor up,
    // while the retained video shows the camera feed up for half the night.
    // A visible camera highlight is the positive evidence it cannot give, so
    // the two are read as complements rather than one replacing the other:
    // highlights decide monitor-up, the office HUD decides monitor-down.
    /** @type {{state: string, reason?: string, value?: string[]}} */
    let panel = { state: 'UNKNOWN', reason: 'camera-watch-unavailable' };
    let panelRead = null;
    try {
      ensureArmWatch();
      panelRead = cueTransport.read();
      panel = nativeCameraHighlights(panelRead, cameraRule);
    } catch { /* the fitted rule still carries the monitor-down half */ }
    // The camera rule is calibrated on monitor-up frames only; its behaviour
    // over the office is unmeasured. The helper's own screen classifier is the
    // independent guard: FNAF2_NIGHT is the office HUD, which a raised monitor
    // covers, so a highlight claimed against it is a contradiction and not a
    // state. FRAME and READ are separate round trips, so this also catches a
    // pairing straddling a real transition.
    const officeOnScreen = frame.screen === 'FNAF2_NIGHT';
    const panelUp = panel.state === 'OBSERVED' && !officeOnScreen ? true : null;
    // A positive monitor-rule result on a known office frame is impossible:
    // the office HUD is covered by a raised monitor. Do not let a stale or
    // overfit rule manufacture the illegal half of the pair.
    const ruleUp = monitor.state === 'OBSERVED' &&
      !(officeOnScreen && monitor.value === true) ? monitor.value : null;
    const contradicted = panel.state === 'OBSERVED' && officeOnScreen;
    const rawMonitorUp = panelUp ?? ruleUp;
    const rawMaskOn = mask.state === 'OBSERVED' ? mask.value : null;
    const exclusive = reconcileExclusiveControls({
      monitorUp: rawMonitorUp, maskOn: rawMaskOn,
    });
    const monitorUp = exclusive.monitorUp;
    const monitorSource = panelUp !== null ? 'camera-panel'
      : ruleUp !== null ? 'monitor-rule' : exclusive.monitorInference;
    const maskOn = exclusive.maskOn;
    const maskSource = exclusive.maskInference ??
      (mask.state === 'OBSERVED' ? 'mask-rule' : null);
    let visualCapture = null;
    try { visualCapture = cueTransport.visualAcquisition(frame); }
    catch { /* an unavailable timestamp leaves the state ACK usable but bounded */ }
    return {
      sequence: frame.seq,
      ageUs: frame.ageUs,
      screen: frame.screen,
      // The helper's fixed downward-chevron scores, carried through untouched.
      // They are the strongest tell the device offers for whether the office
      // controls are drawn, and the cycle gate refuses rather than falling back
      // to luma when they are missing (packages/adapters button-strokes.js).
      maskButtonDownstroke: frame.mask_button_downstroke ?? null,
      monitorButtonDownstroke: frame.monitor_button_downstroke ?? null,
      monitorUp,
      ...(monitorSource ? { monitorSource } : {}),
      panelSequence: panelRead?.seq ?? null,
      monitorReason: monitorUp !== null ? null
        : exclusive.contradiction ? exclusive.reason
        : contradicted ? 'camera-panel-over-office-hud'
        : monitor.state === 'UNKNOWN' ? monitor.reason : panel.reason,
      maskOn,
      ...(maskSource ? { maskSource } : {}),
      maskReason: maskOn !== null ? null
        : exclusive.contradiction ? exclusive.reason
        : mask.state === 'UNKNOWN' ? mask.reason : null,
      // A frame the fitted rule cannot classify is the only frame worth the
      // bytes: retaining its sensor row is what lets a later refit cover the
      // state, instead of another night spent rediscovering that it exists.
      ...(mask.state === 'OBSERVED' ? {} : { maskCells: frame.cells }),
      // The helper's darkness feature, carried so a refused frame can still
      // refute mask-on. It is never used to assert mask-on: that is the one
      // direction a blackout is indistinguishable from the mask.
      gridLuma: Math.floor(frame.cells.reduce((sum, cell) =>
        sum + (((77 * ((cell >> 16) & 0xff)) + (150 * ((cell >> 8) & 0xff)) +
          (29 * (cell & 0xff))) >> 8), 0) / frame.cells.length),
      maskEvidence: exclusive.maskInference === 'monitor-up-complement'
        ? 'exclusive-monitor-up' : maskEvidence,
      ...(visualCapture ? { visualCaptureAt: visualCapture.at,
        visualCaptureUncertaintyMs: visualCapture.uncertaintyMs } : {}),
    };
  };
  // MODEL_ONLY is a claim level, not a different transport. Even an explicit
  // machine-only experiment must use this modern device-local artifact path so
  // every requested night gets its own bound plan and no legacy shell driver
  // can be selected by accident.
  let menuHid = null;
  const localExecutor = new AdbDeviceLocalArtifactExecutor({ serial, adb,
      observe: () => lifecycle(bridge, serial), observeArm, observeControlState,
      // The title transport is already InputReader-ready when the story row
      // activates. Reuse that process through the intro so the night never
      // pays a second /system/bin/hid registration delay.
      sharedHid: () => menuHid?.process ?? null,
      nightReleaseOwner: nightAnchorAimMs === null ? 'observer' : 'port',
      pollMs: 250, onEvent,
      onOutput: output => onEvent({ type: 'hid.stderr', output }) });
  const titleModel = await readJson(TITLE_MODEL);
  const modelPath = TITLE_MODEL.pathname;
  // Set when save() observes the game roll a 6 AM straight into the next
  // night's gameplay (story Nights 1..4 on this build). The next night's
  // menu step is then satisfied by the roll: there is no title to read.
  let rolledIntoNight = 0;

  const openMenuHid = () => {
    if (!menuHid) {
      const process = new AdbHidProcess({ serial, adb });
      const sender = createHidSender(process, { registerDelayMs: 6000 });
      menuHid = { process, sender };
    }
    return menuHid.sender;
  };

  const closeMenuHid = async () => {
    const current = menuHid;
    menuHid = null;
    await current?.process.close();
  };

  const artifactRequestFor = target => makeCampaignExecutionRequest({
    bundle, plan: bundle.plans.find(item => item.night === target.night), profile,
    mode: 'live', artifact: bundle.artifact, armMode,
  });
  let pendingExecution = null;
  const prearm = target => {
    // The native watchlist is a synchronous Cue Helper operation. Load it
    // before starting the held executor so its setup cannot block the
    // phase-critical night release later in intro().
    if (bundle.plans.find(plan => plan.night === target.night)?.armVerification)
      ensureArmWatch();
    if (pendingExecution) return;
    pendingExecution = localExecutor.execute(artifactRequestFor(target));
    // executeAttempt surfaces the failure; nothing else may await it.
    pendingExecution.catch(() => {});
  };

  const tap = async ({ point: target, holdMs = CUSTOM_NIGHT_CONTACT_MS }) => {
    point(target, 'tap point');
    const sender = openMenuHid();
    await sender.transport.send({
      command: { action: { kind: 'press', durationMs: holdMs }, source: { controller: 'modern-campaign' } },
      point: target,
    });
  };

  // Twin-nights clock seeding. FNAF_START_PHONE_WALL_RESIDUE_MS places the press that
  // starts a night when the phone's wall clock reaches that residue modulo 65 536 ms.
  // The stock game seeds its 16-bit RNG from (short) System.currentTimeMillis() in
  // CRun.allocRunHeader, the first instruction of CRun.initRunLoop, which the office
  // frame's load reaches a fixed transition after this press: 3612-3614 ms on the
  // Custom Night path over three runs, with the load itself the only loose part
  // (docs/evidence/night6-h-seedlock-census-20260916.json). The press is stamped in
  // phone wall time either way, and a requested timed start never falls back to an
  // untimed tap.
  const startResidueMs = () => {
    const text = process.env.FNAF_START_PHONE_WALL_RESIDUE_MS ?? '';
    return text === '' ? null : Number(text);
  };
  const stampedStartTap = async ({ point: target, holdMs, kind, refusal }) => {
    const residueMs = startResidueMs();
    let clock = null;
    let plan = null;
    let tapped = false;
    try {
      clock = cuePort.openClock();
      const before = await clock.probe({ samples: 8 });
      if (residueMs !== null) {
        plan = planTimedStart({ sample: before, residueMs, nowHostMs: performance.now() });
        onEvent({ type: `${kind}.start-planned`, residueMs, targetPhoneWallMs: plan.targetPhoneWallMs,
          waitMs: plan.waitMs, uncertaintyMs: before.uncertaintyMs });
        await waitUntilHostMs(plan.targetHostMs);
      }
      const tapHostMs = performance.now();
      tapped = true;
      await tap({ point: target, holdMs });
      const after = await clock.probe({ samples: 4 });
      const tapPhoneWallMs = phoneWallAt(after, tapHostMs);
      onEvent({ type: `${kind}.start`, tapHostMs, tapPhoneWallMs, tapPhoneWallLow16: Math.floor(tapPhoneWallMs) % 65536,
        plannedPhoneWallMs: plan?.targetPhoneWallMs ?? null, lateMs: plan ? tapHostMs - plan.targetHostMs : null,
        uncertaintyMs: after.uncertaintyMs });
    } catch (error) {
      if (residueMs !== null) throw new Error(`${refusal}: ${error?.message ?? error}`);
      onEvent({ type: `${kind}.start`, status: 'unstamped', reason: String(error?.message ?? error) });
      if (!tapped) await tap({ point: target, holdMs });
    } finally {
      clock?.close();
    }
  };

  const menu = async ({ target }) => {
    // A story night the game rolled straight into after the previous night's
    // observed 6 AM: the roll performed the selection, no title exists to
    // read, and no press may be sent. Anything else still goes through the
    // observed-title path below.
    if (rolledIntoNight === target.night && target.mode === 'story' && target.menuTarget === 'continue') {
      const state = await lifecycle(bridge, serial);
      if (state !== 'night')
        throw new Error(`rolled-through night ${target.night} left gameplay before its attempt (state=${state})`);
      return { target: target.menuTarget, visible: false, selected: true, observed: true,
        rolledThrough: true, state };
    }
    // Seconds before the night, far from the phase-critical release.
    await teachArm(target);
    const items = await title(bridge, serial, modelPath);
    const targetName = target.menuTarget;
    if (!items.includes(targetName)) return { target: targetName, visible: false, selected: false, observed: true };
    if (targetName === 'newGame' && !allowSaveReset)
      throw new Error('New Game requires the explicit allow-save-reset capability');
    // HID registration waits for Android InputReader. Re-read the title after
    // that bounded wait so the press is tied to a fresh target observation.
    const sender = openMenuHid();
    await sender.transport.start();
    // Register and qualify the one HID process while the title is still
    // visible; the intro and gameplay schedule reuse this ready process.
    const freshItems = await title(bridge, serial, modelPath);
    if (!freshItems.includes(targetName))
      return { target: targetName, visible: false, selected: false, observed: true, items: freshItems };
    const targetPoint = targetName === 'customNight'
      ? point(calibration?.menu?.point, 'calibration.menu.point')
      : modelPoint(titleModel.items?.[targetName], `title model ${targetName}`);
    const holdMs = targetName === 'customNight' ? calibration.menu.holdMs : CUSTOM_NIGHT_CONTACT_MS;
    // This build separates focusing a title row from activating it: the first press paints the
    // `>>` cursor and a second press activates the focused row -- unless the row was already
    // focused, and then the FIRST press activates. An untimed start does not care which press
    // did it. A timed story start does, because only the activating press fixes the office seed.
    //
    // A read taken just after a press shows the title whether the press focused the row or
    // started the night, and returning on that read is the race that cost two timed attempts. On
    // 2026-09-17 (twin-01) the timed second press landed 15 s into a night the first press had
    // started. On 2026-09-18 (tw-01) the untimed first press started Night 6 on a freshly
    // relaunched game, the read came back `title`, and the night ran 47 s with no executor while
    // this phase waited for the residue -- so "a relaunched game has the cursor off the row" is
    // not a premise this path may rest on.
    //
    // A timed start therefore places EVERY press it may send on the residue, and after the first
    // one it reads the state only once the press has had time to act (settledAfterPress), with
    // the answer in before the office appears. Holding this phase open across the office load is
    // what makes the strict anchor refuse a night as onset-predates-intro, so when that read
    // already shows the night beginning it is used as the entry state and no further read is
    // spent. Whichever press activated, the seed follows a timed instant; timedStartHeld reads
    // back from the seed which one.
    const residueMs = startResidueMs();
    const timedStory = residueMs !== null && targetName !== 'customNight';
    let firstSelectionState;
    if (timedStory) {
      const timedTap = () => stampedStartTap({ point: targetPoint, holdMs, kind: 'menu',
        refusal: `timed ${targetName} start refused` });
      await timedTap();
      firstSelectionState = await settledAfterPress(() => lifecycle(bridge, serial));
      onEvent({ type: 'menu.press-settled', press: 1, state: firstSelectionState });
      if (firstSelectionState === 'title') await timedTap();
    } else {
      await tap({ point: targetPoint, holdMs });
      firstSelectionState = await waitFor(bridge, serial,
        value => value === 'title' || value === 'titleDialog' || value === 'intro' || value === 'night',
        10000, 'title row focus or night start');
      if (firstSelectionState === 'title') await tap({ point: targetPoint, holdMs });
    }
    if (targetName === 'customNight')
      return { target: targetName, visible: true, selected: true, observed: true,
        menuPresses: firstSelectionState === 'title' ? 2 : 1 };

    // Continue/6th Night activates the intro after the focused-row press.
    // Keep the already-qualified menu HID open through the intro: the gameplay
    // executor hands its first schedule lines to this same process after the
    // office frame is observed.
    if (targetName !== 'newGame') {
      // A first read that already saw the night begin is the entry state: another read costs
      // 1-2 s, and intro() has to stamp before the office appears.
      const entryState = ['intro', 'newspaper', 'night'].includes(firstSelectionState)
        ? firstSelectionState
        : await waitFor(bridge, serial,
          value => value === 'intro' || value === 'newspaper' || value === 'night',
          30000, 'night selection');
      prearm(target);
      return { target: targetName, visible: true, selected: true, observed: true,
        menuPresses: firstSelectionState === 'title' ? 2 : 1, entryState };
    }

    // New Game raises a measured confirmation dialog. The capability above
    // authorizes the save reset; this second observation proves the dialog is
    // actually present before the calibrated Yes coordinate is pressed. A
    // direct transition is also accepted for builds/states that do not show
    // the prompt, but no unobserved confirmation press is allowed.
    const confirmationState = await waitFor(bridge, serial,
      value => value === 'titleDialog' || value === 'intro' || value === 'night',
      30000, 'new-game confirmation or night start');
    if (confirmationState === 'titleDialog') {
      const yesPoint = modelPoint(titleModel.items?.sixthNight,
        'title model new-game confirmation yes');
      await tap({ point: yesPoint });
      const newGameState = await waitFor(bridge, serial,
        value => value === 'intro' || value === 'newspaper' || value === 'night',
        30000, 'new-game night start');
      prearm(target);
      return { target: targetName, visible: true, selected: true, observed: true,
        saveResetAuthorized: true, confirmation: 'observed-and-accepted', entryState: newGameState };
    }
    prearm(target);
    return { target: targetName, visible: true, selected: true, observed: true,
      saveResetAuthorized: true, confirmation: 'not-present', entryState: confirmationState };
  };

  const intro = async ({ target }) => {
    // Pre-arm the device-local schedule while the intro card plays. The
    // executor's night_go gate holds every plan action -- arm taps included --
    // until the lifecycle observer positively sees the office. The title HID
    // stays alive, so spawning during the intro no longer spends plan time on
    // a second registration and ready delay: the grid origin lands within one
    // poll of 12 AM instead of the measured 7.8 s post-office handoff lag.
    prearm(target);
    // Any onset the helper latched before this instant belongs to an earlier
    // night; the anchor refuses it.
    const introStartedHostMs = performance.now();
    // Do not accept the night transition on the newspaper/intro card: the
    // authoritative office `night` state establishes the actuator origin.
    // With an anchor, the executor's observer usually sees the office first,
    // so take whichever edge comes first; the slower poll then ends on its
    // next sample, and its failure cannot crash a night the executor authorized.
    let executorAuthorized = false;
    const lifecycleNight = waitFor(bridge, serial, value => value === 'night' || executorAuthorized,
      30000, 'night start');
    let state;
    if (nightAnchorAimMs === null) {
      state = await lifecycleNight;
      // This is the phase-critical handoff. The measurement deliberately leaves
      // setup taps out of the path so the already-ready HID can act immediately
      // after the first authoritative office frame.
      localExecutor.releaseNight();
    } else {
      // The office classification only AUTHORIZES; the release is planned from
      // the helper's latched onset while the intro card is still up, and fires
      // at onset + aim + k s once authorized (night-anchor.js). Any refusal
      // releases at authorization.
      let authorizedAtHostMs = null;
      const authorized = Promise.race([
        lifecycleNight,
        localExecutor.whenNightAuthorized().then(() => { executorAuthorized = true; return 'night'; }),
      ]).then(value => { authorizedAtHostMs ??= performance.now(); return value; });
      let clock = null;
      try { clock = cuePort.openClock(); }
      catch (error) { onEvent({ type: 'origin.anchor', status: 'unavailable', reason: 'probe-failed', error: String(error?.message ?? error) }); }
      const anchoring = clock === null
        ? authorized.then(() => { localExecutor.releaseNight(); })
        : anchorNightRelease({ clock,
          authorization: { isAuthorized: () => authorizedAtHostMs !== null, whenAuthorized: () => authorized,
            authorizedAt: () => authorizedAtHostMs },
          release: () => localExecutor.releaseNight(), onEvent,
          aimMs: nightAnchorAimMs, maxK: nightAnchorMaxK, periodMs: nightAnchorPeriodMs, strict: nightAnchorStrict === true, authorizeOnLatch: nightAnchorAuthorizeOnLatch === true,
          notBeforeHostMs: introStartedHostMs });
      anchoring.catch(() => {});
      try {
        state = await authorized;
        const release = await anchoring;
        // Not awaited: the origin is one socket write on an open forward, and
        // nothing about the night waits for the panel.
        void teachOrigin(release);
      } finally {
        clock?.close();
        if (executorAuthorized) lifecycleNight.catch(() => {});
      }
    }
    // The 6th Night and Custom Night menu targets identify the configured
    // night. A story night inside a chained campaign is identified by its
    // selection chain: newGame on an observed fresh save, continue after the
    // previous night's observed 6 AM, or continue from an operator-observed
    // save cursor equal to the target night. A standalone continue with an
    // unobserved cursor keeps its identity unknown and is not promoted.
    const storyTargets = spec.nights.filter(entry => entry.mode === 'story');
    const chainedStory = target.mode === 'story' &&
      (target.menuTarget === 'newGame' ||
        (target.menuTarget === 'continue' &&
          (storyTargets.findIndex(entry => entry.night === target.night) > 0 ||
            target.saveCursorObserved === target.night)));
    const identified = target.menuTarget === 'sixthNight' || target.menuTarget === 'customNight' ||
      chainedStory;
    return { night: target.night, identity: identified ? target.mode : 'unknown', observed: identified, state };
  };

  const terminal = async ({ target, execution }) => {
    const published = terminalFromExecution({ target, execution });
    if (published) {
      onEvent({ type: 'campaign.terminal.from-executor',
        state: published.state, outcome: published.outcome });
      return published;
    }
    // The schedule already spanned the night; the game clock can trail the
    // plan by a minute, so the terminal window is generous, not 15 s.
    const state = await waitFor(bridge, serial,
      value => value === 'sixam' || value === 'gameover', 120000, 'night terminal');
    if (state === 'sixam') return { night: target.night, identity: target.mode,
      outcome: 'sixam', sixAm: true, positive: true, state };
    if (state === 'gameover') return { night: target.night, identity: target.mode,
      outcome: 'death', sixAm: false, positive: false, state };
    return { night: target.night, identity: target.mode, outcome: 'unknown', sixAm: false, positive: false, state };
  };

  const terminalVerification = async ({ target }) => {
    const state = await lifecycle(bridge, serial);
    return { night: target.night, sixAm: state === 'sixam', positive: state === 'sixam', state };
  };

  const save = async ({ target }) => {
    // Story Nights 1..4 roll a 6 AM straight into the next night's gameplay
    // on this build — regardless of spec shape — while Night 5 (and 6) end
    // in the paycheck/title instead. For a rolling night the observed roll
    // into night N+1 is the advancement evidence; the deadline must span the
    // 6 AM jingle, newspaper, and intro card, so it is generous like the
    // terminal window, not 15 s.
    const rollsIntoNext = target.night >= 1 && target.night <= 4;
    if (rollsIntoNext) {
      const state = await waitFor(bridge, serial, value => value === 'night', 90000, 'post-win next-night roll');
      rolledIntoNight = target.night + 1;
      return { observed: true, advanced: true, nextNightStarted: true, state };
    }
    await waitFor(bridge, serial, value => value === 'title', 90000, 'post-win title menu');
    const items = await title(bridge, serial, modelPath);
    if (target.night === 6) {
      // `sixthNight` is not evidence of advancement: it was already visible
      // before this campaign. Custom Night visibility is the only currently
      // calibrated positive advancement signal; otherwise proof refuses.
      return { observed: true, customNightVisible: items.includes('customNight'),
        cursorNight: undefined, items };
    }
    if (target.night === 7) {
      return { observed: true, menuReturned: true, customCompleted: items.includes('customNight'), items };
    }
    // Story Nights 1..5: the save advanced when Continue is visible after a
    // 6 AM that this campaign started; Night 5's clear additionally reveals
    // the measured sixthNight item.
    return { observed: true, menuReturned: true,
      continueVisible: items.includes('continue'),
      ...(target.night === 5 ? { sixthNightVisible: items.includes('sixthNight') } : {}),
      items };
  };

  const retryReady = async ({ target }) => {
    await waitFor(bridge, serial, value => value === 'title', 15000, 'retry title menu');
    const items = await title(bridge, serial, modelPath);
    return { menuReady: items.includes(target.menuTarget), observed: true, items };
  };

  // The Custom Night dial readback: tools/device/custom-night-readback.py over
  // a screenshot, with the measured calibration and the glyph fingerprints
  // that sit beside it (models/custom-night-glyphs-v1.json). An explicit
  // `configReadback` in options still wins (tests, fixtures).
  const configReadback = options.configReadback ?? (calibrationPath === null ? undefined
    : async ({ bridge: readBridge, serial: readSerial }) => {
      const glyphs = join(dirname(resolve(calibrationPath)), 'custom-night-glyphs-v1.json');
      // The dial screen follows the title tap after a transition of variable
      // length: night7-anchoredi3 read the title (">> Custom Night" selected)
      // and refused. Re-read until the dials are legible, within a budget.
      let last = { status: 'UNKNOWN', reason: 'no readback attempted' };
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const result = await captureAndObserve(readBridge, readSerial, CUSTOM_NIGHT_READBACK,
          ['--calibration', resolve(calibrationPath), '--glyphs', glyphs, '--sensor', 'screencap-2400x1080']);
        try { last = JSON.parse(lastLine(result.stdout)); }
        catch { last = { status: 'UNKNOWN', reason: `readback observer exit ${result.code}: ${lastLine(result.stderr)}` }; }
        if (last.status === 'PASS') return last;
        await new Promise(resolveSleep => setTimeout(resolveSleep, 500));
      }
      return last;
    });
  const customNight = async ({ target }) => {
    validateCustomNightCalibration(calibration, { targetBuild: spec.target.build });
    if (typeof configReadback !== 'function')
      throw new Error('Custom Night readback adapter is not composed; refusing to change dials');
    const dialTap = ({ point: targetPoint, holdMs }) => tap({ point: targetPoint, holdMs });
    const dialReadback = args => configReadback({ ...args, bridge, serial });
    // The measured preset ring (custom-night-moto-g56-v207.json) has a preset
    // whose dials are exactly the target: reach it through the arrow pair
    // first (Pedro, 2026-09-13: "use o preset golden freddy" -- one contact
    // from the opening state instead of six dial taps), then let the per-dial
    // routine confirm with a fresh readback and touch nothing.
    if (calibrationPath !== null && typeof calibration.configModel === 'string') {
      const modelPath = join(dirname(resolve(calibrationPath)), calibration.configModel.split('/').at(-1));
      const model = JSON.parse(await readFile(modelPath, 'utf8'));
      const wanted = model.presets?.find(item => AI_DIALS_ALL.every(dial => item.dials?.[dial] === target.dials?.[dial]));
      if (wanted) {
        const selected = await selectCustomNightPreset({ preset: wanted.id, model, tap: dialTap, readback: dialReadback,
          direction: 'auto', targetBuild: spec.target.build });
        onEvent({ type: 'custom-night.preset', preset: wanted.id, steps: selected.steps });
      }
    }
    const configured = await configureCustomNight({ target, calibration,
      targetBuild: spec.target.build,
      tap: dialTap,
      readback: dialReadback,
    });
    // Twin-nights test of clock seeding (docs/evidence/night7-k3-wallclock-r1-20260915.json):
    // FNAF_START_PHONE_WALL_RESIDUE_MS places the Start tap when the phone's wall clock
    // reaches that residue modulo 65 536 ms (apps/device/src/timed-start.js). The tap's
    // phone wall time is logged either way; a requested timed start never falls back to
    // an untimed tap.
    await stampedStartTap({ point: calibration.start.point, holdMs: calibration.start.holdMs,
      kind: 'custom-night', refusal: 'timed Custom Night start refused' });
    return configured;
  };

  const devicePreflight = args => bridge.preflight({ targetBuild: spec.target.build,
    restartCapture: false, ...args });
  const restartAfterAbort = async reason => {
    // The HID release stops input delivery; it does not rewind the game state.
    // Close the shared title process before restarting the target so no stale
    // input can land in the fresh title/menu instance.
    await closeMenuHid();
    const detail = String(reason?.message ?? reason ?? 'campaign stopped').slice(0, 240);
    onEvent({ type: 'campaign.abort.restart', reason: detail });
    try {
      const restarted = await bridge.restartGame();
      if (restarted.status !== 'READY')
        throw new Error(`game restart failed at ${restarted.stage}: ${restarted.detail ?? 'unknown error'}`);
      const state = await waitFor(bridge, serial, value => value === 'title', 30000,
        'post-abort game restart');
      const capture = await bridge.restartCueHelperCapture({ target: 'fnaf2', screen: 'menu' });
      if (capture.status !== 'READY')
        throw new Error(`Cue Helper capture restart failed: ${capture.output ?? capture.status}`);
      const endpoint = refreshCueEndpoint();
      const refreshedState = await waitFor(bridge, serial, value => value === 'title', 30000,
        'post-abort game restart after Cue Helper capture');
      onEvent({ type: 'campaign.abort.restarted', state: refreshedState ?? state,
        launcher: restarted.launcher, cueHelperPort: endpoint.port });
    } catch (error) {
      onEvent({ type: 'campaign.abort.restart-failed', error: error.message });
      throw error;
    }
  };
  const composed = composeCampaignPorts({ spec, bundle, profile,
    artifact: bundle.artifact, armMode, devicePreflight, menu, customNight, intro,
    terminal, terminalVerification, save, retryReady, localExecutor, restartAfterAbort });
  const ports = {
    ...composed.ports,
    stopAttempt: async ({ terminal, reason }) => {
      // The terminal port may observe game-over before the executor's own
      // lifecycle poll does. Stopping here is the last gate before retryReady
      // or save() can read the title, so no stale HID stream can reach menu.
      await localExecutor.abort(`campaign-${reason ?? 'terminal'}:${terminal?.outcome ?? 'unknown'}`);
      await teachClear(`terminal:${terminal?.outcome ?? 'unknown'}`);
      // The shared title process is deliberately reused through a healthy
      // intro, but a terminal ends that ownership. Closing it is what kills
      // the already-buffered report stream; a retry will open a fresh process.
      await closeMenuHid();
      onEvent({ type: 'campaign.terminal.actuator-stopped',
        outcome: terminal?.outcome ?? null, reason: reason ?? null, hidClosed: true });
    },
    executeAttempt: async ({ target }) => {
      // intro() pre-armed the schedule during the intro card; the attempt
      // owns that execution. A retry (or any path that skipped intro)
      // falls back to composing the request here.
      if (pendingExecution) {
        const pending = pendingExecution;
        pendingExecution = null;
        return pending;
      }
      // A retry can reach the attempt port after intro has already returned;
      // grant the shared HID handoff before starting a fresh executor.
      localExecutor.releaseNight();
      return localExecutor.execute(artifactRequestFor(target));
    },
    releaseAll: async () => {
      const hadPendingExecution = pendingExecution !== null;
      pendingExecution = null;
      try {
        await composed.ports.releaseAll();
      } finally {
        await closeMenuHid();
        // The runner also uses releaseAll for a HOLD reached after menu()
        // pre-armed the next attempt. That is an abort of a live game state,
        // even though executeAttempt was never consumed, so leave no night
        // running behind for the next attempt or operator.
        if (hadPendingExecution)
          await restartAfterAbort(new Error('campaign stopped with a pre-armed attempt'));
      }
    },
    cleanup: async reason => {
      pendingExecution = null;
      try { await composed.ports.cleanup(reason); }
      finally {
        await closeMenuHid();
        await teachClear(`cleanup:${reason ?? 'unknown'}`);
      }
    },
  };
  const close = async () => {
    try { await closeMenuHid(); }
    finally { teach?.channel.close(); }
  };
  return Object.freeze({ ports, runner: new DeviceCampaignRunner({ spec, ports }), deviceLocal: true,
    close, qualification, evidenceDirectory });
}

export default createCampaignPorts;
