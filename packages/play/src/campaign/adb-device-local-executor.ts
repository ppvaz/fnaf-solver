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
import {
  DEFAULT_READY_DELAY_MS, GATE_BUDGET_MAX_MS, GATE_BUDGET_MIN_MS, GATE_BUDGET_RESERVE_MS, GATE_MIN_SLACK_MS, GATE_READ_WORST_MS,
  SHARED_HID_RELEASE, compileDeviceLocalHidSchedule, sharedScheduleBody,
} from './hid-schedule.ts';
import type { HidSchedule } from './hid-schedule.ts';
import type { LifecycleState } from './lifecycle-state.ts';
import { compactControlSample, controlEffectVerdict, effectTransitions } from './control-effect.ts';
import type { MaskTransition, MonitorTransition } from './control-effect.ts';
import { boundedRemotePath, renderDeviceLocalScript } from './device-shell.ts';
import type { ArmControl } from './device-shell.ts';
import { isList } from '@sixam/kernel';
import { armObservationTimes } from './arm-observation.ts';
import { HOST_CLOCK, messageOf } from './port-kit.ts';
import type { Clock } from './port-kit.ts';
import { GATE_RETRY_GAP_MS, runCycleGates } from './cycle-gates.ts';

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
  readonly gateReadWorstMs?: number;
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
const TERMINAL_SCREENS: ReadonlySet<LifecycleState> = new Set<LifecycleState>(['title', 'gameover', 'sixam']);
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
const execFile = promisify(execFileCallback);

function fail(message: string): never { throw new TypeError(`adb device-local executor: ${message}`); }
/** A failure as one bounded line for an event record. */
const eventMessage = (error: unknown) => messageOf(error, 240);
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

async function waitForRemoteFile(adb: string, serial: string, path: string, clock: Clock, {
  timeoutMs = 15000, pollMs = 100,
  processDone = () => false, processResult = async () => null,
}: { timeoutMs?: number, pollMs?: number, processDone?: () => boolean, processResult?: () => Promise<unknown> } = {}) {
  const deadline = clock.now() + timeoutMs;
  while (clock.now() < deadline) {
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
    await clock.sleep(pollMs);
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

/** What one execute() call shares between its schedule, its observers and its teardown. */
interface DeviceLocalRunState {
  resolveSharedProcess: ((value: unknown) => void) | null;
  sharedStopped: boolean;
  sharedFeedTail: Promise<void>;
  actuationHalt: { at: number, reason: string } | null;
  actuationStop: Promise<void>;
  stopObserver: boolean;
  processDone: boolean;
  observedTerminal: string | null;
  observedExitState: string | null;
  armVerified: boolean;
  armObservation: ArmSample | null;
  armObservationStatus: string | null;
  lastArmObservation: ArmSample | null;
  armFailure: unknown;
  armAttempt: number;
  nightObserved: boolean;
  nativeNightAt: number | null;
  nativeLastNotNightAt: number | null;
  lastNonNightObserveAt: number | null;
  nativeAnchorSamples: number;
  nightAnchoredAt: number | null;
  nightReleasedAt: number | null;
  nightGoEmitted: boolean;
  sharedReleaseInFlight: boolean;
  sharedReleaseTask: Promise<void> | null;
  handoffDelayMs: number | null;
  handoffFailure: unknown;
  nonNightSamples: number;
  observer: Promise<void>;
  armObserver: Promise<void>;
  completionTimer: ReturnType<typeof setTimeout> | null;
  startControlEffectLedger: (phase: string, originAt: number, monitorTransitions: readonly MonitorTransition[],
    maskTransitions: readonly MaskTransition[], options?: LedgerOptions) => void;
  startGateLedgerHook: ((armGoAt: number, gated: GatedSchedule) => void) | null;
  pendingGateLedgerAt: number | null;
  controlReadTail: Promise<void>;
  previousReadAt: number | null;
}

/** A fresh run's state: nothing observed, released or halted yet; the arm as the request left it. */
function createRunState(armVerified: boolean, armObservationStatus: string | null): DeviceLocalRunState {
  return {
    resolveSharedProcess: null,
    sharedStopped: false,
    sharedFeedTail: Promise.resolve(),
    // Set once, by the first static read after a night (POST_NIGHT_STATIC_HALT).
    // From then on no schedule, gate, correction or arm line reaches the HID,
    // and only the lifecycle observer (or an external stop) ends the run.
    actuationHalt: null,
    actuationStop: Promise.resolve(),
    // Set by a stop, so a stop can also end a halted run's observation.
    stopObserver: false,
    processDone: false,
    // Set inside the observers.
    observedTerminal: null,
    observedExitState: null,
    armVerified,
    armObservation: null,
    armObservationStatus,
    lastArmObservation: null,
    armFailure: null,
    armAttempt: 1,
    nightObserved: false,
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
    nativeNightAt: null,
    nativeLastNotNightAt: null,
    lastNonNightObserveAt: null,
    nativeAnchorSamples: 0,
    nightAnchoredAt: null,
    nightReleasedAt: null,
    nightGoEmitted: false,
    sharedReleaseInFlight: false,
    sharedReleaseTask: null,
    handoffDelayMs: null,
    handoffFailure: null,
    nonNightSamples: 0,
    observer: Promise.resolve(),
    armObserver: Promise.resolve(),
    completionTimer: null,
    startControlEffectLedger: (): void => {},
    // Hoisted for the same reason `startControlEffectLedger` is: the shared
    // night release can fire BEFORE execute() reaches the const that defines
    // the real gate ledger, and a direct reference there is a temporal dead
    // zone error that kills the run ("startGateLedger is not defined",
    // observed on device 2026-09-12). The release records its origin; whoever
    // is later -- the release or the definition -- starts the ledger.
    startGateLedgerHook: null,
    pendingGateLedgerAt: null,
    // These are observation-only ACKs. They never alter the HID stream or
    // its timing: a failed/late state acknowledgement is evidence of a
    // desync, not a command to retry or compensate mid-night.
    controlReadTail: Promise.resolve(),
    // When the previous lifecycle read returned (host wall clock, like the
    // measured record's rows), for the post-night gap events.
    previousReadAt: null,
  };
}

/** What one execute() call fixes before its night starts, and the executor it runs on. */
interface RunContext {
  readonly ex: AdbDeviceLocalArtifactExecutor;
  readonly run: DeviceLocalRunState;
  readonly schedule: ReturnType<typeof compileDeviceLocalHidSchedule>;
  readonly armVerification: ArmVerification | undefined;
  readonly armObserveOnce: boolean;
  readonly sharedHid: SharedHid | null;
  readonly sharedMode: boolean;
  readonly armControl: ArmControl | null;
  readonly spawned: ReturnType<typeof runAdbScript> | null;
  /** The running process (the shell or the shared HID) this run started, compared by identity. */
  readonly processIdentity: object | null;
  /** The executor's private ports, reached from outside the class. */
  readonly observeArm: () => ArmSample | Promise<ArmSample>;
  readonly observeControlState: () => unknown;
}

/**
 * Append lines to the shared HID in order, one queue per run. A segment being
 * written when the halt lands stops at its next line unless `afterHalt`.
 */
function feedShared(c: RunContext, lines: readonly string[],
  { onFirstWrite, afterHalt = false }: { onFirstWrite?: (at: number) => void, afterHalt?: boolean } = {}): Promise<void> {
  const { ex, run, sharedHid } = c;
  if (sharedHid === null) return Promise.resolve();
  const task = run.sharedFeedTail.then(async () => {
    let first = true;
    for (const value of lines) {
      // Checked per line: a segment being written when the halt lands
      // stops at the next line, not at the end of the segment.
      if (run.actuationHalt && !afterHalt) return;
      await sharedHid.write(value);
      if (first) {
        first = false;
        onFirstWrite?.(ex.clock.now());
      }
    }
  });
  // A failed write must not poison the queue forever; its caller still
  // receives the failure and the run cleanup owns the final release.
  run.sharedFeedTail = task.then(() => {}, () => {});
  return task;
}

/** Stop the run's process: release and resolve a shared HID, or signal the gate and kill the shell. */
async function stopProcess(c: RunContext) {
  const { ex, run, sharedMode, armControl, spawned } = c;
  ex.unblockNightRelease();
  // Once actuation has halted, the schedule's end no longer ends the run:
  // the observer does. Any stop that arrives after the halt -- the
  // observer's own end, an external abort or releaseAll, the shared
  // completion deadline -- therefore also ends that observation.
  if (run.actuationHalt) run.stopObserver = true;
  if (sharedMode) {
    if (run.sharedStopped) return;
    run.sharedStopped = true;
    // The halt already wrote the release and closed the stream.
    try { if (!run.actuationHalt) await feedShared(c, [SHARED_HID_RELEASE]); }
    finally { run.resolveSharedProcess?.({ code: 0, shared: true }); }
    return;
  }
  // The halt already signalled the gate and killed the shell.
  if (run.actuationHalt) return;
  try {
    if (armControl) await touchRemote(ex.adb, ex.serial, armControl.fail);
  } finally {
    spawned?.child.kill('SIGTERM');
  }
}

// Reads the field at call time: teardown clears it, and a stop that arrives
// after teardown throws rather than acting on the next run.
function stopRun(c: RunContext) {
  const stop = c.ex.stopProcess;
  if (stop === null) throw new TypeError('the run has already ended');
  return stop();
}

// armControl exists exactly when the schedule is gated, and only a gated
// schedule signals its markers.
const touchArm = (c: RunContext, key: keyof ArmControl) =>
  touchRemote(c.ex.adb, c.ex.serial, (c.armControl as ArmControl)[key]);

/**
 * Stop every press and keep observing (POST_NIGHT_STATIC_HALT). Idempotent;
 * the stop runs beside the observer so the next lifecycle read is not held
 * behind an adb round trip, and teardown awaits it.
 *
 * @param at host wall clock of the read that decided the halt
 */
function haltActuation(c: RunContext, reason: string, at: number, detail: Record<string, unknown> = {}) {
  const { ex, run, sharedHid, sharedMode, armControl, spawned } = c;
  if (run.actuationHalt) return;
  run.actuationHalt = { at, reason };
  // A port-owned release that has not fired yet must start nothing.
  ex.nightReleaseAction = null;
  ex.onEvent({ type: 'lifecycle.actuation-halted', at, reason, shared: sharedMode, ...detail });
  run.actuationStop = (async () => {
    let method = 'none';
    let error = null;
    try {
      if (sharedHid !== null) {
        if (!run.sharedStopped) {
          method = 'release';
          await feedShared(c, [SHARED_HID_RELEASE], { afterHalt: true });
        }
        const close = ex.closeSharedHid ??
          (typeof sharedHid.close === 'function' ? () => sharedHid.close?.() : null);
        if (close) {
          await close();
          method = 'hid-closed';
        }
      } else {
        method = 'shell-killed';
        try {
          if (armControl) await touchRemote(ex.adb, ex.serial, armControl.fail);
        } finally {
          spawned?.child.kill('SIGTERM');
        }
      }
    } catch (caught) {
      error = eventMessage(caught);
    }
    ex.onEvent({ type: 'lifecycle.actuation-stopped', at: ex.clock.now(), reason, method,
      ...(error === null ? {} : { error }) });
  })();
}

export class AdbDeviceLocalArtifactExecutor {
  declare serial: string;
  declare adb: string;
  declare readyDelayMs: number;
  declare observe: (() => Promise<LifecycleState | null>) | null;
  declare observeArm: (() => ArmSample | Promise<ArmSample>) | null;
  declare observeControlState: (() => unknown) | null;
  declare pollMs: number;
  declare armSettleMs: number;
  declare armObservationWindowMs: number;
  declare gateRetryGapMs: number;
  declare gateReadWorstMs: number;
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
  declare clock: Clock;
  constructor(options: { serial?: string, adb?: string, readyDelayMs?: number,
    observe?: (() => Promise<LifecycleState | null>) | null, observeArm?: (() => ArmSample | Promise<ArmSample>) | null,
    observeControlState?: (() => unknown) | null, sharedHid?: (() => SharedHid | null) | null,
    closeSharedHid?: (() => unknown) | null, pollMs?: number, onEvent?: (event: ExecutorEvent) => void,
    onOutput?: (chunk: string) => void, timing?: ExecutorTiming, nightReleaseOwner?: string, clock?: Clock } = {}) {
    const { serial, adb = 'adb', readyDelayMs = DEFAULT_READY_DELAY_MS,
      observe = null, observeArm = null, observeControlState = null,
      sharedHid = null, closeSharedHid = null, pollMs = 1000, onEvent = () => {}, onOutput = () => {}, timing = {},
      nightReleaseOwner = 'observer', clock = HOST_CLOCK } = options;
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
      gateReadWorstMs: timing.gateReadWorstMs ?? GATE_READ_WORST_MS,
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
    this.serial = serial; this.adb = adb; this.readyDelayMs = readyDelayMs; this.clock = clock;
    this.observe = observe; this.observeArm = observeArm;
    this.observeControlState = observeControlState; this.pollMs = timingValues.pollMs;
    this.armSettleMs = timingValues.armSettleMs;
    this.armObservationWindowMs = timingValues.armObservationWindowMs;
    this.gateRetryGapMs = timingValues.gateRetryGapMs;
    this.gateReadWorstMs = timingValues.gateReadWorstMs;
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
    const grantedAt = this.clock.now();
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
    const run = createRunState(!armVerification || armObserveOnce,
      armVerification ? (armObserveOnce ? 'UNRESOLVED' : 'PENDING') : null);
    const schedule = compileDeviceLocalHidSchedule(request, {
      readyDelayMs: this.readyDelayMs, gateTiming: this.gateTiming,
    });
    // Startup phase anchors. Without them the only timestamp between night
    // entry and the first action was the start marker, so two separate
    // attempts to remove the measured 26-30 s office-to-marker latency each
    // claimed success that the evidence did not support.
    this.onEvent({ type: 'hid.execute-entered', at: this.clock.now() });
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
    const tag = `${globalThis.process.pid}-${this.clock.now()}`;
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
    const spawned = sharedMode ? null
      : runAdbScript(this.adb, this.serial, renderDeviceLocalScript(schedule, { startMarker, armControl }), this.onOutput);
    const processPromise: Promise<unknown> = spawned === null
      ? new Promise<unknown>(resolve => {
          run.resolveSharedProcess = resolve;
        })
      : spawned.promise;
    this.onEvent(sharedMode
      ? { type: 'hid.handoff-reused', at: this.clock.now(), source: 'menu', readyDelayMs: 0 }
      : { type: 'hid.shell-spawned', at: this.clock.now(), readyDelayMs: schedule.readyDelayMs });
    this.child = spawned === null ? sharedHid : spawned.child;
    const processIdentity = this.child;
    const c: RunContext = { ex: this, run, schedule, armVerification, armObserveOnce, sharedHid, sharedMode,
      armControl, spawned, processIdentity,
      observeArm: () => this.#observeArm(), observeControlState: () => this.#observeControlState() };
    this.stopProcess = () => stopProcess(c);
    const observedProcessPromise = processPromise.then(value => {
      run.processDone = true;
      return value;
    }, error => {
      run.processDone = true;
      throw error;
    });
    // The marker wait below owns the first await; keep a launch failure from
    // becoming an unhandled rejection while that wait is in progress.
    observedProcessPromise.catch(() => {});
    const buildArmResult = () => armVerification ? {
      status: armObserveOnce ? run.armObservationStatus : 'PASS',
      cameras: armVerification.cameras, viewing: armVerification.viewing,
      observation: run.armObservation,
      ...(armObserveOnce ? { mode: 'observe-once' } : {}),
    } : undefined;
    const effectObservers: Promise<void>[] = [];
    const requestGateLedger = (at: number) => {
      run.pendingGateLedgerAt = at;
      if (run.startGateLedgerHook && schedule.gated) {
        const origin = run.pendingGateLedgerAt;
        run.pendingGateLedgerAt = null;
        run.startGateLedgerHook(origin, schedule.gated);
      }
    };
    const recordNightGo = (at: number, source?: string) => {
      if (run.nightAnchoredAt === null) run.nightAnchoredAt = at;
      if (run.nightGoEmitted) return;
      run.nightGoEmitted = true;
      this.onEvent({ type: 'hid.night-go', at: run.nightAnchoredAt,
        ...(source ? { source } : {}) });
    };
    const startSharedSchedule = (requestedAt: number): Promise<void> => {
      if (!sharedMode || run.sharedReleaseInFlight || run.stopObserver || run.actuationHalt ||
          this.child !== processIdentity || !this.running)
        return run.sharedReleaseTask ?? Promise.resolve();
      run.sharedReleaseInFlight = true;
      run.sharedReleaseTask = (async () => {
        recordNightGo(requestedAt, 'intro-handoff');
        run.nightObserved = true;
        // Set inside onFirstWrite; typed by assertion so the checker does not narrow it to its initial null.
        let firstWriteAt = null as number | null;
        try {
          await feedShared(c, sharedScheduleBody(schedule, { armObserveOnce }), {
            onFirstWrite: at => {
              firstWriteAt = at;
              run.handoffDelayMs = at - requestedAt;
              this.onEvent({ type: 'hid.handoff', requestedAt, firstWriteAt: at,
                delayMs: run.handoffDelayMs, budgetMs: NIGHT_HANDOFF_BUDGET_MS });
              if (run.handoffDelayMs > NIGHT_HANDOFF_BUDGET_MS) {
                run.handoffFailure = invalidRun(
                  `night handoff was ${run.handoffDelayMs}ms late ` +
                  `(budget ${NIGHT_HANDOFF_BUDGET_MS}ms)`, 'late-night-handoff');
                this.onEvent({ type: 'hid.handoff.abort', delayMs: run.handoffDelayMs,
                  budgetMs: NIGHT_HANDOFF_BUDGET_MS, reason: 'late-night-handoff' });
                throw run.handoffFailure;
              }
            },
          });
          // A halt that lands while the body is being written stops it; that
          // is the halt working, not a failed handoff.
          if (run.actuationHalt) return;
          if (firstWriteAt === null) throw new Error('night handoff wrote no HID action');
          const releasedAt = firstWriteAt;
          run.nightReleasedAt = releasedAt;
          if (schedule.gated) {
            run.startControlEffectLedger('prefix', firstWriteAt,
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
            run.startControlEffectLedger('full', firstWriteAt,
              schedule.monitorTransitions, schedule.maskTransitions,
              { phaseEndMs: schedule.plannedUntilMs });
          }
          run.completionTimer = setTimeout(() => {
            void this.stopProcess?.().catch(() => {});
          }, Math.min(2147483647, Math.max(1000, schedule.plannedUntilMs + 10000)));
          this.onEvent({ type: 'hid.night-go-released', at: firstWriteAt,
            originUncertaintyMs: 50, shared: true, handoffDelayMs: run.handoffDelayMs });
        } catch (error) {
          run.handoffFailure ??= error;
          try { await stopRun(c); } catch { /* cleanup owns the final state */ }
        }
      })();
      return run.sharedReleaseTask;
    };
    this.nightReleaseAction = sharedMode ? startSharedSchedule : null;
    try {
      // The marker is created on the phone immediately before `/system/bin/hid`
      // starts consuming the preloaded stream. Anchoring here avoids charging
      // ADB connection setup against the plan-relative ready delay and arm
      // deadline. A shared title HID is already past that boundary, so its
      // schedule starts as soon as this executor is handed the ready process.
      if (!sharedMode) await waitForRemoteFile(this.adb, this.serial, startMarker, this.clock, {
        timeoutMs: 60000,
        processDone: () => run.processDone,
        processResult: () => observedProcessPromise,
      });
      const startedAt = this.clock.now();
      this.onEvent({ type: 'hid.schedule-start', startedAt, actionCount: schedule.actionCount,
        phaseOffsetMs: schedule.phaseOffsetMs });
      const startupDeadline = startedAt + STARTUP_GRACE_MS;
      // Control reads, gates, corrections and arm retries all belong to the
      // schedule, so a halt ends them with it; the lifecycle observer is not
      // one of them.
      const controlStillRunning = () => !run.stopObserver && !run.actuationHalt &&
        this.child === processIdentity && this.running;
      const waitUntil = async (deadline: number) => {
        while (controlStillRunning()) {
          const remainingMs = deadline - this.clock.now();
          if (remainingMs <= 0) return true;
          await this.clock.sleep(Math.min(remainingMs, 50));
        }
        return false;
      };
      const readControlState = () => {
        let readStartedAt: number | null = null;
        const read = run.controlReadTail.then(async () => {
          if (!controlStillRunning()) return { sample: null, readStartedAt, readFinishedAt: this.clock.now() };
          readStartedAt = this.clock.now();
          try {
            const sample = await this.#observeControlState();
            return { sample, readStartedAt, readFinishedAt: this.clock.now() };
          } catch {
            return { sample: null, readStartedAt, readFinishedAt: this.clock.now() };
          }
        });
        // A bad diagnostic read must not poison later, independent samples.
        run.controlReadTail = read.then(() => {}, () => {});
        return read;
      };
      run.startControlEffectLedger = (phase, originAt, monitorTransitions, maskTransitions,
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
            while (reads.length < CONTROL_EFFECT_MAX_SAMPLES && this.clock.now() < windowEndAt) {
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
              contactAt, windowEndAt, resultAt: this.clock.now(), status: verdict.status,
              reason: verdict.reason, latency: verdict.latency, sampleCount: reads.length,
              evidence, samples: verdict.samples, ...(attempt === null ? {} : { attempt }) });
          }
        })().catch(() => {
          // A diagnostic observer must never become a second actuator failure
          // mode. The absent result is visible from expected/sample events.
          if (run.actuationHalt) return;
          this.onEvent({ type: 'control.effect.observer-error', phase,
            ...(attempt === null ? {} : { attempt }) });
        });
        effectObservers.push(ledger);
      };
      // Each cycle boundary holds the stream until the device's mask parity
      // matches the plan's (cycle-gates.ts).
      const startGateLedger = (armGoAt: number, gated: GatedSchedule) => {
        if (typeof this.observeControlState !== 'function' || !gated.gates.length) return;
        const ledger = runCycleGates(armGoAt, gated, {
          clock: this.clock, retryGapMs: this.gateRetryGapMs, readWorstMs: this.gateReadWorstMs, sharedMode,
          onEvent: event => this.onEvent(event), stillRunning: controlStillRunning, halted: () => Boolean(run.actuationHalt),
          waitUntil, readControlState, feedShared: lines => feedShared(c, lines),
          touchArm: key => touchArm(c, key), stopRun: () => stopRun(c),
        }).catch(async () => {
          // After a halt the stream is already stopped and the observer owns
          // the end of the run; a gate that fails then must not end it early.
          if (run.actuationHalt) return;
          // A parked stream never resumes on its own. An observer that dies
          // silently would hang the night at a gate, so it fails the run
          // instead and lets the shell unwind through its own trap.
          this.onEvent({ type: 'control.gate.observer-error' });
          try {
            if (sharedMode) await stopRun(c);
            else await touchArm(c, 'fail');
          } catch { /* the run is ending */ }
        });
        effectObservers.push(ledger);
      };
      if (!schedule.gated && !sharedMode) {
        run.startControlEffectLedger('full', startedAt + schedule.readyDelayMs,
          schedule.monitorTransitions, schedule.maskTransitions,
          { phaseEndMs: schedule.plannedUntilMs });
      }
      if (sharedMode && releaseAlreadyGranted)
        void startSharedSchedule(releaseAlreadyGrantedAt ?? this.clock.now());
      // Native camera reads must not wait behind a full screencap + Python
      // lifecycle classification. An UNKNOWN frame is a reason to leave the
      // one-shot observation unresolved, not permission to destroy a
      // potentially successful arm.
      const observeArmOnce = async (verification: ArmVerification) => {
        const armReadyAtMs = schedule.armObservation?.armReadyAtMs;
        if (armReadyAtMs === undefined || !Number.isInteger(armReadyAtMs)) {
          run.armObservationStatus = 'UNRESOLVED';
          this.onEvent({ type: 'arm.unresolved', mode: 'observe-once', reason: 'arm-window-unavailable' });
          return;
        }
        while (controlStillRunning() && run.nightAnchoredAt === null)
          await this.clock.sleep(this.pollMs);
        if (!controlStillRunning() || run.nightAnchoredAt === null)
          return;
        // Read only where the plan shows the camera map (arm-observation.ts): the
        // old single read at armReadyAtMs + settle fell after k2/k3's opening
        // camdrop and read the office on 52 of 53 Night 7 nights. A read that
        // is not definitive tries the next window; the pair holds all night.
        const readTimes = armObservationTimes(schedule.monitorTransitions,
          { notBeforeMs: armReadyAtMs, settleMs: this.armSettleMs });
        if (!readTimes.length) {
          run.armObservationStatus = 'UNRESOLVED';
          this.onEvent({ type: 'arm.unresolved', mode: 'observe-once', reason: 'no-planned-camera-window' });
          return;
        }
        const origin = run.nightReleasedAt ?? run.nightAnchoredAt;
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
          if (run.actuationHalt) return;
          elapsedMs = this.clock.now() - startedAt;
          this.onEvent({ type: 'arm.sample', mode: 'observe-once', elapsedMs, attempt, planAtMs: readAtMs, sample });
          run.lastArmObservation = sample;
          highlights = sample?.highlights;
          if (sample?.sequence !== undefined && sample?.sequence !== null && isList(highlights)) break;
        }
        const sequence = sample?.sequence;
        if (sequence === undefined || sequence === null || !isList(highlights)) {
          run.armObservationStatus = 'UNRESOLVED';
          this.onEvent({ type: 'arm.unresolved', mode: 'observe-once', elapsedMs, attempts: readTimes.length,
            reason: sample?.reason ?? 'no-definitive-camera-frame' });
          return;
        }
        const key = JSON.stringify([...highlights].sort());
        const expected = JSON.stringify([...verification.cameras].sort());
        if (key === expected) {
          run.armObservation = sample;
          run.armObservationStatus = 'PASS';
          this.onEvent({ type: 'arm.verified', mode: 'observe-once', attempt, elapsedMs });
          return;
        }
        run.armObservationStatus = 'FAILED';
        run.armFailure = invalidRun(`camera arm verification identified a mismatch ` +
          `(expected=${expected} observed=${key})`, 'camera-pair-mismatch');
        this.onEvent({ type: 'arm.failed', mode: 'observe-once', attempt, elapsedMs,
          reason: 'camera-pair-mismatch', expected: JSON.parse(expected), observed: JSON.parse(key) });
        await stopRun(c);
      };
      run.startGateLedgerHook = startGateLedger;
      if (run.pendingGateLedgerAt !== null && schedule.gated) {
        const origin = run.pendingGateLedgerAt;
        run.pendingGateLedgerAt = null;
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
          if (sharedMode) await feedShared(c, gate.rearm);
          else await touchArm(c, 'retry');
          const rearmAt = this.clock.now();
          run.armAttempt += 1;
          run.startControlEffectLedger('rearm', rearmAt,
            gate.monitorTransitions.rearm, gate.maskTransitions.rearm,
            { originUncertaintyMs: 50, attempt: run.armAttempt,
              phaseEndMs: gate.rearmDurationMs });
          // Anchor to the actual retry signal, not a theoretical first-attempt
          // timeline that observation latency can outrun.
          nextCheckAt = this.clock.now() + gate.rearmDurationMs + this.armSettleMs;
          deadlineAt = nextCheckAt + this.armObservationWindowMs;
          candidate = null;
          confirmations = 0;
          this.onEvent({ type: 'arm.retry', attempt: run.armAttempt,
            elapsedMs: this.clock.now() - startedAt, reason });
        };
        while (!run.armVerified && controlStillRunning()) {
          await this.clock.sleep(this.pollMs);
          if (!controlStillRunning()) break;
          if (nextCheckAt === Infinity) {
            if (run.nightAnchoredAt === null) continue;
            nextCheckAt = (run.nightReleasedAt ?? run.nightAnchoredAt) + gate.armReadyAtMs + this.armSettleMs;
            deadlineAt = nextCheckAt + this.armObservationWindowMs;
          }
          if (this.clock.now() < nextCheckAt) continue;
          let sample: ArmSample | null = null;
          try { sample = await this.#observeArm(); }
          catch { /* an unavailable frame remains UNKNOWN */ }
          // No arm release, retry or failure stop after a halt.
          if (run.actuationHalt) break;
          const elapsedMs = this.clock.now() - startedAt;
          this.onEvent({ type: 'arm.sample', elapsedMs, attempt: run.armAttempt, sample });
          run.lastArmObservation = sample;
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
                  if (run.stopObserver || run.actuationHalt) break;
                  let armGoAt: number | null = null;
                  if (armControl) {
                    armGoAt = this.clock.now();
                    if (sharedMode) {
                      await feedShared(c, gate.remainderSegments[0]);
                      if (!gate.gates.length) {
                        for (const segment of gate.remainderSegments.slice(1)) await feedShared(c, segment);
                      }
                    } else {
                      await touchRemote(this.adb, this.serial, armControl.go);
                    }
                    // The parked prefix has already consumed armReadyAtMs. Any
                    // extra wall time before go is phase error, not harmless
                    // observation latency: the game clock keeps running.
                    const phaseLagMs = run.nightReleasedAt === null ? null
                      : armGoAt - run.nightReleasedAt - gate.armReadyAtMs;
                    if (phaseLagMs !== null && phaseLagMs > gate.phaseBudgetMs) {
                      this.onEvent({ type: 'phase.invalid', reason: 'late-arm-release',
                        phaseLagMs, phaseBudgetMs: gate.phaseBudgetMs,
                        armAttempt: run.armAttempt, nightReleasedAt: run.nightReleasedAt, armGoAt });
                      run.armFailure = invalidRun(
                        'phase-invalid: arm release lag ' + phaseLagMs +
                        'ms exceeds budget ' + gate.phaseBudgetMs + 'ms', 'late-arm-release');
                      await stopRun(c);
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
                  run.armVerified = true;
                  run.armObservation = sample;
                  this.onEvent({ type: 'arm.verified', attempt: run.armAttempt, elapsedMs,
                    ...(armGoAt === null ? {} : { armGoAt }) });
              } else if (run.armAttempt < MAX_ARM_ATTEMPTS) {
                  await retryArm('camera-pair-mismatch');
              } else {
                  deadlineAt = this.clock.now();
              }
            }
          } else {
            candidate = null;
            confirmations = 0;
          }
          if (!run.armVerified && this.clock.now() >= deadlineAt) {
              // A native watch can return a fresh sequence while the camera
              // panel is still between frames. That is not evidence that the
              // authored arm is wrong, but waiting longer on the same raised
              // monitor cannot repair it. Replay the physical arm sequence so
              // the next bounded window gets a new panel transition; keep the
              // fail-closed result once all attempts are spent.
              if (run.armAttempt < MAX_ARM_ATTEMPTS) {
                await retryArm('camera-observation-unavailable');
                continue;
              }
              run.armFailure = invalidRun(`camera arm verification missed after ${run.armAttempt} attempt(s) ` +
                `(expected=${JSON.stringify(armVerification.cameras)} ` +
                `viewing=${armVerification.viewing} last=${JSON.stringify(run.lastArmObservation)})`,
                // Why, from what the camera last showed: a definitive set is a
                // wrong pair; anything else never showed one.
                isList(run.lastArmObservation?.highlights ?? run.lastArmObservation?.cameraHighlights) &&
                  run.lastArmObservation?.sequence !== undefined && run.lastArmObservation?.sequence !== null
                  ? 'camera-pair-mismatch' : 'camera-observation-unavailable');
              await stopRun(c);
              break;
          }
        }
      })();
      run.armObserver = armVerification ? armObservationTask.catch(async error => {
        run.armFailure = error;
        await stopRun(c);
      }) : Promise.resolve();
      // Runs beside the authority, not instead of it. It only records WHEN the
      // native read first named the night screen; nothing here releases a
      // stream, ends a run, or decides that a night is running.
      const nativeAnchor = (this.observe && typeof this.observeControlState === 'function')
        ? (async () => {
          while (!run.stopObserver && this.child === processIdentity && this.running &&
                 run.nativeNightAt === null && !run.nightObserved) {
            const startedAt = this.clock.now();
            let sample: unknown = null;
            try { ({ sample } = await readControlState()); } catch { sample = null; }
            run.nativeAnchorSamples += 1;
            const screen = (sample as { screen?: unknown } | null | undefined)?.screen;
            if (screen === NATIVE_NIGHT_SCREEN) { run.nativeNightAt = startedAt; break; }
            // A read that positively named some OTHER screen is the native
            // stream's own lower bound on the transition. An UNKNOWN read
            // names nothing and must not move it.
            if (typeof screen === 'string' && screen !== 'UNKNOWN')
              run.nativeLastNotNightAt = startedAt;
            const spent = this.clock.now() - startedAt;
            if (spent < NATIVE_ANCHOR_POLL_MS)
              await this.clock.sleep(NATIVE_ANCHOR_POLL_MS - spent);
          }
        })().catch(() => {})
        : Promise.resolve();
      // A halted run's observation ends once its window, measured from the
      // static read that halted it, has run out: a read that was in flight at
      // the expiry is still taken first, so a Game Over it returns is the
      // terminal. The exit is the static exit the campaign already knows.
      const endAtHaltWindow = async (observedAt: number) => {
        if (!run.actuationHalt) return false;
        const heldMs = observedAt - run.actuationHalt.at;
        if (heldMs < this.staticTerminalWaitMs) return false;
        this.onEvent({ type: 'lifecycle.static-hold.expired', at: observedAt,
          heldMs, waitMs: this.staticTerminalWaitMs });
        run.observedExitState = 'static';
        run.stopObserver = true;
        await stopRun(c);
        return true;
      };
      run.observer = this.observe ? (async () => {
        while (!run.stopObserver && this.child === processIdentity && this.running) {
          await this.clock.sleep(this.pollMs);
          if (run.stopObserver || this.child !== processIdentity || !this.running) break;
          const observeStartedAt = this.clock.now();
          let state: LifecycleState | null = null;
          let unreadable = false;
          try { state = this.observe ? await this.observe() : null; }
          catch { unreadable = true; }
          const observedAt = this.clock.now();
          const gapMs = run.previousReadAt === null ? null : observedAt - run.previousReadAt;
          run.previousReadAt = observedAt;
          // The window assumes reads at most one observer interval apart. From
          // the read that halts actuation on, a longer gap is evented: r02's
          // reads around its static were 11776 and 8393 ms apart.
          if (gapMs !== null && gapMs > this.observerGapBoundMs &&
              (run.actuationHalt || (run.nightObserved && state === 'static')))
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
            catch (error) { this.onEvent({ type: 'lifecycle.stop-failed', at: this.clock.now(), error: eventMessage(error) }); }
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
              if (!run.nightObserved) {
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
                const lowerBound = run.lastNonNightObserveAt ?? run.nativeLastNotNightAt;
                const nativeAt = run.nativeNightAt;
                const refined = (nativeAt !== null && lowerBound !== null &&
                  nativeAt >= lowerBound && nativeAt <= observeStartedAt)
                  ? nativeAt : null;
                this.onEvent({ type: 'origin.refined',
                  authorityAtMs: observeStartedAt,
                  authorityBracketFromMs: run.lastNonNightObserveAt,
                  nativeBracketFromMs: run.nativeLastNotNightAt,
                  bracketSource: run.lastNonNightObserveAt !== null ? 'authority'
                    : (run.nativeLastNotNightAt !== null ? 'native' : 'none'),
                  nativeAtMs: run.nativeNightAt,
                  nativeSamples: run.nativeAnchorSamples,
                  accepted: refined !== null,
                  shrunkByMs: refined === null ? 0 : observeStartedAt - refined });
                const portOwnsRelease = sharedMode && this.nightReleaseOwner === 'port';
                if (portOwnsRelease) {
                  // Authorization only: releaseNight() records its own
                  // night-go when the port fires, so the schedule's origin is
                  // the placed instant, not this classifier sample.
                  // `at` stays the sample's start for the timeline; the gate
                  // opens only when the classification returned.
                  const authorizedAt = this.clock.now();
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
                    if (!run.sharedReleaseInFlight) await startSharedSchedule(this.clock.now());
                    if (run.stopObserver) break;
                    await run.sharedReleaseTask;
                    if (run.handoffFailure || run.stopObserver) break;
                  } catch (error) {
                    run.handoffFailure ??= error;
                    await stopRun(c);
                    break;
                  }
                } else if (armControl?.nightGo && schedule.gated) {
                  try {
                    await touchRemote(this.adb, this.serial, armControl.nightGo);
                    const nightGoAt = this.clock.now();
                    run.nightReleasedAt = nightGoAt;
                    run.startControlEffectLedger('prefix', nightGoAt,
                      schedule.gated.monitorTransitions.prefix, schedule.gated.maskTransitions.prefix,
                      { originUncertaintyMs: 50, attempt: 1,
                        phaseEndMs: schedule.gated.armReadyAtMs });
                    this.onEvent({ type: 'hid.night-go-released', at: nightGoAt,
                      originUncertaintyMs: 50 });
                  } catch (error) {
                    // The drop guard below still governs the run; the record
                    // says why the schedule never started.
                    this.onEvent({ type: 'hid.night-go-failed', at: this.clock.now(), error: eventMessage(error) });
                  }
                }
              }
              run.nightObserved = true;
              run.nonNightSamples = 0;
              // After a halt a night read resumes nothing and does not restart
              // the window: p1b read `state=night` once from inside its death
              // minigame, 123.7 s after its first static.
            } else if (!state) {
              // An UNKNOWN classification withholds a vote; see the catch below.
            } else if (!run.nightObserved) {
              // The authority's own lower bound on the origin: it looked at a
              // frame captured about now and did not call it a night.
              run.lastNonNightObserveAt = observeStartedAt;
            }
            if (state === 'gameover' || state === 'sixam') {
              if (!run.armVerified) {
                run.armFailure = new Error(`camera arm verification ended with ${state} ` +
                  `(expected=${JSON.stringify(armVerification?.cameras)} ` +
                  `viewing=${armVerification?.viewing} last=${JSON.stringify(run.lastArmObservation)})`);
              }
              run.observedTerminal = state;
              run.stopObserver = true;
              await stopRun(c);
              break;
            }
            // Once a night has been seen, the TITLE is not a transient
            // animation the way an intro or a dark frame is: the night is over
            // and the schedule is now pressing into a menu. `coords.sh` puts
            // New Game on that screen, so continuing to actuate there risks
            // the save, not just the run. It stops on the first positive read,
            // like gameover and sixam above.
            if (run.nightObserved && state !== null && TERMINAL_SCREENS.has(state)) {
              run.observedExitState = state;
              run.stopObserver = true;
              await stopRun(c);
              break;
            }
            // POST_NIGHT_STATIC_HALT. After a night, the first static read
            // stops every press and opens the STATIC_TERMINAL_WAIT_MS window;
            // the observer keeps reading. Static reads withhold their exit vote
            // (they neither count nor erase the votes already cast, like an
            // UNKNOWN read) until the window's expiry ends the run below. Any
            // other positive screen votes as before.
            if (run.nightObserved && state === 'static' && !run.actuationHalt) {
              this.onEvent({ type: 'lifecycle.static-hold', at: observedAt,
                waitMs: this.staticTerminalWaitMs });
              haltActuation(c, POST_NIGHT_STATIC_HALT, observedAt, { state,
                waitMs: this.staticTerminalWaitMs, ...(gapMs === null ? {} : { gapMs }) });
            }
            const staticWithheld = run.actuationHalt !== null && state === 'static';
            const startupTransition = !run.nightObserved &&
              (state === 'intro' || state === 'newspaper') && this.clock.now() < startupDeadline;
            if (startupTransition) {
              run.nonNightSamples = 0;
            } else if (staticWithheld) {
              // Withheld: the death's terminal screen is still expected.
            } else if (state && state !== 'night') {
              run.nonNightSamples += 1;
              if (run.nonNightSamples >= EXIT_CONFIRM_SAMPLES) {
                run.observedExitState = state;
                run.stopObserver = true;
                await stopRun(c);
                break;
              }
            }
            if (await endAtHaltWindow(observedAt)) break;
          } catch (error) {
            // A stop that fails while ending the run leaves the decision
            // already recorded above; teardown still releases the stream.
            this.onEvent({ type: 'lifecycle.stop-failed', at: this.clock.now(), error: eventMessage(error) });
          }
        }
      })() : Promise.resolve();
      try {
        await processPromise;
      } catch (error) {
        // The halt kills a device-local shell on purpose: that exit is the
        // halt, not a transport failure.
        if (!run.actuationHalt) throw error;
      }
      // After a halt the schedule's end is not the run's end: the observer
      // still reads until a terminal, a title or three exit votes, the
      // window's expiry, or a stop (external, or the shared completion
      // deadline) -- whichever comes first.
      if (run.actuationHalt) await run.observer;
      run.stopObserver = true;
      await run.actuationStop;
      await nativeAnchor;
      if (run.handoffFailure) throw run.handoffFailure;
      if (run.observedExitState)
        throw new Error(`device: lifecycle left night state (${run.observedExitState})`);
      if (!run.armVerified) throw run.armFailure ?? new Error('camera arm verification did not produce a positive observation');
      const completedArm = buildArmResult();
      return { status: 'COMPLETED', outcome: 'UNVERIFIED', night: schedule.night,
        plannedUntilMs: schedule.plannedUntilMs, blockCount: schedule.actionCount,
        deviceLocal: true, ...(run.observedTerminal ? { terminal: run.observedTerminal } : {}),
        ...(completedArm ? { armVerification: completedArm } : {}) };
    } catch (error) {
      // A fresh lifecycle observation is the only accepted reason to turn a
      // killed remote schedule into a normal failed attempt. Transport or
      // shell failures remain errors and are handled by the campaign abort
      // path.
      if (run.handoffFailure) throw run.handoffFailure;
      if (run.armFailure) throw run.armFailure;
      if (run.observedTerminal === 'gameover' || run.observedTerminal === 'sixam') {
        if (!run.armVerified) throw new Error(`camera arm verification ended with ${run.observedTerminal}`);
        const completedArm = buildArmResult();
        return { status: 'COMPLETED', outcome: 'UNVERIFIED', night: schedule.night,
          plannedUntilMs: schedule.plannedUntilMs, blockCount: schedule.actionCount,
          deviceLocal: true, terminal: run.observedTerminal,
          ...(completedArm ? { armVerification: completedArm } : {}) };
      }
      if (run.observedExitState)
        throw new Error(`device: lifecycle left night state (${run.observedExitState})`);
      throw error;
    } finally {
      run.stopObserver = true;
      if (run.completionTimer !== null) clearTimeout(run.completionTimer);
      this.nightReleaseAction = null;
      this.unblockNightRelease();
      await Promise.all([run.observer, run.armObserver, run.actuationStop, ...effectObservers]);
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
