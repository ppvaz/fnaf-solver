// The phone, between a pilot's schedule and the game.
//
// The exact simulator delivers every press on its scheduled frame and refuses
// only what the GAME refuses (engine.js press()). The device adds two failure
// modes of its own, both measured, and a schedule that survives without them
// has not been priced against the phone:
//
// - **Launch lateness.** Every wall-timed press lands late: the anchor press's
//   own lateness was 110-180 ms in the older traces and ~300 ms on night 6-40
//   (ON-DEVICE-VALIDATION.md). The mean is nearly free -- shifting the whole
//   route late survives up to 100 ms and the epoch offset dials it out -- but
//   the SPREAD costs nights (HID-MULTITOUCH.md: +/-10 ms of jitter drops
//   300/300 to 204/300). So `worst` mode does not pin lateness to the maximum:
//   a uniformly-late schedule is the benign case, and pinning would delete the
//   spread that does the damage.
//
//   **Re-scoped 2026-08-26, and the original is kept because the `worst`-mode
//   decision still rests on it.** On the HID route the mean is NOT nearly free
//   and the spread is not the lever: `packages/propose/parked/minus7/latenesssweep.ts` finds a uniform
//   205 ms is 0/200 on Nights 2-7 at any spread from +/-0 to +/-95, and halving
//   it to 110 or 83 changes nothing. Both readings are the same statement once
//   the frame quantisation below is taken seriously -- what costs nights is
//   total displacement in FRAMES, and 205 ms is 12 of them before any spread.
//   The real budget is two frames (41 ms) of per-anchor error, uniform or not;
//   the shipped `date`-based `wait_until` delivers 3-6 (49-106 ms, device probe
//   2026-08-26) and a fork-free `/proc/uptime` loop delivers 0-1. The `worst`
//   decision stands unchanged: pinning to the maximum still deletes the
//   cycle-to-cycle displacement that does the damage.
//
//   The band below is also NOT press-to-effect lateness. Every figure in it
//   stops at the shell -- see plans/12, "The lateness bands, decomposed and
//   priced" -- so the coprocess write, UHID, InputReader and Fusion's own poll
//   are outside it, bounded at roughly one frame and not measured.
//
// - **The mask seam.** While the mask is up or coming off, the monitor bar is
//   not drawn, so a monitor press there has no control under it. The engine
//   already refuses presses while the mask is ON; what only the phone loses is
//   the press during the mask-OFF animation, because setMask(false) clears
//   maskOn on the press and the animation runs as decoration. Measured across
//   the 28 graded nights (ON-DEVICE-VALIDATION.md "Which press desyncs, and
//   why", 2026-08-25): under 140 ms after the mask press 5 of 7 monitor
//   presses were lost, at 140-180 ms 4 of 8, and at 180 ms or more 0 of 17.
//
// Presses go through one queue, like the hid coprocess pipe (and the swipe
// era's sequential helper launches): order in is order out, so a press can
// land no earlier than the press before it. A backlog therefore delays a
// hold's release too -- that is the queue draining, not an error model
// corrupting flash lengths. Within one submission the press and its release
// share a single lateness draw, because plans/04 showed that independent
// draws turn every flash into a random length and price nothing.
//
// Measured but deliberately NOT modelled, because neither has a clean rate:
// the monitor press lost while a wind contact was still held (3 of 32
// readable, a geometry the runner no longer schedules), and the vent-light
// press drop ("dropped often enough to matter" -- no denominator yet). Add
// them here when a run census gives them numbers, not before.
import * as C from '@sixam/source/fnaf2';
import { Rng } from '@sixam/source/fnaf2';

// docs/device/ON-DEVICE-VALIDATION.md, the mask-seam band table. The bands are
// measurements, not knobs; a future edit has to argue with the census.
export const SEAM_BANDS = [
  { underMs: 140, dropChance: 5 / 7 },
  { underMs: 180, dropChance: 4 / 8 },
];
export const SEAM_SAFE_MS = 180; // 0 lost in 17 tries at or past this

// The measured landing band of a wall-timed press: 110-180 ms in the older
// traces, ~300 ms on night 6-40. The branch macro can be worse -- the capture
// pipeline has finished 30-900 ms past the plan's cut-off -- so this default
// is the optimistic end for that beat, and it is overridable where it is used.
//
// Provenance caveat (2026-08-25): every night since the cue-trace feature ran
// under the orphaned-loop parasite (ON-DEVICE-VALIDATION.md "pricing the
// stream as the classifier's capture"), which stalled 1-3% of cue reads ~1 s
// and may account for part of the 30-900 ms pipeline tail. The upper end of
// this band therefore needs a clean-phone re-measure before it is treated as
// the device's own lateness; the first post-fix night can re-source it.
//
// Sharpened 2026-08-26: the ~300 ms end was never logged. Night 6-40's read
// light-down was observed 700-810 ms into the cycle against a plan position of
// 367, and ~300 was back-computed from that by subtracting the gate's wait and
// the cue read -- one run, one inference, on a night whose ending was later
// retracted as an unlit lamp. No night 6-xx artifact survives in captures/, so
// it cannot be re-derived offline, only re-measured. The 110-180 end is the
// runner's own logged press offset from the plan's CYCLE BASE, which is the
// boundary's landing error plus the slip the shell arrived with; the boundary
// error alone is 49-106 ms. plans/12 separates the terms.
export const LAUNCH_LATE_MIN_MS = 110;
export const LAUNCH_LATE_MAX_MS = 300;

// ---------------------------------------------------------------- the loop
//
// `trial.sh` is not open-loop. It reads the monitor twice a cycle and
// presses again when it does not like the answer, and until now nothing here
// modelled that -- which is why every actuator figure for Nights 2+ was a
// statement about a controller the phone does not run. These constants are the
// runner's, quoted from the file, not invented for the model.
//
// `light_down_at`, the flip gate: wait MONITOR_ANIM_DOWN_MS from the *logged*
// monitor press, read the Companion, and only correct if a second read agrees.
// The cycle loop, the classifier checkpoint: the same frame the BB model reads
// is asked whether the cams are up, and a `cams=UP-DESYNCED` answer lowers,
// verifies, and lowers once more before resuming the cycle from a floor.
export const MONITOR_ANIM_DOWN_MS = 367; // src/config.js MONITOR_ANIM_DOWN, in ms
// The Moto g56 registers 33 ms contacts on monitor, mask, camera and hall
// controls. 100 ms was a conservative swipe-era margin, not the device floor.
export const TAP_CONTACT_MS = 33;
export const FUSION_POLL_MS = 33;
// The Companion's device-local read. CLAUDE.md prices it at 59 ms; the flip
// gate's own comment says 42 ms for the same call. 59 is the published number
// and the pessimistic one, so it is the default.
export const CUE_READ_MS = 59;
// The second checker invocation on the already-captured frame -- the
// `cams=UP-DESYNCED` question. Free in capture terms, but night 6-29 blew a
// deadline by about 100 ms running it, so it is not free in time.
export const CUE_MATCH_MS = 100;
// Light-down to the classifier's answer, as the HID pilot schedules it.
export const CLASSIFY_MS = 260;
// How long the Companion still reads the cameras as up after a lowering
// press. Measured across nights 6-36 to 6-38: `luma >= CUE_CAMS_UP_LUMA` up to
// **+202 ms and never later** (ON-DEVICE-VALIDATION.md, "Which press desyncs,
// and why").
//
// Anchored to the press the runner LOGGED, not to the frame it landed on, and
// that is the whole reason the shipped 367 ms gate is safe: the measurement was
// taken from the same `press_at` timestamps the gate waits from, so it already
// contains the launch lateness of those nights. Re-anchoring it to the landing
// would make the gate look 110-300 ms more dangerous than the nights it was
// measured on. `animAnchor: 'land'` exists to price that reading, and it is a
// sensitivity control, not the default.
export const CUE_ANIM_UP_MS = 202;
// `desyncs -le 12`, then the runner exits 48. A run that aborts is not a run
// that survived, so the model has to be able to end a night this way.
export const MAX_DESYNCS = 12;

const f = (msv) => Math.round(msv / 1000 * C.FPS);
const toMs = (frames) => frames * 1000 / C.FPS;

export class DeviceActuator {
  // `perPress` picks the lateness granularity. The swipe runner launches one
  // helper per table row, so every press re-rolls (perPress: true). The HID
  // runner wall-times one boundary per macro and spaces the inside with
  // hid_delay (+/-2 ms), so a whole beat shares one draw (perPress: false,
  // re-rolled by beat()).
  //
  // `lateWhen` is an ABLATION CONTROL, never a device model: it decides which
  // actions draw lateness at all, so a sweep can ask "which press's lateness
  // costs the night" instead of only "how much lateness costs the night". The
  // phone is late on every boundary it wall-times, so the default says yes to
  // everything and a `lateWhen` figure is a diagnostic, not a phone result.
  // The queue still serializes: an on-time press behind a late one is still
  // pushed, because that is what the coprocess pipe does.
  //
  // `maskFloorMs` is the phone's mask button, which the simulator does not
  // draw: after a lowering monitor press the button is absent through 322 ms
  // and fully visible only at ~382.5 ms (native frame trace; artifact-commands
  // SEAM_FLOORS.maskButtonFullyVisibleAfterMonitorDownMs). The simulator takes
  // a mask press any time the monitor is not up or raising, so a jittered mask
  // press that lands inside the lowering animation is kept by the model and
  // lost by the phone. With the floor set, a mask-ON press landing less than
  // maskFloorMs after the last lowering press is dropped and counted. Plans
  // clear the floor by the seam-slack margin, so it only bites when presses
  // move against each other. Null (the default) keeps every figure published
  // before it existed.
  constructor(sim, { seed = 1, worst = false, lateMinMs = LAUNCH_LATE_MIN_MS,
                     lateMaxMs = LAUNCH_LATE_MAX_MS, perPress = true,
                     closedLoop = null, lateWhen = null, maskFloorMs = null } = {}) {
    if (!(lateMinMs >= 0) || !(lateMaxMs >= lateMinMs))
      throw new Error('lateness band must satisfy 0 <= min <= max');
    if (lateWhen !== null && typeof lateWhen !== 'function')
      throw new Error('lateWhen must be a predicate on the action name');
    if (maskFloorMs !== null && !(maskFloorMs >= 0))
      throw new Error('maskFloorMs must be null or a non-negative number of ms');
    this.lateWhen = lateWhen;
    this.maskFloorFrames = maskFloorMs === null ? null : f(maskFloorMs);
    this.monitorDownAt = -Infinity; // landing frame of the last lowering monitor press
    this.maskFloorDrops = 0;
    this.sim = sim;
    // Its own stream, never sim.rng: a lateness draw must not move the game's
    // rolls, or no run is comparable to its unwrapped twin (model/reactive-pilot.mjs keeps
    // the same rule for its jitter draws).
    this.rng = new Rng(((seed >>> 0) ^ 0x9e3779b9) >>> 0, worst);
    this.lateMin = lateMinMs;
    this.lateMax = lateMaxMs;
    this.perPress = perPress;
    this.beatLateMs = this.sampleLateMs();
    this.pending = [];            // [landFrame, kind, act] in landing order
    this.lastLand = -1;
    this.holdLateMs = new Map();  // act -> the press's draw, reused by release
    this.maskOffAt = -Infinity;   // landing frame of the last mask-OFF press
    this.sent = 0;
    this.seamDrops = 0;
    // Off unless asked for, so every actuator figure published before this
    // existed still means what it meant.
    this.loop = closedLoop
      ? new MonitorSupervisor(this, closedLoop === true ? {} : closedLoop)
      : null;
  }

  sampleLateMs() {
    // No worst pin (see header): worst luck still draws, it only pins drops.
    return this.rng.int(this.lateMin, this.lateMax);
  }

  // A new wall-timed launch. Only meaningful with perPress: false.
  beat() { if (!this.perPress) this.beatLateMs = this.sampleLateMs(); }
  beatLateFrames() { return f(this.beatLateMs); }

  // The pilot's schedule reaches the phone here. With a supervisor attached the
  // runner is a blocking shell in between: while it is waiting out a flip or a
  // recovery, nothing the schedule wanted goes out, and it goes out when the
  // shell gets back to `wait_until`.
  submit(kind, act) {
    if (this.loop && this.loop.intercept(kind, act)) return;
    this.submitNow(kind, act);
  }

  submitNow(kind, act) {
    let lateMs;
    if (kind === 'release' && this.holdLateMs.has(act)) {
      lateMs = this.holdLateMs.get(act); // one draw per hold: plans/04
      this.holdLateMs.delete(act);
    } else {
      lateMs = this.perPress ? this.sampleLateMs() : this.beatLateMs;
      // The draw happens either way, so an ablation does not shift the
      // lateness stream and every cell of a sweep stays comparable.
      if (this.lateWhen && !this.lateWhen(act)) lateMs = 0;
      if (kind === 'press') this.holdLateMs.set(act, lateMs);
    }
    // The queue serializes: order in is order out, and a backlog delays what
    // follows it. This is what turns a draining sweep tail into a late anchor.
    const land = Math.max(this.sim.frame + f(lateMs), this.lastLand);
    this.lastLand = land;
    this.pending.push([land, kind, act]);
    // `press_at` stamps LAST_PRESS_MS / LAST_MONITOR_PRESS_MS when the runner
    // ISSUES the press, which is the clock every `wait_until` in the loop is
    // measured from. The phone's own lateness is not visible to the shell.
    if (this.loop && kind === 'press') this.loop.noteSent(act, this.sim.frame);
  }

  press(act) { this.submit('press', act); }
  release(act) { this.submit('release', act); }

  // Land everything due this frame. Call once per frame, before sim.tick().
  deliver() {
    if (this.loop) this.loop.tick();
    const now = this.sim.frame;
    while (this.pending.length && this.pending[0][0] <= now) {
      const [, kind, act] = this.pending.shift();
      if (kind === 'release') { this.sim.release(act); continue; }
      this.sent++;
      if (act === 'monitor' && this.seamDropped(now)) { this.seamDrops++; continue; }
      if (act === 'mask' && !this.sim.maskOn && this.maskFloorFrames !== null &&
          now - this.monitorDownAt < this.maskFloorFrames) { this.maskFloorDrops++; continue; }
      if (act === 'monitor' && (this.sim.monitor === 'up' || this.sim.monitor === 'raising'))
        this.monitorDownAt = now;
      // A mask press landing with the mask on is the mask-OFF press; the seam
      // it opens runs from this landing, not from the schedule's intent.
      if (act === 'mask' && this.sim.maskOn) this.maskOffAt = now;
      if (act === 'monitor' && this.loop) this.loop.lastMonitorLand = now;
      this.sim.press(act);
    }
  }

  seamDropped(now) {
    const gapMs = toMs(now - this.maskOffAt);
    const band = SEAM_BANDS.find(b => gapMs < b.underMs);
    return band ? this.rng.chance(band.dropChance, true) : false;
  }
}

// `trial.sh`'s monitor loop, and only that.
//
// WHAT IT MODELS -- every step is a line in the runner:
//
//   1. The flip gate (`light_down_at`). Immediately before the vent light goes
//      down, wait `MONITOR_ANIM_DOWN_MS` from the anchor's LOGGED monitor
//      press, read the Companion, and -- if it says the cams are up -- read it
//      once more, because "one sample cannot tell a flash from the cams". Two
//      agreeing reads press the monitor again and push the light-down out past
//      the corrective flip. Both reads cost time, and the shell is blocking, so
//      the cost lands on the rest of the cycle.
//   2. The classifier checkpoint (`monitor_seen` / `cams=UP-DESYNCED`). The
//      frame the BB model already captured is asked a second question. A
//      camera-feed frame means the anchor's lowering press did not take, so:
//      lower, wait the flip out, read the cue back, lower once more if it is
//      still up, then resume the cycle from a floor with the branch's mask-off
//      press SKIPPED (`MASK_ALREADY_OFF` -- there is no mask on to take off,
//      and pressing would put one on and blind every later read).
//   3. `desyncs -le 12`, then exit 48. An abort is not a survival.
//
// WHAT IT DELIBERATELY DOES NOT MODEL, because the runner cannot do it:
//
//   - **The loop is one-directional.** Both checkpoints ask "are the cams up
//     when they should be down". Nothing in the runner ever asks the opposite,
//     so a forcedown that lowers the monitor mid-sweep is invisible until it
//     produces a cams-up at the NEXT read. No `--sync`-style bidirectional
//     resync is available here, and adding one would model a controller that
//     does not exist.
//   - **It looks twice a cycle and nowhere else.** Between the read and the
//     next cycle's flip gate the runner is blind, so a monitor raise lost
//     inside the branch macro stands for the rest of the cycle.
//   - **It reads a state, not a parity.** The cue answers "are the cameras on
//     screen", exactly as the helper does; it never learns which press was
//     dropped.
//   - Classifier accuracy itself. The pilot's BB read stays whatever the pilot
//     models; `errorRate` here perturbs only the MONITOR observation, and only
//     as a control.
//   - The `nolight` / `unknown` streak branches, the Companion's stale-frame
//     age, and the 1-3% parasite read stalls. None has a rate this model could
//     honour.
//   - One known optimism, stated so it is not mistaken for a result: when the
//     gate corrects, the phone's vent light lands ~500 ms late and the
//     classifier's frame is taken out of position -- which is what produced the
//     `bbinside` and `unknown` misreads before `READ_CAPTURE_DELAY_MS` was
//     re-anchored. The wrapped pilot's BB answer is ground truth regardless of
//     where the light was, so the model charges the correction its time and not
//     its blindness. The reclaim below is therefore an upper bound on this
//     loop, not a floor.
export class MonitorSupervisor {
  constructor(act, { gateWaitMs = MONITOR_ANIM_DOWN_MS, cueReadMs = CUE_READ_MS,
                     cueMatchMs = CUE_MATCH_MS, classifyMs = CLASSIFY_MS,
                     cueAnimUpMs = CUE_ANIM_UP_MS, animAnchor = 'sent',
                     errorRate = 0, gate = true, checkpoint = true,
                     correct = true, confirmRead = true,
                     idealResync = false, maxDesyncs = MAX_DESYNCS } = {}) {
    if (animAnchor !== 'sent' && animAnchor !== 'land')
      throw new Error("animAnchor must be 'sent' or 'land'");
    this.act = act;
    this.sim = act.sim;
    this.gateWaitMs = gateWaitMs;
    this.cueReadMs = cueReadMs;
    this.cueMatchMs = cueMatchMs;
    this.classifyMs = classifyMs;
    this.cueAnimUpMs = cueAnimUpMs;
    this.animAnchor = animAnchor;
    this.errorRate = errorRate;
    this.gateOn = gate;
    this.checkpointOn = checkpoint;
    // `correct: false` keeps every read and pays every millisecond it costs,
    // and never presses. It is the control for "the reads are what helps".
    this.correct = correct;
    this.confirmRead = confirmRead;
    // NOT the runner, and never to be quoted as one. A free, instantaneous,
    // bidirectional repair of the pilot's own monitor belief -- what
    // `pilottest --vent --sync` does, applied to this route. It exists to
    // answer the question the shipped loop's result raises: is the reclaim
    // zero because THIS loop is too weak, or because no monitor loop can
    // recover what the actuator costs?
    this.idealResync = idealResync;
    if (idealResync) { this.gateOn = false; this.checkpointOn = false; }
    this.believedUp = false;
    this.maxDesyncs = maxDesyncs;
    this.lastMonitorSent = -Infinity;   // LAST_MONITOR_PRESS_MS
    this.lastMonitorLand = -Infinity;   // only read by animAnchor: 'land'
    this.lastPressSent = -Infinity;     // LAST_PRESS_MS
    this.steps = [];                    // [dueFrame, fn] -- the blocking shell
    this.buffer = [];                   // what the schedule wanted meanwhile
    this.deferred = [];                 // [dueFrame, kind, act]
    this.holdShift = new Map();         // a delayed contact keeps its hid_delay
    this.blocking = false;
    this.correcting = false;    // true only while the loop's own press is issued
    this.swallowNextMask = false;
    this.gateReads = 0;
    this.gateReadFrames = [];    // when each cue read was taken, for the tests
    this.gateCorrections = 0;
    this.gateFalse = 0;          // corrections taken on a monitor already down
    this.checkpointFalse = 0;
    this.checkpointDesyncs = 0;
    this.recoveryPresses = 0;
    this.blockedFrames = 0;
    this.aborted = false;
  }

  noteSent(action, frame) {
    this.lastPressSent = frame;
    if (action === 'monitor') this.lastMonitorSent = frame;
  }

  // What the Companion answers. `camsUp` alone is not it: during the lowering
  // animation the camera feed is still on screen, which is the whole reason the
  // gate has to wait the flip out.
  cueSaysUp(frame) {
    const m = this.sim.monitor;
    const anchor = this.animAnchor === 'sent' ? this.lastMonitorSent : this.lastMonitorLand;
    let up = m === 'up' || m === 'raising' ||
      (m === 'lowering' && toMs(frame - anchor) < this.cueAnimUpMs);
    // Exact at the ends, so the always-wrong control is a control and not a
    // 99.9% one, and so a zero rate never touches the stream.
    if (this.errorRate === 1) up = !up;
    else if (this.errorRate > 0 && this.act.rng.chance(this.errorRate, false)) up = !up;
    return up;
  }

  at(frame, fn) { this.steps.push([Math.max(frame, this.sim.frame), fn]); }

  block() { this.blocking = true; }

  // `wait_until` returned: the shell runs on, and everything the schedule
  // wanted while it was waiting goes out now, in order. An offset already in
  // the past fires immediately -- that is `wait_until` too.
  unblock() {
    this.blocking = false;
    const held = this.buffer;
    this.buffer = [];
    for (const [kind, action, submittedAt] of held) {
      if (kind === 'press') this.holdShift.set(action, this.sim.frame - submittedAt);
      this.emit(kind, action);
    }
  }

  // Hand one instruction to the queue. Two rules survive a blocking wait, and
  // both are the runner's: a contact whose down was pushed late still gets its
  // planned length (the release is one `hid_delay` after the press, not a
  // wall-clock offset), and the vent light's release IS the capture latch, so
  // the classifier's frame -- and the checkpoint asked of it -- moves with the
  // light that actually went down. Reading it at the offset the plan wanted
  // instead is the `READ_CAPTURE_DELAY_MS` bug the runner already paid for.
  emit(kind, action) {
    if (kind === 'release' && this.holdShift.has(action)) {
      const shift = this.holdShift.get(action);
      this.holdShift.delete(action);
      if (shift > 0) { this.deferred.push([this.sim.frame + shift, kind, action]); return; }
    }
    if (kind === 'release' && action === 'ventL') this.startCheckpoint();
    this.act.submitNow(kind, action);
  }

  intercept(kind, action) {
    // The pilot's model of the toggle: it presses blind, so its belief flips on
    // every monitor press it issues, whatever the game then does.
    if (kind === 'press' && action === 'monitor' && !this.correcting)
      this.believedUp = !this.believedUp;
    if (this.blocking) { this.buffer.push([kind, action, this.sim.frame]); return true; }
    // `MASK_ALREADY_OFF`: the recovery ran the branch macro without its
    // mask-off toggle.
    if (this.swallowNextMask && kind === 'press' && action === 'mask') {
      this.swallowNextMask = false;
      return true;
    }
    if (kind === 'press' && action === 'ventL' && this.gateOn) { this.startGate(); return true; }
    this.emit(kind, action);
    return true;
  }

  // The runner's own press, not the schedule's. It is a fresh wall-timed
  // launch, so it draws its own lateness like any other `press_at`.
  pressMonitor() {
    this.act.beat();
    this.correcting = true;
    this.act.submitNow('press', 'monitor');
    this.correcting = false;
    this.recoveryPresses++;
  }

  // ------------------------------------------------------- the flip gate
  startGate() {
    this.buffer.push(['press', 'ventL', this.sim.frame]);
    this.block();
    this.at(this.lastMonitorSent + f(this.gateWaitMs) + f(this.cueReadMs), () => {
      this.gateReads++;
      this.gateReadFrames.push(this.sim.frame);
      if (!this.cueSaysUp(this.sim.frame)) return this.unblock();
      if (!this.confirmRead) return this.gateCorrect();
      this.at(this.sim.frame + f(this.cueReadMs), () => {
        this.gateReads++;
        this.gateReadFrames.push(this.sim.frame);
        if (!this.cueSaysUp(this.sim.frame)) return this.unblock(); // a transient
        this.gateCorrect();
      });
    });
  }

  gateCorrect() {
    this.gateCorrections++;
    // Night 6-38's whole failure in one counter. 'lowering' counts as well as
    // 'down': the flip is still running, so the cams are NOT up, and the engine
    // treats a press during MON_LOWERING as a RAISE. A correction taken on a
    // monitor that was already coming down does not fix a desync, it makes one.
    if (this.sim.monitor === 'down' || this.sim.monitor === 'lowering') this.gateFalse++;
    if (!this.correct) return this.unblock();
    const sendAt = this.sim.frame + f(FUSION_POLL_MS);
    this.at(sendAt, () => {
      this.pressMonitor();
      // ld_offset = LAST_PRESS_MS + TAP_CONTACT_MS + MONITOR_ANIM_DOWN_MS
      this.at(this.lastPressSent + f(TAP_CONTACT_MS) + f(MONITOR_ANIM_DOWN_MS),
        () => this.unblock());
    });
  }

  // ------------------------------------------ the classifier's second question
  //
  // Asked on the frame that was already captured, and only when it can change
  // the decision: a confident `empty`/`bb` is an office frame by construction,
  // so the clear path pays nothing.
  startCheckpoint() {
    if (!this.checkpointOn) return;
    if (!this.cueSaysUp(this.sim.frame)) return;
    this.checkpointDesyncs++;
    if (this.sim.monitor === 'down' || this.sim.monitor === 'lowering') this.checkpointFalse++;
    if (this.checkpointDesyncs > this.maxDesyncs) { this.aborted = true; return; }
    this.at(this.sim.frame + f(this.classifyMs) + f(this.cueMatchMs), () => {
      if (!this.correct) return;
      this.block();
      this.at(this.sim.frame + f(FUSION_POLL_MS), () => {
        this.pressMonitor();
        this.at(this.lastPressSent + f(TAP_CONTACT_MS) + f(MONITOR_ANIM_DOWN_MS) +
                f(this.cueReadMs), () => {
          // "A recovery that assumes its own press landed is the same open-loop
          // mistake at one remove" -- night 6-43 stayed inverted through four.
          if (this.cueSaysUp(this.sim.frame)) {
            this.at(this.sim.frame + f(FUSION_POLL_MS), () => {
              this.pressMonitor();
              this.finishRecovery();
            });
          } else this.finishRecovery();
        });
      });
    });
  }

  finishRecovery() {
    this.swallowNextMask = true;
    this.at(this.lastPressSent + f(TAP_CONTACT_MS) + f(MONITOR_ANIM_DOWN_MS) +
            f(FUSION_POLL_MS), () => this.unblock());
  }

  // Only ever a bound. Free, instant, always right, and in both directions.
  tickIdeal() {
    const m = this.sim.monitor;
    if (m !== 'up' && m !== 'down') return;          // never mid-flip
    if (this.act.pending.some(p => p[2] === 'monitor')) return;  // one in flight
    if (this.sim.camsUp === this.believedUp) return;
    this.recoveryPresses++;
    if (this.sim.monitor === 'down' || this.sim.monitor === 'lowering') this.gateFalse++;
    this.sim.press('monitor');
  }

  tick() {
    if (this.idealResync) this.tickIdeal();
    if (this.blocking) this.blockedFrames++;
    const now = this.sim.frame;
    for (let i = this.deferred.length - 1; i >= 0; i--)
      if (this.deferred[i][0] <= now) {
        const [, kind, action] = this.deferred.splice(i, 1)[0];
        this.emit(kind, action);
      }
    // One step at a time: every step either schedules the next or unblocks, so
    // draining them all on one frame would collapse the waits they encode.
    while (this.steps.length) {
      const i = this.steps.findIndex(s => s[0] <= now);
      if (i < 0) break;
      const [, fn] = this.steps.splice(i, 1)[0];
      fn();
    }
  }
}
