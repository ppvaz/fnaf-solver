// Reactive controllers for the stock-device video loop. Plan 19 package 1.
//
// A controller consumes the Observer's fact set once per cycle and returns zero
// or more press intents `{ action, at }`. The replay harness merges them with
// the open-loop base schedule and DROPS any intent whose animation would
// collide with a scheduled press's -- the night 6-38 rule: a reactive
// `monitor-resync` fired mid-`MONITOR_ANIM_DOWN` caused the desync it hunted.
import * as C from '@sixam/source/games/fnaf2/config.ts';
import { val } from '@sixam/play/sim';

/** One fact as the Observer reports it. */
type Fact = { readonly state: 'OBSERVED', readonly value: unknown } | { readonly state: 'UNKNOWN', readonly reason: string };
/** The Observer's fact set, read here by fact name only (its `frame` entry is never read). */
type Observation = Readonly<Record<string, Fact>>;
/** A press the controller asks for, at a frame. */
type Intent = { readonly action: string, readonly at: number };
/** The phase clock's view a controller reads: the next one-second boundary and how sure it is. */
interface PhaseClockView {
  nextBoundaryFrame(frame: number): number;
  readonly periodFrames?: number;
  readonly uncertaintyFrames?: number;
}
/** The scheduled mask interval the replay passes in, from independently shifted rows. */
type MaskWindow = { readonly startFrame?: number, readonly endFrame?: number };
/** What the replay hands each decision. */
interface DecisionContext {
  readonly frame: number;
  readonly scheduled?: unknown;
  readonly phaseClock?: PhaseClockView | null;
  readonly maskWindow?: MaskWindow | null;
}
/** Every knob a reactive controller reads; each controller reads its own. */
interface ControllerOptions {
  readonly maxMaskFrames?: number;
  readonly openingFact?: string;
  readonly threatValue?: unknown;
  readonly clearValue?: unknown;
  readonly hardCapFrames?: number;
  readonly maskWindowFrames?: number;
  readonly phaseUncertaintyFrames?: number;
  readonly maskEndUncertaintyFrames?: number;
  readonly phaseClock?: PhaseClockView | null;
  readonly maxFailedHolds?: number;
  readonly banking?: boolean;
  readonly bankCapFrames?: number;
  readonly bankTarget?: number;
  readonly threatPred?: (obs: Observation) => boolean;
}

// Only monitor/mask presses animate; light/wind presses are instantaneous and
// never conflict. GUARD_FRAMES is the longest of the two animations.
export const GUARD_FRAMES = Math.max(C.MONITOR_ANIM_DOWN, C.MONITOR_ANIM_UP,
                                     C.MASK_ANIM_ON, C.MASK_ANIM_OFF);
const ANIMATED = new Set(['monitor', 'mask']);

// Drop an intent whose action animates and lands within GUARD_FRAMES of a
// scheduled press that also animates. `scheduled` is `[{ at, action }]` (or a
// bare frame list, treated as monitor presses -- the conservative reading).
export function guardIntents(intents: readonly Intent[], scheduled: readonly (number | Intent)[]) {
  const anim = scheduled.map(s => (typeof s === 'number' ? { at: s, action: 'monitor' } : s))
                        .filter(s => ANIMATED.has(s.action));
  return intents.filter(i =>
    !ANIMATED.has(i.action) ||
    !anim.some(s => Math.abs(i.at - s.at) < GUARD_FRAMES));
}

// After emitting an animated press, wait this long before emitting another --
// the animation has to finish AND the ~59 ms sensor read has to reflect it, or
// the controller presses again on a stale observation and reverses itself
// (engine.js setMonitor toggles on MON_RAISING/MON_LOWERING).
export const PRESS_COOLDOWN = GUARD_FRAMES + C.s(0.15);

/** A controller's fields a decision snapshot leaves out (the `_` bookkeeping fields are left out too). */
const NOT_DECISION_STATE = new Set(['opts', 'log', 'threat', 'phaseClock']);

export class ReactiveController {
  declare opts: ControllerOptions;
  declare log: { frame: number, what: string }[];
  declare lastAnimPress: { action: string | null; at: number; };
  declare _decisionSnapshot: { state: Record<string, unknown>; logLength: number; } | null;
  declare _pendingIntents: readonly Intent[] | null;
  constructor(opts: ControllerOptions = {}) {
    this.opts = opts;
    this.log = [];
    this.lastAnimPress = { action: null, at: -Infinity };
    this._decisionSnapshot = null;
    this._pendingIntents = null;
  }
  // obs: the current fact set. ctx: { frame, scheduled: [{at,action}] }.
  decide(_obs: Observation, _ctx: DecisionContext): readonly Intent[] { return []; }
  note(frame: number, what: string) { this.log.push({ frame, what }); }

  // Are we still waiting for the last monitor/mask press to land and be seen?
  cooling(frame: number) {
    return frame - this.lastAnimPress.at < PRESS_COOLDOWN;
  }

  // Controller decisions are speculative until the replay's collision guard
  // accepts them.  The old implementation stamped cooldown/state in emit()
  // and then let the harness discard the intent, leaving the FSM convinced a
  // press had happened.  Snapshot the small controller state at the start of
  // each decision so a rejected intent can be rolled back atomically.
  // The snapshot reads and restores this controller's own fields by name.
  #fields() { return this as unknown as Record<string, unknown>; }

  /**
   * The fields a decision may change: every own field but the options, the log (truncated instead), the bookkeeping
   * fields (`_`), and the threat and phase clock objects the controller is handed, which it does not own.
   */
  #decisionKeys() {
    return Object.keys(this).filter((key) => !key.startsWith('_') && !NOT_DECISION_STATE.has(key));
  }

  beginDecision() {
    const state: Record<string, unknown> = {};
    const fields = this.#fields();
    for (const key of this.#decisionKeys()) state[key] = structuredClone(fields[key]);
    this._decisionSnapshot = { state, logLength: this.log.length };
    this._pendingIntents = null;
  }

  _restoreDecision() {
    const snap = this._decisionSnapshot;
    if (!snap) return;
    for (const key of this.#decisionKeys()) if (!(key in snap.state)) delete this.#fields()[key];
    Object.assign(this, snap.state);
    this.log.length = snap.logLength;
  }

  // Record + return the intents, stamping the cooldown on animated ones. The
  // state remains speculative until settle() is called by the caller.
  emit(frame: number, intents: readonly Intent[]) {
    if (!this._decisionSnapshot) this.beginDecision();
    this._pendingIntents = intents;
    for (const i of intents)
      if (ANIMATED.has(i.action)) this.lastAnimPress = { action: i.action, at: frame };
    return intents;
  }

  // Accept exactly the intents returned by emit(), or roll the whole decision
  // back if the caller filtered even one of them.
  settle(accepted: readonly Intent[]) {
    if (!this._pendingIntents) {
      this._decisionSnapshot = null;
      return true;
    }
    const emitted = this._pendingIntents;
    const same = accepted.length === emitted.length &&
      accepted.every((intent, i) => intent === emitted[i]);
    if (!same) {
      this._restoreDecision();
      this._pendingIntents = null;
      this._decisionSnapshot = null;
      return false;
    }
    this._pendingIntents = null;
    this._decisionSnapshot = null;
    return true;
  }

  reject() { return this.settle([]); }
}

// Watch the schedule, act only on a blackout: get a mask fully on before the
// deadline (lowering the monitor first if we are camming, since the mask cannot
// go on with the monitor up), hold across the blackout, verify the left opening
// is clear, then restore the monitor. This is the reaction RVC / brayden / the
// published Minus Toys blackout branch need, and nothing more -- blackout is a
// whole-screen luma read the coarse sensor never misses.
export class BlackoutReactive extends ReactiveController {
  declare maxMaskFrames: number;
  declare state: string;
  declare since: number;
  declare loweredMonitor: boolean;
  constructor(opts: ControllerOptions = {}) {
    super(opts);
    // Never stay masked longer than this waiting for a clear opening: Withered
    // Foxy accelerates while the mask is up with nobody at the vent (g825).
    this.maxMaskFrames = opts.maxMaskFrames ?? C.s(6);
    this.state = 'idle';    // idle | securing | holding | verifying | restoring
    this.since = -1;
    this.loweredMonitor = false;
  }

  decide(obs: Observation, ctx: DecisionContext): readonly Intent[] {
    this.beginDecision();
    const f = ctx.frame;
    const blackoutNow = obs.blackout.state === 'OBSERVED' && obs.blackout.value;
    const opening = obs.leftOpening;
    const maskValue = val(obs.maskOn, null);
    const masked = maskValue === true;
    const monUp = val(obs.monitorUp, null);  // true | false | null (UNKNOWN)
    const out: Intent[] = [];

    // A fresh blackout while we are past the mask (verifying/restoring) and no
    // longer protected must restart -- blackouts land in quick succession and
    // the second is just as lethal.
    if (blackoutNow && maskValue === false && (this.state === 'verifying' || this.state === 'restoring'))
      this.state = 'idle';

    const cooling = this.cooling(f);

    // Mask up too long -> drop it regardless of what we can see (Foxy).
    if (maskValue === true && this.since >= 0 && f - this.since >= this.maxMaskFrames && !cooling) {
      this.state = this.loweredMonitor ? 'restoring' : 'idle';
      this.note(f, 'mask timeout -> drop');
      return this.emit(f, [{ action: 'mask', at: f }]);
    }

    if (this.state === 'idle') {
      if (blackoutNow && maskValue === false) {
        this.state = 'securing';
        this.since = f;
        this.note(f, 'blackout -> secure a mask');
      } else {
        return out;
      }
    }

    if (this.state === 'securing') {
      if (maskValue === null) return out;
      if (masked) {
        this.state = 'holding';
        this.since = f;   // the Foxy timeout counts from when the mask went ON
        return out;
      }
      if (cooling) return out;   // wait for the last press to land and be seen
      if (monUp === false) {
        this.note(f, 'cams down -> mask');
        return this.emit(f, [{ action: 'mask', at: f }]);
      }
      if (monUp === true) {
        this.loweredMonitor = true;
        this.note(f, 'lower monitor first');
        return this.emit(f, [{ action: 'monitor', at: f }]);
      }
      return out;   // UNKNOWN: it is animating, wait
    }

    if (this.state === 'holding') {
      if (!blackoutNow) { this.state = 'verifying'; this.note(f, 'blackout cleared -> verify'); }
      return out;
    }

    if (this.state === 'verifying') {
      if (opening.state === 'OBSERVED' && !cooling) {
        if (opening.value === 'empty') {
          this.state = this.loweredMonitor ? 'restoring' : 'idle';
          this.note(f, 'opening empty -> drop mask');
          return maskValue === true ? this.emit(f, [{ action: 'mask', at: f }]) : out;
        }
        this.note(f, 'opening threat -> hold');
      }
      return out;
    }

    // restoring: mask off, raise the monitor back so the base schedule resumes.
    if (this.state === 'restoring') {
      if (maskValue !== false || cooling) return out;
      if (monUp === true) { this.state = 'idle'; this.loweredMonitor = false; return out; }
      if (monUp === false) {
        this.note(f, 'raise monitor -> resume base');
        return this.emit(f, [{ action: 'monitor', at: f }]);
      }
      return out;   // UNKNOWN: animating
    }

    return out;
  }
}


// Vent-threat reaction: the BB eviction the scheduled mask cannot deliver.
// Android's mask counter is a CONTINUOUS hold -- five consecutive
// fully-on seconds (g907 -> v12 >= 5, g294), and g293 zeroes it on every
// re-entry into the mask, so the 10 s cycle's ~4.8 s mask window tops out at
// four ticks. That one missing tick is measured: n2-minustoys-0117 died
// BB-inside -> Foxy, and `--phasegate`-adjacent sim runs reproduce it. The
// engine's too-late edge is sharp: BB walks inside at the NEXT cams-up
// (engine.js onCamsUp) and never leaves; the mask evicts him only at the
// opening (tickMask / engine.js:887 for Mangle).
//
// Trigger: the selected threat fact. BB defaults to the left opening plus its
// audio arrival cue; MangleThreatReactive binds the same bounded response to
// the independent sustained static audio fact. Hold is time-based (the
// opening read is UNKNOWN while the mask animates), then verified after the
// drop.
export class VentThreatReactive extends ReactiveController {
  declare openingFact: string;
  declare threatValue: unknown;
  declare clearValue: unknown;
  declare hardCapFrames: number;
  declare maskWindowFrames: number;
  declare maskOnAt: number;
  declare firstTick: number;
  declare phaseUncertaintyFrames: number;
  declare maskEndUncertaintyFrames: number;
  declare maskWindow: MaskWindow | null;
  declare phaseClock: PhaseClockView | null;
  declare maxFailedHolds: number;
  declare failedHolds: number;
  declare dead: boolean;
  declare bankingEnabled: boolean;
  declare bankCapFrames: number;
  declare bankTarget: number;
  declare bankStart: number;
  /** The last BB vent cue value read ('pending', 'opening', ...), for edge detection. */
  declare prevVentCue: unknown;
  declare consumedAudioCueId: unknown;
  declare usesDefaultThreat: boolean;
  declare state: string;
  declare since: number;
  declare loweredMonitor: boolean;
  declare flashed: boolean;
  declare threat: (obs: Observation) => boolean;
  constructor(opts: ControllerOptions = {}) {
    super(opts);
    this.openingFact = opts.openingFact ?? 'leftOpening';
    this.threatValue = opts.threatValue ?? 'threat';
    this.clearValue = opts.clearValue ?? 'empty';
    // Ticks accrue from maskFullyOn, anchored at the mask-on press + anim
    // (this.since, set in securing). The hold length is the five ticks plus a
    // half-tick of phase slack; the pre-mask hall pulse (Pedro's play) is what
    // makes the Foxy D budget safe, and the box cost is bounded by ending the
    // hold at eviction rather than camping to a wall-clock cap.
    this.hardCapFrames = opts.hardCapFrames ?? C.s(12);
    // Coverage gate (2026-08-30): count the boundaries in the CURRENT mask
    // interval, from the later of the observed fully-on frame and the planned
    // post-animation start to the actual upcoming off press. The replay passes
    // those endpoints from independently shifted rows; maskWindowFrames is
    // retained only as a small direct-controller test fallback.
    this.maskWindowFrames = opts.maskWindowFrames ?? 0;
    this.maskOnAt = -1;     // first frame the mask was observed fully on
    this.firstTick = -1;    // final fifth-tick deadline for the current hold
    // Phase uncertainty (+-frames on the fully-on anchor). With u > 0 the
    // boundary count becomes a RANGE and the decision three-way: lo >= 5 ->
    // covered, stand down; hi < 5 -> uncovered, full rescue; else AMBIGUOUS ->
    // the smallest bounded extension that guarantees the possibly-missing
    // fifth boundary (hold the current mask ~1 s past its window -- its Foxy
    // D bill is bounded by the pulse saw-tooth, ~11-16 against a lock of ~20),
    // never the full drop-flash-remask rescue. Latched by the state until the
    // visit resolves, so noisy reads cannot flip it repeatedly.
    this.phaseUncertaintyFrames = opts.phaseUncertaintyFrames ?? 6;
    this.maskEndUncertaintyFrames = opts.maskEndUncertaintyFrames ?? 0;
    this.maskWindow = null;
    this.phaseClock = opts.phaseClock ?? null;
    // A threat that outlives two hold+verify cycles is BB already INSIDE
    // (bb.inside never clears and the left-opening reads it exactly like the
    // opening). Nothing the mask does helps; mask-camping the box to death is
    // strictly worse than stopping. Two strikes and this controller stands
    // down for the night.
    // A threat that outlives a hold+verify cycle is USUALLY BB still at the
    // opening, not inside: with the monitor held down there is no walk-in
    // edge, and the 10%/s early-leave rolls make each extra cycle a fresh
    // eviction chance. (Inside would require a raise we did not make.) So the
    // retry budget is generous; standing down early surrendered winnable
    // states. Six cycles of 10%/s + tick rolls is ~99% cumulative.
    this.maxFailedHolds = opts.maxFailedHolds ?? 6;
    this.failedHolds = 0;
    this.dead = false;
    // Early-cue banking (Pedro's technique, 2026-08-30): on BB's first route
    // laugh, extend the current cams-up wind a little -- bank box before any
    // rescue can spend it. TWO hard prerequisites kept this OFF by default:
    // (1) the laugh fact is level, so banking must be edge-triggered on the
    // timestamp or it re-enters for the whole 25 s window; (2) any up-phase
    // extension SLIDES the frame-anchored schedule against the game's 5 s
    // grid, and the busy-hold drops rows rather than deferring them -- an
    // open-loop plan cannot absorb the slide (margin: 33/99 ms whole-plan).
    // The human does this technique by re-anchoring on the game's clock
    // continuously; the machine equivalent needs the winding-tick phase
    // clock first. Defaults off until then.
    this.bankingEnabled = opts.banking ?? false;
    this.bankCapFrames = opts.bankCapFrames ?? C.s(2);
    this.bankTarget = opts.bankTarget ?? 0.995;
    this.bankStart = -1;
    this.prevVentCue = false;
    this.consumedAudioCueId = null;
    this.usesDefaultThreat = !opts.threatPred;
    this.state = 'idle';    // idle | securing | holding | verifying | restoring
    this.since = -1;        // the frame the mask is expected fully-on
    this.loweredMonitor = false;
    this.flashed = false;   // pre-mask hall pulse (Pedro's play, 2026-08-30)
    this.threat = opts.threatPred ?? (obs => {
      const o = obs[this.openingFact];
      if (o?.state === 'OBSERVED' && o.value === this.threatValue) return true;
      // The audio arrival pair (thud + 21) sounds at the RAISE, ~4 s before
      // any video read could see the opening -- evicting on it, monitor up,
      // is the audio channel's whole point.
      if (this.openingFact === 'leftOpening') {
        const v = obs.bbVent;
        return !!v && v.state === 'OBSERVED' && v.value === 'opening';
      }
      return false;
    });
  }

  // Tick boundaries (f % FPS === 0, the sourced one-second event grid) in
  // [from, from + windowFrames].
  _boundariesIn(from: number, windowFrames: number) {
    const clock = this.phaseClock;
    if (!clock || typeof clock.nextBoundaryFrame !== 'function') return 0;
    const period = clock.periodFrames ?? C.FPS;
    if (!Number.isFinite(period) || period <= 0) return 0;
    const first = clock.nextBoundaryFrame(from);
    if (!Number.isFinite(first) || first > from + windowFrames) return 0;
    return Math.floor((from + windowFrames - first) / period) + 1;
  }

  covered() {
    return this.coverageRange()[0] >= C.VENT_MASK_TICKS;
  }

  // Uncertainty-aware coverage: the observed/planned fully-on and off times
  // define the interval; phase uncertainty shrinks/expands its endpoints, so
  // the tick count is a RANGE. lo is conservative against coverage and hi is
  // conservative toward it.
  coverageRange() {
    const u = this.phaseClock?.uncertaintyFrames ?? this.phaseUncertaintyFrames;
    const observedStart = this.maskOnAt >= 0 ? this.maskOnAt : -1;
    const plannedStart = this.maskWindow?.startFrame ?? -1;
    const start = Math.max(observedStart, plannedStart);
    const end = this.maskWindow?.endFrame ??
      (start >= 0 ? start + this.maskWindowFrames : -1);
    if (start < 0 || end < start) return [0, 0];
    const endUncertainty = this.maskEndUncertaintyFrames;
    const loStart = start + u;
    const loEnd = end - endUncertainty;
    const hiStart = Math.max(0, start - u);
    const hiEnd = end + endUncertainty;
    const lo = this._boundariesIn(loStart, Math.max(0, loEnd - loStart));
    const hi = this._boundariesIn(hiStart, Math.max(0, hiEnd - hiStart));
    return [lo, hi];
  }

  // The frame by which holding is GUARANTEED to have crossed five boundaries
  // under the latest-phase interpretation. This is already the final
  // fifth-tick deadline; callers must not add another four tick periods.
  guaranteedFifthTick(anchorOverride: number | null = null) {
    const u = this.phaseClock?.uncertaintyFrames ?? this.phaseUncertaintyFrames;
    const observedStart = this.maskOnAt >= 0 ? this.maskOnAt : -1;
    const plannedStart = this.maskWindow?.startFrame ?? -1;
    const anchor = anchorOverride ?? Math.max(observedStart, plannedStart);
    if (anchor < 0) return -1;
    const lateAnchor = anchor + u;
    const first = this.phaseClock && typeof this.phaseClock.nextBoundaryFrame === 'function'
      ? this.phaseClock.nextBoundaryFrame(lateAnchor)
      // Without a phase source, wait a full period before the first possible
      // boundary. This is conservative and intentionally not engine-phase
      // oracle logic.
      : lateAnchor + C.FPS;
    const period = this.phaseClock?.periodFrames ?? C.FPS;
    return first + (C.VENT_MASK_TICKS - 1) * period + 2;
  }

  decide(obs: Observation, ctx: DecisionContext): readonly Intent[] {
    this.beginDecision();
    if (this.dead) return [];
    const f = ctx.frame;
    if (ctx.phaseClock) this.phaseClock = ctx.phaseClock;
    this.maskWindow = ctx.maskWindow ?? null;
    const maskValue = val(obs.maskOn, null);
    const masked = maskValue === true;
    const monUp = val(obs.monitorUp, null);
    const opening: Fact = obs[this.openingFact] ??
      { state: 'UNKNOWN', reason: `${this.openingFact}-unavailable` };
    const cooling = this.cooling(f);
    const factThreat = opening.state === 'OBSERVED' && opening.value === this.threatValue;
    const audioValue = this.openingFact === 'leftOpening' ? val(obs.bbVent, null) : null;
    const audioCueId = this.openingFact === 'leftOpening' ? val(obs.bbVentId, null) : null;
    // An audio level without a visit identity is not safe to turn into a new
    // rescue: it may be the afterglow of a cue that already caused an
    // eviction. A selected observed fact can still trigger independently.
    const freshAudioThreat = audioValue === 'opening' && audioCueId !== null &&
      audioCueId !== this.consumedAudioCueId;
    let threatened = this.threat(obs);
    // The default predicate is intentionally BB-only. An audio fact is a
    // visit, not a level-triggered threat: once handled, its 12-second cue
    // tail must not start another rescue after the mask drops.
    if (this.usesDefaultThreat) threatened = factThreat || freshAudioThreat;
    // Restarts trust the selected fact only: the BB audio opening-cue window
    // (12 s) outlives the eviction itself, and restarting on its afterglow
    // would re-mask a cleared opening.
    const out: Intent[] = [];
    // Edge bookkeeping for the audio 'pending' cue (first thud): the fact is
    // level for ~20 s, banking must fire once per cue.
    const ventVal = this.openingFact === 'leftOpening' ? val(obs.bbVent, false) : false;
    const pendingEdge = ventVal === 'pending' && this.prevVentCue !== 'pending';
    this.prevVentCue = ventVal;
    // Coverage bookkeeping: the first frame the mask was observed fully on.
    // (Observation quantization is +-4 frames against a ~48-frame coverage
    // margin -- cheap.)
    if (maskValue === true && this.maskOnAt < 0) this.maskOnAt = f;
    if (maskValue === false) this.maskOnAt = -1;

    // A threat that outlives its hold+verify cycle is a strike against
    // "still at the opening"; past two, treat it as BB-inside and stand down.
    if (factThreat && (this.state === 'verifying' || this.state === 'restoring')) {
      this.failedHolds++;
      this.note(f, `threat persisted past hold (${this.failedHolds}/${this.maxFailedHolds})`);
      if (this.failedHolds >= this.maxFailedHolds) {
        this.dead = true;
        this.state = 'idle';
        this.loweredMonitor = false;
        this.note(f, 'threat outlived the holds -> BB inside; standing down');
        return out;
      }
      this.state = 'securing';
      this.since = -1;
      this.firstTick = -1;
      this.flashed = false;
      return out;
    }

    if (this.state === 'idle') {
      if (!threatened) {
        // Early-cue banking: the FIRST thud (BB pending, not yet dangerous --
        // laughs are belief only, per the owner's play) and the cams are up:
        // keep winding past the schedule's release to top the box before any
        // rescue can spend it. Bounded by the stun clock; OFF by default until
        // the phase clock exists (the extension slides the frame-anchored
        // plan against the game's 5 s grid).
        if (this.bankingEnabled && !cooling && monUp === true && pendingEdge) {
          this.state = 'banking';
          this.bankStart = f;
          this.note(f, 'BB pending (first thud) -> banking wind');
        }
        return out;
      }
      // A dropped or mid-animation mask read is UNKNOWN, not proof that the
      // mask is off. Wait for a known polarity before choosing a toggle.
      if (maskValue === null) return out;
      // Three-way coverage decision over the tick-count RANGE (lo/hi).
      if (masked && ((this.maskWindow?.endFrame ?? 0) > 0 || this.maskWindowFrames > 0) &&
          this.maskOnAt >= 0) {
        const [lo, hi] = this.coverageRange();
        if (lo >= C.VENT_MASK_TICKS) {
          this.state = 'covered';
          if (freshAudioThreat) this.consumedAudioCueId = audioCueId;
          this.note(f, `scheduled mask covers >= ${lo} boundaries -> stand by`);
          return out;
        }
        if (hi >= C.VENT_MASK_TICKS) {
          // Ambiguous: latch the bounded extension of the CURRENT mask --
          // guarantee the fifth boundary under the latest-phase reading.
          this.state = 'holding';
          this.since = this.maskOnAt;
          this.firstTick = this.guaranteedFifthTick();
          if (freshAudioThreat) this.consumedAudioCueId = audioCueId;
          this.note(f, `coverage ambiguous (${lo}..${hi}) -> bounded extension`);
          return out;
        }
        this.note(f, `uncovered (max ${hi} boundaries) -> full rescue`);
      }
      this.state = 'securing';
      this.since = -1;
      this.firstTick = -1;
      this.flashed = false;
      if (freshAudioThreat) this.consumedAudioCueId = audioCueId;
      this.note(f, 'vent threat -> drop-to-flash, then mask');
    }

    if (this.state === 'covered') {
      // The schedule owns this mask and it will cross enough boundaries to
      // evict; the correct action is nothing. If the mask drops before the
      // threat cleared, fall back to idle for a fresh (uncovered) evaluation.
      if (maskValue === false || !threatened) this.state = 'idle';
      return out;
    }

    if (this.state === 'banking') {
      // A threat while banking outranks the bank.
      if (threatened) {
        this.state = 'securing';
        this.since = -1;
        this.flashed = false;
        this.note(f, 'threat while banking -> evict now');
        return this.emit(f, [{ action: 'windRelease', at: f }]);
      }
      const pie = val(obs.boxPie, null);
      if ((pie !== null && Number(pie) >= this.bankTarget) || f - this.bankStart >= this.bankCapFrames) {
        this.state = 'idle';
        this.note(f, 'banked -> release and resume');
        return this.emit(f, [{ action: 'windRelease', at: f }]);
      }
      if (!cooling) return this.emit(f, [{ action: 'wind', at: f }]);
      return out;
    }

    if (this.state === 'securing') {
      if (maskValue === null) return out;
      // Mask observed fully on after our own press -> the hold begins (the
      // tick anchor was set when the press was emitted). Without this the
      // securing block would re-press the mask and toggle it back off.
      if (masked && this.since >= 0) { this.state = 'holding'; return out; }
      // The pre-mask hall pulse is what pays for the hold: the light zeroes D
      // while Foxy stands at the hall (engine.js:679) and the lock needs
      // D >= ~20 at a 5 s check (engine.js:938, ai 1 on Night 2) -- a 5-tick
      // hold accrues only ~6 past a fresh zero. Measured without it: ONE
      // scheduled pulse swallowed by the hold took D from its 0..10 saw-tooth
      // past 20 -> lock + same-tick strike (foxy:294/300). With the mask
      // already on (the common case: detection lands in the scheduled mask
      // phase) the pulse must wait for the drop -- the mask blocks every
      // non-mask action -- so the sequence is drop -> flash -> re-mask, and
      // the tick counter restarts from the re-mask (g293 zeroes on re-entry;
      // there is nothing worth keeping at <=4 ticks anyway).
      if (cooling) return out;
      if (monUp === true) {
        this.loweredMonitor = true;
        this.note(f, 'lower monitor first');
        return this.emit(f, [{ action: 'monitor', at: f }]);
      }
      if (monUp === false) {
        if (!this.flashed) {
          if (masked) {
            this.note(f, 'drop the scheduled mask to make room for the pulse');
            return this.emit(f, [{ action: 'mask', at: f }]);
          }
          this.flashed = true;
          this.note(f, 'pre-mask hall pulse (zero Foxy D)');
          return this.emit(f, [{ action: 'hall', at: f }]);
        }
        // Mask ON: ticks count from fully-on (the press + anim); anchor the
        // eviction to the first tick boundary after that, not to wall clock.
        this.since = f + C.MASK_ANIM_ON;
        this.firstTick = this.guaranteedFifthTick(this.since);
        this.note(f, 'mask on -> hold 5 consecutive ticks');
        return this.emit(f, [{ action: 'mask', at: f }]);
      }
      return out;   // UNKNOWN: animating
    }

    if (this.state === 'holding') {
      // The engine refuses every non-mask action while masked; the harness
      // additionally suppresses the base schedule only while the mask must be
      // up (securing/holding) -- verifying and restoring run it, because the
      // schedule's raise+wind rows after the drop are the point. The
      // scheduled hall slot the hold swallows is paid for by the pre-flash.
      // Phase-aligned drop: firstTick is already the final fifth one-second
      // boundary at or after fully-on (+2 frames so that boundary's increment
      // has processed), not a wall-clock deadline plus another four ticks.
      const dropAt = this.firstTick >= 0
        ? this.firstTick
        : this.since + C.s(C.VENT_MASK_TICKS) + 30;
      if (maskValue === null) return out;
      if (maskValue === false) {
        this.state = 'verifying';
        this.note(f, 'mask already off -> verify');
        return out;
      }
      if (f >= Math.min(dropAt, this.since + this.hardCapFrames)) {
        this.state = 'verifying';
        this.note(f, 'hold elapsed -> drop and verify');
        return this.emit(f, [{ action: 'mask', at: f }]);
      }
      return out;
    }

    if (this.state === 'verifying') {
      if (cooling) return out;
      if (opening.state === 'OBSERVED') {
        if (opening.value === this.clearValue) {
          this.state = this.loweredMonitor ? 'restoring' : 'idle';
          this.note(f, 'opening clear');
        }
        return out;
      }
      // UNKNOWN for too long (dropped reads) -> give up cleanly rather than
      // camp the mask forever; the box is not winding.
      if (f - this.since > this.hardCapFrames + C.MASK_ANIM_OFF + PRESS_COOLDOWN) {
        this.state = 'idle';
        this.loweredMonitor = false;
        this.note(f, 'verify gave up (no reads)');
      }
      return out;
    }

    // restoring: raise the monitor back so the base schedule resumes.
    if (this.state === 'restoring') {
      if (cooling) return out;
      if (monUp === true) { this.state = 'idle'; this.loweredMonitor = false; return out; }
      if (monUp === false) {
        this.note(f, 'raise monitor -> resume base');
        return this.emit(f, [{ action: 'monitor', at: f }]);
      }
      return out;
    }

    return out;
  }
}


// Mangle's office-context s0020 proximity static is a sustained audio cue
// (g732/733), not a visual opening read. Once detected, the safe response is
// the same continuous five-tick mask eviction used for BB: keep the monitor
// down, hold the mask through the sourced counter, then verify that the static
// cleared before any raise. The named class prevents CAM 11 static, a BB audio
// cue, or a left-opening fact from silently becoming a Mangle decision.
export class MangleThreatReactive extends VentThreatReactive {
  constructor(opts: ControllerOptions = {}) {
    const predicate = opts.threatPred ?? ((obs: Observation) => {
      const o = obs.mangleStatic;
      return !!o && o.state === 'OBSERVED' && o.value === true;
    });
    super({ ...opts, openingFact: 'mangleStatic', threatPred: predicate,
      threatValue: true, clearValue: false });
  }
}

// Short alias for policy callers that name the character rather than the
// threat source.
export const MangleReactive = MangleThreatReactive;
