/**
 * Device-local executor for the modern campaign boundary.
 *
 * The host validates and flattens a bound semantic request once.  This module
 * then sends one bounded script to an on-device shell; `/system/bin/hid`
 * owns the inter-action delays on the phone.  It never accepts strategy text,
 * coordinates, or arbitrary shell input from a caller.  Coordinates are
 * resolved from the already validated profile, at the physical edge, by
 * hid-schedule.js; device-shell.js renders the script and control-effect.js
 * grades what each contact did. This module owns the adb process lifecycle,
 * the gates, the arm and the night origin.
 * CONTRACT:device-executor-v1 CONTRACT:hid-executor-v1.
 */
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { validateExecutorRequest } from './artifact-executor.ts';
import type { ArmVerification } from './artifact-executor.ts';
import { buttonStrokeState } from '@sixam/play';
import {
  DEFAULT_READY_DELAY_MS, GATE_BUDGET_MAX_MS, GATE_BUDGET_MIN_MS, GATE_BUDGET_RESERVE_MS, GATE_MIN_SLACK_MS,
  SHARED_HID_RELEASE, compileDeviceLocalHidSchedule, sharedScheduleBody,
} from './hid-schedule.ts';
import type { HidSchedule } from './hid-schedule.ts';
import { compactControlSample, controlEffectVerdict, effectTransitions } from './control-effect.ts';
import type { MaskTransition, MonitorTransition } from './control-effect.ts';
import { boundedRemotePath, renderDeviceLocalScript } from './device-shell.ts';
import type { ArmControl } from './device-shell.ts';
import { isList } from '@sixam/kernel';
import { armObservationTimes } from './arm-observation.ts';

type GatedSchedule = NonNullable<HidSchedule['gated']>;
/** One evented fact of a run; the campaign retains every one. */
type ExecutorEvent = { readonly type: string, readonly [field: string]: unknown };
/** What the camera arm observer reads: the panel's highlighted pair and the frame it came from. */
export interface ArmSample {
  readonly sequence?: unknown;
  readonly highlights?: unknown;
  readonly cameraHighlights?: unknown;
  readonly reason?: string | null;
  readonly [field: string]: unknown;
}
/** The title step's ready /system/bin/hid process, reused through the night. */
interface SharedHid {
  write(line: string): unknown;
  close?(): unknown;
}
/** Measured settles and gate knobs; fixtures shorten them, production keeps the defaults. */
interface ExecutorTiming {
  readonly armSettleMs?: number;
  readonly armObservationWindowMs?: number;
  readonly gateRetryGapMs?: number;
  readonly pollMs?: number;
  readonly gateMinSlackMs?: number;
  readonly gateBudgetMinMs?: number;
  readonly gateBudgetMaxMs?: number;
  readonly gateBudgetReserveMs?: number;
  readonly staticTerminalWaitMs?: number;
  readonly observerGapBoundMs?: number;
}
interface LedgerOptions {
  readonly timelineOffsetMs?: number;
  readonly originUncertaintyMs?: number;
  readonly attempt?: number | null;
  readonly phaseEndMs?: number | null;
}

const MAX_ARM_ATTEMPTS = 3;

/**
 * A failure that ends an attempt without testing its policy: the plan did not
 * reach the phone as compiled (a late handoff or arm release), or the
 * double-camera split it depends on was never confirmed armed (a camera-pair
 * mismatch, or no definitive camera frame through every arm attempt). Pedro,
 * 2026-09-30: these are Invalid runs (ADR 0002 decision 3), which the campaign
 * replays without spending an attempt and holds after two in a row. `why` is
 * the executor's own reason; the error still rejects, and the campaign's ports
 * read the tag.
 */
function invalidRun(message: string, why: string) {
  return Object.assign(new Error(message), { invalid: why });
}
const ARM_SETTLE_MS = 600;
// The native screen identity the Companion reports for the office HUD, and
// how often the origin anchor asks for it. The helper's own detector latency
// was measured at 43 ms, so this cadence -- not the classifier round trip --
// becomes the origin's resolution.
const NATIVE_NIGHT_SCREEN = 'FNAF2_NIGHT';
const NATIVE_ANCHOR_POLL_MS = 120;
const ARM_CONFIRM_SAMPLES = 2;
const ARM_OBSERVATION_WINDOW_MS = 3000;
const STARTUP_GRACE_MS = 30000;
const EXIT_CONFIRM_SAMPLES = 3;
// A death's static starts its terminal; it does not end the night. With static
// counted toward EXIT_CONFIRM_SAMPLES, a death could end before its Game Over
// was read: night7-corner-bbfoxy-r01-20260927T072310Z became UNKNOWN that way
// while its video shows the jumpscare. Measured over the committed run packs
// (docs/evidence/static-terminal-window-20260927.json, evidence
// static-terminal-window-fb44824c48fdc471; packages/review/bin/grade/static-terminal-window.ts):
// 32 packs read Game Over 1964-6306 ms after the first static read of a night,
// one read 6 AM 5763 ms after it, and 45 packs instead ended on the third
// static read 3119-4835 ms after the first -- two observer intervals, so one is
// at most 2418 ms. After a night is observed, a static read therefore withholds
// its exit vote until the measured maximum plus one observer interval has
// passed since the first static of its run. Game Over or 6 AM inside the window
// ends the night as usual. These numbers decide behaviour, so
// packages/play/test/static-terminal-window.test.ts reads the record and fails if
// either drifts from it (CLAUDE.md register items 7 and 9).
export const STATIC_TERMINAL_MAX_MS = 6306;
export const OBSERVER_INTERVAL_BOUND_MS = 2418;
export const STATIC_TERMINAL_WAIT_MS = STATIC_TERMINAL_MAX_MS + OBSERVER_INTERVAL_BOUND_MS;
// The first static read after a night HALTS ACTUATION; observation goes on.
//
// Until 2026-09-27 the schedule kept pressing through that window, and on the
// phone it pressed through the post-death screens: in
// night7-corner2-bbfoxy-r02-20260927T193022Z its presses skipped the ~1 s Game
// Over and entered Custom Night from the title, and in
// night7-n7-420-minimal-m3-p1b-20260927T195732Z they opened the in-app store
// from the title (k3's left vent light lies on the title's New Game). So once a
// night has been observed, the first `static` read stops the schedule -- no
// further line reaches the HID, and the shared process is closed, which is what
// kills its already-buffered stream -- while the lifecycle observer keeps
// reading. The run then ends on a Game Over or 6 AM read (COMPLETED with that
// terminal), a title read or three exit votes (as before), the window's expiry
// measured from that first static (a static exit, as before), or the existing
// deadlines and external stops. The halt is latched: a later `night` read
// neither resumes the schedule nor restarts the window, because p1b read
// `state=night` once from inside its death minigame, 123.7 s after its static.
//
// Why the FIRST static and not a confirmed one, measured over the committed
// packs (docs/evidence/post-night-static-halt-20260927.json, evidence
// post-night-static-halt-1f27592aee56cc26; packages/review/bin/grade/post-night-static.ts):
// 81 static episodes follow a night in 184 packs, and in none of them was the
// office read twice in a row again: 33 end at Game Over, 45 at the old
// three-static abort and its relaunch, 2 at the title, 1 at 6 AM. In the 27
// packs that keep every read (3523 night reads), all 26 post-night static reads
// lie in those episodes, while `newspaper` was misread inside a live night 60
// times -- the classifier does produce positive misreads mid-night, which is
// why other screens still need three votes, but it never read static there.
// The one episode that ended at 6 AM, night5-perfetto1, read it 5763 ms after
// its static -- inside the window the observer now keeps -- and its stream sat
// parked at a gate until 2920 ms after the static, so a halt there would have
// withheld one release and the 571 ms of presses before the old abort stopped
// them anyway. A confirmation read could not have protected r02: its next read
// came 8393 ms after its static, and its frames show the presses had passed
// Game Over into the Custom Night dial screen within about 6 s of the static's
// onset. packages/play/test/post-night-halt.test.ts holds these numbers to the
// record.
//
// The window assumes one observer interval of at most OBSERVER_INTERVAL_BOUND_MS
// between reads. That is not what the observer delivers: r02's reads around its
// static were 11776 and 8393 ms apart, and 721 of 3795 read-to-read gaps inside
// live nights exceed it (max 4488 ms). So after the halt every gap over the
// bound is evented (`lifecycle.observe-gap`); the observer's speed is not
// changed here.
export const POST_NIGHT_STATIC_HALT = 'post-night-static';
// Screens that end a scheduled night on their FIRST positive read once a night
// has been observed. These are not animations a healthy run passes through,
// and two of them put menu controls under the schedule's own tap coordinates.
const TERMINAL_SCREENS = new Set(['title', 'gameover', 'sixam']);
// The title HID is already ready when the intro observes the office. A
// handoff that takes longer than this has already spent the model's measured
// late margin, so the attempt is invalid rather than a silently phase-shifted
// run. This is deliberately a handoff budget, not a contact-duration change.
const NIGHT_HANDOFF_BUDGET_MS = 100;
// A monitor or mask edge is a game-state claim, not merely a HID report. No
// settle constant is asserted here: nothing in the fitted monitor/mask rules
// measures an animation duration, so the ledger samples from the contact
// onward and reports the observed latency instead of grading against a guess.
// This is a per-transition read budget, not a deadline: it bounds what one
// missing effect may spend, since reads are serialised and the next
// transition's sampling waits behind them.
const CONTROL_EFFECT_MAX_SAMPLES = 6;
// A single 10 fps frame can be ambiguous without the state being unreadable.
// UNKNOWN still stops the night, but only once it has survived resampling.
// Measured over both 2026-09-09 gated runs: given one ambiguous read, the
// chance the next is also ambiguous is 0.60 at 250 ms, 0.49 at 500 ms and
// bottoms out at 0.37 around 600 ms before rising again. Refusals are
// strongly correlated, so retries only buy anything when they are spaced at
// that minimum -- and five of them are what takes a gate's refusal rate from
// 8% to under 0.2%, which is the difference between a night that aborts and
// one that finishes.
const GATE_READ_ATTEMPTS = 5;
const GATE_RETRY_GAP_MS = 600;
// Measured over 82 frames the fitted rule read confidently across today's
// Night 5 runs: whole-grid mean luma reaches 10 at most with the mask on
// (n=52) and 25 at least with it off (n=30) -- a gap with no overlap. That
// bound refutes mask-on and nothing else. Asserting mask-on from darkness is
// exactly what `mask-calibrate.py` forbids, because a blacked-out office
// reads the same; refuting it is safe, and resolves 71% of the frames the
// anchors refuse.
const MASK_OFF_GRID_LUMA_FLOOR = 25;
const execFile = promisify(execFileCallback);

function fail(message: string): never { throw new TypeError(`adb device-local executor: ${message}`); }
/** A failure as one bounded line for an event record. */
const messageOf = (error: unknown) => String(error instanceof Error ? error.message : error).slice(0, 240);
const isEpipe = (error: unknown) => typeof error === 'object' && error !== null
  && 'code' in error && error.code === 'EPIPE';
/** What a failed adb call said: its stderr when it wrote one, else the error's message. */
const adbFailure = (error: unknown) => {
  const { stderr, message } = error as { stderr?: string, message?: string };
  return stderr?.trim() || message;
};

function runAdbScript(adb: string, serial: string, script: string, onOutput: (chunk: string) => void = () => {}) {
  const child = spawn(adb, ['-s', serial, 'shell', 'sh', '-s'], {
    stdio: ['pipe', 'ignore', 'pipe'], shell: false,
  });
  let stderr = '';
  const promise = new Promise<void>((resolve, reject) => {
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); onOutput(chunk.toString()); });
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve()
      : reject(new Error(`device-local HID shell exited with ${code}: ${stderr.trim()}`)));
  });
  // A game-over watchdog can terminate the remote shell while the bounded
  // script is still being flushed into adb.  Node otherwise reports the
  // resulting EPIPE as an unhandled stream error; the child close/error event
  // remains the authoritative transport result.
  child.stdin.on('error', error => {
    if (!isEpipe(error)) child.emit('error', error);
  });
  child.stdin.end(script);
  return { child, promise };
}

async function waitForRemoteFile(adb: string, serial: string, path: string, {
  timeoutMs = 15000, pollMs = 100,
  processDone = () => false, processResult = async () => null,
}: { timeoutMs?: number, pollMs?: number, processDone?: () => boolean, processResult?: () => Promise<unknown> } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await execFile(adb, ['-s', serial, 'shell', 'test', '-e', path], {
        timeout: 3000, maxBuffer: 1024 * 1024,
      });
      return;
    } catch { /* the marker is not visible yet */ }
    if (processDone()) {
      const result = await processResult() as { code?: unknown, stderr?: string, stdout?: string } | null | undefined;
      throw new Error(`machine device program exited before HID readiness (${result?.code ?? 'unknown'}): ${result?.stderr?.trim() || result?.stdout?.trim() || 'no output'}`);
    }
    await new Promise<void>(resolve => setTimeout(resolve, pollMs));
  }
  throw new Error(`machine HID readiness marker was not observed before ${timeoutMs}ms`);
}

/**
 * Retain the target's ANR record for the run.  An `Input dispatching timed
 * out` entry says the app stopped consuming MotionEvents, which is the same
 * class of fault as a swallowed control tap: the run bundle should carry that
 * either way, so the absence of one is recorded as deliberately as a hit.
 */
async function readAnrEvents(adb: string, serial: string) {
  try {
    const { stdout } = await execFile(adb, ['-s', serial, 'logcat', '-b', 'events', '-d', '-s', 'am_anr'],
      { timeout: 10000, maxBuffer: 1024 * 1024 });
    return stdout.split('\n').filter(line => line.includes('am_anr'))
      .slice(-8).map(line => line.trim().slice(0, 300));
  } catch {
    return null;
  }
}

async function touchRemote(adb: string, serial: string, path: string) {
  boundedRemotePath(path, 'remote arm signal');
  try {
    await execFile(adb, ['-s', serial, 'shell', 'touch', path], {
      timeout: 10000, maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`could not signal device-local arm gate: ${adbFailure(error)}`);
  }
}

export class AdbDeviceLocalArtifactExecutor {
  declare serial: string;
  declare adb: string;
  declare readyDelayMs: number;
  declare observe: (() => Promise<string | null>) | null;
  declare observeArm: (() => ArmSample | Promise<ArmSample>) | null;
  declare observeControlState: (() => unknown) | null;
  declare pollMs: number;
  declare armSettleMs: number;
  declare armObservationWindowMs: number;
  declare gateRetryGapMs: number;
  declare staticTerminalWaitMs: number;
  declare observerGapBoundMs: number;
  declare gateTiming: { minSlackMs: number; budgetMinMs: number; budgetMaxMs: number; budgetReserveMs: number; };
  declare sharedHid: (() => SharedHid | null) | null;
  declare closeSharedHid: (() => unknown) | null;
  declare nightReleaseOwner: string;
  declare onEvent: (event: ExecutorEvent) => void;
  declare onOutput: (chunk: string) => void;
  /** The running process (the shell or the shared HID), compared by identity only. */
  declare child: object | null;
  declare running: boolean;
  declare stopProcess: (() => Promise<void>) | null;
  declare nightReleaseResolve: (() => void) | null;
  declare nightReleaseAction: ((requestedAt: number) => Promise<void>) | null;
  declare nightReleaseGranted: boolean;
  declare nightReleaseGrantedAt: number | null;
  declare nightAuthorizedListeners: Set<(at: number) => void>;
  declare nightAuthorizedAt: number | null;
  declare deviceLocal: boolean;
  constructor(options: { serial?: string, adb?: string, readyDelayMs?: number,
    observe?: (() => Promise<string | null>) | null, observeArm?: (() => ArmSample | Promise<ArmSample>) | null,
    observeControlState?: (() => unknown) | null, sharedHid?: (() => SharedHid | null) | null,
    closeSharedHid?: (() => unknown) | null, pollMs?: number, onEvent?: (event: ExecutorEvent) => void,
    onOutput?: (chunk: string) => void, timing?: ExecutorTiming, nightReleaseOwner?: string } = {}) {
    const { serial, adb = 'adb', readyDelayMs = DEFAULT_READY_DELAY_MS,
      observe = null, observeArm = null, observeControlState = null,
      sharedHid = null, closeSharedHid = null, pollMs = 1000, onEvent = () => {}, onOutput = () => {}, timing = {},
      nightReleaseOwner = 'observer' } = options;
    if (typeof serial !== 'string' || serial.length === 0) throw new TypeError('device-local executor requires an ADB serial');
    if (observe !== null && typeof observe !== 'function') throw new TypeError('device-local executor observe must be a function');
    if (observeArm !== null && typeof observeArm !== 'function') throw new TypeError('device-local executor observeArm must be a function');
    if (observeControlState !== null && typeof observeControlState !== 'function')
      throw new TypeError('device-local executor observeControlState must be a function');
    if (sharedHid !== null && typeof sharedHid !== 'function')
      throw new TypeError('device-local executor sharedHid must be a function');
    if (closeSharedHid !== null && typeof closeSharedHid !== 'function')
      throw new TypeError('device-local executor closeSharedHid must be a function');
    if (!['observer', 'port'].includes(nightReleaseOwner))
      throw new TypeError('device-local executor nightReleaseOwner must be observer or port');
    if (!Number.isInteger(pollMs) || pollMs < 250 || pollMs > 10000)
      throw new TypeError('device-local executor pollMs must be an integer in 250..10000');
    const timingValues = {
      armSettleMs: timing.armSettleMs ?? ARM_SETTLE_MS,
      armObservationWindowMs: timing.armObservationWindowMs ?? ARM_OBSERVATION_WINDOW_MS,
      gateRetryGapMs: timing.gateRetryGapMs ?? GATE_RETRY_GAP_MS,
      pollMs: timing.pollMs ?? pollMs,
      gateMinSlackMs: timing.gateMinSlackMs ?? GATE_MIN_SLACK_MS,
      gateBudgetMinMs: timing.gateBudgetMinMs ?? GATE_BUDGET_MIN_MS,
      gateBudgetMaxMs: timing.gateBudgetMaxMs ?? GATE_BUDGET_MAX_MS,
      gateBudgetReserveMs: timing.gateBudgetReserveMs ?? GATE_BUDGET_RESERVE_MS,
      staticTerminalWaitMs: timing.staticTerminalWaitMs ?? STATIC_TERMINAL_WAIT_MS,
      observerGapBoundMs: timing.observerGapBoundMs ?? OBSERVER_INTERVAL_BOUND_MS,
    };
    for (const [name, value] of Object.entries(timingValues)) {
      if (!Number.isInteger(value) || value < 0)
        throw new TypeError(`device-local executor ${name} must be a non-negative integer`);
    }
    this.serial = serial; this.adb = adb; this.readyDelayMs = readyDelayMs;
    this.observe = observe; this.observeArm = observeArm;
    this.observeControlState = observeControlState; this.pollMs = timingValues.pollMs;
    this.armSettleMs = timingValues.armSettleMs;
    this.armObservationWindowMs = timingValues.armObservationWindowMs;
    this.gateRetryGapMs = timingValues.gateRetryGapMs;
    this.staticTerminalWaitMs = timingValues.staticTerminalWaitMs;
    this.observerGapBoundMs = timingValues.observerGapBoundMs;
    this.gateTiming = { minSlackMs: timingValues.gateMinSlackMs,
      budgetMinMs: timingValues.gateBudgetMinMs, budgetMaxMs: timingValues.gateBudgetMaxMs,
      budgetReserveMs: timingValues.gateBudgetReserveMs };
    this.sharedHid = sharedHid;
    // The shared process's OWNER closes it when actuation halts: writing to it
    // only appends, and the phone's /system/bin/hid plays what is already
    // buffered, so closing is what stops those presses. Without an owner hook
    // the process's own close() is used, if it has one.
    this.closeSharedHid = closeSharedHid;
    // `observer`: the first authoritative office frame releases the shared
    // schedule (the 1 Hz classifier draws the night's epoch). `port`: that
    // frame only authorizes the night, and the composition calls
    // releaseNight() at an instant it placed against the game's grid
    // (night-anchor.js). Unshared runs ignore it.
    this.nightReleaseOwner = nightReleaseOwner;
    this.onEvent = onEvent; this.onOutput = onOutput;
    this.child = null; this.running = false;
    this.stopProcess = null;
    this.nightReleaseResolve = null;
    this.nightReleaseAction = null;
    this.nightReleaseGranted = false;
    this.nightReleaseGrantedAt = null;
    this.nightAuthorizedListeners = new Set();
    this.nightAuthorizedAt = null;
    this.deviceLocal = true;
  }

  /**
   * Resolves with the host time (Date.now) at which this execution's observer
   * RETURNED its first authoritative office classification in a port-owned
   * night -- immediately, if that already happened. It is the gate on the
   * release, not the night's onset: the screencap + classifier takes 1.8-1.9 s
   * (night5-anchor1/2), so a release planned from here reaches k<=2 only by
   * luck. The anchor plans from the helper's latched onset and uses this to
   * decide whether a planned instant may fire.
   */
  whenNightAuthorized() {
    if (this.nightAuthorizedAt !== null) return Promise.resolve(this.nightAuthorizedAt);
    return new Promise<number>(resolve => this.nightAuthorizedListeners.add(resolve));
  }

  /** The camera arm port; execute() refuses an arm-verified request without one. */
  #observeArm() {
    if (this.observeArm === null) throw new TypeError('device-local executor has no observeArm port');
    return this.observeArm();
  }

  /** The control-state port; every ledger that reads it checked it is present. */
  #observeControlState() {
    if (this.observeControlState === null) throw new TypeError('device-local executor has no observeControlState port');
    return this.observeControlState();
  }

  // The modern campaign opens and qualifies one HID process on the title
  // screen. The intro calls this after its setup tap; a retry that starts
  // after intro consumes the already-granted release immediately.
  releaseNight() {
    const grantedAt = Date.now();
    this.nightReleaseGranted = true;
    this.nightReleaseGrantedAt = grantedAt;
    this.nightReleaseResolve?.();
    this.nightReleaseResolve = null;
    if (this.nightReleaseAction) void this.nightReleaseAction(grantedAt);
  }

  // Cleanup must wake an observer waiting for the intro handoff without
  // starting the schedule as a side effect of stopping it.
  unblockNightRelease() {
    this.nightReleaseGranted = true;
    this.nightReleaseResolve?.();
    this.nightReleaseResolve = null;
  }

  async execute(input: unknown) {
    const request = validateExecutorRequest(input);
    if (request.mode !== 'live') fail('physical executor accepts live requests only');
    if (this.running) fail('executor is already running');
    const armVerification = request.artifact.plans[0].armVerification;
    const armObserveOnce = armVerification?.mode === 'observe-once';
    if (armVerification && typeof this.observeArm !== 'function')
      fail('arm-verified artifact requires an exact camera observation port');
    const schedule = compileDeviceLocalHidSchedule(request, {
      readyDelayMs: this.readyDelayMs, gateTiming: this.gateTiming,
    });
    // Startup phase anchors. Without them the only timestamp between night
    // entry and the first action was the start marker, so two separate
    // attempts to remove the measured 26-30 s office-to-marker latency each
    // claimed success that the evidence did not support.
    this.onEvent({ type: 'hid.execute-entered', at: Date.now() });
    this.running = true;
    const sharedHid = this.sharedHid?.() ?? null;
    const sharedMode = sharedHid !== null;
    if (sharedMode && typeof sharedHid.write !== 'function')
      fail('shared HID handoff requires a line writer');
    const releaseAlreadyGranted = this.nightReleaseGranted;
    const releaseAlreadyGrantedAt = this.nightReleaseGrantedAt;
    this.nightReleaseGranted = false;
    this.nightReleaseGrantedAt = null;
    this.nightAuthorizedAt = null;
    this.nightReleaseAction = null;
    const tag = `${globalThis.process.pid}-${Date.now()}`;
    const startMarker = `/data/local/tmp/fnaf2-modern-start-${tag}`;
    const armControl = schedule.gated ? {
      go: `/data/local/tmp/fnaf2-modern-go-${tag}`,
      retry: `/data/local/tmp/fnaf2-modern-retry-${tag}`,
      fail: `/data/local/tmp/fnaf2-modern-fail-${tag}`,
      rearm: `/data/local/tmp/fnaf2-modern-rearm-${tag}`,
      nightGo: `/data/local/tmp/fnaf2-modern-night-go-${tag}`,
      gateGo: `/data/local/tmp/fnaf2-modern-gate-go-${tag}`,
      gateFix: `/data/local/tmp/fnaf2-modern-gate-fix-${tag}`,
    } : null;
    let resolveSharedProcess: ((value: unknown) => void) | null = null;
    let sharedStopped = false;
    let sharedFeedTail = Promise.resolve();
    // Set once, by the first static read after a night (POST_NIGHT_STATIC_HALT).
    // From then on no schedule, gate, correction or arm line reaches the HID,
    // and only the lifecycle observer (or an external stop) ends the run.
    let actuationHalt: { at: number, reason: string } | null = null;
    let actuationStop = Promise.resolve();
    const feedShared: (lines: readonly string[], options?: {onFirstWrite?: (at: number) => void, afterHalt?: boolean}) => Promise<void> = (lines, { onFirstWrite, afterHalt = false } = {}): Promise<void> => {
      if (sharedHid === null) return Promise.resolve();
      const task = sharedFeedTail.then(async () => {
        let first = true;
        for (const value of lines) {
          // Checked per line: a segment being written when the halt lands
          // stops at the next line, not at the end of the segment.
          if (actuationHalt && !afterHalt) return;
          await sharedHid.write(value);
          if (first) {
            first = false;
            onFirstWrite?.(Date.now());
          }
        }
      });
      // A failed write must not poison the queue forever; its caller still
      // receives the failure and the run cleanup owns the final release.
      sharedFeedTail = task.then(() => {}, () => {});
      return task;
    };
    const spawned = sharedMode ? null
      : runAdbScript(this.adb, this.serial, renderDeviceLocalScript(schedule, { startMarker, armControl }), this.onOutput);
    const processPromise: Promise<unknown> = spawned === null
      ? new Promise<unknown>(resolve => {
          resolveSharedProcess = resolve;
        })
      : spawned.promise;
    this.onEvent(sharedMode
      ? { type: 'hid.handoff-reused', at: Date.now(), source: 'menu', readyDelayMs: 0 }
      : { type: 'hid.shell-spawned', at: Date.now(), readyDelayMs: schedule.readyDelayMs });
    this.child = spawned === null ? sharedHid : spawned.child;
    const processIdentity = this.child;
    // Declared here so a stop can end a halted run's observation (see below).
    let stopObserver = false;
    this.stopProcess = async () => {
      this.unblockNightRelease();
      // Once actuation has halted, the schedule's end no longer ends the run:
      // the observer does. Any stop that arrives after the halt -- the
      // observer's own end, an external abort or releaseAll, the shared
      // completion deadline -- therefore also ends that observation.
      if (actuationHalt) stopObserver = true;
      if (sharedMode) {
        if (sharedStopped) return;
        sharedStopped = true;
        // The halt already wrote the release and closed the stream.
        try { if (!actuationHalt) await feedShared([SHARED_HID_RELEASE]); }
        finally { resolveSharedProcess?.({ code: 0, shared: true }); }
        return;
      }
      // The halt already signalled the gate and killed the shell.
      if (actuationHalt) return;
      try {
        if (armControl) await touchRemote(this.adb, this.serial, armControl.fail);
      } finally {
        spawned?.child.kill('SIGTERM');
      }
    };
    // Reads the field at call time: teardown clears it, and a stop that arrives
    // after teardown throws rather than acting on the next run.
    const stopRun = () => {
      const stop = this.stopProcess;
      if (stop === null) throw new TypeError('the run has already ended');
      return stop();
    };
    // armControl exists exactly when the schedule is gated, and only a gated
    // schedule signals its markers.
    const touchArm = (key: keyof ArmControl) => touchRemote(this.adb, this.serial, (armControl as ArmControl)[key]);
    /**
     * Stop every press and keep observing (POST_NIGHT_STATIC_HALT). Idempotent;
     * the stop runs beside the observer so the next lifecycle read is not held
     * behind an adb round trip, and teardown awaits it.
     * 
     * @param at host wall clock of the read that decided the halt
     */
    const haltActuation = (reason: string, at: number, detail: Record<string, unknown> = {}) => {
      if (actuationHalt) return;
      actuationHalt = { at, reason };
      // A port-owned release that has not fired yet must start nothing.
      this.nightReleaseAction = null;
      this.onEvent({ type: 'lifecycle.actuation-halted', at, reason, shared: sharedMode, ...detail });
      actuationStop = (async () => {
        let method = 'none';
        let error = null;
        try {
          if (sharedHid !== null) {
            if (!sharedStopped) {
              method = 'release';
              await feedShared([SHARED_HID_RELEASE], { afterHalt: true });
            }
            const close = this.closeSharedHid ??
              (typeof sharedHid.close === 'function' ? () => sharedHid.close?.() : null);
            if (close) {
              await close();
              method = 'hid-closed';
            }
          } else {
            method = 'shell-killed';
            try {
              if (armControl) await touchRemote(this.adb, this.serial, armControl.fail);
            } finally {
              spawned?.child.kill('SIGTERM');
            }
          }
        } catch (caught) {
          error = messageOf(caught);
        }
        this.onEvent({ type: 'lifecycle.actuation-stopped', at: Date.now(), reason, method,
          ...(error === null ? {} : { error }) });
      })();
    };
    let processDone = false;
    const observedProcessPromise = processPromise.then(value => {
      processDone = true;
      return value;
    }, error => {
      processDone = true;
      throw error;
    });
    // The marker wait below owns the first await; keep a launch failure from
    // becoming an unhandled rejection while that wait is in progress.
    observedProcessPromise.catch(() => {});
    // Set inside the observers; typed by assertion so the checker does not narrow them to their initial null.
    let observedTerminal = null as string | null;
    let observedExitState = null as string | null;
    let armVerified = !armVerification || armObserveOnce;
    let armObservation: ArmSample | null = null;
    let armObservationStatus: string | null = armVerification ? (armObserveOnce ? 'UNRESOLVED' : 'PENDING') : null;
    let lastArmObservation: ArmSample | null = null;
    let armFailure: unknown = null;
    let armAttempt = 1;
    let nightObserved = false;
    // The night ORIGIN, sharpened. `observe` is a full 2400x1080 screencap
    // piped into the Python lifecycle classifier, so a night confirmed by it
    // is stamped up to a capture-and-classify round trip after the frame that
    // showed it: the 2026-09-11 observe-once run reconstructed
    // origin.bracketedByMs = 1852 against a 1000 ms model phase period, which
    // leaves the delivered phase unconstrained.
    //
    // The native Companion read already names the screen at ~43 ms, so it can
    // say WHEN inside the bracket the authority establishes. It is never
    // allowed to say WHETHER: `observe` remains the authority on a night
    // running, per the rule that a detector which knows one way to be dead is
    // not what says you are alive. The refinement is clamped to the
    // authority's own bracket, so it can only ever SHRINK it.
    let nativeNightAt: number | null = null;
    let nativeLastNotNightAt: number | null = null;
    let lastNonNightObserveAt: number | null = null;
    let nativeAnchorSamples = 0;
    let nightAnchoredAt: number | null = null;
    let nightReleasedAt: number | null = null;
    let nightGoEmitted = false;
    let sharedReleaseInFlight = false;
    let sharedReleaseTask: Promise<void> | null = null;
    let handoffDelayMs: number | null = null;
    let handoffFailure: unknown = null;
    let nonNightSamples = 0;
    const buildArmResult = () => armVerification ? {
      status: armObserveOnce ? armObservationStatus : 'PASS',
      cameras: armVerification.cameras, viewing: armVerification.viewing,
      observation: armObservation,
      ...(armObserveOnce ? { mode: 'observe-once' } : {}),
    } : undefined;
    let observer = Promise.resolve();
    let armObserver = Promise.resolve();
    const effectObservers: Promise<void>[] = [];
    let completionTimer: ReturnType<typeof setTimeout> | null = null;
    let startControlEffectLedger: (phase: string, originAt: number, monitorTransitions: readonly MonitorTransition[],
      maskTransitions: readonly MaskTransition[], options?: LedgerOptions) => void = (): void => {};
    // Hoisted for the same reason `startControlEffectLedger` is: the shared
    // night release can fire BEFORE execute() reaches the const that defines
    // the real gate ledger, and a direct reference there is a temporal dead
    // zone error that kills the run ("startGateLedger is not defined",
    // observed on device 2026-09-12). The release records its origin; whoever
    // is later -- the release or the definition -- starts the ledger.
    let startGateLedgerHook: ((armGoAt: number, gated: GatedSchedule) => void) | null = null;
    let pendingGateLedgerAt: number | null = null;
    const requestGateLedger = (at: number) => {
      pendingGateLedgerAt = at;
      if (startGateLedgerHook && schedule.gated) {
        const origin = pendingGateLedgerAt;
        pendingGateLedgerAt = null;
        startGateLedgerHook(origin, schedule.gated);
      }
    };
    const recordNightGo = (at: number, source?: string) => {
      if (nightAnchoredAt === null) nightAnchoredAt = at;
      if (nightGoEmitted) return;
      nightGoEmitted = true;
      this.onEvent({ type: 'hid.night-go', at: nightAnchoredAt,
        ...(source ? { source } : {}) });
    };
    const startSharedSchedule = (requestedAt: number): Promise<void> => {
      if (!sharedMode || sharedReleaseInFlight || stopObserver || actuationHalt ||
          this.child !== processIdentity || !this.running)
        return sharedReleaseTask ?? Promise.resolve();
      sharedReleaseInFlight = true;
      sharedReleaseTask = (async () => {
        recordNightGo(requestedAt, 'intro-handoff');
        nightObserved = true;
        // Set inside onFirstWrite; typed by assertion so the checker does not narrow it to its initial null.
        let firstWriteAt = null as number | null;
        try {
          await feedShared(sharedScheduleBody(schedule, { armObserveOnce }), {
            onFirstWrite: at => {
              firstWriteAt = at;
              handoffDelayMs = at - requestedAt;
              this.onEvent({ type: 'hid.handoff', requestedAt, firstWriteAt: at,
                delayMs: handoffDelayMs, budgetMs: NIGHT_HANDOFF_BUDGET_MS });
              if (handoffDelayMs > NIGHT_HANDOFF_BUDGET_MS) {
                handoffFailure = invalidRun(
                  `night handoff was ${handoffDelayMs}ms late ` +
                  `(budget ${NIGHT_HANDOFF_BUDGET_MS}ms)`, 'late-night-handoff');
                this.onEvent({ type: 'hid.handoff.abort', delayMs: handoffDelayMs,
                  budgetMs: NIGHT_HANDOFF_BUDGET_MS, reason: 'late-night-handoff' });
                throw handoffFailure;
              }
            },
          });
          // A halt that lands while the body is being written stops it; that
          // is the halt working, not a failed handoff.
          if (actuationHalt) return;
          if (firstWriteAt === null) throw new Error('night handoff wrote no HID action');
          const releasedAt = firstWriteAt;
          nightReleasedAt = releasedAt;
          if (schedule.gated) {
            startControlEffectLedger('prefix', firstWriteAt,
              schedule.gated.monitorTransitions.prefix, schedule.gated.maskTransitions.prefix,
              { originUncertaintyMs: 50, attempt: 1,
                phaseEndMs: schedule.gated.armReadyAtMs });
            // Observe-once never waits for an arm release, so the wall time
            // that corresponds to plan cursor `armReadyAtMs` is simply where
            // the unparked prefix ends. That is the gate ledger's origin, and
            // it is started here rather than deferred: the release is the last
            // moment that knows it, and a one-shot drain installed earlier in
            // execute() would run BEFORE this ever set it.
            const prefixEndsAt = releasedAt + schedule.gated.armReadyAtMs;
            if (armObserveOnce) requestGateLedger(prefixEndsAt);
          } else {
            startControlEffectLedger('full', firstWriteAt,
              schedule.monitorTransitions, schedule.maskTransitions,
              { phaseEndMs: schedule.plannedUntilMs });
          }
          completionTimer = setTimeout(() => {
            void this.stopProcess?.().catch(() => {});
          }, Math.min(2147483647, Math.max(1000, schedule.plannedUntilMs + 10000)));
          this.onEvent({ type: 'hid.night-go-released', at: firstWriteAt,
            originUncertaintyMs: 50, shared: true, handoffDelayMs });
        } catch (error) {
          handoffFailure ??= error;
          try { await stopRun(); } catch { /* cleanup owns the final state */ }
        }
      })();
      return sharedReleaseTask;
    };
    this.nightReleaseAction = sharedMode ? startSharedSchedule : null;
    try {
      // The marker is created on the phone immediately before `/system/bin/hid`
      // starts consuming the preloaded stream. Anchoring here avoids charging
      // ADB connection setup against the plan-relative ready delay and arm
      // deadline. A shared title HID is already past that boundary, so its
      // schedule starts as soon as this executor is handed the ready process.
      if (!sharedMode) await waitForRemoteFile(this.adb, this.serial, startMarker, {
        timeoutMs: 60000,
        processDone: () => processDone,
        processResult: () => observedProcessPromise,
      });
      const startedAt = Date.now();
      this.onEvent({ type: 'hid.schedule-start', startedAt, actionCount: schedule.actionCount,
        phaseOffsetMs: schedule.phaseOffsetMs });
      const startupDeadline = startedAt + STARTUP_GRACE_MS;
      // These are observation-only ACKs. They never alter the HID stream or
      // its timing: a failed/late state acknowledgement is evidence of a
      // desync, not a command to retry or compensate mid-night.
      let controlReadTail = Promise.resolve();
      // Control reads, gates, corrections and arm retries all belong to the
      // schedule, so a halt ends them with it; the lifecycle observer is not
      // one of them.
      const controlStillRunning = () => !stopObserver && !actuationHalt &&
        this.child === processIdentity && this.running;
      const waitUntil = async (deadline: number) => {
        while (controlStillRunning()) {
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) return true;
          await new Promise<void>(resolve => setTimeout(resolve, Math.min(remainingMs, 50)));
        }
        return false;
      };
      const readControlState = () => {
        let readStartedAt: number | null = null;
        const read = controlReadTail.then(async () => {
          if (!controlStillRunning()) return { sample: null, readStartedAt, readFinishedAt: Date.now() };
          readStartedAt = Date.now();
          try {
            const sample = await this.#observeControlState();
            return { sample, readStartedAt, readFinishedAt: Date.now() };
          } catch {
            return { sample: null, readStartedAt, readFinishedAt: Date.now() };
          }
        });
        // A bad diagnostic read must not poison later, independent samples.
        controlReadTail = read.then(() => {}, () => {});
        return read;
      };
      startControlEffectLedger = (phase, originAt, monitorTransitions, maskTransitions,
        { timelineOffsetMs = 0, originUncertaintyMs = 0, attempt = null, phaseEndMs = null } = {}) => {
        if (typeof this.observeControlState !== 'function') return;
        const transitions = effectTransitions(monitorTransitions, maskTransitions)
          .map(transition => ({ ...transition, relativeAtMs: transition.atMs - timelineOffsetMs }));
        if (!transitions.length) return;
        // Only the next authored transition of the SAME signal may legitimately
        // change it, so that contact — or the phase's own end — bounds each
        // observation window. Both come from the compiled plan, not a constant.
        const windowEndsMs = transitions.map((transition, index) => transitions
          .slice(index + 1).find(later => later.signal === transition.signal)?.relativeAtMs
          ?? phaseEndMs);
        this.onEvent({ type: 'control.effect.phase', phase, originAt, originUncertaintyMs,
          ...(attempt === null ? {} : { attempt }), transitionCount: transitions.length });
        const ledger = (async () => {
          for (const [index, transition] of transitions.entries()) {
            if (!controlStillRunning()) break;
            const contactAt = originAt + transition.relativeAtMs;
            const windowEndMs = windowEndsMs[index];
            const windowEndAt = windowEndMs === null ? Infinity : originAt + windowEndMs;
            this.onEvent({ type: 'control.effect.expected', phase, actionId: transition.actionId,
              cycle: transition.cycle, signal: transition.signal, target: transition.target,
              contactAt, windowEndAt, sampleBudget: CONTROL_EFFECT_MAX_SAMPLES,
              originAt, originUncertaintyMs, ...(attempt === null ? {} : { attempt }) });
            const reads: { sample: unknown, readStartedAt: number | null, readFinishedAt: number }[] = [];
            if (!await waitUntil(contactAt)) break;
            while (reads.length < CONTROL_EFFECT_MAX_SAMPLES && Date.now() < windowEndAt) {
              if (!controlStillRunning()) break;
              const read = await readControlState();
              if (read.readStartedAt === null) break;
              reads.push(read);
              this.onEvent({ type: 'control.effect.sample', phase, actionId: transition.actionId,
                cycle: transition.cycle, signal: transition.signal, target: transition.target,
                sampleIndex: reads.length,
                readStartedAt: read.readStartedAt, readFinishedAt: read.readFinishedAt,
                sinceContactLowerMs: read.readStartedAt - contactAt,
                sinceContactUpperMs: read.readFinishedAt - contactAt,
                sample: compactControlSample(read.sample), ...(attempt === null ? {} : { attempt }) });
              // Two distinct frames holding the target end the read early: the
              // measurement is complete and the budget belongs to the next one.
              if (controlEffectVerdict(reads, transition.signal, transition.target,
                contactAt).status === 'PASS') break;
            }
            if (!reads.length) continue;
            const verdict = controlEffectVerdict(reads, transition.signal, transition.target, contactAt);
            const evidence = transition.signal === 'maskOn'
              ? verdict.samples.find(sample => sample.maskEvidence)?.maskEvidence ?? 'diagnostic-unqualified'
              : 'calibrated';
            this.onEvent({ type: 'control.effect.result', phase, actionId: transition.actionId,
              cycle: transition.cycle, signal: transition.signal, target: transition.target,
              contactAt, windowEndAt, resultAt: Date.now(), status: verdict.status,
              reason: verdict.reason, latency: verdict.latency, sampleCount: reads.length,
              evidence, samples: verdict.samples, ...(attempt === null ? {} : { attempt }) });
          }
        })().catch(() => {
          // A diagnostic observer must never become a second actuator failure
          // mode. The absent result is visible from expected/sample events.
          if (actuationHalt) return;
          this.onEvent({ type: 'control.effect.observer-error', phase,
            ...(attempt === null ? {} : { attempt }) });
        });
        effectObservers.push(ledger);
      };
      /**
       * Hold each cycle boundary until the device's mask parity matches what
       * the plan believes. The plan's targets are a simulated toggle chain,
       * so the first missed contact re-aims every action after it; this is
       * what bounds that damage to a single cycle.
       *
       * Mask-on and monitor-up are mutually exclusive on the device, so one
       * mask observation settles both halves -- and the mask detector is the
       * one that held across both 2026-09-09 Night 5 runs.
       */
      const startGateLedger = (armGoAt: number, gated: GatedSchedule) => {
        if (typeof this.observeControlState !== 'function' || !gated.gates.length) return;
        const ledger = (async () => {
          // The stream runs on the phone's own clock from the arm release, so
          // a gate held past its budget leaves it behind this model. Carrying
          // that lag forward keeps every later release after the stream has
          // actually parked: releasing early would let the marker pre-exist,
          // skip the gate, and fire the next contact a whole budget early.
          let lagMs = 0;
          let releaseTouchMs = 0;
          for (const entry of gated.gates) {
            if (!controlStillRunning()) break;
            const reachedAt = armGoAt + (entry.gateAtMs - gated.armReadyAtMs) + lagMs;
            let releaseAt = reachedAt + entry.budgetMs;
            if (!await waitUntil(reachedAt)) break;
            // One ambiguous frame is not an unreadable state. Resample within
            // the budget so UNKNOWN means the state stayed unreadable, not
            // that a single 10 fps capture landed mid-animation.
            const reads: { startedAt: number | null, finishedAt: number }[] = [];
            let sample: ReturnType<typeof compactControlSample> | null = null;
            for (let attempt = 0; attempt < GATE_READ_ATTEMPTS; attempt += 1) {
              if (!controlStillRunning()) break;
              // Spaced, not back to back: consecutive reads a frame apart see
              // the same game moment, so an animation that refuses one read
              // refuses all three and a night ends on a state that would have
              // resolved on its own.
              if (attempt > 0) await waitUntil(Date.now() + this.gateRetryGapMs);
              const read = await readControlState();
              reads.push({ startedAt: read.readStartedAt, finishedAt: read.readFinishedAt });
              sample = compactControlSample(read.sample);
              // Keep reading until the STROKES answer. A grid answer on a
              // frame with no button signature is what produced the spurious
              // corrections; it is no longer a reason to stop looking.
              const strokeRead = buttonStrokeState(sample);
              if (strokeRead.maskOn !== null) break;
              if (strokeRead.office && sample.maskOn !== null) break;
              // No stroke source AT ALL is a different thing from a stroke
              // source that sees no signature. A helper build that does not
              // publish the chevrons must still be gradeable by the grid rule;
              // what is removed is the luma GUESS, not the grid opinion.
              if (!strokeRead.available && sample.maskOn !== null) break;
              if ((!strokeRead.available || strokeRead.office) &&
                entry.believedMaskOn === true && sample.gridLuma !== undefined &&
                sample.gridLuma >= MASK_OFF_GRID_LUMA_FLOOR) break;
            }
            if (!sample) break;
            // A halt during the reads: no correction, no release, no abort.
            if (actuationHalt) break;
            // The helper's fixed button chevrons decide this, not the 20x9 grid.
            //
            // Each state hides one button and keeps the other, so the pair is a
            // direct read of both facts: both drawn is the office, a missing
            // mask button is the monitor up, and a missing MONITOR button is
            // the mask on -- the mirror the operator named on 2026-09-12, whose
            // game fact actuator.ts already records ("while the mask is up or
            // coming off, the monitor bar is not drawn").
            //
            // The grid rule stays as a SECOND opinion and only where the
            // strokes already say the office is drawn. What is gone is the
            // grid-luma refutation: it let a gate correct on a frame whose
            // screen the classifier could not even identify, and on the
            // 2026-09-12T02-20 run every single correction did exactly that
            // (71% across all runs, against 30% of gates that agreed). A
            // correction ACTS -- it presses the mask -- so a wrong one does not
            // report an inversion, it creates one.
            // `packages/play/bin/probe/intersection-state-gate.ts` has stated this rule
            // all along: a missing stroke score is a refusal, never a luma
            // fallback.
            const strokes = buttonStrokeState(sample);
            // The bright-grid refutation is KEPT -- it is the abort case, and
            // without it a night ends instead of correcting -- but it may no
            // longer decide a frame whose stroke source is present and shows no
            // signature. That is the unreadable frame, and it is where the
            // spurious corrections came from.
            const lumaMayDecide = !strokes.available || strokes.office;
            const refutesMaskOn = lumaMayDecide && sample.maskOn === null &&
              entry.believedMaskOn === true && sample.gridLuma !== undefined &&
              sample.gridLuma >= MASK_OFF_GRID_LUMA_FLOOR;
            const observedMaskOn = strokes.maskOn !== null ? strokes.maskOn
              : strokes.office && sample.maskOn !== null ? sample.maskOn
                : !strokes.available && sample.maskOn !== null ? sample.maskOn
                  : refutesMaskOn ? false
                    : null;
            let maskEvidenceSource = strokes.maskOn !== null
              ? `button-stroke:${strokes.signature}`
              : strokes.office && sample.maskOn !== null ? 'office-stroke+mask-rule'
                : !strokes.available && sample.maskOn !== null ? 'mask-rule'
                  : refutesMaskOn ? 'grid-luma-refutation'
                    : strokes.available ? 'stroke-signature-absent' : 'stroke-unavailable';
            let monitorCorrected = false;
            let correctedAt: number | null = null;
            let status;
            // Monitor parity, maskless plans only: a lost monitor press
            // inverts the whole toggle chain, and with no mask in the plan
            // the mask gate cannot bound that damage. At the boundary the
            // plan believes the monitor DOWN; a POSITIVE read of UP means
            // the chain flipped, and the plan's own monitor-down tap restores
            // it. The cost is one cycle's wind, which the box tolerates.
            const monitorInverted = gated.maskCorrection === null &&
              entry.believedMonitorUp === false && sample.monitorUp === true;
            if (monitorInverted && gated.monitorCorrection) {
              status = 'CORRECTED';
              monitorCorrected = true;
              if (sharedMode) await feedShared(gated.monitorCorrection);
              else await touchArm('gateFix');
              correctedAt = Date.now();
            } else if (entry.believedMaskOn === null && gated.maskCorrection === null) {
              // A plan that authors no mask press anywhere (the minimal 4/20
              // route) has no mask parity to verify. The gate still parks the
              // stream and the ledger still records it -- as a vacuous
              // agreement, not as evidence it can never read.
              status = 'AGREED';
              maskEvidenceSource = 'no-mask-in-plan';
            } else if (entry.believedMaskOn === null || observedMaskOn === null) {
              // A gate that cannot see the state has not verified anything.
              // Releasing here would run the rest of the night on an
              // assumption, which is the failure this gate exists to end.
              status = 'UNKNOWN';
            } else if (observedMaskOn === entry.believedMaskOn) {
              status = 'AGREED';
            } else {
              status = 'CORRECTED';
              if (sharedMode) await feedShared(gated.maskCorrection ?? []);
              else await touchArm('gateFix');
              correctedAt = Date.now();
            }
            // The correction's read-back USED TO hold the stream:
            //
            //   releaseAt = Math.max(releaseAt, correctedAt + maskSettleMs + 250);
            //   await waitUntil(correctedAt + maskSettleMs);
            //
            // which pushed the release up to 1000 ms past its scheduled point,
            // because the mask effect needs 358-712 ms to become visible. That
            // is a diagnostic cost charged to the schedule, and on 2026-09-12
            // the model priced it: the Night 5 mask window tolerates almost
            // nothing in POSITION. Holding its length fixed at 4751 ms and
            // moving it later,
            //
            //     +0 ms   3000/3000        +400 ms   0/3000
            //     +200 ms    0/3000        +800 ms   0/3000
            //
            // a 200 ms shift is total collapse, and 200 ms is exactly
            // LAST_VIEW_SAMPLE_FRAMES (12 frames). So waiting to SEE the
            // correction converted a cycle that might have been saved into one
            // that was certainly lost: the gate existed to rescue the cycle and
            // was reliably killing it instead.
            //
            // The corrective contact is already delivered above; the game does
            // not care whether anyone watched. So release on schedule. The
            // read-back that replaced the wait (a `control.gate.verify` event
            // off the critical path) was pushed without being called from
            // a0188751 (2026-09-13) and is gone: calling it would add a control
            // read beside the release, which changes what the phone does. Packs
            // before that commit keep their verify events.
            this.onEvent({ type: 'control.gate', gateAtMs: entry.gateAtMs,
              cycle: entry.cycle, nextActionId: entry.nextActionId,
              believedMaskOn: entry.believedMaskOn, observedMaskOn,
              maskEvidence: maskEvidenceSource,
              strokeSignature: strokes.signature,
              status, reachedAt, releaseAt, reads, sample,
              ...(monitorCorrected ? { monitorCorrected: true } : {}),
              ...(correctedAt === null ? {} : { correctedAt }) });
            if (status === 'UNKNOWN') {
              this.onEvent({ type: 'control.gate.abort', gateAtMs: entry.gateAtMs,
                reason: sample.maskReason ?? 'mask-state-unavailable' });
              if (sharedMode) await stopRun();
              else await touchArm('fail');
              break;
            }
            // The stream resumes when the marker appears, not when the
            // release is decided, so the touch is started early by what the
            // last one cost. Without this each gate paid its own adb latency
            // again and the night drifted 50-130 ms per cycle.
            if (!await waitUntil(releaseAt - releaseTouchMs)) break;
            const touchStartedAt = Date.now();
            if (sharedMode) {
              // A ready process has no ADB marker round trip to hide. The next
              // segment must be written at the release instant; writing it
              // early would let /system/bin/hid consume it before the gate.
              await feedShared(gated.remainderSegments[gated.gates.indexOf(entry) + 1]);
              releaseTouchMs = 0;
            } else {
              await touchArm('gateGo');
              releaseTouchMs = Math.min(entry.budgetMs / 2, Date.now() - touchStartedAt);
            }
            lagMs += Math.max(0, Date.now() - releaseAt);
          }
        })().catch(async () => {
          // After a halt the stream is already stopped and the observer owns
          // the end of the run; a gate that fails then must not end it early.
          if (actuationHalt) return;
          // A parked stream never resumes on its own. An observer that dies
          // silently would hang the night at a gate, so it fails the run
          // instead and lets the shell unwind through its own trap.
          this.onEvent({ type: 'control.gate.observer-error' });
          try {
            if (sharedMode) await stopRun();
            else await touchArm('fail');
          } catch { /* the run is ending */ }
        });
        effectObservers.push(ledger);
      };
      if (!schedule.gated && !sharedMode) {
        startControlEffectLedger('full', startedAt + schedule.readyDelayMs,
          schedule.monitorTransitions, schedule.maskTransitions,
          { phaseEndMs: schedule.plannedUntilMs });
      }
      if (sharedMode && releaseAlreadyGranted)
        void startSharedSchedule(releaseAlreadyGrantedAt ?? Date.now());
      // Native camera reads must not wait behind a full screencap + Python
      // lifecycle classification. An UNKNOWN frame is a reason to leave the
      // one-shot observation unresolved, not permission to destroy a
      // potentially successful arm.
      const observeArmOnce = async (verification: ArmVerification) => {
        const armReadyAtMs = schedule.armObservation?.armReadyAtMs;
        if (armReadyAtMs === undefined || !Number.isInteger(armReadyAtMs)) {
          armObservationStatus = 'UNRESOLVED';
          this.onEvent({ type: 'arm.unresolved', mode: 'observe-once', reason: 'arm-window-unavailable' });
          return;
        }
        while (controlStillRunning() && nightAnchoredAt === null)
          await new Promise<void>(resolve => setTimeout(resolve, this.pollMs));
        if (!controlStillRunning() || nightAnchoredAt === null)
          return;
        // Read only where the plan shows the camera map (arm-observation.ts): the
        // old single read at armReadyAtMs + settle fell after k2/k3's opening
        // camdrop and read the office on 52 of 53 Night 7 nights. A read that
        // is not definitive tries the next window; the pair holds all night.
        const readTimes = armObservationTimes(schedule.monitorTransitions,
          { notBeforeMs: armReadyAtMs, settleMs: this.armSettleMs });
        if (!readTimes.length) {
          armObservationStatus = 'UNRESOLVED';
          this.onEvent({ type: 'arm.unresolved', mode: 'observe-once', reason: 'no-planned-camera-window' });
          return;
        }
        const origin = nightReleasedAt ?? nightAnchoredAt;
        let sample: ArmSample | null = null;
        let elapsedMs = 0;
        let highlights: unknown = null;
        let attempt = 0;
        for (const [index, readAtMs] of readTimes.entries()) {
          attempt = index + 1;
          if (!await waitUntil(origin + readAtMs)) return;
          sample = null;
          try { sample = await this.#observeArm(); }
          catch { /* an unavailable frame remains unresolved */ }
          // A halt while the camera was being read: the arm stays unresolved and
          // a mismatch may no longer stop a run the observer now owns.
          if (actuationHalt) return;
          elapsedMs = Date.now() - startedAt;
          this.onEvent({ type: 'arm.sample', mode: 'observe-once', elapsedMs, attempt, planAtMs: readAtMs, sample });
          lastArmObservation = sample;
          highlights = sample?.highlights;
          if (sample?.sequence !== undefined && sample?.sequence !== null && isList(highlights)) break;
        }
        const sequence = sample?.sequence;
        if (sequence === undefined || sequence === null || !isList(highlights)) {
          armObservationStatus = 'UNRESOLVED';
          this.onEvent({ type: 'arm.unresolved', mode: 'observe-once', elapsedMs, attempts: readTimes.length,
            reason: sample?.reason ?? 'no-definitive-camera-frame' });
          return;
        }
        const key = JSON.stringify([...highlights].sort());
        const expected = JSON.stringify([...verification.cameras].sort());
        if (key === expected) {
          armObservation = sample;
          armObservationStatus = 'PASS';
          this.onEvent({ type: 'arm.verified', mode: 'observe-once', attempt, elapsedMs });
          return;
        }
        armObservationStatus = 'FAILED';
        armFailure = invalidRun(`camera arm verification identified a mismatch ` +
          `(expected=${expected} observed=${key})`, 'camera-pair-mismatch');
        this.onEvent({ type: 'arm.failed', mode: 'observe-once', attempt, elapsedMs,
          reason: 'camera-pair-mismatch', expected: JSON.parse(expected), observed: JSON.parse(key) });
        await stopRun();
      };
      startGateLedgerHook = startGateLedger;
      if (pendingGateLedgerAt !== null && schedule.gated) {
        const origin = pendingGateLedgerAt;
        pendingGateLedgerAt = null;
        startGateLedger(origin, schedule.gated);
      }
      const armObservationTask = armObserveOnce && armVerification ? observeArmOnce(armVerification) : (async () => {
        const gate = schedule.gated;
        // Unverified until both exist: an arm-verified plan always compiles gated.
        if (!gate || !armVerification) return;
        // The arm taps only begin once night_go releases them, so the arm
        // observation window is anchored to that same first night frame --
        // not to the shell spawn, which now precedes night entry.
        let nextCheckAt = Infinity;
        let deadlineAt = Infinity;
        let lastSequence: unknown = null;
        let candidate: string | null = null;
        let confirmations = 0;
        const retryArm = async (reason: string) => {
          if (sharedMode) await feedShared(gate.rearm);
          else await touchArm('retry');
          const rearmAt = Date.now();
          armAttempt += 1;
          startControlEffectLedger('rearm', rearmAt,
            gate.monitorTransitions.rearm, gate.maskTransitions.rearm,
            { originUncertaintyMs: 50, attempt: armAttempt,
              phaseEndMs: gate.rearmDurationMs });
          // Anchor to the actual retry signal, not a theoretical first-attempt
          // timeline that observation latency can outrun.
          nextCheckAt = Date.now() + gate.rearmDurationMs + this.armSettleMs;
          deadlineAt = nextCheckAt + this.armObservationWindowMs;
          candidate = null;
          confirmations = 0;
          this.onEvent({ type: 'arm.retry', attempt: armAttempt,
            elapsedMs: Date.now() - startedAt, reason });
        };
        while (!armVerified && controlStillRunning()) {
          await new Promise<void>(resolve => setTimeout(resolve, this.pollMs));
          if (!controlStillRunning()) break;
          if (nextCheckAt === Infinity) {
            if (nightAnchoredAt === null) continue;
            nextCheckAt = (nightReleasedAt ?? nightAnchoredAt) + gate.armReadyAtMs + this.armSettleMs;
            deadlineAt = nextCheckAt + this.armObservationWindowMs;
          }
          if (Date.now() < nextCheckAt) continue;
          let sample: ArmSample | null = null;
          try { sample = await this.#observeArm(); }
          catch { /* an unavailable frame remains UNKNOWN */ }
          // No arm release, retry or failure stop after a halt.
          if (actuationHalt) break;
          const elapsedMs = Date.now() - startedAt;
          this.onEvent({ type: 'arm.sample', elapsedMs, attempt: armAttempt, sample });
          lastArmObservation = sample;
          const highlights = sample?.highlights ?? sample?.cameraHighlights;
          const sequence = sample?.sequence;
          const fresh = sequence !== undefined && sequence !== null && sequence !== lastSequence;
          if (fresh) lastSequence = sequence;
          if (fresh && isList(highlights)) {
            const key = JSON.stringify([...highlights].sort());
            confirmations = key === candidate ? confirmations + 1 : 1;
            candidate = key;
            if (confirmations >= ARM_CONFIRM_SAMPLES) {
              const sameHighlights = key === JSON.stringify([...armVerification.cameras].sort());
              if (sameHighlights) {
                  if (stopObserver || actuationHalt) break;
                  let armGoAt: number | null = null;
                  if (armControl) {
                    armGoAt = Date.now();
                    if (sharedMode) {
                      await feedShared(gate.remainderSegments[0]);
                      if (!gate.gates.length) {
                        for (const segment of gate.remainderSegments.slice(1)) await feedShared(segment);
                      }
                    } else {
                      await touchRemote(this.adb, this.serial, armControl.go);
                    }
                    // The parked prefix has already consumed armReadyAtMs. Any
                    // extra wall time before go is phase error, not harmless
                    // observation latency: the game clock keeps running.
                    const phaseLagMs = nightReleasedAt === null ? null
                      : armGoAt - nightReleasedAt - gate.armReadyAtMs;
                    if (phaseLagMs !== null && phaseLagMs > gate.phaseBudgetMs) {
                      this.onEvent({ type: 'phase.invalid', reason: 'late-arm-release',
                        phaseLagMs, phaseBudgetMs: gate.phaseBudgetMs,
                        armAttempt, nightReleasedAt, armGoAt });
                      armFailure = invalidRun(
                        'phase-invalid: arm release lag ' + phaseLagMs +
                        'ms exceeds budget ' + gate.phaseBudgetMs + 'ms', 'late-arm-release');
                      await stopRun();
                      break;
                    }
                    // A gated stream has a timing-critical host-owned release at
                    // every cycle boundary. `observeControlState` is synchronous
                    // at the physical port and its diagnostic ledger can spend
                    // six reads in one burst; on the 2026-09-11 Night 5 run it
                    // occupied the event loop for ~870 ms exactly when the first
                    // post-gate contact was due, delaying the gate release and
                    // shifting the phone-local stream. The gate itself retains
                    // the bounded state evidence, so do not run a competing
                    // remainder ledger while the stream is parked. Ungated
                    // schedules still get the full diagnostic ledger below.
                    startGateLedger(armGoAt, gate);
                  }
                  armVerified = true;
                  armObservation = sample;
                  this.onEvent({ type: 'arm.verified', attempt: armAttempt, elapsedMs,
                    ...(armGoAt === null ? {} : { armGoAt }) });
              } else if (armAttempt < MAX_ARM_ATTEMPTS) {
                  await retryArm('camera-pair-mismatch');
              } else {
                  deadlineAt = Date.now();
              }
            }
          } else {
            candidate = null;
            confirmations = 0;
          }
          if (!armVerified && Date.now() >= deadlineAt) {
              // A native watch can return a fresh sequence while the camera
              // panel is still between frames. That is not evidence that the
              // authored arm is wrong, but waiting longer on the same raised
              // monitor cannot repair it. Replay the physical arm sequence so
              // the next bounded window gets a new panel transition; keep the
              // fail-closed result once all attempts are spent.
              if (armAttempt < MAX_ARM_ATTEMPTS) {
                await retryArm('camera-observation-unavailable');
                continue;
              }
              armFailure = invalidRun(`camera arm verification missed after ${armAttempt} attempt(s) ` +
                `(expected=${JSON.stringify(armVerification.cameras)} ` +
                `viewing=${armVerification.viewing} last=${JSON.stringify(lastArmObservation)})`,
                // Why, from what the camera last showed: a definitive set is a
                // wrong pair; anything else never showed one.
                isList(lastArmObservation?.highlights ?? lastArmObservation?.cameraHighlights) &&
                  lastArmObservation?.sequence !== undefined && lastArmObservation?.sequence !== null
                  ? 'camera-pair-mismatch' : 'camera-observation-unavailable');
              await stopRun();
              break;
          }
        }
      })();
      armObserver = armVerification ? armObservationTask.catch(async error => {
        armFailure = error;
        await stopRun();
      }) : Promise.resolve();
      // Runs beside the authority, not instead of it. It only records WHEN the
      // native read first named the night screen; nothing here releases a
      // stream, ends a run, or decides that a night is running.
      const nativeAnchor = (this.observe && typeof this.observeControlState === 'function')
        ? (async () => {
          while (!stopObserver && this.child === processIdentity && this.running &&
                 nativeNightAt === null && !nightObserved) {
            const startedAt = Date.now();
            let sample: unknown = null;
            try { ({ sample } = await readControlState()); } catch { sample = null; }
            nativeAnchorSamples += 1;
            const screen = (sample as { screen?: unknown } | null | undefined)?.screen;
            if (screen === NATIVE_NIGHT_SCREEN) { nativeNightAt = startedAt; break; }
            // A read that positively named some OTHER screen is the native
            // stream's own lower bound on the transition. An UNKNOWN read
            // names nothing and must not move it.
            if (typeof screen === 'string' && screen !== 'UNKNOWN')
              nativeLastNotNightAt = startedAt;
            const spent = Date.now() - startedAt;
            if (spent < NATIVE_ANCHOR_POLL_MS)
              await new Promise<void>(resolve => setTimeout(resolve, NATIVE_ANCHOR_POLL_MS - spent));
          }
        })().catch(() => {})
        : Promise.resolve();
      // When the previous lifecycle read returned (host wall clock, like the
      // measured record's rows), for the post-night gap events.
      let previousReadAt: number | null = null;
      // A halted run's observation ends once its window, measured from the
      // static read that halted it, has run out: a read that was in flight at
      // the expiry is still taken first, so a Game Over it returns is the
      // terminal. The exit is the static exit the campaign already knows.
      const endAtHaltWindow = async (observedAt: number) => {
        if (!actuationHalt) return false;
        const heldMs = observedAt - actuationHalt.at;
        if (heldMs < this.staticTerminalWaitMs) return false;
        this.onEvent({ type: 'lifecycle.static-hold.expired', at: observedAt,
          heldMs, waitMs: this.staticTerminalWaitMs });
        observedExitState = 'static';
        stopObserver = true;
        await stopRun();
        return true;
      };
      observer = this.observe ? (async () => {
        while (!stopObserver && this.child === processIdentity && this.running) {
          await new Promise<void>(resolve => setTimeout(resolve, this.pollMs));
          if (stopObserver || this.child !== processIdentity || !this.running) break;
          const observeStartedAt = Date.now();
          let state: string | null = null;
          let unreadable = false;
          try { state = this.observe ? await this.observe() : null; }
          catch { unreadable = true; }
          const observedAt = Date.now();
          const gapMs = previousReadAt === null ? null : observedAt - previousReadAt;
          previousReadAt = observedAt;
          // The window assumes reads at most one observer interval apart. From
          // the read that halts actuation on, a longer gap is evented: r02's
          // reads around its static were 11776 and 8393 ms apart.
          if (gapMs !== null && gapMs > this.observerGapBoundMs &&
              (actuationHalt || (nightObserved && state === 'static')))
            this.onEvent({ type: 'lifecycle.observe-gap', at: observedAt, gapMs,
              boundMs: this.observerGapBoundMs, state: unreadable ? null : state });
          if (unreadable) {
            // An unreadable frame does NOT reset the evidence.
            //
            // It used to. The 2026-09-12 origin run read `state=title`
            // alternating with `unknown=no-signature-matched` for over a
            // minute while the schedule kept pressing into the title screen:
            // every UNKNOWN zeroed the counter, so three CONSECUTIVE non-night
            // samples never accumulated and the run could not end itself. An
            // unreadable frame is an absence of evidence, so it withholds a
            // vote rather than destroying the votes already cast. It does not
            // hold a halted run open past its window either.
            try { if (await endAtHaltWindow(observedAt)) break; }
            catch (error) { this.onEvent({ type: 'lifecycle.stop-failed', at: Date.now(), error: messageOf(error) }); }
            continue;
          }
          try {
            // A lifecycle observer that positively names any other screen has
            // proved that the scheduled night is gone once a night frame has
            // been seen. Classifiers are frame-based and can produce one bad
            // positive during a camera/monitor animation, so require a short
            // consecutive run of positive non-night samples. A single bad
            // frame, or an UNKNOWN capture, never kills the stream.
            if (state === 'night') {
              if (!nightObserved) {
                // The first authoritative office frame is the timeline's
                // 12 AM anchor: release the schedule and stamp the arm
                // verifier's window origin. The executor owns this edge for
                // the shared title HID; waiting for the separate intro
                // observer would spend the handoff budget on PNG retention
                // and let a healthy run abort before its first contact.
                // Clamp: the refined origin must lie inside the window the
                // authority itself bracketed -- after the last frame it called
                // NOT a night, and not after the capture that proved one. A
                // native read outside that window is discarded rather than
                // trusted, so a premature FNAF2_NIGHT on an intro or dark
                // frame cannot pull the origin earlier than the evidence.
                // The authority's own previous sample is the preferred lower
                // bound. When the authority found the night on its first look
                // it has none, and the native stream supplies one instead: the
                // last read that positively named a DIFFERENT screen. Both are
                // real observations; if neither exists the refinement is
                // refused rather than guessed.
                const lowerBound = lastNonNightObserveAt ?? nativeLastNotNightAt;
                const nativeAt = nativeNightAt;
                const refined = (nativeAt !== null && lowerBound !== null &&
                  nativeAt >= lowerBound && nativeAt <= observeStartedAt)
                  ? nativeAt : null;
                this.onEvent({ type: 'origin.refined',
                  authorityAtMs: observeStartedAt,
                  authorityBracketFromMs: lastNonNightObserveAt,
                  nativeBracketFromMs: nativeLastNotNightAt,
                  bracketSource: lastNonNightObserveAt !== null ? 'authority'
                    : (nativeLastNotNightAt !== null ? 'native' : 'none'),
                  nativeAtMs: nativeNightAt,
                  nativeSamples: nativeAnchorSamples,
                  accepted: refined !== null,
                  shrunkByMs: refined === null ? 0 : observeStartedAt - refined });
                const portOwnsRelease = sharedMode && this.nightReleaseOwner === 'port';
                if (portOwnsRelease) {
                  // Authorization only: releaseNight() records its own
                  // night-go when the port fires, so the schedule's origin is
                  // the placed instant, not this classifier sample.
                  // `at` stays the sample's start for the timeline; the gate
                  // opens only when the classification returned.
                  const authorizedAt = Date.now();
                  this.nightAuthorizedAt = authorizedAt;
                  this.onEvent({ type: 'hid.night-authorized', at: observeStartedAt,
                    sampleStartedAt: observeStartedAt, authorizedAt, owner: 'port' });
                  for (const resolve of this.nightAuthorizedListeners) resolve(authorizedAt);
                  this.nightAuthorizedListeners.clear();
                } else {
                  recordNightGo(refined ?? observeStartedAt, 'lifecycle');
                }
                if (portOwnsRelease) {
                  /* the composition's releaseNight() starts the schedule */
                } else if (sharedMode) {
                  try {
                    if (!sharedReleaseInFlight) await startSharedSchedule(Date.now());
                    if (stopObserver) break;
                    await sharedReleaseTask;
                    if (handoffFailure || stopObserver) break;
                  } catch (error) {
                    handoffFailure ??= error;
                    await stopRun();
                    break;
                  }
                } else if (armControl?.nightGo && schedule.gated) {
                  try {
                    await touchRemote(this.adb, this.serial, armControl.nightGo);
                    const nightGoAt = Date.now();
                    nightReleasedAt = nightGoAt;
                    startControlEffectLedger('prefix', nightGoAt,
                      schedule.gated.monitorTransitions.prefix, schedule.gated.maskTransitions.prefix,
                      { originUncertaintyMs: 50, attempt: 1,
                        phaseEndMs: schedule.gated.armReadyAtMs });
                    this.onEvent({ type: 'hid.night-go-released', at: nightGoAt,
                      originUncertaintyMs: 50 });
                  } catch (error) {
                    // The drop guard below still governs the run; the record
                    // says why the schedule never started.
                    this.onEvent({ type: 'hid.night-go-failed', at: Date.now(), error: messageOf(error) });
                  }
                }
              }
              nightObserved = true;
              nonNightSamples = 0;
              // After a halt a night read resumes nothing and does not restart
              // the window: p1b read `state=night` once from inside its death
              // minigame, 123.7 s after its first static.
            } else if (!state) {
              // An UNKNOWN classification withholds a vote; see the catch below.
            } else if (!nightObserved) {
              // The authority's own lower bound on the origin: it looked at a
              // frame captured about now and did not call it a night.
              lastNonNightObserveAt = observeStartedAt;
            }
            if (state === 'gameover' || state === 'sixam') {
              if (!armVerified) {
                armFailure = new Error(`camera arm verification ended with ${state} ` +
                  `(expected=${JSON.stringify(armVerification?.cameras)} ` +
                  `viewing=${armVerification?.viewing} last=${JSON.stringify(lastArmObservation)})`);
              }
              observedTerminal = state;
              stopObserver = true;
              await stopRun();
              break;
            }
            // Once a night has been seen, the TITLE is not a transient
            // animation the way an intro or a dark frame is: the night is over
            // and the schedule is now pressing into a menu. `coords.sh` puts
            // New Game on that screen, so continuing to actuate there risks
            // the save, not just the run. It stops on the first positive read,
            // like gameover and sixam above.
            if (nightObserved && state !== null && TERMINAL_SCREENS.has(state)) {
              observedExitState = state;
              stopObserver = true;
              await stopRun();
              break;
            }
            // POST_NIGHT_STATIC_HALT. After a night, the first static read
            // stops every press and opens the STATIC_TERMINAL_WAIT_MS window;
            // the observer keeps reading. Static reads withhold their exit vote
            // (they neither count nor erase the votes already cast, like an
            // UNKNOWN read) until the window's expiry ends the run below. Any
            // other positive screen votes as before.
            if (nightObserved && state === 'static' && !actuationHalt) {
              this.onEvent({ type: 'lifecycle.static-hold', at: observedAt,
                waitMs: this.staticTerminalWaitMs });
              haltActuation(POST_NIGHT_STATIC_HALT, observedAt, { state,
                waitMs: this.staticTerminalWaitMs, ...(gapMs === null ? {} : { gapMs }) });
            }
            const staticWithheld = actuationHalt !== null && state === 'static';
            const startupTransition = !nightObserved &&
              (state === 'intro' || state === 'newspaper') && Date.now() < startupDeadline;
            if (startupTransition) {
              nonNightSamples = 0;
            } else if (staticWithheld) {
              // Withheld: the death's terminal screen is still expected.
            } else if (state && state !== 'night') {
              nonNightSamples += 1;
              if (nonNightSamples >= EXIT_CONFIRM_SAMPLES) {
                observedExitState = state;
                stopObserver = true;
                await stopRun();
                break;
              }
            }
            if (await endAtHaltWindow(observedAt)) break;
          } catch (error) {
            // A stop that fails while ending the run leaves the decision
            // already recorded above; teardown still releases the stream.
            this.onEvent({ type: 'lifecycle.stop-failed', at: Date.now(), error: messageOf(error) });
          }
        }
      })() : Promise.resolve();
      try {
        await processPromise;
      } catch (error) {
        // The halt kills a device-local shell on purpose: that exit is the
        // halt, not a transport failure.
        if (!actuationHalt) throw error;
      }
      // After a halt the schedule's end is not the run's end: the observer
      // still reads until a terminal, a title or three exit votes, the
      // window's expiry, or a stop (external, or the shared completion
      // deadline) -- whichever comes first.
      if (actuationHalt) await observer;
      stopObserver = true;
      await actuationStop;
      await nativeAnchor;
      if (handoffFailure) throw handoffFailure;
      if (observedExitState)
        throw new Error(`device: lifecycle left night state (${observedExitState})`);
      if (!armVerified) throw armFailure ?? new Error('camera arm verification did not produce a positive observation');
      const completedArm = buildArmResult();
      return { status: 'COMPLETED', outcome: 'UNVERIFIED', night: schedule.night,
        plannedUntilMs: schedule.plannedUntilMs, blockCount: schedule.actionCount,
        deviceLocal: true, ...(observedTerminal ? { terminal: observedTerminal } : {}),
        ...(completedArm ? { armVerification: completedArm } : {}) };
    } catch (error) {
      // A fresh lifecycle observation is the only accepted reason to turn a
      // killed remote schedule into a normal failed attempt. Transport or
      // shell failures remain errors and are handled by the campaign abort
      // path.
      if (handoffFailure) throw handoffFailure;
      if (armFailure) throw armFailure;
      if (observedTerminal === 'gameover' || observedTerminal === 'sixam') {
        if (!armVerified) throw new Error(`camera arm verification ended with ${observedTerminal}`);
        const completedArm = buildArmResult();
        return { status: 'COMPLETED', outcome: 'UNVERIFIED', night: schedule.night,
          plannedUntilMs: schedule.plannedUntilMs, blockCount: schedule.actionCount,
          deviceLocal: true, terminal: observedTerminal,
          ...(completedArm ? { armVerification: completedArm } : {}) };
      }
      if (observedExitState)
        throw new Error(`device: lifecycle left night state (${observedExitState})`);
      throw error;
    } finally {
      stopObserver = true;
      if (completionTimer !== null) clearTimeout(completionTimer);
      this.nightReleaseAction = null;
      this.unblockNightRelease();
      await Promise.all([observer, armObserver, actuationStop, ...effectObservers]);
      const anr = await readAnrEvents(this.adb, this.serial);
      if (anr !== null) this.onEvent({ type: 'device.anr', count: anr.length, lines: anr });
      this.child = null; this.running = false;
      this.stopProcess = null;
      this.nightReleaseResolve = null;
      this.nightReleaseGranted = false;
      this.nightReleaseGrantedAt = null;
    }
  }

  async abort(reason = 'aborted') {
    if (this.stopProcess) await this.stopProcess();
    return { status: 'ABORTED', reason: String(reason) };
  }

  async releaseAll() {
    if (this.stopProcess) await this.stopProcess();
  }
}
