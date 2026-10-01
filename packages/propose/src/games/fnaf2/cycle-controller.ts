// Belief-backed short-horizon cycle supervisor for Plan 20 package 5.
//
// This is the composition layer between the estimator and the finite cycle
// selector. It consumes fact envelopes only; it never imports the exact game
// engine and therefore cannot read hidden route state. A caller supplies the
// exact proof callback and the route score, keeping those two authorities
// explicit at the boundary.
import * as C from '@sixam/source/games/fnaf2/config.ts';
import { initialEstimator, update, reconcile, send, needsVerification } from '@sixam/play/player';
import { initialReducedState, observeReduced, applyReduced, advanceReduced, REDUCED_SCHEMA } from '@sixam/source/games/fnaf2/reduced-model.ts';
import { getCycle } from './cycle-library.ts';
import { selectCycle } from './cycle-planner.ts';

export const CYCLE_CONTROLLER_SCHEMA = 'cycle-controller-v1';

const clone = value => structuredClone(value);
const finite = value => Number.isFinite(value);
const CONTROL_FACTS = Object.freeze({ monitorUp: 'monitor', maskOn: 'mask' });
const CONTROL_ACTIONS = Object.freeze({ monitor: 'monitorUp', mask: 'maskOn' });

function fail(message) { throw new TypeError(`cycle controller: ${message}`); }

function stripFrame(facts) {
  const result = {};
  for (const [name, fact] of Object.entries(facts ?? {})) {
    if (name !== 'frame') result[name] = fact;
  }
  return result;
}

// Add the two clocks at the composition boundary. A delayed watch read keeps
// its sampled frame as observedAtMs, while receipt is the current decision
// frame. A pre-read UNKNOWN has no meaningful sample time, so it is timestamped
// at receipt rather than manufacturing a negative event time.
function timedFacts(facts, frame, receivedAtMs) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts))
    fail('facts must be an object');
  if (!Number.isInteger(frame) || frame < 0 || !finite(receivedAtMs))
    fail('frame and receipt time must be valid');
  const sampleFrame = Number.isInteger(facts.frame) && facts.frame >= 0
    ? facts.frame : frame;
  const observedAtMs = sampleFrame * 1000 / C.FPS;
  const result = {};
  for (const [name, fact] of Object.entries(stripFrame(facts) as Record<string, any>)) {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact))
      fail(`fact ${name} is not an envelope`);
    result[name] = {
      ...fact,
      source: (fact as any).source ?? 'observer',
      observedAtMs: (fact as any).observedAtMs ?? observedAtMs,
      receivedAtMs: (fact as any).receivedAtMs ?? receivedAtMs,
    };
  }
  return result;
}

function noDecision(controller, reason, extra = {}) {
  const decision = {
    schema: 'cycle-plan-decision-v1', selected: null,
    decisions: [], record: { selected: null, reason }, reason,
    frame: controller.reduced.frame, ...extra,
  };
  controller.decisions.push(clone(decision));
  return decision;
}

function observedBoolean(facts, name) {
  const fact = facts?.[name];
  return fact?.state === 'OBSERVED' && typeof fact.value === 'boolean'
    ? fact.value : null;
}

/**
 * A pure-data-facing supervisor. Methods mutate only this supervisor's
 * private state; snapshots are plain JSON-compatible values for replay.
 */
export class CycleController {
  declare reduced: any;
  declare estimator: any;
  declare cycles: any;
  declare facts: {};
  declare activeCycleId: any;
  declare activeCycleRunId: string;
  declare activeUntilFrame: number;
  declare decisions: any[];
  declare nextToken: number;
  declare nextCycleRun: number;
  declare heldContacts: {};
  constructor({ reduced = null, estimator = null, cycles = null } = {}) {
    this.reduced = clone(reduced ?? initialReducedState({ night: 1 }));
    if (!this.reduced || this.reduced.schema !== REDUCED_SCHEMA)
      fail('initial reduced state schema mismatch');
    this.estimator = estimator ?? initialEstimator({
      nowMs: this.reduced.frame * 1000 / C.FPS,
    });
    this.cycles = (cycles ?? [getCycle('observe-and-hold'), getCycle('defensive-mask')])
      .map(clone);
    if (!this.cycles.length) fail('at least one cycle is required');
    this.facts = {};
    this.activeCycleId = null;
    this.activeCycleRunId = null;
    this.activeUntilFrame = -1;
    this.decisions = [];
    this.nextToken = 1;
    this.nextCycleRun = 1;
    // Physical contacts opened by a cycle instance and not released yet.
    //
    // This is deliberately keyed by an invocation id rather than cycle.id. A
    // policy may run the same primitive hundreds of times; accepting an old
    // release merely because a newer invocation has the same id can lift the
    // newer invocation's contact. The values are arrays so snapshots remain
    // plain structured-clone data rather than acquiring Map/Set semantics.
    this.heldContacts = {};
  }

  /**
   * Does a positively observed hazard justify abandoning the running cycle?
   * UNKNOWN never preempts: a coarse read that cannot see the office is not
   * evidence of a threat in it.
   */
  preempts() {
    if (observedBoolean(this.facts, 'blackout') !== true) return false;
    const active = this.cycles.find(cycle => cycle.id === this.activeCycleId);
    return !(active?.hazardCoverage ?? []).includes('blackout');
  }

  /** Apply one fact batch and reconcile only matching pending control actions. */
  observe(facts, { frame = this.reduced.frame,
    receivedAtMs = frame * 1000 / C.FPS } = {}) {
    const timed = timedFacts(facts, frame, receivedAtMs);
    this.estimator = update(this.estimator, { facts: timed, nowMs: receivedAtMs });
    const physicalFacts = stripFrame(facts);
    this.reduced = observeReduced(this.reduced, physicalFacts, { frame });
    this.facts = clone(facts);

    const pending = (this.estimator.belief.pendingAction as any);
    if (pending) {
      for (const [factName, control] of Object.entries(CONTROL_FACTS)) {
        if (pending.action !== control) continue;
        const fact = timed[factName];
        if (!fact || fact.state !== 'OBSERVED' || typeof fact.value !== 'boolean') continue;
        this.estimator = reconcile(this.estimator, {
          action: CONTROL_ACTIONS[control], value: fact.value,
          verifiedAtMs: fact.receivedAtMs, token: pending.token,
        });
        break;
      }
    }
    // Do not clone the growing trace on every sensor tick. Callers that need a
    // replayable record can request snapshot() at a cycle boundary; the hot
    // path returns only a small status value.
    return {
      schema: CYCLE_CONTROLLER_SCHEMA, frame: this.reduced.frame,
      activeCycleId: this.activeCycleId,
      verificationRequired: { ...this.estimator.verificationRequired },
    };
  }

  /**
   * Select a bounded cycle only from a positive, current blackout fact. An
   * UNKNOWN hazard is not silently promoted to clear or threat; the caller can
   * continue observing and replan at the next boundary.
   */
  plan(options: any = {}) {
    const { exactGate, score } = options;
    if (typeof exactGate !== 'function' || typeof score !== 'function')
      fail('exactGate and score callbacks are required');
    // An observed hazard the in-flight cycle does not cover PREEMPTS it.
    //
    // Without this the controller is blind for the whole of whatever primitive
    // it happens to be running, and several reviewed primitives are LONGER
    // than the sourced office-defence fuse they would have to answer inside:
    // the fuse is 100 frames on Night 1 but 50 on Nights 5-6 and 45 from Night
    // 7, while `observe-and-hold` and `vent-stall-right` are 60. Measured
    // 2026-09-02 over 20 nights per night: Night 5 lost 5 office cues and
    // Night 6 lost 12 to `missed the office-defense fuse`, every one of them
    // with an idle primitive in flight.
    //
    // This is Plan 20 P7's "fast safety actions first" and Plan 19's blackout
    // fast path, and it is deliberately NARROW: only a positively observed
    // hazard preempts, only when the running cycle does not already cover it,
    // and the abandoned cycle's RELEASES still run (see `releaseDeferred`), so
    // preemption can never leave an input held.
    if (this.activeCycleId && this.reduced.frame < this.activeUntilFrame) {
      if (!this.preempts())
        return noDecision(this, 'cycle-in-flight', { activeCycleId: this.activeCycleId });
      this.activeCycleId = null;
      this.activeCycleRunId = null;
      this.activeUntilFrame = -1;
    }
    if (this.activeCycleId) {
      this.activeCycleId = null;
      this.activeCycleRunId = null;
      this.activeUntilFrame = -1;
    }
    if (needsVerification(this.estimator, 'monitor') ||
        needsVerification(this.estimator, 'mask'))
      return noDecision(this, 'control-verification-required');

    const blackout = (this.facts as any).blackout;
    if (!blackout || blackout.state !== 'OBSERVED' ||
        typeof blackout.value !== 'boolean')
      return noDecision(this, 'blackout-unknown');

    const hypothesisState = clone(this.reduced);
    hypothesisState.hazards.blackout = {
      state: blackout.value ? 'active' : 'clear',
      deadlineFrame: blackout.value
        ? this.reduced.frame + C.maskGraceFrames(this.reduced.night) : -1,
    };
    const hypothesis = {
      id: blackout.value ? 'blackout-active' : 'blackout-clear',
      state: hypothesisState,
      hazard: blackout.value ? 'active' : 'clear',
      plausible: true,
    };
    const decision: any = selectCycle(this.cycles, [hypothesis], {
      exactGate: (cycle, h) => exactGate(cycle, h, this),
      score: (cycle, h, gate) => score(cycle, h, gate, this),
    });
    decision.frame = this.reduced.frame;
    decision.hazard = hypothesis.hazard;
    this.decisions.push(clone(decision));
    return decision;
  }

  /**
   * Commit only the selected cycle's immediate prefix. Future actions are
   * returned as deferred data and must be revalidated at their own boundary;
   * this prevents a stale plan from becoming an unbounded macro.
   */
  commit(decision, { frame = this.reduced.frame } = {}) {
    if (!decision || decision.selected === null) return { cycleId: null, actions: [], deferred: [] };
    const cycle = this.cycles.find(candidate => candidate.id === decision.selected);
    if (!cycle) fail(`selected cycle ${decision.selected} is not in the library`);
    if (frame !== this.reduced.frame) fail('commit frame does not match reduced state');
    const immediate = cycle.actions.filter(action => action.atFrame === 0);
    const deferred = cycle.actions.filter(action => action.atFrame > 0).map(clone);
    const cycleRunId = `cycle-run-${this.nextCycleRun++}`;
    const opensContact = action => action.kind === 'press' && cycle.actions.some(
      later => later.kind === 'release' && later.action === action.action &&
        later.atFrame > action.atFrame);
    const hold = action => {
      const held = this.heldContacts[cycleRunId] ?? [];
      if (!held.includes(action)) held.push(action);
      this.heldContacts[cycleRunId] = held;
    };
    const actions = [];
    for (const action of immediate) {
      let target = null;
      if (action.kind === 'press' && CONTROL_ACTIONS[action.action]) {
        target = CONTROL_ACTIONS[action.action];
        const expected = action.action === 'mask'
          ? !this.reduced.maskOn
          : !(this.reduced.monitor === 'up' || this.reduced.monitor === 'raising');
        const token = `cycle-${this.nextToken++}`;
        this.estimator = send(this.estimator, {
          action: target, expected,
          sentAtMs: frame * 1000 / C.FPS, token,
        });
        this.reduced = applyReduced(this.reduced, action.action, action.kind).state;
        this.reduced.controlUnknown[action.action === 'mask' ? 'mask' : 'monitor'] = true;
        actions.push({ ...clone(action), token, expected });
      } else {
        this.reduced = applyReduced(this.reduced, action.action, action.kind).state;
        actions.push(clone(action));
      }
      if (opensContact(action)) hold(action.action);
    }
    this.activeCycleId = cycle.id;
    this.activeCycleRunId = cycleRunId;
    this.activeUntilFrame = frame + cycle.durationFrames;
    // `dueFrame` is absolute so the caller's queue never has to remember which
    // frame the cycle was committed at.
    return {
      cycleId: cycle.id, cycleRunId, actions,
      deferred: deferred.map(action => ({ ...action, cycleId: cycle.id,
        cycleRunId, opensContact: opensContact(action),
        dueFrame: frame + action.atFrame })),
    };
  }

  /**
   * Release one deferred action at its own boundary. Scheduling is the
   * caller's: it owns the queue and decides when an action is due, matching
   * `packages/play/bin/phone/actuator.ts`'s `[dueFrame, kind, act]` and the runtime's
   * supervise-and-schedule role. Legality stays here, because the reduced
   * model is core's to interpret.
   *
   * A release is REFUSED, never silently applied, when the cycle that owns it
   * is no longer the active one, when its frame has not arrived, or when the
   * engine rejects it. A refused release is returned with its reason so the
   * caller can log a stuck control instead of assuming the input was lifted.
   */
  releaseDeferred(action, { frame = this.reduced.frame, emergency = false } = {}) {
    if (!action || typeof action !== 'object') fail('deferred action is required');
    if (!Number.isInteger(frame) || frame < 0) fail('release frame must be a frame');
    const refuse = reason => ({ schema: 'deferred-release-v1', accepted: false,
      reason, action: clone(action), frame, emergency });
    const runId = action.cycleRunId;
    const held = this.heldContacts[runId] ?? [];
    const heldIndex = held.indexOf(action.action);
    const active = action.cycleId === this.activeCycleId &&
      runId === this.activeCycleRunId;
    // Deferred presses belong only to the exact active invocation. A release
    // may outlive preemption or normal cycle expiry, but only when that same
    // invocation actually has the corresponding physical contact down.
    if (emergency && action.kind !== 'release') return refuse('emergency-release-only');
    if (action.kind === 'release' && heldIndex < 0)
      return refuse(active ? 'contact-not-held' : 'cycle-no-longer-active');
    if (action.kind !== 'release' && !active) return refuse('cycle-no-longer-active');
    if (!emergency && frame < action.dueFrame) return refuse('not-due');
    // A release lands on its own frame, not on an observation boundary: an
    // action at C.s(4.5) is 270 frames in, which is not a multiple of the
    // 4-frame read cadence. Advance the reduced state to the release frame
    // rather than demanding the two coincide.
    if (frame < this.reduced.frame) return refuse('release-frame-in-the-past');
    const at = frame > this.reduced.frame
      ? advanceReduced(this.reduced, frame) : this.reduced;
    const applied = applyReduced(at, action.action, action.kind);
    if (!applied.accepted) return refuse(`engine-rejected:${applied.reason}`);
    this.reduced = applied.state;
    if (action.opensContact === true) {
      const contacts = this.heldContacts[runId] ?? [];
      if (!contacts.includes(action.action)) contacts.push(action.action);
      this.heldContacts[runId] = contacts;
    }
    if (action.kind === 'release' && heldIndex >= 0) {
      held.splice(heldIndex, 1);
      if (held.length) this.heldContacts[runId] = held;
      else delete this.heldContacts[runId];
    }
    return { schema: 'deferred-release-v1', accepted: true, reason: null,
      action: clone(action), frame, emergency };
  }

  /** Plain-data census used by callers to prove shutdown released every touch. */
  outstandingHolds() {
    return Object.entries(this.heldContacts).flatMap(([cycleRunId, actions]) =>
      (actions as any).map(action => ({ cycleRunId, action })));
  }

  snapshot() {
    return clone({
      schema: CYCLE_CONTROLLER_SCHEMA,
      reduced: this.reduced, estimator: this.estimator, cycles: this.cycles,
      facts: this.facts, activeCycleId: this.activeCycleId,
      activeCycleRunId: this.activeCycleRunId,
      activeUntilFrame: this.activeUntilFrame, decisions: this.decisions,
      nextToken: this.nextToken, nextCycleRun: this.nextCycleRun,
      heldContacts: this.heldContacts,
    });
  }
}

export const makeUnknownFacts = (facts = {}) => Object.fromEntries(
  Object.keys(facts).filter(name => name !== 'frame')
    .map(name => [name, { state: 'UNKNOWN', reason: 'observations-disabled' }])
);
