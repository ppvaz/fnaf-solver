/**
 * Hold each cycle boundary until the device's mask parity matches what the
 * plan believes. The plan's targets are a simulated toggle chain, so the first
 * missed contact re-aims every action after it; this is what bounds that
 * damage to a single cycle.
 *
 * Mask-on and monitor-up are mutually exclusive on the device, so one mask
 * observation settles both halves -- and the mask detector is the one that
 * held across both 2026-09-09 Night 5 runs. The device-local executor
 * (adb-device-local-executor.ts) runs the gates beside a gated stream.
 */
import { compactControlSample } from './control-effect.ts';
import { gateMaskEvidence } from './gate-evidence.ts';
import type { HidSchedule } from './hid-schedule.ts';
import type { Clock } from './port-kit.ts';

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
export const GATE_RETRY_GAP_MS = 600;

/** What the gates need from the run they hold. */
interface GateRun {
  readonly clock: Clock;
  /** The spacing between a gate's reads. */
  readonly retryGapMs: number;
  /** The slowest read a re-read must leave room for before the release. */
  readonly readWorstMs: number;
  /** Corrections and releases are written to the shared title HID; otherwise signalled to the device-local shell. */
  readonly sharedMode: boolean;
  onEvent(event: { readonly type: string, readonly [field: string]: unknown }): void;
  /** False once the run has stopped, halted or been replaced. */
  stillRunning(): boolean;
  /** True once actuation has halted. */
  halted(): boolean;
  /** Wait for a host instant; false when the run stopped first. */
  waitUntil(at: number): Promise<boolean>;
  readControlState(): Promise<{ readonly sample: unknown, readonly readStartedAt: number | null, readonly readFinishedAt: number }>;
  feedShared(lines: readonly string[]): Promise<unknown>;
  touchArm(key: 'gateFix' | 'gateGo' | 'fail'): Promise<unknown>;
  stopRun(): Promise<unknown>;
}

/**
 * Run every gate of a gated stream, in order, from the arm release.
 * @param armGoAt host instant the stream left the arm (the run's clock)
 */
export async function runCycleGates(armGoAt: number, gated: NonNullable<HidSchedule['gated']>, run: GateRun) {
  // The stream runs on the phone's own clock from the arm release, so
  // a gate held past its budget leaves it behind this model. Carrying
  // that lag forward keeps every later release after the stream has
  // actually parked: releasing early would let the marker pre-exist,
  // skip the gate, and fire the next contact a whole budget early.
  let lagMs = 0;
  let releaseTouchMs = 0;
  for (const entry of gated.gates) {
    if (!run.stillRunning()) break;
    const reachedAt = armGoAt + (entry.gateAtMs - gated.armReadyAtMs) + lagMs;
    let releaseAt = reachedAt + entry.budgetMs;
    if (!await run.waitUntil(reachedAt)) break;
    // One ambiguous frame is not an unreadable state. Resample within
    // the budget so UNKNOWN means the state stayed unreadable, not
    // that a single 10 fps capture landed mid-animation.
    const reads: { startedAt: number | null, finishedAt: number }[] = [];
    let sample: ReturnType<typeof compactControlSample> | null = null;
    for (let attempt = 0; attempt < GATE_READ_ATTEMPTS; attempt += 1) {
      if (!run.stillRunning()) break;
      // Spaced, not back to back: consecutive reads a frame apart see
      // the same game moment, so an animation that refuses one read
      // refuses all three and a night ends on a state that would have
      // resolved on its own.
      if (attempt > 0) {
        // A re-read whose answer, and the correction it may call for,
        // would land after the release would release late, and that
        // lag moves every later contact. Unresolved by then is UNKNOWN.
        if (run.clock.now() + run.retryGapMs + run.readWorstMs + gated.correctionMs > releaseAt) break;
        await run.waitUntil(run.clock.now() + run.retryGapMs);
      }
      const read = await run.readControlState();
      reads.push({ startedAt: read.readStartedAt, finishedAt: read.readFinishedAt });
      sample = compactControlSample(read.sample);
      // Keep reading until the evidence answers (gate-evidence.ts). A
      // grid answer on a frame with no button signature is what
      // produced the spurious corrections; it is no longer a reason to
      // stop looking.
      if (gateMaskEvidence(sample, entry.believedMaskOn).observedMaskOn !== null) break;
    }
    if (!sample) break;
    // A halt during the reads: no correction, no release, no abort.
    if (run.halted()) break;
    const evidence = gateMaskEvidence(sample, entry.believedMaskOn);
    const observedMaskOn = evidence.observedMaskOn;
    let maskEvidenceSource = evidence.source;
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
      if (run.sharedMode) await run.feedShared(gated.monitorCorrection);
      else await run.touchArm('gateFix');
      correctedAt = run.clock.now();
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
      if (run.sharedMode) await run.feedShared(gated.maskCorrection ?? []);
      else await run.touchArm('gateFix');
      correctedAt = run.clock.now();
    }
    // The correction's read-back USED TO hold the stream:
    //
    //   releaseAt = Math.max(releaseAt, correctedAt + maskSettleMs + 250);
    //   await run.waitUntil(correctedAt + maskSettleMs);
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
    run.onEvent({ type: 'control.gate', gateAtMs: entry.gateAtMs,
      cycle: entry.cycle, nextActionId: entry.nextActionId,
      believedMaskOn: entry.believedMaskOn, observedMaskOn,
      maskEvidence: maskEvidenceSource,
      strokeSignature: evidence.strokeSignature,
      status, reachedAt, releaseAt, reads, sample,
      ...(monitorCorrected ? { monitorCorrected: true } : {}),
      ...(correctedAt === null ? {} : { correctedAt }) });
    if (status === 'UNKNOWN') {
      run.onEvent({ type: 'control.gate.abort', gateAtMs: entry.gateAtMs,
        reason: sample.maskReason ?? 'mask-state-unavailable' });
      if (run.sharedMode) await run.stopRun();
      else await run.touchArm('fail');
      break;
    }
    // The stream resumes when the marker appears, not when the
    // release is decided, so the touch is started early by what the
    // last one cost. Without this each gate paid its own adb latency
    // again and the night drifted 50-130 ms per cycle.
    if (!await run.waitUntil(releaseAt - releaseTouchMs)) break;
    const touchStartedAt = run.clock.now();
    if (run.sharedMode) {
      // A ready process has no ADB marker round trip to hide. The next
      // segment must be written at the release instant; writing it
      // early would let /system/bin/hid consume it before the gate.
      await run.feedShared(gated.remainderSegments[gated.gates.indexOf(entry) + 1]);
      releaseTouchMs = 0;
    } else {
      await run.touchArm('gateGo');
      releaseTouchMs = Math.min(entry.budgetMs / 2, run.clock.now() - touchStartedAt);
    }
    lagMs += Math.max(0, run.clock.now() - releaseAt);
  }
}
