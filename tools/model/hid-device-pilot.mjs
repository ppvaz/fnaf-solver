// Simulator pilot for comparing stock-Android HID timing experiments.
//
// The regular device pilot is constrained by `adb shell input swipe`, whose
// helper takes about 170 ms per press on the test phone. Android's `hid -`
// command can instead feed one persistent virtual touchscreen. The verified
// hybrid report holds contact 0 on the camera light while contact 1 gets a
// fresh down/up on each camera; see docs/device/HID-MULTITOUCH.md.
//
// This file's CAM 05 policy is retained as a comparison, not the selected
// Night 6 controller. The intended device route spends HID's saved time on the
// validated lit-left-opening classifier. Likewise, `--no-cam5` removes all BB
// handling; it is a negative control, not a model of that left-opening route.
import { pathToFileURL } from 'node:url';
import * as C from '@sixam/core/mechanics';
import { Sim } from '@sixam/core/mechanics';
import { DeviceActuator } from '../device/actuator.mjs';
import { formatRate } from '../stat.mjs';

const s = C.s;
const mv = (x) => Math.round(x * C.FPS / 1000);   // ms -> frames
const TARGETS = [10, 4, 7];
const TARGET_OFFSETS = [1 / 60, 6 / 60, 11 / 60];

// The sourced mask-off animation is 15 render frames. Leave one additional
// render frame after its endpoint before another control is scheduled. A full
// extra Fusion poll is already enforced between distinct steady contacts; it
// is not needed inside this single maskraise HID stream. This is the model-side
// frame form of the device recipe's 267 ms maskraise gap.
export const MASK_OFF_INPUT_FRAMES = C.MASK_ANIM_OFF + 1;

// Plan 16 (constrained policy search) parameter space: named device-plan
// timing offsets, each defaulting to a no-op so an unset harness produces the
// byte-identical 803feb3 plan. Search callers pass an immutable assignment to
// each build; no process-global experiment state is shared between runs.
export const DEFAULT_SEARCH_KNOBS = Object.freeze({
  attackHallDeltaMs: 0,    // leftAttack post-mask reset, off+MASK_OFF_INPUT -> +d
  attackSweepDeltaMs: 0,   // leftAttack recovery sweep, off+0.45 -> off+0.45+d   (ceil: 400-fr Withered budget)
  attackRstDeltaMs: 0,     // leftAttack: an extra hall reset in the recovery, d ms into the wind (0 = none)
  clearHall2DeltaMs: 0,    // leftClear device branch, second reset b+3.10 -> +d
  phaseMarginDeltaMs: 0,   // leftAttack `off` phase margin, 900 -> 900+d          (floor: ~300, item 8)
  hallPulseDeltaMs: 0,     // every hall pulse length, 130 -> 130+d                (floor: MIN_CONTACT 100)
  openGfFlick: 0,          // pkg 5: opening gains a monitor-down mask flick across the frame-300 GF check
  preReadHallMs: 0,        // pkg 4: a hall pulse this many ms into leftNormal, before the read (needs openGfFlick; tight-Foxy nights only)
  bangAgeFrames: 0,        // pkg 4: only fire that pulse when the last departure bang is younger than this (0 = unconditional)
  attackBangGateMs: 0,     // item 10: gate leftAttack's mask-off/raise on the observed BB departure bang -- fire it `d` ms after the bang instead of the blind `off = b + 5.02 + phaseMargin(900)`, pulled EARLIER only, never delayed (0 = the blind wait)
});

export function makeSearchKnobs(overrides = {}) {
  const knobs = { ...DEFAULT_SEARCH_KNOBS };
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in knobs)) throw new Error(`unknown HID search knob: ${key}`);
    if (value !== undefined) knobs[key] = value;
  }
  for (const [key, value] of Object.entries(knobs)) {
    if (!Number.isFinite(value) || !Number.isInteger(value))
      throw new Error(`HID search knob ${key} must be a finite integer`);
  }
  return Object.freeze(knobs);
}

class HidPilot {
  constructor(sim, { bbMode = 'left', cam5Light = true, phaseSafeMask = true,
                     alwaysThreat = false, sparseCam5 = false,
                     sparseLeft = false, cam5Hold = s(0.52),
                     pilotOffset = 0, vocalCam5 = false, dropVocal = 0,
                     vocalFalseCount = 0, bangCam5 = false, dropBang = 0,
                     bangFalseCount = 0, deviceSweep = false,
                     sweepSlotMs = 240, pulseLight = false,
                     secondBeat = false, maskMarginMs = null,
                     readLatencyMs = 360, hallPulseMs = 83,
                     prophylacticMask = true, actuator = null,
                     attackWindowMs = 10000, traceActions = false,
                     knobs = DEFAULT_SEARCH_KNOBS } = {}) {
    this.sim = sim;
    this.knobs = makeSearchKnobs(knobs);
    // Plan 16 structural experiment: the BB-response cycle length. 10 s is the
    // baseline (a 5 s masked hold, a reset+sweep, then a ~3.5 s recovery with a
    // second, weakly-covered Foxy check). A shorter window hands the next
    // reset/check back to an ordinary 5 s read cycle instead. `replay()` reads
    // this from the emitted `#cycle attack N` header so the two stay in step.
    this.attackWindow = attackWindowMs / 1000;
    // The measured phone between this table and the game. The HID runner
    // wall-times one boundary per macro and spaces the inside with hid_delay
    // (+/-2 ms), so lateness here is one draw per beat, not per press --
    // per-press draws would jitter the sweep spacing the coprocess queue
    // actually preserves, and double-count what --sweep-slot-ms models.
    this.act = actuator;
    // Mask on the classifier's answer instead of before it. The device runner
    // cannot see the mask's state, so every unconditional toggle is a chance to
    // latch it on -- and a latched mask makes every later left read dark, which
    // the model reports as a confident `bbinside`.
    this.prophylacticMask = prophylacticMask;
    this.bbMode = bbMode;
    this.cam5 = bbMode === 'cam5';
    this.cam5Light = cam5Light;
    this.sparseCam5 = sparseCam5;
    this.sparseLeft = sparseLeft;
    this.vocalCam5 = vocalCam5;
    this.bangCam5 = bangCam5;
    this.deviceSweep = deviceSweep;
    this.sweepSlotMs = sweepSlotMs;
    this.pulseLight = pulseLight;
    // The phase-safe second is generous because the pilot did not know the
    // game's one-second tick phase. `DEVICE_EPOCH_LATCH` now brackets T0 to
    // about 80 ms, so the margin can be sized to that instead -- which is the
    // only place the 790 ms sweep's extra stun gap can be paid from.
    this.maskMargin = maskMarginMs === null ? null : s(maskMarginMs / 1000);
    // Light-down to an immutable captured frame. 360 ms is the optimistic end
    // of the phone's measured 360/434/431 ms latches; the live runner has also
    // seen ~410-480 ms. Everything after the read -- the prophylactic mask and
    // so the whole five-tick window -- is pushed back by this.
    this.readLatency = s(readLatencyMs / 1000);
    // The table's 83 ms hall pulse is a simulator duration. On the phone it is
    // a bare contact, and Fusion polls touch per frame: a graded run scheduled
    // ten of them and `grade-minus7.py` found *zero* visible beams. The device
    // profile therefore pays for a contact above the proven 100-120 ms floor.
    this.hallPulse = s(hallPulseMs / 1000) + mv(this.knobs.hallPulseDeltaMs);
    // The device sweep's second monitor-down beat is replaced by winding
    // unless this asks for the ideal route's shape back.
    this.secondBeat = secondBeat;
    // Held-light device profile: contact 0 goes down first and needs a 70 ms
    // settle, and the hold runs a full slot past the last camera.
    // Pulsed profile: the camera is selected first and the light is pulsed
    // afterwards, so there is no leading settle and the span is only the two
    // inter-camera gaps plus one 100 ms contact.
    // Sweeps are preceded by a wind hold, and the phone needs released time
    // between the two: see WIND_LEAD_FRAMES.
    // The sweep ends exactly on its anchor and cannot be moved: one frame of
    // tail costs 272 of 400 nights, because the stun it refreshes has to
    // bridge the five-tick mask with nothing to spare. The phone's problem
    // with that -- the next cycle's monitor press arriving while the sweep
    // macro is still draining -- is solved in the runner, not here.
    this.sweepTail = 0;
    this.sweepFrames = !deviceSweep ? 16
      : pulseLight ? s((2 * sweepSlotMs + 100) / 1000)
        : s((70 + 3 * sweepSlotMs) / 1000);
    this.sweepOffsets = !deviceSweep ? TARGET_OFFSETS.map(offset => s(offset))
      : pulseLight
        ? [0, s(sweepSlotMs / 1000), s(2 * sweepSlotMs / 1000)]
        : [s(0.070), s((70 + sweepSlotMs) / 1000),
          s((70 + 2 * sweepSlotMs) / 1000)];
    this.cam5Hold = cam5Hold;
    this.epoch = pilotOffset;
    this.phaseSafeMask = phaseSafeMask;
    this.alwaysThreat = alwaysThreat;
    this.queue = [];
    this.mode = 'normal';
    this.nextAnchor = this.epoch + s(7);
    // BB starts at CAM 10. Four successful five-second rolls are needed to
    // reach CAM 05, so a pre-boundary sensor cannot first be useful until the
    // fifth boundary at 25 s (the read itself completes at 24.7 s).
    this.cam5SafeAt = (vocalCam5 || bangCam5) ? Infinity
      : sparseCam5 ? this.epoch + s(24.7) : 0;
    // A perfect BB reaches the opening on the fifth five-second opportunity.
    // The first five-second pilot anchor after that edge is 27 s. Unlike the
    // CAM-05 bound, this sensor is the battery-free left vent light.
    this.leftSafeAt = sparseLeft ? this.epoch + s(27) : 0;
    this.checks = 0;
    this.detections = 0;
    this.attacks = 0;
    this.missed = 0;
    this.eventCursor = 0;
    this.traceActions = Boolean(traceActions);
    this.trace = [];
    this.trueVocals = 0;
    this.vocalsSeen = vocalFalseCount;
    this.dropVocal = dropVocal;
    this.audioMisses = 0;
    // The bang policy counts, because counting is all the phone supports: a
    // Balloon Boy cycle is exactly three bangs (g416 reaches CAM 05, g417
    // enters the opening, g292/294 leaves) and his first three hops are silent.
    this.dropBang = dropBang;
    this.trueBangs = 0;
    this.bangs = 0;
    this.falseBangs = bangFalseCount;
    if (vocalCam5 && this.vocalsSeen >= 3) this.cam5SafeAt = this.epoch;
    this.minBox = 1;
    this.opening();
  }

  at(f, kind, act = null) {
    this.queue.push([f, kind, act]);
    this.queue.sort((a, b) => a[0] - b[0]);
  }

  tap(f, act) { this.at(f, 'tap', act); }
  hold(f, frames, act) {
    this.at(f, 'down', act);
    this.at(f + frames, 'up', act);
  }

  // One wall-timed launch. Everything scheduled until the next beat shares one
  // lateness draw, and the capture events shift with it below, because the
  // flip-gate runner places the capture from the light-down that happened
  // rather than the one the plan scheduled.
  beat() { if (this.act) this.act.beat(); }
  beatShift() { return this.act ? this.act.beatLateFrames() : 0; }

  opening() {
    this.beat();
    const e = this.epoch;
    this.tap(e + s(0.18), 'monitor');
    this.tap(e + s(0.46), 'cam:11');
    const openingSweep = this.deviceSweep
      ? e + s(6.5) - this.sweepFrames - this.sweepTail : e + s(6.25);
    const openingWindEnd = this.deviceSweep ? openingSweep - 3 : e + s(6.10);
    const openingWindStart = e + (this.deviceSweep ? s(0.60) : s(0.52));
    if (this.knobs.openGfFlick && this.deviceSweep) {
      // pkg 5: the opening is the one cycle with no mask flick, so Golden
      // Freddy spawns at the frame-300 check (g336) and persists into the
      // first steady cycle. Drop the monitor across that check and flick the
      // mask (the press clears him); the opening runs a >3 s wind margin.
      this.hold(openingWindStart, e + s(4.35) - openingWindStart, 'wind');
      this.tap(e + s(4.45), 'monitor');
      this.tap(e + s(4.85), 'mask');
      this.tap(e + s(5.10), 'mask');
      this.tap(e + s(5.40), 'monitor');
      this.hold(e + s(5.62), openingWindEnd - (e + s(5.62)), 'wind');
    } else {
      this.hold(openingWindStart, openingWindEnd - openingWindStart, 'wind');
    }
    // The left-opening cycle deliberately flashes late. Put the opening
    // sweep late as well so its stun cannot expire before cycle zero's sweep.
    const end = this.flashTargets(openingSweep);
    this.tap(end + s(0.05), 'cam:11');
    this.hold(end + (this.deviceSweep ? s(0.19) : s(0.13)), s(0.12), 'wind');
  }

  flashTargets(f, targets = TARGETS) {
    const start = f;
    if (this.pulseLight) {
      // `stunCam` refreshes on every frame the camera light is on while that
      // camera is selected, so contact 0 does not have to stay down across
      // the whole 790 ms phone sweep. Pulsing it around each camera contact
      // keeps the same stun for 30 frames of battery instead of 47 -- and at
      // 47 the three-camera sweep alone outspends night 6's 3000 frames.
      for (const [i, cam] of targets.entries()) {
        const at = start + this.sweepOffsets[i];
        this.tap(at, `cam:${cam}`);
        this.hold(at + 1, s(0.100), 'light');
      }
      return start + this.sweepFrames;
    }
    // Three 5-frame camera contacts fit in the final 16 frames before the next
    // drop. CAM 10 and CAM 04 are then refreshed on the exact frame their
    // previous 400-frame stuns expire after a phase-safe BB mask; CAM 07 stays
    // selected and parks the two Withereds on that choke while cameras are
    // down. 83 ms spans more than two 30 Hz Fusion polls on the phone.
    this.hold(start, this.sweepFrames, 'light');
    for (const [i, cam] of targets.entries())
      this.tap(start + this.sweepOffsets[i], `cam:${cam}`);
    return start + this.sweepFrames;
  }

  // Drop, clear a possible office Golden Freddy, reset Foxy, then raise.
  // These gaps retain the sourced Android flip/mask animation durations while
  // letting the HID contacts themselves stay short.
  normalFront(a) {
    this.tap(a, 'monitor');
    this.tap(a + s(0.40), 'mask');
    this.tap(a + s(0.70), 'mask');
    this.hold(a + s(1.10), this.hallPulse, 'light');
    this.tap(a + s(1.30), 'monitor');
    this.flashTargets(a + s(1.60));
  }

  normal(a) {
    if (this.bbMode === 'left') {
      if (this.sparseLeft) {
        if (a < this.leftSafeAt) this.leftIdle(a);
        else this.sparseLeftNormal(a);
      } else {
        this.leftNormal(a);
      }
      return;
    }
    this.normalFront(a);
    const shouldCheck = this.cam5 && a + s(2.70) >= this.cam5SafeAt;
    if (shouldCheck) {
      this.tap(a + s(2.10), 'cam:5');
      if (this.cam5Light) this.hold(a + s(2.18), this.cam5Hold, 'light');
      this.at(a + s(2.70), 'cam5-before', a);
    } else {
      this.tap(a + s(2.12), 'cam:11');
      this.hold(a + s(2.20), s(2.75), 'wind');
    }
  }

  // Night 7's cheap steady cycle while BB provably cannot be in the opening.
  // The sweep finishes on the next anchor, retaining the same five-second
  // refresh cadence as the ordinary left route while maximizing box time.
  leftIdle(a) {
    const sweepStart = a + s(5) - this.sweepFrames - this.sweepTail;
    this.tap(a, 'monitor');
    this.tap(a + s(0.40), 'mask');
    this.tap(a + s(0.70), 'mask');
    this.hold(a + s(1.10), this.hallPulse, 'light');
    this.tap(a + s(1.30), 'monitor');
    this.tap(a + s(1.62), 'cam:11');
    this.hold(a + s(1.74), sweepStart - 1 - (a + s(1.74)), 'wind');
    this.flashTargets(sweepStart);
  }

  // Phase-windowed Night 7 candidate. Clear a possible office Golden Freddy
  // and reset Foxy before paying for the free left-opening observation. The
  // 28-frame vent hold exceeds the three observed immutable-buffer latches
  // (360/434/431 ms from light-down) but remains a device promotion gate, not
  // a claim that this exact table has run on the phone.
  sparseLeftNormal(a) {
    this.tap(a, 'monitor');
    this.tap(a + 23, 'mask');
    this.tap(a + 36, 'mask');
    this.hold(a + 52, 5, 'light');
    this.hold(a + 59, 28, 'ventL');
    this.at(a + 86 + this.beatShift(), 'left-snapshot', a);
    this.tap(a + 88, 'mask');
  }

  // The selected Night 6 route. Lower first, then hold the free left vent
  // light across the phone's measured 350 ms draw delay. The raw frame is
  // immutable once screencap starts, so HID can put the mask on while the
  // ~206 ms capture/analysis tail finishes. That makes the mask fully on
  // before the +1 s scheduler event if the result is BB, while an empty result
  // simply turns the ordinary Golden-Freddy flick back off.
  leftNormal(a) {
      const lightDown = a + s(0.36);
    const latch = lightDown + this.readLatency;
    this.tap(a, 'monitor');
    // pkg 4 lever (item 11): a hall pulse DURING the read. `lightHeld` and
    // `ventLightL` are independent, so with the monitor down and mask off this
    // is a valid Foxy reset ~0.3 s before the prophylactic mask -- it enters
    // the attack cycle's masked hold near D = 0 instead of D ~= 3. Blocked by
    // Golden Freddy (kills on the press) unless the opening/recovery GF-clears
    // hold him absent -- so it is gated on `openGfFlick` and only fires on the
    // tight-Foxy nights (peak AI >= 10).
    if (mv(this.knobs.preReadHallMs) > 0 && this.prophylacticMask
        && this.knobs.openGfFlick && C.peakAi((this.sim.opts && this.sim.opts.night) || 6, 'foxy') >= 10) {
      // This is a device-plan action, not an abstract three-frame flash.
      // Keeping the ordinary hall-contact duration means the emitted plan
      // continues to satisfy Fusion's measured contact floor.
      this.hold(a + mv(this.knobs.preReadHallMs), this.hallPulse, 'light');
    }
    this.hold(lightDown, latch + 3 - lightDown, 'ventL');
    this.at(latch + this.beatShift(), 'left-snapshot', a);
    if (this.prophylacticMask) this.tap(latch + s(0.06), 'mask');
  }

  onLeftSnapshot(a) {
    this.checks++;
    const sample = { a, bb: this.alwaysThreat || this.sim.bb.inOpening,
                     inside: this.sim.bb.inside };
    // Measured raw capture plus both classifiers is about 250 ms after the
    // frame becomes available. The result deliberately arrives after the
    // prophylactic mask press above.
    this.at(this.sim.frame + s(0.26), 'left-result', sample);
  }

  // Empty-frame continuation. A second down/mask/hall beat straddles the next
  // five-second movement opportunity. It clears any late Golden Freddy,
  // resets Foxy only ~1.3 s before the following BB check, and leaves the
  // camera sweep as late as possible. Two short winding windows still exceed
  // the sourced box break-even rate.
  // The branch is one floored macro on the phone: rm_floor launches it off the
  // read that happened and preserves every plan gap. So when the read chain
  // ran late (the actuator shifts the snapshot by its beat), the whole branch
  // shifts with it -- scheduling it at plan time would compress the branch's
  // own gaps against the result, a geometry the runner does not have. Zero
  // whenever the read landed on plan, so the exact routes are untouched.
  branchShift(a, resultAt) {
    return Math.max(0, resultAt - (a + s(0.36) + this.readLatency + s(0.26)));
  }

  leftClear(a, resultAt) {
    const b = a + this.branchShift(a, resultAt);
    // With no prophylactic mask there is nothing to take off; the press would
    // put one ON and blind every later read.
    const maskOff = resultAt + s(0.02);
    if (this.prophylacticMask) this.tap(maskOff, 'mask');
    // hallLightOn needs maskFullyOff and the sourced mask-off animation is 15
    // frames, so when the
    // phone's read latency pushes this press late the pulse below sits
    // entirely inside that animation and reaches nobody -- 420 frames of
    // flashlight a night spent on nothing. The second beat's pulse is the
    // cycle's real Foxy reset either way; skipping this one when it cannot
    // land takes the night's power floor from 716 frames to 1111.
    // The result can arrive after the nominal first beat. Move that whole
    // beat as a unit when necessary; otherwise the corrected input gate would
    // leave the monitor press on the mask even though the off press landed.
    const nominalRaise = b + s(1.38);
    const raiseShift = Math.max(0, maskOff + MASK_OFF_INPUT_FRAMES - nominalRaise);
    const firstHall = b + s(1.28) + raiseShift;
    const raiseAt = nominalRaise + raiseShift;
    const earlyHallLands = firstHall >= maskOff + MASK_OFF_INPUT_FRAMES;
    if (earlyHallLands)
      this.hold(firstHall, this.hallPulse, 'light');
    // The measured read latency makes the old +1.28 s slot land inside the
    // mask-off animation, so the shipped route used to omit this reset and
    // leave Foxy for the second beat. Reuse the raise macro as the fallback:
    // its hall contact is queued before the simultaneous monitor press, just
    // like the attack recovery, and the tail of the hold remains live after
    // the mask animation clears. Under the gate's broad 1200-seed human-slack
    // sample this one reset moves Night 6 from 449/1200 to 673/1200 without
    // moving any camera-stun or read boundary.
    if (!earlyHallLands)
      this.hold(raiseAt, this.hallPulse, 'light');
    this.tap(raiseAt, 'monitor');
    this.tap(b + s(1.62) + raiseShift, 'cam:11');
    if (this.deviceSweep && !this.secondBeat) {
      // The phone's 790 ms sweep leaves the second wind window below one
      // frame, so the cycle drains. Spend the second monitor-down beat on
      // winding instead: one hall reset and one prophylactic mask per cycle
      // remain, and the sweep still lands on the anchor.
      const only = b + s(5) - this.sweepFrames - this.sweepTail;
      this.hold(b + s(1.77), b + s(2.68) - (b + s(1.77)), 'wind');
      // The second Foxy reset still needs the monitor down, but not the
      // second Golden Freddy flick -- beat one's prophylactic mask already
      // covers this cycle. Dropping the flick shortens the beat from 1.48 s
      // to 0.73 s, which is where the wind the 790 ms sweep costs comes from.
      this.tap(b + s(2.72), 'monitor');
      this.hold(b + s(3.10) + mv(this.knobs.clearHall2DeltaMs), this.hallPulse, 'light');
      // The hall pulse is a 130 ms contact on the phone, so the raise it is
      // meant to precede has to clear it, and CAM 11 has to clear the raise's
      // 204 ms animation after that.
      this.tap(b + s(3.27), 'monitor');
      this.tap(b + s(3.50), 'cam:11');
      this.hold(b + s(3.64), Math.max(1, only - 3 - (b + s(3.64))), 'wind');
      this.flashTargets(only);
      return;
    }
    this.hold(b + s(1.74), b + s(2.68) - (b + s(1.74)), 'wind');

    this.tap(b + s(2.72), 'monitor');
    this.tap(b + s(3.10), 'mask');
    this.tap(b + s(3.45), 'mask');
    this.hold(b + s(3.73), this.hallPulse, 'light');
    this.tap(b + s(3.85), 'monitor');
    this.tap(b + s(4.08), 'cam:11');
    // The sweep must land on the anchor, not overrun it. With the phone's
    // 790 ms actuator that pulls its start back over this wind window, which
    // is the point of measuring the device profile on this route.
    const sweepStart = b + s(5) - this.sweepFrames - this.sweepTail;
    const windEnd = this.deviceSweep ? sweepStart - 3 : b + s(4.68);
    this.hold(b + s(4.20), Math.max(1, windEnd - (b + s(4.20))), 'wind');
    this.flashTargets(sweepStart);
  }

  // A negative sparse read rules out the opening at this instant. The monitor
  // may stay up across the next movement opportunity: BB can at most move onto
  // CAM 05 there, and the following sparse read catches a final hop.
  sparseLeftClear(a, resultAt) {
    // The sparse read's plan-time result lands at a+86 plus the classify tail;
    // the branch floors off the result that happened, like leftClear's.
    const b = a + Math.max(0, resultAt - (a + 86 + s(0.26)));
    const sweepStart = b + s(5) - this.sweepFrames - this.sweepTail;
    const maskOff = resultAt + 1;
    const raiseAt = Math.max(b + 119, maskOff + MASK_OFF_INPUT_FRAMES);
    const shift = raiseAt - (b + 119);
    this.tap(maskOff, 'mask');
    this.tap(raiseAt, 'monitor');
    this.tap(b + 135 + shift, 'cam:11');
    this.hold(b + 140 + shift, sweepStart - 1 - (b + 140 + shift), 'wind');
    this.flashTargets(sweepStart);
  }

  // A positive left-opening frame was captured before the prophylactic mask.
  // Keep that same mask down through ticks +1..+5. The late hall beat in the
  // previous cycle makes Foxy's +3 s roll safe; the previous late camera
  // sweep remains live until this response refreshes it after tick five.
  leftAttack(a, resultAt) {
    this.attacks++;
    const b = resultAt === undefined ? a : a + this.branchShift(a, resultAt);
    const phaseMargin = this.maskMargin !== null ? this.maskMargin
      : this.phaseSafeMask ? s(1) : 0;
    // Without a prophylactic mask the response has to put one on itself, off
    // the classifier's answer. g293 zeroes the tick counter on every entry into
    // the fully-on state, so the five ticks are one continuous hold starting
    // here rather than cumulative storage.
    if (!this.prophylacticMask && resultAt !== undefined)
      this.tap(resultAt + s(0.02), 'mask');
    // The shift moves the mask-off later, never earlier -- rm_floor floors the
    // attack past its own mask press, so a late read extends the hold.
    const off = b + s(5.02) + phaseMargin + mv(this.knobs.phaseMarginDeltaMs);
    this.tap(off, 'mask');
    // The hall press is queued before the simultaneous monitor raise. It
    // therefore resets Foxy during the raise frame without spending another
    // 120 ms before the recovery sweep.
    const inputAt = off + MASK_OFF_INPUT_FRAMES + mv(this.knobs.attackHallDeltaMs);
    this.hold(inputAt, this.hallPulse, 'light');
    this.tap(inputAt, 'monitor');
    // The old off+450 ms expression was exactly one monitor-up animation after
    // the old off+250 ms input. With the sourced mask clearance it would land
    // the first camera two frames before the monitor is up; anchor the sweep
    // to the actual raise instead.
    const end = this.flashTargets(inputAt + C.MONITOR_ANIM_UP + mv(this.knobs.attackSweepDeltaMs));
    this.tap(end + s(0.05), 'cam:11');
    const windStart = end + (this.deviceSweep ? s(0.19) : s(0.13));
    const W = this.attackWindow;
    const lateSweepStart = b + s(W) - this.sweepFrames - this.sweepTail;
    const windEnd = this.deviceSweep ? lateSweepStart - 3 : b + s(9.46 * W / 10);
    // Is there room for a distinct recovery sweep before the next anchor? At
    // the 10 s baseline there is (~3 s of tail); a shorter window folds it
    // away and lets the next ordinary read cycle own the next sweep.
    const hasRecoverySweep = lateSweepStart > windStart + s(0.4);
    // Plan 16 pkg 4 lever: an extra Foxy reset in the recovery, decoupled from
    // the masked block. Straddle the attack cycle's second 5 s check with the
    // monitor down (no Golden Freddy spawn, g336), flash, raise, resume wind.
    const rstD = mv(this.knobs.attackRstDeltaMs);
    if (rstD > 0 && this.deviceSweep && hasRecoverySweep) {
      const rst = b + rstD;
      this.hold(windStart, Math.max(1, rst - s(0.05) - windStart), 'wind');
      this.tap(rst, 'monitor');
      this.hold(rst + s(0.42), this.hallPulse, 'light');
      this.tap(rst + s(0.62), 'monitor');
      this.hold(rst + s(0.90), Math.max(1, windEnd - (rst + s(0.90))), 'wind');
    } else {
      this.hold(windStart, Math.max(1, (a + s(W) - 3) - windStart), 'wind');
    }
    if (hasRecoverySweep) this.flashTargets(lateSweepStart);
    this.nextAnchor = a + s(W);
  }

  // The pre-read hall pulse makes the aligned five-tick hold affordable on
  // Night 7. This is deliberately phase-windowed: extending the mask by the
  // one-second phase-independent margin lets the previous camera stuns expire.
  // `--pilot-offset-ms` prices that dependency against the game's scheduler.
  sparseLeftAttack(a, resultAt) {
    this.attacks++;
    const b = resultAt === undefined ? a
      : a + Math.max(0, resultAt - (a + 86 + s(0.26)));
    const lateSweepStart = b + s(10) - this.sweepFrames - this.sweepTail;
    const off = b + s(6.02);
    this.tap(off, 'mask');
    const inputAt = off + MASK_OFF_INPUT_FRAMES;
    this.hold(inputAt, this.hallPulse, 'light');
    this.tap(inputAt, 'monitor');
    const end = this.flashTargets(inputAt + C.MONITOR_ANIM_UP);
    this.tap(end + s(0.05), 'cam:11');
    const windEnd = this.deviceSweep ? lateSweepStart - 3 : b + s(9.46);
    this.hold(end + s(0.13), Math.max(1, windEnd - (end + s(0.13))), 'wind');
    this.flashTargets(lateSweepStart);
    // BB can leave on the first masked scheduler tick. Twenty-five seconds
    // from this anchor is therefore the conservative next useful read.
    this.leftSafeAt = a + s(25);
    this.nextAnchor = a + s(10);
  }

  onLeftResult(sample) {
    this.beat(); // the branch macro is its own floored launch (rm_floor)
    if (!sample.bb) {
      if (sample.inside) this.missed++;
      if (this.sparseLeft) this.sparseLeftClear(sample.a, this.sim.frame);
      else this.leftClear(sample.a, this.sim.frame);
      return;
    }
    this.detections++;
    if (this.sparseLeft) this.sparseLeftAttack(sample.a, this.sim.frame);
    else this.leftAttack(sample.a, this.sim.frame);
  }

  // BB has already been seen on CAM 05. Refresh the normal defences, lower
  // before the next five-second movement boundary, then raise just after it.
  // A pending final hop is thereby spent at a chosen time with the cameras
  // already up, which leaves time for a pre-mask stun sweep.
  tracking(a) {
    this.normalFront(a);
    this.tap(a + s(2.12), 'cam:11');
    this.hold(a + s(2.20), s(0.47), 'wind');
    this.tap(a + s(2.70), 'monitor');
    this.tap(a + s(3.15), 'monitor');
    this.tap(a + s(3.38), 'cam:5');
    if (this.cam5Light) this.hold(a + s(3.45), this.cam5Hold, 'light');
    this.at(a + s(3.97), 'cam5-after', a);
  }

  // With BB now in the opening, refresh every stall camera before lowering.
  // The always-taken mask flick clears an unseen office Golden Freddy before
  // the hall flash. The final mask becomes fully on just before the next
  // one-second tick; five ticks later, HID has enough stun margin to unmask,
  // reset Foxy and refresh all three cameras again.
  attack(a) {
    const start = a + s(0.10);
    this.attacks++;
    this.flashTargets(start);
    this.tap(start + s(0.45), 'monitor');
    this.tap(start + s(0.85), 'mask');
    this.tap(start + s(1.08), 'mask');
    this.hold(start + s(1.38), this.hallPulse, 'light');
    this.tap(start + s(1.50), 'mask');

    this.tap(start + s(5.95), 'mask');
    this.hold(start + s(6.25), this.hallPulse, 'light');
    this.tap(start + s(6.38), 'monitor');
    const end = this.flashTargets(start + s(6.62));
    this.tap(end, 'cam:11');
    this.hold(end + s(0.08), a + s(10) - (end + s(0.10)), 'wind');

    // Resume CAM 05 on the first cycle after recovery; delaying by route
    // timing created a small blind window when fresh Night-6 rolls lined up
    // with the recovery boundary. `cam5Light=false` is retained only as a
    // hypothetical bound: the 2026-08-24 phone run rejected unlit vision.
    // A fully phased attack can expel BB at the first one-second mask tick.
    // In sparse mode, resume just before the fifth following movement
    // boundary: four successful rolls may have put him back on CAM 05, but a
    // final hop cannot have occurred yet.
    this.cam5SafeAt = (this.vocalCam5 || this.bangCam5) ? Infinity
      : this.sparseCam5 ? a + s(22.7) : a + s(10);
    this.mode = 'normal';
    this.nextAnchor = a + s(10);
  }

  onCam5Before(a) {
    this.beat();
    this.checks++;
    if (this.sim.bb.stage !== C.BB_STAGES - 1) {
      // The read is the ground truth the bang count is not. He is not on
      // CAM 05, so whatever armed this was wrong: drop the count and wait for
      // a fresh first bang rather than carrying a corrupted phase all night.
      if (this.bangCam5) { this.bangs = 0; this.cam5SafeAt = Infinity; }
      if (this.sim.bb.inOpening || this.sim.bb.inside) this.missed++;
      this.tap(this.sim.frame + 2, 'cam:11');
      this.hold(this.sim.frame + 6, a + s(5) - (this.sim.frame + 8), 'wind');
      return;
    }
    this.detections++;
    // Confirmed on CAM 05: that is bang one of the cycle, whatever the count
    // said before.
    if (this.bangCam5) this.bangs = 1;
    this.mode = 'tracking-inline';
    this.tap(this.sim.frame + 2, 'monitor');
    this.tap(a + s(3.15), 'monitor');
    this.tap(a + s(3.38), 'cam:5');
    if (this.cam5Light) this.hold(a + s(3.45), this.cam5Hold, 'light');
    this.at(a + s(3.97), 'cam5-after', a);
  }

  onCam5After(a) {
    this.beat();
    this.checks++;
    if (this.sim.bb.inOpening) {
      this.mode = 'attack-pending';
    } else if (this.sim.bb.stage === C.BB_STAGES - 1) {
      this.mode = 'tracking';
    } else {
      // A non-BB view is fail-closed in the real classifier. In the exact
      // simulator this branch means our state assumption was violated.
      this.missed++;
      this.mode = 'attack-pending';
    }
    this.tap(this.sim.frame + 2, 'cam:11');
    this.hold(this.sim.frame + 6, a + s(5) - (this.sim.frame + 8), 'wind');
  }

  scheduleAnchor(a) {
    this.beat();
    if (this.mode === 'attack-pending') {
      this.attack(a);
      return;
    }
    if (this.mode === 'tracking' || this.mode === 'tracking-inline') {
      this.mode = 'tracking';
      this.tracking(a);
    } else {
      this.normal(a);
    }
    this.nextAnchor = a + s(5);
  }

  // Perfect-cue upper bound for plan 08. The third sourced vocal means BB has
  // just reached CAM 05, so the next pre-boundary visual read can confirm him
  // once instead of scanning every possible movement boundary. `dropVocal`
  // deliberately removes one true vocal per approach to expose the policy's
  // false-negative tolerance; it is not a detector model.
  // The bang is the loud cue (channel 15 at volume 50) and, while Minus 7's
  // stalls hold and the box is wound, Balloon Boy is its only source -- every
  // other writer of that register is one of the seven stun-locked, and W. Foxy
  // and Golden Freddy never write it. So this reads *only* that a bang
  // happened. It deliberately ignores `who`, `cam` and `leaving`: none of them
  // is recoverable from audio, and a controller that consulted them would be
  // modelling a sensor that does not exist. A bang from a unit whose stall
  // lapsed therefore corrupts the count here exactly as it would on device.
  processBangEvents() {
    // A cycle is exactly three bangs -- reaches CAM 05, enters the opening,
    // leaves -- and his first three hops are silent. The count alone is as
    // brittle as the vocal count it replaces, so the CAM 05 read re-syncs it:
    // the read is ground truth about where he is, and the bang only decides
    // when to spend one. There is no cheaper fallback to degrade to, because
    // reading on a fixed schedule is itself 0/300 on power.
    if (this.falseBangs > 0) {
      this.falseBangs--;
      this.bangs++;
      if (this.bangs === 1) this.cam5SafeAt = Math.min(this.cam5SafeAt, this.sim.frame);
    }
    while (this.eventCursor < this.sim.events.length) {
      const event = this.sim.events[this.eventCursor++];
      if (event.type !== 'vent-bang' || event.data?.sample !== C.THUD_SAMPLE)
        continue;
      this.trueBangs++;
      if (this.dropBang === this.trueBangs) { this.audioMisses++; continue; }
      this.bangs++;
      if (this.bangs === 1) {
        this.cam5SafeAt = Math.min(this.cam5SafeAt, this.sim.frame);
      } else if (this.bangs >= 3) {
        this.bangs = 0;
        this.cam5SafeAt = Infinity;
      }
    }
  }

  processAudioEvents() {
    if (this.bangCam5) return this.processBangEvents();
    if (!this.vocalCam5) return;
    while (this.eventCursor < this.sim.events.length) {
      const event = this.sim.events[this.eventCursor++];
      if (event.type === 'laugh') {
        this.trueVocals++;
        if (this.dropVocal === this.trueVocals) {
          this.audioMisses++;
          continue;
        }
        this.vocalsSeen++;
        if (this.vocalsSeen >= 3)
          this.cam5SafeAt = Math.min(this.cam5SafeAt, this.sim.frame);
      } else if (event.type === 'vent-bang' && event.data?.who === 'bb' &&
                 event.data.leaving) {
        this.trueVocals = 0;
        this.vocalsSeen = 0;
        this.cam5SafeAt = Infinity;
      }
    }
  }

  step() {
    const f = this.sim.frame;
    this.processAudioEvents();
    if (f === this.nextAnchor) this.scheduleAnchor(f);
    while (this.queue.length && this.queue[0][0] <= f) {
      const [, kind, act] = this.queue.shift();
      const before = this.traceActions ? {
        frame: this.sim.frame, monitor: this.sim.monitor, monAnim: this.sim.monAnim,
        maskOn: this.sim.maskOn, maskAnim: this.sim.maskAnim, cam: this.sim.cam,
        winding: this.sim.winding, lightHeld: this.sim.lightHeld,
        foxy: { loc: this.sim.foxy.loc, D: this.sim.foxy.D,
          gotYou: this.sim.foxy.gotYou, exposure: this.sim.foxy.exposure,
          pinUntil: this.sim.foxy.pinUntil },
        bb: { stage: this.sim.bb.stage, inOpening: this.sim.bb.inOpening,
          inside: this.sim.bb.inside, maskTicks: this.sim.bb.maskTicks },
        units: this.sim.units.map(u => ({ id: u.id, idx: u.idx,
          atOpening: u.atOpening, done: u.done, pending: u.pending,
          stunUntil: u.stunUntil })),
      } : null;
      if (kind === 'left-snapshot') this.onLeftSnapshot(act);
      else if (kind === 'left-result') this.onLeftResult(act);
      else if (kind === 'cam5-before') this.onCam5Before(act);
      else if (kind === 'cam5-after') this.onCam5After(act);
      else if (kind === 'up') this.act ? this.act.release(act) : this.sim.release(act);
      else this.act ? this.act.press(act) : this.sim.press(act);
      if (before) this.trace.push({ ...before, kind, act,
        after: { monitor: this.sim.monitor, monAnim: this.sim.monAnim,
          maskOn: this.sim.maskOn, maskAnim: this.sim.maskAnim, cam: this.sim.cam,
          winding: this.sim.winding, lightHeld: this.sim.lightHeld,
          foxy: { loc: this.sim.foxy.loc, D: this.sim.foxy.D,
            gotYou: this.sim.foxy.gotYou, exposure: this.sim.foxy.exposure,
            pinUntil: this.sim.foxy.pinUntil },
          bb: { stage: this.sim.bb.stage, inOpening: this.sim.bb.inOpening,
            inside: this.sim.bb.inside, maskTicks: this.sim.bb.maskTicks },
          units: this.sim.units.map(u => ({ id: u.id, idx: u.idx,
            atOpening: u.atOpening, done: u.done, pending: u.pending,
            stunUntil: u.stunUntil })) } });
    }
    if (this.act) this.act.deliver();
    this.minBox = Math.min(this.minBox, this.sim.box);
  }
}

export function run(opts = {}) {
  const knobs = makeSearchKnobs(opts.knobs);
  const sim = new Sim(Object.assign({ seed: 1, night: 6 }, opts.sim));
  const actuator = opts.deviceActuator
    ? new DeviceActuator(sim, Object.assign(
        { seed: (opts.sim && opts.sim.seed) ?? 1, worst: opts.sim && opts.sim.worst,
          perPress: false },
        opts.deviceActuator === true ? {} : opts.deviceActuator))
    : null;
  const bot = new HidPilot(sim, Object.assign({}, opts, { actuator, knobs }));
  while (sim.alive && !sim.won) {
    bot.step();
    sim.tick();
  }
  return { sim, bot, actuator };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cliArgs = process.argv.slice(2);
  const n = cliArgs[0] && !cliArgs[0].startsWith('--') ? +cliArgs.shift() : 500;
  const exactArgs = new Set(['--worst', '--sparse-cam5', '--sparse-left',
    '--vocal-cam5', '--bang-cam5', '--device-sweep', '--cam5', '--no-bb', '--no-cam5',
    '--hypothetical-unlit', '--tick-aligned-mask', '--always-threat',
    '--assert', '--assert-rejected', '--pulse-light', '--second-beat', '--trace-actions',
    '--device-actuator']);
  const valuedArgs = ['--hall-pulse-ms=', '--read-latency-ms=', '--mask-margin-ms=', '--sweep-slot-ms=', '--cam5-light-ms=',
    '--pilot-offset-ms=', '--drop-vocal=', '--vocal-false-count=',
    '--drop-bang=', '--false-bang=', '--night=', '--press-late-ms=', '--attack-window-ms=',
    '--knobs-json='];
  const unknownArgs = cliArgs.filter(arg => !exactArgs.has(arg) &&
    !valuedArgs.some(prefix => arg.startsWith(prefix)));
  if (unknownArgs.length) throw new Error(`unknown argument: ${unknownArgs.join(', ')}`);
  const worst = cliArgs.includes('--worst');
  const sparseCam5 = cliArgs.includes('--sparse-cam5');
  const sparseLeft = cliArgs.includes('--sparse-left');
  const vocalCam5 = cliArgs.includes('--vocal-cam5');
  const bangCam5 = cliArgs.includes('--bang-cam5');
  const sweepSlotArg = (cliArgs.find(v => v.startsWith('--sweep-slot-ms=')) || '').split('=')[1];
  const deviceSweep = cliArgs.includes('--device-sweep') || Boolean(sweepSlotArg);
  const sweepSlotMs = sweepSlotArg ? +sweepSlotArg : 240;
  const pulseLight = cliArgs.includes('--pulse-light');
  const hallPulseArg = (cliArgs.find(v => v.startsWith('--hall-pulse-ms=')) || '').split('=')[1];
  const hallPulseMs = hallPulseArg ? +hallPulseArg : 83;
  const readLatencyArg = (cliArgs.find(v => v.startsWith('--read-latency-ms=')) || '').split('=')[1];
  const readLatencyMs = readLatencyArg ? +readLatencyArg : 360;
  const maskMarginArg = (cliArgs.find(v => v.startsWith('--mask-margin-ms=')) || '').split('=')[1];
  const maskMarginMs = maskMarginArg === undefined ? null : +maskMarginArg;
  const secondBeat = cliArgs.includes('--second-beat');
  const awArg = (cliArgs.find(v => v.startsWith('--attack-window-ms=')) || '').split('=')[1];
  const attackWindowMs = awArg ? +awArg : 10000;
  const bbMode = cliArgs.includes('--cam5') || sparseCam5 || vocalCam5 || bangCam5 ? 'cam5'
    : (cliArgs.includes('--no-bb') || cliArgs.includes('--no-cam5')) ? 'none'
      : 'left';
  const cam5Light = !cliArgs.includes('--hypothetical-unlit');
  const cam5MsArg = (cliArgs.find(v => v.startsWith('--cam5-light-ms=')) || '').split('=')[1];
  const cam5Hold = cam5MsArg ? s(+cam5MsArg / 1000) : s(0.52);
  const offsetMsArg = (cliArgs.find(v => v.startsWith('--pilot-offset-ms=')) || '').split('=')[1];
  const pilotOffset = offsetMsArg ? s(+offsetMsArg / 1000) : 0;
  const dropVocalArg = (cliArgs.find(v => v.startsWith('--drop-vocal=')) || '').split('=')[1];
  const dropVocal = dropVocalArg ? +dropVocalArg : 0;
  const falseVocalArg = (cliArgs.find(v => v.startsWith('--vocal-false-count=')) || '').split('=')[1];
  const vocalFalseCount = falseVocalArg ? +falseVocalArg : 0;
  const dropBangArg = (cliArgs.find(v => v.startsWith('--drop-bang=')) || '').split('=')[1];
  const dropBang = dropBangArg ? +dropBangArg : 0;
  const falseBangArg = (cliArgs.find(v => v.startsWith('--false-bang=')) || '').split('=')[1];
  const bangFalseCount = falseBangArg ? +falseBangArg : 0;
  const phaseSafeMask = !cliArgs.includes('--tick-aligned-mask');
  const alwaysThreat = cliArgs.includes('--always-threat');
  const assertSurvival = cliArgs.includes('--assert');
  const assertRejected = cliArgs.includes('--assert-rejected');
  const traceActions = cliArgs.includes('--trace-actions');
  const knobsArg = (cliArgs.find(v => v.startsWith('--knobs-json=')) || '').slice('--knobs-json='.length);
  let knobs = DEFAULT_SEARCH_KNOBS;
  if (knobsArg) {
    try {
      const parsed = JSON.parse(knobsArg);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
        throw new Error('must be a JSON object');
      knobs = makeSearchKnobs(parsed);
    } catch (e) {
      throw new Error(`--knobs-json= must be a valid HID knob object: ${e.message}`);
    }
  }
  const nightArg = (cliArgs.find(v => v.startsWith('--night=')) || '').split('=')[1];
  const night = nightArg ? +nightArg : 6;
  const lateArg = (cliArgs.find(v => v.startsWith('--press-late-ms=')) || '').split('=')[1];
  let deviceActuator = cliArgs.includes('--device-actuator');
  if (lateArg !== undefined) {
    if (!deviceActuator) throw new Error('--press-late-ms= does nothing without --device-actuator');
    const [lo, hi] = lateArg.split(',').map(Number);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi < lo)
      throw new Error('--press-late-ms=MIN,MAX needs 0 <= MIN <= MAX');
    deviceActuator = { lateMinMs: lo, lateMaxMs: hi };
  }
  if (!Number.isInteger(n) || n <= 0 || !Number.isFinite(pilotOffset) || pilotOffset < 0 ||
      !Number.isFinite(sweepSlotMs) || sweepSlotMs < 100 || sweepSlotMs > 500 ||
      !Number.isFinite(cam5Hold) || cam5Hold < 0)
    throw new Error('runs and timing controls must be finite and in their documented ranges');
  if (![0, 1, 2, 3].includes(dropVocal) || ![0, 1, 2, 3].includes(vocalFalseCount))
    throw new Error('--drop-vocal and --vocal-false-count must be integers from 0 to 3');
  if ([sparseLeft, sparseCam5, vocalCam5, bangCam5].filter(Boolean).length > 1)
    throw new Error('--sparse-left, --sparse-cam5, --vocal-cam5 and --bang-cam5 are exclusive');
  if (![0, 1, 2, 3].includes(dropBang) || ![0, 1, 2].includes(bangFalseCount))
    throw new Error('--drop-bang= must be 0-3 and --false-bang= 0-2');
  if (!bangCam5 && (dropBang || bangFalseCount))
    throw new Error('bang error controls require --bang-cam5');
  if (sparseLeft && bbMode !== 'left')
    throw new Error('--sparse-left cannot be combined with a CAM-05 or no-BB mode');
  if (deviceSweep && bbMode !== 'left')
    throw new Error('--device-sweep requires a left-opening route');
  if (!Number.isFinite(hallPulseMs) || hallPulseMs < 50 || hallPulseMs > 300)
    throw new Error('--hall-pulse-ms must be between 50 and 300');
  if (!Number.isFinite(readLatencyMs) || readLatencyMs < 100 || readLatencyMs > 900)
    throw new Error('--read-latency-ms must be between 100 and 900');
  if (maskMarginMs !== null && (!Number.isFinite(maskMarginMs) || maskMarginMs < 0 || maskMarginMs > 1000))
    throw new Error('--mask-margin-ms must be between 0 and 1000');
  if (maskMarginMs !== null && !phaseSafeMask)
    throw new Error('--mask-margin-ms and --tick-aligned-mask are exclusive');
  if ((pulseLight || secondBeat) && !deviceSweep)
    throw new Error('--pulse-light and --second-beat require a device sweep profile');
  if (!vocalCam5 && (dropVocal || vocalFalseCount))
    throw new Error('vocal error controls require --vocal-cam5');
  if (assertSurvival && assertRejected)
    throw new Error('--assert and --assert-rejected are exclusive');
  if (assertRejected && !deviceSweep)
    throw new Error('--assert-rejected requires a device sweep profile');
  let wins = 0, minBox = 1, minPower = Infinity, checks = 0, detections = 0;
  let attacks = 0, missed = 0, audioMisses = 0;
  let actSent = 0, actDrops = 0, actDropNights = 0;
  let trace = [];
  const fails = {};
  for (let i = 0; i < n; i++) {
    const { sim, bot, actuator } = run({ bbMode, cam5Light, sparseCam5, sparseLeft,
      vocalCam5, dropVocal, vocalFalseCount, bangCam5, dropBang,
      bangFalseCount, cam5Hold, pilotOffset,
      phaseSafeMask, alwaysThreat, deviceSweep, sweepSlotMs, pulseLight,
      secondBeat, maskMarginMs, readLatencyMs, hallPulseMs, deviceActuator,
      attackWindowMs,
      traceActions,
      knobs,
      sim: { seed: (i * 2246822519) >>> 0, night, worst } });
    if (traceActions && n === 1) trace = bot.trace;
    if (actuator) {
      actSent += actuator.sent; actDrops += actuator.seamDrops;
      if (actuator.seamDrops) actDropNights++;
    }
    minBox = Math.min(minBox, bot.minBox);
    minPower = Math.min(minPower, sim.power);
    checks += bot.checks;
    detections += bot.detections;
    attacks += bot.attacks;
    missed += bot.missed;
    audioMisses += bot.audioMisses;
    if (sim.won) wins++;
    else {
      const key = `${sim.death.reason}: ${sim.death.detail}`;
      fails[key] = (fails[key] || 0) + 1;
    }
  }
  const mode = bbMode === 'left' ?
      `${sparseLeft ? 'sparse phase-windowed ' : ''}lit left-opening detection`
    : bbMode === 'cam5' ? `${bangCam5 ? 'bang-armed ' : vocalCam5 ? 'third-vocal-armed ' :
        sparseCam5 ? 'sparse phase-aligned ' : ''}CAM 05 tracking ` +
        `(${cam5Light ? `${cam5Hold}f lit` : 'unlit'})`
      : 'blind cycle';
  console.log(`${wins}/${n} survived (${formatRate(wins, n, { label: 'survival' })}) ` +
    `night ${night} — HID multitouch + ${mode}` +
    `, ${sparseLeft ? `${pilotOffset}f pilot offset` :
      `${maskMarginMs !== null ? `${maskMarginMs}ms-margin` :
        phaseSafeMask ? 'phase-safe' : 'tick-aligned'} BB mask`}` +
    (deviceSweep ? `, ${sweepSlotMs}ms device feed slots` +
      `${pulseLight ? ', pulsed light' : ''}${secondBeat ? ', second beat' : ''}` : '') +
    (deviceActuator ? ', device actuator' : '') +
    (worst ? ' (worst luck)' : ''));
  for (const [key, count] of Object.entries(fails).sort((a, b) => b[1] - a[1]))
    console.log(`  ${count}x  ${key}`);
  console.log(`min box ${(minBox * 100).toFixed(0)}% | min power ${minPower} | ` +
    `${checks} BB reads, ${detections} detections, ${attacks} attacks, ${missed} missed states` +
    (vocalCam5 ? `, ${audioMisses} forced vocal misses` : '') +
    (bangCam5 ? `, ${audioMisses} forced bang misses` : ''));
  if (deviceActuator)
    console.log(`actuator: ${actDrops} seam-dropped monitor presses in ${actSent} sent` +
      ` (${actDropNights}/${n} nights lost at least one)`);
  if (assertSurvival && (wins !== n || missed !== 0)) process.exitCode = 1;
  if (assertRejected && wins !== 0) process.exitCode = 1;
  if (traceActions && n === 1)
    for (const e of trace) console.log(JSON.stringify(e));
}
