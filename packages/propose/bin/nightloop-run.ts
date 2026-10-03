// One full night driven cycle by cycle through the belief-state controller.
//
// Extracted from `packages/propose/bin/nightloop.ts` so a cohort can be run across the
// worker pool: `packages/propose/bin/census/pool.ts` tasks are `(module, fn, optsList)` and both
// ends cross a structured clone, so `runNight` takes and returns plain data.
//
// There is NO compiled full-night schedule anywhere in this path. Every action
// is a bounded primitive selected at its own decision boundary and committed
// only as an immediate prefix; deferred actions are released at their own
// frame by the caller-owned queue below.
import * as C from '@sixam/source/fnaf2';
import { Sim, Rng } from '@sixam/source/fnaf2';
import { OBSERVE_INTERVAL, Observer } from '@sixam/play/sim';
import { CycleController, makeUnknownFacts, getCycle, NightPolicy,
         NIGHT_POLICY_CYCLES } from '@sixam/propose/fnaf2';
import type { Cycle, DeferredAction, Hypothesis } from '@sixam/propose/fnaf2';

export const LIBRARY_IDS = NIGHT_POLICY_CYCLES;
/** Fresh copies of the library's cycles for one night; an id the library does not hold is refused, not dropped. */
const libraryCycles = (): Cycle[] => LIBRARY_IDS.map((id) => {
  const cycle = getCycle(id);
  if (!cycle) throw new Error(`nightloop: the cycle library holds no ${id}`);
  return cycle;
});
const REVIEWED = new Set(LIBRARY_IDS);

export const seedOf = (index: number) => (index * 2654435761) >>> 0;

// ---------------------------------------------------------------- the gates
//
// Two, and the difference between them is the whole honesty of the number.
//
// `static` is what a phone can actually run: the reviewed library IS the
// proof. Plan 20 P4's obligation ("the planner cannot emit a primitive that
// has not passed the exact model gate") is discharged once, offline, when a
// primitive is admitted to the library -- `packages/propose/test/cycle-library.test.ts` is
// where that happens -- and at run time the gate attests membership.
//
// `exact` replays the primitive through the live engine from a snapshot and
// accepts it only if the run is still alive at the end of it. That is a
// PRIVILEGED LOOKAHEAD: it reads the true future of the same RNG stream, which
// no controller beside a phone can do. It is a legitimate upper bound and it
// is what `packages/propose/test/cycle-controller.test.ts` uses at a nine-second
// horizon; it is not a device-realistic result and must never be quoted as one.
export function staticGate(cycle: Cycle) {
  return REVIEWED.has(cycle.id)
    ? { accepted: true, cycleId: cycle.id, proof: 'reviewed-library-member' }
    : { accepted: false, reason: `not-a-reviewed-primitive:${cycle.id}` };
}

export function exactGate(sim: Sim, cycle: Cycle) {
  if (cycle.id === 'observe-and-hold') return { accepted: true, cycleId: cycle.id };
  const copy = Sim.fromSnapshot(sim.opts, sim.snapshot());
  const origin = copy.frame;
  for (const action of cycle.actions) {
    const target = origin + action.atFrame;
    // `tick()` is a no-op once `won` is set and does not advance the frame,
    // so a target past `durationFrames` spins forever without this guard.
    while (copy.alive && !copy.won && copy.frame < target) copy.tick();
    if (!copy.alive) return { accepted: false, reason: 'exact-death-before-action' };
    copy[action.kind](action.action);
  }
  const end = origin + cycle.durationFrames;
  while (copy.alive && !copy.won && copy.frame < end) copy.tick();
  return (copy.alive || copy.won)
    ? { accepted: true, cycleId: cycle.id }
    : { accepted: false, reason: `exact-death:${copy.death?.reason ?? 'unknown'}` };
}

// ------------------------------------------------------- the baseline control
//
// Retained verbatim as a CONTROL, not as an alternative strategy. It is the
// scorer `packages/propose/bin/nightloop.ts` used to characterize the loop's plumbing on
// 2026-09-02: "keep the box wound, mask a blackout, otherwise watch the
// office". Its one knob is a harness knob and nothing sources it.
const BASELINE_WIND_AT = 0.55;
export function baselineScore(cycle: Cycle, hypothesis: Hypothesis, _gate: unknown, controller: CycleController) {
  const st = controller.reduced;
  const want = (() => {
    if (hypothesis.hazard === 'active') return st.maskOn ? null : 'defensive-mask';
    if (st.maskOn) return 'unmask';
    if (st.box < BASELINE_WIND_AT) {
      if (st.monitor !== 'up') return 'verify-and-resume';
      if (st.viewedCamera !== C.BOX_CAM) return 'select-box-cam';
      return 'wind-and-anchor';
    }
    return st.monitor === 'up' ? 'lower-monitor' : 'observe-and-hold';
  })();
  return cycle.id === want
    ? { risk: 0, resourceMargin: 10, detail: `baseline wants ${want}` }
    : { risk: 1, resourceMargin: 0, detail: `baseline wants ${want}` };
}

/**
 * Drive one night. `mode` selects the arm:
 *   estimator  -- the controller sees the observer's facts and acts
 *   disabled   -- every fact arrives UNKNOWN; the controller must refuse
 *   open-loop  -- no controller at all; the night runs untouched
 */
/** One night's arm, seed and gate; plain data, so a pool worker can take it. */
interface NightOptions {
  night?: number, seedIndex?: number, mode?: string, policy?: string, gate?: string,
  observer?: ConstructorParameters<typeof Observer>[0], policyOptions?: ConstructorParameters<typeof NightPolicy>[0],
  trace?: boolean,
}

export function runNight(options: NightOptions = {}) {
  const {
    night = 1, seedIndex = 0, mode = 'estimator', policy = 'night',
    gate = 'static', observer: observerOptions = {}, policyOptions = {},
    trace = false,
  } = options;
  const seed = seedOf(seedIndex);
  const sim = new Sim({ night, seed });
  const observer = new Observer({ interval: OBSERVE_INTERVAL, rng: new Rng(seed ^ 0x9e3779b9), ...observerOptions });
  const controller = new CycleController({ cycles: libraryCycles() });
  controller.reduced.night = night;
  const nightPolicy = policy === 'night'
    ? new NightPolicy({ night, ...policyOptions }) : null;
  const score = nightPolicy ? nightPolicy.scorer : baselineScore;

  const pending: DeferredAction[] = [];
  const selected: Record<string, number> = {};
  const traced: { frame: number, cycle: string, why: string | null, box: number, foxyD: unknown }[] = [];
  let actions = 0, released = 0, refused = 0, gateCalls = 0;
  let emergencyReleased = 0, cancelled = 0;
  let flashes = 0, maskFrames = 0, camsUpMax = 0, minBox = 1;
  const noDecision: Record<string, number> = {};

  while (sim.alive && !sim.won && sim.frame < C.NIGHT_FRAMES) {
    if (mode !== 'open-loop' && sim.frame % 4 === 0) {
      const facts = observer.read(sim);
      controller.observe(mode === 'disabled' ? makeUnknownFacts(facts) : facts,
        { frame: sim.frame });
      const decision = controller.plan({
        exactGate: cycle => { gateCalls++; return gate === 'exact' ? exactGate(sim, cycle) : staticGate(cycle); },
        score,
      });
      // A no-decision names its reason; a selection does not.
      const said: { readonly selected: string | null, readonly reason?: string } = decision;
      if (decision.selected)
        selected[decision.selected] = (selected[decision.selected] ?? 0) + 1;
      else if (said.reason)
        noDecision[said.reason] = (noDecision[said.reason] ?? 0) + 1;
      if (trace && decision.selected)
        traced.push({ frame: sim.frame, cycle: decision.selected,
          why: nightPolicy?.lastDecision?.why ?? null,
          box: +controller.reduced.box.toFixed(3), foxyD: controller.reduced.foxyD });
      const committed = controller.commit(decision, { frame: sim.frame });
      for (const action of committed.actions) {
        sim[action.kind](action.action);
        actions++;
        if (action.action === 'light' && action.kind === 'press') flashes++;
      }
      // Scheduling is the caller's. The controller commits only an immediate
      // prefix; without this queue a primitive's release is dropped and the
      // input stays held -- on a phone, a touch contact never lifted.
      for (const action of committed.deferred) pending.push(action);
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      if (sim.frame < pending[i].dueFrame) continue;
      const action = pending[i];
      const result = controller.releaseDeferred(action, { frame: sim.frame });
      if (result.accepted) { sim[action.kind](action.action); released++; actions++; }
      else refused++;
      pending.splice(i, 1);
    }
    sim.tick();
    if (sim.maskOn) maskFrames++;
    if (sim.camsUpSince >= 0) camsUpMax = Math.max(camsUpMax, sim.frame - sim.camsUpSince);
    minBox = Math.min(minBox, sim.box);
  }
  // A terminal outcome cancels the rest of the bounded cycle, but cancelling a
  // plan must not strand a physical contact. Walk the caller-owned queue in
  // temporal order, execute only the release that corresponds to a contact
  // this exact cycle invocation still owns, and discard future presses.
  pending.sort((a, b) => a.dueFrame - b.dueFrame);
  for (const action of pending) {
    if (action.kind !== 'release') { cancelled++; continue; }
    const result = controller.releaseDeferred(action, {
      frame: sim.frame, emergency: true,
    });
    if (result.accepted) {
      sim[action.kind](action.action);
      released++;
      emergencyReleased++;
      actions++;
    } else cancelled++;
  }
  pending.length = 0;
  return {
    night, seedIndex, mode, policy, gate,
    won: sim.won, frame: sim.frame,
    death: sim.death?.reason ?? null,
    detail: sim.death?.detail ?? null,
    actions, released, refused, emergencyReleased, cancelled,
    stranded: controller.outstandingHolds().length, gateCalls,
    flashes, maskFrames, camsUpMax, powerLeft: sim.power,
    minBox: +minBox.toFixed(3), selected, noDecision,
    trace: traced,
  };
}

/** Pool entry point: one call maps over a batch of option objects. */
export const runNightBatch = (optsList: readonly NightOptions[]) => optsList.map(runNight);
